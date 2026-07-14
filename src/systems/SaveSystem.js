// localStorage-backed meta-progression save.
//
// One key for the whole game. On boot, _loadOrDefault validates whatever
// was stored and falls back to defaults for missing fields or corrupted
// JSON. All public methods are no-ops on localStorage failures (private
// mode, exceeded quota, blocked storage) so the game never crashes.

import { DEFAULT_UNLOCKED_GEAR, DEFAULT_EQUIPPED_GEAR, GEAR_LIST } from '../content/gear.js';
import { DEFAULT_UNLOCKED_COSMETICS, DEFAULT_EQUIPPED_COSMETICS, COSMETIC_LIST } from '../content/cosmetics.js';
import { CHARACTER_IDS, DEFAULT_CHARACTER } from '../content/characters.js';
import { MAPS, DEFAULT_MAP, isMapUnlocked } from '../content/maps.js';
import { PERMANENT_UPGRADES } from '../content/permanentUpgrades.js';
import { getAttunable, attuneCost } from '../content/relics.js';
import { HERO_ATTUNE_MAX, heroAttuneCost, heroAttuneRiteGate } from '../content/heroAttunement.js';
import { riteIdsFor, ritesCompletedCount } from '../content/rites.js';
import {
    BP_EVERFLAME_COINS, BP_MAX_LEVEL, BP_SCHEMA, PASS_COSMETIC_MILESTONES,
    bpProgress, migrateBattlePassXpV1,
} from '../content/battlePass.js';

const SAVE_KEY = 'monkey-survivor:save:v1';
export const MAX_COIN_BALANCE = Number.MAX_SAFE_INTEGER;
const UPGRADE_MAX_BY_ID = Object.freeze(Object.fromEntries(
    PERMANENT_UPGRADES.map((upgrade) => [upgrade.id, upgrade.maxLevel]),
));

function defaultData() {
    return {
        // New forges start with a 2,000-coin welcome stake so the tutorial can
        // walk the player through actually SPENDING (skills / cases) instead of
        // pointing at locked doors. Existing saves keep their real balance.
        totalCoins: 2000,
        upgrades: {
            maxHp: 0,
            damage: 0,
            critChance: 0,
            moveSpeed: 0,
            xpGain: 0,
            pickupRange: 0,
            startingCoins: 0,
            rerolls: 0,
            banish: 0,
        },
        // Lifetime + best-run records, surfaced on the start screen and used
        // for the game-over "NEW BEST!" banner.
        stats: {
            bestTime: 0,
            bestWave: 0,
            bestLevel: 0,
            bestKills: 0,
            bestBosses: 0,
            runs: 0,
            totalKills: 0,
            totalBosses: 0,
            totalCoinsEarned: 0,
            casesOpened: 0,
            // "The Vigil Endures" additions (all numeric → auto-validated by the
            // stats loop in _validate; old saves default them to 0).
            playtimeSec: 0,          // lifetime seconds survived across runs
            eliteBossesDefeated: 0,  // bosses killed on Hard (a bragging stat)
            bestGauntletScore: 0,    // best endless score after 3rd-boss victory
            gauntletRuns: 0,         // endless continuations played
            hardWins: 0,             // 3rd-boss victories on Hard difficulty
            dupeCoins: 0,            // lifetime coins refunded from case duplicates
            // EMBERGLASS (roadmap #2) additions (numeric → auto-validated).
            cardsShared: 0,          // lifetime death/victory recap cards shared
            photosTaken: 0,          // lifetime Keeper's Lens snaps saved
            // KINDLED (roadmap #3) additions (numeric → auto-validated).
            ultsReleased: 0,         // lifetime Grand Signatures released
            comboProcs: 0,           // lifetime element-combo procs
            blinks: 0,               // lifetime aimed blinks
            riteTrialBest: 0,        // lifetime best Rite-Trial score
            weeklyEmberBest: 0,      // lifetime best Weekly Ember score
            // LIVING VIGIL: permanent exploration + tactical-mastery records.
            // Numeric defaults keep old saves compatible through _validate.
            vigilSitesActivated: 0,      // total landmark sites kindled
            vigilSiteKindsMastered: 0,  // best distinct site kinds in one run (0..4)
            encountersCleared: 0,       // total authored tactical packs defeated
            guardianPacksDefeated: 0,   // total guardian-class packs defeated
        },
        settings: {
            screenShake: true,
            debug: false,
            damageNumbers: true,
            particles: true,
            reducedEffects: false,
            volMusic: 0.7,
            volSfx: 0.8,
            // Testing: unlock every biome regardless of boss kills.
            unlockMaps: false,
        },
        // Character cosmetics (visual only). unlocked = owned ids; equipped =
        // one id per slot.
        cosmetics: {
            unlocked: [...DEFAULT_UNLOCKED_COSMETICS],
            equipped: { ...DEFAULT_EQUIPPED_COSMETICS },
        },
        // Loadout gear (small buffs + chosen starting weapon).
        gear: {
            unlocked: [...DEFAULT_UNLOCKED_GEAR],
            equipped: { ...DEFAULT_EQUIPPED_GEAR },
        },
        // Offline battle-pass track.
        battlePass: {
            schema: BP_SCHEMA,
            xp: 0,
            claimed: [],
        },
        // Selected playable character id (run uses it; see content/characters).
        selectedCharacter: DEFAULT_CHARACTER,
        // Ember Forge pity counter (forges since the last Rare+).
        forge: { pity: 0 },
        // Per-case bad-luck protection: opens since each case last paid Rare+.
        // (caseId → count). Reaching the case's pity cap forces a Rare+.
        casePity: {},
        // Gamble quota: plays used in the current rolling-hour window.
        gamble: { windowStart: 0, count: 0 },
        // Selected biome/map id (see content/maps.js); unlock-gated by bosses.
        selectedMap: DEFAULT_MAP,
        // Chosen difficulty tier (validated string — deliberately NOT in
        // settings{}, whose loop clamps every value to 0..1 / booleans).
        difficulty: 'normal',
        // Earned achievement ids (one-time milestones; see content/achievements).
        achievements: { claimed: [] },
        // Daily challenges: which day the `completed` ids belong to (auto-reset
        // when the day rolls; see content/dailyChallenges + getDailyState).
        daily: { day: 0, completed: [] },
        // Daily Road: the current day's best score for the curated daily run
        // ({ day, best }; auto-resets when the day rolls — see recordDailyRoadScore).
        // prevBest keeps YESTERDAY's best across the roll so the menu can show it.
        // caseDay latches the day whose free first-clear case was already claimed
        // (see claimDailyRoadCase).
        dailyRoad: { day: 0, best: 0, prevBest: 0, caseDay: 0 },
        // Day streak: consecutive UTC days with at least one finished run
        // ({ day: last played day, count }). Celebratory only — a lapsed streak
        // just restarts at 1, it never punishes (see recordDayStreak).
        streak: { day: 0, count: 0 },
        // Onboarding/staged-menu progress: which menu tabs the player has
        // OPENED at least once (drives the one-time "NEW" badge on tabs that
        // unlock by progression — see MenuRenderer tabUnlocked). tourDone
        // latches once the guided menu tour has been finished or skipped.
        onboarding: { tabsSeen: [], tourDone: false },
        // Pact Mastery: highest Pact tier (active-Trial count, 0..N) a run has
        // CLEARED (3-boss victory) per character id — the "can't-farm" ladder.
        pactMastery: {},
        // Wick Roads: relic ids the player has EVER claimed (lifetime codex). Purely
        // a discovery record — relic effects are run-scoped, never persisted.
        discoveredRelics: [],
        // Relic Attunement: the coin-fed infinite sink. { [relicId]: level } — a
        // permanent, always-on bonus applied ONCE at run start (see relics.js
        // ATTUNABLE / applyAttunements). Only DEFENSIVE/UTILITY relics are attunable.
        relicAttunement: {},
        // KINDLED (roadmap #3): the meta layer. heroAttunement { [charId]: level 0..5 }
        // is the per-hero coin sink (rungs 3/4/5 rite-gated). rites { [charId]:
        // { [riteId]: progress } } accumulates the mastery quests across runs. riteTrial
        // mirrors dailyRoad's best-of-day for the daily hero-locked Trial.
        heroAttunement: {},
        rites: {},
        riteTrial: { day: 0, best: 0, prevBest: 0 },
        // BOSSFORGE — Boss Rush all-time best record ({ bestBosses, bestTime (of a
        // FULL clear, seconds), bestScore }). NOT date-scoped — Boss Rush is
        // always-available freeplay. Additive field: absent on old saves,
        // defaulted by the normalizer → no wipe.
        bossRush: { bestBosses: 0, bestTime: 0, bestScore: 0 },
        // Weekly Ember best-of-week ({ week, best, prevBest }) — the UTC-week
        // analogue of riteTrial's best-of-day (auto-resets when the week rolls;
        // prevBest keeps LAST week's best across the roll). Additive, no wipe.
        weeklyEmber: { week: 0, best: 0, prevBest: 0 },
        version: 9,
    };
}

