import { CONTACT_FLASH_DURATION } from '../config.js';

export class CollisionSystem {
    constructor() {
        this.contactFlash = 0;
        this.inContact = false;
    }

    resolve(dt, player, enemies, projectiles) {
        const killed = [];

        for (const p of projectiles) {
            if (!p.active) continue;
            for (const e of enemies) {
                if (!e.active) continue;
                const r = p.radius + e.radius;
                const dx = p.x - e.x;
                const dy = p.y - e.y;
                if (dx * dx + dy * dy <= r * r) {
                    e.takeDamage(p.damage);
                    p.active = false;
                    if (!e.active) killed.push(e);
                    break;
                }
            }
        }

        let contact = false;
        for (const e of enemies) {
            if (!e.active) continue;
            const r = player.radius + e.radius;
            const dx = player.x - e.x;
            const dy = player.y - e.y;
            if (dx * dx + dy * dy <= r * r) {
                contact = true;
                break;
            }
        }
        this.inContact = contact;
        if (contact) {
            this.contactFlash = CONTACT_FLASH_DURATION;
        } else if (this.contactFlash > 0) {
            this.contactFlash = Math.max(0, this.contactFlash - dt);
        }

        return killed;
    }
}
