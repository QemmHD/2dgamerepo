// ParticleSystem — pooled, hard-capped, allocation-free in the frame loop.
//
// One fixed preallocated pool (never grows). Spawns past the cap are simply
// dropped (combat feedback wins over ambient). Every particle is one
// drawImage of a cached glow sprite — no per-frame gradient/object
// allocation. Particles are grouped into three layers, each drawn in a
// single composite-state batch (no per-particle save/restore — the
// documented iOS de-opt):
//
//   FOG        (source-over, world space, BELOW entities) — drifting wisps
//   WORLD_ADD  ('lighter', world space, ABOVE entities, BELOW the veil) —
//              ambient embers + enemy death dust (these get occluded/dimmed
//              by the darkness veil, which is what we want for ambience)
//   SCREEN_ADD ('lighter', screen space, ABOVE the veil) — hit sparks,
//              pickup sparkles, level-up burst, muzzle: always bright so
//              feedback never dims.

import {
    GFX,
    INTERNAL_WIDTH as INTERNAL_W,
    INTERNAL_HEIGHT as INTERNAL_H,
} from '../config/GameConfig.js';
import { TWO_PI } from '../core/MathUtils.js';
import { getGlowSprite } from '../assets/ProceduralSprites.js';

const FOG = 0;
const WORLD_ADD = 1;
const SCREEN_ADD = 2;

export class ParticleSystem {
    constructor() {
        const cap = GFX.particles.max;
        this.pool = new Array(cap);
        for (let i = 0; i < cap; i++) {
            this.pool[i] = {
                active: false, x: 0, y: 0, vx: 0, vy: 0,
                age: 0, life: 1, size0: 8, size1: 8,
                color: '#fff', layer: WORLD_ADD, drag: 0, grav: 0, maxAlpha: 1,
            };
        }
        this.enabled = GFX.particles.enabled;
        this.max = cap;
        this.fogEnabled = GFX.particles.fog;
        this.emberRate = GFX.particles.emberRate;
        this.fogCount = GFX.particles.fogCount;
        this._emberTimer = 0;
        this._fogActive = 0;
    }

    reset() {
        for (const p of this.pool) p.active = false;
        this._emberTimer = 0;
        this._fogActive = 0;
    }

    setQuality(q) {
        if (q.max != null) this.max = Math.min(q.max, this.pool.length);
        if (q.fog != null) this.fogEnabled = q.fog;
    }

    // Live particle count (for the debug perf HUD). Cheap O(pool) scan; only
    // called when the debug panel is open.
    activeCount() {
        let n = 0;
        for (const p of this.pool) if (p.active) n++;
        return n;
    }

    _spawn() {
        const lim = this.max;
        for (let i = 0; i < lim; i++) {
            if (!this.pool[i].active) {
                this.pool[i].active = true;
                return this.pool[i];
            }
        }
        return null; // pool full — drop
    }

    // ── Emitters ───────────────────────────────────────────────────────
    deathBurst(x, y, color = '#ffcaa0') {
        if (!this.enabled) return;
        const n = 9;
        for (let i = 0; i < n; i++) {
            const p = this._spawn();
            if (!p) return;
            const a = Math.random() * TWO_PI;
            const sp = 90 + Math.random() * 200;
            p.x = x; p.y = y;
            p.vx = Math.cos(a) * sp;
            p.vy = Math.sin(a) * sp;
            p.age = 0; p.life = 0.4 + Math.random() * 0.4;
            p.size0 = 26 + Math.random() * 16; p.size1 = 4;
            p.color = color; p.layer = WORLD_ADD; p.drag = 3.4; p.grav = 40; p.maxAlpha = 0.9;
        }
        // A couple of slow ash puffs.
        for (let i = 0; i < 2; i++) {
            const p = this._spawn();
            if (!p) return;
            p.x = x + (Math.random() - 0.5) * 20;
            p.y = y + (Math.random() - 0.5) * 20;
            p.vx = (Math.random() - 0.5) * 30;
            p.vy = -10 - Math.random() * 24;
            p.age = 0; p.life = 0.7 + Math.random() * 0.5;
            p.size0 = 30; p.size1 = 70;
            p.color = '#3a2a22'; p.layer = WORLD_ADD; p.drag = 1.2; p.grav = -6; p.maxAlpha = 0.4;
        }
    }

