/**
 * Measures what a decoded track actually contains. Pure: channel data in,
 * numbers out, no DOM, so qualityAnalysis.check.ts runs it on synthetic signals.
 */

/** Bump when a measurement changes; stored reports from older versions are re-checked. */
export const QUALITY_VERSION = 2;
export const BAND_HZ = 250;
export const HIST_BINS = 101;

export type Verdict = 'good' | 'warning' | 'problem' | 'unreadable';

export type IssueKind =
  | 'upscaled'
  | 'clipping'
  | 'loudMaster'
  | 'lowBitrate'
  | 'truncated'
  | 'silence'
  | 'monoAsStereo'
  | 'dcOffset'
  | 'paddedBits';

export const ISSUE_LABEL: Record<IssueKind, string> = {
  upscaled: 'Upscaled',
  clipping: 'Clipping',
  loudMaster: 'Loud master',
  lowBitrate: 'Low bitrate',
  truncated: 'Cut short',
  silence: 'Long silence',
  monoAsStereo: 'Mono as stereo',
  dcOffset: 'DC offset',
  paddedBits: 'Padded bit depth',
};

export interface QualityIssue {
  kind: IssueKind;
  severity: 'warning' | 'problem';
  detail: string;
}

/** What the file's header says. */
export interface FileFormat {
  lossless: boolean;
  bitRate: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  size: number | null;
  duration: number | null;
}

export interface QualityMetrics {
  /** Frequency cutoff, where the spectrum hits a lowpass wall; null when there is none. */
  cutoffHz: number | null;
  peakDb: number;
  /** Samples at or above -0.1 dBFS, per million: how hard the master was limited, not clipping. */
  hotPpm: number;
  /**
   * Samples in flattened runs at the peak, per million: real clipping. Null where
   * it can't be measured (lossy audio, or lossless resampled to decode); missing on
   * reports from before it was measured.
   */
  clipPpm?: number | null;
  /** Integrated loudness, ITU-R BS.1770 with gating. */
  lufs: number;
  /** DR value, as the TT Dynamic Range meter computes it. */
  dynamicRange: number;
  dcOffsetPct: number;
  silenceStartS: number;
  silenceEndS: number;
  /** Audio actually decoded, against the header's duration. */
  decodedS: number;
  monoAsStereo: boolean;
  decodeRate: number;
  /** dB per BAND_HZ band relative to 1-2 kHz, from 0 Hz to the decode's Nyquist. */
  spectrum: number[];
  /** Per bit, most significant first: share of samples with it set. Null unless lossless and decoded at its own rate. */
  bitsUsed: number[] | null;
}

/** The moment-by-moment data behind the report's charts, computed when a report opens. */
export interface TrackVisuals {
  /** Waveform columns spread over the header's duration; NaN past the decoded end. */
  peakMax: number[];
  peakMin: number[];
  rms: number[];
  /** Columns holding a flattened run at the peak; all false where clipping can't be measured. */
  clipped: boolean[];
  /** dB per spectrum band, slice-major; NaN past the decoded end. */
  spectrogram: Float32Array;
  slices: number;
  /** L/R correlation per slice, -1 to 1; NaN where silent. Null for a mono file. */
  correlation: number[] | null;
  /** Side/mid sample pairs for the goniometer, interleaved. Null for a mono file. */
  goniometer: number[] | null;
  /** Share of samples in each of HIST_BINS bins spanning -1 to 1. */
  histogram: number[];
  bitsUsed: number[] | null;
  /** dB per bin of decodeRate / SPECTRUM_SIZE from 0 Hz, as Audacity's Plot Spectrum reads it. */
  spectrum: number[];
}

const HOT = 10 ** (-0.1 / 20);
/**
 * Samples at HOT or above, per million, past which a master counts as very loud.
 * Limiting alone puts thousands there: in a 2,040-track test library the median
 * was 382 and the 90th percentile 6,197.
 */
const LOUD_MASTER_PPM = 10000;
/**
 * Flattened samples per million. A clipped kick flattens a few dozen samples
 * about twice a second, near 1,000 per million; the odd clipped peak stays far
 * under 100.
 */
// ponytail: first guesses; tune against the test library once it is rescanned.
const CLIP_WARNING_PPM = 100;
const CLIP_PROBLEM_PPM = 1000;
const SILENT = 10 ** (-60 / 20);
const FFT_N = 4096;
/** Audacity's default Plot Spectrum size, so the report's spectrum reads like it. */
export const SPECTRUM_SIZE = 1024;
const SPECTRUM_FRAMES = 200;
const SPECTRUM_GATE_DB = -50;
const WAVE_COLUMNS = 600;
const SLICES = 300;
const GONIO_POINTS = 1500;
const FLOOR_DB = -120;
/** Ten milliseconds: silence is measured in these, loudness and DR blocks are built from them. */
const UNITS_PER_S = 100;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const toDb = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

const times = (count: number, step: (i: number) => void) => {
  for (let i = 0; i < count; i++) step(i);
};

// ---- FFT -----------------------------------------------------------------

