// Cohesive, layered rendering for enterable houses.
//
// Physical buildings remain the six ordinary rectangle obstacles created by
// ObstacleSystem. This renderer is deliberately visual-only: it paints one
// yard/shadow, one continuous shell, a cutaway roof, and low-priority light
// anchors without changing collision, LOS, spawn clearance, or enemy routing.

import { getWallPattern } from '../assets/ObstacleSprites.js';
import {
    houseDoorActive,
    houseStateDefinition,
    houseWallActive,
    worldRoomAt,
} from '../content/houseBlueprints.js';

const STYLE = {
    cabin: {
        roof: '#3b241d', roofDark: '#211714', roofLight: '#76513b',
        trim: '#c08a55', trimDark: '#4b2e20', window: '#ffc66f',
        yard: 'rgba(92, 78, 43, 0.22)', path: '#765f3e', pathEdge: '#3c3223',
        glow: '#ffad55', glowRadius: 126,
    },
    ruin: {
        roof: '#35323b', roofDark: '#1e1b24', roofLight: '#676170',
        trim: '#8a8490', trimDark: '#34303a', window: '#9ad8c5',
        yard: 'rgba(64, 70, 57, 0.24)', path: '#615f59', pathEdge: '#343532',
        glow: '#9be0bd', glowRadius: 108,
    },
    keep: {
        roof: '#303c48', roofDark: '#19232d', roofLight: '#6e8292',
        trim: '#9babb8', trimDark: '#2c3944', window: '#ffca72',
        yard: 'rgba(52, 67, 78, 0.24)', path: '#5c6770', pathEdge: '#303a42',
        glow: '#ffbd65', glowRadius: 122,
    },
    adobe: {
        roof: '#8b542e', roofDark: '#4d2f1d', roofLight: '#d39b5b',
        trim: '#f0c27b', trimDark: '#704225', window: '#ffd47c',
        yard: 'rgba(157, 105, 51, 0.20)', path: '#ae7c47', pathEdge: '#6d4728',
        glow: '#ffb75f', glowRadius: 126,
    },
};

const DEFAULT_STYLE = STYLE.cabin;

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function smoothstep(a, b, v) {
    const t = clamp01((v - a) / Math.max(0.0001, b - a));
    return t * t * (3 - 2 * t);
}

// Stable visual noise from the structure's coordinate-derived seed. It never
// advances the world-placement RNG, so adding a crack or pot cannot move a wall.
function unit(seed, salt) {
    let x = (seed ^ Math.imul((salt + 1) | 0, 0x9e3779b1)) >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d) >>> 0;
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b) >>> 0;
    x ^= x >>> 16;
    return x / 4294967296;
}

function roundedRect(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
}

function materialFor(structure) {
    return STYLE[structure.styleType] || DEFAULT_STYLE;
}

function entryShade(edge) {
    return edge === 'west' ? 0.20 : 0.11;
}

export class StructureRenderer {
    _roofAlpha(structure, player) {
        const cutaway = structure.blueprint?.roofCutaway;
        const exteriorAlpha = cutaway?.exteriorAlpha ?? 0.88;
        const interiorAlpha = cutaway?.interiorAlpha ?? 0.14;
        if (!player) return exteriorAlpha;
        if (structure.blueprint && worldRoomAt(structure, player.x, player.y, true)) {
            return interiorAlpha;
        }
        const dx = Math.max(0, Math.abs(player.x - structure.x) - structure.interiorW / 2);
        const dy = Math.max(0, Math.abs(player.y - structure.y) - structure.interiorH / 2);
        const distance = Math.hypot(dx, dy);
        // The roof becomes a quiet blueprint-like cutaway before the hero crosses
        // the threshold. This keeps enemies, pickups, and telegraphs readable.
        // Only the actual interior and immediate threshold become a cutaway.
        // At the standard exterior showcase/approach distance the roof is fully
        // authored and opaque enough to establish a strong house silhouette.
        return interiorAlpha + smoothstep(8, cutaway?.nearDistance ?? 100, distance)
            * (exteriorAlpha - interiorAlpha);
    }

