// One-off helper to generate solid-color placeholder PNG icons for the PWA manifest,
// since this test app has no real design assets. Run: node scripts/generate-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng(size, [r, g, b], glyphColor) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  const margin = Math.round(size * 0.22);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter byte
    for (let x = 0; x < size; x++) {
      const inGlyph = x > margin && x < size - margin && y > margin && y < size - margin;
      const off = y * (stride + 1) + 1 + x * 3;
      if (inGlyph && glyphColor) {
        raw[off] = glyphColor[0];
        raw[off + 1] = glyphColor[1];
        raw[off + 2] = glyphColor[2];
      } else {
        raw[off] = r;
        raw[off + 1] = g;
        raw[off + 2] = b;
      }
    }
  }

  const idat = zlib.deflateSync(raw);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const bg = [0x1f, 0x2a, 0x44]; // dark navy
const fg = [0xff, 0xcc, 0x00]; // yellow square (stand-in for a "push" glyph)

const targets = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['badge-96.png', 96],
];

for (const [name, size] of targets) {
  fs.writeFileSync(path.join(outDir, name), makePng(size, bg, fg));
  console.log('wrote', name, size);
}
