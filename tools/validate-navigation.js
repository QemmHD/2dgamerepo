#!/usr/bin/env node
// Deterministic navigation/collision validation for procedural houses.
// No DOM, canvas, test runner, or third-party package required.

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { ObstacleSystem } from '../src/systems/ObstacleSystem.js';
import { steerEnemyMovement } from '../src/systems/EnemyNavigation.js';
import { Spawner } from '../src/systems/Spawner.js';
import { MAP_STRUCTURES } from '../src/content/mapObjects.js';
import { getHouseBlueprint } from '../src/content/houseBlueprints.js';
import { ENEMY, ELITE } from '../src/config/GameConfig.js';

const BIOMES = ['emberwood', 'hollowreach', 'crypts', 'dunes'];
let checks = 0;

function assert(ok, message) {
    checks++;
    if (!ok) throw new Error(message);
}

function makeMover(x, y, radius = 44, speed = 150, side = 1) {
    return {
        x, y, radius, speed,
        _navSide: side,
        _navHold: 0,
        _navMoveX: 0,
        _navMoveY: 0,
    };
}

function stepMover(obstacles, mover, target, dt = 1 / 60) {
    const dx = target.x - mover.x, dy = target.y - mover.y;
    steerEnemyMovement(mover, dx, dy, mover.speed, obstacles, dt, target.x, target.y);
    const oldX = mover.x, oldY = mover.y;
    mover.x += mover._navMoveX * mover.speed * dt;
    mover.y += mover._navMoveY * mover.speed * dt;
    const resolved = obstacles.resolveCircle(mover.x, mover.y, mover.radius);
    mover.x = resolved.x;
    mover.y = resolved.y;
    return Math.hypot(mover.x - oldX, mover.y - oldY);
}

function buildingStarts(floor, radius) {
    const blueprint = getHouseBlueprint(floor.def.blueprintId);
    const dimensions = blueprint?.dimensions || MAP_STRUCTURES[floor.def.styleType];
    const outX = dimensions.interiorW / 2 + dimensions.wall;
    const outY = dimensions.interiorH / 2 + dimensions.wall;
    const gap = radius + 86;
    return [
        [floor.x + outX + gap, floor.y],
        [floor.x - outX - gap, floor.y],
        [floor.x, floor.y + outY + gap],
        [floor.x, floor.y - outY - gap],
    ];
}

function validateCollisionCore() {
    for (const biome of BIOMES) {
        const obstacles = new ObstacleSystem();
        obstacles.generate(7200, 4050, biome);
        for (const ob of obstacles.obstacles) {
            if (ob.def.decorative) continue;
            // These cover every normal/support/teleporter body that can be
            // displaced into a wall. Large bodies are spawn-validated at their
            // actual radius and cannot enter a house doorway by design.
            for (const radius of [28, 34, 44, 50, 62]) {
                const p = obstacles.resolveCircle(ob.x, ob.y, radius);
                assert(
                    !obstacles.isBlocked(p.x, p.y, radius - 0.001),
                    `${biome}: radius ${radius} remained embedded in ${ob.type}`,
                );
            }
        }

        // Endpoint-only avoidance misses this: both endpoints are clear but a
        // long step crosses a thin horizontal house wall.
        const wall = obstacles.obstacles.find((ob) =>
            ob.type === 'buildingWall' && ob.def.col.hw > ob.def.col.hh * 2);
        assert(!!wall, `${biome}: no horizontal house wall generated`);
        const clear = 12;
        const ay = wall.y - wall.def.col.hh - clear - 40;
        const by = wall.y + wall.def.col.hh + clear + 40;
        assert(!obstacles.isBlocked(wall.x, ay, clear), `${biome}: sweep start is not clear`);
        assert(!obstacles.isBlocked(wall.x, by, clear), `${biome}: sweep end is not clear`);
        assert(
            obstacles.movementBlocked(wall.x, ay, wall.x, by, clear),
            `${biome}: swept circle skipped a thin wall`,
        );
    }
}

