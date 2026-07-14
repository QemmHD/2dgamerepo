#!/usr/bin/env node
// Deterministic gate for save-v10 campaign map progression.
//
// This verifies both the pure policy and SaveSystem's persistence boundary:
// only unique authored bosses from eligible honest runs advance a map, every
// accepted defeat persists immediately, and the ?dev=1 map bypass stays in the
// current session with zero storage writes.

import {
    CAMPAIGN_BOSSES_BY_MAP,
    CAMPAIGN_MAP_ORDER,
    CAMPAIGN_SAVE_VERSION,
    campaignMapUnlocked,
    createCampaignProgress,
    getCampaignMapUnlockStatus,
    migrateLegacyCampaignProgress,
    normalizeCampaignProgress,
    recordCampaignBossDefeat,
    sanitizeCampaignProgress,
} from '../src/systems/CampaignProgression.js';
import { MAPS, MAP_ORDER } from '../src/content/maps.js';
import { SaveSystem } from '../src/systems/SaveSystem.js';

const SAVE_KEY = 'monkey-survivor:save:v1';
let checks = 0;
let failures = 0;

function ok(condition, message) {
    checks++;
    if (!condition) {
        failures++;
        console.error(`  x ${message}`);
    }
}

function same(actual, expected, message) {
    ok(JSON.stringify(actual) === JSON.stringify(expected), message);
}

class MemoryStorage {
    constructor(raw) {
        this.values = new Map();
        this.saveWrites = 0;
        if (raw !== undefined) this.values.set(SAVE_KEY, String(raw));
    }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    setItem(key, value) {
        this.values.set(key, String(value));
        if (key === SAVE_KEY) this.saveWrites++;
    }
    removeItem(key) { this.values.delete(key); }
}

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWarn = console.warn;

function setStorage(storage) {
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        writable: true,
        value: storage,
    });
}

function restoreStorage() {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
}

function mapShape(progress) {
    return Object.keys(progress.defeatedBosses);
}

function expectedMigration(totalBosses) {
    const completed = totalBosses >= 9 ? 3 : totalBosses >= 6 ? 2 : totalBosses >= 3 ? 1 : 0;
    return {
        unlockedMaps: CAMPAIGN_MAP_ORDER.slice(0, completed + 1),
        defeatedBosses: Object.fromEntries(CAMPAIGN_MAP_ORDER.map((mapId, index) => [
            mapId,
            index < completed ? [...CAMPAIGN_BOSSES_BY_MAP[mapId]] : [],
        ])),
    };
}

function recordTrio(save, mapId) {
    return CAMPAIGN_BOSSES_BY_MAP[mapId].map((bossId) => save.recordCampaignBossDefeat({
        mapId,
        bossId,
        eligible: true,
    }));
}

same(CAMPAIGN_MAP_ORDER, ['emberwood', 'hollowreach', 'crypts', 'dunes'],
    'campaign map order is fixed and authored');
same(CAMPAIGN_BOSSES_BY_MAP, {
    emberwood: ['stormwingAlpha', 'vinebackGoliath', 'gloomMaw'],
    hollowreach: ['hoarfang', 'rimewarden', 'aurorath'],
    crypts: ['mourndrift', 'ossuar', 'nihagault'],
    dunes: ['cindermaw', 'dunescourge', 'solnakh'],
}, 'every map owns its exact authored boss trio');
same(MAP_ORDER, CAMPAIGN_MAP_ORDER,
    'map content and campaign policy share one authored order');
for (const mapId of CAMPAIGN_MAP_ORDER) {
    same(MAPS[mapId]?.bosses, CAMPAIGN_BOSSES_BY_MAP[mapId],
        `${mapId} content and campaign policy share the exact boss trio`);
}
const allAuthoredBosses = CAMPAIGN_MAP_ORDER.flatMap((mapId) => CAMPAIGN_BOSSES_BY_MAP[mapId]);
ok(allAuthoredBosses.length === 12 && new Set(allAuthoredBosses).size === 12,
    'all four predecessor trios contain exactly three globally unique boss IDs');
ok(CAMPAIGN_SAVE_VERSION === 10, 'campaign policy owns save schema v10');

