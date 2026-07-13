// MinigameOverlay — the start-screen minigame flows carved out of Game (P1.5):
// the case-opening reel (sim only — MenuRenderer draws it from the UI snapshot)
// and the Mines coin-gamble board (sim + Game-drawn overlay). Owns the overlay
// state (`caseAnim`, `mines`) plus the free-running menu clock the Mines juice
// keys off (Game.time is frozen on the menu). Holds a back-ref to the Game for
// save/audio/toast access; created once in the Game constructor.

import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../config/GameConfig.js';
import { openCase, buildCaseReel, MINES, MINES_HOUSE, rollMines, minesRawMultiplier } from './CaseSystem.js';
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

    // Start-screen tick: advance the case reel + the Mines juice clock.
    update(dt) {
        if (this.caseAnim) {
            const spinTime = this.caseAnim.spinTime ?? 2.6;
            const wasSpinning = this.caseAnim.age < spinTime;
            this.caseAnim.age += dt;
            if (wasSpinning) {
                // Ratchet tick that SLOWS as the reel decelerates (50ms → ~290ms)
                // and RISES in pitch toward the landing — climbing higher when a
                // Rare+ is incoming, so your ears feel the pull coming.
                const p = Math.min(1, this.caseAnim.age / spinTime);
                const interval = 0.05 + p * p * 0.24;
                this.caseAnim._tick = (this.caseAnim._tick ?? 0) + dt;
                if (this.caseAnim.age < spinTime && this.caseAnim._tick >= interval) {
                    this.caseAnim._tick = 0;
                    const tier = this.caseAnim.tier || 0;
                    const pitch = 0.72 + p * p * 1.0 + (tier >= 2 ? p * p * 0.55 : 0);
                    this.game.audio.spinTick(pitch);
                }
            }
            // Fire the reveal chime AFTER the dead-air settle beat (the reel
            // stops, holds a breath, THEN the reveal bursts — the pause is what
            // sells it). Pitch/richness scales with the won rarity.
            const hold = this.caseAnim.settleHold ?? 0;
            const revealAt = spinTime + hold;
            const wasHeld = this.caseAnim.age - dt < revealAt;
            if (wasHeld && this.caseAnim.age >= revealAt) this.game.audio.reveal(this.caseAnim.result?.rarity);
        }
        if (this.mines) this._menuClock += dt;   // drives Mines reveal-pop / multiplier juice
        if (this.mines && this.mines.stopped) this.mines.age += dt;
    }

    openCaseFlow(caseType) {
        const res = openCase(this.game.saveSystem, caseType);
        if (!res.ok) { this.game._setToast(res.reason === 'cost' ? 'Not enough coins' : 'Unavailable'); return; }
        // The reward is already applied to the save; the overlay presents it
        // with a scrolling reel that decelerates onto the won item.
        this.game.audio.caseOpen();
        const { reel, landingIndex } = buildCaseReel(caseType, res);
        // Anticipation: a better pull takes LONGER to settle (tenser slow-down),
        // so the reveal feels earned. Tier drives spin time + the overlay's FX.
        // Timing follows the case-reel doctrine: a readable ease-out tail, a
        // NEAR-MISS landing offset (the marker rarely stops dead-centre — the
        // winner sits just off, as if it "almost" was the neighbour), and a
        // dead-air settle pause before the reveal fires (see settleHold).
        const tier = ({ common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 })[res.rarity] ?? 0;
        // The old 4.2–6s reel overstayed its welcome on repeat opens. This keeps
        // the suspenseful slow tail while making the open-again loop feel snappy.
        const spinTime = 3.65 + tier * 0.28;
        const landOff = (Math.random() * 0.7 - 0.35);   // ±0.35 cell widths
        this.caseAnim = { caseType, result: res, age: 0, reel, landingIndex, spinTime, tier, landOff, settleHold: 0.52 };
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
        if (this.game.saveSystem.data.totalCoins < bet) { this.game._setToast('Not enough coins'); return; }
        if (!this.game.saveSystem.consumeGamblePlay()) {
            const info = this.game.saveSystem.gamblePlaysInfo();
            this.game._setToast(`No plays left — resets in ${Math.ceil(info.resetInMs / 60000)}m`);
            return;
        }
        this.game.saveSystem.spendCoins(bet);
        this.mines = {
            bet, mineSet: rollMines(), revealed: [], safeRevealed: 0, mul: 1,
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
        if (!m || m.stopped || i == null || i < 0 || i >= MINES.tiles || m.revealed.includes(i)) return;
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
        m.mul = minesRawMultiplier(m.safeRevealed) * MINES_HOUSE;
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
        const payout = Math.floor(m.bet * m.mul);
        m.result = { mul: m.mul, payout, net: payout - m.bet };
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
        const cell = 112, gap = 12;
        const gw = cols * cell + (cols - 1) * gap;
        const ox = INTERNAL_WIDTH / 2 - gw / 2;
        const oy = 314;   // leaves a header band (118..300) for the multiplier
        const rects = [];
        for (let i = 0; i < MINES.tiles; i++) {
            const c = i % cols, r = Math.floor(i / cols);
            rects.push({ x: ox + c * (cell + gap), y: oy + r * (cell + gap), w: cell, h: cell });
        }
        return rects;
    }

    minesCashRect() {
        return { x: INTERNAL_WIDTH / 2 - 220, y: 942, w: 440, h: 76 };
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

    // Mines overlay: an "ember vault" — a smoked-glass frame around a glowing
    // live-multiplier readout, a board of dark rune slabs that pop into gems
    // (safe) or cracked molten tiles (mine), and a CASH OUT button. Bust shakes
    // the vault + flashes the screen red. All juice keys off this._menuClock.
    drawMines(ctx) {
        const W = INTERNAL_WIDTH, H = INTERNAL_HEIGHT, m = this.mines;
        const cx = W / 2, t = this._menuClock;
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
        if (m.busted && dtStop < 0.35) {
            const mag = 14 * Math.max(0, 1 - dtStop / 0.35);
            sx = (Math.random() * 2 - 1) * mag; sy = (Math.random() * 2 - 1) * mag;
        }
        ctx.save();
        ctx.translate(sx, sy);

        // PASS 3 — vault panel around the whole cluster.
        const rects = this.minesTileRects();
        const cb = this.minesCashRect();
        const gx = rects[0].x, gw = (rects[24].x + rects[24].w) - rects[0].x;
        const px = gx - 48, pw = gw + 96, py = 118, ph = (cb.y + cb.h + 46) - py;
        this._mPanel(ctx, px, py, pw, ph, { corners: true, stroke: 'rgba(255,180,120,0.12)' });

        // PASS 4 — kicker + big live multiplier (colour + glow escalate with mul).
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.font = `700 24px ${FONT}`;
        this._mText(ctx, 'EMBER VAULT', cx, py + 40, 'rgba(255,180,120,0.8)');
        const mul = m.mul;
        const tier = mul < 2 ? { c: '#ff8a3a', g: '#ff7a1e', a: 0.28 }
            : mul < 4 ? { c: '#ffb257', g: '#ff8a3a', a: 0.34 }
                : mul < 8 ? { c: '#ffd06a', g: '#ffb257', a: 0.40 }
                    : { c: '#fff1c8', g: '#ffd06a', a: 0.5 };
        const pop = 1 + 0.16 * (1 - easeOutCubic(clamp01((t - m.mulPopT) / 0.35)));
        const my = py + 118;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        this._mEmber(ctx, cx, my, 92 * pop, tier.g, tier.a * (0.9 + 0.1 * Math.sin(t * 4)));
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.restore();
        ctx.textBaseline = 'middle';
        ctx.font = `800 ${Math.round(74 * pop)}px ${MONO}`;
        this._mText(ctx, `${mul.toFixed(2)}×`, cx, my, tier.c);
        ctx.textBaseline = 'alphabetic';
        ctx.font = `600 24px ${FONT}`;
        const potential = Math.floor(m.bet * m.mul);
        this._mText(ctx, m.safeRevealed > 0 ? `BET ◎ ${m.bet}    ·    CASH ◎ ${potential}` : `BET ◎ ${m.bet}    ·    reveal a tile to begin`,
            cx, my + 62, 'rgba(255,255,255,0.75)');

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
                if (i === m.bustIdx) {
                    const sa = clamp01(dtStop / 0.5);
                    if (sa < 1) {
                        ctx.strokeStyle = `rgba(255,90,60,${1 - sa})`; ctx.lineWidth = Math.max(1, 8 * (1 - sa));
                        ctx.beginPath(); ctx.arc(tcx, tcy, 40 + 190 * easeOutCubic(sa), 0, Math.PI * 2); ctx.stroke();
                    }
                }
            } else if (isRevealed) {
                // Safe gem — pops in with an overshoot + green halo + brief +mult float.
                const age = t - (m.revealTimes[i] ?? t);
                const s = easeOutBack(clamp01(age / 0.32));
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
                    const dy = -30 - 24 * easeOutCubic(clamp01(age / 0.7));
                    const fa = 1 - clamp01((age - 0.35) / 0.35);
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
            this._mText(ctx, 'Tap tiles to dig · cash out before a mine', cx, cb.y + cb.h + 34, 'rgba(255,255,255,0.55)');
        } else {
            ctx.textBaseline = 'alphabetic';
            ctx.font = `800 46px ${FONT}`;
            this._mText(ctx, m.busted ? 'FORGE COOLED' : 'BANKED!', cx, cb.y + 28, m.busted ? '#ff5a4a' : '#74e890');
            ctx.font = `800 30px ${FONT}`;
            this._mText(ctx, m.busted ? `Lost ◎ ${m.bet}`
                : `Won ◎ ${m.result.payout}   (${m.result.net >= 0 ? '+' : ''}${m.result.net})`, cx, cb.y + 70, '#fff');
            ctx.font = `600 22px ${FONT}`;
            this._mText(ctx, 'Tap / Space to continue', cx, cb.y + 108, 'rgba(255,255,255,0.6)');
        }

        ctx.restore();   // end shake wrap

        // PASS 7 — bust flash (screen-space, over everything).
        if (m.busted && dtStop < 0.35) {
            ctx.fillStyle = `rgba(255,60,40,${0.35 * (1 - dtStop / 0.35)})`;
            ctx.fillRect(0, 0, W, H);
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
}
