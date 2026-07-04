#!/usr/bin/env node
// pixelate-sheet — deterministic pixel-art pass over an existing sprite/sheet
// PNG: box-downsample to a chunky logical grid, median-cut palette quantize,
// harden alpha, nearest-neighbour upscale back to the ORIGINAL dimensions (so
// game wiring / cell layouts stay untouched). Pure Node (zlib only).
//
// Turns painterly/3D-rendered sprites into the game's chunky pixel-art look
// while keeping the exact designs and animation frames — the deterministic
// counterpart to an AI pixel-art redraw (no drift, works on dense multi-cell
// sheets like the Warden's 4×8 grid).
//
// Usage:
//   node tools/artshot/pixelate-sheet.mjs <in.png> <out.png>
//        [--cell=256] [--logical=64] [--colors=16] [--alpha=96] [--outline=0]
//   --cell     the sheet's cell size (default 256; factor = cell/logical)
//   --logical  pixels of detail per cell (default 64 — matches the LPC scale)
//   --colors   palette size after median-cut quantization (default 16)
//   --alpha    hard alpha threshold 0-255 (default 96; pixel art has no fringe)
//   --outline  1 = stamp the canonical 1-logical-px dark contour (#0a0d14 at
//              0.85, matching SPRITE_FX.outline) around the silhouette at the
//              logical grid — for 3D renders, which arrive outline-less

import fs from 'node:fs';
import zlib from 'node:zlib';

const [,, inPath, outPath, ...rest] = process.argv;
if (!inPath || !outPath) {
    console.error('usage: pixelate-sheet.mjs <in.png> <out.png> [--cell=256] [--logical=64] [--colors=16] [--alpha=96]');
    process.exit(2);
}
const opt = Object.fromEntries(rest.map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), '1']; }));
const CELL = parseInt(opt.cell ?? '256', 10);
const LOGICAL = parseInt(opt.logical ?? '64', 10);
const COLORS = parseInt(opt.colors ?? '16', 10);
const ALPHA = parseInt(opt.alpha ?? '96', 10);
const OUTLINE = opt.outline === '1';

// ---------- PNG codec (8-bit RGB/RGBA, non-interlaced) ----------
function decodePng(buf) {
    let p = 8, ihdr = null; const idat = [];
    while (p < buf.length) {
        const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
        const data = buf.subarray(p + 8, p + 8 + len);
        if (type === 'IHDR') ihdr = data; else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
        p += 12 + len;
    }
    const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4);
    if (ihdr[8] !== 8 || (ihdr[9] !== 6 && ihdr[9] !== 2) || ihdr[12] !== 0) throw new Error('only 8-bit RGB/RGBA non-interlaced');
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

// ---------- pixelate ----------
const img = decodePng(fs.readFileSync(inPath));
const factor = CELL / LOGICAL;
if (factor < 1) throw new Error('logical must be <= cell');
const lw = Math.round(img.w / factor), lh = Math.round(img.h / factor);

// 1) Box-downsample (premultiplied) to the logical grid, hard alpha.
const small = new Uint8ClampedArray(lw * lh * 4);
for (let ty = 0; ty < lh; ty++) for (let tx = 0; tx < lw; tx++) {
    const x0 = Math.floor(tx * factor), x1 = Math.min(img.w, Math.ceil((tx + 1) * factor));
    const y0 = Math.floor(ty * factor), y1 = Math.min(img.h, Math.ceil((ty + 1) * factor));
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const s = (y * img.w + x) * 4, al = img.data[s + 3] / 255;
        r += img.data[s] * al; g += img.data[s + 1] * al; b += img.data[s + 2] * al; a += img.data[s + 3]; n++;
    }
    const d = (ty * lw + tx) * 4;
    const aAvg = n ? a / n : 0;
    if (aAvg < ALPHA) { small[d + 3] = 0; continue; }
    const alSum = a / 255;
    small[d] = alSum > 0 ? r / alSum : 0;
    small[d + 1] = alSum > 0 ? g / alSum : 0;
    small[d + 2] = alSum > 0 ? b / alSum : 0;
    small[d + 3] = 255;                       // hard alpha — crisp pixel edges
}

