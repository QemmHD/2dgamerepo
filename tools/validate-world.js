#!/usr/bin/env node
// Deterministic biome-dressing + structure-cohesion gate. Runs without a DOM:
// it exercises the real chunk catalog and obstacle generator, while statically
// verifying that every declared visual prop has a procedural fallback.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP, WORLD_HEIGHT, WORLD_WIDTH } from '../src/config/GameConfig.js';
import { MAP_ORDER, getMap } from '../src/content/maps.js';
import {
    BIOME_THEME, MAP_OBJECTS, MAP_STRUCTURES, STRUCTURE_PLACEMENT,
} from '../src/content/mapObjects.js';
import {
    getHouseBlueprint,
    houseWallActive,
} from '../src/content/houseBlueprints.js';
import { MapRenderer } from '../src/systems/MapRenderer.js';
import { ObstacleSystem } from '../src/systems/ObstacleSystem.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'src/assets/ProceduralSprites.js'), 'utf8');
const MOTIFS = new Set([
    'leafBed', 'rootTrail', 'mossRing',
    'snowDrift', 'iceCrack', 'frostHalo',
    'flagstones', 'graveSoil', 'runeCircle',
    'duneRipples', 'scrubPatch', 'fossilTrace',
]);
const WEATHER = new Set(['embers', 'snow', 'cryptDust', 'sandGust']);
const SIGNATURES = {
    emberwood: ['fern', 'wildflower'],
    hollowreach: ['iceShard', 'snowTuft'],
    crypts: ['urn', 'runeStone'],
    dunes: ['dryTuft', 'sunStone'],
};
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

let failures = 0;
let checks = 0;
const ok = (condition, message) => {
    checks++;
    if (!condition) {
        failures++;
        console.error(`  x ${message}`);
    }
};

const finitePositive = (value) => Number.isFinite(value) && value > 0;
const sum = (values) => values.reduce((total, value) => total + value, 0);

// Compare authored probability profiles, not generated chunk fingerprints.
// Biome ids intentionally perturb chunk RNG, so output alone would let two
// identical weight tables masquerade as distinct themes.
function normalizedVector(weights, universe) {
    const total = sum(Object.values(weights || {}));
    return universe.map((type) => (weights?.[type] || 0) / total);
}

function l1Distance(a, b) {
    let distance = 0;
    for (let i = 0; i < a.length; i++) distance += Math.abs(a[i] - b[i]);
    return distance;
}

function obstacleSignature(obstacles) {
    return obstacles.map((ob) => {
        const c = ob.def.col || {};
        return [
            ob.type, ob.structureId || '-', ob.def.styleType || '-',
            ob.x, ob.y, ob.baseY, ob.shape,
            c.hw ?? '-', c.hh ?? '-', c.r ?? '-',
            !!ob.def.decorative, ob.def.blocksLOS !== false,
        ].join(':');
    }).join('|');
}

function structureSignature(structures) {
    return structures.map((s) => [
        s.id, s.styleType, s.x, s.y, s.interiorW, s.interiorH,
        s.wall, s.wallH, s.door, s.rearBaseY, s.frontBaseY, s.visualSeed,
        s.variant, s.mirror, s.wear,
    ].join(':')).join('|');
}

