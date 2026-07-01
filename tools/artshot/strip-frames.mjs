#!/usr/bin/env node
// strip-frames — slice an AI-generated 2×2 animation grid (one creature pose per
// panel, white background) into a game-ready HORIZONTAL 4-frame sprite sheet.
// Pure Node (zlib only), sibling of key-sprite.mjs. Part of the AI-art loop.
//
// Why a grid: all 4 poses come from ONE generation, so style/palette/scale stay
// consistent between animation frames (frame-by-frame img2img drifts).
//
// Pipeline per panel: flood-fill key near-white from the panel edges (+ desmoke
// for light desaturated haze), despeck small floating islands, find content
// bounds. Then ONE shared scale across all panels (largest content side fits the
// cell) so squash/stretch and size relationships between frames are preserved,
// anchored per creature: 'bottom' for grounded creatures (a squash stays on the
// floor), 'center' for flyers/floaters.
//
// Usage:
//   node tools/artshot/strip-frames.mjs <in_grid.png> <out_prefix>
//        [--size=256] [--margin=10] [--anchor=bottom|center]
//        [--white=215] [--despeck=0.03]
// Writes <out_prefix>_sheet.png (4*size × size) + <out_prefix>_qa.png and prints
// a JSON status line {frames, sheet, qa, warnings[]}.

import fs from 'node:fs';
import zlib from 'node:zlib';

const [,, inPath, outPrefix, ...rest] = process.argv;
if (!inPath || !outPrefix) {
    console.error('usage: strip-frames.mjs <in_grid.png> <out_prefix> [--size=256] [--anchor=bottom|center]');
    process.exit(2);
}
const opt = Object.fromEntries(rest.map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), '1']; }));
const SIZE = parseInt(opt.size ?? '256', 10);
const MARGIN = parseInt(opt.margin ?? '10', 10);
const ANCHOR = opt.anchor === 'center' ? 'center' : 'bottom';
const WHITE = parseInt(opt.white ?? '215', 10);
const DESPECK = parseFloat(opt.despeck ?? '0.03');
const SMOKE_LUM = WHITE - 55, SMOKE_SAT = 30;

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

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

// ---------- per-panel key + despeck + bounds ----------
// Panels are the 4 quadrants of the grid: TL, TR, BL, BR → frames 0..3.
function processPanel(img, px, py, pw, ph) {
    const { data, w } = img;
    const idx = (x, y) => ((py + y) * w + (px + x));
    const isBg = (x, y) => {
        const i = idx(x, y) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const l = lum(r, g, b);
        if (l >= WHITE) return true;
        if (l >= SMOKE_LUM && (Math.max(r, g, b) - Math.min(r, g, b)) <= SMOKE_SAT) return true;
        return false;
    };
    // Local alpha mask for this panel (starts from source alpha).
    const alpha = new Uint8ClampedArray(pw * ph);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) alpha[y * pw + x] = data[idx(x, y) * 4 + 3];
    // Flood-fill key from panel edges.
    const visited = new Uint8Array(pw * ph);
    const stack = new Int32Array(pw * ph); let sp = 0;
    const push = (x, y) => {
        if (x < 0 || y < 0 || x >= pw || y >= ph) return;
        const q = y * pw + x;
        if (visited[q] || alpha[q] === 0) return;
        if (!isBg(x, y)) return;
        visited[q] = 1; stack[sp++] = q;
    };
    for (let x = 0; x < pw; x++) { push(x, 0); push(x, ph - 1); }
    for (let y = 0; y < ph; y++) { push(0, y); push(pw - 1, y); }
    while (sp > 0) { const q = stack[--sp]; alpha[q] = 0; const x = q % pw, y = (q / pw) | 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
    // Defringe the antialiased white rim.
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
        const q = y * pw + x;
        if (alpha[q] === 0) continue;
        const nearCleared = (x > 0 && visited[q - 1]) || (x < pw - 1 && visited[q + 1]) || (y > 0 && visited[q - pw]) || (y < ph - 1 && visited[q + pw]);
        if (!nearCleared) continue;
        const i = idx(x, y) * 4;
        const l = lum(data[i], data[i + 1], data[i + 2]);
        const amt = l >= WHITE ? 1 : l <= WHITE - 60 ? 0 : (l - (WHITE - 60)) / 60;
        if (amt > 0) alpha[q] = Math.round(alpha[q] * (1 - amt));
    }
    // Despeck: components of kept pixels; keep >= DESPECK × largest.
    if (DESPECK > 0) {
        const label = new Int32Array(pw * ph).fill(-1); const areas = [];
        const q2 = new Int32Array(pw * ph);
        for (let s = 0; s < pw * ph; s++) {
            if (label[s] !== -1 || alpha[s] <= 8) continue;
            const id = areas.length; let area = 0, qh = 0, qt = 0;
            label[s] = id; q2[qt++] = s;
            while (qh < qt) {
                const q = q2[qh++]; area++;
                const x = q % pw, y = (q / pw) | 0;
                for (const n of [x > 0 ? q - 1 : -1, x < pw - 1 ? q + 1 : -1, y > 0 ? q - pw : -1, y < ph - 1 ? q + pw : -1]) {
                    if (n >= 0 && label[n] === -1 && alpha[n] > 8) { label[n] = id; q2[qt++] = n; }
                }
            }
            areas.push(area);
        }
        const maxA = areas.reduce((m, a) => Math.max(m, a), 0);
        for (let q = 0; q < pw * ph; q++) if (label[q] >= 0 && areas[label[q]] < maxA * DESPECK) alpha[q] = 0;
    }
    // Content bounds.
    let minX = pw, minY = ph, maxX = -1, maxY = -1;
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) if (alpha[y * pw + x] > 8) {
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (maxX < 0) throw new Error('empty panel');
    return { px, py, pw, ph, alpha, minX, minY, maxX, maxY, bw: maxX - minX + 1, bh: maxY - minY + 1 };
}

