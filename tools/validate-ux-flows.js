#!/usr/bin/env node
// Pure UX-flow regression gate: no DOM, canvas, storage, or live game boot.
// It protects the first-vigil entry contract, complete menu-tour coverage,
// modal-safe onboarding, and pause's action-specific two-step exits.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOUR_STEPS } from '../src/content/tutorialTour.js';
import { MENU_TABS, completedDailyCount } from '../src/systems/MenuRenderer.js';
import {
    GameInputActionMethods,
    PAUSE_EXIT_CONFIRM_MS,
} from '../src/core/GameInputActions.js';
import {
    onboardingModalActive,
    pauseExitConfirmSnapshot,
} from '../src/systems/UIStateBuilder.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
let failures = 0;
const ok = (condition, message) => {
    checks++;
    if (!condition) {
        failures++;
        console.error(`  x ${message}`);
    }
};

// The guided tour promises every player-facing menu tab. Duplicate PLAY is
// intentional (orientation + send-off); missing sections are not.
const menuIds = MENU_TABS.map((tab) => tab.id);
const tourTabs = new Set(TOUR_STEPS.map((step) => step.tab));
for (const id of menuIds) ok(tourTabs.has(id), `guided tour is missing the ${id} tab`);
for (const step of TOUR_STEPS) {
    ok(menuIds.includes(step.tab), `tour references unknown tab: ${step.tab}`);
    ok(Array.isArray(step.lines) && step.lines.length > 0 && step.lines.length <= 5,
        `${step.tab} tour copy must contain 1..5 lines`);
}
ok(tourTabs.has('modes') && tourTabs.has('boutique'), 'Modes and Boutique need explicit lessons');

// A selector change deployed mid-day can leave old ids in the save. Only
// challenges present in the active deterministic set count toward menu badges.
const activeDaily = [{ id: 'kills_today' }, { id: 'boss_today' }, { id: 'time_today' }];
ok(completedDailyCount({ day: 42, completed: ['kills_today', 'retired_id'] }, 42, activeDaily) === 1,
    'stale same-day challenge ids must not count as active completions');
ok(completedDailyCount({ day: 41, completed: ['kills_today'] }, 42, activeDaily) === 0,
    'prior-day completions must not count');
ok(completedDailyCount({ day: 42, completed: ['kills_today', 'boss_today', 'time_today'] }, 42, activeDaily) === 3,
    'all active daily ids count exactly once');
ok(completedDailyCount({ day: 42, completed: ['kills_today', 'kills_today'] }, 42, activeDaily) === 1,
    'duplicate stored ids cannot inflate completion');

// Fresh saves must see HOME before they choose to launch their guided run, and
// HOME must define the game's lore terms in plain first-player language.
const gameSource = fs.readFileSync(path.join(ROOT, 'src/core/Game.js'), 'utf8');
const bootStart = gameSource.indexOf('// First contact belongs to the player');
const bootEnd = gameSource.indexOf('this._updateJoystickEnabled();', bootStart);
const bootBlock = gameSource.slice(bootStart, bootEnd);
ok(bootStart >= 0 && bootEnd > bootStart, 'fresh-save boot contract block is discoverable');
ok(!bootBlock.includes('this._startRun()'), 'fresh-save boot must not auto-launch gameplay');
ok(bootBlock.includes('stats?.runs ?? 0) > 0'), 'only veteran saves may auto-resume the menu tour');
const menuSource = fs.readFileSync(path.join(ROOT, 'src/systems/MenuRenderer.js'), 'utf8');
ok(menuSource.includes('START FIRST RUN'), 'fresh-save menu needs a plain-language start action');
ok(menuSource.includes('A Vigil is a survival run'), 'HOME must explain Vigil before using it as a game term');
for (const label of ["'MAP'", "'WEAPON'", "'DIFFICULTY'", "'SELECTED HERO'"]) {
    ok(menuSource.includes(label), `HOME needs the clear ${label.replaceAll("'", '')} label`);
}
ok(gameSource.includes("this.menuTab === 'home'") && gameSource.includes("this.menuTab = 'play'"),
    'keyboard activation on fresh HOME must open guided setup before launch');

