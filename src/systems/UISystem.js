import {
    INTERNAL_WIDTH,
    INTERNAL_HEIGHT,
    GAME_TITLE,
    CHEST,
} from '../config/GameConfig.js';
import { TWO_PI } from '../core/MathUtils.js';
import {
    roundRectPath,
    drawStatBar,
    lerp,
    clamp01,
    easeOutCubic,
    easeOutBack,
    easeOutQuad,
} from '../render/DrawUtils.js';
import { getChestSprite, getCoinSprite } from '../assets/ProceduralSprites.js';

const DEBUG_BUTTON_SIZE = 96;
const DEBUG_BUTTON_MARGIN = 20;

const CARD_W = 440;
const CARD_H = 540;
const CARD_GAP = 40;

const RESTART_BTN_W = 360;
const RESTART_BTN_H = 96;

// One font stack for prose, one monospace stack for tabular numbers so the
// timer / debug columns don't jitter or render ragged under a proportional
// font.
const FONT = '-apple-system, system-ui, Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// Single source of truth for the display title (start screen). Derived from
// GAME_TITLE so branding can't drift between screens.
const TITLE = GAME_TITLE.replace(/\s*[—-].*$/, '').toUpperCase();

const RARITY_COLORS = {
    common:   { border: '#7ea3c4', accent: '#dfe9f5', glow: 'rgba(126,163,196,0.0)' },
    uncommon: { border: '#5fe87a', accent: '#bff7c8', glow: 'rgba(95,232,122,0.18)' },
    rare:     { border: '#5fc7ff', accent: '#bfeaff', glow: 'rgba(95,199,255,0.22)' },
    epic:     { border: '#c97bff', accent: '#e8c8ff', glow: 'rgba(201,123,255,0.28)' },
};

export class UISystem {
    constructor({ renderer, loop }) {
        this.renderer = renderer;
        this.loop = loop;

        // Per-run animation state (smoothed bar values + boss-bar slide).
        // Reset by beginRun() at the start of every run.
        this.dispHpRatio = 1;
        this.dispXpRatio = 0;
        this.dispBossRatio = 1;
        this.bossName = null;
        this.bossSlideT = 0;
    }

