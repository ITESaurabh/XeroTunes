// The rules a wrong answer silently corrupts the library with: how an artist tag
// is split, which tracks survive removing a folder, and which folders a scan
// treats as offline.
// Run: node src/main/utils/test_libraryRules.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  splitArtists,
  applyLibrarySettings,
  isUnderAnyRoot,
  readFolders,
} = require('./libraryRules');

function withRules(separators, exceptions, fn) {
  applyLibrarySettings({
    multiArtistSeparators: separators,
    multiArtistExceptions: exceptions,
  });
  fn();
}

// ── splitArtists ─────────────────────────────────────────────────────────────

withRules([',', '&'], ['AC/DC', '+/-'], () => {
  assert.deepStrictEqual(splitArtists('Alpha & Beta'), ['Alpha', 'Beta']);
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
withRules([',', '&'], ['Alpha & Beta'], () => {
  assert.deepStrictEqual(splitArtists('Alpha & Beta'), ['Alpha & Beta']);
  assert.deepStrictEqual(splitArtists('alpha & beta'), ['alpha & beta']);
  // Only the exact name is spared; other tags still split.
  assert.deepStrictEqual(splitArtists('Alpha & Gamma'), ['Alpha', 'Gamma']);
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
  assert.deepStrictEqual(splitArtists('Placeholder'), ['Placeholder']);
});
withRules([], [], () => {
  assert.deepStrictEqual(splitArtists('A & B'), ['A & B']);
});

// ── isUnderAnyRoot ───────────────────────────────────────────────────────────

const sep = path.sep;
const p = (...parts) => parts.join(sep);

const roots = [p('D:', 'Music'), p('E:', 'Archive', 'FLAC')];

assert.strictEqual(isUnderAnyRoot(p('D:', 'Music', 'Artist', 'a.mp3'), roots), true);
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
// A whole drive added as one folder.
assert.strictEqual(isUnderAnyRoot(p('X:', 'i.mp3'), ['X:' + sep]), true);

if (process.platform === 'win32') {
  assert.strictEqual(isUnderAnyRoot(p('d:', 'music', 'h.mp3'), roots), true);
}

// ── readFolders ──────────────────────────────────────────────────────────────
// Offline keeps a folder's missing tracks and online deletes them, so both are checked.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-folders-'));
const at = (...parts) => path.join(tmp, ...parts);
fs.mkdirSync(at('music', 'Album'), { recursive: true });
fs.writeFileSync(at('music', 'a.mp3'), '');
fs.writeFileSync(at('music', 'Album', 'B.FLAC'), '');
fs.writeFileSync(at('music', 'cover.jpg'), '');
fs.mkdirSync(at('empty'));
fs.mkdirSync(at('art'));
fs.writeFileSync(at('art', 'cover.jpg'), '');

const { online, offline } = readFolders(
  [at('music'), at('empty'), at('art'), at('unplugged')].map(Uri => ({ Uri })),
  ['.mp3', '.flac']
);
assert.deepStrictEqual([...online.keys()], [at('music')]);
assert.deepStrictEqual(
  online.get(at('music')).sort(),
  [at('music', 'Album', 'B.FLAC'), at('music', 'a.mp3')].sort()
);
// Empty is an unmounted share, art-only has no music to lose, unplugged throws.
assert.deepStrictEqual(offline, [at('empty'), at('art'), at('unplugged')]);
fs.rmSync(tmp, { recursive: true, force: true });

console.log('library rules: all checks passed');
