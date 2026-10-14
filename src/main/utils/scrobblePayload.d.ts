import type { ScrobbleTrack } from '../modules/Scrobbler';

export function primaryArtist(track: ScrobbleTrack): string;
export function isVariousArtists(name: string | null | undefined): boolean;
export function audioscrobblerParams(
  tracks: ScrobbleTrack[],
  nowPlaying: boolean,
  sessionKey: string
): Record<string, string>;
export function listenBrainzBody(
  tracks: ScrobbleTrack[],
  nowPlaying: boolean
): Record<string, unknown>;
