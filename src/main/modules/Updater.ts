/**
 * Checks GitHub for a newer release on this channel. Only Windows installs it
 * itself: Squirrel.Mac needs a signed app, and on Linux the package manager owns the files.
 */
import { app, autoUpdater, BrowserWindow, clipboard, dialog, ipcMain, net, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CHANNEL, IDENTITY } from '../../config/channel';
import { REPO_URL } from '../../config/constants';
import { compareVersions, newestRelease, Release, UpdateAction, UpdateStatus } from './updateCheck';

const API = REPO_URL.replace('https://github.com/', 'https://api.github.com/repos/');
const HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': IDENTITY.productName };
const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
// The linux-repos job publishes the apt and dnf indexes after the release itself.
const LINUX_REPO_DELAY_MS = 60 * 60 * 1000;

interface OsFloor {
  glibc: string;
  macos: string;
  windows: string;
}

let status: UpdateStatus = { state: 'idle' };
let target: Release | null = null;
let inFlight: Promise<void> | null = null;
let getWin: () => BrowserWindow | null = () => null;

function setStatus(next: UpdateStatus): void {
  status = next;
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send('update-status', status);
}

function systemFloor(floor: OsFloor): [label: string, needed: string, have: string | undefined] {
  if (process.platform === 'darwin') return ['macOS', floor.macos, process.getSystemVersion()];
  if (process.platform === 'win32') return ['Windows', floor.windows, os.release()];
  const header = (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } })
    ?.header;
  return ['glibc', floor.glibc, header?.glibcVersionRuntime];
}

function installAction(): { action: UpdateAction; hint?: string } {
  if (process.platform === 'win32') {
    // The portable zip has no Update.exe for Squirrel to drive.
    const squirrel = fs.existsSync(path.resolve(process.execPath, '..', '..', 'Update.exe'));
    return { action: squirrel ? 'install' : 'download' };
  }
  if (process.platform !== 'linux') return { action: 'download' };
  const name = IDENTITY.installName;
  if (fs.existsSync(`/etc/apt/sources.list.d/${name}.sources`))
    return { action: 'system', hint: 'sudo apt update && sudo apt upgrade' };
  if (fs.existsSync(`/etc/yum.repos.d/${name}.repo`))
    return { action: 'system', hint: 'sudo dnf upgrade' };
  try {
    if (fs.readdirSync('/var/lib/pacman/local').some(d => d.startsWith(`${name}-bin-`)))
      return { action: 'system', hint: 'yay -Syu' };
  } catch {
    /* not Arch */
  }
  return { action: 'download' };
}

function downloadUrl(release: Release): string {
  if (process.platform === 'darwin') {
    const intel = process.arch === 'x64';
    const dmg = release.assets.find(
      a => a.name.endsWith('.dmg') && a.name.endsWith('-intel.dmg') === intel
    );
    if (dmg) return dmg.browser_download_url;
  }
  return release.html_url;
}

/** A manual check during a timed one waits for it instead of starting another. */
export function checkForUpdate(): Promise<void> {
  if (status.state === 'downloading' || status.state === 'ready') return Promise.resolve();
  return (inFlight ??= runCheck().finally(() => (inFlight = null)));
}

async function runCheck(): Promise<void> {
  const previous = status;
  setStatus({ state: 'checking' });
  try {
    const beta = CHANNEL === 'beta';
    const res = await fetch(beta ? `${API}/releases?per_page=20` : `${API}/releases/latest`, {
      headers: HEADERS,
    });
    // 404: no stable release yet.
    if (res.status === 404) return setStatus({ state: 'up-to-date' });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const body = await res.json();
    const release = newestRelease(Array.isArray(body) ? body : [body], beta);
    // No floor file yet: the release workflow is still running, or failed.
    const floorAsset = release?.assets.find(a => a.name === 'os-floor.json');
    if (!release || !floorAsset || compareVersions(release.tag_name, app.getVersion()) <= 0)
      return setStatus({ state: 'up-to-date' });
    if (
      process.platform === 'linux' &&
      Date.now() - Date.parse(release.published_at) < LINUX_REPO_DELAY_MS
    )
      return setStatus({ state: 'up-to-date' });

    const floorRes = await fetch(floorAsset.browser_download_url, { headers: HEADERS });
    if (!floorRes.ok) throw new Error(`os-floor.json answered ${floorRes.status}`);
    const [label, needed, have] = systemFloor((await floorRes.json()) as OsFloor);
    const version = release.tag_name.replace(/^v/, '');
    if (have && needed && compareVersions(have, needed) < 0)
      return setStatus({ state: 'unsupported', version, needs: `${label} ${needed}` });

    target = release;
    setStatus({ state: 'available', version, ...installAction() });
  } catch (err) {
    console.warn('Update check failed:', err);
    // A dropped connection shouldn't hide an update already found.
    setStatus(previous.state === 'available' ? previous : { state: 'error' });
  }
}

