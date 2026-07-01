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

const FILES = {
    slime: 'ember_slime.png',   // molten ember slime → the basic swarm creature
};

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

// Kick every bespoke enemy sprite; resolves (never rejects) once all settle.
// Await at boot so even the first creature spawned shows the AI art. Returns true
// if at least one sprite loaded.
export function loadEnemyAiSprites() {
    return Promise.all(Object.keys(FILES).map(loadOne)).then((r) => r.some(Boolean));
}

// Single-frame array for a bespoke enemy sprite, or null if it isn't loaded
// (Enemy.js then uses the imported-LPC → procedural fallback). Kicks a lazy load
// the first time it's asked for, so the sprite still resolves even if the boot
// preload was skipped.
export function getEnemyAiFrames(type) {
    if (!(type in FILES)) return null;
    if (!_started[type]) loadOne(type);
    return _frames[type] || null;
}
