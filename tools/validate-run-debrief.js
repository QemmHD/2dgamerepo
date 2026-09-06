#!/usr/bin/env node
// Truthful lethal attribution, one teaching hint, and accepted reward receipts.
import assert from 'node:assert/strict';
import { buildRunDebrief } from '../src/systems/RunDebrief.js';
import { SaveSystem, MAX_COIN_BALANCE } from '../src/systems/SaveSystem.js';
import { Game } from '../src/core/Game.js';

let checks = 0;
function check(condition, message) { checks++; assert.ok(condition, message); }
function same(actual, expected, message) { checks++; assert.deepEqual(actual, expected, message); }
const lethal = (kind, extra = {}) => ({ lethal: true, fresh: true, kind, ...extra });

const unknownInputs = [
    undefined, null, false, 7, 'contact', [], {},
    { kind: 'contact', label: 'Old attacker' },
    { lethal: false, fresh: true, kind: 'contact', label: 'Blocked hit' },
    { lethal: true, kind: 'projectile', label: 'Remembered shot' },
    { lethal: true, fresh: false, kind: 'hazard', label: 'Old fire' },
    { lethal: true, fresh: true, stale: true, kind: 'contact', label: 'Previous run' },
    { lethal: 1, fresh: true, kind: 'contact' },
    { lethal: true, fresh: 1, kind: 'contact' },
    lethal('unknown'), lethal(''), lethal('constructor'),
];
for (const cause of unknownInputs) {
    const result = buildRunDebrief({ cause });
    same(result.cause, { known: false, kind: null, text: 'Cause unavailable' }, 'Unproven cause was presented as known');
    same(result.hint.id, 'movement', 'Unproven cause selected a specific damage lesson');
}

for (const input of [undefined, null, false, 7, 'legacy']) {
    const result = buildRunDebrief(input);
    same(result.rewards.coins, 0, 'Missing input invented coins');
    same(result.rewards.passXp, 0, 'Missing input invented XP');
}

const contact = buildRunDebrief({ cause: lethal('contact', { label: 'Gravemaw', boss: true, contactCount: 1 }) });
same(contact.cause.text, 'Contact with Gravemaw', 'Boss contact lost the actual source');
same(contact.hint.id, 'contact', 'Boss flag replaced the actual damage-type hint');
const crowd = buildRunDebrief({ cause: lethal('contact', { label: 'Gloam Mite', contactCount: 8 }) });
same(crowd.cause.text, 'Crowd contact, including Gloam Mite', 'Mixed contact falsely blamed only one enemy');
same(crowd.hint.id, 'crowd', 'Crowd death did not teach open-space movement');
for (const count of [-1, 0, 1, NaN, Infinity, '8', 2.5]) {
    same(buildRunDebrief({ cause: lethal('contact', { contactCount: count }) }).hint.id,
        'contact', 'Invalid contact count invented a crowd');
}
same(buildRunDebrief({ cause: lethal('contact') }).cause.text, 'Contact with an enemy', 'Known contact needed an invented name');
same(buildRunDebrief({ cause: lethal('projectile', { label: 'Ash Spitter', hazard: true }) }).cause.text,
    'A projectile from Ash Spitter', 'Secondary source flags overrode the actual hit kind');
same(buildRunDebrief({ cause: lethal('projectile') }).cause.text, 'An enemy projectile', 'Unknown shooter reused a nonexistent identity');
same(buildRunDebrief({ cause: lethal('projectile') }).hint.id, 'projectile', 'Projectile hint missing');

for (const [hazardKind, expected] of Object.entries({
    delayedZone: 'detonation', beam: 'beam', lingering: 'pool', shockwave: 'shockwave',
    iceSlick: 'ice', brambles: 'hazard', gloom: 'hazard', quicksand: 'hazard',
    unknown: 'hazard', constructor: 'hazard', toString: 'hazard',
})) {
    const result = buildRunDebrief({ cause: lethal('hazard', { label: 'the marked ground', hazardKind }) });
    same(result.cause.text, 'Hit by the marked ground', 'Hazard label was invented or dropped');
    same(result.hint.id, expected, `Wrong ${hazardKind} lesson`);
}
same(buildRunDebrief({ cause: lethal('hazard') }).cause.text, 'An area hazard', 'Unnamed hazard invented a source');

