// House V2 — one versioned source of truth for authored structures.
//
// A blueprint owns every relationship that used to be implied separately by
// the renderer and the rectangular collision shell: rooms, walls, passages,
// spawn exclusion, furniture footprints, roof cutaway, and state deltas.  The
// first vertical slice intentionally contains one cabin only.  Legacy houses
// continue through MAP_STRUCTURES until this contract has passed its gates.

export const HOUSE_V2_STATES = Object.freeze(['intact', 'lit', 'damaged', 'ruined']);

const deepFreeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
};

const wall = (id, x, y, hw, hh, options = {}) => ({
    id, x, y, hw, hh,
    kind: options.kind || 'shell',
    edge: options.edge || null,
    renderHeight: options.renderHeight || null,
    inactiveStates: options.inactiveStates || [],
});

const room = (id, name, x, y, w, h, tags, options = {}) => ({
    id, name, x, y, w, h, tags,
    overlay: options.overlay === true,
    floorTone: options.floorTone || null,
});

const door = (id, x, y, axis, width, connects, options = {}) => ({
    id, x, y, axis, width, connects,
    kind: options.kind || 'interior',
    normal: options.normal || { x: 0, y: 0 },
    maxBodyRadius: options.maxBodyRadius || 58,
    activeStates: options.activeStates || HOUSE_V2_STATES,
});

