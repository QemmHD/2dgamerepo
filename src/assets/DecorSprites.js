// DecorSprites — AI hi-bit pixel art for the tiny scattered ground props
// (higgsfield / Nano Banana 2, keyed + fitted via tools/artshot/gridcut.html).
//
// CRITICAL SIZE CONVENTION: MapRenderer computes a prop's world footprint as
// sprite.width / SPRITE_SS, so every file here is baked at EXACTLY the
// procedural authoring size × SPRITE_SS (see SIZES) — swap-in changes art,
// never layout, culling, shadows or the candle light anchor.
//
// loadDecorSprites() NEVER rejects; getDecorSprite() returns null until loaded
// (and permanently on failure) so ProceduralSprites.drawDecoration stays the
// always-working fallback.

import { SPRITE_SS } from '../config/GameConfig.js';

// Logical authoring sizes — MUST match the procedural draw sizes in
// ProceduralSprites.js (drawRock 56×44 … drawBones 44×22).
const SIZES = {
    rock: [56, 44],
    mushroom: [38, 44],
    skull: [36, 30],
    grass: [32, 26],
    candle: [28, 50],
    ruin: [64, 44],
    branch: [56, 18],
    crackedStone: [46, 32],
    bones: [44, 22],
};

const FILES = {
    rock: 'rock.png',
    mushroom: 'mushroom.png',
    skull: 'skull.png',
    grass: 'grass.png',
    candle: 'candle.png',
    ruin: 'ruin.png',
    branch: 'branch.png',
    crackedStone: 'cracked_stone.png',
    bones: 'bones.png',
};

const cache = new Map();   // type → canvas | null
let _loadPromise = null;

function url(file) {
    return new URL(`./decor/${file}`, import.meta.url).href;
}

function loadOne(type, file) {
    return new Promise((resolve) => {
        try {
            const im = new Image();
            // Guard the onload body too — a throw there happens outside the
            // outer try and would strand the promise (boot awaits us).
            im.onload = () => {
                try {
                    // Bake to exactly logical×SPRITE_SS so the footprint math
                    // and shadow/light anchors in MapRenderer stay correct.
                    const [lw, lh] = SIZES[type];
                    const c = document.createElement('canvas');
                    c.width = lw * SPRITE_SS; c.height = lh * SPRITE_SS;
                    const cx = c.getContext('2d');
                    cx.imageSmoothingEnabled = true;
                    cx.imageSmoothingQuality = 'high';
                    cx.drawImage(im, 0, 0, c.width, c.height);
                    cache.set(type, c);
                    resolve(true);
                } catch (e) { cache.set(type, null); resolve(false); }
            };
            im.onerror = () => { cache.set(type, null); resolve(false); };
            im.src = url(file);
        } catch (e) { cache.set(type, null); resolve(false); }
    });
}

// Load every decor sprite. Never rejects; true if at least one loaded.
export function loadDecorSprites() {
    if (_loadPromise) return _loadPromise;
    _loadPromise = Promise.all(
        Object.keys(FILES).map((t) => loadOne(t, FILES[t]))
    ).then((r) => r.some(Boolean));
    return _loadPromise;
}

// AI sprite canvas for a decoration type, or null → procedural fallback.
export function getDecorSprite(type) {
    return cache.get(type) || null;
}
