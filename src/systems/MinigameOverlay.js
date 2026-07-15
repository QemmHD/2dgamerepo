// MinigameOverlay — the start-screen minigame flows carved out of Game (P1.5):
// the case-opening reel (sim only — MenuRenderer draws it from the UI snapshot)
// and the Mines coin-gamble board (sim + Game-drawn overlay). Owns the overlay
// state (`caseAnim`, `mines`) plus the free-running menu clock the Mines juice
// keys off (Game.time is frozen on the menu). Holds a back-ref to the Game for
// save/audio/toast access; created once in the Game constructor.

import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../config/GameConfig.js';
import {
    openCase, buildCaseReel, MINES, WAGER_BETS, rollMines, minesPayoutQuote,
} from './CaseSystem.js';
import { getGlowSprite } from '../assets/ProceduralSprites.js';
import { roundRectPath, clamp01, easeOutCubic, easeOutBack } from '../render/DrawUtils.js';

export class MinigameOverlay {
    constructor(game) {
        this.game = game;
        this.caseAnim = null;
        // Mines mini-game overlay (coin gamble): state object while open, null
        // otherwise. See openMines.
        this.mines = null;
        // Free-running clock (seconds) for start-screen overlay animation (the
        // Mines reveal pops / multiplier pulse). Game.time is frozen on the
        // menu, so overlay juice keys off this instead. Ticked while an
        // overlay is up.
        this._menuClock = 0;
    }

    // Read the live menu preference first so toggling Reduced Effects does not
    // have to wait for a run transition to refresh Game.reducedEffects. A UI
    // snapshot can override it when drawMines is called from a state-driven
    // renderer.
    _reducedEffects(state = null) {
        if (state && typeof state.reducedEffects === 'boolean') return state.reducedEffects;
        const saved = this.game?.saveSystem?.getSetting?.('reducedEffects');
        if (typeof saved === 'boolean') return saved;
        return this.game?.reducedEffects === true;
    }

    // Start-screen tick: advance the case reel + the Mines juice clock.
    update(dt) {
        if (this.caseAnim) {
            const a = this.caseAnim;
            // Reduced Effects presents the won item immediately at a stable,
            // post-reveal frame. Freezing age also freezes the renderer's
            // decorative rays/orbit instead of merely shortening the reel.
            if (a.reducedEffects || this._reducedEffects()) {
                a.reducedEffects = true;
                a.spinTime = 0;
                a.settleHold = 0;
                a.age = 1;
                if (!a._revealPlayed) {
                    this.game.audio.reveal(a.result?.rarity);
                    a._revealPlayed = true;
                }
            } else {
                const spinTime = a.spinTime ?? 2.6;
                const wasSpinning = a.age < spinTime;
                a.age += dt;
                if (wasSpinning) {
                    // Ratchet tick that SLOWS as the reel decelerates (50ms → ~290ms)
                    // and RISES in pitch toward the landing — climbing higher when a
                    // Rare+ is incoming, so your ears feel the pull coming.
                    const p = Math.min(1, a.age / spinTime);
                    const interval = 0.05 + p * p * 0.24;
                    a._tick = (a._tick ?? 0) + dt;
                    if (a.age < spinTime && a._tick >= interval) {
                        a._tick = 0;
                        const tier = a.tier || 0;
                        const pitch = 0.72 + p * p * 1.0 + (tier >= 2 ? p * p * 0.55 : 0);
                        this.game.audio.spinTick(pitch);
                    }
                }
                // Fire the reveal chime AFTER the dead-air settle beat (the reel
                // stops, holds a breath, THEN the reveal bursts — the pause is what
                // sells it). Pitch/richness scales with the won rarity.
                const hold = a.settleHold ?? 0;
                const revealAt = spinTime + hold;
                const wasHeld = a.age - dt < revealAt;
                if (!a._revealPlayed && wasHeld && a.age >= revealAt) {
                    this.game.audio.reveal(a.result?.rarity);
                    a._revealPlayed = true;
                }
            }
        }
        if (this.mines) this._menuClock += dt;   // drives Mines reveal-pop / multiplier juice
        if (this.mines && this.mines.stopped) this.mines.age += dt;
    }

