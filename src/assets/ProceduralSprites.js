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

import { SPRITE_SIZE, SPRITE_SS, SPRITE_FX, MAP, GEM_TIERS, LIGHT_COLORS } from '../config/GameConfig.js';
import { TWO_PI } from '../core/MathUtils.js';
// LPC character frames (imported playable bodies). Only called at runtime, so
// the ProceduralSprites ↔ LpcSprites import cycle is safe (live bindings).
import { getLpcFrames, isLpcLoaded } from './LpcSprites.js';
import { drawPixelMonkey, drawPixelHero } from './PixelArt.js';
import { getAiHeroFrames } from './HeroAiSprites.js';
import { getDecorSprite } from './DecorSprites.js';

const cache = new Map();

// Soft white radial used as a light cutout (drawn with 'destination-out'
// to carve holes in the darkness veil) and reused as a particle mask.
export function getLightMaskSprite() {
    if (cache.has('lightMask')) return cache.get('lightMask');
    const sprite = drawLightMask(256);
    cache.set('lightMask', sprite);
    return sprite;
}

// Cached soft contact-shadow blob (black radial → transparent). Stamped
// (via drawImage at a flattened ellipse aspect) under standing map
// decorations so props feel grounded. Built once; no per-frame gradient.
export function getSoftShadowSprite() {
    if (cache.has('softShadowBlob')) return cache.get('softShadowBlob');
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const r = size / 2;
    const g = ctx.createRadialGradient(r, r, 1, r, r, r);
    g.addColorStop(0, 'rgba(0,0,0,0.6)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(r, r, r, 0, TWO_PI);
    ctx.fill();
    cache.set('softShadowBlob', canvas);
    return canvas;
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
    getHeroFrames('monkey');   // warm the default directional pose set at boot
    getSlimeFrames();
    getBatFrames();
    getBruteFrames();
    getCrawlerFrames();
    getVinebackGoliathFrames();
    getStormwingAlphaFrames();
    getGloomMawFrames();
    getSpitterFrames();
    getChargerFrames();
    getMiteFrames();
    getJuggernautFrames();
    getHealerFrames();
    getShielderFrames();
    getSpeedDemonFrames();
    getDreadhulkFrames();
    getBrawlerFrames();
    getRimewardenFrames();
    getHoarfangFrames();
    getAurorathFrames();
    getOssuarFrames();
    getMourndriftFrames();
    getNihagaultFrames();
    getDunescourgeFrames();
    getCindermawFrames();
    getSolnakhFrames();
    getChestFrames();
    getCoinFrames();
    getHealthOrbFrames();
    getProjectileSprite();
    getEmberWispSprite();
    getGroundTileSprite();
    for (const tier of GEM_TIERS) getXPGemSprite(tier);
    for (const type of MAP.decorationTypes) getDecorationSprite(type);
    // Lighting + particle masks/glows.
    getLightMaskSprite();
    getSoftShadowSprite();
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
    // Boss in-world aura halo (base + enraged) — prewarmed so the first
    // boss spawn never rasterizes a 128px glow mid-frame.
    '#b41f2e',
    // Ember-forge UI glows: the Mines overlay reveal/bust/multiplier blooms and
    // the HUD low-HP / level-up / coin / XP-comet glows, so the first juice
    // moment never rasterizes a 128px gradient mid-frame.
    '#ff7a1e', '#ffd06a', '#ffb257', '#ff8a3a', '#74e890', '#b6ffcf',
    '#fff1c8', '#ff5a4a', '#ffd86b',
    // Elite halo gold (the cached additive elite ring) so the first elite
    // spawn never rasterizes its 128px glow mid-frame.
    '#ffd166',
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
    // AI decor art first (baked at the exact logical×SPRITE_SS size, so the
    // footprint/shadow/light math is unchanged); procedural is the fallback.
    const sprite = getDecorSprite(type) || drawDecoration(type);
    cache.set(key, sprite);
    return sprite;
}

// Drop cached decoration sprites so the next getDecorationSprite rebuilds them
// — called after the AI decor PNGs finish loading (boot prewarm caches the
// procedural versions first).
export function clearDecorationCache() {
    for (const k of [...cache.keys()]) if (k.startsWith('dec:')) cache.delete(k);
}

// ── Player / monkey ───────────────────────────────────────────────────
// 4 frames: 0 idle, 1 / 3 walk extremes, 2 mid. Game picks by bobTimer.

export function getMonkeyFrames() {
    if (cache.has('monkeyFrames')) return cache.get('monkeyFrames');
    // Pixel-art Pyra (self-outlined) — matches the imported LPC pixel cast.
    const frames = [
        drawPixelMonkey(0), drawPixelMonkey(1), drawPixelMonkey(2), drawPixelMonkey(3),
    ];
    cache.set('monkeyFrames', frames);
    return frames;
}

// Back-compat: returns idle frame.
export function getMonkeySprite() {
    return getMonkeyFrames()[0];
}

// ── Directional pose frame model ─────────────────────────────────────────
// getHeroFrames returns a structured, cached set:
//   { kind, dirs: { down, up, side } }, each dir = { idle:[c], walk:[c,c,c],
//     cast:[c], hurt:[c] }.  `side` faces +x; callers flip it for left.
// Pixel heroes get full per-direction pose art; LPC heroes get directional
// walk built from their walk rows (cast/hurt reuse idle — Player adds the
// transform lean/recoil), so the imported bodies stay feasible without new art.
function buildPixelHeroSet(opts) {
    const mk = (dir) => ({
        // idle frame 1 = the goofy blink/tail-wag/ear-twitch beat (the Player
        // times it as a short blink inside a longer open-eyed hold).
        idle: [0, 1].map((f) => drawPixelHero(opts, dir, 'idle', f)),
        walk: [0, 1, 2].map((f) => drawPixelHero(opts, dir, 'walk', f)),
        cast: [drawPixelHero(opts, dir, 'cast', 0)],
        hurt: [drawPixelHero(opts, dir, 'hurt', 0)],
    });
    return { kind: 'pixel', dirs: { down: mk('down'), up: mk('up'), side: mk('side') } };
}

// Copy a canvas so addOutline (which mutates in place) never touches the
// SHARED cached LPC frames the enemies also draw.
function copyCanvas(src) {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
}

function buildLpcHeroSet(model) {
    const fr = getLpcFrames(model); // { up, left, down, right } of 8-frame walk arrays
    const O = (c) => addOutline(copyCanvas(c)); // outline a COPY — never the shared enemy canvas
    const pick = (arr) => {
        if (!arr || !arr.length) return null;
        const idle = O(arr[0]);
        return {
            idle: [idle],
            walk: [O(arr[2] || arr[0]), O(arr[4] || arr[0]), O(arr[6] || arr[0])],
            cast: [idle],
            hurt: [idle],
        };
    };
    const down = pick(fr.down);
    if (!down) return null;            // sheet failed → fall back to pixel set
    const up = pick(fr.up) || down;
    const side = pick(fr.right) || down; // side faces +x; Player flips for left
    return { kind: 'lpc', dirs: { down, up, side } };
}

export function getHeroFrames(id, char = null) {
    const key = `heroFrames:${id}`;
    if (cache.has(key)) return cache.get(key);
    let set = null;
    // Only use the LPC body if its sheet actually loaded; otherwise fall through
    // to the recolored pixel hero (NOT the brute stand-in getLpcFrames returns).
    if (char && char.lpc && char.lpcModel && isLpcLoaded(char.lpcModel)) set = buildLpcHeroSet(char.lpcModel);
    // Pixel-bodied heroes prefer the HQ AI body sheets (shared base + per-hero
    // tint/feature composite); null until loaded / on failure → procedural.
    if (!set) set = getAiHeroFrames(id, char);
    if (!set) {
        const opts = char ? { palette: char.palette, feature: char.feature, accent: char.accent } : {};
        set = buildPixelHeroSet(opts);
    }
    cache.set(key, set);
    return set;
}

// Drop cached hero frame sets so the next getHeroFrames rebuilds them — called
// after the AI hero sheets finish loading (boot prewarm may have cached the
// procedural sets first).
export function clearHeroFrameCache() {
    for (const k of [...cache.keys()]) if (k.startsWith('heroFrames:')) cache.delete(k);
}

// Flatten every unique frame canvas in a hero set (used for fur-tint caching).
export function heroSetFrames(set) {
    const out = [];
    for (const d of Object.values(set.dirs)) {
        for (const arr of [d.idle, d.walk, d.cast, d.hurt]) for (const c of arr) if (c && !out.includes(c)) out.push(c);
    }
    return out;
}

// Back-compat flat array [idle, walk0, walk1, walk2] (down-facing) for any
// consumer that still wants the old shape.
export function getCharacterFrames(id, char = null) {
    const d = getHeroFrames(id, char).dirs.down;
    return [d.idle[0], d.walk[0], d.walk[1], d.walk[2]];
}

// ── Enemies ────────────────────────────────────────────────────────────

function makeFrameGetter(key, count, drawer) {
    return () => {
        if (cache.has(key)) return cache.get(key);
        const frames = [];
        for (let i = 0; i < count; i++) frames.push(addOutline(drawer(SPRITE_SIZE, i, count)));
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
export const getGloomMawFrames = makeFrameGetter('gloomMawFrames', 4, drawGloomMaw);
export const getSpitterFrames = makeFrameGetter('spitterFrames', 4, drawSpitter);
export const getChargerFrames = makeFrameGetter('chargerFrames', 2, drawCharger);
export const getMiteFrames = makeFrameGetter('miteFrames', 4, drawMite);
export const getJuggernautFrames = makeFrameGetter('juggernautFrames', 2, drawJuggernaut);
export const getHealerFrames = makeFrameGetter('healerFrames', 4, drawHealer);
export const getShielderFrames = makeFrameGetter('shielderFrames', 3, drawShielder);
export const getSpeedDemonFrames = makeFrameGetter('speedDemonFrames', 4, drawSpeedDemon);
export const getDreadhulkFrames = makeFrameGetter('dreadhulkFrames', 2, drawDreadhulk);
export const getBrawlerFrames = makeFrameGetter('brawlerFrames', 2, drawBrawler);

// Back-compat: idle frames for legacy callers.
export function getSlimeSprite() { return getSlimeFrames()[0]; }
export function getBatSprite() { return getBatFrames()[0]; }
export function getBruteSprite() { return getBruteFrames()[0]; }
export function getCrawlerSprite() { return getCrawlerFrames()[0]; }
export function getVinebackGoliathSprite() { return getVinebackGoliathFrames()[0]; }
export function getStormwingAlphaSprite() { return getStormwingAlphaFrames()[0]; }
export function getGloomMawSprite() { return getGloomMawFrames()[0]; }
export function getSpitterSprite() { return getSpitterFrames()[0]; }
export function getChargerSprite() { return getChargerFrames()[0]; }

// ── New per-map apex bosses (maps 2–4) ───────────────────────────────────
// Nine new bosses share one PARAMETRIC drawer: a config picks a body
// archetype (distinct silhouette) + a biome palette + an accent kind, so each
// boss reads as its own creature (an icy golem, a magma serpent, a void maw…)
// without nine near-duplicate functions. The makeFrameGetter pipeline still
// adds the rim light + dark outline, exactly like the hand-built bosses.
function _bossAura(ctx, size, color) {
    const cx = size / 2, cy = size / 2;
    const aura = ctx.createRadialGradient(cx, cy, 10, cx, cy, 94);
    aura.addColorStop(0, color);
    aura.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, size, size);
}
function _eye(ctx, x, y, r, eyeCol, shineCol) {
    ctx.fillStyle = eyeCol;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 1.15, 0, 0, TWO_PI); ctx.fill();
    ctx.fillStyle = shineCol;
    ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.4, r * 0.34, 0, TWO_PI); ctx.fill();
}

