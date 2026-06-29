// Builds the 3-card level-up pool. Mixes:
//   - stat upgrades (data list below)
//   - per-owned-weapon WEAPON UPGRADE cards
//   - per-unowned-weapon NEW WEAPON cards
//   - per-owned-passive PASSIVE UPGRADE cards
//   - per-unowned-passive NEW PASSIVE cards
//   - fallback cards when the live pool can't fill 3 slots
//
// Cards are uniform shape: { id, name, description, cardLabel, rarity,
// weight, maxStacks?, available?, apply(game) }. The `cardLabel` is what
// UISystem prints in the rarity slot. Adding a new card =
//   - push a new STAT_UPGRADES entry, or
//   - define a new weapon in src/content/weapons.js, or
//   - define a new passive in src/content/passives.js.
// No system code change needed.

import { pickWeighted } from '../core/MathUtils.js';
import { WEAPONS, WEAPON_IDS } from '../content/weapons.js';
import { PASSIVES, PASSIVE_IDS } from '../content/passives.js';
import { MAX_WEAPON_LEVEL, MAX_PASSIVE_LEVEL } from '../config/GameConfig.js';

const STAT_UPGRADES = [
    {
        id: 'stat:move-speed',
        kind: 'stat',
        cardLabel: 'STAT',
        name: 'Quick Feet',
        description: '+18% movement speed',
        rarity: 'common',
        weight: 1.0,
        maxStacks: 5,
        apply(game) {
            game.player.speed *= 1.18;
        },
    },
    {
        id: 'stat:pickup-range',
        kind: 'stat',
        cardLabel: 'STAT',
        name: 'Lure Light',
        description: '+40% gem pickup range',
        rarity: 'common',
        weight: 1.0,
        maxStacks: 5,
        apply(game) {
            game.player.pickupRange *= 1.4;
        },
    },
    {
        id: 'stat:max-hp',
        kind: 'stat',
        cardLabel: 'STAT',
        name: 'Hearty',
        description: '+25 max HP',
        rarity: 'common',
        weight: 0.9,
        maxStacks: 6,
        apply(game) {
            game.player.maxHp += 25;
            game.player.hp = Math.min(game.player.hp + 25, game.player.maxHp);
        },
    },
    {
        id: 'stat:xp-gain',
        kind: 'stat',
        cardLabel: 'STAT',
        name: 'Embersage',
        description: '+15% XP from gems',
        rarity: 'uncommon',
        weight: 0.7,
        maxStacks: 6,
        apply(game) {
            game.player.xpMultiplier *= 1.15;
        },
    },
    {
        id: 'stat:heal',
        kind: 'stat',
        cardLabel: 'STAT',
        name: 'Ember Salve',
        description: 'Restore 30 HP',
        rarity: 'common',
        weight: 0.8,
        available(game) {
            return game.player.hp < game.player.maxHp;
        },
        apply(game) {
            game.player.hp = Math.min(game.player.hp + 30, game.player.maxHp);
        },
    },
];

// Fallback cards fire only when the live pool can't deliver 3 unique
// choices (everything weapon/passive/stat-wise is maxed or unavailable).
const FALLBACK_UPGRADES = [
    {
        id: 'fallback:bonus-xp',
        kind: 'fallback',
        cardLabel: 'BONUS',
        name: 'Lucky Find',
        description: 'Gain a small XP bonus.',
        cardLevelText: '+5 XP',
        rarity: 'common',
        weight: 1.0,
        apply(game) {
            game.player.gainXP(5);
        },
    },
    {
        id: 'fallback:coins',
        kind: 'fallback',
        cardLabel: 'BONUS',
        name: 'Coin Pile',
        description: 'Stash a few coins for later.',
        cardLevelText: '+10 Coins',
        rarity: 'common',
        weight: 1.0,
        apply(game) {
            game.player.coins = (game.player.coins ?? 0) + 10;
        },
    },
    {
        id: 'fallback:heal',
        kind: 'fallback',
        cardLabel: 'BONUS',
        name: 'Vitality Burst',
        description: 'Restore 50 HP.',
        cardLevelText: '+50 HP',
        rarity: 'common',
        weight: 1.0,
        apply(game) {
            game.player.hp = Math.min(game.player.hp + 50, game.player.maxHp);
        },
    },
];

const WEIGHT_NEW_WEAPON = 0.9;
const WEIGHT_WEAPON_UPGRADE = 1.1;
const WEIGHT_NEW_PASSIVE = 0.85;
const WEIGHT_PASSIVE_UPGRADE = 1.05;

