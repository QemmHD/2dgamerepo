// LightingSystem — the "Emberlight" darkness veil.
//
// The world is drawn first at full brightness. This system then lays one
// dark veil over the whole screen with light-shaped holes carved out by
// every emitter (player staff, projectiles, gems, coins, chests, candles,
// boss eyes, weapon effects), so emissive things appear to pierce the
// dark. An optional faint additive color tint blooms warm/cool light into
// the holes.
//
// Technique (chosen for mobile Safari):
//   - ONE offscreen buffer at INTERNAL resolution (1920×1080), never ×DPR
//     — a fixed ~2.07M-px fill independent of device.
//   - Each frame: fill the buffer with a dark radial gradient (center
//     darkness + extra toward the corners = baked vignette), then for each
//     light draw a cached white mask with 'destination-out' to erase the
//     veil there (carving a hole). Composite the buffer to the screen with
//     one 'source-over' drawImage.
//   - Lights are registered from the already-culled entity draw loops, so
//     cost scales with VISIBLE emitters, never with total alive count.
//   - No ctx.filter anywhere (documented iOS hazard); only destination-out,
//     source-over, and 'lighter' for the tint.
//
// Falls back gracefully (ok=false) if an offscreen 2D context can't be
// created — Game then draws the plain vignette instead.

import { INTERNAL_WIDTH, INTERNAL_HEIGHT, GFX } from '../config/GameConfig.js';
import { getLightMaskSprite, getGlowSprite } from '../assets/ProceduralSprites.js';

const STRENGTH_CAP = 0.62;

export class LightingSystem {
    constructor() {
        this.ok = false;
        try {
            this.canvas = document.createElement('canvas');
            this.canvas.width = INTERNAL_WIDTH;
            this.canvas.height = INTERNAL_HEIGHT;
            this.lctx = this.canvas.getContext('2d');
            this.ok = !!this.lctx;
        } catch (_) {
            this.ok = false;
        }

        this.mask = null;
        this.camera = null;
        // Pending additive color-tint blits, collected during light
        // registration and flushed in composite().
        this.tints = [];
        this._count = 0;
        this._pickupCount = 0;

        // Mutable quality knobs (the FPS governor tweaks these).
        this.quality = {
            strength: Math.min(STRENGTH_CAP, GFX.darkness.strength),
            maxLights: GFX.lighting.maxLights,
            pickupCap: GFX.lighting.pickupLightCap,   // governor may reduce (roadmap #5 tiers)
            colorTint: GFX.lighting.colorTint,
            tintIntensity: GFX.lighting.tintIntensity,
        };
        this._veilGrad = null;
        this._veilStrength = -1;
    }

    setQuality(q) {
        if (q.strength != null) this.quality.strength = Math.min(STRENGTH_CAP, q.strength);
        if (q.maxLights != null) this.quality.maxLights = q.maxLights;
        if (q.pickupCap != null) this.quality.pickupCap = q.pickupCap;
        if (q.colorTint != null) this.quality.colorTint = q.colorTint;
        if (q.tintIntensity != null) this.quality.tintIntensity = q.tintIntensity;
    }

    _veilGradient() {
        // Cache the dark radial gradient; rebuild only when strength changes
        // so there's zero gradient allocation in the steady-state frame loop.
        if (this._veilGrad && this._veilStrength === this.quality.strength) {
            return this._veilGrad;
        }
        const cx = INTERNAL_WIDTH / 2;
        const cy = INTERNAL_HEIGHT / 2;
        const maxR = Math.hypot(cx, cy);
        const g = this.lctx.createRadialGradient(cx, cy, maxR * 0.25, cx, cy, maxR);
        const s = this.quality.strength;
        const edge = Math.min(0.9, s + GFX.darkness.vignetteBoost);
        g.addColorStop(0, rgba(GFX.darkness.color, s));
        g.addColorStop(1, rgba(GFX.darkness.color, edge));
        this._veilGrad = g;
        this._veilStrength = this.quality.strength;
        return g;
    }

    // Clear the buffer + paint the dark veil. Call once per frame before
    // registering lights.
    beginFrame(camera) {
        if (!this.ok) return;
        this.camera = camera;
        this._count = 0;
        this._pickupCount = 0;
        this.tints.length = 0;
        if (!this.mask) this.mask = getLightMaskSprite();

        const lctx = this.lctx;
        lctx.globalCompositeOperation = 'source-over';
        lctx.globalAlpha = 1;
        lctx.clearRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
        lctx.fillStyle = this._veilGradient();
        lctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
        // Switch to cutout mode for the light blits that follow.
        lctx.globalCompositeOperation = 'destination-out';
    }

    // Register a light at WORLD coords. priority: 0 = always (player,
    // projectiles, effects, boss), 1 = pickup (capped separately), 2 = low
    // (enemy eyes, dropped first under the global cap). color is optional
    // (#rrggbb) and feeds the additive tint pass.
    addLight(wx, wy, radius, color, intensity = 1, priority = 0) {
        if (!this.ok) return;
        if (priority === 1 && this._pickupCount >= this.quality.pickupCap) return;
        if (priority === 2 && this._count >= this.quality.maxLights) return;

        const cam = this.camera;
        // Photo-mode zoom: the veil buffer is fixed screen-space + composited
        // without setTransform, so holes must be carved at zoomed screen
        // positions (radius scales too) or the light drifts off the world.
        const z = cam.zoom || 1;
        const sx = (wx - cam.x) * z + INTERNAL_WIDTH / 2 + (cam.shakeOffsetX || 0);
        const sy = (wy - cam.y) * z + INTERNAL_HEIGHT / 2 + (cam.shakeOffsetY || 0);
        const r = radius * z;
        // Cull lights whose footprint is fully off the buffer.
        if (sx + r < 0 || sx - r > INTERNAL_WIDTH ||
            sy + r < 0 || sy - r > INTERNAL_HEIGHT) return;

        const lctx = this.lctx;
        lctx.globalAlpha = Math.min(1, intensity);
        lctx.drawImage(this.mask, sx - r, sy - r, r * 2, r * 2);

        this._count++;
        if (priority === 1) this._pickupCount++;
        if (this.quality.colorTint && color) {
            this.tints.push(sx, sy, r, color, intensity);
        }
    }

    // Composite the veil onto the screen, then bloom faint color into the
    // holes. Screen space (call after ctx.restore()).
    composite(ctx) {
        if (!this.ok) return;
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.drawImage(this.canvas, 0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
        ctx.restore();

        if (!this.quality.colorTint || this.tints.length === 0) return;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const ti = this.quality.tintIntensity;
        // tints is a flat [sx, sy, r, color, intensity, ...] list.
        for (let i = 0; i < this.tints.length; i += 5) {
            const sx = this.tints[i];
            const sy = this.tints[i + 1];
            const r = this.tints[i + 2] * 0.9;
            const color = this.tints[i + 3];
            const intensity = this.tints[i + 4];
            ctx.globalAlpha = Math.min(0.5, intensity * ti);
            const glow = getGlowSprite(color);
            ctx.drawImage(glow, sx - r, sy - r, r * 2, r * 2);
        }
        ctx.restore();
    }
}

// #rrggbb → rgba() string at the given alpha.
function rgba(hex, a) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
