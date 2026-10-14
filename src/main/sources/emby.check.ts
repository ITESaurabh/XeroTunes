/**
 * Self-check: run with `node src/main/sources/emby.check.ts`.
 *
 * emby.ts is a Flavour over jellyfin.ts, so this checks both: what is worth
 * checking is mostly where they differ. The `/emby` prefix, the user-scoped
 * library path, and the SHA1 password an older build wants. Set EMBY_URL /
 * EMBY_USER / EMBY_PASS (per docs/test-servers.md) to also run against a real
 * server.
 */
import assert from 'node:assert';
import crypto from 'node:crypto';
import http from 'node:http';
import { embyProvider } from './emby.ts';
import {
  jellyfinProvider,
  resolveBaseUrl,
  toRemoteTrack,
  type JellyfinAudioItem,
} from './jellyfin.ts';

// ── Parsing one item ─────────────────────────────────────────────────────────

// Shaped like an Emby /Items row: the entity arrays Jellyfin fills in are empty
// here, which is the case that silently drops the artist if only they are read.
const ITEM: JellyfinAudioItem = {
  Id: 'it-1',
  Name: 'Первый трек',
  Album: 'Пробный альбом',
  AlbumId: 'al-1',
  AlbumArtist: 'Artist & Other',
  Artists: ['Artist & Other'],
  ArtistItems: [],
  AlbumArtists: [],
  Genres: ['Test'],
  IndexNumber: 1,
  ParentIndexNumber: 1,
  ProductionYear: 2024,
  RunTimeTicks: 150_000_000,
  Path: 'D:\\TEMP\\XeroTestMusic\\Artist & Other\\Пробный альбом\\01 - Первый трек.flac',
  Container: 'flac',
  ImageTags: { Primary: 'abc123' },
  AlbumPrimaryImageTag: 'def456',
};

const track = toRemoteTrack(ITEM);
assert.strictEqual(track.remoteId, 'it-1');
assert.deepStrictEqual(track.artists, ['Artist & Other']);
assert.deepStrictEqual(track.albumArtists, ['Artist & Other']);
assert.strictEqual(track.durationSec, 15);
assert.strictEqual(track.path, ITEM.Path);
// The track's own cover wins over the album's, which on both servers can belong
// to a folder holding several albums.
assert.strictEqual(track.artKey, 'item:it-1:abc123');
assert.strictEqual(toRemoteTrack({ ...ITEM, ImageTags: {} }).artKey, 'item:al-1:def456');
assert.strictEqual(
  toRemoteTrack({ ...ITEM, ImageTags: {}, AlbumPrimaryImageTag: null }).artKey,
  null
);
// Metadata comes from the server's library, never from a file we opened.
assert.strictEqual(embyProvider.readsFileTags, undefined);
assert.strictEqual(embyProvider.scheme, 'emby');

// ── The URLs handed to <audio> and <img> ─────────────────────────────────────

const credentials = {
  baseUrl: 'http://box.lan:8096/emby',
  username: 'alice',
  userId: 'u1',
  accessToken: 'tok',
  deviceId: 'dev1',
  config: {},
};

const stream = new URL(embyProvider.streamUrl(credentials, 'it-1'));
assert.strictEqual(stream.pathname, '/emby/Audio/it-1/universal');
assert.strictEqual(stream.searchParams.get('api_key'), 'tok');
// Emby's /universal picks the transcoding profile from the user.
assert.strictEqual(stream.searchParams.get('UserId'), 'u1');
assert.strictEqual(stream.searchParams.get('AudioCodec'), 'mp3');
assert.strictEqual(stream.searchParams.get('TranscodingContainer'), 'mp3');

const art = new URL(embyProvider.artUrl(credentials, track) as string);
assert.strictEqual(art.pathname, '/emby/Items/it-1/Images/Primary');
assert.strictEqual(art.searchParams.get('tag'), 'abc123');
assert.strictEqual(art.searchParams.get('api_key'), 'tok');
assert.strictEqual(embyProvider.artUrl(credentials, { ...track, artKey: null }), null);

// The original bytes, tags intact; /universal would hand over a re-muxed copy.
assert.ok(embyProvider.downloadUrl(credentials, 'it-1').includes('/Items/it-1/Download'));

// ── Against a fake server ────────────────────────────────────────────────────

const sha1 = (s: string) => crypto.createHash('sha1').update(s).digest('hex');

/** Serve the API under /emby only, the way a reverse-proxied Emby does. */
let embyOnly = true;
const paths: string[] = [];

