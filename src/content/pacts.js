// Ashen Pacts — the Wick Roads' devil's-bargains. Offered at the Wick Shrine
// alongside relics and fusions (as a third altar choice kind), a pact pairs a
// CURSE (a run-long downside) with a BLESSING (a run-long upside) — the game's
// first deliberate downside choice, giving Composure + the hypergrowth wall real
// tension to push against.
//
// Like relics/keystones, each pact is a single declarative apply(game) hook. The
// CURSE nudges the live runScale (enemy hp/speed/damage/elite/cap — folded into
// waveState every frame by _applyRunScale, and re-clamped by WAVE_LIMITS) and/or
// a player malus; the BLESSING buffs an already-clamped player field. Both stay
// bounded, and a pact is one-per-run (the roller excludes claimed pacts), so a
// devil's-bargain can never runaway past the existing ceilings.

// Small helpers so a curse can never drive a stat to a broken value.
function loseMaxHp(player, amount) {
    player.maxHp = Math.max(1, player.maxHp - amount);
    player.hp = Math.min(player.hp, player.maxHp);
}

export const PACTS = [
    {
        id: 'pact-fury', name: 'Pact of Fury', rarity: 'uncommon',
        curse: 'Enemies deal +25% damage.', boon: '+25% weapon damage.',
        apply(g) { g.runScale.damage *= 1.25; g.player.damageMul *= 1.25; },
    },
    {
        id: 'pact-vigil', name: 'Pact of the Vigil', rarity: 'uncommon',
        curse: 'Enemies have +30% HP.', boon: '+22% weapon damage.',
        apply(g) { g.runScale.hp *= 1.30; g.player.damageMul *= 1.22; },
    },
    {
        id: 'pact-tempest', name: 'Pact of the Tempest', rarity: 'uncommon',
        curse: 'Enemies move +15% faster.', boon: '-12% weapon cooldowns.',
        apply(g) { g.runScale.speed *= 1.15; g.player.cooldownMul *= 0.88; },
    },
    {
        id: 'pact-swarm', name: 'Pact of the Swarm', rarity: 'uncommon',
        curse: 'The horde presses harder (+15% cap, faster spawns).', boon: '+30% XP and +35% pickup range.',
        apply(g) { g.runScale.cap *= 1.15; g.runScale.interval *= 0.9; g.player.xpMultiplier *= 1.3; g.player.pickupRange *= 1.35; },
    },
    {
        id: 'pact-glass', name: 'Pact of Glass', rarity: 'rare',
        curse: 'You take +20% damage.', boon: '+35% weapon damage.',
        apply(g) { g.player.damageTakenMul = (g.player.damageTakenMul ?? 1) * 1.2; g.player.damageMul *= 1.35; },
    },
    {
        id: 'pact-frailty', name: 'Pact of Frailty', rarity: 'rare',
        curse: '-25 Max HP.', boon: '+20% weapon damage and +10% move speed.',
        apply(g) { loseMaxHp(g.player, 25); g.player.damageMul *= 1.2; g.player.speed *= 1.1; },
    },
    {
        id: 'pact-ruin', name: 'Pact of Ruin', rarity: 'rare',
        curse: 'Elites are far more common.', boon: '+0.6 Crit Damage.',
        apply(g) { g.runScale.elite *= 1.6; g.player.critMul = (g.player.critMul ?? 2) + 0.6; },
    },
    {
        id: 'pact-embers', name: 'Pact of Embers', rarity: 'rare',
        curse: 'Enemies deal +20% damage.', boon: '+40% burn damage and deeper chill.',
        apply(g) { g.runScale.damage *= 1.2; g.player.burnDamageMul = (g.player.burnDamageMul ?? 1) * 1.4; g.player.chillStrength = (g.player.chillStrength ?? 0) + 0.25; },
    },
    {
        id: 'pact-void', name: 'Pact of the Void', rarity: 'rare',
        curse: '-15% move speed.', boon: '+30% weapon damage and reflect 30% contact damage.',
        apply(g) { g.player.speed *= 0.85; g.player.damageMul *= 1.3; g.player.thornsReflect = (g.player.thornsReflect ?? 0) + 0.3; },
    },
    {
        id: 'pact-avarice', name: 'Pact of Avarice', rarity: 'rare',
        curse: 'You take +15% damage.', boon: '+60% coins and better chest luck.',
        apply(g) { g.player.damageTakenMul = (g.player.damageTakenMul ?? 1) * 1.15; g.player.coinMul *= 1.6; g.player.chestLuck = (g.player.chestLuck ?? 0) + 0.15; },
    },
    {
        id: 'pact-lastlight', name: 'Pact of the Last Light', rarity: 'epic',
        curse: '-30 Max HP.', boon: '+35% damage while below half HP, and heal 2 HP per kill.',
        apply(g) { loseMaxHp(g.player, 30); g.player.lowHpDamageBonus = (g.player.lowHpDamageBonus ?? 0) + 0.35; g.player.killHeal = (g.player.killHeal ?? 0) + 2; },
    },
    {
        id: 'pact-cataclysm', name: 'Pact of Cataclysm', rarity: 'epic',
        curse: 'Enemies gain +25% HP and +20% damage.', boon: '+40% weapon damage.',
        apply(g) { g.runScale.hp *= 1.25; g.runScale.damage *= 1.2; g.player.damageMul *= 1.4; },
    },
    // ── Build-warping (v1.3, P2.6): bargains that change HOW you play the ──
    // rest of the run, not just how big the numbers are.
    {
        // Starve the level curve, feast on everything else — warps the run
        // from draft-chasing into kill-and-collect (fewer level-ups means the
        // pity-weighted draft you DO get matters more).
        id: 'pact-famine', name: 'Pact of Famine', rarity: 'epic',
        curse: '-30% XP from gems.', boon: '+30% weapon damage, +25% coins, better chest luck.',
        apply(g) {
            g.player.xpMultiplier *= 0.70;
            g.player.damageMul *= 1.3;
            g.player.coinMul = (g.player.coinMul ?? 1) * 1.25;
            g.player.chestLuck = (g.player.chestLuck ?? 0) + 0.10;
        },
    },
    {
        // Trade the kite for the bunker: slower feet, but a relentless rate
        // of fire and a thicker hide — hold ground instead of running it.
        id: 'pact-stillwick', name: 'Pact of the Still Wick', rarity: 'epic',
        curse: '-18% move speed.', boon: '-18% weapon cooldowns and take 12% less damage.',
        apply(g) {
            g.player.speed *= 0.82;
            g.player.cooldownMul *= 0.82;
            g.player.damageTakenMul = (g.player.damageTakenMul ?? 1) * 0.88;
        },
    },
];

const PACT_BY_ID = Object.fromEntries(PACTS.map((p) => [p.id, p]));

export function getPact(id) {
    return PACT_BY_ID[id] ?? null;
}
