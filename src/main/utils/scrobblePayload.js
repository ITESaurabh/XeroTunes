/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Wire payloads for the two scrobble protocols, kept out of Scrobbler.ts so the
 * serialized body can be asserted on without an Electron runtime.
 *
 * The two builders must not share an artist accessor. Last.fm keys its artist
 * namespace on the literal string it receives, so a joined credit ("A, B, C")
 * mints a new artist with no mbid; ListenBrainz has room for the full credit
 * and loses it if collapsed.
 */

/** Last.fm only; ListenBrainz sends the full credit instead. */
function primaryArtist(track) {
  const first = (track.artists || []).map(n => (n || '').trim()).find(Boolean);
  return first || (track.artistRaw || track.artist || '').trim();
}

/** These are catalogue placeholders, not artists; sending one fragments a real one. */
function isVariousArtists(name) {
  const n = (name || '').trim().toLowerCase();
  return n === 'various artists' || n === 'various';
}

/**
 * AudioScrobbler 2.0 params, unsigned. Both methods run through here so
 * `track.updateNowPlaying` and `track.scrobble` can never disagree on artist.
 */
function audioscrobblerParams(tracks, nowPlaying, sessionKey) {
  const params = { sk: sessionKey };
  const put = (name, index, value) => {
    params[nowPlaying ? name : `${name}[${index}]`] = value;
  };
  const list = nowPlaying ? tracks.slice(0, 1) : tracks;

  params.method = nowPlaying ? 'track.updateNowPlaying' : 'track.scrobble';
  list.forEach((t, i) => {
    put('artist', i, primaryArtist(t));
    put('track', i, t.track);
    if (!nowPlaying) put('timestamp', i, String(t.timestamp));
    if (t.album) put('album', i, t.album);
    if (t.duration) put('duration', i, String(Math.round(t.duration)));
    if (t.albumArtist && !isVariousArtists(t.albumArtist)) put('albumArtist', i, t.albumArtist);
  });
  return params;
}

/** ListenBrainz submit-listens body. */
function listenBrainzBody(tracks, nowPlaying) {
  return {
    listen_type: nowPlaying ? 'playing_now' : tracks.length > 1 ? 'import' : 'single',
    payload: tracks.map(t => ({
      ...(nowPlaying ? {} : { listened_at: t.timestamp }),
      track_metadata: {
        artist_name: (t.artistRaw || t.artist || '').trim(),
        track_name: t.track,
        ...(t.album ? { release_name: t.album } : {}),
        additional_info: {
          media_player: 'XeroTunes',
          ...(t.artists && t.artists.length > 1 ? { artist_names: t.artists } : {}),
          ...(t.duration ? { duration_ms: Math.round(t.duration * 1000) } : {}),
        },
      },
    })),
  };
}

module.exports = { primaryArtist, isVariousArtists, audioscrobblerParams, listenBrainzBody };
