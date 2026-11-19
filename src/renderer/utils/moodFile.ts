/** Mood analysis of one file. Runs in the hidden quality_worker window, beside Quality Check jobs. */
import type * as Ort from 'onnxruntime-web';
import {
  analyseMood,
  loadMoodModels,
  MOOD_RATE,
  type MoodFeatures,
  type MoodModels,
} from './moodFeatures';
import { lyricFeatures, type LyricFeatures } from './moodScore';
import { resolveLyrics } from './lyricsSource';
import { MAX_SECONDS } from './qualityFile';

const fs = window.require('fs') as typeof import('fs');
const path = window.require('path') as typeof import('path');

/** Marks a failure of the setup, not of the file, so the scan stops instead of failing every track. */
export const MOOD_SETUP_ERROR = 'mood-setup: ';

let loaded: Promise<{ ort: typeof Ort; models: MoodModels }> | null = null;
let loadedDir = '';

function load(modelDir: string) {
  if (loaded && loadedDir === modelDir) return loaded;
  loadedDir = modelDir;
  const loading = (async () => {
    // The runtime's Node build, required at run time: under nodeIntegration its
    // web build picks the wrong loader, and webpack would bundle the web build.
    const ort = window.require('onnxruntime-web') as typeof Ort;
    const dist = path.dirname(window.require.resolve('onnxruntime-web'));
    ort.env.wasm.numThreads = 1;
    // Handed over as bytes: the page can't fetch a file:// wasm from the dev server's origin.
    ort.env.wasm.wasmBinary = fs.readFileSync(path.join(dist, 'ort-wasm-simd-threaded.wasm'));
    const models = await loadMoodModels(ort, name =>
      fs.promises.readFile(path.join(modelDir, `${name}.onnx`))
    );
    return { ort, models };
  })();
  loaded = loading;
  loading.catch(() => {
    if (loaded === loading) loaded = null;
  });
  return loading;
}

export async function moodOfFile(
  uri: string,
  modelDir: string,
  duration: number | null
): Promise<MoodFeatures & { lyrics: LyricFeatures | null }> {
  let setup;
  try {
    setup = await load(modelDir);
  } catch (err) {
    throw new Error(MOOD_SETUP_ERROR + (err instanceof Error ? err.message : String(err)), {
      cause: err,
    });
  }
  if (duration && duration > MAX_SECONDS) throw new Error('Too long to analyse');
  const buf = await fs.promises.readFile(uri);
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  // Decoding resamples to the context's rate.
  const decoded = await new OfflineAudioContext(1, 1, MOOD_RATE).decodeAudioData(bytes);
  const mono = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const channel = decoded.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / decoded.numberOfChannels;
  }
  const features = await analyseMood(setup.ort, setup.models, mono);
  // Counted on every scan and stored beside the model outputs, so the lyrics
  // setting applies on read and flipping it needs no re-analysis.
  const lyrics = await resolveLyrics(uri, undefined);
  return { ...features, lyrics: lyrics?.content ? lyricFeatures(lyrics.content) : null };
}
