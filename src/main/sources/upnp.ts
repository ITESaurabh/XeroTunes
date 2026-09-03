// UPnP/DLNA provider. The odd one out: there is no library API and no login,
// only a browse tree walked with SOAP, so listTracks is a recursive Browse from
// the root object and every track's URL comes from the server rather than being
// built from an id.
//
// No XML parser, matching webdav.ts: the handful of elements read here are
// matched with regexes that allow any namespace prefix. The DIDL-Lite payload
// arrives XML-escaped inside <Result>, so it is unescaped once and then matched
// the same way.
//
// How much metadata a server puts in DIDL-Lite varies more than anything else
// here. A real media server (MiniDLNA, Serviio, Universal Media Server) fills in
// artist, album, track number and duration; one that is a filesystem wearing a
// DLNA hat (rclone serve dlna) gives a title and nothing else, and those tracks
// fall back to what the folder tree says, exactly as an untagged WebDAV file
// does.

import dgram from 'node:dgram';
import os from 'node:os';
import type {
  ConnectInput,
  ConnectResult,
  DiscoveredServer,
  RemoteTrack,
  RemoteTrackDetails,
  SourceCredentials,
  SourceProvider,
} from './types';

// A Browse hits the server's own index; slow ones are usually NAS boxes.
const REQUEST_TIMEOUT_MS = 20000;

// A server that hasn't answered in this long is one the user would call offline.
const PING_TIMEOUT_MS = 5000;

/** Children per Browse. Servers cap this themselves; the loop pages either way. */
const PAGE_SIZE = 200;

/**
 * Containers browsed at once. Two, not the four webdav.ts uses: the servers at
 * this end of the protocol are often phones, and Neutron resets the connection
 * outright at four.
 */
const BROWSE_CONCURRENCY = 2;

/** How long a worker waits for the others when the queue runs dry mid-walk. */
const QUEUE_POLL_MS = 20;

const CONTENT_DIRECTORY = 'urn:schemas-upnp-org:service:ContentDirectory:1';
const MEDIA_SERVER = 'urn:schemas-upnp-org:device:MediaServer:1';

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;

/**
 * The limited broadcast address, not the subnet's own: a directed broadcast to
 * `x.x.x.255` is dropped here, while this one is delivered.
 */
const BROADCAST_ADDRESS = '255.255.255.255';

/**
 * Seconds a server may wait before answering the search. It staggers replies so
 * a busy network doesn't answer all at once, and it is what the scan waits out.
 */
const SSDP_MX = 2;

/**
 * Tried in order when the address has no path of its own. There is no standard
 * location for the device description; SSDP is what normally supplies it, and
 * these are what the servers worth guessing at use.
 */
const DESCRIPTION_PATHS = ['/rootDesc.xml', '/description.xml', '/DeviceDescription.xml'];

// As in webdav.ts, so a folder browsed over DLNA and over a share agree.
const COVER_BASENAMES = ['cover', 'folder', 'front', 'album', 'albumart'];

/** DIDL marks what a thing is with upnp:class; only audio is a track. */
const AUDIO_CLASS = /audioItem/i;
const IMAGE_CLASS = /imageItem/i;

function element(name: string, flags = 'i'): RegExp {
  return new RegExp(
    `<(?:[a-z0-9-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-z0-9-]+:)?${name}>`,
    flags
  );
}

const SERVICE = element('service', 'gi');
const SERVICE_TYPE = element('serviceType');
const CONTROL_URL = element('controlURL');
const RESULT = element('Result');
const CONTAINER = /<container\s[^>]*>[\s\S]*?<\/container>/gi;
const ITEM = /<item\s[^>]*>[\s\S]*?<\/item>/gi;
const RES = /<res\s([^>]*)>([\s\S]*?)<\/res>/i;

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
};

/** `&amp;` last, so an escaped-twice `&amp;lt;` doesn't collapse into a tag. */
export function unescapeXml(text: string): string {
  return text
    .replace(/&(?:lt|gt|quot|apos);/g, m => ENTITIES[m])
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, c => `&#${c.charCodeAt(0)};`);
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag);
  return match ? unescapeXml(match[1]) : null;
}

function text(xml: string, name: string): string | null {
  const match = element(name).exec(xml);
  const value = match ? unescapeXml(match[1]).trim() : '';
  return value || null;
}

function upnpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/**
 * Addresses a server can be listening on but nothing can connect to. Windows
 * quietly routes them to localhost, so a sync against one succeeds and only
 * playback fails, which makes it look like the track is at fault.
 */
const WILDCARD_HOSTS = ['0.0.0.0', '[::]', '::'];

/** The address with a scheme and no trailing slash, for someone who typed a host. */
export function withScheme(server: string): string {
  const typed = server.trim();
  const url = new URL(/^https?:\/\//i.test(typed) ? typed : `http://${typed}`);
  if (WILDCARD_HOSTS.includes(url.hostname)) url.hostname = '127.0.0.1';
  return url.toString().replace(/\/+$/, '');
}

/**
 * A `res` URL the renderer can actually load. Servers build these from the Host
 * they were asked on, or from whatever they were told to bind to, so a bind-all
 * address comes back in them; anything else is left alone, since a server on the
 * LAN knows its own address better than we do.
 */
export function routableUrl(url: string, via: string): string {
  try {
    const res = new URL(url);
    if (!WILDCARD_HOSTS.includes(res.hostname)) return url;
    res.host = new URL(via).host;
    return res.toString();
  } catch {
    return url;
  }
}

/** `0:03:45.000` and `00:03:45` both mean 225 seconds. */
export function durationSeconds(value: string | null): number | null {
  if (!value) return null;
  const parts = value.split(':').map(Number);
  if (parts.some(Number.isNaN) || parts.length < 2 || parts.length > 3) return null;
  const [h, m, s] = parts.length === 3 ? parts : [0, ...parts];
  return Math.round(h * 3600 + m * 60 + s);
}

export interface DidlItem {
  id: string;
  title: string;
  /** upnp:class, e.g. `object.item.audioItem.musicTrack`. */
  itemClass: string;
  artist: string | null;
  albumArtist: string | null;
  album: string | null;
  genre: string | null;
  trackNumber: number | null;
  year: number | null;
  durationSec: number | null;
  size: number | null;
  albumArtUri: string | null;
  /** The `res` URL: what actually plays, and the only thing unique per track. */
  url: string | null;
  mime: string | null;
}

export function parseDidlItems(didl: string, pattern: RegExp): DidlItem[] {
  const out: DidlItem[] = [];
  for (const [tag] of didl.matchAll(pattern)) {
    const id = attr(tag, 'id');
    if (!id) continue;
    const res = RES.exec(tag);
    const protocolInfo = res ? (attr(`<res ${res[1]}>`, 'protocolInfo') ?? '') : '';
    const date = text(tag, 'date');
    out.push({
      id,
      title: text(tag, 'title') ?? '',
      itemClass: text(tag, 'class') ?? '',
      // upnp:artist carries a role attribute; dc:creator is the same name on
      // servers that don't emit upnp:artist at all.
      artist: text(tag, 'artist') ?? text(tag, 'creator'),
      albumArtist: text(tag, 'albumArtist'),
      album: text(tag, 'album'),
      genre: text(tag, 'genre'),
      trackNumber: Number(text(tag, 'originalTrackNumber')) || null,
      year: date ? Number(date.slice(0, 4)) || null : null,
      durationSec: res ? durationSeconds(attr(`<res ${res[1]}>`, 'duration')) : null,
      size: res ? Number(attr(`<res ${res[1]}>`, 'size')) || null : null,
      albumArtUri: text(tag, 'albumArtURI'),
      url: res ? unescapeXml(res[2]).trim() || null : null,
      mime: protocolInfo.split(':')[2] || null,
    });
  }
  return out;
}

/** Every address this machine could send a search from, VPN and VM adapters included. */
function localAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => (i as os.NetworkInterfaceInfo).address);
}

/**
 * SSDP: ask for media servers and collect whatever answers before the deadline.
 * Servers stagger their replies by up to MX seconds, so the wait is the
 * protocol's own rather than a guess.
 *
 * Both a multicast and a broadcast search, because on Windows neither alone
 * finds everything. Multicast is delivered to the socket with the most specific
 * bind, so a server listening on 0.0.0.0:1900 loses the datagram to the system's
 * own SSDP service and never answers; broadcast reaches both. Multicast in turn
 * is the only one some LAN devices answer at all.
 *
 * The multicast interface is set explicitly per address for the same reason: left
 * to the OS it picks one, and on a machine with a VM or VPN adapter installed
 * that is regularly not the network the user's devices are on.
 */