const fresh = createCampaignProgress();
same(fresh.unlockedMaps, ['emberwood'], 'a fresh campaign unlocks Emberwood only');
same(mapShape(fresh), CAMPAIGN_MAP_ORDER, 'fresh boss ledger has all four fixed map keys');
ok(CAMPAIGN_MAP_ORDER.every((id) => Array.isArray(fresh.defeatedBosses[id])
    && fresh.defeatedBosses[id].length === 0),
'fresh boss ledger starts empty on every map');

// Sanitization is conservative: malformed later IDs never fabricate a prefix.
same(sanitizeCampaignProgress({ unlockedMaps: ['dunes'] }).unlockedMaps, ['emberwood'],
    'a lone later-map unlock cannot grant an ordered prefix');
same(sanitizeCampaignProgress({ unlockedMaps: ['emberwood', 'crypts'] }).unlockedMaps, ['emberwood'],
    'a gapped unlock list stops at the last exact prefix entry');
same(sanitizeCampaignProgress({ unlockedMaps: ['hollowreach', 'emberwood'] }).unlockedMaps, ['emberwood'],
    'an out-of-order unlock list cannot grant Hollowreach');
same(sanitizeCampaignProgress({
    unlockedMaps: ['emberwood', 'hollowreach', 'crypts'],
}).unlockedMaps, ['emberwood'],
'an exact claimed prefix without predecessor evidence grants nothing');
same(sanitizeCampaignProgress({
    unlockedMaps: [...CAMPAIGN_MAP_ORDER],
    defeatedBosses: {},
}).unlockedMaps, ['emberwood'],
'a well-formed all-map corruption cannot bypass exact boss evidence');

const dirty = sanitizeCampaignProgress({
    unlockedMaps: ['emberwood'],
    defeatedBosses: {
        emberwood: ['gloomMaw', 'fakeBoss', 'stormwingAlpha', 'gloomMaw'],
        hollowreach: ['stormwingAlpha', 'hoarfang'],
        unknown: ['solnakh'],
    },
});
same(dirty.defeatedBosses.emberwood, ['stormwingAlpha', 'gloomMaw'],
    'sanitizer filters, deduplicates, and author-orders exact map bosses');
same(dirty.defeatedBosses.hollowreach, [],
    'a valid boss on a still-locked map is discarded with future-map evidence');
same(mapShape(dirty), CAMPAIGN_MAP_ORDER,
    'sanitizer drops unknown map-ledger keys and restores fixed shape');
const dirtyUnlockedMap = sanitizeCampaignProgress({
    unlockedMaps: ['emberwood', 'hollowreach'],
    defeatedBosses: {
        emberwood: [...CAMPAIGN_BOSSES_BY_MAP.emberwood],
        hollowreach: ['stormwingAlpha', 'hoarfang', 'hoarfang'],
    },
});
same(dirtyUnlockedMap.defeatedBosses.hollowreach, ['hoarfang'],
    'an unlocked map keeps only its own deduplicated authored boss IDs');

const lockedTrio = sanitizeCampaignProgress({
    unlockedMaps: ['emberwood'],
    defeatedBosses: { hollowreach: [...CAMPAIGN_BOSSES_BY_MAP.hollowreach] },
});
same(lockedTrio.unlockedMaps, ['emberwood'],
    'a complete trio on a locked source map cannot unlock its successor');
same(lockedTrio.defeatedBosses.hollowreach, [],
    'boss evidence on a still-locked source map is discarded');
const stagedFutureEvidence = sanitizeCampaignProgress({
    unlockedMaps: ['emberwood'],
    defeatedBosses: {
        emberwood: CAMPAIGN_BOSSES_BY_MAP.emberwood.slice(0, 2),
        hollowreach: [...CAMPAIGN_BOSSES_BY_MAP.hollowreach],
    },
});
const stagedThird = recordCampaignBossDefeat(stagedFutureEvidence, {
    mapId: 'emberwood',
    bossId: CAMPAIGN_BOSSES_BY_MAP.emberwood[2],
    eligible: true,
});
same(stagedThird.progress.unlockedMaps, ['emberwood', 'hollowreach'],
    'unlocking a predecessor cannot reactivate discarded future-map corruption');
same(sanitizeCampaignProgress(stagedThird.progress).unlockedMaps, ['emberwood', 'hollowreach'],
    'a later reload cannot cascade from discarded locked-map boss evidence');
