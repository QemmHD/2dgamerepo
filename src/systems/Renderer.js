import { INTERNAL_WIDTH, INTERNAL_HEIGHT, BACKGROUND_COLOR, RENDER } from '../config/GameConfig.js';

export class Renderer {
    constructor(canvasEl) {
        this.canvas = canvasEl;
        this.ctx = canvasEl.getContext('2d', { alpha: false });
        this.internalWidth = INTERNAL_WIDTH;
        this.internalHeight = INTERNAL_HEIGHT;

        this.scale = 1;
        this.cssWidth = 0;
        this.cssHeight = 0;
        this.dpr = 1;

        this.safeArea = { top: 0, right: 0, bottom: 0, left: 0 };

        // Mobile landscape: when the device is portrait we CSS-rotate the
        // landscape game 90° so it FILLS the screen, and remap touch + safe
        // area through this flag. _lockedLandscape is set if a real OS
        // orientation lock succeeds (Android/PWA), in which case we never
        // CSS-rotate. _dprCap lets the FPS governor shed backing-store cost.
        this.rotated = false;
        this._lockedLandscape = false;
        this._dprCap = RENDER.maxDpr;
        this._hintEl = null;
        this._hintEverShown = false;
        this._hintHideAt = 0;

        // Coalesce the storm of resize/orientation/visualViewport events iOS
        // fires during URL-bar show/hide + rubber-banding into one rAF so we
        // don't reallocate the backing store many times per gesture.
        this._resizeQueued = false;
        this._onResize = () => {
            if (this._resizeQueued) return;
            this._resizeQueued = true;
            const run = () => { this._resizeQueued = false; this.resize(); };
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
            else run();
        };
        window.addEventListener('resize', this._onResize);
        window.addEventListener('orientationchange', this._onResize);
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', this._onResize);
        }

