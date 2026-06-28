// ObstacleSystem — owns the world's solid map objects and every query against
// them: collision resolution (slide-along-wall), line-of-sight for attacks,
// and safe-spawn validation. Placement is deterministic (seeded) so the same
// world layout regenerates every load.
//
// Coordinate space is world px, same as entities. Obstacle footprints sit at
// the object's (x, y); see Obstacle.js / mapObjects.js.
//
// Public API used across the game:
//   generate(worldW, worldH)
//   resolveCircle(x, y, r)            → { x, y } pushed out of walls (slides)
//   isBlocked(x, y, clearance)        → true if a circle there hits a wall
//   hasLineOfSight(ax, ay, bx, by)    → false if a sight-blocking wall is between
//   forVisible(cam, vw, vh, fn)       → fn(obstacle) for on-screen obstacles
//   drawDebug(ctx, cam, vw, vh)

import { Obstacle } from '../entities/Obstacle.js';
import { MAP_OBJECT_LIST, OBSTACLE_PLACEMENT, footprintDepth } from '../content/mapObjects.js';

const GRID_CELL = 320;
const MAX_OBSTACLES = 220;

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export class ObstacleSystem {
    constructor() {
        this.obstacles = [];
        this.grid = new Map();     // 'gx,gy' → [obstacle, ...]
        this.worldW = 0;
        this.worldH = 0;
        this._totalWeight = MAP_OBJECT_LIST.reduce((s, d) => s + (d.weight ?? 1), 0);
    }

    generate(worldW, worldH) {
        this.worldW = worldW;
        this.worldH = worldH;
        this.obstacles = [];
        this.grid.clear();

        const P = OBSTACLE_PLACEMENT;
        const rng = mulberry32(P.seed ^ (worldW * 73856093) ^ (worldH * 19349663));
        const halfW = worldW / 2;
        const halfH = worldH / 2;
        const clearSq = P.clearRadius * P.clearRadius;

        for (let cy = -halfH + P.cellSize / 2; cy < halfH; cy += P.cellSize) {
            for (let cx = -halfW + P.cellSize / 2; cx < halfW; cx += P.cellSize) {
                if (this.obstacles.length >= MAX_OBSTACLES) break;
                if (rng() > P.perCellChance) continue;

                const x = cx + (rng() - 0.5) * 2 * P.jitter;
                const y = cy + (rng() - 0.5) * 2 * P.jitter;

                // Keep the spawn area open.
                if (x * x + y * y < clearSq) continue;
                // Keep off the very edge.
                if (x < -halfW + P.edgeMargin || x > halfW - P.edgeMargin ||
                    y < -halfH + P.edgeMargin || y > halfH - P.edgeMargin) continue;

                const def = this._pickType(rng);
                const ob = new Obstacle(def, x, y);

                // Don't let footprints overlap (keeps walkable gaps open).
                if (this._tooClose(ob)) continue;
                this.obstacles.push(ob);
            }
        }

        // Painter's order: lower baseY drawn first (further "back").
        this.obstacles.sort((a, b) => a.baseY - b.baseY);
        this._buildGrid();
        return this.obstacles;
    }

    _pickType(rng) {
        let r = rng() * this._totalWeight;
        for (const def of MAP_OBJECT_LIST) {
            r -= def.weight ?? 1;
            if (r <= 0) return def;
        }
        return MAP_OBJECT_LIST[0];
    }

    _radiusOf(ob) {
        const c = ob.def.col;
        return ob.shape === 'circle' ? c.r : Math.hypot(c.hw, c.hh);
    }

    _tooClose(ob) {
        const rA = this._radiusOf(ob);
        for (const other of this.obstacles) {
            const minGap = rA + this._radiusOf(other) + 70;
            if ((ob.x - other.x) ** 2 + (ob.y - other.y) ** 2 < minGap * minGap) return true;
        }
        return false;
    }

    _buildGrid() {
        this.grid.clear();
        for (const ob of this.obstacles) {
            const b = ob.bounds();
            const gx0 = Math.floor(b.minX / GRID_CELL), gx1 = Math.floor(b.maxX / GRID_CELL);
            const gy0 = Math.floor(b.minY / GRID_CELL), gy1 = Math.floor(b.maxY / GRID_CELL);
            for (let gy = gy0; gy <= gy1; gy++) {
                for (let gx = gx0; gx <= gx1; gx++) {
                    const key = gx + ',' + gy;
                    let bucket = this.grid.get(key);
                    if (!bucket) { bucket = []; this.grid.set(key, bucket); }
                    bucket.push(ob);
                }
            }
        }
    }

    // Gather unique obstacles whose footprint may overlap the bbox [minX..maxX].
    _nearby(minX, minY, maxX, maxY) {
        const gx0 = Math.floor(minX / GRID_CELL), gx1 = Math.floor(maxX / GRID_CELL);
        const gy0 = Math.floor(minY / GRID_CELL), gy1 = Math.floor(maxY / GRID_CELL);
        const seen = new Set();
        const out = [];
        for (let gy = gy0; gy <= gy1; gy++) {
            for (let gx = gx0; gx <= gx1; gx++) {
                const bucket = this.grid.get(gx + ',' + gy);
                if (!bucket) continue;
                for (const ob of bucket) {
                    if (!seen.has(ob)) { seen.add(ob); out.push(ob); }
                }
            }
        }
        return out;
    }

    // ── Collision ────────────────────────────────────────────────────────

    // Penetration of a circle into one obstacle. Returns {nx, ny, depth} where
    // (nx, ny) is the unit push-out direction, or null if no overlap.
    _penetration(cx, cy, cr, ob) {
        if (ob.shape === 'circle') {
            const R = cr + ob.def.col.r;
            let dx = cx - ob.x, dy = cy - ob.y;
            let d = Math.hypot(dx, dy);
            if (d >= R) return null;
            if (d < 1e-4) { dx = 0; dy = -1; d = 1; }
            return { nx: dx / d, ny: dy / d, depth: R - d };
        }
        // rect (AABB) vs circle
        const hw = ob.def.col.hw, hh = ob.def.col.hh;
        const qx = Math.max(ob.x - hw, Math.min(cx, ob.x + hw));
        const qy = Math.max(ob.y - hh, Math.min(cy, ob.y + hh));
        let dx = cx - qx, dy = cy - qy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= cr * cr) {
            // Center may be INSIDE the box (closest point == center).
            if (cx > ob.x - hw && cx < ob.x + hw && cy > ob.y - hh && cy < ob.y + hh) {
                const left = (cx - (ob.x - hw)), right = ((ob.x + hw) - cx);
                const top = (cy - (ob.y - hh)), bottom = ((ob.y + hh) - cy);
                const m = Math.min(left, right, top, bottom);
                if (m === left) return { nx: -1, ny: 0, depth: left + cr };
                if (m === right) return { nx: 1, ny: 0, depth: right + cr };
                if (m === top) return { nx: 0, ny: -1, depth: top + cr };
                return { nx: 0, ny: 1, depth: bottom + cr };
            }
            return null;
        }
        const d = Math.sqrt(d2);
        if (d < 1e-4) return { nx: 0, ny: -1, depth: cr };
        return { nx: dx / d, ny: dy / d, depth: cr - d };
    }

    // Push a moving circle out of every wall it overlaps. Because we only
    // cancel the penetration-normal component, motion parallel to the wall is
    // preserved → the entity slides instead of sticking.
    resolveCircle(x, y, r) {
        if (this.obstacles.length === 0) return { x, y };
        let cx = x, cy = y;
        for (let pass = 0; pass < 2; pass++) {
            const near = this._nearby(cx - r, cy - r, cx + r, cy + r);
            if (near.length === 0) break;
            let moved = false;
            for (const ob of near) {
                const pen = this._penetration(cx, cy, r, ob);
                if (pen) { cx += pen.nx * pen.depth; cy += pen.ny * pen.depth; moved = true; }
            }
            if (!moved) break;
        }
        return { x: cx, y: cy };
    }

    // True if a circle of `clearance` at (x, y) overlaps any obstacle footprint.
    isBlocked(x, y, clearance = 0) {
        const near = this._nearby(x - clearance, y - clearance, x + clearance, y + clearance);
        for (const ob of near) {
            if (this._penetration(x, y, Math.max(1, clearance), ob)) return true;
        }
        return false;
    }

    // ── Line of sight ──────────────────────────────────────────────────────

    _segmentHitsCircle(ax, ay, bx, by, ox, oy, r) {
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy || 1e-6;
        let t = ((ox - ax) * dx + (oy - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = ax + t * dx, py = ay + t * dy;
        return (px - ox) ** 2 + (py - oy) ** 2 <= r * r;
    }

    // Segment vs AABB (slab method).
    _segmentHitsRect(ax, ay, bx, by, ox, oy, hw, hh) {
        const minX = ox - hw, maxX = ox + hw, minY = oy - hh, maxY = oy + hh;
        // Trivial: an endpoint inside the box.
        if ((ax >= minX && ax <= maxX && ay >= minY && ay <= maxY) ||
            (bx >= minX && bx <= maxX && by >= minY && by <= maxY)) return true;
        let t0 = 0, t1 = 1;
        const dx = bx - ax, dy = by - ay;
        const clip = (p, q) => {
            if (Math.abs(p) < 1e-6) return q >= 0;       // parallel: inside slab?
            const r = q / p;
            if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
            else { if (r < t0) return false; if (r < t1) t1 = r; }
            return true;
        };
        if (clip(-dx, ax - minX) && clip(dx, maxX - ax) &&
            clip(-dy, ay - minY) && clip(dy, maxY - ay)) return t0 <= t1;
        return false;
    }

    _segmentHits(ax, ay, bx, by, ob) {
        if (ob.shape === 'circle') return this._segmentHitsCircle(ax, ay, bx, by, ob.x, ob.y, ob.def.col.r);
        return this._segmentHitsRect(ax, ay, bx, by, ob.x, ob.y, ob.def.col.hw, ob.def.col.hh);
    }

    // True if nothing that blocks sight stands between the two points.
    hasLineOfSight(ax, ay, bx, by) {
        if (this.obstacles.length === 0) return true;
        const near = this._nearby(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
        for (const ob of near) {
            if (!ob.blocksLOS) continue;
            if (this._segmentHits(ax, ay, bx, by, ob)) return false;
        }
        return true;
    }

    // True if a segment is blocked by ANY solid obstacle (used by projectiles,
    // which collide with walls whether or not those walls block "sight").
    segmentBlocked(ax, ay, bx, by) {
        if (this.obstacles.length === 0) return false;
        const near = this._nearby(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
        for (const ob of near) {
            if (this._segmentHits(ax, ay, bx, by, ob)) return true;
        }
        return false;
    }

    // ── Rendering helpers ────────────────────────────────────────────────

    // Call fn(obstacle) for each obstacle whose art may be on screen, in
    // painter's (baseY) order. `fn` is responsible for drawing.
    forVisible(cam, vw, vh, fn, predicate = null) {
        const left = cam.x - vw / 2 - 200, right = cam.x + vw / 2 + 200;
        const top = cam.y - vh / 2 - 300, bottom = cam.y + vh / 2 + 200;
        for (const ob of this.obstacles) {
            if (predicate && !predicate(ob)) continue;
            const w = ob.def.size.w, h = ob.def.size.h;
            if (ob.x + w < left || ob.x - w > right) continue;
            if (ob.y < top || ob.y - h > bottom) continue;
            fn(ob);
        }
    }

    drawDebug(ctx, cam, vw, vh) {
        ctx.save();
        ctx.lineWidth = 2;
        this.forVisible(cam, vw, vh, (ob) => {
            ctx.strokeStyle = ob.blocksLOS ? 'rgba(255,80,80,0.9)' : 'rgba(255,180,60,0.85)';
            if (ob.shape === 'circle') {
                ctx.beginPath(); ctx.arc(ob.x, ob.y, ob.def.col.r, 0, Math.PI * 2); ctx.stroke();
            } else {
                ctx.strokeRect(ob.x - ob.def.col.hw, ob.y - ob.def.col.hh, ob.def.col.hw * 2, ob.def.col.hh * 2);
            }
            ctx.fillStyle = 'rgba(120,220,255,0.9)';
            ctx.beginPath(); ctx.arc(ob.x, ob.y, 3, 0, Math.PI * 2); ctx.fill();
        });
        ctx.restore();
    }
}
