// EnemySprites — bespoke higgsfield / Nano Banana 2 enemy sprites (keyed
// transparent, committed under assets/enemies/) that UPDATE the game's basic
// creatures with hand-directed AI art. Each returns a SINGLE-FRAME array so it
// drops straight into Enemy.js's FRAMES_BY_TYPE as the preferred layer ABOVE the
// imported-LPC → procedural fallbacks; the engine's own motion (idle breath,
// spawn-pop, hit squash, status flashes) animates the static frame — exactly how
// the Lieutenant mini-boss sprite rides the engine (see LieutenantSprite.js).
//
// Unlike the rare Lieutenant (pure-lazy), these creatures spawn within seconds of
// a run starting, so loadEnemyAiSprites() is awaited at boot (alongside
// loadMonsterSprites) — it NEVER rejects, and getEnemyAiFrames() returns null for
// any sprite that failed to load or in a non-DOM env, so Enemy.js falls back to
// the LPC → procedural art and the game always renders. No work on the hot path.

import { SPRITE_SIZE } from '../config/GameConfig.js';

const FILES = {
    slime: 'ember_slime.png',     // molten ember slime  → basic swarm creature
    bat: 'ember_bat.png',         // charred ember bat   → fast aerial minion
    crawler: 'ember_serpent.png', // molten lava serpent → low crawler
    spitter: 'ember_eye.png',     // floating ember eye  → ranged fire caster
    mite: 'ember_mite.png',       // tiny ember mite     → fast swarmer
};

// Frame-ANIMATED sheets for the (non-directional) creatures: a single
// horizontal row of animation frames per creature, generated as a 2×2 Nano
// Banana 2 grid (one generation → consistent style across frames) and packed by
// tools/artshot/strip-frames.mjs with shared-scale alignment so squash/stretch
// survives. Enemy.js cycles the frames at the type's hz — same path the LPC
// monster frames use. When a sheet loads, it supersedes the single-frame image
// (which stays as the next fallback layer).
const ANIM_SHEETS = {
    slime:   { file: 'ember_slime_anim.png',   cols: 4 },
    bat:     { file: 'ember_bat_anim.png',     cols: 4 },
    crawler: { file: 'ember_serpent_anim.png', cols: 4 },
    spitter: { file: 'ember_eye_anim.png',     cols: 4 },
    mite:    { file: 'ember_mite_anim.png',    cols: 4 },
};

// Directional ANIMATED sheets — pre-rendered from a rigged+animated 3D model of
// the creature (higgsfield image_to_3d + 3d_rigging, walked through the Meshy
// animation library, rendered to a 4-row grid by tools/artshot/glbsheet.html).
// Row order matches the LPC convention (up / left / down / right); `cols` frames
// per row. `inset` scales the drawn body inside the SPRITE_SIZE cell so the
// sprite's visual weight matches its collision radius (LPC bodies don't fill
// their cells either).
const DIR_SHEETS = {
    emberskeleton: { file: 'ember_warden_sheet.png', cols: 8, inset: 0.86 },
};
const DIR_ORDER = ['up', 'left', 'down', 'right'];

const _frames = {};    // type -> [Image] once loaded ; null on failure
const _started = {};    // type -> Promise (idempotent load guard)

function loadOne(type) {
    if (_started[type]) return _started[type];
    _started[type] = new Promise((resolve) => {
        try {
            const im = new Image();
            im.onload = () => { _frames[type] = [im]; resolve(true); };
            im.onerror = () => { _frames[type] = null; resolve(false); };
            im.src = new URL(`./enemies/${FILES[type]}`, import.meta.url).href;
        } catch (e) {
            _frames[type] = null;   // no Image (non-DOM env) → procedural fallback
            resolve(false);
        }
    });
    return _started[type];
}

const _animFrames = {};  // type -> [canvas,...] once sliced; null on failure
const _animStarted = {};

