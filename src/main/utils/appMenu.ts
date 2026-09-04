/**
 * macOS application menu, dock menu, and media keys. Darwin-only: macOS routes
 * Cmd+C/V/X/A/Z, Cmd+Q and Hide through the application menu's roles, while
 * Windows and Linux draw their own titlebar and run menu-less.
 *
 * Playback items reuse the `thumbar-*` channels the Windows thumbnail toolbar
 * already speaks; everything else sends a `menu-command` the renderer maps onto
 * the handlers its own buttons call, so each action keeps one implementation.
 *
 * Accelerators fire ahead of the web contents, so each one is taken away from
 * every text field in the app. Space and Cmd+arrow are unusable for that
 * reason: skip-track sits on Cmd+Alt+arrow, and play/pause carries no
 * accelerator so the renderer can bind Space where it can see field focus.
 */

import { app, BrowserWindow, Menu, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { DISCORD_URL, REPO_URL, SITE_URL } from '../../config/constants';

/** Resolved late: a menu item can be clicked while the window is hidden or gone. */
type WinGetter = () => BrowserWindow | null;

function sendToWindow(getWin: WinGetter, channel: string, payload?: unknown): void {
  const win = getWin();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function command(getWin: WinGetter, name: string): () => void {
  return () => sendToWindow(getWin, 'menu-command', name);
}

function playbackItems(getWin: WinGetter): MenuItemConstructorOptions[] {
  return [
    { label: 'Play / Pause', click: () => sendToWindow(getWin, 'thumbar-toggle') },
    {
      label: 'Next Track',
      accelerator: 'CmdOrCtrl+Alt+Right',
      click: () => sendToWindow(getWin, 'thumbar-next'),
    },
    {
      label: 'Previous Track',
      accelerator: 'CmdOrCtrl+Alt+Left',
      click: () => sendToWindow(getWin, 'thumbar-prev'),
    },
  ];
}

function template(getWin: WinGetter): MenuItemConstructorOptions[] {
  return [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        // Built by hand: the `appMenu` role has no way to add a Preferences item.
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: command(getWin, 'preferences') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Add Music Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: command(getWin, 'add-folder'),
        },
        { type: 'separator' },
        { label: 'Rescan Media', click: command(getWin, 'scan-media') },
        { label: 'Full Rescan…', click: command(getWin, 'full-rescan') },
      ],
    },
    // Without this, Cmd+C/V/Z do nothing anywhere in the app.
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        // Not the zoomIn/zoomOut roles: those change the zoom factor without
        // persisting it, drifting out of step with the slider in Settings.
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: command(getWin, 'zoom-in') },
        // 'Plus' only matches Shift+=; a hidden twin catches the bare Cmd+=
        // without showing a duplicate row.
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: command(getWin, 'zoom-in'),
        },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: command(getWin, 'zoom-out') },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: command(getWin, 'zoom-reset') },
        // No `togglefullscreen` role: macOS appends its own Enter Full Screen to
        // any View menu, so adding one lists it twice. The separator groups it
        // away from zoom.
        { type: 'separator' },
      ],
    },
    { label: 'Playback', submenu: playbackItems(getWin) },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        {
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const focused = BrowserWindow.getFocusedWindow();
            if (!focused || focused.isDestroyed()) return;
            // Closing the main window tears down the renderer and stops playback
            // mid-song. Hide it instead; `activate` shows it again.
            if (focused === getWin()) focused.hide();
            else focused.close();
          },
        },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: `${app.name} Website`, click: () => void shell.openExternal(SITE_URL) },
        { label: `${app.name} on GitHub`, click: () => void shell.openExternal(REPO_URL) },
        { label: 'Discord (Support)', click: () => void shell.openExternal(DISCORD_URL) },
        { type: 'separator' },
        { label: 'Report an Issue…', click: () => void shell.openExternal(`${REPO_URL}/issues`) },
      ],
    },
  ];
}

export function installAppMenu(getWin: WinGetter): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }

  app.setAboutPanelOptions({
    applicationName: app.name,
    applicationVersion: app.getVersion(),
    copyright: `GPL-3.0 · ${REPO_URL}`,
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template(getWin)));
  // Dock menus take no accelerators, so these cost nothing in the text fields.
  app.dock?.setMenu(Menu.buildFromTemplate(playbackItems(getWin)));
}
