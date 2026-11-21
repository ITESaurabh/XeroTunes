/**
 * Self-check: run with `node src/main/utils/mergeKnown.check.ts`.
 */
import assert from 'node:assert';
import { mergeKnown } from './mergeKnown.ts';

const defaults = {
  volume: 1,
  theme: { mode: 0, accent: 'blue', customThemes: [] as unknown[] },
  deviceVolumes: {} as Record<string, number>,
  outputDevice: null as string | null,
};
const current = {
  volume: 0.4,
  theme: { mode: 1, accent: 'red', customThemes: [] },
  deviceVolumes: { speakers: 0.5 },
  outputDevice: 'speakers',
};

// Same shape: everything restores.
assert.deepStrictEqual(
  mergeKnown(defaults, current, {
    volume: 0.8,
    theme: { mode: 2, accent: 'green', customThemes: [{ name: 'Mine' }] },
    deviceVolumes: { headphones: 0.9 },
    outputDevice: 'headphones',
  }),
  {
    volume: 0.8,
    theme: { mode: 2, accent: 'green', customThemes: [{ name: 'Mine' }] },
    deviceVolumes: { headphones: 0.9 },
    outputDevice: 'headphones',
  }
);

// From a newer version: unknown keys are dropped, a retyped one keeps its
// current value, and what still fits restores.
assert.deepStrictEqual(
  mergeKnown(defaults, current, {
    volume: '80%',
    theme: { mode: 2, accent: 7, gradient: true },
    lyricsFont: 'Serif',
    outputDevice: { id: 'x' },
  }),
  {
    volume: 0.4,
    theme: { mode: 2, accent: 'red', customThemes: [] },
    deviceVolumes: { speakers: 0.5 },
    outputDevice: 'speakers',
  }
);

// From an older version: missing keys keep their current value.
assert.deepStrictEqual(mergeKnown(defaults, current, { volume: 0.2 }), { ...current, volume: 0.2 });

// A section that is no longer an object is ignored rather than wiping it.
assert.deepStrictEqual(mergeKnown(defaults, current, { theme: 'dark' }), current);
assert.deepStrictEqual(mergeKnown(defaults, current, null), current);

// A null default accepts a primitive or null, not an object.
assert.strictEqual(
  (mergeKnown(defaults, current, { outputDevice: null }) as typeof current).outputDevice,
  null
);

console.log('mergeKnown.check.ts OK');
