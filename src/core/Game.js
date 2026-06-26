import {
    INTERNAL_WIDTH,
    INTERNAL_HEIGHT,
    GRID_COLOR,
    GRID_SIZE,
    DEBUG_DEFAULT_ON,
} from '../config.js';
import { Camera } from './Camera.js';
import { Player } from '../entities/Player.js';

export class Game {
    constructor({ renderer, input, loop }) {
        this.renderer = renderer;
        this.input = input;
        this.loop = loop;
        this.camera = new Camera();
        this.player = new Player();
        this.camera.follow(this.player);

        this.time = 0;

        const touchPrimary = typeof window.matchMedia === 'function'
            ? window.matchMedia('(pointer: coarse)').matches
            : ('ontouchstart' in window || navigator.maxTouchPoints > 0);
        this.showDebug = DEBUG_DEFAULT_ON && !touchPrimary;

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Backquote' || e.code === 'F2') {
                this.showDebug = !this.showDebug;
            }
        });

        this.renderer.canvas.addEventListener('touchstart', (e) => {
            for (const t of e.changedTouches) {
                const pos = this.renderer.clientToInternal(t.clientX, t.clientY);
                if (pos.x > INTERNAL_WIDTH - 220 && pos.y < 220) {
                    this.showDebug = !this.showDebug;
                    return;
                }
            }
        }, { passive: false });
    }

    update(dt) {
        this.time += dt;
        this.player.update(dt, this.input);
        this.camera.update(dt);
    }

    render() {
        const r = this.renderer;
        if (!r.beginFrame()) return;
        const ctx = r.ctx;

        ctx.save();
        this.camera.apply(ctx);
        this._drawGrid(ctx);
        this.player.draw(ctx);
        if (this.showDebug) this.player.drawDebug(ctx);
        ctx.restore();

        if (this.showDebug) this._drawDebugHUD(ctx);

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

    _drawDebugHUD(ctx) {
        const sa = this.renderer.safeArea;
        const W = INTERNAL_WIDTH;
        const padR = 40 + sa.right;
        const padY = 40 + sa.top;

        ctx.save();
        ctx.font = '28px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'right';

        const lines = [
            `FPS  ${this.loop?.fps ? this.loop.fps.toFixed(0) : '--'}`,
            `time ${this.time.toFixed(1)}s`,
            `pos  (${Math.round(this.player.x)}, ${Math.round(this.player.y)})`,
            `dpr  ${this.renderer.dpr.toFixed(2)}`,
            `safe T${Math.round(sa.top)} R${Math.round(sa.right)} B${Math.round(sa.bottom)} L${Math.round(sa.left)}`,
            `Stage 0-3 prototype`,
        ];

        const lineH = 34;
        const boxW = 460;
        const boxH = lineH * lines.length + 20;
        const boxRight = W - padR + 12;
        const boxLeft = boxRight - boxW;
        const boxTop = padY - 8;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(boxLeft, boxTop, boxW, boxH);

        ctx.fillStyle = '#fff';
        const textRight = W - padR;
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], textRight, padY + i * lineH);
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '24px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText(
            'WASD / Arrows  •  Touch left half to move  •  ` or tap top-right toggles debug',
            INTERNAL_WIDTH / 2,
            INTERNAL_HEIGHT - 30 - sa.bottom
        );
        ctx.restore();
    }
}
