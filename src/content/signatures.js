// signatures.js — the six Grand Signature ults (KINDLED update #3), one per
// hero id. Each `fire(game, angle)` is a SINGLE O(enemies) pass that deals
// damage + statuses through the exact weapon-behavior primitives and returns
// `{ hits, killed }`, which Game merges into _resolveCombat so ult damage, gem
// drops, kill count, Kindle recharge, and cross-element combos all ride the one
// pipeline. The expanding ring / delayed detonation described in the design are
// sold by VFX; the damage lands at cast (the intended single-pass model).
//
// Keyed by CHARACTER id (characters.js): monkey/elf/orc/wizard/berserker/assassin.
// All numbers are tunable. Damage scales with player.damageMul × powerRoll (which
// folds crit + Kael's low-HP rage), so meta upgrades keep mattering.

import { powerRoll } from './weapons.js';
import { applyCombo } from './elements.js';
import { KNOCKBACK } from '../config/GameConfig.js';

// Shared: the damage-scaling roll (once per cast — one cast, one roll). Folds the
// player's ult-damage multiplier (Hero Attunement Lv3) so meta mastery scales ults.
function castMul(p) { return (p.damageMul ?? 1) * (p.ultDamageMul ?? 1) * powerRoll(p); }

// Focused-target bonus (Hero Attunement Lv4): the FOCUSED enemy takes a small extra
// multiple from your Grand Signature. Set per-cast by Game._releaseUlt (setUltFocus)
// right before fire() — synchronous, and an ult never nests inside another — so it
// rides strike() without touching any per-hero fire() loop. null target = no bonus.
let _focusTarget = null, _focusMul = 1;
export function setUltFocus(game) {
    const boost = game && game.player && game.player.focusDamageMul > 1;
    _focusTarget = boost ? game.focusTarget : null;
    _focusMul = boost ? game.player.focusDamageMul : 1;
}
// A combo ctx sharing the ult's own hits/killed arrays.
function comboCtx(game, hits, killed) {
    return { hits, killed, player: game.player, particles: game.particles };
}
// Push a damage hit + route the kill. Applies the focused-target bonus (Lv4) to the
// one locked enemy.
function strike(e, dmg, kx, ky, hits, killed, color) {
    if (_focusTarget && e === _focusTarget) dmg *= _focusMul;
    e.takeDamage(dmg, kx || 0, ky || 0);
    hits.push({ x: e.x, y: e.y - e.radius, amount: dmg, color });
    if (!e.active) killed.push(e);
}
// Knockback components away from (cx,cy) scaled by factor f.
function knockFrom(e, cx, cy, f) {
    const dx = e.x - cx, dy = e.y - cy, len = Math.hypot(dx, dy) || 1;
    return [(dx / len) * KNOCKBACK.strength * f, (dy / len) * KNOCKBACK.strength * f];
}
// Cosmetic flourish: an expanding ring + a cached-glow blast + a capped burst.
function flourish(game, x, y, color, maxR, ringColor) {
    game._spawnRing?.(x, y, { maxR, width: 14, life: 0.6, color: ringColor || color, ease: 'outCubic' });
    game.weaponSystem?.effects?.push({ kind: 'blast', x, y, radius: maxR * 0.5, age: 0, lifetime: 0.5, active: true, color });
    game.particles?.deathBurst?.(x, y, color);
}

