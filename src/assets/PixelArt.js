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
export function shade(hex, amt, toward) {
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

// Per-pose baked body bob (logical px, negative = up), indexed by frame. The
// player uses this to offset hats/cloaks so cosmetics RIDE the body instead of
// floating at the un-bobbed anchor (the old "hat sinks onto the brow every
// other step" bug). Kept in one exported table so art + consumers agree.
export const HERO_BOB = {
    idle: [0, 0],          // frame 1 = blink/tail-wag; no height change
    walk: [0, -2, 0],      // bouncier hop than the old [0,-1,0] — reads goofy
    cast: [0],
    hurt: [0],
};
export const HERO_GRID = MONKEY_L;   // logical grid size (for px scaling)

// Two small dark eyes facing the camera (down) with a white glint; `wince`
// turns them into squinting slashes for the hurt pose.
function heroEyes(p, ex, ey, wince, blink) {
    if (wince) {
        p.rect(ex - 6, ey, 3, 1, '#1b1b1b'); p.rect(ex - 5, ey - 1, 1, 1, '#1b1b1b'); p.rect(ex - 3, ey - 1, 1, 1, '#1b1b1b');
        p.rect(ex + 3, ey, 3, 1, '#1b1b1b'); p.rect(ex + 3, ey - 1, 1, 1, '#1b1b1b'); p.rect(ex + 5, ey - 1, 1, 1, '#1b1b1b');
        return;
    }
    if (blink) {
        // Happy closed-arc eyes (∪ ∪) for the idle blink — goofy, content.
        p.rect(ex - 5, ey + 1, 3, 1, '#1b1b1b'); p.dot(ex - 5, ey, '#1b1b1b'); p.dot(ex - 3, ey, '#1b1b1b');
        p.rect(ex + 2, ey + 1, 3, 1, '#1b1b1b'); p.dot(ex + 2, ey, '#1b1b1b'); p.dot(ex + 4, ey, '#1b1b1b');
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
    let face = pal.face || '#f0d2a5';
    // Contrast guard: light fur recolors (gilded/galaxy) wash out against the
    // default cream face — when the tones converge, pull the face darker so the
    // muzzle/eyes keep reading (the "gold monkey lost his face" bug).
    const lumOf = (h) => { const n = parseInt(h.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };
    try { if (Math.abs(lumOf(fur) - lumOf(face)) < 46) face = shade(face, 0.32, 'dark'); } catch (e) { /* keep default */ }
    const faceD = shade(face, 0.25, 'dark');
    const accent = opts.accent || '#ffb24a';
    const feature = opts.feature || null;
    const backFur = shade(fur, 0.18, 'dark');   // up/back view reads shaded

    const p = pixelCanvas(MONKEY_L);
    const cx = CX;
    const walk = pose === 'walk';
    const blink = pose === 'idle' && frame === 1;      // goofy idle: blink + wag
    const swing = walk ? [-3, 0, 3][frame % 3] : 0;    // bigger arm swing
    const bob = (HERO_BOB[pose] || [0])[frame % (HERO_BOB[pose] || [0]).length] || 0;
    const headY = HEAD_Y + bob;
    const bodyY = BODY_Y + bob;
    const facing = dir === 'side';                     // side faces +x (right)

    // Arm helper: a fur stub; `up`>0 raises it (cast), `dy` swings it (walk).
    const arm = (ax, dy, raise, col) => {
        if (raise) p.rect(ax, bodyY - 4 - raise, 4, 8, col);
        else p.rect(ax, bodyY + 1 + dy, 4, 9, col);
    };

    // ── TAIL (behind the body) ── On the idle blink frame the tail WAGS: the
    // tip curls higher and the tuft lifts — a happy little metronome that keeps
    // the hero alive while standing still.
    const wag = blink ? 3 : 0;
    if (dir === 'down') {
        p.line(31, bodyY + 8, 39, bodyY + 6 - (wag >> 1), furD, 3); p.line(39, bodyY + 6 - (wag >> 1), 40 + (blink ? 1 : 0), bodyY - 1 - wag, furD, 3);
        p.disc(40 + (blink ? 1 : 0), bodyY - 2 - wag, 2, furL);      // tuft
    } else if (dir === 'up') {
        p.line(cx, bodyY + 9, cx + 7, bodyY + 11, backFur, 3); p.line(cx + 7, bodyY + 11, cx + 9, bodyY + 4 - wag, backFur, 3);
        p.disc(cx + 9, bodyY + 3 - wag, 2, shade(fur, 0.05, 'light'));
    } else { // side: tail trails behind (left)
        p.line(16, bodyY + 7, 8, bodyY + 5, furD, 3); p.line(8, bodyY + 5, 7, bodyY - 2 - wag, furD, 3);
        p.disc(7, bodyY - 3 - wag, 2, furL);            // tuft
    }

    // ── BODY ──
    const bodyCol = dir === 'up' ? backFur : fur;
    p.ell(cx, bodyY + 4, 9, 9, bodyCol);
    p.rect(cx - 8, bodyY - 2, 16, 8, bodyCol);
    if (dir === 'down') { p.ell(cx, bodyY + 3, 5, 6, face); p.ell(cx + 4, bodyY + 6, 4, 5, furD); }
    else if (dir === 'side') { p.ell(cx + 2, bodyY + 4, 5, 7, face); p.ell(cx - 5, bodyY + 5, 4, 6, furD); }
    else { p.ell(cx, bodyY + 4, 7, 7, backFur); p.ell(cx - 4, bodyY + 2, 4, 4, shade(fur, 0.32, 'dark')); }

    // ── ARMS — resting stubs only. The WEAPON arm is drawn dynamically by the
    // Player (it reaches from the shoulder to the aimed hand and jabs forward on
    // attack), so the body never "throws its hands up": the cast read comes from
    // that thrust + the open mouth + a body recoil, not an arms-up pose.
    // On cast the OFF-hand flies up in a "ta-da" flourish (the weapon arm is
    // articulated by the Player, so the flourish sells the cast without it).
    const flourish = pose === 'cast' ? 6 : 0;
    if (dir === 'side') {
        arm(cx - 9, -swing, flourish, furD);
        arm(cx + 6, swing, 0, fur);
    } else {
        arm(cx - 11, swing, flourish, dir === 'up' ? backFur : fur);
        arm(cx + 7, -swing, 0, dir === 'up' ? backFur : fur);
    }

    // ── EARS ──
    if (feature === 'ears') { // elf — tall pointed ears
        if (dir === 'side') { p.rect(cx - 9, headY - 9, 3, 10, fur); p.rect(cx - 8, headY - 7, 1, 6, face); }
        else { p.sym(7, headY - 8, 3, 10, fur); if (dir === 'down') p.sym(8, headY - 6, 1, 6, face); }
    } else if (dir === 'side') {
        p.disc(cx - 7, headY - 1 - (blink ? 1 : 0), 4, fur); p.disc(cx - 7, headY - 1 - (blink ? 1 : 0), 2, dir === 'up' ? backFur : face);
    } else {
        // Big rounded wick-keeper ears (match the original) with inner-ear.
        // On the blink frame one ear perks up a pixel — a goofy little twitch.
        const twitch = blink ? 1 : 0;
        p.disc(cx - 11, headY - 1 - twitch, 5, fur); p.disc(cx + 11, headY - 1, 5, fur);
        const inner = dir === 'up' ? backFur : face;
        p.disc(cx - 11, headY - 1 - twitch, 3, inner); p.disc(cx + 11, headY - 1, 3, inner);
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
        heroEyes(p, ex, headY - 1, pose === 'hurt', blink);
        p.dot(fx - 1, headY + 4, faceD); p.dot(fx + 1, headY + 4, faceD);
        // open "shout" mouth on cast/hurt
        if (pose === 'cast' || pose === 'hurt') p.rect(fx - 1, headY + 6, 3, 2, '#3a1410');
    }

    // ── SCARF (the wick-keeper guild outfit — the original's signature red
    // neckwrap, constant across the chibi cast so they read as one order) ──
    {
        const SC = '#c93a3a', SCD = '#7a1d1d', SCL = '#e0584f';
        if (dir === 'up') {
            p.rect(cx - 7, headY + 9, 14, 3, SC);
            p.rect(cx - 7, headY + 11, 14, 1, SCD);
            p.rect(cx - 2, headY + 12, 4, 2, SCD);      // knot at the back
        } else {
            const sxx = dir === 'side' ? cx + 1 : cx;
            p.rect(sxx - 7, headY + 9, 14, 3, SC);       // neck band
            p.rect(sxx - 7, headY + 11, 14, 1, SCD);     // shadow
            p.rect(sxx - 6, headY + 9, 12, 1, SCL);      // highlight
            const tlx = dir === 'side' ? cx - 3 : cx + 4; // loose tail drifts back
            p.rect(tlx, headY + 12, 3, 5, SC);
            p.rect(tlx, headY + 16, 3, 1, SCD);
            p.dot(tlx + (dir === 'side' ? 0 : 2), headY + 12, SCL);
        }
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

// Feature-only overlay for the AI hero body: the per-hero identity accents
// (elf ears / tusks / horns / hood / hat) drawn standalone on the 48-grid at
// the shared head anchor, so HeroAiSprites can composite them over the shared
// HQ body. `bob` matches the frame's HERO_BOB entry so features ride the head.
// The ember brow mark is NOT drawn here — the AI base bakes it. Returns null
// for feature-less heroes (the plain monkey).
// Per-pose feature MOTION [sway, lift] in logical px, indexed by frame. Applied
// to the MOVING parts of each overlay (scaled per element: bases stay rooted to
// the head, tips travel the full amount) so ears/horns/hat/hood/tusks sway with
// the walk stride, perk into a cast, and recoil on hurt instead of riding rigid.
// Co-located with HERO_BOB so art + motion stay in one place.
export const FEATURE_MOTION = {
    idle: [[0, 0], [0.8, -0.6]],           // frame 1 = a tiny twitch on the blink
    walk: [[-2, 0.4], [0.4, -2], [2, 0.4]], // pendulum sway + hop across the stride
    cast: [[1.7, -2.4]],                   // features perk up + lean into the cast
    hurt: [[-2.6, 1.8]],                   // recoil back + drop
    death: [[-0.8, 1.4]],                  // settle with the collapsing head
    victory: [[0.8, -1.2]],                // lift with the celebration pose
};

export function drawHeroFeatureOverlay(opts = {}, dir = 'down', bob = 0, pose = 'idle', frameIdx = 0) {
    const feature = opts.feature || null;
    if (!feature) return null;
    if (feature === 'tusks' && dir === 'up') return null;   // invisible from behind
    const pal = opts.palette || {};
    const fur = pal.fur || '#8b5a2b';
    const furD = pal.furDark || shade(fur, 0.4, 'dark');
    const face = pal.face || '#f0d2a5';
    const accent = opts.accent || '#ffb24a';
    const p = pixelCanvas(MONKEY_L);
    const cx = CX;
    const headY = HEAD_Y + bob;
    // This frame's motion; k scales it per element (0 = rooted base, 1 = free tip).
    const mrow = FEATURE_MOTION[pose] || [[0, 0]];
    const [sway, lift] = mrow[frameIdx % mrow.length] || [0, 0];
    const R = (px, py, w, h, col, k = 1) =>
        p.rect(px + Math.round(sway * k), py + Math.round(lift * k), w, h, col);
    // Symmetric pair shifted by the SAME screen dx (both ears flop together in the
    // lead direction rather than splaying apart/together).
    const S = (px, py, w, h, col, k = 1) => {
        const dx = Math.round(sway * k), dy = Math.round(lift * k);
        p.rect(px + dx, py + dy, w, h, col);
        p.rect(MONKEY_L - px - w + dx, py + dy, w, h, col);
    };
    if (feature === 'ears') { // elf — tapered points rooted inside the new wide dome
        if (dir === 'side') {
            R(cx - 8, headY - 5, 3, 4, fur, 0.2);       // base, inside the dome edge
            R(cx - 9, headY - 8, 2, 3, fur, 0.6);       // mid taper
            R(cx - 10, headY - 11, 1, 3, fur, 1.0);     // point (travels most)
            R(cx - 7, headY - 4, 1, 3, face, 0.2);      // inner wedge
        } else {
            // Mirrored pair: base overlaps the dome edge, tapering up-outward to
            // 1px tips at headY-12; tips flop with the frame's sway/lift.
            S(8, headY - 6, 3, 4, fur, 0.2);            // base
            S(7, headY - 9, 2, 3, fur, 0.6);            // mid taper
            S(6, headY - 12, 1, 3, fur, 1.0);           // point
            if (dir === 'down') S(9, headY - 5, 1, 3, face, 0.2); // inner wedge
        }
    } else if (feature === 'tusks' && dir !== 'up') {
        // Low on the muzzle: a small counter-jiggle (k < 0) so they lag the head.
        if (dir === 'side') {
            R(cx + 5, headY + 6, 2, 3, '#f3ead2', -0.3);
        } else {
            R(cx - 6, headY + 6, 2, 3, '#f3ead2', -0.3); R(cx + 4, headY + 6, 2, 3, '#f3ead2', -0.3);
        }
    } else if (feature === 'horns') {
        // Bases rooted at the brow; tips sway/lift together.
        const hx = Math.round(sway), hy = Math.round(lift);
        p.line(cx - 7, headY - 8, cx - 10 + hx, headY - 12 + hy, accent, 2);
        p.line(cx + 7, headY - 8, cx + 10 + hx, headY - 12 + hy, accent, 2);
    } else if (feature === 'hood') {
        // Heavy cowl: only a light sway so it keeps framing the head.
        const dx = Math.round(sway * 0.4), dy = Math.round(lift * 0.4);
        p.rect(cx - 11 + dx, headY - 9 + dy, 22, 6, furD);
        p.ell(cx + dx, headY - 6 + dy, 11, 5, furD);
    } else if (feature === 'hat') {
        // Floppy wizard hat: brim rides the head, the cone tip swings the most.
        const bx = Math.round(sway * 0.6), by = Math.round(lift * 0.6);
        p.rect(cx - 9 + bx, headY - 10 + by, 18, 3, accent);
        p.ell(cx + Math.round(sway), headY - 12 + Math.round(lift), 7, 4, accent);
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

// ── Pixel cosmetics (cloak + hat), direction-aware ───────────────────────
// Authored on the SAME MONKEY_L grid + head/body anchors as drawPixelHero, so
// they line up with the pixel body in every direction, and finished to
// SPRITE_SIZE so the player/menu can drawImage them straight onto the body box.
// Cached per (variant, color); never redrawn per frame.

const cosmeticCache = new Map();

// A draped cape. dir 'down'/'side' draw BEHIND the body (caller draws it first
// → only the collar + hem wings peek out); 'up' draws a full back drape OVER
// the body. `side` trails to the left (caller flips for right/left facing).
function pixelCloak(dir, color) {
    const dark = shade(color, 0.34, 'dark');
    const light = shade(color, 0.26, 'light');
    const p = pixelCanvas(MONKEY_L);
    const cx = CX;
    if (dir === 'side') {
        // Cape sweeping back-and-down behind the shoulder.
        for (let y = 22; y <= 45; y++) {
            const t = (y - 22) / 23;
            const right = Math.round(cx + 1);
            const left = Math.round(cx - 2 - t * 17);
            if (right >= left) p.rect(left, y, right - left + 1, 1, color);
            p.rect(left, y, 2, 1, dark);            // trailing-edge shadow
        }
        p.rect(5, 43, 7, 3, dark);                  // weighted hem
        p.rect(cx - 1, 22, 2, 4, light);            // lit clasp seam
    } else if (dir === 'up') {
        // Back view: a FITTED drape hanging from the shoulders — narrower than
        // the body so ears/arms/head stay visible (the old full-width drape
        // turned the hero into a featureless wall), with a collar band, a
        // billow taper, fold shadows, and a wind-notched hem so it reads as
        // hanging cloth rather than a slab.
        // topY 19 puts the collar band at the base of the new (taller) Blender
        // head instead of mid-back; hemY 42 lets the feet peek below the hem.
        const topY = 19, hemY = 42;
        for (let y = topY; y <= hemY; y++) {
            const t = (y - topY) / (hemY - topY);
            // taper out to mid-billow then gently back in at the hem
            const half = Math.round(8 + Math.sin(t * Math.PI) * 4 + t * 1.5);
            p.rect(cx - half, y, half * 2 + 1, 1, color);
            p.rect(cx - half, y, 1, 1, light);      // lit outer edges
            p.rect(cx + half, y, 1, 1, light);
        }
        // collar band across the shoulders (sits under the scarf knot)
        p.rect(cx - 9, topY - 2, 19, 2, dark);
        p.rect(cx - 9, topY - 2, 19, 1, light);
        // fold shadows — three hanging creases
        for (let y = topY + 3; y <= hemY - 1; y++) {
            p.rect(cx - 4, y, 1, 1, dark);
            p.rect(cx + 4, y, 1, 1, dark);
            if (y > topY + 8) p.rect(cx, y, 1, 1, dark);
        }
        // wind-notched hem (zig-zag) + hem shadow
        p.rect(cx - 10, hemY, 21, 1, dark);
        p.rect(cx - 7, hemY + 1, 3, 1, color); p.rect(cx - 1, hemY + 1, 3, 1, color); p.rect(cx + 5, hemY + 1, 3, 1, color);
        p.rect(cx - 7, hemY + 2, 3, 1, dark); p.rect(cx - 1, hemY + 2, 3, 1, dark); p.rect(cx + 5, hemY + 2, 3, 1, dark);
    } else {
        // Front ('down'): drawn BEHIND the body — only the shoulder line + hem
        // wings peek out. Add clasp studs at the shoulders so it reads "worn".
        // topY 21 + topHalf 12: collar edge + clasps peek just outside the new
        // wider Blender torso at shoulder height (they were fully hidden).
        const topY = 21, hemY = 45, topHalf = 12, hemHalf = 17;
        for (let y = topY; y <= hemY; y++) {
            const t = (y - topY) / (hemY - topY);
            const half = Math.round(topHalf + t * (hemHalf - topHalf));
            p.rect(cx - half, y, half * 2 + 1, 1, color);
            p.rect(cx - half, y, 1, 1, light);
            p.rect(cx + half, y, 1, 1, light);
        }
        // Behind the body: shade the hem so the peeking wings read as cloth.
        p.rect(cx - hemHalf, hemY, hemHalf * 2 + 1, 1, dark);
        p.rect(cx - hemHalf, hemY - 1, 3, 1, dark);
        p.rect(cx + hemHalf - 2, hemY - 1, 3, 1, dark);
        // shoulder clasps (peek just outside the body silhouette)
        p.dot(cx - topHalf, topY, light); p.dot(cx + topHalf, topY, light);
    }
    outline(p, shade(color, 0.55, 'dark'));
    return p.finish();
}

// A head accessory sitting on the pixel head (centre cx, top ~y6). Shapes:
// cap / candle / horns / crown / hood / tophat / flower / antlers / halo.
// `dir` tweaks which face shows (no brim on the back view, etc.).
// Tall hats author pixels above y=0 (tophat rim, party pom, halo top, antler
// tips) which the 48-grid silently CLIPPED — they rendered flat-topped. All hat
// art now draws translated down by HAT_DROP inside the canvas, and drawPixelHat
// compensates by blitting that much higher, so the tops exist again while every
// on-head anchor stays identical.
const HAT_DROP = 5;

function pixelHat(dir, shape, color) {
    const col = color || '#ffd35a';
    const dark = shade(col, 0.4, 'dark');
    const light = shade(col, 0.35, 'light');
    const p = pixelCanvas(MONKEY_L);
    p.ctx.translate(0, HAT_DROP);
    const cx = CX;
    if (shape === 'cap') {
        // Seated 3px higher than the original art so the brim lands at the
        // hairline (like the tophat's y8 brim) instead of across the eyes of
        // the rounder Blender head. HAT_DROP headroom absorbs the lift.
        p.ell(cx, 8, 9, 7, col);                    // crown dome
        p.ell(cx - 3, 5, 4, 3, light);              // lit highlight
        if (dir === 'up') {
            p.rect(cx - 9, 9, 19, 1, dark);         // back seam, no front brim
        } else if (dir === 'side') {
            p.rect(cx - 5, 10, 15, 2, dark);        // brim toward facing (+x)
        } else {
            p.rect(cx - 10, 10, 21, 2, dark);       // full front brim
        }
        p.disc(cx, 0, 2, light);                    // pom-pom
    } else if (shape === 'candle') {
        p.rect(cx - 1, 2, 3, 8, '#ece4cf');         // wax stick
        p.rect(cx + 1, 3, 1, 6, '#c9bfa0');         // shaded side
        p.rect(cx - 1, 4, 1, 1, '#fff7e0');         // drip highlight
        p.ell(cx, 0, 2, 3, '#ffb24a');              // flame
        p.dot(cx, -1, '#fff1c0');
        p.disc(cx, 1, 1, col);                      // warm core (cosmetic colour)
    } else if (shape === 'horns') {
        // Two curved horns rising from the head sides.
        p.line(cx - 7, 9, cx - 9, 4, col, 2); p.line(cx - 9, 4, cx - 8, 0, col, 2);
        p.line(cx + 7, 9, cx + 9, 4, col, 2); p.line(cx + 9, 4, cx + 8, 0, col, 2);
        p.dot(cx - 8, 0, light); p.dot(cx + 8, 0, light);
        p.line(cx - 7, 9, cx - 8, 6, dark, 1); p.line(cx + 7, 9, cx + 8, 6, dark, 1);
    } else if (shape === 'crown') {
        p.rect(cx - 9, 9, 19, 3, col);              // band
        p.rect(cx - 9, 9, 19, 1, light);            // lit rim
        // three spikes
        p.line(cx - 7, 9, cx - 7, 4, col, 2); p.dot(cx - 7, 3, light);
        p.line(cx, 9, cx, 2, col, 2); p.dot(cx, 1, light);
        p.line(cx + 7, 9, cx + 7, 4, col, 2); p.dot(cx + 7, 3, light);
        if (dir !== 'up') {                          // gem faces forward only
            p.dot(cx, 10, '#fff');                   // centre gem
            p.dot(cx - 5, 10, dark); p.dot(cx + 5, 10, dark);
        } else {
            p.rect(cx - 6, 10, 13, 1, dark);         // plain back band seam
        }
    } else if (shape === 'hood') {
        // Cloth cowl: a drape over the crown + side panels framing the face
        // (the muzzle stays visible). Back view drapes full.
        if (dir === 'up') {
            p.ell(cx, 9, 12, 9, col);               // full back drape
            p.ell(cx, 6, 11, 5, light);             // lit crown
            p.rect(cx - 12, 13, 24, 1, dark);       // hem shadow
        } else {
            p.ell(cx, 6, 12, 6, col);               // crown drape
            p.ell(cx - 4, 4, 5, 3, light);          // lit highlight
            if (dir === 'side') {
                p.rect(cx - 12, 6, 4, 11, col);     // back panel (-x)
                p.rect(cx - 12, 6, 1, 11, dark);
                p.rect(cx + 5, 7, 3, 9, col);       // front cheek
            } else {
                p.rect(cx - 12, 6, 4, 11, col);     // left cheek panel
                p.rect(cx + 8, 6, 4, 11, col);      // right cheek panel
                p.rect(cx - 12, 6, 1, 11, dark); p.rect(cx + 11, 6, 1, 11, dark);
            }
            p.rect(cx - 9, 5, 18, 1, dark);         // inner brow rim
        }
    } else if (shape === 'tophat') {
        // Tall stovepipe: wide brim + cylinder crown + ribbon band.
        const brimW = dir === 'side' ? 17 : 22, bx = dir === 'side' ? cx - 9 : cx - 11;
        p.rect(bx, 8, brimW, 2, dark);              // brim
        p.rect(bx, 8, brimW, 1, light);             // lit brim edge
        p.rect(cx - 6, -2, 13, 11, col);            // crown cylinder
        p.rect(cx - 6, -2, 2, 11, light);           // lit left edge
        p.rect(cx + 4, -2, 2, 11, dark);            // shaded right edge
        p.rect(cx - 6, -2, 13, 1, light);           // lit top rim
        p.rect(cx - 6, 5, 13, 2, '#c93a3a');        // red ribbon band
        p.rect(cx - 6, 6, 13, 1, '#7a1d1d');
    } else if (shape === 'flower') {
        // Flower crown: a leafy band with blooms around the head.
        const band = '#5fa64a', bandD = '#3c7a32';
        p.rect(cx - 10, 8, 21, 2, band);
        p.rect(cx - 10, 10, 21, 1, bandD);
        const bloom = (bx) => { p.disc(bx, 6, 2, col); p.dot(bx, 6, light); };
        if (dir === 'side') { bloom(cx + 5); bloom(cx - 2); p.disc(cx - 9, 7, 1, col); }
        else { bloom(cx - 7); bloom(cx); bloom(cx + 7); }
        p.dot(cx - 11, 9, band); p.dot(cx + 11, 9, band);   // side leaves
    } else if (shape === 'antlers') {
        // Branching antlers rising from the head sides.
        p.line(cx - 6, 9, cx - 9, -2, col, 2); p.line(cx + 6, 9, cx + 9, -2, col, 2);
        p.line(cx - 8, 3, cx - 12, 2, col, 1); p.line(cx - 8, 0, cx - 11, -3, col, 1);
        p.line(cx + 8, 3, cx + 12, 2, col, 1); p.line(cx + 8, 0, cx + 11, -3, col, 1);
        p.dot(cx - 9, -2, light); p.dot(cx + 9, -2, light);  // lit tips
        p.dot(cx - 6, 9, dark); p.dot(cx + 6, 9, dark);      // base shade
    } else if (shape === 'halo') {
        // A glowing ring floating just above the head (hollow centre).
        p.ell(cx, 2, 9, 4, col);                    // outer disc
        const hctx = p.ctx; hctx.save();
        hctx.globalCompositeOperation = 'destination-out';
        p.ell(cx, 2, 6, 2, '#000');                 // punch the hole → ring
        hctx.restore();
        p.ell(cx, -2, 9, 1, light);                 // lit top rim
    } else if (shape === 'party') {
        // Cone party hat (stripes + pom). Funny, festive.
        for (let yy = -2; yy <= 10; yy++) { const half = Math.round((yy + 3) / 14 * 7); p.rect(cx - half, yy, half * 2 + 1, 1, col); }
        p.rect(cx - 7, 11, 15, 1, dark);            // base rim
        p.dot(cx - 1, 8, light); p.dot(cx + 2, 5, light); p.dot(cx - 3, 5, light); p.dot(cx, 2, light);  // confetti dots
        p.disc(cx, -4, 2, '#fff7e0');               // pom-pom
    } else if (shape === 'banana') {
        // A banana balanced on the head — peak monkey fashion.
        const bd = '#5a3a18';
        p.line(cx - 9, 6, cx - 3, 1, col, 3); p.line(cx - 3, 1, cx + 4, 1, col, 3); p.line(cx + 4, 1, cx + 9, 6, col, 3);
        p.line(cx - 8, 5, cx - 3, 1, light, 1); p.line(cx + 4, 1, cx + 8, 5, light, 1);   // top highlight
        p.rect(cx - 10, 6, 2, 2, bd); p.rect(cx + 9, 6, 2, 2, bd);                          // stem + tip
    }
    // outline() writes raster-space edge pixels through the ctx — reset the
    // HAT_DROP translate first or the outline lands 5px below the art.
    p.ctx.setTransform(1, 0, 0, 1, 0, 0);
    outline(p, shade(col, 0.6, 'dark'));
    return p.finish();
}

function cachedCosmetic(key, build) {
    if (cosmeticCache.has(key)) return cosmeticCache.get(key);
    let c = null;
    try { c = build(); } catch (e) { c = null; }
    cosmeticCache.set(key, c);
    return c;
}

// Draw a cached pixel cloak onto the body box centred at (ox,oy) with half-size
// `s` (the player passes spriteHalf; the menu its avatar half). `flip` mirrors
// horizontally about ox (for left-facing side views).
export function drawPixelCloak(ctx, ox, oy, s, dir, color, flip = false) {
    if (!color) return;
    const c = cachedCosmetic(`cloak:${dir}:${color}`, () => pixelCloak(dir, color));
    if (!c) return;
    ctx.save();
    if (flip) { ctx.translate(ox, 0); ctx.scale(-1, 1); ctx.translate(-ox, 0); }
    ctx.drawImage(c, ox - s, oy - s, s * 2, s * 2);
    ctx.restore();
}

export function drawPixelHat(ctx, ox, oy, s, dir, shape, color, flip = false) {
    if (!shape || shape === 'none') return;
    const c = cachedCosmetic(`hat:${dir}:${shape}:${color}`, () => pixelHat(dir, shape, color));
    if (!c) return;
    ctx.save();
    if (flip) { ctx.translate(ox, 0); ctx.scale(-1, 1); ctx.translate(-ox, 0); }
    // Art is authored HAT_DROP logical px lower in-canvas (headroom for tall
    // hats); blit that much higher so on-head anchors are unchanged.
    const lift = (HAT_DROP / MONKEY_L) * s * 2;
    ctx.drawImage(c, ox - s, oy - s - lift, s * 2, s * 2);
    ctx.restore();
}
