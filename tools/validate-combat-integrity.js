#!/usr/bin/env node
// Focused regression checks for cross-system combat invariants:
//   1. A corpse's authored Enemy.xpValue becomes exactly one value-conserving
//      gem (including the elite multiplier and high-value apex rewards).
//   2. A hostile projectile's swept wall collision resolves before it is
//      allowed to damage a player behind cover.
//   3. Every corpse, including volatile collateral, drains the canonical death
//      queue once; boss provenance alone controls campaign ledger credit.
//
// No browser or third-party test runner is required. A tiny Canvas stub lets
// the real pickup/projectile constructors build their cached procedural art;
// all gameplay assertions exercise the production methods directly.

import { readFileSync } from 'node:fs';
import { COIN, ENEMY, ELITE, GEM } from '../src/config/GameConfig.js';

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
const {
    BOSS_SPAWN_PROVENANCE,
    normalizeBossSpawnProvenance,
} = await import('../src/entities/Enemy.js');
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

    // Guard the production death queue, not merely the pure helper.
    const source = readFileSync(new URL('../src/core/CombatResolver.js', import.meta.url), 'utf8');
    assert(source.includes('this._dropGem(e.x, e.y, e.xpValue)'),
        'canonical corpse path no longer forwards Enemy.xpValue');
    assert(source.includes('enqueueDeath?.(other, { suppressAffix: true })'),
        'volatile collateral no longer enters the affix-suppressed canonical queue');
    assert(!source.includes('this._dropGem(other.x, other.y, other.xpValue)'),
        'volatile collateral restored a competing direct reward path');
    assert(!source.includes('pickWeighted(GEM_TIERS'),
        'random gem value roll returned and bypasses authored XP');
}

function makeCorpse({
    type,
    x,
    boss = false,
    elite = false,
    active = false,
    provenance = null,
    affix = null,
} = {}) {
    return {
        type,
        name: type,
        x,
        y: 0,
        radius: boss ? 60 : 18,
        active,
        boss,
        elite,
        lieutenant: false,
        xpValue: boss ? 125 : 12,
        bossSpawnProvenance: provenance,
        affix,
        affixDef: affix === 'volatile'
            ? { explodeRadius: 120, explodeDamage: 9999, tint: '#ff6600' }
            : null,
        affixColor: '#ff6600',
        def: {},
        takeDamage(amount) {
            this.damageTaken = (this.damageTaken ?? 0) + amount;
            this.active = false;
        },
    };
}

function makeDeathQueueFixture({
    provenance = BOSS_SPAWN_PROVENANCE.MAP_DIRECTOR,
    eligible = true,
    bypass = false,
} = {}) {
    // The source corpse is repeated by collision + weapon results to prove
    // identity dedupe. Its blast kills a boss that also carries a synthetic
    // volatile affix; collateral suppression must prevent a second explosion.
    const source = makeCorpse({ type: 'volatile-elite', x: 0, elite: true, affix: 'volatile' });
    const boss = makeCorpse({
        type: 'stormwingAlpha',
        x: 30,
        boss: true,
        active: true,
        provenance,
        affix: 'volatile',
    });
    const summon = {
        type: 'slime', name: 'slime', x: 900, y: 0, radius: 12,
        active: true, boss: false, elite: false, lieutenant: false,
        bossOwnerId: boss.type, xpValue: 2, def: {}, takeDamage() {},
    };
    const receipt = {
        accepted: true,
        changed: true,
        mapId: 'emberwood',
        bossId: boss.type,
        newlyUnlockedMapId: 'hollowreach',
    };
    const calls = {
        gems: [],
        campaign: [],
        kindle: [],
        notifyKills: [],
        combos: [],
        volatileBoom: 0,
        killCue: 0,
        bossDefeat: 0,
        bossRewards: 0,
        bossCoins: 0,
        directorDefeats: 0,
        lieutenantResets: 0,
    };
    const game = {
        collisionSystem: { resolve: () => ({ killed: [source, source], hits: [] }) },
        player: {
            hp: 100, maxHp: 100, killHeal: 0, radius: 20,
            healSustained() {},
        },
        enemies: [source, boss, summon],
        projectiles: [],
        spatialIndex: null,
        _selfDetonated: [],
        _hazardKilled: [],
        kills: 0,
        kindleSystem: { onKills(batch) { calls.kindle.push(...batch); } },
        _addCombo(n) { calls.combos.push(n); },
        audio: {
            kill() { calls.killCue++; },
            volatileBoom() { calls.volatileBoom++; },
            bossDefeat() { calls.bossDefeat++; },
            playMusic() {},
            lieutenantDown() {},
        },
        waveDirector: {
            notifyKill(n) { calls.notifyKills.push(n); },
            announce() {},
        },
        _encounterDefeatedIds: [],
        _encounterRewardPos: null,
        particles: {
            deathBurst() {},
            bossDeathBurst() {},
        },
        weaponSystem: { effects: [] },
        damageNumbers: [],
        _inView: () => true,
        _shake() {},
        _dropGem(_x, _y, value) { calls.gems.push(value); },
        _dropChest() {},
        _dropCoin() {},
        _dropCoinBurst(_x, _y, count, value) {
            if (count === COIN.bossCoinCount && value === COIN.bossCoinValue) calls.bossCoins++;
        },
        _dropBossReward() { calls.bossRewards++; },
        _splitOnDeath() {},
        healthOrbs: [],
        enemyProjectiles: [
            { active: true, sourceLabel: { boss: true } },
            { active: true, sourceLabel: { biome: true } },
        ],
        hazards: [
            { active: true, bossOwned: true },
            { active: true, bossOwned: false },
        ],
        bossSummons: [{ owner: boss.type }],
        bossesDefeated: 0,
        bossRush: null,
        bossDirector: { notifyBossDefeated() { calls.directorDefeats++; } },
        lieutenantDirector: { reset() { calls.lieutenantResets++; } },
        time: 240,
        pendingCrossroads: false,
        _victoryShown: false,
        _showVictory() { throw new Error('first boss incorrectly opened victory'); },
        _hitStop() {},
        _spawnRing() {},
        haptics: { pulse() {} },
        arena: { x: 0, y: 0, r: 100 },
        campaignRun: { eligible, mapId: 'emberwood', taintReason: null },
        saveSystem: {
            getMapBypassActive: () => bypass,
            recordCampaignBossDefeat(input) {
                calls.campaign.push(input);
                return receipt;
            },
        },
        _latestCampaignBossDefeatReceipt: null,
        _campaignUnlockReceipt: null,
    };
    game._applyAffixDeath = (enemy, enqueue) =>
        CombatResolverMethods._applyAffixDeath.call(game, enemy, enqueue);
    return { game, source, boss, summon, receipt, calls };
}

