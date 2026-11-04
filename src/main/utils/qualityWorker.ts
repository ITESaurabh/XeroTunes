import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';

interface Pending {
  resolve: (_result: unknown) => void;
  reject: (_err: Error) => void;
}

/**
 * Runs Quality Check jobs in a hidden window (quality_worker_renderer.ts), so
 * decoding never touches the app window's main thread. The window is made on
 * the first job and kept; a file that crashes it fails that job, and the next
 * job makes a new one.
 */
export default function qualityWorkerIpcs(mainWin: BrowserWindow, entry: string) {
  let worker: BrowserWindow | null = null;
  let ready: Promise<void> | null = null;
  let nextId = 0;
  const jobs = new Map<number, Pending>();

  function start(): Promise<void> {
    if (worker && !worker.isDestroyed() && ready) return ready;
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        // Hidden windows have their timers throttled otherwise.
        backgroundThrottling: false,
      },
    });
    worker = win;

    const gone = (reason: string) => {
      if (worker === win) {
        worker = null;
        ready = null;
      }
      for (const job of jobs.values()) job.reject(new Error(reason));
      jobs.clear();
    };
    win.webContents.on('render-process-gone', (_e, details) => {
      gone(`The checker stopped (${details.reason}) on this file.`);
      if (!win.isDestroyed()) win.destroy();
    });
    win.on('closed', () => gone('The checker closed.'));

    ready = new Promise<void>((resolve, reject) => {
      const onReady = (e: IpcMainEvent) => {
        if (e.sender !== win.webContents) return;
        ipcMain.off('quality-worker-ready', onReady);
        resolve();
      };
      ipcMain.on('quality-worker-ready', onReady);
      win.loadURL(entry).catch((err: Error) => {
        ipcMain.off('quality-worker-ready', onReady);
        if (!win.isDestroyed()) win.destroy();
        reject(err);
      });
    });
    return ready;
  }

  ipcMain.handle(
    'quality-job',
    async (_e, job: { kind?: unknown; uri?: unknown; otherUri?: unknown }) => {
      const known = job?.kind === 'check' || job?.kind === 'visuals' || job?.kind === 'compare';
      if (!known || typeof job.uri !== 'string') throw new Error('Not a quality job');
      if (job.kind === 'compare' && typeof job.otherUri !== 'string') {
        throw new Error('A compare needs a second file');
      }
      await start();
      const win = worker;
      if (!win) throw new Error('The checker closed.');
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        jobs.set(id, { resolve, reject });
        win.webContents.send('quality-job', { ...job, id });
      });
    }
  );

  ipcMain.on(
    'quality-job-done',
    (e, { id, result, error }: { id: number; result?: unknown; error?: string }) => {
      if (e.sender !== worker?.webContents) return;
      const job = jobs.get(id);
      if (!job) return;
      jobs.delete(id);
      if (error) job.reject(new Error(error));
      else job.resolve(result);
    }
  );

  // A hidden window would otherwise keep the app running after its window closes.
  mainWin.on('closed', () => {
    if (worker && !worker.isDestroyed()) worker.destroy();
  });
}