function drawApexBoss(size, frame, count, cfg) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2, cy = size / 2;
    const phase = (frame / count) * TWO_PI;
    const p = cfg.palette;
    softShadow(ctx, cx, cy + 58, 58, 14, 0.42);
    _bossAura(ctx, size, cfg.glow);

    if (cfg.archetype === 'hulk') {
        const bob = Math.sin(phase) * 3;
        // Legs.
        ctx.fillStyle = p.dark;
        for (const sx of [-22, 22]) { ctx.beginPath(); ctx.roundRect(cx + sx - 12, cy + 24, 24, 36, 7); ctx.fill(); }
        // Arms + fists.
        for (const s of [-1, 1]) {
            ctx.fillStyle = p.body;
            ctx.beginPath(); ctx.roundRect(cx + s * 40 - 10, cy - 18 + bob, 20, 52, 9); ctx.fill();
            ctx.fillStyle = p.dark;
            ctx.beginPath(); ctx.arc(cx + s * 44, cy + 38 + bob, 15, 0, TWO_PI); ctx.fill();
        }
        // Torso.
        ctx.fillStyle = p.body;
        ctx.beginPath(); ctx.roundRect(cx - 34, cy - 30 + bob, 68, 70, 16); ctx.fill();
        ctx.fillStyle = p.dark;
        ctx.beginPath(); ctx.roundRect(cx - 34, cy + 6 + bob, 68, 34, 14); ctx.fill();
        // Pauldrons.
        ctx.fillStyle = p.light;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + s * 34, cy - 24 + bob, 18, 0, TWO_PI); ctx.fill(); }
        // Chest core (accent glow).
        ctx.fillStyle = p.accent;
        ctx.beginPath(); ctx.arc(cx, cy + 2 + bob, 9 + Math.sin(phase * 2) * 1.5, 0, TWO_PI); ctx.fill();
        // Head.
        ctx.fillStyle = p.light;
        ctx.beginPath(); ctx.arc(cx, cy - 42 + bob, 16, 0, TWO_PI); ctx.fill();
        _eye(ctx, cx - 6, cy - 43 + bob, 3.4, p.eye, p.accent);
        _eye(ctx, cx + 6, cy - 43 + bob, 3.4, p.eye, p.accent);
        if (cfg.accent === 'ice') {
            ctx.fillStyle = p.accent;
            for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + s * 34, cy - 40 + bob); ctx.lineTo(cx + s * 30, cy - 64 + bob); ctx.lineTo(cx + s * 42, cy - 44 + bob); ctx.closePath(); ctx.fill(); }
        } else if (cfg.accent === 'bone') {
            ctx.strokeStyle = p.dark; ctx.lineWidth = 3;
            for (let i = 0; i < 3; i++) { const yy = cy - 14 + i * 13 + bob; ctx.beginPath(); ctx.moveTo(cx - 26, yy); ctx.lineTo(cx + 26, yy); ctx.stroke(); }
        }
    } else if (cfg.archetype === 'serpent') {
        // Coiled segmented body swaying with phase, head on top.
        const segs = 7;
        for (let i = segs - 1; i >= 0; i--) {
            const t = i / segs;
            const sway = Math.sin(phase + i * 0.7) * (10 + i * 2);
            const sx = cx + sway, sy = cy + 44 - i * 13;
            ctx.fillStyle = i % 2 ? p.body : p.dark;
            ctx.beginPath(); ctx.arc(sx, sy, 22 - i * 1.6, 0, TWO_PI); ctx.fill();
            if (i % 2 === 0) { ctx.fillStyle = p.light; ctx.beginPath(); ctx.arc(sx - 4, sy - 4, (22 - i * 1.6) * 0.4, 0, TWO_PI); ctx.fill(); }
        }
        const hx = cx + Math.sin(phase + segs * 0.7) * 16, hy = cy - 48;
        // Head.
        ctx.fillStyle = p.light;
        ctx.beginPath(); ctx.ellipse(hx, hy, 22, 18, 0, 0, TWO_PI); ctx.fill();
        ctx.fillStyle = p.body;
        ctx.beginPath(); ctx.ellipse(hx, hy + 6, 22, 12, 0, 0, TWO_PI); ctx.fill();
        // Horns.
        ctx.fillStyle = p.accent;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(hx + s * 12, hy - 12); ctx.lineTo(hx + s * 22, hy - 30); ctx.lineTo(hx + s * 18, hy - 8); ctx.closePath(); ctx.fill(); }
        _eye(ctx, hx - 8, hy - 2, 4, p.eye, p.accent);
        _eye(ctx, hx + 8, hy - 2, 4, p.eye, p.accent);
        // Jaw glow.
        ctx.fillStyle = cfg.accent === 'magma' ? p.accent : p.eye;
        ctx.beginPath(); ctx.ellipse(hx, hy + 12, 9, 4, 0, 0, TWO_PI); ctx.fill();
    } else if (cfg.archetype === 'colossus') {
        // Tall tapered crystalline body + crown + orbiting shards.
        const pulse = 1 + Math.sin(phase * 2) * 0.12;
        ctx.fillStyle = p.body;
        ctx.beginPath();
        ctx.moveTo(cx - 30, cy + 58); ctx.lineTo(cx - 18, cy - 40);
        ctx.lineTo(cx, cy - 56); ctx.lineTo(cx + 18, cy - 40);
        ctx.lineTo(cx + 30, cy + 58); ctx.closePath(); ctx.fill();
        ctx.fillStyle = p.dark;
        ctx.beginPath(); ctx.moveTo(cx, cy - 56); ctx.lineTo(cx + 18, cy - 40); ctx.lineTo(cx + 30, cy + 58); ctx.lineTo(cx, cy + 58); ctx.closePath(); ctx.fill();
        ctx.fillStyle = p.light;
        ctx.beginPath(); ctx.moveTo(cx, cy - 56); ctx.lineTo(cx - 8, cy - 20); ctx.lineTo(cx, cy + 30); ctx.lineTo(cx + 6, cy - 20); ctx.closePath(); ctx.fill();
        // Crown of spikes.
        ctx.fillStyle = p.accent;
        for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(cx + i * 12 - 5, cy - 50); ctx.lineTo(cx + i * 12, cy - 50 - (18 - Math.abs(i) * 3)); ctx.lineTo(cx + i * 12 + 5, cy - 50); ctx.closePath(); ctx.fill(); }
        // Glowing core.
        ctx.fillStyle = p.accent;
        ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(cx, cy - 2, 11 * pulse, 0, TWO_PI); ctx.fill(); ctx.globalAlpha = 1;
        _eye(ctx, cx - 8, cy - 24, 4, p.eye, p.accent);
        _eye(ctx, cx + 8, cy - 24, 4, p.eye, p.accent);
        // Orbiting shards.
        ctx.fillStyle = p.light;
        for (let i = 0; i < 4; i++) { const a = phase + i * (TWO_PI / 4); const ox = cx + Math.cos(a) * 56, oy = cy - 4 + Math.sin(a) * 40; ctx.beginPath(); ctx.moveTo(ox, oy - 8); ctx.lineTo(ox + 5, oy); ctx.lineTo(ox, oy + 8); ctx.lineTo(ox - 5, oy); ctx.closePath(); ctx.fill(); }
    } else if (cfg.archetype === 'wraith') {
        // Floating hooded cloak with a tattered, waving lower edge.
        const drift = Math.sin(phase) * 4;
        ctx.fillStyle = p.body;
        ctx.beginPath();
        ctx.moveTo(cx - 38, cy - 6 + drift);
        ctx.quadraticCurveTo(cx, cy - 64 + drift, cx + 38, cy - 6 + drift);
        // Tattered hem.
        for (let i = 5; i >= -5; i--) {
            const tx = cx + i * 7.6;
            const ty = cy + 44 + Math.sin(phase * 2 + i) * 7 + drift;
            ctx.lineTo(tx, ty);
        }
        ctx.closePath(); ctx.fill();
        // Inner shade.
        ctx.fillStyle = p.dark;
        ctx.beginPath();
        ctx.moveTo(cx - 22, cy - 14 + drift);
        ctx.quadraticCurveTo(cx, cy - 50 + drift, cx + 22, cy - 14 + drift);
        ctx.quadraticCurveTo(cx, cy + 6 + drift, cx - 22, cy - 14 + drift);
        ctx.closePath(); ctx.fill();
        // Hood opening + two glowing eyes.
        ctx.fillStyle = '#05060a';
        ctx.beginPath(); ctx.ellipse(cx, cy - 22 + drift, 16, 20, 0, 0, TWO_PI); ctx.fill();
        _eye(ctx, cx - 7, cy - 24 + drift, 4.2, p.accent, p.light);
        _eye(ctx, cx + 7, cy - 24 + drift, 4.2, p.accent, p.light);
        // Wispy claws.
        ctx.strokeStyle = p.light; ctx.lineWidth = 4; ctx.lineCap = 'round';
        for (const s of [-1, 1]) {
            ctx.beginPath(); ctx.moveTo(cx + s * 30, cy + drift);
            ctx.quadraticCurveTo(cx + s * 52, cy + 8 + drift, cx + s * 48, cy + 28 + drift); ctx.stroke();
        }
    } else if (cfg.archetype === 'maw') {
        // Central orb dominated by a vertical toothy maw, ringed by small eyes.
        const open = 8 + Math.sin(phase * 2) * 6;
        ctx.fillStyle = p.body;
        ctx.beginPath(); ctx.arc(cx, cy, 46, 0, TWO_PI); ctx.fill();
        ctx.fillStyle = p.dark;
        ctx.beginPath(); ctx.arc(cx, cy + 6, 46, 0.12 * Math.PI, 0.88 * Math.PI); ctx.fill();
        // Tendrils.
        ctx.strokeStyle = p.dark; ctx.lineWidth = 6; ctx.lineCap = 'round';
        for (let i = 0; i < 8; i++) { const a = phase * 0.5 + i * (TWO_PI / 8); ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40); ctx.lineTo(cx + Math.cos(a) * 74, cy + Math.sin(a) * 74); ctx.stroke(); }
        // Maw.
        ctx.fillStyle = '#0a0410';
        ctx.beginPath(); ctx.ellipse(cx, cy + 4, 16, 20 + open, 0, 0, TWO_PI); ctx.fill();
        ctx.fillStyle = p.light;
        for (let i = 0; i < 5; i++) { const ty = cy - 12 + i * 9; ctx.beginPath(); ctx.moveTo(cx - 14, ty); ctx.lineTo(cx - 8, ty + 4); ctx.lineTo(cx - 14, ty + 8); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(cx + 14, ty); ctx.lineTo(cx + 8, ty + 4); ctx.lineTo(cx + 14, ty + 8); ctx.closePath(); ctx.fill(); }
        // Ring of small eyes.
        for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i - 2.5) * 0.42; _eye(ctx, cx + Math.cos(a) * 30, cy + Math.sin(a) * 30 - 6, 3, p.accent, p.light); }
    } else if (cfg.archetype === 'reaper') {
        // Tall hooded SKELETON wielding a great scythe — grim and vertical
        // (distinct from the floating wraith: bony body + a sweeping blade).
        const drift = Math.sin(phase) * 3;
        // Scythe: long shaft + curved blade arcing behind one shoulder.
        ctx.strokeStyle = p.dark; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx + 30, cy + 54); ctx.lineTo(cx + 18, cy - 62); ctx.stroke();
        ctx.fillStyle = p.accent;
        ctx.beginPath(); ctx.moveTo(cx + 18, cy - 62);
        ctx.quadraticCurveTo(cx - 34, cy - 72, cx - 40, cy - 34);
        ctx.quadraticCurveTo(cx - 6, cy - 54, cx + 18, cy - 50); ctx.closePath(); ctx.fill();
        // Tapered robe.
        ctx.fillStyle = p.body;
        ctx.beginPath(); ctx.moveTo(cx - 26, cy + 56); ctx.lineTo(cx - 16, cy - 30 + drift);
        ctx.quadraticCurveTo(cx, cy - 44 + drift, cx + 16, cy - 30 + drift); ctx.lineTo(cx + 26, cy + 56); ctx.closePath(); ctx.fill();
        ctx.fillStyle = p.dark;
        ctx.beginPath(); ctx.moveTo(cx, cy - 38 + drift); ctx.lineTo(cx + 16, cy - 30 + drift); ctx.lineTo(cx + 26, cy + 56); ctx.lineTo(cx, cy + 56); ctx.closePath(); ctx.fill();
        // Ribs.
        ctx.strokeStyle = p.light; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) { const yy = cy - 6 + i * 11 + drift; ctx.beginPath(); ctx.moveTo(cx - 12, yy); ctx.lineTo(cx + 12, yy); ctx.stroke(); }
        // Skull.
        ctx.fillStyle = p.light;
        ctx.beginPath(); ctx.arc(cx, cy - 46 + drift, 15, 0, TWO_PI); ctx.fill();
        ctx.fillStyle = p.dark;
        ctx.beginPath(); ctx.ellipse(cx, cy - 39 + drift, 8, 6, 0, 0, TWO_PI); ctx.fill();
        _eye(ctx, cx - 6, cy - 48 + drift, 3.6, p.eye, p.accent);
        _eye(ctx, cx + 6, cy - 48 + drift, 3.6, p.eye, p.accent);
    } else if (cfg.archetype === 'wyrm') {
        // Winged drake — broad flapping wings + a raised horned head with a
        // glowing maw (distinct from the coiled serpent's stacked segments).
        const flap = Math.sin(phase * 2) * 10;
        ctx.fillStyle = p.dark;
        for (const s of [-1, 1]) {
            ctx.beginPath(); ctx.moveTo(cx, cy - 6);
            ctx.quadraticCurveTo(cx + s * 60, cy - 40 - flap, cx + s * 78, cy + 10 - flap);
            ctx.quadraticCurveTo(cx + s * 50, cy + 6, cx, cy + 18); ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = p.accent; ctx.lineWidth = 2;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx, cy - 2); ctx.lineTo(cx + s * 70, cy + 4 - flap); ctx.stroke(); }
        // Body + belly highlight.
        ctx.fillStyle = p.body;
        ctx.beginPath(); ctx.ellipse(cx, cy + 12, 26, 34, 0, 0, TWO_PI); ctx.fill();
        ctx.fillStyle = p.light; ctx.beginPath(); ctx.ellipse(cx - 6, cy + 6, 10, 16, 0, 0, TWO_PI); ctx.fill();
        // Raised neck + head.
        ctx.fillStyle = p.body; ctx.beginPath(); ctx.roundRect(cx - 10, cy - 40, 20, 40, 9); ctx.fill();
        ctx.fillStyle = p.light; ctx.beginPath(); ctx.ellipse(cx, cy - 46, 18, 14, 0, 0, TWO_PI); ctx.fill();
        ctx.fillStyle = p.accent;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + s * 8, cy - 56); ctx.lineTo(cx + s * 16, cy - 74); ctx.lineTo(cx + s * 14, cy - 52); ctx.closePath(); ctx.fill(); }
        ctx.fillStyle = p.accent; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.ellipse(cx, cy - 38, 7, 4 + Math.sin(phase * 2) * 2, 0, 0, TWO_PI); ctx.fill(); ctx.globalAlpha = 1;
        _eye(ctx, cx - 7, cy - 48, 3.6, p.eye, p.accent);
        _eye(ctx, cx + 7, cy - 48, 3.6, p.eye, p.accent);
    } else if (cfg.archetype === 'titan') {
        // Broad RADIANT giant — wide armored shoulders + a spinning sun-disc
        // halo (distinct from the tall crystalline colossus).
        const bob = Math.sin(phase) * 3;
        ctx.strokeStyle = p.accent; ctx.lineWidth = 5; ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.arc(cx, cy - 40 + bob, 30 + Math.sin(phase * 2) * 2, 0, TWO_PI); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.strokeStyle = p.accent; ctx.lineWidth = 3;
        for (let i = 0; i < 8; i++) { const a = phase * 0.4 + i * (TWO_PI / 8); ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 32, cy - 40 + bob + Math.sin(a) * 32); ctx.lineTo(cx + Math.cos(a) * 44, cy - 40 + bob + Math.sin(a) * 44); ctx.stroke(); }
        ctx.fillStyle = p.dark;
        for (const sx of [-20, 20]) { ctx.beginPath(); ctx.roundRect(cx + sx - 11, cy + 26, 22, 34, 6); ctx.fill(); }
        ctx.fillStyle = p.body;
        ctx.beginPath(); ctx.roundRect(cx - 38, cy - 20 + bob, 76, 60, 14); ctx.fill();
        ctx.fillStyle = p.dark; ctx.beginPath(); ctx.roundRect(cx - 38, cy + 10 + bob, 76, 30, 12); ctx.fill();
        ctx.fillStyle = p.light;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + s * 42, cy - 20 + bob, 20, 0, TWO_PI); ctx.fill(); }
        ctx.fillStyle = p.accent;
        ctx.beginPath(); ctx.arc(cx, cy + 6 + bob, 11 + Math.sin(phase * 2) * 2, 0, TWO_PI); ctx.fill();
        ctx.fillStyle = p.light;
        ctx.beginPath(); ctx.arc(cx, cy - 40 + bob, 15, 0, TWO_PI); ctx.fill();
        _eye(ctx, cx - 6, cy - 41 + bob, 3.4, p.eye, p.accent);
        _eye(ctx, cx + 6, cy - 41 + bob, 3.4, p.eye, p.accent);
    } else { // 'scarab' — armored beast
        const step = Math.sin(phase * 2) * 4;
        // Legs.
        ctx.strokeStyle = p.dark; ctx.lineWidth = 5; ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) { for (const s of [-1, 1]) { const ly = cy + 6 + i * 14; ctx.beginPath(); ctx.moveTo(cx + s * 28, ly); ctx.lineTo(cx + s * (52 + (i === 1 ? step : 0)), ly + 10); ctx.stroke(); } }
        // Carapace (segmented dome).
        ctx.fillStyle = p.body;
        ctx.beginPath(); ctx.ellipse(cx, cy + 6, 42, 46, 0, 0, TWO_PI); ctx.fill();
        ctx.fillStyle = p.dark;
        ctx.beginPath(); ctx.ellipse(cx, cy + 14, 42, 38, 0, 0, Math.PI); ctx.fill();
        ctx.strokeStyle = p.dark; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(cx, cy - 36); ctx.lineTo(cx, cy + 48); ctx.stroke();
        // Back gem.
        ctx.fillStyle = p.accent;
        ctx.beginPath(); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx + 10, cy - 2); ctx.lineTo(cx, cy + 12); ctx.lineTo(cx - 10, cy - 2); ctx.closePath(); ctx.fill();
        // Head + mandibles (pincers open/close).
        ctx.fillStyle = p.light;
        ctx.beginPath(); ctx.arc(cx, cy - 40, 16, 0, TWO_PI); ctx.fill();
        _eye(ctx, cx - 6, cy - 42, 3.2, p.eye, p.accent);
        _eye(ctx, cx + 6, cy - 42, 3.2, p.eye, p.accent);
        ctx.strokeStyle = p.accent; ctx.lineWidth = 6; ctx.lineCap = 'round';
        const pinch = 10 + Math.sin(phase * 2) * 6;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + s * 10, cy - 50); ctx.quadraticCurveTo(cx + s * (24 + pinch), cy - 64, cx + s * pinch, cy - 74); ctx.stroke(); }
    }
    return canvas;
}

