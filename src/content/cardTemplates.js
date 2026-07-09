// cardTemplates.js — the death / victory / photo card layouts + shared chrome
// helpers for the CardCompositor (EMBERGLASS / roadmap #2).
//
// Every template is a pure sync draw function (ctx, data, helpers) over the
// compositor's 1200×630 canvas. helpers.bg is a cover-cropped capture of the
// live world frame (or null in the headless / no-capture case → gradient
// fallback). All text uses the menu's forged Cinzel display face; hero portraits
// come from the PROCEDURAL monkey frames (getHeroFrames), never a flat AI sprite.
//
// registerCardTemplates(compositor) wires 'death'/'victory'/'photo'. Later
// updates append their own templates through the same registry (see docs/CARDS.md).

import { DISPLAY_FONT, ensureMenuFont } from '../assets/MenuFont.js';
import { getHeroFrames } from '../assets/ProceduralSprites.js';
import { getCharacter } from '../content/characters.js';

const CARD_W = 1200, CARD_H = 630;

// Forged-ember palette.
const INK = '#0d0708';
const EMBER = '#ff9a4a';
const EMBER_DEEP = '#5a2a12';
const GOLD = '#ffd166';
const PARCH = '#efe0c4';
const ASH = 'rgba(239, 224, 196, 0.72)';
const GOLD_ACCENT = '#ffce5c';

function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function utcDate() {
    try { return new Date().toISOString().slice(0, 10); } catch (e) { return ''; }
}

function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// 8px ember frame (2px bright outer, 6px deep inner) with notched corners.
function drawFrame(ctx, accent = EMBER) {
    ctx.save();
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = EMBER_DEEP;
    ctx.lineWidth = 6;
    ctx.strokeRect(9, 9, CARD_W - 18, CARD_H - 18);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(6, 6, CARD_W - 12, CARD_H - 12);
    // Corner notches — a forged, sealed-frame read.
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    const n = 26, o = 20;
    const corners = [[o, o, 1, 1], [CARD_W - o, o, -1, 1], [o, CARD_H - o, 1, -1], [CARD_W - o, CARD_H - o, -1, -1]];
    for (const [cx, cy, sx, sy] of corners) {
        ctx.beginPath();
        ctx.moveTo(cx + sx * n, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + sy * n);
        ctx.stroke();
    }
    ctx.restore();
}

function drawWordmark(ctx, x, y, accent = GOLD) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `44px ${DISPLAY_FONT}`;
    ctx.fillStyle = accent;
    ctx.shadowColor = 'rgba(255, 150, 60, 0.5)';
    ctx.shadowBlur = 16;
    ctx.fillText('EMBERWAKE', x, y);
    ctx.shadowBlur = 0;
    ctx.font = `600 15px ${DISPLAY_FONT}`;
    ctx.fillStyle = ASH;
    ctx.fillText('H O L D   T H E   L A S T   L I G H T', x + 2, y + 24);
    ctx.restore();
}

// A single hero portrait, procedural monkey frame, crisp (smoothing off).
function drawPortrait(ctx, x, y, size, characterId, accent = EMBER) {
    ctx.save();
    // Panel.
    roundRect(ctx, x, y, size, size, 14);
    ctx.fillStyle = 'rgba(12, 8, 10, 0.72)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = accent;
    ctx.stroke();
    ctx.clip();
    try {
        const id = characterId || 'monkey';
        const frames = getHeroFrames(id, getCharacter(id));
        const frame = frames && frames.dirs && frames.dirs.down && frames.dirs.down.idle
            ? frames.dirs.down.idle[0] : null;
        if (frame && frame.width) {
            ctx.imageSmoothingEnabled = false;
            const pad = size * 0.12;
            const dw = size - pad * 2;
            const ar = frame.width / frame.height;
            let w = dw, h = dw / ar;
            if (h > dw) { h = dw; w = dw * ar; }
            ctx.drawImage(frame, x + (size - w) / 2, y + (size - h) / 2 + size * 0.04, w, h);
        }
    } catch (e) { /* portrait optional */ }
    ctx.restore();
}

