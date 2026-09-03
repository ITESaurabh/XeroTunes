/**
 * Self-check: run with `node src/main/sources/upnp.check.ts`.
 *
 * The DIDL sample below has the shape of a real Browse response with the
 * metadata replaced: one item from a server that fills in the music fields and
 * one from a server that doesn't, since telling those apart is most of what this
 * provider does. Set UPNP_URL (per docs/test-servers.md) to also walk a live
 * server.
 */
import assert from 'node:assert';
import {
  describe,
  durationSeconds,
  parseDidlItems,
  routableUrl,
  trailMetadata,
  unescapeXml,
  upnpProvider,
  withScheme,
} from './upnp.ts';

// ── Address handling ─────────────────────────────────────────────────────────

// A DLNA server is on a LAN, so a bare host means http, not https.
assert.strictEqual(withScheme('192.168.1.5:8200'), 'http://192.168.1.5:8200');
assert.strictEqual(withScheme(' http://nas.lan/rootDesc.xml '), 'http://nas.lan/rootDesc.xml');
// Typing the address a server prints when it binds. Windows connects to it, so
// the sync succeeds and every track it stores is unplayable.
assert.strictEqual(withScheme('0.0.0.0:7879'), 'http://127.0.0.1:7879');

// res URLs get the same treatment, so a source stored before this fixes itself
// on the next sync rather than needing to be added again.
assert.strictEqual(
  routableUrl('http://0.0.0.0:7879/r/A/01.mp3', 'http://127.0.0.1:7879/ctl'),
  'http://127.0.0.1:7879/r/A/01.mp3'
);
// A server on the LAN knows its own address; only bind-all gets overridden.
assert.strictEqual(
  routableUrl('http://192.168.1.5:8200/media/1.mp3', 'http://127.0.0.1:7879/ctl'),
  'http://192.168.1.5:8200/media/1.mp3'
);

// ── The bits of XML this provider reads by hand ──────────────────────────────

assert.strictEqual(unescapeXml('&lt;res&gt;'), '<res>');
// The payload is escaped twice on the way out of <Result>; unescaping once has
// to leave the inner escaping alone rather than forming a tag out of it.
assert.strictEqual(unescapeXml('&amp;lt;item&amp;gt;'), '&lt;item&gt;');

assert.strictEqual(durationSeconds('0:03:45.000'), 225);
assert.strictEqual(durationSeconds('03:45'), 225);
assert.strictEqual(durationSeconds(null), null);
assert.strictEqual(durationSeconds('not a duration'), null);

const DIDL = `<DIDL-Lite>
<item id="64" parentID="1" restricted="1">
  <upnp:class>object.item.audioItem.musicTrack</upnp:class>
  <dc:title>Track 7</dc:title>
  <upnp:artist role="AlbumArtist">Test Alpha</upnp:artist>
  <upnp:album>Second Light</upnp:album>
  <upnp:genre>Rock &amp; Roll</upnp:genre>
  <upnp:originalTrackNumber>1</upnp:originalTrackNumber>
  <dc:date>2026-01-01</dc:date>
  <upnp:albumArtURI>http://nas.lan/art/64.jpg</upnp:albumArtURI>
  <res protocolInfo="http-get:*:audio/mpeg:*" size="10592476" duration="0:04:21.000">http://nas.lan/media/64.mp3</res>
</item>
<item id="%2FA%2FB%2F01.mp3" parentID="%2FA%2FB" restricted="1">
  <upnp:class>object.item.audioItem</upnp:class>
  <dc:title>01 - Track 1</dc:title>
  <res protocolInfo="http-get:*:audio/x-flac:*" size="67123">http://nas.lan/r/A/B/01.mp3</res>
</item>
</DIDL-Lite>`;

const items = parseDidlItems(DIDL, /<item\s[^>]*>[\s\S]*?<\/item>/gi);
assert.strictEqual(items.length, 2);

const [tagged, bare] = items;
assert.strictEqual(tagged.title, 'Track 7');
assert.strictEqual(tagged.album, 'Second Light');
// The role attribute must not stop upnp:artist from matching.
assert.strictEqual(tagged.artist, 'Test Alpha');
assert.strictEqual(tagged.genre, 'Rock & Roll');
assert.strictEqual(tagged.trackNumber, 1);
assert.strictEqual(tagged.year, 2026);
assert.strictEqual(tagged.durationSec, 261);
assert.strictEqual(tagged.size, 10592476);
assert.strictEqual(tagged.url, 'http://nas.lan/media/64.mp3');
assert.strictEqual(tagged.mime, 'audio/mpeg');

