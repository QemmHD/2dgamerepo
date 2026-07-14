// localStorage-backed meta-progression save.
//
// One key for the whole game. On boot, _loadOrDefault validates whatever
// was stored and falls back to defaults for missing fields or corrupted
// JSON. All public methods are no-ops on localStorage failures (private
// mode, exceeded quota, blocked storage) so the game never crashes.

import { DEFAULT_UNLOCKED_GEAR, DEFAULT_EQUIPPED_GEAR, GEAR_LIST } from '../content/gear.js';
import {
    DEFAULT_UNLOCKED_COSMETICS,
    DEFAULT_EQUIPPED_COSMETICS,
    COSMETIC_LIST,
    COSMETIC_SETS,
    cosmeticById,
    cosmeticCoinCost,
} from '../content/cosmetics.js';
import {
    RUN_OBJECTIVE_CANDIDATES,
    RUN_OBJECTIVE_MAX_REWARD_MULTIPLIER,
    RUN_OBJECTIVE_PHASES,
} from '../content/objectives.js';
import { CHARACTER_IDS, DEFAULT_CHARACTER } from '../content/characters.js';
import { MAPS, DEFAULT_MAP } from '../content/maps.js';
import { PERMANENT_UPGRADES } from '../content/permanentUpgrades.js';
import { getAttunable, attuneCost } from '../content/relics.js';
import { HERO_ATTUNE_MAX, heroAttuneCost, heroAttuneRiteGate } from '../content/heroAttunement.js';
import { riteIdsFor, ritesCompletedCount } from '../content/rites.js';
import {
    BP_EVERFLAME_COINS, BP_MAX_LEVEL, BP_SCHEMA, PASS_COSMETIC_MILESTONES,
    bpProgress, migrateBattlePassXpV1,
} from '../content/battlePass.js';
import {
    DEFAULT_CAPTION_DETAIL,
    DEFAULT_UI_SCALE,
    DEFAULT_VIBRATION_STRENGTH,
    normalizeCaptionDetail,
    normalizeCaptions,
    normalizeHighContrast,
    normalizeMonoAudio,
    normalizeUiScale,
    normalizeVibrationStrength,
} from './AccessibilityPreferences.js';
import {
    CAMPAIGN_MAP_ORDER,
    CAMPAIGN_SAVE_VERSION,
    campaignMapUnlocked as campaignMapUnlockedByProgress,
    createCampaignProgress,
    getCampaignMapUnlockStatus,
    normalizeCampaignProgress,
    recordCampaignBossDefeat as applyCampaignBossDefeat,
} from './CampaignProgression.js';

const SAVE_KEY = 'monkey-survivor:save:v1';
export const MAX_COIN_BALANCE = Number.MAX_SAFE_INTEGER;
export const GUIDED_OBJECTIVE_SCHEMA = 1;
export const GUIDED_OBJECTIVE_RECEIPT_LIMIT = 96;
const GUIDED_OBJECTIVE_META = new Map(RUN_OBJECTIVE_PHASES.flatMap((phase, phaseIndex) =>
    (RUN_OBJECTIVE_CANDIDATES[phase.id] || []).map((objective) => [objective.id, {
        phaseIndex,
        reward: objective.reward,
    }])));
const GUIDED_OBJECTIVE_RECEIPT_RE = /^go([0-9a-z]{1,46}):([0-2]):([A-Za-z0-9_-]{1,64})$/;
const GUIDED_OBJECTIVE_RUN_RE = /^go([0-9a-z]{1,46})$/;
const UPGRADE_MAX_BY_ID = Object.freeze(Object.fromEntries(
    PERMANENT_UPGRADES.map((upgrade) => [upgrade.id, upgrade.maxLevel]),
));
const COSMETIC_PRESET_SLOTS = Object.freeze(Object.keys(DEFAULT_EQUIPPED_COSMETICS));

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function parseGuidedObjectiveReceiptId(value) {
    if (typeof value !== 'string') return false;
    const match = GUIDED_OBJECTIVE_RECEIPT_RE.exec(value);
    if (!match) return null;
    const meta = GUIDED_OBJECTIVE_META.get(match[3]);
    if (!meta || meta.phaseIndex !== Number(match[2])) return null;
    const serial = Number.parseInt(match[1], 36);
    if (!Number.isSafeInteger(serial) || serial < 1) return null;
    return { receiptId: value, serial, objectiveId: match[3], ...meta };
}

