// Time-driven enemy-mix director.
//
// On each update(dt, gameTime) the director:
//   - Computes the current wave state for that gameTime (one entry from
//     WAVES, smoothly scaled past the last wave by ENDLESS_SCALING).
//   - When the wave index changes, queues an announcement (text + age +
//     lifetime) for UISystem to render with a fade.
//   - Decays the active announcement.
//
// Spawner reads waveState each tick to pick interval / cap / type weights
// / elite chance, and passes the wave's healthMul / speedMul into each
// new Enemy so freshly-spawned enemies scale but already-alive ones don't
// retroactively beef up.
//
// Restart rebuilds this from scratch in Game._initRunState — wave index,
// announcement, and the implicit gameTime reset together.

import { WAVES, ENDLESS_SCALING, WAVE_LIMITS, WAVE_PRESSURE } from '../config/GameConfig.js';

const ANNOUNCEMENT_LIFETIME = 3.0;

export class WaveDirector {
    constructor() {
        this.currentWaveIndex = -1;
        this.announcement = null;
        // Per-wave pressure + tracking (reset whenever the tier changes).
        this.pressure = 0;
        this.timeInWave = 0;
        this.killsThisWave = 0;
        this.spawnedThisWave = 0;
    }

    // gameTime drives the tier; enemyCount drives pressure (a full, un-thinned
    // field builds pressure, kills relieve it — see notifyKill).
    update(dt, gameTime, enemyCount = 0) {
        const state = this.getState(gameTime);
        if (state.index !== this.currentWaveIndex) {
            this.currentWaveIndex = state.index;
            this.announcement = {
                text: state.announcement,
                age: 0,
                lifetime: ANNOUNCEMENT_LIFETIME,
            };
            // New tier → reset pressure + per-wave counters.
            this.pressure = 0;
            this.timeInWave = 0;
            this.killsThisWave = 0;
            this.spawnedThisWave = 0;
        }
        this.timeInWave += dt;

        if (WAVE_PRESSURE.enabled) {
            // Pressure accrues only as the field fills (you're falling behind);
            // a sparse field or a fast-clearing player keeps it near zero.
            const ref = Math.max(1, state.baseMaxAlive * WAVE_PRESSURE.crowdRefFraction);
            const crowding = Math.min(1, enemyCount / ref);
            this.pressure = Math.min(
                WAVE_PRESSURE.max,
                this.pressure + WAVE_PRESSURE.gainPerSecond * crowding * dt
            );
        }

        if (this.announcement) {
            this.announcement.age += dt;
            if (this.announcement.age >= this.announcement.lifetime) {
                this.announcement = null;
            }
        }
    }

    // Each kill relieves pressure (and feeds the per-wave tally). A brisk pace
    // outruns the per-second gain; letting the field sit lets pressure climb.
    notifyKill(n = 1) {
        if (n <= 0) return;
        this.killsThisWave += n;
        if (WAVE_PRESSURE.enabled) {
            this.pressure = Math.max(0, this.pressure - WAVE_PRESSURE.killRelief * n);
        }
    }

    notifySpawn(n = 1) {
        this.spawnedThisWave += n;
    }

    // External callers (e.g. Game on boss spawn / defeat / weapon evolution)
    // can push their own transient announcement into the same channel the
    // wave-change shout uses, so the UI doesn't need a separate render path.
    // An optional accent hex tints the banner (gold by default) so distinct
    // events — a boss kill, a weapon evolving — read at a glance.
    announce(text, lifetime = ANNOUNCEMENT_LIFETIME, color = null) {
        this.announcement = { text, age: 0, lifetime, color };
    }

