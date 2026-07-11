import {
    GRID_COLOR,
    GRID_SIZE,
    WORLD_WIDTH,
    WORLD_HEIGHT,
    WORLD_BOUNDS_COLOR,
    DEBUG_DEFAULT_ON,
    DEV_MODE,
    INTERNAL_WIDTH,
    INTERNAL_HEIGHT,
    CONTACT_FLASH_DURATION,
    SCREEN_SHAKE,
    ENEMY,
    BOSS,
    ELEMENT,
    CAPS,
    AURA,
    RENDER,
    COMBO,
    ENEMY_SEPARATION,
    WICK_ROADS,
    LIEUTENANT,
    BIOME_HAZARD,
    SKIP_ONBOARDING,
    KINDLE,
    BLINK,
} from '../config/GameConfig.js';
import { TWO_PI, clamp } from './MathUtils.js';
import { Easing } from './Easing.js';
import { Camera } from './Camera.js';
import { FrameProfiler } from './FrameProfiler.js';
import { Player } from '../entities/Player.js';
import { Enemy } from '../entities/Enemy.js';
import { Shrine } from '../entities/Shrine.js';
import { Coin } from '../entities/Coin.js';
import { EnemyProjectile } from '../entities/EnemyProjectile.js';
import { DamageNumber } from '../entities/DamageNumber.js';
import { AUTO_AIM_RANGE } from '../systems/WeaponSystem.js';
import { signatureFor, setUltFocus } from '../content/signatures.js';
import { applyHeroAttunement } from '../content/heroAttunement.js';
import { accrueRites } from '../content/rites.js';
import { getRiteTrialSetup, riteTrialScore } from '../content/riteTrial.js';
import { MapRenderer } from '../systems/MapRenderer.js';
import { ObstacleSystem } from '../systems/ObstacleSystem.js';
import { LightingSystem } from '../systems/LightingSystem.js';
import { ParticleSystem } from '../systems/ParticleSystem.js';
import { AudioSystem } from '../systems/AudioSystem.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { rollChestReward } from '../systems/ChestRewards.js';
import { rollAltarChoices, rollRoadChoices } from '../systems/WickRoadsSystem.js';
import { applyAttunements } from '../content/relics.js';
import { getRoad } from '../content/roads.js';
import { getDailySetup } from '../content/dailyRoad.js';
import { BOSS_RUSH_CONFIG, getBossRushSequence, bossRushScore, getWeeklyEmberConfig, weeklyEmberSeed } from '../content/bossRush.js';
import { BossRushController } from '../systems/BossRushController.js';
import { resolveStartingWeapon, applyLoadout } from '../systems/LoadoutSystem.js';
import { resolveWeaponSkin, isMeleeWeapon } from '../content/weaponSkins.js';
import { evaluateAchievements } from '../content/achievements.js';
import { evaluateDaily, currentDayNumber } from '../content/dailyChallenges.js';
import { DIFFICULTY, RUN_MODIFIERS, RUN_MODIFIER_MAX_BONUS } from '../config/GameConfig.js';
import { applyCharacter } from '../systems/CharacterSystem.js';
import { CHARACTERS, CHARACTER_IDS } from '../content/characters.js';
import { getBorderStrip, getBorderPattern } from '../assets/ObstacleSprites.js';
import { awardRun as awardBattlePassRun } from '../systems/BattlePassSystem.js';
import { openCase } from '../systems/CaseSystem.js';
import { resolveAppearance, cosmeticsForAchievement, COSMETICS } from '../content/cosmetics.js';
import { WEAPONS, computePlayerAura } from '../content/weapons.js';
import { applyPermanentUpgrades } from '../content/permanentUpgrades.js';
import { OBJECTIVES } from '../content/objectives.js';
import { getMap, getMapBosses, getMapTier, MAP_ORDER, DEFAULT_MAP } from '../content/maps.js';
import { UISystem } from '../systems/UISystem.js';
import { GFX, LIGHT_COLORS } from '../config/GameConfig.js';
import { HazardSystem } from '../systems/HazardSystem.js';
import { MinigameOverlay } from '../systems/MinigameOverlay.js';
import { buildUIState } from '../systems/UIStateBuilder.js';
import { TOUR_STEPS } from '../content/tutorialTour.js';
import { getCardCompositor } from '../systems/CardCompositor.js';
import { EMBERGLASS, VICTORY_BEAT } from '../config/GameConfig.js';
import { PhotoModeMethods } from './PhotoModeController.js';   // photo mode split out; methods spliced onto the prototype below
import { RunStateMethods } from './RunState.js';           // run-state creation/reset split out; spliced onto the prototype below
import { GameUpdateMethods, gemLightColor } from './GameUpdate.js';   // gameplay update pipeline split out; spliced onto the prototype below (gemLightColor still used by render() here)
import { GameRenderMethods } from './GameRender.js';       // render pipeline split out; spliced onto the prototype below
import { CombatResolverMethods } from './CombatResolver.js';   // combat resolution + kill/drop flow split out; spliced onto the prototype below
import { GameInputActionMethods } from './GameInputActions.js';   // pointer/key/menu action routing split out; spliced onto the prototype below

const DEBUG_BUTTON_TOUCH_SLOP = 24;

