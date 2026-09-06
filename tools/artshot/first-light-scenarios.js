// Deterministic visual fixtures for the isolated artshot profile. Fixture setup
// selects a lesson/scene; successful actions and lethal events use live Game
// methods so the render receipt cannot pass from a fabricated success flag.
import { BLINK, INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../../src/config/GameConfig.js';
import { Enemy } from '../../src/entities/Enemy.js';
import { EnemyProjectile } from '../../src/entities/EnemyProjectile.js';
import { OnboardingDirector, ONBOARDING_LESSONS } from '../../src/systems/OnboardingDirector.js';

const SCENARIOS = new Set(['blink', 'focus', 'kindle', 'debrief', 'debrief-crowd', 'debrief-projectile']);
const STATES = new Set(['instruction', 'success', 'deferred']);
const DT = 1 / 60;

function ensure(condition, message) {
    if (!condition) throw new Error(`First Light fixture: ${message}`);
}

function clearLane(game) {
    const p = game.player;
    for (let ring = 0; ring <= 12; ring += 1) {
        for (let direction = 0; direction < 8; direction += 1) {
            const angle = direction * Math.PI / 4;
            const x = p.x + Math.cos(angle) * ring * 120;
            const y = p.y + Math.sin(angle) * ring * 120;
            if (!game.obstacleSystem.isBlocked(x, y, p.radius + 24)
                && !game.obstacleSystem.isBlocked(x + BLINK.distance, y, p.radius + 24)
                && !game.obstacleSystem.segmentBlocked(x, y, x + BLINK.distance, y)) return { x, y };
        }
    }
    throw new Error('First Light fixture: no clear Blink lane near player');
}

function fixtureEnemy(type, x, y) {
    const enemy = new Enemy(type, x, y, { healthMul: 12, speedMul: 0 });
    enemy.spawnAge = 1;
    return enemy;
}

function useKindle(game) {
    // A ready meter is explicit fixture setup. Spending it, entering aim, and
    // releasing all travel through the same gate as a real held Q gesture.
    const keys = game.input.keyboard.keys;
    ensure(keys instanceof Set, 'keyboard input state is unavailable');
    game.kindleSystem.fill = game.kindleSystem.max;
    const fillBefore = game.kindleSystem.fill;
    const ultBefore = game.ultsReleased;
    keys.add('KeyQ');
    try {
        game._updateKindleAim(DT);
        ensure(!!game.kindleSystem.aiming, 'ready Kindle did not enter aim');
        ensure(game.kindleSystem.fill < fillBefore, 'Kindle aim did not spend the meter');
        keys.delete('KeyQ');
        const result = game._updateKindleAim(DT);
        ensure(!game.kindleSystem.aiming && game.ultsReleased === ultBefore + 1,
            'released Kindle did not commit exactly one cast');
        ensure(result && Array.isArray(result.hits) && Array.isArray(result.killed), 'Kindle returned no combat result');
        return { casts: game.ultsReleased - ultBefore, meterSpent: fillBefore - game.kindleSystem.fill };
    } finally {
        keys.delete('KeyQ');
    }
}

export function stageFirstLightScenario(game, params) {
    const scenario = params.get('firstlight');
    if (!scenario) return null;
    ensure(SCENARIOS.has(scenario), `unsupported firstlight=${scenario}`);
    const state = params.get('firstlightstate') || 'instruction';
    ensure(STATES.has(state), `unsupported firstlightstate=${state}`);
    ensure(game.player && game.screen === 'gameplay', 'fixture requires an active run');

    // These fields belong only to the isolated fixture run. No persistent
    // onboarding save flag is changed to manufacture a first-death receipt.
    game._replayRunDebrief = true;
    game.onboarding = new OnboardingDirector({ x: game.player.x, y: game.player.y });
    game.runObjectiveDirector = null;
    game.ruinBellDirector = null;
    game.paused = false;
    game.photoMode = false;
    game.gameOver = false;
    game.victory = null;
    game.upgradeChoices = null;
    game.chestReward = null;
    game.altar = null;
    game.pendingLevelUps = 0;
    game.pendingChests = 0;
    game.pendingAltars = 0;
    game.bossWarning = null;
    game.activeBossRef = null;
    game.activeLieutenantRef = null;
    game.arena = null;
    game._tutorialTarget = null;
    game.focusTarget = null;
    game.enemies = [];
    game.projectiles = [];
    game.enemyProjectiles = [];
    game.hazards = [];
    game.bossSummons = [];
    game._selfDetonated = [];
    game._hazardKilled = [];
    game.lastHitBy = null;
    game.input.touch?.reset?.();
    game.input.buttons?.reset?.();
    game.input.keyboard.keys.clear();
    game.kindleSystem.aiming = null;
    game.kindleSystem.blinkCooldown = 0;
    game.waveDirector.announcement = null;

    const lane = clearLane(game);
    game.player.x = lane.x;
    game.player.y = lane.y;
    game.player.facing = 'right';
    game.player.aimAngle = 0;
    game.camera.x = lane.x;
    game.camera.y = lane.y;

    const receipt = { scenario, requestedState: state, actionVerified: false, staged: true };
    game._firstLightFixture = receipt;

    if (scenario.startsWith('debrief')) {
        const crowd = scenario === 'debrief-crowd';
        const projectile = scenario === 'debrief-projectile';
        game.player.hp = 1;
        game.player.damageTakenMul = 1; // undo the artshot swarm's invulnerability
        game.player.invincibleTimer = 0;
        game.player.thornsReflect = 0;
        game.player.killHeal = 0;
        game.player.ks_aegis = false;
        if (projectile) {
            const source = fixtureEnemy('spitter', lane.x + 180, lane.y - 40);
            game.enemies.push(source);
            game.enemyProjectiles.push(new EnemyProjectile(lane.x + 4, lane.y, -1, 0, 20,
                { sourceLabel: { label: source.def.label, boss: false } }));
            game._updateProjectiles(DT);
        } else {
            const count = crowd ? 4 : 1;
            for (let i = 0; i < count; i += 1) {
                const angle = i * Math.PI / 2;
                game.enemies.push(fixtureEnemy(i === 0 ? 'slime' : 'crawler',
                    lane.x + Math.cos(angle) * 12, lane.y + Math.sin(angle) * 12));
            }
            game._resolveCombat(DT, { hits: [], killed: [] }, { killed: [] });
        }
        ensure(game.player.hp <= 0 && game.lastHitBy?.lethal === true && game.lastHitBy?.fresh === true,
            'real damage did not produce fresh lethal attribution');
        ensure(game.lastHitBy.kind === (projectile ? 'projectile' : 'contact'), 'damage used the wrong production path');
        if (crowd) ensure(game.lastHitBy.contactCount > 1, 'crowd fixture did not create multiple damaging overlaps');
        game._enterGameOver();
        game.update(2);
        ensure(game.runDebrief?.firstDeath === true, 'first-death debrief was not built by Game');
        const hint = projectile ? 'projectile' : crowd ? 'crowd' : 'contact';
        ensure(game.runDebrief.hint.id === hint, 'debrief selected the wrong advice for the actual lethal hit');
        Object.assign(receipt, { actionVerified: true, expectedHint: hint, expectedCauseKind: game.lastHitBy.kind,
            contactCount: game.lastHitBy.contactCount || 0, acceptedCoins: game.runSummary.coinsEarned,
            acceptedPassXp: game.bpResult?.gained || 0 });
        return receipt;
    }

    game.onboarding.step = ONBOARDING_LESSONS.findIndex((entry) => entry.id === scenario);
    ensure(game.onboarding.step >= 0, 'lesson was not found');
    game.enemies.push(fixtureEnemy('slime', lane.x + 240, lane.y + 70));
    game.enemies.push(fixtureEnemy('crawler', lane.x - 290, lane.y - 130));
    if (scenario === 'kindle') game.kindleSystem.fill = game.kindleSystem.max;
    if (state === 'success') {
        if (scenario === 'blink') {
            const before = { x: game.player.x, y: game.player.y, blinks: game.blinks };
            game._tryBlink();
            const travel = Math.hypot(game.player.x - before.x, game.player.y - before.y);
            ensure(travel > 0 && game.blinks === before.blinks + 1 && game.kindleSystem.blinkCooldown > 0,
                'Blink did not move the player and start its cooldown');
            receipt.distance = travel;
        } else if (scenario === 'focus') {
            game._cycleFocusTarget();
            ensure(game.focusTarget?.active && game.onboarding.counts.focusLocks === 1,
                'Focus did not lock a live target through the input action');
            receipt.targetType = game.focusTarget.type;
        } else Object.assign(receipt, useKindle(game));
        game._tickOnboarding(2.5);
        ensure(game.onboarding?.outcome === 'success' && game.onboarding?.done,
            'the committed action did not produce a lesson success receipt');
        receipt.actionVerified = true;
    } else if (state === 'deferred') {
        // Deliberately no action: exercise the neutral timeout, not a forged
        // success receipt. All success counters for this fresh lesson are zero.
        game.onboarding.update(game.onboarding.lesson.timeout);
        ensure(game.onboarding.outcome === 'deferred' && !game.onboarding.done,
            'timeout did not remain an honest neutral fallback');
    }
    game._tutorialTarget = game.onboarding.outcome ? null : game._onboardingTarget();
    game._updateJoystickEnabled();
    return receipt;
}

function insideSafeArea(rect, renderer) {
    const sa = renderer.safeArea;
    return rect && rect.x >= sa.left - 0.5 && rect.y >= sa.top - 0.5
        && rect.x + rect.w <= INTERNAL_WIDTH - sa.right + 0.5
        && rect.y + rect.h <= INTERNAL_HEIGHT - sa.bottom + 0.5;
}

export function verifyFirstLightScenario(game, params) {
    if (!params.get('firstlight')) return null;
    const receipt = game._firstLightFixture;
    ensure(receipt?.staged, 'stageFirstLightScenario was not called');
    const rendered = receipt.scenario.startsWith('debrief')
        ? game.ui?._lastDrawReceipt?.debrief : game.ui?._lastDrawReceipt?.onboarding;
    ensure(rendered, 'production UI did not draw the requested surface');
    ensure(rendered.textComplete === true, 'production text was clipped');
    ensure(insideSafeArea(rendered.rect, game.renderer), 'surface crosses the safe viewport boundary');
    if (receipt.scenario.startsWith('debrief')) {
        ensure(rendered.ready === true && game._gameOverInputReady(), 'debrief action is not ready');
        ensure(rendered.hint === receipt.expectedHint, 'drawn advice differs from the lethal event');
        ensure(rendered.coins === receipt.acceptedCoins && rendered.passXp === receipt.acceptedPassXp,
            'drawn reward amounts differ from accepted terminal receipts');
        ensure(insideSafeArea(rendered.button, game.renderer), 'debrief button crosses the viewport boundary');
        const physicalScale = (game.renderer.cssWidth || INTERNAL_WIDTH) / INTERNAL_WIDTH;
        ensure(rendered.button.w * physicalScale >= 44 && rendered.button.h * physicalScale >= 44,
            'debrief action is smaller than a 44 CSS pixel touch target');
    } else {
        ensure(rendered.id === receipt.scenario, 'wrong lesson was rendered');
        const expected = receipt.requestedState === 'success' ? 'success'
            : receipt.requestedState === 'deferred' ? 'deferred' : null;
        ensure(rendered.outcome === expected, 'rendered lesson outcome differs from requested state');
        ensure(receipt.requestedState !== 'success' || receipt.actionVerified, 'success has no action proof');
        ensure(rendered.fontCssPx >= 14, 'lesson body is too small at physical scale');
    }
    const result = { ...receipt, rendered: true, textComplete: true, safeArea: true,
        rect: rendered.rect, outcome: rendered.outcome || null,
        cause: rendered.cause || null, hint: rendered.hint || null,
        cssWidth: game.renderer.cssWidth, cssHeight: game.renderer.cssHeight };
    if (typeof window !== 'undefined') window.__firstLightReceipt = result;
    return result;
}