async function searchSsdp(): Promise<string[]> {
  const query = Buffer.from(
    'M-SEARCH * HTTP/1.1\r\n' +
      `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\n` +
      'MAN: "ssdp:discover"\r\n' +
      `MX: ${SSDP_MX}\r\n` +
      `ST: ${MEDIA_SERVER}\r\n\r\n`
  );

  return new Promise(resolve => {
    const locations = new Set<string>();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      try {
        socket.close();
      } catch {
        // Already gone; the answers collected so far still stand.
      }
      resolve([...locations]);
    };

    socket.on('message', message => {
      const location = /^LOCATION:\s*(\S+)/im.exec(message.toString());
      if (location) locations.add(location[1]);
    });
    // A machine with no route to the group isn't an error worth showing the
    // user; it means nothing was found.
    socket.on('error', done);

    socket.bind(() => {
      if (closed) return;
      try {
        socket.setBroadcast(true);
      } catch {
        // Without it the broadcast send fails and only multicast finds anything.
      }
      for (const address of localAddresses()) {
        try {
          socket.setMulticastInterface(address);
        } catch {
          // An adapter that can't carry multicast still gets the broadcast.
        }
        socket.send(query, SSDP_PORT, SSDP_ADDRESS, () => undefined);
      }
      socket.send(query, SSDP_PORT, BROADCAST_ADDRESS, () => undefined);
    });
    setTimeout(done, SSDP_MX * 1000 + 500);
  });
}

/**
 * A device description, if that URL holds one worth using. Null covers every way
 * it can fail to be a media server, since to both callers those are the same
 * answer: nothing here.
 */
export async function describe(url: string): Promise<{ name: string; control: string } | null> {
  let xml: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
    if (!res.ok) return null;
    xml = await res.text();
  } catch {
    return null;
  }
  if (!xml.includes(CONTENT_DIRECTORY)) return null;

  // URLBase is legacy and usually absent, but where a server sets it, it and not
  // the description's own address is what relative control URLs hang off.
  const base = text(xml, 'URLBase') ?? url;
  SERVICE.lastIndex = 0;
  for (const [block] of xml.matchAll(SERVICE)) {
    if (!SERVICE_TYPE.exec(block)?.[1]?.includes('ContentDirectory')) continue;
    const path = CONTROL_URL.exec(block)?.[1]?.trim();
    if (!path) break;
    return {
      name: text(xml, 'friendlyName') ?? new URL(url).host,
      control: routableUrl(new URL(path, base).toString(), url),
    };
  }
  return null;
}

function controlUrl(c: SourceCredentials): string {
  const url = c.config?.controlUrl;
  if (typeof url !== 'string' || !url) throw new Error('This source has no ContentDirectory URL');
  return url;
}

