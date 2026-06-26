import { SPAWN, WORLD_WIDTH, WORLD_HEIGHT } from '../config.js';
import { clamp, TWO_PI } from '../core/MathUtils.js';
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
        for (let attempt = 0; attempt < this.placementAttempts; attempt++) {
            const angle = Math.random() * TWO_PI;
            const dist = this.ringRadiusMin + Math.random() * (this.ringRadiusMax - this.ringRadiusMin);
            const x = clamp(player.x + Math.cos(angle) * dist, -halfW, halfW);
            const y = clamp(player.y + Math.sin(angle) * dist, -halfH, halfH);
            const dx = x - player.x;
            const dy = y - player.y;
            if (Math.hypot(dx, dy) < this.minSpawnDistance) continue;
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
        return this.intervalMin + Math.random() * (this.intervalMax - this.intervalMin);
    }

    _countAlive(enemies) {
        let n = 0;
        for (const e of enemies) if (e.active) n += 1;
        return n;
    }
}
