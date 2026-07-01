#!/usr/bin/env node
// hero-pack — assemble the hero body's 7-frame direction sheet from the two
// sliced 2×2 grids (A = poses, B = walk/blink):
//   frames: [idle0=A0, idle1=B0, walk0=B1, walk1=A1, walk2=B2, cast=A2, hurt=A3]
// Grid B is scale-NORMALIZED to grid A using the calibration pair (A panel 0 and
// B panel 3 are both "standing idle open"), so the hero doesn't pulse in size
// between poses that came from different generations. Pure Node (zlib only).
//
// Usage: node tools/artshot/hero-pack.mjs <A_sheet.png> <B_sheet.png> <out.png> [--size=256]

import fs from 'node:fs';
import zlib from 'node:zlib';

const [,, aPath, bPath, outPath, ...rest] = process.argv;
if (!aPath || !bPath || !outPath) {
    console.error('usage: hero-pack.mjs <A_sheet.png> <B_sheet.png> <out.png> [--size=256]');
    process.exit(2);
}
const opt = Object.fromEntries(rest.map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), '1']; }));
const SIZE = parseInt(opt.size ?? '256', 10);

function decodePng(buf) {
    let p = 8, ihdr = null; const idat = [];
    while (p < buf.length) {
        const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
        const data = buf.subarray(p + 8, p + 8 + len);
        if (type === 'IHDR') ihdr = data; else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
        p += 12 + len;
    }
    const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4);
    const ch = ihdr[9] === 6 ? 4 : 3;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = w * ch, out = new Uint8ClampedArray(w * h * 4);
    const prev = new Uint8Array(stride), cur = new Uint8Array(stride);
    const paeth = (a, b, c) => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
    let rp = 0;
    for (let y = 0; y < h; y++) {
        const f = raw[rp++];
        for (let x = 0; x < stride; x++) {
            const rv = raw[rp++], a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
            let v;
            switch (f) { case 0: v = rv; break; case 1: v = rv + a; break; case 2: v = rv + b; break; case 3: v = rv + ((a + b) >> 1); break; case 4: v = rv + paeth(a, b, c); break; default: throw new Error('bad filter'); }
            cur[x] = v & 0xff;
        }
        for (let x = 0; x < w; x++) {
            const s = x * ch, d = (y * w + x) * 4;
            out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = ch === 4 ? cur[s + 3] : 255;
        }
        prev.set(cur);
    }
    return { w, h, data: out };
}
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(ty, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const tb = Buffer.from(ty); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(Buffer.concat([tb, d])), 0); return Buffer.concat([l, tb, d, cr]); }
function encodePng(w, h, data) {
    const st = w * 4, raw = Buffer.alloc((st + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (st + 1)] = 0; for (let x = 0; x < st; x++) raw[y * (st + 1) + 1 + x] = data[y * st + x]; }
    const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Content height of a SIZE×SIZE cell (alpha>8 rows).
function cellBounds(img, cellX) {
    let minY = SIZE, maxY = -1, minX = SIZE, maxX = -1;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        if (img.data[((y) * img.w + cellX + x) * 4 + 3] > 8) {
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
        }
    }
    return { minY, maxY, minX, maxX, h: maxY - minY + 1, w: maxX - minX + 1 };
}

// Copy a cell into the output, scaled about the bottom-center anchor.
function blitCell(src, cellX, out, outCellX, scale) {
    for (let ty = 0; ty < SIZE; ty++) for (let tx = 0; tx < SIZE; tx++) {
        // inverse-map through bottom-center scaling
        const sx = (tx - SIZE / 2) / scale + SIZE / 2;
        const sy = (ty - SIZE) / scale + SIZE;
        const ix = Math.round(sx), iy = Math.round(sy);
        if (ix < 0 || iy < 0 || ix >= SIZE || iy >= SIZE) continue;
        const s = (iy * src.w + cellX + ix) * 4;
        const d = (ty * (SIZE * 7) + outCellX + tx) * 4;
        out[d] = src.data[s]; out[d + 1] = src.data[s + 1]; out[d + 2] = src.data[s + 2]; out[d + 3] = src.data[s + 3];
    }
}

const A = decodePng(fs.readFileSync(aPath));
const B = decodePng(fs.readFileSync(bPath));
if (A.w !== SIZE * 4 || B.w !== SIZE * 4) throw new Error(`expected ${SIZE * 4}-wide 4-frame sheets`);

// Calibrate: A panel0 (idle) vs B panel3 (idle calibration copy).
const ca = cellBounds(A, 0);
const cb = cellBounds(B, SIZE * 3);
const scaleB = ca.h / cb.h;

const OUT_W = SIZE * 7;
const out = new Uint8ClampedArray(OUT_W * SIZE * 4);
// order: idle0=A0, idle1=B0, walk0=B1, walk1=A1, walk2=B2, cast=A2, hurt=A3
blitCell(A, 0,        out, 0,        1);
blitCell(B, 0,        out, SIZE,     scaleB);
blitCell(B, SIZE,     out, SIZE * 2, scaleB);
blitCell(A, SIZE,     out, SIZE * 3, 1);
blitCell(B, SIZE * 2, out, SIZE * 4, scaleB);
blitCell(A, SIZE * 2, out, SIZE * 5, 1);
blitCell(A, SIZE * 3, out, SIZE * 6, 1);
fs.writeFileSync(outPath, encodePng(OUT_W, SIZE, out));
const kb = (fs.statSync(outPath).size / 1024) | 0;
console.log(JSON.stringify({ out: outPath, scaleB: +scaleB.toFixed(3), kb }));