const completeCascadeAttempt = sanitizeCampaignProgress({
    unlockedMaps: ['emberwood'],
    defeatedBosses: {
        emberwood: [...CAMPAIGN_BOSSES_BY_MAP.emberwood],
        hollowreach: [...CAMPAIGN_BOSSES_BY_MAP.hollowreach],
    },
});
same(completeCascadeAttempt.unlockedMaps, ['emberwood', 'hollowreach'],
    'one sanitize pass can repair only the successor of an initially trusted map');
same(completeCascadeAttempt.defeatedBosses.hollowreach, [],
    'a complete locked-map trio cannot ride predecessor repair into a cascade');
const repairFromEvidence = sanitizeCampaignProgress({
    unlockedMaps: ['emberwood'],
    defeatedBosses: { emberwood: [...CAMPAIGN_BOSSES_BY_MAP.emberwood] },
});
same(repairFromEvidence.unlockedMaps, ['emberwood', 'hollowreach'],
    'a complete unlocked predecessor trio repairs its immediate successor');

// Pure recording is deny-by-default, immutable, exact, and idempotent.
const untouched = createCampaignProgress();
for (const [input, reason] of [
    [{ mapId: 'emberwood', bossId: 'stormwingAlpha' }, 'ineligible'],
    [{ mapId: 'unknown', bossId: 'stormwingAlpha', eligible: true }, 'unknown-map'],
    [{ mapId: 'emberwood', bossId: 'hoarfang', eligible: true }, 'wrong-map-boss'],
    [{ mapId: 'hollowreach', bossId: 'hoarfang', eligible: true }, 'locked-map'],
]) {
    const receipt = recordCampaignBossDefeat(untouched, input);
    ok(!receipt.accepted && !receipt.changed && receipt.reason === reason,
        `invalid campaign receipt is rejected as ${reason}`);
}
same(untouched, createCampaignProgress(), 'pure recording never mutates the caller ledger');

let evolving = createCampaignProgress();
for (let i = 0; i < CAMPAIGN_BOSSES_BY_MAP.emberwood.length; i++) {
    const bossId = CAMPAIGN_BOSSES_BY_MAP.emberwood[i];
    const receipt = recordCampaignBossDefeat(evolving, {
        mapId: 'emberwood', bossId, eligible: true,
    });
    ok(receipt.accepted && receipt.changed && receipt.reason === 'recorded',
        `unique eligible Emberwood boss ${bossId} is accepted`);
    ok(receipt.newlyUnlockedMapId === (i === 2 ? 'hollowreach' : null),
        `only the third unique Emberwood boss unlocks Hollowreach (${bossId})`);
    evolving = receipt.progress;
}
same(evolving.unlockedMaps, ['emberwood', 'hollowreach'],
    'the exact Emberwood trio unlocks only Hollowreach');
const repeated = recordCampaignBossDefeat(evolving, {
    mapId: 'emberwood', bossId: 'gloomMaw', eligible: true,
});
ok(!repeated.accepted && !repeated.changed && repeated.reason === 'repeat',
    'repeat authored boss defeats are idempotent');

const hollowStatus = getCampaignMapUnlockStatus(evolving, 'hollowreach');
same(hollowStatus, {
    mapId: 'hollowreach',
    known: true,
    unlocked: true,
    requiredMapId: 'emberwood',
    requiredBossIds: [...CAMPAIGN_BOSSES_BY_MAP.emberwood],
    defeatedBossIds: [...CAMPAIGN_BOSSES_BY_MAP.emberwood],
    missingBossIds: [],
    defeatedCount: 3,
    requiredCount: 3,
}, 'pure status reports the exact predecessor trio and completion counts');
ok(!campaignMapUnlocked(evolving, 'crypts') && !campaignMapUnlocked(evolving, 'unknown'),
    'honest campaign access denies locked and unknown maps');

