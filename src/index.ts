import './config/appIdentity';
import { app, BrowserWindow, ipcMain, screen, nativeTheme, Menu } from 'electron';
import minimist from 'minimist';
import { IDENTITY } from './config/channel';
import { execSync, execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import mainIpcs, { registerSettingsIpc } from './main/utils/mainProcess';
import { OS_WINDOWS } from './config/constants';
import os from 'os';
const currOS = os.type();

// Webpack-injected entry point URLs
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MINI_PLAYER_WEBPACK_ENTRY: string;
declare const OVERLAY_WEBPACK_ENTRY: string;

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.aac', '.flac', '.webm', '.m4a'];

// Scans by extension rather than trusting argv[1], skipping the exe path and
// any Chromium/Squirrel flags Windows may prepend.
function extractFileArg(argv: string[]): string | null {
  for (const arg of argv) {
    if (!arg || arg === '.' || arg.startsWith('-')) continue;
    if (!AUDIO_EXTENSIONS.includes(path.extname(arg).toLowerCase())) continue;
    try {
      const resolved = path.resolve(arg);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
    } catch {
      /* not a usable path — keep scanning */
    }
  }
  return null;
}

// Handle Squirrel.Windows install/uninstall events, write registry entries,
// and manage Desktop + Start Menu shortcuts.
// Must run before anything else so the app can quit cleanly during installer phases.
function handleSquirrelEvent(): boolean {
  if (process.platform !== 'win32') return false;

  const squirrelEvent = process.argv[1];
  if (!squirrelEvent || !squirrelEvent.startsWith('--squirrel-')) return false;

  const exePath = process.execPath;
  const exeName = path.basename(exePath);
  const updateExe = path.resolve(exePath, '..', '..', 'Update.exe');

  const run = (cmd: string) => {
    try {
      execSync(cmd, { windowsHide: true });
    } catch (_) {
      /* ignore */
    }
  };

  // Passed as an argv array, not a shell string - cmd.exe would strip the
  // quotes around "%1", breaking any file path that contains a space.
  const reg = (args: string[]) => {
    try {
      execFileSync('reg', args, { windowsHide: true });
    } catch (_) {
      /* ignore */
    }
  };

  const regWrite = (key: string, name: string | null, value: string, type = 'REG_SZ') => {
    const nameArgs = name ? ['/v', name] : ['/ve'];
    reg(['add', key, ...nameArgs, '/t', type, '/d', value, '/f']);
  };

  const regDelete = (key: string) => reg(['delete', key, '/f']);
  const regDeleteValue = (key: string, name: string) => reg(['delete', key, '/v', name, '/f']);

  // ProgID that owns the audio file class + its Default Programs capabilities key.
  const progId = `${IDENTITY.menuKey}.Audio`;
  const progIdRoot = `HKCU\\Software\\Classes\\${progId}`;
  const capabilitiesRoot = `HKCU\\Software\\${IDENTITY.menuKey}\\Capabilities`;
  const iconPath = path.join(path.dirname(exePath), 'resources', 'XeroTunesLogo.ico');
  const icon = fs.existsSync(iconPath) ? iconPath : exePath;

  switch (squirrelEvent) {
    case '--squirrel-install':
    case '--squirrel-updated': {
      run(`"${updateExe}" --createShortcut="${exeName}" --shortcut-locations=Desktop,StartMenu`);

      const ctxRoot = `HKCU\\Software\\Classes\\*\\shell\\${IDENTITY.menuKey}`;
      regWrite(ctxRoot, null, `Open with ${IDENTITY.productName}`);
      regWrite(ctxRoot, 'Icon', exePath);
      regWrite(`${ctxRoot}\\command`, null, `"${exePath}" "%1"`);

      // A single ProgID for every audio type: gives XeroTunes an entry in the
      // "Open with" list and a target the Default Apps association can point at,
      // without stealing the current default handler.
      regWrite(progIdRoot, null, `${IDENTITY.productName} Audio File`);
      regWrite(progIdRoot, 'FriendlyTypeName', `${IDENTITY.productName} Audio File`);
      regWrite(`${progIdRoot}\\DefaultIcon`, null, icon);
      regWrite(`${progIdRoot}\\shell\\open\\command`, null, `"${exePath}" "%1"`);

      // Register the ProgID as an opener for each extension, and declare the
      // same set under Capabilities so XeroTunes shows in Settings > Default apps
      // and can be picked as the default music player.
      regWrite(capabilitiesRoot, 'ApplicationName', IDENTITY.productName);
      regWrite(capabilitiesRoot, 'ApplicationDescription', 'Cross-platform music player.');
      for (const ext of AUDIO_EXTENSIONS) {
        regWrite(`HKCU\\Software\\Classes\\${ext}\\OpenWithProgids`, progId, '', 'REG_NONE');
        regWrite(`${capabilitiesRoot}\\FileAssociations`, ext, progId);
      }
      regWrite('HKCU\\Software\\RegisteredApplications', IDENTITY.menuKey, capabilitiesRoot);

      // SMTC reads DisplayName + IconUri off this key for the "Now playing"
      // flyout. IconUri needs a real image file (the EXE renders a placeholder).
      const aumidRoot = `HKCU\\Software\\Classes\\AppUserModelId\\${IDENTITY.appId}`;
      regWrite(aumidRoot, 'DisplayName', IDENTITY.productName);
      regWrite(aumidRoot, 'IconUri', icon);

      app.quit();
      return true;
    }

    case '--squirrel-uninstall': {
      run(`"${updateExe}" --removeShortcut="${exeName}" --shortcut-locations=Desktop,StartMenu`);
      regDelete(`HKCU\\Software\\Classes\\*\\shell\\${IDENTITY.menuKey}`);
      regDelete(`HKCU\\Software\\Classes\\AppUserModelId\\${IDENTITY.appId}`);
      // Drop our opener from each extension's list (leave the extension key and
      // the user's real default untouched), then the ProgID + capabilities.
      for (const ext of AUDIO_EXTENSIONS) {
        regDeleteValue(`HKCU\\Software\\Classes\\${ext}\\OpenWithProgids`, progId);
      }
      regDelete(progIdRoot);
      regDelete(`HKCU\\Software\\${IDENTITY.menuKey}`);
      regDeleteValue('HKCU\\Software\\RegisteredApplications', IDENTITY.menuKey);
      app.quit();
      return true;
    }

    case '--squirrel-obsolete':
      app.quit();
      return true;
  }

  return false;
}

if (handleSquirrelEvent()) {
  // Squirrel lifecycle event handled — app will quit, nothing more to do.
}

// app.setName + setAppUserModelId run in ./config/appIdentity (imported first).

const isDarkMode = nativeTheme.shouldUseDarkColors;

let mainWin: BrowserWindow | null = null;
let miniWin: BrowserWindow | null = null;
let loadingWin: BrowserWindow | null = null;
Menu.setApplicationMenu(null);

const parsedArgs = minimist(process.argv.slice(1), {
  boolean: ['help', 'version'],
  string: ['file'],
  alias: { help: 'h', version: 'v', file: 'f' },
});

const isSingleInstance = app.requestSingleInstanceLock();
if (!isSingleInstance) {
  app.quit();
}

function focusWindow(win: BrowserWindow) {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function focusExistingWindow() {
  const win =
    mainWin && !mainWin.isDestroyed()
      ? mainWin
      : miniWin && !miniWin.isDestroyed()
        ? miniWin
        : BrowserWindow.getAllWindows()[0];
  if (win) focusWindow(win);
}

app.on('second-instance', (_event, commandLine) => {
  const fileArg = process.platform === 'darwin' ? null : extractFileArg(commandLine);

  if (fileArg) {
    // Prefer an already-open full player; otherwise route to the mini player,
    // reusing one if open.
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('play-external-file', fileArg);
      focusWindow(mainWin);
    } else if (miniWin && !miniWin.isDestroyed()) {
      miniWin.webContents.send('play-mini', fileArg);
      focusWindow(miniWin);
    } else {
      parsedArgs['file'] = fileArg;
      createWindow();
    }
    return;
  }

  focusExistingWindow();
});

// Settings IPC must exist in both modes — the mini player (--file launch)
// never calls mainIpcs, which used to leave these handlers unregistered.
// Registered here (not in createWindow) so macOS 'activate' can't double it.
registerSettingsIpc();

function createWindow() {
  loadingWin = new BrowserWindow({
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    width: 400,
    height: 250,
    trafficLightPosition: { x: -20, y: -20 },
    backgroundColor: '#050407',
    backgroundMaterial: 'auto',
    darkTheme: true,
    maximizable: false,
    resizable: false,
    icon: './assets/logo/XeroTunesLogo.png',
  });

  loadingWin.loadFile(path.join(__dirname, 'loader.html'));

  loadingWin.once('ready-to-show', () => {
    loadingWin!.show();
  });

  const fileArg = extractFileArg(process.argv);
  if (fileArg) {
    parsedArgs['file'] = fileArg;
  }

  if (parsedArgs['file']) {
    if (!miniWin || miniWin.isDestroyed()) {
      loadingWin.once('show', () => {
        miniWin = new BrowserWindow({
          width: 400,
          height: 250,
          show: false,
          resizable: false,
          backgroundColor: '#2e2c29',
          opacity: 0.98,
          darkTheme: true,
          maximizable: false,
          alwaysOnTop: false,
          frame: false,
          titleBarStyle: 'hidden',
          trafficLightPosition: { x: -20, y: -20 },
          webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: process.env.NODE_ENV !== 'development',
          },
        });
        if (currOS === OS_WINDOWS) {
          miniWin!.setAppDetails({
            appId: IDENTITY.appId,
            relaunchDisplayName: `${IDENTITY.productName} Mini`,
          });
        }
        // Wait for the renderer to mount its play-mini listener before sending
        // the track — dom-ready fires before React effects run, so sending
        // there can drop the message and leave the player empty.
        ipcMain.once('mini-player-ready', () => {
          miniWin!.show();
          miniWin!.webContents.send('play-mini', path.resolve(parsedArgs['file']));
          loadingWin!.hide();
          loadingWin!.close();
        });
        miniWin!.webContents.on('before-input-event', (event, input) => {
          if (
            (input.control && input.shift && input.key.toLowerCase() === 'i') ||
            input.key === 'F12'
          ) {
            miniWin!.webContents.openDevTools();
            event.preventDefault();
          }
        });
        ipcMain.on('minimize', () => miniWin!.minimize());
        ipcMain.on('maximize', () => {
          if (miniWin!.isMaximized()) {
            miniWin!.unmaximize();
            miniWin!.center();
          } else {
            miniWin!.maximize();
          }
        });
        ipcMain.on('closeWindow', () => {
          miniWin!.close();
        });
        ipcMain.on('add-track', (_e, message) => {
          miniWin!.webContents.send('play-mini', message);
        });
        miniWin!.loadURL(MINI_PLAYER_WEBPACK_ENTRY);
      });
    } else {
      miniWin.show();
      miniWin.webContents.send('play-mini', path.resolve(parsedArgs['file']));
    }
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  loadingWin.once('show', () => {
    mainWin = new BrowserWindow({
      minWidth: 450,
      minHeight: 400,
      width: width - 200,
      height: height - 100,
      show: false,
      backgroundColor: '#201e23',
      opacity: 1,
      darkTheme: isDarkMode ? true : false,
      trafficLightPosition: { x: 13, y: 8 },
      frame: false,
      titleBarStyle: 'hidden',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        nodeIntegrationInWorker: true,
        webSecurity: process.env.NODE_ENV !== 'development',
        scrollBounce: true,
      },
    });
    mainWin!.setMenu(null);
    if (currOS === OS_WINDOWS) {
      mainWin!.setAppDetails({
        appId: IDENTITY.appId,
        relaunchDisplayName: IDENTITY.productName,
      });
    }
    mainWin!.once('ready-to-show', () => {
      mainWin!.show();
      loadingWin!.hide();
      loadingWin!.close();
    });

    // relocating all IPC Events to mainProcess file to declutter this file
    mainIpcs(mainWin!, OVERLAY_WEBPACK_ENTRY);
    mainWin!.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    return;
  }

  // Focus the existing window when clicking the app icon (macOS dock, etc.)
  focusExistingWindow();
});
