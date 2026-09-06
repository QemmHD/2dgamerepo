#!/usr/bin/env node
// Exercise production damage sinks and pickup hooks. Attribution may describe
// an earlier attacker for legacy recap text, but only a fresh lethal hit may
// authorize a specific first-death lesson.
import assert from 'node:assert/strict';

const gradient = { addColorStop() {} };
const context = new Proxy({}, {
    get(_target, key) {
        if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => gradient;
        return () => {};
    },
    set() { return true; },
});
globalThis.document = { createElement: () => ({ getContext: () => context }) };

const { Player } = await import('../src/entities/Player.js');
const { EnemyProjectile } = await import('../src/entities/EnemyProjectile.js');
const { CollisionSystem } = await import('../src/systems/CollisionSystem.js');
const { HazardSystem } = await import('../src/systems/HazardSystem.js');
const { CombatResolverMethods } = await import('../src/core/CombatResolver.js');
const { GameUpdateMethods } = await import('../src/core/GameUpdate.js');
const { OnboardingDirector } = await import('../src/systems/OnboardingDirector.js');
let scenarios = 0;

function player(hp = 100, invincibleTimer = 0) {
    return Object.assign(Object.create(Player.prototype), {
        x: 0, y: 0, radius: 10, hp, maxHp: 100, invincibleTimer,
        damageTakenMul: 1, endlessSurcharge: 0, composure: 1,
        thornsReflect: 0, coins: 0,
    });
}

function touch(damage, label = 'Slime') {
    return { active: true, x: 0, y: 0, radius: 10, contactDamage: damage, def: { label } };
}

for (const count of [1, 3, 10]) {
    for (const hp of [100, 5]) {
        const p = player(hp);
        const enemies = Array.from({ length: count }, (_, i) => touch(i === 0 ? 10 : 5));
        enemies.push({ ...touch(999), active: false }, { ...touch(999), x: 1000 });
        const result = new CollisionSystem().resolve(0.016, p, enemies, []);
        const expected = Math.min(hp, Math.min(10 + (count - 1) * 5 * 0.3, 10 * 1.9));
        assert.equal(result.playerDamageTaken, expected, 'contact damage changed');
        assert.equal(result.strongest.kind, 'contact');
        assert.equal(result.strongest.contactCount, count, 'inactive/distant body counted');
        assert.equal(result.strongest.label, 'Slime');
        assert.equal(result.strongest.lethal, hp <= expected);
        assert.equal(result.strongest.fresh, hp <= expected);
        scenarios++;
    }
}
for (const p of [player(100, 1), player(0)]) {
    const result = new CollisionSystem().resolve(0.016, p, [touch(10)], []);
    assert.equal(result.playerHit, false);
    assert.equal(result.strongest, null, 'zero contact damage created attribution');
    scenarios++;
}

function gameFor(p) {
    return {
        player: p, damageNumbers: [],
        lastHitBy: { label: 'old attacker', kind: 'contact', lethal: false, fresh: false },
        _playerHurtShake() {}, _shake() {}, _pushFeedback() {},
        obstacleSystem: { hasLineOfSight: () => true, segmentBlocked: () => false },
        particles: { deathBurst() {} },
    };
}

const hazardKinds = ['brambles', 'iceSlick', 'delayedZone', 'beam', 'lingering', 'shockwave'];
for (const kind of hazardKinds) {
    for (const hp of [100, 5]) {
        const game = gameFor(player(hp));
        game.hazards = [{
            active: true, kind, age: 0.2, lifetime: kind === 'delayedZone' ? 0.2 : 10,
            biome: kind === 'brambles' || kind === 'iceSlick', warn: 0,
            x: kind === 'beam' ? -5 : 0, y: 0, r: 20, rMax: 100, growth: 0,
            tickTimer: 0, tickDamage: 10, damage: 10, band: 30,
            angle: 0, sweep: 0, length: 100, detonateAge: 0,
        }];
        new HazardSystem().update(0.016, game);
        assert.equal(game.player.hp, Math.max(0, hp - 10), `${kind}: damage changed`);
        assert.equal(game.lastHitBy.kind, 'hazard');
        assert.equal(game.lastHitBy.hazardKind, kind);
        assert.equal(game.lastHitBy.hazard, true, 'legacy hazard grammar lost');
        assert.equal(game.lastHitBy.lethal, hp <= 10);
        assert.equal(game.lastHitBy.fresh, hp <= 10);
        scenarios++;
    }
}
{
    const game = gameFor(player(100, 1));
    const old = game.lastHitBy;
    game.hazards = [{ active: true, kind: 'lingering', x: 0, y: 0, r: 20,
        age: 0, lifetime: 10, warn: 0, tickTimer: 0, tickDamage: 10 }];
    new HazardSystem().update(0.016, game);
    assert.equal(game.lastHitBy, old, 'blocked hazard hit replaced source');
    scenarios++;
}

