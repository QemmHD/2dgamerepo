// Held weapon "props" — the small pixel wands / staves / glaives the hero
// actually carries in-hand (the signature weapon: the run's menu-chosen
// starter). Drawn in the same chunky pixel-art style as the heroes/bosses so
// the held gear matches the body.
//
// Each prop is authored on a small LOGICAL grid pointing along +x (to the
// RIGHT): the GRIP (where the hand holds) sits at the left end, the TIP (the
// muzzle / business end) at the right. The Player rotates the whole sprite to
// the aim angle and anchors the grip at the hand, so a wand always points at
// what it's shooting and its muzzle flash lands at the tip.
//
// Everything is cached per (prop + accent + glow) — never redrawn per frame.

import { shade } from './PixelArt.js';

// Logical grid + nearest-neighbour upscale (keeps the pixels crisp), matching
// the hero/boss pipeline. Props are smaller than a full SPRITE_SIZE sprite.
const LW = 28, LH = 16, SCALE = 3;

const cache = new Map(); // `${prop}:${accent}:${glow}` → descriptor

// Add a 1px dark contour around the opaque silhouette (same idea as
// PixelArt.outline, generalised to a non-square WxH canvas).
function outlineRect(ctx, w, h, col) {
    const src = ctx.getImageData(0, 0, w, h);
    const a = src.data;
    const op = (px, py) => px >= 0 && py >= 0 && px < w && py < h && a[(py * w + px) * 4 + 3] > 40;
    const edges = [];
    for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
            if (a[(py * w + px) * 4 + 3] > 40) continue;
            if (op(px - 1, py) || op(px + 1, py) || op(px, py - 1) || op(px, py + 1)) edges.push(px, py);
        }
    }
    ctx.fillStyle = col;
    for (let i = 0; i < edges.length; i += 2) ctx.fillRect(edges[i], edges[i + 1], 1, 1);
}

function makePropCanvas() {
    const lc = document.createElement('canvas');
    lc.width = LW; lc.height = LH;
    const x = lc.getContext('2d');
    x.imageSmoothingEnabled = false;
    return {
        ctx: x, raw: lc,
        rect(px, py, w, h, col) { x.fillStyle = col; x.fillRect(px | 0, py | 0, w | 0, h | 0); },
        dot(px, py, col) { x.fillStyle = col; x.fillRect(px | 0, py | 0, 1, 1); },
        disc(cx, cy, r, col) {
            x.fillStyle = col;
            for (let yy = -r; yy <= r; yy++) {
                const ww = Math.floor(Math.sqrt(r * r - yy * yy) + 0.5);
                if (ww > 0 || yy === 0) x.fillRect((cx - ww) | 0, (cy + yy) | 0, (ww * 2 + 1) | 0, 1);
            }
        },
        line(x0, y0, x1, y1, col, t = 1) {
            x.fillStyle = col;
            const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
            const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
            let err = dx - dy, cx2 = x0, cy2 = y0;
            for (let i = 0; i < 200; i++) {
                x.fillRect((cx2 - (t >> 1)) | 0, (cy2 - (t >> 1)) | 0, t, t);
                if (cx2 === x1 && cy2 === y1) break;
                const e2 = 2 * err;
                if (e2 > -dy) { err -= dy; cx2 += sx; }
                if (e2 < dx) { err += dx; cy2 += sy; }
            }
        },
        finish() {
            const out = document.createElement('canvas');
            out.width = LW * SCALE; out.height = LH * SCALE;
            const o = out.getContext('2d');
            o.imageSmoothingEnabled = false;
            o.drawImage(lc, 0, 0, LW, LH, 0, 0, LW * SCALE, LH * SCALE);
            return out;
        },
    };
}

// Common grip (wrapped handle) at the left end. Returns nothing; the grip
// anchor is a fixed logical point shared by all props.
const GRIP_X = 4, GRIP_Y = 9;
function drawGrip(p, wood, woodD) {
    p.rect(2, GRIP_Y - 1, 4, 5, wood);
    p.rect(2, GRIP_Y - 1, 4, 1, woodD);
    p.rect(2, GRIP_Y + 2, 4, 1, woodD);
}

