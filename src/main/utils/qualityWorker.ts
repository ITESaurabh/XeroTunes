import os from 'os';
import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';

interface Pending {
  slot: number;
  resolve: (_result: unknown) => void;
  reject: (_err: Error) => void;
}

interface Worker {
  win: BrowserWindow;
  ready: Promise<void>;
  idle?: NodeJS.Timeout;
}

/** Slot 0 plus the extra windows a multi-threaded mood scan may ask for. */
const MAX_SLOTS = 8;
const IDLE_MS = 60_000;

/**
 * Runs Quality Check and mood jobs in hidden windows (quality_worker_renderer.ts),
 * so decoding never touches the app window's main thread. A slot's window is made
 * on its first job and closed after IDLE_MS idle: it is a whole renderer process,
 * and after a mood job it holds the models too. A file that crashes a window fails
 * that window's jobs, and the next job makes a new one.
 */
export default function qualityWorkerIpcs(mainWin: BrowserWindow, entry: string) {
  const workers = new Map<number, Worker>();
  let nextId = 0;
  const jobs = new Map<number, Pending>();

  function start(slot: number): Promise<void> {
    const running = workers.get(slot);
    if (running && !running.win.isDestroyed()) return running.ready;
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        // Hidden windows have their timers throttled otherwise.
        backgroundThrottling: false,
      },
    });

    const gone = (reason: string) => {
      if (workers.get(slot)?.win === win) workers.delete(slot);
      for (const [id, job] of jobs) {
        if (job.slot !== slot) continue;
        jobs.delete(id);
        job.reject(new Error(reason));
      }
    };
    win.webContents.on('render-process-gone', (_e, details) => {
      gone(`The checker stopped (${details.reason}) on this file.`);
      if (!win.isDestroyed()) win.destroy();
    });
    win.on('closed', () => gone('The checker closed.'));

    const ready = new Promise<void>((resolve, reject) => {
      const onReady = (e: IpcMainEvent) => {
        if (e.sender !== win.webContents) return;
        ipcMain.off('quality-worker-ready', onReady);
        // The extra windows exist only to use more cores; below-normal priority
        // keeps playback and the desktop ahead of them.
        if (slot > 0) {
          try {
            os.setPriority(
              win.webContents.getOSProcessId(),
              os.constants.priority.PRIORITY_BELOW_NORMAL
            );
          } catch {
            /* the scan still runs at normal priority */
          }
        }
        resolve();
      };
      ipcMain.on('quality-worker-ready', onReady);
      win.loadURL(entry).catch((err: Error) => {
        ipcMain.off('quality-worker-ready', onReady);
        if (!win.isDestroyed()) win.destroy();
        reject(err);
      });
    });
    workers.set(slot, { win, ready });
    return ready;
  }

  const busy = (slot: number) => [...jobs.values()].some(job => job.slot === slot);

  function closeWhenIdle(slot: number) {
    const worker = workers.get(slot);
    if (!worker) return;
    clearTimeout(worker.idle);
    worker.idle = setTimeout(() => {
      if (!busy(slot) && !worker.win.isDestroyed()) worker.win.destroy();
    }, IDLE_MS);
  }

  ipcMain.handle(
    'quality-job',
    async (
      _e,
      job: { kind?: unknown; uri?: unknown; otherUri?: unknown; modelDir?: unknown; slot?: unknown }
    ) => {
      const known =
        job?.kind === 'check' ||
        job?.kind === 'visuals' ||
        job?.kind === 'compare' ||
        job?.kind === 'mood';
      if (!known || typeof job.uri !== 'string') throw new Error('Not a quality job');
      if (job.kind === 'compare' && typeof job.otherUri !== 'string') {
        throw new Error('A compare needs a second file');
      }
      if (job.kind === 'mood' && typeof job.modelDir !== 'string') {
        throw new Error('A mood job needs the model folder');
      }
      const slot = job.slot ?? 0;
      if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= MAX_SLOTS) {
        throw new Error('No such worker');
      }
      await start(slot);
      const win = workers.get(slot)?.win;
      if (!win || win.isDestroyed()) throw new Error('The checker closed.');
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        jobs.set(id, { slot, resolve, reject });
        win.webContents.send('quality-job', { ...job, id });
      });
    }
  );

  ipcMain.on(
    'quality-job-done',
    (e, { id, result, error }: { id: number; result?: unknown; error?: string }) => {
      const job = jobs.get(id);
      if (!job || e.sender !== workers.get(job.slot)?.win.webContents) return;
      jobs.delete(id);
      if (error) job.reject(new Error(error));
      else job.resolve(result);
      if (!busy(job.slot)) closeWhenIdle(job.slot);
    }
  );

  // A hidden window would otherwise keep the app running after its window closes.
  mainWin.on('closed', () => {
    for (const { win } of workers.values()) if (!win.isDestroyed()) win.destroy();
  });
}
