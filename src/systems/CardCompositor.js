// CardCompositor — the ONE shared share-card module (EMBERGLASS / roadmap #2).
//
// A singleton over a lazily-created offscreen 1200×630 canvas (the OG-image
// aspect — pastes clean into Discord/Twitter embeds). It owns ALL card + share
// plumbing for the game; every card-producing update (death/victory here, and
// per docs/CARDS.md the future rite/siege/splits/ashrank/race/camp cards)
// registers a template via registerTemplate() and reuses this one canvas, share
// ladder, and clipboard/download code rather than rebuilding it.
//
// Everything here is pure-canvas + optional-chained browser APIs so the auto-mint
// that runs on every death (including the headless art harness) can never throw:
// toBlob/clipboard/share are deferred strictly to user taps.

import { registerCardTemplates } from '../content/cardTemplates.js';

export const CARD_W = 1200;
export const CARD_H = 630;

let _instance = null;

/** Lazy singleton accessor. */
export function getCardCompositor() {
    if (!_instance) _instance = new CardCompositor();
    return _instance;
}

class CardCompositor {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.templates = new Map();
        this._bg = null;        // cover-cropped world-frame capture (card-sized)
        this._bgCtx = null;
        this._bgValid = false;
        // Register the templates this update ships (death/victory/photo). Neighbors
        // append their own via registerTemplate() — zero compositor changes.
        try { registerCardTemplates(this); } catch (e) { /* templates optional */ }
    }

    _makeCanvas(w, h) {
        if (typeof document !== 'undefined' && document.createElement) {
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            return c;
        }
        if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
        return null;
    }

    _ensure() {
        if (this.canvas) return true;
        this.canvas = this._makeCanvas(CARD_W, CARD_H);
        if (!this.canvas) return false;
        this.ctx = this.canvas.getContext('2d');
        return !!this.ctx;
    }

    /** Register a template draw function: drawFn(ctx, data, helpers) — sync. */
    registerTemplate(id, drawFn) {
        if (typeof drawFn === 'function') this.templates.set(id, drawFn);
    }

    hasTemplate(id) { return this.templates.has(id); }

    /**
     * Stash a cover-cropped screenshot of the live game canvas for templates to
     * use as a background (helpers.bg). Copies immediately — the source canvas is
     * reused next frame, so the pixels must be grabbed now.
     */
    captureFromCanvas(srcCanvas, cropRect = null) {
        if (!srcCanvas || !srcCanvas.width || !srcCanvas.height) { this._bgValid = false; return; }
        if (!this._bg) {
            this._bg = this._makeCanvas(CARD_W, CARD_H);
            if (!this._bg) { this._bgValid = false; return; }
            this._bgCtx = this._bg.getContext('2d');
        }
        const bctx = this._bgCtx;
        if (!bctx) { this._bgValid = false; return; }
        // Cover-crop the source (device-pixel, 16:9) into the 1200×630 card frame.
        let sx, sy, sw, sh;
        if (cropRect) {
            ({ x: sx, y: sy, w: sw, h: sh } = cropRect);
        } else {
            const sW = srcCanvas.width, sH = srcCanvas.height;
            const target = CARD_W / CARD_H;      // 1.905…
            const srcAR = sW / sH;
            if (srcAR > target) { sh = sH; sw = sH * target; sx = (sW - sw) / 2; sy = 0; }
            else { sw = sW; sh = sW / target; sx = 0; sy = (sH - sh) / 2; }
        }
        try {
            bctx.clearRect(0, 0, CARD_W, CARD_H);
            bctx.imageSmoothingEnabled = true;
            bctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, CARD_W, CARD_H);
            this._bgValid = true;
        } catch (e) {
            this._bgValid = false;
        }
    }

    /**
     * Compose a registered template into the card canvas. Returns the canvas
     * (so a caller can draw it as a live thumbnail) or null if unavailable.
     * ≤3ms, one-shot at death/victory — never per-frame.
     */
    compose(templateId, data = {}) {
        if (!this._ensure()) return null;
        const fn = this.templates.get(templateId);
        if (!fn) return null;
        const helpers = { bg: this._bgValid ? this._bg : null };
        const ctx = this.ctx;
        try {
            ctx.save();
            ctx.clearRect(0, 0, CARD_W, CARD_H);
            fn(ctx, data, helpers);
        } catch (e) {
            // A broken template must not crash the game / harness.
        } finally {
            ctx.restore();
        }
        this._bgValid = false;   // consumed
        return this.canvas;
    }

    /** canvas.toBlob wrapped in a Promise (or OffscreenCanvas.convertToBlob). */
    toBlob(type = 'image/png') {
        if (!this._ensure()) return Promise.resolve(null);
        const c = this.canvas;
        if (c.convertToBlob) { try { return c.convertToBlob({ type }); } catch (e) { return Promise.resolve(null); } }
        return new Promise((resolve) => {
            try { c.toBlob((b) => resolve(b), type); } catch (e) { resolve(null); }
        });
    }

    /**
     * Share ladder. Each rung returns { ok, method } so the UI can toast exactly
     * what happened; the ladder always terminates in a download that cannot fail.
     * MUST be called synchronously inside a user-gesture handler — the
     * ClipboardItem is constructed with a Promise<Blob> value (no pre-await) so
     * Safari's gesture rule holds.
     */
    async share({ title = 'EMBERWAKE', text = '', filename = 'emberwake-card.png' } = {}) {
        // 1. Clipboard image copy (desktop; Safari needs the sync ClipboardItem).
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard && typeof ClipboardItem !== 'undefined') {
                const item = new ClipboardItem({ 'image/png': this.toBlob('image/png') });
                await navigator.clipboard.write([item]);
                return { ok: true, method: 'clipboard' };
            }
        } catch (e) { /* fall through */ }
        // 2. Native share sheet with a File (mobile).
        try {
            if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
                const blob = await this.toBlob('image/png');
                if (blob && typeof File !== 'undefined') {
                    const file = new File([blob], filename, { type: 'image/png' });
                    if (navigator.canShare({ files: [file] })) {
                        await navigator.share({ files: [file], title, text });
                        return { ok: true, method: 'share' };
                    }
                }
            }
        } catch (e) { /* fall through */ }
        // 3. Download — the always-works floor.
        try { this.download(filename); return { ok: true, method: 'download' }; }
        catch (e) { return { ok: false, method: 'none' }; }
    }

    /** <a download> + data URL — the floor that cannot throw a security error. */
    download(filename = 'emberwake-card.png') {
        if (!this._ensure()) return;
        const c = this.canvas;
        if (typeof document === 'undefined' || !c.toDataURL) return;
        const url = c.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }
}
