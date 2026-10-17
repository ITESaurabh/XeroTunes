export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/**
 * Wider than an octave (1.41) on purpose: solveGains corrects the extra overlap,
 * and the sum then ripples 1.3 dB between bands instead of 3.2. Below ~0.85 the
 * overlap outweighs each band and the solve stops converging.
 */
export const EQ_Q = 1;

export const EQ_MAX_DB = 12;

/**
 * Bass boost after the bands, modelled on Android's stock BassBoost (AOSP
 * EffectBundle.cpp): a peak at 90 Hz worth up to 15 dB, with a high-pass under
 * it so the boost isn't spent on sub-bass headphones can't reproduce.
 */
export const BASS_FREQ = 90;
export const BASS_Q = 0.9;
export const BASS_MAX_DB = 15;
export const BASS_HIGHPASS_FREQ = 35;

export interface EqualizerSettings {
  enabled: boolean;
  /** A key of EQ_PRESETS, or 'custom' once a band is moved by hand. */
  preset: string;
  /** dB per band, same order as EQ_BANDS. */
  gains: number[];
  /** dB at BASS_FREQ, 0 to BASS_MAX_DB. 0 takes the stage out of the chain. */
  bass: number;
}

export const EQ_PRESETS: Record<string, { label: string; gains: number[] }> = {
  flat: { label: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { label: 'Bass boost', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  treble: { label: 'Treble boost', gains: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
  vocal: { label: 'Vocal', gains: [-2, -2, -1, 0, 2, 4, 4, 2, 0, -1] },
  rock: { label: 'Rock', gains: [4, 3, 2, 0, -1, -1, 1, 2, 3, 4] },
  pop: { label: 'Pop', gains: [-1, 0, 2, 3, 4, 3, 1, 0, -1, -1] },
  electronic: { label: 'Electronic', gains: [5, 4, 1, 0, -2, 0, 1, 2, 4, 5] },
  classical: { label: 'Classical', gains: [3, 2, 1, 0, 0, 0, -1, 1, 2, 3] },
  acoustic: { label: 'Acoustic', gains: [3, 3, 2, 1, 1, 1, 2, 2, 2, 1] },
};

export const DEFAULT_EQUALIZER_SETTINGS: EqualizerSettings = {
  enabled: false,
  preset: 'flat',
  gains: EQ_PRESETS.flat.gains,
  bass: 0,
};

export const TEMPO_MIN = 0.5;
export const TEMPO_MAX = 2;
export const TEMPO_STEP = 0.05;