function parseGuidedObjectiveRunSerial(value) {
    if (typeof value !== 'string') return 0;
    const match = GUIDED_OBJECTIVE_RUN_RE.exec(value);
    if (!match) return 0;
    const serial = Number.parseInt(match[1], 36);
    return Number.isSafeInteger(serial) && serial > 0 ? serial : 0;
}

function normalizeGuidedObjectives(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const receipts = [];
    const seen = new Set();
    const seenSlots = new Set();
    let maxRetainedSerial = 0;
    if (Array.isArray(source.receipts)) {
        for (const value of source.receipts) {
            const parsed = parseGuidedObjectiveReceiptId(value);
            const slot = parsed ? `${parsed.serial}:${parsed.phaseIndex}` : null;
            if (!parsed || seen.has(value) || seenSlots.has(slot)) continue;
            seen.add(value);
            seenSlots.add(slot);
            receipts.push(value);
            maxRetainedSerial = Math.max(maxRetainedSerial, parsed.serial);
        }
    }
    const suppliedNext = Number.isSafeInteger(source.nextRunId) && source.nextRunId > 0
        ? source.nextRunId : 1;
    // Never reissue a retained run prefix after a malformed/rolled-back save.
    // Otherwise a legitimate new completion would look like a duplicate and
    // silently pay zero.
    const nextRunId = Math.min(
        MAX_COIN_BALANCE,
        Math.max(suppliedNext, maxRetainedSerial + 1),
    );
    const suppliedActive = Number.isSafeInteger(source.activeRunSerial)
        && source.activeRunSerial > 0 ? source.activeRunSerial : 0;
    const activeRunSerial = suppliedActive > 0
        && (suppliedActive + 1 === nextRunId
            || (suppliedActive === MAX_COIN_BALANCE && nextRunId === 1))
        ? suppliedActive : 0;
    return {
        schema: GUIDED_OBJECTIVE_SCHEMA,
        nextRunId,
        activeRunSerial,
        receipts: receipts.slice(-GUIDED_OBJECTIVE_RECEIPT_LIMIT),
    };
}

// OS motion preference is consulted only when creating a genuinely fresh
// profile (including an in-memory/corrupt/reset profile). Existing saves keep
// the historical validation default below, so an older save that predates the
// setting does not silently change behavior after an OS preference change.
function prefersReducedMotion() {
    try {
        return typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia(REDUCED_MOTION_QUERY)?.matches === true;
    } catch (e) {
        // matchMedia can be absent in tests/workers or throw in restricted web
        // views. A safe false fallback preserves the pre-1.1 behavior.
        return false;
    }
}

function defaultData({ reducedEffects = false } = {}) {
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
            reducedEffects: reducedEffects === true,
            uiScale: DEFAULT_UI_SCALE,
            highContrast: false,
            volMusic: 0.7,
            volSfx: 0.8,
            volVoice: 0.8,
            monoAudio: false,
            // Captions start on so a new player never has to hear a line before
            // discovering the control. Essential keeps the lane focused on
            // dialogue, warnings and state changes; Full adds world texture.
            captions: true,
            captionDetail: DEFAULT_CAPTION_DETAIL,
            // Device/browser support is capability-gated at runtime. Low is a
            // restrained default and Off always cancels active vibration.
            vibration: DEFAULT_VIBRATION_STRENGTH,
        },
        // Character cosmetics (visual only). unlocked = owned ids; equipped =
        // one id per slot.
        cosmetics: {
            unlocked: [...DEFAULT_UNLOCKED_COSMETICS],
            equipped: { ...DEFAULT_EQUIPPED_COSMETICS },
            // Per-hero looks are additive. `equipped` remains the compatibility
            // mirror for the selected hero so existing render/menu code keeps
            // reading the same stable shape.
            presets: createCosmeticPresets(DEFAULT_EQUIPPED_COSMETICS),
            pursuitSetId: null,
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
        // Exact authored-boss ledger. Map access is derived from the three
        // unique predecessor bosses, never from the lifetime boss counter.
        campaignProgress: createCampaignProgress(),
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
        // Stable, bounded receipts for the three-phase guided Run Path. Rewards
        // stay escrowed in run memory until a genuine death/victory, then this
        // ledger makes the single final credit replay-safe.
        guidedObjectives: {
            schema: GUIDED_OBJECTIVE_SCHEMA,
            nextRunId: 1,
            activeRunSerial: 0,
            receipts: [],
        },
        version: CAMPAIGN_SAVE_VERSION,
    };
}

