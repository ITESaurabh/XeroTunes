/**
 * Smart Shuffle: records which tracks the listener stays on and skips, and
 * while smart shuffle is on reorders what is coming up to match
 * (smartShuffleOrder.ts). Needs Mood analysis, whose stored embeddings are the
 * measure of "sounds like".
 */
import { useEffect, useRef, useSyncExternalStore, type Dispatch } from 'react';
import { getSettings, PLAYBACK_TICK_EVENT } from './LocStoreUtil';
import { queuedAround } from './queueOps';
import { MAX_SIGNALS, rerank, signalOf, type Signal, type TrackHistory } from './smartShuffleOrder';
import type { AppAction, AppState } from './store';

const { ipcRenderer } = window.require('electron');

// ---- the setting --------------------------------------------------------------
// Three switches decide it and a settings read is a synchronous IPC call, so the
// answer is cached here and refreshed when Settings changes one of them.

const read = () => {
  const s = getSettings();
  const recommending = s.moodAnalysisEnabled && s.smartRecommendationsEnabled;
  return { recommending, shuffle: recommending && s.smartShuffleEnabled };
};
/** Smart Recommendations is on, so stays and skips are remembered. */
let recommending = read().recommending;
let enabled = read().shuffle;
const listeners = new Set<() => void>();

export function refreshSmartShuffle(): void {
  const next = read();
  recommending = next.recommending;
  if (next.shuffle === enabled) return;
  enabled = next.shuffle;
  listeners.forEach(l => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** True when Settings allows Smart Shuffle, so the shuffle button offers it. */
export function useSmartShuffleEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => enabled);
}

// Which shuffle the listener last picked on the play bar: plain or smart. Kept
// apart from the settings file because it changes as often as shuffle itself.
const CHOSEN_KEY = 'smartShuffleChosen';
let chosen = localStorage.getItem(CHOSEN_KEY) !== 'false';

export function setSmartShuffleChosen(next: boolean): void {
  if (next === chosen) return;
  chosen = next;
  localStorage.setItem(CHOSEN_KEY, String(next));
  listeners.forEach(l => l());
}

/** True when a shuffle, while on, is the smart one. */
export function useSmartShuffleChosen(): boolean {
  return useSyncExternalStore(subscribe, () => enabled && chosen);
}

// ---- track vectors ------------------------------------------------------------

type Id = string | number;
let vectors = new Map<Id, Float32Array>();
let loadedAt = 0;
let loading: Promise<void> | null = null;

// ponytail: every analysed track's embedding is held in memory, about 800 kB per
// thousand tracks. Fetch only the queue's if a 50k-track library makes that matter.
async function loadVectors(): Promise<void> {
  const rows = (await ipcRenderer.invoke('get-mood-embeddings')) as { Id: Id; Emb: string }[];
  const raw = rows.map(r => ({ id: r.Id, emb: JSON.parse(r.Emb) as number[] }));
  if (!raw.length) return;
  const mean = new Float64Array(raw[0].emb.length);
  for (const { emb } of raw) emb.forEach((x, i) => (mean[i] += x / raw.length));
  vectors = new Map(raw.map(({ id, emb }) => [id, Float32Array.from(emb, (x, i) => x - mean[i])]));
}

/** Loads once, and again when a track has no vector yet and a minute has passed (the scan may have reached it). */
async function vectorsFor(ids: Id[]): Promise<Map<Id, Float32Array>> {
  const stale = Date.now() - loadedAt > 60_000 && ids.some(id => !vectors.has(id));
  if (!loadedAt || stale) {
    loading ??= loadVectors()
      .catch(err => console.error('smart shuffle: could not load mood data', err))
      .finally(() => {
        loadedAt = Date.now();
        loading = null;
      });
  }
  if (loading) await loading;
  return vectors;
}

// ---- listening history -----------------------------------------------------------

let history = new Map<Id, TrackHistory>();
/** Tracks stayed on lately or around this hour on earlier days, newest first. */
let seedIds: Id[] = [];
let historyLoaded: Promise<void> | null = null;

function loadHistory(): Promise<void> {
  historyLoaded ??= (
    ipcRenderer.invoke('get-listening-history') as Promise<{
      stats: { TrackId: number; Stays: number; Skips: number }[];
      seeds: number[];
    }>
  )
    .then(h => {
      history = new Map(h.stats.map(r => [r.TrackId, { stays: r.Stays, skips: r.Skips }]));
      seedIds = h.seeds;
    })
    .catch(err => console.error('smart shuffle: could not load listening history', err));
  return historyLoaded;
}