        this.resize();
    }

    resize() {
        const winW = window.visualViewport?.width ?? window.innerWidth;
        const winH = window.visualViewport?.height ?? window.innerHeight;
        if (!(winW > 0) || !(winH > 0)) return;

        // Rotate the landscape game when the device is held portrait (and it's
        // a touch device, and the OS didn't already lock to landscape).
        // Desktops never rotate — a narrow window just letterboxes as before.
        const coarse = typeof window.matchMedia === 'function'
            && window.matchMedia('(pointer: coarse)').matches;
        const wasRotated = this.rotated;
        this.rotated = winH > winW && coarse && !this._lockedLandscape;
        // If the rotation convention flips mid-drag, the joystick's cached
        // origin (one convention) and live current (the other) would diverge
        // into a bogus full-magnitude steer. Notify so the active touch resets.
        if (this.rotated !== wasRotated && typeof this.onOrientationChange === 'function') {
            this.onOrientationChange();
        }

        // When rotated, fit the 16:9 game against the SWAPPED viewport so the
        // game's width runs along the screen's long (physical-height) edge.
        const fitW = this.rotated ? winH : winW;
        const fitH = this.rotated ? winW : winH;

        // Fit the 16:9 game to the available space. CONTAIN (letterbox) shows
        // everything; COVER (fill, crop a little) fills the screen. We prefer
        // COVER when its crop stays under RENDER.maxCoverCrop — so a tall
        // phone (e.g. 19.5:9 iPhone) goes edge-to-edge instead of bar-boxed,
        // while ultrawide displays still letterbox. The cropped game edges are
        // folded into safeArea so the HUD never falls off-screen.
        const targetRatio = this.internalWidth / this.internalHeight;
        const wide = fitW / fitH > targetRatio;
        let containW, containH, coverW, coverH;
        if (wide) {
            containH = fitH; containW = containH * targetRatio;
            coverW = fitW;   coverH = coverW / targetRatio;
        } else {
            containW = fitW; containH = containW / targetRatio;
            coverH = fitH;   coverW = coverH * targetRatio;
        }
        const cropFrac = wide ? (coverH - fitH) / coverH : (coverW - fitW) / coverW;
        let cssW, cssH;
        if (cropFrac <= RENDER.maxCoverCrop) { cssW = coverW; cssH = coverH; }
        else { cssW = containW; cssH = containH; }
        this.cssWidth = cssW;
        this.cssHeight = cssH;

        // Budgeted device-pixel ratio. Lift the old hard cap of 2 so retina /
        // 4K render at TRUE device pixels (no upscale blur). The backing-store
        // budget guards mobile/iOS canvas-area + full-screen-fill cost, so it
        // only applies on coarse-pointer (touch) devices — on desktop we want
        // true device pixels (the whole point of the change), and desktops
        // have no canvas-area ceiling. Without this gate the budget would
        // LOWER dpr below the old 2 on any retina monitor wider than 1920px.
        const raw = window.devicePixelRatio || 1;
        let dpr = Math.min(raw, this._dprCap);
        // Backing-store budget. Mobile/iOS gets the tight 4K cap (a real
        // canvas-area + full-screen-fill-cost guard). Desktop gets a 4× larger
        // cap so retina/4K monitors render at TRUE device pixels (the anti-blur
        // goal — a 2560×1440 fit keeps dpr=2) while still bounding pathological
        // displays. Without the desktop allowance the 4K cap would wrongly
        // drop dpr below 2 on any retina monitor wider than 1920px.
        const cap = coarse ? RENDER.maxBackingPx : RENDER.maxBackingPx * 4;
        const budget = Math.sqrt(cap / Math.max(1, cssW * cssH));
        dpr = Math.max(1, Math.min(dpr, budget));
        this.dpr = dpr;

        this.canvas.style.width = cssW + 'px';
        this.canvas.style.height = cssH + 'px';
        this.canvas.width = Math.round(cssW * dpr);
        this.canvas.height = Math.round(cssH * dpr);

        this.scale = (cssW / this.internalWidth) * dpr;

        // The 90° rotation lives on the #stage container (a fixed inset:0 box
        // == winW×winH); rotating it about its center swaps its visual bbox to
        // winH×winW, exactly filling the portrait screen with the centered
        // landscape canvas inside.
        const stage = this.canvas.parentElement;
        if (stage) stage.classList.toggle('rotated', this.rotated);

        this._computeSafeArea(winW, winH);
        this._updateRotateHint();
    }

    _computeSafeArea(winW, winH) {
        const rootStyle = getComputedStyle(document.documentElement);
        const readPx = (name) => parseFloat(rootStyle.getPropertyValue(name)) || 0;

        const insetTop = readPx('--sai-top');
        const insetRight = readPx('--sai-right');
        const insetBottom = readPx('--sai-bottom');
        const insetLeft = readPx('--sai-left');

        const internalPerCss = this.internalWidth / Math.max(1, this.cssWidth);

        if (this.rotated) {
            // CSS rotate(90deg) is clockwise, so physical screen edges map to
            // the canvas's own frame as: top→left, bottom→right, right→top,
            // left→bottom (matches the clientToInternal unrotation below).
            // The canvas-width axis lies along the screen's height (winH); the
            // canvas-height axis along the screen's width (winW).
            // Gaps may be NEGATIVE under cover-fit (canvas larger than the
            // screen on that axis); the negative folds the cropped overflow
            // into the inset so the HUD stays on-screen.
            const gapW = (winH - this.cssWidth) / 2;
            const gapH = (winW - this.cssHeight) / 2;
            const padLeftCss = Math.max(0, insetTop - gapW);
            const padRightCss = Math.max(0, insetBottom - gapW);
            const padTopCss = Math.max(0, insetRight - gapH);
            const padBottomCss = Math.max(0, insetLeft - gapH);
            this.safeArea = {
                top: padTopCss * internalPerCss,
                right: padRightCss * internalPerCss,
                bottom: padBottomCss * internalPerCss,
                left: padLeftCss * internalPerCss,
            };
            return;
        }

        const canvasLeftCss = (winW - this.cssWidth) / 2;
        const canvasTopCss = (winH - this.cssHeight) / 2;
        const canvasRightCss = canvasLeftCss + this.cssWidth;
        const canvasBottomCss = canvasTopCss + this.cssHeight;

        const padLeftCss = Math.max(0, insetLeft - canvasLeftCss);
        const padTopCss = Math.max(0, insetTop - canvasTopCss);
        const padRightCss = Math.max(0, canvasRightCss - (winW - insetRight));
        const padBottomCss = Math.max(0, canvasBottomCss - (winH - insetBottom));

        this.safeArea = {
            top: padTopCss * internalPerCss,
            right: padRightCss * internalPerCss,
            bottom: padBottomCss * internalPerCss,
            left: padLeftCss * internalPerCss,
        };
    }

    beginFrame() {
        if (this.canvas.width === 0 || this.canvas.height === 0 || this.scale === 0) {
            return false;
        }
        const ctx = this.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = BACKGROUND_COLOR;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        return true;
    }

    // Map a client (event) point into the 1920×1080 internal space. Works
    // through the CSS rotation when portrait — this is the single chokepoint
    // every touch handler routes through, so input stays correct in landscape.
    clientToInternal(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let dx = clientX - cx;
        let dy = clientY - cy;
        if (this.rotated) {
            // Inverse of CSS rotate(+90° clockwise): screen→canvas frame.
            const ndx = dy;
            const ndy = -dx;
            dx = ndx;
            dy = ndy;
        }
        // dx,dy are now in the canvas's own landscape CSS space.
        const w = this.cssWidth || rect.width || 1;
        const h = this.cssHeight || rect.height || 1;
        return {
            x: (dx + w / 2) * (this.internalWidth / w),
            y: (dy + h / 2) * (this.internalHeight / h),
        };
    }

    // Best-effort native orientation lock (works in installed PWA / Android /
    // fullscreen; harmless no-op on iOS Safari). Call from a user gesture.
    tryLockLandscape() {
        try {
            const lock = window.screen?.orientation?.lock;
            if (typeof lock !== 'function') return;
            const p = lock.call(window.screen.orientation, 'landscape');
            if (p && typeof p.then === 'function') {
                p.then(() => { this._lockedLandscape = true; this.resize(); }).catch(() => {});
            }
        } catch (_) { /* not supported — CSS-rotate fallback handles it */ }
    }

    // FPS-governor lever: lower/raise the DPR cap to shed/restore backing
    // store cost on sustained low/high fps. No-op if the cap is unchanged.
    setDprCap(cap) {
        const c = Math.max(1, Math.min(RENDER.maxDpr, cap));
        if (c === this._dprCap) return;
        this._dprCap = c;
        this.resize();
    }

    _updateRotateHint() {
        if (this._hintEl === null && typeof document !== 'undefined') {
            this._hintEl = document.getElementById('rotate-hint') || false;
        }
        const el = this._hintEl;
        if (!el || !el.classList) return;
        if (this.rotated) {
            // Show the courtesy hint once, then auto-fade after 2.5s. Gameplay
            // is NOT paused — the game is already filling the screen rotated.
            if (!this._hintEverShown) {
                this._hintEverShown = true;
                el.classList.add('show');
                el.classList.remove('hidden');
                this._hintHideAt = (window.performance?.now?.() ?? 0) + 2500;
                const tick = () => {
                    if (!this.rotated) return;
                    if ((window.performance?.now?.() ?? Infinity) >= this._hintHideAt) {
                        el.classList.add('hidden');
                        return;
                    }
                    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
                };
                if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
            }
        } else {
            el.classList.remove('show');
            el.classList.add('hidden');
        }
    }
}
