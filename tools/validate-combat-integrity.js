#!/usr/bin/env node
// Focused regression checks for two cross-system combat invariants:
//   1. A corpse's authored Enemy.xpValue becomes exactly one value-conserving
//      gem (including the elite multiplier and high-value apex rewards).
//   2. A hostile projectile's swept wall collision resolves before it is
//      allowed to damage a player behind cover.
//
// No browser or third-party test runner is required. A tiny Canvas stub lets
// the real pickup/projectile constructors build their cached procedural art;
// all gameplay assertions exercise the production methods directly.

import { readFileSync } from 'node:fs';
import { ENEMY, ELITE, GEM } from '../src/config/GameConfig.js';

let checks = 0;
function assert(ok, message) {
    checks++;
    if (!ok) throw new Error(message);
}

// Procedural sprite constructors only need a write-only Canvas2D surface in
// this validator. Unknown drawing calls are harmless no-ops.
const gradient = { addColorStop() {} };
const context = new Proxy({}, {
    get(_target, key) {
        if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => gradient;
        if (key === 'measureText') return () => ({ width: 0 });
        return () => {};
    },
    set() { return true; },
});
globalThis.document = {
    createElement() {
        return { width: 0, height: 0, getContext: () => context };
    },
};

const {
    CombatResolverMethods,
    gemTierForXp,
    normalizeEnemyXp,
} = await import('../src/core/CombatResolver.js');
const { EnemyProjectile } = await import('../src/entities/EnemyProjectile.js');

function validateXpReward(value, expectedTier, label) {
    const game = {
        gems: [],
        obstacleSystem: { isBlocked: () => false },
        _clearSpot: (x, y) => ({ x, y }),
    };
    CombatResolverMethods._dropGem.call(game, 120, -80, value);
    assert(game.gems.length === 1, `${label}: created ${game.gems.length} gems instead of one`);
    const gem = game.gems[0];
    assert(gem.xp === normalizeEnemyXp(value), `${label}: stored ${gem.xp} XP, expected ${normalizeEnemyXp(value)}`);
    assert(gem.tier === expectedTier, `${label}: used ${gem.tier} art, expected ${expectedTier}`);
}

function validateAuthoredXp() {
    validateXpReward(ENEMY.slime.xpValue, 'small', 'slime');
    validateXpReward(ENEMY.brute.xpValue, 'small', 'brute');
    validateXpReward(ENEMY.slime.xpValue * ELITE.xpMul, 'medium', 'elite slime');
    validateXpReward(ENEMY.brute.xpValue * ELITE.xpMul, 'large', 'elite brute');
    validateXpReward(ENEMY.vinebackGoliath.xpValue, 'large', 'first-map boss');
    validateXpReward(ENEMY.solnakh.xpValue, 'large', 'final-map apex');
    validateXpReward(2.5, 'small', 'fractional authored reward');
    validateXpReward(Number.NaN, 'small', 'invalid reward fallback');

    assert(gemTierForXp(GEM.small.xp) === 'small', 'small threshold changed');
    assert(gemTierForXp(GEM.medium.xp) === 'medium', 'medium threshold changed');
    assert(gemTierForXp(GEM.large.xp) === 'large', 'large threshold changed');

    // Guard the two production death paths, not merely the pure helper.
    const source = readFileSync(new URL('../src/core/CombatResolver.js', import.meta.url), 'utf8');
    assert(source.includes('this._dropGem(e.x, e.y, e.xpValue)'),
        'canonical corpse path no longer forwards Enemy.xpValue');
    assert(source.includes('this._dropGem(other.x, other.y, other.xpValue)'),
        'volatile collateral corpse path no longer forwards Enemy.xpValue');
    assert(!source.includes('pickWeighted(GEM_TIERS'),
        'random gem value roll returned and bypasses authored XP');
}

function makePlayer(x = 100, y = 0) {
    return {
        x, y, radius: 50, hp: 100, hitCalls: 0,
        takeDamage(amount) {
            this.hitCalls++;
            this.hp -= amount;
            return amount;
        },
    };
}

function makeBolt() {
    return new EnemyProjectile(0, 0, 100, 0, 25, { radius: 10, lifetime: 2 });
}

function validateHostileProjectileCover() {
    const blockedPlayer = makePlayer();
    const wallCalls = [];
    const wall = {
        segmentBlocked(...args) {
            wallCalls.push(args);
            return true;
        },
    };
    const blockedBolt = makeBolt();
    const blockedDamage = blockedBolt.update(1, blockedPlayer, wall);
    assert(blockedDamage === 0, `wall-blocked bolt dealt ${blockedDamage}`);
    assert(blockedPlayer.hp === 100 && blockedPlayer.hitCalls === 0,
        'wall-blocked bolt reached Player.takeDamage');
    assert(!blockedBolt.active, 'wall-blocked bolt remained active');
    assert(wallCalls.length === 1, `wall sweep ran ${wallCalls.length} times`);
    assert(wallCalls[0][0] === 0 && wallCalls[0][1] === 0 &&
        wallCalls[0][2] === 100 && wallCalls[0][3] === 0,
    'wall sweep did not cover the projectile movement segment');

    const openPlayer = makePlayer();
    const openBolt = makeBolt();
    const openDamage = openBolt.update(1, openPlayer, { segmentBlocked: () => false });
    assert(openDamage === 25, `open bolt dealt ${openDamage}, expected 25`);
    assert(openPlayer.hp === 75 && openPlayer.hitCalls === 1, 'open bolt did not hit exactly once');
    assert(!openBolt.active, 'open bolt was not consumed on player overlap');

    // Optional obstacle argument preserves the entity's focused/open-field API.
    const fallbackPlayer = makePlayer();
    const fallbackBolt = makeBolt();
    assert(fallbackBolt.update(1, fallbackPlayer) === 25,
        'two-argument EnemyProjectile.update fallback stopped dealing open-field damage');

    const updateSource = readFileSync(new URL('../src/core/GameUpdate.js', import.meta.url), 'utf8');
    assert(updateSource.includes('ep.update(dt, this.player, this.obstacleSystem)'),
        'GameUpdate does not pass the obstacle authority into hostile projectiles');
    assert(!updateSource.includes('segmentBlocked(epx, epy, ep.x, ep.y)'),
        'post-damage hostile wall check returned to GameUpdate');
}

validateAuthoredXp();
validateHostileProjectileCover();

console.log(
    `combat integrity validation: OK — ${checks} checks; authored XP is value-conserving ` +
    'and hostile cover resolves before damage.',
);