    getState(gameTime) {
        let wave = WAVES[0];
        for (const w of WAVES) {
            if (gameTime >= w.startTime) wave = w;
            else break;
        }

        const lastWave = WAVES[WAVES.length - 1];
        const isLast = wave === lastWave;
        const beyond = isLast ? Math.max(0, gameTime - lastWave.startTime) : 0;
        const minutesBeyond = beyond / 60;

        const healthMul = Math.min(
            wave.healthMul * (1 + minutesBeyond * ENDLESS_SCALING.healthPerMinute),
            WAVE_LIMITS.maxHealthMultiplier
        );
        let speedMul = Math.min(
            wave.speedMul * (1 + minutesBeyond * ENDLESS_SCALING.speedPerMinute),
            WAVE_LIMITS.maxSpeedMultiplier
        );
        const spawnIntervalMul = Math.max(
            0.15,
            wave.spawnIntervalMul *
                Math.pow(1 - ENDLESS_SCALING.spawnIntervalShrinkPerMinute, minutesBeyond)
        );
        const maxAlive = Math.min(
            Math.floor(wave.maxAlive + minutesBeyond * ENDLESS_SCALING.capGrowthPerMinute),
            WAVE_LIMITS.maxEnemyCap
        );
        let eliteChance = Math.min(
            WAVE_LIMITS.maxEliteChance,
            wave.eliteChance + minutesBeyond * ENDLESS_SCALING.eliteChancePerMinute
        );
        // TWILIGHT: a set time past the FINAL wave the horde "turns" — elite
        // chance leaps past the normal cap toward an elite-army ceiling (the
        // run-scale 0.85 clamp in Game still bounds the final value). The climax
        // of a deep endless run.
        const twilight = isLast && minutesBeyond >= ENDLESS_SCALING.twilightMinutesBeyond;
        const tMin = twilight ? minutesBeyond - ENDLESS_SCALING.twilightMinutesBeyond : 0;
        if (twilight) {
            eliteChance = Math.min(
                ENDLESS_SCALING.twilightEliteCap,
                Math.max(eliteChance, ENDLESS_SCALING.twilightEliteFloor + tMin * ENDLESS_SCALING.twilightEliteRampPerMin)
            );
            // Twilight enemies grow FASTER every minute (on top of the normal
            // ramp), re-clamped to the speed ceiling.
            speedMul = Math.min(
                WAVE_LIMITS.maxSpeedMultiplier,
                speedMul * (1 + Math.min(ENDLESS_SCALING.twilightSpeedCap, tMin * ENDLESS_SCALING.twilightSpeedPerMin))
            );
        }
        // Contact-damage scaling: stays 1.0 until damageStartMinutesBeyond past
        // the last wave (so the first ~15 min are untouched), then ramps so late
        // enemies actually threaten strong builds. Carried into each new spawn.
        let damageMul = Math.min(
            ENDLESS_SCALING.maxDamageMultiplier,
            1 + Math.max(0, minutesBeyond - ENDLESS_SCALING.damageStartMinutesBeyond)
                * ENDLESS_SCALING.damagePerMinute
        );
        // Twilight also makes enemies hit HARDER every minute (on top of the
        // normal damage ramp), re-clamped to the damage ceiling.
        if (twilight) {
            damageMul = Math.min(
                ENDLESS_SCALING.maxDamageMultiplier,
                damageMul * (1 + Math.min(ENDLESS_SCALING.twilightDamageCap, tMin * ENDLESS_SCALING.twilightDamagePerMin))
            );
        }
        // Pack size: how many bodies the spawner releases per wake. Grows with
        // run time (and a touch with pressure) so the field fills faster the
        // longer you last; the Spawner re-checks the live cap per body so this
        // never breaches maxEnemyCap.
        const packSize = Math.max(1, Math.min(
            ENDLESS_SCALING.maxPackSize,
            1 + Math.floor(Math.max(0, minutesBeyond - ENDLESS_SCALING.packStartMinutesBeyond) * ENDLESS_SCALING.packPerMinute)
                + (this.pressure >= 0.7 ? 1 : 0)
        ));

        // Pressure layers on top: faster spawns, a higher alive cap, and a mild
        // stat bump — all scaling 0→1 with current pressure, all still bounded
        // by WAVE_LIMITS so the enemy cap and scaling ceilings hold.
        const p = WAVE_PRESSURE.enabled ? this.pressure : 0;
        const pSpawnInterval = spawnIntervalMul * (1 - WAVE_PRESSURE.spawnRateBonus * p);
        const pMaxAlive = Math.min(
            WAVE_LIMITS.maxEnemyCap,
            Math.floor(maxAlive * (1 + WAVE_PRESSURE.capBonus * p))
        );
        const pHealthMul = Math.min(
            WAVE_LIMITS.maxHealthMultiplier,
            healthMul * (1 + WAVE_PRESSURE.healthBonus * p)
        );
        const pSpeedMul = Math.min(
            WAVE_LIMITS.maxSpeedMultiplier,
            speedMul * (1 + WAVE_PRESSURE.speedBonus * p)
        );
        // Clamp like every other pressure field so contact damage can't exceed
        // the endless ceiling (pressure layers under, never past, the cap).
        const pDamageMul = Math.min(
            ENDLESS_SCALING.maxDamageMultiplier,
            damageMul * (1 + WAVE_PRESSURE.damageBonus * p)
        );

        // HYPERGROWTH — the endless "wall". Past hyperStartMinutes of ABSOLUTE run
        // time, enemies gain hyperPerMinuteMul× BOTH health and contact damage per
        // further minute (smooth/compounding), applied ON TOP of and BYPASSING the
        // WAVE_LIMITS ceilings — the deliberate soft time-limit that eventually ends
        // any run. Clamped to hyperMulCap so health/damage math can never overflow.
        const gameMinutes = gameTime / 60;
        const hyperMinutes = Math.max(0, gameMinutes - ENDLESS_SCALING.hyperStartMinutes);
        const hyperMul = hyperMinutes > 0
            ? Math.min(ENDLESS_SCALING.hyperMulCap, Math.pow(ENDLESS_SCALING.hyperPerMinuteMul, hyperMinutes))
            : 1;

        // Skill-relief gate: how far the TIME-BASED damage ramp (pre-pressure,
        // pre-difficulty `damageMul`, PLUS the hypergrowth wall) has climbed toward
        // its ceiling, 0..1 — saturates to 1 once hypergrowth kicks in. Composure
        // relief keys off THIS only, never off pressure or difficulty, so those
        // axes keep their full weight and only the "you survived too long"
        // surcharge (incl. the wall) is softened for clean play.
        const surchargeSpan = ENDLESS_SCALING.maxDamageMultiplier - 1;
        const endlessDamageSurcharge = surchargeSpan > 0
            ? Math.max(0, Math.min(1, (damageMul * hyperMul - 1) / surchargeSpan))
            : 0;

        return {
            index: wave.index,
            name: wave.name,
            announcement: wave.announcement,
            spawnIntervalMul: Math.max(0.1, pSpawnInterval),
            maxAlive: pMaxAlive,
            baseMaxAlive: maxAlive,
            typeWeights: wave.typeWeights,
            eliteChance,
            // Hypergrowth multiplies BOTH final stats, bypassing the WAVE_LIMITS
            // clamps applied above (that's the point — the wall outgrows the caps).
            healthMul: pHealthMul * hyperMul,
            speedMul: pSpeedMul,
            damageMul: pDamageMul * hyperMul,
            endlessDamageSurcharge,
            hyperMul,
            packSize,
            pressure: p,
            twilight,
        };
    }
}
