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
    GEM,
    GEM_TIERS,
    HEALTH_DROP,
    ENEMY,
    BOSS,
    CHEST,
    COIN,
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
} from '../config/GameConfig.js';
import { TWO_PI, clamp, pickWeighted, compactInPlace } from './MathUtils.js';
import { Easing } from './Easing.js';
import { Camera } from './Camera.js';
import { Player } from '../entities/Player.js';
import { Enemy } from '../entities/Enemy.js';
import { XPGem } from '../entities/XPGem.js';
import { Chest } from '../entities/Chest.js';
import { Shrine } from '../entities/Shrine.js';
import { Coin } from '../entities/Coin.js';
import { HealthOrb } from '../entities/HealthOrb.js';
import { EnemyProjectile } from '../entities/EnemyProjectile.js';
import { DamageNumber } from '../entities/DamageNumber.js';
import { Spawner } from '../systems/Spawner.js';
import { WeaponSystem } from '../systems/WeaponSystem.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { UpgradeSystem } from '../systems/UpgradeSystem.js';
import { PassiveSystem } from '../systems/PassiveSystem.js';
import { WaveDirector } from '../systems/WaveDirector.js';
import { BossDirector } from '../systems/BossDirector.js';
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
import { LieutenantDirector } from '../systems/LieutenantDirector.js';
import { resolveStartingWeapon, applyLoadout } from '../systems/LoadoutSystem.js';
import { resolveWeaponSkin, isMeleeWeapon } from '../content/weaponSkins.js';
import { evaluateAchievements } from '../content/achievements.js';
import { evaluateDaily, currentDayNumber } from '../content/dailyChallenges.js';
import { DIFFICULTY, RUN_MODIFIERS, RUN_MODIFIER_MAX_BONUS } from '../config/GameConfig.js';
import { applyCharacter } from '../systems/CharacterSystem.js';
import { CHARACTERS, CHARACTER_IDS } from '../content/characters.js';
import { getBorderStrip, getBorderPattern } from '../assets/ObstacleSprites.js';
import { awardRun as awardBattlePassRun, claim as claimBattlePass, claimAll as claimAllBattlePass } from '../systems/BattlePassSystem.js';
import { openCase } from '../systems/CaseSystem.js';
import { resolveAppearance, cosmeticsForAchievement, COSMETICS, cosmeticCoinCost } from '../content/cosmetics.js';
import { WEAPONS, computePlayerAura } from '../content/weapons.js';
import { PERMANENT_UPGRADES, applyPermanentUpgrades, nextCost } from '../content/permanentUpgrades.js';
import { OBJECTIVES } from '../content/objectives.js';
import { getMap, getMapBosses, getMapTier, MAP_ORDER, DEFAULT_MAP } from '../content/maps.js';
import { UISystem } from '../systems/UISystem.js';
import { GFX, LIGHT_COLORS } from '../config/GameConfig.js';
import { HazardSystem } from '../systems/HazardSystem.js';
import { MinigameOverlay } from '../systems/MinigameOverlay.js';
import { buildUIState } from '../systems/UIStateBuilder.js';
import { TOUR_STEPS } from '../content/tutorialTour.js';
import { getCardCompositor } from '../systems/CardCompositor.js';
import { EMBERGLASS } from '../config/GameConfig.js';

const DEBUG_BUTTON_TOUCH_SLOP = 24;

// Half the largest sprite (~91) + bar/label headroom + max camera shake.
// Anything whose center is farther than this from the view edge can't
// contribute a visible pixel and is skipped at draw time.
const CULL_MARGIN = 160;

// Second Wind only regenerates when no enemy is within this radius.
const SECOND_WIND_RADIUS = 340;

// Victory beat: hold the triumphant world — the hero cheering in its victory
// pose — before the overlay dims in, and swallow input for the same window so
// an early tap can't blind-hit a not-yet-visible button (mirrors the game-over
// death beat + its dismiss lockout).
const VICTORY_BEAT = 0.7;