// Per-boss configs (archetype + biome palette + accent kind).
const BOSS_SPRITE_CFG = {
    // Snow (maps 2)
    rimewarden:  { archetype: 'hulk',     accent: 'ice',  glow: 'rgba(150,210,255,0.22)', palette: { body: '#6f93b8', light: '#cfe8f7', dark: '#3f5d7e', accent: '#a6ecff', eye: '#0a1a2a' } },
    hoarfang:    { archetype: 'serpent',  accent: 'ice',  glow: 'rgba(140,200,255,0.20)', palette: { body: '#5f86ad', light: '#cdeafa', dark: '#37536f', accent: '#aef0ff', eye: '#0a1622' } },
    aurorath:    { archetype: 'colossus', accent: 'ice',  glow: 'rgba(160,255,224,0.22)', palette: { body: '#7fb0d8', light: '#e9f9ff', dark: '#3e6e92', accent: '#a0ffe0', eye: '#0c2030' } },
    // Night (map 3)
    ossuar:      { archetype: 'reaper',   accent: 'bone', glow: 'rgba(180,230,200,0.18)', palette: { body: '#cfc6ad', light: '#f3eeda', dark: '#8a7f63', accent: '#bdf2d2', eye: '#1a1020' } },
    mourndrift:  { archetype: 'wraith',   accent: 'soul', glow: 'rgba(120,160,255,0.24)', palette: { body: '#5b5f86', light: '#c2c8f2', dark: '#33365a', accent: '#9af0ff', eye: '#d8f6ff' } },
    nihagault:   { archetype: 'maw',      accent: 'void', glow: 'rgba(150,80,220,0.26)',  palette: { body: '#43325e', light: '#9a7fce', dark: '#1d142e', accent: '#d06bff', eye: '#ff5ad0' } },
    // Sand (map 4)
    dunescourge: { archetype: 'scarab',   accent: 'sand', glow: 'rgba(230,180,90,0.20)',  palette: { body: '#c89a52', light: '#f2d490', dark: '#7e5f2c', accent: '#ffe09a', eye: '#2a1808' } },
    cindermaw:   { archetype: 'wyrm',     accent: 'magma', glow: 'rgba(255,120,40,0.26)', palette: { body: '#9a4a2e', light: '#ffa459', dark: '#491c12', accent: '#ffd24a', eye: '#1a0805' } },
    solnakh:     { archetype: 'titan',    accent: 'solar', glow: 'rgba(255,200,80,0.30)', palette: { body: '#caa23c', light: '#fff2b6', dark: '#8a6a1c', accent: '#ff7a2a', eye: '#2a1400' } },
};

