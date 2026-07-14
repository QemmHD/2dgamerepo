#!/usr/bin/env node
// Cosmetic attachment contract gate.
//
// Keeps Blender's 182 px pose measurements, the generated browser data, and
// both runtime renderers on one frame-accurate contract. This probe is DOM-free
// so it can run quickly in Node before the browser smoke matrix.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import zlib from 'node:zlib';

import {
    applyHeroAttachmentTransform,
    heroPosePoint,
    resolveAttachmentTransform,
    resolveHeroPose,
} from '../src/assets/HeroPose.js';
import {
    HERO_POSE_ATTACHMENTS,
    HERO_POSE_ATTACHMENTS_BY_HERO,
    HERO_POSE_FRAME_COUNTS,
} from '../src/assets/HeroPoseData.js';
import { AURA_FX_STYLES, TRAIL_FX_STYLES } from '../src/assets/CosmeticFx.js';
import { COSMETIC_LIST } from '../src/content/cosmetics.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLENDER_DIR = path.join(ROOT, 'tools', 'blender');
const HERO_ASSET_DIR = path.join(ROOT, 'src', 'assets', 'hero');
const HERO_MANIFEST_PATH = path.join(HERO_ASSET_DIR, 'hero-install-manifest.json');
const PLAYER_PATH = path.join(ROOT, 'src', 'entities', 'Player.js');
const MENU_PATH = path.join(ROOT, 'src', 'systems', 'MenuRenderer.js');
const HERO_AI_PATH = path.join(ROOT, 'src', 'assets', 'HeroAiSprites.js');
const PROCEDURAL_PATH = path.join(ROOT, 'src', 'assets', 'ProceduralSprites.js');
const PIXEL_ART_PATH = path.join(ROOT, 'src', 'assets', 'PixelArt.js');
const COSMETIC_FX_PATH = path.join(ROOT, 'src', 'assets', 'CosmeticFx.js');

