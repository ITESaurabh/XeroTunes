/**
 * Generates NativeImage objects for the Windows thumbnail toolbar
 * using pure Node.js (zlib): no external deps, no binary asset files.
 */
import zlib from 'zlib';
import { nativeImage, NativeImage } from 'electron';

// ─── CRC32 (required by PNG spec) ────────────────────────────────────────────
const crcTable: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

function buildPNG(width: number, height: number, pixels: Buffer): Buffer {
  // IHDR
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Raw scanlines (filter byte 0 = None, then RGBA per pixel)
  const rowBytes = width * 4;
  const raw = Buffer.allocUnsafe((1 + rowBytes) * height);
  for (let y = 0; y < height; y++) {
    raw[(1 + rowBytes) * y] = 0; // filter type None
    pixels.copy(raw, (1 + rowBytes) * y + 1, y * rowBytes, (y + 1) * rowBytes);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Pixel helpers ────────────────────────────────────────────────────────────
function setPixel(p: Buffer, W: number, x: number, y: number, a = 255): void {
  if (x < 0 || y < 0 || x >= W) return;
  const i = (y * W + x) * 4;
  p[i] = 255; p[i + 1] = 255; p[i + 2] = 255; p[i + 3] = a;
}

function fillRect(p: Buffer, W: number, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) setPixel(p, W, x, y);
}

// --- Icon draw functions (20x20, white on transparent) ---
const W = 20, H = 20;

function makeIcon(drawFn: (p: Buffer) => void): NativeImage {
  const pixels = Buffer.alloc(W * H * 4, 0); // all transparent
  drawFn(pixels);
  return nativeImage.createFromBuffer(buildPNG(W, H, pixels));
}

// ▶ Play: right-pointing solid triangle
export const playIcon: NativeImage = makeIcon(p => {
  for (let y = 0; y < H; y++) {
    const half = (H - 1) / 2;
    const w = Math.max(1, Math.round((1 - Math.abs(y - half) / half) * 13));
    for (let x = 3; x < 3 + w; x++) setPixel(p, W, x, y);
  }
});

// ⏸ Pause: two vertical bars
export const pauseIcon: NativeImage = makeIcon(p => {
  fillRect(p, W, 3, 2, 7, H - 3);
  fillRect(p, W, 11, 2, 15, H - 3);
});

// ⏮ Previous: small left triangle + left bar
export const prevIcon: NativeImage = makeIcon(p => {
  fillRect(p, W, 2, 2, 4, H - 3); // bar
  const tip = 16;
  const half = (H - 1) / 2;
  for (let y = 0; y < H; y++) {
    const w = Math.max(1, Math.round((1 - Math.abs(y - half) / half) * 9));
    for (let x = tip - w; x <= tip; x++) setPixel(p, W, x, y);
  }
});

// ⏭ Next: small right triangle + right bar
export const nextIcon: NativeImage = makeIcon(p => {
  fillRect(p, W, W - 5, 2, W - 3, H - 3); // bar
  const half = (H - 1) / 2;
  for (let y = 0; y < H; y++) {
    const w = Math.max(1, Math.round((1 - Math.abs(y - half) / half) * 9));
    for (let x = 3; x < 3 + w; x++) setPixel(p, W, x, y);
  }
});