export class Game {
    constructor({ renderer, input, loop }) {
        this.renderer = renderer;
        this.input = input;
        this.loop = loop;
        this.camera = new Camera();
        this.ui = new UISystem({ renderer, loop });
        this.saveSystem = new SaveSystem();
        // MapRenderer lives outside _initRunState — its cached tile
        // pattern and per-chunk decoration tables are world-static,
        // so they survive restarts intact (no need to rebuild).
        this.mapRenderer = new MapRenderer();
        // Obstacles are deterministic per biome; generate a default layout now
        // and re-theme to the selected biome at run start (tracked by
        // _obstacleBiome so we only regenerate when the biome actually changes).
        this.obstacleSystem = new ObstacleSystem();
        this.obstacleSystem.generate(WORLD_WIDTH, WORLD_HEIGHT);
        this._obstacleBiome = 'emberwood';
        // Lighting buffer + particle pool are also world-static / pooled,
        // so they live across runs (particles are cleared on run start).
        this.lighting = new LightingSystem();
        this.particles = new ParticleSystem();
        // Hazard sim + draw (stateless — the hazards array itself is run
        // state, created/reset in _initRunState).
        this.hazardSystem = new HazardSystem();
        // Procedural audio (synthesized; silent no-op when unsupported/headless).
        // Volumes seed from saved settings; the context resumes on first input.
        this.audio = new AudioSystem();
        this.audio.setVolumes(this.saveSystem.getSetting('volMusic'), this.saveSystem.getSetting('volSfx'));
        this.audio.playMusic('menu');
        // Adaptive graphics governor state. level 0 = full quality (roadmap #5).
        this._gfxLevel = 0;
        this._gfxLowTimer = 0;
        this._gfxHighTimer = 0;
        // T3 governor drop for damage numbers (ANDed with the user setting at the
        // render gate). Defaults off — matches tier 0.
        this._gfxDropDamageNumbers = false;
        // Per-map Emberlight veil multiplier (day≈0.5 … night=1.0). Set at run
        // start from the selected biome; folded into the governor's full-quality
        // strength so FPS recovery can't reset day/night feel. 1 = neutral.
        this.mapDarkness = 1;

        // Meta-progression flow: 'start' (title + shop) → 'gameplay' → 'gameOver'.
        // Boot lands on the start screen so the player can spend banked coins
        // before kicking off their first run.
        this.screen = 'start';
        this.resetConfirming = false;
        this.resetConfirmTimer = 0;

        // Main-menu state: active tab + transient case-opening animation +
        // a short-lived toast for claim/case feedback.
        this.menuTab = 'play';
        // Guided menu tour: { idx } while walking TOUR_STEPS, else null. While
        // active, _menuAction only honors tourNext/tourSkip — the tour is fully
        // guided. Armed on the first menu visit until save.onboarding.tourDone.
        this.menuTour = null;
        // Set by Settings' REPLAY TUTORIAL so the next run re-arms the in-run
        // hint pills even on a veteran save (consumed by _startRun).
        this._forceRunHints = false;
        // Transient pre-run "Trial" modifier selection (ids); never persisted.
        this.selectedModifiers = new Set();
        // Daily Road: when a run is launched via the DAILY ROAD menu button, this
        // is true and the run's map/Trials/starting-road are overridden by the
        // day's curated setup (getDailySetup). Session-local; never persisted. The
        // map override lives here so the accessor path (_effectiveMapId) can honor
        // it BEFORE _initRunState reads the map, without touching the saved pick.
        this.dailyMode = false;
        this._dailyMapOverride = null;
        this._dailySetup = null;
        // KINDLED PR5 — the daily hero-locked Rite Trial. Same session-local
        // discipline as dailyMode: a HERO + map override resolved BEFORE _initRunState,
        // never touching the saved pick (selectedCharacter). Mutually exclusive with
        // dailyMode.
        this.riteTrialMode = false;
        this._riteTrialHeroOverride = null;
        this._riteTrialMapOverride = null;
        this._riteTrialSetup = null;
        // BOSSFORGE — Boss Rush: a sequence of apex bosses with prep phases, using
        // the player's own hero + map pick (no override). Session-local flag,
        // mutually exclusive with dailyMode/riteTrialMode; the live controller
        // (this.bossRush) is built in _startRun and reset in _initRunState.
        this.bossRushMode = false;
        // Weekly Ember: the seeded weekly gauntlet — same controller/pipeline as
        // Boss Rush, but the boss order is a deterministic per-UTC-week shuffle
        // (same for everyone all week). Mutually exclusive with every other mode.
        this.weeklyEmberMode = false;
        // Pre-run Patron choice (id or null) — biases the level-up draft toward
        // that Patron's weapons/passives. Session-local (not persisted), chosen
        // on the Play tab; folded into committedPatrons at run start.
        this.selectedPatron = null;
        // Run-scale layer (difficulty × modifiers); set fresh each run start.
        this.runScale = { hp: 1, speed: 1, damage: 1, elite: 1, cap: 1, interval: 1 };
        this.runBonus = { xp: 0, coin: 0 };
        // Start-screen minigames (case-opening reel + the Mines coin gamble):
        // sim + overlay state live in MinigameOverlay (this.minigame.caseAnim /
        // .mines while one is open, null otherwise).
        this.minigame = new MinigameOverlay(this);
        this.menuToast = null;
        this.menuToastTimer = 0;

        // Transient "this control was just tapped" feedback for the UI to
        // render a brief press state. { id, age } or null.
        this.pressFx = null;

        // Screen-shake preference; loaded from save at run start. Defaulted
        // here so it's never undefined before the first run.
        this.shakeEnabled = this.saveSystem.getSetting('screenShake') !== false;

        this._initRunState();

        const touchPrimary = typeof window.matchMedia === 'function'
            ? window.matchMedia('(pointer: coarse)').matches
            : ('ontouchstart' in window || navigator.maxTouchPoints > 0);
        // Debug HUD is a dev aid only (?dev=1): without DEV_MODE it can never
        // switch on — not by default, not from a save's debug setting — so the
        // time-jump keys below stay out of reach of regular players.
        this.showDebug = DEV_MODE &&
            ((DEBUG_DEFAULT_ON && !touchPrimary) || this.saveSystem.getSetting('debug') === true);
        // Render-phase timing profiler (roadmap #4): times per-frame buckets so an
        // FPS drop is diagnosed from the debug HUD, not guessed. Handed to the loop
        // (which times the top-level update/render phases at their single call
        // sites); enabled only while the debug HUD shows, so it's free otherwise.
        this.profiler = new FrameProfiler();
        this.profiler.enabled = this.showDebug;
        if (this.loop) this.loop.profiler = this.profiler;
        // Performance/accessibility render flags (re-read at each run start).
        this.damageNumbersEnabled = this.saveSystem.getSetting('damageNumbers') !== false;
        this.particlesEnabled = this.saveSystem.getSetting('particles') !== false;
        this.reducedEffects = this.saveSystem.getSetting('reducedEffects') === true;

        window.addEventListener('keydown', (e) => {
            if (DEV_MODE && (e.code === 'Backquote' || e.code === 'F2')) {
                this.showDebug = !this.showDebug;
                this.profiler.enabled = this.showDebug;
                return;
            }
            // EMBERGLASS: the Keeper's Lens. While open, its own keys drive the
            // free-cam + toolbar (movement keys pan via getMovement); Space snaps,
            // G grid, H HUD, Q/E zoom, C/Esc exit.
            if (this.photoMode) {
                e.preventDefault();
                if (e.code === 'KeyC' || e.code === 'Escape') this._exitPhotoMode();
                else if (e.code === 'Space') this._snapPhoto();
                else if (e.code === 'KeyG') this.photoMode.gridOn = !this.photoMode.gridOn;
                else if (e.code === 'KeyH') this.photoMode.hudShown = !this.photoMode.hudShown;
                else if (e.code === 'KeyF') this._cyclePhotoFilter();
                else if (e.code === 'KeyQ') this._photoZoomBy(1 / EMBERGLASS.photo.zoomStep);
                else if (e.code === 'KeyE') this._photoZoomBy(EMBERGLASS.photo.zoomStep);
                if (this.photoMode) this.photoMode.toolbarFade = EMBERGLASS.photo.toolbarFade;
                return;
            }
            // KeyC enters photo mode from live gameplay/pause or to inspect a death.
            if (e.code === 'KeyC' && (this.screen === 'gameplay' || this.screen === 'gameOver')) {
                e.preventDefault();
                this._enterPhotoMode(this.screen === 'gameOver' ? 'gameOver' : (this.paused ? 'paused' : 'gameplay'));
                return;
            }
            if (this.screen === 'start') {
                // BOSSFORGE — dev shortcut: launch Boss Rush straight from the menu
                // (skips finding the CTA), gated by DEV_MODE like the other cheats.
                if (DEV_MODE && e.code === 'KeyG' && !this.minigame.mines && !this.minigame.caseAnim && !this.menuTour) {
                    e.preventDefault();
                    this.bossRushMode = true; this.dailyMode = false; this.riteTrialMode = false;
                    this._startRun();
                    return;
                }
                if (this.minigame.mines) {
                    if (e.code === 'Space' || e.code === 'Enter') {
                        e.preventDefault();
                        if (this.minigame.mines.stopped) this.minigame.dismissMines();
                        else this.minigame.minesCashOut();
                    }
                    return;
                }
                if (this.minigame.caseAnim) {
                    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); this.minigame.caseInput(); }
                    return;
                }
                if (e.code === 'Space' || e.code === 'Enter') {
                    e.preventDefault();
                    // While the guided tour is up, Space/Enter advances it
                    // (matching the NEXT button) instead of launching a run.
                    if (this.menuTour) { this._menuAction('tourNext', null); return; }
                    this.dailyMode = false; this.riteTrialMode = false; this.bossRushMode = false; this.weeklyEmberMode = false;   // keyboard start is always a NORMAL run
                    this._startRun();
                }
                return;
            }
            if (this.screen === 'gameOver') {
                if (e.code === 'KeyR' || e.code === 'Enter') {
                    e.preventDefault();
                    this.restart();
                } else if (e.code === 'KeyB' || e.code === 'Escape') {
                    e.preventDefault();
                    this.returnToShop();
                } else if (e.code === 'KeyS') {
                    e.preventDefault();
                    if (this.gameOverAge >= 0.7) this._shareMintedCard();
                }
                return;
            }
            if (this.victory) {
                // Ignore input during the victory beat (let the cheer land).
                if ((this.victory.age || 0) < VICTORY_BEAT) { e.preventDefault(); return; }
                if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); this.victoryContinue(); }
                else if (e.code === 'KeyB') { e.preventDefault(); this.victoryToMenu(true); }
                else if (e.code === 'KeyM' || e.code === 'Escape') { e.preventDefault(); this.victoryToMenu(false); }
                else if (e.code === 'KeyS') { e.preventDefault(); this._shareMintedCard(); }
                return;
            }
            // Debug-only time-jump (NOT a player feature): with the debug
            // overlay on, ] skips +60s and \ skips +300s so 5/10/20/30-min
            // balance can be tested quickly. Gated by DEV_MODE (showDebug can
            // only be true under it, but belt-and-braces) + live play.
            if (DEV_MODE && this.showDebug && this.screen === 'gameplay' && !this.paused &&
                !this.chestReward && !this.upgradeChoices && !this.altar) {
                if (e.code === 'BracketRight') { e.preventDefault(); this._debugSkipTime(60); return; }
                if (e.code === 'Backslash') { e.preventDefault(); this._debugSkipTime(300); return; }
                // Discrete jump-to-minute keys (7/8/9/0 → 5/10/20/30 min) so a
                // specific point on the difficulty curve is one keypress away.
                if (e.code === 'Digit7' || e.code === 'Numpad7') { e.preventDefault(); this._debugJumpToMinute(5); return; }
                if (e.code === 'Digit8' || e.code === 'Numpad8') { e.preventDefault(); this._debugJumpToMinute(10); return; }
                if (e.code === 'Digit9' || e.code === 'Numpad9') { e.preventDefault(); this._debugJumpToMinute(20); return; }
                if (e.code === 'Digit0' || e.code === 'Numpad0') { e.preventDefault(); this._debugJumpToMinute(30); return; }
                // KINDLED: grant +50 Kindle so the meter / (PR3) ult path can be
                // tested without grinding kills.
                if (e.code === 'KeyK') { e.preventDefault(); this.kindleSystem.debugGrant(50); return; }
                // BOSSFORGE — Boss Rush test shortcuts (only in a Boss Rush run):
                // N = skip to the next boss (drop the active boss to 1 HP so the
                // next auto-shot kills it → advances; in prep, skip the countdown);
                // H = force the active boss to ~3% HP; J = finish the whole gauntlet.
                if (this.bossRush) {
                    if (e.code === 'KeyN') { e.preventDefault(); this._debugBossRushNext(); return; }
                    if (e.code === 'KeyH') { e.preventDefault(); this._debugBossRushLowHp(); return; }
                    if (e.code === 'KeyJ') { e.preventDefault(); this._debugBossRushFinish(); return; }
                }
            }
            // Pause toggle — gameplay only, never while a level-up/chest
            // overlay is up (those already freeze the world).
            if (!this.chestReward && !this.upgradeChoices && !this.altar &&
                (e.code === 'KeyP' || e.code === 'Escape')) {
                e.preventDefault();
                this.togglePause();
                return;
            }
            if (this.paused) return; // swallow other keys while paused
            // KINDLED — aimed blink (Space): the universal dodge verb, live from
            // run 1. Blocked behind the same pick-one overlays as pause (those
            // freeze the world); reaches here only in live gameplay.
            if (e.code === 'Space' && !this.chestReward && !this.upgradeChoices && !this.altar) {
                e.preventDefault();
                this._tryBlink();
                return;
            }
            // KINDLED Focus targeting: Tab cycles the lock (nearest → elite →
            // boss → clear). Edge-only (e.repeat guard) — a held Tab fires the DOM
            // keydown continuously and would spin through every stage in a frame.
            if (e.code === 'Tab' && !this.chestReward && !this.upgradeChoices && !this.altar) {
                e.preventDefault();
                if (!e.repeat) this._cycleFocusTarget();
                return;
            }
            if (this.chestReward) {
                if (e.code === 'Space' || e.code === 'Enter') {
                    e.preventDefault();
                    this._dismissChestReward();
                }
                return;
            }
            if (this.altar) {
                if (e.code === 'Digit1' || e.code === 'Numpad1') { e.preventDefault(); this.selectAltar(0); }
                else if (e.code === 'Digit2' || e.code === 'Numpad2') { e.preventDefault(); this.selectAltar(1); }
                else if (e.code === 'Digit3' || e.code === 'Numpad3') { e.preventDefault(); this.selectAltar(2); }
                return;
            }
            if (this.upgradeChoices) {
                if (e.code === 'Digit1' || e.code === 'Numpad1') {
                    e.preventDefault();
                    this.selectUpgrade(0);
                } else if (e.code === 'Digit2' || e.code === 'Numpad2') {
                    e.preventDefault();
                    this.selectUpgrade(1);
                } else if (e.code === 'Digit3' || e.code === 'Numpad3') {
                    e.preventDefault();
                    this.selectUpgrade(2);
                } else if (e.code === 'KeyR') {
                    e.preventDefault();
                    this.rerollChoices();
                } else if (e.code === 'KeyA') {
                    e.preventDefault();
                    this.alterChoices();
                }
            }
        });

        const tryToggleDebugAt = (clientX, clientY) => {
            // The DBG hotspot only exists in DEV_MODE (UISystem skips drawing
            // the button too), so players can't tap the debug HUD on.
            if (!DEV_MODE) return false;
            const pos = this.renderer.clientToInternal(clientX, clientY);
            const r = this.ui.getDebugButtonRect();
            const slop = DEBUG_BUTTON_TOUCH_SLOP;
            if (
                pos.x >= r.x - slop &&
                pos.x <= r.x + r.w + slop &&
                pos.y >= r.y - slop &&
                pos.y <= r.y + r.h + slop
            ) {
                this._pressFeedback('dbg');
                this.showDebug = !this.showDebug;
                this.profiler.enabled = this.showDebug;
                // The DBG toggle doesn't run _updateJoystickEnabled (unlike pause),
                // so drop any touch-button tap this same press latched — otherwise
                // TouchButtons' right-half claim would leak a Focus lock/clear
                // alongside the debug toggle (DEV_MODE only).
                if (this.input.buttons) this.input.buttons.reset();
                return true;
            }
            return false;
        };

        const inRect = (pos, r, slop = 20) =>
            pos.x >= r.x - slop && pos.x <= r.x + r.w + slop &&
            pos.y >= r.y - slop && pos.y <= r.y + r.h + slop;

        const tryPickUpgradeAt = (clientX, clientY) => {
            if (!this.upgradeChoices) return false;
            const pos = this.renderer.clientToInternal(clientX, clientY);
            const rects = this.ui.getLevelUpCardRects(this.upgradeChoices.length);
            // Cards are hit-tested FIRST so a card tap always wins over the
            // reroll button even where their zones meet near a large bottom
            // safe-area inset.
            for (let i = 0; i < rects.length; i++) {
                const r = rects[i];
                const card = this.upgradeChoices[i];
                // Per-card banish button — not offered on bonus/fallback
                // cards (they can't be meaningfully banished and doing so
                // would just waste the charge).
                if (this.banishes > 0 && card && card.kind !== 'fallback') {
                    const b = this.ui.getBanishButtonRect(r);
                    if (inRect(pos, b, 0)) { this._pressFeedback('banish'); this.banishChoice(i); return true; }
                }
                if (
                    pos.x >= r.x &&
                    pos.x <= r.x + r.w &&
                    pos.y >= r.y &&
                    pos.y <= r.y + r.h
                ) {
                    this.selectUpgrade(i);
                    return true;
                }
            }
            // Reroll + Alter buttons last, with exact bounds (no slop) so they
            // can't steal taps from the bottom edge of the cards. When both are
            // available they share the row as a centered pair.
            const paired = this.rerolls > 0 && this.alters > 0;
            if (this.rerolls > 0) {
                const rr = this.ui.getRerollButtonRect(paired);
                if (inRect(pos, rr, 0)) { this._pressFeedback('reroll'); this.rerollChoices(); return true; }
            }
            if (this.alters > 0) {
                const ar = this.ui.getAlterButtonRect(paired);
                if (inRect(pos, ar, 0)) { this._pressFeedback('alter'); this.alterChoices(); return true; }
            }
            return true;
        };

        // Wick Shrine altar overlay — pick one relic card (mirrors the level-up
        // card hit-test). Consumes all taps while up so nothing bleeds through.
        const tryPickAltarAt = (clientX, clientY) => {
            if (!this.altar) return false;
            const pos = this.renderer.clientToInternal(clientX, clientY);
            const rects = this.ui.getLevelUpCardRects(this.altar.choices.length);
            for (let i = 0; i < rects.length; i++) {
                const r = rects[i];
                if (pos.x >= r.x && pos.x <= r.x + r.w && pos.y >= r.y && pos.y <= r.y + r.h) {
                    this._pressFeedback(`altar:${i}`);
                    this.selectAltar(i);
                    return true;
                }
            }
            return true; // consume taps while the overlay is up
        };

        // 3rd-boss victory overlay buttons.
        const tryVictoryAt = (clientX, clientY) => {
            if (!this.victory) return false;
            // Swallow taps during the victory beat so an early tap can't hit a
            // button that hasn't faded in yet.
            if ((this.victory.age || 0) < VICTORY_BEAT) return true;
            const pos = this.renderer.clientToInternal(clientX, clientY);
            const r = this._victoryRects();
            if (inRect(pos, r.cont, 0)) { this._pressFeedback('vContinue'); this.victoryContinue(); return true; }
            if (inRect(pos, r.biome, 0)) { this._pressFeedback('vBiome'); this.victoryToMenu(true); return true; }
            if (inRect(pos, r.menu, 0)) { this._pressFeedback('vMenu'); this.victoryToMenu(false); return true; }
            if (r.share && this.mintedCard && inRect(pos, r.share, 0)) { this._shareMintedCard(); return true; }
            return true; // consume all taps while the overlay is up
        };

        // Pause overlay buttons (resume / restart / shop / shake toggle).
        const tryPauseOverlayAt = (clientX, clientY) => {
            if (!this.paused) return false;
            const pos = this.renderer.clientToInternal(clientX, clientY);
            // Exact bounds (no slop): these stacked buttons are large and
            // adjacent, so slop padding would let an edge tap fire the wrong
            // (destructive) action.
            if (inRect(pos, this.ui.getResumeButtonRect(), 0)) { this._pressFeedback('resume'); this.togglePause(); return true; }
            if (inRect(pos, this.ui.getPauseRestartRect(), 0)) { this._pressFeedback('restart'); this.restart(); return true; }
            if (inRect(pos, this.ui.getPauseShopRect(), 0)) { this._pressFeedback('returnShop'); this.returnToShop(); return true; }
            if (inRect(pos, this.ui.getShakeToggleRect(), 0)) { this._pressFeedback('shake'); this.toggleScreenShake(); return true; }
            if (inRect(pos, this.ui.getPauseLensRect(), 0)) { this._pressFeedback('lens'); this._enterPhotoMode('paused'); return true; }
            return true; // consume all taps while paused
        };

        // The little HUD pause button (gameplay, no overlay). Exact bounds so
        // its zone can't bleed into the adjacent DBG button's touch slop.
        const tryPauseButtonAt = (clientX, clientY) => {
            const pos = this.renderer.clientToInternal(clientX, clientY);
            if (inRect(pos, this.ui.getPauseButtonRect(), 0)) { this._pressFeedback('pause'); this.togglePause(); return true; }
            return false;
        };

        const tryRestartAt = (clientX, clientY) => {
            if (this.screen !== 'gameOver') return false;
            // Debounce: the buttons only fade in from age 0.7 (UISystem), so a
            // tap still falling on the death moment can't instantly restart /
            // leave before the player has even seen the summary. Taps are
            // consumed (not passed through) so nothing behind the overlay fires.
            if (this.gameOverAge < 0.7) return true;
            const pos = this.renderer.clientToInternal(clientX, clientY);
            const rRestart = this.ui.getRestartButtonRect();
            if (inRect(pos, rRestart)) { this._pressFeedback('restart'); this.restart(); return true; }
            const rShop = this.ui.getReturnToShopButtonRect();
            if (rShop && inRect(pos, rShop)) { this._pressFeedback('returnShop'); this.returnToShop(); return true; }
            const rShare = this.ui.getShareCardButtonRect();
            if (rShare && this.mintedCard && inRect(pos, rShare)) { this._shareMintedCard(); return true; }
            return true;
        };

        const tryStartScreenAt = (clientX, clientY) => {
            if (this.screen !== 'start') return false;
            // The Mines mini-game owns input while it's up.
            if (this.minigame.mines) {
                const pos = this.renderer.clientToInternal(clientX, clientY);
                if (this.minigame.mines.stopped) { this.minigame.dismissMines(); return true; }
                if (inRect(pos, this.minigame.minesCashRect(), 0)) { this.minigame.minesCashOut(); return true; }
                const tiles = this.minigame.minesTileRects();
                for (let i = 0; i < tiles.length; i++) {
                    if (inRect(pos, tiles[i], 0)) { this.minigame.minesReveal(i); return true; }
                }
                return true; // consume taps while the board is up
            }
            // The case-opening overlay owns input: a tap FAST-FORWARDS to the
            // reveal while spinning, or dismisses once the reward is shown.
            if (this.minigame.caseAnim) { this.minigame.caseInput(); return true; }
            const pos = this.renderer.clientToInternal(clientX, clientY);
            // Dispatch against the menu's clickable regions (topmost wins).
            const hs = this.ui.menu.hotspots;
            for (let i = hs.length - 1; i >= 0; i--) {
                const r = hs[i];
                if (inRect(pos, r, 0)) { this._menuAction(r.action, r.arg); return true; }
            }
            return true;
        };

        this.renderer.canvas.addEventListener('touchstart', (e) => {
            // EMBERGLASS Lens owns all touches while open (drag pans / toolbar).
            if (this.photoMode) {
                e.preventDefault();
                for (const t of e.changedTouches) { this._tryPhotoAt(t.clientX, t.clientY, 'down'); break; }
                return;
            }
            // Any tap dismisses the chest overlay — checked first so a stray
            // tap on the DBG/joystick zone can't slip through.
            if (this.chestReward) {
                this._dismissChestReward();
                return;
            }
            for (const t of e.changedTouches) {
                if (this.screen === 'start') {
                    if (tryStartScreenAt(t.clientX, t.clientY)) return;
                } else if (this.screen === 'gameOver') {
                    if (tryRestartAt(t.clientX, t.clientY)) return;
                } else if (this.victory) {
                    if (tryVictoryAt(t.clientX, t.clientY)) return;
                } else if (this.upgradeChoices) {
                    if (tryPickUpgradeAt(t.clientX, t.clientY)) return;
                } else if (this.altar) {
                    if (tryPickAltarAt(t.clientX, t.clientY)) return;
                } else if (this.paused) {
                    if (tryPauseOverlayAt(t.clientX, t.clientY)) return;
                } else {
                    if (tryPauseButtonAt(t.clientX, t.clientY)) return;
                    if (tryToggleDebugAt(t.clientX, t.clientY)) return;
                }
            }
        }, { passive: false });

        this.renderer.canvas.addEventListener('mousedown', (e) => {
            if (this.photoMode) { this._tryPhotoAt(e.clientX, e.clientY, 'down'); return; }
            if (this.chestReward) {
                this._dismissChestReward();
                return;
            }
            if (this.screen === 'start') {
                tryStartScreenAt(e.clientX, e.clientY);
            } else if (this.screen === 'gameOver') {
                tryRestartAt(e.clientX, e.clientY);
            } else if (this.victory) {
                tryVictoryAt(e.clientX, e.clientY);
            } else if (this.upgradeChoices) {
                tryPickUpgradeAt(e.clientX, e.clientY);
            } else if (this.altar) {
                tryPickAltarAt(e.clientX, e.clientY);
            } else if (this.paused) {
                tryPauseOverlayAt(e.clientX, e.clientY);
            } else {
                if (!tryPauseButtonAt(e.clientX, e.clientY)) {
                    tryToggleDebugAt(e.clientX, e.clientY);
                }
            }
        });

        // EMBERGLASS Lens: drag-to-pan (mouse + one finger) and wheel zoom. All
        // gated to photo mode so they never interfere with normal play.
        this.renderer.canvas.addEventListener('mousemove', (e) => {
            if (this.photoMode && this._dragPhotoPrev) this._tryPhotoAt(e.clientX, e.clientY, 'move');
        });
        window.addEventListener('mouseup', () => { if (this.photoMode) this._tryPhotoAt(0, 0, 'up'); });
        this.renderer.canvas.addEventListener('touchmove', (e) => {
            if (!this.photoMode) return;
            e.preventDefault();
            const t = e.changedTouches[0];
            if (t) this._tryPhotoAt(t.clientX, t.clientY, 'move');
        }, { passive: false });
        this.renderer.canvas.addEventListener('touchend', (e) => {
            if (this.photoMode) { e.preventDefault(); this._tryPhotoAt(0, 0, 'up'); }
        }, { passive: false });
        this.renderer.canvas.addEventListener('wheel', (e) => {
            if (!this.photoMode) return;
            e.preventDefault();
            this._photoZoomBy(e.deltaY < 0 ? EMBERGLASS.photo.zoomStep : 1 / EMBERGLASS.photo.zoomStep);
        }, { passive: false });

        // Auto-pause when the tab/window loses focus so a backgrounded run
        // can't take unfair damage (the loop keeps stepping otherwise).
        const autoPause = () => {
            if (this.screen === 'gameplay' && !this.gameOver &&
                !this.upgradeChoices && !this.chestReward && !this.altar && !this.paused) {
                this.paused = true;
                this._updateJoystickEnabled();
            }
        };
        window.addEventListener('blur', autoPause);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) autoPause();
        });

        // ── First-run onboarding: a brand-new save (zero recorded runs) skips
        // the tabbed menu entirely and drops straight into a guided first run —
        // _startRun arms the contextual hint sequence (see _tickOnboarding).
        // The menu waits until the first death, when its tabs unlock staged
        // (MenuRenderer). ?skipOnboarding=1 keeps harness/CI shots on the menu.
        if (!SKIP_ONBOARDING && (this.saveSystem.data.stats?.runs ?? 0) === 0) {
            this._startRun();
        } else if (!SKIP_ONBOARDING && !this.saveSystem.isTourDone()) {
            // Booting onto the menu with the guided tour still owed (e.g. the
            // player closed the game right after their first run) → resume it.
            this._armMenuTour();
        }
        // Gate the touch controls to the boot screen: on a MENU boot this disables
        // (and clears) the touch buttons + joystick, so a menu tap can't latch a
        // blink/focus that then fires on the first gameplay frame. A gameplay boot
        // (brand-new save → _startRun above) already re-enabled them.
        this._updateJoystickEnabled();
    }

    // The effective map id for THIS run: the Daily Road override (unlock-bypassed,
    // so the day's map is force-allowed and truly the same for everyone) or, for a
    // normal run, the saved pick. Read everywhere the launch path resolves the map
    // so the override lands before _initRunState builds the BossDirector/tier.
    _effectiveMapId() {
        if (this.dailyMode && this._dailyMapOverride) return this._dailyMapOverride;
        if (this.riteTrialMode && this._riteTrialMapOverride) return this._riteTrialMapOverride;
        return this.saveSystem.getSelectedMap();
    }

    // KINDLED PR5 — the run's effective HERO id: the Rite-Trial daily override
    // (session-local, never persisted) or the saved pick. Read at every run-build
    // site so the locked trial hero flows through Player / _heroId / attunement /
    // share card WITHOUT mutating selectedCharacter.
    _effectiveCharacterId() {
        if (this.riteTrialMode && this._riteTrialHeroOverride) return this._riteTrialHeroOverride;
        return this.saveSystem.getSelectedCharacter();
    }

    // _startRun resets the run and applies permanent upgrades from save —
    // the canonical "begin a fresh game" entry point. Used by the START RUN
    // shop button AND the RESTART game-over button.
    _startRun() {
        // Daily Road: resolve the day's curated setup BEFORE _initRunState reads the
        // map (BossDirector/tier). Overrides map + Trials locally; the forced road is
        // applied at the end of _startRun. Never touches the persisted selections.
        if (this.dailyMode) {
            this._dailySetup = getDailySetup(currentDayNumber());
            this._dailyMapOverride = this._dailySetup.mapId;
            this.selectedModifiers = new Set(this._dailySetup.modifierIds);
        } else if (this.riteTrialMode) {
            // KINDLED PR5 — the daily hero-locked Rite Trial: a deterministic HERO +
            // map + one Trial modifier (salt 0x4b494e44). The hero override is
            // resolved HERE so _initRunState's Player/_heroId read the trial hero,
            // without ever mutating the saved selectedCharacter.
            this._riteTrialSetup = getRiteTrialSetup(currentDayNumber());
            this._riteTrialHeroOverride = this._riteTrialSetup.heroId;
            this._riteTrialMapOverride = this._riteTrialSetup.mapId;
            this.selectedModifiers = new Set(this._riteTrialSetup.modifierIds);
        } else {
            this._dailySetup = null;
            this._dailyMapOverride = null;
            this._riteTrialSetup = null;
            this._riteTrialHeroOverride = null;
            this._riteTrialMapOverride = null;
        }
        // The gauntlet modes resolve their boss sequence from a mode config —
        // Boss Rush is the fixed apex order; Weekly Ember is the same roster in a
        // deterministic per-UTC-week shuffle. Both use the player's OWN hero +
        // map (no override), so — unlike daily/rite — nothing needs resolving
        // before _initRunState; the controller is built right after, once the
        // run arrays exist.
        this._bossRushConfig = this.weeklyEmberMode ? getWeeklyEmberConfig(currentDayNumber())
            : this.bossRushMode ? BOSS_RUSH_CONFIG
            : null;
        this._initRunState();
        if (this._bossRushConfig) {
            this.bossRush = new BossRushController(getBossRushSequence(this._bossRushConfig), this._bossRushConfig);
        }
        // Character base stats apply FIRST so permanent upgrades / gear /
        // passives / run upgrades all stack cleanly on top of the hero's
        // baseline (and the sprite already matches the selected character).
        applyCharacter(this.player, this._effectiveCharacterId());
        const coinsBefore = this.player.coins ?? 0;
        applyPermanentUpgrades(this.player, this.saveSystem.data);
        // Relic Attunement (coin sink): fold in every saved attunement level ONCE,
        // right after permanent upgrades — they're the same class of meta bonus
        // (defensive/utility only, no raw weapon damage; see relics.js ATTUNABLE).
        applyAttunements(this.player, this.saveSystem.getRelicAttunements());
        // KINDLED PR5 — Hero Attunement's ult + focused-target DAMAGE multipliers
        // (Lv3/Lv4) stamped onto the player fields signatures.js reads. Kindle-gain /
        // blink-CD / ult-cost (Lv1/2/5) live on the KindleSystem instance (built in
        // _initRunState). Keyed by the run's effective hero (_heroId).
        applyHeroAttunement(this.player, this.saveSystem.getHeroAttunement(this._heroId));
        // Loadout gear buffs stack ON TOP of permanent upgrades (applied after
        // so multipliers compound). Cosmetics drive the player's appearance.
        applyLoadout(this.player, this.saveSystem.data);
        this.player.appearance = resolveAppearance(this.saveSystem.getEquippedCosmetics());
        // Weapon-themed skin overlay + melee-swing flag from the selected
        // starting weapon (visual identity only — see content/weaponSkins.js).
        const startWeaponId = resolveStartingWeapon(this.saveSystem.data);
        this.player.weaponSkin = resolveWeaponSkin(startWeaponId);
        this.playerSwingMelee = isMeleeWeapon(startWeaponId);
        this._swingCd = 0;
        // Lock in the pre-run Patron choice for this run (PR1: a single starting
        // Patron; later milestones can append a 2nd/3rd to committedPatrons).
        this.committedPatrons = this.selectedPatron ? [this.selectedPatron] : [];
        // ── Difficulty + run modifiers ("Trials") ──────────────────────────
        // Fold the chosen difficulty tier and any active run modifiers into a
        // single wave-scale layer (applied to waveState each frame) + apply the
        // player-side mods now (after character/loadout so they compound). The
        // XP/coin bonus rewards the extra challenge and is capped.
        // Daily Road forces NORMAL for a fair shared board — LOCAL only, never
        // persisted (do not call setDifficulty / write saveSystem.data.difficulty).
        this.difficulty = this.dailyMode ? 'normal' : this.saveSystem.getDifficulty();
        const diff = DIFFICULTY[this.difficulty] || DIFFICULTY.normal;
        const mods = RUN_MODIFIERS.filter((m) => this.selectedModifiers.has(m.id));
        this.activeModifiers = mods;
        let hp = diff.hp, speed = diff.speed, damage = diff.damage, elite = diff.elite, cap = 1, interval = 1;
        let pDamage = 1, pPickup = 1, pIncoming = 1, xpBonus = diff.xpBonus || 0, coinBonus = 0;
        for (const m of mods) {
            if (m.hp) hp *= m.hp;
            if (m.speed) speed *= m.speed;
            if (m.damage) damage *= m.damage;
            if (m.elite) elite *= m.elite;
            if (m.cap) cap *= m.cap;
            if (m.interval) interval *= m.interval;
            if (m.playerDamage) pDamage *= m.playerDamage;
            if (m.playerPickup) pPickup *= m.playerPickup;
            if (m.playerIncoming) pIncoming *= m.playerIncoming;
            xpBonus += m.xpBonus || 0;
            coinBonus += m.coinBonus || 0;
        }
        this.runScale = { hp, speed, damage, elite, cap, interval };
        // Per-map difficulty rung: later maps' TRASH is a little tougher too, so
        // the whole map (not just its bosses) ramps. Kept MILD — the boss tier
        // (mapHpMul in _spawnBoss) is the dominant step. tier 1→4: hp +0/12/24/36%.
        const _mt = getMapTier(this._effectiveMapId());
        if (_mt > 1) {
            this.runScale.hp *= 1 + (_mt - 1) * 0.12;
            this.runScale.damage *= 1 + (_mt - 1) * 0.08;
            this.runScale.speed *= 1 + (_mt - 1) * 0.03;
        }
        this.runBonus = {
            xp: Math.min(xpBonus, RUN_MODIFIER_MAX_BONUS + (diff.xpBonus || 0)),
            coin: Math.min(coinBonus, RUN_MODIFIER_MAX_BONUS),
        };
        // Apply player-side modifiers (compose onto loadout/character values).
        this.player.damageMul = (this.player.damageMul ?? 1) * pDamage;
        this.player.pickupRange *= pPickup;
        this.player.damageTakenMul = (this.player.damageTakenMul ?? 1) * pIncoming;
        // Remember how many coins the shop handed us so _bankRunCoins can
        // withhold the granted seed from an instantly-abandoned run.
        this.startingCoinsGranted = Math.max(0, (this.player.coins ?? 0) - coinsBefore);
        // Level-up agency resources: 1 free reroll baseline so the feature
        // is discoverable, plus whatever the shop granted onto the player.
        this.rerolls = 1 + (this.player.rerolls ?? 0);
        this.banishes = this.player.banishes ?? 0;
        // 1 free Alter baseline (re-roll favoring your off-Patron options).
        this.alters = 1 + (this.player.alters ?? 0);
        // Screen-shake preference (accessibility) read from the save.
        this.shakeEnabled = this.saveSystem.getSetting('screenShake') !== false;
        // Performance / accessibility toggles read once per run.
        this.damageNumbersEnabled = this.saveSystem.getSetting('damageNumbers') !== false;
        this.particlesEnabled = this.saveSystem.getSetting('particles') !== false;
        this.reducedEffects = this.saveSystem.getSetting('reducedEffects') === true;
        // Re-sync every adaptive-quality knob to the persisted governor tier +
        // the reducedEffects setting (roadmap #5). The tier survives across runs
        // with _gfxLevel, so a restart on a slow device keeps its reductions
        // (shadows/weather/lights/particles/DPR/damage-numbers) consistent rather
        // than snapping back to full for a frame until the governor re-fires.
        this._applyGfxLevel();
        // Reduced-effects silences the weapon-skin overlay's additive glow too
        // (mirrors the weaponAura gate). Read here so a mid-session toggle wins.
        this.player.skinOverlayEnabled = !this.reducedEffects;
        // Apply the selected biome's color grade + per-map darkness for this run.
        const biome = getMap(this._effectiveMapId());
        this.mapRenderer.theme = biome;
        // Remember the untinted biome so a Branching Roads re-tint can revert to it
        // at the next boss (roads spread onto a NEW theme object, never mutate this).
        this._baseBiomeTheme = biome;
        // Daily Road: apply the day's FORCED starting road now — after the player is
        // fully built (character/upgrades/loadout) and _baseBiomeTheme is set (for the
        // re-tint). Identical to a crossroads pick (roadToChoice.apply): it seeds the
        // opening segment bias, which _clearSegmentRoad clears at the first boss; the
        // permanent boon persists. Post-boss the player gets normal crossroads picks.
        if (this.dailyMode && this._dailySetup?.roadId) {
            const r = getRoad(this._dailySetup.roadId);
            if (r) { r.apply(this); this._segmentRoadId = this._dailySetup.roadId; }
        }
        // Regenerate the world's obstacles/buildings themed to this biome (each
        // biome is a distinct, deterministic layout with its own prop set,
        // colour tint, and building styles). Cheap + seeded, so same biome →
        // same world every run.
        if (this._obstacleBiome !== biome.id) {
            this.obstacleSystem.generate(WORLD_WIDTH, WORLD_HEIGHT, biome.id);
            this._obstacleBiome = biome.id;
        }
        // Per-map darkness multiplier on the Emberlight veil (day ≈ 0.5 bright,
        // night = 1.0 darkest). Routed through the governor below so an FPS
        // quality change can't reset it back to the global strength.
        this.mapDarkness = biome.darkness ?? 1;
        if (this.lighting && this.lighting.setQuality) {
            this.lighting.setQuality({ strength: GFX.darkness.strength * this.mapDarkness });
        }
        // P1.2 "Living Biomes": this map's persistent enemy-mix skew (weight
        // MULTIPLIERS folded into waveState by _applyRunScale; results cached
        // per wave index since both tables are static for the run) + its
        // signature ground hazard, spawned on a cadence by
        // HazardSystem.updateBiome into the shared hazard pool.
        this._mapMix = biome.enemyMix ?? null;
        this._mapMixCache = {};
        this.biomeHazard = biome.hazard ? { kind: biome.hazard, timer: BIOME_HAZARD.firstDelay } : null;
        // Crypts gloom pools: 0..1 player-light squeeze, eased by HazardSystem
        // each frame and read by the render pass's player light.
        this.gloomT = 0;
        this._lastHp = this.player.hp;
        // First-run onboarding (armed for EVERY run until the first one is
        // recorded, so a mid-first-run restart re-teaches cleanly): a small
        // non-blocking hint sequence — move → auto-attack → shards → first
        // level-up pick — ticked by _tickOnboarding, drawn as a HUD pill by
        // UISystem. Never a modal wall; gameplay is untouched.
        this.onboarding = (!SKIP_ONBOARDING && !this._bossRushConfig
            && ((this.saveSystem.data.stats?.runs ?? 0) === 0 || this._forceRunHints))
            ? { step: 0, timer: 0, moved: 0, armed: true }
            : null;
        this._forceRunHints = false;   // Replay-Tutorial re-teach is one run only
        // BOSSFORGE — gauntlet head-start (Boss Rush + Weekly Ember): grant the
        // configured starting level-ups so the player drafts a real build BEFORE
        // the first apex. The level-up overlay freezes the world (and the
        // controller's prep timer with it), so the first boss can't land until
        // the picks are made. Applied last, after the player is fully built, so
        // level/xpToNext stay consistent.
        if (this._bossRushConfig) {
            const n = this._bossRushConfig.startingLevelUps || 0;
            if (n > 0) this.pendingLevelUps += this.player.grantLevels(n);
        }
        this.screen = 'gameplay';
        // Kick the driving gameplay theme (resume covers the keyboard-start path
        // where no menu tap fired yet).
        this.audio.resume();
        this.audio.setBiome(biome.id);   // recolour the gameplay theme per biome
        this.audio.playMusic('gameplay');
        // Reset the UI's per-run animation state (bar display values, boss
        // bar slide, etc.) so nothing carries over from the previous run.
        if (this.ui.beginRun) this.ui.beginRun(this.player);
        this._updateJoystickEnabled();
        // BOSSFORGE — open the first gauntlet head-start draft now (the world is
        // frozen while it's up). selectUpgrade chains the remaining picks, so the
        // player drafts their whole starting build before the opening prep runs.
        if (this._bossRushConfig && this.pendingLevelUps > 0 && !this.upgradeChoices) this._presentLevelUp();
    }

    restart() {
        // Leaving a live (paused) run still banks what was earned, matching
        // the death path. No-op once already banked this run.
        this._bankRunCoins();
        // A RESTART is a fresh NORMAL run — never silently re-launch a Daily/Trial.
        this.dailyMode = false; this.riteTrialMode = false; this.bossRushMode = false; this.weeklyEmberMode = false;
        this._startRun();
    }

    returnToShop() {
        this._bankRunCoins();
        this.audio.playMusic('menu');
        this.screen = 'start';
        this.resetConfirming = false;
        this.resetConfirmTimer = 0;
        this.paused = false;
        // Back at the menu, a Daily/Trial is over — clear the flags so the next
        // launch (button OR keyboard) is a normal run unless DAILY ROAD / RITE TRIAL
        // is chosen again.
        this.dailyMode = false; this.riteTrialMode = false; this.bossRushMode = false; this.weeklyEmberMode = false;
        // The guided menu tour fires on the first menu visit AFTER a recorded
        // run (right when the guided first run ends) and re-fires until
        // finished or skipped. The runs>=1 gate keeps a pause-quit of the very
        // first run from touring before the run lesson is even complete.
        if (!SKIP_ONBOARDING && !this.saveSystem.isTourDone()
            && (this.saveSystem.data.stats?.runs ?? 0) >= 1) this._armMenuTour();
        this._updateJoystickEnabled();
    }

    // ── Guided menu tour ─────────────────────────────────────────────────
    // Fully guided walk over TOUR_STEPS: each step focuses one tab (switching
    // to it + acknowledging its NEW badge, which is also what permanently
    // unlocks the staged menu). While active, only Next/Skip are honored.
    _armMenuTour() {
        this.menuTour = { idx: 0 };
        this._applyTourStep();
    }

    _applyTourStep() {
        const step = TOUR_STEPS[this.menuTour?.idx];
        if (!step) return;
        this.menuTab = step.tab;
        this.saveSystem.markTabSeen(step.tab);
    }

    _endMenuTour() {
        this.menuTour = null;
        this.saveSystem.setTourDone(true);
        this.menuTab = 'play';
    }

    // ── First-run onboarding (guided first run) ──────────────────────────
    // Teach moments for a brand-new save covering the WHOLE run loop: move →
    // auto-attack → shards → first level-up pick → coins → combo → shrines →
    // boss → send-off. Each step advances on its trigger, with a timeout so
    // the sequence can never wedge (a player who ignores a hint still moves
    // on). Step 3 (the level-up pick) is drawn inside the level-up overlay
    // itself and advances in selectUpgrade.
    _tickOnboarding(dt) {
        const ob = this.onboarding;
        if (!ob || this.gameOver) return;
        // Lesson-complete flash: hold the green ✓ banner for a beat before
        // moving on, so the player SEES that what they just did was the lesson.
        if (ob.done) {
            ob.doneTimer -= dt;
            this._tutorialTarget = null;   // stop pointing once the lesson lands
            if (ob.doneTimer <= 0) this._advanceOnboarding();
            return;
        }
        ob.timer += dt;
        // World-space pointer target for the current lesson — the HUD draws a
        // bouncing chevron over it so the hint points AT the thing it teaches.
        this._tutorialTarget = this._onboardingTarget();
        switch (ob.step) {
            case 0: {  // teach movement — advance once they've actually walked a bit
                const dx = this.player.x - (ob.px ?? this.player.x);
                const dy = this.player.y - (ob.py ?? this.player.y);
                ob.px = this.player.x; ob.py = this.player.y;
                ob.moved += Math.hypot(dx, dy);
                if (ob.moved > 140) this._completeOnboardingStep();
                else if (ob.timer > 10) this._advanceOnboarding();
                break;
            }
            case 1:    // the wand auto-fires — a beat to watch it happen
                if (ob.timer > 5) this._advanceOnboarding();
                break;
            case 2:    // XP shards — wait for one to exist so the hint points at something
                if (!ob.seenGem && this.gems.length > 0) { ob.seenGem = true; ob.timer = 0; }
                if ((ob.seenGem && ob.timer > 6) || this.player.level > 1) this._completeOnboardingStep();
                else if (ob.timer > 20) this._advanceOnboarding();
                break;
            case 3: break;  // waits on the first level-up pick (selectUpgrade advances)
            // Steps 4-7 hold a minimum 2.5s read time before their trigger can
            // advance them — a trigger that's ALREADY true at step entry (e.g.
            // coins seeded by the run-start-coins perk on a Replay-Tutorial run)
            // would otherwise flash the pill for a single frame.
            case 4:    // coins — advance once one is picked up (or read + move on)
                if (ob.timer > 2.5 && (this.player.coins ?? 0) > 0) this._completeOnboardingStep();
                else if (ob.timer > 10) this._advanceOnboarding();
                break;
            case 5:    // combo — advance on a real chain (or read + move on)
                if (ob.timer > 2.5 && this.combo >= 5) this._completeOnboardingStep();
                else if (ob.timer > 12) this._advanceOnboarding();
                break;
            case 6:    // shrines — the altar claim advances this (selectAltar path,
                       // mirroring selectUpgrade — the overlay gate hides this.altar
                       // from this tick), or read + move on.
                if (ob.timer > 18) this._advanceOnboarding();
                break;
            case 7:    // the boss — advance when the warning fires (or read + move on)
                if (ob.timer > 2.5 && this.bossWarning) this._completeOnboardingStep();
                else if (ob.timer > 20) this._advanceOnboarding();
                break;
            case 8:    // send-off — linger long enough to read, then done for good
                if (ob.timer > 7) this._advanceOnboarding();
                break;
            default: break;
        }
    }

    // The lesson's trigger fired: latch the ✓ state for a short beat (the
    // banner turns green) before _tickOnboarding advances. Timeouts skip this
    // — nothing was accomplished, so nothing flashes.
    _completeOnboardingStep() {
        const ob = this.onboarding;
        if (!ob || ob.done) return;
        ob.done = true;
        ob.doneTimer = 1.1;
    }

    _advanceOnboarding() {
        if (!this.onboarding) return;
        this.onboarding.step += 1;
        this.onboarding.timer = 0;
        this.onboarding.done = false;
        this._tutorialTarget = null;
        // Past the send-off → the guided run is complete.
        if (this.onboarding.step > 8) this.onboarding = null;
    }

    // World-space point the current lesson is ABOUT (nearest shard / coin /
    // shrine, the live boss), or null. Cheap scans over capped arrays, only
    // while the guided run is active.
    _onboardingTarget() {
        const ob = this.onboarding;
        if (!ob) return null;
        const nearest = (list) => {
            let best = null, bd = Infinity;
            for (const e of list) {
                if (e.active === false) continue;
                const d = (e.x - this.player.x) ** 2 + (e.y - this.player.y) ** 2;
                if (d < bd) { bd = d; best = e; }
            }
            return best ? { x: best.x, y: best.y } : null;
        };
        switch (ob.step) {
            case 2: return nearest(this.gems);
            case 4: return nearest(this.coins);
            case 6: return nearest(this.shrines);
            case 7: return this.activeBossRef ? { x: this.activeBossRef.x, y: this.activeBossRef.y } : null;
            default: return null;
        }
    }

    // The full tutorial-banner snapshot for the HUD: lesson number/total, the
    // hint text, and whether the ✓ done-flash is showing. Null when no banner
    // should draw (no tutorial, dead, or the step teaches inside an overlay).
    _onboardingLessonState() {
        const ob = this.onboarding;
        if (!ob || this.gameOver) return null;
        const text = this._onboardingHintText();
        // No banner unless there's a hint line — EXCEPT during the ✓ done-flash,
        // which shows "✓ Nice!" regardless (some steps, e.g. shards, have a
        // conditional hint that can be null the moment they complete).
        if (!text && !ob.done) return null;
        return { n: ob.step + 1, total: 9, text: text || '', done: !!ob.done };
    }

    // The active gameplay hint pill text (null when nothing should show).
    _onboardingHintText() {
        const ob = this.onboarding;
        if (!ob || this.gameOver) return null;
        // Two plain-language lines each (split on \n by the HUD banner), written
        // for someone new to games — every term is explained, not assumed.
        switch (ob.step) {
            case 0: return 'Move with the W A S D keys or the arrow keys (on a phone, drag the\nleft side of the screen). Enemies chase you — keep moving to stay safe.';
            case 1: return 'Your wand attacks all by itself — you never press a button to fight.\nJust concentrate on steering away from the enemies.';
            case 2: return ob.seenGem
                ? 'Defeated enemies drop glowing shards. Walk over them to pick them up —\nthey fill the bar at the bottom that leads to your next "level up".'
                : null;
            case 3: return null;  // rendered inside the level-up overlay
            case 4: return 'Tougher enemies drop coins. Coins are saved when the run ends, so you\ncan spend them back at base to get permanently stronger.';
            case 5: return 'Defeat several enemies quickly in a row to build a "combo" (a kill\nstreak). Longer streaks reward you with bonus coins.';
            case 6: return 'A glowing shrine can appear on the ground. Stand on it to choose a\n"relic" — a special power that lasts for the rest of this run.';
            case 7: return 'A "boss" is a big, powerful enemy. Stay alive until it appears and\ndefeat it. Beating three bosses clears the whole area.';
            case 8: return 'That\'s it: collect shards to level up, grab relics, and beat bosses.\nWhen your health runs out the run ends — then spend your coins. Good luck!';
            default: return null;
        }
    }

    // ── 3rd-boss victory overlay ─────────────────────────────────────────
    // Claim any newly-earned lifetime achievements + grant their coin rewards.
    // Names are stashed on the run summary so the game-over screen can flag
    // them; the Stats tab shows full locked/unlocked progress.
    _checkAchievements() {
        const earned = evaluateAchievements(this.saveSystem);
        if (!earned.length) return;
        let coins = 0; const names = []; const cosmeticNames = [];
        for (const a of earned) {
            if (this.saveSystem.claimAchievement(a.id)) {
                coins += a.coins || 0; names.push(a.name);
                // Some achievements also award a cosmetic — unlock it now (it
                // persists), so it appears unlocked in the customizer/shop.
                for (const cid of cosmeticsForAchievement(a.id)) {
                    if (this.saveSystem.unlockCosmetic(cid) && COSMETICS[cid]) cosmeticNames.push(COSMETICS[cid].name);
                }
            }
        }
        if (coins > 0) this.saveSystem.addCoins(coins);
        this.newAchievements = names;
        if (cosmeticNames.length && this.audio) this.audio.cosmeticReward();
        if (this.runSummary) {
            this.runSummary.achievements = names;
            // One gentle chime however many unlocked — sits politely under
            // the game-over stinger.
            if (names.length) this.audio.achievementChime();
            if (cosmeticNames.length) this.runSummary.cosmeticUnlocks = cosmeticNames;
        }
    }

    // Evaluate today's three daily challenges against this run's summary and
    // claim+pay any newly completed. Like achievements, names are stashed on
    // the summary so the game-over screen can flag them; the Play tab's daily
    // strip shows full per-day progress.
    _checkDailyChallenges() {
        if (!this.runSummary) return;
        const day = currentDayNumber();
        const state = this.saveSystem.getDailyState(day);
        const done = evaluateDaily(day, this.runSummary, state.completed);
        if (!done.length) return;
        let coins = 0; const names = [];
        for (const c of done) {
            if (this.saveSystem.markDailyComplete(day, c.id)) { coins += c.coins || 0; names.push(c.name); }
        }
        if (coins > 0) this.saveSystem.addCoins(coins);
        this.newDailies = names;
        if (this.runSummary) this.runSummary.dailies = names;
    }

    _showVictory() {
        this.victory = { age: 0 };
        // EMBERGLASS: queue the victory recap card from LIVE fields (runSummary
        // doesn't exist yet — it's built later in victoryToMenu). Composed on the
        // next render() before the overlay dims the world.
        this._queueVictoryCard();
        if (this.player) this.player.poseOverride = 'victory';   // hero cheers
        // Swell into the triumphant victory theme + a fanfare stinger.
        this.audio.playMusic('victory');
        this.audio.victoryFanfare();
        this.audio.setIntensity(0.4);
        // A 3rd-boss clear on Nightmare is a bragging milestone.
        if (this.difficulty === 'hard') this.saveSystem.incrementStat('hardWins', 1);
        this._checkPactMastery();
        this._updateJoystickEnabled();
    }

    // Pact Mastery: a 3-boss CLEAR at a Pact tier (= active-Trial count) pushes
    // this character's mastery ladder. Each NEW notch pays a one-time coin
    // bounty. A no-curse clear (tier 0) earns nothing here (recordPactClear
    // guards tier<=0), so the ladder only rewards clearing WITH curses on.
    _checkPactMastery() {
        const tier = (this.activeModifiers ?? []).length;
        if (tier <= 0) return;
        // KINDLED PR5 — credit the hero actually PLAYED (a Rite Trial forces a
        // session-local hero override), not the saved menu pick, so a trial clear
        // advances the trial hero's ladder + pays its bounty (not the menu hero's).
        const char = this._effectiveCharacterId();
        const steps = this.saveSystem.recordPactClear(char, tier);
        if (steps > 0) {
            const bounty = steps * 80;
            this.saveSystem.addCoins(bounty);
            this.pactBounty = { tier, coins: bounty };
            this.waveDirector?.announce?.(`✦ PACT ${tier} CLEARED  +${bounty} ✦`);
        }
    }

    // Continue the same run (keep the gauntlet going past 3 bosses). From here
    // on the run is scored as a Gauntlet (endless) — banked on the next death.
    victoryContinue() {
        // BOSSFORGE — a cleared gauntlet (Boss Rush / Weekly Ember) has no endless
        // continue (the boss sequence is exhausted and the trash spawner is off,
        // so "continue" would drop the player into an empty world). Bank + return
        // to the menu instead.
        if (this.bossRush) { this.victoryToMenu(false); return; }
        this.victory = null;
        this.shareToast = null;   // don't carry a victory share toast into the gauntlet
        this._gauntletActive = true;
        this.audio.click();
        this.audio.playMusic('gameplay');   // back to the driving theme (biome latched)
        this._updateJoystickEnabled();
    }

    // Bank + RECORD the run once (so the 3 boss kills count toward lifetime
    // unlocks — including the new biome), then return to the menu. Optionally
    // pre-select the new map so the player lands ready to play it.
    victoryToMenu(selectNewMap = false) {
        if (!this._runRecorded) {
            // Mirror the game-over bookkeeping so leaving on a VICTORY grants the
            // same coins, lifetime stats, and achievements as dying would.
            // Bank first (idempotent — returnToShop's later call is a no-op) so
            // `earned` is known and folds into totalCoinsEarned via recordRun.
            const earned = this._bankRunCoins();
            if (this.runBonus?.coin > 0 && earned > 0) {
                this.saveSystem.addCoins(Math.round(earned * this.runBonus.coin));
            }
            this.saveSystem.incrementStat('playtimeSec', Math.max(0, Math.floor(this.time)));
            if (this.difficulty === 'hard') {
                this.saveSystem.incrementStat('eliteBossesDefeated', this.bossesDefeated);
            }
            this.runSummary = {
                time: this.time, level: this.player.level, kills: this.kills,
                bossesDefeated: this.bossesDefeated,
                coinsEarned: earned,
                totalCoins: this.saveSystem.data.totalCoins,
                finalWave: (this.waveState?.index ?? 0) + 1,
                finalWaveName: this.waveState?.name ?? '',
            };
            this.saveSystem.recordRun(this.runSummary);
            // Day streak: a finished run marks today played (idempotent within
            // a day) — surfaced on the PLAY tab and the game-over summary.
            this.runSummary.streak = this.saveSystem.recordDayStreak(currentDayNumber());
            // Daily Road: a WON daily banks its score + payout too (same latch
            // as game-over so leaving-on-victory then dying can't double-count).
            this._bankDailyRoad();
            // KINDLED PR5 — same rite accrual + Rite-Trial banking as the death path
            // (both latched, so a victory-then-death can't double-count).
            this._accrueRiteProgress();
            this._bankRiteTrial();
            this._bankBossRush();
            this._checkAchievements();
            this._checkDailyChallenges();
            this._runRecorded = true;
        }
        // Clearing this map's three bosses advances the campaign — select the
        // NEXT map in order if it's now unlocked (each map's trio feeds lifetime
        // boss kills, which gate the next biome at 3/6/9).
        if (selectNewMap) {
            const cur = this.saveSystem.getSelectedMap();
            const curIdx = MAP_ORDER.indexOf(cur);
            for (let i = curIdx + 1; i < MAP_ORDER.length; i++) {
                if (this.saveSystem.setSelectedMap(MAP_ORDER[i])) break; // first unlocked next map
            }
        }
        this.victory = null;
        this.returnToShop();
    }

    // Bank coins earned this run into the save total, exactly once (guarded
    // by bankedThisRun). Returns the amount banked (0 if already banked).
    // The Heirloom Cinders seed BANKS TOO (run coins have no mid-run spend, so
    // always excluding it made that purchased upgrade a literal no-op) — but
    // only for a run that was PLAYED: ended in death/victory, or lasted ≥60s.
    // Otherwise pause→RESTART spam would mint floor(seed × coinMul) every few
    // seconds for zero play; an instant abandon banks only what was picked up.
    _bankRunCoins() {
        if (this.bankedThisRun) return 0;
        const seedEarned = this.gameOver || this.victory !== null || this.time >= 60;
        const seed = seedEarned ? 0 : (this.startingCoinsGranted ?? 0);
        // Coin-gain gear/charms boost the BANKED total (player.coinMul, 1 by
        // default). Applied here so the in-run HUD stays a clean integer.
        const raw = Math.max(0, (this.player.coins ?? 0) - seed);
        const earned = Math.floor(raw * (this.player.coinMul ?? 1));
        if (earned > 0) this.saveSystem.addCoins(earned);
        this.bankedThisRun = true;
        return earned;
    }

    // Bank the Daily Road result, exactly once per run (shared by game-over
    // and victory-leave, latched by _dailyRoadRecorded). Beyond the best-of-day
    // record, the daily PAYS: score-band coins every run, plus a free Ember
    // case on the first CLEAR of the day — so the curated run is a reward
    // loop, not just a scoreboard. Everything lands on runSummary so the
    // game-over screen can celebrate it.
    _bankDailyRoad() {
        if (!this.dailyMode || this._dailyRoadRecorded) return;
        const dscore = Math.floor(this.time) + Math.floor(this.kills * 2.5) + this.bossesDefeated * 500;
        this.dailyRoadBest = this.saveSystem.recordDailyRoadScore(currentDayNumber(), dscore).best;
        // Score-band coins (generous floor so even a short daily pays a little;
        // capped well under a good normal run so it never replaces real play).
        // Band coins are EARNED coins, so they fold into totalCoinsEarned too
        // (addCoins alone only moves the spendable balance) — the Stats tab
        // and the SKILLS-tab unlock both read the lifetime stat.
        const coins = dscore >= 3000 ? 140 : dscore >= 1500 ? 90 : dscore >= 500 ? 50 : 20;
        this.saveSystem.addCoins(coins);
        this.saveSystem.incrementStat('totalCoinsEarned', coins);
        // First CLEAR of the UTC day (3rd boss down — never a mere attempt, so
        // launch-and-die can't farm it): one free Ember (basic) case — applied
        // to the save immediately; the label rides the summary. The once-a-day
        // latch lives in the save (claimDailyRoadCase), NOT on firstToday, so a
        // failed first attempt doesn't burn the day's case.
        let caseLabel = null;
        if (this.bossesDefeated >= 3 && this.saveSystem.claimDailyRoadCase(currentDayNumber())) {
            const r = openCase(this.saveSystem, 'basic', { free: true });
            if (r.ok) caseLabel = r.label;
        }
        if (this.runSummary) {
            this.runSummary.dailyRoadScore = dscore;
            this.runSummary.dailyRoadCoins = coins;
            this.runSummary.dailyRoadCase = caseLabel;
        }
        this._dailyRoadRecorded = true;
    }

    // KINDLED PR5 — the per-run rite metrics + Kindle score inputs from the finished
    // run (one summary pass, no per-frame cost). Distinct from the daily-road score.
    _runRiteStats() {
        return {
            time: Math.floor(this.time),
            kills: this.kills,
            bosses: this.bossesDefeated,
            ults: this.ultsReleased,
            comboProcs: (this.player && this.player._comboProcs) || 0,
            heal: Math.floor((this.player && this.player.healedThisRun) || 0),
            bestUltHits: this._runBestUltHits,
            bestUltKills: this._runBestUltKills,
            brinkCasts: this._runBrinkCasts,
        };
    }

    // Accrue THIS run's contribution into the run HERO's rite progress — EVERY run,
    // not just a Rite Trial (mastery accumulates whenever you play that hero). Keyed
    // by _effectiveCharacterId so a trial run credits the trial hero. Also folds the
    // lifetime KINDLED counters. Latched by _riteAccrued so victory-then-death can't
    // double-count.
    _accrueRiteProgress() {
        if (this._riteAccrued) return;
        this._riteAccrued = true;
        const heroId = this._effectiveCharacterId();
        const stats = this._runRiteStats();
        const prev = this.saveSystem.getRites()[heroId];
        const { map, newlyDone } = accrueRites(prev, heroId, stats);
        this.saveSystem.setHeroRites(heroId, map);
        if (this.ultsReleased > 0) this.saveSystem.incrementStat('ultsReleased', this.ultsReleased);
        if (stats.comboProcs > 0) this.saveSystem.incrementStat('comboProcs', stats.comboProcs);
        if (this.blinks > 0) this.saveSystem.incrementStat('blinks', this.blinks);
        if (this.runSummary) this.runSummary.ritesCompleted = newlyDone.map((r) => r.name);
        if (newlyDone.length && this._setToast) this._setToast(`Rite complete — ${newlyDone[0].name}`);
    }

    // Bank the daily hero-locked Rite Trial score (the Kindle-centric formula) into
    // the best-of-day record, once per run. Latched by _riteTrialRecorded.
    _bankRiteTrial() {
        if (!this.riteTrialMode || this._riteTrialRecorded) return;
        this._riteTrialRecorded = true;
        const score = riteTrialScore({
            kills: this.kills, ults: this.ultsReleased,
            comboProcs: (this.player && this.player._comboProcs) || 0,
            bosses: this.bossesDefeated,
        });
        const rec = this.saveSystem.recordRiteTrial(currentDayNumber(), score);
        this.riteTrialBestNew = rec.best;
        if (this.runSummary) {
            this.runSummary.riteTrialScore = score;
            this.runSummary.riteTrialBest = rec.best;
            this.runSummary.riteTrialHero = this._effectiveCharacterId();
        }
    }

    // BOSSFORGE — bank a gauntlet run (Boss Rush OR Weekly Ember) + stamp the
    // recap fields onto runSummary (bosses felled, whether the gauntlet was
    // cleared, final boss reached, hero, time, score). Boss Rush banks into the
    // ALL-TIME freeplay record; Weekly Ember into the week-scoped best (a weekly
    // run never inflates the freeplay record — different, seeded boss order).
    // Once per run, latched by _bossRushRecorded so a victory-leave then death
    // can't double-count.
    _bankBossRush() {
        if (!this.bossRush || this._bossRushRecorded) return;
        if (!this.bossRushMode && !this.weeklyEmberMode) return;
        this._bossRushRecorded = true;
        const st = this.bossRush.getStatus();
        const cleared = st.cleared;
        const timeSurvived = Math.floor(this.time);
        const score = bossRushScore({ bossesDefeated: st.bossesDefeated, timeSurvived, cleared });
        if (this.weeklyEmberMode) {
            const rec = this.saveSystem.recordWeeklyEmber(weeklyEmberSeed(currentDayNumber()), score);
            this.weeklyEmberBestNew = rec.best;
            this.bossRushBestNew = rec.best;   // shared "record beaten" flag for the end screen
        } else {
            const beat = this.saveSystem.recordBossRush({ bossesDefeated: st.bossesDefeated, timeSurvived, score, cleared });
            this.bossRushBestNew = !!(beat.bosses || beat.score || beat.time);
        }
        // The apex reached = the boss being fought at the end (death), or the
        // final apex on a full clear. Name resolved from ENEMY like the warning.
        const reachedId = st.currentBossId || this.bossRush.sequence[this.bossRush.sequence.length - 1] || null;
        const reachedName = reachedId ? (ENEMY[reachedId]?.bossName ?? reachedId) : '—';
        if (this.runSummary) {
            this.runSummary.bossRush = true;
            this.runSummary.bossRushLabel = st.label || 'Boss Rush';
            this.runSummary.bossRushBosses = st.bossesDefeated;
            this.runSummary.bossRushTotal = st.total;
            this.runSummary.bossRushCleared = cleared;
            this.runSummary.bossRushScore = score;
            this.runSummary.bossRushBestNew = this.bossRushBestNew;
            this.runSummary.bossRushHero = this._effectiveCharacterId();
            this.runSummary.bossRushFinalBoss = reachedName;
            this.runSummary.bossRushTime = timeSurvived;
            if (this.weeklyEmberMode) this.runSummary.weeklyEmberWeek = weeklyEmberSeed(currentDayNumber());
        }
    }

    // Screen shake routed through here so the accessibility toggle can
    // suppress it in one place.
    _shake(intensity, duration) {
        if (this.shakeEnabled) this.camera.shake(intensity, duration);
    }

    // Direct trauma push (0..1) for the trauma-based camera — also gated by the
    // accessibility toggle so disabling shake silences everything.
    _addTrauma(amount) {
        if (this.shakeEnabled) this.camera.addTrauma(amount);
    }

    // Player-hit shake SCALED by how big the hit was (fraction of max HP), so a
    // boss slam feels far heavier than chip damage — and a big hit adds a brief
    // freeze-frame. Capped so it never whites the screen out.
    _playerHurtShake(dealt) {
        const frac = Math.min(1, (dealt || 0) / Math.max(1, this.player.maxHp));
        const mul = 0.5 + frac * 1.7;
        this._shake(SCREEN_SHAKE.intensity * mul, SCREEN_SHAKE.duration * (0.8 + frac * 0.7));
        if (frac > 0.18) this._hitStop(Math.min(0.1, frac * 0.2));
    }

    // Freeze the sim for `sec` seconds (kept as a max so a big hit landing
    // during a small freeze extends it rather than shortening it). Skipped when
    // reduced-effects is on so the accessibility path never stutters.
    _hitStop(sec) {
        if (this.reducedEffects) return;
        this.hitStop = Math.max(this.hitStop, sec);
    }

    // Spawn an expanding shockwave ring (cosmetic). Pooled + capped so a dense
    // crowd kill can't flood it. color/width/life/maxR all optional.
    _spawnRing(x, y, opts = {}) {
        if (!this.particlesEnabled || this.reducedEffects) return;
        if (this.rings.length >= 48) return;
        this.rings.push({
            x, y, age: 0,
            life: opts.life ?? 0.45,
            r0: opts.r0 ?? 6,
            maxR: opts.maxR ?? 120,
            width: opts.width ?? 7,
            color: opts.color ?? '#ffd0a0',
            ease: opts.ease ?? 'outQuad',
            active: true,
        });
    }

    _setToast(msg) { this.menuToast = msg; this.menuToastTimer = 2.5; }

    setUpgradeChoices(choices) {
        this.upgradeChoices = choices;
        if (choices) this.levelUpAge = 0;
        this._updateJoystickEnabled();
    }

    // Record a brief press on a UI control so the UI can render a pressed
    // state. id is matched by UISystem (e.g. 'start', 'restart', 'dbg',
    // 'shop:<upgradeId>').
    _pressFeedback(id) {
        this.pressFx = { id, age: 0 };
    }

    // Queue a short full-screen feedback flash (type: 'hit' | 'heal' |
    // 'levelup'). Cheap, screen-space, drawn by UISystem.
    _pushFeedback(type, life = 0.3) {
        this.feedback.push({ type, age: 0, life });
    }

    // Extend the kill streak by n kills, refresh the decay window, and fire a
    // milestone banner when the streak crosses a configured threshold. Combo is
    // a pure feedback layer (no damage/drop effect), so this is safe to call
    // from the kill loop without touching balance.
    _addCombo(n) {
        if (n <= 0) return;
        this.combo += n;
        this.comboTimer = COMBO.window;
        if (this.combo > this.comboBest) this.comboBest = this.combo;
        const ms = COMBO.milestones;
        while (this._comboMilestoneIdx < ms.length && this.combo >= ms[this._comboMilestoneIdx]) {
            const reached = ms[this._comboMilestoneIdx];
            this._comboMilestoneIdx++;
            this.waveDirector.announce(`${reached} KILL STREAK!`, 1.4, '#ffd166');
            this._pushFeedback('levelup', 0.3);
            this.audio.streak();
        }
    }

    // Evaluate run objectives against live metrics; the first time one is met it
    // pays its coin reward, announces, and counts toward the game-over summary.
    _checkObjectives() {
        const m = {
            kills: this.kills,
            timeSec: this.time,
            level: this.player.level,
            comboBest: this.comboBest,
            bosses: this.bossesDefeated,
        };
        for (const o of OBJECTIVES) {
            if (this._objDone.has(o.id)) continue;
            if ((m[o.metric] ?? 0) >= o.target) {
                this._objDone.add(o.id);
                this._objCompleted.push(o.id);
                // Coin-gain builds apply to objective payouts too (same
                // player.coinMul the banked run total already respects), so a
                // coin build is as strong as its cards advertise.
                const reward = Math.floor(o.reward * (this.player.coinMul ?? 1));
                this.saveSystem.addCoins(reward);
                this.audio.objective();
                this.waveDirector.announce(`✓ ${o.name}  +${reward}`, 2.2, '#7fe0a0');
            }
        }
    }

    _updateFeedback(dt) {
        if (this.pressFx) {
            this.pressFx.age += dt;
            if (this.pressFx.age > 0.22) this.pressFx = null;
        }
        const fb = this.feedback;
        for (let i = fb.length - 1; i >= 0; i--) {
            fb[i].age += dt;
            if (fb[i].age >= fb[i].life) fb.splice(i, 1);
        }
    }

    // Joystick is disabled whenever ANY overlay is up so a stray drag can't
    // start while the player is reading a card / chest reward / shop /
    // GAME OVER.
    _updateJoystickEnabled() {
        const blocked = this.screen !== 'gameplay' || this.paused ||
            !!this.upgradeChoices || !!this.chestReward || !!this.altar || !!this.victory ||
            !!this.photoMode;   // the Lens owns touches itself (drag-pan)
        if (this.input.touch) this.input.touch.setEnabled(!blocked);
        // KINDLED touch action buttons share the joystick's block set — disabling
        // is authoritative (clears any latched tap), so a blink/ult/focus queued
        // as an overlay opens can't fire when play resumes.
        if (this.input.buttons) this.input.buttons.setEnabled(!blocked);
    }

    _presentLevelUp() {
        if (this.pendingLevelUps <= 0) return;
        this.pendingLevelUps -= 1;
        // Onboarding fast-forward: the FIRST level-up IS the step-3 teach
        // moment, and it usually arrives before the timed hints get there
        // (step 2 alone needs ~13–21s while _tickOnboarding is frozen behind
        // this overlay). Jump straight to step 3 so the "first pick" line
        // shows on THIS overlay and selectUpgrade's clear guard fires —
        // otherwise it would slip to the second level-up.
        if (this.onboarding && this.onboarding.step < 3) {
            this.onboarding.step = 3;
            this.onboarding.timer = 0;
        }
        const choices = this.upgradeSystem.rollChoices(this, 3);
        this.setUpgradeChoices(choices.length > 0 ? choices : null);
    }

    _presentChest() {
        if (this.pendingChests <= 0) return;
        this.pendingChests -= 1;
        this.chestsOpened = (this.chestsOpened ?? 0) + 1;
        const reward = rollChestReward(this);
        // Apply the reward immediately so the in-game state already reflects
        // what the overlay is announcing. The overlay is confirmation, not a
        // commit step — closing it just resumes gameplay.
        reward.apply(this);
        // A weapon evolution is a milestone — announce it with a distinct
        // violet banner, a level-up flash, and a celebratory burst so it reads
        // as the run-defining moment it is (the confirm overlay follows).
        if (reward.kind === 'evolution') {
            this.waveDirector.announce(
                `${(reward.evolvedName ?? 'WEAPON').toUpperCase()} — EVOLVED!`, 3.2, '#c47bff'
            );
            this._pushFeedback('levelup', 0.5);
            this.particles.levelUpBurst(this.player.x, this.player.y);
            this.audio.evolve();
        }
        this.chestReward = { reward, age: 0 };
        this._updateJoystickEnabled();
    }

    _dismissChestReward() {
        if (!this.chestReward) return;
        this.chestReward = null;
        this._updateJoystickEnabled();
        if (this.pendingChests > 0) this._presentChest();
        else if (this.pendingLevelUps > 0) this._presentLevelUp();
        else if (this.pendingAltars > 0) this._presentAltar();
    }

    // ── Wick Roads altar overlay ──────────────────────────────────────────
    // Opens the pick-one shrine overlay (freezes the world exactly like the
    // chest/level-up overlays — via the update gate + joystick disable + input
    // ownership — WITHOUT touching this.paused).
    setAltar(choices) {
        this.altar = (choices && choices.length) ? { choices, age: 0 } : null;
        this._updateJoystickEnabled();
    }

    _presentAltar() {
        if (this.pendingAltars <= 0) return;
        this.pendingAltars -= 1;
        const choices = rollAltarChoices(this, WICK_ROADS.altarChoices);
        if (!choices.length) return;   // pool dry (all relics claimed) → skip
        this.setAltar(choices);
    }

    // ── Branching Roads (post-boss CROSSROADS fork) ───────────────────────
    // Opens the pick-one road choice by REUSING the altar overlay (tagged
    // kind:'crossroads'): it inherits every altar freeze/input guard for free, so
    // there is no new stranded-player surface. Selection routes through selectAltar,
    // whose 'road' branch announces it; each road's apply(game) set the segment bias.
    _presentCrossroads() {
        const choices = rollRoadChoices();
        if (!choices || !choices.length) return;
        this.altar = { choices, age: 0, kind: 'crossroads' };
        this.audio.shrineChime();
        this._updateJoystickEnabled();
    }

    // End the current road's segment bias: reset the disposable multiplier/mix
    // layers to neutral and restore the base biome tint. Called when the NEXT boss
    // spawns, so a road shapes exactly the stretch between two bosses. The road's
    // permanent boon (applied to the player at pick time) is NOT undone here.
    _clearSegmentRoad() {
        this.segmentScale = { hp: 1, speed: 1, damage: 1, elite: 1, cap: 1, interval: 1 };
        this.segmentWeights = null;
        this._segmentRoadId = null;
        if (this._baseBiomeTheme && this.mapRenderer) this.mapRenderer.theme = this._baseBiomeTheme;
    }

    // Nudge a desired spawn point to the nearest spot not inside an obstacle.
    // Used for bosses/chests/pickups so nothing spawns trapped in a wall.
    // Clamp the player's global stacking stats to their late-game ceilings.
    // These fields only ever grow within a run, so a hard clamp is idempotent
    // and safe to run every frame. Weapon per-level stats are NOT touched, so
    // individual upgrades still feel meaningful up to the cap.
    _applyPlayerCaps() {
        const p = this.player;
        if (p.damageMul > CAPS.damageMul) p.damageMul = CAPS.damageMul;
        if (p.cooldownMul < CAPS.cooldownMulFloor) p.cooldownMul = CAPS.cooldownMulFloor;
        if (p.speed > CAPS.moveSpeed) p.speed = CAPS.moveSpeed;
        if (p.pickupRange > CAPS.pickupRange) p.pickupRange = CAPS.pickupRange;
    }

    // Recompute the player's weapon aura only when the owned-weapon set/levels
    // change (cheap signature check) to avoid a per-frame object allocation.
    // The aura is purely visual (color/intensity/radius); the snapshot is also
    // used to tint the player's light and shown in the debug panel.
    _updateAura() {
        // Recompute only when the weapon set/levels actually change (WeaponSystem
        // bumps .version on add/levelUp/evolve) — no per-frame allocation.
        const v = this.weaponSystem.version;
        if (v !== this._auraVersion) {
            this._auraVersion = v;
            this._auraSnapshot = computePlayerAura(this.weaponSystem.owned);
        }
        // Reduced-effects (mobile/perf) skips the extra additive aura glow but
        // still lets the player light pick up the aura tint (free).
        this.player.weaponAura = this.reducedEffects ? null : this._auraSnapshot;
    }

    // Debug-only: advance the run clock so wave/enemy/boss time-scaling jumps
    // ahead for balance testing. Refreshes the cached wave state immediately.
    _debugSkipTime(seconds) {
        this.time += seconds;
        this.waveState = this._applyRunScale(this.waveDirector.getState(this.time));
        if (this.waveDirector.announce) this.waveDirector.announce(`⏩ +${seconds}s → ${(this.time / 60).toFixed(1)} min`, 1.5);
    }

    // Debug-only: jump the run clock FORWARD to an absolute minute mark (never
    // backward — you can't un-spawn what's already out) so a tester can land
    // exactly on the 5/10/20/30-min checkpoints the balance curve targets.
    _debugJumpToMinute(minute) {
        const target = minute * 60;
        if (target <= this.time) return;
        this._debugSkipTime(target - this.time);
    }

    // ── BOSSFORGE Boss Rush debug helpers (DEV_MODE shortcuts) ──────────────
    // Skip to the next boss: drop the active boss to 1 HP so the next auto-shot
    // kills it through the REAL death pipeline (which advances the sequence);
    // during a prep phase, shorten the countdown instead.
    _debugBossRushNext() {
        if (!this.bossRush) return;
        const boss = this.enemies.find((e) => e.active && e.boss);
        if (boss) boss.hp = 1;
        else if (this.bossRush.phase === 'prep') this.bossRush.debugSkipPrep();
    }
    // Force the active boss to ~3% HP (test the finish / enraged threshold).
    _debugBossRushLowHp() {
        const boss = this.enemies.find((e) => e.active && e.boss);
        if (boss) boss.hp = Math.max(1, Math.floor((boss.maxHp || boss.hp || 1) * 0.03));
    }
    // Finish the whole gauntlet immediately: clear the field + mark the sequence
    // cleared, then open the victory overlay (recap reads the controller status).
    _debugBossRushFinish() {
        if (!this.bossRush) return;
        for (const e of this.enemies) if (e.active && e.boss) e.active = false;
        this.bossWarning = null;
        this.arena = null;
        this.bossRush.debugForceFinish();
        if (!this._victoryShown) { this._victoryShown = true; this._showVictory(); }
    }

    _clearSpot(x, y, clearance) {
        const halfW = WORLD_WIDTH / 2 - clearance;
        const halfH = WORLD_HEIGHT / 2 - clearance;
        const cx = clamp(x, -halfW, halfW);
        const cy = clamp(y, -halfH, halfH);
        if (!this.obstacleSystem.isBlocked(cx, cy, clearance)) return { x: cx, y: cy };
        for (let step = 1; step <= 6; step++) {
            const rad = step * (clearance + 40);
            for (let a = 0; a < TWO_PI; a += Math.PI / 4) {
                const nx = clamp(cx + Math.cos(a) * rad, -halfW, halfW);
                const ny = clamp(cy + Math.sin(a) * rad, -halfH, halfH);
                if (!this.obstacleSystem.isBlocked(nx, ny, clearance)) return { x: nx, y: ny };
            }
        }
        return { x: cx, y: cy };
    }

    // Pull an entity back inside the active boss arena ring (no-op if no arena).
    _confineToArena(ent, margin = 0) {
        const a = this.arena;
        if (!a) return;
        const dx = ent.x - a.x, dy = ent.y - a.y;
        const d = Math.hypot(dx, dy);
        const max = a.r - margin;
        if (d > max && d > 0) { ent.x = a.x + (dx / d) * max; ent.y = a.y + (dy / d) * max; }
    }

    // KINDLED — the aimed blink (Space / touch button). A short instant dash in
    // the direction the player is MOVING (else facing), gated by the blink
    // cooldown only (free from run 1, independent of the Kindle meter). Placement
    // is wall- and arena-safe: the destination steps back in minGap increments
    // while the straight path is obstacle-blocked, then slides out of any wall it
    // lands in (resolveCircle) and is clamped inside a sealed boss ring
    // (_confineToArena) — so a blink can never tunnel through geometry or escape
    // an arena. On success it revives Player.dashFx (the orphaned afterimage
    // smear) and grants i-frames.
    _tryBlink() {
        const k = this.kindleSystem;
        if (!k || !k.blinkReady()) return;
        const p = this.player;
        if (!p || p.hp <= 0) return;

        // Aim: current movement vector, else the facing direction (a dodge goes
        // where you're heading, NOT toward the target — deliberately not aimAngle).
        const mv = this.input.getMovement();
        let ang;
        if (mv && (mv.x !== 0 || mv.y !== 0)) {
            ang = Math.atan2(mv.y, mv.x);
        } else {
            const f = p.facing;
            ang = f === 'up' ? -Math.PI / 2 : f === 'left' ? Math.PI
                : f === 'right' ? 0 : Math.PI / 2;
        }
        const dx = Math.cos(ang), dy = Math.sin(ang);
        const fromX = p.x, fromY = p.y;

        // Longest clear distance ≤ BLINK.distance: shrink in minGap steps while
        // the segment to the destination is wall-blocked.
        let dist = BLINK.distance;
        let tx = fromX + dx * dist, ty = fromY + dy * dist;
        while (dist > 0 && this.obstacleSystem.segmentBlocked(fromX, fromY, tx, ty)) {
            dist -= BLINK.minGap;
            tx = fromX + dx * dist; ty = fromY + dy * dist;
        }
        if (dist <= 0) return;   // fully walled in — no blink, no cooldown burned

        // Commit: land, slide out of any obstacle overlap, keep inside the arena.
        p.x = tx; p.y = ty;
        const r = this.obstacleSystem.resolveCircle(p.x, p.y, p.radius);
        p.x = r.x; p.y = r.y;
        if (this.arena) this._confineToArena(p, p.radius);

        // Feel: i-frames, the revived dashFx smear along the travel path, the cue.
        p.invincibleTimer = Math.max(p.invincibleTimer, BLINK.iframes);
        p.dashFx = { fromX, fromY, toX: p.x, toY: p.y, age: 0, dur: 0.28 };
        this.audio.dash();
        k.startBlinkCooldown();
        this.blinks++;   // KINDLED PR5 — successful-blink run counter (lifetime 'blinks' stat)
    }

    // KINDLED — the Focus-Time aim state machine (keyboard KeyQ + touch KINDLE
    // button, folded to one path). HOLD (with a ready meter) to enter slow-mo
    // aiming; the ult FIRES on release, or when the 2.5s hold cap elapses. Runs
    // on REAL dt from the live gameplay step (past every overlay guard), so it
    // never ticks under a pick-one overlay. Returns the fired ult's
    // { hits, killed } this frame (merged by _resolveCombat), else null.
    _updateKindleAim(dt) {
        const k = this.kindleSystem;
        const kb = this.input && this.input.keyboard;
        const btn = this.input && this.input.buttons;
        const qHeld = !!(kb && kb.isDown && kb.isDown('KeyQ'));
        const touchHeld = !!(btn && btn.kindleHeld);
        const held = qHeld || touchHeld;
        if (k.aiming) {
            k.aiming.t += dt;                       // wall-clock hold time
            k.aiming.angle = this._ultAimAngle();   // re-aim each frame (folds touch drag)
            // A quick-tap latch set on THIS same release is redundant while a hold
            // aim is already resolving — drain it so it can't double-fire next frame.
            if (btn) btn.consumeKindleTap();
            // Touch deadzone cancel: a slow release near the button centre fizzles
            // and refunds the whole bar (checked BEFORE the release-to-fire path,
            // since touchend clears kindleHeld and sets the cancel flag together).
            if (btn && btn.consumeKindleCancel()) { k.refundAim(); k.aiming = null; return null; }
            if (!held || k.aiming.t >= KINDLE.focusTimeMax) return this._releaseUlt(k.aiming.angle);
            return null;                            // still aiming
        }
        // Not aiming: any latched deadzone-cancel is STALE (there's no aim to
        // fizzle — e.g. the button was held with an unready meter, or released
        // after an overlay ate the aim). Drain it now so it can't bleed into and
        // instantly cancel the NEXT aim (whether that aim starts on touch or KeyQ).
        if (btn) btn.consumeKindleCancel();
        // Quick-tap fire-latch: a KINDLE tap too short to be seen as a hold (both
        // touch events land inside one long frame under load) still fires the ult
        // along auto-aim, mirroring BLINK's latch. Drains harmlessly if not ready.
        if (btn && btn.consumeKindleTap() && k.ready) {
            k.spendUlt();
            return this._releaseUlt(this._ultAimAngle());
        }
        // Begin aiming on a fresh hold with a ready meter — spend up-front so a
        // cancel (overlay/pause/deadzone) can refund the whole bar cleanly.
        // fromTouch records who owns the aim so a stale touch drag angle can't
        // hijack a later keyboard aim (see _ultAimAngle).
        if (held && k.ready) {
            const sig = signatureFor(this._heroId);
            k.spendUlt();
            k.aiming = { t: 0, angle: this._ultAimAngle(), kind: sig.aimKind, ultName: sig.name, fromTouch: touchHeld };
        }
        return null;
    }

    // The angle an ult fires along: an explicit touch DRAG aim wins (the player
    // is pointing the ult by dragging off the KINDLE button); else the current
    // movement vector; else the last auto-aim angle (which already honours the
    // Focus target). Deliberately NOT the facing map the blink uses — an ult
    // points where you're steering/aiming it.
    _ultAimAngle() {
        const btn = this.input && this.input.buttons;
        // A touch DRAG aim wins ONLY while the aim is touch-driven — the KINDLE
        // button is currently held, or the active aim was touch-initiated (so a
        // just-released drag still fires along it). This gate stops a stale
        // kindleAngle from an earlier touch drag hijacking a later KEYBOARD (KeyQ)
        // aim on a hybrid keyboard+touch device.
        const touchAim = !!(btn && (btn.kindleHeld || this.kindleSystem.aiming?.fromTouch));
        if (touchAim && btn.kindleAngle != null) return btn.kindleAngle;
        const mv = this.input.getMovement();
        if (mv && (mv.x !== 0 || mv.y !== 0)) return Math.atan2(mv.y, mv.x);
        return this.player.aimAngle ?? 0;
    }

    // Release the aimed ult: clear aim, fire the hero's Grand Signature along the
    // angle, cue + shake. Returns its { hits, killed } (already spent; recharges
    // from its own kills via the _resolveCombat merge).
    _releaseUlt(angle) {
        const k = this.kindleSystem;
        k.aiming = null;
        const sig = signatureFor(this._heroId);
        // KINDLED PR5 — rite metric: a Kael 'Pyre of the Brink' counts as a brink cast
        // only if released below 20% HP (checked BEFORE the ult's own HP sacrifice).
        const lowHpCast = this.player && this.player.maxHp > 0 && this.player.hp < this.player.maxHp * 0.20;
        setUltFocus(this);   // KINDLED PR5 — arm the focused-target bonus (Lv4) for this cast
        const res = (sig.fire(this, angle)) || { hits: [], killed: [] };
        // KINDLED PR5 — per-run counters read at the summary pass (score + rite metrics).
        this.ultsReleased++;
        const hits = res.hits ? res.hits.length : 0;
        const kills = res.killed ? res.killed.length : 0;
        if (hits > this._runBestUltHits) this._runBestUltHits = hits;
        if (kills > this._runBestUltKills) this._runBestUltKills = kills;
        if (this._heroId === 'berserker' && lowHpCast) this._runBrinkCasts++;
        this.audio.ult(sig.aimKind);
        this._shake(SCREEN_SHAKE.intensity * 0.8, 0.35);
        this._pushFeedback('levelup', 0.4);
        return res;
    }

    // Per-frame Kindle timers (real dt): Kael's low-HP afterglow + Sylphine's
    // 2×-coin window. Both run on the wall clock so Focus Time never stretches them.
    _updateKindleTimers(dt) {
        const p = this.player;
        if (p._brinkAfterglow > 0) {
            p._brinkAfterglow -= dt;
            if (p._brinkAfterglow <= 0) { p.lowHpDamageBonus = Math.max(0, (p.lowHpDamageBonus || 0) - 0.25); p._brinkAfterglow = 0; }
        }
        if (this._coinWindfallTimer > 0) this._coinWindfallTimer = Math.max(0, this._coinWindfallTimer - dt);
    }

    // KINDLED Focus targeting — Tab cycles the lock: nearest → nearest ELITE →
    // BOSS → clear. A 4-state machine over the live field; auto-clears elsewhere
    // (dead / out of range 2s) in _updatePlayerAndWeapons.
    _cycleFocusTarget() {
        const p = this.player;
        const inRange = (e) => {
            const dx = e.x - p.x, dy = e.y - p.y;
            return e.active && dx * dx + dy * dy <= AUTO_AIM_RANGE * AUTO_AIM_RANGE;
        };
        const nearest = (pred) => {
            let best = null, bestD = Infinity;
            for (const e of this.enemies) {
                if (!inRange(e) || !pred(e)) continue;
                const dx = e.x - p.x, dy = e.y - p.y, d = dx * dx + dy * dy;
                if (d < bestD) { bestD = d; best = e; }
            }
            return best;
        };
        const cur = this.focusTarget;
        // Stage by what's currently locked.
        if (!cur || !cur.active) this.focusTarget = nearest(() => true);
        else if (!cur.elite && !cur.boss) this.focusTarget = nearest((e) => e.elite && !e.boss) || nearest((e) => e.boss) || null;
        else if (cur.elite && !cur.boss) this.focusTarget = nearest((e) => e.boss) || null;
        else this.focusTarget = null;   // was boss → clear
        this._focusOutOfRangeT = 0;
        if (this.focusTarget) this.audio.uiTick?.();
    }

    // KINDLED touch verbs (PR4): drain the two DISCRETE taps the bottom-right
    // button surface latched this frame — BLINK (dodge) and FOCUS (target). The
    // Kindle HOLD/aim is folded into _updateKindleAim; this handles only the
    // taps. Called from the live gameplay step (past every overlay guard), so a
    // tap can't fire under a frozen overlay. No-op when no touch buttons exist
    // (desktop / the art harnesses build Input without them).
    _updateTouchButtons() {
        const btn = this.input && this.input.buttons;
        if (!btn) return;
        if (btn.consumeBlinkTap()) this._tryBlink();
        const ft = btn.consumeFocusTap();
        if (ft) this._focusTapAt(ft.x, ft.y);
    }

    // Touch Focus targeting: LOCK the enemy nearest the tapped screen point
    // (within a forgiving pick radius), toggling the lock OFF if that enemy is
    // already locked; a tap on empty ground CLEARS the lock. The keyboard path
    // (_cycleFocusTarget) keeps the nearest→elite→boss→clear cycle model — touch
    // gets direct point-and-lock, which reads more naturally on a screen. Screen
    // → world is the inverse of UISystem._worldToScreen (camera is world-centre).
    _focusTapAt(screenX, screenY) {
        const cam = this.camera || { x: 0, y: 0 };
        const wx = screenX - INTERNAL_WIDTH / 2 + cam.x;
        const wy = screenY - INTERNAL_HEIGHT / 2 + cam.y;
        const PICK = 120;   // tap forgiveness (world px), plus each enemy's own radius
        let best = null, bestD = Infinity;
        for (const e of this.enemies) {
            if (!e.active) continue;
            const dx = e.x - wx, dy = e.y - wy, d = dx * dx + dy * dy;
            const reach = PICK + (e.radius || 20);
            if (d <= reach * reach && d < bestD) { bestD = d; best = e; }
        }
        this.focusTarget = best ? (this.focusTarget === best ? null : best) : null;
        this._focusOutOfRangeT = 0;
        if (this.focusTarget) this.audio.uiTick?.();
    }

    // Fold the run-scale layer (difficulty × active modifiers) into a freshly-
    // built wave state. getState() returns a new object literal each call, so
    // mutating it here can't compound across frames. eliteChance + cap stay
    // bounded so Hard + Elite-Hunt can't runaway.
    _applyRunScale(ws) {
        const r = this.runScale;
        if (!r || !ws) return ws;
        // Branching Roads: the current road's DISPOSABLE per-segment multipliers
        // (default all-1) compose on top of the run scale. getState() hands back a
        // fresh literal each frame, so clearing segmentScale to 1s at the next boss
        // reverts the bias next frame with zero undo bookkeeping.
        const s = this.segmentScale;
        ws.healthMul = (ws.healthMul ?? 1) * r.hp * (s?.hp ?? 1);
        ws.speedMul = (ws.speedMul ?? 1) * r.speed * (s?.speed ?? 1);
        ws.damageMul = (ws.damageMul ?? 1) * r.damage * (s?.damage ?? 1);
        ws.eliteChance = Math.min(0.85, (ws.eliteChance ?? 0) * r.elite * (s?.elite ?? 1));
        // Hard ceiling so the Swarm trial (+difficulty) can't push the alive
        // count past a perf-safe max on mobile (base cap is 180).
        ws.maxAlive = Math.min(220, Math.round((ws.maxAlive ?? 0) * r.cap * (s?.cap ?? 1)));
        ws.spawnIntervalMul = (ws.spawnIntervalMul ?? 1) * r.interval * (s?.interval ?? 1);
        // P1.2 biome mix: MULTIPLY this map's skew into the wave's native
        // table first. Multipliers only shift what the wave already offers
        // (never add types), so Vigil-1 purity and the creature-unlock
        // cadence survive — the map just leans the mix its own way. Both
        // tables are static per run, so the merged result is cached per wave
        // index and the steady-state frame allocates nothing.
        if (this._mapMix) {
            let tw = this._mapMixCache[ws.index];
            if (!tw) {
                tw = { ...ws.typeWeights };
                for (const id in tw) {
                    const m = this._mapMix[id];
                    if (m) tw[id] *= m;
                }
                this._mapMixCache[ws.index] = tw;
            }
            ws.typeWeights = tw;
        }
        // Enemy-MIX bias: merge the road's spawn weights onto a NEW typeWeights
        // object (getState returns a reference to the WAVES config table — never
        // mutate it in place). Null → the wave's native mix is untouched.
        // Layered AFTER the biome mix so a road's segment bias wins outright.
        if (this.segmentWeights) ws.typeWeights = { ...ws.typeWeights, ...this.segmentWeights };
        return ws;
    }

    // Support enemies (Healer / Shielder) buff their neighbours. Run here (not
    // in Enemy.update) because the effect needs the full enemy list. Healers
    // pulse HP back to nearby allies on a cadence (capped at maxHp); Shielders
    // refresh a short damage-soak timer on allies in range. Cheap: the outer
    // loop only does work for the (rare) support types.
    _tickSupportEnemies(dt) {
        const enemies = this.enemies;
        for (const s of enemies) {
            if (!s.active || s.behavior !== 'support') continue;
            const def = s.def;
            const r = def.supportRadius || 320;
            const r2 = r * r;
            if (def.support === 'heal') {
                s._healAccum += dt;
                const interval = def.healInterval || 0.5;
                if (s._healAccum >= interval) {
                    const amt = (def.healPerSec || 8) * s._healAccum;
                    s._healAccum = 0;
                    let mended = false;
                    for (const a of enemies) {
                        if (!a.active || a.hp >= a.maxHp) continue;
                        const dx = a.x - s.x, dy = a.y - s.y;
                        if (dx * dx + dy * dy > r2) continue;
                        a.hp = Math.min(a.maxHp, a.hp + amt);
                        mended = true;
                    }
                    // Hollow mend-shimmer so players learn to hunt healers by
                    // ear (long cue gap + on-screen gate keep it sparse).
                    if (mended && this._inView(s.x, s.y, 0)) this.audio.healerPulse();
                }
            } else if (def.support === 'shield') {
                const mul = def.shieldMul || 0.6;
                for (const a of enemies) {
                    if (!a.active) continue;
                    const dx = a.x - s.x, dy = a.y - s.y;
                    if (dx * dx + dy * dy > r2) continue;
                    a.shieldTimer = 0.35;
                    a.shieldMul = mul;
                }
                // One metallic ward chime per shielder as it first raises the
                // aura on screen — NEVER per tick (it refreshes every frame).
                if (!s._shieldCuePlayed && this._inView(s.x, s.y, 0)) {
                    s._shieldCuePlayed = true;
                    this.audio.shield();
                }
            }
        }
    }

    _spawnBoss(id) {
        const def = ENEMY[id];
        if (!def || !def.boss) return;
        // Branching Roads: a new boss ends the prior segment's road bias (mix +
        // difficulty multipliers + re-tint revert). The road's permanent boon stays.
        this._clearSegmentRoad();
        // Boss arena reset: clear lingering trash so the fight is about the
        // boss + its own themed adds (which spawn near it below), not leftover
        // swarm. Cleared enemies are banished (no gems), and a puff sells it.
        for (const e of this.enemies) {
            if (e.active && !e.boss) {
                e.active = false;
                if (this._inView(e.x, e.y, 0)) this.particles.deathBurst(e.x, e.y, '#6a7a9a');
            }
        }
        // Seal the fight into an arena centered on the player — both the player
        // and the boss are confined to it (see the per-frame clamps), so you
        // can't run away and plink; you have to dodge it up close.
        this.arena = { x: this.player.x, y: this.player.y, r: BOSS.arenaRadius };
        const angle = Math.random() * TWO_PI;
        const dist = BOSS.arenaSpawnDistance; // inside the arena ring
        const halfW = WORLD_WIDTH / 2 - 100;
        const halfH = WORLD_HEIGHT / 2 - 100;
        let x = clamp(this.player.x + Math.cos(angle) * dist, -halfW, halfW);
        let y = clamp(this.player.y + Math.sin(angle) * dist, -halfH, halfH);
        ({ x, y } = this._clearSpot(x, y, def.radius ?? 90));
        // Boss HP scales with the run minute far harder than trash so a 20-30
        // min boss isn't deleted instantly; a mild flat resistance ramps too.
        const minutes = this.time / 60;
        // Each successive boss THIS RUN is a major step up (the 3rd is the
        // hardest), so the boss gauntlet escalates toward a real climax instead
        // of every boss feeling the same. `bossesDefeated` is the encounter
        // index (0 = first). Time-scaling is capped first, then the encounter
        // tier multiplies on top.
        const encounter = this.bossesDefeated;
        // Player out-scales bosses by mid-run, so each successive boss is a big
        // HP step up (1× / 1.8× / 2.6× …) to stay a real fight; damage ramps
        // only mildly (the boss already hits hard enough).
        const tierMul = 1 + encounter * 0.8;
        // Per-MAP difficulty: later maps' bosses are tougher than earlier maps'
        // (the user-facing "each map gets harder"). The map-tier rung ALREADY
        // flows to bosses through runScale.hp / waveState (the mild trash fold,
        // ~+12%/+8% per tier), so these are small BOSS-ONLY EXTRAS on top —
        // they compound to roughly +20% HP / +12% damage per tier for bosses
        // while trash stays at the milder rate. (No speed extra: runScale.speed
        // already carries the per-tier speed bump to bosses too.)
        const mt = this.mapTier ?? 1;
        const mapHpMul = 1 + (mt - 1) * 0.07;
        const mapDmgMul = 1 + (mt - 1) * 0.04;
        // baseHpMul lengthens EVERY boss fight (early and late) by a flat factor
        // so a duel is a real war of attrition, not a quick burst-down.
        let bossHpMul, bossDmgMul;
        if (this.bossRush) {
            // Boss Rush override: a gentle, position-driven curve (bossRush.js).
            // The mode has no trash XP and stacks up to twelve bosses, so the
            // normal run-minute HP ramp + steep per-encounter tier would compound
            // into an unwinnable wall. runScale.hp (pacts/difficulty) still applies.
            const sc = this.bossRush.currentScale();
            bossHpMul = sc.hp * (this.runScale?.hp ?? 1);
            bossDmgMul = sc.dmg;
        } else {
            bossHpMul = (BOSS.baseHpMul ?? 1) * Math.min(1 + minutes * BOSS.hpPerMinute, BOSS.maxHpMul) * tierMul * (this.runScale?.hp ?? 1) * mapHpMul;
            bossDmgMul = (this.waveState.damageMul ?? 1) * (1 + encounter * 0.12) * mapDmgMul;
        }
        const boss = new Enemy(id, x, y, {
            healthMul: bossHpMul,
            speedMul: this.waveState.speedMul * (1 + encounter * 0.04),
            contactDamageMul: bossDmgMul,
        });
        boss.resist = Math.min(minutes * BOSS.resistPerMinute, BOSS.maxResist);
        // Stash the stable output channels the apex-boss AI writes into
        // (radial volleys go to the enemy-bolt loop; shockwaves to the hazard
        // pool). Both arrays are created once in _initRunState, so this
        // reference stays valid for the boss's whole life.
        boss._bossOut = {
            enemyProjectiles: this.enemyProjectiles,
            hazards: this.hazards,
            // Summon requests the boss AI queues; the Game drains + fulfils them.
            summons: this.bossSummons,
        };
        this.enemies.push(boss);
        this.waveDirector.announce(`${def.bossName} approaches!`, 3.0, '#ff5a4a');
        this.audio.bossSpawn();
        this.audio.playMusic('boss');
        // A heavier, longer shake than a normal hit to telegraph the arrival.
        this._shake(SCREEN_SHAKE.intensity * 0.85, 0.45);
        // The boss arrives flanked by a themed opening group (capped).
        this._spawnBossSupport(boss.x, boss.y, BOSS.openingSupport, def.supportTypes);
    }

    // Open the "BOSS INCOMING" warning window. The boss spawns when it expires
    // (handled in update). Stashes the boss's display name for the overlay.
    _startBossWarning(id) {
        const def = ENEMY[id];
        if (!def || !def.boss) return;
        this.bossWarning = { id, name: def.bossName ?? id, epithet: def.epithet ?? null, tier: def.tier ?? null, timer: BOSS.warningDuration, total: BOSS.warningDuration };
        this.waveDirector.announce('⚠  BOSS INCOMING  ⚠', BOSS.warningDuration, '#ff4040');
        this.audio.bossTelegraph();
        this._shake(SCREEN_SHAKE.intensity * 0.4, 0.3);
    }

    // ── Lieutenant mini-boss ──────────────────────────────────────────────
    // A short "ELITE APPROACHES" telegraph, then a single scaled heavy-hitter
    // spawns in the open (no arena, no swarm wipe). NOT a boss, NOT an elite.
    _startLieutenantWarning() {
        const pool = LIEUTENANT.types.filter((t) => ENEMY[t]);
        const type = pool.length ? pool[Math.floor(Math.random() * pool.length)] : 'brute';
        this.lieutenantWarning = { type, timer: LIEUTENANT.warningDuration, total: LIEUTENANT.warningDuration };
        this.waveDirector.announce('⚔  ELITE APPROACHES  ⚔', LIEUTENANT.warningDuration, LIEUTENANT.color);
        this.audio.lieutenantWarn();
        this._shake(SCREEN_SHAKE.intensity * 0.3, 0.25);
    }

    _spawnLieutenant(type) {
        const def = ENEMY[type];
        if (!def) return;
        // Open-field spawn near the player — NO arena, NO enemy wipe, NO music
        // switch (the swarm keeps coming). Plain enemy with explicit muls composed
        // on the live wave scale; never elite (would double-scale + roll an affix).
        const angle = Math.random() * TWO_PI;
        const dist = 520;
        const halfW = WORLD_WIDTH / 2 - 100, halfH = WORLD_HEIGHT / 2 - 100;
        let x = clamp(this.player.x + Math.cos(angle) * dist, -halfW, halfW);
        let y = clamp(this.player.y + Math.sin(angle) * dist, -halfH, halfH);
        ({ x, y } = this._clearSpot(x, y, (def.radius ?? 30) * LIEUTENANT.radiusMul));
        const lt = new Enemy(type, x, y, {
            healthMul: (this.waveState?.healthMul ?? 1) * LIEUTENANT.hpMul,
            speedMul: (this.waveState?.speedMul ?? 1) * LIEUTENANT.speedMul,
            contactDamageMul: (this.waveState?.damageMul ?? 1) * LIEUTENANT.dmgMul,
        });
        // Marker + display only — NEVER e.boss (leave tier null; BOSS_TIERS is 1/2/3).
        lt.lieutenant = true;
        lt.name = 'LIEUTENANT';
        lt.radius = (def.radius ?? 30) * LIEUTENANT.radiusMul;
        lt.visualScale = (def.visualScale ?? 1) * LIEUTENANT.radiusMul;
        // P1.3 — arm the borrowed boss vocabulary (1-2 mild attacks per type,
        // LIEUTENANT.attacks). runLieutenantAI (Enemy.js) drives timers →
        // windup (gold charge-arc tell) → commitBossAttack, so telegraphs +
        // hazards flow through the exact boss pipeline. First cooldowns are
        // part-elapsed so the opening special lands early but never instantly.
        lt.behavior = 'lieutenant';
        lt.ltAttacks = LIEUTENANT.attacks?.[type] ?? null;
        lt.ltTimers = {};
        if (lt.ltAttacks) {
            for (const a of lt.ltAttacks) lt.ltTimers[a.id] = a.cooldown * (0.35 + Math.random() * 0.4);
        }
        lt._ltActive = null;
        lt._ltWindupDur = 0;
        lt._bossOut = {
            enemyProjectiles: this.enemyProjectiles,
            hazards: this.hazards,
            summons: this.bossSummons,
        };
        this.enemies.push(lt);
        this.audio.bossSpawn();   // a punchy cue, but no boss music switch
        this._shake(SCREEN_SHAKE.intensity * 0.5, 0.3);
    }

    // Spawn `count` themed support enemies on a ring around (x,y), respecting
    // the live alive cap so a boss wave pressures without flooding. `types` is
    // a weight map ({ bat: 3, crawler: 1 }); falls back to slimes.
    _spawnBossSupport(x, y, count, types) {
        if (!count || count <= 0) return;
        const cap = this.waveState?.maxAlive ?? 120;
        const weights = types || { slime: 1 };
        const ids = Object.keys(weights);
        let live = 0;
        for (const e of this.enemies) if (e.active) live++;
        for (let i = 0; i < count; i++) {
            if (live >= cap) break;
            // Weighted type pick.
            let total = 0;
            for (const k of ids) total += weights[k];
            let r = Math.random() * total;
            let type = ids[0];
            for (const k of ids) { r -= weights[k]; if (r <= 0) { type = k; break; } }
            const a = (i / count) * TWO_PI + Math.random() * 0.6;
            const rad = BOSS.supportRing * (0.6 + Math.random() * 0.6);
            const sp = this._clearSpot(x + Math.cos(a) * rad, y + Math.sin(a) * rad, 46);
            this.enemies.push(new Enemy(type, sp.x, sp.y, {
                healthMul: this.waveState.healthMul,
                speedMul: this.waveState.speedMul,
                contactDamageMul: this.waveState.damageMul ?? 1,
            }));
            live++;
        }
    }

    // Boss HP-threshold phases. Each of 75/50/25% fires exactly ONCE per boss:
    // a themed support wave, a faster attack cadence, an announce, and (at 25%)
    // a move-speed bump. Latched on the boss so a threshold never re-triggers.
    _updateBossThresholds() {
        for (const e of this.enemies) {
            if (!e.active || !e.boss || !e.thresholds || e.maxHp <= 0) continue;
            const frac = e.hp / e.maxHp;
            const def = e.def;
            if (!e.thresholds.t75 && frac <= 0.75) {
                e.thresholds.t75 = true;
                e.bossCadenceMul = BOSS.thresholdCadence.t75;
                this._spawnBossSupport(e.x, e.y, BOSS.thresholdSupport.t75, def.supportTypes);
                this.waveDirector.announce(`${e.name.toUpperCase()} CALLS FOR AID`, 1.6, '#ffae5a');
            }
            if (!e.thresholds.t50 && frac <= 0.5) {
                e.thresholds.t50 = true;
                e.bossCadenceMul = BOSS.thresholdCadence.t50;
                this._spawnBossSupport(e.x, e.y, BOSS.thresholdSupport.t50, def.supportTypes);
            }
            if (!e.thresholds.t25 && frac <= 0.25) {
                e.thresholds.t25 = true;
                e.bossCadenceMul = BOSS.thresholdCadence.t25;
                // Move speed now ramps continuously with the low-HP enrage
                // scalar (see BOSS.enrage + Enemy.update), so no discrete bump here.
                this._spawnBossSupport(e.x, e.y, BOSS.thresholdSupport.t25, def.supportTypes);
                this.waveDirector.announce(`${e.name.toUpperCase()} ENRAGES!`, 2.0, '#ff3326');
                this.audio.enrage();
                this._shake(SCREEN_SHAKE.intensity * 0.9, 0.5);
            }
        }
    }

    // Soft anti-stacking: one local separation pass over a per-frame spatial
    // hash so cost stays ~O(N) even at the enemy cap. Each enemy is nudged
    // away from nearby overlapping enemies; the push is gentle (well under
    // chase speed) so swarms loosen without forming a rigid wall. Heavier
    // enemies barely move (mass ∝ radius), so small foes flow around brutes,
    // and bosses are almost immovable. Pushes are re-resolved against
    // obstacles + world bounds so nothing gets shoved through a wall.
    _separateEnemies(dt) {
        const cfg = ENEMY_SEPARATION;
        if (!cfg.enabled) return;
        const enemies = this.enemies;
        let active = 0;
        for (const e of enemies) if (e.active) active++;
        if (active < cfg.minCountToRun) return;

        // GC-clean spatial hash: numeric cell keys (gx*65536+gy is collision-
        // free — the bounded world spans far fewer than ±32768 cells) and
        // buckets that persist across frames. Only the buckets filled LAST
        // frame are reset (tracked in _sepUsed), so at steady state the pass
        // allocates nothing — the old string keys + fresh arrays were a big
        // slice of the per-frame churn at the 180-enemy cap.
        const cell = cfg.cellSize;
        const grid = this._sepGrid || (this._sepGrid = new Map());
        const used = this._sepUsed || (this._sepUsed = []);
        for (let i = 0; i < used.length; i++) used[i].length = 0;
        used.length = 0;
        for (const e of enemies) {
            if (!e.active) continue;
            e._pushX = 0;
            e._pushY = 0;
            const key = Math.floor(e.x / cell) * 65536 + Math.floor(e.y / cell);
            let b = grid.get(key);
            if (!b) { b = []; grid.set(key, b); }
            if (b.length === 0) used.push(b);
            b.push(e);
        }

        // Accumulate push per enemy from its 3×3 cell neighborhood.
        for (const e of enemies) {
            if (!e.active) continue;
            const gx = Math.floor(e.x / cell);
            const gy = Math.floor(e.y / cell);
            for (let oy = -1; oy <= 1; oy++) {
                for (let ox = -1; ox <= 1; ox++) {
                    const b = grid.get((gx + ox) * 65536 + (gy + oy));
                    if (!b) continue;
                    for (const o of b) {
                        if (o === e) continue;
                        const rSum = (e.radius + o.radius) * cfg.overlapFactor;
                        let dx = e.x - o.x;
                        let dy = e.y - o.y;
                        const d2 = dx * dx + dy * dy;
                        if (d2 >= rSum * rSum) continue;
                        let d = Math.sqrt(d2);
                        if (d < 0.01) {
                            // Exactly coincident — pick a deterministic-ish
                            // jitter direction from positions so they part.
                            dx = (e.x - o.x) + (e.radius - o.radius) * 0.01 + 0.13;
                            dy = (e.y - o.y) - 0.07;
                            d = Math.hypot(dx, dy) || 1;
                        }
                        const overlap = (rSum - d) / rSum; // 0..1
                        // Mass-weighted share: a small enemy moves more than a
                        // big one (share→1 when the OTHER is much bigger).
                        const share = (2 * o.radius) / (e.radius + o.radius);
                        const push = cfg.strength * overlap * share;
                        e._pushX += (dx / d) * push;
                        e._pushY += (dy / d) * push;
                    }
                }
            }
        }

        // Apply capped push, then re-resolve obstacles + world bounds.
        const halfW = WORLD_WIDTH / 2;
        const halfH = WORLD_HEIGHT / 2;
        for (const e of enemies) {
            if (!e.active) continue;
            let px = e._pushX;
            let py = e._pushY;
            if (px === 0 && py === 0) continue;
            // A planted lieutenant/bomber ignores separation through its
            // windup for the same reason Enemy.update drops its knockback:
            // the commit lands at the enemy's live spot, so a swarm shove
            // would drift the blast off the telegraph it already painted.
            if ((e.lieutenant || e.behavior === 'bomber') && e.windupTimer > 0) continue;
            if (e.boss) { px *= cfg.bossPushResist; py *= cfg.bossPushResist; }
            const m = Math.hypot(px, py);
            if (m > cfg.maxPush) { const s = cfg.maxPush / m; px *= s; py *= s; }
            e.x += px * dt;
            e.y += py * dt;
            const r = this.obstacleSystem.resolveCircle(e.x, e.y, e.radius);
            e.x = clamp(r.x, -halfW + e.radius, halfW - e.radius);
            e.y = clamp(r.y, -halfH + e.radius, halfH - e.radius);
        }
    }

    // Elemental DoT pass — applies FIRE burn to every burning enemy on a
    // fixed tick. Returns { killed, hits } so the caller can route burn kills
    // through the normal reward pipeline (gems/coins/kills/affix death). Burn
    // damage numbers are pushed here, tinted, under their OWN per-frame budget
    // so a burning crowd can't flood the floating-number pool. _tickStatuses
    // is the sole owner of the burn-tick accumulator drain (Enemy.update only
    // accumulates), so a tick is never double-spent.
    _tickStatuses(dt) {
        const killed = [];
        const hits = [];
        const interval = ELEMENT.fire.tickInterval;
        const burnMul = this.player.burnDamageMul ?? 1;
        let numberBudget = 10;
        for (const e of this.enemies) {
            // Process any enemy that still carries burn DPS (burnTimer may have
            // just hit 0 — we still owe it the final partial tick below).
            if (!e.active || e.burnDps <= 0) continue;
            let guard = 0;
            while (e.burnTickAccum >= interval && guard < 8) {
                e.burnTickAccum -= interval;
                guard++;
                const amt = e.burnDps * interval * burnMul;
                e.takeDamage(amt);
                if (numberBudget > 0) {
                    this.damageNumbers.push(new DamageNumber(
                        e.x, e.y - e.radius, amt, ELEMENT.fire.tint
                    ));
                    numberBudget--;
                }
                this.particles.burnEmbers(e.x, e.y);
                if (!e.active) { killed.push(e); break; }
            }
            // Burn has run out: flush the sub-interval remainder as a final
            // partial tick (so a clean N-second burn delivers its full nominal
            // damage, not floor(N/interval) ticks) and clear the state.
            if (e.active && e.burnTimer <= 0) {
                if (e.burnTickAccum > 0) {
                    const amt = e.burnDps * e.burnTickAccum * burnMul;
                    e.takeDamage(amt);
                    if (!e.active) killed.push(e);
                }
                e.burnDps = 0;
                e.burnTickAccum = 0;
            }
        }

        // Burn CONTAGION (Pyre Wisp identity: "flames spread"). A burning husk
        // periodically ignites a nearby un-burning neighbour at a reduced DPS,
        // so fire chews through packed crowds. Rate-gated (≈ once/0.6s per
        // burning enemy) + a per-frame cap so it can't instantly torch the whole
        // field or runaway-chain. Only one neighbour per burning enemy per tick.
        const SPREAD_R2 = 150 * 150;
        const spreadChance = 1 - Math.exp(-dt / 0.6);
        let spreadBudget = 12;
        for (const e of this.enemies) {
            if (spreadBudget <= 0) break;
            if (!e.active || e.burnTimer <= 0 || e.burnDps <= 0) continue;
            if (Math.random() > spreadChance) continue;
            for (const o of this.enemies) {
                if (!o.active || o === e || o.burnTimer > 0) continue;
                const dx = o.x - e.x, dy = o.y - e.y;
                if (dx * dx + dy * dy > SPREAD_R2) continue;
                // Floor the spread DPS so it's never trivial even off a weak
                // source, and carry most of the source's remaining duration.
                const spreadDps = Math.max(6, e.burnDps * 0.7);
                o.applyBurn(spreadDps, Math.max(1.5, e.burnTimer * 0.8));
                // Immediate ignition BITE so the spread visibly hurts right away
                // (a slow DoT alone reads as "0 damage" — and can be hidden by
                // the per-frame damage-number budget). Routed like any burn kill.
                const bite = spreadDps * 0.5 * burnMul;
                o.takeDamage(bite);
                this.damageNumbers.push(new DamageNumber(o.x, o.y - o.radius, bite, ELEMENT.fire.tint));
                if (!o.active) killed.push(o);
                this.particles.burnEmbers(o.x, o.y);
                spreadBudget--;
                break; // ignite one neighbour per burning enemy per tick
            }
        }
        return { killed, hits };
    }

    _enterGameOver() {
        if (this.gameOver) return;
        this.gameOver = true;
        if (this.player) this.player.poseOverride = 'death';   // hero collapses
        this.audio.gameOver();
        this.audio.stopMusic();
        this.screen = 'gameOver';
        this.gameOverAge = 0;
        this.shareToast = null;   // a fresh death screen starts with no stale toast
        this.upgradeChoices = null;
        this.pendingLevelUps = 0;
        this.chestReward = null;
        this.pendingChests = 0;
        this.altar = null;
        this.pendingAltars = 0;
        this.pendingCrossroads = false;

        // Bank run coins to total — exactly once (the helper is guarded by
        // bankedThisRun, which also covers abandoning via the pause overlay).
        const earned = this._bankRunCoins();
        // Difficulty/modifier coin bonus on top of what was earned.
        if (this.runBonus?.coin > 0 && earned > 0) {
            this.saveSystem.addCoins(Math.round(earned * this.runBonus.coin));
        }
        // Lifetime trackers surfaced on the new Stats screen.
        this.saveSystem.incrementStat('playtimeSec', Math.max(0, Math.floor(this.time)));
        if (this.difficulty === 'hard') {
            this.saveSystem.incrementStat('eliteBossesDefeated', this.bossesDefeated);
        }
        // Gauntlet (endless) score: only after a 3rd-boss victory continuation.
        if (this._gauntletActive) {
            this.gauntletScore = Math.floor(this.time) + Math.floor(this.kills * 2.5) + this.bossesDefeated * 500;
            this.gauntletBest = this.saveSystem.recordGauntletScore(this.gauntletScore);
        }

        this.runSummary = {
            time: this.time,
            level: this.player.level,
            kills: this.kills,
            bossesDefeated: this.bossesDefeated,
            coinsEarned: earned,
            totalCoins: this.saveSystem.data.totalCoins,
            finalWave: (this.waveState?.index ?? 0) + 1,
            finalWaveName: this.waveState?.name ?? '',
            chestsOpened: this.chestsOpened ?? 0,
            weapons: this.weaponSystem.snapshotForUI(),
            passives: this.passiveSystem.snapshotForUI(),
            evolutions: this.weaponSystem.owned
                .filter((w) => WEAPONS[w.id]?.evolved)
                .map((w) => WEAPONS[w.id].name),
        };

        // Daily Road score + payout — banked once per run (a daily can die at
        // any point, so it's NOT gated on _gauntletActive).
        this._bankDailyRoad();
        // KINDLED PR5 — accrue this run's rite progress (every run, keyed by the run
        // hero) + bank the Rite-Trial best-of-day (trial runs only). Both latched.
        this._accrueRiteProgress();
        this._bankRiteTrial();
        this._bankBossRush();

        // Fold the run into lifetime/best records; capture which bests were
        // beaten so the game-over summary can flag them. Skip if a victory-leave
        // already recorded this run (so the 3 boss kills aren't counted twice).
        this.newBest = this._runRecorded ? null : this.saveSystem.recordRun(this.runSummary);
        this._runRecorded = true;
        // Day streak (idempotent within a day): today now counts as played.
        this.runSummary.streak = this.saveSystem.recordDayStreak(currentDayNumber());
        // Award battle-pass (vigil) XP from the run and surface the gain on the
        // game-over screen.
        // Newly-earned lifetime achievements (claim + grant coins; surfaced on
        // the game-over summary + the Stats tab). Done after recordRun so the
        // run's stats are already folded into lifetime totals.
        this._checkAchievements();
        this._checkDailyChallenges();
        this.bpResult = awardBattlePassRun(this.saveSystem, this.runSummary);
        // Difficulty/modifier Pass-XP bonus (Hard = +50%, mods add more).
        if (this.runBonus?.xp > 0 && this.bpResult && this.bpResult.gained > 0) {
            const bonus = Math.round(this.bpResult.gained * this.runBonus.xp);
            if (bonus > 0) { this.saveSystem.addBattlePassXp(bonus); this.bpResult.gained += bonus; }
        }

        // EMBERGLASS: stamp who dealt the killing blow onto the run summary and
        // queue the death recap card — it composes on the next render() once the
        // world death frame is captured.
        this.runSummary.killedBy = this.lastHitBy || null;
        this._queueDeathCard();

        this._updateJoystickEnabled();
    }

    // ── EMBERGLASS: auto-minted death / victory share cards ─────────────────
    _cardHeroName(id) {
        return (CHARACTERS[id] && CHARACTERS[id].name) || 'The Keeper';
    }
    _cardMapName(id) {
        try { const m = getMap(id); return (m && m.name) || ''; } catch (e) { return ''; }
    }
    _cardDifficulty() {
        return this.difficulty === 'hard' ? 'NIGHTMARE'
            : this.difficulty === 'easy' ? 'EMBER' : 'STANDARD';
    }
    // Build the pending 'death' card data (composed next render()).
    _queueDeathCard() {
        if (this.bossRush) { this._queueBossRushCard('death'); return; }   // BOSSFORGE (Boss Rush + Weekly Ember)
        if (this.riteTrialMode) { this._queueRiteCard('death'); return; }   // KINDLED PR5
        const s = this.runSummary || {};
        const cid = this.saveSystem.getSelectedCharacter();
        const kills = s.kills ?? 0;
        const chips = [
            `WAVE ${s.finalWave ?? 1}`,
            `LV ${s.level ?? 1}`,
            `${kills.toLocaleString()} KILLS`,
            `${s.bossesDefeated ?? 0} ${(s.bossesDefeated === 1 ? 'BOSS' : 'BOSSES')}`,
        ];
        if (s.coinsEarned != null) chips.push(`${s.coinsEarned} COINS`);
        const nb = this.newBest;
        this._pendingCardMint = {
            template: 'death',
            data: {
                name: this._cardHeroName(cid), characterId: cid,
                time: s.time ?? this.time,
                killer: this.lastHitBy || null,
                chips,
                newBest: !!(nb && (nb.time || nb.wave || nb.level || nb.kills)),
                mapName: this._cardMapName(this._effectiveMapId()),
                difficulty: this._cardDifficulty(),
            },
        };
    }
    // KINDLED PR5 — the Rite-Trial share card ('rite' template, reusing the Emberglass
    // compositor). Built from LIVE fields so it works at BOTH death- and victory-time;
    // the actual share fires later from a user tap (iOS gesture rule).
    _queueRiteCard(outcome) {
        const cid = this._effectiveCharacterId();
        const score = riteTrialScore({
            kills: this.kills, ults: this.ultsReleased,
            comboProcs: (this.player && this.player._comboProcs) || 0,
            bosses: this.bossesDefeated,
        });
        const rt = this.saveSystem.data.riteTrial;
        const storedBest = (rt && rt.day === currentDayNumber()) ? (rt.best ?? 0) : 0;
        const sig = signatureFor(cid);
        this._pendingCardMint = {
            template: 'rite',
            data: {
                name: this._cardHeroName(cid), characterId: cid,
                ultName: sig ? sig.name : '', day: currentDayNumber(),
                score, best: Math.max(storedBest, score), outcome: outcome || 'end',
                time: this.time,
                chips: [
                    `SCORE ${score.toLocaleString()}`,
                    `${this.ultsReleased} ULTS`,
                    `${(this.kills ?? 0).toLocaleString()} KILLS`,
                    `${this.bossesDefeated ?? 0} BOSSES`,
                ],
                mapName: this._cardMapName(this._effectiveMapId()),
                difficulty: this._cardDifficulty(),
            },
        };
    }
    // BOSSFORGE — the gauntlet share card ('bossrush' template; Boss Rush AND
    // Weekly Ember). Built from LIVE fields so it works at BOTH death- and
    // victory-time. Shows the hero, the gauntlet progress (bosses felled /
    // total), whether it was cleared, the apex reached, the time, and the run's
    // build (up to three owned weapons).
    _queueBossRushCard(outcome) {
        const cid = this._effectiveCharacterId();
        const st = this.bossRush
            ? this.bossRush.getStatus()
            : { bossesDefeated: this.bossesDefeated, total: 0, cleared: false, currentBossId: null, label: 'Boss Rush' };
        const cleared = !!st.cleared;
        const timeSurvived = Math.floor(this.time);
        const score = bossRushScore({ bossesDefeated: st.bossesDefeated, timeSurvived, cleared });
        // NEW BEST is computed against the CURRENT save record (banking may not
        // have run yet — the victory card is queued before victoryToMenu banks).
        let newBest = false;
        if (this.weeklyEmberMode) {
            const we = this.saveSystem.data.weeklyEmber;
            const wk = weeklyEmberSeed(currentDayNumber());
            const cur = (we && we.week === wk) ? (we.best ?? 0) : 0;
            newBest = score > cur;
        } else {
            const br = this.saveSystem.data.bossRush || {};
            newBest = score > (br.bestScore ?? 0) || st.bossesDefeated > (br.bestBosses ?? 0);
        }
        const reachedId = st.currentBossId
            || (this.bossRush && this.bossRush.sequence[this.bossRush.sequence.length - 1])
            || null;
        const reached = reachedId ? (ENEMY[reachedId]?.bossName ?? reachedId) : '—';
        let weaponNames = [];
        try {
            weaponNames = (this.weaponSystem.snapshotForUI() || [])
                .map((w) => w && w.name).filter(Boolean).slice(0, 3);
        } catch (_) { weaponNames = []; }
        const chips = [
            `${st.bossesDefeated}/${st.total} FELLED`,
            cleared ? 'CLEARED' : `REACHED ${String(reached).toUpperCase()}`,
        ];
        if (weaponNames.length) chips.push(weaponNames.join(' · ').toUpperCase());
        this._pendingCardMint = {
            template: 'bossrush',
            data: {
                name: this._cardHeroName(cid), characterId: cid,
                time: this.time,
                score, bosses: st.bossesDefeated, total: st.total,
                cleared, reached, outcome: outcome || 'end',
                newBest,
                modeLabel: (st.label || 'Boss Rush').toUpperCase()
                    + (this.weeklyEmberMode ? ` · WEEK ${weeklyEmberSeed(currentDayNumber())}` : ''),
                sub: cleared ? 'The apex gauntlet is broken' : `Fell to ${reached}`,
                chips, weapons: weaponNames,
                mapName: this._cardMapName(this._effectiveMapId()),
                difficulty: this._cardDifficulty(),
            },
        };
    }

    // Build the pending 'victory' card data from LIVE fields (runSummary does
    // not exist yet when the victory overlay appears).
    _queueVictoryCard() {
        if (this.bossRush) { this._queueBossRushCard('victory'); return; }   // BOSSFORGE (Boss Rush + Weekly Ember)
        if (this.riteTrialMode) { this._queueRiteCard('victory'); return; }   // KINDLED PR5
        const cid = this.saveSystem.getSelectedCharacter();
        const kills = this.kills ?? 0;
        this._pendingCardMint = {
            template: 'victory',
            data: {
                name: this._cardHeroName(cid), characterId: cid,
                time: this.time,
                sub: 'Three apex Hollow have fallen',
                chips: [
                    `LV ${this.player?.level ?? 1}`,
                    `${kills.toLocaleString()} KILLS`,
                    `${this.bossesDefeated ?? 0} BOSSES`,
                ],
                mapName: this._cardMapName(this._effectiveMapId()),
                difficulty: this._cardDifficulty(),
            },
        };
    }
    // Capture the world death/victory frame + compose the queued card. Called
    // from render() BEFORE the HUD/overlay draws, so the card background is
    // world-only. One drawImage + one compose, once per run.
    _mintPendingCard() {
        const pend = this._pendingCardMint;
        if (!pend) return;
        this._pendingCardMint = null;
        try {
            const comp = getCardCompositor();
            comp.captureFromCanvas(this.renderer.canvas);
            const canvas = comp.compose(pend.template, pend.data);
            // Stash the card's hero id so the share CAPTION always names the hero the
            // card ART shows — for a Rite Trial that's the trial hero (_effective-
            // CharacterId), which differs from the saved menu pick.
            if (canvas) this.mintedCard = { canvas, template: pend.template, heroId: pend.data && pend.data.characterId };
        } catch (e) { /* card is optional; never break the frame */ }
    }
    // Share the minted card via the compositor ladder. MUST run synchronously
    // inside a user-gesture handler (tryRestartAt / tryVictoryAt / keydown) so
    // the clipboard/share user-gesture holds.
    _shareMintedCard() {
        if (!this.mintedCard || !this.mintedCard.canvas) return;
        this._pressFeedback(this.victory ? 'vShare' : 'shareCard');
        try {
            getCardCompositor().share({
                title: 'EMBERWAKE',
                text: this._shareCardText(),
                filename: 'emberwake-card.png',
            }).then((res) => this._afterShare(res)).catch(() => this._afterShare(null));
        } catch (e) { this._afterShare(null); }
    }
    _shareCardText() {
        // Name the hero the minted card ART shows (the trial hero for a Rite Trial),
        // falling back to the saved pick for any card minted without a stashed id.
        const name = this._cardHeroName((this.mintedCard && this.mintedCard.heroId) || this.saveSystem.getSelectedCharacter());
        if (this.victory) return `${name} held the light in EMBERWAKE.`;
        const k = this.runSummary && this.runSummary.killedBy;
        if (k && k.label) {
            const who = (k.boss || k.hazard) ? k.label : `a ${k.label}`;
            return `${name} fell to ${who} in EMBERWAKE.`;
        }
        return 'A run in EMBERWAKE.';
    }
    _afterShare(res) {
        const method = (res && res.method) || 'none';
        const text = { clipboard: 'COPIED TO CLIPBOARD', share: 'SHARED',
            download: 'SAVED AS PNG', none: 'SHARE FAILED — TRY AGAIN' }[method] || 'SAVED AS PNG';
        this.shareToast = { text, timer: EMBERGLASS.toast.duration };
        if (res && res.ok && method !== 'none') this.saveSystem.incrementStat('cardsShared', 1);
    }

}

