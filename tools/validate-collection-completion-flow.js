#!/usr/bin/env node
// Collection Completion interaction/state gate. Pure mocks exercise the
// session-only navigation stack, exact three-second Blueprint confirmation,
// atomic SaveSystem hand-off, semantic receipts, and fail-closed UI snapshots.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    COSMETIC_BLUEPRINT_IDS,
    COSMETIC_SETS,
    cosmeticBlueprintCost,
    cosmeticById,
} from '../src/content/cosmetics.js';
import {
    BLUEPRINT_CONFIRM_MS,
    GameInputActionMethods,
    resetCollectionCompletionFlow,
} from '../src/core/GameInputActions.js';
import {
    COLLECTION_COMPLETION_DEFAULT_BLUEPRINT_ID,
    COLLECTION_COMPLETION_SECTIONS,
    blueprintClockNow,
    blueprintConfirmSnapshot,
    blueprintPurchasePendingSnapshot,
    blueprintReceiptSnapshot,
    buildUIState,
    collectionCompletionSnapshot,
} from '../src/systems/UIStateBuilder.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
let failures = 0;
const ok = (condition, message) => {
    checks++;
    if (!condition) {
        failures++;
        console.error(`  x ${message}`);
    }
};
const same = (actual, expected, message) => ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message} (got ${JSON.stringify(actual)})`,
);

const DEFAULT_FLOW = Object.freeze({
    open: false,
    section: 'overview',
    page: 1,
    blueprintId: 'aura_requiem',
});

function makeGame({ balance = 200000, unlocked = [], purchaseOverride = null } = {}) {
    const events = {
        announcements: [],
        screens: [],
        focusResets: 0,
        presses: [],
        purchases: [],
        writes: 0,
        tabsSeen: [],
        rewardAudio: 0,
        denyAudio: 0,
    };
    const data = {
        totalCoins: balance,
        cosmetics: {
            unlocked: [...unlocked],
            blueprintClaims: [],
            pursuitSetId: null,
        },
        stats: {},
        dailyRoad: null,
        riteTrial: null,
        bossRush: null,
        weeklyEmber: null,
        streak: null,
    };
    const saveSystem = {
        data,
        markTabSeen(tab) { events.tabsSeen.push(tab); },
        getEffectiveSelectedMap: () => 'emberwood',
        getAllMapUnlockStatuses: () => [],
        getMapBypassActive: () => false,
        gamblePlaysInfo: () => ({}),
        getDifficulty: () => 'normal',
        purchaseCosmeticBlueprint(id, quote) {
            events.purchases.push([id, quote]);
            if (purchaseOverride) return purchaseOverride({ id, quote, data, events });
            const item = cosmeticById(id);
            const cost = cosmeticBlueprintCost(item);
            if (data.cosmetics.unlocked.includes(id)) return { ok: false, reason: 'already-owned' };
            if (data.totalCoins < cost) return { ok: false, reason: 'insufficient-coins' };
            const ownedBefore = new Set(data.cosmetics.unlocked);
            const set = COSMETIC_SETS.find((entry) => Object.values(entry.pieces).includes(id)) || null;
            const setBefore = set
                ? Object.values(set.pieces).filter((pieceId) => ownedBefore.has(pieceId)).length
                : 0;
            const collectionBefore = ownedBefore.size;
            const balanceBefore = data.totalCoins;
            data.totalCoins -= cost;
            data.cosmetics.unlocked.push(id);
            data.cosmetics.blueprintClaims.push(id);
            events.writes++;
            return {
                ok: true,
                id,
                name: item.name,
                cost,
                balanceBefore,
                balanceAfter: data.totalCoins,
                collectionBefore,
                collectionAfter: collectionBefore + 1,
                setId: set?.id ?? null,
                setBefore,
                setAfter: set ? setBefore + 1 : 0,
            };
        },
    };
    const game = {
        screen: 'start',
        showDebug: false,
        pressFx: null,
        feedback: null,
        resetConfirming: false,
        resetConfirmTimer: 0,
        menuTab: 'character',
        settingsPane: 'general',
        characterPhonePane: 'collection',
        collectionCompletion: { ...DEFAULT_FLOW },
        blueprintConfirm: null,
        blueprintPurchasePending: null,
        _blueprintPurchaseSerial: 0,
        blueprintReceipt: null,
        collectionView: { category: 'aura', ownership: 'locked', source: 'all', page: 7 },
        boutiqueView: { category: 'fur', page: 1, setPage: 1 },
        menuFocusKey: null,
        menuTour: null,
        minigame: { caseAnim: null },
        menuToastTimer: 0,
        selectedModifiers: new Set(),
        selectedPatron: null,
        attuneSel: null,
        tryOn: {},
        bpResult: null,
        runSummary: null,
        saveSystem,
        haptics: { supported: () => true },
        input: { getModality: () => 'keyboard' },
        // Keep confirmation tests deterministic while exercising the same
        // monotonic-clock injection seam used by the production action layer.
        _blueprintClockNow: () => Date.now(),
        audio: {
            resume() {},
            click() {},
            cosmeticReward() { events.rewardAudio++; },
            deny() { events.denyAudio++; },
        },
        _pressFeedback(id) { events.presses.push(id); },
        _resetMenuFocus() { events.focusResets++; this.menuFocusKey = null; },
        accessibility: {
            setScreen(screen, detail) { events.screens.push({ screen, detail }); },
            announce(message) { events.announcements.push(message); },
            focusCanvas() {},
        },
    };
    return { game, events };
}

const dispatch = (game, action, arg = null) =>
    GameInputActionMethods._menuAction.call(game, action, arg);

same(COLLECTION_COMPLETION_SECTIONS, ['overview', 'sets', 'sources', 'blueprint', 'case'],
    'section allowlist is exact and stable');
ok(COLLECTION_COMPLETION_DEFAULT_BLUEPRINT_ID === 'aura_requiem',
    'default Blueprint is Requiem Orbit');
ok(BLUEPRINT_CONFIRM_MS === 3000, 'Blueprint confirmation window is exactly 3000ms');
same(COSMETIC_BLUEPRINT_IDS, ['aura_gloam_moths', 'aura_requiem'],
    'only the two authored Mythic Blueprints are actionable');

// Pure state snapshots sanitize and copy every session field.
same(collectionCompletionSnapshot({ collectionCompletion: { ...DEFAULT_FLOW } }), DEFAULT_FLOW,
    'valid Completion state snapshots exactly');
const malformedFlow = {
    collectionCompletion: { open: 1, section: 'admin', page: '9', blueprintId: 'aura_inferno' },
};
same(collectionCompletionSnapshot(malformedFlow), DEFAULT_FLOW,
    'malformed Completion state fails closed to exact defaults');
const copiedSource = { collectionCompletion: { ...DEFAULT_FLOW, open: true, page: 3 } };
const copiedSnapshot = collectionCompletionSnapshot(copiedSource);
copiedSnapshot.page = 99;
ok(copiedSource.collectionCompletion.page === 3,
    'mutating a Completion snapshot cannot mutate Game');

// Opening from Character preserves the scalable catalog filters/page.
{
    const { game, events } = makeGame();
    game.characterPhonePane = 'rites';
    const browseBefore = JSON.stringify(game.collectionView);
    dispatch(game, 'openCollectionCompletion');
    same(game.collectionCompletion, { ...DEFAULT_FLOW, open: true },
        'Completion CTA opens Overview at page one');
    ok(JSON.stringify(game.collectionView) === browseBefore
        && game.characterPhonePane === 'collection',
    'Completion CTA preserves catalog filters/page and makes catalog the return target');
    ok(events.focusResets === 1
        && /Collection Completion: Overview/i.test(events.screens.at(-1)?.detail || '')
        && /Collection truth opened/i.test(events.announcements.at(-1) || ''),
    'Completion CTA resets focus and announces the semantic surface');
}
{
    const { game, events } = makeGame();
    game.menuTab = 'home';
    const before = JSON.stringify(game.collectionCompletion);
    dispatch(game, 'openCollectionCompletion');
    ok(JSON.stringify(game.collectionCompletion) === before && events.focusResets === 0,
        'Completion CTA fails closed outside Character');
}

// A locked Blueprint card opens only an exact allowlisted target.
{
    const { game, events } = makeGame();
    const browseBefore = JSON.stringify(game.collectionView);
    dispatch(game, 'openCollectionBlueprint', 'aura_gloam_moths');
    same(game.collectionCompletion, {
        open: true, section: 'blueprint', page: 1, blueprintId: 'aura_gloam_moths',
    }, 'locked Blueprint card routes directly to its detail');
    ok(JSON.stringify(game.collectionView) === browseBefore
        && /Gloam Mothwake Blueprint selected/i.test(events.announcements.at(-1) || ''),
    'direct Blueprint route preserves catalog state and names the item');
    const stable = JSON.stringify(game.collectionCompletion);
    dispatch(game, 'openCollectionBlueprint', 'aura_inferno');
    ok(JSON.stringify(game.collectionCompletion) === stable,
        'non-Blueprint cosmetic cannot become a direct purchase target');
    dispatch(game, 'openCollectionBlueprint', '__unknown__');
    ok(JSON.stringify(game.collectionCompletion) === stable,
        'unknown direct Blueprint target fails closed');
}

// Section, page, and selection transitions are allowlisted, page-resetting,
// focus-safe, announced, and cancellation boundaries for an armed purchase.
{
    const { game, events } = makeGame();
    game.collectionCompletion = { ...DEFAULT_FLOW, open: true, page: 8 };
    for (const section of COLLECTION_COMPLETION_SECTIONS) {
        const armedAt = Date.now();
        game.blueprintConfirm = { id: 'aura_requiem', armedAt, expiresAt: armedAt + 3000 };
        dispatch(game, 'collectionCompletionSection', section);
        ok(game.collectionCompletion.section === section
            && game.collectionCompletion.page === 1
            && game.blueprintConfirm === null,
        `${section} section transition resets page and confirmation`);
        ok(new RegExp(`Collection Completion: ${section === 'blueprint' ? 'Blueprints' : ''}`, 'i')
            .test(events.announcements.at(-1) || '') || section !== 'blueprint',
        `${section} section transition has a semantic announcement`);
    }
    const stable = JSON.stringify(game.collectionCompletion);
    dispatch(game, 'collectionCompletionSection', 'store');
    ok(JSON.stringify(game.collectionCompletion) === stable,
        'unknown Completion section fails closed');

    game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'sets', page: 1 };
    dispatch(game, 'collectionCompletionPage', 2);
    ok(game.collectionCompletion.page === 2
        && /Page 2/i.test(events.announcements.at(-1) || ''),
    'positive integer Completion page routes and announces');
    for (const invalid of [0, -1, 1.5, '2', NaN, Infinity, null]) {
        const pageBefore = game.collectionCompletion.page;
        dispatch(game, 'collectionCompletionPage', invalid);
        ok(game.collectionCompletion.page === pageBefore,
            `malformed Completion page ${String(invalid)} fails closed`);
    }

    game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'blueprint' };
    {
        const armedAt = Date.now();
        game.blueprintConfirm = { id: 'aura_requiem', armedAt, expiresAt: armedAt + 3000 };
    }
    dispatch(game, 'collectionCompletionBlueprint', 'aura_gloam_moths');
    ok(game.collectionCompletion.blueprintId === 'aura_gloam_moths'
        && game.collectionCompletion.page === 1
        && game.blueprintConfirm === null
        && /Gloam Mothwake/i.test(events.announcements.at(-1) || ''),
    'Blueprint selection cancels confirmation and announces the exact item');
    const selected = game.collectionCompletion.blueprintId;
    dispatch(game, 'collectionCompletionBlueprint', 'aura_inferno');
    ok(game.collectionCompletion.blueprintId === selected,
        'non-Blueprint selection fails closed');
}

// The first purchase press arms with zero SaveSystem calls; the matching second
// press within the exact window is the only path to one atomic purchase.
const realNow = Date.now;
let now = 1900000000000;
Date.now = () => now;
try {
    const { game, events } = makeGame({ balance: 200000 });
    game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'blueprint' };
    const beforeData = JSON.stringify(game.saveSystem.data);
    dispatch(game, 'purchaseCollectionBlueprint', 'aura_requiem');
    ok(events.purchases.length === 0 && events.writes === 0
        && JSON.stringify(game.saveSystem.data) === beforeData,
    'first Blueprint press performs zero spend, unlock, claim, or write');
    same(game.blueprintConfirm, {
        id: 'aura_requiem', armedAt: now, expiresAt: now + BLUEPRINT_CONFIRM_MS,
    }, 'first Blueprint press arms the exact id and deadline');
    ok(game.blueprintReceipt === null
        && /Press purchase again within 3 seconds/i.test(events.announcements.at(-1) || ''),
    'first Blueprint press clears stale receipt and announces confirmation');
    same(blueprintConfirmSnapshot(game, now), {
        id: 'aura_requiem', armedAt: now,
        expiresAt: now + BLUEPRINT_CONFIRM_MS, seconds: 3,
    }, 'valid pending Blueprint confirmation snapshots with countdown');

    now += BLUEPRINT_CONFIRM_MS - 1;
    dispatch(game, 'purchaseCollectionBlueprint', 'aura_requiem');
    ok(events.purchases.length === 1 && events.writes === 1,
        'matching second Blueprint press calls the atomic Save API exactly once');
    same(events.purchases[0], ['aura_requiem', 72000],
        'atomic Save hand-off uses the exact id and catalog quote');
    ok(game.blueprintConfirm === null
        && game.saveSystem.data.totalCoins === 128000
        && game.saveSystem.data.cosmetics.unlocked.includes('aura_requiem')
        && game.saveSystem.data.cosmetics.blueprintClaims.includes('aura_requiem'),
    'successful second press commits one Blueprint and exact wallet delta');
    ok(game.blueprintReceipt?.ok === true
        && game.blueprintReceipt.kind === 'success'
        && game.blueprintReceipt.balanceBefore === 200000
        && game.blueprintReceipt.balanceAfter === 128000
        && game.blueprintReceipt.collectionAfter - game.blueprintReceipt.collectionBefore === 1
        && game.blueprintReceipt.setAfter - game.blueprintReceipt.setBefore === 1,
    'success stores wallet, collection, and set deltas in one receipt');
    const successAnnouncement = events.announcements.at(-1) || '';
    for (const fragment of ['Requiem Orbit', 'Minus 72,000', 'Wallet 128,000',
        'Collection plus 1', 'Gravebell Reliquary plus 1']) {
        ok(successAnnouncement.includes(fragment),
            `success announcement includes ${fragment}`);
    }
    ok(events.rewardAudio === 1 && events.denyAudio === 0,
        'successful Blueprint uses reward audio exactly once');
    const successSnapshot = blueprintReceiptSnapshot(game);
    ok(successSnapshot?.setName === 'Gravebell Reliquary'
        && successSnapshot !== game.blueprintReceipt,
    'success receipt snapshot resolves set name and copies the stored receipt');
    successSnapshot.balanceAfter = 1;
    ok(game.blueprintReceipt.balanceAfter === 128000,
        'mutating success receipt snapshot cannot alter Game receipt');

    // Keyboard activation retains the purchase control across the first press;
    // render-time focus reconciliation must not look like user navigation and
    // silently cancel the confirmation.
    const keyboard = makeGame({ balance: 200000 });
    keyboard.game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'blueprint' };
    keyboard.game.ui = { menu: { hotspots: [{
        key: 'purchase:requiem', action: 'purchaseCollectionBlueprint',
        arg: 'aura_requiem', label: 'Forge Requiem Orbit Blueprint',
        x: 0, y: 0, w: 180, h: 44,
    }] } };
    keyboard.game.menuFocusKey = 'purchase:requiem';
    keyboard.game._menuFocusableHotspots = GameInputActionMethods._menuFocusableHotspots;
    keyboard.game._menuMoveFocus = GameInputActionMethods._menuMoveFocus;
    keyboard.game._menuAction = (action, arg) => dispatch(keyboard.game, action, arg);
    now = 1950000000000;
    ok(GameInputActionMethods._menuActivateFocus.call(keyboard.game) === true,
        'keyboard activates the focused Blueprint control');
    ok(keyboard.game.blueprintConfirm?.id === 'aura_requiem'
        && keyboard.game.menuFocusKey === 'purchase:requiem'
        && keyboard.events.purchases.length === 0,
    'first keyboard activation arms without losing the purchase focus');
    ok(GameInputActionMethods._refreshMenuFocusAfterRender.call(keyboard.game) === 'retained'
        && keyboard.game.blueprintConfirm?.id === 'aura_requiem',
    'automatic post-render focus retention does not cancel confirmation');
    now++;
    GameInputActionMethods._menuActivateFocus.call(keyboard.game);
    ok(keyboard.events.purchases.length === 1 && keyboard.events.writes === 1
        && keyboard.game.blueprintReceipt?.ok === true,
    'second keyboard activation completes exactly one atomic purchase');

    // Exact boundary is expired: it creates a fresh arm and never calls Save.
    const expired = makeGame();
    expired.game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'blueprint' };
    now = 2000000000000;
    dispatch(expired.game, 'purchaseCollectionBlueprint', 'aura_requiem');
    now += BLUEPRINT_CONFIRM_MS;
    dispatch(expired.game, 'purchaseCollectionBlueprint', 'aura_requiem');
    ok(expired.events.purchases.length === 0 && expired.events.writes === 0,
        'confirmation at the exact deadline is expired and cannot spend');
    ok(expired.game.blueprintConfirm?.expiresAt === now + BLUEPRINT_CONFIRM_MS,
        'expired second press creates a fresh full confirmation window');

    // A monotonic source moving backward invalidates the old arm. The second
    // press cannot spend or silently extend that record; it creates one new,
    // exactly bounded arm from the new clock sample.
    const backward = makeGame();
    backward.game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'blueprint' };
    now = 2050000000000;
    dispatch(backward.game, 'purchaseCollectionBlueprint', 'aura_requiem');
    const priorArm = { ...backward.game.blueprintConfirm };
    now -= 250;
    ok(blueprintConfirmSnapshot({ ...backward.game, blueprintConfirm: priorArm }, now) === null,
        'confirmation snapshot hides a record after a backward-clock anomaly');
    dispatch(backward.game, 'purchaseCollectionBlueprint', 'aura_requiem');
    same(backward.game.blueprintConfirm, {
        id: 'aura_requiem', armedAt: now, expiresAt: now + BLUEPRINT_CONFIRM_MS,
    }, 'backward-clock second press re-arms one exact fresh window');
    ok(backward.events.purchases.length === 0 && backward.events.writes === 0,
        'backward-clock second press cannot purchase or write');

    // Mismatched target, selection, section, focus, and tab navigation cancel.
    const canceled = makeGame();
    canceled.game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'blueprint' };
    now = 2100000000000;
    dispatch(canceled.game, 'purchaseCollectionBlueprint', 'aura_requiem');
    dispatch(canceled.game, 'purchaseCollectionBlueprint', 'aura_gloam_moths');
    ok(canceled.game.blueprintConfirm === null && canceled.events.purchases.length === 0,
        'mismatched second Blueprint id cancels without Save call');
    dispatch(canceled.game, 'purchaseCollectionBlueprint', 'aura_requiem');
    dispatch(canceled.game, 'collectionCompletionBlueprint', 'aura_gloam_moths');
    ok(canceled.game.blueprintConfirm === null,
        'Blueprint selection cancels an armed purchase');
    dispatch(canceled.game, 'purchaseCollectionBlueprint', 'aura_gloam_moths');
    dispatch(canceled.game, 'collectionCompletionSection', 'sources');
    ok(canceled.game.blueprintConfirm === null,
        'Completion section navigation cancels an armed purchase');
    canceled.game.collectionCompletion = {
        ...DEFAULT_FLOW, open: true, section: 'blueprint', blueprintId: 'aura_requiem',
    };
    dispatch(canceled.game, 'purchaseCollectionBlueprint', 'aura_requiem');
    canceled.game.ui = { menu: { hotspots: [{ key: 'next', action: 'noop', x: 0, y: 0, w: 44, h: 44 }] } };
    canceled.game._menuFocusableHotspots = GameInputActionMethods._menuFocusableHotspots;
    canceled.game._menuMoveFocus = GameInputActionMethods._menuMoveFocus;
    GameInputActionMethods._menuKeyboardActivate.call(canceled.game);
    ok(canceled.game.blueprintConfirm === null,
        'keyboard focus navigation cancels an armed purchase');
    canceled.game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'blueprint' };
    canceled.game.blueprintConfirm = {
        id: 'aura_requiem', armedAt: now, expiresAt: now + 3000,
    };
    dispatch(canceled.game, 'tab', 'home');
    ok(canceled.game.blueprintConfirm === null
        && canceled.game.collectionCompletion.open === false
        && canceled.game.menuTab === 'home',
    'global tab navigation closes Completion and cancels purchase');
} finally {
    Date.now = realNow;
}

// Insufficient funds surface the exact shortfall without any mock write.
{
    const { game, events } = makeGame({ balance: 1250 });
    game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'blueprint' };
    const real = Date.now;
    let t = 2200000000000;
    Date.now = () => t;
    try {
        const before = JSON.stringify(game.saveSystem.data);
        dispatch(game, 'purchaseCollectionBlueprint', 'aura_requiem');
        t++;
        dispatch(game, 'purchaseCollectionBlueprint', 'aura_requiem');
        ok(events.purchases.length === 1 && events.writes === 0
            && JSON.stringify(game.saveSystem.data) === before,
        'insufficient Blueprint attempt performs zero mutation/write');
        same(game.blueprintReceipt, {
            ok: false,
            kind: 'insufficient',
            reason: 'insufficient-coins',
            id: 'aura_requiem',
            name: 'Requiem Orbit',
            cost: 72000,
            balance: 1250,
            shortfall: 70750,
        }, 'insufficient receipt stores exact wallet and shortfall');
        ok(/costs 72,000/i.test(events.announcements.at(-1) || '')
            && /Short 70,750/i.test(events.announcements.at(-1) || '')
            && /Wallet 1,250/i.test(events.announcements.at(-1) || ''),
        'insufficient announcement gives cost, shortfall, and wallet');
        ok(events.denyAudio === 1 && events.rewardAudio === 0,
            'insufficient attempt uses deny audio and no reward audio');
        ok(blueprintReceiptSnapshot(game)?.kind === 'insufficient',
            'insufficient receipt crosses the UI boundary safely');
    } finally {
        Date.now = real;
    }
}

// Owned/replay rejection stays non-mutating and receives an honest explanation.
{
    const { game, events } = makeGame({ unlocked: ['aura_requiem'] });
    game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'blueprint' };
    const real = Date.now;
    let t = 2300000000000;
    Date.now = () => t;
    try {
        dispatch(game, 'purchaseCollectionBlueprint', 'aura_requiem');
        t++;
        dispatch(game, 'purchaseCollectionBlueprint', 'aura_requiem');
    } finally {
        Date.now = real;
    }
    ok(events.writes === 0 && game.blueprintReceipt?.reason === 'already-owned'
        && /already in your collection/i.test(events.announcements.at(-1) || ''),
    'already-owned purchase is rejected without write and announced honestly');
}

// Durable-save failures remain non-mutating and give both sighted and assistive
// users an actionable retry/reload instruction instead of a generic rejection.
for (const [reason, announcement] of [
    ['external-save-changed', /not charged.*reload/i],
    ['persistence-unavailable', /not charged.*restore storage access/i],
    ['persistence-failed', /not charged.*check storage/i],
    ['transaction-busy', /not charged.*try the Blueprint again/i],
    ['transaction-lock-unavailable', /not charged.*update the browser/i],
    ['transaction-lock-failed', /not charged.*try again/i],
]) {
    const { game, events } = makeGame({
        purchaseOverride: () => ({ ok: false, reason }),
    });
    game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'blueprint' };
    let t = 2400000000000;
    game._blueprintClockNow = () => t;
    const before = JSON.stringify(game.saveSystem.data);
    dispatch(game, 'purchaseCollectionBlueprint', 'aura_requiem');
    t++;
    dispatch(game, 'purchaseCollectionBlueprint', 'aura_requiem');
    ok(events.purchases.length === 1 && events.writes === 0
        && JSON.stringify(game.saveSystem.data) === before,
    `${reason} performs zero mock mutation/write`);
    ok(game.blueprintReceipt?.reason === reason
        && announcement.test(events.announcements.at(-1) || ''),
    `${reason} exposes the required no-charge recovery instruction`);
    ok(blueprintReceiptSnapshot(game)?.reason === reason,
        `${reason} survives the strict UI receipt allowlist`);
}

// Production SaveSystem resolves through an asynchronous origin-wide lock. The
// UI exposes one disabled pending state, ignores repeat activation, and applies
// the exact same strict receipt only after the lock promise settles.
{
    const { game, events } = makeGame({ balance: 200000 });
    game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'blueprint' };
    let t = 2450000000000;
    game._blueprintClockNow = () => t;
    const unlockedPurchase = game.saveSystem.purchaseCosmeticBlueprint.bind(game.saveSystem);
    game.saveSystem.purchaseCosmeticBlueprintAtomic = (id, quote) =>
        Promise.resolve().then(() => unlockedPurchase(id, quote));
    dispatch(game, 'purchaseCollectionBlueprint', 'aura_requiem');
    t++;
    dispatch(game, 'purchaseCollectionBlueprint', 'aura_requiem');
    ok(game.blueprintPurchasePending?.id === 'aura_requiem'
        && game.blueprintReceipt === null && events.purchases.length === 0,
    'atomic second press enters one receipt-free pending state before lock grant');
    dispatch(game, 'purchaseCollectionBlueprint', 'aura_requiem');
    ok(events.purchases.length === 0 && game.blueprintPurchasePending?.id === 'aura_requiem',
        'repeat activation cannot duplicate an in-flight atomic purchase');
    await Promise.resolve();
    await Promise.resolve();
    ok(events.purchases.length === 1 && events.writes === 1
        && game.blueprintPurchasePending === null && game.blueprintReceipt?.ok === true,
    'resolved origin lock applies exactly one strict success receipt');
}

// A missing monotonic clock fails closed. Adjustable wall time is never used to
// keep a paid-action window alive on an unsupported runtime.
{
    const { game, events } = makeGame();
    game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'blueprint' };
    game._blueprintClockNow = () => null;
    dispatch(game, 'purchaseCollectionBlueprint', 'aura_requiem');
    ok(game.blueprintConfirm === null && events.purchases.length === 0
        && events.writes === 0 && events.denyAudio === 1,
    'unavailable monotonic clock cannot arm, spend, or write');
    ok(/confirmation is unavailable.*No coins were charged/i
        .test(events.announcements.at(-1) || ''),
    'unavailable monotonic clock explains its no-charge failure');
    ok(blueprintClockNow({ _blueprintClockNow: () => null }) === null
        || Number.isFinite(globalThis.performance?.now?.()),
    'clock helper either uses platform monotonic time or fails closed');
}

// Purchase and cancel actions reject malformed/stale direct dispatches.
{
    const { game, events } = makeGame();
    game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'blueprint' };
    for (const invalid of [null, undefined, '', 'aura_inferno', '__unknown__', { id: 'aura_requiem' }]) {
        dispatch(game, 'purchaseCollectionBlueprint', invalid);
        ok(game.blueprintConfirm === null && events.purchases.length === 0,
            `malformed purchase target ${String(invalid)} fails closed`);
    }
    dispatch(game, 'purchaseCollectionBlueprint', 'aura_requiem');
    dispatch(game, 'cancelCollectionBlueprint');
    ok(game.blueprintConfirm === null && game.blueprintReceipt === null
        && events.purchases.length === 0
        && /purchase canceled/i.test(events.announcements.at(-1) || ''),
    'explicit cancel clears the arm without Save call and announces');
    const focusBefore = events.focusResets;
    game.blueprintReceipt = { marker: 'stable' };
    dispatch(game, 'cancelCollectionBlueprint');
    ok(events.focusResets === focusBefore && game.blueprintReceipt?.marker === 'stable',
        'cancel with no pending purchase fails closed without erasing a receipt');
    game.collectionCompletion.open = false;
    dispatch(game, 'purchaseCollectionBlueprint', 'aura_requiem');
    ok(game.blueprintConfirm === null && events.purchases.length === 0,
        'purchase cannot arm while Completion is closed');
}

// Back uses one exact hierarchy and the Overview back returns the catalog.
{
    const { game, events } = makeGame();
    game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'case', page: 4 };
    {
        const armedAt = Date.now();
        game.blueprintConfirm = { id: 'aura_requiem', armedAt, expiresAt: armedAt + 3000 };
    }
    game.blueprintReceipt = { stale: true };
    dispatch(game, 'collectionCompletionBack');
    ok(game.collectionCompletion.section === 'blueprint'
        && game.collectionCompletion.page === 1
        && game.blueprintConfirm === null && game.blueprintReceipt === null,
    'Back routes Case to Blueprint and clears transient purchase state');
    dispatch(game, 'collectionCompletionBack');
    ok(game.collectionCompletion.section === 'sources', 'Back routes Blueprint to Sources');
    dispatch(game, 'collectionCompletionBack');
    ok(game.collectionCompletion.section === 'overview', 'Back routes Sources to Overview');
    dispatch(game, 'collectionCompletionBack');
    ok(game.collectionCompletion.open === false
        && game.characterPhonePane === 'collection'
        && /Character Collection/i.test(events.announcements.at(-1) || ''),
    'Back routes Overview to the Character catalog');

    game.menuTab = 'character';
    game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'sets' };
    dispatch(game, 'collectionCompletionBack');
    ok(game.collectionCompletion.section === 'overview', 'Back routes Sets to Overview');
    game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'overview' };
    dispatch(game, 'closeCollectionCompletion');
    ok(game.collectionCompletion.open === false,
        'explicit close safely returns to catalog too');
}

// Phone Rites remains independent, while entering either phone pane closes a
// stale Completion surface and clears its confirmation.
{
    const { game, events } = makeGame();
    game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'blueprint' };
    {
        const armedAt = Date.now();
        game.blueprintConfirm = { id: 'aura_requiem', armedAt, expiresAt: armedAt + 3000 };
    }
    dispatch(game, 'characterPhonePane', 'rites');
    ok(game.characterPhonePane === 'rites'
        && game.collectionCompletion.open === false
        && game.blueprintConfirm === null
        && /Hero Rites and Attunement/i.test(events.announcements.at(-1) || ''),
    'phone Rites remains independently reachable and cancels Completion');
}

// Generic reset helper is idempotent, preserves the selected Blueprint, and
// supports retaining a receipt only for an explicit diagnostic caller.
{
    const game = {
        collectionCompletion: {
            open: true, section: 'case', page: 8, blueprintId: 'aura_gloam_moths',
        },
        blueprintConfirm: (() => {
            const armedAt = Date.now();
            return { id: 'aura_gloam_moths', armedAt, expiresAt: armedAt + 3000 };
        })(),
        blueprintReceipt: { marker: true },
    };
    ok(resetCollectionCompletionFlow(game) === true,
        'Completion reset helper accepts a Game-like object');
    same(game.collectionCompletion, {
        open: false, section: 'overview', page: 1, blueprintId: 'aura_gloam_moths',
    }, 'Completion reset returns catalog defaults while preserving selection');
    ok(game.blueprintConfirm === null && game.blueprintReceipt === null,
        'Completion reset clears confirmation and receipt');
    game.blueprintReceipt = { marker: true };
    resetCollectionCompletionFlow(game, { clearReceipt: false });
    ok(game.blueprintReceipt?.marker === true,
        'diagnostic reset can explicitly retain a receipt');
    ok(resetCollectionCompletionFlow(null) === false,
        'Completion reset helper fails closed on invalid target');
}

// Snapshot allowlists reject stale, expired, mismatched, and forged objects.
{
    const base = {
        collectionCompletion: { ...DEFAULT_FLOW, open: true, section: 'blueprint' },
        blueprintConfirm: { id: 'aura_requiem', armedAt: 2000, expiresAt: 5000 },
    };
    base.blueprintPurchasePending = { id: 'aura_requiem', serial: 4 };
    same(blueprintPurchasePendingSnapshot(base), { id: 'aura_requiem' },
        'valid atomic pending state snapshots without exposing its serial');
    base.blueprintPurchasePending = { id: 'aura_requiem', serial: 0 };
    ok(blueprintPurchasePendingSnapshot(base) === null,
        'atomic pending snapshot rejects a malformed serial');
    base.blueprintPurchasePending = null;
    ok(blueprintConfirmSnapshot(base, 4999)?.seconds === 1,
        'confirmation snapshot keeps a live final millisecond');
    ok(blueprintConfirmSnapshot(base, 5000) === null,
        'confirmation snapshot expires at the exact deadline');
    base.blueprintConfirm.id = 'aura_gloam_moths';
    ok(blueprintConfirmSnapshot(base, 4000) === null,
        'confirmation snapshot rejects id not matching selection');
    base.blueprintConfirm = { id: 'aura_requiem', armedAt: 2000, expiresAt: '5000' };
    ok(blueprintConfirmSnapshot(base, 4000) === null,
        'confirmation snapshot rejects malformed deadline');
    base.blueprintConfirm = { id: 'aura_requiem', armedAt: 2001, expiresAt: 5000 };
    ok(blueprintConfirmSnapshot(base, 4000) === null,
        'confirmation snapshot rejects a forged confirmation duration');
    base.blueprintConfirm = { id: 'aura_requiem', armedAt: '2000', expiresAt: 5000 };
    ok(blueprintConfirmSnapshot(base, 4000) === null,
        'confirmation snapshot rejects malformed arm time');
    base.collectionCompletion.section = 'sources';
    base.blueprintConfirm = { id: 'aura_requiem', armedAt: 2000, expiresAt: 5000 };
    ok(blueprintConfirmSnapshot(base, 4000) === null,
        'confirmation snapshot is hidden outside Blueprint section');

    const forged = {
        blueprintReceipt: {
            ok: false, kind: 'insufficient', reason: 'insufficient-coins',
            id: 'aura_requiem', name: 'Forged', cost: 1, balance: 0, shortfall: 1,
        },
    };
    ok(blueprintReceiptSnapshot(forged) === null,
        'receipt snapshot rejects forged name and quote');
    forged.blueprintReceipt = {
        ok: false, kind: 'insufficient', reason: 'insufficient-coins',
        id: 'aura_requiem', name: 'Requiem Orbit', cost: 72000,
        balance: -1, shortfall: 72001,
    };
    ok(blueprintReceiptSnapshot(forged) === null,
        'receipt snapshot rejects negative wallet');
    forged.blueprintReceipt = {
        ok: false, kind: 'error', reason: '<script>',
        id: 'aura_requiem', name: 'Requiem Orbit', cost: 72000,
        balance: 0, shortfall: 0,
    };
    ok(blueprintReceiptSnapshot(forged) === null,
        'receipt snapshot rejects unknown failure reasons');
}

// Full start-screen snapshot includes fresh copies, never persistence writes.
{
    const { game, events } = makeGame();
    game.collectionCompletion = { ...DEFAULT_FLOW, open: true, section: 'blueprint' };
    const armedAt = Date.now();
    game.blueprintConfirm = {
        id: 'aura_requiem', armedAt, expiresAt: armedAt + BLUEPRINT_CONFIRM_MS,
    };
    const writesBefore = events.writes;
    const state = buildUIState(game);
    ok(state.collectionCompletion.open === true
        && state.collectionCompletion !== game.collectionCompletion,
    'buildUIState exposes a copied Completion state');
    ok(state.blueprintConfirm?.id === 'aura_requiem'
        && state.blueprintConfirm !== game.blueprintConfirm,
    'buildUIState exposes a copied live confirmation');
    ok(state.blueprintReceipt === null && events.writes === writesBefore,
        'buildUIState never persists Completion state');
}

// Source contract guards ensure every non-render navigation boundary uses the
// shared reset and Escape precedence remains ahead of phone Rites.
const gameSource = fs.readFileSync(path.join(ROOT, 'src/core/Game.js'), 'utf8');
const actionSource = fs.readFileSync(path.join(ROOT, 'src/core/GameInputActions.js'), 'utf8');
const uiStateSource = fs.readFileSync(path.join(ROOT, 'src/systems/UIStateBuilder.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(ROOT, 'src/systems/MenuRenderer.js'), 'utf8');
const saveSource = fs.readFileSync(path.join(ROOT, 'src/systems/SaveSystem.js'), 'utf8');
const harnessSource = fs.readFileSync(path.join(ROOT, 'tools/artshot/harness.html'), 'utf8');
const ciSource = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
for (const action of [
    'openCollectionCompletion',
    'openCollectionBlueprint',
    'closeCollectionCompletion',
    'collectionCompletionSection',
    'collectionCompletionPage',
    'collectionCompletionBlueprint',
    'purchaseCollectionBlueprint',
    'cancelCollectionBlueprint',
    'collectionCompletionBack',
]) {
    ok(actionSource.includes(`case '${action}'`), `central menu router owns ${action}`);
}
ok(gameSource.includes("blueprintId: 'aura_requiem'")
    && gameSource.includes('this.blueprintConfirm = null;')
    && gameSource.includes('this.blueprintPurchasePending = null;')
    && gameSource.includes('this.blueprintReceipt = null;'),
'Game constructor owns exact session-only Completion defaults');
for (const [owner, anchor] of [
    ['_startRun', '\n    _startRun({'],
    ['returnToShop', '\n    returnToShop() {'],
    ['_armMenuTour', '\n    _armMenuTour() {'],
    ['_applyTourStep', '\n    _applyTourStep() {'],
    ['_endMenuTour', '\n    _endMenuTour() {'],
]) {
    const start = gameSource.indexOf(anchor);
    const block = gameSource.slice(start, start + 900);
    ok(start >= 0 && block.includes('resetCollectionCompletionFlow(this)'),
        `${owner} cancels Completion through the shared reset`);
}
const completionEscape = gameSource.indexOf("this._menuAction('collectionCompletionBack', null)");
const ritesEscape = gameSource.indexOf("this._menuAction('characterPhonePane', 'collection')");
ok(completionEscape >= 0 && ritesEscape > completionEscape,
    'Completion Escape takes precedence before independent phone Rites Escape');
const focusNavigationStart = gameSource.indexOf("if (e.code === 'Tab' || e.code === 'ArrowRight'");
const focusNavigationBlock = gameSource.slice(focusNavigationStart, focusNavigationStart + 520);
ok(focusNavigationStart >= 0
    && focusNavigationBlock.indexOf('this.blueprintConfirm = null;')
        < focusNavigationBlock.indexOf('this._menuMoveFocus'),
'explicit Tab/arrow navigation cancels Blueprint before moving focus');
ok(actionSource.includes("'blueprint', 'case', 'achievement', 'vigil'")
    && actionSource.includes("arg === 'blueprint' ? 'Blueprint'"),
'catalog source action accepts and announces Blueprint without weakening other filters');
const clockStart = uiStateSource.indexOf('export function blueprintClockNow');
const clockBlock = uiStateSource.slice(clockStart, clockStart + 900);
ok(clockStart >= 0 && actionSource.includes('blueprintClockNow(this)')
    && clockBlock.includes('globalThis.performance.now()')
    && clockBlock.includes('return null;')
    && !clockBlock.includes('return Date.now()')
    && !rendererSource.includes('Date.now()'),
'Blueprint confirmation uses monotonic authority with no renderer/wall-clock fallback');
ok(actionSource.includes('purchaseCosmeticBlueprintAtomic')
    && actionSource.includes('this.blueprintPurchasePending')
    && saveSource.includes("SAVE_TRANSACTION_LOCK_NAME = 'emberwake:save:v1:exclusive'")
    && saveSource.includes("{ mode: 'exclusive', ifAvailable: true }")
    && saveSource.includes("reason: 'transaction-lock-unavailable'")
    && rendererSource.includes('SECURING SAVE ACROSS TABS'),
'player-facing Blueprint commit is serialized by an exclusive same-origin Web Lock');
ok(harnessSource.includes('completionMutationRequested')
    && harnessSource.includes('completionMutationAllowed')
    && harnessSource.includes('fixture, wallet, and purchase controls are local-only')
    && harnessSource.includes('QA_COMPLETION_SECTION && completionMutationAllowed'),
'harness economy fixtures are localhost-only and cannot continue after rejection');
ok(harnessSource.includes('completionTextSafe: game.ui?.menu?._lastCollectionCompletionTextSafe === true')
    && harnessSource.includes('qaRoot.dataset.qaCompletionTextSafe')
    && harnessSource.includes('qaRoot.dataset.qaCompletionCaseTruth'),
'harness publishes production text-safety and Royal Case authority receipts');
ok(ciSource.includes('collection-completion-truth-visual-receipts')
    && ciSource.includes('data-qa-completion-case-truth="59:8200:1080:720:150:10:0:false"')
    && ciSource.includes('data-qa-completion-text-safe="true"')
    && ciSource.includes('completion-overview-compact 480,270')
    && ciSource.includes('completion-sources-compact 480,270')
    && ciSource.includes('completion-requiem-compact 480,270')
    && ciSource.includes('completion-case-compact 480,270')
    && ciSource.includes(' -eq 10 ]'),
'CI uploads Completion receipts and gates their text/case truth');

if (failures) {
    console.error(`Collection Completion flow validation FAILED: ${failures}/${checks} checks failed.`);
    process.exit(1);
}
console.log(`Collection Completion flow validation: OK - ${checks} session, confirmation, receipt, navigation, and snapshot checks.`);