    hitSpark(x, y, color = '#ffffff') {
        if (!this.enabled) return;
        const n = 5;
        for (let i = 0; i < n; i++) {
            const p = this._spawn();
            if (!p) return;
            const a = Math.random() * TWO_PI;
            const sp = 160 + Math.random() * 260;
            p.x = x; p.y = y;
            p.vx = Math.cos(a) * sp;
            p.vy = Math.sin(a) * sp;
            p.age = 0; p.life = 0.18 + Math.random() * 0.18;
            p.size0 = 22 + Math.random() * 12; p.size1 = 2;
            p.color = color; p.layer = SCREEN_ADD; p.drag = 6; p.grav = 0; p.maxAlpha = 1;
        }
    }

    pickupSparkle(x, y, color = '#ffd166') {
        if (!this.enabled) return;
        const n = 5;
        for (let i = 0; i < n; i++) {
            const p = this._spawn();
            if (!p) return;
            const a = Math.random() * TWO_PI;
            const sp = 40 + Math.random() * 90;
            p.x = x; p.y = y;
            p.vx = Math.cos(a) * sp;
            p.vy = Math.sin(a) * sp - 50;
            p.age = 0; p.life = 0.35 + Math.random() * 0.3;
            p.size0 = 18; p.size1 = 2;
            p.color = color; p.layer = SCREEN_ADD; p.drag = 4; p.grav = 60; p.maxAlpha = 1;
        }
    }

    levelUpBurst(x, y) {
        if (!this.enabled) return;
        const n = 18;
        for (let i = 0; i < n; i++) {
            const p = this._spawn();
            if (!p) return;
            const a = (i / n) * TWO_PI;
            const sp = 220 + Math.random() * 120;
            p.x = x; p.y = y;
            p.vx = Math.cos(a) * sp;
            p.vy = Math.sin(a) * sp;
            p.age = 0; p.life = 0.5 + Math.random() * 0.3;
            p.size0 = 26; p.size1 = 3;
            p.color = i % 2 ? '#ffe6b0' : '#ffd166';
            p.layer = SCREEN_ADD; p.drag = 3; p.grav = 0; p.maxAlpha = 1;
        }
    }

    // Boss death: a larger, layered burst (bright shard ring + colored
    // embers + heavy ash) so an apex kill feels like a setpiece, not just a
    // big enemy popping. Still pool-bounded — _spawn() returns null when full.
    bossDeathBurst(x, y, color = '#ffae66') {
        if (!this.enabled) return;
        const shards = 26;
        for (let i = 0; i < shards; i++) {
            const p = this._spawn();
            if (!p) break;
            const a = (i / shards) * TWO_PI + Math.random() * 0.2;
            const sp = 200 + Math.random() * 320;
            p.x = x; p.y = y;
            p.vx = Math.cos(a) * sp;
            p.vy = Math.sin(a) * sp;
            p.age = 0; p.life = 0.5 + Math.random() * 0.5;
            p.size0 = 28 + Math.random() * 18; p.size1 = 3;
            p.color = i % 3 === 0 ? '#ffffff' : color;
            p.layer = SCREEN_ADD; p.drag = 3.2; p.grav = 30; p.maxAlpha = 1;
        }
        for (let i = 0; i < 12; i++) {
            const p = this._spawn();
            if (!p) break;
            const a = Math.random() * TWO_PI;
            const sp = 60 + Math.random() * 160;
            p.x = x; p.y = y;
            p.vx = Math.cos(a) * sp;
            p.vy = Math.sin(a) * sp - 30;
            p.age = 0; p.life = 0.7 + Math.random() * 0.6;
            p.size0 = 34 + Math.random() * 20; p.size1 = 6;
            p.color = color; p.layer = WORLD_ADD; p.drag = 1.8; p.grav = -4; p.maxAlpha = 0.85;
        }
        for (let i = 0; i < 5; i++) {
            const p = this._spawn();
            if (!p) break;
            p.x = x + (Math.random() - 0.5) * 40;
            p.y = y + (Math.random() - 0.5) * 30;
            p.vx = (Math.random() - 0.5) * 40;
            p.vy = -14 - Math.random() * 28;
            p.age = 0; p.life = 0.9 + Math.random() * 0.6;
            p.size0 = 40; p.size1 = 110;
            p.color = '#2a1f1a'; p.layer = WORLD_ADD; p.drag = 1.0; p.grav = -5; p.maxAlpha = 0.45;
        }
    }

