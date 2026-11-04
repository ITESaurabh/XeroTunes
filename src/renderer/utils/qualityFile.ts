/**
 * Quality Check's work on one file: read its header, decode it with the
 * decoders that play it, measure it. Runs in the hidden quality_worker window;
 * the app's window only sends it paths.
 */
import { parseFile } from 'music-metadata';
import {
  analyse,
  findIssues,
  loudnessEnvelope,
  matchEnvelopes,
  verdictOf,
  visualise,
  type AudioMatch,
  type FileFormat,
  type QualityIssue,
  type QualityMetrics,
  type TrackVisuals,
  type Verdict,
} from './qualityAnalysis';

const fs = window.require('fs') as typeof import('fs');

/**
 * Decoding resamples to the context's rate. Above 96 kHz the extra octave holds
 * nothing to check, and a 192 kHz decode of a long track runs to gigabytes.
 */
const MAX_DECODE_RATE = 96000;
// ponytail: decodeAudioData wants the whole file in memory; a DJ mix over this
// is reported unreadable. Decode in pieces if long files turn out to matter.
export const MAX_SECONDS = 30 * 60;

export interface CheckResult {
  format: FileFormat | null;
  metrics: QualityMetrics | null;
  /** Why the file couldn't be checked; set when metrics is null. */
  error: string | null;
  issues: QualityIssue[];
  verdict: Verdict;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function decode(
  uri: string,
  format: FileFormat
): Promise<{ channels: Float32Array[]; rate: number }> {
  const buf = await fs.promises.readFile(uri);
  // A large file gets an ArrayBuffer of its own; only a pooled small one needs copying out.
  const bytes =
    buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength
      ? buf.buffer
      : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const rate = Math.min(format.sampleRate || 44100, MAX_DECODE_RATE);
  const audio = await new OfflineAudioContext(1, 1, rate).decodeAudioData(bytes);
  return {
    channels: Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i)),
    rate: audio.sampleRate,
  };
}

/** Never throws: a file that can't be read or decoded comes back unreadable, with the reason. */
export async function checkFile(
  uri: string,
  fallbackDuration: number | null
): Promise<CheckResult> {
  return (await measure(uri, fallbackDuration, false)).result;
}

export interface Comparison {
  a: CheckResult;
  b: CheckResult;
  /** Null when either file couldn't be decoded. */
  match: AudioMatch | null;
}

/** Both files checked and lined up, one decode at a time to keep memory to one file. */
export async function compareFiles(
  a: { uri: string; duration: number | null },
  b: { uri: string; duration: number | null }
): Promise<Comparison> {
  const first = await measure(a.uri, a.duration, true);
  const second = await measure(b.uri, b.duration, true);
  return {
    a: first.result,
    b: second.result,
    match:
      first.envelope && second.envelope ? matchEnvelopes(first.envelope, second.envelope) : null,
  };
}

async function measure(
  uri: string,
  fallbackDuration: number | null,
  withEnvelope: boolean
): Promise<{ result: CheckResult; envelope: Float32Array | null }> {
  const unreadable = (error: string, format: FileFormat | null) => ({
    result: { format, metrics: null, error, issues: [], verdict: 'unreadable' as const },
    envelope: null,
  });

  let format: FileFormat;
  try {
    const { format: f } = await parseFile(uri, { duration: false, skipCovers: true });
    format = {
      lossless: !!f.lossless,
      bitRate: f.bitrate ?? null,
      sampleRate: f.sampleRate ?? null,
      bitDepth: f.bitsPerSample ?? null,
      channels: f.numberOfChannels ?? null,
      size: (await fs.promises.stat(uri)).size,
      duration: f.duration ?? fallbackDuration,
    };
  } catch (err) {
    return unreadable(`Couldn't read the file: ${errorText(err)}`, null);
  }
  if ((format.duration ?? 0) > MAX_SECONDS) {
    return unreadable('Longer than 30 minutes, too long to check in one piece.', format);
  }

  try {
    const { channels, rate } = await decode(uri, format);
    const metrics = analyse(channels, rate, format);
    const issues = findIssues(format, metrics);
    return {
      result: { format, metrics, error: null, issues, verdict: verdictOf(issues) },
      envelope: withEnvelope ? loudnessEnvelope(channels, rate) : null,
    };
  } catch (err) {
    return unreadable(`Couldn't decode the audio: ${errorText(err)}`, format);
  }
}

/** The charts' data, decoded afresh: too big to keep for every track. Null when the file won't decode. */
export async function visualiseFile(
  uri: string,
  format: FileFormat,
  metrics: QualityMetrics
): Promise<TrackVisuals | null> {
  if ((format.duration ?? 0) > MAX_SECONDS) return null;
  try {
    const { channels, rate } = await decode(uri, format);
    return visualise(channels, rate, metrics, format.duration || metrics.decodedS);
  } catch {
    return null;
  }
}
