#!/usr/bin/env node
// Pure phone Settings geometry/render-contract gate. No DOM or browser Canvas
// is booted: the renderer and this validator share the exported layout function,
// then a tiny recording context verifies the phone-only actions and labels that
// the real renderer emits.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load the renderer once with its documented ?dev=1 switch so the recording
// pass covers developer-only phone controls as well as the player surface.
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
let menuModule;
try {
    Object.defineProperty(globalThis, 'location', {
        configurable: true,
        writable: true,
        value: { search: '?dev=1' },
    });
    menuModule = await import('../src/systems/MenuRenderer.js');
} finally {
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    else delete globalThis.location;
}
const {
    MenuRenderer,
    computePhoneSettingsLayout,
    computePhoneAccessibilityLayout,
    phoneToggleLabelLines,
} = menuModule;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'src/systems/MenuRenderer.js'), 'utf8');
const gameSource = fs.readFileSync(path.join(ROOT, 'src/core/Game.js'), 'utf8');
const uiStateSource = fs.readFileSync(path.join(ROOT, 'src/systems/UIStateBuilder.js'), 'utf8');
let checks = 0;
let failures = 0;
const ok = (condition, message) => {
    checks++;
    if (!condition) {
        failures++;
        console.error(`  x ${message}`);
    }
};

const right = (rect) => rect.x + rect.w;
const bottom = (rect) => rect.y + rect.h;
const inside = (rect, outer) => rect.x >= outer.x - 0.01 && rect.y >= outer.y - 0.01
    && right(rect) <= right(outer) + 0.01 && bottom(rect) <= bottom(outer) + 0.01;
const overlap = (a, b) => a.x < right(b) && right(a) > b.x
    && a.y < bottom(b) && bottom(a) > b.y;

const scenarios = [
    {
        name: '844x390 cover-fit phone',
        content: { x: 56, y: 280, w: 1808, h: 664 },
        cssScale: 844 / 1920,
    },
    {
        name: 'landscape phone with notch insets',
        content: { x: 166, y: 280, w: 1588, h: 664 },
        cssScale: 844 / 1920,
    },
    {
        name: '667x375 minimum supported phone',
        content: { x: 56, y: 184, w: 1808, h: 856 },
        cssScale: 667 / 1920,
    },
];

