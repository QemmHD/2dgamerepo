// Shared combat-warning and status-symbol vocabulary.
//
// High-contrast warnings keep the authored hue as an inner accent, but add a
// black under-stroke and a white keyline so geometry survives darkness, bright
// snow, and grayscale display. Status badges bake credited game-icons.net art
// plus a small semantic frame into a lazy sprite cache; the hot draw path is a
// single bitmap blit and allocates no Paths, arrays, gradients, or objects.

import { getIconGlyph } from '../assets/CustomIcons.js';

export const COMBAT_CUE_DARK = '#05070c';
export const COMBAT_CUE_LIGHT = '#ffffff';

export const TRASH_STATUS_CUE_LIMIT = 3;
export const FULL_STATUS_CUE_LIMIT = 7;
export const STATUS_CUE_BASE_INTERNAL_PX = 15;
export const STATUS_CUE_MIN_CSS_PX = 11;

const TWO_PI = Math.PI * 2;
const BADGE_ART_SIZE = 48;
const BADGE_CANVAS_SIZE = 72;
const BADGE_DRAW_SCALE = BADGE_CANVAS_SIZE / BADGE_ART_SIZE;
const NORMAL_BADGE_CACHE = [];
const CONTRAST_BADGE_CACHE = [];

// Re-stroke the current path with three nested contours. This is an overlay
// treatment only: authored fills/strokes stay in their original world pass.
export function strokeHighContrastPath(ctx, accent, width = 2) {
    const inner = Math.max(1, width);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COMBAT_CUE_DARK;
    ctx.lineWidth = inner + 6;
    ctx.stroke();
    ctx.strokeStyle = COMBAT_CUE_LIGHT;
    ctx.lineWidth = inner + 3;
    ctx.stroke();
    ctx.strokeStyle = accent || COMBAT_CUE_LIGHT;
    ctx.lineWidth = inner;
    ctx.stroke();
    ctx.restore();
}

// Keep a world-space badge at or above the requested CSS footprint. uiScale
// is the persisted 100/115/130 percentage; malformed legacy values fall back
// to 100. Gameplay uses zoom=1, while photo zoom remains mathematically sound.
export function combatStatusCueSize(
    uiScale,
    cssWidth,
    internalWidth,
    worldZoom = 1,
) {
    const uiFactor = uiScale === 115 ? 1.15 : uiScale === 130 ? 1.3 : 1;
    const logicalWidth = Number.isFinite(internalWidth) && internalWidth > 0
        ? internalWidth : 1920;
    const footprint = Number.isFinite(cssWidth) && cssWidth > 0
        ? cssWidth : logicalWidth;
    const zoom = Number.isFinite(worldZoom) && worldZoom > 0 ? worldZoom : 1;
    const cssPerWorldPixel = (footprint / logicalWidth) * zoom;
    return Math.max(
        STATUS_CUE_BASE_INTERNAL_PX,
        STATUS_CUE_MIN_CSS_PX / cssPerWorldPixel,
    ) * uiFactor;
}

function statusKindIndex(kind) {
    if (kind === 'shield') return 0;
    if (kind === 'freeze') return 1;
    if (kind === 'burn') return 2;
    if (kind === 'shock') return 3;
    if (kind === 'shred') return 4;
    if (kind === 'chill') return 5;
    if (kind === 'slow') return 6;
    return -1;
}

// Asset mapping is public so the regression validator can guarantee that
// status meaning stays tied to the credited source art.
export function statusIconForKind(kind) {
    if (kind === 'shield' || kind === 'shred') return 'shield';
    if (kind === 'burn') return 'fire';
    if (kind === 'shock') return 'lightning';
    if (kind === 'slow' || kind === 'chill' || kind === 'freeze') return 'frost';
    return 'spark';
}

function statusTint(kind) {
    if (kind === 'shield') return '#7fd0ff';
    if (kind === 'freeze') return '#bfe8ff';
    if (kind === 'burn') return '#ff7a33';
    if (kind === 'shock') return '#ffe066';
    if (kind === 'shred') return '#f7d36e';
    if (kind === 'chill') return '#7fe0ff';
    return '#78c8ff';
}

function strokeGlyphPath(ctx, tint, width, highContrast) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COMBAT_CUE_DARK;
    ctx.lineWidth = width + 2.2;
    ctx.stroke();
    ctx.strokeStyle = highContrast ? COMBAT_CUE_LIGHT : tint;
    ctx.lineWidth = width;
    ctx.stroke();
}

function drawStackTicks(ctx, stacks, size, tint, highContrast) {
    const count = Math.min(9, Math.max(0, stacks | 0));
    if (count <= 0) return;
    const step = 0.34;
    const start = -Math.PI / 2 - (count - 1) * step * 0.5;
    const inner = size * 0.51;
    const outer = size * 0.60;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
        const a = start + i * step;
        ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
        ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
    }
    strokeGlyphPath(ctx, tint, Math.max(1.1, size * 0.09), highContrast);
}

