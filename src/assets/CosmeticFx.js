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

// Public, finite vocabularies keep catalog data, runtime branches, and the
// attachment validator on the same contract. Undefined fx values resolve to
// the quiet `static` aura / `puffs` trail defaults.
export const AURA_FX_STYLES = Object.freeze([
    'static', 'pulse', 'flame', 'spin', 'starfield', 'rainbow',
    'oathwheel', 'gloam_moths',
]);
export const TRAIL_FX_STYLES = Object.freeze([
    'puffs', 'hearts', 'stars', 'flame', 'rainbow',
    'waymarks', 'gloam_wisps',
]);

// Prismatic hue-cycle colour (the classic "I grinded for this" flex look).
function hue(t, sat = 92, light = 62) {
    const h = ((t * 60) % 360 + 360) % 360;
    return `hsl(${h | 0},${sat}%,${light}%)`;
}

// Draw the cosmetic aura at (cx,cy) with on-screen radius `r`, animated by the
// `fx` style using time `t` (seconds). `intensity` scales the additive alpha.
// `color` is the base aura colour. Caller need not set composite/alpha.
export function drawAuraFx(ctx, cx, cy, r, color, fx, t, intensity = 0.3, reducedEffects = false) {
    if (!color) return;
    // Reduced Effects preserves the earned cosmetic silhouette but freezes all
    // motion at a deterministic phase. No timer/state object is allocated.
    const time = reducedEffects ? 0 : t;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (fx === 'rainbow') {
        const g = ctx.createRadialGradient(cx, cy, r * 0.18, cx, cy, r);
        g.addColorStop(0, hue(time * 0.5));
        g.addColorStop(0.55, hue(time * 0.5 + 1.6, 92, 56));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = Math.min(0.6, intensity * 1.25);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
        ctx.restore(); return;
    }
    const glow = getGlowSprite(color);
    if (!glow) { ctx.restore(); return; }
    const blit = (gx, gy, gr, a) => { ctx.globalAlpha = Math.max(0, a); ctx.drawImage(glow, gx - gr, gy - gr, gr * 2, gr * 2); };
    if (fx === 'oathwheel') {
        // A bounded four-rune wheel. Paths are issued directly each frame: no
        // temporary arrays, offscreen canvases, or unbounded cache colours.
        blit(cx, cy, r * 0.78, intensity * 0.65);
        const turn = time * 0.55;
        ctx.globalAlpha = Math.min(0.72, intensity * 1.7);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = Math.max(1.5, r * 0.045);
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * 1.02, r * 0.68, turn * 0.18, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * 0.78, r * 0.52, -turn * 0.14, 0, TAU);
        ctx.stroke();
        for (let i = 0; i < 4; i++) {
            const a = turn + i * Math.PI * 0.5;
            const rx = cx + Math.cos(a) * r * 1.02;
            const ry = cy + Math.sin(a) * r * 0.68;
            const size = r * 0.15;
            ctx.save();
            ctx.translate(rx, ry);
            ctx.rotate(a + Math.PI * 0.25);
            ctx.beginPath();
            ctx.moveTo(0, -size); ctx.lineTo(size * 0.62, 0);
            ctx.lineTo(0, size); ctx.lineTo(-size * 0.62, 0);
            ctx.closePath(); ctx.stroke();
            ctx.fillRect(-size * 0.12, -size * 0.12, size * 0.24, size * 0.24);
            ctx.restore();
        }
    } else if (fx === 'gloam_moths') {
        // Five readable moth glyphs orbit a soft centre glow. Wing motion is a
        // scalar derived from time; Reduced Effects fixes it at phase zero.
        blit(cx, cy, r * 0.78, intensity * 0.58);
        for (let i = 0; i < 5; i++) {
            const a = time * 0.62 + i * (TAU / 5);
            const mx = cx + Math.cos(a) * r * 1.02;
            const my = cy + Math.sin(a) * r * 0.65;
            const wing = 0.72 + 0.25 * Math.sin(time * 5.2 + i * 1.9);
            const size = r * (0.13 + (i % 2) * 0.025);
            ctx.save();
            ctx.translate(mx, my);
            ctx.rotate(a + Math.PI * 0.5);
            ctx.globalAlpha = Math.min(0.8, intensity * 1.9);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(-size * 1.25, -size * wing, -size * 0.35, size * 0.18);
            ctx.quadraticCurveTo(-size * 0.8, size * 0.75, 0, size * 0.32);
            ctx.quadraticCurveTo(size * 0.8, size * 0.75, size * 0.35, size * 0.18);
            ctx.quadraticCurveTo(size * 1.25, -size * wing, 0, 0);
            ctx.closePath(); ctx.fill();
            ctx.fillRect(-size * 0.09, -size * 0.28, size * 0.18, size * 0.82);
            ctx.restore();
        }
    } else if (fx === 'pulse') {
        const s = 0.5 + 0.5 * Math.sin(time * 4);
        blit(cx, cy, r * (0.9 + 0.22 * s), intensity * (0.7 + 0.6 * s));
    } else if (fx === 'flame') {
        blit(cx, cy, r * 0.95, intensity);
        for (let i = 0; i < 3; i++) {
            const ph = time * 6 + i * 2.1;
            const fy = cy - r * 0.45 - (0.5 + 0.5 * Math.sin(ph)) * r * 0.55;
            const fr = r * (0.34 + 0.12 * Math.sin(ph * 1.3));
            blit(cx + (i - 1) * r * 0.34, fy, fr, intensity * (0.45 + 0.4 * (0.5 + 0.5 * Math.sin(ph))));
        }
    } else if (fx === 'spin' || fx === 'starfield') {
        blit(cx, cy, r * 0.85, intensity * 0.65);
        const N = fx === 'starfield' ? 6 : 5;
        for (let i = 0; i < N; i++) {
            const a = time * 1.8 + i * (TAU / N);
            const mx = cx + Math.cos(a) * r * 0.98, my = cy + Math.sin(a) * r * 0.66;
            const tw = fx === 'starfield' ? (0.35 + 0.65 * Math.abs(Math.sin(time * 5 + i * 1.7))) : 0.85;
            blit(mx, my, r * 0.26 * tw + r * 0.06, intensity * tw);
        }
    } else {
        blit(cx, cy, r, intensity);          // default: static glow
    }
    ctx.restore();
}

