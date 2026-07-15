#!/usr/bin/env node
// Focused durability gate for permanent-upgrade and direct coin-cosmetic
// checkout. The synchronous exports prove the one-write detached-draft seam;
// the browser-shaped section proves that a second live participant rejects the
// origin-wide transaction before debit and that a fresh retry preserves the
// other tab's authoritative write.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COSMETICS, cosmeticCoinCost } from '../src/content/cosmetics.js';
import { PERMANENT_UPGRADES, nextCost } from '../src/content/permanentUpgrades.js';
import { GameInputActionMethods } from '../src/core/GameInputActions.js';
import {
    MAX_COIN_BALANCE,
    SAVE_PARTICIPATION_LOCK_NAME,
    SAVE_TRANSACTION_LOCK_NAME,
    SaveSystem,
} from '../src/systems/SaveSystem.js';
import {
    purchaseCoinCosmetic,
    purchaseCoinCosmeticAtomic,
    purchasePermanentUpgrade,
    purchasePermanentUpgradeAtomic,
} from '../src/systems/ShopTransaction.js';

const SAVE_KEY = 'monkey-survivor:save:v1';
const UPGRADE_ID = 'maxHp';
const COSMETIC_ID = 'fur_ashen';
const UPGRADE = PERMANENT_UPGRADES.find((entry) => entry.id === UPGRADE_ID);
const COSMETIC = COSMETICS[COSMETIC_ID];
const UPGRADE_COST = nextCost(UPGRADE, 0);
const COSMETIC_COST = cosmeticCoinCost(COSMETIC);

let checks = 0;
function check(condition, message) {
    assert.ok(condition, message);
    checks += 1;
}
function same(actual, expected, message) {
    assert.deepEqual(actual, expected, message);
    checks += 1;
}

class MemoryStorage {
    constructor(raw = undefined) {
        this.values = new Map();
        if (raw !== undefined) this.values.set(SAVE_KEY, String(raw));
        this.saveWrites = 0;
        this.saveWriteAttempts = 0;
        this.failNextSave = false;
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    setItem(key, value) {
        if (key === SAVE_KEY) {
            this.saveWriteAttempts += 1;
            if (this.failNextSave) {
                this.failNextSave = false;
                throw new Error('injected shop write failure');
            }
            this.saveWrites += 1;
        }
        this.values.set(key, String(value));
    }

    removeItem(key) {
        this.values.delete(key);
    }

    resetWriteCounts() {
        this.saveWrites = 0;
        this.saveWriteAttempts = 0;
    }
}

// Small origin-wide Web Locks model. Shared participant holders coexist;
// exclusive ifAvailable requests fail immediately instead of queueing.
class LockManagerHarness {
    constructor() {
        this.calls = [];
        this.holders = new Map();
        this.queues = new Map();
        this.serial = 0;
    }

    request(name, options, callback) {
        const normalized = {
            mode: options?.mode === 'shared' ? 'shared' : 'exclusive',
            ifAvailable: options?.ifAvailable === true,
        };
        const request = {
            id: ++this.serial,
            name,
            options: normalized,
            callback,
        };
        this.calls.push({ name, options: { ...normalized } });
        return new Promise((resolve, reject) => {
            Object.assign(request, { resolve, reject });
            if (normalized.ifAvailable) {
                queueMicrotask(() => {
                    if (this._canGrant(name, normalized.mode)) this._grant(request);
                    else {
                        try {
                            Promise.resolve(callback(null)).then(resolve, reject);
                        } catch (error) {
                            reject(error);
                        }
                    }
                });
                return;
            }
            if (!this.queues.has(name)) this.queues.set(name, []);
            this.queues.get(name).push(request);
            queueMicrotask(() => this._drain(name));
        });
    }

    _canGrant(name, mode) {
        const holders = this.holders.get(name) || [];
        return mode === 'shared'
            ? holders.every((holder) => holder.mode === 'shared')
            : holders.length === 0;
    }

