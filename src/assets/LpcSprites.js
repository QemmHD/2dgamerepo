// LPC (Liberated Pixel Cup) imported enemy art.
//
// These are REAL external pixel-art spritesheets from the Universal LPC
// Spritesheet Generator, licensed OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0. Full
// per-asset attribution lives in src/assets/lpc/CREDITS.md (shipped with the
// build). Unlike the rest of the game's procedural art, these load from PNG
// files at boot.
//
// Sheet layout (LPC "walk" standard): a 9×4 grid of 64×64 cells —
//   row 0 = facing UP (north), row 1 = LEFT, row 2 = DOWN (south), row 3 = RIGHT
//   col 0 = idle/standing, cols 1..8 = the 8-frame walk cycle
// We slice the 8 walk frames per direction, upscaled (nearest-neighbour, so it
// stays crisp pixel art) to SPRITE_SIZE to match the enemy draw box.
//
// Robustness: loadLpcSprites() NEVER rejects. If a PNG fails to load (offline,
// missing on the deploy), the affected model falls back to a procedural sprite
// so the game always runs.

import { SPRITE_SIZE } from '../config/GameConfig.js';
import { getBruteFrames } from './ProceduralSprites.js';
import { recolorCanvas } from '../render/recolor.js';

const CELL = 64;          // LPC source cell size
const COLS = 9, ROWS = 4; // walk sheet grid
const WALK_COLS = [1, 2, 3, 4, 5, 6, 7, 8]; // 8-frame cycle (skip idle col 0)
const ROW = { up: 0, left: 1, down: 2, right: 3 };

// model id → { file, recolor? }. recolor (optional) is a {op,color,alpha}
// tint applied per frame so one source sheet yields extra variants.
const MODELS = {
    // Real LPC skeleton body — bare bones, instantly readable.
    skeleton:     { file: 'skeleton_walk.png' },
    // Rotting walker: the LPC human body sheet multiplied toward sickly green
    // so it reads as a decayed zombie rather than a living person.
    zombie:       { file: 'zombie_walk.png', recolor: { op: 'multiply', color: '#86b85f', alpha: 0.82 } },
    // Ember-scorched skeleton: the bone sheet multiplied toward hot orange —
    // a distinct fire-themed model from the same source art.
    emberskeleton: { file: 'skeleton_walk.png', recolor: { op: 'multiply', color: '#ff7a3c', alpha: 0.85 } },
    // Real LPC orc body — heavy green brute, used for the melee "brute" enemy.
    orc:          { file: 'orc_walk.png' },
};

const cache = new Map();   // id → { up:[canvas], left, down, right }
let loaded = false;

function lpcUrl(file) {
    return new URL(`./lpc/${file}`, import.meta.url).href;
}

function loadImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

// Slice one direction's 8 walk frames, upscaled crisp to SPRITE_SIZE. An
// optional recolor spec ({op,color,alpha}) is applied via the shared recolor
// utility (same path the customizable-icon/cosmetic system uses).
function sliceDir(img, rowIdx, recolor) {
    const frames = [];
    for (const col of WALK_COLS) {
        const c = document.createElement('canvas');
        c.width = SPRITE_SIZE; c.height = SPRITE_SIZE;
        const cx = c.getContext('2d');
        cx.imageSmoothingEnabled = false; // nearest-neighbour upscale → crisp
        cx.drawImage(img, col * CELL, rowIdx * CELL, CELL, CELL, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
        frames.push(recolor ? recolorCanvas(c, recolor) : c);
    }
    return frames;
}

// Load + slice every LPC model. Resolves (never rejects) once all attempts
// settle. Call once at boot, before the game starts spawning.
export async function loadLpcSprites() {
    if (loaded) return true;
    const ids = Object.keys(MODELS);
    const imgs = await Promise.all(ids.map((id) => loadImage(lpcUrl(MODELS[id].file))));
    let anyOk = false;
    ids.forEach((id, i) => {
        const img = imgs[i];
        if (!img) return; // leave uncached → getLpcFrames falls back
        const { recolor } = MODELS[id];
        cache.set(id, {
            up: sliceDir(img, ROW.up, recolor),
            left: sliceDir(img, ROW.left, recolor),
            down: sliceDir(img, ROW.down, recolor),
            right: sliceDir(img, ROW.right, recolor),
        });
        anyOk = true;
    });
    loaded = true;
    return anyOk;
}

// Is `id` a known LPC model? (Used to validate enemy wiring.)
export function isLpcModel(id) {
    return Object.prototype.hasOwnProperty.call(MODELS, id);
}

// Directional frame set for an LPC model: { up, left, down, right } each an
// array of SPRITE_SIZE canvases. If the sheet failed to load (or we're headless
// with no Image), every direction falls back to a procedural sprite so callers
// never get null — the enemy still animates, just with stand-in art.
export function getLpcFrames(id) {
    const hit = cache.get(id);
    if (hit) return hit;
    const fb = getBruteFrames();
    return { up: fb, left: fb, down: fb, right: fb };
}