function validateStructureContract(mapId, obstacles, structures) {
    const prefix = `${mapId} structures`;
    const ids = structures.map((structure) => structure.id);
    const idSet = new Set(ids);
    const buildingPieces = obstacles.filter((ob) => ob.type === 'buildingWall' || ob.type === 'buildingFloor');
    const ownedPieces = obstacles.filter((ob) => !!ob.structureId);
    const allowedStyles = new Set(BIOME_THEME[mapId]?.structures || []);
    const featuredStyle = BIOME_THEME[mapId]?.featuredStructure || null;
    const featuredBlueprintId = MAP_STRUCTURES[featuredStyle]?.blueprintId || null;

    ok(structures.length === STRUCTURE_PLACEMENT.count,
        `${prefix}: expected ${STRUCTURE_PLACEMENT.count} records, found ${structures.length}`);
    ok(idSet.size === structures.length, `${prefix}: structure ids are not unique`);
    ok(ids.every((id) => typeof id === 'string' && id.length > 0), `${prefix}: missing structure id`);
    ok(structures.every((s, i) => i === 0 || structures[i - 1].frontBaseY <= s.frontBaseY),
        `${prefix}: records are not sorted by frontBaseY`);
    ok(buildingPieces.every((ob) => idSet.has(ob.structureId)),
        `${prefix}: building piece has missing/unknown ownership`);
    ok(ownedPieces.every((ob) => ['buildingWall', 'buildingFloor', 'buildingFurnishing'].includes(ob.type)),
        `${prefix}: unsupported obstacle carries structure ownership`);
    for (const style of allowedStyles) {
        ok(structures.some((structure) => structure.styleType === style),
            `${prefix}: eligible style ${style} never appears in the deterministic layout`);
    }
    if (featuredBlueprintId) {
        ok(structures.filter((structure) => structure.blueprintId === featuredBlueprintId).length === 1,
            `${prefix}: featured blueprint ${featuredBlueprintId} must appear exactly once`);
    }

    for (const structure of structures) {
        const label = `${mapId} ${structure.id}`;
        const blueprint = getHouseBlueprint(structure.blueprintId);
        const style = blueprint
            ? MAP_STRUCTURES[featuredStyle]
            : MAP_STRUCTURES[structure.styleType];
        const owned = ownedPieces.filter((ob) => ob.structureId === structure.id);
        const walls = owned.filter((ob) => ob.type === 'buildingWall');
        const floors = owned.filter((ob) => ob.type === 'buildingFloor');
        const furnishings = owned.filter((ob) => ob.type === 'buildingFurnishing');
        const floor = floors[0];

        ok(!!style, `${label}: unknown style ${structure.styleType}`);
        ok(allowedStyles.has(structure.styleType), `${label}: style is not allowed by ${mapId}`);
        const expectedOwned = blueprint
            ? blueprint.walls.length + blueprint.furniture.length + 1
            : 7;
        const expectedWalls = blueprint ? blueprint.walls.length : 6;
        ok(owned.length === expectedOwned,
            `${label}: expected ${expectedOwned} owned pieces, found ${owned.length}`);
        ok(walls.length === expectedWalls,
            `${label}: expected ${expectedWalls} owned walls, found ${walls.length}`);
        ok(floors.length === 1, `${label}: expected 1 owned floor, found ${floors.length}`);
        ok(furnishings.length === (blueprint?.furniture.length ?? 0),
            `${label}: furnishing count differs from blueprint`);
        ok(owned.every((ob) => ob.def.styleType === structure.styleType),
            `${label}: owned piece style does not match record`);
        ok(walls.every((wall) => wall.def.blocksLOS === true && !wall.def.decorative),
            `${label}: wall collision/LOS contract drifted`);
        ok(!floor || (floor.def.decorative === true && floor.def.blocksLOS === false),
            `${label}: floor must remain visual-only`);
        ok(Number.isFinite(structure.x) && Number.isFinite(structure.y), `${label}: non-finite center`);

        if (!style || !floor) continue;

        const dimensions = blueprint?.dimensions || style;
        ok(structure.interiorW === dimensions.interiorW
            && structure.interiorH === dimensions.interiorH
            && structure.wall === dimensions.wall
            && structure.wallH === dimensions.wallH
            && structure.door === (dimensions.mainDoor ?? dimensions.door),
        `${label}: record geometry does not match its style blueprint`);
        ok(floor.x === structure.x && floor.y === structure.y,
            `${label}: floor center does not match structure center`);
        ok(floor.def.col.hw === structure.interiorW / 2
            && floor.def.col.hh === structure.interiorH / 2,
        `${label}: floor footprint does not match interior metadata`);

        if (blueprint) {
            ok(structure.blueprint === blueprint && structure.blueprintVersion === blueprint.version,
                `${label}: runtime blueprint/version identity drifted`);
            ok(structure.state === 'intact', `${label}: generated House V2 must start intact`);
            ok(structure.poiReservation === blueprint.encounter?.id,
                `${label}: featured encounter reservation drifted`);
            ok(structure.wallParts === blueprint.walls
                && structure.doors === blueprint.doors
                && structure.rooms === blueprint.rooms,
            `${label}: renderer/navigation arrays are not shared blueprint truth`);
            ok(walls.every((entry) => {
                const def = blueprint.walls.find((part) => part.id === entry.wallId);
                return !!def
                    && entry.x === structure.x + def.x
                    && entry.y === structure.y + def.y
                    && entry.def.col.hw === def.hw
                    && entry.def.col.hh === def.hh
                    && entry.active === houseWallActive(blueprint, def, structure.state);
            }), `${label}: authored wall id/geometry/state drifted`);
            ok(furnishings.every((entry) => {
                const def = blueprint.furniture.find((item) => item.id === entry.furnitureId);
                return !!def && entry.x === structure.x + def.x && entry.y === structure.y + def.y;
            }), `${label}: furnishing id/placement drifted`);
            ok(Array.isArray(structure.spawnExclusions)
                && structure.spawnExclusions === blueprint.spawnExclusions,
            `${label}: spawn exclusions are not shared blueprint truth`);
            ok(structure.roofCutaway === blueprint.roofCutaway,
                `${label}: roof cutaway is not shared blueprint truth`);
            continue;
        }

        const iHW = structure.interiorW / 2;
        const iHH = structure.interiorH / 2;
        const half = structure.wall / 2;
        const spanHW = iHW + structure.wall;
        const dHalf = structure.door / 2;
        const segHW = (spanHW - dHalf) / 2;
        const leftX = structure.x - (dHalf + spanHW) / 2;
        const rightX = structure.x + (dHalf + spanHW) / 2;
        const northY = structure.y - iHH - half;
        const southY = structure.y + iHH + half;
        const westX = structure.x - iHW - half;
        const eastX = structure.x + iHW + half;

        const matches = (wall, x, y, hw, hh) => wall.x === x && wall.y === y
            && wall.def.col.hw === hw && wall.def.col.hh === hh;
        const expectedLegacyWalls = [
            [leftX, northY, segHW, half], [rightX, northY, segHW, half],
            [leftX, southY, segHW, half], [rightX, southY, segHW, half],
            [westX, structure.y, half, iHH], [eastX, structure.y, half, iHH],
        ];
        for (const [x, y, hw, hh] of expectedLegacyWalls) {
            ok(walls.filter((wall) => matches(wall, x, y, hw, hh)).length === 1,
                `${label}: missing/duplicate wall at ${x.toFixed(1)},${y.toFixed(1)}`);
        }

        for (const [side, y] of [['north', northY], ['south', southY]]) {
            const pair = walls.filter((wall) => wall.y === y && wall.def.col.hh === half)
                .sort((a, b) => a.x - b.x);
            ok(pair.length === 2, `${label}: ${side} doorway must split exactly two wall segments`);
            if (pair.length === 2) {
                const gapLeft = pair[0].x + pair[0].def.col.hw;
                const gapRight = pair[1].x - pair[1].def.col.hw;
                ok(gapRight - gapLeft === structure.door,
                    `${label}: ${side} doorway gap differs from metadata`);
                ok((gapLeft + gapRight) / 2 === structure.x,
                    `${label}: ${side} doorway is not centered on the structure`);
            }
        }

        const expectedRearBaseY = structure.y - iHH;
        const expectedFrontBaseY = structure.y + iHH + structure.wall;
        ok(structure.rearBaseY === expectedRearBaseY, `${label}: rearBaseY formula drifted`);
        ok(structure.frontBaseY === expectedFrontBaseY, `${label}: frontBaseY formula drifted`);
        const frontWalls = walls.filter((wall) => wall.y === southY);
        ok(frontWalls.length === 2 && frontWalls.every((wall) => wall.baseY === structure.frontBaseY),
            `${label}: front wall baselines do not equal frontBaseY`);
    }
}

