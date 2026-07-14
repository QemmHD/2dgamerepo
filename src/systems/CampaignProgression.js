// Exact campaign-map progression policy.
//
// This module is deliberately pure and fixed-shape. Lifetime boss totals remain
// useful for statistics and achievements, but map access is derived only from
// the unique authored bosses recorded for an eligible campaign run. Keeping the
// policy outside SaveSystem gives menus, validators, and future native shells one
// canonical answer without importing browser storage.

export const CAMPAIGN_SAVE_VERSION = 10;

export const CAMPAIGN_MAP_ORDER = Object.freeze([
    'emberwood',
    'hollowreach',
    'crypts',
    'dunes',
]);

export const CAMPAIGN_BOSSES_BY_MAP = Object.freeze({
    emberwood: Object.freeze(['stormwingAlpha', 'vinebackGoliath', 'gloomMaw']),
    hollowreach: Object.freeze(['hoarfang', 'rimewarden', 'aurorath']),
    crypts: Object.freeze(['mourndrift', 'ossuar', 'nihagault']),
    dunes: Object.freeze(['cindermaw', 'dunescourge', 'solnakh']),
});

const MAP_INDEX = Object.freeze(Object.fromEntries(
    CAMPAIGN_MAP_ORDER.map((mapId, index) => [mapId, index]),
));

function knownMap(mapId) {
    return typeof mapId === 'string'
        && Object.prototype.hasOwnProperty.call(MAP_INDEX, mapId);
}

function orderedBossSubset(mapId, raw) {
    if (!Array.isArray(raw)) return [];
    const supplied = new Set(raw.filter((bossId) => typeof bossId === 'string'));
    return CAMPAIGN_BOSSES_BY_MAP[mapId].filter((bossId) => supplied.has(bossId));
}

function prefixThrough(index) {
    const last = Math.max(0, Math.min(CAMPAIGN_MAP_ORDER.length - 1, index));
    return CAMPAIGN_MAP_ORDER.slice(0, last + 1);
}

export function createCampaignProgress() {
    return {
        unlockedMaps: [CAMPAIGN_MAP_ORDER[0]],
        defeatedBosses: Object.fromEntries(
            CAMPAIGN_MAP_ORDER.map((mapId) => [mapId, []]),
        ),
    };
}

// Repair a v10+ ledger using only evidence inside that ledger. Crucially, this
// function never consults lifetime totals. Only an exact contiguous unlock
// prefix is trusted; complete authored trios repair their immediate successor.
// Evidence attached to a still-locked source map is discarded so corruption
// cannot spring forward after an unrelated predecessor unlock.
export function sanitizeCampaignProgress(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const rawDefeated = source.defeatedBosses
        && typeof source.defeatedBosses === 'object'
        && !Array.isArray(source.defeatedBosses)
        ? source.defeatedBosses
        : {};

    const defeatedBosses = Object.fromEntries(CAMPAIGN_MAP_ORDER.map((mapId) => [
        mapId,
        orderedBossSubset(mapId, rawDefeated[mapId]),
    ]));

    // Read only an exact claimed prefix, then require complete predecessor
    // evidence for every claimed step. `unlockedMaps` is authorization history,
    // not independent proof: a syntactically perfect all-map prefix with no
    // trios still repairs to Emberwood.
    let claimedHighestUnlocked = 0;
    if (Array.isArray(source.unlockedMaps)) {
        for (let i = 1; i < CAMPAIGN_MAP_ORDER.length; i++) {
            const prefixIsExact = CAMPAIGN_MAP_ORDER
                .slice(0, i + 1)
                .every((mapId, index) => source.unlockedMaps[index] === mapId);
            if (!prefixIsExact) break;
            claimedHighestUnlocked = i;
        }
    }

    let highestUnlocked = 0;
    for (let i = 0; i < claimedHighestUnlocked; i++) {
        const mapId = CAMPAIGN_MAP_ORDER[i];
        if (defeatedBosses[mapId].length !== CAMPAIGN_BOSSES_BY_MAP[mapId].length) break;
        highestUnlocked = i + 1;
    }

    // Boss evidence is trusted only for maps in the prefix that was already
    // supported when this ledger arrived. Clear future-map records BEFORE closure;
    // otherwise complete Emberwood + corrupt complete Hollow Reach evidence
    // could cascade two destinations in a single repair pass.
    const trustedHighestUnlocked = highestUnlocked;
    for (let i = trustedHighestUnlocked + 1; i < CAMPAIGN_MAP_ORDER.length; i++) {
        defeatedBosses[CAMPAIGN_MAP_ORDER[i]] = [];
    }

    // A completed trio is stronger evidence than a missing/stale unlockedMaps
    // entry, so close the prefix over every completed predecessor in order.
    for (let i = 0; i < CAMPAIGN_MAP_ORDER.length - 1; i++) {
        if (i > highestUnlocked) break; // a locked source cannot grant its successor
        const mapId = CAMPAIGN_MAP_ORDER[i];
        if (defeatedBosses[mapId].length === CAMPAIGN_BOSSES_BY_MAP[mapId].length) {
            highestUnlocked = Math.max(highestUnlocked, i + 1);
        }
    }

    // Never retain progress for a map the ledger did not prove accessible.
    // Without this boundary, a corrupt complete Hollow Reach trio could sit
    // behind a locked gate, then auto-unlock the Crypts on a later reload as
    // soon as Emberwood happened to complete.
    for (let i = highestUnlocked + 1; i < CAMPAIGN_MAP_ORDER.length; i++) {
        defeatedBosses[CAMPAIGN_MAP_ORDER[i]] = [];
    }

    return {
        unlockedMaps: prefixThrough(highestUnlocked),
        defeatedBosses,
    };
}