// The server that says nothing: everything but the title has to come from the
// browse trail instead.
assert.strictEqual(bare.artist, null);
assert.strictEqual(bare.album, null);
assert.strictEqual(bare.durationSec, null);
assert.strictEqual(bare.url, 'http://nas.lan/r/A/B/01.mp3');

// Containers are matched with the same code and must not be mistaken for items.
const containers = parseDidlItems(
  '<DIDL-Lite><container id="%2FA" parentID="0" childCount="1">' +
    '<upnp:class>object.container.storageFolder</upnp:class><dc:title>A</dc:title></container></DIDL-Lite>',
  /<container\s[^>]*>[\s\S]*?<\/container>/gi
);
assert.strictEqual(containers.length, 1);
assert.strictEqual(containers[0].id, '%2FA');
assert.strictEqual(containers[0].url, null);

// ── What the browse trail has to supply when the server won't ────────────────

const trail = trailMetadata('Test Alpha/First Light', '01 - Track 1');
assert.deepStrictEqual(trail, {
  title: 'Track 1',
  album: 'First Light',
  artist: 'Test Alpha',
  trackNumber: 1,
});
// A track sitting in the root has no folders to borrow an artist or album from.
assert.deepStrictEqual(trailMetadata('', 'Loose Track'), {
  title: 'Loose Track',
  album: null,
  artist: null,
  trackNumber: null,
});

// ── URLs, which the server hands over rather than us building them ───────────

const credentials = {
  baseUrl: 'http://nas.lan/rootDesc.xml',
  username: null,
  userId: null,
  accessToken: null,
  deviceId: null,
  config: { controlUrl: 'http://nas.lan/ctl' },
};
assert.strictEqual(
  upnpProvider.streamUrl(credentials, 'http://nas.lan/media/64.mp3'),
  'http://nas.lan/media/64.mp3'
);
// No credentials in the URL and no headers to add: nothing to authenticate to.
assert.strictEqual(upnpProvider.requestHeaders, undefined);

// ── Against a real server, when one is configured ────────────────────────────

const liveUrl = process.env.UPNP_URL;
if (liveUrl) {
  const { credentials: live, displayName } = await upnpProvider.connect({ baseUrl: liveUrl });
  console.log(`connected to ${displayName} (${live.config.controlUrl})`);

  const tracks = await upnpProvider.listTracks(live);
  assert.ok(tracks.length > 0, 'the server listed no audio');
  for (const track of tracks) {
    assert.ok(track.remoteId.startsWith('http'), `remoteId is not a URL: ${track.remoteId}`);
    assert.ok(track.title, `track has no title: ${track.path}`);
  }
  // Every track has to be its own row; a duplicate remoteId would collapse them.
  assert.strictEqual(new Set(tracks.map(t => t.remoteId)).size, tracks.length);

  const played = await fetch(tracks[0].remoteId, { headers: { Range: 'bytes=0-63' } });
  assert.ok(played.ok, `first track did not stream: ${played.status}`);

  // The half of discover() that isn't SSDP: turning a LOCATION into something
  // worth listing. The multicast half needs a network that delivers it.
  const device = await describe(live.baseUrl);
  assert.ok(device, 'the description URL did not describe a media server');
  assert.strictEqual(device.name, displayName);
  assert.strictEqual(device.control, live.config.controlUrl);
  // Anything that isn't a device description is not a server, not an error.
  assert.strictEqual(await describe(new URL('/ctl', live.baseUrl).toString()), null);

  const found = await upnpProvider.discover?.();
  console.log(`ssdp found ${found?.length ?? 0} server(s)`);

  console.log(`${tracks.length} tracks, e.g.`, {
    title: tracks[0].title,
    artists: tracks[0].artists,
    album: tracks[0].album,
    path: tracks[0].path,
  });
} else {
  console.log('UPNP_URL unset; skipped the live server');
}

console.log('upnp.check: ok');
