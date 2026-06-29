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
        // Magnitude juice: default (white) hits scale + heat up with size so
        // big numbers POP. Tinted numbers (burn DoT etc.) keep their color.
        let color = this.color;
        let size = 28;
        if (this.color === '#ffffff') {
            const a = this.amount;
            if (a >= 220)      { color = '#ff4d3d'; size = 42; }
            else if (a >= 120) { color = '#ff9a4a'; size = 37; }
            else if (a >= 55)  { color = '#ffe066'; size = 32; }
        }
        // Quick scale-in pop over the first ~0.12s, then settle.
        const pop = this.age < 0.12 ? 1.45 - (this.age / 0.12) * 0.45 : 1;
        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `900 ${Math.round(size * pop)}px -apple-system, system-ui, Helvetica, Arial, sans-serif`;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = 4;
        ctx.strokeText(String(this.amount), this.x, this.y);
        ctx.fillStyle = color;
        ctx.fillText(String(this.amount), this.x, this.y);
        ctx.restore();
    }
}
