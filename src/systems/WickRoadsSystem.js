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
import { PACTS, getPact } from '../content/pacts.js';
import { ROADS, getRoad } from '../content/roads.js';
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

function pactToChoice(pact) {
    return {
        id: `pact:${pact.id}`,
        kind: 'pact',
        pactId: pact.id,
        rarity: pact.rarity,
        cardLabel: 'ASHEN PACT',
        cardLevelText: 'Devil’s bargain',
        name: pact.name,
        description: `⚠ ${pact.curse}   ✦ ${pact.boon}`,
        apply(game) {
            const p = getPact(pact.id);
            if (!p) return;
            p.apply(game);
            if (!Array.isArray(game._runPacts)) game._runPacts = [];
            game._runPacts.push(pact.id);
        },
    };
}

// Branching Roads — the post-boss CROSSROADS fork. A road is a pact-shaped card
// whose apply(game) sets the disposable per-segment bias + a permanent boon (see
// content/roads.js). All three roads are ALWAYS offered (a fixed fork, not a
// weighted draw), so the choice is a clear risk/reward read every time.
function roadToChoice(road) {
    return {
        id: `road:${road.id}`,
        kind: 'road',
        roadId: road.id,
        rarity: road.rarity,
        tintAccent: road.tintAccent,
        cardLabel: 'ROAD',
        cardLevelText: 'Branch',
        name: road.name,
        description: road.description,
        apply(game) {
            const r = getRoad(road.id);
            if (!r) return;
            r.apply(game);
            game._segmentRoadId = road.id;
        },
    };
}

export function rollRoadChoices() {
    return ROADS.map(roadToChoice);
}

// Weighted, distinct draw of up to `count` choices. At most ONE eligible fusion
// AND at most ONE unclaimed pact are offered (each random, neither forced); the
// remaining slots are weighted relics. If a pool runs dry the others backfill so
// the altar is never empty. Never offers a claimed relic/pact or a forged fusion.
export function rollAltarChoices(game, count = 3) {
    const ownedRelics = new Set(Array.isArray(game._runRelics) ? game._runRelics : []);
    const takenPacts = new Set(Array.isArray(game._runPacts) ? game._runPacts : []);
    const relicPool = RELICS.filter((r) => !ownedRelics.has(r.id));
    const fusionPool = findEligibleFusions(game).map(fusionToChoice);
    const pactPool = PACTS.filter((p) => !takenPacts.has(p.id)).map(pactToChoice);
    const chosen = [];

    // Reserve at most ONE random eligible fusion, and ONE random unclaimed pact.
    if (fusionPool.length > 0 && chosen.length < count) {
        chosen.push(fusionPool.splice((Math.random() * fusionPool.length) | 0, 1)[0]);
    }
    if (pactPool.length > 0 && chosen.length < count) {
        chosen.push(pactPool.splice((Math.random() * pactPool.length) | 0, 1)[0]);
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

    // Late-game backfill (relic pool dry): offer any remaining fusions, then pacts.
    while (chosen.length < count && fusionPool.length > 0) chosen.push(fusionPool.shift());
    while (chosen.length < count && pactPool.length > 0) chosen.push(pactPool.shift());

    return chosen;
}
