#!/usr/bin/env node
// Cosmetic attachment contract gate.
//
// Keeps Blender's 182 px pose measurements, the generated browser data, and
// both runtime renderers on one frame-accurate contract. This probe is DOM-free
// so it can run quickly in Node before the browser smoke matrix.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
    applyHeroAttachmentTransform,
    heroPosePoint,
    resolveAttachmentTransform,
    resolveHeroPose,
} from '../src/assets/HeroPose.js';
import {
    HERO_POSE_ATTACHMENTS,
    HERO_POSE_FRAME_COUNTS,
} from '../src/assets/HeroPoseData.js';
import { COSMETIC_LIST } from '../src/content/cosmetics.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANCHORS_PATH = path.join(ROOT, 'tools', 'blender', 'anchors.json');
const PLAYER_PATH = path.join(ROOT, 'src', 'entities', 'Player.js');
const MENU_PATH = path.join(ROOT, 'src', 'systems', 'MenuRenderer.js');
const PIXEL_ART_PATH = path.join(ROOT, 'src', 'assets', 'PixelArt.js');

const DIRECTIONS = Object.freeze(['down', 'up', 'side']);
const FACING_BY_DIRECTION = Object.freeze({ down: 'down', up: 'up', side: 'right' });
const FRAME_COUNTS = Object.freeze({
    idle: 2,
    walk: 3,
    cast: 1,
    hurt: 1,
    death: 1,
    victory: 1,
});
const LEGACY_GRIP_STATES = Object.freeze(['idle', 'walk', 'cast', 'hurt']);
const SEGMENT_SLOTS = Object.freeze(['headSeat', 'shoulders']);
const POINT_SLOTS_PER_FRAME = 5;
const SPRITE_SIZE = 182;
const SPRITE_HALF = SPRITE_SIZE / 2;
const EPSILON = 1e-7;

let checks = 0;
let failures = 0;
let frameTotal = 0;
let pointTotal = 0;

function check(condition, message) {
    checks++;
    if (!condition) {
        failures++;
        console.error(`  x ${message}`);
    }
}

const finitePoint = (point) => Array.isArray(point)
    && point.length === 2
    && point.every(Number.isFinite);

const near = (a, b, tolerance = EPSILON) => Number.isFinite(a)
    && Number.isFinite(b)
    && Math.abs(a - b) <= tolerance;

function exactKeys(value, expected) {
    return !!value && typeof value === 'object'
        && isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
}

function validatePoint(point, label) {
    pointTotal++;
    check(finitePoint(point), `${label}: expected exactly two finite coordinates`);
    if (!finitePoint(point)) return;
    check(point.every((coordinate) => coordinate >= -SPRITE_HALF && coordinate <= SPRITE_HALF),
        `${label}: point leaves the centered ${SPRITE_SIZE} px sprite bounds`);
}

function transformPoint(matrix, point) {
    return [
        matrix.a * point[0] + matrix.c * point[1] + matrix.e,
        matrix.b * point[0] + matrix.d * point[1] + matrix.f,
    ];
}

function matrixIsFinite(matrix) {
    return ['a', 'b', 'c', 'd', 'e', 'f'].every((key) => Number.isFinite(matrix?.[key]));
}

function matrixMapsSegment(matrix, source, target) {
    const mappedLeft = transformPoint(matrix, source.left);
    const mappedRight = transformPoint(matrix, source.right);
    return near(mappedLeft[0], target.left[0])
        && near(mappedLeft[1], target.left[1])
        && near(mappedRight[0], target.right[0])
        && near(mappedRight[1], target.right[1]);
}

function mirrorSegment(segment) {
    return {
        left: [-segment.left[0], segment.left[1]],
        right: [-segment.right[0], segment.right[1]],
    };
}

let authored = null;
try {
    authored = JSON.parse(fs.readFileSync(ANCHORS_PATH, 'utf8'));
} catch (error) {
    check(false, `could not parse tools/blender/anchors.json: ${error.message}`);
}

const attachments = authored?.attachments;
check(exactKeys(attachments, DIRECTIONS),
    'anchors.json attachments must contain exactly down, up, and side directions');
check(isDeepStrictEqual(HERO_POSE_FRAME_COUNTS, FRAME_COUNTS),
    'generated frame-count constants drifted from the 2/3/1/1/1/1 contract');
check(isDeepStrictEqual(HERO_POSE_ATTACHMENTS, attachments),
    'HeroPoseData.js is stale; regenerate it from tools/blender/anchors.json');

