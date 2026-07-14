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
//   cloakStyle      (cloak only) silhouette variant: classic | splitwatch |
//                   mothwing (resolved for every equipped cloak)
//   shape           (hat only) which procedural accessory to draw — one of:
//                   none | cap | candle | horns | crown | hood | tophat |
//                   flower | antlers | halo | party | banana | waylantern |
//                   mothmask
//                   (each authored in PixelArt.pixelHat)
//   fx              (aura/trail only) animated VFX style — the prestige layer:
//                   aura:  pulse | spin | flame | rainbow | starfield |
//                          oathwheel | gloam_moths
//                   trail: rainbow | flame | stars | hearts | waymarks |
//                          gloam_wisps
//                   (rendered by assets/CosmeticFx.js in-game AND in the menu)
//   description     short flavor
//   defaultUnlocked owned from first launch
//   passLevel         deterministic Vigil Path unlock level
//   caseExcluded      never appears in a random cosmetic case
//
// Unlock sources (a cosmetic may carry one; otherwise it is case-only loot):
//   defaultUnlocked   free from the start
//   coinCost          buy directly with coins in the customizer
//   achievement       auto-unlocked when that achievement id is earned
//   passLevel          deterministic Last Light Vigil milestone
//   (none of the above) → earned only as a random case drop
// Coin/achievement cosmetics remain eligible for cases as an alternate path
// unless they are explicitly marked caseExcluded. Vigil Path and authored
// mastery-set pieces use that flag so their completed sets remain readable
// prestige earned through their named progression route.

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
    fur_vigil:   { id: 'fur_vigil',   category: 'fur', name: 'Vigilforged', rarity: 'epic', color: '#d8643d', passLevel: 10, caseExcluded: true, description: 'Cinder-dark fur lit along every edge.' },
    fur_waylight:{ id: 'fur_waylight',category: 'fur', name: 'Lanternmarked', rarity: 'rare', color: '#c9a76a', achievement: 'waylight_pathfinder', caseExcluded: true, description: 'Warm roadlight caught in every strand.' },

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
    cloak_vigil:   { id: 'cloak_vigil',   category: 'cloak', name: 'Last-Watch Mantle', rarity: 'epic', color: '#8f2f3f', passLevel: 20, caseExcluded: true, description: 'A mantle cut for the final watch.' },
    cloak_waylight:{ id: 'cloak_waylight', category: 'cloak', name: 'Crossroads Mantle', rarity: 'epic', color: '#315b5d', achievement: 'waylight_encounters', caseExcluded: true, description: 'A deep-teal mantle for roads made safe.' },
    cloak_splitwatch:{ id: 'cloak_splitwatch', category: 'cloak', name: 'Splitwatch Mantle', rarity: 'rare', color: '#d98b45', cloakStyle: 'splitwatch', coinCost: 900, caseExcluded: true, description: 'Twin road-panels part cleanly around a keeper in motion.' },
    cloak_mothwing:{ id: 'cloak_mothwing', category: 'cloak', name: 'Duskmoth Wings', rarity: 'legendary', color: '#76538f', cloakStyle: 'mothwing', description: 'Broad velvet wings carry the hush of the Gloam.' },

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
    hat_vigil:  { id: 'hat_vigil', category: 'hat', name: 'Crown of Cinders', rarity: 'legendary', color: '#ffb24a', shape: 'crown', passLevel: 30, caseExcluded: true, description: 'Five embers for five sworn milestones.' },
    hat_waylight:{ id: 'hat_waylight', category: 'hat', name: 'Wayfinder Halo', rarity: 'epic', color: '#ffe0a0', shape: 'halo', achievement: 'waylight_cartographer', caseExcluded: true, description: 'Four roads resolved into one steady ring.' },
    hat_waylantern:{ id: 'hat_waylantern', category: 'hat', name: 'Waylantern', rarity: 'epic', color: '#ffd06a', shape: 'waylantern', coinCost: 1400, caseExcluded: true, description: 'A road lantern worn high enough to guide the whole party.' },
    hat_mothmask:{ id: 'hat_mothmask', category: 'hat', name: 'Duskmoth Mask', rarity: 'epic', color: '#b896cb', shape: 'mothmask', description: 'Soft antennae frame a moon-pale watch mask.' },

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
    aura_mythic:  { id: 'aura_mythic',  category: 'aura', name: 'Last Light Aura', rarity: 'mythic', color: '#ff4d6d', fx: 'spin', passLevel: 50, caseExcluded: true, description: 'The final ember answers only to you.' },
    aura_waylight:{ id: 'aura_waylight', category: 'aura', name: 'Beacon Orbit', rarity: 'legendary', color: '#ffd27a', fx: 'spin', achievement: 'waylight_warden', caseExcluded: true, description: 'Every rekindled beacon turns in its glow.' },
    aura_prism:   { id: 'aura_prism',   category: 'aura', name: 'Prismatic Aura', rarity: 'mythic', color: '#ffffff', fx: 'rainbow', coinCost: 5000, description: 'Every colour at once — proof you ground for it.' },
    aura_oathwheel:{ id: 'aura_oathwheel', category: 'aura', name: 'Oathwheel Aura', rarity: 'legendary', color: '#ffc85a', fx: 'oathwheel', coinCost: 2400, caseExcluded: true, description: 'Four bright vows turn around a steady central flame.' },
    aura_gloam_moths:{ id: 'aura_gloam_moths', category: 'aura', name: 'Gloam Mothwake', rarity: 'mythic', color: '#a779c5', fx: 'gloam_moths', description: 'Moonlit moths gather wherever the darkness thins.' },

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
    trail_vigil:  { id: 'trail_vigil', category: 'trail', name: 'Oathspark Trail', rarity: 'legendary', color: '#ff9a3c', fx: 'stars', passLevel: 40, caseExcluded: true, description: 'Each footfall writes a tiny ember oath.' },
    trail_waylight:{ id: 'trail_waylight', category: 'trail', name: 'Starpath Trail', rarity: 'legendary', color: '#ffcf78', fx: 'stars', achievement: 'waylight_guardian', caseExcluded: true, description: 'Safe crossings shine behind the pathkeeper.' },
    trail_waymarks:{ id: 'trail_waymarks', category: 'trail', name: 'Waymark Trail', rarity: 'epic', color: '#73d7c3', fx: 'waymarks', coinCost: 1500, caseExcluded: true, description: 'Tiny route sigils mark every safe step behind you.' },
    trail_gloam_wisps:{ id: 'trail_gloam_wisps', category: 'trail', name: 'Gloam Wisps', rarity: 'rare', color: '#8e70b6', fx: 'gloam_wisps', description: 'Dim wandering lights follow at a respectful distance.' },
};

