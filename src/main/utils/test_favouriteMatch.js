// A wrong answer here silently favourites the wrong song, so the fallback order
// (hash, then filename) gets its own check.
// Run: node src/main/utils/test_favouriteMatch.js
const assert = require('assert');
const path = require('path');

const { buildTrackIndex, matchFavourite } = require('./favouriteMatch');

// Native paths: path.basename on Linux and macOS doesn't split on backslashes.
const music = (...parts) => path.join(path.resolve('/Music'), ...parts);
const library = [
  { Id: 1, Uri: music('Rock', 'Song A.mp3'), FileHash: 'aaa' },
  { Id: 2, Uri: music('Pop', 'Song B.mp3'), FileHash: 'bbb' },
  // Same filename as track 1 in another folder; only reachable by hash.
  { Id: 3, Uri: music('Live', 'Song A.mp3'), FileHash: 'ccc' },
  // Pre-hash rows exist in older libraries.
  { Id: 4, Uri: music('Old', 'Song D.mp3'), FileHash: null },
];
const index = buildTrackIndex(library);

const entry = (hash, file) => ({ hash, file });

// Hash wins, even when another file carries the same name.
assert.strictEqual(matchFavourite(index, entry('ccc', 'Song A.mp3')), 3);
// A renamed file still hashes the same.
assert.strictEqual(matchFavourite(index, entry('bbb', 'Whatever It Is Now.mp3')), 2);
// A hash that misses (an older export, a re-tagged FLAC) leaves the filename.
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

// Same machine: the exact path beats a hash that now points elsewhere.
assert.strictEqual(matchFavourite(index, { uri: music('Live', 'Song A.mp3'), hash: 'aaa' }), 3);

// Server tracks have no hash and share a "filename", so only the address can match them.
const server = buildTrackIndex([
  { Id: 10, Uri: 'http://jf.lan/Audio/a1/universal?DeviceId=d&UserId=u', FileHash: null },
  { Id: 11, Uri: 'http://jf.lan/Audio/b2/universal?DeviceId=d&UserId=u', FileHash: null },
]);
assert.strictEqual(
  matchFavourite(server, { uri: 'http://jf.lan/Audio/b2/universal?DeviceId=d&UserId=u' }),
  11
);
assert.strictEqual(
  matchFavourite(server, {
    uri: 'http://jf.lan/Audio/gone/universal?DeviceId=d&UserId=u',
    file: 'universal?DeviceId=d&UserId=u',
  }),
  null
);

// No `file` on the entry: a missed hash stays a miss instead of trying the name.
assert.strictEqual(matchFavourite(index, { hash: 'no-longer-matching' }), null);

// An empty library matches nothing rather than blowing up.
assert.strictEqual(matchFavourite(buildTrackIndex([]), entry('aaa', 'Song A.mp3')), null);
assert.strictEqual(matchFavourite(buildTrackIndex(undefined), entry(null, 'x.mp3')), null);

console.log('favouriteMatch: all assertions passed');
