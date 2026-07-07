// TouchButtons — the KINDLED (update #3) touch control surface: a BLINK button,
// a KINDLE button (its rim IS the meter; tap-fires or hold-drag-aims the ult),
// and right-half Focus taps. Composed into Input beside the keyboard + joystick.
//
// The joystick claims only the LEFT half (TouchJoystick :79); these buttons live
// bottom-RIGHT, so their touches never collide with a steer. Each button tracks
// its OWN touch identifier, independent of the joystick's, so move + aim + blink
// work simultaneously (multi-touch). The class owns its own canvas listeners
// (mirroring TouchJoystick) and exposes consumable state that Game polls each
// frame — it never reaches into Game.
//
// Aim model (deliberately identical to the keyboard hold-Q path so Game needs no
// special-casing): `kindleHeld` is true while the KINDLE touch is down, and
// `kindleAngle` is the drag aim (null = use auto-aim). Game._updateKindleAim
// begins aiming on a ready hold and fires on release — so a QUICK tap
// (begin+release within a frame or two, no drag) fires along auto-aim, and a
// HOLD-DRAG fires along the drag; a slow release near centre cancels (refund).

import { INTERNAL_WIDTH, INTERNAL_HEIGHT, KINDLE } from '../config/GameConfig.js';

const QUICK_TAP_MS = 150;   // <this held → quick-fire (never a cancel)
const DEADZONE = 30;        // slow release within this of the button centre → cancel

function nowMs() {
    try { return performance.now(); } catch { return 0; }
}

export class TouchButtons {
    constructor(renderer) {
        this.renderer = renderer;
        this.enabled = true;
        this.supported = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        // BLINK: a consumable tap flag.
        this.blinkTap = false;
        // KINDLE aim state.
        this.kindleHeld = false;
        this.kindleAngle = null;          // drag aim (null → auto-aim)
        this._kindleCancel = false;       // consumable: last release was a cancel
        // FOCUS: a consumable {x,y} (internal coords) of the last right-half tap.
        this.focusTap = null;

        // Per-button live touch tracking (independent ids for multi-touch).
        this._blinkId = null;
        this._kindleId = null;
        this._kindleStart = 0;
        this._focusId = null;
        this._focusStart = 0;
        this._focusPos = null;

        const target = renderer.canvas;
        const opts = { passive: false };
        this._onStart = (e) => this._handleStart(e);
        this._onMove = (e) => this._handleMove(e);
        this._onEnd = (e) => this._handleEnd(e);
        this._onCancel = () => this._reset();
        target.addEventListener('touchstart', this._onStart, opts);
        target.addEventListener('touchmove', this._onMove, opts);
        target.addEventListener('touchend', this._onEnd, opts);
        target.addEventListener('touchcancel', this._onCancel, opts);
        window.addEventListener('blur', () => this._reset());
        document.addEventListener('visibilitychange', () => { if (document.hidden) this._reset(); });
    }

    setEnabled(enabled) {
        this.enabled = !!enabled;
        if (!this.enabled) this._reset();
    }

    // Public: drop all live touches + pending taps (orientation flip / overlay
    // open / blur). Disabling is authoritative — no latched tap survives into a
    // frozen state, so a stale blink/ult/focus can't fire when play resumes.
    reset() { this._reset(); }

    _reset() {
        this.kindleHeld = false; this.kindleAngle = null; this._kindleCancel = false;
        this.blinkTap = false; this.focusTap = null;
        this._blinkId = null; this._kindleId = null; this._focusId = null; this._focusPos = null;
    }

    // Button layout, derived from the safe area each call. blink bottom-right,
    // kindle up-and-left of it (rim = meter). { blink:{x,y,r}, kindle:{x,y,r} }.
    layout() {
        const sa = this.renderer.safeArea;
        const bx = INTERNAL_WIDTH - sa.right - 118;
        const by = INTERNAL_HEIGHT - sa.bottom - 118;
        return {
            blink: { x: bx, y: by, r: 68 },
            kindle: { x: bx - 196, y: by - 74, r: 92 },
        };
    }

    _hit(pos, c) { const dx = pos.x - c.x, dy = pos.y - c.y; return dx * dx + dy * dy <= c.r * c.r; }

    _handleStart(e) {
        if (!this.enabled || !this.supported) return;
        const L = this.layout();
        for (const t of e.changedTouches) {
            const pos = this.renderer.clientToInternal(t.clientX, t.clientY);
            if (this._blinkId === null && this._hit(pos, L.blink)) {
                e.preventDefault(); this._blinkId = t.identifier; this.blinkTap = true; continue;
            }
            if (this._kindleId === null && this._hit(pos, L.kindle)) {
                e.preventDefault(); this._kindleId = t.identifier; this._kindleStart = nowMs();
                this.kindleHeld = true; this.kindleAngle = null; continue;
            }
            // Right half, not on a button → a potential Focus tap.
            if (this._focusId === null && pos.x > INTERNAL_WIDTH / 2) {
                this._focusId = t.identifier; this._focusStart = nowMs(); this._focusPos = pos;
            }
        }
    }