for (const scenario of scenarios) {
    for (const devMode of [false, true]) {
        const name = `${scenario.name}/${devMode ? 'dev' : 'player'}`;
        const layout = computePhoneSettingsLayout(scenario.content, {
            devToggleCount: devMode ? 2 : 0,
            showCheats: devMode,
            cssScale: scenario.cssScale,
        });
        ok(inside(layout.inner, scenario.content), `${name}: inner layout escapes content panel`);
        ok(layout.coreFontPx * scenario.cssScale >= 15.99,
            `${name}: core Settings type falls below 16 CSS pixels`);
        ok(layout.switchH * scenario.cssScale >= 39.99,
            `${name}: visible switch track falls below 40 CSS pixels`);
        ok(layout.switchW * scenario.cssScale >= 60,
            `${name}: visible switch track is too narrow to read as a control`);
        ok(layout.coreLineHeight * 2 <= layout.rowH - 8,
            `${name}: two-line setting labels escape their row`);
        ok(layout.labelWidths.gameplay * scenario.cssScale >= 120,
            `${name}: gameplay labels have less than 120 CSS pixels`);
        ok(layout.labelWidths.support * scenario.cssScale >= 85,
            `${name}: testing labels have less than 85 CSS pixels`);

        const labelSamples = [
            { key: 'screenShake', label: 'Screen Shake', width: layout.labelWidths.gameplay },
            { key: 'damageNumbers', label: 'Damage Numbers', width: layout.labelWidths.gameplay },
            { key: 'particles', label: 'Particles', width: layout.labelWidths.gameplay },
            { key: 'reducedEffects', label: 'Reduce Motion & Effects', width: layout.labelWidths.gameplay },
            { key: 'debug', label: 'Debug Mode', width: layout.labelWidths.support },
            { key: 'unlockMaps', label: 'Unlock All Maps (testing)', width: layout.labelWidths.support },
        ];
        for (const sample of labelSamples) {
            const lines = phoneToggleLabelLines(sample);
            ok(lines.length >= 1 && lines.length <= 2,
                `${name}: ${sample.key} must use one or two contained lines`);
            for (const line of lines) {
                // 0.58em is a conservative width proxy for the shipped bold
                // system face; runtime drawing additionally ellipsizes at the
                // exact measured width as a final containment guard.
                ok(line.length * layout.coreFontPx * 0.58 <= sample.width,
                    `${name}: ${sample.key} line '${line}' exceeds its label allocation`);
            }
        }

        const targets = [
            ...layout.gameplayRows.map((rect, i) => ({ name: `gameplay ${i + 1}`, rect })),
            ...layout.supportRows.map((rect, i) => ({ name: `support ${i + 1}`, rect })),
            ...layout.volumeControls.flatMap((controls, i) => [
                { name: `volume ${i + 1} minus`, rect: controls.minus },
                { name: `volume ${i + 1} plus`, rect: controls.plus },
            ]),
            ...layout.cheatButtons.map((rect, i) => ({ name: `cheat ${i + 1}`, rect })),
        ];
        for (const target of targets) {
            ok(inside(target.rect, layout.inner), `${name}: ${target.name} escapes the safe inner panel`);
            ok(target.rect.w >= 100 && target.rect.h >= 100,
                `${name}: ${target.name} is smaller than 100 logical pixels`);
            ok(target.rect.w * scenario.cssScale >= 43.99 && target.rect.h * scenario.cssScale >= 43.99,
                `${name}: ${target.name} falls below the 44 CSS-pixel phone target`);
        }

        const bodyRows = [...layout.gameplayRows, ...layout.supportRows];
        ok(bodyRows.every((rect) => bottom(rect) <= layout.bodyBottom),
            `${name}: a body row collides with the cheats strip`);
        ok(layout.audioBlocks.every((rect) => rect.y >= layout.bodyTop && bottom(rect) <= layout.bodyBottom),
            `${name}: an audio block escapes the body allocation`);
        ok(layout.volumeControls.every((controls, i) =>
            inside(controls.minus, layout.audioBlocks[i])
            && inside(controls.plus, layout.audioBlocks[i])
            && inside(controls.bar, layout.audioBlocks[i])
            && inside(controls.percent, layout.audioBlocks[i])),
        `${name}: volume controls escape their audio block`);

        for (let i = 0; i < targets.length; i++) {
            for (let j = i + 1; j < targets.length; j++) {
                ok(!overlap(targets[i].rect, targets[j].rect),
                    `${name}: ${targets[i].name} overlaps ${targets[j].name}`);
            }
        }
    }
}

// The nested Accessibility pane has its own two-column allocation. It does not
// consume another General row, so its geometry is identical in player/dev mode
// and the five ?dev controls stay together on General.
for (const scenario of scenarios) {
    const name = `${scenario.name}/accessibility`;
    const layout = computePhoneAccessibilityLayout(scenario.content, {
        cssScale: scenario.cssScale,
    });
    ok(inside(layout.inner, scenario.content), `${name}: inner layout escapes content panel`);
    ok(layout.coreFontPx * scenario.cssScale >= 15.99,
        `${name}: core type falls below 16 CSS pixels`);
    ok(layout.switchH * scenario.cssScale >= 39.99,
        `${name}: visible switch track falls below 40 CSS pixels`);
    ok(layout.labelWidth * scenario.cssScale >= 120,
        `${name}: high-contrast label has less than 120 CSS pixels`);
    ok(layout.supportLabelWidth * scenario.cssScale >= 70,
        `${name}: mono-audio label has less than 70 CSS pixels`);
    for (const [heading, width] of [
        ['READING & DISPLAY', layout.columns.display.w],
        ['AUDIO & FEEDBACK', layout.columns.support.w],
    ]) {
        ok(heading.length * layout.sectionFontPx * 0.58 <= width,
            `${name}: ${heading} header exceeds its intended column width`);
    }
    for (const label of ['REPLAY TUTORIAL', 'BACK TO GENERAL']) {
        ok(label.length * layout.coreFontPx * 0.58 <= layout.columns.support.w - 24,
            `${name}: ${label} would need to shrink below the 16 CSS-pixel type floor`);
    }
    const contrastLines = phoneToggleLabelLines({
        key: 'highContrast', label: 'High Contrast Warnings',
    });
    ok(contrastLines.length === 2, `${name}: High Contrast needs a contained two-line label`);
    for (const line of contrastLines) {
        ok(line.length * layout.coreFontPx * 0.58 <= layout.labelWidth,
            `${name}: High Contrast line '${line}' exceeds its label allocation`);
    }

    const targets = [
        { name: 'captions', rect: layout.captionRow },
        ...layout.detailButtons.map((rect) => ({ name: `caption detail ${rect.value}`, rect })),
        { name: 'high contrast', rect: layout.contrastRow },
        ...layout.scaleButtons.map((rect) => ({ name: `UI scale ${rect.value}`, rect })),
        { name: 'mono audio', rect: layout.monoRow },
        ...layout.vibrationButtons.map((rect) => ({ name: `vibration ${rect.value}`, rect })),
        { name: 'replay tutorial', rect: layout.replay },
        { name: 'back to General', rect: layout.back },
    ];
    for (const target of targets) {
        ok(inside(target.rect, layout.inner), `${name}: ${target.name} escapes the safe inner panel`);
        ok(target.rect.w * scenario.cssScale >= 43.99
            && target.rect.h * scenario.cssScale >= 43.99,
        `${name}: ${target.name} falls below the 44 CSS-pixel phone target`);
    }
    for (let i = 0; i < targets.length; i++) {
        for (let j = i + 1; j < targets.length; j++) {
            ok(!overlap(targets[i].rect, targets[j].rect),
                `${name}: ${targets[i].name} overlaps ${targets[j].name}`);
        }
    }
}

