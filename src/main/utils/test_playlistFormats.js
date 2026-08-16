/* eslint-disable @typescript-eslint/no-var-requires */
// A wrong answer here writes a playlist another player can't read, or fails to
// re-match a track on import. Run: node src/main/utils/test_playlistFormats.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  detectPlaylistFormat,
  parseM3U,
  writeM3U,
  parsePLS,
  writePLS,
  parseXSPF,
  writeXSPF,
  parsePlaylistFile,
  writePlaylistFile,
  resolveLocation,
} = require('./playlistFormats');

assert.strictEqual(detectPlaylistFormat('a/b.M3U8'), 'm3u8');
assert.strictEqual(detectPlaylistFormat('a/b.pls'), 'pls');
assert.strictEqual(detectPlaylistFormat('a/b.txt'), null);

// ── resolveLocation ──────────────────────────────────────────────────────
const base = path.join('D:', 'Music', 'Meteora');
assert.strictEqual(resolveLocation('01. Foreword.flac', base), path.join(base, '01. Foreword.flac'));
assert.strictEqual(resolveLocation('http://stream.example/live.mp3', base), 'http://stream.example/live.mp3');
assert.strictEqual(
  resolveLocation('file:///D:/Music/Meteora/02.%20Don%27t%20Stay.flac', base),
  "D:\\Music\\Meteora\\02. Don't Stay.flac"
);

// ── M3U: the real shape shipped alongside ripped FLAC albums ────────────
const m3uFixture = [
  '#EXTM3U',
  "#EXTINF:13,Linkin Park - Foreword",
  '01. Foreword.flac',
  '#EXTINF:188,Linkin Park - Don\'t Stay',
  "02. Don't Stay.flac",
].join('\r\n');
const m3uEntries = parseM3U(m3uFixture, base);
assert.strictEqual(m3uEntries.length, 2);
assert.strictEqual(m3uEntries[0].location, path.join(base, '01. Foreword.flac'));
assert.strictEqual(m3uEntries[0].title, 'Linkin Park - Foreword');
assert.strictEqual(m3uEntries[0].duration, 13);
assert.strictEqual(m3uEntries[1].duration, 188);

// ── Round trips through a real temp file for each format ────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-playlist-'));
const trackDir = path.join(tmpDir, 'tracks');
fs.mkdirSync(trackDir);
const trackPath = path.join(trackDir, "Don't Stay.flac");
fs.writeFileSync(trackPath, '');

const entries = [{ location: trackPath, title: "Don't Stay", artist: 'Linkin Park', duration: 188 }];

for (const ext of ['m3u', 'm3u8', 'pls', 'xspf']) {
  const filePath = path.join(tmpDir, `roundtrip.${ext}`);
  writePlaylistFile(filePath, entries, 'Roundtrip Test');
  const parsed = parsePlaylistFile(filePath);
  assert.strictEqual(parsed.length, 1, `${ext}: expected 1 entry`);
  assert.strictEqual(path.resolve(parsed[0].location), path.resolve(trackPath), `${ext}: location survived`);
  assert.ok(Math.abs((parsed[0].duration || 0) - 188) < 1, `${ext}: duration survived`);
}

// M3U/M3U8 write relative paths when the target sits under the output dir;
// that's what makes an exported playlist portable if the folder moves.
const m3uOut = writeM3U(entries, tmpDir);
assert.ok(m3uOut.includes(path.join('tracks', "Don't Stay.flac")), 'm3u writes a relative path');

// PLS always writes absolute paths (real-world PLS writers never write relative).
const plsOut = writePLS(entries);
assert.ok(plsOut.includes(`File1=${trackPath}`));
const plsParsed = parsePLS(plsOut, tmpDir);
assert.strictEqual(plsParsed[0].title, 'Linkin Park - Don\'t Stay');

// XSPF escapes XML-significant characters and round-trips them.
const xspfEntries = [{ location: trackPath, title: 'A & B <C>', artist: 'X "Y" Z', duration: 10 }];
const xspfOut = writeXSPF(xspfEntries, 'Esc & Test');
assert.ok(xspfOut.includes('A &amp; B &lt;C&gt;'));
const xspfParsed = parseXSPF(xspfOut, tmpDir);
assert.strictEqual(xspfParsed[0].title, 'A & B <C>');
assert.strictEqual(xspfParsed[0].artist, 'X "Y" Z');

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('playlistFormats: all assertions passed');
