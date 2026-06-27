import {
    INTERNAL_WIDTH,
    INTERNAL_HEIGHT,
    GAME_TITLE,
    CHEST,
} from '../config/GameConfig.js';
import { TWO_PI } from '../core/MathUtils.js';
import { roundRectPath } from '../render/DrawUtils.js';
import { getChestSprite, getCoinSprite } from '../assets/ProceduralSprites.js';

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
        // Two-button row at the bottom of the game-over summary; restart
        // sits on the left, return-to-shop on the right.
        return {
            x: INTERNAL_WIDTH / 2 - RESTART_BTN_W - 24,
            y: INTERNAL_HEIGHT - 180 - this.renderer.safeArea.bottom,
            w: RESTART_BTN_W,
            h: RESTART_BTN_H,
        };
    }

    getReturnToShopButtonRect() {
        return {
            x: INTERNAL_WIDTH / 2 + 24,
            y: INTERNAL_HEIGHT - 180 - this.renderer.safeArea.bottom,
            w: RESTART_BTN_W,
            h: RESTART_BTN_H,
        };
    }

    getStartRunButtonRect() {
        return {
            x: INTERNAL_WIDTH / 2 - 240,
            y: INTERNAL_HEIGHT - 220 - this.renderer.safeArea.bottom,
            w: 480,
            h: 96,
        };
    }

    getResetSaveButtonRect() {
        return {
            x: INTERNAL_WIDTH / 2 - 180,
            y: INTERNAL_HEIGHT - 110 - this.renderer.safeArea.bottom,
            w: 360,
            h: 60,
        };
    }

    getShopUpgradeRects(count) {
        const sa = this.renderer.safeArea;
        const cols = 2;
        const cardW = 720;
        const cardH = 120;
        const gapX = 40;
        const gapY = 18;
        const startX = (INTERNAL_WIDTH - (cols * cardW + (cols - 1) * gapX)) / 2;
        const startY = 250 + sa.top;
        const rects = [];
        for (let i = 0; i < count; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            rects.push({
                x: startX + col * (cardW + gapX),
                y: startY + row * (cardH + gapY),
                w: cardW,
                h: cardH,
            });
        }
        return rects;
    }

    draw(ctx, gameState) {
        // Start / shop screen replaces the regular HUD entirely.
        if (gameState.screen === 'start') {
            this._drawStartScreen(ctx, gameState);
            return;
        }

        this._drawTitle(ctx);
        this._drawWaveLabel(ctx, gameState);
        this._drawBossHpBar(ctx, gameState);
        this._drawHpBar(ctx, gameState);
        this._drawXPBar(ctx, gameState);
        this._drawHUD(ctx, gameState);
        this._drawDebugToggleHint(ctx, gameState);
        if (!gameState.gameOver && !gameState.upgradeChoices && !gameState.chestReward) {
            this._drawWaveAnnouncement(ctx, gameState.waveAnnouncement);
        }
        // Overlay priority: game-over > chest > level-up.
        if (gameState.gameOver) {
            this._drawGameOverOverlay(ctx, gameState);
        } else if (gameState.chestReward) {
            this._drawChestOverlay(ctx, gameState);
        } else if (gameState.upgradeChoices) {
            this._drawLevelUpOverlay(ctx, gameState);
        }
    }

    _drawBossHpBar(ctx, state) {
        const boss = state.activeBoss;
        if (!boss) return;
        const sa = this.renderer.safeArea;
        const padTop = sa.top + 116;
        const barW = INTERNAL_WIDTH * 0.55;
        const barH = 28;
        const barX = (INTERNAL_WIDTH - barW) / 2;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#ff6b6b';
        ctx.font = 'bold 26px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText(boss.name.toUpperCase(), INTERNAL_WIDTH / 2, padTop - 4);

        ctx.fillStyle = 'rgba(30, 4, 4, 0.78)';
        ctx.fillRect(barX, padTop, barW, barH);
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 2;
        ctx.strokeRect(barX, padTop, barW, barH);

        const pct = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
        const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
        grad.addColorStop(0, '#ff4757');
        grad.addColorStop(1, '#ff8c40');
        ctx.fillStyle = grad;
        ctx.fillRect(barX + 2, padTop + 2, Math.max(0, (barW - 4) * pct), barH - 4);

        ctx.fillStyle = '#fff';
        ctx.font = '20px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
            `${Math.ceil(boss.hp)} / ${Math.ceil(boss.maxHp)}`,
            INTERNAL_WIDTH / 2,
            padTop + barH / 2
        );
        ctx.restore();
    }

    _drawChestOverlay(ctx, state) {
        const c = state.chestReward;
        if (!c) return;
        const isEvolution = c.reward.kind === 'evolution';

        ctx.save();
        ctx.fillStyle = isEvolution ? 'rgba(20, 10, 26, 0.84)' : 'rgba(10, 8, 4, 0.82)';
        ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isEvolution ? '#ffd6f5' : '#ffd166';
        ctx.font = 'bold 80px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText(isEvolution ? 'WEAPON EVOLVED!' : 'TREASURE!', INTERNAL_WIDTH / 2, 220);

        const animDur = isEvolution
            ? CHEST.openAnimationDuration * 1.4
            : CHEST.openAnimationDuration;
        const animT = Math.min(1, c.age / animDur);
        const sprite = getChestSprite();
        const scale = 4;
        const chestX = INTERNAL_WIDTH / 2;
        const chestY = INTERNAL_HEIGHT * 0.5;

        // Light burst peaks around the end of the opening animation; bigger,
        // pink-tinged for evolutions so the moment feels different.
        if (animT >= 0.5) {
            const burstT = Math.min(1, (animT - 0.5) / 0.5);
            const burstAlpha = 1 - burstT;
            const burstR = (isEvolution ? 280 : 200) + burstT * (isEvolution ? 720 : 480);
            const grad = ctx.createRadialGradient(chestX, chestY, 0, chestX, chestY, burstR);
            if (isEvolution) {
                grad.addColorStop(0, `rgba(255, 200, 240, ${burstAlpha * 0.85})`);
                grad.addColorStop(1, 'rgba(200, 130, 255, 0)');
            } else {
                grad.addColorStop(0, `rgba(255, 240, 180, ${burstAlpha * 0.7})`);
                grad.addColorStop(1, 'rgba(255, 200, 50, 0)');
            }
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(chestX, chestY, burstR, 0, TWO_PI);
            ctx.fill();
        }

        // Chest sprite — shakes during the opening animation, then settles.
        // Evolution shake is slightly stronger.
        const shakeBase = isEvolution ? 20 : 14;
        const shakeMag = animT < 1 ? (1 - animT) * shakeBase : 0;
        const shakeX = shakeMag ? (Math.random() - 0.5) * 2 * shakeMag : 0;
        const shakeY = shakeMag ? (Math.random() - 0.5) * 2 * shakeMag : 0;
        ctx.drawImage(
            sprite,
            chestX - (sprite.width * scale) / 2 + shakeX,
            chestY - (sprite.height * scale) / 2 + shakeY,
            sprite.width * scale,
            sprite.height * scale
        );

        // Reward text fades in once the animation is past its midpoint.
        const revealStart = animDur * 0.5;
        if (c.age >= revealStart) {
            const textAlpha = Math.min(1, (c.age - revealStart) / 0.25);
            ctx.save();
            ctx.globalAlpha = textAlpha;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (isEvolution) {
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.font = '34px -apple-system, system-ui, Helvetica, Arial, sans-serif';
                ctx.fillText(
                    `${c.reward.baseName}  +  ${c.reward.catalystName}`,
                    INTERNAL_WIDTH / 2,
                    INTERNAL_HEIGHT * 0.73
                );
                ctx.fillStyle = '#ffd6f5';
                ctx.font = 'bold 56px -apple-system, system-ui, Helvetica, Arial, sans-serif';
                ctx.fillText(
                    c.reward.evolvedName,
                    INTERNAL_WIDTH / 2,
                    INTERNAL_HEIGHT * 0.80
                );
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.font = '28px -apple-system, system-ui, Helvetica, Arial, sans-serif';
                ctx.fillText(
                    c.reward.chestRewardText,
                    INTERNAL_WIDTH / 2,
                    INTERNAL_HEIGHT * 0.86
                );
            } else {
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 48px -apple-system, system-ui, Helvetica, Arial, sans-serif';
                ctx.fillText(c.reward.text, INTERNAL_WIDTH / 2, INTERNAL_HEIGHT * 0.78);
            }
            ctx.restore();
        }

        // Continue prompt pulses gently once the animation finishes so the
        // player can tell input is now expected.
        if (c.age >= animDur) {
            const pulse = 0.55 + 0.35 * ((Math.sin(c.age * 4) + 1) / 2);
            ctx.save();
            ctx.globalAlpha = pulse;
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.font = '28px -apple-system, system-ui, Helvetica, Arial, sans-serif';
            ctx.fillText(
                'Tap or press Space to continue',
                INTERNAL_WIDTH / 2,
                INTERNAL_HEIGHT - 80 - this.renderer.safeArea.bottom
            );
            ctx.restore();
        }
        ctx.restore();
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
            `COINS   ${state.runCoins ?? 0}`,
        ];

        const weaponLines = (state.ownedWeapons ?? []).map((w) => {
            let level;
            if (w.evolved) level = 'EVOLVED';
            else if (w.isMax) level = `Lv ${w.maxLevel ?? 8} MAX`;
            else level = `Lv ${w.level}`;
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
            `BOSS`,
            `next    ${formatBossClock(state.nextBossTime)}`,
            `active  ${state.activeBoss ? state.activeBoss.name : 'none'}`,
            `chests  ${state.chestCount ?? 0}` + (state.pendingChests > 0 ? ` (+${state.pendingChests})` : ''),
            `evos    ${state.eligibleEvolutionCount ?? 0} ready`,
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
        const summary = state.runSummary;
        const sa = this.renderer.safeArea;

        ctx.save();
        ctx.fillStyle = 'rgba(20, 4, 4, 0.88)';
        ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.fillStyle = '#ff4757';
        ctx.font = 'bold 112px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText('GAME OVER', INTERNAL_WIDTH / 2, 120 + sa.top);

        if (!summary) {
            ctx.restore();
            return;
        }

        const stats = [
            ['Survived', formatTime(summary.time)],
            ['Final Wave', `${summary.finalWave}` + (summary.finalWaveName ? `  •  ${summary.finalWaveName}` : '')],
            ['Level', `Lv ${summary.level}`],
            ['Kills', summary.kills],
            ['Bosses', summary.bossesDefeated],
            ['Coins earned', summary.coinsEarned],
        ];
        const statsStartY = 240 + sa.top;
        const lineH = 44;
        const colWidth = 480;
        const colLeftX = INTERNAL_WIDTH / 2 - colWidth - 40;
        ctx.font = '28px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        for (let i = 0; i < stats.length; i++) {
            const col = i % 2;
            const row = Math.floor(i / 2);
            const x = col === 0 ? colLeftX : INTERNAL_WIDTH / 2 + 40;
            const y = statsStartY + row * lineH;
            ctx.textAlign = 'left';
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.fillText(stats[i][0], x, y);
            ctx.textAlign = 'right';
            ctx.fillStyle = '#fff';
            ctx.fillText(String(stats[i][1]), x + colWidth, y);
        }

        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd166';
        ctx.font = 'bold 34px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText(
            `Total Coins:  ${summary.totalCoins}`,
            INTERNAL_WIDTH / 2,
            statsStartY + Math.ceil(stats.length / 2) * lineH + 20
        );

        const listY = statsStartY + Math.ceil(stats.length / 2) * lineH + 80;
        ctx.font = 'bold 24px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText('WEAPONS', INTERNAL_WIDTH / 2 - 460, listY);
        ctx.fillText('PASSIVES', INTERNAL_WIDTH / 2 + 60, listY);

        ctx.font = '22px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        const rowH = 28;
        for (let i = 0; i < summary.weapons.length; i++) {
            const w = summary.weapons[i];
            const tag = w.evolved
                ? 'EVOLVED'
                : (w.isMax ? `Lv ${w.maxLevel} MAX` : `Lv ${w.level}`);
            ctx.fillStyle = w.evolved ? '#ffd6f5' : '#fff';
            ctx.fillText(`${w.name}  •  ${tag}`, INTERNAL_WIDTH / 2 - 460, listY + 30 + i * rowH);
        }
        for (let i = 0; i < summary.passives.length; i++) {
            const p = summary.passives[i];
            const tag = p.isMax ? `Lv ${p.maxLevel} MAX` : `Lv ${p.level}`;
            ctx.fillStyle = '#fff';
            ctx.fillText(`${p.name}  •  ${tag}`, INTERNAL_WIDTH / 2 + 60, listY + 30 + i * rowH);
        }

        const restartBtn = this.getRestartButtonRect();
        const shopBtn = this.getReturnToShopButtonRect();
        this._drawSummaryButton(ctx, restartBtn, 'RESTART', '#5fe87a', 'rgba(95, 232, 122, 0.18)');
        this._drawSummaryButton(ctx, shopBtn, 'RETURN TO SHOP', '#5fc7ff', 'rgba(95, 199, 255, 0.16)');

        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = '22px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
            'R / Enter restart   •   B / Esc shop',
            INTERNAL_WIDTH / 2,
            restartBtn.y + restartBtn.h + 36
        );

        ctx.restore();
    }

    _drawSummaryButton(ctx, btn, label, borderColor, fillColor) {
        ctx.fillStyle = fillColor;
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 4;
        roundRectPath(ctx, btn.x, btn.y, btn.w, btn.h, 22);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 36px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2);
    }

    _drawStartScreen(ctx, state) {
        const sa = this.renderer.safeArea;

        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#ffd166';
        ctx.font = 'bold 84px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText('MONKEY SURVIVOR', INTERNAL_WIDTH / 2, 60 + sa.top);

        const coinSprite = getCoinSprite();
        const totalLabel = `${state.saveData?.totalCoins ?? 0} coins banked`;
        ctx.font = 'bold 34px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        const textW = ctx.measureText(totalLabel).width;
        const iconY = 170 + sa.top;
        const iconX = (INTERNAL_WIDTH - textW) / 2 - 26;
        ctx.drawImage(coinSprite, iconX, iconY - coinSprite.height / 2);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(totalLabel, iconX + coinSprite.width + 6, iconY);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '22px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText(
            'Permanent upgrades — applied at the start of every run.',
            INTERNAL_WIDTH / 2,
            210 + sa.top
        );

        const upgrades = state.permanentUpgrades ?? [];
        const rects = this.getShopUpgradeRects(upgrades.length);
        for (let i = 0; i < upgrades.length; i++) {
            this._drawShopCard(ctx, rects[i], upgrades[i], state.saveData?.totalCoins ?? 0);
        }

        const startBtn = this.getStartRunButtonRect();
        ctx.fillStyle = 'rgba(95, 232, 122, 0.78)';
        ctx.strokeStyle = '#5fe87a';
        ctx.lineWidth = 4;
        roundRectPath(ctx, startBtn.x, startBtn.y, startBtn.w, startBtn.h, 22);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#0a1a10';
        ctx.font = 'bold 44px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('START RUN', startBtn.x + startBtn.w / 2, startBtn.y + startBtn.h / 2);

        const resetBtn = this.getResetSaveButtonRect();
        const confirming = !!state.resetConfirming;
        ctx.fillStyle = confirming ? 'rgba(255, 71, 87, 0.5)' : 'rgba(255, 71, 87, 0.18)';
        ctx.strokeStyle = '#ff4757';
        ctx.lineWidth = 2;
        roundRectPath(ctx, resetBtn.x, resetBtn.y, resetBtn.w, resetBtn.h, 12);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 22px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText(
            confirming ? 'TAP AGAIN TO CONFIRM RESET' : 'RESET SAVE',
            resetBtn.x + resetBtn.w / 2,
            resetBtn.y + resetBtn.h / 2
        );

        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '20px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText(
            'Space / Enter starts the run',
            INTERNAL_WIDTH / 2,
            INTERNAL_HEIGHT - 36 - sa.bottom
        );
    }

    _drawShopCard(ctx, r, upgrade, totalCoins) {
        const isMax = upgrade.isMax;
        const canAfford = !isMax && totalCoins >= upgrade.cost;

        ctx.save();
        ctx.fillStyle = isMax
            ? 'rgba(95, 232, 122, 0.12)'
            : canAfford
                ? 'rgba(255, 209, 102, 0.16)'
                : 'rgba(255, 255, 255, 0.06)';
        ctx.strokeStyle = isMax
            ? '#5fe87a'
            : canAfford
                ? '#ffd166'
                : 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 3;
        roundRectPath(ctx, r.x, r.y, r.w, r.h, 14);
        ctx.fill();
        ctx.stroke();

        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 28px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText(upgrade.name, r.x + 24, r.y + 16);

        ctx.fillStyle = 'rgba(255,255,255,0.78)';
        ctx.font = '22px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText(upgrade.description, r.x + 24, r.y + 52);

        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = 'bold 22px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.fillText(`Lv ${upgrade.level} / ${upgrade.maxLevel}`, r.x + 24, r.y + 84);

        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        if (isMax) {
            ctx.fillStyle = '#5fe87a';
            ctx.font = 'bold 32px -apple-system, system-ui, Helvetica, Arial, sans-serif';
            ctx.fillText('MAX', r.x + r.w - 24, r.y + r.h / 2);
        } else {
            ctx.fillStyle = canAfford ? '#ffd166' : 'rgba(255,255,255,0.5)';
            ctx.font = 'bold 32px -apple-system, system-ui, Helvetica, Arial, sans-serif';
            ctx.fillText(`${upgrade.cost} ¢`, r.x + r.w - 24, r.y + r.h / 2 - 16);
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '18px -apple-system, system-ui, Helvetica, Arial, sans-serif';
            ctx.fillText(canAfford ? 'Tap to buy' : 'Not enough', r.x + r.w - 24, r.y + r.h / 2 + 18);
        }
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

function formatBossClock(t) {
    if (t == null) return '?';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
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
