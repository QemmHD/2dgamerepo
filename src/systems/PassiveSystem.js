// Owns the player's passives.
//
// Each owned passive is { id, level }. Applying the passive mutates Player
// directly (mirrors how stat upgrades and weapon levels work) so weapons
// reading player.cooldownMul / player.damageMul each frame pick up the new
// value immediately. Restart rebuilds this from scratch in Game.

import { MAX_PASSIVE_LEVEL } from '../config/GameConfig.js';
import { PASSIVES } from '../content/passives.js';

export class PassiveSystem {
    constructor() {
        this.owned = [];
    }

    addPassive(id, player) {
        const def = PASSIVES[id];
        if (!def) return null;
        if (this.owned.find((p) => p.id === id)) return null;
        const entry = { id, level: 1 };
        this.owned.push(entry);
        def.apply(player);
        return entry;
    }

    levelUpPassive(id, player) {
        const p = this.owned.find((o) => o.id === id);
        if (!p) return false;
        const def = PASSIVES[id];
        if (!def) return false;
        const max = def.maxLevel ?? MAX_PASSIVE_LEVEL;
        if (p.level >= max) return false;
        p.level += 1;
        def.apply(player);
        return true;
    }

    isMaxLevel(id) {
        const p = this.owned.find((o) => o.id === id);
        if (!p) return false;
        const def = PASSIVES[id];
        const max = def?.maxLevel ?? MAX_PASSIVE_LEVEL;
        return p.level >= max;
    }

    snapshotForUI() {
        return this.owned.map((p) => {
            const def = PASSIVES[p.id];
            const max = def?.maxLevel ?? MAX_PASSIVE_LEVEL;
            return {
                id: p.id,
                name: def?.name ?? p.id,
                level: p.level,
                maxLevel: max,
                isMax: p.level >= max,
            };
        });
    }
}
