// A single placed map object (wall / building / prop).
//
// An Obstacle is mostly data: a position plus a reference to its archetype
// definition from mapObjects.js. The collision footprint sits at (x, y) (the
// object's "feet"); the procedural art is drawn UPWARD from that baseline so
// the object can occlude entities that stand behind it.
//
// Drawing is direct Canvas2D (no cached sprite) — only on-screen obstacles are
// drawn each frame and a world holds well under a hundred, so it's cheap and
// keeps the art data-driven via the archetype palette.

import { footprintDepth } from '../content/mapObjects.js';
import {
    getObstacleSprite,
    getWallPattern,
    getFloorDecal,
    getHousePropSprite,
} from '../assets/ObstacleSprites.js';
import { getHouseBlueprint } from '../content/houseBlueprints.js';

export class Obstacle {
    constructor(def, x, y) {
        this.def = def;
        this.type = def.type;
        this.x = x;
        this.y = y;            // base / footprint center (the "feet" line)
        this.shape = def.shape;
        this.blocksLOS = def.blocksLOS !== false;
        // Baseline used for painter's-order y-sorting against entities.
        this.baseY = y + footprintDepth(def);
    }

    // Axis-aligned bounding box of the COLLISION footprint (world space).
    bounds() {
        const c = this.def.col;
        if (this.shape === 'circle') {
            return { minX: this.x - c.r, maxX: this.x + c.r, minY: this.y - c.r, maxY: this.y + c.r };
        }
        return { minX: this.x - c.hw, maxX: this.x + c.hw, minY: this.y - c.hh, maxY: this.y + c.hh };
    }

    draw(ctx) {
        // Building collision segments are now skinned once by StructureRenderer.
        // Keeping these Obstacle instances invisible preserves every physical
        // wall/LOS/nav query while removing six shadows, seams, caps, and outlines
        // that previously made one house look like unrelated slabs.
        if (this.type === 'buildingWall' && this.structureId && !this.partition) return;
        const size = this.def.size;
        // Per-instance palette wins (biome tinting / building walls set it);
        // otherwise fall back to the archetype's own palette.
        const palette = this.palette || this.def.palette;
        const w = size.w, h = size.h;
        ctx.save();
        ctx.translate(this.x, this.y);

        // Interior floor decal: a flat lived-in floor (rug + hearth + furniture),
        // drawn centered with NO grounding shadow (it lies ON the ground).
        if (this.type === 'buildingFloor') {
            this._drawBuildingFloor(ctx, w, h, palette);
            ctx.restore();
            return;
        }

        if (this.type === 'buildingFurnishing') {
            this._drawBuildingFurnishing(ctx, w, h, palette);
            ctx.restore();
            return;
        }

        // Grounding shadow at the base.
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        ctx.beginPath();
        ctx.ellipse(0, 0, w * 0.42, Math.max(8, w * 0.13), 0, 0, Math.PI * 2);
        ctx.fill();

        // AI sprite (hi-bit pixel art, biome-tinted), when one loaded for this
        // archetype: blit it into the exact box the procedural art fills —
        // bottom anchored at the footprint — so sorting/occlusion/collision
        // stay untouched. The procedural switch below is the fallback.
        const spr = getObstacleSprite(this.type, this.tint);
        if (spr) {
            ctx.drawImage(spr, -w * 0.5, -h, w, h);
            ctx.restore();
            return;
        }

        switch (this.type) {
            case 'ruinedWall':   this._drawWall(ctx, w, h, palette); break;
            case 'stoneBlock':   this._drawBlock(ctx, w, h, palette); break;
            case 'pillar':       this._drawPillar(ctx, w, h, palette); break;
            case 'brokenTower':  this._drawTower(ctx, w, h, palette); break;
            case 'graveMarker':  this._drawGrave(ctx, w, h, palette); break;
            case 'tree':         this._drawTree(ctx, w, h, palette); break;
            case 'fence':        this._drawFence(ctx, w, h, palette); break;
            case 'barricade':    this._drawBarricade(ctx, w, h, palette); break;
            case 'crate':        this._drawCrate(ctx, w, h, palette); break;
            case 'barrel':       this._drawBarrel(ctx, w, h, palette); break;
            case 'well':         this._drawWell(ctx, w, h, palette); break;
            case 'statue':       this._drawStatue(ctx, w, h, palette); break;
            case 'cactus':       this._drawCactus(ctx, w, h, palette); break;
            case 'buildingWall': this._drawBuildingWall(ctx, w, h, palette); break;
            default:             this._drawBlock(ctx, w, h, palette); break;
        }
        ctx.restore();
    }

