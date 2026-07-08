import { WEAPON, WORLD_WIDTH, WORLD_HEIGHT, SPRITE_SS } from '../config/GameConfig.js';
import { TWO_PI } from '../core/MathUtils.js';
import { getProjectileSprite, getGlowSprite } from '../assets/ProceduralSprites.js';

const WORLD_MARGIN = 200;

// Trail glow tint by elemental payload (fire/frost/shock); default ember.
const PROJECTILE_TRAIL_COLOR = {
    fire: '#ff7a3c',
    frost: '#7fd0ff',
    ice: '#7fd0ff',
    shock: '#ffe14a',
    default: '#ffd1a0',
};

// Max DISTINCT enemies one bolt can damage over its life = 1 + pierce + ricochet.
// The heaviest evolved weapons cap at pierce 4 / ricochet 4, so 16 slots is far
// above any reachable value. A projectile that somehow exceeds it simply stops
// recording (worst case a single harmless re-hit) — it never overflows.
const HITLIST_CAP = 16;
// Motion trail: a short ring of recent positions redrawn as fading ghosts.
const TRAIL_LEN = 6;

export class Projectile {
    // Poolable: `new Projectile()` builds an inert instance whose persistent
    // buffers (hit-list + trail ring) are allocated ONCE and reused for the
    // pool's lifetime; `reset(...)` re-inits every gameplay field. Passing
    // constructor args re-inits immediately (back-compat with `new Projectile(x,…)`).
    constructor(x, y, vx, vy, opts) {
        // Fixed hit-list replaces a per-projectile Set — no allocation on reuse
        // (hitCount=0 IS the clear; stale refs past hitCount are never read).
        this.hitList = new Array(HITLIST_CAP);
        this.hitCount = 0;
        // Trail ring buffer (fixed length, no push/shift churn). trailHead is
        // the next write slot; trailLen (0..TRAIL_LEN) is how many are valid.
        this.trailX = new Array(TRAIL_LEN);
        this.trailY = new Array(TRAIL_LEN);
        this.trailLen = 0;
        this.trailHead = 0;
        this._trailAccum = 0;
        this.active = false;
        if (x !== undefined) this.reset(x, y, vx, vy, opts);
    }

    // (Re)initialize every gameplay field. Returns `this` so the pool can
    // `return p.reset(...)`. `stamp` is a monotonic id from the pool (debug).
    reset(x, y, vx, vy, opts = {}, stamp = 0) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.damage = opts.damage ?? WEAPON.bolt.damage;
        this.lifetime = opts.lifetime ?? WEAPON.bolt.projectileLifetime;
        this.radius = opts.radius ?? WEAPON.bolt.projectileRadius;
        // pierce = additional enemies this projectile can hit before dying.
        // 0 means it dies on first hit (original Arcane Bolt L1 behavior).
        this.pierce = opts.pierce ?? 0;
        // ricochet = times this bolt can redirect to a fresh target after a
        // KILL (independent of pierce). ricochetRange caps the redirect hop.
        this.ricochet = opts.ricochet ?? 0;
        this.ricochetRange = opts.ricochetRange ?? 0;
        // Elemental payload. A FIRE bolt carries a burn that CollisionSystem
        // stamps on every enemy it touches — so it re-applies for free on each
        // pierce pass and on every ricochet hop (same object, same payload).
        this.element = opts.element ?? null;
        this.burnDps = opts.burnDps ?? 0;
        this.burnDuration = opts.burnDuration ?? 0;
        // Clear hit history: zeroing the count is the reset (contents left stale).
        this.hitCount = 0;
        this.age = 0;
        this.active = true;
        this.angle = Math.atan2(vy, vx);
        // Weapons may supply a tinted sprite (e.g. the ember bolt); default is
        // the arcane bolt art.
        this.sprite = opts.sprite ?? getProjectileSprite();
        // Reset the trail ring (drop any ghosts from a prior life).
        this.trailLen = 0;
        this.trailHead = 0;
        this._trailAccum = 0;
        this.trailColor = opts.trailColor ?? PROJECTILE_TRAIL_COLOR[this.element] ?? PROJECTILE_TRAIL_COLOR.default;
        this._stamp = stamp;
        return this;
    }

    // Per-projectile hit tracking (replaces a Set). Linear scan over ≤16 entries
    // is faster than Set ops and, unlike a shared enemy stamp, correctly records
    // that THIS bolt already hit an enemy even when other bolts hit it too.
    hasHit(e) {
        for (let i = 0; i < this.hitCount; i++) {
            if (this.hitList[i] === e) return true;
        }
        return false;
    }

    markHit(e) {
        if (this.hitCount < this.hitList.length) this.hitList[this.hitCount++] = e;
    }

    update(dt) {
        // Sample a sparse trail (every ~16ms) before moving so ghosts sit
        // behind the head. Ring buffer: overwrite the head slot, advance, wrap.
        this._trailAccum += dt;
        if (this._trailAccum >= 0.016) {
            this._trailAccum = 0;
            this.trailX[this.trailHead] = this.x;
            this.trailY[this.trailHead] = this.y;
            this.trailHead = (this.trailHead + 1) % TRAIL_LEN;
            if (this.trailLen < TRAIL_LEN) this.trailLen++;
        }
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.age += dt;
        if (this.age >= this.lifetime) {
            this.active = false;
            return;
        }
        const halfW = WORLD_WIDTH / 2 + WORLD_MARGIN;
        const halfH = WORLD_HEIGHT / 2 + WORLD_MARGIN;
        if (this.x < -halfW || this.x > halfW || this.y < -halfH || this.y > halfH) {
            this.active = false;
        }
    }

    draw(ctx) {
        // Additive ghost trail behind the head — older samples fade + shrink.
        // Walk the ring from oldest → newest so the fade reads the same as the
        // old push/shift list did.
        const n = this.trailLen;
        if (n > 1) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = this.trailColor;
            const start = (this.trailHead - n + TRAIL_LEN) % TRAIL_LEN;   // oldest
            for (let i = 0; i < n; i++) {
                const idx = (start + i) % TRAIL_LEN;
                const f = (i + 1) / n;           // 0 (oldest) → 1 (newest)
                ctx.globalAlpha = 0.32 * f;
                ctx.beginPath();
                ctx.arc(this.trailX[idx], this.trailY[idx], this.radius * (0.4 + 0.6 * f), 0, TWO_PI);
                ctx.fill();
            }
            ctx.restore();
        }
        // Element-tinted core glow behind the head (cached blit) so each bolt
        // reads as hot energy in its element's colour, not a flat pip.
        {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.5;
            const gs = this.radius * 3.2;
            ctx.drawImage(getGlowSprite(this.trailColor), this.x - gs / 2, this.y - gs / 2, gs, gs);
            ctx.restore();
        }
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        // Source is supersampled (SPRITE_SS×); draw at logical world size.
        const w = this.sprite.width / SPRITE_SS;
        const h = this.sprite.height / SPRITE_SS;
        ctx.drawImage(this.sprite, -w / 2, -h / 2, w, h);
        ctx.restore();
    }

    drawDebug(ctx) {
        ctx.save();
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, TWO_PI);
        ctx.stroke();
        ctx.restore();
    }
}
