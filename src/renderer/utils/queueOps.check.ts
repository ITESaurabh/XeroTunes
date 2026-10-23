/** Self-check: run with `node src/renderer/utils/queueOps.check.ts`. */
import assert from 'node:assert';
import {
  insertUnique,
  markPlaying,
  queuedAround,
  removeQueueEntry,
  unshuffle,
} from './queueOps.ts';

const e = (Id: number, Queued = false) => ({ Id, Queued });

// "Play next" songs are the run right behind the playing one; "Add to queue" songs
// are every other queued one after it. Queued songs before it (skipped) don't count.
{
  const [skipped, now, n1, n2, l1, a1, l2, a2] = [
    e(9, true), e(1), e(10, true), e(11, true), e(2), e(12, true), e(3), e(13, true),
  ];
  const { next, later } = queuedAround([skipped, now, n1, n2, l1, a1, l2, a2], 1);
  assert.deepEqual(next, [n1, n2]);
  assert.deepEqual(later, [a1, a2]);
  assert.deepEqual(queuedAround([now, l1], 0), { next: [], later: [] });
}

// Re-adding songs drops their played and upcoming copies. The playing song stays put
// and, inside a batch, isn't queued again.
{
  const [h1, h2, now, u1, u2] = [e(1), e(2), e(3), e(4), e(5)];
  const added = [e(1, true), e(3, true), e(5, true), e(9, true)];
  const res = insertUnique([h1, h2, now, u1, u2], 2, 3, added);
  assert.deepEqual(res.queue.map(t => t.Id), [2, 3, 1, 5, 9, 4]);
  assert.equal(res.queue[res.index], now, 'history shrank, index follows the playing entry');
  assert.equal(res.index, 1);
}
// Added on its own, the playing song gets a second copy: "play this again".
{
  const now = e(3);
  const res = insertUnique([now, e(4)], 0, 1, [e(3, true)]);
  assert.deepEqual(res.queue.map(t => t.Id), [3, 3, 4]);
  assert.equal(res.queue[res.index], now);
}
// "Add to queue" of a song already queued moves it to the very end.
{
  const queue = [e(1), e(10, true), e(2), e(3)];
  const res = insertUnique(queue, 0, queue.length, [e(10, true)]);
  assert.deepEqual(res.queue.map(t => t.Id), [1, 2, 3, 10]);
}

// Starting a queued song clears its flag on a copy; others are left alone.
{
  const list = [e(1), e(2), e(10, true), e(11, true)];
  const played = markPlaying(list, 2);
  assert.equal(played[2].Queued, false);
  assert.equal(list[2].Queued, true, 'input untouched');
  assert.equal(played[3], list[3]);
  assert.equal(markPlaying(list, 0), list, 'no copy when nothing changes');
}

const q = ['a', 'b', 'c', 'd'];

// Removing before the playing entry shifts it down; after it, nothing moves.
assert.deepEqual(removeQueueEntry(q, 2, 0), { queue: ['b', 'c', 'd'], index: 1 });
assert.deepEqual(removeQueueEntry(q, 2, 3), { queue: ['a', 'b', 'c'], index: 2 });
assert.equal(removeQueueEntry(q, 2, 2), null, 'the playing entry stays');
assert.equal(removeQueueEntry(q, 2, 9), null);

// A song queued twice comes back twice, as two distinct entries.
const a1 = e(1);
const a2 = e(1);
const b = e(2);
const restored = unshuffle([b, a2, a1], [1, 2, 1], 0);
assert.equal(restored.queue.length, 3);
assert.equal(new Set(restored.queue).size, 3, 'no entry repeated by reference');
assert.deepEqual(restored.queue.map(t => t.Id), [1, 2, 1]);
assert.equal(restored.queue[restored.index], b, 'still on the playing entry');

// Ids gone from the queue (removed while shuffled) are skipped, not undefined.
assert.deepEqual(unshuffle([b], [1, 2, 1], 0).queue, [b]);

// Unshuffling keeps "Play next" songs next and "Add to queue" songs at the end.
const [s1, s2, s3, s4] = [e(1), e(2), e(3), e(4)];
const x = e(10, true);
const y = e(11, true);
const back = unshuffle([s3, x, s1, s4, y, s2], [1, 2, 3, 4, 10, 11], 0);
assert.deepEqual(back.queue.map(t => t.Id), [1, 2, 3, 10, 4, 11]);
assert.equal(back.queue[back.index], s3);
