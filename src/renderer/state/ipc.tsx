import React, { useEffect, useContext, createContext, useMemo, useRef, ReactNode } from 'react';
import { parseFile } from 'music-metadata';
import { store, LibraryStats, Track } from '../utils/store';
import { debounce } from '../utils/misc';
import { ScanMode } from '../../config/constants';

const { ipcRenderer } = window.require('electron');

function fileTitle(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  return base.replace(/\.[^.]+$/, '');
}

interface IpcContextValue {
  sendEventToMainProcess: (event: string, payload?: unknown) => void;
  invokeEventToMainProcess: (event: string, payload?: unknown) => Promise<unknown>;
}

const IpcContext = createContext<IpcContextValue | undefined>(undefined);

export const useIpc = (): IpcContextValue => {
  const ctx = useContext(IpcContext);
  if (!ctx) throw new Error('useIpc must be used within IpcProvider');
  return ctx;
};

interface IpcProviderProps {
  children: ReactNode;
  // The mini player runs without mainIpcs, so scan/library handlers don't
  // exist there — invoking them just logs "No handler registered" errors.
  mini?: boolean;
}

export const IpcProvider = ({ children, mini = false }: IpcProviderProps) => {
  const { state, dispatch } = useContext(store);
  // Read through a ref so the long-lived IPC listeners below can stay on empty
  // deps instead of being torn down and re-attached on every queue change.
  const queueIdsRef = useRef<(string | number)[]>([]);
  queueIdsRef.current = [
    ...new Set([...state.queue.map(t => t.Id), ...(state.track ? [state.track.Id] : [])]),
  ];

  // Sync scan state on mount — the auto-scan may have started before React mounted
  useEffect(() => {
    if (mini) return;
    ipcRenderer
      .invoke('get-scan-status')
      .then((res: unknown) => {
        const status = res as { isScanning: boolean; scanMode?: ScanMode | null };
        dispatch({
          type: 'SET_SCANNING',
          payload: { isScanning: status.isScanning, scanMode: status.scanMode },
        });
      })
      .catch(() => undefined);
    // Fetch initial library stats
    ipcRenderer
      .invoke('get-library-stats')
      .then((res: unknown) => {
        dispatch({ type: 'SET_LIBRARY_STATS', payload: res as LibraryStats });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const handleIpcMessage = (_event: Electron.IpcRendererEvent, arg: string) => {
      dispatch({ type: 'SET_PATH', payload: arg });
    };

    ipcRenderer.on('play-mini', handleIpcMessage);
    // Tells main the listener is mounted so it can deliver the launch file.
    // Harmless in the main window — nothing listens for it there.
    ipcRenderer.send('mini-player-ready');
    return () => {
      ipcRenderer.removeAllListeners('play-mini');
    };
  }, []);

  // "Open with" while the full player is running: play here instead of
  // spawning a mini player. The file may be outside the library, so build a
  // transient one-track queue from its tags.
  useEffect(() => {
    if (mini) return;
    const handlePlayExternal = async (_event: Electron.IpcRendererEvent, filePath: string) => {
      if (!filePath) return;
      let title = fileTitle(filePath);
      let artist = '';
      let album = '';
      try {
        const meta = await parseFile(filePath, { skipCovers: true });
        title = meta.common.title || title;
        artist = meta.common.artist || '';
        album = meta.common.album || '';
      } catch {
        /* unreadable tags — filename fallback already set above */
      }
      // Id doubles as the queue key; the path is unique and won't collide with
      // library rows (numeric ids), so play-count updates simply no-op.
      const track = { Id: filePath, Title: title, ArtistName: artist, AlbumTitle: album, Uri: filePath };
      dispatch({ type: 'SET_QUEUE', payload: { queue: [track], index: 0, source: null } });
      dispatch({ type: 'SET_CURR_TRACK', payload: track });
      dispatch({ type: 'SET_IS_PLAYING', payload: true });
    };
    ipcRenderer.on('play-external-file', handlePlayExternal);
    return () => {
      ipcRenderer.removeListener('play-external-file', handlePlayExternal);
    };
  }, [mini, dispatch]);

  useEffect(() => {
    const handleExpandMessage = debounce((_event: Electron.IpcRendererEvent, arg: boolean) => {
      dispatch({ type: 'SET_IS_MAXIMIZED', payload: arg });
      console.log('arg', arg, _event);
    }, 200);

    ipcRenderer.on('expand-state', handleExpandMessage);
    return () => {
      ipcRenderer.removeAllListeners('expand-state');
    };
  });

  useEffect(() => {
    if (mini) return;
    const handleScanStart = (_event: Electron.IpcRendererEvent, mode?: ScanMode) => {
      dispatch({
        type: 'SET_SCANNING',
        payload: { isScanning: true, scanMode: mode ?? 'basic' },
      });
    };
    const handleScanProgress = (
      _event: Electron.IpcRendererEvent,
      arg: { scanned: number; total: number; processed: number }
    ) => {
      dispatch({ type: 'SET_SCAN_PROGRESS', payload: arg });
    };
    const refreshStats = () => {
      ipcRenderer
        .invoke('get-library-stats')
        .then((res: unknown) => {
          dispatch({ type: 'SET_LIBRARY_STATS', payload: res as LibraryStats });
        })
        .catch(() => undefined);
    };
    const handleScanEnd = () => {
      dispatch({ type: 'SET_SCANNING', payload: { isScanning: false } });
      refreshStats();
    };

    // Non-scan mutations (e.g. folder removal) fire this without a scan-end.
    const handleLibraryUpdated = (
      _event: Electron.IpcRendererEvent,
      payload?: { wiped?: boolean }
    ) => {
      refreshStats();
      if (payload?.wiped) {
        dispatch({ type: 'RESET_PLAYBACK' });
        return;
      }
      // Title, artist and cover in the player bar come from this snapshot, not
      // from the library queries, so re-read the rows it still points at.
      if (!queueIdsRef.current.length) return;
      ipcRenderer
        .invoke('get-queue-tracks', { trackIds: queueIdsRef.current })
        .then((rows: unknown) => {
          dispatch({ type: 'REFRESH_QUEUE_TRACKS', payload: rows as Track[] });
        })
        .catch(() => undefined);
    };

    ipcRenderer.on('scan-start', handleScanStart);
    ipcRenderer.on('scan-progress', handleScanProgress);
    ipcRenderer.on('scan-end', handleScanEnd);
    ipcRenderer.on('library-updated', handleLibraryUpdated);
    return () => {
      ipcRenderer.removeListener('scan-start', handleScanStart);
      ipcRenderer.removeListener('scan-progress', handleScanProgress);
      ipcRenderer.removeListener('scan-end', handleScanEnd);
      ipcRenderer.removeListener('library-updated', handleLibraryUpdated);
    };
  }, []);

  // Memoize so consumers using these as effect deps don't re-fire on every
  // store dispatch (provider re-renders → new fn refs → cascading effect runs).
  const value = useMemo<IpcContextValue>(
    () => ({
      sendEventToMainProcess: (event: string, payload: unknown): void => {
        ipcRenderer.send(event, payload);
      },
      invokeEventToMainProcess: (event: string, payload: unknown): Promise<unknown> => {
        return ipcRenderer.invoke(event, payload);
      },
    }),
    []
  );

  return <IpcContext.Provider value={value}>{children}</IpcContext.Provider>;
};
