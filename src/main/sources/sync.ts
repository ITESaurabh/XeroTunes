/**
 * Everything that touches the database for remote libraries. Providers know how
 * to talk to a server; this knows how to store what they return.
 *
 * Synced tracks are ordinary rows in Track/Album/Artist tagged with SourceId +
 * RemoteId, with a streaming URL in Uri instead of a file path, so every query
 * and view in the app works on them unchanged. `SourceId IS NULL` is the only
 * local-vs-remote discriminator in the schema.
 */

import type { BrowserWindow } from 'electron';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import dbModule from '../db';
import { ALBUM_ART_DIR } from '../../config/core_config';
import {
  getProvider,
  qualifyPath,
  displayPath,
  parentPath,
  stripNamespace,
} from './registry';
import { applyLibrarySettings, splitArtists } from '../utils/libraryRules';
import type { RemoteTrack, SourceCredentials, RemoteTrackDetails } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db: any = dbModule;

export interface SourceRow {
  Id: number;
  Type: string;
  Name: string | null;
  BaseUrl: string | null;
  Username: string | null;
  UserId: string | null;
  AccessToken: string | null;
  DeviceId: string | null;
  LastSyncedAt: number | null;
  ConfigJson: string | null;
}

/** The renderer never needs the access token, so it never gets one. */
export interface PublicSource {
  Id: number;
  Type: string;
  Name: string | null;
  BaseUrl: string | null;
  Username: string | null;
  LastSyncedAt: number | null;
  TrackCount: number;
  DownloadedCount: number;
}

export function listSources(): PublicSource[] {
  return db
    .prepare(
      `SELECT Source.Id, Source.Type, Source.Name, Source.BaseUrl, Source.Username,
              Source.LastSyncedAt,
              COUNT(Track.Id) AS TrackCount,
              COALESCE(SUM(CASE WHEN Track.Uri NOT LIKE 'http%' THEN 1 ELSE 0 END), 0)
                AS DownloadedCount
       FROM Source
       LEFT JOIN Track ON Track.SourceId = Source.Id
       GROUP BY Source.Id
       ORDER BY Source.Name COLLATE NOCASE`
    )
    .all() as PublicSource[];
}

function getSourceRow(id: number): SourceRow | null {
  return (db.prepare('SELECT * FROM Source WHERE Id = ?').get(id) as SourceRow) ?? null;
}

function toCredentials(row: SourceRow): SourceCredentials {
  let config: Record<string, unknown> = {};
  try {
    if (row.ConfigJson) config = JSON.parse(row.ConfigJson);
  } catch {
    /* a corrupt blob shouldn't stop a sync */
  }
  return {
    baseUrl: row.BaseUrl ?? '',
    username: row.Username,
    userId: row.UserId,
    accessToken: row.AccessToken,
    deviceId: row.DeviceId,
    config,
  };
}

// ── Row upserts ──────────────────────────────────────────────────────────────

/**
 * Keyed by name and shared with the scanner's rows, not tagged to a source.
 *
 * Tagging them per-source meant a synced track could never share an artist with
 * a local one, and worse, the credit string arrived whole: "A$AP Ferg & Lil
 * Wayne" became its own artist instead of two. Splitting requires the same rows
 * the scanner uses, so removing a source now drops artists via the orphan sweep
 * rather than by ownership.
 */
function getOrCreateArtist(name: string): number {
  const existing = db.prepare('SELECT Id FROM Artist WHERE Name = ? COLLATE NOCASE').get(name) as
    | { Id: number }
    | undefined;
  if (existing) return existing.Id;
  return Number(
    db.prepare('INSERT INTO Artist (Name, Version) VALUES (?, 1)').run(name).lastInsertRowid
  );
}

/** Unique ids for every artist named in a credit, after the user's split rules. */
function artistIdsFor(credits: string[]): number[] {
  const names = splitArtists(credits) as string[];
  return [...new Set(names.map(getOrCreateArtist))];
}