// Exercise every authored transition, including the final trio's no-successor
// receipt. This prevents a first-map-only implementation from passing.
let fullCampaign = evolving;
for (let mapIndex = 1; mapIndex < CAMPAIGN_MAP_ORDER.length; mapIndex++) {
    const mapId = CAMPAIGN_MAP_ORDER[mapIndex];
    const expectedSuccessor = CAMPAIGN_MAP_ORDER[mapIndex + 1] ?? null;
    const trio = CAMPAIGN_BOSSES_BY_MAP[mapId];
    for (let bossIndex = 0; bossIndex < trio.length; bossIndex++) {
        const receipt = recordCampaignBossDefeat(fullCampaign, {
            mapId,
            bossId: trio[bossIndex],
            eligible: true,
        });
        ok(receipt.accepted && receipt.changed,
            `${mapId} unique boss ${trio[bossIndex]} records successfully`);
        ok(receipt.newlyUnlockedMapId === (bossIndex === trio.length - 1 ? expectedSuccessor : null),
            `${mapId} unlock receipt is exact at boss ${bossIndex + 1}`);
        fullCampaign = receipt.progress;
    }
}
same(fullCampaign.unlockedMaps, CAMPAIGN_MAP_ORDER,
    'all three exact predecessor transitions unlock the authored four-map prefix');
same(fullCampaign.defeatedBosses.dunes, CAMPAIGN_BOSSES_BY_MAP.dunes,
    'the final Dunes trio is recorded without inventing a successor');

const trioPermutations = ([a, b, c]) => [
    [a, b, c], [a, c, b], [b, a, c],
    [b, c, a], [c, a, b], [c, b, a],
];
for (let mapIndex = 0; mapIndex < CAMPAIGN_MAP_ORDER.length; mapIndex++) {
    const mapId = CAMPAIGN_MAP_ORDER[mapIndex];
    const successor = CAMPAIGN_MAP_ORDER[mapIndex + 1] ?? null;
    let prerequisite = createCampaignProgress();
    for (let priorIndex = 0; priorIndex < mapIndex; priorIndex++) {
        const priorMap = CAMPAIGN_MAP_ORDER[priorIndex];
        for (const bossId of CAMPAIGN_BOSSES_BY_MAP[priorMap]) {
            prerequisite = recordCampaignBossDefeat(prerequisite, {
                mapId: priorMap, bossId, eligible: true,
            }).progress;
        }
    }
    for (const permutation of trioPermutations(CAMPAIGN_BOSSES_BY_MAP[mapId])) {
        let trial = JSON.parse(JSON.stringify(prerequisite));
        for (let i = 0; i < permutation.length; i++) {
            const receipt = recordCampaignBossDefeat(trial, {
                mapId, bossId: permutation[i], eligible: true,
            });
            ok(receipt.accepted && receipt.changed,
                `${mapId} accepts permutation ${permutation.join('>')} step ${i + 1}`);
            ok(receipt.newlyUnlockedMapId === (i === 2 ? successor : null),
                `${mapId} permutation unlocks only on its third unique boss`);
            trial = receipt.progress;
        }
        same(trial.defeatedBosses[mapId], CAMPAIGN_BOSSES_BY_MAP[mapId],
            `${mapId} permutation normalizes to authored ledger order`);
    }
}

// Exact v9 migration buckets preserve old map access without inventing partials.
for (const total of [0, 2, 3, 5, 6, 8, 9, 12, 999]) {
    same(migrateLegacyCampaignProgress(total), expectedMigration(total),
        `legacy lifetime total ${total} migrates to its exact conservative bucket`);
    ok(migrateLegacyCampaignProgress(total).defeatedBosses.dunes.length === 0,
        `legacy lifetime total ${total} never fabricates the Dunes trio`);
}
same(normalizeCampaignProgress({
    version: 10,
    campaignProgress: null,
    totalBosses: 999,
}), createCampaignProgress(),
'v10 corruption never falls back to lifetime totalBosses');

for (const corruptVersion of ['10', 10.5, null, -1]) {
    same(normalizeCampaignProgress({
        version: corruptVersion,
        campaignProgress: createCampaignProgress(),
        totalBosses: 999,
    }), createCampaignProgress(),
    `malformed current version ${String(corruptVersion)} never falls back to lifetime totalBosses`);
}
for (const corruptLedger of [null, [], 'corrupt', 7, false]) {
    same(normalizeCampaignProgress({
        version: '10',
        campaignProgress: corruptLedger,
        totalBosses: 999,
    }), createCampaignProgress(),
    `malformed current ledger ${JSON.stringify(corruptLedger)} never falls back to lifetime totalBosses`);
}
same(normalizeCampaignProgress({
    version: 9,
    campaignProgress: createCampaignProgress(),
    totalBosses: 999,
}), createCampaignProgress(),
'ledger presence outranks a corrupted-but-valid legacy version marker');
same(normalizeCampaignProgress({
    version: null,
    totalBosses: 9,
}), expectedMigration(9),
'missing-version legacy save with an omitted ledger still migrates conservatively');

