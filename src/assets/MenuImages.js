// MenuImages — loads the main-menu art set (higgsfield / Nano Banana 2, committed
// under assets/ui/): the full-screen ember-forge backdrop, the EMBERWAKE title
// wordmark (transparent), and the ornate ember crest used on the Battle Pass tab.
//
// Each image loads lazily and independently; getMenuImages() returns
// { bg, title, crest } where any entry is null until its image loads (and
// permanently null if it fails). Every consumer falls back to the existing
// procedural drawing (cached ember-forge gradient, gradient text title, plain
// header), so the menu renders identically if the art is missing or still loading.
// No network/decoding on the hot path — images are decoded once by the browser.

const FILES = { bg: 'menu_bg.jpg', title: 'title_emberwake.png', crest: 'bp_crest.png' };
const _imgs = { bg: null, title: null, crest: null };
let _started = false;

export function getMenuImages() {
    if (!_started) {
        _started = true;
        for (const key of Object.keys(FILES)) {
            try {
                const im = new Image();
                im.onload = () => { _imgs[key] = im; };
                im.onerror = () => { _imgs[key] = null; };
                im.src = new URL(`./ui/${FILES[key]}`, import.meta.url).href;
            } catch (e) {
                _imgs[key] = null;   // no Image (non-DOM env) → procedural fallback
            }
        }
    }
    return _imgs;
}
