// Pointer/key/menu action routing. Split out of Game.js as part of the "move
// code, don't change behavior" decomposition: these are the exact same methods,
// relocated onto Game.prototype via Object.assign in Game.js, so the constructor's
// input listeners, the UI, and every this._menuAction()/buy*/select* call resolve
// unchanged. `this` is the Game instance throughout.
//
// Owns the user-action layer: _menuAction (the central menu/button router) and the
// actions it dispatches — shop buys (buyUpgrade, buyAttune, buyHeroAttune,
// _buyCosmetic), level-up choice agency (rerollChoices, alterChoices, banishChoice,
// selectUpgrade), shrine pick (selectAltar), settings toggles (togglePause,
// toggleScreenShake, _toggleSetting, _adjustVolume), and the save-reset confirm.

import { DEV_MODE, SCREEN_SHAKE } from '../config/GameConfig.js';
import { clamp } from './MathUtils.js';
import {
    claimAtomic as claimBattlePassAtomic,
    claimAllAtomic as claimAllBattlePassAtomic,
} from '../systems/BattlePassSystem.js';
import {
    purchaseCoinCosmetic,
    purchaseCoinCosmeticAtomic,
    purchasePermanentUpgrade,
    purchasePermanentUpgradeAtomic,
} from '../systems/ShopTransaction.js';
import { MINES } from '../systems/CaseSystem.js';
import {
    COSMETICS,
    COSMETIC_BLUEPRINT_IDS,
    COSMETIC_SETS,
    cosmeticBlueprintCost,
    cosmeticById,
    cosmeticCoinCost,
} from '../content/cosmetics.js';
import { PERMANENT_UPGRADES } from '../content/permanentUpgrades.js';
import { MAPS } from '../content/maps.js';
import { TOUR_STEPS } from '../content/tutorialTour.js';
import { menuHotspotLabel } from '../systems/AccessibilityBridge.js';
import {
    COLLECTION_BLUEPRINT_CONFIRM_MS,
    COLLECTION_COMPLETION_SECTIONS,
    blueprintClockNow,
    collectionCompletionSnapshot,
} from '../systems/UIStateBuilder.js';
import {
    normalizeCaptionDetail,
    normalizeUiScale,
    normalizeVibrationStrength,
} from '../systems/AccessibilityPreferences.js';

export const PAUSE_EXIT_CONFIRM_MS = 3000;
export const BLUEPRINT_CONFIRM_MS = COLLECTION_BLUEPRINT_CONFIRM_MS;

const COSMETIC_BLUEPRINT_ID_SET = new Set(COSMETIC_BLUEPRINT_IDS);
const COLLECTION_COMPLETION_SECTION_SET = new Set(COLLECTION_COMPLETION_SECTIONS);
const COMPLETION_SECTION_LABELS = Object.freeze({
    overview: 'Overview',
    sets: 'Sets',
    sources: 'Sources',
    blueprint: 'Blueprints',
    case: 'Case truth',
});

// Navigation state and purchase explanations are session-only. This reset is
// shared by tabs, run launch/return, reset, and guided-tour routes so none of
// those boundaries can carry an armed Blueprint spend into another surface.
export function resetCollectionCompletionFlow(game, { clearReceipt = true } = {}) {
    if (!game || typeof game !== 'object') return false;
    const current = collectionCompletionSnapshot(game);
    game.collectionCompletion = {
        ...current,
        open: false,
        section: 'overview',
        page: 1,
    };
    game.blueprintConfirm = null;
    if (clearReceipt) game.blueprintReceipt = null;
    return true;
}

function completionRouteAllowed(game) {
    return game?.menuTab === 'character';
}

function announceCompletionScreen(game, label, suffix = '') {
    const detail = `Collection Completion: ${label}.${suffix ? ` ${suffix}` : ''}`;
    game.accessibility?.setScreen?.('start', detail);
    game.accessibility?.announce?.(detail);
}

function closeCompletionToCatalog(game) {
    resetCollectionCompletionFlow(game);
    game.characterPhonePane = 'collection';
    game._resetMenuFocus?.();
    game.accessibility?.setScreen?.('start', 'Character Collection.');
    game.accessibility?.announce?.('Character Collection.');
}

function safeCoinBalance(game) {
    const balance = game?.saveSystem?.data?.totalCoins;
    return Number.isSafeInteger(balance) && balance >= 0 ? balance : 0;
}

function completeBlueprintPurchase(game, item, cost, result) {
    const successInts = result?.ok === true ? [
        result.balanceBefore,
        result.balanceAfter,
        result.collectionBefore,
        result.collectionAfter,
        result.setBefore,
        result.setAfter,
    ] : [];
    const set = result?.setId === null
        ? null : COSMETIC_SETS.find((candidate) => candidate.id === result?.setId) || null;
    const validSuccess = result?.ok === true
        && result.id === item.id
        && result.name === item.name
        && result.cost === cost
        && successInts.every((value) => Number.isSafeInteger(value) && value >= 0)
        && result.balanceBefore - result.balanceAfter === cost
        && result.collectionAfter - result.collectionBefore === 1
        && (set
            ? result.setAfter - result.setBefore === 1
            : result.setId === null && result.setBefore === 0 && result.setAfter === 0);
    if (validSuccess) {
        game.blueprintReceipt = Object.freeze({
            ok: true,
            kind: 'success',
            id: item.id,
            name: item.name,
            cost,
            balanceBefore: result.balanceBefore,
            balanceAfter: result.balanceAfter,
            collectionBefore: result.collectionBefore,
            collectionAfter: result.collectionAfter,
            setId: set?.id ?? null,
            setName: set?.name ?? null,
            setBefore: result.setBefore,
            setAfter: result.setAfter,
        });
        game.audio?.cosmeticReward?.();
        game._pressFeedback?.(`blueprintOwned:${item.id}`);
        game._resetMenuFocus?.();
        const collectionDelta = result.collectionAfter - result.collectionBefore;
        const setDelta = result.setAfter - result.setBefore;
        const setLine = set
            ? `${set.name} plus ${setDelta}, ${result.setAfter} of ${Object.keys(set.pieces).length}.`
            : 'Set progress unchanged.';
        game.accessibility?.announce?.(
            `${item.name} Blueprint unlocked. Minus ${cost.toLocaleString('en-US')} coins. `
            + `Wallet ${result.balanceAfter.toLocaleString('en-US')}. `
            + `Collection plus ${collectionDelta}, ${result.collectionAfter} owned. ${setLine}`,
        );
        return true;
    }

    const reason = typeof result?.reason === 'string'
        ? result.reason : 'invalid-purchase-receipt';
    const balance = safeCoinBalance(game);
    const shortfall = reason === 'insufficient-coins'
        ? Math.max(0, cost - balance) : 0;
    game.blueprintReceipt = Object.freeze({
        ok: false,
        kind: reason === 'insufficient-coins' ? 'insufficient' : 'error',
        reason,
        id: item.id,
        name: item.name,
        cost,
        balance,
        shortfall,
    });
    game.audio?.deny?.();
    game._resetMenuFocus?.();
    if (reason === 'insufficient-coins') {
        game.accessibility?.announce?.(
            `${item.name} Blueprint costs ${cost.toLocaleString('en-US')} coins. `
            + `Short ${shortfall.toLocaleString('en-US')}. `
            + `Wallet ${balance.toLocaleString('en-US')}.`,
        );
    } else if (reason === 'already-owned' || reason === 'replay') {
        game.accessibility?.announce?.(`${item.name} is already in your collection.`);
    } else if (reason === 'external-save-changed') {
        game.accessibility?.announce?.(
            'Save changed in another tab. You were not charged. Reload the game before buying.',
        );
    } else if (reason === 'persistence-unavailable') {
        game.accessibility?.announce?.(
            'Save storage is unavailable. You were not charged. Restore storage access and try again.',
        );
    } else if (reason === 'persistence-failed') {
        game.accessibility?.announce?.(
            'Save failed. You were not charged. Check storage and try again.',
        );
    } else if (reason === 'transaction-busy') {
        game.accessibility?.announce?.(
            'Another game tab is saving. You were not charged. Try the Blueprint again.',
        );
    } else if (reason === 'transaction-lock-unavailable') {
        game.accessibility?.announce?.(
            'Safe cross-tab saving is unavailable. You were not charged. Update the browser or disable Lockdown Mode before buying.',
        );
    } else if (reason === 'transaction-lock-failed') {
        game.accessibility?.announce?.(
            'Safe save lock failed. You were not charged. Try again.',
        );
    } else {
        game.accessibility?.announce?.(`${item.name} Blueprint purchase was not completed.`);
    }
    return false;
}

