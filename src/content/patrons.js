// Patrons — elemental / role allegiances chosen before a run. Committing to a
// Patron WEIGHTS the level-up draft toward that Patron's weapons + passives
// (and away from rival Patrons), turning the one flat upgrade pool into many
// authored builds. This is pure data + a weight helper read by UpgradeSystem;
// it adds NO new weapons/passives — every id below already exists in
// content/weapons.js and content/passives.js.
//
// Cards NOT owned by any Patron (the generic stat cards, fallbacks, the
// universal shadowDash escape) are never touched — they roll at their normal
// weight regardless, so no build ever starves on fundamentals. And with NO
// Patron committed, cardPatronMul() always returns 1, so the draft behaves
// EXACTLY as it did before this system existed (regression-safe).

export const PATRONS = {
    pyre: {
        id: 'pyre', name: 'Pyre', title: 'the Everburning', color: '#ff7a3c',
        blurb: 'Burn the horde to ash — favors fire weapons and damage perks.',
        weapons: ['emberWisp', 'infernoStorm', 'cinderAura'],
        passives: ['pyromancersTinder', 'emberzeal', 'lastLight', 'glasswick'],
    },
    rime: {
        id: 'rime', name: 'Rime', title: 'the Stillness', color: '#7fe0ff',
        blurb: 'Freeze the field in place — favors frost weapons and control perks.',
        weapons: ['orbitingBlade', 'celestialBlades', 'frostmote'],
        passives: ['frostbiteCore', 'tempo', 'spellbook'],
    },
    tempest: {
        id: 'tempest', name: 'Tempest', title: 'the Chain', color: '#c9a3ff',
        blurb: 'Strike fast, crit hard, chain everywhere — favors shock weapons and crit/speed perks.',
        weapons: ['lightningMark', 'voltWand', 'thunderCrown'],
        passives: ['executioner', 'windBoots', 'featherstep'],
    },
    dawn: {
        id: 'dawn', name: 'Dawn', title: 'the Mending', color: '#ffe08a',
        blurb: 'Outlast everything — favors radiant weapons and sustain perks.',
        weapons: ['holyPulse', 'divineNova', 'hearthTotem'],
        passives: ['secondWind', 'blooddrinker'],
    },
    iron: {
        id: 'iron', name: 'Iron', title: 'the Bulwark', color: '#b8c2cc',
        blurb: 'An unbreakable wall of raw power — favors arcane weapons and defense perks.',
        weapons: ['arcaneBolt', 'arcaneStorm'],
        passives: ['ironHeart', 'thickHide', 'thorns', 'stoneheart', 'powerStone'],
    },
};

export const PATRON_IDS = ['pyre', 'rime', 'tempest', 'dawn', 'iron'];

// entityId (weaponId or passiveId) → patron id. Built once. Anything not here
// is "universal" and never reweighted.
const ENTITY_PATRON = (() => {
    const m = Object.create(null);
    for (const id of PATRON_IDS) {
        for (const w of PATRONS[id].weapons) m[w] = id;
        for (const p of PATRONS[id].passives) m[p] = id;
    }
    return m;
})();

export function patronOfEntity(entityId) {
    return ENTITY_PATRON[entityId] ?? null;
}

// Draft weighting knobs. Committed-patron cards roll much more often; rival-
// patron cards roll rarely (but still possible — the no-starve safety valve).
export const PATRON_FAVOR = 2.6;
export const PATRON_OFFPOOL = 0.35;

// Pull the weapon/passive id out of an UpgradeSystem card id, which is one of:
//   weapon:<id>:new | weapon:<id>:upgrade | passive:<id>:new | passive:<id>:upgrade
// Returns null for stat:/fallback:/other cards.
function entityOfCard(cardId) {
    if (typeof cardId !== 'string') return null;
    const parts = cardId.split(':');
    if (parts.length >= 2 && (parts[0] === 'weapon' || parts[0] === 'passive')) return parts[1];
    return null;
}

// Weight multiplier for a level-up card given the committed patron ids.
// Universal cards (stats, fallbacks, and any entity not in a patron pool such
// as shadowDash) are ×1. With NO patrons committed → always 1 (regression-safe).
//
// `invert` is the Alter token's lens: it SWAPS favor/off-pool so the re-roll
// leans toward your NON-committed Patrons (a deliberate splash out of your
// lane). With no Patron committed, invert is moot and everything stays ×1.
export function cardPatronMul(cardId, committed, invert = false) {
    if (!committed || committed.length === 0) return 1;
    const ent = entityOfCard(cardId);
    if (!ent) return 1;
    const owner = ENTITY_PATRON[ent];
    if (!owner) return 1;
    const inPool = committed.includes(owner);
    const favored = invert ? !inPool : inPool;
    return favored ? PATRON_FAVOR : PATRON_OFFPOOL;
}
