// Relics — the Wick Roads' persistent in-run item class. A relic is claimed at a
// Wick Shrine (the walk-onto altar that appears when a boss falls) and its effect
// lasts the whole run. Each relic is a SINGLE declarative hook, exactly like a
// keystone: apply(player) nudges one (or two) already-clamped player field(s), so
// relics can never break the late-game caps in Player._applyPlayerCaps / CAPS.
// No per-frame cost — the effect is folded in once, at pick time.
//
// The roller (WickRoadsSystem) never offers a relic already claimed this run, so
// at most one of each is held per run — stacking is bounded by the library, and
// every field a relic touches is either hard-clamped each frame (damageMul,
// cooldownMul, speed, pickupRange, critChance) or naturally bounded (regen +
// killHeal ride the sustained-heal cap; the rest are modest per-pick nudges read
// by weapons with their own limits), mirroring how passives/keystones behave.

export const RELICS = [
    // ── Common ────────────────────────────────────────────────────────────
    {
        id: 'swiftsole', name: 'Swiftsole', rarity: 'common',
        description: '+8% Move Speed. Outrun the dark a little longer.',
        apply(p) { p.speed *= 1.08; },
    },
    {
        id: 'tinderscrap', name: 'Tinderscrap', rarity: 'common',
        description: '+18 Max HP, and heal for that much now.',
        apply(p) { p.maxHp += 18; p.hp = Math.min(p.maxHp, p.hp + 18); },
    },
    {
        id: 'farsight', name: 'Farsight Lens', rarity: 'common',
        description: '+25% Pickup Range. Draw the embers in.',
        apply(p) { p.pickupRange *= 1.25; },
    },
    {
        id: 'quickwick', name: 'Quickwick', rarity: 'common',
        description: '-6% weapon cooldowns. Strike a touch faster.',
        apply(p) { p.cooldownMul *= 0.94; },
    },
    {
        id: 'coinlust', name: 'Coinlust', rarity: 'common',
        description: '+15% coins earned this run.',
        apply(p) { p.coinMul *= 1.15; },
    },
    {
        id: 'scholars-wick', name: "Scholar's Wick", rarity: 'common',
        description: '+18% XP gain. Learn faster.',
        apply(p) { p.xpMultiplier *= 1.18; },
    },
    // ── Uncommon ──────────────────────────────────────────────────────────
    {
        id: 'emberheart', name: 'Emberheart', rarity: 'uncommon',
        description: '+30 Max HP, and heal for that much now.',
        apply(p) { p.maxHp += 30; p.hp = Math.min(p.maxHp, p.hp + 30); },
    },
    {
        id: 'gatherers-charm', name: "Gatherer's Charm", rarity: 'uncommon',
        description: '+35% Pickup Range and +12% XP gain.',
        apply(p) { p.pickupRange *= 1.35; p.xpMultiplier *= 1.12; },
    },
    {
        id: 'hearthblood', name: 'Hearthblood', rarity: 'uncommon',
        description: '+1.5 HP/sec regeneration (out of combat).',
        apply(p) { p.regenPerSecond = (p.regenPerSecond ?? 0) + 1.5; },
    },
    {
        id: 'stoneskin', name: 'Stoneskin Wrap', rarity: 'uncommon',
        description: 'Take 7% less damage from everything.',
        apply(p) { p.damageTakenMul = (p.damageTakenMul ?? 1) * 0.93; },
    },
    {
        id: 'emberfury', name: 'Emberfury', rarity: 'uncommon',
        description: '+10% weapon damage.',
        apply(p) { p.damageMul *= 1.10; },
    },
    {
        id: 'frostbrand', name: 'Frostbrand', rarity: 'uncommon',
        description: '+20% chill strength. Frost bites deeper.',
        apply(p) { p.chillStrength = (p.chillStrength ?? 0) + 0.2; },
    },
    {
        id: 'thornmail', name: 'Thornmail', rarity: 'uncommon',
        description: 'Reflect 25% of contact damage back at attackers.',
        apply(p) { p.thornsReflect = (p.thornsReflect ?? 0) + 0.25; },
    },
    // ── Rare ──────────────────────────────────────────────────────────────
    {
        id: 'keen-ember', name: 'Keen Ember', rarity: 'rare',
        description: '+8% Crit Chance. Every strike could catch.',
        apply(p) { p.critChance = Math.min(0.8, (p.critChance ?? 0) + 0.08); },
    },
    {
        id: 'warding-cinder', name: 'Warding Cinder', rarity: 'rare',
        description: 'Take 10% less damage from everything.',
        apply(p) { p.damageTakenMul = (p.damageTakenMul ?? 1) * 0.9; },
    },
    {
        id: 'executioners-ember', name: "Executioner's Ember", rarity: 'rare',
        description: '+0.5 Crit Damage multiplier.',
        apply(p) { p.critMul = (p.critMul ?? 2) + 0.5; },
    },
    {
        id: 'pyre-oil', name: 'Pyre Oil', rarity: 'rare',
        description: '+30% burn damage. Fire lingers hotter.',
        apply(p) { p.burnDamageMul = (p.burnDamageMul ?? 1) * 1.3; },
    },
    {
        id: 'glacial-core', name: 'Glacial Core', rarity: 'rare',
        description: '+6% chance to freeze on frost hits.',
        apply(p) { p.freezeChanceBonus = (p.freezeChanceBonus ?? 0) + 0.06; },
    },
    {
        id: 'bloodwick', name: 'Bloodwick', rarity: 'rare',
        description: 'Heal 1.5 HP per kill (capped per second).',
        apply(p) { p.killHeal = (p.killHeal ?? 0) + 1.5; },
    },
    {
        id: 'last-ember', name: 'Last Ember', rarity: 'rare',
        description: '+25% damage while below half HP. Fight hurt.',
        apply(p) { p.lowHpDamageBonus = (p.lowHpDamageBonus ?? 0) + 0.25; },
    },
    // ── Epic ──────────────────────────────────────────────────────────────
    {
        id: 'wrathspark', name: 'Wrathspark', rarity: 'epic',
        description: '+14% weapon damage. The wick burns hotter.',
        apply(p) { p.damageMul *= 1.14; },
    },
    {
        id: 'infernal-heart', name: 'Infernal Heart', rarity: 'epic',
        description: '+45 Max HP (heal now) and take 5% less damage.',
        apply(p) { p.maxHp += 45; p.hp = Math.min(p.maxHp, p.hp + 45); p.damageTakenMul = (p.damageTakenMul ?? 1) * 0.95; },
    },
    {
        id: 'windrunner', name: 'Windrunner', rarity: 'epic',
        description: '+12% Move Speed and -5% weapon cooldowns.',
        apply(p) { p.speed *= 1.12; p.cooldownMul *= 0.95; },
    },
    // ── Legendary ─────────────────────────────────────────────────────────
    {
        id: 'wick-eternal', name: 'Wick Eternal', rarity: 'legendary',
        description: '+25% weapon damage. The last light roars.',
        apply(p) { p.damageMul *= 1.25; },
    },
];

const RELIC_BY_ID = Object.fromEntries(RELICS.map((r) => [r.id, r]));

export function getRelic(id) {
    return RELIC_BY_ID[id] ?? null;
}