function battlePassFailureText(result) {
    const reason = typeof result?.reason === 'string' ? result.reason : '';
    if (reason === 'nothing-to-claim') return 'Nothing to claim';
    if (reason === 'claimed') return 'Reward already claimed';
    if (reason === 'locked') return 'Reward is still locked';
    if (reason === 'invalid') return 'Cannot claim that reward';
    if (reason === 'transaction-busy') {
        return 'Another game tab is active — reward remains unclaimed';
    }
    if (reason === 'external-save-changed') {
        return 'Save changed in another tab — reload, then claim again';
    }
    if (reason === 'transaction-lock-unavailable') {
        return 'Secure save protection is unavailable — reward remains unclaimed';
    }
    if (reason === 'persistence-unavailable' || reason === 'persistence-failed') {
        return 'Save failed — reward remains unclaimed';
    }
    return 'Reward was not claimed — try again';
}

function startBattlePassClaim(game, kind, level = null) {
    if (game.battlePassClaimPending) {
        game._setToast?.('Reward save already in progress', false);
        game.accessibility?.announce?.('Battle Pass reward save is still being secured.');
        return false;
    }
    const serial = (Number.isSafeInteger(game._battlePassClaimSerial)
        ? game._battlePassClaimSerial : 0) + 1;
    game._battlePassClaimSerial = serial;
    game.battlePassClaimPending = Object.freeze({ kind, level, serial });
    game._setToast?.(kind === 'all' ? 'Securing all rewards…' : 'Securing reward…', false);
    game.accessibility?.announce?.(
        kind === 'all'
            ? 'Securing all reached Battle Pass rewards across game tabs.'
            : `Securing Battle Pass level ${level} reward across game tabs.`,
    );

    let operation;
    try {
        operation = kind === 'all'
            ? claimAllBattlePassAtomic(game.saveSystem)
            : claimBattlePassAtomic(game.saveSystem, level);
    } catch (error) {
        operation = { ok: false, reason: 'transaction-lock-failed' };
    }
    const settle = (rawResult) => {
        const result = rawResult && typeof rawResult === 'object'
            ? rawResult : { ok: false, reason: 'transaction-lock-failed' };
        if (game.battlePassClaimPending?.serial !== serial) return result;
        game.battlePassClaimPending = null;
        game.menuFocusNeedsRefresh = true;
        if (result.ok) {
            if (kind === 'all') {
                const labels = Array.isArray(result.labels) ? result.labels : [];
                const recent = labels.slice(-2).join(' · ');
                const count = Number.isSafeInteger(result.count) ? result.count : labels.length;
                const message = `Claimed ${count} reward${count === 1 ? '' : 's'}`
                    + (recent ? ` · ${recent}` : '');
                game._setToast?.(message, false);
                game.accessibility?.announce?.(message);
            } else {
                const message = `Claimed: ${result.label}`;
                game._setToast?.(message, false);
                game.accessibility?.announce?.(message);
            }
        } else {
            const message = battlePassFailureText(result);
            game._setToast?.(message, false);
            game.accessibility?.announce?.(message);
        }
        return result;
    };
    const task = Promise.resolve(operation).then(
        settle,
        () => settle({ ok: false, reason: 'transaction-lock-failed' }),
    );
    game._battlePassClaimTask = task;
    task.finally(() => {
        if (game._battlePassClaimTask === task) game._battlePassClaimTask = null;
    });
    return true;
}

function shopPurchaseFailureText(result, label) {
    const reason = typeof result?.reason === 'string' ? result.reason : '';
    if (reason === 'insufficient-coins') return 'Not enough coins';
    if (reason === 'maxed') return `${label} is already maxed`;
    if (reason === 'already-owned') return `${label} is already owned`;
    if (reason === 'not-coin-item') return `${label} must be earned, not purchased`;
    if (reason === 'transaction-busy') return 'Another game tab is active — purchase not charged';
    if (reason === 'external-save-changed') return 'Save changed — reload before purchasing';
    if (reason === 'transaction-lock-unavailable') {
        return 'Secure save protection unavailable — purchase not charged';
    }
    if (reason === 'persistence-unavailable' || reason === 'persistence-failed'
        || reason === 'save-unavailable') return 'Save failed — purchase not charged';
    return `${label} purchase was not completed`;
}

function reportSaveMutationFailure(game, action = 'Change') {
    const reason = game.saveSystem?.getLastSaveFailureReason?.();
    const message = reason === 'external-save-changed'
        ? 'Save changed in another tab — reload before changing this'
        : `${action} was not saved — try again`;
    game.audio?.deny?.();
    game._setToast?.(message);
    return false;
}

export function hasPendingSecureMenuSave(game) {
    return !!(
        game?.blueprintPurchasePending
        || game?.battlePassClaimPending
        || game?.shopPurchasePending
        || game?.minigame?._caseOpenTask
        || game?.minigame?._minesStartTask
        || game?.minigame?._minesCashoutTask
    );
}

function blockMenuDuringSecureSave(game) {
    if (!hasPendingSecureMenuSave(game)) return false;
    game._setToast?.('Finishing secure save — please wait');
    return true;
}

function startShopPurchase(game, kind, id, label) {
    if (game.shopPurchasePending) {
        game._setToast?.('Another purchase is still being secured');
        return false;
    }
    const serial = (Number.isSafeInteger(game._shopPurchaseSerial)
        ? game._shopPurchaseSerial : 0) + 1;
    game._shopPurchaseSerial = serial;
    game.shopPurchasePending = Object.freeze({ kind, id, serial });
    game._setToast?.(`Securing ${label}…`);

    const browserRuntime = typeof globalThis.window !== 'undefined';
    let operation;
    try {
        if (kind === 'upgrade') {
            operation = browserRuntime
                ? purchasePermanentUpgradeAtomic(game.saveSystem, id)
                : purchasePermanentUpgrade(game.saveSystem, id);
        } else {
            operation = browserRuntime
                ? purchaseCoinCosmeticAtomic(game.saveSystem, id)
                : purchaseCoinCosmetic(game.saveSystem, id);
        }
    } catch (error) {
        operation = { ok: false, reason: 'transaction-lock-failed' };
    }

    const settle = (rawResult) => {
        const result = rawResult && typeof rawResult === 'object'
            ? rawResult : { ok: false, reason: 'transaction-lock-failed' };
        if (game.shopPurchasePending?.serial !== serial) return result;
        game.shopPurchasePending = null;
        game.menuFocusNeedsRefresh = true;
        if (result.ok) {
            if (kind === 'upgrade') {
                game.audio?.purchase?.();
                game._setToast?.(`${result.name} level ${result.levelAfter} secured`);
            } else {
                game.audio?.cosmeticReward?.();
                game._setToast?.(`Unlocked ${result.name}`);
            }
        } else {
            game.audio?.deny?.();
            game._setToast?.(shopPurchaseFailureText(result, label));
        }
        return result;
    };

    // Internal/Node seams remain synchronous for deterministic validators;
    // production browser transactions own a task and suppress duplicate taps.
    if (!browserRuntime && !(operation && typeof operation.then === 'function')) {
        const result = settle(operation);
        return result.ok === true;
    }
    const task = Promise.resolve(operation).then(
        settle,
        () => settle({ ok: false, reason: 'transaction-lock-failed' }),
    );
    game._shopPurchaseTask = task;
    task.finally(() => {
        if (game._shopPurchaseTask === task) game._shopPurchaseTask = null;
    });
    return true;
}