// Original Emberwake layout.  The supplied Magnazur image was used only as a
// reminder that a dwelling needs recognizable domestic zones and circulation;
// no pixel, outline, palette, or furniture coordinate is copied from it.
export const EMBERWOOD_RUIN_BELL_CABIN = deepFreeze({
    id: 'emberwood-ruin-bell-cabin',
    version: 3,
    name: 'Last-Wick Cabin',
    biomeId: 'emberwood',
    renderStyle: 'cabin',
    // This is one dwelling, not a collection of legacy building cards. The
    // renderer consumes these stable material/profile ids while every physical
    // wall below remains the collision/LOS/navigation authority.
    architecture: {
        form: 'single-shell-dwelling',
        projection: 'top-down-cutaway',
        foundation: 'continuous-stone-ring',
        floor: 'continuous-clean-oak',
        partitions: 'low-timber-divider',
        props: 'pixel-plan',
        exteriorShellCount: 1,
    },
    dimensions: {
        interiorW: 540,
        interiorH: 432,
        wall: 32,
        wallH: 174,
        mainDoor: 156,
    },
    circulation: {
        spineX: -110,
        width: 156,
        exteriorApproachDepth: 136,
    },
    rooms: [
        room('hearth-kitchen', 'Hearth & Kitchen', -110, -98, 320, 236,
            ['hearth', 'kitchen', 'common'], { floorTone: '#5b412d' }),
        room('dining-work', 'Dining & Workroom', -110, 118, 320, 196,
            ['dining', 'work', 'entry'], { floorTone: '#654731' }),
        room('sleeping-nook', 'Sleeping Nook', 160, -113, 220, 206,
            ['sleep', 'rest'], { floorTone: '#493a35' }),
        room('storage-lean-to', 'Wick Storage', 160, 103, 220, 226,
            ['storage', 'supplies'], { floorTone: '#57432d' }),
        room('wick-hall', 'Wick Hall', -110, 0, 156, 432,
            ['circulation', 'bell'], { overlay: true, floorTone: '#705038' }),
    ],
    doors: [
        door('north-utility', -110, -232, 'horizontal', 156,
            ['outside', 'hearth-kitchen'], {
                kind: 'exterior', normal: { x: 0, y: -1 }, maxBodyRadius: 62,
            }),
        door('south-entry', -110, 232, 'horizontal', 156,
            ['outside', 'dining-work'], {
                kind: 'exterior', normal: { x: 0, y: 1 }, maxBodyRadius: 62,
            }),
        door('hearth-to-dining', -110, 20, 'horizontal', 156,
            ['hearth-kitchen', 'dining-work'], { maxBodyRadius: 62 }),
        door('hearth-to-sleep', 50, -110, 'vertical', 136,
            ['hearth-kitchen', 'sleeping-nook'], { maxBodyRadius: 56 }),
        door('dining-to-storage', 50, 100, 'vertical', 136,
            ['dining-work', 'storage-lean-to'], { maxBodyRadius: 56 }),
        door('sleep-to-storage', 130, -10, 'horizontal', 140,
            ['sleeping-nook', 'storage-lean-to'], { maxBodyRadius: 58 }),
        door('ruined-east-breach', 286, -108, 'vertical', 132,
            ['outside', 'sleeping-nook'], {
                kind: 'breach', normal: { x: 1, y: 0 }, maxBodyRadius: 52,
                activeStates: ['ruined'],
            }),
    ],
    walls: [
        // Exterior shell. Door openings are literal gaps between these pieces.
        wall('shell-north-west', -247, -232, 49, 16, { edge: 'north' }),
        wall('shell-north-east', 127, -232, 169, 16, { edge: 'north' }),
        wall('shell-south-west', -247, 232, 49, 16, { edge: 'south' }),
        wall('shell-south-east', 127, 232, 169, 16, { edge: 'south' }),
        wall('shell-west', -286, 0, 16, 216, { edge: 'west' }),
        wall('shell-east-upper', 286, -108, 16, 108, {
            edge: 'east', inactiveStates: ['ruined'],
        }),
        wall('shell-east-lower', 286, 108, 16, 108, { edge: 'east' }),

        // Low internal partitions. The same gaps are the navigation graph.
        wall('partition-wing-north', 50, -197, 10, 19, {
            kind: 'partition', renderHeight: 34,
        }),
        wall('partition-wing-middle', 50, -5, 10, 37, {
            kind: 'partition', renderHeight: 34,
        }),
        wall('partition-wing-south', 50, 192, 10, 24, {
            kind: 'partition', renderHeight: 34,
        }),
        wall('partition-west-left', -229, 20, 41, 10, {
            kind: 'partition', renderHeight: 32,
        }),
        wall('partition-west-right', 9, 20, 41, 10, {
            kind: 'partition', renderHeight: 32,
        }),
        wall('partition-east-left', 55, -10, 5, 10, {
            kind: 'partition', renderHeight: 30,
        }),
        wall('partition-east-right', 235, -10, 35, 10, {
            kind: 'partition', renderHeight: 30,
        }),
    ],
    furniture: [
        {
            id: 'ruin-bell', sprite: 'ruinBell', roomId: 'hearth-kitchen',
            x: -225, y: -150, w: 138, h: 138, baseOffsetY: 35,
            collider: { shape: 'circle', r: 30 }, blocksLOS: false,
            escape: { x: 1, y: 0 },
            tags: ['encounter-anchor', 'bell'],
        },
        {
            id: 'stone-hearth', sprite: 'cabinHearth', roomId: 'hearth-kitchen',
            x: 0, y: -194, w: 112, h: 108, baseOffsetY: 24,
            collider: { shape: 'rect', hw: 34, hh: 17 }, blocksLOS: true,
            escape: { x: -1, y: 0 },
            tags: ['hearth', 'domestic', 'light-anchor'],
        },
        {
            id: 'work-table', sprite: 'cabinTable', roomId: 'dining-work',
            x: -225, y: 175, w: 118, h: 98, baseOffsetY: 22,
            collider: { shape: 'rect', hw: 32, hh: 21 }, blocksLOS: false,
            escape: { x: 1, y: 0 },
            tags: ['dining', 'work', 'domestic'],
        },
        {
            id: 'ember-cot', sprite: 'cabinBed', roomId: 'sleeping-nook',
            x: 230, y: -38, w: 112, h: 132, baseOffsetY: 34,
            collider: { shape: 'rect', hw: 28, hh: 16 }, blocksLOS: false,
            tags: ['sleep'],
        },
        {
            id: 'pantry-shelf', sprite: 'cabinShelf', roomId: 'storage-lean-to',
            x: 235, y: 145, w: 82, h: 126, baseOffsetY: 24,
            collider: { shape: 'rect', hw: 18, hh: 8 }, blocksLOS: true,
            escape: { x: -1, y: 0 },
            tags: ['storage', 'food', 'domestic'],
        },
        {
            id: 'wick-crate', sprite: 'cabinCrate', roomId: 'storage-lean-to',
            // Keep the dense supply cluster against the southeast wall instead
            // of straddling the room's authored navigation origin. Radius-56
            // bodies can now turn from storage into either interior doorway.
            x: 225, y: 190, w: 70, h: 72, baseOffsetY: 24,
            collider: { shape: 'rect', hw: 28, hh: 22 }, blocksLOS: true,
            tags: ['storage'],
        },
        {
            id: 'oil-barrel', sprite: 'cabinBarrel', roomId: 'storage-lean-to',
            x: 95, y: 180, w: 56, h: 82, baseOffsetY: 24,
            collider: { shape: 'circle', r: 22 }, blocksLOS: true,
            tags: ['storage'],
        },
    ],
    floor: {
        materialStyle: 'cabinClean',
        shellMaterialStyle: 'cabin',
        // The clean original board field spans the one continuous foundation.
        // It intentionally contains no baked rooms, walls, rug, or furnishings.
        decal: null,
    },
    spawnExclusions: [
        { id: 'interior', x: 0, y: 0, hw: 270, hh: 216 },
        { id: 'north-approach', x: -110, y: -282, hw: 102, hh: 50 },
        { id: 'south-approach', x: -110, y: 282, hw: 102, hh: 50 },
    ],
    roofCutaway: {
        roomIds: ['hearth-kitchen', 'dining-work', 'sleeping-nook', 'storage-lean-to'],
        nearDistance: 104,
        exteriorAlpha: 0.88,
        interiorAlpha: 0.14,
    },
    states: {
        intact: {
            roof: 'complete', damageProfile: 'sound', severity: 0,
            light: 0.42, disabledWallIds: [],
        },
        lit: {
            roof: 'complete', damageProfile: 'ember-lit', severity: 0,
            light: 0.72, disabledWallIds: [],
        },
        damaged: {
            roof: 'damaged', damageProfile: 'scorched-east-eave', severity: 1,
            light: 0.34, disabledWallIds: [],
        },
        ruined: {
            roof: 'ruined', damageProfile: 'open-east-collapse', severity: 2,
            light: 0.12, disabledWallIds: ['shell-east-upper'],
        },
    },
    encounter: {
        id: 'ruin-bell-vigil',
        anchorFurnitureId: 'ruin-bell',
        activationRadius: 104,
        dwellSeconds: 1.25,
        // The small focus ring is only for ringing. Once the toll begins the
        // whole cabin and its two door approaches become the defendable space.
        defendRadius: 460,
        defendSeconds: 45,
        graceOutsideSeconds: 6,
        retryDelaySeconds: 8,
        rewardSockets: {
            // These remain in the dining/work zone but sit farther apart than
            // the two pickup radii plus a radius-50 player body. A player can
            // therefore never overlap both choices on the same update tick.
            chest: { roomId: 'dining-work', x: -8, y: 174 },
            shrine: { roomId: 'dining-work', x: -228, y: 72 },
            pickupDelaySeconds: 0.9,
            requiresExitBeforePickup: true,
        },
        reward: { xp: 32, choice: 'chest-or-wick-shrine' },
    },
});

