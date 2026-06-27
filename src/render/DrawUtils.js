// Shared 2D-canvas drawing helpers used by entities and UI.
// Keeps the rounded-rect fallback and the world health-bar style in one
// place so they can't drift across files.

// ── Easing / tween vocabulary ──────────────────────────────────────────
// One shared motion language so every UI animation eases the same way
// instead of ad-hoc Math.sin ramps scattered through UISystem.
export function clamp01(t) {
    return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function lerp(a, b, t) {
    return a + (b - a) * t;
}

// Smooth deceleration — the workhorse for fades and slides.
export function easeOutCubic(t) {
    const u = 1 - clamp01(t);
    return 1 - u * u * u;
}

export function easeOutQuad(t) {
    const u = 1 - clamp01(t);
    return 1 - u * u;
}

// Slight overshoot then settle — gives pop to cards and titles.
export function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const u = clamp01(t) - 1;
    return 1 + c3 * u * u * u + c1 * u * u;
}

// Frame-rate-independent exponential approach. `rate` is roughly "how
// much of the gap is closed per second"; dt in seconds.
export function damp(current, target, rate, dt) {
    return current + (target - current) * (1 - Math.exp(-rate * dt));
}

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

// Polished rounded stat bar for the HUD (HP / XP / boss). Handles a
// recessed track, an optional draining "chip" trail (pass chip > ratio
// to show recently-lost value in a lighter shade), the fill (solid color
// string or {from,to} horizontal gradient), a gloss highlight, and a
// rounded border — all clipped so corners stay clean at any fill width.
export function drawStatBar(ctx, x, y, w, h, ratio, fill, options = {}) {
    const r = clamp01(ratio);
    const radius = Math.min(options.radius ?? h / 2, h / 2);

    ctx.save();
    // Recessed track.
    roundRectPath(ctx, x, y, w, h, radius);
    ctx.fillStyle = options.track ?? 'rgba(0,0,0,0.55)';
    ctx.fill();

    // Clip everything else to the rounded track so fill edges are clean.
    roundRectPath(ctx, x, y, w, h, radius);
    ctx.clip();

    // Draining chip trail (recent damage), drawn behind the live fill.
    if (options.chip != null) {
        const chip = clamp01(options.chip);
        if (chip > r) {
            ctx.fillStyle = options.chipColor ?? 'rgba(255, 120, 120, 0.55)';
            ctx.fillRect(x, y, w * chip, h);
        }
    }

    if (r > 0) {
        let style;
        if (typeof fill === 'string') {
            style = fill;
        } else {
            const g = ctx.createLinearGradient(x, 0, x + w, 0);
            g.addColorStop(0, fill.from);
            g.addColorStop(1, fill.to);
            style = g;
        }
        ctx.fillStyle = style;
        ctx.fillRect(x, y, w * r, h);

        // Gloss highlight across the top half of the fill.
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(x, y, w * r, h * 0.5);
    }
    ctx.restore();

    // Rounded border.
    if (options.border !== false) {
        roundRectPath(ctx, x, y, w, h, radius);
        ctx.strokeStyle = options.border ?? 'rgba(255,255,255,0.42)';
        ctx.lineWidth = options.borderWidth ?? 2;
        ctx.stroke();
    }
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