// Every modal owner suppresses the free-floating tutorial banner/pointer.
ok(!onboardingModalActive({}), 'ordinary gameplay must allow onboarding guidance');
for (const key of ['upgradeChoices', 'chestReward', 'altar', 'paused', 'victory', 'gameOver', 'photoMode']) {
    ok(onboardingModalActive({ [key]: true }), `${key} must suppress onboarding guidance`);
}
const stateSource = fs.readFileSync(path.join(ROOT, 'src/systems/UIStateBuilder.js'), 'utf8');
ok(stateSource.includes('game.onboarding.step === 3 && game.upgradeChoices'),
    'level-up reassurance must appear only on onboarding step 3');
const uiSource = fs.readFileSync(path.join(ROOT, 'src/systems/UISystem.js'), 'utf8');
ok(uiSource.includes('Choose your first upgrade — every choice helps'),
    'first level-up guidance belongs in the normal subtitle');
ok(!uiSource.includes('Collecting shards fills a bar;'),
    'level-up overlay must not restore tutorial rows behind card tops');

// Pause confirmation behavior: same-action second press commits exactly once;
// changing action or waiting past the deadline only re-arms.
const realDateNow = Date.now;
let now = 10_000;
Date.now = () => now;
try {
    const makeGame = () => ({
        screen: 'gameplay', paused: true, gameOver: false, pauseExitConfirm: null,
        restartCalls: 0, menuCalls: 0, ticks: 0,
        audio: { uiTick() { this.owner.ticks++; }, owner: null },
        restart() { this.restartCalls++; this.paused = false; },
        returnToShop() { this.menuCalls++; this.paused = false; },
    });

    const restartGame = makeGame(); restartGame.audio.owner = restartGame;
    ok(GameInputActionMethods.requestPauseExit.call(restartGame, 'restart') === false,
        'first restart activation only arms');
    ok(restartGame.restartCalls === 0, 'arming restart cannot finalize the run');
    ok(restartGame.pauseExitConfirm?.expiresAt === now + PAUSE_EXIT_CONFIRM_MS,
        'restart confirmation receives the standard deadline');
    now += 500;
    ok(GameInputActionMethods.requestPauseExit.call(restartGame, 'restart') === true,
        'second in-window restart activation commits');
    ok(restartGame.restartCalls === 1 && restartGame.menuCalls === 0,
        'confirmed restart dispatches exactly once');
    GameInputActionMethods.requestPauseExit.call(restartGame, 'restart');
    ok(restartGame.restartCalls === 1, 'third activation after transition cannot double-finalize');

    now = 20_000;
    const switched = makeGame(); switched.audio.owner = switched;
    GameInputActionMethods.requestPauseExit.call(switched, 'restart');
    now += 400;
    ok(GameInputActionMethods.requestPauseExit.call(switched, 'menu') === false,
        'switching destructive action re-arms instead of committing');
    ok(switched.restartCalls === 0 && switched.menuCalls === 0
        && switched.pauseExitConfirm?.action === 'menu', 'only the newly named action remains armed');
    now += 400;
    GameInputActionMethods.requestPauseExit.call(switched, 'menu');
    ok(switched.restartCalls === 0 && switched.menuCalls === 1,
        'confirmed leave dispatches menu exactly once');

    now = 30_000;
    const expired = makeGame(); expired.audio.owner = expired;
    GameInputActionMethods.requestPauseExit.call(expired, 'restart');
    now += PAUSE_EXIT_CONFIRM_MS + 1;
    ok(GameInputActionMethods.requestPauseExit.call(expired, 'restart') === false
        && expired.restartCalls === 0, 'expired restart confirmation re-arms without committing');
    ok(pauseExitConfirmSnapshot(expired, now)?.action === 'restart',
        're-armed pause confirmation is visible to the UI');
    now += PAUSE_EXIT_CONFIRM_MS + 1;
    ok(pauseExitConfirmSnapshot(expired, now) === null,
        'expired pause confirmation disappears while gameplay remains frozen');
    GameInputActionMethods.cancelPauseExitConfirm.call(expired);
    ok(expired.pauseExitConfirm === null, 'resume/other safe actions can cancel confirmation');
} finally {
    Date.now = realDateNow;
}

if (failures) {
    console.error(`UX flow validation: FAILED (${failures}/${checks})`);
    process.exit(1);
}
console.log(`UX flow validation: OK — ${checks} checks across first-vigil, tour, modal, and pause flows.`);
