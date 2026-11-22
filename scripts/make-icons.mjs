// Draws the HopOn logo (gold tile, two red chevrons) as PNG app icons with no image libraries.
// Run: node scripts/make-icons.mjs  → web/public/icons/*.png
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public', 'icons');
mkdirSync(out, { recursive: true });

const GOLD = [0xF2, 0xB2, 0x27], RED = [0xB3, 0x12, 0x2E], INK = [0x1F, 0x14, 0x16];

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); };

/** Logo in a 32-unit box: chevrons at (8.5,9.5)->(15,16)->(8.5,22.5) and +8.5 x, stroke 3.4. */
function draw(size, { full = false, scale = 1, badge = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const S = 4; // supersampling
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = ((x + (sx + .5) / S) / size) * 32, v = ((y + (sy + .5) / S) / size) * 32;
      // tile: rounded square (radius 9) unless full-bleed (maskable)
      let inTile = true;
      if (!full) { const k = 9, cx = Math.min(Math.max(u, k), 32 - k), cy = Math.min(Math.max(v, k), 32 - k); inTile = Math.hypot(u - cx, v - cy) <= k; }
      if (!inTile) continue;
      // logo coords scaled about centre (maskable keeps the art in the safe zone)
      const lu = 16 + (u - 16) / scale, lv = 16 + (v - 16) / scale;
      const d1 = Math.min(segDist(lu, lv, 8.5, 9.5, 15, 16), segDist(lu, lv, 15, 16, 8.5, 22.5));
      const d2 = Math.min(segDist(lu, lv, 17, 9.5, 23.5, 16), segDist(lu, lv, 23.5, 16, 17, 22.5));
      let col = GOLD, alpha = 1;
      if (d1 <= 1.7) col = RED;
      else if (d2 <= 1.7) col = [Math.round(RED[0] * .55 + GOLD[0] * .45), Math.round(RED[1] * .55 + GOLD[1] * .45), Math.round(RED[2] * .55 + GOLD[2] * .45)];
      // crew badge: small dark dot bottom-right with gold ring
      if (badge) { const bd = Math.hypot(u - 25.5, v - 25.5); if (bd <= 5.2) col = bd <= 4 ? INK : GOLD; }
      r += col[0] * alpha; g += col[1] * alpha; b += col[2] * alpha; a += alpha;
    }
    const n = S * S, i = (y * size + x) * 4;
    if (a) { buf[i] = Math.round(r / a); buf[i + 1] = Math.round(g / a); buf[i + 2] = Math.round(b / a); }
    buf[i + 3] = Math.round((a / n) * 255);
  }
  return png(size, buf);
}

const jobs = [
  ['icon-192.png', 192, {}], ['icon-512.png', 512, {}], ['maskable-512.png', 512, { full: true, scale: .72 }],
  ['apple-touch-icon.png', 180, { full: true, scale: .8 }],
  ['crew-192.png', 192, { badge: true }], ['crew-512.png', 512, { badge: true }], ['crew-maskable-512.png', 512, { full: true, scale: .72, badge: true }],
];
for (const [name, size, opt] of jobs) { writeFileSync(join(out, name), draw(size, opt)); console.log('wrote', name); }
