// The Subsonic API, and the two kinds of server we point it at: a plain
// Subsonic server (Navidrome, Airsonic, Gonic) and Nextcloud's Music app, which
// speaks the same protocol from a different URL with a different idea of what a
// password is.
//
// Both providers live in this file because the difference between them is four
// fields, listed at the bottom. Split across two files, the thing worth seeing —
// what actually differs — would be the thing you can't see.
//
// The credentials travel in the query string, which is the pleasant part: no
// header injection, so <audio> and <img> hit `stream` and `getCoverArt`
// directly, and a URL stays valid once stored in Track.Uri.

import crypto from 'crypto';
import type {
  ConnectInput,
  ConnectResult,
  RemoteTrack,
  RemoteTrackDetails,
  SourceCredentials,
  SourceProvider,
} from './types';

// A page of albums comes off the server's own index, but a large library still
// has it counting rows.
const REQUEST_TIMEOUT_MS = 20000;

// A server that hasn't answered in this long is one the user would call offline.
const PING_TIMEOUT_MS = 5000;

/** The protocol's ceiling for getAlbumList2. */
const PAGE_SIZE = 500;

/** Concurrent getAlbum calls. One server is one process pool; this is polite. */
const ALBUM_CONCURRENCY = 4;

const CLIENT_NAME = 'XeroTunes';

/**
 * The version that added `format=raw`, which is the newest thing used here.
 * Servers advertise 1.16.1 and implement subsets of it, so asking for what we
 * actually need is the only version claim worth making.
 */
const API_VERSION = '1.9.0';

// 600 is visibly soft full-screen; embedded covers are usually 1000-1500 square.
const ART_MAX_WIDTH = 1200;

/** The codes worth rewording. Anything else keeps the server's own message. */
const ERROR_MESSAGES: Record<number, string> = {
  30: 'That server speaks an older version of the API than this client',
  40: 'Sign-in failed: check the username and password',
  41: 'This account cannot use token authentication, which is all this server offers',
  50: 'That account is not allowed to use the API',
};

interface SubsonicSong {
  id: string;
  title?: string;
  album?: string;
  artist?: string;
  track?: number;
  discNumber?: number;
  year?: number;
  genre?: string;
  duration?: number;
  size?: number;
  suffix?: string;
  bitRate?: number;
  path?: string;
  coverArt?: string;
}

interface SubsonicAlbum {
  id: string;
  name?: string;
  artist?: string;
  year?: number;
  songCount?: number;
  coverArt?: string;
}

/** What one server type needs that the protocol doesn't settle. */
interface Flavour {
  type: string;
  label: string;
  scheme: string;
  /** What the user typed, turned into the API root: the part before `/rest`. */
  endpoint(_server: string): string;
  /**
   * `token` is the protocol's md5(password + salt), which needs the server to
   * hold the password recoverably. `password` sends it plain, which is all a
   * server storing a hash can check.
   */
  auth: 'token' | 'password';
  /** Extra params on `stream`, for a server that would otherwise transcode. */
  stream?: Record<string, string>;
  /** Codes worth rewording for this server in particular. */
  errors?: Record<number, string>;
}

