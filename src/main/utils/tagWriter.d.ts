export interface TagFields {
  title?: string;
  artists?: string[];
  album?: string;
  albumArtists?: string[];
  year?: number | null;
  genres?: string[];
  disc?: number | null;
  track?: number | null;
  comment?: string;
  encodedBy?: string;
  /** Path to an image file, or null to strip the embedded art. */
  artPath?: string | null;
}

export function writeTags(filePath: string, fields: TagFields): void;
