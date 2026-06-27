// Owns the player's weapons + transient weapon effects.
//
// Each owned weapon is { id, level, timer, state } — the per-weapon
// behavior function in src/content/weapons.js advances `state` and reads
// the right per-level stats from WEAPONS[id].perLevel[level].
//
// Adding a new weapon: write a definition + behavior in content/weapons.js
// and call game.weaponSystem.addWeapon('id'). No system code changes.

import { MAX_WEAPON_LEVEL } from '../config/GameConfig.js';
import { compactInPlace } from '../core/MathUtils.js';
import { WEAPONS } from '../content/weapons.js';

export class WeaponSystem {
    constructor() {
        this.owned = [];
        this.effects = [];
        this.addWeapon('arcaneBolt');
    }

    addWeapon(id) {
        const def = WEAPONS[id];
        if (!def) return null;
        if (this.owned.find((w) => w.id === id)) return null;
        const initial = def.initialState ? def.initialState() : {};
        const entry = { id, level: 1, timer: 0, state: initial };
        this.owned.push(entry);
        return entry;
    }

    levelUpWeapon(id) {
        const w = this.owned.find((o) => o.id === id);
        if (!w) return false;
        if (w.level >= MAX_WEAPON_LEVEL) return false;
        w.level += 1;
        return true;
    }

    isMaxLevel(id) {
        const w = this.owned.find((o) => o.id === id);
        return !!w && w.level >= MAX_WEAPON_LEVEL;
    }

    update(dt, player, enemies, projectiles) {
        const hits = [];
        const killed = [];
        const ctx = {
            player,
            enemies,
            projectiles,
            effects: this.effects,
            hits,
            killed,
        };
        for (const w of this.owned) {
            const def = WEAPONS[w.id];
            if (def && def.update) def.update(dt, w, ctx);
        }
        this._updateEffects(dt);
        return { hits, killed };
    }

    _updateEffects(dt) {
        for (const fx of this.effects) {
            if (!fx.active) continue;
            fx.age += dt;
            if (fx.age >= fx.lifetime) fx.active = false;
        }
        compactInPlace(this.effects);
    }

    drawWeaponVisuals(ctx, player) {
        // Orbit blades — rendered in world space around the player.
        for (const w of this.owned) {
            const def = WEAPONS[w.id];
            if (def.kind !== 'orbit') continue;
            const cfg = def.perLevel[w.level];
            const positions = w.state.bladePositions ?? [];
            for (const pos of positions) {
                drawBlade(ctx, pos.x, pos.y, pos.angle, cfg.bladeRadius);
            }
        }
    }

    drawEffects(ctx) {
        for (const fx of this.effects) {
            if (!fx.active) continue;
            if (fx.kind === 'pulse') drawPulse(ctx, fx);
            else if (fx.kind === 'lightning') drawLightning(ctx, fx);
        }
    }

    // Snapshot used by UI to list owned weapons with their level/max flag.
    snapshotForUI() {
        return this.owned.map((w) => ({
            id: w.id,
            name: WEAPONS[w.id]?.name ?? w.id,
            level: w.level,
            isMax: w.level >= MAX_WEAPON_LEVEL,
        }));
    }
}

// ─── Visuals ───────────────────────────────────────────────────────────

function drawBlade(ctx, x, y, angle, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle * 3);
    ctx.fillStyle = '#dde6ee';
    ctx.strokeStyle = '#5a6770';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.45, 0);
    ctx.lineTo(0, size);
    ctx.lineTo(-size * 0.45, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(0, -size + 4);
    ctx.lineTo(size * 0.18, 0);
    ctx.lineTo(0, size - 4);
    ctx.lineTo(-size * 0.18, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawPulse(ctx, fx) {
    const t = fx.age / fx.lifetime;
    const r = fx.radius * (0.35 + t * 0.65);
    const alpha = 1 - t;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 240, 180, ${alpha * 0.9})`;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(255, 230, 160, ${alpha * 0.12})`;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawLightning(ctx, fx) {
    const t = fx.age / fx.lifetime;
    const alpha = 1 - t;
    ctx.save();
    ctx.lineCap = 'round';

    // Outer glow
    ctx.strokeStyle = `rgba(180, 220, 255, ${alpha * 0.85})`;
    ctx.lineWidth = 8;
    drawLightningPath(ctx, fx.x, fx.y);

    // Bright core
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.lineWidth = 3;
    drawLightningPath(ctx, fx.x, fx.y);

    ctx.restore();
}

function drawLightningPath(ctx, x, y) {
    ctx.beginPath();
    ctx.moveTo(x + 24, y - 420);
    ctx.lineTo(x - 18, y - 300);
    ctx.lineTo(x + 12, y - 200);
    ctx.lineTo(x - 14, y - 100);
    ctx.lineTo(x + 6, y - 30);
    ctx.lineTo(x, y);
    ctx.stroke();
}
