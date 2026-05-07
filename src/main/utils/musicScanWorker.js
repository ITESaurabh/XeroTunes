/* eslint-disable import/no-unresolved */
/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const crypto = require('crypto');

let multiArtistSeparators = [',', '&'];
let multiArtistExceptions = ['AC/DC', '+/-'];

function applyLibrarySettings(librarySettings) {
  if (!librarySettings) return;
  if (Array.isArray(librarySettings.multiArtistSeparators)) {
    multiArtistSeparators = librarySettings.multiArtistSeparators;
  }
  if (Array.isArray(librarySettings.multiArtistExceptions)) {
    multiArtistExceptions = librarySettings.multiArtistExceptions;
  }
}

// Cache the ESM import so it's resolved once for all files
let mmPromise = null;
function getMM() {
  if (!mmPromise) {
    mmPromise = import('music-metadata').catch(err => {
      console.error('[worker] Failed to import music-metadata:', err);
      process.send({
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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeArtistName(raw) {
  if (!raw) return '';

  if (typeof raw === 'object') {
    if (typeof raw.name === 'string' && raw.name.trim()) {
      return raw.name.trim().replace(/\s+/g, ' ');
    }
    if (typeof raw.artist === 'string' && raw.artist.trim()) {
      return raw.artist.trim().replace(/\s+/g, ' ');
    }
    return String(raw).trim().replace(/\s+/g, ' ');
  }

  return String(raw).trim().replace(/\s+/g, ' ');
}

function splitArtists(rawArtist) {
  const artistList = [];

  if (!rawArtist) return artistList;

  if (Array.isArray(rawArtist)) {
    rawArtist.forEach(item => {
      const normalized = normalizeArtistName(item);
      if (normalized) artistList.push(normalized);
    });
  } else {
    artistList.push(normalizeArtistName(rawArtist));
  }

  // Flatten comma/ampersand separators but preserve exceptions (AC/DC, +/- etc.)
  const result = [];

  artistList.forEach(raw => {
    const normalized = normalizeArtistName(raw);
    if (!normalized) return;

    if (multiArtistExceptions.some(exc => exc.toLowerCase() === normalized.toLowerCase())) {
      result.push(normalized);
      return;
    }

    const sepPattern = multiArtistSeparators.map(escapeRegex).join('|');
    const pieces = normalized.split(new RegExp(`\\s*(?:${sepPattern})\\s*`, 'g'));

    if (pieces.length > 1) {
      pieces.forEach(piece => {
        const p = normalizeArtistName(piece);
        if (p && !multiArtistExceptions.some(exc => exc.toLowerCase() === p.toLowerCase())) {
          result.push(p);
        } else if (p) {
          result.push(p);
        }
      });
    } else {
      result.push(normalized);
    }
  });

  return [...new Set(result.filter(Boolean))];
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

function insertTrack(db, config, filePath, musicInfo, fileHash) {
  const allArtistNames = splitArtists(musicInfo.tags.artist);
  const primaryArtistName = allArtistNames[0] || '';
  const primaryArtistId = primaryArtistName
    ? getOrCreate(db, 'Artist', 'Name', primaryArtistName)
    : null;

  const artistIds = new Set();
  if (allArtistNames.length > 0) {
    allArtistNames.forEach(name => {
      if (!name) return;
      const id = getOrCreate(db, 'Artist', 'Name', name);
      artistIds.add(id);
    });
  } else if (primaryArtistId) {
    artistIds.add(primaryArtistId);
  }

  const genreId = musicInfo.tags.genre
    ? getOrCreate(db, 'Genre', 'Name', musicInfo.tags.genre)
    : null;

  const albumArtistNames = splitArtists(musicInfo.tags.albumArtist);
  const primaryAlbumArtistName = albumArtistNames[0] || '';
  const primaryAlbumArtistId = primaryAlbumArtistName
    ? getOrCreate(db, 'Artist', 'Name', primaryAlbumArtistName)
    : null;

  const albumArtistIds = new Set();
  if (albumArtistNames.length > 0) {
    albumArtistNames.forEach(name => {
      if (!name) return;
      const id = getOrCreate(db, 'Artist', 'Name', name);
      albumArtistIds.add(id);
    });
  } else if (primaryAlbumArtistId) {
    albumArtistIds.add(primaryAlbumArtistId);
  }

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
      `INSERT INTO Track (Uri, Extension, Title, ArtistId, AlbumId, GenreId, TrackNumber, Year, AlbumArt, FileHash, Duration, BitRate, SampleRate, Channels, DiscNumber, ReleaseYear, DateAdded, Version, FolderPath)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      folderpath
    );

  const trackId = trackInfo.lastInsertRowid;

  if (trackId && artistIds.size > 0) {
    const insertTrackArtist = db.prepare(
      `INSERT OR IGNORE INTO TrackArtist (TrackId, ArtistId) VALUES (?, ?)`
    );
    for (const aid of artistIds) {
      insertTrackArtist.run(trackId, aid);
    }
  }

  if (albumId && albumArtistIds.size > 0) {
    const insertAlbumArtist = db.prepare(
      `INSERT OR IGNORE INTO AlbumArtist (AlbumId, ArtistId) VALUES (?, ?)`
    );
    for (const aid of albumArtistIds) {
      insertAlbumArtist.run(albumId, aid);
    }
  }

  return {
    artistId: primaryArtistId,
    albumId,
    genreId,
    albumArt,
    trackTitle,
  };
}

function updateTrack(db, config, filePath, musicInfo, fileHash, trackId) {
  const allArtistNames = splitArtists(musicInfo.tags.artist);
  const primaryArtistName = allArtistNames[0] || '';
  const primaryArtistId = primaryArtistName
    ? getOrCreate(db, 'Artist', 'Name', primaryArtistName)
    : null;

  const artistIds = new Set();
  if (allArtistNames.length > 0) {
    allArtistNames.forEach(name => {
      if (!name) return;
      const id = getOrCreate(db, 'Artist', 'Name', name);
      artistIds.add(id);
    });
  } else if (primaryArtistId) {
    artistIds.add(primaryArtistId);
  }

  const genreId = musicInfo.tags.genre
    ? getOrCreate(db, 'Genre', 'Name', musicInfo.tags.genre)
    : null;

  const albumArtistNames = splitArtists(musicInfo.tags.albumArtist);
  const primaryAlbumArtistName = albumArtistNames[0] || '';
  const primaryAlbumArtistId = primaryAlbumArtistName
    ? getOrCreate(db, 'Artist', 'Name', primaryAlbumArtistName)
    : null;

  const albumArtistIds = new Set();
  if (albumArtistNames.length > 0) {
    albumArtistNames.forEach(name => {
      if (!name) return;
      const id = getOrCreate(db, 'Artist', 'Name', name);
      albumArtistIds.add(id);
    });
  } else if (primaryAlbumArtistId) {
    albumArtistIds.add(primaryAlbumArtistId);
  }

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

  db.prepare(
    `UPDATE Track SET Extension = ?, Title = ?, ArtistId = ?, AlbumId = ?, GenreId = ?, TrackNumber = ?, Year = ?, AlbumArt = ?, FileHash = ?, Duration = ?, BitRate = ?, SampleRate = ?, Channels = ?, DiscNumber = ?, ReleaseYear = ?, DateAdded = ?, Version = ?, FolderPath = ? WHERE Id = ?`
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
    Date.now(),
    1,
    folderpath,
    trackId
  );

  if (trackId) {
    db.prepare('DELETE FROM TrackArtist WHERE TrackId = ?').run(trackId);
    const insertTrackArtist = db.prepare(
      `INSERT OR IGNORE INTO TrackArtist (TrackId, ArtistId) VALUES (?, ?)`
    );
    for (const aid of artistIds) {
      insertTrackArtist.run(trackId, aid);
    }
  }

  if (albumId) {
    db.prepare('DELETE FROM AlbumArtist WHERE AlbumId = ?').run(albumId);
    const insertAlbumArtist = db.prepare(
      `INSERT OR IGNORE INTO AlbumArtist (AlbumId, ArtistId) VALUES (?, ?)`
    );
    for (const aid of albumArtistIds) {
      insertAlbumArtist.run(albumId, aid);
    }
  }
}

// Sweep an art directory: remove every <id>.jpg whose id is not in liveIds.
// Authoritative — catches both freshly-orphaned files and any leftovers from
// earlier scans / older builds that didn't clean up properly.
function sweepOrphanArt(dir, liveIds) {
  if (!dir) return 0;
  let removed = 0;
  try {
    if (!fs.existsSync(dir)) return 0;
    const live = liveIds instanceof Set ? liveIds : new Set(liveIds);
    for (const file of fs.readdirSync(dir)) {
      // Only consider <number>.jpg — leave anything else untouched.
      const m = /^(\d+)\.jpg$/i.exec(file);
      if (!m) continue;
      const id = Number(m[1]);
      if (live.has(id)) continue;
      try {
        fs.unlinkSync(path.join(dir, file));
        removed++;
      } catch (err) {
        console.warn('[cleanup] Failed to remove', file, err?.message || err);
      }
    }
  } catch (err) {
    console.warn('[cleanup] Sweep failed for', dir, err?.message || err);
  }
  return removed;
}

function cleanupOrphans(db, config = {}) {
  db.prepare(
    'DELETE FROM Album WHERE Id NOT IN (SELECT AlbumId FROM Track WHERE AlbumId IS NOT NULL)'
  ).run();
  db.prepare('DELETE FROM TrackArtist WHERE TrackId NOT IN (SELECT Id FROM Track)').run();
  db.prepare('DELETE FROM AlbumArtist WHERE AlbumId NOT IN (SELECT Id FROM Album)').run();
  db.prepare('DELETE FROM AlbumArtist WHERE ArtistId NOT IN (SELECT Id FROM Artist)').run();
  db.prepare(
    `DELETE FROM Artist
     WHERE Id NOT IN (
       SELECT ArtistId FROM TrackArtist WHERE ArtistId IS NOT NULL
       UNION
       SELECT ArtistId FROM AlbumArtist WHERE ArtistId IS NOT NULL
     )`
  ).run();
  db.prepare(
    'DELETE FROM Genre WHERE Id NOT IN (SELECT GenreId FROM Track WHERE GenreId IS NOT NULL)'
  ).run();

  // Now that the DB reflects reality, delete any cover/profile art file whose
  // owning row no longer exists. We diff disk against the DB rather than
  // tracking which rows we just deleted, so this also fixes art left behind
  // by older scan logic that never cleaned up.
  const liveAlbumIds = db.prepare('SELECT Id FROM Album').all().map(r => r.Id);
  const liveArtistIds = db.prepare('SELECT Id FROM Artist').all().map(r => r.Id);
  const albumArtRemoved = sweepOrphanArt(config.ALBUM_ART_DIR, liveAlbumIds);
  const artistArtRemoved = sweepOrphanArt(config.ARTIST_ART_DIR, liveArtistIds);
  if (albumArtRemoved > 0 || artistArtRemoved > 0) {
    console.log(
      `[cleanup] Removed ${albumArtRemoved} album art file(s), ${artistArtRemoved} artist art file(s).`
    );
  }
}

// ─── Basic (optimistic) scan ─────────────────────────────────────────────────
// Only processes files that are NOT already tracked. Cheap deletion check via
// fs.existsSync so it never reads/hashes unchanged files.

async function runBasicScan(db, folders, config, supportedFileTypes) {
  // Build set of known URIs from DB for O(1) lookups
  const knownTracks = db.prepare('SELECT Id, Uri FROM Track').all();
  const knownUriSet = new Set(knownTracks.map(t => t.Uri));

  // Collect only NEW files (not in DB)
  let newFiles = [];
  for (const folder of folders) {
    const all = getAllSupportedFiles(folder.Uri, supportedFileTypes);
    for (const f of all) {
      if (!knownUriSet.has(f)) newFiles.push(f);
    }
  }

  const total = newFiles.length;
  let scanned = 0;
  let processed = 0;
  process.send({ type: 'progress', scanned: 0, total });

  for (const filePath of newFiles) {
    try {
      const fileHash = await getFileHash(filePath);
      const musicInfo = await parseMusicWorker(filePath);
      insertTrack(db, config, filePath, musicInfo, fileHash);
      scanned++;
    } catch (err) {
      console.error('[basic-scan] Insert error:', filePath, err?.message || err);
      process.send({ type: 'file-error', file: filePath, error: String(err?.message || err) });
    }
    processed++;
    process.send({ type: 'progress', scanned, total, processed });
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

  let allFiles = [];
  for (const folder of folders) {
    allFiles = allFiles.concat(getAllSupportedFiles(folder.Uri, supportedFileTypes));
  }
  const total = allFiles.length;
  let scanned = 0;
  let processed = 0;
  process.send({ type: 'progress', scanned: 0, total });

  for (const folder of folders) {
    const supportedFiles = getAllSupportedFiles(folder.Uri, supportedFileTypes);
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
        process.send({ type: 'file-error', file: filePath, error: String(err?.message || err) });
      }
      processed++;
      process.send({ type: 'progress', scanned, total, processed });
    }
    console.log(
      `[full-scan] ${folderScanned}/${supportedFiles.length} files updated in: ${folder.Uri}`
    );
  }

  // Remove tracks whose files no longer exist
  let validPaths = new Set();
  for (const folder of folders) {
    for (const f of getAllSupportedFiles(folder.Uri, supportedFileTypes)) {
      validPaths.add(f);
    }
  }
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

// ─── Entry point ─────────────────────────────────────────────────────────────

process.on('message', async ({ folders, config, mode, librarySettings }) => {
  applyLibrarySettings(librarySettings);

  const isFullScan = mode === 'full';
  console.log(`Starting music scan worker (mode: ${isFullScan ? 'full' : 'basic'})...`);

  const dbPath = path.join(config.APP_CONF_FOLDER, 'data.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  const supportedFileTypes = ['.mp3', '.wav', '.ogg', '.aac', '.flac', '.webm', '.m4a'];

  try {
    const result = isFullScan
      ? await runFullScan(db, folders, config, supportedFileTypes)
      : await runBasicScan(db, folders, config, supportedFileTypes);

    process.send({ success: true, scanned: result.scanned, removed: result.removed });
    process.exit(0);
  } catch (error) {
    process.send({ success: false, error: error.message });
    process.exit(1);
  }
});