function makeRecordingContext() {
    const texts = [];
    const draws = [];
    return {
        texts, draws, font: '16px sans-serif',
        beginPath() {}, closePath() {}, roundRect() {}, moveTo() {}, lineTo() {},
        quadraticCurveTo() {}, fill() {}, stroke() {}, arc() {},
        save() {}, restore() {}, clip() {}, drawImage() {},
        fillText(value, x = 0, y = 0) {
            const text = String(value);
            texts.push(text);
            draws.push({ text, x, y, font: this.font });
        },
        measureText(value) {
            const px = Number(/([0-9.]+)px/.exec(this.font || '')?.[1]) || 16;
            return { width: String(value).length * px * 0.58 };
        },
    };
}

function fontPx(draw) {
    return Number(/([0-9.]+)px/.exec(draw?.font || '')?.[1]) || 0;
}

// Exercise the actual phone renderer with DEV_MODE enabled. Its visual button
// primitive is replaced only to avoid image/font dependencies; it still routes
// every enabled action through MenuRenderer._hot, including the exact accessible
// label supplied by the phone call site.
const phoneRenderer = new MenuRenderer({
    cssWidth: 844,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
});
phoneRenderer._button = function recordPhoneButton(_ctx, rect, label, options = {}) {
    if (!options.action || options.enabled === false) return;
    const hotspotLabel = options.accessibleLabel === undefined ? label : options.accessibleLabel;
    this._hot(rect.x, rect.y, rect.w, rect.h, options.action, options.arg, hotspotLabel);
};
const phoneContext = makeRecordingContext();
const settingsState = {
    saveData: {
        settings: {
            screenShake: true,
            damageNumbers: true,
            particles: true,
            reducedEffects: true,
            highContrast: true,
            uiScale: 115,
            captions: true,
            captionDetail: 'essential',
            monoAudio: true,
            vibration: 'low',
            // Keep both off so their presence proves the ?dev=1 gate, not the
            // legacy safety path that exposes an already-enabled dev toggle.
            debug: false,
            unlockMaps: false,
            volMusic: 0.7,
            volSfx: 0.8,
            volVoice: 0.6,
        },
    },
    vibrationSupported: true,
    resetConfirming: false,
};
const requiredDevActions = [
    ['toggleSetting', 'debug'],
    ['toggleSetting', 'unlockMaps'],
    ['cheatCoins', 1000],
    ['cheatCoins', 10000],
    ['cheatUnlockAll', null],
];