const label = '\u202e  Fire\n\t Wraith\u0000  ';
same(buildRunDebrief({ cause: lethal('contact', { label }) }).cause.text,
    'Contact with Fire Wraith', 'Source control characters were not removed');
for (const badLabel of [false, 4, {}, [], null, undefined]) {
    same(buildRunDebrief({ cause: lethal('contact', { label: badLabel }) }).cause.text,
        'Contact with an enemy', 'Nontext source label leaked implementation text');
}
const long = buildRunDebrief({ cause: lethal('projectile', { label: '🦊'.repeat(200) }) });
check(Array.from(long.cause.text.replace('A projectile from ', '')).length <= 64, 'Source label is unbounded');
check(!/[\ud800-\udbff]$/.test(long.cause.text), 'Source clipping split a Unicode character');

const receipts = { base: 120, bonus: 24, objective: 60, achievements: 900, walletDelta: 9999 };
const result = buildRunDebrief({ firstDeath: true, cause: lethal('contact'), coinReceipts: receipts,
    bpResult: { gained: 130, attempted: 900, everflameCoins: 800 }, totalCoins: 12000 });
same(result.rewards.coins, 204, 'Run coins include another wallet source');
same(result.rewards.passXp, 130, 'Pass XP uses attempted rather than accepted XP');
same(result.rewards.coinLabel, 'Run coins banked', 'Coins are mislabeled as all terminal rewards');
check(result.rewards.coinDetail.includes('Run Path'), 'Included coin sources are not disclosed');
same(result.firstDeath, true, 'First-death presentation flag missing');
for (const firstDeath of [false, undefined, null, 1, 'true']) {
    same(buildRunDebrief({ firstDeath }).firstDeath, false, 'Invalid first-death flag armed teaching');
}
for (const invalid of [-1, -Infinity, Infinity, NaN, '20', null, undefined, {}, [], 1.2, Number.MAX_SAFE_INTEGER + 1]) {
    const invalidResult = buildRunDebrief({ coinReceipts: { base: invalid, bonus: invalid, objective: invalid },
        bpResult: { gained: invalid, attempted: 500 } });
    same(invalidResult.rewards.coins, 0, 'Invalid coin receipt became a reward');
    same(invalidResult.rewards.passXp, 0, 'Invalid XP receipt became a reward');
}
const failed = buildRunDebrief({ coinReceipts: { base: 0, bonus: 0, objective: 0 },
    bpResult: { gained: 0, attempted: 600, persisted: false } });
same(failed.rewards.passXp, 0, 'Failed persistence celebrated authored XP');
same(failed.rewards.coins, 0, 'Failed coin receipts celebrated an award');
const max = buildRunDebrief({ coinReceipts: { base: Number.MAX_SAFE_INTEGER, bonus: 10, objective: 20 } });
same(max.rewards.coins, Number.MAX_SAFE_INTEGER, 'Coin total overflowed safe integer range');

const cases = [contact, crowd, long, result, failed, max,
    buildRunDebrief(), buildRunDebrief({ cause: lethal('hazard', { hazardKind: 'beam' }) })];
for (const snapshot of cases) {
    check(snapshot.hint && typeof snapshot.hint.text === 'string' && snapshot.hint.text.length > 0,
        'Snapshot has no learning hint');
    check(!('hints' in snapshot) && !Array.isArray(snapshot.hint), 'Snapshot offers multiple learning hints');
    same(snapshot.action, { id: 'home', label: 'Continue to Home' }, 'Snapshot routes to multiple or inaccurate next actions');
    check(!('actions' in snapshot), 'Snapshot exposes competing actions');
    check(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.cause) && Object.isFrozen(snapshot.hint)
        && Object.isFrozen(snapshot.rewards) && Object.isFrozen(snapshot.action), 'Snapshot retains mutable nested presentation');
    check(snapshot.accessibilityText.includes(snapshot.cause.text)
        && snapshot.accessibilityText.includes(snapshot.hint.text)
        && snapshot.accessibilityText.includes(`${snapshot.rewards.coins} run coins banked`)
        && snapshot.accessibilityText.includes(`${snapshot.rewards.passXp} Pass XP banked`)
        && snapshot.accessibilityText.includes(snapshot.action.label), 'Accessible description omits debrief content');
}
const original = structuredClone(receipts);
buildRunDebrief({ coinReceipts: receipts });
same(receipts, original, 'Presentation changed supplied reward receipts');
same(buildRunDebrief({ coinReceipts: receipts }), buildRunDebrief({ coinReceipts: receipts }),
    'Presentation is not deterministic');

