/**
 * Filter maths shared by the EQ engine and the dialog's curve, so what is drawn
 * is what plays. Formulas are the Audio EQ Cookbook ones Web Audio's
 * BiquadFilterNode is specified with; no audio context needed.
 */
import {
  BASS_FREQ,
  BASS_HIGHPASS_FREQ,
  BASS_Q,
  EQ_BANDS,
  EQ_MAX_DB,
  EQ_Q,
} from '../../config/equalizer.ts';

export type BandType = 'lowshelf' | 'peaking' | 'highshelf' | 'highpass';

export interface Band {
  type: BandType;
  frequency: number;
  /** Peaking Q; EQ_Q when unset. */
  q?: number;
}

/** Web Audio takes a highpass Q in dB, not linear; this is Butterworth's 1/√2. */
export const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2);

export const BASS_HIGHPASS: Band = { type: 'highpass', frequency: BASS_HIGHPASS_FREQ };
export const BASS_PEAK: Band = { type: 'peaking', frequency: BASS_FREQ, q: BASS_Q };

export const DISPLAY_SAMPLE_RATE = 48000;

// The outer bands are shelves so their level holds out past them; as peaks,
// everything beyond 32 Hz and 16 kHz fell back to 0 dB. The corner sits half an
// octave inside, so the band's own frequency gets nearly the whole shelf.
export const BANDS: Band[] = EQ_BANDS.map((hz, i) => {
  if (i === 0) return { type: 'lowshelf', frequency: hz * Math.SQRT2 };
  if (i === EQ_BANDS.length - 1) return { type: 'highshelf', frequency: hz / Math.SQRT2 };
  return { type: 'peaking', frequency: hz };
});

/** Half a band past each end, log-spaced: the x axis of the curve. */
export const CURVE_FREQS: number[] = Array.from({ length: 160 }, (_, i) => {
  const octave = -0.5 + (i / 159) * EQ_BANDS.length;
  return EQ_BANDS[0] * 2 ** octave;
});

export function bandDb(band: Band, gainDb: number, f: number, fs = DISPLAY_SAMPLE_RATE): number {
  // A highpass has no gain to be zero; it shapes the response regardless.
  if (!gainDb && band.type !== 'highpass') return 0;
  const A = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * band.frequency) / fs;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (band.type === 'highpass') {
    const alpha = sin / (2 * Math.SQRT1_2);
    [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
    [a0, a1, a2] = [1 + alpha, -2 * cos, 1 - alpha];
  } else if (band.type === 'peaking') {
    const alpha = sin / (2 * (band.q ?? EQ_Q));
    [b0, b1, b2] = [1 + alpha * A, -2 * cos, 1 - alpha * A];
    [a0, a1, a2] = [1 + alpha / A, -2 * cos, 1 - alpha / A];
  } else {
    // Web Audio fixes shelf slope S at 1, so Q plays no part.
    const k = 2 * Math.sqrt(A) * (sin / Math.SQRT2);
    const s = band.type === 'lowshelf' ? 1 : -1;
    b0 = A * (A + 1 - s * (A - 1) * cos + k);
    b1 = s * 2 * A * (A - 1 - s * (A + 1) * cos);
    b2 = A * (A + 1 - s * (A - 1) * cos - k);
    a0 = A + 1 + s * (A - 1) * cos + k;
    a1 = -s * 2 * (A - 1 + s * (A + 1) * cos);
    a2 = A + 1 + s * (A - 1) * cos - k;
  }
  const w = (2 * Math.PI * f) / fs;
  const mag = (c0: number, c1: number, c2: number): number =>
    Math.hypot(
      c0 + c1 * Math.cos(w) + c2 * Math.cos(2 * w),
      c1 * Math.sin(w) + c2 * Math.sin(2 * w)
    );
  return 20 * Math.log10(mag(b0, b1, b2) / mag(a0, a1, a2));
}

export function responseDb(filterGains: number[], freqs: number[], fs?: number): number[] {
  return freqs.map(f =>
    BANDS.reduce((sum, band, i) => sum + bandDb(band, filterGains[i], f, fs), 0)
  );
}

export function bassDb(db: number, freqs: number[], fs?: number): number[] {
  return freqs.map(f => (db ? bandDb(BASS_HIGHPASS, 0, f, fs) + bandDb(BASS_PEAK, db, f, fs) : 0));
}

// A ±12 sawtooth across every band would need more than this and lands ~2.6 dB
// short; anything a person would set converges inside it.
const MAX_FILTER_DB = 2 * EQ_MAX_DB;
const MAX_PASSES = 100;
const TOLERANCE_DB = 0.01;

/**
 * Filter gains whose combined response lands on each slider at its band's
 * frequency; set to the sliders directly, neighbouring bands stack. Converges
 * because each band outweighs its overlap; slowest for one boost between deep
 * cuts (~40 passes, ~1.5 ms in Electron 43).
 */
export function solveGains(target: number[], fs?: number): number[] {
  let gains = [...target];
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const error = responseDb(gains, EQ_BANDS, fs).map((v, i) => target[i] - v);
    if (error.every(e => Math.abs(e) < TOLERANCE_DB)) break;
    gains = gains.map((g, i) => Math.max(-MAX_FILTER_DB, Math.min(MAX_FILTER_DB, g + error[i])));
  }
  return gains;
}
