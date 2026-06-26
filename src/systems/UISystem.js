import { INTERNAL_WIDTH, INTERNAL_HEIGHT, GAME_TITLE } from '../config.js';

export class UISystem {
    constructor({ renderer, loop }) {
        this.renderer = renderer;
        this.loop = loop;
    }

    draw(ctx, gameState) {
        this._drawTitle(ctx);
        if (gameState.showDebug) {
            this._drawDebugHUD(ctx, gameState);
        }
        this._drawDebugToggleHint(ctx, gameState);
    }

    _drawTitle(ctx) {
        const sa = this.renderer.safeArea;
        const y = 28 + sa.top;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = '34px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(GAME_TITLE, INTERNAL_WIDTH / 2, y);
        ctx.restore();
    }

    _drawDebugHUD(ctx, { time, player, camera }) {
        const sa = this.renderer.safeArea;
        const W = INTERNAL_WIDTH;
        const padR = 40 + sa.right;
        const padY = 100 + sa.top;

        ctx.save();
        ctx.font = '28px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'right';

        const lines = [
            `FPS  ${this.loop?.fps ? this.loop.fps.toFixed(0) : '--'}`,
            `time ${time.toFixed(1)}s`,
            `player (${Math.round(player.x)}, ${Math.round(player.y)})`,
            `camera (${Math.round(camera.x)}, ${Math.round(camera.y)})`,
            `dpr  ${this.renderer.dpr.toFixed(2)}`,
            `safe T${Math.round(sa.top)} R${Math.round(sa.right)} B${Math.round(sa.bottom)} L${Math.round(sa.left)}`,
            `Stage 0-3 prototype`,
        ];

        const lineH = 34;
        const boxW = 500;
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
        ctx.restore();
    }

    _drawDebugToggleHint(ctx, { showDebug }) {
        const sa = this.renderer.safeArea;

        const btnSize = 56;
        const btnX = INTERNAL_WIDTH - sa.right - btnSize - 20;
        const btnY = sa.top + 20;

        ctx.save();
        ctx.fillStyle = showDebug ? 'rgba(80,160,255,0.65)' : 'rgba(255,255,255,0.18)';
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect
            ? ctx.roundRect(btnX, btnY, btnSize, btnSize, 10)
            : ctx.rect(btnX, btnY, btnSize, btnSize);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.font = '20px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('DBG', btnX + btnSize / 2, btnY + btnSize / 2);

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