// ── Rarity prestige layer ────────────────────────────────────────────────
// The flashiest equipped cosmetic sets a tier (1..6); from RARE up the hero
// carries visible prestige VFX in that piece's OWN colour — the "I earned
// this" flex that makes higher tiers worth grinding for:
//   3 rare       soft steady under-glow
//   4 epic       breathing pulse
//   5 legendary  pulse + rising ember-sparkles + star twinkles
//   6 mythic     all of it, hue-cycling through the spectrum
// Budget: ≤6 cached glow blits + ≤3 small paths, ONE hero only.

// Quantized prism hues (12 steps) so getGlowSprite's per-colour cache stays
// bounded — never key a glow by a continuous hsl string.
export const PRISM_COLORS = Array.from({ length: 12 }, (_, i) => `hsl(${i * 30},92%,62%)`);

export function drawRarityFx(ctx, cx, cy, r, tier, color, t) {
    if (!tier || tier < 3 || !color) return;
    const prism = tier >= 6;
    const col = prism ? PRISM_COLORS[Math.floor(t * 1.5) % 12] : color;
    const glow = getGlowSprite(col);
    if (!glow) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const blit = (gx, gy, gr, a) => { ctx.globalAlpha = Math.max(0, Math.min(1, a)); ctx.drawImage(glow, gx - gr, gy - gr, gr * 2, gr * 2); };

    // Base under-glow: steady at rare, breathing from epic up.
    const pulse = tier >= 4 ? 0.5 + 0.5 * Math.sin(t * 2.6) : 0;
    blit(cx, cy + r * 0.25, r * (0.72 + 0.10 * pulse), 0.10 + 0.05 * (tier - 3) + 0.06 * pulse);

    if (tier >= 5) {
        // Rising sparkles: 3 deterministic motes drifting up like slow embers
        // (positions derived purely from t — no per-frame allocation/state).
        for (let i = 0; i < 3; i++) {
            const ph = ((t * 0.45 + i / 3) % 1 + 1) % 1;
            const sx = cx + Math.sin(t * 1.7 + i * 2.7) * r * 0.55;
            const sy = cy + r * 0.5 - ph * r * 1.5;
            blit(sx, sy, r * 0.10 + r * 0.05 * Math.sin(ph * Math.PI), Math.sin(ph * Math.PI) * 0.5);
        }
        // Star twinkles: two brief white glints riding the sparkle rhythm.
        ctx.fillStyle = '#fff';
        for (let i = 0; i < 2; i++) {
            const tw = Math.max(0, Math.sin(t * 3.1 + i * 2.4));
            if (tw < 0.72) continue;                     // gated → mostly free
            const a = t * 0.9 + i * Math.PI;
            const px = cx + Math.cos(a) * r * 0.8, py = cy - r * 0.28 + Math.sin(a * 1.3) * r * 0.5;
            ctx.globalAlpha = (tw - 0.72) * 2.6;
            star(ctx, px, py, r * 0.10 + r * 0.05 * tw);
        }
    }
    ctx.restore();
}

