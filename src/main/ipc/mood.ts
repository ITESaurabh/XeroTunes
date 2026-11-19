import path from 'path';
import fs from 'fs';
import { ipcMain, type BrowserWindow } from 'electron';
import db from '../db';
import { APP_CONF_FOLDER } from '../../config/core_config';

/**
 * MTG's pretrained models (essentia.upf.edu/models). They are CC BY-NC-SA 4.0,
 * so the app fetches them when the user turns mood analysis on and never ships
 * them. Names match MOOD_MODELS in moodFeatures.ts.
 */
const MODEL_DIR = path.join(APP_CONF_FOLDER, 'mood_models');
const BASE = 'https://essentia.upf.edu/models';
const head = (name: string) => `${BASE}/classification-heads/${name}/${name}-msd-musicnn-1.onnx`;
const MODEL_URLS: Record<string, string> = {
  musicnn: `${BASE}/feature-extractors/musicnn/msd-musicnn-1.onnx`,
  mood_happy: head('mood_happy'),
  mood_sad: head('mood_sad'),
  mood_aggressive: head('mood_aggressive'),
  mood_relaxed: head('mood_relaxed'),
  mood_party: head('mood_party'),
  deam: head('deam'),
  emomusic: head('emomusic'),
};

const modelPath = (name: string) => path.join(MODEL_DIR, `${name}.onnx`);
const missingModels = () => Object.keys(MODEL_URLS).filter(name => !fs.existsSync(modelPath(name)));

async function downloadModels(): Promise<void> {
  await fs.promises.mkdir(MODEL_DIR, { recursive: true });
  for (const name of missingModels()) {
    // Shown in Settings after "Stopped:", so no raw fetch errors or model ids.
    const res = await fetch(MODEL_URLS[name]).catch(() => null);
    if (res && !res.ok) {
      throw new Error(`Could not download the models from essentia.upf.edu (HTTP ${res.status}).`);
    }
    const data = await res?.arrayBuffer().catch(() => null);
    if (!data) {
      throw new Error(
        'Could not reach essentia.upf.edu to download the models. Check your internet connection.'
      );
    }
    // Written beside the target and renamed, so a cut-off download never looks complete.
    const part = `${modelPath(name)}.part`;
    await fs.promises.writeFile(part, Buffer.from(data));
    await fs.promises.rename(part, modelPath(name));
  }
}

// Keyed like QualityReport: the audio hash, or the path for a track not hashed yet.
const TRACK_KEY = `COALESCE(NULLIF(TRIM(Track.FileHash), ''), Track.Uri)`;

export function resetRecommendationData(): void {
  for (const table of ['TrackMood', 'TrackSignal']) {
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    if (exists) db.prepare(`DELETE FROM ${table}`).run();
  }
  fs.rmSync(MODEL_DIR, { recursive: true, force: true });
}

