// WebDAV provider. A share has no library, only files, so listTracks is a
// PROPFIND walk plus a partial read of each file for its tags; everything else
// is plain HTTP against the file's own URL.
//
// No XML parser: the three properties we read are matched with regexes.
// Namespace prefixes differ by server (D:, d:, lp1:), so every pattern allows
// any prefix.
//
// Auth is a Basic header, which <audio> cannot send. streamUrl is therefore a
// bare URL and the header comes from requestHeaders(), injected into the
// renderer's requests by sync.installSourceAuth.

import type {
  ConnectInput,
  ConnectResult,
  MetadataMode,
  RemoteTrack,
  RemoteTrackDetails,
  SourceCredentials,
  SourceProvider,
} from './types';

// Generous: a big folder's listing comes off whatever disk is behind the NAS.
const REQUEST_TIMEOUT_MS = 20000;

// The scanner's list, so a share and a local folder yield the same tracks.
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.opus', '.aac', '.flac', '.webm', '.m4a'];

// In preference order; the first one a folder has wins.
const COVER_BASENAMES = ['cover', 'folder', 'front', 'album', 'albumart'];
const COVER_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * Enough for an ID3v2 header with an embedded cover, or a FLAC's metadata
 * blocks. Tags that live at the end of the file (a bare ID3v1) are missed, and
 * those tracks fall back to their path.
 */
const TAG_BYTES = 512 * 1024;

/**
 * The second try, for a file whose tag header declares more than TAG_BYTES,
 * usually a big embedded cover. Without it the parse hits the end of the buffer
 * and the track loses its tags entirely, not just its art.
 */
const TAG_BYTES_RETRY = 2 * 1024 * 1024;

/**
 * Concurrent tag reads. A share is usually one disk behind one HTTP server, so
 * more sockets than this only moves the queue to the far end.
 */
const TAG_CONCURRENCY = 4;

/**
 * Longer than a listing's: this waits on the server reading a file, and a sync
 * is background work where losing tags to save twenty seconds is a bad trade.
 */
const TAG_TIMEOUT_MS = 45000;

// Short: a server that hasn't answered in this long is one the user would
// call offline anyway.
const PING_TIMEOUT_MS = 5000;

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<propfind xmlns="DAV:"><prop>' +
  '<resourcetype/><getcontentlength/><getlastmodified/><getetag/>' +
  '</prop></propfind>';

const MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.webm': 'audio/webm',
};

export function metadataMode(c: SourceCredentials): MetadataMode {
  const mode = c.config?.metadata;
  return mode === 'onPlay' || mode === 'off' ? mode : 'eager';
}

export function basicToken(username: string, password: string): string {
  return Buffer.from(`${username}:${password}`).toString('base64');
}

function authHeaders(c: SourceCredentials): Record<string, string> {
  return c.accessToken ? { Authorization: `Basic ${c.accessToken}` } : {};
}

/** The base URL with exactly one trailing slash, so relative joins stay under it. */
function root(c: SourceCredentials): URL {
  return new URL(c.baseUrl.replace(/\/+$/, '') + '/');
}

function extname(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  return dot > filePath.lastIndexOf('/') ? filePath.slice(dot).toLowerCase() : '';
}

/**
 * `Artist/Album/01 - Song.mp3`: the path under the share's root, decoded. Also
 * the remoteId, being the only thing WebDAV offers that is unique and stable.
 */
export function relativePath(rootUrl: URL, href: string): string {
  const target = decodeURIComponent(new URL(href, rootUrl).pathname);
  const base = decodeURIComponent(rootUrl.pathname);
  const rel = target.startsWith(base) ? target.slice(base.length) : target;
  return rel.replace(/^\/+/, '').replace(/\/+$/, '');
}

function urlFor(c: SourceCredentials, remoteId: string, isDir = false): string {
  const encoded = remoteId.split('/').map(encodeURIComponent).join('/');
  return new URL(encoded + (isDir && encoded ? '/' : ''), root(c)).toString();
}