export class UpgradeSystem {
    constructor() {
        this.appliedCounts = Object.create(null);
        // Card ids banished for the rest of the run (never offered again).
        this.banished = new Set();
    }

    // Remove a card id from the offer pool for the rest of the run.
    banish(id) {
        if (id) this.banished.add(id);
    }

    rollChoices(game, count = 3) {
        const pool = this._buildPool(game).filter((c) => !this.banished.has(c.id));

        const choices = [];
        const remaining = pool.slice();
        while (choices.length < count && remaining.length > 0) {
            const picked = pickWeighted(remaining);
            if (!picked) break;
            choices.push(picked);
            remaining.splice(remaining.indexOf(picked), 1);
        }

        // If the live pool couldn't fill all 3 slots, top up from fallback
        // cards without duplicating within the same draw.
        if (choices.length < count) {
            const fallbacks = FALLBACK_UPGRADES.slice();
            while (choices.length < count && fallbacks.length > 0) {
                const idx = Math.floor(Math.random() * fallbacks.length);
                choices.push(fallbacks.splice(idx, 1)[0]);
            }
        }

        return choices;
    }

    _buildPool(game) {
        const pool = [];

        // Stat upgrades — gated by maxStacks and an optional context check.
        for (const u of STAT_UPGRADES) {
            const cur = this.appliedCounts[u.id] ?? 0;
            if (cur >= (u.maxStacks ?? Infinity)) continue;
            if (u.available && !u.available(game)) continue;
            pool.push(u);
        }

        // Per-owned-weapon upgrade entries (skip maxed weapons + evolved
        // weapons, which have maxLevel=1 and are considered done).
        const ownedWeaponIds = new Set();
        for (const w of game.weaponSystem.owned) {
            ownedWeaponIds.add(w.id);
            const def = WEAPONS[w.id];
            const max = def?.maxLevel ?? MAX_WEAPON_LEVEL;
            if (!def?.evolved && w.level < max) {
                pool.push(weaponUpgradeChoice(w));
            }
        }
        // Per-unowned-weapon unlock entries. Evolved weapons are reached
        // only via chest evolution, never offered as a level-up choice.
        for (const id of WEAPON_IDS) {
            if (ownedWeaponIds.has(id)) continue;
            if (WEAPONS[id].evolved) continue;
            pool.push(newWeaponChoice(id));
        }

        // Per-owned-passive upgrade entries (skip maxed passives).
        const ownedPassiveIds = new Set();
        for (const p of game.passiveSystem.owned) {
            ownedPassiveIds.add(p.id);
            const def = PASSIVES[p.id];
            const max = def?.maxLevel ?? MAX_PASSIVE_LEVEL;
            if (p.level < max) {
                pool.push(passiveUpgradeChoice(p, def));
            }
        }
        // Per-unowned-passive unlock entries.
        for (const id of PASSIVE_IDS) {
            if (ownedPassiveIds.has(id)) continue;
            pool.push(newPassiveChoice(id));
        }

        return pool;
    }

    apply(upgrade, game) {
        if (!upgrade) return;
        this.appliedCounts[upgrade.id] = (this.appliedCounts[upgrade.id] ?? 0) + 1;
        upgrade.apply(game);
    }
}

// Friendly labels + formatters for the per-level stat fields a weapon/ability
// exposes. Only the listed keys are surfaced on upgrade cards (the rest are
// internal tuning); each entry maps a raw value to a player-facing string so a
// card can show "Damage: 18 → 22", "Cooldown: 0.60s → 0.52s", etc. Higher-is-
// better unless noted. `inv: true` means the field is shown as a derived stat
// where a LOWER raw value reads as a HIGHER player stat (slow %).
const STAT_FIELDS = [
    { key: 'damage',          label: 'Damage',     fmt: (v) => `${Math.round(v)}` },
    { key: 'cooldown',        label: 'Cooldown',   fmt: (v) => `${v.toFixed(2)}s` },
    { key: 'pierce',          label: 'Pierce',     fmt: (v) => `${v}` },
    { key: 'ricochet',        label: 'Ricochet',   fmt: (v) => `${v}` },
    { key: 'projectileSpeed', label: 'Proj Speed', fmt: (v) => `${Math.round(v)}` },
    { key: 'bladeCount',      label: 'Blades',     fmt: (v) => `${v}` },
    { key: 'count',           label: 'Projectiles', fmt: (v) => `${v}` },
    { key: 'radius',          label: 'Radius',     fmt: (v) => `${Math.round(v)}` },
    { key: 'orbitRadius',     label: 'Orbit',      fmt: (v) => `${Math.round(v)}` },
    { key: 'heal',            label: 'Heal',       fmt: (v) => `${Math.round(v)}` },
    { key: 'dashDistance',    label: 'Dash',       fmt: (v) => `${Math.round(v)}` },
    { key: 'width',           label: 'Width',      fmt: (v) => `${Math.round(v)}` },
    { key: 'motes',           label: 'Motes',      fmt: (v) => `${v}` },
    { key: 'slowDuration',    label: 'Slow Time',  fmt: (v) => `${v.toFixed(1)}s` },
    // Slow strength is derived from the multiplier (lower mul = stronger slow).
    { key: 'slowMul',         label: 'Slow',       fmt: (v) => `${Math.round((1 - v) * 100)}%` },
];
const MAX_DELTA_LINES = 4;

