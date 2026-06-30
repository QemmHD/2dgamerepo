// Animated cosmetic VFX — the "grind-worthy" layer. Auras and trails can carry
// an `fx` style that ANIMATES over time (pulse, orbiting motes, flame tongues,
// rainbow hue-cycle, twinkling starfield; trails get rainbow/flame/stars/heart
// shapes). Both the in-game Player and the menu customizer call these so the
// live preview shows exactly what you earn.
//
// Cheap by design: a handful of cached glow draws + simple paths per frame for
// ONE hero — never per-enemy, never allocating sheets per frame.

import { getGlowSprite } from './ProceduralSprites.js';

const TAU = Math.PI * 2;

// Prismatic hue-cycle colour (the classic "I grinded for this" flex look).
function hue(t, sat = 92, light = 62) {
    const h = ((t * 60) % 360 + 360) % 360;
    return `hsl(${h | 0},${sat}%,${light}%)`;
}

// Draw the cosmetic aura at (cx,cy) with on-screen radius `r`, animated by the
// `fx` style using time `t` (seconds). `intensity` scales the additive alpha.
// `color` is the base aura colour. Caller need not set composite/alpha.
export function drawAuraFx(ctx, cx, cy, r, color, fx, t, intensity = 0.3) {
    if (!color) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (fx === 'rainbow') {
        const g = ctx.createRadialGradient(cx, cy, r * 0.18, cx, cy, r);
        g.addColorStop(0, hue(t * 0.5));
        g.addColorStop(0.55, hue(t * 0.5 + 1.6, 92, 56));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = Math.min(0.6, intensity * 1.25);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
        ctx.restore(); return;
    }
    const glow = getGlowSprite(color);
    if (!glow) { ctx.restore(); return; }
    const blit = (gx, gy, gr, a) => { ctx.globalAlpha = Math.max(0, a); ctx.drawImage(glow, gx - gr, gy - gr, gr * 2, gr * 2); };
    if (fx === 'pulse') {
        const s = 0.5 + 0.5 * Math.sin(t * 4);
        blit(cx, cy, r * (0.9 + 0.22 * s), intensity * (0.7 + 0.6 * s));
    } else if (fx === 'flame') {
        blit(cx, cy, r * 0.95, intensity);
        for (let i = 0; i < 3; i++) {
            const ph = t * 6 + i * 2.1;
            const fy = cy - r * 0.45 - (0.5 + 0.5 * Math.sin(ph)) * r * 0.55;
            const fr = r * (0.34 + 0.12 * Math.sin(ph * 1.3));
            blit(cx + (i - 1) * r * 0.34, fy, fr, intensity * (0.45 + 0.4 * (0.5 + 0.5 * Math.sin(ph))));
        }
    } else if (fx === 'spin' || fx === 'starfield') {
        blit(cx, cy, r * 0.85, intensity * 0.65);
        const N = fx === 'starfield' ? 6 : 5;
        for (let i = 0; i < N; i++) {
            const a = t * 1.8 + i * (TAU / N);
            const mx = cx + Math.cos(a) * r * 0.98, my = cy + Math.sin(a) * r * 0.66;
            const tw = fx === 'starfield' ? (0.35 + 0.65 * Math.abs(Math.sin(t * 5 + i * 1.7))) : 0.85;
            blit(mx, my, r * 0.26 * tw + r * 0.06, intensity * tw);
        }
    } else {
        blit(cx, cy, r, intensity);          // default: static glow
    }
    ctx.restore();
}

// Set-bonus flourish: a slow counter-rotating double ring of bright motes
// around the hero, in the set's signature colour — the "you completed the whole
// look" payoff. Drawn around the aura; cheap (a few cached glow blits).
export function drawSetBonus(ctx, cx, cy, r, color, t) {
    if (!color) return;
    const glow = getGlowSprite(color);
    if (!glow) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const N = 8;
    for (let ring = 0; ring < 2; ring++) {
        const dir = ring === 0 ? 1 : -1;
        const orbit = r * (1.18 + ring * 0.16);
        const spin = t * (0.9 + ring * 0.4) * dir;
        for (let i = 0; i < N; i++) {
            const a = spin + i * (TAU / N) + ring * (Math.PI / N);
            const mx = cx + Math.cos(a) * orbit, my = cy + Math.sin(a) * orbit * 0.72;
            const tw = 0.5 + 0.5 * Math.sin(t * 4 + i * 1.3 + ring);
            const mr = r * (0.1 + 0.06 * tw);
            ctx.globalAlpha = 0.25 + 0.35 * tw;
            ctx.drawImage(glow, mx - mr, my - mr, mr * 2, mr * 2);
        }
    }
    ctx.restore();
}

// Pointed 4-star sparkle path.
function star(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.26, cy - r * 0.26); ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx + r * 0.26, cy + r * 0.26); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.26, cy + r * 0.26);
    ctx.lineTo(cx - r, cy); ctx.lineTo(cx - r * 0.26, cy - r * 0.26); ctx.closePath(); ctx.fill();
}
function heart(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.62);
    ctx.bezierCurveTo(cx + r, cy - r * 0.4, cx + r * 0.5, cy - r, cx, cy - r * 0.28);
    ctx.bezierCurveTo(cx - r * 0.5, cy - r, cx - r, cy - r * 0.4, cx, cy + r * 0.62);
    ctx.closePath(); ctx.fill();
}

// Resolve the colour a trail point should use for `fx` at age-fraction `k`
// (1 = freshest) and sequence index `idx`. Returns null to fall back to `color`.
export function trailFxColor(color, fx, t, idx, k) {
    if (fx === 'rainbow') return hue(t * 0.6 + idx * 0.55);
    if (fx === 'flame') return k > 0.62 ? '#ffe6a0' : k > 0.32 ? '#ff8a2c' : '#d23a1f';
    return color;
}

// Draw a single trail point at (px,py). `b` is the core block size. The caller
// sets globalAlpha (age fade); we set composite + shape per fx.
export function drawTrailPoint(ctx, px, py, b, k, color, fx, t, idx) {
    ctx.globalCompositeOperation = fx === 'hearts' ? 'source-over' : 'lighter';
    ctx.fillStyle = trailFxColor(color, fx, t, idx, k) || color;
    if (fx === 'stars') { star(ctx, px, py, b * 0.95); return; }
    if (fx === 'hearts') { heart(ctx, px, py, b * 0.95); return; }
    // default / rainbow / flame → chunky pixel puffs (core + 3 satellites)
    ctx.fillRect(px - b / 2, py - b / 2, b, b);
    const s2 = Math.max(2, Math.round(b * 0.45));
    ctx.fillRect(px - b, py - s2 / 2, s2, s2);
    ctx.fillRect(px + b - s2, py - s2 / 2, s2, s2);
    ctx.fillRect(px - s2 / 2, py - b, s2, s2);
}
