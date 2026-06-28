// MenuRenderer — the redesigned main menu: a tab bar (Play / Skills / Loadout
// / Character / Shop / Battle Pass / Settings) over a content panel, plus the
// case-opening overlay.
//
// Stateless w.r.t. game logic: draw() reads a plain `state` snapshot (save
// data + active tab + case animation) and, as it lays out each control, pushes
// a clickable region into `this.hotspots`. Game's pointer handler walks those
// regions and dispatches the `action`/`arg` — so layout math lives in exactly
// one place (here) and is never duplicated for hit-testing.

import { roundRectPath, clamp01, easeOutCubic } from '../render/DrawUtils.js';
import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../config/GameConfig.js';
import { rarityColor, rarityName, RARITIES } from '../content/rarities.js';
import {
    GEAR, GEAR_CATEGORIES, GEAR_CATEGORY_LABELS, gearByCategory, buffSummary,
} from '../content/gear.js';
import {
    COSMETICS, COSMETIC_CATEGORIES, COSMETIC_CATEGORY_LABELS, cosmeticsByCategory, resolveAppearance,
} from '../content/cosmetics.js';
import { CASES, CASE_ORDER, caseOddsRows } from './CaseSystem.js';
import { BATTLE_PASS_LEVELS, BP_MAX_LEVEL, bpProgress } from '../content/battlePass.js';
import { rewardLabel } from './BattlePassSystem.js';
import { PERMANENT_UPGRADES, nextCost } from '../content/permanentUpgrades.js';

const FONT = '-apple-system, system-ui, Helvetica, Arial, sans-serif';

export const MENU_TABS = [
    { id: 'play', label: 'PLAY' },
    { id: 'skills', label: 'SKILLS' },
    { id: 'loadout', label: 'LOADOUT' },
    { id: 'character', label: 'CHARACTER' },
    { id: 'shop', label: 'SHOP' },
    { id: 'battlepass', label: 'BATTLE PASS' },
    { id: 'settings', label: 'SETTINGS' },
];

const SETTING_TOGGLES = [
    { key: 'debug', label: 'Debug Mode' },
    { key: 'screenShake', label: 'Screen Shake' },
    { key: 'damageNumbers', label: 'Damage Numbers' },
    { key: 'particles', label: 'Particles' },
    { key: 'reducedEffects', label: 'Reduced Effects (mobile)' },
];

export class MenuRenderer {
    constructor(renderer) {
        this.renderer = renderer;
        this.hotspots = [];
    }

    _sa() { return this.renderer.safeArea; }
    _hot(x, y, w, h, action, arg) { this.hotspots.push({ x, y, w, h, action, arg }); }

    // Rounded filled (and optionally stroked) panel.
    _panel(ctx, x, y, w, h, fill = 'rgba(18,22,30,0.82)', stroke = 'rgba(255,255,255,0.08)') {
        roundRectPath(ctx, x, y, w, h, 16);
        ctx.fillStyle = fill; ctx.fill();
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
    }

