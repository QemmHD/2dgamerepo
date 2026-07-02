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

// Reusable recipe requirements — each is { ok(game), label }. `label` is the
// human breadcrumb shown when this is the one piece a Keystone is missing.
const REQ = {
    fire: { ok: (g) => ownsElement(g, 'fire'), label: 'a Fire weapon' },
    shock: { ok: (g) => ownsElement(g, 'shock'), label: 'a Shock weapon' },
    fireOrRage: { ok: (g) => ownsElement(g, 'fire') || ownsAnyPassive(g, ['lastLight', 'glasswick']), label: 'a Fire weapon or rage perk' },
    critOrShock: { ok: (g) => ownsAnyPassive(g, ['emberzeal', 'executioner']) || ownsElement(g, 'shock'), label: 'a crit perk or Shock weapon' },
    frost: { ok: (g) => ownsElement(g, 'frost') || ownsAnyPassive(g, ['frostbiteCore']), label: 'a Frost source' },
    defense: { ok: (g) => ownsAnyPassive(g, ['ironHeart', 'thickHide', 'stoneheart', 'thorns']), label: 'a defense perk' },
    arsenal4: { ok: (g) => arsenalSize(g) >= 4, label: '4+ weapons & perks' },
    sustain: { ok: (g) => ownsAnyPassive(g, ['secondWind', 'blooddrinker']), label: 'a sustain perk' },
    // Armory pt. 1: any ground-claiming fire weapon (mines or the wake).
    groundfire: {
        ok: (g) => ownsWeapon(g, 'emberMine') || ownsWeapon(g, 'ashquake')
            || ownsWeapon(g, 'wakefire') || ownsWeapon(g, 'wildfireWake'),
        label: 'a ground-fire weapon',
    },
};

// Builder: recipe (`reqs`) is declarative so we can derive both availability
// AND the "one piece short" breadcrumb from the same source of truth.
function mk(def) {
    const reqs = def.reqs;
    return {
        id: def.id, name: def.name, patron: def.patron, desc: def.desc, reqs, apply: def.apply,
        available: (g) => levelOk(g) && reqs.every((r) => r.ok(g)),
        missing: (g) => reqs.filter((r) => !r.ok(g)),
    };
}

export const KEYSTONES = [
    mk({
        id: 'conflagration', name: 'Conflagration', patron: 'pyre',
        desc: 'Shock detonations of burn erupt far brighter — and relight the fire.',
        reqs: [REQ.fire, REQ.shock],
        apply: (g) => { g.player.ks_conflagration = true; },
    }),
    mk({
        id: 'wildfire', name: 'Wildfire', patron: 'pyre',
        desc: 'Your burns sear 60% harder.',
        reqs: [REQ.fire],
        apply: (g) => { g.player.burnDamageMul = (g.player.burnDamageMul ?? 1) * 1.6; },
    }),
    mk({
        id: 'pyres-wrath', name: "Pyre's Wrath", patron: 'pyre',
        desc: 'Below 35% HP, deal +40% damage — burn brightest at the end.',
        reqs: [REQ.fireOrRage],
        apply: (g) => { g.player.lowHpDamageBonus = (g.player.lowHpDamageBonus ?? 0) + 0.40; },
    }),
    mk({
        // Armory pt. 1: a capstone for the new ground-claiming kinds (mine /
        // trail). burnDamageMul is read at the existing burn tick — the same
        // single hook Wildfire uses, so no new per-frame scan.
        id: 'scorched-earth', name: 'Scorched Earth', patron: 'pyre',
        desc: 'Ground you claim is home turf: every burn you set sears 50% harder.',
        reqs: [REQ.groundfire],
        apply: (g) => { g.player.burnDamageMul = (g.player.burnDamageMul ?? 1) * 1.5; },
    }),
    mk({
        id: 'overcharge', name: 'Overcharge', patron: 'tempest',
        desc: 'Shock builds 2 charges higher and each charge bites harder.',
        reqs: [REQ.shock],
        apply: (g) => { g.player.ks_overcharge = true; },
    }),
    mk({
        id: 'killing-edge', name: 'Killing Edge', patron: 'tempest',
        desc: '+15% critical chance and +60% critical damage.',
        reqs: [REQ.critOrShock],
        apply: (g) => {
            g.player.critChance = Math.min(0.85, (g.player.critChance ?? 0) + 0.15);
            g.player.critMul = (g.player.critMul ?? 2) + 0.6;
        },
    }),
    mk({
        id: 'deepwinter', name: 'Deepwinter', patron: 'rime',
        desc: 'Frost runs in your veins: +35 max HP and you take 12% less damage.',
        reqs: [REQ.frost],
        apply: (g) => {
            g.player.maxHp += 35; g.player.hp = Math.min(g.player.hp + 35, g.player.maxHp);
            g.player.damageTakenMul = (g.player.damageTakenMul ?? 1) * 0.88;
        },
    }),
    mk({
        id: 'aegis', name: 'Aegis', patron: 'iron',
        desc: 'Below half health, take 35% less damage.',
        reqs: [REQ.defense],
        apply: (g) => { g.player.ks_aegis = true; },
    }),
    mk({
        id: 'momentum', name: 'Momentum', patron: 'iron',
        desc: 'A relentless arsenal: +35% weapon damage.',
        reqs: [REQ.arsenal4],
        apply: (g) => { g.player.damageMul = (g.player.damageMul ?? 1) * 1.35; },
    }),
    mk({
        id: 'resurgence', name: 'Resurgence', patron: 'dawn',
        desc: 'Mend brighter: +70 max HP (healed now) and +10% pickup range.',
        reqs: [REQ.sustain],
        apply: (g) => {
            g.player.maxHp += 70; g.player.hp = Math.min(g.player.hp + 70, g.player.maxHp);
            g.player.pickupRange *= 1.10;
        },
    }),
];

export const KEYSTONE_IDS = KEYSTONES.map((k) => k.id);
const BY_ID = Object.fromEntries(KEYSTONES.map((k) => [k.id, k]));
export function keystoneById(id) { return BY_ID[id]; }

// Breadcrumbs for the level-up screen: Keystones that are level-eligible, not
// yet taken, and exactly ONE recipe piece short — so the hint stays legible
// ("Conflagration — needs a Shock weapon") instead of dumping every locked
// capstone. Returns up to `max`, nearest-in-list first.
export function keystoneBreadcrumbs(game, isTaken = () => false, max = 2) {
    if (!levelOk(game)) return [];
    const out = [];
    for (const k of KEYSTONES) {
        if (isTaken(k.id) || k.available(game)) continue;
        const miss = k.missing(game);
        if (miss.length === 1) {
            out.push({ id: k.id, name: k.name, need: miss[0].label });
            if (out.length >= max) break;
        }
    }
    return out;
}
