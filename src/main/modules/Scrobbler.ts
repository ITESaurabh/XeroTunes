import fs from 'fs';
import path from 'path';
import { shell } from 'electron';
import { APP_CONF_FOLDER } from '../../config/core_config';
import {
  LASTFM_API_KEY,
  LASTFM_API_SECRET,
  LIBREFM_API_KEY,
  LIBREFM_API_SECRET,
} from '../../config/constants';
import { lastfmSignature } from '../utils/scrobbleSig';

/**
 * Two wire protocols cover every service here: Last.fm, Libre.fm and any
 * GNU FM instance all speak the AudioScrobbler 2.0 API, and ListenBrainz
 * (org or self-hosted) speaks its own. Everything else is just a base URL.
 */
export type ScrobbleProtocol = 'audioscrobbler' | 'listenbrainz';

export type ScrobbleProvider =
  | 'lastfm'
  | 'librefm'
  | 'gnufm'
  | 'listenbrainz'
  | 'listenbrainz-custom';

export const SCROBBLE_PROVIDERS: ScrobbleProvider[] = [
  'lastfm',
  'librefm',
  'listenbrainz',
  'gnufm',
  'listenbrainz-custom',
];

export interface ScrobbleTrack {
  artist: string;
  track: string;
  album?: string;
  duration?: number;
  /** Unix seconds at which playback of the track started. */
  timestamp?: number;
}

interface ProviderState {
  enabled: boolean;
  /** AudioScrobbler session key, or ListenBrainz user token. */
  credential: string | null;
  username: string | null;
  /** Server root for the self-hosted providers; null for the fixed ones. */
  baseUrl: string | null;
  queue: ScrobbleTrack[];
  /** Why the last submission failed, verbatim from the service. */
  lastError: string | null;
}

type ScrobblerState = Record<ScrobbleProvider, ProviderState>;

export interface ProviderStatus {
  provider: ScrobbleProvider;
  label: string;
  protocol: ScrobbleProtocol;
  /** True when the user has to supply their own server URL first. */
  selfHosted: boolean;
  baseUrl: string | null;
  enabled: boolean;
  connected: boolean;
  username: string | null;
  pending: number;
  /** False when this build lacks the API credentials the service requires. */
  configured: boolean;
  lastError: string | null;
}

export type ScrobblerStatus = ProviderStatus[];

interface ProviderConfig {
  label: string;
  protocol: ScrobbleProtocol;
  selfHosted: boolean;
  /** Fixed service host; self-hosted providers take the user's instead. */
  host: string | null;
}

const PROVIDER_CONFIG: Record<ScrobbleProvider, ProviderConfig> = {
  lastfm: { label: 'Last.fm', protocol: 'audioscrobbler', selfHosted: false, host: null },
  librefm: {
    label: 'Libre.fm',
    protocol: 'audioscrobbler',
    selfHosted: false,
    host: 'https://libre.fm',
  },
  gnufm: { label: 'GNU FM Server', protocol: 'audioscrobbler', selfHosted: true, host: null },
  listenbrainz: {
    label: 'ListenBrainz',
    protocol: 'listenbrainz',
    selfHosted: false,
    host: 'https://api.listenbrainz.org',
  },
  'listenbrainz-custom': {
    label: 'ListenBrainz Server',
    protocol: 'listenbrainz',
    selfHosted: true,
    host: null,
  },
};

const STATE_FILE = path.join(APP_CONF_FOLDER, 'scrobbler.json');
const LASTFM_API_ROOT = 'https://ws.audioscrobbler.com/2.0/';
const LASTFM_AUTH_ROOT = 'https://www.last.fm/api/auth/';
const MAX_BATCH = 50;
// ponytail: flat JSON file, oldest dropped first. Move to a SQLite table if a
// backlog this size ever stops being a "you were offline for a weekend" case.
const MAX_QUEUE = 500;

const emptyProvider = (): ProviderState => ({
  enabled: false,
  credential: null,
  username: null,
  baseUrl: null,
  queue: [],
  lastError: null,
});

let state: ScrobblerState | null = null;

function load(): ScrobblerState {
  if (state) return state;
  let parsed: Partial<Record<ScrobbleProvider, Partial<ProviderState>>> = {};
  try {
    parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    /* missing or corrupt — start clean */
  }
  const next = {} as ScrobblerState;
  for (const p of SCROBBLE_PROVIDERS) {
    next[p] = { ...emptyProvider(), ...(parsed[p] ?? {}) };
    if (!Array.isArray(next[p].queue)) next[p].queue = [];
  }
  state = next;
  return state;
}

