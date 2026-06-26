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
