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
import { getGroundTexture } from '../assets/WorldTextures.js';

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

function hashString(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

function pickWeighted(weights, rng) {
    const entries = Object.entries(weights || {});
    if (!entries.length) return MAP.decorationTypes[(rng() * MAP.decorationTypes.length) | 0];
    let total = 0;
    for (const [, weight] of entries) total += Math.max(0, weight || 0);
    let roll = rng() * Math.max(1, total);
    for (const [type, weight] of entries) {
        roll -= Math.max(0, weight || 0);
        if (roll <= 0) return type;
    }
    return entries[0][0];
}

export class MapRenderer {
    constructor() {
        this.tilePattern = null;
        this.tilePatternFailed = false;
        // chunkCache: 'biome:cx,cy' → { decs, motifs }.
        // Built lazily as chunks come into view and cleared when the active
        // biome changes; total memory remains bounded by the finite world grid.
        this.chunkCache = new Map();
        // Transparent biome-specific microtexture overlays. Generated once per
        // biome into small seamless canvases, then stamped as CanvasPatterns;
        // this breaks the old "same grass tile under four color filters" look
        // without adding network assets or per-frame procedural work.
        this.surfacePatterns = new Map();
        // Structure records are supplied by Game after deterministic obstacle
        // generation. They are visual exclusion masks only: standing scenery
        // stays out of rooms and both usable door approaches without changing
        // collision, placement RNG, or the cached chunk catalog.
        this.structureExclusions = [];
        // Set by Game from reducedEffects / the FPS governor: when true, the
        // cosmetic decoration contact shadows are skipped to shed fill cost.
        // (Weather is NOT gated by this — the governor thins it via weatherScale
        // instead, so it dims gradually rather than vanishing; roadmap #5 tiers.)
        this.lowQuality = false;
        // Weather mote-count multiplier (1 = full). The tier-2 governor step
        // halves it to shed the per-mote fill without killing the atmosphere.
        this.weatherScale = 1;
        // Active biome theme ({ bg, grade, gradeAlpha }); null = default dusk.
        // Set by Game at run start from the selected map.
        this.theme = null;
    }

    setStructureExclusions(structures) {
        this.structureExclusions = Array.isArray(structures) ? structures : [];
    }

    _insideStructureExclusion(x, y, padding = 0, entranceReach = 0) {
        for (const s of this.structureExclusions) {
            if (!s) continue;
            const outHW = s.interiorW / 2 + s.wall;
            const outHH = s.interiorH / 2 + s.wall;
            const dx = Math.abs(x - s.x);
            const dy = Math.abs(y - s.y);
            // Keep the authored floor, walls and immediate foundation clean.
            if (dx <= outHW + padding && dy <= outHH + padding) return true;
            // Both collision openings are real routes. Preserve a readable
            // approach north and south instead of scattering walk-through props
            // across the threshold/path artwork.
            if (entranceReach > 0
                && dx <= s.door / 2 + padding
                && dy <= outHH + entranceReach) return true;
        }
        return false;
    }

    _surfacePattern(ctx) {
        const id = this.theme?.id || 'default';
        if (this.surfacePatterns.has(id)) return this.surfacePatterns.get(id);
        let pattern = null;
        try {
            if (typeof document === 'undefined') return null;
            const c = document.createElement('canvas');
            c.width = 256; c.height = 256;
            const x = c.getContext('2d');
            const profile = this.theme?.dressing || {};
            const ground = profile.ground || '#65704a';
            const accent = profile.accent || '#b6a86d';
            const detail = profile.detail || '#303827';
            x.lineCap = 'round';
            if (id === 'hollowreach') {
                // Broad, quiet wind shelves read as snow instead of scanlines.
                x.strokeStyle = accent; x.globalAlpha = 0.11; x.lineWidth = 2;
                for (let i = 0; i < 6; i++) {
                    const yy = 10 + i * 45;
                    x.beginPath(); x.moveTo(-30, yy); x.bezierCurveTo(48, yy - 12, 166, yy + 12, 286, yy - 2); x.stroke();
                }
                x.fillStyle = ground; x.globalAlpha = 0.14;
                for (let i = 0; i < 24; i++) { x.beginPath(); x.arc((i * 83) % 256, (i * 47) % 256, 1 + (i % 3), 0, TWO_PI); x.fill(); }
            } else if (id === 'crypts') {
                x.strokeStyle = accent; x.globalAlpha = 0.18; x.lineWidth = 2;
                for (let yy = 0; yy <= 256; yy += 48) {
                    x.beginPath(); x.moveTo(0, yy); x.lineTo(256, yy); x.stroke();
                    const off = ((yy / 48) & 1) * 36;
                    for (let xx = off; xx <= 256; xx += 72) { x.beginPath(); x.moveTo(xx, yy); x.lineTo(xx, yy + 48); x.stroke(); }
                }
                x.strokeStyle = detail; x.globalAlpha = 0.22;
                for (let i = 0; i < 7; i++) { const xx = (i * 71) % 256, yy = (i * 113) % 256; x.beginPath(); x.moveTo(xx, yy); x.lineTo(xx + 14, yy + 9); x.lineTo(xx + 8, yy + 21); x.stroke(); }
            } else if (id === 'dunes') {
                // Sparse dune contours keep the sand alive without becoming a
                // repeating wallpaper over enemies and telegraphs.
                x.strokeStyle = accent; x.globalAlpha = 0.13; x.lineWidth = 2;
                for (let i = 0; i < 7; i++) {
                    const yy = i * 39;
                    x.beginPath(); x.moveTo(-30, yy); x.bezierCurveTo(38, yy - 12, 110, yy + 12, 178, yy); x.bezierCurveTo(214, yy - 7, 244, yy - 4, 286, yy + 2); x.stroke();
                }
                x.fillStyle = detail; x.globalAlpha = 0.10;
                for (let i = 0; i < 18; i++) x.fillRect((i * 97) % 256, (i * 61) % 256, 8 + (i % 4) * 5, 2);
            } else {
                x.fillStyle = ground; x.globalAlpha = 0.17;
                for (let i = 0; i < 28; i++) { const xx = (i * 79) % 256, yy = (i * 43) % 256; x.beginPath(); x.ellipse(xx, yy, 7 + (i % 4) * 3, 3 + (i % 2) * 2, i * 0.31, 0, TWO_PI); x.fill(); }
                x.strokeStyle = detail; x.globalAlpha = 0.13; x.lineWidth = 3;
                for (let i = 0; i < 6; i++) { const yy = 18 + i * 43; x.beginPath(); x.moveTo(-10, yy); x.bezierCurveTo(54, yy - 20, 138, yy + 18, 266, yy - 5); x.stroke(); }
            }
            pattern = ctx.createPattern(c, 'repeat');
        } catch (_) {
            pattern = null;
        }
        this.surfacePatterns.set(id, pattern);
        return pattern;
    }

    _ensureTilePattern(ctx) {
        if (this.tilePattern || this.tilePatternFailed) return;
        try {
            // Prefer the imported CC0 ground texture; fall back to the
            // procedural tile if it failed to load (offline / missing deploy).
            // Either way the biome groundFill + grade recolour it per map.
            const tile = getGroundTexture() || getGroundTileSprite();
            this.tilePattern = ctx.createPattern(tile, 'repeat');
        } catch (_) {
            // createPattern can fail if the source canvas is 0×0 — keep
            // the flag so we don't retry every frame.
            this.tilePatternFailed = true;
        }
    }

    drawBackground(ctx, camera, viewW, viewH) {
        // Solid base color first — if the pattern ever fails to build
        // we'd rather see a dark backdrop than transparent gaps. The active
        // biome theme can override the base color.
        const theme = this.theme;
        ctx.fillStyle = (theme && theme.bg) || MAP.backgroundColor;
        const left = camera.x - viewW / 2;
        const top = camera.y - viewH / 2;
        ctx.fillRect(left, top, viewW, viewH);

        this._ensureTilePattern(ctx);
        if (this.tilePattern) {
            // Tile pattern is anchored at world (0,0). Save/restore so the
            // pattern transform we apply doesn't leak out.
            ctx.save();
            ctx.fillStyle = this.tilePattern;
            ctx.fillRect(left, top, viewW, viewH);
            ctx.restore();
        }

        // Biome ground recolour: a translucent biome colour painted OVER the
        // tile (source-over, so it can lighten toward snow/sand as well as
        // darken) — the main cue that each map is a different surface type.
        if (theme && theme.groundFill && theme.groundFillAlpha > 0) {
            ctx.save();
            ctx.globalAlpha = theme.groundFillAlpha;
            ctx.fillStyle = theme.groundFill;
            ctx.fillRect(left, top, viewW, viewH);
            ctx.restore();
        }

        const surface = this._surfacePattern(ctx);
        if (surface) {
            ctx.save();
            ctx.fillStyle = surface;
            ctx.fillRect(left, top, viewW, viewH);
            ctx.restore();
        }

        // Biome color grade: a translucent tint multiplied over the ground so
        // an alternate map reads as a different place without new sprite art.
        if (theme && theme.grade && theme.gradeAlpha > 0) {
            ctx.save();
            ctx.globalCompositeOperation = 'multiply';
            ctx.globalAlpha = theme.gradeAlpha;
            ctx.fillStyle = theme.grade;
            ctx.fillRect(left, top, viewW, viewH);
            ctx.restore();
        }
    }

    _getChunkDecorations(cx, cy) {
        const theme = this.theme;
        const biomeId = theme?.id || 'default';
        if (this._cacheBiomeId !== biomeId) {
            this.chunkCache.clear();
            this._cacheBiomeId = biomeId;
        }
        const key = `${biomeId}:${cx},${cy}`;
        const cached = this.chunkCache.get(key);
        if (cached) return cached;

        const seed = hashChunk(cx, cy) ^ hashString(biomeId);
        const rng = mulberry32(seed);
        const dressing = theme?.dressing || null;
        const min = dressing?.density?.[0] ?? MAP.decorationsPerChunkMin;
        const max = dressing?.density?.[1] ?? MAP.decorationsPerChunkMax;
        const count = min + Math.floor(rng() * (Math.max(min, max) - min + 1));

        const decs = [];
        const motifs = [];
        const baseX = cx * CHUNK_SIZE;
        const baseY = cy * CHUNK_SIZE;
        const anchors = [{ x: baseX + rng() * CHUNK_SIZE, y: baseY + rng() * CHUNK_SIZE }];
        if (rng() > 0.62) anchors.push({ x: baseX + rng() * CHUNK_SIZE, y: baseY + rng() * CHUNK_SIZE });
        for (let i = 0; i < count; i++) {
            const type = dressing ? pickWeighted(dressing.weights, rng)
                : MAP.decorationTypes[Math.floor(rng() * MAP.decorationTypes.length)];
            const cluster = dressing && rng() < (dressing.clusterChance ?? 0);
            const anchor = anchors[i % anchors.length];
            const a = rng() * TWO_PI;
            const radius = 26 + rng() * 118;
            const x = cluster ? anchor.x + Math.cos(a) * radius : baseX + rng() * CHUNK_SIZE;
            const y = cluster ? anchor.y + Math.sin(a) * radius * 0.58 : baseY + rng() * CHUNK_SIZE;
            const scale = 0.72 + rng() * 0.62;
            const rot = (rng() - 0.5) * 0.4;
            decs.push({ type, x, y, scale, rot });
        }
        if (dressing?.motifs?.length) {
            const motifCount = 1 + (rng() > 0.55 ? 1 : 0);
            for (let i = 0; i < motifCount; i++) {
                motifs.push({
                    type: dressing.motifs[(rng() * dressing.motifs.length) | 0],
                    x: baseX + 70 + rng() * (CHUNK_SIZE - 140),
                    y: baseY + 70 + rng() * (CHUNK_SIZE - 140),
                    scale: 0.72 + rng() * 0.72,
                    rot: rng() * TWO_PI,
                    variant: (rng() * 997) | 0,
                    ground: dressing.ground,
                    accent: dressing.accent,
                    detail: dressing.detail,
                });
            }
        }
        const result = { decs, motifs };
        this.chunkCache.set(key, result);
        return result;
    }

    _drawGroundMotif(ctx, m) {
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.rot);
        ctx.scale(m.scale, m.scale);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const g = m.ground || '#596040';
        const a = m.accent || '#c0b27a';
        const d = m.detail || '#303526';
        const v = m.variant || 0;
        switch (m.type) {
            case 'leafBed':
                ctx.globalAlpha = 0.28;
                for (let i = 0; i < 18; i++) {
                    const ang = (i * 2.399 + v * 0.07) % TWO_PI;
                    const r = 16 + ((i * 37 + v) % 72);
                    ctx.fillStyle = i % 3 === 0 ? a : (i % 2 ? g : d);
                    ctx.save();
                    ctx.translate(Math.cos(ang) * r, Math.sin(ang) * r * 0.48);
                    ctx.rotate(ang);
                    ctx.fillRect(-5, -2, 10, 4);
                    ctx.restore();
                }
                break;
            case 'rootTrail':
                ctx.globalAlpha = 0.24;
                ctx.strokeStyle = d;
                ctx.lineWidth = 5;
                for (let i = -1; i <= 1; i++) {
                    ctx.beginPath();
                    ctx.moveTo(-92, i * 18);
                    ctx.bezierCurveTo(-42, -22 + i * 10, 24, 28 + i * 8, 96, i * 14);
                    ctx.stroke();
                }
                break;
            case 'mossRing':
                ctx.globalAlpha = 0.25;
                ctx.strokeStyle = g;
                ctx.lineWidth = 14;
                ctx.setLineDash([18, 11]);
                ctx.beginPath(); ctx.ellipse(0, 0, 86, 42, 0, 0, TWO_PI); ctx.stroke();
                ctx.setLineDash([]);
                break;
            case 'snowDrift':
                ctx.globalAlpha = 0.24;
                ctx.fillStyle = a;
                for (let i = 0; i < 4; i++) {
                    ctx.beginPath(); ctx.ellipse(-64 + i * 42, (i % 2) * 12, 52, 14, -0.12, 0, TWO_PI); ctx.fill();
                }
                break;
            case 'iceCrack':
                ctx.globalAlpha = 0.34;
                ctx.strokeStyle = d;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(-92, -15); ctx.lineTo(-34, 2); ctx.lineTo(4, -18); ctx.lineTo(48, 8); ctx.lineTo(96, -5); ctx.stroke();
                ctx.lineWidth = 1.5;
                for (const [x, y, dx, dy] of [[-34, 2, -18, 30], [4, -18, 8, -27], [48, 8, 17, 25]]) {
                    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy); ctx.stroke();
                }
                break;
            case 'frostHalo':
                ctx.globalAlpha = 0.22;
                ctx.strokeStyle = a;
                ctx.lineWidth = 4;
                ctx.setLineDash([8, 13]);
                ctx.beginPath(); ctx.ellipse(0, 0, 78, 36, 0, 0, TWO_PI); ctx.stroke();
                ctx.setLineDash([]);
                break;
            case 'flagstones':
                ctx.globalAlpha = 0.22;
                ctx.strokeStyle = a;
                ctx.lineWidth = 2;
                for (let yy = -46; yy <= 46; yy += 32) {
                    for (let xx = -78; xx <= 78; xx += 42) {
                        const off = ((yy / 32) & 1) * 18;
                        ctx.strokeRect(xx + off, yy, 34 + ((xx + v) & 5), 22);
                    }
                }
                break;
            case 'graveSoil':
                ctx.globalAlpha = 0.25;
                ctx.fillStyle = d;
                ctx.beginPath(); ctx.ellipse(0, 0, 94, 40, 0, 0, TWO_PI); ctx.fill();
                ctx.globalAlpha = 0.24;
                ctx.strokeStyle = g;
                ctx.lineWidth = 3;
                for (let i = -3; i <= 3; i++) {
                    ctx.beginPath(); ctx.moveTo(-70, i * 8); ctx.quadraticCurveTo(0, i * 11 + (i % 2) * 5, 70, i * 7); ctx.stroke();
                }
                break;
            case 'runeCircle':
                ctx.globalAlpha = 0.25;
                ctx.strokeStyle = a;
                ctx.lineWidth = 3;
                ctx.beginPath(); ctx.ellipse(0, 0, 72, 36, 0, 0, TWO_PI); ctx.stroke();
                for (let i = 0; i < 8; i++) {
                    const ang = i * TWO_PI / 8;
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(ang) * 58, Math.sin(ang) * 29);
                    ctx.lineTo(Math.cos(ang) * 76, Math.sin(ang) * 38);
                    ctx.stroke();
                }
                break;
            case 'duneRipples':
                ctx.globalAlpha = 0.26;
                ctx.strokeStyle = a;
                ctx.lineWidth = 3;
                for (let i = -3; i <= 3; i++) {
                    ctx.beginPath(); ctx.moveTo(-100, i * 15); ctx.bezierCurveTo(-48, i * 15 - 12, 42, i * 15 + 12, 100, i * 15); ctx.stroke();
                }
                break;
            case 'scrubPatch':
                ctx.globalAlpha = 0.30;
                ctx.strokeStyle = d;
                ctx.lineWidth = 3;
                for (let i = 0; i < 13; i++) {
                    const x = -80 + ((i * 43 + v) % 160);
                    const y = -28 + ((i * 29 + v) % 56);
                    ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.lineTo(x + (i % 3 - 1) * 7, y - 8); ctx.stroke();
                }
                break;
            case 'fossilTrace':
                ctx.globalAlpha = 0.25;
                ctx.strokeStyle = a;
                ctx.lineWidth = 4;
                ctx.beginPath(); ctx.arc(-18, 0, 48, -1.2, 1.1); ctx.stroke();
                for (let i = 0; i < 6; i++) {
                    const ang = -0.9 + i * 0.34;
                    const x = -18 + Math.cos(ang) * 48;
                    const y = Math.sin(ang) * 48;
                    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * 24, y + Math.sin(ang) * 24); ctx.stroke();
                }
                break;
        }
        ctx.restore();
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
                const chunk = this._getChunkDecorations(cx, cy);
                for (const m of chunk.motifs) {
                    if (m.x < left - 160 || m.x > right + 160 || m.y < top - 100 || m.y > bottom + 100) continue;
                    // Motifs can be ~150px wide after scale. Keep their full
                    // authored mark inside the palisade and away from houses;
                    // unlike props, motifs have no sprite bounds to catch later.
                    if (m.x - 160 < -halfW || m.x + 160 > halfW
                        || m.y - 110 < -halfH || m.y + 110 > halfH) continue;
                    if (this._insideStructureExclusion(m.x, m.y, 155, 120)) continue;
                    this._drawGroundMotif(ctx, m);
                }
                for (const d of chunk.decs) {
                    if (d.x < -halfW || d.x > halfW || d.y < -halfH || d.y > halfH) continue;
                    if (this._insideStructureExclusion(d.x, d.y, 30, 150)) continue;
                    const sprite = getDecorationSprite(d.type);
                    if (!sprite) continue;
                    // Decoration sources are supersampled (SPRITE_SS×); draw
                    // at logical world size so the footprint + cull stay right.
                    const w = (sprite.width / SPRITE_SS) * d.scale;
                    const h = (sprite.height / SPRITE_SS) * d.scale;
                    if (d.x - w / 2 < -halfW || d.x + w / 2 > halfW
                        || d.y - h / 2 < -halfH || d.y + h / 2 > halfH) continue;
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
    // Biome weather — a stateless, screen-space mote layer. Positions are
    // derived purely from `time` (deterministic sine drift + wrap), so there's
    // no per-frame state to advance and nothing to allocate in the loop.
    // Embers rise (warm, additive); snow falls (cool, source-over). Skipped
    // under reduced-effects / the low-quality governor.
    // Build the cached god-ray canvas once: a few soft warm diagonal bands.
    // Fixed 1920x1080 intrinsic size, blitted stretched to the screen (the
    // bands are soft, so stretching is imperceptible). Returns null in a
    // non-DOM env so drawWeather simply skips the overlay.
    _buildRays() {
        try {
            const w = 1920, h = 1080;
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            const x = c.getContext('2d');
            x.translate(w * 0.5, 0);
            x.rotate(0.34); // ~20deg tilt
            for (let i = 0; i < 5; i++) {
                const bx = -w * 0.7 + i * (w * 0.34);
                const bw = 70 + (i % 3) * 45;
                const g = x.createLinearGradient(bx, 0, bx + bw, 0);
                g.addColorStop(0, 'rgba(255,190,120,0)');
                g.addColorStop(0.5, 'rgba(255,190,120,0.5)');
                g.addColorStop(1, 'rgba(255,190,120,0)');
                x.fillStyle = g;
                x.fillRect(bx, -h, bw, h * 3);
            }
            return c;
        } catch (e) {
            return null;
        }
    }

    drawWeather(ctx, screenW, screenH, time) {
        if (!this.theme || this.weatherScale <= 0) return;
        const kind = this.theme.weather;
        if (!['embers', 'snow', 'cryptDust', 'sandGust'].includes(kind)) return;
        const N = Math.round(56 * this.weatherScale);
        const span = screenH + 80;
        ctx.save();
        if (kind === 'embers') {
            // God-ray / dust-shaft overlay: a few soft angled warm bands built
            // once into a cached canvas, then blitted additively with a slow
            // breathing alpha + gentle horizontal parallax. One blit/frame.
            if (this._rays === undefined) this._rays = this._buildRays();
            if (this._rays) {
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = 0.06 + 0.04 * Math.sin(time * 0.25);
                const par = ((time * 6) % 40) - 20;
                ctx.drawImage(this._rays, par - 20, 0, screenW + 40, screenH);
                ctx.globalAlpha = 1;
            }
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = '#ff9a48';
            for (let i = 0; i < N; i++) {
                const speed = 26 + (i % 7) * 9;
                const x = ((i * 137.5) % screenW) + Math.sin(time * 0.6 + i) * 26;
                // Rise: subtract so motes float upward, wrapping at the top.
                const y = screenH - (((time * speed) + i * 53) % span);
                const flick = 0.25 + 0.2 * Math.sin(time * 3 + i * 1.7);
                ctx.globalAlpha = Math.max(0, flick);
                const r = 1.4 + (i % 3) * 0.8;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, TWO_PI);
                ctx.fill();
            }
        } else if (kind === 'snow') {
            ctx.fillStyle = 'rgba(214, 234, 255, 0.55)';
            for (let i = 0; i < N; i++) {
                const speed = 34 + (i % 6) * 12;
                const x = ((i * 113.3) % screenW) + Math.sin(time * 0.8 + i * 0.9) * 34;
                const y = ((time * speed) + i * 47) % span - 40;
                ctx.globalAlpha = 0.3 + 0.25 * Math.sin(time * 1.3 + i);
                const r = 1.2 + (i % 3) * 0.7;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, TWO_PI);
                ctx.fill();
            }
        } else if (kind === 'cryptDust') {
            // Sunless crypt: sparse pale ash with a slow violet sideways drift.
            // Source-over keeps it dusty rather than sparkling like snow.
            for (let i = 0; i < N; i++) {
                const speed = 8 + (i % 7) * 3;
                const x = ((i * 127.7 + time * speed) % (screenW + 80)) - 40;
                const y = ((i * 61.3) % screenH) + Math.sin(time * 0.35 + i) * 24;
                ctx.globalAlpha = 0.12 + 0.15 * (0.5 + 0.5 * Math.sin(time * 0.7 + i * 1.9));
                ctx.fillStyle = i % 5 === 0 ? '#aa8dcc' : '#d4cedd';
                ctx.beginPath(); ctx.arc(x, y, 1 + (i % 3) * 0.7, 0, TWO_PI); ctx.fill();
            }
        } else {
            // Dunes: short horizontal grains traveling in layered gust bands.
            ctx.strokeStyle = '#f0cf82';
            ctx.lineCap = 'round';
            for (let i = 0; i < Math.round(N * 0.72); i++) {
                const speed = 78 + (i % 8) * 16;
                const x = ((time * speed + i * 149) % (screenW + 180)) - 90;
                const band = (i * 83) % screenH;
                const y = band + Math.sin(time * 0.9 + i) * 18;
                const len = 12 + (i % 5) * 8;
                ctx.globalAlpha = 0.10 + (i % 4) * 0.035;
                ctx.lineWidth = 1 + (i % 3) * 0.55;
                ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y - 3); ctx.stroke();
            }
        }
        ctx.restore();
    }

    drawVignette(ctx, screenW, screenH) {
        const cx = screenW / 2;
        const cy = screenH / 2;
        const maxR = Math.hypot(cx, cy);
        const inner = maxR * VIGNETTE.innerRadius;
        const outer = maxR * VIGNETTE.outerRadius;

        const tint = VIGNETTE.color || '0, 0, 0';
        const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
        // Layered falloff: two intermediate stops turn the old hard ring into a
        // filmic graded corner (the darkening eases in instead of snapping).
        grad.addColorStop(0, `rgba(${tint},0)`);
        grad.addColorStop(0.55, `rgba(${tint},${VIGNETTE.strength * 0.12})`);
        grad.addColorStop(0.82, `rgba(${tint},${VIGNETTE.strength * 0.5})`);
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
                const chunk = this._getChunkDecorations(cx, cy);
                for (const d of chunk.decs) {
                    ctx.beginPath();
                    ctx.arc(d.x, d.y, 2, 0, TWO_PI);
                    ctx.fill();
                }
            }
        }
        ctx.restore();
    }
}
