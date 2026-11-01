// Last.fm keys its artist namespace on the literal string it receives, so a
// joined credit ("A, B, C") mints a new artist with no mbid and nothing rolls
// up. These assert on the serialized body; the intermediate object was always
// fine, the join at the boundary was the bug.
// Run: node src/main/utils/test_scrobblePayload.js
const assert = require('assert');

const { primaryArtist, audioscrobblerParams, listenBrainzBody } = require('./scrobblePayload');

const body = (tracks, nowPlaying) =>
  new URLSearchParams(audioscrobblerParams(tracks, nowPlaying, 'SK'));

const scrobbleArtist = track => body([{ timestamp: 1, ...track }], false).get('artist[0]');

assert.strictEqual(
  scrobbleArtist({ track: 'Song A', artists: ['Main Artist', 'Guest Artist'] }),
  'Main Artist'
);

// Names a delimiter-based splitter mangles. One artist row means one artist.
assert.strictEqual(
  scrobbleArtist({ track: 'Song B', artists: ['Alpha, The Band'] }),
  'Alpha, The Band'
);
assert.strictEqual(scrobbleArtist({ track: 'Song C', artists: ['Alpha & Beta'] }), 'Alpha & Beta');
assert.strictEqual(scrobbleArtist({ track: 'Song D', artists: ['AC/DC'] }), 'AC/DC');
assert.strictEqual(scrobbleArtist({ track: 'Song E', artists: ['Echo O)))'] }), 'Echo O)))');

assert.strictEqual(scrobbleArtist({ track: 'B', artists: [], artistRaw: 'Raw Artist' }), 'Raw Artist');

assert.strictEqual(scrobbleArtist({ track: 'B', artists: ['  ', 'Real Name'] }), 'Real Name');

// scrobblerNowPlaying and scrobbleTrack both gate on this, so an empty artist
// is never sent as "" or "null".
for (const empty of [{}, { artists: [] }, { artists: ['', '  '], artistRaw: '   ' }]) {
  assert.strictEqual(primaryArtist(empty), '', JSON.stringify(empty));
}

// "Various Artists" as an album artist fragments a real artist one level up.
for (const albumArtist of ['Various Artists', 'various', '  VARIOUS ARTISTS  ']) {
  const params = body([{ track: 'T', artists: ['A'], timestamp: 1, albumArtist }], false);
  assert.strictEqual(params.has('albumArtist[0]'), false, albumArtist);
}
assert.strictEqual(
  body([{ track: 'T', artists: ['A'], timestamp: 1, albumArtist: 'Album Artist' }], false).get(
    'albumArtist[0]'
  ),
  'Album Artist'
);

// If these disagree, one links to the right artist and the other mints a new
// one. It is the regression that keeps coming back.
const track = {
  track: 'Song F',
  artists: ['Main Artist', 'Guest Artist'],
  artistRaw: 'Main Artist, Guest Artist',
  album: 'Test Album',
  duration: 337.4,
  timestamp: 1700000000,
};
assert.strictEqual(body([track], true).get('artist'), body([track], false).get('artist[0]'));
assert.strictEqual(body([track], true).get('track'), body([track], false).get('track[0]'));
assert.strictEqual(body([track], true).get('album'), body([track], false).get('album[0]'));
assert.strictEqual(body([track], true).get('duration'), '337');
assert.strictEqual(body([track], false).get('timestamp[0]'), '1700000000');
assert.strictEqual(body([track], true).get('method'), 'track.updateNowPlaying');
assert.strictEqual(body([track], false).get('method'), 'track.scrobble');

// Now-playing takes one track even when handed a batch.
assert.strictEqual(body([track, { track: 'X', artists: ['Y'] }], true).has('artist[1]'), false);

// ListenBrainz has room for the whole credit, so it must NOT be collapsed.
const lb = listenBrainzBody([track], false).payload[0];
assert.strictEqual(lb.track_metadata.artist_name, 'Main Artist, Guest Artist');
assert.deepStrictEqual(lb.track_metadata.additional_info.artist_names, [
  'Main Artist',
  'Guest Artist',
]);
assert.strictEqual(lb.listened_at, 1700000000);
assert.strictEqual(lb.track_metadata.additional_info.duration_ms, 337400);
// A single credited artist adds nothing, so the field is omitted.
assert.strictEqual(
  'artist_names' in
    listenBrainzBody([{ track: 'T', artists: ['A'], artistRaw: 'A' }], true).payload[0]
      .track_metadata.additional_info,
  false
);
assert.strictEqual(
  'listened_at' in listenBrainzBody([track], true).payload[0],
  false,
  'playing_now carries no timestamp'
);

console.log('scrobblePayload: all assertions passed');
