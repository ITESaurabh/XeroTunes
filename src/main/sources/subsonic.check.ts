/**
 * Self-check: run with `node src/main/sources/subsonic.check.ts`.
 *
 * Covers both flavours, since what is worth checking is mostly where they
 * differ. Set SUBSONIC_URL / SUBSONIC_USER / SUBSONIC_PASS (Navidrome, per
 * docs/test-servers.md) or NEXTCLOUD_URL / NEXTCLOUD_USER / NEXTCLOUD_PASS (the
 * password from Settings → Music, not the account's) to also run against a real
 * server.
 */
import assert from 'node:assert';
import crypto from 'node:crypto';
import http from 'node:http';
import {
  nextcloudProvider,
  subsonicProvider,
  toLrc,
  toRemoteTrack,
  withScheme,
} from './subsonic.ts';

// ── The endpoint URL, from whatever the user typed ───────────────────────────

// A LAN server is likelier to be http, a hosted Nextcloud https.
assert.strictEqual(withScheme('localhost:4533', 'http'), 'http://localhost:4533');
assert.strictEqual(withScheme('  cloud.example.com/  ', 'https'), 'https://cloud.example.com');
assert.strictEqual(withScheme('http://box.lan/', 'https'), 'http://box.lan');

const nextcloudEndpoint = 'https://cloud.example.com/index.php/apps/music/subsonic';

const credentialsFor = (baseUrl: string) => ({
  baseUrl,
  username: 'alice',
  userId: null,
  accessToken: 'pw',
  deviceId: null,
  config: {},
});

assert.ok(
  nextcloudProvider.streamUrl(credentialsFor(nextcloudEndpoint), 's-1').startsWith(
    `${nextcloudEndpoint}/rest/stream?`
  )
);

// ── Auth, which is the whole difference between the two ──────────────────────

const subsonicStream = new URL(subsonicProvider.streamUrl(credentialsFor('http://box.lan'), 's-1'));
// The protocol's token: md5 of the password and a per-request salt, never the
// password itself.
const salt = subsonicStream.searchParams.get('s') as string;
assert.ok(salt && salt.length >= 8);
assert.strictEqual(
  subsonicStream.searchParams.get('t'),
  crypto.createHash('md5').update(`pw${salt}`).digest('hex')
);
assert.strictEqual(subsonicStream.searchParams.get('p'), null);
// Navidrome would otherwise transcode a FLAC to the user's preferred format.
assert.strictEqual(subsonicStream.searchParams.get('format'), 'raw');
// A second call re-salts, so the token is not a fixed string in the URLs.
assert.notStrictEqual(
  new URL(subsonicProvider.streamUrl(credentialsFor('http://box.lan'), 's-1')).searchParams.get('t'),
  subsonicStream.searchParams.get('t')
);

const nextcloudStream = new URL(
  nextcloudProvider.streamUrl(credentialsFor(nextcloudEndpoint), 's-1')
);
// Nextcloud stores the password hashed, so the token scheme has nothing to
// verify and the plain parameter is the only thing that works.
assert.strictEqual(nextcloudStream.searchParams.get('p'), 'pw');
assert.strictEqual(nextcloudStream.searchParams.get('t'), null);
// It doesn't transcode, so there is nothing to switch off.
assert.strictEqual(nextcloudStream.searchParams.get('format'), null);

// ── Field mapping ────────────────────────────────────────────────────────────

const album = {
  id: 'al-1',
  name: 'First Light',
  artist: 'Test Alpha',
  year: 2024,
  coverArt: 'al-1',
};
const track = toRemoteTrack(
  {
    id: 's-1',
    title: 'Track 1',
    artist: 'Test Alpha & Other',
    track: 1,
    duration: 95,
    suffix: 'flac',
    path: 'Test Alpha/First Light/01 - Track 1.flac',
    created: '2026-09-01T16:30:42+00:00',
  },
  album
);
// The credit stays whole: sync.ts splits it under the user's own rules.
assert.deepStrictEqual(track.artists, ['Test Alpha & Other']);
assert.deepStrictEqual(track.albumArtists, ['Test Alpha']);
// The song carries no album, year or cover of its own, so the album's stand in.
assert.strictEqual(track.album, 'First Light');
assert.strictEqual(track.year, 2024);
assert.strictEqual(track.artKey, 'al-1');
assert.strictEqual(track.durationSec, 95);

// A song with nothing but an id still has to come back playable and named.
const bare = toRemoteTrack({ id: 's-2' });
assert.strictEqual(bare.title, 's-2');
assert.deepStrictEqual([bare.artists, bare.albumArtists, bare.genres], [[], [], []]);

assert.strictEqual(
  toLrc({ line: [{ start: 0, value: 'one' }, { start: 61230, value: 'two' }] }),
  '[00:00.00]one\n[01:01.23]two'
);
// Unsynced lyrics are still lyrics; the view shows them without a timeline.
assert.strictEqual(toLrc({ line: [{ value: 'one' }] }), 'one');
assert.strictEqual(toLrc({ line: [] }), null);
assert.strictEqual(toLrc(undefined), null);

// ── Against a stub server ────────────────────────────────────────────────────