try {
    console.warn = () => {};

    // SaveSystem applies the same migration and repairs dishonest selections.
    for (const total of [0, 2, 3, 5, 6, 8, 9, 12]) {
        const allowed = expectedMigration(total).unlockedMaps;
        const requested = allowed[allowed.length - 1];
        const storage = new MemoryStorage(JSON.stringify({
            version: 9,
            stats: { totalBosses: total },
            selectedMap: requested,
        }));
        setStorage(storage);
        const migrated = new SaveSystem();
        same(migrated.data.campaignProgress, expectedMigration(total),
            `SaveSystem migrates v9 total ${total} into the exact ledger`);
        ok(migrated.getEffectiveSelectedMap() === requested,
            `v9 total ${total} preserves an honestly available selection`);
        ok(migrated.data.version === 10,
            `v9 total ${total} normalizes to save schema v10`);
    }

    const oldBypassStorage = new MemoryStorage(JSON.stringify({
        version: 9,
        stats: { totalBosses: 0 },
        selectedMap: 'dunes',
        settings: { unlockMaps: true },
    }));
    setStorage(oldBypassStorage);
    const oldBypass = new SaveSystem();
    ok(oldBypass.getMapBypassActive() === false
        && oldBypass.getEffectiveSelectedMap() === 'emberwood'
        && oldBypass.data.selectedMap === 'emberwood'
        && !Object.prototype.hasOwnProperty.call(oldBypass.data.settings, 'unlockMaps'),
    'legacy persisted bypass and its dishonest selection are discarded');

    const corruptV10Storage = new MemoryStorage(JSON.stringify({
        version: 10,
        stats: { totalBosses: 999 },
        selectedMap: 'dunes',
        campaignProgress: { unlockedMaps: ['dunes'], defeatedBosses: null },
    }));
    setStorage(corruptV10Storage);
    const corruptV10 = new SaveSystem();
    same(corruptV10.data.campaignProgress, createCampaignProgress(),
        'v10 corrupt later-map evidence stays conservative despite huge lifetime totals');
    ok(corruptV10.getEffectiveSelectedMap() === 'emberwood',
        'v10 corrupt late selection repairs to Emberwood');

    // Every newly accepted unique defeat is durable immediately; all rejected
    // calls perform zero save-key writes.
    const storage = new MemoryStorage();
    setStorage(storage);
    const save = new SaveSystem();
    ok(save.data.version === 10 && save.getEffectiveSelectedMap() === 'emberwood',
        'fresh SaveSystem starts at schema v10 on Emberwood');
    same(save.getAllMapUnlockStatuses().map((status) => status.mapId), CAMPAIGN_MAP_ORDER,
        'all-map status API returns the stable authored order');
    ok(save.getMapUnlockStatus('hollowreach').requiredMapId === 'emberwood'
        && save.getMapUnlockStatus('hollowreach').requiredCount === 3,
    'SaveSystem status exposes the exact predecessor requirement');

    for (let i = 0; i < CAMPAIGN_BOSSES_BY_MAP.emberwood.length; i++) {
        const bossId = CAMPAIGN_BOSSES_BY_MAP.emberwood[i];
        const beforeWrites = storage.saveWrites;
        const receipt = save.recordCampaignBossDefeat({
            mapId: 'emberwood', bossId, eligible: true,
        });
        ok(storage.saveWrites === beforeWrites + 1,
            `accepted boss ${bossId} persists exactly once immediately`);
        ok(receipt.newlyUnlockedMapId === (i === 2 ? 'hollowreach' : null),
            `SaveSystem receipt exposes the exact unlock caused by ${bossId}`);
    }
    ok(save.campaignMapUnlocked('hollowreach'),
        'SaveSystem honest access opens Hollowreach after its exact trio');
    const persistedAfterTrio = JSON.parse(storage.getItem(SAVE_KEY));
    same(persistedAfterTrio.campaignProgress, save.data.campaignProgress,
        'immediate persistence stores the complete exact ledger');
    ok(new SaveSystem().campaignMapUnlocked('hollowreach'),
        'accepted campaign progress survives a constructor reload');

    for (const input of [
        { mapId: 'emberwood', bossId: 'gloomMaw', eligible: true },
        { mapId: 'emberwood', bossId: 'hoarfang', eligible: true },
        { mapId: 'unknown', bossId: 'gloomMaw', eligible: true },
        { mapId: 'hollowreach', bossId: 'hoarfang', eligible: false },
    ]) {
        const beforeWrites = storage.saveWrites;
        const receipt = save.recordCampaignBossDefeat(input);
        ok(!receipt.changed && storage.saveWrites === beforeWrites,
            `rejected ${receipt.reason} campaign receipt performs zero writes`);
    }

    // The dev setting still exists at its caller seam, but it and selections
    // made under it are strictly transient.
    const honestSnapshot = JSON.stringify(save.data);
    let beforeWrites = storage.saveWrites;
    ok(save.setSetting('unlockMaps', true) === true
        && save.getSetting('unlockMaps') === true
        && save.getMapBypassActive() === true,
    'dev map bypass can be enabled through the existing Settings seam');
    ok(storage.saveWrites === beforeWrites && JSON.stringify(save.data) === honestSnapshot,
        'enabling the dev map bypass performs zero writes and mutates no save data');
    ok(save.getAllMapUnlockStatuses().every((status) => status.unlocked && status.qaBypass),
        'dev bypass makes every known map effectively available with a QA receipt');
    ok(save.getMapUnlockStatus('unknown').unlocked === false,
        'dev bypass never turns an unknown map ID into a selectable map');

    beforeWrites = storage.saveWrites;
    ok(save.setSelectedMap('dunes') && save.getEffectiveSelectedMap() === 'dunes',
        'dev bypass can select Dunes for the current session');
    ok(storage.saveWrites === beforeWrites && JSON.stringify(save.data) === honestSnapshot,
        'a bypass-selected map performs zero writes and leaves honest selection untouched');
    const bypassDefeat = save.recordCampaignBossDefeat({
        mapId: 'dunes', bossId: 'cindermaw', eligible: true,
    });
    ok(!bypassDefeat.changed && bypassDefeat.reason === 'ineligible'
        && storage.saveWrites === beforeWrites,
    'campaign recording is forcibly ineligible while the map bypass is active');

    ok(save.setSetting('unlockMaps', false) === false
        && save.getEffectiveSelectedMap() === 'emberwood',
    'disabling bypass restores the persisted honest selection immediately');
    ok(storage.saveWrites === beforeWrites,
        'disabling the bypass performs zero storage writes');
    const reloadAfterBypass = new SaveSystem();
    ok(!reloadAfterBypass.getMapBypassActive()
        && reloadAfterBypass.getEffectiveSelectedMap() === 'emberwood',
    'reload cannot resurrect session bypass state or its selected map');

    // Honest map selection is persisted normally once campaign access exists.
    beforeWrites = storage.saveWrites;
    ok(save.setSelectedMap('hollowreach'), 'an honestly unlocked map can be selected');
    ok(storage.saveWrites === beforeWrites + 1
        && new SaveSystem().getEffectiveSelectedMap() === 'hollowreach',
    'honest map selection writes once and survives reload');

    // Lifetime boss totals remain statistics only.
    const ledgerBeforeStats = JSON.stringify(save.data.campaignProgress);
    save.recordRun({ bossesDefeated: 99 });
    ok(save.data.stats.totalBosses === 99
        && JSON.stringify(save.data.campaignProgress) === ledgerBeforeStats
        && !save.campaignMapUnlocked('crypts'),
    'recordRun updates lifetime totalBosses without granting campaign access');

    // Reset is the only profile mutation tested here that deliberately clears
    // both serialized progress and all transient map state.
    save.setSetting('unlockMaps', true);
    save.setSelectedMap('dunes');
    beforeWrites = storage.saveWrites;
    save.reset();
    ok(storage.saveWrites === beforeWrites + 1
        && !save.getMapBypassActive()
        && save.getEffectiveSelectedMap() === 'emberwood'
        && save.data.version === 10,
    'reset writes one fresh v10 profile and clears the session bypass');
    same(save.data.campaignProgress, createCampaignProgress(),
        'reset restores the fixed empty campaign ledger');
} finally {
    console.warn = originalWarn;
    restoreStorage();
}

if (failures) {
    console.error(`Campaign progression validation failed: ${failures}/${checks} checks.`);
    process.exit(1);
}

console.log(`Campaign progression validation passed: ${checks} exact-gate and persistence checks.`);