function remember(id: Id, weight: number): void {
  if (typeof id !== 'number') return;
  ipcRenderer.send('log-track-signal', { trackId: id, weight });
  const record = history.get(id) ?? { stays: 0, skips: 0 };
  if (weight > 0) record.stays++;
  else record.skips++;
  history.set(id, record);
}

export function forgetListeningHistory(): void {
  history = new Map();
  seedIds = [];
  signals.length = 0;
  seeded = true;
}

// ---- the session ----------------------------------------------------------------

/** Kept across queues: the mood carries over when the listener starts another playlist. */
const signals: Signal[] = [];
/**
 * A launch starts with no idea of the listener's mood, and finding it costs
 * skips. So the first shuffle is seeded with what they stayed on recently and
 * around this hour before, at half the weight of a live reaction.
 */
const SEED_WEIGHT = 0.5;
let seeded = false;

function seed(known: Map<Id, Float32Array>): void {
  if (seeded) return;
  seeded = true;
  if (signals.length) return;
  // Oldest first, as signals run.
  for (const id of [...seedIds].reverse()) {
    const vec = known.get(id);
    if (vec) signals.push({ vec, weight: SEED_WEIGHT });
  }
}

/** Call once, from the app's root. */
export function useSmartShuffle(state: AppState, dispatch: Dispatch<AppAction>): void {
  const stateRef = useRef(state);
  stateRef.current = state;
  const heard = useRef({ id: null as Id | null, index: -1, position: 0, duration: 0 });

  useEffect(() => {
    const onTick = (e: Event) => {
      const { position, duration } = (e as CustomEvent<{ position: number; duration: number }>)
        .detail;
      heard.current.position = position;
      heard.current.duration = duration;
    };
    window.addEventListener(PLAYBACK_TICK_EVENT, onTick);
    return () => window.removeEventListener(PLAYBACK_TICK_EVENT, onTick);
  }, []);

  /** Puts what is coming up in taste order; `reaction` is the track just left, if it said anything. */
  const reorder = useRef(async (reaction?: { id: Id; weight: number }) => {
    const [known] = await Promise.all([
      vectorsFor(stateRef.current.queue.map(t => t.Id)),
      loadHistory(),
    ]);
    seed(known);
    const vec = reaction && known.get(reaction.id);
    if (reaction && vec) {
      signals.push({ vec, weight: reaction.weight });
      if (signals.length > MAX_SIGNALS) signals.shift();
    }
    // The queue may have moved on while the data loaded.
    const s = stateRef.current;
    if (!enabled || !chosen || !s.isShuffle) return;
    const at = s.queueIndex;
    // The user's own "Play next" and "Add to queue" songs keep their places, as in a plain shuffle.
    const { next, later } = queuedAround(s.queue, at);
    const upcoming = s.queue.filter((t, i) => i > at && !t.Queued);
    if (upcoming.length < 2) return;
    const ranked = rerank(
      upcoming,
      t => known.get(t.Id),
      signals,
      t => history.get(t.Id)
    );
    if (ranked.every((t, i) => t === upcoming[i])) return;
    dispatch({
      type: 'REORDER_QUEUE',
      payload: [...s.queue.slice(0, at + 1), ...next, ...ranked, ...later],
    });
  });

  const trackId = state.track?.Id ?? null;
  const queueIndex = state.queueIndex;
  useEffect(() => {
    const left = heard.current;
    heard.current = { id: trackId, index: queueIndex, position: 0, duration: 0 };
    if (left.id == null || left.id === trackId || !recommending) return;
    const weight = signalOf(left.position, left.duration, queueIndex === left.index + 1);
    if (weight == null) return;
    // Remembered under any shuffle mode: the record is for every recommendation, not this one.
    remember(left.id, weight);
    if (enabled && chosen && stateRef.current.isShuffle) {
      void reorder.current({ id: left.id, weight });
    }
  }, [trackId, queueIndex]);

  // A fresh shuffle (a new queue, shuffle switched on, smart mode picked) is put
  // in taste order straight away, from the seed and each track's record.
  // originalOrder is replaced when the queue is, and kept through a reorder.
  const smart = useSmartShuffleChosen() && state.isShuffle;
  useEffect(() => {
    if (smart) void reorder.current();
  }, [smart, state.originalOrder]);
}
