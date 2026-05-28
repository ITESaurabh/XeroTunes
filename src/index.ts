import { app, BrowserWindow, ipcMain, screen, nativeTheme, Menu } from 'electron';
import minimist from 'minimist';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import mainIpcs from './main/utils/mainProcess';
import { OS_WINDOWS } from './config/constants';
import os from 'os';
const currOS = os.type();

// Webpack-injected entry point URLs
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MINI_PLAYER_WEBPACK_ENTRY: string;
declare const OVERLAY_WEBPACK_ENTRY: string;

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

  const regWrite = (key: string, name: string | null, value: string, type = 'REG_SZ') => {
    const nameFlag = name ? `/v "${name}"` : '/ve';
    run(`reg add "${key}" ${nameFlag} /t ${type} /d "${value}" /f`);
  };

  const regDelete = (key: string) => run(`reg delete "${key}" /f`);

  switch (squirrelEvent) {
    case '--squirrel-install':
    case '--squirrel-updated': {
      run(`"${updateExe}" --createShortcut="${exeName}" --shortcut-locations=Desktop,StartMenu`);

      const ctxRoot = 'HKCU\\Software\\Classes\\*\\shell\\XeroMusicPlayer';
      regWrite(ctxRoot, null, 'Open with Xero Music Player');
      regWrite(ctxRoot, 'Icon', exePath);
      regWrite(`${ctxRoot}\\command`, null, `"${exePath}" "%1"`);

      // SMTC reads DisplayName + IconUri off this key for the "Now playing"
      // flyout. IconUri needs a real image file (the EXE renders a placeholder).
      const aumidRoot = 'HKCU\\Software\\Classes\\AppUserModelId\\com.itesaurabh.xmp';
      const iconPath = path.join(path.dirname(exePath), 'resources', 'XeroTunesLogo.ico');
      regWrite(aumidRoot, 'DisplayName', 'Xero Music Player');
      regWrite(aumidRoot, 'IconUri', fs.existsSync(iconPath) ? iconPath : exePath);

      app.quit();
      return true;
    }

    case '--squirrel-uninstall': {
      run(`"${updateExe}" --removeShortcut="${exeName}" --shortcut-locations=Desktop,StartMenu`);
      regDelete('HKCU\\Software\\Classes\\*\\shell\\XeroMusicPlayer');
      regDelete('HKCU\\Software\\Classes\\AppUserModelId\\com.itesaurabh.xmp');
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

// Display name used by macOS menu bar, Linux MPRIS Identity, and various OS
// surfaces that don't read package.json's productName at runtime.
app.setName('Xero Music Player');

app.setAppUserModelId('com.itesaurabh.xmp');

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

function focusExistingWindow() {
  const win =
    mainWin && !mainWin.isDestroyed()
      ? mainWin
      : miniWin && !miniWin.isDestroyed()
        ? miniWin
        : BrowserWindow.getAllWindows()[0];
  if (!win) return;

  if (win.isMinimized()) {
    win.restore();
  }

  win.show();
  win.focus();
}

app.on('second-instance', (_event, commandLine) => {
  // Bring existing window to front when a second instance is attempted
  focusExistingWindow();

  if (process.platform !== 'darwin') {
    const args = commandLine.slice(1);
    if (args.length > 1) {
      const params = args[1];
      if (miniWin) {
        miniWin.webContents.send('play-mini', params);
      }
    }
  }
});

const createWindow = () => {
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

  const firstArg = parsedArgs._[0];
  if (firstArg && firstArg !== '.' && fs.existsSync(path.resolve(firstArg))) {
    parsedArgs['file'] = firstArg;
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
            appId: 'com.itesaurabh.xmp',
            relaunchDisplayName: 'Xero Mini Player',
          });
        }
        miniWin?.webContents.once('dom-ready', () => {
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
        appId: 'com.itesaurabh.xmp',
        relaunchDisplayName: 'Xero Music Player',
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
};

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