function _bossDrawer(id) { const cfg = BOSS_SPRITE_CFG[id]; return (size, frame, count) => drawApexBoss(size, frame, count, cfg); }

export const getRimewardenFrames  = makeFrameGetter('rimewardenFrames',  4, _bossDrawer('rimewarden'));
export const getHoarfangFrames    = makeFrameGetter('hoarfangFrames',    4, _bossDrawer('hoarfang'));
export const getAurorathFrames    = makeFrameGetter('aurorathFrames',    4, _bossDrawer('aurorath'));
export const getOssuarFrames      = makeFrameGetter('ossuarFrames',      4, _bossDrawer('ossuar'));
export const getMourndriftFrames  = makeFrameGetter('mourndriftFrames',  4, _bossDrawer('mourndrift'));
export const getNihagaultFrames   = makeFrameGetter('nihagaultFrames',   4, _bossDrawer('nihagault'));
export const getDunescourgeFrames = makeFrameGetter('dunescourgeFrames', 4, _bossDrawer('dunescourge'));
export const getCindermawFrames   = makeFrameGetter('cindermawFrames',   4, _bossDrawer('cindermaw'));
export const getSolnakhFrames     = makeFrameGetter('solnakhFrames',     4, _bossDrawer('solnakh'));

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

export function getHealthOrbFrames() {
    if (cache.has('healthOrbFrames')) return cache.get('healthOrbFrames');
    const frames = [drawHealthOrb(0), drawHealthOrb(1)];
    cache.set('healthOrbFrames', frames);
    return frames;
}

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

// Supersampled offscreen canvas: backing store is `logical × SPRITE_SS` px,
// but the 2D context is pre-scaled by SPRITE_SS so all the hand-tuned drawer
// coordinates author in LOGICAL units (cx = size/2, lineWidth = 14, …) yet
// rasterize into a denser canvas — crisp when magnified on big/retina
// displays. getContext('2d') is idempotent, so a drawer re-fetching the
// context still sees this pre-applied scale. Consumers draw the result at
// logical size (sprite.width / SPRITE_SS) to keep the world footprint.
function ssCanvas(wLogical, hLogical) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(wLogical * SPRITE_SS);
    canvas.height = Math.round(hLogical * SPRITE_SS);
    const ctx = canvas.getContext('2d');
    ctx.scale(SPRITE_SS, SPRITE_SS);
    return canvas;
}

function newSpriteCanvas(size) {
    return ssCanvas(size, size);
}

function softShadow(ctx, cx, cy, rx, ry, alpha = 0.35) {
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
    ctx.fill();
}