const meta = authored?.meta;
check(meta?.spriteSize === SPRITE_SIZE, 'anchor metadata spriteSize must be 182');
check(meta?.yDownPositive === true, 'anchor metadata must declare y-down-positive coordinates');
check(meta?.attachmentSchema === 1, 'anchor metadata attachmentSchema must be 1');
check(meta?.attachmentSpace === 'sprite-offset',
    'anchor metadata attachmentSpace must be sprite-offset');
check(isDeepStrictEqual(meta?.attachmentStates, FRAME_COUNTS),
    'anchor metadata state counts drifted from the runtime frame contract');

for (const dir of DIRECTIONS) {
    const direction = attachments?.[dir];
    check(exactKeys(direction, Object.keys(FRAME_COUNTS)),
        `attachments.${dir} must contain exactly the six authored states`);
    for (const [state, expectedCount] of Object.entries(FRAME_COUNTS)) {
        const frames = direction?.[state];
        check(Array.isArray(frames) && frames.length === expectedCount,
            `attachments.${dir}.${state} must contain ${expectedCount} frame(s)`);
        if (!Array.isArray(frames)) continue;
        for (let index = 0; index < frames.length; index++) {
            frameTotal++;
            const frame = frames[index];
            const label = `attachments.${dir}.${state}[${index}]`;
            check(exactKeys(frame, ['headSeat', 'shoulders', 'handR']),
                `${label} must contain exactly headSeat, shoulders, and handR`);
            for (const slot of SEGMENT_SLOTS) {
                const segment = frame?.[slot];
                check(exactKeys(segment, ['left', 'right']),
                    `${label}.${slot} must contain exactly left and right endpoints`);
                validatePoint(segment?.left, `${label}.${slot}.left`);
                validatePoint(segment?.right, `${label}.${slot}.right`);
                if (finitePoint(segment?.left) && finitePoint(segment?.right)) {
                    check(segment.right[0] - segment.left[0] > 0,
                        `${label}.${slot} projected width must stay positive`);
                }
            }
            validatePoint(frame?.handR, `${label}.handR`);
        }
    }
}

check(frameTotal === 27, `expected exactly 27 attachment frames, found ${frameTotal}`);
check(pointTotal === 27 * POINT_SLOTS_PER_FRAME,
    `expected exactly 135 measured points, found ${pointTotal}`);

// The four historical wand-grip arrays remain a compatibility receipt. They
// must be the same measurement now consumed through each frame's handR slot.
for (const dir of DIRECTIONS) {
    for (const state of LEGACY_GRIP_STATES) {
        const legacy = authored?.[dir]?.[state];
        const current = attachments?.[dir]?.[state];
        check(Array.isArray(legacy) && legacy.length === FRAME_COUNTS[state],
            `${dir}.${state} legacy grip receipt has the wrong frame count`);
        check(Array.isArray(current) && Array.isArray(legacy)
            && isDeepStrictEqual(legacy, current.map((frame) => frame.handR)),
        `${dir}.${state} legacy grips no longer exactly match attachment.handR`);
    }
}

// Use plain objects as sprite identities: the resolver must never separate a
// sprite frame from its attachment frame or neutral pose.
const spriteDirs = {};
for (const dir of DIRECTIONS) {
    spriteDirs[dir] = {};
    for (const [state, count] of Object.entries(FRAME_COUNTS)) {
        spriteDirs[dir][state] = Array.from({ length: count }, (_, index) => ({ dir, state, index }));
    }
}
const frameSet = { kind: 'contract-probe', dirs: spriteDirs, attachments };

