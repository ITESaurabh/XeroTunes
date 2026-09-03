/**
 * Self-check: run with `node src/main/sources/plex.check.ts`.
 *
 * The plex.tv sign-in path is only exercised live, since its URL is fixed and
 * cannot be pointed at the fake server here. Set PLEX_URL and either PLEX_TOKEN
 * or PLEX_USER / PLEX_PASS (per docs/test-servers.md) to run against a real
 * server, which is the only thing that proves the stream URL.
 */
import assert from 'node:assert';
import http from 'node:http';
import {
  apiUrl,
  plexProvider,
  serverToken,
  splitRemoteId,
  toRemoteTrack,
  type PlexTrack,
} from './plex.ts';

// ── Parsing one track ────────────────────────────────────────────────────────

// Plex names a track's parent and grandparent rather than the thing itself, and
// files the year on the album. That indirection is most of what breaks.
const TRACK: PlexTrack = {
  ratingKey: 45,
  title: 'Первый трек',
  parentTitle: 'Пробный альбом',
  grandparentTitle: 'Artist & Other',
  index: 1,
  parentIndex: 1,
  parentYear: 2024,
  duration: 231000,
  thumb: '/library/metadata/45/thumb/1700000000',
  parentThumb: '/library/metadata/44/thumb/1700000001',
  Genre: [{ tag: 'Metal' }],
  Media: [
    {
      container: 'flac',
      bitrate: 900,
      audioChannels: 2,
      audioCodec: 'flac',
      Part: [
        {
          id: 77,
          key: '/library/parts/77/1700000000/file.flac',
          file: 'D:\\TEMP\\XeroTestMusic\\Artist & Other\\Пробный альбом\\01 - Первый трек.flac',
          size: 4096,
          container: 'flac',
          Stream: [{ streamType: 2, codec: 'flac', samplingRate: 44100, channels: 2 }],
        },
      ],
    },
  ],
};

const track = toRemoteTrack(TRACK);
// Playback and metadata are addressed by different ids, and streamUrl gets
// nothing but this string, so it carries both.
assert.strictEqual(track.remoteId, '45:77');
assert.deepStrictEqual(splitRemoteId('45:77'), { ratingKey: '45', partId: '77' });
// A track Plex lists with no file still gets a row; only playing it fails.
assert.strictEqual(toRemoteTrack({ ...TRACK, Media: [] }).remoteId, '45');
assert.deepStrictEqual(splitRemoteId('45'), { ratingKey: '45', partId: null });
assert.strictEqual(track.album, 'Пробный альбом');
assert.deepStrictEqual(track.albumArtists, ['Artist & Other']);
assert.strictEqual(track.durationSec, 231);
assert.strictEqual(track.container, 'flac');
assert.strictEqual(track.path, TRACK.Media?.[0].Part?.[0].file);
// The album's year, since Plex rarely puts one on the track.
assert.strictEqual(track.year, 2024);
assert.deepStrictEqual(track.genres, ['Metal']);
// The track's own cover, with the album's as the fallback.
assert.strictEqual(track.artKey, TRACK.thumb);
assert.strictEqual(toRemoteTrack({ ...TRACK, thumb: undefined }).artKey, TRACK.parentThumb);
assert.strictEqual(
  toRemoteTrack({ ...TRACK, thumb: undefined, parentThumb: undefined }).artKey,
  null
);

// originalTitle is the more specific artist wherever Plex bothered to set it.
assert.deepStrictEqual(toRemoteTrack({ ...TRACK, originalTitle: 'Guest' }).artists, ['Guest']);
assert.deepStrictEqual(track.artists, ['Artist & Other']);

// Metadata comes from the server's library, never from a file we opened.
assert.strictEqual(plexProvider.readsFileTags, undefined);
assert.strictEqual(plexProvider.tokenAuth, true);

// ── The URLs handed to <audio> and <img> ─────────────────────────────────────

const credentials = {
  baseUrl: 'http://box.lan:32400',
  username: null,
  userId: null,
  accessToken: 'tok',
  deviceId: 'dev1',
  config: {},
};

// The part id alone. Plex hands out `/library/parts/77/<analysed at>/file.mp3`
// and ignores everything after the id, which is what lets it live in a remoteId.
const stream = new URL(plexProvider.streamUrl(credentials, '45:77'));
assert.strictEqual(stream.pathname, '/library/parts/77');
assert.strictEqual(stream.searchParams.get('X-Plex-Token'), 'tok');
assert.strictEqual(
  new URL(plexProvider.downloadUrl(credentials, '45:77')).searchParams.get('download'),
  '1'
);
// Nothing to play, and a message naming the fix rather than a broken URL.
assert.throws(() => plexProvider.streamUrl(credentials, '45'), /re-sync the source/);

const art = new URL(plexProvider.artUrl(credentials, track) as string);
assert.strictEqual(art.pathname, TRACK.thumb);
assert.strictEqual(art.searchParams.get('X-Plex-Token'), 'tok');
assert.strictEqual(plexProvider.artUrl(credentials, { ...track, artKey: null }), null);

// On every URL, not just the fetches: <audio> and <img> cannot set headers.
assert.strictEqual(
  new URL(apiUrl(credentials, '/library/sections')).searchParams.get('X-Plex-Client-Identifier'),
  'dev1'
);

// A server that cannot be reached has no machineIdentifier to match against, so
// the account token stands and the server gets to refuse it in its own words.
// The matching path itself talks to plex.tv, so only the live run covers it.
assert.strictEqual(await serverToken('account-token', 'cid', 'http://127.0.0.1:1'), 'account-token');

// ── Against a fake server ────────────────────────────────────────────────────

const paths: string[] = [];
/** Flipped below to check the message an unclaimed server gets. */
let claimed = true;

