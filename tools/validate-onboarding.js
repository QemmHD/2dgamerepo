#!/usr/bin/env node
// Behavioral checks for first-run learning: success requires an actual action,
// early use is retained, inaccessible lessons defer, and modals stop the clock.
import assert from 'node:assert/strict';
import { GameInputActionMethods } from '../src/core/GameInputActions.js';
import { UpgradeSystem } from '../src/systems/UpgradeSystem.js';
import { rollAltarChoices } from '../src/systems/WickRoadsSystem.js';
import { RELICS } from '../src/content/relics.js';
import {
    OnboardingDirector,
    ONBOARDING_LESSONS,
    ONBOARDING_MAX_ACTIVE_SECONDS,
    ONBOARDING_SUCCESS_HOLD,
    ONBOARDING_FALLBACK_HOLD,
    createOnboardingState,
    updateOnboardingState,
    onboardingLessonSnapshot,
} from '../src/systems/OnboardingDirector.js';

let checks = 0;
function check(condition, message) { checks += 1; assert.ok(condition, message); }
function same(actual, expected, message) { checks += 1; assert.deepEqual(actual, expected, message); }
function advance(director) {
    return director.update(ONBOARDING_FALLBACK_HOLD + ONBOARDING_SUCCESS_HOLD);
}

same(ONBOARDING_LESSONS.map((entry) => entry.id), [
    'move', 'auto-fire', 'shard', 'upgrade', 'coin', 'combo', 'shrine', 'boss',
    'blink', 'focus', 'kindle', 'controls',
], 'legacy chain remains intact and all three active controls are taught before send-off');
check(new Set(ONBOARDING_LESSONS.map((entry) => entry.id)).size === 12, 'lesson IDs are unique');
for (const lesson of ONBOARDING_LESSONS) {
    check(lesson.timeout >= lesson.minRead && Number.isFinite(lesson.timeout), `${lesson.id} has a reachable finite fallback`);
    check(lesson.text.split('\n').length === 2 && lesson.touchText.split('\n').length === 2, `${lesson.id} has concise two-line copy`);
}

// A run with no enemies, pickups, or player actions must finish the guidance
// flow, but must never emit a green success state or claim a learned action.
{
    const director = new OnboardingDirector();
    let elapsed = 0;
    while (!director.finished && elapsed < ONBOARDING_MAX_ACTIVE_SECONDS + 30) {
        const event = director.update(0.1);
        elapsed += 0.1;
        check(!director.done, 'idle timeout never displays success');
        if (event?.type === 'lesson-settled') {
            same(event.outcome, event.id === 'controls' ? 'read' : 'deferred', 'timeout has an honest outcome');
            check(!director.snapshot().resultText.includes('completed'), 'fallback copy never says completed');
        }
    }
    check(director.finished, 'all unavailable lessons leave the guidance lane in bounded active time');
    check(elapsed <= ONBOARDING_MAX_ACTIVE_SECONDS + 3, 'the finite budget includes bounded frame rounding');
    same(director.summary().successfulLessons, 0, 'idle player has learned no actions');
    same(director.summary().deferredLessons, 11, 'every action lesson is marked deferred');
    same(director.history.length, 12, 'each lesson creates exactly one outcome receipt');
    same(director.snapshot(), null, 'finished tutorial releases the HUD lane');
}

// Complete all actions before their lessons become current. This represents a
// fast first upgrade and experienced players replaying tips with an early cast.
{
    const director = createOnboardingState({ distanceMoved: 200, comboPeak: 5 });
    for (const action of ['attack', 'shard', 'upgrade', 'coin', 'relic', 'boss', 'blink', 'focus', 'kindle']) {
        check(director.record(action), `${action} accepts a committed early action`);
    }
    for (let i = 0; i < ONBOARDING_LESSONS.length; i += 1) {
        const current = director.lesson;
        same(director.update(1), null, `${current.id} retains its minimum reading time`);
        check(!director.done, `${current.id} does not flash by on entry`);
        const event = director.update(current.metric ? 1.5 : current.timeout);
        same(event?.outcome, current.metric ? 'success' : 'read', `${current.id} resolves from its own evidence`);
        same(director.snapshot().done, current.metric !== null, `${current.id} renders honest success state`);
        advance(director);
    }
    check(director.finished, 'early successful actions do not wedge the sequence');
    same(director.summary().successfulLessons, 11, 'all eleven action lessons have a successful receipt');
    same(director.summary().deferredLessons, 0, 'fully practiced run defers nothing');
    same(director.record('blink'), false, 'finished tutorial does not collect extra actions');
    same(director.update(999), null, 'finished tutorial cannot emit duplicate completion');
}

