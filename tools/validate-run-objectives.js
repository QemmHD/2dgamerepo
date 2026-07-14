#!/usr/bin/env node
// Adversarial gate for the deterministic Orientation -> Tactic -> Climax path.

import { readFileSync } from 'node:fs';

import {
    OBJECTIVE_COUNT,
    OBJECTIVES,
    RUN_OBJECTIVE_CANDIDATES,
    RUN_OBJECTIVE_PHASES,
} from '../src/content/objectives.js';
import {
    RunObjectiveDirector,
    RUN_OBJECTIVE_METRICS,
    runObjectiveAccessibilityText,
    runObjectiveCapabilities,
    runObjectiveReceiptId,
} from '../src/systems/RunObjectiveDirector.js';
import {
    GUIDED_OBJECTIVE_RECEIPT_LIMIT,
    GUIDED_OBJECTIVE_SCHEMA,
    MAX_COIN_BALANCE,
    SaveSystem,
} from '../src/systems/SaveSystem.js';
import { RUN_XP_RULES } from '../src/systems/BattlePassSystem.js';
import { objectiveDescription } from '../src/systems/AccessibilityBridge.js';

const SAVE_KEY = 'monkey-survivor:save:v1';
let checks = 0;
let failures = 0;

function check(condition, message) {
    checks++;
    if (!condition) {
        failures++;
        console.error(`  x ${message}`);
    }
}

function same(actual, expected, message) {
    check(JSON.stringify(actual) === JSON.stringify(expected), message);
}

class MemoryStorage {
    constructor(raw = null) {
        this.values = new Map();
        this.saveWrites = 0;
        if (raw != null) this.values.set(SAVE_KEY, String(raw));
    }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    setItem(key, value) {
        this.values.set(key, String(value));
        if (key === SAVE_KEY) this.saveWrites++;
    }
    removeItem(key) { this.values.delete(key); }
}

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
function useStorage(storage) {
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        writable: true,
        value: storage,
    });
}
function restoreStorage() {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
}

same(RUN_OBJECTIVE_PHASES.map((phase) => phase.id), ['orientation', 'tactic', 'climax'],
    'the path owns exactly Orientation, Tactic, and Climax in order');
check(OBJECTIVE_COUNT === 3, 'player-facing objective total is not exactly three');
const ids = new Set();
for (const task of OBJECTIVES) {
    check(!ids.has(task.id), `duplicate authored objective id ${task.id}`);
    ids.add(task.id);
    check(RUN_OBJECTIVE_METRICS.includes(task.metric), `${task.id} uses an unknown metric`);
    check(Number.isInteger(task.target) && task.target > 0, `${task.id} has an invalid target`);
    check(Number.isInteger(task.reward) && task.reward > 0, `${task.id} has an invalid reward`);
    check(typeof task.nextAction === 'string' && task.nextAction.length >= 12,
        `${task.id} has no concrete next action`);
}
for (const phase of RUN_OBJECTIVE_PHASES) {
    const candidates = RUN_OBJECTIVE_CANDIDATES[phase.id];
    check(candidates.some((task) => task.fallback && task.metric === 'timeSec'),
        `${phase.id} lacks its completable elapsed-time fallback`);
}
check(RUN_XP_RULES.objective === 35 && RUN_XP_RULES.objective * 3 === 105,
    'Battle Pass pacing does not explicitly reconcile the new three-phase maximum');

