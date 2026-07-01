#!/usr/bin/env node
// key-sprite — background-key an AI PNG to transparent, trim, square-pad, and
// downscale into a game-ready sprite. Pure Node (built-in zlib only; no deps),
// so it runs anywhere without an install. Part of the higgsfield AI-art loop.
//
// Recipe (matches the project's asset pipeline):
//   1. Sample a corner pixel's luminance; dark corner (<128) => key near-black,
//      else key near-white (auto; override with --near=black|white).
//   2. Flood-fill from all 4 edges, keying connected near-bg pixels to alpha 0
//      (interior same-tone pixels are preserved — only edge-connected bg goes).
//   3. Defringe: fade the semi-bg halo pixels left on the antialiased rim.
//   4. Trim to kept-pixel bounds + margin, pad to a square, area-average
//      downscale to the target size (premultiplied so no dark/white halo).
//
// Usage:
//   node tools/artshot/key-sprite.mjs <in.png> <out.png> [--size=256]
//        [--margin=8] [--near=auto|white|black] [--black=42] [--white=215]
//        [--defringe=1]
//
// Only 8-bit RGBA / RGB PNGs (color type 6 or 2), non-interlaced — which is what
// the higgsfield image models emit.

import fs from 'node:fs';
import zlib from 'node:zlib';

// ---------- args ----------
const [,, inPath, outPath, ...rest] = process.argv;
if (!inPath || !outPath) {
    console.error('usage: key-sprite.mjs <in.png> <out.png> [--size=256] [--margin=8] [--near=auto|white|black] [--defringe=1]');
    process.exit(2);
}
const opt = Object.fromEntries(rest.map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), '1'];
}));
const SIZE = parseInt(opt.size ?? '256', 10);
const MARGIN = parseInt(opt.margin ?? '8', 10);
const NEAR = opt.near ?? 'auto';
const BLACK = parseInt(opt.black ?? '42', 10);
const WHITE = parseInt(opt.white ?? '215', 10);
const DEFRINGE = opt.defringe !== '0';
// Desmoke (white-key only): also treat light *desaturated* pixels as background
// so smoke/haze wisps get consumed, while saturated glow (lava/embers) survives.
const DESMOKE = opt.desmoke === '1';
const SMOKE_LUM = parseInt(opt.smokeLum ?? String(WHITE - 55), 10);
const SMOKE_SAT = parseInt(opt.smokeSat ?? '30', 10);

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// ---------- PNG decode (8-bit, color type 2/6, no interlace) ----------
function decodePng(buf) {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('not a PNG');
    let p = 8, ihdr = null;
    const idat = [];
    while (p < buf.length) {
        const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8);
        const data = buf.subarray(p + 8, p + 8 + len);
        if (type === 'IHDR') ihdr = data;
        else if (type === 'IDAT') idat.push(data);
        else if (type === 'IEND') break;
        p += 12 + len;
    }
    if (!ihdr) throw new Error('no IHDR');
    const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4);
    const bitDepth = ihdr[8], colorType = ihdr[9], interlace = ihdr[12];
    if (bitDepth !== 8) throw new Error('only 8-bit supported');
    if (interlace !== 0) throw new Error('interlaced not supported');
    if (colorType !== 6 && colorType !== 2) throw new Error('only RGB/RGBA supported');
    const channels = colorType === 6 ? 4 : 3;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = w * channels;
    const out = new Uint8ClampedArray(w * h * 4);
    const prev = new Uint8Array(stride);
    const cur = new Uint8Array(stride);
    const paeth = (a, b, c) => {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    let rp = 0;
    for (let y = 0; y < h; y++) {
        const filter = raw[rp++];
        for (let x = 0; x < stride; x++) {
            const rawv = raw[rp++];
            const a = x >= channels ? cur[x - channels] : 0;
            const b = prev[x];
            const c = x >= channels ? prev[x - channels] : 0;
            let v;
            switch (filter) {
                case 0: v = rawv; break;
                case 1: v = rawv + a; break;
                case 2: v = rawv + b; break;
                case 3: v = rawv + ((a + b) >> 1); break;
                case 4: v = rawv + paeth(a, b, c); break;
                default: throw new Error('bad filter ' + filter);
            }
            cur[x] = v & 0xff;
        }
        for (let x = 0; x < w; x++) {
            const s = x * channels, d = (y * w + x) * 4;
            out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2];
            out[d + 3] = channels === 4 ? cur[s + 3] : 255;
        }
        prev.set(cur);
    }
    return { w, h, data: out };
}

