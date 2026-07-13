// Enemy spawning system.
//
// Each tick rolls a delay (base interval × waveState.spawnIntervalMul);
// when the timer hits zero, places an enemy on a ring just outside the
// visible viewport, then defers if the alive count has reached the
// per-wave cap. The minSpawnDistance retry loop guards corner cases where
// world-bounds clamping would otherwise spawn an enemy on top of the
// player. Enemy type and elite roll come from waveState too.

import { SPAWN, WORLD_WIDTH, WORLD_HEIGHT, ENEMY, ELITE } from '../config/GameConfig.js';
import {
    clamp,
    TWO_PI,
    distanceSq,
    randomRange,
    pickWeighted,
} from '../core/MathUtils.js';
import { Enemy } from '../entities/Enemy.js';

export class Spawner {
    constructor(opts = {}) {
        this.intervalMin = opts.intervalMin ?? SPAWN.intervalMin;
        this.intervalMax = opts.intervalMax ?? SPAWN.intervalMax;
        this.ringRadiusMin = opts.ringRadiusMin ?? SPAWN.ringRadiusMin;
        this.ringRadiusMax = opts.ringRadiusMax ?? SPAWN.ringRadiusMax;
        this.minSpawnDistance = opts.minSpawnDistance ?? SPAWN.minSpawnDistance;
        this.placementAttempts = opts.placementAttempts ?? SPAWN.placementAttempts;

        this.timer = 0;
        this.nextInterval = this._rollInterval(1.0);
        this.spawnsTotal = 0;
    }

    update(dt, player, enemies, waveState, obstacleSystem = null, waveDirector = null) {
        this.timer += dt;
        if (this.timer < this.nextInterval) return;
        if (this._countAlive(enemies) >= waveState.maxAlive) {
            // Hold at threshold so we don't burst-spawn the instant an enemy
            // dies — keeps frame spikes contained.
            this.timer = this.nextInterval;
            return;
        }
        this.timer -= this.nextInterval;
        this.nextInterval = this._rollInterval(waveState.spawnIntervalMul);
        // Release a PACK: the longer the run goes the more bodies arrive per
        // wake (waveState.packSize), escalating pressure over time. Re-check the
        // live cap before EACH body so a pack can never breach maxEnemyCap.
        const pack = Math.max(1, waveState.packSize ?? 1);
        for (let i = 0; i < pack; i++) {
            if (this._countAlive(enemies) >= waveState.maxAlive) break;
            this._spawnOne(player, enemies, waveState, obstacleSystem, waveDirector);
        }
    }

    _spawnOne(player, enemies, waveState, obstacleSystem, waveDirector = null) {
        const type = pickWeightedType(waveState.typeWeights);
        if (!type) return;
        const elite = Math.random() < (waveState.eliteChance ?? 0);
        // Validate the body that will actually spawn. The old fixed 46px probe
        // admitted every larger enemy (and all large elites) partially into a
        // wall; e.g. an elite dreadhulk is 132.6px wide at collision radius.
        const spawnRadius = Math.max(1, (ENEMY[type]?.radius ?? 46) * (elite ? ELITE.sizeMul : 1));

        const edgeClearance = Math.max(80, spawnRadius);
        const halfW = WORLD_WIDTH / 2 - edgeClearance;
        const halfH = WORLD_HEIGHT / 2 - edgeClearance;
        const minDistSq = this.minSpawnDistance * this.minSpawnDistance;

        for (let attempt = 0; attempt < this.placementAttempts; attempt++) {
            const angle = Math.random() * TWO_PI;
            const dist = randomRange(this.ringRadiusMin, this.ringRadiusMax);
            const x = clamp(player.x + Math.cos(angle) * dist, -halfW, halfW);
            const y = clamp(player.y + Math.sin(angle) * dist, -halfH, halfH);
            if (distanceSq(x, y, player.x, player.y) < minDistSq) continue;
            // Never spawn an enemy inside a wall/building — retry another spot.
            if (obstacleSystem && obstacleSystem.isBlocked(x, y, spawnRadius)) continue;
            enemies.push(new Enemy(type, x, y, {
                healthMul: waveState.healthMul,
                speedMul: waveState.speedMul,
                contactDamageMul: waveState.damageMul ?? 1,
                elite,
            }));
            this.spawnsTotal += 1;
            if (waveDirector && waveDirector.notifySpawn) waveDirector.notifySpawn(1);
            return;
        }
    }

    _rollInterval(spawnIntervalMul) {
        return randomRange(this.intervalMin, this.intervalMax) * spawnIntervalMul;
    }

    _countAlive(enemies) {
        let n = 0;
        for (const e of enemies) if (e.active) n += 1;
        return n;
    }
}

function pickWeightedType(weights) {
    const items = [];
    for (const id in weights) {
        const w = weights[id];
        if (w > 0) items.push({ id, weight: w });
    }
    const picked = pickWeighted(items);
    return picked?.id ?? null;
}
