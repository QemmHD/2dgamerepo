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

// ── Pixel hero (Pyra & the recolored cast) ──────────────────────────────
// A chunky pixel-art wick-keeper monkey drawn at fixed head-up / body-down
// proportions (so hats sit on the head and cloaks drape behind in every pose).
// Now DIRECTIONAL + POSED:
//   dir  ∈ {down, up, side}   (left = caller flips `side`; right = `side`)
//   pose ∈ {idle, walk, cast, hurt}   (walk has 3 frames; others 1)
// `opts.palette` (fur/furDark/furLight/face), `opts.accent`, `opts.feature`
// recolor it so every hero stays distinct (elf ears / orc tusks / wizard hat…).
const MONKEY_L = 48;
const HEAD_Y = 16, BODY_Y = 30, CX = 24;

// Two small dark eyes facing the camera (down) with a white glint; `wince`
// turns them into squinting slashes for the hurt pose.
function heroEyes(p, ex, ey, wince) {
    if (wince) {
        p.rect(ex - 6, ey, 3, 1, '#1b1b1b'); p.rect(ex - 5, ey - 1, 1, 1, '#1b1b1b'); p.rect(ex - 3, ey - 1, 1, 1, '#1b1b1b');
        p.rect(ex + 3, ey, 3, 1, '#1b1b1b'); p.rect(ex + 3, ey - 1, 1, 1, '#1b1b1b'); p.rect(ex + 5, ey - 1, 1, 1, '#1b1b1b');
        return;
    }
    p.rect(ex - 5, ey, 3, 3, '#1b1b1b');
    p.rect(ex + 2, ey, 3, 3, '#1b1b1b');
    p.dot(ex - 4, ey, '#ffffff');
    p.dot(ex + 3, ey, '#ffffff');
}

