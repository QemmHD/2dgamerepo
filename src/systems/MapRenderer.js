// MapRenderer — owns the world's visual background (tiled ground texture)
// and the scattered decoration props (rocks, mushrooms, bones, candles…).
//
// Two stages run independently of gameplay:
//   - drawBackground: fills the camera rect with a tile pattern, lazily
//     building the CanvasPattern once the ground sprite is ready.
//   - drawDecorations: walks the visible chunk grid, builds each visible
//     chunk's decoration list deterministically from a seeded RNG (so a
//     given chunk always looks the same), and draws what's in view.
//
// All decoration props are visual only — they don't take part in
// collision, pathfinding, or any gameplay logic. Adding/removing props
// here can never affect game balance.
//
// Vignette is drawn in screen space (outside the camera transform) so it
// stays anchored to the viewport corners, not the world.

import { MAP, VIGNETTE, WORLD_WIDTH, WORLD_HEIGHT, GFX, SPRITE_FX, LIGHT_COLORS, SPRITE_SS } from '../config/GameConfig.js';
import { TWO_PI } from '../core/MathUtils.js';
import { getGroundTileSprite, getDecorationSprite, getSoftShadowSprite } from '../assets/ProceduralSprites.js';

const CHUNK_SIZE = MAP.tileSize * MAP.chunkTilesPerSide;

// Which decoration types ground themselves with a soft contact shadow
// (standing props only — flat litter draws flush). Resolved once from config.
const SHADOW_CASTERS = new Set(SPRITE_FX.decorationShadow.casters || []);

