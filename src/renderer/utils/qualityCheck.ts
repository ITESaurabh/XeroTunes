/**
 * Quality Check: sends local files one at a time to the hidden checker window
 * (qualityFile.ts) and keeps one report per audio file in the library database.
 * Separate from the music scan worker, which runs in Node and has no audio
 * decoder. The scan lives at module level so it keeps going when the page
 * unmounts.
 */
import { useSyncExternalStore } from 'react';
import type { Track } from './store';
import type { CheckResult, Comparison } from './qualityFile';
import {
  findIssues,
  QUALITY_VERSION,
  verdictOf,
  type FileFormat,
  type QualityIssue,
  type QualityMetrics,
  type TrackVisuals,
  type Verdict,
} from './qualityAnalysis';

export type { Comparison } from './qualityFile';
export {
  BAND_HZ,
  compareChecks,
  HIST_BINS,
  ISSUE_LABEL,
  SPECTRUM_SIZE,
  type CompareOutcome,
  type CompareReason,
  type FileFormat,
  type IssueKind,
  type QualityIssue,
  type QualityMetrics,
  type TrackVisuals,
  type Verdict,
} from './qualityAnalysis';

const { ipcRenderer } = window.require('electron');

export type QualityReport = Track & {
  Id: string | number;
  Uri: string;
  format: FileFormat | null;
  metrics: QualityMetrics | null;
  /** Why the file couldn't be checked; set when metrics is null. */
  error: string | null;
  issues: QualityIssue[];
  verdict: Verdict;
  analysedAt: number;
  /** Made by an older QUALITY_VERSION: shown until the next scan re-checks it. */
  stale?: boolean;
};

/** What the database keeps per audio file: the report without the track. */
type Stored = Pick<
  QualityReport,
  'format' | 'metrics' | 'error' | 'issues' | 'verdict' | 'analysedAt'
> & { v: number };

/** A row of get-quality-tracks: a local track and its stored report, if any. */
type LibraryRow = Track & {
  Id: number;
  Uri: string;
  FileHash: string | null;
  Report: string | null;
};

const keyOf = (row: LibraryRow) => row.FileHash?.trim() || row.Uri;

function trackOf(row: LibraryRow): Track & { Id: number; Uri: string } {
  const { Report: _report, ...track } = row;
  return track;
}

function fromRow(row: LibraryRow): QualityReport | null {
  if (!row.Report) return null;
  try {
    const { v, ...stored } = JSON.parse(row.Report) as Stored;
    // A report from a newer build can't be read safely; an older one is shown until re-checked.
    if (!(v <= QUALITY_VERSION)) return null;
    const stale = v < QUALITY_VERSION;
    // Issues come from today's rules applied to the stored measurements, so a
    // retuned threshold needs no rescan; QUALITY_VERSION is for measurement changes.
    if (!stored.format || !stored.metrics) return { ...trackOf(row), ...stored, stale };
    const issues = findIssues(stored.format, stored.metrics);
    return { ...trackOf(row), ...stored, issues, verdict: verdictOf(issues), stale };
  } catch {
    return null;
  }
}

// Electron wraps a handler's error as "Error invoking remote method 'quality-job': Error: …".
const errorText = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(
    /^Error invoking remote method '[^']*': (Error: )?/,
    ''
  );

async function check(row: LibraryRow): Promise<QualityReport> {
  const base = { ...trackOf(row), analysedAt: Date.now() };
  try {
    const result = (await ipcRenderer.invoke('quality-job', {
      kind: 'check',
      uri: row.Uri,
      duration: (row.Duration as number) || null,
    })) as CheckResult;
    return { ...base, ...result };
  } catch (err) {
    return {
      ...base,
      format: null,
      metrics: null,
      error: errorText(err),
      issues: [],
      verdict: 'unreadable',
    };
  }
}

// ---- Store ----------------------------------------------------------------

