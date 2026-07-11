// CosmeticEmblems — lazy-loads the cosmetic-category medallions (higgsfield /
// Nano Banana 2, committed transparent under assets/ui/cosmetics/): fur (paw),
// cloak, accessory (hat), aura (fire ring), trail (comet), plus a generic
// sparkle used when a cosmetic has no category match. Drawn as the item face
// in the case reel + reveal so cosmetics read as real loot (the gear analogue
// is GearEmblems.js). Entries are null until loaded → procedural fallback.

const FILES = {
    fur: 'fur.png', cloak: 'cloak.png', accessory: 'accessory.png',
    aura: 'aura.png', trail: 'trail.png', sparkle: 'sparkle.png',
};
const _imgs = { fur: null, cloak: null, accessory: null, aura: null, trail: null, sparkle: null };
let _started = false;

export function getCosmeticEmblems() {
    if (!_started) {
        _started = true;
        for (const key of Object.keys(FILES)) {
            try {
                const im = new Image();
                im.onload = () => { _imgs[key] = im; };
                im.onerror = () => { _imgs[key] = null; };
                im.src = new URL(`./ui/cosmetics/${FILES[key]}`, import.meta.url).href;
            } catch (e) {
                _imgs[key] = null;   // no Image (non-DOM env) → procedural fallback
            }
        }
    }
    return _imgs;
}

// Medallion for a cosmetic category, falling back to the sparkle, then null.
export function getCosmeticEmblem(category) {
    const m = getCosmeticEmblems();
    return m[category] || m.sparkle || null;
}
