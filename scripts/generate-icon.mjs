/**
 * Generates build/icon.png (1024x1024) without external dependencies.
 * Usage: node scripts/generate-icon.mjs
 */
import { deflateSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const W = 1024;
const H = 1024;
const RADIUS = 224;

function roundedRectAlpha(x, y) {
  // inside rounded rectangle test with a soft edge
  const cx = Math.min(Math.max(x, RADIUS), W - RADIUS);
  const cy = Math.min(Math.max(y, RADIUS), H - RADIUS);
  const dist = Math.hypot(x - cx, y - cy);
  if (dist <= RADIUS - 2) return 255;
  if (dist > RADIUS + 2) return 0;
  const t = (RADIUS + 2 - dist) / 4;
  return Math.round(255 * t);
}

function shade(x, y) {
  // vertical gradient crimson → deep red
  const t = y / H;
  const r = Math.round(231 - 60 * t);
  const g = Math.round(66 - 40 * t);
  const b = Math.round(60 - 20 * t);
  return [r, g, b];
}

// letter "P" drawn as a blocky glyph (pixel-space rects), centered
function inGlyph(x, y) {
  const s = 3;
  const bx = 300;
  const by = 250;
  const bw = 90 * s;
  const bh = 90 * s;
  const holeW = 34 * s;
  const holeH = 30 * s;
  const stem = 34 * s;
  const legH = 90 * s;
  // stem
  if (x >= bx && x < bx + stem && y >= by && y < by + bh + legH) return true;
  // bowl
  if (x >= bx && x < bx + bw && y >= by && y < by + bh) {
    if (x >= bx + stem + 8 && x < bx + bw - 8 && y >= by + stem + 8 && y < by + bh - holeH - 8) return false;
    return true;
  }
  return false;
}

const raw = Buffer.alloc(H * (1 + W * 4));
let off = 0;
for (let y = 0; y < H; y++) {
  raw[off++] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    const a = roundedRectAlpha(x + 0.5, y + 0.5);
    if (a === 0) {
      raw[off++] = 0;
      raw[off++] = 0;
      raw[off++] = 0;
      raw[off++] = 0;
      continue;
    }
    let [r, g, b] = shade(x, y);
    if (inGlyph(x, y)) {
      r = 255;
      g = 255;
      b = 255;
    }
    raw[off++] = r;
    raw[off++] = g;
    raw[off++] = b;
    raw[off++] = a;
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc);
  return Buffer.concat([len, body, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0))
]);

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "icon.png");
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