// Valid difficulty tiers (kept here so _validate + accessors agree).
const DIFFICULTIES = ['easy', 'normal', 'hard'];

// Validate an array into a deduped list of non-empty strings, seeded with the
// supplied defaults so a slot can never lose its baseline unlocks.
function validateIdList(raw, defaults) {
    const out = new Set(defaults);
    if (Array.isArray(raw)) {
        for (const v of raw) if (typeof v === 'string' && v) out.add(v);
    }
    return [...out];
}

// Validate an equipped map: keep default keys, accept stored string/null values.
function validateEquipped(raw, defaults) {
    const out = { ...defaults };
    if (raw && typeof raw === 'object') {
        for (const key of Object.keys(defaults)) {
            const v = raw[key];
            if (typeof v === 'string' || v === null) out[key] = v;
        }
    }
    return out;
}

export class SaveSystem {
    constructor() {
        this.available = this._probe();
        this.data = this._loadOrDefault();
    }

    _probe() {
        try {
            const key = '__monkey_survivor_probe__';
            localStorage.setItem(key, '1');
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            console.warn('[SaveSystem] localStorage unavailable; running in memory-only mode');
            return false;
        }
    }

    _loadOrDefault() {
        if (!this.available) return defaultData();
        let raw = null;
        try {
            raw = localStorage.getItem(SAVE_KEY);
        } catch (e) {
            console.warn('[SaveSystem] read failed', e);
            return defaultData();
        }
        if (!raw) return defaultData();
        try {
            const parsed = JSON.parse(raw);
            return this._validate(parsed);
        } catch (e) {
            console.warn('[SaveSystem] corrupted save, resetting', e);
            return defaultData();
        }
    }

