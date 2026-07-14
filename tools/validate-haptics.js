#!/usr/bin/env node
// Browser-vibration contract. This intentionally proves graceful capability
// fallback and bounded touch patterns; it makes no controller-rumble claim.

import {
    HAPTIC_PATTERNS,
    HapticsSystem,
    scaledPattern,
} from '../src/systems/HapticsSystem.js';

let checks = 0;
let failures = 0;
const ok = (condition, message) => {
    checks++;
    if (!condition) { failures++; console.error(`  x ${message}`); }
};

let clock = 10;
const calls = [];
const nav = {
    userActivation: { hasBeenActive: true },
    vibrate(pattern) { calls.push(pattern); return true; },
};
const doc = { visibilityState: 'visible' };
const haptics = new HapticsSystem({ navigatorRef: nav, documentRef: doc, now: () => clock });
ok(haptics.supported() === true, 'navigator.vibrate capability is detected');
ok(haptics.pulse('preview') === false && calls.length === 0,
'Off never vibrates');
ok(haptics.setStrength('low') === 'low', 'Low strength is accepted');
ok(haptics.pulse('preview') === true
    && calls.at(-1) === scaledPattern(HAPTIC_PATTERNS.preview.pattern, 'low'),
'Low emits the bounded scaled preview pattern');
ok(haptics.pulse('preview') === false && calls.length === 1,
'per-cue throttle blocks immediate repeats');
clock += 1;
ok(haptics.setStrength('full') === 'full' && haptics.pulse('bossWarning') === true,
'Full emits a semantic boss-warning pattern');
ok(JSON.stringify(calls.at(-1)) === JSON.stringify(HAPTIC_PATTERNS.bossWarning.pattern),
'Full preserves the authored pattern exactly');

doc.visibilityState = 'hidden';
clock += 2;
ok(haptics.pulse('damage') === false, 'hidden documents do not vibrate');
doc.visibilityState = 'visible';
nav.userActivation.hasBeenActive = false;
ok(haptics.pulse('damage') === false, 'missing sticky user activation is a safe no-op');
nav.userActivation.hasBeenActive = true;

ok(haptics.setStrength('off') === 'off' && calls.at(-1) === 0,
'Off cancels active vibration immediately');
ok(haptics.setStrength('maximum') === 'low',
'unsupported strength repairs to the strict Low default');

const unsupported = new HapticsSystem({ navigatorRef: {}, documentRef: doc, now: () => clock });
ok(unsupported.supported() === false
    && unsupported.setStrength('full') === 'full'
    && unsupported.pulse('victory') === false
    && unsupported.cancel() === false,
'missing vibration API preserves preference and never throws');

const rejecting = new HapticsSystem({
    navigatorRef: {
        userActivation: { hasBeenActive: true },
        vibrate() { throw new Error('blocked'); },
    },
    documentRef: doc,
    now: () => clock,
});
rejecting.setStrength('full');
ok(rejecting.pulse('victory') === false && rejecting.cancel() === false,
'throwing vibration API degrades to false without an uncaught error');

const falseApi = new HapticsSystem({
    navigatorRef: {
        userActivation: { hasBeenActive: true },
        vibrate() { return false; },
    },
    documentRef: doc,
    now: () => clock,
});
falseApi.setStrength('full');
ok(falseApi.pulse('kindle') === false, 'false-returning vibration API stays non-fatal');

for (const [name, cue] of Object.entries(HAPTIC_PATTERNS)) {
    const values = Array.isArray(cue.pattern) ? cue.pattern : [cue.pattern];
    ok(values.length <= 5 && values.every((value) => Number.isInteger(value) && value >= 0 && value <= 100),
        `${name} pattern is short and bounded`);
}

if (failures) {
    console.error(`\nHaptics validation failed: ${failures}/${checks} checks.`);
    process.exit(1);
}
console.log(`Haptics validation passed: ${checks} capability, strength, throttle and pattern checks.`);