// Stamp a dark contour BEHIND a finished character sprite so it keeps a
// strong silhouette against busy, dim ground. Runs ONCE per frame at
// cache-fill (never per render frame). Technique: build a solid-colour
// silhouette of the art (copy → 'source-in' fill), then draw it under the
// original ('destination-over') at `samples` offsets around a ring. Works in
// raw backing-store pixels — drawers leave a SPRITE_SS scale on the context,
// so we reset to identity for the stamp. Mutates and returns `canvas`.
function addOutline(canvas) {
    // Bake a soft top-left rim light onto the art first (more depth), then the
    // dark contour behind it. Both are one-time, cache-fill costs.
    addRimLight(canvas);
    const cfg = SPRITE_FX.outline;
    if (!cfg || !cfg.enabled) return canvas;
    const w = canvas.width, h = canvas.height;

    // Solid-colour silhouette of the existing art (keeps its alpha edges).
    const sil = document.createElement('canvas');
    sil.width = w;
    sil.height = h;
    const sctx = sil.getContext('2d');
    sctx.drawImage(canvas, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = cfg.color;
    sctx.fillRect(0, 0, w, h);

    // Stamp it behind the original at evenly spaced offsets.
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.globalAlpha = cfg.alpha ?? 1;
    const px = Math.max(1, Math.round((cfg.widthLogical ?? 2) * SPRITE_SS));
    const n = Math.max(4, cfg.samples ?? 8);
    for (let i = 0; i < n; i++) {
        const a = (i / n) * TWO_PI;
        ctx.drawImage(sil, Math.round(Math.cos(a) * px), Math.round(Math.sin(a) * px));
    }
    ctx.restore();
    return canvas;
}

// Soft warm rim light on the top-left edge of a finished sprite (depth + a
// polished lit-form read). Builds a bright silhouette of the art and stamps it
// back with 'source-atop' (only touches the art's own pixels) offset up-left.
// Mutates and returns `canvas`. One-time cost at cache-fill.
function addRimLight(canvas) {
    const cfg = SPRITE_FX.rimLight;
    if (!cfg || !cfg.enabled) return canvas;
    const w = canvas.width, h = canvas.height;
    const sil = document.createElement('canvas');
    sil.width = w; sil.height = h;
    const sctx = sil.getContext('2d');
    sctx.drawImage(canvas, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = cfg.color;
    sctx.fillRect(0, 0, w, h);
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-atop'; // brighten only existing art
    ctx.globalAlpha = cfg.alpha ?? 0.12;
    const px = Math.max(1, Math.round((cfg.offsetLogical ?? 1.5) * SPRITE_SS));
    ctx.drawImage(sil, -px, -px);
    ctx.restore();
    // Baked ambient-occlusion shade OPPOSITE the rim: refill the silhouette dark
    // (sctx is still in 'source-in', so this recolors the shape) and stamp it
    // offset bottom-right, so every character reads as lit top-left / shaded
    // bottom-right. Same one-time cache-fill pass — zero per-frame cost.
    sctx.fillStyle = '#0c1018';
    sctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.14;
    ctx.drawImage(sil, px, px);
    ctx.restore();
    return canvas;
}

// ─── Shared cosmetic + weapon-skin overlays ─────────────────────────────
// These are the SINGLE source of truth for the cloak/hat cosmetic shapes and
// the weapon-themed skin overlay, used by BOTH the in-game player (Player.draw)
// and the start-menu preview (MenuRenderer._drawAvatar) so the two can never
// diverge. All draw in the caller's current transform, anchored at (ox, oy)
// (the sprite centre) with `s` as the scale unit (the player passes spriteHalf;
// the menu passes half its avatar sprite size).

export function drawCloakShape(ctx, ox, oy, s, color) {
    if (!color) return;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(ox - s * 0.42, oy - s * 0.18);
    ctx.lineTo(ox + s * 0.42, oy - s * 0.18);
    ctx.lineTo(ox + s * 0.6, oy + s * 0.62);
    ctx.lineTo(ox, oy + s * 0.78);
    ctx.lineTo(ox - s * 0.6, oy + s * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

export function drawHatShape(ctx, ox, oy, s, shape, color) {
    if (!shape || shape === 'none') return;
    const topY = oy - s * 0.62;
    ctx.save();
    ctx.fillStyle = color || '#ffd35a';
    if (shape === 'cap') {
        ctx.beginPath();
        ctx.arc(ox, topY, s * 0.32, Math.PI, 0);
        ctx.fill();
        ctx.fillRect(ox - s * 0.34, topY - 2, s * 0.68, 6);
    } else if (shape === 'candle') {
        ctx.fillStyle = '#e8e2cf';
        ctx.fillRect(ox - s * 0.07, topY - s * 0.28, s * 0.14, s * 0.3);
        ctx.fillStyle = '#ffb24a';
        ctx.beginPath();
        ctx.ellipse(ox, topY - s * 0.3, s * 0.06, s * 0.11, 0, 0, TWO_PI);
        ctx.fill();
    } else if (shape === 'horns') {
        ctx.strokeStyle = color || '#9a6cff';
        ctx.lineWidth = Math.max(4, s * 0.09); ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ox - s * 0.22, topY + 6); ctx.quadraticCurveTo(ox - s * 0.5, topY - s * 0.2, ox - s * 0.32, topY - s * 0.4);
        ctx.moveTo(ox + s * 0.22, topY + 6); ctx.quadraticCurveTo(ox + s * 0.5, topY - s * 0.2, ox + s * 0.32, topY - s * 0.4);
        ctx.stroke();
    } else if (shape === 'crown') {
        const cw = s * 0.5;
        ctx.beginPath();
        ctx.moveTo(ox - cw, topY);
        ctx.lineTo(ox - cw, topY - s * 0.16);
        ctx.lineTo(ox - cw * 0.5, topY - s * 0.04);
        ctx.lineTo(ox, topY - s * 0.22);
        ctx.lineTo(ox + cw * 0.5, topY - s * 0.04);
        ctx.lineTo(ox + cw, topY - s * 0.16);
        ctx.lineTo(ox + cw, topY);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
}

// Themed weapon-skin overlay: a diagonal sash across the torso, a chest gem,
// and a floating motif (orb/flame/bolt/blade/sigil/shard/crown) with an
// additive glow — all keyed to the skin theme. `t` (seconds) drives subtle
// idle motion (orbit / flicker). Draws in the caller's transform at (ox,oy),
// unit `s`. Cheap (a handful of paths) — only the single player + menu avatar
// ever call it, so it's a live draw rather than a cached frame.
export function drawWeaponSkinOverlay(ctx, ox, oy, s, skin, t = 0, dir = 'down') {
    if (!skin) return;
    // The held weapon now carries the weapon identity (see assets/WeaponProps),
    // so the overlay is just themed ATTIRE: a diagonal sash + chest gem. Those
    // are front-of-torso only — skip them on the back ('up') view rather than
    // paint a chest sash on the hero's back. (`t` is unused now that the old
    // floating emblem — redundant with the in-hand weapon — has been removed.)
    if (dir === 'up') return;
    const accent = skin.accent || '#ffd27a';
    ctx.save();

    // Diagonal sash across the torso (shoulder → opposite hip) with a lighter
    // inner stripe for depth.
    ctx.lineCap = 'round';
    ctx.strokeStyle = accent;
    ctx.lineWidth = s * 0.14;
    ctx.beginPath();
    ctx.moveTo(ox - s * 0.32, oy - s * 0.06);
    ctx.lineTo(ox + s * 0.30, oy + s * 0.30);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = s * 0.05;
    ctx.beginPath();
    ctx.moveTo(ox - s * 0.30, oy - s * 0.05);
    ctx.lineTo(ox + s * 0.28, oy + s * 0.28);
    ctx.stroke();

    // Chest gem at the sash crossing.
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(ox - s * 0.02, oy + s * 0.10, s * 0.085, 0, TWO_PI); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.arc(ox - s * 0.04, oy + s * 0.075, s * 0.03, 0, TWO_PI); ctx.fill();

    ctx.restore();
}

// ─── Player / monkey ──────────────────────────────────────────────────

function drawMonkey(size, frame, opts = {}) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;

    // Walk-cycle phase for limbs/tail. Frame 0 = idle.
    const isIdle = frame === 0;
    const phase = isIdle ? 0 : (frame - 1) * (TWO_PI / 3);
    const swing = Math.sin(phase);
    const bob = isIdle ? 0 : Math.abs(Math.cos(phase)) * 3;

    // Fur/face palette can be overridden per playable character (the shared
    // wick-keeper silhouette is recolored so each hero reads distinctly). The
    // outfit (cloak/scarf/staff) stays constant so the cast feels like a guild.
    const pal = opts.palette || {};
    const FUR = pal.fur || '#8b5a2b';
    const FUR_DARK = pal.furDark || '#5a3818';
    const FUR_LIGHT = pal.furLight || '#b07a44';
    const FACE = pal.face || '#f0d2a5';
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
    // The Last Ember on the Wick-Keeper's lantern-staff: warm, living flame
    // (re-themed from cold arcane cyan for EMBERWAKE).
    const STAFF_TIP = '#ffb24a';

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
    const cloakGrad = ctx.createLinearGradient(cx, bodyY - 16, cx, bodyY + 52);
    cloakGrad.addColorStop(0, CLOAK_LIGHT);
    cloakGrad.addColorStop(0.5, CLOAK);
    cloakGrad.addColorStop(1, CLOAK_DARK);
    ctx.fillStyle = cloakGrad;
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
    // Volumetric shading: a radial gradient seats the light up-and-left and
    // rolls the form into shadow on the lower-right, so the torso reads as a
    // rounded mass instead of a flat blob. Built from the character palette so
    // every recolored hero keeps its own tones.
    const bodyGrad = ctx.createRadialGradient(cx - 13, bodyY - 14, 5, cx + 4, bodyY + 12, 56);
    bodyGrad.addColorStop(0, FUR_LIGHT);
    bodyGrad.addColorStop(0.5, FUR);
    bodyGrad.addColorStop(1, FUR_DARK);
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(cx, bodyY + 4, 36, 42, 0, 0, TWO_PI);
    ctx.fill();
    // Soft rim light along the upper-left silhouette for a sculpted edge.
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = FUR_LIGHT;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(cx, bodyY + 4, 33, 39, 0, Math.PI * 1.05, Math.PI * 1.75);
    ctx.stroke();
    ctx.restore();
    // Belly — a gentle vertical gradient gives it depth rather than a flat patch.
    const bellyGrad = ctx.createLinearGradient(cx, bodyY - 6, cx, bodyY + 36);
    bellyGrad.addColorStop(0, FACE);
    bellyGrad.addColorStop(1, FUR_LIGHT);
    ctx.fillStyle = bellyGrad;
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
    // Ambient-occlusion shadow where the head seats into the shoulders, so the
    // head reads as resting ON the body rather than floating beside it.
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = FUR_DARK;
    ctx.beginPath();
    ctx.ellipse(cx, headY + 33, 25, 11, 0, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
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

    // Skull — radial gradient gives the head a rounded, lit volume.
    const headGrad = ctx.createRadialGradient(cx - 12, headY - 14, 4, cx + 2, headY + 8, 46);
    headGrad.addColorStop(0, FUR_LIGHT);
    headGrad.addColorStop(0.55, FUR);
    headGrad.addColorStop(1, FUR_DARK);
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.arc(cx, headY, 38, 0, TWO_PI);
    ctx.fill();
    // Face
    ctx.fillStyle = FACE;
    ctx.beginPath();
    ctx.ellipse(cx, headY + 6, 25, 26, 0, 0, TWO_PI);
    ctx.fill();
    // Soft contour shadow around the muzzle so the face sits inside the fur
    // rather than reading as a pasted-on disc.
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = FUR_DARK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, headY + 6, 25, 26, 0, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    ctx.restore();
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

    // Per-character distinguishing feature so heroes read as different models,
    // not just recolors: elf = long pointed ears, orc = jutting tusks, wizard =
    // a pointed hat. Drawn over the head using the character's accent color.
    const feature = opts.feature;
    if (feature === 'ears') {
        ctx.fillStyle = FUR;
        ctx.strokeStyle = FUR_DARK;
        ctx.lineWidth = 3;
        for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(cx + s * 34, headY - 4);
            ctx.quadraticCurveTo(cx + s * 70, headY - 30, cx + s * 52, headY - 54);
            ctx.quadraticCurveTo(cx + s * 40, headY - 28, cx + s * 26, headY - 16);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
    } else if (feature === 'tusks') {
        ctx.fillStyle = '#f0ead6';
        ctx.strokeStyle = '#9a9277';
        ctx.lineWidth = 2;
        for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(cx + s * 10, headY + 18);
            ctx.quadraticCurveTo(cx + s * 16, headY + 34, cx + s * 8, headY + 40);
            ctx.lineTo(cx + s * 4, headY + 22);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
    } else if (feature === 'horns') {
        // Two curved horns sweeping up-and-back from the brow — the berserker.
        const hc = opts.accent || '#d65a3e';
        ctx.fillStyle = '#e8d8c4';
        ctx.strokeStyle = '#6e2017';
        ctx.lineWidth = 2;
        for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(cx + s * 22, headY - 24);
            ctx.quadraticCurveTo(cx + s * 54, headY - 44, cx + s * 50, headY - 78);
            ctx.quadraticCurveTo(cx + s * 40, headY - 50, cx + s * 14, headY - 30);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
        // Glowing brand between the horns.
        ctx.fillStyle = hc;
        ctx.beginPath();
        ctx.arc(cx, headY - 22, 4, 0, TWO_PI);
        ctx.fill();
    } else if (feature === 'hood') {
        // A pointed hood drawn over the crown + cheeks — the assassin.
        const hc = opts.accent || '#5a6e92';
        ctx.fillStyle = hc;
        ctx.strokeStyle = '#222d42';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 40, headY + 6);
        ctx.quadraticCurveTo(cx - 46, headY - 40, cx, headY - 52);
        ctx.quadraticCurveTo(cx + 46, headY - 40, cx + 40, headY + 6);
        ctx.quadraticCurveTo(cx + 22, headY - 14, cx, headY - 16);
        ctx.quadraticCurveTo(cx - 22, headY - 14, cx - 40, headY + 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Shadow inside the cowl.
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.ellipse(cx, headY - 6, 22, 16, 0, 0, TWO_PI);
        ctx.fill();
    } else if (feature === 'hat') {
        const hc = opts.accent || '#5a4b8c';
        ctx.fillStyle = hc;
        ctx.beginPath();
        ctx.moveTo(cx - 40, headY - 26);
        ctx.lineTo(cx + 40, headY - 26);
        ctx.lineTo(cx + 6, headY - 96);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#2c2448';
        ctx.lineWidth = 3;
        ctx.stroke();
        // Brim + star.
        ctx.fillStyle = hc;
        ctx.beginPath();
        ctx.ellipse(cx, headY - 26, 48, 12, 0, 0, TWO_PI);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffe066';
        ctx.beginPath();
        ctx.arc(cx + 2, headY - 56, 5, 0, TWO_PI);
        ctx.fill();
    }

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

// ─── Healer (support) ─────────────────────────────────────────────────
// A hooded green acolyte cradling a pulsing life-orb (the heal tell). The
// orb brightens across the 4 frames so it reads as "actively mending".
function drawHealer(size, frame, count) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2, cy = size / 2;
    const pulse = (Math.sin((frame / count) * TWO_PI) + 1) / 2;

    const ROBE = '#2f7d4a', ROBE_DARK = '#1c4d2e', ROBE_LIGHT = '#52a36c';
    const FACE = '#cfe9d6';
    const ORB = '#9af7b0', ORB_CORE = '#eafff0';

    softShadow(ctx, cx, cy + 52, 44, 9, 0.3);

    // Robe body (tapered teardrop).
    ctx.fillStyle = ROBE;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 40);
    ctx.quadraticCurveTo(cx + 44, cy - 6, cx + 36, cy + 54);
    ctx.lineTo(cx - 36, cy + 54);
    ctx.quadraticCurveTo(cx - 44, cy - 6, cx, cy - 40);
    ctx.closePath();
    ctx.fill();
    // Robe shading + trim.
    ctx.fillStyle = ROBE_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx - 12, cy - 8, 14, 30, -0.2, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = ROBE_DARK; ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 40);
    ctx.quadraticCurveTo(cx + 44, cy - 6, cx + 36, cy + 54);
    ctx.lineTo(cx - 36, cy + 54);
    ctx.quadraticCurveTo(cx - 44, cy - 6, cx, cy - 40);
    ctx.closePath();
    ctx.stroke();
    // Hood opening + face.
    ctx.fillStyle = ROBE_DARK;
    ctx.beginPath(); ctx.ellipse(cx, cy - 26, 18, 20, 0, 0, TWO_PI); ctx.fill();
    ctx.fillStyle = FACE;
    ctx.beginPath(); ctx.ellipse(cx, cy - 22, 11, 13, 0, 0, TWO_PI); ctx.fill();
    ctx.fillStyle = '#1a3322';
    ctx.beginPath(); ctx.arc(cx - 4, cy - 22, 2.4, 0, TWO_PI); ctx.arc(cx + 4, cy - 22, 2.4, 0, TWO_PI); ctx.fill();

    // Pulsing life-orb cradled at the front (the heal tell).
    const orbR = 14 + pulse * 5;
    const g = ctx.createRadialGradient(cx, cy + 16, 2, cx, cy + 16, orbR + 8);
    g.addColorStop(0, ORB_CORE); g.addColorStop(0.5, ORB); g.addColorStop(1, 'rgba(120,240,150,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy + 16, orbR + 8, 0, TWO_PI); ctx.fill();
    ctx.fillStyle = ORB_CORE;
    ctx.beginPath(); ctx.arc(cx, cy + 16, 5 + pulse * 2, 0, TWO_PI); ctx.fill();
    // A small green cross inside the orb.
    ctx.strokeStyle = '#2f7d4a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy + 16 - 6); ctx.lineTo(cx, cy + 16 + 6);
    ctx.moveTo(cx - 6, cy + 16); ctx.lineTo(cx + 6, cy + 16);
    ctx.stroke();
    return canvas;
}

// ─── Shielder (support) ───────────────────────────────────────────────
// A squat steel-blue warden behind a big hex shield plate that shimmers
// (the protection tell). 3 frames of a soft sheen sweep.
function drawShielder(size, frame, count) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2, cy = size / 2;
    const t = frame / count;

    const BODY = '#3a5a86', BODY_DARK = '#243a5a', BODY_LIGHT = '#5e84b8';
    const PLATE = '#8fb6e6', PLATE_DARK = '#3f6398', FACE = '#cdddf2';

    softShadow(ctx, cx, cy + 54, 52, 10, 0.32);

    // Squat body.
    ctx.fillStyle = BODY;
    ctx.beginPath(); ctx.ellipse(cx, cy + 12, 50, 46, 0, 0, TWO_PI); ctx.fill();
    ctx.fillStyle = BODY_LIGHT;
    ctx.beginPath(); ctx.ellipse(cx - 14, cy - 4, 18, 14, -0.3, 0, TWO_PI); ctx.fill();
    ctx.strokeStyle = BODY_DARK; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(cx, cy + 12, 50, 46, 0, 0, TWO_PI); ctx.stroke();
    // Eyes.
    ctx.fillStyle = '#16263e';
    ctx.beginPath(); ctx.arc(cx - 14, cy + 2, 6, 0, TWO_PI); ctx.arc(cx + 14, cy + 2, 6, 0, TWO_PI); ctx.fill();
    ctx.fillStyle = FACE;
    ctx.beginPath(); ctx.arc(cx - 12, cy, 2.2, 0, TWO_PI); ctx.arc(cx + 16, cy, 2.2, 0, TWO_PI); ctx.fill();

    // Hex shield plate held in front.
    const sx = cx, sy = cy + 20, sr = 34;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + i * (TWO_PI / 6);
        const px = sx + Math.cos(a) * sr, py = sy + Math.sin(a) * sr * 0.92;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = PLATE; ctx.fill();
    ctx.strokeStyle = PLATE_DARK; ctx.lineWidth = 4; ctx.stroke();
    // Boss/rivet center + a sheen that sweeps across frames.
    ctx.fillStyle = PLATE_DARK;
    ctx.beginPath(); ctx.arc(sx, sy, 7, 0, TWO_PI); ctx.fill();
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#ffffff';
    const sweep = -sr + t * sr * 2;
    ctx.beginPath();
    ctx.ellipse(sx + sweep, sy, 5, sr * 0.8, 0.3, 0, TWO_PI);
    ctx.clip();
    ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    ctx.restore();
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
// Mite — a tiny, fast, fragile skitterer (small/fast/low-HP archetype). Drawn
// modestly sized in the canvas; the Enemy's small radius + visualScale shrink
// it on screen. 4 frames cycle the leg skitter.
function drawMite(size, frame, count = 4) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const ph = (frame / count) * TWO_PI;
    const sk = Math.sin(ph) * 8;

    const BODY = '#3a2e44';
    const BODY_DARK = '#1e1726';
    const BODY_LIGHT = '#5e4d70';
    const EYE = '#ff5a6a';
    const LEG = '#241c2e';

    softShadow(ctx, cx, cy + 30, 36, 8, 0.4);

    // Six skittering legs (3 per side), alternating with the cycle.
    ctx.strokeStyle = LEG;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
        const ly = cy - 14 + i * 16;
        const swing = (i % 2 === 0 ? sk : -sk);
        ctx.beginPath();
        ctx.moveTo(cx - 22, ly);
        ctx.lineTo(cx - 52, ly + swing);
        ctx.moveTo(cx + 22, ly);
        ctx.lineTo(cx + 52, ly - swing);
        ctx.stroke();
    }

    // Carapace (small rounded abdomen + head).
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, 30, 26, 0, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, cy - 22, 18, 15, 0, 0, TWO_PI);
    ctx.fill();
    // Shell highlight.
    ctx.fillStyle = BODY_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx - 8, cy - 2, 11, 8, -0.4, 0, TWO_PI);
    ctx.fill();
    // Outline.
    ctx.strokeStyle = BODY_DARK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, 30, 26, 0, 0, TWO_PI);
    ctx.stroke();
    // Two glowing eyes.
    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(cx - 7, cy - 24, 4.5, 0, TWO_PI);
    ctx.arc(cx + 7, cy - 24, 4.5, 0, TWO_PI);
    ctx.fill();
    return canvas;
}

