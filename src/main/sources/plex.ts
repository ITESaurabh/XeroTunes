// Plex provider. Everything is a token on the query string, so <audio> and
// <img> reach the server directly and a stored URL keeps working.
//
// Two ways in, because a Plex token is not a server-side account. Paste one and
// nothing leaves for plex.tv; sign in and plex.tv issues an account token, which
// is then exchanged for the one this server accepts. Either way connect() proves
// the result against the address the user typed, since a token plex.tv is happy
// with means nothing to a server that never heard of the account.
//
// Plex answers XML unless asked for JSON, so every request carries Accept.

import crypto from 'crypto';
import type {
  ConnectInput,
  ConnectResult,
  RemoteTrack,
  RemoteTrackDetails,
  SourceCredentials,
  SourceProvider,
} from './types';

const REQUEST_TIMEOUT_MS = 20000;

// A server that hasn't answered in this long is one the user would call offline.
const PING_TIMEOUT_MS = 5000;

/** Rows per library listing; Plex pages by container offset, not by cursor. */
const PAGE_SIZE = 500;

const CLIENT_NAME = 'XeroTunes';

/** What Plex calls a music library, on the section rather than the track. */
const SECTION_TYPE_MUSIC = 'artist';

/** Plex's item type for a track, which is what `type=` filters the listing to. */
const ITEM_TYPE_TRACK = '10';

interface PlexPart {
  id?: number;
  key?: string;
  file?: string;
  size?: number;
  container?: string;
  Stream?: Array<{
    streamType?: number;
    codec?: string;
    samplingRate?: number;
    channels?: number;
    bitrate?: number;
  }>;
}

interface PlexMedia {
  container?: string;
  bitrate?: number;
  audioChannels?: number;
  audioCodec?: string;
  Part?: PlexPart[];
}

