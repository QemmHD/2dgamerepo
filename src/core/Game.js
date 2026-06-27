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
} from '../config/GameConfig.js';
import { TWO_PI, clamp, pickWeighted, compactInPlace } from './MathUtils.js';
import { Camera } from './Camera.js';
import { Player } from '../entities/Player.js';
import { Enemy } from '../entities/Enemy.js';
import { XPGem } from '../entities/XPGem.js';
import { Chest } from '../entities/Chest.js';
import { DamageNumber } from '../entities/DamageNumber.js';
import { Spawner } from '../systems/Spawner.js';
import { WeaponSystem } from '../systems/WeaponSystem.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { UpgradeSystem } from '../systems/UpgradeSystem.js';
import { PassiveSystem } from '../systems/PassiveSystem.js';
import { WaveDirector } from '../systems/WaveDirector.js';
import { BossDirector } from '../systems/BossDirector.js';
import { rollChestReward } from '../systems/ChestRewards.js';
import { findEligibleEvolutions } from '../content/evolutions.js';
import { UISystem } from '../systems/UISystem.js';

const DEBUG_BUTTON_TOUCH_SLOP = 24;

export class Game {
    constructor({ renderer, input, loop }) {
        this.renderer = renderer;
        this.input = input;
        this.loop = loop;
        this.camera = new Camera();
        this.ui = new UISystem({ renderer, loop });

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
            if (this.gameOver) {
                if (e.code === 'KeyR' || e.code === 'Enter') {
                    e.preventDefault();
                    this.restart();
                }
                return;
            }
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
                this.showDebug = !this.showDebug;
                return true;
            }
            return false;
        };

        const tryPickUpgradeAt = (clientX, clientY) => {
            if (!this.upgradeChoices) return false;
            const pos = this.renderer.clientToInternal(clientX, clientY);
            const rects = this.ui.getLevelUpCardRects(this.upgradeChoices.length);
            for (let i = 0; i < rects.length; i++) {
                const r = rects[i];
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
            return true;
        };

        const tryRestartAt = (clientX, clientY) => {
            if (!this.gameOver) return false;
            const pos = this.renderer.clientToInternal(clientX, clientY);
            const r = this.ui.getRestartButtonRect();
            const slop = 20;
            if (
                pos.x >= r.x - slop &&
                pos.x <= r.x + r.w + slop &&
                pos.y >= r.y - slop &&
                pos.y <= r.y + r.h + slop
            ) {
                this.restart();
                return true;
            }
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
                if (this.gameOver) {
                    if (tryRestartAt(t.clientX, t.clientY)) return;
                } else if (this.upgradeChoices) {
                    if (tryPickUpgradeAt(t.clientX, t.clientY)) return;
                } else if (tryToggleDebugAt(t.clientX, t.clientY)) {
                    return;
                }
            }
        }, { passive: false });

        this.renderer.canvas.addEventListener('mousedown', (e) => {
            if (this.chestReward) {
                this._dismissChestReward();
                return;
            }
            if (this.gameOver) {
                tryRestartAt(e.clientX, e.clientY);
            } else if (this.upgradeChoices) {
                tryPickUpgradeAt(e.clientX, e.clientY);
            } else {
                tryToggleDebugAt(e.clientX, e.clientY);
            }
        });
    }

    _initRunState() {
        this.player = new Player();
        this.camera.follow(this.player);

        this.enemies = [];
        this.projectiles = [];
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
        // Cached reference to the strongest active boss for the boss HP bar.
        this.activeBossRef = null;

        this.time = 0;
        this.kills = 0;
        this.upgradeChoices = null;
        this.pendingLevelUps = 0;
        this.gameOver = false;

        if (this.input.touch) this.input.touch.setEnabled(true);
    }

    restart() {
        this._initRunState();
    }

    setUpgradeChoices(choices) {
        this.upgradeChoices = choices;
        this._updateJoystickEnabled();
    }

    // Joystick is disabled whenever ANY overlay is up so a stray drag can't
    // start while the player is reading a card / chest reward / GAME OVER.
    _updateJoystickEnabled() {
        if (!this.input.touch) return;
        const blocked = this.gameOver || !!this.upgradeChoices || !!this.chestReward;
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
        this.enemies.push(boss);
        this.waveDirector.announce(`${def.bossName} approaches!`, 3.5);
    }

    _dropChest(x, y) {
        this.chests.push(new Chest(x, y));
    }

    _enterGameOver() {
        this.gameOver = true;
        this.upgradeChoices = null;
        this.pendingLevelUps = 0;
        this.chestReward = null;
        this.pendingChests = 0;
        this._updateJoystickEnabled();
    }

    update(dt) {
        if (this.gameOver) {
            this.camera.update(dt);
            return;
        }
        if (this.upgradeChoices) {
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
            if (e.active) e.update(dt, this.player);
        }
        for (const p of this.projectiles) {
            if (p.active) p.update(dt);
        }

        let xpCollected = 0;
        for (const g of this.gems) {
            if (!g.active) continue;
            const xp = g.update(dt, this.player);
            if (xp > 0) xpCollected += xp;
        }
        if (xpCollected > 0) {
            const levels = this.player.gainXP(xpCollected);
            if (levels > 0) {
                this.pendingLevelUps += levels;
                if (!this.upgradeChoices) this._presentLevelUp();
            }
        }

        const collisionResult = this.collisionSystem.resolve(
            dt, this.player, this.enemies, this.projectiles
        );

        // Merge weapon-system hits/kills (orbit blades, pulse, lightning) with
        // projectile-collision results so gem drops, kill count, and damage
        // numbers all flow through the same downstream path.
        const allKilled = collisionResult.killed.concat(weaponResult.killed);
        const allHits = collisionResult.hits.concat(weaponResult.hits);

        if (allKilled.length > 0) {
            this.kills += allKilled.length;
            for (const e of allKilled) {
                this._dropGem(e.x, e.y);
                // Bosses always drop a chest. Elites have a small chance.
                if (e.boss) {
                    this._dropChest(e.x, e.y);
                } else if (e.canDropChest && Math.random() < CHEST.eliteDropChance) {
                    this._dropChest(e.x, e.y);
                }
            }
        }
        for (const hit of allHits) {
            this.damageNumbers.push(new DamageNumber(hit.x, hit.y, hit.amount, '#ffffff'));
        }
        if (collisionResult.playerHit) {
            this.camera.shake(SCREEN_SHAKE.intensity, SCREEN_SHAKE.duration);
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
        compactInPlace(this.gems);
        compactInPlace(this.damageNumbers);
        compactInPlace(this.chests);

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

        ctx.save();
        this.camera.apply(ctx);
        this._drawGrid(ctx);
        this._drawWorldBounds(ctx, this.showDebug);

        for (const g of this.gems) g.draw(ctx);
        for (const c of this.chests) c.draw(ctx);
        for (const e of this.enemies) {
            e.draw(ctx);
            e.drawHpBar(ctx);
        }
        this.player.draw(ctx);
        this.player.drawHpBar(ctx);
        this.weaponSystem.drawWeaponVisuals(ctx, this.player);
        for (const p of this.projectiles) p.draw(ctx);
        this.weaponSystem.drawEffects(ctx);
        for (const d of this.damageNumbers) d.draw(ctx);

        if (this.collisionSystem.contactFlash > 0) {
            this._drawContactFlash(ctx);
        }

        if (this.showDebug) {
            this.player.drawDebug(ctx);
            for (const g of this.gems) g.drawDebug(ctx);
            for (const c of this.chests) c.drawDebug(ctx);
            for (const e of this.enemies) e.drawDebug(ctx);
            for (const p of this.projectiles) p.drawDebug(ctx);
        }
        ctx.restore();

        this.ui.draw(ctx, {
            time: this.time,
            player: this.player,
            camera: this.camera,
            showDebug: this.showDebug,
            kills: this.kills,
            enemyCount: this.enemies.length,
            projectileCount: this.projectiles.length,
            gemCount: this.gems.length,
            effectCount: this.weaponSystem.effects.length,
            ownedWeapons: this.weaponSystem.snapshotForUI(),
            ownedPassives: this.passiveSystem.snapshotForUI(),
            coins: this.player.coins ?? 0,
            chestLuck: this.player.chestLuck ?? 0,
            waveState: this.waveState,
            waveAnnouncement: this.waveDirector.announcement,
            activeBoss: this.activeBossRef ? {
                name: this.activeBossRef.name,
                hp: this.activeBossRef.hp,
                maxHp: this.activeBossRef.maxHp,
            } : null,
            chestCount: this.chests.length,
            chestReward: this.chestReward,
            pendingChests: this.pendingChests,
            nextBossTime: this.bossDirector.getNextSpawnTime(),
            // Cheap to compute; only meaningful inside the debug HUD where
            // it's read. Tells the player whether their next chest will
            // evolve something.
            eligibleEvolutionCount: findEligibleEvolutions(this).length,
            spawnTimer: this.spawner.timer,
            spawnInterval: this.spawner.nextInterval,
            inContact: this.collisionSystem.inContact,
            upgradeChoices: this.upgradeChoices,
            upgradeCounts: this.upgradeSystem.appliedCounts,
            pendingLevelUps: this.pendingLevelUps,
            gameOver: this.gameOver,
        });

        if (this.input.touch) this.input.touch.draw(ctx);
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
