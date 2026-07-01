// Relics — the Wick Roads' persistent in-run item class. A relic is claimed at a
// Wick Shrine (the walk-onto altar that appears when a boss falls) and its effect
// lasts the whole run. Each relic is a SINGLE declarative hook, exactly like a
// keystone: apply(player) nudges one already-clamped player field, so relics can
// never break the late-game caps in Player._applyPlayerCaps / CAPS. No per-frame
// cost — the effect is folded in once, at pick time.
//
// PR1 ships a small starter tier to prove the altar spine end-to-end; the full
// 24-relic library (with signature verbs + a discovery codex) lands in PR2.

export const RELICS = [
    {
        id: 'emberheart',
        name: 'Emberheart',
        rarity: 'uncommon',
        description: '+30 Max HP, and heal for that much now.',
        apply(player) {
            player.maxHp += 30;
            player.hp = Math.min(player.maxHp, player.hp + 30);
        },
    },
    {
        id: 'swiftsole',
        name: 'Swiftsole',
        rarity: 'common',
        description: '+8% Move Speed. Outrun the dark a little longer.',
        apply(player) {
            player.speed *= 1.08;
        },
    },
    {
        id: 'keen-ember',
        name: 'Keen Ember',
        rarity: 'rare',
        description: '+8% Crit Chance. Every strike could catch.',
        apply(player) {
            // Clamp to the 0.8 crit ceiling every other crit source respects.
            player.critChance = Math.min(0.8, (player.critChance ?? 0) + 0.08);
        },
    },
    {
        id: 'gatherers-charm',
        name: "Gatherer's Charm",
        rarity: 'common',
        description: '+35% Pickup Range and +12% XP gain.',
        apply(player) {
            player.pickupRange *= 1.35;
            player.xpMultiplier *= 1.12;
        },
    },
    {
        id: 'warding-cinder',
        name: 'Warding Cinder',
        rarity: 'rare',
        description: 'Take 10% less damage from everything.',
        apply(player) {
            player.damageTakenMul = (player.damageTakenMul ?? 1) * 0.9;
        },
    },
    {
        id: 'wrathspark',
        name: 'Wrathspark',
        rarity: 'epic',
        description: '+14% weapon damage. The wick burns hotter.',
        apply(player) {
            player.damageMul *= 1.14;
        },
    },
];

const RELIC_BY_ID = Object.fromEntries(RELICS.map((r) => [r.id, r]));

export function getRelic(id) {
    return RELIC_BY_ID[id] ?? null;
}