    _doorFor(structure, kind) {
        if (!structure.blueprint) return null;
        return structure.blueprint.doors.find((entry) =>
            entry.kind === 'exterior'
            && houseDoorActive(entry, structure.state)
            && (kind === 'north' ? entry.normal.y < 0 : entry.normal.y > 0)) || null;
    }

    drawGround(ctx, structure) {
        const m = materialFor(structure);
        const outHW = structure.interiorW / 2 + structure.wall;
        const outHH = structure.interiorH / 2 + structure.wall;
        const mirror = structure.mirror || 1;
        ctx.save();
        ctx.translate(structure.x, structure.y);

        // Irregular, translucent yard clearing: enough contrast to make the
        // landmark feel placed in the world without looking like a hard tile.
        ctx.fillStyle = m.yard;
        ctx.beginPath();
        const points = 14;
        for (let i = 0; i < points; i++) {
            const a = (i / points) * Math.PI * 2;
            const wobble = 0.88 + unit(structure.visualSeed, i) * 0.20;
            const px = Math.cos(a) * (outHW + 70) * wobble;
            const py = Math.sin(a) * (outHH + 58) * wobble;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();

        // A single footprint shadow replaces the six overlapping ellipses that
        // the individual collision-wall obstacles used to paint.
        // Keep this shallow and soft: a tall opaque ellipse reads as a pit in
        // the top-down camera, especially under pale ruin floors.
        ctx.fillStyle = 'rgba(6, 7, 10, 0.23)';
        ctx.beginPath();
        ctx.ellipse(0, outHH + 10, outHW * 0.74, Math.max(13, outHH * 0.14), 0, 0, Math.PI * 2);
        ctx.fill();

        // Sparse, style-specific approach marks lead to the real south doorway.
        // They paint after the footprint shadow so the route remains legible;
        // the previous opaque ramp + bars read as a giant ladder.
        const frontY = structure.interiorH / 2 + structure.wall;
        const bend = mirror * (10 + unit(structure.visualSeed, 22) * 18);
        const frontDoor = this._doorFor(structure, 'south');
        ctx.save();
        if (frontDoor) ctx.translate(frontDoor.x, 0);
        this._drawApproach(ctx, structure, m, frontY, bend);
        ctx.restore();

        ctx.restore();
    }

    _drawApproach(ctx, s, m, frontY, bend) {
        const seed = s.visualSeed;
        ctx.save();
        ctx.globalAlpha = s.styleType === 'ruin' ? 0.46 : 0.40;

        if (s.styleType === 'adobe') {
            // Wind-softened wheel/foot ruts: present, but never a solid ramp.
            ctx.strokeStyle = m.pathEdge;
            ctx.lineWidth = 5;
            ctx.lineCap = 'round';
            for (const side of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(side * s.door * 0.22, frontY + 6);
                ctx.quadraticCurveTo(side * 18, frontY + 62, bend + side * 13, frontY + 126);
                ctx.stroke();
            }
            ctx.fillStyle = m.path;
            for (let i = 0; i < 5; i++) {
                const t = (i + 1) / 6;
                const x = bend * t + (unit(seed, 40 + i) - 0.5) * 34;
                const y = frontY + 18 + i * 22;
                ctx.beginPath();
                ctx.ellipse(x, y, 5 + unit(seed, 50 + i) * 5, 3, 0, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (s.styleType === 'keep') {
            // Deliberately uneven flagstones, offset rather than rung-like.
            for (let i = 0; i < 5; i++) {
                const t = i / 4;
                const w = 34 + unit(seed, 60 + i) * 20;
                const x = bend * t + (i % 2 ? 18 : -20) - w / 2;
                const y = frontY + 9 + i * 24;
                ctx.fillStyle = i & 1 ? m.pathEdge : m.path;
                roundedRect(ctx, x, y, w, 12 + unit(seed, 70 + i) * 6, 4);
                ctx.fill();
            }
        } else if (s.styleType === 'ruin') {
            // Broken masonry fragments make a ruined approach without implying
            // a maintained road or domestic porch.
            for (let i = 0; i < 6; i++) {
                const t = i / 5;
                const x = bend * t + (i % 2 ? 20 : -18) + (unit(seed, 80 + i) - 0.5) * 16;
                const y = frontY + 8 + i * 21;
                const w = 22 + unit(seed, 90 + i) * 22;
                const h = 8 + unit(seed, 100 + i) * 8;
                ctx.fillStyle = i % 3 ? m.path : m.pathEdge;
                ctx.beginPath();
                ctx.moveTo(x - w * 0.52, y);
                ctx.lineTo(x + w * 0.38, y - h * 0.28);
                ctx.lineTo(x + w * 0.52, y + h * 0.48);
                ctx.lineTo(x - w * 0.34, y + h * 0.62);
                ctx.closePath();
                ctx.fill();
            }
        } else {
            // Cabins get small worn earth/leaf patches, not porch planks laid
            // all the way across the route.
            for (let i = 0; i < 6; i++) {
                const t = i / 5;
                const x = bend * t + (i % 2 ? 14 : -13) + (unit(seed, 110 + i) - 0.5) * 12;
                const y = frontY + 8 + i * 21;
                ctx.fillStyle = i & 1 ? m.pathEdge : m.path;
                ctx.beginPath();
                ctx.ellipse(x, y, 15 + unit(seed, 120 + i) * 8,
                    6 + unit(seed, 130 + i) * 4, (unit(seed, 140 + i) - 0.5) * 0.35,
                    0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.restore();
    }

    drawRear(ctx, structure, player) {
        const m = materialFor(structure);
        const iHW = structure.interiorW / 2;
        const iHH = structure.interiorH / 2;
        const T = structure.wall;
        const H = structure.wallH;
        const backY = -iHH - T / 2;
        const outHW = iHW + T;

        ctx.save();
        ctx.translate(structure.x, structure.y);

        // A skyline/cutaway roof cap establishes the building profile. It fades
        // near the hero; this is intentionally not presented as a full roof
        // plane, keeping the enterable interior readable from the game camera.
        ctx.save();
        ctx.globalAlpha = this._roofAlpha(structure, player);
        this._drawRoof(ctx, structure, m, backY, outHW, H);
        ctx.restore();

        // Rear wall has the real north doorway/breach. Both halves are drawn in
        // one translated context, so texture courses align across the opening.
        this._drawSplitWall(ctx, structure, m, backY, false);
        this._drawDoorFrame(ctx, structure, m, backY, false, this._doorFor(structure, 'north'));
        this._drawRearDetails(ctx, structure, m, backY);

        // A thin roof ridge stays opaque in cutaway mode.
        ctx.strokeStyle = m.roofLight;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(-outHW - 10, backY - H - 5);
        ctx.lineTo(outHW + 10, backY - H - 5);
        ctx.stroke();

        ctx.restore();
    }

    drawFront(ctx, structure) {
        const m = materialFor(structure);
        const iHW = structure.interiorW / 2;
        const iHH = structure.interiorH / 2;
        const T = structure.wall;
        const H = structure.wallH;
        const backY = -iHH - T / 2;
        const frontY = iHH + T / 2;
        ctx.save();
        ctx.translate(structure.x, structure.y);

        // Side faces belong to the front depth plane. Sorting this whole shell
        // at the front collision baseline makes it occlude actors inside/behind
        // the house while actors south of it paint over the shell exactly once.
        if (structure.blueprint) this._drawBlueprintSides(ctx, structure, m);
        else {
            this._drawSideFace(ctx, structure, m, -iHW - T, backY, frontY, H, true);
            this._drawSideFace(ctx, structure, m, iHW, backY, frontY, H, false);
        }
        this._drawSplitWall(ctx, structure, m, frontY, true);
        const frontDoor = this._doorFor(structure, 'south');
        this._drawDoorFrame(ctx, structure, m, frontY, true, frontDoor);
        this._drawFrontDetails(ctx, structure, m, frontY);

        // Bright threshold exactly spans the actual opening and makes the safe
        // route legible during a swarm.
        ctx.fillStyle = m.trim;
        const thresholdX = frontDoor?.x || 0;
        const thresholdW = frontDoor?.width || structure.door;
        ctx.fillRect(thresholdX - thresholdW * 0.43, frontY - 3, thresholdW * 0.86, 7);
        ctx.fillStyle = 'rgba(255, 235, 185, 0.26)';
        ctx.fillRect(thresholdX - thresholdW * 0.34, frontY - 2, thresholdW * 0.68, 2);

        ctx.restore();
    }

    registerLights(lighting, structure) {
        if (!lighting || typeof lighting.addLight !== 'function') return;
        const m = materialFor(structure);
        const iHH = structure.interiorH / 2;
        const mirror = structure.mirror || 1;
        // Priority 2 is intentionally below the player, projectiles, bosses,
        // candles, and pickups. Houses add mood but can never starve combat cues.
        const stateLight = houseStateDefinition(structure.blueprint, structure.state)?.light ?? 0.46;
        lighting.addLight(
            structure.x + mirror * structure.interiorW * 0.18,
            structure.y - iHH + 26,
            m.glowRadius,
            m.glow,
            structure.styleType === 'ruin' ? 0.30 : stateLight,
            2,
        );
        // One restrained window glow gives the facade a readable warm point.
        lighting.addLight(
            structure.x - mirror * structure.interiorW * 0.31,
            structure.y + iHH - structure.wallH * 0.42,
            82,
            m.glow,
            0.24,
            2,
        );
        if (structure.blueprint && structure.state === 'lit') {
            const bell = structure.blueprint.furniture.find((entry) => entry.id === 'ruin-bell');
            if (bell) lighting.addLight(
                structure.x + bell.x,
                structure.y + bell.y - 26,
                154,
                '#ff8b42',
                0.56,
                2,
            );
        }
    }

    _fillMaterialRect(ctx, structure, m, x, y, w, h, shade = 0) {
        const pat = getWallPattern(structure.styleType, ctx);
        ctx.fillStyle = pat || structure.palette?.base || '#56505a';
        ctx.fillRect(x, y, w, h);
        if (pat && structure.tint?.amt > 0.01) {
            ctx.save();
            ctx.globalAlpha = Math.min(0.24, structure.tint.amt * 0.55);
            ctx.fillStyle = structure.tint.color;
            ctx.fillRect(x, y, w, h);
            ctx.restore();
        }
        if (shade > 0) {
            ctx.fillStyle = `rgba(7, 8, 12, ${shade})`;
            ctx.fillRect(x, y, w, h);
        }
        ctx.strokeStyle = structure.palette?.edge || m.trimDark;
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, w, h);
    }

    _drawSplitWall(ctx, s, m, baseY, front) {
        if (s.blueprint) {
            const edge = front ? 'south' : 'north';
            const parts = s.blueprint.walls.filter((entry) =>
                entry.kind === 'shell' && entry.edge === edge
                && houseWallActive(s.blueprint, entry, s.state));
            for (const part of parts) {
                this._fillMaterialRect(
                    ctx,
                    s,
                    m,
                    part.x - part.hw,
                    baseY - s.wallH,
                    part.hw * 2,
                    s.wallH,
                    front ? 0.03 : 0.13,
                );
                ctx.fillStyle = s.palette?.top || m.trim;
                ctx.fillRect(part.x - part.hw, baseY - s.wallH, part.hw * 2, 8);
            }
            return;
        }
        const outHW = s.interiorW / 2 + s.wall;
        const gapHalf = s.door / 2;
        const H = s.wallH;
        const segW = outHW - gapHalf;
        this._fillMaterialRect(ctx, s, m, -outHW, baseY - H, segW, H, front ? 0.04 : 0.14);
        this._fillMaterialRect(ctx, s, m, gapHalf, baseY - H, segW, H, front ? 0.02 : 0.12);

        // One continuous coping language across the two wall halves.
        ctx.fillStyle = s.palette?.top || m.trim;
        ctx.fillRect(-outHW, baseY - H, segW, 8);
        ctx.fillRect(gapHalf, baseY - H, segW, 8);
        ctx.fillStyle = 'rgba(255,255,255,0.13)';
        ctx.fillRect(-outHW + 3, baseY - H + 2, Math.max(0, segW - 6), 2);
        ctx.fillRect(gapHalf + 3, baseY - H + 2, Math.max(0, segW - 6), 2);
    }

    _drawSideFace(ctx, s, m, x, backY, frontY, H, left) {
        const T = s.wall;
        this._fillMaterialRect(ctx, s, m, x, backY - H, T, frontY - backY + H, left ? 0.20 : 0.11);
        ctx.fillStyle = s.palette?.top || m.trim;
        ctx.fillRect(x, backY - H, T, 7);
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(left ? x + 2 : x + T - 5, backY - H + 8, 3, frontY - backY + H - 12);
    }

    _drawBlueprintSides(ctx, s, m) {
        const parts = s.blueprint.walls.filter((entry) =>
            entry.kind === 'shell'
            && (entry.edge === 'west' || entry.edge === 'east')
            && houseWallActive(s.blueprint, entry, s.state));
        for (const part of parts) {
            const x = part.x - part.hw;
            const y = part.y - part.hh - s.wallH;
            const w = part.hw * 2;
            const h = part.hh * 2 + s.wallH;
            this._fillMaterialRect(ctx, s, m, x, y, w, h, entryShade(part.edge));
            ctx.fillStyle = s.palette?.top || m.trim;
            ctx.fillRect(x, y, w, 7);
            ctx.fillStyle = 'rgba(255,255,255,0.10)';
            ctx.fillRect(part.edge === 'west' ? x + 2 : x + w - 5, y + 8, 3, h - 12);
        }
    }

    _drawDoorFrame(ctx, s, m, baseY, front, door = null) {
        const gapHalf = (door?.width || s.door) / 2;
        const H = s.wallH;
        const frameH = H * (front ? 0.76 : 0.68);
        const post = Math.max(7, s.wall * 0.34);
        const y = baseY - frameH;
        ctx.save();
        if (door) ctx.translate(door.x, 0);
        ctx.fillStyle = m.trimDark;
        ctx.fillRect(-gapHalf - post, y, post, frameH);
        ctx.fillRect(gapHalf, y, post, frameH);
        ctx.fillRect(-gapHalf - post, y - 5, s.door + post * 2, 13);
        ctx.fillStyle = m.trim;
        ctx.fillRect(-gapHalf - post + 3, y + 3, 4, frameH - 3);
        ctx.fillRect(gapHalf + 3, y + 3, 4, frameH - 3);
        ctx.fillRect(-gapHalf - post + 4, y - 2, s.door + post * 2 - 8, 5);

        // Rear opening is intentionally a rough breach/back gate; front is a
        // dressed entrance. Both remain fully open under the lintel.
        if (!front) {
            ctx.strokeStyle = m.trimDark;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(-gapHalf * 0.72, y + 9);
            ctx.lineTo(-gapHalf * 0.55, y + 20);
            ctx.lineTo(-gapHalf * 0.42, y + 10);
            ctx.stroke();
        }
        ctx.restore();
    }

    _drawWindow(ctx, m, x, y, w, h, kind = 'square') {
        ctx.fillStyle = m.trimDark;
        if (kind === 'slit') {
            roundedRect(ctx, x - w / 2, y - h / 2, w, h, w / 2);
            ctx.fill();
        } else {
            ctx.fillRect(x - w / 2 - 4, y - h / 2 - 4, w + 8, h + 8);
            ctx.fillStyle = m.window;
            ctx.fillRect(x - w / 2, y - h / 2, w, h);
            ctx.fillStyle = 'rgba(255,245,205,0.55)';
            ctx.fillRect(x - w / 2 + 3, y - h / 2 + 3, Math.max(2, w * 0.24), h - 6);
            ctx.strokeStyle = m.trimDark;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, y - h / 2); ctx.lineTo(x, y + h / 2);
            ctx.moveTo(x - w / 2, y); ctx.lineTo(x + w / 2, y);
            ctx.stroke();
            return;
        }
        ctx.fillStyle = m.window;
        roundedRect(ctx, x - w * 0.22, y - h * 0.38, w * 0.44, h * 0.72, w * 0.18);
        ctx.fill();
    }

    _drawRoof(ctx, s, m, backY, outHW, H) {
        const variant = s.variant || 0;
        const mirror = s.mirror || 1;
        const top = backY - H;
        if (s.styleType === 'cabin') {
            const peakX = mirror * (variant === 1 ? outHW * 0.18 : 0);
            const rise = 72 + variant * 10;
            if (s.blueprint && s.state === 'ruined') {
                // Exposed rafters replace the roof mass; the east breach below
                // is simultaneously absent from collision/nav/LOS.
                ctx.strokeStyle = m.roofDark;
                ctx.lineWidth = 11;
                ctx.lineCap = 'square';
                ctx.beginPath();
                ctx.moveTo(-outHW - 12, top + 20);
                ctx.lineTo(peakX, top - rise + 8);
                ctx.lineTo(outHW * 0.22, top + 18);
                ctx.moveTo(-outHW * 0.64, top + 8);
                ctx.lineTo(outHW * 0.46, top + 8);
                ctx.stroke();
                ctx.strokeStyle = m.roofLight;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(-outHW - 12, top + 17);
                ctx.lineTo(peakX, top - rise + 5);
                ctx.lineTo(outHW * 0.22, top + 15);
                ctx.stroke();
                return;
            }
            if (s.blueprint && s.state === 'damaged') {
                // A missing east lean-to wedge changes the silhouette while
                // retaining both authored escape doors.
                ctx.fillStyle = m.roofDark;
                ctx.beginPath();
                ctx.moveTo(-outHW - 22, top + 14);
                ctx.lineTo(peakX, top - rise);
                ctx.lineTo(outHW * 0.48, top + 8);
                ctx.lineTo(outHW * 0.30, top + 34);
                ctx.lineTo(-outHW - 10, top + 34);
                ctx.closePath(); ctx.fill();
                ctx.fillStyle = m.roof;
                ctx.beginPath();
                ctx.moveTo(-outHW - 10, top + 10);
                ctx.lineTo(peakX, top - rise + 8);
                ctx.lineTo(peakX, top + 27);
                ctx.lineTo(-outHW, top + 27);
                ctx.closePath(); ctx.fill();
                ctx.strokeStyle = m.roofLight;
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.moveTo(outHW * 0.33, top + 13);
                ctx.lineTo(outHW * 0.54, top - 4);
                ctx.lineTo(outHW * 0.43, top + 26);
                ctx.stroke();
                return;
            }
            ctx.fillStyle = m.roofDark;
            ctx.beginPath();
            ctx.moveTo(-outHW - 22, top + 12);
            ctx.lineTo(peakX, top - rise);
            ctx.lineTo(outHW + 22, top + 12);
            ctx.lineTo(outHW + 10, top + 34);
            ctx.lineTo(-outHW - 10, top + 34);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = m.roof;
            ctx.beginPath();
            ctx.moveTo(-outHW - 12, top + 9);
            ctx.lineTo(peakX, top - rise + 8);
            ctx.lineTo(peakX, top + 27);
            ctx.lineTo(-outHW - 4, top + 27);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = m.roofLight;
            for (let yy = top - rise + 20; yy < top + 24; yy += 17) {
                const half = Math.max(18, (yy - (top - rise)) / rise * outHW);
                ctx.fillRect(peakX - half, yy, half * 2, 3);
            }
            // Chimney shifts by the coordinate-derived mirror/variant.
            const cx = mirror * outHW * (variant === 2 ? 0.58 : 0.42);
            ctx.fillStyle = '#49372f';
            ctx.fillRect(cx - 13, top - rise * 0.66, 26, 54);
            ctx.fillStyle = '#7f6150';
            ctx.fillRect(cx - 17, top - rise * 0.66, 34, 8);
        } else if (s.styleType === 'keep') {
            const y = top - 30;
            ctx.fillStyle = m.roofDark;
            ctx.fillRect(-outHW - 10, y, outHW * 2 + 20, 46);
            ctx.fillStyle = m.roof;
            ctx.fillRect(-outHW - 5, y + 5, outHW * 2 + 10, 34);
            const crenels = 7 + variant;
            const step = (outHW * 2) / crenels;
            ctx.fillStyle = m.roofLight;
            for (let i = 0; i <= crenels; i++) {
                ctx.fillRect(-outHW - 7 + i * step - 7, y - 16 - (i % 3 === variant ? 4 : 0), 16, 23);
            }
            // Unequal corner towers give each seed a less stamp-like skyline.
            const towerX = mirror * (outHW - 21);
            ctx.fillStyle = m.roofDark;
            ctx.fillRect(towerX - 24, y - 36 - variant * 5, 48, 54 + variant * 5);
            ctx.fillStyle = m.roofLight;
            ctx.fillRect(towerX - 28, y - 39 - variant * 5, 56, 8);
        } else if (s.styleType === 'adobe') {
            const y = top - 22;
            ctx.fillStyle = m.roofDark;
            roundedRect(ctx, -outHW - 8, y, outHW * 2 + 16, 42, 12);
            ctx.fill();
            ctx.fillStyle = m.roof;
            roundedRect(ctx, -outHW, y + 5, outHW * 2, 30, 10);
            ctx.fill();
            const domeX = mirror * outHW * (variant === 2 ? 0.38 : 0.12);
            const domeR = 38 + variant * 7;
            ctx.fillStyle = m.roofDark;
            ctx.beginPath(); ctx.arc(domeX, y + 4, domeR + 5, Math.PI, 0); ctx.fill();
            ctx.fillStyle = m.roofLight;
            ctx.beginPath(); ctx.arc(domeX, y + 4, domeR, Math.PI, 0); ctx.fill();
            ctx.fillStyle = m.trim;
            ctx.fillRect(domeX - domeR - 4, y + 1, domeR * 2 + 8, 7);
        } else {
            // Ruins keep an intentionally broken, asymmetrical crown instead of
            // pretending the open court has a complete roof.
            const ridge = [
                [-outHW - 5, top + 16],
                [-outHW * 0.78, top - 30 - variant * 7],
                [-outHW * 0.48, top - 8],
                [-outHW * 0.16, top - 54 + variant * 5],
                [outHW * 0.12, top - 12],
                [outHW * 0.42, top - 39 - variant * 4],
                [outHW * 0.67, top - 4],
                [outHW + 5, top - 25],
            ];
            ctx.fillStyle = m.roofDark;
            ctx.beginPath();
            ctx.moveTo(ridge[0][0], top + 28);
            for (const p of ridge) ctx.lineTo(p[0], p[1]);
            ctx.lineTo(outHW + 6, top + 30);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = m.roofLight;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ridge.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
            ctx.stroke();
        }
    }

    _drawRearDetails(ctx, s, m, baseY) {
        const H = s.wallH;
        const x = (s.mirror || 1) * -(s.interiorW * 0.31);
        if (s.styleType === 'keep') {
            this._drawWindow(ctx, m, x, baseY - H * 0.48, 15, 48, 'slit');
        } else if (s.styleType === 'ruin') {
            ctx.strokeStyle = m.window;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(x, baseY - H * 0.45, 16, Math.PI, 0);
            ctx.lineTo(x + 16, baseY - H * 0.20);
            ctx.moveTo(x - 16, baseY - H * 0.45);
            ctx.lineTo(x - 16, baseY - H * 0.20);
            ctx.stroke();
        } else {
            this._drawWindow(ctx, m, x, baseY - H * 0.44, 32, 36);
        }
    }

    _drawFrontDetails(ctx, s, m, baseY) {
        const H = s.wallH;
        const mirror = s.mirror || 1;
        const outHW = s.interiorW / 2 + s.wall;
        const wx = -mirror * s.interiorW * 0.31;

        if (s.styleType === 'cabin') {
            this._drawWindow(ctx, m, wx, baseY - H * 0.43, 34, 38);
            // Timber braces and a variant awning sell an actual facade.
            ctx.strokeStyle = m.trimDark;
            ctx.lineWidth = 7;
            ctx.beginPath();
            ctx.moveTo(-outHW + 12, baseY - H + 14); ctx.lineTo(-s.door / 2 - 12, baseY - 8);
            ctx.moveTo(outHW - 12, baseY - H + 14); ctx.lineTo(s.door / 2 + 12, baseY - 8);
            ctx.stroke();
            if (s.variant === 1) {
                ctx.fillStyle = m.roofDark;
                ctx.beginPath();
                ctx.moveTo(-s.door * 0.65, baseY - H * 0.82);
                ctx.lineTo(s.door * 0.65, baseY - H * 0.82);
                ctx.lineTo(s.door * 0.53, baseY - H * 0.69);
                ctx.lineTo(-s.door * 0.53, baseY - H * 0.69);
                ctx.closePath(); ctx.fill();
            }
        } else if (s.styleType === 'keep') {
            this._drawWindow(ctx, m, wx, baseY - H * 0.46, 15, 52, 'slit');
            const bx = mirror * (s.door / 2 + 24);
            ctx.fillStyle = s.variant === 2 ? '#7d3348' : '#35577a';
            ctx.fillRect(bx, baseY - H * 0.76, 34, H * 0.48);
            ctx.fillStyle = '#d6ad58';
            ctx.fillRect(bx + 6, baseY - H * 0.68, 22, 5);
            ctx.beginPath();
            ctx.moveTo(bx, baseY - H * 0.28);
            ctx.lineTo(bx + 17, baseY - H * 0.18);
            ctx.lineTo(bx + 34, baseY - H * 0.28);
            ctx.closePath(); ctx.fill();
        } else if (s.styleType === 'adobe') {
            this._drawWindow(ctx, m, wx, baseY - H * 0.42, 28, 30);
            // Woven shade over the front entrance.
            ctx.fillStyle = '#6e3f27';
            ctx.beginPath();
            ctx.moveTo(-s.door * 0.62, baseY - H * 0.82);
            ctx.lineTo(s.door * 0.62, baseY - H * 0.82);
            ctx.lineTo(s.door * 0.50, baseY - H * 0.68);
            ctx.lineTo(-s.door * 0.50, baseY - H * 0.68);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = m.trim;
            ctx.lineWidth = 3;
            for (let x = -s.door * 0.48; x < s.door * 0.5; x += 18) {
                ctx.beginPath(); ctx.moveTo(x, baseY - H * 0.80); ctx.lineTo(x - 8, baseY - H * 0.70); ctx.stroke();
            }
            // Two pots outside the collision gap.
            for (const side of [-1, 1]) {
                const px = side * (s.door / 2 + 24);
                ctx.fillStyle = side === mirror ? '#b75e38' : '#87492f';
                ctx.beginPath();
                ctx.ellipse(px, baseY - 4, 13, 7, 0, 0, Math.PI * 2);
                ctx.fillRect(px - 10, baseY - 21, 20, 17);
                ctx.fill();
            }
        } else {
            // Ruin cracks + hanging vine; no fake glowing domestic window.
            ctx.strokeStyle = m.trimDark;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(wx - 18, baseY - H * 0.85);
            ctx.lineTo(wx + 4, baseY - H * 0.63);
            ctx.lineTo(wx - 7, baseY - H * 0.44);
            ctx.lineTo(wx + 16, baseY - H * 0.25);
            ctx.stroke();
            ctx.strokeStyle = '#536341';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(mirror * outHW * 0.72, baseY - H + 8);
            ctx.quadraticCurveTo(mirror * outHW * 0.55, baseY - H * 0.55, mirror * outHW * 0.70, baseY - 18);
            ctx.stroke();
        }
    }
}

export const structureRenderer = new StructureRenderer();