export const COSMETIC_LIST = Object.values(COSMETICS);
export const COSMETIC_CATEGORIES = ['fur', 'cloak', 'hat', 'aura', 'trail'];
export const COSMETIC_CATEGORY_LABELS = { fur: 'Fur', cloak: 'Cloak', hat: 'Accessory', aura: 'Aura', trail: 'Trail' };

export const DEFAULT_UNLOCKED_COSMETICS = COSMETIC_LIST.filter((c) => c.defaultUnlocked).map((c) => c.id);
export const DEFAULT_EQUIPPED_COSMETICS = { fur: 'fur_natural', cloak: 'cloak_none', hat: 'hat_none', aura: 'aura_ember', trail: 'trail_none' };

export function cosmeticById(id) {
    return typeof id === 'string' && Object.prototype.hasOwnProperty.call(COSMETICS, id)
        ? COSMETICS[id]
        : null;
}

// Stable machine-facing acquisition routes. Keep this order fixed so filters,
// save receipts, and validators never inherit an object's property order.
export const COSMETIC_ACQUISITION_ROUTES = Object.freeze([
    'starter', 'boutique', 'case', 'achievement', 'vigil',
]);

const COSMETIC_ACQUISITION_LABELS = Object.freeze({
    starter: 'Starter',
    boutique: 'Boutique',
    case: 'Case',
    achievement: 'Achievement',
    vigil: 'Vigil Path',
});

const COSMETIC_SOURCE_LABEL_ORDER = Object.freeze([
    'starter', 'boutique', 'achievement', 'vigil', 'case',
]);

