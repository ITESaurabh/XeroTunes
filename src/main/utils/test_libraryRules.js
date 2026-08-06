/* eslint-disable @typescript-eslint/no-var-requires */
// The two rules a wrong answer silently corrupts the library with: how an artist
// tag is split, and which tracks survive removing a folder.
// Run: node src/main/utils/test_libraryRules.js
const assert = require('assert');
const path = require('path');

const { splitArtists, applyLibrarySettings, isUnderAnyRoot } = require('./libraryRules');

function withRules(separators, exceptions, fn) {
  applyLibrarySettings({
    multiArtistSeparators: separators,
    multiArtistExceptions: exceptions,
  });
  fn();
}

// ── splitArtists ─────────────────────────────────────────────────────────────

withRules([',', '&'], ['AC/DC', '+/-'], () => {
  assert.deepStrictEqual(splitArtists('Simon & Garfunkel'), ['Simon', 'Garfunkel']);
  assert.deepStrictEqual(splitArtists('A, B & C'), ['A', 'B', 'C']);
  // '/' is not a separator here, so the name is untouched with or without the rule.
  assert.deepStrictEqual(splitArtists('AC/DC'), ['AC/DC']);
  assert.deepStrictEqual(splitArtists(['Foo', 'Bar & Baz']), ['Foo', 'Bar', 'Baz']);
  assert.deepStrictEqual(splitArtists('  Spaced   Out  '), ['Spaced Out']);
  assert.deepStrictEqual(splitArtists(''), []);
  // Repeats collapse; a track never links the same artist twice.
  assert.deepStrictEqual(splitArtists('Q & Q'), ['Q']);
});

// An exception keeps a name whole even when it contains a live separator.
withRules([',', '&'], ['Simon & Garfunkel'], () => {
  assert.deepStrictEqual(splitArtists('Simon & Garfunkel'), ['Simon & Garfunkel']);
  assert.deepStrictEqual(splitArtists('simon & garfunkel'), ['simon & garfunkel']);
  // Only the exact name is spared; other tags still split.
  assert.deepStrictEqual(splitArtists('Simon & Art'), ['Simon', 'Art']);
});

// Adding a separator splits names that used to be whole.
withRules([',', '&', ';'], [], () => {
  assert.deepStrictEqual(splitArtists('A; B'), ['A', 'B']);
});

// Regex metacharacters in a separator are matched literally, not compiled.
withRules(['+'], [], () => {
  assert.deepStrictEqual(splitArtists('A + B'), ['A', 'B']);
  assert.deepStrictEqual(splitArtists('AB'), ['AB']);
});

// A blank separator would otherwise compile to a regex matching between every
// character and shred the name.
withRules([''], [], () => {
  assert.deepStrictEqual(splitArtists('Metallica'), ['Metallica']);
});
withRules([], [], () => {
  assert.deepStrictEqual(splitArtists('A & B'), ['A & B']);
});

// ── isUnderAnyRoot ───────────────────────────────────────────────────────────

const sep = path.sep;
const p = (...parts) => parts.join(sep);

const roots = [p('D:', 'Music'), p('E:', 'Archive', 'FLAC')];

assert.strictEqual(isUnderAnyRoot(p('D:', 'Music', 'Queen', 'a.mp3'), roots), true);
assert.strictEqual(isUnderAnyRoot(p('E:', 'Archive', 'FLAC', 'b.flac'), roots), true);
assert.strictEqual(isUnderAnyRoot(p('D:', 'Videos', 'c.mp3'), roots), false);
// A sibling that merely shares a prefix is not inside the root.
assert.strictEqual(isUnderAnyRoot(p('D:', 'Music2', 'd.mp3'), roots), false);
// A trailing separator on the stored root must not change the answer.
assert.strictEqual(isUnderAnyRoot(p('D:', 'Music', 'e.mp3'), [p('D:', 'Music') + sep]), true);
// Nested roots: removing the inner one leaves the file covered by the outer.
assert.strictEqual(isUnderAnyRoot(p('D:', 'Music', 'Rock', 'f.mp3'), [p('D:', 'Music')]), true);
assert.strictEqual(isUnderAnyRoot(p('D:', 'Music', 'Rock', 'f.mp3'), [p('D:', 'Jazz')]), false);
// No roots left: every track is outside, which is what wipes the library.
assert.strictEqual(isUnderAnyRoot(p('D:', 'Music', 'g.mp3'), []), false);

if (process.platform === 'win32') {
  assert.strictEqual(isUnderAnyRoot(p('d:', 'music', 'h.mp3'), roots), true);
}

console.log('library rules: all checks passed');
