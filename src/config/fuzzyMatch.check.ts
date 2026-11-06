/** Self-check: run with `node src/config/fuzzyMatch.check.ts`. */
import assert from 'node:assert';
import { fuzzyFilter, fuzzyRank } from './fuzzyMatch.ts';

const matches = (text: string, query: string) => fuzzyRank(text, query) !== null;

// Substring hits always match, ranked exact > prefix > inside.
assert.equal(fuzzyRank('Test Artist', 'test artist'), 0);
assert.equal(fuzzyRank('Test Artist', 'TEST'), 1);
assert.equal(fuzzyRank('Test Artist', 'artist'), 2);
assert.equal(fuzzyRank('Test Artist', 'st art'), 2);
assert.equal(fuzzyRank('Test Artist', '  test  '), 1, 'surrounding spaces are ignored');

assert.equal(fuzzyRank('Silver Lantern', 'lantren'), 4, 'swapped pair is one typo');
assert.equal(fuzzyRank('Silver Lantern', 'lanturn'), 4, 'substitution');
assert.equal(fuzzyRank('Silver Lantern', 'lantrn'), 4, 'deletion');
assert.equal(fuzzyRank('Silver Lantern', 'lanttern'), 4, 'insertion');

// A second typo needs 8+ letters.
assert.equal(fuzzyRank('Placeholder Song', 'plasehodler'), 5);
assert.equal(matches('Silver Lantern', 'lntrn'), false, '2 typos on a 5-letter word');

// Short words and numbers don't flex.
assert.equal(matches('Blue Car', 'cat'), false);
assert.equal(matches('Track 1', 'track 2'), false);
assert.equal(matches('Released 1999', '1998'), false);
assert.equal(matches('Song Remix2', 'remix3'), false);

assert.equal(fuzzyRank('Silver Lantern', 'lantern silver'), 3);
assert.equal(fuzzyRank('Silver Lantern', 'silv lant'), 3);
assert.equal(fuzzyRank('Silver Lantern', 'silverlantern'), 3);
assert.equal(fuzzyRank('AC/DC', 'acdc'), 3);
assert.equal(fuzzyRank("Don't Stop", 'dont'), 3);
assert.equal(matches('Cat Stand', 'ts'), false, 'joined text only matches from a word start');
assert.equal(fuzzyRank('Dont Stop Now', 'dont stopp'), 4);
assert.equal(
  fuzzyRank('Bo Mi Ra', 'bo mu ra'),
  4,
  'typo in a short word, caught on the joined text'
);

// Every query word has to match.
assert.equal(matches('Silver Lantern', 'silver placeholder'), false);

assert.equal(fuzzyRank('Café Placeholder', 'cafe'), 1);
assert.equal(fuzzyRank('Cafe Placeholder', 'CAFÉ'), 1);

assert.equal(fuzzyRank('テスト アルバム', 'アルバム'), 2);
assert.equal(matches('राम', 'रोम'), false, 'a different vowel sign in a short word');

// Punctuation-only or blank queries never match everything.
assert.equal(matches('Silver Lantern', '!!!'), false);
assert.equal(matches('Silver Lantern', '   '), false);
assert.equal(fuzzyRank('Rock & Roll', '&'), 2, 'literal punctuation still matches');
assert.equal(matches('', 'silver'), false);

// Typo matches appear only when nothing matches as typed.
const rows = ['Live Song', 'Love Song', 'Move Song', 'Glove Song', 'Other'];
const same = (s: string) => s;
assert.deepEqual(fuzzyFilter(rows, 'love', same), ['Love Song', 'Glove Song']);
assert.deepEqual(fuzzyFilter(rows, 'lvoe', same), ['Love Song']);
assert.deepEqual(fuzzyFilter(['Live Song', 'Other'], 'love', same), ['Live Song']);
assert.deepEqual(fuzzyFilter(rows, 'placeholder', same), []);
assert.equal(fuzzyFilter(rows, '  ', same), rows, 'a blank query is not a filter');

console.log('fuzzyMatch.check.ts OK');