/** The only path that answers with a dialog; timed checks stay silent. */
async function manualCheck(): Promise<void> {
  await checkForUpdate();
  const { state, version, action, hint, needs } = status;
  const current = app.getVersion();
  const available = `Version ${version} is available`;
  const show = async (
    message: string,
    detail: string,
    act?: [string, () => void],
    close = 'OK'
  ) => {
    const buttons = act ? [act[0], close] : [close];
    const options = {
      type: 'info' as const,
      message,
      detail,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
    };
    const win = getWin();
    const { response } = await (win && !win.isDestroyed()
      ? dialog.showMessageBox(win, options)
      : dialog.showMessageBox(options));
    if (act && response === 0) act[1]();
  };

  if (state === 'available' && action === 'system' && hint)
    return show(
      available,
      `Install it with your system updates:\n\n${hint}`,
      ['Copy command', () => clipboard.writeText(hint)],
      'Close'
    );
  if (state === 'available')
    return show(
      available,
      `You have version ${current}.`,
      [action === 'install' ? 'Update' : 'Download', runUpdate],
      'Later'
    );
  // ponytail: only the newest release's floor is read, so a system that skipped a release
  // still within its floor hears it's on the last one; scan older floors if that bites.
  if (state === 'unsupported')
    return show(
      "You're on the last version for this system",
      `Version ${version} needs ${needs} or newer.`
    );
  if (state === 'error')
    return net.isOnline()
      ? show("Couldn't check for updates", "GitHub didn't answer. Try again later.")
      : show("You're offline", 'Connect to the internet and try again.');
  if (state === 'up-to-date')
    return show('You have the latest version', `${IDENTITY.productName} ${current}`);
}

function runUpdate(): void {
  if (status.state === 'ready') return autoUpdater.quitAndInstall();
  if (status.state !== 'available' || !target) return;
  // Linux repo installs: the command is the only action, and the check's dialog shows it.
  if (status.action === 'system') {
    void manualCheck();
  } else if (status.action === 'download') {
    void shell.openExternal(downloadUrl(target));
  } else if (status.action === 'install') {
    autoUpdater.setFeedURL({ url: `${REPO_URL}/releases/download/${target.tag_name}` });
    autoUpdater.checkForUpdates();
    setStatus({ ...status, state: 'downloading' });
  }
}

/** Call once; the getter follows the main window across macOS re-activation. */
export function initUpdater(windowGetter: () => BrowserWindow | null): void {
  getWin = windowGetter;
  ipcMain.handle('get-update-status', () => status);
  ipcMain.handle('check-for-update', () => manualCheck());
  ipcMain.handle('run-update', () => runUpdate());

  if (process.platform === 'win32') {
    autoUpdater.on('update-downloaded', () => setStatus({ ...status, state: 'ready' }));
    // Squirrel failed, or refused because it orders beta10 before beta9: offer the download.
    const fallBack = () => setStatus({ ...status, state: 'available', action: 'download' });
    autoUpdater.on('update-not-available', fallBack);
    autoUpdater.on('error', err => {
      console.warn('Squirrel update failed:', err);
      fallBack();
    });
  }

  // Squirrel locks the install right after the first run, and checks fail until it lets go.
  if (!process.argv.includes('--squirrel-firstrun'))
    setTimeout(() => void checkForUpdate(), FIRST_CHECK_MS);
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
}
