// Frame-level collision pass.
// Resolves projectile↔enemy hits (apply damage + knockback, queue floating
// damage numbers, tally kills) and player↔enemy contact (apply contact
// damage when i-frames have expired, update the contact-flash timer).
//
// The shape of the returned object is what Game.js consumes to drive
// downstream effects (gem drops, screen shake, damage number spawns).

import { CONTACT_FLASH_DURATION, KNOCKBACK } from '../config/GameConfig.js';
import { circleOverlap } from '../core/MathUtils.js';

export class CollisionSystem {
    constructor() {
        this.contactFlash = 0;
        this.inContact = false;
    }

    resolve(dt, player, enemies, projectiles) {
        const killed = [];
        const hits = [];

        for (const p of projectiles) {
            if (!p.active) continue;
            for (const e of enemies) {
                if (!e.active) continue;
                if (!circleOverlap(p.x, p.y, p.radius, e.x, e.y, e.radius)) continue;

                const speed = Math.hypot(p.vx, p.vy) || 1;
                const kx = (p.vx / speed) * KNOCKBACK.strength;
                const ky = (p.vy / speed) * KNOCKBACK.strength;
                e.takeDamage(p.damage, kx, ky);
                hits.push({ x: e.x, y: e.y - e.radius, amount: p.damage });
                p.active = false;
                if (!e.active) killed.push(e);
                break;
            }
        }

        let contact = false;
        let firstDamage = 0;
        for (const e of enemies) {
            if (!e.active) continue;
            if (!circleOverlap(player.x, player.y, player.radius, e.x, e.y, e.radius)) continue;
            contact = true;
            firstDamage = e.contactDamage;
            break;
        }
        this.inContact = contact;

        let playerHit = false;
        let playerDamageTaken = 0;
        if (contact) {
            this.contactFlash = CONTACT_FLASH_DURATION;
            if (player.invincibleTimer <= 0 && !player.isDead()) {
                const dealt = player.takeDamage(firstDamage);
                if (dealt > 0) {
                    playerHit = true;
                    playerDamageTaken = dealt;
                }
            }
        } else if (this.contactFlash > 0) {
            this.contactFlash = Math.max(0, this.contactFlash - dt);
        }

        return { killed, hits, playerHit, playerDamageTaken };
    }
}