function validateEveryHouseApproach() {
    let routes = 0;
    for (const biome of BIOMES) {
        const obstacles = new ObstacleSystem();
        obstacles.generate(7200, 4050, biome);
        const floors = obstacles.obstacles.filter((ob) => ob.type === 'buildingFloor');
        assert(floors.length === 11, `${biome}: expected 11 deterministic houses, got ${floors.length}`);

        for (const floor of floors) {
            const blueprint = getHouseBlueprint(floor.def.blueprintId);
            const structure = blueprint
                ? obstacles.structures.find((entry) => entry.id === floor.structureId)
                : null;
            const targetRoom = blueprint?.rooms.find((entry) => entry.id === 'dining-work');
            const target = targetRoom && structure
                ? { x: structure.x + targetRoom.x, y: structure.y + targetRoom.y }
                : { x: floor.x, y: floor.y };
            const starts = buildingStarts(floor, 44);
            for (let i = 0; i < starts.length; i++) {
                const mover = makeMover(starts[i][0], starts[i][1], 44, 150, i & 1 ? 1 : -1);
                let longestStill = 0, still = 0, reached = false;
                for (let frame = 0; frame < 20 * 60; frame++) {
                    const moved = stepMover(obstacles, mover, target);
                    assert(
                        !obstacles.isBlocked(mover.x, mover.y, mover.radius - 0.001),
                        `${biome}/${floor.def.styleType}: route entered a wall`,
                    );
                    if (moved < 0.05) still++;
                    else { longestStill = Math.max(longestStill, still); still = 0; }
                    if (Math.hypot(target.x - mover.x, target.y - mover.y) < 70) {
                        reached = true;
                        break;
                    }
                }
                longestStill = Math.max(longestStill, still);
                assert(reached, `${biome}/${floor.def.styleType}: failed approach ${i}`);
                assert(longestStill < 20, `${biome}/${floor.def.styleType}: stuck ${longestStill} frames`);
                routes++;
            }
        }
    }
    assert(routes === 176, `expected 176 house routes, got ${routes}`);
    return routes;
}

function validateLargeBodySiege() {
    // A 105px body intentionally cannot fit a 132-152px doorway. It must keep
    // flowing around the refuge rather than grind into one wall forever.
    const obstacles = new ObstacleSystem();
    obstacles.generate(7200, 4050, 'hollowreach');
    const floor = obstacles.obstacles.find((ob) => ob.type === 'buildingFloor');
    const start = buildingStarts(floor, 105)[0];
    const mover = makeMover(start[0], start[1], 105, 100, 1);
    const target = { x: floor.x, y: floor.y };
    let travelled = 0;
    for (let frame = 0; frame < 12 * 60; frame++) {
        travelled += stepMover(obstacles, mover, target);
        assert(
            !obstacles.isBlocked(mover.x, mover.y, mover.radius - 0.001),
            'large siege body entered a house wall',
        );
    }
    assert(travelled > 900, `large siege body only travelled ${travelled.toFixed(1)}px`);
}

function validateSpawnerClearance() {
    const spawner = new Spawner({ placementAttempts: 3 });
    const seen = [];
    const alwaysBlocked = {
        isBlocked(_x, _y, radius) { seen.push(radius); return true; },
    };
    const oldRandom = Math.random;
    Math.random = () => 0; // dreadhulk only; elite roll always succeeds
    try {
        spawner._spawnOne(
            { x: 0, y: 0 }, [],
            {
                typeWeights: { dreadhulk: 1 }, eliteChance: 1,
                healthMul: 1, speedMul: 1, damageMul: 1,
            },
            alwaysBlocked,
        );
    } finally {
        Math.random = oldRandom;
    }
    const expected = ENEMY.dreadhulk.radius * ELITE.sizeMul;
    assert(seen.length === 3, `spawner made ${seen.length} clearance attempts, expected 3`);
    for (const radius of seen) {
        assert(Math.abs(radius - expected) < 1e-9, `spawner used ${radius}px, expected ${expected}px`);
    }
}

function validateEnemyIntegrationGate() {
    const source = readFileSync(new URL('../src/entities/Enemy.js', import.meta.url), 'utf8');
    assert(source.includes('let navigationTargetX = player.x')
        && source.includes('let navigationTargetY = player.y')
        && source.includes('steerEnemyMovement(this, moveX, moveY, spd, obstacleSystem, dt,')
        && source.includes('navigationTargetX, navigationTargetY))'),
        'Enemy.update is not wired to the local navigator');
    assert(!source.includes('this.bossDashTimer <= 0 && this.bossWindupTimer <= 0'),
        'boss-only undefined timer gate has returned');
    assert(source.includes("this.behavior === 'summoner' || this.behavior === 'support'"),
        'ranged/support cover repositioning is not wired');
}