for (const dir of DIRECTIONS) {
    for (const [state, count] of Object.entries(FRAME_COUNTS)) {
        for (let index = 0; index < count; index++) {
            const pose = resolveHeroPose(frameSet, FACING_BY_DIRECTION[dir], state, index);
            check(pose.sprite === spriteDirs[dir][state][index],
                `${dir}.${state}[${index}] resolved the wrong sprite identity`);
            check(pose.attachments === attachments[dir][state][index],
                `${dir}.${state}[${index}] resolved anchors from a different frame`);
            check(pose.neutralAttachments === attachments[dir].idle[0],
                `${dir}.${state}[${index}] lost same-direction idle0 neutral anchors`);
            check(pose.dir === dir && pose.state === state && pose.index === index,
                `${dir}.${state}[${index}] reported a different resolved state/index`);
            check(pose.requestedState === state,
                `${dir}.${state}[${index}] lost its requested-state receipt`);
        }

        const wrappedPositive = resolveHeroPose(frameSet, FACING_BY_DIRECTION[dir], state, count + 1);
        const wrappedNegative = resolveHeroPose(frameSet, FACING_BY_DIRECTION[dir], state, -1);
        check(wrappedPositive.index === ((count + 1) % count)
            && wrappedPositive.sprite === spriteDirs[dir][state][(count + 1) % count]
            && wrappedPositive.attachments === attachments[dir][state][(count + 1) % count],
        `${dir}.${state} did not wrap a positive frame index as one sprite/anchor pair`);
        check(wrappedNegative.index === count - 1
            && wrappedNegative.sprite === spriteDirs[dir][state][count - 1]
            && wrappedNegative.attachments === attachments[dir][state][count - 1],
        `${dir}.${state} did not wrap a negative frame index as one sprite/anchor pair`);
    }

    const fallback = resolveHeroPose(frameSet, FACING_BY_DIRECTION[dir], 'not-authored', 7);
    check(fallback.state === 'idle' && fallback.index === 0
        && fallback.sprite === spriteDirs[dir].idle[0]
        && fallback.attachments === attachments[dir].idle[0]
        && fallback.neutralAttachments === attachments[dir].idle[0],
    `${dir}: unknown state did not fall back as a complete same-direction idle0 pair`);
}

const malformedFrameSet = {
    ...frameSet,
    dirs: {
        ...spriteDirs,
        down: { ...spriteDirs.down, walk: [spriteDirs.down.walk[0]] },
    },
};
const malformedFallback = resolveHeroPose(malformedFrameSet, 'down', 'walk', 2);
check(malformedFallback.state === 'idle' && malformedFallback.index === 0
    && malformedFallback.sprite === spriteDirs.down.idle[0]
    && malformedFallback.attachments === attachments.down.idle[0],
'a sprite/anchor length mismatch did not fall back both halves together');

const missingSpriteFrameSet = {
    ...frameSet,
    dirs: {
        ...spriteDirs,
        down: { ...spriteDirs.down, walk: [spriteDirs.down.walk[0], null, spriteDirs.down.walk[2]] },
    },
};
const missingSpriteFallback = resolveHeroPose(missingSpriteFrameSet, 'down', 'walk', 1);
check(missingSpriteFallback.state === 'walk' && missingSpriteFallback.index === 0
    && missingSpriteFallback.sprite === spriteDirs.down.walk[0]
    && missingSpriteFallback.attachments === attachments.down.walk[0],
'a missing sprite did not fall back to state frame zero with its matching anchors');

// Every authored segment must produce a finite similarity transform that maps
// both neutral endpoints exactly onto the current pose endpoints.
for (const dir of DIRECTIONS) {
    for (const [state, frames] of Object.entries(attachments?.[dir] ?? {})) {
        frames.forEach((frame, index) => {
            for (const slot of SEGMENT_SLOTS) {
                const neutral = attachments[dir].idle[0][slot];
                const current = frame[slot];
                const matrix = resolveAttachmentTransform(neutral, current);
                check(matrix.valid === true && matrixIsFinite(matrix),
                    `${dir}.${state}[${index}].${slot} did not resolve a finite similarity transform`);
                if (matrix.valid) {
                    check(matrixMapsSegment(matrix, neutral, current),
                        `${dir}.${state}[${index}].${slot} transform misses an endpoint`);
                }
            }
        });
    }
}

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, valid: false };
const validSegment = { left: [-1, 0], right: [1, 0] };
const degenerateSegment = { left: [2, 2], right: [2, 2] };
const nonFiniteSegment = { left: [0, 0], right: [Number.NaN, 1] };
for (const [label, neutral, current] of [
    ['degenerate neutral', degenerateSegment, validSegment],
    ['degenerate current', validSegment, degenerateSegment],
    ['non-finite input', nonFiniteSegment, validSegment],
    ['missing input', null, validSegment],
]) {
    check(isDeepStrictEqual(resolveAttachmentTransform(neutral, current), identity),
        `${label} was not rejected with a finite invalid identity`);
}

