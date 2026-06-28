import {
    GRID_COLOR,
    GRID_SIZE,
    WORLD_WIDTH,
    WORLD_HEIGHT,
    WORLD_BOUNDS_COLOR,
    DEBUG_DEFAULT_ON,
    INTERNAL_WIDTH,
    INTERNAL_HEIGHT,
    CONTACT_FLASH_DURATION,
    SCREEN_SHAKE,
    GEM,
    GEM_TIERS,
    ENEMY,
    BOSS,
    CHEST,
    COIN,
    ELEMENT,
    BOSS_ATTACK,
} from '../config/GameConfig.js';
import { TWO_PI, clamp, pickWeighted, compactInPlace } from './MathUtils.js';
import { Camera } from './Camera.js';
import { Player } from '../entities/Player.js';
import { Enemy } from '../entities/Enemy.js';
import { XPGem } from '../entities/XPGem.js';
import { Chest } from '../entities/Chest.js';
import { Coin } from '../entities/Coin.js';
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
import { LightingSystem } from '../systems/LightingSystem.js';
import { ParticleSystem } from '../systems/ParticleSystem.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { rollChestReward } from '../systems/ChestRewards.js';
import { findEligibleEvolutions } from '../content/evolutions.js';
import { WEAPONS } from '../content/weapons.js';
import { PERMANENT_UPGRADES, applyPermanentUpgrades, nextCost } from '../content/permanentUpgrades.js';
import { UISystem } from '../systems/UISystem.js';
import { GFX, LIGHT_COLORS } from '../config/GameConfig.js';

const DEBUG_BUTTON_TOUCH_SLOP = 24;

// Half the largest sprite (~91) + bar/label headroom + max camera shake.
// Anything whose center is farther than this from the view edge can't
// contribute a visible pixel and is skipped at draw time.
const CULL_MARGIN = 160;

// Second Wind only regenerates when no enemy is within this radius.
const SECOND_WIND_RADIUS = 340;