function validateHouseV2BidirectionalRoutes() {
    const obstacles = new ObstacleSystem();
    obstacles.generate(7200, 4050, 'emberwood');
    const structure = obstacles.structures.find((entry) => !!entry.blueprintId);
    const blueprint = getHouseBlueprint(structure?.blueprintId);
    assert(!!blueprint && !!structure, 'House V2 route fixture is missing');
    if (!blueprint || !structure) return 0;

    let routes = 0;
    for (const state of ['intact', 'lit', 'damaged', 'ruined']) {
        assert(obstacles.setStructureState(structure.id, state), `could not set House V2 ${state} state`);
        for (const room of blueprint.rooms) {
            for (const radius of [28, 44, 56]) {
                const mover = makeMover(
                    structure.x + room.x,
                    structure.y + room.y,
                    radius,
                    160,
                    radius === 44 ? -1 : 1,
                );
                const target = { x: structure.x - 110, y: structure.y + 760 };
                let reached = false;
                for (let frame = 0; frame < 20 * 60; frame++) {
                    stepMover(obstacles, mover, target);
                    assert(!obstacles.isBlocked(mover.x, mover.y, radius - 0.001),
                        `${state}/${room.id}/r${radius}: exit route entered a wall`);
                    if (!obstacles.findStructureAt(mover.x, mover.y)
                        && Math.hypot(target.x - mover.x, target.y - mover.y) < 110) {
                        reached = true;
                        break;
                    }
                }
                assert(reached, `${state}/${room.id}/r${radius}: enemy remained stuck inside House V2`);
                routes++;
            }
        }
    }

    // Ordinary ranged/support units still hold an exterior firing socket, but
    // Bellbound units with explicit interior sockets must traverse the portal.
    assert(obstacles.setStructureState(structure.id, 'lit'), 'could not relight House V2 formation fixture');
    for (const behavior of ['spitter', 'support']) {
        const room = blueprint.rooms.find((entry) => entry.id === 'hearth-kitchen');
        const target = { x: structure.x + room.x, y: structure.y + room.y };
        const mover = makeMover(structure.x - 110, structure.y - 620, 34, 160);
        mover.behavior = behavior;
        mover.ruinBellCombatSocket = { ...target };
        let reached = false;
        for (let frame = 0; frame < 18 * 60; frame++) {
            stepMover(obstacles, mover, target);
            assert(!obstacles.isBlocked(mover.x, mover.y, mover.radius - 0.001),
                `Bell ${behavior} formation route entered a wall`);
            if (Math.hypot(target.x - mover.x, target.y - mover.y) < 70) {
                reached = true;
                break;
            }
        }
        assert(reached, `Bell ${behavior} failed to occupy its authored interior socket`);
        routes++;
    }
    return routes;
}

function validateAtEnemyCap() {
    const obstacles = new ObstacleSystem();
    obstacles.generate(7200, 4050, 'crypts');
    const floors = obstacles.obstacles.filter((ob) => ob.type === 'buildingFloor');
    const movers = [];
    for (let i = 0; i < 180; i++) {
        const floor = floors[i % floors.length];
        const radius = [28, 34, 44, 50, 55, 62][i % 6];
        const starts = buildingStarts(floor, radius);
        const start = starts[(i / floors.length | 0) % 4];
        movers.push({
            body: makeMover(start[0], start[1], radius, 90 + (i % 5) * 35, i & 1 ? 1 : -1),
            target: { x: floor.x, y: floor.y },
            reached: false,
        });
    }

    let probes = 0;
    const movementBlocked = obstacles.movementBlocked.bind(obstacles);
    obstacles.movementBlocked = (...args) => { probes++; return movementBlocked(...args); };
    const startTime = performance.now();
    for (let frame = 0; frame < 10 * 60; frame++) {
        for (const item of movers) {
            if (item.reached) continue;
            stepMover(obstacles, item.body, item.target);
            assert(
                !obstacles.isBlocked(item.body.x, item.body.y, item.body.radius - 0.001),
                `180-body stress: mover entered a wall on frame ${frame}`,
            );
            if (Math.hypot(item.target.x - item.body.x, item.target.y - item.body.y) < 70) item.reached = true;
        }
    }
    const elapsed = performance.now() - startTime;
    obstacles.movementBlocked = movementBlocked;
    const reached = movers.filter((item) => item.reached).length;
    assert(reached === 180, `only ${reached}/180 stress movers reached the house interior`);
    // One direct probe is the steady-state path. The generous ceiling protects
    // against accidentally turning the fan into an unbounded/global search.
    assert(probes < 180 * 600 * 6, `navigation probe count regressed to ${probes}`);
    return { probes, elapsed };
}

const started = performance.now();
validateCollisionCore();
const routes = validateEveryHouseApproach();
validateLargeBodySiege();
validateSpawnerClearance();
validateEnemyIntegrationGate();
const bidirectionalRoutes = validateHouseV2BidirectionalRoutes();
const stress = validateAtEnemyCap();
const totalMs = performance.now() - started;

console.log(
    `navigation validation: OK — ${checks.toLocaleString()} checks, ` +
    `${routes} approach + ${bidirectionalRoutes} House V2 exit/formation routes, ` +
    `180-body stress ${stress.probes.toLocaleString()} probes ` +
    `in ${stress.elapsed.toFixed(1)}ms (${totalMs.toFixed(1)}ms total).`,
);