// Exercise the production save migration/acknowledgment and terminal methods.
// No game boot or DOM mock is necessary: methods run on a narrow game fixture.
const SAVE_KEY = 'monkey-survivor:save:v1';
class MemoryStorage {
    constructor(raw) {
        this.values = new Map(raw === undefined ? [] : [[SAVE_KEY, JSON.stringify(raw)]]);
        this.writes = 0;
        this.failWrites = false;
    }
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) {
        if (key === SAVE_KEY) {
            if (this.failWrites) throw new Error('Expected debrief persistence failure');
            this.writes++;
        }
        this.values.set(key, String(value));
    }
    removeItem(key) { this.values.delete(key); }
}
function withSave(raw, callback) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const storage = new MemoryStorage(raw);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    try { callback(new SaveSystem(), storage); }
    finally {
        if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
        else delete globalThis.localStorage;
    }
}
function expectedSaveFailure(callback) {
    const warn = console.warn;
    console.warn = () => {};
    try { return callback(); } finally { console.warn = warn; }
}

withSave(undefined, (save, storage) => {
    same(save.data.onboarding.firstDeathSeen, false, 'A new save starts with debrief acknowledged');
    same(save.markFirstDeathSeen(), true, 'Acknowledgment failed with available persistence');
    same(save.data.onboarding.firstDeathSeen, true, 'Acknowledgment did not update accepted state');
    same(new SaveSystem().data.onboarding.firstDeathSeen, true, 'Acknowledgment did not survive reload');
    const writes = storage.writes;
    same(save.markFirstDeathSeen(), true, 'Already-acknowledged marker is not idempotent');
    same(storage.writes, writes, 'Repeated acknowledgment rewrote the save');
});
for (const onboarding of [undefined, { tabsSeen: [] }, { firstDeathSeen: 'true' }]) {
    withSave({ stats: { runs: 4 }, onboarding }, (save) => {
        same(save.data.onboarding.firstDeathSeen, true, 'Veteran migration forced a new first-death teaching');
    });
    withSave({ stats: { runs: 0 }, onboarding }, (save) => {
        same(save.data.onboarding.firstDeathSeen, false, 'Fresh legacy save lost its first-death teaching');
    });
}
withSave({ stats: { runs: 1 }, onboarding: { firstDeathSeen: false } }, (save) => {
    same(save.data.onboarding.firstDeathSeen, false, 'Reload before acknowledgment discarded explicit false');
    save.recordRun({ time: 35, coinsEarned: 0 });
    same(new SaveSystem().data.onboarding.firstDeathSeen, false, 'Recording another run implicitly acknowledged debrief');
});
withSave(undefined, (save, storage) => {
    const before = structuredClone(save.data);
    storage.failWrites = true;
    same(expectedSaveFailure(() => save.markFirstDeathSeen()), false, 'Failed save reported acknowledged');
    same(save.data, before, 'Failed marker write leaked into memory');
    same(storage.getItem(SAVE_KEY), null, 'Failed marker write changed durable data');
    storage.failWrites = false;
    same(save.markFirstDeathSeen(), true, 'Failed acknowledgment could not be retried');
});
withSave(undefined, (save, storage) => {
    const external = { ...structuredClone(save.data), totalCoins: 777 };
    storage.setItem(SAVE_KEY, JSON.stringify(external));
    same(save.markFirstDeathSeen(), false, 'Stale tab overwrote a newer save to acknowledge debrief');
    same(save.data.onboarding.firstDeathSeen, false, 'Stale acknowledgment leaked accepted flag');
    same(JSON.parse(storage.getItem(SAVE_KEY)).totalCoins, 777, 'Stale acknowledgment replaced the newer wallet');
});