// Build a "Stat: a → b" summary of what the NEXT level changes for a weapon /
// ability. Falls back to the prose description if no tracked field moved.
function describeWeaponUpgrade(def, fromLevel, toLevel) {
    const a = def?.perLevel?.[fromLevel];
    const b = def?.perLevel?.[toLevel];
    if (!a || !b) return def?.description ?? `Lv ${fromLevel} → ${toLevel}`;
    const lines = [];
    for (const f of STAT_FIELDS) {
        if (a[f.key] === undefined || b[f.key] === undefined) continue;
        if (a[f.key] === b[f.key]) continue;
        lines.push(`${f.label}: ${f.fmt(a[f.key])} → ${f.fmt(b[f.key])}`);
        if (lines.length >= MAX_DELTA_LINES) break;
    }
    if (lines.length === 0) return def?.description ?? `Lv ${fromLevel} → ${toLevel}`;
    return lines.join('   ');
}

// Key level-1 stats for a brand-new weapon/ability card, appended to its prose.
function firstLevelSummary(def) {
    const s = def?.perLevel?.[1];
    if (!s) return '';
    const bits = [];
    for (const f of STAT_FIELDS) {
        if (s[f.key] === undefined) continue;
        bits.push(`${f.label} ${f.fmt(s[f.key])}`);
        if (bits.length >= 3) break;
    }
    return bits.join('   ');
}

function weaponUpgradeChoice(owned) {
    const def = WEAPONS[owned.id];
    const next = owned.level + 1;
    const isAbility = !!def?.ability;
    return {
        id: `weapon:${owned.id}:upgrade`,
        kind: 'weapon-upgrade',
        cardLabel: isAbility ? 'ABILITY UPGRADE' : 'WEAPON UPGRADE',
        name: def?.name ?? owned.id,
        description: describeWeaponUpgrade(def, owned.level, next),
        cardLevelText: `Lv ${owned.level} → ${next}`,
        rarity: 'rare',
        weight: WEIGHT_WEAPON_UPGRADE,
        apply(game) {
            game.weaponSystem.levelUpWeapon(owned.id);
        },
    };
}

function newWeaponChoice(id) {
    const def = WEAPONS[id];
    const isAbility = !!def?.ability;
    const summary = firstLevelSummary(def);
    const prose = def?.description ?? '';
    return {
        id: `weapon:${id}:new`,
        kind: 'weapon-new',
        cardLabel: isAbility ? 'NEW ABILITY' : 'NEW WEAPON',
        name: def?.name ?? id,
        description: summary ? `${prose}   ${summary}` : prose,
        cardLevelText: 'Lv 1',
        rarity: 'epic',
        weight: WEIGHT_NEW_WEAPON,
        apply(game) {
            game.weaponSystem.addWeapon(id);
        },
    };
}

function passiveUpgradeChoice(owned, def) {
    const next = owned.level + 1;
    return {
        id: `passive:${owned.id}:upgrade`,
        kind: 'passive-upgrade',
        cardLabel: 'PASSIVE UPGRADE',
        name: def?.name ?? owned.id,
        description: def?.description ?? '',
        cardLevelText: `Lv ${owned.level} → ${next}`,
        rarity: 'uncommon',
        weight: WEIGHT_PASSIVE_UPGRADE,
        apply(game) {
            game.passiveSystem.levelUpPassive(owned.id, game.player);
        },
    };
}

function newPassiveChoice(id) {
    const def = PASSIVES[id];
    return {
        id: `passive:${id}:new`,
        kind: 'passive-new',
        cardLabel: 'NEW PASSIVE',
        name: def?.name ?? id,
        description: def?.description ?? '',
        cardLevelText: 'Lv 1',
        rarity: 'uncommon',
        weight: WEIGHT_NEW_PASSIVE,
        apply(game) {
            game.passiveSystem.addPassive(id, game.player);
        },
    };
}
