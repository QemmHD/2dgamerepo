#!/usr/bin/env node
// Deterministic save-default gate for the First Light reduced-motion contract.
// Fresh/reset/corrupt profiles inherit the OS preference; validation of a real
// existing save deliberately keeps the historical false fallback when the
// reducedEffects field is absent or invalid.

import { SaveSystem } from '../src/systems/SaveSystem.js';
import {
    CAPTION_DETAIL_PRESETS,
    DEFAULT_CAPTION_DETAIL,
    DEFAULT_UI_SCALE,
    DEFAULT_VIBRATION_STRENGTH,
    UI_SCALE_PRESETS,
    VIBRATION_STRENGTH_PRESETS,
    normalizeCaptionDetail,
    normalizeCaptions,
    normalizeHighContrast,
    normalizeMonoAudio,
    normalizeUiScale,
    normalizeVibrationStrength,
    uiScaleFactor,
} from '../src/systems/AccessibilityPreferences.js';

const SAVE_KEY = 'monkey-survivor:save:v1';
const MOTION_QUERY = '(prefers-reduced-motion: reduce)';

let checks = 0;
let failures = 0;
const ok = (condition, message) => {
    checks++;
    if (!condition) {
        failures++;
        console.error(`  x ${message}`);
    }
};

class MemoryStorage {
    constructor(raw) {
        this.values = new Map();
        if (raw !== undefined) this.values.set(SAVE_KEY, raw);
        this.throwOnRead = false;
    }
    getItem(key) {
        if (this.throwOnRead && key === SAVE_KEY) throw new Error('read blocked');
        return this.values.has(key) ? this.values.get(key) : null;
    }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWarn = console.warn;

function setGlobal(name, value) {
    Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value,
    });
}

function clearGlobal(name) {
    try { delete globalThis[name]; } catch (e) { setGlobal(name, undefined); }
}

function restoreGlobal(name, descriptor) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else clearGlobal(name);
}

function mediaWindow(matches, queries = null) {
    return {
        matchMedia(query) {
            if (queries) queries.push(query);
            return { matches: query === MOTION_QUERY && matches === true };
        },
    };
}

function existingRaw(settings) {
    return JSON.stringify({ totalCoins: 321, settings });
}

ok(DEFAULT_UI_SCALE === 100, 'UI scale default is exactly 100 percent');
ok(Object.isFrozen(UI_SCALE_PRESETS)
    && UI_SCALE_PRESETS.join(',') === '100,115,130',
'UI scale presets are the immutable 100/115/130 contract');
ok(DEFAULT_CAPTION_DETAIL === 'essential'
    && CAPTION_DETAIL_PRESETS.join(',') === 'essential,full',
'caption detail presets are the immutable Essential/Full contract');
ok(DEFAULT_VIBRATION_STRENGTH === 'low'
    && VIBRATION_STRENGTH_PRESETS.join(',') === 'off,low,full',
'vibration presets are the immutable Off/Low/Full contract');
ok(normalizeMonoAudio(true) === true && normalizeMonoAudio('true') === false,
'mono audio accepts only literal true');
ok(normalizeCaptions(true) === true && normalizeCaptions(1) === false,
'captions accept only literal true');
ok(normalizeCaptionDetail('full') === 'full' && normalizeCaptionDetail('FULL') === 'essential',
'caption detail strictly repairs unsupported values');
ok(normalizeVibrationStrength('off') === 'off' && normalizeVibrationStrength(true) === 'low',
'vibration strength strictly repairs unsupported values');
for (const scale of UI_SCALE_PRESETS) {
    ok(normalizeUiScale(scale) === scale, `UI scale normalizer preserves ${scale} percent`);
    ok(uiScaleFactor(scale) === scale / 100,
        `UI scale ${scale} percent converts to an exact HUD layout factor`);
}
ok(uiScaleFactor(129) === 1,
    'unsupported UI scale converts to the safe 100-percent HUD layout factor');
for (const value of [undefined, null, false, true, '130', 1.15, 99, 101, 114, 116, 129, 131, 1000, {}, []]) {
    ok(normalizeUiScale(value) === DEFAULT_UI_SCALE,
        `unsupported UI scale ${JSON.stringify(value)} falls back to 100 percent`);
}
ok(normalizeHighContrast(true) === true,
    'strict high-contrast normalizer preserves literal true');
for (const value of [undefined, null, false, 0, 1, 'true', {}, []]) {
    ok(normalizeHighContrast(value) === false,
        `high contrast rejects non-true value ${JSON.stringify(value)}`);
}