function makeTerminalGame(save, overrides = {}) {
    const game = Object.assign(Object.create(Game.prototype), {
        saveSystem: save,
        screen: 'gameplay', gameOver: false, gameOverAge: 0, victory: null,
        player: { hp: 0, level: 2, coins: 100, coinMul: 1 },
        time: 40, kills: 12, bossesDefeated: 0,
        runBonus: { coin: 0.2, xp: 0 }, bankedThisRun: false,
        _runBaseCoinsCredited: 0, _runRecorded: false, _battlePassAwarded: false,
        _objDone: new Set(), lastHitBy: lethal('contact', { label: 'Gloam Mite' }),
        audio: { gameOver() {}, stopMusic() {} },
        weaponSystem: { snapshotForUI: () => [], owned: [] },
        passiveSystem: { snapshotForUI: () => [] },
        _checkObjectives() {},
        _settleGuidedObjectiveRewards() { return { credited: save.addCoins(30), accepted: [] }; },
        _bankDailyRoad() {}, _accrueRiteProgress() {}, _bankRiteTrial() {}, _bankBossRush() {},
        _checkAchievements() {}, _checkDailyChallenges() {}, _queueDeathCard() {},
        _updateJoystickEnabled() {},
    }, overrides);
    return game;
}

withSave(undefined, (save, storage) => {
    const game = makeTerminalGame(save, { _checkAchievements() { save.addCoins(77); } });
    game._enterGameOver();
    same(game.runSummary.coinReceipts, { base: 100, bonus: 20, objective: 30 }, 'Terminal did not preserve accepted coin source receipts');
    same(game.runDebrief.rewards.coins, 150, 'Terminal debrief counted an unrelated achievement award');
    same(game.runSummary.totalCoins, 2227, 'Terminal wallet snapshot omitted a later accepted award');
    same(game.runDebrief.rewards.passXp, save.getBattlePassXp(), 'Terminal debrief did not use durable Pass gain');
    check(game.runDebrief.rewards.passXp > 0, 'Eligible first run earned no Pass XP');
    same(game.runDebrief.firstDeath, true, 'First-death eligibility was checked after recordRun migration');
    same(save.data.onboarding.firstDeathSeen, false, 'Entering death consumed the unacknowledged lesson');
    const before = structuredClone(save.data);
    const writes = storage.writes;
    game._enterGameOver();
    same(save.data, before, 'Repeated death callback awarded or recorded the run twice');
    same(storage.writes, writes, 'Repeated death callback performed new settlement writes');
});

withSave(undefined, (save, storage) => {
    const game = makeTerminalGame(save);
    storage.failWrites = true;
    expectedSaveFailure(() => game._enterGameOver());
    same(game.runSummary.coinReceipts, { base: 0, bonus: 0, objective: 0 }, 'Failed terminal settlement exposed authored coins');
    same(game.runDebrief.rewards.coins, 0, 'Failed terminal settlement celebrated run coins');
    same(game.runDebrief.rewards.passXp, 0, 'Failed terminal settlement celebrated Pass XP');
    same(save.data.totalCoins, 2000, 'Failed terminal settlement changed the accepted wallet');
});
withSave({ totalCoins: MAX_COIN_BALANCE - 7 }, (save) => {
    const game = makeTerminalGame(save);
    game._enterGameOver();
    same(game.runSummary.coinReceipts, { base: 7, bonus: 0, objective: 0 }, 'Wallet cap did not clamp coin receipts');
    same(game.runDebrief.rewards.coins, 7, 'Clamped debrief presented more coins than accepted');
});
withSave(undefined, (save) => {
    const game = makeTerminalGame(save, { time: 2, kills: 0 });
    game._enterGameOver();
    same(game.runDebrief.rewards.passXp, 0, 'Very short ineligible run received a synthetic Pass award');
});
withSave({ stats: { runs: 10 } }, (save) => {
    const veteran = makeTerminalGame(save);
    veteran._enterGameOver();
    same(veteran.runDebrief.firstDeath, false, 'Veteran death forced first-death teaching');
    const replay = makeTerminalGame(save, { _replayRunDebrief: true });
    replay._enterGameOver();
    same(replay.runDebrief.firstDeath, true, 'Explicit tutorial replay omitted the death lesson');
});
withSave(undefined, (save) => {
    const game = makeTerminalGame(save, { player: { hp: 1, level: 2, coins: 0, coinMul: 1 } });
    game._enterGameOver();
    same(game.runDebrief.cause.known, false, 'Living-player synthetic terminal reused a remembered lethal source');
});

