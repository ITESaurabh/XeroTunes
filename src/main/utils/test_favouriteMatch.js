/* eslint-disable @typescript-eslint/no-var-requires */
// A wrong answer here silently favourites the wrong song, so the fallback order
// (hash, then filename) gets its own check.
// Run: node src/main/utils/test_favouriteMatch.js
const assert = require('assert');

const { buildTrackIndex, matchFavourite } = require('./favouriteMatch');

const library = [
  { Id: 1, Uri: 'C:\\Music\\Rock\\Song A.mp3', FileHash: 'aaa' },
  { Id: 2, Uri: 'C:\\Music\\Pop\\Song B.mp3', FileHash: 'bbb' },
  // Same filename as track 1 in another folder — only reachable by hash.
  { Id: 3, Uri: 'C:\\Music\\Live\\Song A.mp3', FileHash: 'ccc' },
  // Pre-hash rows exist in older libraries.
  { Id: 4, Uri: 'C:\\Music\\Old\\Song D.mp3', FileHash: null },
];
const index = buildTrackIndex(library);

const entry = (hash, file) => ({ hash, file });

// Hash wins, even when another file carries the same name.
assert.strictEqual(matchFavourite(index, entry('ccc', 'Song A.mp3')), 3);
// A renamed file still hashes the same.
assert.strictEqual(matchFavourite(index, entry('bbb', 'Whatever It Is Now.mp3')), 2);
// A tag edit changes the bytes, so the filename is what's left.
assert.strictEqual(matchFavourite(index, entry('no-longer-matching', 'Song B.mp3')), 2);
// Filenames are compared case-insensitively; extensions still count.
assert.strictEqual(matchFavourite(index, entry(null, 'SONG b.MP3')), 2);
assert.strictEqual(matchFavourite(index, entry(null, 'Song B.flac')), null);
// Duplicate names collapse onto the first track indexed.
assert.strictEqual(matchFavourite(index, entry(null, 'Song A.mp3')), 1);
// A row with no hash is reachable by name only.
assert.strictEqual(matchFavourite(index, entry('aaa2', 'Song D.mp3')), 4);
// Nothing in this library matches → the caller reports it as failed.
assert.strictEqual(matchFavourite(index, entry('zzz', 'Missing.mp3')), null);
// A malformed file shouldn't throw its way out of an import.
assert.strictEqual(matchFavourite(index, null), null);
assert.strictEqual(matchFavourite(index, {}), null);

// An empty library matches nothing rather than blowing up.
assert.strictEqual(matchFavourite(buildTrackIndex([]), entry('aaa', 'Song A.mp3')), null);
assert.strictEqual(matchFavourite(buildTrackIndex(undefined), entry(null, 'x.mp3')), null);

console.log('favouriteMatch: all assertions passed');