const declaredTypes = new Set(MAP.decorationTypes);
for (const type of declaredTypes) {
    ok(source.includes(`case '${type}'`), `${type}: missing procedural decoration fallback`);
}

const dressingUniverse = [...declaredTypes].sort();
const obstacleUniverse = Object.keys(MAP_OBJECTS).sort();
const dressingProfiles = new Map();
const obstacleProfiles = new Map();
const motifProfiles = new Map();
const weatherProfiles = new Set();
let generatedChunks = 0;
const started = performance.now();

for (const mapId of MAP_ORDER) {
    const theme = getMap(mapId);
    const dressing = theme.dressing;
    const obstacleTheme = BIOME_THEME[mapId];
    const density = dressing?.density || [];
    const weights = dressing?.weights || {};
    const motifs = Array.isArray(dressing?.motifs) ? dressing.motifs : [];

    ok(theme.id === mapId, `${mapId}: map id does not match registry key`);
    ok(!!dressing, `${mapId}: missing dressing profile`);
    ok(!!obstacleTheme, `${mapId}: missing obstacle theme`);
    ok(Array.isArray(density) && density.length === 2, `${mapId}: invalid density range`);
    ok(density.every(Number.isFinite), `${mapId}: density contains a non-finite value`);
    ok(density.every(Number.isInteger), `${mapId}: density must use whole prop counts`);
    ok((density[0] ?? 0) >= 3 && (density[0] ?? Infinity) <= (density[1] ?? -Infinity),
        `${mapId}: invalid/sparse density minimum`);
    ok((density[1] ?? Infinity) <= 12, `${mapId}: scenery density exceeds the draw budget`);
    ok(Number.isFinite(dressing?.clusterChance)
        && dressing.clusterChance >= 0 && dressing.clusterChance <= 1,
    `${mapId}: clusterChance must be finite and within 0..1`);
    ok(WEATHER.has(theme.weather), `${mapId}: unknown weather ${theme.weather}`);
    ok(!weatherProfiles.has(theme.weather), `${mapId}: weather duplicates another biome`);
    weatherProfiles.add(theme.weather);
    ok(Object.keys(weights).length >= 5, `${mapId}: dressing profile lacks variety`);
    ok(Object.entries(weights).every(([type, weight]) => declaredTypes.has(type) && finitePositive(weight)),
        `${mapId}: dressing weights must reference declared props and be positive finite numbers`);
    ok(motifs.length === 3
        && new Set(motifs).size === motifs.length
        && motifs.every((motif) => MOTIFS.has(motif)),
    `${mapId}: motif profile must contain three unique known motifs`);
    ok([dressing?.ground, dressing?.accent, dressing?.detail].every((color) => HEX_COLOR.test(color || '')),
        `${mapId}: dressing colors must be six-digit hex values`);

    for (const type of SIGNATURES[mapId] || []) {
        ok(finitePositive(weights[type]), `${mapId}: signature prop ${type} is not positively weighted`);
    }

    const dressingVector = normalizedVector(weights, dressingUniverse);
    ok(dressingVector.every(Number.isFinite) && Math.abs(sum(dressingVector) - 1) < 1e-12,
        `${mapId}: dressing weights do not normalize to a finite probability profile`);
    for (const [otherId, otherVector] of dressingProfiles) {
        ok(l1Distance(dressingVector, otherVector) >= 0.25,
            `${mapId}: normalized dressing profile is not materially distinct from ${otherId}`);
    }
    dressingProfiles.set(mapId, dressingVector);

    const propWeights = obstacleTheme?.props || {};
    ok(Object.entries(propWeights).length >= 5, `${mapId}: obstacle theme lacks prop variety`);
    ok(Object.entries(propWeights).every(([type, weight]) => !!MAP_OBJECTS[type] && finitePositive(weight)),
        `${mapId}: obstacle weights must reference known props and be positive finite numbers`);
    ok(Number.isFinite(obstacleTheme?.tint?.amt)
        && obstacleTheme.tint.amt >= 0 && obstacleTheme.tint.amt <= 1
        && HEX_COLOR.test(obstacleTheme?.tint?.color || ''),
    `${mapId}: obstacle tint is invalid`);
    ok(Array.isArray(obstacleTheme?.structures) && obstacleTheme.structures.length > 0
        && new Set(obstacleTheme.structures).size === obstacleTheme.structures.length
        && obstacleTheme.structures.every((style) => !!MAP_STRUCTURES[style]),
    `${mapId}: obstacle theme references an invalid/duplicate structure style`);
    const obstacleVector = normalizedVector(propWeights, obstacleUniverse);
    ok(obstacleVector.every(Number.isFinite) && Math.abs(sum(obstacleVector) - 1) < 1e-12,
        `${mapId}: obstacle weights do not normalize to a finite probability profile`);
    for (const [otherId, otherVector] of obstacleProfiles) {
        ok(l1Distance(obstacleVector, otherVector) >= 0.25,
            `${mapId}: normalized obstacle profile is not materially distinct from ${otherId}`);
    }
    obstacleProfiles.set(mapId, obstacleVector);
    const motifFingerprint = [...motifs].sort().join('|');
    ok(!motifProfiles.has(motifFingerprint),
        `${mapId}: motif profile duplicates ${motifProfiles.get(motifFingerprint)}`);
    motifProfiles.set(motifFingerprint, mapId);

    const a = new MapRenderer();
    const b = new MapRenderer();
    a.theme = theme;
    b.theme = theme;
    const used = new Set();
    for (let cy = -3; cy <= 3; cy++) {
        for (let cx = -5; cx <= 5; cx++) {
            const ca = a._getChunkDecorations(cx, cy);
            const cb = b._getChunkDecorations(cx, cy);
            generatedChunks++;
            ok(JSON.stringify(ca) === JSON.stringify(cb), `${mapId} ${cx},${cy}: chunk generation is not deterministic`);
            ok(ca.decs.length >= density[0] && ca.decs.length <= density[1], `${mapId} ${cx},${cy}: density outside profile`);
            ok(ca.motifs.length >= 1 && ca.motifs.length <= 2, `${mapId} ${cx},${cy}: motif budget violated`);
            for (const dec of ca.decs) {
                used.add(dec.type);
                ok(Object.hasOwn(weights, dec.type), `${mapId}: generated prop ${dec.type} outside authored profile`);
                ok(Number.isFinite(dec.x) && Number.isFinite(dec.y)
                    && Number.isFinite(dec.scale) && Number.isFinite(dec.rot),
                `${mapId}: non-finite decoration transform`);
            }
            for (const motif of ca.motifs) {
                ok(motifs.includes(motif.type), `${mapId}: generated motif ${motif.type} outside authored profile`);
                ok(motif.ground === dressing?.ground
                    && motif.accent === dressing?.accent
                    && motif.detail === dressing?.detail,
                `${mapId}: motif palette drifted from dressing profile`);
            }
        }
    }
    for (const type of SIGNATURES[mapId] || []) {
        ok(used.has(type), `${mapId}: signature prop ${type} never appears in sampled chunks`);
    }

    const system = new ObstacleSystem();
    const first = system.generate(WORLD_WIDTH, WORLD_HEIGHT, mapId);
    const firstStructures = system.structures.slice();
    validateStructureContract(mapId, first, firstStructures);
    const firstObstacleSig = obstacleSignature(first);
    const firstStructureSig = structureSignature(firstStructures);

    const second = system.generate(WORLD_WIDTH, WORLD_HEIGHT, mapId);
    ok(firstObstacleSig === obstacleSignature(second),
        `${mapId}: obstacle positions/ownership drifted on same-instance regeneration`);
    ok(firstStructureSig === structureSignature(system.structures),
        `${mapId}: structure registry drifted on same-instance regeneration`);

    const independent = new ObstacleSystem();
    const third = independent.generate(WORLD_WIDTH, WORLD_HEIGHT, mapId);
    ok(firstObstacleSig === obstacleSignature(third),
        `${mapId}: obstacle positions/ownership differ across instances`);
    ok(firstStructureSig === structureSignature(independent.structures),
        `${mapId}: structure registry differs across instances`);
    ok(first.length <= 240, `${mapId}: obstacle cap exceeded (${first.length})`);
}

