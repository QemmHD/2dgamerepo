// Pure math + collection helpers shared across systems.
// Kept dependency-free so any module can import without side effects.

export const TWO_PI = Math.PI * 2;

export function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}

export function lerp(a, b, t) {
    return a + (b - a) * t;
}

export function length(x, y) {
    return Math.hypot(x, y);
}

export function normalize(x, y) {
    const l = Math.hypot(x, y);
    if (l === 0) return { x: 0, y: 0 };
    return { x: x / l, y: y / l };
}

export function distance(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
}

// Squared distance — use whenever you only need to compare distances; skips
// a Math.sqrt per call, which matters in collision/nearest-target loops.
export function distanceSq(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
}

// True when two circles overlap. Avoids a sqrt by squaring the radius sum.
export function circleOverlap(ax, ay, ar, bx, by, br) {
    const r = ar + br;
    return distanceSq(ax, ay, bx, by) <= r * r;
}

export function randomRange(lo, hi) {
    return lo + Math.random() * (hi - lo);
}

// Weighted random pick. weightFn defaults to reading `.weight` (or 1).
// Returns null if the list is empty.
export function pickWeighted(items, weightFn = (it) => (it?.weight ?? 1)) {
    if (!items || items.length === 0) return null;
    let total = 0;
    for (const it of items) total += weightFn(it);
    if (total <= 0) return items[0];
    let pick = Math.random() * total;
    for (const it of items) {
        pick -= weightFn(it);
        if (pick <= 0) return it;
    }
    return items[items.length - 1];
}

// In-place compaction. Removes entries where `isActive(entry)` is false,
// preserving order, without allocating a new array. Default predicate
// reads `.active` (the convention shared by all entity types).
export function compactInPlace(list, isActive = (it) => it.active) {
    let write = 0;
    for (let read = 0; read < list.length; read++) {
        if (isActive(list[read])) {
            if (write !== read) list[write] = list[read];
            write += 1;
        }
    }
    list.length = write;
}
