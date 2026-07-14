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

import { SCREEN_SHAKE } from '../config/GameConfig.js';
import { clamp } from './MathUtils.js';
import { claim as claimBattlePass, claimAll as claimAllBattlePass } from '../systems/BattlePassSystem.js';
import { openCase, MINES } from '../systems/CaseSystem.js';
import { COSMETICS, COSMETIC_SETS, cosmeticCoinCost } from '../content/cosmetics.js';
import { PERMANENT_UPGRADES, nextCost } from '../content/permanentUpgrades.js';
import { getMap } from '../content/maps.js';
import { TOUR_STEPS } from '../content/tutorialTour.js';
import { menuHotspotLabel } from '../systems/AccessibilityBridge.js';
import {
    normalizeCaptionDetail,
    normalizeUiScale,
    normalizeVibrationStrength,
} from '../systems/AccessibilityPreferences.js';

export const PAUSE_EXIT_CONFIRM_MS = 3000;

// Commands routed by Game's keydown listener are edge-triggered. Browser
// key-repeat must not turn one held press into two destructive confirmations,
// cross an overlay boundary, or toggle pause straight back off. Tab/arrows and
// photo zoom (Q/E) are intentionally absent. A/S remain listed because overlays
// also bind them to Share/Alter; held movement is tracked independently by
// KeyboardInput and this guard only exits Game's command-routing callback.
export const DISCRETE_KEY_CODES = Object.freeze([
    'Backquote', 'F2',
    'Enter', 'Space', 'Escape',
    'KeyC', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyM', 'KeyN', 'KeyP',
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
        if (!current) return this._menuMoveFocus(1);
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
        this._startRun();
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
        this.shakeEnabled = !this.shakeEnabled;
        this.saveSystem.setSetting('screenShake', this.shakeEnabled);
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
        // Use nextCost (NOT costAt) so the deducted price matches what the shop
        // shows — both carry the deep-level steepening.
        const cost = nextCost(upgrade, cur);
        if (!this.saveSystem.spendCoins(cost)) { this.audio.deny(); return false; }
        // Refund if the persist step can't apply (e.g. an upgrade id missing
        // from the save schema) so coins are never taken without an upgrade.
        if (!this.saveSystem.incrementUpgrade(id)) {
            this.saveSystem.addCoins(cost);
            return false;
        }
        this.audio.purchase();
        return true;
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
            this.saveSystem.equipCosmetic(item.category, item.id); this.audio.equip(); return true;
        }
        const price = cosmeticCoinCost(item);
        if (!price) return false;                                 // not a coin item
        if (!this.saveSystem.spendCoins(price)) { this.audio.deny(); this._setToast('Not enough coins'); return false; }
        if (!this.saveSystem.unlockCosmetic(item.id)) { this.saveSystem.addCoins(price); return false; }
        this.saveSystem.equipCosmetic(item.category, item.id);
        this.audio.cosmeticReward();          // celebratory fanfare on a NEW unlock
        this._setToast(`Unlocked ${item.name}`);
        return true;
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
        for (const [, id] of entries) {
            const item = COSMETICS[id];
            if (!item) continue;
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
        if (total > 0 && !this.saveSystem.spendCoins(total)) {
            this.audio.deny();
            this._setToast(`Need ◎ ${(total - this.saveSystem.data.totalCoins).toLocaleString()} more`);
            return;
        }
        for (const item of buys) this.saveSystem.unlockCosmetic(item.id);
        let equippedN = 0;
        for (const [cat, id] of entries) {
            if (this.saveSystem.isCosmeticUnlocked(id)) { this.saveSystem.equipCosmetic(cat, id); equippedN++; }
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
            this.saveSystem.reset();
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
            case 'startRun': this._pressFeedback('start'); this.dailyMode = false; this.riteTrialMode = false; this.bossRushMode = false; this.weeklyEmberMode = false; this._startRun(); break;
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
            case 'resetSave': this._pressFeedback('reset'); this.requestResetSave(); break;
            case 'equipGear': this.saveSystem.equipGear(arg.category, arg.id); this.audio.equip(); break;
            case 'equipCosmetic': this.saveSystem.equipCosmetic(arg.category, arg.id); this.audio.equip(); break;
            case 'buyCosmetic': this._pressFeedback(`cos:${arg && arg.id}`); this._buyCosmetic(arg); break;
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
            case 'tryOnClear': this._pressFeedback('tryclear'); this.tryOn = {}; break;
            // From the CHARACTER grid: stage the tapped coin cosmetic in the
            // fitting room and jump to the boutique, try-on ready.
            case 'tryInBoutique': {
                this._pressFeedback(`try:${arg && arg.id}`);
                if (arg && arg.category) this.tryOn[arg.category] = arg.id;
                this.menuTab = 'boutique';
                this.saveSystem.markTabSeen('boutique');
                break;
            }
            case 'buyTryOn': this._pressFeedback('trybuy'); this.buyTryOn(); break;
            case 'selectCharacter': this._pressFeedback(`char:${arg.id}`); this.saveSystem.setSelectedCharacter(arg.id); break;
            case 'selectMap': {
                this._pressFeedback(`map:${arg.id}`);
                if (!this.saveSystem.setSelectedMap(arg.id)) {
                    const need = getMap(arg.id)?.unlockBosses ?? 3;
                    this._setToast(`Defeat ${need} bosses to unlock`);
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
            case 'claimBP': {
                const r = claimBattlePass(this.saveSystem, arg);
                this._setToast(r.ok ? `Claimed: ${r.label}` : 'Cannot claim');
                break;
            }
            case 'claimAllBP': {
                const r = claimAllBattlePass(this.saveSystem);
                const recent = r.labels.slice(-2).join(' · ');
                this._setToast(r.count > 0
                    ? `Claimed ${r.count} reward${r.count > 1 ? 's' : ''}${recent ? ` · ${recent}` : ''}`
                    : 'Nothing to claim');
                break;
            }
            case 'caseContinue': this.minigame.dismissCase(); this._resetMenuFocus(); break;
            case 'replayTutorial':
                this.saveSystem.setTourDone(false);
                this._forceRunHints = true;      // next run re-teaches the loop
                this._armMenuTour();
                break;
            case 'cheatCoins': this.saveSystem.addCoins(arg); this._setToast(`+${arg} coins`); break;
            case 'cheatUnlockAll': {
                const n = this.saveSystem.cheatUnlockAll();
                this._setToast(n > 0 ? `Unlocked ${n} item${n > 1 ? 's' : ''}` : 'Everything already unlocked');
                break;
            }
            default: break;
        }
    },
    _toggleSetting(key) {
        const cur = this.saveSystem.getSetting(key) === true;
        this.saveSystem.setSetting(key, !cur);
        if (key === 'debug') { this.showDebug = !cur; this.profiler.enabled = this.showDebug; }
        if (key === 'monoAudio') this.audio.setMonoAudio(!cur);
        if (key === 'captions') {
            this.captionSystem?.setPreferences?.(!cur, this.saveSystem.getSetting('captionDetail'));
        }
        this.accessibility?.announce?.(`${menuHotspotLabel('toggleSetting', key)}: ${!cur ? 'on' : 'off'}.`);
    },
    _setUiScale(value) {
        const scale = normalizeUiScale(value);
        this.saveSystem.setSetting('uiScale', scale);
        this.accessibility?.announce?.(`Combat HUD size: ${scale} percent.`);
        return scale;
    },
    _setCaptionDetail(value) {
        const detail = normalizeCaptionDetail(value);
        this.saveSystem.setSetting('captionDetail', detail);
        this.captionSystem?.setPreferences?.(this.saveSystem.getSetting('captions'), detail);
        this.accessibility?.announce?.(`Caption detail: ${detail}.`);
        return detail;
    },
    _setVibration(value) {
        const strength = normalizeVibrationStrength(value);
        this.saveSystem.setSetting('vibration', strength);
        this.haptics?.setStrength?.(strength);
        const supported = this.haptics?.supported?.() === true;
        if (strength !== 'off' && supported) this.haptics?.pulse?.('preview');
        const suffix = strength !== 'off' && !supported ? ' Saved; not available in this browser.' : '';
        this.accessibility?.announce?.(`Vibration: ${strength}.${suffix}`);
        return strength;
    },
    _adjustVolume(key, delta) {
        const cur = typeof this.saveSystem.getSetting(key) === 'number' ? this.saveSystem.getSetting(key) : 0.7;
        this.saveSystem.setSetting(key, clamp(cur + delta, 0, 1));
        this.audio.setVolumes(
            this.saveSystem.getSetting('volMusic'),
            this.saveSystem.getSetting('volSfx'),
            this.saveSystem.getSetting('volVoice'),
        );
        const value = Math.round((this.saveSystem.getSetting(key) || 0) * 100);
        this.accessibility?.announce?.(`${menuHotspotLabel(delta > 0 ? 'volUp' : 'volDown', key)}: ${value} percent.`);
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
