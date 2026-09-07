// Dedicated tools page only. Nothing here is reachable from the production entry.
import { runFixture } from './migration-fixture.mjs';
import { getScenario } from './scenarios.mjs';
import { createMemoryStorage } from './migration-storage.mjs';

const errors = [];
window.addEventListener('error', (event) => errors.push(String(event.message || event.error)));
window.addEventListener('unhandledrejection', (event) => errors.push(`promise: ${String(event.reason)}`));

async function boot() {
    if (!location.pathname.endsWith('/tools/artshot/migration-baseline.html')) throw new Error('Test page required');
    if (innerHeight > innerWidth) throw new Error('Migration PR1 captures support landscape only; use the existing harness for portrait rotation');
    const params = new URLSearchParams(location.search);
    const scenario = getScenario(params.get('scenario') || 'normal-desktop');
    const seed = params.has('seed') ? Number(params.get('seed')) : scenario.seed;
    // Fix import-time configuration, never modify the user's persisted settings.
    params.set('skipOnboarding', '1');
    params.delete('dev');
    history.replaceState(null, '', `${location.pathname}?${params}`);
    // Leave native storage/locks/audio globals intact, including their getters.
    const storage = createMemoryStorage();
    const { Renderer } = await import('../../src/systems/Renderer.js');
    const renderer = new Renderer(document.getElementById('game'));
    let receipt;
    try { receipt = await runFixture({
        id: scenario.id, seed, renderer, errors, storage,
        environment: { kind: 'browser-assets', storage: 'memory-only', audio: 'disabled',
            locks: 'disabled', viewport: [innerWidth, innerHeight], renderSchedule: 'final-only' },
        prepareAssets: async () => {
            // Fixed loader order; each completes before the next may build caches.
            for (const [module, loader] of [
                ['LpcSprites', 'loadLpcSprites'], ['WorldTextures', 'loadWorldTextures'],
                ['CustomIcons', 'loadIconGlyphs'], ['MonsterSprites', 'loadMonsterSprites'],
                ['EnemySprites', 'loadEnemyAiSprites'], ['HeroAiSprites', 'loadHeroAiSprites'],
                ['ObstacleSprites', 'loadObstacleSprites'], ['DecorSprites', 'loadDecorSprites'],
                ['RenderedWeaponProps', 'loadRenderedProps'],
            ]) await (await import(`../../src/assets/${module}.js`))[loader]();
        },
    }); } finally { renderer.dispose(); }
    receipt.environment.storageWrites = storage.writes;
    const output = document.createElement('script');
    output.id = 'migration-receipt';
    output.type = 'application/json';
    output.textContent = JSON.stringify(receipt);
    document.body.appendChild(output);
    // Expose only the detached JSON receipt, never Game or SaveSystem.
    window.__migrationReceipt = JSON.parse(output.textContent);
    document.title = `MIGRATION ${scenario.id} TICKS:${receipt.simulationTicks} EXC:${errors.length}`;
    document.documentElement.dataset.qaReady = '1';
}
boot().catch((error) => {
    document.title = `BOOTFAIL ${String(error.stack || error)}`;
    document.body.dataset.error = String(error.stack || error);
    document.documentElement.dataset.qaReady = '1';
});