const fftTables = new Map<number, { rev: Uint32Array; cos: Float64Array; sin: Float64Array }>();

/** In-place radix-2 FFT. `re` and `im` share a power-of-two length. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  let t = fftTables.get(n);
  if (!t) {
    const bits = Math.log2(n);
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    t = { rev, cos, sin };
    fftTables.set(n, t);
  }
  for (let i = 0; i < n; i++) {
    const j = t.rev[i];
    if (j > i) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const stride = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = t.cos[k * stride];
        const wi = sign * t.sin[k * stride];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

const hann = Float64Array.from(
  { length: FFT_N },
  (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_N - 1))
);

/** Turns windowed frames of the mono mix into band powers. */
function bandAnalyser(channels: Float32Array[], rate: number) {
  const bands = Math.floor(rate / 2 / BAND_HZ);
  const binBand = Int32Array.from({ length: FFT_N / 2 }, (_, k) => {
    const b = Math.floor((k * rate) / FFT_N / BAND_HZ);
    return k > 0 && b < bands ? b : -1;
  });
  const binsPerBand = new Float64Array(bands);
  for (const b of binBand) if (b >= 0) binsPerBand[b]++;
  const re = new Float64Array(FFT_N);
  const im = new Float64Array(FFT_N);
  const n = channels[0].length;
  return {
    bands,
    /** Adds the frame's mean power per band to `out`; returns the frame's mean square. */
    frame(start: number, out: Float64Array): number {
      let ms = 0;
      for (let i = 0; i < FFT_N; i++) {
        let v = 0;
        if (start + i < n) for (const ch of channels) v += ch[start + i];
        v /= channels.length;
        ms += v * v;
        re[i] = v * hann[i];
        im[i] = 0;
      }
      fft(re, im);
      for (let k = 1; k < FFT_N / 2; k++) {
        const b = binBand[k];
        if (b >= 0) out[b] += (re[k] * re[k] + im[k] * im[k]) / binsPerBand[b];
      }
      return ms / FFT_N;
    },
  };
}

/** Band powers relative to the 1-2 kHz bands, in dB. */
function relativeDb(power: Float64Array, ref: number): number[] {
  return Array.from(power, p =>
    p > 0 && ref > 0 ? Math.max(FLOOR_DB, Math.round(100 * Math.log10(p / ref)) / 10) : FLOOR_DB
  );
}

function refPower(power: Float64Array): number {
  const from = Math.round(1000 / BAND_HZ);
  const to = Math.round(2000 / BAND_HZ);
  let sum = 0;
  for (let b = from; b < to && b < power.length; b++) sum += power[b];
  return sum > 0 ? sum / (to - from) : Math.max(0, ...power);
}

/**
 * The highest band edge where the level falls 25 dB or more within 1 kHz: the
 * lowpass wall a lossy encoder leaves, which survives every later conversion.
 * Old recordings and dark mixes roll off over several kHz and don't trip it.
 * The level just under the edge has to be within 50 dB of the 1-2 kHz bands,
 * so the faint floor of clipping splatter above a real wall can't pass for one.
 * The 1 kHz window has to end 1.5 kHz below Nyquist, clear of the anti-alias
 * and resampling filters.
 */
export function findCutoff(spectrum: number[], nyquist: number): number | null {
  const drop = (k: number) => spectrum[k - 1] - spectrum[k + 3];
  const wall = (k: number) => spectrum[k - 1] >= -50 && drop(k) >= 25;
  const lowest = Math.round(2000 / BAND_HZ);
  const highest = Math.min(Math.floor((nyquist - 1500) / BAND_HZ) - 4, spectrum.length - 4);
  let top = -1;
  for (let k = highest; k >= lowest; k--) {
    if (wall(k)) {
      top = k;
      break;
    }
  }
  if (top < 0) return null;
  // The edges a few bands either side of a wall pass too. The wall stands at the
  // first of them where the level falls 10 dB in one band; a gentler filter
  // without such a step falls back to the steepest kilohertz.
  let low = top;
  while (low - 1 >= lowest && wall(low - 1)) low--;
  for (let k = low; k <= top; k++) if (spectrum[k - 1] - spectrum[k] >= 10) return k * BAND_HZ;
  let best = top;
  for (let k = low; k < top; k++) if (drop(k) > drop(best)) best = k;
  return best * BAND_HZ;
}

// ---- Loudness ------------------------------------------------------------

/**
 * The two K-weighting biquads of BS.1770 for any sample rate, as [b0, b1, b2,
 * a1, a2]: a high shelf and a high pass, built the way libebur128 builds them.
 * At 48 kHz they reproduce the coefficients the standard lists.
 */
