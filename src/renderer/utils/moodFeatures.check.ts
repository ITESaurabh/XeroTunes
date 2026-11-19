/** Self-check: run with `node src/renderer/utils/moodFeatures.check.ts`. */
import assert from 'node:assert';
import { test } from 'node:test';
import { melPatches, MOOD_RATE, PATCH_FRAMES } from './moodFeatures.ts';

// A chirp, two tones and noise from a fixed generator; four seconds, so it holds one whole patch.
let seed = 1;
const noise = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5;
const signal = Float32Array.from({ length: MOOD_RATE * 4 }, (_, i) => {
  const t = i / MOOD_RATE;
  return (
    0.3 * Math.sin(2 * Math.PI * (200 + 1500 * t) * t) +
    0.2 * Math.sin(2 * Math.PI * 440 * t) +
    0.1 * Math.sin(2 * Math.PI * 5000 * t) +
    0.05 * noise()
  );
});

test('mel front end matches Essentia TensorflowInputMusiCNN', () => {
  const { mel, count } = melPatches(signal);
  assert.equal(count, 1);
  assert.equal(mel.length, PATCH_FRAMES * 96);
  // First six bands of the frame starting at sample 49 * 256, from essentia.js 0.1.3 on this signal.
  const expected = [1.4209, 0.879, 1.436, 0.6972, 0.7659, 0.9592];
  expected.forEach((want, band) => {
    assert.ok(
      Math.abs(mel[49 * 96 + band] - want) < 1e-3,
      `band ${band}: ${mel[49 * 96 + band]} vs ${want}`
    );
  });
});

test('silence yields no patches', () => {
  assert.equal(melPatches(new Float32Array(MOOD_RATE * 10)).count, 0);
});