function save(): void {
  if (!state) return;
  try {
    if (!fs.existsSync(APP_CONF_FOLDER)) fs.mkdirSync(APP_CONF_FOLDER, { recursive: true });
    // 0600: the file holds session keys that grant scrobble access to accounts.
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch (err) {
    console.warn('Failed to persist scrobbler state:', err);
  }
}

// ── Endpoints ───────────────────────────────────────────────────────────────

/** Strips the trailing slash and rejects anything that isn't an http(s) URL. */
function normalizeBase(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/i.test(trimmed)) return null;
  return trimmed;
}

/** Resolved service root, or null when a self-hosted URL is missing/invalid. */
function serviceHost(provider: ScrobbleProvider): string | null {
  const config = PROVIDER_CONFIG[provider];
  return config.selfHosted ? normalizeBase(load()[provider].baseUrl) : config.host;
}

function apiRoot(provider: ScrobbleProvider): string | null {
  if (provider === 'lastfm') return LASTFM_API_ROOT;
  const host = serviceHost(provider);
  if (!host) return null;
  return PROVIDER_CONFIG[provider].protocol === 'audioscrobbler' ? `${host}/2.0/` : `${host}/1`;
}

function authUrl(provider: ScrobbleProvider, token: string): string | null {
  const key = apiCredentials(provider).key;
  if (provider === 'lastfm') return `${LASTFM_AUTH_ROOT}?api_key=${key}&token=${token}`;
  const host = serviceHost(provider);
  return host ? `${host}/api/auth?api_key=${key}&token=${token}` : null;
}

function apiCredentials(provider: ScrobbleProvider): { key: string; secret: string } {
  if (provider === 'lastfm') {
    return { key: LASTFM_API_KEY ?? '', secret: LASTFM_API_SECRET ?? '' };
  }
  // GNU FM only length-checks the signature, so self-hosted servers get these too.
  return { key: LIBREFM_API_KEY, secret: LIBREFM_API_SECRET };
}

function isConfigured(provider: ScrobbleProvider): boolean {
  if (provider === 'lastfm') return Boolean(LASTFM_API_KEY && LASTFM_API_SECRET);
  return true;
}

// ── AudioScrobbler API ──────────────────────────────────────────────────────

interface ScrobblerApiError extends Error {
  code?: number;
}

/** Throws with `.code` set for API-level errors, without it for transport failures. */
async function audioscrobblerRequest(
  provider: ScrobbleProvider,
  params: Record<string, string>
): Promise<Record<string, any>> {
  const root = apiRoot(provider);
  if (!root) throw new Error('Set this server’s address first.');
  const { key, secret } = apiCredentials(provider);
  const signed = { ...params, api_key: key };
  const body = new URLSearchParams({
    ...signed,
    api_sig: lastfmSignature(signed, secret),
    format: 'json',
  });
  const res = await fetch(root, { method: 'POST', body });
  const json = (await res.json().catch(() => null)) as Record<string, any> | null;
  if (!json) throw new Error(`${PROVIDER_CONFIG[provider].label} returned HTTP ${res.status}`);
  if (json.error) {
    const err: ScrobblerApiError = new Error(json.message || `Error ${json.error}`);
    err.code = Number(json.error);
    throw err;
  }
  return json;
}

// ── Submission ──────────────────────────────────────────────────────────────

type SubmitResult = 'ok' | 'retry' | 'drop' | 'auth';

function noteError(provider: ScrobbleProvider, message: string | null): void {
  load()[provider].lastError = message;
}

async function submitAudioscrobbler(
  provider: ScrobbleProvider,
  tracks: ScrobbleTrack[],
  nowPlaying: boolean
): Promise<SubmitResult> {
  const credential = load()[provider].credential;
  if (!credential) return 'drop';

  const params: Record<string, string> = { sk: credential };
  if (nowPlaying) {
    const t = tracks[0];
    params.method = 'track.updateNowPlaying';
    params.artist = t.artist;
    params.track = t.track;
    if (t.album) params.album = t.album;
    if (t.duration) params.duration = String(Math.round(t.duration));
  } else {
    params.method = 'track.scrobble';
    tracks.forEach((t, i) => {
      params[`artist[${i}]`] = t.artist;
      params[`track[${i}]`] = t.track;
      params[`timestamp[${i}]`] = String(t.timestamp);
      if (t.album) params[`album[${i}]`] = t.album;
      if (t.duration) params[`duration[${i}]`] = String(Math.round(t.duration));
    });
  }

  try {
    await audioscrobblerRequest(provider, params);
    noteError(provider, null);
    return 'ok';
  } catch (err) {
    const code = (err as ScrobblerApiError).code;
    noteError(provider, (err as Error).message);
    // 4 = auth failed, 9 = invalid session key. 11/16 = service down, 29 = rate limit.
    if (code === 4 || code === 9) return 'auth';
    if (code === undefined || code === 11 || code === 16 || code === 29) return 'retry';
    return 'drop';
  }
}

