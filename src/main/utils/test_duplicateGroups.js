// A false match here puts two different songs side by side as duplicates, so the
// matching rules get their own check.
// Run: node src/main/utils/test_duplicateGroups.js
const assert = require('assert');

const { sameSongGroups } = require('./duplicateGroups');

let nextId = 1;
const track = fields => ({
  Id: nextId++,
  Title: 'Test Title',
  ArtistName: 'Test Artist',
  AlbumTitle: 'Test Album',
  Duration: 203,
  BitRate: 320000,
  DateAdded: 1,
  FileHash: `h${nextId}`,
  ...fields,
});
const ids = groups => groups.map(group => group.map(t => t.Id));

// A bad rip next to a good one: grouped, better bitrate first.
const bad = track({ BitRate: 128000, Duration: 204 });
const good = track({});
assert.deepStrictEqual(ids(sameSongGroups([bad, good])), [[good.Id, bad.Id]]);

// Case, stray spaces and artist order don't split a group.
const messy = track({ Title: '  test  TITLE ', ArtistName: 'B, A', AlbumTitle: 'test album' });
const clean = track({ Title: 'Test Title', ArtistName: 'A, B', AlbumTitle: 'Test Album' });
assert.strictEqual(sameSongGroups([messy, clean]).length, 1);

// A live cut on the same album runs longer and stays apart.
assert.deepStrictEqual(sameSongGroups([track({}), track({ Duration: 260 })]), []);

// 200/202/204 doesn't chain into one group.
const d200 = track({ Duration: 200 });
const d202 = track({ Duration: 202 });
const d204 = track({ Duration: 204 });
assert.deepStrictEqual(ids(sameSongGroups([d204, d202, d200])), [[d200.Id, d202.Id]]);

// Copies that all share a hash belong to the identical list, not this one.
assert.deepStrictEqual(sameSongGroups([track({ FileHash: 'x' }), track({ FileHash: 'x' })]), []);
// One differing copy is enough to list the whole run, identical pair included.
const pairA = track({ FileHash: 'y' });
const pairB = track({ FileHash: 'y' });
const odd = track({ BitRate: 192000 });
assert.strictEqual(sameSongGroups([pairA, pairB, odd])[0].length, 3);

// Another album or another artist is another song.
assert.deepStrictEqual(sameSongGroups([track({}), track({ AlbumTitle: 'Other Album' })]), []);
assert.deepStrictEqual(sameSongGroups([track({}), track({ ArtistName: 'Someone Else' })]), []);

// Blank titles can't be matched on.
assert.deepStrictEqual(sameSongGroups([track({ Title: ' ' }), track({ Title: '' })]), []);

// Equal bitrates: the oldest copy comes first.
const newer = track({ DateAdded: 9 });
const older = track({ DateAdded: 2 });
assert.deepStrictEqual(ids(sameSongGroups([newer, older])), [[older.Id, newer.Id]]);

assert.deepStrictEqual(sameSongGroups(undefined), []);

console.log('duplicateGroups: all assertions passed');