export interface DavEntry {
  /** Relative to the source root, `/`-separated, decoded, no trailing slash. */
  path: string;
  isDir: boolean;
  size: number | null;
  modified: number | null;
  etag: string | null;
}

/**
 * What the next sync compares to know whether the file changed: the etag where
 * the server keeps one, else modified time and size.
 */
export function stampOf(entry: DavEntry): string | null {
  if (entry.etag) return entry.etag;
  if (entry.modified == null && entry.size == null) return null;
  return `${entry.modified ?? 0}:${entry.size ?? 0}`;
}

function element(name: string, flags = 'i'): RegExp {
  return new RegExp(
    `<(?:[a-z0-9-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-z0-9-]+:)?${name}>`,
    flags
  );
}

const RESPONSE = element('response', 'gi');
const HREF = element('href');
const CONTENT_LENGTH = element('getcontentlength');
const LAST_MODIFIED = element('getlastmodified');
const ETAG = element('getetag');
// A file's <resourcetype/> is empty; a collection's holds this.
const COLLECTION = /<(?:[a-z0-9-]+:)?collection\b/i;

export function parsePropfind(xml: string, rootUrl: URL): DavEntry[] {
  const entries: DavEntry[] = [];
  for (const match of xml.matchAll(RESPONSE)) {
    const body = match[1];
    const href = HREF.exec(body)?.[1]?.trim();
    if (!href) continue;
    const size = CONTENT_LENGTH.exec(body)?.[1]?.trim();
    const modified = LAST_MODIFIED.exec(body)?.[1]?.trim();
    const etag = ETAG.exec(body)?.[1]?.trim();
    entries.push({
      path: relativePath(rootUrl, href),
      isDir: COLLECTION.test(body),
      size: size ? Number(size) : null,
      modified: modified ? new Date(modified).getTime() || null : null,
      etag: etag || null,
    });
  }
  return entries;
}

/** So a caller can tell a refusal from an unreachable server. */
function davError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

async function propfind(
  url: string,
  c: SourceCredentials,
  depth: '0' | '1',
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<string> {
  const res = await fetch(url, {
    method: 'PROPFIND',
    headers: { ...authHeaders(c), Depth: depth, 'Content-Type': 'application/xml' },
    body: PROPFIND_BODY,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401 || res.status === 403) {
    throw davError('Sign-in failed: check the username and password', res.status);
  }
  if (res.status === 405) throw davError('That address does not speak WebDAV', res.status);
  if (!res.ok) {
    throw davError(`WebDAV request failed (${res.status} ${res.statusText})`, res.status);
  }
  return res.text();
}

function coverRank(filePath: string): number {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1).toLowerCase();
  const ext = extname(name);
  if (!COVER_EXTENSIONS.includes(ext)) return -1;
  return COVER_BASENAMES.indexOf(name.slice(0, name.length - ext.length));
}

function dirOf(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx < 0 ? '' : filePath.slice(0, idx);
}

/**
 * Breadth-first over the share, one Depth-1 PROPFIND per folder. Depth
 * `infinity` would fetch the lot in one request, but most servers refuse it.
 */
async function walk(
  c: SourceCredentials,
  onProgress?: (_loaded: number, _total: number) => void
): Promise<{ files: DavEntry[]; covers: Map<string, string> }> {
  const rootUrl = root(c);
  const files: DavEntry[] = [];
  const covers = new Map<string, string>();
  const coverRanks = new Map<string, number>();
  const queue: string[] = [''];
  const seen = new Set<string>();

  while (queue.length) {
    const dir = queue.shift() as string;
    if (seen.has(dir)) continue;
    seen.add(dir);

    let entries: DavEntry[];
    try {
      entries = parsePropfind(await propfind(urlFor(c, dir, true), c, '1'), rootUrl);
    } catch (err) {
      // One unreadable folder shouldn't cost the whole library, but an
      // unreadable root means there is nothing to sync at all.
      if (!dir) throw err;
      console.warn('[webdav] Skipping', dir, (err as Error).message);
      continue;
    }

    for (const entry of entries) {
      if (!entry.path || entry.path === dir) continue; // the folder itself
      if (entry.isDir) {
        queue.push(entry.path);
        continue;
      }
      if (AUDIO_EXTENSIONS.includes(extname(entry.path))) {
        files.push(entry);
        continue;
      }
      const rank = coverRank(entry.path);
      if (rank >= 0 && rank < (coverRanks.get(dir) ?? COVER_BASENAMES.length)) {
        coverRanks.set(dir, rank);
        covers.set(dir, entry.path);
      }
    }
    // The total isn't knowable until the walk ends, so the bar counts what has
    // been found rather than what is left.
    onProgress?.(files.length, files.length);
  }

  return { files, covers };
}

/** What the layout says when the tags don't: `Artist/Album/01 - Title.mp3`. */
export function pathMetadata(relative: string): {
  title: string;
  album: string | null;
  artist: string | null;
  trackNumber: number | null;
} {
  const parts = relative.split('/');
  const fileName = parts.pop() ?? '';
  const stem = fileName.replace(/\.[^.]+$/, '');
  const numbered = /^(\d{1,3})\s*[-._)]*\s+(.+)$/.exec(stem);
  return {
    title: (numbered ? numbered[2] : stem).trim() || stem,
    album: parts.length ? parts[parts.length - 1] : null,
    artist: parts.length > 1 ? parts[parts.length - 2] : null,
    trackNumber: numbered ? Number(numbered[1]) : null,
  };
}

