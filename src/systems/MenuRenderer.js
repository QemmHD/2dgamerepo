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
import { INTERNAL_WIDTH, INTERNAL_HEIGHT, DIFFICULTY, DIFFICULTY_ORDER, RUN_MODIFIERS, RUN_MODIFIER_MAX_BONUS, pactTier } from '../config/GameConfig.js';
import { rarityColor, rarityName, RARITIES } from '../content/rarities.js';
import { getRarityIcon } from '../assets/CustomIcons.js';
import { getCloakSprite } from '../assets/LpcSprites.js';
import {
    GEAR, GEAR_CATEGORIES, GEAR_CATEGORY_LABELS, gearByCategory, buffSummary,
} from '../content/gear.js';
import {
    COSMETICS, COSMETIC_CATEGORIES, COSMETIC_CATEGORY_LABELS, cosmeticsByCategory, resolveAppearance, cosmeticsForAchievement, cosmeticCoinCost,
} from '../content/cosmetics.js';
import { CASES, CASE_ORDER, caseOddsRows, caseTopRarity, casePityRemaining, CASE_PITY, WAGER_BETS } from './CaseSystem.js';
import { MAPS, MAP_ORDER, isMapUnlocked } from '../content/maps.js';
import { BATTLE_PASS_LEVELS, BP_MAX_LEVEL, bpProgress } from '../content/battlePass.js';
import { rewardLabel } from './BattlePassSystem.js';
import { PERMANENT_UPGRADES, nextCost } from '../content/permanentUpgrades.js';
import { ATTUNABLE, getRelic, attuneCost } from '../content/relics.js';
import { CHARACTERS, CHARACTER_IDS, getCharacter, resolveCharacterHold } from '../content/characters.js';
import { getHeroFrames, getGlowSprite } from '../assets/ProceduralSprites.js';
import { getMenuImages } from '../assets/MenuImages.js';
import { getGearEmblem } from '../assets/GearEmblems.js';
import { DISPLAY_FONT, ensureMenuFont } from '../assets/MenuFont.js';
import { drawPixelCloak, drawPixelHat, shade } from '../assets/PixelArt.js';
import { getWeaponProp } from '../assets/WeaponProps.js';
import { drawAuraFx, drawSetBonus, drawRarityFx } from '../assets/CosmeticFx.js';
import { resolveStartingWeapon } from './LoadoutSystem.js';
import { resolveWeaponSkin, resolveWeaponProp } from '../content/weaponSkins.js';
import { ACHIEVEMENTS } from '../content/achievements.js';
import { pickDailyChallenges, currentDayNumber } from '../content/dailyChallenges.js';
import { getDailySetup } from '../content/dailyRoad.js';
import { getRoad } from '../content/roads.js';
import { PATRONS, PATRON_IDS } from '../content/patrons.js';

const FONT = '-apple-system, system-ui, Helvetica, Arial, sans-serif';
// Display face (Cinzel, self-hosted OFL) for the forged headings — the
// wordmark, tab labels, and button labels — giving the menu a dark-fantasy
// identity. Body text / numeric readouts stay on FONT for legibility. Falls
// back to the system stack until the woff2 loads (and in a non-DOM env).
const HEAD = DISPLAY_FONT;
const TAU = Math.PI * 2;