function getOrCreateRemoteAlbum(
  sourceId: number,
  remoteId: string,
  title: string,
  artistId: number | null,
  releaseYear: number | null
): number {
  const existing = db
    .prepare('SELECT Id FROM Album WHERE SourceId = ? AND RemoteId = ?')
    .get(sourceId, remoteId) as { Id: number } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE Album SET Title = ?, ArtistId = COALESCE(?, ArtistId),
              ReleaseYear = COALESCE(?, ReleaseYear) WHERE Id = ?`
    ).run(title, artistId, releaseYear, existing.Id);
    return existing.Id;
  }
  return Number(
    db
      .prepare(
        `INSERT INTO Album (Title, ArtistId, ReleaseYear, DateAdded, Version, SourceId, RemoteId)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
      .run(title, artistId, releaseYear, Date.now(), sourceId, remoteId).lastInsertRowid
  );
}

/**
 * The scan worker stores the untouched artist tag here and re-splits it whenever
 * the multi-artist separators change. Writing it for remote tracks too lets that
 * pass treat them like local files; otherwise a credit such as
 * "Eminem & Linkin Park, Kendrick Lamar" stays one artist forever.
 */
function rawTagJson(value: string): string {
  return JSON.stringify(value ?? '');
}

function getOrCreateGenre(name: string): number {
  const existing = db.prepare('SELECT Id FROM Genre WHERE Name = ? COLLATE NOCASE').get(name) as
    | { Id: number }
    | undefined;
  if (existing) return existing.Id;
  return Number(
    db.prepare('INSERT INTO Genre (Name, Version) VALUES (?, 1)').run(name).lastInsertRowid
  );
}

// ── Sync ─────────────────────────────────────────────────────────────────────

export interface SyncOptions {
  /** Off when a caller brackets several phases with its own scan-start/end. */
  emitLifecycle?: boolean;
  /** The separators that decide how a credit splits into artists. */
  librarySettings?: { multiArtistSeparators?: string[]; multiArtistExceptions?: string[] };
}