// Same-renderer A -> B -> A transition: each switch must evict the old biome,
// while returning to A must rebuild exactly the original deterministic chunk.
for (let i = 0; i < MAP_ORDER.length; i++) {
    const aId = MAP_ORDER[i];
    const bId = MAP_ORDER[(i + 1) % MAP_ORDER.length];
    const cx = i - 2;
    const cy = 2 - i;
    const renderer = new MapRenderer();
    renderer.theme = getMap(aId);
    const firstA = renderer._getChunkDecorations(cx, cy);
    const firstASig = JSON.stringify(firstA);
    ok(renderer._getChunkDecorations(cx, cy) === firstA, `${aId}: same-biome chunk was not served from cache`);
    ok(renderer.chunkCache.size === 1 && renderer.chunkCache.has(`${aId}:${cx},${cy}`),
        `${aId}: cache key does not own its biome`);

    renderer.theme = getMap(bId);
    renderer._getChunkDecorations(cx, cy);
    ok(renderer.chunkCache.size === 1
        && renderer.chunkCache.has(`${bId}:${cx},${cy}`)
        && !renderer.chunkCache.has(`${aId}:${cx},${cy}`),
    `${aId}->${bId}: biome switch did not evict the old chunk cache`);

    renderer.theme = getMap(aId);
    const secondA = renderer._getChunkDecorations(cx, cy);
    ok(JSON.stringify(secondA) === firstASig, `${aId}->${bId}->${aId}: rebuilt chunk is not deterministic`);
    ok(secondA !== firstA, `${aId}->${bId}->${aId}: stale A chunk survived both cache switches`);
    ok(renderer.chunkCache.size === 1
        && renderer.chunkCache.has(`${aId}:${cx},${cy}`)
        && !renderer.chunkCache.has(`${bId}:${cx},${cy}`),
    `${aId}->${bId}->${aId}: return switch retained the B cache`);
}

