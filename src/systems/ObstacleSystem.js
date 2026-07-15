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
//   movementBlocked(ax, ay, bx, by, r) → true if a moving circle hits a wall
//   hasLineOfSight(ax, ay, bx, by)    → false if a sight-blocking wall is between
//   forVisible(cam, vw, vh, fn)       → fn(obstacle) for on-screen obstacles
//   drawDebug(ctx, cam, vw, vh)

import { Obstacle } from '../entities/Obstacle.js';
import {
    MAP_OBJECTS, MAP_OBJECT_LIST, OBSTACLE_PLACEMENT, footprintDepth,
    BIOME_THEME, DEFAULT_BIOME_THEME, MAP_STRUCTURES, STRUCTURE_PLACEMENT,
} from '../content/mapObjects.js';
import {
    HOUSE_V2_STATES,
    getHouseBlueprint,
    houseDoorActive,
    houseWallActive,
    worldRoomAt,
} from '../content/houseBlueprints.js';

const GRID_CELL = 320;
const MAX_OBSTACLES = 240;

// Numeric grid key: cells pack as (gx+K)*2K + (gy+K). The world spans only a
// few dozen 320px cells, so K = 4096 is far beyond any reachable index —
// numeric keys avoid the per-lookup string allocation of the old 'gx,gy'
// keys in _nearby, which runs multiple times per enemy per frame.
const KEY_OFF = 4096;
const cellKey = (gx, gy) => (gx + KEY_OFF) * (KEY_OFF * 2) + (gy + KEY_OFF);

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