export function registerMoodIpc(mainWin: BrowserWindow): void {
  ipcMain.on('mood-progress', (_e, fraction: unknown) => {
    if (mainWin.isDestroyed()) return;
    mainWin.setProgressBar(
      typeof fraction === 'number' && fraction >= 0 && fraction <= 1 ? fraction : -1
    );
  });

  // One row per audio file: the models' raw outputs as JSON (or { error }).
  // Arousal and valence are derived on read, so retuning them needs no re-analysis.
  db.prepare(
    `CREATE TABLE IF NOT EXISTS TrackMood (
       Key TEXT PRIMARY KEY,
       Features TEXT NOT NULL,
       Version INTEGER NOT NULL,
       AnalysedAt BIGINT
     )`
  ).run();

  let downloading: Promise<void> | null = null;
  ipcMain.handle('mood-models', async (_e, { download }: { download?: boolean } = {}) => {
    if (download && missingModels().length) {
      downloading ??= downloadModels().finally(() => {
        downloading = null;
      });
      await downloading;
    }
    return { ready: missingModels().length === 0, dir: MODEL_DIR };
  });

  // Local files only: the analysis decodes the whole file.
  ipcMain.handle('get-mood-pending', (_e, { version }: { version?: number } = {}) => {
    if (!Number.isInteger(version)) return { tracks: [], total: 0, errored: 0 };
    return {
      tracks: db
        .prepare(
          `SELECT Track.Id, Track.Uri, Track.Title, Track.Duration, Track.FileHash
           FROM Track LEFT JOIN TrackMood ON TrackMood.Key = ${TRACK_KEY}
           WHERE Track.SourceId IS NULL AND (TrackMood.Key IS NULL OR TrackMood.Version < ?)`
        )
        .all(version),
      total: (
        db.prepare('SELECT COUNT(*) AS n FROM Track WHERE SourceId IS NULL').get() as { n: number }
      ).n,
      errored: (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM Track JOIN TrackMood ON TrackMood.Key = ${TRACK_KEY}
             WHERE Track.SourceId IS NULL AND TrackMood.Version >= ?
               AND json_extract(TrackMood.Features, '$.error') IS NOT NULL`
          )
          .get(version) as { n: number }
      ).n,
    };
  });

  ipcMain.handle(
    'save-track-mood',
    (_e, { key, features, version }: { key?: unknown; features?: unknown; version?: unknown }) => {
      if (typeof key !== 'string' || !key || key.length > 4096) return { success: false };
      if (typeof features !== 'string' || features.length > 64 * 1024) return { success: false };
      if (!Number.isInteger(version)) return { success: false };
      db.prepare(
        'INSERT OR REPLACE INTO TrackMood (Key, Features, Version, AnalysedAt) VALUES (?, ?, ?, ?)'
      ).run(key, features, version, Date.now());
      return { success: true };
    }
  );

  // Weight > 0 is a stay, < 0 an early skip, logged only while Smart Recommendations
  // is on. Rows outlive a deleted track; Track ids are never reused, so they match nothing.
  db.prepare(
    `CREATE TABLE IF NOT EXISTS TrackSignal (
       Id INTEGER PRIMARY KEY,
       TrackId INTEGER NOT NULL,
       Weight REAL NOT NULL,
       At BIGINT NOT NULL
     )`
  ).run();
  const DAY = 24 * 60 * 60 * 1000;
  // A year is more taste than a recommender should carry.
  db.prepare('DELETE FROM TrackSignal WHERE At < ?').run(Date.now() - 365 * DAY);

  ipcMain.on(
    'log-track-signal',
    (_e, { trackId, weight }: { trackId?: unknown; weight?: unknown } = {}) => {
      if (!Number.isInteger(trackId) || typeof weight !== 'number' || !Number.isFinite(weight))
        return;
      db.prepare('INSERT INTO TrackSignal (TrackId, Weight, At) VALUES (?, ?, ?)').run(
        trackId,
        Math.max(-1, Math.min(1, weight)),
        Date.now()
      );
    }
  );

  ipcMain.handle('get-listening-history', () => {
    const now = Date.now();
    const stats = db
      .prepare(
        `SELECT TrackId, SUM(Weight > 0) AS Stays, SUM(Weight < 0) AS Skips
         FROM TrackSignal WHERE At >= ? GROUP BY TrackId`
      )
      .all(now - 180 * DAY);
    // What the listener stayed on in the last three hours, or within two hours
    // of this time of day in the last month: the best guess at their mood now.
    const hourNow = new Date(now).getHours();
    const stays = db
      .prepare('SELECT TrackId, At FROM TrackSignal WHERE Weight > 0 AND At >= ? ORDER BY At DESC')
      .all(now - 30 * DAY) as { TrackId: number; At: number }[];
    const seeds: number[] = [];
    for (const { TrackId, At } of stays) {
      const gap = Math.abs(new Date(At).getHours() - hourNow);
      const near = now - At <= 3 * 60 * 60 * 1000 || Math.min(gap, 24 - gap) <= 2;
      if (near && !seeds.includes(TrackId)) seeds.push(TrackId);
      if (seeds.length === 6) break;
    }
    return { stats, seeds };
  });

  ipcMain.handle(
    'listening-history-count',
    () => (db.prepare('SELECT COUNT(*) AS n FROM TrackSignal').get() as { n: number }).n
  );
  ipcMain.handle('clear-listening-history', () => {
    db.prepare('DELETE FROM TrackSignal').run();
  });

  // json_extract returns the embedding as JSON text; smartShuffle.ts parses it.
  ipcMain.handle('get-mood-embeddings', () =>
    db
      .prepare(
        `SELECT Track.Id, json_extract(TrackMood.Features, '$.emb') AS Emb
         FROM Track JOIN TrackMood ON TrackMood.Key = ${TRACK_KEY}
         WHERE json_extract(TrackMood.Features, '$.emb') IS NOT NULL`
      )
      .all()
  );

  ipcMain.handle('get-track-mood', (_e, { trackId }: { trackId?: number } = {}) => {
    if (!Number.isInteger(trackId)) return null;
    const row = db
      .prepare(
        `SELECT TrackMood.Features FROM Track JOIN TrackMood ON TrackMood.Key = ${TRACK_KEY}
         WHERE Track.Id = ?`
      )
      .get(trackId) as { Features: string } | undefined;
    return row?.Features ?? null;
  });
}
