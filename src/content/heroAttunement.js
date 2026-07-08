// heroAttunement.js — the per-hero coin sink (KINDLED update #3, PR5), deliberately
// PARALLEL to Relic Attunement (relics.js) but keyed by HERO id, not relic id.
// Levels 0..5; cost 400×1.6^level; rungs 3/4/5 are RITE-GATED (coins alone can't buy
// mastery). Every effect reads at exactly one existing hook — see attuneEffects.
//
// Append-only + derived from CHARACTER_IDS at the call sites: nothing here hardcodes
// the hero count, so update #10 adds a hero by adding to characters.js with zero
// surgery in this file.

export const HERO_ATTUNE_MAX = 5;

// Coin cost to go FROM `level` to level+1 (400, 640, 1024, 1638, 2621 → ~6.3k to L5).
export function heroAttuneCost(level) {
    return Math.round(400 * Math.pow(1.6, Math.max(0, level | 0)));
}

// Rite gate: buying INTO `targetLevel` needs this many of the hero's rites complete.
// L1/L2 are coins-only (0); L3 needs 1 rite, L4 needs 2, L5 needs 3.
export function heroAttuneRiteGate(targetLevel) {
    if (targetLevel >= 5) return 3;
    if (targetLevel >= 4) return 2;
    if (targetLevel >= 3) return 1;
    return 0;
}

// The five cumulative effects a given attunement level grants (one knob per level).
// Read at: Kindle gain (KindleSystem._add), blink cooldown (startBlinkCooldown), ult
// damage (signatures castMul), focused-target (signatures strike), ult cost
// (KindleSystem spendUlt/ready + fizzle refund kept consistent).
export function attuneEffects(level) {
    const l = Math.max(0, Math.min(HERO_ATTUNE_MAX, level | 0));
    return {
        kindleGainMul: 1 + (l >= 1 ? 0.10 : 0),    // L1: +10% meter gain
        blinkCdReduce: (l >= 2 ? 0.5 : 0),          // L2: −0.5s off the blink cooldown
        ultDamageMul: 1 + (l >= 3 ? 0.12 : 0),      // L3: +12% ult damage
        focusDamageMul: 1 + (l >= 4 ? 0.08 : 0),    // L4: +8% ult damage vs the focused target
        ultCost: (l >= 5 ? 85 : 100),               // L5: ult costs 85 (of 100) meter
        crown: l >= 5,                              // L5: ult VFX ember-crown flourish
    };
}

// Stamp the PLAYER-read attunement multipliers (ult + focused damage) at run start.
// The Kindle-gain / blink-CD / ult-cost effects live on the KindleSystem instance
// (it owns those numbers); this only sets the two fields signatures.js reads.
export function applyHeroAttunement(player, level) {
    if (!player) return;
    const eff = attuneEffects(level);
    player.ultDamageMul = eff.ultDamageMul;
    player.focusDamageMul = eff.focusDamageMul;
}
