// Hand-drawn pixel-art toolkit + sprites, in the chunky LPC palette style so
// the procedural cast (the monkey hero and the 12 bosses) matches the imported
// LPC sprites. Everything is drawn on a small LOGICAL grid (so the pixels are
// big and crisp) and then nearest-neighbour upscaled to the SPRITE_SIZE draw
// box — exactly how the imported 64px sheets read in-game.
//
// No external assets: these are authored in code. They're unique per subject
// (no enlarged-small reuse, no recolor-of-the-same-sprite), drawn at a
// resolution appropriate to their on-screen size.

import { SPRITE_SIZE } from '../config/GameConfig.js';
import { TWO_PI } from '../core/MathUtils.js';

// A logical pixel canvas with helpers. Call finish() to get the upscaled
// SPRITE_SIZE canvas. `sym` mirrors a draw across the vertical centre so
// creatures stay symmetric with half the code.
export function pixelCanvas(L) {
    const lc = document.createElement('canvas');
    lc.width = L; lc.height = L;
    const x = lc.getContext('2d');
    x.imageSmoothingEnabled = false;
    const api = {
        L, ctx: x,
        rect(px, py, w, h, col) { x.fillStyle = col; x.fillRect(px | 0, py | 0, w | 0, h | 0); },
        sym(px, py, w, h, col) { x.fillStyle = col; x.fillRect(px | 0, py | 0, w | 0, h | 0); x.fillRect((L - px - w) | 0, py | 0, w | 0, h | 0); },
        dot(px, py, col) { x.fillStyle = col; x.fillRect(px | 0, py | 0, 1, 1); },
        disc(cx, cy, r, col) {
            x.fillStyle = col;
            for (let yy = -r; yy <= r; yy++) {
                const w = Math.floor(Math.sqrt(r * r - yy * yy) + 0.5);
                if (w > 0 || yy === 0) x.fillRect((cx - w) | 0, (cy + yy) | 0, (w * 2 + 1) | 0, 1);
            }
        },
        // filled ellipse (pixel)
        ell(cx, cy, rx, ry, col) {
            x.fillStyle = col;
            for (let yy = -ry; yy <= ry; yy++) {
                const t = 1 - (yy * yy) / (ry * ry);
                if (t < 0) continue;
                const w = Math.floor(rx * Math.sqrt(t) + 0.5);
                x.fillRect((cx - w) | 0, (cy + yy) | 0, (w * 2 + 1) | 0, 1);
            }
        },
        // thick line in logical pixels (Bresenham-ish, square brush)
        line(x0, y0, x1, y1, col, t = 1) {
            x.fillStyle = col;
            const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
            const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
            let err = dx - dy, cx2 = x0, cy2 = y0;
            for (let i = 0; i < 400; i++) {
                x.fillRect((cx2 - (t >> 1)) | 0, (cy2 - (t >> 1)) | 0, t, t);
                if (cx2 === x1 && cy2 === y1) break;
                const e2 = 2 * err;
                if (e2 > -dy) { err -= dy; cx2 += sx; }
                if (e2 < dx) { err += dx; cy2 += sy; }
            }
        },
        finish() {
            const out = document.createElement('canvas');
            out.width = SPRITE_SIZE; out.height = SPRITE_SIZE;
            const o = out.getContext('2d');
            o.imageSmoothingEnabled = false;
            o.drawImage(lc, 0, 0, L, L, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
            return out;
        },
        raw: lc,
    };
    return api;
}

// Add a 1px (logical) outline around the opaque silhouette, in `col`. Reads the
// logical canvas's own pixels, so it traces whatever was drawn.
export function outline(api, col = '#14101c') {
    const x = api.ctx, L = api.L;
    const src = x.getImageData(0, 0, L, L);
    const a = src.data;
    const isOpaque = (px, py) => px >= 0 && py >= 0 && px < L && py < L && a[(py * L + px) * 4 + 3] > 40;
    const edges = [];
    for (let py = 0; py < L; py++) {
        for (let px = 0; px < L; px++) {
            if (a[(py * L + px) * 4 + 3] > 40) continue; // already opaque
            if (isOpaque(px - 1, py) || isOpaque(px + 1, py) || isOpaque(px, py - 1) || isOpaque(px, py + 1)) {
                edges.push(px, py);
            }
        }
    }
    x.fillStyle = col;
    for (let i = 0; i < edges.length; i += 2) x.fillRect(edges[i], edges[i + 1], 1, 1);
}

// Shade a colour toward dark/light by a 0..1 amount (cheap hex lerp).
function shade(hex, amt, toward) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const t = toward === 'light' ? 255 : 0;
    const m = (c) => Math.round(c + (t - c) * amt);
    return `rgb(${m(r)},${m(g)},${m(b)})`;
}