try {
    // Expected storage failures are part of the contract, not noisy test output.
    console.warn = () => {};

    const queries = [];
    setGlobal('window', mediaWindow(true, queries));
    const freshStorage = new MemoryStorage();
    setGlobal('localStorage', freshStorage);
    const freshReduced = new SaveSystem();
    ok(freshReduced.getSetting('reducedEffects') === true,
        'fresh stored profile inherits an enabled OS reduced-motion preference');
    ok(freshReduced.getSetting('uiScale') === 100
        && freshReduced.getSetting('highContrast') === false,
    'fresh profile receives safe UI-scale and high-contrast defaults');
    ok(queries.length === 1 && queries[0] === MOTION_QUERY,
        'fresh profile queries the exact prefers-reduced-motion media feature once');

    setGlobal('window', mediaWindow(false));
    setGlobal('localStorage', new MemoryStorage());
    const freshFullMotion = new SaveSystem();
    ok(freshFullMotion.getSetting('reducedEffects') === false,
        'fresh stored profile stays full-motion when the OS preference is off');
    ok(freshFullMotion.getSetting('uiScale') === 100
        && freshFullMotion.getSetting('highContrast') === false,
    'fresh full-motion profile keeps independent accessibility defaults');

    // Storage-unavailable play is an in-memory fresh profile and must inherit too.
    setGlobal('window', mediaWindow(true));
    clearGlobal('localStorage');
    ok(new SaveSystem().getSetting('reducedEffects') === true,
        'fresh in-memory profile inherits the OS preference without localStorage');

    // Both malformed JSON and structurally invalid JSON are corrupt profiles.
    setGlobal('localStorage', new MemoryStorage('{broken-json'));
    const malformedSave = new SaveSystem();
    ok(malformedSave.getSetting('reducedEffects') === true,
        'malformed stored JSON resets with the OS preference');
    ok(malformedSave.getSetting('uiScale') === 100
        && malformedSave.getSetting('highContrast') === false,
    'malformed stored JSON resets the new preferences safely');
    setGlobal('localStorage', new MemoryStorage('null'));
    ok(new SaveSystem().getSetting('reducedEffects') === true,
        'valid JSON null is treated as corrupt and resets with the OS preference');
    setGlobal('localStorage', new MemoryStorage('[]'));
    ok(new SaveSystem().getSetting('reducedEffects') === true,
        'valid JSON array is treated as corrupt and resets with the OS preference');

    // A read failure after a successful storage probe also falls back in memory.
    const blockedRead = new MemoryStorage();
    blockedRead.throwOnRead = true;
    setGlobal('localStorage', blockedRead);
    ok(new SaveSystem().getSetting('reducedEffects') === true,
        'storage read failure creates an OS-inheriting in-memory profile');

    // Existing explicit preferences always win over the current OS preference.
    setGlobal('window', mediaWindow(true));
    setGlobal('localStorage', new MemoryStorage(existingRaw({ reducedEffects: false })));
    ok(new SaveSystem().getSetting('reducedEffects') === false,
        'existing explicit full-motion preference survives OS reduced motion');
    setGlobal('window', mediaWindow(false));
    setGlobal('localStorage', new MemoryStorage(existingRaw({ reducedEffects: true })));
    ok(new SaveSystem().getSetting('reducedEffects') === true,
        'existing explicit reduced-effects preference survives OS full motion');

    // Every documented UI scale and explicit high-contrast choice must survive
    // normalization, persistence, and a second constructor exactly.
    for (const scale of UI_SCALE_PRESETS) {
        const storage = new MemoryStorage(existingRaw({
            reducedEffects: false,
            uiScale: scale,
            highContrast: true,
        }));
        setGlobal('localStorage', storage);
        const first = new SaveSystem();
        ok(first.getSetting('uiScale') === scale
            && first.getSetting('highContrast') === true,
        `stored ${scale}% UI scale and high contrast validate exactly`);
        first.save();
        const second = new SaveSystem();
        ok(second.getSetting('uiScale') === scale
            && second.getSetting('highContrast') === true,
        `stored ${scale}% UI scale and high contrast survive reload`);
    }
    const contrastOffStorage = new MemoryStorage(existingRaw({
        uiScale: 130,
        highContrast: false,
    }));
    setGlobal('localStorage', contrastOffStorage);
    const contrastOff = new SaveSystem();
    ok(contrastOff.getSetting('uiScale') === 130
        && contrastOff.getSetting('highContrast') === false,
    'explicit high-contrast off validates independently of a large HUD size');
    contrastOff.save();
    ok(new SaveSystem().getSetting('highContrast') === false,
        'explicit high-contrast off survives reload');

    // The fixed-shape settings normalizer must add safe defaults to an old save
    // without losing historical player settings. The old persisted map bypass
    // is deliberately dropped because it is session-only in save v10.
    const legacyStorage = new MemoryStorage(existingRaw({
        screenShake: false,
        debug: true,
        damageNumbers: false,
        particles: false,
        reducedEffects: true,
        volMusic: 0.35,
        volSfx: 0.65,
        unlockMaps: true,
    }));
    setGlobal('localStorage', legacyStorage);
    const legacy = new SaveSystem();
    ok(legacy.getSetting('uiScale') === 100
        && legacy.getSetting('highContrast') === false
        && legacy.getSetting('monoAudio') === false
        && legacy.getSetting('captions') === true
        && legacy.getSetting('captionDetail') === 'essential'
        && legacy.getSetting('vibration') === 'low'
        && legacy.getSetting('volVoice') === 0.65,
    'old save missing preference keys receives safe additive defaults');
    ok(legacy.data.totalCoins === 321
        && legacy.getSetting('screenShake') === false
        && legacy.getSetting('debug') === true
        && legacy.getSetting('damageNumbers') === false
        && legacy.getSetting('particles') === false
        && legacy.getSetting('reducedEffects') === true
        && legacy.getSetting('volMusic') === 0.35
        && legacy.getSetting('volSfx') === 0.65
        && legacy.getSetting('unlockMaps') === false
        && !Object.prototype.hasOwnProperty.call(legacy.data.settings, 'unlockMaps'),
    'old-save migration preserves progression and player settings while dropping the persisted map bypass');

    for (const value of [null, false, true, '130', 1.15, 0, 99, 101, 114, 116, 129, 131, 1000, {}, []]) {
        setGlobal('localStorage', new MemoryStorage(existingRaw({ uiScale: value })));
        ok(new SaveSystem().getSetting('uiScale') === 100,
            `stored unsupported UI scale ${JSON.stringify(value)} validates to 100 percent`);
    }
    for (const value of [null, 0, 1, 'true', {}, []]) {
        setGlobal('localStorage', new MemoryStorage(existingRaw({ highContrast: value })));
        ok(new SaveSystem().getSetting('highContrast') === false,
            `stored high contrast ${JSON.stringify(value)} validates to false`);
    }
    for (const value of [null, 0, 1, 'true', {}, []]) {
        setGlobal('localStorage', new MemoryStorage(existingRaw({ monoAudio: value, captions: value })));
        const strict = new SaveSystem();
        ok(strict.getSetting('monoAudio') === false && strict.getSetting('captions') === false,
            `stored hearing toggles ${JSON.stringify(value)} validate strictly`);
    }
    for (const value of [null, 'speech', 'FULL', true, {}, []]) {
        setGlobal('localStorage', new MemoryStorage(existingRaw({ captionDetail: value })));
        ok(new SaveSystem().getSetting('captionDetail') === 'essential',
            `stored caption detail ${JSON.stringify(value)} repairs to Essential`);
    }
    for (const value of [null, 'medium', 'LOW', true, {}, []]) {
        setGlobal('localStorage', new MemoryStorage(existingRaw({ vibration: value })));
        ok(new SaveSystem().getSetting('vibration') === 'low',
            `stored vibration ${JSON.stringify(value)} repairs to Low`);
    }
    setGlobal('localStorage', new MemoryStorage(existingRaw({ volSfx: 0.25, volVoice: 0.9 })));
    const independentVoice = new SaveSystem();
    ok(independentVoice.getSetting('volSfx') === 0.25
        && independentVoice.getSetting('volVoice') === 0.9,
    'explicit voice volume validates independently of SFX');

    // Live setters use the same strict boundary, so a bad action cannot poison
    // the in-memory profile until the next reload repairs it.
    const setterStorage = new MemoryStorage(existingRaw({}));
    setGlobal('localStorage', setterStorage);
    const setterSave = new SaveSystem();
    ok(setterSave.setSetting('uiScale', 115) === 115
        && setterSave.getSetting('uiScale') === 115,
    'UI-scale setter accepts a documented preset');
    ok(setterSave.setSetting('uiScale', 129) === 100
        && setterSave.getSetting('uiScale') === 100,
    'UI-scale setter repairs an unsupported live value immediately');
    ok(setterSave.setSetting('highContrast', true) === true
        && setterSave.getSetting('highContrast') === true,
    'high-contrast setter accepts literal true');
    ok(setterSave.setSetting('highContrast', 'true') === false
        && setterSave.getSetting('highContrast') === false,
    'high-contrast setter rejects truthy non-booleans immediately');
    ok(setterSave.setSetting('monoAudio', true) === true
        && setterSave.setSetting('monoAudio', 1) === false,
    'mono-audio setter accepts only literal true');
    ok(setterSave.setSetting('captions', true) === true
        && setterSave.setSetting('captions', 'true') === false,
    'caption setter accepts only literal true');
    ok(setterSave.setSetting('captionDetail', 'full') === 'full'
        && setterSave.setSetting('captionDetail', 'verbose') === 'essential',
    'caption-detail setter accepts only documented presets');
    ok(setterSave.setSetting('vibration', 'off') === 'off'
        && setterSave.setSetting('vibration', 'max') === 'low',
    'vibration setter accepts only documented presets');
    const setterReload = new SaveSystem();
    ok(setterReload.getSetting('uiScale') === 100
        && setterReload.getSetting('highContrast') === false,
    'normalized setter results persist through reload');

    // Migration remains intentionally historical: missing/invalid values use
    // defaultData() false, never the OS-derived freshDefaultData() value.
    setGlobal('window', mediaWindow(true));
    setGlobal('localStorage', new MemoryStorage(existingRaw({ screenShake: true })));
    ok(new SaveSystem().getSetting('reducedEffects') === false,
        'older save missing reducedEffects keeps the historical false fallback');
    setGlobal('localStorage', new MemoryStorage(JSON.stringify({ totalCoins: 321 })));
    {
        const noSettings = new SaveSystem();
        ok(noSettings.getSetting('reducedEffects') === false,
            'older save missing the settings object does not silently inherit OS motion');
        ok(noSettings.getSetting('uiScale') === 100
            && noSettings.getSetting('highContrast') === false,
        'older save missing the settings object receives safe preference defaults');
    }
    setGlobal('localStorage', new MemoryStorage(existingRaw({ reducedEffects: 'yes' })));
    ok(new SaveSystem().getSetting('reducedEffects') === false,
        'existing invalid reducedEffects value validates to historical false');

    // Reset is a deliberate new profile and samples the current preference at
    // reset time rather than caching the value from construction.
    let livePreference = false;
    setGlobal('window', {
        matchMedia(query) { return { matches: query === MOTION_QUERY && livePreference }; },
    });
    const resetStorage = new MemoryStorage(existingRaw({
        reducedEffects: false,
        uiScale: 130,
        highContrast: true,
    }));
    setGlobal('localStorage', resetStorage);
    const resetSave = new SaveSystem();
    ok(resetSave.getSetting('uiScale') === 130
        && resetSave.getSetting('highContrast') === true,
    'reset fixture begins with non-default persisted preferences');
    livePreference = true;
    resetSave.reset();
    ok(resetSave.getSetting('reducedEffects') === true,
        'reset profile re-samples and inherits enabled OS reduced motion');
    ok(resetSave.getSetting('uiScale') === 100
        && resetSave.getSetting('highContrast') === false
        && resetSave.getSetting('volVoice') === 0.8
        && resetSave.getSetting('monoAudio') === false
        && resetSave.getSetting('captions') === true
        && resetSave.getSetting('captionDetail') === 'essential'
        && resetSave.getSetting('vibration') === 'low',
    'reset restores safe UI-scale and high-contrast defaults');
    ok(JSON.parse(resetStorage.getItem(SAVE_KEY)).settings.reducedEffects === true,
        'reset persists its inherited reduced-motion setting');
    const persistedResetSettings = JSON.parse(resetStorage.getItem(SAVE_KEY)).settings;
    ok(persistedResetSettings.uiScale === 100
        && persistedResetSettings.highContrast === false,
    'reset persists the new preference defaults');
    livePreference = false;
    resetSave.reset();
    ok(resetSave.getSetting('reducedEffects') === false,
        'later reset re-samples an OS preference changed back to full motion');

    clearGlobal('localStorage');
    livePreference = false;
    const memoryReset = new SaveSystem();
    livePreference = true;
    memoryReset.reset();
    ok(memoryReset.available === false && memoryReset.getSetting('reducedEffects') === true,
        'in-memory reset also re-samples and inherits OS reduced motion');

    // Guard every non-browser/headless variant used by validators and workers.
    clearGlobal('window');
    clearGlobal('localStorage');
    ok(new SaveSystem().getSetting('reducedEffects') === false,
        'missing window and matchMedia safely preserve the false fallback');
    setGlobal('window', {});
    ok(new SaveSystem().getSetting('reducedEffects') === false,
        'window without matchMedia is safe');
    setGlobal('window', { matchMedia() { throw new Error('blocked media query'); } });
    ok(new SaveSystem().getSetting('reducedEffects') === false,
        'throwing matchMedia is caught and falls back safely');
} finally {
    console.warn = originalWarn;
    restoreGlobal('window', originalWindow);
    restoreGlobal('localStorage', originalStorage);
}

if (failures) {
    console.error(`Accessibility save validation failed: ${failures}/${checks} checks.`);
    process.exit(1);
}

console.log(`Accessibility save validation passed: ${checks} motion and preference save checks.`);