export const HOUSE_V2_BLUEPRINTS = deepFreeze({
    [EMBERWOOD_RUIN_BELL_CABIN.id]: EMBERWOOD_RUIN_BELL_CABIN,
});

export function getHouseBlueprint(id) {
    return typeof id === 'string' ? HOUSE_V2_BLUEPRINTS[id] ?? null : null;
}

export function houseStateDefinition(blueprint, state = 'intact') {
    const safe = blueprint?.states?.[state] ? state : 'intact';
    return blueprint?.states?.[safe] ?? null;
}

export function houseWallActive(blueprint, wallDef, state = 'intact') {
    if (!wallDef) return false;
    const inactive = wallDef.inactiveStates || [];
    if (inactive.includes(state)) return false;
    return !(houseStateDefinition(blueprint, state)?.disabledWallIds || []).includes(wallDef.id);
}

export function houseDoorActive(doorDef, state = 'intact') {
    return !!doorDef && (doorDef.activeStates || HOUSE_V2_STATES).includes(state);
}

export function localRoomAt(blueprint, x, y, includeOverlays = false) {
    if (!blueprint) return null;
    const rooms = blueprint.rooms || [];
    // An explicit overlay query asks for the authored circulation layer, not
    // whichever base room happens to overlap it in array order. Normal
    // gameplay/navigation calls keep overlays excluded and still receive the
    // four mutually-exclusive physical rooms.
    const ordered = includeOverlays
        ? [...rooms.filter((entry) => entry.overlay), ...rooms.filter((entry) => !entry.overlay)]
        : rooms;
    for (const entry of ordered) {
        if (!includeOverlays && entry.overlay) continue;
        if (x >= entry.x - entry.w / 2 && x <= entry.x + entry.w / 2
            && y >= entry.y - entry.h / 2 && y <= entry.y + entry.h / 2) return entry;
    }
    return null;
}

export function worldRoomAt(structure, x, y, includeOverlays = false) {
    const blueprint = structure?.blueprint || getHouseBlueprint(structure?.blueprintId);
    if (!blueprint) return null;
    return localRoomAt(blueprint, x - structure.x, y - structure.y, includeOverlays);
}

export function worldFurniture(structure, furnitureId) {
    const blueprint = structure?.blueprint || getHouseBlueprint(structure?.blueprintId);
    const item = blueprint?.furniture?.find((entry) => entry.id === furnitureId);
    return item ? { ...item, x: structure.x + item.x, y: structure.y + item.y } : null;
}

export function houseGeometrySignature(blueprint = EMBERWOOD_RUIN_BELL_CABIN) {
    if (!blueprint) return '';
    const stateBits = HOUSE_V2_STATES.map((state) => {
        const def = houseStateDefinition(blueprint, state);
        return `${state}:${def?.roof}:${(def?.disabledWallIds || []).join(',')}`;
    }).join('|');
    return [
        blueprint.id, blueprint.version,
        blueprint.dimensions.interiorW, blueprint.dimensions.interiorH,
        blueprint.walls.map((entry) => `${entry.id}:${entry.x}:${entry.y}:${entry.hw}:${entry.hh}`).join(';'),
        blueprint.doors.map((entry) => `${entry.id}:${entry.x}:${entry.y}:${entry.width}`).join(';'),
        blueprint.rooms.map((entry) => `${entry.id}:${entry.x}:${entry.y}:${entry.w}:${entry.h}`).join(';'),
        stateBits,
    ].join('|');
}
