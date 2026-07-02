// HazardSystem — sim + draw for the Game-owned area-hazard pool (boss
// shockwaves, telegraph decals, delayed-detonation zones, sweeping beams,
// lingering pools). Pure move out of Game.update()/render() (P1.5): the
// hazards array itself stays on Game (bosses write into it via _bossOut,
// and _initRunState resets it), so this class is stateless — every method
// takes the game as a scratch ref, allocating nothing per frame.
//
// Draw order is preserved exactly: drawGround paints the ground decals
// (telegraphs, delayed zones, lingering pools) below entities; drawAbove
// paints the bright shockwave rings + laser beams above entities.
//
// P1.2 "Living Biomes" adds the per-map SIGNATURE GROUND HAZARDS here too:
// updateBiome is the spawner (a small cadence scheduler whose state lives on
// game.biomeHazard, keeping this class stateless), and the patches ride the
// same game.hazards pool — simmed in update(), drawn in drawGround(). All
// four kinds are fully procedural (flat fills/strokes + a bright rim so
// they read on the dark ground; no gradients, no AI-art dependency), every
// patch blooms in over a `warn` telegraph before it does anything, and the
// spawn ring guarantees one never opens underfoot.

import { TWO_PI, clamp } from '../core/MathUtils.js';
import { BIOME_HAZARD, BOSS_ATTACK, GFX, LIGHT_COLORS, WORLD_WIDTH, WORLD_HEIGHT } from '../config/GameConfig.js';
import { DamageNumber } from '../entities/DamageNumber.js';

// Mirrors Game's CULL_MARGIN (half the largest sprite + headroom + shake).
const CULL_MARGIN = 160;

const Lc = GFX.lighting;

