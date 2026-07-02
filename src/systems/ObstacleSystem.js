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
import {
    MAP_OBJECTS, MAP_OBJECT_LIST, OBSTACLE_PLACEMENT, footprintDepth,
    BIOME_THEME, DEFAULT_BIOME_THEME, MAP_STRUCTURES, STRUCTURE_PLACEMENT,
} from '../content/mapObjects.js';

const GRID_CELL = 320;
const MAX_OBSTACLES = 240;

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Small FNV-ish string hash so a biome id perturbs the placement seed —
// different biomes get different (but each individually deterministic) layouts.
function strHash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
}

// ── Biome colour tinting ─────────────────────────────────────────────────
function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
    const c = (v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
}
function hexLerp(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
// Lerp a {base,top,edge} palette toward the biome tint colour (edge less, to
// keep silhouette definition). Returns a fresh palette object.
function tintPalette(p, tint) {
    if (!tint || !tint.amt) return { base: p.base, top: p.top, edge: p.edge };
    const t = tint.amt, c = tint.color;
    return { base: hexLerp(p.base, c, t), top: hexLerp(p.top, c, t), edge: hexLerp(p.edge, c, t * 0.7) };
}

export class ObstacleSystem {
    constructor() {
        this.obstacles = [];
        this.grid = new Map();     // 'gx,gy' → [obstacle, ...]
        this.worldW = 0;
        this.worldH = 0;
    }

    // biomeId selects the per-biome prop set, building styles, and colour tint
    // (BIOME_THEME). It also perturbs the seed so each biome is a distinct —
    // but individually deterministic — world layout.
    generate(worldW, worldH, biomeId = DEFAULT_BIOME_THEME) {
        this.worldW = worldW;
        this.worldH = worldH;
        this.obstacles = [];
        this.grid.clear();

        const theme = BIOME_THEME[biomeId] || BIOME_THEME[DEFAULT_BIOME_THEME];
        const tint = theme.tint;
        // Pre-tint each prop palette once per generate, keyed by type.
        this._tintByType = {};
        for (const type of Object.keys(theme.props)) {
            const def = MAP_OBJECTS[type];
            if (def) this._tintByType[type] = tintPalette(def.palette, tint);
        }
        // Build the biome's weighted prop list.
        this._propEntries = Object.entries(theme.props)
            .map(([type, weight]) => ({ def: MAP_OBJECTS[type], weight }))
            .filter((e) => e.def);
        this._propTotalWeight = this._propEntries.reduce((s, e) => s + e.weight, 0) || 1;

        const P = OBSTACLE_PLACEMENT;
        const rng = mulberry32(P.seed ^ strHash(biomeId) ^ (worldW * 73856093) ^ (worldH * 19349663));
        const halfW = worldW / 2;
        const halfH = worldH / 2;
        const clearSq = P.clearRadius * P.clearRadius;

        // Buildings first — sparse landmarks props then avoid (via _tooClose).
        this._placeStructures(rng, theme, tint);

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
                ob.palette = this._tintByType[def.type] || def.palette;
                // Raw biome tint rides along for the AI-sprite path (sprites
                // bake their own colours; the tint is applied as a wash).
                ob.tint = tint;

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
        const entries = this._propEntries;
        if (!entries || !entries.length) return MAP_OBJECT_LIST[0];
        let r = rng() * this._propTotalWeight;
        for (const e of entries) {
            r -= e.weight;
            if (r <= 0) return e.def;
        }
        return entries[0].def;
    }

    // ── Buildings (enterable structures) ─────────────────────────────────
    // Expand each placed blueprint into wall-segment obstacles forming a ring
    // with a doorway gap. Placed before props; the doorway faces the world
    // origin so a player running outward from spawn meets the entrance.
    _placeStructures(rng, theme, tint) {
        const styles = theme.structures || [];
        if (!styles.length) return;
        const SP = STRUCTURE_PLACEMENT;
        const halfW = this.worldW / 2, halfH = this.worldH / 2;
        const clearSq = SP.clearRadius * SP.clearRadius;
        let placed = 0;
        for (let a = 0; a < SP.attempts && placed < SP.count; a++) {
            const style = MAP_STRUCTURES[styles[(rng() * styles.length) | 0]];
            if (!style) continue;
            const outHW = style.interiorW / 2 + style.wall;
            const outHH = style.interiorH / 2 + style.wall;
            const x = (rng() * 2 - 1) * (halfW - SP.edgeMargin - outHW);
            const y = (rng() * 2 - 1) * (halfH - SP.edgeMargin - outHH);
            if (x * x + y * y < clearSq) continue;
            // Footprint (plus gap) must be free of already-placed buildings.
            if (this._areaBlocked(x - outHW - SP.gap, y - outHH - SP.gap,
                                  x + outHW + SP.gap, y + outHH + SP.gap)) continue;
            const doorSide = Math.abs(x) > Math.abs(y)
                ? (x > 0 ? 'left' : 'right')
                : (y > 0 ? 'top' : 'bottom');
            this._addBuilding(style, x, y, doorSide, tintPalette(style.palette, tint), tint);
            placed++;
        }
    }

    _addBuilding(style, cx, cy, doorSide, palette, tint = null) {
        const iHW = style.interiorW / 2, iHH = style.interiorH / 2;
        const T = style.wall, H = style.wallH, half = T / 2;
        const spanHW = iHW + T;       // horizontal walls cover the corners
        const dHalf = style.door / 2;

        const addWall = (x, y, hw, hh) => {
            if (hw <= 4 || hh <= 2) return;
            const def = {
                type: 'buildingWall', shape: 'rect',
                col: { hw, hh }, size: { w: hw * 2, h: H },
                blocksLOS: true, palette, styleType: style.type,
            };
            const ob = new Obstacle(def, x, y);
            ob.palette = palette;
            // Raw biome tint for the wall-texture wash (the pattern PNGs are
            // untinted; the tinted palette only covers coping/edges).
            ob.tint = tint;
            this.obstacles.push(ob);
        };
        // Horizontal walls (top = back, bottom = front), each spanning full width.
        const addH = (wy, isDoor) => {
            if (!isDoor) { addWall(cx, wy, spanHW, half); return; }
            const segHW = (spanHW - dHalf) / 2;
            addWall(cx - (dHalf + spanHW) / 2, wy, segHW, half);
            addWall(cx + (dHalf + spanHW) / 2, wy, segHW, half);
        };
        // Vertical walls (left/right), spanning the interior height.
        const addV = (wx, isDoor) => {
            if (!isDoor) { addWall(wx, cy, half, iHH); return; }
            const segHH = (iHH - dHalf) / 2;
            addWall(wx, cy - (dHalf + iHH) / 2, half, segHH);
            addWall(wx, cy + (dHalf + iHH) / 2, half, segHH);
        };
        // Houses now open from BOTH the top and the bottom — a walk-through
        // refuge you can enter from either side and pass straight through (the
        // side walls stay solid so big enemies can't follow through the narrow
        // door). doorSide is no longer used for the horizontal walls.
        addH(cy - iHH - half, true);   // top doorway
        addH(cy + iHH + half, true);   // bottom doorway
        addV(cx - iHW - half, false);  // solid left
        addV(cx + iHW + half, false);  // solid right

        // Interior decoration: a non-colliding floor decal (rug + hearth +
        // a furniture silhouette) so a house reads as lived-in, not an empty
        // box. Drawn under entities; never blocks movement, LOS, or spawns.
        const floor = {
            type: 'buildingFloor', shape: 'rect', decorative: true,
            col: { hw: iHW, hh: iHH }, size: { w: iHW * 2, h: iHH * 2 },
            blocksLOS: false, palette, styleType: style.type,
        };
        const fob = new Obstacle(floor, cx, cy);
        fob.palette = palette;
        fob.tint = tint;
        fob.baseY = cy - iHH;   // sort behind the player/walls (floor layer)
        this.obstacles.push(fob);
    }

    // True if any already-placed obstacle's footprint overlaps the bbox. Used
    // during building placement (grid not built yet, so scans the list).
    _areaBlocked(minX, minY, maxX, maxY) {
        for (const ob of this.obstacles) {
            const b = ob.bounds();
            if (b.maxX < minX || b.minX > maxX || b.maxY < minY || b.minY > maxY) continue;
            return true;
        }
        return false;
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
            // Decorative obstacles (e.g. building-interior floor decals) are
            // never inserted, so collision / LOS / spawn scans ignore them
            // entirely — they exist only for rendering.
            if (ob.def.decorative) continue;
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