// Death-burst tint per enemy type (boss/elite handled separately).
const DEATH_COLORS = {
    slime: '#7be08a',
    bat: '#b48cff',
    crawler: '#9a7cff',
    brute: '#d8a060',
    // P1.3 behavior types burst in their tell color.
    splitter: '#b48cff',
    bomber: '#ffd166',
    summoner: '#c97bff',
    teleporter: '#7fe0ff',
};
function deathColor(e) {
    if (e.boss) return '#ffd27a';
    if (e.elite) return '#ffe08a';
    return DEATH_COLORS[e.type] ?? '#ffcaa0';
}
function gemLightColor(tier) {
    if (tier === 'large') return LIGHT_COLORS.gemLarge;
    if (tier === 'medium') return LIGHT_COLORS.gemMedium;
    return LIGHT_COLORS.gemSmall;
}

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
        // Adaptive graphics governor state. level 0 = full quality.
        this._gfxLevel = 0;
        this._gfxLowTimer = 0;
        this._gfxHighTimer = 0;
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
        // Performance/accessibility render flags (re-read at each run start).
        this.damageNumbersEnabled = this.saveSystem.getSetting('damageNumbers') !== false;
        this.particlesEnabled = this.saveSystem.getSetting('particles') !== false;
        this.reducedEffects = this.saveSystem.getSetting('reducedEffects') === true;

        window.addEventListener('keydown', (e) => {
            if (DEV_MODE && (e.code === 'Backquote' || e.code === 'F2')) {
                this.showDebug = !this.showDebug;
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
                    this.dailyMode = false;   // keyboard start is always a NORMAL run
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
    }

    // The effective map id for THIS run: the Daily Road override (unlock-bypassed,
    // so the day's map is force-allowed and truly the same for everyone) or, for a
    // normal run, the saved pick. Read everywhere the launch path resolves the map
    // so the override lands before _initRunState builds the BossDirector/tier.
    _effectiveMapId() {
        if (this.dailyMode && this._dailyMapOverride) return this._dailyMapOverride;
        return this.saveSystem.getSelectedMap();
    }

    _initRunState() {
        this.player = new Player(undefined, undefined, this.saveSystem.getSelectedCharacter());
        this.camera.follow(this.player);

        this.enemies = [];
        this.projectiles = [];
        this.enemyProjectiles = [];
        // Damaging area hazards (boss shockwaves) + their telegraph decals.
        // Game-owned pool; cleared here so a restart never inherits one.
        this.hazards = [];
        // ELITE bombers that self-detonated this frame — merged into the kill
        // pipeline by _resolveCombat so a dodged elite still pays its rolled
        // loot (affix death, chest/coin roll, gem, kill credit). A plain
        // bomber's self-boom stays deliberately reward-free.
        this._selfDetonated = [];
        // Expanding shockwave ring VFX (pure cosmetic; pooled). Spawned on
        // kills, boss deaths, and level-ups; updated + drawn in the world layer.
        this.rings = [];
        // Hit-stop: when > 0 the world sim freezes for these many seconds while
        // rendering continues — sells the weight of a heavy impact. Drained with
        // real dt at the top of the gameplay update.
        this.hitStop = 0;
        // Brief red screen-edge vignette pulse on taking damage (0..1, decays).
        this.hitVignette = 0;
        // Queue of boss summon requests (drained each frame into themed spawns).
        this.bossSummons = [];
        // Active "BOSS INCOMING" warning (the boss spawns when this expires).
        this.bossWarning = null;
        // Lieutenant mini-boss (mid-segment): a lightweight scheduler that fires
        // once per boss-to-boss stretch, a short telegraph, and a ref for its mini
        // HP bar. NOT a boss (never sets e.boss) — see _spawnLieutenant.
        this.lieutenantDirector = new LieutenantDirector();
        this.lieutenantWarning = null;
        this.activeLieutenantRef = null;
        // Daily Road per-run bookkeeping (score banked once at game-over/victory).
        this._dailyRoadRecorded = false;
        this.dailyRoadBest = false;
        this.gems = [];
        this.damageNumbers = [];

        // Patrons committed THIS run (drives the level-up draft weighting).
        // Reset here so a restart never inherits a stale commitment; populated
        // from selectedPatron in _startRun.
        this.committedPatrons = [];

        this.spawner = new Spawner();
        // The run begins with the weapon chosen in the loadout (defaults to the
        // Cinderbolt). Other weapons still appear as level-up choices.
        this.weaponSystem = new WeaponSystem(resolveStartingWeapon(this.saveSystem.data));
        this.collisionSystem = new CollisionSystem();
        this.upgradeSystem = new UpgradeSystem();
        this.passiveSystem = new PassiveSystem();
        this.waveDirector = new WaveDirector();
        // Per-map boss trio: cycle THIS map's three bosses (all must fall to
        // clear the map). Later maps carry their own tougher rosters.
        this.bossDirector = new BossDirector(getMapBosses(this._effectiveMapId()));
        // Difficulty rung of the selected map (1..4); folds into boss + enemy
        // scaling so each map plays a little harder than the last.
        this.mapTier = getMapTier(this._effectiveMapId());
        // Cache the current wave state so render can read it without
        // re-computing during the same frame.
        this.waveState = this.waveDirector.getState(0);

        // Chest pickup pauses gameplay just like a level-up. pendingChests
        // queues additional chests collected while the overlay is up.
        this.chests = [];
        this.chestReward = null;
        this.pendingChests = 0;
        this.chestsOpened = 0;
        // Wick Roads: shrines are walk-onto altars (the chest's sibling on a boss
        // kill); `altar` is the active pick-one overlay ({ choices, age }, null when
        // closed); pendingAltars queues shrines walked onto while an overlay is up;
        // _runRelics tracks relic ids claimed this run so a shrine never re-offers one.
        this.shrines = [];
        this.altar = null;
        this.pendingAltars = 0;
        this._runRelics = [];
        this._runPacts = [];
        // Branching Roads: the post-boss CROSSROADS (a fork reusing the altar
        // overlay) sets a DISPOSABLE per-segment bias — enemy-mix (segmentWeights)
        // + difficulty multipliers (segmentScale) folded into waveState each frame
        // by _applyRunScale, then cleared at the next boss (_clearSegmentRoad).
        // Run-only, never persisted. The boon a road grants at pick time is a modest
        // permanent player nudge — damage/speed ride the _applyPlayerCaps ceilings;
        // coins/regen are economy-only and naturally modest (never a power runaway).
        this.segmentScale = { hp: 1, speed: 1, damage: 1, elite: 1, cap: 1, interval: 1 };
        this.segmentWeights = null;
        this._segmentRoadId = null;
        // A boss kill flags this; the end-of-update presenter opens the CROSSROADS
        // once no other overlay is up, so a same-frame level-up never stacks with it.
        this.pendingCrossroads = false;
        // Weapon-aura cache (recomputed only when weaponSystem.version changes).
        this._auraVersion = -1;
        this._auraSnapshot = null;
        this.coins = [];
        this.healthOrbs = [];
        // Cached reference to the strongest active boss for the boss HP bar.
        this.activeBossRef = null;
        // Boss arena confinement ({ x, y, r } while a boss fight is sealed; null otherwise).
        this.arena = null;
        this.bossesDefeated = 0;
        // Victory overlay shown once when the 3rd boss falls (Continue / new
        // biome / main menu). _victoryShown latches so later bosses don't reopen
        // it; _runRecorded guards against double-counting lifetime stats when a
        // victory-leave records the run and game-over would otherwise too.
        this.victory = null;
        this._victoryShown = false;
        this._runRecorded = false;
        this.runSummary = null;
        // EMBERGLASS: clear the last run's killer attribution + minted share card
        // so a fresh run never reuses a stale card/toast.
        this.lastHitBy = null;
        this.mintedCard = null;
        this.shareToast = null;
        this._pendingCardMint = null;
        this.photoMode = null;
        this._suppressToolbar = false;
        this._dragPhotoPrev = null;
        if (this.camera) this.camera.zoom = 1;
        // Gauntlet (endless) scoring — armed only after a 3rd-boss victory
        // continuation; banked on the next death.
        this._gauntletActive = false;
        this.gauntletScore = 0;
        this.gauntletBest = false;

        this.time = 0;
        this.kills = 0;
        // Kill-streak / combo state (feedback only — see COMBO config).
        this.combo = 0;
        this.comboTimer = 0;
        this.comboBest = 0;
        this._comboMilestoneIdx = 0;
        // Twilight (elite-army endgame) one-shot announce latch.
        this._twilightAnnounced = false;
        // Hypergrowth ("the wall", compounding from min 20) one-shot announce latch.
        this._hyperAnnounced = false;
        // Run objectives: ids completed this run + the list (for the game-over
        // summary). Repeatable each run.
        this._objDone = new Set();
        this._objCompleted = [];
        this.upgradeChoices = null;
        this.pendingLevelUps = 0;
        this.gameOver = false;
        if (this.player) this.player.poseOverride = null;   // clear run-end pose
        // bankedThisRun guards against double-banking run coins if game-over
        // somehow fires more than once for the same run.
        this.bankedThisRun = false;

        // Overlay entrance-animation clocks (advanced while the overlay is
        // open so the UI can ease elements in instead of popping).
        this.levelUpAge = 0;
        this.gameOverAge = 0;

        // Transient full-screen feedback events (hit/heal/levelup flashes).
        this.feedback = [];
        // Tracks HP between frames so a rise can fire a heal flash centrally.
        this._lastHp = this.player.maxHp;
        // Battle-pass XP gained by the last finished run (set in _enterGameOver,
        // drawn on the game-over summary). Cleared so a restart can't show stale XP.
        this.bpResult = null;
        // Starting coins granted by the shop this run — _bankRunCoins banks
        // them only for a PLAYED run (see the guard there), so an instant
        // pause→RESTART abandon can't mint the seed for free.
        this.startingCoinsGranted = 0;

        // A fresh run should never inherit a half-armed save-reset confirm.
        this.resetConfirming = false;
        this.paused = false;
        // Level-up agency resources (granted from the shop in _startRun).
        this.rerolls = 0;
        this.banishes = 0;
        this.alters = 0;
        // Records beaten this run (set at game-over for the NEW BEST banner).
        this.newBest = null;

        // Drop any particles left over from the previous run.
        if (this.particles) this.particles.reset();

        if (this.input.touch) this.input.touch.setEnabled(true);
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
        } else {
            this._dailySetup = null;
            this._dailyMapOverride = null;
        }
        this._initRunState();
        // Character base stats apply FIRST so permanent upgrades / gear /
        // passives / run upgrades all stack cleanly on top of the hero's
        // baseline (and the sprite already matches the selected character).
        applyCharacter(this.player, this.saveSystem.getSelectedCharacter());
        const coinsBefore = this.player.coins ?? 0;
        applyPermanentUpgrades(this.player, this.saveSystem.data);
        // Relic Attunement (coin sink): fold in every saved attunement level ONCE,
        // right after permanent upgrades — they're the same class of meta bonus
        // (defensive/utility only, no raw weapon damage; see relics.js ATTUNABLE).
        applyAttunements(this.player, this.saveSystem.getRelicAttunements());
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
        this.mapRenderer.lowQuality = this.reducedEffects;
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
        this.onboarding = (!SKIP_ONBOARDING
            && ((this.saveSystem.data.stats?.runs ?? 0) === 0 || this._forceRunHints))
            ? { step: 0, timer: 0, moved: 0, armed: true }
            : null;
        this._forceRunHints = false;   // Replay-Tutorial re-teach is one run only
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
    }

    restart() {
        // Leaving a live (paused) run still banks what was earned, matching
        // the death path. No-op once already banked this run.
        this._bankRunCoins();
        // A RESTART is a fresh NORMAL run — never silently re-launch a Daily.
        this.dailyMode = false;
        this._startRun();
    }

    returnToShop() {
        this._bankRunCoins();
        this.audio.playMusic('menu');
        this.screen = 'start';
        this.resetConfirming = false;
        this.resetConfirmTimer = 0;
        this.paused = false;
        // Back at the menu, a Daily is over — clear the flag so the next launch
        // (button OR keyboard) is a normal run unless DAILY ROAD is chosen again.
        this.dailyMode = false;
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
        const char = this.saveSystem.getSelectedCharacter();
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
    }

    toggleScreenShake() {
        this.shakeEnabled = !this.shakeEnabled;
        this.saveSystem.setSetting('screenShake', this.shakeEnabled);
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

    // Re-roll the current level-up offer (costs one reroll charge).
    rerollChoices() {
        if (!this.upgradeChoices || this.rerolls <= 0) return;
        this.rerolls -= 1;
        this.audio.reroll();
        const choices = this.upgradeSystem.rollChoices(this, 3);
        this.setUpgradeChoices(choices.length > 0 ? choices : this.upgradeChoices);
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
            case 'startRun': this._pressFeedback('start'); this.dailyMode = false; this._startRun(); break;
            case 'startDaily': this._pressFeedback('start'); this.dailyMode = true; this._startRun(); break;
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
    }

    _toggleSetting(key) {
        const cur = this.saveSystem.getSetting(key) === true;
        this.saveSystem.setSetting(key, !cur);
        if (key === 'debug') this.showDebug = !cur;
    }

    _adjustVolume(key, delta) {
        const cur = typeof this.saveSystem.getSetting(key) === 'number' ? this.saveSystem.getSetting(key) : 0.7;
        this.saveSystem.setSetting(key, clamp(cur + delta, 0, 1));
        this.audio.setVolumes(this.saveSystem.getSetting('volMusic'), this.saveSystem.getSetting('volSfx'));
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
        if (!this.input.touch) return;
        const blocked = this.screen !== 'gameplay' || this.paused ||
            !!this.upgradeChoices || !!this.chestReward || !!this.altar || !!this.victory;
        this.input.touch.setEnabled(!blocked);
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
        const bossHpMul = (BOSS.baseHpMul ?? 1) * Math.min(1 + minutes * BOSS.hpPerMinute, BOSS.maxHpMul) * tierMul * (this.runScale?.hp ?? 1) * mapHpMul;
        const bossDmgMul = (this.waveState.damageMul ?? 1) * (1 + encounter * 0.12) * mapDmgMul;
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

    _dropChest(x, y) {
        const s = this._clearSpot(x, y, 40);
        this.chests.push(new Chest(s.x, s.y));
    }

    // Boss reward: spawn a treasure chest AND a Wick Shrine to either side of the
    // death point. They're linked as siblings — walking onto one claims it and
    // despawns the other, so the player PICKS ONE (chest reward or relic altar).
    _dropBossReward(x, y) {
        const off = WICK_ROADS.bossRewardOffset;
        const cs = this._clearSpot(x - off, y, 40);
        const ss = this._clearSpot(x + off, y, 40);
        const chest = new Chest(cs.x, cs.y);
        const shrine = new Shrine(ss.x, ss.y);
        chest._sibling = shrine;
        shrine._sibling = chest;
        this.chests.push(chest);
        this.shrines.push(shrine);
    }

    _dropCoin(x, y, value = 1) {
        if (this.obstacleSystem.isBlocked(x, y, 18)) { const s = this._clearSpot(x, y, 18); x = s.x; y = s.y; }
        this.coins.push(new Coin(x, y, value));
    }

    _dropCoinBurst(x, y, count, value) {
        for (let i = 0; i < count; i++) {
            const ox = x + (Math.random() - 0.5) * 36;
            const oy = y + (Math.random() - 0.5) * 36;
            this._dropCoin(ox, oy, value);
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

    // Elite affix on-death effects. Volatile detonates an AoE; Splitting
    // bursts into a few crawlers (non-elite, so no recursive splitting).
    _applyAffixDeath(e) {
        const def = e.affixDef;
        if (!def) return;
        if (e.affix === 'volatile') {
            // A crowd-damaging blast should never be silent (muffled thump).
            if (this._inView(e.x, e.y, 120)) this.audio.volatileBoom();
            const r2 = def.explodeRadius * def.explodeRadius;
            for (const other of this.enemies) {
                if (!other.active || other === e) continue;
                const dx = other.x - e.x;
                const dy = other.y - e.y;
                if (dx * dx + dy * dy > r2) continue;
                other.takeDamage(def.explodeDamage);
                this.damageNumbers.push(new DamageNumber(
                    other.x, other.y - other.radius, def.explodeDamage, '#ffae66'
                ));
                // A blast kill must flow through the normal reward path or the
                // explosion silently eats the XP/kill-count for everything it
                // wipes. We route gem + burst + tally here (NOT a recursive
                // affix death, so a clump of volatiles can't chain-detonate).
                if (!other.active) {
                    this.kills += 1;
                    this.particles.deathBurst(other.x, other.y, deathColor(other));
                    this._dropGem(other.x, other.y);
                }
            }
            // AoE ring + ember burst + a light kick so the blast reads.
            this.weaponSystem.effects.push({
                kind: 'pulse', x: e.x, y: e.y, radius: def.explodeRadius,
                age: 0, lifetime: 0.4, active: true,
            });
            this.particles.deathBurst(e.x, e.y, def.tint);
            this._shake(SCREEN_SHAKE.intensity * 0.6, 0.25);
        } else if (e.affix === 'splitting') {
            const count = def.spawnCount ?? 2;
            const type = def.spawnType ?? 'crawler';
            // Alive-cap gated per child (same as _splitOnDeath below): a
            // twilight AoE wipe can pop many splitting affixes in one frame,
            // and an on-death spawn must not burst past maxAlive.
            const cap = this.waveState?.maxAlive ?? 120;
            let live = 0;
            for (const o of this.enemies) if (o.active) live++;
            for (let i = 0; i < count; i++) {
                if (live >= cap) break;
                const a = (i / count) * TWO_PI + Math.random() * 0.5;
                const ox = e.x + Math.cos(a) * 40;
                const oy = e.y + Math.sin(a) * 40;
                this.enemies.push(new Enemy(type, ox, oy, {
                    healthMul: this.waveState.healthMul,
                    speedMul: this.waveState.speedMul,
                }));
                live++;
            }
        }
    }

    // P1.3 splitter (def.splitInto) on-death burst: children spawn WEAKENED
    // (hpFrac of the live wave scale) as plain types — never elite, never a
    // splitter — so a split can't recurse or double-dip the reward path
    // (children pay their own small XP when the player actually kills them).
    _splitOnDeath(e) {
        const s = e.def.splitInto;
        const count = s.count ?? 2;
        // Alive-cap gated like every other mid-fight spawn path (summoner
        // calls, boss support, pack spawns): re-check before EACH child so an
        // AoE wipe of a splitter clump can't burst past maxAlive.
        const cap = this.waveState?.maxAlive ?? 120;
        let live = 0;
        for (const o of this.enemies) if (o.active) live++;
        for (let i = 0; i < count; i++) {
            if (live >= cap) break;
            const a = (i / count) * TWO_PI + Math.random() * 0.6;
            this.enemies.push(new Enemy(s.type ?? 'slime', e.x + Math.cos(a) * 46, e.y + Math.sin(a) * 46, {
                healthMul: this.waveState.healthMul * (s.hpFrac ?? 0.5),
                speedMul: this.waveState.speedMul,
                contactDamageMul: this.waveState.damageMul ?? 1,
            }));
            live++;
        }
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
    // Build the pending 'victory' card data from LIVE fields (runSummary does
    // not exist yet when the victory overlay appears).
    _queueVictoryCard() {
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
            if (canvas) this.mintedCard = { canvas, template: pend.template };
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
        const name = this._cardHeroName(this.saveSystem.getSelectedCharacter());
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

    // ── EMBERGLASS: the Keeper's Lens (photo mode) ──────────────────────────
    _enterPhotoMode(returnTo) {
        if (this.photoMode) return;
        this.photoMode = {
            gridOn: false,
            hudShown: false,
            toolbarFade: EMBERGLASS.photo.toolbarFade,
            returnTo: returnTo || (this.paused ? 'paused' : this.screen === 'gameOver' ? 'gameOver' : 'gameplay'),
        };
        // Detach the camera + zero shake so the free-cam holds perfectly still.
        this.camera.target = null;
        this.camera.trauma = 0;
        this.camera.shakeOffsetX = 0; this.camera.shakeOffsetY = 0; this.camera.shakeAngle = 0;
        this.camera.zoom = 1;
        this._dragPhotoPrev = null;
        if (this.audio && this.audio.click) this.audio.click();
    }
    _exitPhotoMode() {
        if (!this.photoMode) return;
        this.photoMode = null;
        this._suppressToolbar = false;
        this._dragPhotoPrev = null;
        this.camera.zoom = 1;
        // Re-attach to the player (snaps position + zeroes trauma/offsets).
        if (this.player) this.camera.follow(this.player);
        if (this.audio && this.audio.click) this.audio.click();
    }
    _photoZoomBy(factor) {
        if (!this.photoMode) return;
        const p = EMBERGLASS.photo;
        this.camera.zoom = Math.max(p.zoomMin, Math.min(p.zoomMax, this.camera.zoom * factor));
        this.photoMode.toolbarFade = p.toolbarFade;
    }
    _updatePhotoMode(dt) {
        const pm = this.photoMode; if (!pm) return;
        const p = EMBERGLASS.photo;
        // Keyboard / joystick pan (÷zoom keeps apparent speed constant).
        const mv = this.input.getMovement();
        if (mv && (mv.x || mv.y)) {
            const spd = (p.panSpeed / (this.camera.zoom || 1)) * dt;
            this.camera.x += mv.x * spd;
            this.camera.y += mv.y * spd;
            pm.toolbarFade = p.toolbarFade;
        }
        // Clamp to the world bounds (minus a margin) so the void wall never shows.
        const mx = WORLD_WIDTH / 2 - p.worldMargin, my = WORLD_HEIGHT / 2 - p.worldMargin;
        this.camera.x = Math.max(-mx, Math.min(mx, this.camera.x));
        this.camera.y = Math.max(-my, Math.min(my, this.camera.y));
        pm.toolbarFade = Math.max(0, pm.toolbarFade - dt);
        if (this.shareToast) { this.shareToast.timer -= dt; if (this.shareToast.timer <= 0) this.shareToast = null; }
        this.camera.update(dt);
    }
    _photoFilterName() { return "KEEPER'S EYE"; }   // PR3 expands the filter table
    // SNAP: render one toolbar-free frame synchronously (so the shot excludes the
    // toolbar), capture it, compose the 'photo' card, and run the share ladder —
    // all inside the tap gesture so clipboard/share holds.
    _snapPhoto() {
        if (!this.photoMode) return;
        this._suppressToolbar = true;
        try { this.render(); } catch (e) { /* toolbar-free frame */ }
        this._suppressToolbar = false;
        try {
            const comp = getCardCompositor();
            comp.captureFromCanvas(this.renderer.canvas);
            const canvas = comp.compose('photo', { filterName: this._photoFilterName() });
            if (canvas) this.mintedCard = { canvas, template: 'photo' };
            this.saveSystem.incrementStat('photosTaken', 1);
            comp.share({ title: 'EMBERWAKE', text: 'A shot from EMBERWAKE.', filename: 'emberwake-photo.png' })
                .then((res) => {
                    const m = (res && res.method) || 'none';
                    this.shareToast = { text: { clipboard: 'PHOTO COPIED', share: 'PHOTO SHARED',
                        download: 'PHOTO SAVED', none: 'SAVE FAILED' }[m] || 'PHOTO SAVED', timer: EMBERGLASS.toast.duration };
                })
                .catch(() => { this.shareToast = { text: 'PHOTO SAVED', timer: EMBERGLASS.toast.duration }; });
        } catch (e) { /* snap is best-effort */ }
        if (this.photoMode) this.photoMode.toolbarFade = EMBERGLASS.photo.toolbarFade;
    }
    // Pointer/tap dispatch while the Lens is open (drag pans; toolbar buttons act).
    _tryPhotoAt(clientX, clientY, phase) {
        if (!this.photoMode) return false;
        const pos = this.renderer.clientToInternal(clientX, clientY);
        if (phase === 'down') {
            const rects = this.ui.getPhotoToolbarRects();
            for (const b of rects) {
                if (inRect(pos, b.rect, 0)) {
                    this.photoMode.toolbarFade = EMBERGLASS.photo.toolbarFade;
                    if (b.id === 'snap') this._snapPhoto();
                    else if (b.id === 'grid') this.photoMode.gridOn = !this.photoMode.gridOn;
                    else if (b.id === 'hud') this.photoMode.hudShown = !this.photoMode.hudShown;
                    else if (b.id === 'zoomIn') this._photoZoomBy(EMBERGLASS.photo.zoomStep);
                    else if (b.id === 'zoomOut') this._photoZoomBy(1 / EMBERGLASS.photo.zoomStep);
                    else if (b.id === 'exit') this._exitPhotoMode();
                    return true;
                }
            }
            this._dragPhotoPrev = pos;   // start a pan drag
            this.photoMode.toolbarFade = EMBERGLASS.photo.toolbarFade;
            return true;
        }
        if (phase === 'move' && this._dragPhotoPrev) {
            const z = this.camera.zoom || 1;
            this.camera.x -= (pos.x - this._dragPhotoPrev.x) / z;
            this.camera.y -= (pos.y - this._dragPhotoPrev.y) / z;
            this._dragPhotoPrev = pos;
            this.photoMode.toolbarFade = EMBERGLASS.photo.toolbarFade;
            return true;
        }
        if (phase === 'up') { this._dragPhotoPrev = null; return true; }
        return true;   // consume all pointer events while the Lens is up
    }

    update(dt) {
        // Feedback flashes + press states tick on every screen so they
        // animate even while gameplay is frozen behind an overlay.
        this._updateFeedback(dt);

        // Death is authoritative and checked FIRST: if the player is dead,
        // enter game-over even when an overlay is open, so a queued-overlay
        // chain (chest reward → next overlay) can never strand a dead player
        // in a frozen world.
        if (this.screen === 'gameplay' && !this.gameOver && this.player.isDead()) {
            this._enterGameOver();
        }

        // EMBERGLASS: the Keeper's Lens freezes the world regardless of the
        // underlying screen (gameplay / paused / game-over) — only the detached
        // free-cam ticks. Strictly cheaper than gameplay, so never a perf risk.
        if (this.photoMode) { this._updatePhotoMode(dt); return; }

        // Meta-screen states never tick gameplay; the start screen still
        // ticks the reset-confirm timeout so the "tap again to confirm"
        // prompt times out cleanly.
        if (this.screen === 'start') {
            this._updateMenuScreen(dt);
            return;
        }
        if (this.screen === 'gameOver') {
            this.gameOverAge += dt;
            if (this.shareToast) { this.shareToast.timer -= dt; if (this.shareToast.timer <= 0) this.shareToast = null; }
            this.camera.update(dt);
            return;
        }
        if (this.upgradeChoices) {
            this.levelUpAge += dt;
            this.camera.update(dt);
            return;
        }
        if (this.chestReward) {
            // Tick the chest-overlay animation but freeze gameplay so the
            // world behind it stays exactly as it was when the chest opened.
            this.chestReward.age += dt;
            this.camera.update(dt);
            return;
        }
        if (this.altar) {
            // Wick Shrine altar overlay — freeze the world behind it (same as
            // chest/level-up); only the overlay animation + camera tick.
            this.altar.age += dt;
            this.camera.update(dt);
            return;
        }
        if (this.victory) {
            // 3rd-boss victory overlay: freeze the world behind it.
            this.victory.age += dt;
            if (this.shareToast) { this.shareToast.timer -= dt; if (this.shareToast.timer <= 0) this.shareToast = null; }
            this.camera.update(dt);
            return;
        }
        if (this.paused) {
            // Frozen world; only the camera settles.
            this.camera.update(dt);
            return;
        }

        // Hit-stop: freeze the simulation for a few frames on a heavy impact but
        // keep the camera (and its shake) animating, so the freeze reads as
        // weight rather than a stutter. Drained with real dt.
        if (this.hitStop > 0) {
            this.hitStop = Math.max(0, this.hitStop - dt);
            this.camera.update(dt);
            return;
        }

        this.time += dt;

        this._updateComboAndObjectives(dt);
        this._updateDirectors(dt);
        const weaponResult = this._updatePlayerAndWeapons(dt);
        const statusResult = this._updateEnemies(dt);
        this._updateProjectiles(dt);
        // Boss area hazards (shockwaves, delayed zones, beams, lingering
        // pools) — simmed by the HazardSystem. Runs BEFORE the Second Wind
        // regen check so HP/i-frames stay consistent within the frame.
        // updateBiome first spawns this map's signature ground patches
        // (P1.2) into the same pool, so a fresh patch telegraphs this frame.
        this.hazardSystem.updateBiome(dt, this);
        this.hazardSystem.update(dt, this);
        this._updatePickups(dt);
        this._resolveCombat(dt, weaponResult, statusResult);
        this._updateWorldFx(dt);
        this._updateRewardOverlays(dt);
        this._updateEnemyScanAndCleanup(dt);
    }

    // ── update() phase methods (P1.5 split) — one per sim stage, called in
    // exactly the order the old monolithic body ran ───────────────────────

    // Start-screen tick: reset-confirm timeout, minigame overlays, toast.
    _updateMenuScreen(dt) {
        if (this.resetConfirming) {
            this.resetConfirmTimer -= dt;
            if (this.resetConfirmTimer <= 0) this.resetConfirming = false;
        }
        this.minigame.update(dt);
        if (this.menuToastTimer > 0) this.menuToastTimer -= dt;
    }

    // Combo decay + run-objective checks.
    _updateComboAndObjectives(dt) {
        // Combo decay: the streak lapses if no kill lands inside the window.
        if (this.comboTimer > 0) {
            this.comboTimer -= dt;
            if (this.comboTimer <= 0) { this.combo = 0; this._comboMilestoneIdx = 0; }
        }
        this._checkObjectives();
    }

    // Wave/boss/lieutenant direction: wave-state rebuild + announcements,
    // boss + lieutenant scheduling/warnings, boss-summon drain, and the boss
    // HP-threshold phases.
    _updateDirectors(dt) {
        this.waveDirector.update(dt, this.time, this.enemies.length);
        this.waveState = this._applyRunScale(this.waveDirector.getState(this.time));
        // Feed the composure gate: how far the time-based endless damage ramp has
        // climbed (0 through the whole normal campaign). The player's takeDamage
        // uses this to relieve the surcharge for clean play — see COMPOSURE.
        if (this.player) this.player.endlessSurcharge = this.waveState.endlessDamageSurcharge ?? 0;
        // TWILIGHT onset — announce the elite-army climax once, with a cue.
        if (this.waveState.twilight && !this._twilightAnnounced) {
            this._twilightAnnounced = true;
            this.waveDirector.announce('✦ TWILIGHT — THE HORDE TURNS ✦', 3.6, '#c97bff');
            this.audio.dreadDrone();
            this._shake(SCREEN_SHAKE.intensity * 0.7, 0.5);
        }
        // HYPERGROWTH onset — the wall begins; enemies now compound every minute.
        if ((this.waveState.hyperMul ?? 1) > 1 && !this._hyperAnnounced) {
            this._hyperAnnounced = true;
            this.waveDirector.announce('☠ THE DARK DEVOURS — FLEE OR FALL ☠', 4.0, '#ff3326');
            this.audio.dreadDrone();
            this._shake(SCREEN_SHAKE.intensity * 0.9, 0.6);
        }
        // Wave transition: one low horn swell as the Vigil index advances (the
        // banner is queued by WaveDirector). time<1 resyncs the latch per run.
        if (this.time < 1 || this._lastWaveIdx === undefined) this._lastWaveIdx = this.waveState.index;
        else if (this.waveState.index !== this._lastWaveIdx) {
            this._lastWaveIdx = this.waveState.index;
            this.audio.waveStart();
        }

        // One boss at a time: gate the scheduler on a live "is any boss alive"
        // check so a scheduled spawn is held (not stacked) while one is active.
        // A scheduled boss first opens a WARNING window (BOSS INCOMING) so the
        // player can reposition; it actually spawns when the warning expires.
        const bossAlive = this.enemies.some((e) => e.active && e.boss);
        if (!bossAlive && !this.bossWarning) {
            const bossId = this.bossDirector.update(this.time, bossAlive);
            if (bossId) this._startBossWarning(bossId);
        }
        if (this.bossWarning) {
            this.bossWarning.timer -= dt;
            if (this.bossWarning.timer <= 0) {
                const id = this.bossWarning.id;
                this.bossWarning = null;
                this._spawnBoss(id);
            }
        }
        // Lieutenant: one mid-segment mini-boss per boss window. Gated on NO boss
        // incoming/alive AND no live lieutenant so it never overlaps the boss
        // setpiece; the swarm keeps running (unlike a boss). A short telegraph
        // precedes the spawn. `bossAlive` is reused from the boss gate above.
        const lieutenantAlive = this.enemies.some((e) => e.active && e.lieutenant);
        if (!bossAlive && !this.bossWarning && !this.lieutenantWarning && !lieutenantAlive) {
            if (this.lieutenantDirector.update(this.time)) this._startLieutenantWarning();
        }
        if (this.lieutenantWarning) {
            // If a boss window opened during the telegraph (a late boss kill can
            // push the next boss warning into it), cancel the Lieutenant so it
            // never spawns into the boss setpiece — it re-arms next segment.
            if (bossAlive || this.bossWarning) {
                this.lieutenantWarning = null;
            } else {
                this.lieutenantWarning.timer -= dt;
                if (this.lieutenantWarning.timer <= 0) {
                    const t = this.lieutenantWarning.type;
                    this.lieutenantWarning = null;
                    this._spawnLieutenant(t);
                }
            }
        }
        // Drain any queued boss summon requests into themed, capped spawns.
        if (this.bossSummons.length) {
            for (const s of this.bossSummons) this._spawnBossSupport(s.x, s.y, s.count, s.types);
            this.bossSummons.length = 0;
        }
        // Boss HP-threshold phases (75/50/25%) — one-shot support + aggression.
        this._updateBossThresholds();
    }

    // Player movement/caps/aura, the trash-spawner gate, and weapon fire.
    // Returns the weapon system's { killed, hits } for _resolveCombat.
    _updatePlayerAndWeapons(dt) {
        this.player.update(dt, this.input);
        // First-run onboarding hints advance off live play (movement, gems,
        // level) — ticked right after the player moves so step 0's distance
        // accumulator sees this frame's step.
        if (this.onboarding) this._tickOnboarding(dt);
        // Late-game flattening: clamp the global stacking stats every frame
        // (before weapons read them). Hard caps are idempotent on these
        // monotonic-growth fields; weapon per-level stats are unaffected.
        this._applyPlayerCaps();
        // Recompute the weapon-driven aura (cheap; cached unless the owned set
        // changed). Reduced-effects mode skips the extra additive glow sprite.
        this._updateAura();
        // Slide the player out of any wall they walked into (tangential motion
        // is preserved by resolveCircle, so they glide along obstacles).
        {
            const r = this.obstacleSystem.resolveCircle(this.player.x, this.player.y, this.player.radius);
            this.player.x = r.x; this.player.y = r.y;
        }
        // Boss arena: confine the player inside the ring (can't flee the fight).
        if (this.arena) this._confineToArena(this.player, this.player.radius);
        // Boss = main event: while a boss is incoming or alive, halt the normal
        // trash spawner so the fight is the player vs. the boss (and only the
        // boss's own themed adds), not a swarm. Normal spawns resume once the
        // boss is dead.
        const bossOnField = !!this.bossWarning || this.enemies.some((e) => e.active && e.boss);
        if (!bossOnField) {
            this.spawner.update(dt, this.player, this.enemies, this.waveState, this.obstacleSystem, this.waveDirector);
        }
        // Fire burn scales with run progress (boss clears + minutes) so the
        // FIRE line keeps biting through scaled late-game enemy HP. Read by the
        // ember/inferno weapons off the player (their shared ctx carrier).
        const fc = ELEMENT.fire;
        this.player.fireRoundScale = Math.min(
            fc.burnScaleMax ?? 3.0,
            1 + this.bossesDefeated * (fc.burnPerBoss ?? 0) + (this.time / 60) * (fc.burnPerMinute ?? 0)
        );
        const weaponResult = this.weaponSystem.update(
            dt, this.player, this.enemies, this.projectiles, this.obstacleSystem, this.particles, this.audio
        );

        // Held weapon: aim the signature wand (owned[0], the menu-chosen
        // starter) at the nearest enemy — it points at what it shoots. With no
        // target, it rests along the hero's facing so it never snaps to a
        // stale angle. Snapshot the owned visuals for Player.draw, and hold the
        // cast pose whenever the primary weapon fires this frame.
        this.player.loadout = this.weaponSystem.getOwnedVisuals();
        let aimBest = null, aimD = Infinity;
        for (const e of this.enemies) {
            if (!e.active) continue;
            const dx = e.x - this.player.x, dy = e.y - this.player.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < aimD) { aimD = d2; aimBest = e; }
        }
        if (aimBest) {
            this.player.aimAngle = Math.atan2(aimBest.y - this.player.y, aimBest.x - this.player.x);
        } else {
            const f = this.player.facing;
            this.player.aimAngle = f === 'up' ? -Math.PI / 2 : f === 'left' ? Math.PI
                : f === 'right' ? 0 : Math.PI / 2;
        }
        const primaryWeapon = this.weaponSystem.owned[0];
        if (primaryWeapon && primaryWeapon.firedThisFrame) this.player.triggerCast();
        return weaponResult;
    }

    // Enemy movement + wall/arena resolve, soft separation, burn DoT, and
    // support (healer/shielder) auras. Returns the burn tick's
    // { killed, hits } for _resolveCombat.
    _updateEnemies(dt) {
        for (const e of this.enemies) {
            if (!e.active) continue;
            // Windup-timer TRANSITIONS drive every behavior's commit + cues
            // (the windup IS the dodge warning): charger brace/dash, and the
            // P1.3 bomber plant/boom, summoner call, teleporter blink, and
            // lieutenant specials all ride the same before/after check.
            const wasWinding = e.windupTimer > 0;
            e.update(dt, this.player, this.enemyProjectiles, this.obstacleSystem);
            if (e.type === 'charger' && this._inView(e.x, e.y, 0)) {
                if (!wasWinding && e.windupTimer > 0) this.audio.chargerWindup();
                else if (wasWinding && e.windupTimer <= 0) this.audio.chargerDash();
            } else if (e.behavior === 'bomber') {
                if (!wasWinding && e.windupTimer > 0) {
                    // Bomber planted: paint the blast circle as a delayedZone
                    // (the hazard pool owns the detonation damage + flash, so
                    // the dodge behaves exactly like a telegraphed boss zone —
                    // LOS-checked, i-frame gated). Fires even if the bee dies
                    // mid-windup: the warning that was painted stays honest.
                    this.hazards.push({
                        kind: 'delayedZone', x: e.x, y: e.y, r: e.def.blastRadius,
                        damage: e.blastDamage, age: 0, lifetime: e.def.windup,
                        hitPlayer: false, detonateAge: 0, active: true,
                    });
                    if (this._inView(e.x, e.y, 0)) this.audio.chargerWindup();
                } else if (wasWinding && e.windupTimer <= 0 && e.active) {
                    // Commit: the bee dies in its own blast. A PLAIN bomber is
                    // deliberately NOT routed through the kill/reward path — a
                    // self-detonation pays no XP/kill for standing clear. An
                    // ELITE bomber still owes its rolled loot (affix death,
                    // chest/coin roll, gem, kill credit), so it detonates INTO
                    // the normal pipeline via _selfDetonated instead of
                    // leaking the rewards its elite roll promised.
                    e.active = false;
                    if (e.elite) this._selfDetonated.push(e);
                    else this.particles.deathBurst(e.x, e.y, '#ff9a4a');
                    if (this._inView(e.x, e.y, 120)) this.audio.volatileBoom();
                }
            } else if (e.behavior === 'summoner') {
                if (!wasWinding && e.windupTimer > 0) {
                    if (this._inView(e.x, e.y, 0)) this.audio.chargerWindup();
                } else if (wasWinding && e.windupTimer <= 0) {
                    // Call fulfilled through _spawnBossSupport — the SAME
                    // alive-cap gate boss summons use, so summon pressure can
                    // never blow past the wave cap / maxEnemyCap.
                    this._spawnBossSupport(e.x, e.y, e.def.summonCount ?? 3, e.def.summonTypes);
                    if (this._inView(e.x, e.y, 0)) this.audio.healerPulse();
                }
            } else if (e.behavior === 'teleporter') {
                if (wasWinding && e.windupTimer <= 0) {
                    // Blink committed (the enemy moved itself): sparkle both
                    // ends so the vanish/arrive reads even at screen edge.
                    this.particles.pickupSparkle(e._blinkFromX, e._blinkFromY, '#7fe0ff');
                    this.particles.pickupSparkle(e.x, e.y, '#7fe0ff');
                    if (this._inView(e.x, e.y, 0)) this.audio.dash();
                }
            } else if (e.lieutenant) {
                // Lieutenant specials: windup/commit cues (the gold charge arc
                // + any ground telegraph are painted by Enemy/commitBossAttack).
                if (!wasWinding && e.windupTimer > 0) { if (this._inView(e.x, e.y, 0)) this.audio.chargerWindup(); }
                else if (wasWinding && e.windupTimer <= 0) { if (this._inView(e.x, e.y, 0)) this.audio.bossAttack(); }
            }
            // Enemies (including elites + bosses) can't walk through walls.
            // Resolving after their move keeps them chasing while sliding along
            // obstacles instead of clipping through or stacking inside them.
            const r = this.obstacleSystem.resolveCircle(e.x, e.y, e.radius);
            // Clamp to world bounds too (Enemy.update doesn't, unlike Player) so
            // a wall push-out near an edge can't drift an enemy off the map.
            e.x = clamp(r.x, -WORLD_WIDTH / 2 + e.radius, WORLD_WIDTH / 2 - e.radius);
            e.y = clamp(r.y, -WORLD_HEIGHT / 2 + e.radius, WORLD_HEIGHT / 2 - e.radius);
            // Keep the boss inside its own arena so it can't be kited out of it.
            if (this.arena && e.boss) this._confineToArena(e, e.radius);
        }
        // Soft enemy-vs-enemy separation so a swarm doesn't collapse onto one
        // pixel (runs after movement + obstacle resolve so it can't shove an
        // enemy into a wall — its result is re-clamped to obstacles below).
        this._separateEnemies(dt);
        // Elemental DoT (burn) is applied here, NOT in Enemy.update, because
        // a burn kill must route through the same reward pipeline as any
        // other kill (gems/coins/affix-death/kill-count). statusResult.killed
        // is merged into allKilled below.
        const statusResult = this._tickStatuses(dt);
        this._tickSupportEnemies(dt);
        // (Phase-2 boss enrage one-shots moved into the consolidated enemy
        // scan below — one pass instead of five over the full array.)
        return statusResult;
    }

    // Player projectiles + enemy bolts (movement, wall impacts, player hits).
    _updateProjectiles(dt) {
        for (const p of this.projectiles) {
            if (!p.active) continue;
            const px = p.x, py = p.y;
            p.update(dt);
            // Projectiles collide with walls: if the step crossed an obstacle,
            // burst on impact instead of passing through.
            if (p.active && this.obstacleSystem.segmentBlocked(px, py, p.x, p.y)) {
                p.active = false;
                this.particles.pickupSparkle(p.x, p.y, LIGHT_COLORS.projectile);
            }
        }
        // Enemy bolts (Spitters + boss volleys). Each can hit the player once;
        // a landed hit drives the same shake + flash + damage number as
        // contact damage.
        for (const ep of this.enemyProjectiles) {
            if (!ep.active) continue;
            const epx = ep.x, epy = ep.y;
            const dealt = ep.update(dt, this.player);
            // Enemy/boss bolts also collide with walls — no damage through cover.
            if (ep.active && this.obstacleSystem.segmentBlocked(epx, epy, ep.x, ep.y)) {
                ep.active = false;
                continue;
            }
            if (dealt > 0) {
                if (ep.sourceLabel) this.lastHitBy = ep.sourceLabel;   // death-card attribution
                this._shake(SCREEN_SHAKE.intensity, SCREEN_SHAKE.duration);
                this._pushFeedback('hit', 0.32);
                this.damageNumbers.push(new DamageNumber(
                    this.player.x, this.player.y - this.player.radius, dealt, '#ff4757'
                ));
            }
        }
    }

    // XP gems (+ the level-up trigger), coins, and health orbs.
    _updatePickups(dt) {
        let xpCollected = 0;
        for (const g of this.gems) {
            if (!g.active) continue;
            const xp = g.update(dt, this.player);
            if (xp > 0) {
                xpCollected += xp;
                this.particles.pickupSparkle(g.x, g.y, gemLightColor(g.tier));
                this.audio.gem();   // throttled → a vacuum coalesces into a sparkle run
            }
        }
        if (xpCollected > 0) {
            const levels = this.player.gainXP(xpCollected);
            if (levels > 0) {
                this.pendingLevelUps += levels;
                this._pushFeedback('levelup', 0.5);
                this.audio.levelUp();
                // A brief freeze-frame punches the level-up into a "moment"
                // before the upgrade overlay opens (skipped under reduced-effects).
                this._hitStop(0.07);
                this.particles.levelUpBurst(this.player.x, this.player.y);
                this._spawnRing(this.player.x, this.player.y, {
                    maxR: 200, width: 9, life: 0.6, color: '#8fe1ff', ease: 'outCubic',
                });
                // QoL juice: a level-up vacuums every loose gem on the field so
                // nothing earned is left behind while the overlay is up.
                for (const g of this.gems) {
                    if (g.active) { g.magnetizing = true; g.magnetSpeed = Math.max(g.magnetSpeed, 1200); }
                }
                if (!this.upgradeChoices) this._presentLevelUp();
            }
        }

        // Coin pickup — mirrors XPGem flow but feeds player.coins.
        for (const c of this.coins) {
            if (!c.active) continue;
            const got = c.update(dt, this.player);
            if (got > 0) {
                this.player.coins = (this.player.coins ?? 0) + got;
                this.particles.pickupSparkle(c.x, c.y, LIGHT_COLORS.coin);
                this.audio.coin();
            }
        }

        // Health-orb pickup — an instant heal (bypasses the sustained cap, by
        // design — it's a rare reward, not a sustain source).
        for (const h of this.healthOrbs) {
            if (!h.active) continue;
            const heal = h.update(dt, this.player);
            if (heal > 0) {
                const before = this.player.hp;
                this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
                const gained = Math.round(this.player.hp - before);
                if (gained > 0) {
                    this.damageNumbers.push(new DamageNumber(this.player.x, this.player.y - this.player.radius, gained, '#6bff8a'));
                }
                this.particles.pickupSparkle(h.x, h.y, '#6bff8a');
                this.audio.heal();
            }
        }
    }

    // Contact/projectile collisions + the merged kill/hit reward pipeline
    // (gems, coins, chests, boss/lieutenant/elite setpieces, hit feedback).
    _resolveCombat(dt, weaponResult, statusResult) {
        const collisionResult = this.collisionSystem.resolve(
            dt, this.player, this.enemies, this.projectiles
        );

        // Merge weapon-system hits/kills (orbit blades, pulse, lightning),
        // projectile-collision results, burn-DoT kills, and elite bomber
        // self-detonations so gem drops, kill count, affix deaths, and damage
        // numbers all flow through the same downstream path. (Burn damage
        // numbers are already pushed, tinted, inside _tickStatuses — so only
        // its killed list is merged here.)
        const allKilled = collisionResult.killed
            .concat(weaponResult.killed, statusResult.killed, this._selfDetonated);
        this._selfDetonated.length = 0;
        const allHits = collisionResult.hits.concat(weaponResult.hits);

        if (allKilled.length > 0) {
            this.kills += allKilled.length;
            this._addCombo(allKilled.length);
            this.audio.kill();
            // Blooddrinker lifesteal-on-kill (capped by the sustained-heal budget).
            if (this.player.killHeal > 0) this.player.healSustained(this.player.killHeal * allKilled.length);
            this.waveDirector.notifyKill(allKilled.length);
            for (const e of allKilled) {
                this.particles.deathBurst(e.x, e.y, deathColor(e));
                if (e.affix) this._applyAffixDeath(e);
                // P1.3 splitter: bursts into live slimelets (def-driven,
                // unlike the rolled elite 'splitting' AFFIX — both can fire
                // on an elite splitter, which is the fun kind of chaos).
                if (e.def.splitInto) this._splitOnDeath(e);
                this._dropGem(e.x, e.y);
                // Rare health orb (skipped at full HP so it's never wasted).
                if (this.player.hp < this.player.maxHp && Math.random() < HEALTH_DROP.chance) {
                    this.healthOrbs.push(new HealthOrb(e.x, e.y));
                }
                if (e.boss) {
                    // Bosses drop a coin burst + a PICK-ONE reward: a treasure
                    // chest OR a Wick Shrine (relic altar), spawned side by side —
                    // claiming one despawns the other.
                    this.bossesDefeated += 1;
                    // Arm the post-death cooldown so the next boss doesn't
                    // chain in immediately after a late kill.
                    this.bossDirector.notifyBossDefeated(this.time);
                    // Re-center the Lieutenant for the new segment (endless: keeps
                    // firing one per boss-to-boss stretch).
                    this.lieutenantDirector.reset(this.time);
                    // Branching Roads: on every boss EXCEPT the run-ending 3rd
                    // (which opens the victory overlay), QUEUE a CROSSROADS fork.
                    // The end-of-update presenter opens it once no other overlay is
                    // up — deferring (not force-setting this.altar) so a same-frame
                    // level-up can't stack a hidden overlay under the fork's cards.
                    // In endless/gauntlet (_victoryShown latched), isFinalBoss is
                    // false forever after, so forks reappear after every boss.
                    const isFinalBoss = (this.bossesDefeated >= 3 && !this._victoryShown);
                    if (!isFinalBoss) this.pendingCrossroads = true;
                    this._dropBossReward(e.x, e.y);
                    this._dropCoinBurst(e.x, e.y, COIN.bossCoinCount, COIN.bossCoinValue);
                    // Setpiece payoff: a banner, a heavy layered burst, and a
                    // strong shake so an apex kill lands.
                    this.waveDirector.announce(`${e.name.toUpperCase()} DEFEATED!`, 3.0, '#ff6a4a');
                    this.audio.bossDefeat();
                    this.particles.bossDeathBurst(e.x, e.y, '#ff8c4a');
                    this._shake(SCREEN_SHAKE.intensity * 1.1, 0.5);
                    // Setpiece punch: a hard freeze-frame + a triple expanding
                    // shockwave so an apex kill really lands.
                    this._hitStop(0.12);
                    this._spawnRing(e.x, e.y, { maxR: 520, width: 16, life: 0.7, color: '#ffd0a0', ease: 'outCubic' });
                    this._spawnRing(e.x, e.y, { maxR: 360, width: 10, life: 0.55, color: '#ff8c4a' });
                    this._spawnRing(e.x, e.y, { maxR: 220, width: 7, life: 0.4, color: '#ffffff' });
                    // Back to the driving theme once the duel ends; lift the arena.
                    this.audio.playMusic('gameplay');
                    this.arena = null;
                    // Clearing the 3rd boss is a milestone: open the victory
                    // overlay (continue / new biome / main menu) once per run.
                    if (isFinalBoss) {
                        this._victoryShown = true;
                        this._showVictory();
                    }
                } else if (e.lieutenant) {
                    // Lieutenant mini-boss down: a mid-tier reward beat — a ring, a
                    // coin burst, a chance at a chest, and a callout. Touches NONE of
                    // the boss state (bossesDefeated / crossroads / victory / arena).
                    this._spawnRing(e.x, e.y, { maxR: 260, width: 10, life: 0.55, color: LIEUTENANT.color, ease: 'outCubic' });
                    this._dropCoinBurst(e.x, e.y, LIEUTENANT.coinCount, LIEUTENANT.coinValue);
                    if (Math.random() < LIEUTENANT.chestChance) this._dropChest(e.x, e.y);
                    this.audio.lieutenantDown();
                    this.waveDirector.announce(`${e.name} SLAIN`, 2.5, LIEUTENANT.color);
                    this.particles.deathBurst(e.x, e.y, LIEUTENANT.color);
                    this._shake(SCREEN_SHAKE.intensity * 0.5, 0.25);
                } else if (e.elite) {
                    // Elite kills pop a small shockwave ring tinted to the affix.
                    this._spawnRing(e.x, e.y, {
                        maxR: 170, width: 8, life: 0.5,
                        color: e.affixColor || '#ffd166',
                    });
                    // Elites: chance at a chest, chance at a coin burst.
                    if (Math.random() < CHEST.eliteDropChance) {
                        this._dropChest(e.x, e.y);
                    }
                    if (Math.random() < COIN.eliteDropChance) {
                        const count = COIN.eliteCoinMin +
                            Math.floor(Math.random() *
                                Math.max(1, COIN.eliteCoinMax - COIN.eliteCoinMin + 1));
                        this._dropCoinBurst(e.x, e.y, count, 1);
                    }
                } else if (Math.random() < COIN.normalDropChance) {
                    // Normal enemies: small chance of a single coin.
                    this._dropCoin(e.x, e.y, 1);
                }
            }
        }
        // Hit sparks + floating numbers are both capped per frame so a wide
        // AoE hit (pulse/orbit/lightning striking a big crowd) can't drain the
        // particle pool or flood the damage-number array — a real perf + GC
        // win in dense fights, with negligible readability loss (you can't
        // read 80 overlapping numbers anyway). Damage is unaffected.
        let sparkBudget = 6;
        let numberBudget = 14;
        for (const hit of allHits) {
            if (numberBudget > 0) {
                this.damageNumbers.push(new DamageNumber(hit.x, hit.y, hit.amount, '#ffffff'));
                numberBudget--;
            }
            if (sparkBudget > 0) {
                // Element-tinted impact: fire sparks warm, frost/freeze shatter
                // into shards, shock crackles yellow, everything else the white
                // default. Activates the frostShards/shockSparks emitters.
                const el = hit.element;
                if (el === 'fire') this.particles.hitSpark(hit.x, hit.y, '#ff7a33');
                else if (el === 'frost' || el === 'freeze') this.particles.frostShards(hit.x, hit.y);
                else if (el === 'shock') this.particles.shockSparks(hit.x, hit.y);
                else this.particles.hitSpark(hit.x, hit.y);
                sparkBudget--;
            }
        }
        if (collisionResult.playerHit) {
            if (collisionResult.strongest) this.lastHitBy = collisionResult.strongest;   // death-card attribution
            this._playerHurtShake(collisionResult.playerDamageTaken);
            this._pushFeedback('hit', 0.32);
            this.damageNumbers.push(new DamageNumber(
                this.player.x,
                this.player.y - this.player.radius,
                collisionResult.playerDamageTaken,
                '#ff4757'
            ));
        }
    }

    // Cosmetic world FX: floating numbers, particles, shockwave rings, the
    // damage-vignette decay, and the adaptive graphics governor.
    _updateWorldFx(dt) {
        for (const d of this.damageNumbers) {
            if (d.active) d.update(dt);
        }

        // Advance particles (ambient embers + fog spawn around the player).
        this.particles.update(dt, this.player);
        // Advance shockwave rings; expand + fade out over their life.
        for (const ring of this.rings) {
            ring.age += dt;
            if (ring.age >= ring.life) ring.active = false;
        }
        // Damage vignette pulse decays back to clear.
        if (this.hitVignette > 0) this.hitVignette = Math.max(0, this.hitVignette - dt * 2.2);
        this._updateGfxGovernor(dt);
    }

    // Chest/shrine walk-ons + presenting whichever reward overlay is queued.
    _updateRewardOverlays(dt) {
        // Chest pickup: chests sit until the player walks onto them, then
        // queue a chest reward overlay. Multiple chests collected in the
        // same tick are queued via pendingChests.
        for (const c of this.chests) {
            if (!c.active) continue;
            if (c.update(dt, this.player)) {
                this.pendingChests += 1;
                // Claiming the chest despawns its sibling shrine (boss pick-one).
                if (c._sibling && c._sibling.active) c._sibling.active = false;
                // Pop of golden sparkle the instant the chest is grabbed (the
                // reward overlay follows, but the world gets immediate feedback).
                this.particles.pickupSparkle(c.x, c.y, '#ffd166');
                this.particles.pickupSparkle(c.x, c.y - 8, '#ffe6b0');
                this.audio.chest();
            }
        }
        // Wick Shrine pickup: walking onto a shrine queues the pick-one altar and
        // (for a boss pick-one) despawns its sibling chest.
        for (const s of this.shrines) {
            if (!s.active) continue;
            if (s.update(dt, this.player)) {
                this.pendingAltars += 1;
                if (s._sibling && s._sibling.active) s._sibling.active = false;
                this.particles.pickupSparkle(s.x, s.y, '#ff9ecf');
                this.particles.pickupSparkle(s.x, s.y - 8, '#ffd3ec');
                // Mystical wick-chime — distinct from the chest's loot latch.
                this.audio.shrineChime();
            }
        }
        // Present whichever reward overlay is queued — only one is ever open at a
        // time (mutually exclusive with chest/level-up). The Branching Roads
        // CROSSROADS takes priority (the boss beat comes first, before its own
        // chest/shrine reward), and only opens once every other overlay is clear
        // so it can never stack on a same-frame level-up.
        if (this.pendingCrossroads && !this.chestReward && !this.upgradeChoices && !this.altar && !this.victory) {
            this.pendingCrossroads = false;
            this._presentCrossroads();
        } else if (this.pendingChests > 0 && !this.chestReward && !this.upgradeChoices && !this.altar) {
            this._presentChest();
        } else if (this.pendingAltars > 0 && !this.chestReward && !this.upgradeChoices && !this.altar) {
            this._presentAltar();
        }
    }

    // End-of-frame pass: the ONE consolidated enemy scan (P0.6) + everything
    // fed by it (melee swing, arena safety-net, music intensity, Second Wind),
    // pool compaction, HP-delta feedback, camera, and the death check.
    _updateEnemyScanAndCleanup(dt) {
        // ── ONE consolidated enemy scan ──────────────────────────────────
        // Replaces five separate full-array passes (melee-nearest, boss ref,
        // lieutenant ref, boss-enrage one-shot, Second-Wind proximity) that
        // each walked this.enemies every frame at the 180-enemy cap. Runs
        // after kills/pickups are processed so no ref can point at a corpse.
        // Boss ref picks by max HP so a fresh stronger boss takes the HP bar
        // over from an older weaker one; the lieutenant ref stays separate so
        // it never feeds the arena safety-net (which keys on activeBossRef).
        let nearestEnemy = null, nearestD2 = Infinity;
        this.activeBossRef = null;
        this.activeLieutenantRef = null;
        for (const e of this.enemies) {
            if (!e.active) continue;
            const dx = e.x - this.player.x, dy = e.y - this.player.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < nearestD2) { nearestD2 = d2; nearestEnemy = e; }
            if (e.boss) {
                if (!this.activeBossRef || e.maxHp > this.activeBossRef.maxHp) {
                    this.activeBossRef = e;
                }
                // Phase-2 enrage: a boss that crossed its HP threshold announces
                // + shakes exactly once (latched by enrageShouted). The phase
                // flip happens inside the boss AI; this only fires the one-shot FX.
                if (e.phase2Entered && !e.enrageShouted) {
                    e.enrageShouted = true;
                    this.waveDirector.announce('ENRAGED!', 1.2);
                    this._shake(SCREEN_SHAKE.intensity * 0.85, 0.45);
                    this._spawnRing(e.x, e.y, { maxR: 300, width: 12, life: 0.5, color: '#ff3b4e', ease: 'outCubic' });
                }
            } else if (e.lieutenant) {
                if (!this.activeLieutenantRef || e.maxHp > this.activeLieutenantRef.maxHp) {
                    this.activeLieutenantRef = e;
                }
            }
        }

        // Melee swing animation: when the chosen starting weapon is a
        // melee/blade family, the hero rhythmically slashes toward the nearest
        // enemy in reach. Purely cosmetic (no damage) — the auto-attack weapons
        // still do all the real work. Throttled so it reads as deliberate.
        if (this.playerSwingMelee) {
            this._swingCd -= dt;
            if (this._swingCd <= 0) {
                if (nearestEnemy && nearestD2 < 270 * 270) {
                    this.player.triggerSwing(Math.atan2(nearestEnemy.y - this.player.y, nearestEnemy.x - this.player.x));
                    this._swingCd = 0.34;
                } else {
                    this._swingCd = 0.15; // nothing in reach — re-check soon
                }
            }
        }
        // Safety net: if a boss arena is up but no boss is alive (defeated by
        // any means), lift the arena so the player isn't trapped.
        if (this.arena && !this.activeBossRef) this.arena = null;

        // Drive the music's dynamic intensity from how hectic the floor is
        // (enemy density) and, during a duel, how close the boss is to death.
        let intensity = Math.min(1, this.enemies.length / 90);
        if (this.activeBossRef) {
            intensity = Math.max(intensity, 0.55 + 0.45 * (1 - this.activeBossRef.hp / this.activeBossRef.maxHp));
        }
        // Near death the world closes in: cap the music brightness so the
        // heartbeat + dimmed groove read as danger without any alarm sound.
        const lowHp = this.player.hp > 0 && this.player.hp < this.player.maxHp * 0.25;
        this.audio.setIntensity(lowHp ? Math.min(intensity, 0.25) : intensity);

        compactInPlace(this.enemies);
        compactInPlace(this.projectiles);
        // New enemy shots this frame → one soft incoming-fire pip, gated to
        // on-screen shooters (the cue's own min-gap keeps volleys as a chorus).
        if (this.enemyProjectiles.length > (this._epCount ?? 0)) {
            const p = this.enemyProjectiles[this.enemyProjectiles.length - 1];
            if (p && this._inView(p.x, p.y, 60)) this.audio.enemyShoot();
        }
        compactInPlace(this.enemyProjectiles);
        this._epCount = this.enemyProjectiles.length;
        compactInPlace(this.hazards);
        compactInPlace(this.rings);
        compactInPlace(this.gems);
        compactInPlace(this.damageNumbers);
        compactInPlace(this.chests);
        compactInPlace(this.shrines);
        compactInPlace(this.coins);
        compactInPlace(this.healthOrbs);

        // Heal flash: any net HP rise this frame (level-up heal, chest heal)
        // fires a green feedback pulse. Tracked centrally so individual
        // reward code doesn't each need to remember to trigger it.
        if (this.player.hp > this._lastHp + 0.5) this._pushFeedback('heal', 0.4);
        else if (this.player.hp < this._lastHp - 0.5) {
            this.audio.hurt();
            // Red screen-edge vignette pulse on any damage; a heavy hit
            // (>=12% max HP) also briefly freezes the frame for impact.
            const dmg = this._lastHp - this.player.hp;
            this.hitVignette = Math.min(1, this.hitVignette + 0.5);
            if (dmg >= this.player.maxHp * 0.12) this._hitStop(0.05);
        }
        this._lastHp = this.player.hp;

        // Near-death heartbeat: a soft ~1Hz ember pulse while HP is critical —
        // cozy dread, never a klaxon. Resets the instant HP recovers.
        if (this.player.hp > 0 && this.player.hp < this.player.maxHp * 0.25) {
            this._heartbeatT = (this._heartbeatT ?? 0) - dt;
            if (this._heartbeatT <= 0) { this.audio.heartbeat(); this._heartbeatT = 0.85; }
        } else this._heartbeatT = 0;

        // Second Wind: trickle HP back while no enemy is within the safe
        // radius. Applied after the heal-flash check so the tiny per-frame
        // tick doesn't spam the green flash.
        if (this.player.regenPerSecond > 0 && this.player.hp < this.player.maxHp) {
            // Nearest-enemy distance comes from the consolidated scan above
            // (Infinity when the field is empty — trivially safe).
            const sr2 = SECOND_WIND_RADIUS * SECOND_WIND_RADIUS;
            const safe = nearestD2 >= sr2;
            if (safe) {
                // Regen is capped by CAPS.regenPerSecond and shares the global
                // sustained-heal budget (CAPS.healPerSecond) with Divine Nova.
                const rate = Math.min(this.player.regenPerSecond, CAPS.regenPerSecond);
                this.player.healSustained(rate * dt);
                this._lastHp = this.player.hp;
            }
        }

        this.camera.update(dt);

        if (this.player.isDead()) {
            this._enterGameOver();
        }
    }

    _dropGem(x, y) {
        const tier = pickWeighted(GEM_TIERS, (t) => GEM[t].dropWeight) ?? 'small';
        if (this.obstacleSystem.isBlocked(x, y, 16)) { const s = this._clearSpot(x, y, 16); x = s.x; y = s.y; }
        this.gems.push(new XPGem(x, y, tier));
    }

    render() {
        const r = this.renderer;
        if (!r.beginFrame()) return;
        const ctx = r.ctx;

        // Start screen renders on a flat background with no world behind —
        // simpler to read and avoids drawing entities that haven't been
        // bootstrapped by a real run yet.
        if (this.screen === 'start') {
            ctx.fillStyle = '#0a0e16';
            ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
            this.ui.draw(ctx, buildUIState(this));
            // The Mines overlay is Game-drawn (not part of the menu renderer),
            // so it must be painted here — the start screen returns before the
            // gameplay-tail overlay block below.
            if (this.minigame.mines) this.minigame.drawMines(ctx);
            return;
        }

        // "Emberlight" pipeline. The world draws fully lit; emitters
        // register lights into the darkness buffer as they're drawn; the
        // veil is composited in screen space afterward with bright sparks +
        // damage numbers layered on top so feedback never dims.
        const lightingOn = GFX.darkness.enabled && this.lighting.ok;
        const L = lightingOn ? this.lighting : null;
        if (L) L.beginFrame(this.camera);

        ctx.save();
        this.camera.apply(ctx);

        // Photo-mode zoom widens the visible view; feed the wider extent to the
        // view-extent consumers + cull so nothing pops at the frame edge when
        // zoomed out (zoom>1 just over-draws a touch at the old margin — fine).
        const _zoom = this.camera.zoom || 1;
        const viewW = INTERNAL_WIDTH / _zoom;
        const viewH = INTERNAL_HEIGHT / _zoom;
        const cullMargin = CULL_MARGIN + (_zoom < 1 ? (1 / _zoom - 1) * INTERNAL_WIDTH / 2 : 0);

        // Ground → grid(debug) → decorations (which register candle lights)
        // → low fog (below entities) → bounds.
        this.mapRenderer.drawBackground(ctx, this.camera, viewW, viewH);
        if (this.showDebug) this._drawGrid(ctx);
        this.mapRenderer.drawDecorations(ctx, this.camera, viewW, viewH, L);
        if (this.particlesEnabled && !this.reducedEffects) this.particles.drawWorldFog(ctx, this.camera);
        this._drawWorldBounds(ctx, this.showDebug);

        // Decorative floors (building interiors) are GROUND — always drawn
        // behind every entity/wall, never y-sorted against the player (else a
        // player above the building would push the floor into the in-front pass
        // and paint it over enemies inside). One flat ground pass here.
        this.obstacleSystem.forVisible(
            this.camera, viewW, viewH,
            (ob) => ob.draw(ctx), (ob) => !!ob.def.decorative
        );

        // Obstacles are painter's-ordered against the player: those whose feet
        // line sits ABOVE the player draw now (behind entities); those below
        // the player draw after the player so they correctly occlude them.
        // (Decorative floors are excluded — drawn in the ground pass above.)
        const playerBaseY = this.player.y + this.player.radius;
        this.obstacleSystem.forVisible(
            this.camera, viewW, viewH,
            (ob) => ob.draw(ctx), (ob) => !ob.def.decorative && ob.baseY <= playerBaseY
        );

        // Off-screen culling: only entities within the camera view (plus a
        // sprite-half + shake margin) are worth a draw call (enemies spawn
        // ~1100-1350px out, cap up to 145). Lights are registered in the
        // SAME culled loops so light cost scales with visible emitters too.
        const cull = (e) => this._inView(e.x, e.y, cullMargin);
        const Lc = GFX.lighting;

        // Boss arena boundary ring — a glowing wall the player + boss are sealed
        // inside. Drawn on the ground so entities render over it; a soft inner
        // glow band + a pulsing dashed edge sell it as an energy barrier.
        if (this.arena) {
            const a = this.arena;
            ctx.save();
            const pulse = 0.6 + 0.4 * Math.sin(this.time * 4);
            // Inner glow band just inside the wall.
            const band = ctx.createRadialGradient(a.x, a.y, a.r - 90, a.x, a.y, a.r);
            band.addColorStop(0, 'rgba(255,90,60,0)');
            band.addColorStop(1, `rgba(255,90,60,${0.18 * pulse})`);
            ctx.fillStyle = band;
            ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, TWO_PI); ctx.fill();
            // The wall itself.
            ctx.strokeStyle = BOSS.arenaColor;
            ctx.globalAlpha = 0.5 + 0.4 * pulse;
            ctx.lineWidth = 6;
            ctx.setLineDash([34, 22]);
            ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, TWO_PI); ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }

        // Hazard ground decals (boss telegraphs, delayed zones, lingering
        // pools) — below entities so the boss paints over them.
        this.hazardSystem.drawGround(ctx, this, L);

        // Player light first (always kept, exempt from caps). The light TINT
        // follows the weapon aura so the glow radiating from the player changes
        // with their build; radius stays fixed (visual only — never reveals
        // more of the map) and the intensity bump is small + capped.
        if (L) {
            const aura = this._auraSnapshot;
            const lightColor = aura ? aura.color : LIGHT_COLORS.player;
            const lightInten = Lc.playerIntensity + (aura ? Math.min(AURA.lightIntensityBonus, aura.intensity * 0.4) : 0);
            // Crypts gloom pools (P1.2) SQUEEZE the hero's light — gloomT
            // (0..1, eased by HazardSystem) scales the radius down by up to
            // lightCut, so standing in living darkness visibly costs vision.
            const gloomK = 1 - (BIOME_HAZARD.gloom.lightCut ?? 0.5) * (this.gloomT ?? 0);
            L.addLight(this.player.x, this.player.y, Lc.playerRadius * gloomK, lightColor, lightInten, 0);
        }

        for (const g of this.gems) {
            if (!cull(g)) continue;
            g.draw(ctx);
            if (L) L.addLight(g.x, g.y, Lc.gemRadius, gemLightColor(g.tier), 0.85, 1);
        }
        for (const c of this.coins) {
            if (!cull(c)) continue;
            c.draw(ctx);
            if (L) L.addLight(c.x, c.y, Lc.coinRadius, LIGHT_COLORS.coin, 0.8, 1);
        }
        for (const h of this.healthOrbs) {
            if (!cull(h)) continue;
            h.draw(ctx);
            if (L) L.addLight(h.x, h.y, Lc.coinRadius, '#6bff8a', 0.85, 1);
        }
        for (const c of this.chests) {
            if (!cull(c)) continue;
            c.draw(ctx);
            if (L) L.addLight(c.x, c.y, Lc.chestRadius, LIGHT_COLORS.chest, 0.9, 1);
        }
        for (const s of this.shrines) {
            if (!cull(s)) continue;
            s.draw(ctx);
            if (L) L.addLight(s.x, s.y, Lc.chestRadius, LIGHT_COLORS.shrine, 0.9, 1);
        }
        for (const e of this.enemies) {
            if (!cull(e)) continue;
            e.draw(ctx);
            e.drawHpBar(ctx);
            if (L) {
                if (e.boss) L.addLight(e.x, e.y, Lc.bossRadius, LIGHT_COLORS.boss, 0.95, 0);
                else L.addLight(e.x, e.y - e.radius * 0.3, Lc.enemyEyeRadius, LIGHT_COLORS.enemyEye, 0.7, 2);
                // A burning enemy casts a warm glow. Priority 2 (low tier,
                // shares the global maxLights budget like the enemy-eye light)
                // — NOT priority 1, which is the separate pickup-light cap.
                if (e.burnTimer > 0) L.addLight(e.x, e.y, Lc.burnRadius, LIGHT_COLORS.fire, 0.7, 2);
            }
        }
        this.player.draw(ctx);
        this.player.drawHpBar(ctx);
        // Obstacles whose feet sit below the player draw on top of them, so the
        // player is occluded when standing behind a wall/building.
        this.obstacleSystem.forVisible(
            this.camera, viewW, viewH,
            (ob) => ob.draw(ctx), (ob) => !ob.def.decorative && ob.baseY > playerBaseY
        );
        this.weaponSystem.drawWeaponVisuals(ctx, this.player);
        for (const p of this.projectiles) {
            if (!cull(p)) continue;
            p.draw(ctx);
            if (L) L.addLight(p.x, p.y, Lc.projectileRadius, LIGHT_COLORS.projectile, 0.85, 0);
        }
        // Enemy bolts — drawn above player projectiles; each carves a small
        // hostile-purple light so they read against the dark.
        for (const ep of this.enemyProjectiles) {
            if (!cull(ep)) continue;
            ep.draw(ctx);
            if (L) L.addLight(ep.x, ep.y, 110, '#c97bff', 0.8, 0);
        }
        // Bright hazards (boss shockwave rings + sweeping laser beams) —
        // above entities, additive, each carving its own light.
        this.hazardSystem.drawAbove(ctx, this, L);

        this.weaponSystem.drawEffects(ctx);
        // Weapon effects (pulse/lightning) are bright emitters — carve light
        // holes so the veil doesn't dim them.
        if (L) {
            for (const fx of this.weaponSystem.effects) {
                if (!fx.active) continue;
                L.addLight(fx.x, fx.y, Lc.effectRadius, LIGHT_COLORS.effect, 0.8, 0);
            }
        }

        // Expanding shockwave rings (kills / boss death / level-up) — additive
        // so they glow, drawn in the world layer above entities.
        if (this.rings.length) this._drawRings(ctx);

        // Occludable additive particles (embers + death dust) — these sit
        // above entities but BELOW the veil, so they read as ambient glow.
        if (this.particlesEnabled) this.particles.drawWorldAdditive(ctx, this.camera);

        if (this.collisionSystem.contactFlash > 0) {
            this._drawContactFlash(ctx);
        }

        if (this.showDebug) {
            this.mapRenderer.drawDebug(ctx, this.camera, INTERNAL_WIDTH, INTERNAL_HEIGHT);
            // Obstacle footprints (red = blocks sight, amber = passable LOS).
            this.obstacleSystem.drawDebug(ctx, this.camera, INTERNAL_WIDTH, INTERNAL_HEIGHT);
            this.player.drawDebug(ctx);
            for (const g of this.gems) if (cull(g)) g.drawDebug(ctx);
            for (const c of this.coins) if (cull(c)) c.drawDebug(ctx);
            for (const h of this.healthOrbs) if (cull(h)) h.drawDebug(ctx);
            for (const c of this.chests) if (cull(c)) c.drawDebug(ctx);
            for (const s of this.shrines) if (cull(s)) s.drawDebug(ctx);
            for (const e of this.enemies) if (cull(e)) e.drawDebug(ctx);
            for (const p of this.projectiles) if (cull(p)) p.drawDebug(ctx);
            for (const ep of this.enemyProjectiles) if (cull(ep)) ep.drawDebug(ctx);
            // Line-of-sight rays from the player to nearby enemies: green when
            // clear, red when a wall blocks the shot.
            ctx.save();
            ctx.lineWidth = 1.5;
            for (const e of this.enemies) {
                if (!e.active || !cull(e)) continue;
                const clear = this.obstacleSystem.hasLineOfSight(this.player.x, this.player.y, e.x, e.y);
                ctx.strokeStyle = clear ? 'rgba(90,230,120,0.5)' : 'rgba(255,70,70,0.8)';
                ctx.beginPath();
                ctx.moveTo(this.player.x, this.player.y);
                ctx.lineTo(e.x, e.y);
                ctx.stroke();
            }
            ctx.restore();
        }
        ctx.restore();

        // SCREEN SPACE. Composite the darkness veil (+ baked vignette +
        // color tint) over the lit world, or fall back to the plain
        // vignette if the lighting buffer is unavailable.
        if (L) L.composite(ctx);
        else this.mapRenderer.drawVignette(ctx, INTERNAL_WIDTH, INTERNAL_HEIGHT);

        // Biome weather (embers rise / snow falls) — screen-space atmosphere
        // over the lit world, beneath the HUD.
        if (this.particlesEnabled && !this.reducedEffects) {
            this.mapRenderer.drawWeather(ctx, INTERNAL_WIDTH, INTERNAL_HEIGHT, this.time);
        }

        // Damage vignette: a red screen-edge pulse on taking a hit, drawn over
        // the veil so it reads even in the dark. Cached gradient, just alpha.
        if (this.hitVignette > 0.01) this._drawHitVignette(ctx);

        // Always-bright sparks sit ABOVE the veil so kill/hit/pickup/level
        // feedback never gets dimmed by the darkness.
        if (this.particlesEnabled) this.particles.drawScreenAdditive(ctx, this.camera);

        // Damage numbers also draw above the veil (world-positioned via a
        // re-applied camera transform) so combat math stays fully legible.
        if (this.damageNumbersEnabled) {
            ctx.save();
            this.camera.apply(ctx);
            for (const d of this.damageNumbers) if (cull(d)) d.draw(ctx);
            ctx.restore();
        }

        // EMBERGLASS: mint the queued death/victory card from the world frame
        // NOW — before the HUD (ui.draw) and any overlay draw — so the card's
        // background is the clean world, not the HUD/overlay.
        if (this._pendingCardMint) this._mintPendingCard();

        // EMBERGLASS photo mode: HUD off. Draw the rule-of-thirds grid + the
        // minimal Lens toolbar instead (both excluded from a SNAP via the
        // _suppressToolbar flag). Optionally re-show the gameplay HUD for an
        // annotated shot.
        if (this.photoMode) {
            if (this.photoMode.hudShown) this.ui.draw(ctx, buildUIState(this));
            if (!this._suppressToolbar) {
                if (this.photoMode.gridOn) this._drawPhotoGrid(ctx);
                this.ui.drawPhotoToolbar(ctx, this.photoMode, this.camera.zoom, this.shareToast);
            }
            return;
        }

        this.ui.draw(ctx, buildUIState(this));

        if (this.victory) this._drawVictory(ctx);

        if (this.screen === 'gameplay' && this.input.touch) this.input.touch.draw(ctx);
    }

    // Rule-of-thirds framing guide for the Lens (low-alpha screen-space lines).
    _drawPhotoGrid(ctx) {
        const W = INTERNAL_WIDTH, H = INTERNAL_HEIGHT;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(W / 3, 0); ctx.lineTo(W / 3, H);
        ctx.moveTo(2 * W / 3, 0); ctx.lineTo(2 * W / 3, H);
        ctx.moveTo(0, H / 3); ctx.lineTo(W, H / 3);
        ctx.moveTo(0, 2 * H / 3); ctx.lineTo(W, 2 * H / 3);
        ctx.stroke();
        ctx.restore();
    }

    // Expanding shockwave rings — additive stroked circles that grow via an
    // ease and thin + fade as they reach their max radius. World-space (called
    // inside the camera transform).
    _drawRings(ctx) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const ring of this.rings) {
            if (!ring.active) continue;
            const t = Math.min(1, ring.age / ring.life);
            const e = (Easing[ring.ease] || Easing.outQuad)(t);
            const r = ring.r0 + (ring.maxR - ring.r0) * e;
            const fade = 1 - t;
            ctx.globalAlpha = 0.7 * fade;
            ctx.strokeStyle = ring.color;
            ctx.lineWidth = Math.max(0.5, ring.width * fade);
            ctx.beginPath();
            ctx.arc(ring.x, ring.y, r, 0, TWO_PI);
            ctx.stroke();
        }
        ctx.restore();
    }

    // Red screen-edge vignette pulse on taking damage. Gradient is built once
    // (screen-space, fixed internal resolution) and cached; only alpha varies.
    _drawHitVignette(ctx) {
        if (!this._hitVignetteGrad) {
            const cx = INTERNAL_WIDTH / 2, cy = INTERNAL_HEIGHT / 2;
            const g = ctx.createRadialGradient(
                cx, cy, INTERNAL_HEIGHT * 0.32,
                cx, cy, INTERNAL_HEIGHT * 0.72
            );
            g.addColorStop(0, 'rgba(180,12,20,0)');
            g.addColorStop(1, 'rgba(150,8,16,1)');
            this._hitVignetteGrad = g;
        }
        ctx.save();
        ctx.globalAlpha = Math.min(0.6, this.hitVignette * 0.6);
        ctx.fillStyle = this._hitVignetteGrad;
        ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
        ctx.restore();
    }

    // Layout for the victory overlay's three stacked buttons (internal coords).
    _victoryRects() {
        const cx = INTERNAL_WIDTH / 2;
        const w = 560, h = 96, gap = 26;
        const top = INTERNAL_HEIGHT / 2 - 40;
        return {
            cont:  { x: cx - w / 2, y: top, w, h },
            biome: { x: cx - w / 2, y: top + (h + gap), w, h },
            menu:  { x: cx - w / 2, y: top + (h + gap) * 2, w, h },
            // EMBERGLASS: 4th SHARE button (only drawn/hit when a card was minted).
            share: { x: cx - w / 2, y: top + (h + gap) * 3, w, h },
        };
    }

    _drawVictory(ctx) {
        const W = INTERNAL_WIDTH, H = INTERNAL_HEIGHT;
        // Hold the victory beat: the hero cheers in the lit world before the
        // overlay dims/fades in (same offset the input lockout uses).
        const t = Math.min(1, Math.max(0, (this.victory.age || 0) - VICTORY_BEAT) / 0.35);
        ctx.save();
        // Dim the world.
        ctx.fillStyle = `rgba(8, 6, 16, ${0.78 * t})`;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = t;
        ctx.textAlign = 'center';
        // Title.
        ctx.fillStyle = '#ffd98a';
        ctx.font = 'bold 86px sans-serif';
        ctx.fillText('VIGIL TRIUMPHANT', W / 2, H / 2 - 150);
        ctx.fillStyle = '#cde4ff';
        ctx.font = '34px sans-serif';
        ctx.fillText('Three apex Hollow have fallen. A new biome opens.', W / 2, H / 2 - 96);

        const r = this._victoryRects();
        const btn = (rect, label, sub, fill, border) => {
            ctx.fillStyle = fill;
            ctx.strokeStyle = border;
            ctx.lineWidth = 3;
            if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 16); ctx.fill(); ctx.stroke(); }
            else { ctx.fillRect(rect.x, rect.y, rect.w, rect.h); ctx.strokeRect(rect.x, rect.y, rect.w, rect.h); }
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 38px sans-serif';
            ctx.fillText(label, rect.x + rect.w / 2, rect.y + (sub ? 42 : 60));
            if (sub) {
                ctx.fillStyle = 'rgba(255,255,255,0.75)';
                ctx.font = '22px sans-serif';
                ctx.fillText(sub, rect.x + rect.w / 2, rect.y + 74);
            }
        };
        btn(r.cont, 'CONTINUE', 'keep going — the gauntlet cycles harder', '#1d6b3a', '#7be08a');
        btn(r.biome, 'PLAY NEW BIOME', 'Hollow Reach — the frozen vigil', '#1d4a7a', '#7fd0ff');
        btn(r.menu, 'MAIN MENU', 'bank coins • upgrade • pick a map', '#5a3a1a', '#ffb24a');
        // EMBERGLASS: share the auto-minted victory card (S / tap).
        if (this.mintedCard) btn(r.share, 'SHARE CARD', 'copy your victory card to share', '#5a3a1a', '#ffd166');
        ctx.restore();
        // Toast (drawn at full alpha, outside the fade save block).
        if (this.shareToast) this._drawShareToast(ctx);
    }

    // Small centered toast pill for share results (used by victory + game-over).
    _drawShareToast(ctx) {
        const st = this.shareToast;
        if (!st) return;
        const W = INTERNAL_WIDTH;
        const a = Math.min(1, st.timer / 0.4);   // fade out over the last 0.4s
        ctx.save();
        ctx.globalAlpha = a;
        ctx.font = "600 30px 'Cinzel', serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(st.text).width + 64;
        const bx = W / 2 - tw / 2, by = 130, bh = 60;
        if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, tw, bh, 12); }
        else { ctx.beginPath(); ctx.rect(bx, by, tw, bh); }
        ctx.fillStyle = 'rgba(20, 12, 10, 0.92)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ff9a4a';
        ctx.stroke();
        ctx.fillStyle = '#ffd166';
        ctx.fillText(st.text, W / 2, by + bh / 2 + 1);
        ctx.restore();
    }

    _drawGrid(ctx) {
        const W = INTERNAL_WIDTH;
        const H = INTERNAL_HEIGHT;
        const camX = this.camera.x;
        const camY = this.camera.y;
        const startX = Math.floor((camX - W / 2) / GRID_SIZE) * GRID_SIZE;
        const endX = camX + W / 2 + GRID_SIZE;
        const startY = Math.floor((camY - H / 2) / GRID_SIZE) * GRID_SIZE;
        const endY = camY + H / 2 + GRID_SIZE;

        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = startX; x <= endX; x += GRID_SIZE) {
            ctx.moveTo(x, startY);
            ctx.lineTo(x, endY);
        }
        for (let y = startY; y <= endY; y += GRID_SIZE) {
            ctx.moveTo(startX, y);
            ctx.lineTo(endX, y);
        }
        ctx.stroke();

        ctx.fillStyle = '#3c5070';
        ctx.beginPath();
        ctx.arc(0, 0, 10, 0, Math.PI * 2);
        ctx.fill();
    }

    _drawWorldBounds(ctx, debug) {
        const hw = WORLD_WIDTH / 2;
        const hh = WORLD_HEIGHT / 2;
        // Palisade ring: a stockade wall strip drawn just OUTSIDE the playable
        // rect on all four sides, so the world edge reads as a real barrier
        // (the position clamp remains the actual wall) without eating any play
        // space. Horizontal strips run along top/bottom; the same strip is
        // rotated 90° for the sides. Corners overlap harmlessly.
        const strip = getBorderStrip();
        if (strip && !debug) {
            const pat = getBorderPattern(ctx);
            if (pat) {
                const S = strip.height;
                const spanW = WORLD_WIDTH + S * 2, spanH = WORLD_HEIGHT + S * 2;
                ctx.save();
                // Out-of-bounds wash: everything beyond the playable rect
                // drops a step darker BEFORE the fence draws, so the palisade
                // clearly divides in from out instead of blending into the
                // same ground texture on both sides. M covers the farthest
                // the camera can peek past the edge.
                const M = 1600;
                ctx.fillStyle = 'rgba(6,5,10,0.42)';
                ctx.fillRect(-hw - M, -hh - M, WORLD_WIDTH + M * 2, M);
                ctx.fillRect(-hw - M, hh, WORLD_WIDTH + M * 2, M);
                ctx.fillRect(-hw - M, -hh, M, WORLD_HEIGHT);
                ctx.fillRect(hw, -hh, M, WORLD_HEIGHT);
                ctx.fillStyle = pat;
                // Top edge — wall stands ON the north boundary, rising outward.
                ctx.save(); ctx.translate(-hw - S, -hh - S);
                ctx.fillRect(0, 0, spanW, S); ctx.restore();
                // Bottom edge — fully outside, pointed tops toward the field.
                ctx.save(); ctx.translate(-hw - S, hh);
                ctx.fillRect(0, 0, spanW, S); ctx.restore();
                // Right edge (rotated 90° cw: tips point outward/east).
                ctx.save(); ctx.translate(hw + S, -hh - S); ctx.rotate(Math.PI / 2);
                ctx.fillRect(0, 0, spanH, S); ctx.restore();
                // Left edge (rotated 90° ccw: tips point outward/west).
                ctx.save(); ctx.translate(-hw - S, hh + S); ctx.rotate(-Math.PI / 2);
                ctx.fillRect(0, 0, spanH, S); ctx.restore();
                // Contact shadow hugging the inside of the fence line —
                // stepped translucent bands (cheap fills, no per-frame
                // gradient) that ground the palisade and lift it off the
                // identical ground texture inside.
                ctx.fillStyle = 'rgba(0,0,0,0.10)';
                for (const wd of [30, 18, 8]) {
                    ctx.fillRect(-hw, -hh, WORLD_WIDTH, wd);
                    ctx.fillRect(-hw, hh - wd, WORLD_WIDTH, wd);
                    ctx.fillRect(-hw, -hh, wd, WORLD_HEIGHT);
                    ctx.fillRect(hw - wd, -hh, wd, WORLD_HEIGHT);
                }
                ctx.restore();
                return;
            }
        }
        ctx.save();
        ctx.strokeStyle = WORLD_BOUNDS_COLOR;
        if (debug) {
            ctx.globalAlpha = 1;
            ctx.lineWidth = 4;
            ctx.setLineDash([16, 12]);
        } else {
            ctx.globalAlpha = 0.22;
            ctx.lineWidth = 6;
            ctx.setLineDash([24, 18]);
        }
        ctx.strokeRect(-hw, -hh, WORLD_WIDTH, WORLD_HEIGHT);
        ctx.setLineDash([]);
        ctx.restore();
    }

    // Adaptive graphics quality. The GameLoop measures fps; a sustained
    // dip steps quality down (fewer lights/particles, tint then fog off),
    // and it recovers when fps climbs back. Player/pickup lights + combat
    // sparks are never throttled (the lower levels only thin the extras).
    _updateGfxGovernor(dt) {
        if (!GFX.governor.enabled) return;
        const fps = this.loop?.fps ?? 0;
        if (fps <= 0) return; // not measured yet
        const g = GFX.governor;
        if (fps < g.downFps) { this._gfxLowTimer += dt; this._gfxHighTimer = 0; }
        else if (fps > g.upFps) { this._gfxHighTimer += dt; this._gfxLowTimer = 0; }
        else { this._gfxLowTimer = 0; this._gfxHighTimer = 0; }

        if (this._gfxLowTimer >= g.sustainSeconds && this._gfxLevel < 3) {
            this._gfxLevel++;
            this._gfxLowTimer = 0;
            this._applyGfxLevel();
        } else if (this._gfxHighTimer >= g.sustainSeconds * 2 && this._gfxLevel > 0) {
            this._gfxLevel--;
            this._gfxHighTimer = 0;
            this._applyGfxLevel();
        }
    }

    _applyGfxLevel() {
        const lvl = this._gfxLevel;
        // The dominant cost on a struggling machine is full-screen fill
        // (darkness veil + additive light glows) at the backing-store
        // resolution, so each step sheds lights AND backing pixels. The DPR
        // ladder 2 → 2 → 1 → 0.7 is the real lever on high-res/4K PCs (level 3
        // renders below CSS size and upscales). Sprites are supersampled, so
        // even level 3 stays acceptably crisp.
        if (lvl === 0) {
            this.lighting.setQuality({
                maxLights: GFX.lighting.maxLights,
                colorTint: GFX.lighting.colorTint,
                strength: GFX.darkness.strength * (this.mapDarkness ?? 1),
            });
            this.particles.setQuality({ max: GFX.particles.max, fog: GFX.particles.fog });
            this.renderer.setDprCap?.(RENDER.maxDpr);
        } else if (lvl === 1) {
            this.lighting.setQuality({ maxLights: 64, colorTint: false });
            this.particles.setQuality({ max: 140, fog: GFX.particles.fog });
            this.renderer.setDprCap?.(RENDER.maxDpr);
        } else if (lvl === 2) {
            this.lighting.setQuality({ maxLights: 44, colorTint: false });
            this.particles.setQuality({ max: 90, fog: false });
            // Drop to true 1080p-equivalent backing (dpr 1) — big fill cut on
            // any retina/high-DPI display.
            this.renderer.setDprCap?.(1);
        } else {
            // Last resort for a fill-rate-bound display (e.g. 4K at 100% OS
            // scaling, where dpr is already 1): render BELOW CSS size and let
            // the browser upscale. Combined with the leanest light/particle
            // budget this reliably pulls a stuck machine back to playable.
            this.lighting.setQuality({ maxLights: 30, colorTint: false });
            this.particles.setQuality({ max: 70, fog: false });
            this.renderer.setDprCap?.(RENDER.minDpr);
        }
        // Cosmetic-but-not-free extras (decoration contact shadows) shed once
        // the governor is actively reducing quality.
        this.mapRenderer.lowQuality = this.reducedEffects || this._gfxLevel >= 2;
    }

    // True when (x, y) is within the camera view plus `margin`. Used to
    // cull off-screen entity draws. Compares against camera.x/y (the follow
    // center); the small shake offset is covered by the margin.
    _inView(x, y, margin) {
        return (
            Math.abs(x - this.camera.x) <= INTERNAL_WIDTH / 2 + margin &&
            Math.abs(y - this.camera.y) <= INTERNAL_HEIGHT / 2 + margin
        );
    }

    _drawContactFlash(ctx) {
        const intensity = Math.min(1, this.collisionSystem.contactFlash / CONTACT_FLASH_DURATION);
        ctx.save();
        ctx.globalAlpha = intensity * 0.7;
        ctx.strokeStyle = '#ff4757';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(this.player.x, this.player.y, this.player.radius + 14, 0, TWO_PI);
        ctx.stroke();
        ctx.restore();
    }
}
