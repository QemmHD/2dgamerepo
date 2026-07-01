// Playable characters. Each is the shared wick-keeper hero recolored by a
// palette, with a small set of base-stat multipliers that layer UNDER the
// permanent upgrades / gear / passives / run upgrades (CharacterSystem applies
// them first, so everything else still stacks on top cleanly). Cosmetics still
// apply over the selected character where compatible (fur tint, hat, etc.).
//
// Each hero also carries a SIGNATURE — a named identity that pre-seeds one or
// two of the game's existing modifier systems (the same fields passives / relics
// / pacts feed), so a hero plays distinctly from frame one and everything still
// stacks on top. Signatures are a careful rebalance: they only touch already-
// wired, bounded fields (regen + kill-heal route through the sustained-heal cap;
// thorns/mitigation/crit/burn are all pre-existing), never raw runaway damage.
//
// Stat fields (all optional, default 1 / 0):
//   hpMul, speedMul, damageMul, cooldownMul (LOWER = faster), pickupRangeMul,
//   xpMul, chestLuckBonus (flat), critChanceBonus (flat), lowHpRageBonus (flat).
//   Signature fields: regenBonus (+HP/s), killHealBonus (+HP/kill), thornsBonus
//   (+reflect frac), damageTakenMul (×, <1 = tankier), coinMul (×), burnDamageMul
//   (×), chillBonus (+chill strength), critMulBonus (+crit multiplier), aegis
//   (bool → the below-half-HP damage cut). All applied in CharacterSystem.
//
// All starters are unlocked by default — this is a power-fantasy choice, not a
// paywall (no battle pass / cases involved per the design limits).

export const CHARACTERS = {
    monkey: {
        id: 'monkey',
        name: 'Pyra',
        title: 'The Emberkin',
        description: 'Balanced wick-keeper. Generous pickup range — the all-rounder.',
        stats: { hpMul: 1, speedMul: 1, damageMul: 1, cooldownMul: 1, pickupRangeMul: 1.2, xpMul: 1, regenBonus: 1.0 },
        signature: { name: 'Wellspring', blurb: 'Mends over time; draws wicks from farther.' },
        palette: { fur: '#8b5a2b', furDark: '#5a3818', furLight: '#b07a44', face: '#f0d2a5' },
        accent: '#ffb24a',
        unlocked: true,
    },
    elf: {
        id: 'elf',
        name: 'Sylphine',
        title: 'The Swift',
        description: 'Fleet and lucky, but fragile. +12% move speed, better chest luck, −15% HP.',
        stats: { hpMul: 0.85, speedMul: 1.12, damageMul: 1, cooldownMul: 1, pickupRangeMul: 1, xpMul: 1, chestLuckBonus: 2, coinMul: 1.3 },
        signature: { name: 'Windfall', blurb: "Fortune's favorite — richer coin, luckier chests." },
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
        stats: { hpMul: 1.35, speedMul: 0.9, damageMul: 1.15, cooldownMul: 1, pickupRangeMul: 1, xpMul: 1, damageTakenMul: 0.87, thornsBonus: 0.3 },
        signature: { name: 'Unbroken', blurb: 'A living wall — shrugs off blows and returns the pain.' },
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
        stats: { hpMul: 0.8, speedMul: 1, damageMul: 1, cooldownMul: 0.88, pickupRangeMul: 1, xpMul: 1.15, burnDamageMul: 1.35, chillBonus: 0.15 },
        signature: { name: 'Embermind', blurb: 'Arcane fire — burns bite deeper, frost clings harder.' },
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
        stats: { hpMul: 0.78, speedMul: 1.06, damageMul: 1.18, cooldownMul: 1, pickupRangeMul: 1, xpMul: 1, lowHpRageBonus: 0.3, killHealBonus: 2 },
        signature: { name: 'Last Light', blurb: 'Deadliest at the brink — each kill rekindles the fire.' },
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
        stats: { hpMul: 0.9, speedMul: 1.04, damageMul: 1.05, cooldownMul: 1, pickupRangeMul: 1, xpMul: 1, critChanceBonus: 0.15, critMulBonus: 0.5 },
        signature: { name: 'Executioner', blurb: 'Every strike can gut — keener eye, deeper cuts.' },
        palette: { fur: '#3a4a66', furDark: '#222d42', furLight: '#5a6e92', face: '#dfe6f2' },
        accent: '#7fd0ff',
        feature: 'hood',
        unlocked: true,
    },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS);
export const DEFAULT_CHARACTER = 'monkey';

export function getCharacter(id) {
    return CHARACTERS[id] || CHARACTERS[DEFAULT_CHARACTER];
}

// Per-character "weapon hold" style — PURELY VISUAL flavor for the in-hand
// signature weapon (the run's menu-chosen starter, owned[0]), so the roster
// reads distinct in combat rather than every hero gripping its wand
// identically. Projectile aim/spawn is unaffected; this only tweaks the drawn
// prop. Fields (all optional → HOLD_DEFAULTS, the neutral balanced grip):
//   grip      hand distance from the body centre (× spriteHalf)
//   lift      hand vertical offset (× spriteHalf; MORE = held lower)
//   scale     primary prop size multiplier
//   tilt      wrist-angle bias on the held prop, radians (cosmetic lean)
export const HOLD_DEFAULTS = { grip: 0.18, lift: 0.12, scale: 1.0, tilt: 0 };
const CHARACTER_HOLDS = {
    // Sylphine — fleet & elegant: weapon held high & light.
    elf:         { grip: 0.21, lift: 0.00, scale: 0.92, tilt: 0.14 },
    // Gruk — a wall of muscle: big weapon hauled low.
    orc:         { grip: 0.25, lift: 0.18, scale: 1.18, tilt: -0.10 },
    // Orin — arcane savant: staff thrust forward.
    wizard:      { grip: 0.27, lift: 0.05, scale: 1.12, tilt: 0.04 },
    // Kael — emberfury: aggressive forward thrust.
    berserker:   { grip: 0.28, lift: 0.11, scale: 1.12, tilt: -0.06 },
    // Vesper — keen duelist: weapon kept close & low.
    assassin:    { grip: 0.14, lift: 0.16, scale: 0.90, tilt: 0.18 },
};

// Resolve a character id to its weapon-hold style merged over the defaults
// (so the balanced monkey + any unlisted/future hero get the neutral grip).
export function resolveCharacterHold(id) {
    return { ...HOLD_DEFAULTS, ...(CHARACTER_HOLDS[id] || {}) };
}