    // ── Elemental emitters ───────────────────────────────────────────
    // Burn: small orange embers rising off a burning enemy. WORLD_ADD so the
    // veil dims them into ambient glow. Fired per DoT tick (budgeted by the
    // caller), so the count stays low.
    burnEmbers(x, y) {
        if (!this.enabled) return;
        const n = 4;
        for (let i = 0; i < n; i++) {
            const p = this._spawn();
            if (!p) return;
            p.x = x + (Math.random() - 0.5) * 24;
            p.y = y + (Math.random() - 0.5) * 16;
            p.vx = (Math.random() - 0.5) * 30;
            p.vy = -30 - Math.random() * 40;
            p.age = 0; p.life = 0.3 + Math.random() * 0.25;
            p.size0 = 14 + Math.random() * 8; p.size1 = 2;
            p.color = '#ff7a33'; p.layer = WORLD_ADD; p.drag = 1.5; p.grav = -8; p.maxAlpha = 0.7;
        }
    }

    // Frost shatter: pale-cyan shards. SCREEN_ADD so a freeze/shatter reads
    // crisply above the veil.
    frostShards(x, y) {
        if (!this.enabled) return;
        const n = 5;
        for (let i = 0; i < n; i++) {
            const p = this._spawn();
            if (!p) return;
            const a = Math.random() * TWO_PI;
            const sp = 120 + Math.random() * 200;
            p.x = x; p.y = y;
            p.vx = Math.cos(a) * sp;
            p.vy = Math.sin(a) * sp;
            p.age = 0; p.life = 0.25 + Math.random() * 0.18;
            p.size0 = 18 + Math.random() * 8; p.size1 = 2;
            p.color = '#7fe0ff'; p.layer = SCREEN_ADD; p.drag = 5; p.grav = 0; p.maxAlpha = 1;
        }
    }

    // Shock crackle: yellow sparks (a hue-shifted hitSpark) on a shock stamp.
    shockSparks(x, y) {
        if (!this.enabled) return;
        const n = 5;
        for (let i = 0; i < n; i++) {
            const p = this._spawn();
            if (!p) return;
            const a = Math.random() * TWO_PI;
            const sp = 180 + Math.random() * 260;
            p.x = x; p.y = y;
            p.vx = Math.cos(a) * sp;
            p.vy = Math.sin(a) * sp;
            p.age = 0; p.life = 0.16 + Math.random() * 0.16;
            p.size0 = 20 + Math.random() * 10; p.size1 = 2;
            p.color = '#ffe066'; p.layer = SCREEN_ADD; p.drag = 6; p.grav = 0; p.maxAlpha = 1;
        }
    }

    _ember(x, y) {
        const p = this._spawn();
        if (!p) return;
        p.x = x; p.y = y;
        p.vx = (Math.random() - 0.5) * 14;
        p.vy = -8 - Math.random() * 24;
        p.age = 0; p.life = 1.4 + Math.random() * 1.6;
        p.size0 = 6 + Math.random() * 8; p.size1 = 1;
        p.color = Math.random() < 0.5 ? '#ff9a4a' : '#ffd27a';
        p.layer = WORLD_ADD; p.drag = 0.6; p.grav = -4; p.maxAlpha = 0.7;
    }

    _fog(x, y) {
        const p = this._spawn();
        if (!p) return;
        p.x = x; p.y = y;
        p.vx = (Math.random() - 0.5) * 18;
        p.vy = (Math.random() - 0.5) * 10;
        p.age = 0; p.life = 6 + Math.random() * 6;
        p.size0 = 260 + Math.random() * 200; p.size1 = 360 + Math.random() * 240;
        p.color = '#1b2e26'; p.layer = FOG; p.drag = 0; p.grav = 0;
        p.maxAlpha = 0.10 + Math.random() * 0.06;
    }

