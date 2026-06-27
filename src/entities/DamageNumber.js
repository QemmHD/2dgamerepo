import { DAMAGE_NUMBER } from '../config/GameConfig.js';

export class DamageNumber {
    constructor(x, y, amount, color = '#ffffff') {
        this.x = x + (Math.random() - 0.5) * 24;
        this.y = y;
        this.amount = Math.max(0, Math.round(amount));
        this.color = color;
        this.age = 0;
        this.lifetime = DAMAGE_NUMBER.lifetime;
        this.riseSpeed = DAMAGE_NUMBER.riseSpeed;
        this.active = true;
    }

    update(dt) {
        this.age += dt;
        this.y -= this.riseSpeed * dt;
        if (this.age >= this.lifetime) this.active = false;
    }

    draw(ctx) {
        const t = this.age / this.lifetime;
        const alpha = 1 - t * t;
        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 28px -apple-system, system-ui, Helvetica, Arial, sans-serif';
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = 4;
        ctx.strokeText(String(this.amount), this.x, this.y);
        ctx.fillStyle = this.color;
        ctx.fillText(String(this.amount), this.x, this.y);
        ctx.restore();
    }
}
