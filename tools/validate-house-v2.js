#!/usr/bin/env node
// House V2 vertical-slice contract gate.
//
// This validator intentionally consumes only public content/runtime behavior.
// It does not patch globals, require a DOM, or duplicate ObstacleSystem's
// collision implementation. A failure therefore identifies a production
// contract that the featured Emberwood cabin does not currently satisfy.

import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import {
    EMBERWOOD_RUIN_BELL_CABIN,
    HOUSE_V2_STATES,
    getHouseBlueprint,
    houseDoorActive,
    houseGeometrySignature,
    houseStateDefinition,
    houseWallActive,
    localRoomAt,
    worldFurniture,
    worldRoomAt,
} from '../src/content/houseBlueprints.js';
import {
    BIOME_THEME,
    MAP_STRUCTURES,
    STRUCTURE_PLACEMENT,
} from '../src/content/mapObjects.js';
import { CHEST, PLAYER, WICK_ROADS } from '../src/config/GameConfig.js';
import { enemyNavigationRole, steerEnemyMovement } from '../src/systems/EnemyNavigation.js';
import { ObstacleSystem } from '../src/systems/ObstacleSystem.js';
import { structureRenderer } from '../src/render/StructureRenderer.js';

const WORLD_W = 7200;
const WORLD_H = 4050;
const BIOME = 'emberwood';
const CABIN = EMBERWOOD_RUIN_BELL_CABIN;
const EXPECTED_ROOMS = [
    'hearth-kitchen',
    'dining-work',
    'sleeping-nook',
    'storage-lean-to',
    'wick-hall',
];

let checks = 0;
const failures = [];
const sectionStats = [];

function check(condition, message) {
    checks++;
    if (!condition) failures.push(message);
    return !!condition;
}

function close(actual, expected, epsilon, message) {
    return check(
        Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon,
        `${message}: expected ${expected}, got ${actual}`,
    );
}

function runSection(name, fn) {
    const beforeChecks = checks;
    const beforeFailures = failures.length;
    const started = performance.now();
    let result = null;
    try {
        result = fn() || null;
    } catch (error) {
        failures.push(`${name}: unexpected exception: ${error?.stack || error}`);
    }
    sectionStats.push({
        name,
        checks: checks - beforeChecks,
        failures: failures.length - beforeFailures,
        ms: performance.now() - started,
    });
    return result;
}

function makeFixture() {
    const obstacles = new ObstacleSystem();
    obstacles.generate(WORLD_W, WORLD_H, BIOME);
    const structure = obstacles.getStructureByBlueprint(CABIN.id);
    if (!structure) throw new Error(`featured blueprint ${CABIN.id} was not placed`);
    return { obstacles, structure };
}

function sorted(values) {
    return [...values].sort((a, b) => String(a).localeCompare(String(b)));
}

function finiteObject(entry, keys, label) {
    for (const key of keys) {
        check(Number.isFinite(entry?.[key]), `${label}.${key} must be finite`);
    }
}

function pngDimensions(relativeUrl) {
    const bytes = readFileSync(new URL(relativeUrl, import.meta.url));
    check(bytes.length > 32, `${relativeUrl} must contain PNG data`);
    check(bytes.subarray(1, 4).toString('ascii') === 'PNG', `${relativeUrl} must be a PNG`);
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes };
}

function partitionTraceContext() {
    const calls = [];
    return {
        calls,
        save() { calls.push('save'); },
        restore() { calls.push('restore'); },
        translate(x, y) { calls.push(`translate:${x}:${y}`); },
        rotate(value) { calls.push(`rotate:${value}`); },
        fillRect(x, y, w, h) { calls.push(`fill:${x}:${y}:${w}:${h}`); },
        strokeRect(x, y, w, h) { calls.push(`stroke:${x}:${y}:${w}:${h}`); },
    };
}

function activeOwnedObstacles(obstacles, structure) {
    return obstacles.obstacles.filter((entry) =>
        entry.structureId === structure.id
        && !entry.def.decorative
        && entry.active !== false);
}

function physicsSignature(obstacles, structure) {
    return activeOwnedObstacles(obstacles, structure)
        .map((entry) => {
            const col = entry.def.col;
            const footprint = entry.shape === 'circle'
                ? `r:${col.r}`
                : `hw:${col.hw}:hh:${col.hh}`;
            return [
                entry.wallId ? `wall:${entry.wallId}` : `furniture:${entry.furnitureId}`,
                entry.shape,
                entry.x.toFixed(6),
                entry.y.toFixed(6),
                footprint,
                entry.blocksLOS ? 1 : 0,
            ].join(':');
        })
        .sort()
        .join('|');
}

function gridContains(obstacles, target) {
    for (const bucket of obstacles.grid.values()) {
        if (bucket.includes(target)) return true;
    }
    return false;
}

function gridReferenceCount(obstacles) {
    let total = 0;
    for (const bucket of obstacles.grid.values()) total += bucket.length;
    return total;
}

function placementSignature(obstacles) {
    const structures = obstacles.structures.map((entry) => [
        entry.id,
        entry.blueprintId || '',
        entry.styleType,
        entry.x.toFixed(6),
        entry.y.toFixed(6),
        entry.doorSide,
        entry.visualSeed,
        entry.state || '',
    ].join(':'));
    const physical = obstacles.obstacles.map((entry) => [
        entry.structureId || '',
        entry.wallId || entry.furnitureId || '',
        entry.type,
        entry.x.toFixed(6),
        entry.y.toFixed(6),
        entry.shape,
        entry.def.col.hw ?? '',
        entry.def.col.hh ?? '',
        entry.def.col.r ?? '',
        entry.active === false ? 0 : 1,
    ].join(':'));
    return `${structures.join('|')}#${physical.join('|')}`;
}

function roomById(id) {
    return CABIN.rooms.find((entry) => entry.id === id) || null;
}

function worldPoint(structure, localX, localY) {
    return { x: structure.x + localX, y: structure.y + localY };
}

function findClearPointInRoom(obstacles, structure, roomId, radius, preferred = null) {
    const room = roomById(roomId);
    if (!room) return null;
    const candidates = [];
    const inset = Math.max(2, radius + 2);
    const minX = room.x - room.w / 2 + inset;
    const maxX = room.x + room.w / 2 - inset;
    const minY = room.y - room.h / 2 + inset;
    const maxY = room.y + room.h / 2 - inset;
    if (minX > maxX || minY > maxY) return null;
    for (let y = minY; y <= maxY + 1e-6; y += 10) {
        for (let x = minX; x <= maxX + 1e-6; x += 10) {
            const point = worldPoint(structure, x, y);
            if (obstacles.isBlocked(point.x, point.y, radius - 0.001)) continue;
            const score = preferred
                ? (x - preferred.x) ** 2 + (y - preferred.y) ** 2
                : (x - room.x) ** 2 + (y - room.y) ** 2;
            candidates.push({ ...point, localX: x, localY: y, score });
        }
    }
    candidates.sort((a, b) => a.score - b.score || a.localY - b.localY || a.localX - b.localX);
    return candidates[0] || null;
}

