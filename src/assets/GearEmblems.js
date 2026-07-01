// GearEmblems — lazy-loads the four ember gear-category emblems (higgsfield /
// Nano Banana 2, committed transparent under assets/ui/gear/): weapon (crossed
// ember wands, matching the game's wand-based combat), armor, trinket, charm.
// Drawn as the item icon in the gear grid + loadout slots. Any entry is null
// until its image loads (and permanently null on failure or in a non-DOM env),
// so callers fall back to the existing procedural rarity spark. No hot-path work.

const FILES = { weapon: 'weapon.png', armor: 'armor.png', trinket: 'trinket.png', charm: 'charm.png' };
const _imgs = { weapon: null, armor: null, trinket: null, charm: null };
let _started = false;

export function getGearEmblems() {
    if (!_started) {
        _started = true;
        for (const key of Object.keys(FILES)) {
            try {
                const im = new Image();
                im.onload = () => { _imgs[key] = im; };
                im.onerror = () => { _imgs[key] = null; };
                im.src = new URL(`./ui/gear/${FILES[key]}`, import.meta.url).href;
            } catch (e) {
                _imgs[key] = null;   // no Image (non-DOM env) → procedural fallback
            }
        }
    }
    return _imgs;
}

// Emblem image for a gear category ('weapon'|'armor'|'trinket'|'charm'), or null.
export function getGearEmblem(category) {
    return getGearEmblems()[category] || null;
}
