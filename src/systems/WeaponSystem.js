// Owns the player's weapons + transient weapon effects.
//
// Each owned weapon is { id, level, timer, state } — the per-weapon
// behavior function in src/content/weapons.js advances `state` and reads
// the right per-level stats from WEAPONS[id].perLevel[level].
//
// Evolved weapons live in the same `owned` array; they have
// `WEAPONS[id].maxLevel = 1` and `evolved = true`. evolveWeapon() swaps
// a base entry for its evolved variant in place.

import { MAX_WEAPON_LEVEL } from '../config/GameConfig.js';
import { compactInPlace, TWO_PI } from '../core/MathUtils.js';
import { WEAPONS } from '../content/weapons.js';

function weaponMaxLevel(def) {
    return def?.maxLevel ?? MAX_WEAPON_LEVEL;
}

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
        const def = WEAPONS[id];
        if (w.level >= weaponMaxLevel(def)) return false;
        w.level += 1;
        return true;
    }

    // Replace baseId in the owned list with evolvedId at level 1. Keeps
    // the same slot order so the UI list doesn't jump around.
    evolveWeapon(baseId, evolvedId) {
        const idx = this.owned.findIndex((o) => o.id === baseId);
        if (idx < 0) return false;
        const def = WEAPONS[evolvedId];
        if (!def) return false;
        const initial = def.initialState ? def.initialState() : {};
        this.owned[idx] = { id: evolvedId, level: 1, timer: 0, state: initial };
        return true;
    }

    isMaxLevel(id) {
        const w = this.owned.find((o) => o.id === id);
        if (!w) return false;
        const def = WEAPONS[id];
        return w.level >= weaponMaxLevel(def);
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
        for (const w of this.owned) {
            const def = WEAPONS[w.id];
            if (def.kind !== 'orbit') continue;
            const cfg = def.perLevel[w.level];
            const positions = w.state.bladePositions ?? [];
            const isEvolved = !!def.evolved;
            for (const pos of positions) {
                drawBlade(ctx, pos.x, pos.y, pos.angle, cfg.bladeRadius, isEvolved);
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

    // Snapshot used by UI to list owned weapons with level / max / evolved.
    snapshotForUI() {
        return this.owned.map((w) => {
            const def = WEAPONS[w.id];
            const max = weaponMaxLevel(def);
            return {
                id: w.id,
                name: def?.name ?? w.id,
                level: w.level,
                maxLevel: max,
                isMax: w.level >= max,
                evolved: !!def?.evolved,
            };
        });
    }
}

// ─── Visuals ───────────────────────────────────────────────────────────

function drawBlade(ctx, x, y, angle, size, isEvolved = false) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle * 3);

    // Glow halo behind blade. Wider + gold for evolved, tighter steel
    // for base. Reads as "empowered" without flooding the screen.
    const haloR = size * (isEvolved ? 1.7 : 1.25);
    const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, haloR);
    if (isEvolved) {
        halo.addColorStop(0, 'rgba(255, 240, 160, 0.55)');
        halo.addColorStop(0.6, 'rgba(255, 200, 80, 0.22)');
        halo.addColorStop(1, 'rgba(255, 180, 50, 0)');
    } else {
        halo.addColorStop(0, 'rgba(220, 235, 255, 0.40)');
        halo.addColorStop(1, 'rgba(200, 220, 255, 0)');
    }
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, haloR, 0, TWO_PI);
    ctx.fill();

    // Motion-blur trail behind the leading edge (slightly translucent
    // ghost of the blade pointing opposite to the rotation direction).
    ctx.fillStyle = isEvolved
        ? 'rgba(255, 220, 130, 0.30)'
        : 'rgba(220, 235, 255, 0.28)';
    ctx.beginPath();
    ctx.moveTo(0, -size * 1.1);
    ctx.lineTo(size * 0.55, 0);
    ctx.lineTo(0, size * 1.1);
    ctx.lineTo(-size * 0.55, 0);
    ctx.closePath();
    ctx.fill();

    // Main blade body
    ctx.fillStyle = isEvolved ? '#ffe89a' : '#dde6ee';
    ctx.strokeStyle = isEvolved ? '#7a5018' : '#3a444c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.45, 0);
    ctx.lineTo(0, size);
    ctx.lineTo(-size * 0.45, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Bright inner spine
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.moveTo(0, -size + 4);
    ctx.lineTo(size * 0.18, 0);
    ctx.lineTo(0, size - 4);
    ctx.lineTo(-size * 0.18, 0);
    ctx.closePath();
    ctx.fill();

    // Cross-guard / pommel hint at the centre — small jewel.
    ctx.fillStyle = isEvolved ? '#fff0c4' : '#a8c0d0';
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, TWO_PI);
    ctx.fill();

    ctx.restore();
}

