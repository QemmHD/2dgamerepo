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
import { openCase } from '../systems/CaseSystem.js';
import { COSMETICS, cosmeticCoinCost } from '../content/cosmetics.js';
import { PERMANENT_UPGRADES, nextCost } from '../content/permanentUpgrades.js';
import { getMap } from '../content/maps.js';
import { TOUR_STEPS } from '../content/tutorialTour.js';

export const GameInputActionMethods = {
    // Pause is only meaningful during live gameplay (overlays already
    // freeze the world). Toggling re-enables/disables the joystick.
    togglePause() {
        if (this.screen !== 'gameplay' || this.gameOver ||
            this.upgradeChoices || this.chestReward) return;
        this.paused = !this.paused;
        // The hearth damps down while paused (soft whoosh + held music dim).
        if (this.paused) this.audio.pauseIn(); else this.audio.pauseOut();
        this.audio.setPaused(this.paused);
        this._updateJoystickEnabled();
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
    requestResetSave() {
        if (this.resetConfirming) {
            this.saveSystem.reset();
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
            case 'tab': this.menuTab = arg; this.saveSystem.markTabSeen(arg); this.resetConfirming = false; break;
            case 'startRun': this._pressFeedback('start'); this.dailyMode = false; this.riteTrialMode = false; this.bossRushMode = false; this._startRun(); break;
            case 'startDaily': this._pressFeedback('start'); this.dailyMode = true; this.riteTrialMode = false; this.bossRushMode = false; this._startRun(); break;
            // KINDLED PR5 — launch the daily hero-locked Rite Trial (mutually
            // exclusive with the Daily Road; the trial hero is a session-local override).
            case 'startRiteTrial': this._pressFeedback('start'); this.riteTrialMode = true; this.dailyMode = false; this.bossRushMode = false; this._startRun(); break;
            // BOSSFORGE — launch Boss Rush: a fixed apex-boss gauntlet using the
            // player's own hero + map. Mutually exclusive with the daily modes.
            case 'startBossRush': this._pressFeedback('start'); this.bossRushMode = true; this.dailyMode = false; this.riteTrialMode = false; this._startRun(); break;
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
            case 'buyHeroAttune': this._pressFeedback(`heroAttune:${arg}`); this.buyHeroAttune(arg); break;
            case 'resetSave': this._pressFeedback('reset'); this.requestResetSave(); break;
            case 'equipGear': this.saveSystem.equipGear(arg.category, arg.id); this.audio.equip(); break;
            case 'equipCosmetic': this.saveSystem.equipCosmetic(arg.category, arg.id); this.audio.equip(); break;
            case 'buyCosmetic': this._pressFeedback(`cos:${arg && arg.id}`); this._buyCosmetic(arg); break;
            case 'selectCharacter': this._pressFeedback(`char:${arg.id}`); this.saveSystem.setSelectedCharacter(arg.id); break;
            case 'selectMap': {
                this._pressFeedback(`map:${arg.id}`);
                if (!this.saveSystem.setSelectedMap(arg.id)) {
                    const need = getMap(arg.id)?.unlockBosses ?? 3;
                    this._setToast(`Defeat ${need} bosses to unlock`);
                }
                break;
            }
            case 'toggleSetting': this._toggleSetting(arg); break;
            case 'volUp': this._adjustVolume(arg, 0.1); break;
            case 'volDown': this._adjustVolume(arg, -0.1); break;
            case 'openCase': this.minigame.openCaseFlow(arg); break;
            case 'openMines': this.minigame.openMines(arg); break;
            case 'claimBP': {
                const r = claimBattlePass(this.saveSystem, arg);
                this._setToast(r.ok ? `Claimed: ${r.label}` : 'Cannot claim');
                break;
            }
            case 'claimAllBP': {
                const n = claimAllBattlePass(this.saveSystem);
                this._setToast(n > 0 ? `Claimed ${n} reward${n > 1 ? 's' : ''}` : 'Nothing to claim');
                break;
            }
            case 'caseContinue': this.minigame.dismissCase(); break;
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
    },
    _adjustVolume(key, delta) {
        const cur = typeof this.saveSystem.getSetting(key) === 'number' ? this.saveSystem.getSetting(key) : 0.7;
        this.saveSystem.setSetting(key, clamp(cur + delta, 0, 1));
        this.audio.setVolumes(this.saveSystem.getSetting('volMusic'), this.saveSystem.getSetting('volSfx'));
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
