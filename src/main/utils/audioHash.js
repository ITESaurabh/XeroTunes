// The hash behind duplicate detection and favourites matching. Plain JS with no
// deps so the scan worker and test_audioHash.js can both load it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Bump when the hashed bytes change: the basic scan rehashes every row without
// this prefix, so old and new hashes never get compared.
const HASH_PREFIX = 'a1:';

// A re-tag rewrites the ID3 blocks around MP3/AAC audio and leaves the audio
// bit-identical, so only the bytes between them are hashed.
// ponytail: other formats hash the whole file; FLAC blocks, WAV chunks and M4A
// atoms could be skipped the same way.
// ponytail: APEv2 and Lyrics3 trailers (MP3Gain, foobar2000) count as audio.
const ID3_EXTENSIONS = new Set(['.mp3', '.aac']);

/** The [start, end) byte range left after dropping an ID3v2 header and an ID3v1 trailer. */
function id3AudioRange(head, tail, size) {
  let start = 0;
  if (head.length >= 10 && head.toString('latin1', 0, 3) === 'ID3') {
    // Syncsafe (7 bits per byte), excluding the 10-byte header and the optional 10-byte footer.
    const tagSize =
      ((head[6] & 0x7f) << 21) |
      ((head[7] & 0x7f) << 14) |
      ((head[8] & 0x7f) << 7) |
      (head[9] & 0x7f);
    start = 10 + tagSize + (head[5] & 0x10 ? 10 : 0);
  }
  let end = size;
  if (tail.length === 128 && tail.toString('latin1', 0, 3) === 'TAG') end -= 128;
  // A tag claiming more bytes than the file holds is corrupt; hash all of it.
  return start < end ? { start, end } : { start: 0, end: size };
}

async function fileHash(filePath) {
  const { size } = await fs.promises.stat(filePath);
  let range = { start: 0, end: size };
  if (ID3_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    const file = await fs.promises.open(filePath, 'r');
    try {
      const head = Buffer.alloc(Math.min(10, size));
      const tail = Buffer.alloc(Math.min(128, size));
      await file.read(head, 0, head.length, 0);
      await file.read(tail, 0, tail.length, size - tail.length);
      range = id3AudioRange(head, tail, size);
    } finally {
      await file.close();
    }
  }

  const hash = crypto.createHash('sha1');
  // `end` is inclusive here; an empty file would otherwise ask for byte -1 and throw.
  const stream = fs.createReadStream(filePath, {
    start: range.start,
    end: Math.max(range.end - 1, 0),
  });
  return new Promise((resolve, reject) => {
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(HASH_PREFIX + hash.digest('hex')));
    stream.on('error', reject);
  });
}

module.exports = { HASH_PREFIX, fileHash, id3AudioRange };
