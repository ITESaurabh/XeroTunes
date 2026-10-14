import http from 'http';
import https from 'https';

/**
 * Shoutcast/Icecast announce the song playing right now in-band: with an
 * `Icy-MetaData: 1` request header the server interleaves a metadata block
 * every `icy-metaint` bytes of audio. A <audio> element can't see any of that,
 * so the current title is read here and pushed to the renderer.
 *
 * ponytail: each poll opens its own connection and reads up to one metaint
 * (~16 KB) before hanging up, rather than proxying the audio the player is
 * already pulling. If the reconnects or the duplicate bytes ever matter, run a
 * local proxy that strips the metadata and serves clean audio to the element.
 */

const POLL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

export interface StreamMetadata {
  /** Raw StreamTitle, e.g. "On Wings of Hope - Happiness Isn't Being Buried in a Closet" */
  raw: string;
  title: string;
  artist: string | null;
}

/** `null` = this server has no ICY metadata; `''` = supported but nothing to show yet. */
function readStreamTitle(url: string, depth = 0): Promise<string | null> {
  return new Promise(resolve => {
    let settled = false;
    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let request: http.ClientRequest;
    try {
      const lib = new URL(url).protocol === 'https:' ? https : http;
      request = lib.get(
        url,
        { headers: { 'Icy-MetaData': '1', 'User-Agent': 'XeroTunes' } },
        response => {
          const { statusCode, headers } = response;
          if (statusCode && statusCode >= 300 && statusCode < 400 && headers.location) {
            response.destroy();
            if (depth >= MAX_REDIRECTS) return done(null);
            readStreamTitle(new URL(headers.location, url).href, depth + 1).then(done, () =>
              done('')
            );
            return;
          }

          const metaInt = parseInt(String(headers['icy-metaint'] ?? ''), 10);
          if (!Number.isFinite(metaInt) || metaInt <= 0) {
            response.destroy();
            return done(null);
          }

          let audioSkipped = 0;
          let metaLength = -1;
          let meta = Buffer.alloc(0);
          response.on('data', (chunk: Buffer) => {
            let offset = 0;
            if (audioSkipped < metaInt) {
              const take = Math.min(metaInt - audioSkipped, chunk.length);
              audioSkipped += take;
              offset = take;
            }
            if (offset >= chunk.length) return;
            if (metaLength < 0) {
              // The length byte counts 16-byte blocks; 0 means "unchanged since
              // the last block", which for a fresh connection means no title.
              metaLength = chunk[offset] * 16;
              offset += 1;
              if (metaLength === 0) {
                response.destroy();
                return done('');
              }
            }
            meta = Buffer.concat([
              meta,
              chunk.subarray(offset, offset + (metaLength - meta.length)),
            ]);
            if (meta.length < metaLength) return;
            response.destroy();
            const match = /StreamTitle='([^']*)'/.exec(meta.toString('utf8'));
            done(match ? match[1] : '');
          });
          response.on('end', () => done(''));
          response.on('error', () => done(''));
        }
      );
    } catch {
      return done('');
    }
    request.on('error', () => done(''));
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy();
      done('');
    });
  });
}

export function parseStreamTitle(raw: string): StreamMetadata {
  const separator = raw.indexOf(' - ');
  if (separator === -1) return { raw, title: raw, artist: null };
  return {
    raw,
    artist: raw.slice(0, separator).trim() || null,
    title: raw.slice(separator + 3).trim() || raw,
  };
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollUrl: string | null = null;
let lastRaw: string | null = null;

export function stopStreamMeta(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  pollUrl = null;
  lastRaw = null;
}

export function startStreamMeta(url: string, onMeta: (_meta: StreamMetadata) => void): void {
  stopStreamMeta();
  pollUrl = url;

  const tick = async (): Promise<void> => {
    const raw = (await readStreamTitle(url))?.trim();
    if (pollUrl !== url) return; // switched stations while the request was open
    if (raw == null) {
      // This server interleaves no metadata at all; nothing to come back for.
      stopStreamMeta();
      return;
    }
    if (raw && raw !== lastRaw) {
      lastRaw = raw;
      onMeta(parseStreamTitle(raw));
    }
    pollTimer = setTimeout(() => void tick(), POLL_MS);
  };

  void tick();
}
