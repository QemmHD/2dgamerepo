// Projectile object pool (BOSSFORGE). Player bolts are the highest-churn
// allocation in combat — a fast weapon at the cap spawns and discards hundreds
// of Projectiles a second, each of which used to allocate a Set + two trail
// arrays. The pool recycles a fixed set of Projectile instances so the
// steady-state combat frame allocates NOTHING: acquire() pops a free instance
// and re-inits it via Projectile.reset(); release() returns it to the free
// stack when it dies.
//
// Exhaustion is a non-event: if every instance is live (far beyond any real
// concurrent-bolt count) acquire() allocates ONE more and folds it into the
// pool — a one-time cost, never per-frame — so a shot is never silently
// dropped. `grown` tracks those emergencies; it should stay 0 in real play.

import { Projectile } from '../entities/Projectile.js';

const DEFAULT_SIZE = 384;

export class ProjectilePool {
    constructor(size = DEFAULT_SIZE) {
        // `_all` owns every instance (for releaseAll on run restart); `_free`
        // is the LIFO free stack acquire/release move instances across.
        this._all = [];
        this._free = [];
        for (let i = 0; i < size; i++) {
            const p = new Projectile();   // inert (active=false) until reset()
            this._all.push(p);
            this._free.push(p);
        }
        this._stamp = 0;   // monotonic id handed to each acquired bolt (debug/telemetry)
        this.grown = 0;    // emergency allocations beyond the initial size
    }

    // Acquire + fully re-initialize a projectile. Mirrors `new Projectile(...)`.
    acquire(x, y, vx, vy, opts) {
        let p = this._free.pop();
        if (!p) {                          // pool drained — grow once, self-heals
            p = new Projectile();
            this._all.push(p);
            this.grown++;
        }
        return p.reset(x, y, vx, vy, opts, ++this._stamp);
    }

    // Return a dead projectile to the free stack. Caller must release each
    // instance exactly once (Game does this in the same pass that compacts it
    // out of the live array, so an instance is never released twice).
    release(p) {
        p.active = false;
        this._free.push(p);
    }

    // Reclaim EVERY instance (run restart): the live array is cleared by the
    // caller, so rebuild the free stack from `_all` — resetting `_free` first
    // guarantees no instance appears twice.
    releaseAll() {
        this._free.length = 0;
        for (let i = 0; i < this._all.length; i++) {
            const p = this._all[i];
            p.active = false;
            p.hitCount = 0;
            this._free.push(p);
        }
    }
}
