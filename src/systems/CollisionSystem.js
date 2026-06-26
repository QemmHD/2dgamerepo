import { CONTACT_FLASH_DURATION, KNOCKBACK } from '../config.js';

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
                const r = p.radius + e.radius;
                const dx = p.x - e.x;
                const dy = p.y - e.y;
                if (dx * dx + dy * dy <= r * r) {
                    const speed = Math.hypot(p.vx, p.vy) || 1;
                    const kx = (p.vx / speed) * KNOCKBACK.strength;
                    const ky = (p.vy / speed) * KNOCKBACK.strength;
                    e.takeDamage(p.damage, kx, ky);
                    hits.push({
                        x: e.x,
                        y: e.y - e.radius,
                        amount: p.damage,
                    });
                    p.active = false;
                    if (!e.active) killed.push(e);
                    break;
                }
            }
        }

        let contact = false;
        let firstDamage = 0;
        for (const e of enemies) {
            if (!e.active) continue;
            const r = player.radius + e.radius;
            const dx = player.x - e.x;
            const dy = player.y - e.y;
            if (dx * dx + dy * dy <= r * r) {
                contact = true;
                firstDamage = e.contactDamage;
                break;
            }
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