export interface ScanState {
  /** The first library read has come back. */
  loaded: boolean;
  status: 'idle' | 'running' | 'paused';
  done: number;
  total: number;
  /** Title of the track being checked. */
  current: string | null;
  /** Local tracks in the library, and how many have no report or a stale one. */
  tracks: number;
  unchecked: number;
  /** Streamed tracks, left out: the check needs the whole file. */
  streamed: number;
  reports: QualityReport[];
}

let state: ScanState = {
  loaded: false,
  status: 'idle',
  done: 0,
  total: 0,
  current: null,
  tracks: 0,
  unchecked: 0,
  streamed: 0,
  reports: [],
};
let library: LibraryRow[] = [];
const byId = new Map<string | number, QualityReport>();
const listeners = new Set<() => void>();
let queue: LibraryRow[] = [];
let cursor = 0;
let looping = false;
let lastPublish = 0;

const needsCheck = (row: LibraryRow) => {
  const report = byId.get(row.Id);
  return !report || !!report.stale;
};
let reportsAt = 0;

/**
 * `withReports: false` keeps the same `reports` array: a new one makes the
 * Quality page recount and rebuild its whole table, about 100 ms per rebuild
 * in a dev build with 2,000 tracks.
 */
function publish(patch: Partial<ScanState>, withReports = true) {
  lastPublish = Date.now();
  if (withReports) reportsAt = lastPublish;
  state = {
    ...state,
    ...patch,
    done: cursor,
    tracks: library.length,
    unchecked: library.filter(needsCheck).length,
    reports: withReports ? [...byId.values()] : state.reports,
  };
  listeners.forEach(l => l());
}

/** Every track holding the same audio gets the report, and the database keeps one copy. */
async function keep(row: LibraryRow, report: QualityReport) {
  const { format, metrics, error, issues, verdict, analysedAt } = report;
  const stored: Stored = {
    v: QUALITY_VERSION,
    format,
    metrics,
    error,
    issues,
    verdict,
    analysedAt,
  };
  const key = keyOf(row);
  const sharing = library.filter(other => keyOf(other) === key);
  for (const other of sharing.length ? sharing : [row]) {
    byId.set(other.Id, { ...trackOf(other), ...stored });
  }
  try {
    await ipcRenderer.invoke('save-quality-report', { key, report: JSON.stringify(stored) });
  } catch (err) {
    console.error('quality: could not save the report for', row.Uri, err);
  }
}

const titleAt = (i: number) => (queue[i] ? String(queue[i].Title ?? '') : null);

async function run() {
  // A resume while the last check is still in flight must not start a second loop.
  if (looping) return;
  looping = true;
  try {
    while (state.status === 'running' && cursor < queue.length) {
      const row = queue[cursor];
      await keep(row, await check(row));
      cursor++;
      // Progress after every track; the table and tiles every 5 s.
      // ponytail: each table rebuild is still a full one; patch rows in place if
      // a 20k-track library stutters even at this rate.
      if (Date.now() - lastPublish > 250) {
        publish({ current: titleAt(cursor) }, Date.now() - reportsAt > 5000);
      }
    }
  } finally {
    looping = false;
  }
  publish(state.status === 'running' ? { status: 'idle', current: null } : {});
}

async function rowFor(trackId: string | number): Promise<LibraryRow | null> {
  const known = library.find(row => row.Id === trackId);
  if (known) return known;
  try {
    return ((await ipcRenderer.invoke('get-quality-track', { trackId: Number(trackId) })) ??
      null) as LibraryRow | null;
  } catch (err) {
    console.error('quality: could not read track', trackId, err);
    return null;
  }
}

const fetched = new Set<string | number>();