const modes = ['standard', 'daily', 'rite-trial', 'boss-rush', 'weekly', 'future-mode'];
const stagePicks = Object.fromEntries(RUN_OBJECTIVE_PHASES.map((phase) => [phase.id, new Set()]));
for (const modeId of modes) {
    for (let seed = 0; seed < 512; seed++) {
        const capabilities = runObjectiveCapabilities({ modeId });
        const initial = { kills: 0, timeSec: 0, level: 1, bosses: 0, sites: 0, siteKinds: 0, encounters: 0 };
        const a = new RunObjectiveDirector({
            runId: `go${seed.toString(36)}`,
            seed: `matrix:${seed}`,
            capabilities,
            metrics: initial,
        });
        const b = new RunObjectiveDirector({
            runId: `go${seed.toString(36)}`,
            seed: `matrix:${seed}`,
            capabilities,
            metrics: initial,
        });
        same(a.getSnapshot(), b.getSnapshot(), `${modeId}/${seed} selection is not deterministic`);
        let metrics = { ...initial };
        for (let stage = 0; stage < 3; stage++) {
            const snapshot = a.getSnapshot();
            check(!!snapshot, `${modeId}/${seed} has no task at phase ${stage}`);
            if (!snapshot) break;
            stagePicks[snapshot.phase].add(snapshot.id);
            check(snapshot.phaseIndex === stage && snapshot.phaseTotal === 3,
                `${modeId}/${seed} exposes incorrect phase numbering`);
            check(capabilities.metrics.includes(snapshot.metric),
                `${modeId}/${seed} selected unsupported metric ${snapshot.metric}`);
            if (modeId === 'boss-rush' || modeId === 'weekly') {
                check(!['kills', 'sites', 'siteKinds', 'encounters'].includes(snapshot.metric),
                    `${modeId}/${seed} selected a non-guaranteed gauntlet metric`);
            }
            if (modeId === 'future-mode') {
                check(snapshot.metric === 'timeSec' && snapshot.substitution === 'mode-safe-fallback',
                    `unknown mode ${seed} did not fail closed to a named fallback`);
            }
            const description = runObjectiveAccessibilityText(snapshot);
            check(description.length > 30 && description.length <= 240,
                `${modeId}/${seed} accessibility copy is empty or over 240 characters`);
            check(description === objectiveDescription(snapshot),
                `${modeId}/${seed} live and queryable accessibility copy drifted`);
            metrics[snapshot.metric] = snapshot.goalValue;
            const event = a.update(metrics, { rewardMultiplier: 1 });
            check(event?.completed?.id === snapshot.id,
                `${modeId}/${seed} failed exact completion at ${snapshot.goalValue}`);
            check(event?.completed?.current === snapshot.target,
                `${modeId}/${seed} completion progress does not reconcile`);
            if (stage < 2) {
                check(!!event.next && event.next.phaseIndex === stage + 1,
                    `${modeId}/${seed} did not advance one phase`);
                check(a.update(metrics) === null,
                    `${modeId}/${seed} cascaded the next phase from old progress`);
            } else {
                check(event.allComplete && a.getSnapshot() === null,
                    `${modeId}/${seed} did not close after Climax`);
            }
        }
        check(a.getSummary().completedPhases === 3,
            `${modeId}/${seed} summary does not report 3/3`);
    }
}

// Explicit zero is real capacity, not a request for the default. Empty future
// sequences/boards must always select an actually reachable metric.
for (let seed = 0; seed < 256; seed++) {
    for (const modeId of ['standard', 'boss-rush']) {
        const director = new RunObjectiveDirector({
            runId: `zero${seed}`,
            seed: `zero:${modeId}:${seed}`,
            capabilities: runObjectiveCapabilities({
                modeId,
                systems: { livingVigil: true, bosses: true },
                limits: { bosses: 0, sites: 0, siteKinds: 0 },
            }),
            metrics: {},
        });
        for (let stage = 0; stage < 3; stage++) {
            const snapshot = director.getSnapshot();
            check(!['bosses', 'sites', 'siteKinds'].includes(snapshot.metric),
                `${modeId}/${seed} selected zero-capacity ${snapshot.metric}`);
            director.update({ ...director.metrics, [snapshot.metric]: snapshot.goalValue });
        }
    }
}
for (const phase of RUN_OBJECTIVE_PHASES) {
    check(stagePicks[phase.id].size >= 3,
        `${phase.id} does not rotate across enough deterministic authored tasks`);
}

// Exhausted finite systems must be filtered before selection, never after the
// player is shown a task they can no longer complete.
for (let seed = 0; seed < 256; seed++) {
    const director = new RunObjectiveDirector({
        runId: `cap${seed}`,
        seed,
        capabilities: runObjectiveCapabilities({ modeId: 'standard' }),
        metrics: { level: 10, sites: 4, siteKinds: 4, bosses: 3 },
    });
    for (let stage = 0; stage < 3; stage++) {
        const snapshot = director.getSnapshot();
        check(!['sites', 'siteKinds', 'bosses'].includes(snapshot.metric),
            `finite-capacity seed ${seed} selected exhausted ${snapshot.metric}`);
        const nextMetrics = { ...director.metrics, [snapshot.metric]: snapshot.goalValue };
        director.update(nextMetrics);
    }
}

