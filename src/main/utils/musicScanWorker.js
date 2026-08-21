/* eslint-disable import/no-unresolved */
/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const { cleanupOrphans } = require('../db/cleanup');
const { applyLibrarySettings, splitArtists } = require('./libraryRules');

// Cache the ESM import so it's resolved once for all files
let mmPromise = null;
function getMM() {
  if (!mmPromise) {
    mmPromise = import('music-metadata').catch(err => {
      console.error('[worker] Failed to import music-metadata:', err);
      process.parentPort.postMessage({
        type: 'file-error',
        file: 'music-metadata import',
        error: String(err?.message || err),
      });
      throw err;
    });
  }
  return mmPromise;
}

function normalizeTrackNumber(track) {
  if (track === null || track === undefined || track === '') return null;
  const trackStr = String(track);
  const numPart = trackStr.split('/')[0];
  const parsed = parseInt(numPart, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

async function parseMusicWorker(filePath) {
  const mm = await getMM();
  const metadata = await mm.parseFile(filePath);
  const picture = metadata.common.picture?.[0] || null;
  return {
    fileInfo: {
      tagType: metadata.format.tagTypes?.[0] || '',
      path: filePath,
      fileName: path.parse(filePath).name,
      fileExt: path.parse(filePath).ext,
      fileSize: fs.statSync(filePath).size,
      folderName: path.parse(path.parse(filePath).dir).base,
      folderpath: path.parse(filePath).dir,
    },
    tags: {
      title: metadata.common.title || '',
      artist: metadata.common.artist || metadata.common.artists || '',
      albumArtist:
        metadata.common.albumartist ||
        metadata.common.albumArtist ||
        metadata.common.albumartists ||
        '',
      album: metadata.common.album || '',
      track: normalizeTrackNumber(metadata.common.track?.no ?? null),
      genre: metadata.common.genre?.length ? metadata.common.genre.join(', ') : '',
      year: metadata.common.year ? String(metadata.common.year) : '',
      albumArt: '',
      picture: picture,
      duration: Math.round(metadata.format.duration || 0),
      bitrate: metadata.format.bitrate ? Math.round(metadata.format.bitrate) : null,
      sampleRate: metadata.format.sampleRate || null,
      channels: metadata.format.numberOfChannels || null,
      discNumber: metadata.common.disk?.no || null,
      releaseYear: metadata.common.year || null,
    },
  };
}

function getOrCreate(db, table, column, value, extra = {}) {
  const selectCols = extra.ReleaseYear != null ? 'Id, ReleaseYear' : 'Id';
  let row = db
    .prepare(`SELECT ${selectCols} FROM ${table} WHERE ${column} = ? COLLATE NOCASE`)
    .get(value);
  if (row) {
    if (extra.ReleaseYear != null && row.ReleaseYear == null) {
      db.prepare(`UPDATE ${table} SET ReleaseYear = ? WHERE Id = ?`).run(extra.ReleaseYear, row.Id);
    }
    return row.Id;
  }
  const cols = [column, ...Object.keys(extra)].join(', ');
  const vals = [value, ...Object.values(extra)];
  const placeholders = vals.map(() => '?').join(', ');
  const stmt = db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`);
  const info = stmt.run(...vals);
  return info.lastInsertRowid;
}

function getOrCreateAlbum(db, title, artistId, extra = {}) {
  if (!title) return null;
  const selectCols = extra.ReleaseYear != null ? 'Id, ReleaseYear' : 'Id';
  const row = db
    .prepare(
      `SELECT ${selectCols} FROM Album WHERE Title = ? COLLATE NOCASE AND ((ArtistId = ?) OR (ArtistId IS NULL AND ? IS NULL))`
    )
    .get(title, artistId, artistId);
  if (row) {
    if (extra.ReleaseYear != null && row.ReleaseYear == null) {
      db.prepare('UPDATE Album SET ReleaseYear = ? WHERE Id = ?').run(extra.ReleaseYear, row.Id);
    }
    return row.Id;
  }
  const cols = ['Title', ...Object.keys(extra)].join(', ');
  const vals = [title, ...Object.values(extra)];
  const placeholders = vals.map(() => '?').join(', ');
  const stmt = db.prepare(`INSERT INTO Album (${cols}) VALUES (${placeholders})`);
  const info = stmt.run(...vals);
  return info.lastInsertRowid;
}

function getFileHash(filePath) {
  const hash = crypto.createHash('sha1');
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// Without this, files the user dropped but kept on disk get re-added by the next scan.
function ignoredUriSet(db) {
  try {
    return new Set(
      db
        .prepare('SELECT Uri FROM IgnoredTrack')
        .all()
        .map(r => r.Uri)
    );
  } catch {
    return new Set();
  }
}

function getAllSupportedFiles(dir, supportedFileTypes) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      results = results.concat(getAllSupportedFiles(filePath, supportedFileTypes));
    } else {
      const ext = path.extname(filePath).toLowerCase();
      if (supportedFileTypes.includes(ext)) {
        results.push(filePath);
      }
    }
  }
  return results;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

// Kept verbatim as JSON (music-metadata hands back either a string or an array)
// so separator/exception changes can be re-applied without re-reading the file.
function rawTagJson(raw) {
  return JSON.stringify(raw ?? '');
}

// NULL means the row predates raw-tag storage and needs a backfill; a track with
// no artist tag stores '""', so it isn't re-read on every pass.
function parseRawTag(json) {
  if (!json) return '';
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

function resolveArtists(db, rawTag) {
  const names = splitArtists(rawTag).filter(Boolean);
  const ids = new Set(names.map(name => getOrCreate(db, 'Artist', 'Name', name)));
  return { primaryId: names[0] ? getOrCreate(db, 'Artist', 'Name', names[0]) : null, ids };
}

// Delete-then-insert: the caller recomputed the full artist set, so a partial
// update would leave stale rows behind.
function writeArtistLinks(db, trackId, albumId, artistIds, albumArtistIds) {
  if (trackId) {
    db.prepare('DELETE FROM TrackArtist WHERE TrackId = ?').run(trackId);
    const insert = db.prepare(
      'INSERT OR IGNORE INTO TrackArtist (TrackId, ArtistId) VALUES (?, ?)'
    );
    for (const aid of artistIds) insert.run(trackId, aid);
  }
  if (albumId) {
    db.prepare('DELETE FROM AlbumArtist WHERE AlbumId = ?').run(albumId);
    const insert = db.prepare(
      'INSERT OR IGNORE INTO AlbumArtist (AlbumId, ArtistId) VALUES (?, ?)'
    );
    for (const aid of albumArtistIds) insert.run(albumId, aid);
  }
}

function insertTrack(db, config, filePath, musicInfo, fileHash) {
  const { primaryId: primaryArtistId, ids: artistIds } = resolveArtists(db, musicInfo.tags.artist);

  const genreId = musicInfo.tags.genre
    ? getOrCreate(db, 'Genre', 'Name', musicInfo.tags.genre)
    : null;

  const { primaryId: primaryAlbumArtistId, ids: albumArtistIds } = resolveArtists(
    db,
    musicInfo.tags.albumArtist
  );

  let albumId = null;
  if (musicInfo.tags.album) {
    albumId = getOrCreateAlbum(db, musicInfo.tags.album, primaryAlbumArtistId, {
      ArtistId: primaryAlbumArtistId,
      GenreId: genreId,
    });
  }
  let albumArt = '';
  if (albumId && musicInfo.tags.picture) {
    const albumArtPath = path.join(config.ALBUM_ART_DIR, `${albumId}.jpg`);
    if (!fs.existsSync(albumArtPath)) {
      fs.writeFileSync(String(albumArtPath), Buffer.from(musicInfo.tags.picture.data));
    }
    albumArt = albumArtPath;
  }
  const folderpath = path.parse(filePath).dir;
  const trackTitle =
    musicInfo.tags.title && musicInfo.tags.title.trim()
      ? musicInfo.tags.title
      : musicInfo.fileInfo.fileName;

  const trackInfo = db
    .prepare(
      `INSERT INTO Track (Uri, Extension, Title, ArtistId, AlbumId, GenreId, TrackNumber, Year, AlbumArt, FileHash, Duration, BitRate, SampleRate, Channels, DiscNumber, ReleaseYear, DateAdded, Version, FolderPath, RawArtist, RawAlbumArtist)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      filePath,
      musicInfo.fileInfo.fileExt,
      trackTitle,
      primaryArtistId,
      albumId,
      genreId,
      musicInfo.tags.track,
      musicInfo.tags.year,
      albumArt,
      fileHash,
      musicInfo.tags.duration || null,
      musicInfo.tags.bitrate,
      musicInfo.tags.sampleRate,
      musicInfo.tags.channels,
      musicInfo.tags.discNumber,
      musicInfo.tags.releaseYear,
      Date.now(),
      1,
      folderpath,
      rawTagJson(musicInfo.tags.artist),
      rawTagJson(musicInfo.tags.albumArtist)
    );

  const trackId = trackInfo.lastInsertRowid;
  writeArtistLinks(db, trackId, albumId, artistIds, albumArtistIds);

  return {
    artistId: primaryArtistId,
    albumId,
    genreId,
    albumArt,
    trackTitle,
  };
}

function updateTrack(db, config, filePath, musicInfo, fileHash, trackId) {
  const { primaryId: primaryArtistId, ids: artistIds } = resolveArtists(db, musicInfo.tags.artist);

  const genreId = musicInfo.tags.genre
    ? getOrCreate(db, 'Genre', 'Name', musicInfo.tags.genre)
    : null;

  const { primaryId: primaryAlbumArtistId, ids: albumArtistIds } = resolveArtists(
    db,
    musicInfo.tags.albumArtist
  );

  let albumId = null;
  if (musicInfo.tags.album) {
    albumId = getOrCreateAlbum(db, musicInfo.tags.album, primaryAlbumArtistId, {
      ArtistId: primaryAlbumArtistId,
      GenreId: genreId,
    });
  }
  let albumArt = '';
  if (albumId && musicInfo.tags.picture) {
    const albumArtPath = path.join(config.ALBUM_ART_DIR, `${albumId}.jpg`);
    if (!fs.existsSync(albumArtPath)) {
      fs.writeFileSync(String(albumArtPath), Buffer.from(musicInfo.tags.picture.data));
    }
    albumArt = albumArtPath;
  }
  // A cover written for this track alone outranks the album's shared one; it
  // exists because a tag edit had to leave the rest of the album untouched.
  const trackArtPath = path.join(config.ALBUM_ART_DIR, `track-${trackId}.jpg`);
  if (musicInfo.tags.picture && fs.existsSync(trackArtPath)) {
    albumArt = trackArtPath;
  }
  const folderpath = path.parse(filePath).dir;
  const trackTitle =
    musicInfo.tags.title && musicInfo.tags.title.trim()
      ? musicInfo.tags.title
      : musicInfo.fileInfo.fileName;

  // DateAdded is deliberately not touched: it is when the track entered the
  // library, not when it was last read, and Recently Added sorts on it.
  db.prepare(
    `UPDATE Track SET Extension = ?, Title = ?, ArtistId = ?, AlbumId = ?, GenreId = ?, TrackNumber = ?, Year = ?, AlbumArt = ?, FileHash = ?, Duration = ?, BitRate = ?, SampleRate = ?, Channels = ?, DiscNumber = ?, ReleaseYear = ?, Version = ?, FolderPath = ?, RawArtist = ?, RawAlbumArtist = ? WHERE Id = ?`
  ).run(
    musicInfo.fileInfo.fileExt,
    trackTitle,
    primaryArtistId,
    albumId,
    genreId,
    musicInfo.tags.track,
    musicInfo.tags.year,
    albumArt,
    fileHash,
    musicInfo.tags.duration || null,
    musicInfo.tags.bitrate,
    musicInfo.tags.sampleRate,
    musicInfo.tags.channels,
    musicInfo.tags.discNumber,
    musicInfo.tags.releaseYear,
    1,
    folderpath,
    rawTagJson(musicInfo.tags.artist),
    rawTagJson(musicInfo.tags.albumArtist),
    trackId
  );

  writeArtistLinks(db, trackId, albumId, artistIds, albumArtistIds);
}

// ─── Basic (optimistic) scan ─────────────────────────────────────────────────
// Only processes files that are NOT already tracked. Cheap deletion check via
// fs.existsSync so it never reads/hashes unchanged files.

async function runBasicScan(db, folders, config, supportedFileTypes) {
  // Build set of known URIs from DB for O(1) lookups
  const knownTracks = db.prepare('SELECT Id, Uri FROM Track').all();
  const knownUriSet = new Set(knownTracks.map(t => t.Uri));
  const ignored = ignoredUriSet(db);

  // Collect only NEW files (not in DB)
  let newFiles = [];
  for (const folder of folders) {
    const all = getAllSupportedFiles(folder.Uri, supportedFileTypes);
    for (const f of all) {
      if (!knownUriSet.has(f) && !ignored.has(f)) newFiles.push(f);
    }
  }

  const total = newFiles.length;
  let scanned = 0;
  let processed = 0;
  process.parentPort.postMessage({ type: 'progress', scanned: 0, total });

  for (const filePath of newFiles) {
    try {
      const fileHash = await getFileHash(filePath);
      const musicInfo = await parseMusicWorker(filePath);
      insertTrack(db, config, filePath, musicInfo, fileHash);
      scanned++;
    } catch (err) {
      console.error('[basic-scan] Insert error:', filePath, err?.message || err);
      process.parentPort.postMessage({
        type: 'file-error',
        file: filePath,
        error: String(err?.message || err),
      });
    }
    processed++;
    process.parentPort.postMessage({ type: 'progress', scanned, total, processed });
  }

  // Cheap deletion pass: check if tracked files still exist on disk
  let removed = 0;
  for (const track of knownTracks) {
    if (!fs.existsSync(track.Uri)) {
      db.prepare('DELETE FROM Track WHERE Id = ?').run(track.Id);
      removed++;
    }
  }
  if (removed > 0) console.log(`[basic-scan] Removed ${removed} deleted track(s).`);
  // Always run — also handles orphan art files left behind by older scans.
  cleanupOrphans(db, config);

  console.log(`[basic-scan] Done. Inserted ${scanned} new track(s), removed ${removed}.`);
  return { scanned, removed };
}

// ─── Full rescan ──────────────────────────────────────────────────────────────
// Hashes + parses every file, inserts new and updates changed, removes stale.

async function runFullScan(db, folders, config, supportedFileTypes) {
  // Rebuild album artist relationships from current file metadata.
  // This clears stale associations that may have been created by older scan logic.
  db.prepare('DELETE FROM AlbumArtist').run();

  const ignored = ignoredUriSet(db);
  const filesByFolder = new Map(
    folders.map(folder => [
      folder.Uri,
      getAllSupportedFiles(folder.Uri, supportedFileTypes).filter(f => !ignored.has(f)),
    ])
  );
  const total = [...filesByFolder.values()].reduce((n, files) => n + files.length, 0);
  let scanned = 0;
  let processed = 0;
  process.parentPort.postMessage({ type: 'progress', scanned: 0, total });

  for (const folder of folders) {
    const supportedFiles = filesByFolder.get(folder.Uri);
    let folderScanned = 0;
    for (const filePath of supportedFiles) {
      try {
        const fileHash = await getFileHash(filePath);
        const trackRow = db.prepare('SELECT Id FROM Track WHERE Uri = ?').get(filePath);
        const musicInfo = await parseMusicWorker(filePath);
        if (!trackRow) {
          insertTrack(db, config, filePath, musicInfo, fileHash);
        } else {
          updateTrack(db, config, filePath, musicInfo, fileHash, trackRow.Id);
        }
        scanned++;
        folderScanned++;
      } catch (err) {
        console.error('[full-scan] DB Insert/Update Error:', filePath, err?.message || err);
        process.parentPort.postMessage({
          type: 'file-error',
          file: filePath,
          error: String(err?.message || err),
        });
      }
      processed++;
      process.parentPort.postMessage({ type: 'progress', scanned, total, processed });
    }
    console.log(
      `[full-scan] ${folderScanned}/${supportedFiles.length} files updated in: ${folder.Uri}`
    );
  }

  // validPaths already excludes ignored files, so those get dropped here too.
  const validPaths = new Set([...filesByFolder.values()].flat());
  const allTracks = db.prepare('SELECT Id, Uri FROM Track').all();
  let removed = 0;
  for (const track of allTracks) {
    if (!validPaths.has(track.Uri)) {
      db.prepare('DELETE FROM Track WHERE Id = ?').run(track.Id);
      removed++;
    }
  }
  if (removed > 0) console.log(`[full-scan] Removed ${removed} stale track(s).`);
  cleanupOrphans(db, config);

  console.log(`[full-scan] Done. Processed ${scanned} new/updated track(s).`);
  return { scanned, removed };
}

// ─── Targeted file re-index ──────────────────────────────────────────
// Re-reads an explicit list of files after the tag editor changed them on disk.
// No directory walk and no deletion pass; the caller names its targets.

async function runFileScan(db, files, config) {
  const total = files.length;
  let scanned = 0;
  let processed = 0;
  process.parentPort.postMessage({ type: 'progress', scanned: 0, total });

  for (const filePath of files) {
    try {
      if (fs.existsSync(filePath)) {
        const fileHash = await getFileHash(filePath);
        const trackRow = db.prepare('SELECT Id FROM Track WHERE Uri = ?').get(filePath);
        const musicInfo = await parseMusicWorker(filePath);
        if (!trackRow) {
          insertTrack(db, config, filePath, musicInfo, fileHash);
        } else {
          updateTrack(db, config, filePath, musicInfo, fileHash, trackRow.Id);
        }
        scanned++;
      }
    } catch (err) {
      console.error('[file-scan] Re-index error:', filePath, err?.message || err);
      process.parentPort.postMessage({
        type: 'file-error',
        file: filePath,
        error: String(err?.message || err),
      });
    }
    processed++;
    process.parentPort.postMessage({ type: 'progress', scanned, total, processed });
  }

  // An edit can empty out the album/artist/genre the tracks used to belong to.
  cleanupOrphans(db, config);
  console.log(`[file-scan] Re-indexed ${scanned}/${total} file(s).`);
  return { scanned, removed: 0 };
}

// ─── Artist rules re-apply ────────────────────────────────────────────────────
// Re-splits stored artist tags under the current separators/exceptions. No file
// reads once RawArtist is populated, which is what makes it cheap enough to run
// on every settings change instead of forcing a full rescan.

async function readRawArtistTags(filePath) {
  const mm = await getMM();
  const md = await mm.parseFile(filePath, { skipCovers: true });
  return {
    artist: md.common.artist || md.common.artists || '',
    albumArtist: md.common.albumartist || md.common.albumArtist || md.common.albumartists || '',
  };
}

async function runArtistRules(db, config) {
  const tracks = db.prepare('SELECT Id, Uri, AlbumId, RawArtist, RawAlbumArtist FROM Track').all();
  const total = tracks.length;
  let scanned = 0;
  let processed = 0;
  process.parentPort.postMessage({ type: 'progress', scanned: 0, total });

  const setRaw = db.prepare('UPDATE Track SET RawArtist = ?, RawAlbumArtist = ? WHERE Id = ?');
  const setTrackArtist = db.prepare('UPDATE Track SET ArtistId = ? WHERE Id = ?');
  const setAlbumArtist = db.prepare('UPDATE Album SET ArtistId = ? WHERE Id = ?');

  for (const track of tracks) {
    try {
      let { RawArtist, RawAlbumArtist } = track;
      // Libraries scanned by an older build have no raw tags; read them once.
      if (RawArtist === null && RawAlbumArtist === null) {
        const tags = await readRawArtistTags(track.Uri);
        RawArtist = rawTagJson(tags.artist);
        RawAlbumArtist = rawTagJson(tags.albumArtist);
        setRaw.run(RawArtist, RawAlbumArtist, track.Id);
      }

      const artists = resolveArtists(db, parseRawTag(RawArtist));
      const albumArtists = resolveArtists(db, parseRawTag(RawAlbumArtist));

      setTrackArtist.run(artists.primaryId, track.Id);
      // Albums are looked up by (Title, ArtistId) on the next scan, so the
      // primary has to move with the split or that scan creates a duplicate.
      if (track.AlbumId) setAlbumArtist.run(albumArtists.primaryId, track.AlbumId);
      writeArtistLinks(db, track.Id, track.AlbumId, artists.ids, albumArtists.ids);
      scanned++;
    } catch (err) {
      console.error('[artist-rules] Failed for:', track.Uri, err?.message || err);
      process.parentPort.postMessage({
        type: 'file-error',
        file: track.Uri,
        error: String(err?.message || err),
      });
    }
    processed++;
    process.parentPort.postMessage({ type: 'progress', scanned, total, processed });
  }

  // Drops artists left with no tracks after an exception merged them back.
  cleanupOrphans(db, config);
  console.log(`[artist-rules] Re-applied to ${scanned}/${total} track(s).`);
  return { scanned, removed: 0 };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

// utilityProcess IPC arrives on parentPort, wrapped as { data }.
async function handleScanRequest({ data }) {
  const { folders, config, mode, librarySettings } = data;
  applyLibrarySettings(librarySettings);

  console.log(`Starting music scan worker (mode: ${mode || 'basic'})...`);

  const dbPath = path.join(config.APP_CONF_FOLDER, 'data.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  const supportedFileTypes = ['.mp3', '.wav', '.ogg', '.opus', '.aac', '.flac', '.webm', '.m4a'];

  try {
    let result;
    if (mode === 'files') {
      result = await runFileScan(db, data.files || [], config);
    } else if (mode === 'artists') {
      result = await runArtistRules(db, config);
    } else if (mode === 'full') {
      result = await runFullScan(db, folders, config, supportedFileTypes);
    } else {
      result = await runBasicScan(db, folders, config, supportedFileTypes);
    }

    process.parentPort.postMessage({
      success: true,
      scanned: result.scanned,
      removed: result.removed,
    });
    process.exit(0);
  } catch (error) {
    process.parentPort.postMessage({ success: false, error: error.message });
    process.exit(1);
  }
}

process.parentPort.on('message', handleScanRequest);