/** So a caller can tell a refusal from a server that never answered. */
function apiError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/** The address with a scheme and no trailing slash, for someone who typed a host. */
export function withScheme(server: string, fallback: 'http' | 'https'): string {
  const typed = server.trim();
  const url = new URL(/^https?:\/\//i.test(typed) ? typed : `${fallback}://${typed}`);
  return url.toString().replace(/\/+$/, '');
}

function authParams(c: SourceCredentials, flavour: Flavour): Record<string, string> {
  const password = c.accessToken ?? '';
  const u = c.username ?? '';
  if (flavour.auth === 'password') return { u, p: password };
  // A fresh salt per call. The token is derived, not a session, so a URL built
  // now still works when it comes back out of the database tomorrow.
  const salt = crypto.randomBytes(8).toString('hex');
  return { u, s: salt, t: crypto.createHash('md5').update(password + salt).digest('hex') };
}

function apiUrl(
  c: SourceCredentials,
  flavour: Flavour,
  method: string,
  params: Record<string, string> = {}
): string {
  const query = new URLSearchParams({
    ...authParams(c, flavour),
    v: API_VERSION,
    c: CLIENT_NAME,
    f: 'json',
    ...params,
  });
  return `${c.baseUrl}/rest/${method}?${query.toString()}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The `subsonic-response` body, or a thrown error carrying the HTTP status. */
async function call(
  c: SourceCredentials,
  flavour: Flavour,
  method: string,
  params: Record<string, string> = {},
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<any> {
  const res = await fetch(apiUrl(c, flavour, method, params), {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw apiError(`The server answered ${res.status} ${res.statusText}`, res.status);
  // A server that isn't one of these answers with its own login page.
  const body = (await res.json().catch(() => null))?.['subsonic-response'];
  if (!body) throw apiError('That address answered, but not with a music library', res.status);
  if (body.status === 'failed') {
    const code = Number(body.error?.code ?? 0);
    throw apiError(
      flavour.errors?.[code] ??
        ERROR_MESSAGES[code] ??
        body.error?.message ??
        'The server refused the request',
      res.status
    );
  }
  return body;
}

export function toRemoteTrack(song: SubsonicSong, album?: SubsonicAlbum): RemoteTrack {
  // The raw credit string, not a split one: sync.ts re-splits it under the
  // user's own separator rules, exactly as it does for a local file.
  const artist = (song.artist ?? '').trim();
  const albumArtist = (album?.artist ?? '').trim();
  return {
    remoteId: song.id,
    title: song.title?.trim() || song.path?.split('/').pop() || song.id,
    album: song.album ?? album?.name ?? null,
    artists: artist ? [artist] : [],
    albumArtists: albumArtist ? [albumArtist] : artist ? [artist] : [],
    genres: song.genre ? [song.genre] : [],
    trackNumber: song.track ?? null,
    discNumber: song.discNumber ?? null,
    year: song.year ?? album?.year ?? null,
    durationSec: song.duration ?? null,
    container: song.suffix ?? null,
    path: song.path ?? null,
    // The album's cover where the song has none of its own, so a track still
    // shows the sleeve its album is filed under.
    artKey: song.coverArt ?? album?.coverArt ?? null,
  };
}

/** Structured lyrics as LRC, since that is what the player's lyrics view parses. */
export function toLrc(structured: any): string | null {
  const lines: Array<{ start?: number; value?: string }> = structured?.line ?? [];
  if (!lines.length) return null;
  const stamp = (ms: number): string => {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(2).padStart(5, '0');
    return `[${String(minutes).padStart(2, '0')}:${seconds}]`;
  };
  return lines
    .map(line => (line.start == null ? (line.value ?? '') : stamp(line.start) + (line.value ?? '')))
    .join('\n');
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function providerFor(flavour: Flavour): SourceProvider {
  return {
    type: flavour.type,
    label: flavour.label,
    scheme: flavour.scheme,
    needsAccount: true,

    async connect(input: ConnectInput): Promise<ConnectResult> {
      const baseUrl = flavour.endpoint(input.baseUrl);
      const credentials: SourceCredentials = {
        baseUrl,
        username: input.username || null,
        // The API password, stored as it is: every request signs itself with it.
        accessToken: input.password || null,
        userId: null,
        deviceId: null,
        config: {},
      };
      // Throws on a bad password, a missing music app, or an address that is not
      // this kind of server at all.
      await call(credentials, flavour, 'ping');
      return { displayName: new URL(baseUrl).host, credentials };
    },

    async listTracks(c, onProgress) {
      const albums: SubsonicAlbum[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const body = await call(c, flavour, 'getAlbumList2', {
          type: 'alphabeticalByName',
          size: String(PAGE_SIZE),
          offset: String(offset),
        });
        const page: SubsonicAlbum[] = body.albumList2?.album ?? [];
        albums.push(...page);
        if (page.length < PAGE_SIZE) break;
      }

      // The server's own count, so the bar is in tracks from the first album on
      // rather than changing units when the import starts.
      const expected = albums.reduce((n, album) => n + (album.songCount ?? 0), 0);
      const tracks: RemoteTrack[] = [];

      // A pool rather than batches: one album the server is slow with would
      // otherwise hold up the three it was batched with.
      let next = 0;
      const worker = async () => {
        for (let i = next++; i < albums.length; i = next++) {
          const album = albums[i];
          try {
            const songs: SubsonicSong[] =
              (await call(c, flavour, 'getAlbum', { id: album.id })).album?.song ?? [];
            for (const song of songs) tracks.push(toRemoteTrack(song, album));
          } catch (err) {
            // One album the server chokes on shouldn't cost the whole library.
            console.warn(
              `[${flavour.type}] Skipping album`,
              album.name ?? album.id,
              (err as Error).message
            );
          }
          onProgress?.(tracks.length, Math.max(expected, tracks.length));
        }
      };
      await Promise.all(Array.from({ length: ALBUM_CONCURRENCY }, worker));
      return tracks;
    },

    streamUrl(c, remoteId) {
      return apiUrl(c, flavour, 'stream', { id: remoteId, ...flavour.stream });
    },

    // Always the stored file, whatever the server would have done to a stream.
    downloadUrl(c, remoteId) {
      return apiUrl(c, flavour, 'download', { id: remoteId });
    },

    artUrl(c, track) {
      if (!track.artKey) return null;
      return apiUrl(c, flavour, 'getCoverArt', {
        id: track.artKey,
        size: String(ART_MAX_WIDTH),
      });
    },

    /**
     * OpenSubsonic's lyrics endpoint, answered when the file carries lyrics. A
     * server too old to have the method says so, which is indistinguishable here
     * from a song without any: both mean nothing to show.
     */
    async lyrics(c, remoteId) {
      try {
        const body = await call(c, flavour, 'getLyricsBySongId', { id: remoteId });
        return toLrc(body.lyricsList?.structuredLyrics?.[0]);
      } catch {
        return null;
      }
    },

    async details(c, remoteId): Promise<RemoteTrackDetails | null> {
      const song: SubsonicSong | undefined = (await call(c, flavour, 'getSong', { id: remoteId }))
        .song;
      if (!song) return null;
      // Codec, sample rate and channels aren't in the protocol; null leaves the
      // dialog showing whatever the library already holds for those.
      return {
        codec: null,
        // The protocol counts kbps, the info dialog divides by 1000.
        bitRate: song.bitRate ? song.bitRate * 1000 : null,
        sampleRate: null,
        channels: null,
        container: song.suffix ?? null,
        size: song.size ?? null,
        path: song.path ?? null,
      };
    },

    async ping(c) {
      try {
        await call(c, flavour, 'ping', {}, PING_TIMEOUT_MS);
        return { reachable: true, authValid: true };
      } catch (err) {
        // Any HTTP status means the server answered, so only the credentials are
        // in doubt; no status means nothing was listening.
        const status = (err as { status?: number }).status ?? 0;
        return { reachable: status > 0, authValid: false };
      }
    },
  };
}

export const subsonicProvider = providerFor({
  type: 'subsonic',
  label: 'Subsonic API',
  scheme: 'subsonic',
  // Self-hosted on a LAN more often than not, so an address with no scheme is
  // likelier to be http than https.
  endpoint: server => withScheme(server, 'http').replace(/\/rest$/, ''),
  auth: 'token',
  // Subsonic servers transcode to the user's preferred format unless told not
  // to, which would quietly hand the library a re-encoded copy of every FLAC.
  stream: { format: 'raw' },
});

export const nextcloudProvider = providerFor({
  type: 'nextcloud',
  label: 'Nextcloud',
  scheme: 'nextcloud',
  endpoint: server => {
    const base = withScheme(server, 'https');
    if (base.includes('/apps/music/subsonic')) return base.replace(/\/rest$/, '');
    // index.php rather than the pretty path: that one needs the rewrite rules,
    // and a server without them 404s.
    return `${base}/index.php/apps/music/subsonic`;
  },
  // The Music app stores its API password hashed, so md5(password + salt) has
  // nothing to compare against; plain `p=` is the only thing it can check.
  auth: 'password',
  errors: {
    40: 'Sign-in failed: use the password generated in Nextcloud’s Music settings, not your account password',
  },
});