export function drawPixelHero(opts = {}, dir = 'down', pose = 'idle', frame = 0) {
    const pal = opts.palette || {};
    const fur = pal.fur || '#8b5a2b';
    const furD = pal.furDark || shade(fur, 0.4, 'dark');
    const furL = pal.furLight || shade(fur, 0.35, 'light');
    const face = pal.face || '#f0d2a5';
    const faceD = shade(face, 0.25, 'dark');
    const accent = opts.accent || '#ffb24a';
    const feature = opts.feature || null;
    const backFur = shade(fur, 0.18, 'dark');   // up/back view reads shaded

    const p = pixelCanvas(MONKEY_L);
    const cx = CX;
    const walk = pose === 'walk';
    const swing = walk ? [-2, 0, 2][frame % 3] : 0;   // arm swing
    const bob = walk ? [0, -1, 0][frame % 3] : 0;
    const headY = HEAD_Y + bob;
    const bodyY = BODY_Y + bob;
    const facing = dir === 'side';                     // side faces +x (right)

    // Arm helper: a fur stub; `up`>0 raises it (cast), `dy` swings it (walk).
    const arm = (ax, dy, raise, col) => {
        if (raise) p.rect(ax, bodyY - 4 - raise, 4, 8, col);
        else p.rect(ax, bodyY + 1 + dy, 4, 9, col);
    };

    // ── TAIL (behind the body) ──
    if (dir === 'down') {
        p.line(31, bodyY + 8, 39, bodyY + 6, furD, 3); p.line(39, bodyY + 6, 40, bodyY - 1, furD, 3);
    } else if (dir === 'up') {
        p.line(cx, bodyY + 9, cx + 7, bodyY + 11, backFur, 3); p.line(cx + 7, bodyY + 11, cx + 9, bodyY + 4, backFur, 3);
    } else { // side: tail trails behind (left)
        p.line(16, bodyY + 7, 8, bodyY + 5, furD, 3); p.line(8, bodyY + 5, 7, bodyY - 2, furD, 3);
    }

    // ── BODY ──
    const bodyCol = dir === 'up' ? backFur : fur;
    p.ell(cx, bodyY + 4, 9, 9, bodyCol);
    p.rect(cx - 8, bodyY - 2, 16, 8, bodyCol);
    if (dir === 'down') { p.ell(cx, bodyY + 3, 5, 6, face); p.ell(cx + 4, bodyY + 6, 4, 5, furD); }
    else if (dir === 'side') { p.ell(cx + 2, bodyY + 4, 5, 7, face); p.ell(cx - 5, bodyY + 5, 4, 6, furD); }
    else { p.ell(cx, bodyY + 4, 7, 7, backFur); p.ell(cx - 4, bodyY + 2, 4, 4, shade(fur, 0.32, 'dark')); }

    // ── ARMS (back arm first so it sits behind body on the side view) ──
    const raise = pose === 'cast' ? 6 : 0;
    if (dir === 'side') {
        // far arm (behind), near arm (front, toward facing on cast)
        arm(cx - 9, -swing, pose === 'cast' ? 4 : 0, furD);
        if (pose === 'cast') p.rect(cx + 7, bodyY - 6, 5, 5, fur); // near arm thrust up-forward
        else arm(cx + 6, swing, 0, fur);
    } else {
        arm(cx - 11, swing, raise, dir === 'up' ? backFur : fur);
        arm(cx + 7, -swing, raise, dir === 'up' ? backFur : fur);
    }

    // ── EARS ──
    if (feature === 'ears') { // elf — tall pointed ears
        if (dir === 'side') { p.rect(cx - 9, headY - 9, 3, 10, fur); p.rect(cx - 8, headY - 7, 1, 6, face); }
        else { p.sym(7, headY - 8, 3, 10, fur); if (dir === 'down') p.sym(8, headY - 6, 1, 6, face); }
    } else if (dir === 'side') {
        p.disc(cx - 7, headY - 1, 4, fur); p.disc(cx - 7, headY - 1, 2, dir === 'up' ? backFur : face);
    } else {
        p.disc(cx - 11, headY - 1, 4, fur); p.disc(cx + 11, headY - 1, 4, fur);
        const inner = dir === 'up' ? backFur : face;
        p.disc(cx - 11, headY - 1, 2, inner); p.disc(cx + 11, headY - 1, 2, inner);
    }

    // ── HEAD ──
    p.disc(cx, headY, 10, dir === 'up' ? backFur : fur);
    p.ell(cx - 4, headY - 4, 5, 4, dir === 'up' ? shade(fur, 0.05, 'light') : furL);
    p.ell(cx + 5, headY + 3, 4, 4, furD);

    if (dir === 'up') {
        // back of head — no face; a small fur crown swirl only.
        p.ell(cx, headY - 1, 6, 5, shade(fur, 0.1, 'dark'));
    } else {
        const fx = dir === 'side' ? cx + 2 : cx;   // muzzle shifts toward facing
        p.ell(fx, headY + 2, dir === 'side' ? 6 : 7, 6, face);
        p.ell(fx, headY + 5, 4, 3, faceD);
        p.rect(cx - 7, headY - 3, 14, 2, furD);    // brow ridge
        const ex = dir === 'side' ? cx + 1 : cx;
        heroEyes(p, ex, headY - 1, pose === 'hurt');
        p.dot(fx - 1, headY + 4, faceD); p.dot(fx + 1, headY + 4, faceD);
        // open "shout" mouth on cast/hurt
        if (pose === 'cast' || pose === 'hurt') p.rect(fx - 1, headY + 6, 3, 2, '#3a1410');
    }

    // ── FEATURE ACCENTS ──
    if (feature === 'tusks' && dir !== 'up') { p.rect(cx - 6, headY + 6, 2, 3, '#f3ead2'); p.rect(cx + 4, headY + 6, 2, 3, '#f3ead2'); }
    if (feature === 'horns') { p.line(cx - 7, headY - 8, cx - 10, headY - 12, accent, 2); p.line(cx + 7, headY - 8, cx + 10, headY - 12, accent, 2); }
    if (feature === 'hood') { p.rect(cx - 11, headY - 9, 22, 6, furD); p.ell(cx, headY - 6, 11, 5, furD); }
    if (feature === 'hat') { p.rect(cx - 9, headY - 10, 18, 3, accent); p.ell(cx, headY - 12, 7, 4, accent); }

    // Ember mark (Pyra's spark) — brow when facing the camera, crown when away.
    if (feature !== 'hat' && feature !== 'hood') {
        const my = dir === 'up' ? headY - 2 : headY - 6;
        p.rect(cx - 1, my, 2, 2, accent);
        p.dot(cx, my - 1, shade(accent, 0.4, 'light'));
    }

    outline(p, shade(fur, 0.62, 'dark'));
    return p.finish();
}

// Back-compat: the original 4-frame monkey (frame 0 = idle, 1..3 = walk),
// front-facing. Consumers that still want a flat array use getCharacterFrames.
export function drawPixelMonkey(frame = 0, opts = {}) {
    return frame === 0
        ? drawPixelHero(opts, 'down', 'idle', 0)
        : drawPixelHero(opts, 'down', 'walk', (frame - 1) % 3);
}
