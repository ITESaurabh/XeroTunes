import { Client } from '@xhayper/discord-rpc';
import type { SetActivity } from '@xhayper/discord-rpc';
import { DISCORD_CLIENT_ID } from '../../config/constants';

export interface NowPlayingData {
  title: string;
  artist: string;
  album: string;
  /** Whether the track is currently playing (false = paused) */
  isPlaying: boolean;
  /** Current playback position in seconds */
  position: number;
  /** Total track duration in seconds */
  duration: number;
}

let rpcClient: Client | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentActivity: NowPlayingData | null = null;
/** Whether the user has enabled Discord presence */
let presenceEnabled = false;

const RECONNECT_DELAY_MS = 15_000;

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    if (presenceEnabled) connect();
  }, RECONNECT_DELAY_MS);
}

async function destroyClient() {
  if (rpcClient) {
    try {
      await rpcClient.destroy();
    } catch {
      // ignore
    }
    rpcClient = null;
  }
}

async function connect() {
  if (!presenceEnabled) return;
  if (rpcClient?.isConnected) return;

  await destroyClient();

  rpcClient = new Client({ clientId: DISCORD_CLIENT_ID, transport: { type: 'ipc' } });

  rpcClient.on('ready', () => {
    clearReconnectTimer();
    if (currentActivity?.isPlaying) {
      applyActivity(currentActivity);
    }
  });

  rpcClient.on('disconnected', () => {
    destroyClient();
    if (presenceEnabled) scheduleReconnect();
  });

  try {
    await rpcClient.connect();
  } catch {
    await destroyClient();
    if (presenceEnabled) scheduleReconnect();
  }
}

function applyActivity(data: NowPlayingData) {
  if (!rpcClient?.isConnected || !rpcClient.user) return;

  const now = Date.now();

  const stateStr = [data.artist, data.album].filter(Boolean).join(' \u2022 ');

  const activity: SetActivity = {
    type: 2, // Listening
    name: `${data.title ?? 'Music'}`, // Line 0 — fixed string shown above track title
    statusDisplayType: 0,
    // endTimestamp:
    startTimestamp: new Date(now - data.position * 1000),
    // Line 1 — track title (mirrors Spotify's "Song Name")
    details: data.title || 'Unknown Track',
    // Line 2 — "Artist • Album" (mirrors Spotify's artist + context line)
    state: stateStr || undefined,
    // Large image = app logo; tooltip shows album name like Spotify shows album art tooltip
    largeImageKey: 'app_icon',
    largeImageText: 'Xero Music Player',
    // Small badge = play / pause indicator
    smallImageKey: data.isPlaying ? 'playing' : 'paused',
    smallImageText: data.isPlaying ? 'Playing' : 'Paused',
    instance: false,
  };

  if (data.isPlaying && data.duration > 0) {
    const elapsed = Math.min(data.position, data.duration);
    activity.startTimestamp = new Date(now - elapsed * 1000);
    activity.endTimestamp = new Date(now + (data.duration - elapsed) * 1000);
  }

  rpcClient.user.setActivity(activity).catch(() => {
    destroyClient();
    if (presenceEnabled) scheduleReconnect();
  });
}

// Public API

/** Enable or disable Discord presence. Connects / disconnects as needed. */
export function setPresenceEnabled(enabled: boolean): void {
  presenceEnabled = enabled;
  if (enabled) {
    connect();
  } else {
    clearReconnectTimer();
    if (rpcClient?.isConnected && rpcClient.user) {
      rpcClient.user.clearActivity().catch(() => undefined);
    }
    destroyClient();
    currentActivity = null;
  }
}

/** Update the currently displayed activity. No-op if presence is disabled. */
export function updatePresence(data: NowPlayingData): void {
  if (!presenceEnabled) return;
  currentActivity = data;
  if (!data.isPlaying) {
    if (rpcClient?.isConnected && rpcClient.user) {
      rpcClient.user.clearActivity().catch(() => undefined);
    }
    return;
  }
  if (rpcClient?.isConnected) {
    applyActivity(data);
  } else {
    connect();
  }
}

/** Clear the activity (e.g. nothing is playing). */
export function clearPresence(): void {
  currentActivity = null;
  if (rpcClient?.isConnected && rpcClient.user) {
    rpcClient.user.clearActivity().catch(() => undefined);
  }
}

/** Call on app quit to cleanly tear down the RPC client. */
export function destroyPresence(): void {
  clearReconnectTimer();
  destroyClient();
  currentActivity = null;
  presenceEnabled = false;
}
