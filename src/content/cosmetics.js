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
//   shape           (hat only) which procedural accessory to draw — one of:
//                   none | cap | candle | horns | crown | hood | tophat |
//                   flower | antlers | halo | party | banana
//                   (each authored in PixelArt.pixelHat)
//   fx              (aura/trail only) animated VFX style — the prestige layer:
//                   aura:  pulse | spin | flame | rainbow | starfield
//                   trail: rainbow | flame | stars | hearts
//                   (rendered by assets/CosmeticFx.js in-game AND in the menu)
//   description     short flavor
//   defaultUnlocked owned from first launch
//
// Unlock sources (a cosmetic may carry one; otherwise it is case-only loot):
//   defaultUnlocked   free from the start
//   coinCost          buy directly with coins in the customizer
//   achievement       auto-unlocked when that achievement id is earned
//   (none of the above) → earned only as a random case drop
// All cosmetics also remain in the case loot pool regardless, so cases stay a
// gamble path to everything; coins/achievements are the deterministic paths.

export const COSMETICS = {
    // ── Fur tint ────────────────────────────────────────────────────────
    fur_natural: { id: 'fur_natural', category: 'fur', name: 'Natural', rarity: 'common', color: null, description: 'As Pyra was born.', defaultUnlocked: true },
    fur_ashen:   { id: 'fur_ashen',   category: 'fur', name: 'Ashen',    rarity: 'common',    color: '#9aa3ab', coinCost: 150, description: 'Dusted with cold ash.' },
    fur_ember:   { id: 'fur_ember',   category: 'fur', name: 'Ember',    rarity: 'uncommon',  color: '#ff8a3c', coinCost: 400, description: 'Lit from within.' },
    fur_frost:   { id: 'fur_frost',   category: 'fur', name: 'Frost',    rarity: 'rare',      color: '#7fe0ff', description: 'Touched by the rime.' },
    fur_jade:    { id: 'fur_jade',    category: 'fur', name: 'Mossback',  rarity: 'uncommon',  color: '#6fcf7f', description: 'Green as deep wood.', defaultUnlocked: true },
    fur_rose:    { id: 'fur_rose',    category: 'fur', name: 'Roseate',   rarity: 'uncommon',  color: '#ff9ec4', description: 'Petal-soft and warm.', defaultUnlocked: true },
    fur_void:    { id: 'fur_void',    category: 'fur', name: 'Voidtouched', rarity: 'epic',   color: '#9a6cff', achievement: 'kills_10k', description: 'The Gloam left its mark.' },
    fur_shadow:  { id: 'fur_shadow',  category: 'fur', name: 'Umbral',    rarity: 'rare',      color: '#54566b', description: 'Half-lost to shade.' },
    fur_gold:    { id: 'fur_gold',    category: 'fur', name: 'Gilded',   rarity: 'legendary', color: '#ffd35a', achievement: 'coins_10k', description: 'Burnished to gold.' },
    fur_galaxy:  { id: 'fur_galaxy',  category: 'fur', name: 'Galactic', rarity: 'mythic',    color: '#6a4fb0', coinCost: 4500, description: 'Star-stuff, worn as a coat.' },

    // ── Cloak ───────────────────────────────────────────────────────────
    cloak_none:    { id: 'cloak_none',    category: 'cloak', name: 'No Cloak', rarity: 'common', color: null, description: 'Travel light.', defaultUnlocked: true },
    cloak_dusk:    { id: 'cloak_dusk',    category: 'cloak', name: 'Dusk Cloak',   rarity: 'uncommon',  color: '#3b4a6b', coinCost: 200, description: 'Woven from twilight.' },
    cloak_crimson: { id: 'cloak_crimson', category: 'cloak', name: 'Crimson Cloak', rarity: 'rare',     color: '#b5384a', description: 'A keeper of the old order.' },
    cloak_verdant: { id: 'cloak_verdant', category: 'cloak', name: 'Verdant Cloak', rarity: 'uncommon', color: '#2f7d4f', description: 'Mossy and well-worn.', defaultUnlocked: true },
    cloak_royal:   { id: 'cloak_royal',   category: 'cloak', name: 'Royal Cloak',  rarity: 'epic',      color: '#6a3fb5', achievement: 'bosses_25', description: 'Worn by the first vigil.' },
    cloak_frost:   { id: 'cloak_frost',   category: 'cloak', name: 'Frostweave Cloak', rarity: 'rare', color: '#6fb7d8', coinCost: 700, description: 'Stiff with rime.' },
    cloak_shadow:  { id: 'cloak_shadow',  category: 'cloak', name: 'Umbral Cloak', rarity: 'epic',      color: '#2a2740', achievement: 'hard_win', description: 'It drinks the light.' },
    cloak_dawn:    { id: 'cloak_dawn',    category: 'cloak', name: 'Dawn Cloak',   rarity: 'legendary', color: '#ffaf5e', achievement: 'playtime_1h', description: 'It glows at the edges.' },
    cloak_gold:    { id: 'cloak_gold',    category: 'cloak', name: 'Gilded Cloak', rarity: 'legendary', color: '#d8a93a', achievement: 'gauntlet_8k', description: 'Threadwork of pure gold.' },
    cloak_prism:   { id: 'cloak_prism',   category: 'cloak', name: 'Prismatic Cloak', rarity: 'mythic', color: '#b15cff', coinCost: 4000, description: 'It shifts through every hue.' },

    // ── Hat / accessory ─────────────────────────────────────────────────
    hat_none:   { id: 'hat_none',   category: 'hat', name: 'Bare',       rarity: 'common', color: null, shape: 'none', description: 'No accessory.', defaultUnlocked: true },
    hat_wool:   { id: 'hat_wool',   category: 'hat', name: 'Wool Cap',   rarity: 'common',    color: '#c46b4a', shape: 'cap',    coinCost: 150, description: 'Cozy against the dark.' },
    hat_candle: { id: 'hat_candle', category: 'hat', name: 'Candle Crown', rarity: 'rare',    color: '#ffd35a', shape: 'candle', description: 'A wick worn proudly.' },
    hat_horns:  { id: 'hat_horns',  category: 'hat', name: 'Gloam Horns', rarity: 'epic',     color: '#9a6cff', shape: 'horns',  description: 'Taken from a Direhusk.' },
    hat_hood:   { id: 'hat_hood',   category: 'hat', name: "Wanderer's Hood", rarity: 'uncommon', color: '#6a6f7d', shape: 'hood',   description: 'For the long road.', defaultUnlocked: true },
    hat_flower: { id: 'hat_flower', category: 'hat', name: 'Flower Crown', rarity: 'uncommon', color: '#ff7eb0', shape: 'flower', description: 'Spring, defiantly worn.', defaultUnlocked: true },
    hat_tophat: { id: 'hat_tophat', category: 'hat', name: 'Top Hat',      rarity: 'rare',     color: '#2b2b33', shape: 'tophat', coinCost: 900, description: 'Improbably dapper.' },
    hat_antlers:{ id: 'hat_antlers',category: 'hat', name: 'Elderwood Antlers', rarity: 'epic', color: '#cdb98a', shape: 'antlers', achievement: 'gauntlet_3k', description: 'Grown, not taken.' },
    hat_crown:  { id: 'hat_crown',  category: 'hat', name: 'Ember Crown', rarity: 'legendary', color: '#ffd35a', shape: 'crown', achievement: 'hold_light', description: 'For the last Wick-Keeper.' },
    hat_halo:   { id: 'hat_halo',   category: 'hat', name: "Saint's Halo", rarity: 'legendary', color: '#fff1b8', shape: 'halo',  achievement: 'survive_10', description: 'A quiet, holy light.' },
    hat_party:  { id: 'hat_party',  category: 'hat', name: 'Party Hat',   rarity: 'uncommon', color: '#ff5e8a', shape: 'party',  coinCost: 600, description: 'Every vigil is a celebration.' },
    hat_banana: { id: 'hat_banana', category: 'hat', name: 'Top Banana',  rarity: 'rare',     color: '#ffd35a', shape: 'banana', coinCost: 1500, description: 'Peak monkey fashion.' },

    // ── Aura (glow + light) — the prestige layer carries animated `fx` ───
    aura_ember:   { id: 'aura_ember',   category: 'aura', name: 'Ember Aura',  rarity: 'common', color: '#ff9a3c', description: 'A warm halo.', defaultUnlocked: true },
    aura_frost:   { id: 'aura_frost',   category: 'aura', name: 'Frost Aura',  rarity: 'uncommon',  color: '#7fe0ff', coinCost: 300, description: 'A cold shimmer.' },
    aura_verdant: { id: 'aura_verdant', category: 'aura', name: 'Verdant Aura', rarity: 'rare',     color: '#5fd36a', description: 'Life clings to you.' },
    aura_rose:    { id: 'aura_rose',    category: 'aura', name: 'Rose Aura',   rarity: 'uncommon',  color: '#ff7eb0', description: 'A soft pink glow.', defaultUnlocked: true },
    aura_violet:  { id: 'aura_violet',  category: 'aura', name: 'Violet Aura', rarity: 'epic',      color: '#b15cff', fx: 'pulse', achievement: 'wave_master', description: 'The Gloam, tamed.' },
    aura_shadow:  { id: 'aura_shadow',  category: 'aura', name: 'Umbral Aura', rarity: 'rare',      color: '#6a4fb0', description: 'A dim, watchful halo.' },
    aura_radiant: { id: 'aura_radiant', category: 'aura', name: 'Radiant Aura', rarity: 'legendary', color: '#ffe9a8', fx: 'pulse', achievement: 'level_30', description: 'Pure first light.' },
    aura_gold:    { id: 'aura_gold',    category: 'aura', name: 'Golden Aura', rarity: 'epic',      color: '#ffd35a', coinCost: 1200, description: 'Wealth made of light.' },
    aura_astral:  { id: 'aura_astral',  category: 'aura', name: 'Astral Aura', rarity: 'legendary', color: '#9fd0ff', fx: 'starfield', coinCost: 3000, description: 'Stars orbit the chosen.' },
    aura_inferno: { id: 'aura_inferno', category: 'aura', name: 'Inferno Aura', rarity: 'mythic',   color: '#ff5a2a', fx: 'flame', achievement: 'nightmare_10', description: 'It never stops burning.' },
    aura_mythic:  { id: 'aura_mythic',  category: 'aura', name: 'Mythic Aura', rarity: 'mythic',    color: '#ff4d6d', fx: 'spin', description: 'It hums with old power.' },
    aura_prism:   { id: 'aura_prism',   category: 'aura', name: 'Prismatic Aura', rarity: 'mythic', color: '#ffffff', fx: 'rainbow', coinCost: 5000, description: 'Every colour at once — proof you ground for it.' },

    // ── Trail ───────────────────────────────────────────────────────────
    trail_none:   { id: 'trail_none',   category: 'trail', name: 'No Trail', rarity: 'common', color: null, description: 'Leave no mark.', defaultUnlocked: true },
    trail_sparks: { id: 'trail_sparks', category: 'trail', name: 'Spark Trail', rarity: 'uncommon', color: '#ffb24a', coinCost: 250, description: 'Embers in your wake.' },
    trail_leaf:   { id: 'trail_leaf',   category: 'trail', name: 'Leaf Trail',  rarity: 'uncommon', color: '#7fd36a', description: 'Green motes drift behind.', defaultUnlocked: true },
    trail_ash:    { id: 'trail_ash',    category: 'trail', name: 'Ash Trail',   rarity: 'uncommon', color: '#b8b0a4', description: 'Soft grey cinders.', defaultUnlocked: true },
    trail_frost:  { id: 'trail_frost',  category: 'trail', name: 'Frost Trail', rarity: 'rare',     color: '#9fe8ff', coinCost: 600, description: 'A breath of winter.' },
    trail_petals: { id: 'trail_petals', category: 'trail', name: 'Petal Trail', rarity: 'epic',     color: '#ff7eb0', description: 'Soft and strange.' },
    trail_void:   { id: 'trail_void',   category: 'trail', name: 'Void Trail',  rarity: 'rare',     color: '#b15cff', achievement: 'cases_25', description: 'It swallows the floor.' },
    trail_gold:   { id: 'trail_gold',   category: 'trail', name: 'Gilt Trail',  rarity: 'epic',     color: '#ffd35a', achievement: 'runs_25', description: 'A wake of gold dust.' },
    trail_hearts: { id: 'trail_hearts', category: 'trail', name: 'Lovestruck',  rarity: 'epic',     color: '#ff5e8a', fx: 'hearts', coinCost: 1200, description: 'Leave a little love behind.' },
    trail_stars:  { id: 'trail_stars',  category: 'trail', name: 'Starfall Trail', rarity: 'legendary', color: '#bfe0ff', fx: 'stars', coinCost: 1800, description: 'Sparks of falling starlight.' },
    trail_flame:  { id: 'trail_flame',  category: 'trail', name: 'Inferno Trail', rarity: 'legendary', color: '#ff7a2a', fx: 'flame', coinCost: 2500, description: 'A blazing wake.' },
    trail_rainbow:{ id: 'trail_rainbow',category: 'trail', name: 'Prism Trail', rarity: 'mythic',   color: '#ffffff', fx: 'rainbow', coinCost: 4000, description: 'A rainbow road, hard-earned.' },
};