    _drain(name) {
        const queue = this.queues.get(name) || [];
        if (!queue.length || !this._canGrant(name, queue[0].options.mode)) return;
        if (queue[0].options.mode === 'exclusive') {
            this._grant(queue.shift());
            return;
        }
        while (queue.length && queue[0].options.mode === 'shared'
            && this._canGrant(name, 'shared')) {
            this._grant(queue.shift());
        }
    }

    _grant(request) {
        const holder = { id: request.id, mode: request.options.mode };
        if (!this.holders.has(request.name)) this.holders.set(request.name, []);
        this.holders.get(request.name).push(holder);
        let output;
        try {
            output = request.callback(Object.freeze({
                name: request.name,
                mode: holder.mode,
            }));
        } catch (error) {
            this._release(request.name, holder);
            request.reject(error);
            return;
        }
        Promise.resolve(output).then((value) => {
            this._release(request.name, holder);
            request.resolve(value);
        }, (error) => {
            this._release(request.name, holder);
            request.reject(error);
        });
    }

    _release(name, holder) {
        const holders = this.holders.get(name) || [];
        const index = holders.indexOf(holder);
        if (index >= 0) holders.splice(index, 1);
        queueMicrotask(() => this._drain(name));
    }

    held(name, mode = null) {
        return (this.holders.get(name) || []).filter((holder) => (
            mode === null || holder.mode === mode
        )).length;
    }
}

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalWarn = console.warn;

function setGlobal(key, value) {
    Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
    });
}

function restoreGlobal(key, descriptor) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
}

function useNonBrowser(storage) {
    setGlobal('localStorage', storage);
    setGlobal('navigator', {});
    delete globalThis.window;
}

function createSynchronousFixture(coins = 10_000) {
    const storage = new MemoryStorage();
    useNonBrowser(storage);
    const save = new SaveSystem();
    save.data.totalCoins = coins;
    check(save.save() === true, 'shop fixture baseline could not be persisted');
    storage.resetWriteCounts();
    return { save, storage };
}

async function createParticipatingSave(storage, manager) {
    setGlobal('localStorage', storage);
    setGlobal('navigator', { locks: manager });
    setGlobal('window', {});
    const save = new SaveSystem();
    check(await save.whenSaveParticipationReady(),
        'browser shop participant did not acquire its shared save lock');
    return save;
}

function validateSynchronousUpgradeDurability() {
    const { save, storage } = createSynchronousFixture();
    const liveData = save.data;
    const liveUpgrades = save.data.upgrades;
    const before = structuredClone(save.data);
    const rawBefore = storage.getItem(SAVE_KEY);
    storage.failNextSave = true;
    console.warn = () => {};
    const failed = purchasePermanentUpgrade(save, UPGRADE_ID);
    console.warn = originalWarn;

    check(failed.ok === false && failed.reason === 'save-unavailable',
        'failed upgrade write exposed a successful or ambiguous receipt');
    check(save.data === liveData && save.data.upgrades === liveUpgrades,
        'failed upgrade write did not restore exact live/nested object identity');
    same(save.data, before, 'failed upgrade write leaked a debit or level into memory');
    check(storage.getItem(SAVE_KEY) === rawBefore,
        'failed upgrade write changed durable authority');
    check(storage.saveWriteAttempts === 1 && storage.saveWrites === 0,
        'failed upgrade did not collapse to one rejected final write');

    const retry = purchasePermanentUpgrade(save, UPGRADE_ID);
    check(retry.ok === true && retry.kind === 'upgrade'
        && retry.levelBefore === 0 && retry.levelAfter === 1,
    'upgrade retry did not grant exactly the missed level');
    check(storage.saveWriteAttempts === 2 && storage.saveWrites === 1,
        'upgrade retry did not use exactly one successful final write');
    check(save.getUpgradeLevel(UPGRADE_ID) === 1
        && save.data.totalCoins === before.totalCoins - UPGRADE_COST,
    'upgrade retry duplicated its entitlement or debit');
    same(JSON.parse(storage.getItem(SAVE_KEY)), save.data,
        'upgrade receipt preceded its exact durable payload');
}

