// Map object (obstacle) archetypes — the data behind the world's buildings,
// walls, and props that block movement and sight.
//
// Each archetype:
//   type        stable key
//   shape       'rect' | 'circle'  → collision footprint shape
//   col         footprint half-extents at the base:
//                 rect   → { hw, hh }   (half width / half depth)
//                 circle → { r }
//   size        visual { w, h } in world px; the sprite's BASE sits at the
//               object's (x, y) and the art is drawn UPWARD by `h`
//   blocksLOS   whether the object blocks attacks / line of sight (default true)
//   weight      relative placement frequency (a fallback; per-biome sets in
//               BIOME_THEME override which props actually appear)
//   palette     colors used by the procedural draw in Obstacle.js
//
// Collision footprints are deliberately a bit smaller than the visual so the
// player's feet can tuck behind a wall without snagging on the artwork.

export const MAP_OBJECTS = {
    ruinedWall: {
        type: 'ruinedWall', shape: 'rect', col: { hw: 92, hh: 24 }, size: { w: 200, h: 132 },
        blocksLOS: true, weight: 16, palette: { base: '#3a3540', top: '#4c4654', edge: '#272430' },
    },
    stoneBlock: {
        type: 'stoneBlock', shape: 'rect', col: { hw: 46, hh: 30 }, size: { w: 100, h: 96 },
        blocksLOS: true, weight: 14, palette: { base: '#42474d', top: '#565d65', edge: '#2b2f34' },
    },
    pillar: {
        type: 'pillar', shape: 'circle', col: { r: 30 }, size: { w: 78, h: 168 },
        blocksLOS: true, weight: 12, palette: { base: '#4a4550', top: '#5d5766', edge: '#2c2933' },
    },
    brokenTower: {
        type: 'brokenTower', shape: 'circle', col: { r: 64 }, size: { w: 168, h: 252 },
        blocksLOS: true, weight: 5, palette: { base: '#3c3742', top: '#4e4856', edge: '#262229' },
    },
    graveMarker: {
        type: 'graveMarker', shape: 'rect', col: { hw: 30, hh: 16 }, size: { w: 70, h: 84 },
        blocksLOS: false, weight: 12, palette: { base: '#4b4f54', top: '#5e636a', edge: '#2f3236' },
    },
    tree: {
        type: 'tree', shape: 'circle', col: { r: 26 }, size: { w: 150, h: 188 },
        blocksLOS: true, weight: 14, palette: { base: '#3a2b22', top: '#234032', edge: '#1a2f24' },
    },
    fence: {
        type: 'fence', shape: 'rect', col: { hw: 84, hh: 12 }, size: { w: 180, h: 70 },
        blocksLOS: false, weight: 10, palette: { base: '#4a3a2c', top: '#5f4c39', edge: '#2e2419' },
    },
    barricade: {
        type: 'barricade', shape: 'rect', col: { hw: 62, hh: 22 }, size: { w: 140, h: 96 },
        blocksLOS: true, weight: 9, palette: { base: '#4a3f33', top: '#5e5141', edge: '#2d2620' },
    },
    // ── New, richer props ────────────────────────────────────────────────
    crate: {
        type: 'crate', shape: 'rect', col: { hw: 34, hh: 24 }, size: { w: 76, h: 78 },
        blocksLOS: true, weight: 10, palette: { base: '#6b4e2e', top: '#86643b', edge: '#3f2c18' },
    },
    barrel: {
        type: 'barrel', shape: 'circle', col: { r: 26 }, size: { w: 60, h: 92 },
        blocksLOS: true, weight: 9, palette: { base: '#5a4326', top: '#74552f', edge: '#33240f' },
    },
    well: {
        type: 'well', shape: 'circle', col: { r: 42 }, size: { w: 124, h: 110 },
        blocksLOS: false, weight: 5, palette: { base: '#54585e', top: '#6a6f76', edge: '#34373c' },
    },
    statue: {
        type: 'statue', shape: 'rect', col: { hw: 32, hh: 26 }, size: { w: 96, h: 198 },
        blocksLOS: true, weight: 5, palette: { base: '#5b5f66', top: '#73787f', edge: '#393c42' },
    },
    cactus: {
        type: 'cactus', shape: 'circle', col: { r: 22 }, size: { w: 96, h: 168 },
        blocksLOS: false, weight: 0, palette: { base: '#3f6b3a', top: '#5a9148', edge: '#274326' },
    },
};

export const MAP_OBJECT_LIST = Object.values(MAP_OBJECTS);
export const MAP_OBJECT_TYPES = Object.keys(MAP_OBJECTS);

