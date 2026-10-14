/**
 * A screen holding unsaved work registers a guard here, and anything that
 * navigates away asks it first.
 *
 * A module-level slot rather than a context because the two sides sit on
 * different branches of the tree: the title bar's back button is rendered by
 * App, the work is inside a route. React Router's own `useBlocker` needs a data
 * router, and this app routes through `HashRouter` + `useRoutes`.
 *
 * One slot, not a list: only one screen is on show at a time.
 */
import { ipcRenderer } from 'electron';

type Guard = () => Promise<boolean>;

let guard: Guard | null = null;

/** Returns the release function, so an effect can just `return setNavGuard(fn)`. */
export function setNavGuard(fn: Guard): () => void {
  guard = fn;
  // Closing the window is a way out too. Main leaves `close` alone until it
  // hears this, so a screen with nothing to lose costs nothing.
  ipcRenderer.send('nav-guard-active', true);
  return () => {
    if (guard !== fn) return;
    guard = null;
    ipcRenderer.send('nav-guard-active', false);
  };
}

// Main cancels the close and asks here. Registered once, at import, so it is
// listening before any screen has had a chance to register a guard.
ipcRenderer.on('confirm-close', async () => {
  let approved = true;
  try {
    approved = await confirmNavigation();
  } catch {
    // A guard that throws must not wedge the window shut.
  }
  ipcRenderer.send('confirm-close-reply', approved);
});

/** True when it is safe to leave. Unguarded screens always say yes. */
export async function confirmNavigation(): Promise<boolean> {
  return guard ? guard() : true;
}