// Cosmetic-only structure seed. It is derived from already-chosen placement
// data and never consumes the generation RNG, so variants cannot move collision
// walls, doorway gaps, props, or later buildings.
function structureVisualSeed(styleType, x, y, index) {
    let h = strHash(styleType || 'structure') ^ Math.imul((Math.round(x * 8) | 0), 0x45d9f3b);
    h = (h ^ Math.imul((Math.round(y * 8) | 0), 0x119de1f3)) >>> 0;
    h = (h ^ Math.imul((index + 1) | 0, 0x9e3779b1)) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d) >>> 0;
    h ^= h >>> 15;
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
        // Visual structure records never enter the collision grid. Physical
        // authority remains the ordinary wall obstacles below.
        this.structures = [];
        this.grid = new Map();     // cellKey(gx,gy) → [obstacle, ...]
        this.worldW = 0;
        this.worldH = 0;
        this.biomeId = DEFAULT_BIOME_THEME;
        // _nearby scratch: a reused result array + a monotonic query stamp
        // for dedupe, so the hot query path allocates nothing per call.
        this._scratch = [];
        this._queryGen = 0;
    }

    // biomeId selects the per-biome prop set, building styles, and colour tint
    // (BIOME_THEME). It also perturbs the seed so each biome is a distinct —
    // but individually deterministic — world layout.
    generate(worldW, worldH, biomeId = DEFAULT_BIOME_THEME) {
        this.worldW = worldW;
        this.worldH = worldH;
        this.biomeId = biomeId;
        this.obstacles = [];
        this.structures = [];
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
        this.structures.sort((a, b) => a.frontBaseY - b.frontBaseY);
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
        const featured = theme.featuredStructure ? MAP_STRUCTURES[theme.featuredStructure] : null;
        if (!styles.length && !featured) return;
        const SP = STRUCTURE_PLACEMENT;
        const halfW = this.worldW / 2, halfH = this.worldH / 2;
        const clearSq = SP.clearRadius * SP.clearRadius;
        let placed = 0;
        let featuredPlaced = !featured;
        for (let a = 0; a < SP.attempts && placed < SP.count; a++) {
            // Keep trying the one featured V2 landmark until it fits; only then
            // resume the unchanged weighted legacy style selection. It still
            // consumes one of the existing eleven structure slots.
            const style = !featuredPlaced
                ? featured
                : MAP_STRUCTURES[styles[(rng() * styles.length) | 0]];
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
            if (style === featured) featuredPlaced = true;
            placed++;
        }
    }

    _addBuilding(style, cx, cy, doorSide, palette, tint = null) {
        if (style.blueprint || style.blueprintId) {
            return this._addBlueprintBuilding(style, cx, cy, doorSide, palette, tint);
        }
        const iHW = style.interiorW / 2, iHH = style.interiorH / 2;
        const T = style.wall, H = style.wallH, half = T / 2;
        const spanHW = iHW + T;       // horizontal walls cover the corners
        const dHalf = style.door / 2;

        // Group the unchanged collision pieces under one visual identity.
        // All variety is coordinate-hashed, so it cannot advance placement RNG.
        const structureIndex = this.structures.length;
        const visualSeed = structureVisualSeed(style.type, cx, cy, structureIndex);
        const structureId = `structure-${structureIndex}`;
        this.structures.push({
            id: structureId,
            x: cx,
            y: cy,
            styleType: style.type,
            doorSide, // metadata only; collision keeps its north/south openings
            interiorW: style.interiorW,
            interiorH: style.interiorH,
            wall: T,
            wallH: H,
            door: style.door,
            palette,
            tint,
            visualSeed,
            variant: visualSeed % 3,
            mirror: ((visualSeed >>> 3) & 1) ? -1 : 1,
            wear: (visualSeed >>> 8) / 0x00ffffff,
            // Exact rear-wall collision feet line. The visual standing queue
            // inserts the rear/roof plane here and the front/sides plane below.
            rearBaseY: cy - iHH,
            // Exact current front-wall painter baseline: wall center is
            // cy+iHH+T/2 and its collision half-depth is T/2.
            frontBaseY: cy + iHH + T,
        });

        const addWall = (x, y, hw, hh) => {
            if (hw <= 4 || hh <= 2) return;
            const def = {
                type: 'buildingWall', shape: 'rect',
                col: { hw, hh }, size: { w: hw * 2, h: H },
                blocksLOS: true, palette, styleType: style.type,
            };
            const ob = new Obstacle(def, x, y);
            ob.structureId = structureId;
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
        fob.structureId = structureId;
        fob.palette = palette;
        fob.tint = tint;
        fob.baseY = cy - iHH;   // sort behind the player/walls (floor layer)
        this.obstacles.push(fob);
    }

    // Compile one authored House V2 blueprint into the same ordinary Obstacle
    // records used everywhere else. Wall records are therefore simultaneous
    // render ids, collision blockers, LOS blockers, and navigation blockers.
    _addBlueprintBuilding(style, cx, cy, doorSide, palette, tint = null) {
        const blueprint = style.blueprint || getHouseBlueprint(style.blueprintId);
        if (!blueprint) return null;
        const dims = blueprint.dimensions;
        const structureIndex = this.structures.length;
        const visualSeed = structureVisualSeed(blueprint.id, cx, cy, structureIndex);
        const structureId = `structure-${structureIndex}`;
        const state = 'intact';
        const renderStyle = blueprint.renderStyle || style.type || 'cabin';
        const structure = {
            id: structureId,
            x: cx,
            y: cy,
            styleType: renderStyle,
            blueprintId: blueprint.id,
            blueprintVersion: blueprint.version,
            blueprint,
            state,
            poiReservation: blueprint.encounter?.id || null,
            doorSide,
            interiorW: dims.interiorW,
            interiorH: dims.interiorH,
            wall: dims.wall,
            wallH: dims.wallH,
            door: dims.mainDoor,
            palette,
            tint,
            visualSeed,
            variant: visualSeed % 3,
            mirror: ((visualSeed >>> 3) & 1) ? -1 : 1,
            wear: (visualSeed >>> 8) / 0x00ffffff,
            rearBaseY: cy - dims.interiorH / 2,
            frontBaseY: cy + dims.interiorH / 2 + dims.wall,
            wallParts: blueprint.walls,
            doors: blueprint.doors,
            rooms: blueprint.rooms,
            spawnExclusions: blueprint.spawnExclusions,
            roofCutaway: blueprint.roofCutaway,
        };
        this.structures.push(structure);

        for (const part of blueprint.walls) {
            const H = part.renderHeight || dims.wallH;
            const def = {
                type: 'buildingWall', shape: 'rect',
                col: { hw: part.hw, hh: part.hh },
                size: { w: part.hw * 2, h: H },
                blocksLOS: true,
                palette,
                styleType: renderStyle,
                blueprintId: blueprint.id,
            };
            const ob = new Obstacle(def, cx + part.x, cy + part.y);
            ob.structureId = structureId;
            ob.wallId = part.id;
            ob.wallKind = part.kind;
            ob.wallEdge = part.edge;
            ob.partition = part.kind === 'partition';
            ob.active = houseWallActive(blueprint, part, state);
            ob.palette = palette;
            ob.tint = tint;
            this.obstacles.push(ob);
        }

        // Furniture footprints come from the same blueprint and take part in
        // collision/LOS/spawn checks. Their actual raster art is selected by
        // Obstacle.draw; the fallback remains a material block if loading fails.
        for (const item of blueprint.furniture || []) {
            const col = item.collider?.shape === 'circle'
                ? { r: item.collider.r }
                : { hw: item.collider?.hw || 1, hh: item.collider?.hh || 1 };
            const def = {
                type: 'buildingFurnishing',
                shape: item.collider?.shape === 'circle' ? 'circle' : 'rect',
                col,
                size: { w: item.w, h: item.h },
                blocksLOS: item.blocksLOS === true,
                palette,
                styleType: renderStyle,
                blueprintId: blueprint.id,
                sprite: item.sprite,
            };
            const ob = new Obstacle(def, cx + item.x, cy + item.y);
            ob.structureId = structureId;
            ob.furnitureId = item.id;
            ob.roomId = item.roomId;
            ob.escapeX = item.escape?.x || 0;
            ob.escapeY = item.escape?.y || 0;
            ob.palette = palette;
            ob.tint = tint;
            ob.baseY = cy + item.y + (item.baseOffsetY || footprintDepth(def));
            this.obstacles.push(ob);
        }

        const floor = {
            type: 'buildingFloor', shape: 'rect', decorative: true,
            col: { hw: dims.interiorW / 2, hh: dims.interiorH / 2 },
            size: { w: dims.interiorW, h: dims.interiorH },
            blocksLOS: false,
            palette,
            styleType: renderStyle,
            blueprintId: blueprint.id,
        };
        const fob = new Obstacle(floor, cx, cy);
        fob.structureId = structureId;
        fob.palette = palette;
        fob.tint = tint;
        fob.baseY = structure.rearBaseY;
        this.obstacles.push(fob);
        return structure;
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
            if (ob.def.decorative || ob.active === false) continue;
            const b = ob.bounds();
            const gx0 = Math.floor(b.minX / GRID_CELL), gx1 = Math.floor(b.maxX / GRID_CELL);
            const gy0 = Math.floor(b.minY / GRID_CELL), gy1 = Math.floor(b.maxY / GRID_CELL);
            for (let gy = gy0; gy <= gy1; gy++) {
                for (let gx = gx0; gx <= gx1; gx++) {
                    const key = cellKey(gx, gy);
                    let bucket = this.grid.get(key);
                    if (!bucket) { bucket = []; this.grid.set(key, bucket); }
                    bucket.push(ob);
                }
            }
        }
    }

    // Gather unique obstacles whose footprint may overlap the bbox [minX..maxX].
    // GC-clean hot path (hit multiple times per enemy per frame): returns a
    // REUSED scratch array — valid only until the next _nearby call, which every
    // caller respects by consuming it immediately. Dedupe across cells is a
    // per-obstacle generation stamp instead of a fresh Set, so a query performs
    // zero allocations.
    _nearby(minX, minY, maxX, maxY) {
        const gx0 = Math.floor(minX / GRID_CELL), gx1 = Math.floor(maxX / GRID_CELL);
        const gy0 = Math.floor(minY / GRID_CELL), gy1 = Math.floor(maxY / GRID_CELL);
        const gen = ++this._queryGen;
        const out = this._scratch;
        out.length = 0;
        for (let gy = gy0; gy <= gy1; gy++) {
            for (let gx = gx0; gx <= gx1; gx++) {
                const bucket = this.grid.get(cellKey(gx, gy));
                if (!bucket) continue;
                for (const ob of bucket) {
                    if (ob._queryGen === gen) continue;
                    ob._queryGen = gen;
                    out.push(ob);
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
            if (d < 1e-4) {
                dx = ob.escapeX || 0;
                dy = ob.escapeY || -1;
                d = Math.hypot(dx, dy) || 1;
            }
            return { nx: dx / d, ny: dy / d, depth: R - d };
        }
        // rect (AABB) vs circle
        const hw = ob.def.col.hw, hh = ob.def.col.hh;
        const minX = ob.x - hw, maxX = ob.x + hw;
        const minY = ob.y - hh, maxY = ob.y + hh;

        // Handle a center inside the rectangle BEFORE the closest-point test.
        // In the old ordering d2 was zero, so the intended inside branch was
        // unreachable and the circle was pushed north by only its radius. A
        // body embedded in a long side wall could remain overlapping for
        // several frames (and be pushed toward a building corner/interior).
        if (cx > minX && cx < maxX && cy > minY && cy < maxY) {
            const left = cx - minX, right = maxX - cx;
            const top = cy - minY, bottom = maxY - cy;
            // Authored shell walls know their exterior normal. An exact-center
            // displacement should leave the building, never push a body into
            // furniture just inside the room because of an arbitrary tie.
            if (ob.wallEdge === 'west') return { nx: -1, ny: 0, depth: left + cr };
            if (ob.wallEdge === 'east') return { nx: 1, ny: 0, depth: right + cr };
            if (ob.wallEdge === 'north') return { nx: 0, ny: -1, depth: top + cr };
            if (ob.wallEdge === 'south') return { nx: 0, ny: 1, depth: bottom + cr };
            const m = Math.min(left, right, top, bottom);
            if (m === left) return { nx: -1, ny: 0, depth: left + cr };
            if (m === right) return { nx: 1, ny: 0, depth: right + cr };
            if (m === top) return { nx: 0, ny: -1, depth: top + cr };
            return { nx: 0, ny: 1, depth: bottom + cr };
        }

        const qx = Math.max(minX, Math.min(cx, maxX));
        const qy = Math.max(minY, Math.min(cy, maxY));
        let dx = cx - qx, dy = cy - qy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= cr * cr) return null;
        const d = Math.sqrt(d2);
        if (d < 1e-4) {
            // Center exactly on an edge/corner. Push away from the rectangle,
            // never in a hard-coded world direction.
            let ex = cx <= minX ? -1 : (cx >= maxX ? 1 : 0);
            let ey = cy <= minY ? -1 : (cy >= maxY ? 1 : 0);
            const el = Math.hypot(ex, ey) || 1;
            return { nx: ex / el, ny: ey / el, depth: cr };
        }
        return { nx: dx / d, ny: dy / d, depth: cr - d };
    }

    // Push a moving circle out of every wall it overlaps. Because we only
    // cancel the penetration-normal component, motion parallel to the wall is
    // preserved → the entity slides instead of sticking.
    resolveCircle(x, y, r) {
        if (this.obstacles.length === 0) return { x, y };
        let cx = x, cy = y;
        // Twelve remains constant-time and only overlapping bodies reach the
        // later passes. House V2 partitions add rare three-surface pockets
        // where a displaced body can need several diminishing corner passes.
        for (let pass = 0; pass < 12; pass++) {
            const near = this._nearby(cx - r, cy - r, cx + r, cy + r);
            if (near.length === 0) break;
            let moved = false;
            for (const ob of near) {
                const pen = this._penetration(cx, cy, r, ob);
                if (pen) {
                    // A hundredth-pixel separation prevents two adjacent AABBs
                    // from trading an asymptotically shrinking penetration.
                    const push = pen.depth + 0.05;
                    cx += pen.nx * push;
                    cy += pen.ny * push;
                    moved = true;
                }
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

    // Spawn authority is intentionally stricter than movement authority: an
    // enterable room is walkable, but ambient enemies/pickups must not pop into
    // it or either doorway approach. Authored encounter sockets are outside
    // these rectangles and still pass through this same query.
    isSpawnBlocked(x, y, clearance = 0) {
        if (this.isBlocked(x, y, clearance)) return true;
        const r = Math.max(0, Number.isFinite(clearance) ? clearance : 0);
        for (const structure of this.structures) {
            if (!structure.blueprint) continue;
            for (const zone of structure.spawnExclusions || []) {
                const lx = x - structure.x - zone.x;
                const ly = y - structure.y - zone.y;
                if (Math.abs(lx) <= zone.hw + r && Math.abs(ly) <= zone.hh + r) return true;
            }
        }
        return false;
    }

    getStructureByBlueprint(blueprintId) {
        return this.structures.find((entry) => entry.blueprintId === blueprintId) || null;
    }

    findStructureAt(x, y, includeShell = false) {
        for (const structure of this.structures) {
            if (!structure.blueprint) continue;
            const room = worldRoomAt(structure, x, y);
            if (room) return { structure, room };
            if (includeShell) {
                const hw = structure.interiorW / 2 + structure.wall;
                const hh = structure.interiorH / 2 + structure.wall;
                if (Math.abs(x - structure.x) <= hw && Math.abs(y - structure.y) <= hh) {
                    return { structure, room: null };
                }
            }
        }
        return null;
    }

    getRoomAt(x, y, includeOverlays = false) {
        for (const structure of this.structures) {
            const room = worldRoomAt(structure, x, y, includeOverlays);
            if (room) return { structure, room };
        }
        return null;
    }

    setStructureState(structureId, nextState) {
        if (!HOUSE_V2_STATES.includes(nextState)) return false;
        const structure = this.structures.find((entry) => entry.id === structureId);
        if (!structure?.blueprint || structure.state === nextState) return !!structure;
        structure.state = nextState;
        structure._routeCache?.clear?.();
        for (const ob of this.obstacles) {
            if (ob.structureId !== structureId || !ob.wallId) continue;
            const part = structure.blueprint.walls.find((entry) => entry.id === ob.wallId);
            ob.active = houseWallActive(structure.blueprint, part, nextState);
        }
        // Physical state mutation is rare (activation/fail/clear), so rebuilding
        // once is safer and cheaper than teaching every query about stale cells.
        this._buildGrid();
        return true;
    }

    _routeDoor(structure, sourceRoom, targetRoom, radius, role) {
        if (!structure?.blueprint || !sourceRoom || !targetRoom || sourceRoom === targetRoom) return null;
        if (!structure._routeCache) structure._routeCache = new Map();
        const bucket = Math.max(1, Math.ceil(radius / 4));
        const key = `${structure.state}|${sourceRoom}|${targetRoom}|${bucket}|${role}`;
        if (structure._routeCache.has(key)) return structure._routeCache.get(key);

        let doors = structure.blueprint.doors.filter((entry) =>
            houseDoorActive(entry, structure.state) && radius <= entry.maxBodyRadius);
        if (role === 'flanker') doors = doors.slice().reverse();
        const queue = [{ room: sourceRoom, firstDoor: null }];
        const seen = new Set([sourceRoom]);
        let chosen = null;
        for (let qi = 0; qi < queue.length && !chosen; qi++) {
            const node = queue[qi];
            for (const entry of doors) {
                if (!entry.connects.includes(node.room)) continue;
                const next = entry.connects[0] === node.room ? entry.connects[1] : entry.connects[0];
                if (seen.has(next)) continue;
                const firstDoor = node.firstDoor || entry;
                if (next === targetRoom) { chosen = firstDoor; break; }
                seen.add(next);
                queue.push({ room: next, firstDoor });
            }
        }
        structure._routeCache.set(key, chosen);
        return chosen;
    }

    _routeDoorTowardOutside(structure, sourceRoom, targetX, targetY, radius, role) {
        const exits = structure.blueprint.doors
            .filter((entry) => (entry.kind === 'exterior' || entry.kind === 'breach')
                && houseDoorActive(entry, structure.state)
                && radius <= entry.maxBodyRadius)
            .sort((a, b) => {
                const adx = structure.x + a.x - targetX;
                const ady = structure.y + a.y - targetY;
                const bdx = structure.x + b.x - targetX;
                const bdy = structure.y + b.y - targetY;
                return adx * adx + ady * ady - (bdx * bdx + bdy * bdy);
            });
        for (const exit of exits) {
            const exitRoom = exit.connects.find((id) => id !== 'outside');
            if (!exitRoom) continue;
            if (sourceRoom === exitRoom) return exit;
            const firstDoor = this._routeDoor(structure, sourceRoom, exitRoom, radius, role);
            if (firstDoor) return firstDoor;
        }
        return null;
    }

    // Writes a blueprint-aware intermediate target directly onto the enemy to
    // avoid allocating a waypoint object in the 180-body hot path. Returns true
    // only when a House V2 portal/pressure target should replace direct pursuit.
    applyHouseNavigationGoal(enemy, targetX, targetY, role = 'frontline') {
        if (!enemy || !Number.isFinite(targetX) || !Number.isFinite(targetY)) return false;
        const radius = Math.max(1, enemy.radius || 1);
        const targetHit = this.findStructureAt(targetX, targetY);
        const sourceHit = this.findStructureAt(enemy.x, enemy.y, true);
        if (enemy._housePortalDirection === 'interior'
            && Number.isFinite(enemy._housePortalGoalX)
            && Number.isFinite(enemy._housePortalGoalY)) {
            if (Math.hypot(
                enemy.x - enemy._housePortalGoalX,
                enemy.y - enemy._housePortalGoalY,
            ) > 8) {
                enemy._houseNavX = enemy._housePortalGoalX;
                enemy._houseNavY = enemy._housePortalGoalY;
                enemy._houseNavReason = `house-door:${enemy._housePortalDoorId}`;
                return true;
            }
            enemy._housePortalDirection = null;
            enemy._housePortalStructureId = null;
            enemy._housePortalDoorId = null;
            enemy._housePortalGoalX = null;
            enemy._housePortalGoalY = null;
        }
        if (enemy._housePortalDirection === 'exit') {
            const exitStructure = this.structures.find((entry) => entry.id === enemy._housePortalStructureId);
            const exitDoor = exitStructure?.blueprint?.doors?.find(
                (entry) => entry.id === enemy._housePortalDoorId
                    && houseDoorActive(entry, exitStructure.state),
            );
            if (exitStructure && exitDoor) {
                const outside = radius + exitStructure.wall + 24;
                const gx = exitStructure.x + exitDoor.x + exitDoor.normal.x * outside;
                const gy = exitStructure.y + exitDoor.y + exitDoor.normal.y * outside;
                if (Math.hypot(enemy.x - gx, enemy.y - gy) > 8) {
                    enemy._houseNavX = gx;
                    enemy._houseNavY = gy;
                    enemy._houseNavReason = `house-exit:${exitDoor.id}`;
                    return true;
                }
            }
            enemy._housePortalDirection = null;
            enemy._housePortalStructureId = null;
            enemy._housePortalDoorId = null;
            enemy._housePortalGoalX = null;
            enemy._housePortalGoalY = null;
        }
        // If the player/target is outside, an enemy already inside still needs
        // the House V2 portal graph to escape. If source and target are in
        // different houses, first route out of the source structure.
        const structure = sourceHit?.structure || targetHit?.structure;
        if (!structure) return false;
        const targetRoom = targetHit?.structure === structure
            ? targetHit.room?.id || 'outside' : 'outside';
        const sourceRoom = sourceHit?.structure === structure
            ? sourceHit.room?.id || (targetRoom === 'outside' ? 'shell' : 'outside')
            : 'outside';
        if (sourceRoom === targetRoom) return false;
        if (sourceRoom === 'shell' && targetRoom === 'outside') {
            // Room membership ends at the inner wall edge, earlier than a
            // circle has cleared the shell. Preserve the committed exit target
            // across that doorway band or direct pursuit can reverse the mover
            // back into the room every other frame.
            const exterior = structure.blueprint.doors.filter((entry) =>
                (entry.kind === 'exterior' || entry.kind === 'breach')
                && houseDoorActive(entry, structure.state)
                && radius <= entry.maxBodyRadius);
            if (!exterior.length) return false;
            let selected = exterior[0];
            let best = Infinity;
            for (const entry of exterior) {
                const dx = structure.x + entry.x - enemy.x;
                const dy = structure.y + entry.y - enemy.y;
                const score = dx * dx + dy * dy;
                if (score < best) { best = score; selected = entry; }
            }
            const outside = radius + structure.wall + 24;
            enemy._houseNavX = structure.x + selected.x + selected.normal.x * outside;
            enemy._houseNavY = structure.y + selected.y + selected.normal.y * outside;
            enemy._houseNavReason = `house-exit:${selected.id}`;
            return true;
        }
        const authoredInteriorSocket = Number.isFinite(enemy.ruinBellCombatSocket?.x)
            && Number.isFinite(enemy.ruinBellCombatSocket?.y);
        const holdsOutside = sourceRoom === 'outside'
            && (role === 'ranged' || role === 'support')
            && !authoredInteriorSocket;
        const doorDef = holdsOutside
            ? null
            : targetRoom === 'outside' && sourceRoom !== 'outside' && sourceRoom !== 'shell'
                ? this._routeDoorTowardOutside(
                    structure, sourceRoom, targetX, targetY, radius, role,
                )
                : this._routeDoor(structure, sourceRoom, targetRoom, radius, role);

        if (!doorDef) {
            // Bodies too large for a portal (or ranged/support bodies deliberately
            // holding outside) pressure a deterministic exterior socket instead
            // of grinding against a jamb forever.
            const exterior = structure.blueprint.doors.filter((entry) =>
                entry.kind === 'exterior' && houseDoorActive(entry, structure.state));
            if (!exterior.length) return false;
            let selected = exterior[0];
            let best = Infinity;
            for (const entry of exterior) {
                const dx = structure.x + entry.x - enemy.x;
                const dy = structure.y + entry.y - enemy.y;
                const score = dx * dx + dy * dy;
                if (score < best) { best = score; selected = entry; }
            }
            const hold = role === 'ranged' || role === 'support' ? 230 : radius + 96;
            enemy._houseNavX = structure.x + selected.x + selected.normal.x * hold;
            enemy._houseNavY = structure.y + selected.y + selected.normal.y * hold;
            enemy._houseNavReason = role === 'ranged' || role === 'support'
                ? 'house-firing-socket' : 'house-perimeter-pressure';
            return true;
        }

        let wx = structure.x + doorDef.x;
        let wy = structure.y + doorDef.y;
        if (sourceRoom === 'outside' && (doorDef.kind === 'exterior' || doorDef.kind === 'breach')) {
            const outside = radius + structure.wall + 24;
            const ox = wx + doorDef.normal.x * outside;
            const oy = wy + doorDef.normal.y * outside;
            const portalToken = `${structure.id}:${doorDef.id}`;
            if (enemy._housePortalToken !== portalToken) {
                enemy._housePortalToken = portalToken;
                enemy._housePortalCommitted = false;
                enemy._housePortalDirection = 'entry';
            }
            if (!enemy._housePortalCommitted
                && Math.hypot(enemy.x - ox, enemy.y - oy) <= radius + 38) {
                enemy._housePortalCommitted = true;
            }
            const committed = enemy._housePortalCommitted === true;
            wx = committed ? wx - doorDef.normal.x * (radius + 18) : ox;
            wy = committed ? wy - doorDef.normal.y * (radius + 18) : oy;
        } else if (sourceRoom !== 'outside' && doorDef.connects.includes('outside')) {
            // Exiting uses the same two-step portal commitment as entry. Aim at
            // a safe interior socket first, then one full body beyond the wall;
            // this prevents large bodies from oscillating on the room edge.
            const inside = radius + 18;
            const outside = radius + structure.wall + 24;
            const ix = wx - doorDef.normal.x * inside;
            const iy = wy - doorDef.normal.y * inside;
            const ox = wx + doorDef.normal.x * outside;
            const oy = wy + doorDef.normal.y * outside;
            const portalToken = `${structure.id}:${doorDef.id}:exit`;
            if (enemy._housePortalToken !== portalToken) {
                enemy._housePortalToken = portalToken;
                enemy._housePortalCommitted = false;
            }
            enemy._housePortalDirection = 'exit';
            enemy._housePortalStructureId = structure.id;
            enemy._housePortalDoorId = doorDef.id;
            enemy._housePortalGoalX = ox;
            enemy._housePortalGoalY = oy;
            if (!enemy._housePortalCommitted
                && Math.hypot(enemy.x - ix, enemy.y - iy) <= radius + 38) {
                enemy._housePortalCommitted = true;
            }
            const committed = enemy._housePortalCommitted === true;
            wx = committed ? ox : ix;
            wy = committed ? oy : iy;
        } else if (sourceRoom !== 'outside') {
            // Interior door centers are decision points, not destinations. Aim
            // one body-length into the next room so a mover cannot alternate on
            // the exact room-boundary pixel and grind against an otherwise-wide
            // opening. The direction comes from authored room centers, keeping
            // the portal graph and physical floor plan in one source of truth.
            const nextRoomId = doorDef.connects.find((id) => id !== sourceRoom);
            const sourceDef = structure.blueprint.rooms.find((entry) => entry.id === sourceRoom);
            const nextDef = structure.blueprint.rooms.find((entry) => entry.id === nextRoomId);
            if (sourceDef && nextDef) {
                let tx = nextDef.x - sourceDef.x;
                let ty = nextDef.y - sourceDef.y;
                if (doorDef.axis === 'horizontal') tx = 0;
                else ty = 0;
                const length = Math.hypot(tx, ty) || 1;
                wx += tx / length * (radius + 18);
                wy += ty / length * (radius + 18);
                enemy._housePortalDirection = 'interior';
                enemy._housePortalStructureId = structure.id;
                enemy._housePortalDoorId = doorDef.id;
                enemy._housePortalGoalX = wx;
                enemy._housePortalGoalY = wy;
            }
        }
        enemy._houseNavX = wx;
        enemy._houseNavY = wy;
        enemy._houseNavReason = `house-door:${doorDef.id}`;
        return true;
    }

    // Swept-circle query used by local enemy navigation. Rectangles are
    // expanded by the mover's clearance (Minkowski sum) and circles grow by it,
    // then a single segment query catches thin walls that an endpoint-only
    // probe can skip. The broadphase and scratch storage are the same GC-clean
    // grid used by collision resolution.
    movementBlocked(ax, ay, bx, by, clearance = 0) {
        const dx = bx - ax, dy = by - ay;
        const len = Math.hypot(dx, dy);
        const r = Math.max(0, clearance);
        if (len < 1e-6) return this.isBlocked(ax, ay, r);

        // Start a couple pixels along the proposed move. A resolved body may be
        // exactly tangent to a wall; excluding that t=0 contact lets an outward
        // or wall-parallel heading count as clear while an inward one still
        // intersects immediately.
        const inset = Math.min(2, len * 0.1);
        const sx = ax + dx / len * inset;
        const sy = ay + dy / len * inset;
        const near = this._nearby(
            Math.min(sx, bx) - r, Math.min(sy, by) - r,
            Math.max(sx, bx) + r, Math.max(sy, by) + r,
        );
        for (const ob of near) {
            if (ob.shape === 'circle') {
                if (this._segmentHitsCircle(sx, sy, bx, by, ob.x, ob.y, ob.def.col.r + r)) return true;
            } else if (this._segmentHitsRect(
                sx, sy, bx, by, ob.x, ob.y,
                ob.def.col.hw + r, ob.def.col.hh + r,
            )) return true;
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
            if (ob.active === false) continue;
            if (predicate && !predicate(ob)) continue;
            const w = ob.def.size.w, h = ob.def.size.h;
            if (ob.x + w < left || ob.x - w > right) continue;
            if (ob.y < top || ob.y - h > bottom) continue;
            fn(ob);
        }
    }

    // Cohesive building art rises above the collision shell and its path extends
    // below it, so it gets an explicit asymmetric visual cull. This collection
    // is visual-only and already sorted by front painter baseline.
    forVisibleStructures(cam, vw, vh, fn) {
        if (!this.structures || !this.structures.length) return;
        const left = cam.x - vw / 2 - 120, right = cam.x + vw / 2 + 120;
        const top = cam.y - vh / 2 - 180, bottom = cam.y + vh / 2 + 180;
        for (const structure of this.structures) {
            const outHW = structure.interiorW / 2 + structure.wall + 100;
            const outHH = structure.interiorH / 2 + structure.wall;
            const artTop = structure.y - outHH - structure.wallH - 140;
            const artBottom = structure.y + outHH + 150;
            if (structure.x + outHW < left || structure.x - outHW > right) continue;
            if (artBottom < top || artTop > bottom) continue;
            fn(structure);
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
