// Customizable icon system (first working example of the asset pipeline).
//
// Demonstrates the customization flow end-to-end with a license-safe source:
// a PROCEDURAL base glyph (no external asset needed) is recolored by rarity and
// given a rarity frame, producing cached per-rarity variants. The exact same
// path works for an imported CC0/CC-BY icon sheet — swap the base drawer for a
// sliced sheet frame; the recolor + frame + cache layers are unchanged.
//
// Performance: every variant is rasterized ONCE and cached (keyed by
// base+rarity). Nothing recolors per render tick.

import { recolorCanvas } from '../render/recolor.js';
import { RARITIES } from '../content/rarities.js';

const ICON_PX = 64;
const baseCache = new Map();  // baseId → base glyph canvas
const iconCache = new Map();  // `${baseId}:${rarity}` → framed, recolored canvas

function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
}

// Procedural base glyphs (white, so the rarity recolor reads cleanly). Add more
// keys here, or replace a key's draw with an imported sliced frame.
const BASE_DRAWERS = {
    spark(cx, s) {
        const c = s / 2;
        cx.fillStyle = '#fff';
        cx.beginPath();
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const r = i % 2 === 0 ? s * 0.34 : s * 0.15;
            cx[i ? 'lineTo' : 'moveTo'](c + Math.cos(a) * r, c + Math.sin(a) * r);
        }
        cx.closePath(); cx.fill();
        cx.fillStyle = 'rgba(255,255,255,0.8)';
        cx.beginPath(); cx.arc(c, c, s * 0.1, 0, Math.PI * 2); cx.fill();
    },
    shield(cx, s) {
        const c = s / 2;
        cx.fillStyle = '#fff';
        cx.beginPath();
        cx.moveTo(c, s * 0.16);
        cx.lineTo(s * 0.80, s * 0.30);
        cx.lineTo(s * 0.72, s * 0.74);
        cx.lineTo(c, s * 0.88);
        cx.lineTo(s * 0.28, s * 0.74);
        cx.lineTo(s * 0.20, s * 0.30);
        cx.closePath(); cx.fill();
        cx.fillStyle = 'rgba(0,0,0,0.18)';
        cx.fillRect(c - 2, s * 0.24, 4, s * 0.5);
    },
};

function getBase(baseId) {
    if (baseCache.has(baseId)) return baseCache.get(baseId);
    const c = makeCanvas(ICON_PX, ICON_PX);
    const cx = c.getContext('2d');
    (BASE_DRAWERS[baseId] || BASE_DRAWERS.spark)(cx, ICON_PX);
    baseCache.set(baseId, c);
    return c;
}

// A rarity-customized icon: the base glyph recolored toward the rarity color
// with a matching frame ring. Cached per (baseId, rarity).
export function getRarityIcon(baseId, rarityId) {
    const key = `${baseId}:${rarityId}`;
    if (iconCache.has(key)) return iconCache.get(key);

    const rarity = RARITIES[rarityId] ?? RARITIES.common;
    // Recolor the white base toward the rarity color (cached by the recolor util).
    const tinted = recolorCanvas(getBase(baseId), { op: 'multiply', color: rarity.color, alpha: 1 }, `customicon:${key}`);

    // Compose: glow + tinted glyph + rarity frame ring.
    const out = makeCanvas(ICON_PX, ICON_PX);
    const cx = out.getContext('2d');
    const c = ICON_PX / 2;
    const g = cx.createRadialGradient(c, c, 2, c, c, ICON_PX * 0.5);
    g.addColorStop(0, rarity.glow);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = g; cx.fillRect(0, 0, ICON_PX, ICON_PX);
    cx.drawImage(tinted, 0, 0);
    cx.strokeStyle = rarity.color; cx.lineWidth = 3;
    cx.strokeRect(2, 2, ICON_PX - 4, ICON_PX - 4);

    iconCache.set(key, out);
    return out;
}

export function customIconCacheSize() {
    return iconCache.size;
}