// _bankRunCoins keeps its authored-return contract for the existing bonus
// formula while publishing accepted credit separately for presentation.
withSave({ totalCoins: MAX_COIN_BALANCE - 5 }, (save) => {
    const game = makeTerminalGame(save);
    same(game._bankRunCoins(), 100, 'Base receipt capture altered the authored bonus input');
    same(game._runBaseCoinsCredited, 5, 'Base receipt did not report the accepted clamped credit');
    same(game._bankRunCoins(), 0, 'Base coins banked twice');
    same(game._runBaseCoinsCredited, 5, 'Idempotent bank call erased the accepted receipt');
});
withSave(undefined, (save) => {
    const game = makeTerminalGame(save, { time: 3, startingCoinsGranted: 80 });
    same(game._bankRunCoins(), 20, 'Nonterminal early exit banked starting-coin seed');
    same(game._runBaseCoinsCredited, 20, 'Early-exit receipt includes unearned seed coins');
});

for (const age of [0, 0.7, 1.3, 1.599, NaN]) {
    same(Game.prototype._gameOverInputReady.call({ screen: 'gameOver', gameOverAge: age }), false,
        'Death action became ready before its presentation beat');
}
same(Game.prototype._gameOverInputReady.call({ screen: 'gameOver', gameOverAge: 1.6 }), true, 'Visible death action never becomes ready');
same(Game.prototype._gameOverInputReady.call({ screen: 'start', gameOverAge: 10 }), false, 'Death readiness leaked into menu');
withSave(undefined, (save) => {
    let homeCalls = 0;
    const game = makeTerminalGame(save, {
        screen: 'gameOver', gameOverAge: 1.59, runDebrief: buildRunDebrief({ firstDeath: true }),
        returnToShop() { homeCalls++; this.screen = 'start'; },
    });
    same(game._acknowledgeRunDebrief(), false, 'Early input skipped the first debrief');
    same(homeCalls, 0, 'Early input navigated Home');
    same(save.data.onboarding.firstDeathSeen, false, 'Early input persisted acknowledgment');
    game.gameOverAge = 1.6;
    same(game._acknowledgeRunDebrief(), true, 'Ready acknowledgment did not navigate');
    same(homeCalls, 1, 'Ready acknowledgment routed more than once');
    same(new SaveSystem().data.onboarding.firstDeathSeen, true, 'Ready acknowledgment was not durable');
    same(game._acknowledgeRunDebrief(), false, 'Repeated acknowledgment re-routed after leaving death');
    same(homeCalls, 1, 'Repeated acknowledgment navigated again');
});
withSave(undefined, (save, storage) => {
    const game = makeTerminalGame(save, {
        screen: 'gameOver', gameOverAge: 2, runDebrief: buildRunDebrief({ firstDeath: true }),
        returnToShop() { this.screen = 'start'; },
    });
    storage.failWrites = true;
    expectedSaveFailure(() => game._acknowledgeRunDebrief());
    same(save.data.onboarding.firstDeathSeen, false, 'Failed acknowledgment navigation marked teaching seen');
    same(new SaveSystem().data.onboarding.firstDeathSeen, false, 'Failed acknowledgment was not retryable after reload');
});

console.log(`Run debrief: ${checks} checks passed`);
