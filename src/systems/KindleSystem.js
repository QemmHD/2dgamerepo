// KindleSystem — the manual ult economy + the aimed-blink dodge state
// (update #3 KINDLED). PR1 owns two things: the Kindle METER (fills from kills
// and boss damage, caps at READY) and the BLINK COOLDOWN (the universal dodge
// verb's recharge). Ult aiming/release + Focus Time land in PR3 — this module
// is written so those bolt on without disturbing the PR1 fields.
//
// Lifecycle: created fresh in Game._initRunState (same as weaponSystem), so a
// run/restart resets fill + cooldown with zero extra bookkeeping.
//
// Charge discipline (keystone pattern): the meter is fed at exactly two hooks —
// onKills (the single kill-merge in _resolveCombat) and onBossDamage (a single
// per-frame boss-HP delta). No per-frame enemy scan is added by this system.

import { KINDLE, BLINK } from '../config/GameConfig.js';

export class KindleSystem {
    constructor() {
        // Meter: a run starts a quarter-lit so the first ult lands ~minute 2.
        this.max = KINDLE.max;
        this.fill = Math.min(KINDLE.max, KINDLE.startFill);
        // Aimed-blink cooldown (independent of the meter — blink is free from
        // run 1). Drains in update() at wall-clock rate.
        this.blinkCooldown = 0;
        // Focus-Time aiming state (null | { t, angle, kind, ultName }); the ult
        // is spent up-front when aiming BEGINS so a cancel can refund cleanly,
        // and Game drives the hold/release lifecycle. ultActive reserved.
        this.aiming = null;
        this.ultActive = null;
    }

    // Spend the full bar to commit an ult (called when aiming BEGINS). ultCost
    // === max, so a ready bar zeroes; the ult's own kills recharge it via onKills.
    spendUlt() { this.fill = Math.max(0, this.fill - KINDLE.ultCost); }
    // Cancel refunds the committed bar (overlay/pause opened, or a deadzone tap).
    refundAim() { this._add(KINDLE.fizzleRefund); }

    // Per-frame tick. PR1 only drains the blink cooldown; it always uses real
    // dt so a dodge recharges at wall-clock rate even once Focus Time (PR3)
    // slows the world. Called from the live gameplay step only, so it never
    // ticks while a pick-one overlay freezes the world.
    update(dt) {
        if (this.blinkCooldown > 0) this.blinkCooldown = Math.max(0, this.blinkCooldown - dt);
    }

    // True once the bar is full — the ult is releasable (PR3). PR1 uses this
    // only to pulse the HUD meter.
    get ready() { return this.fill >= KINDLE.ultCost; }

    // ── Blink cooldown gate ────────────────────────────────────────────────
    blinkReady() { return this.blinkCooldown <= 0; }
    startBlinkCooldown() { this.blinkCooldown = BLINK.cooldown; }

    // ── Charge hooks (2 total) ─────────────────────────────────────────────
    // Hook 1: called once per _resolveCombat kill merge with the merged corpse
    // list. Reads e.elite / e.boss per corpse — no scan of the live field.
    onKills(killed) {
        if (!killed || killed.length === 0) return;
        let gain = 0;
        for (const e of killed) {
            gain += KINDLE.perKill;
            if (e.boss) gain += KINDLE.perBossKill;
            else if (e.elite) gain += KINDLE.perEliteKill;
        }
        this._add(gain);
    }

    // Hook 2: fraction (0..1) of a boss's MAX HP dealt this frame. Bosses aren't
    // kill-farms, so damage charges the bar slowly (perBossHitPct per 1%).
    onBossDamage(frac) {
        if (!(frac > 0)) return;
        this._add(frac * 100 * KINDLE.perBossHitPct);
    }

    _add(amount) {
        if (!(amount > 0)) return;
        this.fill = Math.min(KINDLE.max, this.fill + amount);
    }

    // DEV-only: grant meter to exercise the HUD / (PR3) ult path.
    debugGrant(amount) { this._add(amount); }
}
