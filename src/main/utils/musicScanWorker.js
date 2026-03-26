/* eslint-disable import/no-unresolved */
/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const crypto = require('crypto');

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
      artist: metadata.common.artist || '',
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
  let row = db.prepare(`SELECT Id FROM ${table} WHERE ${column} = ?`).get(value);
  if (row) return row.Id;
  const cols = [column, ...Object.keys(extra)].join(', ');
  const vals = [value, ...Object.values(extra)];
  const placeholders = vals.map(() => '?').join(', ');
  const stmt = db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`);
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
  const artistId = musicInfo.tags.artist
    ? getOrCreate(db, 'Artist', 'Name', musicInfo.tags.artist)
    : null;
  const genreId = musicInfo.tags.genre
    ? getOrCreate(db, 'Genre', 'Name', musicInfo.tags.genre)
    : null;
  let albumId = null;
  if (musicInfo.tags.album) {
    albumId = getOrCreate(db, 'Album', 'Title', musicInfo.tags.album, {
      ArtistId: artistId,
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
    `INSERT INTO Track (Uri, Extension, Title, ArtistId, AlbumId, GenreId, TrackNumber, Year, AlbumArt, FileHash, Duration, BitRate, SampleRate, Channels, DiscNumber, ReleaseYear, DateAdded, Version, FolderPath)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    filePath,
    musicInfo.fileInfo.fileExt,
    trackTitle,
    artistId,
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
  return { artistId, albumId, genreId, albumArt, trackTitle };
}

function updateTrack(db, config, filePath, musicInfo, fileHash, trackId) {
  const artistId = musicInfo.tags.artist
    ? getOrCreate(db, 'Artist', 'Name', musicInfo.tags.artist)
    : null;
  const genreId = musicInfo.tags.genre
    ? getOrCreate(db, 'Genre', 'Name', musicInfo.tags.genre)
    : null;
  let albumId = null;
  if (musicInfo.tags.album) {
    albumId = getOrCreate(db, 'Album', 'Title', musicInfo.tags.album, {
      ArtistId: artistId,
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
    artistId,
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
}

function cleanupOrphans(db) {
  db.prepare(
    'DELETE FROM Album WHERE Id NOT IN (SELECT AlbumId FROM Track WHERE AlbumId IS NOT NULL)'
  ).run();
  db.prepare(
    'DELETE FROM Artist WHERE Id NOT IN (SELECT ArtistId FROM Track WHERE ArtistId IS NOT NULL)'
  ).run();
  db.prepare(
    'DELETE FROM Genre WHERE Id NOT IN (SELECT GenreId FROM Track WHERE GenreId IS NOT NULL)'
  ).run();
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
  if (removed > 0) {
    console.log(`[basic-scan] Removed ${removed} deleted track(s).`);
    cleanupOrphans(db);
  }

  console.log(`[basic-scan] Done. Inserted ${scanned} new track(s), removed ${removed}.`);
  return scanned;
}

// ─── Full rescan ──────────────────────────────────────────────────────────────
// Hashes + parses every file, inserts new and updates changed, removes stale.

async function runFullScan(db, folders, config, supportedFileTypes) {
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
  cleanupOrphans(db);

  console.log(`[full-scan] Done. Processed ${scanned} new/updated track(s).`);
  return scanned;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

process.on('message', async ({ folders, config, mode }) => {
  const isFullScan = mode === 'full';
  console.log(`Starting music scan worker (mode: ${isFullScan ? 'full' : 'basic'})...`);

  const dbPath = path.join(config.APP_CONF_FOLDER, 'data.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  const supportedFileTypes = ['.mp3', '.wav', '.ogg', '.aac', '.flac', '.webm', '.m4a'];

  try {
    const scanned = isFullScan
      ? await runFullScan(db, folders, config, supportedFileTypes)
      : await runBasicScan(db, folders, config, supportedFileTypes);

    process.send({ success: true, scanned });
    process.exit(0);
  } catch (error) {
    process.send({ success: false, error: error.message });
    process.exit(1);
  }
});
