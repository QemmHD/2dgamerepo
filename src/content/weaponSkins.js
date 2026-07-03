// Weapon-themed visual identity. The player's SELECTED STARTING WEAPON drives a
// cosmetic "skin" overlay drawn on top of the character + equipped cosmetics —
// purely visual, no stat effect. Keyed by the weapon id (the same ids used by
// content/weapons.js). Evolved variants inherit their base weapon's theme via
// resolveWeaponSkin so an evolution never loses its look.
//
// A theme is consumed by drawWeaponSkinOverlay() in ProceduralSprites.js, which
// is shared by BOTH the in-game player sprite and the start-menu preview avatar
// (single source of truth — the two can never diverge).
//
// Fields:
//   name    short label (shown in the menu preview)
//   accent  primary themed colour (sash / trim / emblem fill)
//   glow    additive glow / aura tint for the themed light
//   emblem  which motif drawWeaponSkinOverlay renders:
//           'orb' | 'flame' | 'bolt' | 'blade' | 'sigil' | 'shard' | 'crown'
//   melee   true → this weapon family triggers the player swing animation
//   prop    which HELD pixel weapon the player carries in-hand (getWeaponProp
//           in assets/WeaponProps.js): 'staff'|'wand'|'rod'|'glaive'|'sigil'|
//           'shard'|'totem'. null → no held prop (the aura/orbit IS the visual).

export const WEAPON_SKINS = {
    // Cinderbolt → arcane caster look (purple/blue magic, floating rune orb).
    arcaneBolt:    { name: 'Arcanist',     accent: '#9a6cff', glow: '#7fb0ff', emblem: 'orb',   melee: false, prop: 'staff' },
    // Pyre Wisp → pyromancer (fire orange/red, a curling flame).
    emberWisp:     { name: 'Pyromancer',   accent: '#ff7a3c', glow: '#ff5a2a', emblem: 'flame', melee: false, prop: 'wand'  },
    // Stormwand → voltaic caster (electric blue/yellow bolt).
    voltWand:      { name: 'Voltaic',      accent: '#ffe14a', glow: '#6fb8ff', emblem: 'bolt',  melee: true,  prop: 'rod'   },
    // Frost Glaives → frost duelist (silver/ice, a spinning blade) — melee.
    orbitingBlade: { name: 'Frost Duelist', accent: '#cfe0ff', glow: '#bcd2ff', emblem: 'blade', melee: true, prop: 'glaive' },
    // Beacon Pulse → cleric/paladin (white/gold sigil) — melee-leaning.
    holyPulse:     { name: 'Cleric',       accent: '#ffe9a8', glow: '#fff3c8', emblem: 'sigil', melee: true,  prop: 'sigil' },
    // Stormbrand → stormcaller (blue/yellow, a charged crown) — melee-leaning.
    lightningMark: { name: 'Stormcaller',  accent: '#ffe14a', glow: '#7fd0ff', emblem: 'crown', melee: true,  prop: 'rod'   },
    // Frostmote → frostweaver (blue/white ice shard) — melee-leaning.
    frostmote:     { name: 'Frostweaver',  accent: '#9fe8ff', glow: '#cdf3ff', emblem: 'shard', melee: true,  prop: 'shard' },
    // ── Armory pt. 1 base weapons ──────────────────────────────────────
    // Ashfang → fang-hurler (warm cinder orange, curling flame) — the wand IS
    // the thrower, so no swing.
    ashfang:       { name: 'Fangcaller',   accent: '#ff9a4a', glow: '#ffb060', emblem: 'flame', melee: false, prop: 'wand'  },
    // Kindle Ray → channeler (radiant gold sigil, a steady staff).
    kindleRay:     { name: 'Raykeeper',    accent: '#ffd98a', glow: '#ffe9b0', emblem: 'sigil', melee: false, prop: 'staff' },
    // Cindermine → trapwright (deep ember orb on a planted totem).
    emberMine:     { name: 'Trapwright',   accent: '#ff6a3c', glow: '#ff8a3c', emblem: 'orb',   melee: false, prop: 'totem' },
    // Wakefire → wake-kindler (trailing flame, a light running wand).
    wakefire:      { name: 'Wakekindler',  accent: '#ff8a3c', glow: '#ff6a2a', emblem: 'flame', melee: false, prop: 'wand'  },
};

// Held-prop themes for owned weapons that have no skin entry of their own (the
// movement/utility abilities). Keyed by weapon id. Abilities that read as pure
// aura/movement (cinderAura, shadowDash) intentionally have NO prop — their
// glow ring / dash smear is the visual, so the hero doesn't clutter up holding
// a stick for them.
const WEAPON_PROP_EXTRA = {
    hearthTotem: { prop: 'totem', accent: '#ffce6a', glow: '#ffe6b0' },
};

