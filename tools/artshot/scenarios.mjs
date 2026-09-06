// Content/action data only. Tick zero precedes the first update. Equal-tick
// actions retain list order; offsetMs represents input between simulation ticks.
const common = {
    hero: 'monkey', heroName: 'Pyra', map: 'emberwood', difficulty: 'normal',
    loadout: 'default', seed: 207001, viewport: [1280, 720],
    onboarding: 'skip via test-page query', renderSchedule: 'once after all ticks',
};
const definitions = [
    { ...common, id: 'normal-desktop', ticks: 600, actions: [{ tick: 0, action: 'move', x: 1, y: 0 }] },
    { ...common, id: 'combat-pack', ticks: 360, enemies: [
        { type: 'slime', dx: 120, dy: 0 }, { type: 'bat', dx: 150, dy: 45 },
        { type: 'brute', dx: -180, dy: 30 }, { type: 'crawler', dx: 80, dy: -120 },
    ], actions: [] },
    { ...common, id: 'boss-entry', ticks: 10320, invulnerable: true, resolveChoices: 'first',
        actions: [{ tick: 0, action: 'move', x: 1, y: 0 }],
        limitations: ['Test-only damageTakenMul=0 to survive the authoritative 160-second boss route.',
            'Any upgrade/chest/altar modal is resolved with its first legal choice; no game-time assignment.'] },
    { ...common, id: 'touch-actions', ticks: 360, viewport: [844, 390], touch: true,
        kindleReady: true, actions: [
            { tick: 0, action: 'move', x: 1, y: 0 },
            { tick: 20, offsetMs: 2, action: 'blink' },
            { tick: 60, offsetMs: 2, action: 'kindlePress' },
            { tick: 60, offsetMs: 8, action: 'kindleRelease' },
            { tick: 120, action: 'move', x: 0, y: 1 },
            { tick: 180, action: 'kindlePress' },
            { tick: 210, action: 'kindleRelease' },
            { tick: 240, action: 'move', x: 0, y: 0 },
        ], limitations: ['Initial Kindle fill is set to the real ult cost to exercise quick-tap release.',
            'Handler adapter covers current Input semantics, not trusted OS touch dispatch or device latency.'] },
];
function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}
export const SCENARIOS = freeze(definitions);
export function getScenario(id) {
    const scenario = SCENARIOS.find((item) => item.id === id);
    if (!scenario) throw new Error(`Unknown migration fixture: ${id}`);
    return scenario;
}