for (const sourceLabel of [null, { label: 'The Apex', epithet: 'Ash King', boss: true }, 'a stray bolt']) {
    for (const hp of [100, 5]) {
        const game = gameFor(player(hp));
        game.projectiles = [];
        game.enemyProjectiles = [new EnemyProjectile(0, 0, 0, 0, 10, { sourceLabel })];
        GameUpdateMethods._updateProjectiles.call(game, 0.016);
        assert.equal(game.player.hp, Math.max(0, hp - 10));
        assert.equal(game.lastHitBy.kind, 'projectile');
        assert.equal(game.lastHitBy.label, typeof sourceLabel === 'string'
            ? sourceLabel : sourceLabel?.label || 'an enemy projectile');
        assert.equal(game.lastHitBy.boss, !!sourceLabel?.boss);
        assert.equal(game.lastHitBy.lethal, hp <= 10);
        assert.equal(game.lastHitBy.fresh, hp <= 10);
        if (sourceLabel && typeof sourceLabel === 'object') {
            assert.equal(sourceLabel.kind, undefined, 'projectile source metadata was mutated');
        }
        scenarios++;
    }
}
for (const blocked of ['cover', 'iframes']) {
    const game = gameFor(player(100, blocked === 'iframes' ? 1 : 0));
    const old = game.lastHitBy;
    game.obstacleSystem.segmentBlocked = () => blocked === 'cover';
    game.projectiles = [];
    game.enemyProjectiles = [new EnemyProjectile(0, 0, 0, 0, 10)];
    GameUpdateMethods._updateProjectiles.call(game, 0.016);
    assert.equal(game.lastHitBy, old, `${blocked}: zero damage replaced source`);
    assert.equal(game.player.hp, 100);
    scenarios++;
}

{
    const p = player(5);
    const game = Object.assign(gameFor(p), {
        collisionSystem: new CollisionSystem(), enemies: [touch(10)], projectiles: [],
        _selfDetonated: [], _hazardKilled: [],
    });
    CombatResolverMethods._resolveCombat.call(game, 0.016, { hits: [], killed: [] }, { killed: [] });
    assert.equal(game.lastHitBy.kind, 'contact', 'contact context did not reach Game');
    assert.equal(game.lastHitBy.fresh, true);
    // Same-frame healing and a later direct/unknown death must not reuse this
    // lethal flag. The legacy label remains available to existing recap code.
    p.hp = 10;
    game.screen = 'start';
    game._updateFeedback = () => {};
    game._updateMenuScreen = () => {};
    GameUpdateMethods.update.call(game, 0.016);
    assert.equal(game.lastHitBy.label, 'Slime');
    assert.equal(game.lastHitBy.lethal, false);
    assert.equal(game.lastHitBy.fresh, false);
    scenarios++;
}

{
    const onboarding = new OnboardingDirector();
    const p = player();
    let gainedXp = 0;
    p.gainXP = (value) => { gainedXp += value; return 0; };
    function pickup(value) {
        return { active: true, x: 0, y: 0, tier: 'small', update() { this.active = false; return value; } };
    }
    const game = {
        player: p, onboarding, gems: [pickup(3), pickup(4), pickup(0)],
        coins: [pickup(2), pickup(5), pickup(0)], healthOrbs: [],
        particles: { pickupSparkle() {} }, audio: { gem() {}, coin() {} },
    };
    GameUpdateMethods._updatePickups.call(game, 0.016);
    assert.equal(gainedXp, 7);
    assert.equal(p.coins, 7);
    assert.equal(onboarding.counts.xpPickedUp, 7);
    assert.equal(onboarding.counts.coinsPickedUp, 7);
    GameUpdateMethods._updatePickups.call(game, 0.016);
    assert.equal(onboarding.counts.xpPickedUp, 7, 'inactive pickup replayed shard success');
    assert.equal(onboarding.counts.coinsPickedUp, 7, 'inactive pickup replayed coin success');
    scenarios++;
}

console.log(`Damage context: ${scenarios} production scenarios OK`);