    // A labelled button. Registers a hotspot when an action is supplied.
    _button(ctx, r, label, opts = {}) {
        const { primary = false, enabled = true, accent = null, sub = null, action = null, arg = null, fontSize = 30 } = opts;
        roundRectPath(ctx, r.x, r.y, r.w, r.h, 14);
        let fill = 'rgba(40,46,58,0.95)';
        if (primary) fill = enabled ? '#3ea65b' : 'rgba(40,46,58,0.6)';
        else if (accent) fill = accent;
        else if (!enabled) fill = 'rgba(30,34,42,0.7)';
        ctx.fillStyle = fill; ctx.fill();
        ctx.strokeStyle = enabled ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 2; ctx.stroke();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = enabled ? '#fff' : 'rgba(255,255,255,0.4)';
        ctx.font = `700 ${fontSize}px ${FONT}`;
        ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + (sub ? -10 : 0));
        if (sub) {
            ctx.font = `600 18px ${FONT}`;
            ctx.fillStyle = enabled ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)';
            ctx.fillText(sub, r.x + r.w / 2, r.y + r.h / 2 + 18);
        }
        if (action && enabled) this._hot(r.x, r.y, r.w, r.h, action, arg);
    }

    _contentRect() {
        const sa = this._sa();
        const x = sa.left + 56;
        const w = INTERNAL_WIDTH - sa.left - sa.right - 112;
        const top = sa.top + 184;
        const bottom = INTERNAL_HEIGHT - sa.bottom - 40;
        return { x, y: top, w, h: bottom - top };
    }

    draw(ctx, state) {
        this.hotspots = [];
        const sa = this._sa();
        const save = state.saveData;

        // Backdrop.
        ctx.fillStyle = '#0a0d12';
        ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

        // Header: title + coin bank.
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#ffce54';
        ctx.font = `800 52px ${FONT}`;
        ctx.fillText('EMBERWAKE', sa.left + 56, sa.top + 70);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ffd86b';
        ctx.font = `700 34px ${FONT}`;
        ctx.fillText(`◎ ${save.totalCoins} coins`, INTERNAL_WIDTH - sa.right - 56, sa.top + 66);

        this._drawTabBar(ctx, state.menuTab);

        const tab = state.menuTab || 'play';
        if (tab === 'play') this._drawPlay(ctx, state);
        else if (tab === 'skills') this._drawSkills(ctx, state);
        else if (tab === 'loadout') this._drawLoadout(ctx, state);
        else if (tab === 'character') this._drawCharacter(ctx, state);
        else if (tab === 'shop') this._drawShop(ctx, state);
        else if (tab === 'battlepass') this._drawBattlePass(ctx, state);
        else if (tab === 'settings') this._drawSettings(ctx, state);

        // Toast (transient result message, e.g. claim / case errors).
        if (state.menuToast) {
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = `700 26px ${FONT}`;
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            const tw = ctx.measureText(state.menuToast).width + 48;
            roundRectPath(ctx, INTERNAL_WIDTH / 2 - tw / 2, INTERNAL_HEIGHT - sa.bottom - 70, tw, 48, 12);
            ctx.fill();
            ctx.fillStyle = '#ffe9a8';
            ctx.fillText(state.menuToast, INTERNAL_WIDTH / 2, INTERNAL_HEIGHT - sa.bottom - 46);
        }

        // Case-opening overlay sits above everything (and owns input while up).
        if (state.caseAnim) this._drawCaseOverlay(ctx, state.caseAnim);
    }

    _drawTabBar(ctx, activeTab) {
        const sa = this._sa();
        const x0 = sa.left + 56;
        const w = INTERNAL_WIDTH - sa.left - sa.right - 112;
        const gap = 10;
        const tabW = (w - gap * (MENU_TABS.length - 1)) / MENU_TABS.length;
        const y = sa.top + 104;
        const h = 62;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let i = 0; i < MENU_TABS.length; i++) {
            const t = MENU_TABS[i];
            const x = x0 + i * (tabW + gap);
            const active = t.id === activeTab;
            roundRectPath(ctx, x, y, tabW, h, 12);
            ctx.fillStyle = active ? '#ffce54' : 'rgba(30,36,46,0.9)';
            ctx.fill();
            ctx.strokeStyle = active ? '#ffe08a' : 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = active ? '#1a130a' : 'rgba(235,240,248,0.85)';
            ctx.font = `700 ${tabW < 230 ? 20 : 23}px ${FONT}`;
            ctx.fillText(t.label, x + tabW / 2, y + h / 2 + 1);
            this._hot(x, y, tabW, h, 'tab', t.id);
        }
    }

    // ── PLAY ───────────────────────────────────────────────────────────
    _drawPlay(ctx, state) {
        const c = this._contentRect();
        const save = state.saveData;

        // Left: character preview card.
        const cardW = c.w * 0.42;
        this._panel(ctx, c.x, c.y, cardW, c.h);
        const ap = resolveAppearance(save.cosmetics.equipped);
        this._drawAvatar(ctx, c.x + cardW / 2, c.y + c.h * 0.36, 150, ap);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff'; ctx.font = `700 30px ${FONT}`;
        ctx.fillText('Pyra, last Wick-Keeper', c.x + cardW / 2, c.y + c.h * 0.66);

        // Battle-pass mini progress.
        const prog = bpProgress(save.battlePass.xp);
        const barY = c.y + c.h * 0.78;
        const barW = cardW - 80;
        const barX = c.x + 40;
        ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = `600 20px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText(`Battle Pass — Lv ${prog.level}${prog.atMax ? ' (MAX)' : ''}`, barX, barY - 16);
        roundRectPath(ctx, barX, barY, barW, 18, 9); ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill();
        roundRectPath(ctx, barX, barY, barW * clamp01(prog.fraction), 18, 9); ctx.fillStyle = '#9a6cff'; ctx.fill();

        // Right: equipped loadout chips + START RUN.
        const rx = c.x + cardW + 36;
        const rw = c.w - cardW - 36;
        this._panel(ctx, rx, c.y, rw, c.h);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#cdd6e2'; ctx.font = `700 26px ${FONT}`;
        ctx.fillText('Equipped Loadout', rx + 28, c.y + 44);
        const eq = save.gear.equipped;
        let ly = c.y + 78;
        for (const cat of GEAR_CATEGORIES) {
            const item = GEAR[eq[cat]];
            const col = item ? rarityColor(item.rarity) : 'rgba(255,255,255,0.25)';
            roundRectPath(ctx, rx + 28, ly, rw - 56, 56, 10);
            ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
            ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `600 18px ${FONT}`;
            ctx.fillText(GEAR_CATEGORY_LABELS[cat], rx + 44, ly + 24);
            ctx.fillStyle = '#fff'; ctx.font = `700 24px ${FONT}`;
            ctx.fillText(item ? item.name : '— empty —', rx + 44, ly + 46);
            ly += 66;
        }
        // START RUN.
        const btn = { x: rx + 28, y: c.y + c.h - 110, w: rw - 56, h: 84 };
        this._button(ctx, btn, 'START RUN', { primary: true, fontSize: 38, sub: 'Space / Enter', action: 'startRun' });
    }

    // Simple procedural avatar honoring aura/fur/cloak/hat cosmetics.
    _drawAvatar(ctx, cx, cy, r, ap) {
        ctx.save();
        if (ap.auraColor) {
            const g = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 1.4);
            g.addColorStop(0, ap.auraColor); g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.4;
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2); ctx.fill();
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        }
        if (ap.cloakColor) {
            ctx.fillStyle = ap.cloakColor;
            ctx.beginPath();
            ctx.moveTo(cx - r * 0.7, cy - r * 0.1); ctx.lineTo(cx + r * 0.7, cy - r * 0.1);
            ctx.lineTo(cx + r * 0.95, cy + r); ctx.lineTo(cx - r * 0.95, cy + r); ctx.closePath(); ctx.fill();
        }
        // Body (fur color or default warm brown).
        ctx.fillStyle = ap.furColor || '#8a6a4a';
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2); ctx.fill();
        // Face.
        ctx.fillStyle = '#e8d3b0';
        ctx.beginPath(); ctx.arc(cx, cy - r * 0.05, r * 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2a2018';
        ctx.beginPath(); ctx.arc(cx - r * 0.16, cy - r * 0.1, r * 0.06, 0, Math.PI * 2);
        ctx.arc(cx + r * 0.16, cy - r * 0.1, r * 0.06, 0, Math.PI * 2); ctx.fill();
        // Hat.
        if (ap.hatShape && ap.hatShape !== 'none') {
            ctx.fillStyle = ap.hatColor || '#ffd35a';
            const ty = cy - r * 0.55;
            if (ap.hatShape === 'cap') { ctx.beginPath(); ctx.arc(cx, ty, r * 0.34, Math.PI, 0); ctx.fill(); }
            else if (ap.hatShape === 'candle') {
                ctx.fillStyle = '#e8e2cf'; ctx.fillRect(cx - r * 0.07, ty - r * 0.3, r * 0.14, r * 0.32);
                ctx.fillStyle = '#ffb24a'; ctx.beginPath(); ctx.ellipse(cx, ty - r * 0.32, r * 0.06, r * 0.12, 0, 0, Math.PI * 2); ctx.fill();
            } else if (ap.hatShape === 'horns') {
                ctx.strokeStyle = ap.hatColor || '#9a6cff'; ctx.lineWidth = 9; ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(cx - r * 0.24, ty); ctx.quadraticCurveTo(cx - r * 0.5, ty - r * 0.3, cx - r * 0.34, ty - r * 0.5);
                ctx.moveTo(cx + r * 0.24, ty); ctx.quadraticCurveTo(cx + r * 0.5, ty - r * 0.3, cx + r * 0.34, ty - r * 0.5);
                ctx.stroke();
            } else if (ap.hatShape === 'crown') {
                const cw = r * 0.5;
                ctx.beginPath();
                ctx.moveTo(cx - cw, ty); ctx.lineTo(cx - cw, ty - r * 0.18); ctx.lineTo(cx - cw * 0.5, ty - r * 0.04);
                ctx.lineTo(cx, ty - r * 0.26); ctx.lineTo(cx + cw * 0.5, ty - r * 0.04); ctx.lineTo(cx + cw, ty - r * 0.18);
                ctx.lineTo(cx + cw, ty); ctx.closePath(); ctx.fill();
            }
        }
        ctx.restore();
    }

    // ── SKILLS (permanent upgrades) ──────────────────────────────────────
    _drawSkills(ctx, state) {
        const c = this._contentRect();
        const save = state.saveData;
        const cols = 2, gap = 24;
        const cardW = (c.w - gap) / cols;
        const cardH = 96;
        const rowGap = 16;
        ctx.textBaseline = 'alphabetic';
        for (let i = 0; i < PERMANENT_UPGRADES.length; i++) {
            const u = PERMANENT_UPGRADES[i];
            const col = i % cols, row = Math.floor(i / cols);
            const x = c.x + col * (cardW + gap);
            const y = c.y + row * (cardH + rowGap);
            const level = save.upgrades[u.id] ?? 0;
            const cost = nextCost(u, level);
            const maxed = level >= u.maxLevel;
            const afford = !maxed && save.totalCoins >= cost;
            roundRectPath(ctx, x, y, cardW, cardH, 12);
            ctx.fillStyle = 'rgba(22,27,36,0.9)'; ctx.fill();
            ctx.strokeStyle = maxed ? '#5fd36a' : afford ? '#ffce54' : 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 2; ctx.stroke();
            ctx.textAlign = 'left';
            ctx.fillStyle = '#fff'; ctx.font = `700 25px ${FONT}`;
            ctx.fillText(u.name, x + 22, y + 34);
            ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = `500 19px ${FONT}`;
            ctx.fillText(u.description, x + 22, y + 60);
            ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `600 17px ${FONT}`;
            ctx.fillText(`Lv ${level}/${u.maxLevel}`, x + 22, y + 82);
            // Buy button on the right.
            const bw = 150, bh = 56;
            const br = { x: x + cardW - bw - 16, y: y + (cardH - bh) / 2, w: bw, h: bh };
            this._button(ctx, br, maxed ? 'MAX' : `◎ ${cost}`,
                { enabled: afford, accent: afford ? '#2e6b3f' : null, action: maxed ? null : 'buyUpgrade', arg: u.id });
        }
        // Reset save at the bottom.
        const rr = { x: c.x + c.w / 2 - 170, y: c.y + c.h - 60, w: 340, h: 52 };
        this._button(ctx, rr, state.resetConfirming ? 'TAP AGAIN TO CONFIRM' : 'RESET SAVE',
            { accent: state.resetConfirming ? '#7a2230' : 'rgba(80,30,38,0.8)', action: 'resetSave', fontSize: 22 });
    }

    // ── LOADOUT / CHARACTER shared grid ──────────────────────────────────
    _drawItemGrid(ctx, state, kind) {
        const c = this._contentRect();
        const save = state.saveData;
        const cats = kind === 'gear' ? GEAR_CATEGORIES : COSMETIC_CATEGORIES;
        const labels = kind === 'gear' ? GEAR_CATEGORY_LABELS : COSMETIC_CATEGORY_LABELS;
        const equipped = kind === 'gear' ? save.gear.equipped : save.cosmetics.equipped;
        const isUnlocked = (id) => (kind === 'gear' ? save.gear.unlocked : save.cosmetics.unlocked).includes(id);
        const itemsFor = kind === 'gear' ? gearByCategory : cosmeticsByCategory;

        const colW = (c.w - (cats.length - 1) * 18) / cats.length;
        ctx.textBaseline = 'alphabetic';
        for (let ci = 0; ci < cats.length; ci++) {
            const cat = cats[ci];
            const x = c.x + ci * (colW + 18);
            this._panel(ctx, x, c.y, colW, c.h, 'rgba(16,20,28,0.8)');
            ctx.textAlign = 'center';
            ctx.fillStyle = '#cdd6e2'; ctx.font = `700 22px ${FONT}`;
            ctx.fillText(labels[cat], x + colW / 2, c.y + 34);
            const items = itemsFor(cat);
            let iy = c.y + 56;
            const ih = 64, ig = 10;
            for (const item of items) {
                if (iy + ih > c.y + c.h - 8) break; // clip to column
                const unlocked = isUnlocked(item.id);
                const equippedHere = equipped[cat] === item.id;
                const col = rarityColor(item.rarity);
                roundRectPath(ctx, x + 12, iy, colW - 24, ih, 10);
                ctx.fillStyle = equippedHere ? 'rgba(255,206,84,0.16)' : 'rgba(255,255,255,0.04)';
                ctx.fill();
                ctx.strokeStyle = equippedHere ? '#ffce54' : unlocked ? col : 'rgba(255,255,255,0.08)';
                ctx.lineWidth = equippedHere ? 3 : 2; ctx.stroke();
                ctx.textAlign = 'left';
                ctx.globalAlpha = unlocked ? 1 : 0.4;
                ctx.fillStyle = unlocked ? '#fff' : 'rgba(255,255,255,0.6)';
                ctx.font = `700 20px ${FONT}`;
                ctx.fillText(item.name, x + 26, iy + 26);
                ctx.fillStyle = col; ctx.font = `600 15px ${FONT}`;
                ctx.fillText(unlocked ? (equippedHere ? 'EQUIPPED' : rarityName(item.rarity)) : '🔒 LOCKED', x + 26, iy + 48);
                ctx.globalAlpha = 1;
                if (unlocked && !equippedHere) {
                    this._hot(x + 12, iy, colW - 24, ih,
                        kind === 'gear' ? 'equipGear' : 'equipCosmetic', { category: cat, id: item.id });
                }
                iy += ih + ig;
            }
        }
    }

    _drawLoadout(ctx, state) { this._drawItemGrid(ctx, state, 'gear'); }
    _drawCharacter(ctx, state) { this._drawItemGrid(ctx, state, 'cosmetic'); }

    // ── SHOP (cases) ─────────────────────────────────────────────────────
    _drawShop(ctx, state) {
        const c = this._contentRect();
        const save = state.saveData;
        const gap = 28;
        const cardW = (c.w - gap * (CASE_ORDER.length - 1)) / CASE_ORDER.length;
        ctx.textBaseline = 'alphabetic';
        for (let i = 0; i < CASE_ORDER.length; i++) {
            const def = CASES[CASE_ORDER[i]];
            const x = c.x + i * (cardW + gap);
            this._panel(ctx, x, c.y, cardW, c.h, 'rgba(18,22,30,0.9)');
            ctx.textAlign = 'center';
            ctx.fillStyle = '#fff'; ctx.font = `800 30px ${FONT}`;
            ctx.fillText(def.name, x + cardW / 2, c.y + 50);
            // Odds rows.
            const rows = caseOddsRows(def.id);
            let oy = c.y + 96;
            ctx.font = `600 21px ${FONT}`;
            for (const r of rows) {
                ctx.textAlign = 'left'; ctx.fillStyle = rarityColor(r.rarity);
                ctx.fillText(rarityName(r.rarity), x + 40, oy);
                ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.85)';
                ctx.fillText(`${r.pct}%`, x + cardW - 40, oy);
                oy += 34;
            }
            const afford = save.totalCoins >= def.cost;
            const br = { x: x + 36, y: c.y + c.h - 86, w: cardW - 72, h: 64 };
            // Always clickable: an unaffordable tap surfaces a "Not enough
            // coins" toast rather than silently doing nothing.
            this._button(ctx, br, `OPEN  ◎ ${def.cost}`,
                { primary: afford, enabled: true, accent: afford ? null : 'rgba(60,66,78,0.9)', action: 'openCase', arg: def.id, fontSize: 26 });
        }
    }

    // ── BATTLE PASS ──────────────────────────────────────────────────────
    _drawBattlePass(ctx, state) {
        const c = this._contentRect();
        const save = state.saveData;
        const prog = bpProgress(save.battlePass.xp);

        // Progress header + bar.
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#fff'; ctx.font = `700 30px ${FONT}`;
        ctx.fillText(`Vigil Level ${prog.level} / ${BP_MAX_LEVEL}`, c.x, c.y + 20);
        ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `600 22px ${FONT}`;
        ctx.fillText(prog.atMax ? 'MAX' : `${prog.levelXp} / ${prog.levelNeed} XP`, c.x + c.w, c.y + 20);
        roundRectPath(ctx, c.x, c.y + 36, c.w, 20, 10); ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill();
        roundRectPath(ctx, c.x, c.y + 36, c.w * clamp01(prog.fraction), 20, 10); ctx.fillStyle = '#9a6cff'; ctx.fill();

        // Level grid: show a window around the current level (10 cells).
        const start = Math.max(1, Math.min(prog.level - 2, BP_MAX_LEVEL - 9));
        const cols = 5, rows = 2, gap = 16;
        const gridY = c.y + 80;
        const cellW = (c.w - gap * (cols - 1)) / cols;
        const cellH = (c.h - 80 - 80 - gap) / rows;
        for (let n = 0; n < cols * rows; n++) {
            const level = start + n;
            if (level > BP_MAX_LEVEL) break;
            const col = n % cols, row = Math.floor(n / cols);
            const x = c.x + col * (cellW + gap);
            const y = gridY + row * (cellH + gap);
            const reached = level <= prog.level;
            const claimed = save.battlePass.claimed.includes(level);
            const claimable = reached && !claimed;
            const entry = BATTLE_PASS_LEVELS[level - 1];
            roundRectPath(ctx, x, y, cellW, cellH, 12);
            ctx.fillStyle = claimed ? 'rgba(40,70,46,0.6)' : reached ? 'rgba(40,46,58,0.95)' : 'rgba(20,24,32,0.8)';
            ctx.fill();
            ctx.strokeStyle = claimable ? '#ffce54' : claimed ? '#5fd36a' : 'rgba(255,255,255,0.1)';
            ctx.lineWidth = claimable ? 3 : 2; ctx.stroke();
            ctx.textAlign = 'left';
            ctx.fillStyle = level === BP_MAX_LEVEL ? '#ff6d8a' : '#ffce54';
            ctx.font = `800 24px ${FONT}`;
            ctx.fillText(`Lv ${level}`, x + 18, y + 34);
            ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.font = `600 18px ${FONT}`;
            ctx.fillText(rewardLabel(entry.reward), x + 18, y + 62);
            if (claimable) {
                const br = { x: x + 18, y: y + cellH - 46, w: cellW - 36, h: 34 };
                this._button(ctx, br, 'CLAIM', { accent: '#2e6b3f', action: 'claimBP', arg: level, fontSize: 18 });
            } else {
                ctx.fillStyle = claimed ? '#5fd36a' : 'rgba(255,255,255,0.4)';
                ctx.font = `700 18px ${FONT}`;
                ctx.fillText(claimed ? '✓ CLAIMED' : '🔒 LOCKED', x + 18, y + cellH - 22);
            }
        }
        // Claim all.
        const ca = { x: c.x + c.w / 2 - 160, y: c.y + c.h - 58, w: 320, h: 50 };
        this._button(ctx, ca, 'CLAIM ALL AVAILABLE', { accent: '#3a3158', action: 'claimAllBP', fontSize: 22 });
    }

    // ── SETTINGS ─────────────────────────────────────────────────────────
    _drawSettings(ctx, state) {
        const c = this._contentRect();
        const save = state.saveData;
        this._panel(ctx, c.x, c.y, c.w, c.h);
        const innerX = c.x + 40;
        const innerW = c.w - 80;
        let y = c.y + 40;
        ctx.textBaseline = 'middle';
        for (const t of SETTING_TOGGLES) {
            const val = save.settings[t.key] === true;
            ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = `600 26px ${FONT}`;
            ctx.fillText(t.label, innerX, y + 26);
            const tw = 92, th = 44;
            const tr = { x: innerX + innerW - tw, y: y + 4, w: tw, h: th };
            roundRectPath(ctx, tr.x, tr.y, tr.w, tr.h, th / 2);
            ctx.fillStyle = val ? '#3ea65b' : 'rgba(80,86,96,0.9)'; ctx.fill();
            ctx.fillStyle = '#fff'; ctx.beginPath();
            ctx.arc(val ? tr.x + tw - th / 2 : tr.x + th / 2, tr.y + th / 2, th / 2 - 6, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `700 18px ${FONT}`;
            ctx.textAlign = 'center';
            ctx.fillText(val ? 'ON' : 'OFF', val ? tr.x + th / 2 : tr.x + tw - th / 2, tr.y + th / 2);
            this._hot(tr.x, tr.y, tr.w, tr.h, 'toggleSetting', t.key);
            y += 60;
        }
        // Volume sliders (placeholder, +/- steppers).
        for (const v of [{ key: 'volMusic', label: 'Music Volume' }, { key: 'volSfx', label: 'SFX Volume' }]) {
            const val = typeof save.settings[v.key] === 'number' ? save.settings[v.key] : 0.7;
            ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = `600 26px ${FONT}`;
            ctx.fillText(v.label, innerX, y + 26);
            const barX = innerX + innerW - 360, barW = 240, barY = y + 16;
            // minus
            const mr = { x: barX - 56, y: y + 2, w: 44, h: 44 };
            this._button(ctx, mr, '−', { action: 'volDown', arg: v.key, fontSize: 30 });
            roundRectPath(ctx, barX, barY, barW, 14, 7); ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill();
            roundRectPath(ctx, barX, barY, barW * clamp01(val), 14, 7); ctx.fillStyle = '#ffce54'; ctx.fill();
            const pr = { x: barX + barW + 12, y: y + 2, w: 44, h: 44 };
            this._button(ctx, pr, '+', { action: 'volUp', arg: v.key, fontSize: 30 });
            ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `600 20px ${FONT}`;
            ctx.fillText(`${Math.round(val * 100)}%`, barX + barW + 64, y + 24);
            y += 60;
        }
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = `500 18px ${FONT}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText('Audio is not yet implemented — volume is saved for a future update.', innerX, y + 20);
    }

    // ── CASE OPENING OVERLAY ─────────────────────────────────────────────
    _drawCaseOverlay(ctx, anim) {
        ctx.fillStyle = 'rgba(0,0,0,0.78)';
        ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
        const cx = INTERNAL_WIDTH / 2, cy = INTERNAL_HEIGHT / 2;
        const t = anim.age;
        const reveal = 0.85;
        const result = anim.result;
        const col = result && result.rarity ? rarityColor(result.rarity) : '#ffce54';

        if (t < reveal) {
            // Shaking, glowing case box.
            const shake = (reveal - t) * 14;
            const ox = Math.sin(t * 60) * shake, oy = Math.cos(t * 53) * shake;
            const glow = 0.3 + 0.5 * (t / reveal);
            const g = ctx.createRadialGradient(cx, cy, 30, cx, cy, 280);
            g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.save(); ctx.globalAlpha = glow; ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 280, 0, Math.PI * 2); ctx.fill(); ctx.restore();
            roundRectPath(ctx, cx - 110 + ox, cy - 90 + oy, 220, 180, 18);
            ctx.fillStyle = '#3a3344'; ctx.fill();
            ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.stroke();
            ctx.fillStyle = '#ffd86b'; ctx.font = `800 80px ${FONT}`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('?', cx + ox, cy + oy);
        } else {
            // Reveal card.
            const k = easeOutCubic(clamp01((t - reveal) / 0.4));
            const cardW = 460 * k, cardH = 260 * k;
            const g = ctx.createRadialGradient(cx, cy, 30, cx, cy, 360);
            g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.save(); ctx.globalAlpha = 0.55; ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 360, 0, Math.PI * 2); ctx.fill(); ctx.restore();
            roundRectPath(ctx, cx - cardW / 2, cy - cardH / 2, cardW, cardH, 18);
            ctx.fillStyle = 'rgba(24,28,38,0.97)'; ctx.fill();
            ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.stroke();
            if (k > 0.7 && result) {
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillStyle = col; ctx.font = `700 30px ${FONT}`;
                ctx.fillText(rarityName(result.rarity).toUpperCase(), cx, cy - 56);
                ctx.fillStyle = '#fff'; ctx.font = `800 40px ${FONT}`;
                ctx.fillText(result.kind === 'duplicate' ? 'DUPLICATE' : (result.name || result.label), cx, cy);
                ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = `600 24px ${FONT}`;
                ctx.fillText(result.kind === 'duplicate' || result.kind === 'coins' || result.kind === 'bpxp'
                    ? result.label : 'Unlocked!', cx, cy + 50);
                ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `600 22px ${FONT}`;
                ctx.fillText('Tap / Space to continue', cx, cy + cardH / 2 + 40);
            }
        }
        // Whole screen continues the overlay.
        this._hot(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT, 'caseContinue', null);
    }
}
