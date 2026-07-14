// Daily Challenges — three rotating per-run goals that reset each (UTC) day,
// giving a "come back tomorrow" reward loop. Each is checked against a single
// run's summary at game-over (NOT lifetime stats) and pays coins + Vigil XP
// once. This is a visible bonus on top of the XP every valid run earns.
//
// The day's three picks are chosen DETERMINISTICALLY from the pool by a seeded
// shuffle keyed on the day number, so every device shows the same set on the
// same day with no server. Completion + claim state lives in save.daily
// ({ day, completed: [ids] }); SaveSystem auto-resets it when the day rolls.

// metric maps to a field on the run summary built at game-over. Living Vigil
// adds sites, siteKinds, encounters, and guardians alongside the original
// kills/bosses/time/level/wave families:
//   kills → summary.kills, bosses → summary.bossesDefeated,
//   timeSec → summary.time, level → summary.level, wave → summary.finalWave
export const DAILY_POOL = [
    { id: 'd_kills_400',  name: 'Cull the Horde', desc: 'Defeat 400 Hollow in a run',  metric: 'kills',  target: 400, coins: 80,  vigilXp: 75 },
    { id: 'd_kills_900',  name: 'Slaughter',      desc: 'Defeat 900 Hollow in a run',  metric: 'kills',  target: 900, coins: 140, vigilXp: 130 },
    { id: 'd_boss_1',     name: 'Warden',         desc: 'Defeat a boss',               metric: 'bosses', target: 1,   coins: 90,  vigilXp: 75 },
    { id: 'd_boss_3',     name: 'Trinity',        desc: 'Defeat 3 bosses in a run',    metric: 'bosses', target: 3,   coins: 220, vigilXp: 150 },
    { id: 'd_time_5',     name: 'Endure',         desc: 'Survive 5 minutes',           metric: 'timeSec', target: 300, coins: 90,  vigilXp: 70 },
    { id: 'd_time_10',    name: 'Long Watch',     desc: 'Survive 10 minutes',          metric: 'timeSec', target: 600, coins: 170, vigilXp: 120 },
    { id: 'd_level_15',   name: 'Empowered',      desc: 'Reach level 15 in a run',     metric: 'level',  target: 15,  coins: 90,  vigilXp: 70 },
    { id: 'd_level_25',   name: 'Ascendant',      desc: 'Reach level 25 in a run',     metric: 'level',  target: 25,  coins: 170, vigilXp: 120 },
    { id: 'd_wave_4',     name: 'Pressing On',    desc: 'Reach wave 4 in a run',       metric: 'wave',   target: 4,   coins: 90,  vigilXp: 70 },
    { id: 'd_wave_6',     name: 'Wavebreaker',    desc: 'Reach wave 6 in a run',       metric: 'wave',   target: 6,   coins: 170, vigilXp: 120 },
    { id: 'd_sites_2',    name: 'Waylighter',      desc: 'Activate 2 Vigil sites',      metric: 'sites',  target: 2,   coins: 80,  vigilXp: 75 },
    { id: 'd_sites_4',    name: 'Lantern Circuit', desc: 'Activate 4 Vigil sites',      metric: 'sites',  target: 4,   coins: 150, vigilXp: 125 },
    { id: 'd_site_kinds', name: 'Fourfold Pilgrim', desc: 'Use all 4 Vigil site kinds', metric: 'siteKinds', target: 4, coins: 180, vigilXp: 140 },
    { id: 'd_packs_2',    name: 'Formation Breaker', desc: 'Clear 2 tactical encounters', metric: 'encounters', target: 2, coins: 90, vigilXp: 80 },
    { id: 'd_packs_4',    name: 'Battle Reader',  desc: 'Clear 4 tactical encounters', metric: 'encounters', target: 4, coins: 170, vigilXp: 130 },
    { id: 'd_guardian_1', name: 'Guardianbreaker', desc: 'Defeat a guardian pack',     metric: 'guardians', target: 1, coins: 140, vigilXp: 110 },
];

const BY_ID = Object.fromEntries(DAILY_POOL.map((c) => [c.id, c]));

// UTC day index — the same value worldwide for ~24h, then increments.
export function currentDayNumber(nowMs) {
    const t = (typeof nowMs === 'number') ? nowMs : Date.now();
    return Math.floor(t / 86400000);
}

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// The three challenges for a given day — a deterministic seeded shuffle pick.
export function pickDailyChallenges(day, n = 3) {
    const rng = mulberry32((day >>> 0) ^ 0x9e3779b9);
    const pool = DAILY_POOL.slice();
    // Fisher–Yates with the seeded rng.
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    const count = Math.max(0, Math.min(Number.isFinite(n) ? Math.floor(n) : 3, pool.length));
    if (count === 0) return [];
    // Prefer one goal per metric so a normal three-challenge day cannot ask for
    // the same deed twice (for example both 400 and 900 kills). Keep skipped
    // siblings as deterministic overflow so callers asking for more than the
    // five distinct metrics still receive the requested number of challenges.
    const out = [];
    const deferred = [];
    const seenMetrics = new Set();
    for (const challenge of pool) {
        if (!seenMetrics.has(challenge.metric)) {
            seenMetrics.add(challenge.metric);
            out.push(challenge);
        } else {
            deferred.push(challenge);
        }
        if (out.length >= count) return out;
    }
    for (const challenge of deferred) {
        if (out.length >= count) break;
        out.push(challenge);
    }
    return out;
}

function metricValue(summary, metric) {
    if (!summary) return 0;
    switch (metric) {
        case 'kills':  return summary.kills || 0;
        case 'bosses': return summary.bossesDefeated || 0;
        case 'timeSec': return summary.time || 0;
        case 'level':  return summary.level || 0;
        case 'wave':   return summary.finalWave || 0;
        case 'sites':  return summary.vigilSitesActivated || 0;
        case 'siteKinds': return summary.vigilSiteKindsMastered || 0;
        case 'encounters': return summary.encountersCleared || 0;
        case 'guardians': return summary.guardianPacksDefeated || 0;
        default:       return 0;
    }
}

export function challengeProgress(c, summary) {
    return Math.min(1, metricValue(summary, c.metric) / Math.max(1, c.target));
}

// Returns today's challenge objects newly COMPLETED by this run (target met +
// not already in completedIds). Caller marks them complete + grants coins.
export function evaluateDaily(day, summary, completedIds) {
    const done = new Set(completedIds || []);
    const out = [];
    for (const c of pickDailyChallenges(day)) {
        if (done.has(c.id)) continue;
        if (metricValue(summary, c.metric) >= c.target) out.push(c);
    }
    return out;
}

export function dailyById(id) { return BY_ID[id]; }
