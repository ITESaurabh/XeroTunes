// Entries are matched by position or object identity, never by Id: a playlist can
// hold a song twice, and re-adding the playing song queues a second copy of it.

type Entry = { Id: string | number; Queued?: boolean };

/** The user's songs after the playing one: the run right behind it ("Play next") and the rest. */
export function queuedAround<T extends Entry>(queue: T[], current: number) {
  let lead = current + 1;
  while (queue[lead]?.Queued) lead++;
  return {
    next: queue.slice(current + 1, lead),
    later: queue.filter((t, i) => i >= lead && t.Queued),
  };
}

/**
 * Inserts `items` at `at` (an index into the queue as passed in), dropping every other copy
 * of them so each plays where it was last added. The playing entry stays, and gets a
 * second copy only when added on its own, not as part of a batch.
 */
export function insertUnique<T extends Entry>(
  queue: T[],
  current: number,
  at: number,
  added: T[]
): { queue: T[]; index: number } {
  const playing = queue[current];
  const items =
    added.length > 1 && playing ? added.filter(t => t.Id !== playing.Id) : added;
  const ids = new Set(items.map(t => t.Id));
  const keep = (t: T) => t === playing || !ids.has(t.Id);
  const before = queue.slice(0, at).filter(keep);
  const after = queue.slice(at).filter(keep);
  return {
    queue: [...before, ...items, ...after],
    index: playing ? before.indexOf(playing) : current,
  };
}

/** The entry at `index` starts playing, so it no longer counts as one the user queued. */
export function markPlaying<T extends Entry>(queue: T[], index: number): T[] {
  const t = queue[index];
  if (!t?.Queued) return queue;
  const next = queue.slice();
  next[index] = { ...t, Queued: false };
  return next;
}

/** Drops entry `index`; null for the playing entry, which can't be removed. */
export function removeQueueEntry<T>(
  queue: T[],
  current: number,
  index: number
): { queue: T[]; index: number } | null {
  if (index === current || index < 0 || index >= queue.length) return null;
  return {
    queue: queue.filter((_, i) => i !== index),
    index: index < current ? current - 1 : current,
  };
}

/**
 * Puts a shuffled queue back in `order`, one entry per occurrence of an Id. The user's
 * songs stay where they were put, next or at the end.
 */
export function unshuffle<T extends Entry>(
  queue: T[],
  order: (string | number)[],
  current: number
): { queue: T[]; index: number } {
  const { next, later } = queuedAround(queue, current);
  const keep = new Set([...next, ...later]);
  const byId = new Map<string | number, T[]>();
  for (const t of queue) {
    if (keep.has(t)) continue;
    const bucket = byId.get(t.Id);
    if (bucket) bucket.push(t);
    else byId.set(t.Id, [t]);
  }
  const rest: T[] = [];
  for (const id of order) {
    const t = byId.get(id)?.shift();
    if (t) rest.push(t);
  }
  const at = rest.indexOf(queue[current]) + 1;
  return {
    queue: [...rest.slice(0, at), ...next, ...rest.slice(at), ...later],
    index: Math.max(0, at - 1),
  };
}
