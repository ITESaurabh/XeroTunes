/**
 * Each preset is one setting of the rear feed built in surroundEngine:
 * rear = mid·(L+R)/2 + side·(L−R)/2, band-limited, optionally reverberated,
 * pushed back by a short Haas delay and trimmed. `steer` is how hard the
 * decoder ducks front/rear when the mix is clearly one or the other; music
 * mostly wants it low, matrix-encoded film wants it full.
 */
export interface SurroundPreset {
  name: string;
  blurb: string;
  /** Rear gets the untouched stereo track; every field below is ignored. */
  bypass?: boolean;
  mid: number;
  side: number;
  highpassHz: number;
  lowpassHz: number;
  /** Seconds of synthesized reverb tail on the rear; 0 bypasses it. */
  reverbS: number;
  reverbMix: number;
  delayMs: number;
  trimDb: number;
  steer: number;
}

export const SURROUND_PRESETS: Record<string, SurroundPreset> = {
  bypass: {
    name: 'Bypass',
    blurb: 'Same track on every speaker, no processing. The baseline.',
    bypass: true,
    mid: 1, side: 1, highpassHz: 0, lowpassHz: 20000,
    reverbS: 0, reverbMix: 0, delayMs: 0, trimDb: 0, steer: 0,
  },
  natural: {
    name: 'Natural',
    blurb: 'Gentle room feel for anything',
    mid: 0.3, side: 1, highpassHz: 120, lowpassHz: 7000,
    reverbS: 0, reverbMix: 0, delayMs: 15, trimDb: -4, steer: 0.3,
  },
  ambience: {
    name: 'Ambience',
    blurb: 'Airy tail behind you, pop and indie',
    mid: 0.2, side: 1, highpassHz: 150, lowpassHz: 6000,
    reverbS: 0.8, reverbMix: 0.35, delayMs: 20, trimDb: -3, steer: 0.2,
  },
  hall: {
    name: 'Concert Hall',
    blurb: 'Long tail, classical and live recordings',
    mid: 0.3, side: 1, highpassHz: 120, lowpassHz: 5000,
    reverbS: 2.2, reverbMix: 0.5, delayMs: 30, trimDb: -2, steer: 0.2,
  },
  club: {
    name: 'Club',
    blurb: 'Rear carries the beat too, EDM and hip-hop',
    mid: 0.8, side: 0.8, highpassHz: 80, lowpassHz: 9000,
    reverbS: 0, reverbMix: 0, delayMs: 8, trimDb: 0, steer: 0,
  },
  cinema: {
    name: 'Cinema',
    blurb: 'Full steering, films and surround-encoded mixes',
    mid: 0, side: 1.4, highpassHz: 100, lowpassHz: 7000,
    reverbS: 0, reverbMix: 0, delayMs: 20, trimDb: 0, steer: 1,
  },
  vocal: {
    name: 'Vocal Focus',
    blurb: 'Voices stay in front, acoustic and singer-songwriter',
    mid: 0.1, side: 1, highpassHz: 200, lowpassHz: 4000,
    reverbS: 0.6, reverbMix: 0.25, delayMs: 20, trimDb: -6, steer: 0.5,
  },
  arena: {
    name: 'Arena',
    blurb: 'Big and loud, rock and metal',
    mid: 0.4, side: 1, highpassHz: 100, lowpassHz: 6000,
    reverbS: 1.5, reverbMix: 0.4, delayMs: 25, trimDb: -2, steer: 0.2,
  },
  lounge: {
    name: 'Lounge',
    blurb: 'Warm and soft, jazz and lo-fi',
    mid: 0.5, side: 0.8, highpassHz: 120, lowpassHz: 4000,
    reverbS: 0.9, reverbMix: 0.3, delayMs: 15, trimDb: -5, steer: 0,
  },
  party: {
    name: 'Party Fill',
    blurb: 'Rear is just another speaker, fill the room',
    mid: 1, side: 1, highpassHz: 60, lowpassHz: 16000,
    reverbS: 0, reverbMix: 0, delayMs: 0, trimDb: 0, steer: 0,
  },
  wide: {
    name: 'Wide',
    blurb: 'Stretched stereo, pop and electronic',
    mid: 0.1, side: 1.2, highpassHz: 150, lowpassHz: 8000,
    reverbS: 0, reverbMix: 0, delayMs: 35, trimDb: -3, steer: 0.1,
  },
};