export const qualityScan = {
  /** Reads the local library and every stored report. */
  async load() {
    try {
      const { tracks, streamed } = (await ipcRenderer.invoke('get-quality-tracks')) as {
        tracks: LibraryRow[];
        streamed: number;
      };
      library = tracks;
      const present = new Set<string | number>();
      for (const row of tracks) {
        present.add(row.Id);
        const report = fromRow(row);
        if (report) byId.set(row.Id, report);
        else byId.delete(row.Id);
      }
      for (const id of byId.keys()) if (!present.has(id)) byId.delete(id);
      publish({ loaded: true, streamed });
    } catch (err) {
      console.error('quality: could not read the library', err);
      publish({ loaded: true });
    }
  },
  /** Checks the tracks without a current report, or every track with `all`. */
  start(all = false) {
    if (state.status !== 'idle') return;
    const seen = new Set<string>();
    queue = [];
    for (const row of library) {
      const key = keyOf(row);
      if ((all || needsCheck(row)) && !seen.has(key)) {
        seen.add(key);
        queue.push(row);
      }
    }
    cursor = 0;
    publish({ status: 'running', total: queue.length, current: titleAt(0) });
    void run();
  },
  pause() {
    if (state.status === 'running') publish({ status: 'paused' });
  },
  resume() {
    if (state.status !== 'paused') return;
    publish({ status: 'running', current: titleAt(cursor) });
    void run();
  },
  stop() {
    if (state.status !== 'idle') publish({ status: 'idle', current: null });
  },
  /** Checks one track now, from the report dialog. */
  async analyseOne(track: Track) {
    if (track.Id == null) return;
    const row = await rowFor(track.Id);
    if (!row) return;
    await keep(row, await check(row));
    publish({});
  },
  /** Fetches a stored report for a track opened from outside the Quality page. */
  async ensure(track: Track) {
    if (track.Id == null || byId.has(track.Id) || fetched.has(track.Id)) return;
    fetched.add(track.Id);
    const row = await rowFor(track.Id);
    const report = row && fromRow(row);
    if (report) {
      byId.set(track.Id, report);
      publish({});
    }
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useQualityScan(): ScanState {
  return useSyncExternalStore(subscribe, () => state);
}

/**
 * One field of the scan, re-rendering only when that field changes. The page's
 * table reads `reports` through this, so per-track progress doesn't rebuild it.
 */
export function useQualityScanField<K extends keyof ScanState>(key: K): ScanState[K] {
  return useSyncExternalStore(subscribe, () => state[key]);
}

export function useQualityReport(trackId: string | number | null | undefined) {
  useQualityScan();
  return trackId == null ? null : (byId.get(trackId) ?? null);
}

// The charts' data is too big to keep for every track, so a report decodes its
// file again when it opens. The last one is kept for switching back and forth.
let lastVisuals: { key: string; visuals: TrackVisuals } | null = null;

/** Null when the file can't be decoded any more. */
export async function loadVisuals(report: QualityReport): Promise<TrackVisuals | null> {
  const { format, metrics } = report;
  if (!format || !metrics) return null;
  const key = `${report.Uri}|${report.analysedAt}`;
  if (lastVisuals?.key === key) return lastVisuals.visuals;
  try {
    const visuals = (await ipcRenderer.invoke('quality-job', {
      kind: 'visuals',
      uri: report.Uri,
      format,
      metrics,
    })) as TrackVisuals | null;
    if (visuals) lastVisuals = { key, visuals };
    return visuals;
  } catch (err) {
    console.error('quality: could not decode', report.Uri, err);
    return null;
  }
}

/** Checks two files in the hidden window and lines them up; nothing is stored. */
export async function compareFiles(
  a: { uri: string; duration?: number | null },
  b: { uri: string; duration?: number | null }
): Promise<Comparison> {
  try {
    return (await ipcRenderer.invoke('quality-job', {
      kind: 'compare',
      uri: a.uri,
      duration: a.duration ?? null,
      otherUri: b.uri,
      otherDuration: b.duration ?? null,
    })) as Comparison;
  } catch (err) {
    throw new Error(errorText(err), { cause: err });
  }
}
