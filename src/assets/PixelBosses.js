// Hand-drawn pixel-art bosses — 12 UNIQUE sprites in the chunky LPC palette
// style (no external assets, no enlarged-small reuse, no recolor-of-the-same
// sprite). Each boss has its own silhouette + palette and a 2-frame idle
// animation. Drawn on a 64px logical grid and nearest-neighbour upscaled to the
// SPRITE_SIZE box; the boss's visualScale (config) then sizes it on screen.
//
// getPixelBossFrames(type) returns the cached frame array (built lazily) or
// null for an unknown type → Enemy.js keeps its procedural fallback.

import { pixelCanvas, outline } from './PixelArt.js';

const L = 64;
const C = 32; // centre

// Small shared helpers --------------------------------------------------------
function glowEye(p, x, y, r, col, lit) {
    p.disc(x, y, r + (lit ? 1 : 0), col);
    p.dot(x, y, '#ffffff');
}
function teeth(p, x0, x1, y, col) {
    for (let x = x0; x < x1; x += 3) { p.rect(x, y, 1, 2, col); }
}

// ── 1. Vinebackgoliath — rootbound plant tyrant ─────────────────────────
function vinebackGoliath(f) {
    const p = pixelCanvas(L);
    const G = '#3f9d4e', GD = '#205c2a', GL = '#7fd07f', maw = '#1c2a14', gold = '#e8c24a';
    // roots
    p.sym(10, 50, 4, 10, GD); p.line(14, 52, 8, 60, GD, 2); p.line(50, 52, 56, 60, GD, 2);
    // bulb body
    p.ell(C, 40, 16, 16, G);
    p.ell(C - 6, 34, 7, 7, GL); p.ell(C + 7, 44, 6, 7, GD);
    // gaping maw
    p.ell(C, 40, 10, 8, maw);
    teeth(p, C - 8, C + 8, 34, '#e8e8d0'); teeth(p, C - 8, C + 8, 45, '#e8e8d0');
    glowEye(p, C - 5, 38, 2, gold, f); glowEye(p, C + 5, 38, 2, gold, f);
    // thorny petals/crown
    for (let i = -2; i <= 2; i++) p.line(C + i * 6, 26, C + i * 7, 16 - (i ? 0 : f), GD, 2);
    p.sym(8, 30, 6, 4, G); // leaf arms
    outline(p, '#10210f');
    return p.finish();
}

// ── 2. Stormwingalpha — tempest raptor ──────────────────────────────────
function stormwingAlpha(f) {
    const p = pixelCanvas(L);
    const B = '#5566aa', BD = '#2f3a6b', BL = '#9fb0e0', beak = '#e8c24a', volt = '#bfe6ff';
    const wf = f ? 2 : 0; // wing flap
    // wings
    p.line(C, 30, 6, 18 - wf, B, 4); p.line(C, 30, 58, 18 - wf, B, 4);
    p.line(8, 19 - wf, 4, 30 - wf, BD, 2); p.line(56, 19 - wf, 60, 30 - wf, BD, 2);
    p.line(C, 30, 12, 28 - wf, BL, 2); p.line(C, 30, 52, 28 - wf, BL, 2);
    // body
    p.ell(C, 34, 8, 11, B); p.ell(C - 3, 30, 4, 5, BL);
    // head
    p.disc(C, 22, 6, B);
    p.rect(C - 2, 22, 4, 3, beak); p.line(C, 24, C, 27, beak, 1);
    glowEye(p, C - 3, 21, 1, volt, f); glowEye(p, C + 3, 21, 1, volt, f);
    // talons + lightning
    p.line(C - 4, 44, C - 6, 50, BD, 2); p.line(C + 4, 44, C + 6, 50, BD, 2);
    if (f) p.line(C + 9, 12, C + 13, 20, volt, 1);
    outline(p, '#161a30');
    return p.finish();
}