    openCaseFlow(caseType) {
        const res = openCase(this.game.saveSystem, caseType);
        if (!res.ok) {
            const message = res.reason === 'cost' ? 'Not enough coins'
                : res.reason === 'save-changed' ? 'Save changed — reload to continue'
                    : res.reason === 'save-unavailable'
                        ? 'Save unavailable — no coins charged' : 'Unavailable';
            this.game._setToast(message);
            if (res.reason === 'save-changed' || res.reason === 'save-unavailable') {
                this.game.accessibility?.announce?.(message);
            }
            return;
        }
        // The reward is already applied to the save; the overlay presents it
        // with a scrolling reel that decelerates onto the won item.
        this.game.audio.caseOpen();
        const { reel, landingIndex } = buildCaseReel(caseType, res);
        // Anticipation: a better pull takes LONGER to settle (tenser slow-down),
        // so the reveal feels earned. Tier drives spin time + the overlay's FX.
        // Timing follows the case-reel doctrine: a readable ease-out tail and a
        // dead-air settle pause before the reveal fires (see settleHold). The
        // awarded item lands exactly under the marker; no manufactured near miss.
        const tier = ({ common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 })[res.rarity] ?? 0;
        // The old 4.2–6s reel overstayed its welcome on repeat opens. This keeps
        // the suspenseful slow tail while making the open-again loop feel snappy.
        const reducedEffects = this._reducedEffects();
        const spinTime = reducedEffects ? 0 : 3.65 + tier * 0.28;
        this.caseAnim = {
            caseType, result: res, age: reducedEffects ? 1 : 0, reel, landingIndex,
            spinTime, tier, landOff: 0, settleHold: reducedEffects ? 0 : 0.52,
            reducedEffects, _revealPlayed: reducedEffects,
        };
        if (reducedEffects) this.game.audio.reveal(res.rarity);
    }

    dismissCase() { this.caseAnim = null; }

    // Case-overlay input: while the reel is still spinning, SNAP to the reveal
    // (fast-forward) instead of cancelling — impatient players still see their
    // prize. Once revealed, a tap on OPEN ANOTHER re-rolls the same case (the
    // renderer stamps the button rect on the anim and only draws it when the
    // case is affordable; openCaseFlow re-checks the cost anyway); any other
    // tap closes the overlay. `pos` is the tap in internal coords (absent for
    // keyboard continues, which always just close).
    caseInput(pos) {
        const a = this.caseAnim;
        if (!a) return;
        const spinTime = a.spinTime ?? 2.6;
        const revealAt = spinTime + (a.settleHold ?? 0);
        if (a.age < spinTime) {
            a.age = spinTime;   // jump the reel to its landing; update() fires
                                // the reveal chime after the settle beat.
        } else if (a.age < revealAt) {
            // A tap during the settle hold skips the held breath straight to
            // the reveal — it must NEVER dismiss (the prize would go unseen).
            // update()'s crossing check won't see this jump, so chime here.
            a.age = revealAt;
            this.game.audio.reveal(a.result?.rarity);
            a._revealPlayed = true;
        } else if (pos && a._againRect && a.caseType
            && pos.x >= a._againRect.x && pos.x <= a._againRect.x + a._againRect.w
            && pos.y >= a._againRect.y && pos.y <= a._againRect.y + a._againRect.h) {
            const type = a.caseType;
            this.dismissCase();
            this.openCaseFlow(type);
        } else {
            this.dismissCase();
        }
    }

