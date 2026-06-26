import { INTERNAL_WIDTH, INTERNAL_HEIGHT, BACKGROUND_COLOR } from '../config.js';

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

        this._onResize = () => this.resize();
        window.addEventListener('resize', this._onResize);
        window.addEventListener('orientationchange', this._onResize);
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', this._onResize);
        }

        this.resize();
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        this.dpr = dpr;

        const winW = window.visualViewport?.width ?? window.innerWidth;
        const winH = window.visualViewport?.height ?? window.innerHeight;

        if (!(winW > 0) || !(winH > 0)) return;

        const targetRatio = this.internalWidth / this.internalHeight;
        let cssW, cssH;
        if (winW / winH > targetRatio) {
            cssH = winH;
            cssW = cssH * targetRatio;
        } else {
            cssW = winW;
            cssH = cssW / targetRatio;
        }

        this.cssWidth = cssW;
        this.cssHeight = cssH;

        this.canvas.style.width = cssW + 'px';
        this.canvas.style.height = cssH + 'px';
        this.canvas.width = Math.round(cssW * dpr);
        this.canvas.height = Math.round(cssH * dpr);

        this.scale = (cssW / this.internalWidth) * dpr;

        this._computeSafeArea(winW, winH);
    }

    _computeSafeArea(winW, winH) {
        const rootStyle = getComputedStyle(document.documentElement);
        const readPx = (name) => parseFloat(rootStyle.getPropertyValue(name)) || 0;

        const insetTop = readPx('--sai-top');
        const insetRight = readPx('--sai-right');
        const insetBottom = readPx('--sai-bottom');
        const insetLeft = readPx('--sai-left');

        const canvasLeftCss = (winW - this.cssWidth) / 2;
        const canvasTopCss = (winH - this.cssHeight) / 2;
        const canvasRightCss = canvasLeftCss + this.cssWidth;
        const canvasBottomCss = canvasTopCss + this.cssHeight;

        const padLeftCss = Math.max(0, insetLeft - canvasLeftCss);
        const padTopCss = Math.max(0, insetTop - canvasTopCss);
        const padRightCss = Math.max(0, canvasRightCss - (winW - insetRight));
        const padBottomCss = Math.max(0, canvasBottomCss - (winH - insetBottom));

        const internalPerCss = this.internalWidth / Math.max(1, this.cssWidth);

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

    clientToInternal(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const w = rect.width || 1;
        const h = rect.height || 1;
        return {
            x: (clientX - rect.left) * (this.internalWidth / w),
            y: (clientY - rect.top) * (this.internalHeight / h),
        };
    }
}
