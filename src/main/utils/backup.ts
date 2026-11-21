import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import db from '../db';
import { APP_CONF_FOLDER, STREAM_ART_DIR } from '../../config/core_config';
import { DEFAULT_APP_SETTINGS } from '../../config/app_settings';
import { BACKUP_PARTS, type BackupCounts, type BackupPart } from '../../config/backupParts';
import { MOOD_VERSION } from '../../config/mood';
import { getProvider } from '../sources/registry';
import { buildTrackIndex, matchFavourite as matchTrack } from './favouriteMatch';
import { mergeKnown } from './mergeKnown';
import { secretsProtected } from './secrets';
import type { FavouriteEntry } from './mainProcess';

// An SQLite Archive (the `sqlar` table `sqlite3 -A` reads), so no zip library.
// Each part is a JSON entry naming tracks by address, hash and filename, so it
// merges into any library.
//
// Versions skip what they don't understand in each other's backups. Keep it that
// way: never change an entry's shape incompatibly; add fields or a new entry.
const FORMAT = 1;
const MANIFEST = 'xerotunes-backup.json';
const EXTENSION = 'xtbackup';
const SETTINGS_FILE = path.join(APP_CONF_FOLDER, 'settings.json');
const SCROBBLER_FILE = path.join(APP_CONF_FOLDER, 'scrobbler.json');
const BEFORE_RESTORE = path.join(APP_CONF_FOLDER, 'before-restore');

interface Manifest {
  format: number;
  app: string;
  version: string;
  createdAt: number;
  counts: BackupCounts;
}

/** `file` is left off where a filename match would do harm: play counts. */
interface TrackRef {
  uri: string;
  hash: string | null;
  file?: string;
}

interface FavouriteDeps {
  snapshotFavourites: () => FavouriteEntry[];
  restoreFavourites: (entries: FavouriteEntry[]) => {
    imported: number;
    skipped: number;
    failed: FavouriteEntry[];
  };
}

interface RestoreContext {
  read: (name: string) => Buffer | null;
  match: (ref: TrackRef) => number | null;
  defer: (file: string, data: Buffer) => void;
}

type Outcome = { line: string; missing?: number };

interface PartIO {
  count: () => number;
  save: (add: (name: string, data: Buffer) => void) => void;
  restore: (ctx: RestoreContext) => Outcome;
}

type Row = Record<string, unknown>;

const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const parse = (data: Buffer | null): unknown => (data ? JSON.parse(data.toString('utf8')) : null);
const isPlain = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
/** A shape this version doesn't know reads as no items rather than throwing. */
const items = (value: unknown, key?: string): Row[] => {
  const list = key && isPlain(value) ? value[key] : value;
  return Array.isArray(list) ? list.filter(isPlain) : [];
};
// Wrong types read as null, so a field another version changed can't reach SQL.
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const total = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
const missingNote = (n: number) => (n ? ` (${n} not in this library yet)` : '');
const skippedNote = (n: number, why: string) => (n ? `, ${n} skipped (${why})` : '');

/** Without a keyring a "sealed" token is readable by anyone, so it stays out. */
function scrobblerFile(): Buffer | null {
  if (!fs.existsSync(SCROBBLER_FILE)) return null;
  const data = fs.readFileSync(SCROBBLER_FILE);
  if (secretsProtected()) return data;
  const state = JSON.parse(data.toString('utf8')) as Record<string, { credential?: unknown }>;
  for (const p of Object.values(state)) if (p && typeof p === 'object') p.credential = null;
  return json(state);
}

const readJsonFile = (file: string): unknown =>
  fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
const pretty = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2));