export function kWeighting(rate: number): number[][] {
  const shelf = (() => {
    const k = Math.tan((Math.PI * 1681.974450955533) / rate);
    const q = 0.7071752369554196;
    const vh = 10 ** (3.999843853973347 / 20);
    const vb = vh ** 0.4996667741545416;
    const a0 = 1 + k / q + k * k;
    return [
      (vh + (vb * k) / q + k * k) / a0,
      (2 * (k * k - vh)) / a0,
      (vh - (vb * k) / q + k * k) / a0,
      (2 * (k * k - 1)) / a0,
      (1 - k / q + k * k) / a0,
    ];
  })();
  const highPass = (() => {
    const k = Math.tan((Math.PI * 38.13547087602444) / rate);
    const q = 0.5003270373238773;
    const a0 = 1 + k / q + k * k;
    return [1, -2, 1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0];
  })();
  return [shelf, highPass];
}

/** Gated integrated loudness from per-unit sums of K-weighted squares, all channels added. */
function integratedLoudness(kSum: Float64Array, unitLen: number): number {
  // 400 ms blocks overlapping by 75%: 40 units, stepping 10.
  const blocks: number[] = [];
  for (let j = 0; j * 10 + 40 <= kSum.length; j++) {
    let sum = 0;
    for (let u = j * 10; u < j * 10 + 40; u++) sum += kSum[u];
    blocks.push(sum / (40 * unitLen));
  }
  const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
  const mean = (zs: number[]) => zs.reduce((a, b) => a + b, 0) / zs.length;
  const loud = blocks.filter(z => z > 0 && lufs(z) > -70);
  if (!loud.length) return -70;
  const relative = lufs(mean(loud)) - 10;
  const gated = loud.filter(z => lufs(z) > relative);
  return Math.round(lufs(mean(gated)) * 10) / 10;
}

/** The TT DR meter: second-highest 3 s peak over the RMS of the loudest 20% of 3 s blocks. */
function dynamicRangeOf(sumSq: Float64Array[], peaks: Float64Array[], blockLen: number[]): number {
  const perChannel = sumSq.map((sums, ch) => {
    const rms = Array.from(sums, (s, b) => Math.sqrt((2 * s) / blockLen[b])).sort((a, b) => b - a);
    const top = rms.slice(0, Math.max(1, Math.round(rms.length * 0.2)));
    const loudRms = Math.sqrt(top.reduce((a, r) => a + r * r, 0) / top.length);
    const sorted = Array.from(peaks[ch]).sort((a, b) => b - a);
    const peak = sorted[1] ?? sorted[0];
    return loudRms > 0 && peak > 0 ? 20 * Math.log10(peak / loudRms) : 0;
  });
  return Math.max(0, Math.round(perChannel.reduce((a, b) => a + b, 0) / perChannel.length));
}

// ---- Bits ----------------------------------------------------------------

/** Share of samples with each bit set, sampled sparsely: a bit in real use shows up fast. */
function bitUsage(channels: Float32Array[], bitDepth: number): number[] {
  const scale = 2 ** (bitDepth - 1);
  const mask = 2 ** bitDepth - 1;
  const counts = new Float64Array(bitDepth);
  let seen = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i += 17) {
      let u = Math.round(ch[i] * scale) & mask;
      seen++;
      while (u) {
        const low = u & -u;
        counts[31 - Math.clz32(low)]++;
        u ^= low;
      }
    }
  }
  return Array.from({ length: bitDepth }, (_, i) => (seen ? counts[bitDepth - 1 - i] / seen : 0));
}

// ---- Clipping ------------------------------------------------------------

/**
 * Calls visit(i) for every sample in a run of three or more identical values
 * within 0.01 dB of its channel's peak: the flattened tops clipping leaves. A
 * limiter holds peaks near the ceiling without repeating a value, so a loud but
 * clean master gives almost none. Only meaningful for lossless audio decoded at
 * its own rate: lossy decoding and resampling turn flat tops back into ripples.
 */
function eachFlatTop(channels: Float32Array[], visit: (i: number) => void): void {
  for (const x of channels) {
    let peak = 0;
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]);
      if (a > peak) peak = a;
    }
    if (!peak) continue;
    const floor = peak * 10 ** (-0.01 / 20);
    let run = 1;
    for (let i = 1; i < x.length; i++) {
      if (x[i] !== x[i - 1] || Math.abs(x[i]) < floor) {
        run = 1;
        continue;
      }
      run++;
      if (run === 3) {
        visit(i - 2);
        visit(i - 1);
      }
      if (run >= 3) visit(i);
    }
  }
}

// ---- The scan's measurements ---------------------------------------------

