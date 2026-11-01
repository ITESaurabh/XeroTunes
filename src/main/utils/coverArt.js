// Album art as the app stores it: at most 1200px on the long side, as JPEG.
// Plain JS so the scan worker, the main process and test_coverArt.js can all load it.
//
// 1200px covers the 520px turntable on a 2x screen. Chromium drops a Media Session
// artwork data URL over 2 MB (macOS then shows the previous cover); base64 leaves
// 1.5 MB of file, and a 1200px JPEG at quality 95 stays under that even for noise.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MAX_COVER_PX = 1200;
const MAX_COVER_BYTES = 1_500_000;
const COVER_QUALITY = 95;

// Named after both limits so changing one reruns the pass; the orphan sweep only deletes <id>.jpg.
const CAPPED_MARKER = `.capped-${MAX_COVER_PX}px-${MAX_COVER_BYTES}b`;

/**
 * A JPEG within both limits comes back as the same Buffer; anything else is re-encoded.
 * Unreadable bytes come back as they are, so a broken picture never fails a scan.
 */
async function capCover(data) {
  try {
    const image = sharp(data);
    const { format, width = 0, height = 0 } = await image.metadata();
    if (
      format === 'jpeg' &&
      Math.max(width, height) <= MAX_COVER_PX &&
      data.length <= MAX_COVER_BYTES
    ) {
      return data;
    }
    return await image
      .rotate() // bake in EXIF orientation, which re-encoding drops
      .resize(MAX_COVER_PX, MAX_COVER_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: COVER_QUALITY })
      .toBuffer();
  } catch (err) {
    console.warn('[cover] Kept as is, could not read:', err?.message || err);
    return data;
  }
}

async function imageSize(data) {
  try {
    const { width, height } = await sharp(data).metadata();
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
}

/** Re-caps covers stored under older rules, once; returns how many it rewrote. */
async function capStoredCovers(dir) {
  const marker = path.join(dir, CAPPED_MARKER);
  if (!fs.existsSync(dir) || fs.existsSync(marker)) return 0;
  let capped = 0;
  for (const name of await fs.promises.readdir(dir)) {
    if (!/\.jpg$/i.test(name)) continue;
    const file = path.join(dir, name);
    try {
      // Not the path: on Windows sharp's cache keeps the file open and the rename fails.
      const data = await fs.promises.readFile(file);
      const out = await capCover(data);
      if (out === data) continue;
      await fs.promises.writeFile(`${file}.part`, out);
      await fs.promises.rename(`${file}.part`, file);
      capped++;
    } catch (err) {
      console.warn('[cover] Could not cap', name, err?.message || err);
    }
  }
  await fs.promises.writeFile(marker, '');
  return capped;
}

module.exports = { capCover, capStoredCovers, imageSize, MAX_COVER_PX, MAX_COVER_BYTES };
