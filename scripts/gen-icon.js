/* Generates mdview.ico (and a preview PNG) — no dependencies, pure Node. */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

/* ---- color sampling in 0..100 percent coordinates ---- */
function lerp(a, b, t) { return a + (b - a) * t; }

function sample(px, py) {
  // rounded square: margin 2, corner radius 22
  const m = 2, r = 22;
  const lo = m + r, hi = 100 - m - r;
  const cx = Math.min(Math.max(px, lo), hi);
  const cy = Math.min(Math.max(py, lo), hi);
  const d = Math.hypot(px - cx, py - cy);
  if (d > r) return [0, 0, 0, 0];

  // background: deep blue vertical gradient
  const t = py / 100;
  let R = Math.round(lerp(0x2b, 0x1c, t));
  let G = Math.round(lerp(0x55, 0x2f, t));
  let B = Math.round(lerp(0xc8, 0x82, t));

  // glyph "#": italic skew, yellow
  const xs = px + (py - 50) * 0.14;
  const vBar = (xs >= 34 && xs <= 45) || (xs >= 55 && xs <= 66);
  const hBar = (py >= 33 && py <= 44) || (py >= 56 && py <= 67);
  const inV = vBar && py >= 20 && py <= 80;
  const inH = hBar && xs >= 24 && xs <= 76;
  if (inV || inH) { R = 0xff; G = 0xd2; B = 0x4a; }
  return [R, G, B, 255];
}

/* ---- render with 4x supersampling ---- */
function renderRGBA(S) {
  const F = 4, N = S * F;
  const out = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < F; sy++) {
        for (let sx = 0; sx < F; sx++) {
          const px = ((x * F + sx + 0.5) / N) * 100;
          const py = ((y * F + sy + 0.5) / N) * 100;
          const c = sample(px, py);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const n = F * F;
      const o = (y * S + x) * 4;
      out[o + 3] = Math.round(a / n);
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
    }
  }
  return out;
}

/* ---- minimal PNG encoder ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(rgba, S) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(S * (S * 4 + 1));
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---- ICO: BMP entries for small sizes, PNG for 256 ---- */
function encodeBMPEntry(rgba, S) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(S, 4);
  header.writeInt32LE(S * 2, 8); // XOR + AND
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const xor = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const src = (y * S + x) * 4;
      const dst = ((S - 1 - y) * S + x) * 4; // bottom-up, BGRA
      xor[dst] = rgba[src + 2];
      xor[dst + 1] = rgba[src + 1];
      xor[dst + 2] = rgba[src];
      xor[dst + 3] = rgba[src + 3];
    }
  }
  const andMask = Buffer.alloc(S * Math.ceil(S / 32) * 4); // all opaque (alpha rules)
  return Buffer.concat([header, xor, andMask]);
}

const sizes = [16, 32, 48, 256];
const entries = sizes.map(S => {
  const rgba = renderRGBA(S);
  return { S, data: S === 256 ? encodePNG(rgba, S) : encodeBMPEntry(rgba, S) };
});

const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);            // type: icon
header.writeUInt16LE(entries.length, 4);
let offset = 6 + entries.length * 16;
const dir = entries.map(e => {
  const d = Buffer.alloc(16);
  d[0] = e.S === 256 ? 0 : e.S;
  d[1] = e.S === 256 ? 0 : e.S;
  d.writeUInt16LE(1, 4);               // planes
  d.writeUInt16LE(32, 6);              // bpp
  d.writeUInt32LE(e.data.length, 8);
  d.writeUInt32LE(offset, 12);
  offset += e.data.length;
  return d;
});

const root = path.join(__dirname, '..');
fs.writeFileSync(path.join(root, 'mdview.ico'),
  Buffer.concat([header, ...dir, ...entries.map(e => e.data)]));
fs.writeFileSync(path.join(root, 'mdview-icon.png'), encodePNG(renderRGBA(256), 256));
console.log('wrote mdview.ico + mdview-icon.png');
