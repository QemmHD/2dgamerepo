// Procedural sprite atlas — every character, monster, pickup, decoration,
// and ground tile is drawn at boot into offscreen canvases and cached.
// Nothing in this file allocates per frame.
//
// Animation strategy:
//   Multi-frame entities (monkey, slime, bat, crawler, bosses, coin,
//   chest) own a frame ARRAY in the cache. The draw call site picks an
//   index using time-based math; the file simply hands back the cached
//   canvas for that index. This keeps per-frame work to one drawImage.
//
// All character/enemy/boss source canvases are SPRITE_SIZE × SPRITE_SIZE
// (182×182) — the visual is drawn inside that canvas so the world-space
// half-extents stay constant across types.

import { SPRITE_SIZE, MAP, GEM_TIERS, LIGHT_COLORS } from '../config/GameConfig.js';
import { TWO_PI } from '../core/MathUtils.js';

const cache = new Map();

// Soft white radial used as a light cutout (drawn with 'destination-out'
// to carve holes in the darkness veil) and reused as a particle mask.
export function getLightMaskSprite() {
    if (cache.has('lightMask')) return cache.get('lightMask');
    const sprite = drawLightMask(256);
    cache.set('lightMask', sprite);
    return sprite;
}

// Cached colored radial glow (color center → transparent), used for the
// additive color-tint pass and for particles. Keyed by hex color.
export function getGlowSprite(color) {
    const key = `glow:${color}`;
    if (cache.has(key)) return cache.get(key);
    const sprite = drawGlow(128, color);
    cache.set(key, sprite);
    return sprite;
}

// Build every sprite up-front (called once at boot) so nothing rasterizes
// mid-frame. Without this the first spawn of each enemy, the first coin,
// and especially the first boss (heavy multi-frame vector art) hitch the
// frame exactly when the action spikes. All getters are memoized, so this
// is a one-time cost and later calls are free Map hits.
export function prewarmSprites() {
    getMonkeyFrames();
    getSlimeFrames();
    getBatFrames();
    getBruteFrames();
    getCrawlerFrames();
    getVinebackGoliathFrames();
    getStormwingAlphaFrames();
    getSpitterFrames();
    getChargerFrames();
    getChestFrames();
    getCoinFrames();
    getProjectileSprite();
    getEmberWispSprite();
    getGroundTileSprite();
    for (const tier of GEM_TIERS) getXPGemSprite(tier);
    for (const type of MAP.decorationTypes) getDecorationSprite(type);
    // Lighting + particle masks/glows.
    getLightMaskSprite();
    for (const key in LIGHT_COLORS) getGlowSprite(LIGHT_COLORS[key]);
    // Particle-specific glow colors not in LIGHT_COLORS.
    for (const c of PARTICLE_GLOW_COLORS) getGlowSprite(c);
}

// Extra glow tints used by the particle system that aren't already in
// LIGHT_COLORS — prewarmed so the first death/spark of each kind never
// rasterizes a gradient mid-combat. (white spark, ash puff, the per-enemy
// death-burst tints, and the elite tint.)
export const PARTICLE_GLOW_COLORS = [
    '#ffffff', '#3a2a22', '#ffcaa0',
    '#7be08a', '#b48cff', '#9a7cff', '#d8a060', '#ffe08a',
    '#c97bff', // enemy bolt (Spitter)
    // Elemental status + telegraph/hazard glows (fire/shock/frost/freeze +
    // the boss telegraph + shockwave-light tints) so the first proc of each
    // never rasterizes a gradient mid-combat.
    '#ff7a33', '#ffe066', '#7fe0ff', '#bfe8ff', '#ff5a3c', '#ff7a4a',
];

// ── Ground tile ────────────────────────────────────────────────────────

export function getGroundTileSprite() {
    if (cache.has('groundTile')) return cache.get('groundTile');
    const sprite = drawGroundTile(MAP.tileSize);
    cache.set('groundTile', sprite);
    return sprite;
}

export function getDecorationSprite(type) {
    const key = `dec:${type}`;
    if (cache.has(key)) return cache.get(key);
    const sprite = drawDecoration(type);
    cache.set(key, sprite);
    return sprite;
}

// ── Player / monkey ───────────────────────────────────────────────────
// 4 frames: 0 idle, 1 / 3 walk extremes, 2 mid. Game picks by bobTimer.

export function getMonkeyFrames() {
    if (cache.has('monkeyFrames')) return cache.get('monkeyFrames');
    const frames = [
        drawMonkey(SPRITE_SIZE, 0),
        drawMonkey(SPRITE_SIZE, 1),
        drawMonkey(SPRITE_SIZE, 2),
        drawMonkey(SPRITE_SIZE, 3),
    ];
    cache.set('monkeyFrames', frames);
    return frames;
}

// Back-compat: returns idle frame.
export function getMonkeySprite() {
    return getMonkeyFrames()[0];
}

// ── Enemies ────────────────────────────────────────────────────────────

function makeFrameGetter(key, count, drawer) {
    return () => {
        if (cache.has(key)) return cache.get(key);
        const frames = [];
        for (let i = 0; i < count; i++) frames.push(drawer(SPRITE_SIZE, i, count));
        cache.set(key, frames);
        return frames;
    };
}

export const getSlimeFrames = makeFrameGetter('slimeFrames', 4, drawSlime);
export const getBatFrames = makeFrameGetter('batFrames', 4, drawBat);
export const getBruteFrames = makeFrameGetter('bruteFrames', 2, drawBrute);
export const getCrawlerFrames = makeFrameGetter('crawlerFrames', 4, drawCrawler);
export const getVinebackGoliathFrames = makeFrameGetter('vinebackFrames', 2, drawVinebackGoliath);
export const getStormwingAlphaFrames = makeFrameGetter('stormwingFrames', 4, drawStormwingAlpha);
export const getSpitterFrames = makeFrameGetter('spitterFrames', 4, drawSpitter);
export const getChargerFrames = makeFrameGetter('chargerFrames', 2, drawCharger);

// Back-compat: idle frames for legacy callers.
export function getSlimeSprite() { return getSlimeFrames()[0]; }
export function getBatSprite() { return getBatFrames()[0]; }
export function getBruteSprite() { return getBruteFrames()[0]; }
export function getCrawlerSprite() { return getCrawlerFrames()[0]; }
export function getVinebackGoliathSprite() { return getVinebackGoliathFrames()[0]; }
export function getStormwingAlphaSprite() { return getStormwingAlphaFrames()[0]; }
export function getSpitterSprite() { return getSpitterFrames()[0]; }
export function getChargerSprite() { return getChargerFrames()[0]; }

// ── Pickups ────────────────────────────────────────────────────────────

export function getChestFrames() {
    if (cache.has('chestFrames')) return cache.get('chestFrames');
    const frames = [drawChest(0), drawChest(1), drawChest(2)];
    cache.set('chestFrames', frames);
    return frames;
}

export function getChestSprite() { return getChestFrames()[0]; }

export function getCoinFrames() {
    if (cache.has('coinFrames')) return cache.get('coinFrames');
    const frames = [];
    for (let i = 0; i < 6; i++) frames.push(drawCoin(i, 6));
    cache.set('coinFrames', frames);
    return frames;
}

export function getCoinSprite() { return getCoinFrames()[0]; }

export function getXPGemSprite(tier) {
    const key = `gem:${tier}`;
    if (cache.has(key)) return cache.get(key);
    const sprite = drawXPGem(tier);
    cache.set(key, sprite);
    return sprite;
}

export function getProjectileSprite() {
    if (cache.has('projectile')) return cache.get('projectile');
    const sprite = drawProjectile();
    cache.set('projectile', sprite);
    return sprite;
}