function freshDefaultData() {
    return defaultData({ reducedEffects: prefersReducedMotion() });
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

function copyCosmeticLook(look = DEFAULT_EQUIPPED_COSMETICS) {
    return Object.fromEntries(COSMETIC_PRESET_SLOTS.map((category) => [
        category,
        look && Object.prototype.hasOwnProperty.call(look, category)
            ? look[category]
            : DEFAULT_EQUIPPED_COSMETICS[category],
    ]));
}

function createCosmeticPresets(look = DEFAULT_EQUIPPED_COSMETICS) {
    return Object.fromEntries(CHARACTER_IDS.map((characterId) => [
        characterId,
        copyCosmeticLook(look),
    ]));
}

// A preset may only retain known, owned items in their authored slots. The
// supplied fallback is already validated, so malformed or stale fields repair
// per slot without discarding the rest of a veteran's look.
function validateCosmeticLook(raw, fallback, ownedIds) {
    const candidate = validateEquipped(raw, fallback);
    const out = {};
    for (const category of COSMETIC_PRESET_SLOTS) {
        const id = candidate[category];
        const item = cosmeticById(id);
        out[category] = item && item.category === category && ownedIds.has(id)
            ? id
            : fallback[category];
    }
    return out;
}

export class SaveSystem {
    constructor() {
        // QA map access is intentionally session-only. It must never contaminate
        // campaign progression, selection, or serialized settings.
        this._session = { unlockMaps: false, selectedMap: null };
        // A persisted run serial is useful for durable retirement, but never
        // sufficient authority to pay a receipt. Reloading creates a new
        // SaveSystem with no in-memory authority and therefore forfeits escrow.
        this._guidedObjectiveSessionSerial = 0;
        this.available = this._probe();
        this.data = this._loadOrDefault();
        const interrupted = normalizeGuidedObjectives(this.data.guidedObjectives);
        if (interrupted.activeRunSerial > 0) {
            interrupted.activeRunSerial = 0;
            this.data.guidedObjectives = interrupted;
            this.save();
        }
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
        if (!this.available) return freshDefaultData();
        let raw = null;
        try {
            raw = localStorage.getItem(SAVE_KEY);
        } catch (e) {
            console.warn('[SaveSystem] read failed', e);
            return freshDefaultData();
        }
        if (!raw) return freshDefaultData();
        try {
            const parsed = JSON.parse(raw);
            // Valid JSON can still be a corrupt save (null, scalar, or array).
            // Treat those exactly like malformed JSON: reset to fresh defaults
            // and inherit the current OS preference.
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return freshDefaultData();
            }
            return this._validate(parsed);
        } catch (e) {
            console.warn('[SaveSystem] corrupted save, resetting', e);
            return freshDefaultData();
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
        const campaignProgress = normalizeCampaignProgress({
            version: data.version,
            campaignProgress: data.campaignProgress,
            totalBosses: stats.totalBosses,
        });
        const settings = { ...def.settings };
        if (data.settings && typeof data.settings === 'object') {
            for (const key of Object.keys(def.settings)) {
                // Missing additive preferences inherit their documented fresh
                // defaults. Only explicitly stored values enter the strict
                // normalizers; otherwise a missing `captions` key would be
                // mistaken for an explicit false choice during migration.
                if (!Object.prototype.hasOwnProperty.call(data.settings, key)) continue;
                const v = data.settings[key];
                if (key === 'uiScale') {
                    settings.uiScale = normalizeUiScale(v);
                } else if (key === 'highContrast') {
                    settings.highContrast = normalizeHighContrast(v);
                } else if (key === 'monoAudio') {
                    settings.monoAudio = normalizeMonoAudio(v);
                } else if (key === 'captions') {
                    settings.captions = normalizeCaptions(v);
                } else if (key === 'captionDetail') {
                    settings.captionDetail = normalizeCaptionDetail(v);
                } else if (key === 'vibration') {
                    settings.vibration = normalizeVibrationStrength(v);
                } else if (typeof def.settings[key] === 'boolean') {
                    if (typeof v === 'boolean') settings[key] = v;
                } else if (Number.isFinite(v)) {
                    settings[key] = Math.max(0, Math.min(1, v));
                }
            }
            // Before this preference existed, dialogue followed the SFX bus.
            // Preserve that exact mix for an upgraded save instead of suddenly
            // restoring muted/quiet voices to the new-profile 80% default.
            if (!Object.prototype.hasOwnProperty.call(data.settings, 'volVoice')) {
                settings.volVoice = settings.volSfx;
            }
        }

        // Selected character is needed while normalizing per-hero cosmetic
        // presets. Keeping it here also lets `cosmetics.equipped` remain an
        // exact compatibility mirror for the selected hero.
        const selectedCharacter = CHARACTER_IDS.includes(data.selectedCharacter)
            ? data.selectedCharacter
            : DEFAULT_CHARACTER;

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
        const ownedCosmeticIds = new Set(cosmetics.unlocked);
        cosmetics.equipped = validateCosmeticLook(
            cosmetics.equipped,
            def.cosmetics.equipped,
            ownedCosmeticIds,
        );

        // Old saves have no presets: clone their validated global look into
        // every known hero, exactly preserving what they saw before migration.
        // New saves validate each hero independently, then refresh the legacy
        // `equipped` mirror from the currently selected hero.
        const rawPresets = dc.presets && typeof dc.presets === 'object'
            && !Array.isArray(dc.presets) ? dc.presets : null;
        cosmetics.presets = {};
        for (const characterId of CHARACTER_IDS) {
            const rawPreset = rawPresets && dc.presets[characterId]
                && typeof dc.presets[characterId] === 'object'
                && !Array.isArray(dc.presets[characterId])
                ? dc.presets[characterId] : null;
            cosmetics.presets[characterId] = rawPreset
                ? validateCosmeticLook(rawPreset, cosmetics.equipped, ownedCosmeticIds)
                : copyCosmeticLook(cosmetics.equipped);
        }
        if (rawPresets) cosmetics.equipped = copyCosmeticLook(cosmetics.presets[selectedCharacter]);
        cosmetics.pursuitSetId = typeof dc.pursuitSetId === 'string'
            && COSMETIC_SETS.some((set) => set.id === dc.pursuitSetId)
            ? dc.pursuitSetId : null;

        for (const category of Object.keys(gear.equipped)) {
            const id = gear.equipped[category];
            const item = GEAR_LIST.find((entry) => entry.id === id);
            if (!item || item.category !== category || !gear.unlocked.includes(id)) {
                gear.equipped[category] = def.gear.equipped[category];
            }
        }

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

        const storedMap = MAPS[data.selectedMap] ? data.selectedMap : DEFAULT_MAP;
        const selectedMap = campaignMapUnlockedByProgress(campaignProgress, storedMap)
            ? storedMap
            : DEFAULT_MAP;

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

        // Guided objectives own an additive nested schema. Keep campaign save
        // version 10 stable while repairing tampered counters and dropping
        // malformed/unknown/unbounded reward receipts.
        const guidedObjectives = normalizeGuidedObjectives(data.guidedObjectives);

        return { totalCoins, upgrades, stats, settings, cosmetics, gear, battlePass, selectedCharacter, forge, casePity, gamble, selectedMap, campaignProgress, difficulty, achievements, daily, dailyRoad, streak, onboarding, pactMastery, discoveredRelics, relicAttunement, heroAttunement, rites, riteTrial, bossRush, weeklyEmber, guidedObjectives, version: CAMPAIGN_SAVE_VERSION };
    }

    save() {
        if (!this.available) return;
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
        } catch (e) {
            console.warn('[SaveSystem] write failed', e);
        }
    }

    _creditCoins(amount) {
        if (!Number.isFinite(amount) || amount <= 0) return 0;
        const credit = Math.min(MAX_COIN_BALANCE, Math.floor(amount));
        if (credit <= 0) return 0;
        const raw = this.data.totalCoins;
        const balance = raw === Infinity ? MAX_COIN_BALANCE
            : Number.isFinite(raw) && raw > 0 ? Math.min(MAX_COIN_BALANCE, Math.floor(raw)) : 0;
        const next = credit > MAX_COIN_BALANCE - balance
            ? MAX_COIN_BALANCE
            : balance + credit;
        this.data.totalCoins = next;
        return next - balance;
    }

    addCoins(amount) {
        const credited = this._creditCoins(amount);
        if (credited > 0) this.save();
    }

    // Reserve a globally stable id before a Run Path starts. Aborted/reloaded
    // runs consume an id but carry no persisted reward, preventing the old
    // first-task restart farm while keeping completed-run receipts unique.
    beginGuidedObjectiveRun() {
        const ledger = normalizeGuidedObjectives(this.data.guidedObjectives);
        let serial = ledger.nextRunId;
        if (serial >= MAX_COIN_BALANCE) {
            // Reaching this boundary would require quadrillions of runs. Reset
            // the bounded history with the counter so ids remain unique within
            // every retained receipt window instead of sticking at MAX_SAFE.
            serial = 1;
            ledger.nextRunId = 2;
            ledger.receipts = [];
        } else {
            ledger.nextRunId = serial + 1;
        }
        ledger.activeRunSerial = serial;
        this._guidedObjectiveSessionSerial = serial;
        this.data.guidedObjectives = ledger;
        this.save();
        return `go${serial.toString(36)}`;
    }

    // Explicitly retire a live objective run without paying it. The caller must
    // own the same in-memory session reservation, so stale tabs/reloads and
    // forged run ids cannot close or revive another run. Safe to call twice.
    closeGuidedObjectiveRun(runId = null) {
        const requestedSerial = runId == null
            ? this._guidedObjectiveSessionSerial
            : parseGuidedObjectiveRunSerial(runId);
        const sessionSerial = this._guidedObjectiveSessionSerial;
        if (!sessionSerial || requestedSerial !== sessionSerial) return false;

        this._guidedObjectiveSessionSerial = 0;
        if (!this.available) {
            const ledger = normalizeGuidedObjectives(this.data.guidedObjectives);
            if (ledger.activeRunSerial !== sessionSerial) return false;
            ledger.activeRunSerial = 0;
            this.data.guidedObjectives = ledger;
            return true;
        }

        // Merge into the latest serialized save instead of writing this
        // instance's potentially stale full data object. A reloaded/newer tab
        // may already own a different run and counter; that authority wins.
        try {
            const persisted = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
            if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) return false;
            const ledger = normalizeGuidedObjectives(persisted.guidedObjectives);
            if (ledger.activeRunSerial !== sessionSerial) return false;
            ledger.activeRunSerial = 0;
            persisted.guidedObjectives = ledger;
            localStorage.setItem(SAVE_KEY, JSON.stringify(persisted));
            this.data.guidedObjectives = ledger;
            return true;
        } catch (e) {
            return false; // unreadable/newer authority fails closed without a stale write
        }
    }

    getGuidedObjectiveLedger() {
        this.data.guidedObjectives = normalizeGuidedObjectives(this.data.guidedObjectives);
        return {
            schema: this.data.guidedObjectives.schema,
            nextRunId: this.data.guidedObjectives.nextRunId,
            activeRunSerial: this.data.guidedObjectives.activeRunSerial,
            receipts: [...this.data.guidedObjectives.receipts],
        };
    }

    // Settle up to one complete three-stage path in one atomic save. Replaying
    // the same death/victory callback (or a stale receipt after reload) credits
    // zero; new receipt ids are appended and capped to a fixed history.
    claimGuidedObjectiveRewards(receipts) {
        const ledger = normalizeGuidedObjectives(this.data.guidedObjectives);
        // Re-read only the tiny persisted authority boundary. This makes a
        // second tab/instance that retires an interrupted run visible to an
        // older instance instead of letting stale in-memory state pay it.
        let persistedActiveSerial = ledger.activeRunSerial;
        if (this.available) {
            try {
                const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
                persistedActiveSerial = normalizeGuidedObjectives(
                    raw?.guidedObjectives,
                ).activeRunSerial;
            } catch (e) {
                persistedActiveSerial = 0; // corrupted/unreadable authority fails closed
            }
        }
        const seen = new Set(ledger.receipts);
        const seenSlots = new Set(ledger.receipts.map((receiptId) => {
            const parsed = parseGuidedObjectiveReceiptId(receiptId);
            return parsed ? `${parsed.serial}:${parsed.phaseIndex}` : null;
        }).filter(Boolean));
        const accepted = [];
        const duplicates = [];
        let credited = 0;
        const source = Array.isArray(receipts) ? receipts.slice(0, 3) : [];
        for (const raw of source) {
            const receiptId = raw?.receiptId;
            const parsed = parseGuidedObjectiveReceiptId(receiptId);
            const multiplier = Number.isFinite(raw?.multiplier) && raw.multiplier >= 0
                ? Math.min(RUN_OBJECTIVE_MAX_REWARD_MULTIPLIER, raw.multiplier)
                : null;
            if (!parsed || multiplier === null) continue;
            // The objective id + encoded phase select the authored base reward;
            // caller-supplied coin amounts are never authoritative.
            const amount = Math.max(0, Math.floor(parsed.reward * multiplier));
            const slot = `${parsed.serial}:${parsed.phaseIndex}`;
            if (seen.has(receiptId) || seenSlots.has(slot)) {
                duplicates.push(receiptId);
                continue;
            }
            // Only the most recently reserved live run can introduce new slots.
            // Starting another run retires an abort forever; a settled run is
            // closed below, so bounded-ledger eviction can never reopen it.
            if (parsed.serial !== ledger.activeRunSerial
                || parsed.serial !== this._guidedObjectiveSessionSerial
                || parsed.serial !== persistedActiveSerial) continue;
            seen.add(receiptId);
            seenSlots.add(slot);
            ledger.receipts.push(receiptId);
            const paid = this._creditCoins(amount);
            credited += paid;
            accepted.push({ receiptId, requested: amount, credited: paid });
        }
        ledger.receipts = ledger.receipts.slice(-GUIDED_OBJECTIVE_RECEIPT_LIMIT);
        if (accepted.length) {
            ledger.activeRunSerial = 0;
            this._guidedObjectiveSessionSerial = 0;
        }
        this.data.guidedObjectives = ledger;
        if (accepted.length) this.save();
        return {
            credited,
            accepted,
            duplicates,
            receiptCount: ledger.receipts.length,
        };
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
        if (key === 'unlockMaps') return this.getMapBypassActive();
        return this.data.settings ? this.data.settings[key] : undefined;
    }

    setSetting(key, value) {
        if (key === 'unlockMaps') {
            const enabled = value === true;
            this._session.unlockMaps = enabled;
            if (!enabled) this._session.selectedMap = null;
            return enabled;
        }
        if (!this.data.settings) this.data.settings = {};
        const normalized = key === 'uiScale'
            ? normalizeUiScale(value)
            : key === 'highContrast'
                ? normalizeHighContrast(value)
                : key === 'monoAudio'
                    ? normalizeMonoAudio(value)
                    : key === 'captions'
                        ? normalizeCaptions(value)
                        : key === 'captionDetail'
                            ? normalizeCaptionDetail(value)
                            : key === 'vibration'
                                ? normalizeVibrationStrength(value)
                                : value;
        this.data.settings[key] = normalized;
        this.save();
        return normalized;
    }

    // ── Cosmetics ──────────────────────────────────────────────────────
    _ensureCosmeticPresets() {
        if (!this.data.cosmetics.presets || typeof this.data.cosmetics.presets !== 'object'
            || Array.isArray(this.data.cosmetics.presets)) {
            this.data.cosmetics.presets = createCosmeticPresets(this.data.cosmetics.equipped);
        }
        for (const characterId of CHARACTER_IDS) {
            const preset = this.data.cosmetics.presets[characterId];
            if (!preset || typeof preset !== 'object' || Array.isArray(preset)) {
                this.data.cosmetics.presets[characterId] = copyCosmeticLook(this.data.cosmetics.equipped);
            }
        }
        return this.data.cosmetics.presets;
    }

    isCosmeticUnlocked(id) {
        return this.data.cosmetics.unlocked.includes(id);
    }

    // Returns true if this call NEWLY unlocked it (false if already owned) —
    // the case system uses that to convert duplicates into coins.
    unlockCosmetic(id) {
        if (!cosmeticById(id)) return false;
        if (this.isCosmeticUnlocked(id)) return false;
        this.data.cosmetics.unlocked.push(id);
        this.save();
        return true;
    }

    equipCosmetic(category, id, characterId = this.getSelectedCharacter()) {
        if (!(category in this.data.cosmetics.equipped)) return false;
        if (!CHARACTER_IDS.includes(characterId)) return false;
        if (id !== null) {
            const item = COSMETIC_LIST.find((entry) => entry.id === id);
            if (!item || item.category !== category || !this.isCosmeticUnlocked(id)) return false;
        }
        const presets = this._ensureCosmeticPresets();
        presets[characterId] = { ...presets[characterId], [category]: id };
        if (characterId === this.getSelectedCharacter()) {
            this.data.cosmetics.equipped = copyCosmeticLook(presets[characterId]);
        }
        this.save();
        return true;
    }

    // Atomic all-or-nothing full-look equip. Every slot must be present, known,
    // correctly categorized, and owned before either the preset or compatibility
    // mirror mutates; one save write commits the complete appearance.
    equipCosmeticLook(look, characterId = this.getSelectedCharacter()) {
        if (!look || typeof look !== 'object' || Array.isArray(look)
            || !CHARACTER_IDS.includes(characterId)) return false;
        const keys = Object.keys(look);
        if (keys.length !== COSMETIC_PRESET_SLOTS.length
            || keys.some((key) => !COSMETIC_PRESET_SLOTS.includes(key))) return false;
        const next = {};
        for (const category of COSMETIC_PRESET_SLOTS) {
            if (!Object.prototype.hasOwnProperty.call(look, category)) return false;
            const id = look[category];
            const item = cosmeticById(id);
            if (!item || item.category !== category || !this.isCosmeticUnlocked(id)) return false;
            next[category] = id;
        }
        const presets = this._ensureCosmeticPresets();
        presets[characterId] = next;
        if (characterId === this.getSelectedCharacter()) {
            this.data.cosmetics.equipped = copyCosmeticLook(next);
        }
        this.save();
        return true;
    }

    // One-save Boutique transaction: validate the charged ids, exact shared
    // catalog prices, resulting ownership, and complete target look before any
    // coin/unlock/preset field mutates. This closes the old spend -> N unlocks
    // -> N equips persistence window while retaining earned-coin economics.
    purchaseCosmeticLook(purchaseIds, totalCost, look,
        characterId = this.getSelectedCharacter()) {
        if (!Array.isArray(purchaseIds) || !Number.isInteger(totalCost)
            || totalCost < 0 || totalCost > MAX_COIN_BALANCE
            || !CHARACTER_IDS.includes(characterId)
            || !look || typeof look !== 'object' || Array.isArray(look)) return false;
        const uniqueIds = [...new Set(purchaseIds)];
        if (uniqueIds.length !== purchaseIds.length) return false;
        let expectedCost = 0;
        const newlyOwned = new Set(this.data.cosmetics.unlocked);
        for (const id of uniqueIds) {
            const item = cosmeticById(id);
            if (!item || this.isCosmeticUnlocked(id)) return false;
            const cost = cosmeticCoinCost(item);
            if (!Number.isInteger(cost) || cost <= 0) return false;
            expectedCost += cost;
            newlyOwned.add(id);
        }
        if (expectedCost !== totalCost) return false;
        const rawBalance = this.data.totalCoins;
        const balance = rawBalance === Infinity ? MAX_COIN_BALANCE
            : Number.isFinite(rawBalance)
                ? Math.max(0, Math.min(MAX_COIN_BALANCE, Math.floor(rawBalance))) : 0;
        if (balance < totalCost) return false;
        const keys = Object.keys(look);
        if (keys.length !== COSMETIC_PRESET_SLOTS.length
            || keys.some((key) => !COSMETIC_PRESET_SLOTS.includes(key))) return false;
        const next = {};
        for (const category of COSMETIC_PRESET_SLOTS) {
            const id = look[category];
            const item = cosmeticById(id);
            if (!item || item.category !== category || !newlyOwned.has(id)) return false;
            next[category] = id;
        }

        this.data.totalCoins = balance - totalCost;
        this.data.cosmetics.unlocked.push(...uniqueIds);
        const presets = this._ensureCosmeticPresets();
        presets[characterId] = next;
        if (characterId === this.getSelectedCharacter()) {
            this.data.cosmetics.equipped = copyCosmeticLook(next);
        }
        this.save();
        return true;
    }

    setCosmeticPursuit(setId) {
        if (setId !== null && !COSMETIC_SETS.some((set) => set.id === setId)) return false;
        this.data.cosmetics.pursuitSetId = setId;
        this.save();
        return true;
    }

    // Zero arguments preserve the historical global-equipment API. Supplying a
    // known hero returns that hero's preset for session-local overrides such as
    // Rite Trial without mutating the selected character.
    getEquippedCosmetics(characterId = null) {
        if (characterId !== null && characterId !== undefined && CHARACTER_IDS.includes(characterId)) {
            return this._ensureCosmeticPresets()[characterId];
        }
        return this.data.cosmetics.equipped;
    }

    getCosmeticPreset(characterId) {
        if (!CHARACTER_IDS.includes(characterId)) return null;
        return copyCosmeticLook(this._ensureCosmeticPresets()[characterId]);
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
        const presets = this._ensureCosmeticPresets();
        this.data.selectedCharacter = id;
        this.data.cosmetics.equipped = copyCosmeticLook(presets[id]);
        this.save();
        return true;
    }

    // ── Map selection (unlock-gated by exact predecessor bosses) ────────
    // Exact unique-boss gates own honest access. The dev unlock is a transient
    // session view, so it cannot leak into progression or serialized settings.
    getMapBypassActive() {
        return this._session?.unlockMaps === true;
    }

    campaignMapUnlocked(id) {
        return campaignMapUnlockedByProgress(this.data.campaignProgress, id);
    }

    getMapUnlockStatus(id) {
        const status = getCampaignMapUnlockStatus(this.data.campaignProgress, id);
        const qaBypass = this.getMapBypassActive();
        return {
            ...status,
            campaignUnlocked: status.unlocked,
            unlocked: status.known && (status.unlocked || qaBypass),
            qaBypass,
        };
    }

    getAllMapUnlockStatuses() {
        return CAMPAIGN_MAP_ORDER.map((id) => this.getMapUnlockStatus(id));
    }

    // Compatibility seam for existing renderers. This includes the current
    // session's QA bypass; campaignMapUnlocked remains the honest answer.
    mapUnlocked(id) {
        return this.getMapUnlockStatus(id).unlocked;
    }

    getEffectiveSelectedMap() {
        if (this.getMapBypassActive()) {
            const sessionMap = this._session.selectedMap;
            if (MAPS[sessionMap]) return sessionMap;
        }
        const honestMap = this.data.selectedMap ?? DEFAULT_MAP;
        return this.campaignMapUnlocked(honestMap) ? honestMap : DEFAULT_MAP;
    }

    getSelectedMap() {
        return this.getEffectiveSelectedMap();
    }

    setSelectedMap(id) {
        if (!MAPS[id]) return false;
        if (this.getMapBypassActive()) {
            this._session.selectedMap = id;
            return true;
        }
        if (!this.campaignMapUnlocked(id)) return false;
        this.data.selectedMap = id;
        this.save();
        return true;
    }

    recordCampaignBossDefeat(inputOrMapId, bossIdArg, eligibleArg = false) {
        const input = inputOrMapId && typeof inputOrMapId === 'object'
            ? inputOrMapId
            : { mapId: inputOrMapId, bossId: bossIdArg, eligible: eligibleArg };
        const receipt = applyCampaignBossDefeat(this.data.campaignProgress, {
            mapId: input.mapId,
            bossId: input.bossId,
            // QA-selected runs may exercise content but never advance it.
            eligible: input.eligible === true && !this.getMapBypassActive(),
        });
        if (receipt.changed) {
            this.data.campaignProgress = receipt.progress;
            this.save();
        }
        return receipt;
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
        if (!cosmeticById(id)) return false;
        if (this.data.cosmetics.unlocked.includes(id)) return false;
        this.data.cosmetics.unlocked.push(id); return true;
    }

    reset() {
        this._session = { unlockMaps: false, selectedMap: null };
        this._guidedObjectiveSessionSerial = 0;
        this.data = freshDefaultData();
        this.save();
    }
}