    _validate(data) {
        const def = defaultData();
        if (typeof data !== 'object' || !data) return def;
        const totalCoins = Number.isFinite(data.totalCoins) && data.totalCoins >= 0
            ? Math.min(MAX_COIN_BALANCE, Math.floor(data.totalCoins))
            : 0;
        // Migration is implicit: any key missing from an older save (e.g. a
        // v1 save with no `rerolls`, `stats`, or `settings`) keeps its
        // default, so old saves load cleanly.
        const upgrades = { ...def.upgrades };
        if (data.upgrades && typeof data.upgrades === 'object') {
            for (const key of Object.keys(upgrades)) {
                const v = data.upgrades[key];
                if (Number.isFinite(v) && v >= 0) {
                    const level = Math.floor(v);
                    const max = UPGRADE_MAX_BY_ID[key];
                    upgrades[key] = Number.isFinite(max) ? Math.min(level, max) : level;
                }
            }
        }
        const stats = { ...def.stats };
        if (data.stats && typeof data.stats === 'object') {
            for (const key of Object.keys(stats)) {
                const v = data.stats[key];
                if (Number.isFinite(v) && v >= 0) stats[key] = Math.floor(v);
            }
        }
        // This field is a best-in-one-run cardinality, not a lifetime counter.
        // Clamp tampered/future saves before achievements and menu copy read it.
        stats.vigilSiteKindsMastered = Math.min(4, stats.vigilSiteKindsMastered);
        const settings = { ...def.settings };
        if (data.settings && typeof data.settings === 'object') {
            for (const key of Object.keys(def.settings)) {
                const v = data.settings[key];
                if (typeof def.settings[key] === 'boolean') {
                    if (typeof v === 'boolean') settings[key] = v;
                } else if (Number.isFinite(v)) {
                    settings[key] = Math.max(0, Math.min(1, v));
                }
            }
        }

        // Cosmetics + gear: validate id lists and equipped maps, always
        // seeded with the baseline unlocks/equips (so they survive any save).
        const dc = data.cosmetics && typeof data.cosmetics === 'object' ? data.cosmetics : {};
        const cosmetics = {
            unlocked: validateIdList(dc.unlocked, DEFAULT_UNLOCKED_COSMETICS),
            equipped: validateEquipped(dc.equipped, def.cosmetics.equipped),
        };
        const dg = data.gear && typeof data.gear === 'object' ? data.gear : {};
        const gear = {
            unlocked: validateIdList(dg.unlocked, DEFAULT_UNLOCKED_GEAR),
            equipped: validateEquipped(dg.equipped, def.gear.equipped),
        };

        const db = data.battlePass && typeof data.battlePass === 'object' ? data.battlePass : {};
        const rawBattlePassXp = Number.isFinite(db.xp) && db.xp >= 0 ? Math.floor(db.xp) : 0;
        const battlePass = {
            schema: BP_SCHEMA,
            xp: db.schema === BP_SCHEMA ? rawBattlePassXp : migrateBattlePassXpV1(rawBattlePassXp),
            claimed: Array.isArray(db.claimed)
                ? [...new Set(db.claimed.filter((n) => Number.isInteger(n) && n > 0 && n <= BP_MAX_LEVEL))]
                : [],
        };
        // Schema-2 adds one deterministic Last Light cosmetic beside each legacy
        // gear milestone. A veteran who already claimed that level receives the
        // new piece during normalization; their original gear remains owned.
        for (const [levelText, id] of Object.entries(PASS_COSMETIC_MILESTONES)) {
            if (battlePass.claimed.includes(Number(levelText)) && !cosmetics.unlocked.includes(id)) {
                cosmetics.unlocked.push(id);
            }
        }

        // Equipped ids must be known, owned, and belong to the slot they occupy.
        // Old/tampered values fall back without deleting valid unlock history.
        for (const category of Object.keys(cosmetics.equipped)) {
            const id = cosmetics.equipped[category];
            const item = COSMETIC_LIST.find((entry) => entry.id === id);
            if (!item || item.category !== category || !cosmetics.unlocked.includes(id)) {
                cosmetics.equipped[category] = def.cosmetics.equipped[category];
            }
        }
        for (const category of Object.keys(gear.equipped)) {
            const id = gear.equipped[category];
            const item = GEAR_LIST.find((entry) => entry.id === id);
            if (!item || item.category !== category || !gear.unlocked.includes(id)) {
                gear.equipped[category] = def.gear.equipped[category];
            }
        }

        // Selected character: keep only a known id; otherwise fall back to the
        // default (so an old save with no field, or a stale id, loads cleanly).
        const selectedCharacter = CHARACTER_IDS.includes(data.selectedCharacter)
            ? data.selectedCharacter
            : DEFAULT_CHARACTER;

        const dfr = data.forge && typeof data.forge === 'object' ? data.forge : {};
        const forge = { pity: Number.isFinite(dfr.pity) && dfr.pity >= 0 ? Math.floor(dfr.pity) : 0 };

        // Per-case pity map (caseId → non-negative int opens since last Rare+).
        const dcp = data.casePity && typeof data.casePity === 'object' ? data.casePity : {};
        const casePity = {};
        for (const k of Object.keys(dcp)) {
            if (typeof k === 'string' && k && Number.isFinite(dcp[k]) && dcp[k] >= 0) casePity[k] = Math.floor(dcp[k]);
        }

        const dgam = data.gamble && typeof data.gamble === 'object' ? data.gamble : {};
        const gamble = {
            windowStart: Number.isFinite(dgam.windowStart) && dgam.windowStart >= 0 ? dgam.windowStart : 0,
            count: Number.isFinite(dgam.count) && dgam.count >= 0 ? Math.floor(dgam.count) : 0,
        };

        const selectedMap = MAPS[data.selectedMap] ? data.selectedMap : DEFAULT_MAP;

        // Difficulty: validated string (falls back to 'normal' for old saves /
        // stale values). Must live OUTSIDE settings{} (that loop is numeric).
        const difficulty = DIFFICULTIES.includes(data.difficulty) ? data.difficulty : 'normal';

        // Achievements: a deduped list of known-string claimed ids (mirrors the
        // battlePass.claimed pattern; unknown/old ids are harmless).
        const da = data.achievements && typeof data.achievements === 'object' ? data.achievements : {};
        const achievements = {
            claimed: Array.isArray(da.claimed)
                ? [...new Set(da.claimed.filter((s) => typeof s === 'string' && s))]
                : [],
        };

        // Daily challenges: { day (int), completed (deduped string ids) }. The
        // day rollover/reset is handled in getDailyState (read time), not here.
        const dd = data.daily && typeof data.daily === 'object' ? data.daily : {};
        const daily = {
            day: Number.isInteger(dd.day) && dd.day > 0 ? dd.day : 0,
            completed: Array.isArray(dd.completed)
                ? [...new Set(dd.completed.filter((s) => typeof s === 'string' && s))]
                : [],
        };

        // Daily Road best-of-day: { day (int ≥ 0), best (int ≥ 0), prevBest,
        // caseDay }. Old saves lack the field(s) → defaults (implicit
        // migration, no bump).
        const drd = data.dailyRoad && typeof data.dailyRoad === 'object' ? data.dailyRoad : {};
        const dailyRoad = {
            day: Number.isInteger(drd.day) && drd.day > 0 ? drd.day : 0,
            best: Number.isFinite(drd.best) && drd.best > 0 ? Math.floor(drd.best) : 0,
            prevBest: Number.isFinite(drd.prevBest) && drd.prevBest > 0 ? Math.floor(drd.prevBest) : 0,
            caseDay: Number.isInteger(drd.caseDay) && drd.caseDay > 0 ? drd.caseDay : 0,
        };

        // Day streak: { day (int ≥ 0), count (int ≥ 0) }. Implicit-default field.
        const dst = data.streak && typeof data.streak === 'object' ? data.streak : {};
        const streak = {
            day: Number.isInteger(dst.day) && dst.day > 0 ? dst.day : 0,
            count: Number.isFinite(dst.count) && dst.count > 0 ? Math.floor(dst.count) : 0,
        };

        // Onboarding/staged-menu progress. A pre-update save (runs already
        // recorded, no onboarding key) marks every tab as seen so veterans
        // don't get 9 sudden "NEW" badges the day the staging ships.
        const ALL_TABS = ['play', 'skills', 'attune', 'loadout', 'character', 'shop', 'battlepass', 'stats', 'settings'];
        const dob = data.onboarding && typeof data.onboarding === 'object' ? data.onboarding : null;
        const onboarding = {
            tabsSeen: dob ? validateIdList(dob.tabsSeen, []) : (stats.runs > 0 ? [...ALL_TABS] : []),
            // Guided menu tour: done once finished/skipped. A pre-tour save with
            // recorded runs and no explicit flag is treated as done, so shipping
            // the tour never force-tours a veteran (they can replay via Settings).
            // Note the undefined check INSIDE the dob branch: v1.2 saves already
            // persist onboarding{tabsSeen} without tourDone — those veterans
            // grandfather to done too, not just saves missing the key entirely.
            tourDone: dob
                ? (dob.tourDone === true || (dob.tourDone === undefined && stats.runs > 0))
                : stats.runs > 0,
        };

        // Pact Mastery: { [characterId]: highestClearedTier (non-negative int) }.
        // Sanitize every entry; drop anything non-numeric/negative.
        const pm = data.pactMastery && typeof data.pactMastery === 'object' ? data.pactMastery : {};
        const pactMastery = {};
        for (const k of Object.keys(pm)) {
            const v = pm[k];
            if (typeof k === 'string' && k && Number.isFinite(v) && v > 0) {
                pactMastery[k] = Math.floor(v);
            }
        }

        // Wick Roads relic codex: a deduped list of known-string ids (mirrors the
        // battlePass.claimed / achievements pattern). A v6 save has no field → [].
        const discoveredRelics = validateIdList(data.discoveredRelics, []);

        // Relic Attunement map: { [relicId]: level }. Keep only KNOWN attunable ids
        // with a positive integer level, clamped to that relic's max. Anything else
        // (unknown id, non-numeric, ≤0, over-cap) is dropped/clamped — a corrupt or
        // tampered save can never grant an out-of-bounds attunement.
        const dra = data.relicAttunement && typeof data.relicAttunement === 'object' ? data.relicAttunement : {};
        const relicAttunement = {};
        for (const k of Object.keys(dra)) {
            const def = getAttunable(k);
            const v = dra[k];
            if (def && Number.isFinite(v) && v > 0) {
                relicAttunement[k] = Math.min(def.max, Math.floor(v));
            }
        }

        // KINDLED (roadmap #3) — Hero Attunement: { [charId]: level 1..5 }. Keep only
        // KNOWN hero ids (CHARACTER_IDS — append-only, so update #10's heroes widen the
        // set by data) with a positive integer level, clamped to HERO_ATTUNE_MAX.
        // Unknown id / non-numeric / ≤0 → dropped; over-cap → clamped (tamper-safe).
        const dha = data.heroAttunement && typeof data.heroAttunement === 'object' ? data.heroAttunement : {};
        const heroAttunement = {};
        for (const k of Object.keys(dha)) {
            const v = dha[k];
            if (CHARACTER_IDS.includes(k) && Number.isFinite(v) && v > 0) {
                heroAttunement[k] = Math.min(HERO_ATTUNE_MAX, Math.floor(v));
            }
        }

        // KINDLED — Rites: nested { [charId]: { [riteId]: progress ≥ 0 } }. Both levels
        // are gated: outer key must be a known hero, inner key a known rite of THAT
        // hero (riteIdsFor); values are floored non-negatives. Empty inner maps are
        // dropped. A tampered/foreign key can never inflate a rite or gate an attune.
        const dr = data.rites && typeof data.rites === 'object' ? data.rites : {};
        const rites = {};
        for (const cid of Object.keys(dr)) {
            if (!CHARACTER_IDS.includes(cid)) continue;
            const inner = dr[cid] && typeof dr[cid] === 'object' ? dr[cid] : {};
            const known = riteIdsFor(cid);
            const clean = {};
            for (const rid of Object.keys(inner)) {
                const v = inner[rid];
                if (known.includes(rid) && Number.isFinite(v) && v > 0) clean[rid] = Math.floor(v);
            }
            if (Object.keys(clean).length) rites[cid] = clean;
        }

        // KINDLED — Rite Trial best-of-day, mirroring dailyRoad (drop caseDay).
        const rtd = data.riteTrial && typeof data.riteTrial === 'object' ? data.riteTrial : {};
        const riteTrial = {
            day: Number.isInteger(rtd.day) && rtd.day > 0 ? rtd.day : 0,
            best: Number.isFinite(rtd.best) && rtd.best > 0 ? Math.floor(rtd.best) : 0,
            prevBest: Number.isFinite(rtd.prevBest) && rtd.prevBest > 0 ? Math.floor(rtd.prevBest) : 0,
        };

        // BOSSFORGE — Boss Rush all-time best record (additive; absent on pre-Boss
        // Rush saves → all-zero, never a wipe).
        const brd = data.bossRush && typeof data.bossRush === 'object' ? data.bossRush : {};
        const bossRush = {
            bestBosses: Number.isFinite(brd.bestBosses) && brd.bestBosses > 0 ? Math.floor(brd.bestBosses) : 0,
            bestTime: Number.isFinite(brd.bestTime) && brd.bestTime > 0 ? Math.floor(brd.bestTime) : 0,
            bestScore: Number.isFinite(brd.bestScore) && brd.bestScore > 0 ? Math.floor(brd.bestScore) : 0,
        };

        // Weekly Ember best-of-week (additive; mirrors riteTrial's day-gated shape
        // with the UTC week number as the key).
        const wed = data.weeklyEmber && typeof data.weeklyEmber === 'object' ? data.weeklyEmber : {};
        const weeklyEmber = {
            week: Number.isInteger(wed.week) && wed.week > 0 ? wed.week : 0,
            best: Number.isFinite(wed.best) && wed.best > 0 ? Math.floor(wed.best) : 0,
            prevBest: Number.isFinite(wed.prevBest) && wed.prevBest > 0 ? Math.floor(wed.prevBest) : 0,
        };

        return { totalCoins, upgrades, stats, settings, cosmetics, gear, battlePass, selectedCharacter, forge, casePity, gamble, selectedMap, difficulty, achievements, daily, dailyRoad, streak, onboarding, pactMastery, discoveredRelics, relicAttunement, heroAttunement, rites, riteTrial, bossRush, weeklyEmber, version: 9 };
    }

