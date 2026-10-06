// Generates the PWA icons (PNG) procedurally: neon bricks, ball and paddle over a synthwave sun.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const sstep = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

function pixel(u, v, maskable) {
  // night sky over a neon grid, a row of glowing bricks, the ball and the paddle
  let c = mix([40, 10, 70], [10, 4, 22], sstep(0.1, 0.75, v));
  const hz = 0.66;
  // the sun with synthwave bands, low on the horizon
  const sd = Math.hypot(u - 0.5, v - 0.6);
  const band = v > 0.5 && Math.sin(v * 140) > 0.2 + (v - 0.5) * 6 ? 0 : 1;
  if (sd < 0.2 && v < hz) c = mix(c, mix([255, 220, 110], [255, 60, 150], sstep(0.42, 0.66, v)), sstep(0.2, 0.19, sd) * band);
  c = mix(c, [255, 80, 170], Math.exp(-sd * sd / 0.02) * 0.25);
  if (v > hz) {
    c = mix([30, 6, 50], [8, 2, 18], sstep(hz, 1, v));
    const z = 1 / (v - hz + 0.02);
    const gx = Math.abs(((u - 0.5) * z * 0.9 + 100) % 1 - 0.5);
    const gy = Math.abs((z * 0.35) % 1 - 0.5);
    const line = Math.max(sstep(0.06, 0.0, gx * (v - hz + 0.05) * 6), sstep(0.08, 0.0, gy) * sstep(hz, hz + 0.05, v));
    c = mix(c, [60, 230, 255], line * 0.85);
  }
  // bricks
  const cols = [[255, 80, 180], [176, 107, 255], [56, 230, 255]];
  for (let i = 0; i < 3; i++) {
    const bx = 0.2 + i * 0.3, by = 0.2;
    const qx = Math.max(Math.abs(u - bx) - 0.11, 0), qy = Math.max(Math.abs(v - by) - 0.045, 0);
    const d = Math.hypot(qx, qy) - 0.015;
    c = mix(c, cols[i], Math.exp(-Math.max(d, 0) * 40) * 0.45);
    c = mix(c, mix(cols[i], [255, 255, 255], 0.35), sstep(0.004, -0.004, d));
  }
  // ball and paddle
  const bd = Math.hypot(u - 0.56, v - 0.42);
  c = mix(c, [255, 200, 120], Math.exp(-bd * bd / 0.004) * 0.6);
  c = mix(c, [255, 250, 225], sstep(0.05, 0.044, bd));
  const px = Math.max(Math.abs(u - 0.5) - 0.17, 0), py = Math.max(Math.abs(v - 0.8) - 0.012, 0);
  const pd = Math.hypot(px, py) - 0.012;
  c = mix(c, [56, 230, 255], Math.exp(-Math.max(pd, 0) * 30) * 0.5);
  c = mix(c, [210, 250, 255], sstep(0.004, -0.004, pd));

  let a = 255;
  if (!maskable) {
    const Rr = 0.2, qx = Math.max(Math.abs(u - 0.5) - (0.5 - Rr), 0), qy = Math.max(Math.abs(v - 0.5) - (0.5 - Rr), 0);
    const dd = Math.hypot(qx, qy) - Rr;
    a = clamp(255 * Math.min(1, Math.max(0, -dd * 300)));
  }
  return [clamp(c[0]), clamp(c[1]), clamp(c[2]), a];
}

writeFileSync('public/icon-192.png', png(192, (u, v) => pixel(u, v, false)));
writeFileSync('public/icon-512.png', png(512, (u, v) => pixel(u, v, false)));
writeFileSync('public/icon-maskable-512.png', png(512, (u, v) => pixel(0.5 + (u - 0.5) * 1.25, 0.5 + (v - 0.5) * 1.25, true)));
writeFileSync('public/apple-touch-icon.png', png(180, (u, v) => pixel(u, v, true)));
console.log('icons written');