// Death-burst tint per enemy type (boss/elite handled separately).
const DEATH_COLORS = {
    slime: '#7be08a',
    bat: '#b48cff',
    crawler: '#9a7cff',
    brute: '#d8a060',
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
        // Lighting buffer + particle pool are also world-static / pooled,
        // so they live across runs (particles are cleared on run start).
        this.lighting = new LightingSystem();
        this.particles = new ParticleSystem();
        // Adaptive graphics governor state. level 0 = full quality.
        this._gfxLevel = 0;
        this._gfxLowTimer = 0;
        this._gfxHighTimer = 0;

        // Meta-progression flow: 'start' (title + shop) → 'gameplay' → 'gameOver'.
        // Boot lands on the start screen so the player can spend banked coins
        // before kicking off their first run.
        this.screen = 'start';
        this.resetConfirming = false;
        this.resetConfirmTimer = 0;

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
        this.showDebug = DEBUG_DEFAULT_ON && !touchPrimary;

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Backquote' || e.code === 'F2') {
                this.showDebug = !this.showDebug;
                return;
            }
            if (this.screen === 'start') {
                if (e.code === 'Space' || e.code === 'Enter') {
                    e.preventDefault();
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
                }
                return;
            }
            // Pause toggle — gameplay only, never while a level-up/chest
            // overlay is up (those already freeze the world).
            if (!this.chestReward && !this.upgradeChoices &&
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
                }
            }
        });

        const tryToggleDebugAt = (clientX, clientY) => {
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
            // Reroll button last, with exact bounds (no slop) so it can't
            // steal taps from the bottom edge of the cards.
            if (this.rerolls > 0) {
                const rr = this.ui.getRerollButtonRect();
                if (inRect(pos, rr, 0)) { this._pressFeedback('reroll'); this.rerollChoices(); return true; }
            }
            return true;
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
            const pos = this.renderer.clientToInternal(clientX, clientY);
            const rRestart = this.ui.getRestartButtonRect();
            if (inRect(pos, rRestart)) { this._pressFeedback('restart'); this.restart(); return true; }
            const rShop = this.ui.getReturnToShopButtonRect();
            if (rShop && inRect(pos, rShop)) { this._pressFeedback('returnShop'); this.returnToShop(); return true; }
            return true;
        };

        const tryStartScreenAt = (clientX, clientY) => {
            if (this.screen !== 'start') return false;
            const pos = this.renderer.clientToInternal(clientX, clientY);
            const rStart = this.ui.getStartRunButtonRect();
            if (inRect(pos, rStart)) { this._pressFeedback('start'); this._startRun(); return true; }
            const rReset = this.ui.getResetSaveButtonRect();
            if (inRect(pos, rReset)) {
                this._pressFeedback('reset');
                this.requestResetSave();
                return true;
            }
            // Tap an upgrade card to buy it.
            const cards = this.ui.getShopUpgradeRects(PERMANENT_UPGRADES.length);
            for (let i = 0; i < cards.length; i++) {
                if (inRect(pos, cards[i], 0)) {
                    this._pressFeedback(`shop:${PERMANENT_UPGRADES[i].id}`);
                    this.buyUpgrade(PERMANENT_UPGRADES[i].id);
                    return true;
                }
            }
            // Tap anywhere else cancels a pending reset confirmation so it
            // can't silently linger.
            this.resetConfirming = false;
            return true;
        };

        this.renderer.canvas.addEventListener('touchstart', (e) => {
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
                } else if (this.upgradeChoices) {
                    if (tryPickUpgradeAt(t.clientX, t.clientY)) return;
                } else if (this.paused) {
                    if (tryPauseOverlayAt(t.clientX, t.clientY)) return;
                } else {
                    if (tryPauseButtonAt(t.clientX, t.clientY)) return;
                    if (tryToggleDebugAt(t.clientX, t.clientY)) return;
                }
            }
        }, { passive: false });

        this.renderer.canvas.addEventListener('mousedown', (e) => {
            if (this.chestReward) {
                this._dismissChestReward();
                return;
            }
            if (this.screen === 'start') {
                tryStartScreenAt(e.clientX, e.clientY);
            } else if (this.screen === 'gameOver') {
                tryRestartAt(e.clientX, e.clientY);
            } else if (this.upgradeChoices) {
                tryPickUpgradeAt(e.clientX, e.clientY);
            } else if (this.paused) {
                tryPauseOverlayAt(e.clientX, e.clientY);
            } else {
                if (!tryPauseButtonAt(e.clientX, e.clientY)) {
                    tryToggleDebugAt(e.clientX, e.clientY);
                }
            }
        });

        // Auto-pause when the tab/window loses focus so a backgrounded run
        // can't take unfair damage (the loop keeps stepping otherwise).
        const autoPause = () => {
            if (this.screen === 'gameplay' && !this.gameOver &&
                !this.upgradeChoices && !this.chestReward && !this.paused) {
                this.paused = true;
                this._updateJoystickEnabled();
            }
        };
        window.addEventListener('blur', autoPause);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) autoPause();
        });
    }

    _initRunState() {
        this.player = new Player();
        this.camera.follow(this.player);

        this.enemies = [];
        this.projectiles = [];
        this.enemyProjectiles = [];
        // Damaging area hazards (boss shockwaves) + their telegraph decals.
        // Game-owned pool; cleared here so a restart never inherits one.
        this.hazards = [];
        this.gems = [];
        this.damageNumbers = [];

        this.spawner = new Spawner();
        this.weaponSystem = new WeaponSystem();
        this.collisionSystem = new CollisionSystem();
        this.upgradeSystem = new UpgradeSystem();
        this.passiveSystem = new PassiveSystem();
        this.waveDirector = new WaveDirector();
        this.bossDirector = new BossDirector();
        // Cache the current wave state so render can read it without
        // re-computing during the same frame.
        this.waveState = this.waveDirector.getState(0);

        // Chest pickup pauses gameplay just like a level-up. pendingChests
        // queues additional chests collected while the overlay is up.
        this.chests = [];
        this.chestReward = null;
        this.pendingChests = 0;
        this.coins = [];
        // Cached reference to the strongest active boss for the boss HP bar.
        this.activeBossRef = null;
        this.bossesDefeated = 0;
        this.runSummary = null;

        this.time = 0;
        this.kills = 0;
        this.upgradeChoices = null;
        this.pendingLevelUps = 0;
        this.gameOver = false;
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
        // Starting coins granted by the shop this run — excluded from the
        // banked total so the Starting Coins upgrade doesn't refund itself.
        this.startingCoinsGranted = 0;

        // A fresh run should never inherit a half-armed save-reset confirm.
        this.resetConfirming = false;
        this.paused = false;
        // Level-up agency resources (granted from the shop in _startRun).
        this.rerolls = 0;
        this.banishes = 0;
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
        this._initRunState();
        const coinsBefore = this.player.coins ?? 0;
        applyPermanentUpgrades(this.player, this.saveSystem.data);
        // Remember how many coins the shop handed us so _enterGameOver can
        // bank only what was *earned* this run, not the granted seed.
        this.startingCoinsGranted = Math.max(0, (this.player.coins ?? 0) - coinsBefore);
        // Level-up agency resources: 1 free reroll baseline so the feature
        // is discoverable, plus whatever the shop granted onto the player.
        this.rerolls = 1 + (this.player.rerolls ?? 0);
        this.banishes = this.player.banishes ?? 0;
        // Screen-shake preference (accessibility) read from the save.
        this.shakeEnabled = this.saveSystem.getSetting('screenShake') !== false;
        this._lastHp = this.player.hp;
        this.screen = 'gameplay';
        // Reset the UI's per-run animation state (bar display values, boss
        // bar slide, etc.) so nothing carries over from the previous run.
        if (this.ui.beginRun) this.ui.beginRun(this.player);
        this._updateJoystickEnabled();
    }

    restart() {
        // Leaving a live (paused) run still banks what was earned, matching
        // the death path. No-op once already banked this run.
        this._bankRunCoins();
        this._startRun();
    }

    returnToShop() {
        this._bankRunCoins();
        this.screen = 'start';
        this.resetConfirming = false;
        this.resetConfirmTimer = 0;
        this.paused = false;
        this._updateJoystickEnabled();
    }

    // Bank coins earned this run into the save total, exactly once (guarded
    // by bankedThisRun). Excludes the shop-granted starting seed. Returns the
    // amount banked (0 if already banked).
    _bankRunCoins() {
        if (this.bankedThisRun) return 0;
        const earned = Math.max(
            0,
            Math.floor((this.player.coins ?? 0) - (this.startingCoinsGranted ?? 0))
        );
        if (earned > 0) this.saveSystem.addCoins(earned);
        this.bankedThisRun = true;
        return earned;
    }

    // Pause is only meaningful during live gameplay (overlays already
    // freeze the world). Toggling re-enables/disables the joystick.
    togglePause() {
        if (this.screen !== 'gameplay' || this.gameOver ||
            this.upgradeChoices || this.chestReward) return;
        this.paused = !this.paused;
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

    // Re-roll the current level-up offer (costs one reroll charge).
    rerollChoices() {
        if (!this.upgradeChoices || this.rerolls <= 0) return;
        this.rerolls -= 1;
        const choices = this.upgradeSystem.rollChoices(this, 3);
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
        this.upgradeSystem.banish(card.id);
        const choices = this.upgradeSystem.rollChoices(this, 3);
        this.setUpgradeChoices(choices.length > 0 ? choices : this.upgradeChoices);
    }

    buyUpgrade(id) {
        const upgrade = PERMANENT_UPGRADES.find((u) => u.id === id);
        if (!upgrade) return false;
        const cur = this.saveSystem.getUpgradeLevel(id);
        if (cur >= upgrade.maxLevel) return false;
        const cost = upgrade.costAt(cur);
        if (!this.saveSystem.spendCoins(cost)) return false;
        this.saveSystem.incrementUpgrade(id);
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
            !!this.upgradeChoices || !!this.chestReward;
        this.input.touch.setEnabled(!blocked);
    }

    _presentLevelUp() {
        if (this.pendingLevelUps <= 0) return;
        this.pendingLevelUps -= 1;
        const choices = this.upgradeSystem.rollChoices(this, 3);
        this.setUpgradeChoices(choices.length > 0 ? choices : null);
    }

    selectUpgrade(idx) {
        if (!this.upgradeChoices) return;
        const upgrade = this.upgradeChoices[idx];
        if (!upgrade) return;
        this.upgradeSystem.apply(upgrade, this);
        this.setUpgradeChoices(null);
        // Drain pending level-ups first, then move on to any queued chests
        // so the player isn't tossed between overlay types mid-stream.
        if (this.pendingLevelUps > 0) this._presentLevelUp();
        else if (this.pendingChests > 0) this._presentChest();
    }

    _presentChest() {
        if (this.pendingChests <= 0) return;
        this.pendingChests -= 1;
        const reward = rollChestReward(this);
        // Apply the reward immediately so the in-game state already reflects
        // what the overlay is announcing. The overlay is confirmation, not a
        // commit step — closing it just resumes gameplay.
        reward.apply(this);
        this.chestReward = { reward, age: 0 };
        this._updateJoystickEnabled();
    }

    _dismissChestReward() {
        if (!this.chestReward) return;
        this.chestReward = null;
        this._updateJoystickEnabled();
        if (this.pendingChests > 0) this._presentChest();
        else if (this.pendingLevelUps > 0) this._presentLevelUp();
    }

    _spawnBoss(id) {
        const def = ENEMY[id];
        if (!def || !def.boss) return;
        const angle = Math.random() * TWO_PI;
        const dist = BOSS.spawnRingDistance;
        const halfW = WORLD_WIDTH / 2 - 100;
        const halfH = WORLD_HEIGHT / 2 - 100;
        const x = clamp(this.player.x + Math.cos(angle) * dist, -halfW, halfW);
        const y = clamp(this.player.y + Math.sin(angle) * dist, -halfH, halfH);
        const boss = new Enemy(id, x, y, {
            healthMul: this.waveState.healthMul,
            speedMul: this.waveState.speedMul,
        });
        // Stash the stable output channels the apex-boss AI writes into
        // (radial volleys go to the enemy-bolt loop; shockwaves to the hazard
        // pool). Both arrays are created once in _initRunState, so this
        // reference stays valid for the boss's whole life.
        boss._bossOut = { enemyProjectiles: this.enemyProjectiles, hazards: this.hazards };
        this.enemies.push(boss);
        this.waveDirector.announce(`${def.bossName} approaches!`, 3.5);
        // A heavier, longer shake than a normal hit to telegraph the arrival.
        this._shake(SCREEN_SHAKE.intensity * 0.85, 0.45);
    }

    _dropChest(x, y) {
        this.chests.push(new Chest(x, y));
    }

    _dropCoin(x, y, value = 1) {
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
        let numberBudget = 6;
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
        return { killed, hits };
    }

    // Elite affix on-death effects. Volatile detonates an AoE; Splitting
    // bursts into a few crawlers (non-elite, so no recursive splitting).
    _applyAffixDeath(e) {
        const def = e.affixDef;
        if (!def) return;
        if (e.affix === 'volatile') {
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
            for (let i = 0; i < count; i++) {
                const a = (i / count) * TWO_PI + Math.random() * 0.5;
                const ox = e.x + Math.cos(a) * 40;
                const oy = e.y + Math.sin(a) * 40;
                this.enemies.push(new Enemy(type, ox, oy, {
                    healthMul: this.waveState.healthMul,
                    speedMul: this.waveState.speedMul,
                }));
            }
        }
    }

    _enterGameOver() {
        if (this.gameOver) return;
        this.gameOver = true;
        this.screen = 'gameOver';
        this.gameOverAge = 0;
        this.upgradeChoices = null;
        this.pendingLevelUps = 0;
        this.chestReward = null;
        this.pendingChests = 0;

        // Bank run coins to total — exactly once (the helper is guarded by
        // bankedThisRun, which also covers abandoning via the pause overlay).
        const earned = this._bankRunCoins();

        this.runSummary = {
            time: this.time,
            level: this.player.level,
            kills: this.kills,
            bossesDefeated: this.bossesDefeated,
            coinsEarned: earned,
            totalCoins: this.saveSystem.data.totalCoins,
            finalWave: (this.waveState?.index ?? 0) + 1,
            finalWaveName: this.waveState?.name ?? '',
            weapons: this.weaponSystem.snapshotForUI(),
            passives: this.passiveSystem.snapshotForUI(),
            evolutions: this.weaponSystem.owned
                .filter((w) => WEAPONS[w.id]?.evolved)
                .map((w) => WEAPONS[w.id].name),
        };

        // Fold the run into lifetime/best records; capture which bests were
        // beaten so the game-over summary can flag them.
        this.newBest = this.saveSystem.recordRun(this.runSummary);

        this._updateJoystickEnabled();
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

        // Meta-screen states never tick gameplay; the start screen still
        // ticks the reset-confirm timeout so the "tap again to confirm"
        // prompt times out cleanly.
        if (this.screen === 'start') {
            if (this.resetConfirming) {
                this.resetConfirmTimer -= dt;
                if (this.resetConfirmTimer <= 0) this.resetConfirming = false;
            }
            return;
        }
        if (this.screen === 'gameOver') {
            this.gameOverAge += dt;
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
        if (this.paused) {
            // Frozen world; only the camera settles.
            this.camera.update(dt);
            return;
        }

        this.time += dt;

        this.waveDirector.update(dt, this.time);
        this.waveState = this.waveDirector.getState(this.time);

        const bossesToSpawn = this.bossDirector.update(this.time);
        for (const id of bossesToSpawn) this._spawnBoss(id);

        this.player.update(dt, this.input);
        this.spawner.update(dt, this.player, this.enemies, this.waveState);
        const weaponResult = this.weaponSystem.update(
            dt, this.player, this.enemies, this.projectiles
        );

        for (const e of this.enemies) {
            if (e.active) e.update(dt, this.player, this.enemyProjectiles);
        }
        // Elemental DoT (burn) is applied here, NOT in Enemy.update, because
        // a burn kill must route through the same reward pipeline as any
        // other kill (gems/coins/affix-death/kill-count). statusResult.killed
        // is merged into allKilled below.
        const statusResult = this._tickStatuses(dt);

        // Phase-2 enrage: a boss that just crossed its HP threshold announces
        // + shakes exactly once (latched by enrageShouted). The phase flip
        // itself happens inside the boss AI; this only fires the one-shot FX.
        for (const e of this.enemies) {
            if (e.active && e.boss && e.phase2Entered && !e.enrageShouted) {
                e.enrageShouted = true;
                this.waveDirector.announce('ENRAGED!', 1.2);
                this._shake(SCREEN_SHAKE.intensity * 0.85, 0.45);
            }
        }

        for (const p of this.projectiles) {
            if (p.active) p.update(dt);
        }
        // Enemy bolts (Spitters + boss volleys). Each can hit the player once;
        // a landed hit drives the same shake + flash + damage number as
        // contact damage.
        for (const ep of this.enemyProjectiles) {
            if (!ep.active) continue;
            const dealt = ep.update(dt, this.player);
            if (dealt > 0) {
                this._shake(SCREEN_SHAKE.intensity, SCREEN_SHAKE.duration);
                this._pushFeedback('hit', 0.32);
                this.damageNumbers.push(new DamageNumber(
                    this.player.x, this.player.y - this.player.radius, dealt, '#ff4757'
                ));
            }
        }

        // Boss area hazards (expanding shockwaves) + their telegraph decals.
        // Runs BEFORE the Second Wind regen check so HP/i-frames stay
        // consistent within the frame. A shockwave damages the player once,
        // when its expanding band first crosses them (i-frames handle the rest).
        for (const hz of this.hazards) {
            if (!hz.active) continue;
            hz.age += dt;
            if (hz.kind === 'bossTelegraph') {
                hz.r = hz.rMax * Math.min(1, hz.age / hz.lifetime);
                if (hz.age >= hz.lifetime) hz.active = false;
                continue;
            }
            // shockwave: expand and damage the player once when the ring band
            // sweeps across them.
            hz.r += hz.growth * dt;
            if (!hz.hitPlayer) {
                const d = Math.hypot(this.player.x - hz.x, this.player.y - hz.y);
                if (d >= hz.r - hz.band && d <= hz.r + hz.band) {
                    const dealt = this.player.takeDamage(hz.damage);
                    if (dealt > 0) {
                        hz.hitPlayer = true;
                        this._shake(SCREEN_SHAKE.intensity, SCREEN_SHAKE.duration);
                        this._pushFeedback('hit', 0.32);
                        this.damageNumbers.push(new DamageNumber(
                            this.player.x, this.player.y - this.player.radius, dealt, '#ff4757'
                        ));
                    }
                }
            }
            if (hz.r >= hz.rMax) hz.active = false;
        }

        let xpCollected = 0;
        for (const g of this.gems) {
            if (!g.active) continue;
            const xp = g.update(dt, this.player);
            if (xp > 0) {
                xpCollected += xp;
                this.particles.pickupSparkle(g.x, g.y, gemLightColor(g.tier));
            }
        }
        if (xpCollected > 0) {
            const levels = this.player.gainXP(xpCollected);
            if (levels > 0) {
                this.pendingLevelUps += levels;
                this._pushFeedback('levelup', 0.5);
                this.particles.levelUpBurst(this.player.x, this.player.y);
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
            }
        }

        const collisionResult = this.collisionSystem.resolve(
            dt, this.player, this.enemies, this.projectiles
        );

        // Merge weapon-system hits/kills (orbit blades, pulse, lightning),
        // projectile-collision results, and burn-DoT kills so gem drops, kill
        // count, affix deaths, and damage numbers all flow through the same
        // downstream path. (Burn damage numbers are already pushed, tinted,
        // inside _tickStatuses — so only its killed list is merged here.)
        const allKilled = collisionResult.killed
            .concat(weaponResult.killed, statusResult.killed);
        const allHits = collisionResult.hits.concat(weaponResult.hits);

        if (allKilled.length > 0) {
            this.kills += allKilled.length;
            for (const e of allKilled) {
                this.particles.deathBurst(e.x, e.y, deathColor(e));
                if (e.affix) this._applyAffixDeath(e);
                this._dropGem(e.x, e.y);
                if (e.boss) {
                    // Bosses always drop a chest + a coin burst.
                    this.bossesDefeated += 1;
                    this._dropChest(e.x, e.y);
                    this._dropCoinBurst(e.x, e.y, COIN.bossCoinCount, COIN.bossCoinValue);
                } else if (e.elite) {
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
        // Hit sparks are bright but capped per frame so a wide AoE hit
        // (pulse/orbit striking a crowd) can't drain the particle pool and
        // starve death bursts.
        let sparkBudget = 6;
        for (const hit of allHits) {
            this.damageNumbers.push(new DamageNumber(hit.x, hit.y, hit.amount, '#ffffff'));
            if (sparkBudget > 0) {
                this.particles.hitSpark(hit.x, hit.y);
                sparkBudget--;
            }
        }
        if (collisionResult.playerHit) {
            this._shake(SCREEN_SHAKE.intensity, SCREEN_SHAKE.duration);
            this._pushFeedback('hit', 0.32);
            this.damageNumbers.push(new DamageNumber(
                this.player.x,
                this.player.y - this.player.radius,
                collisionResult.playerDamageTaken,
                '#ff4757'
            ));
        }

        for (const d of this.damageNumbers) {
            if (d.active) d.update(dt);
        }

        // Advance particles (ambient embers + fog spawn around the player).
        this.particles.update(dt, this.player);
        this._updateGfxGovernor(dt);

        // Chest pickup: chests sit until the player walks onto them, then
        // queue a chest reward overlay. Multiple chests collected in the
        // same tick are queued via pendingChests.
        for (const c of this.chests) {
            if (!c.active) continue;
            if (c.update(dt, this.player)) {
                this.pendingChests += 1;
            }
        }
        if (this.pendingChests > 0 && !this.chestReward && !this.upgradeChoices) {
            this._presentChest();
        }

        // Cache the strongest active boss for the UI HP bar. Picking by
        // max HP means a fresh stronger boss takes the bar over from an
        // older weaker one if they're alive at the same time.
        this.activeBossRef = null;
        for (const e of this.enemies) {
            if (!e.active || !e.boss) continue;
            if (!this.activeBossRef || e.maxHp > this.activeBossRef.maxHp) {
                this.activeBossRef = e;
            }
        }

        compactInPlace(this.enemies);
        compactInPlace(this.projectiles);
        compactInPlace(this.enemyProjectiles);
        compactInPlace(this.hazards);
        compactInPlace(this.gems);
        compactInPlace(this.damageNumbers);
        compactInPlace(this.chests);
        compactInPlace(this.coins);

        // Heal flash: any net HP rise this frame (level-up heal, chest heal)
        // fires a green feedback pulse. Tracked centrally so individual
        // reward code doesn't each need to remember to trigger it.
        if (this.player.hp > this._lastHp + 0.5) this._pushFeedback('heal', 0.4);
        this._lastHp = this.player.hp;

        // Second Wind: trickle HP back while no enemy is within the safe
        // radius. Applied after the heal-flash check so the tiny per-frame
        // tick doesn't spam the green flash.
        if (this.player.regenPerSecond > 0 && this.player.hp < this.player.maxHp) {
            const sr2 = SECOND_WIND_RADIUS * SECOND_WIND_RADIUS;
            let safe = true;
            for (const e of this.enemies) {
                if (!e.active) continue;
                const ex = e.x - this.player.x;
                const ey = e.y - this.player.y;
                if (ex * ex + ey * ey < sr2) { safe = false; break; }
            }
            if (safe) {
                this.player.hp = Math.min(
                    this.player.maxHp,
                    this.player.hp + this.player.regenPerSecond * dt
                );
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
            this.ui.draw(ctx, this._buildUIState());
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

        // Ground → grid(debug) → decorations (which register candle lights)
        // → low fog (below entities) → bounds.
        this.mapRenderer.drawBackground(ctx, this.camera, INTERNAL_WIDTH, INTERNAL_HEIGHT);
        if (this.showDebug) this._drawGrid(ctx);
        this.mapRenderer.drawDecorations(ctx, this.camera, INTERNAL_WIDTH, INTERNAL_HEIGHT, L);
        this.particles.drawWorldFog(ctx, this.camera);
        this._drawWorldBounds(ctx, this.showDebug);

        // Off-screen culling: only entities within the camera view (plus a
        // sprite-half + shake margin) are worth a draw call (enemies spawn
        // ~1100-1350px out, cap up to 145). Lights are registered in the
        // SAME culled loops so light cost scales with visible emitters too.
        const cull = (e) => this._inView(e.x, e.y, CULL_MARGIN);
        const Lc = GFX.lighting;

        // Boss telegraph decals — drawn on the GROUND, below entities, so the
        // boss paints over them. A warning ring that fills in across the
        // windup; no light (it reads as a warning, not a glow).
        for (const hz of this.hazards) {
            if (!hz.active || hz.kind !== 'bossTelegraph') continue;
            if (!this._inView(hz.x, hz.y, hz.rMax + CULL_MARGIN)) continue;
            const t = Math.min(1, hz.age / hz.lifetime);
            ctx.save();
            ctx.globalAlpha = 0.2 + 0.6 * t;
            ctx.strokeStyle = BOSS_ATTACK.telegraphColor;
            ctx.lineWidth = hz.fan ? 4 : 5;
            ctx.beginPath();
            ctx.arc(hz.x, hz.y, Math.max(2, hz.r), 0, TWO_PI);
            ctx.stroke();
            ctx.restore();
        }

        // Player light first (always kept, exempt from caps).
        if (L) L.addLight(this.player.x, this.player.y, Lc.playerRadius, LIGHT_COLORS.player, Lc.playerIntensity, 0);

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
        for (const c of this.chests) {
            if (!cull(c)) continue;
            c.draw(ctx);
            if (L) L.addLight(c.x, c.y, Lc.chestRadius, LIGHT_COLORS.chest, 0.9, 1);
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
        // Boss shockwaves — bright expanding rings (above entities). Each
        // carves a hazard-tinted light so the danger reads against the dark.
        for (const hz of this.hazards) {
            if (!hz.active || hz.kind !== 'shockwave') continue;
            if (!this._inView(hz.x, hz.y, hz.rMax + CULL_MARGIN)) continue;
            const fade = 1 - Math.min(1, hz.r / hz.rMax);
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.35 + 0.45 * fade;
            ctx.strokeStyle = '#ffd0a0';
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.arc(hz.x, hz.y, hz.r, 0, TWO_PI);
            ctx.stroke();
            ctx.globalAlpha = 0.2 + 0.3 * fade;
            ctx.strokeStyle = LIGHT_COLORS.hazard;
            ctx.lineWidth = 18;
            ctx.beginPath();
            ctx.arc(hz.x, hz.y, hz.r, 0, TWO_PI);
            ctx.stroke();
            ctx.restore();
            if (L) L.addLight(hz.x, hz.y, Lc.hazardRadius, LIGHT_COLORS.hazard, 0.8, 0);
        }

        this.weaponSystem.drawEffects(ctx);
        // Weapon effects (pulse/lightning) are bright emitters — carve light
        // holes so the veil doesn't dim them.
        if (L) {
            for (const fx of this.weaponSystem.effects) {
                if (!fx.active) continue;
                L.addLight(fx.x, fx.y, Lc.effectRadius, LIGHT_COLORS.effect, 0.8, 0);
            }
        }

        // Occludable additive particles (embers + death dust) — these sit
        // above entities but BELOW the veil, so they read as ambient glow.
        this.particles.drawWorldAdditive(ctx, this.camera);

        if (this.collisionSystem.contactFlash > 0) {
            this._drawContactFlash(ctx);
        }

        if (this.showDebug) {
            this.mapRenderer.drawDebug(ctx, this.camera, INTERNAL_WIDTH, INTERNAL_HEIGHT);
            this.player.drawDebug(ctx);
            for (const g of this.gems) if (cull(g)) g.drawDebug(ctx);
            for (const c of this.coins) if (cull(c)) c.drawDebug(ctx);
            for (const c of this.chests) if (cull(c)) c.drawDebug(ctx);
            for (const e of this.enemies) if (cull(e)) e.drawDebug(ctx);
            for (const p of this.projectiles) if (cull(p)) p.drawDebug(ctx);
            for (const ep of this.enemyProjectiles) if (cull(ep)) ep.drawDebug(ctx);
        }
        ctx.restore();

        // SCREEN SPACE. Composite the darkness veil (+ baked vignette +
        // color tint) over the lit world, or fall back to the plain
        // vignette if the lighting buffer is unavailable.
        if (L) L.composite(ctx);
        else this.mapRenderer.drawVignette(ctx, INTERNAL_WIDTH, INTERNAL_HEIGHT);

        // Always-bright sparks sit ABOVE the veil so kill/hit/pickup/level
        // feedback never gets dimmed by the darkness.
        this.particles.drawScreenAdditive(ctx, this.camera);

        // Damage numbers also draw above the veil (world-positioned via a
        // re-applied camera transform) so combat math stays fully legible.
        ctx.save();
        this.camera.apply(ctx);
        for (const d of this.damageNumbers) if (cull(d)) d.draw(ctx);
        ctx.restore();

        this.ui.draw(ctx, this._buildUIState());

        if (this.screen === 'gameplay' && this.input.touch) this.input.touch.draw(ctx);
    }

    _buildUIState() {
        // Fields every screen needs. Press/feedback animation state is
        // always included so flashes can play across transitions.
        const base = {
            screen: this.screen,
            showDebug: this.showDebug,
            saveData: this.saveSystem.data,
            pressFx: this.pressFx,
            feedback: this.feedback,
        };

        // Start/shop screen: only the shop data is meaningful. Skip every
        // gameplay snapshot + the per-frame evolution scan entirely.
        if (this.screen === 'start') {
            base.resetConfirming = this.resetConfirming;
            base.resetConfirmTimer = this.resetConfirmTimer;
            base.stats = this.saveSystem.data.stats;
            base.permanentUpgrades = PERMANENT_UPGRADES.map((u) => {
                const level = this.saveSystem.getUpgradeLevel(u.id);
                return {
                    id: u.id,
                    name: u.name,
                    description: u.description,
                    level,
                    maxLevel: u.maxLevel,
                    cost: nextCost(u, level),
                    isMax: level >= u.maxLevel,
                };
            });
            return base;
        }

        // Gameplay + game-over share the HUD.
        base.time = this.time;
        base.player = this.player;
        base.camera = this.camera;
        base.kills = this.kills;
        base.enemyCount = this.enemies.length;
        base.projectileCount = this.projectiles.length;
        base.gemCount = this.gems.length;
        base.coinCount = this.coins.length;
        base.effectCount = this.weaponSystem.effects.length;
        base.ownedWeapons = this.weaponSystem.snapshotForUI();
        base.ownedPassives = this.passiveSystem.snapshotForUI();
        base.runCoins = this.player.coins ?? 0;
        base.chestLuck = this.player.chestLuck ?? 0;
        base.waveState = this.waveState;
        base.waveAnnouncement = this.waveDirector.announcement;
        base.activeBoss = this.activeBossRef ? {
            name: this.activeBossRef.name,
            hp: this.activeBossRef.hp,
            maxHp: this.activeBossRef.maxHp,
            phase: this.activeBossRef.phase ?? 1,
            enraged: !!this.activeBossRef.phase2Entered,
        } : null;
        base.chestCount = this.chests.length;
        base.chestReward = this.chestReward;
        base.pendingChests = this.pendingChests;
        base.nextBossTime = this.bossDirector.getNextSpawnTime();
        // Only the debug panel shows this, and the scan walks every
        // evolution every frame — so only pay for it when debug is on.
        base.eligibleEvolutionCount = this.showDebug ? findEligibleEvolutions(this).length : 0;
        base.spawnTimer = this.spawner.timer;
        base.spawnInterval = this.spawner.nextInterval;
        base.inContact = this.collisionSystem.inContact;
        base.upgradeChoices = this.upgradeChoices;
        base.upgradeCounts = this.upgradeSystem.appliedCounts;
        base.pendingLevelUps = this.pendingLevelUps;
        base.levelUpAge = this.levelUpAge;
        base.gameOver = this.gameOver;
        base.gameOverAge = this.gameOverAge;
        base.bossesDefeated = this.bossesDefeated;
        base.runSummary = this.runSummary;
        base.newBest = this.newBest;
        base.paused = this.paused;
        base.shakeEnabled = this.shakeEnabled;
        base.rerolls = this.rerolls;
        base.banishes = this.banishes;
        return base;
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

        if (this._gfxLowTimer >= g.sustainSeconds && this._gfxLevel < 2) {
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
        if (lvl === 0) {
            this.lighting.setQuality({
                maxLights: GFX.lighting.maxLights,
                colorTint: GFX.lighting.colorTint,
                strength: GFX.darkness.strength,
            });
            this.particles.setQuality({ max: GFX.particles.max, fog: GFX.particles.fog });
        } else if (lvl === 1) {
            this.lighting.setQuality({ maxLights: 64, colorTint: false });
            this.particles.setQuality({ max: 140, fog: GFX.particles.fog });
        } else {
            this.lighting.setQuality({ maxLights: 44, colorTint: false });
            this.particles.setQuality({ max: 90, fog: false });
        }
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
