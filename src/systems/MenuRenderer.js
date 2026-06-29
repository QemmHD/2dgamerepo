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
import { INTERNAL_WIDTH, INTERNAL_HEIGHT, DIFFICULTY, DIFFICULTY_ORDER, RUN_MODIFIERS } from '../config/GameConfig.js';
import { rarityColor, rarityName, RARITIES } from '../content/rarities.js';
import {
    GEAR, GEAR_CATEGORIES, GEAR_CATEGORY_LABELS, gearByCategory, buffSummary,
} from '../content/gear.js';
import {
    COSMETICS, COSMETIC_CATEGORIES, COSMETIC_CATEGORY_LABELS, cosmeticsByCategory, resolveAppearance,
} from '../content/cosmetics.js';
import { CASES, CASE_ORDER, caseOddsRows, WAGER_BETS } from './CaseSystem.js';
import { MAPS, MAP_ORDER, isMapUnlocked } from '../content/maps.js';
import { BATTLE_PASS_LEVELS, BP_MAX_LEVEL, bpProgress } from '../content/battlePass.js';
import { rewardLabel } from './BattlePassSystem.js';
import { PERMANENT_UPGRADES, nextCost } from '../content/permanentUpgrades.js';
import { CHARACTERS, CHARACTER_IDS, getCharacter } from '../content/characters.js';
import { getCharacterFrames, drawCloakShape, drawHatShape, drawWeaponSkinOverlay } from '../assets/ProceduralSprites.js';
import { resolveStartingWeapon } from './LoadoutSystem.js';
import { resolveWeaponSkin } from '../content/weaponSkins.js';
import { ACHIEVEMENTS } from '../content/achievements.js';

const FONT = '-apple-system, system-ui, Helvetica, Arial, sans-serif';

// Each tab carries an accent color so the menu reads as color-coded sections
// at a glance (the active tab tints to its own hue; inactive tabs show a thin
// accent underline). Cool→warm grouping: play/progress greens & golds, economy
// ambers, cosmetic violet, utility grey.
export const MENU_TABS = [
    { id: 'play', label: 'PLAY', accent: '#5fd36a' },
    { id: 'skills', label: 'SKILLS', accent: '#7fd0ff' },
    { id: 'loadout', label: 'LOADOUT', accent: '#ffce54' },
    { id: 'character', label: 'CHARACTER', accent: '#c08bff' },
    { id: 'shop', label: 'SHOP', accent: '#ff9a4a' },
    { id: 'battlepass', label: 'BATTLE PASS', accent: '#ff5a8a' },
    { id: 'stats', label: 'STATS', accent: '#a8d5f7' },
    { id: 'settings', label: 'SETTINGS', accent: '#9fb0c4' },
];

