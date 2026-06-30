// Imported LPC boss sprites — real CC-BY-SA 3.0 / GPL 3.0 creature art from the
// "[LPC] Monsters" pack (Charles Sanchez/CharlesGabriel, bagzie, bluecarrot16),
// recolored per boss so all 12 bosses get a real model that matches the new
// LPC cast. The big creatures (flower/ghost/pumpkin/worm) are 128px cells —
// boss-scale — so they upscale cleanly; eyeball/bat are 64px; the bone bosses
// reuse the imported LPC skeleton body.
//
// Each boss is one base creature + a multiply tint (cached), so a handful of
// source sheets yields 12 distinct, themed bosses. Robust: loadBossSprites()
// never rejects, and getBossFrames() returns null (→ procedural boss art) if a
// sheet didn't load.

import { SPRITE_SIZE } from '../config/GameConfig.js';
import { recolorCanvas } from '../render/recolor.js';
import { getLpcFrames } from './LpcSprites.js';

// Base creature sheets. row = the animation row to use as the idle loop;
// cell = source cell size (128 for the big bosses, 64 for eyeball/bat).
const SHEETS = {
    flower:   { file: 'man_eater_flower.png', cell: 128, row: 1 },
    ghost:    { file: 'ghost.png',            cell: 64,  row: 2 },
    pumpking: { file: 'pumpking.png',         cell: 64,  row: 2 },
    worm:     { file: 'big_worm.png',         cell: 64,  row: 2 },
    eyeball:  { file: 'eyeball.png',          cell: 64,  row: 2 },
    bat:      { file: 'bat.png',              cell: 64,  row: 2 },
};

// boss type → { base, recolor? }. base is a SHEETS key or 'skeleton' (the
// imported LPC skeleton body). recolor is a {op,color,alpha} multiply tint.
const BOSSES = {
    vinebackGoliath: { base: 'flower' },                                                  // plant tyrant (native green/gold)
    stormwingAlpha:  { base: 'bat',      recolor: { op: 'multiply', color: '#7fb4ff', alpha: 0.6 } }, // storm wing
    gloomMaw:        { base: 'pumpking', recolor: { op: 'multiply', color: '#7a5aa8', alpha: 0.6 } }, // grinning hollow
    rimewarden:      { base: 'ghost',    recolor: { op: 'multiply', color: '#a6dcff', alpha: 0.55 } },// long frost
    hoarfang:        { base: 'worm',     recolor: { op: 'multiply', color: '#8fd2ea', alpha: 0.55 } },// sleet serpent
    aurorath:        { base: 'ghost',    recolor: { op: 'multiply', color: '#ffe39a', alpha: 0.5 } }, // radiant
    ossuar:          { base: 'skeleton' },                                                // bonecaller (native bone)
    mourndrift:      { base: 'ghost' },                                                    // wailing wraith (native)
    nihagault:       { base: 'eyeball',  recolor: { op: 'multiply', color: '#b15cff', alpha: 0.6 } }, // hungering void
    dunescourge:     { base: 'worm',     recolor: { op: 'multiply', color: '#d8b46a', alpha: 0.55 } },// desert worm
    cindermaw:       { base: 'pumpking', recolor: { op: 'multiply', color: '#ff8a3c', alpha: 0.55 } },// ember jaw
    solnakh:         { base: 'skeleton', recolor: { op: 'multiply', color: '#ff7a3c', alpha: 0.7 } }, // burning crown
};

const sheetCache = new Map();  // sheet key → [canvas] (SPRITE_SIZE frames)
const builtCache = new Map();  // boss type → [canvas] (recolored, cached)
let loaded = false;

function bossUrl(file) {
    return new URL(`./bosses/${file}`, import.meta.url).href;
}

function loadImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

function cellBlank(img, sx, sy, cell) {
    const c = document.createElement('canvas');
    c.width = cell; c.height = cell;
    const cx = c.getContext('2d');
    cx.drawImage(img, sx, sy, cell, cell, 0, 0, cell, cell);
    const d = cx.getImageData(0, 0, cell, cell).data;
    for (let p = 3; p < d.length; p += 4) if (d[p] > 8) return false;
    return true;
}

// Slice the populated frames of one row, each upscaled crisp to SPRITE_SIZE.
function sliceRow(img, cell, row) {
    const cols = Math.floor(img.width / cell);
    const sy = row * cell;
    const frames = [];
    for (let col = 0; col < cols; col++) {
        const sx = col * cell;
        if (cellBlank(img, sx, sy, cell)) continue;
        const c = document.createElement('canvas');
        c.width = SPRITE_SIZE; c.height = SPRITE_SIZE;
        const cx = c.getContext('2d');
        cx.imageSmoothingEnabled = false;
        cx.drawImage(img, sx, sy, cell, cell, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
        frames.push(c);
    }
    return frames;
}

// Load + slice every base sheet. Resolves (never rejects). Call once at boot.
export async function loadBossSprites() {
    if (loaded) return true;
    const keys = Object.keys(SHEETS);
    const imgs = await Promise.all(keys.map((k) => loadImage(bossUrl(SHEETS[k].file))));
    let anyOk = false;
    keys.forEach((k, i) => {
        const img = imgs[i];
        if (!img) return;
        const { cell, row } = SHEETS[k];
        const frames = sliceRow(img, cell, row);
        if (frames.length) { sheetCache.set(k, frames); anyOk = true; }
    });
    loaded = true;
    return anyOk;
}

// Recolored frame set for a boss, built+cached on first use (so it works
// regardless of asset load order — the skeleton base reads from LpcSprites).
// Returns null if the base art isn't available → Enemy.js uses procedural art.
export function getBossFrames(type) {
    if (builtCache.has(type)) return builtCache.get(type);
    const def = BOSSES[type];
    if (!def) return null;
    let base;
    if (def.base === 'skeleton') {
        const lp = getLpcFrames('skeleton');
        base = lp && lp.down;
    } else {
        base = sheetCache.get(def.base);
    }
    if (!base || !base.length) return null;
    const frames = def.recolor
        ? base.map((f, i) => recolorCanvas(f, def.recolor, `bossart:${type}#${i}`))
        : base;
    builtCache.set(type, frames);
    return frames;
}