/**
 * The first maxBytes of a response, hanging up once we have them. A server that
 * ignores Range answers 200 with the whole file, and buffering that is what
 * times a big track out mid-sync; reading the stream caps it either way.
 */
async function readHead(
  res: Response,
  maxBytes: number,
  // Written as we go, so a read that times out can still say how far it got.
  progress: { read: number }
): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  try {
    while (progress.read < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      progress.read += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks, Math.min(progress.read, maxBytes));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The head of the file, parsed by the same library the local scanner uses. The
 * file's real size comes back too, free in the partial response's Content-Range.
 */
async function readTags(
  c: SourceCredentials,
  remoteId: string,
  sizeHint: number | null,
  maxBytes = TAG_BYTES
): Promise<{ metadata: any | null; size: number | null }> {
  let size = sizeHint;
  const started = Date.now();
  const progress = { read: 0 };
  let status = 0;
  try {
    const res = await fetch(urlFor(c, remoteId), {
      headers: { ...authHeaders(c), Range: `bytes=0-${maxBytes - 1}` },
      signal: AbortSignal.timeout(TAG_TIMEOUT_MS),
    });
    status = res.status;
    if (!res.ok) return { metadata: null, size };
    const total = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '');
    if (total) size = Number(total[1]);
    // No Content-Range means the server sent the whole file, so its length is
    // the file's; on a 206 without one, believe neither.
    else if (res.status !== 206 && res.headers.get('content-length')) {
      size = Number(res.headers.get('content-length'));
    }
    const buffer = await readHead(res, maxBytes, progress);
    // Bundled by webpack like the scan worker's copy; eslint can't resolve ESM.
    // eslint-disable-next-line import/no-unresolved
    const mm = await import('music-metadata');
    // The size hint is the whole file's, not the buffer's: it is what lets the
    // MP3 parser work out a duration without reading to the end.
    const metadata = await mm.parseBuffer(
      buffer,
      { mimeType: MIME_TYPES[extname(remoteId)], size: size ?? undefined },
      { duration: false }
    );
    return { metadata, size };
  } catch (err) {
    // A full window means the read finished and the parse failed, so the tags
    // run past it. A short one ran out of time, where asking for more is worse.
    if (progress.read >= maxBytes && maxBytes < TAG_BYTES_RETRY) {
      return readTags(c, remoteId, size, TAG_BYTES_RETRY);
    }
    // The track still plays, named after its path. Status 200 means the server
    // ignored the Range; a read short of the window ran out of time, not tags.
    console.warn(
      `[webdav] No tags for ${remoteId} (status ${status || 'none'}, ` +
        `${progress.read} bytes in ${Date.now() - started}ms):`,
      (err as Error).message
    );
    return { metadata: null, size };
  }
}

