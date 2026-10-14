/**
 * Self-check: run with `node src/main/sources/webdav.check.ts`.
 *
 * Set WEBDAV_URL (plus WEBDAV_USER / WEBDAV_PASS) to also run the whole
 * provider against a real share, per docs/test-servers.md.
 */
import assert from 'node:assert';
import http from 'node:http';
import { parsePropfind, pathMetadata, stampOf, webdavProvider } from './webdav.ts';

// Trimmed from a real PROPFIND response, with the prefixes swapped around: a
// server is free to name the DAV namespace whatever it likes,
// and the parser has to survive that.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">
 <D:response><D:href>/music/</D:href><D:propstat><D:prop>
   <D:resourcetype><D:collection xmlns:D="DAV:"/></D:resourcetype>
 </D:prop></D:propstat></D:response>
 <D:response><D:href>/music/Test%20Alpha/</D:href><D:propstat><D:prop>
   <D:getlastmodified>Tue, 01 Sep 2026 16:30:41 GMT</D:getlastmodified>
   <D:resourcetype><D:collection/></D:resourcetype>
 </D:prop></D:propstat></D:response>
 <lp1:response xmlns:lp1="DAV:"><lp1:href>/music/01%20-%20Track%201.mp3</lp1:href><lp1:propstat><lp1:prop>
   <lp1:resourcetype/>
   <lp1:getcontentlength>131072</lp1:getcontentlength>
   <lp1:getlastmodified>Tue, 01 Sep 2026 16:30:42 GMT</lp1:getlastmodified>
 </lp1:prop></lp1:propstat></lp1:response>
</D:multistatus>`;

const entries = parsePropfind(XML, new URL('http://localhost:8081/music/'));
assert.strictEqual(entries.length, 3);
// The folder itself comes back as the first entry; the walk drops it by path.
assert.deepStrictEqual(entries[0], {
  path: '',
  isDir: true,
  size: null,
  modified: null,
  etag: null,
});
assert.strictEqual(entries[1].path, 'Test Alpha');
assert.strictEqual(entries[1].isDir, true);
assert.strictEqual(entries[2].path, '01 - Track 1.mp3');
assert.strictEqual(entries[2].isDir, false);
assert.strictEqual(entries[2].size, 131072);
// The etag is the better stamp where a server has one; mtime and size stand in.
assert.strictEqual(stampOf(entries[2]), `${entries[2].modified}:131072`);
assert.ok((entries[2].modified as number) > 0);

// An absolute href, which some servers return instead of a path.
const absolute = parsePropfind(
  '<d:multistatus xmlns:d="DAV:"><d:response><d:href>http://host/dav/a%20b/x.mp3</d:href>' +
    '<d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response></d:multistatus>',
  new URL('http://host/dav/')
);
assert.strictEqual(absolute[0].path, 'a b/x.mp3');

// ── Path fallback, for files whose tags we can't read ────────────────────────

assert.deepStrictEqual(pathMetadata('Test Alpha/First Light/01 - Track 1.mp3'), {
  title: 'Track 1',
  album: 'First Light',
  artist: 'Test Alpha',
  trackNumber: 1,
});
assert.deepStrictEqual(pathMetadata('loose.mp3'), {
  title: 'loose',
  album: null,
  artist: null,
  trackNumber: null,
});
// A leading number is only a track number when something follows it.
assert.strictEqual(pathMetadata('Album/1984.flac').title, '1984');

// ── A server that ignores Range ──────────────────────────────────────────────
// It answers 200 with the whole file. Reading all of that is what timed a big
// track out mid-sync, so the tag read has to hang up after the head of it.

const FILE_BYTES = 8 * 1024 * 1024;
let served = 0;

const BAD_TOKEN = Buffer.from('bad:bad').toString('base64');

const server = http.createServer((req, res) => {
  if ((req.headers.authorization ?? '').includes(BAD_TOKEN)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="test"' });
    res.end();
    return;
  }
  if (req.method === 'PROPFIND') {
    res.writeHead(207, { 'Content-Type': 'application/xml' });
    res.end(
      '<D:multistatus xmlns:D="DAV:">' +
        '<D:response><D:href>/</D:href><D:propstat><D:prop>' +
        '<D:resourcetype><D:collection/></D:resourcetype>' +
        '</D:prop></D:propstat></D:response>' +
        '<D:response><D:href>/big.mp3</D:href><D:propstat><D:prop><D:resourcetype/>' +
        `<D:getcontentlength>${FILE_BYTES}</D:getcontentlength>` +
        '</D:prop></D:propstat></D:response>' +
        '</D:multistatus>'
    );
    return;
  }
  res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(FILE_BYTES) });
  const chunk = Buffer.alloc(64 * 1024);
  let open = true;
  res.on('close', () => (open = false));
  res.on('error', () => (open = false));
  const pump = () => {
    while (open && served < FILE_BYTES) {
      served += chunk.length;
      if (!res.write(chunk)) {
        res.once('drain', pump);
        return;
      }
    }
    if (open) res.end();
  };
  pump();
});

await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address() as import('node:net').AddressInfo;
const local = await webdavProvider.connect({ baseUrl: `http://127.0.0.1:${port}` });
const [onlyTrack] = await webdavProvider.listTracks(local.credentials);

