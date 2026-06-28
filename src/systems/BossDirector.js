// Boss spawn scheduler — ONE boss at a time.
//
// A boss may spawn only when no boss is currently alive AND the schedule
// (plus any post-death cooldown) allows it. If the scheduled time arrives
// while a boss is still alive, the spawn is held — not stacked — and happens
// once the active boss dies (after a short cooldown so kills don't chain
// back-to-back). update() returns a single boss id to spawn, or null.
//
// Spacing counts from the actual spawn (gameTime + spawnInterval), so a
// long-lived boss never causes a burst of catch-up spawns. notifyBossDefeated
// arms the post-death cooldown. The whole object is rebuilt on restart
// (Game._initRunState), so boss timing fully resets with the run.

import { BOSS } from '../config/GameConfig.js';

export class BossDirector {
    constructor() {
        this.bossTypes = BOSS.types;
        this.spawnInterval = BOSS.spawnInterval;
        this.postDeathCooldown = BOSS.postDeathCooldown ?? 0;
        this.spawnsTotal = 0;
        this.nextSpawnTime = BOSS.spawnInterval; // first boss at t = interval
        this.cooldownUntil = 0;                  // post-death gate (absolute time)
        this._lastBossActive = false;
    }

    // The earliest time the NEXT boss may appear, ignoring whether one is
    // currently alive (that's an additional hard gate in update/getStatus).
    eligibleTime() {
        return Math.max(this.nextSpawnTime, this.cooldownUntil);
    }

    // Returns a boss id to spawn this tick, or null. `bossActive` MUST be the
    // caller's live "is any boss alive right now" check — the one-at-a-time
    // invariant depends on it.
    update(gameTime, bossActive) {
        this._lastBossActive = bossActive;
        if (bossActive) return null;                 // never two at once
        if (gameTime < this.eligibleTime()) return null;
        const id = this.bossTypes[this.spawnsTotal % this.bossTypes.length];
        this.spawnsTotal += 1;
        this.nextSpawnTime = gameTime + this.spawnInterval; // space from real spawn
        return id;
    }

    // Arm the post-death cooldown so the next boss can't appear immediately
    // after a late kill.
    notifyBossDefeated(gameTime) {
        this.cooldownUntil = gameTime + this.postDeathCooldown;
    }

    getNextSpawnTime() {
        return this.nextSpawnTime;
    }

    // Debug/UI snapshot of the scheduler's current decision.
    getStatus(gameTime, bossActive) {
        const eligible = this.eligibleTime();
        let state;
        if (bossActive) state = 'blocked';            // a boss is alive
        else if (gameTime < this.cooldownUntil) state = 'cooldown';
        else if (gameTime < this.nextSpawnTime) state = 'waiting';
        else state = 'ready';
        return {
            state,
            eligible,
            secondsUntil: Math.max(0, eligible - gameTime),
            cooldownRemaining: Math.max(0, this.cooldownUntil - gameTime),
        };
    }
}
