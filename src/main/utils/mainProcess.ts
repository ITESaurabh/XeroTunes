import { BrowserWindow, dialog, ipcMain, nativeTheme, screen, shell } from 'electron';
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
import { AppSettings, DEFAULT_APP_SETTINGS, clampWindowScale } from '../../config/app_settings';
import { fetchArtistProfileImage } from '../modules/artistArts';

const SETTINGS_FILE = path.join(APP_CONF_FOLDER, 'settings.json');

function ensureAppConfFolder() {
  if (!fs.existsSync(APP_CONF_FOLDER)) {
    fs.mkdirSync(APP_CONF_FOLDER, { recursive: true });
  }
}

function readSettingsFile(): AppSettings {
  ensureAppConfFolder();
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_APP_SETTINGS, null, 2));
    return DEFAULT_APP_SETTINGS;
  }

  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_APP_SETTINGS,
      ...parsed,
      theme: {
        ...DEFAULT_APP_SETTINGS.theme,
        ...(parsed.theme ?? {}),
      },
      playback: {
        ...DEFAULT_APP_SETTINGS.playback,
        ...(parsed.playback ?? {}),
      },
      library: {
        ...DEFAULT_APP_SETTINGS.library,
        ...(parsed.library ?? {}),
      },
      views: {
        folders: {
          ...DEFAULT_APP_SETTINGS.views.folders,
          ...(parsed.views?.folders ?? {}),
        },
        folderHierarchy: {
          ...DEFAULT_APP_SETTINGS.views.folderHierarchy,
          ...(parsed.views?.folderHierarchy ?? {}),
        },
      },
    };
  } catch (error) {
    console.warn('Failed to load settings.json, restoring defaults:', error);
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_APP_SETTINGS, null, 2));
    return DEFAULT_APP_SETTINGS;
  }
}