// ── Pixel monkey (Pyra) ─────────────────────────────────────────────────
// A chunky pixel-art take on the wick-keeper monkey, drawn at the same head-
// up / body-down proportions as the old chibi so the hat sits on the head and
// the cloak drapes behind — i.e. all cosmetics still line up. `opts.palette`
// (fur/furDark/furLight/face), `opts.accent`, and `opts.feature` recolor it so
// the other heroes stay distinct (elf/orc/wizard/… are this monkey recolored).
const MONKEY_L = 48;
export function drawPixelMonkey(frame = 0, opts = {}) {
    const pal = opts.palette || {};
    const fur = pal.fur || '#8b5a2b';
    const furD = pal.furDark || shade(fur, 0.4, 'dark');
    const furL = pal.furLight || shade(fur, 0.35, 'light');
    const face = pal.face || '#f0d2a5';
    const faceD = shade(face, 0.25, 'dark');
    const accent = opts.accent || '#ffb24a';
    const feature = opts.feature || null;

    const p = pixelCanvas(MONKEY_L);
    const cx = 24;
    // Idle bob: frames 0..3, gentle 1px vertical + tiny arm swing.
    const bob = [0, 1, 0, -1][frame % 4] || 0;
    const armSwing = [0, 1, 0, -1][frame % 4] || 0;
    const headY = 16 + bob;
    const bodyY = 30 + bob;

    // Tail (behind body, one side) — a curling fur strip.
    p.line(31, bodyY + 8, 39, bodyY + 6, furD, 3);
    p.line(39, bodyY + 6, 40, bodyY - 1, furD, 3);

    // Body / torso.
    p.ell(cx, bodyY + 4, 9, 9, fur);
    p.rect(cx - 8, bodyY - 2, 16, 8, fur);
    // belly highlight + lower shade
    p.ell(cx, bodyY + 3, 5, 6, face);          // light belly
    p.ell(cx + 4, bodyY + 6, 4, 5, furD);      // shade side

    // Arms (swing slightly per frame).
    p.rect(cx - 11, bodyY + 1 + armSwing, 4, 9, fur);
    p.rect(cx + 7, bodyY + 1 - armSwing, 4, 9, fur);

    // Ears.
    if (feature === 'ears') { // elf — tall pointed ears
        p.sym(7, headY - 8, 3, 10, fur);
        p.sym(8, headY - 6, 1, 6, face);
    } else {
        p.disc(cx - 11, headY - 1, 4, fur);
        p.disc(cx + 11, headY - 1, 4, fur);
        p.disc(cx - 11, headY - 1, 2, face);
        p.disc(cx + 11, headY - 1, 2, face);
    }

    // Head.
    p.disc(cx, headY, 10, fur);
    p.ell(cx - 4, headY - 4, 5, 4, furL);       // top-left highlight
    p.ell(cx + 5, headY + 3, 4, 4, furD);       // bottom-right shade
    // Face mask (muzzle).
    p.ell(cx, headY + 2, 7, 6, face);
    p.ell(cx, headY + 5, 4, 3, faceD);          // muzzle shade
    // Brow ridge.
    p.rect(cx - 7, headY - 3, 14, 2, furD);

    // Eyes + highlight.
    p.rect(cx - 5, headY - 1, 3, 3, '#1b1b1b');
    p.rect(cx + 2, headY - 1, 3, 3, '#1b1b1b');
    p.dot(cx - 4, headY - 1, '#ffffff');
    p.dot(cx + 3, headY - 1, '#ffffff');
    // Nose dots.
    p.dot(cx - 1, headY + 4, faceD);
    p.dot(cx + 1, headY + 4, faceD);

    // Feature accents.
    if (feature === 'tusks') { p.sym(cx - 6 + 12, headY + 6, 2, 3, '#f3ead2'); p.rect(cx - 6, headY + 6, 2, 3, '#f3ead2'); }
    if (feature === 'horns') { p.line(cx - 7, headY - 8, cx - 10, headY - 12, accent, 2); p.line(cx + 7, headY - 8, cx + 10, headY - 12, accent, 2); }
    if (feature === 'hood') { p.rect(cx - 11, headY - 9, 22, 6, furD); p.ell(cx, headY - 6, 11, 5, furD); }
    if (feature === 'hat') { p.rect(cx - 9, headY - 10, 18, 3, accent); p.ell(cx, headY - 12, 7, 4, accent); }

    // Ember mark on the brow (Pyra's spark) unless a hat/hood covers it.
    if (feature !== 'hat' && feature !== 'hood') {
        p.rect(cx - 1, headY - 6, 2, 2, accent);
        p.dot(cx, headY - 7, shade(accent, 0.4, 'light'));
    }

    outline(p, shade(fur, 0.62, 'dark'));
    return p.finish();
}