function validateSynchronousCosmeticDurability() {
    const { save, storage } = createSynchronousFixture();
    check(!save.isCosmeticUnlocked(COSMETIC_ID),
        'chosen direct-purchase cosmetic is unexpectedly owned by default');
    const liveData = save.data;
    const liveCosmetics = save.data.cosmetics;
    const liveUnlocked = save.data.cosmetics.unlocked;
    const before = structuredClone(save.data);
    const rawBefore = storage.getItem(SAVE_KEY);
    storage.failNextSave = true;
    console.warn = () => {};
    const failed = purchaseCoinCosmetic(save, COSMETIC_ID);
    console.warn = originalWarn;

    check(failed.ok === false && failed.reason === 'save-unavailable',
        'failed cosmetic write exposed a successful or ambiguous receipt');
    check(save.data === liveData && save.data.cosmetics === liveCosmetics
        && save.data.cosmetics.unlocked === liveUnlocked,
    'failed cosmetic write did not restore exact live/nested object identity');
    same(save.data, before, 'failed cosmetic write leaked debit/unlock/equip state');
    check(storage.getItem(SAVE_KEY) === rawBefore,
        'failed cosmetic write changed durable authority');
    check(storage.saveWriteAttempts === 1 && storage.saveWrites === 0,
        'failed cosmetic did not collapse to one rejected final write');

    const retry = purchaseCoinCosmetic(save, COSMETIC_ID);
    check(retry.ok === true && retry.kind === 'cosmetic' && retry.id === COSMETIC_ID,
        'cosmetic retry did not grant the missed entitlement');
    check(storage.saveWriteAttempts === 2 && storage.saveWrites === 1,
        'cosmetic retry did not use exactly one successful final write');
    check(save.data.totalCoins === before.totalCoins - COSMETIC_COST
        && save.data.cosmetics.unlocked.filter((id) => id === COSMETIC_ID).length === 1
        && save.getEquippedCosmetics()[COSMETIC.category] === COSMETIC_ID,
    'cosmetic retry duplicated, failed to equip, or charged the wrong amount');
    same(JSON.parse(storage.getItem(SAVE_KEY)), save.data,
        'cosmetic receipt preceded its exact durable payload');

    const writesBeforeDuplicate = storage.saveWrites;
    const duplicate = purchaseCoinCosmetic(save, COSMETIC_ID);
    check(duplicate.ok === false && duplicate.reason === 'already-owned',
        'owned cosmetic replay was not rejected before checkout');
    check(storage.saveWrites === writesBeforeDuplicate
        && save.data.cosmetics.unlocked.filter((id) => id === COSMETIC_ID).length === 1,
    'owned cosmetic replay wrote or duplicated the entitlement');
}

function validatePreflightRejections() {
    const { save, storage } = createSynchronousFixture(0);
    const liveData = save.data;
    const before = structuredClone(save.data);
    const unownedEarned = Object.values(COSMETICS).find((item) => (
        cosmeticCoinCost(item) === 0 && !save.isCosmeticUnlocked(item.id)
    ));
    check(!!unownedEarned, 'shop preflight fixture has no unowned earned cosmetic');

    const results = [
        purchasePermanentUpgrade(save, 'not-an-upgrade'),
        purchasePermanentUpgrade(save, UPGRADE_ID),
        purchaseCoinCosmetic(save, 'not-a-cosmetic'),
        purchaseCoinCosmetic(save, COSMETIC_ID),
        purchaseCoinCosmetic(save, unownedEarned.id),
    ];
    same(results.map((result) => result.reason), [
        'invalid',
        'insufficient-coins',
        'invalid',
        'insufficient-coins',
        'not-coin-item',
    ], 'invalid/insufficient/earned-only shop preflight reasons drifted');
    check(storage.saveWriteAttempts === 0 && storage.saveWrites === 0,
        'shop preflight rejection attempted a durable write');
    check(save.data === liveData, 'shop preflight rejection replaced the live save object');
    same(save.data, before, 'shop preflight rejection changed save memory');

    save.data.totalCoins = 10_000;
    save.data.upgrades[UPGRADE_ID] = UPGRADE.maxLevel;
    check(save.save() === true, 'maxed-upgrade preflight baseline could not be saved');
    storage.resetWriteCounts();
    const maxedLive = save.data;
    const maxed = purchasePermanentUpgrade(save, UPGRADE_ID);
    check(maxed.ok === false && maxed.reason === 'maxed',
        'maxed upgrade did not fail during preflight');
    check(storage.saveWriteAttempts === 0 && save.data === maxedLive,
        'maxed upgrade preflight wrote or replaced live memory');
}

