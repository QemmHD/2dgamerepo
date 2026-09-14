// TEST ONLY. Real Game / retained UI behavior on the PR1 non-rasterizing Node
// environment. Pixel transparency/stacking and trusted input belong to browser
// acceptance; this proves call ownership, modal routing and focus reconciliation.
// Run in a fresh Node process, like the PR1 fixtures: restoring globals cannot
// unload the game's procedural asset caches or imported environment decisions.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { installNodeEnvironment } from './migration-node-environment.mjs';

export async function verifyPhaserOverlayContract() {
    const environment = installNodeEnvironment();
    const owned = [];
    const own = (resource) => { owned.push(resource); return resource; };
    const checks = [];
    const check = (condition, label) => { assert.ok(condition, label); checks.push(label); };
    try {
        const [{ Game }, { Renderer }, { Input }, { KeyboardInput }, { TouchJoystick },
            { TouchButtons }, { SaveSystem }, { AudioSystem }, { MemoryStorage }] = await Promise.all([
            import('../../src/core/Game.js'), import('../../src/systems/Renderer.js'),
            import('../../src/core/Input.js'), import('../../src/core/KeyboardInput.js'),
            import('../../src/core/TouchJoystick.js'), import('../../src/core/TouchButtons.js'),
            import('../../src/systems/SaveSystem.js'), import('../../src/systems/AudioSystem.js'),
            import('../../src/platform/MemoryStorage.js'),
        ]);
        const { renderer } = environment;
        const operations = [];
        for (const method of ['clearRect', 'fillRect']) {
            const draw = renderer.ctx[method].bind(renderer.ctx);
            renderer.ctx[method] = (...args) => {
                operations.push({ method, args, fillStyle: renderer.ctx.fillStyle });
                return draw(...args);
            };
        }
        // Exercise the real Renderer clear policy against the fixture context,
        // without claiming this Node drawing stub produces pixel evidence.
        renderer.beginFrame = (options) => Renderer.prototype.beginFrame.call(renderer, options);
        renderer.beginOverlayFrame = () => Renderer.prototype.beginOverlayFrame.call(renderer);
        const keyboard = own(new KeyboardInput());
        const touch = own(new TouchJoystick(renderer));
        const buttons = own(new TouchButtons(renderer));
        const input = own(new Input({ keyboard, touch, buttons }));
        const storage = new MemoryStorage();
        const saveSystem = own(new SaveSystem({ storage, participation: 'isolated' }));
        const audio = own(new AudioSystem({ contextFactory: null }));
        const game = own(new Game({ renderer, input, loop: { fps: 60 }, services: { saveSystem, audio } }));
        game.haptics.navigator = null;
        game.haptics.setStrength('off');
        await saveSystem.whenSaveParticipationReady();
        let focusRefreshes = 0;
        const refresh = game._refreshMenuFocusAfterRender.bind(game);
        game._refreshMenuFocusAfterRender = () => { focusRefreshes++; return refresh(); };

        const draws = [];
        const observeDraw = (target, method, label = method) => {
            const draw = target[method].bind(target);
            target[method] = (...args) => { draws.push(label); return draw(...args); };
        };
        for (const method of ['_drawPauseOverlay', '_drawLevelUpOverlay', '_drawChestOverlay',
            '_drawAltarOverlay', '_drawGameOverOverlay', '_drawBossPlate', '_drawBossWarning',
            '_drawDebugPanel', 'drawPhotoToolbar']) observeDraw(game.ui, method);
        observeDraw(game.ui, 'draw', 'ui');
        observeDraw(game, '_drawVictory', 'victory');
        observeDraw(touch, 'draw', 'joystick');
        observeDraw(buttons, 'draw', 'buttons');
        observeDraw(game, '_drawPhotoGrid', 'photo-grid');

        const render = () => {
            operations.length = 0;
            draws.length = 0;
            const before = focusRefreshes;
            game.renderOverlay();
            check(focusRefreshes === before + 1, 'overlay reconciles menu focus once');
            check(operations[0]?.method === 'clearRect', 'overlay clears before UI draws');
        };
        input.setModality('keyboard');
        render();
        check(operations.some((entry) => entry.method === 'fillRect'
            && entry.fillStyle === '#0a0e16'), 'HOME retains opaque menu background');
        check(game.ui.menu.hotspots.length > 0, 'HOME creates real menu hotspots');
        const homeCount = game.ui.menu.hotspots.length;
        game.menuTab = 'play';
        render();
        check(game.ui.menu.hotspots.length > 0, 'PLAY creates real menu hotspots');
        const playCount = game.ui.menu.hotspots.length;
        let minesDraws = 0;
        const mines = game.minigame.mines;
        const drawMines = game.minigame.drawMines;
        game.minigame.mines = {};
        game.minigame.drawMines = () => { minesDraws++; };
        render();
        check(minesDraws === 1, 'menu Mines overlay remains above shared menu');
        game.minigame.mines = mines;
        game.minigame.drawMines = drawMines;

        game._startRun({ campaignEligible: true });
        let productionWorldDraws = 0;
        const background = game.mapRenderer.drawBackground.bind(game.mapRenderer);
        game.mapRenderer.drawBackground = (...args) => { productionWorldDraws++; return background(...args); };
        game.render();
        check(productionWorldDraws === 1, 'production render still draws complete legacy world');
        const forbidden = [];
        const forbid = (target, method) => {
            target[method] = () => { forbidden.push(method); throw new Error(`Overlay invoked world method ${method}`); };
        };
        for (const method of ['drawBackground', 'drawDecorations', 'drawWeather', 'drawVignette']) {
            forbid(game.mapRenderer, method);
        }
        for (const method of ['beginFrame', 'composite']) forbid(game.lighting, method);
        for (const method of ['drawWorldFog', 'drawScreenAdditive']) forbid(game.particles, method);
        forbid(game.camera, 'apply');
        forbid(game, '_mintPendingCard');
        forbid(game, '_drawPhotoFilter');
        forbid(game.vigilSiteSystem, 'drawAbove');
        game._pendingCardMint = { template: 'death', data: {} };
        render();
        check(draws.includes('ui'), 'gameplay uses retained UISystem');
        check(!operations.some((entry) => entry.method === 'fillRect' && entry.fillStyle === '#0a0e16'),
            'run transition removes opaque menu background');

        game.paused = true;
        game._updateJoystickEnabled();
        render();
        check(draws.includes('_drawPauseOverlay'), 'pause uses existing overlay');
        game.paused = false;
        game.pendingLevelUps = 1;
        game._presentLevelUp();
        render();
        check(draws.includes('_drawLevelUpOverlay'), 'level-up uses existing choices overlay');
        game.selectUpgrade(0);
        game.pendingChests = 1;
        game._presentChest();
        render();
        check(draws.includes('_drawChestOverlay'), 'chest uses existing reward overlay');
        game._dismissChestReward();
        game.pendingAltars = 1;
        game._presentAltar();
        render();
        check(draws.includes('_drawAltarOverlay'), 'Wick Shrine uses existing altar overlay');
        game.selectAltar(0);

        game.showDebug = true;
        game.activeBossRef = { name: 'Diagnostic contract boss', hp: 20, maxHp: 30, x: 0, y: 0 };
        game.bossWarning = { name: 'Diagnostic contract warning', timer: 1, total: 3 };
        render();
        check(draws.includes('_drawBossPlate') && draws.includes('_drawBossWarning'),
            'boss HP and warning route through existing UI');
        check(draws.includes('_drawDebugPanel'), 'developer HUD remains in overlay');
        game.activeBossRef = null;
        game.bossWarning = null;
        game.showDebug = false;
        touch.supported = buttons.supported = true;
        input.setModality('touch');
        game._updateJoystickEnabled();
        render();
        check(draws.includes('joystick') && draws.includes('buttons'), 'touch movement and actions draw above UI');

        game._enterPhotoMode();
        game.photoMode.gridOn = true;
        game.photoMode.hudShown = true;
        render();
        check(draws.includes('ui') && draws.includes('drawPhotoToolbar') && draws.includes('photo-grid'),
            'photo HUD grid and toolbar survive without legacy filter');
        check(!draws.includes('joystick') && !draws.includes('buttons'), 'photo mode keeps its touch-control exclusion');
        game._suppressToolbar = true;
        render();
        check(!draws.includes('drawPhotoToolbar') && !draws.includes('photo-grid'), 'toolbar suppression remains effective');
        game._exitPhotoMode();
        game.victory = { age: 2 };
        render();
        check(draws.includes('victory') && game._lastVictoryDrawReceipt === true, 'victory uses existing overlay');
        game.victory = null;
        game._enterGameOver();
        render();
        check(draws.includes('_drawGameOverOverlay'), 'death uses existing game-over overlay');
        check(forbidden.length === 0, 'no overlay state invoked legacy world or capture');
        await game.dispose();
        operations.length = 0;
        const beforeDisposedFocus = focusRefreshes;
        game.renderOverlay();
        check(operations.length === 0 && focusRefreshes === beforeDisposedFocus,
            'disposed Game cannot draw or rebuild hotspots');
        return { passed: true, environment: 'node-procedural-stubs-no-pixel-evidence',
            assertions: checks.length, checks, menuHotspots: { home: homeCount, play: playCount },
            worldCallsFromOverlay: forbidden.length };
    } finally {
        try {
            const results = await Promise.allSettled(owned.reverse().map(async (resource) => {
                if (await resource.dispose?.() === false) throw new Error('Overlay fixture cleanup failed');
            }));
            const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
            if (errors.length) throw new AggregateError(errors, 'Overlay fixture cleanup failed');
        } finally { environment.restore(); }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { console.log(JSON.stringify(await verifyPhaserOverlayContract())); }
    catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}
