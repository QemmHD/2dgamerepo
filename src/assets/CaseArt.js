// CaseArt — lazy-loads the six case-chest icons (higgsfield / Nano Banana 2,
// committed transparent under assets/ui/cases/): one per shop case tier —
// basic / mystic / royal, gear and cosmetic variants. Drawn as the case card's
// hero image in the shop grid and small in the case-opening tray header. Any
// entry is null until its image loads (and permanently null on failure or in a
// non-DOM env), so callers fall back to the existing procedural card layout.
// Same lazy pattern as GearEmblems.js. No hot-path work.

const FILES = {
    basic: 'basic.png', mystic: 'mystic.png', royal: 'royal.png',
    basicCosmetic: 'basicCosmetic.png', mysticCosmetic: 'mysticCosmetic.png', royalCosmetic: 'royalCosmetic.png',
};
const _imgs = { basic: null, mystic: null, royal: null, basicCosmetic: null, mysticCosmetic: null, royalCosmetic: null };
let _started = false;

export function getCaseArts() {
    if (!_started) {
        _started = true;
        for (const key of Object.keys(FILES)) {
            try {
                const im = new Image();
                im.onload = () => { _imgs[key] = im; };
                im.onerror = () => { _imgs[key] = null; };
                im.src = new URL(`./ui/cases/${FILES[key]}`, import.meta.url).href;
            } catch (e) {
                _imgs[key] = null;   // no Image (non-DOM env) → procedural fallback
            }
        }
    }
    return _imgs;
}

// Chest image for a case id ('basic'|'mystic'|'royal'|…Cosmetic), or null.
export function getCaseArt(caseId) {
    return getCaseArts()[caseId] || null;
}