function findSpawnExcludedWalkablePoint(obstacles, structure) {
    for (let y = -CABIN.dimensions.interiorH / 2 + 12;
        y <= CABIN.dimensions.interiorH / 2 - 12; y += 18) {
        for (let x = -CABIN.dimensions.interiorW / 2 + 12;
            x <= CABIN.dimensions.interiorW / 2 - 12; x += 18) {
            const point = worldPoint(structure, x, y);
            if (!obstacles.isBlocked(point.x, point.y, 1)
                && obstacles.isSpawnBlocked(point.x, point.y, 1)) return point;
        }
    }
    return null;
}

function doorSweep(obstacles, structure, doorDef, radius) {
    // Probe only far enough to place the test hull fully on either side of the
    // authored wall. This avoids blaming a portal for unrelated furniture deep
    // in a room while still proving that its complete declared hull can cross.
    const alignedParts = CABIN.walls.filter((part) => doorDef.axis === 'horizontal'
        ? Math.abs(part.y - doorDef.y) < 1e-9
        : Math.abs(part.x - doorDef.x) < 1e-9);
    const wallHalfThickness = Math.max(
        1,
        ...alignedParts.map((part) => doorDef.axis === 'horizontal' ? part.hh : part.hw),
    );
    const distance = radius + wallHalfThickness + 2;
    const cx = structure.x + doorDef.x;
    const cy = structure.y + doorDef.y;
    if (doorDef.axis === 'horizontal') {
        return obstacles.movementBlocked(cx, cy - distance, cx, cy + distance, radius);
    }
    return obstacles.movementBlocked(cx - distance, cy, cx + distance, cy, radius);
}

function directHeading(mover, target) {
    const dx = target.x - mover.x;
    const dy = target.y - mover.y;
    const length = Math.hypot(dx, dy);
    return length > 1e-9 ? { x: dx / length, y: dy / length } : { x: 0, y: 0 };
}

function makeMover(x, y, radius, speed, options = {}) {
    return {
        x,
        y,
        radius,
        speed,
        type: options.type || 'test-body',
        behavior: options.behavior || null,
        boss: options.boss === true,
        _navSide: options.side === -1 ? -1 : 1,
        _navHold: 0,
        _navMoveX: 0,
        _navMoveY: 0,
    };
}

function stepMover(obstacles, mover, target, dt = 1 / 60) {
    const direct = directHeading(mover, target);
    const changed = steerEnemyMovement(
        mover,
        direct.x,
        direct.y,
        mover.speed,
        obstacles,
        dt,
        target.x,
        target.y,
    );
    const heading = changed
        ? { x: mover._navMoveX, y: mover._navMoveY }
        : direct;
    const oldX = mover.x;
    const oldY = mover.y;
    const proposedX = mover.x + heading.x * mover.speed * dt;
    const proposedY = mover.y + heading.y * mover.speed * dt;
    const resolved = obstacles.resolveCircle(proposedX, proposedY, mover.radius);
    mover.x = resolved.x;
    mover.y = resolved.y;
    return Math.hypot(mover.x - oldX, mover.y - oldY);
}