function drawPulse(ctx, fx) {
    const t = fx.age / fx.lifetime;
    const r = fx.radius * (0.35 + t * 0.65);
    const alpha = 1 - t;
    const isEvolved = !!fx.evolved;

    ctx.save();

    // Soft inner fill — keeps enemies visible through the ring.
    const fillGrad = ctx.createRadialGradient(fx.x, fx.y, r * 0.2, fx.x, fx.y, r);
    if (isEvolved) {
        fillGrad.addColorStop(0, `rgba(255, 245, 200, ${alpha * 0.25})`);
        fillGrad.addColorStop(0.7, `rgba(255, 220, 130, ${alpha * 0.18})`);
        fillGrad.addColorStop(1, 'rgba(255, 200, 80, 0)');
    } else {
        fillGrad.addColorStop(0, `rgba(255, 250, 220, ${alpha * 0.16})`);
        fillGrad.addColorStop(1, 'rgba(255, 230, 160, 0)');
    }
    ctx.fillStyle = fillGrad;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, r, 0, TWO_PI);
    ctx.fill();

    // Bright outer ring
    ctx.strokeStyle = isEvolved
        ? `rgba(255, 240, 160, ${alpha * 0.95})`
        : `rgba(255, 245, 195, ${alpha * 0.9})`;
    ctx.lineWidth = isEvolved ? 14 : 8;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, r, 0, TWO_PI);
    ctx.stroke();

    // Thin inner ring trailing behind for a layered look
    ctx.strokeStyle = isEvolved
        ? `rgba(255, 220, 100, ${alpha * 0.55})`
        : `rgba(255, 240, 180, ${alpha * 0.45})`;
    ctx.lineWidth = isEvolved ? 5 : 3;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, r * 0.86, 0, TWO_PI);
    ctx.stroke();

    // Evolved gets faint outer halo too.
    if (isEvolved) {
        ctx.strokeStyle = `rgba(255, 250, 220, ${alpha * 0.35})`;
        ctx.lineWidth = 22;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, r * 1.05, 0, TWO_PI);
        ctx.stroke();
    }

    ctx.restore();
}

function drawLightning(ctx, fx) {
    const t = fx.age / fx.lifetime;
    const alpha = 1 - t;
    const isEvolved = !!fx.evolved;
    const isChain = !!fx.chain;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Outer glow (thicker on evolved, thinner on chain links).
    const glowWidth = isEvolved ? (isChain ? 7 : 12) : 9;
    ctx.strokeStyle = isEvolved
        ? `rgba(190, 230, 255, ${alpha * (isChain ? 0.8 : 0.95)})`
        : `rgba(180, 220, 255, ${alpha * 0.85})`;
    ctx.lineWidth = glowWidth;
    drawLightningPath(ctx, fx.x, fx.y, false);

    // Side forks branching off the main bolt — visual richness, no
    // gameplay impact. Forks fade slightly faster.
    ctx.strokeStyle = isEvolved
        ? `rgba(170, 215, 255, ${alpha * 0.6})`
        : `rgba(170, 215, 255, ${alpha * 0.5})`;
    ctx.lineWidth = isEvolved ? 5 : 4;
    drawLightningPath(ctx, fx.x, fx.y, true);

    // Bright white core.
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.lineWidth = isEvolved && !isChain ? 4 : 3;
    drawLightningPath(ctx, fx.x, fx.y, false);

    // Bright impact flash at the strike point
    const flashR = (isEvolved ? 22 : 16) * (1 - t * 0.7);
    const flash = ctx.createRadialGradient(fx.x, fx.y, 1, fx.x, fx.y, flashR);
    flash.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.95})`);
    flash.addColorStop(0.6, `rgba(170, 220, 255, ${alpha * 0.4})`);
    flash.addColorStop(1, 'rgba(170, 220, 255, 0)');
    ctx.fillStyle = flash;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, flashR, 0, TWO_PI);
    ctx.fill();

    ctx.restore();
}

// Main bolt path + optional forks. Forks branch off mid-bolt to give
// the strike its jagged "thunder" feel.
function drawLightningPath(ctx, x, y, withForks) {
    ctx.beginPath();
    ctx.moveTo(x + 24, y - 420);
    ctx.lineTo(x - 18, y - 300);
    ctx.lineTo(x + 12, y - 200);
    ctx.lineTo(x - 14, y - 100);
    ctx.lineTo(x + 6, y - 30);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (withForks) {
        ctx.beginPath();
        ctx.moveTo(x - 18, y - 300);
        ctx.lineTo(x - 44, y - 250);
        ctx.lineTo(x - 36, y - 220);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 12, y - 200);
        ctx.lineTo(x + 40, y - 160);
        ctx.lineTo(x + 32, y - 130);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 14, y - 100);
        ctx.lineTo(x - 32, y - 70);
        ctx.stroke();
    }
}
