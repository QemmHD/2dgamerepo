// One shared per-frame spatial index over the enemy set (BOSSFORGE). Rebuilt
// once per frame (at the end of enemy movement + separation, when positions are
// final), it replaces every system that used to build its own enemy grid or
// scan the whole roster:
//
//   • the collision broadphase (projectile↔enemy) queries this grid instead of
//     building a private one;
//   • auto-aim / radius / pulse weapons can query nearestEnemy/queryCircle
//     instead of an O(enemies) scan each;
//   • activeEnemies / visibleEnemies are computed ONCE and cached.
//
// Timing note that makes one build serve everyone exactly: nothing moves enemies
// between frames, so the positions captured at the END of frame N's movement are
// identical to the positions at the START of frame N+1. So this single index
// serves collision THIS frame (post-move, exact) AND next frame's pre-move
// auto-aim (exact) — no staleness.
//
// There is deliberately NO projectile grid: the only broadphase consumer is
// projectile↔enemy, which queries THIS (enemy) grid per projectile. Nothing in
// the game asks "which projectiles are near a point," so a projectile grid would
// be pure overhead. Add one here only when a real consumer appears.
//
// GC-clean, mirroring ENEMY_SEPARATION / PROJECTILE_BROADPHASE: numeric cell
// keys, persistent buckets, and only last frame's filled buckets are reset, so a
// steady-state rebuild allocates nothing.

import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../config/GameConfig.js';

const DEFAULT_CELL = 128;   // matches the projectile-broadphase cell

export class FrameSpatialIndex {
    constructor(cell = DEFAULT_CELL) {
        this.cell = cell;
        this.activeEnemies = [];    // reused; all active enemies this frame
        this.visibleEnemies = [];   // reused; active enemies within the camera view
        this.maxRadius = 0;         // largest active-enemy radius (for overlap padding)
        this.count = 0;
        this._grid = new Map();     // numericCellKey → Enemy[]
        this._used = [];            // buckets filled last rebuild, for O(k) reset
        this._scratch = [];         // reused output for query* when no `out` given
    }

    // The raw cell → bucket map (collision reads this directly for its per-
    // projectile candidate gather).
    get enemyGrid() { return this._grid; }

    // Rebuild from `enemies` at their current positions. camX/camY is the camera
    // center; `viewMargin` widens the on-screen test for visibleEnemies.
    rebuild(enemies, camX, camY, viewMargin = 60) {
        const cell = this.cell;
        const grid = this._grid;
        const used = this._used;
        for (let i = 0; i < used.length; i++) used[i].length = 0;
        used.length = 0;
        this.activeEnemies.length = 0;
        this.visibleEnemies.length = 0;
        let maxR = 0;
        const vw = INTERNAL_WIDTH / 2 + viewMargin;
        const vh = INTERNAL_HEIGHT / 2 + viewMargin;
        for (const e of enemies) {
            if (!e.active) continue;
            this.activeEnemies.push(e);
            if (e.radius > maxR) maxR = e.radius;
            if (Math.abs(e.x - camX) <= vw && Math.abs(e.y - camY) <= vh) this.visibleEnemies.push(e);
            const key = Math.floor(e.x / cell) * 65536 + Math.floor(e.y / cell);
            let b = grid.get(key);
            if (!b) { b = []; grid.set(key, b); }
            if (b.length === 0) used.push(b);
            b.push(e);
        }
        this.maxRadius = maxR;
        this.count = this.activeEnemies.length;
        return this;
    }

    // Active enemies whose CENTER lies within `radius` of (x, y), appended to
    // `out` (or a reused scratch — copy it if you need it past the next call).
    queryCircle(x, y, radius, out = null) {
        const res = out || (this._scratch.length = 0, this._scratch);
        const cell = this.cell;
        const grid = this._grid;
        const r2 = radius * radius;
        const gx0 = Math.floor((x - radius) / cell), gx1 = Math.floor((x + radius) / cell);
        const gy0 = Math.floor((y - radius) / cell), gy1 = Math.floor((y + radius) / cell);
        for (let gy = gy0; gy <= gy1; gy++) {
            for (let gx = gx0; gx <= gx1; gx++) {
                const b = grid.get(gx * 65536 + gy);
                if (!b) continue;
                for (let i = 0; i < b.length; i++) {
                    const e = b[i];
                    const dx = e.x - x, dy = e.y - y;
                    if (dx * dx + dy * dy <= r2) res.push(e);
                }
            }
        }
        return res;
    }

    // Active enemies whose CENTER lies within the axis-aligned rect [l,t]-[r,b],
    // appended to `out` (or a reused scratch).
    queryRect(l, t, r, b, out = null) {
        const res = out || (this._scratch.length = 0, this._scratch);
        const cell = this.cell;
        const grid = this._grid;
        const gx0 = Math.floor(l / cell), gx1 = Math.floor(r / cell);
        const gy0 = Math.floor(t / cell), gy1 = Math.floor(b / cell);
        for (let gy = gy0; gy <= gy1; gy++) {
            for (let gx = gx0; gx <= gx1; gx++) {
                const bucket = grid.get(gx * 65536 + gy);
                if (!bucket) continue;
                for (let i = 0; i < bucket.length; i++) {
                    const e = bucket[i];
                    if (e.x >= l && e.x <= r && e.y >= t && e.y <= b) res.push(e);
                }
            }
        }
        return res;
    }

    // Nearest active enemy to (x, y) within `range`, or null. `accept` is an
    // optional per-enemy predicate (e.g. an on-screen test) applied before an
    // enemy can win — so a caller reproduces its exact old filter. Grid-bounded:
    // only cells within `range` are visited.
    nearestEnemy(x, y, range, accept = null) {
        const cell = this.cell;
        const grid = this._grid;
        const gx0 = Math.floor((x - range) / cell), gx1 = Math.floor((x + range) / cell);
        const gy0 = Math.floor((y - range) / cell), gy1 = Math.floor((y + range) / cell);
        let best = null;
        let bestSq = range * range;   // bounds candidates to within `range`
        for (let gy = gy0; gy <= gy1; gy++) {
            for (let gx = gx0; gx <= gx1; gx++) {
                const b = grid.get(gx * 65536 + gy);
                if (!b) continue;
                for (let i = 0; i < b.length; i++) {
                    const e = b[i];
                    const dx = e.x - x, dy = e.y - y;
                    const dsq = dx * dx + dy * dy;
                    if (dsq < bestSq && (!accept || accept(e))) { bestSq = dsq; best = e; }
                }
            }
        }
        return best;
    }
}
