/** Self-check: run with `node src/renderer/utils/qualityAnalysis.check.ts`. */
import assert from 'node:assert';
import {
  analyse,
  compareChecks,
  fft,
  findIssues,
  kWeighting,
  loudnessEnvelope,
  matchEnvelopes,
  SPECTRUM_SIZE,
  visualise,
  type FileFormat,
  type QualityMetrics,
} from './qualityAnalysis.ts';

const RATE = 44100;
let seed = 12345;
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** Six seconds of noise whose spectrum follows `amplitude(hz)`, made by inverse FFT. */
function shapedNoise(amplitude: (hz: number) => number): Float32Array {
  const n = 2 ** 18;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 1; k < n / 2; k++) {
    const a = amplitude((k * RATE) / n);
    const phase = 2 * Math.PI * random();
    re[k] = a * Math.cos(phase);
    im[k] = a * Math.sin(phase);
    re[n - k] = re[k];
    im[n - k] = -im[k];
  }
  fft(re, im, true);
  let peak = 0;
  for (const v of re) peak = Math.max(peak, Math.abs(v));
  return Float32Array.from(re, v => (v / peak) * 0.5);
}

const sine = (seconds: number, hz: number, amp: number) =>
  Float32Array.from(
    { length: seconds * RATE },
    (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE)
  );

const mp3: FileFormat = {
  lossless: false,
  bitRate: 320000,
  sampleRate: RATE,
  bitDepth: null,
  channels: 2,
  size: null,
  duration: null,
};
const flac: FileFormat = { ...mp3, lossless: true, bitRate: 1411000, bitDepth: 16 };

// K-weighting at 48 kHz: the coefficients printed in BS.1770.
const [shelf, highPass] = kWeighting(48000);
const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-8);
assert.ok(
  close(
    shelf,
    [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585]
  )
);
assert.ok(close(highPass, [1, -2, 1, -1.99004745483398, 0.99007225036621]));

// A brick wall at 16 kHz reads 16.0 kHz, within one band.
const walled = shapedNoise(hz => (hz < 16000 ? 1 : 0));
const wallMetrics = analyse([walled, walled.slice()], RATE, mp3);
assert.ok(
  wallMetrics.cutoffHz != null && Math.abs(wallMetrics.cutoffHz - 16000) <= 250,
  `cutoff ${wallMetrics.cutoffHz}`
);
// The same wall upsets a lossless file and a 320 kbps one; a full-band 320 is fine.
assert.ok(
  findIssues(flac, wallMetrics).some(i => i.kind === 'upscaled' && i.severity === 'problem')
);
assert.ok(findIssues(mp3, wallMetrics).some(i => i.kind === 'upscaled'));

// Full-band noise and a 6 dB/octave rolloff have no wall.
const full = shapedNoise(() => 1);
const fullMetrics = analyse([full], RATE, mp3);
assert.equal(fullMetrics.cutoffHz, null);
assert.ok(!findIssues(mp3, fullMetrics).some(i => i.kind === 'upscaled'));
const dark = analyse([shapedNoise(hz => (hz < 200 ? 1 : 200 / hz))], RATE, mp3);
assert.equal(dark.cutoffHz, null);

// Faint splatter above a real wall must not pass for a higher cutoff.
const splatter = shapedNoise(hz => (hz < 16000 ? 1 : 0.0005));
const splatterCutoff = analyse([splatter], RATE, mp3).cutoffHz;
assert.ok(
  splatterCutoff != null && Math.abs(splatterCutoff - 16000) <= 250,
  `splatter ${splatterCutoff}`
);

// EBU Tech 3341: a 1 kHz sine at -23 dBFS in both channels reads -23 LUFS.
const tone = sine(10, 1000, 10 ** (-23 / 20));
const toneMetrics = analyse([tone, tone.slice()], RATE, mp3);
assert.ok(Math.abs(toneMetrics.lufs + 23) <= 0.1, `lufs ${toneMetrics.lufs}`);
// A steady sine has no dynamics, and identical channels are mono as stereo.
assert.equal(toneMetrics.dynamicRange, 0);
assert.equal(toneMetrics.monoAsStereo, true);
assert.equal(wallMetrics.monoAsStereo, true);
assert.equal(analyse([walled, full], RATE, mp3).monoAsStereo, false);