// Each metric proves only its own lesson. Time passing, displayed gems, seeded
// coins, a charged meter, or a canceled aim cannot substitute for the real act.
for (const target of ONBOARDING_LESSONS.filter((entry) => entry.metric)) {
    const director = new OnboardingDirector();
    while (director.lessonId !== target.id) { director.skipCurrent(); advance(director); }
    const unrelated = Object.fromEntries(ONBOARDING_LESSONS
        .filter((entry) => entry.metric && entry.id !== target.id)
        .map((entry) => [entry.metric, entry.target * 10]));
    director.update(target.minRead, unrelated);
    same(director.outcome, null, `${target.id} rejects every unrelated action metric`);
    director.update(0.01, { [target.metric]: target.target - 0.1 });
    same(director.outcome, null, `${target.id} rejects partial progress`);
    same(director.update(0.01, { [target.metric]: target.target })?.outcome, 'success', `${target.id} recognizes the exact success threshold`);
    same(director.history.filter((entry) => entry.id === target.id).length, 1, `${target.id} records one terminal lesson outcome`);
    director.update(0.01, { [target.metric]: target.target * 100 });
    same(director.history.filter((entry) => entry.id === target.id).length, 1, `${target.id} ignores duplicate completion observations`);
}

{
    const director = new OnboardingDirector({ x: 0, y: 0 });
    director.update(1, { x: 60, y: 0 });
    director.update(1, { x: 60, y: 60 });
    same(director.moved, 120, 'movement accumulates distance along the traveled path');
    director.update(99, { x: 900, y: 900 }, { blocked: true });
    same(director.timer, 2, 'modal time never advances the lesson timer');
    same(director.moved, 120, 'modal repositioning grants no movement credit');
    director.update(0.5, { x: 930, y: 900 });
    same(director.outcome, 'success', 'movement resumes from the modal anchor');
    const held = director.doneTimer;
    director.update(90, {}, { blocked: true });
    same(director.doneTimer, held, 'success receipt stays visible after a modal closes');
    director.update(90, {}, { ended: true });
    same(director.doneTimer, held, 'death does not advance teaching behind the result screen');
}

{
    const director = new OnboardingDirector({ distanceMoved: 0, x: 0, y: 0 });
    director.update(3, { distanceMoved: 0, x: 1000, y: 0 });
    same(director.moved, 0, 'authoritative walk counter prevents teleports from counting as walking');
    director.update(1, { distanceMoved: 150 });
    same(director.outcome, 'success', 'explicit walk distance can complete movement');
    director.record('blink');
    director.update(0.01, { blinks: 1 });
    same(director.counts.blinks, 1, 'event plus matching cumulative metric is not double counted');
    director.update(0.01, { blinks: 0 });
    same(director.counts.blinks, 1, 'stale metric observations cannot erase a committed action');
}

{
    const director = new OnboardingDirector();
    for (const dt of [NaN, Infinity, -1, null, '10', 0]) {
        same(updateOnboardingState(director, dt), null, 'malformed time never advances a lesson');
        same(director.timer, 0, 'malformed time leaves timer finite and unchanged');
    }
    for (const value of [NaN, Infinity, -1, null, '1', 0]) {
        check(!director.record('blink', value), 'malformed action count is rejected');
        director.update(0, { blinks: value });
        same(director.counts.blinks, 0, 'malformed cumulative count grants no success credit');
    }
    check(!director.record('made-up'), 'unknown actions are rejected');
    same(director.skipCurrent()?.outcome, 'deferred', 'explicit skip is honest deferral');
    check(!director.done, 'explicit skip does not show the success checkmark');
    same(director.skipCurrent(), null, 'repeat skip does not duplicate receipts');
}

{
    const director = new OnboardingDirector();
    while (director.lessonId !== 'kindle') { director.skipCurrent(); advance(director); }
    check(onboardingLessonSnapshot(director).text.includes('fill the Kindle meter'), 'unready Kindle explains how to earn charge');
    check(director.snapshot({ kindleReady: true }).text.includes('hold Q'), 'ready keyboard Kindle teaches the actual input');
    check(director.snapshot({ kindleReady: true, inputMode: 'touch' }).text.includes('drag to aim'), 'touch Kindle teaches aim and release');
    director.update(3, { kindleReady: true, kindleAiming: true, gems: 10, coins: 500 });
    same(director.outcome, null, 'ready meter, aim hold, loose gems, and seeded coins never count as casts');
    director.record('kindle');
    same(director.update(0.01)?.outcome, 'success', 'released Kindle counts even when used before current tick');
    same(onboardingLessonSnapshot(null), null, 'absent tutorial has no snapshot');
    same(updateOnboardingState(null, 1), null, 'absent tutorial has no update effects');
}