export class HazardSystem {
    // Boss area hazards (expanding shockwaves) + their telegraph decals.
    // Runs BEFORE the Second Wind regen check so HP/i-frames stay
    // consistent within the frame. A shockwave damages the player once,
    // when its expanding band first crosses them (i-frames handle the rest).
    update(dt, game) {
        // Biome-terrain player modifiers are RE-STAMPED from scratch each
        // frame (patches below re-assert them), so stepping off a patch
        // reverses everything instantly with zero undo bookkeeping.
        const pl = game.player;
        pl.terrainSlowMul = 1;
        pl.iceSlipT = 0;
        game._gloomIn = false;
        for (const hz of game.hazards) {
            if (!hz.active) continue;
            hz.age += dt;
            // ── P1.2 biome patches: one shared branch for all four kinds.
            // Telegraph first (no effect during warn), then stamp terrain
            // effects / tick damage only while the player's CENTER is inside
            // (slightly forgiving — fair for a floor hazard).
            if (hz.biome) {
                if (hz.age >= hz.lifetime) { hz.active = false; continue; }
                if (hz.age < hz.warn) continue;
                const dx = pl.x - hz.x, dy = pl.y - hz.y;
                if (dx * dx + dy * dy > hz.r * hz.r) continue;
                if (hz.slowMul < 1) pl.terrainSlowMul = Math.min(pl.terrainSlowMul, hz.slowMul); // brambles/quicksand wade
                if (hz.kind === 'iceSlick') pl.iceSlipT = 1;
                if (hz.kind === 'gloom') game._gloomIn = true;
                if (hz.tickDamage > 0) {
                    // Same 0.4s tick idiom as the boss 'lingering' pools
                    // (i-frame gated by takeDamage; hurt audio rides the
                    // central HP-drop watcher in Game).
                    hz.tickTimer -= dt;
                    if (hz.tickTimer <= 0) {
                        hz.tickTimer = 0.4;
                        const dealt = pl.takeDamage(hz.tickDamage);
                        if (dealt > 0) {
                            game._playerHurtShake(dealt);
                            game.damageNumbers.push(new DamageNumber(
                                pl.x, pl.y - pl.radius, dealt, hz.rim));
                        }
                    }
                }
                continue;
            }
            if (hz.kind === 'bossTelegraph') {
                // A freeze proc pauses the owner's windup (Enemy.update gates
                // the whole behavior branch), so pause the ring with it —
                // otherwise the telegraph expires mid-freeze and the thawed
                // shockwave commits with no warning left on the ground. Only
                // lieutenants set an owner (bosses are freeze-exempt).
                if (hz.owner && hz.owner.active && hz.owner.freezeTimer > 0) hz.age -= dt;
                hz.r = hz.rMax * Math.min(1, hz.age / hz.lifetime);
                if (hz.age >= hz.lifetime) hz.active = false;
                continue;
            }
            // delayedZone: a telegraphed danger circle that detonates ONCE when
            // its warning fills, dealing damage if the player is still inside
            // (and in line of sight). Lingers a few frames after for the blast FX.
            if (hz.kind === 'delayedZone') {
                if (hz.age >= hz.lifetime && !hz.hitPlayer) {
                    hz.hitPlayer = true;
                    const d = Math.hypot(game.player.x - hz.x, game.player.y - hz.y);
                    if (d <= hz.r && game.obstacleSystem.hasLineOfSight(hz.x, hz.y, game.player.x, game.player.y)) {
                        const dealt = game.player.takeDamage(hz.damage);
                        if (dealt > 0) {
                            game._playerHurtShake(dealt);
                            game._pushFeedback('hit', 0.32);
                            game.damageNumbers.push(new DamageNumber(
                                game.player.x, game.player.y - game.player.radius, dealt, '#ff4757'));
                        }
                    }
                    if (game.particles) game.particles.deathBurst(hz.x, hz.y, '#ff7a4a');
                }
                if (hz.hitPlayer) {
                    hz.detonateAge += dt;
                    if (hz.detonateAge > 0.18) hz.active = false;
                }
                continue;
            }
            // beam: a rotating laser LINE from the boss. Telegraphs during `warn`,
            // then goes hot and sweeps across `sweep` radians. Damages the player
            // (i-frame gated) whenever they're on the hot line within `length`.
            if (hz.kind === 'beam') {
                const hot = hz.age >= hz.warn;
                const sweepT = Math.min(1, Math.max(0, (hz.age - hz.warn) / Math.max(0.001, hz.lifetime - hz.warn)));
                hz.curAngle = hz.angle + hz.sweep * (hot ? sweepT : 0);
                if (hot) {
                    const dx = game.player.x - hz.x, dy = game.player.y - hz.y;
                    const ca = Math.cos(hz.curAngle), sa = Math.sin(hz.curAngle);
                    const along = dx * ca + dy * sa;            // distance along the beam
                    const perp = Math.abs(dx * -sa + dy * ca);  // distance off the beam line
                    if (along > 0 && along < hz.length && perp < hz.band + game.player.radius &&
                        game.obstacleSystem.hasLineOfSight(hz.x, hz.y, game.player.x, game.player.y)) {
                        const dealt = game.player.takeDamage(hz.damage);
                        if (dealt > 0) {
                            game._playerHurtShake(dealt);
                            game._pushFeedback('hit', 0.3);
                            game.damageNumbers.push(new DamageNumber(
                                game.player.x, game.player.y - game.player.radius, dealt, '#ff4757'));
                        }
                    }
                }
                if (hz.age >= hz.lifetime) hz.active = false;
                continue;
            }
            // lingering: a persistent pool that telegraphs, then SITS dealing
            // damage-over-time (ticking every 0.4s, i-frame gated) until it fades.
            if (hz.kind === 'lingering') {
                if (hz.age >= hz.warn) {
                    hz.tickTimer -= dt;
                    if (hz.tickTimer <= 0) {
                        hz.tickTimer = 0.4;
                        const d = Math.hypot(game.player.x - hz.x, game.player.y - hz.y);
                        if (d <= hz.r + game.player.radius &&
                            game.obstacleSystem.hasLineOfSight(hz.x, hz.y, game.player.x, game.player.y)) {
                            const dealt = game.player.takeDamage(hz.tickDamage);
                            if (dealt > 0) {
                                game._playerHurtShake(dealt);
                                game.damageNumbers.push(new DamageNumber(
                                    game.player.x, game.player.y - game.player.radius, dealt, hz.color || '#ff7a33'));
                            }
                        }
                    }
                }
                if (hz.age >= hz.lifetime) hz.active = false;
                continue;
            }
            // shockwave: expand and damage the player once when the ring band
            // sweeps across them.
            hz.r += hz.growth * dt;
            if (!hz.hitPlayer) {
                const d = Math.hypot(game.player.x - hz.x, game.player.y - hz.y);
                // A wall between the boss's shockwave origin and the player
                // shields them — bosses can't damage through cover.
                if (d >= hz.r - hz.band && d <= hz.r + hz.band &&
                    game.obstacleSystem.hasLineOfSight(hz.x, hz.y, game.player.x, game.player.y)) {
                    const dealt = game.player.takeDamage(hz.damage);
                    if (dealt > 0) {
                        hz.hitPlayer = true;
                        game._playerHurtShake(dealt);
                        game._pushFeedback('hit', 0.32);
                        game.damageNumbers.push(new DamageNumber(
                            game.player.x, game.player.y - game.player.radius, dealt, '#ff4757'
                        ));
                    }
                }
            }
            if (hz.r >= hz.rMax) hz.active = false;
        }
        // Crypts gloom pressure (P1.2): ease the player-light squeeze toward
        // in/out of a pool so the veil closes in smoothly, never snaps. The
        // render pass reads game.gloomT to shrink the player light's radius.
        const gTarget = game._gloomIn ? 1 : 0;
        game.gloomT = (game.gloomT ?? 0) + (gTarget - (game.gloomT ?? 0)) * Math.min(1, dt * 3);
    }