// Slice a 1-row horizontal animation sheet into SPRITE_SIZE frame canvases.
// Smooth upscale — painterly art, not pixel art.
function sliceRowSheet(img, cols) {
    const cw = Math.floor(img.width / cols);
    const frames = [];
    for (let c = 0; c < cols; c++) {
        const cv = document.createElement('canvas');
        cv.width = SPRITE_SIZE; cv.height = SPRITE_SIZE;
        const cx = cv.getContext('2d');
        cx.imageSmoothingEnabled = true;
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(img, c * cw, 0, cw, img.height, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
        frames.push(cv);
    }
    return frames;
}

function loadAnimOne(type) {
    if (_animStarted[type]) return _animStarted[type];
    _animStarted[type] = new Promise((resolve) => {
        const spec = ANIM_SHEETS[type];
        try {
            const im = new Image();
            im.onload = () => {
                try { _animFrames[type] = sliceRowSheet(im, spec.cols); resolve(true); }
                catch (e) { _animFrames[type] = null; resolve(false); }
            };
            im.onerror = () => { _animFrames[type] = null; resolve(false); };
            im.src = new URL(`./enemies/${spec.file}`, import.meta.url).href;
        } catch (e) {
            _animFrames[type] = null;   // no Image/canvas (non-DOM env) → fallback
            resolve(false);
        }
    });
    return _animStarted[type];
}

const _dirFrames = {};   // type -> {up:[canvas],left,down,right} once sliced; null on failure
const _dirStarted = {};

// Slice a 4-row directional sheet into per-direction SPRITE_SIZE frame arrays.
// Smooth (not nearest) upscale — this is painterly 3D-rendered art, not pixel art.
function sliceDirSheet(img, cols, inset) {
    const cw = Math.floor(img.width / cols);
    const ch = Math.floor(img.height / 4);
    const out = {};
    const draw = SPRITE_SIZE * inset;
    const off = (SPRITE_SIZE - draw) / 2;
    DIR_ORDER.forEach((dir, row) => {
        const frames = [];
        for (let c = 0; c < cols; c++) {
            const cv = document.createElement('canvas');
            cv.width = SPRITE_SIZE; cv.height = SPRITE_SIZE;
            const cx = cv.getContext('2d');
            cx.imageSmoothingEnabled = true;
            cx.imageSmoothingQuality = 'high';
            cx.drawImage(img, c * cw, row * ch, cw, ch, off, off, draw, draw);
            frames.push(cv);
        }
        out[dir] = frames;
    });
    return out;
}

function loadDirOne(type) {
    if (_dirStarted[type]) return _dirStarted[type];
    _dirStarted[type] = new Promise((resolve) => {
        const spec = DIR_SHEETS[type];
        try {
            const im = new Image();
            im.onload = () => {
                try { _dirFrames[type] = sliceDirSheet(im, spec.cols, spec.inset); resolve(true); }
                catch (e) { _dirFrames[type] = null; resolve(false); }
            };
            im.onerror = () => { _dirFrames[type] = null; resolve(false); };
            im.src = new URL(`./enemies/${spec.file}`, import.meta.url).href;
        } catch (e) {
            _dirFrames[type] = null;   // no Image/canvas (non-DOM env) → fallback
            resolve(false);
        }
    });
    return _dirStarted[type];
}

// Kick every bespoke enemy sprite; resolves (never rejects) once all settle.
// Await at boot so even the first creature spawned shows the AI art. Returns true
// if at least one sprite loaded.
export function loadEnemyAiSprites() {
    return Promise.all([
        ...Object.keys(FILES).map(loadOne),
        ...Object.keys(ANIM_SHEETS).map(loadAnimOne),
        ...Object.keys(DIR_SHEETS).map(loadDirOne),
    ]).then((r) => r.some(Boolean));
}

// Directional frame set ({up,left,down,right} arrays) for a bespoke animated
// enemy, or null if not loaded (Enemy.js then uses the LPC → procedural
// fallback). Same shape as getLpcFrames.
export function getEnemyAiDirFrames(type) {
    if (!(type in DIR_SHEETS)) return null;
    if (!_dirStarted[type]) loadDirOne(type);
    return _dirFrames[type] || null;
}

// Frame array for a bespoke enemy sprite — the ANIMATED multi-frame sheet when
// loaded, else the single keyed frame, else null (Enemy.js then uses the
// imported-LPC → procedural fallback). Kicks lazy loads the first time it's
// asked for, so the sprite still resolves even if the boot preload was skipped.
export function getEnemyAiFrames(type) {
    if (type in ANIM_SHEETS) {
        if (!_animStarted[type]) loadAnimOne(type);
        if (_animFrames[type]) return _animFrames[type];
    }
    if (!(type in FILES)) return null;
    if (!_started[type]) loadOne(type);
    return _frames[type] || null;
}
