// Weapon definitions + behavior functions.
//
// Each weapon has:
//   id            stable string used by save/upgrade/UI lookups
//   name          shown on cards and HUD
//   description   one-liner shown on cards
//   kind          'projectile' | 'orbit' | 'pulse' | 'lightning' — picks behavior
//   evolvesTo     optional id of an evolved version (hook for a later stage)
//   perLevel      array indexed 1..MAX_WEAPON_LEVEL of stat objects
//   initialState  optional () => state object stored on each owned entry
//   update        (dt, owned, ctx) — runs every frame for each owned weapon
//
// `owned` is { id, level, timer, state } — owned by WeaponSystem.
// `ctx`   is { player, enemies, projectiles, effects, hits, killed } —
// behavior functions push damage hits / killed enemies / visual effects
// into the arrays so Game can fan them out (gem drops, damage numbers,
// screen shake, etc.) just like the existing CollisionSystem pipeline.

import { TWO_PI, circleOverlap } from '../core/MathUtils.js';
import { INTERNAL_WIDTH, INTERNAL_HEIGHT, KNOCKBACK } from '../config/GameConfig.js';
import { Projectile } from '../entities/Projectile.js';

export const WEAPONS = {
    arcaneBolt: {
        id: 'arcaneBolt',
        name: 'Arcane Bolt',
        description: 'Fires a magic bolt at the nearest foe.',
        kind: 'projectile',
        evolvesTo: null,
        perLevel: [
            null,
            { damage: 12, cooldown: 0.60, projectileSpeed: 900,  pierce: 0, projectileRadius: 14 },
            { damage: 15, cooldown: 0.55, projectileSpeed: 940,  pierce: 0, projectileRadius: 14 },
            { damage: 18, cooldown: 0.50, projectileSpeed: 980,  pierce: 0, projectileRadius: 15 },
            { damage: 21, cooldown: 0.46, projectileSpeed: 1020, pierce: 1, projectileRadius: 15 },
            { damage: 24, cooldown: 0.42, projectileSpeed: 1060, pierce: 1, projectileRadius: 16 },
            { damage: 28, cooldown: 0.38, projectileSpeed: 1120, pierce: 1, projectileRadius: 16 },
            { damage: 32, cooldown: 0.34, projectileSpeed: 1180, pierce: 2, projectileRadius: 17 },
            { damage: 38, cooldown: 0.30, projectileSpeed: 1260, pierce: 2, projectileRadius: 18 },
        ],
        update: arcaneBoltUpdate,
    },

    orbitingBlade: {
        id: 'orbitingBlade',
        name: 'Orbiting Blade',
        description: 'Spinning blades that circle the monkey.',
        kind: 'orbit',
        evolvesTo: null,
        perLevel: [
            null,
            { bladeCount: 1, damage: 10, orbitSpeed: 3.2, orbitRadius: 110, bladeRadius: 24, hitCooldown: 0.35 },
            { bladeCount: 2, damage: 10, orbitSpeed: 3.2, orbitRadius: 110, bladeRadius: 24, hitCooldown: 0.35 },
            { bladeCount: 2, damage: 12, orbitSpeed: 3.4, orbitRadius: 120, bladeRadius: 26, hitCooldown: 0.32 },
            { bladeCount: 3, damage: 12, orbitSpeed: 3.4, orbitRadius: 120, bladeRadius: 26, hitCooldown: 0.32 },
            { bladeCount: 3, damage: 14, orbitSpeed: 3.6, orbitRadius: 130, bladeRadius: 28, hitCooldown: 0.30 },
            { bladeCount: 4, damage: 14, orbitSpeed: 3.6, orbitRadius: 130, bladeRadius: 28, hitCooldown: 0.30 },
            { bladeCount: 4, damage: 16, orbitSpeed: 3.8, orbitRadius: 140, bladeRadius: 30, hitCooldown: 0.28 },
            { bladeCount: 5, damage: 18, orbitSpeed: 4.0, orbitRadius: 145, bladeRadius: 32, hitCooldown: 0.26 },
        ],
        initialState() { return { baseAngle: 0, bladePositions: [] }; },
        update: orbitingBladeUpdate,
    },

    holyPulse: {
        id: 'holyPulse',
        name: 'Holy Pulse',
        description: 'A radiant burst hits everything around you.',
        kind: 'pulse',
        evolvesTo: null,
        perLevel: [
            null,
            { radius: 220, damage: 10, cooldown: 3.0 },
            { radius: 240, damage: 12, cooldown: 2.8 },
            { radius: 260, damage: 14, cooldown: 2.6 },
            { radius: 280, damage: 16, cooldown: 2.4 },
            { radius: 310, damage: 18, cooldown: 2.2 },
            { radius: 340, damage: 22, cooldown: 2.0 },
            { radius: 380, damage: 26, cooldown: 1.8 },
            { radius: 420, damage: 32, cooldown: 1.6 },
        ],
        update: holyPulseUpdate,
    },

    lightningMark: {
        id: 'lightningMark',
        name: 'Lightning Mark',
        description: 'Lightning strikes random nearby foes.',
        kind: 'lightning',
        evolvesTo: null,
        perLevel: [
            null,
            { strikes: 1, damage: 18, cooldown: 2.4, range: 1100 },
            { strikes: 2, damage: 18, cooldown: 2.4, range: 1100 },
            { strikes: 2, damage: 22, cooldown: 2.2, range: 1150 },
            { strikes: 3, damage: 22, cooldown: 2.0, range: 1150 },
            { strikes: 3, damage: 26, cooldown: 1.8, range: 1200 },
            { strikes: 4, damage: 28, cooldown: 1.6, range: 1200 },
            { strikes: 5, damage: 32, cooldown: 1.5, range: 1250 },
            { strikes: 6, damage: 38, cooldown: 1.4, range: 1300 },
        ],
        update: lightningMarkUpdate,
    },
};

