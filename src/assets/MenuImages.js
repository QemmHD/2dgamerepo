// MenuImages — loads the main-menu art set (Higgsfield-generated, committed
// under assets/ui/): the full-screen ember-forge backdrop, the EMBERWAKE title
// wordmark (transparent), and the ornate ember crest used on the Battle Pass tab.
//
// Each image loads lazily and independently; getMenuImages() returns
// { bg, title, crest, passBg } where any entry is null until its image loads (and
// permanently null if it fails). Every consumer falls back to the existing
// procedural drawing (cached ember-forge gradient, gradient text title, plain
// header), so the menu renders identically if the art is missing or still loading.
// No network/decoding on the hot path — images are decoded once by the browser.

const FILES = {
    bg: 'menu_bg.jpg', title: 'title_emberwake.png', crest: 'bp_crest.png',
    passBg: 'bp_vigil_path.png',
    // Forged UI chrome (wired into the shared _panel / _button primitives so the
    // whole menu is reskinned from one place): an ornate ember corner bracket
    // framing large panels, and a neutral forged-metal button plate overlaid
    // (additively) on button fills so each button's accent colour still reads.
    corner: 'corner_bracket.png', btnPlate: 'btn_plate.png',
    // The game LOGO emblem (monkey wick-keeper in a forged ember ring) —
    // keyed transparent for the HOME title screen; the opaque master also
    // ships as the favicon / iOS home-screen icon (see index.html).
    logo: 'logo.png',
};
const _imgs = { bg: null, title: null, crest: null, passBg: null, corner: null, btnPlate: null, logo: null };
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
