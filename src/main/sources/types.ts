/**
 * The seam every remote library plugs into: Jellyfin today, UPnP and Nextcloud
 * expected next.
 *
 * A provider's whole job is to turn a server into a flat list of RemoteTrack and
 * to hand back URLs for the bytes. It never touches the database: sync.ts owns
 * all the SQL, so adding a provider means adding one file and one registry line,
 * with no schema or query changes.
 *
 * Everything a provider needs to remember about a server lives in
 * SourceCredentials, which maps onto the Source table. Providers that need more
 * than those fields put it in `config`, which is persisted as JSON.
 */

/** Persisted per server. Fields a given provider doesn't use stay null. */
export interface SourceCredentials {
  baseUrl: string;
  username: string | null;
  userId: string | null;
  accessToken: string | null;
  deviceId: string | null;
  config: Record<string, unknown>;
}

/**
 * One track as the provider sees it, already normalised. `remoteId` is opaque to
 * us and only has to be stable and unique on that server; it's what makes a
 * re-sync an upsert rather than a duplicate.
 */
export interface RemoteTrack {
  remoteId: string;
  title: string;
  album: string | null;
  artists: string[];
  albumArtists: string[];
  genres: string[];
  trackNumber: number | null;
  discNumber: number | null;
  year: number | null;
  durationSec: number | null;
  container: string | null;
  /** Where the file sits on the server. Displayed, and used to build the folder tree. */
  path: string | null;
  /** Opaque handle the provider gets back in artUrl(); null when there's no cover. */
  artKey: string | null;

  /**
   * What the file looked like when these fields were read: an etag, or modified
   * time and size. Stored so the next sync can tell an unchanged file from one
   * worth reading again. Null for a provider with no such notion.
   */
  stamp?: string | null;
  /**
   * Set when the provider didn't read the file: the fields are guesses from the
   * path, and the track is left for readTrack() to fill in when it plays.
   */
  untagged?: boolean;
  /**
   * Set when the stamp matches what the last sync stored. The row is already
   * right, so sync leaves it alone rather than rewriting it with a guess.
   */
  unchanged?: boolean;
}

/** The technical details a local file would carry in its header. */
export interface RemoteTrackDetails {
  codec: string | null;
  bitRate: number | null;
  sampleRate: number | null;
  channels: number | null;
  container: string | null;
  size: number | null;
  path: string | null;
}

export interface ConnectInput {
  baseUrl: string;
  username?: string;
  password?: string;
  /** For a server whose credential is a token rather than an account. */
  token?: string;
  /** Merged into the stored credentials' config; carries the metadata mode. */
  config?: Record<string, unknown>;
}

/**
 * How much a provider that has to read files for their tags is allowed to read,
 * stored per source in `config.metadata`.
 *
 * A share with tens of thousands of files makes the eager pass expensive, and
 * whether that cost is worth paying is the user's call, not ours.
 */
export type MetadataMode =
  /** Read every file's tags during the sync, and anything it missed on play. */
  | 'eager'
  /** Read a track's tags the first time it plays; the list shows its path until then. */
  | 'onPlay'
  /** Never read a file; titles come from the path and stay that way. */
  | 'off';

export interface ConnectResult {
  /** Server's own name where it has one, else something derived from the URL. */
  displayName: string;
  credentials: SourceCredentials;
}

/** A server found on the network, offered as something to click rather than type. */
export interface DiscoveredServer {
  name: string;
  /** Goes straight into the address field, so connect() has to accept it as-is. */
  address: string;
}

export interface SourceProvider {
  /** Stored in Source.Type; also the key in the registry. */
  readonly type: string;
  /** Shown in the UI, e.g. "Jellyfin". */
  readonly label: string;
  /**
   * Namespaces this source's server paths, e.g. `jellyfin` gives
   * `jellyfin://D:\Music\...`. Keeps remote paths from colliding with local ones
   * in the folder tree, and tells the user where a file actually lives.
   */
  readonly scheme: string;

  connect(_input: ConnectInput): Promise<ConnectResult>;

  /**
   * `known` maps remoteId to the stamp stored for it, so a provider that reads
   * files can skip the ones that haven't changed since the last sync.
   */
  listTracks(
    _credentials: SourceCredentials,
    _onProgress?: (_loaded: number, _total: number) => void,
    _known?: ReadonlyMap<string, string>
  ): Promise<RemoteTrack[]>;

  /**
   * Must be playable by a bare <audio> element. A provider whose server needs a
   * header rather than a token in the URL returns requestHeaders() as well.
   */
  streamUrl(_credentials: SourceCredentials, _remoteId: string): string;

  /** The original file, for offline downloads. */
  downloadUrl(_credentials: SourceCredentials, _remoteId: string): string;

  artUrl(_credentials: SourceCredentials, _track: RemoteTrack): string | null;

  /** LRC text; a provider without lyrics omits it. */
  lyrics?(_credentials: SourceCredentials, _remoteId: string): Promise<string | null>;

  /** Optional; the info dialog falls back to what the DB already holds. */
  details?(_credentials: SourceCredentials, _remoteId: string): Promise<RemoteTrackDetails | null>;

  /**
   * Headers every request to this source needs, for a server that authenticates
   * with one. <audio> and <img> can't set headers, so sync.installSourceAuth
   * injects these into the renderer's requests for the source's URLs, and the
   * main process's own fetches pass them explicitly.
   */
  requestHeaders?(_credentials: SourceCredentials): Record<string, string>;

  /**
   * True for a provider whose metadata lives in the files rather than in a
   * library on the server; only those offer the user a MetadataMode.
   */
  readonly readsFileTags?: boolean;

  /**
   * True where the server takes a token rather than an account of its own, so
   * the add dialog offers a token field alongside the username and password.
   */
  readonly tokenAuth?: boolean;

  /**
   * True where connect() cannot succeed without a username and password. False
   * for a server with no auth at all (UPnP) or where anonymous is normal
   * (WebDAV).
   */
  readonly needsAccount?: boolean;

  /** How this source's config answers the question; only a readsFileTags provider has one. */
  metadataMode?(_credentials: SourceCredentials): MetadataMode;

  /**
   * One track, read in full. Backs the fill-in when an untagged track plays, so
   * only a provider that reads files needs it.
   */
  readTrack?(_credentials: SourceCredentials, _remoteId: string): Promise<RemoteTrack | null>;

  /**
   * Servers of this kind that answer on the local network. A provider whose
   * protocol has no way to ask omits it, and the picker offers no scan.
   */
  discover?(): Promise<DiscoveredServer[]>;

  /**
   * Whether the server answers, and whether the stored credentials still work.
   * Kept apart because they need different fixes: one is a server to start, the
   * other a password to re-enter.
   */
  ping?(_credentials: SourceCredentials): Promise<{ reachable: boolean; authValid: boolean }>;
}
