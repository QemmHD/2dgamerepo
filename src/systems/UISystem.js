import {
    INTERNAL_WIDTH,
    INTERNAL_HEIGHT,
    GAME_TITLE,
    CHEST,
    SPRITE_SS,
    COMBO,
    BOSS_TIERS,
    DEV_MODE,
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
import { getRarityIcon } from '../assets/CustomIcons.js';
import { MenuRenderer } from './MenuRenderer.js';
import { computeHUDLayout } from './HUDLayout.js';
import { DISPLAY_FONT } from '../assets/MenuFont.js';
import { battlePassRunReceipt } from './BattlePassSystem.js';
import { normalizeUiScale, uiScaleFactor } from './AccessibilityPreferences.js';

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
const LOCATOR_ARC_COUNT = 4;
const LOCATOR_ARC_OFFSET = 0.18;
const LOCATOR_ARC_SWEEP = Math.PI / 2 - LOCATOR_ARC_OFFSET * 2;

// Pixel-measured fitting shared by the command rail and ability labels. Reduce
// within the authored type range first, then ellipsize at the minimum size; the
// returned width is always measured using the exact font left on the context.
export function fitHudLabel(ctx, value, maxWidth, options = {}) {
    const original = String(value ?? '');
    const limit = Math.max(0, Number.isFinite(maxWidth) ? maxWidth : 0);
    const weight = options.weight ?? 600;
    const family = options.family || FONT;
    const requested = Math.max(1, Math.floor(Number(options.size) || 1));
    const minimum = Math.max(1, Math.min(requested, Math.floor(Number(options.minSize) || requested)));
    let fontSize = requested;
    const setFont = () => { ctx.font = `${weight} ${fontSize}px ${family}`; };
    setFont();
    let width = ctx.measureText(original).width;
    while (fontSize > minimum && width > limit) {
        fontSize--;
        setFont();
        width = ctx.measureText(original).width;
    }
    if (width <= limit) return { text: original, fontSize, width, truncated: false };

    const ellipsis = '\u2026';
    const ellipsisWidth = ctx.measureText(ellipsis).width;
    if (ellipsisWidth > limit) return { text: '', fontSize, width: 0, truncated: true };
    let low = 0;
    let high = original.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const candidate = `${original.slice(0, mid).trimEnd()}${ellipsis}`;
        if (ctx.measureText(candidate).width <= limit) low = mid;
        else high = mid - 1;
    }
    const text = `${original.slice(0, low).trimEnd()}${ellipsis}`;
    width = ctx.measureText(text).width;
    return { text, fontSize, width, truncated: true };
}

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
        this._activeUiScale = 1;
        this._highContrast = false;
        // Reused, allocation-free render receipt for visual regression tooling.
        // A surface is true only when its real draw method completed this frame.
        this._lastDrawReceipt = {
            objective: false,
            objectiveVariant: 'hidden',
            objectiveTextComplete: false,
            pause: false,
            gameOver: false,
        };

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

    _layoutFor(state) {
        // cssWidth is the physical CSS footprint of the fixed 1920-wide game.
        // Below tablet width, increase logical sizes and use the touch-safe
        // top-left cockpit even if a coarse pointer was not reported.
        const cssW = this.renderer.cssWidth || INTERNAL_WIDTH;
        const compact = !!state.touchMode || cssW < 1100;
        return computeHUDLayout({
            width: INTERNAL_WIDTH,
            height: INTERNAL_HEIGHT,
            safeArea: this.renderer.safeArea,
            touchMode: !!state.touchMode,
            compact,
            hasBoss: !!state.activeBoss,
            hasLieutenant: !!state.activeLieutenant,
            hasBossRush: !!state.bossRush,
            loadoutCount: (state.ownedWeapons?.length ?? 0) + (state.ownedPassives?.length ?? 0),
            relicCount: state.runRelics?.length ?? 0,
            abilityCount: state.abilityCooldowns?.length ?? 0,
            hasObjective: !!state.runObjective,
            hasVigil: !!state.vigilTracker && !state.runObjective,
            uiScale: normalizeUiScale(state.saveData?.settings?.uiScale),
            cssScale: cssW / INTERNAL_WIDTH,
        });
    }

    _uiPx(value) {
        return Math.max(1, Math.round(value * this._activeUiScale));
    }

    getHUDLayout(state) {
        return this._layoutFor(state);
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
        if (this._highContrast && typeof ctx.strokeText === 'function') {
            ctx.save();
            ctx.lineJoin = 'round';
            ctx.strokeStyle = '#050505'; ctx.lineWidth = 6;
            ctx.strokeText(text, x, y);
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
            ctx.strokeText(text, x, y);
            ctx.fillStyle = color; ctx.fillText(text, x, y);
            ctx.restore();
            return;
        }
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

    // EMBERGLASS: SHARE CARD button, bottom-right (below the minted-card
    // thumbnail), clear of the centered RESTART / RETURN TO SHOP row.
    getShareCardButtonRect() {
        return {
            x: INTERNAL_WIDTH - 300 - 70,
            y: INTERNAL_HEIGHT - 180 - this.renderer.safeArea.bottom,
            w: 300,
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
    // EMBERGLASS: enter the Keeper's Lens from the pause overlay.
    getPauseLensRect() {
        return { x: INTERNAL_WIDTH / 2 - 240, y: INTERNAL_HEIGHT / 2 + 242, w: 480, h: 64 };
    }

    // EMBERGLASS photo-mode toolbar: bottom-center pill row + top-right zoom
    // controls. Returned as {id, rect} so Game can hit-test each.
    getPhotoToolbarRects() {
        const bw = 160, bh = 72, gap = 16;
        const ids = ['snap', 'filter', 'grid', 'hud', 'exit'];
        const total = ids.length * bw + (ids.length - 1) * gap;
        let x = INTERNAL_WIDTH / 2 - total / 2;
        const y = INTERNAL_HEIGHT - bh - 90 - this.renderer.safeArea.bottom;
        const rects = ids.map((id) => { const r = { id, rect: { x, y, w: bw, h: bh } }; x += bw + gap; return r; });
        const zy = 40 + this.renderer.safeArea.top, zs = 60;
        rects.push({ id: 'zoomOut', rect: { x: INTERNAL_WIDTH - 300, y: zy, w: zs, h: zs } });
        rects.push({ id: 'zoomIn', rect: { x: INTERNAL_WIDTH - 90, y: zy, w: zs, h: zs } });
        return rects;
    }

    // Draw the Lens toolbar (called directly by Game.render in photo mode).
    drawPhotoToolbar(ctx, pm, zoom, toast, filterName) {
        const fade = Math.min(1, (pm.toolbarFade ?? 0) / 0.4);   // fade over the last 0.4s idle
        const rects = this.getPhotoToolbarRects();
        const labelFor = { snap: 'SNAP', filter: 'FILTER', grid: pm.gridOn ? 'GRID ✓' : 'GRID',
            hud: pm.hudShown ? 'HUD ✓' : 'HUD', exit: 'EXIT', zoomOut: '−', zoomIn: '+' };
        ctx.save();
        ctx.globalAlpha = fade;
        // Active filter name, captioned above the row.
        if (filterName) {
            ctx.fillStyle = '#ffd166';
            ctx.font = `600 24px ${DISPLAY_FONT}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(String(filterName).toUpperCase(), INTERNAL_WIDTH / 2, rects[0].rect.y - 22);
        }
        for (const b of rects) {
            const r = b.rect;
            const primary = b.id === 'snap';
            ctx.fillStyle = primary ? 'rgba(255, 154, 74, 0.24)' : 'rgba(14, 9, 10, 0.82)';
            if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 12); ctx.fill(); }
            else ctx.fillRect(r.x, r.y, r.w, r.h);
            ctx.lineWidth = 2;
            ctx.strokeStyle = primary ? '#ffce5c' : 'rgba(255, 154, 74, 0.6)';
            if (ctx.roundRect) ctx.stroke(); else ctx.strokeRect(r.x, r.y, r.w, r.h);
            ctx.fillStyle = primary ? '#ffe08a' : '#efe0c4';
            ctx.font = `600 ${b.id === 'zoomOut' || b.id === 'zoomIn' ? 34 : 26}px ${DISPLAY_FONT}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(labelFor[b.id] || b.id, r.x + r.w / 2, r.y + r.h / 2 + 1);
        }
        // Zoom readout between the −/+ buttons.
        ctx.fillStyle = '#ffd166';
        ctx.font = `600 30px ${DISPLAY_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${(zoom || 1).toFixed(2)}×`, INTERNAL_WIDTH - 195, 40 + this.renderer.safeArea.top + 30);
        ctx.restore();
        // Toast (full alpha, above the toolbar row).
        if (toast && toast.text) {
            const a = Math.min(1, (toast.timer ?? 0) / 0.4);
            ctx.save();
            ctx.globalAlpha = a;
            ctx.font = `600 30px ${DISPLAY_FONT}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const w = ctx.measureText(toast.text).width + 64;
            const bx = INTERNAL_WIDTH / 2 - w / 2, by = rects[0].rect.y - 78, th = 60;
            ctx.fillStyle = 'rgba(20, 12, 10, 0.92)';
            ctx.fillRect(bx, by, w, th);
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#ff9a4a';
            ctx.strokeRect(bx, by, w, th);
            ctx.fillStyle = '#ffd166';
            ctx.fillText(toast.text, INTERNAL_WIDTH / 2, by + th / 2 + 1);
            ctx.restore();
        }
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
        const receipt = this._lastDrawReceipt;
        receipt.objective = false;
        receipt.objectiveVariant = 'hidden';
        receipt.objectiveTextComplete = false;
        receipt.pause = false;
        receipt.gameOver = false;
        this._activeUiScale = uiScaleFactor(gameState.saveData?.settings?.uiScale);
        this._highContrast = gameState.saveData?.settings?.highContrast === true;
        this._reducedEffects = gameState.saveData?.settings?.reducedEffects === true;
        // Start / shop screen replaces the regular HUD entirely — now the
        // redesigned tabbed main menu (Play/Skills/Loadout/Character/Shop/
        // Battle Pass/Settings) drawn by MenuRenderer.
        if (gameState.screen === 'start') {
            this.menu.draw(ctx, gameState);
            return;
        }

        const hud = this._layoutFor(gameState);
        this._drawCommandRail(ctx, gameState, hud);
        if (!gameState.gameOver && !gameState.upgradeChoices && !gameState.chestReward && !gameState.altar) {
            this._drawComboMeter(ctx, gameState, hud);
        }
        if (!gameState.gameOver && !gameState.upgradeChoices && !gameState.chestReward
            && !gameState.altar && !gameState.paused && !gameState.victory
            && !gameState.waveAnnouncement) {
            receipt.objective = this._drawRunObjectiveCard(ctx, gameState, hud) === true;
        }
        this._drawBossPlate(ctx, gameState, hud);
        this._drawLieutenantBar(ctx, gameState, hud);
        if (!gameState.gameOver && !gameState.upgradeChoices && !gameState.chestReward && !gameState.altar) {
            this._drawBossArrow(ctx, gameState);
        }
        this._drawLoadoutChips(ctx, gameState, hud);
        if (!gameState.gameOver && !gameState.upgradeChoices && !gameState.chestReward && !gameState.altar && !gameState.paused) {
            this._drawAbilityCooldowns(ctx, gameState, hud);
            this._drawKindleMeter(ctx, gameState, hud);
            // KINDLED: the Focus reticle over the locked enemy, the world-space
            // ult aim arrow + ground template while aiming, and the slow-mo
            // vignette. Kept in the live-play gate (no overlay/pause).
            this._drawFocusReticle(ctx, gameState);
            this._drawKindleAim(ctx, gameState);
            this._drawFocusVignette(ctx, gameState);
            this._drawPlayerLocator(ctx, gameState, hud);
        }
        this._drawHpBar(ctx, gameState, hud);
        this._drawXPBar(ctx, gameState, hud);
        this._drawDebugPanel(ctx, gameState);
        this._drawProfiler(ctx, gameState);
        this._drawDebugButton(ctx, gameState);
        if (!gameState.gameOver && !gameState.upgradeChoices && !gameState.chestReward && !gameState.altar && !gameState.paused) {
            this._drawPauseButton(ctx, gameState);
        }
        this._drawControlHint(ctx, gameState);

        if (!gameState.gameOver && !gameState.upgradeChoices && !gameState.chestReward && !gameState.altar) {
            this._drawWaveAnnouncement(ctx, gameState.waveAnnouncement);
            this._drawBossWarning(ctx, gameState);
            this._drawBossRushHud(ctx, gameState, hud);
        }
        if (!gameState.gameOver && !gameState.upgradeChoices && !gameState.chestReward
            && !gameState.altar && !gameState.paused && !gameState.victory && !gameState.photoMode) {
            this._drawCaption(ctx, gameState.caption, hud);
        }

        // Low-HP danger vignette during live play.
        if (!gameState.gameOver && gameState.player) {
            const hpRatio = gameState.player.maxHp > 0
                ? gameState.player.hp / gameState.player.maxHp
                : 1;
            if (hpRatio > 0 && hpRatio < 0.3) this._drawLowHpVignette(ctx, hpRatio);
        }

        // Overlay priority: game-over > chest > altar > level-up > pause.
        if (gameState.gameOver) {
            receipt.gameOver = this._drawGameOverOverlay(ctx, gameState) === true;
        } else if (gameState.chestReward) {
            this._drawChestOverlay(ctx, gameState);
        } else if (gameState.altar) {
            this._drawAltarOverlay(ctx, gameState);
        } else if (gameState.upgradeChoices) {
            this._drawLevelUpOverlay(ctx, gameState);
        } else if (gameState.paused) {
            receipt.pause = this._drawPauseOverlay(ctx, gameState) === true;
        }

        // Transient hit/heal/level-up screen flashes paint last so they
        // wash briefly over everything, including overlays.
        this._drawFeedback(ctx, gameState);
    }

    // ── Top-center readout: big tabular timer + kills/coins ────────────
    // One combined right-rail guidance owner: current Run Path task plus the
    // compact Living Vigil context that previously required a second panel.
    _drawRunObjectiveCard(ctx, state, hud) {
        const objective = state.runObjective;
        const r = hud.objective;
        if (!objective || !r || r.w <= 0 || r.h <= 0) return;
        const scale = hud.uiScale || 1;
        const lanes = r.lanes || {};
        const pad = lanes.pad ?? 18 * scale;
        const accent = objective.accent || '#ffd166';
        const highContrast = this._highContrast === true;
        const metaPx = Math.max(12, Math.floor(r.metaPx || 15 * scale));
        const titlePx = Math.max(metaPx, Math.floor(r.titlePx || 22 * scale));
        const bodyPx = Math.max(12, Math.floor(r.bodyPx || 16 * scale));
        const progressPx = Math.max(12, Math.floor(r.progressPx || 15 * scale));
        const immediate = objective.vigilPrompt ?? null;
        const bodyLabel = 'NEXT';
        const body = objective.nextAction;
        const vigil = state.vigilTracker;
        const contextText = immediate?.title
            ? `NOW · ${immediate.title}`
            : vigil
                ? `SITES ${vigil.activatedSites}/${vigil.siteKindTotal} · PACKS ${vigil.encountersCleared}`
                : state.touchMode ? 'PATH ACTIVE' : 'O · HEAR TASK';
        const contextColor = immediate?.color
            || (highContrast ? '#ffffff' : 'rgba(225,216,203,0.62)');

        ctx.save();
        this._hudGlassPlate(ctx, r.x, r.y, r.w, r.h, 18 * scale, {
            stroke: highContrast ? '#ffffff' : accent,
        });
        if (highContrast) {
            roundRectPath(ctx, r.x + 4, r.y + 4, r.w - 8, r.h - 8, 14 * scale);
            ctx.strokeStyle = '#050505';
            ctx.lineWidth = 6;
            ctx.stroke();
            roundRectPath(ctx, r.x + 7, r.y + 7, r.w - 14, r.h - 14, 12 * scale);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        ctx.fillStyle = accent;
        roundRectPath(ctx, r.x + pad, r.y + 7 * scale,
            r.w - pad * 2, 4 * scale, 2 * scale);
        ctx.fill();

        const headerY = lanes.headerY ?? (r.y + pad + metaPx * 0.52);
        const phaseSuffix = objective.substitution ? ' · SAFE ROUTE' : '';
        const phaseText = lanes.compactPhase
            ? `${objective.phaseNumeral} · ${objective.phaseLabel}${phaseSuffix}`
            : `${objective.phaseNumeral} / III · ${objective.phaseLabel}${phaseSuffix}`;
        const progressText = lanes.compactPhase
            ? `${objective.current}/${objective.target}`
            : `${objective.current} / ${objective.target}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.font = `850 ${metaPx}px ${MONO}`;
        const progressWidth = ctx.measureText(progressText).width;
        const headerGap = lanes.compactPhase
            ? Math.max(6 * scale, metaPx * 0.18)
            : Math.max(10 * scale, metaPx * 0.35);
        const phaseFit = fitHudLabel(ctx, phaseText,
            Math.max(0, r.w - pad * 2 - progressWidth - headerGap), {
                weight: 850,
                size: metaPx,
                minSize: metaPx,
                family: MONO,
            });
        this._textWithShadow(ctx, phaseFit.text, r.x + pad, headerY, accent);
        ctx.textAlign = 'right';
        this._textWithShadow(
            ctx,
            progressText,
            r.x + r.w - pad,
            headerY,
            '#fff7e8',
        );

        const drawProgressBar = () => {
            const barX = r.x + pad;
            const barW = r.w - pad * 2;
            const barH = lanes.barH ?? Math.max(7 * scale, 7);
            const barY = lanes.barY
                ?? (r.y + r.h - pad - progressPx - 12 * scale - barH);
            this._hudBarTrack(ctx, barX, barY, barW, barH);
            const fillW = barW * clamp01(objective.progress);
            if (fillW > 0) {
                roundRectPath(ctx, barX, barY, Math.max(barH, fillW), barH, barH / 2);
                ctx.fillStyle = accent;
                ctx.fill();
            }
            if (highContrast) {
                roundRectPath(ctx, barX, barY, barW, barH, barH / 2);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        };

        const drawFooter = ({
            footerY,
            rewardMaxW,
            contextMaxW,
            showContext = true,
            minRewardSize = progressPx,
        }) => {
            const rewardText = state.objectiveRewardsEligible === false
                ? 'NO COIN REWARD'
                : `+${objective.reward.amount} COINS`;
            const rewardFit = fitHudLabel(ctx, rewardText, rewardMaxW, {
                weight: 800,
                size: progressPx,
                minSize: minRewardSize,
                family: MONO,
            });
            ctx.font = `800 ${rewardFit.fontSize}px ${MONO}`;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillStyle = state.objectiveRewardsEligible === false ? '#a9a1b5' : '#7fe0a0';
            ctx.fillText(rewardFit.text, r.x + pad, footerY);
            if (showContext) {
                const contextFit = fitHudLabel(ctx, contextText, contextMaxW, {
                    weight: 800,
                    size: progressPx,
                    minSize: progressPx,
                    family: MONO,
                });
                ctx.font = `800 ${contextFit.fontSize}px ${MONO}`;
                ctx.textAlign = 'right';
                ctx.fillStyle = contextColor;
                ctx.fillText(contextFit.text, r.x + r.w - pad, footerY);
            }
            return rewardFit;
        };

        // Phone guidance follows sequential lanes owned by HUDLayout. A normal
        // card keeps its title and a three-line action. During a stacked duel,
        // the narrow edge rail prioritises the complete action, progress, and
        // reward over secondary title/context copy.
        if (lanes.stackedAction) {
            if (lanes.showTitle !== false && Number.isFinite(lanes.titleY)) {
                const titleFit = fitHudLabel(ctx, objective.title, r.w - pad * 2, {
                    weight: 850,
                    size: titlePx,
                    minSize: Math.max(metaPx, titlePx - 4),
                    family: DISPLAY_FONT,
                });
                ctx.textAlign = 'left';
                this._textWithShadow(ctx, titleFit.text,
                    r.x + pad, lanes.titleY, '#fff4df');
            }

            ctx.font = `700 ${bodyPx}px ${FONT}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillStyle = highContrast ? '#ffffff' : '#ffe0a3';
            const actionWrap = wrapText(
                ctx,
                `${bodyLabel} · ${body}`,
                r.x + pad,
                lanes.bodyY,
                r.w - pad * 2,
                lanes.bodyLineHeight,
                lanes.bodyLines,
            );
            drawProgressBar();

            const showContext = lanes.showContext !== false
                && state.objectiveRewardsEligible !== false;
            const rewardFit = drawFooter({
                footerY: lanes.footerY,
                rewardMaxW: showContext ? r.w * 0.44 : r.w - pad * 2,
                contextMaxW: r.w * 0.44,
                showContext,
            });
            this._lastDrawReceipt.objectiveVariant = r.edgeCompact ? 'edge' : 'phone';
            this._lastDrawReceipt.objectiveTextComplete = actionWrap?.truncated !== true
                && rewardFit.truncated !== true;
            ctx.restore();
            return true;
        }

        if (r.dense) {
            const contentY = lanes.titleY ?? (r.y + r.h * 0.46);
            const titleMaxW = r.w * 0.39;
            const denseTitle = fitHudLabel(ctx, objective.title, titleMaxW, {
                weight: 850,
                size: titlePx,
                minSize: Math.max(metaPx, titlePx - 4),
                family: DISPLAY_FONT,
            });
            ctx.textAlign = 'left';
            this._textWithShadow(ctx, denseTitle.text, r.x + pad, contentY, '#fff4df');
            const actionX = r.x + r.w * 0.44;
            ctx.font = `700 ${bodyPx}px ${FONT}`;
            ctx.textBaseline = 'top';
            ctx.fillStyle = '#ffd166';
            const actionWrap = wrapText(
                ctx,
                `${bodyLabel} · ${body}`,
                actionX,
                lanes.bodyY ?? (contentY - bodyPx * 0.58),
                r.x + r.w - pad - actionX,
                lanes.bodyLineHeight ?? bodyPx * 1.02,
                lanes.bodyLines ?? 2,
            );
            const rewardFit = drawFooter({
                footerY: lanes.footerY ?? (r.y + r.h - progressPx - 15 * scale),
                rewardMaxW: r.w * 0.45,
                contextMaxW: r.w * 0.45,
            });
            drawProgressBar();
            this._lastDrawReceipt.objectiveVariant = 'dense';
            this._lastDrawReceipt.objectiveTextComplete = actionWrap?.truncated !== true
                && rewardFit.truncated !== true;
            ctx.restore();
            return true;
        }

        const titleY = lanes.titleY ?? (r.y + r.h * 0.31);
        const titleFit = fitHudLabel(ctx, objective.title, r.w - pad * 2, {
            weight: 850,
            size: titlePx,
            minSize: Math.max(metaPx, titlePx - 4),
            family: DISPLAY_FONT,
        });
        ctx.textAlign = 'left';
        this._textWithShadow(ctx, titleFit.text, r.x + pad, titleY, '#fff4df');

        const bodyY = lanes.bodyY ?? (r.y + r.h * 0.47);
        ctx.font = `700 ${bodyPx}px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#ffd166';
        ctx.fillText(`${bodyLabel} ·`, r.x + pad, bodyY);
        const leadW = ctx.measureText(`${bodyLabel} · `).width;
        ctx.fillStyle = highContrast ? '#ffffff' : 'rgba(244,235,221,0.82)';
        const actionWrap = wrapText(
            ctx,
            body,
            r.x + pad + leadW,
            bodyY,
            r.w - pad * 2 - leadW,
            lanes.bodyLineHeight ?? bodyPx * 1.08,
            lanes.bodyLines ?? 2,
        );
        drawProgressBar();

        const denseFooter = r.dense || state.touchMode;
        const rewardFit = drawFooter({
            footerY: lanes.footerY ?? (r.y + r.h - pad - progressPx * 0.42),
            rewardMaxW: r.w * (state.objectiveRewardsEligible === false
                ? 0.43 : denseFooter ? 0.38 : 0.30),
            contextMaxW: r.w * (state.objectiveRewardsEligible === false
                ? 0.43 : denseFooter ? 0.50 : 0.56),
            minRewardSize: denseFooter ? Math.max(12, progressPx - 3) : progressPx,
        });
        this._lastDrawReceipt.objectiveVariant = 'standard';
        this._lastDrawReceipt.objectiveTextComplete = actionWrap?.truncated !== true
            && rewardFit.truncated !== true;
        ctx.restore();
        return true;
    }

    _drawCommandRail(ctx, state, hud) {
        const r = hud.header;
        const ws = state.waveState;
        const boss = state.activeBoss;
        const compact = hud.compact;
        const timer = formatTime(state.time);
        const coinSprite = getCoinSprite();
        const coinW = coinSprite.width / SPRITE_SS;
        const coinH = coinSprite.height / SPRITE_SS;

        ctx.save();
        this._hudGlassPlate(ctx, r.x, r.y, r.w, r.h, 19, {
            stroke: boss ? 'rgba(255,92,65,0.34)' : 'rgba(255,180,120,0.16)',
        });
        roundRectPath(ctx, r.x, r.y, r.w, r.h, 19); ctx.clip();

        const scale = hud.uiScale || 1;
        const command = hud.command || {};
        const rowY = command.primaryY ?? (r.y + (boss ? r.h / 2 : 36 * scale));
        const identityY = command.identityY ?? rowY;
        const timerX = command.timerX ?? (r.x + 24);
        const statRight = command.countersRight ?? (r.x + r.w - 24);
        const tf = this._uiPx(compact ? 46 : 42);
        ctx.textBaseline = 'middle';

        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        this._hudGlow(ctx, timerX + 72, rowY, 80, '#ff7a1e', 0.11);
        ctx.restore();
        ctx.font = `850 ${tf}px ${MONO}`;
        ctx.textAlign = 'left';
        this._textWithShadow(ctx, timer, timerX, rowY, '#fff7e8');

        // The vigil identity lives in the command rail instead of a separately
        // positioned label. In a duel it contracts so the boss plate beneath
        // it becomes the clear primary hierarchy.
        const waveText = ws
            ? (boss ? `VIGIL ${ws.index + 1}` : `WAVE ${ws.index + 1}  ·  ${ws.name}`)
            : 'THE VIGIL';
        ctx.textAlign = 'center';
        const waveFit = fitHudLabel(ctx, waveText, command.identityMaxW ?? r.w * 0.34, {
            weight: 700,
            size: this._uiPx(compact ? 22 : 19),
            minSize: this._uiPx(compact ? 16 : 14),
            family: DISPLAY_FONT,
        });
        this._textWithShadow(ctx, waveFit.text, command.identityX ?? (r.x + r.w * 0.53), identityY,
            boss ? '#ffc0a2' : '#ffd786');

        // Stable icon counters at the right edge.
        const coinVal = `${state.runCoins ?? 0}`;
        const killsVal = `${state.kills ?? 0}`;
        ctx.font = `800 ${this._uiPx(compact ? 21 : 19)}px ${MONO}`;
        ctx.textAlign = 'right';
        this._textWithShadow(ctx, coinVal, statRight, rowY + 1, '#ffd166');
        const coinX = statRight - ctx.measureText(coinVal).width - coinW - 7;
        ctx.drawImage(coinSprite, coinX, rowY - coinH / 2, coinW, coinH);
        const killRight = coinX - 18;
        this._textWithShadow(ctx, killsVal, killRight, rowY + 1, '#fff');
        const killValueW = ctx.measureText(killsVal).width;
        ctx.font = `700 ${this._uiPx(compact ? 15 : 13)}px ${FONT}`;
        ctx.textAlign = 'right';
        this._textWithShadow(ctx, 'KILLS', killRight - killValueW - 7, rowY + 1,
            'rgba(255,255,255,0.58)');

        // Pressure is an explicitly named THREAT band. A boss duel suppresses
        // it because boss HP and cast state are the authoritative threat signal.
        if (!boss && ws && hud.threat.w > 0) {
            const p = clamp01(state.wavePressure ?? 0);
            const tr = hud.threat;
            const labelW = (compact ? 82 : 72) * scale;
            const pctW = 42 * scale;
            const threatColor = p > 0.7 ? '#ff6b4a' : p > 0.35 ? '#ffaf4a' : '#ffd786';
            ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
            ctx.font = `800 ${this._uiPx(compact ? 16 : 14)}px ${FONT}`;
            this._textWithShadow(ctx, 'THREAT', tr.x, tr.y + tr.h / 2, threatColor);
            const bx = tr.x + labelW;
            const bw = Math.max(40, tr.w - labelW - pctW);
            roundRectPath(ctx, bx, tr.y + 1, bw, tr.h - 2, 5);
            ctx.fillStyle = 'rgba(0,0,0,0.58)'; ctx.fill();
            if (p > 0.002) {
                roundRectPath(ctx, bx, tr.y + 1, Math.max(3, bw * p), tr.h - 2, 5);
                ctx.fillStyle = threatColor; ctx.fill();
            }
            if (this._highContrast) {
                roundRectPath(ctx, bx, tr.y + 1, bw, tr.h - 2, 5);
                ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
                ctx.fillStyle = '#ffffff';
                for (let i = 1; i < 4; i++) ctx.fillRect(bx + bw * i / 4 - 1, tr.y - 1, 2, tr.h + 2);
            }
            ctx.textAlign = 'right';
            ctx.font = `800 ${this._uiPx(compact ? 15 : 13)}px ${MONO}`;
            this._textWithShadow(ctx, `${Math.round(p * 100)}%`, tr.x + tr.w,
                tr.y + tr.h / 2, 'rgba(255,255,255,0.72)');
        }
        ctx.restore();
    }

    // Legacy top readout retained for isolated comparison tooling; live HUD
    // renders through _drawCommandRail above.
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
    _drawComboMeter(ctx, state, hud) {
        const combo = state.combo ?? 0;
        if (combo < (COMBO.minToShow ?? 3)) return;
        // Anchored to the upper-RIGHT (right-aligned), below the debug/pause
        // buttons, so it never collides with the center timer/wave/boss stack.
        const rx = hud.combo.x + hud.combo.w;
        const y = hud.combo.y + 10;
        // Pick the hottest tier the streak has reached.
        let color = COMBO.tiers[0].color;
        for (const t of COMBO.tiers) if (combo >= t.at) color = t.color;
        const frac = state.comboWindow > 0 ? Math.max(0, Math.min(1, (state.comboTimer ?? 0) / state.comboWindow)) : 0;
        // Subtle pulse that quickens with the streak size.
        const pulse = 1 + 0.06 * Math.sin((state.time ?? 0) * (6 + combo * 0.05));
        ctx.save();
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        // Cached tier-colored glow behind the streak text (replaces the last
        // HUD per-frame shadowBlur) — breathes hotter with the streak pulse.
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        this._hudGlow(ctx, rx - 84, y, 90, color, 0.14 + 0.06 * (pulse - 1) / 0.06);
        ctx.restore();
        ctx.globalAlpha = 1;
        ctx.font = `900 ${this._uiPx(34 * pulse)}px ${FONT}`;
        this._textWithShadow(ctx, `${combo}× STREAK`, rx, y, color);
        // Draining window bar beneath the text (right-aligned), in the same
        // recessed glass gutter the HP/XP bars sit in.
        const barW = 168, barH = 6, bx = rx - barW, by = y + 22;
        this._hudBarTrack(ctx, bx, by, barW, barH);
        roundRectPath(ctx, bx + barW * (1 - frac), by, barW * frac, barH, 3);
        ctx.fillStyle = color; ctx.fill();
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
    // ── BUILD STRIP (top-left) ───────────────────────────────────────────
    // The run's whole build on one smoked plate: weapons + passives as
    // compact element-ticked chips that wrap into a second column under a
    // HARD height clamp (the old 34px pill column was uncapped and grew
    // straight into the HP bar on phones), and relics as a single row of
    // rarity gems beneath — visible without six more rows of text.
    _drawLoadoutChips(ctx, state, hud) {
        const weapons = state.ownedWeapons ?? [];
        const passives = state.ownedPassives ?? [];
        const relics = state.runRelics ?? [];
        if (!weapons.length && !passives.length && !relics.length) return;
        if (hud.compact) {
            this._drawCompactLoadout(ctx, state, hud);
            return;
        }

        const x0 = hud.loadout.x, y0 = hud.loadout.y;
        const chipH = 26, gap = 6, colW = 192, colGap = 10;
        const relicRowH = relics.length ? 32 : 0;

        // Tick colours: element hue when the entry has one, else kind colour.
        const ELEMENT_TICK = { fire: '#ff7a33', frost: '#7fe0ff', shock: '#ffe066' };
        const entries = [];
        for (const w of weapons) {
            entries.push({
                label: w.name,
                lv: w.evolved ? 'EVO' : (w.isMax ? 'MAX' : `${w.level}`),
                col: w.evolved ? '#d88cff' : (ELEMENT_TICK[w.element] ?? '#ffd166'),
            });
        }
        for (const p of passives) {
            entries.push({
                label: p.name,
                lv: p.isMax ? 'MAX' : `${p.level}`,
                col: ELEMENT_TICK[p.element] ?? '#5fc7ff',
            });
        }

        // Height clamp: the strip may NEVER reach the vitals console below.
        const consoleTop = hud.vitals.y;
        const maxH = Math.max(4 * (chipH + gap), consoleTop - 24 - y0 - relicRowH - 16);
        const maxRows = Math.max(4, Math.floor((maxH + gap) / (chipH + gap)));
        const cap = maxRows * 2;                     // at most two columns
        let shown = entries, moreN = 0;
        if (entries.length > cap) {
            shown = entries.slice(0, cap - 1);       // last slot = "+N" chip
            moreN = entries.length - shown.length;
        }
        const total = shown.length + (moreN ? 1 : 0);
        const colsUsed = total > maxRows ? 2 : 1;
        const rowsUsed = Math.ceil(total / colsUsed);

        ctx.save();
        // Corner-DOCKED plate: bleeds past the physical top-left edge (same
        // reasoning as the vitals console) — only its bottom-right corner
        // rounds on screen, so the strip reads as part of the display frame.
        const plateW = colsUsed * colW + (colsUsed - 1) * colGap + 20;
        const plateH = rowsUsed * (chipH + gap) - gap + relicRowH + 20;
        this._hudGlassPlate(ctx, -40, -40, x0 + plateW + 30, y0 + plateH + 30, 16, { stroke: 'rgba(255,180,120,0.10)' });

        const drawChip = (e, x, y) => {
            roundRectPath(ctx, x, y, colW, chipH, 7);
            ctx.fillStyle = 'rgba(14, 12, 16, 0.72)'; ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();
            // Element/kind tick down the left edge.
            ctx.fillStyle = e.col;
            ctx.fillRect(x + 3, y + 5, 3, chipH - 10);
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(240,244,250,0.92)';
            ctx.font = `600 ${this._uiPx(14)}px ${FONT}`; ctx.textAlign = 'left';
            let label = e.label;
            if (ctx.measureText(label).width > colW - 52) {
                // Trim with the ellipsis INCLUDED in the measurement — it adds
                // real width, and the margin to the level tag is only a few px.
                while (label.length > 3 && ctx.measureText(label + '…').width > colW - 52) label = label.slice(0, -2);
                label += '…';
            }
            ctx.fillText(label, x + 14, y + chipH / 2 + 1);
            if (e.lv) {
                ctx.fillStyle = e.col;
                ctx.font = `700 ${this._uiPx(13)}px ${MONO}`; ctx.textAlign = 'right';
                ctx.fillText(e.lv, x + colW - 8, y + chipH / 2 + 1);
            }
        };
        // Column-major: fill the first column top-to-bottom, then the second.
        for (let i = 0; i < shown.length; i++) {
            const col = Math.floor(i / rowsUsed), row = i % rowsUsed;
            drawChip(shown[i], x0 + col * (colW + colGap), y0 + row * (chipH + gap));
        }
        if (moreN) {
            const i = shown.length;
            const col = Math.floor(i / rowsUsed), row = i % rowsUsed;
            drawChip({ label: `+${moreN} more`, lv: '', col: 'rgba(255,255,255,0.35)' },
                x0 + col * (colW + colGap), y0 + row * (chipH + gap));
        }

        // Relic gem row — one rarity-coloured diamond per claimed relic.
        if (relics.length) {
            const gy = y0 + rowsUsed * (chipH + gap) - gap + 20;
            let gx = x0 + 10;
            const maxGems = 10;
            for (const r of relics.slice(0, maxGems)) {
                const rc = RARITY_COLORS[r.rarity] ?? RARITY_COLORS.common;
                ctx.beginPath();
                ctx.moveTo(gx, gy - 9); ctx.lineTo(gx + 7, gy);
                ctx.lineTo(gx, gy + 9); ctx.lineTo(gx - 7, gy);
                ctx.closePath();
                ctx.fillStyle = rc.border; ctx.globalAlpha = 0.32; ctx.fill();
                ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.strokeStyle = rc.border; ctx.stroke();
                gx += 22;
            }
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `600 ${this._uiPx(13)}px ${FONT}`;
            ctx.fillText(relics.length > maxGems ? `+${relics.length - maxGems} relics` : 'relics', gx + 2, gy + 1);
        }
        ctx.restore();
    }

    // Compact HP bar for the Lieutenant mini-boss — narrower than the boss bar
    // and tucked just below it, in the ember color, so it reads as "elite threat"
    // without impersonating a boss. Also shows its brief warning fill.
    _drawCompactLoadout(ctx, state, hud) {
        const r = hud.loadout;
        const weapons = state.ownedWeapons ?? [];
        const passives = state.ownedPassives ?? [];
        const relics = state.runRelics ?? [];
        const entries = [
            ...weapons.map((item) => ({ ...item, slotKind: 'weapon' })),
            ...passives.map((item) => ({ ...item, slotKind: 'passive' })),
        ];
        if (!entries.length && !relics.length) return;

        const shown = entries.slice(0, Math.max(0, r.shown));
        const overflow = entries.length - shown.length;
        const colorFor = (item) => item.element === 'fire' ? '#ff7a33'
            : item.element === 'frost' ? '#7fe0ff'
                : item.element === 'shock' ? '#ffe066'
                    : item.evolved ? '#d88cff'
                        : item.slotKind === 'weapon' ? '#ffd166' : '#5fc7ff';
        const iconFor = (item) => item.element === 'fire' ? 'fire'
            : item.element === 'frost' ? 'frost'
                : item.element === 'shock' ? 'lightning'
                    : item.slotKind === 'weapon' ? 'staff'
                        : (item.id === 'ironHeart' ? 'shield' : 'spark');

        ctx.save();
        this._hudGlassPlate(ctx, r.x - 8, r.y - 8, r.w + 16, r.h + 16, 14,
            { stroke: 'rgba(255,180,120,0.13)' });
        for (let i = 0; i < shown.length; i++) {
            const item = shown[i];
            const col = i % r.cols;
            const row = Math.floor(i / r.cols);
            const x = r.x + 10 + col * (r.cellW + r.gap);
            const y = r.y + 10 + row * (r.cellH + r.gap);
            const color = colorFor(item);
            roundRectPath(ctx, x, y, r.cellW, r.cellH, 10);
            ctx.fillStyle = 'rgba(10,10,14,0.84)'; ctx.fill();
            ctx.strokeStyle = color; ctx.globalAlpha = item.evolved ? 0.85 : 0.42;
            ctx.lineWidth = item.evolved ? 2.5 : 1.5; ctx.stroke(); ctx.globalAlpha = 1;

            const icon = getRarityIcon(iconFor(item), item.evolved ? 'legendary'
                : item.slotKind === 'weapon' ? 'rare' : 'uncommon');
            const iconSize = 38;
            ctx.drawImage(icon, x + 5, y + (r.cellH - iconSize) / 2, iconSize, iconSize);

            ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
            ctx.font = `800 ${this._uiPx(18)}px ${MONO}`;
            this._textWithShadow(ctx, item.evolved ? 'E' : `${item.level ?? 1}`,
                x + r.cellW - 7, y + r.cellH / 2, color);
        }

        if (overflow > 0 && shown.length) {
            // Preserve the stable fifteen-slot footprint; the final badge says
            // how much build detail moved to the pause/upgrade surfaces.
            const i = shown.length - 1;
            const col = i % r.cols, row = Math.floor(i / r.cols);
            const x = r.x + 10 + col * (r.cellW + r.gap);
            const y = r.y + 10 + row * (r.cellH + r.gap);
            ctx.fillStyle = 'rgba(8,8,12,0.82)';
            roundRectPath(ctx, x, y, r.cellW, r.cellH, 10); ctx.fill();
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = `800 ${this._uiPx(20)}px ${MONO}`;
            this._textWithShadow(ctx, `+${overflow + 1}`, x + r.cellW / 2, y + r.cellH / 2,
                'rgba(255,255,255,0.8)');
        }

        if (relics.length) {
            const rows = Math.max(1, Math.ceil(Math.max(1, shown.length) / r.cols));
            const gy = r.y + 10 + rows * r.cellH + Math.max(0, rows - 1) * r.gap + 14;
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.font = `700 ${this._uiPx(15)}px ${FONT}`;
            this._textWithShadow(ctx, `RELICS  ${relics.length}`, r.x + 12, gy,
                'rgba(255,224,170,0.72)');
            let gx = r.x + 108;
            for (const relic of relics.slice(0, 9)) {
                const rc = RARITY_COLORS[relic.rarity] ?? RARITY_COLORS.common;
                ctx.beginPath(); ctx.moveTo(gx, gy - 7); ctx.lineTo(gx + 6, gy);
                ctx.lineTo(gx, gy + 7); ctx.lineTo(gx - 6, gy); ctx.closePath();
                ctx.fillStyle = rc.border; ctx.globalAlpha = 0.55; ctx.fill();
                ctx.globalAlpha = 1; gx += 18;
            }
        }
        ctx.restore();
    }

    _drawLieutenantBar(ctx, state, hud) {
        const lt = state.activeLieutenant;
        if (!lt || !(lt.maxHp > 0)) return;
        const r = hud.lieutenant;
        const barW = r.w;
        const barH = 16;
        const barX = r.x;
        const barY = r.y + 22;
        const pct = Math.max(0, Math.min(1, lt.hp / lt.maxHp));
        ctx.save();
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.font = `700 ${this._uiPx(15)}px ${FONT}`;
        // Dark underlayer so the label reads over bright terrain.
        this._textWithShadow(ctx, '⚔ LIEUTENANT', INTERNAL_WIDTH / 2, barY - 4, '#ffc24a');
        // Same recessed-gutter + gradient/gloss recipe as the boss bar, scaled
        // down — the mini-boss reads as kin to the boss, not a flat strip.
        this._hudBarTrack(ctx, barX, barY, barW, barH);
        drawStatBar(ctx, barX, barY, barW, barH, pct,
            { from: '#ff8c1a', to: '#ffc24a' },
            { radius: 6, border: 'rgba(255,194,74,0.75)', borderWidth: 2 });
        ctx.restore();
    }

    _drawBossPlate(ctx, state, hud) {
        const boss = state.activeBoss;
        if (!boss) {
            this.bossName = null;
            return;
        }
        if (this.bossName !== boss.name) {
            this.bossName = boss.name;
            this.bossSlideT = 0;
            this.dispBossRatio = 1;
        }
        this.bossSlideT = Math.min(1, this.bossSlideT + 0.06);

        const pct = clamp01(boss.hp / Math.max(1, boss.maxHp));
        this.dispBossRatio = this.dispBossRatio < pct
            ? pct
            : lerp(this.dispBossRatio, pct, 0.12);
        const r = hud.boss;
        const compact = hud.compact;
        const scale = hud.uiScale || 1;
        const enraged = !!boss.enraged;
        const eased = easeOutCubic(this.bossSlideT);
        const y = r.y - (1 - eased) * 48;
        const barX = r.x + 24;
        const barW = r.w - 48;
        const barH = Math.round((compact ? 28 : 26) * Math.min(scale, 1.2));
        const barY = y + (compact ? 58 : 54) * scale;

        ctx.save();
        ctx.globalAlpha = eased;
        this._hudGlassPlate(ctx, r.x, y, r.w, r.h, 16, {
            stroke: this._highContrast ? '#ffffff'
                : (enraged ? 'rgba(255,62,38,0.72)' : 'rgba(255,105,80,0.48)'),
        });
        if (this._highContrast) {
            roundRectPath(ctx, r.x, y, r.w, r.h, 16);
            ctx.strokeStyle = '#050505'; ctx.lineWidth = 9; ctx.stroke();
            roundRectPath(ctx, r.x, y, r.w, r.h, 16);
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke();
        }

        const tierMeta = BOSS_TIERS[boss.tier];
        const pips = tierMeta ? '◆'.repeat(tierMeta.pips) + '◇'.repeat(3 - tierMeta.pips) : '';
        const title = enraged ? `${boss.name.toUpperCase()}  —  ENRAGED` : boss.name.toUpperCase();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `800 ${this._uiPx(compact ? 29 : 25)}px ${DISPLAY_FONT}`;
        this._textWithShadow(ctx, title, r.x + r.w / 2, y + 21 * scale,
            enraged ? '#ff6d50' : '#ffb09a');

        const meta = [
            tierMeta ? `${pips} ${tierMeta.label}` : null,
            boss.epithet || null,
            `PHASE ${boss.phase ?? 1}`,
        ].filter(Boolean).join('  ·  ');
        ctx.font = `${tierMeta ? 700 : 600} ${this._uiPx(compact ? 17 : 15)}px ${FONT}`;
        this._textWithShadow(ctx, meta, r.x + r.w / 2, y + 42 * scale,
            tierMeta ? tierMeta.color : 'rgba(255,225,210,0.78)');

        this._hudBarTrack(ctx, barX, barY, barW, barH);
        drawStatBar(ctx, barX, barY, barW, barH, pct,
            enraged ? { from: '#ff2a1e', to: '#ffae3c' } : { from: '#ff4757', to: '#ff8c40' },
            {
                radius: 8,
                track: 'rgba(30,4,4,0.9)',
                chip: this.dispBossRatio,
                chipColor: 'rgba(255,180,120,0.58)',
                border: enraged ? '#ff4d34' : '#ff806d',
                borderWidth: 2,
            });
        this._hudBarTicks(ctx, barX, barY, barW, barH, 4);
        ctx.font = `800 ${this._uiPx(compact ? 19 : 17)}px ${MONO}`;
        this._textWithShadow(ctx, `${Math.ceil(boss.hp)} / ${Math.ceil(boss.maxHp)}`,
            r.x + r.w / 2, barY + barH / 2 + 1, '#fff');

        let actionText = `PHASE ${boss.phase ?? 1}  ·  HOLD THE LINE`;
        let actionColor = 'rgba(255,225,200,0.62)';
        let actionProgress = null;
        if (boss.phaseBreak) {
            actionText = '✦  SECOND ACT  ✦';
            actionColor = '#ff765e';
        } else if (boss.casting) {
            actionText = `CASTING  ·  ${boss.casting.label}`;
            actionColor = enraged ? '#ff8066' : '#ffc56e';
            actionProgress = boss.casting.progress;
        } else if (boss.opening) {
            actionText = 'OPENING  ·  STRIKE NOW';
            actionColor = '#7be8a2';
            actionProgress = 1 - boss.opening.progress;
        }
        const actionY = y + r.h - (compact ? 17 : 16);
        ctx.font = `800 ${this._uiPx(compact ? 17 : 15)}px ${FONT}`;
        this._textWithShadow(ctx, actionText, r.x + r.w / 2, actionY, actionColor);
        if (actionProgress != null) {
            const mw = Math.min(420, r.w * 0.44);
            const mx = r.x + (r.w - mw) / 2;
            const my = y + r.h - 6;
            ctx.fillStyle = this._highContrast ? '#050505' : 'rgba(255,255,255,0.13)';
            ctx.fillRect(mx, my, mw, this._highContrast ? 7 : 3);
            ctx.fillStyle = actionColor;
            ctx.fillRect(mx, my, mw * clamp01(actionProgress), this._highContrast ? 7 : 3);
            if (this._highContrast) {
                ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
                ctx.strokeRect(mx, my, mw, 7);
            }
        }
        ctx.restore();
    }

    // Legacy boss-bar implementation retained for isolated comparison tooling;
    // live HUD renders through _drawBossPlate above.
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
        // Cached ember under-glow (throbbing while enraged) replaces the old
        // per-frame shadowBlur — this is the busiest moment on screen.
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const throb = enraged && !this._reducedEffects
            ? 0.6 + 0.4 * Math.sin((state.time ?? 0) * 6) : 1;
        this._hudGlow(ctx, INTERNAL_WIDTH / 2, padTop - 18, enraged ? 70 : 52,
            enraged ? '#ff2a1e' : '#ff5a4a', (enraged ? 0.22 : 0.10) * throb);
        ctx.restore();
        ctx.globalAlpha = easeOutCubic(this.bossSlideT);
        ctx.font = `bold 26px ${FONT}`;
        const label = enraged ? `${boss.name.toUpperCase()} — ENRAGED` : boss.name.toUpperCase();
        this._textWithShadow(ctx, label, INTERNAL_WIDTH / 2, padTop - 6, enraged ? '#ff3326' : '#ff6b6b');

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
        ctx.font = `bold ${this._uiPx(18)}px ${MONO}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
            `${Math.ceil(boss.hp)} / ${Math.ceil(boss.maxHp)}`,
            INTERNAL_WIDTH / 2,
            padTop + barH / 2 + 1
        );

        // Boss grammar, surfaced where the player's eyes already are: the
        // current cast names the threat; recovery advertises the real damage
        // opening; the clean phase pause reads as a second-act beat.
        let actionText = null;
        let actionColor = '#ffc56e';
        let actionProgress = null;
        if (boss.phaseBreak) {
            actionText = '✦  SECOND ACT  ✦';
            actionColor = '#ff5a4a';
        } else if (boss.casting) {
            actionText = `CASTING  ·  ${boss.casting.label}`;
            actionColor = enraged ? '#ff765e' : '#ffc56e';
            actionProgress = boss.casting.progress;
        } else if (boss.opening) {
            actionText = 'OPENING  ·  STRIKE NOW';
            actionColor = '#7be8a2';
            actionProgress = 1 - boss.opening.progress;
        }
        if (actionText) {
            const actionY = padTop + barH + 8;
            const pillW = Math.min(barW * 0.62, 420);
            const pillH = actionProgress == null ? 26 : 31;
            ctx.fillStyle = 'rgba(12, 8, 8, 0.78)';
            roundRectPath(ctx, INTERNAL_WIDTH / 2 - pillW / 2, actionY, pillW, pillH, 10);
            ctx.fill();
            ctx.font = `bold 14px ${FONT}`;
            ctx.textBaseline = 'top';
            ctx.fillStyle = actionColor;
            ctx.fillText(actionText, INTERNAL_WIDTH / 2, actionY + 5);
            if (actionProgress != null) {
                const meterW = pillW - 24;
                const meterX = INTERNAL_WIDTH / 2 - meterW / 2;
                ctx.fillStyle = 'rgba(255,255,255,0.12)';
                ctx.fillRect(meterX, actionY + 24, meterW, 3);
                ctx.fillStyle = actionColor;
                ctx.fillRect(meterX, actionY + 24, meterW * Math.max(0, Math.min(1, actionProgress)), 3);
            }
        }
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

        // Reduced Effects retains the readable hold/fade but removes travel.
        const reduced = this._reducedEffects === true;
        const slide = reduced ? 0 : (1 - easeOutCubic(clamp01(t / fadeIn))) * -40;
        const centerY = INTERNAL_HEIGHT * 0.32 + slide;
        const panelW = 820 * this._activeUiScale;
        const panelH = 120 * this._activeUiScale;
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
        const sweep = reduced ? 1 : easeOutCubic(clamp01(t / (fadeIn * 1.6)));
        ctx.strokeStyle = `rgba(${rgb}, 0.85)`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(panelX + 30, panelY + panelH - 16);
        ctx.lineTo(panelX + 30 + (panelW - 60) * sweep, panelY + panelH - 16);
        ctx.stroke();

        ctx.fillStyle = accent;
        ctx.font = `bold ${this._uiPx(48)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ann.text, INTERNAL_WIDTH / 2, centerY);
        ctx.restore();
    }

    _drawCaption(ctx, caption, hud) {
        if (!caption || !hud?.caption) return;
        const r = hud.caption;
        const lifetime = Math.max(0.001, caption.lifetime || 0);
        const t = clamp01((caption.age || 0) / lifetime);
        const edge = Math.min(1, lifetime * 0.18);
        const fadeIn = clamp01((caption.age || 0) / Math.max(0.08, edge));
        const fadeOut = clamp01((lifetime - (caption.age || 0)) / Math.max(0.12, edge));
        const alpha = Math.min(fadeIn, fadeOut);
        if (alpha <= 0) return;
        const reduced = this._reducedEffects === true;
        const lift = reduced ? 0 : (1 - easeOutCubic(clamp01(t * 5))) * 10;
        const speaker = caption.kind === 'speech'
            ? String(caption.speaker || 'VOICE').toUpperCase()
            : 'SOUND';
        const body = caption.kind === 'speech'
            ? String(caption.text || '')
            : `[${String(caption.text || '')}]`;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(0, lift);
        this._hudGlassPlate(ctx, r.x, r.y, r.w, r.h, 16, {
            stroke: this._highContrast ? '#ffffff' : 'rgba(255,182,103,0.42)',
        });
        if (this._highContrast) {
            roundRectPath(ctx, r.x, r.y, r.w, r.h, 16);
            ctx.strokeStyle = '#050505'; ctx.lineWidth = 7; ctx.stroke();
            roundRectPath(ctx, r.x, r.y, r.w, r.h, 16);
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke();
        }
        const labelPx = r.labelPx || Math.max(18, Math.round(r.textPx * 0.72));
        const lineHeight = r.lineHeight || Math.round(r.textPx * 1.08);
        const padY = r.padY || 14;
        const gap = r.gap || 8;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.font = `800 ${labelPx}px ${DISPLAY_FONT}`;
        const labelY = r.y + padY + labelPx;
        this._textWithShadow(ctx, speaker, r.x + r.w / 2, labelY, '#f0ad63');
        ctx.font = `650 ${r.textPx}px ${FONT}`;
        ctx.fillStyle = caption.kind === 'speech' ? '#ffffff' : '#e9d4b5';
        const bodyY = labelY + gap + r.textPx;
        wrapText(ctx, body, r.x + r.w / 2, bodyY, r.w - 48, lineHeight, 2);
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
        const margin = 70 * this._activeUiScale;
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
        const arrowScale = this._activeUiScale;
        ctx.moveTo(26 * arrowScale, 0);
        ctx.lineTo(-14 * arrowScale, -18 * arrowScale);
        ctx.lineTo(-4 * arrowScale, 0);
        ctx.lineTo(-14 * arrowScale, 18 * arrowScale);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        // Distance label, just inside the arrow.
        ctx.save();
        ctx.fillStyle = 'rgba(255,200,190,0.9)';
        ctx.font = `bold ${this._uiPx(18)}px ${MONO}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lx = cx + ux * (t - 40 * this._activeUiScale);
        const ly = cy + uy * (t - 40 * this._activeUiScale);
        ctx.fillText(`${dist}`, lx, ly);
        ctx.restore();
    }

    // BOSSFORGE — compact Boss Rush banner: mode label + progress (boss X/N),
    // then a second line previewing the incoming/next apex with the prep
    // countdown. Top-center, under the timer readout; only in Boss Rush.
    _drawBossRushHud(ctx, state, hud) {
        const br = state.bossRush;
        if (!br) return;
        const rr = hud.bossRush;
        const cx = rr.x + rr.w / 2;
        const y = rr.y + rr.h / 2;
        const line1 = `${(br.label || 'BOSS RUSH').toUpperCase()}  ·  ${br.bossNumber}/${br.total}`;
        let line2 = '';
        if (br.cleared) {
            line2 = 'GAUNTLET CLEARED';
        } else if (br.phase === 'prep') {
            const secs = Math.ceil(br.prepRemaining || 0);
            const who = br.currentBossName || '—';
            line2 = `INCOMING: ${who}${secs > 0 ? `  ·  ${secs}s` : ''}`;
        } else if (br.phase === 'fight') {
            line2 = br.nextBossName ? `Next: ${br.nextBossName}` : 'Final apex!';
        }
        ctx.save();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `800 ${this._uiPx(24)}px ${FONT}`;
        const w1 = ctx.measureText(line1).width;
        ctx.font = `600 ${this._uiPx(18)}px ${FONT}`;
        const w2 = line2 ? ctx.measureText(line2).width : 0;
        const pw = Math.min(rr.w, Math.max(w1, w2) + 48);
        const ph = (line2 ? 64 : 40) * this._activeUiScale;
        roundRectPath(ctx, cx - pw / 2, y - ph / 2, pw, ph, 12);
        ctx.fillStyle = 'rgba(40,12,12,0.82)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,106,74,0.75)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#ffcbb0'; ctx.font = `800 ${this._uiPx(24)}px ${FONT}`;
        ctx.fillText(line1, cx, y - (line2 ? 12 * this._activeUiScale : 0));
        if (line2) {
            ctx.fillStyle = br.phase === 'prep' && !br.cleared ? '#ffd8a0' : 'rgba(255,255,255,0.85)';
            ctx.font = `600 ${this._uiPx(18)}px ${FONT}`;
            ctx.fillText(line2, cx, y + 15 * this._activeUiScale);
        }
        ctx.restore();
    }

    // "BOSS INCOMING" warning: a pulsing red edge tint + centered banner + the
    // boss's name + a countdown bar, giving the player a few seconds to
    // reposition before the boss lands. Drawn over the world, under overlays.
    _drawBossWarning(ctx, state) {
        const bw = state.bossWarning;
        if (!bw) return;
        const t = clamp01(bw.t);
        const scale = this._activeUiScale;
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
        const tierMeta = BOSS_TIERS[bw.tier];
        if (this._highContrast) {
            const top = by - 52 * scale;
            const bottomOffset = 58 + (bw.epithet ? 38 : 0) + (tierMeta ? 40 : 0) + 62;
            const panelW = Math.min(INTERNAL_WIDTH - 160, 980 * scale);
            const panelH = (52 + bottomOffset) * scale;
            roundRectPath(ctx, cx - panelW / 2, top, panelW, panelH, 24);
            ctx.fillStyle = 'rgba(0,0,0,0.94)'; ctx.fill();
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke();
        }
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 12;
        ctx.fillStyle = `rgba(255,${Math.round(60 + 40 * pulse)},${Math.round(50 + 30 * pulse)},1)`;
        ctx.font = `bold ${this._uiPx(60)}px ${FONT}`;
        if (this._highContrast) this._textWithShadow(ctx, '⚠  BOSS INCOMING  ⚠', cx, by, '#ff6b52');
        else ctx.fillText('⚠  BOSS INCOMING  ⚠', cx, by);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${this._uiPx(40)}px ${FONT}`;
        if (this._highContrast) this._textWithShadow(ctx, bw.name, cx, by + 58 * scale, '#fff');
        else ctx.fillText(bw.name, cx, by + 58 * scale);
        let cursorY = by + 58 * scale;
        // Epithet subtitle (the boss's title), dimmer + italic.
        if (bw.epithet) {
            cursorY += 38 * scale;
            ctx.fillStyle = 'rgba(255,225,210,0.82)';
            ctx.font = `italic ${this._uiPx(26)}px ${FONT}`;
            if (this._highContrast) this._textWithShadow(ctx, bw.epithet, cx, cursorY, '#fff');
            else ctx.fillText(bw.epithet, cx, cursorY);
        }
        // Difficulty tier badge: a colored label + pips so the threat level
        // reads instantly (SKIRMISHER / WARLORD / APEX).
        if (tierMeta) {
            cursorY += 40 * scale;
            const pips = '◆'.repeat(tierMeta.pips) + '◇'.repeat(3 - tierMeta.pips);
            ctx.fillStyle = tierMeta.color;
            ctx.font = `bold ${this._uiPx(24)}px ${FONT}`;
            const tierText = `${pips}  TIER ${bw.tier} · ${tierMeta.label}  ${pips}`;
            if (this._highContrast) this._textWithShadow(ctx, tierText, cx, cursorY, '#fff');
            else ctx.fillText(tierText, cx, cursorY);
        }
        // Countdown bar (fills as the boss approaches).
        const barW = 360 * scale, barH = Math.round(8 * scale);
        const bx = cx - barW / 2;
        const yy = cursorY + 36 * scale;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        roundRectPath(ctx, bx, yy, barW, barH, 4);
        ctx.fill();
        ctx.fillStyle = '#ff5a3c';
        roundRectPath(ctx, bx, yy, barW * t, barH, 4);
        ctx.fill();
        if (this._highContrast) {
            roundRectPath(ctx, bx, yy, barW, barH, 4);
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke();
            ctx.fillStyle = '#ffffff';
            for (let i = 1; i < 4; i++) ctx.fillRect(bx + barW * i / 4 - 1, yy - 3, 2, barH + 6);
        }
        ctx.restore();
    }

    // Ability cooldown pips (bottom-right). Each owned ability shows a radial
    // recharge: a dark wedge shrinks clockwise as it cools, the remaining
    // seconds sit in the center, and a ready ability gets a bright pulsing
    // ring + its initial. Readable at 1920×1080 and within iPhone safe-area.
    _drawAbilityCooldowns(ctx, state, hud) {
        // On touch, the BLINK disc's recharge rim already shows the blink
        // cooldown — drop the duplicate pip, and lift the weapon pips above
        // the KINDLE disc zone (disc top ≈ H − sa.bottom − 284, −290 with the
        // ready-pulse ring) so the row can never sit under a thumb or disc.
        const list = state.touchMode
            ? (state.abilityCooldowns || []).filter((a) => a.id !== 'blink')
            : state.abilityCooldowns;
        if (!list || list.length === 0) return;
        const rr = hud.abilities;
        const R = rr.pipRadius ?? 30;
        const pitch = rr.pipPitch ?? 82;
        const gap = rr.pipGap ?? (pitch - R * 2);
        const labelMaxW = rr.labelMaxW ?? (pitch - 10);
        const cy = rr.y + 38;
        let cx = rr.x + rr.w - 14 - R;
        const now = performanceNowSafe();
        ctx.save();
        this._hudGlassPlate(ctx, rr.x, rr.y, rr.w, rr.h, 14,
            { stroke: 'rgba(143,208,255,0.16)' });
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
                ctx.font = `bold ${this._uiPx(22)}px ${FONT}`;
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
                ctx.font = `bold ${this._uiPx(22)}px ${MONO}`;
                ctx.fillText(a.remaining >= 1 ? String(Math.ceil(a.remaining)) : a.remaining.toFixed(1), cx, cy + 1);
            }
            // Pixel-fit the short name to its authored pip pitch. Character
            // counts are not a width guarantee across fonts or UI scales.
            ctx.fillStyle = 'rgba(255, 255, 255, 0.62)';
            ctx.textBaseline = 'top';
            const nameFit = fitHudLabel(ctx, a.name, labelMaxW, {
                weight: 600,
                size: this._uiPx(hud.compact ? 15 : 13),
                minSize: this._uiPx(hud.compact ? 12 : 11),
                family: FONT,
            });
            ctx.fillText(nameFit.text, cx, cy + R + 5);
            cx -= (R * 2 + gap);
        }
        ctx.restore();
    }

    // KINDLED — the Kindle ult meter: a flat wand-shaped bar sitting just above
    // the ability-cooldown pip cluster (bottom-right). Fills 0→max; when full it
    // pulses READY. No per-frame gradient (cached-glow / flat-fill discipline).
    _drawKindleMeter(ctx, state, hud) {
        const k = state.kindle;
        if (!k) return;
        // Touch devices: the KINDLE action disc's rim IS this meter
        // (TouchButtons.rimFrac) — drawing the bar too doubles the signal
        // and physically overlaps the disc. Desktop keeps the bar.
        if (state.touchMode) return;
        const r = hud.kindle;
        const w = r.w, h = 16;
        const x = r.x;
        const y = r.y;
        const frac = clamp01(k.fill / (k.max || 1));
        const now = performanceNowSafe();
        const col = k.ready ? '#ffd27a' : (k.ultColor || '#ff8c4a');
        ctx.save();
        this._hudGlassPlate(ctx, x - 10, y - 25, w + 20, h + 37, 12,
            { stroke: 'rgba(255,180,120,0.14)' });
        // Track.
        roundRectPath(ctx, x, y, w, h, 8);
        ctx.fillStyle = 'rgba(12, 16, 24, 0.82)';
        ctx.fill();
        // Fill (flat ember; pulse alpha while READY).
        if (frac > 0) {
            ctx.save();
            roundRectPath(ctx, x, y, w, h, 8);
            ctx.clip();
            ctx.fillStyle = col;
            ctx.globalAlpha = k.ready ? (0.72 + 0.28 * (0.5 + 0.5 * Math.sin(now * 0.008))) : 1;
            ctx.fillRect(x, y, Math.max(2, w * frac), h);
            ctx.restore();
        }
        // Rim.
        roundRectPath(ctx, x, y, w, h, 8);
        ctx.lineWidth = 2;
        ctx.strokeStyle = k.ready ? 'rgba(255, 210, 150, 0.85)' : 'rgba(255, 180, 120, 0.45)';
        ctx.stroke();
        // Label above the bar — the hero's ult name when ready, an AIMING
        // countdown while held, else just KINDLE.
        ctx.fillStyle = k.ready || k.aiming ? '#ffe6b8' : 'rgba(255, 255, 255, 0.72)';
        ctx.font = `700 ${this._uiPx(13)}px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const label = k.aiming
            ? `${(k.ultName || 'ULT').toUpperCase()} — AIMING`
            : (k.ready ? `${(k.ultName || 'KINDLE').toUpperCase()} — READY` : 'KINDLE');
        ctx.fillText(label, x + 2, y - 3);
        ctx.restore();
    }

    // World→screen for the HUD's world-space draws (identity/screen-space ctx at
    // ui.draw time — same mapping the boss arrow uses).
    _worldToScreen(state, wx, wy) {
        const cam = state.camera || { x: 0, y: 0 };
        return [(wx - cam.x) + INTERNAL_WIDTH / 2, (wy - cam.y) + INTERNAL_HEIGHT / 2];
    }

    // KINDLED — the Focus reticle: a cached-glow ring over the locked enemy.
    _drawFocusReticle(ctx, state) {
        const ft = state.focusTarget;
        if (!ft) return;
        const [sx, sy] = this._worldToScreen(state, ft.x, ft.y);
        const r = (ft.radius || 20) + 12;
        const now = performanceNowSafe();
        const spin = now * 0.004;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = getGlowSprite('#ff8a4a');
        ctx.globalAlpha = 0.5;
        ctx.drawImage(g, sx - r, sy - r, r * 2, r * 2);
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = '#ffd0a0';
        ctx.lineWidth = 2.5;
        // Four reticle ticks (rotating) — flat strokes, no gradient.
        for (let i = 0; i < 4; i++) {
            const a = spin + i * Math.PI / 2;
            ctx.beginPath();
            ctx.moveTo(sx + Math.cos(a) * (r - 6), sy + Math.sin(a) * (r - 6));
            ctx.lineTo(sx + Math.cos(a) * (r + 4), sy + Math.sin(a) * (r + 4));
            ctx.stroke();
        }
        ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
    }

    // KINDLED — while aiming an ult: a world-space aim arrow from the player + the
    // ult's ground template (ring / lane / cone / line / self) along the angle.
    _drawKindleAim(ctx, state) {
        const k = state.kindle;
        if (!k || !k.aiming || !state.player) return;
        const a = k.aiming;
        const [px, py] = this._worldToScreen(state, state.player.x, state.player.y);
        const col = k.ultColor || '#ff8c4a';
        const range = k.range || 620;
        const ux = Math.cos(a.angle), uy = Math.sin(a.angle);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        // Ground template.
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = 3;
        if (a.kind === 'ring' || a.kind === 'self') {
            const R = a.kind === 'self' ? Math.min(range, 420) : range;
            const cx = a.kind === 'self' ? px : px + ux * Math.min(range * 0.5, 480);
            const cy = a.kind === 'self' ? py : py + uy * Math.min(range * 0.5, 480);
            ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
        } else if (a.kind === 'lane' || a.kind === 'line') {
            const halfW = a.kind === 'lane' ? 170 : 60;
            ctx.save();
            ctx.translate(px, py); ctx.rotate(a.angle);
            ctx.fillRect(0, -halfW, range, halfW * 2);
            ctx.globalAlpha = 0.5; ctx.strokeRect(0, -halfW, range, halfW * 2);
            ctx.restore();
        } else if (a.kind === 'cone') {
            const half = (70 * Math.PI / 180) / 2;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.arc(px, py, range, a.angle - half, a.angle + half);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 0.5; ctx.stroke();
        }
        // Aim arrow.
        ctx.globalAlpha = 0.95;
        ctx.lineWidth = 4;
        const al = 90;
        ctx.beginPath();
        ctx.moveTo(px + ux * 30, py + uy * 30);
        ctx.lineTo(px + ux * al, py + uy * al);
        ctx.stroke();
        const hx = px + ux * al, hy = py + uy * al, pa = Math.PI * 0.82;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + Math.cos(a.angle + pa) * 18, hy + Math.sin(a.angle + pa) * 18);
        ctx.lineTo(hx + Math.cos(a.angle - pa) * 18, hy + Math.sin(a.angle - pa) * 18);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // KINDLED — a cool amber Focus-Time vignette that ramps in over the hold so
    // the world visibly "slows". (Full-screen gradient is an accepted HUD pattern
    // here, like the low-HP/hit vignettes.)
    _drawFocusVignette(ctx, state) {
        const k = state.kindle;
        if (!k || !k.aiming) return;
        const t = clamp01((k.aiming.tHeld || 0) / (k.aiming.tMax || 2.5));
        const strength = 0.22 + 0.18 * t;
        const g = ctx.createRadialGradient(
            INTERNAL_WIDTH / 2, INTERNAL_HEIGHT / 2, INTERNAL_HEIGHT * 0.28,
            INTERNAL_WIDTH / 2, INTERNAL_HEIGHT / 2, INTERNAL_HEIGHT * 0.72);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, `rgba(24, 12, 30, ${strength})`);
        ctx.save();
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
        ctx.restore();
    }

    // Bottom-left VITALS CONSOLE geometry — one glass plate holding the LV
    // badge + HP bar + XP bar, numbers drawn INSIDE the bars. Replaces the
    // old full-width bars whose right-side readout pills sat exactly where
    // the touch BLINK disc (and the blink cooldown pip) live — the HUD's
    // worst overlap. Everything bottom-left keys off this one rect.
    // Dense encounters can bury the hero under enemy silhouettes, particles,
    // and damage numbers. This restrained locator appears only when the field
    // is crowded or HP is low, then disappears during readable play.
    _drawPlayerLocator(ctx, state, hud) {
        const player = state.player;
        if (!player || !(player.maxHp > 0)) return;
        const hpRatio = clamp01(player.hp / player.maxHp);
        const crowded = (state.enemyCount ?? 0) >= hud.playerLocator.denseEnemyThreshold;
        const endangered = hpRatio > 0 && hpRatio <= hud.playerLocator.lowHpThreshold;
        if (!crowded && !endangered) return;

        const [px, py] = this._worldToScreen(state, player.x, player.y);
        const now = performanceNowSafe() * 0.001;
        const pulse = 0.5 + 0.5 * Math.sin(now * (endangered ? 7.5 : 4.5));
        const radius = (Math.max(28, (player.radius ?? 18) + 13) + pulse * 3)
            * this._activeUiScale;
        const color = endangered ? '#ff655f' : '#ffd166';
        const glowR = radius + 24;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = endangered ? 0.22 + 0.16 * pulse : 0.13 + 0.09 * pulse;
        ctx.drawImage(getGlowSprite(color), px - glowR, py - glowR, glowR * 2, glowR * 2);
        ctx.globalCompositeOperation = 'source-over';

        // A broken ring preserves sight of the avatar while reading cleanly
        // through a swarm. Cached glow avoids per-frame shadow blur work.
        ctx.strokeStyle = color;
        ctx.lineWidth = endangered ? 3.5 : 2.5;
        ctx.globalAlpha = endangered ? 0.9 : 0.72;
        for (let i = 0; i < LOCATOR_ARC_COUNT; i++) {
            const start = -Math.PI / 2 + i * Math.PI / 2 + LOCATOR_ARC_OFFSET;
            ctx.beginPath();
            ctx.arc(px, py, radius, start, start + LOCATOR_ARC_SWEEP);
            ctx.stroke();
        }
        if (this._highContrast) {
            // Explicit passes avoid allocating a two-object layer array every
            // frame in the dense/high-contrast path.
            ctx.globalAlpha = 1;
            ctx.strokeStyle = '#050505';
            ctx.lineWidth = 8;
            for (let i = 0; i < LOCATOR_ARC_COUNT; i++) {
                const start = -Math.PI / 2 + i * Math.PI / 2 + LOCATOR_ARC_OFFSET;
                ctx.beginPath();
                ctx.arc(px, py, radius, start, start + LOCATOR_ARC_SWEEP);
                ctx.stroke();
            }
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            for (let i = 0; i < LOCATOR_ARC_COUNT; i++) {
                const start = -Math.PI / 2 + i * Math.PI / 2 + LOCATOR_ARC_OFFSET;
                ctx.beginPath();
                ctx.arc(px, py, radius, start, start + LOCATOR_ARC_SWEEP);
                ctx.stroke();
            }
        }

        // A small downward chevron remains visible when a large enemy covers
        // most of the ring, without adding another label to parse in combat.
        const chevronY = py - radius - 17 - pulse * 4;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        ctx.moveTo(px, chevronY + 12);
        ctx.lineTo(px - 11, chevronY - 3);
        ctx.lineTo(px - 4, chevronY - 3);
        ctx.lineTo(px, chevronY + 3);
        ctx.lineTo(px + 4, chevronY - 3);
        ctx.lineTo(px + 11, chevronY - 3);
        ctx.closePath();
        ctx.fill();
        if (this._highContrast) {
            ctx.font = `800 ${this._uiPx(13)}px ${FONT}`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
            this._textWithShadow(ctx, 'YOU', px, chevronY - 7, '#ffffff');
        }
        ctx.restore();
    }

    _bottomBarLayout(hud) {
        const vr = hud.vitals;
        const x = vr.x;
        const w = vr.w;
        const h = vr.h;
        const y = vr.y;
        // Bar column right of the LV badge.
        const lvW = vr.lvW;
        const bx = x + 16 + lvW + 14;
        const bw = w - 16 * 2 - lvW - 14;
        return { x, y, w, h, lvW, bx, bw, hpH: vr.hpH, xpH: vr.xpH,
            compact: hud.compact, docked: vr.docked };
    }

    _drawHpBar(ctx, state, hud) {
        const L = this._bottomBarLayout(hud);
        const barY = L.y + 14;
        const barLeft = L.bx, barW = L.bw;

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

        const midY = barY + L.hpH / 2;
        ctx.save();
        // Corner-DOCKED console plate (drawn once here — _drawXPBar draws into
        // it): it bleeds past the physical bottom-left edge so the console
        // reads as part of the display frame, not a card floating in the
        // arena — cover-fit crop + insets made an inset plate hover visibly
        // mid-screen on phones. Only its top-right corner rounds on screen.
        if (L.docked) {
            this._hudGlassPlate(ctx, -40, L.y, L.x + L.w + 40, INTERNAL_HEIGHT + 80 - L.y, 16,
                { stroke: 'rgba(255,180,120,0.14)' });
        } else {
            this._hudGlassPlate(ctx, L.x - 8, L.y - 8, L.w + 16, L.h + 16, 16,
                { stroke: 'rgba(255,180,120,0.16)' });
        }
        // LV badge column: big gold level over a small LV tag.
        const lvCx = L.x + 16 + L.lvW / 2;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        this._hudGlow(ctx, lvCx, L.y + L.h / 2 - 4, 26, '#ffd06a', 0.14);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.restore();
        ctx.font = `800 ${this._uiPx(L.compact ? 40 : 34)}px ${MONO}`;
        this._textWithShadow(ctx, `${state.player.level}`, lvCx, L.y + L.h / 2 - 8, '#ffd06a');
        ctx.font = `700 ${this._uiPx(L.compact ? 15 : 12)}px ${FONT}`;
        this._textWithShadow(ctx, 'LEVEL', lvCx, L.y + L.h - 16, 'rgba(255,255,255,0.55)');

        // Low-HP frame glow (additive, same 9Hz pulse as the border).
        if (target < 0.3) {
            const lp = 0.5 + 0.5 * Math.sin(state.time * 9);
            ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.10 + 0.10 * lp;
            ctx.drawImage(getGlowSprite('#ff5a4a'), barLeft - 24, barY - 24, barW + 48, L.hpH + 48);
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.restore();
        }
        // Glass gutter + fill + segment ticks.
        this._hudBarTrack(ctx, barLeft, barY, barW, L.hpH);
        drawStatBar(ctx, barLeft, barY, barW, L.hpH, target, fill, {
            radius: 9,
            chip: this.dispHpRatio,
            chipColor: 'rgba(255, 90, 90, 0.5)',
            border,
            borderWidth: 2,
        });
        this._hudBarTicks(ctx, barLeft, barY, barW, L.hpH, 10);
        // Inline readout measured FIRST so the heart end-cap can yield to it —
        // "872 / 1160" is ~102px wide, so a fixed skip zone under-covers and
        // the heart lands on the leading digit through a whole HP band.
        const readout = `${Math.ceil(state.player.hp)} / ${state.player.maxHp}`;
        ctx.font = `800 ${this._uiPx(L.compact ? 21 : 17)}px ${MONO}`;
        const roW = ctx.measureText(readout).width;
        ctx.font = `800 ${this._uiPx(L.compact ? 17 : 14)}px ${DISPLAY_FONT}`;
        const hpLabelW = ctx.measureText('HP').width;
        // Heart end-cap riding the fill tip (tinted to the HP band). Skipped
        // once the tip (±13px of heart + glow fringe) would enter the digits.
        const capX = Math.max(barLeft + 9, Math.min(barLeft + barW - 9, barLeft + barW * target));
        const capHalf = 13 * this._activeUiScale;
        if (target > 0.02
            && capX - capHalf > barLeft + 12 + hpLabelW + 10
            && capX + capHalf < barLeft + barW - 14 - roW) {
            const tint = target < 0.3 ? '#ff5a4a' : target < 0.6 ? '#ff8a3a' : '#74e890';
            const lp = 0.5 + 0.5 * Math.sin(state.time * 9);
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            this._hudGlow(ctx, capX, midY, 22 * this._activeUiScale, tint, 0.30 + (target < 0.3 ? 0.25 * lp : 0));
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.restore();
            this._hudHeartSigil(ctx, capX, midY, 16 * this._activeUiScale, tint);
        }
        // Explicit labels + numbers live inside the bars so compact players do
        // not need to infer meaning by colour alone.
        ctx.font = `800 ${this._uiPx(L.compact ? 17 : 14)}px ${DISPLAY_FONT}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        this._textWithShadow(ctx, 'HP', barLeft + 12, midY, 'rgba(255,255,255,0.86)');
        ctx.font = `800 ${this._uiPx(L.compact ? 21 : 17)}px ${MONO}`;
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        this._textWithShadow(ctx, readout, barLeft + barW - 12, midY, '#fff');
        ctx.restore();
    }

    // XP row of the vitals console — a thin cool-blue strip under the HP bar
    // (hard hue split from the warm HP). LV badge + plate live in _drawHpBar.
    _drawXPBar(ctx, state, hud) {
        const L = this._bottomBarLayout(hud);
        const barLeft = L.bx, barW = L.bw;
        const barY = L.y + 14 + L.hpH + 12;

        const target = state.player.xpToNext > 0
            ? Math.min(1, state.player.xp / state.player.xpToNext)
            : 0;
        // Smoothly sweep toward the target (and back down on level-up).
        this.dispXpRatio = lerp(this.dispXpRatio, target, 0.2);
        // Fire a self-clearing flash when the level ticks up (not on frame 0).
        if (this._lastLevel != null && state.player.level > this._lastLevel) this._xpFlash = state.time;
        this._lastLevel = state.player.level;

        ctx.save();
        this._hudBarTrack(ctx, barLeft, barY, barW, L.xpH);
        drawStatBar(ctx, barLeft, barY, barW, L.xpH, this.dispXpRatio,
            { from: '#3aa8ff', to: '#7fdcff' },
            { radius: 6, border: 'rgba(255,255,255,0.35)', borderWidth: 1.5 });
        // Leading-edge comet (clipped so it can't spill past the rounded caps).
        if (this.dispXpRatio > 0.01 && this.dispXpRatio < 0.995) {
            ctx.save();
            roundRectPath(ctx, barLeft - 6, barY - 10, barW + 12, L.xpH + 20, 8); ctx.clip();
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6;
            const ex = barLeft + barW * this.dispXpRatio;
            ctx.drawImage(getGlowSprite('#bfe8ff'), ex - 18, barY - 10, 36, L.xpH + 20);
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.restore();
        }
        // Level-up flash (0.5s, self-clearing) — washes the whole console row.
        if (this._xpFlash >= 0 && (state.time - this._xpFlash) < 0.5) {
            const fa = (1 - (state.time - this._xpFlash) / 0.5) * 0.5;
            ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = fa;
            ctx.drawImage(getGlowSprite('#ffd06a'), barLeft - 30, barY - 24, barW + 60, L.xpH + 48);
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.restore();
        }
        const readout = `${Math.ceil(state.player.xp)} / ${state.player.xpToNext}`;
        const midY = barY + L.xpH / 2;
        ctx.textBaseline = 'middle';
        ctx.font = `800 ${this._uiPx(L.compact ? 14 : 11)}px ${DISPLAY_FONT}`;
        ctx.textAlign = 'left';
        this._textWithShadow(ctx, 'XP', barLeft + 10, midY, 'rgba(225,245,255,0.92)');
        ctx.font = `800 ${this._uiPx(L.compact ? 15 : 12)}px ${MONO}`;
        ctx.textAlign = 'right';
        this._textWithShadow(ctx, readout, barLeft + barW - 10, midY, '#f2fbff');
        ctx.restore();
    }

    // ── Render-phase timing profiler (roadmap #4; dev/debug HUD only) ──────
    // A compact bottom-left panel of the per-frame timing buckets, so an FPS
    // drop is diagnosed from where the milliseconds actually go, not guessed.
    // Reads the loop's profiler EMA (smoothed ms). The bar is scaled to the
    // 60fps budget (16.67ms) and colour-flags update/render as they approach it.
    _drawProfiler(ctx, state) {
        if (!state.showDebug) return;
        const prof = this.loop && this.loop.profiler;
        if (!prof || !prof.enabled) return;
        const sa = this.renderer.safeArea;

        const budget = 1000 / 60;   // 16.67ms per frame at 60fps
        const lineH = 24;
        const boxW = 300;
        const barW = 96;
        const rows = prof.buckets.length + 1;   // + header
        const boxH = lineH * rows + 16;
        const boxLeft = sa.left + 12;
        const boxTop = INTERNAL_HEIGHT - sa.bottom - 12 - boxH;

        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        roundRectPath(ctx, boxLeft, boxTop, boxW, boxH, 10);
        ctx.fill();

        ctx.font = `20px ${MONO}`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        const textLeft = boxLeft + 12;
        let y = boxTop + 10;
        ctx.fillStyle = 'rgba(180,230,255,0.95)';
        ctx.fillText('PROFILE ms  60=16.7', textLeft, y);
        y += lineH;

        const barLeft = boxLeft + boxW - barW - 12;
        for (const b of prof.buckets) {
            const ms = prof.ema[b] || 0;
            // update/render are the top-level totals — flag them by budget.
            const top = (b === 'update' || b === 'render');
            let col = 'rgba(150,210,180,0.9)';
            if (top) col = ms >= budget ? '#ff6a5a' : ms >= budget * 0.7 ? '#ffce54' : '#7be08a';
            ctx.fillStyle = col;
            ctx.fillText(b, textLeft, y);
            ctx.textAlign = 'right';
            ctx.fillText(ms.toFixed(2), barLeft - 8, y);
            ctx.textAlign = 'left';
            // bar
            const frac = Math.max(0, Math.min(1, ms / budget));
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fillRect(barLeft, y + 4, barW, 12);
            ctx.fillStyle = top ? col : 'rgba(120,180,255,0.8)';
            ctx.fillRect(barLeft, y + 4, barW * frac, 12);
            y += lineH;
        }
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
            `GFXTIER ${state.gfxTier ?? 0}  VEIL ${(state.veilScale ?? 1).toFixed(2)}x`,
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
        // Dev aid only (?dev=1): hidden from players, matching Game's gating
        // of the tap hotspot — no faint HUD button invites a stray tap.
        if (!DEV_MODE) return;
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

        const confirm = state.pauseExitConfirm;
        const heldCoins = Math.max(0, Math.floor(state.objectiveCoinsHeld ?? 0));
        const objective = state.runObjective;
        if (objective) {
            const reward = state.objectiveRewardsEligible === false
                ? 'PRACTICE' : `+${objective.reward.amount} COIN REWARD`;
            const line = `${objective.phaseLabel} ${objective.phaseIndex + 1}/3 · `
                + `${objective.title} ${objective.current}/${objective.target} · ${reward}`;
            ctx.font = `750 26px ${MONO}`;
            ctx.fillStyle = objective.accent || '#ffd166';
            const fit = fitHudLabel(ctx, line, 920, {
                weight: 750, size: 26, minSize: 20, family: MONO,
            });
            ctx.font = `750 ${fit.fontSize}px ${MONO}`;
            ctx.fillText(fit.text, INTERNAL_WIDTH / 2,
                INTERNAL_HEIGHT / 2 - (heldCoins > 0 ? 126 : 108));
        }
        if (heldCoins > 0) {
            const armed = confirm?.action === 'restart' || confirm?.action === 'menu';
            ctx.font = `800 22px ${MONO}`;
            ctx.fillStyle = armed ? '#ff8b80' : '#ffd166';
            ctx.fillText(
                `${heldCoins} COINS HELD · RESTART OR LEAVE FORFEITS THEM`,
                INTERNAL_WIDTH / 2,
                INTERNAL_HEIGHT / 2 - 88,
            );
        }

        const resume = this.getResumeButtonRect();
        this._drawSummaryButton(ctx, resume, 'RESUME', '#5fe87a',
            'rgba(95, 232, 122, 0.3)', this._pressAmt(state, 'resume'), true);

        const restart = this.getPauseRestartRect();
        const shop = this.getPauseShopRect();
        const restartArmed = confirm?.action === 'restart';
        const menuArmed = confirm?.action === 'menu';
        this._drawSummaryButton(ctx, restart, restartArmed ? 'CONFIRM RESTART' : 'RESTART',
            restartArmed ? '#ff8b80' : '#ffd166',
            restartArmed ? 'rgba(122, 34, 48, 0.82)' : 'rgba(255, 209, 102, 0.14)',
            this._pressAmt(state, 'restart'), false);
        this._drawSummaryButton(ctx, shop, menuArmed ? 'CONFIRM LEAVE' : 'LEAVE TO MENU',
            menuArmed ? '#ff8b80' : '#5fc7ff',
            menuArmed ? 'rgba(122, 34, 48, 0.82)' : 'rgba(95, 199, 255, 0.12)',
            this._pressAmt(state, 'returnShop'), false);

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

        // EMBERGLASS: LENS (photo mode) button.
        const lens = this.getPauseLensRect();
        ctx.fillStyle = 'rgba(255, 154, 74, 0.10)';
        ctx.strokeStyle = 'rgba(255, 154, 74, 0.6)';
        ctx.lineWidth = 2;
        roundRectPath(ctx, lens.x, lens.y, lens.w, lens.h, 14);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffce5c';
        ctx.font = `600 26px ${DISPLAY_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('◉  LENS — PHOTO MODE', lens.x + lens.w / 2, lens.y + lens.h / 2 + 1);
        ctx.textBaseline = 'alphabetic';

        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = `22px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const pauseHint = confirm
            ? `Activate ${confirm.action === 'restart' ? 'CONFIRM RESTART' : 'CONFIRM LEAVE'} again within ${confirm.seconds}s  ·  P / Esc cancels`
            : 'P / Esc to resume';
        ctx.fillText(pauseHint, INTERNAL_WIDTH / 2, INTERNAL_HEIGHT - 60 - this.renderer.safeArea.bottom);
        ctx.restore();
        return true;
    }

    // Bouncing world-space pointer at the CURRENT lesson's subject (nearest
    // shard / coin / shrine, or the boss): a pulsing ring + a chevron hovering
    // above it when on-screen, or an edge arrow toward it when off-screen — so
    // the tutorial literally points AT the thing it's talking about.
    _drawTutorialPointer(ctx, state) {
        const tgt = state.tutorialTarget;
        const cam = state.camera;
        if (!tgt || !cam) return;
        const cx = INTERNAL_WIDTH / 2, cy = INTERNAL_HEIGHT / 2;
        const sx = (tgt.x - cam.x) + cx;
        const sy = (tgt.y - cam.y) + cy;
        const reduced = this._reducedEffects === true;
        const t = reduced ? 0 : performanceNowSafe() * 0.001;
        const bounce = reduced ? 0 : 4 + 4 * Math.sin(t * 6);
        const m = 96;
        ctx.save();
        if (sx >= m && sx <= INTERNAL_WIDTH - m && sy >= m && sy <= INTERNAL_HEIGHT - m) {
            const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * 4);
            ctx.strokeStyle = `rgba(255,224,120,${0.45 + 0.4 * pulse})`;
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(sx, sy, 30 + 6 * pulse, 0, Math.PI * 2); ctx.stroke();
            const chY = sy - 56 - bounce;   // chevron hovers above, points down
            ctx.fillStyle = '#ffe066'; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(sx, chY + 20); ctx.lineTo(sx - 17, chY - 6); ctx.lineTo(sx - 6, chY - 6);
            ctx.lineTo(sx, chY + 4); ctx.lineTo(sx + 6, chY - 6); ctx.lineTo(sx + 17, chY - 6);
            ctx.closePath(); ctx.fill(); ctx.stroke();
        } else {
            const ang = Math.atan2(sy - cy, sx - cx);
            const ux = Math.cos(ang), uy = Math.sin(ang);
            const tt = Math.min(Math.abs((cx - m) / (ux || 1e-6)), Math.abs((cy - m) / (uy || 1e-6)));
            ctx.translate(cx + ux * tt, cy + uy * tt); ctx.rotate(ang);
            ctx.fillStyle = '#ffe066'; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(28, 0); ctx.lineTo(-14, -18); ctx.lineTo(-4, 0); ctx.lineTo(-14, 18);
            ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
    }

    _drawControlHint(ctx, state) {
        if (state.upgradeChoices || state.gameOver || state.chestReward || state.altar
            || state.paused || state.victory || state.photoMode) return;
        const sa = this.renderer.safeArea;
        // First-run TUTORIAL banner — a framed, clearly-labelled "LESSON n/9"
        // card with progress dots + a ✓ done-flash, plus a world pointer at the
        // thing the lesson teaches. Fed by Game._onboardingLessonState. This is
        // the guided first run; it REPLACES the old permanent teach line.
        const lesson = state.onboardingLesson;
        if (lesson) {
            this._drawTutorialPointer(ctx, state);
            const t = performanceNowSafe() * 0.001;
            const done = lesson.done;
            const accent = done ? '#5fd36a' : '#ffd166';
            const label = `TUTORIAL  ·  LESSON ${lesson.n} / ${lesson.total}`;
            // Hint text can be multi-line (\n): the non-gamer copy runs long, so
            // it's authored as 1–2 lines and drawn line-by-line (fillText ignores
            // \n). The done-flash is always a single short line.
            let bodyLines = done ? ['✓  Nice!'] : String(lesson.text).split('\n');
            if (state.touchMode && !done && lesson.n === 1) {
                bodyLines = [
                    'Drag the left side to move. Enemies chase you — keep moving.',
                    'Tap the right side to focus; use BLINK when you get surrounded.',
                ];
            } else if (!state.touchMode && !done && lesson.n === 9) {
                bodyLines = [
                    'Space blinks out of danger. Hold Q to aim, then release Kindle.',
                    'Press Tab to focus a priority enemy; press again to cycle targets.',
                ];
            }
            const bodyFontPx = done ? 27 : 22;
            ctx.save();
            ctx.textAlign = 'center';
            ctx.font = `bold ${bodyFontPx}px ${FONT}`;
            let bodyW = 0;
            for (const ln of bodyLines) bodyW = Math.max(bodyW, ctx.measureText(ln).width);
            const cw = Math.max(bodyW + 72, 420);
            const lineGap = 27;
            const chh = 74 + bodyLines.length * lineGap;
            const cx0 = INTERNAL_WIDTH / 2 - cw / 2;
            const y0 = INTERNAL_HEIGHT - chh - 108 - sa.bottom;   // clears the bottom bars
            // Card + pulsing accent border.
            roundRectPath(ctx, cx0, y0, cw, chh, 16);
            ctx.fillStyle = 'rgba(8,7,12,0.9)'; ctx.fill();
            ctx.save();
            ctx.globalAlpha = this._reducedEffects ? 1 : 0.7 + 0.3 * Math.sin(t * 4);
            roundRectPath(ctx, cx0, y0, cw, chh, 16);
            ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.stroke();
            ctx.restore();
            // "TUTORIAL · LESSON n/total" label strip.
            ctx.textBaseline = 'middle';
            ctx.font = `700 15px ${FONT}`;
            ctx.fillStyle = accent;
            ctx.fillText(label, INTERNAL_WIDTH / 2, y0 + 20);
            // Progress dots (done = green, current = accent, upcoming = faint).
            const dn = lesson.total, dotsW = dn * 16;
            for (let i = 0; i < dn; i++) {
                const dx = INTERNAL_WIDTH / 2 - dotsW / 2 + i * 16 + 8;
                ctx.beginPath();
                ctx.arc(dx, y0 + 42, i === lesson.n - 1 ? 5 : 3.5, 0, Math.PI * 2);
                ctx.fillStyle = i < lesson.n - 1 ? 'rgba(95,211,106,0.75)'
                    : i === lesson.n - 1 ? accent : 'rgba(255,255,255,0.22)';
                ctx.fill();
            }
            // The lesson line(s) (or ✓ Nice! on the done-flash).
            ctx.font = `bold ${bodyFontPx}px ${FONT}`;
            ctx.fillStyle = done ? '#c9f5cf' : '#ffe9b0';
            const bodyTop = y0 + 62;
            for (let i = 0; i < bodyLines.length; i++) {
                ctx.fillText(bodyLines[i], INTERNAL_WIDTH / 2, bodyTop + i * lineGap);
            }
            ctx.restore();
            return;
        }
        // The old always-on teach line now retires after a few runs — veterans
        // know how to move; new players get the onboarding pills above instead.
        const runs = state.saveData?.stats?.runs ?? 0;
        if (runs >= 3) return;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = `20px ${FONT}`;
        // No dev-tool talk here: the debug pointer moved behind ?dev=1 (see
        // MenuRenderer DEV_MODE) — a new player's teach line is play-only.
        const controlLine = state.touchMode
            ? 'Drag the left side to move  •  Tap the right side to focus'
            : 'WASD / Arrows move  •  Space blink  •  Hold Q Kindle  •  Tab focus';
        ctx.fillText(
            controlLine,
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

        // KINDLED element-combo breadcrumb — which cross-element reaction a pick
        // this level would unlock (sits just under the keystone line).
        const combos = state.comboHints;
        if (Array.isArray(combos) && combos.length) {
            ctx.globalAlpha = bg;
            ctx.fillStyle = '#8fe0ff'; // frost-cyan combo tint
            ctx.font = `700 24px ${FONT}`;
            const ctxt = combos
                .map((h) => `${h.offered.toUpperCase()}+${h.owned.toUpperCase()} → ${h.reaction}`)
                .join('     ◆     ');
            ctx.fillText(`◆ COMBO READY ◆   ${ctxt}`, INTERNAL_WIDTH / 2, 174);
            ctx.globalAlpha = 1;
        }

        ctx.globalAlpha = bg;
        ctx.font = `34px ${FONT}`;
        // Weapon/ability slot meter (P0.3): the ~5-slot loadout cap is a real
        // draft constraint, so it reads right on the pick screen. The whole
        // line turns amber once full — new-weapon cards have left the pool at
        // that point, and the meter says why.
        const slotsFull = state.weaponSlotCap && state.ownedWeaponCount >= state.weaponSlotCap;
        ctx.fillStyle = slotsFull ? '#ffd166' : 'rgba(255,255,255,0.78)';
        const slotText = state.weaponSlotCap
            ? `  •  SLOTS ${state.ownedWeaponCount}/${state.weaponSlotCap}${slotsFull ? ' (FULL)' : ''}` : '';
        const choiceLead = state.onboardingLevelUp
            ? 'Choose your first upgrade — every choice helps'
            : 'Choose an upgrade';
        const sub = `${choiceLead}  •  LV ${state.player.level}${slotText}`
            + (state.pendingLevelUps > 0 ? `  (${state.pendingLevelUps + 1} pending)` : '');
        ctx.fillText(sub, INTERNAL_WIDTH / 2, 290);
        // The first-draft guidance intentionally stays inside the normal
        // subtitle line. Extra tutorial rows used to sit underneath the card
        // tops and compete with the choices they were meant to explain.
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

    // Wick Shrine altar overlay — a pick-one relic offering. Reuses the level-up
    // card layout + card renderer so relic cards read identically to upgrades,
    // with a distinct relic-pink title so the moment feels its own.
    _drawAltarOverlay(ctx, state) {
        const altar = state.altar;
        if (!altar || !altar.choices) return;
        const choices = altar.choices;
        const age = altar.age ?? 1;
        // Branching Roads reuses this overlay tagged kind:'crossroads' — same
        // card layout + freeze, different heading/copy/tint so the fork reads.
        const isRoads = altar.kind === 'crossroads';

        ctx.save();
        const bg = easeOutQuad(clamp01(age / 0.18));
        ctx.fillStyle = `rgba(14, 8, 16, ${0.82 * bg})`;
        ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const titleScale = easeOutBack(clamp01(age / 0.22));
        ctx.save();
        ctx.translate(INTERNAL_WIDTH / 2, 210);
        ctx.scale(titleScale, titleScale);
        ctx.font = `bold 96px ${FONT}`;
        ctx.fillStyle = isRoads ? '#ffc061' : '#ff9ecf';
        ctx.fillText(isRoads ? 'CROSSROADS' : 'WICK SHRINE', 0, 0);
        ctx.restore();

        ctx.globalAlpha = bg;
        ctx.font = `34px ${FONT}`;
        ctx.fillStyle = 'rgba(255,255,255,0.78)';
        ctx.fillText(
            isRoads ? 'Choose your road — it shapes the stretch ahead' : 'Claim a relic — it lasts the whole run',
            INTERNAL_WIDTH / 2, 290
        );
        ctx.globalAlpha = 1;

        const rects = this.getLevelUpCardRects(choices.length);
        for (let i = 0; i < rects.length; i++) {
            const cardT = easeOutBack(clamp01((age - i * 0.06) / 0.32));
            if (cardT <= 0) continue;
            const r = rects[i];
            const cxp = r.x + r.w / 2;
            const cyp = r.y + r.h / 2;
            const press = this._pressAmt(state, `altar:${i}`);
            const scale = (0.9 + 0.1 * cardT) * (1 - 0.04 * press);
            const slideY = (1 - cardT) * 40;

            ctx.save();
            ctx.globalAlpha = clamp01(cardT);
            ctx.translate(cxp, cyp + slideY);
            ctx.scale(scale, scale);
            ctx.translate(-cxp, -cyp);
            this._drawUpgradeCard(ctx, r, choices[i], i, null);
            ctx.restore();
        }

        ctx.globalAlpha = bg;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = `24px ${FONT}`;
        ctx.fillText(
            isRoads ? 'Tap a road  •  1 / 2 / 3' : 'Tap a relic  •  1 / 2 / 3',
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
        const reduced = this._reducedEffects === true;
        // Death BEAT: hold the frozen world — the hero collapsing in its death
        // pose — fully visible for ~0.6s before the overlay animates in. This
        // sits inside the window the dismiss-tap is already locked out for, so
        // the collapse reads before "GAME OVER" takes the screen.
        const DEATH_BEAT = 0.6;
        const rawAge = state.gameOverAge ?? (1 + DEATH_BEAT);
        const age = reduced
            ? (rawAge >= DEATH_BEAT ? 10 : 0)
            : Math.max(0, rawAge - DEATH_BEAT);

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
            const pulse = reduced ? 1 : 0.7 + 0.3 * ((Math.sin(age * 6) + 1) / 2);
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

        // BOSSFORGE — Boss Rush swaps the wave/objective-centric readout for a
        // gauntlet result: bosses felled, whether it was cleared, the apex reached,
        // time, and score. (The hero + build/weapons are on the recap card.)
        const activePath = state.runObjective;
        const pathDone = state.runPathSummary?.completedPhases ?? state.objectivesDone ?? 0;
        const pathValue = activePath
            ? `${pathDone}/3 · ${activePath.phaseLabel} ${activePath.current}/${activePath.target}`
            : `${pathDone}/3${pathDone >= 3 ? ' · COMPLETE' : ''}`;
        const stats = summary.bossRush ? [
            [summary.bossRushLabel || 'Boss Rush', summary.bossRushCleared ? 'CLEARED!' : 'Fell short'],
            ['Bosses felled', `${summary.bossRushBosses ?? 0}/${summary.bossRushTotal ?? 0}`],
            ['Apex reached', summary.bossRushFinalBoss || '—'],
            ['Time', formatTime(summary.time)],
            ['Level', `Lv ${summary.level}`],
            ['Score', `${summary.bossRushScore ?? 0}`],
            ['Run Path', pathValue],
            ['Coins earned', summary.coinsEarned],
        ] : [
            ['Survived', formatTime(summary.time)],
            ['Final Wave', `${summary.finalWave}` + (summary.finalWaveName ? `  •  ${summary.finalWaveName}` : '')],
            ['Level', `Lv ${summary.level}`],
            ['Kills', summary.kills],
            ['Bosses', summary.bossesDefeated],
            ['Run Path', pathValue],
            ['Vigil sites', `${summary.vigilSitesActivated ?? 0}  •  ${summary.vigilSiteKindsMastered ?? 0}/4 kinds`],
            ['Tactical packs', summary.encountersCleared ?? 0],
            ['Beacon packs', summary.guardianPacksDefeated ?? 0],
            ['Coins earned', summary.coinsEarned],
        ];
        const statsStartY = 240 + sa.top;
        const lineH = 44;
        const colWidth = 480;
        const colLeftX = INTERNAL_WIDTH / 2 - colWidth - 40;
        ctx.font = `28px ${FONT}`;
        for (let i = 0; i < stats.length; i++) {
            // Stagger stat rows in top-to-bottom.
            const rowT = reduced ? 1 : clamp01((age - 0.3 - i * 0.05) / 0.25);
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

        const tailT = reduced ? 1 : clamp01((age - 0.55) / 0.3);
        ctx.globalAlpha = tailT;

        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd166';
        ctx.font = `bold 34px ${FONT}`;
        ctx.fillText(
            `Total Coins:  ${summary.totalCoins}`,
            INTERNAL_WIDTH / 2,
            statsStartY + Math.ceil(stats.length / 2) * lineH + 20
        );

        // Reward lines — celebrate what this run newly earned: battle-pass XP,
        // completed daily trials, unlocked achievements, and any cosmetics those
        // achievements granted (the grind payoff). Stacked + pulsing; the loadout
        // lists below shift down only when more than one reward type fires.
        const rewardLines = [];
        // Vigil (battle-pass) XP — earned every valid run, so the core meta reward is
        // VISIBLE at death instead of silently banked (state.bpResult is set in
        // Game._enterGameOver). A pass level-up gets an extra shout.
        const bp = state.bpResult;
        if (bp && bp.gained > 0) {
            const receipt = battlePassRunReceipt(bp);
            const extras = [];
            if (receipt?.trials > 0) extras.push(`Trials +${receipt.trials}`);
            if (receipt?.threat > 0) extras.push(`Threat +${receipt.threat}`);
            if (receipt?.waylightWithinDeeds > 0) extras.push(`Waylight ${receipt.waylightWithinDeeds} of Deeds`);
            if (bp.everflameCaches > 0) extras.push(`Everflame +${bp.everflameCoins} coins`);
            const suffix = extras.length ? `  ·  ${extras.join('  ·  ')}` : '';
            rewardLines.push({
                text: bp.leveledUp
                    ? `⬥ +${bp.gained} VIGIL XP → PASS LV ${bp.levelAfter} — LEVEL UP!${suffix} ⬥`
                    : `⬥ +${bp.gained} VIGIL XP → PASS LV ${bp.levelAfter}${suffix} ⬥`,
                color: '#ff5a8a',
            });
        }
        if ((summary.objectiveCoins ?? 0) > 0) {
            rewardLines.push({
                text: `✓ RUN PATH · ${pathDone}/3 PHASES · +${summary.objectiveCoins} COINS BANKED ✓`,
                color: '#7fe0a0',
            });
        }
        // Daily Road payout — the curated daily always pays score-band coins,
        // plus the first-clear-of-day free case (label carried on the summary).
        if (summary.dailyRoadScore != null) {
            let txt = `◆ DAILY ROAD ${summary.dailyRoadScore} — +${summary.dailyRoadCoins ?? 0} coins`;
            if (summary.dailyRoadCase) txt += `  ·  case: ${summary.dailyRoadCase}`;
            rewardLines.push({ text: txt + ' ◆', color: '#ff9ecf' });
        }
        if (Array.isArray(summary.dailies) && summary.dailies.length) {
            const dailyXp = summary.dailyVigilXp > 0 ? `  ·  +${summary.dailyVigilXp} Vigil XP` : '';
            rewardLines.push({ text: `✦ DAILY TRIAL — ${summary.dailies.join('  ·  ')}${dailyXp} ✦`, color: '#5fe87a' });
        }
        // Day streak — celebratory only, shown once it's actually a streak.
        if ((summary.streak ?? 0) >= 2)
            rewardLines.push({ text: `🔥 ${summary.streak}-DAY VIGIL STREAK 🔥`, color: '#ff9a4a' });
        if (Array.isArray(summary.achievements) && summary.achievements.length)
            rewardLines.push({ text: `★ ACHIEVEMENT — ${summary.achievements.join('  ·  ')} ★`, color: '#ffce54' });
        if (Array.isArray(summary.cosmeticUnlocks) && summary.cosmeticUnlocks.length)
            rewardLines.push({ text: `🎁 COSMETIC UNLOCKED — ${summary.cosmeticUnlocks.join('  ·  ')}`, color: '#c08bff', cosmetic: true });
        const rewardBase = statsStartY + Math.ceil(stats.length / 2) * lineH + 52;
        if (rewardLines.length) {
            const pulse = reduced ? 1 : 0.7 + 0.3 * ((Math.sin(age * 5) + 1) / 2);
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
                    const sc = reduced ? 1 : 0.55 + 0.45 * easeOutBack(tailT);
                    const w = ctx.measureText(rewardLines[i].text).width;
                    ctx.save();
                    ctx.translate(INTERNAL_WIDTH / 2, ly);
                    ctx.scale(sc, sc);
                    ctx.fillText(rewardLines[i].text, 0, 0);
                    ctx.restore();
                    for (let sgn = -1; !reduced && sgn <= 1; sgn += 2) {
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
        const btnT = reduced ? 1 : clamp01((age - 0.7) / 0.3);
        ctx.globalAlpha = btnT;
        const restartBtn = this.getRestartButtonRect();
        const shopBtn = this.getReturnToShopButtonRect();
        const pulse = reduced ? 1 : 0.85 + 0.15 * ((Math.sin(age * 4) + 1) / 2);
        this._drawSummaryButton(ctx, restartBtn, 'RESTART', '#5fe87a',
            `rgba(95, 232, 122, ${0.32 * pulse})`,
            this._pressAmt(state, 'restart'), true);
        this._drawSummaryButton(ctx, shopBtn, 'RETURN TO SHOP', '#5fc7ff',
            'rgba(95, 199, 255, 0.10)',
            this._pressAmt(state, 'returnShop'), false);

        // EMBERGLASS: the auto-minted recap card thumbnail + SHARE CARD button,
        // bottom-right, on the same fade timeline as the buttons.
        const card = state.mintedCard;
        if (card && card.canvas) {
            const shareBtn = this.getShareCardButtonRect();
            const tw = 360, th = 189;
            const tx = INTERNAL_WIDTH - tw - 40;
            const ty = shareBtn.y - th - 18;
            ctx.save();
            ctx.fillStyle = 'rgba(8,5,6,0.6)';
            ctx.fillRect(tx - 4, ty - 4, tw + 8, th + 8);
            try { ctx.drawImage(card.canvas, tx, ty, tw, th); } catch (e) { /* card optional */ }
            ctx.strokeStyle = '#ff9a4a';
            ctx.lineWidth = 3;
            ctx.strokeRect(tx - 4, ty - 4, tw + 8, th + 8);
            ctx.restore();
            this._drawSummaryButton(ctx, shareBtn, 'SHARE CARD', '#ffce5c',
                'rgba(255, 206, 92, 0.12)', this._pressAmt(state, 'shareCard'), false);
        }

        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = `22px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(
            card && card.canvas
                ? 'R / Enter restart   •   B / Esc shop   •   S share'
                : 'R / Enter restart   •   B / Esc shop',
            INTERNAL_WIDTH / 2,
            restartBtn.y + restartBtn.h + 36
        );
        ctx.globalAlpha = 1;

        // EMBERGLASS: share-result toast (full alpha, above the summary).
        const toast = state.shareToast;
        if (toast && toast.text) {
            const a = Math.min(1, (toast.timer ?? 0) / 0.4);
            ctx.save();
            ctx.globalAlpha = a;
            ctx.font = `600 30px ${FONT}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const w = ctx.measureText(toast.text).width + 64;
            const bh = 60;
            const bx = INTERNAL_WIDTH / 2 - w / 2, by = restartBtn.y - bh - 20;
            ctx.fillStyle = 'rgba(20, 12, 10, 0.92)';
            ctx.fillRect(bx, by, w, bh);
            ctx.strokeStyle = '#ff9a4a';
            ctx.lineWidth = 2;
            ctx.strokeRect(bx, by, w, bh);
            ctx.fillStyle = '#ffd166';
            ctx.fillText(toast.text, INTERNAL_WIDTH / 2, by + bh / 2 + 1);
            ctx.restore();
        }

        ctx.restore();
        return true;
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
        let fontSize = 36;
        ctx.font = `bold ${fontSize}px ${FONT}`;
        while (fontSize > 18 && ctx.measureText(label).width > btn.w - 24) {
            fontSize -= 2;
            ctx.font = `bold ${fontSize}px ${FONT}`;
        }
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
export function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 8) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    let truncated = false;
    for (let i = 0; i < words.length; i++) {
        const testLine = line ? line + ' ' + words[i] : words[i];
        if (ctx.measureText(testLine).width > maxWidth && line) {
            if (lines.length >= maxLines - 1) {
                // This is the final visible line and unconsumed words remain.
                // Preserve as much as fits; exact two-line copy reaches the
                // loop end and therefore keeps its exact punctuation.
                let last = line;
                while (last && ctx.measureText(last + '…').width > maxWidth) {
                    last = last.slice(0, -1).trimEnd();
                }
                lines.push(last + '…');
                truncated = true;
                line = '';
                break;
            }
            lines.push(line);
            line = words[i];
        } else {
            line = testLine;
        }
    }
    if (line && lines.length < maxLines) {
        if (ctx.measureText(line).width > maxWidth) {
            while (line && ctx.measureText(line + '…').width > maxWidth) {
                line = line.slice(0, -1).trimEnd();
            }
            line += '…';
            truncated = true;
        }
        lines.push(line);
    } else if (line) {
        truncated = true;
    }
    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], x, y + i * lineHeight);
    }
    return { lines, truncated };
}
