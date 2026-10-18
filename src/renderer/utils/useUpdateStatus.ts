import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../main/modules/updateCheck';

const { ipcRenderer } = window.require('electron');

export const runUpdate = (): Promise<unknown> => ipcRenderer.invoke('run-update');
export const checkForUpdate = (): Promise<unknown> => ipcRenderer.invoke('check-for-update');

export function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  useEffect(() => {
    const onStatus = (_e: unknown, next: UpdateStatus) => setStatus(next);
    ipcRenderer
      .invoke('get-update-status')
      .then(setStatus)
      .catch(() => undefined);
    ipcRenderer.on('update-status', onStatus);
    return () => {
      ipcRenderer.removeListener('update-status', onStatus);
    };
  }, []);
  return status;
}