const server = http.createServer((req, res) => {
  const url = new URL(req.url as string, 'http://x');
  paths.push(url.pathname + url.search);
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  // Unauthenticated on a default install, which is what splits "offline" from
  // "token expired".
  if (url.pathname === '/identity') {
    return send(200, { MediaContainer: { machineIdentifier: 'm1', claimed: claimed } });
  }

  if (url.searchParams.get('X-Plex-Token') !== 'tok') return send(401, {});

  if (url.pathname === '/') return send(200, { MediaContainer: { friendlyName: 'Test Plex' } });

  if (url.pathname === '/library/sections') {
    return send(200, {
      MediaContainer: {
        Directory: [
          { key: '1', type: 'movie', title: 'Films' },
          { key: '3', type: 'artist', title: 'Music' },
        ],
      },
    });
  }

  if (url.pathname === '/library/sections/3/all') {
    assert.strictEqual(url.searchParams.get('type'), '10');
    assert.strictEqual(url.searchParams.get('X-Plex-Container-Size'), '500');
    return send(200, { MediaContainer: { totalSize: 1, Metadata: [TRACK] } });
  }

  if (url.pathname === '/library/parts/77') {
    res.writeHead(206, { 'Content-Type': 'audio/mpeg' });
    return res.end('audio');
  }

  if (url.pathname === '/library/metadata/45') {
    return send(200, { MediaContainer: { Metadata: [TRACK] } });
  }
  return send(404, {});
});

await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const host = `127.0.0.1:${(server.address() as { port: number }).port}`;

const connected = await plexProvider.connect({ baseUrl: `http://${host}`, token: ' tok ' });
assert.strictEqual(connected.displayName, 'Test Plex');
assert.strictEqual(connected.credentials.accessToken, 'tok');
// Reused rather than regenerated, so Plex does not file a new device per sync.
assert.ok(connected.credentials.deviceId);

const found = await plexProvider.listTracks(connected.credentials);
assert.strictEqual(found.length, 1);
assert.strictEqual(found[0].title, 'Первый трек');
assert.strictEqual(found[0].remoteId, '45:77');
// Only the music section, and the film library is left alone.
assert.ok(!paths.some(p => p.startsWith('/library/sections/1/all')), paths.join('\n'));

const details = await plexProvider.details?.(connected.credentials, '45:77');
assert.strictEqual(details?.codec, 'flac');
assert.strictEqual(details?.sampleRate, 44100);
// Plex counts kbps and the info dialog divides by 1000.
assert.strictEqual(details?.bitRate, 900000);
assert.strictEqual(details?.size, 4096);

assert.deepStrictEqual(await plexProvider.ping?.(connected.credentials), {
  reachable: true,
  authValid: true,
});
// Reachable with a dead token is a token to re-enter, not a server to start.
assert.deepStrictEqual(
  await plexProvider.ping?.({ ...connected.credentials, accessToken: 'stale' }),
  { reachable: true, authValid: false }
);

// A token the server refuses is the user's to fix, and says so.
await assert.rejects(
  () => plexProvider.connect({ baseUrl: `http://${host}`, token: 'nope' }),
  /refused by this server/
);
// Unclaimed is a different fix: no token of any kind works until it is claimed,
// and the server admits that without being asked.
claimed = false;
await assert.rejects(
  () => plexProvider.connect({ baseUrl: `http://${host}`, token: 'nope' }),
  /has not been claimed/
);
claimed = true;
// Neither a token nor a sign-in is a filled-in form, not a failed request.
await assert.rejects(
  () => plexProvider.connect({ baseUrl: `http://${host}` }),
  /Paste a Plex token/
);

server.close();
server.closeAllConnections();

// Nothing listening at all.
assert.deepStrictEqual(await plexProvider.ping?.(connected.credentials), {
  reachable: false,
  authValid: false,
});

// ── Against a real server ────────────────────────────────────────────────────

if (process.env.PLEX_URL) {
  const live = await plexProvider.connect({
    baseUrl: process.env.PLEX_URL,
    token: process.env.PLEX_TOKEN,
    username: process.env.PLEX_USER,
    password: process.env.PLEX_PASS,
  });
  console.log('live plex:', live.displayName);

  const tracks = await plexProvider.listTracks(live.credentials);
  assert.ok(tracks.length, 'no tracks, has the server scanned the library yet?');
  assert.ok(
    tracks.every(t => t.title && t.durationSec),
    'tracks came back without titles or durations'
  );
  assert.ok(
    tracks.some(t => t.artists.length),
    'no artist on any track'
  );
  assert.ok(
    tracks.some(t => t.path),
    'no server paths, so the folder tree would be empty'
  );
  const withArt = tracks.find(t => t.artKey);
  assert.ok(withArt, 'no cover art on any track');
  console.log(`live plex: ${tracks.length} tracks, e.g.`, tracks[0]);

  // The whole point of the universal route: a ranged request has to come back
  // with the file's own bytes, or nothing in this library plays.
  const head = await fetch(plexProvider.streamUrl(live.credentials, tracks[0].remoteId), {
    headers: { Range: 'bytes=0-1023' },
  });
  assert.ok(head.ok, `stream URL answered ${head.status}`);
  console.log('live plex stream:', head.status, head.headers.get('content-type'));

  const cover = await fetch(plexProvider.artUrl(live.credentials, withArt) as string);
  assert.ok(cover.ok, `art URL answered ${cover.status}`);
  console.log('live plex art:', cover.status, cover.headers.get('content-type'));

  console.log('live plex details:', await plexProvider.details?.(live.credentials, tracks[0].remoteId));

  assert.deepStrictEqual(await plexProvider.ping?.(live.credentials), {
    reachable: true,
    authValid: true,
  });
}

console.log('plex.check.ts OK');
