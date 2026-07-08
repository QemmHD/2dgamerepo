// EMBERGLASS — The Keeper's Lens (photo mode). Split out of Game.js as part of
// the "move code, don't change behavior" decomposition: these are the exact
// same methods, relocated onto Game.prototype via Object.assign in Game.js, so
// every `this._photoX()` call site (both directions) is unchanged and behavior
// is byte-identical. `this` is the Game instance throughout.
//
// Owns: entering/exiting the free-cam lens, pan/zoom, the filter cycle + its
// darkness lever, the rule-of-thirds grid, the toolbar-free SNAP → card → share
// ladder, and the pointer/tap dispatch while the Lens is open.

import { EMBERGLASS, GFX, WORLD_WIDTH, WORLD_HEIGHT, INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../config/GameConfig.js';
import { getCardCompositor } from '../systems/CardCompositor.js';
import { PHOTO_FILTERS } from '../content/photoFilters.js';

export const PhotoModeMethods = {
    _enterPhotoMode(returnTo) {
        if (this.photoMode) return;
        this.photoMode = {
            gridOn: false,
            hudShown: false,
            filterIdx: 0,
            toolbarFade: EMBERGLASS.photo.toolbarFade,
            returnTo: returnTo || (this.paused ? 'paused' : this.screen === 'gameOver' ? 'gameOver' : 'gameplay'),
        };
        // Detach the camera + zero shake so the free-cam holds perfectly still.
        this.camera.target = null;
        this.camera.trauma = 0;
        this.camera.shakeOffsetX = 0; this.camera.shakeOffsetY = 0; this.camera.shakeAngle = 0;
        this.camera.zoom = 1;
        this._dragPhotoPrev = null;
        // The Lens drives its own drag-pan; disable the joystick so it can't
        // double-count as a second pan (photoMode is in the blocked set).
        this._updateJoystickEnabled();
        if (this.audio && this.audio.click) this.audio.click();
    },
    _exitPhotoMode() {
        if (!this.photoMode) return;
        this.photoMode = null;
        this._suppressToolbar = false;
        this._dragPhotoPrev = null;
        this.camera.zoom = 1;
        this._applyPhotoDarkness();   // photoMode is null now → restores biome base darkness
        // Re-attach to the player (snaps position + zeroes trauma/offsets).
        if (this.player) this.camera.follow(this.player);
        this._updateJoystickEnabled();   // restore joystick for the underlying screen
        if (this.audio && this.audio.click) this.audio.click();
    },
    _photoZoomBy(factor) {
        if (!this.photoMode) return;
        const p = EMBERGLASS.photo;
        this.camera.zoom = Math.max(p.zoomMin, Math.min(p.zoomMax, this.camera.zoom * factor));
        this.photoMode.toolbarFade = p.toolbarFade;
    },
    _updatePhotoMode(dt) {
        const pm = this.photoMode; if (!pm) return;
        const p = EMBERGLASS.photo;
        // Keyboard / joystick pan (÷zoom keeps apparent speed constant).
        const mv = this.input.getMovement();
        if (mv && (mv.x || mv.y)) {
            const spd = (p.panSpeed / (this.camera.zoom || 1)) * dt;
            this.camera.x += mv.x * spd;
            this.camera.y += mv.y * spd;
            pm.toolbarFade = p.toolbarFade;
        }
        // Clamp to the world bounds (minus a margin) so the void wall never shows.
        const mx = WORLD_WIDTH / 2 - p.worldMargin, my = WORLD_HEIGHT / 2 - p.worldMargin;
        this.camera.x = Math.max(-mx, Math.min(mx, this.camera.x));
        this.camera.y = Math.max(-my, Math.min(my, this.camera.y));
        pm.toolbarFade = Math.max(0, pm.toolbarFade - dt);
        if (this.shareToast) { this.shareToast.timer -= dt; if (this.shareToast.timer <= 0) this.shareToast = null; }
        this.camera.update(dt);
    },
    _photoFilterName() {
        const f = this.photoMode && PHOTO_FILTERS[this.photoMode.filterIdx];
        return f ? f.name : "KEEPER'S EYE";
    },
    _cyclePhotoFilter() {
        if (!this.photoMode) return;
        this.photoMode.filterIdx = (this.photoMode.filterIdx + 1) % PHOTO_FILTERS.length;
        this._applyPhotoDarkness();
        this.photoMode.toolbarFade = EMBERGLASS.photo.toolbarFade;
    },
    // GLOAM re-levers the darkness veil (same lever biomes use); others restore
    // the biome's base darkness. Takes effect on the next frame's veil.
    _applyPhotoDarkness() {
        if (!this.lighting || !this.lighting.setQuality) return;
        const f = this.photoMode ? PHOTO_FILTERS[this.photoMode.filterIdx] : null;
        const mul = (this.photoMode && f && f.darkMul) ? f.darkMul : 1;
        this.lighting.setQuality({ strength: GFX.darkness.strength * (this.mapDarkness ?? 1) * mul });
    },
    // The active filter's screen-space pass (drawn after the veil composite).
    _drawPhotoFilter(ctx) {
        const f = this.photoMode && PHOTO_FILTERS[this.photoMode.filterIdx];
        if (f && f.draw) { try { f.draw(ctx, INTERNAL_WIDTH, INTERNAL_HEIGHT); } catch (e) { /* filter optional */ } }
    },
    // SNAP: render one toolbar-free frame synchronously (so the shot excludes the
    // toolbar), capture it, compose the 'photo' card, and run the share ladder —
    // all inside the tap gesture so clipboard/share holds.
    _snapPhoto() {
        if (!this.photoMode) return;
        this._suppressToolbar = true;
        try { this.render(); } catch (e) { /* toolbar-free frame */ }
        this._suppressToolbar = false;
        try {
            const comp = getCardCompositor();
            comp.captureFromCanvas(this.renderer.canvas);
            const canvas = comp.compose('photo', { filterName: this._photoFilterName() });
            if (canvas) this.mintedCard = { canvas, template: 'photo' };
            this.saveSystem.incrementStat('photosTaken', 1);
            comp.share({ title: 'EMBERWAKE', text: 'A shot from EMBERWAKE.', filename: 'emberwake-photo.png' })
                .then((res) => {
                    const m = (res && res.method) || 'none';
                    this.shareToast = { text: { clipboard: 'PHOTO COPIED', share: 'PHOTO SHARED',
                        download: 'PHOTO SAVED', none: 'SAVE FAILED' }[m] || 'PHOTO SAVED', timer: EMBERGLASS.toast.duration };
                })
                .catch(() => { this.shareToast = { text: 'PHOTO SAVED', timer: EMBERGLASS.toast.duration }; });
        } catch (e) { /* snap is best-effort */ }
        if (this.photoMode) this.photoMode.toolbarFade = EMBERGLASS.photo.toolbarFade;
    },
    // Pointer/tap dispatch while the Lens is open (drag pans; toolbar buttons act).
    _tryPhotoAt(clientX, clientY, phase) {
        if (!this.photoMode) return false;
        const pos = this.renderer.clientToInternal(clientX, clientY);
        // Local hit-test (the constructor's inRect closure is out of scope here).
        const hit = (r) => pos.x >= r.x && pos.x <= r.x + r.w && pos.y >= r.y && pos.y <= r.y + r.h;
        if (phase === 'down') {
            const rects = this.ui.getPhotoToolbarRects();
            for (const b of rects) {
                if (hit(b.rect)) {
                    this.photoMode.toolbarFade = EMBERGLASS.photo.toolbarFade;
                    if (b.id === 'snap') this._snapPhoto();
                    else if (b.id === 'filter') this._cyclePhotoFilter();
                    else if (b.id === 'grid') this.photoMode.gridOn = !this.photoMode.gridOn;
                    else if (b.id === 'hud') this.photoMode.hudShown = !this.photoMode.hudShown;
                    else if (b.id === 'zoomIn') this._photoZoomBy(EMBERGLASS.photo.zoomStep);
                    else if (b.id === 'zoomOut') this._photoZoomBy(1 / EMBERGLASS.photo.zoomStep);
                    else if (b.id === 'exit') this._exitPhotoMode();
                    return true;
                }
            }
            this._dragPhotoPrev = pos;   // start a pan drag
            this.photoMode.toolbarFade = EMBERGLASS.photo.toolbarFade;
            return true;
        }
        if (phase === 'move' && this._dragPhotoPrev) {
            const z = this.camera.zoom || 1;
            this.camera.x -= (pos.x - this._dragPhotoPrev.x) / z;
            this.camera.y -= (pos.y - this._dragPhotoPrev.y) / z;
            this._dragPhotoPrev = pos;
            this.photoMode.toolbarFade = EMBERGLASS.photo.toolbarFade;
            return true;
        }
        if (phase === 'up') { this._dragPhotoPrev = null; return true; }
        return true;   // consume all pointer events while the Lens is up
    },
    _drawPhotoGrid(ctx) {
        const W = INTERNAL_WIDTH, H = INTERNAL_HEIGHT;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(W / 3, 0); ctx.lineTo(W / 3, H);
        ctx.moveTo(2 * W / 3, 0); ctx.lineTo(2 * W / 3, H);
        ctx.moveTo(0, H / 3); ctx.lineTo(W, H / 3);
        ctx.moveTo(0, 2 * H / 3); ctx.lineTo(W, 2 * H / 3);
        ctx.stroke();
        ctx.restore();
    },
};
