// Frame-level collision pass.
// Resolves projectile↔enemy hits (apply damage + knockback, queue floating
// damage numbers, tally kills) and player↔enemy contact (apply contact
// damage when i-frames have expired, update the contact-flash timer).
//
// The shape of the returned object is what Game.js consumes to drive
// downstream effects (gem drops, screen shake, damage number spawns).

import { CONTACT_FLASH_DURATION, KNOCKBACK, PROJECTILE_BROADPHASE } from '../config/GameConfig.js';
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
        // Broadphase scratch (lazy). Persistent across frames so a steady-state
        // frame allocates nothing — only last frame's buckets are cleared.
        this._grid = null;      // Map<numericCellKey, Enemy[]>
        this._gridUsed = null;  // buckets touched last build, for O(k) reset
        this._cand = null;      // per-projectile candidate scratch, reused
        this._gridCell = 0;
        this._maxEnemyR = 0;
    }

    // Build (or skip) the per-frame enemy broadphase. Returns true when the grid
    // is populated and should be queried, false when the caller must fall back
    // to a flat scan (grid disabled, or too few enemies to be worth it). The
    // fallback path is what keeps correctness independent of the grid.
    _buildEnemyGrid(enemies) {
        const cfg = PROJECTILE_BROADPHASE;
        if (!cfg.enabled) return false;
        let active = 0;
        let maxR = 0;
        for (const e of enemies) {
            if (!e.active) continue;
            active++;
            if (e.radius > maxR) maxR = e.radius;
        }
        if (active < cfg.minEnemies) return false;

        const cell = cfg.cellSize;
        const grid = this._grid || (this._grid = new Map());
        const used = this._gridUsed || (this._gridUsed = []);
        // Reset only the buckets filled last frame (numeric keys + persistent
        // buckets → zero allocation at steady state), mirroring _separateEnemies.
        for (let i = 0; i < used.length; i++) used[i].length = 0;
        used.length = 0;
        for (const e of enemies) {
            if (!e.active) continue;
            const key = Math.floor(e.x / cell) * 65536 + Math.floor(e.y / cell);
            let b = grid.get(key);
            if (!b) { b = []; grid.set(key, b); }
            if (b.length === 0) used.push(b);
            b.push(e);
        }
        this._gridCell = cell;
        this._maxEnemyR = maxR;
        if (!this._cand) this._cand = [];
        return true;
    }

    resolve(dt, player, enemies, projectiles) {
        const killed = [];
        const hits = [];
        // Shared combo context — hits/killed are stable array refs and player
        // never changes across this call, and applyCombo only pushes to the
        // arrays (never persists ctx), so one hoisted object is byte-identical
        // to a fresh literal per hit and avoids per-projectile-hit GC churn.
        const comboCtx = { hits, killed, player };

        // Broadphase: query only nearby enemies per projectile. Each enemy sits
        // in exactly one (center) cell, so the query never visits a duplicate;
        // the query range = p.radius + the frame's largest enemy radius, which
        // provably contains every overlap (floor is monotonic), so the grid
        // finds precisely the enemies the flat scan would. Only the visit ORDER
        // differs, which affects only WHICH enemies a pierce-limited bolt strikes
        // among several it overlaps at once — it always hits the same COUNT
        // (min(pierce+1, overlaps)) for identical total damage, and the old
        // array order was itself arbitrary, so neither order is more correct.
        const useGrid = this._buildEnemyGrid(enemies);
        const cell = this._gridCell;
        const grid = this._grid;

        for (const p of projectiles) {
            if (!p.active) continue;
            const speed = Math.hypot(p.vx, p.vy) || 1;
            const kx = (p.vx / speed) * KNOCKBACK.strength;
            const ky = (p.vy / speed) * KNOCKBACK.strength;

            // Gather this projectile's candidate enemies. Grid path fills a
            // reused scratch array from the overlapping cells; fallback path
            // uses the full roster (guarded per-enemy by e.active below).
            let candidates;
            if (useGrid) {
                candidates = this._cand;
                candidates.length = 0;
                const R = p.radius + this._maxEnemyR;
                const gx0 = Math.floor((p.x - R) / cell);
                const gx1 = Math.floor((p.x + R) / cell);
                const gy0 = Math.floor((p.y - R) / cell);
                const gy1 = Math.floor((p.y + R) / cell);
                for (let gy = gy0; gy <= gy1; gy++) {
                    for (let gx = gx0; gx <= gx1; gx++) {
                        const b = grid.get(gx * 65536 + gy);
                        if (!b) continue;
                        for (let i = 0; i < b.length; i++) candidates.push(b[i]);
                    }
                }
            } else {
                candidates = enemies;
            }

            for (const e of candidates) {
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
                    applyCombo(e, p.element, p.damage, comboCtx);
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