const capture = new RunObjectiveDirector({
    runId: 'capture',
    seed: 'reward-capture',
    capabilities: runObjectiveCapabilities({ modeId: 'standard' }),
    metrics: {},
});
const captureStart = capture.getSnapshot();
const captureEvent = capture.update(
    { [captureStart.metric]: captureStart.goalValue },
    { rewardMultiplier: 1.5 },
);
check(captureEvent.completed.reward.amount === Math.floor(
    OBJECTIVES.find((task) => task.id === captureStart.id).reward * 1.5,
), 'completion-time coin multiplier was not captured into the receipt');
check(captureEvent.completed.reward.receiptId
    === runObjectiveReceiptId('capture', 0, captureStart.id),
'receipt id does not bind run, phase, and objective');
check(captureEvent.completed.reward.status === 'held',
    'completed reward is mislabeled as banked before the run finishes');
const practice = new RunObjectiveDirector({
    runId: 'practice', seed: 'taint', modeId: 'standard', metrics: {}, rewardMultiplier: 1,
});
const beforeTaint = practice.getSnapshot();
const afterTaint = practice.setRewardMultiplier(0);
check(afterTaint.id === beforeTaint.id && afterTaint.current === beforeTaint.current
    && afterTaint.reward.amount === 0 && practice.getSummary().completedPhases === 0,
'mid-run practice taint changed progress or failed to zero the active reward immediately');