    _drawWall(ctx, w, h, p) {
        const hw = w * 0.5;
        ctx.fillStyle = p.base;
        ctx.fillRect(-hw, -h, w, h);
        // Crenellated broken top.
        ctx.fillStyle = '#0c0a10';
        const notches = 4;
        const nw = w / (notches * 2 - 1);
        for (let i = 0; i < notches; i++) {
            if (i % 2 === 1) ctx.fillRect(-hw + i * nw * 2 - nw, -h, nw, h * 0.18);
        }
        // Top highlight + mortar lines.
        ctx.fillStyle = p.top;
        ctx.fillRect(-hw, -h, w, h * 0.10);
        ctx.strokeStyle = p.edge;
        ctx.lineWidth = 3;
        for (let yy = -h * 0.7; yy < 0; yy += h * 0.28) {
            ctx.beginPath(); ctx.moveTo(-hw, yy); ctx.lineTo(hw, yy); ctx.stroke();
        }
        ctx.strokeRect(-hw, -h, w, h);
    }

    _drawBlock(ctx, w, h, p) {
        const hw = w * 0.5;
        ctx.fillStyle = p.base;
        ctx.fillRect(-hw, -h, w, h);
        ctx.fillStyle = p.top;
        ctx.beginPath();
        ctx.moveTo(-hw, -h); ctx.lineTo(-hw + w * 0.16, -h - h * 0.22);
        ctx.lineTo(hw + w * 0.16, -h - h * 0.22); ctx.lineTo(hw, -h); ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = p.edge; ctx.lineWidth = 3;
        ctx.strokeRect(-hw, -h, w, h);
    }

    _drawPillar(ctx, w, h, p) {
        const hw = w * 0.34;
        ctx.fillStyle = p.base;
        ctx.fillRect(-hw, -h, hw * 2, h);
        // Fluting.
        ctx.strokeStyle = p.edge; ctx.lineWidth = 2;
        for (let i = -1; i <= 1; i++) {
            ctx.beginPath(); ctx.moveTo(i * hw * 0.5, -h); ctx.lineTo(i * hw * 0.5, 0); ctx.stroke();
        }
        // Capital + broken top.
        ctx.fillStyle = p.top;
        ctx.fillRect(-hw * 1.4, -h, hw * 2.8, h * 0.08);
        ctx.fillStyle = '#0c0a10';
        ctx.beginPath();
        ctx.moveTo(-hw, -h); ctx.lineTo(0, -h - h * 0.06); ctx.lineTo(hw, -h); ctx.closePath();
        ctx.fill();
    }