function validateSchemaAndGeometry() {
    check(JSON.stringify(HOUSE_V2_STATES) === JSON.stringify(['intact', 'lit', 'damaged', 'ruined']),
        'House V2 state order must be intact, lit, damaged, ruined');
    check(getHouseBlueprint(CABIN.id) === CABIN, 'blueprint registry must return the canonical cabin object');
    check(CABIN.version === 3, `blueprint version must be 3, got ${CABIN.version}`);
    check(CABIN.biomeId === BIOME, `blueprint biome must be ${BIOME}`);
    check(Object.isFrozen(CABIN), 'blueprint root must be frozen');
    check(Object.isFrozen(CABIN.rooms) && Object.isFrozen(CABIN.walls)
        && Object.isFrozen(CABIN.doors), 'blueprint authored arrays must be frozen');
    check(houseGeometrySignature(CABIN).length > 100, 'geometry signature must be populated');
    check(CABIN.architecture?.form === 'single-shell-dwelling',
        'cabin must declare one coherent dwelling form');
    check(CABIN.architecture?.projection === 'top-down-cutaway',
        'cabin shell and furnishings must share the top-down cutaway projection');
    check(CABIN.architecture?.exteriorShellCount === 1,
        'cabin must declare exactly one exterior shell');
    check(CABIN.architecture?.foundation === 'continuous-stone-ring',
        'cabin must declare the continuous foundation renderer contract');
    check(CABIN.architecture?.floor === 'continuous-clean-oak',
        'cabin must declare one clean interior floor');
    check(CABIN.architecture?.partitions === 'low-timber-divider',
        'cabin must declare the low interior-partition profile');
    check(CABIN.architecture?.props === 'pixel-plan',
        'cabin furnishings must declare the game-native pixel-plan style');
    check(CABIN.floor?.materialStyle === 'cabinClean' && CABIN.floor?.decal === null,
        'House V3 must not reuse the legacy room/furniture composite floor decal');

    const dims = CABIN.dimensions;
    finiteObject(dims, ['interiorW', 'interiorH', 'wall', 'wallH', 'mainDoor'], 'dimensions');
    check(dims.interiorW > 0 && dims.interiorH > 0 && dims.wall > 0 && dims.wallH > 0,
        'all cabin dimensions must be positive');
    check(CABIN.rooms.length === 5, `expected five authored zones, got ${CABIN.rooms.length}`);
    check(JSON.stringify(CABIN.rooms.map((entry) => entry.id)) === JSON.stringify(EXPECTED_ROOMS),
        `five-zone order must be ${EXPECTED_ROOMS.join(', ')}`);
    check(new Set(CABIN.rooms.map((entry) => entry.id)).size === CABIN.rooms.length,
        'room ids must be unique');
    check(CABIN.rooms.filter((entry) => entry.overlay).length === 1,
        'exactly one circulation overlay zone is expected');

    // Four physical rooms tile one foundation exactly. No overlap means none
    // can masquerade as a nested legacy building; shared edges are real walls
    // and door gaps below.
    const physicalRooms = CABIN.rooms.filter((entry) => !entry.overlay);
    close(physicalRooms.reduce((sum, entry) => sum + entry.w * entry.h, 0),
        dims.interiorW * dims.interiorH, 1e-9,
        'physical room area must exactly tile the continuous floor');
    for (let i = 0; i < physicalRooms.length; i++) {
        for (let j = i + 1; j < physicalRooms.length; j++) {
            const a = physicalRooms[i], b = physicalRooms[j];
            const overlapW = Math.min(a.x + a.w / 2, b.x + b.w / 2)
                - Math.max(a.x - a.w / 2, b.x - b.w / 2);
            const overlapH = Math.min(a.y + a.h / 2, b.y + b.h / 2)
                - Math.max(a.y - a.h / 2, b.y - b.h / 2);
            check(overlapW <= 1e-9 || overlapH <= 1e-9,
                `physical rooms ${a.id}/${b.id} overlap instead of sharing an edge`);
        }
    }

    const innerHW = dims.interiorW / 2;
    const innerHH = dims.interiorH / 2;
    for (const room of CABIN.rooms) {
        finiteObject(room, ['x', 'y', 'w', 'h'], `room ${room.id}`);
        check(room.w > 0 && room.h > 0, `room ${room.id} must have positive area`);
        check(room.x - room.w / 2 >= -innerHW - 1e-9
            && room.x + room.w / 2 <= innerHW + 1e-9
            && room.y - room.h / 2 >= -innerHH - 1e-9
            && room.y + room.h / 2 <= innerHH + 1e-9,
        `room ${room.id} must remain inside the authored interior`);
        check(Array.isArray(room.tags) && room.tags.length > 0, `room ${room.id} must have semantic tags`);
    }
    const hall = roomById('wick-hall');
    check(hall?.overlay === true && hall?.tags?.includes('circulation'),
        'wick-hall must be the circulation overlay');
    check(hall?.w >= 2 * 62 + 24, 'circulation spine must clear a radius-62 body with margin');

    const wallIds = CABIN.walls.map((entry) => entry.id);
    check(wallIds.length > 6, 'House V2 must contain authored shell and partition pieces');
    check(new Set(wallIds).size === wallIds.length, 'wall ids must be unique');
    const outerHW = innerHW + dims.wall;
    const outerHH = innerHH + dims.wall;
    for (const part of CABIN.walls) {
        finiteObject(part, ['x', 'y', 'hw', 'hh'], `wall ${part.id}`);
        check(part.hw > 0 && part.hh > 0, `wall ${part.id} must have a positive footprint`);
        check(Math.abs(part.x) + part.hw <= outerHW + 1e-9
            && Math.abs(part.y) + part.hh <= outerHH + 1e-9,
        `wall ${part.id} must stay inside the structure shell`);
        for (const state of part.inactiveStates || []) {
            check(HOUSE_V2_STATES.includes(state), `wall ${part.id} references unknown state ${state}`);
        }
        if (part.kind === 'partition') {
            check(part.renderHeight >= 22 && part.renderHeight <= 36,
                `partition ${part.id} must stay furniture-scale, got ${part.renderHeight}`);
        }
    }

    const knownConnections = new Set(['outside', ...EXPECTED_ROOMS]);
    const doorIds = CABIN.doors.map((entry) => entry.id);
    check(new Set(doorIds).size === doorIds.length, 'door ids must be unique');
    check(CABIN.doors.filter((entry) => entry.kind === 'exterior').length === 2,
        'cabin must expose two normal exterior doors');
    check(CABIN.doors.filter((entry) => entry.kind === 'breach').length === 1,
        'cabin must expose one ruined-state breach');
    for (const entry of CABIN.doors) {
        finiteObject(entry, ['x', 'y', 'width', 'maxBodyRadius'], `door ${entry.id}`);
        check(entry.axis === 'horizontal' || entry.axis === 'vertical',
            `door ${entry.id} has invalid axis ${entry.axis}`);
        check(entry.width > 0 && entry.maxBodyRadius > 0,
            `door ${entry.id} must have positive width and clearance`);
        check(entry.width >= entry.maxBodyRadius * 2 + 8,
            `door ${entry.id} width does not include an 8px declared-clearance margin`);
        check(Array.isArray(entry.connects) && entry.connects.length === 2,
            `door ${entry.id} must connect exactly two zones`);
        for (const connection of entry.connects || []) {
            check(knownConnections.has(connection), `door ${entry.id} connects unknown zone ${connection}`);
        }
        for (const state of entry.activeStates || []) {
            check(HOUSE_V2_STATES.includes(state), `door ${entry.id} references unknown state ${state}`);
        }
        if (entry.kind === 'exterior' || entry.kind === 'breach') {
            check(entry.connects.includes('outside'), `${entry.kind} ${entry.id} must connect outside`);
            close(Math.hypot(entry.normal?.x || 0, entry.normal?.y || 0), 1, 1e-9,
                `${entry.kind} ${entry.id} normal must be normalized`);
        }
    }

    check(CABIN.spawnExclusions.length >= 3, 'interior and both approaches need spawn exclusions');
    check(CABIN.furniture.length >= 7, 'cabin needs the bell plus a complete domestic furnishing set');
    const domesticRooms = new Set(CABIN.furniture
        .filter((entry) => entry.tags?.includes('domestic'))
        .map((entry) => entry.roomId));
    check(domesticRooms.has('hearth-kitchen') && domesticRooms.has('dining-work')
        && domesticRooms.has('storage-lean-to'),
    'domestic props must establish hearth, dining/work, and storage functions');
    check(CABIN.furniture.some((entry) => entry.tags?.includes('sleep')),
        'sleeping nook needs a bed identity');
    for (const item of CABIN.furniture) {
        check(EXPECTED_ROOMS.includes(item.roomId),
            `furniture ${item.id} references unknown room ${item.roomId}`);
        check(!!item.collider && ['rect', 'circle'].includes(item.collider.shape),
            `furniture ${item.id} needs a supported collider`);
    }
    const encounter = CABIN.encounter;
    finiteObject(encounter, [
        'activationRadius', 'dwellSeconds', 'defendRadius', 'defendSeconds',
        'graceOutsideSeconds', 'retryDelaySeconds',
    ], 'encounter');
    check(encounter.defendSeconds === 45 && encounter.graceOutsideSeconds === 6,
        'encounter must expose the truthful 45-second hold and 6-second grace');
    const sockets = encounter.rewardSockets;
    check(sockets?.requiresExitBeforePickup === true && sockets?.pickupDelaySeconds > 0,
        'Bell rewards need a visible anti-auto-claim arming contract');
    for (const [kind, socket] of Object.entries({ chest: sockets?.chest, shrine: sockets?.shrine })) {
        check(EXPECTED_ROOMS.includes(socket?.roomId), `${kind} reward socket references an unknown room`);
        finiteObject(socket, ['x', 'y'], `${kind} reward socket`);
        const room = roomById(socket.roomId);
        check(Math.abs(socket.x - room.x) <= room.w / 2 - 40
            && Math.abs(socket.y - room.y) <= room.h / 2 - 40,
        `${kind} reward socket lacks 40px room clearance`);
    }
    const rewardDistance = Math.hypot(
        sockets.chest.x - sockets.shrine.x,
        sockets.chest.y - sockets.shrine.y,
    );
    const simultaneousPickupSpan = CHEST.pickupRadius + WICK_ROADS.shrinePickupRadius
        + PLAYER.radius * 2;
    check(rewardDistance > simultaneousPickupSpan + 12,
        `Bell reward choices can overlap one player body (${rewardDistance.toFixed(1)}px <= ${simultaneousPickupSpan + 12}px)`);

    for (const state of HOUSE_V2_STATES) {
        const definition = houseStateDefinition(CABIN, state);
        check(!!definition, `state ${state} needs a definition`);
        check(['complete', 'damaged', 'ruined'].includes(definition?.roof),
            `state ${state} has invalid roof mode ${definition?.roof}`);
        check(Number.isFinite(definition?.light), `state ${state} needs a finite light level`);
        check(Number.isFinite(definition?.severity), `state ${state} needs a finite visual severity`);
        check(typeof definition?.damageProfile === 'string' && definition.damageProfile.length > 0,
            `state ${state} needs a named damage profile`);
        check(Array.isArray(definition?.disabledWallIds), `state ${state} needs disabledWallIds`);
        for (const id of definition?.disabledWallIds || []) {
            check(wallIds.includes(id), `state ${state} disables unknown wall ${id}`);
        }
    }
    check(houseStateDefinition(CABIN, 'damaged').severity
        < houseStateDefinition(CABIN, 'ruined').severity,
    'ruined state must be visually more severe than damaged');
    check(houseStateDefinition(CABIN, 'damaged').damageProfile
        !== houseStateDefinition(CABIN, 'ruined').damageProfile,
    'damaged and ruined states must not share one visual profile');
}