// Juggernaut — a huge, slow, heavily-armored brute (big/slow/high-HP
// archetype). A stone golem with glowing cracks. 2 frames: a slow breathe.
function drawJuggernaut(size, frame) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const breathe = frame === 0 ? 0 : 3;

    const ROCK = '#566270';
    const ROCK_DARK = '#2b333d';
    const ROCK_LIGHT = '#828f9c';
    const CRACK = '#ff7a33';
    const EYE = '#ffd166';

    softShadow(ctx, cx, cy + 78, 86, 18, 0.45);

    // Boulder shoulders.
    ctx.fillStyle = ROCK_DARK;
    ctx.beginPath();
    ctx.arc(cx - 66, cy - 14, 26, 0, TWO_PI);
    ctx.arc(cx + 66, cy - 14, 26, 0, TWO_PI);
    ctx.fill();

    // Massive body.
    ctx.fillStyle = ROCK;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, 84 + breathe, 72 + breathe, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = ROCK_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx - 24, cy - 22, 38, 22, -0.3, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = ROCK_DARK;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, 84 + breathe, 72 + breathe, 0, 0, TWO_PI);
    ctx.stroke();

    // Glowing molten cracks across the chest.
    ctx.strokeStyle = CRACK;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 30, cy - 30);
    ctx.lineTo(cx - 10, cy + 2);
    ctx.lineTo(cx - 22, cy + 34);
    ctx.moveTo(cx + 28, cy - 24);
    ctx.lineTo(cx + 12, cy + 8);
    ctx.lineTo(cx + 26, cy + 38);
    ctx.stroke();

    // Heavy brow + two burning eyes.
    ctx.fillStyle = ROCK_DARK;
    ctx.fillRect(cx - 36, cy - 40, 72, 14);
    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(cx - 18, cy - 30, 7, 0, TWO_PI);
    ctx.arc(cx + 18, cy - 30, 7, 0, TWO_PI);
    ctx.fill();
    return canvas;
}

