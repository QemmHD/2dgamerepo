// Weapon fusion recipes — the Wick Shrine "fuse" option. A fusion welds two OWNED
// base weapons into one new SCALABLE weapon (see the `fusion: true` entries in
// weapons.js). Unlike an evolution (base at max level + a passive → maxLevel-1
// payoff), a fusion only needs BOTH ingredients owned at ANY level, consumes both
// slots, and the result keeps leveling — so it's a net-neutral-or-better slot
// trade that can never soft-lock a run by eating its only damage source.
//
// Add a fusion by appending a recipe here + its weapon def in weapons.js — no
// system code change.

export const FUSIONS = [
    { id: 'cinderlance',   fusedWeaponId: 'cinderlance',   a: 'arcaneBolt',    b: 'emberWisp',     name: 'Cinderlance' },
    { id: 'stormlance',    fusedWeaponId: 'stormlance',    a: 'arcaneBolt',    b: 'voltWand',      name: 'Stormlance' },
    { id: 'emberstorm',    fusedWeaponId: 'emberstorm',    a: 'emberWisp',     b: 'lightningMark', name: 'Emberstorm' },
    { id: 'glacialbeacon', fusedWeaponId: 'glacialbeacon', a: 'orbitingBlade', b: 'holyPulse',     name: 'Glacial Beacon' },
    { id: 'judgmentpulse', fusedWeaponId: 'judgmentpulse', a: 'holyPulse',     b: 'lightningMark', name: 'Judgment Pulse' },
    { id: 'cinderhalo',    fusedWeaponId: 'cinderhalo',    a: 'arcaneBolt',    b: 'orbitingBlade', name: 'Cinderhalo' },
    { id: 'voltpyre',      fusedWeaponId: 'voltpyre',      a: 'emberWisp',     b: 'voltWand',      name: 'Voltpyre' },
    { id: 'stormglaive',   fusedWeaponId: 'stormglaive',   a: 'orbitingBlade', b: 'lightningMark', name: 'Stormglaive' },
];

// Fusions the player can forge right now: both ingredient weapons owned (any
// level) and the fusion not already owned. Returns the recipe objects.
export function findEligibleFusions(game) {
    const owned = new Set();
    for (const w of game.weaponSystem.owned) owned.add(w.id);
    const eligible = [];
    for (const f of FUSIONS) {
        if (owned.has(f.fusedWeaponId)) continue;   // already forged
        if (owned.has(f.a) && owned.has(f.b)) eligible.push(f);
    }
    return eligible;
}
