// Enemy spawning system.
// Each tick rolls a delay; when reached, places an enemy on a ring around
// the player just outside the visible 16:9 viewport. The ring radius is
// tuned so spawns enter from screen edges; the minSpawnDistance retry loop
// guards against world-corner cases where clamping would otherwise spawn
// an enemy on top of the player.

import { SPAWN, WORLD_WIDTH, WORLD_HEIGHT } from '../config/GameConfig.js';
import { clamp, TWO_PI, distanceSq, randomRange } from '../core/MathUtils.js';
import { Enemy } from '../entities/Enemy.js';

export class Spawner {
    constructor(opts = {}) {
        this.intervalMin = opts.intervalMin ?? SPAWN.intervalMin;
        this.intervalMax = opts.intervalMax ?? SPAWN.intervalMax;
        this.maxAlive = opts.maxAlive ?? SPAWN.maxAlive;
        this.ringRadiusMin = opts.ringRadiusMin ?? SPAWN.ringRadiusMin;
        this.ringRadiusMax = opts.ringRadiusMax ?? SPAWN.ringRadiusMax;
        this.minSpawnDistance = opts.minSpawnDistance ?? SPAWN.minSpawnDistance;
        this.slimeOnlyUntil = opts.slimeOnlyUntil ?? SPAWN.slimeOnlyUntil;
        this.batChance = opts.batChance ?? SPAWN.batChance;
        this.placementAttempts = opts.placementAttempts ?? SPAWN.placementAttempts;

        this.timer = 0;
        this.nextInterval = this._rollInterval();
        this.spawnsTotal = 0;
    }

    update(dt, player, enemies) {
        this.timer += dt;
        if (this.timer < this.nextInterval) return;
        if (this._countAlive(enemies) >= this.maxAlive) {
            this.timer = this.nextInterval;
            return;
        }
        this.timer -= this.nextInterval;
        this.nextInterval = this._rollInterval();
        this._spawnOne(player, enemies);
    }

    _spawnOne(player, enemies) {
        const halfW = WORLD_WIDTH / 2 - 80;
        const halfH = WORLD_HEIGHT / 2 - 80;
        const minDistSq = this.minSpawnDistance * this.minSpawnDistance;

        for (let attempt = 0; attempt < this.placementAttempts; attempt++) {
            const angle = Math.random() * TWO_PI;
            const dist = randomRange(this.ringRadiusMin, this.ringRadiusMax);
            const x = clamp(player.x + Math.cos(angle) * dist, -halfW, halfW);
            const y = clamp(player.y + Math.sin(angle) * dist, -halfH, halfH);
            if (distanceSq(x, y, player.x, player.y) < minDistSq) continue;
            enemies.push(new Enemy(this._pickType(), x, y));
            this.spawnsTotal += 1;
            return;
        }
    }

    _pickType() {
        if (this.spawnsTotal < this.slimeOnlyUntil) return 'slime';
        return Math.random() < this.batChance ? 'bat' : 'slime';
    }

    _rollInterval() {
        return randomRange(this.intervalMin, this.intervalMax);
    }

    _countAlive(enemies) {
        let n = 0;
        for (const e of enemies) if (e.active) n += 1;
        return n;
    }
}
