// Render-phase timing profiler (roadmap #4). A tiny, allocation-free internal
// profiler that times per-frame work into named buckets so an FPS drop can be
// DIAGNOSED, not guessed ("do not guess"). It is active ONLY while the dev/debug
// HUD is showing (`enabled`), so a normal build pays nothing: begin()/end() are a
// single boolean test + early return when disabled.
//
// begin(name)/end(name) bracket a section; end ADDS the elapsed ms to this
// frame's accumulator, so a bucket entered several times in one displayed frame
// — update runs up to 8 fixed steps; obstacles draw in three interleaved passes
// — sums correctly. frame() folds each accumulator into an exponential moving
// average (so the HUD reads steady instead of jittering frame-to-frame) and
// zeros it for the next frame.
//
// Toggle-safe: the debug HUD toggles mid-frame (input is polled inside update()).
// end() only adds when a matching begin() set the start stamp THIS cycle (the
// stamp is consumed + cleared on read), so a begin gated off / end gated on (or
// vice-versa) across a toggle can never inject a garbage delta.
//
// GC-clean, mirroring the engine's other hot paths: the acc/ema/stamp objects
// are built ONCE from the fixed bucket list and only mutated thereafter — a
// steady-state frame allocates nothing.

// The timing buckets, in display order (roadmap #4). `update`/`render` are the
// two top-level phases; the rest are sub-phases folded inside them.
export const PROFILER_BUCKETS = [
    'update', 'render',
    'map', 'decor', 'obstacles', 'entities', 'projectiles', 'particles', 'lighting',
    'combatCues', 'ui',
    'collision', 'weapons', 'spawner',
];

const now = () => (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();

export class FrameProfiler {
    constructor(buckets = PROFILER_BUCKETS) {
        this.buckets = buckets.slice();
        this.enabled = false;
        this._t0 = Object.create(null);    // bucket -> start stamp (0 = not open)
        this._acc = Object.create(null);   // bucket -> ms accumulated this frame
        this.ema = Object.create(null);    // bucket -> smoothed ms (read by the HUD)
        for (const b of this.buckets) { this._t0[b] = 0; this._acc[b] = 0; this.ema[b] = 0; }
        this._smooth = 0.12;   // EMA weight of the newest frame
    }

    begin(name) {
        if (this.enabled) this._t0[name] = now();
    }

    end(name) {
        if (!this.enabled) return;
        const s = this._t0[name];
        if (s) { this._acc[name] += now() - s; this._t0[name] = 0; }
    }

    // Fold this frame's accumulators into the EMA and reset them. Called once per
    // displayed frame (after update + render). No-op while disabled: the EMA
    // simply holds its last values, and re-enabling resumes it from there (it
    // re-converges within a few frames — fine for a diagnostic readout).
    frame() {
        if (!this.enabled) return;
        const k = this._smooth;
        for (const b of this.buckets) {
            this.ema[b] += (this._acc[b] - this.ema[b]) * k;
            this._acc[b] = 0;
        }
    }
}
