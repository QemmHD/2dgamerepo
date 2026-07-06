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

// Heroes that ship a BESPOKE Blender body sheet set (distinct proportions +
// baked palette) beside the shared monkey base. A hero not listed here — or one
// whose set fails to load — falls back to the monkey base + a palette tint, so
// the roster never breaks.
const BESPOKE = ['elf', 'orc', 'wizard', 'berserker', 'assassin'];

const _heroSheets = {};   // heroId -> { down, up, side: Image }  (only if all 3 loaded)
let _loadPromise = null;
let _ready = false;       // true once the monkey BASE is loaded (procedural gate)
const _heroCache = new Map();   // hero id -> built dirs set

function loadSheet(heroId, dir) {
    return new Promise((resolve) => {
        try {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => resolve(null);
            im.src = new URL(`./hero/${heroId}_${dir}.png`, import.meta.url).href;
        } catch (e) { resolve(null); }
    });
}

// Load one hero's 3-direction set; registers it only if ALL three loaded.
async function loadHeroSet(heroId) {
    const imgs = await Promise.all(DIRS.map((d) => loadSheet(heroId, d)));
    if (imgs.every(Boolean)) {
        _heroSheets[heroId] = { down: imgs[0], up: imgs[1], side: imgs[2] };
        return true;
    }
    return false;
}

// Kick the sheet loads; resolves true once the monkey BASE is up (the gate for
// the AI-body tier). Bespoke hero bodies are optional and loaded in parallel —
// any that miss simply fall back to the monkey base + tint for that hero.
export function loadHeroAiSprites() {
    if (_loadPromise) return _loadPromise;
    _loadPromise = (async () => {
        const monkeyOk = await loadHeroSet('monkey');
        _ready = monkeyOk;
        await Promise.all(BESPOKE.map(loadHeroSet));
        return _ready;
    })();
    return _loadPromise;
}

// Slice one frame col from a sheet into a SPRITE_SIZE canvas, tint it toward
// the hero palette (mirrors the fur-cosmetic tint), and composite the hero's
// feature overlay with the frame's HERO_BOB offset so features ride the head.
function buildFrame(sheet, col, char, dir, pose, frameIdx, skipTint) {
    const cw = Math.floor(sheet.width / COLS);
    const cv = document.createElement('canvas');
    cv.width = SPRITE_SIZE; cv.height = SPRITE_SIZE;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = false;    // crisp pixel upscale
    cx.drawImage(sheet, col * cw, 0, cw, sheet.height, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
    // Palette tint: when a hero is drawn on the shared MONKEY base its warm
    // brown is washed toward that hero's fur colour. A hero with its OWN
    // bespoke sheet already bakes its palette (skipTint) — re-tinting would
    // muddy it — so the tint only runs on the base-fallback path.
    const fur = char?.palette?.fur;
    if (!skipTint && fur && char.id !== 'monkey') {
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
        // Bespoke body if this hero shipped one (palette baked → skip tint);
        // otherwise the shared monkey base recoloured by the palette tint.
        const own = _heroSheets[id];
        const sheets = own || _heroSheets.monkey;
        const skipTint = !!own;
        const dirs = {};
        for (const dir of DIRS) {
            const sheet = sheets[dir];
            const d = {};
            for (const pose in POSE_COLS) {
                d[pose] = POSE_COLS[pose].map((col, i) => buildFrame(sheet, col, char, dir, pose, i, skipTint));
            }
            dirs[dir] = d;
        }
        set = { kind: 'pixel', dirs };
    } catch (e) { set = null; }
    _heroCache.set(id, set);
    return set;
}