export function getEmberWispSprite() {
    if (cache.has('emberWisp')) return cache.get('emberWisp');
    const sprite = drawEmberWisp();
    cache.set('emberWisp', sprite);
    return sprite;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function newSpriteCanvas(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    return canvas;
}

function softShadow(ctx, cx, cy, rx, ry, alpha = 0.35) {
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
    ctx.fill();
}

// ─── Player / monkey ──────────────────────────────────────────────────

function drawMonkey(size, frame) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;

    // Walk-cycle phase for limbs/tail. Frame 0 = idle.
    const isIdle = frame === 0;
    const phase = isIdle ? 0 : (frame - 1) * (TWO_PI / 3);
    const swing = Math.sin(phase);
    const bob = isIdle ? 0 : Math.abs(Math.cos(phase)) * 3;

    const FUR = '#8b5a2b';
    const FUR_DARK = '#5a3818';
    const FUR_LIGHT = '#b07a44';
    const FACE = '#f0d2a5';
    const INNER_EAR = '#d4a373';
    const EYE = '#1b1b1b';
    const CLOAK = '#3a2c5e';
    const CLOAK_LIGHT = '#5d4690';
    const CLOAK_DARK = '#1f1734';
    const SCARF = '#c93a3a';
    const SCARF_DARK = '#7a1d1d';
    const BELT = '#3c2210';
    const GOLD = '#ffd166';
    const STAFF = '#3a2412';
    const STAFF_TIP = '#7be0ff';

    softShadow(ctx, cx, cy + 60, 50, 9, 0.4);

    // ── Tail (swayed) ─────────────────────────────────────────────────
    const tailSway = (isIdle ? Math.sin(frame * 0.5) : swing) * 8;
    ctx.strokeStyle = FUR_DARK;
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + 24, cy + 38);
    ctx.bezierCurveTo(
        cx + 70 + tailSway, cy + 60,
        cx + 96 + tailSway, cy + 10,
        cx + 70 + tailSway * 1.2, cy - 16
    );
    ctx.stroke();
    ctx.strokeStyle = FUR;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(cx + 24, cy + 38);
    ctx.bezierCurveTo(
        cx + 70 + tailSway, cy + 60,
        cx + 96 + tailSway, cy + 10,
        cx + 70 + tailSway * 1.2, cy - 16
    );
    ctx.stroke();
    // Tail tuft
    ctx.fillStyle = FUR_LIGHT;
    ctx.beginPath();
    ctx.arc(cx + 70 + tailSway * 1.2, cy - 18, 7, 0, TWO_PI);
    ctx.fill();

    // ── Legs ──────────────────────────────────────────────────────────
    const legL = cy + 48 + (isIdle ? 0 : swing * 4);
    const legR = cy + 48 + (isIdle ? 0 : -swing * 4);
    ctx.fillStyle = FUR_DARK;
    ctx.beginPath();
    ctx.ellipse(cx - 22, legL, 11, 16, 0, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + 22, legR, 11, 16, 0, 0, TWO_PI);
    ctx.fill();
    // Feet
    ctx.fillStyle = FACE;
    ctx.beginPath();
    ctx.ellipse(cx - 22, legL + 12, 10, 6, 0, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + 22, legR + 12, 10, 6, 0, 0, TWO_PI);
    ctx.fill();

    // Body shift up while walking gives a subtle bounce.
    const bodyY = cy + 4 - bob;

    // ── Cloak (behind body) ───────────────────────────────────────────
    ctx.fillStyle = CLOAK_DARK;
    ctx.beginPath();
    ctx.moveTo(cx - 46, bodyY - 16);
    ctx.quadraticCurveTo(cx - 60, bodyY + 28, cx - 30, bodyY + 56);
    ctx.lineTo(cx + 30, bodyY + 56);
    ctx.quadraticCurveTo(cx + 60, bodyY + 28, cx + 46, bodyY - 16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = CLOAK;
    ctx.beginPath();
    ctx.moveTo(cx - 42, bodyY - 14);
    ctx.quadraticCurveTo(cx - 56, bodyY + 24, cx - 28, bodyY + 50);
    ctx.lineTo(cx + 28, bodyY + 50);
    ctx.quadraticCurveTo(cx + 56, bodyY + 24, cx + 42, bodyY - 14);
    ctx.closePath();
    ctx.fill();
    // Cloak highlight stripe
    ctx.fillStyle = CLOAK_LIGHT;
    ctx.beginPath();
    ctx.moveTo(cx - 30, bodyY - 8);
    ctx.quadraticCurveTo(cx - 42, bodyY + 16, cx - 24, bodyY + 40);
    ctx.lineTo(cx - 18, bodyY + 40);
    ctx.quadraticCurveTo(cx - 32, bodyY + 16, cx - 22, bodyY - 8);
    ctx.closePath();
    ctx.fill();

    // ── Body ──────────────────────────────────────────────────────────
    ctx.fillStyle = FUR;
    ctx.beginPath();
    ctx.ellipse(cx, bodyY + 4, 36, 42, 0, 0, TWO_PI);
    ctx.fill();
    // Belly
    ctx.fillStyle = FACE;
    ctx.beginPath();
    ctx.ellipse(cx, bodyY + 14, 18, 22, 0, 0, TWO_PI);
    ctx.fill();

    // ── Belt + satchel ────────────────────────────────────────────────
    ctx.fillStyle = BELT;
    ctx.fillRect(cx - 26, bodyY + 24, 52, 6);
    ctx.fillStyle = GOLD;
    ctx.fillRect(cx - 4, bodyY + 24, 8, 6);
    ctx.strokeStyle = '#7a5018';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - 4, bodyY + 24, 8, 6);

    // Satchel hanging from belt
    ctx.fillStyle = '#5a3818';
    ctx.beginPath();
    ctx.ellipse(cx - 30, bodyY + 32, 8, 11, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#3a2410';
    ctx.beginPath();
    ctx.ellipse(cx - 30, bodyY + 27, 8, 3, 0, 0, TWO_PI);
    ctx.fill();

    // ── Scarf at neck ────────────────────────────────────────────────
    ctx.fillStyle = SCARF_DARK;
    ctx.beginPath();
    ctx.ellipse(cx, bodyY - 26, 24, 9, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = SCARF;
    ctx.beginPath();
    ctx.ellipse(cx, bodyY - 28, 22, 7, 0, 0, TWO_PI);
    ctx.fill();
    // Loose scarf tail
    const scarfDrift = isIdle ? 2 : swing * 4;
    ctx.fillStyle = SCARF;
    ctx.beginPath();
    ctx.moveTo(cx + 8, bodyY - 24);
    ctx.lineTo(cx + 24 + scarfDrift, bodyY + 4);
    ctx.lineTo(cx + 16 + scarfDrift, bodyY + 8);
    ctx.lineTo(cx + 4, bodyY - 20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = SCARF_DARK;
    ctx.lineWidth = 1;
    ctx.stroke();

    // ── Arms / staff ─────────────────────────────────────────────────
    const armLY = bodyY + 4 + (isIdle ? 0 : -swing * 5);
    const armRY = bodyY + 4 + (isIdle ? 0 : swing * 5);

    // Left arm (player's left = screen left)
    ctx.fillStyle = FUR;
    ctx.beginPath();
    ctx.ellipse(cx - 36, armLY, 10, 18, 0.2, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = FACE;
    ctx.beginPath();
    ctx.arc(cx - 40, armLY + 14, 7, 0, TWO_PI);
    ctx.fill();

    // Right arm holds staff
    ctx.fillStyle = FUR;
    ctx.beginPath();
    ctx.ellipse(cx + 36, armRY, 10, 18, -0.2, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = FACE;
    ctx.beginPath();
    ctx.arc(cx + 40, armRY + 14, 7, 0, TWO_PI);
    ctx.fill();

    // Staff
    ctx.strokeStyle = STAFF;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + 40, armRY + 20);
    ctx.lineTo(cx + 50, armRY - 50);
    ctx.stroke();
    // Staff wraps
    ctx.strokeStyle = SCARF;
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
        const y = armRY + 14 - i * 9;
        ctx.beginPath();
        ctx.moveTo(cx + 38 + i * 1, y);
        ctx.lineTo(cx + 46 + i * 1, y - 2);
        ctx.stroke();
    }
    // Glowing crystal on top
    const glowGrad = ctx.createRadialGradient(cx + 50, armRY - 50, 1, cx + 50, armRY - 50, 14);
    glowGrad.addColorStop(0, '#e8fbff');
    glowGrad.addColorStop(0.5, STAFF_TIP);
    glowGrad.addColorStop(1, 'rgba(123, 224, 255, 0)');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(cx + 50, armRY - 50, 14, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = STAFF_TIP;
    ctx.beginPath();
    ctx.moveTo(cx + 50, armRY - 58);
    ctx.lineTo(cx + 56, armRY - 50);
    ctx.lineTo(cx + 50, armRY - 42);
    ctx.lineTo(cx + 44, armRY - 50);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx + 48, armRY - 52, 2, 0, TWO_PI);
    ctx.fill();

    // ── Head (front of body) ─────────────────────────────────────────
    const headY = bodyY - 44;
    // Ears outer
    ctx.fillStyle = FUR_DARK;
    ctx.beginPath();
    ctx.arc(cx - 36, headY - 6, 15, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 36, headY - 6, 15, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = INNER_EAR;
    ctx.beginPath();
    ctx.arc(cx - 36, headY - 6, 8, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 36, headY - 6, 8, 0, TWO_PI);
    ctx.fill();

    // Skull
    ctx.fillStyle = FUR;
    ctx.beginPath();
    ctx.arc(cx, headY, 38, 0, TWO_PI);
    ctx.fill();
    // Face
    ctx.fillStyle = FACE;
    ctx.beginPath();
    ctx.ellipse(cx, headY + 6, 25, 26, 0, 0, TWO_PI);
    ctx.fill();
    // Hair tuft
    ctx.fillStyle = FUR_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx, headY - 24, 16, 8, 0, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx - 8, headY - 28, 8, 6, -0.3, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + 8, headY - 28, 8, 6, 0.3, 0, TWO_PI);
    ctx.fill();

    // Forehead charm (gem)
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.arc(cx, headY - 14, 5, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#c4242a';
    ctx.beginPath();
    ctx.arc(cx, headY - 14, 3, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#ffd0d0';
    ctx.beginPath();
    ctx.arc(cx - 1, headY - 15, 1, 0, TWO_PI);
    ctx.fill();

    // Eyes
    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(cx - 9, headY + 2, 4.6, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 9, headY + 2, 4.6, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx - 7, headY + 0.5, 1.8, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 11, headY + 0.5, 1.8, 0, TWO_PI);
    ctx.fill();

    // Nose + mouth
    ctx.fillStyle = FUR_DARK;
    ctx.beginPath();
    ctx.ellipse(cx, headY + 12, 3, 2, 0, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = FUR_DARK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, headY + 17, 5, 0, Math.PI);
    ctx.stroke();

    return canvas;
}

// ─── Slime ────────────────────────────────────────────────────────────

function drawSlime(size, frame, count) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;

    const phase = (frame / count) * TWO_PI;
    // squash factor cycles between tall and squat.
    const squash = Math.sin(phase);
    const bodyRx = 65 + squash * 6;
    const bodyRy = 55 - squash * 8;
    const bodyY = cy + 8 - squash * 4;

    const BODY = '#5cc26d';
    const BODY_DARK = '#2a6b35';
    const BODY_LIGHT = '#a0e8a8';
    const SLIME = '#83e191';
    const EYE = '#1b1b1b';

    softShadow(ctx, cx, cy + 60, bodyRx - 6, 11, 0.32);

    // Drip strands above
    ctx.fillStyle = BODY_DARK;
    ctx.beginPath();
    ctx.arc(cx - 30, cy - 28 + squash * 3, 5, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 26, cy - 32 - squash * 3, 4, 0, TWO_PI);
    ctx.fill();

    // Body
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(cx, bodyY, bodyRx, bodyRy, 0, 0, TWO_PI);
    ctx.fill();
    // Goop blobs at base
    ctx.beginPath();
    ctx.arc(cx - 38, bodyY + bodyRy * 0.65, 18, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 38, bodyY + bodyRy * 0.65, 18, 0, TWO_PI);
    ctx.fill();

    // Bright highlight
    ctx.fillStyle = BODY_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx - 22, bodyY - 18, 26, 14, -0.3, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = SLIME;
    ctx.beginPath();
    ctx.ellipse(cx + 14, bodyY - 8, 14, 7, 0.4, 0, TWO_PI);
    ctx.fill();

    // Outline
    ctx.strokeStyle = BODY_DARK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(cx, bodyY, bodyRx, bodyRy, 0, 0, TWO_PI);
    ctx.stroke();

    // Glowing eyes
    const eyeGlow = ctx.createRadialGradient(cx, bodyY - 4, 1, cx, bodyY - 4, 22);
    eyeGlow.addColorStop(0, 'rgba(255,255,255,0.4)');
    eyeGlow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = eyeGlow;
    ctx.fillRect(cx - 32, bodyY - 22, 64, 36);

    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(cx - 17, bodyY - 4, 9, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 17, bodyY - 4, 9, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx - 14, bodyY - 7, 3, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 20, bodyY - 7, 3, 0, TWO_PI);
    ctx.fill();

    // Smile
    ctx.strokeStyle = EYE;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, bodyY + 14, 10, 0.15, Math.PI - 0.15);
    ctx.stroke();
    // Fang
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(cx - 6, bodyY + 18);
    ctx.lineTo(cx - 3, bodyY + 24);
    ctx.lineTo(cx, bodyY + 18);
    ctx.closePath();
    ctx.fill();

    return canvas;
}

// ─── Bat ──────────────────────────────────────────────────────────────

function drawBat(size, frame, count) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;

    // Wing flap: 0 spread, 1 mid-down, 2 down, 3 mid-up
    const phase = (frame / count) * TWO_PI;
    const flap = Math.cos(phase);
    const wingScale = 0.7 + flap * 0.3;
    const wingY = -flap * 14;

    const WING_DARK = '#1a1230';
    const WING = '#2a1f4a';
    const WING_EDGE = '#5b4690';
    const BODY = '#3a2860';
    const BODY_LIGHT = '#5d4690';
    const EYE = '#ff3046';
    const FANG = '#fff';

    softShadow(ctx, cx, cy + 50, 30, 8, 0.25 - flap * 0.05);

    // Wing membranes
    function wing(side) {
        const s = side;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(s, 1);
        ctx.fillStyle = WING_DARK;
        ctx.beginPath();
        ctx.moveTo(4, -2);
        ctx.quadraticCurveTo(60 * wingScale, -50 * wingScale + wingY, 92 * wingScale, -10 + wingY);
        ctx.quadraticCurveTo(76 * wingScale, -4 + wingY, 64 * wingScale, 0);
        ctx.quadraticCurveTo(82 * wingScale, 18 + wingY * 0.4, 56 * wingScale, 28);
        ctx.quadraticCurveTo(34 * wingScale, 14, 12, 12);
        ctx.closePath();
        ctx.fill();
        // Membrane highlight
        ctx.fillStyle = WING;
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.quadraticCurveTo(50 * wingScale, -36 * wingScale + wingY, 80 * wingScale, -6 + wingY);
        ctx.quadraticCurveTo(60 * wingScale, 2 + wingY, 52 * wingScale, 6);
        ctx.quadraticCurveTo(30 * wingScale, 10, 14, 10);
        ctx.closePath();
        ctx.fill();
        // Bone struts
        ctx.strokeStyle = WING_EDGE;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(8, 2);
        ctx.lineTo(78 * wingScale, -10 + wingY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(8, 4);
        ctx.lineTo(60 * wingScale, 16);
        ctx.stroke();
        ctx.restore();
    }
    wing(-1);
    wing(1);

    // Body
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, 19, 28, 0, 0, TWO_PI);
    ctx.fill();
    // Belly highlight
    ctx.fillStyle = BODY_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx - 4, cy - 4, 8, 14, -0.2, 0, TWO_PI);
    ctx.fill();

    // Ears
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy - 18);
    ctx.lineTo(cx - 6, cy - 40);
    ctx.lineTo(cx - 2, cy - 18);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 12, cy - 18);
    ctx.lineTo(cx + 6, cy - 40);
    ctx.lineTo(cx + 2, cy - 18);
    ctx.closePath();
    ctx.fill();

    // Eye glow
    const eyeGlow = ctx.createRadialGradient(cx, cy - 8, 1, cx, cy - 8, 18);
    eyeGlow.addColorStop(0, 'rgba(255, 80, 100, 0.45)');
    eyeGlow.addColorStop(1, 'rgba(255, 80, 100, 0)');
    ctx.fillStyle = eyeGlow;
    ctx.fillRect(cx - 18, cy - 22, 36, 28);

    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(cx - 8, cy - 8, 4.6, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 8, cy - 8, 4.6, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#ffe0e6';
    ctx.beginPath();
    ctx.arc(cx - 7, cy - 9.5, 1.7, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 9, cy - 9.5, 1.7, 0, TWO_PI);
    ctx.fill();

    // Fangs
    ctx.fillStyle = FANG;
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy + 4);
    ctx.lineTo(cx - 2, cy + 14);
    ctx.lineTo(cx - 1, cy + 5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 6, cy + 4);
    ctx.lineTo(cx + 2, cy + 14);
    ctx.lineTo(cx + 1, cy + 5);
    ctx.closePath();
    ctx.fill();

    return canvas;
}