    // ── P1.2 biome hazard spawner ──────────────────────────────────────────
    // Cadence scheduler for the current map's signature patches. All state
    // lives on game.biomeHazard ({ kind, timer }, armed by _initRunState from
    // the map def) so this class stays stateless. Patches spawn on a ring
    // ahead of the player's heading — they pressure the path you're TAKING —
    // but never underfoot (spawnMin), never inside cover, capped at
    // maxActive, and held entirely during boss setpieces (arenas are
    // authored by the boss's own kit).
    updateBiome(dt, game) {
        const bh = game.biomeHazard;
        if (!bh) return;
        if (game.arena || game.bossWarning) return;
        bh.timer -= dt;
        if (bh.timer > 0) return;
        const B = BIOME_HAZARD;
        bh.timer = B.interval * (1 - B.intervalJitter + Math.random() * 2 * B.intervalJitter);
        const cfg = B[bh.kind];
        if (!cfg) return;
        let live = 0;
        for (const hz of game.hazards) if (hz.active && hz.biome) live++;
        const count = Math.min(B.maxActive - live, Math.random() < 0.45 ? 2 : 1);
        const pl = game.player;
        const moving = pl.vx || pl.vy;
        const heading = moving ? Math.atan2(pl.vy, pl.vx) : Math.random() * TWO_PI;
        const halfW = WORLD_WIDTH / 2 - 160, halfH = WORLD_HEIGHT / 2 - 160;
        for (let i = 0; i < count; i++) {
            // Bias ahead of the heading (±~75°) at a ring that can't land on
            // the player. A blocked spot is skipped, not retried — the
            // cadence refills soon enough that fairness beats persistence.
            const a = heading + (Math.random() - 0.5) * 2.6;
            const d = B.spawnMin + Math.random() * (B.spawnMax - B.spawnMin);
            const x = clamp(pl.x + Math.cos(a) * d, -halfW, halfW);
            const y = clamp(pl.y + Math.sin(a) * d, -halfH, halfH);
            // The border clamp can drag a ring spot back over an edge-hugging
            // player (center closer than the patch radius) — re-check the
            // spawnMin promise after clamping and skip, same as a blocked spot.
            const pdx = x - pl.x, pdy = y - pl.y;
            if (pdx * pdx + pdy * pdy < B.spawnMin * B.spawnMin) continue;
            if (game.obstacleSystem.isBlocked(x, y, cfg.r * 0.7)) continue;
            game.hazards.push({
                kind: bh.kind, biome: true, x, y, r: cfg.r,
                warn: cfg.warn, age: 0, lifetime: cfg.warn + cfg.duration,
                tickTimer: 0, tickDamage: cfg.tickDamage ?? 0,
                slowMul: cfg.slowMul ?? 1, color: cfg.color, rim: cfg.rim,
                seed: Math.random() * TWO_PI, active: true,
            });
        }
    }

