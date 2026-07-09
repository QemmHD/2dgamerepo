// bossRush.js — Boss Rush mode config, boss sequence, and score.
//
// Boss Rush is a mode-config + a stateless sequence builder; the run-time state
// machine lives in src/systems/BossRushController.js. Everything here is pure
// data + pure functions so the SAME controller can later drive Weekly Ember —
// that mode ships a PARALLEL config (a seeded, date-derived variant) and reuses
// getBossRushSequence()/the controller unchanged. See BOSS_RUSH_NOTES.md.
//
// The apex roster is the game's twelve apex bosses, in map-tier order (1→4), so
// the fixed gauntlet escalates naturally from the first biome's skirmishers to
// the last biome's apexes. Ids are read from ENEMY at spawn time (Game._spawnBoss
// / _startBossWarning), so this file only needs the id order — never the kit.

// Fixed apex order (map-tier 1→4, three bosses per biome). Matches maps.js
// rosters; kept as an explicit list so the gauntlet order is intentional and
// stable rather than derived (a derived order would shuffle if maps.js reorders).
export const BOSS_RUSH_APEX_ORDER = [
    'stormwingAlpha', 'vinebackGoliath', 'gloomMaw',   // Emberwood (tier 1)
    'hoarfang', 'rimewarden', 'aurorath',              // Frostmere (tier 2)
    'mourndrift', 'ossuar', 'nihagault',               // Gravemarsh (tier 3)
    'cindermaw', 'dunescourge', 'solnakh',             // Ashwaste (tier 4)
];

// The default Boss Rush config. Weekly Ember will ship another config object of
// this SAME shape (with `seed` set from the week number and `deterministic:true`)
// and hand it to the identical controller — no controller changes needed.
//
//   id/label       — identity + HUD/menu copy.
//   order          — the boss-id pool (defaults to the full apex roster).
//   count          — cap the sequence length (null = the whole `order`).
//   seed           — null → FIXED order; a number → deterministic shuffle
//                    (the Weekly Ember hook; see getBossRushSequence).
//   deterministic  — advisory flag a future mode sets to signal "this setup is
//                    meant to be reproducible for everyone" (Boss Rush is a
//                    freeplay mode, so false). The controller does not branch on
//                    it today; it exists so Weekly Ember carries intent cleanly.
//   firstPrep/prep — breathing-room seconds before the first boss / between bosses.
//   scaling        — mode-specific boss HP/damage curve (see bossRushScaleFor).
//                    Boss Rush stacks up to twelve bosses with NO trash XP, so it
//                    must NOT reuse normal mode's per-encounter tier (×0.8/boss)
//                    or its run-minute HP ramp — those compound absurdly here.
export const BOSS_RUSH_CONFIG = {
    id: 'bossRush',
    label: 'Boss Rush',
    order: BOSS_RUSH_APEX_ORDER,
    count: null,
    seed: null,
    deterministic: false,
    firstPrepDuration: 6,
    prepDuration: 9,
    // Boss Rush drops the player straight into an apex fight with no trash to
    // level on, so it grants a head-start build: N level-ups at run start (the
    // player becomes level N+1 and picks N upgrades from the normal draft during
    // the opening prep, before the first boss lands). Enough to actively fight.
    startingLevelUps: 5,
    scaling: { baseHpMul: 1.2, hpPerBoss: 0.12, baseDmgMul: 1.0, dmgPerBoss: 0.04 },
};

// Same calendar-PRNG as dailyRoad.js / riteTrial.js / dailyChallenges.js, kept
// local so the mode stays decoupled (the documented "distinct salt per system"
// convention). Only used when a config carries a non-null seed.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const BOSS_RUSH_SALT = 0xB0551234;

// Build the ordered boss-id list for a config. FIXED order when `seed` is null
// (Boss Rush today); a deterministic Fisher–Yates shuffle when a seed is given
// (Weekly Ember: pass `seed: weeklyEmberSeed(...)`). Never mutates the config.
export function getBossRushSequence(config = BOSS_RUSH_CONFIG) {
    const src = (Array.isArray(config.order) && config.order.length) ? config.order : BOSS_RUSH_APEX_ORDER;
    const seq = src.slice();
    if (config.seed != null) {
        const rng = mulberry32(((config.seed >>> 0) ^ BOSS_RUSH_SALT) >>> 0);
        for (let i = seq.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const tmp = seq[i]; seq[i] = seq[j]; seq[j] = tmp;
        }
    }
    const n = config.count;
    return (Number.isFinite(n) && n > 0 && n < seq.length) ? seq.slice(0, n) : seq;
}

// Mode-specific boss scaling by sequence index (0 = first boss). Gentle and
// position-driven — Boss Rush has no trash XP and stacks many bosses, so it
// deliberately ignores normal mode's run-minute HP ramp and steep per-encounter
// tier. Consumed by Game._spawnBoss when a run is in Boss Rush.
export function bossRushScaleFor(index, config = BOSS_RUSH_CONFIG) {
    const s = config.scaling || BOSS_RUSH_CONFIG.scaling;
    const i = Math.max(0, index | 0);
    return {
        hp: (s.baseHpMul ?? 1.2) * (1 + i * (s.hpPerBoss ?? 0.12)),
        dmg: (s.baseDmgMul ?? 1) * (1 + i * (s.dmgPerBoss ?? 0.04)),
    };
}

// Boss-Rush score: bosses felled are the headline (heavily weighted); a mild
// speed bonus rewards a fast full clear without punishing a careful one. Used
// for the best-record + the recap card. Tunable; mirrors riteTrialScore's shape.
export function bossRushScore({ bossesDefeated = 0, timeSurvived = 0, cleared = false } = {}) {
    const base = Math.max(0, Math.floor(bossesDefeated)) * 1000;
    // Speed bonus only on a FULL clear (else time just means you survived longer).
    const speed = cleared ? Math.max(0, Math.floor(900 - timeSurvived)) : 0;
    return Math.max(0, base + speed);
}

// ── Weekly Ember hook (NOT wired yet) ────────────────────────────────────────
// Weekly Ember will be a seeded weekly gauntlet reusing this file + the
// controller. It only needs a stable per-week seed; deriving it from the UTC day
// number (see dailyChallenges.currentDayNumber) keeps it in the same calendar
// convention as the daily modes. Left here, exported and documented, so wiring
// Weekly Ember is: build a config `{ ...BOSS_RUSH_CONFIG, id:'weeklyEmber',
// label:'Weekly Ember', seed: weeklyEmberSeed(day), deterministic:true }` and
// start it through the same 'startBossRush' path. Intentionally unused today.
export function weeklyEmberSeed(dayNumber) {
    return Math.floor((Number(dayNumber) || 0) / 7);
}
