// Daily Road — a CURATED daily run setup: each UTC day rotates a fixed biome +
// two Trial modifiers + a forced starting road (Ember/Rime/Ashen), the SAME for
// everyone that day, launched from the menu and scored against a per-day best.
//
// Deterministic from the day number (like the daily challenges), so no server is
// needed — every device rolls the same combo for ~24h. This is NOT a seeded run:
// enemy spawns still vary run-to-run; only the SETUP is shared. Uses a DISTINCT
// salt from pickDailyChallenges so the road/map/mod picks don't mirror the
// challenge picks on the same day.

import { MAP_ORDER } from './maps.js';
import { ROADS } from './roads.js';
import { RUN_MODIFIERS } from '../config/GameConfig.js';

// Same PRNG as dailyChallenges.js (kept local so the two systems stay decoupled).
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// The fixed setup for a given UTC day: { mapId, roadId, modifierIds:[a,b] }.
// Distinct salt (0x5eed1234) from pickDailyChallenges' 0x9e3779b9 so the picks
// are uncorrelated with the day's challenge set.
export function getDailySetup(day) {
    const rng = mulberry32(((day >>> 0) ^ 0x5eed1234) >>> 0);
    const mapId = MAP_ORDER[Math.floor(rng() * MAP_ORDER.length)] ?? MAP_ORDER[0];
    const roadId = ROADS[Math.floor(rng() * ROADS.length)]?.id ?? ROADS[0].id;
    // Seeded Fisher–Yates shuffle of the Trials, then take the first two.
    const pool = RUN_MODIFIERS.slice();
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const modifierIds = pool.slice(0, Math.min(2, pool.length)).map((m) => m.id);
    return { mapId, roadId, modifierIds };
}