// ── 3. Gloommaw — grinning hollow ───────────────────────────────────────
function gloomMaw(f) {
    const p = pixelCanvas(L);
    const D = '#3a2d52', DD = '#1d1430', DL = '#6a4a8c', eye = '#b15cff';
    p.ell(C, 34, 16, 17, D);            // floating dark skull
    p.ell(C - 6, 26, 6, 6, DL);
    // hollow eyes
    p.disc(C - 7, 30, 4, DD); p.disc(C + 7, 30, 4, DD);
    glowEye(p, C - 7, 30, 2 + (f ? 1 : 0), eye, f); glowEye(p, C + 7, 30, 2 + (f ? 1 : 0), eye, f);
    // wide grin
    p.ell(C, 42, 11, 5, DD);
    teeth(p, C - 9, C + 9, 39, '#d8d0e8'); teeth(p, C - 9, C + 9, 44, '#d8d0e8');
    // wisps
    p.line(18, 22, 14, 14 - (f ? 2 : 0), DL, 1); p.line(46, 22, 50, 14 - (f ? 2 : 0), DL, 1);
    outline(p, '#120c22');
    return p.finish();
}

// ── 4. Rimewarden — ice golem ───────────────────────────────────────────
function rimewarden(f) {
    const p = pixelCanvas(L);
    const I = '#7fb8e0', ID = '#3f6e9c', IL = '#cfeaff', eye = '#eaffff';
    // blocky body
    p.rect(C - 12, 28, 24, 24, I);
    p.rect(C - 12, 28, 6, 24, IL); p.rect(C + 6, 28, 6, 24, ID);
    // crystal shoulders
    p.line(C - 12, 28, C - 18, 18 - (f ? 1 : 0), IL, 3); p.line(C + 12, 28, C + 18, 18 - (f ? 1 : 0), IL, 3);
    // head block + crown crystal
    p.rect(C - 7, 16, 14, 13, I); p.line(C, 16, C, 8, IL, 2);
    glowEye(p, C - 4, 22, 1 + (f ? 1 : 0), eye, f); glowEye(p, C + 4, 22, 1 + (f ? 1 : 0), eye, f);
    // arms + frost cracks
    p.rect(C - 16, 32, 4, 14, I); p.rect(C + 12, 32, 4, 14, I);
    p.line(C - 4, 36, C + 2, 48, IL, 1);
    outline(p, '#1c3550');
    return p.finish();
}

// ── 5. Hoarfang — sleet serpent ─────────────────────────────────────────
function hoarfang(f) {
    const p = pixelCanvas(L);
    const S = '#aee0ee', SD = '#5f9fc0', SL = '#eafaff', fang = '#ffffff', eye = '#3fb0e0';
    const w = f ? 1 : -1;
    // coiled body (S-curve segments)
    for (let i = 0; i < 7; i++) {
        const yy = 52 - i * 5;
        const xx = C + Math.round(Math.sin(i * 0.9 + (f ? 0.5 : 0)) * 9);
        p.disc(xx, yy, 6 - (i > 4 ? i - 4 : 0), i % 2 ? S : SD);
    }
    // head
    const hx = C + 9 * w;
    p.ell(hx, 16, 8, 6, S); p.ell(hx - 2, 14, 3, 2, SL);
    glowEye(p, hx - 3, 15, 1, eye, f); glowEye(p, hx + 3, 15, 1, eye, f);
    p.line(hx - 3, 21, hx - 4, 26, fang, 1); p.line(hx + 3, 21, hx + 4, 26, fang, 1);
    outline(p, '#2c6680');
    return p.finish();
}

// ── 6. Aurorath — radiant light of the dead sky ─────────────────────────
function aurorath(f) {
    const p = pixelCanvas(L);
    const goldD = '#c8922a', gold = '#ffd86b', white = '#fff6d8', eye = '#fff';
    // halo ring
    for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        p.dot(C + Math.round(Math.cos(ang) * 20), 26 + Math.round(Math.sin(ang) * 20), gold);
    }
    // radiant wings
    p.line(C, 32, 8, 22, gold, 3); p.line(C, 32, 56, 22, gold, 3);
    p.line(C, 34, 12, 40, white, 2); p.line(C, 34, 52, 40, white, 2);
    // core orb + central eye
    p.disc(C, 30, 11, white); p.disc(C, 30, 8, gold);
    p.disc(C, 30, 4, '#fff'); glowEye(p, C, 30, 2 + (f ? 1 : 0), '#c8922a', f);
    // rays
    if (f) { p.line(C, 18, C, 10, white, 1); p.line(C, 42, C, 50, white, 1); }
    p.ell(C, 46, 6, 4, goldD);
    outline(p, '#7a5a14');
    return p.finish();
}

