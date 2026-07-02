// Weapon fusion recipes — the Wick Shrine "fuse" option. A fusion welds two OWNED
// base weapons into one new SCALABLE weapon (see the `fusion: true` entries in
// weapons.js). Unlike an evolution (base at max level + a passive → maxLevel-1
// payoff), a fusion only needs BOTH ingredients owned at ANY level, consumes both
// slots, and the result keeps leveling. The result also INHERITS the ingredients'
// investment — it starts at floor(avg(levelA, levelB)), clamped to the fusion's
// maxLevel (WeaponSystem.fusedLevel) — so it is never an L8+L8 → L1 punish and
// can never soft-lock a run by eating its only damage source. The maxLevel-5
// clamp DOES mean two maxed ingredients can fuse DOWN in raw focused DPS (the
// beacon fills trade peak damage for whole-crowd burn/shock + shred priming),
// which is why the shrine card shows the exact result level before the player
// commits — an informed trade, not a guaranteed upgrade.
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
    // ── Armory pt. 1 fills (v1.3): the 7 pairs the table was missing. With
    // these, EVERY pair of the six original base weapons (15 total) has a
    // recipe — no more "these two just don't fuse" dead shrines.
    { id: 'dawnlance',     fusedWeaponId: 'dawnlance',     a: 'arcaneBolt',    b: 'holyPulse',     name: 'Dawnlance' },
    { id: 'boltbrand',     fusedWeaponId: 'boltbrand',     a: 'arcaneBolt',    b: 'lightningMark', name: 'Boltbrand' },
    { id: 'pyrewheel',     fusedWeaponId: 'pyrewheel',     a: 'orbitingBlade', b: 'emberWisp',     name: 'Pyrewheel' },
    { id: 'coilhalo',      fusedWeaponId: 'coilhalo',      a: 'orbitingBlade', b: 'voltWand',      name: 'Coil Halo' },
    { id: 'pyrebeacon',    fusedWeaponId: 'pyrebeacon',    a: 'holyPulse',     b: 'emberWisp',     name: 'Pyre Beacon' },
    { id: 'stormbeacon',   fusedWeaponId: 'stormbeacon',   a: 'holyPulse',     b: 'voltWand',      name: 'Storm Beacon' },
    { id: 'tempestcoil',   fusedWeaponId: 'tempestcoil',   a: 'lightningMark', b: 'voltWand',      name: 'Tempest Coil' },
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