function partsIO(deps: FavouriteDeps): Record<BackupPart, PartIO> {
  return {
    settings: {
      count: () => (fs.existsSync(SETTINGS_FILE) ? 1 : 0),
      save: add => add('settings.json', fs.readFileSync(SETTINGS_FILE)),
      restore: ({ read, defer }) => {
        const incoming = parse(read('settings.json'));
        if (!isPlain(incoming)) return { line: 'not in this backup' };
        const current = readJsonFile(SETTINGS_FILE) ?? DEFAULT_APP_SETTINGS;
        defer(SETTINGS_FILE, pretty(mergeKnown(DEFAULT_APP_SETTINGS, current, incoming)));
        return { line: 'restored' };
      },
    },

    scrobbling: {
      count: () => {
        const state = parse(scrobblerFile());
        return isPlain(state)
          ? Object.values(state).filter(p => isPlain(p) && p.username).length
          : 0;
      },
      save: add => add('scrobbler.json', scrobblerFile()!),
      // Per account, so one missing from the backup stays connected; the
      // scrobbler fills in missing fields when it loads the file.
      restore: ({ read, defer }) => {
        const incoming = parse(read('scrobbler.json'));
        if (!isPlain(incoming)) return { line: 'not in this backup' };
        const current = readJsonFile(SCROBBLER_FILE);
        const merged: Row = isPlain(current) ? { ...current } : {};
        let restored = 0;
        for (const [provider, state] of Object.entries(incoming)) {
          if (!isPlain(state)) continue;
          merged[provider] = state;
          if (state.username) restored++;
        }
        defer(SCROBBLER_FILE, pretty(merged));
        return { line: `${restored} restored` };
      },
    },

    folders: {
      count: () => total('SELECT COUNT(*) AS n FROM MusicFolder'),
      save: add => add('folders.json', json(db.prepare('SELECT Uri, Name FROM MusicFolder').all())),
      restore: ({ read }) => {
        const has = db.prepare('SELECT 1 FROM MusicFolder WHERE Uri = ?');
        const insert = db.prepare(
          'INSERT INTO MusicFolder (Uri, Name, DateModified, ItemsCount, Version) VALUES (?, ?, NULL, NULL, 1)'
        );
        let added = 0;
        for (const f of items(parse(read('folders.json')))) {
          const uri = str(f.Uri);
          if (!uri || has.get(uri)) continue;
          insert.run(uri, str(f.Name));
          added++;
        }
        return { line: `${added} added` };
      },
    },

    playlists: {
      count: () => total('SELECT COUNT(*) AS n FROM Playlist'),
      save: add => {
        const lists = db.prepare('SELECT Id, Name, DateAdded FROM Playlist').all() as Array<{
          Id: number;
          Name: string;
          DateAdded: number | null;
        }>;
        const rows = db
          .prepare(
            `SELECT PlaylistTrack.PlaylistId AS pid,
               COALESCE(Track.Uri, PlaylistTrack.Uri) AS uri, Track.FileHash AS hash,
               COALESCE(Track.Title, PlaylistTrack.Title) AS title, PlaylistTrack.Artist AS artist,
               PlaylistTrack.Album AS album, COALESCE(Track.Duration, PlaylistTrack.Duration) AS duration
             FROM PlaylistTrack LEFT JOIN Track ON Track.Id = PlaylistTrack.TrackId
             ORDER BY PlaylistTrack.PlaylistId, PlaylistTrack.Position`
          )
          .all() as Array<{ pid: number; uri: string } & Row>;
        add(
          'playlists.json',
          json(
            lists.map(l => ({
              name: l.Name,
              dateAdded: l.DateAdded,
              tracks: rows
                .filter(r => r.pid === l.Id)
                .map(({ pid: _pid, ...t }) => ({ ...t, file: path.basename(t.uri) })),
            }))
          )
        );
      },
      restore: ({ read, match }) => {
        const find = db.prepare(
          'SELECT Id FROM Playlist WHERE Name = ? ORDER BY Id LIMIT 1 OFFSET ?'
        );
        const clear = db.prepare('DELETE FROM PlaylistTrack WHERE PlaylistId = ?');
        const touch = db.prepare('UPDATE Playlist SET DateModified = ? WHERE Id = ?');
        const create = db.prepare(
          'INSERT INTO Playlist (Name, DateAdded, DateModified) VALUES (?, ?, ?)'
        );
        const insert = db.prepare(
          'INSERT INTO PlaylistTrack (PlaylistId, TrackId, Uri, Title, Artist, Album, Duration, Position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        const now = Date.now();
        let restored = 0;
        let missing = 0;
        const seen = new Map<string, number>();
        for (const list of items(parse(read('playlists.json')))) {
          const name = str(list.name);
          if (!name) continue;
          // The nth same-named playlist replaces the nth existing one, not always the first.
          const nth = seen.get(name) ?? 0;
          seen.set(name, nth + 1);
          const existing = find.get(name, nth) as { Id: number } | undefined;
          let id: number;
          if (existing) {
            id = existing.Id;
            clear.run(id);
            touch.run(now, id);
          } else {
            id = Number(create.run(name, num(list.dateAdded) ?? now, now).lastInsertRowid);
          }
          restored++;
          let position = 0;
          for (const t of items(list.tracks)) {
            const uri = str(t.uri);
            if (!uri) continue;
            const trackId = match({ uri, hash: str(t.hash), file: str(t.file) ?? undefined });
            if (trackId == null) missing++;
            const fields = [str(t.title), str(t.artist), str(t.album), num(t.duration)];
            insert.run(id, trackId, uri, ...fields, position++);
          }
        }
        return { line: `${restored} restored${missingNote(missing)}`, missing };
      },
    },

    favourites: {
      // Favourites whose track is gone aren't exported, so they aren't counted.
      count: () =>
        total('SELECT COUNT(*) AS n FROM Favourite JOIN Track ON Track.Id = Favourite.TrackId'),
      save: add => add('favourites.json', json(deps.snapshotFavourites())),
      restore: ({ read }) => {
        const entries = items(parse(read('favourites.json'))).map(e => ({
          uri: str(e.uri) ?? undefined,
          hash: str(e.hash),
          file: str(e.file) ?? '',
          title: str(e.title) ?? '',
          artist: str(e.artist) ?? '',
          favouritedAt: num(e.favouritedAt),
        }));
        const { imported, skipped, failed } = deps.restoreFavourites(entries);
        const waiting = failed.length
          ? `, ${failed.length} attach after their tracks are scanned`
          : '';
        return { line: `${imported + skipped} restored${waiting}` };
      },
    },

    history: {
      count: () =>
        total('SELECT COUNT(*) AS n FROM Track WHERE PlayedTimes > 0 OR LastPlayedAt IS NOT NULL'),
      save: add => {
        const tracks = db
          .prepare(
            `SELECT Uri AS uri, FileHash AS hash, PlayedTimes AS played, LastPlayedAt AS lastPlayedAt
             FROM Track WHERE PlayedTimes > 0 OR LastPlayedAt IS NOT NULL`
          )
          .all();
        const signals = db
          .prepare(
            `SELECT Track.Uri AS uri, Track.FileHash AS hash, TrackSignal.Weight AS weight, TrackSignal.At AS at
             FROM TrackSignal JOIN Track ON Track.Id = TrackSignal.TrackId`
          )
          .all();
        add('history.json', json({ tracks, signals }));
      },
      restore: ({ read, match }) => {
        const history = parse(read('history.json'));
        // MAX, so restoring the same backup twice changes nothing.
        const update = db.prepare(
          `UPDATE Track SET
             PlayedTimes = MAX(COALESCE(PlayedTimes, 0), COALESCE(?, 0)),
             LastPlayedAt = CASE WHEN ? IS NULL THEN LastPlayedAt
                                 ELSE MAX(COALESCE(LastPlayedAt, 0), ?) END
           WHERE Id = ?`
        );
        const signal = db.prepare(
          `INSERT INTO TrackSignal (TrackId, Weight, At) SELECT ?, ?, ?
           WHERE NOT EXISTS (SELECT 1 FROM TrackSignal WHERE TrackId = ? AND At = ?)`
        );
        const lookup = (t: Row) => {
          const uri = str(t.uri);
          return uri ? match({ uri, hash: str(t.hash) }) : null;
        };
        const tracks = items(history, 'tracks');
        let missing = 0;
        for (const t of tracks) {
          const id = lookup(t);
          if (id == null) missing++;
          else update.run(num(t.played), num(t.lastPlayedAt), num(t.lastPlayedAt), id);
        }
        for (const s of items(history, 'signals')) {
          const id = lookup(s);
          const [weight, at] = [num(s.weight), num(s.at)];
          if (id != null && weight != null && at != null) signal.run(id, weight, at, id, at);
        }
        return { line: `${tracks.length} tracks${missingNote(missing)}`, missing };
      },
    },

    // Keyed by file hash (or path), not track id, so it needs no matching.
    mood: {
      count: () => total('SELECT COUNT(*) AS n FROM TrackMood'),
      save: add =>
        add(
          'mood.json',
          json(db.prepare('SELECT Key, Features, Version, AnalysedAt FROM TrackMood').all())
        ),
      restore: ({ read }) => {
        // Never replaces a result from a newer analyser than the backup's.
        const upsert = db.prepare(
          `INSERT INTO TrackMood (Key, Features, Version, AnalysedAt) VALUES (?, ?, ?, ?)
           ON CONFLICT(Key) DO UPDATE SET Features = excluded.Features,
             Version = excluded.Version, AnalysedAt = excluded.AnalysedAt
           WHERE excluded.Version >= TrackMood.Version`
        );
        let restored = 0;
        let newer = 0;
        for (const r of items(parse(read('mood.json')))) {
          const [key, features, version] = [str(r.Key), str(r.Features), num(r.Version)];
          if (!key || !features || version == null) continue;
          if (version > MOOD_VERSION) {
            newer++;
            continue;
          }
          upsert.run(key, features, version, num(r.AnalysedAt));
          restored++;
        }
        return { line: `${restored} tracks${skippedNote(newer, 'from a newer version')}` };
      },
    },

    streams: {
      count: () => total('SELECT COUNT(*) AS n FROM Stream'),
      save: add => {
        const rows = db
          .prepare('SELECT Name, Uri, DateAdded, CoverUri FROM Stream')
          .all() as Array<{
          Name: string;
          Uri: string;
          DateAdded: number | null;
          CoverUri: string | null;
        }>;
        const streams = rows.map(r => {
          // CoverUri is an absolute path into this profile, so the art travels by name.
          const cover = r.CoverUri && fs.existsSync(r.CoverUri) ? path.basename(r.CoverUri) : null;
          if (cover) add(`stream_arts/${cover}`, fs.readFileSync(r.CoverUri!));
          return { name: r.Name, uri: r.Uri, dateAdded: r.DateAdded, cover };
        });
        add('streams.json', json(streams));
        // Its own entry, so a version that predates it still reads streams.json.
        const songs = db
          .prepare(
            `SELECT Stream.Uri AS stream, StreamTrack.Raw AS raw, StreamTrack.Title AS title,
               StreamTrack.Artist AS artist, StreamTrack.FirstHeardAt AS firstHeardAt,
               StreamTrack.LastHeardAt AS lastHeardAt, StreamTrack.Saved AS saved
             FROM StreamTrack JOIN Stream ON Stream.Id = StreamTrack.StreamId`
          )
          .all();
        add('stream-songs.json', json(songs));
      },
      restore: ({ read }) => {
        const has = db.prepare('SELECT 1 FROM Stream WHERE Uri = ?');
        const insert = db.prepare('INSERT INTO Stream (Name, Uri, DateAdded) VALUES (?, ?, ?)');
        const setCover = db.prepare('UPDATE Stream SET CoverUri = ? WHERE Id = ?');
        let added = 0;
        for (const s of items(parse(read('streams.json')))) {
          const [name, uri, cover] = [str(s.name), str(s.uri), str(s.cover)];
          if (!name || !uri || has.get(uri)) continue;
          const id = Number(insert.run(name, uri, num(s.dateAdded) ?? Date.now()).lastInsertRowid);
          added++;
          const art = cover && path.basename(cover) === cover ? read(`stream_arts/${cover}`) : null;
          if (!art) continue;
          fs.mkdirSync(STREAM_ART_DIR, { recursive: true });
          const target = path.join(STREAM_ART_DIR, `${id}-${Date.now()}${path.extname(cover!)}`);
          fs.writeFileSync(target, art);
          setCover.run(target, id);
        }

        // Unsaved songs older than streamHistoryDays age out again, as they would have.
        const stationId = db.prepare('SELECT Id FROM Stream WHERE Uri = ?');
        const song = db.prepare(
          `INSERT INTO StreamTrack (StreamId, Raw, Title, Artist, FirstHeardAt, LastHeardAt, Saved)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(StreamId, Raw) DO UPDATE SET
             FirstHeardAt = MIN(COALESCE(FirstHeardAt, excluded.FirstHeardAt),
                                COALESCE(excluded.FirstHeardAt, FirstHeardAt)),
             LastHeardAt = MAX(COALESCE(LastHeardAt, 0), COALESCE(excluded.LastHeardAt, 0)),
             Saved = MAX(Saved, excluded.Saved)`
        );
        let songs = 0;
        for (const t of items(parse(read('stream-songs.json')))) {
          const [stream, raw] = [str(t.stream), str(t.raw)];
          const station = stream
            ? (stationId.get(stream) as { Id: number } | undefined)
            : undefined;
          if (!station || !raw) continue;
          const heard = [num(t.firstHeardAt), num(t.lastHeardAt)];
          song.run(station.Id, raw, str(t.title), str(t.artist), ...heard, t.saved ? 1 : 0);
          songs++;
        }
        return { line: `${added} added, ${songs} songs heard on them` };
      },
    },

    servers: {
      count: () => total('SELECT COUNT(*) AS n FROM Source'),
      save: add => {
        const keep = secretsProtected();
        const rows = db
          .prepare(
            'SELECT Type, Name, BaseUrl, Username, UserId, AccessToken, DeviceId, ConfigJson FROM Source'
          )
          .all() as Row[];
        add(
          'servers.json',
          json(rows.map(r => ({ ...r, AccessToken: keep ? r.AccessToken : null })))
        );
      },
      restore: ({ read }) => {
        const has = db.prepare(
          'SELECT 1 FROM Source WHERE Type = ? AND BaseUrl IS ? AND Username IS ?'
        );
        const insert = db.prepare(
          `INSERT INTO Source (Type, Name, BaseUrl, Username, UserId, AccessToken, DeviceId, ConfigJson, Version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
        );
        let added = 0;
        let unsupported = 0;
        for (const r of items(parse(read('servers.json')))) {
          const type = str(r.Type);
          if (!type) continue;
          if (!getProvider(type)) {
            unsupported++;
            continue;
          }
          const [baseUrl, username] = [str(r.BaseUrl), str(r.Username)];
          if (has.get(type, baseUrl, username)) continue;
          const rest = [str(r.UserId), str(r.AccessToken), str(r.DeviceId), str(r.ConfigJson)];
          insert.run(type, str(r.Name), baseUrl, username, ...rest);
          added++;
        }
        const sync = added ? '; sync them to load their tracks' : '';
        return {
          line: `${added} added${skippedNote(unsupported, 'not supported by this version')}${sync}`,
        };
      },
    },
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ponytail: runs on the main process; fine at a few MB of JSON, move to a
// utility process if mood data for huge libraries makes the app stall.
function writeBackup(dest: string, parts: BackupPart[], io: Record<BackupPart, PartIO>): Manifest {
  const partial = `${dest}.partial`;
  fs.rmSync(partial, { force: true });
  const archive = new Database(partial);
  try {
    archive.exec(
      'CREATE TABLE sqlar(name TEXT PRIMARY KEY, mode INT, mtime INT, sz INT, data BLOB)'
    );
    const insert = archive.prepare('INSERT INTO sqlar VALUES (?, ?, ?, ?, ?)');
    const now = Date.now();
    // sqlar keeps zlib-compressed data only when that is smaller; JPEG art isn't.
    const add = (name: string, data: Buffer) => {
      const packed = zlib.deflateSync(data);
      const stored = packed.length < data.length ? packed : data;
      insert.run(name, 0o100644, Math.floor(now / 1000), data.length, stored);
    };
    const counts: BackupCounts = {};
    archive.transaction(() => {
      for (const part of parts) {
        const n = io[part].count();
        if (!n) continue;
        io[part].save(add);
        counts[part] = n;
      }
    })();
    const manifest: Manifest = {
      format: FORMAT,
      app: app.getName(),
      version: app.getVersion(),
      createdAt: now,
      counts,
    };
    add(MANIFEST, json(manifest));
    archive.close();
    fs.renameSync(partial, dest);
    return manifest;
  } finally {
    if (archive.open) archive.close();
    fs.rmSync(partial, { force: true });
  }
}

function openBackup(file: string): { archive: Database.Database; manifest: Manifest } {
  const archive = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const manifest = parse(readEntry(archive, MANIFEST));
    if (!isPlain(manifest) || !isPlain(manifest.counts)) throw new Error('missing manifest');
    return { archive, manifest: manifest as unknown as Manifest };
  } catch (err) {
    archive.close();
    throw err;
  }
}

function readEntry(archive: Database.Database, name: string): Buffer | null {
  const row = archive.prepare('SELECT sz, data FROM sqlar WHERE name = ?').get(name) as
    { sz: number; data: Buffer } | undefined;
  if (!row) return null;
  return row.data.length < row.sz ? zlib.inflateSync(row.data) : row.data;
}

const labelOf = (part: BackupPart) => BACKUP_PARTS.find(p => p.id === part)?.label ?? part;
const isKnownPart = (id: string) => BACKUP_PARTS.some(p => p.id === id);

export function registerBackupIpc(mainWin: BrowserWindow, deps: FavouriteDeps): void {
  const io = partsIO(deps);
  const known = (parts: unknown): BackupPart[] =>
    Array.isArray(parts) ? BACKUP_PARTS.map(p => p.id).filter(id => parts.includes(id)) : [];
  const fail = (title: string, message: string, detail: string) =>
    dialog.showMessageBox(mainWin, { type: 'error', title, message, detail });

  ipcMain.handle('backup-summary', () => {
    const counts: BackupCounts = {};
    for (const p of BACKUP_PARTS) counts[p.id] = io[p.id].count();
    return counts;
  });

  ipcMain.handle('backup-library', async (_e, { parts }: { parts: unknown }) => {
    const selected = known(parts);
    if (!selected.length) return { success: false, canceled: true };
    const pick = await dialog.showSaveDialog(mainWin, {
      title: 'Back Up',
      defaultPath: path.join(
        app.getPath('documents'),
        `${app.getName()} Backup ${today()}.${EXTENSION}`
      ),
      filters: [{ name: 'XeroTunes Backup', extensions: [EXTENSION] }],
    });
    if (pick.canceled || !pick.filePath) return { success: false, canceled: true };
    try {
      const manifest = writeBackup(pick.filePath, selected, io);
      const signInsLeftOut =
        !secretsProtected() && (manifest.counts.servers || manifest.counts.scrobbling);
      const { response } = await dialog.showMessageBox(mainWin, {
        type: 'info',
        title: 'Back Up',
        message: 'Backup saved',
        detail:
          pick.filePath +
          (signInsLeftOut
            ? '\n\nSign-ins were left out: this computer has no system keyring to encrypt them, so you sign in again after a restore.'
            : ''),
        buttons: ['OK', 'Show in Folder'],
        noLink: true,
      });
      if (response === 1) shell.showItemInFolder(pick.filePath);
      return { success: true };
    } catch (err) {
      await fail('Back Up', 'The backup could not be saved', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('restore-pick', async () => {
    const pick = await dialog.showOpenDialog(mainWin, {
      title: 'Restore',
      defaultPath: app.getPath('documents'),
      properties: ['openFile'],
      filters: [{ name: 'XeroTunes Backup', extensions: [EXTENSION] }],
    });
    const file = pick.filePaths?.[0];
    if (pick.canceled || !file) return { canceled: true };
    try {
      const { archive, manifest } = openBackup(file);
      archive.close();
      const unsupported = Object.entries(manifest.counts).filter(
        ([id, n]) => !isKnownPart(id) && (num(n) ?? 0) > 0
      ).length;
      return {
        file,
        counts: manifest.counts,
        createdAt: num(manifest.createdAt) ?? undefined,
        unsupported,
      };
    } catch {
      await fail('Restore', 'This file is not a XeroTunes backup', file);
      return { canceled: true };
    }
  });

  // Each part gets its own savepoint, so one this version can't read rolls back
  // alone. Files are written and the app relaunched in one tick, so nothing still
  // running can overwrite them.
  ipcMain.handle(
    'restore-library',
    async (_e, { file, parts }: { file: string; parts: unknown }) => {
      let opened: ReturnType<typeof openBackup>;
      try {
        opened = openBackup(file);
      } catch {
        await fail('Restore', 'This file is not a XeroTunes backup', file);
        return { success: false };
      }
      const { archive, manifest } = opened;
      const selected = known(parts).filter(p => manifest.counts[p]);
      const deferred: Array<[string, Buffer]> = [];
      const lines: string[] = [];
      let missing = 0;
      try {
        if (!selected.length) return { success: false, canceled: true };
        // The library as it was, for undoing a restore by hand.
        fs.rmSync(BEFORE_RESTORE, { recursive: true, force: true });
        fs.mkdirSync(BEFORE_RESTORE, { recursive: true });
        await db.backup(path.join(BEFORE_RESTORE, 'data.db'));
        for (const f of [SETTINGS_FILE, SCROBBLER_FILE]) {
          if (fs.existsSync(f)) fs.copyFileSync(f, path.join(BEFORE_RESTORE, path.basename(f)));
        }

        let index: ReturnType<typeof buildTrackIndex> | null = null;
        const ctx: RestoreContext = {
          read: name => readEntry(archive, name),
          match: ref =>
            matchTrack(
              (index ??= buildTrackIndex(db.prepare('SELECT Id, Uri, FileHash FROM Track').all())),
              ref
            ),
          defer: (target, data) => deferred.push([target, data]),
        };
        db.transaction(() => {
          for (const part of selected) {
            const held = deferred.length;
            try {
              const outcome = db.transaction(() => io[part].restore(ctx))();
              lines.push(`${labelOf(part)}: ${outcome.line}`);
              missing += outcome.missing ?? 0;
            } catch (err) {
              deferred.length = held;
              console.warn(`[restore] skipped ${part}:`, err);
              lines.push(`${labelOf(part)}: skipped, this version can't read it`);
            }
          }
        })();
      } catch (err) {
        await fail('Restore', 'The backup could not be restored', (err as Error).message);
        return { success: false };
      } finally {
        archive.close();
      }

      await dialog.showMessageBox(mainWin, {
        type: 'info',
        title: 'Restore',
        message: 'Backup restored',
        detail:
          lines.join('\n') +
          (missing
            ? '\n\nTracks not in this library yet stay unlinked. Scan your music folders or sync your servers, then restore again to link them.'
            : '') +
          '\n\nThe library from before the restore is kept in the "before-restore" folder in the app\'s data folder. XeroTunes restarts now.',
        noLink: true,
      });
      for (const [target, data] of deferred) fs.writeFileSync(target, data);
      app.relaunch();
      app.exit(0);
      return { success: true };
    }
  );
}
