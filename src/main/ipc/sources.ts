import { BrowserWindow, dialog, ipcMain } from 'electron';
import * as sources from '../sources/sync';
import { getProvider, listProviders } from '../sources/registry';

export function registerSourceIpc(
  mainWin: BrowserWindow,
  getDownloadFolder: () => string,
  setDownloadFolder: (_folder: string) => void,
  getLibrarySettings: () => { multiArtistSeparators?: string[]; multiArtistExceptions?: string[] }
): void {
  ipcMain.handle('get-sources', () => sources.listSources());
  ipcMain.handle('get-source-providers', () => listProviders());
  ipcMain.handle('check-sources', () => sources.checkSources());
  ipcMain.handle('cancel-sync', () => sources.cancelSync());
  // For a renderer that reloaded mid-sync and so missed 'sync-state'.
  ipcMain.handle('is-syncing', () => sources.isSyncing());

  // Whatever answers within the protocol's own wait.
  ipcMain.handle('discover-servers', async (_e, { type }) => {
    try {
      return (await getProvider(type)?.discover?.()) ?? [];
    } catch {
      // A network that drops multicast is an empty list, not a failed dialog.
      return [];
    }
  });

  ipcMain.handle('add-source', async (_e, { type, baseUrl, username, password, metadata }) => {
    if (!baseUrl || typeof baseUrl !== 'string') {
      return { success: false, error: 'Server address is required' };
    }
    const url = /^https?:\/\//i.test(baseUrl) ? baseUrl : `http://${baseUrl}`;
    const result = await sources.addSource(type, {
      baseUrl: url,
      username,
      password,
      // Chosen before the first sync, which is the one that would otherwise
      // read every file on the share.
      config: metadata ? { metadata } : undefined,
    });
    // Sync straight away; an empty server in the list looks like a failure.
    if (result.success) {
      void sources.syncSource(result.sourceId, mainWin, {
        librarySettings: getLibrarySettings(),
      });
    }
    return result;
  });

  // Takes effect on the next sync: tracks already read keep their tags, and
  // switching to a mode that reads gets them on the sync after this.
  ipcMain.handle('set-source-metadata', (_e, { sourceId, mode }) =>
    sources.setMetadataMode(sourceId, mode)
  );

  ipcMain.handle('remove-source', (_e, { sourceId }) => {
    const result = sources.removeSource(sourceId);
    mainWin.webContents.send('library-updated', {});
    return result;
  });

  // Deliberately no 'library-updated' broadcast: it refreshes the queue snapshot
  // from the DB, and swapping the playing track's Uri between stream and file
  // would reload the audio element and restart the song. The renderer
  // invalidates its own list queries instead.
  // Lyrics and technical details live on the server, not in a local file; the
  // renderer asks for them by track id and doesn't need to know that.
  // Fired when a track loads in the player; a no-op for anything already
  // tagged, which is every local track and most remote ones.
  ipcMain.handle('ensure-remote-tags', async (_e, { trackId }) => {
    const result = await sources.ensureRemoteTags(trackId, getLibrarySettings());
    // The Uri doesn't change here, only the tags, so the queue snapshot can be
    // refreshed without the audio element reloading and restarting the song.
    if (result.updated) mainWin.webContents.send('library-updated', {});
    return result;
  });

  ipcMain.handle('get-remote-lyrics', (_e, { trackId }) => sources.remoteLyrics(trackId));
  ipcMain.handle('get-remote-track-details', (_e, { trackId }) =>
    sources.remoteTrackDetails(trackId)
  );

  ipcMain.handle('download-track', (_e, { trackId }) =>
    sources.downloadTrack(trackId, getDownloadFolder())
  );
  ipcMain.handle('get-download-folder', () => sources.downloadsRoot(getDownloadFolder()));

  ipcMain.handle('choose-download-folder', async () => {
    const result = await dialog.showOpenDialog(mainWin, {
      title: 'Choose Download Folder',
      defaultPath: sources.downloadsRoot(getDownloadFolder()),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { success: false };
    setDownloadFolder(result.filePaths[0]);
    return { success: true, path: result.filePaths[0] };
  });

  // Empty restores the default, <Music>/<app name>.
  ipcMain.handle('reset-download-folder', () => {
    setDownloadFolder('');
    return { success: true, path: sources.downloadsRoot('') };
  });
  ipcMain.handle('remove-download', (_e, { trackId }) => sources.removeDownload(trackId));
}
