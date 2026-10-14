/* eslint-disable @typescript-eslint/no-var-requires */
// A wrong signature fails every Last.fm call with "invalid method signature",
// so the sort, the excluded params and the trailing secret each get a check.
// Run: node src/main/utils/test_scrobbleSig.js
const assert = require('assert');
const crypto = require('crypto');

const { lastfmSignature } = require('./scrobbleSig');

const SECRET = 'secret';
const md5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex');

// api_key + method + track sorted by name, then the secret.
assert.strictEqual(
  lastfmSignature({ method: 'auth.getToken', api_key: 'KEY', track: 'Song' }, SECRET),
  md5('api_keyKEYmethodauth.getTokentrackSong' + SECRET)
);

// Insertion order must not matter.
assert.strictEqual(
  lastfmSignature({ track: 'Song', method: 'auth.getToken', api_key: 'KEY' }, SECRET),
  lastfmSignature({ api_key: 'KEY', method: 'auth.getToken', track: 'Song' }, SECRET)
);

// format and api_sig are sent but never signed.
assert.strictEqual(
  lastfmSignature({ api_key: 'KEY', format: 'json', api_sig: 'stale' }, SECRET),
  md5('api_keyKEY' + SECRET)
);

// The secret is appended, not prepended.
assert.notStrictEqual(lastfmSignature({ a: '1' }, SECRET), md5(SECRET + 'a1'));

// Batched scrobbles key on array indices; those sort as plain strings.
assert.strictEqual(
  lastfmSignature({ 'track[1]': 'B', 'track[0]': 'A' }, SECRET),
  md5('track[0]Atrack[1]B' + SECRET)
);

console.log('scrobbleSig: all assertions passed');