function writeSettingsFile(settings: AppSettings) {
  ensureAppConfFolder();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

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
        partition: 'overlay-isolated',
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: process.env.NODE_ENV !== 'development',
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true);
    win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);
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

  // On macOS, sync traffic light visibility with the saved titleBarStyle
  if (process.platform === 'darwin') {
    mainWin.webContents.once('did-finish-load', () => {
      try {
        const settings = readSettingsFile();
        const style = settings.theme?.titleBarStyle ?? 'default';
        const showNative = style === 'mac' || style === 'default';
        mainWin.setWindowButtonVisibility(showNative);
      } catch {
        /* ignore */
      }
    });
  }

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
  ipcMain.on('read-app-settings-sync', event => {
    event.returnValue = readSettingsFile();
  });
  ipcMain.on('write-app-settings-sync', (event, settings) => {
    writeSettingsFile(settings);
    event.returnValue = settings;
  });
  ipcMain.handle('set-window-scale', (_e, { scale }: { scale: number }) => {
    const safe = clampWindowScale(scale);
    try {
      mainWin.webContents.setZoomFactor(safe);
    } catch (err) {
      console.warn('Failed to set zoom factor:', err);
    }
    const current = readSettingsFile();
    writeSettingsFile({ ...current, windowScale: safe });
    return { success: true, scale: safe };
  });
  ipcMain.handle('set-traffic-light-visibility', (_e, { visible }: { visible: boolean }) => {
    if (process.platform === 'darwin' && mainWin && !mainWin.isDestroyed()) {
      mainWin.setWindowButtonVisibility(visible);
    }
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
        db.prepare('SELECT COUNT(DISTINCT ArtistId) AS count FROM TrackArtist').get() as {
          count: number;
        }
      ).count;
      const albumArtists = (
        db.prepare('SELECT COUNT(DISTINCT ArtistId) AS count FROM AlbumArtist').get() as {
          count: number;
        }
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
      const recentlyAdded = Math.min(
        200,
        (
          db
            .prepare(
              'SELECT COUNT(*) AS count FROM Track WHERE DateAdded IS NOT NULL AND DateAdded > 0'
            )
            .get() as { count: number }
        ).count
      );
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
        recentlyAdded,
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
        recentlyAdded: 0,
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
    const settings = readSettingsFile();
    activeScanWorker = fork(
      path.resolve(process.cwd(), 'src', 'main', 'utils', 'musicScanWorker.js')
    );
    activeScanWorker.send({ folders, config, mode, librarySettings: settings.library });
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
        removed?: number;
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
        const scanned = msg.scanned ?? 0;
        const removed = msg.removed ?? 0;
        if (scanned > 0 || removed > 0) {
          sendMessageToRendererProcess(mainWin, 'library-updated', { scanned, removed });
        }
        resolvePromise({ success: true, scanned, removed });
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
         Name TEXT COLLATE NOCASE,
         ProfileImgUri TEXT,
         ArtistMetaJson TEXT,
         Version INTEGER
       )`
  ).run();

  // Migration: add ArtistMetaJson once for existing DB versions
  const artistColumns = db.prepare("PRAGMA table_info('Artist')").all() as Array<{ name: string }>;
  if (!artistColumns.some(col => col.name === 'ArtistMetaJson')) {
    db.prepare('ALTER TABLE Artist ADD COLUMN ArtistMetaJson TEXT').run();
  }

  db.prepare(
    `CREATE TABLE IF NOT EXISTS Album (
         Id INTEGER PRIMARY KEY AUTOINCREMENT,
         Title TEXT COLLATE NOCASE,
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

  db.prepare(
    `
  CREATE TABLE IF NOT EXISTS TrackArtist (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    TrackId INTEGER NOT NULL,
    ArtistId INTEGER NOT NULL,
    UNIQUE(TrackId, ArtistId)
  )
`
  ).run();

  db.prepare(
    `
  CREATE TABLE IF NOT EXISTS AlbumArtist (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    AlbumId INTEGER NOT NULL,
    ArtistId INTEGER NOT NULL,
    UNIQUE(AlbumId, ArtistId)
  )
`
  ).run();

  db.prepare(
    `INSERT OR IGNORE INTO TrackArtist (TrackId, ArtistId)
     SELECT Id, ArtistId FROM Track WHERE ArtistId IS NOT NULL`
  ).run();

  if (db.prepare('SELECT COUNT(*) AS count FROM AlbumArtist').get().count === 0) {
    db.prepare(
      `INSERT OR IGNORE INTO AlbumArtist (AlbumId, ArtistId)
       SELECT Id, ArtistId FROM Album WHERE ArtistId IS NOT NULL`
    ).run();
  }

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

  // ── Folder views ────────────────────────────────────────────────────────────
  // Flat list of every folder that holds songs in the library, sorted by name.
  // Powers the "Folders" screen.
  ipcMain.handle('get-folders-with-songs', () => {
    const rows = db
      .prepare(
        `SELECT FolderPath, COUNT(Id) AS SongCount
         FROM Track
         WHERE FolderPath IS NOT NULL AND FolderPath != ''
         GROUP BY FolderPath
         ORDER BY FolderPath COLLATE NOCASE`
      )
      .all() as Array<{ FolderPath: string; SongCount: number }>;
    return rows.map(r => ({
      Path: r.FolderPath,
      Name: path.basename(r.FolderPath) || r.FolderPath,
      SongCount: r.SongCount,
    }));
  });

  // Returns immediate children of a given folder path (sub-folders + songs at
  // that exact level). When `folderPath` is null/undefined, returns the user-
  // configured Music Folder roots. Powers the "Folder Hierarchy" screen.
  ipcMain.handle(
    'get-folder-children',
    (_e, { folderPath }: { folderPath?: string | null } = {}) => {
      const allFolders = db
        .prepare(
          `SELECT FolderPath, COUNT(Id) AS SongCount
           FROM Track
           WHERE FolderPath IS NOT NULL AND FolderPath != ''
           GROUP BY FolderPath`
        )
        .all() as Array<{ FolderPath: string; SongCount: number }>;

      // Root view: show user-added Music Folders.
      if (!folderPath) {
        const roots = db
          .prepare('SELECT Uri, Name FROM MusicFolder ORDER BY Name COLLATE NOCASE')
          .all() as Array<{ Uri: string; Name: string }>;

        const subfolders = roots.map(root => {
          const sep = root.Uri.includes('\\') ? '\\' : '/';
          const prefix = root.Uri.endsWith(sep) ? root.Uri : root.Uri + sep;
          let count = 0;
          for (const f of allFolders) {
            if (f.FolderPath === root.Uri || f.FolderPath.startsWith(prefix)) {
              count += f.SongCount;
            }
          }
          return {
            Path: root.Uri,
            Name: root.Name || path.basename(root.Uri) || root.Uri,
            SongCount: count,
            IsRoot: true,
          };
        });

        return { subfolders, songs: [], isRoot: true };
      }

      // Inside a folder: derive immediate children from FolderPath rows.
      const sep = folderPath.includes('\\') ? '\\' : '/';
      const prefix = folderPath.endsWith(sep) ? folderPath : folderPath + sep;
      const subfoldersMap = new Map<
        string,
        { Path: string; Name: string; SongCount: number; IsRoot?: boolean }
      >();

      for (const f of allFolders) {
        if (f.FolderPath === folderPath) continue;
        if (!f.FolderPath.startsWith(prefix)) continue;
        const remainder = f.FolderPath.slice(prefix.length);
        const nextSeg = remainder.split(/[\\/]/)[0];
        if (!nextSeg) continue;
        const childPath = prefix + nextSeg;
        const existing = subfoldersMap.get(childPath);
        if (existing) {
          existing.SongCount += f.SongCount;
        } else {
          subfoldersMap.set(childPath, {
            Path: childPath,
            Name: nextSeg,
            SongCount: f.SongCount,
          });
        }
      }

      const subfolders = Array.from(subfoldersMap.values()).sort((a, b) =>
        a.Name.localeCompare(b.Name, undefined, { sensitivity: 'base' })
      );

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
          Track.AlbumId,
          Track.FolderPath,
          GROUP_CONCAT(DISTINCT Artist2.Name) AS ArtistName,
          Album.Title AS AlbumTitle,
          Genre.Name AS GenreName
        FROM Track
        LEFT JOIN TrackArtist ON Track.Id = TrackArtist.TrackId
        LEFT JOIN Artist AS Artist2 ON TrackArtist.ArtistId = Artist2.Id
        LEFT JOIN Album ON Track.AlbumId = Album.Id
        LEFT JOIN Genre ON Track.GenreId = Genre.Id
        WHERE Track.FolderPath = ?
        GROUP BY Track.Id
        ORDER BY COALESCE(CAST(Track.TrackNumber AS INTEGER), 9999), Track.Title COLLATE NOCASE
      `
        )
        .all(folderPath);

      return { subfolders, songs, isRoot: false };
    }
  );

  // Returns every song under the given folder path (recursive). Used by
  // "Folders" screen play-folder action and by Folder Hierarchy when the user
  // wants to play an entire branch.
  ipcMain.handle('get-songs-in-folder', (_e, { folderPath }: { folderPath: string }) => {
    if (!folderPath) return [];
    const sep = folderPath.includes('\\') ? '\\' : '/';
    const prefix = folderPath.endsWith(sep) ? folderPath : folderPath + sep;
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
        Track.FolderPath,
        GROUP_CONCAT(DISTINCT Artist2.Name) AS ArtistName,
        Album.Title AS AlbumTitle,
        Genre.Name AS GenreName
      FROM Track
      LEFT JOIN TrackArtist ON Track.Id = TrackArtist.TrackId
      LEFT JOIN Artist AS Artist2 ON TrackArtist.ArtistId = Artist2.Id
      LEFT JOIN Album ON Track.AlbumId = Album.Id
      LEFT JOIN Genre ON Track.GenreId = Genre.Id
      WHERE Track.FolderPath = ? OR Track.FolderPath LIKE ?
      GROUP BY Track.Id
      ORDER BY Track.FolderPath COLLATE NOCASE,
               COALESCE(CAST(Track.TrackNumber AS INTEGER), 9999),
               Track.Title COLLATE NOCASE
    `
      )
      .all(folderPath, prefix + '%');
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
        GROUP_CONCAT(DISTINCT Artist2.Name) AS ArtistName,
        Album.Title AS AlbumTitle,
        Genre.Name AS GenreName
      FROM Track
      LEFT JOIN TrackArtist ON Track.Id = TrackArtist.TrackId
      LEFT JOIN Artist AS Artist2 ON TrackArtist.ArtistId = Artist2.Id
      LEFT JOIN Album ON Track.AlbumId = Album.Id
      LEFT JOIN Genre ON Track.GenreId = Genre.Id
      GROUP BY Track.Id
      ORDER BY Track.Title COLLATE NOCASE
    `
      )
      .all();
  });

  ipcMain.handle('get-recently-added-songs', () => {
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
        Track.DateAdded,
        GROUP_CONCAT(DISTINCT Artist2.Name) AS ArtistName,
        Album.Title AS AlbumTitle,
        Genre.Name AS GenreName
      FROM Track
      LEFT JOIN TrackArtist ON Track.Id = TrackArtist.TrackId
      LEFT JOIN Artist AS Artist2 ON TrackArtist.ArtistId = Artist2.Id
      LEFT JOIN Album ON Track.AlbumId = Album.Id
      LEFT JOIN Genre ON Track.GenreId = Genre.Id
      GROUP BY Track.Id
      ORDER BY Track.DateAdded DESC
      LIMIT 200
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
        COALESCE(
          Album.ReleaseYear,
          MIN(CAST(Track.ReleaseYear AS INTEGER)),
          MIN(CAST(Track.Year AS INTEGER))
        ) AS ReleaseYear,
        GROUP_CONCAT(DISTINCT Artist2.Name) AS ArtistName,
        COUNT(Track.Id) AS SongCount
      FROM Album
      LEFT JOIN AlbumArtist ON Album.Id = AlbumArtist.AlbumId
      LEFT JOIN Artist AS Artist2 ON AlbumArtist.ArtistId = Artist2.Id
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
        GROUP_CONCAT(DISTINCT Artist2.Name) AS ArtistName,
        GROUP_CONCAT(DISTINCT AlbumArtist2.Name) AS AlbumArtistName,
        Album.Title AS AlbumTitle,
        Album.Id AS AlbumId,
        Genre.Name AS GenreName
      FROM Track
      JOIN TrackArtist ON Track.Id = TrackArtist.TrackId
      JOIN Artist AS Artist2 ON TrackArtist.ArtistId = Artist2.Id
      LEFT JOIN Album ON Track.AlbumId = Album.Id
      LEFT JOIN AlbumArtist ON Album.Id = AlbumArtist.AlbumId
      LEFT JOIN Artist AS AlbumArtist2 ON AlbumArtist.ArtistId = AlbumArtist2.Id
      LEFT JOIN Genre ON Track.GenreId = Genre.Id
      WHERE Track.AlbumId = ?
      GROUP BY Track.Id
      ORDER BY CAST(Track.TrackNumber AS INTEGER), Track.Title COLLATE NOCASE
    `
      )
      .all(albumId);
    const coverPath = path.join(ALBUM_ART_DIR, `${albumId}.jpg`);
    const coverUri = fs.existsSync(coverPath) ? coverPath : null;
    return rows.map(row => ({ ...row, AlbumCoverUri: coverUri }));
  });

  // ── Genres ──────────────────────────────────────────────────────────────────
  ipcMain.handle('get-all-genres', () => {
    return db
      .prepare(
        `
      SELECT
        Genre.Id,
        Genre.Name,
        COUNT(DISTINCT Track.Id) AS SongCount,
        COUNT(DISTINCT Track.AlbumId) AS AlbumCount
      FROM Genre
      LEFT JOIN Track ON Track.GenreId = Genre.Id
      GROUP BY Genre.Id
      HAVING COUNT(Track.Id) > 0
      ORDER BY Genre.Name COLLATE NOCASE
    `
      )
      .all();
  });

  ipcMain.handle('get-genre-songs', (_e, { genreId }: { genreId: number | string }) => {
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
        GROUP_CONCAT(DISTINCT Artist2.Name) AS ArtistName,
        Album.Title AS AlbumTitle,
        Genre.Name AS GenreName
      FROM Track
      LEFT JOIN TrackArtist ON Track.Id = TrackArtist.TrackId
      LEFT JOIN Artist AS Artist2 ON TrackArtist.ArtistId = Artist2.Id
      LEFT JOIN Album ON Track.AlbumId = Album.Id
      LEFT JOIN Genre ON Track.GenreId = Genre.Id
      WHERE Track.GenreId = ?
      GROUP BY Track.Id
      ORDER BY Track.Title COLLATE NOCASE
    `
      )
      .all(genreId);
  });

  // ── Years ───────────────────────────────────────────────────────────────────
  ipcMain.handle('get-all-years', () => {
    return db
      .prepare(
        `
      SELECT
        Track.Year AS Year,
        COUNT(DISTINCT Track.Id) AS SongCount,
        COUNT(DISTINCT Track.AlbumId) AS AlbumCount
      FROM Track
      WHERE Track.Year IS NOT NULL AND Track.Year != ''
      GROUP BY Track.Year
      ORDER BY CAST(Track.Year AS INTEGER) DESC
    `
      )
      .all();
  });

  ipcMain.handle('get-year-songs', (_e, { year }: { year: string | number }) => {
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
        GROUP_CONCAT(DISTINCT Artist2.Name) AS ArtistName,
        Album.Title AS AlbumTitle,
        Genre.Name AS GenreName
      FROM Track
      LEFT JOIN TrackArtist ON Track.Id = TrackArtist.TrackId
      LEFT JOIN Artist AS Artist2 ON TrackArtist.ArtistId = Artist2.Id
      LEFT JOIN Album ON Track.AlbumId = Album.Id
      LEFT JOIN Genre ON Track.GenreId = Genre.Id
      WHERE Track.Year = ?
      GROUP BY Track.Id
      ORDER BY Album.Title COLLATE NOCASE, CAST(Track.TrackNumber AS INTEGER), Track.Title COLLATE NOCASE
    `
      )
      .all(String(year));
  });

  ipcMain.handle('get-all-artists', () => {
    const rows = db
      .prepare(
        `
      SELECT
        Artist.Id,
        Artist.Name,
        Artist.ProfileImgUri,
        COUNT(DISTINCT TrackArtist.TrackId) AS SongCount,
        COUNT(DISTINCT Track.AlbumId) AS AlbumCount
      FROM Artist
      LEFT JOIN TrackArtist ON Artist.Id = TrackArtist.ArtistId
      LEFT JOIN Track ON TrackArtist.TrackId = Track.Id
      GROUP BY Artist.Id
      HAVING COUNT(DISTINCT TrackArtist.TrackId) > 0
      ORDER BY Artist.Name COLLATE NOCASE
    `
      )
      .all();

    return rows.map(row => {
      const localPath = path.join(ARTIST_ART_DIR, `${row.Id}.jpg`);
      const profilePath = fs.existsSync(localPath) ? localPath : (row.ProfileImgUri ?? null);

      return {
        Id: row.Id,
        Name: row.Name,
        ProfileImgUri: profilePath,
        ProfileImg: profilePath,
        SongCount: row.SongCount,
        AlbumCount: row.AlbumCount,
      };
    });
  });

  ipcMain.handle('get-all-album-artists', () => {
    const rows = db
      .prepare(
        `
      SELECT
        Artist.Id,
        Artist.Name,
        Artist.ProfileImgUri,
        COUNT(DISTINCT AlbumArtist.AlbumId) AS AlbumCount,
        COUNT(DISTINCT Track.Id) AS SongCount
      FROM Artist
      JOIN AlbumArtist ON Artist.Id = AlbumArtist.ArtistId
      LEFT JOIN Album ON AlbumArtist.AlbumId = Album.Id
      LEFT JOIN Track ON Album.Id = Track.AlbumId
      GROUP BY Artist.Id
      ORDER BY Artist.Name COLLATE NOCASE
    `
      )
      .all();

    return rows.map(row => {
      const localPath = path.join(ARTIST_ART_DIR, `${row.Id}.jpg`);
      const profilePath = fs.existsSync(localPath) ? localPath : (row.ProfileImgUri ?? null);

      return {
        Id: row.Id,
        Name: row.Name,
        ProfileImgUri: profilePath,
        ProfileImg: profilePath,
        SongCount: row.SongCount,
        AlbumCount: row.AlbumCount,
      };
    });
  });

  ipcMain.handle('fetch-artist-profile-image', async (e, { artistId }) => {
    if (!artistId || typeof artistId !== 'number') return null;

    const row = db.prepare('SELECT Name, ProfileImgUri FROM Artist WHERE Id = ?').get(artistId);
    if (!row || !row.Name) return null;

    const existingUri =
      typeof row.ProfileImgUri === 'string' && row.ProfileImgUri.trim().length > 0
        ? row.ProfileImgUri
        : null;
    const localPath = path.join(ARTIST_ART_DIR, `${artistId}.jpg`);

    if (existingUri) {
      const isRemote = existingUri.startsWith('http://') || existingUri.startsWith('https://');
      if (isRemote || fs.existsSync(existingUri)) {
        return existingUri;
      }
    }

    if (fs.existsSync(localPath)) {
      return localPath;
    }

    return await fetchArtistProfileImage(row.Name, undefined, artistId);
  });

  ipcMain.handle('force-fetch-artist-profile-image', async (e, { artistId }) => {
    if (!artistId || typeof artistId !== 'number') return null;

    const row = db.prepare('SELECT Name FROM Artist WHERE Id = ?').get(artistId);
    if (!row || !row.Name) return null;

    // Clear local cache so fetchArtistProfileImage re-downloads
    const localPath = path.join(ARTIST_ART_DIR, `${artistId}.jpg`);
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }

    // Clear DB cached URI
    db.prepare('UPDATE Artist SET ProfileImgUri = NULL, ArtistMetaJson = NULL WHERE Id = ?').run(
      artistId
    );

    return await fetchArtistProfileImage(row.Name, undefined, artistId);
  });

  ipcMain.handle('get-artist-meta', (e, { artistId }) => {
    const artist = db
      .prepare(
        `
      SELECT
        ArtistMetaJson
      FROM Artist
      WHERE Id = ?
    `
      )
      .get(artistId);

    if (!artist || !artist.ArtistMetaJson) return null;

    try {
      return JSON.parse(artist.ArtistMetaJson);
    } catch {
      console.warn('Failed to parse ArtistMetaJson for artist', artistId);
      return null;
    }
  });

  ipcMain.handle('find-artist-by-name', (e, { name }) => {
    if (!name || typeof name !== 'string') return null;
    const row = db.prepare('SELECT Id FROM Artist WHERE LOWER(Name) = LOWER(?) LIMIT 1').get(name);
    return row ? { id: row.Id } : null;
  });

  ipcMain.handle('open-dir', (e, { variant = 'appdata' }) => {
    // open apps data folder in file manager
    let targetPath: string;
    if (variant === 'appdata') {
      targetPath = APP_CONF_FOLDER;
    } else if (variant === 'music') {
      targetPath = MUSIC_DIR;
    } else {
      return { success: false, error: 'Invalid variant' };
    }
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }
    shell.openPath(targetPath);
    return { success: true };
  });

  ipcMain.handle('get-artist-detail', async (e, { artistId }) => {
    const artist = db
      .prepare(
        `
      SELECT
        Id,
        Name,
        ProfileImgUri
      FROM Artist
      WHERE Id = ?
    `
      )
      .get(artistId);

    if (!artist) return null;

    const profilePath = await fetchArtistProfileImage(artist.Name, undefined, artist.Id);

    const songCount = db
      .prepare('SELECT COUNT(*) AS count FROM TrackArtist WHERE ArtistId = ?')
      .get(artistId).count;

    const albumCount = db
      .prepare('SELECT COUNT(*) AS count FROM AlbumArtist WHERE ArtistId = ?')
      .get(artistId).count;

    return {
      Id: artist.Id,
      Name: artist.Name,
      ProfileImgUri: profilePath,
      ProfileImg: profilePath,
      SongCount: songCount,
      AlbumCount: albumCount,
    };
  });

  ipcMain.handle('get-artist-songs', (e, { artistId }) => {
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
        GROUP_CONCAT(DISTINCT Artist2.Name) AS ArtistName,
        Album.Title AS AlbumTitle,
        Album.Id AS AlbumId,
        Genre.Name AS GenreName
      FROM Track
      JOIN TrackArtist ON Track.Id = TrackArtist.TrackId
      JOIN Artist AS Artist2 ON TrackArtist.ArtistId = Artist2.Id
      LEFT JOIN Album ON Track.AlbumId = Album.Id
      LEFT JOIN Genre ON Track.GenreId = Genre.Id
      WHERE Track.Id IN (
        SELECT TrackId FROM TrackArtist WHERE ArtistId = ?
        UNION
        SELECT Id FROM Track WHERE ArtistId = ?
      )
      GROUP BY Track.Id
      ORDER BY COALESCE(CAST(Track.TrackNumber AS INTEGER), 9999), Track.Title COLLATE NOCASE
    `
      )
      .all(artistId, artistId);

    return rows;
  });

  ipcMain.handle('get-artist-albums', (e, { artistId }) => {
    const rows = db
      .prepare(
        `
      SELECT
        Album.Id,
        Album.Title,
        COALESCE(
          Album.ReleaseYear,
          MIN(CAST(Track.ReleaseYear AS INTEGER)),
          MIN(CAST(Track.Year AS INTEGER))
        ) AS ReleaseYear,
        Album.CoverUri,
        COUNT(Track.Id) AS SongCount
      FROM Album
      JOIN Track ON Album.Id = Track.AlbumId
      JOIN TrackArtist ON Track.Id = TrackArtist.TrackId
      WHERE TrackArtist.ArtistId = ?
      GROUP BY Album.Id
      ORDER BY Album.Title COLLATE NOCASE
    `
      )
      .all(artistId);

    return rows.map(album => {
      const coverPath = path.join(ALBUM_ART_DIR, `${album.Id}.jpg`);
      return {
        ...album,
        coverUri: album.CoverUri || (fs.existsSync(coverPath) ? coverPath : null),
      };
    });
  });

  ipcMain.handle('get-album-artist-detail', async (e, { artistId }) => {
    const artist = db
      .prepare(
        `
      SELECT
        Id,
        Name,
        ProfileImgUri
      FROM Artist
      WHERE Id = ?
    `
      )
      .get(artistId);

    if (!artist) return null;

    const profilePath = await fetchArtistProfileImage(artist.Name, undefined, artist.Id);

    const songCount = db
      .prepare(
        `
      SELECT
        COUNT(DISTINCT Track.Id) AS count
      FROM Track
      JOIN Album ON Track.AlbumId = Album.Id
      JOIN AlbumArtist ON Album.Id = AlbumArtist.AlbumId
      WHERE AlbumArtist.ArtistId = ?
    `
      )
      .get(artistId).count;

    const albumCount = db
      .prepare('SELECT COUNT(DISTINCT AlbumId) AS count FROM AlbumArtist WHERE ArtistId = ?')
      .get(artistId).count;

    return {
      Id: artist.Id,
      Name: artist.Name,
      ProfileImgUri: profilePath,
      ProfileImg: profilePath,
      SongCount: songCount,
      AlbumCount: albumCount,
    };
  });

  ipcMain.handle('get-album-artist-songs', (e, { artistId }) => {
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
        GROUP_CONCAT(DISTINCT Artist2.Name) AS ArtistName,
        Album.Title AS AlbumTitle,
        Album.Id AS AlbumId,
        Genre.Name AS GenreName
      FROM Track
      JOIN TrackArtist ON Track.Id = TrackArtist.TrackId
      JOIN Artist AS Artist2 ON TrackArtist.ArtistId = Artist2.Id
      LEFT JOIN Album ON Track.AlbumId = Album.Id
      LEFT JOIN Genre ON Track.GenreId = Genre.Id
      WHERE Track.Id IN (
        SELECT Track.Id FROM Track
        JOIN Album ON Track.AlbumId = Album.Id
        JOIN AlbumArtist ON Album.Id = AlbumArtist.AlbumId
        WHERE AlbumArtist.ArtistId = ?
      )
      GROUP BY Track.Id
      ORDER BY COALESCE(CAST(Track.TrackNumber AS INTEGER), 9999), Track.Title COLLATE NOCASE
    `
      )
      .all(artistId);

    return rows;
  });

  ipcMain.handle('get-album-artist-albums', (e, { artistId }) => {
    const rows = db
      .prepare(
        `
      SELECT
        Album.Id,
        Album.Title,
        COALESCE(
          Album.ReleaseYear,
          MIN(CAST(Track.ReleaseYear AS INTEGER)),
          MIN(CAST(Track.Year AS INTEGER))
        ) AS ReleaseYear,
        Album.CoverUri,
        COUNT(Track.Id) AS SongCount
      FROM Album
      JOIN AlbumArtist ON Album.Id = AlbumArtist.AlbumId
      LEFT JOIN Track ON Album.Id = Track.AlbumId
      WHERE AlbumArtist.ArtistId = ?
      GROUP BY Album.Id
      ORDER BY Album.Title COLLATE NOCASE
    `
      )
      .all(artistId);

    return rows.map(album => {
      const coverPath = path.join(ALBUM_ART_DIR, `${album.Id}.jpg`);
      return {
        ...album,
        coverUri: album.CoverUri || (fs.existsSync(coverPath) ? coverPath : null),
      };
    });
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
          GROUP_CONCAT(DISTINCT Artist2.Name) AS ArtistName,
          Album.Id AS AlbumId,
          Album.Title AS AlbumTitle,
          Genre.Name AS GenreName
        FROM Track
        JOIN TrackArtist ON Track.Id = TrackArtist.TrackId
        JOIN Artist AS Artist2 ON TrackArtist.ArtistId = Artist2.Id
        LEFT JOIN Album ON Track.AlbumId = Album.Id
        LEFT JOIN Genre ON Track.GenreId = Genre.Id
        WHERE Track.Title LIKE ? COLLATE NOCASE
        GROUP BY Track.Id
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
          COALESCE(
            Album.ReleaseYear,
            MIN(CAST(Track.ReleaseYear AS INTEGER)),
            MIN(CAST(Track.Year AS INTEGER))
          ) AS ReleaseYear,
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
          COUNT(DISTINCT TrackArtist.TrackId) AS SongCount
        FROM Artist
        LEFT JOIN TrackArtist ON Artist.Id = TrackArtist.ArtistId
        LEFT JOIN Track ON TrackArtist.TrackId = Track.Id
        WHERE Artist.Name LIKE ? COLLATE NOCASE
        GROUP BY Artist.Id
        HAVING COUNT(DISTINCT TrackArtist.TrackId) > 0
        ORDER BY 
          CASE WHEN LOWER(Artist.Name) = ? THEN 0 ELSE 1 END,
          Artist.Name COLLATE NOCASE
        LIMIT 10
      `
        )
        .all(searchPattern, exactQuery);

      // Search album artists
      const albumArtists = db
        .prepare(
          `
        SELECT
          Artist.Id,
          Artist.Name,
          Artist.ProfileImgUri,
          COUNT(DISTINCT AlbumArtist.AlbumId) AS AlbumCount
        FROM Artist
        JOIN AlbumArtist ON Artist.Id = AlbumArtist.ArtistId
        LEFT JOIN Album ON AlbumArtist.AlbumId = Album.Id
        WHERE Artist.Name LIKE ? COLLATE NOCASE
        GROUP BY Artist.Id
        HAVING COUNT(DISTINCT AlbumArtist.AlbumId) > 0
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
    // Apply persisted window scale before doing anything else
    try {
      const persistedScale = clampWindowScale(readSettingsFile().windowScale);
      mainWin.webContents.setZoomFactor(persistedScale);
    } catch (err) {
      console.warn('Failed to apply window scale on load:', err);
    }

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

    const settings = readSettingsFile();

    activeScanWorker = fork(
      path.resolve(process.cwd(), 'src', 'main', 'utils', 'musicScanWorker.js')
    );
    // Use basic/optimistic scan on startup — only process new files, skip known ones
    activeScanWorker.send({
      folders,
      config,
      mode: 'basic',
      librarySettings: settings.library,
    });
    sendMessageToRendererProcess(mainWin, 'scan-start', null);

    activeScanWorker.on('message', rawMsg => {
      const msg = rawMsg as {
        type?: string;
        success?: boolean;
        scanned?: number;
        removed?: number;
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
        const scanned = msg.scanned ?? 0;
        const removed = msg.removed ?? 0;
        console.log(`[Auto-scan] +${scanned} new, -${removed} removed.`);
        if (scanned > 0 || removed > 0) {
          sendMessageToRendererProcess(mainWin, 'library-updated', { scanned, removed });
        }
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

  // ── Track DB info for Info/Tags dialog ───────────────────────────────────
  ipcMain.handle('get-track-db-info', (_, { trackId }: { trackId: number | string }) => {
    return (
      db.prepare('SELECT PlayedTimes, LastPlayedAt FROM Track WHERE Id = ?').get(trackId) ?? null
    );
  });

  ipcMain.handle('reveal-file', (_, { filePath }: { filePath: string }) => {
    shell.showItemInFolder(filePath);
    return { success: true };
  });

  ipcMain.on('reveal-folder', (_, { folderPath }: { folderPath: string }) => {
    if (!folderPath) return;
    shell.openPath(folderPath);
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
