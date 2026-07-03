// Weapon evolution definitions.
//
// Each evolution pairs a base weapon at max level with a required passive
// (any level). When a chest opens with both conditions met, the chest
// reward roll picks an evolution instead of a normal reward and the
// player's base-weapon slot is replaced with the evolved version.
//
// Add a new evolution by appending an entry — no system code change.

export const EVOLUTIONS = [
    {
        id: 'arcaneStorm',
        baseWeaponId: 'arcaneBolt',
        evolvedWeaponId: 'arcaneStorm',
        requiredPassiveId: 'spellbook',
        evolvedName: 'Cinderstorm',
        catalystName: 'Quickwick',
        chestRewardText: 'Cinderstorm awakened.',
    },
    {
        id: 'celestialBlades',
        baseWeaponId: 'orbitingBlade',
        evolvedWeaponId: 'celestialBlades',
        requiredPassiveId: 'powerStone',
        evolvedName: 'Glacial Halo',
        catalystName: 'Brightstone',
        chestRewardText: 'Glacial Halo manifests.',
    },
    {
        id: 'divineNova',
        baseWeaponId: 'holyPulse',
        evolvedWeaponId: 'divineNova',
        requiredPassiveId: 'ironHeart',
        evolvedName: 'Dawnbreaker',
        catalystName: 'Hearthcore',
        chestRewardText: 'Dawnbreaker radiates.',
    },
    {
        id: 'thunderCrown',
        baseWeaponId: 'lightningMark',
        evolvedWeaponId: 'thunderCrown',
        requiredPassiveId: 'cloverCoin',
        evolvedName: 'Stormcrown',
        catalystName: 'Wishing Cinder',
        chestRewardText: 'Stormcrown crackles overhead.',
    },
    {
        id: 'infernoStorm',
        baseWeaponId: 'emberWisp',
        evolvedWeaponId: 'infernoStorm',
        requiredPassiveId: 'powerStone',
        evolvedName: 'Wildpyre',
        catalystName: 'Brightstone',
        chestRewardText: 'Wildpyre erupts.',
    },
    // ── Armory pt. 1 (v1.3) ────────────────────────────────────────────
    // The two evolutions the roster was MISSING (Stormwand, Frostmote) plus
    // one for each of the four new weapon kinds — every base weapon now has
    // an evolution to chase. Every catalyst below sits in ITS WEAPON'S OWN
    // Patron pool (patrons.js): committing that Patron — the realistic path
    // to a base at L8 in-window — favors the catalyst at ×2.6 too, instead
    // of cutting it to the rival ×0.35 rate and starving the recipe.
    {
        id: 'stormsurge',
        baseWeaponId: 'voltWand',
        evolvedWeaponId: 'stormsurge',
        requiredPassiveId: 'featherstep',
        evolvedName: 'Stormsurge',
        catalystName: 'Featherstep',
        chestRewardText: 'Stormsurge crackles alive.',
    },
    {
        id: 'winterveil',
        baseWeaponId: 'frostmote',
        evolvedWeaponId: 'winterveil',
        requiredPassiveId: 'frostbiteCore',
        evolvedName: 'Winterveil',
        catalystName: 'Rimecore',
        chestRewardText: 'Winterveil descends.',
    },
    {
        id: 'twinfangCyclone',
        baseWeaponId: 'ashfang',
        evolvedWeaponId: 'twinfangCyclone',
        requiredPassiveId: 'pyromancersTinder',
        evolvedName: 'Twinfang Cyclone',
        catalystName: 'Tinderheart',
        chestRewardText: 'Twinfang Cyclone whirls.',
    },
    {
        id: 'dawnfireRay',
        baseWeaponId: 'kindleRay',
        evolvedWeaponId: 'dawnfireRay',
        requiredPassiveId: 'secondWind',
        evolvedName: 'Dawnfire Ray',
        catalystName: 'Rekindle',
        chestRewardText: 'Dawnfire Ray ignites.',
    },
    {
        id: 'ashquake',
        baseWeaponId: 'emberMine',
        evolvedWeaponId: 'ashquake',
        requiredPassiveId: 'thorns',
        evolvedName: 'Ashquake',
        catalystName: 'Backdraft',
        chestRewardText: 'Ashquake rumbles underfoot.',
    },
    {
        id: 'wildfireWake',
        baseWeaponId: 'wakefire',
        evolvedWeaponId: 'wildfireWake',
        requiredPassiveId: 'windBoots',
        evolvedName: 'Wildfire Wake',
        catalystName: 'Emberstride',
        chestRewardText: 'Wildfire Wake spreads.',
    },
];

// Returns the subset of EVOLUTIONS the player is currently eligible for:
// owns the base weapon at max level, owns the required passive (any level),
// and hasn't already evolved this weapon.
import { MAX_WEAPON_LEVEL } from '../config/GameConfig.js';
import { WEAPONS } from './weapons.js';

export function findEligibleEvolutions(game) {
    const ownedWeapons = new Map();
    for (const w of game.weaponSystem.owned) ownedWeapons.set(w.id, w);
    const ownedPassives = new Set();
    for (const p of game.passiveSystem.owned) ownedPassives.add(p.id);

    const eligible = [];
    for (const evo of EVOLUTIONS) {
        if (ownedWeapons.has(evo.evolvedWeaponId)) continue;
        const base = ownedWeapons.get(evo.baseWeaponId);
        if (!base) continue;
        // Per-weapon cap, not the global one: abilities like Frostmote max at
        // 5 (def.maxLevel), so the global-8 check would never let them evolve.
        const baseMax = WEAPONS[evo.baseWeaponId]?.maxLevel ?? MAX_WEAPON_LEVEL;
        if (base.level < baseMax) continue;
        if (!ownedPassives.has(evo.requiredPassiveId)) continue;
        eligible.push(evo);
    }
    return eligible;
}