function drawChips(ctx, x, y, chips, accent = EMBER) {
    if (!chips || !chips.length) return;
    ctx.save();
    ctx.font = `600 24px ${DISPLAY_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const h = 44, padX = 18, gap = 12;
    let cx = x;
    for (const raw of chips) {
        const label = String(raw);
        const w = ctx.measureText(label).width + padX * 2;
        roundRect(ctx, cx, y, w, h, h / 2);
        ctx.fillStyle = 'rgba(26, 14, 10, 0.82)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(255, 154, 74, 0.55)`;
        ctx.stroke();
        ctx.fillStyle = PARCH;
        ctx.fillText(label, cx + padX, y + h / 2 + 1);
        cx += w + gap;
    }
    ctx.restore();
}

function drawNewBestRibbon(ctx, cx, cy) {
    ctx.save();
    ctx.font = `700 26px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = '★ NEW BEST';
    const w = ctx.measureText(label).width + 44, h = 46;
    ctx.translate(cx, cy);
    ctx.rotate(-0.06);
    roundRect(ctx, -w / 2, -h / 2, w, h, 8);
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, '#ffe08a');
    g.addColorStop(1, '#f5a623');
    ctx.fillStyle = g;
    ctx.shadowColor = 'rgba(255, 200, 90, 0.6)';
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#2a1606';
    ctx.fillText(label, 0, 2);
    ctx.restore();
}

function drawFooter(ctx, left, right, accent = EMBER) {
    ctx.save();
    const y = CARD_H - 46;
    ctx.fillStyle = 'rgba(10, 6, 8, 0.62)';
    ctx.fillRect(6, y, CARD_W - 12, 40);
    ctx.strokeStyle = `rgba(255, 154, 74, 0.4)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(6, y);
    ctx.lineTo(CARD_W - 6, y);
    ctx.stroke();
    ctx.font = `600 20px ${DISPLAY_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ASH;
    ctx.textAlign = 'left';
    ctx.fillText(left || '', 30, y + 21);
    ctx.textAlign = 'right';
    ctx.fillText(right || '', CARD_W - 30, y + 21);
    ctx.restore();
}

// Cover-fit the captured world frame, or a themed gradient when there's none.
function drawBackground(ctx, bg, darkAlpha = 0.5) {
    if (bg && bg.width) {
        try { ctx.drawImage(bg, 0, 0, CARD_W, CARD_H); } catch (e) { bg = null; }
    }
    if (!bg || !bg.width) {
        const g = ctx.createLinearGradient(0, 0, 0, CARD_H);
        g.addColorStop(0, '#14090b');
        g.addColorStop(1, '#2a0f08');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, CARD_W, CARD_H);
    }
    // Legibility wash + bottom-up gradient so the text zone reads.
    ctx.fillStyle = `rgba(10, 6, 8, ${darkAlpha})`;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
    const bg2 = ctx.createLinearGradient(0, CARD_H * 0.42, 0, CARD_H);
    bg2.addColorStop(0, 'rgba(8, 4, 6, 0)');
    bg2.addColorStop(1, 'rgba(6, 3, 5, 0.92)');
    ctx.fillStyle = bg2;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
}

function killerLine(k) {
    if (!k || !k.label) return 'to the closing dark';
    if (k.boss) return `to ${k.label}${k.epithet ? ', ' + k.epithet : ''}`;
    if (k.hazard) return `to ${k.label}`;
    return `to a ${k.label}`;
}

// ── Templates ──────────────────────────────────────────────────────────────

function drawDeathCard(ctx, data, helpers) {
    ensureMenuFont();
    const d = data || {};
    drawBackground(ctx, helpers && helpers.bg, 0.55);
    drawFrame(ctx, EMBER);
    drawWordmark(ctx, 56, 66, GOLD);

    // Date, top-right.
    ctx.save();
    ctx.font = `600 20px ${DISPLAY_FONT}`;
    ctx.fillStyle = ASH;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(utcDate(), CARD_W - 56, 52);
    ctx.restore();

    if (d.newBest) drawNewBestRibbon(ctx, CARD_W - 180, 150);

    const size = 176;
    const px = 56, py = CARD_H - 46 - size - 26;
    drawPortrait(ctx, px, py, size, d.characterId, EMBER);

    const tx = px + size + 34;
    // Headline.
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `54px ${DISPLAY_FONT}`;
    ctx.fillStyle = '#fff1e0';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;
    const name = String(d.name || 'THE KEEPER').toUpperCase();
    ctx.fillText(`${name} FELL AT ${fmtTime(d.time)}`, tx, py + 58);
    // Killer line.
    ctx.font = `600 30px ${DISPLAY_FONT}`;
    ctx.fillStyle = EMBER;
    ctx.fillText(killerLine(d.killer), tx, py + 100);
    ctx.restore();

    drawChips(ctx, tx, py + 122, d.chips || [], EMBER);
    drawFooter(ctx, d.mapName || '', d.difficulty || '', EMBER);
}

function drawVictoryCard(ctx, data, helpers) {
    ensureMenuFont();
    const d = data || {};
    drawBackground(ctx, helpers && helpers.bg, 0.46);
    drawFrame(ctx, GOLD_ACCENT);
    drawWordmark(ctx, 56, 66, GOLD);

    ctx.save();
    ctx.font = `600 20px ${DISPLAY_FONT}`;
    ctx.fillStyle = ASH;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(utcDate(), CARD_W - 56, 52);
    ctx.restore();

    const size = 176;
    const px = 56, py = CARD_H - 46 - size - 26;
    drawPortrait(ctx, px, py, size, d.characterId, GOLD_ACCENT);

    const tx = px + size + 34;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `54px ${DISPLAY_FONT}`;
    ctx.fillStyle = '#fff4d8';
    ctx.shadowColor = 'rgba(255, 190, 80, 0.55)';
    ctx.shadowBlur = 14;
    const name = String(d.name || 'THE KEEPER').toUpperCase();
    ctx.fillText(`${name} HELD THE LIGHT`, tx, py + 52);
    ctx.shadowBlur = 0;
    ctx.font = `700 40px ${DISPLAY_FONT}`;
    ctx.fillStyle = GOLD;
    ctx.fillText(fmtTime(d.time), tx, py + 96);
    ctx.font = `600 26px ${DISPLAY_FONT}`;
    ctx.fillStyle = ASH;
    ctx.fillText(d.sub || 'Three apex Hollow have fallen', tx, py + 130);
    ctx.restore();

    drawChips(ctx, tx, py + 150, d.chips || [], GOLD_ACCENT);
    drawFooter(ctx, d.mapName || '', d.difficulty || '', GOLD_ACCENT);
}

function drawPhotoCard(ctx, data, helpers) {
    ensureMenuFont();
    const d = data || {};
    drawBackground(ctx, helpers && helpers.bg, 0.0);
    // Thin frame only — the shot is the star.
    ctx.save();
    ctx.strokeStyle = EMBER;
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, CARD_W - 12, CARD_H - 12);
    ctx.restore();
    // Wordmark bottom-right, low alpha.
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `28px ${DISPLAY_FONT}`;
    ctx.fillStyle = GOLD;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 10;
    ctx.fillText('EMBERWAKE', CARD_W - 30, CARD_H - 26);
    ctx.restore();
    // Filter name, bottom-left small caps.
    if (d.filterName) {
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = `600 20px ${DISPLAY_FONT}`;
        ctx.fillStyle = ASH;
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 8;
        ctx.fillText(String(d.filterName).toUpperCase(), 30, CARD_H - 26);
        ctx.restore();
    }
}

// KINDLED (roadmap #3) — the daily Rite Trial recap. A hero-locked, Kindle-centric
// score card. Reuses the shared forged chrome; the big number is the SCORE.
// data: { name, characterId, ultName, day, score, best, outcome, time, chips,
//         mapName, difficulty }. Reads defensively; never throws.
function drawRiteCard(ctx, data, helpers) {
    ensureMenuFont();
    const d = data || {};
    drawBackground(ctx, helpers && helpers.bg, 0.52);
    drawFrame(ctx, EMBER);
    drawWordmark(ctx, 56, 66, GOLD);

    // "RITE TRIAL · Day N", top-right.
    ctx.save();
    ctx.font = `600 20px ${DISPLAY_FONT}`;
    ctx.fillStyle = ASH;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    const dayLabel = Number.isFinite(d.day) ? `RITE TRIAL · DAY ${d.day}` : 'RITE TRIAL';
    ctx.fillText(dayLabel, CARD_W - 56, 52);
    ctx.restore();

    // NEW BEST ribbon when this run set the day's best.
    if (d.best != null && d.score != null && d.score >= d.best && d.score > 0) drawNewBestRibbon(ctx, CARD_W - 180, 150);

    const size = 176;
    const px = 56, py = CARD_H - 46 - size - 26;
    drawPortrait(ctx, px, py, size, d.characterId, EMBER);

    const tx = px + size + 34;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    // Headline: "RITE OF <HERO>".
    ctx.font = `48px ${DISPLAY_FONT}`;
    ctx.fillStyle = '#fff1e0';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;
    const name = String(d.name || 'THE KEEPER').toUpperCase();
    ctx.fillText(`RITE OF ${name}`, tx, py + 44);
    ctx.shadowBlur = 0;
    // The score, big.
    ctx.font = `700 46px ${DISPLAY_FONT}`;
    ctx.fillStyle = GOLD;
    ctx.fillText(`${Math.max(0, Math.floor(d.score || 0)).toLocaleString()} PTS`, tx, py + 96);
    // Subline: the day's signature + the survived time.
    ctx.font = `600 24px ${DISPLAY_FONT}`;
    ctx.fillStyle = EMBER;
    const sub = d.ultName ? `${d.ultName} · ${fmtTime(d.time)}` : fmtTime(d.time);
    ctx.fillText(sub, tx, py + 128);
    ctx.restore();

    drawChips(ctx, tx, py + 148, d.chips || [], EMBER);
    drawFooter(ctx, d.mapName || '', d.difficulty || '', EMBER);
}

// BOSSFORGE — Boss Rush share card. Mirrors the Rite card: hero portrait,
// gauntlet headline, bosses-felled as the big stat, the apex reached + time as
// the subline, and the run's build as chips. A ★ NEW BEST ribbon on a record.
function drawBossRushCard(ctx, data, helpers) {
    ensureMenuFont();
    const d = data || {};
    drawBackground(ctx, helpers && helpers.bg, 0.52);
    drawFrame(ctx, EMBER);
    drawWordmark(ctx, 56, 66, GOLD);

    // "BOSS RUSH", top-right.
    ctx.save();
    ctx.font = `600 20px ${DISPLAY_FONT}`;
    ctx.fillStyle = ASH;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('BOSS RUSH', CARD_W - 56, 52);
    ctx.restore();

    if (d.newBest) drawNewBestRibbon(ctx, CARD_W - 180, 150);

    const size = 176;
    const px = 56, py = CARD_H - 46 - size - 26;
    drawPortrait(ctx, px, py, size, d.characterId, EMBER);

    const tx = px + size + 34;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    // Headline: cleared vs the hero's gauntlet.
    ctx.font = `48px ${DISPLAY_FONT}`;
    ctx.fillStyle = '#fff1e0';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;
    const name = String(d.name || 'THE KEEPER').toUpperCase();
    ctx.fillText(d.cleared ? 'GAUNTLET CLEARED' : `${name}'S RUSH`, tx, py + 44);
    ctx.shadowBlur = 0;
    // Bosses felled, big.
    ctx.font = `700 46px ${DISPLAY_FONT}`;
    ctx.fillStyle = GOLD;
    const felled = `${Math.max(0, Math.floor(d.bosses || 0))} / ${Math.max(0, Math.floor(d.total || 0))} FELLED`;
    ctx.fillText(felled, tx, py + 96);
    // Subline: apex reached / cleared + survived time.
    ctx.font = `600 24px ${DISPLAY_FONT}`;
    ctx.fillStyle = EMBER;
    ctx.fillText(`${d.sub || ''} · ${fmtTime(d.time)}`, tx, py + 128);
    ctx.restore();

    drawChips(ctx, tx, py + 148, d.chips || [], EMBER);
    drawFooter(ctx, d.mapName || '', d.difficulty || '', EMBER);
}

export function registerCardTemplates(compositor) {
    if (!compositor || !compositor.registerTemplate) return;
    compositor.registerTemplate('death', drawDeathCard);
    compositor.registerTemplate('victory', drawVictoryCard);
    compositor.registerTemplate('photo', drawPhotoCard);
    compositor.registerTemplate('rite', drawRiteCard);
    compositor.registerTemplate('bossrush', drawBossRushCard);
}

export { fmtTime as cardFmtTime };
