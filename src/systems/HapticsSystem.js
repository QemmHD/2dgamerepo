// Capability-safe touch vibration for the web build.
//
// No cue depends on this channel, and no controller support is implied: the
// current game has keyboard/pointer/touch input only. Unsupported browsers,
// hidden documents and rejected calls remain quiet no-ops while the saved
// player preference is preserved for a capable device.

import { normalizeVibrationStrength } from './AccessibilityPreferences.js';

const PATTERNS = Object.freeze({
    preview:     { pattern: 24, gap: 0.2 },
    damage:      { pattern: [22, 34, 18], gap: 0.22 },
    bossWarning: { pattern: [38, 55, 38], gap: 1.2 },
    bossAttack:  { pattern: 44, gap: 0.45 },
    kindle:      { pattern: [28, 32, 64], gap: 0.7 },
    bossDefeat:  { pattern: [42, 38, 72], gap: 1.2 },
    victory:     { pattern: [34, 30, 50, 30, 82], gap: 2 },
});

function scaledPattern(pattern, strength) {
    if (strength === 'full') return Array.isArray(pattern) ? [...pattern] : pattern;
    const scale = 0.45;
    if (Array.isArray(pattern)) {
        return pattern.map((value, index) => index % 2
            ? Math.max(18, Math.round(value * 0.7))
            : Math.max(8, Math.round(value * scale)));
    }
    return Math.max(8, Math.round(pattern * scale));
}

export class HapticsSystem {
    constructor({
        navigatorRef = typeof navigator !== 'undefined' ? navigator : null,
        documentRef = typeof document !== 'undefined' ? document : null,
        now = () => (typeof performance !== 'undefined' && performance.now
            ? performance.now() / 1000
            : Date.now() / 1000),
    } = {}) {
        this.navigator = navigatorRef;
        this.document = documentRef;
        this.now = now;
        this.strength = 'off';
        this.lastPulse = new Map();
    }

    supported() {
        return typeof this.navigator?.vibrate === 'function';
    }

    setStrength(value) {
        this.strength = normalizeVibrationStrength(value);
        if (this.strength === 'off') this.cancel();
        return this.strength;
    }

    pulse(kind = 'preview') {
        const cue = PATTERNS[kind];
        if (!cue || this.strength === 'off' || !this.supported()) return false;
        if (this.document?.visibilityState && this.document.visibilityState !== 'visible') return false;
        const activation = this.navigator?.userActivation;
        if (activation && activation.hasBeenActive === false) return false;
        const now = Number(this.now()) || 0;
        const last = this.lastPulse.get(kind);
        if (Number.isFinite(last) && now - last < cue.gap) return false;
        this.lastPulse.set(kind, now);
        try {
            return this.navigator.vibrate(scaledPattern(cue.pattern, this.strength)) === true;
        } catch (_) {
            return false;
        }
    }

    cancel() {
        if (!this.supported()) return false;
        try { return this.navigator.vibrate(0) === true; }
        catch (_) { return false; }
    }
}

export { PATTERNS as HAPTIC_PATTERNS, scaledPattern };