    // ── Mines (coin gambling mini-game) ──────────────────────────────────
    // Stake coins on a 5×5 grid hiding mines. Reveal safe tiles to ratchet the
    // multiplier up; cash out to bank stake × multiplier, or hit a mine and
    // lose it. Gated by the hourly gamble quota (5 plays / rolling hour).
    openMines(bet) {
        if (this.caseAnim || this.mines) return;
        // UI dispatches authored integer presets. Do not coerce fractional or
        // string-shaped external input into a valid wager at this trust seam.
        const stake = Number.isSafeInteger(bet) ? bet : 0;
        if (!WAGER_BETS.includes(stake)) { this.game._setToast('Unavailable wager'); return; }
        if (this.game.saveSystem.data.totalCoins < stake) { this.game._setToast('Not enough coins'); return; }
        const info = this.game.saveSystem.gamblePlaysInfo();
        if (info.remaining <= 0) {
            this.game._setToast(`No plays left — resets in ${Math.ceil(info.resetInMs / 60000)}m`);
            return;
        }
        if (!this.game.saveSystem.spendCoins(stake)) {
            const failure = this.game.saveSystem.getLastSaveFailureReason?.();
            const message = failure === 'external-save-changed'
                ? 'Save changed — reload to continue'
                : failure ? 'Save unavailable — wager not charged' : 'Not enough coins';
            this.game._setToast(message);
            if (failure) this.game.accessibility?.announce?.(message);
            return;
        }
        // The read above and this consume are synchronous. Refund defensively if
        // malformed external state ever makes the quota change between them.
        if (!this.game.saveSystem.consumeGamblePlay()) {
            this.game.saveSystem.addCoins(stake);
            this.game._setToast('Wager window changed — stake refunded');
            return;
        }
        this.mines = {
            bet: stake, mineSet: rollMines(), revealed: [], safeRevealed: 0, mul: 1,
            stopped: false, busted: false, cashed: false, result: null, age: 0,
            // Overhaul juice (all keyed off this._menuClock):
            revealTimes: {}, // idx → clock stamp (per-tile reveal pop)
            bustIdx: null,   // which tile detonated (shock ring)
            stopFxT: 0,      // clock stamp at stop (shake + flash + shock)
            mulPrev: 1,      // multiplier before the last safe reveal (+Nx float)
            mulPopT: 0,      // clock stamp of the last safe reveal (multiplier pop)
        };
        this.game.audio.forge();
    }

    // Reveal one tile. Safe → ratchet the multiplier; mine → bust + lose stake.
    minesReveal(i) {
        const m = this.mines;
        if (!m || m.stopped || !Number.isInteger(i) || i < 0 || i >= MINES.tiles || m.revealed.includes(i)) return;
        m.revealed.push(i);
        if (m.mineSet.includes(i)) {
            m.busted = true; m.stopped = true;
            m.bustIdx = i; m.revealTimes[i] = this._menuClock; m.stopFxT = this._menuClock;
            m.result = { mul: 0, payout: 0, net: -m.bet };
            this.game.audio.hurt();
            return;
        }
        const prevMul = m.mul;
        m.safeRevealed += 1;
        m.mul = minesPayoutQuote(m.bet, m.safeRevealed).multiplier;
        m.mulPrev = prevMul; m.mulPopT = this._menuClock; m.revealTimes[i] = this._menuClock;
        this.game.audio.spinTick();
        // Cleared every safe tile → auto cash-out at the max multiplier.
        if (m.safeRevealed >= MINES.tiles - MINES.mines) this.minesCashOut();
    }

    // Cash out the live multiplier (needs at least one safe reveal).
    minesCashOut() {
        const m = this.mines;
        if (!m || m.stopped || m.safeRevealed <= 0) return;
        m.stopped = true; m.cashed = true; m.stopFxT = this._menuClock;
        const quote = minesPayoutQuote(m.bet, m.safeRevealed);
        const payout = quote.payout;
        m.mul = quote.multiplier;
        m.result = { mul: quote.multiplier, payout, net: quote.net };
        if (payout > 0) this.game.saveSystem.addCoins(payout);
        this.game.audio.reveal(m.mul >= 8 ? 'mythic' : m.mul >= 4 ? 'legendary' : m.mul >= 2 ? 'epic' : 'rare');
    }

    dismissMines() { this.mines = null; }

    // Grid tile rects (internal coords) — shared by render + hit-testing. A
    // fixed stacked layout: a header band (multiplier) above, the board here,
    // the cash button below (see minesCashRect). Render + input both call this,
    // so the geometry stays in lock-step.
    minesTileRects() {
        const cols = MINES.cols, rows = Math.ceil(MINES.tiles / cols);
        const cell = 104, gap = 10;
        const gw = cols * cell + (cols - 1) * gap;
        const ox = INTERNAL_WIDTH / 2 - gw / 2;
        const oy = 342;   // leaves two honest quote lines under the multiplier
        const rects = [];
        for (let i = 0; i < MINES.tiles; i++) {
            const c = i % cols, r = Math.floor(i / cols);
            rects.push({ x: ox + c * (cell + gap), y: oy + r * (cell + gap), w: cell, h: cell });
        }
        return rects;
    }

