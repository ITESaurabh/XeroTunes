import type { SourceProvider } from './types';
import { jellyfinProvider } from './jellyfin';

/**
 * Adding a remote library type means writing one provider and adding it here.
 * Nothing else in the app needs to know the type exists.
 */
const PROVIDERS: SourceProvider[] = [jellyfinProvider];

const BY_TYPE = new Map(PROVIDERS.map(p => [p.type, p]));

export function getProvider(type: string): SourceProvider | null {
  return BY_TYPE.get(type) ?? null;
}

export interface ProviderInfo {
  type: string;
  label: string;
  /** One line for the picker card. */
  blurb: string;
  /** Brand colour, used to tint the card's icon. */
  accent: string;
  /** False renders the card as "Coming soon". Derived, never hand-maintained. */
  available: boolean;
}

/**
 * Every remote library we could plausibly support, whether or not it is built
 * yet; this is what the "Add external" picker renders.
 *
 * Availability is derived from PROVIDERS above, so implementing one and
 * registering it flips its card on with no edit here. Deliberately excludes
 * Spotify, Apple Music and the like: their APIs don't permit a third-party
 * client to stream or download the audio, so they aren't "coming soon", they
 * are not possible.
 */
const CATALOGUE: Omit<ProviderInfo, 'available'>[] = [
  {
    type: 'jellyfin',
    label: 'Jellyfin',
    blurb: 'Free software media system',
    accent: '#AA5CC3',
  },
  {
    type: 'emby',
    label: 'Emby',
    blurb: 'Jellyfin’s parent project; near-identical API',
    accent: '#52B54B',
  },
  {
    type: 'plex',
    label: 'Plex',
    blurb: 'Media server with its own account model',
    accent: '#E5A00D',
  },
  {
    type: 'subsonic',
    label: 'Subsonic API',
    blurb: 'Navidrome, Airsonic, Gonic and friends',
    accent: '#4A90D9',
  },
  {
    type: 'upnp',
    label: 'UPnP / DLNA',
    blurb: 'Media servers already on your network',
    accent: '#2FBFA0',
  },
  {
    type: 'nextcloud',
    label: 'Nextcloud',
    blurb: 'Music stored in your Nextcloud files',
    accent: '#0082C9',
  },
  {
    type: 'webdav',
    label: 'WebDAV',
    blurb: 'Any WebDAV share',
    accent: '#8E8E93',
  },
];

/** Feeds the "Add external" picker, so a new provider shows up there for free. */
export function listProviders(): ProviderInfo[] {
  return CATALOGUE.map(entry => ({ ...entry, available: BY_TYPE.has(entry.type) }));
}

/**
 * `jellyfin://2/D:/Music/Rock`: a server path namespaced for the folder tree.
 *
 * The source id, not just the scheme: two Jellyfin servers would otherwise share
 * one namespace, merging their trees and double-counting every folder. It is the
 * id rather than the name so renaming a server doesn't strand its paths.
 *
 * Separators are normalised to `/` because the tree walks a path a segment at a
 * time and infers the separator from the string it is handed: left as-is, a
 * Windows server under `jellyfin://2/D:` would look forward-slashed at the root
 * and backslashed one level down, and the walk would stop dead there.
 */
export function qualifyPath(
  type: string,
  sourceId: number,
  serverPath: string | null
): string | null {
  const root = schemeRoot(type, sourceId);
  if (!root || !serverPath) return null;
  return root + serverPath.replace(/\\/g, '/').replace(/^\/+/, '');
}

/** Strips the `<scheme>://<id>/` prefix back off, for comparing against a real path. */
export function stripNamespace(qualified: string): string {
  return qualified.replace(/^[a-z0-9+.-]+:\/\/\d+\//i, '');
}

/** The server's own path, separators untouched, for showing a human. */
export function displayPath(type: string, serverPath: string | null): string | null {
  const provider = getProvider(type);
  if (!provider || !serverPath) return null;
  return `${provider.scheme}://${serverPath}`;
}

/** The folder tree's root for one source, and the prefix all its paths share. */
export function schemeRoot(type: string, sourceId: number): string | null {
  const provider = getProvider(type);
  return provider ? `${provider.scheme}://${sourceId}/` : null;
}

export function parentPath(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
  return idx <= 0 ? filePath : filePath.slice(0, idx);
}
