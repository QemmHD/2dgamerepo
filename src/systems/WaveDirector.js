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

import { WAVES, ENDLESS_SCALING, WAVE_LIMITS } from '../config/GameConfig.js';

const ANNOUNCEMENT_LIFETIME = 3.0;

export class WaveDirector {
    constructor() {
        this.currentWaveIndex = -1;
        this.announcement = null;
    }

    update(dt, gameTime) {
        const state = this.getState(gameTime);
        if (state.index !== this.currentWaveIndex) {
            this.currentWaveIndex = state.index;
            this.announcement = {
                text: state.announcement,
                age: 0,
                lifetime: ANNOUNCEMENT_LIFETIME,
            };
        }
        if (this.announcement) {
            this.announcement.age += dt;
            if (this.announcement.age >= this.announcement.lifetime) {
                this.announcement = null;
            }
        }
    }

    // External callers (e.g. Game on boss spawn) can push their own
    // transient announcement into the same channel the wave-change shout
    // uses, so the UI doesn't need a separate render path.
    announce(text, lifetime = ANNOUNCEMENT_LIFETIME) {
        this.announcement = { text, age: 0, lifetime };
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
        const speedMul = Math.min(
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
        const eliteChance = Math.min(
            WAVE_LIMITS.maxEliteChance,
            wave.eliteChance + minutesBeyond * ENDLESS_SCALING.eliteChancePerMinute
        );

        return {
            index: wave.index,
            name: wave.name,
            announcement: wave.announcement,
            spawnIntervalMul,
            maxAlive,
            typeWeights: wave.typeWeights,
            eliteChance,
            healthMul,
            speedMul,
        };
    }
}
