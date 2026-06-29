// Loadout gear — permanent, unlockable items equipped between runs.
//
// Four categories, one equipped slot each:
//   weapon   chooses which weapon the run STARTS with (weaponId → WEAPONS)
//   trinket  utility buffs (coins / xp / cooldown)
//   armor    survivability buffs (max HP / damage taken)
//   charm    economy & luck buffs (coins / xp / chest luck)
//
// Each gear item:
//   id              stable save key
//   name            display label
//   category        'weapon' | 'trinket' | 'armor' | 'charm'
//   rarity          key into RARITIES (drives color + usual buff strength)
//   description     card text
//   weaponId        (weapon category only) which WEAPONS entry it starts you with
//   buffs           data-only buff bag (see BUFF_LABELS for the vocabulary)
//   defaultUnlocked owned from the very first launch
//
// Buffs are intentionally small so early gear never trivializes a run; the
// rarity ladder widens the numbers, not breaks them. All buffs are applied
// exactly once at run start by applyGearBuffs() and never re-applied mid-run.

export const GEAR = {
    // ── Starting weapons ────────────────────────────────────────────────
    w_cinderbolt: {
        id: 'w_cinderbolt', name: 'Cinderbolt', category: 'weapon', rarity: 'common',
        description: 'Start each vigil with the Cinderbolt.', weaponId: 'arcaneBolt',
        buffs: {}, defaultUnlocked: true,
    },
    w_frostmotes: {
        id: 'w_frostmotes', name: 'Frost Glaives', category: 'weapon', rarity: 'uncommon',
        description: 'Start with the orbiting Frost Glaives. +5% pickup range.', weaponId: 'orbitingBlade',
        buffs: { pickupPct: 0.05 },
    },
    w_beacon: {
        id: 'w_beacon', name: 'Beacon Pulse', category: 'weapon', rarity: 'uncommon',
        description: 'Start with the Beacon Pulse. +10 max HP.', weaponId: 'holyPulse',
        buffs: { maxHp: 10 },
    },
    w_stormbrand: {
        id: 'w_stormbrand', name: 'Stormbrand', category: 'weapon', rarity: 'rare',
        description: 'Start with the Stormbrand. +4% damage.', weaponId: 'lightningMark',
        buffs: { damagePct: 0.04 },
    },
    w_pyrewisp: {
        id: 'w_pyrewisp', name: 'Pyre Wisp', category: 'weapon', rarity: 'rare',
        description: 'Start with the Pyre Wisp. +5% damage.', weaponId: 'emberWisp',
        buffs: { damagePct: 0.05 },
    },

    // ── Trinkets ────────────────────────────────────────────────────────
    t_emberband: {
        id: 't_emberband', name: 'Emberband', category: 'trinket', rarity: 'common',
        description: 'A warm copper ring.', buffs: { coinPct: 0.05 },
    },
    t_gleamloop: {
        id: 't_gleamloop', name: 'Gleamloop', category: 'trinket', rarity: 'uncommon',
        description: 'Draws light to you.', buffs: { pickupPct: 0.10, xpPct: 0.04 },
    },
    t_wardstone: {
        id: 't_wardstone', name: 'Wardstone', category: 'trinket', rarity: 'rare',
        description: 'A stone that drinks the dark.', buffs: { maxHp: 20, damageTakenPct: 0.03 },
    },
    t_kindlesigil: {
        id: 't_kindlesigil', name: 'Kindle Sigil', category: 'trinket', rarity: 'epic',
        description: 'Quickens every spark.', buffs: { damagePct: 0.06, cooldownPct: 0.04 },
    },
    t_phoenixtear: {
        id: 't_phoenixtear', name: 'Phoenix Tear', category: 'trinket', rarity: 'legendary',
        description: 'A tear that refuses to cool.', buffs: { maxHp: 30, damagePct: 0.05, coinPct: 0.08 },
    },
    t_eternalember: {
        id: 't_eternalember', name: 'Eternal Ember', category: 'trinket', rarity: 'mythic',
        description: 'It has burned since the first vigil.', buffs: { damagePct: 0.08, cooldownPct: 0.05, xpPct: 0.06 },
    },

    // ── Armor ───────────────────────────────────────────────────────────
    a_ashvest: {
        id: 'a_ashvest', name: 'Ash Vest', category: 'armor', rarity: 'common',
        description: 'Padded with cooled ash.', buffs: { maxHp: 12 },
    },
    a_cinderplate: {
        id: 'a_cinderplate', name: 'Cinderplate', category: 'armor', rarity: 'uncommon',
        description: 'Scaled plates of slag.', buffs: { maxHp: 20, damageTakenPct: 0.03 },
    },
    a_warmweave: {
        id: 'a_warmweave', name: 'Warmweave', category: 'armor', rarity: 'rare',
        description: 'Light and supple.', buffs: { maxHp: 28, speedPct: 0.04 },
    },
    a_pyreguard: {
        id: 'a_pyreguard', name: 'Pyreguard', category: 'armor', rarity: 'epic',
        description: 'Forged in a living pyre.', buffs: { maxHp: 40, damageTakenPct: 0.05 },
    },
    a_dawnmantle: {
        id: 'a_dawnmantle', name: 'Dawn Mantle', category: 'armor', rarity: 'legendary',
        description: 'Woven from first light.', buffs: { maxHp: 55, damageTakenPct: 0.06, speedPct: 0.03 },
    },
    a_aegisofembers: {
        id: 'a_aegisofembers', name: 'Aegis of Embers', category: 'armor', rarity: 'mythic',
        description: 'The last ward of the Wick-Keepers.', buffs: { maxHp: 70, damageTakenPct: 0.08 },
    },

    // ── Charms ──────────────────────────────────────────────────────────
    c_luckcinder: {
        id: 'c_luckcinder', name: 'Lucky Cinder', category: 'charm', rarity: 'common',
        description: 'Pops at just the right moment.', buffs: { chestLuck: 0.10 },
    },
    c_coinmoth: {
        id: 'c_coinmoth', name: 'Coin Moth', category: 'charm', rarity: 'uncommon',
        description: 'Flutters toward gold.', buffs: { coinPct: 0.10 },
    },
    c_scholarwax: {
        id: 'c_scholarwax', name: "Scholar's Wax", category: 'charm', rarity: 'rare',
        description: 'Memory burns brighter.', buffs: { xpPct: 0.10 },
    },
    c_gildedwick: {
        id: 'c_gildedwick', name: 'Gilded Wick', category: 'charm', rarity: 'epic',
        description: 'Burns gold into the dark.', buffs: { coinPct: 0.15, chestLuck: 0.15 },
    },
    c_fatesember: {
        id: 'c_fatesember', name: "Fate's Ember", category: 'charm', rarity: 'legendary',
        description: 'Fortune leans toward its light.', buffs: { xpPct: 0.12, chestLuck: 0.20, coinPct: 0.10 },
    },
    c_oblationflame: {
        id: 'c_oblationflame', name: 'Oblation Flame', category: 'charm', rarity: 'mythic',
        description: 'Every offering is repaid.', buffs: { xpPct: 0.15, coinPct: 0.18, chestLuck: 0.25 },
    },
};