// Bind the pure allocations back to the real renderers at every supported
// phone fixture. These passes use the production button primitive so both the
// hotspot rectangles and fitted visual labels are under test.
for (const scenario of scenarios) {
    const actualRenderer = new MenuRenderer({
        cssWidth: scenario.cssScale * 1920,
        safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    const generalContext = makeRecordingContext();
    actualRenderer._drawPhoneSettings(generalContext, settingsState, scenario.content);
    const generalLayout = computePhoneSettingsLayout(scenario.content, {
        devToggleCount: 2, showCheats: true, cssScale: scenario.cssScale,
    });
    const generalHotspots = [...actualRenderer.hotspots];
    ok(generalHotspots.length === 17,
        `${scenario.name}: real ?dev=1 General emitted ${generalHotspots.length} controls instead of 17`);
    for (const hotspot of generalHotspots) {
        ok(inside(hotspot, generalLayout.inner),
            `${scenario.name}: rendered General ${hotspot.action}/${String(hotspot.arg)} escapes its inner panel`);
        ok(hotspot.w * scenario.cssScale >= 43.99 && hotspot.h * scenario.cssScale >= 43.99,
            `${scenario.name}: rendered General ${hotspot.action}/${String(hotspot.arg)} is below 44 CSS pixels`);
    }
    for (let i = 0; i < generalHotspots.length; i++) {
        for (let j = i + 1; j < generalHotspots.length; j++) {
            ok(!overlap(generalHotspots[i], generalHotspots[j]),
                `${scenario.name}: rendered General controls ${i + 1}/${j + 1} overlap`);
        }
    }
    for (const [action, arg] of requiredDevActions) {
        ok(generalHotspots.some((hotspot) => hotspot.action === action && hotspot.arg === arg),
            `${scenario.name}: real ?dev=1 General lost ${action}/${String(arg)}`);
    }

    actualRenderer.hotspots = [];
    const accessibilityContext = makeRecordingContext();
    const accessibilityState = { ...settingsState, settingsPane: 'accessibility' };
    actualRenderer._drawPhoneAccessibility(
        accessibilityContext, accessibilityState, scenario.content,
    );
    const accessLayout = computePhoneAccessibilityLayout(scenario.content, {
        cssScale: scenario.cssScale,
    });
    const accessHotspots = [...actualRenderer.hotspots];
    ok(accessHotspots.length === 13,
        `${scenario.name}: real Accessibility emitted ${accessHotspots.length} controls instead of 13`);
    for (const hotspot of accessHotspots) {
        ok(inside(hotspot, accessLayout.inner),
            `${scenario.name}: rendered Accessibility ${hotspot.action}/${String(hotspot.arg)} escapes its inner panel`);
        ok(hotspot.w * scenario.cssScale >= 43.99 && hotspot.h * scenario.cssScale >= 43.99,
            `${scenario.name}: rendered Accessibility ${hotspot.action}/${String(hotspot.arg)} is below 44 CSS pixels`);
    }
    for (let i = 0; i < accessHotspots.length; i++) {
        for (let j = i + 1; j < accessHotspots.length; j++) {
            ok(!overlap(accessHotspots[i], accessHotspots[j]),
                `${scenario.name}: rendered Accessibility controls ${i + 1}/${j + 1} overlap`);
        }
    }
    ok(requiredDevActions.every(([action, arg]) =>
        !accessHotspots.some((hotspot) => hotspot.action === action && hotspot.arg === arg)),
    `${scenario.name}: developer controls leaked from General into Accessibility`);

    const headerWidths = new Map([
        ['READING & DISPLAY', accessLayout.columns.display.w],
        ['AUDIO & FEEDBACK', accessLayout.columns.support.w],
    ]);
    for (const [heading, width] of headerWidths) {
        const draw = accessibilityContext.draws.find((entry) => entry.text === heading);
        ok(!!draw && fontPx(draw) * scenario.cssScale >= 12.99,
            `${scenario.name}: rendered ${heading} header is missing or below 13 CSS pixels`);
        ok(!!draw && heading.length * fontPx(draw) * 0.58 <= width,
            `${scenario.name}: rendered ${heading} header exceeds its intended column`);
    }
    for (const [label, action, arg] of [
        ['REPLAY TUTORIAL', 'replayTutorial', null],
        ['BACK TO GENERAL', 'settingsPane', 'general'],
    ]) {
        const draw = accessibilityContext.draws.find((entry) => entry.text === label);
        const hotspot = accessHotspots.find((entry) => entry.action === action && entry.arg === arg);
        ok(!!draw && fontPx(draw) * scenario.cssScale >= 15.99,
            `${scenario.name}: rendered ${label} falls below the 16 CSS-pixel type floor`);
        ok(!!draw && !!hotspot && label.length * fontPx(draw) * 0.58 <= hotspot.w - 24,
            `${scenario.name}: rendered ${label} exceeds its control width`);
    }
    ok(accessibilityContext.texts.includes('\u2713 HUD 115%'),
        `${scenario.name}: real Accessibility lost the selected UI-size check marker`);
}
phoneRenderer._drawPhoneSettings(phoneContext, settingsState, scenarios[0].content);

const emitted = phoneRenderer.hotspots;
const expectedHotspots = [
    ['toggleSetting', 'screenShake', 'Screen Shake'],
    ['toggleSetting', 'damageNumbers', 'Damage Numbers'],
    ['toggleSetting', 'particles', 'Particles'],
    ['toggleSetting', 'reducedEffects', 'Reduce Motion & Effects'],
    ['volDown', 'volMusic', 'Decrease Music Volume'],
    ['volUp', 'volMusic', 'Increase Music Volume'],
    ['volDown', 'volSfx', 'Decrease SFX Volume'],
    ['volUp', 'volSfx', 'Increase SFX Volume'],
    ['volDown', 'volVoice', 'Decrease Voice Volume'],
    ['volUp', 'volVoice', 'Increase Voice Volume'],
    ['settingsPane', 'accessibility', 'Open Accessibility and Display settings'],
    ['resetSave', undefined, 'RESET SAVE'],
    ['toggleSetting', 'debug', 'Debug Mode'],
    ['toggleSetting', 'unlockMaps', 'Unlock All Maps (testing)'],
    ['cheatCoins', 1000, '+1,000 ◎'],
    ['cheatCoins', 10000, '+10,000 ◎'],
    ['cheatUnlockAll', null, 'UNLOCK ALL ITEMS'],
];
ok(emitted.length === expectedHotspots.length,
    `phone Settings emitted ${emitted.length} hotspots; expected ${expectedHotspots.length}`);
for (const [action, arg, label] of expectedHotspots) {
    ok(emitted.some((hotspot) => hotspot.action === action
        && hotspot.arg === arg && hotspot.label === label),
    `phone Settings did not emit ${action}/${String(arg)} as '${label}'`);
}
ok(emitted.every((hotspot) => hotspot.key && hotspot.baseKey && hotspot.label
    && hotspot.w > 0 && hotspot.h > 0),
'phone Settings emitted an unkeyed, unlabeled, or empty hotspot');
for (const label of ['MUSIC', 'SFX', 'VOICE']) {
    ok(phoneContext.texts.includes(label), `phone Settings did not draw the ${label} mix label`);
}

// Exercise the actual Accessibility renderer and its non-colour scale state.
phoneRenderer.hotspots = [];
const accessibilityContext = makeRecordingContext();
const accessibilityState = { ...settingsState, settingsPane: 'accessibility' };
phoneRenderer._drawPhoneAccessibility(
    accessibilityContext, accessibilityState, scenarios[0].content,
);
const accessibilityHotspots = phoneRenderer.hotspots;
const expectedAccessibilityHotspots = [
    ['toggleSetting', 'captions', 'Captions'],
    ['setCaptionDetail', 'essential', 'Set caption detail to essential, selected'],
    ['setCaptionDetail', 'full', 'Set caption detail to full'],
    ['toggleSetting', 'highContrast', 'High Contrast Warnings'],
    ['setUiScale', 100, 'Set combat HUD size to 100 percent'],
    ['setUiScale', 115, 'Set combat HUD size to 115 percent, selected'],
    ['setUiScale', 130, 'Set combat HUD size to 130 percent'],
    ['toggleSetting', 'monoAudio', 'Mono Audio'],
    ['setVibration', 'off', 'Set vibration to off'],
    ['setVibration', 'low', 'Set vibration to low, selected'],
    ['setVibration', 'full', 'Set vibration to full'],
    ['replayTutorial', undefined, 'REPLAY TUTORIAL'],
    ['settingsPane', 'general', 'Back to General settings'],
];
ok(accessibilityHotspots.length === expectedAccessibilityHotspots.length,
    `phone Accessibility emitted ${accessibilityHotspots.length} hotspots; expected ${expectedAccessibilityHotspots.length}`);
for (const [action, arg, label] of expectedAccessibilityHotspots) {
    ok(accessibilityHotspots.some((hotspot) => hotspot.action === action
        && hotspot.arg === arg && hotspot.label === label),
    `phone Accessibility did not emit ${action}/${String(arg)} as '${label}'`);
}
ok(accessibilityHotspots.every((hotspot) => hotspot.key && hotspot.baseKey && hotspot.label
    && hotspot.w > 0 && hotspot.h > 0),
'phone Accessibility emitted an unkeyed, unlabeled, or empty hotspot');
ok(accessibilityContext.texts.includes('\u2713 HUD 115%'),
    'selected UI scale lacks its non-colour check marker');
ok(!accessibilityContext.texts.includes('\u2713 HUD 100%')
    && !accessibilityContext.texts.includes('\u2713 HUD 130%'),
'an unselected UI scale incorrectly received the selected marker');

// Preserve the developer Settings surface on desktop as well as phone. The
// production module was imported with ?dev=1 above, so this exercises the real
// DEV_MODE branch while replacing only visual helpers that need browser assets.
const desktopRenderer = new MenuRenderer({
    cssWidth: 1280,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
});
desktopRenderer._contentRect = () => ({ x: 56, y: 184, w: 1808, h: 856 });
desktopRenderer._panel = () => {};
desktopRenderer._settingsHeader = (_ctx, _x, _w, y) => y + 36;
desktopRenderer._wrapText = () => {};
desktopRenderer._button = function recordDesktopButton(_ctx, rect, label, options = {}) {
    if (!options.action || options.enabled === false) return;
    const hotspotLabel = options.accessibleLabel === undefined ? label : options.accessibleLabel;
    this._hot(rect.x, rect.y, rect.w, rect.h, options.action, options.arg, hotspotLabel);
};
desktopRenderer._drawSettings(makeRecordingContext(), settingsState);
const desktopDevActions = requiredDevActions;
for (const [action, arg] of desktopDevActions) {
    ok(desktopRenderer.hotspots.some((hotspot) => hotspot.action === action && hotspot.arg === arg),
        `desktop ?dev=1 Settings did not retain ${action}/${String(arg)}`);
}

desktopRenderer.hotspots = [];
const desktopAccessibilityContext = makeRecordingContext();
desktopRenderer._drawSettings(desktopAccessibilityContext, accessibilityState);
for (const [action, arg, label] of expectedAccessibilityHotspots) {
    ok(desktopRenderer.hotspots.some((hotspot) => hotspot.action === action
        && hotspot.arg === arg && hotspot.label === label),
    `desktop Accessibility did not emit ${action}/${String(arg)} as '${label}'`);
}
ok(desktopAccessibilityContext.texts.includes('\u2713 115%'),
    'desktop selected UI scale lacks its non-colour check marker');

// Run one unmocked desktop Accessibility layout pass. Only the outer panel is
// suppressed (it needs gradients/assets); headers, choices, buttons, labels,
// and hotspots use their production drawing paths.
const desktopContent = { x: 56, y: 184, w: 1808, h: 856 };
const desktopScale = 1280 / 1920;
const desktopLayoutRenderer = new MenuRenderer({
    cssWidth: 1280,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
});
desktopLayoutRenderer._contentRect = () => desktopContent;
desktopLayoutRenderer._panel = () => {};
const desktopLayoutContext = makeRecordingContext();
desktopLayoutRenderer._drawSettings(desktopLayoutContext, accessibilityState);
const desktopAccessHotspots = desktopLayoutRenderer.hotspots;
ok(desktopAccessHotspots.length === 13,
    `desktop Accessibility emitted ${desktopAccessHotspots.length} controls instead of 13`);
for (const hotspot of desktopAccessHotspots) {
    ok(inside(hotspot, desktopContent),
        `desktop Accessibility ${hotspot.action}/${String(hotspot.arg)} escapes its panel`);
    ok(hotspot.w * desktopScale >= 43.99 && hotspot.h * desktopScale >= 43.99,
        `desktop Accessibility ${hotspot.action}/${String(hotspot.arg)} is below 44 CSS pixels`);
}
for (let i = 0; i < desktopAccessHotspots.length; i++) {
    for (let j = i + 1; j < desktopAccessHotspots.length; j++) {
        ok(!overlap(desktopAccessHotspots[i], desktopAccessHotspots[j]),
            `desktop Accessibility controls ${i + 1}/${j + 1} overlap`);
    }
}
ok(requiredDevActions.every(([action, arg]) =>
    !desktopAccessHotspots.some((hotspot) => hotspot.action === action && hotspot.arg === arg)),
'desktop developer controls leaked from General into Accessibility');
const desktopInnerW = desktopContent.w - 80;
const desktopColW = (desktopInnerW - 56) / 2;
for (const heading of [
    'READING & DISPLAY', 'CAPTION DETAIL', 'VISUAL WARNINGS',
    'COMBAT HUD SIZE', 'AUDIO & FEEDBACK', 'VIBRATION', 'HELP & NAVIGATION',
]) {
    const draw = desktopLayoutContext.draws.find((entry) => entry.text === heading);
    ok(!!draw && heading.length * fontPx(draw) * 0.58 <= desktopColW,
        `desktop ${heading} header exceeds its intended column width`);
}
for (const [label, action, arg] of [
    ['REPLAY TUTORIAL', 'replayTutorial', null],
    ['BACK TO GENERAL SETTINGS', 'settingsPane', 'general'],
]) {
    const draw = desktopLayoutContext.draws.find((entry) => entry.text === label);
    const hotspot = desktopAccessHotspots.find((entry) => entry.action === action && entry.arg === arg);
    ok(!!draw && fontPx(draw) * desktopScale >= 15.99,
        `desktop ${label} falls below the 16 CSS-pixel type floor`);
    ok(!!draw && !!hotspot && label.length * fontPx(draw) * 0.58 <= hotspot.w - 24,
        `desktop ${label} exceeds its control width`);
}
const desktopContrastDraw = desktopLayoutContext.draws.find(
    (entry) => entry.text === 'High Contrast Warnings',
);
const desktopContrastHotspot = desktopAccessHotspots.find(
    (entry) => entry.action === 'toggleSetting' && entry.arg === 'highContrast',
);
ok(!!desktopContrastDraw && !!desktopContrastHotspot
    && 'High Contrast Warnings'.length * fontPx(desktopContrastDraw) * 0.58
        <= desktopContrastHotspot.w - 140,
'desktop High Contrast label collides with its switch allocation');
ok(desktopLayoutContext.texts.includes('\u2713 115%'),
    'unmocked desktop selected UI scale lacks its non-colour check marker');

const buttonProbe = new MenuRenderer({
    cssWidth: 844,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
});
buttonProbe._button(makeRecordingContext(), { x: 0, y: 0, w: 180, h: 100 }, '−', {
    action: 'volDown', arg: 'volMusic', accessibleLabel: 'Decrease Music Volume',
});
ok(buttonProbe.hotspots[0]?.label === 'Decrease Music Volume',
    'button primitive did not preserve the phone call site accessible label');

ok(source.includes('(this.renderer.cssWidth ?? INTERNAL_WIDTH) < 900'),
    'Settings must switch layout from renderer.cssWidth below 900px');
const drawSettingsStart = source.indexOf('    _drawSettings(ctx, state) {');
const drawSettingsEnd = source.indexOf('// â”€â”€ CASE OPENING', drawSettingsStart);
const drawSettingsSource = source.slice(drawSettingsStart, drawSettingsEnd);
ok(drawSettingsSource.indexOf("this._drawPhoneSettings(ctx, state, c);")
    < drawSettingsSource.indexOf('const innerX = c.x + 40;'),
    'phone layout must return before the unchanged desktop columns');
ok(source.includes('const coreFontPx = Math.max(36, Math.ceil(16 / cssScale))'),
    'phone core labels must preserve a 16 CSS-pixel type floor');
ok(source.includes('const switchH = Math.max(84, rowH - 8)'),
    'visible switch height must scale with the phone action row');
ok(source.includes("state.settingsPane === 'accessibility'"),
    'Settings renderer must route the session Accessibility pane explicitly');
ok(gameSource.includes("this.settingsPane = 'general'"),
    'Game must initialize Settings on the General pane');
ok(gameSource.includes("this.menuTab === 'settings'")
    && gameSource.includes("this.settingsPane === 'accessibility'")
    && gameSource.includes("this.settingsPane = 'general'"),
'Escape must return Accessibility to General before leaving Settings');
ok(uiStateSource.includes("base.settingsPane = game.settingsPane === 'accessibility'"),
    'UI state must pass the sanitized session Settings pane to MenuRenderer');

if (failures) {
    console.error(`\nPhone Settings validation failed: ${failures}/${checks} checks.`);
    process.exit(1);
}
console.log(`Phone Settings validation passed: ${checks} checks across ${scenarios.length * 3} layout fixtures plus real phone/desktop render passes.`);