// Unknown/legacy themes retain the generic catalog rather than throwing.
const fallback = new MapRenderer();
fallback.theme = { id: 'unknown', weather: 'embers' };
const fallbackChunk = fallback._getChunkDecorations(0, 0);
ok(fallbackChunk.decs.length >= MAP.decorationsPerChunkMin, 'generic decoration fallback is empty');
ok(fallbackChunk.decs.every((dec) => declaredTypes.has(dec.type)), 'generic fallback generated an undeclared prop');

// Dressing masks keep walk-through scenery off authored floors and both real
// door routes, but must not erase unrelated world space.
const exclusionProbe = new MapRenderer();
exclusionProbe.setStructureExclusions([{
    x: 100, y: 200, interiorW: 300, interiorH: 240, wall: 32, door: 140,
}]);
ok(exclusionProbe._insideStructureExclusion(100, 200, 30, 150),
    'structure interior is not excluded from standing scenery');
ok(exclusionProbe._insideStructureExclusion(100, -70, 30, 150)
    && exclusionProbe._insideStructureExclusion(100, 470, 30, 150),
'north/south doorway approaches are not both excluded');
ok(!exclusionProbe._insideStructureExclusion(520, 200, 30, 150),
    'structure exclusion mask spills into unrelated world space');

const elapsed = performance.now() - started;
ok(elapsed < 1000, `world catalog validation is unexpectedly slow (${elapsed.toFixed(1)}ms)`);

if (failures) {
    console.error(`World validation failed: ${failures}/${checks} checks`);
    process.exit(1);
}
console.log(`World validation OK: ${checks.toLocaleString()} checks, ${generatedChunks} biome chunks, ${elapsed.toFixed(1)}ms`);
