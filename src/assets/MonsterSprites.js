// Imported LPC monster sprites — real CC-BY-SA 3.0 / GPL 3.0 creature art from
// the "[LPC] Monsters" pack (Charles Sanchez / CharlesGabriel, bagzie,
// bluecarrot16). These UPDATE the game's original procedural creature enemies
// (slime, bat, crawler, spitter, mite) with hand-pixelled animated sprites that
// match the imported LPC humanoids.
//
// Sheet layout: a grid of 64×64 cells, 4 rows = facing directions
// (up / left / down / right), each row an animation cycle of N frames (with
// trailing blank cells on some sheets). The game's creature enemies are
// non-directional, so we slice the DOWN row (facing the camera) and upscale it
// crisp to SPRITE_SIZE — fully-transparent trailing cells are dropped so we get
// exactly the populated frames.
//
// Robustness mirrors LpcSprites: loadMonsterSprites() NEVER rejects. If a PNG
// fails to load, getMonsterFrames() returns null and Enemy.js falls back to the
// original procedural drawer, so the game always renders.

import { SPRITE_SIZE } from '../config/GameConfig.js';

const CELL = 64;

// enemy type → { file, row }. row indexes the facing (2 = down/front). The bee
// sheet only has 2 rows, so the mite uses its top row.
const MONSTERS = {
    slime:   { file: 'slime.png',   row: 2 },
    bat:     { file: 'bat.png',     row: 2 },
    crawler: { file: 'snake.png',   row: 2 },
    spitter: { file: 'eyeball.png', row: 2 },
    mite:    { file: 'bee.png',     row: 0 },
};

const cache = new Map();   // type → [canvas]
let loaded = false;

function monUrl(file) {
    return new URL(`./monsters/${file}`, import.meta.url).href;
}

function loadImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

// Is a 64×64 source cell entirely transparent? (Used to drop trailing blanks.)
function cellBlank(img, sx, sy) {
    const c = document.createElement('canvas');
    c.width = CELL; c.height = CELL;
    const cx = c.getContext('2d');
    cx.drawImage(img, sx, sy, CELL, CELL, 0, 0, CELL, CELL);
    const d = cx.getImageData(0, 0, CELL, CELL).data;
    for (let p = 3; p < d.length; p += 4) if (d[p] > 8) return false;
    return true;
}

// Slice the populated frames of `row`, each upscaled crisp to SPRITE_SIZE.
function sliceRow(img, row) {
    const cols = Math.floor(img.width / CELL);
    const sy = row * CELL;
    const frames = [];
    for (let col = 0; col < cols; col++) {
        const sx = col * CELL;
        if (cellBlank(img, sx, sy)) continue;
        const c = document.createElement('canvas');
        c.width = SPRITE_SIZE; c.height = SPRITE_SIZE;
        const cx = c.getContext('2d');
        cx.imageSmoothingEnabled = false; // nearest-neighbour → crisp pixel art
        cx.drawImage(img, sx, sy, CELL, CELL, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
        frames.push(c);
    }
    return frames;
}

// Load + slice every monster sprite. Resolves (never rejects) once settled.
// Call once at boot. Returns true if at least one sheet loaded.
export async function loadMonsterSprites() {
    if (loaded) return true;
    const ids = Object.keys(MONSTERS);
    const imgs = await Promise.all(ids.map((id) => loadImage(monUrl(MONSTERS[id].file))));
    let anyOk = false;
    ids.forEach((id, i) => {
        const img = imgs[i];
        if (!img) return; // leave uncached → getMonsterFrames falls back
        const frames = sliceRow(img, MONSTERS[id].row);
        if (frames.length) { cache.set(id, frames); anyOk = true; }
    });
    loaded = true;
    return anyOk;
}

// Frame array for an imported monster, or null if its sheet failed to load
// (Enemy.js then uses the original procedural drawer).
export function getMonsterFrames(type) {
    return cache.get(type) ?? null;
}
