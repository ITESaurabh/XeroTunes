export interface PlaylistEntry {
  location: string;
  title?: string;
  artist?: string;
  duration?: number;
}

export interface PlaylistWriteEntry {
  location: string;
  title?: string;
  artist?: string;
  duration?: number | null;
}

export type PlaylistFileFormat = 'm3u' | 'm3u8' | 'pls' | 'xspf';

export const FORMATS: PlaylistFileFormat[];
export function detectPlaylistFormat(filePath: string): PlaylistFileFormat | null;
export function parsePlaylistFile(filePath: string): PlaylistEntry[];
export function writePlaylistFile(
  filePath: string,
  entries: PlaylistWriteEntry[],
  playlistTitle?: string
): void;
export function resolveLocation(raw: string, baseDir: string): string;