function validatePlacementAndDeterminism() {
    check(BIOME_THEME.emberwood.featuredStructure === 'emberwoodCabinV2',
        'Emberwood must name the V2 featured structure');
    check(MAP_STRUCTURES.emberwoodCabinV2?.blueprint === CABIN,
        'featured map structure must use the canonical blueprint');

    const first = makeFixture();
    const featured = first.obstacles.structures.filter((entry) => entry.blueprintId === CABIN.id);
    check(first.obstacles.structures.length === STRUCTURE_PLACEMENT.count,
        `expected ${STRUCTURE_PLACEMENT.count} total structures, got ${first.obstacles.structures.length}`);
    check(featured.length === 1, `expected exactly one featured cabin, got ${featured.length}`);
    check(first.obstacles.structures.filter((entry) => !entry.blueprintId).length
        === STRUCTURE_PLACEMENT.count - 1, 'featured cabin must consume one existing structure slot');
    check(new Set(first.obstacles.structures.map((entry) => entry.id)).size
        === first.obstacles.structures.length, 'placed structure ids must be unique');

    const structure = first.structure;
    check(structure.blueprint === CABIN, 'placed cabin must retain canonical blueprint identity');
    check(structure.blueprintVersion === CABIN.version, 'placed cabin must expose blueprint version');
    check(structure.state === 'intact', 'placed cabin must begin intact');
    for (const [kind, socket] of Object.entries(CABIN.encounter.rewardSockets)
        .filter(([, value]) => value && Number.isFinite(value.x))) {
        check(!first.obstacles.isBlocked(structure.x + socket.x, structure.y + socket.y, 40),
            `${kind} reward socket is blocked in the generated cabin`);
        check(first.obstacles.findStructureAt(structure.x + socket.x, structure.y + socket.y)?.room?.id
            === socket.roomId, `${kind} reward socket resolves to the wrong room`);
    }
    check(structure.poiReservation === CABIN.encounter.id,
        'featured cabin must reserve its authored encounter');
    const outHW = structure.interiorW / 2 + structure.wall;
    const outHH = structure.interiorH / 2 + structure.wall;
    check(structure.x ** 2 + structure.y ** 2 >= STRUCTURE_PLACEMENT.clearRadius ** 2,
        'featured cabin violated the world-origin clear radius');
    check(Math.abs(structure.x) <= WORLD_W / 2 - STRUCTURE_PLACEMENT.edgeMargin - outHW + 1e-9,
        'featured cabin violated the horizontal edge margin');
    check(Math.abs(structure.y) <= WORLD_H / 2 - STRUCTURE_PLACEMENT.edgeMargin - outHH + 1e-9,
        'featured cabin violated the vertical edge margin');

    const ownedWalls = first.obstacles.obstacles.filter((entry) =>
        entry.structureId === structure.id && entry.wallId);
    const ownedFurniture = first.obstacles.obstacles.filter((entry) =>
        entry.structureId === structure.id && entry.furnitureId);
    const ownedFloors = first.obstacles.obstacles.filter((entry) =>
        entry.structureId === structure.id && entry.type === 'buildingFloor');
    check(ownedWalls.length === CABIN.walls.length,
        `placed cabin compiled ${ownedWalls.length}/${CABIN.walls.length} walls`);
    check(ownedFurniture.length === CABIN.furniture.length,
        `placed cabin compiled ${ownedFurniture.length}/${CABIN.furniture.length} furniture colliders`);
    check(ownedFloors.length === 1, `placed cabin needs one decorative floor, got ${ownedFloors.length}`);
    check(JSON.stringify(sorted(ownedWalls.map((entry) => entry.wallId)))
        === JSON.stringify(sorted(CABIN.walls.map((entry) => entry.id))),
    'placed wall ids must exactly match blueprint wall ids');

    const expected = placementSignature(first.obstacles);
    for (let run = 1; run <= 5; run++) {
        const repeat = makeFixture();
        check(placementSignature(repeat.obstacles) === expected,
            `same-input generation changed on deterministic repeat ${run}`);
        check(repeat.obstacles.structures.length === STRUCTURE_PLACEMENT.count,
            `repeat ${run} did not place ${STRUCTURE_PLACEMENT.count} structures`);
        check(repeat.obstacles.structures.filter((entry) => entry.blueprintId === CABIN.id).length === 1,
            `repeat ${run} did not place exactly one featured cabin`);
    }

    first.obstacles.setStructureState(structure.id, 'ruined');
    first.obstacles.generate(WORLD_W, WORLD_H, BIOME);
    check(placementSignature(first.obstacles) === expected,
        'regeneration after a state mutation must restore the deterministic intact world');
    check(first.obstacles.getStructureByBlueprint(CABIN.id)?.state === 'intact',
        'regeneration must reset transient house state to intact');
}