const DIRECTIONS = Object.freeze(['down', 'up', 'side']);
const HERO_IDS = Object.freeze(['monkey', 'elf', 'orc', 'wizard', 'berserker', 'assassin']);
const PIXELATION_OPTIONS = Object.freeze({ cell: 256, logical: 96, colors: 32, outline: 1 });
const OUTLINE_RGBA = '10,13,20,217';
const ALLOWED_ALPHA_VALUES = Object.freeze([0, 217, 255]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
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
const REQUIRED_CLOAK_STYLES = Object.freeze(['classic', 'splitwatch', 'mothwing']);
const REQUIRED_HEAD_SHAPES = Object.freeze(['waylantern', 'mothmask']);
const REQUIRED_AURA_FX = Object.freeze(['oathwheel', 'gloam_moths']);
const REQUIRED_TRAIL_FX = Object.freeze(['waymarks', 'gloam_wisps']);
const POINT_SLOTS_PER_FRAME = 5;
const SPRITE_SIZE = 182;
const SPRITE_HALF = SPRITE_SIZE / 2;
const EPSILON = 1e-7;

let checks = 0;
let failures = 0;
let frameTotal = 0;
let pointTotal = 0;
let collectionAttachmentTotal = 0;

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

let installManifest = null;
try {
    installManifest = JSON.parse(fs.readFileSync(HERO_MANIFEST_PATH, 'utf8'));
} catch (error) {
    check(false, `could not parse src/assets/hero/hero-install-manifest.json: ${error.message}`);
}

const expectedManifestIdentities = HERO_IDS.flatMap((heroId) => DIRECTIONS.map((direction) => ({
    heroId,
    direction,
    path: `src/assets/hero/${heroId}_${direction}.png`,
})));
check(exactKeys(installManifest, ['schemaVersion', 'generator', 'pixelation', 'sheets']),
    'hero install manifest must expose exactly schemaVersion, generator, pixelation, and sheets');
check(installManifest?.schemaVersion === 1, 'hero install manifest schemaVersion must be 1');
check(installManifest?.generator === 'tools/generate-hero-install-manifest.js',
    'hero install manifest must name its deterministic generator');
check(isDeepStrictEqual(installManifest?.pixelation, PIXELATION_OPTIONS),
    'hero install manifest pixelation options must remain cell=256, logical=96, colors=32, outline=1');
check(Array.isArray(installManifest?.sheets) && installManifest.sheets.length === 18,
    'hero install manifest must contain exactly 18 installed sheets');
check(isDeepStrictEqual(
    installManifest?.sheets?.map(({ heroId, direction, path: sheetPath }) => ({
        heroId, direction, path: sheetPath,
    })),
    expectedManifestIdentities,
), 'hero install manifest identities/order must cover every hero and direction exactly once');
for (const entry of installManifest?.sheets ?? []) {
    check(exactKeys(entry, ['heroId', 'direction', 'path', 'sha256']),
        `${entry?.path ?? 'unknown sheet'} manifest entry has unexpected or missing fields`);
    check(SHA256_PATTERN.test(entry?.sha256 ?? ''),
        `${entry?.path ?? 'unknown sheet'} manifest hash must be lowercase SHA-256`);
}
const manifestByPath = new Map(
    (installManifest?.sheets ?? []).map((entry) => [entry.path, entry]),
);

function decodeHeroSheet(filePath) {
    const png = fs.readFileSync(filePath);
    check(png.length > 1024, `${path.basename(filePath)} is implausibly small or empty`);
    check(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        `${path.basename(filePath)} is not a PNG`);
    let offset = 8;
    let width = 0;
    let height = 0;
    let channels = 0;
    const idat = [];
    while (offset + 12 <= png.length) {
        const length = png.readUInt32BE(offset);
        const type = png.toString('ascii', offset + 4, offset + 8);
        const data = png.subarray(offset + 8, offset + 8 + length);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            check(data[8] === 8 && data[9] === 6 && data[12] === 0,
                `${path.basename(filePath)} must be 8-bit, non-interlaced RGBA`);
            channels = data[9] === 6 ? 4 : 0;
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }
        offset += length + 12;
    }
    check(width === 2304 && height === 256,
        `${path.basename(filePath)} must remain a 9 x 256px sheet (found ${width}x${height})`);
    check(idat.length > 0, `${path.basename(filePath)} has no image payload`);
    if (!channels || !idat.length || width !== 2304 || height !== 256) return null;

    const packed = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const previous = new Uint8Array(stride);
    const current = new Uint8Array(stride);
    const cellOpaque = Array(9).fill(0);
    const opaquePalette = new Set();
    const visiblePalette = new Set();
    const alphaValues = new Set();
    const translucentPalette = new Set();
    const paeth = (a, b, c) => {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    let cursor = 0;
    for (let y = 0; y < height; y++) {
        const filter = packed[cursor++];
        for (let x = 0; x < stride; x++) {
            const raw = packed[cursor++];
            const left = x >= channels ? current[x - channels] : 0;
            const up = previous[x];
            const upLeft = x >= channels ? previous[x - channels] : 0;
            let value = raw;
            if (filter === 1) value += left;
            else if (filter === 2) value += up;
            else if (filter === 3) value += (left + up) >> 1;
            else if (filter === 4) value += paeth(left, up, upLeft);
            else if (filter !== 0) throw new Error(`${path.basename(filePath)} uses invalid PNG filter ${filter}`);
            current[x] = value & 0xff;
        }
        for (let x = 0; x < width; x++) {
            const pixel = x * channels;
            const alpha = current[pixel + 3];
            alphaValues.add(alpha);
            if (alpha > 0) {
                const rgba = `${current[pixel]},${current[pixel + 1]},${current[pixel + 2]},${alpha}`;
                visiblePalette.add(rgba);
                if (alpha === 255) {
                    opaquePalette.add(`${current[pixel]},${current[pixel + 1]},${current[pixel + 2]}`);
                } else {
                    translucentPalette.add(rgba);
                }
            }
            if (alpha > 8) cellOpaque[Math.floor(x / 256)]++;
        }
        previous.set(current);
    }
    return {
        cellOpaque,
        sha256: crypto.createHash('sha256').update(png).digest('hex'),
        opaquePalette,
        visiblePalette,
        alphaValues: [...alphaValues].sort((a, b) => a - b),
        translucentPalette,
    };
}

for (const heroId of HERO_IDS) {
    for (const direction of DIRECTIONS) {
        const filename = `${heroId}_${direction}.png`;
        const manifestPath = `src/assets/hero/${filename}`;
        try {
            const decoded = decodeHeroSheet(path.join(HERO_ASSET_DIR, filename));
            decoded?.cellOpaque.forEach((count, index) => check(count >= 500,
                `${filename} frame ${index} is blank or lost its body silhouette (${count} opaque pixels)`));
            check(manifestByPath.get(manifestPath)?.sha256 === decoded?.sha256,
                `${filename} bytes drifted from the generated install manifest`);
            check(decoded?.opaquePalette.size > 0
                && decoded.opaquePalette.size <= PIXELATION_OPTIONS.colors,
            `${filename} must contain 1..${PIXELATION_OPTIONS.colors} opaque palette colors `
                + `(found ${decoded?.opaquePalette.size ?? 0})`);
            check(decoded?.visiblePalette.size <= PIXELATION_OPTIONS.colors + PIXELATION_OPTIONS.outline,
                `${filename} exceeds the 33-color visible palette contract `
                + `(found ${decoded?.visiblePalette.size ?? 0})`);
            check(isDeepStrictEqual(decoded?.alphaValues, ALLOWED_ALPHA_VALUES),
                `${filename} alpha values must be exactly transparent, canonical outline, and opaque`);
            check(decoded?.translucentPalette.size === 1
                && decoded.translucentPalette.has(OUTLINE_RGBA),
            `${filename} must use only the canonical #0a0d14/85% outline outside opaque pixels`);
        } catch (error) {
            check(false, `${filename} could not be decoded: ${error.message}`);
        }
    }
}

const authoredByHero = {};
for (const heroId of HERO_IDS) {
    const filename = heroId === 'monkey' ? 'anchors.json' : `${heroId}_anchors.json`;
    try {
        authoredByHero[heroId] = JSON.parse(fs.readFileSync(path.join(BLENDER_DIR, filename), 'utf8'));
    } catch (error) {
        check(false, `could not parse tools/blender/${filename}: ${error.message}`);
    }
}

const authored = authoredByHero.monkey;
const attachments = authored?.attachments;
check(isDeepStrictEqual(HERO_POSE_FRAME_COUNTS, FRAME_COUNTS),
    'generated frame-count constants drifted from the 2/3/1/1/1/1 contract');
check(exactKeys(HERO_POSE_ATTACHMENTS_BY_HERO, HERO_IDS),
    'generated pose data must contain exactly the six shipped Blender heroes');

for (const heroId of HERO_IDS) {
    const heroAuthored = authoredByHero[heroId];
    const heroAttachments = heroAuthored?.attachments;
    check(exactKeys(heroAttachments, DIRECTIONS),
        `${heroId} attachments must contain exactly down, up, and side directions`);
    check(isDeepStrictEqual(HERO_POSE_ATTACHMENTS_BY_HERO?.[heroId], heroAttachments),
        `HeroPoseData.js ${heroId} tree is stale; regenerate it from Blender exports`);

    const meta = heroAuthored?.meta;
    check(meta?.heroId === heroId, `${heroId} metadata heroId must match its receipt filename`);
    check(SHA256_PATTERN.test(meta?.presetSha256 ?? ''),
        `${heroId} metadata presetSha256 must be a lowercase SHA-256`);
    check(meta?.spriteSize === SPRITE_SIZE, `${heroId} metadata spriteSize must be 182`);
    check(meta?.yDownPositive === true, `${heroId} metadata must declare y-down-positive coordinates`);
    check(meta?.attachmentSchema === 1, `${heroId} metadata attachmentSchema must be 1`);
    check(meta?.attachmentSpace === 'sprite-offset',
        `${heroId} metadata attachmentSpace must be sprite-offset`);
    check(isDeepStrictEqual(meta?.attachmentStates, FRAME_COUNTS),
        `${heroId} metadata state counts drifted from the runtime frame contract`);

    for (const dir of DIRECTIONS) {
        const direction = heroAttachments?.[dir];
        check(exactKeys(direction, Object.keys(FRAME_COUNTS)),
            `${heroId}.attachments.${dir} must contain exactly the six authored states`);
        for (const [state, expectedCount] of Object.entries(FRAME_COUNTS)) {
            const frames = direction?.[state];
            check(Array.isArray(frames) && frames.length === expectedCount,
                `${heroId}.attachments.${dir}.${state} must contain ${expectedCount} frame(s)`);
            if (!Array.isArray(frames)) continue;
            for (let index = 0; index < frames.length; index++) {
                frameTotal++;
                const frame = frames[index];
                const label = `${heroId}.attachments.${dir}.${state}[${index}]`;
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

    // Each export keeps its own legacy GRIP arrays as a reproducibility receipt.
    for (const dir of DIRECTIONS) {
        for (const state of LEGACY_GRIP_STATES) {
            const legacy = heroAuthored?.[dir]?.[state];
            const current = heroAttachments?.[dir]?.[state];
            check(Array.isArray(legacy) && legacy.length === FRAME_COUNTS[state],
                `${heroId}.${dir}.${state} legacy grip receipt has the wrong frame count`);
            check(Array.isArray(current) && Array.isArray(legacy)
                && isDeepStrictEqual(legacy, current.map((frame) => frame.handR)),
            `${heroId}.${dir}.${state} legacy grips no longer match attachment.handR`);
        }
    }
}

check(isDeepStrictEqual(HERO_POSE_ATTACHMENTS, attachments),
    'the compatibility attachment alias must remain the monkey-base tree');
check(frameTotal === HERO_IDS.length * 27,
    `expected exactly ${HERO_IDS.length * 27} attachment frames, found ${frameTotal}`);
check(pointTotal === HERO_IDS.length * 27 * POINT_SLOTS_PER_FRAME,
    `expected exactly ${HERO_IDS.length * 135} measured points, found ${pointTotal}`);

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

// Bespoke bodies must map the canonical pixel-cosmetic art space directly
// onto their own current segment, including at idle. This catches the subtle
// failure where per-hero deltas animated correctly but the neutral hat/collar
// still retained monkey placement and scale.
for (const heroId of HERO_IDS) {
    const heroAttachments = HERO_POSE_ATTACHMENTS_BY_HERO?.[heroId];
    const heroFrameSet = {
        kind: 'contract-probe',
        dirs: spriteDirs,
        attachments: heroAttachments,
        assetAttachments: HERO_POSE_ATTACHMENTS,
    };
    for (const dir of DIRECTIONS) {
        for (const [state, frames] of Object.entries(heroAttachments?.[dir] ?? {})) {
            frames.forEach((frame, index) => {
                const pose = resolveHeroPose(heroFrameSet, FACING_BY_DIRECTION[dir], state, index);
                check(pose.assetNeutralAttachments === HERO_POSE_ATTACHMENTS[dir].idle[0],
                    `${heroId}.${dir}.${state}[${index}] lost canonical cosmetic authoring space`);
                for (const slot of SEGMENT_SLOTS) {
                    let captured = null;
                    const context = { transform: (...values) => { captured = values; } };
                    const applied = applyHeroAttachmentTransform(context, pose, slot);
                    const matrix = captured && {
                        a: captured[0], b: captured[1], c: captured[2],
                        d: captured[3], e: captured[4], f: captured[5], valid: true,
                    };
                    const mapsExact = applied === true && matrixIsFinite(matrix)
                        && matrixMapsSegment(matrix,
                            HERO_POSE_ATTACHMENTS[dir].idle[0][slot], frame[slot]);
                    check(mapsExact,
                        `${heroId}.${dir}.${state}[${index}].${slot} misses its exact body segment`);

                    // Collection Growth I-A deliberately adds visual vocabulary,
                    // not independent animation sheets. Exercise every new cut
                    // against all 6 heroes x 27 poses through the one shared seat.
                    const variants = slot === 'shoulders'
                        ? REQUIRED_CLOAK_STYLES : REQUIRED_HEAD_SHAPES;
                    for (const variant of variants) {
                        collectionAttachmentTotal++;
                        check(mapsExact,
                            `${heroId}.${dir}.${state}[${index}].${slot}.${variant} detached`);
                    }
                }
            });
        }
    }
}

check(collectionAttachmentTotal === HERO_IDS.length * 27
    * (REQUIRED_CLOAK_STYLES.length + REQUIRED_HEAD_SHAPES.length),
`expected ${HERO_IDS.length * 27
    * (REQUIRED_CLOAK_STYLES.length + REQUIRED_HEAD_SHAPES.length)} collection attachment probes, `
    + `found ${collectionAttachmentTotal}`);

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

// Side art is canonical right-facing. Every hero's left-facing pose mirrors
// hand X once and maps the mirrored CANONICAL asset neutral onto that hero's
// mirrored body segment. Testing only the monkey tree would miss a double flip
// or a regression that accidentally ignored bespoke `assetAttachments`.
for (const heroId of HERO_IDS) {
    const heroAttachments = HERO_POSE_ATTACHMENTS_BY_HERO[heroId];
    const heroFrameSet = {
        kind: 'contract-probe',
        dirs: spriteDirs,
        attachments: heroAttachments,
        assetAttachments: HERO_POSE_ATTACHMENTS,
    };
    for (const [state, frames] of Object.entries(heroAttachments?.side ?? {})) {
        frames.forEach((frame, index) => {
            const rightPose = resolveHeroPose(heroFrameSet, 'right', state, index);
            const leftPose = resolveHeroPose(heroFrameSet, 'left', state, index);
            const before = JSON.stringify(frame);
            const rightHand = heroPosePoint(rightPose, 'handR');
            const leftHand = heroPosePoint(leftPose, 'handR');
            const label = `${heroId}.side.${state}[${index}]`;
            check(isDeepStrictEqual(rightHand, frame.handR),
                `${label} right hand changed canonical coordinates`);
            check(near(leftHand?.[0], -frame.handR[0]) && near(leftHand?.[1], frame.handR[1]),
                `${label} left hand was not mirrored exactly once`);
            check(isDeepStrictEqual(heroPosePoint(leftPose, 'handR'), leftHand)
                && JSON.stringify(frame) === before,
            `${label} hand mirroring mutated or compounded its source point`);
            check(leftPose.assetNeutralAttachments === HERO_POSE_ATTACHMENTS.side.idle[0],
                `${label} lost canonical asset-neutral anchors while flipped`);

            for (const slot of SEGMENT_SLOTS) {
                let captured = null;
                const context = { transform: (...values) => { captured = values; } };
                const applied = applyHeroAttachmentTransform(context, leftPose, slot);
                check(applied === true && Array.isArray(captured)
                    && captured.length === 6 && captured.every(Number.isFinite),
                `${label}.${slot} left transform was not applied finitely`);
                if (applied) {
                    const matrix = {
                        a: captured[0], b: captured[1], c: captured[2],
                        d: captured[3], e: captured[4], f: captured[5], valid: true,
                    };
                    check(matrixMapsSegment(matrix,
                        mirrorSegment(leftPose.assetNeutralAttachments[slot]),
                        mirrorSegment(leftPose.attachments[slot])),
                    `${label}.${slot} left transform double-mirrored its asset seat`);
                }
            }
        });
    }
}

// Catalog vocabulary gate: every visual value a save can equip must have an
// authored runtime branch. The collection cuts reuse shared pose seats rather
// than introducing independent sprite sheets.
const pixelSource = fs.readFileSync(PIXEL_ART_PATH, 'utf8');
const pixelCloakStart = pixelSource.indexOf('function pixelCloak(');
const pixelHatStart = pixelSource.indexOf('function pixelHat(');
const pixelHatEnd = pixelSource.indexOf('function cachedCosmetic(', pixelHatStart);
const pixelCloakSource = pixelSource.slice(pixelCloakStart, pixelHatStart);
const pixelHatSource = pixelSource.slice(pixelHatStart, pixelHatEnd);
const supportedCloakStyles = new Set(
    [...pixelCloakSource.matchAll(/style\s*===\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
);
supportedCloakStyles.add('classic');
const supportedHatShapes = new Set(
    [...pixelHatSource.matchAll(/shape\s*===\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
);
if (/shape\s*===\s*['"]none['"]/.test(pixelSource.slice(pixelHatEnd))) supportedHatShapes.add('none');
check(pixelCloakStart >= 0 && pixelHatStart > pixelCloakStart,
    'could not locate the authored PixelArt cloak vocabulary');
check(pixelHatStart >= 0 && pixelHatEnd > pixelHatStart,
    'could not locate the authored PixelArt hat vocabulary');
for (const style of REQUIRED_CLOAK_STYLES) {
    check(supportedCloakStyles.has(style),
        `PixelArt is missing required cloak style "${style}"`);
}
for (const shape of REQUIRED_HEAD_SHAPES) {
    check(supportedHatShapes.has(shape),
        `PixelArt is missing required head shape "${shape}"`);
}
for (const item of COSMETIC_LIST.filter((cosmetic) => cosmetic.category === 'cloak')) {
    const style = item.cloakStyle ?? item.style ?? 'classic';
    check(typeof style === 'string' && supportedCloakStyles.has(style),
        `${item.id} equips unsupported PixelArt cloak style "${style}"`);
}
for (const item of COSMETIC_LIST.filter((cosmetic) => cosmetic.category === 'hat')) {
    check(typeof item.shape === 'string' && supportedHatShapes.has(item.shape),
        `${item.id} equips unsupported PixelArt hat shape "${item.shape}"`);
}

check(Object.isFrozen(AURA_FX_STYLES) && new Set(AURA_FX_STYLES).size === AURA_FX_STYLES.length,
    'aura fx vocabulary must be frozen and duplicate-free');
check(Object.isFrozen(TRAIL_FX_STYLES) && new Set(TRAIL_FX_STYLES).size === TRAIL_FX_STYLES.length,
    'trail fx vocabulary must be frozen and duplicate-free');
for (const fx of REQUIRED_AURA_FX) {
    check(AURA_FX_STYLES.includes(fx), `CosmeticFx is missing required aura fx "${fx}"`);
}
for (const fx of REQUIRED_TRAIL_FX) {
    check(TRAIL_FX_STYLES.includes(fx), `CosmeticFx is missing required trail fx "${fx}"`);
}
for (const item of COSMETIC_LIST.filter((cosmetic) => cosmetic.category === 'aura')) {
    const fx = item.fx ?? 'static';
    check(AURA_FX_STYLES.includes(fx), `${item.id} equips unsupported aura fx "${fx}"`);
}
for (const item of COSMETIC_LIST.filter((cosmetic) => cosmetic.category === 'trail')) {
    const fx = item.fx ?? 'puffs';
    check(TRAIL_FX_STYLES.includes(fx), `${item.id} equips unsupported trail fx "${fx}"`);
}

// Cache identities must include the visual variant or two equipped cosmetics
// with the same direction/color would silently reuse the first built canvas.
check(pixelSource.includes('`cloak:${dir}:${cloakStyle}:${color}`'),
    'cloak cache key must include direction, cloakStyle, and color');
check(pixelSource.includes('`hat:${dir}:${shape}:${color}`'),
    'hat cache key must include direction, shape, and color');
const cloakCacheProbeKeys = [];
for (const dir of DIRECTIONS) {
    for (const style of REQUIRED_CLOAK_STYLES) {
        cloakCacheProbeKeys.push(`cloak:${dir}:${style}:#contract-a`);
        cloakCacheProbeKeys.push(`cloak:${dir}:${style}:#contract-b`);
    }
}
check(new Set(cloakCacheProbeKeys).size === DIRECTIONS.length
    * REQUIRED_CLOAK_STYLES.length * 2,
'cloak cache vocabulary aliases a direction, style, or color key');

const cosmeticFxSource = fs.readFileSync(COSMETIC_FX_PATH, 'utf8');
check((cosmeticFxSource.match(/const time = reducedEffects \? 0 : t;/g) ?? []).length >= 3,
    'aura, set-bonus, and trail fx must freeze their time source under Reduced Effects');
check(!/document\.createElement\s*\(\s*['"]canvas['"]|new\s+OffscreenCanvas|new\s+Image\s*\(/.test(cosmeticFxSource),
    'CosmeticFx must not allocate canvases/images in live draw paths');

// Static wiring guards catch the original regression without needing Canvas:
// Player and every menu avatar must consume the same pose/seat/hand contract.
const playerSource = fs.readFileSync(PLAYER_PATH, 'utf8');
const menuSource = fs.readFileSync(MENU_PATH, 'utf8');
const heroAiSource = fs.readFileSync(HERO_AI_PATH, 'utf8');
const proceduralSource = fs.readFileSync(PROCEDURAL_PATH, 'utf8');

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
check(playerSource.includes('ap.cloakStyle')
    && /_drawCloak\(ctx, color, style, pose\)/.test(playerSource)
    && /drawPixelCloak\([\s\S]{0,180}cloakStyle\)/.test(playerSource),
    'Player no longer threads appearance.cloakStyle through the shared shoulder rig');
check(/applyHeroAttachmentTransform\(ctx, pose, 'shoulders'\)[\s\S]{0,900}drawPixelCloak/.test(playerSource),
    'Player cloak styles bypass the shared pose shoulder transform');
check(/drawTrailPoint\([\s\S]{0,220}reducedEffects\)/.test(playerSource)
    && /drawAuraFx\([\s\S]{0,220}reducedEffects\)/.test(playerSource),
    'Player no longer forwards Reduced Effects to cosmetic aura/trail animation');
check(/drawSetBonus\([\s\S]{0,220}reducedEffects\)/.test(playerSource),
    'Player no longer freezes completed-set animation under Reduced Effects');
check(/drawSetBonus\([\s\S]{0,220}this\._reducedMotion\)/.test(menuSource),
    'menu previews no longer freeze completed-set animation under Reduced Effects');
check(/this\.isLpcBody\s*&&\s*cloakStyle\s*===\s*['"]classic['"]/.test(playerSource),
    'non-classic LPC cloaks no longer use their distinct procedural cuts');
check(heroAiSource.includes('HERO_POSE_ATTACHMENTS_BY_HERO[id]'),
    'bespoke hero sheets no longer select their own generated attachment tree');
check(heroAiSource.includes('applyHeroAttachmentTransform(cx')
    && heroAiSource.includes("}, 'headSeat')")
    && heroAiSource.includes('assetNeutralAttachments: assetNeutral'),
    'native hero identity features no longer follow the exported head-seat transform');
check(heroAiSource.includes("['hat', 'horns', 'hood']")
    && heroAiSource.includes("feature: null"),
    'catalog hats no longer suppress replaceable native headwear overlays');
const pixelArtSource = fs.readFileSync(PIXEL_ART_PATH, 'utf8');
check(/death:\s*\[\[[^\]]+\]\]/.test(pixelArtSource)
    && /victory:\s*\[\[[^\]]+\]\]/.test(pixelArtSource),
    'native feature motion no longer defines death and victory states');
check(/walk:\s*\[neutral,\s*neutral,\s*neutral\]/.test(proceduralSource),
    'LPC compatibility fallback no longer keeps its unauthored walk anchors neutral');
check(playerSource.includes("P.dir === 'up' ? 'behind' : 'front'"),
    'held-prop layering no longer follows the resolved pose direction');
const localTransformStart = playerSource.indexOf('ctx.translate(this.x, this.y + bobY)');
const heldBehind = playerSource.indexOf("this._drawHeldWeapons(ctx, alpha, 'behind')", localTransformStart);
const heldFront = playerSource.indexOf("this._drawHeldWeapons(ctx, alpha, 'front')", heldBehind);
const localTransformEnd = playerSource.indexOf('ctx.restore();', heldFront);
check(localTransformStart >= 0 && heldBehind > localTransformStart
    && heldFront > heldBehind && localTransformEnd > heldFront,
'held props must remain inside the same local animation transform as the body');

if (failures > 0) {
    console.error(`Cosmetic attachment validation failed: ${failures}/${checks} checks failed `
        + `(${frameTotal} frames, ${pointTotal} points).`);
    process.exit(1);
}

console.log(`Cosmetic attachment validation passed: ${checks} checks, `
    + `${frameTotal} frames, ${pointTotal} finite in-bounds points.`);