// ─── Brute ────────────────────────────────────────────────────────────

function drawBrute(size, frame) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;

    // Subtle breathing pulse: frame 0 contracted, frame 1 expanded.
    const breathe = frame === 0 ? 0 : 1;
    const bodyRx = 76 + breathe * 2;
    const bodyRy = 64 + breathe * 2;

    const BODY = '#6b4226';
    const BODY_DARK = '#3a2410';
    const BODY_LIGHT = '#a06f3e';
    const ARMOR = '#3c352c';
    const ARMOR_LIGHT = '#7a6e5c';
    const SPIKE = '#cdd2d8';
    const SPIKE_DARK = '#4a4f55';
    const EYE = '#ff8c40';
    const FANG = '#fff5d0';

    softShadow(ctx, cx, cy + 70, 76, 16, 0.42);

    // Shoulder pauldrons (behind body)
    ctx.fillStyle = ARMOR;
    ctx.beginPath();
    ctx.arc(cx - 60, cy - 10, 18, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 60, cy - 10, 18, 0, TWO_PI);
    ctx.fill();
    // Pauldron rivets
    ctx.fillStyle = ARMOR_LIGHT;
    ctx.beginPath();
    ctx.arc(cx - 60, cy - 14, 5, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 60, cy - 14, 5, 0, TWO_PI);
    ctx.fill();

    // Body
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, bodyRx, bodyRy, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = BODY_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx - 20, cy - 18, 34, 20, -0.3, 0, TWO_PI);
    ctx.fill();
    // Outline
    ctx.strokeStyle = BODY_DARK;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, bodyRx, bodyRy, 0, 0, TWO_PI);
    ctx.stroke();

    // Chest plate (armor strap)
    ctx.fillStyle = ARMOR;
    ctx.beginPath();
    ctx.moveTo(cx - 40, cy + 10);
    ctx.lineTo(cx - 28, cy - 24);
    ctx.lineTo(cx + 28, cy - 24);
    ctx.lineTo(cx + 40, cy + 10);
    ctx.lineTo(cx + 36, cy + 30);
    ctx.lineTo(cx - 36, cy + 30);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ARMOR_LIGHT;
    ctx.lineWidth = 2;
    ctx.stroke();
    // Rune on plate
    ctx.fillStyle = '#9d2222';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx + 8, cy + 4);
    ctx.lineTo(cx, cy + 18);
    ctx.lineTo(cx - 8, cy + 4);
    ctx.closePath();
    ctx.fill();

    // Back spikes
    ctx.fillStyle = SPIKE_DARK;
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * 30 - 10, cy - 56);
        ctx.lineTo(cx + i * 30 + 10, cy - 56);
        ctx.lineTo(cx + i * 30, cy - 80);
        ctx.closePath();
        ctx.fill();
    }
    ctx.fillStyle = SPIKE;
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * 30 - 6, cy - 56);
        ctx.lineTo(cx + i * 30 + 6, cy - 56);
        ctx.lineTo(cx + i * 30, cy - 76);
        ctx.closePath();
        ctx.fill();
    }

    // Eyes (deep set under brow)
    ctx.fillStyle = BODY_DARK;
    ctx.fillRect(cx - 38, cy - 18, 76, 8);
    const eyeGlow = ctx.createRadialGradient(cx, cy - 14, 1, cx, cy - 14, 32);
    eyeGlow.addColorStop(0, 'rgba(255, 140, 64, 0.55)');
    eyeGlow.addColorStop(1, 'rgba(255, 140, 64, 0)');
    ctx.fillStyle = eyeGlow;
    ctx.fillRect(cx - 36, cy - 26, 72, 22);

    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(cx - 22, cy - 14, 7, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 22, cy - 14, 7, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#fff5d0';
    ctx.beginPath();
    ctx.arc(cx - 20, cy - 16, 2.5, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 24, cy - 16, 2.5, 0, TWO_PI);
    ctx.fill();

    // Lower fangs (jaw)
    ctx.fillStyle = FANG;
    for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * 10 - 3, cy + 30);
        ctx.lineTo(cx + i * 10 + 3, cy + 30);
        ctx.lineTo(cx + i * 10, cy + 46);
        ctx.closePath();
        ctx.fill();
    }

    return canvas;
}

