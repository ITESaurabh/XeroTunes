import { useCallback } from 'react';

const { ipcRenderer } = window.require('electron');

export interface ConfirmOptions {
  /** Dialog title (window/sheet title). */
  title?: string;
  /** Primary message — the main question, shown in bold on most platforms. */
  message: string;
  /** Optional secondary explanatory text shown below the message. */
  detail?: string;
  /** Label for the confirming (action) button. Defaults to "OK". */
  confirmLabel?: string;
  /** Label for the cancelling button. Defaults to "Cancel". */
  cancelLabel?: string;
  /**
   * Marks the action as destructive. Renders a warning-style dialog and
   * defaults the focused button to Cancel, so an accidental Enter is safe.
   */
  destructive?: boolean;
}

export type ConfirmFn = (_options: ConfirmOptions) => Promise<boolean>;

/**
 * Returns a stable `confirm(options)` function that shows a native OS
 * confirmation dialog and resolves to `true` only if the user confirmed.
 *
 * Because it uses the platform's native dialog, it follows the system design
 * pattern automatically. Use it to guard any destructive action:
 *
 * ```tsx
 * const confirm = useConfirm();
 * const onDelete = async () => {
 *   if (await confirm({ message: 'Delete this?', destructive: true, confirmLabel: 'Delete' })) {
 *     // ...perform the deletion
 *   }
 * };
 * ```
 */
export function useConfirm(): ConfirmFn {
  return useCallback(async (options: ConfirmOptions): Promise<boolean> => {
    try {
      const res = (await ipcRenderer.invoke('show-confirm', options)) as
        | { confirmed?: boolean }
        | undefined;
      return Boolean(res?.confirmed);
    } catch {
      // If the dialog can't be shown, fail safe by not performing the action.
      return false;
    }
  }, []);
}

export default useConfirm;
