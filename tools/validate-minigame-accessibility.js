#!/usr/bin/env node
// Focused regression checks for the reduced-effects and keyboard presentation
// owned by MinigameOverlay. Run from the repository root:
//   node tools/validate-minigame-accessibility.js

import assert from 'node:assert/strict';
import { MinigameOverlay } from '../src/systems/MinigameOverlay.js';
import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../src/config/GameConfig.js';

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };

function makeGame({ reducedEffects = true, modality = 'keyboard' } = {}) {
    const audio = { reveals: 0, ticks: 0 };
    return {
        reducedEffects: false,
        minesFocusIndex: 0,
        saveSystem: { getSetting: (key) => key === 'reducedEffects' && reducedEffects },
        input: { getModality: () => modality },
        audio: {
            reveal: () => { audio.reveals++; },
            spinTick: () => { audio.ticks++; },
        },
        _audioTest: audio,
    };
}

function makeContext() {
    const strokes = [], texts = [], scales = [], translations = [], fillRects = [], arcs = [];
    const gradient = { addColorStop() {} };
    const ctx = {
        strokes, texts, scales, translations, fillRects, arcs,
        globalAlpha: 1,
        save() {}, restore() {}, beginPath() {}, closePath() {}, clip() {},
        roundRect() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {},
        fill() {},
        stroke() { strokes.push({ style: this.strokeStyle, width: this.lineWidth }); },
        fillRect(...args) { fillRects.push(args); },
        fillText(text) { texts.push({ text, font: this.font }); },
        drawImage() {},
        translate(...args) { translations.push(args); },
        scale(...args) { scales.push(args); },
        arc(...args) { arcs.push(args); },
        createLinearGradient() { return gradient; },
        createRadialGradient() { return gradient; },
    };
    return ctx;
}

function activeMines() {
    return {
        bet: 100,
        mineSet: [19, 20, 21, 22, 23, 24],
        revealed: [0], safeRevealed: 1, mul: 1.23,
        stopped: false, busted: false, cashed: false, result: null, age: 0,
        revealTimes: { 0: 0 }, bustIdx: null, stopFxT: 0,
        mulPrev: 1, mulPopT: 0,
    };
}

// The live menu setting is authoritative in both directions; a stale run flag
// cannot keep reduced effects enabled after the player turns the setting off.
{
    const game = makeGame({ reducedEffects: false });
    game.reducedEffects = true;
    const overlay = new MinigameOverlay(game);
    check(overlay._reducedEffects() === false,
        'explicit saved false was overridden by stale Game.reducedEffects');
    check(overlay._reducedEffects({ reducedEffects: true }) === true,
        'explicit render snapshot did not override the saved preference');
}

// A case already in motion must collapse to one stable, post-reveal frame when
// Reduced Effects becomes active. It announces the result once and never ticks.
{
    const game = makeGame();
    const overlay = new MinigameOverlay(game);
    overlay.caseAnim = {
        age: 0.15, spinTime: 4.2, settleHold: 0.52, tier: 3,
        result: { rarity: 'epic' },
    };
    overlay.update(0.016);
    check(overlay.caseAnim.age === 1 && overlay.caseAnim.spinTime === 0
        && overlay.caseAnim.settleHold === 0,
    'reduced-effects case did not land on its stable reveal frame');
    check(game._audioTest.reveals === 1 && game._audioTest.ticks === 0,
        'reduced-effects case reveal audio was missing or decorative ticks continued');
    overlay.update(1);
    check(overlay.caseAnim.age === 1 && game._audioTest.reveals === 1,
        'reduced-effects case frame moved or replayed its reveal');
}

// The state snapshot controls keyboard focus and help. Reduced mode uses a
// fixed multiplier size/glow and a 1:1 safe-gem scale (no pop animation).
{
    const game = makeGame();
    const overlay = new MinigameOverlay(game);
    overlay.mines = activeMines();
    overlay._menuClock = 0.03;
    const embers = [];
    overlay._mEmber = (_ctx, _x, _y, radius, _color, alpha) => embers.push({ radius, alpha });
    const ctx = makeContext();
    overlay.drawMines(ctx, {
        reducedEffects: true,
        inputModality: 'keyboard',
        minesFocusIndex: 7,
    });
    check(ctx.scales.some(([x, y]) => x === 1 && y === 1),
        'reduced-effects safe gem is not rendered at a static 1:1 scale');
    check(embers.some(({ radius }) => radius === 92),
        'reduced-effects multiplier glow retained its animated pop size');
    check(ctx.strokes.filter(({ style }) => style === '#ffffff').length >= 5,
        'focused Mines cell lacks the non-color white outline/brackets');
    check(ctx.texts.some(({ text }) => text.includes('Arrows move')
        && text.includes('Enter reveals') && text.includes('Space cashes out')),
    'keyboard Mines instructions do not expose the available controls');

    const pointerCtx = makeContext();
    overlay.drawMines(pointerCtx, {
        reducedEffects: true,
        inputModality: 'pointer',
        minesFocusIndex: 7,
    });
    check(pointerCtx.texts.some(({ text }) => text.includes('Tap tiles to dig'))
        && !pointerCtx.texts.some(({ text }) => text.includes('Arrows move')),
    'pointer Mines instructions or modality-specific focus scope regressed');
}

// A bust in reduced mode must not touch randomness (shake), emit a shock-ring
// arc, or add the second full-screen fill used by the red flash.
{
    const game = makeGame();
    const overlay = new MinigameOverlay(game);
    overlay.mines = {
        ...activeMines(), mineSet: [0, 20, 21, 22, 23, 24], revealed: [0],
        safeRevealed: 0, mul: 1, stopped: true, busted: true, bustIdx: 0,
        result: { mul: 0, payout: 0, net: -100 },
    };
    overlay._menuClock = 0.1;
    overlay._mEmber = () => {};
    const ctx = makeContext();
    const random = Math.random;
    Math.random = () => { throw new Error('reduced-effects bust requested shake randomness'); };
    try {
        overlay.drawMines(ctx, {
            reducedEffects: true,
            inputModality: 'keyboard',
            minesFocusIndex: 0,
        });
    } finally {
        Math.random = random;
    }
    check(ctx.translations[0]?.[0] === 0 && ctx.translations[0]?.[1] === 0,
        'reduced-effects bust translated the vault');
    check(ctx.arcs.length === 0, 'reduced-effects bust still drew an expanding shock ring');
    check(ctx.fillRects.filter(([x, y, w, h]) => x === 0 && y === 0
        && w === INTERNAL_WIDTH && h === INTERNAL_HEIGHT).length === 1,
        'reduced-effects bust still drew the animated full-screen flash');
    check(ctx.texts.some(({ text }) => text.includes('Enter / Space continues')
        && text.includes('Esc closes')),
    'stopped keyboard Mines instructions omit continue/close controls');
}

console.log(`Minigame accessibility validation passed: ${checks} checks.`);