// Commands routed by Game's keydown listener are edge-triggered. Browser
// key-repeat must not turn one held press into two destructive confirmations,
// cross an overlay boundary, or toggle pause straight back off. Tab/arrows and
// photo zoom (Q/E) are intentionally absent. A/S remain listed because overlays
// also bind them to Share/Alter; held movement is tracked independently by
// KeyboardInput and this guard only exits Game's command-routing callback.
export const DISCRETE_KEY_CODES = Object.freeze([
    'Backquote', 'F2',
    'Enter', 'Space', 'Escape',
    'KeyC', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyM', 'KeyN', 'KeyO', 'KeyP',
    'KeyR', 'KeyB', 'KeyS', 'KeyA',
    'BracketRight', 'Backslash',
    'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit7', 'Digit8', 'Digit9',
    'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad7', 'Numpad8', 'Numpad9',
]);
const DISCRETE_KEYS = new Set(DISCRETE_KEY_CODES);

export function consumeRepeatedDiscreteKey(event) {
    if (!event?.repeat || !DISCRETE_KEYS.has(event.code)) return false;
    event.preventDefault?.();
    return true;
}

export const GameInputActionMethods = {
    _menuFocusableHotspots() {
        const hotspots = this.ui?.menu?.hotspots;
        return Array.isArray(hotspots)
            ? hotspots.filter((entry) => entry && entry.w > 0 && entry.h > 0 && entry.action)
            : [];
    },

    _menuMoveFocus(delta = 1) {
        const hotspots = this._menuFocusableHotspots();
        if (!hotspots.length) return false;
        let index = hotspots.findIndex((entry) => entry.key === this.menuFocusKey);
        const step = delta < 0 ? -1 : 1;
        index = index < 0
            ? (step < 0 ? hotspots.length - 1 : 0)
            : (index + step + hotspots.length) % hotspots.length;
        const next = hotspots[index];
        this.menuFocusKey = next.key;
        this.menuFocusNeedsRefresh = false;
        this.accessibility?.focusCanvas?.();
        this.accessibility?.announce?.(`Focused: ${next.label}`);
        this.audio?.hover?.();
        return true;
    },

    _menuActivateFocus() {
        const hotspots = this._menuFocusableHotspots();
        if (!hotspots.length) return false;
        const current = hotspots.find((entry) => entry.key === this.menuFocusKey);
        if (!current) {
            this.blueprintConfirm = null;
            return this._menuMoveFocus(1);
        }
        // The action may claim/equip/max a control away or jump sections. Ask
        // the post-render reconciler to retain this key only if it still exists.
        this.menuFocusNeedsRefresh = true;
        this._menuAction(current.action, current.arg);
        return true;
    },

    _trapCanvasTab(event) {
        if (event?.code !== 'Tab') return false;
        event.preventDefault?.();
        this.accessibility?.focusCanvas?.();
        return true;
    },

    _refreshMenuFocusAfterRender() {
        if (this.screen !== 'start') return 'inactive';
        const overlayOwnsInput = !!(this.minigame?.mines || this.minigame?.caseAnim);
        const requested = !!this.menuFocusKey || this.menuFocusNeedsRefresh === true;

        // Case/Mines are Canvas focus scopes of their own. Never leave a focus
        // ring on the obscured menu; remember whether keyboard focus should be
        // restored after the overlay closes.
        if (overlayOwnsInput) {
            this.menuFocusKey = null;
            this.menuFocusNeedsRefresh = requested;
            return requested ? 'deferred' : 'none';
        }

        const hotspots = this._menuFocusableHotspots();
        const current = hotspots.find((entry) => entry.key === this.menuFocusKey);
        if (current) {
            this.menuFocusNeedsRefresh = false;
            return 'retained';
        }

        this.menuFocusKey = null;
        if (!requested) {
            this.menuFocusNeedsRefresh = false;
            return 'none';
        }
        if (this.input?.getModality?.() !== 'keyboard') {
            this.menuFocusNeedsRefresh = false;
            return 'cleared';
        }
        if (!hotspots.length) {
            this.menuFocusNeedsRefresh = true;
            return 'deferred';
        }

        // _menuMoveFocus owns the common visible/audio/assistive feedback and
        // clears menuFocusNeedsRefresh after selecting the first valid control.
        this.menuFocusNeedsRefresh = true;
        this._menuMoveFocus(1);
        return 'recovered';
    },

    _menuKeyboardActivate() {
        if (blockMenuDuringSecureSave(this)) return 'pending';
        // A named Canvas control always owns activation once focus is visible.
        if (this.menuFocusKey && this._menuActivateFocus()) return 'focused';
        if (this.menuTour) {
            this._menuAction('tourNext', null);
            return 'tour';
        }

        // Quick-start is deliberately scoped to HOME and PLAY. A section switch
        // clears its old focus key; Enter on SETTINGS/SHOP/etc. must establish a
        // new local focus target, never leak through to starting a run.
        const tab = this.menuTab || 'home';
        if (tab !== 'home' && tab !== 'play') {
            this.blueprintConfirm = null;
            this._menuMoveFocus(1);
            return 'focus';
        }

        // A fresh profile gets the same setup step as the pointer HOME CTA.
        if ((this.saveSystem.data.stats?.runs ?? 0) === 0 && tab === 'home') {
            this._menuAction('tab', 'play');
            // This route began with intentionally empty focus, so do not let the
            // tab action's generic reset look like an orphan needing recovery.
            // The next distinct Enter on PLAY remains the scoped quick-start.
            this.menuFocusNeedsRefresh = false;
            return 'play';
        }

        this.dailyMode = false;
        this.riteTrialMode = false;
        this.bossRushMode = false;
        this.weeklyEmberMode = false;
        this._startRun({ campaignEligible: true });
        return 'start';
    },

    _resetMenuFocus() {
        this.menuFocusKey = null;
        this.menuFocusNeedsRefresh = true;
    },

    _moveMinesFocus(dx = 0, dy = 0) {
        const mines = this.minigame?.mines;
        if (!mines || mines.stopped) return false;
        const cols = MINES.cols;
        const total = MINES.tiles;
        const current = Math.max(0, Math.min(total - 1, this.minesFocusIndex || 0));
        let col = current % cols;
        let row = Math.floor(current / cols);
        col = (col + Math.sign(dx) + cols) % cols;
        row = (row + Math.sign(dy) + Math.ceil(total / cols)) % Math.ceil(total / cols);
        let next = row * cols + col;
        if (next >= total) next = total - 1;
        this.minesFocusIndex = next;
        this.accessibility?.announce?.(`Mines tile, row ${Math.floor(next / cols) + 1}, column ${(next % cols) + 1}.`);
        this.audio?.hover?.();
        return true;
    },

    _activateMinesFocus() {
        const mines = this.minigame?.mines;
        if (!mines || mines.stopped) return false;
        const index = Math.max(0, Math.min(MINES.tiles - 1, this.minesFocusIndex || 0));
        const alreadyRevealed = mines.revealed.includes(index);
        if (alreadyRevealed) {
            this.accessibility?.announce?.('That tile is already revealed.');
            this.audio?.deny?.();
            return false;
        }
        this.minigame.minesReveal(index);
        if (mines.busted) this.accessibility?.announce?.(`Mine. Stake lost: ${mines.bet} coins.`);
        else if (mines.cashed) this.accessibility?.announce?.(`Board cleared. Cashed out ${mines.result?.payout || 0} coins.`);
        else this.accessibility?.announce?.(`Safe tile. Multiplier ${mines.mul.toFixed(2)} times.`);
        return true;
    },

    // Pause is only meaningful during live gameplay (overlays already
    // freeze the world). Toggling re-enables/disables the joystick.
    togglePause() {
        if (this.screen !== 'gameplay' || this.gameOver ||
            this.upgradeChoices || this.chestReward) return;
        // Resume, Esc/P, and a fresh pause all cancel any half-armed exit.
        // Confirmation is intentionally session-only and action-specific.
        this.cancelPauseExitConfirm();
        this.paused = !this.paused;
        // The hearth damps down while paused (soft whoosh + held music dim).
        if (this.paused) this.audio.pauseIn(); else this.audio.pauseOut();
        this.audio.setPaused(this.paused);
        const heldCoins = this._guidedObjectiveHeldCoins?.() ?? 0;
        if (this.paused) {
            const heldCopy = heldCoins > 0
                ? `${heldCoins} Run Path coins are held. Restart or leave forfeits them.`
                : 'No Run Path coins are currently held.';
            this.accessibility?.setScreen?.('paused', heldCopy);
            this.accessibility?.announce?.(`Game paused. ${heldCopy}`);
        } else {
            this.accessibility?.setScreen?.('gameplay', 'Run resumed.');
            this.accessibility?.announce?.('Run resumed.');
        }
        this._updateJoystickEnabled();
    },
    cancelPauseExitConfirm() {
        this.pauseExitConfirm = null;
    },
    // RESTART and LEAVE TO MENU both bank/end a live run. The first activation
    // only arms the named action; the same action must be activated again before
    // the wall-clock deadline. Switching actions re-arms instead of executing,
    // preventing an edge tap between adjacent buttons from finalizing a run.
    requestPauseExit(action) {
        if (this.screen !== 'gameplay' || !this.paused || this.gameOver
            || (action !== 'restart' && action !== 'menu')) return false;
        const now = Date.now();
        const armed = this.pauseExitConfirm;
        if (!armed || armed.action !== action || !(armed.expiresAt > now)) {
            this.pauseExitConfirm = { action, expiresAt: now + PAUSE_EXIT_CONFIRM_MS };
            if (this.audio?.uiTick) this.audio.uiTick();
            const heldCoins = this._guidedObjectiveHeldCoins?.() ?? 0;
            const loss = heldCoins > 0
                ? ` ${heldCoins} held Run Path coins will be forfeited.` : '';
            this.accessibility?.announce?.(
                `${action === 'restart' ? 'Restart' : 'Leave'} confirmation armed.${loss} Activate again to confirm.`,
            );
            return false;
        }

        // Clear BEFORE dispatch. restart()/returnToShop() retain their existing
        // bankedThisRun guard, and a rapid third event sees a different screen or
        // unpaused state, so the run can be finalized at most once.
        this.pauseExitConfirm = null;
        if (action === 'restart') this.restart();
        else this.returnToShop();
        return true;
    },
    toggleScreenShake() {
        const next = !this.shakeEnabled;
        if (this.saveSystem.setSetting('screenShake', next) !== next) {
            return reportSaveMutationFailure(this, 'Screen shake change');
        }
        this.shakeEnabled = next;
        return true;
    },
    // Re-roll the current level-up offer (costs one reroll charge).
    rerollChoices() {
        if (!this.upgradeChoices || this.rerolls <= 0) return;
        this.rerolls -= 1;
        this.audio.reroll();
        const choices = this.upgradeSystem.rollChoices(this, 3);
        this.setUpgradeChoices(choices.length > 0 ? choices : this.upgradeChoices);
    },
    // Alter the current offer (costs one alter charge): re-roll with the Patron
    // bias INVERTED, so the new cards lean toward your non-committed Patrons —
    // a deliberate splash out of your lane. With no Patron committed it behaves
    // like a plain re-roll.
    alterChoices() {
        if (!this.upgradeChoices || this.alters <= 0) return;
        this.alters -= 1;
        this.audio.reroll();
        const choices = this.upgradeSystem.rollChoices(this, 3, { alter: true });
        this.setUpgradeChoices(choices.length > 0 ? choices : this.upgradeChoices);
    },
    // Banish the offered card at idx for the rest of the run, then re-roll
    // the offer so the banished card is gone (costs one banish charge).
    banishChoice(idx) {
        if (!this.upgradeChoices || this.banishes <= 0) return;
        const card = this.upgradeChoices[idx];
        if (!card) return;
        // Bonus/fallback cards aren't in the live pool, so banishing one
        // can't keep it from re-appearing — refuse so the charge isn't lost.
        if (card.kind === 'fallback') return;
        this.banishes -= 1;
        this.audio.banish();
        this.upgradeSystem.banish(card.id);
        const choices = this.upgradeSystem.rollChoices(this, 3);
        this.setUpgradeChoices(choices.length > 0 ? choices : this.upgradeChoices);
    },
    buyUpgrade(id) {
        const upgrade = PERMANENT_UPGRADES.find((u) => u.id === id);
        if (!upgrade) return false;
        const cur = this.saveSystem.getUpgradeLevel(id);
        if (cur >= upgrade.maxLevel) return false;
        return startShopPurchase(this, 'upgrade', id, upgrade.name);
    },
    // Buy the next Relic Attunement level (coin sink). SaveSystem.attuneRelic
    // does the spend+apply atomically (spendCoins only deducts on success), so
    // this just plays the right feedback. Returns whether a level was bought.
    buyAttune(id) {
        if (this.saveSystem.attuneRelic(id)) {
            this.audio.purchase();
            return true;
        }
        this.audio.deny();
        return false;
    },
    // KINDLED PR5 — buy the next Hero Attunement level (SaveSystem enforces coins,
    // the level cap, AND the rite-gate on rungs 3/4/5). Same feedback contract as
    // buyAttune; returns whether a level was bought.
    buyHeroAttune(charId) {
        if (this.saveSystem.attuneHero(charId)) {
            this.audio.purchase();
            return true;
        }
        this.audio.deny();
        return false;
    },
    // Buy a coin-priced cosmetic, then equip it. Mirrors buyUpgrade's
    // spend→apply→refund-on-failure safety so coins are never taken without
    // the item actually unlocking. Already-owned items just equip (free).
    _buyCosmetic(arg) {
        const item = COSMETICS[arg && arg.id];
        if (!item) return false;
        if (this.saveSystem.isCosmeticUnlocked(item.id)) {
            if (!this.saveSystem.equipCosmetic(item.category, item.id)) {
                this.audio.deny();
                this._setToast('Save changed — cosmetic was not equipped');
                return false;
            }
            this.audio.equip();
            return true;
        }
        const price = cosmeticCoinCost(item);
        if (!price) return false;                                 // not a coin item
        return startShopPurchase(this, 'cosmetic', item.id, item.name);
    },
    // BOUTIQUE — buy every unowned coin-priced piece in the try-on look with
    // ONE spend (all-or-nothing so a partial look can't half-charge), then
    // equip the whole tried-on look (owned pieces included). With nothing to
    // buy it just equips — the free path for recombining owned pieces.
    buyTryOn() {
        const entries = Object.entries(this.tryOn || {});
        if (!entries.length) return;
        const buys = [];
        let total = 0, ownedN = 0;
        for (const [category, id] of entries) {
            const item = COSMETICS[id];
            if (!item || item.category !== category) continue;
            if (this.saveSystem.isCosmeticUnlocked(id)) { ownedN++; continue; }
            const price = cosmeticCoinCost(item);
            if (!price) continue;              // case/achievement drop: preview-only
            buys.push(item); total += price;
        }
        // Nothing equippable at all (a look of pure case/achievement drops,
        // e.g. Gloambound on a fresh save): refuse honestly, KEEP the try-on.
        if (!buys.length && !ownedN) {
            this.audio.deny();
            this._setToast('Preview only — earn these through the Vigil Path, cases, or achievements');
            return;
        }
        if (total > 0 && this.saveSystem.data.totalCoins < total) {
            this.audio.deny();
            this._setToast(`Need ◎ ${(total - this.saveSystem.data.totalCoins).toLocaleString()} more`);
            return;
        }
        const purchased = new Set(buys.map((item) => item.id));
        const fullLook = { ...this.saveSystem.getEquippedCosmetics() };
        let equippedN = 0;
        for (const [cat, id] of entries) {
            const item = COSMETICS[id];
            if (item?.category === cat
                && (this.saveSystem.isCosmeticUnlocked(id) || purchased.has(id))) {
                fullLook[cat] = id;
                equippedN++;
            }
        }
        const committed = buys.length
            ? this.saveSystem.purchaseCosmeticLook(buys.map((item) => item.id), total, fullLook)
            : this.saveSystem.equipCosmeticLook(fullLook);
        if (!committed) {
            this.audio.deny();
            this._setToast('Look changed before checkout — please review it again');
            return;
        }
        // Honest toast: name what was bought AND what stayed source-locked (a
        // set can mix coin pieces with Vigil/case/achievement rewards).
        const skipped = entries.length - equippedN;
        const skipTxt = skipped > 0 ? ` (${skipped} source-locked piece${skipped > 1 ? 's' : ''} skipped)` : '';
        if (buys.length) { this.audio.cosmeticReward(); this._setToast(`Unlocked ${buys.length} piece${buys.length > 1 ? 's' : ''} — look equipped${skipTxt}`); }
        else { this.audio.equip(); this._setToast(`Look equipped${skipTxt}`); }
        this.tryOn = {};
    },
    requestResetSave() {
        if (this.resetConfirming) {
            const persisted = this.saveSystem.reset();
            // SaveSystem intentionally supports memory-only play when browser
            // storage is unavailable. In that mode reset still applies fresh
            // runtime defaults but cannot persist them; resynchronize every
            // live preference and disclose that exact limitation.
            const memoryOnly = persisted !== true && this.saveSystem.available === false;
            if (!persisted && !memoryOnly) {
                this.resetConfirming = false;
                this.resetConfirmTimer = 0;
                return reportSaveMutationFailure(this, 'Save reset');
            }
            this.audio.setVolumes(
                this.saveSystem.getSetting('volMusic'),
                this.saveSystem.getSetting('volSfx'),
                this.saveSystem.getSetting('volVoice'),
            );
            this.audio.setMonoAudio(this.saveSystem.getSetting('monoAudio'));
            this.captionSystem?.setPreferences?.(
                this.saveSystem.getSetting('captions'),
                this.saveSystem.getSetting('captionDetail'),
            );
            this.haptics?.setStrength?.(this.saveSystem.getSetting('vibration'));
            this.resetConfirming = false;
            this.resetConfirmTimer = 0;
            resetCollectionCompletionFlow(this);
            this.characterPhonePane = 'collection';
            if (memoryOnly) {
                this._setToast('Reset for this session — browser storage is unavailable');
            }
            return true;
        }
        this.resetConfirming = true;
        this.resetConfirmTimer = 3;
        return false;
    },
    // Dispatch a click on a main-menu hotspot (see MenuRenderer). Any action
    // other than RESET cancels a pending reset confirmation.
    _menuAction(action, arg) {
        // A menu tap is a user gesture — resume the audio context here and give
        // every interaction a click sound.
        this.audio.resume();
        this.audio.click();
        // Paid/reward transactions finish against the menu state that started
        // them. Do not launch a run or switch surfaces while a durable receipt
        // is in flight; otherwise a committed case reel or Mines board could
        // become invisible in gameplay and reappear stale on the next menu.
        if (blockMenuDuringSecureSave(this)) return false;
        const hadBlueprintConfirm = this.blueprintConfirm !== null
            && this.blueprintConfirm !== undefined;
        // Every menu route except the matching second purchase press cancels an
        // armed Blueprint. The purchase case below performs its own strict
        // id/deadline check; malformed or mismatched dispatches fail closed.
        if (action !== 'purchaseCollectionBlueprint') this.blueprintConfirm = null;
        // Guided tour owns the menu while it's up: Next advances (finishing on
        // the last step), Skip ends it, and every other action is swallowed so
        // the player can't wander (or buy anything by accident) mid-lesson.
        if (this.menuTour) {
            if (action === 'tourNext') {
                this.menuTour.idx += 1;
                if (this.menuTour.idx >= TOUR_STEPS.length) this._endMenuTour();
                else this._applyTourStep();
            } else if (action === 'tourSkip') {
                this._endMenuTour();
            }
            return;
        }
        if (action !== 'resetSave' && action !== 'tab') this.resetConfirming = false;
        switch (action) {
            // Opening a tab acknowledges its one-time "NEW" badge (staged
            // unlock — see MenuRenderer tabUnlocked + SaveSystem.markTabSeen).
            case 'tab':
                resetCollectionCompletionFlow(this);
                this.menuTab = arg;
                this.saveSystem.markTabSeen(arg);
                this.resetConfirming = false;
                this._resetMenuFocus();
                {
                    const tabLabel = menuHotspotLabel('tab', arg).replace(/^Open\s+/i, '');
                    this.accessibility?.setScreen?.('start', `${tabLabel}.`);
                    this.accessibility?.announce?.(`${tabLabel} opened.`);
                }
                break;
            case 'startRun': this._pressFeedback('start'); this.dailyMode = false; this.riteTrialMode = false; this.bossRushMode = false; this.weeklyEmberMode = false; this._startRun({ campaignEligible: true }); break;
            case 'startDaily': this._pressFeedback('start'); this.dailyMode = true; this.riteTrialMode = false; this.bossRushMode = false; this.weeklyEmberMode = false; this._startRun(); break;
            // KINDLED PR5 — launch the daily hero-locked Rite Trial (mutually
            // exclusive with the Daily Road; the trial hero is a session-local override).
            case 'startRiteTrial': this._pressFeedback('start'); this.riteTrialMode = true; this.dailyMode = false; this.bossRushMode = false; this.weeklyEmberMode = false; this._startRun(); break;
            // BOSSFORGE — launch Boss Rush: a fixed apex-boss gauntlet using the
            // player's own hero + map. Mutually exclusive with the daily modes.
            case 'startBossRush': this._pressFeedback('start'); this.bossRushMode = true; this.dailyMode = false; this.riteTrialMode = false; this.weeklyEmberMode = false; this._startRun(); break;
            // Weekly Ember — the seeded weekly gauntlet (same controller as Boss
            // Rush; per-UTC-week deterministic boss order, week-scoped best).
            case 'startWeeklyEmber': this._pressFeedback('start'); this.weeklyEmberMode = true; this.bossRushMode = false; this.dailyMode = false; this.riteTrialMode = false; this._startRun(); break;
            case 'setDifficulty': this.saveSystem.setDifficulty(arg); break;
            case 'toggleModifier':
                if (this.selectedModifiers.has(arg)) this.selectedModifiers.delete(arg);
                else this.selectedModifiers.add(arg);
                break;
            case 'selectPatron':
                // Tapping the active Patron again clears it (back to no allegiance).
                // (The click sound is already played for every menu action above.)
                this._pressFeedback(`patron:${arg.id}`);
                this.selectedPatron = (this.selectedPatron === arg.id) ? null : arg.id;
                break;
            case 'buyUpgrade': this._pressFeedback(`shop:${arg}`); this.buyUpgrade(arg); break;
            case 'attuneRelic': this._pressFeedback(`attune:${arg}`); this.buyAttune(arg); break;
            // Stage a relic on the ATTUNE altar pane (selection only, no spend).
            case 'attuneSelect': this._pressFeedback(`attuneSel:${arg}`); this.attuneSel = arg; break;
            case 'buyHeroAttune': this._pressFeedback(`heroAttune:${arg}`); this.buyHeroAttune(arg); break;
            case 'characterPhonePane': {
                const pane = arg === 'rites' ? 'rites' : 'collection';
                resetCollectionCompletionFlow(this);
                this.characterPhonePane = pane;
                this._resetMenuFocus();
                const label = pane === 'rites'
                    ? 'Hero Rites and Attunement'
                    : 'Character Collection';
                this.accessibility?.setScreen?.('start', `${label}.`);
                this.accessibility?.announce?.(`${label}.`);
                break;
            }
            case 'openCollectionCompletion': {
                if (!completionRouteAllowed(this)) break;
                const current = collectionCompletionSnapshot(this);
                this.collectionCompletion = {
                    ...current,
                    open: true,
                    section: 'overview',
                    page: 1,
                };
                this.characterPhonePane = 'collection';
                this.blueprintConfirm = null;
                this.blueprintReceipt = null;
                this._resetMenuFocus?.();
                announceCompletionScreen(this, 'Overview', 'Collection truth opened.');
                break;
            }
            // Locked Blueprint cards may enter their exact detail directly.
            // The allowlist is catalog-derived; an arbitrary cosmetic id can
            // never become a purchase target through direct dispatch.
            case 'openCollectionBlueprint': {
                if (!completionRouteAllowed(this) || !COSMETIC_BLUEPRINT_ID_SET.has(arg)) break;
                const item = cosmeticById(arg);
                if (!item) break;
                this.collectionCompletion = {
                    ...collectionCompletionSnapshot(this),
                    open: true,
                    section: 'blueprint',
                    page: 1,
                    blueprintId: item.id,
                };
                this.characterPhonePane = 'collection';
                this.blueprintConfirm = null;
                this.blueprintReceipt = null;
                this._resetMenuFocus?.();
                announceCompletionScreen(this, 'Blueprints', `${item.name} Blueprint selected.`);
                break;
            }
            case 'closeCollectionCompletion': {
                const current = collectionCompletionSnapshot(this);
                if (!completionRouteAllowed(this) || !current.open) break;
                closeCompletionToCatalog(this);
                break;
            }
            case 'collectionCompletionSection': {
                const current = collectionCompletionSnapshot(this);
                if (!completionRouteAllowed(this) || !current.open
                    || !COLLECTION_COMPLETION_SECTION_SET.has(arg)) break;
                this.collectionCompletion = {
                    ...current,
                    section: arg,
                    page: 1,
                };
                this.blueprintConfirm = null;
                this.blueprintReceipt = null;
                this._resetMenuFocus?.();
                announceCompletionScreen(this, COMPLETION_SECTION_LABELS[arg]);
                break;
            }
            case 'collectionCompletionPage': {
                const current = collectionCompletionSnapshot(this);
                const page = arg;
                if (!completionRouteAllowed(this) || !current.open
                    || !Number.isSafeInteger(page) || page < 1) break;
                this.collectionCompletion = { ...current, page };
                this.blueprintConfirm = null;
                this.blueprintReceipt = null;
                this._resetMenuFocus?.();
                announceCompletionScreen(
                    this,
                    COMPLETION_SECTION_LABELS[current.section],
                    `Page ${page}.`,
                );
                break;
            }
            case 'collectionCompletionBlueprint': {
                const current = collectionCompletionSnapshot(this);
                if (!completionRouteAllowed(this) || !current.open
                    || current.section !== 'blueprint'
                    || !COSMETIC_BLUEPRINT_ID_SET.has(arg)) break;
                const item = cosmeticById(arg);
                if (!item) break;
                this.collectionCompletion = {
                    ...current,
                    page: 1,
                    blueprintId: item.id,
                };
                this.blueprintConfirm = null;
                this.blueprintReceipt = null;
                this._resetMenuFocus?.();
                announceCompletionScreen(this, 'Blueprints', `${item.name} Blueprint selected.`);
                break;
            }
            case 'purchaseCollectionBlueprint': {
                const current = collectionCompletionSnapshot(this);
                const item = typeof arg === 'string' ? cosmeticById(arg) : null;
                const validTarget = completionRouteAllowed(this) && current.open
                    && current.section === 'blueprint'
                    && COSMETIC_BLUEPRINT_ID_SET.has(arg)
                    && current.blueprintId === arg
                    && item;
                if (!validTarget) {
                    this.blueprintConfirm = null;
                    this.blueprintReceipt = null;
                    break;
                }
                const cost = cosmeticBlueprintCost(item);
                if (!Number.isSafeInteger(cost) || cost <= 0) {
                    this.blueprintConfirm = null;
                    this.blueprintReceipt = null;
                    break;
                }
                if (this.blueprintPurchasePending?.id === item.id) {
                    this.accessibility?.announce?.(
                        `${item.name} Blueprint purchase is still securing the save.`,
                    );
                    break;
                }

                const now = blueprintClockNow(this);
                if (!Number.isSafeInteger(now)
                    || now < 0 || now > Number.MAX_SAFE_INTEGER - BLUEPRINT_CONFIRM_MS) {
                    this.blueprintConfirm = null;
                    this.blueprintReceipt = null;
                    this.audio?.deny?.();
                    this.accessibility?.announce?.(
                        `${item.name} Blueprint confirmation is unavailable on this device. No coins were charged.`,
                    );
                    break;
                }
                const pending = this.blueprintConfirm;
                if (!pending || pending.id !== item.id
                    || !Number.isSafeInteger(pending.armedAt)
                    || now < pending.armedAt
                    || !Number.isSafeInteger(pending.expiresAt)
                    || pending.expiresAt - pending.armedAt !== BLUEPRINT_CONFIRM_MS
                    || !(pending.expiresAt > now)) {
                    this.blueprintConfirm = Object.freeze({
                        id: item.id,
                        armedAt: now,
                        expiresAt: now + BLUEPRINT_CONFIRM_MS,
                    });
                    this.blueprintReceipt = null;
                    this._pressFeedback?.(`blueprint:${item.id}`);
                    // Reconcile after the label changes to CONFIRM, but retain
                    // the same key for keyboard users so the second press is
                    // reachable without navigating (which intentionally cancels).
                    this.menuFocusNeedsRefresh = true;
                    this.accessibility?.announce?.(
                        `Confirm ${item.name} Blueprint for ${cost.toLocaleString('en-US')} coins. `
                        + 'Press purchase again within 3 seconds.',
                    );
                    break;
                }

                this.blueprintConfirm = null;
                const atomicPurchase = this.saveSystem?.purchaseCosmeticBlueprintAtomic;
                if (typeof atomicPurchase === 'function') {
                    const serial = (Number.isSafeInteger(this._blueprintPurchaseSerial)
                        ? this._blueprintPurchaseSerial : 0) + 1;
                    this._blueprintPurchaseSerial = serial;
                    this.blueprintPurchasePending = Object.freeze({ id: item.id, serial });
                    this.blueprintReceipt = null;
                    this.menuFocusNeedsRefresh = true;
                    this.accessibility?.announce?.(
                        `Securing ${item.name} Blueprint purchase across game tabs.`,
                    );
                    let operation;
                    try {
                        operation = atomicPurchase.call(this.saveSystem, item.id, cost);
                    } catch (e) {
                        operation = { ok: false, reason: 'transaction-lock-failed' };
                    }
                    // Keep the exact operation promise available to lifecycle
                    // owners (including the production harness) so they can
                    // await the browser's Web Lock task directly. Polling a
                    // virtual clock can starve that task in headless Chromium.
                    const purchaseTask = Promise.resolve(operation).then((result) => {
                        if (this.blueprintPurchasePending?.serial !== serial
                            || this.blueprintPurchasePending?.id !== item.id) return;
                        this.blueprintPurchasePending = null;
                        completeBlueprintPurchase(this, item, cost, result);
                        this.menuFocusNeedsRefresh = true;
                    }).catch(() => {
                        if (this.blueprintPurchasePending?.serial !== serial
                            || this.blueprintPurchasePending?.id !== item.id) return;
                        this.blueprintPurchasePending = null;
                        completeBlueprintPurchase(this, item, cost, {
                            ok: false, reason: 'transaction-lock-failed',
                        });
                        this.menuFocusNeedsRefresh = true;
                    });
                    this._blueprintPurchaseTask = purchaseTask;
                    purchaseTask.finally(() => {
                        if (this._blueprintPurchaseTask === purchaseTask) {
                            this._blueprintPurchaseTask = null;
                        }
                    });
                    break;
                }
                const result = typeof this.saveSystem?.purchaseCosmeticBlueprint === 'function'
                    ? this.saveSystem.purchaseCosmeticBlueprint(item.id, cost)
                    : { ok: false, reason: 'purchase-unavailable' };
                completeBlueprintPurchase(this, item, cost, result);
                break;
            }
            case 'cancelCollectionBlueprint': {
                const current = collectionCompletionSnapshot(this);
                if (!completionRouteAllowed(this) || !current.open
                    || current.section !== 'blueprint' || !hadBlueprintConfirm) break;
                this.blueprintConfirm = null;
                this.blueprintReceipt = null;
                this._resetMenuFocus?.();
                this.accessibility?.announce?.('Blueprint purchase canceled.');
                break;
            }
            case 'collectionCompletionBack': {
                const current = collectionCompletionSnapshot(this);
                if (!completionRouteAllowed(this) || !current.open) break;
                this.blueprintConfirm = null;
                this.blueprintReceipt = null;
                if (current.section === 'overview') {
                    closeCompletionToCatalog(this);
                    break;
                }
                const section = current.section === 'case' ? 'blueprint'
                    : current.section === 'blueprint' ? 'sources'
                        : 'overview';
                this.collectionCompletion = {
                    ...current,
                    section,
                    page: 1,
                };
                this._resetMenuFocus?.();
                announceCompletionScreen(this, COMPLETION_SECTION_LABELS[section]);
                break;
            }
            case 'resetSave': this._pressFeedback('reset'); this.requestResetSave(); break;
            case 'equipGear':
                if (this.saveSystem.equipGear(arg.category, arg.id)) this.audio.equip();
                else reportSaveMutationFailure(this, 'Gear change');
                break;
            case 'equipCosmetic':
                if (this.saveSystem.equipCosmetic(arg.category, arg.id)) this.audio.equip();
                else reportSaveMutationFailure(this, 'Cosmetic change');
                break;
            case 'buyCosmetic': this._pressFeedback(`cos:${arg && arg.id}`); this._buyCosmetic(arg); break;
            // Collection Growth I-A — every browse action is session-only and
            // fail-closed. Filter changes return to page one; page hotspots pass
            // absolute 1-based targets that the pure collection model clamps.
            case 'collectionCategory': {
                if (!['fur', 'cloak', 'hat', 'aura', 'trail'].includes(arg)) break;
                this.collectionView = { ...(this.collectionView || {}), category: arg, page: 1 };
                this._resetMenuFocus();
                this.accessibility?.announce?.(`${arg === 'hat' ? 'Accessory' : arg} cosmetics.`);
                break;
            }
            case 'collectionOwnership': {
                if (!['all', 'owned', 'locked'].includes(arg)) break;
                this.collectionView = { ...(this.collectionView || {}), ownership: arg, page: 1 };
                this._resetMenuFocus();
                this.accessibility?.announce?.(`Collection filter: ${arg}.`);
                break;
            }
            case 'collectionSource': {
                if (!['all', 'starter', 'boutique', 'blueprint', 'case', 'achievement', 'vigil'].includes(arg)) break;
                this.collectionView = { ...(this.collectionView || {}), source: arg, page: 1 };
                this._resetMenuFocus();
                const sourceLabel = arg === 'vigil' ? 'Vigil Path'
                    : arg === 'blueprint' ? 'Blueprint' : arg;
                this.accessibility?.announce?.(`Collection source: ${sourceLabel}.`);
                break;
            }
            case 'collectionPage': {
                const page = Number(arg);
                if (!Number.isInteger(page) || page < 1) break;
                this.collectionView = { ...(this.collectionView || {}), page };
                this._resetMenuFocus();
                this.accessibility?.announce?.(`Collection page ${page}.`);
                break;
            }
            case 'boutiqueCategory': {
                if (!['fur', 'cloak', 'hat', 'aura', 'trail'].includes(arg)) break;
                this.boutiqueView = { ...(this.boutiqueView || {}), category: arg, page: 1 };
                this._resetMenuFocus();
                this.accessibility?.announce?.(`Boutique ${arg === 'hat' ? 'accessory' : arg} stock.`);
                break;
            }
            case 'boutiquePage': {
                const page = Number(arg);
                if (!Number.isInteger(page) || page < 1) break;
                this.boutiqueView = { ...(this.boutiqueView || {}), page };
                this._resetMenuFocus();
                this.accessibility?.announce?.(`Boutique stock page ${page}.`);
                break;
            }
            case 'boutiqueSetPage': {
                const setPage = Number(arg);
                if (!Number.isInteger(setPage) || setPage < 1) break;
                this.boutiqueView = { ...(this.boutiqueView || {}), setPage };
                this._resetMenuFocus();
                this.accessibility?.announce?.(`Boutique set page ${setPage}.`);
                break;
            }
            // BOUTIQUE fitting room: toggle a piece, stage a whole themed set,
            // clear, or buy+equip the tried-on look.
            case 'tryOnCosmetic': {
                this._pressFeedback(`try:${arg && arg.id}`);
                if (arg && arg.category) {
                    if (this.tryOn[arg.category] === arg.id) delete this.tryOn[arg.category];
                    else this.tryOn[arg.category] = arg.id;
                }
                break;
            }
            case 'tryOnSet': {
                this._pressFeedback(`tryset:${arg}`);
                const set = COSMETIC_SETS.find((s) => s.id === arg);
                if (set) this.tryOn = { ...set.pieces };
                break;
            }
            case 'pursueCosmeticSet': {
                const set = COSMETIC_SETS.find((entry) => entry.id === arg);
                if (!set) break;
                const current = this.saveSystem.data.cosmetics.pursuitSetId;
                const next = current === set.id ? null : set.id;
                if (this.saveSystem.setCosmeticPursuit(next)) {
                    this._pressFeedback(`pursue:${set.id}`);
                    this.accessibility?.announce?.(next
                        ? `${set.name} collection tracking started.`
                        : `${set.name} collection tracking stopped.`);
                }
                break;
            }
            case 'tryOnClear': this._pressFeedback('tryclear'); this.tryOn = {}; break;
            // From the CHARACTER grid: stage the tapped coin cosmetic in the
            // fitting room and jump to the boutique, try-on ready.
            case 'tryInBoutique': {
                this._pressFeedback(`try:${arg && arg.id}`);
                if (arg && arg.category) this.tryOn[arg.category] = arg.id;
                resetCollectionCompletionFlow(this);
                this.menuTab = 'boutique';
                this.saveSystem.markTabSeen('boutique');
                this.resetConfirming = false;
                this._resetMenuFocus();
                {
                    const tabLabel = menuHotspotLabel('tab', 'boutique').replace(/^Open\s+/i, '');
                    this.accessibility?.setScreen?.('start', `${tabLabel}.`);
                    this.accessibility?.announce?.(`${tabLabel} opened.`);
                }
                break;
            }
            case 'buyTryOn': this._pressFeedback('trybuy'); this.buyTryOn(); break;
            case 'selectCharacter':
                this._pressFeedback(`char:${arg.id}`);
                if (!this.saveSystem.setSelectedCharacter(arg.id)) {
                    reportSaveMutationFailure(this, 'Character change');
                }
                break;
            case 'selectMap': {
                this._pressFeedback(`map:${arg.id}`);
                const status = this.saveSystem.getMapUnlockStatus(arg.id);
                const selected = this.saveSystem.setSelectedMap(arg.id);
                if (!selected) {
                    if (status?.known && status.requiredMapId) {
                        const priorMap = MAPS[status.requiredMapId]?.name ?? 'the previous map';
                        this._setToast(
                            `Defeat all ${status.requiredCount} ${priorMap} bosses · ${status.defeatedCount}/${status.requiredCount} complete`,
                        );
                    } else {
                        this._setToast('Map unavailable');
                    }
                } else if (status?.qaBypass) {
                    this._setToast('QA map open · campaign credit off');
                }
                break;
            }
            case 'settingsPane': {
                const pane = arg === 'accessibility' ? 'accessibility' : 'general';
                this.settingsPane = pane;
                this._resetMenuFocus();
                const label = pane === 'accessibility'
                    ? 'Accessibility and Display settings'
                    : 'General settings';
                this.accessibility?.setScreen?.('start', `${label}.`);
                this.accessibility?.announce?.(`${label}.`);
                break;
            }
            case 'toggleSetting': this._toggleSetting(arg); break;
            case 'setUiScale': this._setUiScale(arg); break;
            case 'setCaptionDetail': this._setCaptionDetail(arg); break;
            case 'setVibration': this._setVibration(arg); break;
            case 'volUp': this._adjustVolume(arg, 0.1); break;
            case 'volDown': this._adjustVolume(arg, -0.1); break;
            case 'openCase': this._resetMenuFocus(); this.minigame.openCaseFlow(arg); break;
            case 'openMines': this._resetMenuFocus(); this.minesFocusIndex = 0; this.minigame.openMines(arg); break;
            case 'claimBP': startBattlePassClaim(this, 'single', arg); break;
            case 'claimAllBP': startBattlePassClaim(this, 'all'); break;
            case 'caseContinue': this.minigame.dismissCase(); this._resetMenuFocus(); break;
            case 'replayTutorial':
                if (this.saveSystem.setTourDone(false)) {
                    this._forceRunHints = true;      // next run re-teaches the loop
                    this._armMenuTour();
                } else {
                    reportSaveMutationFailure(this, 'Tutorial reset');
                }
                break;
            case 'cheatCoins':
                if (!DEV_MODE) break;
                {
                    const added = this.saveSystem.addCoins(arg);
                    if (added > 0) this._setToast(`+${added} coins`);
                    else if (this.saveSystem.getLastSaveFailureReason?.()) {
                        reportSaveMutationFailure(this, 'Developer coin grant');
                    } else this._setToast('Coin wallet already full');
                }
                break;
            case 'cheatUnlockAll': {
                if (!DEV_MODE) break;
                const n = this.saveSystem.cheatUnlockAll();
                if (n > 0) this._setToast(`Unlocked ${n} item${n > 1 ? 's' : ''}`);
                else if (this.saveSystem.getLastSaveFailureReason?.()) {
                    reportSaveMutationFailure(this, 'Developer unlock');
                } else this._setToast('Everything already unlocked');
                break;
            }
            default: break;
        }
    },
    _toggleSetting(key) {
        // The map bypass is a ?dev=1 QA capability, not a persisted preference.
        // Guard the action itself so direct dispatch cannot bypass hidden UI.
        if ((key === 'unlockMaps' || key === 'debug') && !DEV_MODE) return false;
        const cur = this.saveSystem.getSetting(key) === true;
        const next = !cur;
        if (this.saveSystem.setSetting(key, next) !== next) {
            return reportSaveMutationFailure(this, 'Setting change');
        }
        if (key === 'debug') {
            this.showDebug = next;
            this.profiler.enabled = this.showDebug;
            if (this.showDebug) this._taintCampaignRun?.('debug-mode');
        }
        if (key === 'monoAudio') this.audio.setMonoAudio(next);
        if (key === 'captions') {
            this.captionSystem?.setPreferences?.(next, this.saveSystem.getSetting('captionDetail'));
        }
        this.accessibility?.announce?.(`${menuHotspotLabel('toggleSetting', key)}: ${next ? 'on' : 'off'}.`);
        return true;
    },
    _setUiScale(value) {
        const scale = normalizeUiScale(value);
        if (this.saveSystem.setSetting('uiScale', scale) !== scale) {
            return reportSaveMutationFailure(this, 'HUD size change');
        }
        this.accessibility?.announce?.(`Combat HUD size: ${scale} percent.`);
        return scale;
    },
    _setCaptionDetail(value) {
        const detail = normalizeCaptionDetail(value);
        if (this.saveSystem.setSetting('captionDetail', detail) !== detail) {
            return reportSaveMutationFailure(this, 'Caption detail change');
        }
        this.captionSystem?.setPreferences?.(this.saveSystem.getSetting('captions'), detail);
        this.accessibility?.announce?.(`Caption detail: ${detail}.`);
        return detail;
    },
    _setVibration(value) {
        const strength = normalizeVibrationStrength(value);
        if (this.saveSystem.setSetting('vibration', strength) !== strength) {
            return reportSaveMutationFailure(this, 'Vibration change');
        }
        this.haptics?.setStrength?.(strength);
        const supported = this.haptics?.supported?.() === true;
        if (strength !== 'off' && supported) this.haptics?.pulse?.('preview');
        const suffix = strength !== 'off' && !supported ? ' Saved; not available in this browser.' : '';
        this.accessibility?.announce?.(`Vibration: ${strength}.${suffix}`);
        return strength;
    },
    _adjustVolume(key, delta) {
        const cur = typeof this.saveSystem.getSetting(key) === 'number' ? this.saveSystem.getSetting(key) : 0.7;
        const next = clamp(cur + delta, 0, 1);
        if (this.saveSystem.setSetting(key, next) !== next) {
            return reportSaveMutationFailure(this, 'Volume change');
        }
        this.audio.setVolumes(
            this.saveSystem.getSetting('volMusic'),
            this.saveSystem.getSetting('volSfx'),
            this.saveSystem.getSetting('volVoice'),
        );
        const value = Math.round((this.saveSystem.getSetting(key) || 0) * 100);
        this.accessibility?.announce?.(`${menuHotspotLabel(delta > 0 ? 'volUp' : 'volDown', key)}: ${value} percent.`);
        return next;
    },
    selectUpgrade(idx) {
        if (!this.upgradeChoices) return;
        const upgrade = this.upgradeChoices[idx];
        if (!upgrade) return;
        // First level-up pick made — move on to the meta lessons (coins,
        // combo, shrines, boss). Later picks (step already past 3) don't reset.
        if (this.onboarding && this.onboarding.step === 3) this._advanceOnboarding();
        this.upgradeSystem.apply(upgrade, this);
        this.audio.upgrade();
        this.setUpgradeChoices(null);
        // Drain pending level-ups first, then move on to any queued chests /
        // altars so the player isn't tossed between overlay types mid-stream.
        if (this.pendingLevelUps > 0) this._presentLevelUp();
        else if (this.pendingChests > 0) this._presentChest();
        else if (this.pendingAltars > 0) this._presentAltar();
    },
    selectAltar(idx) {
        if (!this.altar) return;
        const choice = this.altar.choices[idx];
        if (!choice) return;
        // First shrine claimed — the shrine lesson is learned. (Event-driven,
        // mirroring selectUpgrade: the overlay gate keeps _tickOnboarding from
        // ever observing this.altar, so the tick can't do this itself.) The ✓
        // flash shows for a beat once the overlay closes.
        if (this.onboarding && this.onboarding.step === 6) this._completeOnboardingStep();
        choice.apply(this);
        // Flavor-matched pick cues: fusion = forge slam, pact = dark bargain,
        // everything else keeps the standard upgrade chirp.
        if (choice.kind === 'fusion') this.audio.fusionForge();
        else if (choice.kind === 'pact') this.audio.pactSworn();
        else this.audio.upgrade();
        if (choice.kind === 'fusion') {
            // Fusing is a run-defining moment — announce it like an evolution.
            this.waveDirector.announce(`⚔ FUSED — ${choice.name.toUpperCase()} ⚔`, 3.0, '#ffd3ec');
            this._pushFeedback('levelup', 0.4);
            this.particles.levelUpBurst(this.player.x, this.player.y);
        } else if (choice.kind === 'pact') {
            // A devil's-bargain — a heavier, ashen callout + shake for the weight.
            this.waveDirector.announce(`☠ PACT SWORN — ${choice.name.toUpperCase()} ☠`, 3.0, '#c97bff');
            this._pushFeedback('levelup', 0.4);
            this._shake(SCREEN_SHAKE.intensity * 0.5, 0.35);
        } else if (choice.kind === 'road') {
            // Branching Roads: the fork biases the segment ahead (apply() already
            // set segmentScale/segmentWeights + the re-tint + the boon). Announce it
            // in the road's own accent so the choice reads.
            this.waveDirector.announce(`⟡ ${choice.name.toUpperCase()} ⟡`, 2.6, choice.tintAccent || '#ffb060');
            this._pushFeedback('levelup', 0.3);
        } else {
            // Relic: record the claim in the lifetime codex; a first-ever discovery
            // gets a brighter callout + a reward flash so it feels earned.
            const firstTime = choice.relicId ? this.saveSystem.discoverRelic(choice.relicId) : false;
            if (firstTime) {
                this.waveDirector.announce(`✦ NEW RELIC — ${choice.name.toUpperCase()} ✦`, 3.0, '#ffd3ec');
                this._pushFeedback('levelup', 0.4);
            } else {
                this.waveDirector.announce(`RELIC — ${choice.name.toUpperCase()}`, 2.4, '#ff9ecf');
            }
        }
        this.setAltar(null);
        // Drain any queued overlays so the player is never stranded mid-sequence
        // (altars first, then level-ups, then chests — the same discipline the
        // other overlays use).
        if (this.pendingAltars > 0) this._presentAltar();
        else if (this.pendingLevelUps > 0) this._presentLevelUp();
        else if (this.pendingChests > 0) this._presentChest();
    },
};