// ---------- PNG encode (RGBA, filter 0) ----------
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const tb = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
    return Buffer.concat([len, tb, data, crc]);
}
function encodePng(w, h, data) {
    const stride = w * 4;
    const raw = Buffer.alloc((stride + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = data[y * stride + x]; }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const idat = zlib.deflateSync(raw, { level: 9 });
    return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- key + trim + pad + downscale ----------
const { w, h, data } = decodePng(fs.readFileSync(inPath));

// Decide which background tone to key (auto: sample the top-left corner).
let keyDark;
if (NEAR === 'black') keyDark = true;
else if (NEAR === 'white') keyDark = false;
else keyDark = lum(data[0], data[1], data[2]) < 128;
const isBg = (i) => {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const l = lum(r, g, b);
    if (keyDark) return l <= BLACK;
    if (l >= WHITE) return true;
    // Light + desaturated => haze/smoke; saturated glow (lava) is kept.
    if (DESMOKE && l >= SMOKE_LUM && (Math.max(r, g, b) - Math.min(r, g, b)) <= SMOKE_SAT) return true;
    return false;
};

// Flood-fill from every edge pixel that is background; only edge-connected bg
// is cleared, so interior same-tone pixels survive.
const visited = new Uint8Array(w * h);
const stack = new Int32Array(w * h);
let sp = 0;
const pushIf = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const px = y * w + x;
    if (visited[px]) return;
    if (!isBg(px * 4)) return;
    visited[px] = 1; stack[sp++] = px;
};
for (let x = 0; x < w; x++) { pushIf(x, 0); pushIf(x, h - 1); }
for (let y = 0; y < h; y++) { pushIf(0, y); pushIf(w - 1, y); }
while (sp > 0) {
    const px = stack[--sp];
    data[px * 4 + 3] = 0;              // clear alpha
    const x = px % w, y = (px / w) | 0;
    pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1);
}

// Defringe: a kept pixel touching a cleared pixel that is itself near-bg tone is
// the antialiased halo — fade its alpha toward 0 by how bg-toned it is.
if (DEFRINGE) {
    const nearBgAmt = (i) => {
        const l = lum(data[i], data[i + 1], data[i + 2]);
        if (keyDark) return l <= BLACK ? 1 : l >= BLACK + 60 ? 0 : 1 - (l - BLACK) / 60;
        return l >= WHITE ? 1 : l <= WHITE - 60 ? 0 : (l - (WHITE - 60)) / 60;
    };
    const orig = Uint8ClampedArray.from(data);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const px = y * w + x, i = px * 4;
        if (orig[i + 3] === 0) continue;
        let touchesCleared = false;
        if (x > 0 && visited[px - 1]) touchesCleared = true;
        else if (x < w - 1 && visited[px + 1]) touchesCleared = true;
        else if (y > 0 && visited[px - w]) touchesCleared = true;
        else if (y < h - 1 && visited[px + w]) touchesCleared = true;
        if (!touchesCleared) continue;
        const amt = nearBgAmt(i);
        if (amt > 0) data[i + 3] = Math.round(orig[i + 3] * (1 - amt));
    }
}