    _drawTower(ctx, w, h, p) {
        const hw = w * 0.46;
        ctx.fillStyle = p.base;
        ctx.beginPath();
        ctx.moveTo(-hw, 0); ctx.lineTo(-hw * 0.82, -h); ctx.lineTo(hw * 0.82, -h);
        ctx.lineTo(hw, 0); ctx.closePath(); ctx.fill();
        // Jagged broken crown.
        ctx.fillStyle = '#0c0a10';
        ctx.beginPath();
        ctx.moveTo(-hw * 0.82, -h);
        ctx.lineTo(-hw * 0.5, -h + h * 0.10);
        ctx.lineTo(-hw * 0.1, -h - h * 0.05);
        ctx.lineTo(hw * 0.3, -h + h * 0.08);
        ctx.lineTo(hw * 0.82, -h - h * 0.02);
        ctx.lineTo(hw * 0.82, -h + h * 0.14);
        ctx.lineTo(-hw * 0.82, -h + h * 0.14);
        ctx.closePath(); ctx.fill();
        // Windows.
        ctx.fillStyle = '#15121b';
        for (let i = 0; i < 3; i++) {
            const yy = -h * (0.3 + i * 0.22);
            ctx.fillRect(-hw * 0.18, yy, hw * 0.36, h * 0.10);
        }
        ctx.strokeStyle = p.edge; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-hw, 0); ctx.lineTo(-hw * 0.82, -h); ctx.moveTo(hw, 0); ctx.lineTo(hw * 0.82, -h);
        ctx.stroke();
    }

    _drawGrave(ctx, w, h, p) {
        const hw = w * 0.32;
        // mound
        ctx.fillStyle = '#2a2620';
        ctx.beginPath(); ctx.ellipse(0, 0, w * 0.36, h * 0.10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = p.base;
        ctx.beginPath();
        ctx.moveTo(-hw, 0); ctx.lineTo(-hw, -h * 0.7);
        ctx.arc(0, -h * 0.7, hw, Math.PI, 0); ctx.lineTo(hw, 0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = p.edge; ctx.lineWidth = 3; ctx.stroke();
        ctx.strokeStyle = p.edge; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(0, -h * 0.62); ctx.lineTo(0, -h * 0.34);
        ctx.moveTo(-hw * 0.5, -h * 0.5); ctx.lineTo(hw * 0.5, -h * 0.5); ctx.stroke();
    }

    _drawTree(ctx, w, h, p) {
        // trunk
        ctx.fillStyle = p.base;
        ctx.fillRect(-w * 0.07, -h * 0.5, w * 0.14, h * 0.5);
        // canopy (layered blobs)
        const cy = -h * 0.62, cr = w * 0.42;
        ctx.fillStyle = p.edge;
        ctx.beginPath(); ctx.arc(0, cy + 6, cr, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = p.top;
        ctx.beginPath(); ctx.arc(-cr * 0.4, cy, cr * 0.7, 0, Math.PI * 2);
        ctx.arc(cr * 0.4, cy, cr * 0.7, 0, Math.PI * 2);
        ctx.arc(0, cy - cr * 0.4, cr * 0.7, 0, Math.PI * 2); ctx.fill();
    }

    _drawFence(ctx, w, h, p) {
        const hw = w * 0.5;
        ctx.strokeStyle = p.base; ctx.lineWidth = 8; ctx.lineCap = 'round';
        // posts
        for (let i = 0; i <= 4; i++) {
            const px = -hw + (i / 4) * w;
            ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, -h); ctx.stroke();
        }
        // rails
        ctx.lineWidth = 6; ctx.strokeStyle = p.top;
        ctx.beginPath(); ctx.moveTo(-hw, -h * 0.4); ctx.lineTo(hw, -h * 0.4);
        ctx.moveTo(-hw, -h * 0.8); ctx.lineTo(hw, -h * 0.8); ctx.stroke();
    }

    _drawBarricade(ctx, w, h, p) {
        const hw = w * 0.5;
        ctx.strokeStyle = p.base; ctx.lineWidth = 14; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-hw, 0); ctx.lineTo(hw, -h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(hw, 0); ctx.lineTo(-hw, -h); ctx.stroke();
        ctx.strokeStyle = p.top; ctx.lineWidth = 12;
        ctx.beginPath(); ctx.moveTo(-hw, -h * 0.5); ctx.lineTo(hw, -h * 0.5); ctx.stroke();
    }

    _drawCrate(ctx, w, h, p) {
        const hw = w * 0.5;
        ctx.fillStyle = p.base; ctx.fillRect(-hw, -h, w, h);
        // Lid highlight (slight top face).
        ctx.fillStyle = p.top;
        ctx.beginPath();
        ctx.moveTo(-hw, -h); ctx.lineTo(-hw + w * 0.14, -h - h * 0.16);
        ctx.lineTo(hw + w * 0.14, -h - h * 0.16); ctx.lineTo(hw, -h); ctx.closePath(); ctx.fill();
        // Plank cross-bracing.
        ctx.strokeStyle = p.edge; ctx.lineWidth = 3;
        ctx.strokeRect(-hw, -h, w, h);
        ctx.beginPath();
        ctx.moveTo(-hw, -h); ctx.lineTo(hw, 0); ctx.moveTo(hw, -h); ctx.lineTo(-hw, 0);
        ctx.moveTo(-hw, -h * 0.5); ctx.lineTo(hw, -h * 0.5); ctx.stroke();
    }

    _drawBarrel(ctx, w, h, p) {
        const hw = w * 0.42;
        // Body (slightly bulged staves).
        ctx.fillStyle = p.base;
        ctx.beginPath();
        ctx.moveTo(-hw, -h * 0.04);
        ctx.quadraticCurveTo(-hw * 1.16, -h * 0.5, -hw, -h * 0.96);
        ctx.lineTo(hw, -h * 0.96);
        ctx.quadraticCurveTo(hw * 1.16, -h * 0.5, hw, -h * 0.04);
        ctx.closePath(); ctx.fill();
        // Top ellipse.
        ctx.fillStyle = p.top;
        ctx.beginPath(); ctx.ellipse(0, -h * 0.96, hw, hw * 0.34, 0, 0, Math.PI * 2); ctx.fill();
        // Hoops.
        ctx.strokeStyle = p.edge; ctx.lineWidth = 4;
        for (const yy of [-h * 0.28, -h * 0.66]) {
            ctx.beginPath(); ctx.moveTo(-hw * 1.08, yy); ctx.lineTo(hw * 1.08, yy); ctx.stroke();
        }
    }

    _drawWell(ctx, w, h, p) {
        const hw = w * 0.42;
        // Stone ring base.
        ctx.fillStyle = p.base;
        ctx.beginPath(); ctx.ellipse(0, -h * 0.18, hw, hw * 0.5, 0, 0, Math.PI * 2); ctx.fill();
        // Dark water mouth.
        ctx.fillStyle = '#0b0d12';
        ctx.beginPath(); ctx.ellipse(0, -h * 0.22, hw * 0.66, hw * 0.32, 0, 0, Math.PI * 2); ctx.fill();
        // Rim highlight.
        ctx.strokeStyle = p.top; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.ellipse(0, -h * 0.18, hw, hw * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
        // Posts + little roof.
        ctx.strokeStyle = p.edge; ctx.lineWidth = 7; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-hw * 0.78, -h * 0.3); ctx.lineTo(-hw * 0.78, -h * 0.92);
        ctx.moveTo(hw * 0.78, -h * 0.3); ctx.lineTo(hw * 0.78, -h * 0.92); ctx.stroke();
        ctx.fillStyle = p.top;
        ctx.beginPath();
        ctx.moveTo(-hw * 1.1, -h * 0.86); ctx.lineTo(0, -h * 1.04);
        ctx.lineTo(hw * 1.1, -h * 0.86); ctx.closePath(); ctx.fill();
    }

    _drawStatue(ctx, w, h, p) {
        const hw = w * 0.5;
        // Plinth.
        ctx.fillStyle = p.edge; ctx.fillRect(-hw, -h * 0.18, w, h * 0.18);
        ctx.fillStyle = p.base; ctx.fillRect(-hw * 0.72, -h * 0.26, w * 0.72, h * 0.08);
        // Figure (robed, weathered).
        ctx.fillStyle = p.base;
        ctx.beginPath();
        ctx.moveTo(-hw * 0.5, -h * 0.26);
        ctx.lineTo(-hw * 0.34, -h * 0.86);
        ctx.quadraticCurveTo(0, -h * 1.02, hw * 0.34, -h * 0.86);
        ctx.lineTo(hw * 0.5, -h * 0.26); ctx.closePath(); ctx.fill();
        // Head.
        ctx.fillStyle = p.top;
        ctx.beginPath(); ctx.arc(0, -h * 0.88, hw * 0.22, 0, Math.PI * 2); ctx.fill();
        // Crack + shading.
        ctx.strokeStyle = p.edge; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(hw * 0.06, -h * 0.8); ctx.lineTo(-hw * 0.04, -h * 0.5); ctx.lineTo(hw * 0.08, -h * 0.3); ctx.stroke();
    }

    _drawCactus(ctx, w, h, p) {
        const armW = w * 0.16;
        // Trunk.
        ctx.fillStyle = p.base;
        ctx.fillRect(-armW * 0.5, -h, armW, h);
        ctx.beginPath(); ctx.arc(0, -h, armW * 0.5, Math.PI, 0); ctx.fill();
        // Two arms.
        ctx.beginPath();
        ctx.moveTo(-armW * 0.5, -h * 0.62);
        ctx.lineTo(-w * 0.34, -h * 0.62);
        ctx.lineTo(-w * 0.34, -h * 0.88);
        ctx.lineTo(-w * 0.34 + armW, -h * 0.88);
        ctx.lineTo(-w * 0.34 + armW, -h * 0.6 + armW);
        ctx.lineTo(-armW * 0.5, -h * 0.46); ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(armW * 0.5, -h * 0.5);
        ctx.lineTo(w * 0.34, -h * 0.5);
        ctx.lineTo(w * 0.34, -h * 0.78);
        ctx.lineTo(w * 0.34 - armW, -h * 0.78);
        ctx.lineTo(w * 0.34 - armW, -h * 0.48 + armW);
        ctx.lineTo(armW * 0.5, -h * 0.34); ctx.closePath(); ctx.fill();
        // Ridge highlight + spines.
        ctx.strokeStyle = p.top; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, -h * 0.96); ctx.lineTo(0, -h * 0.1); ctx.stroke();
        ctx.strokeStyle = p.edge; ctx.lineWidth = 1.5;
        for (let yy = -h * 0.85; yy < -h * 0.1; yy += h * 0.16) {
            ctx.beginPath(); ctx.moveTo(-armW * 0.5, yy); ctx.lineTo(-armW * 0.85, yy - 4);
            ctx.moveTo(armW * 0.5, yy); ctx.lineTo(armW * 0.85, yy - 4); ctx.stroke();
        }
    }

    // A single wall segment of an enterable building: a clean masonry slab with
    // a coping cap, mortar courses, and a lit top edge. Several of these (with a
    // doorway gap) form a building the player walks in and out of.
    _drawBuildingWall(ctx, w, h, p) {
        const hw = w * 0.5;
        // AI wall texture for this building style (cabin timber / ruin stone /
        // keep brick / adobe clay), used as a repeating pattern so it skins
        // wall segments of ANY size. Falls back to the flat palette fill.
        // The pattern anchors at the segment's local origin — walls are
        // separate rects so per-segment anchoring is invisible in play.
        const pat = getWallPattern(this.def.styleType, ctx);
        // VERTICAL side wall (collision is tall + thin): the baseline-up slab
        // below is for wide horizontal (front/back) walls and would render a
        // tall side wall as a short stub. Instead draw a strip that runs the
        // FULL ring silhouette — from the back wall's top edge down to the
        // front wall's base — so the four segments read as ONE building shell
        // (the front slab, drawn later in painter's order, covers the strip's
        // bottom end; the strip covers the back slab's corner end).
        const col = this.def.col;
        if (col && col.hh > col.hw * 1.6) {
            const sw = col.hw * 2;                 // wall thickness
            const yTop = -col.hh - sw / 2 - h;     // back wall's top edge
            const yBot = col.hh + sw / 2;          // front wall's base line
            const sh = yBot - yTop;
            ctx.fillStyle = pat || p.base;
            ctx.fillRect(-sw / 2, yTop, sw, sh);
            if (pat) {
                // Biome tint wash over the (untinted) texture, so the body
                // matches the tinted coping/edges + tinted prop sprites.
                if (this.tint && this.tint.amt > 0.01) {
                    ctx.save();
                    ctx.globalAlpha = this.tint.amt;
                    ctx.fillStyle = this.tint.color;
                    ctx.fillRect(-sw / 2, yTop, sw, sh);
                    ctx.restore();
                }
                // Gentle shade so the side reads a step dimmer than the lit
                // front face without looking like a different material.
                ctx.fillStyle = 'rgba(10,8,14,0.14)';
                ctx.fillRect(-sw / 2, yTop, sw, sh);
                // Edge highlights down both sides tie into the front coping.
                ctx.save();
                ctx.globalAlpha = 0.30;
                ctx.fillStyle = p.top;
                ctx.fillRect(-sw / 2, yTop, 5, sh);
                ctx.fillRect(sw / 2 - 5, yTop, 5, sh);
                ctx.restore();
                // Coping cap across the strip's top — continues the crown
                // line of the back wall across the corner.
                ctx.fillStyle = p.top;
                ctx.fillRect(-sw / 2, yTop, sw, 10);
            } else {
                // Lit top edge (a thin coping down the strip's outer side).
                ctx.fillStyle = p.top;
                ctx.fillRect(-sw / 2, yTop, Math.max(4, sw * 0.30), sh);
                // Mortar courses across the strip.
                ctx.strokeStyle = p.edge; ctx.lineWidth = 2;
                for (let yy = yTop + 16; yy < yBot - 2; yy += 22) {
                    ctx.beginPath(); ctx.moveTo(-sw / 2, yy); ctx.lineTo(sw / 2, yy); ctx.stroke();
                }
            }
            ctx.strokeStyle = p.edge;
            ctx.lineWidth = 3; ctx.strokeRect(-sw / 2, yTop, sw, sh);
            return;
        }
        // Body.
        ctx.fillStyle = pat || p.base;
        ctx.fillRect(-hw, -h, w, h);
        // Biome tint wash over the untinted texture (matches coping/props).
        if (pat && this.tint && this.tint.amt > 0.01) {
            ctx.save();
            ctx.globalAlpha = this.tint.amt;
            ctx.fillStyle = this.tint.color;
            ctx.fillRect(-hw, -h, w, h);
            ctx.restore();
        }
        // Lit top face (coping) — gives the wall thickness.
        ctx.fillStyle = p.top;
        ctx.beginPath();
        ctx.moveTo(-hw, -h); ctx.lineTo(-hw + 10, -h - 14);
        ctx.lineTo(hw + 10, -h - 14); ctx.lineTo(hw, -h); ctx.closePath(); ctx.fill();
        ctx.fillRect(-hw, -h, w, Math.max(6, h * 0.07));
        if (!pat) {
            // Mortar courses (horizontal) — the texture brings its own.
            ctx.strokeStyle = p.edge; ctx.lineWidth = 2;
            for (let yy = -h * 0.78; yy < -2; yy += h * 0.2) {
                ctx.beginPath(); ctx.moveTo(-hw, yy); ctx.lineTo(hw, yy); ctx.stroke();
            }
            // A couple of vertical joints for wider segments.
            if (w > 120) {
                for (let xx = -hw + w / 3; xx < hw; xx += w / 3) {
                    ctx.beginPath(); ctx.moveTo(xx, -h * 0.9); ctx.lineTo(xx, 0); ctx.stroke();
                }
            }
        }
        ctx.strokeStyle = p.edge;
        ctx.lineWidth = 3; ctx.strokeRect(-hw, -h, w, h);
    }

    // Interior floor of an enterable house: a plank floor with a woven rug, a
    // glowing hearth at the back wall, and a small table — so a house reads as
    // lived-in. Drawn centered (origin = interior center); never collides.
    _drawBuildingFloor(ctx, w, h, p) {
        const hw = w / 2, hh = h / 2;
        const blueprint = getHouseBlueprint(this.def.blueprintId);
        if (blueprint) {
            const pattern = getWallPattern(blueprint.floor?.materialStyle || this.def.styleType, ctx);
            ctx.fillStyle = pattern || '#4b3829';
            ctx.fillRect(-hw, -hh, w, h);

            // Each authored room gets a restrained material grade. These are
            // gameplay zones from the shared blueprint, not a second visual
            // layout, and the Wick Hall overlay makes the clear circulation
            // spine readable without labels or placeholder art.
            for (const room of blueprint.rooms || []) {
                if (!room.floorTone) continue;
                ctx.save();
                ctx.globalAlpha = room.overlay ? 0.22 : 0.16;
                ctx.fillStyle = room.floorTone;
                ctx.fillRect(room.x - room.w / 2, room.y - room.h / 2, room.w, room.h);
                ctx.restore();
            }
            const decalDef = blueprint.floor?.decal;
            const decal = getFloorDecal(blueprint.floor?.materialStyle || this.def.styleType);
            if (decal && decalDef) {
                ctx.drawImage(
                    decal,
                    decalDef.x - decalDef.w / 2,
                    decalDef.y - decalDef.h / 2,
                    decalDef.w,
                    decalDef.h,
                );
            }
            if (this.tint && this.tint.amt > 0.01) {
                ctx.save();
                ctx.globalAlpha = Math.min(0.16, this.tint.amt * 0.45);
                ctx.fillStyle = this.tint.color;
                ctx.fillRect(-hw, -hh, w, h);
                ctx.restore();
            }
            return;
        }
        // AI interior decal for this building style (plank+rug+hearth etc.),
        // scaled to the interior; procedural floor below is the fallback.
        const decal = getFloorDecal(this.def.styleType);
        if (decal) {
            ctx.drawImage(decal, -hw, -hh, w, h);
            // Biome tint wash so the interior matches the tinted walls/props.
            if (this.tint && this.tint.amt > 0.01) {
                ctx.save();
                ctx.globalAlpha = this.tint.amt;
                ctx.fillStyle = this.tint.color;
                ctx.fillRect(-hw, -hh, w, h);
                ctx.restore();
            }
            return;
        }
        // Plank floor (slightly inset so the walls frame it).
        ctx.fillStyle = '#5a4632';
        ctx.fillRect(-hw + 6, -hh + 6, w - 12, h - 12);
        ctx.strokeStyle = 'rgba(30,22,14,0.5)';
        ctx.lineWidth = 2;
        for (let yy = -hh + 6 + 22; yy < hh - 6; yy += 22) {
            ctx.beginPath(); ctx.moveTo(-hw + 6, yy); ctx.lineTo(hw - 6, yy); ctx.stroke();
        }
        // Woven rug, centered.
        const rw = w * 0.42, rh = h * 0.34;
        ctx.fillStyle = '#7a2d3a';
        ctx.fillRect(-rw / 2, -rh / 2, rw, rh);
        ctx.strokeStyle = '#d9a23c'; ctx.lineWidth = 3;
        ctx.strokeRect(-rw / 2 + 5, -rh / 2 + 5, rw - 10, rh - 10);
        ctx.fillStyle = '#9a3a48';
        ctx.fillRect(-rw / 2 + 12, -rh / 2 + 12, rw - 24, rh - 24);

        // Hearth at the back (top) wall: a stone fireplace with a warm glow.
        const hx = 0, hy = -hh + 16;
        const g = ctx.createRadialGradient(hx, hy, 4, hx, hy, 46);
        g.addColorStop(0, 'rgba(255,170,70,0.55)');
        g.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(hx, hy, 46, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = p.base || '#6b6f78';
        ctx.fillRect(hx - 26, hy - 8, 52, 20);
        ctx.fillStyle = '#ff8a3c';
        ctx.fillRect(hx - 14, hy - 2, 28, 12);
        ctx.fillStyle = '#ffd24a';
        ctx.fillRect(hx - 7, hy + 1, 14, 8);

        // A small table + stool to one side.
        const tx = hw * 0.5, ty = hh * 0.35;
        ctx.fillStyle = '#6e5436';
        ctx.fillRect(tx - 22, ty - 14, 44, 28);
        ctx.fillStyle = '#85643f';
        ctx.fillRect(tx - 22, ty - 14, 44, 6);
        ctx.fillStyle = '#5a4632';
        ctx.beginPath(); ctx.arc(tx - 36, ty + 6, 9, 0, Math.PI * 2); ctx.fill();
    }

    _drawBuildingFurnishing(ctx, w, h, p) {
        const key = this.def.sprite;
        const sprite = key === 'crate' || key === 'barrel'
            ? getObstacleSprite(key, this.tint)
            : getHousePropSprite(key);
        if (sprite) {
            ctx.drawImage(sprite, -w / 2, -h, w, h);
            return;
        }
        // Never-rejecting raster loaders keep this material fallback as the
        // resilience tier; it is deliberately generic and collision-faithful.
        this._drawBlock(ctx, w, h, p || { base: '#5c4430', top: '#86643f', edge: '#2d2118' });
    }
}