function validateArchitectureRenderingAndAssets() {
    const { obstacles, structure } = makeFixture();
    check(structure.architecture === CABIN.architecture,
        'placed structure must retain canonical single-dwelling architecture metadata');
    const floor = obstacles.obstacles.find((entry) =>
        entry.structureId === structure.id && entry.type === 'buildingFloor');
    check(floor?.def.floorMaterialStyle === 'cabinClean',
        'compiled floor must select the clean material-only source asset');

    const partitions = obstacles.obstacles.filter((entry) =>
        entry.structureId === structure.id && entry.partition);
    const expectedIds = CABIN.walls.filter((entry) => entry.kind === 'partition')
        .map((entry) => entry.id);
    check(partitions.length === expectedIds.length,
        `compiled ${partitions.length}/${expectedIds.length} interior partitions`);
    check(partitions.every((entry) =>
        entry.def.partitionProfile === CABIN.architecture.partitions),
    'compiled partitions must retain the low-divider visual profile');
    const blueprintWalls = obstacles.obstacles.filter((entry) =>
        entry.structureId === structure.id && entry.type === 'buildingWall');
    check(blueprintWalls.every((entry) =>
        entry.def.renderProjection === CABIN.architecture.projection),
    'compiled shell and partitions must retain the top-down render projection');

    // The production visible collector is painter-ordered once by baseY. Run
    // its exact predicate and renderer route, then prove every authored active
    // shell/partition footprint paints once and only once.
    const counts = new Map();
    const ctx = partitionTraceContext();
    obstacles.forVisible(
        { x: structure.x, y: structure.y }, 1800, 1400,
        (ob) => {
            if (ob.type === 'buildingWall' && ob.def.blueprintId
                && structureRenderer.drawBlueprintWall(ctx, ob)) {
                counts.set(ob.wallId, (counts.get(ob.wallId) || 0) + 1);
            }
        },
        (ob) => !ob.def.decorative
            && !(ob.type === 'buildingWall' && ob.structureId && !ob.def.blueprintId),
    );
    const activeWallIds = CABIN.walls.filter((entry) => houseWallActive(CABIN, entry, 'intact'))
        .map((entry) => entry.id);
    for (const id of activeWallIds) {
        check(counts.get(id) === 1, `active plan wall ${id} painted ${counts.get(id) || 0} times`);
    }
    check([...counts.keys()].every((id) => activeWallIds.includes(id)),
        'top-down wall route painted a wall outside the authored active set');
    check(ctx.calls.some((entry) => entry.startsWith('fill:'))
        && ctx.calls.some((entry) => entry.startsWith('stroke:')),
    'low-divider renderer emitted no material geometry');

    // Structure-owned walls must never fall back to Obstacle's standing facade
    // drawer. Every authored segment uses the exact footprint route above.
    for (const wall of blueprintWalls) {
        const legacyCtx = partitionTraceContext();
        wall.draw(legacyCtx);
        check(legacyCtx.calls.length === 0,
            `structure wall ${wall.wallId} leaked into the legacy facade drawer`);
    }

    const muted = partitions[0];
    muted.active = false;
    const inactiveCtx = partitionTraceContext();
    check(structureRenderer.drawBlueprintWall(inactiveCtx, muted) === false,
        'inactive blueprint-wall renderer must fail closed');
    check(inactiveCtx.calls.length === 0, 'inactive partition emitted pixels');
    let collectedInactive = false;
    obstacles.forVisible({ x: muted.x, y: muted.y }, 800, 800, (ob) => {
        if (ob === muted) collectedInactive = true;
    });
    check(!collectedInactive, 'inactive partition entered the visible painter queue');
    muted.active = true;

    const gameRenderSource = readFileSync(
        new URL('../src/core/GameRender.js', import.meta.url), 'utf8');
    const enqueueAt = gameRenderSource.indexOf('ob, ob.baseY, 0, standingSerial++');
    const routeAt = gameRenderSource.indexOf('structureRenderer.drawBlueprintWall(ctx, value)');
    const floorDetailAt = gameRenderSource.indexOf('structureRenderer.drawFloorDetails(ctx, structure)');
    check(enqueueAt >= 0, 'standing queue must sort blueprint walls by their real baseY');
    check(routeAt > enqueueAt, 'sorted standing queue must route blueprint walls to the plan renderer');
    check(floorDetailAt >= 0 && floorDetailAt < enqueueAt,
        'floor-state details must paint after decorative floors and before standing art');

    const rearCtx = partitionTraceContext();
    structureRenderer.drawRear(rearCtx, structure, { x: structure.x, y: structure.y });
    check(rearCtx.calls.length === 0, 'top-down House V2 leaked into the tall rear-facade renderer');
    const frontCtx = partitionTraceContext();
    structureRenderer.drawFront(frontCtx, structure);
    check(frontCtx.calls.length === 0, 'top-down House V2 leaked into the tall front-facade renderer');
    const drawGroundSource = readFileSync(
        new URL('../src/render/StructureRenderer.js', import.meta.url), 'utf8');
    const groundSlice = drawGroundSource.slice(
        drawGroundSource.indexOf('drawGround(ctx, structure)'),
        drawGroundSource.indexOf('_drawApproach(ctx, s, m'),
    );
    check(!groundSlice.includes('_drawStateFootprint'),
        'state damage must not paint beneath and get erased by the floor raster');

    const floorPng = pngDimensions('../src/assets/obstacles/floor_cabin_clean.png');
    check(floorPng.width === 512 && floorPng.height === 410,
        `clean floor must be 512x410, got ${floorPng.width}x${floorPng.height}`);
    for (const file of [
        'cabin_bed.png', 'ruin_bell.png', 'cabin_hearth.png', 'cabin_table.png',
        'cabin_shelf.png', 'cabin_crate.png', 'cabin_barrel.png',
    ]) {
        const png = pngDimensions(`../src/assets/obstacles/${file}`);
        check(png.width === 256 && png.height === 256,
            `${file} must be a 256x256 transparent prop render`);
    }
    const blenderSource = readFileSync(
        new URL('./blender/render_house_v2_props.py', import.meta.url), 'utf8');
    for (const builder of [
        'build_clean_floor', 'build_bed', 'build_ruin_bell', 'build_hearth',
        'build_table', 'build_shelf', 'build_crate', 'build_barrel',
    ]) {
        check(blenderSource.includes(`def ${builder}(`), `Blender source lacks ${builder}`);
    }
    check(blenderSource.includes('camera.rotation_euler = (0, 0, 0)'),
        'House V2 props must render from the exact top-down Blender camera');
    check(blenderSource.includes('pixelate-sheet.mjs') && blenderSource.includes('logical=64'),
        'House V2 props must install through the deterministic pixel-art pass');
    check(!blenderSource.includes('IsZbjO') && !blenderSource.includes('C:\\Downloads'),
        'reference-only image must never enter the asset generator');
    const credits = readFileSync(new URL('../ASSET_CREDITS.md', import.meta.url), 'utf8');
    for (const file of [
        'floor_cabin_clean.png', 'cabin_bed.png', 'ruin_bell.png', 'cabin_hearth.png',
        'cabin_table.png', 'cabin_shelf.png', 'cabin_crate.png', 'cabin_barrel.png',
    ]) check(credits.includes(file), `${file} needs original Blender provenance in ASSET_CREDITS.md`);
}