export async function syncSource(
  id: number,
  mainWin: BrowserWindow,
  { emitLifecycle = true, librarySettings }: SyncOptions = {}
): Promise<{ success: true; imported: number } | { success: false; error: string }> {
  const row = getSourceRow(id);
  if (!row) return { success: false, error: 'Source not found' };
  const provider = getProvider(row.Type);
  if (!provider) return { success: false, error: `Unknown source type "${row.Type}"` };
  const credentials = toCredentials(row);
  // Module-level state in libraryRules, and this process has its own copy of it
  // separate from the scan worker's.
  applyLibrarySettings(librarySettings);

  const send = (event: string, payload?: unknown) => {
    if (!mainWin.isDestroyed()) mainWin.webContents.send(event, payload);
  };

  if (emitLifecycle) send('scan-start', 'sync');
  try {
    let tracks: RemoteTrack[];
    try {
      tracks = await provider.listTracks(credentials, (loaded, total) =>
        send('scan-progress', { scanned: 0, total, processed: loaded })
      );
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }

    const total = tracks.length;
    let imported = 0;
    const albumArtUrls = new Map<number, string>();

    // An album's links are rebuilt by the first of its tracks to arrive; the rest
    // add to them, so a compilation keeps every album artist it names.
    const albumLinksCleared = new Set<number>();

    const writeLinks = (
      trackId: number,
      albumId: number | null,
      artistIds: number[],
      albumArtistIds: number[]
    ) => {
      // Rebuilt rather than merged: an artist rename or re-key leaves the old
      // row pointing at an Artist that no longer exists, and the joins that read
      // these links then return nothing at all for the track.
      db.prepare('DELETE FROM TrackArtist WHERE TrackId = ?').run(trackId);
      const linkTrack = db.prepare(
        'INSERT OR IGNORE INTO TrackArtist (TrackId, ArtistId) VALUES (?, ?)'
      );
      for (const aid of artistIds) linkTrack.run(trackId, aid);

      if (albumId == null) return;
      if (!albumLinksCleared.has(albumId)) {
        db.prepare('DELETE FROM AlbumArtist WHERE AlbumId = ?').run(albumId);
        albumLinksCleared.add(albumId);
      }
      const linkAlbum = db.prepare(
        'INSERT OR IGNORE INTO AlbumArtist (AlbumId, ArtistId) VALUES (?, ?)'
      );
      for (const aid of albumArtistIds.length ? albumArtistIds : artistIds) {
        linkAlbum.run(albumId, aid);
      }
    };

    const importTrack = db.transaction((track: RemoteTrack) => {
      const artistIds = artistIdsFor(track.artists);
      const albumArtistIds = artistIdsFor(track.albumArtists);
      const primaryArtistId = artistIds[0] ?? null;

      // Album identity is (album artist, album name), the same rule the local
      // scanner uses. A server's own album id can't be trusted for this:
      // Jellyfin's is really the containing folder, so one id was found
      // spanning 33 distinct albums while 212 tracks had no id at all.
      let albumId: number | null = null;
      if (track.album) {
        // Only the album artist keys the album. Falling back to the track artist
        // splits a compilation into one album per guest credit: "LAST DAWN"
        // became 12 albums because each track's artist named a different guest.
        // The raw credit, not a split name: this is the album's identity, and
        // changing how it reads would re-key every album on the next sync.
        const albumArtistName = track.albumArtists[0] ?? '';
        albumId = getOrCreateRemoteAlbum(
          id,
          `album:${albumArtistName.toLowerCase()}::${track.album.toLowerCase()}`,
          track.album,
          albumArtistIds[0] ?? primaryArtistId,
          track.year
        );
        if (!albumArtUrls.has(albumId)) {
          const url = provider.artUrl(credentials, track);
          if (url) albumArtUrls.set(albumId, url);
        }
      }

      const genreId = track.genres[0] ? getOrCreateGenre(track.genres[0]) : null;
      const uri = provider.streamUrl(credentials, track.remoteId);
      const albumArt = albumId != null ? path.join(ALBUM_ART_DIR, `${albumId}.jpg`) : null;
      // Scheme-qualified so the folder tree can group by server and remote paths
      // can never collide with local ones.
      const folderPath = track.path ? qualifyPath(row.Type, id, parentPath(track.path)) : null;

      const existing = db
        .prepare('SELECT Id, Uri FROM Track WHERE SourceId = ? AND RemoteId = ?')
        .get(id, track.remoteId) as { Id: number; Uri: string } | undefined;

      if (existing) {
        // A downloaded track's Uri points at a real file. Overwriting it with
        // the stream URL would silently un-download it on the next sync.
        const keepUri = !/^https?:\/\//i.test(existing.Uri);
        db.prepare(
          `UPDATE Track SET
             Uri = CASE WHEN ? THEN Uri ELSE ? END,
             Title = ?, ArtistId = ?, AlbumId = ?, GenreId = ?, TrackNumber = ?,
             Year = ?, AlbumArt = ?, Duration = ?, ReleaseYear = ?, DiscNumber = ?,
             Extension = ?, FolderPath = ?, RawArtist = ?, RawAlbumArtist = ?
           WHERE Id = ?`
        ).run(
          keepUri ? 1 : 0,
          uri,
          track.title,
          primaryArtistId,
          albumId,
          genreId,
          track.trackNumber != null ? String(track.trackNumber) : null,
          track.year != null ? String(track.year) : null,
          albumArt,
          track.durationSec,
          track.year,
          track.discNumber,
          track.container,
          folderPath,
          rawTagJson(track.artists.join(', ')),
          rawTagJson(track.albumArtists.join(', ')),
          existing.Id
        );
        writeLinks(existing.Id, albumId, artistIds, albumArtistIds);
        return;
      }

      const trackId = Number(
        db
          .prepare(
            `INSERT INTO Track
              (Uri, Extension, Title, ArtistId, AlbumId, GenreId, TrackNumber, Year,
               AlbumArt, Duration, ReleaseYear, DiscNumber, DateAdded, Version,
               FolderPath, RawArtist, RawAlbumArtist, SourceId, RemoteId)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
          )
          .run(
            uri,
            track.container,
            track.title,
            primaryArtistId,
            albumId,
            genreId,
            track.trackNumber != null ? String(track.trackNumber) : null,
            track.year != null ? String(track.year) : null,
            albumArt,
            track.durationSec,
            track.year,
            track.discNumber,
            track.dateAdded ?? Date.now(),
            folderPath,
            rawTagJson(track.artists.join(', ')),
            rawTagJson(track.albumArtists.join(', ')),
            id,
            track.remoteId
          ).lastInsertRowid
      );

      writeLinks(trackId, albumId, artistIds, albumArtistIds);
    });

    for (const track of tracks) {
      importTrack(track);
      imported++;
      if (imported % 50 === 0 || imported === total) {
        send('scan-progress', { scanned: imported, total, processed: imported });
      }
    }

    // Network I/O outside the transaction, batched so a big library doesn't open
    // hundreds of sockets at once.
    const jobs = [...albumArtUrls.entries()].filter(
      ([albumId]) => !fs.existsSync(path.join(ALBUM_ART_DIR, `${albumId}.jpg`))
    );
    for (let i = 0; i < jobs.length; i += 4) {
      await Promise.all(
        jobs
          .slice(i, i + 4)
          .map(([albumId, url]) => downloadTo(url, path.join(ALBUM_ART_DIR, `${albumId}.jpg`)))
      );
      send('scan-progress', {
        scanned: total,
        total: total + jobs.length,
        processed: total + Math.min(i + 4, jobs.length),
      });
    }

    pruneEmptyAlbums(id);
    clearMissingArt(id);
    // cleanupOrphans does this too, but it only runs in the scan worker, and a
    // library with no local folders never starts one.
    db.prepare('DELETE FROM TrackArtist WHERE ArtistId NOT IN (SELECT Id FROM Artist)').run();
    db.prepare('DELETE FROM AlbumArtist WHERE ArtistId NOT IN (SELECT Id FROM Artist)').run();

    db.prepare('UPDATE Source SET LastSyncedAt = ? WHERE Id = ?').run(Date.now(), id);
    send('library-updated', { scanned: imported });
    return { success: true, imported };
  } finally {
    if (emitLifecycle) send('scan-end', null);
  }
}

/** Every configured server, in order, reporting the first failure. */
export async function syncAllSources(
  mainWin: BrowserWindow,
  librarySettings?: SyncOptions['librarySettings']
): Promise<{ synced: number; imported: number; error?: string }> {
  const ids = (db.prepare('SELECT Id FROM Source').all() as Array<{ Id: number }>).map(r => r.Id);
  let synced = 0;
  let imported = 0;
  let error: string | undefined;
  for (const id of ids) {
    const result = await syncSource(id, mainWin, { emitLifecycle: false, librarySettings });
    // `in`, not `result.success`: the project builds with strict off, where a
    // boolean discriminant doesn't narrow the union.
    if ('error' in result) {
      error = error ?? result.error;
      continue;
    }
    synced++;
    imported += result.imported;
  }
  return { synced, imported, error };
}

/**
 * Albums left with no tracks, including every album row from a sync that grouped
 * them differently. Without this a re-sync leaves the old grouping in the
 * Albums view forever.
 */
function pruneEmptyAlbums(sourceId: number): void {
  const empty = db
    .prepare(
      `SELECT Id FROM Album WHERE SourceId = ?
         AND Id NOT IN (SELECT AlbumId FROM Track WHERE AlbumId IS NOT NULL)`
    )
    .all(sourceId) as Array<{ Id: number }>;
  if (!empty.length) return;
  db.transaction(() => {
    const delLink = db.prepare('DELETE FROM AlbumArtist WHERE AlbumId = ?');
    const delAlbum = db.prepare('DELETE FROM Album WHERE Id = ?');
    for (const { Id } of empty) {
      delLink.run(Id);
      delAlbum.run(Id);
    }
  })();
  for (const { Id } of empty) unlinkQuietly(path.join(ALBUM_ART_DIR, `${Id}.jpg`));
}

/** A track points at <albumId>.jpg whether or not the download produced one. */
function clearMissingArt(sourceId: number): void {
  const missing = (
    db
      .prepare('SELECT DISTINCT AlbumId FROM Track WHERE SourceId = ? AND AlbumId IS NOT NULL')
      .all(sourceId) as Array<{ AlbumId: number }>
  ).filter(r => !fs.existsSync(path.join(ALBUM_ART_DIR, `${r.AlbumId}.jpg`)));
  if (!missing.length) return;
  const clear = db.prepare('UPDATE Track SET AlbumArt = NULL WHERE AlbumId = ?');
  db.transaction(() => {
    for (const { AlbumId } of missing) clear.run(AlbumId);
  })();
}

async function downloadTo(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

// ── Adding and removing servers ──────────────────────────────────────────────

export async function addSource(
  type: string,
  input: { baseUrl: string; username?: string; password?: string }
): Promise<{ success: true; sourceId: number } | { success: false; error: string }> {
  const provider = getProvider(type);
  if (!provider) return { success: false, error: `Unknown source type "${type}"` };
  try {
    const { displayName, credentials } = await provider.connect(input);
    const info = db
      .prepare(
        `INSERT INTO Source
          (Type, Name, BaseUrl, Username, UserId, AccessToken, DeviceId, ConfigJson, Version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .run(
        provider.type,
        displayName,
        credentials.baseUrl,
        credentials.username,
        credentials.userId,
        credentials.accessToken,
        credentials.deviceId,
        JSON.stringify(credentials.config ?? {})
      );
    return { success: true, sourceId: Number(info.lastInsertRowid) };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export function removeSource(id: number): { success: boolean } {
  const albums = db.prepare('SELECT Id FROM Album WHERE SourceId = ?').all(id) as Array<{
    Id: number;
  }>;
  const downloaded = db
    .prepare("SELECT Uri FROM Track WHERE SourceId = ? AND Uri NOT LIKE 'http%'")
    .all(id) as Array<{ Uri: string }>;

  db.transaction(() => {
    db.prepare(
      'DELETE FROM TrackArtist WHERE TrackId IN (SELECT Id FROM Track WHERE SourceId = ?)'
    ).run(id);
    db.prepare(
      'DELETE FROM AlbumArtist WHERE AlbumId IN (SELECT Id FROM Album WHERE SourceId = ?)'
    ).run(id);
    db.prepare('DELETE FROM Track WHERE SourceId = ?').run(id);
    db.prepare('DELETE FROM Album WHERE SourceId = ?').run(id);
    db.prepare('DELETE FROM Source WHERE Id = ?').run(id);
    // Artists are shared with the local library, so they go by orphan rather
    // than by ownership; one still credited on a local track has to survive.
    db.prepare(
      `DELETE FROM Artist WHERE Id NOT IN (
         SELECT ArtistId FROM TrackArtist WHERE ArtistId IS NOT NULL
         UNION
         SELECT ArtistId FROM AlbumArtist WHERE ArtistId IS NOT NULL
       )`
    ).run();
  })();

  // Best-effort file cleanup after the rows are gone: junk on disk is
  // recoverable, a failed transaction is not.
  for (const { Id } of albums) unlinkQuietly(path.join(ALBUM_ART_DIR, `${Id}.jpg`));
  for (const { Uri } of downloaded) unlinkQuietly(Uri);
  return { success: true };
}

// ── Per-track lookups, served from the server on demand ──────────────────────

interface Resolved {
  sourceId: number;
  remoteId: string;
  type: string;
  credentials: SourceCredentials;
}

/** Null for a local track, or one whose source is gone or unrecognised. */
function resolve(trackId: number): Resolved | null {
  const row = db
    .prepare(
      `SELECT Track.RemoteId, Source.*
       FROM Track JOIN Source ON Track.SourceId = Source.Id
       WHERE Track.Id = ?`
    )
    .get(trackId) as (SourceRow & { RemoteId: string }) | undefined;
  if (!row?.RemoteId || !getProvider(row.Type)) return null;
  return {
    sourceId: row.Id,
    remoteId: row.RemoteId,
    type: row.Type,
    credentials: toCredentials(row),
  };
}

export async function remoteLyrics(trackId: number): Promise<string | null> {
  const r = resolve(trackId);
  const provider = r && getProvider(r.type);
  if (!r || !provider?.lyrics) return null;
  try {
    return await provider.lyrics(r.credentials, r.remoteId);
  } catch {
    return null;
  }
}

export async function remoteTrackDetails(trackId: number): Promise<RemoteTrackDetails | null> {
  const r = resolve(trackId);
  const provider = r && getProvider(r.type);
  if (!r || !provider?.details) return null;
  try {
    const details = await provider.details(r.credentials, r.remoteId);
    if (!details) return null;
    // Scheme-qualified here rather than in the renderer, so the UI never has to
    // know which providers exist or how they name themselves.
    return { ...details, path: displayPath(r.type, details.path) };
  } catch {
    return null;
  }
}

// ── Offline downloads ────────────────────────────────────────────────────────
// A downloaded track keeps its SourceId/RemoteId but its Uri becomes the local
// file path, so from every read path in the app it simply *is* a local track:
// tag editing, lyrics sidecars and the Cast proxy all start working with no
// extra code. Reversible for free because the stream URL is derived, not stored.

function unlinkQuietly(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.warn('[sources] Could not delete', filePath, (err as Error).message);
  }
}

/**
 * Where the source's own files live, derived from the paths it reports: the
 * deepest folder all of them sit under. Null when it serves nothing we can place.
 */
function libraryRoot(sourceId: number): string | null {
  const rows = db
    .prepare(
      `SELECT DISTINCT FolderPath FROM Track
       WHERE SourceId = ? AND FolderPath IS NOT NULL AND FolderPath != ''`
    )
    .all(sourceId) as Array<{ FolderPath: string }>;
  let common: string[] | null = null;
  for (const { FolderPath } of rows) {
    const parts = normalizePath(stripNamespace(FolderPath)).split('/');
    if (!common) {
      common = parts;
      continue;
    }
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
  }
  return common && common.length ? common.join('/') : null;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Writing a download inside the folder the server itself indexes starts a loop:
 * the server picks the copy up on its next scan, our next sync imports it as a
 * second track, and the library grows a duplicate for every download. Paths are
 * only comparable when the server runs on this machine; on a NAS they won't
 * overlap, so a miss here costs nothing.
 */
function libraryCollision(sourceId: number, destDir: string): string | null {
  const root = libraryRoot(sourceId);
  if (!root) return null;
  const dest = normalizePath(destDir);
  return dest === root || dest.startsWith(root + '/') ? root : null;
}

/** Overridden in settings; the default can collide with a server's library. */
export function downloadsRoot(configured?: string | null): string {
  const trimmed = (configured ?? '').trim();
  return trimmed || path.join(app.getPath('music'), app.getName());
}

// Characters Windows rejects in a path component. Both separators are in here,
// so a name like "AC/DC" from a server can't escape the folder we picked.
// eslint-disable-next-line no-control-regex
const UNSAFE_PATH_CHARS = /[<>:"|?*\\/\x00-\x1f]/g;

function safeSegment(value: string, fallback: string): string {
  const cleaned = value
    .replace(UNSAFE_PATH_CHARS, '_')
    // Windows silently drops a trailing dot or space, which would leave the DB
    // pointing at a path that doesn't exist.
    .replace(/[. ]+$/, '')
    .trim();
  // Path components cap at 255; leave room for the track number and extension.
  return cleaned.slice(0, 120) || fallback;
}

interface DownloadRow {
  Id: number;
  Uri: string;
  Title: string | null;
  TrackNumber: string | null;
  Extension: string | null;
  AlbumTitle: string | null;
  ArtistName: string | null;
}

function downloadRow(trackId: number): DownloadRow | null {
  return (
    (db
      .prepare(
        `SELECT Track.Id, Track.Uri, Track.Title, Track.TrackNumber, Track.Extension,
                Album.Title AS AlbumTitle, Artist.Name AS ArtistName
         FROM Track
         LEFT JOIN Album ON Track.AlbumId = Album.Id
         LEFT JOIN Artist ON Track.ArtistId = Artist.Id
         WHERE Track.Id = ?`
      )
      .get(trackId) as DownloadRow) ?? null
  );
}

export async function downloadTrack(
  trackId: number,
  configuredRoot?: string | null
): Promise<{ success: true; path: string } | { success: false; error: string }> {
  const r = resolve(trackId);
  const row = downloadRow(trackId);
  const provider = r && getProvider(r.type);
  if (!r || !provider || !row) {
    return { success: false, error: 'Not a track from a remote source' };
  }
  if (!/^https?:\/\//i.test(row.Uri)) return { success: true, path: row.Uri };

  const dir = path.join(
    downloadsRoot(configuredRoot),
    safeSegment(row.ArtistName ?? '', 'Unknown Artist'),
    safeSegment(row.AlbumTitle ?? '', 'Unknown Album')
  );
  const collision = libraryCollision(r.sourceId, dir);
  if (collision) {
    return {
      success: false,
      error:
        `Downloads would be written inside the server's own library (${collision}), ` +
        `so it would re-index them and every download would end up duplicated. ` +
        `Choose a different download folder in Settings.`,
    };
  }

  const trackNo = row.TrackNumber ? String(row.TrackNumber).padStart(2, '0') + ' ' : '';
  const ext = (row.Extension || 'mp3').replace(/^\./, '').toLowerCase();
  const dest = path.join(dir, `${trackNo}${safeSegment(row.Title ?? '', 'Untitled')}.${ext}`);

  try {
    fs.mkdirSync(dir, { recursive: true });
    const res = await fetch(provider.downloadUrl(r.credentials, r.remoteId));
    if (!res.ok) return { success: false, error: `Download failed (${res.status})` };
    // Write under a temp name first so an interrupted download can't leave a
    // truncated file that the DB then points at as if it were complete.
    const tmp = `${dest}.part`;
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    fs.renameSync(tmp, dest);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }

  db.prepare('UPDATE Track SET Uri = ? WHERE Id = ?').run(dest, trackId);
  return { success: true, path: dest };
}

export function removeDownload(trackId: number): { success: boolean; error?: string } {
  const r = resolve(trackId);
  const row = downloadRow(trackId);
  const provider = r && getProvider(r.type);
  if (!r || !provider || !row) {
    return { success: false, error: 'Not a track from a remote source' };
  }
  if (/^https?:\/\//i.test(row.Uri)) return { success: true };
  unlinkQuietly(row.Uri);
  db.prepare('UPDATE Track SET Uri = ? WHERE Id = ?').run(
    provider.streamUrl(r.credentials, r.remoteId),
    trackId
  );
  return { success: true };
}
