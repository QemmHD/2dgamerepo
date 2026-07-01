// Wick Shrine — a walk-onto altar that rises when a boss falls (as the
// alternative to the treasure chest; claiming one despawns the other). Sits in
// the world until the player steps onto it, then flips `active = false` and Game
// opens the pick-one altar overlay. No magnet, no timeout — it waits politely,
// exactly like Chest. Drawn procedurally (few ever exist at once) in the ember
// dark-fantasy language: a dark stone plinth, a rune tablet, and a bobbing
// relic-pink flame.

import { WICK_ROADS } from '../config/GameConfig.js';
import { TWO_PI, circleOverlap } from '../core/MathUtils.js';

const GLOW = '#ff9ecf';   // relic-pink ember
const FLAME = '#ffd3ec';

export class Shrine {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = WICK_ROADS.shrinePickupRadius;
        this.active = true;
        this.bobTimer = Math.random() * TWO_PI;
        // The sibling reward (a Chest) offered alongside this shrine on a boss
        // kill; claiming either despawns the other so the player picks ONE.
        this._sibling = null;
    }

    update(dt, player) {
        this.bobTimer += dt;
        if (circleOverlap(this.x, this.y, this.radius, player.x, player.y, player.radius)) {
            this.active = false;
            return true;
        }
        return false;
    }

    draw(ctx) {
        const bob = Math.sin(this.bobTimer * 2.2) * 3;
        const pulse = 0.55 + 0.45 * ((Math.sin(this.bobTimer * 3) + 1) / 2);
        ctx.save();
        // Ground glow.
        const grad = ctx.createRadialGradient(this.x, this.y, 8, this.x, this.y, 78);
        grad.addColorStop(0, `rgba(255, 158, 207, ${0.34 * pulse})`);
        grad.addColorStop(1, 'rgba(255, 158, 207, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 78, 0, TWO_PI);
        ctx.fill();

        // Stone plinth (trapezoid) — sits on the ground plane.
        ctx.fillStyle = '#2a2530';
        ctx.beginPath();
        ctx.moveTo(this.x - 22, this.y + 16);
        ctx.lineTo(this.x + 22, this.y + 16);
        ctx.lineTo(this.x + 15, this.y - 2);
        ctx.lineTo(this.x - 15, this.y - 2);
        ctx.closePath();
        ctx.fill();
        // Rune tablet standing on the plinth.
        ctx.fillStyle = '#37303c';
        ctx.fillRect(this.x - 12, this.y - 34, 24, 34);
        ctx.strokeStyle = GLOW;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.5 + 0.5 * pulse;
        ctx.strokeRect(this.x - 12, this.y - 34, 24, 34);
        // Carved rune (a simple wick sigil).
        ctx.beginPath();
        ctx.moveTo(this.x, this.y - 30);
        ctx.lineTo(this.x, this.y - 10);
        ctx.moveTo(this.x - 6, this.y - 22);
        ctx.lineTo(this.x + 6, this.y - 22);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Bobbing relic flame above the tablet.
        const fx = this.x;
        const fy = this.y - 46 + bob;
        const fg = ctx.createRadialGradient(fx, fy, 1, fx, fy, 14);
        fg.addColorStop(0, FLAME);
        fg.addColorStop(1, 'rgba(255, 158, 207, 0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(fx, fy, 14, 0, TWO_PI);
        ctx.fill();
        // Bright diamond core.
        ctx.fillStyle = FLAME;
        ctx.beginPath();
        ctx.moveTo(fx, fy - 7);
        ctx.lineTo(fx + 4, fy);
        ctx.lineTo(fx, fy + 7);
        ctx.lineTo(fx - 4, fy);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    drawDebug(ctx) {
        ctx.save();
        ctx.strokeStyle = GLOW;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }
}