// ── 7. Ossuar — the bonecaller (lich) ───────────────────────────────────
function ossuar(f) {
    const p = pixelCanvas(L);
    const bone = '#e8e6d0', boneD = '#9a967c', robe = '#3a3550', robeD = '#221f33', eye = '#7bf0a0';
    // robe body
    p.ell(C, 44, 14, 14, robe); p.rect(C - 12, 36, 24, 16, robe);
    p.rect(C - 12, 36, 5, 16, robeD); p.rect(C + 7, 36, 5, 16, robeD);
    // ribcage
    for (let i = 0; i < 3; i++) p.rect(C - 6, 38 + i * 3, 12, 1, bone);
    p.rect(C - 1, 36, 2, 12, bone);
    // skull head
    p.ell(C, 22, 8, 8, bone); p.ell(C, 27, 5, 3, bone);
    p.disc(C - 4, 21, 2, '#1a1a1a'); p.disc(C + 4, 21, 2, '#1a1a1a');
    glowEye(p, C - 4, 21, 1 + (f ? 1 : 0), eye, f); glowEye(p, C + 4, 21, 1 + (f ? 1 : 0), eye, f);
    teeth(p, C - 4, C + 5, 28, boneD);
    // staff + bone arms
    p.line(C + 12, 14, C + 12, 50, boneD, 2); p.disc(C + 12, 13, 3, eye);
    p.line(C - 10, 38, C - 14, 46, bone, 2);
    outline(p, '#15131f');
    return p.finish();
}

// ── 8. Mourndrift — wailing wraith ──────────────────────────────────────
function mourndrift(f) {
    const p = pixelCanvas(L);
    const sh = '#5f8f8a', shD = '#33585a', shL = '#9fd0c8', eye = '#d8fff6';
    // tattered shroud (wavy bottom)
    p.ell(C, 30, 13, 14, sh);
    for (let x = -12; x <= 12; x += 4) {
        const len = 12 + ((x + (f ? 2 : 0)) % 8);
        p.rect(C + x, 40, 3, len, sh);
    }
    p.ell(C - 5, 24, 5, 6, shL); p.ell(C + 6, 34, 5, 6, shD);
    // hollow hood face
    p.ell(C, 26, 8, 9, shD);
    glowEye(p, C - 4, 25, 2, eye, f); glowEye(p, C + 4, 25, 2, eye, f);
    p.ell(C, 31, 2, 3, '#0a1a18'); // wailing mouth
    // wispy arms
    p.line(C - 11, 28, C - 16, 38 - (f ? 2 : 0), shL, 2); p.line(C + 11, 28, C + 16, 38 - (f ? 2 : 0), shL, 2);
    outline(p, '#1d3032');
    return p.finish();
}

// ── 9. Nihagault — the hungering void ───────────────────────────────────
function nihagault(f) {
    const p = pixelCanvas(L);
    const v = '#1a0f2e', rim = '#b15cff', rimL = '#e0a8ff', eye = '#ff4d9d';
    // tendrils
    for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + (f ? 0.4 : 0);
        p.line(C, 32, C + Math.round(Math.cos(ang) * 22), 32 + Math.round(Math.sin(ang) * 22), rim, 2);
    }
    // void orb
    p.disc(C, 32, 15, v); p.disc(C, 32, 15, v);
    for (let a = 0; a < 14; a++) { const ang = (a / 14) * Math.PI * 2; p.dot(C + Math.round(Math.cos(ang) * 15), 32 + Math.round(Math.sin(ang) * 15), rim); }
    // central + scattered eyes
    glowEye(p, C, 32, 3 + (f ? 1 : 0), eye, f);
    glowEye(p, C - 7, 28, 1, rimL, f); glowEye(p, C + 7, 36, 1, rimL, f); glowEye(p, C + 6, 26, 1, rimL, !f);
    outline(p, '#0c0718');
    return p.finish();
}

