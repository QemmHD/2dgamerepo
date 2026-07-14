#!/usr/bin/env node
// Deterministic accessibility/input contract gate for the Canvas-native UI.
//
// This intentionally avoids a browser dependency. It combines pure behavior
// checks for the accessibility bridge, active-modality tracker, hotspot keys,
// and roving focus controller with narrow source-contract checks for the DOM,
// Canvas drawing, keyboard routing, and reduced-motion integration seams.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    AccessibilityBridge,
    menuHotspotKey,
    menuHotspotLabel,
} from '../src/systems/AccessibilityBridge.js';
import { Input } from '../src/core/Input.js';
import {
    consumeRepeatedDiscreteKey,
    DISCRETE_KEY_CODES,
    GameInputActionMethods,
} from '../src/core/GameInputActions.js';
import { MenuRenderer } from '../src/systems/MenuRenderer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

let checks = 0;
let failures = 0;
const ok = (condition, message) => {
    checks += 1;
    if (!condition) {
        failures += 1;
        console.error(`  x ${message}`);
    }
};

const includesAll = (source, markers, label) => {
    for (const marker of markers) {
        ok(source.includes(marker), `${label} is missing ${JSON.stringify(marker)}`);
    }
};

const html = read('index.html');
const css = read('styles.css');
const gameSource = read('src/core/Game.js');
const inputSource = read('src/core/Input.js');
const actionSource = read('src/core/GameInputActions.js');
const menuSource = read('src/systems/MenuRenderer.js');
const saveSource = read('src/systems/SaveSystem.js');
const stateSource = read('src/systems/UIStateBuilder.js');
const renderSource = read('src/core/GameRender.js');

function tagWithId(source, tagName, id) {
    const tags = source.match(new RegExp(`<${tagName}\\b[^>]*>`, 'gi')) || [];
    return tags.find((tag) => new RegExp(`\\bid\\s*=\\s*["']${id}["']`, 'i').test(tag)) || '';
}