export const COSMETIC_LIST = Object.values(COSMETICS);
export const COSMETIC_CATEGORIES = ['fur', 'cloak', 'hat', 'aura', 'trail'];
export const COSMETIC_CATEGORY_LABELS = { fur: 'Fur', cloak: 'Cloak', hat: 'Accessory', aura: 'Aura', trail: 'Trail' };

export const DEFAULT_UNLOCKED_COSMETICS = COSMETIC_LIST.filter((c) => c.defaultUnlocked).map((c) => c.id);
export const DEFAULT_EQUIPPED_COSMETICS = { fur: 'fur_natural', cloak: 'cloak_none', hat: 'hat_none', aura: 'aura_ember', trail: 'trail_none' };

export function cosmeticById(id) {
    return COSMETICS[id] ?? null;
}

// Grind multiplier on the direct coin-buy price of a cosmetic. Cosmetics are a
// long-haul coin sink; bump this to make buying them grindier without editing
// every entry. The SINGLE source of truth for the buy price — the customizer
// display AND the purchase deduction both call this, so they never drift.
export const COSMETIC_COST_MULT = 2;
export function cosmeticCoinCost(item) {
    if (!item || !item.coinCost) return 0;
    return Math.round(item.coinCost * COSMETIC_COST_MULT);
}