const SONGS = [
  { id: 's-1', title: 'Track 1', artist: 'Test Alpha', track: 1, suffix: 'mp3', bitRate: 320 },
  { id: 's-2', title: 'Track 2', artist: 'Test Alpha', track: 2, suffix: 'mp3', bitRate: 320 },
];
const paths: string[] = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = url.pathname.split('/').pop();
  paths.push(url.pathname);
  const params = url.searchParams;
  const ok = (payload: object) =>
    JSON.stringify({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...payload } });

  res.writeHead(200, { 'Content-Type': 'application/json' });

  // Either scheme, checked the way a real server would: the plain password, or
  // the token that password and the request's salt hash to. Written as a
  // positive test — `t !== expected` passes a request with neither, both being
  // null.
  const supplied = params.get('t');
  const expected = params.has('s')
    ? crypto.createHash('md5').update(`music-pw${params.get('s')}`).digest('hex')
    : null;
  const authenticated = params.get('p') === 'music-pw' || (!!supplied && supplied === expected);
  if (!authenticated) {
    res.end(
      JSON.stringify({
        'subsonic-response': {
          status: 'failed',
          error: { code: 40, message: 'Wrong username or password.' },
        },
      })
    );
    return;
  }
  if (method === 'ping') res.end(ok({}));
  else if (method === 'getAlbumList2')
    res.end(ok({ albumList2: { album: [{ ...album, songCount: 2 }] } }));
  else if (method === 'getAlbum') res.end(ok({ album: { ...album, song: SONGS } }));
  else if (method === 'getSong') res.end(ok({ song: { ...SONGS[0], size: 4096, path: 'a/b.mp3' } }));
  else res.end(ok({}));
});

await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address() as import('node:net').AddressInfo;
const host = `127.0.0.1:${port}`;

for (const [provider, expectedBase] of [
  [subsonicProvider, `http://${host}`],
  [nextcloudProvider, `http://${host}/index.php/apps/music/subsonic`],
] as const) {
  const { displayName, credentials } = await provider.connect({
    // http:// spelled out, since the Nextcloud flavour would otherwise assume https.
    baseUrl: `http://${host}`,
    username: 'alice',
    password: 'music-pw',
  });
  assert.strictEqual(displayName, host);
  assert.strictEqual(credentials.baseUrl, expectedBase);

  const progress: Array<[number, number]> = [];
  const tracks = await provider.listTracks(credentials, (loaded, total) =>
    progress.push([loaded, total])
  );
  assert.strictEqual(tracks.length, 2, provider.type);
  assert.strictEqual(tracks[0].remoteId, 's-1');
  // The bar counts tracks, using the album list's own songCount as the total.
  assert.deepStrictEqual(progress, [[2, 2]]);

  assert.ok(provider.artUrl(credentials, tracks[0])?.includes('getCoverArt'));

  const details = await provider.details?.(credentials, 's-1');
  // The protocol counts kbps and the info dialog divides by 1000.
  assert.strictEqual(details?.bitRate, 320000);
  assert.strictEqual(details?.size, 4096);

  assert.deepStrictEqual(await provider.ping?.(credentials), {
    reachable: true,
    authValid: true,
  });
  assert.deepStrictEqual(await provider.ping?.({ ...credentials, accessToken: 'nope' }), {
    reachable: true,
    authValid: false,
  });
}

// A refused password is a thing the user can fix, and each server has its own
// fix: a Nextcloud one is generated in the Music settings.
await assert.rejects(
  () => nextcloudProvider.connect({ baseUrl: `http://${host}`, username: 'a', password: 'nope' }),
  /Music settings/
);
await assert.rejects(
  () => subsonicProvider.connect({ baseUrl: `http://${host}`, username: 'a', password: 'nope' }),
  /check the username and password/
);

// The Nextcloud flavour has to reach the app, not the server root.
assert.ok(paths.some(p => p.startsWith('/index.php/apps/music/subsonic/rest/')), paths.join('\n'));
assert.ok(paths.some(p => p.startsWith('/rest/')), paths.join('\n'));

server.close();
server.closeAllConnections();

// Nothing listening at all.
assert.deepStrictEqual(await subsonicProvider.ping?.(credentialsFor(`http://${host}`)), {
  reachable: false,
  authValid: false,
});

// ── Against real servers ─────────────────────────────────────────────────────

for (const [label, provider, url, user, pass] of [
  ['subsonic', subsonicProvider, 'SUBSONIC_URL', 'SUBSONIC_USER', 'SUBSONIC_PASS'],
  ['nextcloud', nextcloudProvider, 'NEXTCLOUD_URL', 'NEXTCLOUD_USER', 'NEXTCLOUD_PASS'],
] as const) {
  if (!process.env[url]) continue;
  const live = await provider.connect({
    baseUrl: process.env[url] as string,
    username: process.env[user],
    password: process.env[pass],
  });
  const found = await provider.listTracks(live.credentials);
  assert.ok(found.length, `${label}: no tracks — has the server scanned yet?`);
  assert.ok(
    found.every(t => t.title && t.durationSec),
    `${label}: tracks came back without titles or durations`
  );
  assert.ok(
    found.some(t => t.artKey),
    `${label}: no cover art on any album`
  );
  console.log(`live ${label}: ${live.displayName}, ${found.length} tracks, e.g.`, found[0]);

  // A 200 with the file's first bytes: the URL <audio> is handed actually works.
  const head = await fetch(provider.streamUrl(live.credentials, found[0].remoteId), {
    headers: { Range: 'bytes=0-1023' },
  });
  assert.ok(head.ok, `${label}: stream URL answered ${head.status}`);
  console.log(`live ${label} stream:`, head.status, head.headers.get('content-type'));
}

console.log('subsonic.check.ts OK');
