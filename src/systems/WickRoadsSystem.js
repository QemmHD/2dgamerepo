// WickRoadsSystem — the roller behind the Wick Shrine altar. Mirrors the
// UpgradeSystem contract: rollAltarChoices(game, count) returns a pick-one list
// of card-shaped choices the level-up overlay UI already knows how to draw
// ({ id, kind, rarity, cardLabel, cardLevelText, name, description, apply(game) }).
// For PR1 every choice is a RELIC; later phases add Pact / Fusion choices to the
// same list. Relics already claimed this run are excluded so a shrine never
// re-offers something you hold. Effects apply at pick time (see relics.js) — the
// overlay is confirmation, not a commit step.

import { RELICS, getRelic } from '../content/relics.js';

// Rarity draft weights (rarer = less likely to be offered). Shared shape with
// the rest of the game's weighted draws.
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

// Weighted, distinct draw of up to `count` relic choices, skipping any already
// claimed this run. Falls back gracefully (fewer cards) if the pool runs dry.
export function rollAltarChoices(game, count = 3) {
    const owned = new Set(Array.isArray(game._runRelics) ? game._runRelics : []);
    const pool = RELICS.filter((r) => !owned.has(r.id));
    const chosen = [];
    while (chosen.length < count && pool.length > 0) {
        let total = 0;
        for (const r of pool) total += RARITY_WEIGHT[r.rarity] ?? 20;
        let roll = Math.random() * total;
        let idx = 0;
        for (let i = 0; i < pool.length; i++) {
            roll -= RARITY_WEIGHT[pool[i].rarity] ?? 20;
            if (roll <= 0) { idx = i; break; }
        }
        chosen.push(relicToChoice(pool[idx]));
        pool.splice(idx, 1);
    }
    return chosen;
}