    minesCashRect() {
        return { x: INTERNAL_WIDTH / 2 - 220, y: 920, w: 440, h: 70 };
    }

    // ── Mines overhaul helpers (local "ember forge" primitives — deliberately
    // NOT the MenuRenderer copies, which mutate menu-only caches) ──────────
    _mEmber(ctx, x, y, r, color, alpha) {   // one additive cached-glow blit (caller owns composite + reset)
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.drawImage(getGlowSprite(color), x - r, y - r, r * 2, r * 2);
    }
    _mSmokedFill(ctx, x, y, w, h, r = 16) {
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, 'rgba(24,18,18,0.94)'); g.addColorStop(1, 'rgba(12,10,12,0.96)');
        roundRectPath(ctx, x, y, w, h, r); ctx.fillStyle = g; ctx.fill();
    }
    _mCornerTicks(ctx, x, y, w, h) {
        const s = 10, mm = 9;
        ctx.strokeStyle = 'rgba(255,140,60,0.35)'; ctx.lineWidth = 2;
        const cs = [[x + mm, y + mm, 1, 1], [x + w - mm, y + mm, -1, 1], [x + mm, y + h - mm, 1, -1], [x + w - mm, y + h - mm, -1, -1]];
        for (const [cx, cy, dx, dy] of cs) { ctx.beginPath(); ctx.moveTo(cx + dx * s, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * s); ctx.stroke(); }
    }
    _mPanel(ctx, x, y, w, h, opts = {}) {
        const r = 16;
        this._mSmokedFill(ctx, x, y, w, h, r);
        ctx.save(); roundRectPath(ctx, x, y, w, h, r); ctx.clip();
        const gg = ctx.createLinearGradient(0, y, 0, y + h * 0.4);
        gg.addColorStop(0, 'rgba(255,255,255,0.05)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gg; ctx.fillRect(x, y, w, h * 0.4); ctx.restore();
        roundRectPath(ctx, x + 1.5, y + 1.5, w - 3, h - 3, r - 1);
        ctx.strokeStyle = 'rgba(255,140,60,0.10)'; ctx.lineWidth = 1.5; ctx.stroke();
        roundRectPath(ctx, x, y, w, h, r);
        ctx.strokeStyle = opts.stroke || 'rgba(255,180,120,0.10)'; ctx.lineWidth = 2; ctx.stroke();
        if (opts.corners) this._mCornerTicks(ctx, x, y, w, h);
    }
    // Text with a cheap dark underlayer (legible without per-frame shadowBlur).
    _mText(ctx, text, x, y, color) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(text, x + 1.5, y + 1.5);
        ctx.fillStyle = color; ctx.fillText(text, x, y);
    }

    // High-contrast double outline + corner brackets: keyboard focus remains
    // unambiguous without depending on hue or a pulsing animation.
    _mKeyboardFocus(ctx, r) {
        const x = r.x - 5, y = r.y - 5, w = r.w + 10, h = r.h + 10;
        ctx.save();
        roundRectPath(ctx, x, y, w, h, 20);
        ctx.strokeStyle = 'rgba(0,0,0,0.96)'; ctx.lineWidth = 10; ctx.stroke();
        roundRectPath(ctx, x, y, w, h, 20);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke();
        const inset = 10, arm = 19;
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6;
        for (const [cx, cy, dx, dy] of [
            [x + inset, y + inset, 1, 1], [x + w - inset, y + inset, -1, 1],
            [x + inset, y + h - inset, 1, -1], [x + w - inset, y + h - inset, -1, -1],
        ]) {
            ctx.beginPath();
            ctx.moveTo(cx + dx * arm, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * arm);
            ctx.stroke();
        }
        ctx.restore();
    }

    // Mines overlay: an "ember vault" — a smoked-glass frame around a glowing
    // live-multiplier readout, a board of dark rune slabs that pop into gems
    // (safe) or cracked molten tiles (mine), and a CASH OUT button. Bust shakes
    // the vault + flashes the screen red. All juice keys off this._menuClock.
    drawMines(ctx, state = {}) {
        const W = INTERNAL_WIDTH, H = INTERNAL_HEIGHT, m = this.mines;
        if (!m) return;
        state = state || {};
        const cx = W / 2, t = this._menuClock;
        const reducedEffects = this._reducedEffects(state);
        const inputModality = state.inputModality
            ?? this.game?.input?.getModality?.()
            ?? 'pointer';
        const focusIndex = Number.isInteger(state.minesFocusIndex)
            ? state.minesFocusIndex
            : (Number.isInteger(this.game?.minesFocusIndex) ? this.game.minesFocusIndex : -1);
        const keyboardFocusVisible = inputModality === 'keyboard'
            && focusIndex >= 0 && focusIndex < MINES.tiles && !m.stopped;
        const FONT = '-apple-system, system-ui, Helvetica, Arial, sans-serif';
        const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

        // PASS 1 — forge scrim + a low hearth bloom (outside the shake).
        ctx.save();
        ctx.fillStyle = 'rgba(8,6,10,0.9)'; ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'lighter';
        this._mEmber(ctx, cx, H * 1.04, 640, '#ff7a1e', 0.10);
        this._mEmber(ctx, cx, H * 1.04, 300, '#ffd06a', 0.07);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        ctx.restore();

        // PASS 2 — bust shake wrap (panel + board jitter; scrim + flash do not).
        const dtStop = t - m.stopFxT;
        let sx = 0, sy = 0;
        if (!reducedEffects && m.busted && dtStop < 0.35) {
            const mag = 14 * Math.max(0, 1 - dtStop / 0.35);
            sx = (Math.random() * 2 - 1) * mag; sy = (Math.random() * 2 - 1) * mag;
        }
        ctx.save();
        ctx.translate(sx, sy);

        // PASS 3 — vault panel around the whole cluster.
        const rects = this.minesTileRects();
        const cb = this.minesCashRect();
        const px = cx - 490, pw = 980, py = 118, ph = (cb.y + cb.h + 46) - py;
        this._mPanel(ctx, px, py, pw, ph, { corners: true, stroke: 'rgba(255,180,120,0.12)' });

        // PASS 4 — kicker + big live multiplier (colour + glow escalate with mul).
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.font = `700 24px ${FONT}`;
        this._mText(ctx, 'EMBER VAULT  ·  COIN-ONLY  ·  ABOUT 7% HOUSE EDGE', cx, py + 40, 'rgba(255,180,120,0.8)');
        const mul = m.mul;
        const tier = mul < 2 ? { c: '#ff8a3a', g: '#ff7a1e', a: 0.28 }
            : mul < 4 ? { c: '#ffb257', g: '#ff8a3a', a: 0.34 }
                : mul < 8 ? { c: '#ffd06a', g: '#ffb257', a: 0.40 }
                    : { c: '#fff1c8', g: '#ffd06a', a: 0.5 };
        const pop = reducedEffects ? 1
            : 1 + 0.16 * (1 - easeOutCubic(clamp01((t - m.mulPopT) / 0.35)));
        const my = py + 118;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const pulse = reducedEffects ? 1 : 0.9 + 0.1 * Math.sin(t * 4);
        this._mEmber(ctx, cx, my, 92 * pop, tier.g, tier.a * pulse);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.restore();
        ctx.textBaseline = 'middle';
        ctx.font = `800 ${Math.round(74 * pop)}px ${MONO}`;
        this._mText(ctx, `${mul.toFixed(2)}×`, cx, my, tier.c);
        ctx.textBaseline = 'alphabetic';
        const quote = minesPayoutQuote(m.bet, m.safeRevealed);
        const potential = quote.payout;
        ctx.font = `700 21px ${FONT}`;
        const net = quote.net >= 0 ? `+${quote.net}` : `${quote.net}`;
        const balanceLine = m.busted
            ? `STAKE LOST ◎ ${m.bet}   ·   ${m.safeRevealed} SAFE BEFORE THE MINE`
            : m.cashed
                ? `FINAL CASHOUT ◎ ${m.result.payout}   ·   NET ${m.result.net >= 0 ? '+' : ''}${m.result.net}`
                : m.safeRevealed > 0
                    ? `CASHOUT ◎ ${potential}   ·   NET ${net}   ·   MAX LOSS ◎ ${m.bet}`
                    : `STAKE ◎ ${m.bet}   ·   MAX LOSS ◎ ${m.bet}   ·   CASHOUT UNLOCKS AFTER 1 SAFE`;
        this._mText(ctx, balanceLine, cx, my + 55, 'rgba(255,255,255,0.78)');
        if (!m.stopped && quote.odds.available) {
            const safePct = (quote.odds.safeChance * 100).toFixed(1);
            const minePct = (quote.odds.mineChance * 100).toFixed(1);
            ctx.font = `700 19px ${MONO}`;
            this._mText(ctx,
                `NEXT: ${safePct}% SAFE  ·  ${minePct}% MINE  ·  SAFE → ${quote.nextMultiplier.toFixed(2)}× / ◎ ${quote.nextPayout}`,
                cx, my + 84, '#ffd49a');
        }

        // PASS 5 — board tiles.
        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            const tcx = r.x + r.w / 2, tcy = r.y + r.h / 2;
            const isRevealed = m.revealed.includes(i);
            const isMine = m.mineSet.includes(i);
            const showMine = isMine && (isRevealed || m.stopped);
            if (showMine) {
                // Molten cracked slab + bloom.
                const gr = ctx.createRadialGradient(tcx, tcy, 6, tcx, tcy, r.w * 0.7);
                gr.addColorStop(0, i === m.bustIdx ? '#ff8a4a' : '#c25436'); gr.addColorStop(1, '#3a1210');
                roundRectPath(ctx, r.x, r.y, r.w, r.h, 16); ctx.fillStyle = gr; ctx.fill();
                ctx.strokeStyle = 'rgba(255,120,70,0.6)'; ctx.lineWidth = 2; ctx.stroke();
                ctx.strokeStyle = '#ffd06a'; ctx.lineWidth = 3; ctx.globalAlpha = 0.85;
                for (let k = 0; k < 3; k++) {
                    const a0 = k * 2.1 + 0.4;
                    ctx.beginPath(); ctx.moveTo(tcx, tcy);
                    ctx.lineTo(tcx + Math.cos(a0) * r.w * 0.4, tcy + Math.sin(a0) * r.w * 0.4); ctx.stroke();
                }
                ctx.globalAlpha = 1;
                ctx.save(); ctx.globalCompositeOperation = 'lighter';
                this._mEmber(ctx, tcx, tcy, 84, '#ff5a4a', 0.5); this._mEmber(ctx, tcx, tcy, 46, '#ffb257', 0.3);
                ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.restore();
                // Expanding shock ring from the tile that detonated.
                if (!reducedEffects && i === m.bustIdx) {
                    const sa = clamp01(dtStop / 0.5);
                    if (sa < 1) {
                        ctx.strokeStyle = `rgba(255,90,60,${1 - sa})`; ctx.lineWidth = Math.max(1, 8 * (1 - sa));
                        ctx.beginPath(); ctx.arc(tcx, tcy, 40 + 190 * easeOutCubic(sa), 0, Math.PI * 2); ctx.stroke();
                    }
                }
            } else if (isRevealed) {
                // Safe gem — pops in with an overshoot + green halo + brief +mult float.
                const age = t - (m.revealTimes[i] ?? t);
                const s = reducedEffects ? 1 : easeOutBack(clamp01(age / 0.32));
                ctx.save(); ctx.translate(tcx, tcy); ctx.scale(s, s);
                ctx.save(); ctx.globalCompositeOperation = 'lighter';
                this._mEmber(ctx, 0, 0, 70, '#74e890', 0.34); this._mEmber(ctx, 0, 0, 40, '#b6ffcf', 0.22);
                ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.restore();
                const gr = ctx.createRadialGradient(0, -6, 2, 0, 0, 44);
                gr.addColorStop(0, '#b6ffcf'); gr.addColorStop(1, '#2f9a52');
                const gsz = r.w * 0.34;
                ctx.beginPath(); ctx.moveTo(0, -gsz); ctx.lineTo(gsz, 0); ctx.lineTo(0, gsz); ctx.lineTo(-gsz, 0); ctx.closePath();
                ctx.fillStyle = gr; ctx.fill();
                ctx.strokeStyle = 'rgba(150,255,190,0.75)'; ctx.lineWidth = 3; ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, -gsz); ctx.lineTo(gsz * 0.5, -gsz * 0.15); ctx.lineTo(0, 0); ctx.closePath();
                ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill();
                ctx.restore();
                if (age < 0.7) {
                    const dy = reducedEffects ? -54 : -30 - 24 * easeOutCubic(clamp01(age / 0.7));
                    const fa = reducedEffects ? 1 : 1 - clamp01((age - 0.35) / 0.35);
                    ctx.globalAlpha = fa; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.font = `800 26px ${MONO}`;
                    this._mText(ctx, `+${(m.mul / (m.mulPrev || 1)).toFixed(2)}×`, tcx, tcy + dy, '#b6ffcf');
                    ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
                }
            } else {
                // Unrevealed dark rune slab.
                const gr = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
                gr.addColorStop(0, 'rgba(30,24,26,0.95)'); gr.addColorStop(1, 'rgba(16,13,16,0.97)');
                roundRectPath(ctx, r.x, r.y, r.w, r.h, 16); ctx.fillStyle = gr; ctx.fill();
                roundRectPath(ctx, r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3, 14.5);
                ctx.strokeStyle = 'rgba(255,140,60,0.08)'; ctx.lineWidth = 1.5; ctx.stroke();
                roundRectPath(ctx, r.x, r.y, r.w, r.h, 16);
                ctx.strokeStyle = 'rgba(255,180,120,0.10)'; ctx.lineWidth = 2; ctx.stroke();
                // Faint carved diamond rune.
                ctx.globalAlpha = m.stopped ? 0.05 : 0.10; ctx.strokeStyle = '#ffb257'; ctx.lineWidth = 3;
                const rr = r.w * 0.18;
                ctx.beginPath(); ctx.moveTo(tcx, tcy - rr); ctx.lineTo(tcx + rr, tcy); ctx.lineTo(tcx, tcy + rr); ctx.lineTo(tcx - rr, tcy); ctx.closePath(); ctx.stroke();
                ctx.globalAlpha = 1;
            }
            if (keyboardFocusVisible && focusIndex === i) this._mKeyboardFocus(ctx, r);
        }

        // PASS 6 — cash-out button / result.
        ctx.textAlign = 'center';
        if (!m.stopped) {
            const can = m.safeRevealed > 0;
            roundRectPath(ctx, cb.x, cb.y, cb.w, cb.h, 14);
            if (can) { ctx.fillStyle = '#33a356'; ctx.fill(); ctx.strokeStyle = '#ffce7a'; }
            else { this._mSmokedFill(ctx, cb.x, cb.y, cb.w, cb.h, 14); ctx.strokeStyle = 'rgba(255,255,255,0.18)'; }
            ctx.lineWidth = 3; roundRectPath(ctx, cb.x, cb.y, cb.w, cb.h, 14); ctx.stroke();
            ctx.textBaseline = 'middle'; ctx.font = `800 32px ${FONT}`;
            this._mText(ctx, can ? `CASH OUT ◎ ${potential}` : 'REVEAL A TILE', cx, cb.y + cb.h / 2, '#fff');
            ctx.textBaseline = 'alphabetic'; ctx.font = `600 22px ${FONT}`;
            const help = inputModality === 'keyboard'
                ? 'Arrows move · Enter reveals · Space cashes out'
                : 'Tap tiles to dig · cash out before a mine';
            this._mText(ctx, help, cx, cb.y + cb.h + 34, 'rgba(255,255,255,0.55)');
        } else {
            ctx.textBaseline = 'alphabetic';
            ctx.font = `800 46px ${FONT}`;
            this._mText(ctx, m.busted ? 'FORGE COOLED' : 'BANKED!', cx, cb.y + 28, m.busted ? '#ff5a4a' : '#74e890');
            ctx.font = `800 30px ${FONT}`;
            this._mText(ctx, m.busted ? `Lost ◎ ${m.bet}`
                : `Won ◎ ${m.result.payout}   (${m.result.net >= 0 ? '+' : ''}${m.result.net})`, cx, cb.y + 70, '#fff');
            ctx.font = `600 22px ${FONT}`;
            const help = inputModality === 'keyboard'
                ? 'Enter / Space continues · Esc closes'
                : 'Tap to continue';
            this._mText(ctx, help, cx, cb.y + 108, 'rgba(255,255,255,0.6)');
        }

        ctx.restore();   // end shake wrap

        // PASS 7 — bust flash (screen-space, over everything).
        if (!reducedEffects && m.busted && dtStop < 0.35) {
            ctx.fillStyle = `rgba(255,60,40,${0.35 * (1 - dtStop / 0.35)})`;
            ctx.fillRect(0, 0, W, H);
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
}
