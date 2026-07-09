// BossRushController — the run-time state machine for a Boss Rush run.
//
// Drives a sequence of apex bosses with a short PREP (breathing) phase between
// each. It does NOT spawn anything itself — it decides WHEN the next boss's
// warning should open and returns that decision to the Game, which uses its
// existing _startBossWarning → _spawnBoss pipeline (so telegraphs, enraged
// phases, arena, boss music, threshold adds all work exactly as in a normal
// run). The normal BossDirector, LieutenantDirector and trash Spawner are
// bypassed for the run (gated on game.bossRush in GameUpdate).
//
// Mode-agnostic: constructed from a resolved boss-id sequence + a config, so the
// same class will later drive Weekly Ember (a seeded sequence) with no changes.
//
// Phases:
//   'prep'  — countdown before the current boss; no boss on field.
//   'fight' — the current boss's warning/spawn has been requested; a boss is (or
//             is about to be) alive. The Game's existing bossWarning/boss-alive
//             checks own the actual on-field state.
//   'done'  — the whole sequence is resolved (cleared).

import { bossRushScaleFor } from '../content/bossRush.js';

export class BossRushController {
    constructor(sequence, config) {
        this.config = config || {};
        this.sequence = (Array.isArray(sequence) ? sequence : []).slice();
        this.index = 0;                 // index of the boss being fought / prepped
        this.bossesDefeated = 0;
        this.phase = 'prep';
        this.prepTimer = this.config.firstPrepDuration ?? this.config.prepDuration ?? 6;
        this._prepTotal = this.prepTimer;
    }

    get total() { return this.sequence.length; }
    get cleared() { return this.phase === 'done'; }
    currentBossId() { return this.sequence[this.index] ?? null; }
    nextBossId() { return this.sequence[this.index + 1] ?? null; }

    // Mode-specific boss scaling for the boss at the current index (read by
    // Game._spawnBoss so Boss Rush uses its own gentle curve).
    currentScale() { return bossRushScaleFor(this.index, this.config); }

    // Advance the prep countdown. Returns { spawn: bossId } exactly once, on the
    // frame prep elapses, so the caller opens that boss's warning; else null.
    // No-op unless we're in 'prep' with a current boss to spawn.
    update(dt) {
        if (this.phase !== 'prep') return null;
        const id = this.currentBossId();
        if (id == null) { this.phase = 'done'; return null; }
        this.prepTimer -= dt;
        if (this.prepTimer <= 0) {
            this.prepTimer = 0;
            this.phase = 'fight';
            return { spawn: id };
        }
        return null;
    }

    // Called from the boss-death hook. Advances to the next boss's prep, or ends
    // the mode when the sequence is exhausted. Returns { done, cleared, nextBossId }.
    notifyBossDefeated() {
        if (this.phase === 'done') return { done: true, cleared: true, nextBossId: null };
        this.bossesDefeated += 1;
        this.index += 1;
        if (this.index >= this.sequence.length) {
            this.phase = 'done';
            return { done: true, cleared: true, nextBossId: null };
        }
        this.phase = 'prep';
        this.prepTimer = this.config.prepDuration ?? 6;
        this._prepTotal = this.prepTimer;
        return { done: false, cleared: false, nextBossId: this.currentBossId() };
    }

    // Read-only snapshot for the HUD (mode label, boss X/N, next boss, timer,
    // progress). bossNumber is 1-based and clamped so a cleared run reads N/N.
    getStatus() {
        return {
            id: this.config.id ?? 'bossRush',
            label: this.config.label ?? 'Boss Rush',
            phase: this.phase,
            bossNumber: Math.min(this.index + 1, this.total),
            total: this.total,
            bossesDefeated: this.bossesDefeated,
            currentBossId: this.currentBossId(),
            nextBossId: this.nextBossId(),
            prepRemaining: this.phase === 'prep' ? Math.max(0, this.prepTimer) : 0,
            prepTotal: this._prepTotal,
            cleared: this.phase === 'done',
        };
    }

    // ── Debug helpers (DEV_MODE shortcuts) ──────────────────────────────────
    // Shorten the current prep so the next boss lands almost immediately.
    debugSkipPrep() { if (this.phase === 'prep') this.prepTimer = 0.05; }
    // Mark the whole sequence cleared (the caller triggers the victory/end).
    debugForceFinish() {
        this.bossesDefeated = this.total;
        this.index = this.total;
        this.phase = 'done';
    }
}