// ─── Crawler ──────────────────────────────────────────────────────────

function drawCrawler(size, frame, count) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;

    const phase = (frame / count) * TWO_PI;
    const skitter = Math.sin(phase) * 4;

    const BODY = '#3d2c5e';
    const BODY_DARK = '#1c1432';
    const HIGHLIGHT = '#7a5cc8';
    const CLAW = '#1c1432';
    const EYE = '#ffeb47';

    softShadow(ctx, cx, cy + 36, 44, 8, 0.28);

    // Legs (alternate up/down)
    ctx.strokeStyle = BODY_DARK;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
        const yOff = -10 + i * 12;
        const sideSwing = (i % 2 === 0) ? skitter : -skitter;
        ctx.beginPath();
        ctx.moveTo(cx - 28, cy + yOff);
        ctx.lineTo(cx - 50, cy + yOff - 6 - sideSwing);
        ctx.lineTo(cx - 62, cy + yOff + 10 + sideSwing);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + 28, cy + yOff);
        ctx.lineTo(cx + 50, cy + yOff - 6 + sideSwing);
        ctx.lineTo(cx + 62, cy + yOff + 10 - sideSwing);
        ctx.stroke();
    }
    // Claws at leg tips
    ctx.fillStyle = CLAW;
    for (let i = 0; i < 3; i++) {
        const yOff = -10 + i * 12;
        const sideSwing = (i % 2 === 0) ? skitter : -skitter;
        ctx.beginPath();
        ctx.arc(cx - 62, cy + yOff + 10 + sideSwing, 3, 0, TWO_PI);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + 62, cy + yOff + 10 - sideSwing, 3, 0, TWO_PI);
        ctx.fill();
    }

    // Mandibles in front
    ctx.strokeStyle = CLAW;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy + 16);
    ctx.lineTo(cx - 16, cy + 28);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 8, cy + 16);
    ctx.lineTo(cx + 16, cy + 28);
    ctx.stroke();

    // Body (segmented look)
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, 40, 28, 0, 0, TWO_PI);
    ctx.fill();
    // Segment lines
    ctx.strokeStyle = BODY_DARK;
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * 12 - 4, cy - 14);
        ctx.quadraticCurveTo(cx + i * 12, cy + 6, cx + i * 12 - 4, cy + 26);
        ctx.stroke();
    }
    ctx.fillStyle = HIGHLIGHT;
    ctx.beginPath();
    ctx.ellipse(cx - 10, cy - 6, 16, 9, -0.2, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = BODY_DARK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, 40, 28, 0, 0, TWO_PI);
    ctx.stroke();

    // Glowing cluster of eyes
    const eyeGlow = ctx.createRadialGradient(cx, cy - 2, 1, cx, cy - 2, 18);
    eyeGlow.addColorStop(0, 'rgba(255, 235, 71, 0.45)');
    eyeGlow.addColorStop(1, 'rgba(255, 235, 71, 0)');
    ctx.fillStyle = eyeGlow;
    ctx.fillRect(cx - 18, cy - 12, 36, 24);

    ctx.fillStyle = EYE;
    const eyePositions = [
        [cx - 13, cy - 3],
        [cx + 13, cy - 3],
        [cx - 5, cy + 5],
        [cx + 5, cy + 5],
    ];
    for (const [ex, ey] of eyePositions) {
        ctx.beginPath();
        ctx.arc(ex, ey, 3, 0, TWO_PI);
        ctx.fill();
    }
    ctx.fillStyle = '#000';
    for (const [ex, ey] of eyePositions) {
        ctx.beginPath();
        ctx.arc(ex, ey, 1.4, 0, TWO_PI);
        ctx.fill();
    }

    return canvas;
}

// ─── Spitter (ranged) ─────────────────────────────────────────────────
// A bulbous purple sac with a puckered mouth + a charge dot that pulses
// across frames (telegraph-ish flavor).
function drawSpitter(size, frame, count) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const phase = (frame / count) * TWO_PI;
    const pulse = (Math.sin(phase) + 1) / 2;

    const BODY = '#6a3d8f';
    const BODY_DARK = '#3a1f52';
    const BODY_LIGHT = '#9a5ec4';
    const SAC = '#c479ff';
    const EYE = '#23103a';
    const MOUTH = '#1a0a28';
    const GLOW = '#d7a3ff';

    softShadow(ctx, cx, cy + 52, 50, 10, 0.3);

    // Body sac.
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, 54, 50, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = BODY_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx - 16, cy - 12, 24, 16, -0.3, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = BODY_DARK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, 54, 50, 0, 0, TWO_PI);
    ctx.stroke();

    // Venom blotches.
    ctx.fillStyle = SAC;
    ctx.beginPath();
    ctx.arc(cx + 22, cy + 18, 10, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - 26, cy + 22, 7, 0, TWO_PI);
    ctx.fill();

    // Eyes.
    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(cx - 15, cy - 4, 7, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 15, cy - 4, 7, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#e7c9ff';
    ctx.beginPath();
    ctx.arc(cx - 13, cy - 6, 2.4, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 17, cy - 6, 2.4, 0, TWO_PI);
    ctx.fill();

    // Puckered mouth with a pulsing charge bead.
    ctx.fillStyle = MOUTH;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 24, 12, 8, 0, 0, TWO_PI);
    ctx.fill();
    const bead = 3 + pulse * 5;
    const g = ctx.createRadialGradient(cx, cy + 24, 1, cx, cy + 24, bead + 3);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, GLOW);
    g.addColorStop(1, 'rgba(199,121,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy + 24, bead + 3, 0, TWO_PI);
    ctx.fill();

    return canvas;
}

// ─── Charger (dash) ───────────────────────────────────────────────────
// A low, armored ram with horns + braced legs. 2 frames: braced / lunging.
function drawCharger(size, frame) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const lunge = frame === 1 ? 8 : 0;

    const BODY = '#8a4a2a';
    const BODY_DARK = '#4a2410';
    const BODY_LIGHT = '#b06a38';
    const PLATE = '#3c352c';
    const PLATE_LIGHT = '#6e6354';
    const HORN = '#e6dcc4';
    const EYE = '#ff6a3a';

    softShadow(ctx, cx, cy + 58, 64, 12, 0.36);

    // Hind legs braced back.
    ctx.fillStyle = BODY_DARK;
    ctx.beginPath();
    ctx.ellipse(cx - 36, cy + 44, 12, 16, 0.3, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + 30, cy + 46, 12, 16, -0.2, 0, TWO_PI);
    ctx.fill();

    // Low heavy body, leaning forward when lunging.
    ctx.save();
    ctx.translate(lunge, 0);
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, 60, 44, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = BODY_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx - 14, cy - 8, 28, 14, -0.2, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = BODY_DARK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, 60, 44, 0, 0, TWO_PI);
    ctx.stroke();

    // Armored brow plate.
    ctx.fillStyle = PLATE;
    ctx.beginPath();
    ctx.moveTo(cx + 18, cy - 22);
    ctx.lineTo(cx + 58, cy - 14);
    ctx.lineTo(cx + 58, cy + 8);
    ctx.lineTo(cx + 20, cy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = PLATE_LIGHT;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Forward-swept horns.
    ctx.fillStyle = HORN;
    ctx.beginPath();
    ctx.moveTo(cx + 50, cy - 12);
    ctx.lineTo(cx + 84, cy - 24);
    ctx.lineTo(cx + 60, cy - 4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 52, cy + 6);
    ctx.lineTo(cx + 86, cy + 4);
    ctx.lineTo(cx + 60, cy + 14);
    ctx.closePath();
    ctx.fill();

    // Glaring eye.
    const eyeGlow = ctx.createRadialGradient(cx + 40, cy - 6, 1, cx + 40, cy - 6, 16);
    eyeGlow.addColorStop(0, 'rgba(255,120,60,0.6)');
    eyeGlow.addColorStop(1, 'rgba(255,120,60,0)');
    ctx.fillStyle = eyeGlow;
    ctx.fillRect(cx + 26, cy - 20, 28, 28);
    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(cx + 40, cy - 6, 5, 0, TWO_PI);
    ctx.fill();
    ctx.restore();

    return canvas;
}

