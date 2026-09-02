// Jellyfin provider over the public REST endpoints; no SDK dependency. All
// requests time out quickly so an offline server doesn't hang the UI.

import crypto from 'crypto';
import fs from 'fs';
import { app } from 'electron';
import type {
  ConnectInput,
  ConnectResult,
  RemoteTrack,
  RemoteTrackDetails,
  SourceCredentials,
  SourceProvider,
} from './types';

const REQUEST_TIMEOUT_MS = 8000;

// 600 is visibly soft full-screen; embedded covers are usually 1000-1500 square.
const ART_MAX_WIDTH = 1200;

export interface JellyfinAuthResult {
  accessToken: string;
  userId: string;
  username: string;
  serverId: string;
  serverName: string;
  deviceId: string;
}

export interface JellyfinAudioItem {
  Id: string;
  Name: string;
  AlbumId?: string | null;
  Album?: string | null;
  AlbumArtist?: string | null;
  AlbumArtists?: Array<{ Id?: string; Name: string }>;
  Artists?: string[];
  ArtistItems?: Array<{ Id?: string; Name: string }>;
  Genres?: string[];
  IndexNumber?: number | null;
  ParentIndexNumber?: number | null;
  ProductionYear?: number | null;
  RunTimeTicks?: number | null;
  Path?: string | null;
  Container?: string | null;
  ImageTags?: Record<string, string>;
  AlbumPrimaryImageTag?: string | null;
  Type?: string;
  DateCreated?: string | null;
  PremiereDate?: string | null;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function buildAuthorizationHeader(opts: {
  client: string;
  device: string;
  deviceId: string;
  version: string;
  token?: string;
}): string {
  const parts = [
    `Client="${opts.client}"`,
    `Device="${opts.device}"`,
    `DeviceId="${opts.deviceId}"`,
    `Version="${opts.version}"`,
  ];
  if (opts.token) parts.push(`Token="${opts.token}"`);
  return `MediaBrowser ${parts.join(', ')}`;
}

export function generateDeviceId(): string {
  return crypto.randomBytes(12).toString('hex');
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

const CLIENT_NAME = 'Xero Music Player';
// Jellyfin shows this in its device list, so it should track the real build.
const CLIENT_VERSION = app.getVersion();

export async function authenticateByName(
  rawBaseUrl: string,
  username: string,
  password: string,
  deviceId?: string
): Promise<JellyfinAuthResult> {
  const baseUrl = trimTrailingSlash(rawBaseUrl);
  const useDeviceId = deviceId || generateDeviceId();
  const authHeader = buildAuthorizationHeader({
    client: CLIENT_NAME,
    device: 'Desktop',
    deviceId: useDeviceId,
    version: CLIENT_VERSION,
  });

  const res = await fetchWithTimeout(`${baseUrl}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
      'X-Emby-Authorization': authHeader,
    },
    body: JSON.stringify({ Username: username, Pw: password }),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = await res.text();
    } catch {
      /* swallow */
    }
    throw new Error(`Authentication failed (${res.status}): ${detail}`);
  }

  const json = (await res.json()) as {
    AccessToken: string;
    User: { Id: string; Name: string };
    ServerId: string;
  };

  let serverName = baseUrl;
  try {
    const info = await fetchWithTimeout(`${baseUrl}/System/Info/Public`);
    if (info.ok) {
      const infoJson = (await info.json()) as { ServerName?: string };
      if (infoJson.ServerName) serverName = infoJson.ServerName;
    }
  } catch {
    /* swallow; auth already succeeded */
  }

  return {
    accessToken: json.AccessToken,
    userId: json.User.Id,
    username: json.User.Name,
    serverId: json.ServerId,
    serverName,
    deviceId: useDeviceId,
  };
}

// Uses the public info endpoint, so it answers even with an expired access
// token; that separates "server offline" from "token expired".
export async function pingServer(
  rawBaseUrl: string,
  accessToken?: string,
  deviceId?: string
): Promise<{ reachable: boolean; authValid: boolean }> {
  const baseUrl = trimTrailingSlash(rawBaseUrl);
  let reachable = false;
  let authValid = false;

  try {
    const res = await fetchWithTimeout(`${baseUrl}/System/Info/Public`, { timeoutMs: 4000 });
    reachable = res.ok;
  } catch {
    return { reachable: false, authValid: false };
  }

  if (reachable && accessToken) {
    try {
      const authHeader = buildAuthorizationHeader({
        client: CLIENT_NAME,
        device: 'Desktop',
        deviceId: deviceId || 'unknown',
        version: CLIENT_VERSION,
        token: accessToken,
      });
      const res = await fetchWithTimeout(`${baseUrl}/Users/Me`, {
        timeoutMs: 4000,
        headers: { Authorization: authHeader, 'X-Emby-Authorization': authHeader },
      });
      authValid = res.ok;
    } catch {
      authValid = false;
    }
  }

  return { reachable, authValid };
}

// Jellyfin will return a whole library in one response; paginate to keep
// memory bounded.
export async function listAudioItems(
  rawBaseUrl: string,
  accessToken: string,
  userId: string,
  deviceId: string,
  onProgress?: (_loaded: number, _total: number) => void
): Promise<JellyfinAudioItem[]> {
  const baseUrl = trimTrailingSlash(rawBaseUrl);
  const authHeader = buildAuthorizationHeader({
    client: CLIENT_NAME,
    device: 'Desktop',
    deviceId,
    version: CLIENT_VERSION,
    token: accessToken,
  });

  const fields = [
    'Genres',
    'AlbumArtists',
    'ArtistItems',
    'IndexNumber',
    'ParentIndexNumber',
    'ProductionYear',
    'PremiereDate',
    'DateCreated',
    'Path',
    'RunTimeTicks',
    'Container',
  ].join(',');

  const PAGE_SIZE = 500;
  const items: JellyfinAudioItem[] = [];
  let startIndex = 0;
  let total = 0;
  let done = false;

  while (!done) {
    const params = new URLSearchParams({
      IncludeItemTypes: 'Audio',
      Recursive: 'true',
      Fields: fields,
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      StartIndex: String(startIndex),
      Limit: String(PAGE_SIZE),
      UserId: userId,
    });

    const res = await fetchWithTimeout(`${baseUrl}/Items?${params.toString()}`, {
      timeoutMs: 30000,
      headers: { Authorization: authHeader, 'X-Emby-Authorization': authHeader },
    });
    if (!res.ok) {
      throw new Error(`Items fetch failed (${res.status}): ${res.statusText}`);
    }
    const data = (await res.json()) as {
      Items: JellyfinAudioItem[];
      TotalRecordCount: number;
    };
    total = data.TotalRecordCount ?? data.Items.length;
    items.push(...data.Items);
    if (onProgress) onProgress(items.length, total);

    if (data.Items.length < PAGE_SIZE || items.length >= total) {
      done = true;
    } else {
      startIndex += data.Items.length;
    }
  }

  return items;
}

// The token goes in the query string because Jellyfin accepts api_key there,
// and <audio> cannot send custom request headers.
export function streamUrl(
  rawBaseUrl: string,
  itemId: string,
  accessToken: string,
  deviceId: string
): string {
  const baseUrl = trimTrailingSlash(rawBaseUrl);
  const params = new URLSearchParams({
    api_key: accessToken,
    DeviceId: deviceId,
    // Everything Chromium decodes, so all but exotic formats direct-play: the
    // server sends the original bytes and honours Range, which is what makes
    // seeking work with no code on our side.
    Container: 'mp3,aac,m4a,flac,ogg,opus,wav,webma,webm',
    // Must agree with TranscodingContainer. Asking for aac-in-mp3 makes the
    // server answer 200 with an empty body, so anything needing a transcode
    // (a tracker module, ALAC, WMA) silently plays nothing.
    AudioCodec: 'mp3',
    TranscodingContainer: 'mp3',
    // A transcode is streamed chunked with no Range support, so those few
    // tracks play but can't be seeked. Duration still comes from RunTimeTicks.
    TranscodingProtocol: 'http',
  });
  return `${baseUrl}/Audio/${encodeURIComponent(itemId)}/universal?${params.toString()}`;
}

// The original file, tags intact. /universal (used for streaming) transcodes and
// re-muxes, which would hand the user a downgraded copy with its metadata stripped.
export function downloadUrl(rawBaseUrl: string, itemId: string, accessToken: string): string {
  const baseUrl = trimTrailingSlash(rawBaseUrl);
  return `${baseUrl}/Items/${encodeURIComponent(itemId)}/Download?api_key=${encodeURIComponent(
    accessToken
  )}`;
}

// Fetched per track when the info dialog opens rather than during sync:
// MediaSources roughly triples the size of a library listing, and this is read
// once in a while for one song.
export async function fetchTrackDetails(
  rawBaseUrl: string,
  accessToken: string,
  deviceId: string,
  userId: string,
  itemId: string
): Promise<RemoteTrackDetails | null> {
  const baseUrl = trimTrailingSlash(rawBaseUrl);
  const authHeader = buildAuthorizationHeader({
    client: CLIENT_NAME,
    device: 'Desktop',
    deviceId,
    version: CLIENT_VERSION,
    token: accessToken,
  });
  const res = await fetchWithTimeout(
    `${baseUrl}/Items/${encodeURIComponent(itemId)}?Fields=MediaSources&UserId=${encodeURIComponent(userId)}`,
    { headers: { Authorization: authHeader, 'X-Emby-Authorization': authHeader } }
  );
  if (!res.ok) return null;
  const item = (await res.json()) as {
    MediaSources?: Array<{
      Size?: number;
      Container?: string;
      Path?: string;
      MediaStreams?: Array<{
        Type?: string;
        Codec?: string;
        BitRate?: number;
        SampleRate?: number;
        Channels?: number;
      }>;
    }>;
  };
  const source = item.MediaSources?.[0];
  if (!source) return null;
  const audio = source.MediaStreams?.find(st => st.Type === 'Audio');
  return {
    codec: audio?.Codec ?? null,
    bitRate: audio?.BitRate ?? null,
    sampleRate: audio?.SampleRate ?? null,
    channels: audio?.Channels ?? null,
    container: source.Container ?? null,
    size: source.Size ?? null,
    path: source.Path ?? null,
  };
}

function ticksToLrcStamp(ticks: number): string {
  const total = ticks / 10_000_000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `[${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}]`;
}

// Returned as LRC text so it drops straight into the player's existing lyrics
// parser, which decides synced vs unsynced by looking for timestamps.
export async function fetchLyrics(
  rawBaseUrl: string,
  accessToken: string,
  deviceId: string,
  itemId: string
): Promise<string | null> {
  const baseUrl = trimTrailingSlash(rawBaseUrl);
  const authHeader = buildAuthorizationHeader({
    client: CLIENT_NAME,
    device: 'Desktop',
    deviceId,
    version: CLIENT_VERSION,
    token: accessToken,
  });
  const res = await fetchWithTimeout(`${baseUrl}/Audio/${encodeURIComponent(itemId)}/Lyrics`, {
    headers: { Authorization: authHeader, 'X-Emby-Authorization': authHeader },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    Lyrics?: Array<{ Text?: string; Start?: number }>;
  };
  const lines = data.Lyrics ?? [];
  if (!lines.length) return null;
  // Jellyfin leaves a BOM on lines lifted out of some .lrc files.
  const clean = (t: string) => t.replace(/^\uFEFF/, '').trim();
  const synced = lines.some(l => typeof l.Start === 'number' && l.Start > 0);
  return lines
    .map(l =>
      synced && typeof l.Start === 'number'
        ? `${ticksToLrcStamp(l.Start)}${clean(l.Text ?? '')}`
        : clean(l.Text ?? '')
    )
    .join('\n');
}

export function imageUrl(
  rawBaseUrl: string,
  itemId: string,
  type: 'Primary' | 'Backdrop' | 'Logo' = 'Primary',
  options: { tag?: string; maxWidth?: number; quality?: number } = {}
): string {
  const baseUrl = trimTrailingSlash(rawBaseUrl);
  const params = new URLSearchParams();
  if (options.tag) params.set('tag', options.tag);
  if (options.maxWidth) params.set('maxWidth', String(options.maxWidth));
  params.set('quality', String(options.quality ?? 90));
  const qs = params.toString();
  return `${baseUrl}/Items/${encodeURIComponent(itemId)}/Images/${type}${qs ? '?' + qs : ''}`;
}

export async function downloadImage(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(url, { timeoutMs: 15000 });
    if (!res.ok) return false;
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
    return true;
  } catch {
    return false;
  }
}

export function ticksToSeconds(ticks?: number | null): number | null {
  if (!ticks || ticks <= 0) return null;
  return Math.round(ticks / 10_000_000);
}

// ── Provider adapter ─────────────────────────────────────────────────────────

function requireCreds(c: SourceCredentials): {
  baseUrl: string;
  token: string;
  deviceId: string;
  userId: string;
} {
  if (!c.baseUrl || !c.accessToken || !c.deviceId || !c.userId) {
    throw new Error('Jellyfin source is missing credentials');
  }
  return {
    baseUrl: c.baseUrl,
    token: c.accessToken,
    deviceId: c.deviceId,
    userId: c.userId,
  };
}

function pickNames(
  entities: Array<{ Name: string }> | undefined,
  fallback: string[] | undefined
): string[] {
  const named = (entities ?? []).map(e => e.Name).filter(Boolean);
  return named.length ? named : (fallback ?? []).filter(Boolean);
}

function toRemoteTrack(item: JellyfinAudioItem): RemoteTrack {
  return {
    remoteId: item.Id,
    title: item.Name || 'Unknown',
    album: item.Album?.trim() || null,
    // The list endpoint leaves ArtistItems/AlbumArtists empty whenever the name
    // isn't a linked entity on the server (282 and 349 of 1684 items in one real
    // library), while the plain string fields stay populated. Reading only the
    // entity arrays silently drops the artist for those tracks.
    artists: pickNames(item.ArtistItems, item.Artists),
    albumArtists: pickNames(item.AlbumArtists, item.AlbumArtist ? [item.AlbumArtist] : []),
    genres: item.Genres ?? [],
    trackNumber: item.IndexNumber ?? null,
    discNumber: item.ParentIndexNumber ?? null,
    year: item.ProductionYear ?? null,
    durationSec: ticksToSeconds(item.RunTimeTicks),
    container: item.Container ?? null,
    path: item.Path ?? null,
    // The track's own embedded cover, which belongs to this album. Jellyfin's
    // AlbumId cover can belong to a folder holding many albums, so it's only
    // the fallback; see the album grouping note in sync.ts.
    artKey: item.ImageTags?.Primary
      ? `item:${item.Id}:${item.ImageTags.Primary}`
      : item.AlbumId && item.AlbumPrimaryImageTag
        ? `item:${item.AlbumId}:${item.AlbumPrimaryImageTag}`
        : null,
  };
}

export const jellyfinProvider: SourceProvider = {
  type: 'jellyfin',
  label: 'Jellyfin',
  scheme: 'jellyfin',

  async connect(input: ConnectInput): Promise<ConnectResult> {
    const auth = await authenticateByName(
      input.baseUrl,
      input.username ?? '',
      input.password ?? ''
    );
    return {
      displayName: auth.serverName || input.baseUrl,
      credentials: {
        baseUrl: input.baseUrl.replace(/\/+$/, ''),
        username: auth.username,
        userId: auth.userId,
        accessToken: auth.accessToken,
        deviceId: auth.deviceId,
        config: {},
      },
    };
  },

  async listTracks(c, onProgress) {
    const { baseUrl, token, deviceId, userId } = requireCreds(c);
    const items = await listAudioItems(baseUrl, token, userId, deviceId, onProgress);
    return items.map(toRemoteTrack);
  },

  streamUrl(c, remoteId) {
    const { baseUrl, token, deviceId } = requireCreds(c);
    return streamUrl(baseUrl, remoteId, token, deviceId);
  },

  downloadUrl(c, remoteId) {
    const { baseUrl, token } = requireCreds(c);
    return downloadUrl(baseUrl, remoteId, token);
  },

  artUrl(c, track) {
    if (!track.artKey) return null;
    const [, itemId, tag] = track.artKey.split(':');
    if (!itemId) return null;
    return imageUrl(c.baseUrl, itemId, 'Primary', { tag, maxWidth: ART_MAX_WIDTH });
  },

  lyrics(c, remoteId) {
    const { baseUrl, token, deviceId } = requireCreds(c);
    return fetchLyrics(baseUrl, token, deviceId, remoteId);
  },

  details(c, remoteId) {
    const { baseUrl, token, deviceId, userId } = requireCreds(c);
    return fetchTrackDetails(baseUrl, token, deviceId, userId, remoteId);
  },

  ping(c) {
    return pingServer(c.baseUrl, c.accessToken ?? undefined, c.deviceId ?? undefined);
  },
};