export const SIGNATURES = {
    // PYRA — Emberwake Nova (ring). An aimed ignition up to 480px along the aim;
    // a 900px nova ignites everything, knocks back, and mends Pyra per enemy hit.
    monkey: {
        name: 'Emberwake Nova', aimKind: 'ring', color: '#ff8c4a', range: 900,
        fire(game, angle) {
            const hits = [], killed = [], p = game.player;
            const mul = castMul(p), ctx = comboCtx(game, hits, killed);
            const cx = p.x + Math.cos(angle) * 480, cy = p.y + Math.sin(angle) * 480;
            const R = 900, base = 260 * mul, burnDps = 40 * (p.fireRoundScale ?? 1);
            let hitCount = 0;
            for (const e of game.enemies) {
                if (!e.active) continue;
                const dx = e.x - cx, dy = e.y - cy;
                if (dx * dx + dy * dy > R * R) continue;
                const [kx, ky] = knockFrom(e, cx, cy, 0.9);
                strike(e, base, kx, ky, hits, killed, '#ff9a4a');
                if (e.active) { e.applyBurn(burnDps, 3.0); applyCombo(e, 'fire', base, ctx); }
                hitCount++;
            }
            if (hitCount > 0) p.healSustained?.(Math.floor(hitCount / 10) * 10);
            flourish(game, cx, cy, this.color, R);
            return { hits, killed };
        },
    },
    // SYLPHINE — Zephyr Windfall (lane). A gale down the aim: damage + shove, and
    // a 4s window where kills pay double coins (a timer flag read at the drop roll).
    elf: {
        name: 'Zephyr Windfall', aimKind: 'lane', color: '#8fe6c0', range: 1100,
        fire(game, angle) {
            const hits = [], killed = [], p = game.player;
            const mul = castMul(p);
            const ux = Math.cos(angle), uy = Math.sin(angle);
            const len = 1100, halfW = 170, base = 190 * mul;
            for (const e of game.enemies) {
                if (!e.active) continue;
                const rx = e.x - p.x, ry = e.y - p.y;
                const t = rx * ux + ry * uy;            // projection along the lane
                if (t < 0 || t > len) continue;
                const perp = Math.abs(rx * -uy + ry * ux);
                if (perp > halfW + e.radius) continue;
                strike(e, base, ux * KNOCKBACK.strength * 1.1, uy * KNOCKBACK.strength * 1.1, hits, killed, '#b6f0d4');
            }
            game._coinWindfallTimer = 4.0;             // 2× coin window (read at the coin roll)
            flourish(game, p.x + ux * len * 0.5, p.y + uy * len * 0.5, this.color, 360);
            return { hits, killed };
        },
    },
    // GRUK — Unbroken Bulwark (self). A ground slam: radial damage, 1.2s invuln,
    // and a 6s thorn ring (Game-owned hazard) that chews enemies who linger.
    orc: {
        name: 'Unbroken Bulwark', aimKind: 'self', color: '#c8e06a', range: 420,
        fire(game, angle) {
            const hits = [], killed = [], p = game.player;
            const mul = castMul(p);
            const R = 420, base = 240 * mul;
            for (const e of game.enemies) {
                if (!e.active) continue;
                const dx = e.x - p.x, dy = e.y - p.y;
                if (dx * dx + dy * dy > R * R) continue;
                const [kx, ky] = knockFrom(e, p.x, p.y, 0.8);
                strike(e, base, kx, ky, hits, killed, '#dcec9a');
            }
            p.invincibleTimer = Math.max(p.invincibleTimer, 1.2);
            game.hazards?.push({ kind: 'thornRing', x: p.x, y: p.y, r: 300, dps: 20 * mul,
                tickTimer: 0, age: 0, lifetime: 6, rim: '#c8e06a', active: true });
            flourish(game, p.x, p.y, this.color, R);
            return { hits, killed };
        },
    },
    // ORIN — Twin Cataclysm (line). 5 blasts spaced along the aim, alternating
    // fire (burn) and frost (chill + freeze) so the overlaps fire the combo table.
    wizard: {
        name: 'Twin Cataclysm', aimKind: 'line', color: '#b98cff', range: 900,
        fire(game, angle) {
            const hits = [], killed = [], p = game.player;
            const mul = castMul(p), ctx = comboCtx(game, hits, killed);
            const ux = Math.cos(angle), uy = Math.sin(angle), blastR = 150;
            for (let i = 0; i < 5; i++) {
                const bx = p.x + ux * (180 * (i + 1)), by = p.y + uy * (180 * (i + 1));
                const fire = i % 2 === 0;
                const base = (fire ? 90 : 70) * mul;
                for (const e of game.enemies) {
                    if (!e.active) continue;
                    const dx = e.x - bx, dy = e.y - by;
                    if (dx * dx + dy * dy > blastR * blastR) continue;
                    strike(e, base, 0, 0, hits, killed, fire ? '#ff9a4a' : '#8fd8ff');
                    if (!e.active) continue;
                    if (fire) { e.applyBurn(35 * (p.fireRoundScale ?? 1), 3.0); applyCombo(e, 'fire', base, ctx); }
                    else {
                        e.applyChill(Math.max(0.30, 0.6 - (p.chillStrength || 0)), 3.0);
                        if (Math.random() < 0.25) e.applyFreeze(1.0);
                        applyCombo(e, 'frost', base, ctx);
                    }
                }
                flourish(game, bx, by, fire ? '#ff8c4a' : '#8fd8ff', blastR);
            }
            return { hits, killed };
        },
    },
    // KAEL — Pyre of the Brink (self). Sacrifices 15% CURRENT HP (never lethal),
    // a nova that scales with missing HP, and a 5s low-HP damage afterglow.
    berserker: {
        name: 'Pyre of the Brink', aimKind: 'self', color: '#ff5a4a', range: 700,
        fire(game, angle) {
            const hits = [], killed = [], p = game.player;
            const mul = castMul(p);
            // Sacrifice 15% current HP, floored so it never drops below 10% maxHp
            // — and NEVER heals: sac is already 0 when at/under the floor, so a
            // plain subtract leaves HP untouched there (Math.max(floorHp,…) would
            // have healed a below-floor Kael up to the floor).
            const floorHp = p.maxHp * 0.10;
            const sac = Math.min(p.hp * 0.15, Math.max(0, p.hp - floorHp));
            p.hp = Math.max(0, p.hp - sac);
            const missing = Math.max(0, 1 - p.hp / p.maxHp);
            const R = 520 + 4 * (missing * 100), base = 200 * (1 + 1.5 * missing) * mul;
            for (const e of game.enemies) {
                if (!e.active) continue;
                const dx = e.x - p.x, dy = e.y - p.y;
                if (dx * dx + dy * dy > R * R) continue;
                const [kx, ky] = knockFrom(e, p.x, p.y, 0.7);
                strike(e, base, kx, ky, hits, killed, '#ff6a5a');
            }
            // 5s low-HP afterglow — add the +0.25 ONCE, then only refresh the
            // window on recast (Game decays exactly 0.25 on expiry, so an
            // unconditional add would strand a permanent bonus on overlapping casts).
            if (!(p._brinkAfterglow > 0)) p.lowHpDamageBonus = (p.lowHpDamageBonus || 0) + 0.25;
            p._brinkAfterglow = 5.0;
            flourish(game, p.x, p.y, this.color, R);
            return { hits, killed };
        },
    },
    // VESPER — Deathmark (cone). Marks up to 8 in a 70° / 750px cone (elites &
    // bosses first) and detonates each as a guaranteed crit; each marked KILL
    // refunds Kindle so full-value casts loop.
    assassin: {
        name: 'Deathmark', aimKind: 'cone', color: '#ff3b6a', range: 750,
        fire(game, angle) {
            const hits = [], killed = [], p = game.player;
            const mul = castMul(p);
            const R = 750, halfAng = (70 * Math.PI / 180) / 2, crit = p.critMul || 2.0;
            // Gather in-cone enemies, elites/bosses prioritized, cap 8.
            const inCone = [];
            for (const e of game.enemies) {
                if (!e.active) continue;
                const dx = e.x - p.x, dy = e.y - p.y;
                if (dx * dx + dy * dy > R * R) continue;
                let a = Math.atan2(dy, dx) - angle;
                a = Math.atan2(Math.sin(a), Math.cos(a));
                if (Math.abs(a) > halfAng) continue;
                inCone.push(e);
            }
            inCone.sort((a, b) => (b.boss - a.boss) || (b.elite - a.elite));
            const base = 150 * crit * mul;
            let refunded = 0;
            for (let i = 0; i < inCone.length && i < 8; i++) {
                const e = inCone[i];
                strike(e, base, 0, 0, hits, killed, '#ff5a86');
                if (!e.active) refunded += 4;   // Kindle refund per marked kill
            }
            if (refunded > 0) game.kindleSystem?._add?.(refunded);
            flourish(game, p.x + Math.cos(angle) * 300, p.y + Math.sin(angle) * 300, this.color, 400);
            return { hits, killed };
        },
    },
};

// Resolve a hero's signature (falls back to Pyra's so a bad id never crashes).
export function signatureFor(heroId) {
    return SIGNATURES[heroId] || SIGNATURES.monkey;
}
