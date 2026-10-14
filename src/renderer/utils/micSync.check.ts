/** Self-check: run with `node src/renderer/utils/micSync.check.ts`. */
import assert from 'node:assert';
import { FRONT_HZ, REAR_HZ, gapMs } from './micSync.ts';

const SR = 48000;
const EVERY = 1200;
const PAIRS = 8;

/** A room recording: a quiet front and a louder rear `gap` ms behind it, over a noise floor. */
function recording(gap: number, jitter: number[], rearLevel = 0.3): Float32Array {
  const x = new Float32Array(SR * 12);
  let seed = 1;
  for (let i = 0; i < x.length; i++) {
    seed = (seed * 16807) % 2147483647;
    x[i] = (seed / 2147483647 - 0.5) * 0.002;
  }
  // 20 ms with 2 ms fades, as the engine's tone() plays them.
  const burst = (atMs: number, hz: number, amp: number): void => {
    const start = Math.round((atMs / 1000) * SR);
    const n = SR * 0.02;
    const ramp = SR * 0.002;
    for (let i = 0; i < n; i++) {
      x[start + i] += amp * Math.min(1, i / ramp, (n - i) / ramp) * Math.sin((2 * Math.PI * hz * i) / SR);
    }
  };
  for (let p = 0; p < PAIRS; p++) {
    const t = 300 + p * EVERY;
    burst(t, FRONT_HZ, 0.05);
    if (rearLevel) burst(t + gap + jitter[p % jitter.length], REAR_HZ, rearLevel);
  }
  return x;
}

// A Bluetooth rear that lands either side of its mean, as the M413SP did.
const slow = gapMs(recording(480, [-13, 13]), SR, PAIRS, EVERY);
assert.ok(slow !== null && Math.abs(slow - 480) <= 15, `slow rear: ${slow}`);

// A rear ahead of the front.
const fast = gapMs(recording(-120, [0]), SR, PAIRS, EVERY);
assert.ok(fast !== null && Math.abs(fast + 120) <= 2, `fast rear: ${fast}`);

// Two wired outputs already close: the bursts overlap and each must still be told apart.
const overlap = gapMs(recording(5, [0]), SR, PAIRS, EVERY);
assert.ok(overlap !== null && Math.abs(overlap - 5) <= 2, `overlapping bursts: ${overlap}`);

// A rear the mic never heard gives no number rather than a wrong one.
assert.equal(gapMs(recording(480, [0], 0), SR, PAIRS, EVERY), null);

console.log('micSync ok');
