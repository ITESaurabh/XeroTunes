/**
 * The Quality Check's hidden window. Decoding and measuring a track holds a
 * renderer's main thread for hundreds of milliseconds, and only a renderer has
 * the audio decoders, so it happens in this one instead of the app's.
 * Jobs arrive from the main process one at a time (qualityWorker.ts).
 */
import { checkFile, compareFiles, visualiseFile } from './renderer/utils/qualityFile';
import type { FileFormat, QualityMetrics } from './renderer/utils/qualityAnalysis';

const { ipcRenderer } = window.require('electron');

interface Job {
  id: number;
  kind: 'check' | 'visuals' | 'compare';
  uri: string;
  duration?: number | null;
  format?: FileFormat;
  metrics?: QualityMetrics;
  otherUri?: string;
  otherDuration?: number | null;
}

ipcRenderer.on('quality-job', async (_e: unknown, job: Job) => {
  try {
    const result =
      job.kind === 'check'
        ? await checkFile(job.uri, job.duration ?? null)
        : job.kind === 'compare' && job.otherUri
          ? await compareFiles(
              { uri: job.uri, duration: job.duration ?? null },
              { uri: job.otherUri, duration: job.otherDuration ?? null }
            )
          : job.format && job.metrics
            ? await visualiseFile(job.uri, job.format, job.metrics)
            : null;
    ipcRenderer.send('quality-job-done', { id: job.id, result });
  } catch (err) {
    ipcRenderer.send('quality-job-done', {
      id: job.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

ipcRenderer.send('quality-worker-ready');