// ─── Bosses ───────────────────────────────────────────────────────────

function drawVinebackGoliath(size, frame) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;

    // Idle pulse: frame 0 = base, frame 1 = vines flex slightly.
    const pulse = frame === 0 ? 0 : 1;
    const vineFlex = pulse * 3;

    const BODY = '#2d6b3f';
    const BODY_DARK = '#102818';
    const BODY_LIGHT = '#56a566';
    const STONE = '#46423a';
    const STONE_LIGHT = '#827c6e';
    const VINE = '#5a3c1e';
    const VINE_DARK = '#2a1a08';
    const LEAF = '#83b94a';
    const LEAF_DARK = '#3e5d22';
    const EYE = '#ffeb47';
    const FANG = '#fffae0';

    softShadow(ctx, cx, cy + 80, 86, 18, 0.45);

    // Stone shoulder spikes
    for (let i = -1; i <= 1; i += 2) {
        ctx.fillStyle = STONE;
        ctx.beginPath();
        ctx.moveTo(cx + i * 50, cy - 20);
        ctx.lineTo(cx + i * 70, cy - 60);
        ctx.lineTo(cx + i * 78, cy - 18);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = STONE_LIGHT;
        ctx.beginPath();
        ctx.moveTo(cx + i * 55, cy - 24);
        ctx.lineTo(cx + i * 68, cy - 54);
        ctx.lineTo(cx + i * 70, cy - 28);
        ctx.closePath();
        ctx.fill();
    }

    // Body
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 5, 82, 76, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = BODY_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx - 22, cy - 22, 38, 24, -0.3, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = BODY_DARK;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 5, 82, 76, 0, 0, TWO_PI);
    ctx.stroke();

    // Stone plates on chest
    ctx.fillStyle = STONE;
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * 28 - 12, cy + 24);
        ctx.lineTo(cx + i * 28 + 12, cy + 24);
        ctx.lineTo(cx + i * 28 + 8, cy + 50);
        ctx.lineTo(cx + i * 28 - 8, cy + 50);
        ctx.closePath();
        ctx.fill();
    }
    ctx.strokeStyle = STONE_LIGHT;
    ctx.lineWidth = 1.5;
    for (let i = -1; i <= 1; i++) {
        ctx.strokeRect(cx + i * 28 - 10, cy + 26, 20, 22);
    }

    // Thorny vines wrapping body
    ctx.strokeStyle = VINE_DARK;
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 76, cy + 26);
    ctx.bezierCurveTo(
        cx - 30, cy - 24 - vineFlex,
        cx + 36, cy + 50 + vineFlex,
        cx + 76, cy - 6
    );
    ctx.stroke();
    ctx.strokeStyle = VINE;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(cx - 76, cy + 26);
    ctx.bezierCurveTo(
        cx - 30, cy - 24 - vineFlex,
        cx + 36, cy + 50 + vineFlex,
        cx + 76, cy - 6
    );
    ctx.stroke();

    ctx.strokeStyle = VINE_DARK;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(cx - 60, cy - 32);
    ctx.bezierCurveTo(
        cx - 20, cy + 50 + vineFlex,
        cx + 40, cy - 50 - vineFlex,
        cx + 68, cy + 24
    );
    ctx.stroke();
    ctx.strokeStyle = VINE;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx - 60, cy - 32);
    ctx.bezierCurveTo(
        cx - 20, cy + 50 + vineFlex,
        cx + 40, cy - 50 - vineFlex,
        cx + 68, cy + 24
    );
    ctx.stroke();

    // Thorns
    ctx.fillStyle = VINE_DARK;
    const thorns = [
        [cx - 36, cy - 10], [cx + 18, cy + 36], [cx + 48, cy - 24],
        [cx - 8, cy + 40], [cx - 30, cy + 8], [cx + 32, cy - 8],
    ];
    for (const [tx, ty] of thorns) {
        ctx.beginPath();
        ctx.moveTo(tx - 3, ty);
        ctx.lineTo(tx, ty - 7);
        ctx.lineTo(tx + 3, ty);
        ctx.closePath();
        ctx.fill();
    }

    // Leaves
    const leafPositions = [
        [cx - 44, cy - 6, 0.4],
        [cx + 22, cy + 36, -0.3],
        [cx + 54, cy - 24, 0.7],
        [cx - 12, cy + 44, 0.2],
        [cx + 12, cy - 20, -0.6],
    ];
    for (const [lx, ly, rot] of leafPositions) {
        ctx.fillStyle = LEAF_DARK;
        ctx.beginPath();
        ctx.ellipse(lx + 1, ly + 1, 14, 7, rot, 0, TWO_PI);
        ctx.fill();
        ctx.fillStyle = LEAF;
        ctx.beginPath();
        ctx.ellipse(lx, ly, 14, 7, rot, 0, TWO_PI);
        ctx.fill();
    }

    // Eye glow
    const eyeGlow = ctx.createRadialGradient(cx, cy - 16, 1, cx, cy - 16, 38);
    eyeGlow.addColorStop(0, `rgba(255, 235, 71, ${0.4 + pulse * 0.2})`);
    eyeGlow.addColorStop(1, 'rgba(255, 235, 71, 0)');
    ctx.fillStyle = eyeGlow;
    ctx.fillRect(cx - 40, cy - 32, 80, 32);

    ctx.fillStyle = EYE;
    const eyePositions = [
        [cx - 28, cy - 12],
        [cx, cy - 22],
        [cx + 28, cy - 12],
    ];
    for (const [ex, ey] of eyePositions) {
        ctx.beginPath();
        ctx.arc(ex, ey, 9 + pulse * 0.8, 0, TWO_PI);
        ctx.fill();
    }
    ctx.fillStyle = '#000';
    for (const [ex, ey] of eyePositions) {
        ctx.beginPath();
        ctx.arc(ex, ey, 3.5, 0, TWO_PI);
        ctx.fill();
    }

    // Mouth
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy + 18, 22, 0, Math.PI);
    ctx.stroke();
    ctx.fillStyle = '#1a0a08';
    ctx.beginPath();
    ctx.arc(cx, cy + 18, 20, 0.1, Math.PI - 0.1);
    ctx.fill();

    // Fangs
    ctx.fillStyle = FANG;
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * 16 - 5, cy + 22);
        ctx.lineTo(cx + i * 16 + 5, cy + 22);
        ctx.lineTo(cx + i * 16, cy + 42);
        ctx.closePath();
        ctx.fill();
    }

    return canvas;
}

