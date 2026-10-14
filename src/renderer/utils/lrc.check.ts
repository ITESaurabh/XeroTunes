/** Self-check: run with `node src/renderer/utils/lrc.check.ts`. */
import assert from 'node:assert';
import {
  clearFrom,
  formatLrcTime,
  nextStampAfter,
  parseLrc,
  reconcile,
  stamp,
  splitEndMark,
  stampAtOrBefore,
  toLrc,
  toText,
  type Line,
} from './lrc.ts';

const texts = (lines: Line[]) => lines.map(l => l.text);
const times = (lines: Line[]) => lines.map(l => l.timeMs);

// ── formatLrcTime ──────────────────────────────────────────────────────────
assert.equal(formatLrcTime(0), '00:00.00');
assert.equal(formatLrcTime(7190), '00:07.19');
assert.equal(formatLrcTime(8560), '00:08.56');
// Rounding the fields separately would render this as ':00.100'.
assert.equal(formatLrcTime(999), '00:01.00');
// Minutes are not capped at 59; a long track keeps counting.
assert.equal(formatLrcTime(3_600_000), '60:00.00');
// A nudge below zero clamps rather than writing a negative stamp.
assert.equal(formatLrcTime(-500), '00:00.00');

// ── parseLrc ───────────────────────────────────────────────────────────────
// Pasted plain text is the starting state of every new sync.
const pasted = parseLrc('I push myself to the edge\nFeel it in my chest');
assert.deepEqual(texts(pasted), ['I push myself to the edge', 'Feel it in my chest']);
assert.deepEqual(times(pasted), [null, null]);

// Centiseconds, milliseconds and bare seconds all appear in real files.
assert.deepEqual(times(parseLrc('[00:07.19]a\n[00:08.560]b\n[01:00]c')), [7190, 8560, 60_000]);
// '.3' is three hundred milliseconds, not three.
assert.deepEqual(times(parseLrc('[00:01.3]a')), [1300]);

// Metadata is not a lyric and must not show up as an editable line.
assert.deepEqual(texts(parseLrc('[ti:Song]\n[ar:Artist]\n[offset:+500]\n[00:01.00]real')), [
  'real',
]);

// One line sung twice splits, so each occurrence can be re-timed on its own.
const repeated = parseLrc('[00:12.00][01:20.00]Chorus');
assert.deepEqual(texts(repeated), ['Chorus', 'Chorus']);
assert.deepEqual(times(repeated), [12_000, 80_000]);

// Stanza breaks are meaningful, so blank lines survive as blank lines.
assert.deepEqual(texts(parseLrc('a\n\nb')), ['a', '', 'b']);

// Only a leading timestamp is timing; a bracket inside the lyric is lyric.
const inline = parseLrc('you said [00:12.00] to me');
assert.deepEqual(texts(inline), ['you said [00:12.00] to me']);
assert.deepEqual(times(inline), [null]);

// ── toLrc / toText ─────────────────────────────────────────────────────────
const lrc = '[00:07.19]I don’t know why\n[00:08.56]I don’t know what I feel';
assert.equal(toLrc(parseLrc(lrc)), lrc, 'round-trips unchanged');

// A half-finished sync has to save and reopen without losing either half.
const partial: Line[] = [
  { text: 'timed', timeMs: 1000 },
  { text: 'untimed', timeMs: null },
];
assert.equal(toLrc(partial), '[00:01.00]timed\nuntimed');
assert.deepEqual(times(parseLrc(toLrc(partial))), [1000, null]);

assert.equal(toText(partial), 'timed\nuntimed', 'the editor never sees timestamps');

// ── end mark ───────────────────────────────────────────────────────────────
// A trailing bare timestamp says where the last line stops.
assert.equal(toLrc(partial, 90_000), '[00:01.00]timed\nuntimed\n[01:30.00]');
assert.equal(toLrc(partial, null), '[00:01.00]timed\nuntimed', 'no end mark, no extra line');

// It comes back off the parse rather than posing as a blank lyric row.
const withEnd = splitEndMark(parseLrc('[00:01.00]a\n[00:02.00]b\n[01:30.00]'));
assert.deepEqual(texts(withEnd.lines), ['a', 'b']);
assert.equal(withEnd.endMs, 90_000);
// Round-trips as a whole.
assert.equal(toLrc(withEnd.lines, withEnd.endMs), '[00:01.00]a\n[00:02.00]b\n[01:30.00]');

// A blank line with no timestamp is a stanza break, not an end mark.
const noEnd = splitEndMark(parseLrc('[00:01.00]a\n'));
assert.deepEqual(texts(noEnd.lines), ['a', '']);
assert.equal(noEnd.endMs, null);
assert.deepEqual(splitEndMark([]).lines, [], 'empty lyrics have no end mark');
assert.equal(splitEndMark([]).endMs, null);

// ── stamp ──────────────────────────────────────────────────────────────────
const base: Line[] = [
  { text: 'a', timeMs: null },
  { text: 'b', timeMs: null },
];
assert.deepEqual(times(stamp(base, 1, 4200)), [null, 4200]);
// Clearing is the row's ✕; nudging is the same door with an adjusted value.
assert.deepEqual(times(stamp(stamp(base, 1, 4200), 1, null)), [null, null]);
assert.deepEqual(times(stamp(stamp(base, 1, 4200), 1, 4200 - 500)), [null, 3700]);
// A nudge cannot push a line before the start of the track.
assert.deepEqual(times(stamp(stamp(base, 0, 200), 0, -300)), [0, null]);
// currentTime is fractional; stamps are whole milliseconds.
assert.deepEqual(times(stamp(base, 0, 1234.6)), [1235, null]);
// The source array is never mutated; React state depends on it.
assert.deepEqual(times(base), [null, null]);
assert.deepEqual(times(stamp(base, 9, 1000)), [null, null], 'out of range is a no-op');