// Photo mode (EMBERGLASS) lives in PhotoModeController.js; splice its methods
// onto the prototype so every this._photoX() call resolves unchanged.
Object.assign(Game.prototype, PhotoModeMethods);
// Run-state creation/reset (_initRunState) lives in RunState.js; splice it onto
// the prototype so _startRun and the boot-time build resolve it unchanged.
Object.assign(Game.prototype, RunStateMethods);
// Gameplay update pipeline (update + the _updateX steps) lives in GameUpdate.js;
// splice it onto the prototype so game.update(dt) and every internal step resolve
// unchanged.
Object.assign(Game.prototype, GameUpdateMethods);
// Render pipeline (render + the _drawX steps) lives in GameRender.js; splice it
// onto the prototype so game.render() and every internal step resolve unchanged.
Object.assign(Game.prototype, GameRenderMethods);
// Combat resolution + kill/drop flow (_resolveCombat + the _dropX/_applyAffixDeath/
// _splitOnDeath helpers) lives in CombatResolver.js; splice it onto the prototype
// so the update pipeline's this._resolveCombat() and every drop call resolve unchanged.
Object.assign(Game.prototype, CombatResolverMethods);
// Pointer/key/menu action routing (_menuAction + the buy/select/toggle actions)
// lives in GameInputActions.js; splice it onto the prototype so the constructor's
// input listeners and the UI resolve every action unchanged.
Object.assign(Game.prototype, GameInputActionMethods);