    // Ground decals — drawn below entities so the boss paints over them.
    drawGround(ctx, game, L) {
        // Boss telegraph decals — drawn on the GROUND, below entities, so the
        // boss paints over them. A warning ring that fills in across the
        // windup; no light (it reads as a warning, not a glow).
        for (const hz of game.hazards) {
            if (!hz.active || hz.kind !== 'bossTelegraph') continue;
            if (!game._inView(hz.x, hz.y, hz.rMax + CULL_MARGIN)) continue;
            const t = Math.min(1, hz.age / hz.lifetime);
            ctx.save();
            ctx.globalAlpha = 0.2 + 0.6 * t;
            ctx.strokeStyle = BOSS_ATTACK.telegraphColor;
            if (hz.charge) {
                // A widening lane + arrowhead along the lunge heading: fills in
                // over the windup so the player can read the charge and dodge.
                const reach = (hz.reach ?? 360) * (0.5 + 0.5 * t);
                const ex = hz.x + hz.dirX * reach, ey = hz.y + hz.dirY * reach;
                const px = -hz.dirY, py = hz.dirX;       // perpendicular
                const halfW = 26 + 22 * t;
                ctx.fillStyle = BOSS_ATTACK.telegraphColor;
                ctx.globalAlpha = 0.14 + 0.18 * t;
                ctx.beginPath();
                ctx.moveTo(hz.x + px * halfW * 0.5, hz.y + py * halfW * 0.5);
                ctx.lineTo(hz.x - px * halfW * 0.5, hz.y - py * halfW * 0.5);
                ctx.lineTo(ex - px * halfW, ey - py * halfW);
                ctx.lineTo(ex + px * halfW, ey + py * halfW);
                ctx.closePath();
                ctx.fill();
                ctx.globalAlpha = 0.35 + 0.5 * t;
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(ex + hz.dirX * 18, ey + hz.dirY * 18);
                ctx.lineTo(ex - px * halfW * 0.7, ey - py * halfW * 0.7);
                ctx.lineTo(ex + px * halfW * 0.7, ey + py * halfW * 0.7);
                ctx.closePath();
                ctx.stroke();
            } else {
                ctx.lineWidth = hz.fan ? 4 : 5;
                ctx.beginPath();
                ctx.arc(hz.x, hz.y, Math.max(2, hz.r), 0, TWO_PI);
                ctx.stroke();
            }
            ctx.restore();
        }

        // Delayed-AoE zones: a filling warning disc that flashes bright on
        // detonation. Drawn on the ground (below entities) like the telegraphs.
        for (const hz of game.hazards) {
            if (!hz.active || hz.kind !== 'delayedZone') continue;
            if (!game._inView(hz.x, hz.y, hz.r + CULL_MARGIN)) continue;
            ctx.save();
            if (hz.hitPlayer) {
                // Detonation flash.
                ctx.globalAlpha = 0.55;
                ctx.fillStyle = '#ff7a4a';
                ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.r, 0, TWO_PI); ctx.fill();
            } else {
                const t = Math.min(1, hz.age / hz.lifetime);
                ctx.globalAlpha = 0.12 + 0.26 * t;
                ctx.fillStyle = BOSS_ATTACK.telegraphColor;
                ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.r, 0, TWO_PI); ctx.fill();
                ctx.globalAlpha = 0.35 + 0.55 * t;
                ctx.strokeStyle = BOSS_ATTACK.telegraphColor;
                ctx.lineWidth = 3;
                ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.r * (0.35 + 0.65 * t), 0, TWO_PI); ctx.stroke();
            }
            ctx.restore();
        }

        // Lingering pools: a telegraph that fills, then a persistent burning
        // field that pulses and fades near the end of its life. Ground decal.
        for (const hz of game.hazards) {
            if (!hz.active || hz.kind !== 'lingering') continue;
            if (!game._inView(hz.x, hz.y, hz.r + CULL_MARGIN)) continue;
            ctx.save();
            if (hz.age < hz.warn) {
                const t = hz.age / hz.warn;
                ctx.globalAlpha = 0.12 + 0.26 * t;
                ctx.fillStyle = BOSS_ATTACK.telegraphColor;
                ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.r, 0, TWO_PI); ctx.fill();
            } else {
                const left = 1 - Math.min(1, (hz.age - hz.warn) / Math.max(0.001, hz.lifetime - hz.warn));
                const pulse = 0.5 + 0.5 * Math.sin(hz.age * 6);
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = (0.18 + 0.18 * pulse) * (0.4 + 0.6 * left);
                ctx.fillStyle = hz.color || '#ff7a33';
                ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.r, 0, TWO_PI); ctx.fill();
                ctx.globalAlpha = (0.5 + 0.3 * pulse) * (0.4 + 0.6 * left);
                ctx.lineWidth = 4;
                ctx.strokeStyle = hz.color || '#ff7a33';
                ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.r, 0, TWO_PI); ctx.stroke();
            }
            ctx.restore();
            if (L && hz.age >= hz.warn) L.addLight(hz.x, hz.y, hz.r + 40, hz.color || LIGHT_COLORS.fire, 0.7, 2);
        }

        // ── P1.2 biome signature patches — procedural ground decals. ──────
        // Shared telegraph language: every patch BLOOMS open across its warn
        // (radius + alpha ramp), damaging kinds wear the boss warning color
        // on their rim until they go live, then switch to their own bright
        // rim so danger vs. terrain reads at a glance on the dark ground.
        // All flat fills/strokes off hz fields — no gradients, no allocation.
        for (const hz of game.hazards) {
            if (!hz.active || !hz.biome) continue;
            if (!game._inView(hz.x, hz.y, hz.r + CULL_MARGIN)) continue;
            const warm = Math.min(1, hz.age / hz.warn);
            const live = hz.age >= hz.warn;
            // Fade out across the final second so patches never pop off.
            const fade = Math.min(1, hz.lifetime - hz.age);
            const r = hz.r * (0.55 + 0.45 * warm);
            ctx.save();
            ctx.translate(hz.x, hz.y);
            // Body fill + rim (shared), then the kind's identity marks.
            ctx.globalAlpha = (hz.kind === 'gloom' ? 0.30 + 0.25 * warm
                : hz.kind === 'iceSlick' ? 0.10 + 0.10 * warm
                : 0.16 + 0.14 * warm) * fade;
            ctx.fillStyle = hz.color;
            ctx.beginPath(); ctx.arc(0, 0, r, 0, TWO_PI); ctx.fill();
            const danger = hz.tickDamage > 0 && !live;
            ctx.globalAlpha = (0.35 + 0.35 * warm) * fade;
            ctx.strokeStyle = danger ? BOSS_ATTACK.telegraphColor : hz.rim;
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(0, 0, r, 0, TWO_PI); ctx.stroke();
            if (hz.kind === 'brambles') {
                // Thorn chevrons scattered on a seeded ring — reads as briar.
                ctx.globalAlpha = (0.4 + 0.4 * warm) * fade;
                ctx.strokeStyle = hz.rim;
                ctx.lineWidth = 2;
                ctx.beginPath();
                for (let k = 0; k < 7; k++) {
                    const a = hz.seed + (k / 7) * TWO_PI;
                    const tr = r * (0.28 + 0.4 * (((k * 5) % 7) / 7));
                    const tx = Math.cos(a) * tr, ty = Math.sin(a) * tr;
                    ctx.moveTo(tx - 7, ty + 6); ctx.lineTo(tx, ty - 8); ctx.lineTo(tx + 7, ty + 6);
                }
                ctx.stroke();
            } else if (hz.kind === 'iceSlick') {
                // Two off-center sheen arcs — reads as polished ice.
                ctx.globalAlpha = 0.55 * fade;
                ctx.strokeStyle = hz.rim;
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(0, 0, r * 0.58, hz.seed, hz.seed + 1.1); ctx.stroke();
                ctx.beginPath(); ctx.arc(0, 0, r * 0.32, hz.seed + 2.4, hz.seed + 3.3); ctx.stroke();
            } else if (hz.kind === 'gloom') {
                // A denser core + two slow-orbiting motes — living darkness.
                ctx.globalAlpha = 0.35 * fade;
                ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, TWO_PI); ctx.fill();
                if (live) {
                    ctx.globalAlpha = 0.6 * fade;
                    ctx.fillStyle = hz.rim;
                    const oa = hz.seed + hz.age * 0.9;
                    ctx.beginPath(); ctx.arc(Math.cos(oa) * r * 0.7, Math.sin(oa) * r * 0.7, 4, 0, TWO_PI); ctx.fill();
                    ctx.beginPath(); ctx.arc(Math.cos(oa + Math.PI) * r * 0.5, Math.sin(oa + Math.PI) * r * 0.5, 3, 0, TWO_PI); ctx.fill();
                }
            } else if (hz.kind === 'quicksand') {
                // Slowly turning inward spiral arcs + a sink point.
                const rot = hz.seed + hz.age * 0.7;
                ctx.globalAlpha = 0.5 * fade;
                ctx.strokeStyle = 'rgba(40, 28, 10, 0.8)';
                ctx.lineWidth = 3;
                ctx.beginPath(); ctx.arc(0, 0, r * 0.72, rot, rot + 2.2); ctx.stroke();
                ctx.beginPath(); ctx.arc(0, 0, r * 0.46, -rot * 1.3, -rot * 1.3 + 2.4); ctx.stroke();
                ctx.beginPath(); ctx.arc(0, 0, r * 0.22, rot * 1.7, rot * 1.7 + 2.6); ctx.stroke();
                ctx.fillStyle = 'rgba(40, 28, 10, 0.8)';
                ctx.beginPath(); ctx.arc(0, 0, 7, 0, TWO_PI); ctx.fill();
            }
            ctx.restore();
            // A soft rim-tinted light so live patches read against the veil
            // (gloom stays dark — its identity IS the missing light).
            if (L && live && hz.kind !== 'gloom') L.addLight(hz.x, hz.y, hz.r + 30, hz.rim, 0.3, 2);
        }
    }

    // Bright hazards — drawn above entities/projectiles, additive.
    drawAbove(ctx, game, L) {
        // Boss shockwaves — bright expanding rings (above entities). Each
        // carves a hazard-tinted light so the danger reads against the dark.
        for (const hz of game.hazards) {
            if (!hz.active || hz.kind !== 'shockwave') continue;
            if (!game._inView(hz.x, hz.y, hz.rMax + CULL_MARGIN)) continue;
            const fade = 1 - Math.min(1, hz.r / hz.rMax);
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.35 + 0.45 * fade;
            ctx.strokeStyle = '#ffd0a0';
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.arc(hz.x, hz.y, hz.r, 0, TWO_PI);
            ctx.stroke();
            ctx.globalAlpha = 0.2 + 0.3 * fade;
            ctx.strokeStyle = LIGHT_COLORS.hazard;
            ctx.lineWidth = 18;
            ctx.beginPath();
            ctx.arc(hz.x, hz.y, hz.r, 0, TWO_PI);
            ctx.stroke();
            ctx.restore();
            if (L) L.addLight(hz.x, hz.y, Lc.hazardRadius, LIGHT_COLORS.hazard, 0.8, 0);
        }

        // Sweeping laser beams: a thin warning line during the telegraph, then a
        // bright hot beam that rotates across its arc. Above entities, additive.
        for (const hz of game.hazards) {
            if (!hz.active || hz.kind !== 'beam') continue;
            const hot = hz.age >= hz.warn;
            const ex = hz.x + Math.cos(hz.curAngle) * hz.length;
            const ey = hz.y + Math.sin(hz.curAngle) * hz.length;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            if (!hot) {
                // Telegraph: a thin, brightening warning line along the start angle.
                const t = hz.age / hz.warn;
                ctx.globalAlpha = 0.25 + 0.45 * t;
                ctx.strokeStyle = BOSS_ATTACK.telegraphColor;
                ctx.lineWidth = 2 + 3 * t;
                ctx.beginPath(); ctx.moveTo(hz.x, hz.y); ctx.lineTo(ex, ey); ctx.stroke();
            } else {
                // Hot beam: a wide soft glow + a bright core.
                ctx.globalAlpha = 0.4;
                ctx.strokeStyle = hz.color || '#ff5a3c';
                ctx.lineWidth = hz.band * 2;
                ctx.lineCap = 'round';
                ctx.beginPath(); ctx.moveTo(hz.x, hz.y); ctx.lineTo(ex, ey); ctx.stroke();
                ctx.globalAlpha = 0.95;
                ctx.strokeStyle = '#fff6e0';
                ctx.lineWidth = Math.max(4, hz.band * 0.5);
                ctx.beginPath(); ctx.moveTo(hz.x, hz.y); ctx.lineTo(ex, ey); ctx.stroke();
            }
            ctx.restore();
            if (L && hot) L.addLight((hz.x + ex) / 2, (hz.y + ey) / 2, Lc.hazardRadius, hz.color || LIGHT_COLORS.hazard, 0.85, 0);
        }
    }
}
