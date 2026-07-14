// Shared, DOM-free pose resolution for the 182 px hero frame contract.
// Attachment coordinates are offsets from the sprite centre; `side` art faces right.

const DIRECTIONS = ['down', 'up', 'side'];
const SEGMENT_SLOTS = new Set(['headSeat', 'shoulders']);
const EPSILON_SQUARED = 1e-8;

const identityTransform = () => ({
    a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, valid: false,
});

const isFinitePoint = (point) => Array.isArray(point)
    && point.length >= 2
    && Number.isFinite(point[0])
    && Number.isFinite(point[1]);

function isFiniteSegment(segment) {
    if (!segment || !isFinitePoint(segment.left) || !isFinitePoint(segment.right)) return false;
    const dx = segment.right[0] - segment.left[0];
    const dy = segment.right[1] - segment.left[1];
    return dx * dx + dy * dy > EPSILON_SQUARED;
}

function isPoseAttachments(value) {
    return !!value
        && isFiniteSegment(value.headSeat)
        && isFiniteSegment(value.shoulders)
        && isFinitePoint(value.handR);
}

function facingDirection(facing) {
    if (facing === 'up') return 'up';
    if (facing === 'left' || facing === 'right') return 'side';
    return 'down';
}

function pairAt(frameSet, dir, state, index) {
    const sprites = frameSet?.dirs?.[dir]?.[state];
    const anchors = frameSet?.attachments?.[dir]?.[state];
    // Unequal arrays are malformed: never let art frame N borrow anchors from M.
    if (!Array.isArray(sprites) || !Array.isArray(anchors)
        || sprites.length === 0 || sprites.length !== anchors.length) return null;
    if (index < 0 || index >= sprites.length || !sprites[index] || !isPoseAttachments(anchors[index])) return null;
    return { sprite: sprites[index], attachments: anchors[index], state, index };
}

function normalizedIndex(index, length) {
    const value = Number.isFinite(index) ? Math.trunc(index) : 0;
    return ((value % length) + length) % length;
}

function resolvePair(frameSet, dir, requestedState, requestedIndex) {
    const sprites = frameSet?.dirs?.[dir]?.[requestedState];
    const anchors = frameSet?.attachments?.[dir]?.[requestedState];
    if (Array.isArray(sprites) && Array.isArray(anchors)
        && sprites.length > 0 && sprites.length === anchors.length) {
        const index = normalizedIndex(requestedIndex, sprites.length);
        const exact = pairAt(frameSet, dir, requestedState, index);
        if (exact) return exact;
        const stateZero = pairAt(frameSet, dir, requestedState, 0);
        if (stateZero) return stateZero;
    }
    return pairAt(frameSet, dir, 'idle', 0);
}

/**
 * Resolve one sprite and its attachment data as a single, indivisible frame.
 * Invalid directions/states fall back to a complete same-direction idle frame.
 */
export function resolveHeroPose(frameSet, facing = 'down', state = 'idle', index = 0) {
    const requestedState = typeof state === 'string' && state ? state : 'idle';
    const desiredDir = facingDirection(facing);
    const candidates = [desiredDir, ...DIRECTIONS.filter((dir) => dir !== desiredDir)];

    for (const dir of candidates) {
        // A direction is usable only when it has the promised idle0 neutral pose.
        const neutral = pairAt(frameSet, dir, 'idle', 0);
        if (!neutral) continue;
        const resolved = resolvePair(frameSet, dir, requestedState, index);
        if (!resolved) continue;
        const flip = dir === 'side' && facing === 'left';
        return {
            kind: frameSet?.kind ?? null,
            sprite: resolved.sprite,
            dir,
            flip,
            requestedState,
            state: resolved.state,
            index: resolved.index,
            resolvedState: resolved.state,
            resolvedIndex: resolved.index,
            attachments: resolved.attachments,
            neutralAttachments: neutral.attachments,
        };
    }

    return {
        kind: frameSet?.kind ?? null,
        sprite: null,
        dir: desiredDir,
        flip: desiredDir === 'side' && facing === 'left',
        requestedState,
        state: 'idle',
        index: 0,
        resolvedState: 'idle',
        resolvedIndex: 0,
        attachments: null,
        neutralAttachments: null,
    };
}

/**
 * Return a Canvas2D matrix mapping `neutralSegment` onto `currentSegment` by
 * translation, rotation and uniform scale. Invalid/degenerate input is identity.
 */
export function resolveAttachmentTransform(neutralSegment, currentSegment) {
    if (!isFiniteSegment(neutralSegment) || !isFiniteSegment(currentSegment)) return identityTransform();

    const nx = neutralSegment.right[0] - neutralSegment.left[0];
    const ny = neutralSegment.right[1] - neutralSegment.left[1];
    const cx = currentSegment.right[0] - currentSegment.left[0];
    const cy = currentSegment.right[1] - currentSegment.left[1];
    const denominator = nx * nx + ny * ny;
    const currentLengthSquared = cx * cx + cy * cy;
    if (denominator <= EPSILON_SQUARED || currentLengthSquared <= EPSILON_SQUARED) return identityTransform();

    // Complex-vector division gives the orientation-preserving similarity map.
    const a = (cx * nx + cy * ny) / denominator;
    const b = (cy * nx - cx * ny) / denominator;
    const c = -b;
    const d = a;
    const e = currentSegment.left[0] - a * neutralSegment.left[0] - c * neutralSegment.left[1];
    const f = currentSegment.left[1] - b * neutralSegment.left[0] - d * neutralSegment.left[1];
    const values = [a, b, c, d, e, f];
    if (!values.every(Number.isFinite)) return identityTransform();
    return { a, b, c, d, e, f, valid: true };
}

function mirroredSegment(segment) {
    return {
        left: [-segment.left[0], segment.left[1]],
        right: [-segment.right[0], segment.right[1]],
    };
}

/**
 * Apply a neutral-to-current head/shoulder transform to an already saved ctx.
 * Left-facing segments are mirrored on both sides; the cosmetic draw owns its
 * one visual flip, avoiding a double mirror.
 */
export function applyHeroAttachmentTransform(ctx, pose, slot) {
    if (!ctx || typeof ctx.transform !== 'function' || !pose || !SEGMENT_SLOTS.has(slot)) return false;
    let neutral = pose.neutralAttachments?.[slot];
    let current = pose.attachments?.[slot];
    if (!isFiniteSegment(neutral) || !isFiniteSegment(current)) return false;
    if (pose.flip === true) {
        neutral = mirroredSegment(neutral);
        current = mirroredSegment(current);
    }
    const matrix = resolveAttachmentTransform(neutral, current);
    if (!matrix.valid) return false;
    try {
        ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
        return true;
    } catch (error) {
        return false;
    }
}

/** Return a fresh attachment point, mirroring canonical X once when flipped. */
export function heroPosePoint(pose, slot) {
    const point = pose?.attachments?.[slot];
    if (!isFinitePoint(point)) return null;
    const x = pose.flip === true && point[0] !== 0 ? -point[0] : point[0];
    return [x, point[1]];
}
