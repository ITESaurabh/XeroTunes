// Emby provider. Jellyfin was forked from Emby and the two still share this
// API, so the client lives in jellyfin.ts and this file is only what Emby does
// differently. Keep it that way; nothing in jellyfin.ts should branch on which
// server it is talking to.
//
// Two divergences live there rather than here: the `/emby` prefix, which
// `resolveBaseUrl` probes at connect because a Jellyfin never reaches the second
// candidate anyway, and the SHA1 password pre-4.x builds want, retried in
// `authenticateByName` because Jellyfin's early releases behaved the same.
//
// Checked and found not to differ, so do not go looking again:
// `X-Emby-Authorization` and the `MediaBrowser` header format, `ImageTags.Primary`
// as the cover handle, and `api_key=` on the query string.

import { providerFor } from './jellyfin.ts';

export const embyProvider = providerFor({
  type: 'emby',
  label: 'Emby',
  scheme: 'emby',
  // Emby serves a flat /Items too, but the user-scoped form is the documented
  // one and the only one every Emby build has had.
  itemsPath: (userId, itemId) =>
    `/Users/${encodeURIComponent(userId)}/Items` + (itemId ? `/${encodeURIComponent(itemId)}` : ''),
});