// Each tab carries an accent color so the menu reads as color-coded sections
// at a glance (the active tab tints to its own hue; inactive tabs show a thin
// accent underline). Cool→warm grouping: play/progress greens & golds, economy
// ambers, cosmetic violet, utility grey.
export const MENU_TABS = [
    { id: 'play', label: 'PLAY', accent: '#5fd36a' },
    { id: 'skills', label: 'SKILLS', accent: '#7fd0ff' },
    { id: 'attune', label: 'ATTUNE', accent: '#ff9ecf' },
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

    // Clamped frame delta (seconds), used to damp the sliding tab indicator.
    // Snaps (via _tabStale) when the menu was off-screen for a beat so the
    // indicator doesn't fling across on the first frame back.
    _dt() {
        const t = this._t || 0;
        const prev = this._tPrev == null ? t : this._tPrev;
        let dt = t - prev;
        this._tabStale = dt > 0.2 || dt < 0;
        this._tPrev = t;
        return Math.max(0, Math.min(0.05, dt));
    }

    // ── Atmospheric backdrop ("ember forge") ───────────────────────────────
    // A dark→ember sky (cached), a low breathing hearth bloom, drifting embers,
    // a rare shooting-ember, and a cached vignette. Everything static is
    // rasterized once; motion is a handful of shared cached-glow blits in ONE
    // additive pass — cheaper than the old per-frame title/tab/START shadowBlur.
    _ensureBackdropCaches() {
        if (this._skyCache) return;
        const W = INTERNAL_WIDTH, H = INTERNAL_HEIGHT;
        const sky = document.createElement('canvas'); sky.width = W; sky.height = H;
        const sc = sky.getContext('2d');
        const g = sc.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#07090e'); g.addColorStop(0.42, '#0d0b12');
        g.addColorStop(0.72, '#1a0f10'); g.addColorStop(0.90, '#3a1608');
        g.addColorStop(1, '#0f0806');
        sc.fillStyle = g; sc.fillRect(0, 0, W, H);
        this._skyCache = sky;
        const vig = document.createElement('canvas'); vig.width = W; vig.height = H;
        const vc = vig.getContext('2d');
        const rg = vc.createRadialGradient(W / 2, H / 2, 140, W / 2, H / 2, W * 0.62);
        rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(0.7, 'rgba(0,0,0,0)');
        rg.addColorStop(1, 'rgba(4,2,1,0.62)');
        vc.fillStyle = rg; vc.fillRect(0, 0, W, H);
        this._vignetteCache = vig;
    }

    _seedEmbers(n) {
        if (this._embers && this._embers.length === n) return;
        const arr = [];
        for (let i = 0; i < n; i++) arr.push({
            x0: Math.random() * INTERNAL_WIDTH,
            y0: Math.random() * (INTERNAL_HEIGHT + 120),
            spd: 22 + Math.random() * 30,
            drift: 0.3 + Math.random() * 0.8,
            size: 2 + Math.random() * 3,
            phase: Math.random() * TAU,
        });
        this._embers = arr;
    }

    // One additive cached-glow blit (caller owns the composite/globalAlpha reset).
    _ember(ctx, x, y, r, color, alpha) {
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.drawImage(getGlowSprite(color), x - r, y - r, r * 2, r * 2);
    }

    // Breathing additive bloom (radius + alpha modulated on sin(t*0.5)); reused
    // by the hearth bloom and the hero pedestal.
    _forgeGlow(ctx, cx, cy, r, color, baseA, t) {
        const rr = r + Math.sin(t * 0.5) * (r * 0.04);
        ctx.globalAlpha = baseA + Math.sin(t * 0.5) * (baseA * 0.18);
        ctx.drawImage(getGlowSprite(color), cx - rr, cy - rr, rr * 2, rr * 2);
    }

    // Set ctx.font to `${weight} ${size}px ${family}` (default the Cinzel HEAD
    // face), shrinking the size until `text` fits within maxW (down to a floor).
    // Cinzel is wider than the system sans, so display labels auto-fit their
    // control instead of overflowing. Returns the size actually used.
    _fitFont(ctx, text, maxW, weight, size, family = HEAD, floor = 12) {
        let s = size;
        ctx.font = `${weight} ${s}px ${family}`;
        while (s > floor && ctx.measureText(text).width > maxW) {
            s -= 1;
            ctx.font = `${weight} ${s}px ${family}`;
        }
        return s;
    }

    // Animated ember-flame rim licking up from the top edge of a control (the
    // active tab / a primary button) — the mockup's standout accent. Additive
    // and cheap (cached glow sprites), purely decorative. Flames stay fire-hued
    // (orange base → pale tongue) regardless of the control's section colour, so
    // they always read as fire. `seed` de-syncs the flicker between controls so
    // they don't pulse in lockstep.
    _emberRim(ctx, x, y, w, h, t, seed = 0) {
        const n = Math.max(3, Math.round(w / 40));
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < n; i++) {
            const fx = x + (i + 0.5) * (w / n);
            const ph = t * 3.2 + i * 1.7 + seed;
            const lick = 7 + Math.sin(ph) * 4 + Math.sin(ph * 2.3) * 2;
            const a = 0.26 + Math.sin(ph * 1.3) * 0.12;
            this._ember(ctx, fx, y - lick * 0.3, 11, '#ff8a3a', a);          // hot base
            this._ember(ctx, fx, y - lick, 6, '#ffe6a0', Math.max(0, a * 0.7)); // pale tongue
        }
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    _drawShootingEmber(ctx, t) {
        const s = this._shooter;
        if (!s || t < s.start || t - s.start > s.dur + s.gap) {
            this._shooter = {
                start: t, dur: 0.9, gap: 6 + Math.random() * 3,
                x0: 120 + Math.random() * 320, y0: 80 + Math.random() * 170,
                len: 380 + Math.random() * 220, ang: 0.5 + Math.random() * 0.3,
            };
            return;
        }
        const p = (t - s.start) / s.dur;
        if (p > 1) return;                                   // dark during the gap
        const e = easeOutCubic(clamp01(p));
        const fade = 1 - p;
        for (let i = 0; i < 5; i++) {
            const tp = e - i * 0.035; if (tp < 0) break;
            const tx = s.x0 + Math.cos(s.ang) * s.len * tp;
            const ty = s.y0 + Math.sin(s.ang) * s.len * tp;
            ctx.globalAlpha = fade * (0.5 - i * 0.08);
            ctx.fillStyle = '#ffd06a'; ctx.fillRect(tx - 2, ty - 2, 4, 4);
        }
        this._ember(ctx, s.x0 + Math.cos(s.ang) * s.len * e, s.y0 + Math.sin(s.ang) * s.len * e, 16, '#ffd06a', fade * 0.8);
    }

    _drawBackdrop(ctx, settings) {
        const W = INTERNAL_WIDTH, H = INTERNAL_HEIGHT, t = this._t || 0;
        this._ensureBackdropCaches();
        ctx.drawImage(this._skyCache, 0, 0);
        // Painterly ember-forge backdrop (higgsfield / Nano Banana 2), cover-fit
        // over the cached sky (which stays as the fallback if the art is still
        // loading or missing). A vertical scrim keeps header/tab/content text
        // readable; the animated embers + vignette below still ride on top so the
        // menu stays alive rather than a static photo.
        const ui = getMenuImages();
        if (ui.bg) {
            const iw = ui.bg.width, ih = ui.bg.height;
            const s = Math.max(W / iw, H / ih);
            const dw = iw * s, dh = ih * s;
            ctx.drawImage(ui.bg, (W - dw) / 2, (H - dh) / 2, dw, dh);
            const scr = ctx.createLinearGradient(0, 0, 0, H);
            scr.addColorStop(0, 'rgba(8,6,10,0.58)');    // behind the header/title
            scr.addColorStop(0.28, 'rgba(8,6,10,0.30)');
            scr.addColorStop(0.62, 'rgba(8,6,10,0.30)');
            scr.addColorStop(1, 'rgba(8,6,10,0.50)');     // behind the content panels
            ctx.fillStyle = scr; ctx.fillRect(0, 0, W, H);
        }
        const reduced = settings && settings.reducedEffects;
        const noParticles = settings && settings.particles === false;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        this._forgeGlow(ctx, W * 0.5, H * 1.02, 760, '#ff7a1e', 0.16, t);
        this._forgeGlow(ctx, W * 0.5, H * 1.02, 340, '#ffd06a', 0.10, t);
        if (!noParticles) {
            this._seedEmbers(reduced ? 12 : 22);
            for (const em of this._embers) {
                const y = H + 60 - ((t * em.spd + em.y0) % (H + 120));
                const x = em.x0 + Math.sin(t * 0.6 + em.phase) * 40 * em.drift;
                const life = 1 - Math.abs((y / H) - 0.5) * 2;   // bright mid-screen, fades to edges
                const a = Math.max(0, life) * (0.5 + 0.3 * Math.sin(t * 3 + em.phase));
                if (a <= 0.02) continue;
                const gr = em.size * 3 * (1.1 + 0.2 * Math.sin(t * 4 + em.phase));
                this._ember(ctx, x, y, gr, '#ff8a3a', a * 0.5);
            }
            if (!reduced) this._drawShootingEmber(ctx, t);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.restore();
        ctx.drawImage(this._vignetteCache, 0, 0);
    }

    // Near-opaque smoked-glass fill (single source of the panel/pill glass look).
    _smokedGlassFill(ctx, x, y, w, h, r = 16) {
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        // Slightly translucent so the ember-forge backdrop reads through the
        // panel edges (glassy premium look) while staying opaque enough for text.
        g.addColorStop(0, 'rgba(26,19,19,0.84)');
        g.addColorStop(1, 'rgba(12,10,12,0.90)');
        roundRectPath(ctx, x, y, w, h, r);
        ctx.fillStyle = g; ctx.fill();
    }

    // Forged ember corner brackets (higgsfield) framing a panel — one ornate
    // bracket per corner, flipped into place. Returns false if the art hasn't
    // loaded so the caller can fall back to the procedural ticks. The bracket
    // image is top-left-oriented; scale(±1,±1) mirrors it to each corner.
    _forgeCorners(ctx, x, y, w, h) {
        const img = getMenuImages().corner;
        if (!img) return false;
        const cs = Math.min(80, Math.max(44, Math.min(w, h) * 0.15));
        const off = 0;   // elbow exactly at the corner (no bleed above into the tab tray)
        ctx.save();
        ctx.globalAlpha = 0.92;
        const draw = (cx, cy, sx, sy) => {
            ctx.save(); ctx.translate(cx, cy); ctx.scale(sx, sy);
            ctx.drawImage(img, 0, 0, cs, cs); ctx.restore();
        };
        draw(x - off, y - off, 1, 1);              // top-left
        draw(x + w + off, y - off, -1, 1);         // top-right
        draw(x - off, y + h + off, 1, -1);         // bottom-left
        draw(x + w + off, y + h + off, -1, -1);    // bottom-right
        ctx.restore();
        return true;
    }

    // Four L-shaped ember ticks framing a large panel (opts.corners only).
    _cornerTicks(ctx, x, y, w, h) {
        const s = 10, m = 9;
        ctx.strokeStyle = 'rgba(255,140,60,0.35)'; ctx.lineWidth = 2;
        const corners = [[x + m, y + m, 1, 1], [x + w - m, y + m, -1, 1], [x + m, y + h - m, 1, -1], [x + w - m, y + h - m, -1, -1]];
        for (const [cx, cy, dx, dy] of corners) {
            ctx.beginPath();
            ctx.moveTo(cx + dx * s, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * s);
            ctx.stroke();
        }
    }

    // Rounded panel — smoked glass with a warm inner rim + top gloss (default),
    // or an explicit fill when one is passed (nested cards keep their own tint).
    _panel(ctx, x, y, w, h, fill = null, stroke = 'rgba(255,180,120,0.10)', opts = {}) {
        const r = 16;
        if (fill) { roundRectPath(ctx, x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); }
        else this._smokedGlassFill(ctx, x, y, w, h, r);
        // Top gloss (clipped to the panel).
        ctx.save();
        roundRectPath(ctx, x, y, w, h, r); ctx.clip();
        const gg = ctx.createLinearGradient(0, y, 0, y + h * 0.4);
        gg.addColorStop(0, 'rgba(255,255,255,0.05)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gg; ctx.fillRect(x, y, w, h * 0.4);
        ctx.restore();
        // Inner rim-light.
        roundRectPath(ctx, x + 1.5, y + 1.5, w - 3, h - 3, r - 1);
        ctx.strokeStyle = 'rgba(255,140,60,0.10)'; ctx.lineWidth = 1.5; ctx.stroke();
        // Outer stroke.
        if (stroke) { roundRectPath(ctx, x, y, w, h, r); ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
        // Forged corner brackets on panels that OPT IN (opts.corners) only — kept
        // explicit so themed/nested panels (e.g. the purple CHARACTER card, the
        // gear-grid columns) don't get an ember frame they weren't designed for.
        // Falls back to the procedural ember ticks if the bracket art hasn't loaded.
        if (opts.corners) { if (!this._forgeCorners(ctx, x, y, w, h)) this._cornerTicks(ctx, x, y, w, h); }
    }

    // Right-aligned smoked-glass coin pill with a soft glow behind the ◎.
    _coinBank(ctx, rightX, cy, coins) {
        const label = `◎ ${coins} coins`;
        ctx.font = `700 32px ${FONT}`;
        const tw = ctx.measureText(label).width;
        const padX = 26, w = tw + padX * 2, h = 52, x = rightX - w, y = cy - h / 2;
        this._smokedGlassFill(ctx, x, y, w, h, h / 2);
        roundRectPath(ctx, x, y, w, h, h / 2);
        ctx.strokeStyle = 'rgba(255,180,120,0.16)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        this._ember(ctx, x + padX + 8, cy, 40, '#ffd86b', 0.12);
        ctx.restore(); ctx.globalAlpha = 1;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffd86b'; ctx.font = `700 32px ${FONT}`;
        ctx.fillText(label, x + padX, cy + 1);
    }

    // Hero forge-pedestal (PLAY tab): grounding disc, a slowly-rotating rune
    // ring, a breathing under-glow (tintable to the character accent), and a few
    // rising motes. Sits BEHIND the avatar so the hero stands on it. `sc` scales
    // the whole shrine down on short cards so its ring never bleeds into the
    // CHARACTER label when a large vertical safe-area shrinks the panel.
    _pedestal(ctx, cx, footY, t, accent = '#ff7a1e', sc = 1) {
        const rOuterX = 130 * sc, rOuterY = 40 * sc, rInnerX = 104 * sc, rInnerY = 32 * sc;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        this._forgeGlow(ctx, cx, footY, 170 * sc, accent, 0.26, t);
        // Rising forge motes.
        for (let i = 0; i < 5; i++) {
            const up = ((t * 30 + i * 34) % 150) * sc;
            const mx = cx + Math.sin(t * 1.3 + i * 1.7) * 34 * sc;
            const my = footY - up;
            const a = Math.max(0, 1 - up / (150 * sc)) * 0.6;
            const r = (5 + 3 * Math.sin(t * 3 + i)) * sc;
            this._ember(ctx, mx, my, r, '#ffb257', a);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        // Grounding disc.
        ctx.beginPath(); ctx.ellipse(cx, footY, 120 * sc, 34 * sc, 0, 0, TAU);
        ctx.fillStyle = 'rgba(10,6,6,0.55)'; ctx.fill();
        // Double rune ring.
        ctx.strokeStyle = 'rgba(255,150,70,0.5)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(cx, footY, rOuterX, rOuterY, 0, 0, TAU); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,210,130,0.35)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(cx, footY, rInnerX, rInnerY, 0, 0, TAU); ctx.stroke();
        // 8 slowly-rotating rune ticks around the ring.
        for (let i = 0; i < 8; i++) {
            const a = i * (TAU / 8) + t * 0.25;
            const tx = cx + Math.cos(a) * rOuterX, ty = footY + Math.sin(a) * rOuterY;
            ctx.globalAlpha = 0.4 + 0.4 * Math.sin(t * 2 + i);
            ctx.fillStyle = '#ffcf8a';
            ctx.fillRect(tx - 2, ty - 2, 4, 4);
        }
        ctx.globalAlpha = 1;
        ctx.restore();
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
        // Forged-plate relief (higgsfield): the neutral metal plate overlaid
        // ADDITIVELY and clipped to the button, so its bevel / rivets / copper rim
        // glint over the accent fill while the button's colour (its meaning) still
        // reads. No-op if the plate art hasn't loaded — the flat fill stands alone.
        const plate = getMenuImages().btnPlate;
        if (plate) {
            ctx.save();
            roundRectPath(ctx, r.x, r.y, r.w, r.h, 14); ctx.clip();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = enabled ? 0.30 : 0.14;
            ctx.drawImage(plate, r.x, r.y, r.w, r.h);
            ctx.restore();
        }
        ctx.strokeStyle = enabled ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 2; ctx.stroke();
        // Primary (START-style) buttons get the flaming ember rim from the mockup.
        if (primary && enabled) this._emberRim(ctx, r.x + 8, r.y, r.w - 16, r.h, this._t || 0, 3.1);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = enabled ? '#fff' : 'rgba(255,255,255,0.4)';
        // Forged display face, auto-fit so long labels ("TAP AGAIN TO CONFIRM")
        // never overflow the plate in the wider Cinzel glyphs.
        this._fitFont(ctx, label, r.w - 24, 700, fontSize);
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
        // Kick off the display-font load (idempotent, guarded); canvas text using
        // HEAD picks up Cinzel once ready, staying on the system fallback until then.
        ensureMenuFont();
        const sa = this._sa();
        const save = state.saveData;
        // Wall-clock seconds for menu animations (title shimmer, tab glow,
        // START pulse, selected-chip glow). Frame-rate independent.
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
        if (this._t0 === undefined) this._t0 = now;
        this._t = (now - this._t0) / 1000;
        const t = this._t;

        // Atmospheric "ember forge" backdrop (cached sky + bloom + embers +
        // vignette) — replaces the old flat fill.
        this._drawBackdrop(ctx, save.settings);

        // Header: title (higgsfield ember wordmark, or animated gradient text as
        // a fallback) + animated cached under-glow + coin bank.
        const ui = getMenuImages();
        const tx = sa.left + 56;
        const off = Math.sin(t * 1.2) * 0.5 + 0.5;
        const logoH = 62;
        const logoW = ui.title ? ui.title.width * (logoH / ui.title.height) : 420;
        // Cached-glow under-glow behind the wordmark (replaces per-frame shadowBlur).
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        this._ember(ctx, tx + logoW * 0.5, sa.top + 52, 160, '#ff7a1e', 0.22 + Math.sin(t * 1.2) * 0.05);
        ctx.restore(); ctx.globalAlpha = 1;
        if (ui.title) {
            ctx.drawImage(ui.title, tx, sa.top + 14, logoW, logoH);
        } else {
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            const tg = ctx.createLinearGradient(tx, 0, tx + 420, 0);
            tg.addColorStop(Math.max(0, off - 0.3), '#ffb43a');
            tg.addColorStop(off, '#fff1b8');
            tg.addColorStop(Math.min(1, off + 0.3), '#ffb43a');
            ctx.fillStyle = tg;
            ctx.font = `800 52px ${HEAD}`;
            ctx.fillText('EMBERWAKE', tx, sa.top + 70);
        }
        // Ember-rule under the title.
        const ruleW = Math.min(logoW, 460);
        const rule = ctx.createLinearGradient(tx, 0, tx + ruleW, 0);
        rule.addColorStop(0, 'rgba(255,122,30,0.5)'); rule.addColorStop(1, 'rgba(255,122,30,0)');
        ctx.fillStyle = rule; ctx.fillRect(tx, sa.top + 84, ruleW, 2);
        // Coin bank pill (right-aligned).
        this._coinBank(ctx, INTERNAL_WIDTH - sa.right - 56, sa.top + 54, save.totalCoins);

        this._drawTabBar(ctx, state.menuTab);

        const tab = state.menuTab || 'play';
        if (tab === 'play') this._drawPlay(ctx, state);
        else if (tab === 'skills') this._drawSkills(ctx, state);
        else if (tab === 'attune') this._drawAttune(ctx, state);
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
        const time = this._t || 0;
        // Smoked-glass tray behind the tabs.
        roundRectPath(ctx, x0 - 10, y - 8, w + 20, h + 16, 16);
        ctx.fillStyle = 'rgba(14,10,9,0.55)'; ctx.fill();
        roundRectPath(ctx, x0 - 10, y - 7, w + 20, h + 14, 15);
        ctx.strokeStyle = 'rgba(255,150,70,0.10)'; ctx.lineWidth = 1; ctx.stroke();
        // The inactive-tab fill is a constant vertical gradient (x-independent);
        // build it once per layout and reuse for all tabs + across frames.
        if (this._tabGradY !== y) {
            const tgr = ctx.createLinearGradient(0, y, 0, y + h);
            tgr.addColorStop(0, '#1c1614'); tgr.addColorStop(1, '#141010');
            this._tabGrad = tgr; this._tabGradY = y;
        }
        let activeX = x0;
        for (let i = 0; i < MENU_TABS.length; i++) {
            const t = MENU_TABS[i];
            const x = x0 + i * (tabW + gap);
            const active = t.id === activeTab;
            const accent = t.accent || '#ffce54';
            if (active) activeX = x;
            // Fill: dark glass for the active tab, warm-neutral gradient otherwise.
            roundRectPath(ctx, x, y, tabW, h, 12);
            ctx.fillStyle = active ? 'rgba(20,15,13,0.92)' : this._tabGrad; ctx.fill();
            // Active tab: forged-plate relief (same higgsfield plate as the buttons)
            // so the selected tab reads as a lit metal plate, not a flat fill.
            if (active) {
                const plate = getMenuImages().btnPlate;
                if (plate) {
                    ctx.save(); roundRectPath(ctx, x, y, tabW, h, 12); ctx.clip();
                    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.22;
                    ctx.drawImage(plate, x, y, tabW, h); ctx.restore();
                }
            }
            // Active tab: breathing cached-glow behind (replaces per-frame shadowBlur).
            if (active) {
                ctx.save(); ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = 0.24 + Math.sin(time * 4) * 0.10;
                ctx.drawImage(getGlowSprite(accent), x - 10, y - 10, tabW + 20, h + 20);
                ctx.restore(); ctx.globalAlpha = 1;
                // Flaming ember rim licking up from the tab's top edge (mockup accent).
                this._emberRim(ctx, x + 6, y, tabW - 12, h, time, i * 0.9);
            }
            roundRectPath(ctx, x, y, tabW, h, 12);
            ctx.strokeStyle = active ? accent : 'rgba(255,255,255,0.10)';
            ctx.lineWidth = active ? 2.5 : 2; ctx.stroke();
            if (active) {
                // Lit-metal top inner rim.
                ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(x + 12, y + 2.5); ctx.lineTo(x + tabW - 12, y + 2.5); ctx.stroke();
            }
            // Label: forged display face (Cinzel), accent colour when active,
            // muted otherwise. Auto-fit so the wider Cinzel glyphs never overflow
            // a tab (e.g. "BATTLE PASS" / "CHARACTER" on a narrow 9-tab bar).
            ctx.fillStyle = active ? accent : 'rgba(235,240,248,0.85)';
            this._fitFont(ctx, t.label, tabW - 20, 700, tabW < 230 ? 20 : 23);
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(t.label, x + tabW / 2, y + h / 2 + 1);
            if (!active) {
                // Inactive tabs keep a thin static accent underline (section identity).
                ctx.fillStyle = accent; ctx.globalAlpha = 0.6;
                ctx.fillRect(x + 14, y + h - 7, tabW - 28, 3); ctx.globalAlpha = 1;
            }
            this._hot(x, y, tabW, h, 'tab', t.id);
        }
        // Sliding accent indicator that eases toward the active tab on switch
        // (replaces the old hue-cycling RGB underline; warm-biases the bar).
        const dt = this._dt();
        const targetX = activeX + tabW * 0.15, targetW = tabW * 0.7;
        if (this._tabIndicX == null || this._tabStale) { this._tabIndicX = targetX; this._tabIndicW = targetW; }
        else {
            const k = 1 - Math.exp(-14 * dt);
            this._tabIndicX += (targetX - this._tabIndicX) * k;
            this._tabIndicW += (targetW - this._tabIndicW) * k;
        }
        const acc = (MENU_TABS.find((tt) => tt.id === activeTab) || {}).accent || '#ffce54';
        ctx.fillStyle = acc;
        ctx.fillRect(this._tabIndicX, y + h - 4, this._tabIndicW, 3);
    }

    // ── PLAY ───────────────────────────────────────────────────────────
    _drawPlay(ctx, state) {
        const c = this._contentRect();
        const save = state.saveData;

        // Left: character preview + selection card.
        const cardW = c.w * 0.42;
        this._panel(ctx, c.x, c.y, cardW, c.h, null, undefined, { corners: true });
        const ccx = c.x + cardW / 2;
        const ch = getCharacter(save.selectedCharacter);
        const ap = resolveAppearance(save.cosmetics.equipped);
        // Avatar reflects the selected character's color unless a fur cosmetic
        // overrides it (cosmetics apply on top of the character).
        // The menu model is the REAL in-game character sprite (correct
        // silhouette + palette), with equipped cosmetics layered over it.
        const avatarAp = { ...ap, furColor: ap.furColor || ch.palette.fur };
        let charSprite = null;
        // Front-facing idle, with a brief cast-pose flash every few seconds so
        // the preview shows the new attack animation + matches in-game.
        try {
            const d = getHeroFrames(ch.id, ch).dirs.down;
            charSprite = (this._t % 3.6) > 3.0 ? d.cast[0] : d.idle[0];
        } catch (e) { charSprite = null; }
        // The selected starting weapon drives the themed skin overlay so the
        // preview matches the in-game look (character + cosmetics + weapon).
        const startWeaponId = resolveStartingWeapon(save);
        const skin = resolveWeaponSkin(startWeaponId);
        // …and the in-hand held prop, so the preview shows the wand/staff the
        // hero actually carries in-game.
        const heldProp = resolveWeaponProp(startWeaponId);
        // this._t (wall-clock seconds, frame-rate independent) is set in draw()
        // and drives the avatar's subtle idle motion.
        // Forge pedestal (glowing rune shrine) staged BEHIND the hero, tinted to
        // the character's accent so switching heroes recolours the shrine. Scaled
        // down on short cards so its ring never bleeds into the CHARACTER label.
        const pedSc = Math.max(0.55, Math.min(1, c.h / 640));
        this._pedestal(ctx, ccx, c.y + c.h * 0.26 + 96 * pedSc, this._t, ch.accent || '#ff7a1e', pedSc);
        this._drawAvatar(ctx, ccx, c.y + c.h * 0.26, 118, avatarAp, charSprite, skin, this._t, !!ch.lpc, heldProp, resolveCharacterHold(ch.id), ch.palette && ch.palette.face);
        // Themed-skin caption ABOVE the name (with real clearance so long names
        // never collide with it), then the ellipsized name line.
        const nameY = c.y + c.h * 0.46;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (skin) {
            ctx.fillStyle = skin.accent; ctx.font = `700 16px ${FONT}`;
            ctx.fillText(`${skin.name} skin`, ccx, nameY - 32);
        }
        ctx.fillStyle = '#fff'; ctx.font = `700 30px ${FONT}`;
        ctx.fillText(this._ellip(ctx, `${ch.name} — ${ch.title}`, cardW - 44), ccx, nameY);
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `500 17px ${FONT}`;
        this._wrapText(ctx, ch.description, ccx, c.y + c.h * 0.485, cardW - 60, 22, 2);
        // Hero SIGNATURE — its defining identity (accent name + flavor blurb),
        // the mechanical fingerprint applied at run start by CharacterSystem.
        if (ch.signature) {
            ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = ch.accent || '#ffce54'; ctx.font = `800 18px ${FONT}`;
            ctx.fillText(this._ellip(ctx, `✦ ${ch.signature.name}`, cardW - 44), ccx, c.y + c.h * 0.55);
            ctx.fillStyle = 'rgba(255,238,196,0.85)'; ctx.font = `500 15px ${FONT}`;
            ctx.fillText(this._ellip(ctx, ch.signature.blurb, cardW - 48), ccx, c.y + c.h * 0.578);
        }

        // Character picker: a 3-wide grid of every selectable hero. Fit-driven —
        // chipH fills the band between the CHARACTER label and the Battle Pass
        // bar and is capped, never floored above what the band allows, so the
        // grid ALWAYS sits above the Battle Pass label even when a large vertical
        // safe-area shrinks the card (font/swatch scale down instead of the grid
        // overflowing). The 14px floor is only a degenerate-panel sanity minimum.
        // labelY sits BELOW the signature block (name 0.55h + blurb 0.578h); the
        // grid is fit-driven (chipH capped/floored) between here and the BP bar,
        // so pushing the label down just trims chip height on short cards.
        const labelY = c.y + c.h * 0.62;
        ctx.font = `700 18px ${FONT}`;
        ctx.fillStyle = '#cdd6e2'; ctx.textAlign = 'left';
        ctx.fillText('CHARACTER', c.x + 30, labelY);
        const cols = 3, gap = 10;
        const cRows = Math.ceil(CHARACTER_IDS.length / cols);
        const chipW = (cardW - 60 - gap * (cols - 1)) / cols;
        const gridY = labelY + 14;
        const gridBottom = c.y + c.h * 0.86 - 34;   // clearance above the BP label
        const chipH = Math.max(14, Math.min(46, (gridBottom - gridY - gap * (cRows - 1)) / cRows));
        const chipFont = Math.round(Math.max(11, Math.min(17, chipH * 0.44)));
        const swatchR = Math.min(10, chipH * 0.28);
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
            ctx.beginPath(); ctx.arc(x + 20, y + chipH / 2, swatchR, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = selected ? '#ffce54' : '#fff'; ctx.font = `700 ${chipFont}px ${FONT}`;
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(this._ellip(ctx, def.name, chipW - 42), x + 36, y + chipH / 2);
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
        this._panel(ctx, rx, c.y, rw, c.h, null, undefined, { corners: true });
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
        const tRows = Math.ceil(RUN_MODIFIERS.length / 3); // Trials chip grid rows (3 cols)
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
            + N.lbl * lblScale(s) + N.diff * s + N.sec * s   // Patron row (reuses diff height)
            + N.lbl * lblScale(s) + N.diff * s + N.sec * s
            + N.lbl * lblScale(s) + (tRows * N.chip * chipScale(s) + (tRows - 1) * N.chipGap * s);
        let s = 1;
        // Floor: low enough that even a degenerate ultra-short panel keeps every
        // section's row from overlapping the next (the label/chip legibility
        // floors set an irreducible minimum; six sections need more shrink room
        // than five did). Real devices land far above this.
        const S_FLOOR = 0.12;
        if (fitH(1) > avail) {                        // doesn't fit at full size → shrink to fit
            let lo = S_FLOOR, hi = 1;
            for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fitH(mid) <= avail) lo = mid; else hi = mid; }
            s = lo;
        }
        s = clamp(s, S_FLOOR, 1);
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

        // Patron row (5 allegiances; one row). Selecting one biases the level-up
        // draft toward its element/role. Tapping the active Patron clears it.
        const selPatron = state.selectedPatron || null;
        const pdef = selPatron ? PATRONS[selPatron] : null;
        ctx.fillStyle = '#cdd6e2'; ctx.font = `700 ${fs(19)}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(pdef ? `Patron — ${pdef.name}, ${pdef.title}` : 'Patron — none (balanced draft)', innerX, y + lbl * 0.72);
        y += lbl;
        const pW = (innerW - 10 * (PATRON_IDS.length - 1)) / PATRON_IDS.length;
        for (let i = 0; i < PATRON_IDS.length; i++) {
            const p = PATRONS[PATRON_IDS[i]];
            const px = innerX + i * (pW + 10);
            const sel = selPatron === p.id;
            roundRectPath(ctx, px, y, pW, diffRow, 9);
            ctx.fillStyle = sel ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.03)'; ctx.fill();
            if (sel) this._selGlow(ctx, px, y, pW, diffRow, 9, p.color, t);
            ctx.strokeStyle = sel ? p.color : 'rgba(255,255,255,0.16)'; ctx.lineWidth = sel ? 3 : 2; ctx.stroke();
            ctx.fillStyle = sel ? p.color : '#fff'; ctx.font = `700 ${fs(16)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(p.name, px + pW / 2, y + diffRow / 2);
            this._hot(px, y, pW, diffRow, 'selectPatron', { id: p.id });
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        y += diffRow + sec;

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

        // Trials toggles. Each active one stacks into a "Pact" — the label shows
        // the live Pact tier + the (capped) XP & coin reward the stack pays.
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        const sumBonus = (key) => activeMods.reduce((a, id) => {
            const m = RUN_MODIFIERS.find((x) => x.id === id); return a + (m ? (m[key] || 0) : 0);
        }, 0);
        const xpPct = Math.round(Math.min(sumBonus('xpBonus'), RUN_MODIFIER_MAX_BONUS) * 100);
        const coinPct = Math.round(Math.min(sumBonus('coinBonus'), RUN_MODIFIER_MAX_BONUS) * 100);
        const tier = pactTier(activeMods.length);
        if (activeMods.length > 0) {
            ctx.fillStyle = '#ffce54'; ctx.font = `800 ${fs(19)}px ${FONT}`;
            ctx.fillText(`Trials — PACT ${tier}`, innerX, y + lbl * 0.72);
            ctx.textAlign = 'right'; ctx.fillStyle = '#5fd36a'; ctx.font = `700 ${fs(16)}px ${FONT}`;
            ctx.fillText(`+${xpPct}% XP   +${coinPct}% coins`, innerX + innerW, y + lbl * 0.72);
            ctx.textAlign = 'left';
        } else {
            ctx.fillStyle = '#cdd6e2'; ctx.font = `700 ${fs(19)}px ${FONT}`;
            ctx.fillText('Trials — stack curses to forge a Pact', innerX, y + lbl * 0.72);
        }
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

        // START RUN (left) + DAILY ROAD (right) share the CTA row. START stays the
        // big animated call-to-action; DAILY launches the day's curated fixed run.
        const dGap = 12;
        const dailyW = Math.min(240, innerW * 0.34);
        const startW = innerW - dailyW - dGap;
        this._drawStartButton(ctx, { x: innerX, y: startY, w: startW, h: startH }, t);
        this._drawDailyButton(ctx, { x: innerX + startW + dGap, y: startY, w: dailyW, h: startH }, state, t);
    }

    // DAILY ROAD launch button — a distinct pink/gold CTA showing the day's fixed
    // setup (biome + forced road) and today's best score. Same-for-everyone each
    // UTC day; forces Normal difficulty. Dispatches the 'startDaily' action.
    _drawDailyButton(ctx, r, state, t) {
        const setup = getDailySetup(currentDayNumber());
        const mapName = (MAPS[setup.mapId]?.name) || setup.mapId;
        const roadName = (getRoad(setup.roadId)?.name) || setup.roadId;
        const best = state.dailyRoadBest ?? 0;
        const glow = 0.5 + Math.sin(t * 3) * 0.25;
        roundRectPath(ctx, r.x, r.y, r.w, r.h, 14);
        ctx.fillStyle = 'rgba(60,26,44,0.95)'; ctx.fill();
        ctx.save();
        ctx.globalAlpha = glow;
        ctx.strokeStyle = '#ff9ecf'; ctx.lineWidth = 2.5;
        roundRectPath(ctx, r.x, r.y, r.w, r.h, 14); ctx.stroke();
        ctx.restore();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffd3ec'; ctx.font = `800 22px ${FONT}`;
        ctx.fillText('DAILY ROAD', r.x + r.w / 2, r.y + r.h / 2 - 16);
        ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.font = `600 14px ${FONT}`;
        ctx.fillText(`${mapName} · ${roadName}`, r.x + r.w / 2, r.y + r.h / 2 + 6);
        ctx.fillStyle = 'rgba(255,206,84,0.9)'; ctx.font = `700 13px ${FONT}`;
        ctx.fillText(best > 0 ? `Best today: ${best}` : 'No run yet today', r.x + r.w / 2, r.y + r.h / 2 + 24);
        this._hot(r.x, r.y, r.w, r.h, 'startDaily', null);
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
    // breathing gold border, and a soft cached under-glow — hard to miss, and
    // cheaper than the old per-frame hsl shadowBlur.
    _drawStartButton(ctx, r, t) {
        ctx.save();
        // Cached-glow beacon behind the button (breathing alpha).
        ctx.globalCompositeOperation = 'lighter';
        this._ember(ctx, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.55, '#74e890', 0.18 + Math.sin(t * 3) * 0.06);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        const sweep = Math.sin(t * 1.5) * 0.5 + 0.5;
        const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y);
        g.addColorStop(Math.max(0, sweep - 0.28), '#33a356');
        g.addColorStop(sweep, '#74e890');
        g.addColorStop(Math.min(1, sweep + 0.28), '#33a356');
        roundRectPath(ctx, r.x, r.y, r.w, r.h, 14);
        ctx.fillStyle = g; ctx.fill();
        // Static warm-gold border whose alpha pulses (the fire beacon).
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 1.6);
        ctx.strokeStyle = '#ffce7a'; ctx.lineWidth = 3; ctx.stroke();
        ctx.globalAlpha = 1;
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
        this._panel(ctx, c.x, c.y, c.w, c.h, null, undefined, { corners: true });
        const s = (state.saveData && state.saveData.stats) || {};
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

        // ── Today's Trials — three rotating daily challenges (a "come back
        // tomorrow" loop). The pool + day's picks are deterministic; completion
        // lives in save.daily and resets when the UTC day rolls (we treat a
        // stale save.daily.day as "none done today" for display).
        const day = currentDayNumber();
        const dd = (state.saveData && state.saveData.daily) || { day: 0, completed: [] };
        const doneToday = dd.day === day && Array.isArray(dd.completed) ? dd.completed : [];
        const todays = pickDailyChallenges(day);
        ctx.fillStyle = '#ffd479'; ctx.font = `800 30px ${FONT}`;
        const doneN = todays.filter((cc) => doneToday.includes(cc.id)).length;
        ctx.fillText(`Today's Trials  ${doneN}/${todays.length}`, c.x + 34, c.y + 44);
        const dcGap = 14;
        const dcW = (c.w - 68 - dcGap * (todays.length - 1)) / todays.length;
        const dcH = 78;
        const dcTop = c.y + 60;
        for (let i = 0; i < todays.length; i++) {
            const ch = todays[i];
            const got = doneToday.includes(ch.id);
            const x = c.x + 34 + i * (dcW + dcGap);
            roundRectPath(ctx, x, dcTop, dcW, dcH, 10);
            ctx.fillStyle = got ? 'rgba(95,211,106,0.14)' : 'rgba(255,212,121,0.06)'; ctx.fill();
            ctx.strokeStyle = got ? '#5fd36a' : 'rgba(255,212,121,0.45)'; ctx.lineWidth = 2; ctx.stroke();
            ctx.textAlign = 'left';
            ctx.fillStyle = got ? '#5fd36a' : '#fff'; ctx.font = `800 18px ${FONT}`;
            ctx.fillText(`${got ? '✓ ' : ''}${ch.name}`, x + 14, dcTop + 26);
            ctx.fillStyle = 'rgba(255,255,255,0.62)'; ctx.font = `500 13px ${FONT}`;
            const desc = ch.desc.length > 34 ? ch.desc.slice(0, 33) + '…' : ch.desc;
            ctx.fillText(desc, x + 14, dcTop + 48);
            ctx.fillStyle = got ? 'rgba(95,211,106,0.8)' : '#ffce54'; ctx.font = `800 14px ${FONT}`;
            ctx.fillText(got ? 'CLAIMED' : `+${ch.coins} coins`, x + 14, dcTop + 68);
        }
        const statsTop0 = dcTop + dcH + 22;

        ctx.fillStyle = '#a8d5f7'; ctx.font = `800 34px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText('Lifetime Vigil', c.x + 34, statsTop0 + 30);
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
        // Pact Mastery summary (per-character highest cleared tier).
        const pmObj = (state.saveData && state.saveData.pactMastery) || {};
        const pmVals = Object.values(pmObj).filter((v) => Number.isFinite(v) && v > 0);
        rows.push(['Top Pact cleared', pmVals.length ? Math.max(...pmVals) : 0]);
        rows.push(['Pacts mastered', pmVals.length]);
        // Three compact columns (was two tall ones) — frees vertical room below
        // so the achievements grid isn't pushed off the panel.
        const cols = 3, gap = 18;
        const colW = (c.w - 68 - gap * (cols - 1)) / cols;
        const rowH = 40;
        const top = statsTop0 + 66;
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
        const acols = 4, agap = 14;       // 4 columns → 4 rows for 16 (fits short panels)
        const aW = (c.w - 68 - agap * (acols - 1)) / acols;
        const arTop = aTop + 16;
        // Adaptive badge height: shrink so EVERY achievement row fits the space
        // left below the stats (no silent clipping); drop the desc line when the
        // badge gets short. Reward chip stays on the name row.
        const rowsA = Math.ceil(ACHIEVEMENTS.length / acols);
        const availA = (c.y + c.h - 8) - arTop;
        const aH = Math.max(34, Math.min(52, Math.floor((availA - 8 * (rowsA - 1)) / rowsA)));
        const aShowDesc = aH >= 46;
        const aNameY = aShowDesc ? 22 : Math.round(aH * 0.6);
        for (let i = 0; i < ACHIEVEMENTS.length; i++) {
            const a = ACHIEVEMENTS[i];
            const col = i % acols, row = Math.floor(i / acols);
            const x = c.x + 34 + col * (aW + agap), y = arTop + row * (aH + 8);
            if (y + aH > c.y + c.h - 6) break; // safety clip (degenerate panels)
            const got = claimed.includes(a.id);
            roundRectPath(ctx, x, y, aW, aH, 8);
            ctx.fillStyle = got ? 'rgba(255,206,84,0.14)' : 'rgba(255,255,255,0.03)'; ctx.fill();
            ctx.strokeStyle = got ? '#ffce54' : 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = got ? '#ffce54' : '#cdd6e2'; ctx.font = `800 ${aShowDesc ? 16 : 15}px ${FONT}`; ctx.textAlign = 'left';
            ctx.fillText(this._ellip(ctx, `${got ? '✓ ' : ''}${a.name}`, aW - 130), x + 12, y + aNameY);
            if (aShowDesc) {
                ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `500 12px ${FONT}`;
                ctx.fillText(a.desc.length > 38 ? a.desc.slice(0, 37) + '…' : a.desc, x + 12, y + 40);
            }
            // If this achievement grants a cosmetic, show it (right-aligned, in
            // its rarity colour) so players can see the skin they're grinding
            // toward — a 🎁 reward target on the name row.
            const rew = cosmeticsForAchievement(a.id);
            if (rew.length && COSMETICS[rew[0]]) {
                const cm = COSMETICS[rew[0]];
                ctx.fillStyle = rarityColor(cm.rarity); ctx.font = `700 13px ${FONT}`; ctx.textAlign = 'right';
                ctx.fillText(this._ellip(ctx, `🎁 ${cm.name}`, aW * 0.5), x + aW - 12, y + aNameY);
                ctx.textAlign = 'left';
            }
        }
        ctx.textAlign = 'left';
    }

    // Avatar honoring aura/fur/cloak/hat cosmetics. When `sprite` (the real
    // cached character frame) is supplied it's drawn as the body so the menu
    // model exactly matches the selected character; otherwise a procedural
    // blob is used as a fallback.
    _drawAvatar(ctx, cx, cy, r, ap, sprite = null, skin = null, t = 0, isLpc = false, heldProp = null, hold = null, pawColor = '#f0d2a5') {
        // The avatar draws the body sprite at S=r*2.4, so the shared cosmetic +
        // weapon-skin helpers (authored in sprite-half units) take s = S/2.
        const S = r * 2.4;
        const s = S / 2;
        ctx.save();
        // Animated cosmetic aura (prestige VFX) — the live preview shows the
        // exact pulse/spin/flame/rainbow/starfield effect you earn.
        if (ap.auraColor) drawAuraFx(ctx, cx, cy, r * 1.32, ap.auraColor, ap.auraFx, t, 0.42);
        // Rarity prestige FX in the customizer too — the preview IS the sales
        // pitch: rarer pieces visibly glow/pulse/sparkle before you commit.
        if (ap.fxTier >= 3) drawRarityFx(ctx, cx, cy, r * 1.26, ap.fxTier, ap.fxColor, t);
        if (ap.set) drawSetBonus(ctx, cx, cy, r * 1.3, ap.set.color, t);
        // Cloak: imported LPC cape for LPC heroes (drawn at the body box so it
        // aligns), procedural drape otherwise — matches the in-game player.
        if (ap.cloakColor) {
            const cape = isLpc ? getCloakSprite(ap.cloakColor) : null;
            if (cape) {
                // Flared a touch larger + nudged down so it drapes behind the
                // hero (matches Player._drawCloak exactly).
                const dw = S * 1.32, off = S * 0.075;
                ctx.drawImage(cape, cx - dw / 2, cy - dw / 2 + off, dw, dw);
            } else {
                // Front-facing pixel cloak (matches in-game down-facing cloak).
                drawPixelCloak(ctx, cx, cy, s, 'down', ap.cloakColor, false);
            }
        }
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
        // Held weapon prop gripped in-hand (matches the in-game loadout). The
        // hand sits at the lower-front of the body and the weapon angles down-out
        // at a jaunty rest angle (the menu has no aim target); a little paw wraps
        // the grip. Authored relative to the in-game spriteHalf (91), scaled to s.
        if (heldProp) {
            const propSprite = getWeaponProp(heldProp.prop, heldProp.accent, heldProp.glow);
            if (propSprite) {
                // Match the in-game articulated hold: a forearm reaches from the
                // shoulder to the gripping hand (at a jaunty rest angle), with the
                // weapon + paw at the hand — so the preview shows it actually held.
                const H = hold || { grip: 0.18, lift: 0.12, scale: 1.0, tilt: 0 };
                const k = s / 91;
                const pscale = k * 0.92 * H.scale;
                const ang = 0.55 + H.tilt;
                const sxp = cx + s * 0.13, syp = cy + s * 0.06;
                const reach = s * 0.30 * H.scale;
                const hxp = sxp + Math.cos(ang) * reach, hyp = syp + Math.sin(ang) * reach;
                const armCol = ap.furColor || '#8b5a2b';
                ctx.lineCap = 'round';
                ctx.strokeStyle = shade(armCol, 0.42, 'dark'); ctx.lineWidth = 10 * k * H.scale;
                ctx.beginPath(); ctx.moveTo(sxp, syp); ctx.lineTo(hxp, hyp); ctx.stroke();
                ctx.strokeStyle = armCol; ctx.lineWidth = 6.5 * k * H.scale;
                ctx.beginPath(); ctx.moveTo(sxp, syp); ctx.lineTo(hxp, hyp); ctx.stroke();
                ctx.save();
                ctx.translate(hxp, hyp);
                ctx.rotate(ang);
                ctx.drawImage(propSprite.canvas, -propSprite.gripX * pscale, -propSprite.gripY * pscale,
                    propSprite.w * pscale, propSprite.h * pscale);
                const pr = 8 * pscale;
                ctx.fillStyle = pawColor; ctx.strokeStyle = 'rgba(40,24,12,0.85)';
                ctx.lineWidth = Math.max(1, 1.8 * pscale);
                ctx.beginPath(); ctx.arc(0, 0, pr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.restore();
            }
        }
        // Accessory on the head (direction-aware pixel hat, on top). The old
        // themed sash overlay was removed — the held weapon carries the identity.
        if (ap.hatShape && ap.hatShape !== 'none') drawPixelHat(ctx, cx, cy, s, 'down', ap.hatShape, ap.hatColor, false);
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

    // ── ATTUNE — Relic Attunement (the coin-fed infinite sink) ────────────
    // A defensive/utility subset of relics can be permanently attuned with coins.
    // Mirrors _drawSkills' coin-buy card, but reads levels from save.relicAttunement
    // and prices via attuneCost(def, level). Deliberately no raw-damage attunements
    // (see relics.js ATTUNABLE) so a coin hoard can't out-scale the hypergrowth wall.
    _drawAttune(ctx, state) {
        const c = this._contentRect();
        const save = state.saveData;
        const levels = (save.relicAttunement && typeof save.relicAttunement === 'object') ? save.relicAttunement : {};
        const discovered = Array.isArray(save.discoveredRelics) ? save.discoveredRelics : [];
        ctx.textBaseline = 'alphabetic';

        // Intro line — what this panel does (permanent, applied at run start).
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255,158,207,0.92)'; ctx.font = `700 21px ${FONT}`;
        ctx.fillText('RELIC ATTUNEMENT', c.x, c.y + 4);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `500 17px ${FONT}`;
        ctx.fillText('Spend coins for permanent, always-on relic bonuses — applied at the start of every run.', c.x, c.y + 28);

        const gridTop = c.y + 52;
        const cols = 2, gap = 24;
        const cardW = (c.w - gap) / cols;
        const cardH = 96;
        const rowGap = 16;
        for (let i = 0; i < ATTUNABLE.length; i++) {
            const def = ATTUNABLE[i];
            const relic = getRelic(def.id);
            const col = i % cols, row = Math.floor(i / cols);
            const x = c.x + col * (cardW + gap);
            const y = gridTop + row * (cardH + rowGap);
            const level = levels[def.id] ?? 0;
            const maxed = level >= def.max;
            const cost = attuneCost(def, level);
            const afford = !maxed && save.totalCoins >= cost;
            const rc = relic ? rarityColor(relic.rarity) : '#ff9ecf';
            // Color-coded state (matches SKILLS): green = maxed, gold = affordable,
            // dim = can't afford. Left accent bar uses the relic's rarity color.
            const stateCol = maxed ? '#5fd36a' : afford ? '#ffce54' : 'rgba(255,255,255,0.12)';
            roundRectPath(ctx, x, y, cardW, cardH, 12);
            ctx.fillStyle = afford ? 'rgba(46,40,18,0.92)' : maxed ? 'rgba(20,34,24,0.92)' : 'rgba(22,27,36,0.9)';
            ctx.fill();
            ctx.strokeStyle = stateCol;
            ctx.lineWidth = afford || maxed ? 2.5 : 2; ctx.stroke();
            ctx.fillStyle = rc;
            ctx.fillRect(x + 4, y + 12, 5, cardH - 24);
            ctx.textAlign = 'left';
            const nm = relic ? relic.name : def.id;
            ctx.fillStyle = rc; ctx.font = `700 25px ${FONT}`;
            ctx.fillText(nm, x + 22, y + 34);
            const nameW = ctx.measureText(nm).width;   // measure at the title font
            // "Discovered" tick — flavor tie-in to the Wick Roads codex (not a gate).
            if (discovered.includes(def.id)) {
                ctx.fillStyle = 'rgba(127,208,255,0.85)'; ctx.font = `700 15px ${FONT}`;
                ctx.fillText('✦ found', x + 22 + nameW + 14, y + 32);
            }
            ctx.fillStyle = 'rgba(255,255,255,0.62)'; ctx.font = `500 19px ${FONT}`;
            ctx.fillText(def.blurb, x + 22, y + 58);
            // Segmented level progress bar (filled = owned levels).
            const segGap = 4, segY = y + 74, segH = 8;
            const segW = (210 - segGap * (def.max - 1)) / def.max;
            for (let s = 0; s < def.max; s++) {
                ctx.fillStyle = s < level ? stateCol : 'rgba(255,255,255,0.12)';
                ctx.fillRect(x + 22 + s * (segW + segGap), segY, Math.max(2, segW), segH);
            }
            ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `600 15px ${FONT}`;
            ctx.fillText(`Lv ${level}/${def.max}`, x + 22, y + 90);
            // Buy button on the right.
            const bw = 150, bh = 56;
            const br = { x: x + cardW - bw - 16, y: y + (cardH - bh) / 2, w: bw, h: bh };
            this._button(ctx, br, maxed ? 'MAX' : `◎ ${cost}`,
                { enabled: afford, accent: afford ? '#2e6b3f' : null, action: maxed ? null : 'attuneRelic', arg: def.id });
        }
    }

    // ── LOADOUT / CHARACTER shared grid ──────────────────────────────────
    // `rect` lets the CHARACTER customizer constrain the cosmetic columns to
    // the right of the live model; LOADOUT passes none → full content rect.
    _drawItemGrid(ctx, state, kind, rect = null) {
        const c = rect || this._contentRect();
        const save = state.saveData;
        const cats = kind === 'gear' ? GEAR_CATEGORIES : COSMETIC_CATEGORIES;
        const labels = kind === 'gear' ? GEAR_CATEGORY_LABELS : COSMETIC_CATEGORY_LABELS;
        const equipped = kind === 'gear' ? save.gear.equipped : save.cosmetics.equipped;
        const isUnlocked = (id) => (kind === 'gear' ? save.gear.unlocked : save.cosmetics.unlocked).includes(id);
        const itemsFor = kind === 'gear' ? gearByCategory : cosmeticsByCategory;

        const colW = (c.w - (cats.length - 1) * 18) / cats.length;
        const ig = 8;
        // Cosmetic rows shrink to fit the WHOLE category in the column (no
        // scroll, nothing clipped) — the safe-area can make the content rect
        // shorter than it looks, so size off the most-populated category.
        let cih = 56;
        if (kind !== 'gear') {
            const maxN = Math.max(1, ...cats.map((cc) => itemsFor(cc).length));
            const availH = c.h - 56 - 8;
            // Size so the WHOLE tallest category fits (the clip below would
            // otherwise drop the last cards — e.g. coin/achievement cosmetics
            // whose card is their only unlock surface). The min is just a
            // sanity floor for degenerate (sub-360px) content rects; realistic
            // phone-landscape heights land ~30–40px and still fit all items.
            cih = Math.max(24, Math.min(58, Math.floor((availH - ig * (maxN - 1)) / maxN)));
        }
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
            const ih = kind === 'gear' ? 88 : cih;
            const innerW = colW - 24;
            // Card text/swatch positions scale with the (possibly compact) row.
            const nameY = kind === 'gear' ? 26 : Math.round(ih * 0.42);
            const statusY = kind === 'gear' ? 48 : Math.round(ih * 0.78);
            const isz = kind === 'gear' ? 30 : Math.min(30, ih - 18);
            for (const item of items) {
                if (iy + ih > c.y + c.h - 8) break; // clip to column
                const unlocked = isUnlocked(item.id);
                const equippedHere = equipped[cat] === item.id;
                const col = rarityColor(item.rarity);
                // Unlock state → status line + how the card behaves. Cosmetics
                // can be owned, bought with coins, earned via an achievement, or
                // found only in cases; gear keeps its simpler owned/locked read.
                let statusText, statusCol, action = null;
                if (equippedHere) { statusText = 'EQUIPPED'; statusCol = '#ffce54'; }
                else if (unlocked) {
                    statusText = rarityName(item.rarity); statusCol = col;
                    action = kind === 'gear' ? 'equipGear' : 'equipCosmetic';
                } else if (kind === 'cosmetic' && item.coinCost) {
                    const price = cosmeticCoinCost(item);
                    const afford = save.totalCoins >= price;
                    statusText = `◎ ${price}`;
                    statusCol = afford ? '#ffd86b' : 'rgba(255,216,107,0.4)';
                    action = 'buyCosmetic';
                } else if (kind === 'cosmetic' && item.achievement) {
                    const ach = ACHIEVEMENTS.find((a) => a.id === item.achievement);
                    statusText = `🏆 ${ach ? ach.name : 'Achievement'}`;
                    statusCol = 'rgba(168,213,247,0.92)';
                } else {
                    statusText = kind === 'cosmetic' ? '🔒 Case drop' : '🔒 LOCKED';
                    statusCol = 'rgba(255,255,255,0.5)';
                }
                const buyable = action === 'buyCosmetic';
                const lit = unlocked || buyable;       // full-opacity (vs faded-locked)
                const dim = lit ? 1 : 0.4;
                roundRectPath(ctx, x + 12, iy, innerW, ih, 10);
                ctx.fillStyle = equippedHere ? 'rgba(255,206,84,0.16)'
                    : buyable ? 'rgba(255,216,107,0.06)' : 'rgba(255,255,255,0.04)';
                ctx.fill();
                ctx.strokeStyle = equippedHere ? '#ffce54' : unlocked ? col
                    : buyable ? 'rgba(255,216,107,0.5)' : 'rgba(255,255,255,0.08)';
                ctx.lineWidth = equippedHere ? 3 : 2; ctx.stroke();
                ctx.textAlign = 'left';
                ctx.globalAlpha = dim;
                ctx.fillStyle = lit ? '#fff' : 'rgba(255,255,255,0.7)';
                ctx.font = `700 ${kind === 'gear' ? 20 : Math.min(20, Math.round(ih * 0.36))}px ${FONT}`;
                ctx.fillText(this._ellip(ctx, item.name, innerW - 56), x + 26, iy + nameY);
                ctx.fillStyle = statusCol; ctx.font = `600 ${kind === 'gear' ? 15 : Math.min(15, Math.round(ih * 0.28))}px ${FONT}`;
                ctx.fillText(this._ellip(ctx, statusText, innerW - 30), x + 26, iy + statusY);
                // Slot icon / swatch. Cosmetics show a representative preview of
                // the actual item (pixel cloak/hat, fur tint disc, aura glow,
                // trail puffs); gear shows its forged category emblem (weapon =
                // crossed ember wands matching the game's wand combat, armor,
                // trinket, charm), falling back to the rarity shield until the
                // emblem art loads (or in a non-DOM env). Rarity still reads via
                // the card border + status colour.
                {
                    const ix = x + 12 + innerW - isz - 12, iyy = iy + (kind === 'gear' ? 12 : Math.round((ih - isz) / 2));
                    ctx.save();
                    ctx.globalAlpha = dim;
                    if (kind === 'cosmetic') this._cosmeticSwatch(ctx, cat, item, ix, iyy, isz);
                    else {
                        const emblem = getGearEmblem(cat);
                        if (emblem) ctx.drawImage(emblem, ix, iyy, isz, isz);
                        else ctx.drawImage(getRarityIcon('shield', item.rarity), ix, iyy, isz, isz);
                    }
                    ctx.restore();
                }
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
                if (action) this._hot(x + 12, iy, innerW, ih, action, { category: cat, id: item.id });
                iy += ih + ig;
            }
        }
    }

    _drawLoadout(ctx, state) { this._drawItemGrid(ctx, state, 'gear'); }

    // Truncate `txt` with an ellipsis so it fits `maxW` at the CURRENT font.
    _ellip(ctx, txt, maxW) {
        if (ctx.measureText(txt).width <= maxW) return txt;
        let s = String(txt);
        while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
        return s + '…';
    }

    // A small representative preview of a cosmetic for the picker/summary: a
    // pixel cloak/hat, a fur tint disc, an aura glow, or trail puffs. "None"
    // items (no color/shape) get a hollow slashed ring. Caller controls alpha.
    _cosmeticSwatch(ctx, cat, item, ix, iyy, isz) {
        const icx = ix + isz / 2, icy = iyy + isz / 2;
        const isNone = cat === 'hat' ? (!item.shape || item.shape === 'none')
            : (cat === 'cloak' || cat === 'trail') ? !item.color : false;
        if (isNone) {
            ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(icx, icy, isz * 0.34, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(icx - isz * 0.24, icy + isz * 0.24); ctx.lineTo(icx + isz * 0.24, icy - isz * 0.24); ctx.stroke();
            return;
        }
        if (cat === 'cloak') {
            ctx.save(); ctx.beginPath(); ctx.rect(ix, iyy, isz, isz); ctx.clip();
            const ps = isz * 0.78; drawPixelCloak(ctx, icx, icy - ps * 0.34, ps, 'down', item.color, false);
            ctx.restore(); return;
        }
        if (cat === 'hat') {
            ctx.save(); ctx.beginPath(); ctx.rect(ix, iyy, isz, isz); ctx.clip();
            const ps = isz * 0.78; drawPixelHat(ctx, icx, icy + ps * 0.36, ps, 'down', item.shape, item.color, false);
            ctx.restore(); return;
        }
        if (cat === 'aura') {
            const col = item.color || '#ff9a3c';
            const g = ctx.createRadialGradient(icx, icy, 2, icx, icy, isz * 0.5);
            g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(icx, icy, isz * 0.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = col; ctx.beginPath(); ctx.arc(icx, icy, 3.5, 0, Math.PI * 2); ctx.fill();
            return;
        }
        if (cat === 'trail') {
            const baseA = ctx.globalAlpha;
            ctx.fillStyle = item.color;
            for (let d = 0; d < 3; d++) {
                ctx.globalAlpha = baseA * (1 - d * 0.28);
                ctx.beginPath(); ctx.arc(ix + 7 + d * 8, icy, Math.max(1.6, 5 - d * 1.3), 0, Math.PI * 2); ctx.fill();
            }
            ctx.globalAlpha = baseA; return;
        }
        // fur (and any fallback): a tint disc; natural (no color) gets a slash.
        ctx.fillStyle = item.color || '#b98a5a';
        ctx.beginPath(); ctx.arc(icx, icy, isz * 0.42, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
        if (!item.color) {
            ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(icx - isz * 0.24, icy + isz * 0.24); ctx.lineTo(icx + isz * 0.24, icy - isz * 0.24); ctx.stroke();
        }
    }

    // ── CHARACTER — a live customizer: the model on the LEFT updates the
    // instant you click an item; the cosmetic pickers sit on the RIGHT, on the
    // SAME page (no drilling into a separate preview screen). ────────────────
    _drawCharacter(ctx, state) {
        const c = this._contentRect();
        const save = state.saveData;
        const avW = Math.min(560, Math.max(360, c.w * 0.33));
        const gap = 32;

        // Left: live model + equipped-slot summary.
        this._panel(ctx, c.x, c.y, avW, c.h, 'rgba(20,16,28,0.82)', 'rgba(192,139,255,0.22)');
        const ch = getCharacter(save.selectedCharacter);
        const ap = resolveAppearance(save.cosmetics.equipped);
        const avatarAp = { ...ap, furColor: ap.furColor || ch.palette.fur };
        let charSprite = null;
        try {
            const d = getHeroFrames(ch.id, ch).dirs.down;
            charSprite = (this._t % 4.0) > 3.4 ? d.cast[0] : d.idle[0];
        } catch (e) { charSprite = null; }
        const startWeaponId = resolveStartingWeapon(save);
        const heldProp = resolveWeaponProp(startWeaponId);
        const acx = c.x + avW / 2;
        const r = Math.min(150, avW * 0.26);
        const acy = c.y + 40 + r;
        // Soft stage disc beneath the model (scaled arc — no ctx.ellipse).
        ctx.save();
        ctx.translate(acx, acy + r * 0.9); ctx.scale(1, 0.3);
        ctx.fillStyle = 'rgba(192,139,255,0.12)';
        ctx.beginPath(); ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        this._drawAvatar(ctx, acx, acy, r, avatarAp, charSprite, null, this._t, !!ch.lpc, heldProp, resolveCharacterHold(ch.id), ch.palette && ch.palette.face);
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#fff'; ctx.font = `800 30px ${FONT}`;
        ctx.fillText(ch.name, acx, acy + r + 30);
        if (ap.set) {
            // Whole themed set equipped → celebrate it (set-bonus VFX is live on
            // the model above).
            ctx.fillStyle = ap.set.color; ctx.font = `800 16px ${FONT}`;
            ctx.fillText(`✦ SET COMPLETE — ${ap.set.name} ✦`, acx, acy + r + 52);
        } else {
            ctx.fillStyle = 'rgba(192,139,255,0.95)'; ctx.font = `700 15px ${FONT}`;
            ctx.fillText('CUSTOMIZE  ·  LIVE PREVIEW', acx, acy + r + 52);
        }

        // Equipped-slot summary — a compact sheet of the current choices.
        const sx = c.x + 28, sw = avW - 56;
        const sy = acy + r + 70;
        const n = COSMETIC_CATEGORIES.length;
        const rgap = 12;
        const avail = (c.y + c.h - 16) - sy;
        const rowH = Math.max(30, Math.min(60, (avail - rgap * (n - 1)) / n));
        ctx.textBaseline = 'middle';
        for (let i = 0; i < n; i++) {
            const cat = COSMETIC_CATEGORIES[i];
            const ry = sy + i * (rowH + rgap);
            if (ry + rowH > c.y + c.h - 8) break;
            const item = COSMETICS[save.cosmetics.equipped[cat]] || { color: null };
            roundRectPath(ctx, sx, ry, sw, rowH, 9);
            ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
            ctx.strokeStyle = 'rgba(192,139,255,0.22)'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.save();
            this._cosmeticSwatch(ctx, cat, item, sx + 10, ry + (rowH - 26) / 2, 26);
            ctx.restore();
            ctx.textAlign = 'left';
            ctx.fillStyle = 'rgba(205,214,226,0.7)'; ctx.font = `700 15px ${FONT}`;
            ctx.fillText(COSMETIC_CATEGORY_LABELS[cat], sx + 46, ry + rowH / 2);
            ctx.textAlign = 'right';
            ctx.fillStyle = '#fff'; ctx.font = `600 16px ${FONT}`;
            ctx.fillText(this._ellip(ctx, item.name || '—', sw - 150), sx + sw - 14, ry + rowH / 2);
        }

        // Right: the cosmetic pickers, on the same page.
        const rRect = { x: c.x + avW + gap, y: c.y, w: c.w - avW - gap, h: c.h };
        this._drawItemGrid(ctx, state, 'cosmetic', rRect);
    }

    // ── SHOP (cases) ─────────────────────────────────────────────────────
    _drawShop(ctx, state) {
        const c = this._contentRect();
        const save = state.saveData;
        const gap = 24;
        // Six cases (gear + cosmetic per tier) → a 3-column, 2-row grid so the
        // names + odds aren't crushed into thin slivers.
        const cols = 3;
        const rows = Math.ceil(CASE_ORDER.length / cols);
        // Reserve strips at the bottom for Featured Prestige + the Cinder Wager.
        const forgeH = 144;
        const featH = 96, featGap = 14;
        const gridH = c.h - forgeH - 24 - featH - featGap;
        const cardW = (c.w - gap * (cols - 1)) / cols;
        const rowH = (gridH - gap * (rows - 1)) / rows;
        ctx.textBaseline = 'alphabetic';
        for (let i = 0; i < CASE_ORDER.length; i++) {
            const def = CASES[CASE_ORDER[i]];
            const col = i % cols, row = Math.floor(i / cols);
            const x = c.x + col * (cardW + gap);
            const y = c.y + row * (rowH + gap);
            this._panel(ctx, x, y, cardW, rowH, 'rgba(18,22,30,0.9)');
            const midX = x + cardW / 2;
            const innerX = x + 30, innerW = cardW - 60;
            ctx.textAlign = 'center';
            ctx.fillStyle = '#fff'; ctx.font = `800 25px ${FONT}`;
            ctx.fillText(def.name, midX, y + 34);
            // "up to ★ <TOP RARITY>" aspiration tag under the title — the ceiling
            // reward, in its own colour, so the chase target reads at a glance.
            const topR = caseTopRarity(def.id);
            ctx.font = `800 14px ${FONT}`; ctx.fillStyle = rarityColor(topR);
            ctx.fillText(`up to ★ ${rarityName(topR).toUpperCase()}`, midX, y + 53);
            // OPEN button anchored at the card bottom; everything above adapts to
            // whatever height remains, so nothing collides on short panels where
            // the grid shares space with the Featured + Mines strips.
            const afford = save.totalCoins >= def.cost;
            const btnH = Math.max(38, Math.min(52, rowH * 0.27));
            const br = { x: innerX, y: y + rowH - btnH - 10, w: innerW, h: btnH };
            // ── The middle band between the tag and the OPEN button holds the
            // odds bar + the bad-luck pity meter, laid out from the BOTTOM up so
            // neither can ever collide with the button on short (large-safe-area)
            // cards. Each element is dropped before it would overlap — the same
            // graceful-compression behaviour the odds table used to have. ──
            const mTop = y + 58, mBot = br.y - 8, band = mBot - mTop;
            // Bad-luck pity meter (the addictive hook): live "Rare+ guaranteed in
            // N" readout nearest the button. Full text+bar when there's room, a
            // compact text-only line when cramped, dropped entirely when tiny.
            const cap = CASE_PITY[def.id] || 12;
            const remain = casePityRemaining(save, def.id);
            const frac = clamp01((cap - remain) / cap);
            const soon = remain === 1;
            // The pity meter is the priority element (the hook), so it claims the
            // band bottom first; the odds bar only fills whatever is left above.
            let pityTop = mBot;   // lower bound for the odds bar above
            if (band >= 12) {
                const full = band >= 24;
                pityTop = mBot - (full ? 18 : 13);
                ctx.textAlign = 'center'; ctx.font = `700 ${full ? 12 : 11}px ${FONT}`;
                ctx.fillStyle = soon ? '#ffd24a' : remain <= 3 ? '#ff9a4a' : 'rgba(255,255,255,0.55)';
                ctx.fillText(soon ? '★ GUARANTEED RARE+ NEXT ★' : `◆ Rare+ guaranteed in ${remain}`, midX, full ? mBot - 8 : mBot - 3);
                if (full) {
                    const pBarY = mBot - 3;
                    roundRectPath(ctx, innerX, pBarY, innerW, 3, 1.5); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
                    if (frac > 0) { roundRectPath(ctx, innerX, pBarY, innerW * frac, 3, 1.5); ctx.fillStyle = soon ? '#ffd24a' : '#ff8a4a'; ctx.fill(); }
                }
            }
            // Odds as a stacked probability bar (common→rarest, width ∝ chance),
            // colour-coded, with the % printed inside any segment wide/tall enough
            // to hold it. Fills whatever space is left above the pity block.
            const oddsRows = caseOddsRows(def.id);          // high→low
            const asc = oddsRows.slice().reverse();          // low→high for the bar
            const totalPct = asc.reduce((s, r) => s + r.pct, 0) || 1;
            const obTop = mTop + 1, obBot = pityTop - 3;
            if (obBot - obTop >= 6) {
                const obH = Math.min(15, obBot - obTop), obY = obTop;
                let segX = innerX;
                ctx.textBaseline = 'middle';
                for (let ri = 0; ri < asc.length; ri++) {
                    const r = asc[ri];
                    const segW = (r.pct / totalPct) * innerW;
                    if (segW <= 0) continue;
                    ctx.fillStyle = rarityColor(r.rarity);
                    ctx.globalAlpha = 0.9;
                    roundRectPath(ctx, segX + (ri ? 1 : 0), obY, Math.max(1, segW - (ri ? 1 : 0)), obH, 3);
                    ctx.fill();
                    ctx.globalAlpha = 1;
                    if (segW >= 34 && obH >= 12) {
                        ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.font = `800 11px ${FONT}`;
                        ctx.textAlign = 'center';
                        ctx.fillText(`${r.pct}%`, segX + segW / 2, obY + obH / 2 + 0.5);
                    }
                    segX += segW;
                }
                ctx.textBaseline = 'alphabetic';
            }
            // Always clickable: an unaffordable tap surfaces a "Not enough
            // coins" toast rather than silently doing nothing.
            this._button(ctx, br, `OPEN  ◎ ${def.cost}`,
                { primary: afford, enabled: true, accent: afford ? null : 'rgba(60,66,78,0.9)', action: 'openCase', arg: def.id, fontSize: Math.round(Math.min(24, btnH * 0.44)) });
        }

        // ── Featured Prestige: a spotlight on grind-worthy cosmetics with a
        // LIVE animated preview; tapping a card jumps to the customizer to chase
        // it. Pure marketing for the prestige layer. ──
        const featY = c.y + gridH + featGap;
        this._panel(ctx, c.x, featY, c.w, featH, 'rgba(24,18,34,0.92)', '#c08bff');
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#c08bff'; ctx.font = `800 22px ${FONT}`;
        ctx.fillText('✦ FEATURED PRESTIGE', c.x + 24, featY + 30);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `600 15px ${FONT}`;
        ctx.fillText('— earn the look', c.x + 360, featY + 29);
        const feat = ['aura_prism', 'aura_inferno', 'hat_halo', 'trail_rainbow', 'fur_galaxy'];
        const fcGap = 16, fcTop = featY + 42, fcH = featH - 42 - 12;
        const fcW = (c.w - 48 - fcGap * (feat.length - 1)) / feat.length;
        for (let i = 0; i < feat.length; i++) {
            const item = COSMETICS[feat[i]]; if (!item) continue;
            const fx = c.x + 24 + i * (fcW + fcGap);
            roundRectPath(ctx, fx, fcTop, fcW, fcH, 10);
            ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
            ctx.strokeStyle = rarityColor(item.rarity); ctx.lineWidth = 2; ctx.stroke();
            const boxR = Math.min(26, fcH / 2 - 8), bcx = fx + boxR + 14, bcy = fcTop + fcH / 2;
            ctx.save(); roundRectPath(ctx, fx, fcTop, fcW, fcH, 10); ctx.clip();
            if (item.category === 'aura') drawAuraFx(ctx, bcx, bcy, boxR, item.color, item.fx, this._t, 0.5);
            else { const isz = boxR * 2; this._cosmeticSwatch(ctx, item.category, item, bcx - boxR, bcy - boxR, isz); }
            ctx.restore();
            const tx = fx + boxR * 2 + 24, tw = fcW - (boxR * 2 + 36);
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = rarityColor(item.rarity); ctx.font = `800 17px ${FONT}`;
            ctx.fillText(this._ellip(ctx, item.name, tw), tx, bcy - 3);
            let pathTxt;
            if (save.cosmetics.unlocked.includes(item.id)) pathTxt = '✓ Owned';
            else if (item.coinCost) pathTxt = `◎ ${cosmeticCoinCost(item)}`;
            else if (item.achievement) { const ach = ACHIEVEMENTS.find((a) => a.id === item.achievement); pathTxt = `🏆 ${ach ? ach.name : 'Achievement'}`; }
            else pathTxt = '🔒 Case drop';
            ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.font = `600 14px ${FONT}`;
            ctx.fillText(this._ellip(ctx, pathTxt, tw), tx, bcy + 19);
            this._hot(fx, fcTop, fcW, fcH, 'tab', 'character');
        }

        // ── Cinder Wager strip: a skill coin-gamble. Pick a stake, then STOP
        // the sweeping spark on the multiplier bar (center = jackpot). ──
        const fy = featY + featH + 24;
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

        // Ornate ember crest (higgsfield) crowning the pass, centered above the
        // progress bar; the header labels sit at the far edges and the bar draws
        // over its base, so it reads as a forged crown rising behind the track.
        const ui = getMenuImages();
        if (ui.crest) {
            const chH = 66, chW = ui.crest.width * (chH / ui.crest.height);
            ctx.save(); ctx.globalAlpha = 0.9;
            ctx.drawImage(ui.crest, c.x + c.w / 2 - chW / 2, c.y - 14, chW, chH);
            ctx.restore();
        }

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
        this._panel(ctx, c.x, c.y, c.w, c.h, null, undefined, { corners: true });
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
        const W = INTERNAL_WIDTH, H = INTERNAL_HEIGHT;
        const cx = W / 2, cy = H / 2;
        const t = anim.age;
        const reveal = anim.reel ? (anim.spinTime ?? 2.6) : 0.85;
        const result = anim.result;
        const col = result && result.rarity ? rarityColor(result.rarity) : '#ffce54';
        const tier = result && result.rarity && RARITIES[result.rarity] ? RARITIES[result.rarity].tier : 1;
        const revealAge = Math.max(0, t - reveal);
        // Overshoot ease (lands on 1 but drifts past first) — the near-miss.
        const backOut = (x, s = 0.9) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);

        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(0, 0, W, H);

        // High-tier reveals physically SHAKE the overlay (decays over ~0.4s).
        let shx = 0, shy = 0;
        if (t >= reveal && tier >= 3) {
            const s = Math.max(0, 1 - revealAge / 0.4) * (tier - 2) * 6;
            shx = (Math.random() * 2 - 1) * s; shy = (Math.random() * 2 - 1) * s;
        }
        ctx.save();
        ctx.translate(shx, shy);

        if (t < reveal && anim.reel) {
            // Spin reel: decelerates AND overshoots so the strip drifts past the
            // winner and creeps back — the signature "almost got the next one".
            const cellW = 168, cellH = 132, gap = 10, stride = cellW + gap;
            const p = clamp01(t / reveal);
            const offset = backOut(p) * anim.landingIndex * stride;
            const bandY = cy - cellH / 2;
            roundRectPath(ctx, 0, bandY - 8, W, cellH + 16, 0);
            ctx.fillStyle = 'rgba(8,10,16,0.92)'; ctx.fill();
            ctx.save();
            ctx.beginPath(); ctx.rect(60, bandY - 8, W - 120, cellH + 16); ctx.clip();
            for (let i = 0; i < anim.reel.length; i++) {
                const cellX = cx - offset + i * stride - cellW / 2;
                if (cellX > W + cellW || cellX < -cellW) continue;
                const cell = anim.reel[i];
                const cc = rarityColor(cell.rarity);
                const near = 1 - Math.min(1, Math.abs(cellX + cellW / 2 - cx) / (stride * 0.6));
                roundRectPath(ctx, cellX, bandY, cellW, cellH, 12);
                ctx.fillStyle = `rgba(255,255,255,${0.04 + near * 0.08})`; ctx.fill();
                ctx.strokeStyle = cc; ctx.lineWidth = 3 + near * 3; ctx.stroke();
                ctx.fillStyle = cc;
                ctx.beginPath(); ctx.arc(cellX + cellW / 2, bandY + cellH * 0.36, 26, 0, Math.PI * 2); ctx.fill();
                this._kindGlyph(ctx, cellX + cellW / 2, bandY + cellH * 0.36, 15, cell.kind);
                ctx.fillStyle = '#fff'; ctx.font = `700 18px ${FONT}`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                const nm = cell.name.length > 14 ? cell.name.slice(0, 13) + '…' : cell.name;
                ctx.fillText(nm, cellX + cellW / 2, bandY + cellH * 0.78);
            }
            ctx.restore();
            // Center marker (brightens as it slows).
            const mk = 0.6 + 0.4 * p;
            ctx.strokeStyle = '#ffd86b'; ctx.globalAlpha = mk; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(cx, bandY - 14); ctx.lineTo(cx, bandY + cellH + 14); ctx.stroke();
            ctx.fillStyle = '#ffd86b';
            ctx.beginPath(); ctx.moveTo(cx - 14, bandY - 14); ctx.lineTo(cx + 14, bandY - 14); ctx.lineTo(cx, bandY + 2); ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.moveTo(cx - 14, bandY + cellH + 14); ctx.lineTo(cx + 14, bandY + cellH + 14); ctx.lineTo(cx, bandY + cellH - 2); ctx.closePath(); ctx.fill();
            ctx.globalAlpha = 1;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = `800 30px ${FONT}`;
            ctx.fillText('OPENING…', cx, bandY - 48);
        } else if (result) {
            // ── REVEAL: spectacle scaled by rarity tier ──
            const k = easeOutCubic(clamp01(revealAge / 0.4));
            // (1) Full-screen flash — brighter/whiter the rarer the pull.
            const flash = Math.max(0, 1 - revealAge / (0.22 + tier * 0.06));
            if (flash > 0) {
                ctx.save(); ctx.globalAlpha = flash * (0.18 + tier * 0.1);
                ctx.fillStyle = tier >= 4 ? '#ffffff' : col; ctx.fillRect(0, 0, W, H); ctx.restore();
            }
            // (2) Rotating light rays behind the card for epic+ pulls.
            if (tier >= 4) {
                ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.16 * k;
                ctx.translate(cx, cy); ctx.rotate(revealAge * 0.5); ctx.fillStyle = col;
                const rays = 12;
                for (let i = 0; i < rays; i++) {
                    ctx.rotate((Math.PI * 2) / rays);
                    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(520, -26); ctx.lineTo(520, 26); ctx.closePath(); ctx.fill();
                }
                ctx.restore();
            }
            // (3) Radial glow bloom.
            const g = ctx.createRadialGradient(cx, cy, 30, cx, cy, 380);
            g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.save(); ctx.globalAlpha = 0.5; ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 380, 0, Math.PI * 2); ctx.fill(); ctx.restore();
            // (4) Expanding shock ring.
            const ring = revealAge / 0.6;
            if (ring < 1) {
                ctx.save(); ctx.globalAlpha = (1 - ring) * 0.8; ctx.strokeStyle = col;
                ctx.lineWidth = 2 + (1 - ring) * 7;
                ctx.beginPath(); ctx.arc(cx, cy, 70 + ring * 460, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
            }
            // (5) Spark burst — count + reach scale with tier.
            const nSpark = 6 + tier * 6;
            const sp = easeOutCubic(clamp01(revealAge / 0.7));
            ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = col;
            for (let i = 0; i < nSpark; i++) {
                const a = (i / nSpark) * Math.PI * 2 + tier;
                const dist = sp * (170 + tier * 45);
                const sr = (1 - sp) * (5 + tier);
                if (sr <= 0.5) continue;
                const sxp = cx + Math.cos(a) * dist, syp = cy + Math.sin(a) * dist;
                ctx.globalAlpha = (1 - sp) * 0.9;
                ctx.beginPath();
                ctx.moveTo(sxp, syp - sr); ctx.lineTo(sxp + sr * 0.4, syp); ctx.lineTo(sxp, syp + sr);
                ctx.lineTo(sxp - sr * 0.4, syp); ctx.closePath(); ctx.fill();
            }
            ctx.restore();
            // (6) The prize card — pops in with a bouncy overshoot.
            const ks = backOut(clamp01(revealAge / 0.45), 1.4);
            const cardW = 470 * ks, cardH = 268 * ks;
            roundRectPath(ctx, cx - cardW / 2, cy - cardH / 2, cardW, cardH, 18);
            ctx.fillStyle = 'rgba(20,24,34,0.98)'; ctx.fill();
            ctx.strokeStyle = col; ctx.lineWidth = 4 + tier; ctx.stroke();
            if (k > 0.55) {
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                const isItem = result.kind === 'gear' || result.kind === 'cosmetic';
                // Tags above the card: PITY guarantee, then NEW / DUPLICATE.
                let topY = cy - cardH / 2 - 26;
                if (result.pity) {
                    ctx.fillStyle = '#ffd86b'; ctx.font = `800 22px ${FONT}`;
                    ctx.fillText('✦ BAD-LUCK GUARANTEE ✦', cx, topY); topY -= 30;
                }
                // Kind logo.
                ctx.fillStyle = col;
                ctx.beginPath(); ctx.arc(cx, cy - 92, 24, 0, Math.PI * 2); ctx.fill();
                this._kindGlyph(ctx, cx, cy - 92, 14, result.kind);
                ctx.fillStyle = col; ctx.font = `800 30px ${FONT}`;
                ctx.fillText(rarityName(result.rarity).toUpperCase(), cx, cy - 52);
                ctx.fillStyle = '#fff'; ctx.font = `800 40px ${FONT}`;
                ctx.fillText(result.kind === 'duplicate' ? result.name : (result.name || result.label), cx, cy + 2);
                if (isItem) {
                    ctx.fillStyle = '#5fe87a'; ctx.font = `800 24px ${FONT}`;
                    ctx.fillText('★ NEW — UNLOCKED! ★', cx, cy + 48);
                } else if (result.kind === 'duplicate') {
                    ctx.fillStyle = '#ffd86b'; ctx.font = `700 24px ${FONT}`;
                    ctx.fillText(`DUPLICATE → +${result.amount} ◎`, cx, cy + 48);
                    if (result.dupeTotal) {
                        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `600 16px ${FONT}`;
                        ctx.fillText(`${result.dupeTotal} ◎ earned from duplicates`, cx, cy + 78);
                    }
                } else {
                    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = `700 24px ${FONT}`;
                    ctx.fillText(result.label, cx, cy + 48);
                }
                ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `600 20px ${FONT}`;
                ctx.fillText('Tap / Space to continue', cx, cy + cardH / 2 + 38);
            }
        }
        ctx.restore();  // shake
        this._hot(0, 0, W, H, 'caseContinue', null);
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