export function analyse(
  channels: Float32Array[],
  rate: number,
  format: FileFormat
): QualityMetrics {
  const n = channels[0]?.length ?? 0;
  const unitLen = Math.max(1, Math.round(rate / UNITS_PER_S));
  const units = Math.ceil(n / unitLen);
  const drUnits = 3 * UNITS_PER_S;
  const drBlocks = Math.max(1, Math.floor(units / drUnits));
  const [shelf, highPass] = kWeighting(rate);

  let peak = 0;
  let hot = 0;
  let sideSq = 0;
  let midSq = 0;
  const dcSum = channels.map(() => 0);
  const unitMax = new Float32Array(units);
  const kSum = new Float64Array(units);
  const drSumSq = channels.map(() => new Float64Array(drBlocks));
  const drPeak = channels.map(() => new Float64Array(drBlocks));
  const drLen = new Array<number>(drBlocks).fill(0);
  // x1, x2, y1, y2 for each of the two biquads, per channel.
  const filterState = channels.map(() => new Float64Array(8));

  times(units, u => {
    const from = u * unitLen;
    const to = Math.min(n, from + unitLen);
    const block = Math.min(drBlocks - 1, Math.floor(u / drUnits));
    drLen[block] += to - from;
    let loudest = 0;
    channels.forEach((x, ch) => {
      const st = filterState[ch];
      let sum = 0;
      let sq = 0;
      let kSq = 0;
      let max = 0;
      for (let i = from; i < to; i++) {
        const v = x[i];
        const a = Math.abs(v);
        if (a > max) max = a;
        if (a >= HOT) hot++;
        sum += v;
        sq += v * v;
        const s =
          shelf[0] * v + shelf[1] * st[0] + shelf[2] * st[1] - shelf[3] * st[2] - shelf[4] * st[3];
        st[1] = st[0];
        st[0] = v;
        st[3] = st[2];
        st[2] = s;
        const k =
          highPass[0] * s +
          highPass[1] * st[4] +
          highPass[2] * st[5] -
          highPass[3] * st[6] -
          highPass[4] * st[7];
        st[5] = st[4];
        st[4] = s;
        st[7] = st[6];
        st[6] = k;
        kSq += k * k;
      }
      dcSum[ch] += sum;
      kSum[u] += kSq;
      drSumSq[ch][block] += sq;
      if (max > drPeak[ch][block]) drPeak[ch][block] = max;
      if (max > loudest) loudest = max;
    });
    unitMax[u] = loudest;
    if (loudest > peak) peak = loudest;
    if (channels.length === 2) {
      const [l, r] = channels;
      for (let i = from; i < to; i++) {
        const side = l[i] - r[i];
        const mid = l[i] + r[i];
        sideSq += side * side;
        midSq += mid * mid;
      }
    }
  });

  const unitS = unitLen / rate;
  let lead = 0;
  while (lead < units && unitMax[lead] < SILENT) lead++;
  let trail = 0;
  while (trail < units - lead && unitMax[units - 1 - trail] < SILENT) trail++;

  // Spectrum: the power average of frames spread across the track, leaving out
  // near-silent ones so a fade or a gap doesn't drag the top end down.
  const analyser = bandAnalyser(channels, rate);
  const gated = new Float64Array(analyser.bands);
  const all = new Float64Array(analyser.bands);
  const frame = new Float64Array(analyser.bands);
  const frames = n > FFT_N ? Math.min(SPECTRUM_FRAMES, Math.floor(n / FFT_N)) : 0;
  let gatedFrames = 0;
  times(frames, f => {
    frame.fill(0);
    const ms = analyser.frame(Math.floor(((f + 0.5) / frames) * (n - FFT_N)), frame);
    if (ms <= 0) return;
    for (let b = 0; b < frame.length; b++) all[b] += frame[b];
    if (10 * Math.log10(ms) >= SPECTRUM_GATE_DB) {
      gatedFrames++;
      for (let b = 0; b < frame.length; b++) gated[b] += frame[b];
    }
  });
  const power = gatedFrames >= 20 ? gated : all;
  const spectrum = relativeDb(power, refPower(power));

  // Lossless audio at its own rate still holds the file's exact samples.
  const exact = format.lossless && format.sampleRate === rate;
  const bitDepth = exact && format.bitDepth && format.bitDepth <= 24 ? format.bitDepth : null;
  let flat = 0;
  if (exact) eachFlatTop(channels, () => flat++);

  return {
    cutoffHz: findCutoff(spectrum, rate / 2),
    peakDb: Math.round(Math.max(-120, toDb(peak)) * 10) / 10,
    hotPpm: n ? Math.round((hot / (n * channels.length)) * 1e6) : 0,
    clipPpm: exact ? (n ? Math.round((flat / (n * channels.length)) * 1e6) : 0) : null,
    lufs: integratedLoudness(kSum, unitLen),
    dynamicRange: dynamicRangeOf(drSumSq, drPeak, drLen),
    dcOffsetPct: n ? Math.round(Math.max(...dcSum.map(s => Math.abs(s / n))) * 1e4) / 100 : 0,
    silenceStartS: Math.round(lead * unitS * 100) / 100,
    silenceEndS: Math.round(trail * unitS * 100) / 100,
    decodedS: Math.round((n / rate) * 100) / 100,
    // Side 60 dB under mid: the same signal in both channels, give or take codec noise.
    monoAsStereo: channels.length === 2 && midSq > 0 && sideSq / midSq < 1e-6,
    decodeRate: rate,
    spectrum,
    bitsUsed: bitDepth ? bitUsage(channels, bitDepth) : null,
  };
}

// ---- The report's charts -------------------------------------------------

const spectrumWindow = Float64Array.from(
  { length: SPECTRUM_SIZE },
  (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SPECTRUM_SIZE)
);

