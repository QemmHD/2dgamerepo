// photoFilters.js — the Keeper's Lens filter table (EMBERGLASS / roadmap #2, PR3).
//
// Each filter is a CHEAP screen-space pass drawn after the veil composite while
// photo mode is active: full-frame fills + composite ops only (no getImageData),
// so cost is 1–3 fillRects. Alphas match the shipped biome grade scale so filters
// read as world moods, not stickers. `darkMul` (optional) re-levers the darkness
// veil via lighting.setQuality — the same lever biomes use — restored on exit.

function fill(ctx, W, H, color, alpha, op) {
    ctx.save();
    ctx.globalCompositeOperation = op;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
}

function vignette(ctx, W, H, strength) {
    ctx.save();
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
}

export const PHOTO_FILTERS = [
    { id: 'none', name: "KEEPER'S EYE", draw() {} },
    { id: 'emberheat', name: 'EMBERHEAT', draw(c, W, H) { fill(c, W, H, '#ff6a2a', 0.14, 'source-over'); } },
    { id: 'quenched', name: 'QUENCHED', draw(c, W, H) { fill(c, W, H, '#2a9db0', 0.12, 'source-over'); } },
    { id: 'gloam', name: 'GLOAM', darkMul: 1.25, draw(c, W, H) { fill(c, W, H, '#6a3bd0', 0.16, 'source-over'); vignette(c, W, H, 0.14); } },
    { id: 'sepia', name: "KEEPER'S SEPIA", draw(c, W, H) { fill(c, W, H, '#808080', 0.85, 'saturation'); fill(c, W, H, '#c8964b', 0.18, 'overlay'); } },
    { id: 'noir', name: 'NOIR', draw(c, W, H) { fill(c, W, H, '#808080', 1.0, 'color'); vignette(c, W, H, 0.34); } },
    { id: 'parchment', name: 'PARCHMENT', draw(c, W, H) { fill(c, W, H, '#e8d9b0', 0.22, 'soft-light'); } },
    { id: 'forgelight', name: 'FORGELIGHT', draw(c, W, H) { fill(c, W, H, '#000000', 0.15, 'overlay'); vignette(c, W, H, 0.20); fill(c, W, H, '#ff9a4a', 0.08, 'lighter'); } },
];

export function photoFilterCount() { return PHOTO_FILTERS.length; }

// Resolve a filter by id (harness ?filter=<id>) → its index, else 0.
export function photoFilterIndexById(id) {
    const i = PHOTO_FILTERS.findIndex((f) => f.id === id);
    return i < 0 ? 0 : i;
}