async function submitListenBrainz(
  provider: ScrobbleProvider,
  tracks: ScrobbleTrack[],
  nowPlaying: boolean
): Promise<SubmitResult> {
  const credential = load()[provider].credential;
  const root = apiRoot(provider);
  if (!credential || !root) return 'drop';

  const payload = tracks.map(t => ({
    ...(nowPlaying ? {} : { listened_at: t.timestamp }),
    track_metadata: {
      artist_name: t.artist,
      track_name: t.track,
      ...(t.album ? { release_name: t.album } : {}),
      additional_info: {
        media_player: 'XeroTunes',
        ...(t.duration ? { duration_ms: Math.round(t.duration * 1000) } : {}),
      },
    },
  }));

  try {
    const res = await fetch(`${root}/submit-listens`, {
      method: 'POST',
      headers: { Authorization: `Token ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listen_type: nowPlaying ? 'playing_now' : tracks.length > 1 ? 'import' : 'single',
        payload,
      }),
    });
    if (res.ok) {
      noteError(provider, null);
      return 'ok';
    }
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    noteError(provider, body?.error || `${PROVIDER_CONFIG[provider].label} returned ${res.status}`);
    // 401 also covers an account with an unverified email, which reconnecting
    // won't fix, so it never means the credential itself is dead.
    if (res.status === 401 || res.status === 429 || res.status >= 500) return 'retry';
    return 'drop';
  } catch (err) {
    noteError(provider, (err as Error).message);
    return 'retry';
  }
}

function submit(
  provider: ScrobbleProvider,
  tracks: ScrobbleTrack[],
  nowPlaying: boolean
): Promise<SubmitResult> {
  return PROVIDER_CONFIG[provider].protocol === 'audioscrobbler'
    ? submitAudioscrobbler(provider, tracks, nowPlaying)
    : submitListenBrainz(provider, tracks, nowPlaying);
}

let flushing = false;

/** Drains every provider's backlog. Safe to call often; overlapping calls no-op. */
export async function flushScrobbles(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (const provider of SCROBBLE_PROVIDERS) {
      const st = load()[provider];
      while (st.enabled && st.credential && st.queue.length) {
        const batch = st.queue.slice(0, MAX_BATCH);
        const result = await submit(provider, batch, false);
        if (result === 'retry') {
          save();
          break;
        }
        if (result === 'auth') {
          st.credential = null;
          st.username = null;
          save();
          break;
        }
        // 'ok' and 'drop' both consume the batch — a rejected batch would be
        // rejected forever and block everything queued behind it.
        st.queue.splice(0, batch.length);
        save();
      }
    }
  } finally {
    flushing = false;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export function getScrobblerStatus(): ScrobblerStatus {
  const s = load();
  return SCROBBLE_PROVIDERS.map(provider => {
    const config = PROVIDER_CONFIG[provider];
    return {
      provider,
      label: config.label,
      protocol: config.protocol,
      selfHosted: config.selfHosted,
      baseUrl: s[provider].baseUrl,
      enabled: s[provider].enabled,
      connected: Boolean(s[provider].credential),
      username: s[provider].username,
      pending: s[provider].queue.length,
      configured: isConfigured(provider),
      lastError: s[provider].lastError,
    };
  });
}

const pendingTokens = new Map<ScrobbleProvider, string>();

/**
 * Step 1 of the AudioScrobbler web auth: get a request token and send the user
 * to the service to approve it. `baseUrl` is required for self-hosted servers.
 */
export async function startWebAuth(provider: ScrobbleProvider, baseUrl?: string): Promise<void> {
  if (PROVIDER_CONFIG[provider].protocol !== 'audioscrobbler') {
    throw new Error('This service authenticates with a user token.');
  }
  if (!isConfigured(provider)) throw new Error('This build has no Last.fm API credentials.');
  if (PROVIDER_CONFIG[provider].selfHosted) {
    const normalized = normalizeBase(baseUrl);
    if (!normalized) throw new Error('Enter the server address, e.g. https://fm.example.org');
    load()[provider].baseUrl = normalized;
    save();
  }
  const json = await audioscrobblerRequest(provider, { method: 'auth.getToken' });
  const token = json.token as string;
  if (!token) throw new Error('The server did not return a token.');
  pendingTokens.set(provider, token);
  const url = authUrl(provider, token);
  if (!url) throw new Error('Could not build the approval URL.');
  await shell.openExternal(url);
}

/** Step 2: exchange the approved token for a session key. */
export async function finishWebAuth(provider: ScrobbleProvider): Promise<ScrobblerStatus> {
  const token = pendingTokens.get(provider);
  if (!token) throw new Error('Start the connection first.');
  const json = await audioscrobblerRequest(provider, { method: 'auth.getSession', token });
  const key = json.session?.key as string | undefined;
  if (!key) throw new Error('The server did not return a session.');
  pendingTokens.delete(provider);
  const st = load()[provider];
  st.credential = key;
  st.username = (json.session?.name as string) ?? null;
  st.enabled = true;
  st.lastError = null;
  save();
  void flushScrobbles();
  return getScrobblerStatus();
}

/** ListenBrainz auth: validate the user token and remember it. */
export async function connectWithToken(
  provider: ScrobbleProvider,
  token: string,
  baseUrl?: string
): Promise<ScrobblerStatus> {
  if (PROVIDER_CONFIG[provider].protocol !== 'listenbrainz') {
    throw new Error('This service authenticates in the browser.');
  }
  const trimmed = (token ?? '').trim();
  if (!trimmed) throw new Error('Enter your user token.');
  if (PROVIDER_CONFIG[provider].selfHosted) {
    const normalized = normalizeBase(baseUrl);
    if (!normalized) throw new Error('Enter the server address, e.g. https://lb.example.org');
    load()[provider].baseUrl = normalized;
    save();
  }
  const root = apiRoot(provider);
  if (!root) throw new Error('Could not resolve the server address.');
  const res = await fetch(`${root}/validate-token`, {
    headers: { Authorization: `Token ${trimmed}` },
  });
  const json = (await res.json().catch(() => null)) as Record<string, any> | null;
  if (!res.ok || !json?.valid) throw new Error(json?.message || 'The server rejected that token.');
  const st = load()[provider];
  st.credential = trimmed;
  st.username = (json.user_name as string) ?? null;
  st.enabled = true;
  st.lastError = null;
  save();
  void flushScrobbles();
  return getScrobblerStatus();
}

export function disconnectScrobbler(provider: ScrobbleProvider): ScrobblerStatus {
  const st = load()[provider];
  st.credential = null;
  st.username = null;
  st.enabled = false;
  st.queue = [];
  st.lastError = null;
  pendingTokens.delete(provider);
  save();
  return getScrobblerStatus();
}

export function setScrobblerEnabled(provider: ScrobbleProvider, enabled: boolean): ScrobblerStatus {
  load()[provider].enabled = enabled;
  save();
  if (enabled) void flushScrobbles();
  return getScrobblerStatus();
}

/** Fire-and-forget "listening now" ping. Not queued — it's worthless once stale. */
export function scrobblerNowPlaying(track: ScrobbleTrack): void {
  if (!track?.artist || !track?.track) return;
  const s = load();
  for (const p of SCROBBLE_PROVIDERS) {
    if (s[p].enabled && s[p].credential) void submit(p, [track], true);
  }
}

/** Queue a completed play on every connected service and try to send it now. */
export function scrobbleTrack(track: ScrobbleTrack): void {
  if (!track?.artist || !track?.track) return;
  const s = load();
  const entry: ScrobbleTrack = {
    ...track,
    timestamp: track.timestamp ?? Math.floor(Date.now() / 1000),
  };
  let queued = false;
  for (const p of SCROBBLE_PROVIDERS) {
    const st = s[p];
    if (!st.enabled || !st.credential) continue;
    st.queue.push(entry);
    if (st.queue.length > MAX_QUEUE) st.queue.splice(0, st.queue.length - MAX_QUEUE);
    queued = true;
  }
  if (!queued) return;
  save();
  void flushScrobbles();
}

/** Retry whatever the last session couldn't deliver. */
export function initScrobbler(): void {
  void flushScrobbles();
}
