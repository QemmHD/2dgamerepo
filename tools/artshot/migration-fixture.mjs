import { TestClock, installDeterministicGlobals } from './migration-clock.mjs';
import { getScenario } from './scenarios.mjs';
import { buildSemanticReceipt } from './migration-receipt.mjs';
import { createMemoryStorage } from './migration-storage.mjs';

// Canvas-specific adapter; scenarios and receipts contain no renderer objects.
// Call once per fresh process/page. Persistence/audio use explicit services,
// independent of the host's native storage, locks and AudioContext globals.
export async function runFixture({ id, seed, renderer, environment, errors = [], prepareAssets,
    storage = createMemoryStorage() }) {
    const scenario = getScenario(id);
    seed ??= scenario.seed;
    const clock = new TestClock(scenario.actions);
    const rng = installDeterministicGlobals(seed, clock);
    let game;
    let primaryError;
    const owned = [];
    const own = (value) => { owned.push(value); return value; };
    try {
        const [{ Game }, { Input }, { KeyboardInput }, { TouchJoystick }, { TouchButtons }, { Enemy }] = await Promise.all([
            import('../../src/core/Game.js'), import('../../src/core/Input.js'),
            import('../../src/core/KeyboardInput.js'), import('../../src/core/TouchJoystick.js'),
            import('../../src/core/TouchButtons.js'), import('../../src/entities/Enemy.js'),
        ]);
        if (prepareAssets) await prepareAssets();
        const keyboard = own(new KeyboardInput());
        const touch = own(new TouchJoystick(renderer));
        const buttons = own(new TouchButtons(renderer));
        touch.supported = buttons.supported = !!scenario.touch;
        const input = own(new Input({ keyboard, touch, buttons }));
        input.setModality(scenario.touch ? 'touch' : 'keyboard');
        // No GameLoop.start or RAF. The real Game.update owns all mechanics.
        const [{ SaveSystem }, { AudioSystem }] = await Promise.all([
            import('../../src/systems/SaveSystem.js'), import('../../src/systems/AudioSystem.js'),
        ]);
        const saveSystem = own(new SaveSystem({ storage, participation: 'isolated' }));
        const audio = own(new AudioSystem({ contextFactory: null }));
        game = own(new Game({ renderer, input, loop: { fps: 60 }, services: { saveSystem, audio } }));
        await game.saveSystem.whenSaveParticipationReady();
        game._startRun({ campaignEligible: true });
        if (game._heroId !== scenario.hero || game._effectiveMapId() !== scenario.map
            || game.difficulty !== scenario.difficulty) throw new Error('Fresh profile is not the specified default loadout');
        if (scenario.invulnerable) game.player.damageTakenMul = 0;
        if (scenario.kindleReady) game.kindleSystem.fill = game.kindleSystem.ultCost;
        const pack = (scenario.enemies ?? []).map((entry) =>
            new Enemy(entry.type, game.player.x + entry.dx, game.player.y + entry.dy));
        game.enemies.push(...pack);
        const initialHp = pack.map((enemy) => enemy.hp);
        const observations = {
            startPosition: { x: game.player.x, y: game.player.y },
            actions: [], maxPlayerProjectiles: 0, controlledPackDamaged: 0,
            bossWarningTick: null, firstBossWarningId: null, bossSpawnTick: null, firstBossId: null,
            firstBossProvenance: null, modalChoices: 0,
        };
        // Invert the production coordinate mapping using three sampled points.
        // This also supports the rotated portrait mapping without a second formula.
        function eventAt(x, y, identifier) {
            const origin = renderer.clientToInternal(0, 0);
            const ex = renderer.clientToInternal(1, 0);
            const ey = renderer.clientToInternal(0, 1);
            const a = ex.x - origin.x, b = ey.x - origin.x;
            const c = ex.y - origin.y, d = ey.y - origin.y;
            const det = a * d - b * c;
            if (!Number.isFinite(det) || det === 0) throw new Error('Invalid input coordinate mapping');
            return { preventDefault() {}, changedTouches: [{ identifier,
                clientX: ((x - origin.x) * d - b * (y - origin.y)) / det,
                clientY: (a * (y - origin.y) - (x - origin.x) * c) / det }] };
        }
        function apply(action) {
            const { action: name, x, y } = action;
            observations.actions.push({ ...action });
            if (name === 'move') {
                if (scenario.touch) {
                    if (!x && !y) touch._handleEnd(eventAt(350, 750, 1));
                    else {
                        if (!touch.active) touch._handleStart(eventAt(350, 750, 1));
                        touch._handleMove(eventAt(touch.origin.x + x * touch.maxRadius,
                            touch.origin.y + y * touch.maxRadius, 1));
                    }
                } else {
                    keyboard.keys.clear();
                    if (x > 0) keyboard.keys.add('KeyD');
                    if (x < 0) keyboard.keys.add('KeyA');
                    if (y > 0) keyboard.keys.add('KeyS');
                    if (y < 0) keyboard.keys.add('KeyW');
                }
            } else {
                const layout = buttons.layout();
                if (name === 'blink') {
                    buttons._handleStart(eventAt(layout.blink.x, layout.blink.y, 2));
                    buttons._handleEnd(eventAt(layout.blink.x, layout.blink.y, 2));
                } else if (name === 'kindlePress') {
                    buttons._handleStart(eventAt(layout.kindle.x, layout.kindle.y, 3));
                } else if (name === 'kindleRelease') {
                    buttons._handleEnd(eventAt(layout.kindle.x, layout.kindle.y, 3));
                } else throw new Error(`Unsupported fixture action: ${name}`);
            }
        }
        clock.advance(scenario.ticks, (dt) => {
            game.update(dt);
            observations.maxPlayerProjectiles = Math.max(observations.maxPlayerProjectiles, game.projectiles.length);
            if (game.bossWarning && observations.bossWarningTick === null) {
                observations.bossWarningTick = clock.ticks + 1;
                observations.firstBossWarningId = game.bossWarning.id;
            }
            const boss = game.enemies.find((enemy) => enemy.boss && enemy.active === true);
            if (boss && observations.bossSpawnTick === null) {
                observations.bossSpawnTick = clock.ticks + 1;
                observations.firstBossId = boss.type;
                observations.firstBossProvenance = boss.bossSpawnProvenance ?? null;
            }
            if (scenario.resolveChoices === 'first') {
                if (game.upgradeChoices) { game.selectUpgrade(0); observations.modalChoices++; }
                if (game.chestReward) { game._dismissChestReward(); observations.modalChoices++; }
                if (game.altar) { game.selectAltar(0); observations.modalChoices++; }
            }
        }, apply);
        observations.controlledPackDamaged = pack.filter((enemy, i) => enemy.hp < initialHp[i]).length;
        observations.rngCallsBeforeRender = rng.calls;
        observations.actionsConsumed = clock.timeline.cursor;
        observations.blinks = game.blinks;
        observations.ultsReleased = game.ultsReleased;
        clock.visualTimeMs = clock.nowMs;
        observations.renderOnly = clock.renderFrame(game, () => game.render());
        observations.rngCallsAfterRender = rng.calls;
        // Wait one native event-loop turn to include pending rejection reporting.
        await new Promise((resolve) => setTimeout(resolve, 0));
        return buildSemanticReceipt({ game, scenario, seed, clock, environment, errors, observations });
    } catch (error) {
        primaryError = error;
        if (error?.cleanup) {
            try { await error.cleanup; }
            catch (cleanupError) {
                primaryError = new AggregateError([error, cleanupError],
                    'Fixture construction cleanup failed', { cause: error });
            }
        }
        throw primaryError;
    } finally {
        try {
            // Join every owner even if one cleanup fails, before restoring time.
            const results = await Promise.allSettled(owned.reverse().map(async (value) => {
                if (await value.dispose?.() === false) throw new Error('Fixture service cleanup failed');
            }));
            const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
            if (primaryError && failures.length) {
                throw new AggregateError([primaryError, ...failures], 'Fixture and cleanup failed', { cause: primaryError });
            }
            if (failures.length === 1) throw failures[0];
            if (failures.length) throw new AggregateError(failures, 'Fixture cleanup failed');
        }
        finally { rng.restore(); }
    }
}