// A sine driven into the rails has flattened tops: clipping in a lossless file,
// unmeasurable in a lossy one, and a loud master either way.
const hot = Float32Array.from(sine(4, 440, 2), v => Math.max(-1, Math.min(1, v)));
// A bare sine also trips the spectrum checks, so only these two are compared.
const kinds = (f: FileFormat, m: ReturnType<typeof analyse>) =>
  findIssues(f, m)
    .map(i => i.kind)
    .filter(k => k === 'loudMaster' || k === 'clipping');
const hotFlac = analyse([hot], RATE, flac);
assert.ok(hotFlac.hotPpm > 100000, `hot ${hotFlac.hotPpm}`);
assert.ok(hotFlac.clipPpm != null && hotFlac.clipPpm > 100000, `clip ${hotFlac.clipPpm}`);
assert.ok(findIssues(flac, hotFlac).some(i => i.kind === 'clipping' && i.severity === 'problem'));
const hotMp3 = analyse([hot], RATE, mp3);
assert.equal(hotMp3.clipPpm, null);
assert.deepEqual(kinds(mp3, hotMp3), ['loudMaster']);
// A limiter pushes peaks to the ceiling without flattening them: loud, not clipped.
const limited = Float32Array.from(sine(4, 440, 3), v => Math.tanh(v) / Math.tanh(3));
const limitedMetrics = analyse([limited], RATE, flac);
assert.ok(limitedMetrics.hotPpm > 10000, `limited hot ${limitedMetrics.hotPpm}`);
assert.equal(limitedMetrics.clipPpm, 0);
assert.deepEqual(kinds(flac, limitedMetrics), ['loudMaster']);
const clean = analyse([sine(4, 440, 0.5)], RATE, flac);
assert.equal(clean.hotPpm, 0);
assert.equal(clean.clipPpm, 0);
assert.ok(Math.abs(clean.peakDb + 6.02) < 0.05, `peak ${clean.peakDb}`);
// Resampled lossless audio can't show its flat tops either.
assert.equal(analyse([hot], RATE, { ...flac, sampleRate: 96000 }).clipPpm, null);
const severity = (kind: string, m: Partial<ReturnType<typeof analyse>>) =>
  findIssues(flac, { ...clean, ...m }).find(i => i.kind === kind)?.severity ?? null;
assert.equal(severity('loudMaster', { hotPpm: 6000 }), null);
assert.equal(severity('loudMaster', { hotPpm: 12000 }), 'warning');
assert.equal(severity('clipping', { clipPpm: 50 }), null);
assert.equal(severity('clipping', { clipPpm: 200 }), 'warning');
assert.equal(severity('clipping', { clipPpm: 2000 }), 'problem');
// Reports from before clipping was measured don't flag it.
assert.equal(severity('clipping', { clipPpm: undefined }), null);

// Silence at both ends, measured to the 10 ms unit.
const music = shapedNoise(() => 1).subarray(0, 3 * RATE);
const gapped = new Float32Array(9 * RATE);
gapped.set(music, 2 * RATE);
const gapMetrics = analyse([gapped], RATE, mp3);
assert.ok(Math.abs(gapMetrics.silenceStartS - 2) <= 0.02, `start ${gapMetrics.silenceStartS}`);
assert.ok(Math.abs(gapMetrics.silenceEndS - 4) <= 0.02, `end ${gapMetrics.silenceEndS}`);

// DC offset in percent of full scale.
const offset = Float32Array.from(full, v => v * 0.5 + 0.02);
assert.ok(Math.abs(analyse([offset], RATE, mp3).dcOffsetPct - 2) < 0.05);

// 16-bit audio in a 24-bit file leaves the bottom eight bits empty.
const quantise = (bits: number) =>
  Float32Array.from(full, v => Math.round(v * 2 ** (bits - 1)) / 2 ** (bits - 1));
const hiRes: FileFormat = { ...flac, bitDepth: 24 };
const padded = analyse([quantise(16)], RATE, hiRes);
assert.deepEqual(
  padded.bitsUsed?.slice(16).map(v => v > 0),
  new Array(8).fill(false)
);
assert.ok(findIssues(hiRes, padded).some(i => i.kind === 'paddedBits'));
assert.ok(
  !findIssues(hiRes, analyse([quantise(24)], RATE, hiRes)).some(i => i.kind === 'paddedBits')
);
// Resampled audio can't show its bits, so they aren't measured.
assert.equal(analyse([quantise(16)], RATE, { ...hiRes, sampleRate: 96000 }).bitsUsed, null);

// A file whose header claims more than it holds is cut short.
assert.ok(findIssues({ ...mp3, duration: 12 }, fullMetrics).some(i => i.kind === 'truncated'));
assert.ok(!findIssues({ ...mp3, duration: 6 }, fullMetrics).some(i => i.kind === 'truncated'));

