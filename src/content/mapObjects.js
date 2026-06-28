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
//   weight      relative placement frequency
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
};

export const MAP_OBJECT_LIST = Object.values(MAP_OBJECTS);
export const MAP_OBJECT_TYPES = Object.keys(MAP_OBJECTS);

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

// Footprint half-depth used as the y-sort baseline contribution.
export function footprintDepth(def) {
    return def.shape === 'circle' ? def.col.r : def.col.hh;
}
