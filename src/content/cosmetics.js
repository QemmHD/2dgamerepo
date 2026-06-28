// Character cosmetics — purely visual, never affect stats.
//
// Five slots, one equipped each: fur, cloak, hat, aura, trail.
// The Player reads the equipped colors at run start and layers them over the
// existing procedural monkey sprite (tint / glow / drawn accessory / trail),
// so no sprite art is regenerated and nothing here touches gameplay.
//
// Each cosmetic:
//   id              stable save key
//   name            display label
//   category        'fur' | 'cloak' | 'hat' | 'aura' | 'trail'
//   rarity          key into RARITIES (UI color only)
//   color           hex used for the tint/glow/draw (null = "none"/natural)
//   shape           (hat only) which procedural accessory to draw
//   description     short flavor
//   defaultUnlocked owned from first launch

export const COSMETICS = {
    // ── Fur tint ────────────────────────────────────────────────────────
    fur_natural: { id: 'fur_natural', category: 'fur', name: 'Natural', rarity: 'common', color: null, description: 'As Pyra was born.', defaultUnlocked: true },
    fur_ashen:   { id: 'fur_ashen',   category: 'fur', name: 'Ashen',    rarity: 'common',    color: '#9aa3ab', description: 'Dusted with cold ash.' },
    fur_ember:   { id: 'fur_ember',   category: 'fur', name: 'Ember',    rarity: 'uncommon',  color: '#ff8a3c', description: 'Lit from within.' },
    fur_frost:   { id: 'fur_frost',   category: 'fur', name: 'Frost',    rarity: 'rare',      color: '#7fe0ff', description: 'Touched by the rime.' },
    fur_void:    { id: 'fur_void',    category: 'fur', name: 'Voidtouched', rarity: 'epic',   color: '#9a6cff', description: 'The Gloam left its mark.' },
    fur_gold:    { id: 'fur_gold',    category: 'fur', name: 'Gilded',   rarity: 'legendary', color: '#ffd35a', description: 'Burnished to gold.' },

    // ── Cloak ───────────────────────────────────────────────────────────
    cloak_none:    { id: 'cloak_none',    category: 'cloak', name: 'No Cloak', rarity: 'common', color: null, description: 'Travel light.', defaultUnlocked: true },
    cloak_dusk:    { id: 'cloak_dusk',    category: 'cloak', name: 'Dusk Cloak',   rarity: 'uncommon',  color: '#3b4a6b', description: 'Woven from twilight.' },
    cloak_crimson: { id: 'cloak_crimson', category: 'cloak', name: 'Crimson Cloak', rarity: 'rare',     color: '#b5384a', description: 'A keeper of the old order.' },
    cloak_royal:   { id: 'cloak_royal',   category: 'cloak', name: 'Royal Cloak',  rarity: 'epic',      color: '#6a3fb5', description: 'Worn by the first vigil.' },
    cloak_dawn:    { id: 'cloak_dawn',    category: 'cloak', name: 'Dawn Cloak',   rarity: 'legendary', color: '#ffaf5e', description: 'It glows at the edges.' },

    // ── Hat / accessory ─────────────────────────────────────────────────
    hat_none:   { id: 'hat_none',   category: 'hat', name: 'Bare',       rarity: 'common', color: null, shape: 'none', description: 'No accessory.', defaultUnlocked: true },
    hat_wool:   { id: 'hat_wool',   category: 'hat', name: 'Wool Cap',   rarity: 'common',    color: '#c46b4a', shape: 'cap',    description: 'Cozy against the dark.' },
    hat_candle: { id: 'hat_candle', category: 'hat', name: 'Candle Crown', rarity: 'rare',    color: '#ffd35a', shape: 'candle', description: 'A wick worn proudly.' },
    hat_horns:  { id: 'hat_horns',  category: 'hat', name: 'Gloam Horns', rarity: 'epic',     color: '#9a6cff', shape: 'horns',  description: 'Taken from a Direhusk.' },
    hat_crown:  { id: 'hat_crown',  category: 'hat', name: 'Ember Crown', rarity: 'legendary', color: '#ffd35a', shape: 'crown', description: 'For the last Wick-Keeper.' },

    // ── Aura (glow + light) ─────────────────────────────────────────────
    aura_ember:   { id: 'aura_ember',   category: 'aura', name: 'Ember Aura',  rarity: 'common', color: '#ff9a3c', description: 'A warm halo.', defaultUnlocked: true },
    aura_frost:   { id: 'aura_frost',   category: 'aura', name: 'Frost Aura',  rarity: 'uncommon',  color: '#7fe0ff', description: 'A cold shimmer.' },
    aura_verdant: { id: 'aura_verdant', category: 'aura', name: 'Verdant Aura', rarity: 'rare',     color: '#5fd36a', description: 'Life clings to you.' },
    aura_violet:  { id: 'aura_violet',  category: 'aura', name: 'Violet Aura', rarity: 'epic',      color: '#b15cff', description: 'The Gloam, tamed.' },
    aura_radiant: { id: 'aura_radiant', category: 'aura', name: 'Radiant Aura', rarity: 'legendary', color: '#ffe9a8', description: 'Pure first light.' },
    aura_mythic:  { id: 'aura_mythic',  category: 'aura', name: 'Mythic Aura', rarity: 'mythic',    color: '#ff4d6d', description: 'It hums with old power.' },

    // ── Trail ───────────────────────────────────────────────────────────
    trail_none:   { id: 'trail_none',   category: 'trail', name: 'No Trail', rarity: 'common', color: null, description: 'Leave no mark.', defaultUnlocked: true },
    trail_sparks: { id: 'trail_sparks', category: 'trail', name: 'Spark Trail', rarity: 'uncommon', color: '#ffb24a', description: 'Embers in your wake.' },
    trail_frost:  { id: 'trail_frost',  category: 'trail', name: 'Frost Trail', rarity: 'rare',     color: '#9fe8ff', description: 'A breath of winter.' },
    trail_petals: { id: 'trail_petals', category: 'trail', name: 'Petal Trail', rarity: 'epic',     color: '#ff7eb0', description: 'Soft and strange.' },
};