// The charts: columns past the decoded end are empty, identical channels correlate.
const v = visualise([tone, tone.slice()], RATE, toneMetrics, 20);
assert.equal(v.peakMax.length, 600);
assert.ok(Number.isNaN(v.peakMax[599]) && !Number.isNaN(v.peakMax[0]));
assert.ok(v.correlation && Math.abs(v.correlation[0] - 1) < 1e-3);
assert.ok(Number.isNaN(v.spectrogram[v.spectrogram.length - 1]));
assert.ok(Math.abs(v.histogram.reduce((a, b) => a + b, 0) - 1) < 1e-9);
// The spectrum reads like Audacity's: the -23 dBFS tone in both channels adds
// up to 6 dB more, at the bin nearest 1 kHz.
const toneBin = Math.round(1000 / (RATE / SPECTRUM_SIZE));
assert.equal(v.spectrum.indexOf(Math.max(...v.spectrum)), toneBin);
assert.ok(Math.abs(v.spectrum[toneBin] - (-23 + 6.02)) < 0.5, `${v.spectrum[toneBin]}`);

// Lining up two files: about 24 s of noise with song-like loud and quiet stretches.
const song = (section: number) => {
  const parts = [0, 1, 2, 3].map(() => shapedNoise(() => 1));
  const out = new Float32Array(parts.length * parts[0].length);
  parts.forEach((p, k) => out.set(p, k * p.length));
  return out.map(
    (s, i) => s * (0.25 + 0.75 * Math.abs(Math.sin((Math.PI * i) / (RATE * section))))
  );
};
const original = song(3);
// The same audio 1.5 s later at -6 dB still lines up; other audio doesn't.
const delayed = new Float32Array(original.length + 1.5 * RATE);
delayed.set(
  original.map(s => s * 0.5),
  1.5 * RATE
);
const lined = matchEnvelopes(loudnessEnvelope([original], RATE), loudnessEnvelope([delayed], RATE));
assert.ok(lined.similarity > 0.95, `same audio ${lined.similarity}`);
assert.ok(Math.abs(lined.offsetS - 1.5) <= 0.05, `offset ${lined.offsetS}`);
const unrelated = matchEnvelopes(
  loudnessEnvelope([original], RATE),
  loudnessEnvelope([song(5)], RATE)
);
assert.ok(unrelated.similarity < 0.85, `other audio ${unrelated.similarity}`);

// The verdict, on made-up checks.
const checked = (format: FileFormat, m: Partial<QualityMetrics>) => {
  const metrics = { ...clean, ...m };
  return { format, metrics, error: null, issues: findIssues(format, metrics) };
};
const names: [string, string] = ['current file', 'new file'];
const sameAudio = { similarity: 0.99, offsetS: 0 };
const mp3At16 = checked(mp3, { cutoffHz: 16000 });
// A real full-range file beats a 16 kHz one.
assert.equal(
  compareChecks(mp3At16, checked(flac, { cutoffHz: null }), sameAudio, names).outcome,
  'better'
);
// A FLAC made from the same 16 kHz source is no better, however big.
assert.equal(
  compareChecks(mp3At16, checked(flac, { cutoffHz: 16000 }), sameAudio, names).outcome,
  'same'
);
// Cut short loses, ahead of everything else.
const cut = checked({ ...flac, duration: 10 }, { cutoffHz: null });
assert.equal(compareChecks(mp3At16, cut, sameAudio, names).outcome, 'worse');
// Clipping and a squashed master count against a file.
assert.equal(
  compareChecks(checked(flac, { clipPpm: 0 }), checked(flac, { clipPpm: 2000 }), sameAudio, names)
    .outcome,
  'worse'
);
assert.equal(
  compareChecks(
    checked(flac, { dynamicRange: 6 }),
    checked(flac, { dynamicRange: 11 }),
    sameAudio,
    names
  ).outcome,
  'better'
);
// Another recording, another edit, or an unreadable file is never a replacement.
const flacFull = checked(flac, { cutoffHz: null });
assert.equal(
  compareChecks(mp3At16, flacFull, { similarity: 0.4, offsetS: 0 }, names).outcome,
  'different'
);
assert.equal(
  compareChecks(mp3At16, checked(flac, { decodedS: 30 }), sameAudio, names).outcome,
  'different'
);
assert.equal(
  compareChecks(mp3At16, { format: null, metrics: null, error: 'bad', issues: [] }, null, names)
    .outcome,
  'unreadable'
);
