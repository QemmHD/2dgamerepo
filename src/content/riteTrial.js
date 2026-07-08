// riteTrial.js — the daily hero-locked Rite Trial setup (KINDLED update #3, PR5).
// Deterministic from the UTC day number with a DISTINCT salt (0x4b494e44 = "KIND")
// so it never mirrors the Daily Road (0x5eed1234) or daily-challenge (0x9e3779b9)
// picks. Setup-only determinism — spawns still vary run-to-run; only the SETUP (the
// day's locked hero + map + one Trial modifier) is shared. NOT a seeded sim (that's
// update #17's job), so it makes no fairness claim a live-RNG run can't honor.
//
// The hero pool is CHARACTER_IDS — append-only, so update #10's new heroes join the
// rotation with zero surgery here (never hardcodes the count six).

import { CHARACTER_IDS } from './characters.js';
import { MAP_ORDER } from './maps.js';
import { RUN_MODIFIERS } from '../config/GameConfig.js';

const RITE_TRIAL_SALT = 0x4b494e44;

// Same PRNG as dailyRoad.js / dailyChallenges.js, kept local so the systems stay
// decoupled (the documented calendar-PRNG convention — distinct salt per system).
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// The fixed setup for a given UTC day: { heroId, mapId, modifierIds:[one] }. Pick
// order is FIXED (hero → map → modifier) so a given day is reproducible everywhere.
export function getRiteTrialSetup(day) {
    const rng = mulberry32(((day >>> 0) ^ RITE_TRIAL_SALT) >>> 0);
    const heroId = CHARACTER_IDS[Math.floor(rng() * CHARACTER_IDS.length)] ?? CHARACTER_IDS[0];
    const mapId = MAP_ORDER[Math.floor(rng() * MAP_ORDER.length)] ?? MAP_ORDER[0];
    const mod = RUN_MODIFIERS[Math.floor(rng() * RUN_MODIFIERS.length)];
    const modifierIds = mod ? [mod.id] : [];
    return { heroId, mapId, modifierIds };
}

// Kindle-centric score: kills + 60×ults + 12×comboProcs + 250×bosses (all tunable).
export function riteTrialScore({ kills = 0, ults = 0, comboProcs = 0, bosses = 0 } = {}) {
    return Math.max(0, Math.floor(kills + 60 * ults + 12 * comboProcs + 250 * bosses));
}