/**
 * Audacity's Plot Spectrum at its defaults, so the two can be held side by
 * side: Hann windows overlapping by half, power averaged over the whole file,
 * 0 dB a full-scale sine. Channels are added, not averaged, because Audacity
 * adds them; a test MP3 read the same as Audacity to 0.1 dB.
 */
function audacitySpectrum(channels: Float32Array[]): number[] {
  const size = SPECTRUM_SIZE;
  const n = channels[0]?.length ?? 0;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const power = new Float64Array(size / 2 + 1);
  let windows = 0;
  for (let start = 0; start + size <= n; start += size / 2) {
    for (let i = 0; i < size; i++) {
      let v = 0;
      for (const ch of channels) v += ch[start + i];
      re[i] = v * spectrumWindow[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k <= size / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
    windows++;
  }
  // A Hann window passes a quarter of a sine's amplitude to its bin.
  const sine = (size / 4) ** 2 * windows;
  // -200 stands in for digital silence, which has no level in dB.
  return Array.from(power, p => (p > 0 ? Math.round(100 * Math.log10(p / sine)) / 10 : -200));
}

export function visualise(
  channels: Float32Array[],
  rate: number,
  metrics: QualityMetrics,
  /** The header's duration; columns past the decoded end come out NaN. */
  duration: number
): TrackVisuals {
  const n = channels[0]?.length ?? 0;
  const total = Math.max(duration, n / rate);
  const colLen = (total * rate) / WAVE_COLUMNS;
  const stereo = channels.length === 2;

  const peakMax = new Array<number>(WAVE_COLUMNS).fill(NaN);
  const peakMin = new Array<number>(WAVE_COLUMNS).fill(NaN);
  const rms = new Array<number>(WAVE_COLUMNS).fill(NaN);
  const clipped = new Array<boolean>(WAVE_COLUMNS).fill(false);
  const counts = new Float64Array(HIST_BINS);
  // Correlation sums per column; a slice is two columns.
  const lr = new Float64Array(WAVE_COLUMNS);
  const ll = new Float64Array(WAVE_COLUMNS);
  const rr = new Float64Array(WAVE_COLUMNS);

  times(WAVE_COLUMNS, c => {
    const from = Math.round(c * colLen);
    const to = Math.min(n, Math.round((c + 1) * colLen));
    if (from >= to) return;
    let max = -Infinity;
    let min = Infinity;
    let sq = 0;
    for (const x of channels) {
      for (let i = from; i < to; i++) {
        const v = x[i];
        if (v > max) max = v;
        if (v < min) min = v;
        sq += v * v;
        counts[Math.min(HIST_BINS - 1, Math.max(0, Math.floor(((v + 1) / 2) * HIST_BINS)))]++;
      }
    }
    const samples = (to - from) * channels.length;
    peakMax[c] = max;
    peakMin[c] = min;
    rms[c] = Math.sqrt(sq / samples);
    if (stereo) {
      const [l, r] = channels;
      for (let i = from; i < to; i++) {
        lr[c] += l[i] * r[i];
        ll[c] += l[i] * l[i];
        rr[c] += r[i] * r[i];
      }
    }
  });

  if (metrics.clipPpm != null) {
    eachFlatTop(channels, i => {
      clipped[Math.min(WAVE_COLUMNS - 1, Math.floor(i / colLen))] = true;
    });
  }

  const counted = counts.reduce((a, b) => a + b, 0);
  const histogram = Array.from(counts, v => (counted ? v / counted : 0));

  const correlation = stereo
    ? Array.from({ length: SLICES }, (_, s) => {
        const [a, b] = [2 * s, 2 * s + 1];
        const l2 = ll[a] + ll[b];
        const r2 = rr[a] + rr[b];
        const samples = 2 * colLen;
        // Silence and the part past the decoded end break the line.
        if (Number.isNaN(peakMax[a]) || (l2 + r2) / (2 * samples) < SILENT * SILENT) return NaN;
        return Math.round(((lr[a] + lr[b]) / Math.sqrt(l2 * r2 || 1)) * 1000) / 1000;
      })
    : null;

  let goniometer: number[] | null = null;
  if (stereo) {
    const [l, r] = channels;
    const from = Math.floor(metrics.silenceStartS * rate);
    const to = Math.max(
      from + 1,
      Math.min(n, Math.floor((metrics.decodedS - metrics.silenceEndS) * rate))
    );
    const points: number[] = [];
    let reach = 0;
    for (let k = 0; k < GONIO_POINTS; k++) {
      const i = Math.floor(from + ((k + 0.5) / GONIO_POINTS) * (to - from));
      const side = (l[i] - r[i]) / 2;
      const mid = (l[i] + r[i]) / 2;
      reach = Math.max(reach, Math.abs(side), Math.abs(mid));
      points.push(side, mid);
    }
    // Scaled to fill the plot: the shape is what reads, not the level.
    const gain = reach > 0 ? 0.95 / reach : 0;
    goniometer = points.map(v => Math.round(v * gain * 1000) / 1000);
  }

  // Spectrogram: two frames per slice, averaged, relative to the 1-2 kHz level
  // of the whole track so its numbers line up with the spectrum's.
  const analyser = bandAnalyser(channels, rate);
  const bands = analyser.bands;
  const sliceLen = (total * rate) / SLICES;
  const slicePower = new Float64Array(SLICES * bands).fill(NaN);
  const sum = new Float64Array(bands);
  const frame = new Float64Array(bands);
  times(SLICES, s => {
    if ((s + 0.5) * sliceLen >= n) return;
    frame.fill(0);
    let ms = 0;
    for (const at of [0.25, 0.75]) {
      ms += analyser.frame(
        Math.min(Math.max(0, n - FFT_N), Math.floor((s + at) * sliceLen - FFT_N / 2)),
        frame
      );
    }
    for (let b = 0; b < bands; b++) {
      const p = ms > 0 ? frame[b] / 2 : 0;
      slicePower[s * bands + b] = p;
      sum[b] += p;
    }
  });
  const ref = refPower(sum);
  const spectrogram = Float32Array.from(slicePower, p =>
    Number.isNaN(p)
      ? NaN
      : p > 0 && ref > 0
        ? Math.max(FLOOR_DB, 10 * Math.log10(p / ref))
        : FLOOR_DB
  );

  return {
    peakMax,
    peakMin,
    rms,
    clipped,
    spectrogram,
    slices: SLICES,
    correlation,
    goniometer,
    histogram,
    bitsUsed: metrics.bitsUsed,
    spectrum: audacitySpectrum(channels),
  };
}

// ---- Verdict -------------------------------------------------------------

export function findIssues(f: FileFormat, m: QualityMetrics): QualityIssue[] {
  const out: QualityIssue[] = [];
  const kbps = Math.round((f.bitRate ?? 0) / 1000);
  const cutoff = m.cutoffHz != null ? `${(m.cutoffHz / 1000).toFixed(1)} kHz` : null;
  if (cutoff && f.lossless && m.cutoffHz! < 19500) {
    out.push({
      kind: 'upscaled',
      severity: 'problem',
      detail: `Frequency cutoff at ${cutoff}. True lossless audio has no cutoff below about 20 kHz, so this file was transcoded from a lossy source.`,
    });
  } else if (cutoff && f.lossless && (f.sampleRate ?? 0) >= 88200 && m.cutoffHz! < 24000) {
    out.push({
      kind: 'upscaled',
      severity: 'warning',
      detail: `Frequency cutoff at ${cutoff}: the audio was resampled from a 44.1 or 48 kHz master, so the higher sample rate holds nothing extra.`,
    });
  } else if (cutoff && !f.lossless && kbps >= 256 && m.cutoffHz! < 17500) {
    out.push({
      kind: 'upscaled',
      severity: 'problem',
      detail: `Frequency cutoff at ${cutoff}, typical of a 128 kbps encode, but the file claims ${kbps} kbps.`,
    });
  }
  if (!f.lossless && kbps > 0 && kbps < 160) {
    out.push({
      kind: 'lowBitrate',
      severity: 'warning',
      detail: `${kbps} kbps. Cymbals and reverb tails may sound smeared.`,
    });
  }
  if (m.hotPpm >= LOUD_MASTER_PPM) {
    out.push({
      kind: 'loudMaster',
      severity: 'warning',
      detail: `Mastered very loud: ${(m.hotPpm / 1e4).toFixed(1)}% of samples sit at the ceiling. A mastering choice rather than damage to this file, but it can sound flat and tiring.`,
    });
  }
  if (m.clipPpm != null && m.clipPpm >= CLIP_WARNING_PPM) {
    out.push({
      kind: 'clipping',
      severity: m.clipPpm >= CLIP_PROBLEM_PPM ? 'problem' : 'warning',
      detail: `${m.clipPpm.toLocaleString()} samples per million are flattened at the peak, so the master was clipped. Heavy clipping sounds like fuzz on loud hits.`,
    });
  }
  // A header's duration for VBR audio without a seek table is an estimate, so
  // only a clear gap counts.
  if (f.duration && f.duration - m.decodedS > Math.max(2, f.duration * 0.03)) {
    out.push({
      kind: 'truncated',
      severity: 'problem',
      detail: `Audio ends at ${mmss(m.decodedS)}; the file says ${mmss(f.duration)}.`,
    });
  }
  const silences = [
    m.silenceStartS >= 10 ? `${Math.round(m.silenceStartS)} s of silence at the start` : null,
    m.silenceEndS >= 20 ? `${Math.round(m.silenceEndS)} s of silence at the end` : null,
  ].filter(Boolean);
  if (silences.length) {
    out.push({ kind: 'silence', severity: 'warning', detail: `${silences.join(' and ')}.` });
  }
  if (m.monoAsStereo) {
    out.push({
      kind: 'monoAsStereo',
      severity: 'warning',
      detail: 'Left and right are identical: mono audio stored as two channels.',
    });
  }
  if (m.dcOffsetPct >= 1) {
    out.push({
      kind: 'dcOffset',
      severity: 'warning',
      detail: `DC offset of ${m.dcOffsetPct.toFixed(1)}%. Can click when playback starts or stops.`,
    });
  }
  const depth = m.bitsUsed?.length ?? 0;
  let used = depth;
  while (used > 0 && m.bitsUsed && !(m.bitsUsed[used - 1] > 0)) used--;
  if (depth > 16 && depth - used >= 4) {
    out.push({
      kind: 'paddedBits',
      severity: 'warning',
      detail: `Only ${used} of ${depth} bits carry audio: ${used}-bit audio padded out to ${depth}-bit.`,
    });
  }
  return out;
}

export const verdictOf = (issues: QualityIssue[]): Verdict =>
  issues.some(i => i.severity === 'problem') ? 'problem' : issues.length ? 'warning' : 'good';

// ---- Comparing two files -------------------------------------------------

const ENVELOPE_HZ = 20;
const MAX_LAG_S = 30;
/**
 * Envelope correlation at or above which two files hold the same recording.
 * Different encodes and masters of one recording score about 0.95 and up; other
 * songs, and other performances of the same song, fall well short.
 */
// ponytail: tuned on a handful of pairs; revisit if a real match is called different.
const SAME_RECORDING = 0.85;

/** Loudness over time in dB, ENVELOPE_HZ frames a second, for lining two files up. */
export function loudnessEnvelope(channels: Float32Array[], rate: number): Float32Array {
  const n = channels[0]?.length ?? 0;
  const hop = Math.max(1, Math.round(rate / ENVELOPE_HZ));
  return Float32Array.from({ length: Math.floor(n / hop) }, (_, f) => {
    let sum = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      let v = 0;
      for (const ch of channels) v += ch[i];
      v /= channels.length;
      sum += v * v;
    }
    return Math.max(-90, 10 * Math.log10(sum / hop || 1e-12));
  });
}

export interface AudioMatch {
  /** Correlation of the two envelopes at their best alignment, -1 to 1. */
  similarity: number;
  /** How much later the second file's audio starts, in seconds. */
  offsetS: number;
}

/**
 * Lines two envelopes up within ±MAX_LAG_S and correlates them. Envelopes in dB
 * with their means taken out, so one file being louder doesn't count against it.
 */
export function matchEnvelopes(a: Float32Array, b: Float32Array): AudioMatch {
  const maxLag = MAX_LAG_S * ENVELOPE_HZ;
  const minOverlap = 10 * ENVELOPE_HZ;
  let best = { similarity: -1, lag: 0 };
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const from = Math.max(0, -lag);
    const to = Math.min(a.length, b.length - lag);
    const count = to - from;
    if (count < minOverlap) continue;
    let sa = 0;
    let sb = 0;
    let sab = 0;
    let saa = 0;
    let sbb = 0;
    for (let i = from; i < to; i++) {
      const x = a[i];
      const y = b[i + lag];
      sa += x;
      sb += y;
      sab += x * y;
      saa += x * x;
      sbb += y * y;
    }
    const cov = sab - (sa * sb) / count;
    const va = saa - (sa * sa) / count;
    const vb = sbb - (sb * sb) / count;
    const r = va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
    if (r > best.similarity) best = { similarity: r, lag };
  }
  return {
    similarity: Math.round(best.similarity * 1000) / 1000,
    offsetS: best.lag / ENVELOPE_HZ,
  };
}

