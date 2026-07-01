// WickRoadsSystem — the roller behind the Wick Shrine altar. Mirrors the
// UpgradeSystem contract: rollAltarChoices(game, count) returns a pick-one list
// of card-shaped choices the level-up overlay UI already knows how to draw
// ({ id, kind, rarity, cardLabel, cardLevelText, name, description, apply(game) }).
// Choices are RELICS plus — when eligible — a WEAPON FUSION (fuse two owned base
// weapons into one scalable fusion weapon). Relics already claimed this run and
// fusions already forged are excluded, so a shrine never re-offers something you
// hold. Effects apply at pick time; the overlay is confirmation, not a commit.

import { RELICS, getRelic } from '../content/relics.js';
import { FUSIONS, findEligibleFusions } from '../content/fusions.js';
import { WEAPONS } from '../content/weapons.js';

// Rarity draft weights (rarer = less likely to be offered).
const RARITY_WEIGHT = {
    common: 100,
    uncommon: 55,
    rare: 26,
    epic: 10,
    legendary: 4,
    mythic: 1,
};

function relicToChoice(relic) {
    return {
        id: `relic:${relic.id}`,
        kind: 'relic',
        relicId: relic.id,
        rarity: relic.rarity,
        cardLabel: 'RELIC',
        cardLevelText: 'Relic',
        name: relic.name,
        description: relic.description,
        apply(game) {
            const r = getRelic(relic.id);
            if (!r) return;
            r.apply(game.player);
            if (!Array.isArray(game._runRelics)) game._runRelics = [];
            game._runRelics.push(relic.id);
        },
    };
}

function fusionToChoice(f) {
    const an = WEAPONS[f.a]?.name ?? f.a;
    const bn = WEAPONS[f.b]?.name ?? f.b;
    return {
        id: `fuse:${f.fusedWeaponId}`,
        kind: 'fusion',
        rarity: 'epic',               // fusions read as a rare, exciting pull
        cardLabel: 'FUSE',
        cardLevelText: 'Weapon',
        name: f.name,
        description: `Fuse ${an} + ${bn} into ${f.name}.`,
        apply(game) {
            game.weaponSystem.fuseWeapons(f.a, f.b, f.fusedWeaponId);
        },
    };
}

// Weighted, distinct draw of up to `count` choices. A single eligible fusion (if
// any) is offered — never more than one, and never forced — with the remaining
// slots filled by weighted relics; if the relic pool is exhausted, extra fusions
// backfill so the altar is never empty.
export function rollAltarChoices(game, count = 3) {
    const owned = new Set(Array.isArray(game._runRelics) ? game._runRelics : []);
    const relicPool = RELICS.filter((r) => !owned.has(r.id));
    const fusionPool = findEligibleFusions(game).map(fusionToChoice);
    const chosen = [];

    // Reserve at most ONE slot for a random eligible fusion.
    if (fusionPool.length > 0) {
        const i = (Math.random() * fusionPool.length) | 0;
        chosen.push(fusionPool.splice(i, 1)[0]);
    }

    // Fill remaining slots with weighted, distinct relics.
    while (chosen.length < count && relicPool.length > 0) {
        let total = 0;
        for (const r of relicPool) total += RARITY_WEIGHT[r.rarity] ?? 20;
        let roll = Math.random() * total;
        let idx = 0;
        for (let i = 0; i < relicPool.length; i++) {
            roll -= RARITY_WEIGHT[relicPool[i].rarity] ?? 20;
            if (roll <= 0) { idx = i; break; }
        }
        chosen.push(relicToChoice(relicPool[idx]));
        relicPool.splice(idx, 1);
    }

    // Late-game backfill: if relics ran dry, offer any remaining eligible fusions.
    while (chosen.length < count && fusionPool.length > 0) {
        chosen.push(fusionPool.shift());
    }

    return chosen;
}
