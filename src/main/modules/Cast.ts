import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Bonjour from 'bonjour-service';
import { CAST_RECEIVER_APP_ID } from '../../config/constants';

type BonjourBrowser = ReturnType<InstanceType<typeof Bonjour>['find']>;

/** The subset of a bonjour Service record the discovery handlers read. */
interface DiscoveredService {
  name: string;
  port: number;
  addresses?: string[];
  referer?: { address: string };
  txt?: Record<string, string>;
}

import { inherits } from 'util';

// castv2-client ships no types; it's a callback-based CommonJS module.
/* eslint-disable @typescript-eslint/no-var-requires */
const castv2 = require('castv2-client');
/* eslint-enable @typescript-eslint/no-var-requires */
const Client = castv2.Client;
const DefaultMediaReceiver = castv2.DefaultMediaReceiver;

// A custom CAF receiver speaks the same media namespace as the stock one, so we
// reuse DefaultMediaReceiver's sender and only swap APP_ID.
function receiverApp(): unknown {
  if (!CAST_RECEIVER_APP_ID) return DefaultMediaReceiver;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function CustomReceiver(this: any, ...args: any[]) {
    DefaultMediaReceiver.apply(this, args);
  }
  (CustomReceiver as unknown as { APP_ID: string }).APP_ID = CAST_RECEIVER_APP_ID;
  inherits(CustomReceiver, DefaultMediaReceiver);
  return CustomReceiver;
}

export interface CastDevice {
  /** Stable per-device id (Cast TXT `id`), used to dedupe mDNS echoes. */
  id: string;
  name: string;
  host: string;
  port: number;
}

export interface CastStatus {
  /** PLAYING | PAUSED | BUFFERING | IDLE. */
  playerState: string;
  currentTime: number;
  duration: number;
}

export interface CastLoadPayload {
  filePath: string;
  title: string;
  artist: string;
  album: string;
  artPath?: string | null;
  currentTime?: number;
  autoplay?: boolean;
  customData?: Record<string, unknown>;
}

export interface CastListeners {
  onDevices?: (_devices: CastDevice[]) => void;
  onStatus?: (_status: CastStatus) => void;
  onConnected?: (_deviceId: string) => void;
  onEnded?: () => void;
  onError?: (_message: string) => void;
}

const CONTENT_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.webm': 'audio/webm',
};

const ART_CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

let listeners: CastListeners = {};

// ── Discovery ────────────────────────────────────────────────────────────────
let bonjour: Bonjour | null = null;
let browser: BonjourBrowser | null = null;
const devices = new Map<string, CastDevice>();

// ── Session ──────────────────────────────────────────────────────────────────
// `client` is a castv2-client PlatformSender, `player` a DefaultMediaReceiver.
/* eslint-disable @typescript-eslint/no-explicit-any */
let client: any = null;
let player: any = null;
/* eslint-enable @typescript-eslint/no-explicit-any */
let pollTimer: ReturnType<typeof setInterval> | null = null;
// Guards the status poll so unanswered requests can't stack up.
let statusPending = false;
let statusPendingSince = 0;
let lastDuration = 0;
let endedFired = false;

// ── Media server ─────────────────────────────────────────────────────────────
let mediaServer: http.Server | null = null;
let mediaFilePath: string | null = null;
let mediaArtPath: string | null = null;
let mediaPort = 0;

export function setCastListeners(next: CastListeners): void {
  listeners = next;
}

function pickIpv4(service: DiscoveredService): string | null {
  const addrs = service.addresses ?? [];
  const v4 = addrs.find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a));
  return v4 ?? service.referer?.address ?? null;
}

function emitDevices(): void {
  listeners.onDevices?.(Array.from(devices.values()));
}

export function startDiscovery(): void {
  if (browser) {
    emitDevices();
    return;
  }
  try {
    bonjour = bonjour ?? new Bonjour();
    browser = bonjour.find({ type: 'googlecast', protocol: 'tcp' });

    browser.on('up', service => {
      const host = pickIpv4(service);
      if (!host) return;
      const txt = (service.txt ?? {}) as Record<string, string>;
      const id = txt.id || `${host}:${service.port}`;
      devices.set(id, {
        id,
        name: txt.fn || service.name || 'Cast device',
        host,
        port: service.port,
      });
      emitDevices();
    });

    browser.on('down', service => {
      const host = pickIpv4(service);
      const txt = (service.txt ?? {}) as Record<string, string>;
      const id = txt.id || (host ? `${host}:${service.port}` : null);
      if (id && devices.delete(id)) emitDevices();
    });

    emitDevices();
  } catch (err) {
    listeners.onError?.(err instanceof Error ? err.message : String(err));
  }
}

