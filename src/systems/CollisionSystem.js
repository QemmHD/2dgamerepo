// Frame-level collision pass.
// Resolves projectile↔enemy hits (apply damage + knockback, queue floating
// damage numbers, tally kills) and player↔enemy contact (apply contact
// damage when i-frames have expired, update the contact-flash timer).
//
// The shape of the returned object is what Game.js consumes to drive
// downstream effects (gem drops, screen shake, damage number spawns).

import { CONTACT_FLASH_DURATION, KNOCKBACK } from '../config/GameConfig.js';
import { circleOverlap } from '../core/MathUtils.js';
import { applyCombo } from '../content/elements.js';

// How much each non-strongest overlapping enemy adds to a contact hit, and
// the ceiling as a multiple of the single strongest enemy's damage. The cap
// bounds the crowd explosion so a dense pile is "far deadlier than one enemy"
// without scaling with raw body count — a hit is at most 1.9× the strongest
// toucher. NOTE: this is NOT a survive-one-window guarantee. Late-game contact
// (base × elite 1.7 × frenzied 1.4 × endless damageMul) is intentionally heavy,
// so a frenzied-elite heavy pile is a hard two-shot of a modest build — the
// scaling ceilings (ENDLESS_SCALING.maxDamageMultiplier) are tuned to keep that
// from becoming a no-counterplay one-shot, but standing in the worst pile in
// the deep endgame is meant to be lethal.
const CROWD_DAMAGE_FRACTION = 0.3;
const CROWD_DAMAGE_CAP = 1.9;

// Fallback redirect range for a ricochet bolt that has a budget but no
// explicit ricochetRange set.
const RICOCHET_FALLBACK_RANGE = 360;

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
                hits.push({ x: e.x, y: e.y - e.radius, amount: p.damage, element: p.element });
                p.hitEnemies.add(e);
                // FIRE payload: stamp a burn. Re-applies on every pierce pass
                // and on each ricochet hop for free (same projectile object),
                // which is the intended "ember bolt keeps things burning" feel.
                if (p.burnDps > 0) e.applyBurn(p.burnDps, p.burnDuration);
                const lethal = !e.active;
                if (lethal) killed.push(e);
                // KINDLED combos: a FIRE bolt on a chilled/frozen target
                // SHATTERs; a FROST bolt on a shocked target goes BRITTLE. (Shock
                // detonation stays exclusively in shockStrike.) Only a SURVIVOR of
                // the bolt combos, so a lethal SHATTER's own kill-push (inside
                // applyCombo) is the single kill credit and can't double the
                // bolt's — and ricochet-on-kill below stays keyed to the BOLT's
                // kill, never the combo's. This one hit choke point covers every
                // projectile weapon.
                else if (p.element === 'fire' || p.element === 'frost') {
                    applyCombo(e, p.element, p.damage, { hits, killed, player });
                }

                // Ricochet-on-kill (Arcane Bolt signature): a lethal hit with
                // ricochet budget redirects the bolt toward the nearest
                // not-yet-hit enemy within range instead of dying. Bounded by
                // the finite p.ricochet count and the p.hitEnemies guard, so
                // it can never loop. One redirect per frame (we break and let
                // it re-scan next frame from its new heading).
                if (lethal && p.ricochet > 0) {
                    const rr = p.ricochetRange || RICOCHET_FALLBACK_RANGE;
                    const rrSq = rr * rr;
                    let best = null;
                    let bestSq = rrSq;
                    for (const t of enemies) {
                        if (!t.active || p.hitEnemies.has(t)) continue;
                        const tdx = t.x - e.x;
                        const tdy = t.y - e.y;
                        const dsq = tdx * tdx + tdy * tdy;
                        if (dsq < bestSq) { bestSq = dsq; best = t; }
                    }
                    if (best) {
                        const rdx = best.x - e.x;
                        const rdy = best.y - e.y;
                        const rlen = Math.hypot(rdx, rdy) || 1;
                        const cur = Math.hypot(p.vx, p.vy) || 1;
                        p.vx = (rdx / rlen) * cur;
                        p.vy = (rdy / rlen) * cur;
                        p.x = e.x;
                        p.y = e.y;
                        p.angle = Math.atan2(p.vy, p.vx);
                        p.ricochet -= 1;
                        break; // re-scan next frame from the new heading
                    }
                    // No target in range: fall through to normal pierce/die.
                }

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
        let strongestEnemy = null;
        let rest = 0;
        for (const e of enemies) {
            if (!e.active) continue;
            if (!circleOverlap(player.x, player.y, player.radius, e.x, e.y, e.radius)) continue;
            contact = true;
            if (e.contactDamage > strongest) {
                rest += strongest;
                strongest = e.contactDamage;
                strongestEnemy = e;
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
                    // Thorns: reflect a fraction of the (pre-mitigation)
                    // contact damage back to the strongest attacker. Routes
                    // its hit/kill through the same arrays so gem drops +
                    // damage numbers fire normally.
                    const reflect = (player.thornsReflect ?? 0) * contactDamage;
                    if (reflect > 0 && strongestEnemy && strongestEnemy.active) {
                        strongestEnemy.takeDamage(reflect);
                        hits.push({
                            x: strongestEnemy.x,
                            y: strongestEnemy.y - strongestEnemy.radius,
                            amount: reflect,
                        });
                        if (!strongestEnemy.active) killed.push(strongestEnemy);
                    }
                }
            }
        } else if (this.contactFlash > 0) {
            this.contactFlash = Math.max(0, this.contactFlash - dt);
        }

        // Killer attribution (EMBERGLASS death card): only meaningful when the
        // player actually took contact damage this frame; the strongest toucher
        // is the one to name.
        let strongestHit = null;
        if (playerHit && strongestEnemy) {
            strongestHit = {
                label: strongestEnemy.def?.label ?? strongestEnemy.name,
                epithet: strongestEnemy.epithet ?? null,
                boss: !!strongestEnemy.boss,
            };
        }

        return { killed, hits, playerHit, playerDamageTaken, strongest: strongestHit };
    }
}