export const COSMETIC_LIST = Object.values(COSMETICS);
export const COSMETIC_CATEGORIES = ['fur', 'cloak', 'hat', 'aura', 'trail'];
export const COSMETIC_CATEGORY_LABELS = { fur: 'Fur', cloak: 'Cloak', hat: 'Accessory', aura: 'Aura', trail: 'Trail' };

export const DEFAULT_UNLOCKED_COSMETICS = COSMETIC_LIST.filter((c) => c.defaultUnlocked).map((c) => c.id);
export const DEFAULT_EQUIPPED_COSMETICS = { fur: 'fur_natural', cloak: 'cloak_none', hat: 'hat_none', aura: 'aura_ember', trail: 'trail_none' };

export function cosmeticById(id) {
    return COSMETICS[id] ?? null;
}

export function cosmeticsByCategory(category) {
    return COSMETIC_LIST.filter((c) => c.category === category);
}

// Resolve an equipped-cosmetics map (ids) into the concrete colors/shapes the
// Player renderer needs. Falls back to slot defaults for missing/locked ids.
export function resolveAppearance(equipped) {
    const e = equipped ?? {};
    const fur = COSMETICS[e.fur] ?? COSMETICS.fur_natural;
    const cloak = COSMETICS[e.cloak] ?? COSMETICS.cloak_none;
    const hat = COSMETICS[e.hat] ?? COSMETICS.hat_none;
    const aura = COSMETICS[e.aura] ?? COSMETICS.aura_ember;
    const trail = COSMETICS[e.trail] ?? COSMETICS.trail_none;
    return {
        furColor: fur.color,
        cloakColor: cloak.color,
        hatShape: hat.shape ?? 'none',
        hatColor: hat.color,
        auraColor: aura.color,
        trailColor: trail.color,
    };
}
