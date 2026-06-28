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
];

// Returns the subset of EVOLUTIONS the player is currently eligible for:
// owns the base weapon at max level, owns the required passive (any level),
// and hasn't already evolved this weapon.
import { MAX_WEAPON_LEVEL } from '../config/GameConfig.js';

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
        if (base.level < MAX_WEAPON_LEVEL) continue;
        if (!ownedPassives.has(evo.requiredPassiveId)) continue;
        eligible.push(evo);
    }
    return eligible;
}
