/**
 * Background mood scan: while the setting is on, sends each local track without a
 * stored result to a hidden worker window (moodFile.ts) and saves it in TrackMood.
 */
import { useSyncExternalStore } from 'react';
import { getMoodAnalysisEnabled, getMoodMultiThread, getMoodUseLyrics } from './LocStoreUtil';
import { MOOD_VERSION, type MoodFeatures } from './moodFeatures';
import { MOOD_LABEL, moodOf, type LyricFeatures } from './moodScore';

const { ipcRenderer } = window.require('electron');

/** Same text as MOOD_SETUP_ERROR in moodFile.ts, which this window must not import (it loads the models). */
const SETUP_ERROR = 'mood-setup: ';

/**
 * Tracks analysed at once in a multi-thread scan: half the threads, so playback and
 * the desktop keep the rest, and at most four, since each is a renderer process with
 * its own copy of the models.
 */
export const MOOD_WORKERS = Math.max(1, Math.min(4, Math.floor(navigator.hardwareConcurrency / 2)));

export interface MoodScanState {
  status: 'off' | 'downloading' | 'running' | 'idle' | 'failed';
  done: number;
  total: number;
  /** Tracks stored with an error: unreadable, silent or over 30 minutes. */
  errored: number;
  /** Why the scan stopped; set with status 'failed'. */
  error: string | null;
}

interface PendingRow {
  Id: number;
  Uri: string;
  Duration: number | null;
  FileHash: string | null;
}

type StoredMood = Partial<MoodFeatures> & { lyrics?: LyricFeatures | null; error?: string };

let state: MoodScanState = { status: 'off', done: 0, total: 0, errored: 0, error: null };
const listeners = new Set<() => void>();
function publish(patch: Partial<MoodScanState>) {
  state = { ...state, ...patch };
  // The taskbar icon shows the scan; -1 clears it.
  ipcRenderer.send(
    'mood-progress',
    state.status === 'running' && state.total ? state.done / state.total : -1
  );
  listeners.forEach(l => l());
}

const errorText = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(
    /^Error invoking remote method '[^']*': (Error: )?/,
    ''
  );

let running = false;
/** Set when a setting or the library changed mid-scan: the scan stops and starts over on the new state. */
let again = false;

async function run() {
  publish({ status: 'downloading', error: null });
  const { dir } = (await ipcRenderer.invoke('mood-models', { download: true })) as { dir: string };
  const { tracks, total } = (await ipcRenderer.invoke('get-mood-pending', {
    version: MOOD_VERSION,
  })) as { tracks: PendingRow[]; total: number };
  let done = total - tracks.length;
  publish({ status: 'running', done, total });
  // Copies of one audio file share a key, so the second is already answered.
  const seen = new Set<string>();
  let next = 0;
  // One worker hitting a setup failure ends the others too.
  let failed = false;
  const worker = async (slot: number) => {
    while (next < tracks.length && getMoodAnalysisEnabled() && !again && !failed) {
      const row = tracks[next++];
      const key = row.FileHash?.trim() || row.Uri;
      if (!seen.has(key)) {
        seen.add(key);
        let features: StoredMood;
        try {
          features = (await ipcRenderer.invoke('quality-job', {
            kind: 'mood',
            uri: row.Uri,
            duration: row.Duration || null,
            modelDir: dir,
            slot,
          })) as StoredMood;
        } catch (err) {
          const message = errorText(err);
          if (message.startsWith(SETUP_ERROR)) {
            failed = true;
            throw new Error(message.slice(SETUP_ERROR.length), { cause: err });
          }
          // Stored, so an undecodable file isn't retried on every launch.
          features = { error: message };
        }
        await ipcRenderer.invoke('save-track-mood', {
          key,
          version: MOOD_VERSION,
          features: JSON.stringify(features),
        });
      }
      publish({ done: ++done });
    }
  };
  const count = getMoodMultiThread() ? MOOD_WORKERS : 1;
  await Promise.all(Array.from({ length: count }, (_, slot) => worker(slot)));
  // Counted from the database, so a copy of a failed file counts too.
  const { errored } = (await ipcRenderer.invoke('get-mood-pending', {
    version: MOOD_VERSION,
  })) as { errored: number };
  publish({ status: getMoodAnalysisEnabled() ? 'idle' : 'off', errored });
}

export const moodScan = {
  /** Starts, restarts or stops the scan to match the settings; call it when one of them or the library changes. */
  async sync() {
    if (running) {
      again = true;
      return;
    }
    if (!getMoodAnalysisEnabled()) return publish({ status: 'off' });
    running = true;
    try {
      do {
        again = false;
        await run();
      } while (again && getMoodAnalysisEnabled());
    } catch (err) {
      console.error('mood: scan stopped', err);
      publish({ status: 'failed', error: errorText(err) });
    } finally {
      running = false;
    }
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useMoodScan(): MoodScanState {
  return useSyncExternalStore(subscribe, () => state);
}

export async function moodSummary(trackId: number): Promise<string | null> {
  const stored = (await ipcRenderer.invoke('get-track-mood', { trackId })) as string | null;
  if (!stored) return null;
  const f = JSON.parse(stored) as StoredMood;
  if (f.happy == null) return null;
  const { mood } = moodOf(
    f as Record<string, number | undefined>,
    getMoodUseLyrics() ? f.lyrics : null
  );
  const tags = (['happy', 'sad', 'aggressive', 'relaxed', 'party'] as const)
    .map(name => ({ name, p: f[name] ?? 0 }))
    .filter(m => m.p >= 0.5)
    .sort((a, b) => b.p - a.p)
    .map(m => `${m.name} ${Math.round(m.p * 100)}%`);
  return tags.length ? `${MOOD_LABEL[mood]} (${tags.join(', ')})` : MOOD_LABEL[mood];
}