// Evolved weapon → the base whose theme it inherits.
const EVOLVED_TO_BASE = {
    arcaneStorm: 'arcaneBolt',
    infernoStorm: 'emberWisp',
    celestialBlades: 'orbitingBlade',
    divineNova: 'holyPulse',
    thunderCrown: 'lightningMark',
    // Armory pt. 1 evolutions (incl. the two the roster was missing).
    twinfangCyclone: 'ashfang',
    dawnfireRay: 'kindleRay',
    ashquake: 'emberMine',
    wildfireWake: 'wakefire',
    stormsurge: 'voltWand',
    winterveil: 'frostmote',
};

// FUSED weapons get their own held-prop themes (shape from the dominant
// parent, colours from the fusion's identity) — without these a fused primary
// left the hero EMPTY-HANDED mid-run (resolveWeaponProp returned null).
const FUSED_PROPS = {
    cinderlance:   { prop: 'staff',  accent: '#ff7a3c', glow: '#ffb060' },  // piercing blaze bolts
    stormlance:    { prop: 'staff',  accent: '#9a6cff', glow: '#7fd0ff' },  // arcane bolts arcing shock
    emberstorm:    { prop: 'rod',    accent: '#ff7a3c', glow: '#ffe14a' },  // storm-strikes detonating fire
    voltpyre:      { prop: 'rod',    accent: '#ffe14a', glow: '#ff5a2a' },  // scorching shock bolts
    cinderhalo:    { prop: 'glaive', accent: '#ff9a5c', glow: '#9fe8ff' },  // chilling ember orbit
    glacialbeacon: { prop: 'glaive', accent: '#9fe8ff', glow: '#cdf3ff' },  // deep-freeze glaive ring
    judgmentpulse: { prop: 'sigil',  accent: '#ffe9a8', glow: '#ffd0a8' },  // armor-flaying holy pulse
    stormglaive:   { prop: 'glaive', accent: '#cfe0ff', glow: '#7fd0ff' },  // storm-branded sweeps
    // Armory pt. 1 fusion fills (the 7 previously-missing pairs).
    dawnlance:     { prop: 'staff',  accent: '#ffe9a8', glow: '#fff3c8' },  // radiant ricochet bolts
    boltbrand:     { prop: 'rod',    accent: '#9a8cff', glow: '#7fd0ff' },  // arcane storm-brands
    pyrewheel:     { prop: 'glaive', accent: '#ff9a5c', glow: '#ff7a3c' },  // blazing orbit
    coilhalo:      { prop: 'glaive', accent: '#9fd8ff', glow: '#ffe14a' },  // charged orbit
    pyrebeacon:    { prop: 'sigil',  accent: '#ffb060', glow: '#ff8a3c' },  // burning pulse
    stormbeacon:   { prop: 'sigil',  accent: '#aee2ff', glow: '#7fd0ff' },  // shocking pulse
    tempestcoil:   { prop: 'rod',    accent: '#7fd0ff', glow: '#ffe14a' },  // endless-arc zap
};

// Resolve a weapon id (base, evolved, or unknown) to a skin theme. Falls back to
// the Arcanist theme so the overlay is always defined.
export function resolveWeaponSkin(weaponId) {
    const base = EVOLVED_TO_BASE[weaponId] || weaponId;
    return WEAPON_SKINS[base] || WEAPON_SKINS.arcaneBolt;
}

// True when a weapon family should play the player swing animation.
export function isMeleeWeapon(weaponId) {
    return !!resolveWeaponSkin(weaponId).melee;
}

// Resolve a weapon id (base, evolved, ability) to its HELD-prop descriptor
// { prop, accent, glow }, or null when the weapon carries no in-hand prop.
// Evolved variants inherit their base weapon's prop via EVOLVED_TO_BASE so an
// evolution keeps the right wand/glaive/sigil in hand.
export function resolveWeaponProp(weaponId) {
    if (FUSED_PROPS[weaponId]) return FUSED_PROPS[weaponId];
    const base = EVOLVED_TO_BASE[weaponId] || weaponId;
    const skin = WEAPON_SKINS[base];
    if (skin && skin.prop) return { prop: skin.prop, accent: skin.accent, glow: skin.glow };
    const extra = WEAPON_PROP_EXTRA[base];
    if (extra) return { prop: extra.prop, accent: extra.accent, glow: extra.glow };
    return null;
}
