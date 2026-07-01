import {
    INTERNAL_WIDTH,
    INTERNAL_HEIGHT,
    GAME_TITLE,
    CHEST,
    SPRITE_SS,
    COMBO,
    BOSS_TIERS,
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
import { getChestSprite, getCoinSprite, getGlowSprite } from '../assets/ProceduralSprites.js';
import { MenuRenderer } from './MenuRenderer.js';

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
    legendary:{ border: '#ffce54', accent: '#fff0c2', glow: 'rgba(255,206,84,0.34)' },
    mythic:   { border: '#ff4d6d', accent: '#ffd0d9', glow: 'rgba(255,77,109,0.40)' },
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
        // Level-up flash (XP bar): stamp of the last level-up + last seen level,
        // so a fresh run never flashes on frame 0.
        this._xpFlash = -1;
        this._lastLevel = null;

        // The redesigned tabbed main menu. Owns its own clickable hotspots,
        // which Game's pointer handler reads to dispatch menu actions.
        this.menu = new MenuRenderer(renderer);
    }

    // Called by Game at the start of each run so bar display values + boss
    // slide don't carry over from the previous run.
    beginRun(player) {
        this.dispHpRatio = player && player.maxHp > 0 ? player.hp / player.maxHp : 1;
        this.dispXpRatio = player && player.xpToNext > 0 ? player.xp / player.xpToNext : 0;
        this.dispBossRatio = 1;
        this.bossName = null;
        this.bossSlideT = 0;
        this._lastLevel = player?.level ?? 1;
        this._xpFlash = -1;
    }

    // ── HUD "ember forge" primitives (local — do NOT reuse MenuRenderer's, which
    // mutate menu-only caches) ─────────────────────────────────────────────
    // Smoked-glass plate matching the menu panel recipe.
    _hudGlassPlate(ctx, x, y, w, h, r = 12, opts = {}) {
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, 'rgba(24,18,18,0.94)'); g.addColorStop(1, 'rgba(12,10,12,0.96)');
        roundRectPath(ctx, x, y, w, h, r); ctx.fillStyle = g; ctx.fill();
        ctx.save(); roundRectPath(ctx, x, y, w, h, r); ctx.clip();
        const gg = ctx.createLinearGradient(0, y, 0, y + h * 0.4);
        gg.addColorStop(0, 'rgba(255,255,255,0.05)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gg; ctx.fillRect(x, y, w, h * 0.4); ctx.restore();
        roundRectPath(ctx, x + 1.5, y + 1.5, w - 3, h - 3, Math.max(2, r - 1));
        ctx.strokeStyle = 'rgba(255,140,60,0.10)'; ctx.lineWidth = 1.5; ctx.stroke();
        roundRectPath(ctx, x, y, w, h, r);
        ctx.strokeStyle = opts.stroke || 'rgba(255,180,120,0.10)'; ctx.lineWidth = 2; ctx.stroke();
    }
    // One additive cached-glow blit (caller owns composite='lighter' + reset).
    _hudGlow(ctx, x, y, r, color, alpha) {
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.drawImage(getGlowSprite(color), x - r, y - r, r * 2, r * 2);
    }
    // Recessed glass gutter drawn OUTSIDE the bar rect (geometry-neutral).
    _hudBarTrack(ctx, barLeft, barY, barW, barH) {
        roundRectPath(ctx, barLeft - 4, barY - 4, barW + 8, barH + 8, 12);
        ctx.fillStyle = 'rgba(10,8,10,0.7)'; ctx.fill();
        roundRectPath(ctx, barLeft - 4, barY - 4, barW + 8, barH + 8, 12);
        ctx.strokeStyle = 'rgba(255,180,120,0.10)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // Faint segment ticks over a bar (texture, clipped to the rounded rect).
    _hudBarTicks(ctx, barLeft, barY, barW, barH, n) {
        ctx.save();
        roundRectPath(ctx, barLeft, barY, barW, barH, Math.min(9, barH / 2)); ctx.clip();
        ctx.strokeStyle = 'rgba(0,0,0,0.26)'; ctx.lineWidth = 1;
        for (let i = 1; i < n; i++) {
            const x = barLeft + (barW * i) / n;
            ctx.beginPath(); ctx.moveTo(x, barY + 3); ctx.lineTo(x, barY + barH - 3); ctx.stroke();
        }
        ctx.restore();
    }
    // Small procedural heart sigil (HP fill-tip end-cap).
    _hudHeartSigil(ctx, x, y, size, tint) {
        const s = size / 2;
        ctx.save(); ctx.translate(x, y);
        ctx.beginPath();
        ctx.moveTo(0, s * 0.9);
        ctx.bezierCurveTo(-s * 1.3, -s * 0.3, -s * 0.5, -s * 1.1, 0, -s * 0.35);
        ctx.bezierCurveTo(s * 0.5, -s * 1.1, s * 1.3, -s * 0.3, 0, s * 0.9);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
        ctx.strokeStyle = tint; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.restore();
    }
    // Text with a cheap dark underlayer (crisp without per-frame shadowBlur).
    _textWithShadow(ctx, text, x, y, color) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText(text, x + 1.5, y + 1.5);
        ctx.fillStyle = color; ctx.fillText(text, x, y);
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
    // When the Alter token is also available, reroll + alter share the row as a
    // centered pair (`paired`), each half-width; otherwise reroll is centered.
    _agencyRowY() {
        const sa = this.renderer.safeArea;
        // Anchor above the bottom inset, but never lift into the card row
        // (cards aren't safe-area adjusted) — clamp to just below them.
        const cardBottom = (INTERNAL_HEIGHT - CARD_H) / 2 + 60 + CARD_H;
        return Math.max(cardBottom + 16, INTERNAL_HEIGHT - 150 - sa.bottom);
    }
    getRerollButtonRect(paired = false) {
        const y = this._agencyRowY();
        if (paired) return { x: INTERNAL_WIDTH / 2 - 240, y, w: 232, h: 68 };
        return { x: INTERNAL_WIDTH / 2 - 180, y, w: 360, h: 68 };
    }
    getAlterButtonRect(paired = false) {
        const y = this._agencyRowY();
        if (paired) return { x: INTERNAL_WIDTH / 2 - 240 + 232 + 16, y, w: 232, h: 68 };
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
        // Start / shop screen replaces the regular HUD entirely — now the
        // redesigned tabbed main menu (Play/Skills/Loadout/Character/Shop/
        // Battle Pass/Settings) drawn by MenuRenderer.
        if (gameState.screen === 'start') {
            this.menu.draw(ctx, gameState);
            return;
        }

        this._drawTopReadout(ctx, gameState);
        if (!gameState.gameOver && !gameState.upgradeChoices && !gameState.chestReward) {
            this._drawComboMeter(ctx, gameState);
        }
        this._drawWaveLabel(ctx, gameState);
        this._drawBossHpBar(ctx, gameState);
        if (!gameState.gameOver && !gameState.upgradeChoices && !gameState.chestReward) {
            this._drawBossArrow(ctx, gameState);
        }
        this._drawLoadoutChips(ctx, gameState);
        if (!gameState.gameOver && !gameState.upgradeChoices && !gameState.chestReward && !gameState.paused) {
            this._drawAbilityCooldowns(ctx, gameState);
        }
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
            this._drawBossWarning(ctx, gameState);
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
        // Framed glass cluster: timer · divider · KILLS · coins. Replaces the old
        // floating shadowBlur text (which was the HUD's one Canvas2D hotspot).
        const timer = formatTime(state.time);
        const killsVal = `${state.kills}`;
        const killsLbl = ' KILLS';
        const coinVal = `${state.runCoins ?? 0}`;
        const coinSprite = getCoinSprite();
        const coinW = coinSprite.width / SPRITE_SS, coinH = coinSprite.height / SPRITE_SS;
        const gap = 24, padX = 28;
        const measure = (tfont) => {
            ctx.font = `800 ${tfont}px ${MONO}`; const tw = ctx.measureText(timer).width;
            ctx.font = `800 22px ${FONT}`; const kv = ctx.measureText(killsVal).width;
            ctx.font = `700 16px ${FONT}`; const kl = ctx.measureText(killsLbl).width;
            ctx.font = `800 24px ${MONO}`; const cv = ctx.measureText(coinVal).width;
            const coinSeg = coinW + 8 + cv;
            return { tw, kv, kl, cv, coinSeg, content: tw + gap + 2 + gap + (kv + kl) + gap + coinSeg };
        };
        // Shrink the timer font (only) before the plate could reach the two
        // top-right buttons on a wide safe-area — never move the buttons.
        let tf = 50, mm = measure(tf);
        const leftmostBtn = INTERNAL_WIDTH - sa.right - 2 * (DEBUG_BUTTON_SIZE + DEBUG_BUTTON_MARGIN) - 16;
        // Hard ceiling: a centred plate whose half-width reaches leftmostBtn — so
        // the plate right edge can NEVER cross into the top-right buttons, even at
        // an absurd right safe-area (no floor that could override this).
        const maxPlateW = Math.max(0, 2 * (leftmostBtn - cx));
        while (tf > 40 && (padX * 2 + mm.content) > maxPlateW) { tf -= 2; mm = measure(tf); }
        const plateW = Math.min(maxPlateW, padX * 2 + mm.content);
        const plateH = 84, plateY = sa.top + 8, plateX = cx - plateW / 2;
        this._hudGlassPlate(ctx, plateX, plateY, plateW, plateH, 20);
        // Clip the content to the plate so, in the degenerate too-narrow case, the
        // (fixed-width) kills/coin segments can't spill past the plate → buttons.
        ctx.save();
        roundRectPath(ctx, plateX, plateY, plateW, plateH, 20); ctx.clip();
        const midY = plateY + plateH / 2;
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        let x = plateX + padX;
        // Timer (warm under-glow instead of shadowBlur).
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        this._hudGlow(ctx, x + mm.tw / 2, midY, 82, '#ff7a1e', 0.10);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.restore();
        ctx.font = `800 ${tf}px ${MONO}`;
        this._textWithShadow(ctx, timer, x, midY, '#fff');
        x += mm.tw + gap;
        // Divider.
        ctx.fillStyle = 'rgba(255,180,120,0.18)'; ctx.fillRect(x, midY - plateH * 0.25, 2, plateH * 0.5);
        x += 2 + gap;
        // Kills.
        ctx.font = `800 22px ${FONT}`; this._textWithShadow(ctx, killsVal, x, midY, '#fff'); x += mm.kv;
        ctx.font = `700 16px ${FONT}`; this._textWithShadow(ctx, killsLbl, x, midY, 'rgba(255,255,255,0.62)'); x += mm.kl + gap;
        // Coin.
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        this._hudGlow(ctx, x + coinW / 2, midY, 34, '#ffd86b', 0.12);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.restore();
        ctx.drawImage(coinSprite, x, midY - coinH / 2, coinW, coinH); x += coinW + 8;
        ctx.font = `800 24px ${MONO}`; this._textWithShadow(ctx, coinVal, x, midY, '#ffd166');
        ctx.restore();   // content clip
        ctx.restore();   // method save
    }

    // Kill-streak meter: an escalating, color-shifting counter under the timer
    // with a draining window bar. Pops in scale on each milestone tier and
    // pulses faster the hotter the streak — the core "keep going" feedback.
    _drawComboMeter(ctx, state) {
        const combo = state.combo ?? 0;
        if (combo < (COMBO.minToShow ?? 3)) return;
        const sa = this.renderer.safeArea;
        // Anchored to the upper-RIGHT (right-aligned), below the debug/pause
        // buttons, so it never collides with the center timer/wave/boss stack.
        const rx = INTERNAL_WIDTH - sa.right - 40;
        const y = sa.top + 150;
        // Pick the hottest tier the streak has reached.
        let color = COMBO.tiers[0].color;
        for (const t of COMBO.tiers) if (combo >= t.at) color = t.color;
        const frac = state.comboWindow > 0 ? Math.max(0, Math.min(1, (state.comboTimer ?? 0) / state.comboWindow)) : 0;
        // Subtle pulse that quickens with the streak size.
        const pulse = 1 + 0.06 * Math.sin((state.time ?? 0) * (6 + combo * 0.05));
        ctx.save();
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.fillStyle = color;
        ctx.font = `900 ${Math.round(34 * pulse)}px ${FONT}`;
        ctx.fillText(`${combo}× STREAK`, rx, y);
        ctx.shadowBlur = 0;
        // Draining window bar beneath the text (right-aligned).
        const barW = 168, barH = 6, bx = rx - barW, by = y + 22;
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(bx, by, barW, barH);
        ctx.fillStyle = color;
        ctx.fillRect(bx + barW * (1 - frac), by, barW * frac, barH);
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
        // Pressure meter: a slim bar that fills + reddens as the field piles up
        // and you're not clearing fast enough. Hidden when calm.
        const p = clamp01(state.wavePressure ?? 0);
        if (p > 0.04) {
            const barW = 240, barH = 7;
            const bx = (INTERNAL_WIDTH - barW) / 2;
            const by = sa.top + 140;
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            roundRectPath(ctx, bx, by, barW, barH, 3);
            ctx.fill();
            // Calm → tense color ramp (amber → red).
            const rC = Math.round(255);
            const gC = Math.round(180 * (1 - p) + 40 * p);
            const bC = Math.round(70 * (1 - p));
            ctx.fillStyle = `rgb(${rC}, ${gC}, ${bC})`;
            roundRectPath(ctx, bx, by, barW * p, barH, 3);
            ctx.fill();
            if (p > 0.7) {
                // Label ABOVE the bar so it never collides with the boss HP bar
                // that sits just below this band.
                ctx.textBaseline = 'bottom';
                ctx.fillStyle = `rgba(255,90,60,${0.5 + 0.3 * Math.sin(performanceNowSafe() * 0.008)})`;
                ctx.font = `bold 13px ${FONT}`;
                ctx.fillText('PRESSURE', INTERNAL_WIDTH / 2, by - 3);
                ctx.textBaseline = 'top';
            }
        }
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
        // Tier + epithet line above the name: colored difficulty pips and the
        // boss's title, so the threat tier reads at a glance during the fight.
        const tierMeta = BOSS_TIERS[boss.tier];
        if (tierMeta || boss.epithet) {
            const pips = tierMeta ? '◆'.repeat(tierMeta.pips) + '◇'.repeat(3 - tierMeta.pips) : '';
            const parts = [];
            if (tierMeta) parts.push(`${pips} ${tierMeta.label}`);
            if (boss.epithet) parts.push(boss.epithet);
            ctx.fillStyle = tierMeta ? tierMeta.color : 'rgba(255,225,210,0.85)';
            ctx.font = `italic 16px ${FONT}`;
            ctx.fillText(parts.join('  ·  '), INTERNAL_WIDTH / 2, padTop - 30);
        }
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
        // Chest source is supersampled (SPRITE_SS×) — derive logical size so
        // the overlay sprite isn't drawn 2× too big.
        const chestW = (sprite.width / SPRITE_SS) * scale;
        const chestH = (sprite.height / SPRITE_SS) * scale;
        ctx.drawImage(
            sprite,
            chestX - chestW / 2 + shakeX,
            chestY - chestH / 2 + shakeY,
            chestW,
            chestH
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

        // Optional per-event accent (gold by default) so a boss kill or a
        // weapon evolution reads distinctly from a routine wave shout.
        const accent = ann.color || '#ffd166';
        const rgb = hexToRgbTriplet(accent);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgba(20, 18, 8, 0.78)';
        roundRectPath(ctx, panelX, panelY, panelW, panelH, 18);
        ctx.fill();
        ctx.strokeStyle = `rgba(${rgb}, 0.55)`;
        ctx.lineWidth = 3;
        ctx.stroke();

        // Accent line sweeps across as it settles.
        const sweep = easeOutCubic(clamp01(t / (fadeIn * 1.6)));
        ctx.strokeStyle = `rgba(${rgb}, 0.85)`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(panelX + 30, panelY + panelH - 16);
        ctx.lineTo(panelX + 30 + (panelW - 60) * sweep, panelY + panelH - 16);
        ctx.stroke();

        ctx.fillStyle = accent;
        ctx.font = `bold 48px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ann.text, INTERNAL_WIDTH / 2, centerY);
        ctx.restore();
    }

    // Off-screen boss locator: when the active boss is outside the viewport,
    // pin an arrow to the screen edge pointing toward it (with distance), so
    // the player always knows where to go after the arena reset.
    _drawBossArrow(ctx, state) {
        const boss = state.activeBoss;
        const cam = state.camera;
        if (!boss || !cam || boss.x == null) return;
        const cx = INTERNAL_WIDTH / 2;
        const cy = INTERNAL_HEIGHT / 2;
        const sx = (boss.x - cam.x) + cx;
        const sy = (boss.y - cam.y) + cy;
        const margin = 70;
        // On-screen → the HP bar + sprite are enough; no arrow.
        if (sx >= margin && sx <= INTERNAL_WIDTH - margin && sy >= margin && sy <= INTERNAL_HEIGHT - margin) return;
        const ang = Math.atan2(sy - cy, sx - cx);
        // Clamp the arrow onto an inset screen rectangle along that direction.
        const insetX = INTERNAL_WIDTH / 2 - margin;
        const insetY = INTERNAL_HEIGHT / 2 - margin;
        const ux = Math.cos(ang), uy = Math.sin(ang);
        const t = Math.min(
            Math.abs(insetX / (ux || 1e-6)),
            Math.abs(insetY / (uy || 1e-6))
        );
        const ax = cx + ux * t;
        const ay = cy + uy * t;
        const dist = Math.round(Math.hypot(boss.x - cam.x, boss.y - cam.y));
        const pulse = 0.6 + 0.4 * Math.sin(performanceNowSafe() * 0.008);
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(ang);
        // Arrowhead.
        ctx.fillStyle = `rgba(255,80,60,${pulse})`;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(26, 0);
        ctx.lineTo(-14, -18);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-14, 18);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        // Distance label, just inside the arrow.
        ctx.save();
        ctx.fillStyle = 'rgba(255,200,190,0.9)';
        ctx.font = `bold 18px ${MONO}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lx = cx + ux * (t - 40);
        const ly = cy + uy * (t - 40);
        ctx.fillText(`${dist}`, lx, ly);
        ctx.restore();
    }

    // "BOSS INCOMING" warning: a pulsing red edge tint + centered banner + the
    // boss's name + a countdown bar, giving the player a few seconds to
    // reposition before the boss lands. Drawn over the world, under overlays.
    _drawBossWarning(ctx, state) {
        const bw = state.bossWarning;
        if (!bw) return;
        const t = clamp01(bw.t);
        const pulse = 0.5 + 0.5 * Math.sin(performanceNowSafe() * 0.012);
        ctx.save();
        // Red vignette pulsing from the edges.
        const cx = INTERNAL_WIDTH / 2;
        const cy = INTERNAL_HEIGHT / 2;
        const maxR = Math.hypot(cx, cy);
        const g = ctx.createRadialGradient(cx, cy, maxR * 0.45, cx, cy, maxR);
        g.addColorStop(0, 'rgba(190,0,20,0)');
        g.addColorStop(1, `rgba(200,10,25,${0.28 + 0.22 * pulse})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
        // Banner.
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const by = INTERNAL_HEIGHT * 0.42;
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 12;
        ctx.fillStyle = `rgba(255,${Math.round(60 + 40 * pulse)},${Math.round(50 + 30 * pulse)},1)`;
        ctx.font = `bold 60px ${FONT}`;
        ctx.fillText('⚠  BOSS INCOMING  ⚠', cx, by);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.font = `bold 40px ${FONT}`;
        ctx.fillText(bw.name, cx, by + 58);
        let cursorY = by + 58;
        // Epithet subtitle (the boss's title), dimmer + italic.
        if (bw.epithet) {
            cursorY += 38;
            ctx.fillStyle = 'rgba(255,225,210,0.82)';
            ctx.font = `italic 26px ${FONT}`;
            ctx.fillText(bw.epithet, cx, cursorY);
        }
        // Difficulty tier badge: a colored label + pips so the threat level
        // reads instantly (SKIRMISHER / WARLORD / APEX).
        const tierMeta = BOSS_TIERS[bw.tier];
        if (tierMeta) {
            cursorY += 40;
            const pips = '◆'.repeat(tierMeta.pips) + '◇'.repeat(3 - tierMeta.pips);
            ctx.fillStyle = tierMeta.color;
            ctx.font = `bold 24px ${FONT}`;
            ctx.fillText(`${pips}  TIER ${bw.tier} · ${tierMeta.label}  ${pips}`, cx, cursorY);
        }
        // Countdown bar (fills as the boss approaches).
        const barW = 360, barH = 8;
        const bx = cx - barW / 2;
        const yy = cursorY + 36;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        roundRectPath(ctx, bx, yy, barW, barH, 4);
        ctx.fill();
        ctx.fillStyle = '#ff5a3c';
        roundRectPath(ctx, bx, yy, barW * t, barH, 4);
        ctx.fill();
        ctx.restore();
    }

    // Ability cooldown pips (bottom-right). Each owned ability shows a radial
    // recharge: a dark wedge shrinks clockwise as it cools, the remaining
    // seconds sit in the center, and a ready ability gets a bright pulsing
    // ring + its initial. Readable at 1920×1080 and within iPhone safe-area.
    _drawAbilityCooldowns(ctx, state) {
        const list = state.abilityCooldowns;
        if (!list || list.length === 0) return;
        const sa = this.renderer.safeArea;
        const R = 30;
        const gap = 22;
        const cy = INTERNAL_HEIGHT - sa.bottom - 104;
        let cx = INTERNAL_WIDTH - sa.right - 56 - R;
        const now = performanceNowSafe();
        ctx.save();
        ctx.textAlign = 'center';
        for (let i = list.length - 1; i >= 0; i--) {
            const a = list[i];
            const frac = a.ready ? 0 : clamp01(a.remaining / a.total);
            // Base disc.
            ctx.beginPath();
            ctx.arc(cx, cy, R, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(12, 16, 24, 0.82)';
            ctx.fill();
            // Colored ring (bright when ready, dim while cooling).
            ctx.lineWidth = 4;
            ctx.globalAlpha = a.ready ? 1 : 0.5;
            ctx.strokeStyle = a.color;
            ctx.beginPath();
            ctx.arc(cx, cy, R, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.textBaseline = 'middle';
            if (a.ready) {
                const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
                ctx.fillStyle = a.color;
                ctx.globalAlpha = 0.18 + 0.16 * pulse;
                ctx.beginPath();
                ctx.arc(cx, cy, R - 3, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.fillStyle = '#fff';
                ctx.font = `bold 22px ${FONT}`;
                ctx.fillText(a.name[0], cx, cy + 1);
            } else {
                // Dark wedge over the remaining fraction (clockwise from top).
                ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                const start = -Math.PI / 2;
                ctx.arc(cx, cy, R - 2, start, start + Math.PI * 2 * frac);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.font = `bold 22px ${MONO}`;
                ctx.fillText(a.remaining >= 1 ? String(Math.ceil(a.remaining)) : a.remaining.toFixed(1), cx, cy + 1);
            }
            // Short name beneath.
            ctx.fillStyle = 'rgba(255, 255, 255, 0.62)';
            ctx.font = `600 14px ${FONT}`;
            ctx.textBaseline = 'top';
            const nm = a.name.length > 11 ? a.name.slice(0, 10) + '…' : a.name;
            ctx.fillText(nm, cx, cy + R + 5);
            cx -= (R * 2 + gap);
        }
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

        const midY = barY + layout.barH / 2;
        ctx.save();
        // Low-HP frame glow (additive, same 9Hz pulse as the border).
        if (target < 0.3) {
            const lp = 0.5 + 0.5 * Math.sin(state.time * 9);
            ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.10 + 0.10 * lp;
            ctx.drawImage(getGlowSprite('#ff5a4a'), barLeft - 24, barY - 24, barW + 48, layout.barH + 48);
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.restore();
        }
        // Glass gutter + fill + segment ticks.
        this._hudBarTrack(ctx, barLeft, barY, barW, layout.barH);
        drawStatBar(ctx, barLeft, barY, barW, layout.barH, target, fill, {
            radius: 9,
            chip: this.dispHpRatio,
            chipColor: 'rgba(255, 90, 90, 0.5)',
            border,
            borderWidth: 2,
        });
        this._hudBarTicks(ctx, barLeft, barY, barW, layout.barH, 10);
        // Heart end-cap riding the fill tip (tinted to the HP band).
        if (target > 0.02) {
            const capX = Math.max(barLeft + 9, Math.min(barRight - 9, barLeft + barW * target));
            const tint = target < 0.3 ? '#ff5a4a' : target < 0.6 ? '#ff8a3a' : '#74e890';
            const lp = 0.5 + 0.5 * Math.sin(state.time * 9);
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            this._hudGlow(ctx, capX, midY, 22, tint, 0.30 + (target < 0.3 ? 0.25 * lp : 0));
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.restore();
            this._hudHeartSigil(ctx, capX, midY, 18, tint);
        }
        // Gold label + readout pill.
        ctx.font = `bold 30px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        this._textWithShadow(ctx, 'HP', layout.padL, midY, '#ffce7a');
        this._hudGlassPlate(ctx, barRight + 8, barY - 4, layout.readoutW - 16, layout.barH + 8, 10, { stroke: 'rgba(255,180,120,0.12)' });
        ctx.font = `22px ${MONO}`;
        this._textWithShadow(ctx, `${Math.ceil(state.player.hp)} / ${state.player.maxHp}`, barRight + 20, midY, '#fff');
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
        // Fire a self-clearing flash when the level ticks up (not on frame 0).
        if (this._lastLevel != null && state.player.level > this._lastLevel) this._xpFlash = state.time;
        this._lastLevel = state.player.level;

        const midY = barY + layout.barH / 2;
        ctx.save();
        // Glass gutter + fill (cool blue — a hard hue split from the warm HP) + ticks.
        this._hudBarTrack(ctx, barLeft, barY, barW, layout.barH);
        drawStatBar(ctx, barLeft, barY, barW, layout.barH, this.dispXpRatio,
            { from: '#3aa8ff', to: '#7fdcff' },
            { radius: 9, border: 'rgba(255,255,255,0.42)', borderWidth: 2 });
        this._hudBarTicks(ctx, barLeft, barY, barW, layout.barH, 10);
        // Leading-edge comet (clipped so it can't spill past the rounded caps).
        if (this.dispXpRatio > 0.01 && this.dispXpRatio < 0.995) {
            ctx.save();
            roundRectPath(ctx, barLeft - 6, barY - 12, barW + 12, layout.barH + 24, 12); ctx.clip();
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6;
            const ex = barLeft + barW * this.dispXpRatio;
            ctx.drawImage(getGlowSprite('#bfe8ff'), ex - 22, barY - 12, 44, layout.barH + 24);
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.restore();
        }
        // Level-up flash (0.5s, self-clearing).
        if (this._xpFlash >= 0 && (state.time - this._xpFlash) < 0.5) {
            const fa = (1 - (state.time - this._xpFlash) / 0.5) * 0.5;
            ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = fa;
            ctx.drawImage(getGlowSprite('#ffd06a'), barLeft - 30, barY - 20, barW + 60, layout.barH + 40);
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.restore();
        }
        // LV badge chip (within the label slot).
        this._hudGlassPlate(ctx, layout.padL - 2, barY - 4, 118, layout.barH + 8, 10);
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.font = `700 15px ${FONT}`;
        this._textWithShadow(ctx, 'LV', layout.padL + 12, midY, 'rgba(255,255,255,0.62)');
        const numX = layout.padL + 44;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        this._hudGlow(ctx, numX + 14, midY, 20, '#ffd06a', 0.14);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.restore();
        ctx.font = `800 26px ${MONO}`;
        this._textWithShadow(ctx, `${state.player.level}`, numX, midY, '#ffd06a');
        // Readout pill.
        this._hudGlassPlate(ctx, barRight + 8, barY - 4, layout.readoutW - 16, layout.barH + 8, 10, { stroke: 'rgba(255,180,120,0.12)' });
        ctx.font = `22px ${MONO}`;
        this._textWithShadow(ctx, `${Math.floor(state.player.xp)} / ${state.player.xpToNext}`, barRight + 20, midY, '#fff');
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
            `BOLTS   ${state.projectileCount} +${state.enemyProjectileCount ?? 0}e`,
            `PARTICLE ${state.particleCount ?? 0}`,
            `PICKUPS ${state.pickupCount ?? 0}`,
            `HAZARDS ${state.hazardCount ?? 0}`,
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
            `min     ${(state.minute ?? 0).toFixed(1)}   enemy× hp${(state.enemyHpMul ?? 1).toFixed(2)} sp${(state.enemySpeedMul ?? 1).toFixed(2)} dmg${(state.enemyDamageMul ?? 1).toFixed(2)}`,
            `boss#   ${state.bossActiveCount ?? 0}` +
                (state.activeBoss ? `  ${state.activeBoss.name}` : ''),
            `boss=>  ${state.bossStatus ? state.bossStatus.state.toUpperCase() : '?'}` +
                (state.bossStatus ? `  in ${state.bossStatus.secondsUntil.toFixed(0)}s` : ''),
            `bossHP× ${(state.bossHpMul ?? 1).toFixed(2)}   resist ${Math.round((state.bossResist ?? 0) * 100)}%`,
            `dmg×    ${(state.playerDamageMul ?? 1).toFixed(2)}   cd× ${(state.playerCooldownMul ?? 1).toFixed(2)}`,
            `spd     ${Math.round(state.playerSpeed ?? 0)}   xp× ${(state.playerXpMul ?? 1).toFixed(2)}`,
            `pickup  ${Math.round(state.playerPickupRange ?? 0)}   heal/s≤ ${state.healPerSecondCap ?? '?'}`,
            `wpns    ${state.ownedWeaponCount ?? 0} (${state.evolvedWeaponCount ?? 0} evo)`,
            `aura    ${state.auraStyle || '-'}  i${(state.auraIntensity ?? 0).toFixed(2)} r${Math.round(state.auraRadius ?? 0)}`,
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

        // Keystone breadcrumb — a legible hint, above the title, of any capstone
        // that's one recipe piece short (so players know what to build toward).
        const hints = state.keystoneHints;
        if (Array.isArray(hints) && hints.length) {
            ctx.globalAlpha = bg;
            ctx.fillStyle = '#ff8fa3'; // mythic-keystone tint
            ctx.font = `700 26px ${FONT}`;
            const txt = hints.map((h) => `${h.name} — needs ${h.need}`).join('     ◈     ');
            ctx.fillText(`◈ KEYSTONE WITHIN REACH ◈   ${txt}`, INTERNAL_WIDTH / 2, 140);
            ctx.globalAlpha = 1;
        }

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

        // Reroll + Alter buttons + remaining charges (only when available). When
        // both are present they render as a centered pair sharing the row.
        ctx.globalAlpha = bg;
        const rerolls = state.rerolls ?? 0;
        const alters = state.alters ?? 0;
        const paired = rerolls > 0 && alters > 0;
        if (rerolls > 0) {
            const rr = this.getRerollButtonRect(paired);
            const press = this._pressAmt(state, 'reroll');
            this._drawSummaryButton(ctx, rr, `REROLL  (${rerolls})`, '#c97bff',
                'rgba(201, 123, 255, 0.18)', press, false);
        }
        if (alters > 0) {
            const ar = this.getAlterButtonRect(paired);
            const press = this._pressAmt(state, 'alter');
            this._drawSummaryButton(ctx, ar, `ALTER  (${alters})`, '#5fd0c4',
                'rgba(95, 208, 196, 0.18)', press, false);
        }

        ctx.globalAlpha = bg;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = `24px ${FONT}`;
        let hint = 'Tap a card  •  1 / 2 / 3';
        if (rerolls > 0) hint += '  •  R reroll';
        if (alters > 0) hint += '  •  A alter';
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

    // A 4-point sparkle (filled diamond + thin cross) for reward flourishes.
    _sparkle(ctx, cx, cy, r, color, alpha = 1) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.32, cy); ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r * 0.32, cy); ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx - r, cy); ctx.lineTo(cx, cy - r * 0.32); ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r * 0.32); ctx.closePath(); ctx.fill();
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
            ['Objectives', `${state.objectivesDone ?? 0}/${state.objectivesTotal ?? 0}`],
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

        // Reward lines — celebrate what this run newly earned: completed daily
        // trials, unlocked achievements, and any cosmetics those achievements
        // granted (the grind payoff). Stacked + pulsing; the loadout lists below
        // shift down only when more than one reward type fires (usually 0–1).
        const rewardLines = [];
        if (Array.isArray(summary.dailies) && summary.dailies.length)
            rewardLines.push({ text: `✦ DAILY TRIAL — ${summary.dailies.join('  ·  ')} ✦`, color: '#5fe87a' });
        if (Array.isArray(summary.achievements) && summary.achievements.length)
            rewardLines.push({ text: `★ ACHIEVEMENT — ${summary.achievements.join('  ·  ')} ★`, color: '#ffce54' });
        if (Array.isArray(summary.cosmeticUnlocks) && summary.cosmeticUnlocks.length)
            rewardLines.push({ text: `🎁 COSMETIC UNLOCKED — ${summary.cosmeticUnlocks.join('  ·  ')}`, color: '#c08bff', cosmetic: true });
        const rewardBase = statsStartY + Math.ceil(stats.length / 2) * lineH + 52;
        if (rewardLines.length) {
            const pulse = 0.7 + 0.3 * ((Math.sin(age * 5) + 1) / 2);
            ctx.save();
            ctx.textAlign = 'center';
            for (let i = 0; i < rewardLines.length; i++) {
                const ly = rewardBase + i * 30;
                const cos = rewardLines[i].cosmetic;
                ctx.font = `bold ${cos ? 27 : 25}px ${FONT}`;
                ctx.globalAlpha = tailT * pulse;
                ctx.fillStyle = rewardLines[i].color;
                if (cos) {
                    // The cosmetic-unlock line pops in with a bouncy scale + a pair
                    // of twinkling sparkles — the grind payoff deserves a flourish.
                    const sc = 0.55 + 0.45 * easeOutBack(tailT);
                    const w = ctx.measureText(rewardLines[i].text).width;
                    ctx.save();
                    ctx.translate(INTERNAL_WIDTH / 2, ly);
                    ctx.scale(sc, sc);
                    ctx.fillText(rewardLines[i].text, 0, 0);
                    ctx.restore();
                    for (let sgn = -1; sgn <= 1; sgn += 2) {
                        const tw = 0.5 + 0.5 * Math.sin(age * 6 + sgn * 1.7);
                        this._sparkle(ctx, INTERNAL_WIDTH / 2 + sgn * (w * sc / 2 + 30), ly - 7,
                            6 + 5 * tw, rewardLines[i].color, tailT * (0.5 + 0.5 * tw));
                    }
                } else {
                    ctx.fillText(rewardLines[i].text, INTERNAL_WIDTH / 2, ly);
                }
            }
            ctx.restore();
        }

        const listY = statsStartY + Math.ceil(stats.length / 2) * lineH + 80
            + Math.max(0, rewardLines.length - 1) * 30;
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
        // Coin source is supersampled (SPRITE_SS×) — draw at logical size.
        const cW = coinSprite.width / SPRITE_SS;
        const cH = coinSprite.height / SPRITE_SS;
        ctx.drawImage(coinSprite, iconX, iconY - cH / 2, cW, cH);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(totalLabel, iconX + cW + 6, iconY);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `22px ${FONT}`;
        ctx.fillText(
            'The Gloam ate the world. Kindle blessings — they burn on into every vigil.',
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
            // Coin source is supersampled (SPRITE_SS×) — draw at logical size.
            const csW = coinSprite.width / SPRITE_SS;
            const csH = coinSprite.height / SPRITE_SS;
            ctx.drawImage(coinSprite, r.x + r.w - 38, r.y + r.h / 2 - 14 - csH / 2, csW, csH);
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

// '#rrggbb' (or '#rgb') → 'r, g, b' for use in rgba() strings.
function hexToRgbTriplet(hex) {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    if (!Number.isFinite(n)) return '255, 209, 102';
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
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
