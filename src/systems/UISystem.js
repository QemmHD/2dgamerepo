import { INTERNAL_WIDTH, INTERNAL_HEIGHT, GAME_TITLE } from '../config.js';

const DEBUG_BUTTON_SIZE = 96;
const DEBUG_BUTTON_MARGIN = 20;

export class UISystem {
    constructor({ renderer, loop }) {
        this.renderer = renderer;
        this.loop = loop;
    }

    getDebugButtonRect() {
        const sa = this.renderer.safeArea;
        return {
            x: INTERNAL_WIDTH - sa.right - DEBUG_BUTTON_SIZE - DEBUG_BUTTON_MARGIN,
            y: sa.top + DEBUG_BUTTON_MARGIN,
            w: DEBUG_BUTTON_SIZE,
            h: DEBUG_BUTTON_SIZE,
        };
    }

    draw(ctx, gameState) {
        this._drawTitle(ctx);
        this._drawHUD(ctx, gameState);
        this._drawDebugToggleHint(ctx, gameState);
    }

    _drawTitle(ctx) {
        const sa = this.renderer.safeArea;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = '34px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(GAME_TITLE, INTERNAL_WIDTH / 2, 28 + sa.top);
        ctx.restore();
    }

    _drawHUD(ctx, state) {
        const sa = this.renderer.safeArea;
        const btn = this.getDebugButtonRect();
        const padR = INTERNAL_WIDTH - btn.x + 8;
        const padY = btn.y + btn.h + 18;

        const gameplayLines = [
            `TIME    ${formatTime(state.time)}`,
            `KILLS   ${state.kills}`,
            `ENEMIES ${state.enemyCount}`,
            `BOLTS   ${state.projectileCount}`,
        ];

        const debugLines = state.showDebug ? [
            ``,
            `FPS     ${this.loop?.fps ? this.loop.fps.toFixed(0) : '--'}`,
            `spawn   ${formatSpawn(state.spawnTimer, state.spawnInterval)}`,
            `player  (${Math.round(state.player.x)}, ${Math.round(state.player.y)})`,
            `camera  (${Math.round(state.camera.x)}, ${Math.round(state.camera.y)})`,
            `dpr     ${this.renderer.dpr.toFixed(2)}`,
            `safe    T${Math.round(sa.top)} R${Math.round(sa.right)} B${Math.round(sa.bottom)} L${Math.round(sa.left)}`,
            `contact ${state.inContact ? 'YES' : 'no'}`,
        ] : [];

        const lines = [...gameplayLines, ...debugLines];

        ctx.save();
        ctx.font = '28px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'right';

        const lineH = 34;
        const boxW = 500;
        const boxH = lineH * lines.length + 20;
        const boxRight = INTERNAL_WIDTH - padR + 12;
        const boxLeft = boxRight - boxW;
        const boxTop = padY - 8;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(boxLeft, boxTop, boxW, boxH);

        ctx.fillStyle = '#fff';
        const textRight = INTERNAL_WIDTH - padR;
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], textRight, padY + i * lineH);
        }
        ctx.restore();
    }

    _drawDebugToggleHint(ctx, { showDebug }) {
        const sa = this.renderer.safeArea;
        const { x: btnX, y: btnY, w: btnW, h: btnH } = this.getDebugButtonRect();

        ctx.save();
        ctx.fillStyle = showDebug ? 'rgba(80,160,255,0.65)' : 'rgba(255,255,255,0.18)';
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(btnX, btnY, btnW, btnH, 14);
        } else {
            ctx.rect(btnX, btnY, btnW, btnH);
        }
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.font = '32px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('DBG', btnX + btnW / 2, btnY + btnH / 2);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '22px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText(
            'WASD / Arrows  •  Touch left half to move  •  Tap DBG (or press `) to toggle debug',
            INTERNAL_WIDTH / 2,
            INTERNAL_HEIGHT - 24 - sa.bottom
        );
        ctx.restore();
    }
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatSpawn(timer, interval) {
    if (interval == null) return `${timer.toFixed(2)}s`;
    return `${timer.toFixed(2)}s / ${interval.toFixed(2)}s`;
}
