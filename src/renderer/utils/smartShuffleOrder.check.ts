/** Self-check: run with `node src/renderer/utils/smartShuffleOrder.check.ts`. */
import assert from 'node:assert';
import { test } from 'node:test';
import {
  historyScore,
  rerank,
  signalOf,
  skipStreak,
  tasteScore,
  type Signal,
} from './smartShuffleOrder.ts';

const v = (...n: number[]) => Float32Array.from(n);
const calm = v(1, 0.1);
const loud = v(-1, 0.1);
const stay = (vec: Float32Array): Signal => ({ vec, weight: 1 });
const skip = (vec: Float32Array): Signal => ({ vec, weight: -1 });

test('a stay pulls similar tracks forward and a skip pushes them back', () => {
  const signals = [skip(loud), stay(calm)];
  assert.ok(tasteScore(v(0.9, 0), signals) > 0);
  assert.ok(tasteScore(v(-0.9, 0), signals) < 0);
  const items = [
    { id: 'loud1', vec: v(-1, 0) },
    { id: 'calm1', vec: v(1, 0) },
    { id: 'unknown', vec: null },
    { id: 'calm2', vec: v(0.8, 0.2) },
    { id: 'loud2', vec: v(-0.8, 0.2) },
  ];
  const order = rerank(items, i => i.vec, signals).map(i => i.id);
  assert.deepEqual(order.slice(0, 2).sort(), ['calm1', 'calm2']);
  assert.equal(order[2], 'unknown');
  assert.equal(order.length, items.length);
});

// `length` loud tracks with one calm track at `calmAt`; returns where the calm one ends up.
const calmLands = (calmAt: number, signals: Signal[], length = 200) => {
  const items = Array.from({ length }, (_, i) => ({ id: i, vec: i === calmAt ? calm : loud }));
  const order = rerank(items, i => i.vec, signals).map(i => i.id);
  assert.equal(order.length, length);
  return order.indexOf(calmAt);
};

test('a settled listener gets the next 60 reordered and no more', () => {
  const signals = [stay(calm)];
  assert.equal(skipStreak(signals), 0);
  assert.equal(calmLands(59, signals), 0);
  assert.equal(calmLands(100, signals), 100);
});

test('each skip in a row doubles the reach, up to eight times the window', () => {
  // Two skips in a row reach 240 tracks deep, so a calm track at 100 is found.
  const two = [stay(calm), skip(loud), skip(loud)];
  assert.equal(skipStreak(two), 2);
  assert.equal(calmLands(100, two), 0);
  // Six in a row still stop at 480.
  const six = [stay(calm), ...Array.from({ length: 6 }, () => skip(loud))];
  assert.equal(calmLands(470, six, 600), 0);
  assert.equal(calmLands(550, six, 600), 550);
});

test('a run of skips does not erase the last stay', () => {
  const signals = [stay(calm), skip(loud), skip(loud), skip(loud), skip(loud)];
  assert.ok(tasteScore(calm, signals) > tasteScore(v(0, 1), signals));
});

test("a track's own record breaks ties, and counts for little until it has a few reactions", () => {
  assert.equal(historyScore(null), 0);
  assert.ok(historyScore({ stays: 0, skips: 1 }) > historyScore({ stays: 0, skips: 6 }));
  assert.ok(historyScore({ stays: 5, skips: 0 }) > 0);
  // Three tracks that sound the same: the often-skipped one goes last, the often-played one first.
  const items = [
    { id: 'skipped', vec: calm, history: { stays: 0, skips: 5 } },
    { id: 'new', vec: calm, history: null },
    { id: 'loved', vec: calm, history: { stays: 5, skips: 0 } },
  ];
  const order = rerank(
    items,
    i => i.vec,
    [],
    i => i.history
  ).map(i => i.id);
  assert.deepEqual(order, ['loved', 'new', 'skipped']);
});

test('newer stays outweigh older ones', () => {
  const signals = [stay(loud), stay(calm)];
  assert.ok(tasteScore(calm, signals) > tasteScore(loud, signals));
});

test('with no signals the order is the random one', () => {
  assert.equal(tasteScore(calm, []), 0);
});

test('what counts as a stay and a skip, and how strongly', () => {
  assert.equal(signalOf(120, 200, true), 1);
  const early = signalOf(4, 200, true);
  const late = signalOf(50, 200, true);
  assert.ok(early !== null && late !== null && early < late && late < 0);
  // Picking another song from a list is not a skip.
  assert.equal(signalOf(10, 200, false), null);
  assert.equal(signalOf(80, 200, true), null);
  assert.equal(signalOf(0, 0, true), null);
});