try {
    const storage = new MemoryStorage();
    useStorage(storage);
    const save = new SaveSystem();
    check(save.data.guidedObjectives.schema === GUIDED_OBJECTIVE_SCHEMA,
        'fresh save lacks guided-objective schema');
    const openingBalance = save.data.totalCoins;
    const forgedFuture = save.claimGuidedObjectiveRewards([{
        receiptId: runObjectiveReceiptId('gozz', 0, 'orient_first_blood'),
        multiplier: 100,
    }]);
    check(forgedFuture.credited === 0 && forgedFuture.accepted.length === 0
        && save.data.totalCoins === openingBalance && storage.saveWrites === 0,
    'an unreserved future run receipt minted coins');
    const runOne = save.beginGuidedObjectiveRun();
    check(runOne === 'go1' && storage.saveWrites === 1,
        'first run id was not reserved durably exactly once');
    const receipt = runObjectiveReceiptId(runOne, 0, 'orient_first_blood');
    const first = save.claimGuidedObjectiveRewards([{
        receiptId: receipt,
        multiplier: 2.5,
        amount: MAX_COIN_BALANCE,
    }]);
    check(first.credited === 37 && first.accepted.length === 1
        && save.data.guidedObjectives.activeRunSerial === 0
        && save.data.totalCoins === openingBalance + 37 && storage.saveWrites === 2,
    'first atomic objective settlement did not reconcile balance/write count');
    const writesAfterFirst = storage.saveWrites;
    const forgedSlot = runObjectiveReceiptId(runOne, 0, 'orient_kindling');
    const slotReplay = save.claimGuidedObjectiveRewards([{
        receiptId: forgedSlot,
        multiplier: 100,
    }]);
    check(slotReplay.credited === 0 && slotReplay.accepted.length === 0
        && slotReplay.duplicates[0] === forgedSlot
        && save.data.totalCoins === openingBalance + 37
        && storage.saveWrites === writesAfterFirst,
    'one run/phase slot accepted more than one authored objective receipt');
    const duplicate = save.claimGuidedObjectiveRewards([{ receiptId: receipt, multiplier: 100 }]);
    check(duplicate.credited === 0 && duplicate.accepted.length === 0
        && duplicate.duplicates[0] === receipt
        && save.data.totalCoins === openingBalance + 37
        && storage.saveWrites === writesAfterFirst,
    'replayed objective receipt credited or wrote twice');

    // Reloading the exact serialized save must preserve the dedupe boundary.
    const reloaded = new SaveSystem();
    const afterReload = reloaded.claimGuidedObjectiveRewards([{ receiptId: receipt, multiplier: 2.5 }]);
    check(afterReload.credited === 0 && reloaded.data.totalCoins === openingBalance + 37,
        'reload reopened an already-paid receipt');

    // A live serial is session authority, not a bearer token in localStorage.
    // Reconstructing the save retires the interrupted run; neither the new
    // instance nor the stale old instance may pay its otherwise-valid receipt.
    const interruptedStorage = new MemoryStorage();
    useStorage(interruptedStorage);
    const beforeReloadSave = new SaveSystem();
    const interruptedRun = beforeReloadSave.beginGuidedObjectiveRun();
    const interruptedReceipt = {
        receiptId: runObjectiveReceiptId(interruptedRun, 0, 'orient_first_blood'),
        multiplier: 1,
    };
    const afterReloadSave = new SaveSystem();
    const reloadedInterrupted = afterReloadSave.claimGuidedObjectiveRewards([interruptedReceipt]);
    const staleInstanceClaim = beforeReloadSave.claimGuidedObjectiveRewards([interruptedReceipt]);
    check(afterReloadSave.data.guidedObjectives.activeRunSerial === 0
        && reloadedInterrupted.credited === 0 && reloadedInterrupted.accepted.length === 0
        && staleInstanceClaim.credited === 0 && staleInstanceClaim.accepted.length === 0,
    'reload preserved payable authority for an interrupted Run Path');

    // A stale owner must not roll back the newer tab's counter or close its live
    // run. The latest persisted nested ledger is authoritative for close writes.
    const newerRun = afterReloadSave.beginGuidedObjectiveRun();
    const writesBeforeStaleClose = interruptedStorage.saveWrites;
    const staleClose = beforeReloadSave.closeGuidedObjectiveRun(interruptedRun);
    const persistedAfterStaleClose = JSON.parse(interruptedStorage.getItem(SAVE_KEY));
    check(staleClose === false && interruptedStorage.saveWrites === writesBeforeStaleClose
        && persistedAfterStaleClose.guidedObjectives.nextRunId === 3
        && persistedAfterStaleClose.guidedObjectives.activeRunSerial === 2,
    'a stale close rolled back or retired a newer live Run Path');
    const newerClaim = afterReloadSave.claimGuidedObjectiveRewards([{
        receiptId: runObjectiveReceiptId(newerRun, 0, 'orient_first_blood'),
        multiplier: 1,
    }]);
    check(newerClaim.credited === 15 && newerClaim.accepted.length === 1,
        'stale close invalidated the newer tab\'s otherwise-valid reward');

    // Restart/menu/empty/practice terminal paths share this idempotent close.
    // Once closed, even a fully authored receipt for that run pays zero.
    const closedRun = afterReloadSave.beginGuidedObjectiveRun();
    const writesBeforeClose = interruptedStorage.saveWrites;
    check(afterReloadSave.closeGuidedObjectiveRun(closedRun) === true
        && afterReloadSave.closeGuidedObjectiveRun(closedRun) === false
        && interruptedStorage.saveWrites === writesBeforeClose + 1,
    'guided run close was not durable and idempotent');
    const closedClaim = afterReloadSave.claimGuidedObjectiveRewards([{
        receiptId: runObjectiveReceiptId(closedRun, 0, 'orient_first_blood'),
        multiplier: 1,
    }]);
    check(closedClaim.credited === 0 && closedClaim.accepted.length === 0,
        'an explicitly forfeited/empty/practice run remained payable');
    const resetRun = afterReloadSave.beginGuidedObjectiveRun();
    afterReloadSave.reset();
    const resetClaim = afterReloadSave.claimGuidedObjectiveRewards([{
        receiptId: runObjectiveReceiptId(resetRun, 0, 'orient_first_blood'),
        multiplier: 1,
    }]);
    check(afterReloadSave.data.guidedObjectives.activeRunSerial === 0
        && afterReloadSave._guidedObjectiveSessionSerial === 0
        && resetClaim.credited === 0 && resetClaim.accepted.length === 0,
    'profile reset retained live Run Path authority');

    // Restore the main fixture for its abort/restart checks below.
    useStorage(storage);

    // Abort: reserve ids, complete nothing, and start again. No payout occurs.
    const beforeAbort = reloaded.data.totalCoins;
    const abortedRun = reloaded.beginGuidedObjectiveRun();
    const nextRun = reloaded.beginGuidedObjectiveRun();
    const abortedClaim = reloaded.claimGuidedObjectiveRewards([{
        receiptId: runObjectiveReceiptId(abortedRun, 0, 'orient_first_blood'),
        multiplier: 1,
    }]);
    check(abortedRun !== nextRun && abortedClaim.credited === 0
        && abortedClaim.accepted.length === 0 && reloaded.data.totalCoins === beforeAbort,
        'abort/restart reused an id or minted an unfinalized reward');

    const known = 'orient_first_light';
    const noisyReceipts = [];
    for (let i = 0; i < GUIDED_OBJECTIVE_RECEIPT_LIMIT + 20; i++) {
        noisyReceipts.push(`go${(i + 1).toString(36)}:0:${known}`);
    }
    const tamperedStorage = new MemoryStorage(JSON.stringify({
        version: 10,
        guidedObjectives: {
            schema: 999,
            nextRunId: -8,
            receipts: [
                'bad',
                `go1:0:not_real`,
                `go1:1:${known}`,
                ...noisyReceipts,
                noisyReceipts.at(-1),
            ],
        },
    }));
    useStorage(tamperedStorage);
    const repaired = new SaveSystem();
    check(repaired.data.guidedObjectives.schema === GUIDED_OBJECTIVE_SCHEMA
        && repaired.data.guidedObjectives.nextRunId === GUIDED_OBJECTIVE_RECEIPT_LIMIT + 21
        && repaired.data.guidedObjectives.activeRunSerial === 0,
    'malformed nested objective schema/counter did not repair');
    check(repaired.data.guidedObjectives.receipts.length === GUIDED_OBJECTIVE_RECEIPT_LIMIT
        && repaired.data.guidedObjectives.receipts[0] === noisyReceipts.at(-GUIDED_OBJECTIVE_RECEIPT_LIMIT)
        && repaired.data.guidedObjectives.receipts.at(-1) === noisyReceipts.at(-1),
    'receipt sanitizer did not dedupe, filter, and retain the bounded newest window');

    repaired.data.totalCoins = MAX_COIN_BALANCE - 2;
    const cappedId = runObjectiveReceiptId(repaired.beginGuidedObjectiveRun(), 1, 'tactic_hold');
    const capped = repaired.claimGuidedObjectiveRewards([{ receiptId: cappedId, multiplier: 1.25 }]);
    check(capped.credited === 2 && repaired.data.totalCoins === MAX_COIN_BALANCE,
        'atomic objective settlement overflowed the coin cap');

    // A bounded detail ledger must not make a retired slot replayable after its
    // exact string falls out of the newest-96 window.
    const boundedStorage = new MemoryStorage();
    useStorage(boundedStorage);
    const bounded = new SaveSystem();
    let retiredReceipt = null;
    for (let i = 0; i < 40; i++) {
        const runId = bounded.beginGuidedObjectiveRun();
        const batch = [
            { receiptId: runObjectiveReceiptId(runId, 0, 'orient_first_blood'), multiplier: 1 },
            { receiptId: runObjectiveReceiptId(runId, 1, 'tactic_hold'), multiplier: 1 },
            { receiptId: runObjectiveReceiptId(runId, 2, 'climax_endure'), multiplier: 1 },
        ];
        if (i === 0) retiredReceipt = batch[0];
        const settled = bounded.claimGuidedObjectiveRewards(batch);
        check(settled.accepted.length === 3, `bounded ledger run ${i} did not settle atomically`);
    }
    check(!bounded.data.guidedObjectives.receipts.includes(retiredReceipt.receiptId)
        && bounded.data.guidedObjectives.receipts.length === GUIDED_OBJECTIVE_RECEIPT_LIMIT,
    'bounded ledger fixture did not evict the oldest exact receipt');
    const beforeRetiredReplay = bounded.data.totalCoins;
    const retiredReplay = bounded.claimGuidedObjectiveRewards([retiredReceipt]);
    check(retiredReplay.credited === 0 && retiredReplay.accepted.length === 0
        && bounded.data.totalCoins === beforeRetiredReplay,
    'an evicted retired run/phase receipt became payable again');
} finally {
    restoreStorage();
}