export function stopDiscovery(): void {
  try {
    browser?.stop();
  } catch {
    /* noop */
  }
  browser = null;
}

// ── Local media server ───────────────────────────────────────────────────────
function lanIp(): string | null {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

function ensureMediaServer(): Promise<number> {
  if (mediaServer) return Promise.resolve(mediaPort);
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url ?? '';
      // The stock receiver loads plain-HTTP art fine; a custom HTTPS receiver
      // would need a data URI instead. See docs/casting-custom-receiver.md.
      if (url.startsWith('/art')) {
        if (!mediaArtPath || !fs.existsSync(mediaArtPath)) {
          res.writeHead(404).end();
          return;
        }
        const artType = ART_CONTENT_TYPES[path.extname(mediaArtPath).toLowerCase()] ?? 'image/jpeg';
        res.writeHead(200, { 'Content-Type': artType });
        fs.createReadStream(mediaArtPath).pipe(res);
        return;
      }
      if (!mediaFilePath || !url.startsWith('/media')) {
        res.writeHead(404).end();
        return;
      }
      let stat: fs.Stats;
      try {
        stat = fs.statSync(mediaFilePath);
      } catch {
        res.writeHead(404).end();
        return;
      }
      const type = CONTENT_TYPES[path.extname(mediaFilePath).toLowerCase()] ?? 'audio/mpeg';
      const range = req.headers.range;
      if (range) {
        const match = /bytes=(\d*)-(\d*)/.exec(range);
        const start = match && match[1] ? parseInt(match[1], 10) : 0;
        const end = match && match[2] ? parseInt(match[2], 10) : stat.size - 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': type,
        });
        fs.createReadStream(mediaFilePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Accept-Ranges': 'bytes',
          'Content-Type': type,
        });
        fs.createReadStream(mediaFilePath).pipe(res);
      }
    });
    server.on('error', reject);
    server.listen(0, '0.0.0.0', () => {
      const addr = server.address();
      mediaPort = typeof addr === 'object' && addr ? addr.port : 0;
      mediaServer = server;
      resolve(mediaPort);
    });
  });
}

function stopMediaServer(): void {
  try {
    mediaServer?.close();
  } catch {
    /* noop */
  }
  mediaServer = null;
  mediaFilePath = null;
  mediaArtPath = null;
  mediaPort = 0;
}

// ── Control ──────────────────────────────────────────────────────────────────
function clearPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  statusPending = false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleStatus(status: any): void {
  if (!status) return;
  if (status.media?.duration) lastDuration = status.media.duration;
  listeners.onStatus?.({
    playerState: status.playerState,
    currentTime: status.currentTime ?? 0,
    duration: lastDuration,
  });
  if (status.playerState === 'IDLE' && status.idleReason === 'FINISHED' && !endedFired) {
    endedFired = true;
    listeners.onEnded?.();
  }
}

function teardownSession(): void {
  clearPoll();
  try {
    client?.close();
  } catch {
    /* noop */
  }
  client = null;
  player = null;
  lastDuration = 0;
  endedFired = false;
}

export function connect(deviceId: string): void {
  const device = devices.get(deviceId);
  if (!device) {
    listeners.onError?.('Cast device not found');
    return;
  }
  teardownSession();

  const c = new Client();
  client = c;
  c.on('error', (err: Error) => {
    listeners.onError?.(err.message);
    teardownSession();
  });

  const onPlayer = (p: unknown) => {
    player = p;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pl = player as any;
    pl.on('status', handleStatus);
    // A castv2 request the device never answers leaves its 'message' listener on
    // the media controller forever; lift the 10-listener cap so an orphan can't
    // trip Node's leak warning.
    try {
      pl.media?.setMaxListeners?.(0);
    } catch {
      /* noop */
    }
    statusPending = false;
    // Poll for drift correction; skip while a request is outstanding, and treat
    // a >6 s wait as dropped so polling recovers.
    pollTimer = setInterval(() => {
      if (!player) return;
      const now = Date.now();
      if (statusPending && now - statusPendingSince < 6000) return;
      statusPending = true;
      statusPendingSince = now;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      player.getStatus((e: Error | null, s: any) => {
        statusPending = false;
        if (!e) handleStatus(s);
      });
    }, 1000);
    listeners.onConnected?.(deviceId);
  };

  c.connect(device.host, () => {
    c.launch(receiverApp(), (err: Error | null, p: unknown) => {
      if (!err && p) {
        onPlayer(p);
        return;
      }
      // A registered receiver fails to launch while unpublished, still
      // propagating, or on a device not registered for testing. Fall back to the
      // stock one and report why.
      if (CAST_RECEIVER_APP_ID) {
        listeners.onError?.(
          `Receiver ${CAST_RECEIVER_APP_ID} did not launch (${err ? err.message : 'no session'}); using the default receiver instead`
        );
        c.launch(DefaultMediaReceiver, (err2: Error | null, p2: unknown) => {
          if (err2 || !p2) {
            listeners.onError?.(err2 ? err2.message : 'Failed to launch receiver');
            teardownSession();
            return;
          }
          onPlayer(p2);
        });
        return;
      }
      listeners.onError?.(err ? err.message : 'Failed to launch receiver');
      teardownSession();
    });
  });
}

