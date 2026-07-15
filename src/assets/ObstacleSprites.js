// ObstacleSprites — AI hi-bit pixel art for the world's obstacles + buildings
// (higgsfield / Nano Banana 2, keyed + fitted via tools/artshot/gridcut.html).
//
// Three sprite families, all optional at runtime:
//   FILES         one keyed PNG per obstacle archetype (MAP_OBJECTS types),
//                 authored to the archetype's visual size aspect and anchored
//                 bottom-center — Obstacle.draw blits it into the same box the
//                 procedural art fills, so sorting/occlusion/collision are
//                 untouched.
//   WALL_FILES    seamless wall texture per building style; consumed as a
//                 repeating CanvasPattern by Obstacle._drawBuildingWall.
//   FLOOR_FILES   interior floor decal per building style, drawn by
//                 Obstacle._drawBuildingFloor.
//
// loadObstacleSprites() NEVER rejects; every getter returns null until loaded
// (and permanently on a failed file), so the procedural drawing in Obstacle.js
// remains the always-working fallback.

const FILES = {
    tree: 'tree.png',
    brokenTower: 'broken_tower.png',
    statue: 'statue.png',
    pillar: 'pillar.png',
    well: 'well.png',
    ruinedWall: 'ruined_wall.png',
    barricade: 'barricade.png',
    fence: 'fence.png',
    crate: 'crate.png',
    barrel: 'barrel.png',
    stoneBlock: 'stone_block.png',
    graveMarker: 'grave_marker.png',
    cactus: 'cactus.png',
};

const WALL_FILES = {
    cabin: 'wall_cabin.png',
    ruin: 'wall_ruin.png',
    keep: 'wall_keep.png',
    adobe: 'wall_adobe.png',
};

const FLOOR_FILES = {
    cabin: 'floor_cabin.png',
    // House V2 uses an original clean-board material. Unlike the legacy cabin
    // composite, it contains no baked fireplace, rug, furniture, or wall art,
    // so the authored blueprint remains the only room/furnishing authority.
    cabinClean: 'floor_cabin_clean.png',
    ruin: 'floor_ruin.png',
    keep: 'floor_keep.png',
    adobe: 'floor_adobe.png',
};

// Original Blender-rendered furnishings for the first House V2 cabin.  They
// share the same never-rejecting loader/fallback contract as world obstacles.
const HOUSE_PROP_FILES = {
    cabinBed: 'cabin_bed.png',
    cabinHearth: 'cabin_hearth.png',
    cabinTable: 'cabin_table.png',
    cabinShelf: 'cabin_shelf.png',
    cabinCrate: 'cabin_crate.png',
    cabinBarrel: 'cabin_barrel.png',
    ruinBell: 'ruin_bell.png',
};

// World-border palisade: a horizontally-seamless stockade strip ringing the
// playable area (drawn by Game._drawWorldBounds), replacing the dashed rect.
const BORDER_FILE = 'border_palisade.png';

const sprites = new Map();     // key → HTMLCanvasElement | null
const tinted = new Map();      // key|color|amt → HTMLCanvasElement
const patterns = new Map();    // style → CanvasPattern | null
let _loadPromise = null;

function url(file) {
    return new URL(`./obstacles/${file}`, import.meta.url).href;
}

function loadOne(key, file) {
    return new Promise((resolve) => {
        try {
            const im = new Image();
            // The onload body needs its OWN try/catch: a throw here (e.g.
            // getContext returning null under canvas-memory pressure) happens
            // after the outer try exits and would strand the promise — and
            // boot awaits us, so a stranded promise would hang the game.
            im.onload = () => {
                try {
                    const c = document.createElement('canvas');
                    c.width = im.width; c.height = im.height;
                    c.getContext('2d').drawImage(im, 0, 0);
                    sprites.set(key, c);
                    resolve(true);
                } catch (e) { sprites.set(key, null); resolve(false); }
            };
            im.onerror = () => { sprites.set(key, null); resolve(false); };
            im.src = url(file);
        } catch (e) { sprites.set(key, null); resolve(false); }
    });
}

// Load everything (obstacles + wall textures + floor decals + border strip).
// Never rejects.
export function loadObstacleSprites() {
    if (_loadPromise) return _loadPromise;
    const jobs = [];
    for (const t in FILES) jobs.push(loadOne('ob:' + t, FILES[t]));
    for (const s in WALL_FILES) jobs.push(loadOne('wall:' + s, WALL_FILES[s]));
    for (const s in FLOOR_FILES) jobs.push(loadOne('floor:' + s, FLOOR_FILES[s]));
    for (const key in HOUSE_PROP_FILES) jobs.push(loadOne('house:' + key, HOUSE_PROP_FILES[key]));
    jobs.push(loadOne('border', BORDER_FILE));
    _loadPromise = Promise.all(jobs).then((r) => r.some(Boolean));
    return _loadPromise;
}

// Biome-tinted copy of a sprite (mirrors ObstacleSystem.tintPalette's lerp for
// the procedural palettes): a source-atop colour wash at the biome amount.
// Cached per (key, color, amt) — a handful of biomes × types, all built once.
function tintSprite(base, key, tint) {
    const tKey = key + '|' + tint.color + '|' + tint.amt;
    let c = tinted.get(tKey);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = base.width; c.height = base.height;
    const cx = c.getContext('2d');
    cx.drawImage(base, 0, 0);
    cx.globalCompositeOperation = 'source-atop';
    cx.globalAlpha = Math.min(1, tint.amt);
    cx.fillStyle = tint.color;
    cx.fillRect(0, 0, c.width, c.height);
    tinted.set(tKey, c);
    return c;
}

// AI sprite for an obstacle archetype (optionally biome-tinted), or null →
// caller falls back to the procedural draw.
export function getObstacleSprite(type, tint = null) {
    const base = sprites.get('ob:' + type);
    if (!base) return null;
    if (tint && tint.amt > 0.01) {
        try { return tintSprite(base, 'ob:' + type, tint); } catch (e) { return base; }
    }
    return base;
}

// Repeating wall-texture pattern for a building style, or null. Patterns are
// created lazily against the live ctx (any 2d ctx works for cache purposes).
export function getWallPattern(style, ctx) {
    if (patterns.has(style)) return patterns.get(style);
    const tex = sprites.get('wall:' + style);
    let pat = null;
    if (tex) {
        try { pat = ctx.createPattern(tex, 'repeat'); } catch (e) { pat = null; }
    }
    patterns.set(style, pat);
    return pat;
}

// Interior floor decal canvas for a building style, or null.
export function getFloorDecal(style) {
    return sprites.get('floor:' + style) || null;
}

// Authored House V2 prop canvas, or null while loading / after failure.
export function getHousePropSprite(key) {
    return sprites.get('house:' + key) || null;
}

// World-border palisade strip canvas (or null → dashed-rect fallback).
export function getBorderStrip() {
    return sprites.get('border') || null;
}

// Repeating pattern of the border strip (created lazily, cached like walls).
export function getBorderPattern(ctx) {
    if (patterns.has('__border')) return patterns.get('__border');
    const tex = sprites.get('border');
    let pat = null;
    if (tex) {
        try { pat = ctx.createPattern(tex, 'repeat'); } catch (e) { pat = null; }
    }
    patterns.set('__border', pat);
    return pat;
}
