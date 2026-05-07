import React, { useEffect, useContext, createContext, useMemo, ReactNode } from 'react';
import { store, LibraryStats } from '../utils/store';
import { debounce } from '../utils/misc';

const { ipcRenderer } = window.require('electron');

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
}

export const IpcProvider = ({ children }: IpcProviderProps) => {
  const { dispatch } = useContext(store);

  // Sync scan state on mount — the auto-scan may have started before React mounted
  // Note: these handlers are only registered in the main window context, not the mini player.
  useEffect(() => {
    ipcRenderer
      .invoke('get-scan-status')
      .then((res: unknown) => {
        const status = res as { isScanning: boolean };
        dispatch({ type: 'SET_SCANNING', payload: status.isScanning });
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
    return () => {
      ipcRenderer.removeAllListeners('play-mini');
    };
  }, []);

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
    const handleScanStart = () => {
      dispatch({ type: 'SET_SCANNING', payload: true });
    };
    const handleScanProgress = (
      _event: Electron.IpcRendererEvent,
      arg: { scanned: number; total: number; processed: number }
    ) => {
      dispatch({ type: 'SET_SCAN_PROGRESS', payload: arg });
    };
    const handleScanEnd = () => {
      dispatch({ type: 'SET_SCANNING', payload: false });
      // Refresh stats after scan completes
      ipcRenderer
        .invoke('get-library-stats')
        .then((res: unknown) => {
          dispatch({ type: 'SET_LIBRARY_STATS', payload: res as LibraryStats });
        })
        .catch(() => undefined);
    };

    ipcRenderer.on('scan-start', handleScanStart);
    ipcRenderer.on('scan-progress', handleScanProgress);
    ipcRenderer.on('scan-end', handleScanEnd);
    return () => {
      ipcRenderer.removeListener('scan-start', handleScanStart);
      ipcRenderer.removeListener('scan-progress', handleScanProgress);
      ipcRenderer.removeListener('scan-end', handleScanEnd);
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