/**
 * The cover embedded in the file, as a data: URI. It costs nothing extra, being
 * the buffer the tags came from, and sync.ts fetches artKey through artUrl()
 * either way, which handles data: as happily as http:.
 */
function embeddedArt(metadata: any | null): string | null {
  const picture = metadata?.common?.picture?.[0];
  if (!picture?.data?.length) return null;
  return `data:${picture.format || 'image/jpeg'};base64,${Buffer.from(picture.data).toString(
    'base64'
  )}`;
}

function toRemoteTrack(
  file: DavEntry,
  metadata: any | null,
  coverPath: string | null
): RemoteTrack {
  const fallback = pathMetadata(file.path);
  const common = metadata?.common;
  const format = metadata?.format;
  // The raw credit string rather than music-metadata's split: sync.ts re-splits
  // it under the user's own separator rules, exactly as for a local file.
  const artist = (common?.artist ?? '').trim();
  const albumArtist = (common?.albumartist ?? '').trim();
  return {
    remoteId: file.path,
    title: (common?.title ?? '').trim() || fallback.title,
    album: (common?.album ?? '').trim() || fallback.album,
    artists: artist ? [artist] : fallback.artist ? [fallback.artist] : [],
    albumArtists: albumArtist ? [albumArtist] : fallback.artist ? [fallback.artist] : [],
    genres: common?.genre ?? [],
    trackNumber: common?.track?.no ?? fallback.trackNumber,
    discNumber: common?.disk?.no ?? null,
    year: common?.year ?? null,
    durationSec: format?.duration ? Math.round(format.duration) : null,
    container: extname(file.path).replace('.', '') || null,
    path: file.path,
    dateAdded: file.modified,
    // A cover file beside the track is the cheaper of the two: one URL shared by
    // the whole album, rather than a copy of the image per track.
    artKey: coverPath ?? embeddedArt(metadata),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const webdavProvider: SourceProvider = {
  type: 'webdav',
  label: 'WebDAV',
  scheme: 'webdav',
  readsFileTags: true,
  metadataMode,

  async connect(input: ConnectInput): Promise<ConnectResult> {
    const credentials: SourceCredentials = {
      baseUrl: input.baseUrl.replace(/\/+$/, ''),
      username: input.username || null,
      userId: null,
      accessToken: input.username ? basicToken(input.username, input.password ?? '') : null,
      deviceId: null,
      config: {},
    };
    // Throws on a bad password, a wrong address, or anything that isn't WebDAV.
    await propfind(root(credentials).toString(), credentials, '0');

    // A share has no name of its own, so the folder the user pointed at stands in.
    const url = new URL(credentials.baseUrl);
    const folder = decodeURIComponent(url.pathname).split('/').filter(Boolean).pop();
    return { displayName: folder ? `${url.host}/${folder}` : url.host, credentials };
  },

  async listTracks(c, onProgress, known) {
    const { files, covers } = await walk(c, onProgress);
    const mode = metadataMode(c);

    // What the layout alone can say: enough to play the track and to file it
    // under an artist and album.
    const fromPath = (file: DavEntry): RemoteTrack => ({
      ...toRemoteTrack(file, null, covers.get(dirOf(file.path)) ?? null),
      stamp: stampOf(file),
      untagged: true,
    });

    // A file the last sync already read, byte for byte. Re-reading it would
    // cost a request to learn nothing, and in the modes that don't read at all
    // it would replace good tags with a guess from the path.
    const alreadyRead = (file: DavEntry): boolean => {
      const stamp = stampOf(file);
      return !!stamp && known?.get(file.path) === stamp;
    };

    if (mode !== 'eager') {
      return files.map(file =>
        alreadyRead(file) ? { ...fromPath(file), unchanged: true } : fromPath(file)
      );
    }

    const tracks: RemoteTrack[] = [];
    // A pool rather than batches: a file the server is slow with would hold up
    // the rest of its batch, whose own timeouts run while they wait, and a slow
    // share would lose tags in clumps.
    let next = 0;
    let done = 0;
    const withArt = new Set<string>();
    const worker = async () => {
      for (let i = next++; i < files.length; i = next++) {
        const file = files[i];
        const dir = dirOf(file.path);
        if (alreadyRead(file)) {
          tracks.push({ ...fromPath(file), unchanged: true });
          onProgress?.(++done, files.length);
          continue;
        }
        const { metadata } = await readTags(c, file.path, file.size);
        const track: RemoteTrack = {
          ...toRemoteTrack(file, metadata, covers.get(dir) ?? null),
          stamp: stampOf(file),
          untagged: !metadata,
        };
        // Album art is taken from the first track of an album, so carrying an
        // embedded cover on the rest would only hold a copy of every picture in
        // the library in memory until the sync ends.
        if (track.artKey?.startsWith('data:')) {
          if (withArt.has(dir)) track.artKey = null;
          else withArt.add(dir);
        }
        tracks.push(track);
        onProgress?.(++done, files.length);
      }
    };
    await Promise.all(Array.from({ length: TAG_CONCURRENCY }, worker));
    return tracks;
  },

  /**
   * One track, read in full, for one that reached the library without its tags.
   * PROPFINDs the parent folder rather than the file: that one request also
   * finds the cover sitting beside it.
   */
  async readTrack(c, remoteId) {
    if (metadataMode(c) === 'off') return null;
    const entries = parsePropfind(
      await propfind(urlFor(c, dirOf(remoteId), true), c, '1'),
      root(c)
    );
    const file = entries.find(entry => !entry.isDir && entry.path === remoteId);
    if (!file) return null;
    let cover: string | null = null;
    let best = COVER_BASENAMES.length;
    for (const entry of entries) {
      const rank = entry.isDir ? -1 : coverRank(entry.path);
      if (rank >= 0 && rank < best) {
        best = rank;
        cover = entry.path;
      }
    }
    const { metadata } = await readTags(c, file.path, file.size);
    return {
      ...toRemoteTrack(file, metadata, cover),
      stamp: stampOf(file),
      untagged: !metadata,
    };
  },

  streamUrl(c, remoteId) {
    return urlFor(c, remoteId);
  },

  downloadUrl(c, remoteId) {
    return urlFor(c, remoteId);
  },

  artUrl(c, track) {
    if (!track.artKey) return null;
    return track.artKey.startsWith('data:') ? track.artKey : urlFor(c, track.artKey);
  },

  requestHeaders(c) {
    return authHeaders(c);
  },

  async ping(c) {
    try {
      await propfind(root(c).toString(), c, '0', PING_TIMEOUT_MS);
      return { reachable: true, authValid: true };
    } catch (err) {
      // Any status at all means the server answered, so only the credentials
      // are in doubt; no status means nothing was listening.
      const status = (err as { status?: number }).status ?? 0;
      return { reachable: status > 0, authValid: false };
    }
  },

  // The sidecar a local library would keep beside the file; nothing else on a
  // share could hold lyrics.
  async lyrics(c, remoteId) {
    try {
      const res = await fetch(urlFor(c, remoteId.replace(/\.[^.]+$/, '.lrc')), {
        headers: authHeaders(c),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  },

  async details(c, remoteId): Promise<RemoteTrackDetails | null> {
    const { metadata, size } = await readTags(c, remoteId, null);
    const format = metadata?.format;
    if (!format) return null;
    return {
      codec: format.codec ?? null,
      bitRate: format.bitrate ? Math.round(format.bitrate) : null,
      sampleRate: format.sampleRate ?? null,
      channels: format.numberOfChannels ?? null,
      container: format.container ?? (extname(remoteId).replace('.', '') || null),
      size,
      path: remoteId,
    };
  },
};
