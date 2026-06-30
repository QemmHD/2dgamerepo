// Shared sprite recolor / tint utility for the customizable-asset pipeline.
//
// Recoloring is how one source sprite/icon yields many variants (rarity tints,
// elemental themes, palette swaps) WITHOUT shipping a separate image per
// variant. Per the performance rules: variants are generated ONCE and cached —
// never recolored per render tick.
//
// recolorCanvas(src, spec, key):
//   src   a source canvas (or any drawable)
//   spec  { op, color, alpha } — `op` is a canvas composite mode:
//           'multiply'    darken toward color, preserves shading (good for tints)
//           'source-atop' flat overlay clipped to the sprite's pixels
//           'lighter'     additive glow toward color
//         (color = CSS color, alpha 0..1)
//   key   a stable cache key (caller-owned); identical keys return the cached
//         canvas, so a variant is rasterized at most once.

const cache = new Map();

// Make a blank canvas matching the source dimensions (works headless via the
// stubbed document in tests).
function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
}

export function recolorCanvas(src, spec, key) {
    if (key && cache.has(key)) return cache.get(key);
    const w = src.width, h = src.height;
    const out = makeCanvas(w, h);
    const cx = out.getContext('2d');
    cx.imageSmoothingEnabled = false;
    // Base sprite.
    cx.drawImage(src, 0, 0);
    if (spec && spec.color) {
        cx.globalCompositeOperation = spec.op || 'multiply';
        cx.globalAlpha = spec.alpha ?? 1;
        cx.fillStyle = spec.color;
        cx.fillRect(0, 0, w, h);
        // Clip the tint to the sprite's own opaque pixels (never paint the
        // transparent margin).
        cx.globalCompositeOperation = 'destination-in';
        cx.globalAlpha = 1;
        cx.drawImage(src, 0, 0);
        cx.globalCompositeOperation = 'source-over';
    }
    if (key) cache.set(key, out);
    return out;
}

// Recolor every frame of an animation array once, cached as a group under
// `keyPrefix`. Returns the recolored frame array.
export function recolorFrames(frames, spec, keyPrefix) {
    if (keyPrefix && cache.has(keyPrefix)) return cache.get(keyPrefix);
    const out = frames.map((f, i) => recolorCanvas(f, spec, keyPrefix ? `${keyPrefix}#${i}` : null));
    if (keyPrefix) cache.set(keyPrefix, out);
    return out;
}

// Test/debug: how many variants are currently cached.
export function recolorCacheSize() {
    return cache.size;
}