/** One file's check, as far as a comparison needs it. */
export interface Checked {
  format: FileFormat | null;
  metrics: QualityMetrics | null;
  error: string | null;
  issues: QualityIssue[];
}

export type CompareOutcome = 'better' | 'same' | 'worse' | 'different' | 'unreadable';

export interface CompareReason {
  text: string;
  /** The file this point counts for; null for a plain note. */
  favours: 'a' | 'b' | null;
}

export interface CompareVerdict {
  /** How the second file stands against the first. */
  outcome: CompareOutcome;
  reasons: CompareReason[];
}

const kHzText = (hz: number) => `${(hz / 1000).toFixed(1)} kHz`;
const has = (c: Checked, kind: IssueKind) => c.issues.some(i => i.kind === kind);

/**
 * How the second file stands against the first, for "is this a worthy
 * replacement". Criteria in order of weight: a file that's cut short loses,
 * then real bandwidth (the measured cutoff, not the format), real lossless,
 * clipping, dynamic range, and the remaining issues. The first that differs
 * decides; every one that differs is listed.
 */
export function compareChecks(
  a: Checked,
  b: Checked,
  match: AudioMatch | null,
  names: [string, string]
): CompareVerdict {
  const [na, nb] = names;
  const both = (text: (c: Checked) => string) => `${text(a)} in the ${na}, ${text(b)} in the ${nb}`;
  if (!b.metrics) {
    return {
      outcome: 'unreadable',
      reasons: [{ text: `The ${nb} couldn't be read: ${b.error}`, favours: 'a' }],
    };
  }
  if (!a.metrics) {
    return {
      outcome: 'better',
      reasons: [{ text: `The ${na} couldn't be read: ${a.error}`, favours: 'b' }],
    };
  }
  const ma = a.metrics;
  const mb = b.metrics;

  // A better copy of something else is no replacement, so this goes first.
  if (match && match.similarity < SAME_RECORDING) {
    return {
      outcome: 'different',
      reasons: [
        {
          text: `They don't line up as the same recording: ${Math.round(Math.max(0, match.similarity) * 100)}% alike at best. Another performance, mix or song.`,
          favours: null,
        },
      ],
    };
  }
  const cutA = has(a, 'truncated');
  const cutB = has(b, 'truncated');
  if (!cutA && !cutB && Math.abs(ma.decodedS - mb.decodedS) > Math.max(2, 0.02 * ma.decodedS)) {
    return {
      outcome: 'different',
      reasons: [
        {
          text: `Different lengths: ${mmss(ma.decodedS)} and ${mmss(mb.decodedS)}. Probably another edit.`,
          favours: null,
        },
      ],
    };
  }

  const band = (m: QualityMetrics) => Math.min(m.cutoffHz ?? 20000, 20000);
  const genuine = (c: Checked) => !!c.format?.lossless && !has(c, 'upscaled');
  const clipLevel = (m: QualityMetrics) =>
    m.clipPpm == null
      ? null
      : m.clipPpm >= CLIP_PROBLEM_PPM
        ? 2
        : m.clipPpm >= CLIP_WARNING_PPM
          ? 1
          : 0;
  const covered = new Set<IssueKind>([
    'upscaled',
    'clipping',
    'loudMaster',
    'truncated',
    'lowBitrate',
  ]);
  const others = (c: Checked) =>
    c.issues.filter(i => !covered.has(i.kind)).map(i => ISSUE_LABEL[i.kind]);
  const format = (c: Checked) =>
    c.format?.lossless
      ? genuine(c)
        ? 'lossless'
        : 'lossless from a lossy source'
      : `lossy ${Math.round((c.format?.bitRate ?? 0) / 1000)} kbps`;
  const clipText = (m: QualityMetrics) =>
    m.clipPpm == null
      ? 'not measurable'
      : m.clipPpm
        ? `${m.clipPpm.toLocaleString()} per million`
        : 'none';

  // Each: positive favours b, negative favours a, zero is a tie.
  const criteria: [number, string][] = [
    [
      Number(cutA) - Number(cutB),
      `Cut short: ${both(c => (has(c, 'truncated') ? `ends at ${mmss(c.metrics!.decodedS)}` : 'complete'))}`,
    ],
    [
      Math.abs(band(mb) - band(ma)) >= 1000 ? Math.sign(band(mb) - band(ma)) : 0,
      `Frequency cutoff: ${both(c => (c.metrics!.cutoffHz != null && c.metrics!.cutoffHz < 20000 ? kHzText(c.metrics!.cutoffHz) : 'none'))}`,
    ],
    [Number(genuine(b)) - Number(genuine(a)), `Format: ${both(format)}`],
    [
      clipLevel(ma) != null && clipLevel(mb) != null
        ? Math.sign(clipLevel(ma)! - clipLevel(mb)!)
        : 0,
      `Clipping: ${both(c => clipText(c.metrics!))}`,
    ],
    [
      Math.abs(mb.dynamicRange - ma.dynamicRange) >= 2
        ? Math.sign(mb.dynamicRange - ma.dynamicRange)
        : 0,
      `Dynamic range: ${both(c => `DR${c.metrics!.dynamicRange}`)}`,
    ],
    [
      Math.sign(others(a).length - others(b).length),
      `Other issues: ${both(c => others(c).join(', ') || 'none')}`,
    ],
  ];
  const reasons: CompareReason[] = criteria
    .filter(([sign]) => sign !== 0)
    .map(([sign, text]) => ({ text: `${text}.`, favours: sign > 0 ? 'b' : 'a' }));
  const decider = criteria.find(([sign]) => sign !== 0)?.[0] ?? 0;

  if (Math.abs(mb.lufs - ma.lufs) >= 2 && Math.abs(mb.dynamicRange - ma.dynamicRange) >= 2) {
    reasons.push({
      text: `Loudness: ${both(c => `${c.metrics!.lufs.toFixed(1)} LUFS`)}. Different masters of the same recording.`,
      favours: null,
    });
  }
  if (match && Math.abs(match.offsetS) >= 0.5) {
    reasons.push({
      text: `The ${nb} starts ${Math.abs(match.offsetS).toFixed(1)} s ${match.offsetS > 0 ? 'later' : 'earlier'}.`,
      favours: null,
    });
  }
  if (a.format?.size && b.format?.size) {
    const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
    reasons.push({ text: `Size: ${both(c => megabytes(c.format!.size!))}.`, favours: null });
  }
  if (!decider) reasons.unshift({ text: 'No difference in quality.', favours: null });
  return { outcome: decider > 0 ? 'better' : decider < 0 ? 'worse' : 'same', reasons };
}
