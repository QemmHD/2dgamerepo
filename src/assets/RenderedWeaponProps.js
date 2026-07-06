// Rendered (Blender-authored) held-weapon prop layers — the tintable tier that
// sits ABOVE the procedural buildProp() in WeaponProps.js. Each weapon "family"
// (staff/wand/rod/glaive/sigil/shard/totem) ships three tiny PNGs plus an
// anchors.json:
//
//   base.png         — neutral geometry (wood/brass/grey placeholders + 1px
//                      #14101c contour). Carries NO accent/glow hue.
//   accent_mask.png  — 8-bit L level map for the weapon ACCENT colour
//                      (level ≥150 → accent, ≥50 → accent-dark).
//   glow_mask.png    — 8-bit L level map for the weapon GLOW colour
//                      (level ≥230 → white hot-core, ≥130 → glow-light,
//                      ≥40 → glow).
//   anchors.json     — { w, h, gripX, gripY, tipX, tipY } already expressed in
//                      the COMPOSITED-canvas pixel space (grip-left / tip-right,
//                      +x aim axis), so WeaponProps composites and returns them
//                      verbatim — identical shape to buildProp's descriptor.
//
// The recolour is applied per (prop,accent,glow) in WeaponProps.compositeRenderedProp,
// so the same three layers serve every weapon in a family at its own colours.
//
// Loading mirrors EnemySprites.loadOne exactly: one Promise per family, resolve
// (true/false) and NEVER reject; any onerror / throw / non-DOM env / missing
// file drops the family to null so it silently falls back to buildProp. A family
// with no rendered asset simply isn't listed here and stays on buildProp.

// Every family that ships a rendered asset set. Add/remove families here as art
// lands — an unlisted family keeps the procedural buildProp look.
const FAMILIES = ['staff', 'wand', 'rod', 'glaive', 'sigil', 'shard', 'totem'];

// family -> { base:Image, accentMask:Image, glowMask:Image, anchors } | null
const _rendered = {};
const _started = {};  // family -> Promise (idempotent load guard)

// Accessor used by WeaponProps.getWeaponProp — returns the loaded registry entry
// or null (family unrendered, still loading, or load failed/headless).
export function getRenderedFamily(family) {
    return _rendered[family] || null;
}

// Load one image, resolving to the Image on load and to null on any error /
// non-DOM env — never rejects (mirrors EnemySprites.loadOne:65-79).
function loadImage(url) {
    return new Promise((resolve) => {
        try {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => resolve(null);
            im.src = url;
        } catch (e) {
            resolve(null);   // no Image (non-DOM env) → null slot
        }
    });
}

// Load one family's three PNGs + anchors.json. Resolves true when the full set
// is present, false otherwise; on false the family stays null (buildProp).
function loadFamily(family) {
    if (_started[family]) return _started[family];
    _started[family] = new Promise((resolve) => {
        try {
            const dir = family;
            const baseUrl = new URL(`./weapons/${dir}/base.png`, import.meta.url).href;
            const accUrl = new URL(`./weapons/${dir}/accent_mask.png`, import.meta.url).href;
            const glowUrl = new URL(`./weapons/${dir}/glow_mask.png`, import.meta.url).href;
            const anchUrl = new URL(`./weapons/${dir}/anchors.json`, import.meta.url).href;
            Promise.all([
                loadImage(baseUrl),
                loadImage(accUrl),
                loadImage(glowUrl),
                fetch(anchUrl).then((r) => r.json()).catch(() => null),
            ]).then(([base, accentMask, glowMask, anchors]) => {
                if (base && accentMask && glowMask && anchors) {
                    _rendered[family] = { base, accentMask, glowMask, anchors };
                    resolve(true);
                } else {
                    _rendered[family] = null;   // any missing layer → procedural fallback
                    resolve(false);
                }
            }).catch(() => { _rendered[family] = null; resolve(false); });
        } catch (e) {
            _rendered[family] = null;   // non-DOM env (no Image/fetch/URL) → fallback
            resolve(false);
        }
    });
    return _started[family];
}

// Boot slot: load every rendered family in parallel. NEVER rejects — a
// failed/missing family falls back to buildProp — so it is safe to sit in
// main.js's boot Promise.all next to the other load* calls.
export async function loadRenderedProps() {
    try {
        await Promise.all(FAMILIES.map(loadFamily));
    } catch (e) {
        // Defensive: individual loaders already swallow their own errors, but if
        // the environment lacks Promise/Array entirely we still resolve clean.
    }
    return true;
}
