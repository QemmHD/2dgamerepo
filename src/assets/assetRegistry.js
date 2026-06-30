// Customizable-asset metadata registry — the schema the art pipeline is built
// around. Every imported, customizable asset carries metadata describing where
// it came from, its license, its frame layout, which slots/characters/weapons
// it's compatible with, and which palette slots are recolorable.
//
// This is the data backbone for the broader customization system (layered
// characters/enemies/weapons, recolor themes, gear icons). Today it registers
// the imported LPC enemy models; new cosmetics/weapons/icons are added by
// pushing entries here (data-only) — no system changes required.
//
// Procedural (code-drawn) art does NOT need an entry; only external/importable
// or recolor-customizable assets do.

// Required fields on every entry — enforced by tools/validate-assets.js.
export const REQUIRED_FIELDS = ['id', 'type', 'source', 'sourceUrl', 'license', 'attributionRequired'];

// Valid `type` and `slot` vocabularies (kept small + explicit so the validator
// can catch typos). Expand as the pipeline grows.
export const ASSET_TYPES = [
    'character', 'enemy', 'boss', 'weapon', 'weaponSkin', 'cosmetic',
    'aura', 'trail', 'vfx', 'icon', 'uiFrame', 'tile', 'prop', 'pickup',
];
export const COSMETIC_SLOTS = [
    'body', 'head', 'hair', 'face', 'torso', 'cloak', 'arms', 'gloves',
    'weapon', 'accessory', 'aura', 'trail', 'shadow', 'overlay',
];

// The live registry. Each entry follows the metadata shape from the pipeline
// spec (see ASSET_CREDITS.md for the full field list).
export const ASSET_REGISTRY = {
    lpc_skeleton: {
        id: 'lpc_skeleton', type: 'enemy', slot: null,
        source: 'OpenGameArt / LPC', sourceUrl: 'https://opengameart.org/content/lpc-skeleton',
        license: 'OGA-BY-3.0 / CC-BY-SA-3.0 / GPL-3.0',
        author: 'bluecarrot16; wulax; Redshrike', attributionRequired: true,
        frameWidth: 64, frameHeight: 64,
        animations: ['walk'], directional: true, tintable: true,
        paletteSlots: { primary: '#e8eef0', shadow: '#222222' },
        tags: ['undead', 'humanoid', 'skeleton'],
    },
    lpc_zombie: {
        id: 'lpc_zombie', type: 'enemy', slot: null,
        source: 'OpenGameArt / LPC', sourceUrl: 'https://opengameart.org/content/lpc-zombie',
        license: 'OGA-BY-3.0 / CC-BY-SA-3.0 / GPL-3.0',
        author: 'Redshrike; wulax; castelonia; BenCreating; bluecarrot16', attributionRequired: true,
        frameWidth: 64, frameHeight: 64,
        animations: ['walk'], directional: true, tintable: true,
        paletteSlots: { primary: '#8fbf6a', shadow: '#1c2a14' },
        tags: ['undead', 'humanoid', 'zombie'],
    },
    lpc_orc: {
        id: 'lpc_orc', type: 'enemy', slot: null,
        source: 'OpenGameArt / LPC', sourceUrl: 'https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles',
        license: 'CC-BY-SA-3.0 / GPL-3.0',
        author: 'Redshrike; LPC contributors', attributionRequired: true,
        frameWidth: 64, frameHeight: 64,
        animations: ['walk'], directional: true, tintable: true,
        paletteSlots: { primary: '#5fae54', shadow: '#1c2a14' },
        tags: ['humanoid', 'orc', 'brute'],
    },
    gameicons_glyphs: {
        id: 'gameicons_glyphs', type: 'icon', slot: null,
        source: 'game-icons.net', sourceUrl: 'https://game-icons.net/',
        license: 'CC-BY-3.0',
        author: 'Lorc (game-icons.net)', attributionRequired: true,
        frameWidth: 128, frameHeight: 128,
        animations: [], directional: false, tintable: true,
        paletteSlots: { primary: '#ffffff' },
        tags: ['icon', 'ui', 'glyph', 'rarity', 'element'],
    },
    tile_ground_forest: {
        id: 'tile_ground_forest', type: 'tile', slot: null,
        source: 'Poly Haven', sourceUrl: 'https://polyhaven.com/a/forest_ground_04',
        license: 'CC0-1.0',
        author: 'Rob Tuytel (Poly Haven)', attributionRequired: false,
        frameWidth: 256, frameHeight: 256,
        animations: [], directional: false, tintable: true,
        paletteSlots: { primary: '#6b5c40' },
        tags: ['ground', 'floor', 'dirt', 'seamless', 'biome'],
    },
};

// Shape-validate one metadata entry. Returns an array of problem strings
// (empty = valid). Used by the asset validator + safe at runtime.
export function validateAssetMeta(meta) {
    const problems = [];
    if (!meta || typeof meta !== 'object') return ['entry is not an object'];
    for (const f of REQUIRED_FIELDS) {
        if (meta[f] === undefined || meta[f] === null || meta[f] === '') problems.push(`missing required field: ${f}`);
    }
    if (meta.type && !ASSET_TYPES.includes(meta.type)) problems.push(`invalid type: ${meta.type}`);
    if (meta.slot && !COSMETIC_SLOTS.includes(meta.slot)) problems.push(`invalid slot: ${meta.slot}`);
    if (meta.attributionRequired && !meta.author) problems.push('attributionRequired but no author recorded');
    return problems;
}

export function getAssetMeta(id) {
    return ASSET_REGISTRY[id] ?? null;
}
