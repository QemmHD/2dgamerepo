// Playable characters. Each is the shared wick-keeper hero recolored by a
// palette, with a small set of base-stat multipliers that layer UNDER the
// permanent upgrades / gear / passives / run upgrades (CharacterSystem applies
// them first, so everything else still stacks on top cleanly). Cosmetics still
// apply over the selected character where compatible (fur tint, hat, etc.).
//
// Stat fields (all optional, default 1 / 0):
//   hpMul, speedMul, damageMul, cooldownMul (LOWER = faster), pickupRangeMul,
//   xpMul, chestLuckBonus (flat).
//
// All four starters are unlocked by default — this is a power-fantasy choice,
// not a paywall (no battle pass / cases involved per the design limits).

export const CHARACTERS = {
    monkey: {
        id: 'monkey',
        name: 'Pyra',
        title: 'The Emberkin',
        description: 'Balanced wick-keeper. Generous pickup range — the all-rounder.',
        stats: { hpMul: 1, speedMul: 1, damageMul: 1, cooldownMul: 1, pickupRangeMul: 1.12, xpMul: 1 },
        palette: { fur: '#8b5a2b', furDark: '#5a3818', furLight: '#b07a44', face: '#f0d2a5' },
        accent: '#ffb24a',
        unlocked: true,
    },
    elf: {
        id: 'elf',
        name: 'Sylphine',
        title: 'The Swift',
        description: 'Fleet and lucky, but fragile. +12% move speed, better chest luck, −15% HP.',
        stats: { hpMul: 0.85, speedMul: 1.12, damageMul: 1, cooldownMul: 1, pickupRangeMul: 1, xpMul: 1, chestLuckBonus: 1 },
        palette: { fur: '#3f7d52', furDark: '#27543a', furLight: '#62a373', face: '#e9f0d8' },
        accent: '#7fe0a0',
        feature: 'ears',
        unlocked: true,
    },
    orc: {
        id: 'orc',
        name: 'Gruk',
        title: 'The Unbroken',
        description: 'A wall of muscle. +35% HP and +15% damage, but −10% move speed.',
        stats: { hpMul: 1.35, speedMul: 0.9, damageMul: 1.15, cooldownMul: 1, pickupRangeMul: 1, xpMul: 1 },
        palette: { fur: '#5f7d3a', furDark: '#3c5224', furLight: '#82a352', face: '#cdd9a0' },
        accent: '#b6d05a',
        feature: 'tusks',
        unlocked: true,
    },
    wizard: {
        id: 'wizard',
        name: 'Orin',
        title: 'The Arcane',
        description: 'Frail savant. −12% cooldowns and +15% XP, but −20% HP.',
        stats: { hpMul: 0.8, speedMul: 1, damageMul: 1, cooldownMul: 0.88, pickupRangeMul: 1, xpMul: 1.15 },
        palette: { fur: '#5a4b8c', furDark: '#382f5e', furLight: '#7d6cc0', face: '#e7e0f5' },
        accent: '#a78bff',
        feature: 'hat',
        unlocked: true,
    },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS);
export const DEFAULT_CHARACTER = 'monkey';

export function getCharacter(id) {
    return CHARACTERS[id] || CHARACTERS[DEFAULT_CHARACTER];
}
