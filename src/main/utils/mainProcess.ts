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
  ScrobbleProvider,
  ScrobbleTrack,
  getScrobblerStatus,
  startWebAuth,
  finishWebAuth,
  connectWithToken,
  disconnectScrobbler,
  setScrobblerEnabled,
  scrobblerNowPlaying,
  scrobbleTrack,
  initScrobbler,
} from '../modules/Scrobbler';
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
import { startStreamMeta, stopStreamMeta, StreamMetadata } from '../modules/StreamMeta';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db: any = dbModule;

type ScrobblePayload = ScrobbleTrack & { trackId?: number };
import path from 'path';
import fs from 'fs';
import {
  APP_CONF_FOLDER,
  MUSIC_DIR,
  ALBUM_ART_DIR,
  ARTIST_ART_DIR,
  STREAM_ART_DIR,
  FIRSTRUN_FILE,
} from '../../config/core_config';
import {
  AppSettings,
  DEFAULT_APP_SETTINGS,
  ResetTarget,
  clampWindowScale,
} from '../../config/app_settings';
import { registerArtistIpc } from '../ipc/artists';
import { registerSourceIpc } from '../ipc/sources';
import { schemeRoot } from '../sources/registry';
import { cancelSync, installSourceAuth, isSyncing, syncAllSources } from '../sources/sync';
import { TRACK_ARTIST_NAMES, albumArtistNames } from '../db/fragments';
import { cleanupOrphans } from '../db/cleanup';
import { ScanMode, REPO_URL, isTaggable } from '../../config/constants';
import { CHANNEL, IDENTITY } from '../../config/channel';
import { isUnderAnyRoot } from './libraryRules';
import { buildTrackIndex, matchFavourite } from './favouriteMatch';
import { parsePlaylistFile, writePlaylistFile } from './playlistFormats';
import { writeTags, TagFields } from './tagWriter';
// eslint-disable-next-line import/no-unresolved -- ESM-only package; same gap ipc.tsx already has
import { parseFile as parseAudioFile } from 'music-metadata';
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
      // Stream covers are keyed by a row that no longer exists.
      emptyDir(STREAM_ART_DIR);
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

  // Set while the close prompt is up, so hammering the X can't stack dialogs.
  let askingAboutSync = false;

  // A sync writes rows as it goes, so closing mid-way leaves a server half
  // imported. The prompt is a system dialog because it has to outlive the window
  // the user is closing.
  mainWin.on('close', event => {
    if (isSyncing()) {
      event.preventDefault();
      if (askingAboutSync) return;
      askingAboutSync = true;
      void dialog
        .showMessageBox(mainWin, {
          type: 'warning',
          buttons: ['Keep Syncing', 'Cancel Sync and Close'],
          defaultId: 0,
          cancelId: 0,
          title: 'Sync in progress',
          message: 'A library sync is still running.',
          detail:
            'Closing now would leave the server half imported. Tracks already imported are kept either way.',
        })
        .then(({ response }) => {
          askingAboutSync = false;
          if (response !== 1) return;
          cancelSync();
          // The sync stops at its next track, not instantly; wait it out.
          const closeWhenIdle = setInterval(() => {
            if (isSyncing()) return;
            clearInterval(closeWhenIdle);
            if (!mainWin.isDestroyed()) mainWin.close();
          }, 200);
        })
        .catch(() => {
          askingAboutSync = false;
        });
      return;
    }
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
      const playlists = (
        db.prepare('SELECT COUNT(*) AS count FROM Playlist').get() as { count: number }
      ).count;
      const streams = (
        db.prepare('SELECT COUNT(*) AS count FROM Stream').get() as { count: number }
      ).count;
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
        streams,
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
        streams: 0,
        recentlyAdded: 0,
      };
    }
  });

  function spawnScanWorker(
    mode: ScanMode,
    files?: string[],
    // Off when the caller brackets several phases with its own scan-start/end.
    emitLifecycle = true
  ): Promise<unknown> {
    if (activeScanWorker) {
      return Promise.resolve({ success: false, error: 'Scan already in progress' });
    }
    const folders = db.prepare('SELECT * FROM MusicFolder').all();
    // 'files' names its targets outright, so it does not need a folder to walk.
    if (!folders.length && mode !== 'files') {
      return Promise.resolve({ success: false, error: 'No folders to scan' });
    }

    const config = { APP_CONF_FOLDER, MUSIC_DIR, ALBUM_ART_DIR, ARTIST_ART_DIR };
    const settings = readSettingsFile();
    // utilityProcess, not child_process.fork: the RunAsNode fuse is off in the
    // packaged app. Worker is bundled to .webpack/main alongside __dirname.
    activeScanWorker = utilityProcess.fork(path.join(__dirname, 'musicScanWorker.js'));
    activeScanMode = mode;
    activeScanWorker.postMessage({
      folders,
      config,
      mode,
      files,
      librarySettings: settings.library,
    });
    if (emitLifecycle) sendMessageToRendererProcess(mainWin, 'scan-start', mode);

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
      if (emitLifecycle) sendMessageToRendererProcess(mainWin, 'scan-end', null);
      if (code !== 0) rejectPromise('Worker exited with code ' + code);
    });

    return scanPromise;
  }

  /**
   * Local folders first, then every connected server. One button rather than one
   * per source: the scan used to refuse outright with no music folders
   * configured, leaving a remote-only library with no way to refresh at all.
   */
  async function refreshLibrary(mode: 'basic' | 'full', { localOnly = false } = {}) {
    const hasFolders =
      (db.prepare('SELECT COUNT(*) AS c FROM MusicFolder').get() as { c: number }).c > 0;
    const hasSources =
      !localOnly && (db.prepare('SELECT COUNT(*) AS c FROM Source').get() as { c: number }).c > 0;
    if (!hasFolders && !hasSources) {
      // Nothing to do isn't a failure when the caller only wanted the folders:
      // that's a view mounting, which has no button to report an error on.
      return localOnly
        ? { success: true, scanned: 0 }
        : { success: false, error: 'Nothing to scan. Add a music folder or a server.' };
    }

    sendMessageToRendererProcess(mainWin, 'scan-start', mode);
    try {
      const local = hasFolders
        ? ((await spawnScanWorker(mode, undefined, false)) as {
            success?: boolean;
            scanned?: number;
            error?: string;
          })
        : { success: true, scanned: 0 };
      const remote = hasSources
        ? await syncAllSources(mainWin, readSettingsFile().library)
        : { synced: 0, imported: 0, error: undefined as string | undefined };
      return {
        success: local.success !== false,
        scanned: (local.scanned ?? 0) + remote.imported,
        syncedSources: remote.synced,
        error: local.error ?? remote.error,
      };
    } finally {
      sendMessageToRendererProcess(mainWin, 'scan-end', null);
    }
  }

  // `localOnly` is for the refresh a view fires on mount: walking a server is a
  // round trip per folder, far too much to spend on opening a screen.
  ipcMain.handle('scan-media', (_e, args) =>
    refreshLibrary('basic', { localOnly: args?.localOnly === true })
  );

  ipcMain.handle('full-rescan', () => refreshLibrary('full'));

  ipcMain.handle('reapply-artist-rules', () => spawnScanWorker('artists'));

  // ── Tag editing ─────────────────────────────────────────────────────────────
  ipcMain.handle('pick-image-file', async () => {
    const result = await dialog.showOpenDialog(mainWin, {
      title: 'Select Album Art',
      properties: ['openFile'],
      // JPEG and PNG only: webp/gif/bmp embed cleanly, but Windows Explorer,
      // Windows Media Player and most hardware players show no art for them.
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }],
    });
    if (result.canceled || !result.filePaths?.length) return { canceled: true };
    return { canceled: false, filePath: result.filePaths[0] };
  });

  // One handler for both editor modes: an album edit is the same write repeated
  // over every track id, with only the album-level fields set.
  //
  // `artOnlyTrackIds` (cover but none of the text edits) must ride along in this
  // same call: only one scan worker runs at a time, so a second write-track-tags
  // call would find the scan busy, skip its re-index, and leave those tracks
  // pointing at the art cache this handler just cleared.
  ipcMain.handle(
    'write-track-tags',
    async (
      _e,
      {
        trackIds,
        fields,
        artOnlyTrackIds = [],
      }: { trackIds: number[]; fields: TagFields; artOnlyTrackIds?: number[] }
    ) => {
      const editIds = Array.isArray(trackIds) ? trackIds : [];
      const artIds = Array.isArray(artOnlyTrackIds) ? artOnlyTrackIds : [];
      const allIds = [...new Set([...editIds, ...artIds])];
      if (!allIds.length) {
        return { success: false, error: 'No tracks selected' };
      }
      const placeholders = allIds.map(() => '?').join(', ');
      const rows = db
        .prepare(`SELECT Id, Uri, AlbumId FROM Track WHERE Id IN (${placeholders})`)
        .all(...allIds) as { Id: number; Uri: string; AlbumId: number | null }[];
      if (!rows.length) return { success: false, error: 'Tracks not found' };

      const editSet = new Set(editIds);
      const artOnlyFields: TagFields = { artPath: fields.artPath };
      const failed: { uri: string; error: string }[] = [];
      const written: string[] = [];
      const writtenRows: typeof rows = [];
      for (const row of rows) {
        if (!isTaggable(row.Uri)) {
          failed.push({ uri: row.Uri, error: 'This file format cannot be tagged' });
          continue;
        }
        try {
          writeTags(row.Uri, editSet.has(row.Id) ? fields : artOnlyFields);
          written.push(row.Uri);
          writtenRows.push(row);
        } catch (err) {
          failed.push({ uri: row.Uri, error: err instanceof Error ? err.message : String(err) });
        }
      }

      const albumJpg = (id: number) => path.join(ALBUM_ART_DIR, `${id}.jpg`);
      const trackJpg = (id: number) => path.join(ALBUM_ART_DIR, `track-${id}.jpg`);
      const albumIds = [
        ...new Set(rows.map(r => r.AlbumId).filter((id): id is number => id != null)),
      ];
      // An album counts as shared the moment one of its tracks is outside this
      // edit; nothing below may touch its cache, since every track on the album
      // reads that one file.
      const idList = allIds.map(() => '?').join(', ');
      const shared = new Set(
        albumIds.filter(
          id =>
            (
              db
                .prepare(
                  `SELECT COUNT(*) AS n FROM Track WHERE AlbumId = ? AND Id NOT IN (${idList})`
                )
                .get(id, ...allIds) as { n: number }
            ).n > 0
        )
      );
      // The re-index invents <albumId>.jpg when it finds a picture and no cache
      // yet, which would hand a shared album a cover it never had.
      const cachedBefore = new Map(albumIds.map(id => [id, fs.existsSync(albumJpg(id))]));

      // A busy scanner refuses the re-index, leaving the DB out of step with the
      // files just written; the caller has to know.
      const scan = written.length
        ? ((await spawnScanWorker('files', written)) as { success?: boolean })
        : null;

      // Art bookkeeping runs after the re-index, so it has the last word on what
      // the edited tracks point at.
      if (fields.artPath !== undefined) {
        const setAlbumArt = db.prepare('UPDATE Track SET AlbumArt = ? WHERE AlbumId = ?');
        const setTrackArt = db.prepare('UPDATE Track SET AlbumArt = ? WHERE Id = ?');

        for (const albumId of albumIds) {
          try {
            if (shared.has(albumId)) {
              // Put the shared cache back exactly as it was found.
              if (!cachedBefore.get(albumId)) fs.rmSync(albumJpg(albumId), { force: true });
              continue;
            }
            // when The whole album is in this edit, so every one of its tracks ends up on <albumId>.jpg. Any per-track cover left from an earlier partial
            // edit is stale, and the scanner would go on preferring it.
            for (const row of rows) {
              if (row.AlbumId === albumId) fs.rmSync(trackJpg(row.Id), { force: true });
            }
            if (fields.artPath === null) {
              fs.rmSync(albumJpg(albumId), { force: true });
              setAlbumArt.run('', albumId);
            } else {
              fs.copyFileSync(fields.artPath, albumJpg(albumId));
              setAlbumArt.run(albumJpg(albumId), albumId);
            }
          } catch {
            /* art will just stay stale */
          }
        }

        // Tracks on a shared album (and tracks on no album at all) get their own
        // cover file, so the edit shows up on exactly the files it was aimed at.
        for (const row of writtenRows) {
          if (row.AlbumId != null && !shared.has(row.AlbumId)) continue;
          const trackArt = trackJpg(row.Id);
          try {
            if (fields.artPath === null) {
              fs.rmSync(trackArt, { force: true });
              setTrackArt.run('', row.Id);
            } else {
              fs.copyFileSync(fields.artPath, trackArt);
              setTrackArt.run(trackArt, row.Id);
            }
          } catch {
            /* art will just stay stale */
          }
        }
      }
      return {
        success: failed.length === 0,
        written: written.length,
        failed,
        reindexed: !scan || scan.success !== false,
      };
    }
  );

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
  CREATE TABLE IF NOT EXISTS Playlist (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT NOT NULL,
    DateAdded BIGINT,
    DateModified BIGINT
  )