function validateInfinityWalletBound() {
    const { save, storage } = createSynchronousFixture(1);
    save.data.totalCoins = Infinity;
    const upgrade = purchasePermanentUpgrade(save, UPGRADE_ID);
    check(upgrade.ok === true && upgrade.balanceBefore === Infinity,
        'dev Infinity wallet could not purchase an upgrade through the shop boundary');
    check(Number.isSafeInteger(save.data.totalCoins)
        && save.data.totalCoins === MAX_COIN_BALANCE - UPGRADE_COST,
    'upgrade purchase did not normalize Infinity to the bounded safe wallet');
    check(storage.saveWrites === 1
        && JSON.parse(storage.getItem(SAVE_KEY)).totalCoins === save.data.totalCoins,
    'bounded dev upgrade wallet did not commit in exactly one final write');

    storage.resetWriteCounts();
    save.data.totalCoins = Infinity;
    const cosmetic = purchaseCoinCosmetic(save, COSMETIC_ID);
    check(cosmetic.ok === true && cosmetic.balanceBefore === Infinity,
        'dev Infinity wallet could not purchase a direct cosmetic');
    check(Number.isSafeInteger(save.data.totalCoins)
        && save.data.totalCoins === MAX_COIN_BALANCE - COSMETIC_COST,
    'cosmetic purchase did not normalize Infinity to the bounded safe wallet');
    check(storage.saveWrites === 1
        && JSON.parse(storage.getItem(SAVE_KEY)).totalCoins === save.data.totalCoins,
    'bounded dev cosmetic wallet did not commit in exactly one final write');
}