// ── clearFrom / stampAtOrBefore ────────────────────────────────────────────
const run: Line[] = [
  { text: 'a', timeMs: 1000 },
  { text: 'b', timeMs: 2000 },
  { text: 'c', timeMs: 3000 },
  { text: 'd', timeMs: null },
];

// Stepping back to 'b' means 'b' onward is being redone.
assert.deepEqual(times(clearFrom(run, 1)), [1000, null, null, null]);
// Backing all the way past the first line restarts the whole sync.
assert.deepEqual(times(clearFrom(run, 0)), [null, null, null, null]);
assert.deepEqual(times(clearFrom(run, -1)), [null, null, null, null], 'the … marker clears all');
// Past the end there is nothing to forget.
assert.deepEqual(times(clearFrom(run, 9)), [1000, 2000, 3000, null]);
// The source array is never mutated; React state depends on it.
assert.deepEqual(times(run), [1000, 2000, 3000, null]);

// Rewind lands on the line's own mark…
assert.equal(stampAtOrBefore(run, 2), 3000);
// …and on the nearest one above when that line was never stamped, so a rewind
// at the leading edge still moves the playhead instead of running on.
assert.equal(stampAtOrBefore(run, 3), 3000);
// Nothing stamped yet anywhere above: go back to the start of the track.
assert.equal(stampAtOrBefore([{ text: 'x', timeMs: null }], 0), 0);
assert.equal(stampAtOrBefore(run, -1), 0);
assert.equal(stampAtOrBefore([], 5), 0, 'empty lyrics must not read past the end');
// A stamp of exactly zero is a real mark, not a missing one.
assert.equal(stampAtOrBefore([{ text: 'x', timeMs: 0 }], 0), 0);

// ── nextStampAfter ─────────────────────────────────────────────────────────
// Previewing a line plays it up to where the next one starts.
assert.equal(nextStampAfter(run, 0), 2000);
assert.equal(nextStampAfter(run, 1), 3000);
// 'd' is untimed, so 'c' runs on past it: an unplaced line is not a boundary.
assert.equal(nextStampAfter(run, 2), null);
// …unless an end mark says where the lyrics stop.
assert.equal(nextStampAfter(run, 2, 9000), 9000);
assert.equal(nextStampAfter(run, 3, 9000), 9000, 'the last line ends at the end mark');
// Nothing marked below and no end mark: the preview just plays on.
assert.equal(nextStampAfter(run, 9), null);
assert.equal(nextStampAfter([], 0), null);
// From the opening marker the boundary is the first marked line.
assert.equal(nextStampAfter(run, -1), 1000);

// ── reconcile ──────────────────────────────────────────────────────────────
const synced: Line[] = [
  { text: 'one two', timeMs: 1000 },
  { text: 'middle', timeMs: 2000 },
  { text: 'three', timeMs: 3000 },
];

// Rewording a line keeps its own timing: it is still that line, sung at the same
// moment, so a typo fix after syncing must not throw the work away.
assert.deepEqual(times(reconcile(synced, 'one two\nmiddle!\nthree')), [1000, 2000, 3000]);
// Editing the first word counts too; nothing anchors on how a line starts.
assert.deepEqual(times(reconcile(synced, 'one two\nMiddle\nthree')), [1000, 2000, 3000]);
// Several reworded lines in a row still line up one for one.
assert.deepEqual(times(reconcile(synced, 'ONE two\nmiddle!\nthree')), [1000, 2000, 3000]);
// The last line has no line after it to anchor against, and still carries.
assert.deepEqual(times(reconcile(synced, 'one two\nmiddle\nthree!')), [1000, 2000, 3000]);

// But a reworded line next to an inserted one is ambiguous, two new lines for
// one old, so neither claims the time rather than guessing wrong.
assert.deepEqual(times(reconcile(synced, 'one two\nmiddle!\nextra\nthree')), [
  1000,
  null,
  null,
  3000,
]);

// Splitting a long line is what the tips rail asks for, and it is exactly where
// index-matching would break: 'three' must keep 3000 even though the lines
// above it grew by one.
const split = reconcile(synced, 'one\ntwo\nmiddle\nthree');
assert.deepEqual(texts(split), ['one', 'two', 'middle', 'three']);
assert.deepEqual(times(split), [null, null, 2000, 3000]);

// Deleting a line shifts nothing onto the wrong words.
assert.deepEqual(times(reconcile(synced, 'one two\nthree')), [1000, 3000]);

// Lyrics repeat constantly, so a text -> time map would collapse these onto one
// time. Each occurrence has to keep its own.
const dupes: Line[] = [
  { text: 'push', timeMs: 1000 },
  { text: 'x', timeMs: 1500 },
  { text: 'push', timeMs: 2000 },
];
assert.deepEqual(times(reconcile(dupes, 'push\nx\npush')), [1000, 1500, 2000]);
assert.deepEqual(times(reconcile(dupes, 'push\npush')), [1000, 2000], 'second push keeps its own');

// Clearing the editor loses the timings with the text, and does not crash.
assert.deepEqual(reconcile(synced, ''), [{ text: '', timeMs: null }]);
// Starting from nothing is the paste case.
assert.deepEqual(times(reconcile([], 'a\nb')), [null, null]);

// Windows newlines arrive from pasted text and from files written on Windows.
assert.deepEqual(texts(reconcile(synced, 'one two\r\nmiddle\r\nthree')), [
  'one two',
  'middle',
  'three',
]);
assert.deepEqual(times(reconcile(synced, 'one two\r\nmiddle\r\nthree')), [1000, 2000, 3000]);

console.log('lrc.check.ts OK');