function validateDoorsAndStates() {
    const { obstacles, structure } = makeFixture();
    const initialReference = structure;
    const obstacleCount = obstacles.obstacles.length;
    const intactSignatures = new Map();

    for (const state of HOUSE_V2_STATES) {
        check(obstacles.setStructureState(structure.id, state), `setStructureState rejected ${state}`);
        check(structure === initialReference, `state ${state} replaced the structure record`);
        check(structure.state === state, `state setter did not retain ${state}`);
        check(obstacles.obstacles.length === obstacleCount,
            `state ${state} changed the obstacle array length`);
        for (const part of CABIN.walls) {
            const owned = obstacles.obstacles.find((entry) =>
                entry.structureId === structure.id && entry.wallId === part.id);
            const expectedActive = houseWallActive(CABIN, part, state);
            check(!!owned, `state ${state} lost wall obstacle ${part.id}`);
            check((owned?.active !== false) === expectedActive,
                `state ${state} wall ${part.id} active flag disagrees with blueprint`);
            check(gridContains(obstacles, owned) === expectedActive,
                `state ${state} wall ${part.id} has stale grid membership`);
        }
        for (const entry of CABIN.doors) {
            const expected = (entry.activeStates || HOUSE_V2_STATES).includes(state);
            check(houseDoorActive(entry, state) === expected,
                `door ${entry.id} active-state query disagrees in ${state}`);
        }
        intactSignatures.set(state, physicsSignature(obstacles, structure));
    }

    check(intactSignatures.get('intact') === intactSignatures.get('lit'),
        'intact and lit must have byte-identical physical signatures');
    check(intactSignatures.get('intact') === intactSignatures.get('damaged'),
        'damaged currently promises unchanged physics and must match intact');
    check(intactSignatures.get('ruined') !== intactSignatures.get('intact'),
        'ruined must change the active physical signature');
    const intactIds = new Set(intactSignatures.get('intact').split('|'));
    const ruinedIds = new Set(intactSignatures.get('ruined').split('|'));
    check(intactIds.size === ruinedIds.size + 1,
        'ruined state must remove exactly one physical wall in this slice');

    obstacles.setStructureState(structure.id, 'intact');
    const beforeInvalid = physicsSignature(obstacles, structure);
    check(!obstacles.setStructureState(structure.id, 'burned'),
        'unknown structure states must be rejected');
    check(structure.state === 'intact' && physicsSignature(obstacles, structure) === beforeInvalid,
        'unknown state changed structure physics');

    for (const entry of CABIN.doors) {
        const state = entry.activeStates.includes('intact') ? 'intact' : entry.activeStates[0];
        obstacles.setStructureState(structure.id, state);
        const radius = Math.max(1, entry.maxBodyRadius - 0.5);
        check(!doorSweep(obstacles, structure, entry, radius),
            `door ${entry.id} does not clear its declared radius ${radius.toFixed(1)} in ${state}`);
    }

    const breach = CABIN.doors.find((entry) => entry.id === 'ruined-east-breach');
    const a = worldPoint(structure, breach.x + 100, breach.y);
    // End in the narrow clear pocket between shell and cot. A deeper endpoint
    // would test the bed collider rather than the state-controlled east wall.
    const b = worldPoint(structure, breach.x - 50, breach.y);
    const navTarget = worldPoint(structure, roomById('sleeping-nook').x, roomById('sleeping-nook').y);
    const routeProbe = makeMover(a.x, a.y, 44, 140);

    obstacles.setStructureState(structure.id, 'intact');
    check(obstacles.movementBlocked(a.x, a.y, b.x, b.y, 20),
        'intact east wall must block a swept body at the future breach');
    check(!obstacles.hasLineOfSight(a.x, a.y, b.x, b.y),
        'intact east wall must block LOS at the future breach');
    check(obstacles.applyHouseNavigationGoal(routeProbe, navTarget.x, navTarget.y, 'frontline'),
        'intact cabin must provide an alternate route to the sleeping nook');
    check(routeProbe._houseNavReason !== 'house-door:ruined-east-breach',
        'ruined breach must not appear in intact navigation');

    obstacles.setStructureState(structure.id, 'ruined');
    check(!obstacles.movementBlocked(a.x, a.y, b.x, b.y, 20),
        'ruined east breach did not open collision');
    check(obstacles.hasLineOfSight(a.x, a.y, b.x, b.y),
        'ruined east breach did not open LOS');
    check(obstacles.applyHouseNavigationGoal(routeProbe, navTarget.x, navTarget.y, 'frontline'),
        'ruined cabin did not provide a breach navigation route');
    check(routeProbe._houseNavReason === 'house-door:ruined-east-breach',
        `ruined navigation chose ${routeProbe._houseNavReason} instead of the breach`);

    const intactGridRefs = (() => {
        obstacles.setStructureState(structure.id, 'intact');
        return gridReferenceCount(obstacles);
    })();
    for (let cycle = 0; cycle < 32; cycle++) {
        for (const state of HOUSE_V2_STATES) {
            check(obstacles.setStructureState(structure.id, state),
                `rebuild cycle ${cycle} rejected ${state}`);
            const inactive = obstacles.obstacles.filter((entry) =>
                entry.structureId === structure.id && entry.wallId && entry.active === false);
            check(inactive.every((entry) => !gridContains(obstacles, entry)),
                `rebuild cycle ${cycle}/${state} retained an inactive grid wall`);
        }
    }
    obstacles.setStructureState(structure.id, 'intact');
    check(gridReferenceCount(obstacles) === intactGridRefs,
        'repeated state rebuilds accumulated or lost grid references');
    check(physicsSignature(obstacles, structure) === beforeInvalid,
        'repeated state rebuilds did not restore intact physics exactly');
}

function validateRoomsSpawnsAndFurniture() {
    const { obstacles, structure } = makeFixture();
    for (const room of CABIN.rooms) {
        const local = localRoomAt(CABIN, room.x, room.y, room.overlay);
        const world = worldRoomAt(structure, structure.x + room.x, structure.y + room.y, room.overlay);
        check(local?.id === room.id,
            `local room lookup returned ${local?.id || 'null'} for zone ${room.id}`);
        check(world?.id === room.id,
            `world room lookup returned ${world?.id || 'null'} for zone ${room.id}`);
        const runtime = obstacles.getRoomAt(
            structure.x + room.x,
            structure.y + room.y,
            room.overlay,
        );
        check(runtime?.structure === structure && runtime?.room?.id === room.id,
            `ObstacleSystem room lookup could not address zone ${room.id}`);
    }
    check(worldRoomAt(structure, structure.x + 1000, structure.y + 1000) === null,
        'world room lookup must reject an exterior point');
    check(obstacles.getRoomAt(structure.x + 1000, structure.y + 1000) === null,
        'ObstacleSystem room lookup must reject an exterior point');

    for (const zone of CABIN.spawnExclusions) {
        const point = worldPoint(structure, zone.x, zone.y);
        check(obstacles.isSpawnBlocked(point.x, point.y, 1),
            `spawn exclusion ${zone.id} does not reject its center`);
    }
    const walkable = findSpawnExcludedWalkablePoint(obstacles, structure);
    check(!!walkable, 'could not find walkable floor inside the spawn exclusion');
    if (walkable) {
        check(!obstacles.isBlocked(walkable.x, walkable.y, 1),
            'spawn-excluded floor sample must remain walkable');
        check(obstacles.isSpawnBlocked(walkable.x, walkable.y, 1),
            'walkable interior floor must reject ambient spawns');
    }

    for (const item of CABIN.furniture) {
        const compiled = obstacles.obstacles.find((entry) =>
            entry.structureId === structure.id && entry.furnitureId === item.id);
        check(!!compiled, `furniture ${item.id} was not compiled into an obstacle`);
        const authoredWorld = worldFurniture(structure, item.id);
        close(compiled?.x, authoredWorld?.x, 1e-9, `furniture ${item.id} world x`);
        close(compiled?.y, authoredWorld?.y, 1e-9, `furniture ${item.id} world y`);
        check(compiled?.blocksLOS === (item.blocksLOS === true),
            `furniture ${item.id} LOS flag disagrees with the blueprint`);
        check(obstacles.isBlocked(compiled.x, compiled.y, 1),
            `furniture ${item.id} center is not collision-blocked`);
        check(obstacles.isSpawnBlocked(compiled.x, compiled.y, 1),
            `furniture ${item.id} center is not spawn-blocked`);

        const extent = compiled.shape === 'circle' ? compiled.def.col.r : compiled.def.col.hw;
        const ax = compiled.x - extent - 4;
        const bx = compiled.x + extent + 4;
        const clearLOS = obstacles.hasLineOfSight(ax, compiled.y, bx, compiled.y);
        check(clearLOS === !compiled.blocksLOS,
            `furniture ${item.id} short LOS probe disagrees with blocksLOS=${compiled.blocksLOS}`);
    }
}

