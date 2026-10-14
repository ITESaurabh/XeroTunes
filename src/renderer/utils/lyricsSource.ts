/**
 * Where a track's lyrics come from, in the order the player trusts them: a
 * sidecar .lrc beside the file, then the file's own tags, then the server.
 *
 * One resolver rather than one per screen. Lyric Studio has to edit exactly what
 * the play bar is showing, and a second copy of this order would drift from it.
 */
import { ipcRenderer } from 'electron';
// eslint-disable-next-line import/no-unresolved -- ESM-only package; same gap mainProcess.ts has
import { parseFile } from 'music-metadata';
import { toLrc } from './lrc';

export type LyricsSource = 'LRC file' | 'Embedded' | 'Server';

export interface ResolvedLyrics {
  content: string;
  source: LyricsSource;
  type: 'synced' | 'unsynced';
}

/** An LRC line carrying a timestamp, i.e. lyrics that can follow playback. */
export const SYNCED_LRC = /\[\d{2}:\d{2}[.:]\d{2}/;

/** A streamed track: no local bytes to read, and no folder to hold a sidecar. */
export const isRemotePath = (songPath: string): boolean => /^https?:\/\//i.test(songPath);

const classify = (content: string, source: LyricsSource): ResolvedLyrics => ({
  content,
  source,
  type: SYNCED_LRC.test(content) ? 'synced' : 'unsynced',
});

/** The `.lrc` beside the track: read first here, and where the studio saves. */
export function sidecarPathFor(songPath: string): string {
  const nodePath = window.require('path') as typeof import('path');
  const dir = nodePath.dirname(songPath);
  const base = nodePath.basename(songPath, nodePath.extname(songPath));
  return nodePath.join(dir, `${base}.lrc`);
}

export function syltToLrc(synchronisedText: Array<{ text: string; timestamp: number }>): string {
  return toLrc(synchronisedText.map(({ text, timestamp }) => ({ text, timeMs: timestamp })));
}

export async function resolveLyrics(
  songPath: string,
  trackId: string | number | undefined
): Promise<ResolvedLyrics | null> {
  // A streamed track has no local file, but the server keeps its lyrics and
  // hands them back as LRC, so everything downstream is the same.
  if (isRemotePath(songPath)) {
    if (trackId == null) return null;
    try {
      const lrc = await ipcRenderer.invoke('get-remote-lyrics', { trackId });
      return typeof lrc === 'string' && lrc.trim() ? classify(lrc, 'Server') : null;
    } catch {
      return null;
    }
  }

  const fs = window.require('fs') as typeof import('fs');

  const lrcPath = sidecarPathFor(songPath);
  if (fs.existsSync(lrcPath)) {
    try {
      return classify(fs.readFileSync(lrcPath, 'utf8'), 'LRC file');
    } catch {
      /* unreadable sidecar; fall through to the tags */
    }
  }

  try {
    const metadata = await parseFile(songPath, { skipCovers: true });
    const nativeFrames = [
      ...(metadata.native['ID3v2.3'] ?? []),
      ...(metadata.native['ID3v2.4'] ?? []),
    ];

    const sylt = nativeFrames.find(f => f.id === 'SYLT');
    const syltVal = sylt?.value as
      | { synchronisedText?: Array<{ text: string; timestamp: number }> }
      | undefined;
    if (syltVal?.synchronisedText?.length) {
      return { content: syltToLrc(syltVal.synchronisedText), source: 'Embedded', type: 'synced' };
    }

    const uslt = nativeFrames.find(f => f.id === 'USLT');
    const usltVal = uslt?.value as { text?: string } | undefined;
    if (usltVal?.text) return classify(usltVal.text, 'Embedded');

    const commonLyrics = (metadata.common as unknown as Record<string, unknown>).lyrics;
    const lyricText = Array.isArray(commonLyrics)
      ? (commonLyrics as Array<{ text?: string } | string>)
          .map(l => (typeof l === 'string' ? l : (l?.text ?? '')))
          .filter(Boolean)
          .join('\n')
      : typeof commonLyrics === 'string'
        ? commonLyrics
        : null;
    // Whatever container carried this had nowhere to put timings.
    if (lyricText) return { content: lyricText, source: 'Embedded', type: 'unsynced' };
  } catch {
    /* unreadable tags */
  }

  return null;
}
