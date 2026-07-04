// HeroAiSprites — the HQ pixel-art hero BODY (higgsfield / Nano Banana 2,
// upgraded from the procedural monkey with the same silhouette + anchors),
// pre-rendered as one 7-frame sheet per direction under assets/hero/:
//   cols: idle0, idle1(blink), walk0, walk1(rise), walk2, cast, hurt
//   files: monkey_down.png / monkey_up.png / monkey_side.png
//
// ONE shared body serves ALL six heroes: each character's set is built from
// the base frames + that hero's palette tint (source-atop, like the fur
// cosmetic tint) + its code-drawn feature overlay (elf ears / tusks / horns /
// hood / hat via drawHeroFeatureOverlay) composited at build time, so the
// existing cosmetics/tint/weapon-arm pipeline works unchanged on top.
//
// loadHeroAiSprites() NEVER rejects; getAiHeroFrames() returns null until the
// sheets load (and permanently on failure), and ProceduralSprites.getHeroFrames
// falls back to the procedural body — the game always renders.

import { SPRITE_SIZE } from '../config/GameConfig.js';
import { drawHeroFeatureOverlay, HERO_BOB } from './PixelArt.js';

const DIRS = ['down', 'up', 'side'];
const COLS = 7;
// col index per pose/frame — matches tools/artshot/hero-pack.mjs output.
const POSE_COLS = { idle: [0, 1], walk: [2, 3, 4], cast: [5], hurt: [6] };

const _sheets = { down: null, up: null, side: null };   // Image | null
let _loadPromise = null;
let _ready = false;
const _heroCache = new Map();   // hero id -> built dirs set

function loadImage(dir) {
    return new Promise((resolve) => {
        try {
            const im = new Image();
            im.onload = () => { _sheets[dir] = im; resolve(true); };
            im.onerror = () => { _sheets[dir] = null; resolve(false); };
            im.src = new URL(`./hero/monkey_${dir}.png`, import.meta.url).href;
        } catch (e) { _sheets[dir] = null; resolve(false); }
    });
}

// Kick the sheet loads; resolves true when ALL three directions loaded.
export function loadHeroAiSprites() {
    if (_loadPromise) return _loadPromise;
    _loadPromise = Promise.all(DIRS.map(loadImage)).then((r) => {
        _ready = r.every(Boolean);
        return _ready;
    });
    return _loadPromise;
}

// Slice one frame col from a sheet into a SPRITE_SIZE canvas, tint it toward
// the hero palette (mirrors the fur-cosmetic tint), and composite the hero's
// feature overlay with the frame's HERO_BOB offset so features ride the head.
function buildFrame(sheet, col, char, dir, pose, frameIdx) {
    const cw = Math.floor(sheet.width / COLS);
    const cv = document.createElement('canvas');
    cv.width = SPRITE_SIZE; cv.height = SPRITE_SIZE;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = false;    // crisp pixel upscale
    cx.drawImage(sheet, col * cw, 0, cw, sheet.height, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
    // Palette tint: the base body is the monkey's warm brown; other heroes
    // shift toward their own fur colour (same source-atop mechanism as the
    // fur cosmetic, so hues compose predictably).
    const fur = char?.palette?.fur;
    if (fur && char.id !== 'monkey') {
        cx.globalCompositeOperation = 'source-atop';
        // Hues near the base's warm brown (elf/orc greens) need a stronger
        // wash to survive the warm in-game player-light halo — those heroes
        // carry a per-character tintAlpha; the default 0.38 keeps the far
        // hues (purple/red/navy) subtle.
        cx.globalAlpha = char.tintAlpha || 0.38;
        cx.fillStyle = fur;
        cx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
        cx.globalCompositeOperation = 'source-over';
        cx.globalAlpha = 1;
    }
    // Feature overlay (elf ears / tusks / horns / hood / hat).
    if (char?.feature) {
        const hb = HERO_BOB[pose] || [0];
        const bob = hb[frameIdx % hb.length] || 0;
        const ov = drawHeroFeatureOverlay(
            { palette: char.palette, accent: char.accent, feature: char.feature }, dir, bob);
        if (ov) cx.drawImage(ov, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
    }
    return cv;
}

// Build (once per hero) the { kind, dirs } set from the loaded sheets, or null
// if the sheets aren't ready / failed — caller falls back to procedural.
export function getAiHeroFrames(id, char) {
    if (!_ready) return null;
    if (_heroCache.has(id)) return _heroCache.get(id);
    let set = null;
    try {
        const dirs = {};
        for (const dir of DIRS) {
            const sheet = _sheets[dir];
            const d = {};
            for (const pose in POSE_COLS) {
                d[pose] = POSE_COLS[pose].map((col, i) => buildFrame(sheet, col, char, dir, pose, i));
            }
            dirs[dir] = d;
        }
        set = { kind: 'pixel', dirs };
    } catch (e) { set = null; }
    _heroCache.set(id, set);
    return set;
}