// ── Buildings (enterable structures) ─────────────────────────────────────
// A building is NOT a single object — ObstacleSystem expands a blueprint into
// four wall segments (a rectangular ring) with a DOORWAY gap on one side, so
// the player walks in and out through the door. Each wall is an ordinary rect
// obstacle, so collision (slide), line-of-sight, projectile blocking, and
// painter's-order occlusion all work with no special-casing.
//   interiorW/H  open floor space inside the walls (world px)
//   wall         wall thickness (collision depth)
//   wallH        wall height drawn upward (visual)
//   door         doorway gap width — sized so the player (r=50) fits but big
//                brutes/bosses do NOT, making buildings a refuge.
export const MAP_STRUCTURES = {
    cabin: {
        type: 'cabin', interiorW: 250, interiorH: 200, wall: 28, wallH: 156, door: 140,
        palette: { base: '#6a513a', top: '#86643f', edge: '#3c2c1d' },
    },
    ruin: {
        type: 'ruin', interiorW: 300, interiorH: 230, wall: 30, wallH: 124, door: 152,
        palette: { base: '#474049', top: '#5a525f', edge: '#2b262d' },
    },
    keep: {
        type: 'keep', interiorW: 230, interiorH: 200, wall: 34, wallH: 188, door: 132,
        palette: { base: '#3f4b55', top: '#536271', edge: '#28313a' },
    },
    adobe: {
        type: 'adobe', interiorW: 262, interiorH: 206, wall: 30, wallH: 150, door: 142,
        palette: { base: '#9c7242', top: '#c0904f', edge: '#5e431f' },
    },
};

// ── Per-biome theming ────────────────────────────────────────────────────
// Each biome draws from its OWN prop set and building styles, and tints every
// object toward a biome colour, so the day glade, snowfield, sunless crypt and
// sandy expanse feel like different places in their objects too (reinforcing
// the distinct ground/darkness already applied per map).
//   props       { type: weight } — which archetypes appear and how often
//   structures  building blueprint keys eligible in this biome
//   tint         { color, amt } — palettes are lerped toward color by amt
export const BIOME_THEME = {
    emberwood: {
        tint: { color: '#ffce7a', amt: 0.12 },
        structures: ['cabin', 'ruin'],
        props: { tree: 20, fence: 12, stoneBlock: 8, crate: 9, barrel: 6, well: 6, ruinedWall: 5 },
    },
    hollowreach: {
        tint: { color: '#bcd6f2', amt: 0.32 },
        structures: ['cabin', 'keep'],
        props: { tree: 14, stoneBlock: 12, barricade: 9, crate: 8, barrel: 5, ruinedWall: 8, pillar: 6 },
    },
    crypts: {
        tint: { color: '#3b3552', amt: 0.36 },
        structures: ['ruin', 'keep'],
        props: { graveMarker: 16, pillar: 12, ruinedWall: 12, brokenTower: 6, statue: 9, stoneBlock: 6 },
    },
    dunes: {
        tint: { color: '#e3b261', amt: 0.30 },
        structures: ['adobe', 'ruin'],
        props: { cactus: 16, pillar: 11, barrel: 9, crate: 9, statue: 6, stoneBlock: 7 },
    },
};

export const DEFAULT_BIOME_THEME = 'emberwood';

// Placement tuning. The world is carved into placement cells; each cell rolls
// once for an obstacle, keeping a clear ring around the world origin (where the
// player spawns) and a minimum gap so paths never fully close.
export const OBSTACLE_PLACEMENT = {
    cellSize: 620,          // world px per placement cell
    perCellChance: 0.62,    // chance a cell hosts an obstacle
    jitter: 200,            // max random offset from cell center
    clearRadius: 520,       // keep a clear circle around the world origin
    edgeMargin: 140,        // keep obstacles off the very world edge
    seed: 0x5eed1234,       // deterministic placement seed
};

// Building placement: sparse landmark structures, placed BEFORE props (props
// then avoid them), kept further from spawn so the player never starts boxed in.
export const STRUCTURE_PLACEMENT = {
    count: 11,              // target number of buildings in the world
    attempts: 90,           // placement tries (some fail the overlap test)
    clearRadius: 820,       // keep buildings out of the spawn area
    edgeMargin: 320,        // buildings are big — keep them well inside bounds
    gap: 150,               // min clearance from any other obstacle/building
};

// Footprint half-depth used as the y-sort baseline contribution.
export function footprintDepth(def) {
    return def.shape === 'circle' ? def.col.r : def.col.hh;
}
