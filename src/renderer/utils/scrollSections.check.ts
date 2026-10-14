/** Self-check: run with `node src/renderer/utils/scrollSections.check.ts`. */
import assert from 'node:assert';
import { alphabetSections } from './scrollSections.ts';

// One entry per letter change, at the row the letter first appears in.
assert.deepEqual(alphabetSections(['Adele', 'Air', 'Beck', 'Cher'], { rowHeight: 10 }), [
  { label: 'A', offset: 0 },
  { label: 'B', offset: 20 },
  { label: 'C', offset: 30 },
]);

// A card grid indexes by row, not by item.
assert.deepEqual(
  alphabetSections(['Adele', 'Air', 'Beck', 'Cher'], { rowHeight: 10, colCount: 2 }),
  [
    { label: 'A', offset: 0 },
    { label: 'B', offset: 10 },
  ],
  'B and C share row 1, so the rail can only point at the row'
);

// Digits, symbols and non-Latin scripts share the one bucket an A-Z rail can offer.
assert.deepEqual(alphabetSections(['3 Doors Down', '!!!', '東京', 'Air'], { rowHeight: 10 }), [
  { label: '#', offset: 0 },
  { label: 'A', offset: 30 },
]);

// Case and leading whitespace don't start a new bucket.
assert.deepEqual(alphabetSections(['abba', '  ABBA', 'Beck'], { rowHeight: 10 }), [
  { label: 'A', offset: 0 },
  { label: 'B', offset: 20 },
]);

// A pinned header inside the scroller shifts every offset.
assert.deepEqual(alphabetSections(['Adele', 'Beck'], { rowHeight: 10, headerHeight: 40 }), [
  { label: 'A', offset: 40 },
  { label: 'B', offset: 50 },
]);

// Degenerate layouts (a grid measured before mount) yield nothing rather than NaN offsets.
assert.deepEqual(alphabetSections(['Adele'], { rowHeight: 0 }), []);
assert.deepEqual(alphabetSections([], { rowHeight: 10 }), []);

console.log('scrollSections.check.ts OK');