export function cosmeticsByCategory(category) {
    return COSMETIC_LIST.filter((c) => c.category === category);
}

// Cosmetic ids that an achievement grants on completion (achievement-locked).
export function cosmeticsForAchievement(achievementId) {
    return COSMETIC_LIST.filter((c) => c.achievement === achievementId).map((c) => c.id);
}

// ── Themed sets ──────────────────────────────────────────────────────────
// Equipping all five matching pieces lights up a purely-cosmetic SET BONUS
// flourish (an extra animated ring) in-game and in the customizer — a reason
// to chase a whole themed look, never a stat change.
export const COSMETIC_SETS = [
    { id: 'inferno',  name: 'Inferno Regalia',  color: '#ff5a2a',
      pieces: { fur: 'fur_ember', cloak: 'cloak_crimson', hat: 'hat_candle', aura: 'aura_inferno', trail: 'trail_flame' } },
    { id: 'astral',   name: 'Astral Vigil',     color: '#9fd0ff',
      pieces: { fur: 'fur_frost', cloak: 'cloak_frost', hat: 'hat_halo', aura: 'aura_astral', trail: 'trail_stars' } },
    { id: 'prism',    name: 'Prismatic Apex',   color: '#ff7edb',
      pieces: { fur: 'fur_galaxy', cloak: 'cloak_prism', hat: 'hat_crown', aura: 'aura_prism', trail: 'trail_rainbow' } },
    { id: 'wildheart', name: 'Wildheart Bloom', color: '#5fd36a',
      pieces: { fur: 'fur_jade', cloak: 'cloak_verdant', hat: 'hat_flower', aura: 'aura_verdant', trail: 'trail_leaf' } },
    { id: 'gloam',    name: 'Gloambound',       color: '#9a6cff',
      pieces: { fur: 'fur_shadow', cloak: 'cloak_shadow', hat: 'hat_horns', aura: 'aura_shadow', trail: 'trail_void' } },
];

// The set whose every piece is currently equipped, or null.
export function activeCosmeticSet(equipped) {
    const e = equipped ?? {};
    for (const s of COSMETIC_SETS) {
        if (COSMETIC_CATEGORIES.every((cat) => e[cat] === s.pieces[cat])) return s;
    }
    return null;
}

// How many pieces of a given set are currently equipped (for "3/5" progress).
export function setProgress(equipped, set) {
    const e = equipped ?? {};
    return COSMETIC_CATEGORIES.reduce((n, cat) => n + (e[cat] === set.pieces[cat] ? 1 : 0), 0);
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
        auraFx: aura.fx ?? null,
        trailColor: trail.color,
        trailFx: trail.fx ?? null,
        set: activeCosmeticSet(equipped),   // { id, name, color } when a full set is on
    };
}