function drawStormwingAlpha(size, frame, count) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;

    const phase = (frame / count) * TWO_PI;
    const flap = Math.cos(phase);
    const wingScale = 0.75 + flap * 0.25;
    const wingY = -flap * 12;

    const WING_DARK = '#0c0820';
    const WING = '#1a1438';
    const WING_EDGE = '#5b4690';
    const BODY = '#2c1c4a';
    const BODY_LIGHT = '#503884';
    const EYE = '#ff3060';
    const FANG = '#fffadc';
    const LIGHT = '#a8e0ff';
    const LIGHT_BRIGHT = '#ffffff';

    softShadow(ctx, cx, cy + 60, 54, 12, 0.4);

    // Storm aura cloud
    const auraGrad = ctx.createRadialGradient(cx, cy + 4, 10, cx, cy + 4, 96);
    auraGrad.addColorStop(0, 'rgba(120, 180, 255, 0.18)');
    auraGrad.addColorStop(1, 'rgba(120, 180, 255, 0)');
    ctx.fillStyle = auraGrad;
    ctx.fillRect(0, 0, size, size);

    // Wings
    function wing(side) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(side, 1);
        ctx.fillStyle = WING_DARK;
        ctx.beginPath();
        ctx.moveTo(6, -2);
        ctx.quadraticCurveTo(64 * wingScale, -64 * wingScale + wingY, 102 * wingScale, -6 + wingY);
        ctx.quadraticCurveTo(86 * wingScale, 4 + wingY, 72 * wingScale, 4);
        ctx.quadraticCurveTo(94 * wingScale, 22 + wingY * 0.4, 64 * wingScale, 34);
        ctx.quadraticCurveTo(36 * wingScale, 18, 14, 14);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = WING;
        ctx.beginPath();
        ctx.moveTo(12, 0);
        ctx.quadraticCurveTo(54 * wingScale, -50 * wingScale + wingY, 88 * wingScale, -4 + wingY);
        ctx.quadraticCurveTo(66 * wingScale, 4 + wingY, 56 * wingScale, 8);
        ctx.quadraticCurveTo(30 * wingScale, 12, 16, 12);
        ctx.closePath();
        ctx.fill();
        // Lightning veins on wing membrane
        ctx.strokeStyle = LIGHT;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(14, 2);
        ctx.lineTo(40 * wingScale, -16 + wingY);
        ctx.lineTo(56 * wingScale, -4 + wingY);
        ctx.lineTo(78 * wingScale, -10 + wingY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(14, 6);
        ctx.lineTo(36 * wingScale, 12);
        ctx.lineTo(58 * wingScale, 18);
        ctx.stroke();
        // Bone strut
        ctx.strokeStyle = WING_EDGE;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(96 * wingScale, -6 + wingY);
        ctx.stroke();
        ctx.restore();
    }
    wing(-1);
    wing(1);

    // Body
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, 32, 42, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = BODY_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx - 6, cy - 6, 12, 20, -0.2, 0, TWO_PI);
    ctx.fill();

    // Crown spikes
    ctx.fillStyle = BODY;
    for (let i = -2; i <= 2; i++) {
        const h = 18 - Math.abs(i) * 3;
        ctx.beginPath();
        ctx.moveTo(cx + i * 8 - 4, cy - 32);
        ctx.lineTo(cx + i * 8 + 4, cy - 32);
        ctx.lineTo(cx + i * 8, cy - 32 - h);
        ctx.closePath();
        ctx.fill();
    }

    // Ears
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.moveTo(cx - 18, cy - 28);
    ctx.lineTo(cx - 10, cy - 56);
    ctx.lineTo(cx - 2, cy - 28);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 18, cy - 28);
    ctx.lineTo(cx + 10, cy - 56);
    ctx.lineTo(cx + 2, cy - 28);
    ctx.closePath();
    ctx.fill();

    // Eye glow
    const eyeGlow = ctx.createRadialGradient(cx, cy - 10, 1, cx, cy - 10, 24);
    eyeGlow.addColorStop(0, 'rgba(255, 60, 120, 0.55)');
    eyeGlow.addColorStop(1, 'rgba(255, 60, 120, 0)');
    ctx.fillStyle = eyeGlow;
    ctx.fillRect(cx - 22, cy - 22, 44, 30);

    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(cx - 12, cy - 10, 7.5, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 12, cy - 10, 7.5, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx - 10, cy - 12, 2.6, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 14, cy - 12, 2.6, 0, TWO_PI);
    ctx.fill();

    // Fangs
    ctx.fillStyle = FANG;
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy + 8);
    ctx.lineTo(cx - 4, cy + 22);
    ctx.lineTo(cx - 1, cy + 8);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 9, cy + 8);
    ctx.lineTo(cx + 4, cy + 22);
    ctx.lineTo(cx + 1, cy + 8);
    ctx.closePath();
    ctx.fill();

    // Lightning bolt arcs around body
    ctx.strokeStyle = LIGHT_BRIGHT;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 48, cy);
    ctx.lineTo(cx - 36, cy + 8);
    ctx.lineTo(cx - 42, cy + 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 48, cy - 4);
    ctx.lineTo(cx + 36, cy + 4);
    ctx.lineTo(cx + 42, cy + 16);
    ctx.stroke();
    ctx.strokeStyle = LIGHT;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(cx - 48, cy);
    ctx.lineTo(cx - 36, cy + 8);
    ctx.lineTo(cx - 42, cy + 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 48, cy - 4);
    ctx.lineTo(cx + 36, cy + 4);
    ctx.lineTo(cx + 42, cy + 16);
    ctx.stroke();
    ctx.strokeStyle = LIGHT_BRIGHT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 48, cy);
    ctx.lineTo(cx - 36, cy + 8);
    ctx.lineTo(cx - 42, cy + 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 48, cy - 4);
    ctx.lineTo(cx + 36, cy + 4);
    ctx.lineTo(cx + 42, cy + 16);
    ctx.stroke();

    return canvas;
}

// ─── Chest ────────────────────────────────────────────────────────────
// 3 frames: 0 closed, 1 mid-open, 2 fully open.

function drawChest(frame) {
    const W = 96;
    const H = 96;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const WOOD = '#7a4920';
    const WOOD_DARK = '#3a2410';
    const WOOD_LIGHT = '#a06430';
    const GOLD = '#ffd166';
    const GOLD_BRIGHT = '#fff5d0';
    const GOLD_DARK = '#7a5018';

    softShadow(ctx, W / 2, H - 8, W / 2 - 8, 6, 0.36);

    // Body
    ctx.fillStyle = WOOD;
    ctx.fillRect(8, 50, W - 16, H - 56);
    ctx.fillStyle = WOOD_LIGHT;
    ctx.fillRect(8, 50, 6, H - 56);
    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(W - 14, 50, 6, H - 56);
    ctx.strokeStyle = WOOD_DARK;
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 50, W - 16, H - 56);

    // Wood grain (a few faint vertical strokes)
    ctx.strokeStyle = 'rgba(58, 36, 16, 0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
        const x = 14 + i * 14;
        ctx.beginPath();
        ctx.moveTo(x, 54);
        ctx.lineTo(x + 1, H - 12);
        ctx.stroke();
    }

    // Lid pivots around the back edge. Closed = -0, mid = -0.55, open = -1.05 rad.
    const lidAngle = frame === 0 ? 0 : (frame === 1 ? -0.6 : -1.1);

    ctx.save();
    ctx.translate(8, 50);
    ctx.rotate(lidAngle);
    // Lid (curved top)
    ctx.fillStyle = WOOD;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -18);
    ctx.quadraticCurveTo((W - 16) / 2, -36, W - 16, -18);
    ctx.lineTo(W - 16, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = WOOD_DARK;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Highlight stripe on lid curve
    ctx.strokeStyle = WOOD_LIGHT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(4, -8);
    ctx.quadraticCurveTo((W - 16) / 2, -28, W - 20, -8);
    ctx.stroke();

    // Gold band on lid bottom edge
    ctx.fillStyle = GOLD;
    ctx.fillRect(0, -6, W - 16, 6);
    ctx.strokeStyle = GOLD_DARK;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, -6, W - 16, 6);

    // Vertical gold strap (lid portion)
    ctx.fillStyle = GOLD;
    ctx.fillRect((W - 16) / 2 - 4, -28, 8, 28);
    ctx.strokeStyle = GOLD_DARK;
    ctx.strokeRect((W - 16) / 2 - 4, -28, 8, 28);

    // Lock (only visible when closed)
    if (frame === 0) {
        ctx.fillStyle = GOLD;
        ctx.beginPath();
        ctx.arc((W - 16) / 2, 2, 7, 0, TWO_PI);
        ctx.fill();
        ctx.strokeStyle = GOLD_DARK;
        ctx.stroke();
        ctx.fillStyle = WOOD_DARK;
        ctx.fillRect((W - 16) / 2 - 1.5, 0, 3, 6);
    }
    ctx.restore();

    // Vertical gold strap (body portion)
    ctx.fillStyle = GOLD;
    ctx.fillRect(W / 2 - 4, 50, 8, H - 56);
    ctx.strokeStyle = GOLD_DARK;
    ctx.strokeRect(W / 2 - 4, 50, 8, H - 56);

    // When open, draw glowing contents.
    if (frame >= 1) {
        const openness = frame === 1 ? 0.5 : 1;
        const glow = ctx.createRadialGradient(W / 2, 50, 2, W / 2, 50, 36);
        glow.addColorStop(0, `rgba(255, 245, 200, ${0.85 * openness})`);
        glow.addColorStop(0.6, `rgba(255, 209, 102, ${0.5 * openness})`);
        glow.addColorStop(1, 'rgba(255, 200, 50, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(W / 2 - 36, 14, 72, 50);

        // A small treasure peek (coin + gem) inside
        if (frame === 2) {
            ctx.fillStyle = GOLD_BRIGHT;
            ctx.beginPath();
            ctx.arc(W / 2 - 6, 52, 5, 0, TWO_PI);
            ctx.fill();
            ctx.fillStyle = GOLD;
            ctx.beginPath();
            ctx.arc(W / 2 + 6, 54, 4, 0, TWO_PI);
            ctx.fill();
            ctx.fillStyle = '#4ec1ff';
            ctx.beginPath();
            ctx.moveTo(W / 2, 48);
            ctx.lineTo(W / 2 + 4, 54);
            ctx.lineTo(W / 2, 60);
            ctx.lineTo(W / 2 - 4, 54);
            ctx.closePath();
            ctx.fill();
        }
    }

    return canvas;
}

// ─── Coin (spin frames) ───────────────────────────────────────────────

function drawCoin(frame, count) {
    const W = 32;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = W;
    const ctx = canvas.getContext('2d');
    const cx = W / 2;
    const cy = W / 2;

    const phase = (frame / count) * TWO_PI;
    // Coin spins around vertical axis — squashes horizontally.
    const squashX = Math.abs(Math.cos(phase));
    const r = 12;

    // Glow
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, W / 2);
    glow.addColorStop(0, '#fff5d0');
    glow.addColorStop(0.55, 'rgba(255, 209, 102, 0.7)');
    glow.addColorStop(1, 'rgba(255, 200, 50, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, W);

    // Coin disk (squashed for spin)
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * Math.max(0.18, squashX), r, 0, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = '#a07530';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Front-face details only when mostly facing camera.
    if (squashX > 0.55) {
        ctx.fillStyle = '#fff5d0';
        ctx.beginPath();
        ctx.ellipse(cx - 2, cy - 3, 4 * squashX, 3, 0, 0, TWO_PI);
        ctx.fill();
        ctx.strokeStyle = '#a07530';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 7 * squashX, 7, 0, 0, TWO_PI);
        ctx.stroke();
        // Star symbol
        ctx.fillStyle = '#a07530';
        ctx.beginPath();
        const starR = 3.5 * squashX;
        for (let i = 0; i < 5; i++) {
            const a = -Math.PI / 2 + i * (TWO_PI / 5);
            const px = cx + Math.cos(a) * starR;
            const py = cy + Math.sin(a) * starR;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
    } else {
        // Edge view: bright vertical glint
        ctx.fillStyle = '#fff5d0';
        ctx.fillRect(cx - 1, cy - 8, 2, 16);
    }

    return canvas;
}

