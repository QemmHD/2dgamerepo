// Shared responsive viewport policies. Keep these pure so input routing,
// rendering, the artshot harness, and deterministic validators classify the
// same resolved CSS canvas (including Renderer COVER-mode canvases).

export function isPhoneLandscapeViewport(cssWidth, cssHeight) {
    const w = Number(cssWidth);
    const h = Number(cssHeight);
    return Number.isFinite(w) && Number.isFinite(h)
        && w >= 360 && w <= 960
        && h >= 240 && h <= 560
        && w > h && w / h >= 1.55;
}
