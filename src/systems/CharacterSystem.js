// CharacterSystem — applies the selected character's base-stat multipliers to a
// freshly-built Player. Called FIRST in the run-init pipeline (before permanent
// upgrades, gear, passives, cosmetics) so the character sets the baseline and
// everything else stacks on top exactly as before. Purely a stat + sprite
// selector; it never touches saves, weapons, or run flow directly.

import { getCharacter } from '../content/characters.js';

// Multiply/add the character's base stats onto the player's base fields. Safe
// to call once at run start; idempotent only against a fresh Player.
export function applyCharacter(player, characterId) {
    const c = getCharacter(characterId);
    const s = c.stats || {};
    player.maxHp = Math.round(player.maxHp * (s.hpMul ?? 1));
    player.hp = player.maxHp;
    player.speed *= s.speedMul ?? 1;
    player.damageMul *= s.damageMul ?? 1;
    player.cooldownMul *= s.cooldownMul ?? 1;
    player.pickupRange *= s.pickupRangeMul ?? 1;
    player.xpMultiplier *= s.xpMul ?? 1;
    player.chestLuck = (player.chestLuck ?? 0) + (s.chestLuckBonus ?? 0);
    // Offensive identity hooks (let a hero lean into the crit / low-HP-rage
    // systems). Clamped like every other crit source.
    player.critChance = Math.min(0.8, (player.critChance ?? 0) + (s.critChanceBonus ?? 0));
    player.critMul = (player.critMul ?? 2) + (s.critMulBonus ?? 0);
    player.lowHpDamageBonus = (player.lowHpDamageBonus ?? 0) + (s.lowHpRageBonus ?? 0);
    // Signature identity: pre-seed the same bounded modifier systems that
    // passives / relics / pacts feed, so a hero plays distinctly from frame one
    // and everything still stacks on top (all += / *= like every other source).
    // regen + kill-heal route through the sustained-heal cap; nothing here is
    // raw runaway damage.
    player.regenPerSecond = (player.regenPerSecond ?? 0) + (s.regenBonus ?? 0);
    player.killHeal = (player.killHeal ?? 0) + (s.killHealBonus ?? 0);
    player.thornsReflect = (player.thornsReflect ?? 0) + (s.thornsBonus ?? 0);
    player.damageTakenMul = (player.damageTakenMul ?? 1) * (s.damageTakenMul ?? 1);
    player.coinMul = (player.coinMul ?? 1) * (s.coinMul ?? 1);
    player.burnDamageMul = (player.burnDamageMul ?? 1) * (s.burnDamageMul ?? 1);
    player.chillStrength = (player.chillStrength ?? 0) + (s.chillBonus ?? 0);
    if (s.aegis) player.ks_aegis = true;   // the below-half-HP damage cut (see takeDamage)
    // Tag the player so renders / debug can read which hero is active + its signature.
    player.characterId = c.id;
    player.signature = c.signature || null;
    return c;
}
