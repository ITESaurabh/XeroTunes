import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  screen,
  shell,
  utilityProcess,
} from 'electron';
import { fileURLToPath } from 'url';
import { prevIcon, nextIcon, playIcon, pauseIcon } from '../thumbarIcons';
import dbModule from '../db';
import {
  setPresenceEnabled,
  updatePresence,
  clearPresence,
  destroyPresence,
} from '../modules/DiscordPresence';
import {
  setCastListeners,
  startDiscovery as castStartDiscovery,
  stopDiscovery as castStopDiscovery,
  connect as castConnect,
  loadMedia as castLoadMedia,
  control as castControl,
  disconnect as castDisconnect,
  destroyCast,
  CastControlAction,
  CastLoadPayload,
} from '../modules/Cast';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db: any = dbModule;
import path from 'path';
import fs from 'fs';
import {
  APP_CONF_FOLDER,
  MUSIC_DIR,
  ALBUM_ART_DIR,
  ARTIST_ART_DIR,
  FIRSTRUN_FILE,
} from '../../config/core_config';
import {
  AppSettings,
  DEFAULT_APP_SETTINGS,
  ResetTarget,
  clampWindowScale,
} from '../../config/app_settings';
import { registerArtistIpc } from '../ipc/artists';
import { TRACK_ARTIST_NAMES, albumArtistNames } from '../db/fragments';
import { cleanupOrphans } from '../db/cleanup';
import { ScanMode, REPO_URL } from '../../config/constants';
import { CHANNEL, IDENTITY } from '../../config/channel';
import { isUnderAnyRoot } from './libraryRules';
import { buildTrackIndex, matchFavourite } from './favouriteMatch';
import os from 'os';

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

const rmPath = (target: string) => fs.rmSync(target, { recursive: true, force: true });