async function validateCrossTabBrowserBoundary() {
    const storage = new MemoryStorage(JSON.stringify({
        version: 10,
        totalCoins: 10_000,
        settings: { volMusic: 0.8, volSfx: 0.8 },
    }));
    const manager = new LockManagerHarness();
    const first = await createParticipatingSave(storage, manager);
    const second = await createParticipatingSave(storage, manager);
    check(manager.held(SAVE_PARTICIPATION_LOCK_NAME, 'shared') === 2,
        'browser shop fixture did not hold two shared participants');
    storage.resetWriteCounts();
    const walletBefore = first.data.totalCoins;
    const upgradeBefore = first.getUpgradeLevel(UPGRADE_ID);

    const blockedTask = purchasePermanentUpgradeAtomic(first, UPGRADE_ID);
    check(second.setSetting('volMusic', 0.37) === 0.37,
        'second participant could not persist during the shop contention window');
    const blocked = await blockedTask;
    same(blocked, { ok: false, reason: 'transaction-busy' },
        'second participant did not reject browser upgrade checkout as busy');
    check(first.data.totalCoins === walletBefore
        && first.getUpgradeLevel(UPGRADE_ID) === upgradeBefore,
    'contended browser upgrade debited or granted before exclusion');
    check(storage.saveWrites === 1
        && JSON.parse(storage.getItem(SAVE_KEY)).settings.volMusic === 0.37
        && JSON.parse(storage.getItem(SAVE_KEY)).totalCoins === walletBefore,
    'contended upgrade overwrote or obscured the other participant write');

    const writesBeforeCosmetic = storage.saveWrites;
    const blockedCosmetic = await purchaseCoinCosmeticAtomic(first, COSMETIC_ID);
    same(blockedCosmetic, { ok: false, reason: 'transaction-busy' },
        'second participant did not reject browser cosmetic checkout as busy');
    check(first.data.totalCoins === walletBefore
        && !first.isCosmeticUnlocked(COSMETIC_ID)
        && storage.saveWrites === writesBeforeCosmetic,
    'contended browser cosmetic debited, unlocked, or wrote');
    check(manager.calls.some((call) => call.name === SAVE_PARTICIPATION_LOCK_NAME
        && call.options.mode === 'exclusive' && call.options.ifAvailable),
    'browser shop did not request the participant-exclusive boundary');
    check(manager.calls.filter((call) => call.name === SAVE_TRANSACTION_LOCK_NAME).length === 0,
        'contended shop reached the nested transaction mutex before participant exclusion');

    await first.dispose();
    await second.dispose();
    const retry = await createParticipatingSave(storage, manager);
    check(retry.data.settings.volMusic === 0.37,
        'fresh shop retry did not load the other participant write');
    const retryWrites = storage.saveWrites;
    const upgrade = await purchasePermanentUpgradeAtomic(retry, UPGRADE_ID);
    check(upgrade.ok === true && upgrade.levelBefore === 0 && upgrade.levelAfter === 1,
        'fresh browser retry did not grant exactly one upgrade level');
    check(storage.saveWrites === retryWrites + 1,
        'fresh browser upgrade retry did not use exactly one final write');
    const cosmeticWrites = storage.saveWrites;
    const cosmetic = await purchaseCoinCosmeticAtomic(retry, COSMETIC_ID);
    check(cosmetic.ok === true && cosmetic.id === COSMETIC_ID,
        'fresh browser retry did not grant the blocked cosmetic');
    check(storage.saveWrites === cosmeticWrites + 1
        && retry.data.cosmetics.unlocked.filter((id) => id === COSMETIC_ID).length === 1,
    'fresh browser cosmetic retry did not use one write/one entitlement');
    check(retry.data.settings.volMusic === 0.37
        && retry.data.totalCoins === walletBefore - UPGRADE_COST - COSMETIC_COST,
    'fresh shop retries erased the other writer or double-debited the wallet');
    same(JSON.parse(storage.getItem(SAVE_KEY)), retry.data,
        'browser shop retry receipt preceded its durable payload');
    check(manager.calls.some((call) => call.name === SAVE_TRANSACTION_LOCK_NAME
        && call.options.mode === 'exclusive' && call.options.ifAvailable),
    'uncontended browser shop never entered the nested transaction mutex');
    await retry.dispose();
}

