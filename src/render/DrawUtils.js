// Shared 2D-canvas drawing helpers used by entities and UI.
// Keeps the rounded-rect fallback and the world health-bar style in one
// place so they can't drift across files.

// Build a rounded-rect path. Uses CanvasRenderingContext2D.roundRect when
// available (Safari 16+, Chrome 99+); falls back to manual arc commands
// so older iOS WebKit still renders rounded UI.
export function roundRectPath(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        return;
    }
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
}

// Color for a 0..1 HP/XP ratio. Tuned for quick at-a-glance reading.
export function healthColor(ratio) {
    if (ratio < 0.3) return '#ff4757';
    if (ratio < 0.6) return '#ffa53b';
    return '#5fe87a';
}

// Draw a small in-world health bar centered on (centerX, topY).
// `ratio` is 0..1. Caller supplies the fill color so different entities
// can theme their bars.
export function drawWorldHealthBar(ctx, centerX, topY, width, height, ratio, fillColor) {
    const r = Math.max(0, Math.min(1, ratio));
    const left = centerX - width / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(left - 2, topY - 2, width + 4, height + 4);
    ctx.fillStyle = '#3a1010';
    ctx.fillRect(left, topY, width, height);
    ctx.fillStyle = fillColor;
    ctx.fillRect(left, topY, width * r, height);
    ctx.restore();
}