async function browse(
  c: SourceCredentials,
  objectId: string,
  startingIndex: number
): Promise<{ didl: string; returned: number; total: number }> {
  const body =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
    `<u:Browse xmlns:u="${CONTENT_DIRECTORY}">` +
    `<ObjectID>${escapeXml(objectId)}</ObjectID>` +
    '<BrowseFlag>BrowseDirectChildren</BrowseFlag><Filter>*</Filter>' +
    `<StartingIndex>${startingIndex}</StartingIndex>` +
    `<RequestedCount>${PAGE_SIZE}</RequestedCount>` +
    '<SortCriteria></SortCriteria></u:Browse></s:Body></s:Envelope>';

  const post = () =>
    fetch(controlUrl(c), {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPAction: `"${CONTENT_DIRECTORY}#Browse"`,
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  // One retry, because these servers drop idle connections without saying so and
  // the pooled socket only turns out to be dead when a request is written to it.
  // A phone hands out ECONNRESET this way often enough to lose a whole sync to it.
  let res: Response;
  try {
    res = await post();
  } catch {
    res = await post();
  }
  const xml = await res.text();
  if (!res.ok) {
    // A UPnP fault carries its own reason; the HTTP status is always 500.
    const reason = text(xml, 'errorDescription') ?? text(xml, 'faultstring');
    throw upnpError(reason ?? `The server answered ${res.status} ${res.statusText}`, res.status);
  }
  const result = RESULT.exec(xml);
  if (!result) throw upnpError('That address answered, but not with a browsable library', 200);
  return {
    didl: unescapeXml(result[1]),
    returned: Number(text(xml, 'NumberReturned')) || 0,
    total: Number(text(xml, 'TotalMatches')) || 0,
  };
}

/** Every child of one container, paged until the server stops handing them over. */
async function children(
  c: SourceCredentials,
  objectId: string
): Promise<{ containers: DidlItem[]; items: DidlItem[] }> {
  const containers: DidlItem[] = [];
  const items: DidlItem[] = [];
  for (let index = 0; ; ) {
    const page = await browse(c, objectId, index);
    containers.push(...parseDidlItems(page.didl, CONTAINER));
    items.push(...parseDidlItems(page.didl, ITEM));
    index += page.returned;
    // A server that reports neither a count nor any children has nothing more,
    // and one that ignores StartingIndex would otherwise loop forever.
    if (!page.returned || index >= page.total) break;
  }
  return { containers, items };
}

function coverRank(title: string): number {
  return COVER_BASENAMES.indexOf(title.trim().toLowerCase());
}

/**
 * What the browse trail says, for a server that fills in nothing but the title.
 * webdav.ts does the same job for a file path; here the title is already a title
 * rather than a filename, so only a leading track number has to come off it.
 */
export function trailMetadata(
  folder: string,
  title: string
): { title: string; album: string | null; artist: string | null; trackNumber: number | null } {
  const parts = folder ? folder.split('/') : [];
  const numbered = /^(\d{1,3})\s*[-._)]*\s+(.+)$/.exec(title.trim());
  return {
    title: (numbered ? numbered[2] : title).trim() || title,
    album: parts.length ? parts[parts.length - 1] : null,
    artist: parts.length > 1 ? parts[parts.length - 2] : null,
    trackNumber: numbered ? Number(numbered[1]) : null,
  };
}

function toRemoteTrack(
  item: DidlItem,
  folder: string,
  coverUrl: string | null,
  via: string
): RemoteTrack {
  // `path` is the browse trail rather than anything the server calls a path:
  // DIDL has no such field, and the folder tree needs one.
  const path = folder ? `${folder}/${item.title}` : item.title;
  const fallback = trailMetadata(folder, item.title);
  const artist = (item.artist ?? '').trim();
  const albumArtist = (item.albumArtist ?? '').trim();
  // A server that gives neither artist nor album is publishing a directory, so
  // its dc:title is a filename stem and the `01 - ` on the front is a track
  // number. One that does fill those in means its title literally, leading digits
  // and all, and "99 Problems" has to survive.
  const named = !!(artist || item.album);
  // The server's own album art where it names one, else a cover image sitting in
  // the same container: one URL shared by the album either way.
  const art = item.albumArtUri ?? coverUrl;
  return {
    // The res URL, not the object id: it is what streamUrl has to return, and
    // the id alone can't be turned back into it. Both die if the server moves.
    remoteId: item.url ? routableUrl(item.url, via) : item.id,
    title: (named ? item.title.trim() : fallback.title) || fallback.title,
    album: (item.album ?? '').trim() || fallback.album,
    // The raw credit string, not a split one: sync.ts re-splits it under the
    // user's own separator rules, exactly as it does for a local file.
    artists: artist ? [artist] : fallback.artist ? [fallback.artist] : [],
    albumArtists: albumArtist
      ? [albumArtist]
      : artist
        ? [artist]
        : fallback.artist
          ? [fallback.artist]
          : [],
    genres: item.genre ? [item.genre] : [],
    trackNumber: item.trackNumber ?? fallback.trackNumber,
    discNumber: null,
    year: item.year,
    durationSec: item.durationSec,
    container: item.mime?.split('/')[1]?.replace(/^x-/, '') ?? null,
    path,
    artKey: art ? routableUrl(art, via) : null,
  };
}

export const upnpProvider: SourceProvider = {
  type: 'upnp',
  label: 'UPnP / DLNA',
  scheme: 'upnp',

  async connect(input: ConnectInput): Promise<ConnectResult> {
    const typed = withScheme(input.baseUrl);
    const hasPath = new URL(typed).pathname.length > 1;
    const candidates = hasPath ? [typed] : DESCRIPTION_PATHS.map(p => typed + p);

    for (const candidate of candidates) {
      const device = await describe(candidate);
      if (!device) continue;
      return {
        displayName: device.name,
        credentials: {
          baseUrl: candidate,
          username: null,
          userId: null,
          accessToken: null,
          deviceId: null,
          config: { controlUrl: device.control },
        },
      };
    }
    throw new Error(
      hasPath
        ? 'That address is not a UPnP media server description'
        : 'No UPnP media server answered there. Try the full address of its description XML.'
    );
  },

  async discover(): Promise<DiscoveredServer[]> {
    const locations = await searchSsdp();
    // Every answer is a separate server, so they are described in parallel; one
    // that has gone away since answering just drops out.
    const devices = await Promise.all(
      locations.map(async location => {
        const device = await describe(location);
        return device ? { name: device.name, address: location } : null;
      })
    );
    return devices.filter((d): d is DiscoveredServer => d !== null);
  },

  /**
   * The whole tree, walked breadth-first from the root object.
   *
   * A server's root is usually several views of one library rather than one
   * library: Neutron offers Songs, Albums, Artists, Genres, Folders, Years,
   * Ratings and more, so a walk meets most tracks a dozen times over. Keying by
   * remoteId collapses those, and the first path a track is found under is the
   * one it keeps. There is no cheaper way to ask: ContentDirectory's own Search
   * would return the audio flat in one query, but neither server tested here
   * implements it (501 and 401), so it can't be relied on.
   */
  async listTracks(c, onProgress) {
    const control = controlUrl(c);
    const tracks = new Map<string, RemoteTrack>();
    const queue: Array<{ id: string; path: string }> = [{ id: '0', path: '' }];
    // Container ids already queued, so a tree that loops back on itself, or one
    // view that links into another, doesn't walk forever.
    const seen = new Set<string>(['0']);
    // Workers in flight. A worker that finds the queue empty has to wait for
    // these rather than return: each one may still add the containers it found.
    let active = 0;

    const worker = async () => {
      for (;;) {
        const folder = queue.shift();
        if (!folder) {
          if (active === 0) return;
          await new Promise(resolve => setTimeout(resolve, QUEUE_POLL_MS));
          continue;
        }
        active++;
        try {
          let listing;
          try {
            listing = await children(c, folder.id);
          } catch (err) {
            // One container the server chokes on shouldn't cost the whole
            // library, and on a tree of overlapping views its tracks are
            // usually reachable another way regardless.
            console.warn('[upnp] Skipping container', folder.path || '/', (err as Error).message);
            continue;
          }
          const { containers, items } = listing;

          for (const child of containers) {
            if (seen.has(child.id)) continue;
            seen.add(child.id);
            queue.push({
              id: child.id,
              path: folder.path ? `${folder.path}/${child.title}` : child.title,
            });
          }

          const cover = items
            .filter(i => IMAGE_CLASS.test(i.itemClass) && coverRank(i.title) >= 0)
            .sort((a, b) => coverRank(a.title) - coverRank(b.title))[0];

          for (const item of items) {
            if (!AUDIO_CLASS.test(item.itemClass) || !item.url) continue;
            const track = toRemoteTrack(item, folder.path, cover?.url ?? null, control);
            if (!tracks.has(track.remoteId)) tracks.set(track.remoteId, track);
          }
        } finally {
          active--;
        }
        // No total to count towards: the tree's size isn't known until walked.
        onProgress?.(tracks.size, tracks.size + queue.length);
      }
    };

    await Promise.all(Array.from({ length: BROWSE_CONCURRENCY }, worker));
    return [...tracks.values()];
  },

  // remoteId is the res URL the server handed out, so both are already right.
  streamUrl(_c, remoteId) {
    return remoteId;
  },

  downloadUrl(_c, remoteId) {
    return remoteId;
  },

  artUrl(_c, track) {
    return track.artKey;
  },

  async details(c, remoteId): Promise<RemoteTrackDetails | null> {
    // ContentDirectory has no per-track lookup by URL, and the DIDL fields are
    // already stored, so ask the file itself what a HEAD can tell.
    try {
      const res = await fetch(remoteId, {
        method: 'HEAD',
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const length = res.headers.get('content-length');
      const type = res.headers.get('content-type');
      return {
        codec: null,
        bitRate: null,
        sampleRate: null,
        channels: null,
        container: type?.split('/')[1]?.replace(/^x-/, '') ?? null,
        size: length ? Number(length) : null,
        path: decodeURIComponent(new URL(remoteId).pathname),
      };
    } catch {
      return null;
    }
  },

  async ping(c) {
    try {
      const res = await fetch(c.baseUrl, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
      // Nothing to authenticate against: UPnP servers answer whoever asks.
      return { reachable: res.ok, authValid: res.ok };
    } catch {
      return { reachable: false, authValid: false };
    }
  },
};