// 2) Median-cut palette quantization over opaque pixels.
function medianCut(pixels, k) {
    let boxes = [pixels];
    while (boxes.length < k) {
        // split the box with the largest channel range
        let bi = -1, bc = -1, br = -1;
        boxes.forEach((box, i) => {
            if (box.length < 2) return;
            for (let c = 0; c < 3; c++) {
                let mn = 255, mx = 0;
                for (const p of box) { if (p[c] < mn) mn = p[c]; if (p[c] > mx) mx = p[c]; }
                if (mx - mn > br) { br = mx - mn; bi = i; bc = c; }
            }
        });
        if (bi < 0) break;
        const box = boxes[bi];
        box.sort((p, q) => p[bc] - q[bc]);
        const mid = box.length >> 1;
        boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
    }
    return boxes.filter((b) => b.length).map((box) => {
        let r = 0, g = 0, b2 = 0;
        for (const p of box) { r += p[0]; g += p[1]; b2 += p[2]; }
        return [Math.round(r / box.length), Math.round(g / box.length), Math.round(b2 / box.length)];
    });
}
const opaque = [];
for (let i = 0; i < lw * lh; i++) if (small[i * 4 + 3] === 255) opaque.push([small[i * 4], small[i * 4 + 1], small[i * 4 + 2]]);
const palette = medianCut(opaque, COLORS);
const nearest = (r, g, b) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < palette.length; i++) {
        const p = palette[i];
        const d = (r - p[0]) ** 2 + (g - p[1]) ** 2 * 1.2 + (b - p[2]) ** 2; // slight green weight
        if (d < bd) { bd = d; best = i; }
    }
    return palette[best];
};
for (let i = 0; i < lw * lh; i++) {
    if (small[i * 4 + 3] !== 255) continue;
    const [r, g, b] = nearest(small[i * 4], small[i * 4 + 1], small[i * 4 + 2]);
    small[i * 4] = r; small[i * 4 + 1] = g; small[i * 4 + 2] = b;
}

// 2b) Optional canonical dark contour: every transparent logical pixel
// 8-adjacent to an opaque one becomes the SPRITE_FX.outline colour (#0a0d14
// at 0.85), giving 3D renders the same baked outline the procedural/AI
// character art ships with. Done at the logical grid so the line is exactly
// one logical pixel wide.
if (OUTLINE) {
    const OC = [10, 13, 20, 217];       // #0a0d14, alpha 0.85*255
    const mark = [];
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
        const i = (y * lw + x) * 4;
        if (small[i + 3] !== 0) continue;               // only empty cells
        let touch = false;
        for (let dy = -1; dy <= 1 && !touch; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= lw || ny >= lh) continue;
            if (small[(ny * lw + nx) * 4 + 3] === 255) { touch = true; break; }
        }
        if (touch) mark.push(i);
    }
    for (const i of mark) { small[i] = OC[0]; small[i + 1] = OC[1]; small[i + 2] = OC[2]; small[i + 3] = OC[3]; }
}

// 3) Nearest-neighbour upscale back to the ORIGINAL dimensions.
const out = new Uint8ClampedArray(img.w * img.h * 4);
for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const sx = Math.min(lw - 1, Math.floor(x / factor)), sy = Math.min(lh - 1, Math.floor(y / factor));
    const s = (sy * lw + sx) * 4, d = (y * img.w + x) * 4;
    out[d] = small[s]; out[d + 1] = small[s + 1]; out[d + 2] = small[s + 2]; out[d + 3] = small[s + 3];
}
fs.writeFileSync(outPath, encodePng(img.w, img.h, out));
const kb = (fs.statSync(outPath).size / 1024) | 0;
console.log(JSON.stringify({ out: outPath, logicalGrid: `${lw}x${lh}`, palette: palette.length, kb }));
