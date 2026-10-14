/**
 * Runs the actions the macOS menu asks for, using the same calls the equivalent
 * button makes so the two cannot drift apart. Playback is absent on purpose:
 * those items reuse the `thumbar-*` channels PlayBar already listens on.
 */

import { useCallback, useEffect } from 'react';
import { ipcRenderer } from 'electron';
import { useNavigate } from 'react-router';
import { useIpc } from '../state/ipc';
import { useConfirm } from './useConfirm';
import { getWindowScale, setWindowScale } from './LocStoreUtil';
import { WINDOW_SCALE_OPTIONS } from '../../config/app_settings';

function steppedScale(current: number, direction: 1 | -1): number {
  const ladder = [...WINDOW_SCALE_OPTIONS].sort((a, b) => a - b);
  const next =
    direction === 1
      ? ladder.find(step => step > current + 0.001)
      : [...ladder].reverse().find(step => step < current - 0.001);
  return next ?? current;
}

export function useMenuCommands(): void {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { invokeEventToMainProcess } = useIpc();

  const run = useCallback(
    async (command: string): Promise<void> => {
      switch (command) {
        case 'preferences':
          navigate('/main_window/settings');
          return;

        case 'add-folder':
          await invokeEventToMainProcess('add-music-folder', undefined).catch(() => undefined);
          return;

        case 'scan-media':
          await invokeEventToMainProcess('scan-media', undefined).catch((err: unknown) =>
            console.error('Error rescanning media:', err)
          );
          return;

        case 'full-rescan': {
          // Keep in sync with the Settings button's confirmation.
          const ok = await confirm({
            title: 'Full rescan the library?',
            message: 'This rebuilds the entire library from scratch.',
            detail:
              "All track's metadata and album thumbnails will be rebuilt, and the “Recently Added” list will be reset. This can take a while for large libraries.",
            confirmLabel: 'Yes, Just do it!',
            destructive: true,
          });
          if (!ok) return;
          await invokeEventToMainProcess('full-rescan', undefined).catch((err: unknown) =>
            console.error('Error during full rescan:', err)
          );
          return;
        }

        case 'zoom-in':
          setWindowScale(steppedScale(getWindowScale(), 1));
          return;

        case 'zoom-out':
          setWindowScale(steppedScale(getWindowScale(), -1));
          return;

        case 'zoom-reset':
          setWindowScale(1);
          return;

        default:
          console.warn('Unknown menu command:', command);
      }
    },
    [confirm, invokeEventToMainProcess, navigate]
  );

  useEffect(() => {
    const handler = (_event: unknown, command: string): void => {
      void run(command);
    };
    ipcRenderer.on('menu-command', handler);
    return () => {
      ipcRenderer.removeListener('menu-command', handler);
    };
  }, [run]);
}

export default useMenuCommands;
