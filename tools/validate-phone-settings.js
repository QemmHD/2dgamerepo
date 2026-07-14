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
const { MenuRenderer, computePhoneSettingsLayout, phoneToggleLabelLines } = menuModule;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'src/systems/MenuRenderer.js'), 'utf8');
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

function makeRecordingContext() {
    const texts = [];
    return {
        texts,
        beginPath() {}, closePath() {}, roundRect() {}, moveTo() {}, lineTo() {},
        quadraticCurveTo() {}, fill() {}, stroke() {}, arc() {},
        save() {}, restore() {}, clip() {}, drawImage() {},
        fillText(value) { texts.push(String(value)); },
        measureText(value) { return { width: String(value).length * 14 }; },
    };
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
phoneRenderer._drawPhoneSettings(phoneContext, {
    saveData: {
        settings: {
            screenShake: true,
            damageNumbers: true,
            particles: true,
            reducedEffects: true,
            debug: true,
            unlockMaps: true,
            volMusic: 0.7,
            volSfx: 0.8,
        },
    },
    resetConfirming: false,
}, scenarios[0].content);

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
    ['replayTutorial', undefined, 'REPLAY TUTORIAL'],
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
for (const label of ['Music Volume', 'SFX Volume']) {
    ok(phoneContext.texts.includes(label), `phone Settings did not draw the ${label} heading`);
}

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
ok(source.indexOf("this._drawPhoneSettings(ctx, state, c);") < source.indexOf('const innerX = c.x + 40;'),
    'phone layout must return before the unchanged desktop columns');
ok(source.includes('const coreFontPx = Math.max(36, Math.ceil(16 / cssScale))'),
    'phone core labels must preserve a 16 CSS-pixel type floor');
ok(source.includes('const switchH = Math.max(84, rowH - 8)'),
    'visible switch height must scale with the phone action row');

if (failures) {
    console.error(`\nPhone Settings validation failed: ${failures}/${checks} checks.`);
    process.exit(1);
}
console.log(`Phone Settings validation passed: ${checks} checks across ${scenarios.length * 2} layouts.`);