// Side art is canonical right-facing. A left-facing pose mirrors hand X once,
// leaves Y untouched, and applies a finite mirrored segment transform.
for (const [state, frames] of Object.entries(attachments?.side ?? {})) {
    frames.forEach((frame, index) => {
        const rightPose = resolveHeroPose(frameSet, 'right', state, index);
        const leftPose = resolveHeroPose(frameSet, 'left', state, index);
        const before = JSON.stringify(frame);
        const rightHand = heroPosePoint(rightPose, 'handR');
        const leftHand = heroPosePoint(leftPose, 'handR');
        check(isDeepStrictEqual(rightHand, frame.handR),
            `side.${state}[${index}] right hand changed canonical coordinates`);
        check(near(leftHand?.[0], -frame.handR[0]) && near(leftHand?.[1], frame.handR[1]),
            `side.${state}[${index}] left hand was not mirrored exactly once`);
        check(isDeepStrictEqual(heroPosePoint(leftPose, 'handR'), leftHand)
            && JSON.stringify(frame) === before,
        `side.${state}[${index}] hand mirroring mutated or compounded its source point`);

        for (const slot of SEGMENT_SLOTS) {
            let captured = null;
            const context = { transform: (...values) => { captured = values; } };
            const applied = applyHeroAttachmentTransform(context, leftPose, slot);
            check(applied === true && Array.isArray(captured)
                && captured.length === 6 && captured.every(Number.isFinite),
            `side.${state}[${index}].${slot} left transform was not applied finitely`);
            if (applied) {
                const matrix = {
                    a: captured[0], b: captured[1], c: captured[2],
                    d: captured[3], e: captured[4], f: captured[5], valid: true,
                };
                check(matrixMapsSegment(matrix,
                    mirrorSegment(leftPose.neutralAttachments[slot]),
                    mirrorSegment(leftPose.attachments[slot])),
                `side.${state}[${index}].${slot} left transform double-mirrored its seat`);
            }
        }
    });
}

// Catalog vocabulary gate: every accessory a save can equip must have an
// authored PixelArt branch (or the explicit no-hat branch).
const pixelSource = fs.readFileSync(PIXEL_ART_PATH, 'utf8');
const pixelHatStart = pixelSource.indexOf('function pixelHat(');
const pixelHatEnd = pixelSource.indexOf('function cachedCosmetic(', pixelHatStart);
const pixelHatSource = pixelSource.slice(pixelHatStart, pixelHatEnd);
const supportedHatShapes = new Set(
    [...pixelHatSource.matchAll(/shape\s*===\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
);
if (/shape\s*===\s*['"]none['"]/.test(pixelSource.slice(pixelHatEnd))) supportedHatShapes.add('none');
check(pixelHatStart >= 0 && pixelHatEnd > pixelHatStart,
    'could not locate the authored PixelArt hat vocabulary');
for (const item of COSMETIC_LIST.filter((cosmetic) => cosmetic.category === 'hat')) {
    check(typeof item.shape === 'string' && supportedHatShapes.has(item.shape),
        `${item.id} equips unsupported PixelArt hat shape "${item.shape}"`);
}

// Static wiring guards catch the original regression without needing Canvas:
// Player and every menu avatar must consume the same pose/seat/hand contract.
const playerSource = fs.readFileSync(PLAYER_PATH, 'utf8');
const menuSource = fs.readFileSync(MENU_PATH, 'utf8');

function importedNames(source) {
    const match = source.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/assets\/HeroPose\.js['"]/m);
    return new Set((match?.[1] ?? '').split(',').map((name) => name.trim()).filter(Boolean));
}

function callCount(source, name) {
    return [...source.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))].length;
}

for (const [label, source] of [['Player', playerSource], ['MenuRenderer', menuSource]]) {
    const imports = importedNames(source);
    for (const name of ['resolveHeroPose', 'applyHeroAttachmentTransform', 'heroPosePoint']) {
        check(imports.has(name), `${label} does not import ${name} from the shared HeroPose module`);
        check(callCount(source, name) >= 1, `${label} imports ${name} but does not use it`);
    }
}

check(!/\bconst\s+HAND\s*=/.test(playerSource),
    'Player reintroduced the magic per-direction HAND table');
check(!/\b31\.5\b|\b48\.2\b/.test(menuSource),
    'MenuRenderer reintroduced the historical 31.5/48.2 hand anchor literals');
check(!/castPose\s*\?\s*50(?:\.0)?\s*:\s*31\.5/.test(menuSource)
    && !/castPose\s*\?\s*11(?:\.0)?\s*:\s*48\.2/.test(menuSource),
'MenuRenderer reintroduced the historical cast/rest 50/11 hand-anchor branch');
check(!/\bcloakOx\b/.test(playerSource),
    'Player reintroduced whole-cloak cloakOx movement lag that detaches the collar');

if (failures > 0) {
    console.error(`Cosmetic attachment validation failed: ${failures}/${checks} checks failed `
        + `(${frameTotal} frames, ${pointTotal} points).`);
    process.exit(1);
}

console.log(`Cosmetic attachment validation passed: ${checks} checks, `
    + `${frameTotal} frames, ${pointTotal} finite in-bounds points.`);
