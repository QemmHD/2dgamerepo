import { INTERNAL_WIDTH, INTERNAL_HEIGHT, GAME_TITLE } from '../config/GameConfig.js';
import { roundRectPath } from '../render/DrawUtils.js';

const DEBUG_BUTTON_SIZE = 96;
const DEBUG_BUTTON_MARGIN = 20;

const CARD_W = 440;
const CARD_H = 540;
const CARD_GAP = 40;

const RESTART_BTN_W = 360;
const RESTART_BTN_H = 96;

const RARITY_COLORS = {
    common:   { border: '#7ea3c4', accent: '#dfe9f5' },
    uncommon: { border: '#5fe87a', accent: '#bff7c8' },
    rare:     { border: '#5fc7ff', accent: '#bfeaff' },
    epic:     { border: '#c97bff', accent: '#e8c8ff' },
};

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

    getLevelUpCardRects(count) {
        const sa = this.renderer.safeArea;
        const availableW = INTERNAL_WIDTH - sa.left - sa.right;
        const totalW = count * CARD_W + Math.max(0, count - 1) * CARD_GAP;
        const startX = sa.left + (availableW - totalW) / 2;
        const y = (INTERNAL_HEIGHT - CARD_H) / 2 + 60;
        const rects = [];
        for (let i = 0; i < count; i++) {
            rects.push({
                x: startX + i * (CARD_W + CARD_GAP),
                y,
                w: CARD_W,
                h: CARD_H,
            });
        }
        return rects;
    }

    getRestartButtonRect() {
        return {
            x: (INTERNAL_WIDTH - RESTART_BTN_W) / 2,
            y: INTERNAL_HEIGHT / 2 + 200,
            w: RESTART_BTN_W,
            h: RESTART_BTN_H,
        };
    }

    draw(ctx, gameState) {
        this._drawTitle(ctx);
        this._drawWaveLabel(ctx, gameState);
        this._drawHpBar(ctx, gameState);
        this._drawXPBar(ctx, gameState);
        this._drawHUD(ctx, gameState);
        this._drawDebugToggleHint(ctx, gameState);
        // Announcement renders before overlays so the level-up / game-over
        // overlays still cover it cleanly when both are visible.
        if (!gameState.gameOver && !gameState.upgradeChoices) {
            this._drawWaveAnnouncement(ctx, gameState.waveAnnouncement);
        }
        if (gameState.gameOver) {
            this._drawGameOverOverlay(ctx, gameState);
        } else if (gameState.upgradeChoices) {
            this._drawLevelUpOverlay(ctx, gameState);
        }
    }

    _drawWaveLabel(ctx, state) {
        const ws = state.waveState;
        if (!ws) return;
        const sa = this.renderer.safeArea;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(255, 209, 102, 0.88)';
        ctx.font = 'bold 24px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText(
            `WAVE ${ws.index + 1}  •  ${ws.name}`,
            INTERNAL_WIDTH / 2,
            76 + sa.top
        );
        ctx.restore();
    }

    _drawWaveAnnouncement(ctx, ann) {
        if (!ann) return;
        const t = ann.age / ann.lifetime;
        const fadeIn = 0.3 / ann.lifetime;
        const fadeOut = 0.7 / ann.lifetime;
        let alpha = 1;
        if (t < fadeIn) alpha = t / fadeIn;
        else if (t > 1 - fadeOut) alpha = (1 - t) / fadeOut;
        alpha = Math.max(0, Math.min(1, alpha));
        if (alpha <= 0) return;

        const centerY = INTERNAL_HEIGHT * 0.32;
        const panelW = 820;
        const panelH = 120;
        const panelX = (INTERNAL_WIDTH - panelW) / 2;
        const panelY = centerY - panelH / 2;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgba(20, 18, 8, 0.78)';
        roundRectPath(ctx, panelX, panelY, panelW, panelH, 18);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 209, 102, 0.55)';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = '#ffd166';
        ctx.font = 'bold 48px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ann.text, INTERNAL_WIDTH / 2, centerY);
        ctx.restore();
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

    _bottomBarLayout() {
        const sa = this.renderer.safeArea;
        return {
            padL: sa.left + 40,
            padR: sa.right + 40,
            labelW: 160,
            readoutW: 200,
            barH: 24,
        };
    }

    _drawHpBar(ctx, state) {
        const layout = this._bottomBarLayout();
        const sa = this.renderer.safeArea;
        const padB = sa.bottom + 122;
        const barLeft = layout.padL + layout.labelW;
        const barRight = INTERNAL_WIDTH - layout.padR - layout.readoutW;
        const barW = Math.max(60, barRight - barLeft);
        const barY = INTERNAL_HEIGHT - padB;

        ctx.save();
        ctx.font = 'bold 30px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText('HP', layout.padL, barY + layout.barH / 2);

        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(barLeft, barY, barW, layout.barH);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 2;
        ctx.strokeRect(barLeft, barY, barW, layout.barH);

        const pct = state.player.maxHp > 0
            ? Math.max(0, state.player.hp / state.player.maxHp)
            : 0;
        const color = pct < 0.3 ? '#ff4757' : pct < 0.6 ? '#ffa53b' : '#5fe87a';
        ctx.fillStyle = color;
        ctx.fillRect(barLeft + 2, barY + 2, Math.max(0, (barW - 4) * pct), layout.barH - 4);

        ctx.fillStyle = '#fff';
        ctx.font = '22px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(
            `${Math.ceil(state.player.hp)} / ${state.player.maxHp}`,
            barRight + 16,
            barY + layout.barH / 2
        );
        ctx.restore();
    }

    _drawXPBar(ctx, state) {
        const layout = this._bottomBarLayout();
        const sa = this.renderer.safeArea;
        const padB = sa.bottom + 72;
        const barLeft = layout.padL + layout.labelW;
        const barRight = INTERNAL_WIDTH - layout.padR - layout.readoutW;
        const barW = Math.max(60, barRight - barLeft);
        const barY = INTERNAL_HEIGHT - padB;

        ctx.save();
        ctx.font = 'bold 30px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(`LV ${state.player.level}`, layout.padL, barY + layout.barH / 2);

        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(barLeft, barY, barW, layout.barH);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 2;
        ctx.strokeRect(barLeft, barY, barW, layout.barH);

        const pct = state.player.xpToNext > 0
            ? Math.min(1, state.player.xp / state.player.xpToNext)
            : 0;
        const grad = ctx.createLinearGradient(barLeft, 0, barLeft + barW, 0);
        grad.addColorStop(0, '#3aa8ff');
        grad.addColorStop(1, '#7fdcff');
        ctx.fillStyle = grad;
        ctx.fillRect(barLeft + 2, barY + 2, Math.max(0, (barW - 4) * pct), layout.barH - 4);

        ctx.fillStyle = '#fff';
        ctx.font = '22px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(
            `${Math.floor(state.player.xp)} / ${state.player.xpToNext}`,
            barRight + 16,
            barY + layout.barH / 2
        );
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
            `GEMS    ${state.gemCount}`,
        ];

        const weaponLines = (state.ownedWeapons ?? []).map((w) => {
            const level = w.isMax ? 'Lv 8 MAX' : `Lv ${w.level}`;
            return `${w.name.padEnd(16)}${level}`;
        });
        const passiveLines = (state.ownedPassives ?? []).map((p) => {
            const level = p.isMax ? `Lv ${p.maxLevel} MAX` : `Lv ${p.level}`;
            return `${p.name.padEnd(16)}${level}`;
        });

        const ws = state.waveState;
        const debugLines = state.showDebug ? [
            ``,
            `FPS     ${this.loop?.fps ? this.loop.fps.toFixed(0) : '--'}`,
            `hp      ${Math.ceil(state.player.hp)}/${state.player.maxHp}` +
                (state.player.invincibleTimer > 0
                    ? `  iframes ${state.player.invincibleTimer.toFixed(2)}s`
                    : ''),
            `lvl/xp  ${state.player.level}  ${Math.floor(state.player.xp)}/${state.player.xpToNext}`,
            `pickup  ${Math.round(state.player.pickupRange)}`,
            ``,
            `WAVE    ${ws ? ws.index + 1 : '?'} ${ws ? ws.name : ''}`,
            `weights ${ws ? formatWeights(ws.typeWeights) : ''}`,
            `int×    ${ws ? ws.spawnIntervalMul.toFixed(2) : '?'}`,
            `cap     ${ws ? ws.maxAlive : '?'}`,
            `hp×spd× ${ws ? ws.healthMul.toFixed(2) : '?'} / ${ws ? ws.speedMul.toFixed(2) : '?'}`,
            `elite%  ${ws ? (ws.eliteChance * 100).toFixed(1) : '?'}%`,
            ``,
            `spawn   ${formatSpawn(state.spawnTimer, state.spawnInterval)}`,
            `player  (${Math.round(state.player.x)}, ${Math.round(state.player.y)})`,
            `camera  (${Math.round(state.camera.x)}, ${Math.round(state.camera.y)})`,
            `dpr     ${this.renderer.dpr.toFixed(2)}`,
            `safe    T${Math.round(sa.top)} R${Math.round(sa.right)} B${Math.round(sa.bottom)} L${Math.round(sa.left)}`,
            `contact ${state.inContact ? 'YES' : 'no'}`,
        ] : [];

        const lines = [...gameplayLines];
        if (weaponLines.length > 0) lines.push(``, 'WEAPONS', ...weaponLines);
        if (passiveLines.length > 0) lines.push(``, 'PASSIVES', ...passiveLines);
        if (debugLines.length > 0) lines.push(...debugLines);

        ctx.save();
        ctx.font = '28px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'right';

        const lineH = 34;
        const boxW = 520;
        const boxH = lineH * lines.length + 20;
        const boxRight = INTERNAL_WIDTH - padR + 12;
        const boxLeft = boxRight - boxW;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(boxLeft, padY - 8, boxW, boxH);

        ctx.fillStyle = '#fff';
        const textRight = INTERNAL_WIDTH - padR;
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], textRight, padY + i * lineH);
        }
        ctx.restore();
    }

    _drawDebugToggleHint(ctx, state) {
        const sa = this.renderer.safeArea;
        const { x: btnX, y: btnY, w: btnW, h: btnH } = this.getDebugButtonRect();

        ctx.save();
        ctx.fillStyle = state.showDebug ? 'rgba(80,160,255,0.65)' : 'rgba(255,255,255,0.18)';
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2;
        roundRectPath(ctx, btnX, btnY, btnW, btnH, 14);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.font = '32px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('DBG', btnX + btnW / 2, btnY + btnH / 2);

        if (!state.upgradeChoices && !state.gameOver) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.font = '22px -apple-system, system-ui, Helvetica, Arial, sans-serif';
            ctx.fillText(
                'WASD / Arrows  •  Touch left half to move  •  Tap DBG (or press `) to toggle debug',
                INTERNAL_WIDTH / 2,
                INTERNAL_HEIGHT - 24 - sa.bottom
            );
        }
        ctx.restore();
    }

    _drawLevelUpOverlay(ctx, state) {
        const choices = state.upgradeChoices;
        if (!choices) return;

        ctx.save();

        ctx.fillStyle = 'rgba(8, 12, 20, 0.78)';
        ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 96px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillStyle = '#ffd166';
        ctx.fillText('LEVEL UP', INTERNAL_WIDTH / 2, 210);

        ctx.font = '34px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.78)';
        const sub = `Choose an upgrade  •  LV ${state.player.level}`
            + (state.pendingLevelUps > 0 ? `  (${state.pendingLevelUps + 1} pending)` : '');
        ctx.fillText(sub, INTERNAL_WIDTH / 2, 290);

        const rects = this.getLevelUpCardRects(choices.length);
        const counts = state.upgradeCounts ?? {};
        for (let i = 0; i < rects.length; i++) {
            this._drawUpgradeCard(ctx, rects[i], choices[i], i, counts);
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = '24px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText(
            'Tap a card  •  or press 1 / 2 / 3',
            INTERNAL_WIDTH / 2,
            INTERNAL_HEIGHT - 60 - this.renderer.safeArea.bottom
        );

        ctx.restore();
    }

    _drawUpgradeCard(ctx, r, upgrade, index, counts) {
        const colors = RARITY_COLORS[upgrade.rarity] ?? RARITY_COLORS.common;
        const stack = (counts && counts[upgrade.id]) ?? 0;
        const label = upgrade.cardLabel ?? (upgrade.rarity ?? 'common').toUpperCase();
        const levelText = upgrade.cardLevelText ?? `Lv ${stack + 1}`;
        const isWeaponish = upgrade.kind === 'weapon-new' || upgrade.kind === 'weapon-upgrade';

        ctx.save();
        ctx.fillStyle = 'rgba(20, 26, 38, 0.95)';
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 4;
        roundRectPath(ctx, r.x, r.y, r.w, r.h, 24);
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.fillStyle = colors.accent;
        ctx.font = 'bold 26px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(label, r.x + r.w / 2, r.y + 28);

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 44px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText(upgrade.name, r.x + r.w / 2, r.y + 90);

        // Level badge: gold when this is a stacked weapon upgrade or stacked
        // stat; white-translucent on a first pick / brand-new weapon card.
        const badgeIsHighlighted = stack > 0 || isWeaponish;
        ctx.fillStyle = badgeIsHighlighted ? '#ffd166' : 'rgba(255,255,255,0.55)';
        ctx.font = 'bold 26px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText(levelText, r.x + r.w / 2, r.y + 150);

        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = '30px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        wrapText(ctx, upgrade.description, r.x + r.w / 2, r.y + 220, r.w - 60, 38);

        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = 'bold 80px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${index + 1}`, r.x + r.w / 2, r.y + r.h - 60);

        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '22px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText('TAP TO CHOOSE', r.x + r.w / 2, r.y + r.h - 24);

        ctx.restore();
    }

    _drawGameOverOverlay(ctx, state) {
        ctx.save();
        ctx.fillStyle = 'rgba(20, 4, 4, 0.86)';
        ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.fillStyle = '#ff4757';
        ctx.font = 'bold 144px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText('GAME OVER', INTERNAL_WIDTH / 2, 280);

        ctx.fillStyle = '#fff';
        ctx.font = '40px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        const lines = [
            `Survived   ${formatTime(state.time)}`,
            `Enemies killed   ${state.kills}`,
            `Final level   ${state.player.level}`,
            `Final XP   ${Math.floor(state.player.xp)} / ${state.player.xpToNext}`,
        ];
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], INTERNAL_WIDTH / 2, 420 + i * 56);
        }

        const btn = this.getRestartButtonRect();
        ctx.fillStyle = 'rgba(95, 232, 122, 0.18)';
        ctx.strokeStyle = '#5fe87a';
        ctx.lineWidth = 4;
        roundRectPath(ctx, btn.x, btn.y, btn.w, btn.h, 22);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 46px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText('RESTART', btn.x + btn.w / 2, btn.y + btn.h / 2);

        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '26px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText(
            'Tap RESTART  •  or press R',
            INTERNAL_WIDTH / 2,
            btn.y + btn.h + 48
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

function formatWeights(weights) {
    if (!weights) return '';
    return Object.entries(weights)
        .filter(([, w]) => w > 0)
        .map(([id, w]) => `${id[0]}${w}`)
        .join(' ');
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = String(text).split(/\s+/);
    let line = '';
    let yy = y;
    for (let i = 0; i < words.length; i++) {
        const testLine = line ? line + ' ' + words[i] : words[i];
        if (ctx.measureText(testLine).width > maxWidth && line) {
            ctx.fillText(line, x, yy);
            yy += lineHeight;
            line = words[i];
        } else {
            line = testLine;
        }
    }
    if (line) ctx.fillText(line, x, yy);
}