// A server that answers at all is reachable; a refusal is a password to
// re-enter, which is a different thing for the user to fix.
assert.deepStrictEqual(await webdavProvider.ping?.(local.credentials), {
  reachable: true,
  authValid: true,
});
assert.deepStrictEqual(
  await webdavProvider.ping?.({ ...local.credentials, accessToken: BAD_TOKEN }),
  { reachable: true, authValid: false }
);

server.close();
server.closeAllConnections();

// Nothing listening at all.
assert.deepStrictEqual(await webdavProvider.ping?.(local.credentials), {
  reachable: false,
  authValid: false,
});

// Zeros hold no tags, so the track falls back to its path. That it came back at
// all, and cheaply, is the point.
assert.strictEqual(onlyTrack.title, 'big');
assert.ok(served < 3 * 1024 * 1024, `pulled ${served} bytes of an ${FILE_BYTES}-byte file`);

// ── Against a real share ─────────────────────────────────────────────────────

if (process.env.WEBDAV_URL) {
  const { credentials } = await webdavProvider.connect({
    baseUrl: process.env.WEBDAV_URL,
    username: process.env.WEBDAV_USER,
    password: process.env.WEBDAV_PASS,
  });
  const tracks = await webdavProvider.listTracks(credentials);
  assert.ok(tracks.length, 'no tracks found on the share');
  // Tags, not filenames: the title has to differ from the stem it would fall
  // back to, and a duration can only have come out of the file.
  const tagged = tracks.filter(t => t.durationSec && t.album && t.artists.length);
  assert.ok(tagged.length === tracks.length, `${tracks.length - tagged.length} tracks lost tags`);
  assert.ok(
    tracks.some(t => t.artKey),
    'no cover art found'
  );
  console.log(`live: ${tracks.length} tracks, e.g.`, tracks[0]);

  // Every track carries what the file looked like, so the next sync can tell
  // which ones are worth opening again.
  assert.ok(tracks.every(t => t.stamp));
  const known = new Map(tracks.map(t => [t.remoteId, t.stamp as string]));
  const resync = await webdavProvider.listTracks(credentials, undefined, known);
  assert.ok(
    resync.every(t => t.unchanged),
    're-sync opened files it had already read'
  );

  // onPlay walks the share and opens nothing: tracks arrive named after their
  // paths, and readTrack fills one in when it plays.
  const lazy = { ...credentials, config: { metadata: 'onPlay' } };
  const listed = await webdavProvider.listTracks(lazy);
  assert.strictEqual(listed.length, tracks.length);
  assert.ok(
    listed.every(t => t.untagged && t.stamp && !t.durationSec),
    'onPlay read tags it was told not to'
  );
  const filled = await webdavProvider.readTrack?.(lazy, listed[0].remoteId);
  assert.ok(filled && !filled.untagged, 'readTrack came back without tags');
  assert.strictEqual(filled.remoteId, listed[0].remoteId);
  assert.ok(filled.durationSec && filled.album && filled.artists.length);
  console.log(
    'onPlay fill-in:',
    filled.title,
    '|',
    filled.artists.join(';'),
    '| art:',
    filled.artKey
  );
}

console.log('webdav.check.ts OK');
