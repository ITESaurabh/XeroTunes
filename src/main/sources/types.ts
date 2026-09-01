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
  dateAdded: number | null;
  /** Opaque handle the provider gets back in artUrl(); null when there's no cover. */
  artKey: string | null;
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
}

export interface ConnectResult {
  /** Server's own name where it has one, else something derived from the URL. */
  displayName: string;
  credentials: SourceCredentials;
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

  listTracks(
    _credentials: SourceCredentials,
    _onProgress?: (_loaded: number, _total: number) => void
  ): Promise<RemoteTrack[]>;

  /** Must be playable by a bare <audio> element: no custom headers. */
  streamUrl(_credentials: SourceCredentials, _remoteId: string): string;

  /** The original file, for offline downloads. */
  downloadUrl(_credentials: SourceCredentials, _remoteId: string): string;

  artUrl(_credentials: SourceCredentials, _track: RemoteTrack): string | null;

  /** LRC text; a provider without lyrics omits it. */
  lyrics?(_credentials: SourceCredentials, _remoteId: string): Promise<string | null>;

  /** Optional; the info dialog falls back to what the DB already holds. */
  details?(_credentials: SourceCredentials, _remoteId: string): Promise<RemoteTrackDetails | null>;
}
