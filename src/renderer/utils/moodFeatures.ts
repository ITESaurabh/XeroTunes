/**
 * Turns decoded audio into the mel patches MusiCNN expects and runs Essentia's
 * heads on its embeddings. Pure apart from the ONNX runtime handed in, so
 * moodFeatures.check.ts and misc/lab/mood-essentia.mjs run it under Node.
 */
import type * as Ort from 'onnxruntime-web';
import { fft } from './qualityAnalysis.ts';

// In config so the main process can tell a backup's results from a newer analyser.
export { MOOD_VERSION } from '../../config/mood.ts';
/** MusiCNN was trained on 16 kHz mono. */
export const MOOD_RATE = 16000;

const FRAME = 512;
const HOP = 256;
const BANDS = 96;
/** One model input: 187 frames, three seconds. */
export const PATCH_FRAMES = 187;
const PATCH_SAMPLES = (PATCH_FRAMES - 1) * HOP + FRAME;
// ponytail: 20 evenly spaced patches (one minute) stand in for the track; raise
// it if long songs with distinct sections come out wrong.
const MAX_PATCHES = 20;
const SILENCE_RMS = 0.001;

const HEADS = [
  'mood_happy',
  'mood_sad',
  'mood_aggressive',
  'mood_relaxed',
  'mood_party',
  'deam',
  'emomusic',
] as const;
/** Files the feature needs, without the .onnx extension. */
export const MOOD_MODELS = ['musicnn', ...HEADS] as const;
// Softmax index of the named class; the heads disagree on which comes first
// (see "classes" in each model's .json on essentia.upf.edu).
const POSITIVE: Record<string, number> = {
  mood_happy: 0,
  mood_sad: 1,
  mood_aggressive: 0,
  mood_relaxed: 1,
  mood_party: 1,
};

export interface MoodFeatures {
  /** Mood probabilities, 0..1. */
  happy: number;
  sad: number;
  aggressive: number;
  relaxed: number;
  party: number;
  /** Valence and arousal regressions on a 1..9 scale, from the DEAM and emoMusic heads. */
  deamV: number;
  deamA: number;
  emoV: number;
  emoA: number;
  /** MusiCNN's 200-d embedding averaged over the track: tracks that sound alike sit close. */
  emb: number[];
}

// ---- mel front end ----------------------------------------------------------
// Matches Essentia's TensorflowInputMusiCNN to 2e-4: symmetric Hann, power
// spectrum, 96 Slaney-mel triangles of unit area, log10(1 + 10000 x).

const hzToMel = (f: number) =>
  f < 1000 ? f / (200 / 3) : 15 + Math.log(f / 1000) / (Math.log(6.4) / 27);
const melToHz = (m: number) =>
  m < 15 ? m * (200 / 3) : 1000 * Math.exp((m - 15) * (Math.log(6.4) / 27));

const hann = Float64Array.from(
  { length: FRAME },
  (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1))
);

/** Per band: first spectrum bin and the triangle's weights from there. */
const filters = (() => {
  const top = hzToMel(MOOD_RATE / 2);
  const edges = Array.from({ length: BANDS + 2 }, (_, i) => melToHz((top * i) / (BANDS + 1)));
  return Array.from({ length: BANDS }, (_, b) => {
    const [lo, mid, hi] = [edges[b], edges[b + 1], edges[b + 2]];
    const weights: number[] = [];
    let first = -1;
    for (let k = 0; k <= FRAME / 2; k++) {
      const f = (k * MOOD_RATE) / FRAME;
      const w =
        f >= lo && f < mid ? (f - lo) / (mid - lo) : f >= mid && f < hi ? (hi - f) / (hi - mid) : 0;
      if (w <= 0) continue;
      if (first < 0) first = k;
      weights[k - first] = (w * 2) / (hi - lo);
    }
    return { first: Math.max(first, 0), weights: Float64Array.from(weights, w => w || 0) };
  });
})();

function melPatch(audio: Float32Array, start: number, out: Float32Array, offset: number): void {
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const power = new Float64Array(FRAME / 2 + 1);
  for (let f = 0; f < PATCH_FRAMES; f++) {
    const at = start + f * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = audio[at + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k <= FRAME / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];
    for (let b = 0; b < BANDS; b++) {
      const { first, weights } = filters[b];
      let sum = 0;
      for (let j = 0; j < weights.length; j++) sum += weights[j] * power[first + j];
      out[offset + f * BANDS + b] = Math.log10(1 + 10000 * sum);
    }
  }
}

