/** Self-check: run with `node src/renderer/utils/tableSort.check.ts`. */
import assert from 'node:assert';
import {
  compareValues,
  matchesFilter,
  matchesSearch,
  nextSort,
  opNeedsValue,
  sortRows,
  type SortState,
} from './tableSort.ts';

const titles = (rows: { Title: string }[]) => rows.map(r => r.Title);

// Numeric-aware collation: a plain string sort puts "Track 10" before "Track 2".
const tracks = [{ Title: 'Track 10' }, { Title: 'Track 2' }, { Title: 'track 1' }];
assert.deepEqual(titles(sortRows(tracks, r => r.Title, 'asc')), [
  'track 1',
  'Track 2',
  'Track 10',
]);
assert.deepEqual(titles(sortRows(tracks, r => r.Title, 'desc')), [
  'Track 10',
  'Track 2',
  'track 1',
]);

// Real numbers compare as numbers, not as text.
assert.equal(compareValues(9, 100, 'asc') < 0, true);
assert.equal(compareValues('9', '100', 'asc') < 0, true, 'numeric collation covers numeric strings');

// Blanks sink in both directions; flipping the arrow must not float them up.
const years = [{ Title: 'a', Year: 1999 }, { Title: 'b', Year: null }, { Title: 'c', Year: 1980 }];
assert.deepEqual(titles(sortRows(years, r => r.Year, 'asc')), ['c', 'a', 'b']);
assert.deepEqual(titles(sortRows(years, r => r.Year, 'desc')), ['a', 'c', 'b']);
assert.deepEqual(titles(sortRows([{ Title: 'a', Year: '' }, { Title: 'b', Year: 1 }], r => r.Year, 'desc')), ['b', 'a']);

// Ties keep library order, so a sorted list is still deterministic.
const dupes = [{ Title: 'x', N: 1 }, { Title: 'y', N: 1 }, { Title: 'z', N: 0 }];
assert.deepEqual(titles(sortRows(dupes, r => r.N, 'asc')), ['z', 'x', 'y']);

// The source array is never mutated; views hand us the query result directly.
const original = [{ Title: 'b' }, { Title: 'a' }];
sortRows(original, r => r.Title, 'asc');
assert.deepEqual(titles(original), ['b', 'a']);

// asc → desc → off, and a different column restarts at asc.
const off: SortState = { key: null, dir: 'asc' };
assert.deepEqual(nextSort(off, 'Title'), { key: 'Title', dir: 'asc' });
assert.deepEqual(nextSort({ key: 'Title', dir: 'asc' }, 'Title'), { key: 'Title', dir: 'desc' });
assert.deepEqual(nextSort({ key: 'Title', dir: 'desc' }, 'Title'), off);
assert.deepEqual(nextSort({ key: 'Title', dir: 'desc' }, 'Year'), { key: 'Year', dir: 'asc' });

// Filters run on the displayed text, so a formatted duration is matchable.
assert.equal(matchesFilter('3:13', 'contains', '13'), true);
assert.equal(matchesFilter('3:13', 'equals', '3:13'), true);
assert.equal(matchesFilter('Marilyn Manson', 'contains', 'MANSON'), true, 'case-insensitive');
assert.equal(matchesFilter('Marilyn Manson', 'startsWith', 'mar'), true);
assert.equal(matchesFilter('Marilyn Manson', 'endsWith', 'son'), true);
assert.equal(matchesFilter('Marilyn Manson', 'equals', 'manson'), false);

// Surrounding whitespace in the box must not stop a match.
assert.equal(matchesFilter('Eminem', 'contains', '  emin  '), true);

// Empty/non-empty look at the real cell, not the trimmed needle.
assert.equal(matchesFilter('', 'isEmpty', ''), true);
assert.equal(matchesFilter('x', 'isEmpty', ''), false);
assert.equal(matchesFilter('', 'isNotEmpty', ''), false);
assert.equal(matchesFilter('x', 'isNotEmpty', 'ignored'), true);
assert.equal(opNeedsValue('isEmpty'), false);
assert.equal(opNeedsValue('contains'), true);

// Quick search spans the columns it is given; an empty query keeps every row.
assert.equal(matchesSearch(['Holy Wood', 'Marilyn Manson'], 'manson'), true);
assert.equal(matchesSearch(['Holy Wood', 'Marilyn Manson'], 'eminem'), false);
assert.equal(matchesSearch(['a'], '   '), true, 'blank query is not a filter');
assert.equal(matchesSearch([], 'x'), false);

console.log('tableSort.check.ts OK');