export const GEAR_LIST = Object.values(GEAR);
export const GEAR_CATEGORIES = ['weapon', 'trinket', 'armor', 'charm'];
export const GEAR_CATEGORY_LABELS = { weapon: 'Starting Weapon', trinket: 'Trinket', armor: 'Armor', charm: 'Charm' };

// Items the player owns on a brand-new save.
export const DEFAULT_UNLOCKED_GEAR = GEAR_LIST.filter((g) => g.defaultUnlocked).map((g) => g.id);

// Default equipped loadout: only the default starting weapon, rest empty.
export const DEFAULT_EQUIPPED_GEAR = { weapon: 'w_cinderbolt', trinket: null, armor: null, charm: null };

export function gearById(id) {
    return GEAR[id] ?? null;
}

export function gearByCategory(category) {
    return GEAR_LIST.filter((g) => g.category === category);
}

// Human-readable label for each buff key (also fixes display ordering).
const BUFF_LABELS = {
    damagePct:       (v) => `+${Math.round(v * 100)}% damage`,
    maxHp:           (v) => `+${v} max HP`,
    speedPct:        (v) => `+${Math.round(v * 100)}% move speed`,
    xpPct:           (v) => `+${Math.round(v * 100)}% XP gain`,
    pickupPct:       (v) => `+${Math.round(v * 100)}% pickup range`,
    coinPct:         (v) => `+${Math.round(v * 100)}% coin gain`,
    chestLuck:       (v) => `+${Math.round(v * 100)}% chest luck`,
    cooldownPct:     (v) => `-${Math.round(v * 100)}% cooldowns`,
    damageTakenPct:  (v) => `-${Math.round(v * 100)}% damage taken`,
    startCoins:      (v) => `+${v} starting coins`,
};

// Returns an array of short buff strings for a gear item (UI helper).
export function buffSummary(buffs) {
    if (!buffs) return [];
    const out = [];
    for (const key of Object.keys(BUFF_LABELS)) {
        if (buffs[key]) out.push(BUFF_LABELS[key](buffs[key]));
    }
    return out;
}

// Apply one buff bag to the player. Multipliers compound; additives sum.
// Player gains `coinMul` (default 1) here if it doesn't already exist.
export function applyBuffs(player, buffs) {
    if (!buffs) return;
    if (buffs.damagePct)      player.damageMul *= 1 + buffs.damagePct;
    if (buffs.maxHp)        { player.maxHp += buffs.maxHp; player.hp = Math.min(player.hp + buffs.maxHp, player.maxHp); }
    if (buffs.speedPct)       player.speed *= 1 + buffs.speedPct;
    if (buffs.xpPct)          player.xpMultiplier *= 1 + buffs.xpPct;
    if (buffs.pickupPct)      player.pickupRange *= 1 + buffs.pickupPct;
    if (buffs.coinPct)        player.coinMul = (player.coinMul ?? 1) * (1 + buffs.coinPct);
    if (buffs.chestLuck)      player.chestLuck += buffs.chestLuck;
    if (buffs.cooldownPct)    player.cooldownMul *= 1 - buffs.cooldownPct;
    if (buffs.damageTakenPct) player.damageTakenMul *= 1 - buffs.damageTakenPct;
    if (buffs.startCoins)     player.coins = (player.coins ?? 0) + buffs.startCoins;
}
