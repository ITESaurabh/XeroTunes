/** Self-check: run with `node src/renderer/utils/eqMath.check.ts`. */
import assert from 'node:assert';
import {
  BASS_FREQ,
  BASS_HIGHPASS_FREQ,
  BASS_MAX_DB,
  EQ_BANDS,
  EQ_PRESETS,
} from '../../config/equalizer.ts';
import {
  BASS_HIGHPASS,
  BASS_PEAK,
  CURVE_FREQS,
  bandDb,
  bassDb,
  responseDb,
  solveGains,
} from './eqMath.ts';

const at = (sliders: number[], freqs: number[]): number[] => responseDb(solveGains(sliders), freqs);
const close = (got: number[], want: number[], tol: number, what: string): void =>
  got.forEach((v, i) =>
    assert.ok(
      Math.abs(v - want[i]) <= tol,
      `${what}: band ${i} is ${v.toFixed(2)}, want ${want[i]}`
    )
  );

close(at(Array(10).fill(0), CURVE_FREQS), Array(CURVE_FREQS.length).fill(0), 1e-9, 'flat');

// Every band lands on its slider, however much the neighbours overlap.
for (const [name, { gains }] of Object.entries(EQ_PRESETS))
  close(at(gains, EQ_BANDS), gains, 0.1, name);

// Regressions: a run of -12 bands measured near -17, and a lone +3 between -12s came out at -3.
const cut = [12, 12, -4, -12, -12, -12, -12, -12, -12, -12];
close(at(cut, EQ_BANDS), cut, 0.1, 'deep cut');
const island = [12, 12, -4, -12, 3, -12, -12, -12, -12, -12];
close(at(island, EQ_BANDS), island, 0.1, 'lone boost');

// All bands equal stays flat out to both edges, with no sag between bands.
const level = at(Array(10).fill(-12), CURVE_FREQS);
const ripple = Math.max(...level) - Math.min(...level);
assert.ok(ripple <= 2, `all -12 ripples ${ripple.toFixed(2)} dB`);

// Bass boost no longer overshoots its +6 top band.
assert.ok(Math.max(...at(EQ_PRESETS.bass.gains, CURVE_FREQS)) <= 6.5, 'bass boost overshoots');

close(bassDb(0, CURVE_FREQS), Array(CURVE_FREQS.length).fill(0), 0, 'bass off');
close([bandDb(BASS_PEAK, BASS_MAX_DB, BASS_FREQ)], [BASS_MAX_DB], 0.01, 'bass peak');
close([bandDb(BASS_HIGHPASS, 0, BASS_HIGHPASS_FREQ)], [-3.01], 0.05, 'highpass corner');
const [sub, peak, mid] = bassDb(BASS_MAX_DB, [20, BASS_FREQ, 1000]);
assert.ok(sub < 0, `bass boosts sub-bass: ${sub.toFixed(2)} dB at 20 Hz`);
assert.ok(peak > BASS_MAX_DB - 1, `bass peak only ${peak.toFixed(2)} dB`);
assert.ok(Math.abs(mid) < 0.5, `bass leaks into mids: ${mid.toFixed(2)} dB at 1 kHz`);

console.log('eqMath ok');