// Set-bonus flourish: a slow counter-rotating double ring of bright motes
// around the hero, in the set's signature colour — the "you completed the whole
// look" payoff. Drawn around the aura; cheap (a few cached glow blits).
// Reduced Effects keeps the earned completion flourish visible while freezing
// both the orbit and twinkle at one deterministic phase.
export function drawSetBonus(ctx, cx, cy, r, color, t, reducedEffects = false) {
    if (!color) return;
    const time = reducedEffects ? 0 : t;
    const glow = getGlowSprite(color);
    if (!glow) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const N = 8;
    for (let ring = 0; ring < 2; ring++) {
        const dir = ring === 0 ? 1 : -1;
        const orbit = r * (1.18 + ring * 0.16);
        const spin = time * (0.9 + ring * 0.4) * dir;
        for (let i = 0; i < N; i++) {
            const a = spin + i * (TAU / N) + ring * (Math.PI / N);
            const mx = cx + Math.cos(a) * orbit, my = cy + Math.sin(a) * orbit * 0.72;
            const tw = 0.5 + 0.5 * Math.sin(time * 4 + i * 1.3 + ring);
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
export function drawTrailPoint(ctx, px, py, b, k, color, fx, t, idx, reducedEffects = false) {
    const time = reducedEffects ? 0 : t;
    ctx.globalCompositeOperation = fx === 'hearts' ? 'source-over' : 'lighter';
    ctx.fillStyle = trailFxColor(color, fx, time, idx, k) || color;
    if (fx === 'stars') { star(ctx, px, py, b * 0.95); return; }
    if (fx === 'hearts') { heart(ctx, px, py, b * 0.95); return; }
    if (fx === 'waymarks') {
        // Planted compass-runes alternate orientation by history index. They do
        // not rotate after being dropped, so movement reads as a marked path.
        const size = b * 0.9;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate((idx & 3) * Math.PI * 0.5);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, b * 0.16);
        ctx.beginPath();
        ctx.moveTo(0, -size); ctx.lineTo(size * 0.62, 0);
        ctx.lineTo(0, size); ctx.lineTo(-size * 0.62, 0);
        ctx.closePath(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.62); ctx.lineTo(0, size * 0.62);
        ctx.moveTo(-size * 0.38, 0); ctx.lineTo(size * 0.38, 0);
        ctx.stroke();
        ctx.fillRect(-b * 0.12, -b * 0.12, b * 0.24, b * 0.24);
        ctx.restore();
        return;
    }
    if (fx === 'gloam_wisps') {
        // Two bounded bezier strokes curl upward from each planted point. The
        // only animated value is `time`, frozen to zero under Reduced Effects.
        const phase = time * 2.1 + idx * 1.73;
        const sway = Math.sin(phase) * b * 0.38;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(1.5, b * 0.22);
        ctx.beginPath();
        ctx.moveTo(px - b * 0.34, py + b * 0.45);
        ctx.bezierCurveTo(px - b * 0.72, py - b * 0.05,
            px + sway, py - b * 0.5, px + sway * 0.45, py - b * 1.05);
        ctx.stroke();
        ctx.lineWidth = Math.max(1, b * 0.12);
        ctx.beginPath();
        ctx.moveTo(px + b * 0.38, py + b * 0.28);
        ctx.bezierCurveTo(px + b * 0.62, py - b * 0.18,
            px - sway * 0.55, py - b * 0.38, px - sway * 0.25, py - b * 0.78);
        ctx.stroke();
        ctx.fillRect(px + sway * 0.45 - b * 0.11, py - b * 1.16,
            b * 0.22, b * 0.22);
        ctx.restore();
        return;
    }
    // default / rainbow / flame → chunky pixel puffs (core + 3 satellites)
    ctx.fillRect(px - b / 2, py - b / 2, b, b);
    const s2 = Math.max(2, Math.round(b * 0.45));
    ctx.fillRect(px - b, py - s2 / 2, s2, s2);
    ctx.fillRect(px + b - s2, py - s2 / 2, s2, s2);
    ctx.fillRect(px - s2 / 2, py - b, s2, s2);
}
