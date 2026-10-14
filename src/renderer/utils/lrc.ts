/**
 * The lyrics model behind Lyric Studio. Both tabs are views onto one Line[], so
 * every conversion between it and the text the user sees lives here.
 */

export interface Line {
  text: string;
  /** Milliseconds into the track; null until someone stamps it. */
  timeMs: number | null;
}

/**
 * `[mm:ss.xx]`, `[mm:ss.xxx]` or `[mm:ss]`. Minutes are uncapped for tracks past
 * 59, and the fraction is optional because plenty of files carry whole seconds.
 */
const TIMESTAMP = /\[(\d+):([0-5]?\d)(?:[.:](\d{1,3}))?\]/g;

/**
 * `[ti:…]`, `[ar:…]` and friends: file metadata, not lyrics. Dropped on the way
 * in, so re-saving a file that carried them loses them.
 */
const ID_TAG = /^\[[a-z]+:.*\]$/i;

const pad = (n: number) => n.toString().padStart(2, '0');

/** Trimmed on both paths, so reconcile() can match editor text to parsed lines. */
const splitLines = (text: string): string[] => text.split(/\r?\n/).map(l => l.trim());

function toMs(mm: string, ss: string, frac?: string): number {
  // '.3' is three hundred milliseconds, not three; '.34' is centiseconds.
  const f = frac ? Number(frac.padEnd(3, '0')) : 0;
  return (Number(mm) * 60 + Number(ss)) * 1000 + f;
}

/** `mm:ss.xx`, the LRC timestamp and what the sync rows display. */
export function formatLrcTime(ms: number): string {
  // Rounded to centiseconds in one step: rounding the fields separately lets a
  // 999ms value render as `:00.100`.
  const cs = Math.max(0, Math.round(ms / 10));
  return `${pad(Math.floor(cs / 6000))}:${pad(Math.floor((cs % 6000) / 100))}.${pad(cs % 100)}`;
}

/** Accepts LRC or pasted plain text; untimed text parses to lines with no stamp. */
export function parseLrc(text: string): Line[] {
  const out: Line[] = [];

  for (const line of splitLines(text)) {
    if (ID_TAG.test(line)) continue;

    // Only leading timestamps count, so a bracket inside the lyric survives.
    TIMESTAMP.lastIndex = 0;
    const stamps: number[] = [];
    let cursor = 0;
    let m: RegExpExecArray | null;
    while ((m = TIMESTAMP.exec(line)) !== null && m.index === cursor) {
      stamps.push(toMs(m[1], m[2], m[3]));
      cursor = TIMESTAMP.lastIndex;
    }

    const body = line.slice(cursor).trim();
    if (!stamps.length) {
      out.push({ text: body, timeMs: null });
    } else {
      // `[00:12][01:20]Chorus` is one line sung twice. Split so each occurrence
      // can be re-timed on its own.
      for (const ms of stamps) out.push({ text: body, timeMs: ms });
    }
  }

  return out;
}

/** What the editor's textarea shows. */
export function toText(lines: Line[]): string {
  return lines.map(l => l.text).join('\n');
}

/**
 * What goes to a .lrc sidecar or an embedded tag. Unstamped lines are written
 * bare, so a half-finished sync reopens intact. `endMs` becomes a trailing
 * timestamp with no words, which is how an LRC says where the last line stops.
 */
export function toLrc(lines: Line[], endMs?: number | null): string {
  const body = lines.map(l =>
    l.timeMs == null ? l.text : `[${formatLrcTime(l.timeMs)}]${l.text}`
  );
  if (endMs != null) body.push(`[${formatLrcTime(endMs)}]`);
  return body.join('\n');
}

/**
 * Split a parsed file back into lyrics and that trailing end mark. Left in the
 * list it shows up as a blank row that can be stamped like any other.
 */
export function splitEndMark(lines: Line[]): { lines: Line[]; endMs: number | null } {
  const last = lines[lines.length - 1];
  if (last && last.text === '' && last.timeMs != null) {
    return { lines: lines.slice(0, -1), endMs: last.timeMs };
  }
  return { lines, endMs: null };
}

/** Set, nudge or clear one line's timestamp. `null` clears it. */
export function stamp(lines: Line[], index: number, timeMs: number | null): Line[] {
  if (index < 0 || index >= lines.length) return lines;
  const next = lines.slice();
  next[index] = {
    ...lines[index],
    timeMs: timeMs == null ? null : Math.max(0, Math.round(timeMs)),
  };
  return next;
}

/**
 * Drop the timings from `index` onward. Stepping back means redoing everything
 * from that line, so leaving the marks would claim a sync that is not there.
 */
export function clearFrom(lines: Line[], index: number): Line[] {
  const from = Math.max(0, index);
  if (from >= lines.length) return lines;
  return lines.map((line, i) => (i < from || line.timeMs == null ? line : { ...line, timeMs: null }));
}

/**
 * Where playback resumes when the cursor steps back to `index`: that line's own
 * mark, the nearest above it, or the track start. The fallbacks are what stop a
 * rewind doing nothing at the leading edge, where nothing has been stamped yet.
 */
export function stampAtOrBefore(lines: Line[], index: number): number {
  for (let i = Math.min(index, lines.length - 1); i >= 0; i--) {
    const at = lines[i]?.timeMs;
    if (at != null) return at;
  }
  return 0;
}

/**
 * Where the line at `index` gives way: the next marked line below it, else the
 * end mark, else null when a preview has no point to stop at. Unmarked lines in
 * between are skipped; one has not been placed anywhere yet.
 */
export function nextStampAfter(
  lines: Line[],
  index: number,
  endMs?: number | null
): number | null {
  for (let i = Math.max(0, index + 1); i < lines.length; i++) {
    const at = lines[i]?.timeMs;
    if (at != null) return at;
  }
  return endMs ?? null;
}

/**
 * Carry timestamps across an edit in the Editor tab.
 *
 * The textarea holds no timing, so re-parsing alone throws every stamp away.
 * Matching by index is no better: splitting a line is a normal move here, and an
 * insert shifts everything below it onto the wrong words. A text -> time map
 * cannot do the job either, since a repeated lyric collapses onto one time. So
 * the two versions are aligned by longest common subsequence.
 *
 * ponytail: O(n x m) table. Songs run 50-200 lines, so it is microseconds;
 * revisit only if this ever runs over something that is not a song.
 */
export function reconcile(previous: Line[], editedText: string): Line[] {
  const next: Line[] = splitLines(editedText).map(text => ({ text, timeMs: null }));
  const a = previous.map(l => l.text);
  const b = next.map(l => l.text);

  // Built back to front so the walk below can read it front to back.
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Lines that changed, gathered between two identical ones.
  let goneA: number[] = [];
  let newB: number[] = [];

  /**
   * A run of changed lines with the same count on both sides is the same lines
   * reworded, so their timings still apply. Different counts mean a line was
   * split, merged, added or dropped, and no new line honestly inherits a time.
   */
  const flush = () => {
    if (goneA.length === newB.length) {
      for (let k = 0; k < goneA.length; k++) next[newB[k]].timeMs = previous[goneA[k]].timeMs;
    }
    goneA = [];
    newB = [];
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      flush();
      next[j].timeMs = previous[i].timeMs;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      goneA.push(i);
      i++;
    } else {
      newB.push(j);
      j++;
    }
  }
  while (i < a.length) goneA.push(i++);
  while (j < b.length) newB.push(j++);
  flush();

  return next;
}
