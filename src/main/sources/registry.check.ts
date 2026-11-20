/**
 * Self-check: run with `node src/main/sources/registry.check.ts`.
 *
 * Uses each provider's real stream URL, so a login in a new query parameter
 * fails here until credentialParams lists it.
 */
import assert from 'node:assert';
import { getProvider, withoutCredentials } from './registry.ts';
import type { SourceCredentials } from './types';

const SECRET = 'hunter2-secret';
const creds: SourceCredentials = {
  baseUrl: 'http://192.168.1.10:8096',
  username: 'alice',
  userId: 'u1',
  accessToken: SECRET,
  deviceId: 'dev1',
  config: {},
};

const cases: Array<[type: string, remoteId: string]> = [
  ['jellyfin', 'item1'],
  ['emby', 'item1'],
  ['plex', '101:202'],
  ['subsonic', 'song1'],
  ['nextcloud', 'song1'],
];

for (const [type, remoteId] of cases) {
  const raw = getProvider(type)!.streamUrl(creds, remoteId);
  const shared = withoutCredentials(type, raw);
  assert.ok(!shared.includes(SECRET), `${type} still carries the login: ${shared}`);
  // Subsonic's t is md5(password + salt), which the SECRET check above can't see.
  assert.ok(!/[?&][upst]=/.test(shared), `${type} still carries Subsonic auth: ${shared}`);
  assert.ok(shared.includes(remoteId.split(':').pop()!), `${type} lost the track id: ${shared}`);
  // Import matches an exported file by this string, so it must not vary per call.
  const again = withoutCredentials(type, getProvider(type)!.streamUrl(creds, remoteId));
  assert.strictEqual(again, shared, `${type} is not stable`);
}

// Downloaded tracks, local files and providers without a login pass through.
assert.strictEqual(withoutCredentials('jellyfin', '/music/a.flac'), '/music/a.flac');
assert.strictEqual(withoutCredentials(null, 'http://radio/x?t=1'), 'http://radio/x?t=1');
assert.strictEqual(
  withoutCredentials('upnp', 'http://dlna:8200/MediaItems/1.flac?s=2'),
  'http://dlna:8200/MediaItems/1.flac?s=2'
);

console.log('registry.check.ts OK');