    save() {
        if (!this.available) return;
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
        } catch (e) {
            console.warn('[SaveSystem] write failed', e);
        }
    }

    addCoins(amount) {
        if (!Number.isFinite(amount) || amount <= 0) return;
        const credit = Math.min(MAX_COIN_BALANCE, Math.floor(amount));
        if (credit <= 0) return;
        const raw = this.data.totalCoins;
        const balance = raw === Infinity ? MAX_COIN_BALANCE
            : Number.isFinite(raw) && raw > 0 ? Math.min(MAX_COIN_BALANCE, Math.floor(raw)) : 0;
        this.data.totalCoins = credit > MAX_COIN_BALANCE - balance
            ? MAX_COIN_BALANCE
            : balance + credit;
        this.save();
    }

    spendCoins(amount) {
        if (!Number.isFinite(amount) || amount <= 0) return false;
        const debit = Math.floor(amount);
        if (debit <= 0 || debit > MAX_COIN_BALANCE) return false;
        const raw = this.data.totalCoins;
        const balance = raw === Infinity ? MAX_COIN_BALANCE
            : Number.isFinite(raw) && raw > 0 ? Math.min(MAX_COIN_BALANCE, Math.floor(raw)) : 0;
        if (balance < debit) return false;
        this.data.totalCoins = balance - debit;
        this.save();
        return true;
    }

    // Wick Roads relic codex. Record a claimed relic id; returns true only the
    // FIRST time it's ever seen (so Game can fire a "new relic" discovery beat).
    discoverRelic(id) {
        if (typeof id !== 'string' || !id) return false;
        if (!Array.isArray(this.data.discoveredRelics)) this.data.discoveredRelics = [];
        if (this.data.discoveredRelics.includes(id)) return false;
        this.data.discoveredRelics.push(id);
        this.save();
        return true;
    }

    getDiscoveredRelics() {
        return Array.isArray(this.data.discoveredRelics) ? this.data.discoveredRelics : [];
    }

    // ── Relic Attunement (coin sink) ─────────────────────────────────────
    // Live attunement map { [relicId]: level }. Always an object.
    getRelicAttunements() {
        if (!this.data.relicAttunement || typeof this.data.relicAttunement !== 'object') {
            this.data.relicAttunement = {};
        }
        return this.data.relicAttunement;
    }

    getRelicAttunement(id) {
        return this.getRelicAttunements()[id] ?? 0;
    }

    // Buy the NEXT attunement level for a relic, spending coins. Returns true only
    // if the purchase succeeded (known attunable id, below its max, coins on hand).
    // Cost + cap live in relics.js so save + shop agree.
    attuneRelic(id) {
        const def = getAttunable(id);
        if (!def) return false;
        const levels = this.getRelicAttunements();
        const cur = levels[id] ?? 0;
        if (cur >= def.max) return false;
        const cost = attuneCost(def, cur);
        if (!this.spendCoins(cost)) return false;   // spendCoins saves on success
        levels[id] = cur + 1;
        this.save();
        return true;
    }

    // ── Hero Attunement (per-hero coin sink, KINDLED #3) ─────────────────
    // Live map { [charId]: level 0..5 }. Always an object (lazy self-heal).
    getHeroAttunements() {
        if (!this.data.heroAttunement || typeof this.data.heroAttunement !== 'object') {
            this.data.heroAttunement = {};
        }
        return this.data.heroAttunement;
    }

    getHeroAttunement(charId) {
        return this.getHeroAttunements()[charId] ?? 0;
    }

    // Buy the NEXT attunement level for a hero, spending coins. Rungs 3/4/5 are
    // rite-gated (heroAttuneRiteGate) — coins alone can't buy mastery. Returns true
    // only on success (known hero, below max, rite-gate met, coins on hand). Cost +
    // gate live in heroAttunement.js so save + shop agree.
    attuneHero(charId) {
        if (!CHARACTER_IDS.includes(charId)) return false;
        const levels = this.getHeroAttunements();
        const cur = levels[charId] ?? 0;
        if (cur >= HERO_ATTUNE_MAX) return false;
        const next = cur + 1;
        if (ritesCompletedCount(this.data, charId) < heroAttuneRiteGate(next)) return false;  // rite-gated rung
        const cost = heroAttuneCost(cur);
        if (!this.spendCoins(cost)) return false;   // spendCoins saves on success
        levels[charId] = next;
        this.save();
        return true;
    }

    // ── Rites (per-hero mastery progress, KINDLED #3) ────────────────────
    // Live nested map { [charId]: { [riteId]: progress } }. Always an object.
    getRites() {
        if (!this.data.rites || typeof this.data.rites !== 'object') this.data.rites = {};
        return this.data.rites;
    }

    // Persist a hero's rite-progress map (already validated/accrued by the caller —
    // accrueRites in rites.js). Sparse: a hero with no progress is simply absent.
    setHeroRites(charId, map) {
        if (!CHARACTER_IDS.includes(charId) || !map || typeof map !== 'object') return;
        this.getRites()[charId] = map;
        this.save();
    }

    // ── Rite Trial best-of-day (mirrors recordDailyRoadScore) ────────────
    // On a new UTC day, reset best (carrying yesterday's into prevBest only when the
    // stored record is EXACTLY day-1, so a stale record can't masquerade as yesterday).
    // Also lifts the lifetime stats.riteTrialBest. Returns { best, firstToday }.
    recordRiteTrial(day, score) {
        if (!Number.isInteger(day) || day <= 0) return { best: false, firstToday: false };
        const old = this.data.riteTrial;
        const firstToday = !old || typeof old !== 'object' || old.day !== day;
        if (firstToday) {
            this.data.riteTrial = { day, best: 0, prevBest: (old && old.day === day - 1) ? (old.best ?? 0) : 0 };
        }
        const v = Math.max(0, Math.floor(score || 0));
        let best = false;
        if (v > this.data.riteTrial.best) { this.data.riteTrial.best = v; best = true; }
        if (this.data.stats && v > (this.data.stats.riteTrialBest ?? 0)) this.data.stats.riteTrialBest = v;
        this.save();
        return { best, firstToday };
    }

    // ── Boss Rush all-time best record (BOSSFORGE) ───────────────────────
    // Not date-scoped (freeplay). Tracks the most bosses felled, the fastest
    // FULL clear (seconds), and the best score. Returns which fields were newly
    // beaten so the end screen can flag them. Additive — safe on old saves.
    recordBossRush({ bossesDefeated = 0, timeSurvived = 0, score = 0, cleared = false } = {}) {
        const br = this.data.bossRush || (this.data.bossRush = { bestBosses: 0, bestTime: 0, bestScore: 0 });
        const beat = { bosses: false, time: false, score: false };
        const b = Math.max(0, Math.floor(bossesDefeated));
        if (b > (br.bestBosses ?? 0)) { br.bestBosses = b; beat.bosses = true; }
        const s = Math.max(0, Math.floor(score));
        if (s > (br.bestScore ?? 0)) { br.bestScore = s; beat.score = true; }
        // Fastest time is meaningful only for a FULL clear (else a quick death
        // would masquerade as the best time).
        if (cleared) {
            const tt = Math.max(0, Math.floor(timeSurvived));
            if (!br.bestTime || tt < br.bestTime) { br.bestTime = tt; beat.time = true; }
        }
        this.save();
        return beat;
    }

    // ── Weekly Ember best-of-week (mirrors recordRiteTrial, keyed by UTC week) ──
    // On a new week, reset best (carrying last week's into prevBest only when the
    // stored record is EXACTLY week-1, so a stale record can't masquerade as last
    // week). Also lifts the lifetime stats.weeklyEmberBest. Returns { best, firstThisWeek }.
    recordWeeklyEmber(week, score) {
        if (!Number.isInteger(week) || week <= 0) return { best: false, firstThisWeek: false };
        const old = this.data.weeklyEmber;
        const firstThisWeek = !old || typeof old !== 'object' || old.week !== week;
        if (firstThisWeek) {
            this.data.weeklyEmber = { week, best: 0, prevBest: (old && old.week === week - 1) ? (old.best ?? 0) : 0 };
        }
        const v = Math.max(0, Math.floor(score || 0));
        let best = false;
        if (v > this.data.weeklyEmber.best) { this.data.weeklyEmber.best = v; best = true; }
        if (this.data.stats && v > (this.data.stats.weeklyEmberBest ?? 0)) this.data.stats.weeklyEmberBest = v;
        this.save();
        return { best, firstThisWeek };
    }

    getUpgradeLevel(id) {
        return this.data.upgrades[id] ?? 0;
    }

    incrementUpgrade(id) {
        if (!(id in this.data.upgrades)) return false;
        const current = Number.isFinite(this.data.upgrades[id])
            ? Math.max(0, Math.floor(this.data.upgrades[id]))
            : 0;
        const max = UPGRADE_MAX_BY_ID[id];
        if (Number.isFinite(max) && current >= max) return false;
        this.data.upgrades[id] = current + 1;
        this.save();
        return true;
    }

    // Fold a finished run into lifetime totals + best-run records. Returns
    // a record of which "best" fields were newly beaten this run so the
    // game-over screen can flag them with a NEW BEST banner.
    recordRun(summary) {
        const s = this.data.stats || (this.data.stats = {
            bestTime: 0, bestWave: 0, bestLevel: 0, bestKills: 0, bestBosses: 0,
            runs: 0, totalKills: 0, totalBosses: 0, totalCoinsEarned: 0,
        });
        const beat = { time: false, wave: false, level: false, kills: false };

        const time = Math.floor(summary.time ?? 0);
        const wave = Math.floor(summary.finalWave ?? 0);
        const level = Math.floor(summary.level ?? 0);
        const kills = Math.floor(summary.kills ?? 0);
        const bosses = Math.floor(summary.bossesDefeated ?? 0);
        const coins = Math.floor(summary.coinsEarned ?? 0);

        if (time > s.bestTime) { s.bestTime = time; beat.time = true; }
        if (wave > s.bestWave) { s.bestWave = wave; beat.wave = true; }
        if (level > s.bestLevel) { s.bestLevel = level; beat.level = true; }
        if (kills > s.bestKills) { s.bestKills = kills; beat.kills = true; }
        if (bosses > s.bestBosses) s.bestBosses = bosses;

        s.runs += 1;
        s.totalKills += kills;
        s.totalBosses += bosses;
        s.totalCoinsEarned += Math.max(0, coins);
        s.vigilSitesActivated = (s.vigilSitesActivated || 0)
            + Math.max(0, Math.floor(summary.vigilSitesActivated ?? 0));
        s.vigilSiteKindsMastered = Math.min(4, Math.max(
            s.vigilSiteKindsMastered || 0,
            Math.max(0, Math.floor(summary.vigilSiteKindsMastered ?? 0)),
        ));
        s.encountersCleared = (s.encountersCleared || 0)
            + Math.max(0, Math.floor(summary.encountersCleared ?? 0));
        s.guardianPacksDefeated = (s.guardianPacksDefeated || 0)
            + Math.max(0, Math.floor(summary.guardianPacksDefeated ?? 0));

        this.save();
        return beat;
    }

    getSetting(key) {
        return this.data.settings ? this.data.settings[key] : undefined;
    }

    setSetting(key, value) {
        if (!this.data.settings) this.data.settings = {};
        this.data.settings[key] = value;
        this.save();
    }

    // ── Cosmetics ──────────────────────────────────────────────────────
    isCosmeticUnlocked(id) {
        return this.data.cosmetics.unlocked.includes(id);
    }

    // Returns true if this call NEWLY unlocked it (false if already owned) —
    // the case system uses that to convert duplicates into coins.
    unlockCosmetic(id) {
        if (this.isCosmeticUnlocked(id)) return false;
        this.data.cosmetics.unlocked.push(id);
        this.save();
        return true;
    }

    equipCosmetic(category, id) {
        if (!(category in this.data.cosmetics.equipped)) return false;
        if (id !== null) {
            const item = COSMETIC_LIST.find((entry) => entry.id === id);
            if (!item || item.category !== category || !this.isCosmeticUnlocked(id)) return false;
        }
        this.data.cosmetics.equipped[category] = id;
        this.save();
        return true;
    }

    getEquippedCosmetics() {
        return this.data.cosmetics.equipped;
    }

    // ── Gear ───────────────────────────────────────────────────────────
    isGearUnlocked(id) {
        return this.data.gear.unlocked.includes(id);
    }

    unlockGear(id) {
        if (this.isGearUnlocked(id)) return false;
        this.data.gear.unlocked.push(id);
        this.save();
        return true;
    }

    equipGear(category, id) {
        if (!(category in this.data.gear.equipped)) return false;
        if (id !== null) {
            const item = GEAR_LIST.find((entry) => entry.id === id);
            if (!item || item.category !== category || !this.isGearUnlocked(id)) return false;
        }
        this.data.gear.equipped[category] = id;
        this.save();
        return true;
    }

    getEquippedGear() {
        return this.data.gear.equipped;
    }

    // ── Character selection ──────────────────────────────────────────────
    getSelectedCharacter() {
        return this.data.selectedCharacter ?? DEFAULT_CHARACTER;
    }

    setSelectedCharacter(id) {
        if (!CHARACTER_IDS.includes(id)) return false;
        this.data.selectedCharacter = id;
        this.save();
        return true;
    }

    // ── Map selection (unlock-gated by lifetime boss kills) ──────────────
    // A map counts as unlocked if its boss-kill threshold is met OR the testing
    // "unlockMaps" setting is on (free unlock for trying the new biome).
    mapUnlocked(id) {
        return isMapUnlocked(id, this.data.stats?.totalBosses) || this.getSetting('unlockMaps') === true;
    }

    getSelectedMap() {
        const id = this.data.selectedMap ?? DEFAULT_MAP;
        // Defensively fall back if a saved map isn't unlocked (e.g. after a reset).
        return this.mapUnlocked(id) ? id : DEFAULT_MAP;
    }

    setSelectedMap(id) {
        if (!MAPS[id]) return false;
        if (!this.mapUnlocked(id)) return false;
        this.data.selectedMap = id;
        this.save();
        return true;
    }

    // ── Battle pass ──────────────────────────────────────────────────────
    getBattlePassXp() {
        return this.data.battlePass.xp;
    }

    addBattlePassXp(amount) {
        if (!Number.isFinite(amount) || amount <= 0) return { added: 0, everflameCaches: 0, everflameCoins: 0 };
        const before = bpProgress(this.data.battlePass.xp);
        const added = Math.floor(amount);
        this.data.battlePass.xp = Math.min(Number.MAX_SAFE_INTEGER, this.data.battlePass.xp + added);
        const after = bpProgress(this.data.battlePass.xp);
        const everflameCaches = Math.max(0, after.everflameRank - before.everflameRank);
        const everflameCoins = everflameCaches * BP_EVERFLAME_COINS;
        if (everflameCoins > 0) this.data.totalCoins += everflameCoins;
        this.save();
        return { added, everflameCaches, everflameCoins };
    }

    isLevelClaimed(level) {
        return this.data.battlePass.claimed.includes(level);
    }

    claimLevel(level) {
        if (this.isLevelClaimed(level)) return false;
        this.data.battlePass.claimed.push(level);
        this.save();
        return true;
    }

    incrementStat(key, amount = 1) {
        if (!this.data.stats) return;
        this.data.stats[key] = (this.data.stats[key] ?? 0) + amount;
        this.save();
    }

    // ── Difficulty tier ──────────────────────────────────────────────────
    getDifficulty() {
        return DIFFICULTIES.includes(this.data.difficulty) ? this.data.difficulty : 'normal';
    }

    setDifficulty(id) {
        if (!DIFFICULTIES.includes(id)) return false;
        this.data.difficulty = id;
        this.save();
        return true;
    }

    // ── Achievements (one-time milestone claims) ─────────────────────────
    isAchievementClaimed(id) {
        return !!this.data.achievements && this.data.achievements.claimed.includes(id);
    }

    // Marks an achievement claimed. Returns true if this call NEWLY claimed it.
    claimAchievement(id) {
        if (!this.data.achievements) this.data.achievements = { claimed: [] };
        if (this.data.achievements.claimed.includes(id)) return false;
        this.data.achievements.claimed.push(id);
        this.save();
        return true;
    }

    // ── Daily challenges ─────────────────────────────────────────────────
    // Returns the live daily state, AUTO-RESETTING completed[] when the day
    // rolls over (so a new day's three challenges are fresh). `day` is passed
    // in (computed from the clock by the caller / content helper) so this stays
    // testable without touching Date here.
    getDailyState(day) {
        if (!this.data.daily) this.data.daily = { day: 0, completed: [] };
        if (this.data.daily.day !== day) {
            this.data.daily.day = day;
            this.data.daily.completed = [];
            this.save();
        }
        return this.data.daily;
    }

    isDailyComplete(day, id) {
        return this.getDailyState(day).completed.includes(id);
    }

    // Marks a daily challenge complete for `day`. Returns true if NEWLY done.
    markDailyComplete(day, id) {
        const d = this.getDailyState(day);
        if (d.completed.includes(id)) return false;
        d.completed.push(id);
        this.save();
        return true;
    }

    // ── Pact Mastery (per-character highest cleared Pact tier) ───────────
    getPactMastery(characterId) {
        if (!this.data.pactMastery) this.data.pactMastery = {};
        return this.data.pactMastery[characterId] ?? 0;
    }

    // Record a 3-boss CLEAR at `tier` (active-Trial count) for a character.
    // Returns the number of NEW tier steps gained (0 if not a new best), so the
    // caller can pay a one-time bounty per notch climbed.
    recordPactClear(characterId, tier) {
        if (!characterId || !Number.isFinite(tier) || tier <= 0) return 0;
        if (!this.data.pactMastery) this.data.pactMastery = {};
        const prev = this.data.pactMastery[characterId] ?? 0;
        const t = Math.floor(tier);
        if (t <= prev) return 0;
        this.data.pactMastery[characterId] = t;
        this.save();
        return t - prev;
    }

    // ── Gauntlet (endless) score ─────────────────────────────────────────
    // Banks an endless-continuation score; bumps the best + the run counter.
    // Returns true if it's a new personal best.
    recordGauntletScore(score) {
        const s = this.data.stats;
        if (!s) return false;
        const v = Math.max(0, Math.floor(score || 0));
        s.gauntletRuns = (s.gauntletRuns ?? 0) + 1;
        let best = false;
        if (v > (s.bestGauntletScore ?? 0)) { s.bestGauntletScore = v; best = true; }
        this.save();
        return best;
    }

    // ── Daily Road best-of-day ───────────────────────────────────────────
    // Bank a curated-daily-run score for `day`, auto-resetting the record when
    // the day rolls (mirrors getDailyState). The roll stashes YESTERDAY's best
    // into prevBest (only when the old record is exactly day-1, so a stale
    // record never masquerades as "yesterday") and carries caseDay across (a
    // past day's latch can never match today, so it's harmless). Returns
    // { best: new-best-today?, firstToday: first daily score of this day? }.
    recordDailyRoadScore(day, score) {
        const old = this.data.dailyRoad;
        const firstToday = !old || typeof old !== 'object' || old.day !== day;
        if (firstToday) {
            this.data.dailyRoad = {
                day, best: 0,
                prevBest: (old && old.day === day - 1) ? (old.best ?? 0) : 0,
                caseDay: (old && old.caseDay) || 0,
            };
        }
        const v = Math.max(0, Math.floor(score || 0));
        let best = false;
        if (v > this.data.dailyRoad.best) { this.data.dailyRoad.best = v; best = true; }
        this.save();
        return { best, firstToday };
    }

    // Once-a-day Daily Road free-case latch: returns true only the FIRST call
    // for `day` (Game grants the first-CLEAR-of-day Ember case on it — see
    // _bankDailyRoad). Persisted on dailyRoad.caseDay, so a failed attempt
    // before the clear never burns the day's case.
    claimDailyRoadCase(day) {
        if (!Number.isInteger(day) || day <= 0) return false;
        if (!this.data.dailyRoad || typeof this.data.dailyRoad !== 'object') {
            this.data.dailyRoad = { day: 0, best: 0, prevBest: 0, caseDay: 0 };
        }
        if (this.data.dailyRoad.caseDay === day) return false;
        this.data.dailyRoad.caseDay = day;
        this.save();
        return true;
    }

    // ── Day streak (celebratory only — never punishes) ───────────────────
    // Marks `day` as played and returns the streak length. Consecutive days
    // extend it; a gap restarts at 1; same-day calls are idempotent.
    recordDayStreak(day) {
        if (!Number.isInteger(day) || day <= 0) return 0;
        if (!this.data.streak || typeof this.data.streak !== 'object') this.data.streak = { day: 0, count: 0 };
        const st = this.data.streak;
        if (st.day === day) return st.count;
        st.count = st.day === day - 1 ? (st.count ?? 0) + 1 : 1;
        st.day = day;
        this.save();
        return st.count;
    }

    // ── Staged menu tabs ─────────────────────────────────────────────────
    // Acknowledge a tab's one-time "NEW" badge (recorded on first open).
    markTabSeen(id) {
        if (typeof id !== 'string' || !id) return;
        if (!this.data.onboarding || typeof this.data.onboarding !== 'object') {
            this.data.onboarding = { tabsSeen: [], tourDone: false };
        }
        const seen = this.data.onboarding.tabsSeen;
        if (seen.includes(id)) return;
        seen.push(id);
        this.save();
    }

    // ── Guided menu tour ─────────────────────────────────────────────────
    // Latched when the tour finishes or is skipped; cleared by the Settings
    // "Replay Tutorial" button so the tour re-arms on the next menu visit.
    isTourDone() {
        return this.data.onboarding?.tourDone === true;
    }

    setTourDone(done) {
        if (!this.data.onboarding || typeof this.data.onboarding !== 'object') {
            this.data.onboarding = { tabsSeen: [], tourDone: false };
        }
        this.data.onboarding.tourDone = !!done;
        this.save();
    }

    // ── Gamble quota: 5 plays per rolling hour ───────────────────────────
    // { remaining, resetInMs } for the current window (auto-resets when the
    // hour lapses). Used by the shop to show "Plays: X/5 · resets in Ym".
    gamblePlaysInfo() {
        const max = 5, windowMs = 3600000;
        const g = this.data.gamble || { windowStart: 0, count: 0 };
        const now = Date.now();
        if (now - g.windowStart >= windowMs) return { remaining: max, max, resetInMs: 0 };
        return { remaining: Math.max(0, max - g.count), max, resetInMs: windowMs - (now - g.windowStart) };
    }

    // Spend one play if the quota allows (resets the window when the hour
    // lapses). Returns true if a play was consumed, false if none remain.
    consumeGamblePlay() {
        const max = 5, windowMs = 3600000;
        if (!this.data.gamble) this.data.gamble = { windowStart: 0, count: 0 };
        const g = this.data.gamble;
        const now = Date.now();
        if (now - g.windowStart >= windowMs) { g.windowStart = now; g.count = 0; }
        if (g.count >= max) return false;
        g.count += 1;
        this.save();
        return true;
    }

    // Testing cheat: unlock every gear + cosmetic at once. Returns how many
    // were newly unlocked.
    cheatUnlockAll() {
        let n = 0;
        for (const g of GEAR_LIST) if (this.unlockGearSilent(g.id)) n++;
        for (const c of COSMETIC_LIST) if (this.unlockCosmeticSilent(c.id)) n++;
        this.save();
        return n;
    }

    // Internal unlock helpers that don't save per-call (cheatUnlockAll saves once).
    unlockGearSilent(id) {
        if (this.data.gear.unlocked.includes(id)) return false;
        this.data.gear.unlocked.push(id); return true;
    }
    unlockCosmeticSilent(id) {
        if (this.data.cosmetics.unlocked.includes(id)) return false;
        this.data.cosmetics.unlocked.push(id); return true;
    }

    reset() {
        this.data = defaultData();
        this.save();
    }
}