function validateNavigationRoles() {
    const { obstacles, structure } = makeFixture();
    const south = CABIN.doors.find((entry) => entry.id === 'south-entry');
    const breach = CABIN.doors.find((entry) => entry.id === 'ruined-east-breach');

    const playerTarget = findClearPointInRoom(
        obstacles,
        structure,
        'dining-work',
        50,
        { x: south.x, y: south.y - 90 },
    );
    check(!!playerTarget, 'no radius-50 walkable target exists in the dining room');
    const playerStart = worldPoint(
        structure,
        south.x,
        south.y + structure.wall + 50 + 92,
    );
    const playerBody = makeMover(playerStart.x, playerStart.y, 50, 155);
    check(enemyNavigationRole(playerBody) === 'frontline',
        'player-sized representative body must resolve to frontline navigation');
    if (playerTarget) {
        check(obstacles.applyHouseNavigationGoal(playerBody, playerTarget.x, playerTarget.y, 'frontline'),
            'player-sized body did not receive a house navigation goal');
        check(playerBody._houseNavReason === 'house-door:south-entry',
            `player-sized body chose ${playerBody._houseNavReason} instead of south-entry`);
        let reached = false;
        let embedded = false;
        for (let frame = 0; frame < 12 * 60; frame++) {
            stepMover(obstacles, playerBody, playerTarget);
            if (obstacles.isBlocked(playerBody.x, playerBody.y, playerBody.radius - 0.001)) embedded = true;
            if (Math.hypot(playerBody.x - playerTarget.x, playerBody.y - playerTarget.y) <= 18) {
                reached = true;
                break;
            }
        }
        check(!embedded, 'player-sized route embedded in cabin geometry');
        check(reached, 'player-sized body did not enter through south-entry within 12 seconds');
    }

    obstacles.setStructureState(structure.id, 'ruined');
    const smallTarget = findClearPointInRoom(
        obstacles,
        structure,
        'sleeping-nook',
        44,
        { x: breach.x - 65, y: breach.y },
    );
    check(!!smallTarget, 'no radius-44 walkable target exists in the ruined sleeping nook');
    const smallStart = worldPoint(
        structure,
        breach.x + structure.wall + 44 + 92,
        breach.y,
    );
    const smallBody = makeMover(smallStart.x, smallStart.y, 44, 170, { behavior: 'charger', side: -1 });
    check(enemyNavigationRole(smallBody) === 'flanker', 'charger-sized body must resolve to flanker');
    if (smallTarget) {
        check(obstacles.applyHouseNavigationGoal(smallBody, smallTarget.x, smallTarget.y, 'flanker'),
            'small flanker did not receive a ruined-house goal');
        check(smallBody._houseNavReason === 'house-door:ruined-east-breach',
            `small flanker chose ${smallBody._houseNavReason} instead of ruined-east-breach`);
        let reached = false;
        let embedded = false;
        for (let frame = 0; frame < 12 * 60; frame++) {
            stepMover(obstacles, smallBody, smallTarget);
            if (obstacles.isBlocked(smallBody.x, smallBody.y, smallBody.radius - 0.001)) embedded = true;
            if (Math.hypot(smallBody.x - smallTarget.x, smallBody.y - smallTarget.y) <= 18) {
                reached = true;
                break;
            }
        }
        check(!embedded, 'small flanker route embedded in ruined cabin geometry');
        check(reached, 'small flanker did not enter the ruined breach within 12 seconds');
    }

    obstacles.setStructureState(structure.id, 'intact');
    const interiorTarget = playerTarget || worldPoint(structure, -110, 138);
    const largeStart = worldPoint(structure, south.x, south.y + 520);
    const largeBody = makeMover(largeStart.x, largeStart.y, 105, 115);
    check(enemyNavigationRole(largeBody) === 'siege', 'radius-105 body must resolve to siege');
    check(obstacles.applyHouseNavigationGoal(largeBody, interiorTarget.x, interiorTarget.y, 'siege'),
        'large siege body did not receive a perimeter goal');
    check(largeBody._houseNavReason === 'house-perimeter-pressure',
        `large siege body received ${largeBody._houseNavReason} instead of perimeter pressure`);
    let largeEmbedded = false;
    let largeEntered = false;
    let pressureReasonSeen = false;
    let largeTravel = 0;
    for (let frame = 0; frame < 10 * 60; frame++) {
        largeTravel += stepMover(obstacles, largeBody, interiorTarget);
        pressureReasonSeen ||= largeBody._houseNavReason === 'house-perimeter-pressure';
        largeEmbedded ||= obstacles.isBlocked(largeBody.x, largeBody.y, largeBody.radius - 0.001);
        largeEntered ||= worldRoomAt(structure, largeBody.x, largeBody.y) !== null;
    }
    check(pressureReasonSeen, 'large siege route never used a pressure anchor');
    check(!largeEmbedded, 'large siege body embedded in cabin geometry');
    check(!largeEntered, 'large siege body entered a room through an undersized portal');
    check(largeTravel > 100, `large siege body made only ${largeTravel.toFixed(1)}px progress`);

    const ranged = makeMover(largeStart.x + 100, largeStart.y, 44, 120, { behavior: 'spitter' });
    check(enemyNavigationRole(ranged) === 'ranged', 'spitter must resolve to ranged house navigation');
    check(obstacles.applyHouseNavigationGoal(ranged, interiorTarget.x, interiorTarget.y, 'ranged'),
        'ranged body did not receive an exterior firing goal');
    check(ranged._houseNavReason === 'house-firing-socket',
        `ranged body received ${ranged._houseNavReason} instead of a firing socket`);
}