export const WEAPON_IDS = Object.keys(WEAPONS);

// ─── Behavior functions ────────────────────────────────────────────────

// Arcane Bolt: cooldown timer; on tick fire one Projectile at the nearest
// active enemy. Holds the timer at 0 when there are no targets so the next
// enemy to appear gets shot immediately instead of waiting a full cycle.
function arcaneBoltUpdate(dt, owned, ctx) {
    const cfg = WEAPONS.arcaneBolt.perLevel[owned.level];
    owned.timer -= dt;
    if (owned.timer > 0) return;

    const target = nearestEnemy(ctx.player, ctx.enemies);
    if (!target) {
        if (owned.timer < 0) owned.timer = 0;
        return;
    }

    const dx = target.x - ctx.player.x;
    const dy = target.y - ctx.player.y;
    const len = Math.hypot(dx, dy) || 1;
    const vx = (dx / len) * cfg.projectileSpeed;
    const vy = (dy / len) * cfg.projectileSpeed;
    ctx.projectiles.push(new Projectile(ctx.player.x, ctx.player.y, vx, vy, {
        damage: cfg.damage,
        radius: cfg.projectileRadius,
        pierce: cfg.pierce,
    }));
    owned.timer = cfg.cooldown;
}

// Orbiting Blade: advance shared base angle; recompute blade positions; for
// each blade, damage any overlapping enemy whose weaponHitCooldown is 0.
// Hit cooldown is stored on the enemy itself so multiple weapons share
// fairness against the same target.
function orbitingBladeUpdate(dt, owned, ctx) {
    const cfg = WEAPONS.orbitingBlade.perLevel[owned.level];
    owned.state.baseAngle += cfg.orbitSpeed * dt;
    if (owned.state.baseAngle > TWO_PI) owned.state.baseAngle -= TWO_PI;

    const positions = owned.state.bladePositions;
    positions.length = 0;
    for (let i = 0; i < cfg.bladeCount; i++) {
        const angle = owned.state.baseAngle + (i * TWO_PI / cfg.bladeCount);
        positions.push({
            x: ctx.player.x + Math.cos(angle) * cfg.orbitRadius,
            y: ctx.player.y + Math.sin(angle) * cfg.orbitRadius,
            angle,
        });
    }

    for (const e of ctx.enemies) {
        if (!e.active) continue;
        if (e.weaponHitCooldown > 0) continue;
        for (const pos of positions) {
            if (!circleOverlap(pos.x, pos.y, cfg.bladeRadius, e.x, e.y, e.radius)) continue;
            const dx = e.x - ctx.player.x;
            const dy = e.y - ctx.player.y;
            const len = Math.hypot(dx, dy) || 1;
            const kx = (dx / len) * KNOCKBACK.strength * 0.45;
            const ky = (dy / len) * KNOCKBACK.strength * 0.45;
            e.takeDamage(cfg.damage, kx, ky);
            ctx.hits.push({ x: e.x, y: e.y - e.radius, amount: cfg.damage });
            if (!e.active) ctx.killed.push(e);
            e.weaponHitCooldown = cfg.hitCooldown;
            break;
        }
    }
}

