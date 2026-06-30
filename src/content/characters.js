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
    berserker: {
        id: 'berserker',
        name: 'Kael',
        title: 'The Emberfury',
        description: 'Glass berserker. +18% damage and innate Last Light rage, but −22% HP — strongest on the brink.',
        stats: { hpMul: 0.78, speedMul: 1.06, damageMul: 1.18, cooldownMul: 1, pickupRangeMul: 1, xpMul: 1, lowHpRageBonus: 0.15 },
        palette: { fur: '#a23a2a', furDark: '#6e2017', furLight: '#d65a3e', face: '#f3cdb9' },
        accent: '#ff6a3c',
        feature: 'horns',
        unlocked: true,
    },
    assassin: {
        id: 'assassin',
        name: 'Vesper',
        title: 'The Keen',
        description: 'Hooded duelist. +12% crit chance and +5% damage, slightly fragile (−10% HP).',
        stats: { hpMul: 0.9, speedMul: 1.04, damageMul: 1.05, cooldownMul: 1, pickupRangeMul: 1, xpMul: 1, critChanceBonus: 0.12 },
        palette: { fur: '#3a4a66', furDark: '#222d42', furLight: '#5a6e92', face: '#dfe6f2' },
        accent: '#7fd0ff',
        feature: 'hood',
        unlocked: true,
    },

    // ── Imported LPC-bodied heroes ──────────────────────────────────────
    // Real Liberated Pixel Cup character bodies (CC-BY-SA 3.0 / GPL 3.0 — see
    // ASSET_CREDITS.md), not the chibi wick-keeper silhouette. `lpc: true` +
    // `lpcModel` route getCharacterFrames() to the imported sprite, and the
    // recolorable LPC cloak cosmetic layers properly on these full-body frames.
    // accent / palette.face still feed the HUD + menu chrome.
    lpcKnight: {
        id: 'lpcKnight',
        name: 'Sir Aldric',
        title: 'The Vanguard',
        description: 'Imported LPC vanguard. Sturdy all-rounder: +15% HP. Cloaks fit him properly.',
        stats: { hpMul: 1.15, speedMul: 1, damageMul: 1, cooldownMul: 1, pickupRangeMul: 1, xpMul: 1 },
        palette: { fur: '#c9b48f', furDark: '#7a6b50', furLight: '#e6d6b2', face: '#f0d2a5' },
        accent: '#ffd27a',
        lpc: true, lpcModel: 'human',
        unlocked: true,
    },
    lpcWarchief: {
        id: 'lpcWarchief',
        name: 'Brakka',
        title: 'The Warchief',
        description: 'Imported LPC orc warchief. +30% HP, +12% damage, −8% move speed.',
        stats: { hpMul: 1.30, speedMul: 0.92, damageMul: 1.12, cooldownMul: 1, pickupRangeMul: 1, xpMul: 1 },
        palette: { fur: '#5fae54', furDark: '#356b30', furLight: '#82c873', face: '#cdd9a0' },
        accent: '#9be36a',
        lpc: true, lpcModel: 'orc',
        unlocked: true,
    },
    lpcRevenant: {
        id: 'lpcRevenant',
        name: 'Morthys',
        title: 'The Revenant',
        description: 'Imported LPC revenant. Glass cannon: +15% damage and −10% cooldowns, −20% HP.',
        stats: { hpMul: 0.80, speedMul: 1.05, damageMul: 1.15, cooldownMul: 0.90, pickupRangeMul: 1, xpMul: 1 },
        palette: { fur: '#e8eef0', furDark: '#8a929a', furLight: '#ffffff', face: '#e8eef0' },
        accent: '#cfe8ee',
        lpc: true, lpcModel: 'skeleton',
        unlocked: true,
    },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS);
export const DEFAULT_CHARACTER = 'monkey';

export function getCharacter(id) {
    return CHARACTERS[id] || CHARACTERS[DEFAULT_CHARACTER];
}
