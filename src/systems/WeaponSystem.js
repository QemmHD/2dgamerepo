import { WEAPON } from '../config.js';
import { Projectile } from '../entities/Projectile.js';

export class WeaponSystem {
    constructor() {
        this.weapons = [
            {
                name: 'Bolt',
                cooldown: WEAPON.bolt.cooldown,
                damage: WEAPON.bolt.damage,
                projectileSpeed: WEAPON.bolt.projectileSpeed,
                projectileLifetime: WEAPON.bolt.projectileLifetime,
                projectileRadius: WEAPON.bolt.projectileRadius,
                timer: 0,
            },
        ];
    }

    update(dt, player, enemies, projectiles) {
        for (const w of this.weapons) {
            w.timer -= dt;
            if (w.timer > 0) continue;
            const target = this._findNearestEnemy(player, enemies);
            if (!target) {
                if (w.timer < 0) w.timer = 0;
                continue;
            }
            this._fire(w, player, target, projectiles);
            w.timer = w.cooldown;
        }
    }

    _findNearestEnemy(player, enemies) {
        let best = null;
        let bestDistSq = Infinity;
        for (const e of enemies) {
            if (!e.active) continue;
            const dx = e.x - player.x;
            const dy = e.y - player.y;
            const dsq = dx * dx + dy * dy;
            if (dsq < bestDistSq) {
                bestDistSq = dsq;
                best = e;
            }
        }
        return best;
    }

    _fire(weapon, player, target, projectiles) {
        const dx = target.x - player.x;
        const dy = target.y - player.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) return;
        const vx = (dx / len) * weapon.projectileSpeed;
        const vy = (dy / len) * weapon.projectileSpeed;
        projectiles.push(new Projectile(player.x, player.y, vx, vy, {
            damage: weapon.damage,
            lifetime: weapon.projectileLifetime,
            radius: weapon.projectileRadius,
        }));
    }
}