// ─── Projectile ───────────────────────────────────────────────────────

function drawProjectile() {
    const W = 56;
    const H = 28;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Outer aura
    const aura = ctx.createRadialGradient(W / 2, H / 2, 2, W / 2, H / 2, W / 2);
    aura.addColorStop(0, 'rgba(255, 240, 130, 1)');
    aura.addColorStop(0.45, 'rgba(255, 170, 60, 0.65)');
    aura.addColorStop(1, 'rgba(255, 90, 0, 0)');
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, W, H);

    // Trail behind (left side, since projectile points right)
    const trail = ctx.createLinearGradient(0, H / 2, W / 2, H / 2);
    trail.addColorStop(0, 'rgba(255, 200, 80, 0)');
    trail.addColorStop(1, 'rgba(255, 220, 120, 0.55)');
    ctx.fillStyle = trail;
    ctx.beginPath();
    ctx.ellipse(W / 2 - 10, H / 2, 18, 4, 0, 0, TWO_PI);
    ctx.fill();

    // Brighter head
    ctx.fillStyle = '#fff8d0';
    ctx.beginPath();
    ctx.ellipse(W / 2 + 4, H / 2, 12, 6, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#fffce8';
    ctx.beginPath();
    ctx.ellipse(W / 2 + 6, H / 2, 5, 3, 0, 0, TWO_PI);
    ctx.fill();

    // Small arcane sparks around the head
    ctx.strokeStyle = 'rgba(255, 250, 200, 0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(W / 2 + 14, H / 2 - 6);
    ctx.lineTo(W / 2 + 18, H / 2 - 2);
    ctx.moveTo(W / 2 + 16, H / 2 + 5);
    ctx.lineTo(W / 2 + 12, H / 2 + 9);
    ctx.stroke();

    return canvas;
}

// Ember Wisp bolt: a warm orange flame-mote with a trailing ember tail.
// Same canvas shape/orientation as the arcane bolt (points +x) so it rotates
// the same way in Projectile.draw.
function drawEmberWisp() {
    const W = 56;
    const H = 28;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Outer fire aura.
    const aura = ctx.createRadialGradient(W / 2, H / 2, 2, W / 2, H / 2, W / 2);
    aura.addColorStop(0, 'rgba(255, 230, 150, 1)');
    aura.addColorStop(0.4, 'rgba(255, 122, 51, 0.7)');
    aura.addColorStop(1, 'rgba(200, 40, 0, 0)');
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, W, H);

    // Trailing ember tail (left side).
    const trail = ctx.createLinearGradient(0, H / 2, W / 2, H / 2);
    trail.addColorStop(0, 'rgba(255, 90, 0, 0)');
    trail.addColorStop(1, 'rgba(255, 150, 60, 0.6)');
    ctx.fillStyle = trail;
    ctx.beginPath();
    ctx.ellipse(W / 2 - 12, H / 2, 20, 5, 0, 0, TWO_PI);
    ctx.fill();

    // Bright core.
    ctx.fillStyle = '#ffd9a0';
    ctx.beginPath();
    ctx.ellipse(W / 2 + 4, H / 2, 11, 6, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#fff4dc';
    ctx.beginPath();
    ctx.ellipse(W / 2 + 6, H / 2, 5, 3, 0, 0, TWO_PI);
    ctx.fill();

    return canvas;
}

// ─── XP Gem ──────────────────────────────────────────────────────────

function drawXPGem(tier) {
    const SIZES = { small: 30, medium: 38, large: 46 };
    const COLORS = {
        small:  { base: '#4ec1ff', light: '#dff3ff', dark: '#1e6fa8' },
        medium: { base: '#5fe87a', light: '#d4f9d8', dark: '#1f7a35' },
        large:  { base: '#ff5566', light: '#ffd0d6', dark: '#8a1d28' },
    };
    const size = SIZES[tier] ?? SIZES.small;
    const c = COLORS[tier] ?? COLORS.small;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2;

    // Outer glow (larger tiers glow more)
    const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
    glow.addColorStop(0, c.light);
    glow.addColorStop(0.45, c.base + 'cc');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    // Faceted diamond body
    const dx = r * 0.72;
    const dy = r * 0.88;
    ctx.fillStyle = c.base;
    ctx.beginPath();
    ctx.moveTo(cx, cy - dy);
    ctx.lineTo(cx + dx, cy - dy * 0.2);
    ctx.lineTo(cx + dx * 0.6, cy + dy);
    ctx.lineTo(cx - dx * 0.6, cy + dy);
    ctx.lineTo(cx - dx, cy - dy * 0.2);
    ctx.closePath();
    ctx.fill();

    // Bright top facet
    ctx.fillStyle = c.light;
    ctx.beginPath();
    ctx.moveTo(cx, cy - dy);
    ctx.lineTo(cx + dx * 0.5, cy - dy * 0.2);
    ctx.lineTo(cx, cy - dy * 0.05);
    ctx.lineTo(cx - dx * 0.5, cy - dy * 0.2);
    ctx.closePath();
    ctx.fill();

    // Side facets darker
    ctx.fillStyle = c.dark;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(cx + dx * 0.6, cy + dy);
    ctx.lineTo(cx + dx, cy - dy * 0.2);
    ctx.lineTo(cx, cy - dy * 0.05);
    ctx.lineTo(cx, cy + dy);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Edges
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - dy);
    ctx.lineTo(cx + dx, cy - dy * 0.2);
    ctx.lineTo(cx + dx * 0.6, cy + dy);
    ctx.lineTo(cx - dx * 0.6, cy + dy);
    ctx.lineTo(cx - dx, cy - dy * 0.2);
    ctx.closePath();
    ctx.stroke();

    // Sparkle
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx - dx * 0.3, cy - dy * 0.45, 1.8, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + dx * 0.1, cy - dy * 0.1, 1.2, 0, TWO_PI);
    ctx.fill();

    return canvas;
}

// ─── Ground tile ─────────────────────────────────────────────────────

function tileRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Soft white radial light mask. Center fully opaque (full reveal) with a
// gentle plateau, falling to transparent at the edge.
function drawLightMask(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const r = size / 2;
    const g = ctx.createRadialGradient(r, r, 1, r, r, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.82)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(r, r, r, 0, TWO_PI);
    ctx.fill();
    return canvas;
}

// Colored radial glow (opaque-ish color center → transparent). Drawn with
// 'lighter' for additive bloom + particles; intensity comes from the
// caller's globalAlpha so the same sprite serves every brightness.
function drawGlow(size, color) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const r = size / 2;
    const g = ctx.createRadialGradient(r, r, 1, r, r, r);
    g.addColorStop(0, color);
    g.addColorStop(0.4, hexToRgba(color, 0.55));
    g.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(r, r, r, 0, TWO_PI);
    ctx.fill();
    return canvas;
}

// #rrggbb (or #rgb) → rgba() string at the given alpha.
function hexToRgba(hex, a) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function drawGroundTile(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Regraded for the dark-fantasy dusk: deeper, slightly cooler base with
    // a touch more contrast so lit areas pop under the darkness veil while
    // unlit ground reads as near-black jungle floor.
    const BASE = '#101b16';
    const BASE_LIGHT = '#1a2b21';
    const SPECK = '#27402f';
    const SPECK_DARK = '#080f0b';
    const MOSS = '#2f5037';

    ctx.fillStyle = BASE;
    ctx.fillRect(0, 0, size, size);

    const grad = ctx.createRadialGradient(
        size * 0.35, size * 0.45, size * 0.05,
        size * 0.35, size * 0.45, size * 0.85
    );
    grad.addColorStop(0, BASE_LIGHT);
    grad.addColorStop(1, BASE);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const rng = tileRng(1337);
    for (let i = 0; i < 50; i++) {
        const x = rng() * size;
        const y = rng() * size;
        const r = 0.6 + rng() * 1.4;
        ctx.fillStyle = SPECK;
        ctx.fillRect(x, y, r, r);
    }
    for (let i = 0; i < 28; i++) {
        const x = rng() * size;
        const y = rng() * size;
        const r = 0.8 + rng() * 1.6;
        ctx.fillStyle = SPECK_DARK;
        ctx.fillRect(x, y, r, r);
    }
    for (let i = 0; i < 6; i++) {
        const x = rng() * size;
        const y = rng() * size;
        const r = 3 + rng() * 5;
        ctx.fillStyle = MOSS;
        ctx.globalAlpha = 0.35 + rng() * 0.3;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TWO_PI);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    return canvas;
}

// ─── Decorations (rock, mushroom, skull, …) ───────────────────────────

function drawDecoration(type) {
    switch (type) {
        case 'rock':         return drawRock();
        case 'mushroom':     return drawMushroom();
        case 'skull':        return drawSkull();
        case 'grass':        return drawGrass();
        case 'candle':       return drawCandle();
        case 'ruin':         return drawRuin();
        case 'branch':       return drawBranch();
        case 'crackedStone': return drawCrackedStone();
        case 'bones':        return drawBones();
        default:             return drawRock();
    }
}

function newDecCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
}

function drawRock() {
    const W = 56, H = 44;
    const canvas = newDecCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const cx = W / 2, cy = H * 0.62;

    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(cx, H - 4, 22, 4, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#3a4148';
    ctx.beginPath();
    ctx.moveTo(cx - 22, cy + 6);
    ctx.lineTo(cx - 16, cy - 12);
    ctx.lineTo(cx - 2, cy - 16);
    ctx.lineTo(cx + 14, cy - 10);
    ctx.lineTo(cx + 22, cy + 4);
    ctx.lineTo(cx + 16, cy + 12);
    ctx.lineTo(cx - 14, cy + 12);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#52595f';
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy - 4);
    ctx.lineTo(cx - 10, cy - 12);
    ctx.lineTo(cx + 2, cy - 14);
    ctx.lineTo(cx + 4, cy - 6);
    ctx.lineTo(cx - 8, cy - 2);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#1d2226';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 22, cy + 6);
    ctx.lineTo(cx - 16, cy - 12);
    ctx.lineTo(cx - 2, cy - 16);
    ctx.lineTo(cx + 14, cy - 10);
    ctx.lineTo(cx + 22, cy + 4);
    ctx.lineTo(cx + 16, cy + 12);
    ctx.lineTo(cx - 14, cy + 12);
    ctx.closePath();
    ctx.stroke();

    return canvas;
}

function drawMushroom() {
    const W = 38, H = 44;
    const canvas = newDecCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const cx = W / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, H - 3, 12, 3, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#e6e3d0';
    ctx.fillRect(cx - 4, H - 22, 8, 18);

    ctx.fillStyle = '#b3372d';
    ctx.beginPath();
    ctx.ellipse(cx, H - 22, 16, 12, 0, Math.PI, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#761d1a';
    ctx.beginPath();
    ctx.ellipse(cx, H - 22, 16, 12, 0, Math.PI, TWO_PI);
    ctx.closePath();
    ctx.strokeStyle = '#761d1a';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#fff6dd';
    const dots = [[cx - 7, H - 26], [cx + 6, H - 28], [cx, H - 22], [cx - 3, H - 31]];
    for (const [dx, dy] of dots) {
        ctx.beginPath();
        ctx.arc(dx, dy, 2.2, 0, TWO_PI);
        ctx.fill();
    }

    return canvas;
}

function drawSkull() {
    const W = 36, H = 30;
    const canvas = newDecCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const cx = W / 2, cy = H / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx, H - 3, 12, 3, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#dcd2b8';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 2, 13, 11, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillRect(cx - 8, cy + 7, 16, 4);

    ctx.fillStyle = '#1a1410';
    ctx.beginPath();
    ctx.arc(cx - 4, cy - 2, 2.6, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 4, cy - 2, 2.6, 0, TWO_PI);
    ctx.fill();

    ctx.strokeStyle = '#1a1410';
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * 3, cy + 7);
        ctx.lineTo(cx + i * 3, cy + 11);
        ctx.stroke();
    }

    return canvas;
}

function drawGrass() {
    const W = 32, H = 26;
    const canvas = newDecCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const blades = [
        { x: 6,  h: 16, color: '#3b6b40' },
        { x: 12, h: 22, color: '#4d8a52' },
        { x: 17, h: 18, color: '#3b6b40' },
        { x: 22, h: 24, color: '#4d8a52' },
        { x: 27, h: 14, color: '#2f5634' },
    ];
    ctx.lineCap = 'round';
    for (const b of blades) {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(b.x, H - 2);
        ctx.quadraticCurveTo(b.x + 2, H - b.h * 0.5, b.x + 4, H - b.h);
        ctx.stroke();
    }

    return canvas;
}

function drawCandle() {
    const W = 28, H = 50;
    const canvas = newDecCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const cx = W / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, H - 3, 8, 3, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#3a3530';
    ctx.fillRect(cx - 7, H - 12, 14, 10);
    ctx.strokeStyle = '#1c1a17';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(cx - 7, H - 12, 14, 10);

    ctx.fillStyle = '#e6dcc4';
    ctx.fillRect(cx - 3, H - 30, 6, 18);
    ctx.fillStyle = '#a99a6f';
    ctx.fillRect(cx - 3, H - 30, 1.5, 18);

    ctx.fillStyle = '#1a1410';
    ctx.fillRect(cx - 0.5, H - 34, 1, 4);

    const grad = ctx.createRadialGradient(cx, H - 36, 1, cx, H - 36, 8);
    grad.addColorStop(0, '#fff5b5');
    grad.addColorStop(0.55, 'rgba(255, 180, 60, 0.85)');
    grad.addColorStop(1, 'rgba(255, 120, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - 8, H - 46, 16, 16);

    ctx.fillStyle = '#ffb74a';
    ctx.beginPath();
    ctx.ellipse(cx, H - 37, 2, 4, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#fff5d0';
    ctx.beginPath();
    ctx.ellipse(cx, H - 36, 1, 2.4, 0, 0, TWO_PI);
    ctx.fill();

    return canvas;
}

function drawRuin() {
    const W = 64, H = 44;
    const canvas = newDecCanvas(W, H);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(W / 2, H - 4, 26, 4, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#6e6354';
    ctx.fillRect(10, H - 30, 12, 26);
    ctx.fillRect(42, H - 22, 12, 18);

    ctx.fillStyle = '#494033';
    ctx.fillRect(10, H - 30, 3, 26);
    ctx.fillRect(42, H - 22, 3, 18);

    ctx.strokeStyle = '#2c2620';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(10, H - 30, 12, 26);
    ctx.strokeRect(42, H - 22, 12, 18);

    ctx.fillStyle = '#7a6e5c';
    ctx.beginPath();
    ctx.moveTo(8, H - 30);
    ctx.lineTo(12, H - 35);
    ctx.lineTo(20, H - 33);
    ctx.lineTo(24, H - 30);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(40, H - 22);
    ctx.lineTo(46, H - 27);
    ctx.lineTo(52, H - 25);
    ctx.lineTo(56, H - 22);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#5e5446';
    ctx.beginPath();
    ctx.moveTo(26, H - 10);
    ctx.lineTo(30, H - 16);
    ctx.lineTo(38, H - 14);
    ctx.lineTo(40, H - 6);
    ctx.lineTo(28, H - 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2c2620';
    ctx.stroke();

    return canvas;
}

function drawBranch() {
    const W = 56, H = 18;
    const canvas = newDecCanvas(W, H);
    const ctx = canvas.getContext('2d');

    ctx.strokeStyle = '#2c1f12';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(4, H - 6);
    ctx.bezierCurveTo(16, H - 14, 36, H - 2, W - 4, H - 8);
    ctx.stroke();

    ctx.strokeStyle = '#5a3c1e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(4, H - 6);
    ctx.bezierCurveTo(16, H - 14, 36, H - 2, W - 4, H - 8);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, H - 8);
    ctx.lineTo(24, H - 16);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(36, H - 6);
    ctx.lineTo(40, H - 14);
    ctx.stroke();

    return canvas;
}

function drawCrackedStone() {
    const W = 46, H = 32;
    const canvas = newDecCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const cx = W / 2, cy = H * 0.62;

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx, H - 3, 18, 3, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#646058';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 18, 9, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#7a766c';
    ctx.beginPath();
    ctx.ellipse(cx - 4, cy - 3, 10, 4, -0.2, 0, TWO_PI);
    ctx.fill();

    ctx.strokeStyle = '#2c2a25';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 18, 9, 0, 0, TWO_PI);
    ctx.stroke();

    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy - 2);
    ctx.lineTo(cx - 2, cy + 1);
    ctx.lineTo(cx + 4, cy - 1);
    ctx.lineTo(cx + 10, cy + 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 2, cy - 4);
    ctx.lineTo(cx + 4, cy - 1);
    ctx.lineTo(cx + 6, cy + 4);
    ctx.stroke();

    return canvas;
}

function drawBones() {
    const W = 44, H = 22;
    const canvas = newDecCanvas(W, H);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.beginPath();
    ctx.ellipse(W / 2, H - 3, 16, 3, 0, 0, TWO_PI);
    ctx.fill();

    ctx.save();
    ctx.translate(14, H - 9);
    ctx.rotate(-0.3);
    ctx.fillStyle = '#e6dcc4';
    ctx.fillRect(-9, -2.5, 18, 5);
    ctx.beginPath();
    ctx.arc(-9, -1, 3, 0, TWO_PI);
    ctx.arc(-9, 1, 3, 0, TWO_PI);
    ctx.arc(9, -1, 3, 0, TWO_PI);
    ctx.arc(9, 1, 3, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = '#8a7e62';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(7, 0);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(30, H - 7);
    ctx.rotate(0.4);
    ctx.fillStyle = '#e6dcc4';
    ctx.fillRect(-7, -2, 14, 4);
    ctx.beginPath();
    ctx.arc(-7, -1, 2.5, 0, TWO_PI);
    ctx.arc(-7, 1, 2.5, 0, TWO_PI);
    ctx.arc(7, -1, 2.5, 0, TWO_PI);
    ctx.arc(7, 1, 2.5, 0, TWO_PI);
    ctx.fill();
    ctx.restore();

    return canvas;
}
