// Boss spawn scheduler.
// Bosses appear at fixed intervals (BOSS.spawnInterval seconds) — first at
// t=120, then 240, 360, … — rotating through BOSS.types. update(gameTime)
// returns the list of boss ids to spawn this tick (usually 0 or 1; only 2+
// if dt is huge, e.g. after a frame stall).

import { BOSS } from '../config/GameConfig.js';

export class BossDirector {
    constructor() {
        this.bossTypes = BOSS.types;
        this.spawnsTotal = 0;
        this.nextSpawnTime = BOSS.spawnInterval;
    }

    update(gameTime) {
        const out = [];
        while (gameTime >= this.nextSpawnTime) {
            const id = this.bossTypes[this.spawnsTotal % this.bossTypes.length];
            out.push(id);
            this.spawnsTotal += 1;
            this.nextSpawnTime += BOSS.spawnInterval;
        }
        return out;
    }

    getNextSpawnTime() {
        return this.nextSpawnTime;
    }
}
