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

export const WEAPON_SKINS = {
    // Cinderbolt → arcane caster look (purple/blue magic, floating rune orb).
    arcaneBolt:    { name: 'Arcanist',     accent: '#9a6cff', glow: '#7fb0ff', emblem: 'orb',   melee: false },
    // Pyre Wisp → pyromancer (fire orange/red, a curling flame).
    emberWisp:     { name: 'Pyromancer',   accent: '#ff7a3c', glow: '#ff5a2a', emblem: 'flame', melee: false },
    // Stormwand → voltaic caster (electric blue/yellow bolt).
    voltWand:      { name: 'Voltaic',      accent: '#ffe14a', glow: '#6fb8ff', emblem: 'bolt',  melee: true  },
    // Frost Glaives → frost duelist (silver/ice, a spinning blade) — melee.
    orbitingBlade: { name: 'Frost Duelist', accent: '#cfe0ff', glow: '#bcd2ff', emblem: 'blade', melee: true  },
    // Beacon Pulse → cleric/paladin (white/gold sigil) — melee-leaning.
    holyPulse:     { name: 'Cleric',       accent: '#ffe9a8', glow: '#fff3c8', emblem: 'sigil', melee: true  },
    // Stormbrand → stormcaller (blue/yellow, a charged crown) — melee-leaning.
    lightningMark: { name: 'Stormcaller',  accent: '#ffe14a', glow: '#7fd0ff', emblem: 'crown', melee: true  },
    // Frostmote → frostweaver (blue/white ice shard) — melee-leaning.
    frostmote:     { name: 'Frostweaver',  accent: '#9fe8ff', glow: '#cdf3ff', emblem: 'shard', melee: true  },
};

// Evolved weapon → the base whose theme it inherits.
const EVOLVED_TO_BASE = {
    arcaneStorm: 'arcaneBolt',
    infernoStorm: 'emberWisp',
    celestialBlades: 'orbitingBlade',
    divineNova: 'holyPulse',
    thunderCrown: 'lightningMark',
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