`
  ).run();

  // Old schema required TrackId and had no Uri, coupling every row to the
  // library scan. Nothing worth preserving predates it, so rebuild rather than migrate.
  const existingPlaylistTrackCols = (
    db.pragma('table_info(PlaylistTrack)') as { name: string }[]
  ).map(c => c.name);
  if (existingPlaylistTrackCols.length && !existingPlaylistTrackCols.includes('Uri')) {
    db.prepare('DROP TABLE PlaylistTrack').run();
  }

  db.prepare(
    `
  CREATE TABLE IF NOT EXISTS PlaylistTrack (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    PlaylistId INTEGER NOT NULL,
    TrackId INTEGER,
    Uri TEXT NOT NULL,
    Title TEXT,
    Artist TEXT,
    Album TEXT,
    Duration INTEGER,
    Position INTEGER NOT NULL
  )
`
  ).run();
  if (
    !(db.pragma('table_info(PlaylistTrack)') as { name: string }[]).some(c => c.name === 'Album')
  ) {
    db.prepare('ALTER TABLE PlaylistTrack ADD COLUMN Album TEXT').run();
  }
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_playlisttrack_playlist ON PlaylistTrack(PlaylistId, Position)'
  ).run();

  // Internet radio. A stream is a URL and a name: nothing the scanner can
  // index, no duration, no position, so it gets its own table rather than a
  // Track row with every column NULL.
  db.prepare(
    `
  CREATE TABLE IF NOT EXISTS Stream (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT NOT NULL,
    Uri TEXT NOT NULL UNIQUE,
    CoverUri TEXT,
    DateAdded BIGINT
  )
