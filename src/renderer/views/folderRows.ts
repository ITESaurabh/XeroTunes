/**
 * Folders and songs flattened into one row list for the virtualised Folder
 * Hierarchy body. React-free so `folderRows.check.ts` can run it under node.
 */

export interface SubFolder {
  Path: string;
  Name: string;
  SongCount: number;
  IsRoot?: boolean;
  /** Set on a remote library's root, e.g. 'jellyfin'. Absent for local folders. */
  SourceType?: string;
}

/** Structurally the renderer's `Track`; restated so this module pulls in no React. */
export interface RowTrack {
  Id?: string | number;
  [key: string]: unknown;
}

export type BodyRow =
  | { kind: 'header'; label: string }
  | { kind: 'gap' }
  | { kind: 'grid'; folders: SubFolder[] }
  | { kind: 'folder'; folder: SubFolder }
  | { kind: 'song'; song: RowTrack; index: number };

/** Mirrors `repeat(auto-fill, minmax(minPx, 1fr))` so the rows we slice match the CSS. */
export function gridColumns(width: number, minPx: number, gapPx: number): number {
  return Math.max(1, Math.floor((width + gapPx) / (minPx + gapPx)));
}

export function buildFolderRows(
  subfolders: SubFolder[],
  songs: RowTrack[],
  opts: { grid: boolean; cols: number; isAtRoot: boolean }
): BodyRow[] {
  const rows: BodyRow[] = [];

  if (subfolders.length) {
    rows.push({
      kind: 'header',
      label: opts.isAtRoot ? 'Music Folders' : `Folders (${subfolders.length})`,
    });
    if (opts.grid) {
      const cols = Math.max(1, opts.cols);
      for (let i = 0; i < subfolders.length; i += cols)
        rows.push({ kind: 'grid', folders: subfolders.slice(i, i + cols) });
    } else {
      for (const folder of subfolders) rows.push({ kind: 'folder', folder });
    }
    if (songs.length) rows.push({ kind: 'gap' });
  }

  if (songs.length) {
    rows.push({ kind: 'header', label: `Songs (${songs.length})` });
    // `index` stays the position in `songs`, which is what the play queue is built from.
    songs.forEach((song, index) => rows.push({ kind: 'song', song, index }));
  }

  return rows;
}
