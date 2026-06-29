// Easing + time-based smoothing helpers shared by camera, UI, and VFX.
// Dependency-free so any module can import without side effects. All easing
// functions take a normalized t in 0..1 and return an eased 0..1 (canonical
// Penner / easings.net forms).

export const Easing = {
    linear: (t) => t,
    inQuad: (t) => t * t,
    outQuad: (t) => 1 - (1 - t) * (1 - t),
    inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    inCubic: (t) => t * t * t,
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outQuart: (t) => 1 - Math.pow(1 - t, 4),
    outQuint: (t) => 1 - Math.pow(1 - t, 5),
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    outBack: (t) => {
        const c1 = 1.70158, c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    outElastic: (t) => {
        if (t === 0 || t === 1) return t;
        const c4 = (2 * Math.PI) / 3;
        return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },
    outBounce: (t) => {
        const n = 7.5625, d = 2.75;
        if (t < 1 / d) return n * t * t;
        if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
        if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
        return n * (t -= 2.625 / d) * t + 0.984375;
    },
};

// Frame-rate-independent exponential smoothing. Plain lerp(x, target, k)
// converges faster at higher FPS; this fixes that by folding dt into the
// blend (Freya Holmer, "lerp smoothing is broken"). rate = larger → snappier.
export function damp(current, target, rate, dt) {
    return target + (current - target) * Math.exp(-rate * dt);
}

// Convenience: a normalized 0..1 ramp from an age/duration, clamped.
export function ramp(age, duration) {
    if (duration <= 0) return 1;
    const t = age / duration;
    return t < 0 ? 0 : t > 1 ? 1 : t;
}