`
  ).run();
  if (!(db.pragma('table_info(Stream)') as { name: string }[]).some(c => c.name === 'CoverUri')) {
    db.prepare('ALTER TABLE Stream ADD COLUMN CoverUri TEXT').run();
  }

  // Covers chosen before they were copied in still point wherever the user
  // picked them. Adopt those once so they stop depending on that file; a path
  // that no longer resolves is left alone in case the drive comes back.
  for (const row of db
    .prepare('SELECT Id, CoverUri FROM Stream WHERE CoverUri IS NOT NULL')
    .all() as Array<{ Id: number; CoverUri: string }>) {
    if (path.dirname(row.CoverUri) === STREAM_ART_DIR || !fs.existsSync(row.CoverUri)) continue;
    try {
      db.prepare('UPDATE Stream SET CoverUri = ? WHERE Id = ?').run(
        adoptStreamCover(row.Id, row.CoverUri),
        row.Id
      );
    } catch (error) {
      console.warn('Could not adopt stream cover', row.CoverUri, error);
    }
  }

  // Rows age out after settings.streamHistoryDays unless bookmarked, so this
  // stays a short "what was that song?" list rather than a permanent log.
  db.prepare(
    `
  CREATE TABLE IF NOT EXISTS StreamTrack (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    StreamId INTEGER NOT NULL,
    Raw TEXT NOT NULL,
    Title TEXT,
    Artist TEXT,
    FirstHeardAt BIGINT,
    LastHeardAt BIGINT,
    Saved INTEGER NOT NULL DEFAULT 0,
    UNIQUE(StreamId, Raw)
  )