// Exercise the actual overlay commit methods. Counting at the button/key route
// would accept invalid clicks or failed applies and miss early first-run picks.
function overlayGame() {
    return {
        onboarding: new OnboardingDirector(),
        player: { x: 0, y: 0, speed: 100 },
        weaponSystem: { owned: [] },
        upgradeSystem: new UpgradeSystem(),
        _runRelics: [],
        audio: { upgrade() {}, fusionForge() {}, pactSworn() {} },
        waveDirector: { announce() {} },
        particles: { levelUpBurst() {} },
        saveSystem: { discoverRelic() { return false; } },
        setUpgradeChoices(choices) { this.upgradeChoices = choices; },
        setAltar(altar) { this.altar = altar; },
        _pushFeedback() {},
        _shake() {},
    };
}

{
    const game = overlayGame();
    const upgrade = {
        id: 'tutorial-test-upgrade',
        apply(owner) {
            same(owner.onboarding.counts.upgradesChosen, 0, 'upgrade credit is absent before the actual apply');
            owner.upgradeApplied = true;
        },
    };
    game.upgradeChoices = [upgrade];
    GameInputActionMethods.selectUpgrade.call(game, 8);
    same(game.onboarding.counts.upgradesChosen, 0, 'invalid upgrade slot earns no teaching credit');
    GameInputActionMethods.selectUpgrade.call(game, 0);
    check(game.upgradeApplied, 'real UpgradeSystem applies the chosen card');
    same(game.onboarding.counts.upgradesChosen, 1, 'successful first choice records one upgrade');
    same(game.onboarding.step, 0, 'early first choice does not skip the movement or shard lessons');
    same(game.upgradeChoices, null, 'successful choice still closes its overlay');
    GameInputActionMethods.selectUpgrade.call(game, 0);
    same(game.onboarding.counts.upgradesChosen, 1, 'replayed input after overlay closure cannot add credit');
}

{
    const game = overlayGame();
    game.upgradeChoices = [{ id: 'failed-upgrade', apply() { throw new Error('apply failed'); } }];
    assert.throws(() => GameInputActionMethods.selectUpgrade.call(game, 0), /apply failed/); checks += 1;
    same(game.onboarding.counts.upgradesChosen, 0, 'failed upgrade application earns no success credit');
}

{
    const game = overlayGame();
    const choice = rollAltarChoices(game, RELICS.length + 1).find((entry) => entry.relicId === 'swiftsole');
    check(!!choice, 'real shrine roller provides the Swiftsole relic choice');
    game.altar = { choices: [choice] };
    GameInputActionMethods.selectAltar.call(game, 9);
    same(game.onboarding.counts.relicsChosen, 0, 'invalid shrine slot earns no teaching credit');
    GameInputActionMethods.selectAltar.call(game, 0);
    check(game.player.speed > 100 && game._runRelics.includes('swiftsole'), 'real relic choice applies its power and records inventory');
    same(game.onboarding.counts.relicsChosen, 1, 'committed relic earns one shrine lesson credit');
    same(game.onboarding.step, 0, 'early shrine choice retains all earlier lesson order');
    same(game.altar, null, 'real relic choice still closes the altar');
    GameInputActionMethods.selectAltar.call(game, 0);
    same(game.onboarding.counts.relicsChosen, 1, 'replayed input after altar closure cannot add credit');
    game.altar = { choices: [choice] };
    GameInputActionMethods.selectAltar.call(game, 0);
    same(game.onboarding.counts.relicsChosen, 1, 'a stale already-owned relic card grants no additional teaching credit');
}

for (const kind of ['fusion', 'pact', 'road', 'relic']) {
    const game = overlayGame();
    game.altar = { choices: [{ kind, name: 'Test choice', relicId: kind === 'relic' ? 'unknown-relic' : undefined, apply(owner) { owner.choiceApplied = true; } }] };
    GameInputActionMethods.selectAltar.call(game, 0);
    check(game.choiceApplied, `${kind} choice still applies normally`);
    same(game.onboarding.counts.relicsChosen, 0, `${kind} without a new relic inventory entry cannot satisfy the shrine lesson`);
}

{
    const game = overlayGame();
    game.altar = { choices: [{ kind: 'relic', relicId: 'failed-relic', apply() { throw new Error('relic failed'); } }] };
    assert.throws(() => GameInputActionMethods.selectAltar.call(game, 0), /relic failed/); checks += 1;
    same(game.onboarding.counts.relicsChosen, 0, 'failed relic application earns no success credit');
}

console.log(`Onboarding: ${checks.toLocaleString()} checks passed; 12 lessons, real action success, honest bounded fallback, committed overlay integration.`);
