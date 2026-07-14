#!/usr/bin/env node
// Deterministic save-default gate for the First Light reduced-motion contract.
// Fresh/reset/corrupt profiles inherit the OS preference; validation of a real
// existing save deliberately keeps the historical false fallback when the
// reducedEffects field is absent or invalid.

import { SaveSystem } from '../src/systems/SaveSystem.js';

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
    ok(queries.length === 1 && queries[0] === MOTION_QUERY,
        'fresh profile queries the exact prefers-reduced-motion media feature once');

    setGlobal('window', mediaWindow(false));
    setGlobal('localStorage', new MemoryStorage());
    ok(new SaveSystem().getSetting('reducedEffects') === false,
        'fresh stored profile stays full-motion when the OS preference is off');

    // Storage-unavailable play is an in-memory fresh profile and must inherit too.
    setGlobal('window', mediaWindow(true));
    clearGlobal('localStorage');
    ok(new SaveSystem().getSetting('reducedEffects') === true,
        'fresh in-memory profile inherits the OS preference without localStorage');

    // Both malformed JSON and structurally invalid JSON are corrupt profiles.
    setGlobal('localStorage', new MemoryStorage('{broken-json'));
    ok(new SaveSystem().getSetting('reducedEffects') === true,
        'malformed stored JSON resets with the OS preference');
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

    // Migration remains intentionally historical: missing/invalid values use
    // defaultData() false, never the OS-derived freshDefaultData() value.
    setGlobal('window', mediaWindow(true));
    setGlobal('localStorage', new MemoryStorage(existingRaw({ screenShake: true })));
    ok(new SaveSystem().getSetting('reducedEffects') === false,
        'older save missing reducedEffects keeps the historical false fallback');
    setGlobal('localStorage', new MemoryStorage(JSON.stringify({ totalCoins: 321 })));
    ok(new SaveSystem().getSetting('reducedEffects') === false,
        'older save missing the settings object does not silently inherit OS motion');
    setGlobal('localStorage', new MemoryStorage(existingRaw({ reducedEffects: 'yes' })));
    ok(new SaveSystem().getSetting('reducedEffects') === false,
        'existing invalid reducedEffects value validates to historical false');

    // Reset is a deliberate new profile and samples the current preference at
    // reset time rather than caching the value from construction.
    let livePreference = false;
    setGlobal('window', {
        matchMedia(query) { return { matches: query === MOTION_QUERY && livePreference }; },
    });
    const resetStorage = new MemoryStorage(existingRaw({ reducedEffects: false }));
    setGlobal('localStorage', resetStorage);
    const resetSave = new SaveSystem();
    livePreference = true;
    resetSave.reset();
    ok(resetSave.getSetting('reducedEffects') === true,
        'reset profile re-samples and inherits enabled OS reduced motion');
    ok(JSON.parse(resetStorage.getItem(SAVE_KEY)).settings.reducedEffects === true,
        'reset persists its inherited reduced-motion setting');
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

console.log(`Accessibility save validation passed: ${checks} reduced-motion save checks.`);
