// Keystones — prerequisite-gated synergy capstones offered in the level-up
// draft. Unlike normal cards, a Keystone only ENTERS the pool once its recipe
// is satisfied (you own the pieces it builds on), so finding one is a payoff
// for a committed build. Each is one-time, high-rarity, and recipe-gated — a
// "jackpot" that defines the rest of the run.
//
// To stay cheap on mobile Canvas, NO Keystone adds a new per-frame area scan.
// Most are recipe-gated grants to EXISTING player stats already read at the
// single central hooks (powerRoll for crit/rage/damage, the burn tick for
// burnDamageMul, Player.takeDamage for damageTakenMul) — so they need no engine
// change at all. Only the two genuinely-new mechanics set a player flag read at
// exactly one existing point: shockStrike (Conflagration/Overcharge) and
// Player.takeDamage (Aegis). Effects live on the Player, which is rebuilt each
// run, so they reset cleanly between runs.

import { WEAPONS } from './weapons.js';

// Keystones can't appear too early — they'd trivialize the opening. Gated to a
// minimum hero level so they read as a mid-run power spike, not a snowball.
export const KEYSTONE_MIN_LEVEL = 6;

// ── availability helpers (read the live run, O(owned)) ──────────────────
function owned(game) { return game?.weaponSystem?.owned ?? []; }
function passives(game) { return game?.passiveSystem?.owned ?? []; }
function ownsWeapon(game, id) { return owned(game).some((w) => w.id === id); }
function ownsElement(game, el) { return owned(game).some((w) => WEAPONS[w.id]?.element === el); }
function ownsAnyPassive(game, ids) { const s = new Set(ids); return passives(game).some((p) => s.has(p.id)); }
function arsenalSize(game) { return owned(game).length + passives(game).length; }
function levelOk(game) { return (game?.player?.level ?? 1) >= KEYSTONE_MIN_LEVEL; }

// Each: { id, name, patron, desc, available(game), apply(game) }.
export const KEYSTONES = [
    {
        id: 'conflagration', name: 'Conflagration', patron: 'pyre',
        desc: 'Shock detonations of burn erupt far brighter — and relight the fire.',
        available: (g) => levelOk(g) && ownsElement(g, 'fire') && ownsElement(g, 'shock'),
        apply: (g) => { g.player.ks_conflagration = true; },
    },
    {
        id: 'wildfire', name: 'Wildfire', patron: 'pyre',
        desc: 'Your burns sear 60% harder.',
        available: (g) => levelOk(g) && ownsElement(g, 'fire'),
        apply: (g) => { g.player.burnDamageMul = (g.player.burnDamageMul ?? 1) * 1.6; },
    },
    {
        id: 'pyres-wrath', name: "Pyre's Wrath", patron: 'pyre',
        desc: 'Below 35% HP, deal +40% damage — burn brightest at the end.',
        available: (g) => levelOk(g) && (ownsElement(g, 'fire') || ownsAnyPassive(g, ['lastLight', 'glasswick'])),
        apply: (g) => { g.player.lowHpDamageBonus = (g.player.lowHpDamageBonus ?? 0) + 0.40; },
    },
    {
        id: 'overcharge', name: 'Overcharge', patron: 'tempest',
        desc: 'Shock builds 2 charges higher and each charge bites harder.',
        available: (g) => levelOk(g) && ownsElement(g, 'shock'),
        apply: (g) => { g.player.ks_overcharge = true; },
    },
    {
        id: 'killing-edge', name: 'Killing Edge', patron: 'tempest',
        desc: '+15% critical chance and +60% critical damage.',
        available: (g) => levelOk(g) && (ownsAnyPassive(g, ['emberzeal', 'executioner']) || ownsElement(g, 'shock')),
        apply: (g) => {
            g.player.critChance = Math.min(0.85, (g.player.critChance ?? 0) + 0.15);
            g.player.critMul = (g.player.critMul ?? 2) + 0.6;
        },
    },
    {
        id: 'deepwinter', name: 'Deepwinter', patron: 'rime',
        desc: 'Frost runs in your veins: +35 max HP and you take 12% less damage.',
        available: (g) => levelOk(g) && (ownsElement(g, 'frost') || ownsAnyPassive(g, ['frostbiteCore'])),
        apply: (g) => {
            g.player.maxHp += 35; g.player.hp = Math.min(g.player.hp + 35, g.player.maxHp);
            g.player.damageTakenMul = (g.player.damageTakenMul ?? 1) * 0.88;
        },
    },
    {
        id: 'aegis', name: 'Aegis', patron: 'iron',
        desc: 'Below half health, take 35% less damage.',
        available: (g) => levelOk(g) && ownsAnyPassive(g, ['ironHeart', 'thickHide', 'stoneheart', 'thorns']),
        apply: (g) => { g.player.ks_aegis = true; },
    },
    {
        id: 'momentum', name: 'Momentum', patron: 'iron',
        desc: 'A relentless arsenal: +35% weapon damage.',
        available: (g) => levelOk(g) && arsenalSize(g) >= 4,
        apply: (g) => { g.player.damageMul = (g.player.damageMul ?? 1) * 1.35; },
    },
    {
        id: 'resurgence', name: 'Resurgence', patron: 'dawn',
        desc: 'Mend brighter: +70 max HP (healed now) and +10% pickup range.',
        available: (g) => levelOk(g) && ownsAnyPassive(g, ['secondWind', 'blooddrinker']),
        apply: (g) => {
            g.player.maxHp += 70; g.player.hp = Math.min(g.player.hp + 70, g.player.maxHp);
            g.player.pickupRange *= 1.10;
        },
    },
];

export const KEYSTONE_IDS = KEYSTONES.map((k) => k.id);
const BY_ID = Object.fromEntries(KEYSTONES.map((k) => [k.id, k]));
export function keystoneById(id) { return BY_ID[id]; }