const readBody = (req: http.IncomingMessage): Promise<string> =>
  new Promise(resolve => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => resolve(body));
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url as string, 'http://x');
  paths.push(url.pathname);
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (embyOnly && !url.pathname.startsWith('/emby')) return send(404, {});
  const route = embyOnly ? url.pathname.slice('/emby'.length) : url.pathname;

  if (route === '/System/Info/Public') return send(200, { ServerName: 'Test Emby' });

  if (route === '/Users/AuthenticateByName') {
    const body = JSON.parse(await readBody(req));
    // An older build ignores Pw entirely, so a first attempt without the SHA1
    // is refused however right the password is.
    if (body.Password !== sha1('hunter2')) return send(401, {});
    return send(200, { AccessToken: 'tok', User: { Id: 'u1', Name: 'alice' }, ServerId: 's1' });
  }

  if (!(req.headers.authorization ?? '').includes('Token="tok"')) return send(401, {});

  if (route === '/Users/u1/Items' || route === '/Items') {
    return send(200, { Items: [ITEM], TotalRecordCount: 1 });
  }
  if (route === '/Users/u1/Items/it-1' || route === '/Items/it-1') {
    return send(200, {
      MediaSources: [
        {
          Size: 4096,
          Container: 'flac',
          Path: ITEM.Path,
          MediaStreams: [{ Type: 'Audio', Codec: 'flac', BitRate: 900000, SampleRate: 44100, Channels: 2 }],
        },
      ],
    });
  }
  return send(404, {});
});

await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const host = `127.0.0.1:${(server.address() as { port: number }).port}`;

assert.strictEqual(await resolveBaseUrl(`http://${host}/`), `http://${host}/emby`);

const connected = await embyProvider.connect({
  baseUrl: `http://${host}`,
  username: 'alice',
  password: 'hunter2',
});
assert.strictEqual(connected.displayName, 'Test Emby');
assert.strictEqual(connected.credentials.baseUrl, `http://${host}/emby`);
assert.strictEqual(connected.credentials.userId, 'u1');

const found = await embyProvider.listTracks(connected.credentials);
assert.strictEqual(found.length, 1);
assert.strictEqual(found[0].title, 'Первый трек');
// Emby scopes the library under the user; a flat /Items is Jellyfin's shape.
assert.ok(paths.includes('/emby/Users/u1/Items'), paths.join('\n'));

const details = await embyProvider.details?.(connected.credentials, 'it-1');
assert.strictEqual(details?.codec, 'flac');
assert.strictEqual(details?.size, 4096);

assert.deepStrictEqual(await embyProvider.ping?.(connected.credentials), {
  reachable: true,
  authValid: true,
});
// Reachable with a dead token is a password to re-enter, not a server to start.
assert.deepStrictEqual(
  await embyProvider.ping?.({ ...connected.credentials, accessToken: 'stale' }),
  { reachable: true, authValid: false }
);

// A wrong password is still a wrong password once the SHA1 retry has run.
await assert.rejects(
  () => embyProvider.connect({ baseUrl: `http://${host}`, username: 'alice', password: 'nope' }),
  /Authentication failed \(401\)/
);

// Same server at the root: the Jellyfin flavour asks for the flat listing.
embyOnly = false;
paths.length = 0;
const jf = await jellyfinProvider.connect({
  baseUrl: `http://${host}`,
  username: 'alice',
  password: 'hunter2',
});
assert.strictEqual(jf.credentials.baseUrl, `http://${host}`);
await jellyfinProvider.listTracks(jf.credentials);
assert.ok(paths.includes('/Items'), paths.join('\n'));

server.close();
server.closeAllConnections();

// Nothing listening at all.
assert.deepStrictEqual(await embyProvider.ping?.(connected.credentials), {
  reachable: false,
  authValid: false,
});

// ── Against a real server ────────────────────────────────────────────────────

if (process.env.EMBY_URL) {
  const live = await embyProvider.connect({
    baseUrl: process.env.EMBY_URL,
    username: process.env.EMBY_USER,
    password: process.env.EMBY_PASS,
  });
  console.log('live emby:', live.displayName, live.credentials.baseUrl);

  const tracks = await embyProvider.listTracks(live.credentials);
  assert.ok(tracks.length, 'no tracks — has the server scanned the library yet?');
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
  console.log(`live emby: ${tracks.length} tracks, e.g.`, tracks[0]);

  // A 200 with the file's first bytes: the URL <audio> is handed actually works.
  const head = await fetch(embyProvider.streamUrl(live.credentials, tracks[0].remoteId), {
    headers: { Range: 'bytes=0-1023' },
  });
  assert.ok(head.ok, `stream URL answered ${head.status}`);
  console.log('live emby stream:', head.status, head.headers.get('content-type'));

  const cover = await fetch(embyProvider.artUrl(live.credentials, withArt) as string);
  assert.ok(cover.ok, `art URL answered ${cover.status}`);
  console.log('live emby art:', cover.status, cover.headers.get('content-type'));

  assert.deepStrictEqual(await embyProvider.ping?.(live.credentials), {
    reachable: true,
    authValid: true,
  });
}

console.log('emby.check.ts OK');