// Speed Demon — a tiny, blistering-fast horror: a lean dart-shaped body with
// swept-back spines and a single furious eye. 4 frames: a fast forward lean +
// flickering spines so it reads as "moving fast" even when still.
function drawSpeedDemon(size, frame, count = 4) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const ph = (frame / count) * TWO_PI;
    const dart = Math.sin(ph) * 6;

    const BODY = '#7a1f1a';
    const BODY_DARK = '#3a0d0a';
    const BODY_LIGHT = '#ff6a4a';
    const SPINE = '#ff8a5a';
    const EYE = '#ffe04a';

    softShadow(ctx, cx, cy + 26, 26, 6, 0.4);

    // Swept-back motion spines (read as speed lines).
    ctx.strokeStyle = SPINE;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - 6, cy + i * 12);
        ctx.lineTo(cx - 40 - dart, cy + i * 20);
        ctx.stroke();
    }

    // Lean dart body, pointed toward travel (right).
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.moveTo(cx + 34 + dart, cy);
    ctx.quadraticCurveTo(cx, cy - 22, cx - 26, cy - 8);
    ctx.quadraticCurveTo(cx - 14, cy, cx - 26, cy + 8);
    ctx.quadraticCurveTo(cx, cy + 22, cx + 34 + dart, cy);
    ctx.fill();
    ctx.fillStyle = BODY_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx + 4, cy - 5, 12, 5, -0.3, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = BODY_DARK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx + 34 + dart, cy);
    ctx.quadraticCurveTo(cx, cy - 22, cx - 26, cy - 8);
    ctx.quadraticCurveTo(cx - 14, cy, cx - 26, cy + 8);
    ctx.quadraticCurveTo(cx, cy + 22, cx + 34 + dart, cy);
    ctx.stroke();

    // One furious eye near the point.
    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(cx + 16, cy - 2, 4.5, 0, TWO_PI);
    ctx.fill();
    return canvas;
}