function validateBoundedStress() {
    const { obstacles, structure } = makeFixture();
    const north = CABIN.doors.find((entry) => entry.id === 'north-utility');
    const south = CABIN.doors.find((entry) => entry.id === 'south-entry');
    const targets = {
        north44: findClearPointInRoom(obstacles, structure, 'hearth-kitchen', 44,
            { x: north.x, y: north.y + 90 }),
        north50: findClearPointInRoom(obstacles, structure, 'hearth-kitchen', 50,
            { x: north.x, y: north.y + 90 }),
        south44: findClearPointInRoom(obstacles, structure, 'dining-work', 44,
            { x: south.x, y: south.y - 90 }),
        south50: findClearPointInRoom(obstacles, structure, 'dining-work', 50,
            { x: south.x, y: south.y - 90 }),
    };
    for (const [id, target] of Object.entries(targets)) {
        check(!!target, `stress fixture lacks clear target ${id}`);
    }
    if (Object.values(targets).some((entry) => !entry)) return { probes: 0, elapsed: 0, reached: 0 };

    const movers = [];
    for (let i = 0; i < 180; i++) {
        let radius;
        let behavior = null;
        let roleClass;
        if (i < 120) {
            radius = i % 2 ? 44 : 50;
            behavior = i % 3 === 0 ? 'charger' : null;
            roleClass = 'entrant';
        } else if (i < 150) {
            radius = 92;
            roleClass = 'siege';
        } else if (i < 165) {
            radius = 44;
            behavior = 'spitter';
            roleClass = 'ranged';
        } else {
            radius = 46;
            behavior = 'support';
            roleClass = 'support';
        }
        const useNorth = i % 2 === 0;
        const door = useNorth ? north : south;
        const outward = useNorth ? -1 : 1;
        const jitter = roleClass === 'entrant' ? ((i % 5) - 2) * 4 : ((i % 7) - 3) * 12;
        const x = structure.x + door.x + jitter;
        const y = structure.y + door.y + outward * (structure.wall + radius + 260 + (i % 4) * 12);
        const target = roleClass === 'entrant'
            ? targets[`${useNorth ? 'north' : 'south'}${radius}`]
            : targets[useNorth ? 'north44' : 'south44'];
        movers.push({
            body: makeMover(x, y, radius, 105 + (i % 5) * 13, {
                behavior,
                side: i & 1 ? -1 : 1,
            }),
            target,
            roleClass,
            reached: false,
            embedded: false,
            entered: false,
            expectedOutsideReasonSeen: false,
        });
    }

    let probes = 0;
    const movementBlocked = obstacles.movementBlocked.bind(obstacles);
    obstacles.movementBlocked = (...args) => {
        probes++;
        return movementBlocked(...args);
    };
    const started = performance.now();
    for (let frame = 0; frame < 600; frame++) {
        for (const item of movers) {
            if (item.reached) continue;
            stepMover(obstacles, item.body, item.target);
            item.embedded ||= obstacles.isBlocked(
                item.body.x,
                item.body.y,
                item.body.radius - 0.001,
            );
            const room = worldRoomAt(structure, item.body.x, item.body.y);
            item.entered ||= room !== null;
            if (item.roleClass === 'entrant') {
                item.reached = Math.hypot(
                    item.body.x - item.target.x,
                    item.body.y - item.target.y,
                ) <= 22;
            } else {
                const reason = item.body._houseNavReason;
                item.expectedOutsideReasonSeen ||= item.roleClass === 'siege'
                    ? reason === 'house-perimeter-pressure'
                    : reason === 'house-firing-socket';
            }
        }
    }
    const elapsed = performance.now() - started;
    obstacles.movementBlocked = movementBlocked;

    const entrants = movers.filter((entry) => entry.roleClass === 'entrant');
    const outsideRoles = movers.filter((entry) => entry.roleClass !== 'entrant');
    const reached = entrants.filter((entry) => entry.reached).length;
    check(reached === entrants.length,
        `180-body stress reached only ${reached}/${entrants.length} entrant targets`);
    check(movers.every((entry) => !entry.embedded),
        `${movers.filter((entry) => entry.embedded).length}/180 stress bodies embedded in geometry`);
    check(outsideRoles.every((entry) => !entry.entered),
        `${outsideRoles.filter((entry) => entry.entered).length}/${outsideRoles.length} hold/siege bodies entered rooms`);
    check(outsideRoles.every((entry) => entry.expectedOutsideReasonSeen),
        `${outsideRoles.filter((entry) => !entry.expectedOutsideReasonSeen).length}/${outsideRoles.length} hold/siege bodies missed their role goal`);
    check(probes < 180 * 600 * 6,
        `180-body stress used ${probes.toLocaleString()} probes; bounded ceiling is ${(180 * 600 * 6).toLocaleString()}`);
    check(elapsed < 5000,
        `180-body stress took ${elapsed.toFixed(1)}ms; generous non-flaky ceiling is 5000ms`);
    return { probes, elapsed, reached };
}

const totalStarted = performance.now();
runSection('schema and geometry', validateSchemaAndGeometry);
runSection('featured placement and determinism', validatePlacementAndDeterminism);
runSection('single-dwelling render and original assets', validateArchitectureRenderingAndAssets);
runSection('doors, states, collision, LOS, and rebuilds', validateDoorsAndStates);
runSection('room, spawn, and furniture authority', validateRoomsSpawnsAndFurniture);
runSection('player/small/large role navigation', validateNavigationRoles);
const stress = runSection('bounded 180-body stress', validateBoundedStress) || {
    probes: 0,
    elapsed: 0,
    reached: 0,
};
const totalMs = performance.now() - totalStarted;

if (failures.length) {
    console.error(
        `House V2 validation FAILED: ${failures.length} failure(s) across ${checks.toLocaleString()} checks.`,
    );
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error('Sections:');
    for (const section of sectionStats) {
        console.error(
            `  ${section.name}: ${section.checks.toLocaleString()} checks, `
            + `${section.failures} failures, ${section.ms.toFixed(1)}ms`,
        );
    }
    console.error(
        `Stress receipt: ${stress.reached}/120 entrants, ${stress.probes.toLocaleString()} probes, `
        + `${stress.elapsed.toFixed(1)}ms (${totalMs.toFixed(1)}ms total).`,
    );
    process.exitCode = 1;
} else {
    console.log(
        `House V2 validation: OK - ${checks.toLocaleString()} checks; `
        + `featured cabin 1/${STRUCTURE_PLACEMENT.count}; four states; five zones; `
        + `180-body stress ${stress.probes.toLocaleString()} probes in ${stress.elapsed.toFixed(1)}ms `
        + `(${totalMs.toFixed(1)}ms total).`,
    );
}