// Despeck: label connected components of kept pixels and clear any component
// smaller than <despeck> × the largest component's area — removes floating
// ember/haze islands the edge-flood couldn't reach, keeping body + attached bits.
const DESPECK = parseFloat(opt.despeck ?? '0');
if (DESPECK > 0) {
    const label = new Int32Array(w * h).fill(-1);
    const comps = [];               // area per label
    const q = new Int32Array(w * h);
    for (let start = 0; start < w * h; start++) {
        if (label[start] !== -1 || data[start * 4 + 3] <= 8) continue;
        const id = comps.length; let area = 0, qh = 0, qt = 0;
        label[start] = id; q[qt++] = start;
        while (qh < qt) {
            const px = q[qh++]; area++;
            const x = px % w, y = (px / w) | 0;
            const nb = [x > 0 ? px - 1 : -1, x < w - 1 ? px + 1 : -1, y > 0 ? px - w : -1, y < h - 1 ? px + w : -1];
            for (const n of nb) if (n >= 0 && label[n] === -1 && data[n * 4 + 3] > 8) { label[n] = id; q[qt++] = n; }
        }
        comps.push(area);
    }
    const maxA = comps.reduce((m, a) => Math.max(m, a), 0);
    const minKeep = maxA * DESPECK;
    let dropped = 0;
    for (let px = 0; px < w * h; px++) {
        const id = label[px];
        if (id >= 0 && comps[id] < minKeep) { data[px * 4 + 3] = 0; dropped++; }
    }
    console.log(`despeck: ${comps.length} components, kept >=${(minKeep | 0)}px, cleared ${dropped}px`);
}

// Content bounds over kept pixels.
let minX = w, minY = h, maxX = -1, maxY = -1;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
}
if (maxX < 0) throw new Error('nothing kept — check --near/thresholds');
minX = Math.max(0, minX - MARGIN); minY = Math.max(0, minY - MARGIN);
maxX = Math.min(w - 1, maxX + MARGIN); maxY = Math.min(h - 1, maxY + MARGIN);
const cw = maxX - minX + 1, ch = maxY - minY + 1;

// Square canvas (max side), content centered.
const side = Math.max(cw, ch);
const sq = new Uint8ClampedArray(side * side * 4);
const offX = ((side - cw) / 2) | 0, offY = ((side - ch) / 2) | 0;
for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const s = ((minY + y) * w + (minX + x)) * 4;
    const d = ((offY + y) * side + (offX + x)) * 4;
    sq[d] = data[s]; sq[d + 1] = data[s + 1]; sq[d + 2] = data[s + 2]; sq[d + 3] = data[s + 3];
}

// Area-average downscale (premultiplied → no halo).
const out = new Uint8ClampedArray(SIZE * SIZE * 4);
const scale = side / SIZE;
for (let ty = 0; ty < SIZE; ty++) for (let tx = 0; tx < SIZE; tx++) {
    const x0 = (tx * scale) | 0, x1 = Math.min(side, Math.ceil((tx + 1) * scale));
    const y0 = (ty * scale) | 0, y1 = Math.min(side, Math.ceil((ty + 1) * scale));
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const s = (y * side + x) * 4; const al = sq[s + 3] / 255;
        r += sq[s] * al; g += sq[s + 1] * al; b += sq[s + 2] * al; a += sq[s + 3]; n++;
    }
    const d = (ty * SIZE + tx) * 4;
    if (n === 0) { out[d] = out[d + 1] = out[d + 2] = out[d + 3] = 0; continue; }
    const aAvg = a / n; const alSum = a / 255;
    out[d] = alSum > 0 ? r / alSum : 0;
    out[d + 1] = alSum > 0 ? g / alSum : 0;
    out[d + 2] = alSum > 0 ? b / alSum : 0;
    out[d + 3] = aAvg;
}

fs.writeFileSync(outPath, encodePng(SIZE, SIZE, out));
const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
console.log(`keyed ${inPath} -> ${outPath}  ${SIZE}x${SIZE}  ${kb}KB  (content ${cw}x${ch}, keyDark=${keyDark})`);
if (kb > 512) console.warn('WARNING: file >512KB');
