// LieutenantSprite — loads the Lieutenant mini-boss's bespoke sprite set (three
// background-keyed poses committed under assets/enemies/): idle, attack (axe
// raised), and hurt (recoil). Enemy.draw picks the frame by live state — hurt on
// hit-flash, attack on wind-up / a periodic heft, idle otherwise — and it still
// rides ALL the engine's procedural motion (breath, spawn-pop, squash, flash).
//
// Each image loads lazily and independently; getLieutenantSprites() returns
// { idle, attack, hurt } where any pose is null until its image loads (and
// permanently null if it fails). The caller falls back: attack/hurt → idle →
// (idle null) → the procedural heavy-hitter frame. No network/decoding on the hot path.

const POSES = ['idle', 'attack', 'hurt'];
const FILES = { idle: 'lieutenant.png', attack: 'lieutenant_attack.png', hurt: 'lieutenant_hurt.png' };
const _imgs = { idle: null, attack: null, hurt: null };
let _started = false;

export function getLieutenantSprites() {
    if (!_started) {
        _started = true;
        for (const pose of POSES) {
            try {
                const im = new Image();
                im.onload = () => { _imgs[pose] = im; };
                im.onerror = () => { _imgs[pose] = null; };
                im.src = new URL(`./enemies/${FILES[pose]}`, import.meta.url).href;
            } catch (e) {
                _imgs[pose] = null;   // no Image (non-DOM env) → procedural fallback
            }
        }
    }
    return _imgs;
}
