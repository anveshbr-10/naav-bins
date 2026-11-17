// Generates the PWA / favicon PNGs from the same geometry as public/logo.svg.
// Pure Node (no image libraries): shapes are rasterised with 4x4 supersampling.
// Usage: node scripts/generate-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// ---- geometry (64x64 design space, mirrors logo.svg) ----
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const G1 = hex('#22c55e'), G2 = hex('#15803d'), LEAF = hex('#16a34a'), WHITE = [255, 255, 255];

const inRoundRect = (x, y, rx, ry, w, h, r) => {
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return x >= rx && x <= rx + w && y >= ry && y <= ry + h && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inBody = (x, y) => {
  if (y < 25 || y > 55) return false;
  const t = (y - 25) / 30;
  return x >= 18 + 2.8 * t && x <= 46 - 2.8 * t;
};
// Leaf = lens between two r=12 circles, tips at (25,47) and (39,33) (same arcs as logo.svg).
const LEAF_R = 12;
const lensCentres = (() => {
  const [x1, y1, x2, y2] = [25, 47, 39, 33];
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, half = Math.hypot(x2 - x1, y2 - y1) / 2;
  const d = Math.sqrt(LEAF_R ** 2 - half ** 2);
  const nx = -(y2 - y1) / (2 * half), ny = (x2 - x1) / (2 * half);
  return [[mx + nx * d, my + ny * d], [mx - nx * d, my - ny * d]];
})();
const inLeaf = (x, y) => lensCentres.every(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 <= LEAF_R ** 2);
const nearVein = (x, y) => { // segment (27,45)-(37,35), width 1.6
  const ax = 27, ay = 45, bx = 37, by = 35;
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))) <= 0.8;
};

// Colour at a design-space point; null = transparent.
// The background is sampled at (x, y); the artwork at the same point scaled about the centre.
function sample(x, y, fullBleed, scale) {
  const insideBg = fullBleed ? true : inRoundRect(x, y, 0, 0, 64, 64, 16);
  if (!insideBg) return null;
  const t = Math.min(1, Math.max(0, (x + y) / 128));
  let c = G1.map((v, i) => v + (G2[i] - v) * t);
  const ax = 32 + (x - 32) / scale, ay = 32 + (y - 32) / scale;
  if (inRoundRect(ax, ay, 15, 16, 34, 6, 3) || inRoundRect(ax, ay, 27, 11, 10, 6, 2) || inBody(ax, ay)) c = WHITE;
  if (inLeaf(ax, ay)) c = nearVein(ax, ay) ? WHITE : LEAF;
  return c;
}

// scale < 1 shrinks the artwork toward the centre (maskable icons need a safe zone).
function render(size, { fullBleed = false, scale = 1 } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const X = ((i + (sx + 0.5) / S) / size) * 64;
          const Y = ((j + (sy + 0.5) / S) / size) * 64;
          const c = sample(X, Y, fullBleed, scale);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = S * S, o = (j * size + i) * 4;
      if (a) { px[o] = r / (a / 255); px[o + 1] = g / (a / 255); px[o + 2] = b / (a / 255); }
      px[o + 3] = a / n;
    }
  }
  return png(size, px);
}

// ---- minimal PNG encoder ----
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
const files = {
  'icon-192.png': render(192),
  'icon-512.png': render(512),
  'maskable-512.png': render(512, { fullBleed: true, scale: 0.78 }),
  'apple-touch-icon.png': render(180, { fullBleed: true, scale: 0.86 }),
  'favicon-32.png': render(32),
};
for (const [name, buf] of Object.entries(files)) {
  writeFileSync(join(OUT, name), buf);
  console.log(`${name}  ${buf.length} bytes`);
}
