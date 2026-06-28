// Rarity tiers shared by gear, cosmetics, and case rewards.
//
// Each rarity has:
//   id     stable key stored in save data
//   name   display label
//   tier   1..6 numeric rank (higher = rarer/better)
//   color  primary UI color (borders, text, rarity chips)
//   glow   translucent variant for card glows / case reveals
//   dust   coin value a DUPLICATE of this rarity converts into
//
// Rarity is data-only: nothing here references gameplay systems, so the
// table can grow without touching the loadout/case/battle-pass code.

export const RARITIES = {
    common:    { id: 'common',    name: 'Common',    tier: 1, color: '#b8c2cc', glow: 'rgba(184,194,204,0.55)', dust: 8 },
    uncommon:  { id: 'uncommon',  name: 'Uncommon',  tier: 2, color: '#5fd36a', glow: 'rgba(95,211,106,0.55)',  dust: 18 },
    rare:      { id: 'rare',      name: 'Rare',      tier: 3, color: '#4aa3ff', glow: 'rgba(74,163,255,0.55)',  dust: 40 },
    epic:      { id: 'epic',      name: 'Epic',      tier: 4, color: '#b15cff', glow: 'rgba(177,92,255,0.6)',   dust: 90 },
    legendary: { id: 'legendary', name: 'Legendary', tier: 5, color: '#ffb02e', glow: 'rgba(255,176,46,0.65)',  dust: 200 },
    mythic:    { id: 'mythic',    name: 'Mythic',    tier: 6, color: '#ff4d6d', glow: 'rgba(255,77,109,0.7)',   dust: 500 },
};

// Low → high, the canonical ordering used by UIs and odds tables.
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

export function rarityColor(id) {
    return (RARITIES[id] ?? RARITIES.common).color;
}

export function rarityGlow(id) {
    return (RARITIES[id] ?? RARITIES.common).glow;
}

export function rarityName(id) {
    return (RARITIES[id] ?? RARITIES.common).name;
}

export function rarityTier(id) {
    return (RARITIES[id] ?? RARITIES.common).tier;
}

// Coins a duplicate of this rarity refunds when a case rolls something the
// player already owns.
export function rarityDust(id) {
    return (RARITIES[id] ?? RARITIES.common).dust;
}