// Return every real acquisition route for an item. Starter pieces never enter
// cases, while coin/achievement pieces retain cases as an alternate route only
// when caseExcluded is not set. Strings are accepted for menu/filter callers.
export function getCosmeticAcquisitionRoutes(itemOrId) {
    const item = typeof itemOrId === 'string' ? cosmeticById(itemOrId) : itemOrId;
    if (!item || typeof item !== 'object') return Object.freeze([]);
    const routes = [];
    if (item.defaultUnlocked === true) routes.push('starter');
    if (Number.isFinite(item.coinCost) && item.coinCost > 0) routes.push('boutique');
    if (item.defaultUnlocked !== true && item.caseExcluded !== true) routes.push('case');
    if (typeof item.achievement === 'string' && item.achievement) routes.push('achievement');
    if (Number.isInteger(item.passLevel) && item.passLevel > 0) routes.push('vigil');
    return Object.freeze(routes);
}

// Labels prioritize authored achievements/progression before the random-case
// alternate, even though the route array above keeps its machine-stable order.
// Example: ['case', 'achievement'] is displayed as "Achievement · Case".
export function getCosmeticSourceLabel(itemOrId) {
    const routes = new Set(getCosmeticAcquisitionRoutes(itemOrId));
    return COSMETIC_SOURCE_LABEL_ORDER
        .filter((route) => routes.has(route))
        .map((route) => COSMETIC_ACQUISITION_LABELS[route])
        .join(' · ');
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
    { id: 'lastlight', name: 'Last Light Regalia', color: '#ff8a3a',
      pieces: { fur: 'fur_vigil', cloak: 'cloak_vigil', hat: 'hat_vigil', aura: 'aura_mythic', trail: 'trail_vigil' } },
    { id: 'waylight', name: 'Waylight Regalia', color: '#ffcf78',
      pieces: { fur: 'fur_waylight', cloak: 'cloak_waylight', hat: 'hat_waylight', aura: 'aura_waylight', trail: 'trail_waylight' } },
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
    { id: 'lanternward', name: 'Lanternward', color: '#ffc85a',
      pieces: { fur: 'fur_waylight', cloak: 'cloak_splitwatch', hat: 'hat_waylantern', aura: 'aura_oathwheel', trail: 'trail_waymarks' } },
    { id: 'duskmoth', name: 'Duskmoth Court', color: '#9a70b7',
      pieces: { fur: 'fur_shadow', cloak: 'cloak_mothwing', hat: 'hat_mothmask', aura: 'aura_gloam_moths', trail: 'trail_gloam_wisps' } },
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
    const fur = cosmeticById(e.fur) ?? COSMETICS.fur_natural;
    const cloak = cosmeticById(e.cloak) ?? COSMETICS.cloak_none;
    const hat = cosmeticById(e.hat) ?? COSMETICS.hat_none;
    const aura = cosmeticById(e.aura) ?? COSMETICS.aura_ember;
    const trail = cosmeticById(e.trail) ?? COSMETICS.trail_none;
    // Rarity drives the prestige VFX layer (see CosmeticFx.drawRarityFx):
    // the flashiest equipped piece sets the tier, and its own color drives the
    // effect so a legendary crown flashes GOLD, not a generic rarity hue.
    const tiers = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythic: 6 };
    let fxTier = 0, fxColor = null;
    for (const c of [fur, cloak, hat, aura, trail]) {
        const t = tiers[c.rarity] || 1;
        // 'none' placeholder slots never count toward prestige
        if (!c.color && (c.shape === 'none' || c.id.endsWith('_none'))) continue;
        if (t > fxTier) { fxTier = t; fxColor = c.color || '#ffd35a'; }
    }
    return {
        furColor: fur.color,
        cloakColor: cloak.color,
        cloakStyle: cloak.cloakStyle ?? 'classic',
        hatShape: hat.shape ?? 'none',
        hatColor: hat.color,
        hatRarity: tiers[hat.rarity] || 1,
        auraColor: aura.color,
        auraFx: aura.fx ?? null,
        trailColor: trail.color,
        trailFx: trail.fx ?? null,
        fxTier,                              // 1..6 — highest equipped rarity
        fxColor,                             // that piece's own color
        set: activeCosmeticSet(equipped),   // { id, name, color } when a full set is on
    };
}
