// LoadoutSystem — bridges saved loadout gear into a run.
//
// Two jobs, both at run start:
//   resolveStartingWeapon(save) → the WEAPONS id the run should begin with
//                                 (from the equipped 'weapon' gear slot)
//   applyLoadout(player, save)  → fold every equipped gear item's buffs into
//                                 the freshly-built player, exactly once
//
// Buffs stack multiplicatively/additively with permanent upgrades and passives
// because they all mutate the same player stat fields (see gear.js applyBuffs).
// Gear is permanent: it only changes when the save changes, never per-run.

import { GEAR, applyBuffs } from '../content/gear.js';

export function resolveStartingWeapon(save) {
    const equipped = save?.gear?.equipped ?? {};
    const item = GEAR[equipped.weapon];
    return item && item.category === 'weapon' && item.weaponId ? item.weaponId : 'arcaneBolt';
}

// Apply buffs from every equipped gear slot. Safe to call once per run AFTER
// permanent upgrades (so multipliers compound on top of them).
export function applyLoadout(player, save) {
    const equipped = save?.gear?.equipped ?? {};
    for (const slot of Object.keys(equipped)) {
        const item = GEAR[equipped[slot]];
        if (item && item.category === slot) applyBuffs(player, item.buffs);
    }
}

// Equipped gear summary for the Play/Loadout UI: one entry per slot.
export function loadoutSummary(save) {
    const equipped = save?.gear?.equipped ?? {};
    return Object.keys(equipped).map((slot) => ({
        slot,
        item: GEAR[equipped[slot]] ?? null,
    }));
}