// Holy Pulse: on cooldown, damage every enemy within `radius` once, then
// spawn a fading ring effect for visual feedback. Light radial knockback so
// crowds get nudged outward.
function holyPulseUpdate(dt, owned, ctx) {
    const cfg = WEAPONS.holyPulse.perLevel[owned.level];
    owned.timer -= dt;
    if (owned.timer > 0) return;
    owned.timer = cfg.cooldown;

    for (const e of ctx.enemies) {
        if (!e.active) continue;
        if (!circleOverlap(ctx.player.x, ctx.player.y, cfg.radius, e.x, e.y, e.radius)) continue;
        const dx = e.x - ctx.player.x;
        const dy = e.y - ctx.player.y;
        const len = Math.hypot(dx, dy) || 1;
        const kx = (dx / len) * KNOCKBACK.strength * 0.35;
        const ky = (dy / len) * KNOCKBACK.strength * 0.35;
        e.takeDamage(cfg.damage, kx, ky);
        ctx.hits.push({ x: e.x, y: e.y - e.radius, amount: cfg.damage });
        if (!e.active) ctx.killed.push(e);
    }

    ctx.effects.push({
        kind: 'pulse',
        x: ctx.player.x,
        y: ctx.player.y,
        radius: cfg.radius,
        age: 0,
        lifetime: 0.45,
        active: true,
    });
}

// Lightning Mark: on cooldown, pick up to N random enemies within `range`
// of the player and zap them. Waits if no valid targets are on screen.
function lightningMarkUpdate(dt, owned, ctx) {
    const cfg = WEAPONS.lightningMark.perLevel[owned.level];
    owned.timer -= dt;
    if (owned.timer > 0) return;

    const candidates = [];
    const rsq = cfg.range * cfg.range;
    for (const e of ctx.enemies) {
        if (!e.active) continue;
        const dx = e.x - ctx.player.x;
        const dy = e.y - ctx.player.y;
        if (dx * dx + dy * dy <= rsq) candidates.push(e);
    }
    if (candidates.length === 0) {
        if (owned.timer < 0) owned.timer = 0;
        return;
    }

    const n = Math.min(cfg.strikes, candidates.length);
    for (let i = 0; i < n; i++) {
        const idx = Math.floor(Math.random() * candidates.length);
        const target = candidates.splice(idx, 1)[0];
        target.takeDamage(cfg.damage);
        ctx.hits.push({ x: target.x, y: target.y - target.radius, amount: cfg.damage });
        if (!target.active) ctx.killed.push(target);
        ctx.effects.push({
            kind: 'lightning',
            x: target.x,
            y: target.y,
            age: 0,
            lifetime: 0.22,
            active: true,
        });
    }
    owned.timer = cfg.cooldown;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function nearestEnemy(player, enemies) {
    let best = null;
    let bestSq = Infinity;
    for (const e of enemies) {
        if (!e.active) continue;
        const dx = e.x - player.x;
        const dy = e.y - player.y;
        const dsq = dx * dx + dy * dy;
        if (dsq < bestSq) {
            bestSq = dsq;
            best = e;
        }
    }
    return best;
}