// Area-average resample of a panel's keyed content region into a target rect.
function blitScaled(img, panel, out, outW, dx, dy, dw, dh) {
    const { data, w } = img;
    const sx0 = panel.minX, sy0 = panel.minY, sw = panel.bw, sh = panel.bh;
    for (let ty = 0; ty < dh; ty++) for (let tx = 0; tx < dw; tx++) {
        const x0 = sx0 + (tx / dw) * sw, x1 = sx0 + ((tx + 1) / dw) * sw;
        const y0 = sy0 + (ty / dh) * sh, y1 = sy0 + ((ty + 1) / dh) * sh;
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
            if (x < sx0 || y < sy0 || x > panel.maxX || y > panel.maxY) continue;
            const al = panel.alpha[y * panel.pw + x] / 255;
            const s = ((panel.py + y) * w + (panel.px + x)) * 4;
            r += data[s] * al; g += data[s + 1] * al; b += data[s + 2] * al; a += al * 255; n++;
        }
        if (n === 0) continue;
        const d = ((dy + ty) * outW + (dx + tx)) * 4;
        const alSum = a / 255;
        out[d] = alSum > 0 ? r / alSum : 0;
        out[d + 1] = alSum > 0 ? g / alSum : 0;
        out[d + 2] = alSum > 0 ? b / alSum : 0;
        out[d + 3] = a / n;
    }
}

// ---------- main ----------
const img = decodePng(fs.readFileSync(inPath));
const halfW = img.w >> 1, halfH = img.h >> 1;
const panels = [
    processPanel(img, 0, 0, halfW, halfH),        // TL → frame 0
    processPanel(img, halfW, 0, img.w - halfW, halfH),   // TR → frame 1
    processPanel(img, 0, halfH, halfW, img.h - halfH),   // BL → frame 2
    processPanel(img, halfW, halfH, img.w - halfW, img.h - halfH), // BR → frame 3
];
const warnings = [];
panels.forEach((p, i) => {
    if (p.minX <= 1 || p.minY <= 1 || p.maxX >= p.pw - 2 || p.maxY >= p.ph - 2) {
        warnings.push(`frame ${i} content touches its grid cell boundary (poses may be merged/cropped)`);
    }
});

// Shared scale: the largest content side across frames fits the cell.
const maxSide = Math.max(...panels.map((p) => Math.max(p.bw, p.bh)));
const scale = (SIZE - 2 * MARGIN) / maxSide;

const sheetW = SIZE * 4, sheetH = SIZE;
const sheet = new Uint8ClampedArray(sheetW * sheetH * 4);
panels.forEach((p, i) => {
    const dw = Math.max(1, Math.round(p.bw * scale));
    const dh = Math.max(1, Math.round(p.bh * scale));
    const dx = i * SIZE + Math.round((SIZE - dw) / 2);
    const dy = ANCHOR === 'bottom' ? (SIZE - MARGIN - dh) : Math.round((SIZE - dh) / 2);
    blitScaled(img, p, sheet, sheetW, dx, Math.max(0, dy), dw, dh);
});
fs.writeFileSync(`${outPrefix}_sheet.png`, encodePng(sheetW, sheetH, sheet));

// QA: sheet over game-ground olive (top) and magenta halo-check (bottom).
const qaH = SIZE * 2, qa = new Uint8ClampedArray(sheetW * qaH * 4);
for (let y = 0; y < qaH; y++) for (let x = 0; x < sheetW; x++) {
    const d = (y * sheetW + x) * 4;
    if (y < SIZE) { qa[d] = 74; qa[d + 1] = 76; qa[d + 2] = 54; } else { qa[d] = 255; qa[d + 1] = 0; qa[d + 2] = 255; }
    qa[d + 3] = 255;
}
for (const row of [0, 1]) for (let y = 0; y < SIZE; y++) for (let x = 0; x < sheetW; x++) {
    const s = (y * sheetW + x) * 4, a = sheet[s + 3] / 255;
    if (a === 0) continue;
    const d = ((row * SIZE + y) * sheetW + x) * 4;
    qa[d] = sheet[s] * a + qa[d] * (1 - a);
    qa[d + 1] = sheet[s + 1] * a + qa[d + 1] * (1 - a);
    qa[d + 2] = sheet[s + 2] * a + qa[d + 2] * (1 - a);
}
fs.writeFileSync(`${outPrefix}_qa.png`, encodePng(sheetW, qaH, qa));

const kb = (fs.statSync(`${outPrefix}_sheet.png`).size / 1024) | 0;
if (kb > 512) warnings.push(`sheet is ${kb}KB (>512KB)`);
console.log(JSON.stringify({ frames: 4, sheet: `${outPrefix}_sheet.png`, qa: `${outPrefix}_qa.png`, kb, warnings }));