// Mulberry32 — small, fast PRNG. Deterministic for a given seed, which
// is exactly what we want for chunk decoration so the same patch of
// ground looks identical on every reload.
function mulberry32(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Hash chunk coordinates into a 32-bit unsigned int. Spreads adjacent
// chunks far apart in the seed space so neighbors don't look correlated.
function hashChunk(cx, cy) {
    let h = (cx | 0) * 374761393 + (cy | 0) * 668265263;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
}

export class MapRenderer {
    constructor() {
        this.tilePattern = null;
        this.tilePatternFailed = false;
        // chunkCache: 'cx,cy' → array of {type, x, y, scale, rot}.
        // Built lazily as chunks come into view and never cleared — total
        // memory is bounded by world size (4800×2700 / 512² ≈ 50 chunks).
        this.chunkCache = new Map();
        // Set by Game from reducedEffects / the FPS governor: when true, the
        // cosmetic decoration contact shadows are skipped to shed fill cost.
        this.lowQuality = false;
    }

    _ensureTilePattern(ctx) {
        if (this.tilePattern || this.tilePatternFailed) return;
        try {
            const tile = getGroundTileSprite();
            this.tilePattern = ctx.createPattern(tile, 'repeat');
        } catch (_) {
            // createPattern can fail if the source canvas is 0×0 — keep
            // the flag so we don't retry every frame.
            this.tilePatternFailed = true;
        }
    }

    drawBackground(ctx, camera, viewW, viewH) {
        // Solid base color first — if the pattern ever fails to build
        // we'd rather see a dark backdrop than transparent gaps.
        ctx.fillStyle = MAP.backgroundColor;
        const left = camera.x - viewW / 2;
        const top = camera.y - viewH / 2;
        ctx.fillRect(left, top, viewW, viewH);

        this._ensureTilePattern(ctx);
        if (!this.tilePattern) return;

        // Tile pattern is anchored at world (0,0). Save/restore so the
        // pattern transform we apply doesn't leak out.
        ctx.save();
        ctx.fillStyle = this.tilePattern;
        ctx.fillRect(left, top, viewW, viewH);
        ctx.restore();
    }

    _getChunkDecorations(cx, cy) {
        const key = `${cx},${cy}`;
        const cached = this.chunkCache.get(key);
        if (cached) return cached;

        const seed = hashChunk(cx, cy);
        const rng = mulberry32(seed);
        const count = MAP.decorationsPerChunkMin +
            Math.floor(rng() * (MAP.decorationsPerChunkMax - MAP.decorationsPerChunkMin + 1));

        const decs = [];
        const baseX = cx * CHUNK_SIZE;
        const baseY = cy * CHUNK_SIZE;
        for (let i = 0; i < count; i++) {
            const type = MAP.decorationTypes[Math.floor(rng() * MAP.decorationTypes.length)];
            const x = baseX + rng() * CHUNK_SIZE;
            const y = baseY + rng() * CHUNK_SIZE;
            const scale = 0.8 + rng() * 0.4;
            const rot = (rng() - 0.5) * 0.4;
            decs.push({ type, x, y, scale, rot });
        }
        this.chunkCache.set(key, decs);
        return decs;
    }

    // `lighting` (optional) is the LightingSystem; lit decorations (candles)
    // register a warm light so they glow through the darkness veil.
    drawDecorations(ctx, camera, viewW, viewH, lighting = null) {
        const left = camera.x - viewW / 2;
        const top = camera.y - viewH / 2;
        const right = left + viewW;
        const bottom = top + viewH;

        // Contact-shadow config + cached blob resolved once per call (skipped
        // entirely under reduced effects / governor low-quality).
        const ds = SPRITE_FX.decorationShadow;
        const shadowBlob = (ds.enabled && !this.lowQuality) ? getSoftShadowSprite() : null;

        const cx0 = Math.floor(left / CHUNK_SIZE) - 1;
        const cy0 = Math.floor(top / CHUNK_SIZE) - 1;
        const cx1 = Math.floor(right / CHUNK_SIZE) + 1;
        const cy1 = Math.floor(bottom / CHUNK_SIZE) + 1;

        // World-bound clamp so we never draw decoration sprites for
        // chunks that lie entirely outside the playable area.
        const halfW = WORLD_WIDTH / 2;
        const halfH = WORLD_HEIGHT / 2;

        for (let cy = cy0; cy <= cy1; cy++) {
            for (let cx = cx0; cx <= cx1; cx++) {
                const decs = this._getChunkDecorations(cx, cy);
                for (const d of decs) {
                    if (d.x < -halfW || d.x > halfW || d.y < -halfH || d.y > halfH) continue;
                    const sprite = getDecorationSprite(d.type);
                    if (!sprite) continue;
                    // Decoration sources are supersampled (SPRITE_SS×); draw
                    // at logical world size so the footprint + cull stay right.
                    const w = (sprite.width / SPRITE_SS) * d.scale;
                    const h = (sprite.height / SPRITE_SS) * d.scale;
                    // Cull anything fully off-screen so big sprites
                    // (ruin/branch) don't pay the cost when out of view.
                    if (d.x + w / 2 < left || d.x - w / 2 > right) continue;
                    if (d.y + h / 2 < top || d.y - h / 2 > bottom) continue;
                    // Soft contact shadow under standing props — drawn first,
                    // axis-aligned on the ground (never rotated with the prop),
                    // via the cached blob so there's no per-frame gradient.
                    if (ds.enabled && SHADOW_CASTERS.has(d.type) && shadowBlob) {
                        const sw = w * ds.scaleX * 2;
                        const sh = w * ds.scaleY * 2;
                        ctx.globalAlpha = ds.alpha;
                        ctx.drawImage(shadowBlob, d.x - sw / 2, d.y + h * ds.offsetY - sh / 2, sw, sh);
                        ctx.globalAlpha = 1;
                    }
                    if (d.rot === 0) {
                        ctx.drawImage(sprite, d.x - w / 2, d.y - h / 2, w, h);
                    } else {
                        ctx.save();
                        ctx.translate(d.x, d.y);
                        ctx.rotate(d.rot);
                        ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
                        ctx.restore();
                    }
                    // Candles cast warm light from their flame (near the top
                    // of the sprite). Always-on (priority 0) — there are
                    // few visible at once.
                    if (lighting && d.type === 'candle') {
                        lighting.addLight(d.x, d.y - h * 0.28, GFX.lighting.candleRadius, LIGHT_COLORS.candle, 0.8, 0);
                    }
                }
            }
        }
    }

    // Soft corner darkening drawn in SCREEN space (caller passes the
    // screen width/height directly — no camera transform).
    drawVignette(ctx, screenW, screenH) {
        const cx = screenW / 2;
        const cy = screenH / 2;
        const maxR = Math.hypot(cx, cy);
        const inner = maxR * VIGNETTE.innerRadius;
        const outer = maxR * VIGNETTE.outerRadius;

        const tint = VIGNETTE.color || '0, 0, 0';
        const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
        grad.addColorStop(0, `rgba(${tint},0)`);
        grad.addColorStop(1, `rgba(${tint},${VIGNETTE.strength})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, screenW, screenH);
    }

    drawDebug(ctx, camera, viewW, viewH) {
        const left = camera.x - viewW / 2;
        const top = camera.y - viewH / 2;
        const right = left + viewW;
        const bottom = top + viewH;

        const cx0 = Math.floor(left / CHUNK_SIZE) - 1;
        const cy0 = Math.floor(top / CHUNK_SIZE) - 1;
        const cx1 = Math.floor(right / CHUNK_SIZE) + 1;
        const cy1 = Math.floor(bottom / CHUNK_SIZE) + 1;

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 209, 102, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        for (let cy = cy0; cy <= cy1; cy++) {
            for (let cx = cx0; cx <= cx1; cx++) {
                ctx.strokeRect(cx * CHUNK_SIZE, cy * CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE);
            }
        }
        ctx.setLineDash([]);

        // Mark each decoration anchor.
        ctx.fillStyle = 'rgba(255, 209, 102, 0.7)';
        for (let cy = cy0; cy <= cy1; cy++) {
            for (let cx = cx0; cx <= cx1; cx++) {
                const decs = this._getChunkDecorations(cx, cy);
                for (const d of decs) {
                    ctx.beginPath();
                    ctx.arc(d.x, d.y, 2, 0, TWO_PI);
                    ctx.fill();
                }
            }
        }
        ctx.restore();
    }
}