    update(dt, player) {
        if (!this.enabled) return;
        this._fogActive = 0;
        for (const p of this.pool) {
            if (!p.active) continue;
            p.age += dt;
            if (p.age >= p.life) { p.active = false; continue; }
            // Exponential drag.
            if (p.drag) {
                const d = Math.exp(-p.drag * dt);
                p.vx *= d; p.vy *= d;
            }
            p.vy += p.grav * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.layer === FOG) this._fogActive++;
        }

        if (!player) return;

        // Ambient embers drift up around the player.
        this._emberTimer += dt;
        const step = 1 / Math.max(1, this.emberRate);
        let guard = 0;
        while (this._emberTimer >= step && guard < 8) {
            this._emberTimer -= step;
            guard++;
            const a = Math.random() * TWO_PI;
            const r = 200 + Math.random() * 520;
            this._ember(player.x + Math.cos(a) * r, player.y + Math.sin(a) * r);
        }

        // Keep a loose population of fog wisps near the player.
        if (this.fogEnabled) {
            let spawns = 0;
            while (this._fogActive < this.fogCount && spawns < 2) {
                const a = Math.random() * TWO_PI;
                const r = Math.random() * 900;
                this._fog(player.x + Math.cos(a) * r, player.y + Math.sin(a) * r);
                this._fogActive++;
                spawns++;
            }
        }
    }

    // ── Draw layers ──────────────────────────────────────────────────
    // World-space fog, below entities. source-over, single batch.
    drawWorldFog(ctx, camera) {
        if (!this.enabled || !this.fogEnabled) return;
        const view = this._view(camera, 400);
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        for (const p of this.pool) {
            if (!p.active || p.layer !== FOG) continue;
            if (!inView(p.x, p.y, view)) continue;
            this._blit(ctx, p);
        }
        ctx.restore();
    }

    // World-space additive embers + death dust, above entities, below veil.
    drawWorldAdditive(ctx, camera) {
        if (!this.enabled) return;
        const view = this._view(camera, 200);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const p of this.pool) {
            if (!p.active || p.layer !== WORLD_ADD) continue;
            if (!inView(p.x, p.y, view)) continue;
            this._blit(ctx, p);
        }
        ctx.restore();
    }

    // Screen-space additive sparks, above the veil so they never dim.
    drawScreenAdditive(ctx, camera) {
        if (!this.enabled) return;
        const ox = INTERNAL_W / 2 - camera.x + (camera.shakeOffsetX || 0);
        const oy = INTERNAL_H / 2 - camera.y + (camera.shakeOffsetY || 0);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const p of this.pool) {
            if (!p.active || p.layer !== SCREEN_ADD) continue;
            const sx = p.x + ox;
            const sy = p.y + oy;
            if (sx < -64 || sx > INTERNAL_W + 64 || sy < -64 || sy > INTERNAL_H + 64) continue;
            this._blitAt(ctx, p, sx, sy);
        }
        ctx.restore();
    }

    _blit(ctx, p) {
        this._blitAt(ctx, p, p.x, p.y);
    }

    _blitAt(ctx, p, x, y) {
        const t = p.age / p.life;
        let alpha;
        if (p.layer === FOG) {
            alpha = Math.sin(Math.min(1, t) * Math.PI) * p.maxAlpha;
        } else {
            alpha = (1 - t) * p.maxAlpha;
        }
        if (alpha <= 0.01) return;
        const size = p.size0 + (p.size1 - p.size0) * t;
        ctx.globalAlpha = alpha;
        const glow = getGlowSprite(p.color);
        ctx.drawImage(glow, x - size / 2, y - size / 2, size, size);
    }

    _view(camera, margin) {
        return {
            left: camera.x - INTERNAL_W / 2 - margin,
            right: camera.x + INTERNAL_W / 2 + margin,
            top: camera.y - INTERNAL_H / 2 - margin,
            bottom: camera.y + INTERNAL_H / 2 + margin,
        };
    }
}

function inView(x, y, v) {
    return x >= v.left && x <= v.right && y >= v.top && y <= v.bottom;
}