`
  ).run();
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_streamtrack_stream ON StreamTrack(StreamId, LastHeardAt)'
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

  // A remote library (Jellyfin) the user has connected. Its tracks live in the
  // normal Track/Album/Artist tables tagged with SourceId, so everything that
  // reads the library works on them unchanged; SourceId IS NULL means local.
  db.prepare(
    `
  CREATE TABLE IF NOT EXISTS Source (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Type TEXT NOT NULL,
    Name TEXT,
    BaseUrl TEXT,
    Username TEXT,
    UserId TEXT,
    AccessToken TEXT,
    DeviceId TEXT,
    LastSyncedAt BIGINT,
    ConfigJson TEXT,
    Version INTEGER DEFAULT 1
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

  // Provenance for rows imported from a remote Source. The unique index backs the
  // sync upsert; local rows leave both columns NULL, which SQLite treats as
  // distinct, so any number of them coexist under a unique index.
  for (const table of ['Track', 'Album', 'Artist'] as const) {
    const cols = (db.pragma(`table_info(${table})`) as { name: string }[]).map(c => c.name);
    if (!cols.includes('SourceId')) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN SourceId INTEGER`).run();
    }
    if (!cols.includes('RemoteId')) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN RemoteId TEXT`).run();
    }
    // What the remote file looked like when its tags were read. NULL means they
    // never were, which is what the on-play fill-in looks for.
    if (table === 'Track' && !cols.includes('RemoteStamp')) {
      db.prepare('ALTER TABLE Track ADD COLUMN RemoteStamp TEXT').run();
    }
    const indexName = `idx_${table.toLowerCase()}_source`;
    // An abandoned 2026 prototype created this index as non-unique. IF NOT EXISTS
    // would happily keep it, leaving the upsert without its safety net.
    const stale = (db.pragma(`index_list(${table})`) as { name: string; unique: number }[]).find(
      i => i.name === indexName && !i.unique
    );
    if (stale) db.prepare(`DROP INDEX ${indexName}`).run();
    try {
      db.prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${table}(SourceId, RemoteId)`
      ).run();
    } catch {
      // Pre-existing duplicates would make the unique index unbuildable. Sync
      // resolves rows by SELECT-then-INSERT inside a transaction, so it stays
      // correct without it; take the plain index rather than fail startup.
      console.warn(`[db] Duplicate (SourceId, RemoteId) rows in ${table}; index not unique.`);
      db.prepare(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${table}(SourceId, RemoteId)`).run();
    }
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

        // Each connected server is a root of its own, alongside the local music
        // folders. Its paths all share a `<scheme>://<id>/` prefix, so the same
        // walk below drills into it with no special-casing, and two servers of
        // the same type stay in separate namespaces.
        const sourceRoots = (
          db
            .prepare('SELECT Id, Type, Name FROM Source ORDER BY Name COLLATE NOCASE')
            .all() as Array<{ Id: number; Type: string; Name: string | null }>
        ).flatMap(source => {
          const root = schemeRoot(source.Type, source.Id);
          if (!root) return [];
          let count = 0;
          for (const f of allFolders) {
            if (f.FolderPath.startsWith(root)) count += f.SongCount;
          }
          return [
            {
              Path: root,
              Name: source.Name || source.Type,
              SongCount: count,
              IsRoot: true,
              SourceType: source.Type,
            },
          ];
        });

        return { subfolders: [...subfolders, ...sourceRoots], songs: [], isRoot: true };
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
        Track.SourceId,
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

  // The playback queue lives in renderer state, not React Query, so it needs its
  // own way to re-read rows after the library changes under it.
  ipcMain.handle('get-queue-tracks', (_e, { trackIds }: { trackIds: (number | string)[] }) => {
    const numeric = (trackIds || []).filter(
      id => typeof id === 'number' || /^\d+$/.test(String(id))
    );
    if (!numeric.length) return [];
    const placeholders = numeric.map(() => '?').join(', ');
    return db
      .prepare(
        `
      SELECT
        Track.Id,
        Track.Title,
        Track.Uri,
        Track.AlbumArt,
        Track.AlbumId,
        ${TRACK_ARTIST_NAMES},
        Album.Title AS AlbumTitle
      FROM Track
      LEFT JOIN Album ON Track.AlbumId = Album.Id
      WHERE Track.Id IN (${placeholders})
      GROUP BY Track.Id
    `
      )
      .all(...numeric);
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

  // ── Playlists ────────────────────────────────────────────────────────────
  // Import/export only speak the four real formats (M3U/M3U8/PLS/XSPF)
  function resequencePlaylistPositions(playlistId: number): void {
    const rows = db
      .prepare('SELECT Id FROM PlaylistTrack WHERE PlaylistId = ? ORDER BY Position ASC')
      .all(playlistId) as Array<{ Id: number }>;
    const update = db.prepare('UPDATE PlaylistTrack SET Position = ? WHERE Id = ?');
    db.transaction(() => {
      rows.forEach((row, i) => update.run(i, row.Id));
    })();
  }

  function touchPlaylist(playlistId: number): void {
    db.prepare('UPDATE Playlist SET DateModified = ? WHERE Id = ?').run(Date.now(), playlistId);
  }

  // Match order: exact path, then case-insensitive path (drive letters and
  // slashes get typed inconsistently across tools), then the same
  // filename-anywhere-in-the-library fallback favourites use.
  function buildPlaylistTrackIndex() {
    const rows = db.prepare('SELECT Id, Uri FROM Track').all() as Array<{
      Id: number;
      Uri: string | null;
    }>;
    const byExactPath = new Map<string, number>();
    const byLowerPath = new Map<string, number>();
    const byName = new Map<string, number>();
    for (const row of rows) {
      if (!row.Uri) continue;
      if (!byExactPath.has(row.Uri)) byExactPath.set(row.Uri, row.Id);
      const lower = row.Uri.toLowerCase();
      if (!byLowerPath.has(lower)) byLowerPath.set(lower, row.Id);
      const base = path.basename(row.Uri).toLowerCase();
      if (!byName.has(base)) byName.set(base, row.Id);
    }
    return { byExactPath, byLowerPath, byName };
  }

  function matchPlaylistEntry(
    index: ReturnType<typeof buildPlaylistTrackIndex>,
    location: string
  ): number | null {
    const exact = index.byExactPath.get(location);
    if (exact != null) return exact;
    const lower = index.byLowerPath.get(location.toLowerCase());
    if (lower != null) return lower;
    const named = index.byName.get(path.basename(location).toLowerCase());
    return named ?? null;
  }

  // A playlist file's own text is thin (M3U's #EXTINF and PLS's Title are one
  // free-text label, neither carries an album). When a track isn't in the
  // library, read its real tags instead, same as the "open with" flow does
  // for a file played outside the library.
  interface ExternalTrackMeta {
    title: string;
    artist: string | null;
    album: string | null;
    duration: number | null;
  }

  async function readExternalTrackMeta(
    filePath: string,
    fallback: { title?: string; artist?: string; duration?: number }
  ): Promise<ExternalTrackMeta> {
    const basenameTitle = path.basename(filePath).replace(/\.[^.]+$/, '');
    try {
      const meta = await parseAudioFile(filePath, { skipCovers: true });
      return {
        title: meta.common.title || fallback.title || basenameTitle,
        artist: meta.common.artist || fallback.artist || null,
        album: meta.common.album || null,
        duration: meta.format.duration
          ? Math.round(meta.format.duration)
          : (fallback.duration ?? null),
      };
    } catch {
      // Unreadable file or corrupt tags: fall back to the playlist entry
      // rather than failing the import over one track.
      return {
        title: fallback.title || basenameTitle,
        artist: fallback.artist || null,
        album: null,
        duration: fallback.duration ?? null,
      };
    }
  }

  ipcMain.handle('get-playlists', () => {
    return db
      .prepare(
        `
      SELECT
        Playlist.Id,
        Playlist.Name,
        Playlist.DateAdded,
        Playlist.DateModified,
        COUNT(PlaylistTrack.Id) AS TrackCount,
        SUM(COALESCE(Track.Duration, PlaylistTrack.Duration)) AS Duration,
        (
          SELECT Track2.AlbumArt FROM PlaylistTrack pt2
          LEFT JOIN Track Track2 ON Track2.Id = pt2.TrackId
          WHERE pt2.PlaylistId = Playlist.Id AND Track2.AlbumArt IS NOT NULL
          ORDER BY pt2.Position ASC LIMIT 1
        ) AS CoverUri
      FROM Playlist
      LEFT JOIN PlaylistTrack ON PlaylistTrack.PlaylistId = Playlist.Id
      LEFT JOIN Track ON Track.Id = PlaylistTrack.TrackId
      GROUP BY Playlist.Id
      ORDER BY Playlist.DateModified DESC
    `
      )
      .all();
  });

  ipcMain.handle('get-playlist', (_e, { playlistId }: { playlistId: number }) => {
    return db
      .prepare('SELECT Id, Name, DateAdded, DateModified FROM Playlist WHERE Id = ?')
      .get(playlistId);
  });

  ipcMain.handle('create-playlist', (_e, { name }: { name?: string }) => {
    const trimmed = (name || '').trim() || 'New Playlist';
    const now = Date.now();
    const info = db
      .prepare('INSERT INTO Playlist (Name, DateAdded, DateModified) VALUES (?, ?, ?)')
      .run(trimmed, now, now);
    sendMessageToRendererProcess(mainWin, 'library-updated', {});
    return { id: info.lastInsertRowid, name: trimmed };
  });

  ipcMain.handle(
    'rename-playlist',
    (_e, { playlistId, name }: { playlistId: number; name?: string }) => {
      const trimmed = (name || '').trim();
      if (!trimmed) return { success: false, error: 'Name cannot be empty' };
      db.prepare('UPDATE Playlist SET Name = ?, DateModified = ? WHERE Id = ?').run(
        trimmed,
        Date.now(),
        playlistId
      );
      sendMessageToRendererProcess(mainWin, 'library-updated', {});
      return { success: true };
    }
  );

  ipcMain.handle('delete-playlist', (_e, { playlistId }: { playlistId: number }) => {
    db.prepare('DELETE FROM PlaylistTrack WHERE PlaylistId = ?').run(playlistId);
    db.prepare('DELETE FROM Playlist WHERE Id = ?').run(playlistId);
    sendMessageToRendererProcess(mainWin, 'library-updated', {});
    return { success: true };
  });

  // TrackId is a bonus link, not a requirement: a row plays off its own Uri
  // whether or not it's scanned into the library. Id falls back to the Uri
  // itself when there's no library Track, same convention "open with" uses.
  ipcMain.handle('get-playlist-tracks', (_e, { playlistId }: { playlistId: number }) => {
    return db
      .prepare(
        `
      SELECT
        PlaylistTrack.Id AS PlaylistTrackId,
        PlaylistTrack.Position,
        COALESCE(Track.Id, PlaylistTrack.Uri) AS Id,
        COALESCE(Track.Title, PlaylistTrack.Title, PlaylistTrack.Uri) AS Title,
        COALESCE(Track.Uri, PlaylistTrack.Uri) AS Uri,
        Track.Extension,
        Track.Year,
        Track.TrackNumber,
        Track.AlbumArt,
        COALESCE(Track.Duration, PlaylistTrack.Duration) AS Duration,
        Track.AlbumId,
        COALESCE(
          (
            SELECT GROUP_CONCAT(ar.Name, ', ' ORDER BY ta.Id)
            FROM TrackArtist ta
            JOIN Artist ar ON ar.Id = ta.ArtistId
            WHERE ta.TrackId = Track.Id
          ),
          PlaylistTrack.Artist
        ) AS ArtistName,
        COALESCE(Album.Title, PlaylistTrack.Album) AS AlbumTitle,
        Genre.Name AS GenreName,
        CASE WHEN Track.Id IS NULL THEN 1 ELSE 0 END AS IsExternal
      FROM PlaylistTrack
      LEFT JOIN Track ON Track.Id = PlaylistTrack.TrackId
      LEFT JOIN Album ON Track.AlbumId = Album.Id
      LEFT JOIN Genre ON Track.GenreId = Genre.Id
      WHERE PlaylistTrack.PlaylistId = ?
      GROUP BY PlaylistTrack.Id
      ORDER BY PlaylistTrack.Position ASC
    `
      )
      .all(playlistId);
  });

  ipcMain.handle(
    'add-tracks-to-playlist',
    (_e, { playlistId, trackIds }: { playlistId: number; trackIds: number[] }) => {
      const ids = Array.isArray(trackIds) ? trackIds : [];
      if (!ids.length) return { added: 0 };
      const placeholders = ids.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT Track.Id, Track.Uri, Track.Title, Track.Duration, ${TRACK_ARTIST_NAMES}, Album.Title AS AlbumTitle
           FROM Track
           LEFT JOIN Album ON Track.AlbumId = Album.Id
           WHERE Track.Id IN (${placeholders})`
        )
        .all(...ids) as Array<{
        Id: number;
        Uri: string;
        Title: string | null;
        Duration: number | null;
        ArtistName: string | null;
        AlbumTitle: string | null;
      }>;
      const byId = new Map(rows.map(r => [r.Id, r]));
      const maxPos = (
        db
          .prepare(
            'SELECT COALESCE(MAX(Position), -1) AS pos FROM PlaylistTrack WHERE PlaylistId = ?'
          )
          .get(playlistId) as { pos: number }
      ).pos;
      const insert = db.prepare(
        'INSERT INTO PlaylistTrack (PlaylistId, TrackId, Uri, Title, Artist, Album, Duration, Position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      );
      let added = 0;
      db.transaction(() => {
        ids.forEach(trackId => {
          const t = byId.get(trackId);
          if (!t) return; // stale id, track was deleted since the picker loaded
          insert.run(
            playlistId,
            t.Id,
            t.Uri,
            t.Title,
            t.ArtistName,
            t.AlbumTitle,
            t.Duration,
            maxPos + 1 + added
          );
          added++;
        });
      })();
      touchPlaylist(playlistId);
      sendMessageToRendererProcess(mainWin, 'library-updated', {});
      return { added };
    }
  );

  ipcMain.handle(
    'remove-playlist-tracks',
    (_e, { playlistId, playlistTrackIds }: { playlistId: number; playlistTrackIds: number[] }) => {
      const ids = Array.isArray(playlistTrackIds) ? playlistTrackIds : [];
      if (!ids.length) return { removed: 0 };
      const del = db.prepare('DELETE FROM PlaylistTrack WHERE Id = ? AND PlaylistId = ?');
      db.transaction(() => {
        ids.forEach(id => del.run(id, playlistId));
      })();
      resequencePlaylistPositions(playlistId);
      touchPlaylist(playlistId);
      sendMessageToRendererProcess(mainWin, 'library-updated', {});
      return { removed: ids.length };
    }
  );

  // Takes the full new order (what Reorder.Group hands back after a drag)
  // rather than a single from/to move, so neither side needs to reimplement
  // array-splice-by-index.
  ipcMain.handle(
    'reorder-playlist-tracks',
    (
      _e,
      {
        playlistId,
        orderedPlaylistTrackIds,
      }: { playlistId: number; orderedPlaylistTrackIds: number[] }
    ) => {
      const ids = Array.isArray(orderedPlaylistTrackIds) ? orderedPlaylistTrackIds : [];
      if (!ids.length) return { success: false };
      const update = db.prepare(
        'UPDATE PlaylistTrack SET Position = ? WHERE Id = ? AND PlaylistId = ?'
      );
      db.transaction(() => {
        ids.forEach((id, i) => update.run(i, id, playlistId));
      })();
      touchPlaylist(playlistId);
      sendMessageToRendererProcess(mainWin, 'library-updated', {});
      return { success: true };
    }
  );

  ipcMain.handle('import-playlist', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWin, {
        title: 'Import Playlist',
        defaultPath: MUSIC_DIR,
        properties: ['openFile'],
        filters: [
          { name: 'All Playlists', extensions: ['m3u', 'm3u8', 'pls', 'xspf'] },
          { name: 'M3U Playlist', extensions: ['m3u', 'm3u8'] },
          { name: 'PLS Playlist', extensions: ['pls'] },
          { name: 'XSPF Playlist', extensions: ['xspf'] },
        ],
      });
      if (result.canceled || !result.filePaths?.length) return { success: false, canceled: true };
      const filePath = result.filePaths[0];
      const entries = parsePlaylistFile(filePath);
      if (!entries.length) return { success: false, error: 'No tracks found in playlist file' };

      // A library match only enriches a row (cover art, album/genre links),
      // it's never required. Every entry whose file exists becomes a playable
      // row, library-scanned or not.
      const index = buildPlaylistTrackIndex();
      const rows: Array<{
        trackId: number | null;
        uri: string;
        title: string;
        artist: string | null;
        album: string | null;
        duration: number | null;
      }> = [];
      const missing: Array<{ location: string; title?: string; artist?: string }> = [];
      let matched = 0;
      for (const entry of entries) {
        const trackId = matchPlaylistEntry(index, entry.location);
        if (trackId != null) {
          matched++;
          rows.push({
            trackId,
            uri: entry.location,
            title: entry.title || path.basename(entry.location).replace(/\.[^.]+$/, ''),
            artist: entry.artist || null,
            album: null,
            duration: entry.duration ?? null,
          });
          continue;
        }
        if (!fs.existsSync(entry.location)) {
          missing.push({ location: entry.location, title: entry.title, artist: entry.artist });
          continue;
        }
        const meta = await readExternalTrackMeta(entry.location, {
          title: entry.title,
          artist: entry.artist,
          duration: entry.duration,
        });
        rows.push({
          trackId: null,
          uri: entry.location,
          title: meta.title,
          artist: meta.artist,
          album: meta.album,
          duration: meta.duration,
        });
      }
      if (!rows.length) {
        return { success: false, error: 'None of the files in this playlist could be found' };
      }

      const name = path.basename(filePath).replace(/\.[^.]+$/, '');
      const now = Date.now();
      const info = db
        .prepare('INSERT INTO Playlist (Name, DateAdded, DateModified) VALUES (?, ?, ?)')
        .run(name, now, now);
      const playlistId = info.lastInsertRowid as number;
      const insert = db.prepare(
        'INSERT INTO PlaylistTrack (PlaylistId, TrackId, Uri, Title, Artist, Album, Duration, Position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      );
      db.transaction(() => {
        rows.forEach((row, i) =>
          insert.run(
            playlistId,
            row.trackId,
            row.uri,
            row.title,
            row.artist,
            row.album,
            row.duration,
            i
          )
        );
      })();

      sendMessageToRendererProcess(mainWin, 'library-updated', {});
      return {
        success: true,
        playlistId,
        name,
        imported: rows.length,
        matched,
        external: rows.length - matched,
        missing,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    'export-playlist',
    async (_e, { playlistId, format }: { playlistId: number; format: string }) => {
      try {
        const fmt = ['m3u', 'm3u8', 'pls', 'xspf'].includes(format) ? format : 'm3u8';
        const playlist = db.prepare('SELECT Name FROM Playlist WHERE Id = ?').get(playlistId) as
          { Name: string } | undefined;
        if (!playlist) return { success: false, error: 'Playlist not found' };
        const rows = db
          .prepare(
            `
          SELECT
            COALESCE(Track.Uri, PlaylistTrack.Uri) AS Uri,
            COALESCE(Track.Title, PlaylistTrack.Title) AS Title,
            COALESCE(Track.Duration, PlaylistTrack.Duration) AS Duration,
            COALESCE(
              (
                SELECT GROUP_CONCAT(ar.Name, ', ' ORDER BY ta.Id)
                FROM TrackArtist ta
                JOIN Artist ar ON ar.Id = ta.ArtistId
                WHERE ta.TrackId = Track.Id
              ),
              PlaylistTrack.Artist
            ) AS ArtistName
          FROM PlaylistTrack
          LEFT JOIN Track ON Track.Id = PlaylistTrack.TrackId
          WHERE PlaylistTrack.PlaylistId = ?
          GROUP BY PlaylistTrack.Id
          ORDER BY PlaylistTrack.Position ASC
        `
          )
          .all(playlistId) as Array<{
          Uri: string;
          Title: string;
          Duration: number;
          ArtistName: string | null;
        }>;
        if (!rows.length) return { success: false, error: 'Playlist is empty' };

        const safeName = playlist.Name.replace(/[\\/:*?"<>|]/g, '_');
        const result = await dialog.showSaveDialog(mainWin, {
          title: 'Export Playlist',
          defaultPath: path.join(MUSIC_DIR, `${safeName}.${fmt}`),
          filters: [{ name: `${fmt.toUpperCase()} Playlist`, extensions: [fmt] }],
        });
        if (result.canceled || !result.filePath) return { success: false, canceled: true };

        const entries = rows.map(r => ({
          location: r.Uri,
          title: r.Title,
          artist: r.ArtistName || undefined,
          duration: r.Duration,
        }));
        writePlaylistFile(result.filePath, entries, playlist.Name);
        return { success: true, filePath: result.filePath, exported: entries.length };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // ── Streams (internet radio) ──────────────────────────────────────────────
  const isStreamUrl = (loc: string): boolean => /^https?:\/\//i.test(loc);

  function hostLabel(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  ipcMain.handle('get-streams', () =>
    db
      .prepare('SELECT Id, Name, Uri, CoverUri, DateAdded FROM Stream ORDER BY Name COLLATE NOCASE')
      .all()
  );

  ipcMain.handle('get-stream', (_e, { streamId }: { streamId: number }) =>
    db.prepare('SELECT Id, Name, Uri, CoverUri, DateAdded FROM Stream WHERE Id = ?').get(streamId)
  );

  ipcMain.handle('add-stream', (_e, { name, uri }: { name?: string; uri?: string }) => {
    const url = (uri || '').trim();
    if (!isStreamUrl(url)) return { success: false, error: 'Enter an http:// or https:// URL' };
    const info = db
      .prepare('INSERT OR IGNORE INTO Stream (Name, Uri, DateAdded) VALUES (?, ?, ?)')
      .run((name || '').trim() || hostLabel(url), url, Date.now());
    if (!info.changes) return { success: false, error: 'That stream is already in the list' };
    sendMessageToRendererProcess(mainWin, 'library-updated', {});
    return { success: true, id: info.lastInsertRowid };
  });

  ipcMain.handle('rename-stream', (_e, { streamId, name }: { streamId: number; name?: string }) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return { success: false, error: 'Name cannot be empty' };
    db.prepare('UPDATE Stream SET Name = ? WHERE Id = ?').run(trimmed, streamId);
    sendMessageToRendererProcess(mainWin, 'library-updated', {});
    return { success: true };
  });

  // Copied rather than referenced in place: a cover has to survive the user
  // moving or deleting the original. The timestamp in the name is what makes
  // the renderer reload the <img> when a cover is replaced.
  function adoptStreamCover(streamId: number, sourcePath: string): string {
    const extension = path.extname(sourcePath).toLowerCase() || '.jpg';
    const target = path.join(STREAM_ART_DIR, `${streamId}-${Date.now()}${extension}`);
    fs.mkdirSync(STREAM_ART_DIR, { recursive: true });
    fs.copyFileSync(sourcePath, target);
    return target;
  }

  /** Removes a cover this app owns; a path from anywhere else is left alone. */
  function discardStreamCover(streamId: number): void {
    const row = db.prepare('SELECT CoverUri FROM Stream WHERE Id = ?').get(streamId) as
      { CoverUri: string | null } | undefined;
    const current = row?.CoverUri;
    if (!current || path.dirname(current) !== STREAM_ART_DIR) return;
    try {
      fs.rmSync(current, { force: true });
    } catch {
      /* already gone, or locked by a viewer; the row is what matters */
    }
  }

  ipcMain.handle(
    'set-stream-cover',
    async (_e, { streamId, clear }: { streamId: number; clear?: boolean }) => {
      if (clear) {
        discardStreamCover(streamId);
        db.prepare('UPDATE Stream SET CoverUri = NULL WHERE Id = ?').run(streamId);
        return { success: true, coverUri: null };
      }
      const result = await dialog.showOpenDialog(mainWin, {
        title: 'Choose Stream Cover',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
      });
      if (result.canceled || !result.filePaths?.length) return { success: false, canceled: true };
      try {
        const coverUri = adoptStreamCover(streamId, result.filePaths[0]);
        discardStreamCover(streamId);
        db.prepare('UPDATE Stream SET CoverUri = ? WHERE Id = ?').run(coverUri, streamId);
        return { success: true, coverUri };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  ipcMain.handle('delete-stream', (_e, { streamId }: { streamId: number }) => {
    discardStreamCover(streamId);
    db.prepare('DELETE FROM StreamTrack WHERE StreamId = ?').run(streamId);
    db.prepare('DELETE FROM Stream WHERE Id = ?').run(streamId);
    sendMessageToRendererProcess(mainWin, 'library-updated', {});
    return { success: true };
  });

  function pruneStreamTracks(): void {
    const days = Number(readSettingsFile().streamHistoryDays);
    const ttlMs = (Number.isFinite(days) && days > 0 ? days : 3) * 24 * 60 * 60 * 1000;
    db.prepare('DELETE FROM StreamTrack WHERE Saved = 0 AND LastHeardAt < ?').run(
      Date.now() - ttlMs
    );
  }

  function recordStreamTrack(
    streamId: number,
    meta: StreamMetadata
  ): { historyId: number; saved: boolean } | null {
    if (!Number.isFinite(streamId)) return null;
    const now = Date.now();
    db.prepare(
      `INSERT INTO StreamTrack (StreamId, Raw, Title, Artist, FirstHeardAt, LastHeardAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(StreamId, Raw) DO UPDATE SET LastHeardAt = excluded.LastHeardAt`
    ).run(streamId, meta.raw, meta.title, meta.artist, now, now);
    pruneStreamTracks();
    const row = db
      .prepare('SELECT Id, Saved FROM StreamTrack WHERE StreamId = ? AND Raw = ?')
      .get(streamId, meta.raw) as { Id: number; Saved: number } | undefined;
    return row ? { historyId: row.Id, saved: !!row.Saved } : null;
  }

  // streamId is absent for a stream URL played from a playlist; those play fine
  // and leave no history behind.
  ipcMain.on('stream-meta-start', (_e, { url, streamId }: { url: string; streamId?: number }) => {
    if (!url) return;
    startStreamMeta(url, meta => {
      const history = streamId != null ? recordStreamTrack(streamId, meta) : null;
      sendMessageToRendererProcess(mainWin, 'stream-metadata', { ...meta, ...history });
    });
  });

  ipcMain.on('stream-meta-stop', () => stopStreamMeta());

  ipcMain.handle('get-stream-tracks', (_e, { streamId }: { streamId: number }) => {
    pruneStreamTracks();
    return db
      .prepare(
        `SELECT Id, Raw, Title, Artist, FirstHeardAt, LastHeardAt, Saved
         FROM StreamTrack WHERE StreamId = ?
         ORDER BY Saved DESC, LastHeardAt DESC`
      )
      .all(streamId);
  });

  ipcMain.handle('set-stream-track-saved', (_e, { id, saved }: { id: number; saved: boolean }) => {
    db.prepare('UPDATE StreamTrack SET Saved = ? WHERE Id = ?').run(saved ? 1 : 0, id);
    return { saved: !!saved };
  });

  // Station files usually carry no #EXTINF, so an unnamed single-entry file takes
  // the file's own name (coreradio.m3u → "coreradio").
  ipcMain.handle('import-streams', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWin, {
        title: 'Import Streams',
        defaultPath: MUSIC_DIR,
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Playlists', extensions: ['m3u', 'm3u8', 'pls', 'xspf'] }],
      });
      if (result.canceled || !result.filePaths?.length) return { success: false, canceled: true };

      const insert = db.prepare(
        'INSERT OR IGNORE INTO Stream (Name, Uri, DateAdded) VALUES (?, ?, ?)'
      );
      let imported = 0;
      let duplicate = 0;
      let local = 0;
      for (const filePath of result.filePaths) {
        const entries = parsePlaylistFile(filePath);
        const urls = entries.filter(e => isStreamUrl(e.location));
        local += entries.length - urls.length;
        const fileBase = path.basename(filePath).replace(/\.[^.]+$/, '');
        for (const entry of urls) {
          const name =
            entry.title?.trim() || (urls.length === 1 ? fileBase : hostLabel(entry.location));
          if (insert.run(name, entry.location, Date.now()).changes) imported++;
          else duplicate++;
        }
      }
      if (!imported && !duplicate) {
        return { success: false, error: 'No stream URLs in that file, only local files' };
      }
      sendMessageToRendererProcess(mainWin, 'library-updated', {});
      return { success: true, imported, duplicate, local };
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
        Track.SourceId,
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
  // A source that authenticates with a header needs it on the renderer's own
  // requests too: the <audio> loading a stream, the <img> loading a cover.
  installSourceAuth(mainWin.webContents.session);
  registerSourceIpc(
    mainWin,
    () => readSettingsFile().library.downloadFolder,
    folder => {
      const current = readSettingsFile();
      writeSettingsFile({ ...current, library: { ...current.library, downloadFolder: folder } });
    },
    () => readSettingsFile().library
  );

  ipcMain.handle('open-dir', (e, { variant = 'appdata' }) => {
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

      const playlists = db
        .prepare(
          `
        SELECT
          Playlist.Id,
          Playlist.Name,
          (SELECT COUNT(*) FROM PlaylistTrack WHERE PlaylistId = Playlist.Id) AS SongCount
        FROM Playlist
        WHERE Playlist.Name LIKE ? COLLATE NOCASE
        ORDER BY
          CASE WHEN LOWER(Playlist.Name) = ? THEN 0 ELSE 1 END,
          Playlist.Name COLLATE NOCASE
        LIMIT 10
      `
        )
        .all(searchPattern, exactQuery);

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
        playlists: playlists.map(p => ({
          id: p.Id,
          title: p.Name,
          songCount: p.SongCount,
        })),
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
  // Tag columns come along for the ride: a streamed track has no local file to
  // read tags out of, so the synced DB row is the only source the dialog has.
  ipcMain.handle('get-track-db-info', (_, { trackId }: { trackId: number | string }) => {
    return (
      db
        .prepare(
          `SELECT
             Track.PlayedTimes,
             Track.LastPlayedAt,
             Track.Title,
             Track.TrackNumber,
             Track.DiscNumber,
             Track.Year,
             Track.ReleaseYear,
             ${TRACK_ARTIST_NAMES},
             Album.Title AS AlbumTitle,
             ${albumArtistNames('AlbumArtistName')},
             Genre.Name AS GenreName
           FROM Track
           LEFT JOIN Album ON Track.AlbumId = Album.Id
           LEFT JOIN Genre ON Track.GenreId = Genre.Id
           WHERE Track.Id = ?`
        )
        .get(trackId) ?? null
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

  /**
   * The renderer only has `ArtistName`, a GROUP_CONCAT joined with ', ', and
   * splitting it back apart mangles names containing a comma ("Tyler, The
   * Creator"). The TrackArtist rows behind it are unambiguous, so the scrobble
   * payload resolves its artists from those instead.
   */
  function withResolvedArtists({ trackId, ...track }: ScrobblePayload): ScrobbleTrack {
    if (!trackId) return track;
    const artists = db
      .prepare(
        `SELECT ar.Name AS Name FROM TrackArtist ta
           JOIN Artist ar ON ar.Id = ta.ArtistId
          WHERE ta.TrackId = ? ORDER BY ta.Id`
      )
      .all(trackId)
      .map((r: { Name: string }) => (r.Name || '').trim())
      .filter(Boolean);
    const row = db
      .prepare(
        `SELECT t.RawArtist AS RawArtist, (
            SELECT GROUP_CONCAT(ar.Name, ', ' ORDER BY aa.Id)
              FROM AlbumArtist aa JOIN Artist ar ON ar.Id = aa.ArtistId
             WHERE aa.AlbumId = t.AlbumId
          ) AS AlbumArtistName
         FROM Track t WHERE t.Id = ?`
      )
      .get(trackId) as { RawArtist: string | null; AlbumArtistName: string | null } | undefined;
    return {
      ...track,
      artists,
      artistRaw: row?.RawArtist || track.artist,
      albumArtist: row?.AlbumArtistName || undefined,
    };
  }

  // ── Scrobbling IPC (Last.fm / Libre.fm / GNU FM / ListenBrainz) ───────────
  ipcMain.handle('scrobbler-status', () => getScrobblerStatus());
  ipcMain.handle(
    'scrobbler-auth-start',
    (_, { provider, baseUrl }: { provider: ScrobbleProvider; baseUrl?: string }) =>
      startWebAuth(provider, baseUrl)
  );
  ipcMain.handle('scrobbler-auth-finish', (_, { provider }: { provider: ScrobbleProvider }) =>
    finishWebAuth(provider)
  );
  ipcMain.handle(
    'scrobbler-connect-token',
    (
      _,
      { provider, token, baseUrl }: { provider: ScrobbleProvider; token: string; baseUrl?: string }
    ) => connectWithToken(provider, token, baseUrl)
  );
  ipcMain.handle('scrobbler-disconnect', (_, { provider }: { provider: ScrobbleProvider }) =>
    disconnectScrobbler(provider)
  );
  ipcMain.handle(
    'scrobbler-set-enabled',
    (_, { provider, enabled }: { provider: ScrobbleProvider; enabled: boolean }) =>
      setScrobblerEnabled(provider, enabled)
  );
  ipcMain.on('scrobbler-now-playing', (_, track: ScrobblePayload) =>
    scrobblerNowPlaying(withResolvedArtists(track))
  );
  ipcMain.on('scrobbler-scrobble', (_, track: ScrobblePayload) =>
    scrobbleTrack(withResolvedArtists(track))
  );

  initScrobbler();
}
