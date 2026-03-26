import { BrowserWindow, dialog, ipcMain, nativeTheme, screen } from 'electron';
import { prevIcon, nextIcon, playIcon, pauseIcon } from '../thumbarIcons';
import dbModule from '../../database';
import {
  setPresenceEnabled,
  updatePresence,
  clearPresence,
  destroyPresence,
} from '../modules/DiscordPresence';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db: any = dbModule;
import path from 'path';
import fs from 'fs';
import { fork } from 'child_process';
import {
  APP_CONF_FOLDER,
  MUSIC_DIR,
  ALBUM_ART_DIR,
  ARTIST_ART_DIR,
} from '../../config/core_config';

function sendMessageToRendererProcess(
  window: BrowserWindow,
  message: string,
  payload?: unknown
): void {
  window.webContents.send(message, payload);
}
export default function mainIpcs(mainWin, overlayEntry: string) {
  // ── Always-on-top overlay window ────────────────────────────────────────────
  let overlayWin: BrowserWindow | null = null;

  function createOverlayWin(): BrowserWindow {
    const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
    const win = new BrowserWindow({
      width: 326,
      height: 108,
      x: x + width - 326,
      y: y + height - 124,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      movable: false,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: process.env.NODE_ENV !== 'development',
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true);
    win.loadURL(overlayEntry);
    win.on('closed', () => {
      overlayWin = null;
    });
    return win;
  }

  // Pre-create so it’s warm by the time the first track plays
  overlayWin = createOverlayWin();

  mainWin.on('close', () => {
    destroyPresence();
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy();
  });

  ipcMain.on('now-playing-notify', (_, data) => {
    // Don't show the overlay when the main window is in focus
    if (mainWin.isFocused()) return;
    if (!overlayWin || overlayWin.isDestroyed()) overlayWin = createOverlayWin();
    const send = () => {
      overlayWin!.webContents.send('show-overlay', data);
      overlayWin!.showInactive();
    };
    if (overlayWin.webContents.isLoading()) {
      overlayWin.webContents.once('did-finish-load', send);
    } else {
      send();
    }
  });

  ipcMain.on('hide-overlay', () => {
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.hide();
  });

  // ── Played-times tracking ────────────────────────────────────────────────────
  ipcMain.on('track-played', (_, { trackId }) => {
    if (!trackId) return;
    db.prepare(
      'UPDATE Track SET PlayedTimes = COALESCE(PlayedTimes, 0) + 1, LastPlayedAt = ? WHERE Id = ?'
    ).run(Date.now(), trackId);
  });
  // mainWin.webContents.send('asynchronous-message', {'SAVED': 'File Saved'});
  // mainWin.webContents.openDevTools();

  // Tracks any running scan worker so we never spawn duplicates
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let activeScanWorker: any = null;

  mainWin.on('minimize', () => {
    mainWin.setOpacity(1);
    setTimeout(() => {
      mainWin.setOpacity(0);
    }, 2000 / 60);
  });

  mainWin.on('restore', async () => {
    mainWin.setOpacity(0);
    setTimeout(() => {
      mainWin.setOpacity(1);
    }, 6000 / 60);
  });

  ipcMain.on('minimize', () => mainWin.minimize());
  ipcMain.on('maximize', () => {
    if (mainWin.isMaximized()) {
      mainWin.unmaximize();
      mainWin.center();
    } else {
      mainWin.maximize();
    }
  });
  mainWin.on('resize', () => {
    if (!mainWin.isMinimized()) {
      const win = BrowserWindow.getFocusedWindow();
      if (win) {
        const isMax = win.isMaximized();
        return sendMessageToRendererProcess(mainWin, 'expand-state', isMax);
      }
    }
  });
  ipcMain.on('closeWindow', () => {
    mainWin.close();
  });
  ipcMain.handle('get-dark-mode', () => {
    return nativeTheme.shouldUseDarkColors;
  });
  ipcMain.on('show-dialog', (e, payload) => {
    const { title } = payload;
    dialog.showMessageBox({
      title: title,
      buttons: ['Dismiss'],
      type: 'warning',
      message: 'Application is not responding…',
    });
  });

  // ── Thumbnail toolbar (Windows taskbar media controls) ──────────────────────
  let thumbarIsPlaying = false; // track state for window restore

  function updateThumbar(isPlaying) {
    if (process.platform !== 'win32') return;
    thumbarIsPlaying = isPlaying;
    try {
      mainWin.setThumbarButtons([
        {
          tooltip: 'Previous',
          icon: prevIcon,
          click() {
            sendMessageToRendererProcess(mainWin, 'thumbar-prev');
          },
        },
        {
          tooltip: isPlaying ? 'Pause' : 'Play',
          icon: isPlaying ? pauseIcon : playIcon,
          click() {
            sendMessageToRendererProcess(mainWin, 'thumbar-toggle');
          },
        },
        {
          tooltip: 'Next',
          icon: nextIcon,
          click() {
            sendMessageToRendererProcess(mainWin, 'thumbar-next');
          },
        },
      ]);
    } catch (e) {
      console.warn('setThumbarButtons failed:', e.message);
    }
  }

  // Renderer tells us when play state changes so we can flip the icon
  ipcMain.on('thumbar-update', (_, { isPlaying }) => {
    updateThumbar(isPlaying);
  });

  // Register after window is shown (setThumbarButtons requires a visible HWND)
  mainWin.on('show', () => updateThumbar(thumbarIsPlaying));

  // Windows clears thumbar on minimize/restore — re-register on restore
  mainWin.on('restore', () => updateThumbar(thumbarIsPlaying));

  // // Handle IPC message to play a sound
  // ipcMain.on('playSound', (event, soundData) => {
  //   mainWin.webContents.send('playSound', soundData);
  // });

  // // Handle IPC message to receive sound metadata
  // ipcMain.on('soundMetadata', (event, { timeInterval, tags }) => {
  //   // Do something with the time interval and tags
  //   console.log('Time Interval:', timeInterval);
  //   console.log('Tags:', tags);
  // });

  // async function parseFolder(folderPath, foldersFinalData) {
  //    return new Promise()(resolve => {
  //       (function recursiveReader(folderPath) {
  //          const SongsPathList = parseDir(payload);
  //          SongsPathList.forEach(async songPath => {
  //             const SongInfo = await parseMusic(songPath);
  //             console.info('Info', SongInfo);
  //          });
  //       });

  //          resolve(foldersFinalData);
  //       })(folderPath, foldersFinalData);
  //    });
  // }

  ipcMain.handle('get-scan-status', () => {
    return { isScanning: activeScanWorker !== null };
  });

  ipcMain.handle('get-library-stats', () => {
    try {
      const songs = (db.prepare('SELECT COUNT(*) AS count FROM Track').get() as { count: number })
        .count;
      const albums = (db.prepare('SELECT COUNT(*) AS count FROM Album').get() as { count: number })
        .count;
      const artists = (
        db.prepare('SELECT COUNT(*) AS count FROM Artist').get() as { count: number }
      ).count;
      const albumArtists = (
        db.prepare('SELECT COUNT(DISTINCT ArtistId) AS count FROM Album').get() as { count: number }
      ).count;
      const genres = (db.prepare('SELECT COUNT(*) AS count FROM Genre').get() as { count: number })
        .count;
      const years = (
        db
          .prepare(
            "SELECT COUNT(DISTINCT Year) AS count FROM Track WHERE Year IS NOT NULL AND Year != ''"
          )
          .get() as { count: number }
      ).count;
      const folders = (
        db
          .prepare(
            'SELECT COUNT(DISTINCT FolderPath) AS count FROM Track WHERE FolderPath IS NOT NULL'
          )
          .get() as { count: number }
      ).count;
      // Favourites and Playlists tables don't exist yet — return 0
      const favourites = 0;
      const playlists = 0;
      return {
        songs,
        albums,
        artists,
        albumArtists,
        genres,
        years,
        folders,
        favourites,
        playlists,
      };
    } catch {
      return {
        songs: 0,
        albums: 0,
        artists: 0,
        albumArtists: 0,
        genres: 0,
        years: 0,
        folders: 0,
        favourites: 0,
        playlists: 0,
      };
    }
  });

  function spawnScanWorker(mode: 'basic' | 'full'): Promise<unknown> {
    if (activeScanWorker) {
      return Promise.resolve({ success: false, error: 'Scan already in progress' });
    }
    const folders = db.prepare('SELECT * FROM MusicFolder').all();
    if (!folders.length) return Promise.resolve({ success: false, error: 'No folders to scan' });

    const config = { APP_CONF_FOLDER, MUSIC_DIR, ALBUM_ART_DIR, ARTIST_ART_DIR };
    activeScanWorker = fork(
      path.resolve(process.cwd(), 'src', 'main', 'utils', 'musicScanWorker.js')
    );
    activeScanWorker.send({ folders, config, mode });
    sendMessageToRendererProcess(mainWin, 'scan-start', null);

    let resolvePromise: (v: unknown) => void;
    let rejectPromise: (e: unknown) => void;
    const scanPromise = new Promise((res, rej) => {
      resolvePromise = res;
      rejectPromise = rej;
    });

    activeScanWorker.on('message', rawMsg => {
      const msg = rawMsg as {
        type?: string;
        success?: boolean;
        scanned?: number;
        total?: number;
        processed?: number;
        error?: string;
      };
      if (msg.type === 'progress') {
        sendMessageToRendererProcess(mainWin, 'scan-progress', {
          scanned: msg.scanned,
          total: msg.total,
          processed: msg.processed,
        });
      } else if (msg.success) {
        sendMessageToRendererProcess(mainWin, 'library-updated', { scanned: msg.scanned });
        resolvePromise({ success: true, scanned: msg.scanned });
      } else {
        rejectPromise(msg.error);
      }
    });
    activeScanWorker.on('error', err => rejectPromise(err));
    activeScanWorker.on('exit', (code: number) => {
      console.log(`[${mode}-scan] Worker exited with code ${code}`);
      activeScanWorker = null;
      sendMessageToRendererProcess(mainWin, 'scan-end', null);
      if (code !== 0) rejectPromise('Worker exited with code ' + code);
    });

    return scanPromise;
  }

  ipcMain.handle('scan-media', () => spawnScanWorker('basic'));

  ipcMain.handle('full-rescan', () => spawnScanWorker('full'));

  mainWin.webContents.on('before-input-event', (event, input) => {
    if ((input.control && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12') {
      mainWin.webContents.openDevTools();
      event.preventDefault();
    }
  });

  db.prepare(
    `CREATE TABLE IF NOT EXISTS Genre (
         Id INTEGER PRIMARY KEY AUTOINCREMENT,
         Name TEXT,
         Version INTEGER
       )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS Artist (
         Id INTEGER PRIMARY KEY AUTOINCREMENT,
         Name TEXT,
         ProfileImgUri TEXT,
         Version INTEGER
       )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS Album (
         Id INTEGER PRIMARY KEY AUTOINCREMENT,
         Title TEXT,
         CoverUri TEXT,
         ArtistId INTEGER,
         GenreId INTEGER,
         ReleaseYear INTEGER,
         Duration INTEGER,
         Editable INTEGER,
         DateAdded BIGINT,
         Version INTEGER
       )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS MusicFolder (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  Uri TEXT NOT NULL,
  Name TEXT,
  DateModified INTEGER,
  ItemsCount INTEGER,
  Version INTEGER
)`
  ).run();

  db.prepare(
    `
  CREATE TABLE IF NOT EXISTS Track (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Uri TEXT,
    Extension TEXT,
    Title TEXT,
    ArtistId INTEGER,
    AlbumId INTEGER,
    GenreId INTEGER,
    TrackNumber TEXT,
    Year TEXT,
    AlbumArt TEXT,
    FileHash TEXT,
    Duration INTEGER,
    BitRate INTEGER,
    SampleRate INTEGER,
    Channels INTEGER,
    DiscNumber INTEGER,
    ReleaseYear INTEGER,
    DateAdded BIGINT,
    Version INTEGER,
    FolderPath TEXT,
    PlayedTimes INTEGER DEFAULT 0,
    LastPlayedAt BIGINT
  )
`
  ).run();

  // ── Migrations for existing databases ────────────────────────────────────────
  const existingCols = (db.pragma('table_info(Track)') as { name: string }[]).map(c => c.name);
  if (!existingCols.includes('PlayedTimes')) {
    db.prepare('ALTER TABLE Track ADD COLUMN PlayedTimes INTEGER DEFAULT 0').run();
  }
  if (!existingCols.includes('LastPlayedAt')) {
    db.prepare('ALTER TABLE Track ADD COLUMN LastPlayedAt BIGINT').run();
  }

  ipcMain.handle('add-music-folder', async e => {
    const result = await dialog.showOpenDialog(mainWin, {
      title: 'Select Music Folder',
      properties: ['openDirectory'],
    });

    if (result.canceled || !result.filePaths[0]) {
      return { success: false, error: 'No folder selected' };
    }

    const folderPath = result.filePaths[0];
    const folderName = path.basename(folderPath);
    const stats = fs.statSync(folderPath);
    const itemsCount = fs.readdirSync(folderPath).length;

    const stmt = db.prepare(
      'INSERT INTO MusicFolder (Uri, Name, DateModified, ItemsCount, Version) VALUES (?, ?, ?, ?, ?)'
    );
    stmt.run(folderPath, folderName, stats.mtimeMs, itemsCount, 1);

    // Auto-scan the new folder immediately
    spawnScanWorker('basic').catch(err => console.error('[add-folder] Scan error:', err));

    return {
      success: true,
      folder: {
        Uri: folderPath,
        Name: folderName,
        DateModified: stats.mtimeMs,
        ItemsCount: itemsCount,
        Version: 1,
      },
    };
  });

  ipcMain.handle('get-music-folders', () => {
    const rows = db.prepare('SELECT * FROM MusicFolder').all();
    return rows;
  });

  ipcMain.handle('remove-music-folder', (e, { Id }) => {
    db.prepare('DELETE FROM MusicFolder WHERE Id = ?').run(Id);

    // If no folders remain, wipe all library data and album art
    const remaining = db.prepare('SELECT COUNT(*) AS cnt FROM MusicFolder').get() as {
      cnt: number;
    };
    if (remaining.cnt === 0) {
      db.prepare('DELETE FROM Track').run();
      db.prepare('DELETE FROM Album').run();
      db.prepare('DELETE FROM Artist').run();
      db.prepare('DELETE FROM Genre').run();
      // Remove all saved album art files
      try {
        const files = fs.readdirSync(ALBUM_ART_DIR);
        for (const file of files) {
          fs.unlinkSync(path.join(ALBUM_ART_DIR, file));
        }
      } catch {
        // Directory may not exist yet — safe to ignore
      }
    }

    return { success: true };
  });

  ipcMain.handle('get-all-songs', () => {
    return db
      .prepare(
        `
      SELECT
        Track.Id,
        Track.Title,
        Track.Uri,
        Track.Extension,
        Track.Year,
        Track.TrackNumber,
        Track.AlbumArt,
        Track.Duration,
        Track.AlbumId,
        Artist.Name AS ArtistName,
        Album.Title AS AlbumTitle,
        Genre.Name AS GenreName
      FROM Track
      LEFT JOIN Artist ON Track.ArtistId = Artist.Id
      LEFT JOIN Album ON Track.AlbumId = Album.Id
      LEFT JOIN Genre ON Track.GenreId = Genre.Id
      ORDER BY Track.Title COLLATE NOCASE
    `
      )
      .all();
  });

  ipcMain.handle('get-all-albums', () => {
    const rows = db
      .prepare(
        `
      SELECT
        Album.Id,
        Album.Title,
        Album.ReleaseYear,
        Artist.Name AS ArtistName,
        COUNT(Track.Id) AS SongCount
      FROM Album
      LEFT JOIN Artist ON Album.ArtistId = Artist.Id
      LEFT JOIN Track ON Album.Id = Track.AlbumId
      GROUP BY Album.Id
      ORDER BY Album.Title COLLATE NOCASE
    `
      )
      .all();
    return rows.map(row => {
      const coverPath = path.join(ALBUM_ART_DIR, `${row.Id}.jpg`);
      return {
        ...row,
        CoverUri: fs.existsSync(coverPath) ? coverPath : null,
      };
    });
  });

  ipcMain.handle('get-album-songs', (e, { albumId }) => {
    const rows = db
      .prepare(
        `
      SELECT
        Track.Id,
        Track.Title,
        Track.Uri,
        Track.Extension,
        Track.Year,
        Track.TrackNumber,
        Track.AlbumArt,
        Track.Duration,
        Artist.Name AS ArtistName,
        Album.Title AS AlbumTitle,
        Album.Id AS AlbumId,
        Genre.Name AS GenreName
      FROM Track
      LEFT JOIN Artist ON Track.ArtistId = Artist.Id
      LEFT JOIN Album ON Track.AlbumId = Album.Id
      LEFT JOIN Genre ON Track.GenreId = Genre.Id
      WHERE Track.AlbumId = ?
      ORDER BY CAST(Track.TrackNumber AS INTEGER), Track.Title COLLATE NOCASE
    `
      )
      .all(albumId);
    const coverPath = path.join(ALBUM_ART_DIR, `${albumId}.jpg`);
    const coverUri = fs.existsSync(coverPath) ? coverPath : null;
    return rows.map(row => ({ ...row, AlbumCoverUri: coverUri }));
  });

  // Search functionality
  ipcMain.handle('search-library', (e, { query }) => {
    if (!query || query.trim().length === 0) {
      return {
        songs: [],
        albums: [],
        artists: [],
        albumArtists: [],
        genres: [],
        years: [],
        folders: [],
        playlists: [],
      };
    }

    const searchPattern = `%${query}%`;
    const exactQuery = query.toLowerCase();

    try {
      // Search songs
      const songs = db
        .prepare(
          `
        SELECT
          Track.Id,
          Track.Title,
          Track.Uri,
          Track.Extension,
          Track.Year,
          Track.TrackNumber,
          Track.AlbumArt,
          Track.Duration,
          Artist.Name AS ArtistName,
          Album.Id AS AlbumId,
          Album.Title AS AlbumTitle,
          Genre.Name AS GenreName
        FROM Track
        LEFT JOIN Artist ON Track.ArtistId = Artist.Id
        LEFT JOIN Album ON Track.AlbumId = Album.Id
        LEFT JOIN Genre ON Track.GenreId = Genre.Id
        WHERE Track.Title LIKE ? COLLATE NOCASE
        ORDER BY 
          CASE WHEN LOWER(Track.Title) = ? THEN 0 ELSE 1 END,
          Track.Title COLLATE NOCASE
        LIMIT 10
      `
        )
        .all(searchPattern, exactQuery);

      // Search albums
      const albums = db
        .prepare(
          `
        SELECT
          Album.Id,
          Album.Title,
          Album.CoverUri,
          Album.ReleaseYear,
          Artist.Name AS ArtistName,
          COUNT(Track.Id) AS SongCount
        FROM Album
        LEFT JOIN Artist ON Album.ArtistId = Artist.Id
        LEFT JOIN Track ON Album.Id = Track.AlbumId
        WHERE Album.Title LIKE ? COLLATE NOCASE
        GROUP BY Album.Id
        ORDER BY 
          CASE WHEN LOWER(Album.Title) = ? THEN 0 ELSE 1 END,
          Album.Title COLLATE NOCASE
        LIMIT 10
      `
        )
        .all(searchPattern, exactQuery);

      // Search artists
      const artists = db
        .prepare(
          `
        SELECT
          Artist.Id,
          Artist.Name,
          Artist.ProfileImgUri,
          COUNT(DISTINCT Track.Id) AS SongCount
        FROM Artist
        LEFT JOIN Track ON Artist.Id = Track.ArtistId
        WHERE Artist.Name LIKE ? COLLATE NOCASE
        GROUP BY Artist.Id
        ORDER BY 
          CASE WHEN LOWER(Artist.Name) = ? THEN 0 ELSE 1 END,
          Artist.Name COLLATE NOCASE
        LIMIT 10
      `
        )
        .all(searchPattern, exactQuery);

      // Search album artists (same as artists for now)
      const albumArtists = db
        .prepare(
          `
        SELECT
          Artist.Id,
          Artist.Name,
          Artist.ProfileImgUri,
          COUNT(DISTINCT Album.Id) AS AlbumCount
        FROM Artist
        LEFT JOIN Album ON Artist.Id = Album.ArtistId
        WHERE Artist.Name LIKE ? COLLATE NOCASE
        GROUP BY Artist.Id
        ORDER BY 
          CASE WHEN LOWER(Artist.Name) = ? THEN 0 ELSE 1 END,
          Artist.Name COLLATE NOCASE
        LIMIT 10
      `
        )
        .all(searchPattern, exactQuery);

      // Search genres
      const genres = db
        .prepare(
          `
        SELECT
          Genre.Id,
          Genre.Name,
          COUNT(Track.Id) AS SongCount
        FROM Genre
        LEFT JOIN Track ON Genre.Id = Track.GenreId
        WHERE Genre.Name LIKE ? COLLATE NOCASE
        GROUP BY Genre.Id
        ORDER BY 
          CASE WHEN LOWER(Genre.Name) = ? THEN 0 ELSE 1 END,
          Genre.Name COLLATE NOCASE
        LIMIT 10
      `
        )
        .all(searchPattern, exactQuery);

      // Search years
      const years = db
        .prepare(
          `
        SELECT
          Track.Year AS Name,
          COUNT(Track.Id) AS SongCount
        FROM Track
        WHERE Track.Year LIKE ? AND Track.Year IS NOT NULL AND Track.Year != ''
        GROUP BY Track.Year
        ORDER BY Track.Year DESC
        LIMIT 10
      `
        )
        .all(searchPattern);

      // Search folders
      const folders = db
        .prepare(
          `
        SELECT
          Track.FolderPath AS Name,
          COUNT(Track.Id) AS SongCount
        FROM Track
        WHERE Track.FolderPath LIKE ? COLLATE NOCASE AND Track.FolderPath IS NOT NULL
        GROUP BY Track.FolderPath
        ORDER BY 
          CASE WHEN LOWER(Track.FolderPath) = ? THEN 0 ELSE 1 END,
          Track.FolderPath COLLATE NOCASE
        LIMIT 10
      `
        )
        .all(searchPattern, exactQuery);

      // Playlists would need a separate table - returning empty for now
      const playlists = [];

      const normalizeTrackNumber = (trackNumber: any) => {
        if (trackNumber === null || trackNumber === undefined || trackNumber === '') return null;
        const str = String(trackNumber);
        const num = parseInt(str.split('/')[0], 10);
        return Number.isNaN(num) ? null : num;
      };

      const results = {
        songs: songs.map(s => ({
          Id: s.Id,
          Title: s.Title,
          Uri: s.Uri,
          Extension: s.Extension,
          Year: s.Year,
          TrackNumber: normalizeTrackNumber(s.TrackNumber),
          AlbumArt: s.AlbumArt,
          Duration: s.Duration,
          ArtistName: s.ArtistName,
          AlbumId: s.AlbumId,
          AlbumTitle: s.AlbumTitle,
          GenreName: s.GenreName,
        })),
        albums: albums.map(a => ({
          id: a.Id,
          title: a.Title,
          artist: a.ArtistName,
          year: a.ReleaseYear,
          songCount: a.SongCount,
          coverUri: a.CoverUri,
        })),
        artists: artists.map(a => ({
          id: a.Id,
          title: a.Name,
          songCount: a.SongCount,
          profileImg: a.ProfileImgUri,
        })),
        albumArtists: albumArtists.map(a => ({
          id: a.Id,
          title: a.Name,
          albumCount: a.AlbumCount,
          profileImg: a.ProfileImgUri,
        })),
        genres: genres.map(g => ({
          id: g.Id,
          title: g.Name,
          songCount: g.SongCount,
        })),
        years: years.map(y => ({
          id: y.Name,
          title: y.Name,
          songCount: y.SongCount,
        })),
        folders: folders.map(f => ({
          id: f.Name,
          title: f.Name,
          songCount: f.SongCount,
        })),
        playlists,
      };

      return results;
    } catch (error) {
      return {
        songs: [],
        albums: [],
        artists: [],
        albumArtists: [],
        genres: [],
        years: [],
        folders: [],
        playlists: [],
      };
    }
  });

  // ── Auto-scan library folders on app load ─────────────────────────────────
  mainWin.webContents.once('did-finish-load', () => {
    // Don't spawn if another scan is already running
    if (activeScanWorker) return;

    const folders = db.prepare('SELECT * FROM MusicFolder').all();
    if (!folders.length) return;

    const config = {
      APP_CONF_FOLDER,
      MUSIC_DIR,
      ALBUM_ART_DIR,
      ARTIST_ART_DIR,
    };

    activeScanWorker = fork(
      path.resolve(process.cwd(), 'src', 'main', 'utils', 'musicScanWorker.js')
    );
    // Use basic/optimistic scan on startup — only process new files, skip known ones
    activeScanWorker.send({ folders, config, mode: 'basic' });
    sendMessageToRendererProcess(mainWin, 'scan-start', null);

    activeScanWorker.on('message', rawMsg => {
      const msg = rawMsg as {
        type?: string;
        success?: boolean;
        scanned?: number;
        total?: number;
        processed?: number;
        error?: string;
      };
      if (msg.type === 'progress') {
        sendMessageToRendererProcess(mainWin, 'scan-progress', {
          scanned: msg.scanned,
          total: msg.total,
          processed: msg.processed,
        });
      } else if (msg.success) {
        console.log(`[Auto-scan] Found ${msg.scanned} new file(s).`);
        sendMessageToRendererProcess(mainWin, 'library-updated', { scanned: msg.scanned });
      }
    });
    activeScanWorker.on('exit', (code: number) => {
      console.log(`[Auto-scan] Worker exited with code ${code}`);
      activeScanWorker = null;
      sendMessageToRendererProcess(mainWin, 'scan-end', null);
    });
    activeScanWorker.on('error', err => {
      console.error('[Auto-scan] Worker error:', err);
      activeScanWorker = null;
      sendMessageToRendererProcess(mainWin, 'scan-end', null);
    });
  });

  // ── Discord Rich Presence IPC ─────────────────────────────────────────────
  ipcMain.on(
    'discord-update',
    (
      _,
      data: {
        title: string;
        artist: string;
        album: string;
        isPlaying: boolean;
        position: number;
        duration: number;
      }
    ) => {
      updatePresence(data);
    }
  );

  ipcMain.on('discord-clear', () => {
    clearPresence();
  });

  ipcMain.on('discord-set-enabled', (_, { enabled }: { enabled: boolean }) => {
    setPresenceEnabled(enabled);
  });
}
