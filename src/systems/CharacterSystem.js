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
    // Tag the player so renders / debug can read which hero is active.
    player.characterId = c.id;
    return c;
}