// Finish-line integration: objective polling happens before combat in the
// regular frame, so victory/death must each flush the latest authoritative
// counters before composing or settling their receipts.
const gameSource = readFileSync(new URL('../src/core/Game.js', import.meta.url), 'utf8');
const victorySource = gameSource.slice(
    gameSource.indexOf('    _showVictory() {'),
    gameSource.indexOf('    victoryContinue() {'),
);
check(victorySource.indexOf('this._checkObjectives();') >= 0
    && victorySource.indexOf('this._checkObjectives();') < victorySource.indexOf('this.victory = { age: 0 };'),
'victory does not flush final-frame objective progress before composing its receipt');
const gameOverSource = gameSource.slice(
    gameSource.indexOf('    _enterGameOver() {'),
    gameSource.indexOf('    // â”€â”€ EMBERGLASS:', gameSource.indexOf('    _enterGameOver() {')),
);
check(gameOverSource.indexOf('this._checkObjectives();') >= 0
    && gameOverSource.indexOf('this._checkObjectives();') < gameOverSource.indexOf('this.gameOver = true;'),
'game over does not flush lethal-frame objective progress before settlement');
check((gameSource.match(/objectivesCompleted: this\._objectiveRewardsEligible/g) || []).length === 2,
    'practice Run Path completions can leak into Battle Pass objective XP');