    // Called by Game at the start of each run so bar display values + boss
    // slide don't carry over from the previous run.
    beginRun(player) {
        this.dispHpRatio = player && player.maxHp > 0 ? player.hp / player.maxHp : 1;
        this.dispXpRatio = player && player.xpToNext > 0 ? player.xp / player.xpToNext : 0;
        this.dispBossRatio = 1;
        this.bossName = null;
        this.bossSlideT = 0;
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
            y: INTERNAL_HEIGHT - 230 - this.renderer.safeArea.bottom,
            w: 480,
            h: 100,
        };
    }

    getResetSaveButtonRect() {
        return {
            x: INTERNAL_WIDTH / 2 - 190,
            y: INTERNAL_HEIGHT - 116 - this.renderer.safeArea.bottom,
            w: 380,
            h: 72,
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
        // Below the best-run ribbon (drawn at ~234) so they don't collide.
        const startY = 280 + sa.top;
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

    // Small HUD pause button, just left of the DBG button.
    getPauseButtonRect() {
        const dbg = this.getDebugButtonRect();
        return { x: dbg.x - DEBUG_BUTTON_SIZE - 16, y: dbg.y, w: DEBUG_BUTTON_SIZE, h: DEBUG_BUTTON_SIZE };
    }

    // Pause overlay buttons (stacked, centered).
    getResumeButtonRect() {
        return { x: INTERNAL_WIDTH / 2 - 240, y: INTERNAL_HEIGHT / 2 - 70, w: 480, h: 100 };
    }
    getPauseRestartRect() {
        return { x: INTERNAL_WIDTH / 2 - 244, y: INTERNAL_HEIGHT / 2 + 54, w: 234, h: 84 };
    }
    getPauseShopRect() {
        return { x: INTERNAL_WIDTH / 2 + 10, y: INTERNAL_HEIGHT / 2 + 54, w: 234, h: 84 };
    }
    getShakeToggleRect() {
        return { x: INTERNAL_WIDTH / 2 - 240, y: INTERNAL_HEIGHT / 2 + 162, w: 480, h: 64 };
    }

    // Level-up reroll button (below the cards) + a per-card banish button.
    getRerollButtonRect() {
        const sa = this.renderer.safeArea;
        // Anchor above the bottom inset, but never lift into the card row
        // (cards aren't safe-area adjusted) — clamp to just below them.
        const cardBottom = (INTERNAL_HEIGHT - CARD_H) / 2 + 60 + CARD_H;
        const y = Math.max(cardBottom + 16, INTERNAL_HEIGHT - 150 - sa.bottom);
        return { x: INTERNAL_WIDTH / 2 - 180, y, w: 360, h: 68 };
    }
    getBanishButtonRect(cardRect) {
        const s = 44;
        return { x: cardRect.x + cardRect.w - s - 14, y: cardRect.y + 14, w: s, h: s };
    }

    // ── Press feedback helper ──────────────────────────────────────────
    // Returns 0..1 "just pressed" intensity for a control id (fades over
    // ~0.22s). Used to scale-down + brighten a tapped surface.
    _pressAmt(state, id) {
        const pf = state.pressFx;
        if (!pf || pf.id !== id) return 0;
        return clamp01(1 - pf.age / 0.22);
    }

    draw(ctx, gameState) {
        // Start / shop screen replaces the regular HUD entirely.
        if (gameState.screen === 'start') {
            this._drawStartScreen(ctx, gameState);
            return;
        }

        this._drawTopReadout(ctx, gameState);
        this._drawWaveLabel(ctx, gameState);
        this._drawBossHpBar(ctx, gameState);
        this._drawLoadoutChips(ctx, gameState);
        this._drawHpBar(ctx, gameState);
        this._drawXPBar(ctx, gameState);
        this._drawDebugPanel(ctx, gameState);
        this._drawDebugButton(ctx, gameState);
        if (!gameState.gameOver && !gameState.upgradeChoices && !gameState.chestReward && !gameState.paused) {
            this._drawPauseButton(ctx, gameState);
        }
        this._drawControlHint(ctx, gameState);

        if (!gameState.gameOver && !gameState.upgradeChoices && !gameState.chestReward) {
            this._drawWaveAnnouncement(ctx, gameState.waveAnnouncement);
        }

        // Low-HP danger vignette during live play.
        if (!gameState.gameOver && gameState.player) {
            const hpRatio = gameState.player.maxHp > 0
                ? gameState.player.hp / gameState.player.maxHp
                : 1;
            if (hpRatio > 0 && hpRatio < 0.3) this._drawLowHpVignette(ctx, hpRatio);
        }

        // Overlay priority: game-over > chest > level-up > pause.
        if (gameState.gameOver) {
            this._drawGameOverOverlay(ctx, gameState);
        } else if (gameState.chestReward) {
            this._drawChestOverlay(ctx, gameState);
        } else if (gameState.upgradeChoices) {
            this._drawLevelUpOverlay(ctx, gameState);
        } else if (gameState.paused) {
            this._drawPauseOverlay(ctx, gameState);
        }

        // Transient hit/heal/level-up screen flashes paint last so they
        // wash briefly over everything, including overlays.
        this._drawFeedback(ctx, gameState);
    }

    // ── Top-center readout: big tabular timer + kills/coins ────────────
    _drawTopReadout(ctx, state) {
        const sa = this.renderer.safeArea;
        const cx = INTERNAL_WIDTH / 2;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        // Drop shadow for legibility over the bright/dark world.
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold 58px ${MONO}`;
        ctx.fillText(formatTime(state.time), cx, sa.top + 14);
        ctx.shadowBlur = 0;

        // Kills · Coins line.
        ctx.font = `bold 24px ${FONT}`;
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText(
            `${state.kills} KILLS`,
            cx - 90,
            sa.top + 78
        );
        const coinSprite = getCoinSprite();
        const coinText = `${state.runCoins ?? 0}`;
        ctx.fillStyle = '#ffd166';
        ctx.textAlign = 'left';
        ctx.fillText(coinText, cx + 40, sa.top + 78);
        ctx.drawImage(coinSprite, cx + 16 - coinSprite.width / 2, sa.top + 78 + 2);
        ctx.restore();
    }

    _drawWaveLabel(ctx, state) {
        const ws = state.waveState;
        if (!ws) return;
        const sa = this.renderer.safeArea;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(255, 209, 102, 0.9)';
        ctx.font = `bold 22px ${FONT}`;
        ctx.fillText(
            `WAVE ${ws.index + 1}  •  ${ws.name}`,
            INTERNAL_WIDTH / 2,
            sa.top + 112
        );
        ctx.restore();
    }

    // ── Compact loadout chips (top-left) replacing the old text wall ────
    _drawLoadoutChips(ctx, state) {
        const sa = this.renderer.safeArea;
        let x = sa.left + 28;
        let y = sa.top + 22;
        const h = 34;
        const gap = 8;

        ctx.save();
        ctx.textBaseline = 'middle';
        ctx.font = `bold 20px ${FONT}`;

        const chip = (label, level, theme) => {
            ctx.font = `bold 20px ${FONT}`;
            const lvText = level;
            const padX = 14;
            const labelW = ctx.measureText(label).width;
            ctx.font = `bold 18px ${MONO}`;
            const lvW = lvText ? ctx.measureText(lvText).width + 12 : 0;
            const w = padX + labelW + (lvText ? 10 + lvW : 0) + padX;

            roundRectPath(ctx, x, y, w, h, 10);
            ctx.fillStyle = theme.fill;
            ctx.fill();
            ctx.strokeStyle = theme.border;
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = '#fff';
            ctx.font = `bold 20px ${FONT}`;
            ctx.textAlign = 'left';
            ctx.fillText(label, x + padX, y + h / 2 + 1);

            if (lvText) {
                ctx.fillStyle = theme.lv;
                ctx.font = `bold 18px ${MONO}`;
                ctx.textAlign = 'right';
                ctx.fillText(lvText, x + w - padX, y + h / 2 + 1);
            }
            y += h + gap;
        };

        const weaponTheme = { fill: 'rgba(40,30,12,0.7)', border: 'rgba(255,209,102,0.7)', lv: '#ffd166' };
        const evolvedTheme = { fill: 'rgba(40,18,46,0.7)', border: 'rgba(216,140,255,0.8)', lv: '#ffd6f5' };
        const passiveTheme = { fill: 'rgba(14,30,40,0.7)', border: 'rgba(95,199,255,0.65)', lv: '#9fe0ff' };
        // Element-tinted chip themes so a fire/frost/shock build reads at a
        // glance on the HUD.
        const elementThemes = {
            fire:  { fill: 'rgba(46,22,10,0.72)', border: 'rgba(255,122,51,0.85)', lv: '#ffb27a' },
            frost: { fill: 'rgba(12,32,44,0.72)', border: 'rgba(127,224,255,0.85)', lv: '#bdeeff' },
            shock: { fill: 'rgba(44,40,10,0.72)', border: 'rgba(255,224,102,0.85)', lv: '#ffe89a' },
        };

        for (const w of state.ownedWeapons ?? []) {
            const lv = w.evolved ? 'EVO' : (w.isMax ? 'MAX' : `${w.level}`);
            const theme = elementThemes[w.element] ?? (w.evolved ? evolvedTheme : weaponTheme);
            chip(w.name, lv, theme);
        }
        for (const p of state.ownedPassives ?? []) {
            const lv = p.isMax ? 'MAX' : `${p.level}`;
            const theme = elementThemes[p.element] ?? passiveTheme;
            chip(p.name, lv, theme);
        }
        ctx.restore();
    }

    _drawBossHpBar(ctx, state) {
        const boss = state.activeBoss;
        // Track boss identity so a fresh boss re-triggers the slide-in.
        if (boss) {
            if (this.bossName !== boss.name) {
                this.bossName = boss.name;
                this.bossSlideT = 0;
                this.dispBossRatio = 1;
            }
            this.bossSlideT = Math.min(1, this.bossSlideT + 0.06);
        } else {
            this.bossName = null;
            return;
        }

        const sa = this.renderer.safeArea;
        const slide = (1 - easeOutCubic(this.bossSlideT)) * -70;
        const padTop = sa.top + 150 + slide;
        const barW = INTERNAL_WIDTH * 0.55;
        const barH = 30;
        const barX = (INTERNAL_WIDTH - barW) / 2;

        const pct = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
        // Chip lags above the live value so a chunk drains visibly after a hit.
        this.dispBossRatio = this.dispBossRatio < pct
            ? pct
            : lerp(this.dispBossRatio, pct, 0.12);

        const enraged = !!boss.enraged;
        ctx.save();
        ctx.globalAlpha = easeOutCubic(this.bossSlideT);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        // Enrage retints the name + appends an ENRAGED tag so the phase-2
        // setpiece reads clearly even before the player notices faster attacks.
        ctx.fillStyle = enraged ? '#ff3326' : '#ff6b6b';
        ctx.font = `bold 26px ${FONT}`;
        ctx.shadowColor = enraged ? 'rgba(255,60,40,0.6)' : 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = enraged ? 12 : 6;
        const label = enraged ? `${boss.name.toUpperCase()} — ENRAGED` : boss.name.toUpperCase();
        ctx.fillText(label, INTERNAL_WIDTH / 2, padTop - 6);
        ctx.shadowBlur = 0;

        drawStatBar(ctx, barX, padTop, barW, barH, pct,
            enraged ? { from: '#ff2a1e', to: '#ffae3c' } : { from: '#ff4757', to: '#ff8c40' },
            {
                radius: 8,
                track: 'rgba(30, 4, 4, 0.8)',
                chip: this.dispBossRatio,
                chipColor: 'rgba(255,180,120,0.6)',
                border: enraged ? '#ff3326' : '#ff6b6b',
                borderWidth: 2,
            });

        // 25% segment ticks.
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 2;
        for (let i = 1; i < 4; i++) {
            const tx = barX + (barW * i) / 4;
            ctx.beginPath();
            ctx.moveTo(tx, padTop + 3);
            ctx.lineTo(tx, padTop + barH - 3);
            ctx.stroke();
        }

        ctx.fillStyle = '#fff';
        ctx.font = `bold 18px ${MONO}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
            `${Math.ceil(boss.hp)} / ${Math.ceil(boss.maxHp)}`,
            INTERNAL_WIDTH / 2,
            padTop + barH / 2 + 1
        );
        ctx.restore();
    }

    _drawChestOverlay(ctx, state) {
        const c = state.chestReward;
        if (!c) return;
        const isEvolution = c.reward.kind === 'evolution';

        // Backdrop fades in with the chest.
        const inT = clamp01(c.age / 0.25);
        ctx.save();
        ctx.globalAlpha = inT;
        ctx.fillStyle = isEvolution ? 'rgba(20, 10, 26, 0.84)' : 'rgba(10, 8, 4, 0.82)';
        ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
        ctx.globalAlpha = 1;

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Title punches in.
        const titleScale = easeOutBack(clamp01(c.age / 0.3));
        ctx.save();
        ctx.translate(INTERNAL_WIDTH / 2, 220);
        ctx.scale(titleScale, titleScale);
        ctx.fillStyle = isEvolution ? '#ffd6f5' : '#ffd166';
        ctx.font = `bold 80px ${FONT}`;
        ctx.fillText(isEvolution ? 'WEAPON EVOLVED!' : 'TREASURE!', 0, 0);
        ctx.restore();

        const animDur = isEvolution
            ? CHEST.openAnimationDuration * 1.4
            : CHEST.openAnimationDuration;
        const animT = Math.min(1, c.age / animDur);
        const sprite = getChestSprite();
        const scale = 4;
        const chestX = INTERNAL_WIDTH / 2;
        const chestY = INTERNAL_HEIGHT * 0.5;

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

        const revealStart = animDur * 0.5;
        if (c.age >= revealStart) {
            const textAlpha = Math.min(1, (c.age - revealStart) / 0.25);
            ctx.save();
            ctx.globalAlpha = textAlpha;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (isEvolution) {
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.font = `34px ${FONT}`;
                ctx.fillText(
                    `${c.reward.baseName}  +  ${c.reward.catalystName}`,
                    INTERNAL_WIDTH / 2,
                    INTERNAL_HEIGHT * 0.73
                );
                ctx.fillStyle = '#ffd6f5';
                ctx.font = `bold 56px ${FONT}`;
                ctx.fillText(c.reward.evolvedName, INTERNAL_WIDTH / 2, INTERNAL_HEIGHT * 0.80);
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.font = `28px ${FONT}`;
                ctx.fillText(c.reward.chestRewardText, INTERNAL_WIDTH / 2, INTERNAL_HEIGHT * 0.86);
            } else {
                ctx.fillStyle = '#fff';
                ctx.font = `bold 48px ${FONT}`;
                ctx.fillText(c.reward.text, INTERNAL_WIDTH / 2, INTERNAL_HEIGHT * 0.78);
            }
            ctx.restore();
        }

        if (c.age >= animDur) {
            const pulse = 0.55 + 0.35 * ((Math.sin(c.age * 4) + 1) / 2);
            ctx.save();
            ctx.globalAlpha = pulse;
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.font = `28px ${FONT}`;
            ctx.fillText(
                'Tap or press Space to continue',
                INTERNAL_WIDTH / 2,
                INTERNAL_HEIGHT - 80 - this.renderer.safeArea.bottom
            );
            ctx.restore();
        }
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

        // Slide down into place on entry.
        const slide = (1 - easeOutCubic(clamp01(t / fadeIn))) * -40;
        const centerY = INTERNAL_HEIGHT * 0.32 + slide;
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

        // Accent line sweeps across as it settles.
        const sweep = easeOutCubic(clamp01(t / (fadeIn * 1.6)));
        ctx.strokeStyle = 'rgba(255, 209, 102, 0.85)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(panelX + 30, panelY + panelH - 16);
        ctx.lineTo(panelX + 30 + (panelW - 60) * sweep, panelY + panelH - 16);
        ctx.stroke();

        ctx.fillStyle = '#ffd166';
        ctx.font = `bold 48px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ann.text, INTERNAL_WIDTH / 2, centerY);
        ctx.restore();
    }

    _bottomBarLayout() {
        const sa = this.renderer.safeArea;
        return {
            padL: sa.left + 40,
            padR: sa.right + 40,
            labelW: 160,
            readoutW: 200,
            barH: 26,
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

        const target = state.player.maxHp > 0
            ? clamp01(state.player.hp / state.player.maxHp)
            : 0;
        // Lag the displayed value above the target after a hit (chip trail),
        // but snap up instantly on heal so healing reads as a clean gain.
        if (this.dispHpRatio < target) this.dispHpRatio = target;
        else this.dispHpRatio = lerp(this.dispHpRatio, target, 0.12);

        const fill = target < 0.3
            ? { from: '#ff3b4e', to: '#ff6b6b' }
            : target < 0.6
                ? { from: '#ff9f1c', to: '#ffc15e' }
                : { from: '#3fce63', to: '#7bf09a' };

        // Low-HP border pulse.
        let border = 'rgba(255,255,255,0.42)';
        if (target < 0.3) {
            const p = 0.5 + 0.5 * Math.sin(state.time * 9);
            border = `rgba(255, 80, 90, ${0.6 + 0.35 * p})`;
        }

        ctx.save();
        ctx.font = `bold 30px ${FONT}`;
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText('HP', layout.padL, barY + layout.barH / 2);

        drawStatBar(ctx, barLeft, barY, barW, layout.barH, target, fill, {
            radius: 9,
            chip: this.dispHpRatio,
            chipColor: 'rgba(255, 90, 90, 0.5)',
            border,
            borderWidth: 2,
        });

        ctx.fillStyle = '#fff';
        ctx.font = `22px ${MONO}`;
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
        const padB = sa.bottom + 74;
        const barLeft = layout.padL + layout.labelW;
        const barRight = INTERNAL_WIDTH - layout.padR - layout.readoutW;
        const barW = Math.max(60, barRight - barLeft);
        const barY = INTERNAL_HEIGHT - padB;

        const target = state.player.xpToNext > 0
            ? Math.min(1, state.player.xp / state.player.xpToNext)
            : 0;
        // Smoothly sweep toward the target (and back down on level-up).
        this.dispXpRatio = lerp(this.dispXpRatio, target, 0.2);

        ctx.save();
        ctx.font = `bold 30px ${FONT}`;
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(`LV ${state.player.level}`, layout.padL, barY + layout.barH / 2);

        drawStatBar(ctx, barLeft, barY, barW, layout.barH, this.dispXpRatio,
            { from: '#3aa8ff', to: '#7fdcff' },
            { radius: 9, border: 'rgba(255,255,255,0.42)', borderWidth: 2 });

        ctx.fillStyle = '#fff';
        ctx.font = `22px ${MONO}`;
        ctx.textAlign = 'left';
        ctx.fillText(
            `${Math.floor(state.player.xp)} / ${state.player.xpToNext}`,
            barRight + 16,
            barY + layout.barH / 2
        );
        ctx.restore();
    }

    // ── Debug panel (only when debug is on) ────────────────────────────
    _drawDebugPanel(ctx, state) {
        if (!state.showDebug) return;
        const sa = this.renderer.safeArea;
        const btn = this.getDebugButtonRect();
        const padR = INTERNAL_WIDTH - btn.x + 8;
        const padY = btn.y + btn.h + 18;
        const ws = state.waveState;

        const lines = [
            `FPS     ${this.loop?.fps ? this.loop.fps.toFixed(0) : '--'}`,
            `TIME    ${formatTime(state.time)}`,
            `KILLS   ${state.kills}`,
            `ENEMIES ${state.enemyCount}`,
            `BOLTS   ${state.projectileCount}`,
            `GEMS    ${state.gemCount}`,
            `COINS   ${state.runCoins ?? 0}`,
            ``,
            `hp      ${Math.ceil(state.player.hp)}/${state.player.maxHp}` +
                (state.player.invincibleTimer > 0
                    ? `  if ${state.player.invincibleTimer.toFixed(2)}` : ''),
            `lvl/xp  ${state.player.level}  ${Math.floor(state.player.xp)}/${state.player.xpToNext}`,
            `pickup  ${Math.round(state.player.pickupRange)}`,
            ``,
            `WAVE    ${ws ? ws.index + 1 : '?'} ${ws ? ws.name : ''}`,
            `weights ${ws ? formatWeights(ws.typeWeights) : ''}`,
            `int×    ${ws ? ws.spawnIntervalMul.toFixed(2) : '?'}`,
            `cap     ${ws ? ws.maxAlive : '?'}`,
            `hp×spd× ${ws ? ws.healthMul.toFixed(2) : '?'} / ${ws ? ws.speedMul.toFixed(2) : '?'}`,
            `elite%  ${ws ? (ws.eliteChance * 100).toFixed(1) : '?'}`,
            ``,
            `boss    ${formatBossClock(state.nextBossTime)}` +
                (state.activeBoss ? `  ${state.activeBoss.name}` : ''),
            `chests  ${state.chestCount ?? 0}` + (state.pendingChests > 0 ? ` +${state.pendingChests}` : ''),
            `evos    ${state.eligibleEvolutionCount ?? 0}`,
            `spawn   ${formatSpawn(state.spawnTimer, state.spawnInterval)}`,
            `pos     (${Math.round(state.player.x)}, ${Math.round(state.player.y)})`,
            `dpr     ${this.renderer.dpr.toFixed(2)}`,
            `safe    T${Math.round(sa.top)} R${Math.round(sa.right)} B${Math.round(sa.bottom)} L${Math.round(sa.left)}`,
            `contact ${state.inContact ? 'YES' : 'no'}`,
        ];

        ctx.save();
        ctx.font = `22px ${MONO}`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';

        const lineH = 26;
        const boxW = 380;
        const boxH = lineH * lines.length + 20;
        const boxRight = INTERNAL_WIDTH - sa.right - 12;
        const boxLeft = boxRight - boxW;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        roundRectPath(ctx, boxLeft, padY - 8, boxW, boxH, 10);
        ctx.fill();

        ctx.fillStyle = 'rgba(180, 230, 255, 0.95)';
        const textLeft = boxLeft + 14;
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], textLeft, padY + i * lineH);
        }
        ctx.restore();
    }

    _drawDebugButton(ctx, state) {
        const { x: btnX, y: btnY, w: btnW, h: btnH } = this.getDebugButtonRect();
        const press = this._pressAmt(state, 'dbg');
        const s = 1 - 0.05 * press;

        ctx.save();
        ctx.translate(btnX + btnW / 2, btnY + btnH / 2);
        ctx.scale(s, s);
        ctx.translate(-(btnX + btnW / 2), -(btnY + btnH / 2));
        ctx.fillStyle = state.showDebug ? 'rgba(80,160,255,0.7)' : 'rgba(255,255,255,0.18)';
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2;
        roundRectPath(ctx, btnX, btnY, btnW, btnH, 14);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.font = `32px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('DBG', btnX + btnW / 2, btnY + btnH / 2);
        ctx.restore();
    }

    _drawPauseButton(ctx, state) {
        const { x, y, w, h } = this.getPauseButtonRect();
        const press = this._pressAmt(state, 'pause');
        const s = 1 - 0.05 * press;
        ctx.save();
        ctx.translate(x + w / 2, y + h / 2);
        ctx.scale(s, s);
        ctx.translate(-(x + w / 2), -(y + h / 2));
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        roundRectPath(ctx, x, y, w, h, 14);
        ctx.fill();
        ctx.stroke();
        // Two pause bars.
        ctx.fillStyle = '#fff';
        const bw = 12, bh = 40, gap = 12;
        roundRectPath(ctx, x + w / 2 - gap / 2 - bw, y + h / 2 - bh / 2, bw, bh, 3);
        ctx.fill();
        roundRectPath(ctx, x + w / 2 + gap / 2, y + h / 2 - bh / 2, bw, bh, 3);
        ctx.fill();
        ctx.restore();
    }

    _drawPauseOverlay(ctx, state) {
        ctx.save();
        ctx.fillStyle = 'rgba(6, 10, 18, 0.82)';
        ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffd166';
        ctx.font = `bold 96px ${FONT}`;
        ctx.fillText('PAUSED', INTERNAL_WIDTH / 2, INTERNAL_HEIGHT / 2 - 180);

        const resume = this.getResumeButtonRect();
        this._drawSummaryButton(ctx, resume, 'RESUME', '#5fe87a',
            'rgba(95, 232, 122, 0.3)', this._pressAmt(state, 'resume'), true);

        const restart = this.getPauseRestartRect();
        const shop = this.getPauseShopRect();
        this._drawSummaryButton(ctx, restart, 'RESTART', '#ffd166',
            'rgba(255, 209, 102, 0.14)', this._pressAmt(state, 'restart'), false);
        this._drawSummaryButton(ctx, shop, 'SHOP', '#5fc7ff',
            'rgba(95, 199, 255, 0.12)', this._pressAmt(state, 'returnShop'), false);

        // Screen-shake accessibility toggle.
        const tg = this.getShakeToggleRect();
        const on = state.shakeEnabled !== false;
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 2;
        roundRectPath(ctx, tg.x, tg.y, tg.w, tg.h, 14);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `26px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText('Screen shake', tg.x + 24, tg.y + tg.h / 2);
        // Pill switch on the right.
        const pillW = 84, pillH = 40;
        const px = tg.x + tg.w - pillW - 20;
        const py = tg.y + (tg.h - pillH) / 2;
        roundRectPath(ctx, px, py, pillW, pillH, pillH / 2);
        ctx.fillStyle = on ? '#5fe87a' : 'rgba(255,255,255,0.2)';
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(on ? px + pillW - pillH / 2 : px + pillH / 2, py + pillH / 2, pillH / 2 - 5, 0, TWO_PI);
        ctx.fill();
        ctx.fillStyle = on ? '#0a1a10' : 'rgba(255,255,255,0.7)';
        ctx.font = `bold 18px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(on ? 'ON' : 'OFF', px + pillW / 2, py - 0 + pillH / 2);

        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = `22px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('P / Esc to resume', INTERNAL_WIDTH / 2, INTERNAL_HEIGHT - 60 - this.renderer.safeArea.bottom);
        ctx.restore();
    }

    _drawControlHint(ctx, state) {
        if (state.upgradeChoices || state.gameOver || state.chestReward || state.paused) return;
        const sa = this.renderer.safeArea;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = `20px ${FONT}`;
        ctx.fillText(
            'WASD / Arrows  •  Touch left half to move  •  Tap DBG (or `) for debug',
            INTERNAL_WIDTH / 2,
            INTERNAL_HEIGHT - 22 - sa.bottom
        );
        ctx.restore();
    }

    // ── Transient full-screen feedback flashes ─────────────────────────
    _drawFeedback(ctx, state) {
        const fb = state.feedback;
        if (!fb || fb.length === 0) return;
        const cx = INTERNAL_WIDTH / 2;
        const cy = INTERNAL_HEIGHT / 2;
        const maxR = Math.hypot(cx, cy);

        ctx.save();
        for (const f of fb) {
            const a = 1 - clamp01(f.age / f.life);
            if (a <= 0) continue;
            if (f.type === 'hit') {
                const g = ctx.createRadialGradient(cx, cy, maxR * 0.45, cx, cy, maxR);
                g.addColorStop(0, 'rgba(255,40,60,0)');
                g.addColorStop(1, `rgba(255,30,50,${0.5 * a})`);
                ctx.fillStyle = g;
                ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
            } else if (f.type === 'heal') {
                const g = ctx.createRadialGradient(cx, cy, maxR * 0.5, cx, cy, maxR);
                g.addColorStop(0, 'rgba(80,255,120,0)');
                g.addColorStop(1, `rgba(70,240,120,${0.32 * a})`);
                ctx.fillStyle = g;
                ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
            } else if (f.type === 'levelup') {
                const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.9);
                g.addColorStop(0, `rgba(255,225,140,${0.3 * a})`);
                g.addColorStop(0.6, `rgba(255,209,102,${0.12 * a})`);
                g.addColorStop(1, 'rgba(255,209,102,0)');
                ctx.fillStyle = g;
                ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
            }
        }
        ctx.restore();
    }

    _drawLowHpVignette(ctx, ratio) {
        const cx = INTERNAL_WIDTH / 2;
        const cy = INTERNAL_HEIGHT / 2;
        const maxR = Math.hypot(cx, cy);
        // Stronger + faster pulse as HP approaches zero.
        const danger = 1 - ratio / 0.3;
        const pulse = 0.5 + 0.5 * Math.sin(performanceNowSafe() * 0.006 * (1 + danger));
        const strength = (0.18 + 0.22 * danger) * (0.6 + 0.4 * pulse);
        const g = ctx.createRadialGradient(cx, cy, maxR * 0.5, cx, cy, maxR);
        g.addColorStop(0, 'rgba(180,0,20,0)');
        g.addColorStop(1, `rgba(190,0,25,${strength})`);
        ctx.save();
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
        ctx.restore();
    }

    _drawLevelUpOverlay(ctx, state) {
        const choices = state.upgradeChoices;
        if (!choices) return;
        const age = state.levelUpAge ?? 1;

        ctx.save();

        // Backdrop eases in.
        const bg = easeOutQuad(clamp01(age / 0.18));
        ctx.fillStyle = `rgba(8, 12, 20, ${0.8 * bg})`;
        ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const titleScale = easeOutBack(clamp01(age / 0.22));
        ctx.save();
        ctx.translate(INTERNAL_WIDTH / 2, 210);
        ctx.scale(titleScale, titleScale);
        ctx.font = `bold 96px ${FONT}`;
        ctx.fillStyle = '#ffd166';
        ctx.fillText('LEVEL UP', 0, 0);
        ctx.restore();

        ctx.globalAlpha = bg;
        ctx.font = `34px ${FONT}`;
        ctx.fillStyle = 'rgba(255,255,255,0.78)';
        const sub = `Choose an upgrade  •  LV ${state.player.level}`
            + (state.pendingLevelUps > 0 ? `  (${state.pendingLevelUps + 1} pending)` : '');
        ctx.fillText(sub, INTERNAL_WIDTH / 2, 290);
        ctx.globalAlpha = 1;

        const rects = this.getLevelUpCardRects(choices.length);
        const counts = state.upgradeCounts ?? {};
        const banishes = state.banishes ?? 0;
        for (let i = 0; i < rects.length; i++) {
            // Stagger each card's entrance.
            const cardT = easeOutBack(clamp01((age - i * 0.06) / 0.32));
            if (cardT <= 0) continue;
            const r = rects[i];
            const cxp = r.x + r.w / 2;
            const cyp = r.y + r.h / 2;
            const press = this._pressAmt(state, `card:${i}`);
            const scale = (0.9 + 0.1 * cardT) * (1 - 0.04 * press);
            const slideY = (1 - cardT) * 40;

            ctx.save();
            ctx.globalAlpha = clamp01(cardT);
            ctx.translate(cxp, cyp + slideY);
            ctx.scale(scale, scale);
            ctx.translate(-cxp, -cyp);
            this._drawUpgradeCard(ctx, r, choices[i], i, counts);
            // No banish affordance on bonus/fallback cards (banishing them
            // would just waste the charge — they'd re-appear).
            if (banishes > 0 && choices[i].kind !== 'fallback') this._drawBanishButton(ctx, r);
            ctx.restore();
        }

        // Reroll button + remaining charges (only when the player has them).
        ctx.globalAlpha = bg;
        const rerolls = state.rerolls ?? 0;
        if (rerolls > 0) {
            const rr = this.getRerollButtonRect();
            const press = this._pressAmt(state, 'reroll');
            this._drawSummaryButton(ctx, rr, `REROLL  (${rerolls})`, '#c97bff',
                'rgba(201, 123, 255, 0.18)', press, false);
        }

        ctx.globalAlpha = bg;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = `24px ${FONT}`;
        let hint = 'Tap a card  •  1 / 2 / 3';
        if (rerolls > 0) hint += '  •  R reroll';
        if (banishes > 0) hint += `  •  ✕ banish (${banishes})`;
        ctx.fillText(
            hint,
            INTERNAL_WIDTH / 2,
            INTERNAL_HEIGHT - 56 - this.renderer.safeArea.bottom
        );

        ctx.restore();
    }

    _drawBanishButton(ctx, cardRect) {
        const b = this.getBanishButtonRect(cardRect);
        ctx.save();
        roundRectPath(ctx, b.x, b.y, b.w, b.h, 10);
        ctx.fillStyle = 'rgba(255, 71, 87, 0.22)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 120, 130, 0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = '#ff8c95';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        const pad = 13;
        ctx.beginPath();
        ctx.moveTo(b.x + pad, b.y + pad);
        ctx.lineTo(b.x + b.w - pad, b.y + b.h - pad);
        ctx.moveTo(b.x + b.w - pad, b.y + pad);
        ctx.lineTo(b.x + pad, b.y + b.h - pad);
        ctx.stroke();
        ctx.restore();
    }

    _drawUpgradeCard(ctx, r, upgrade, index, counts) {
        const colors = RARITY_COLORS[upgrade.rarity] ?? RARITY_COLORS.common;
        const stack = (counts && counts[upgrade.id]) ?? 0;
        const label = upgrade.cardLabel ?? (upgrade.rarity ?? 'common').toUpperCase();
        const levelText = upgrade.cardLevelText ?? `Lv ${stack + 1}`;
        const isWeaponish = upgrade.kind === 'weapon-new' || upgrade.kind === 'weapon-upgrade';

        ctx.save();
        // Card body.
        ctx.fillStyle = 'rgba(20, 26, 38, 0.96)';
        roundRectPath(ctx, r.x, r.y, r.w, r.h, 24);
        ctx.fill();

        // Rarity inner glow for the flashier tiers.
        if (colors.glow && colors.glow !== 'rgba(126,163,196,0.0)') {
            const g = ctx.createRadialGradient(
                r.x + r.w / 2, r.y + r.h * 0.4, 20,
                r.x + r.w / 2, r.y + r.h * 0.4, r.w * 0.75
            );
            g.addColorStop(0, colors.glow);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            roundRectPath(ctx, r.x, r.y, r.w, r.h, 24);
            ctx.save();
            ctx.clip();
            ctx.fillStyle = g;
            ctx.fillRect(r.x, r.y, r.w, r.h);
            ctx.restore();
        }

        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 4;
        roundRectPath(ctx, r.x, r.y, r.w, r.h, 24);
        ctx.stroke();

        // Keycap badge top-left (matches the 1/2/3 keyboard hint).
        const kc = 52;
        roundRectPath(ctx, r.x + 20, r.y + 20, kc, kc, 12);
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fill();
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `bold 30px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${index + 1}`, r.x + 20 + kc / 2, r.y + 20 + kc / 2 + 1);

        // Card label, centered at the top (the top-right corner is reserved
        // for the optional banish button).
        ctx.fillStyle = colors.accent;
        ctx.font = `bold 22px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, r.x + r.w / 2, r.y + 32);

        // Name.
        ctx.fillStyle = '#fff';
        ctx.font = `bold 42px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(upgrade.name, r.x + r.w / 2, r.y + 110);

        // Level badge.
        const badgeHi = stack > 0 || isWeaponish;
        ctx.fillStyle = badgeHi ? '#ffd166' : 'rgba(255,255,255,0.6)';
        ctx.font = `bold 26px ${FONT}`;
        ctx.fillText(levelText, r.x + r.w / 2, r.y + 168);

        // Description — clamped so it can never run into the footer.
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `30px ${FONT}`;
        wrapText(ctx, upgrade.description, r.x + r.w / 2, r.y + 232, r.w - 56, 38, 6);

        // Footer.
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `bold 22px ${FONT}`;
        ctx.textBaseline = 'bottom';
        ctx.fillText('TAP TO CHOOSE', r.x + r.w / 2, r.y + r.h - 28);

        ctx.restore();
    }

    _drawGameOverOverlay(ctx, state) {
        const summary = state.runSummary;
        const sa = this.renderer.safeArea;
        const age = state.gameOverAge ?? 1;

        ctx.save();
        // Backdrop fades in.
        const bg = easeOutQuad(clamp01(age / 0.3));
        ctx.fillStyle = `rgba(20, 4, 4, ${0.9 * bg})`;
        ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const titleScale = easeOutBack(clamp01(age / 0.35));
        ctx.save();
        ctx.translate(INTERNAL_WIDTH / 2, 120 + sa.top);
        ctx.scale(titleScale, titleScale);
        ctx.fillStyle = '#ff4757';
        ctx.font = `bold 112px ${FONT}`;
        ctx.fillText('GAME OVER', 0, 0);
        ctx.restore();

        // NEW BEST! ribbon — appears once the title has settled, pulsing.
        const nb = state.newBest;
        if (nb && (nb.time || nb.wave || nb.level || nb.kills) && age > 0.4) {
            const beaten = [];
            if (nb.time) beaten.push('TIME');
            if (nb.wave) beaten.push('WAVE');
            if (nb.level) beaten.push('LEVEL');
            if (nb.kills) beaten.push('KILLS');
            const pulse = 0.7 + 0.3 * ((Math.sin(age * 6) + 1) / 2);
            ctx.save();
            ctx.globalAlpha = pulse;
            ctx.fillStyle = '#ffd166';
            ctx.font = `bold 40px ${FONT}`;
            ctx.fillText(`★ NEW BEST!  ${beaten.join(' · ')} ★`, INTERNAL_WIDTH / 2, 196 + sa.top);
            ctx.restore();
        }

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
        ctx.font = `28px ${FONT}`;
        for (let i = 0; i < stats.length; i++) {
            // Stagger stat rows in top-to-bottom.
            const rowT = clamp01((age - 0.3 - i * 0.05) / 0.25);
            if (rowT <= 0) continue;
            const col = i % 2;
            const row = Math.floor(i / 2);
            const x = col === 0 ? colLeftX : INTERNAL_WIDTH / 2 + 40;
            const y = statsStartY + row * lineH;
            ctx.globalAlpha = rowT;
            ctx.textAlign = 'left';
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.fillText(stats[i][0], x, y);
            ctx.textAlign = 'right';
            ctx.fillStyle = '#fff';
            ctx.fillText(String(stats[i][1]), x + colWidth, y);
        }
        ctx.globalAlpha = 1;

        const tailT = clamp01((age - 0.55) / 0.3);
        ctx.globalAlpha = tailT;

        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd166';
        ctx.font = `bold 34px ${FONT}`;
        ctx.fillText(
            `Total Coins:  ${summary.totalCoins}`,
            INTERNAL_WIDTH / 2,
            statsStartY + Math.ceil(stats.length / 2) * lineH + 20
        );

        const listY = statsStartY + Math.ceil(stats.length / 2) * lineH + 80;
        ctx.font = `bold 24px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText('WEAPONS', INTERNAL_WIDTH / 2 - 460, listY);
        ctx.fillText('PASSIVES', INTERNAL_WIDTH / 2 + 60, listY);

        ctx.font = `22px ${FONT}`;
        const rowH = 28;
        for (let i = 0; i < summary.weapons.length; i++) {
            const w = summary.weapons[i];
            const tag = w.evolved ? 'EVOLVED' : (w.isMax ? `Lv ${w.maxLevel} MAX` : `Lv ${w.level}`);
            ctx.fillStyle = w.evolved ? '#ffd6f5' : '#fff';
            ctx.fillText(`${w.name}  •  ${tag}`, INTERNAL_WIDTH / 2 - 460, listY + 30 + i * rowH);
        }
        for (let i = 0; i < summary.passives.length; i++) {
            const p = summary.passives[i];
            const tag = p.isMax ? `Lv ${p.maxLevel} MAX` : `Lv ${p.level}`;
            ctx.fillStyle = '#fff';
            ctx.fillText(`${p.name}  •  ${tag}`, INTERNAL_WIDTH / 2 + 60, listY + 30 + i * rowH);
        }
        ctx.globalAlpha = 1;

        // Buttons fade in last. RESTART is the primary (filled, gentle
        // pulse); RETURN TO SHOP is secondary (outline).
        const btnT = clamp01((age - 0.7) / 0.3);
        ctx.globalAlpha = btnT;
        const restartBtn = this.getRestartButtonRect();
        const shopBtn = this.getReturnToShopButtonRect();
        const pulse = 0.85 + 0.15 * ((Math.sin(age * 4) + 1) / 2);
        this._drawSummaryButton(ctx, restartBtn, 'RESTART', '#5fe87a',
            `rgba(95, 232, 122, ${0.32 * pulse})`,
            this._pressAmt(state, 'restart'), true);
        this._drawSummaryButton(ctx, shopBtn, 'RETURN TO SHOP', '#5fc7ff',
            'rgba(95, 199, 255, 0.10)',
            this._pressAmt(state, 'returnShop'), false);

        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = `22px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(
            'R / Enter restart   •   B / Esc shop',
            INTERNAL_WIDTH / 2,
            restartBtn.y + restartBtn.h + 36
        );
        ctx.globalAlpha = 1;

        ctx.restore();
    }

    _drawSummaryButton(ctx, btn, label, borderColor, fillColor, press = 0, primary = false) {
        const s = 1 - 0.05 * press;
        ctx.save();
        ctx.translate(btn.x + btn.w / 2, btn.y + btn.h / 2);
        ctx.scale(s, s);
        ctx.translate(-(btn.x + btn.w / 2), -(btn.y + btn.h / 2));
        if (primary) {
            ctx.shadowColor = 'rgba(95,232,122,0.4)';
            ctx.shadowBlur = 18;
        }
        ctx.fillStyle = fillColor;
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = primary ? 5 : 3;
        roundRectPath(ctx, btn.x, btn.y, btn.w, btn.h, 22);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `bold 36px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2);
        ctx.restore();
    }

    _drawStartScreen(ctx, state) {
        const sa = this.renderer.safeArea;

        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#ffd166';
        ctx.font = `bold 84px ${FONT}`;
        ctx.fillText(TITLE, INTERNAL_WIDTH / 2, 60 + sa.top);
        ctx.restore();

        const coinSprite = getCoinSprite();
        const totalLabel = `${state.saveData?.totalCoins ?? 0} coins banked`;
        ctx.font = `bold 34px ${FONT}`;
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
        ctx.font = `22px ${FONT}`;
        ctx.fillText(
            'Permanent upgrades — applied at the start of every run.',
            INTERNAL_WIDTH / 2,
            210 + sa.top
        );

        // Best-run record ribbon (only once a run has been recorded).
        const stats = state.stats;
        if (stats && stats.runs > 0) {
            const parts = [
                `Best Time ${formatTime(stats.bestTime)}`,
                `Wave ${stats.bestWave}`,
                `Lv ${stats.bestLevel}`,
                `${stats.bestKills} kills`,
                `${stats.runs} runs`,
            ];
            ctx.fillStyle = 'rgba(95, 199, 255, 0.85)';
            ctx.font = `bold 22px ${FONT}`;
            ctx.fillText(parts.join('   •   '), INTERNAL_WIDTH / 2, 234 + sa.top);
        }

        const upgrades = state.permanentUpgrades ?? [];
        const rects = this.getShopUpgradeRects(upgrades.length);
        for (let i = 0; i < upgrades.length; i++) {
            const press = this._pressAmt(state, `shop:${upgrades[i].id}`);
            this._drawShopCard(ctx, rects[i], upgrades[i], state.saveData?.totalCoins ?? 0, press);
        }

        // START RUN (primary).
        const startBtn = this.getStartRunButtonRect();
        const startPress = this._pressAmt(state, 'start');
        const ss = 1 - 0.04 * startPress;
        ctx.save();
        ctx.translate(startBtn.x + startBtn.w / 2, startBtn.y + startBtn.h / 2);
        ctx.scale(ss, ss);
        ctx.translate(-(startBtn.x + startBtn.w / 2), -(startBtn.y + startBtn.h / 2));
        ctx.shadowColor = 'rgba(95,232,122,0.45)';
        ctx.shadowBlur = 20;
        ctx.fillStyle = 'rgba(95, 232, 122, 0.85)';
        ctx.strokeStyle = '#5fe87a';
        ctx.lineWidth = 4;
        roundRectPath(ctx, startBtn.x, startBtn.y, startBtn.w, startBtn.h, 22);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.fillStyle = '#0a1a10';
        ctx.font = `bold 46px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('START RUN', startBtn.x + startBtn.w / 2, startBtn.y + startBtn.h / 2);
        ctx.restore();

        // RESET SAVE (destructive, with a closing-window indicator).
        const resetBtn = this.getResetSaveButtonRect();
        const confirming = !!state.resetConfirming;
        ctx.save();
        ctx.fillStyle = confirming ? 'rgba(255, 71, 87, 0.5)' : 'rgba(255, 71, 87, 0.16)';
        ctx.strokeStyle = '#ff4757';
        ctx.lineWidth = 2;
        roundRectPath(ctx, resetBtn.x, resetBtn.y, resetBtn.w, resetBtn.h, 14);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `bold 22px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
            confirming ? 'TAP AGAIN TO CONFIRM RESET' : 'RESET SAVE',
            resetBtn.x + resetBtn.w / 2,
            resetBtn.y + resetBtn.h / 2
        );
        // Shrinking underline shows the 3s confirm window closing.
        if (confirming) {
            const frac = clamp01((state.resetConfirmTimer ?? 0) / 3);
            ctx.strokeStyle = '#ff8c40';
            ctx.lineWidth = 3;
            const uw = (resetBtn.w - 40) * frac;
            ctx.beginPath();
            ctx.moveTo(resetBtn.x + (resetBtn.w - uw) / 2, resetBtn.y + resetBtn.h - 8);
            ctx.lineTo(resetBtn.x + (resetBtn.w + uw) / 2, resetBtn.y + resetBtn.h - 8);
            ctx.stroke();
        }
        ctx.restore();

        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `20px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(
            'Space / Enter starts the run',
            INTERNAL_WIDTH / 2,
            INTERNAL_HEIGHT - 28 - sa.bottom
        );
    }

    _drawShopCard(ctx, r, upgrade, totalCoins, press = 0) {
        const isMax = upgrade.isMax;
        const canAfford = !isMax && totalCoins >= upgrade.cost;
        const s = 1 - 0.03 * press;

        ctx.save();
        ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
        ctx.scale(s, s);
        ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));

        ctx.fillStyle = isMax
            ? 'rgba(95, 232, 122, 0.12)'
            : canAfford
                ? 'rgba(255, 209, 102, 0.16)'
                : 'rgba(255, 255, 255, 0.06)';
        ctx.strokeStyle = isMax
            ? '#5fe87a'
            : canAfford ? '#ffd166' : 'rgba(255,255,255,0.32)';
        ctx.lineWidth = 3;
        roundRectPath(ctx, r.x, r.y, r.w, r.h, 14);
        ctx.fill();
        ctx.stroke();

        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff';
        ctx.font = `bold 28px ${FONT}`;
        ctx.fillText(upgrade.name, r.x + 24, r.y + 16);

        ctx.fillStyle = 'rgba(255,255,255,0.78)';
        ctx.font = `22px ${FONT}`;
        ctx.fillText(upgrade.description, r.x + 24, r.y + 52);

        // Level pip meter instead of bare "Lv x / y".
        const pipY = r.y + 92;
        const pipW = 18;
        const pipH = 12;
        const pipGap = 6;
        for (let i = 0; i < upgrade.maxLevel; i++) {
            const px = r.x + 24 + i * (pipW + pipGap);
            roundRectPath(ctx, px, pipY, pipW, pipH, 3);
            ctx.fillStyle = i < upgrade.level
                ? (isMax ? '#5fe87a' : '#ffd166')
                : 'rgba(255,255,255,0.14)';
            ctx.fill();
        }

        // Buy chip / cost with the in-world coin sprite.
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        if (isMax) {
            ctx.fillStyle = '#5fe87a';
            ctx.font = `bold 32px ${FONT}`;
            ctx.fillText('MAX', r.x + r.w - 24, r.y + r.h / 2);
        } else {
            const coinSprite = getCoinSprite();
            ctx.fillStyle = canAfford ? '#ffd166' : 'rgba(255,255,255,0.5)';
            ctx.font = `bold 32px ${MONO}`;
            const costText = `${upgrade.cost}`;
            ctx.fillText(costText, r.x + r.w - 44, r.y + r.h / 2 - 14);
            const cw = ctx.measureText(costText).width;
            ctx.drawImage(coinSprite, r.x + r.w - 38, r.y + r.h / 2 - 14 - coinSprite.height / 2);
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = `18px ${FONT}`;
            ctx.fillText(canAfford ? 'Tap to buy' : 'Not enough', r.x + r.w - 24, r.y + r.h / 2 + 20);
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
    return `${timer.toFixed(2)} / ${interval.toFixed(2)}`;
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

// monotonic-ish time for cosmetic pulses that don't have a dt handy. Guarded
// so the headless import smoke test (no performance global) doesn't throw.
function performanceNowSafe() {
    return (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : 0;
}

// Word-wrap with a hard line cap. Clamps to `maxLines` (default 8) and adds
// an ellipsis if the text would overflow, so a long description can never
// run past the card footer.
function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 8) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (let i = 0; i < words.length; i++) {
        const testLine = line ? line + ' ' + words[i] : words[i];
        if (ctx.measureText(testLine).width > maxWidth && line) {
            lines.push(line);
            line = words[i];
            if (lines.length >= maxLines - 1) break;
        } else {
            line = testLine;
        }
    }
    if (line && lines.length < maxLines) lines.push(line);
    // If we stopped early, ellipsize the last visible line.
    if (lines.length === maxLines) {
        let last = lines[maxLines - 1];
        while (last && ctx.measureText(last + '…').width > maxWidth) {
            last = last.slice(0, -1);
        }
        lines[maxLines - 1] = last + '…';
    }
    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], x, y + i * lineHeight);
    }
}