// Build one prop. Returns { canvas, w, h, gripX, gripY, tipX, tipY } in CANVAS
// (upscaled) pixels so the Player can anchor the grip + flash the tip directly.
function buildProp(prop, accent, glow) {
    const aD = shade(accent, 0.45, 'dark');
    const aL = shade(accent, 0.4, 'light');
    const gL = shade(glow, 0.4, 'light');
    const wood = '#6b4a2a', woodD = '#3a2614';
    const p = makePropCanvas();
    let tipX = 24, tipY = 6;

    switch (prop) {
        case 'staff': {
            // Long shaft + a glowing orb crowned in a forked ferrule.
            p.line(GRIP_X, GRIP_Y, 22, 6, wood, 2);
            p.line(GRIP_X, GRIP_Y, 22, 6, woodD, 1);
            p.line(20, 8, 22, 4, accent, 1); p.line(24, 8, 22, 4, accent, 1); // ferrule prongs
            p.disc(23, 5, 3, glow); p.disc(23, 5, 1, gL);
            drawGrip(p, wood, woodD);
            tipX = 23; tipY = 5; break;
        }
        case 'wand': {
            // Short rod with a curling flame tip.
            p.line(GRIP_X, GRIP_Y, 18, 7, wood, 2);
            p.rect(17, 6, 2, 3, aD);
            p.disc(21, 6, 3, accent); p.disc(22, 5, 2, glow); p.dot(23, 4, gL);
            p.dot(20, 3, accent); p.dot(24, 7, glow);
            drawGrip(p, wood, woodD);
            tipX = 22; tipY = 5; break;
        }
        case 'rod': {
            // Metal rod with a forked, sparking lightning tip.
            p.line(GRIP_X, GRIP_Y, 19, 7, aD, 2);
            p.line(GRIP_X + 1, GRIP_Y, 19, 7, accent, 1);
            p.line(19, 7, 25, 3, glow, 1); p.line(19, 7, 24, 10, glow, 1);
            p.dot(25, 3, gL); p.dot(24, 10, gL); p.dot(22, 6, gL);
            drawGrip(p, wood, woodD);
            tipX = 24, tipY = 6; break;
        }
        case 'glaive': {
            // Pole with a broad curved blade at the head. A dark spine gives the
            // pale-steel blade contrast against the dark world (else it blurs to
            // a white blob).
            const blD = shade(accent, 0.4, 'dark');
            p.line(GRIP_X, 11, 16, 8, wood, 2);
            p.line(GRIP_X, 11, 16, 8, woodD, 1);
            // blade: back spine (dark) → body (accent) → bright edge
            p.line(15, 10, 23, 1, blD, 2);
            p.line(16, 10, 26, 5, accent, 2);
            p.line(18, 9, 25, 5, accent, 1);
            p.line(20, 8, 26, 4, aL, 1);
            p.rect(15, 9, 3, 3, blD);          // socket where blade meets haft
            p.dot(26, 4, '#ffffff'); p.dot(23, 1, '#ffffff');
            drawGrip(p, wood, woodD);
            tipX = 25; tipY = 4; break;
        }
        case 'sigil': {
            // Short haft topped with a holy ring sigil + inner cross.
            p.line(GRIP_X, GRIP_Y, 13, 8, wood, 2);
            p.disc(18, 7, 4, accent); p.disc(18, 7, 2, aD);
            p.rect(17, 4, 2, 7, gL); p.rect(15, 6, 7, 2, gL); // cross
            p.dot(18, 7, '#ffffff');
            drawGrip(p, wood, woodD);
            tipX = 18, tipY = 7; break;
        }
        case 'shard': {
            // Short haft tipped with a faceted ice shard (diamond).
            p.line(GRIP_X, GRIP_Y, 14, 8, wood, 2);
            // diamond
            p.line(19, 2, 23, 7, accent, 1); p.line(23, 7, 19, 12, accent, 1);
            p.line(19, 2, 15, 7, accent, 1); p.line(15, 7, 19, 12, accent, 1);
            p.disc(19, 7, 2, glow); p.dot(19, 5, gL); p.dot(18, 7, '#ffffff');
            drawGrip(p, wood, woodD);
            tipX = 19, tipY = 7; break;
        }
        case 'totem': {
            // Short carved totem on a stick — a little blocky idol head.
            p.line(GRIP_X, GRIP_Y, 16, 8, wood, 2);
            p.rect(16, 4, 9, 9, accent);
            p.rect(16, 4, 9, 2, aL);            // light brow
            p.rect(16, 11, 9, 2, aD);           // shadow chin
            p.rect(18, 7, 2, 2, woodD); p.rect(22, 7, 2, 2, woodD); // eyes
            p.dot(20, 10, glow);                // glowing mouth ember
            drawGrip(p, wood, woodD);
            tipX = 21, tipY = 6; break;
        }
        default: {
            // Unknown prop → a plain stick (never null so callers stay simple).
            p.line(GRIP_X, GRIP_Y, 22, 6, wood, 2);
            drawGrip(p, wood, woodD);
            tipX = 22, tipY = 6; break;
        }
    }

    outlineRect(p.ctx, LW, LH, '#14101c');
    const canvas = p.finish();
    return {
        canvas, w: LW * SCALE, h: LH * SCALE,
        gripX: GRIP_X * SCALE, gripY: GRIP_Y * SCALE,
        tipX: tipX * SCALE, tipY: tipY * SCALE,
    };
}

// Cached held-weapon prop descriptor for (prop, accent, glow). Returns null
// when no prop key is given (the caller skips drawing a hand prop). On a
// headless/no-canvas environment any throw is swallowed → null.
export function getWeaponProp(prop, accent = '#cccccc', glow = '#ffffff') {
    if (!prop) return null;
    const key = `${prop}:${accent}:${glow}`;
    if (cache.has(key)) return cache.get(key);
    let desc = null;
    try { desc = buildProp(prop, accent, glow); } catch (e) { desc = null; }
    cache.set(key, desc);
    return desc;
}