export async function loadMedia(payload: CastLoadPayload): Promise<void> {
  if (!player) {
    listeners.onError?.('Not connected to a cast device');
    return;
  }
  try {
    const ip = lanIp();
    if (!ip) {
      listeners.onError?.('No LAN address to serve media from');
      return;
    }
    // A remote track is already served over HTTP, so the device can fetch it
    // straight from the source; proxying it would mean streaming every byte
    // through this machine, and the local file server would 404 on a URL anyway.
    const isRemote = /^https?:\/\//i.test(payload.filePath);
    mediaFilePath = isRemote ? null : payload.filePath;
    mediaArtPath =
      payload.artPath && fs.existsSync(payload.artPath) ? payload.artPath : null;
    const port = await ensureMediaServer();
    endedFired = false;

    // Cache-buster so the receiver refetches when the shared server path changes track.
    const ts = Date.now();
    const media = {
      contentId: isRemote ? payload.filePath : `http://${ip}:${port}/media?ts=${ts}`,
      contentType: CONTENT_TYPES[path.extname(payload.filePath).toLowerCase()] ?? 'audio/mpeg',
      streamType: 'BUFFERED',
      metadata: {
        type: 0,
        metadataType: 3, // MUSIC_TRACK
        title: payload.title,
        artist: payload.artist,
        albumName: payload.album,
        images: mediaArtPath ? [{ url: `http://${ip}:${port}/art?ts=${ts}` }] : [],
      },
      customData: payload.customData ?? {},
    };

    player.load(
      media,
      { autoplay: payload.autoplay ?? true, currentTime: payload.currentTime ?? 0 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (err: Error | null, status: any) => {
        if (err) {
          listeners.onError?.(err.message);
          return;
        }
        handleStatus(status);
      }
    );
  } catch (err) {
    listeners.onError?.(err instanceof Error ? err.message : String(err));
  }
}

export type CastControlAction = 'play' | 'pause' | 'seek' | 'setVolume' | 'stop';

export function control(action: CastControlAction, value?: number): void {
  try {
    if (action === 'setVolume') {
      client?.setVolume({ level: Math.max(0, Math.min(1, value ?? 0)) }, () => undefined);
      return;
    }
    if (!player) return;
    if (action === 'play') player.play(() => undefined);
    else if (action === 'pause') player.pause(() => undefined);
    else if (action === 'stop') player.stop(() => undefined);
    else if (action === 'seek') player.seek(value ?? 0, () => undefined);
  } catch (err) {
    listeners.onError?.(err instanceof Error ? err.message : String(err));
  }
}

export function disconnect(): void {
  const c = client;
  const p = player;
  clearPoll();
  client = null;
  player = null;
  lastDuration = 0;
  endedFired = false;

  // A Chromecast keeps playing after its sender drops, so quit the receiver app
  // before closing the socket. Force-close if the ack never arrives.
  let closed = false;
  const closeOnce = () => {
    if (closed) return;
    closed = true;
    try {
      c?.close();
    } catch {
      /* noop */
    }
  };
  try {
    if (c && p && typeof c.stop === 'function') {
      c.stop(p, closeOnce);
      setTimeout(closeOnce, 1500);
    } else {
      closeOnce();
    }
  } catch {
    closeOnce();
  }

  stopMediaServer();
}

/** Full teardown for app quit. */
export function destroyCast(): void {
  stopDiscovery();
  disconnect();
  try {
    bonjour?.destroy();
  } catch {
    /* noop */
  }
  bonjour = null;
  devices.clear();
}