const SETTING_TOGGLES = [
    { key: 'debug', label: 'Debug Mode' },
    { key: 'screenShake', label: 'Screen Shake' },
    { key: 'damageNumbers', label: 'Damage Numbers' },
    { key: 'particles', label: 'Particles' },
    { key: 'reducedEffects', label: 'Reduced Effects (mobile)' },
    { key: 'unlockMaps', label: 'Unlock All Maps (testing)' },
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
        // Wall-clock seconds for menu animations (title shimmer, tab glow,
        // START pulse, selected-chip glow). Frame-rate independent.
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
        if (this._t0 === undefined) this._t0 = now;
        this._t = (now - this._t0) / 1000;
        const t = this._t;

        // Backdrop.
        ctx.fillStyle = '#0a0d12';
        ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

        // Header: title (animated warm shimmer + glow) + coin bank.
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.save();
        const tg = ctx.createLinearGradient(sa.left + 56, 0, sa.left + 56 + 420, 0);
        const off = Math.sin(t * 1.2) * 0.5 + 0.5;
        tg.addColorStop(Math.max(0, off - 0.3), '#ffb43a');
        tg.addColorStop(off, '#fff1b8');
        tg.addColorStop(Math.min(1, off + 0.3), '#ffb43a');
        ctx.fillStyle = tg;
        ctx.shadowColor = 'rgba(255,180,60,0.45)';
        ctx.shadowBlur = 18;
        ctx.font = `800 52px ${FONT}`;
        ctx.fillText('EMBERWAKE', sa.left + 56, sa.top + 70);
        ctx.restore();
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
        else if (tab === 'stats') this._drawStats(ctx, state);
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
        const time = this._t || 0;
        for (let i = 0; i < MENU_TABS.length; i++) {
            const t = MENU_TABS[i];
            const x = x0 + i * (tabW + gap);
            const active = t.id === activeTab;
            const accent = t.accent || '#ffce54';
            ctx.save();
            if (active) { ctx.shadowColor = accent; ctx.shadowBlur = 14 + Math.sin(time * 4) * 6; }
            roundRectPath(ctx, x, y, tabW, h, 12);
            ctx.fillStyle = active ? accent : 'rgba(30,36,46,0.9)';
            ctx.fill();
            ctx.restore();
            ctx.strokeStyle = active ? accent : 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = active ? '#10141c' : 'rgba(235,240,248,0.85)';
            ctx.font = `700 ${tabW < 230 ? 20 : 23}px ${FONT}`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(t.label, x + tabW / 2, y + h / 2 + 1);
            if (active) {
                // Active tab gets a hue-cycling RGB underline that draws the eye.
                const hue = (time * 90 + i * 40) % 360;
                ctx.fillStyle = `hsl(${hue}, 95%, 62%)`;
                ctx.fillRect(x + 12, y + h - 6, tabW - 24, 4);
            } else {
                // Inactive tabs keep a thin static accent underline (section identity).
                ctx.fillStyle = accent;
                ctx.globalAlpha = 0.7;
                ctx.fillRect(x + 14, y + h - 7, tabW - 28, 3);
                ctx.globalAlpha = 1;
            }
            this._hot(x, y, tabW, h, 'tab', t.id);
        }
    }

    // ── PLAY ───────────────────────────────────────────────────────────
    _drawPlay(ctx, state) {
        const c = this._contentRect();
        const save = state.saveData;

        // Left: character preview + selection card.
        const cardW = c.w * 0.42;
        this._panel(ctx, c.x, c.y, cardW, c.h);
        const ccx = c.x + cardW / 2;
        const ch = getCharacter(save.selectedCharacter);
        const ap = resolveAppearance(save.cosmetics.equipped);
        // Avatar reflects the selected character's color unless a fur cosmetic
        // overrides it (cosmetics apply on top of the character).
        // The menu model is the REAL in-game character sprite (correct
        // silhouette + palette), with equipped cosmetics layered over it.
        const avatarAp = { ...ap, furColor: ap.furColor || ch.palette.fur };
        let charSprite = null;
        try { charSprite = getCharacterFrames(ch.id, ch)[0]; } catch (e) { charSprite = null; }
        // The selected starting weapon drives the themed skin overlay so the
        // preview matches the in-game look (character + cosmetics + weapon).
        const skin = resolveWeaponSkin(resolveStartingWeapon(save));
        // this._t (wall-clock seconds, frame-rate independent) is set in draw()
        // and drives the avatar's subtle idle motion.
        this._drawAvatar(ctx, ccx, c.y + c.h * 0.26, 118, avatarAp, charSprite, skin, this._t);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff'; ctx.font = `700 30px ${FONT}`;
        ctx.fillText(`${ch.name} — ${ch.title}`, ccx, c.y + c.h * 0.46);
        // Themed-skin caption (driven by the equipped starting weapon).
        if (skin) {
            ctx.fillStyle = skin.accent; ctx.font = `700 16px ${FONT}`;
            ctx.fillText(`${skin.name} skin`, ccx, c.y + c.h * 0.435);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `500 18px ${FONT}`;
        this._wrapText(ctx, ch.description, ccx, c.y + c.h * 0.51, cardW - 60, 22, 2);

        // Character picker: a 3-wide grid of selectable hero chips (fits the
        // six heroes in two tidy rows).
        ctx.font = `700 18px ${FONT}`;
        ctx.fillStyle = '#cdd6e2'; ctx.textAlign = 'left';
        ctx.fillText('CHARACTER', c.x + 30, c.y + c.h * 0.58);
        const cols = 3, gap = 10;
        const chipW = (cardW - 60 - gap * (cols - 1)) / cols;
        const chipH = 46;
        const gridY = c.y + c.h * 0.6;
        for (let i = 0; i < CHARACTER_IDS.length; i++) {
            const id = CHARACTER_IDS[i];
            const def = CHARACTERS[id];
            const col = i % cols, row = Math.floor(i / cols);
            const x = c.x + 30 + col * (chipW + gap);
            const y = gridY + row * (chipH + gap);
            const selected = id === save.selectedCharacter;
            roundRectPath(ctx, x, y, chipW, chipH, 9);
            ctx.fillStyle = selected ? 'rgba(255,206,84,0.16)' : 'rgba(255,255,255,0.04)';
            ctx.fill();
            ctx.strokeStyle = selected ? '#ffce54' : def.accent; ctx.lineWidth = selected ? 3 : 2; ctx.stroke();
            // Color swatch.
            ctx.fillStyle = def.palette.fur;
            ctx.beginPath(); ctx.arc(x + 24, y + chipH / 2, 11, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = selected ? '#ffce54' : '#fff'; ctx.font = `700 18px ${FONT}`;
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(def.name, x + 42, y + chipH / 2);
            this._hot(x, y, chipW, chipH, 'selectCharacter', { id });
        }

        // Battle-pass mini progress.
        const prog = bpProgress(save.battlePass.xp);
        const barY = c.y + c.h * 0.86;
        const barW = cardW - 80;
        const barX = c.x + 40;
        ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = `600 20px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText(`Battle Pass — Lv ${prog.level}${prog.atMax ? ' (MAX)' : ''}`, barX, barY - 16);
        roundRectPath(ctx, barX, barY, barW, 18, 9); ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill();
        roundRectPath(ctx, barX, barY, barW * clamp01(prog.fraction), 18, 9); ctx.fillStyle = '#9a6cff'; ctx.fill();

        // ── Right column: equipped loadout + biome / difficulty / trials +
        // START. The whole stack is laid out top→down with ONE vertical scale
        // `s` so it always fits c.h — on short panels (iPhone landscape, where
        // cover-fit crop shrinks the content rect) every row + gap compresses
        // instead of overrunning the START button. ──────────────────────────
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        const t = this._t || 0;
        const rx = c.x + cardW + 36;
        const rw = c.w - cardW - 36;
        const innerX = rx + 28, innerW = rw - 56;
        this._panel(ctx, rx, c.y, rw, c.h);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#cdd6e2'; ctx.font = `700 24px ${FONT}`;
        ctx.fillText('Equipped Loadout', innerX, c.y + 38);

        const eq = save.gear.equipped;
        const curDiff = state.difficulty || 'normal';
        const activeMods = state.selectedModifiers || [];

        // START reserved at the bottom; the four sections fit in the gap above.
        const startH = clamp(c.h * 0.12, 56, 84);
        const startY = c.y + c.h - startH;
        const top = c.y + 52;
        const avail = startY - top - 12;
        const nGear = GEAR_CATEGORIES.length;
        const N = { gearRow: 52, gearGap: 9, sec: 18, lbl: 30, biome: 60, diff: 46, chip: 38, chipGap: 8 };
        // The TRUE laid-out height for a given scale. Labels + chip rows have
        // their own lower floors (so text stays legible), which is exactly why
        // a naive avail/needed under-budgets — so we MEASURE with the real
        // floors and binary-search the largest scale that fits `avail`. This
        // keeps the stated "always fits c.h" invariant on any panel (the floors
        // only affect how big things look when there's room, never overlap).
        const lblScale = (s) => Math.max(s, 0.82);
        const chipScale = (s) => Math.max(s, 0.8);
        const fitH = (s) =>
            nGear * N.gearRow * s + (nGear - 1) * N.gearGap * s + N.sec * s
            + N.lbl * lblScale(s) + N.biome * s + N.sec * s
            + N.lbl * lblScale(s) + N.diff * s + N.sec * s
            + N.lbl * lblScale(s) + (2 * N.chip * chipScale(s) + N.chipGap * s);
        let s = 1;
        if (fitH(1) > avail) {                        // doesn't fit at full size → shrink to fit
            let lo = 0.2, hi = 1;
            for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fitH(mid) <= avail) lo = mid; else hi = mid; }
            s = lo;
        }
        s = clamp(s, 0.2, 1);
        const lblS = lblScale(s);                     // labels shrink less (stay legible)
        const gearRow = N.gearRow * s, gearGap = N.gearGap * s, sec = N.sec * s,
            lbl = N.lbl * lblS, biomeRow = N.biome * s, diffRow = N.diff * s,
            chipRow = N.chip * chipScale(s), chipGap = N.chipGap * s;
        const fs = (px) => Math.round(px * lblS);     // font-size scaler

        let y = top;
        // Loadout rows.
        for (const cat of GEAR_CATEGORIES) {
            const item = GEAR[eq[cat]];
            const col = item ? rarityColor(item.rarity) : 'rgba(255,255,255,0.25)';
            roundRectPath(ctx, innerX, y, innerW, gearRow, 10);
            ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
            ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `600 ${fs(16)}px ${FONT}`;
            ctx.fillText(GEAR_CATEGORY_LABELS[cat], innerX + 16, y + gearRow * 0.40);
            ctx.fillStyle = '#fff'; ctx.font = `700 ${fs(21)}px ${FONT}`;
            ctx.fillText(item ? item.name : '— empty —', innerX + 16, y + gearRow * 0.82);
            y += gearRow + gearGap;
        }
        y += sec - gearGap;

        // Biome selector.
        ctx.fillStyle = '#cdd6e2'; ctx.font = `700 ${fs(20)}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText('Biome', innerX, y + lbl * 0.72);
        y += lbl;
        const bw = (innerW - 14 * (MAP_ORDER.length - 1)) / MAP_ORDER.length;
        const totalBosses = save.stats?.totalBosses ?? 0;
        const selMap = save.selectedMap ?? MAP_ORDER[0];
        for (let i = 0; i < MAP_ORDER.length; i++) {
            const m = MAPS[MAP_ORDER[i]];
            const unlocked = isMapUnlocked(m.id, totalBosses);
            const sel = m.id === selMap;
            const bx = innerX + i * (bw + 14);
            roundRectPath(ctx, bx, y, bw, biomeRow, 10);
            ctx.fillStyle = sel ? 'rgba(255,206,84,0.16)' : 'rgba(255,255,255,0.04)'; ctx.fill();
            if (sel) this._selGlow(ctx, bx, y, bw, biomeRow, 10, '#ffce54', t);
            ctx.strokeStyle = sel ? '#ffce54' : unlocked ? m.accent : 'rgba(255,255,255,0.12)';
            ctx.lineWidth = sel ? 3 : 2; ctx.stroke();
            ctx.globalAlpha = unlocked ? 1 : 0.5;
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = '#fff'; ctx.font = `700 ${fs(18)}px ${FONT}`;
            ctx.fillText(m.name, bx + 14, y + biomeRow * 0.42);
            ctx.fillStyle = unlocked ? m.accent : 'rgba(255,255,255,0.6)'; ctx.font = `500 ${fs(13)}px ${FONT}`;
            ctx.fillText(unlocked ? m.subtitle : `🔒 ${m.unlockBosses} bosses`, bx + 14, y + biomeRow * 0.76);
            ctx.globalAlpha = 1;
            this._hot(bx, y, bw, biomeRow, 'selectMap', { id: m.id });
        }
        y += biomeRow + sec;

        // Difficulty row (3 tiers).
        ctx.fillStyle = '#cdd6e2'; ctx.font = `700 ${fs(19)}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText('Difficulty', innerX, y + lbl * 0.72);
        y += lbl;
        const dW = (innerW - 20) / 3;
        for (let i = 0; i < DIFFICULTY_ORDER.length; i++) {
            const d = DIFFICULTY[DIFFICULTY_ORDER[i]];
            const dx = innerX + i * (dW + 10);
            const sel = curDiff === d.id;
            roundRectPath(ctx, dx, y, dW, diffRow, 9);
            ctx.fillStyle = sel ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.03)'; ctx.fill();
            if (sel) this._selGlow(ctx, dx, y, dW, diffRow, 9, d.color, t);
            ctx.strokeStyle = sel ? d.color : 'rgba(255,255,255,0.14)'; ctx.lineWidth = sel ? 3 : 2; ctx.stroke();
            ctx.fillStyle = sel ? d.color : '#fff'; ctx.font = `700 ${fs(17)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(d.label, dx + dW / 2, y + diffRow / 2);
            this._hot(dx, y, dW, diffRow, 'setDifficulty', d.id);
        }
        y += diffRow + sec;

        // Trials toggles (6 chips, 3×2). Active ones glow + show the reward %.
        ctx.fillStyle = '#cdd6e2'; ctx.font = `700 ${fs(19)}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        const bonusPct = Math.round(activeMods.reduce((a, id) => {
            const m = RUN_MODIFIERS.find((x) => x.id === id); return a + (m ? (m.xpBonus || 0) : 0);
        }, 0) * 100);
        ctx.fillText(`Trials${bonusPct > 0 ? `  (+${bonusPct}% XP)` : ''}`, innerX, y + lbl * 0.72);
        y += lbl;
        const tcols = 3, tgap = 8;
        const tW = (innerW - tgap * (tcols - 1)) / tcols;
        for (let i = 0; i < RUN_MODIFIERS.length; i++) {
            const m = RUN_MODIFIERS[i];
            const col = i % tcols, row = Math.floor(i / tcols);
            const mx = innerX + col * (tW + tgap), my = y + row * (chipRow + chipGap);
            const on = activeMods.includes(m.id);
            roundRectPath(ctx, mx, my, tW, chipRow, 8);
            ctx.fillStyle = on ? 'rgba(255,206,84,0.16)' : 'rgba(255,255,255,0.03)'; ctx.fill();
            if (on) this._selGlow(ctx, mx, my, tW, chipRow, 8, '#ffce54', t);
            ctx.strokeStyle = on ? '#ffce54' : 'rgba(255,255,255,0.12)'; ctx.lineWidth = on ? 3 : 2; ctx.stroke();
            ctx.fillStyle = on ? '#ffce54' : '#cdd6e2'; ctx.font = `700 ${fs(14)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(m.name, mx + tW / 2, my + chipRow / 2);
            this._hot(mx, my, tW, chipRow, 'toggleModifier', m.id);
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

        // START RUN — animated (RGB hue-cycle border + warm sheen sweep + glow).
        this._drawStartButton(ctx, { x: innerX, y: startY, w: innerW, h: startH }, t);
    }

    // Pulsing accent glow behind a SELECTED chip (biome / difficulty / trial).
    _selGlow(ctx, x, y, w, h, r, color, t) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, 0.45 + Math.sin(t * 4) * 0.28);
        ctx.shadowColor = color; ctx.shadowBlur = 16;
        ctx.strokeStyle = color; ctx.lineWidth = 2.5;
        roundRectPath(ctx, x, y, w, h, r); ctx.stroke();
        ctx.restore();
    }

    // The big call-to-action: a green button with a moving warm sheen, a
    // hue-cycling RGB border, and a soft pulsing glow — hard to miss.
    _drawStartButton(ctx, r, t) {
        ctx.save();
        const hue = (t * 70) % 360;
        ctx.shadowColor = `hsl(${hue}, 90%, 58%)`;
        ctx.shadowBlur = 22 + Math.sin(t * 3) * 8;
        const sweep = Math.sin(t * 1.5) * 0.5 + 0.5;
        const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y);
        g.addColorStop(Math.max(0, sweep - 0.28), '#33a356');
        g.addColorStop(sweep, '#74e890');
        g.addColorStop(Math.min(1, sweep + 0.28), '#33a356');
        roundRectPath(ctx, r.x, r.y, r.w, r.h, 14);
        ctx.fillStyle = g; ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = `hsl(${hue}, 95%, 66%)`;
        ctx.lineWidth = 3; ctx.stroke();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.font = `800 ${Math.round(Math.min(34, r.h * 0.42))}px ${FONT}`;
        ctx.fillText('START RUN', r.x + r.w / 2, r.y + r.h / 2 - r.h * 0.12);
        ctx.font = `600 ${Math.round(Math.min(18, r.h * 0.22))}px ${FONT}`;
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fillText('Space / Enter', r.x + r.w / 2, r.y + r.h / 2 + r.h * 0.24);
        ctx.restore();
        this._hot(r.x, r.y, r.w, r.h, 'startRun', null);
    }

    // Lifetime stats showcase — surfaces what the save has always tracked.
    _drawStats(ctx, state) {
        const c = this._contentRect();
        this._panel(ctx, c.x, c.y, c.w, c.h);
        const s = (state.saveData && state.saveData.stats) || {};
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#a8d5f7'; ctx.font = `800 34px ${FONT}`;
        ctx.fillText('Lifetime Vigil', c.x + 34, c.y + 50);
        const fmtTime = (sec) => { sec = Math.floor(sec || 0); const m = Math.floor(sec / 60), ss = sec % 60; return `${m}:${String(ss).padStart(2, '0')}`; };
        const rows = [
            ['Runs', s.runs || 0], ['Total kills', s.totalKills || 0],
            ['Bosses felled', s.totalBosses || 0], ['Coins earned', s.totalCoinsEarned || 0],
            ['Cases opened', s.casesOpened || 0], ['Playtime', fmtTime(s.playtimeSec)],
            ['Best survival', fmtTime(s.bestTime)], ['Best wave', s.bestWave || 0],
            ['Best level', s.bestLevel || 0], ['Best kills (run)', s.bestKills || 0],
            ['Best Gauntlet score', s.bestGauntletScore || 0], ['Gauntlet runs', s.gauntletRuns || 0],
            ['Nightmare wins', s.hardWins || 0], ['Nightmare bosses', s.eliteBossesDefeated || 0],
        ];
        const cols = 2, gap = 24;
        const colW = (c.w - 68 - gap) / cols;
        const rowH = 46;
        const top = c.y + 86;
        for (let i = 0; i < rows.length; i++) {
            const col = i % cols, row = Math.floor(i / cols);
            const x = c.x + 34 + col * (colW + gap), y = top + row * rowH;
            roundRectPath(ctx, x, y, colW, rowH - 8, 8);
            ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = `600 18px ${FONT}`; ctx.textAlign = 'left';
            ctx.fillText(rows[i][0], x + 16, y + 25);
            ctx.fillStyle = '#fff'; ctx.font = `800 22px ${FONT}`; ctx.textAlign = 'right';
            ctx.fillText(String(rows[i][1]), x + colW - 16, y + 26);
        }

        // Achievements grid (locked = greyed, earned = gold check). Read-only.
        const claimed = (state.saveData && state.saveData.achievements && state.saveData.achievements.claimed) || [];
        const aTop = top + Math.ceil(rows.length / cols) * rowH + 16;
        const earnedN = ACHIEVEMENTS.filter((a) => claimed.includes(a.id)).length;
        ctx.fillStyle = '#ffce54'; ctx.font = `800 24px ${FONT}`; ctx.textAlign = 'left';
        ctx.fillText(`Achievements  ${earnedN}/${ACHIEVEMENTS.length}`, c.x + 34, aTop);
        const acols = 3, agap = 14;
        const aW = (c.w - 68 - agap * (acols - 1)) / acols;
        const aH = 52;
        const arTop = aTop + 16;
        for (let i = 0; i < ACHIEVEMENTS.length; i++) {
            const a = ACHIEVEMENTS[i];
            const col = i % acols, row = Math.floor(i / acols);
            const x = c.x + 34 + col * (aW + agap), y = arTop + row * (aH + 8);
            if (y + aH > c.y + c.h - 8) break; // clip to panel
            const got = claimed.includes(a.id);
            roundRectPath(ctx, x, y, aW, aH, 8);
            ctx.fillStyle = got ? 'rgba(255,206,84,0.14)' : 'rgba(255,255,255,0.03)'; ctx.fill();
            ctx.strokeStyle = got ? '#ffce54' : 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = got ? '#ffce54' : '#cdd6e2'; ctx.font = `800 16px ${FONT}`; ctx.textAlign = 'left';
            ctx.fillText(`${got ? '✓ ' : ''}${a.name}`, x + 12, y + 22);
            ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `500 12px ${FONT}`;
            ctx.fillText(a.desc.length > 38 ? a.desc.slice(0, 37) + '…' : a.desc, x + 12, y + 40);
        }
        ctx.textAlign = 'left';
    }

    // Avatar honoring aura/fur/cloak/hat cosmetics. When `sprite` (the real
    // cached character frame) is supplied it's drawn as the body so the menu
    // model exactly matches the selected character; otherwise a procedural
    // blob is used as a fallback.
    _drawAvatar(ctx, cx, cy, r, ap, sprite = null, skin = null, t = 0) {
        // The avatar draws the body sprite at S=r*2.4, so the shared cosmetic +
        // weapon-skin helpers (authored in sprite-half units) take s = S/2.
        const S = r * 2.4;
        const s = S / 2;
        ctx.save();
        if (ap.auraColor) {
            const g = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 1.4);
            g.addColorStop(0, ap.auraColor); g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.4;
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2); ctx.fill();
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        }
        // Cloak (shared shape — matches the in-game player exactly).
        if (ap.cloakColor) drawCloakShape(ctx, cx, cy, s, ap.cloakColor);
        if (sprite) {
            // Real character sprite as the body, sized to the avatar box.
            ctx.drawImage(sprite, cx - S / 2, cy - S / 2, S, S);
        } else {
            // Fallback procedural blob.
            ctx.fillStyle = ap.furColor || '#8a6a4a';
            ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#e8d3b0';
            ctx.beginPath(); ctx.arc(cx, cy - r * 0.05, r * 0.4, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#2a2018';
            ctx.beginPath(); ctx.arc(cx - r * 0.16, cy - r * 0.1, r * 0.06, 0, Math.PI * 2);
            ctx.arc(cx + r * 0.16, cy - r * 0.1, r * 0.06, 0, Math.PI * 2); ctx.fill();
        }
        // Weapon-themed skin overlay (shared with the in-game player), then hat
        // on top — identical layering + geometry so the preview never diverges.
        if (skin) drawWeaponSkinOverlay(ctx, cx, cy, s, skin, t);
        if (ap.hatShape && ap.hatShape !== 'none') drawHatShape(ctx, cx, cy, s, ap.hatShape, ap.hatColor);
        ctx.restore();
    }

    // Center-aligned word wrap (caller sets fillStyle/font/textAlign='center').
    _wrapText(ctx, text, cx, y, maxWidth, lineHeight, maxLines = 3) {
        const words = String(text).split(/\s+/);
        const lines = [];
        let line = '';
        for (const w of words) {
            const test = line ? line + ' ' + w : w;
            if (ctx.measureText(test).width > maxWidth && line) {
                lines.push(line);
                line = w;
                if (lines.length >= maxLines - 1) break;
            } else {
                line = test;
            }
        }
        if (line && lines.length < maxLines) lines.push(line);
        const prevAlign = ctx.textAlign;
        ctx.textAlign = 'center';
        for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, y + i * lineHeight);
        ctx.textAlign = prevAlign;
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
            // Color-coded state: green = maxed, gold = affordable now, dim =
            // can't afford. The card tints + gets a left accent bar so the eye
            // is drawn to what's buyable.
            const stateCol = maxed ? '#5fd36a' : afford ? '#ffce54' : 'rgba(255,255,255,0.12)';
            roundRectPath(ctx, x, y, cardW, cardH, 12);
            ctx.fillStyle = afford ? 'rgba(46,40,18,0.92)' : maxed ? 'rgba(20,34,24,0.92)' : 'rgba(22,27,36,0.9)';
            ctx.fill();
            ctx.strokeStyle = stateCol;
            ctx.lineWidth = afford || maxed ? 2.5 : 2; ctx.stroke();
            // Left accent bar.
            ctx.fillStyle = stateCol;
            ctx.fillRect(x + 4, y + 12, 5, cardH - 24);
            ctx.textAlign = 'left';
            ctx.fillStyle = '#fff'; ctx.font = `700 25px ${FONT}`;
            ctx.fillText(u.name, x + 22, y + 34);
            ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = `500 19px ${FONT}`;
            ctx.fillText(u.description, x + 22, y + 58);
            // Segmented level progress bar (filled = owned levels).
            const segGap = 4, segY = y + 74, segH = 8;
            const segW = (210 - segGap * (u.maxLevel - 1)) / u.maxLevel;
            for (let s = 0; s < u.maxLevel; s++) {
                ctx.fillStyle = s < level ? stateCol : 'rgba(255,255,255,0.12)';
                ctx.fillRect(x + 22 + s * (segW + segGap), segY, Math.max(2, segW), segH);
            }
            ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `600 15px ${FONT}`;
            ctx.fillText(`Lv ${level}/${u.maxLevel}`, x + 22, y + 90);
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
            // Gear cards are taller so each can carry a short line describing
            // what its buffs actually DO (the player asked for this); cosmetics
            // have no buffs, so they stay compact.
            const ih = kind === 'gear' ? 88 : 64, ig = 10;
            const innerW = colW - 24;
            for (const item of items) {
                if (iy + ih > c.y + c.h - 8) break; // clip to column
                const unlocked = isUnlocked(item.id);
                const equippedHere = equipped[cat] === item.id;
                const col = rarityColor(item.rarity);
                roundRectPath(ctx, x + 12, iy, innerW, ih, 10);
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
                // Gear: short effect summary so the player knows what each item
                // grants. Buff bag → human strings; a buffless starting weapon
                // falls back to its flavor description (trimmed to one line).
                if (kind === 'gear') {
                    const buffs = buffSummary(item.buffs);
                    const text = (buffs.length ? buffs.join(' · ')
                        : (item.description || '').replace(/^Start (?:each vigil )?with the [^.]+\.\s*/i, '').trim())
                        || 'No bonuses — base option.';
                    ctx.fillStyle = 'rgba(206,214,226,0.82)';
                    ctx.font = `500 13px ${FONT}`;
                    // Word-wrap to at most two lines within the card width.
                    const maxW = innerW - 28;
                    const words = text.split(/\s+/);
                    const lines = [];
                    let line = '';
                    for (const w of words) {
                        const test = line ? line + ' ' + w : w;
                        if (ctx.measureText(test).width > maxW && line) {
                            lines.push(line); line = w;
                            if (lines.length >= 2) break;
                        } else line = test;
                    }
                    if (line && lines.length < 2) lines.push(line);
                    for (let li = 0; li < lines.length; li++) ctx.fillText(lines[li], x + 26, iy + 68 + li * 16);
                }
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
        const gap = 24;
        // Six cases (gear + cosmetic per tier) → a 3-column, 2-row grid so the
        // names + odds aren't crushed into thin slivers.
        const cols = 3;
        const rows = Math.ceil(CASE_ORDER.length / cols);
        // Reserve a strip at the bottom for the Ember Forge.
        const forgeH = 168;
        const gridH = c.h - forgeH - 24;
        const cardW = (c.w - gap * (cols - 1)) / cols;
        const rowH = (gridH - gap * (rows - 1)) / rows;
        ctx.textBaseline = 'alphabetic';
        for (let i = 0; i < CASE_ORDER.length; i++) {
            const def = CASES[CASE_ORDER[i]];
            const col = i % cols, row = Math.floor(i / cols);
            const x = c.x + col * (cardW + gap);
            const y = c.y + row * (rowH + gap);
            this._panel(ctx, x, y, cardW, rowH, 'rgba(18,22,30,0.9)');
            ctx.textAlign = 'center';
            ctx.fillStyle = '#fff'; ctx.font = `800 26px ${FONT}`;
            ctx.fillText(def.name, x + cardW / 2, y + 40);
            // OPEN button anchored at the card bottom; the odds rows fill the
            // space BETWEEN the title and the button (spacing compresses to fit)
            // so the lower rarities never render behind the button.
            const afford = save.totalCoins >= def.cost;
            const btnH = Math.min(54, rowH * 0.27);
            const br = { x: x + 30, y: y + rowH - btnH - 14, w: cardW - 60, h: btnH };
            const oddsRows = caseOddsRows(def.id);
            const oTop = y + 62, oBot = br.y - 12;
            const n = Math.max(1, oddsRows.length);
            const step = Math.min(30, (oBot - oTop) / n);
            const ofs = Math.round(Math.max(12, Math.min(19, step * 0.64)));
            ctx.font = `600 ${ofs}px ${FONT}`;
            let oy = oTop + step * 0.72;
            for (const r of oddsRows) {
                ctx.textAlign = 'left'; ctx.fillStyle = rarityColor(r.rarity);
                ctx.fillText(rarityName(r.rarity), x + 28, oy);
                ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.85)';
                ctx.fillText(`${r.pct}%`, x + cardW - 28, oy);
                oy += step;
            }
            // Always clickable: an unaffordable tap surfaces a "Not enough
            // coins" toast rather than silently doing nothing.
            this._button(ctx, br, `OPEN  ◎ ${def.cost}`,
                { primary: afford, enabled: true, accent: afford ? null : 'rgba(60,66,78,0.9)', action: 'openCase', arg: def.id, fontSize: Math.round(Math.min(24, btnH * 0.44)) });
        }

        // ── Cinder Wager strip: a skill coin-gamble. Pick a stake, then STOP
        // the sweeping spark on the multiplier bar (center = jackpot). ──
        const fy = c.y + gridH + 24;
        this._panel(ctx, c.x, fy, c.w, forgeH, 'rgba(30,20,14,0.92)', '#ff8a4a');
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#ffb24a'; ctx.font = `800 30px ${FONT}`;
        ctx.fillText('💣  MINES', c.x + 32, fy + 46);
        // Hourly play quota.
        const plays = state.gamblePlays || { remaining: 5, max: 5, resetInMs: 0 };
        ctx.textAlign = 'left';
        ctx.fillStyle = plays.remaining > 0 ? '#7be08a' : '#ff6a5a';
        ctx.font = `700 22px ${FONT}`;
        const resetTxt = plays.remaining < plays.max && plays.resetInMs > 0 ? ` · resets in ${Math.ceil(plays.resetInMs / 60000)}m` : '';
        ctx.fillText(`Plays: ${plays.remaining}/${plays.max}${resetTxt}`, c.x + 220, fy + 46);
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `500 20px ${FONT}`;
        ctx.fillText('Stake coins, dig safe tiles to climb the multiplier — cash out before you hit a mine. 5 plays per hour.', c.x + 32, fy + 78);
        // Three stake buttons (greyed when no plays remain).
        const bets = WAGER_BETS;
        const bw = 200, bgap = 18;
        const totalW = bets.length * bw + (bets.length - 1) * bgap;
        let bx = c.x + c.w - totalW - 32;
        for (const bet of bets) {
            const aff = save.totalCoins >= bet && plays.remaining > 0;
            const r = { x: bx, y: fy + 96, w: bw, h: 56 };
            this._button(ctx, r, `BET  ◎ ${bet}`,
                { primary: aff, enabled: true, accent: aff ? '#7a3a18' : 'rgba(60,66,78,0.9)', action: 'openMines', arg: bet, fontSize: 24 });
            bx += bw + bgap;
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
        ctx.fillText('Themed music + sound effects. Adjust to taste; 0% mutes.', innerX, y + 20);

        // ── Cheats (testing) ──────────────────────────────────────────────
        y += 52;
        ctx.fillStyle = '#ff8a5c'; ctx.font = `700 22px ${FONT}`;
        ctx.fillText('CHEATS (testing)', innerX, y + 6);
        ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = `500 17px ${FONT}`;
        ctx.fillText('Grant coins / unlock everything to test cases, gear & cosmetics.', innerX + 220, y + 6);
        y += 22;
        const cheats = [
            { label: '+1,000 ◎', action: 'cheatCoins', arg: 1000 },
            { label: '+10,000 ◎', action: 'cheatCoins', arg: 10000 },
            { label: 'Unlock All Items', action: 'cheatUnlockAll', arg: null },
        ];
        const cbW = (innerW - 2 * 20) / 3, cbH = 56;
        for (let i = 0; i < cheats.length; i++) {
            const ch = cheats[i];
            const r = { x: innerX + i * (cbW + 20), y, w: cbW, h: cbH };
            this._button(ctx, r, ch.label, { accent: '#5a3a22', action: ch.action, arg: ch.arg, fontSize: 22 });
        }
    }

    // ── CASE OPENING OVERLAY ─────────────────────────────────────────────
    _drawCaseOverlay(ctx, anim) {
        ctx.fillStyle = 'rgba(0,0,0,0.78)';
        ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
        const cx = INTERNAL_WIDTH / 2, cy = INTERNAL_HEIGHT / 2;
        const t = anim.age;
        const reveal = anim.reel ? (anim.spinTime ?? 2.6) : 0.85;
        const result = anim.result;
        const col = result && result.rarity ? rarityColor(result.rarity) : '#ffce54';

        if (t < reveal && anim.reel) {
            // CS:GO-style spin reel: a horizontal strip scrolls + decelerates so
            // the won item (at landingIndex) settles under the center marker.
            const cellW = 168, cellH = 132, gap = 10;
            const stride = cellW + gap;
            const frac = easeOutCubic(clamp01(t / reveal));
            const offset = frac * anim.landingIndex * stride;
            ctx.save();
            // Reel band background + clip.
            const bandY = cy - cellH / 2;
            roundRectPath(ctx, 0, bandY - 8, INTERNAL_WIDTH, cellH + 16, 0);
            ctx.fillStyle = 'rgba(8,10,16,0.92)'; ctx.fill();
            ctx.save();
            ctx.beginPath(); ctx.rect(60, bandY - 8, INTERNAL_WIDTH - 120, cellH + 16); ctx.clip();
            for (let i = 0; i < anim.reel.length; i++) {
                const cellX = cx - offset + i * stride - cellW / 2;
                if (cellX > INTERNAL_WIDTH + cellW || cellX < -cellW) continue;
                const cell = anim.reel[i];
                const cc = rarityColor(cell.rarity);
                roundRectPath(ctx, cellX, bandY, cellW, cellH, 12);
                ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
                ctx.strokeStyle = cc; ctx.lineWidth = 3; ctx.stroke();
                // Rarity badge + a kind LOGO (gear vs cosmetic vs coin) + name.
                ctx.fillStyle = cc;
                ctx.beginPath(); ctx.arc(cellX + cellW / 2, bandY + cellH * 0.36, 26, 0, Math.PI * 2); ctx.fill();
                this._kindGlyph(ctx, cellX + cellW / 2, bandY + cellH * 0.36, 15, cell.kind);
                ctx.fillStyle = '#fff'; ctx.font = `700 18px ${FONT}`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                const nm = cell.name.length > 14 ? cell.name.slice(0, 13) + '…' : cell.name;
                ctx.fillText(nm, cellX + cellW / 2, bandY + cellH * 0.78);
            }
            ctx.restore();
            // Center marker.
            ctx.strokeStyle = '#ffd86b'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(cx, bandY - 14); ctx.lineTo(cx, bandY + cellH + 14); ctx.stroke();
            ctx.fillStyle = '#ffd86b';
            ctx.beginPath();
            ctx.moveTo(cx - 14, bandY - 14); ctx.lineTo(cx + 14, bandY - 14); ctx.lineTo(cx, bandY + 2); ctx.closePath(); ctx.fill();
            ctx.beginPath();
            ctx.moveTo(cx - 14, bandY + cellH + 14); ctx.lineTo(cx + 14, bandY + cellH + 14); ctx.lineTo(cx, bandY + cellH - 2); ctx.closePath(); ctx.fill();
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = `800 30px ${FONT}`;
            ctx.fillText('OPENING…', cx, bandY - 48);
            ctx.restore();
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
                // Kind logo above the rarity label.
                ctx.fillStyle = col;
                ctx.beginPath(); ctx.arc(cx, cy - 96, 24, 0, Math.PI * 2); ctx.fill();
                this._kindGlyph(ctx, cx, cy - 96, 14, result.kind);
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

    // A small white logo marking what KIND of loot a reel cell / reveal is:
    // gear = a shield, cosmetic = a sparkle star, anything else = a coin ring.
    _kindGlyph(ctx, cx, cy, s, kind) {
        ctx.save();
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#fff';
        if (kind === 'gear') {
            // Shield.
            ctx.beginPath();
            ctx.moveTo(cx, cy - s);
            ctx.lineTo(cx + s * 0.8, cy - s * 0.5);
            ctx.lineTo(cx + s * 0.8, cy + s * 0.2);
            ctx.quadraticCurveTo(cx + s * 0.8, cy + s, cx, cy + s);
            ctx.quadraticCurveTo(cx - s * 0.8, cy + s, cx - s * 0.8, cy + s * 0.2);
            ctx.lineTo(cx - s * 0.8, cy - s * 0.5);
            ctx.closePath();
            ctx.fill();
        } else if (kind === 'cosmetic') {
            // Four-point sparkle.
            ctx.beginPath();
            ctx.moveTo(cx, cy - s);
            ctx.quadraticCurveTo(cx + s * 0.18, cy - s * 0.18, cx + s, cy);
            ctx.quadraticCurveTo(cx + s * 0.18, cy + s * 0.18, cx, cy + s);
            ctx.quadraticCurveTo(cx - s * 0.18, cy + s * 0.18, cx - s, cy);
            ctx.quadraticCurveTo(cx - s * 0.18, cy - s * 0.18, cx, cy - s);
            ctx.closePath();
            ctx.fill();
        } else {
            // Coin ring (coins / vigil-XP consolation).
            ctx.lineWidth = Math.max(2, s * 0.28);
            ctx.beginPath();
            ctx.arc(cx, cy, s * 0.8, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }
}