    _handleMove(e) {
        for (const t of e.changedTouches) {
            if (t.identifier === this._kindleId) {
                e.preventDefault();
                const pos = this.renderer.clientToInternal(t.clientX, t.clientY);
                const L = this.layout();
                const dx = pos.x - L.kindle.x, dy = pos.y - L.kindle.y;
                this.kindleAngle = (Math.hypot(dx, dy) >= DEADZONE) ? Math.atan2(dy, dx) : null;
            } else if (t.identifier === this._focusId) {
                this._focusPos = this.renderer.clientToInternal(t.clientX, t.clientY);
            }
        }
    }

    _handleEnd(e) {
        for (const t of e.changedTouches) {
            if (t.identifier === this._blinkId) { this._blinkId = null; }
            else if (t.identifier === this._kindleId) {
                e.preventDefault();
                const held = nowMs() - this._kindleStart;
                // A slow release with no drag past the deadzone cancels (refund);
                // a quick tap always fires (auto-aim); a drag fires along it.
                if (held >= QUICK_TAP_MS && this.kindleAngle === null) this._kindleCancel = true;
                this.kindleHeld = false; this._kindleId = null;
            } else if (t.identifier === this._focusId) {
                const held = nowMs() - this._focusStart;
                const pos = this._focusPos;
                if (held < 260 && pos) this.focusTap = { x: pos.x, y: pos.y };
                this._focusId = null; this._focusPos = null;
            }
        }
    }

    // ── Consumable getters (Game reads once per frame) ─────────────────────
    consumeBlinkTap() { const v = this.blinkTap; this.blinkTap = false; return v; }
    consumeKindleCancel() { const v = this._kindleCancel; this._kindleCancel = false; return v; }
    consumeFocusTap() { const v = this.focusTap; this.focusTap = null; return v; }

    // The meter fill fraction the KINDLE-button rim draws (0..1); Game passes the
    // live value into the UI snapshot, so the module needs no game ref.
    static rimFrac(fill) { return Math.max(0, Math.min(1, (fill || 0) / KINDLE.max)); }

    // ── Self-draw (mirrors TouchJoystick.draw — called from Game.render) ─────
    // Hidden on non-touch (desktop/headless) so the desktop view is untouched.
    // `info` carries the live meter/cooldown the buttons don't own:
    //   { fill:0..1 (kindle rim), ready, ultColor, aiming, blinkFrac:0..1 remaining }.
    draw(ctx, info) {
        if (!this.supported || !this.enabled) return;
        const L = this.layout();
        const i = info || {};
        // BLINK — a cyan disc whose rim SWEEPS UP as the cooldown recharges
        // (blinkFrac is the fraction REMAINING, so 1 − it is the recharge).
        const bFrac = i.blinkFrac ?? 0;
        this._drawButton(ctx, L.blink, '#8fd0ff', 1 - bFrac, 'BLINK', bFrac <= 0.001, false);
        // KINDLE — the ult disc; rim = meter, pulses when ready. While aiming the
        // charge is already spent (rim empty), so show a full pulsing "AIM" ring.
        const aiming = !!i.aiming;
        const col = i.ultColor || '#ff8c4a';
        this._drawButton(ctx, L.kindle, col, aiming ? 1 : (i.fill ?? 0),
            aiming ? 'AIM' : 'ULT', aiming || !!i.ready, aiming);
    }

    _drawButton(ctx, c, color, frac, label, ready, active) {
        ctx.save();
        // Base disc.
        ctx.globalAlpha = active ? 0.36 : 0.22;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill();
        // Dim ring track.
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.stroke();
        // Progress rim (meter fill / cooldown recharge) from the top, clockwise.
        const f = Math.max(0, Math.min(1, frac));
        if (f > 0) {
            ctx.globalAlpha = ready ? 0.95 : 0.8;
            ctx.strokeStyle = color; ctx.lineWidth = 7;
            ctx.beginPath();
            ctx.arc(c.x, c.y, c.r, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
            ctx.stroke();
        }
        // Ready pulse ring.
        if (ready) {
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = 3; ctx.strokeStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 5, 0, Math.PI * 2); ctx.stroke();
        }
        // Label.
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 20px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, c.x, c.y);
        ctx.restore();
    }
}