// Dreadhulk — a genuinely huge, slow TANK: a craggy obsidian colossus, bigger
// and darker than the juggernaut, with cold blue rune-cracks. 2 frames: a
// heavy breathe.
function drawDreadhulk(size, frame) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const breathe = frame === 0 ? 0 : 4;

    const ROCK = '#3c4760';
    const ROCK_DARK = '#171c2a';
    const ROCK_LIGHT = '#6f7ea0';
    const RUNE = '#7fc8ff';
    const EYE = '#bfe8ff';

    softShadow(ctx, cx, cy + 86, 100, 20, 0.5);

    // Massive jagged shoulders.
    ctx.fillStyle = ROCK_DARK;
    ctx.beginPath();
    ctx.arc(cx - 78, cy - 18, 32, 0, TWO_PI);
    ctx.arc(cx + 78, cy - 18, 32, 0, TWO_PI);
    ctx.fill();

    // Enormous core body.
    ctx.fillStyle = ROCK;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 10, 96 + breathe, 84 + breathe, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = ROCK_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx - 28, cy - 26, 44, 26, -0.3, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = ROCK_DARK;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 10, 96 + breathe, 84 + breathe, 0, 0, TWO_PI);
    ctx.stroke();

    // Cold glowing rune-cracks.
    ctx.strokeStyle = RUNE;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 34, cy - 34);
    ctx.lineTo(cx - 12, cy + 4);
    ctx.lineTo(cx - 26, cy + 42);
    ctx.moveTo(cx + 32, cy - 28);
    ctx.lineTo(cx + 14, cy + 10);
    ctx.lineTo(cx + 30, cy + 46);
    ctx.moveTo(cx - 6, cy - 10);
    ctx.lineTo(cx + 6, cy + 22);
    ctx.stroke();

    // Heavy brow + two cold burning eyes.
    ctx.fillStyle = ROCK_DARK;
    ctx.fillRect(cx - 42, cy - 46, 84, 16);
    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(cx - 21, cy - 35, 8, 0, TWO_PI);
    ctx.arc(cx + 21, cy - 35, 8, 0, TWO_PI);
    ctx.fill();
    return canvas;
}

// Brawler — a stocky mid-weight bruiser with real pace: a hunched ember-lit
// fighter with big fists. 2 frames: a shoulder-roll swagger.
function drawBrawler(size, frame) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const roll = frame === 1 ? 5 : 0;

    const BODY = '#9a5a2a';
    const BODY_DARK = '#4a2810';
    const BODY_LIGHT = '#e0974a';
    const FIST = '#5a3418';
    const EYE = '#ffd24a';

    softShadow(ctx, cx, cy + 50, 56, 12, 0.42);

    // Big fists out front (offset by the swagger roll).
    ctx.fillStyle = FIST;
    ctx.beginPath();
    ctx.arc(cx - 46, cy + 18 - roll, 20, 0, TWO_PI);
    ctx.arc(cx + 46, cy + 18 + roll, 20, 0, TWO_PI);
    ctx.fill();

    // Hunched torso.
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, 52, 50, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = BODY_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx - 14, cy - 12, 24, 16, -0.3, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = BODY_DARK;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, 52, 50, 0, 0, TWO_PI);
    ctx.stroke();

    // Low jutting head + brow.
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 30, 26, 22, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = BODY_DARK;
    ctx.fillRect(cx - 24, cy - 38, 48, 10);
    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(cx - 11, cy - 30, 5, 0, TWO_PI);
    ctx.arc(cx + 11, cy - 30, 5, 0, TWO_PI);
    ctx.fill();
    return canvas;
}

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

// Cacklemaw — the third boss: a grinning, many-armed lavender orb (a tentacled
// "sun"/spider with a big dark eye + a wide toothy grin). Frames wave the arms.
function drawGloomMaw(size, frame, count) {
    const canvas = newSpriteCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const phase = (frame / count) * TWO_PI;

    const BODY = '#b59ad6';
    const BODY_LIGHT = '#dccaf0';
    const BODY_DARK = '#7d5fae';
    const ARM = '#9a7ec6';
    const ARM_DARK = '#6b4f9c';
    const MOTTLE = '#5d3f86';
    const EYE = '#241032';
    const EYE_SHINE = '#cdb3ff';
    const TEETH = '#f4eef9';
    const GUM = '#3a2350';

    softShadow(ctx, cx, cy + 56, 60, 14, 0.42);

    // Menacing purple aura.
    const aura = ctx.createRadialGradient(cx, cy, 10, cx, cy, 92);
    aura.addColorStop(0, 'rgba(170, 120, 230, 0.20)');
    aura.addColorStop(1, 'rgba(170, 120, 230, 0)');
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, size, size);

    // Radiating tentacle arms (drawn first so the body overlaps their roots).
    const ARMS = 10;
    for (let i = 0; i < ARMS; i++) {
        const wig = Math.sin(phase * 2 + i * 0.7) * 0.16;
        const ang = (i / ARMS) * TWO_PI + wig;
        const bx = cx + Math.cos(ang) * 28, by = cy + Math.sin(ang) * 28;
        const tx = cx + Math.cos(ang) * 80, ty = cy + Math.sin(ang) * 80;
        const px = -Math.sin(ang), py = Math.cos(ang);
        const bw = 9, tw = 3;
        ctx.fillStyle = (i % 2) ? ARM : ARM_DARK;
        ctx.beginPath();
        ctx.moveTo(bx + px * bw, by + py * bw);
        ctx.quadraticCurveTo(cx + Math.cos(ang) * 56 + px * 6, cy + Math.sin(ang) * 56 + py * 6, tx + px * tw, ty + py * tw);
        ctx.lineTo(tx - px * tw, ty - py * tw);
        ctx.quadraticCurveTo(cx + Math.cos(ang) * 56 - px * 6, cy + Math.sin(ang) * 56 - py * 6, bx - px * bw, by - py * bw);
        ctx.closePath();
        ctx.fill();
        // Suction tip.
        ctx.fillStyle = MOTTLE;
        ctx.beginPath();
        ctx.arc(tx, ty, 3.2, 0, TWO_PI);
        ctx.fill();
    }

    // Body orb.
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.arc(cx, cy, 40, 0, TWO_PI);
    ctx.fill();
    // Shading rim + highlight.
    ctx.fillStyle = BODY_DARK;
    ctx.beginPath();
    ctx.arc(cx, cy + 6, 40, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.fill();
    ctx.fillStyle = BODY_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx - 12, cy - 14, 13, 9, -0.5, 0, TWO_PI);
    ctx.fill();
    // Mottles.
    ctx.fillStyle = MOTTLE;
    for (const m of [[-20, -2, 4], [16, 6, 5], [4, 18, 3], [-8, 10, 3]]) {
        ctx.beginPath(); ctx.arc(cx + m[0], cy + m[1], m[2], 0, TWO_PI); ctx.fill();
    }

    // Big single eye (upper-center), dark + glossy.
    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 8, 16, 18, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = EYE_SHINE;
    ctx.beginPath();
    ctx.arc(cx - 6, cy - 14, 4.5, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = 'rgba(205,179,255,0.55)';
    ctx.beginPath();
    ctx.arc(cx + 5, cy - 4, 2.4, 0, TWO_PI);
    ctx.fill();

    // Wide toothy grin across the lower body (the signature cackle).
    const grin = 30 + Math.sin(phase) * 2;
    ctx.fillStyle = GUM;
    ctx.beginPath();
    ctx.moveTo(cx - grin, cy + 14);
    ctx.quadraticCurveTo(cx, cy + 34, cx + grin, cy + 14);
    ctx.quadraticCurveTo(cx, cy + 24, cx - grin, cy + 14);
    ctx.closePath();
    ctx.fill();
    // Square teeth.
    ctx.fillStyle = TEETH;
    const teeth = 7;
    for (let i = 0; i < teeth; i++) {
        const f = i / (teeth - 1);
        const txx = cx - grin + f * grin * 2;
        const drop = Math.sin(f * Math.PI) * 5; // follow the smile curve
        ctx.fillRect(txx - 3.4, cy + 13 + drop, 6.8, 8);
    }

    return canvas;
}

// ─── Chest ────────────────────────────────────────────────────────────
// 3 frames: 0 closed, 1 mid-open, 2 fully open.

function drawChest(frame) {
    const W = 96;
    const H = 96;
    const canvas = ssCanvas(W, H);
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

// Rare health pickup: a glowing red life-orb with a white medic cross.
// 2 frames: a gentle pulse (bigger cross glow on frame 1).
function drawHealthOrb(frame) {
    const W = 34;
    const canvas = ssCanvas(W, W);
    const ctx = canvas.getContext('2d');
    const cx = W / 2, cy = W / 2;
    const pulse = frame === 0 ? 0 : 1;

    // Outer life glow.
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, W / 2);
    glow.addColorStop(0, 'rgba(255,160,170,0.95)');
    glow.addColorStop(0.5, 'rgba(255,70,90,0.6)');
    glow.addColorStop(1, 'rgba(255,60,80,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, W);

    // Orb body.
    const r = 10 + pulse;
    ctx.fillStyle = '#e23b4e';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TWO_PI); ctx.fill();
    ctx.fillStyle = '#ff8090';
    ctx.beginPath(); ctx.arc(cx - 3, cy - 3, r * 0.5, 0, TWO_PI); ctx.fill();
    ctx.strokeStyle = '#7a1420'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TWO_PI); ctx.stroke();

    // White medic cross.
    ctx.fillStyle = '#ffffff';
    const t = 3, a = 7;
    ctx.fillRect(cx - t / 2, cy - a / 2, t, a);
    ctx.fillRect(cx - a / 2, cy - t / 2, a, t);
    return canvas;
}

function drawCoin(frame, count) {
    const W = 32;
    const canvas = ssCanvas(W, W);
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
    const canvas = ssCanvas(W, H);
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
    const canvas = ssCanvas(W, H);
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

    const canvas = ssCanvas(size, size);
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
    return ssCanvas(w, h);
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
