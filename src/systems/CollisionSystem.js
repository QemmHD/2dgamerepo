// Frame-level collision pass.
// Resolves projectile↔enemy hits (apply damage + knockback, queue floating
// damage numbers, tally kills) and player↔enemy contact (apply contact
// damage when i-frames have expired, update the contact-flash timer).
//
// The shape of the returned object is what Game.js consumes to drive
// downstream effects (gem drops, screen shake, damage number spawns).

import { CONTACT_FLASH_DURATION, KNOCKBACK } from '../config/GameConfig.js';
import { circleOverlap } from '../core/MathUtils.js';

// How much each non-strongest overlapping enemy adds to a contact hit, and
// the ceiling as a multiple of the single strongest enemy's damage.
const CROWD_DAMAGE_FRACTION = 0.3;
const CROWD_DAMAGE_CAP = 2.5;

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
            const speed = Math.hypot(p.vx, p.vy) || 1;
            const kx = (p.vx / speed) * KNOCKBACK.strength;
            const ky = (p.vy / speed) * KNOCKBACK.strength;
            for (const e of enemies) {
                if (!e.active) continue;
                if (p.hitEnemies.has(e)) continue;
                if (!circleOverlap(p.x, p.y, p.radius, e.x, e.y, e.radius)) continue;

                e.takeDamage(p.damage, kx, ky);
                hits.push({ x: e.x, y: e.y - e.radius, amount: p.damage });
                p.hitEnemies.add(e);
                if (!e.active) killed.push(e);

                if (p.pierce > 0) {
                    p.pierce -= 1;
                    // Keep going — a piercing projectile can chain through
                    // a clump of enemies in the same frame.
                } else {
                    p.active = false;
                    break;
                }
            }
        }

        // Crowd-scaled contact damage. The old code took only the FIRST
        // overlapping enemy then broke, so being mobbed by a dozen enemies
        // hit exactly as hard as brushing one slime — crowd pressure was
        // purely cosmetic and the whole mid-game curve went flat. Now we
        // take the strongest overlap plus a capped fraction of the rest, so
        // a swarm genuinely hurts while a single touch is unchanged.
        let contact = false;
        let strongest = 0;
        let rest = 0;
        for (const e of enemies) {
            if (!e.active) continue;
            if (!circleOverlap(player.x, player.y, player.radius, e.x, e.y, e.radius)) continue;
            contact = true;
            if (e.contactDamage > strongest) {
                rest += strongest;
                strongest = e.contactDamage;
            } else {
                rest += e.contactDamage;
            }
        }
        this.inContact = contact;
        // strongest + 30% of the others, capped at 2.5x the strongest so a
        // huge pile can't one-shot but is clearly more dangerous than one.
        const contactDamage = contact
            ? Math.min(strongest + rest * CROWD_DAMAGE_FRACTION, strongest * CROWD_DAMAGE_CAP)
            : 0;

        let playerHit = false;
        let playerDamageTaken = 0;
        if (contact) {
            this.contactFlash = CONTACT_FLASH_DURATION;
            if (player.invincibleTimer <= 0 && !player.isDead()) {
                const dealt = player.takeDamage(contactDamage);
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
