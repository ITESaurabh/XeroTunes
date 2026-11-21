const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * For settings another version wrote: takes only keys this version knows, with
 * values of the type it expects; anything else keeps its current value. An
 * object whose default is `{}` is a map keyed by data (volume per device), so
 * it is taken whole.
 */
export function mergeKnown(reference: unknown, current: unknown, incoming: unknown): unknown {
  if (isPlain(reference) && Object.keys(reference).length) {
    if (!isPlain(incoming)) return current;
    const cur = isPlain(current) ? current : {};
    const out: Record<string, unknown> = { ...cur };
    for (const key of new Set([...Object.keys(reference), ...Object.keys(cur)])) {
      if (key in incoming) out[key] = mergeKnown(reference[key], cur[key], incoming[key]);
    }
    return out;
  }
  const expected = reference !== undefined ? reference : current;
  if (expected === undefined) return current;
  if (isPlain(expected)) return isPlain(incoming) ? incoming : current;
  if (Array.isArray(expected)) return Array.isArray(incoming) ? incoming : current;
  // A null default (no device picked yet) only says the value is a primitive.
  if (expected === null)
    return incoming === null || typeof incoming !== 'object' ? incoming : current;
  return typeof incoming === typeof expected ? incoming : current;
}
