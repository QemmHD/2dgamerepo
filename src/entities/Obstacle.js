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
        const { size, palette } = this.def;
        const w = size.w, h = size.h;
        ctx.save();
        ctx.translate(this.x, this.y);

        // Grounding shadow at the base.
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        ctx.beginPath();
        ctx.ellipse(0, 0, w * 0.42, Math.max(8, w * 0.13), 0, 0, Math.PI * 2);
        ctx.fill();

        switch (this.type) {
            case 'ruinedWall':  this._drawWall(ctx, w, h, palette); break;
            case 'stoneBlock':  this._drawBlock(ctx, w, h, palette); break;
            case 'pillar':      this._drawPillar(ctx, w, h, palette); break;
            case 'brokenTower': this._drawTower(ctx, w, h, palette); break;
            case 'graveMarker': this._drawGrave(ctx, w, h, palette); break;
            case 'tree':        this._drawTree(ctx, w, h, palette); break;
            case 'fence':       this._drawFence(ctx, w, h, palette); break;
            case 'barricade':   this._drawBarricade(ctx, w, h, palette); break;
            default:            this._drawBlock(ctx, w, h, palette); break;
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
}