function runDeathQueueFixture(options) {
    const fixture = makeDeathQueueFixture(options);
    CombatResolverMethods._resolveCombat.call(
        fixture.game,
        1 / 60,
        { killed: [fixture.source], hits: [] },
        { killed: [], hits: [] },
    );
    return fixture;
}

function validateCanonicalDeathQueue() {
    const eligible = runDeathQueueFixture();
    const { game, source, boss, summon, receipt, calls } = eligible;
    assert(game.kills === 2, `deduped volatile queue credited ${game.kills} kills instead of 2`);
    assert(calls.gems.length === 2 && calls.gems.includes(source.xpValue) && calls.gems.includes(boss.xpValue),
        'canonical queue did not award exactly one authored-XP gem per unique corpse');
    assert(calls.kindle.length === 2 && new Set(calls.kindle).size === 2,
        'Kindle received duplicate or missing canonical corpses');
    assert(calls.notifyKills.reduce((sum, n) => sum + n, 0) === 2,
        'WaveDirector kill tally diverged from the canonical queue');
    assert(calls.killCue === 1, 'a collateral batch replayed the global kill cue');
    assert(calls.volatileBoom === 1, 'volatile collateral recursively fired its own affix');
    assert(boss.damageTaken > 0 && boss.active === false, 'volatile blast did not kill the boss fixture');
    assert(game.bossesDefeated === 1 && calls.directorDefeats === 1 && calls.lieutenantResets === 1,
        'collateral boss bypassed or duplicated canonical boss progression');
    assert(calls.bossRewards === 1 && calls.bossCoins === 1 && calls.bossDefeat === 1,
        'collateral boss reward/setpiece did not execute exactly once');
    assert(game.enemyProjectiles[0].active === false && game.enemyProjectiles[1].active === true,
        'boss projectile cleanup crossed attribution boundaries');
    assert(game.hazards[0].active === false && game.hazards[1].active === true,
        'boss hazard cleanup crossed attribution boundaries');
    assert(summon.active === false && game.bossSummons.length === 0,
        'boss summon cleanup was skipped for a collateral death');
    assert(calls.campaign.length === 1
        && calls.campaign[0].mapId === 'emberwood'
        && calls.campaign[0].bossId === boss.type
        && calls.campaign[0].eligible === true,
    'eligible map-director boss did not write the exact latched campaign receipt');
    assert(game._latestCampaignBossDefeatReceipt === receipt
        && game._campaignUnlockReceipt === receipt,
    'latest/new campaign receipts were not retained for victory routing');

    const direct = runDeathQueueFixture({ provenance: BOSS_SPAWN_PROVENANCE.DIRECT });
    assert(direct.calls.campaign.length === 0,
        'direct boss spawn earned campaign credit');
    const bypass = runDeathQueueFixture({ bypass: true });
    assert(bypass.calls.campaign.length === 0
        && bypass.game.campaignRun.eligible === false
        && bypass.game.campaignRun.taintReason === 'map-bypass',
    'active QA map bypass did not permanently taint campaign credit');

    for (const value of Object.values(BOSS_SPAWN_PROVENANCE)) {
        assert(normalizeBossSpawnProvenance(value) === value,
            `known boss provenance ${value} did not round-trip`);
    }
    assert(normalizeBossSpawnProvenance('typo-source') === BOSS_SPAWN_PROVENANCE.UNKNOWN,
        'unknown boss provenance did not fail closed');
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
validateCanonicalDeathQueue();
validateHostileProjectileCover();

console.log(
    `combat integrity validation: OK — ${checks} checks; authored XP is value-conserving ` +
    'and canonical deaths/provenance/hostile cover resolve exactly once.',
);