// Legacy saves had only the lifetime thresholds 0/3/6/9. We cannot infer
// partial identities, so only seed the complete trios required to preserve maps
// that were already open. Even a total of 12+ never fabricates the Dunes trio.
export function migrateLegacyCampaignProgress(totalBosses) {
    const progress = createCampaignProgress();
    const total = Number.isFinite(totalBosses) && totalBosses >= 0
        ? Math.floor(totalBosses)
        : 0;
    const completedPredecessors = total >= 9 ? 3 : total >= 6 ? 2 : total >= 3 ? 1 : 0;

    for (let i = 0; i < completedPredecessors; i++) {
        const mapId = CAMPAIGN_MAP_ORDER[i];
        progress.defeatedBosses[mapId] = [...CAMPAIGN_BOSSES_BY_MAP[mapId]];
    }
    progress.unlockedMaps = prefixThrough(completedPredecessors);
    return progress;
}

export function normalizeCampaignProgress({ version, campaignProgress, totalBosses } = {}) {
    const validVersion = Number.isInteger(version) && version >= 0;
    // `undefined` is the one reliable old-save signal because v0-v9 did not
    // have this field at all. Every other supplied value (including null,
    // arrays, strings, and scalars) is a corrupt current ledger that the
    // sanitizer can safely collapse to the first map.
    const ledgerPresent = campaignProgress !== undefined;

    // Field presence outranks the version marker. Genuine v0-v9 profiles never
    // had a campaignProgress field, while a current profile's version can be
    // corrupted to any value (including an otherwise valid 9). Once any ledger
    // value exists, sanitize it and never resurrect lifetime-total access.
    if (ledgerPresent) return sanitizeCampaignProgress(campaignProgress);

    // A v10+ profile with a missing ledger repairs to a fresh exact ledger.
    // An absent ledger on valid v0-v9 or unversioned data is the only legacy
    // shape allowed to use the conservative lifetime migration buckets.
    return validVersion && version >= CAMPAIGN_SAVE_VERSION
        ? sanitizeCampaignProgress(undefined)
        : migrateLegacyCampaignProgress(totalBosses);
}

export function getCampaignMapUnlockStatus(progress, mapId) {
    if (!knownMap(mapId)) {
        return {
            mapId,
            known: false,
            unlocked: false,
            requiredMapId: null,
            requiredBossIds: [],
            defeatedBossIds: [],
            missingBossIds: [],
            defeatedCount: 0,
            requiredCount: 0,
        };
    }

    const clean = sanitizeCampaignProgress(progress);
    const index = MAP_INDEX[mapId];
    const requiredMapId = index > 0 ? CAMPAIGN_MAP_ORDER[index - 1] : null;
    const requiredBossIds = requiredMapId ? [...CAMPAIGN_BOSSES_BY_MAP[requiredMapId]] : [];
    const defeatedBossIds = requiredMapId ? [...clean.defeatedBosses[requiredMapId]] : [];
    const defeated = new Set(defeatedBossIds);
    const missingBossIds = requiredBossIds.filter((bossId) => !defeated.has(bossId));

    return {
        mapId,
        known: true,
        unlocked: clean.unlockedMaps.includes(mapId),
        requiredMapId,
        requiredBossIds,
        defeatedBossIds,
        missingBossIds,
        defeatedCount: defeatedBossIds.length,
        requiredCount: requiredBossIds.length,
    };
}

export function campaignMapUnlocked(progress, mapId) {
    return getCampaignMapUnlockStatus(progress, mapId).unlocked;
}

// Return a receipt and a new ledger; never mutate the caller's object. Reasons
// are stable strings so UI copy and deterministic validators can branch without
// reimplementing policy.
export function recordCampaignBossDefeat(progress, {
    mapId,
    bossId,
    eligible = false,
} = {}) {
    const clean = sanitizeCampaignProgress(progress);
    const finish = (reason, accepted = false, changed = false, newlyUnlockedMapId = null, next = clean) => ({
        accepted,
        changed,
        reason,
        mapId,
        bossId,
        newlyUnlockedMapId,
        status: getCampaignMapUnlockStatus(next, mapId),
        progress: next,
    });

    if (eligible !== true) return finish('ineligible');
    if (!knownMap(mapId)) return finish('unknown-map');
    if (!CAMPAIGN_BOSSES_BY_MAP[mapId].includes(bossId)) return finish('wrong-map-boss');
    if (!clean.unlockedMaps.includes(mapId)) return finish('locked-map');
    if (clean.defeatedBosses[mapId].includes(bossId)) return finish('repeat');

    const next = {
        unlockedMaps: [...clean.unlockedMaps],
        defeatedBosses: Object.fromEntries(CAMPAIGN_MAP_ORDER.map((id) => [
            id,
            id === mapId
                ? CAMPAIGN_BOSSES_BY_MAP[id].filter((authoredId) =>
                    clean.defeatedBosses[id].includes(authoredId) || authoredId === bossId)
                : [...clean.defeatedBosses[id]],
        ])),
    };

    let newlyUnlockedMapId = null;
    const mapIndex = MAP_INDEX[mapId];
    const trioComplete = next.defeatedBosses[mapId].length === CAMPAIGN_BOSSES_BY_MAP[mapId].length;
    if (trioComplete && mapIndex < CAMPAIGN_MAP_ORDER.length - 1) {
        const candidate = CAMPAIGN_MAP_ORDER[mapIndex + 1];
        if (!next.unlockedMaps.includes(candidate)) {
            next.unlockedMaps = prefixThrough(mapIndex + 1);
            newlyUnlockedMapId = candidate;
        }
    }

    return finish('recorded', true, true, newlyUnlockedMapId, next);
}