const taintSource = gameSource.slice(
    gameSource.indexOf('    _taintCampaignRun('),
    gameSource.indexOf('    _debugSkipTime(', gameSource.indexOf('    _taintCampaignRun(')),
);
check(/_objectiveRewardsEligible = false;[\s\S]*?setRewardMultiplier\?\.\(0\);[\s\S]*?setObjective/.test(taintSource),
    'mid-run taint does not immediately reconcile the active reward and accessibility copy');
const renderSource = readFileSync(new URL('../src/core/GameRender.js', import.meta.url), 'utf8');
check(/_objectiveRewardsEligible === false[\s\S]*?REWARD FORFEITED[\s\S]*?PRACTICE CLEAR/.test(renderSource),
    'victory presentation can promise held coins after practice taint');
const inputSource = readFileSync(new URL('../src/core/GameInputActions.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/systems/UISystem.js', import.meta.url), 'utf8');
check(/held Run Path coins will be forfeited/.test(inputSource)
    && /COINS HELD · RESTART OR LEAVE FORFEITS THEM/.test(uiSource),
    'pause restart/leave does not disclose the exact held-reward forfeiture visually and accessibly');
const denseObjectiveSource = uiSource.slice(
    uiSource.indexOf('        if (r.dense) {'),
    uiSource.indexOf('        const titleY =', uiSource.indexOf('        if (r.dense) {')),
);
check(/ctx\.restore\(\);\s*return true;/.test(denseObjectiveSource),
    'dense/phone Run Path card does not issue a completed draw receipt');
const abandonSource = gameSource.slice(
    gameSource.indexOf('    _abandonGuidedObjectiveRewards() {'),
    gameSource.indexOf('    // Commit held rewards', gameSource.indexOf('    _abandonGuidedObjectiveRewards() {')),
);
const settlementSource = gameSource.slice(
    gameSource.indexOf('    _settleGuidedObjectiveRewards() {'),
    gameSource.indexOf('    // Advance exactly one phase', gameSource.indexOf('    _settleGuidedObjectiveRewards() {')),
);
check(/closeGuidedObjectiveRun\(this\._objectiveRunId\)/.test(abandonSource)
    && (gameSource.match(/this\._abandonGuidedObjectiveRewards\(\);/g) || []).length >= 2,
    'restart/menu abandonment does not durably close the live Run Path');
check((settlementSource.match(/closeGuidedObjectiveRun\(this\._objectiveRunId\)/g) || []).length >= 2,
    'terminal settlement leaves zero-receipt, practice, or rejected runs payable');

if (failures) {
    console.error(`run objectives: ${failures}/${checks} checks failed`);
    process.exit(1);
}
console.log(`run objectives: ${checks} checks passed`);