// ── 10. Dunescourge — sand scorpion ─────────────────────────────────────
function dunescourge(f) {
    const p = pixelCanvas(L);
    const t = '#d8b46a', tD = '#9a7a3c', tL = '#f0d89a', sting = '#caa', eye = '#1a1a1a';
    // body segments
    p.ell(C, 40, 11, 9, t); p.ell(C - 4, 37, 4, 4, tL); p.ell(C + 5, 43, 4, 4, tD);
    // claws
    p.line(C - 9, 38, C - 18, 32, t, 3); p.ell(C - 19, 30, 4, 3, t);
    p.line(C + 9, 38, C + 18, 32, t, 3); p.ell(C + 19, 30, 4, 3, t);
    // legs
    for (let i = 0; i < 3; i++) { p.line(C - 6, 42 + i * 2, C - 14, 48 + i * 2, tD, 1); p.line(C + 6, 42 + i * 2, C + 14, 48 + i * 2, tD, 1); }
    // segmented tail arching over, stinger
    let tx = C, ty = 34;
    for (let i = 0; i < 5; i++) { const nx = C + 4 + i * 2, ny = 34 - i * 5 - (f ? 1 : 0); p.disc(nx, ny, 4 - (i > 2 ? 1 : 0), t); tx = nx; ty = ny; }
    p.line(tx, ty, tx + 4, ty + 3, sting, 2); // stinger
    glowEye(p, C - 4, 38, 1, eye, false); glowEye(p, C + 4, 38, 1, eye, false);
    outline(p, '#5e4520');
    return p.finish();
}

// ── 11. Cindermaw — ember jaw ───────────────────────────────────────────
function cindermaw(f) {
    const p = pixelCanvas(L);
    const r = '#c0331f', rD = '#6e1810', em = '#ff8a2c', emL = '#ffd24a', maw = '#240805';
    // molten body
    p.ell(C, 38, 15, 15, r); p.ell(C + 5, 44, 6, 6, rD);
    // glowing cracks
    p.line(C - 6, 30, C - 3, 44, em, 1); p.line(C + 4, 30, C + 7, 42, em, 1);
    // gaping ember maw
    p.ell(C, 40, 10, 7, maw);
    teeth(p, C - 8, C + 8, 35, emL); teeth(p, C - 8, C + 8, 44, emL);
    p.ell(C, 42, 5, 3, em); // throat glow
    glowEye(p, C - 6, 33, 2 + (f ? 1 : 0), emL, f); glowEye(p, C + 6, 33, 2 + (f ? 1 : 0), emL, f);
    // flame crown
    for (let i = -2; i <= 2; i++) p.line(C + i * 6, 24, C + i * 6 + (i ? 0 : 0), 14 - (i % 2 ? f * 2 : 0), i % 2 ? em : emL, 2);
    outline(p, '#3a0c06');
    return p.finish();
}

// ── 12. Solnakh — the burning crown (apex) ──────────────────────────────
function solnakh(f) {
    const p = pixelCanvas(L);
    const body = '#b8472a', bodyD = '#6e1f10', em = '#ff9a3c', gold = '#ffd24a', eye = '#fff0b0', maw = '#240805';
    // flame wings
    p.line(C, 34, 8, 20 - (f ? 2 : 0), em, 4); p.line(C, 34, 56, 20 - (f ? 2 : 0), em, 4);
    p.line(C, 34, 12, 40, gold, 2); p.line(C, 34, 52, 40, gold, 2);
    // body
    p.ell(C, 38, 12, 14, body); p.ell(C - 4, 32, 5, 6, em); p.ell(C + 6, 44, 5, 6, bodyD);
    p.line(C - 5, 32, C - 2, 48, gold, 1); p.line(C + 4, 32, C + 6, 46, gold, 1); // molten cracks
    // head + maw
    p.ell(C, 24, 8, 7, body); p.ell(C, 27, 5, 3, maw); teeth(p, C - 4, C + 5, 27, gold);
    glowEye(p, C - 4, 22, 1 + (f ? 1 : 0), eye, f); glowEye(p, C + 4, 22, 1 + (f ? 1 : 0), eye, f);
    // burning crown
    for (let i = -2; i <= 2; i++) p.line(C + i * 4, 17, C + i * 4, 9 - (i % 2 ? f * 2 : 3), gold, 2);
    p.rect(C - 9, 17, 18, 2, gold);
    outline(p, '#3a0c06');
    return p.finish();
}

const DRAWERS = {
    vinebackGoliath, stormwingAlpha, gloomMaw, rimewarden, hoarfang, aurorath,
    ossuar, mourndrift, nihagault, dunescourge, cindermaw, solnakh,
};

const cache = new Map();   // type → [frame0, frame1]

// Built lazily + cached. Returns null for unknown types (→ procedural fallback).
export function getPixelBossFrames(type) {
    if (cache.has(type)) return cache.get(type);
    const draw = DRAWERS[type];
    if (!draw) return null;
    const frames = [draw(0), draw(1)];
    cache.set(type, frames);
    return frames;
}
