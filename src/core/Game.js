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
} from '../config.js';
import { TWO_PI } from './MathUtils.js';
import { Camera } from './Camera.js';
import { Player } from '../entities/Player.js';
import { Spawner } from '../systems/Spawner.js';
import { WeaponSystem } from '../systems/WeaponSystem.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { UISystem } from '../systems/UISystem.js';

const DEBUG_BUTTON_TOUCH_SLOP = 24;

export class Game {
    constructor({ renderer, input, loop }) {
        this.renderer = renderer;
        this.input = input;
        this.loop = loop;
        this.camera = new Camera();
        this.player = new Player();
        this.camera.follow(this.player);
        this.ui = new UISystem({ renderer, loop });

        this.enemies = [];
        this.projectiles = [];
        this.spawner = new Spawner();
        this.weaponSystem = new WeaponSystem();
        this.collisionSystem = new CollisionSystem();

        this.time = 0;
        this.kills = 0;

        const touchPrimary = typeof window.matchMedia === 'function'
            ? window.matchMedia('(pointer: coarse)').matches
            : ('ontouchstart' in window || navigator.maxTouchPoints > 0);
        this.showDebug = DEBUG_DEFAULT_ON && !touchPrimary;

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Backquote' || e.code === 'F2') {
                this.showDebug = !this.showDebug;
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

        this.renderer.canvas.addEventListener('touchstart', (e) => {
            for (const t of e.changedTouches) {
                if (tryToggleDebugAt(t.clientX, t.clientY)) return;
            }
        }, { passive: false });

        this.renderer.canvas.addEventListener('mousedown', (e) => {
            tryToggleDebugAt(e.clientX, e.clientY);
        });
    }

    update(dt) {
        this.time += dt;

        this.player.update(dt, this.input);
        this.spawner.update(dt, this.player, this.enemies);
        this.weaponSystem.update(dt, this.player, this.enemies, this.projectiles);

        for (const e of this.enemies) {
            if (e.active) e.update(dt, this.player);
        }
        for (const p of this.projectiles) {
            if (p.active) p.update(dt);
        }

        this.kills += this.collisionSystem.resolve(dt, this.player, this.enemies, this.projectiles);

        this._cull(this.enemies);
        this._cull(this.projectiles);

        this.camera.update(dt);
    }

    _cull(list) {
        let write = 0;
        for (let read = 0; read < list.length; read++) {
            if (list[read].active) {
                if (write !== read) list[write] = list[read];
                write += 1;
            }
        }
        list.length = write;
    }

    render() {
        const r = this.renderer;
        if (!r.beginFrame()) return;
        const ctx = r.ctx;

        ctx.save();
        this.camera.apply(ctx);
        this._drawGrid(ctx);
        this._drawWorldBounds(ctx, this.showDebug);

        for (const e of this.enemies) e.draw(ctx);
        this.player.draw(ctx);
        for (const p of this.projectiles) p.draw(ctx);

        if (this.collisionSystem.contactFlash > 0) {
            this._drawContactFlash(ctx);
        }

        if (this.showDebug) {
            this.player.drawDebug(ctx);
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
            spawnTimer: this.spawner.timer,
            spawnInterval: this.spawner.nextInterval,
            inContact: this.collisionSystem.inContact,
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