function attr(tag, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']*)["']`, 'i'));
    return match ? match[1].trim() : '';
}

function cssBlock(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'i'))?.[1] || '';
}

// Canvas semantic DOM contract: one named application surface, one described
// instruction node, and one polite status channel. The hidden copy must remain
// available to assistive technology (never aria-hidden).
const canvasTag = tagWithId(html, 'canvas', 'game');
ok(!!canvasTag, 'index exposes the game canvas');
ok(attr(canvasTag, 'tabindex') === '0', 'game canvas participates in keyboard focus order');
ok(attr(canvasTag, 'role') === 'application', 'game canvas has the application role');
ok(attr(canvasTag, 'aria-roledescription').length > 0, 'game canvas has a readable role description');
ok(/emberwake/i.test(attr(canvasTag, 'aria-label')), 'game canvas has a named EMBERWAKE surface');
const describedBy = attr(canvasTag, 'aria-describedby');
ok(!!describedBy, 'game canvas references keyboard instructions');

const instructionsTag = tagWithId(html, 'p', describedBy);
ok(!!instructionsTag, 'aria-describedby resolves to a real instruction node');
ok(/\bsr-only\b/.test(attr(instructionsTag, 'class')), 'instructions are visually hidden, not removed');
ok(!/aria-hidden\s*=\s*["']true/i.test(instructionsTag), 'instructions remain exposed to assistive technology');
const instructionsText = html.match(new RegExp(`<p\\b[^>]*\\bid\\s*=\\s*["']${describedBy}["'][^>]*>([\\s\\S]*?)<\\/p>`, 'i'))?.[1]
    ?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
for (const phrase of ['Tab', 'arrow keys', 'Enter', 'Space', 'Escape']) {
    ok(instructionsText.includes(phrase), `keyboard instructions name ${phrase}`);
}

const statusTag = tagWithId(html, 'div', 'game-status');
ok(!!statusTag, 'index exposes the live game-status node');
ok(attr(statusTag, 'aria-live') === 'polite', 'status updates use a polite live region');
ok(attr(statusTag, 'aria-atomic') === 'true', 'status updates are announced atomically');
ok(/\bsr-only\b/.test(attr(statusTag, 'class')), 'live status is visually hidden');
ok(!/aria-hidden\s*=\s*["']true/i.test(statusTag), 'live status remains exposed to assistive technology');
const viewportTag = (html.match(/<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i) || [''])[0];
const viewportContent = attr(viewportTag, 'content');
ok(!/user-scalable\s*=\s*no|maximum-scale\s*=|minimum-scale\s*=/i.test(viewportContent),
    'viewport does not block browser zoom');

const hiddenCss = cssBlock('.sr-only');
includesAll(hiddenCss, ['width: 1px', 'height: 1px', 'overflow: hidden', 'white-space: nowrap'], '.sr-only contract');
ok(/clip(?:-path)?\s*:/.test(hiddenCss), '.sr-only content is clipped without display:none/visibility:hidden');
ok(!/display\s*:\s*none|visibility\s*:\s*hidden/.test(hiddenCss), '.sr-only does not remove semantic content');
const focusCss = cssBlock('canvas#game:focus-visible');
ok(/outline\s*:\s*(?!none|0)/.test(focusCss), 'focused Canvas has a visible non-colorless outline');

// AccessibilityBridge behavior is exercised with tiny DOM fakes so duplicate
// announcements, screen naming, and focus fallback stay browser-independent.
const attributes = new Map();
let focusCalls = 0;
const fakeCanvas = {
    tabIndex: -1,
    setAttribute(name, value) { attributes.set(name, String(value)); },
    focus(options) { focusCalls += 1; this.focusOptions = options; },
};
const fakeStatus = { textContent: '' };
const bridge = new AccessibilityBridge(fakeCanvas, fakeStatus);
ok(fakeCanvas.tabIndex === 0, 'bridge repairs Canvas tabIndex defensively');
ok(attributes.get('role') === 'application', 'bridge repairs Canvas role defensively');
ok(attributes.get('aria-describedby') === 'game-instructions', 'bridge connects the Canvas instructions');
bridge.focusCanvas();
ok(focusCalls === 1 && fakeCanvas.focusOptions?.preventScroll === true, 'bridge focuses Canvas without scrolling');
bridge.setScreen('gameplay', 'Boss incoming');
ok(/gameplay.*Boss incoming/i.test(attributes.get('aria-label') || ''), 'bridge updates the accessible screen name');
ok(bridge.announce('Reward ready') === true, 'bridge publishes a non-empty status');
const firstAnnouncement = fakeStatus.textContent;
ok(bridge.announce('Reward ready') === true && fakeStatus.textContent !== firstAnnouncement,
    'repeated equal events still produce a distinct live-region mutation');
ok(new AccessibilityBridge(fakeCanvas, null).announce('No status target') === false,
    'missing live-region target degrades to a safe no-op');

// Stable hotspot identity/labels: object key order cannot change identity, and
// repeated controls receive deterministic occurrence suffixes.
ok(menuHotspotKey('selectCharacter', { id: 'pyra', category: 'hero' })
    === menuHotspotKey('selectCharacter', { category: 'hero', id: 'pyra' }),
'hotspot keys canonicalize object-property order');
ok(menuHotspotKey('tab', 'play', 0) !== menuHotspotKey('tab', 'play', 1),
    'repeated semantic controls receive distinct occurrence keys');
for (const [action, arg] of [
    ['tab', 'play'], ['startRun', null], ['toggleSetting', 'reducedEffects'],
    ['openMines', 250], ['claimBP', 12], ['tourNext', null],
]) {
    const label = menuHotspotLabel(action, arg);
    ok(typeof label === 'string' && label.trim().length >= 4, `${action} has a useful fallback label`);
}
ok(menuHotspotLabel('customAction', null, '  Exact   accessible label  ') === 'Exact accessible label',
    'explicit hotspot labels are normalized and preserved');

const menu = new MenuRenderer({ safeArea: { top: 0, right: 0, bottom: 0, left: 0 } });
menu._hot(10, 20, 100, 44, 'tab', 'play', 'Run setup');
menu._hot(10, 70, 100, 44, 'tab', 'play', 'Run setup copy');
ok(menu.hotspots.length === 2, 'MenuRenderer registers semantic hotspots');
ok(menu.hotspots[0].baseKey === menu.hotspots[1].baseKey, 'repeated hotspots retain one semantic base key');
ok(menu.hotspots[0].key !== menu.hotspots[1].key, 'repeated hotspots retain unique stable keys');
ok(menu.hotspots.every((entry) => entry.key && entry.label && entry.action
    && Number.isFinite(entry.x) && Number.isFinite(entry.y)
    && entry.w > 0 && entry.h > 0), 'every registered hotspot is labeled, keyed, actionable, and bounded');
includesAll(menuSource, [
    'menuHotspotKey(action, arg',
    'menuHotspotLabel(action, arg',
    'key: menuHotspotKey',
    'label: menuHotspotLabel',
    'accessibleLabel === undefined ? label : accessibleLabel',
    '_drawKeyboardFocus(ctx, state)',
    'state.menuFocusVisible',
    'state.menuFocusKey',
    'hotspot.label',
    'this.hotspots = []',
], 'MenuRenderer semantic hotspot/focus contract');

// Active modality is a real-input state machine, not a touch-capability alias.
const oldWindow = globalThis.window;
const listeners = new Map();
globalThis.window = {
    addEventListener(type, callback, options) { listeners.set(type, { callback, options }); },
};
try {
    const keyboardVector = { x: -1, y: 0 };
    const touchVector = { x: 0.5, y: 0.25 };
    let touchResets = 0;
    let buttonResets = 0;
    const modalityInput = new Input({
        keyboard: { getVector: () => keyboardVector },
        touch: { active: false, getVector: () => touchVector, reset: () => { touchResets += 1; } },
        buttons: { reset: () => { buttonResets += 1; } },
    });
    const changes = [];
    modalityInput.onModalityChange((next) => changes.push(next));
    ok(modalityInput.getModality() === 'pointer', 'active modality starts pointer-first');
    listeners.get('keydown')?.callback({ code: 'KeyW', ctrlKey: true });
    ok(modalityInput.getModality() === 'pointer', 'modified browser shortcut does not steal modality');
    listeners.get('keydown')?.callback({ code: 'KeyW' });
    ok(modalityInput.getModality() === 'keyboard', 'real keyboard input selects keyboard modality');
    listeners.get('pointerdown')?.callback({ pointerType: 'touch' });
    ok(modalityInput.isTouchMode(), 'touch pointer selects touch modality');
    listeners.get('keydown')?.callback({ code: 'KeyW', repeat: true });
    ok(modalityInput.isTouchMode() && touchResets === 0 && buttonResets === 0,
        'held-key repeat cannot steal touch modality or reset active touch controls');
    listeners.get('keydown')?.callback({ code: 'KeyD', repeat: false });
    ok(modalityInput.getModality() === 'keyboard' && touchResets === 1 && buttonResets === 1,
        'fresh keyboard press leaves touch mode and clears held touch controls');
    listeners.get('pointerdown')?.callback({ pointerType: 'touch' });
    listeners.get('pointerdown')?.callback({ pointerType: 'mouse' });
    ok(modalityInput.getModality() === 'pointer', 'real mouse press restores pointer modality');
    ok(touchResets === 2 && buttonResets === 2,
        'each genuine departure from touch clears held joystick and action-button state');
    listeners.get('touchstart')?.callback({});
    ok(modalityInput.getModality() === 'touch', 'TouchEvent fallback selects touch modality');
    ok(modalityInput.setModality('voice') === false && modalityInput.getModality() === 'touch',
        'unknown modality is rejected without poisoning state');
    ok(changes.join(',') === 'keyboard,touch,keyboard,touch,pointer,touch',
        'modality callback fires once per real transition and never for held-key repeat');
    ok(modalityInput.getMovement() === keyboardVector, 'inactive touch leaves keyboard movement authoritative');
    modalityInput.touch.active = true;
    ok(modalityInput.getMovement() === touchVector, 'active touch movement remains authoritative');
    ok(listeners.get('keydown')?.options?.capture === true
        && listeners.get('pointerdown')?.options?.capture === true,
    'modality updates before Game routes the same input');
} finally {
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
}
includesAll(inputSource, [
    "this.modality = 'pointer'",
    'event?.repeat',
    'setModality(next)',
    'getModality()',
    'isTouchMode()',
    'onModalityChange(callback)',
    "window.addEventListener('keydown'",
    "window.addEventListener('pointerdown'",
    "window.addEventListener('touchstart'",
], 'active modality API');
includesAll(stateSource, ['base.menuFocusKey', 'base.menuFocusVisible', 'base.inputModality'],
    'UI state modality/focus bridge');

// Pure roving-focus behavior, including wrap, reverse movement, activation,
// empty-state safety, assistive announcement, and stable-key lookup.
const focusHotspots = [
    { key: 'tab:play#0', label: 'Run setup', action: 'tab', arg: 'play', x: 0, y: 0, w: 90, h: 40 },
    { key: 'startRun:#0', label: 'Start run', action: 'startRun', arg: null, x: 0, y: 50, w: 90, h: 40 },
    { key: 'ignored', label: 'Ignored', action: 'noop', arg: null, x: 0, y: 100, w: 0, h: 40 },
];
const focusGame = {
    ui: { menu: { hotspots: focusHotspots } },
    menuFocusKey: null,
    menuFocusNeedsRefresh: true,
    focused: 0,
    announced: [],
    hovered: 0,
    dispatched: [],
    accessibility: {
        focusCanvas() { focusGame.focused += 1; },
        announce(message) { focusGame.announced.push(message); },
    },
    audio: { hover() { focusGame.hovered += 1; } },
    _menuAction(action, arg) { focusGame.dispatched.push([action, arg]); },
    _menuFocusableHotspots: GameInputActionMethods._menuFocusableHotspots,
    _menuMoveFocus: GameInputActionMethods._menuMoveFocus,
};
ok(GameInputActionMethods._menuMoveFocus.call(focusGame, 1) === true
    && focusGame.menuFocusKey === focusHotspots[0].key, 'focus enters the first valid hotspot');
GameInputActionMethods._menuMoveFocus.call(focusGame, 1);
ok(focusGame.menuFocusKey === focusHotspots[1].key, 'focus advances in render order');
GameInputActionMethods._menuMoveFocus.call(focusGame, 1);
ok(focusGame.menuFocusKey === focusHotspots[0].key, 'focus wraps forward');
GameInputActionMethods._menuMoveFocus.call(focusGame, -1);
ok(focusGame.menuFocusKey === focusHotspots[1].key, 'focus wraps backward');
ok(focusGame.focused === 4 && focusGame.hovered === 4 && focusGame.announced.length === 4,
    'every focus move produces visual/audio/assistive feedback');
ok(GameInputActionMethods._menuActivateFocus.call(focusGame) === true
    && focusGame.dispatched.at(-1)?.[0] === 'startRun', 'activation dispatches the focused semantic action');
GameInputActionMethods._resetMenuFocus.call(focusGame);
ok(focusGame.menuFocusKey === null && focusGame.menuFocusNeedsRefresh === true,
    'focus reset cannot retain an invisible stale control');
const emptyFocusGame = {
    ui: { menu: { hotspots: [] } },
    menuFocusKey: null,
    _menuFocusableHotspots: GameInputActionMethods._menuFocusableHotspots,
};
ok(GameInputActionMethods._menuMoveFocus.call(emptyFocusGame, 1) === false,
    'empty hotspot list is a safe focus no-op');

let trappedTabPrevents = 0;
let trappedTabFocuses = 0;
const tabScopeGame = { accessibility: { focusCanvas() { trappedTabFocuses += 1; } } };
ok(GameInputActionMethods._trapCanvasTab.call(tabScopeGame, {
    code: 'Tab',
    preventDefault() { trappedTabPrevents += 1; },
}) === true && trappedTabPrevents === 1 && trappedTabFocuses === 1,
'Canvas-owned overlays trap Tab and restore Canvas focus');
ok(GameInputActionMethods._trapCanvasTab.call(tabScopeGame, { code: 'Enter' }) === false
    && trappedTabPrevents === 1 && trappedTabFocuses === 1,
'Canvas Tab trap leaves non-Tab activation routes untouched');

const oldHotspot = { key: 'claim:old#0', label: 'Claim reward', action: 'claim', arg: 1, x: 0, y: 0, w: 90, h: 40 };
const replacementHotspot = { key: 'claim:next#0', label: 'Claim next reward', action: 'claim', arg: 2, x: 0, y: 50, w: 90, h: 40 };
const refreshFocusGame = {
    screen: 'start',
    minigame: {},
    input: { getModality: () => 'keyboard' },
    ui: { menu: { hotspots: [oldHotspot, replacementHotspot] } },
    menuFocusKey: oldHotspot.key,
    menuFocusNeedsRefresh: false,
    announced: [],
    accessibility: {
        focusCanvas() {},
        announce(message) { refreshFocusGame.announced.push(message); },
    },
    audio: { hover() {} },
    _menuAction() { refreshFocusGame.ui.menu.hotspots = [replacementHotspot]; },
    _menuFocusableHotspots: GameInputActionMethods._menuFocusableHotspots,
    _menuMoveFocus: GameInputActionMethods._menuMoveFocus,
};
ok(GameInputActionMethods._menuActivateFocus.call(refreshFocusGame) === true
    && refreshFocusGame.menuFocusNeedsRefresh === true,
'focused action requests post-render focus validation');
ok(GameInputActionMethods._refreshMenuFocusAfterRender.call(refreshFocusGame) === 'recovered'
    && refreshFocusGame.menuFocusKey === replacementHotspot.key
    && refreshFocusGame.menuFocusNeedsRefresh === false,
'removed focused control recovers to the first valid rendered hotspot');
refreshFocusGame.menuFocusNeedsRefresh = true;
ok(GameInputActionMethods._refreshMenuFocusAfterRender.call(refreshFocusGame) === 'retained'
    && refreshFocusGame.menuFocusKey === replacementHotspot.key
    && refreshFocusGame.menuFocusNeedsRefresh === false,
'still-valid focused control is retained after render');

refreshFocusGame.minigame.mines = { stopped: false };
refreshFocusGame.menuFocusNeedsRefresh = true;
ok(GameInputActionMethods._refreshMenuFocusAfterRender.call(refreshFocusGame) === 'deferred'
    && refreshFocusGame.menuFocusKey === null && refreshFocusGame.menuFocusNeedsRefresh === true,
'Mines clears obscured menu focus and defers keyboard restoration');
delete refreshFocusGame.minigame.mines;
ok(GameInputActionMethods._refreshMenuFocusAfterRender.call(refreshFocusGame) === 'recovered'
    && refreshFocusGame.menuFocusKey === replacementHotspot.key,
'closing an overlay restores a valid menu focus target');

refreshFocusGame.input.getModality = () => 'pointer';
refreshFocusGame.menuFocusKey = 'removed:pointer#0';
refreshFocusGame.menuFocusNeedsRefresh = true;
ok(GameInputActionMethods._refreshMenuFocusAfterRender.call(refreshFocusGame) === 'cleared'
    && refreshFocusGame.menuFocusKey === null && refreshFocusGame.menuFocusNeedsRefresh === false,
'pointer modality clears an orphan without inventing keyboard focus');
refreshFocusGame.input.getModality = () => 'keyboard';
ok(GameInputActionMethods._refreshMenuFocusAfterRender.call(refreshFocusGame) === 'none'
    && refreshFocusGame.menuFocusKey === null,
'untouched keyboard menu keeps no-focus HOME/PLAY activation available');

// Browser key-repeat is never a second activation. This is centralized before
// Game's screen/overlay routing so one held key cannot confirm RESET twice,
// dismiss a just-created result, flip pause back off, or cross modal boundaries.
for (const code of [
    'Enter', 'Space', 'Escape', 'KeyP', 'KeyR', 'KeyB', 'KeyS', 'KeyM',
    'KeyC', 'KeyG', 'KeyH', 'Digit1', 'Numpad3',
]) {
    let prevented = 0;
    ok(consumeRepeatedDiscreteKey({ code, repeat: true, preventDefault() { prevented += 1; } }) === true
        && prevented === 1, `${code} repeat is consumed as one discrete command edge`);
}
for (const code of ['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyD', 'KeyQ', 'KeyE']) {
    let prevented = 0;
    ok(consumeRepeatedDiscreteKey({ code, repeat: true, preventDefault() { prevented += 1; } }) === false
        && prevented === 0, `${code} remains repeat-friendly`);
}
let initialPressPrevented = 0;
ok(consumeRepeatedDiscreteKey({
    code: 'Enter',
    repeat: false,
    preventDefault() { initialPressPrevented += 1; },
}) === false && initialPressPrevented === 0, 'an initial discrete key press reaches its normal route');
ok(Object.isFrozen(DISCRETE_KEY_CODES), 'discrete key contract cannot be mutated at runtime');

const menuActivationGame = ({
    tab = 'settings', runs = 2, focusKey = null, tour = null, activateResult = true,
} = {}) => ({
    menuTab: tab,
    menuTour: tour,
    menuFocusKey: focusKey,
    saveSystem: { data: { stats: { runs } } },
    activated: 0,
    moved: 0,
    actions: [],
    starts: 0,
    dailyMode: true,
    riteTrialMode: true,
    bossRushMode: true,
    weeklyEmberMode: true,
    _menuActivateFocus() { this.activated += 1; return activateResult; },
    _menuMoveFocus() { this.moved += 1; return true; },
    _menuAction(action, arg) { this.actions.push([action, arg]); },
    _startRun() { this.starts += 1; },
});

const namedControlGame = menuActivationGame({ focusKey: 'resetSave:null#0' });
ok(GameInputActionMethods._menuKeyboardActivate.call(namedControlGame) === 'focused'
    && namedControlGame.activated === 1 && namedControlGame.starts === 0,
'named keyboard focus owns activation without leaking to quick-start');

const tourActivationGame = menuActivationGame({ tab: 'home', tour: { idx: 0 } });
ok(GameInputActionMethods._menuKeyboardActivate.call(tourActivationGame) === 'tour'
    && tourActivationGame.actions[0]?.[0] === 'tourNext' && tourActivationGame.starts === 0,
'guided-tour activation advances only the tour');

for (const tab of ['settings', 'shop', 'battlepass']) {
    const sectionGame = menuActivationGame({ tab });
    ok(GameInputActionMethods._menuKeyboardActivate.call(sectionGame) === 'focus'
        && sectionGame.moved === 1 && sectionGame.starts === 0,
    `${tab} activation with cleared focus establishes local focus instead of starting a run`);
}
const staleSectionGame = menuActivationGame({
    tab: 'settings', focusKey: 'old-tab-control', activateResult: false,
});
ok(GameInputActionMethods._menuKeyboardActivate.call(staleSectionGame) === 'focus'
    && staleSectionGame.activated === 1 && staleSectionGame.moved === 1 && staleSectionGame.starts === 0,
'stale section focus cannot fall through to quick-start');

const firstRunHomeGame = menuActivationGame({ tab: 'home', runs: 0 });
ok(GameInputActionMethods._menuKeyboardActivate.call(firstRunHomeGame) === 'play'
    && firstRunHomeGame.actions[0]?.[0] === 'tab' && firstRunHomeGame.actions[0]?.[1] === 'play'
    && firstRunHomeGame.starts === 0 && firstRunHomeGame.menuFocusNeedsRefresh === false,
'fresh-profile HOME activation opens PLAY through the central menu action');

const twoStepFirstRunGame = menuActivationGame({ tab: 'home', runs: 0 });
Object.assign(twoStepFirstRunGame, {
    screen: 'start',
    minigame: {},
    input: { getModality: () => 'keyboard' },
    ui: { menu: { hotspots: [] } },
    menuFocusNeedsRefresh: false,
    _menuFocusableHotspots: GameInputActionMethods._menuFocusableHotspots,
    _menuMoveFocus: GameInputActionMethods._menuMoveFocus,
});
twoStepFirstRunGame._menuAction = function firstRunTabAction(action, arg) {
    this.actions.push([action, arg]);
    this.menuTab = arg;
    this.menuFocusKey = null;
    this.menuFocusNeedsRefresh = true;
};
ok(GameInputActionMethods._menuKeyboardActivate.call(twoStepFirstRunGame) === 'play'
    && twoStepFirstRunGame.menuTab === 'play' && twoStepFirstRunGame.starts === 0,
'first Enter performs only the first-run HOME-to-PLAY transition');
twoStepFirstRunGame.ui.menu.hotspots = [
    { key: 'tab:play#0', label: 'Run setup', action: 'tab', arg: 'play', x: 0, y: 0, w: 90, h: 40 },
    { key: 'startRun:null#0', label: 'Start run', action: 'startRun', arg: null, x: 0, y: 50, w: 90, h: 40 },
];
ok(GameInputActionMethods._refreshMenuFocusAfterRender.call(twoStepFirstRunGame) === 'none'
    && twoStepFirstRunGame.menuFocusKey === null,
'PLAY render preserves deliberate no-focus quick-start after first-run transition');
ok(GameInputActionMethods._menuKeyboardActivate.call(twoStepFirstRunGame) === 'start'
    && twoStepFirstRunGame.starts === 1,
'second distinct Enter on PLAY starts the normal run');

for (const [tab, runs] of [['home', 2], ['play', 0]]) {
    const quickStartGame = menuActivationGame({ tab, runs });
    ok(GameInputActionMethods._menuKeyboardActivate.call(quickStartGame) === 'start'
        && quickStartGame.starts === 1
        && !quickStartGame.dailyMode && !quickStartGame.riteTrialMode
        && !quickStartGame.bossRushMode && !quickStartGame.weeklyEmberMode,
    `${tab.toUpperCase()} keeps a deliberately scoped normal-run quick-start`);
}

includesAll(actionSource, [
    '_menuFocusableHotspots()',
    '_menuMoveFocus(delta = 1)',
    '_menuActivateFocus()',
    '_trapCanvasTab(event)',
    '_refreshMenuFocusAfterRender()',
    '_menuKeyboardActivate()',
    '_resetMenuFocus()',
    'entry.key === this.menuFocusKey',
    'Focused: ${next.label}',
    "tab !== 'home' && tab !== 'play'",
    "this._menuAction('tab', 'play')",
], 'roving focus controller');

// Start-screen routing must use the focus controller instead of the historical
// global Space/Enter quick-start shortcut. Source slicing keeps gameplay's Tab
// target-lock and number-card shortcuts from producing false positives.
const startBegin = gameSource.indexOf("if (this.screen === 'start') {");
const startEnd = gameSource.indexOf("if (this.screen === 'gameOver')", startBegin);
const startInput = startBegin >= 0 && startEnd > startBegin ? gameSource.slice(startBegin, startEnd) : '';
ok(!!startInput, 'start-screen keyboard routing block is discoverable');
includesAll(startInput, [
    "e.code === 'Tab'",
    "e.code === 'ArrowUp'",
    "e.code === 'ArrowDown'",
    "e.code === 'ArrowLeft'",
    "e.code === 'ArrowRight'",
    "e.code === 'Enter'",
    "e.code === 'Space'",
    "e.code === 'Escape'",
    'this._menuMoveFocus(',
    'this._menuKeyboardActivate()',
], 'start-screen keyboard focus routing');
ok(startInput.includes('e.shiftKey'), 'Shift+Tab has an explicit reverse-focus route');
ok(startInput.includes('this._resetMenuFocus()'), 'keyboard back clears stale section focus');
ok((startInput.match(/this\._trapCanvasTab\(e\)/g) || []).length === 2,
    'Mines and case overlays each trap Tab inside the Canvas');
ok(gameSource.includes('if (consumeRepeatedDiscreteKey(e)) return;'),
    'Game consumes repeated discrete keys before any screen or overlay route');
includesAll(gameSource, [
    'renderWithAccessibleMenuFocus',
    'this._refreshMenuFocusAfterRender()',
], 'post-render keyboard focus reconciliation');
includesAll(gameSource, [
    'this.minigame.dismissMines()',
    'this.minigame.caseInput()',
    "this._menuAction('tourSkip', null)",
    'this.restart()',
    'this.victoryContinue()',
    'this.togglePause()',
    'this._dismissChestReward()',
    'this.selectAltar(0)',
    'this.selectUpgrade(0)',
], 'edge-triggered overlay/menu action coverage');

// Reduced-motion plumbing: only genuinely fresh profiles inherit the OS, old
// saves normalize against the historical false default, and menu/gameplay both
// suppress decorative motion without removing static warnings.
includesAll(saveSource, [
    "const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'",
    'function prefersReducedMotion()',
    'function freshDefaultData()',
    'defaultData({ reducedEffects: prefersReducedMotion() })',
    'const def = defaultData()',
], 'fresh-save reduced-motion inheritance');
includesAll(menuSource, [
    'this._reducedMotion = save.settings?.reducedEffects === true',
    'this._t = this._reducedMotion ? 0 : this._clockT',
    'if (this._reducedMotion) return 0',
    'const transK = this._reducedMotion ? 1',
], 'menu reduced-motion freeze/snap');
ok((gameSource.match(/getSetting\('reducedEffects'\)/g) || []).length >= 2,
    'game reads reduced-effects at boot and each run start');
ok(renderSource.includes('if (this.particlesEnabled && !this.reducedEffects)'),
    'world render suppresses decorative particle layers under reduced effects');
ok(renderSource.includes('const pulse = this.reducedEffects ? 0.72'),
    'essential encounter marking retains a static reduced-effects treatment');
includesAll(renderSource, [
    'this.input.isTouchMode?.()',
    'reducedMotion: this.reducedEffects === true',
], 'active-modality touch HUD and reduced-motion controls');

// Screen/status integration markers ensure the bridge is not isolated utility.
includesAll(gameSource, [
    "import { AccessibilityBridge }",
    'new AccessibilityBridge(renderer?.canvas)',
    'onModalityChange',
    "modality === 'keyboard'",
], 'Game accessibility integration');
ok(read('src/core/RunState.js').includes('this.waveDirector.onAnnounce = (text) => this.accessibility?.announce?.(text)'),
    'wave/boss announcements reach the live status channel');

if (failures) {
    console.error(`Accessibility/input validation: FAILED (${failures}/${checks})`);
    process.exit(1);
}

console.log(`Accessibility/input validation: OK - ${checks} semantic DOM, hotspot, modality, focus, and motion checks.`);