export interface PlexTrack {
  ratingKey: string | number;
  title?: string;
  /** The album. Plex names a track's parent and grandparent, not the thing itself. */
  parentTitle?: string;
  /** The album artist. */
  grandparentTitle?: string;
  /** The track's own artist, present only when it differs from the album's. */
  originalTitle?: string;
  index?: number;
  parentIndex?: number;
  year?: number;
  parentYear?: number;
  duration?: number;
  thumb?: string;
  parentThumb?: string;
  Genre?: Array<{ tag?: string }>;
  Media?: PlexMedia[];
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Identifies this install to Plex. Kept in `deviceId` and reused, because Plex
 * files a new entry in the account's device list for every identifier it sees.
 */
export function generateClientId(): string {
  return crypto.randomBytes(12).toString('hex');
}

function plexHeaders(clientId: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'X-Plex-Client-Identifier': clientId,
    'X-Plex-Product': CLIENT_NAME,
    'X-Plex-Device': 'Desktop',
    'X-Plex-Platform': 'Desktop',
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function failed(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/**
 * A server URL carrying the token and client identity as query parameters,
 * because <audio> and <img> reach these same routes and cannot set headers.
 */
export function apiUrl(
  c: SourceCredentials,
  path: string,
  params: Record<string, string> = {}
): string {
  const query = new URLSearchParams({
    ...params,
    'X-Plex-Token': c.accessToken ?? '',
    'X-Plex-Client-Identifier': c.deviceId ?? '',
    'X-Plex-Product': CLIENT_NAME,
  });
  return `${trimTrailingSlash(c.baseUrl)}${path}?${query}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function api(
  c: SourceCredentials,
  path: string,
  params: Record<string, string> = {},
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<any> {
  const res = await fetchWithTimeout(apiUrl(c, path, params), {
    timeoutMs,
    headers: plexHeaders(c.deviceId ?? ''),
  });
  if (res.status === 401) {
    const detail = await plexErrorText(res);
    throw failed(
      `That Plex token was refused by this server${detail ? `: ${detail}` : ''}. A token only works on servers the account it belongs to can reach.`,
      401
    );
  }
  if (!res.ok) {
    throw failed(`Plex answered ${res.status} for ${path}`, res.status);
  }
  return res.json();
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** plex.tv's own reason for a refusal, which is more use than the status. */
async function plexErrorText(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { errors?: Array<{ message?: string }> };
    return body.errors?.map(e => e.message).filter(Boolean).join('; ') || null;
  } catch {
    return null;
  }
}

/**
 * The account's token, for a user who would rather sign in than find one. The
 * credentials go to plex.tv, not to the address typed in the dialog, which is
 * why the token field exists beside them.
 */
export async function signIn(
  login: string,
  password: string,
  clientId: string
): Promise<string> {
  const res = await fetchWithTimeout('https://plex.tv/api/v2/users/signin', {
    method: 'POST',
    headers: {
      ...plexHeaders(clientId),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ login, password }).toString(),
  });

  if (!res.ok) {
    // plex.tv tells wrong credentials from a missing two factor code from rate
    // limiting, so its own wording beats a guess. The hints cover what it words
    // unhelpfully: the login is the account email as often as the username, and
    // a two factor code goes on the end of the password.
    const detail = await plexErrorText(res);
    throw failed(
      `plex.tv refused that sign-in${detail ? `: ${detail}` : ` (${res.status})`}. Try the account email rather than the username, add the six digit code to the end of the password if two-factor is on, or paste a token instead.`,
      res.status
    );
  }

  const json = (await res.json()) as { authToken?: string };
  if (!json.authToken) throw failed('plex.tv signed in but returned no token', 0);
  return json.authToken;
}

/**
 * `<ratingKey>:<partId>`: playback and metadata are addressed by different ids
 * and `streamUrl` is handed nothing but this string. Both are Plex row ids with
 * the same lifecycle, so pairing them costs no stability over the ratingKey.
 */
export function splitRemoteId(remoteId: string): { ratingKey: string; partId: string | null } {
  const [ratingKey, partId] = remoteId.split(':');
  return { ratingKey, partId: partId || null };
}

/** What the server says about itself before anyone has authenticated. */
export async function identity(
  baseUrl: string
): Promise<{ machineIdentifier: string | null; claimed: boolean | null } | null> {
  try {
    const res = await fetchWithTimeout(`${trimTrailingSlash(baseUrl)}/identity`, {
      timeoutMs: PING_TIMEOUT_MS,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      MediaContainer?: { machineIdentifier?: string; claimed?: boolean };
    };
    return {
      machineIdentifier: body.MediaContainer?.machineIdentifier ?? null,
      claimed: body.MediaContainer?.claimed ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * The token this particular server accepts, which is not the account token:
 * plex.tv issues one per server the account can reach, and a server refuses the
 * raw account token whenever the two differ.
 *
 * Matched on machineIdentifier, because the address the user typed is rarely one
 * of the connection URIs plex.tv advertises.
 */
export async function serverToken(
  accountToken: string,
  clientId: string,
  baseUrl: string
): Promise<string> {
  const machine = (await identity(baseUrl))?.machineIdentifier;
  if (!machine) return accountToken;
  try {
    const res = await fetchWithTimeout('https://plex.tv/api/v2/resources?includeHttps=1', {
      headers: { ...plexHeaders(clientId), 'X-Plex-Token': accountToken },
    });
    if (!res.ok) return accountToken;
    const list = (await res.json()) as Array<{
      clientIdentifier?: string;
      accessToken?: string;
    }>;
    const mine = list.find(r => r.clientIdentifier === machine);
    return mine?.accessToken || accountToken;
  } catch {
    // plex.tv unreachable while the server is not. The account token is still
    // the best guess, and the server refuses it in its own words.
    return accountToken;
  }
}

export function toRemoteTrack(item: PlexTrack): RemoteTrack {
  const media = item.Media?.[0];
  const part = media?.Part?.[0];
  return {
    remoteId: part?.id ? `${item.ratingKey}:${part.id}` : String(item.ratingKey),
    title: item.title || 'Unknown',
    album: item.parentTitle ?? null,
    // The more specific of the two wherever Plex set it.
    artists: [item.originalTitle || item.grandparentTitle].filter(Boolean) as string[],
    albumArtists: item.grandparentTitle ? [item.grandparentTitle] : [],
    genres: (item.Genre ?? []).map(g => g.tag).filter(Boolean) as string[],
    trackNumber: item.index ?? null,
    discNumber: item.parentIndex ?? null,
    // Plex files the year on the album; a track carries one only sometimes.
    year: item.year ?? item.parentYear ?? null,
    durationSec: item.duration ? Math.round(item.duration / 1000) : null,
    container: media?.container ?? part?.container ?? null,
    path: part?.file ?? null,
    // The album's sleeve where the track has no cover of its own.
    artKey: item.thumb ?? item.parentThumb ?? null,
  };
}

export const plexProvider: SourceProvider = {
  type: 'plex',
  label: 'Plex',
  scheme: 'plex',
  tokenAuth: true,

  async connect(input: ConnectInput): Promise<ConnectResult> {
    const baseUrl = trimTrailingSlash(input.baseUrl);
    const deviceId = generateClientId();
    const pasted = input.token?.trim();

    if (!pasted && !(input.username && input.password)) {
      throw new Error('Paste a Plex token, or give the username and password for your Plex account');
    }
    // A pasted token is already server-scoped; one from plex.tv is not.
    const token = pasted
      ? pasted
      : await serverToken(
          await signIn(input.username as string, input.password as string, deviceId),
          deviceId,
          baseUrl
        );

    const credentials: SourceCredentials = {
      baseUrl,
      username: input.username || null,
      userId: null,
      accessToken: token,
      deviceId,
      config: {},
    };

    // The only thing that proves the token against the server actually typed.
    let root;
    try {
      root = await api(credentials, '/');
    } catch (err) {
      // A server nobody has claimed belongs to no account, so every token is
      // refused and no field in the dialog can help. It admits this
      // unauthenticated, which is worth asking before blaming the token.
      if ((err as { status?: number }).status === 401 && (await identity(baseUrl))?.claimed === false) {
        throw new Error(
          'That server has not been claimed by a Plex account yet, so it refuses every token. Open it at its own address, sign in there to claim it, then connect here.'
        );
      }
      throw err;
    }
    return {
      displayName: root.MediaContainer?.friendlyName || new URL(baseUrl).host,
      credentials,
    };
  },

  async listTracks(c, onProgress) {
    const sections: Array<{ key: string; type?: string; title?: string }> =
      (await api(c, '/library/sections')).MediaContainer?.Directory ?? [];
    const music = sections.filter(s => s.type === SECTION_TYPE_MUSIC);

    const tracks: RemoteTrack[] = [];
    // Grows as each section reports its size, rather than claiming to know the
    // whole library before the first page.
    let expected = 0;

    for (const section of music) {
      for (let start = 0; ; start += PAGE_SIZE) {
        const body = await api(c, `/library/sections/${section.key}/all`, {
          type: ITEM_TYPE_TRACK,
          'X-Plex-Container-Start': String(start),
          'X-Plex-Container-Size': String(PAGE_SIZE),
        });
        const page: PlexTrack[] = body.MediaContainer?.Metadata ?? [];
        if (start === 0) expected += body.MediaContainer?.totalSize ?? page.length;
        for (const item of page) tracks.push(toRemoteTrack(item));
        onProgress?.(tracks.length, Math.max(expected, tracks.length));
        if (page.length < PAGE_SIZE) break;
      }
    }
    return tracks;
  },

  /**
   * The stored file, which answers 206 and honours Range, so seeking works with
   * no code here.
   *
   * Part keys come off the API as `/library/parts/<id>/<analysed at>/file.mp3`,
   * but the server ignores everything after the id: a wrong timestamp, a wrong
   * extension and both omitted all return the same bytes. Only the id is real,
   * which is what lets it live in a remoteId.
   *
   * Not `/music/:/transcode/universal`, which answers chunked with no Range even
   * once given every client header it asks for.
   */
  streamUrl(c, remoteId) {
    const { partId } = splitRemoteId(remoteId);
    if (!partId) throw new Error('This Plex track has no file on the server; re-sync the source');
    return apiUrl(c, `/library/parts/${encodeURIComponent(partId)}`);
  },

  downloadUrl(c, remoteId) {
    const { partId } = splitRemoteId(remoteId);
    if (!partId) throw new Error('This Plex track has no file on the server; re-sync the source');
    return apiUrl(c, `/library/parts/${encodeURIComponent(partId)}`, { download: '1' });
  },

  artUrl(c, track) {
    if (!track.artKey) return null;
    return apiUrl(c, track.artKey);
  },

  async details(c, remoteId): Promise<RemoteTrackDetails | null> {
    const { ratingKey } = splitRemoteId(remoteId);
    const item: PlexTrack | undefined = (
      await api(c, `/library/metadata/${encodeURIComponent(ratingKey)}`)
    ).MediaContainer?.Metadata?.[0];
    const media = item?.Media?.[0];
    const part = media?.Part?.[0];
    if (!media) return null;
    // streamType 2 is the audio stream; 1 is video, 3 subtitles.
    const audio = part?.Stream?.find(s => s.streamType === 2);
    return {
      codec: audio?.codec ?? media.audioCodec ?? null,
      // Plex counts kbps, the info dialog divides by 1000.
      bitRate: media.bitrate ? media.bitrate * 1000 : null,
      sampleRate: audio?.samplingRate ?? null,
      channels: audio?.channels ?? media.audioChannels ?? null,
      container: media.container ?? part?.container ?? null,
      size: part?.size ?? null,
      path: part?.file ?? null,
    };
  },

  async ping(c) {
    try {
      // Answers without a token, which is what keeps "server offline" apart
      // from "token expired".
      const res = await fetchWithTimeout(`${trimTrailingSlash(c.baseUrl)}/identity`, {
        timeoutMs: PING_TIMEOUT_MS,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return { reachable: true, authValid: false };
    } catch {
      return { reachable: false, authValid: false };
    }
    try {
      await api(c, '/library/sections', {}, PING_TIMEOUT_MS);
      return { reachable: true, authValid: true };
    } catch {
      return { reachable: true, authValid: false };
    }
  },
};
