/* eslint-disable @typescript-eslint/no-var-requires */
// Round-trip check: writeTags puts a tag on disk, music-metadata (what the rest
// of the app reads with) gets the same values back.
// Run: node src/main/utils/test_tagWriter.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeTags } = require('./tagWriter');

// One silent MPEG-1 Layer III frame: 128 kbps, 44.1 kHz, stereo. Enough for
// taglib and music-metadata to recognise the file as an MP3.
function makeSilentMp3(filePath) {
  const frame = Buffer.alloc(417);
  frame.writeUInt32BE(0xfffb9000, 0);
  fs.writeFileSync(filePath, Buffer.concat([frame, frame, frame]));
}

// 1x1 red PNG.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-tagwriter-'));
  const mp3 = path.join(dir, 'sample.mp3');
  const art = path.join(dir, 'cover.png');
  makeSilentMp3(mp3);
  fs.writeFileSync(art, PNG_1PX);

  // eslint-disable-next-line import/no-unresolved -- ESM-only package; same gap mainProcess.ts has
  const { parseFile } = await import('music-metadata');

  writeTags(mp3, {
    title: 'Test Title',
    artists: ['Alpha & Beta'],
    album: 'Test Album',
    albumArtists: ['Alpha'],
    year: 1999,
    genres: ['Shoegaze'],
    disc: 2,
    track: 7,
    comment: 'hello',
    encodedBy: 'XeroTunes',
    artPath: art,
  });

  let common = (await parseFile(mp3)).common;
  assert.strictEqual(common.title, 'Test Title');
  assert.strictEqual(common.artist, 'Alpha & Beta');
  assert.strictEqual(common.album, 'Test Album');
  assert.strictEqual(common.albumartist, 'Alpha');
  assert.strictEqual(common.year, 1999);
  assert.deepStrictEqual(common.genre, ['Shoegaze']);
  assert.strictEqual(common.disk.no, 2);
  assert.strictEqual(common.track.no, 7);
  assert.strictEqual(common.comment[0].text, 'hello');
  // encodedBy is written per container format, so this catches a wrong frame id.
  assert.strictEqual(common.encodedby, 'XeroTunes');
  assert.strictEqual(common.picture.length, 1);

  // A second write must leave untouched fields alone; that is what makes an
  // album-wide edit safe to apply over per-track values.
  writeTags(mp3, { album: 'Renamed Album', artPath: null });
  common = (await parseFile(mp3)).common;
  assert.strictEqual(common.album, 'Renamed Album');
  assert.strictEqual(common.title, 'Test Title');
  assert.strictEqual(common.track.no, 7);
  assert.strictEqual(common.encodedby, 'XeroTunes');
  assert.ok(!common.picture || common.picture.length === 0, 'art should be stripped');

  // Windows reads album art out of ID3v2.3 only; taglib defaults a new tag to 2.4.
  const fresh = await parseFile(mp3);
  assert.ok(
    fresh.format.tagTypes.includes('ID3v2.3'),
    `expected ID3v2.3, got ${fresh.format.tagTypes}`
  );

  // A file arriving as 2.4 has to come out as 2.3 with every frame intact. This
  // is the case that catches Id3v2Settings.forceDefaultVersion silently dropping
  // APIC and everything after it.
  const { File: TagFile, Picture, PictureType, TagTypes } = require('node-taglib-sharp');
  const legacy = path.join(dir, 'v24.mp3');
  makeSilentMp3(legacy);
  const seed = TagFile.createFromPath(legacy);
  seed.tag.title = 'From 2.4';
  const seedPic = Picture.fromPath(art);
  seedPic.type = PictureType.FrontCover;
  seed.tag.pictures = [seedPic];
  seed.getTag(TagTypes.Id3v2, false).version = 4;
  seed.save();
  seed.dispose();

  const seeded = await parseFile(legacy);
  assert.ok(seeded.format.tagTypes.includes('ID3v2.4'), 'fixture should start out as 2.4');
  assert.strictEqual(seeded.common.picture.length, 1);

  writeTags(legacy, { comment: 'touched' });
  const converted = await parseFile(legacy);
  assert.ok(
    converted.format.tagTypes.includes('ID3v2.3'),
    `expected ID3v2.3 after conversion, got ${converted.format.tagTypes}`
  );
  assert.strictEqual(converted.common.title, 'From 2.4');
  assert.strictEqual(converted.common.picture.length, 1, 'art must survive the downgrade');

  // ID3v2.3 has no UTF-8: taglib has to fall back to UTF-16 rather than write a
  // frame nothing else can decode. Asserts the round trip, not the encoding byte.
  const CJK = 'Wuthering Waves, Forts, 楊秉音';
  writeTags(legacy, { title: CJK, artists: [CJK], comment: CJK });
  const unicode = await parseFile(legacy);
  assert.strictEqual(unicode.common.title, CJK);
  assert.strictEqual(unicode.common.artist, CJK);
  assert.strictEqual(unicode.common.comment[0].text, CJK);
  assert.ok(unicode.format.tagTypes.includes('ID3v2.3'), 'unicode must not force a version bump');

  // A PNG behind a .jpg name: the embedded MIME has to describe the bytes, or
  // strict readers show no art.
  const liar = path.join(dir, 'actually-a-png.jpg');
  fs.writeFileSync(liar, PNG_1PX);
  writeTags(legacy, { artPath: liar });
  const sniffed = await parseFile(legacy);
  assert.strictEqual(sniffed.common.picture[0].format, 'image/png');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('tagWriter: all assertions passed');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