// Draw one source-backed status badge. The credited glyph establishes the
// base meaning; geometric modifiers keep same-family states distinct without
// hue: freeze gets a hard square frame, shred cracks its shield, and slow adds
// down-chevrons beneath a compact frost mark. Stack effects use exact ticks.
export function drawStatusGlyph(ctx, kind, x, y, size, tint = null, stacks = 0, highContrast = false) {
    const s = Math.max(10, size);
    const r = s * 0.5;
    const line = Math.max(1.35, s * 0.105);
    const color = tint || statusTint(kind);
    const iconId = statusIconForKind(kind);
    const icon = getIconGlyph(iconId, highContrast ? null : color);

    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    ctx.fillStyle = highContrast ? COMBAT_CUE_DARK : 'rgba(5, 7, 12, 0.86)';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = highContrast ? COMBAT_CUE_LIGHT : 'rgba(255,255,255,0.68)';
    ctx.lineWidth = highContrast ? 1.8 : 1.1;
    ctx.stroke();

    if (kind === 'slow') {
        // Source-backed frost marker + double down-chevron = slowed movement.
        const iconSize = s * 0.34;
        ctx.drawImage(icon, -iconSize * 0.5, -s * 0.36, iconSize, iconSize);
        ctx.beginPath();
        ctx.moveTo(-s * 0.25, -s * 0.02);
        ctx.lineTo(0, s * 0.15);
        ctx.lineTo(s * 0.25, -s * 0.02);
        ctx.moveTo(-s * 0.22, s * 0.14);
        ctx.lineTo(0, s * 0.30);
        ctx.lineTo(s * 0.22, s * 0.14);
        strokeGlyphPath(ctx, color, line * 0.82, highContrast);
    } else {
        let iconSize = s * 0.62;
        if (kind === 'freeze') iconSize = s * 0.48;
        ctx.drawImage(icon, -iconSize * 0.5, -iconSize * 0.5, iconSize, iconSize);

        if (kind === 'freeze') {
            // Hard rectangular containment differentiates freeze from chill.
            ctx.beginPath();
            ctx.rect(-s * 0.33, -s * 0.33, s * 0.66, s * 0.66);
            strokeGlyphPath(ctx, color, line * 0.82, highContrast);
        } else if (kind === 'shred') {
            // The real shield icon remains intact underneath an explicit crack.
            ctx.beginPath();
            ctx.moveTo(-s * 0.09, -s * 0.30);
            ctx.lineTo(s * 0.03, -s * 0.07);
            ctx.lineTo(-s * 0.05, s * 0.04);
            ctx.lineTo(s * 0.12, s * 0.29);
            strokeGlyphPath(ctx, color, line * 0.88, highContrast);
        }
    }

    drawStackTicks(ctx, stacks, s, color, highContrast);
    ctx.restore();
}

function createStatusBadgeSprite(kind, stacks, highContrast) {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const canvas = document.createElement('canvas');
    canvas.width = BADGE_CANVAS_SIZE;
    canvas.height = BADGE_CANVAS_SIZE;
    const cx = canvas.getContext('2d');
    if (!cx) return null;
    drawStatusGlyph(
        cx,
        kind,
        BADGE_CANVAS_SIZE * 0.5,
        BADGE_CANVAS_SIZE * 0.5,
        BADGE_ART_SIZE,
        statusTint(kind),
        stacks,
        highContrast,
    );
    canvas._statusCueKind = kind;
    return canvas;
}

// One drawImage per live badge after a lazy, bounded cache fill. At most
// 2 modes × 7 meanings × 10 stack states can exist; most states use slot 0.
export function drawCachedStatusGlyph(ctx, kind, x, y, size, stacks = 0, highContrast = false) {
    const kindIndex = statusKindIndex(kind);
    if (kindIndex < 0) return 0;
    const stackIndex = Math.min(9, Math.max(0, stacks | 0));
    const cacheIndex = kindIndex * 10 + stackIndex;
    const cache = highContrast ? CONTRAST_BADGE_CACHE : NORMAL_BADGE_CACHE;
    let sprite = cache[cacheIndex];
    if (sprite === undefined) {
        sprite = createStatusBadgeSprite(kind, stackIndex, highContrast);
        cache[cacheIndex] = sprite || null;
    }
    if (!sprite) {
        drawStatusGlyph(ctx, kind, x, y, size, statusTint(kind), stackIndex, highContrast);
        return 1;
    }
    const side = Math.max(10, size) * BADGE_DRAW_SCALE;
    ctx.drawImage(sprite, x - side * 0.5, y - side * 0.5, side, side);
    return 1;
}
