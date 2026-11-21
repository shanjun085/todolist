// Generates the Tauri icon set (PNG sizes + multi-resolution ICO) with zero
// dependencies: raw RGBA pixels -> PNG (zlib) -> ICO container.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'tauri', 'src-tauri', 'icons');
fs.mkdirSync(OUT, { recursive: true });

// ---------- PNG ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- drawing ----------
const GREEN = [0x00, 0xff, 0x88];
const GRAY = [0x75, 0x75, 0x75];
const YELLOW = [0xff, 0xff, 0x00];
const DARK_A = [0x11, 0x1b, 0x15];
const DARK_B = [0x08, 0x13, 0x0d];
const CORE = [0x0c, 0x15, 0x10];

function roundRectDist(u, v, radius) {
  const qx = Math.abs(u - 0.5) - (0.5 - radius);
  const qy = Math.abs(v - 0.5) - (0.5 - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function sample(u, v) {
  if (roundRectDist(u, v, 0.2) > 0) return null;
  const du = u - 0.5, dv = v - 0.5;
  const dist = Math.hypot(du, dv);
  let col = [
    Math.round(DARK_A[0] + (DARK_B[0] - DARK_A[0]) * v),
    Math.round(DARK_A[1] + (DARK_B[1] - DARK_A[1]) * v),
    Math.round(DARK_A[2] + (DARK_B[2] - DARK_A[2]) * v),
  ];
  if (dist < 0.235) col = CORE;
  if (dist > 0.262 && dist < 0.318) {
    const ang = (Math.atan2(dv, du) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
    col = ang / (Math.PI * 2) <= 0.72 ? GREEN : YELLOW;
  }
  if (dist < 0.235) {
    const d1 = segDist(u, v, 0.405, 0.505, 0.475, 0.575);
    const d2 = segDist(u, v, 0.475, 0.575, 0.605, 0.435);
    if (d1 < 0.031 || d2 < 0.031) col = GREEN;
  }
  return col;
}
function render(size) {
  const SS = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, aSum = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const c = sample(u, v);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; aSum += 1;
        }
      }
      const i = (y * size + x) * 4;
      if (aSum === 0) continue;
      buf[i] = Math.round(r / aSum);
      buf[i + 1] = Math.round(g / aSum);
      buf[i + 2] = Math.round(b / aSum);
      buf[i + 3] = Math.round((aSum / (SS * SS)) * 255);
    }
  }
  return buf;
}

const sizes = [16, 32, 48, 64, 128, 256, 512];
const pngs = {};
for (const s of sizes) pngs[s] = encodePng(s, s, render(s));

const write = (name, buf) => {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, buf);
  console.log(name.padEnd(16), buf.length, 'bytes');
};
write('32x32.png', pngs[32]);
write('128x128.png', pngs[128]);
write('128x128@2x.png', pngs[256]);
write('icon.png', pngs[512]);

// ---------- ICO ----------
const icoSizes = [16, 32, 48, 64, 128, 256];
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
const entries = [];
let offset = 6 + 16 * icoSizes.length;
for (const s of icoSizes) {
  const png = pngs[s];
  const e = Buffer.alloc(16);
  e[0] = s >= 256 ? 0 : s;
  e[1] = s >= 256 ? 0 : s;
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += png.length;
  entries.push(e);
}
write('icon.ico', Buffer.concat([header, ...entries, ...icoSizes.map((s) => pngs[s])]));
