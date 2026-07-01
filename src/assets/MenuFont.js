// MenuFont — loads the Cinzel display face (OFL, self-hosted woff2 under
// assets/ui/fonts/) for the menu's headings / tab labels / buttons, giving the
// UI a forged dark-fantasy identity. Body text keeps the system stack for
// legibility. Loading starts on import; until the face is ready, canvas text
// using DISPLAY_FONT simply renders in the system fallback in the stack, so
// nothing blocks or breaks (and a non-DOM/headless env stays on the fallback).

const SYS = '-apple-system, system-ui, Helvetica, Arial, sans-serif';
// Cinzel first, system stack as the graceful fallback.
export const DISPLAY_FONT = `'Cinzel', ${SYS}`;

let _started = false;
export function ensureMenuFont() {
    if (_started) return;
    _started = true;
    try {
        if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return;
        const url = new URL('./ui/fonts/cinzel.woff2', import.meta.url).href;
        // Variable weight 500–800 in one file → any heading/button weight is real.
        const face = new FontFace('Cinzel', `url(${url}) format('woff2')`, { weight: '500 800', style: 'normal' });
        face.load().then((f) => { document.fonts.add(f); }).catch(() => { /* stay on fallback */ });
    } catch (e) {
        /* non-DOM env or CSP → system fallback */
    }
}