async function validateMenuPendingOwnership() {
    setGlobal('window', {});
    setGlobal('navigator', {});
    let settlePurchase;
    let exclusiveCalls = 0;
    const operation = new Promise((resolve) => { settlePurchase = resolve; });
    const toasts = [];
    let purchaseAudio = 0;
    let denyAudio = 0;
    const game = {
        saveSystem: {
            getUpgradeLevel: () => 0,
            runExclusiveSaveTransaction() {
                exclusiveCalls += 1;
                return operation;
            },
        },
        shopPurchasePending: null,
        _shopPurchaseSerial: 0,
        _shopPurchaseTask: null,
        menuFocusNeedsRefresh: false,
        _setToast: (message) => toasts.push(message),
        audio: {
            purchase: () => { purchaseAudio += 1; },
            deny: () => { denyAudio += 1; },
        },
    };

    check(GameInputActionMethods.buyUpgrade.call(game, UPGRADE_ID) === true,
        'menu did not accept the first durable shop purchase');
    const task = game._shopPurchaseTask;
    check(game.shopPurchasePending?.kind === 'upgrade'
        && task && typeof task.then === 'function' && exclusiveCalls === 1,
    'menu did not expose/own its exact pending shop task');
    check(GameInputActionMethods.buyUpgrade.call(game, UPGRADE_ID) === false
        && exclusiveCalls === 1,
    'rapid duplicate tap launched a second shop transaction');
    check(toasts.at(-1) === 'Another purchase is still being secured'
        && purchaseAudio === 0 && denyAudio === 0,
    'pending duplicate feedback exposed success/failure before durable settlement');

    settlePurchase({
        ok: true,
        kind: 'upgrade',
        id: UPGRADE_ID,
        name: UPGRADE.name,
        cost: UPGRADE_COST,
        levelBefore: 0,
        levelAfter: 1,
        balanceBefore: 10_000,
        balanceAfter: 10_000 - UPGRADE_COST,
    });
    const result = await task;
    check(result.ok === true && game.shopPurchasePending === null
        && game._shopPurchaseTask === null,
    'settled shop task retained its pending owner');
    check(purchaseAudio === 1 && denyAudio === 0
        && toasts.at(-1) === `${UPGRADE.name} level 1 secured`,
    'shop success feedback did not wait for the durable receipt');
}

function validateStaticWiring() {
    const source = readFileSync(
        new URL('../src/core/GameInputActions.js', import.meta.url),
        'utf8',
    );
    const upgradeStart = source.indexOf('    buyUpgrade(id) {');
    const upgradeEnd = source.indexOf('    buyAttune(id) {', upgradeStart);
    const cosmeticStart = source.indexOf('    _buyCosmetic(arg) {');
    const cosmeticEnd = source.indexOf('    buyTryOn() {', cosmeticStart);
    const upgradeBody = source.slice(upgradeStart, upgradeEnd);
    const cosmeticBody = source.slice(cosmeticStart, cosmeticEnd);

    check(source.includes('purchasePermanentUpgradeAtomic')
        && source.includes('purchaseCoinCosmeticAtomic')
        && source.includes("startShopPurchase(this, 'upgrade', id, upgrade.name)")
        && source.includes("startShopPurchase(this, 'cosmetic', item.id, item.name)"),
    'shop menu actions are not wired to both transaction helpers');
    check(source.includes('if (game.shopPurchasePending)')
        && source.includes('game.shopPurchasePending = Object.freeze({ kind, id, serial })')
        && source.includes('game._shopPurchaseTask = task')
        && source.includes('if (game._shopPurchaseTask === task) game._shopPurchaseTask = null'),
    'shop menu wiring does not own/suppress the duplicate-tap task');
    check(upgradeStart >= 0 && upgradeEnd > upgradeStart
        && !/\.(?:spendCoins|incrementUpgrade|addCoins)\s*\(/.test(upgradeBody),
    'buyUpgrade still contains the old direct debit/apply/refund sequence');
    check(cosmeticStart >= 0 && cosmeticEnd > cosmeticStart
        && !/\.(?:spendCoins|unlockCosmetic|addCoins)\s*\(/.test(cosmeticBody),
    '_buyCosmetic still contains the old direct debit/apply/refund sequence');
}

try {
    check(!!UPGRADE && !!COSMETIC && UPGRADE_COST > 0 && COSMETIC_COST > 0,
        'shop transaction validator catalog fixtures are invalid');
    validateSynchronousUpgradeDurability();
    validateSynchronousCosmeticDurability();
    validatePreflightRejections();
    validateInfinityWalletBound();
    await validateCrossTabBrowserBoundary();
    await validateMenuPendingOwnership();
    validateStaticWiring();
    console.log(`Shop transaction durability validation passed: ${checks} checks.`);
} finally {
    console.warn = originalWarn;
    restoreGlobal('localStorage', originalStorage);
    restoreGlobal('navigator', originalNavigator);
    restoreGlobal('window', originalWindow);
}
