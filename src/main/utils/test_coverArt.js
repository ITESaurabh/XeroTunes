// Covers come out at most 1200px and as JPEG; ones already fine are untouched.
// Run: node src/main/utils/test_coverArt.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { capCover, capStoredCovers, MAX_COVER_PX, MAX_COVER_BYTES } = require('./coverArt');

const image = (width, height, channels = 3) =>
  sharp({ create: { width, height, channels, background: { r: 200, g: 40, b: 40, alpha: 0.5 } } });

// Seeded noise: the worst case for JPEG size, the same bytes on every run.
function noise(width, height) {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 1;
  for (let i = 0; i < pixels.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pixels[i] = seed >> 23;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

async function main() {
  const bigPng = await capCover(await image(2400, 1200, 4).png().toBuffer());
  const bigPngMeta = await sharp(bigPng).metadata();
  assert.deepStrictEqual(
    [bigPngMeta.format, bigPngMeta.width, bigPngMeta.height],
    ['jpeg', MAX_COVER_PX, 600]
  );

  const smallJpeg = await image(800, 800).jpeg({ quality: 80 }).toBuffer();
  assert.strictEqual(await capCover(smallJpeg), smallJpeg);

  const heavy = await noise(MAX_COVER_PX, MAX_COVER_PX).jpeg({ quality: 100 }).toBuffer();
  assert.ok(heavy.length > MAX_COVER_BYTES);
  const lightened = await capCover(heavy);
  assert.ok(lightened.length <= MAX_COVER_BYTES, `${lightened.length} bytes`);
  assert.strictEqual((await sharp(lightened).metadata()).width, MAX_COVER_PX);

  const smallPng = await sharp(await capCover(await image(300, 200).png().toBuffer())).metadata();
  assert.deepStrictEqual([smallPng.format, smallPng.width, smallPng.height], ['jpeg', 300, 200]);

  // Orientation 6 is a 90° turn, so the landscape frame comes out portrait.
  const rotated = await image(1600, 800).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const rotatedMeta = await sharp(await capCover(rotated)).metadata();
  assert.deepStrictEqual([rotatedMeta.width, rotatedMeta.height], [600, MAX_COVER_PX]);
  assert.ok(!rotatedMeta.orientation || rotatedMeta.orientation === 1);

  const junk = Buffer.from('not an image');
  assert.strictEqual(await capCover(junk), junk);

  // Rewrites only what needs it; the marker then stops any second pass.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-coverart-'));
  fs.writeFileSync(path.join(dir, '1.jpg'), await image(2000, 2000).jpeg().toBuffer());
  fs.writeFileSync(path.join(dir, '2.jpg'), smallJpeg);
  assert.strictEqual(await capStoredCovers(dir), 1);
  const capped = await sharp(fs.readFileSync(path.join(dir, '1.jpg'))).metadata();
  assert.strictEqual(capped.width, MAX_COVER_PX);
  assert.ok(fs.readFileSync(path.join(dir, '2.jpg')).equals(smallJpeg));
  assert.ok(!fs.readdirSync(dir).some(f => f.endsWith('.part')));
  fs.writeFileSync(path.join(dir, '3.jpg'), await image(2000, 2000).jpeg().toBuffer());
  assert.strictEqual(await capStoredCovers(dir), 0);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('coverArt: all assertions passed');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