/** Up to 20 audible three-second patches spread over the track, as one [count, 187, 96] buffer. */
export function melPatches(audio: Float32Array): { mel: Float32Array; count: number } {
  const total = Math.floor(audio.length / PATCH_SAMPLES);
  const wanted = Math.min(total, MAX_PATCHES);
  const starts: number[] = [];
  for (let p = 0; p < wanted; p++) {
    const start = Math.floor(((total - 1) * p) / Math.max(wanted - 1, 1)) * PATCH_SAMPLES;
    let sq = 0;
    for (let i = 0; i < PATCH_SAMPLES; i++) sq += audio[start + i] * audio[start + i];
    if (Math.sqrt(sq / PATCH_SAMPLES) >= SILENCE_RMS) starts.push(start);
  }
  const mel = new Float32Array(starts.length * PATCH_FRAMES * BANDS);
  starts.forEach((start, p) => melPatch(audio, start, mel, p * PATCH_FRAMES * BANDS));
  return { mel, count: starts.length };
}

// ---- models -----------------------------------------------------------------

export type MoodModels = Record<(typeof MOOD_MODELS)[number], Ort.InferenceSession>;

/** `read` returns the bytes of `<name>.onnx`. */
export async function loadMoodModels(
  ort: typeof Ort,
  read: (name: string) => Uint8Array | Promise<Uint8Array>
): Promise<MoodModels> {
  const sessions = await Promise.all(
    MOOD_MODELS.map(async name => ort.InferenceSession.create(await read(name)))
  );
  return Object.fromEntries(MOOD_MODELS.map((name, i) => [name, sessions[i]])) as MoodModels;
}

/** `audio` is mono at MOOD_RATE. Throws when it holds no audible three seconds. */
export async function analyseMood(
  ort: typeof Ort,
  models: MoodModels,
  audio: Float32Array
): Promise<MoodFeatures> {
  const { mel, count } = melPatches(audio);
  if (!count) throw new Error('No audible three seconds to analyse');
  // One patch per run: ORT's wasm heap grows to fit the largest run and never
  // shrinks, and all 20 at once left each worker holding ~340 MB more, for no speedup.
  const size = PATCH_FRAMES * BANDS;
  const parts: Float32Array[] = [];
  for (let p = 0; p < count; p++) {
    const { embeddings } = await models.musicnn.run({
      melspectrogram: new ort.Tensor('float32', mel.slice(p * size, (p + 1) * size), [
        1,
        PATCH_FRAMES,
        BANDS,
      ]),
    });
    parts.push(embeddings.data as Float32Array);
  }
  const width = parts[0].length;
  const data = new Float32Array(count * width);
  parts.forEach((part, p) => data.set(part, p * width));
  // Mood heads take [n, 200]; the regression heads were exported with a flatten layer and take [n, 1, 200].
  const flat = new ort.Tensor('float32', data, [count, width]);
  const nested = new ort.Tensor('float32', data, [count, 1, width]);
  const out: Record<string, number> = {};
  for (const head of HEADS) {
    const isMood = head in POSITIVE;
    const { activations } = await models[head].run({ embeddings: isMood ? flat : nested });
    const act = activations.data as Float32Array;
    const cols = act.length / count;
    const mean = (col: number) => {
      let sum = 0;
      for (let p = 0; p < count; p++) sum += act[p * cols + col];
      return sum / count;
    };
    // Four decimals: the stored row stays small and nothing downstream needs more.
    const mean4 = (col: number) => Number(mean(col).toFixed(4));
    if (isMood) out[head.slice(5)] = mean4(POSITIVE[head]);
    else {
      // Both regressors answer (valence, arousal).
      const key = head === 'deam' ? 'deam' : 'emo';
      out[`${key}V`] = mean4(0);
      out[`${key}A`] = mean4(1);
    }
  }
  const emb = Array.from({ length: width }, (_, i) => {
    let sum = 0;
    for (let p = 0; p < count; p++) sum += data[p * width + i];
    return Number((sum / count).toFixed(4));
  });
  return { ...(out as Omit<MoodFeatures, 'emb'>), emb };
}
