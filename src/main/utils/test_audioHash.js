// A wrong range either hides real duplicates or merges different songs, and a
// broken tag header must not throw a file out of the scan.
// Run: node src/main/utils/test_audioHash.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { HASH_PREFIX, fileHash, id3AudioRange } = require('./audioHash');

const syncsafe = n => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const id3v2 = (body, flags = 0) =>
  Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 3, 0, flags, ...syncsafe(body.length)]), body]);
const id3v1 = title => {
  const tag = Buffer.alloc(128);
  tag.write('TAG');
  tag.write(title, 3);
  return tag;
};
const frames = Buffer.from('stand-in for mpeg frames');

const tagged = Buffer.concat([id3v2(Buffer.alloc(100)), frames, id3v1('x')]);
const rangeOf = file => id3AudioRange(file.subarray(0, 10), file.subarray(-128), file.length);
assert.deepStrictEqual(rangeOf(tagged), { start: 110, end: 110 + frames.length });
// The footer flag adds a 10-byte copy of the header after the tag.
const footed = Buffer.concat([id3v2(Buffer.alloc(100), 0x10), Buffer.alloc(10), frames]);
assert.strictEqual(rangeOf(footed).start, 120);
// An untagged file is hashed whole.
assert.deepStrictEqual(rangeOf(frames), { start: 0, end: frames.length });
// A size larger than the file falls back to the whole file instead of an empty range.
const corrupt = Buffer.concat([
  Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f]),
  frames,
]);
assert.deepStrictEqual(rangeOf(corrupt), { start: 0, end: corrupt.length });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-audiohash-'));
  const write = (name, bytes) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, bytes);
    return file;
  };
  try {
    // Same audio, different cover-art size and ID3v1 title.
    const a = write('a.mp3', Buffer.concat([id3v2(Buffer.alloc(300)), frames, id3v1('one')]));
    const b = write('b.MP3', Buffer.concat([id3v2(Buffer.alloc(900)), frames, id3v1('two')]));
    const other = write(
      'c.mp3',
      Buffer.concat([id3v2(Buffer.alloc(300)), Buffer.from('other audio')])
    );
    assert.strictEqual(await fileHash(a), await fileHash(b));
    assert.notStrictEqual(await fileHash(a), await fileHash(other));
    assert.ok((await fileHash(a)).startsWith(HASH_PREFIX));

    // Formats without ID3 handling still hash every byte.
    const flacA = write('a.flac', Buffer.concat([id3v2(Buffer.alloc(300)), frames]));
    const flacB = write('b.flac', Buffer.concat([id3v2(Buffer.alloc(900)), frames]));
    assert.notStrictEqual(await fileHash(flacA), await fileHash(flacB));

    // Empty and tiny files hash rather than throw.
    assert.ok((await fileHash(write('empty.mp3', Buffer.alloc(0)))).startsWith(HASH_PREFIX));
    assert.ok((await fileHash(write('tiny.mp3', Buffer.from('ID3')))).startsWith(HASH_PREFIX));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('audioHash: all assertions passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