// Emptied in place rather than deleted: the connection stays open and valid, and
// the schema mainIpcs creates at startup doesn't have to be rebuilt.
function wipeDatabase() {
  // sqlite_sequence only appears once an AUTOINCREMENT table exists, and clearing
  // it is what makes ids start from 1 again.
  const tables = dbModule
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND (name NOT LIKE 'sqlite_%' OR name = 'sqlite_sequence')`
    )
    .all() as Array<{ name: string }>;

  dbModule.transaction(() => {
    for (const { name } of tables) dbModule.prepare(`DELETE FROM "${name}"`).run();
  })();
  dbModule.exec('VACUUM');
}

const emptyDir = (dir: string) => {
  rmPath(dir);
  fs.mkdirSync(dir, { recursive: true });
};

function dropTracksOutsideFolders(): number {
  const roots = (db.prepare('SELECT Uri FROM MusicFolder').all() as { Uri: string }[]).map(
    r => r.Uri
  );
  const tracks = db.prepare('SELECT Id, Uri FROM Track').all() as { Id: number; Uri: string }[];
  const del = db.prepare('DELETE FROM Track WHERE Id = ?');

  let removed = 0;
  for (const track of tracks) {
    if (isUnderAnyRoot(track.Uri, roots)) continue;
    del.run(track.Id);
    removed++;
  }
  if (removed > 0) cleanupOrphans(db, { ALBUM_ART_DIR, ARTIST_ART_DIR });
  return removed;
}

// ── Favourites portability ───────────────────────────────────────────────────
// Favourites are stored by TrackId, which a wipe or a fresh install invalidates.
// Both the .xtfav export and the reset stash below carry file hash + filename
// instead: the sha1 covers the whole file, so it survives a rename but not a tag
// edit — the filename catches the tracks whose tags changed.

const PENDING_FAVOURITES_FILE = path.join(APP_CONF_FOLDER, 'pending_favourites.xtfav');
const FAVOURITES_FILE_VERSION = 1;

export interface FavouriteEntry {
  hash: string | null;
  file: string;
  title: string;
  artist: string;
  favouritedAt: number | null;
}

function snapshotFavourites(): FavouriteEntry[] {
  const rows = db
    .prepare(
      `SELECT Track.Uri, Track.FileHash, Track.Title, ${TRACK_ARTIST_NAMES}, Favourite.AddedAt
       FROM Favourite
       JOIN Track ON Track.Id = Favourite.TrackId
       ORDER BY Favourite.AddedAt DESC`
    )
    .all() as Array<{
    Uri: string | null;
    FileHash: string | null;
    Title: string | null;
    ArtistName: string | null;
    AddedAt: number | null;
  }>;
  return rows.map(row => ({
    hash: row.FileHash || null,
    file: path.basename(row.Uri || ''),
    title: row.Title || '',
    artist: row.ArtistName || '',
    favouritedAt: row.AddedAt ?? null,
  }));
}

function restoreFavourites(entries: FavouriteEntry[]): {
  imported: number;
  skipped: number;
  failed: FavouriteEntry[];
} {
  const index = buildTrackIndex(db.prepare('SELECT Id, Uri, FileHash FROM Track').all());
  const insert = db.prepare('INSERT OR IGNORE INTO Favourite (TrackId, AddedAt) VALUES (?, ?)');

  let imported = 0;
  let skipped = 0;
  const failed: FavouriteEntry[] = [];
  for (const entry of entries) {
    const trackId = matchFavourite(index, entry);
    if (trackId == null) {
      if (entry && typeof entry === 'object') failed.push(entry);
      continue;
    }
    if (insert.run(trackId, entry.favouritedAt ?? Date.now()).changes > 0) imported++;
    else skipped++;
  }
  return { imported, skipped, failed };
}

function favouritesFileBody(tracks: FavouriteEntry[]) {
  return {
    app: IDENTITY.productName,
    type: 'favourites',
    version: FAVOURITES_FILE_VERSION,
    exportedAt: Date.now(),
    tracks,
  };
}

function readFavouritesFile(filePath: string): FavouriteEntry[] {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (parsed?.type !== 'favourites' || !Array.isArray(parsed.tracks)) {
    throw new Error('Not a XeroTunes favourites file');
  }
  return parsed.tracks as FavouriteEntry[];
}

// Wiping the database throws the TrackIds away, so stash the favourites first and
// re-attach them once a scan has repopulated the library. Entries that still have
// no match stay in the file, so adding the rest of the folders later picks them up.
function stashFavourites(): void {
  const tracks = snapshotFavourites();
  if (!tracks.length) return;
  try {
    ensureAppConfFolder();
    fs.writeFileSync(PENDING_FAVOURITES_FILE, JSON.stringify(favouritesFileBody(tracks), null, 2));
  } catch (error) {
    console.warn('Failed to stash favourites before wipe:', error);
  }
}

function restorePendingFavourites(): number {
  if (!fs.existsSync(PENDING_FAVOURITES_FILE)) return 0;
  try {
    const { imported, failed } = restoreFavourites(readFavouritesFile(PENDING_FAVOURITES_FILE));
    if (failed.length) {
      fs.writeFileSync(
        PENDING_FAVOURITES_FILE,
        JSON.stringify(favouritesFileBody(failed), null, 2)
      );
    } else {
      rmPath(PENDING_FAVOURITES_FILE);
    }
    if (imported > 0) console.log(`[favourites] Restored ${imported} favourite(s) after reset.`);
    return imported;
  } catch (error) {
    console.warn('Failed to restore pending favourites:', error);
    rmPath(PENDING_FAVOURITES_FILE);
    return 0;
  }
}

// Ordered, not a lookup map: resetting themes rewrites settings.json, so it has
// to run before a settings reset deletes the file out from under it. 'favourites'
// runs after 'database' so selecting both drops the stash the wipe just made.
const RESET_ACTIONS: Array<[Exclude<ResetTarget, 'localState'>, () => void]> = [
  ['themes', () => writeSettingsFile({ ...readSettingsFile(), theme: DEFAULT_APP_SETTINGS.theme })],
  ['settings', () => rmPath(SETTINGS_FILE)],
  [
    'database',
    () => {
      stashFavourites();
      wipeDatabase();
    },
  ],
  [
    'favourites',
    () => {
      db.prepare('DELETE FROM Favourite').run();
      rmPath(PENDING_FAVOURITES_FILE);
    },
  ],
  ['firstrun', () => rmPath(FIRSTRUN_FILE)],
  ['albumArts', () => emptyDir(ALBUM_ART_DIR)],
  ['artistArts', () => emptyDir(ARTIST_ART_DIR)],
];

// Registered separately from mainIpcs: the mini player (--file launch) runs
// without a main window, but its renderer still reads/writes settings.
export function registerSettingsIpc() {
  ipcMain.on('read-app-settings-sync', event => {
    event.returnValue = readSettingsFile();
  });
  ipcMain.on('write-app-settings-sync', (event, settings) => {
    writeSettingsFile(settings);
    event.returnValue = settings;
  });

  ipcMain.on('get-onboarding-status', event => {
    event.returnValue = fs.existsSync(FIRSTRUN_FILE);
  });
  ipcMain.on('complete-onboarding', (event, meta) => {
    ensureAppConfFolder();
    const payload = {
      version: app.getVersion(),
      completedAt: Date.now(),
      ...(meta && typeof meta === 'object' ? meta : {}),
    };
    try {
      fs.writeFileSync(FIRSTRUN_FILE, JSON.stringify(payload, null, 2));
    } catch (error) {
      console.warn('Failed to write firstrun file:', error);
    }
    event.returnValue = true;
  });
  ipcMain.on('reset-onboarding', event => {
    try {
      if (fs.existsSync(FIRSTRUN_FILE)) fs.unlinkSync(FIRSTRUN_FILE);
    } catch (error) {
      console.warn('Failed to remove firstrun file:', error);
    }
    event.returnValue = true;
  });

  ipcMain.handle('factory-reset', (_event, { targets }: { targets?: ResetTarget[] }) => {
    const selected = new Set(targets ?? []);
    const failed: ResetTarget[] = [];

    for (const [target, run] of RESET_ACTIONS) {
      if (!selected.has(target)) continue;
      try {
        run();
      } catch (error) {
        console.warn(`Factory reset failed for ${target}:`, error);
        failed.push(target);
      }
    }
    return { failed };
  });

  ipcMain.on('restart-app', () => {
    app.relaunch();
    app.exit(0);
  });
}

function sendMessageToRendererProcess(
  window: BrowserWindow,
  message: string,
  payload?: unknown
): void {
  window.webContents.send(message, payload);
}

// ── Google Cast IPC ──────────────────────────────────────────────────────────
// Cast.ts keeps one session in module state, so only the main window binds these.
function registerCastIpc(mainWin: BrowserWindow) {
  const send = (channel: string, payload?: unknown) => {
    if (!mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
  };

  setCastListeners({
    onDevices: devices => send('cast-devices', devices),
    onStatus: status => send('cast-status', status),
    onConnected: deviceId => send('cast-connected', deviceId),
    onEnded: () => send('cast-ended'),
    onError: message => send('cast-error', { message }),
  });

  ipcMain.on('cast-start-discovery', () => castStartDiscovery());
  ipcMain.on('cast-stop-discovery', () => castStopDiscovery());
  ipcMain.on('cast-connect', (_e, { deviceId }: { deviceId: string }) => castConnect(deviceId));
  ipcMain.on('cast-load', (_e, payload: CastLoadPayload) => {
    void castLoadMedia(payload);
  });
  ipcMain.on(
    'cast-control',
    (_e, { action, value }: { action: CastControlAction; value?: number }) =>
      castControl(action, value)
  );
  ipcMain.on('cast-disconnect', () => castDisconnect());
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
    destroyCast();
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy();
  });

  registerCastIpc(mainWin);

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
  // Mode of the running scan; the renderer locks navigation only for a full rescan.
  let activeScanMode: ScanMode | null = null;

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
    return { isScanning: activeScanWorker !== null, scanMode: activeScanMode };
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
      const favourites = (
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM Favourite JOIN Track ON Track.Id = Favourite.TrackId'
          )
          .get() as { count: number }
      ).count;
      // Playlists table doesn't exist yet — return 0
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

  function spawnScanWorker(mode: ScanMode): Promise<unknown> {
    if (activeScanWorker) {
      return Promise.resolve({ success: false, error: 'Scan already in progress' });
    }
    const folders = db.prepare('SELECT * FROM MusicFolder').all();
    if (!folders.length) return Promise.resolve({ success: false, error: 'No folders to scan' });

    const config = { APP_CONF_FOLDER, MUSIC_DIR, ALBUM_ART_DIR, ARTIST_ART_DIR };
    const settings = readSettingsFile();
    // utilityProcess, not child_process.fork: the RunAsNode fuse is off in the
    // packaged app. Worker is bundled to .webpack/main alongside __dirname.
    activeScanWorker = utilityProcess.fork(path.join(__dirname, 'musicScanWorker.js'));
    activeScanMode = mode;
    activeScanWorker.postMessage({ folders, config, mode, librarySettings: settings.library });
    sendMessageToRendererProcess(mainWin, 'scan-start', mode);

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
        const restored = restorePendingFavourites();
        if (scanned > 0 || removed > 0 || restored > 0) {
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
      activeScanMode = null;
      sendMessageToRendererProcess(mainWin, 'scan-end', null);
      if (code !== 0) rejectPromise('Worker exited with code ' + code);
    });

    return scanPromise;
  }

  ipcMain.handle('scan-media', () => spawnScanWorker('basic'));

  ipcMain.handle('full-rescan', () => spawnScanWorker('full'));

  ipcMain.handle('reapply-artist-rules', () => spawnScanWorker('artists'));

  // Byte-identical files only: FileHash is a sha1 of the whole file, so the same
  // song at a different bitrate is a different file and deliberately not reported.
  ipcMain.handle('find-duplicate-tracks', () => {
    const rows = db
      .prepare(
        `
      SELECT
        Track.Id,
        Track.Title,
        Track.Uri,
        Track.Duration,
        Track.FileHash,
        Track.DateAdded,
        ${TRACK_ARTIST_NAMES},
        Album.Title AS AlbumTitle
      FROM Track
      LEFT JOIN Album ON Track.AlbumId = Album.Id
      WHERE Track.FileHash IN (
        SELECT FileHash FROM Track
        WHERE FileHash IS NOT NULL AND TRIM(FileHash) <> ''
        GROUP BY FileHash HAVING COUNT(*) > 1
      )
      ORDER BY Track.FileHash, Track.DateAdded, Track.Id
    `
      )
      .all() as Array<{ FileHash: string }>;

    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const group = groups.get(row.FileHash);
      if (group) group.push(row);
      else groups.set(row.FileHash, [row]);
    }
    return [...groups.entries()].map(([fileHash, tracks]) => ({ fileHash, tracks }));
  });

  // Remembers the paths too, so the next scan doesn't re-add files still on disk.
  ipcMain.handle('remove-tracks-from-library', (_e, { trackIds }: { trackIds?: number[] }) => {
    const ids = (trackIds ?? []).filter(id => Number.isInteger(id));
    if (!ids.length) return { success: true, removed: 0 };

    const select = db.prepare('SELECT Uri FROM Track WHERE Id = ?');
    const ignore = db.prepare('INSERT OR REPLACE INTO IgnoredTrack (Uri, IgnoredAt) VALUES (?, ?)');
    const del = db.prepare('DELETE FROM Track WHERE Id = ?');

    db.transaction(() => {
      for (const id of ids) {
        const row = select.get(id) as { Uri: string } | undefined;
        if (row?.Uri) ignore.run(row.Uri, Date.now());
        del.run(id);
      }
    })();
    cleanupOrphans(db, { ALBUM_ART_DIR, ARTIST_ART_DIR });

    sendMessageToRendererProcess(mainWin, 'library-updated', { removed: ids.length });
    return { success: true, removed: ids.length };
  });

  ipcMain.handle('get-ignored-track-count', () => {
    return (db.prepare('SELECT COUNT(*) AS count FROM IgnoredTrack').get() as { count: number })
      .count;
  });

  // Forgetting the list is enough; the files are still on disk, so the next scan
  // puts them back.
  ipcMain.handle('restore-ignored-tracks', () => {
    const removed = db.prepare('DELETE FROM IgnoredTrack').run().changes;
    return { success: true, restored: removed };
  });

  ipcMain.handle('get-app-info', () => ({
    name: IDENTITY.productName,
    version: app.getVersion(),
    channel: CHANNEL,
    license: 'GPL-3.0',
    repo: REPO_URL,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${os.type()} ${os.release()} (${process.arch})`,
    dataDir: APP_CONF_FOLDER,
  }));

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
         ArtistFetchedAt INTEGER,
         Version INTEGER
       )`
  ).run();

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
    LastPlayedAt BIGINT,
    RawArtist TEXT,
    RawAlbumArtist TEXT
  )
`
  ).run();

  // Files the user dropped from the library without deleting them from disk.
  db.prepare(
    `
  CREATE TABLE IF NOT EXISTS IgnoredTrack (
    Uri TEXT PRIMARY KEY,
    IgnoredAt BIGINT
  )
`
  ).run();

  // Rows can outlive their track (a deleted file leaves one behind); every read
  // joins Track, so orphans are invisible. Track ids are AUTOINCREMENT and never
  // reused, so a stale row can't attach itself to a different song.
  db.prepare(
    `
  CREATE TABLE IF NOT EXISTS Favourite (
    TrackId INTEGER PRIMARY KEY,
    AddedAt BIGINT
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
  // NULL means the row predates raw-tag storage; the artist-rules pass backfills it.
  if (!existingCols.includes('RawArtist')) {
    db.prepare('ALTER TABLE Track ADD COLUMN RawArtist TEXT').run();
  }
  if (!existingCols.includes('RawAlbumArtist')) {
    db.prepare('ALTER TABLE Track ADD COLUMN RawAlbumArtist TEXT').run();
  }
  const existingArtistCols = (db.pragma('table_info(Artist)') as { name: string }[]).map(
    c => c.name
  );
  if (!existingArtistCols.includes('ArtistMetaJson')) {
    db.prepare('ALTER TABLE Artist ADD COLUMN ArtistMetaJson TEXT').run();
  }
  if (!existingArtistCols.includes('ArtistFetchedAt')) {
    db.prepare('ALTER TABLE Artist ADD COLUMN ArtistFetchedAt INTEGER').run();
  }

  ipcMain.handle('save-image', async (_e, { src, suggestedName }) => {
    try {
      if (!src || typeof src !== 'string') {
        return { success: false, error: 'No image source' };
      }

      // Resolve the source to raw bytes + a sensible default extension.
      let data: Buffer;
      let ext = '.jpg';

      if (src.startsWith('data:')) {
        const match = /^data:(.*?);base64,(.*)$/s.exec(src);
        if (!match) return { success: false, error: 'Unsupported image data' };
        data = Buffer.from(match[2], 'base64');
        const mime = match[1];
        if (mime.includes('png')) ext = '.png';
        else if (mime.includes('webp')) ext = '.webp';
        else if (mime.includes('gif')) ext = '.gif';
      } else if (src.startsWith('file://')) {
        const filePath = fileURLToPath(src);
        data = fs.readFileSync(filePath);
        ext = path.extname(filePath) || ext;
      } else if (src.startsWith('http://') || src.startsWith('https://')) {
        const res = await fetch(src);
        if (!res.ok) return { success: false, error: `Download failed (${res.status})` };
        data = Buffer.from(await res.arrayBuffer());
        ext = path.extname(new URL(src).pathname) || ext;
      } else {
        // Assume a bare local filesystem path.
        data = fs.readFileSync(src);
        ext = path.extname(src) || ext;
      }

      // Build a filesystem-safe default filename from the provided title.
      const rawName = (typeof suggestedName === 'string' && suggestedName.trim()) || 'image';
      const safeBase = rawName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
      const defaultName = path.extname(safeBase) ? safeBase : `${safeBase}${ext}`;

      let baseDir: string;
      try {
        baseDir = app.getPath('pictures');
      } catch {
        baseDir = app.getPath('downloads');
      }

      const result = await dialog.showSaveDialog(mainWin, {
        title: 'Save Image',
        defaultPath: path.join(baseDir, defaultName),
        filters: [
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      fs.writeFileSync(result.filePath, data);
      return { success: true, filePath: result.filePath };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('export-theme', async (_e, { theme }) => {
    try {
      const name = typeof theme?.name === 'string' && theme.name.trim() ? theme.name : 'theme';
      const safeName = name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
      const result = await dialog.showSaveDialog(mainWin, {
        title: 'Export Theme',
        defaultPath: path.join(app.getPath('downloads'), `${safeName}.json`),
        filters: [{ name: 'Theme', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { success: false, canceled: true };
      fs.writeFileSync(result.filePath, JSON.stringify(theme, null, 2));
      return { success: true, filePath: result.filePath };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('import-theme', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWin, {
        title: 'Import Theme',
        properties: ['openFile'],
        filters: [{ name: 'Theme', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePaths?.length) return { success: false, canceled: true };
      // Parsing here keeps a malformed file from reaching the renderer as a raw string.
      return { success: true, theme: JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8')) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('show-confirm', async (_e, options) => {
    const {
      title = 'Confirm',
      message = 'Are you sure?',
      detail,
      confirmLabel = 'OK',
      cancelLabel = 'Cancel',
      destructive = false,
    } = options || {};

    const result = await dialog.showMessageBox(mainWin, {
      type: destructive ? 'warning' : 'question',
      buttons: [confirmLabel, cancelLabel],
      defaultId: destructive ? 1 : 0,
      cancelId: 1,
      title,
      message,
      detail,
      noLink: true,
    });

    return { confirmed: result.response === 0 };
  });

  ipcMain.handle('add-music-folder', async (e, opts?: { skipScan?: boolean }) => {
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

    // Onboarding adds folders up front then scans once itself, so it opts out here.
    if (!opts?.skipScan) {
      spawnScanWorker('basic').catch(err => console.error('[add-folder] Scan error:', err));
    }

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
          ${TRACK_ARTIST_NAMES},
          Album.Title AS AlbumTitle,
          Genre.Name AS GenreName
        FROM Track
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
        ${TRACK_ARTIST_NAMES},
        Album.Title AS AlbumTitle,
        Genre.Name AS GenreName
      FROM Track
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
    const wiped = remaining.cnt === 0;
    if (wiped) {
      db.prepare('DELETE FROM Track').run();
      db.prepare('DELETE FROM Album').run();
      db.prepare('DELETE FROM Artist').run();
      db.prepare('DELETE FROM Genre').run();
      // The artist / album-artist stats count these join tables directly.
      db.prepare('DELETE FROM TrackArtist').run();
      db.prepare('DELETE FROM AlbumArtist').run();
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

    // Dropped by "not under any root" rather than by the removed path: library
    // folders can nest, so a broader root may still cover these files.
    const removed = wiped ? 0 : dropTracksOutsideFolders();

    // Removal runs no scan, so tell the renderer to refresh caches/stats itself;
    // `wiped` also signals it to drop the now-dangling playback queue.
    sendMessageToRendererProcess(mainWin, 'library-updated', {
      removed: wiped ? 1 : removed,
      wiped,
    });

    return { success: true, wiped, removed };
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
        Track.GenreId,
        ${TRACK_ARTIST_NAMES},
        Album.Title AS AlbumTitle,
        Genre.Name AS GenreName
      FROM Track
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
        ${TRACK_ARTIST_NAMES},
        Album.Title AS AlbumTitle,
        Genre.Name AS GenreName
      FROM Track
      LEFT JOIN Album ON Track.AlbumId = Album.Id
      LEFT JOIN Genre ON Track.GenreId = Genre.Id
      GROUP BY Track.Id
      ORDER BY Track.DateAdded DESC
      LIMIT 200
    `
      )
      .all();
  });

  // ── Favourites ──────────────────────────────────────────────────────────────
  ipcMain.handle('is-favourite', (_e, { trackId }) => {
    if (trackId == null) return false;
    return !!db.prepare('SELECT 1 FROM Favourite WHERE TrackId = ?').get(trackId);
  });

  ipcMain.handle('toggle-favourite', (_e, { trackId }) => {
    if (trackId == null) return { favourite: false };
    const removed = db.prepare('DELETE FROM Favourite WHERE TrackId = ?').run(trackId).changes > 0;
    if (!removed) {
      db.prepare('INSERT INTO Favourite (TrackId, AddedAt) VALUES (?, ?)').run(trackId, Date.now());
    }
    // Reuses the library refresh broadcast — the renderer already rebuilds stats
    // and list caches on it.
    sendMessageToRendererProcess(mainWin, 'library-updated', {});
    return { favourite: !removed };
  });

  ipcMain.handle('get-favourite-songs', () => {
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
        Favourite.AddedAt AS FavouritedAt,
        ${TRACK_ARTIST_NAMES},
        Album.Title AS AlbumTitle,
        Genre.Name AS GenreName
      FROM Favourite
      JOIN Track ON Track.Id = Favourite.TrackId
      LEFT JOIN Album ON Track.AlbumId = Album.Id
      LEFT JOIN Genre ON Track.GenreId = Genre.Id
      GROUP BY Track.Id
      ORDER BY Favourite.AddedAt DESC
    `
      )
      .all();
  });

  ipcMain.handle('export-favourites', async () => {
    try {
      const tracks = snapshotFavourites();
      if (!tracks.length) return { success: false, error: 'No favourites to export' };
      // Epoch seconds keep every export from the same day a distinct file.
      const name = `favourites-${Math.floor(Date.now() / 1000)}.xtfav`;
      const result = await dialog.showSaveDialog(mainWin, {
        title: 'Export Favourites',
        defaultPath: path.join(app.getPath('documents'), name),
        filters: [{ name: 'XeroTunes Favourites', extensions: ['xtfav'] }],
      });
      if (result.canceled || !result.filePath) return { success: false, canceled: true };
      fs.writeFileSync(result.filePath, JSON.stringify(favouritesFileBody(tracks), null, 2));
      return { success: true, filePath: result.filePath, exported: tracks.length };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('import-favourites', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWin, {
        title: 'Import Favourites',
        defaultPath: app.getPath('documents'),
        properties: ['openFile'],
        filters: [{ name: 'XeroTunes Favourites', extensions: ['xtfav'] }],
      });
      if (result.canceled || !result.filePaths?.length) return { success: false, canceled: true };
      const report = restoreFavourites(readFavouritesFile(result.filePaths[0]));
      if (report.imported > 0) sendMessageToRendererProcess(mainWin, 'library-updated', {});
      return { success: true, ...report };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
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
        ${albumArtistNames('ArtistName')},
        COUNT(Track.Id) AS SongCount
      FROM Album
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
        ${TRACK_ARTIST_NAMES},
        ${albumArtistNames('AlbumArtistName')},
        Album.Title AS AlbumTitle,
        Album.Id AS AlbumId,
        Genre.Name AS GenreName
      FROM Track
      JOIN TrackArtist ON Track.Id = TrackArtist.TrackId
      JOIN Artist AS Artist2 ON TrackArtist.ArtistId = Artist2.Id
      LEFT JOIN Album ON Track.AlbumId = Album.Id
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
        ${TRACK_ARTIST_NAMES},
        Album.Title AS AlbumTitle,
        Genre.Name AS GenreName
      FROM Track
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
        Track.GenreId,
        ${TRACK_ARTIST_NAMES},
        Album.Title AS AlbumTitle,
        Genre.Name AS GenreName
      FROM Track
      LEFT JOIN Album ON Track.AlbumId = Album.Id
      LEFT JOIN Genre ON Track.GenreId = Genre.Id
      WHERE Track.Year = ?
      GROUP BY Track.Id
      ORDER BY Album.Title COLLATE NOCASE, CAST(Track.TrackNumber AS INTEGER), Track.Title COLLATE NOCASE
    `
      )
      .all(String(year));
  });

  registerArtistIpc(mainWin, () => readSettingsFile().artistImageFetchingEnabled);

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
          ${TRACK_ARTIST_NAMES},
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

    activeScanWorker = utilityProcess.fork(path.join(__dirname, 'musicScanWorker.js'));
    activeScanMode = 'basic';
    // Use basic/optimistic scan on startup — only process new files, skip known ones
    activeScanWorker.postMessage({
      folders,
      config,
      mode: 'basic',
      librarySettings: settings.library,
    });
    sendMessageToRendererProcess(mainWin, 'scan-start', 'basic');

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
        const restored = restorePendingFavourites();
        if (scanned > 0 || removed > 0 || restored > 0) {
          sendMessageToRendererProcess(mainWin, 'library-updated', { scanned, removed });
        }
      }
    });
    activeScanWorker.on('exit', (code: number) => {
      console.log(`[Auto-scan] Worker exited with code ${code}`);
      activeScanWorker = null;
      activeScanMode = null;
      sendMessageToRendererProcess(mainWin, 'scan-end', null);
    });
    activeScanWorker.on('error', err => {
      console.error('[Auto-scan] Worker error:', err);
      activeScanWorker = null;
      activeScanMode = null;
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

  // http(s) only: shell.openExternal also launches file:// and custom protocol
  // handlers, and this URL comes from renderer-side data.
  ipcMain.on('open-external', (_, { url }: { url: string }) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    shell.openExternal(url);
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
