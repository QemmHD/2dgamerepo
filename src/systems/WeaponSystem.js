// Owns the player's weapons + transient weapon effects.
//
// Each owned weapon is { id, level, timer, state } — the per-weapon
// behavior function in src/content/weapons.js advances `state` and reads
// the right per-level stats from WEAPONS[id].perLevel[level].
//
// Evolved weapons live in the same `owned` array; they have
// `WEAPONS[id].maxLevel = 1` and `evolved = true`. evolveWeapon() swaps
// a base entry for its evolved variant in place.

import { MAX_WEAPON_LEVEL, MAX_WEAPON_SLOTS, INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../config/GameConfig.js';
import { compactInPlace, TWO_PI } from '../core/MathUtils.js';
import { resolveWeaponProp } from '../content/weaponSkins.js';
import { getGlowSprite } from '../assets/ProceduralSprites.js';

// How long a weapon's "just fired" flick (in-hand thrust + tip muzzle flash)
// reads for after it shoots. A real fire resets the weapon timer to its
// cooldown (≥0.24s), so a jump this big in one frame is an unambiguous fire.
const FIRE_FLASH_DUR = 0.14;
const FIRE_DELTA = 0.05;

// Auto-aim weapons only acquire targets within the visible viewport (the
// camera follows the player, so the player is the screen center). A small
// margin lets a foe right at the edge still be shot, avoiding a dead ring.
const TARGET_MARGIN = 60;
// Chaos pass: auto-aim only engages enemies within this radius (was the whole
// screen). Shots no longer reach across the arena, so enemies close right up on
// the player before dying — far more frantic. Radius weapons are unaffected.
export const AUTO_AIM_RANGE = 620;
import { WEAPONS } from '../content/weapons.js';

function weaponMaxLevel(def) {
    return def?.maxLevel ?? MAX_WEAPON_LEVEL;
}

// Level a fusion starts at: floor of the ingredients' average level, clamped
// to [1, fusion maxLevel]. Exported so the Wick Shrine card can show the exact
// result level BEFORE the player commits the fuse (an informed trade).
export function fusedLevel(ownedA, ownedB, fusedDef) {
    const la = ownedA?.level ?? 1;
    const lb = ownedB?.level ?? 1;
    return Math.max(1, Math.min(weaponMaxLevel(fusedDef), Math.floor((la + lb) / 2)));
}

export class WeaponSystem {
    constructor(startingWeaponId = 'arcaneBolt') {
        this.owned = [];
        this.effects = [];
        // Bumped whenever the owned set / a weapon level / an evolution changes,
        // so consumers (the aura) can detect changes without a per-frame scan.
        this.version = 0;
        // Cached held-weapon visuals (rebuilt on version change — see
        // getOwnedVisuals). -1 forces a build on first request.
        this._visuals = [];
        this._visualsVersion = -1;
        // The run's starting weapon comes from the equipped loadout gear; falls
        // back to the Cinderbolt if the id is missing/unknown.
        this.addWeapon(WEAPONS[startingWeaponId] ? startingWeaponId : 'arcaneBolt');
    }

    addWeapon(id) {
        const def = WEAPONS[id];
        if (!def) return null;
        if (this.owned.find((w) => w.id === id)) return null;
        // Weapon/ability SLOT CAP (P0.3). The draft already stops offering new
        // weapons at a full loadout (UpgradeSystem gates the pool); this is the
        // belt-and-braces so no other grant path can overfill the loadout.
        // Evolutions/fusions bypass this by design: they REPLACE slots.
        if (this.owned.length >= MAX_WEAPON_SLOTS) return null;
        const initial = def.initialState ? def.initialState() : {};
        const entry = { id, level: 1, timer: 0, state: initial };
        this.owned.push(entry);
        this.version++;
        return entry;
    }

    levelUpWeapon(id) {
        const w = this.owned.find((o) => o.id === id);
        if (!w) return false;
        const def = WEAPONS[id];
        if (w.level >= weaponMaxLevel(def)) return false;
        w.level += 1;
        this.version++;
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
        this.version++;
        return true;
    }

    // Fuse two owned weapons into a new fusion weapon (Wick Shrine "fuse"). The
    // first ingredient's slot becomes the fusion (keeping slot order stable); the
    // second is removed. No-op unless BOTH ingredients are owned and the fusion
    // def exists — so it can never drop the player to zero weapons.
    // The result INHERITS its ingredients' investment — level = floor of their
    // average, clamped to the fusion's maxLevel — never an L8+L8 → L1 punish
    // (though the clamp can still trade peak DPS for utility — see fusions.js).
    fuseWeapons(idA, idB, fusedId) {
        const idxA = this.owned.findIndex((o) => o.id === idA);
        const idxB = this.owned.findIndex((o) => o.id === idB);
        const def = WEAPONS[fusedId];
        if (idxA < 0 || idxB < 0 || idxA === idxB || !def) return false;
        const initial = def.initialState ? def.initialState() : {};
        const level = fusedLevel(this.owned[idxA], this.owned[idxB], def);
        const keep = Math.min(idxA, idxB);
        const drop = Math.max(idxA, idxB);
        this.owned.splice(drop, 1);            // remove the second ingredient first
        this.owned[keep] = { id: fusedId, level, timer: 0, state: initial };
        this.version++;
        return true;
    }

    isMaxLevel(id) {
        const w = this.owned.find((o) => o.id === id);
        if (!w) return false;
        const def = WEAPONS[id];
        return w.level >= weaponMaxLevel(def);
    }

    update(dt, player, enemies, projectiles, obstacleSystem = null, particles = null, audio = null, focus = null) {
        const hits = [];
        const killed = [];
        // los(ex, ey) → can the player "see" that point? Walls block melee
        // (orbit), pulse, and lightning weapons. Projectiles handle walls
        // themselves (they despawn on impact in Game's projectile loop).
        const los = obstacleSystem
            ? (ex, ey) => obstacleSystem.hasLineOfSight(player.x, player.y, ex, ey)
            : () => true;
        // solidBlocked(ax,ay,bx,by) → does ANY solid obstacle (incl. non-
        // sight-blockers like fences/graves) sit on the segment? Shadow Dash
        // uses this so it never blinks the player into a solid footprint.
        const solidBlocked = obstacleSystem
            ? (ax, ay, bx, by) => obstacleSystem.segmentBlocked(ax, ay, bx, by)
            : () => false;
        // On-screen test for auto-aim target selection (player-centered).
        const halfW = INTERNAL_WIDTH / 2 + TARGET_MARGIN;
        const halfH = INTERNAL_HEIGHT / 2 + TARGET_MARGIN;
        const rangeSq = AUTO_AIM_RANGE * AUTO_AIM_RANGE;
        // Target only enemies that are both within the shorter auto-aim radius
        // AND on-screen (so shots never fly at far/off-screen foes).
        const inView = (x, y) => {
            const dx = x - player.x, dy = y - player.y;
            return dx * dx + dy * dy <= rangeSq && Math.abs(dx) <= halfW && Math.abs(dy) <= halfH;
        };
        const ctx = {
            player,
            enemies,
            projectiles,
            effects: this.effects,
            hits,
            killed,
            los,
            solidBlocked,
            particles,
            inView,
            audio,
            // KINDLED Focus targeting: the locked enemy (or null). The shared
            // nearestEnemy helper prefers it when it's alive + passes inView, so
            // single-target weapons concentrate fire; radius/orbit are untouched.
            focus,
        };
        for (const w of this.owned) {
            const def = WEAPONS[w.id];
            // Decay the held-weapon fire flick + clear the per-frame fired flag,
            // then watch the cooldown timer: a behavior that fires resets its
            // timer up to the cooldown, so a big positive jump means "fired".
            if (w.fireFlash > 0) w.fireFlash = Math.max(0, w.fireFlash - dt);
            w.firedThisFrame = false;
            const prevTimer = w.timer;
            if (def && def.update) def.update(dt, w, ctx);
            if (w.timer > prevTimer + FIRE_DELTA) {
                w.firedThisFrame = true;
                w.fireFlash = FIRE_FLASH_DUR;
            }
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
            const cfg = def.perLevel[w.level];
            const isEvolved = !!def.evolved;
            if (def.kind === 'orbit') {
                const positions = w.state.bladePositions ?? [];
                for (const pos of positions) {
                    drawBlade(ctx, pos.x, pos.y, pos.angle, cfg.bladeRadius, isEvolved);
                }
            } else if (def.kind === 'trail') {
                // Ground-fire first so fangs/beams layer above it.
                drawTrailPatches(ctx, w.state.patches, cfg);
            } else if (def.kind === 'mine') {
                drawMines(ctx, w.state.mines, cfg);
            } else if (def.kind === 'boomerang') {
                for (const d of w.state.discs) drawFang(ctx, d, cfg.discRadius, isEvolved);
            } else if (def.kind === 'beam') {
                drawBeam(ctx, player, w.state, cfg, isEvolved);
            }
        }
    }

    drawEffects(ctx) {
        for (const fx of this.effects) {
            if (!fx.active) continue;
            if (fx.kind === 'pulse') drawPulse(ctx, fx);
            else if (fx.kind === 'lightning') drawLightning(ctx, fx);
            else if (fx.kind === 'frostmote') drawFrostmote(ctx, fx);
            else if (fx.kind === 'blast') drawBlast(ctx, fx);
        }
    }

    // Held-weapon visuals for the player: only the signature weapon (owned[0],
    // the menu-chosen starter — isPrimary) is drawn in-hand; the rest of the
    // loadout draws nothing here (their projectiles/rings ARE their visual).
    // The stable per-weapon descriptor (id/prop/accent/glow/kind/primary)
    // is rebuilt only when the owned set changes (version bump); each frame we
    // just refresh the transient `fireFlash` (0..1) so there's no per-frame
    // allocation. Descriptors with no
    // prop (e.g. Cinder Aura, Shadow Dash) are omitted — those read as aura.
    getOwnedVisuals() {
        if (this._visualsVersion !== this.version) {
            this._visualsVersion = this.version;
            this._visuals = [];
            for (let i = 0; i < this.owned.length; i++) {
                const w = this.owned[i];
                const propInfo = resolveWeaponProp(w.id);
                if (!propInfo) continue;
                const def = WEAPONS[w.id];
                this._visuals.push({
                    w,
                    prop: propInfo.prop,
                    accent: propInfo.accent,
                    glow: propInfo.glow,
                    kind: def?.kind ?? 'special',
                    isPrimary: i === 0,
                    fireFlash: 0,
                });
            }
        }
        for (const v of this._visuals) v.fireFlash = (v.w.fireFlash || 0) / FIRE_FLASH_DUR;
        return this._visuals;
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
                element: def?.element ?? null,
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
    // Draw the bright ring AT the true damage radius (was 0.35→1.0, which made
    // the visible ring hug the character and only reach full size as it faded
    // out). Now it reads at ~0.82→1.06× radius, matching where damage lands.
    const r = fx.radius * (0.82 + t * 0.24);
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

// Frostmote burst: a faint expanding chill ring + pale-blue diamond shards
// drifting outward. Cosmetic only (the chill/damage is applied in the ability
// update). No per-frame gradient — cheap stroked rings + small filled shards.
function drawFrostmote(ctx, fx) {
    const t = fx.age / fx.lifetime;
    const alpha = (1 - t);
    ctx.save();
    // Soft chill ring expanding to the effect radius.
    ctx.strokeStyle = `rgba(150, 220, 255, ${alpha * 0.4})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, fx.radius * (0.45 + t * 0.55), 0, TWO_PI);
    ctx.stroke();
    // Drifting shards.
    for (const m of fx.motes) {
        const dist = Math.min(m.r0 + m.spd * fx.age, fx.radius);
        const mx = fx.x + Math.cos(m.a) * dist;
        const my = fx.y + Math.sin(m.a) * dist;
        const s = 4 + 5 * alpha;
        ctx.fillStyle = `rgba(205, 240, 255, ${alpha * 0.95})`;
        ctx.beginPath();
        ctx.moveTo(mx, my - s);
        ctx.lineTo(mx + s * 0.55, my);
        ctx.lineTo(mx, my + s);
        ctx.lineTo(mx - s * 0.55, my);
        ctx.closePath();
        ctx.fill();
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

// ─── Armory pt. 1 visuals (boomerang / beam / mine / trail / blast) ─────
// iOS discipline: every soft glow below is a cached getGlowSprite blit —
// NO createRadialGradient in any of these per-frame paths; the rest is flat
// strokes/fills.

// Every glow color the weapon visuals below pass to getGlowSprite. Prewarmed
// at boot by main.js (alongside WEAPON_AURA) so the FIRST wakefire patch /
// beam frame / mine never rasterizes a 128px glow canvas mid-frame — some of
// these (e.g. the patch '#ff7a3c') appear in no aura entry, and none may rely
// on an incidental aura-color match.
export const WEAPON_FX_GLOWS = ['#ff7a3c', '#ff6a3c', '#ff7a2a', '#ff9a4a', '#ffb060', '#ffd98a'];

// Wakefire ground patches: a warm cached-glow pool + a small bright heart.
// Alpha tracks remaining life so patches visibly gutter out.
function drawTrailPatches(ctx, patches, cfg) {
    if (!patches || patches.length === 0) return;
    const glow = getGlowSprite('#ff7a3c');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const pa of patches) {
        const life = 1 - pa.age / cfg.patchLife;
        if (life <= 0) continue;
        const g = cfg.patchRadius * 2.4;
        ctx.globalAlpha = 0.20 + 0.35 * life;
        ctx.drawImage(glow, pa.x - g / 2, pa.y - g / 2, g, g);
        // Flickering heart — deterministic per patch (no per-frame RNG).
        const flick = 0.85 + 0.15 * Math.sin(pa.age * 9 + pa.x * 0.13);
        ctx.globalAlpha = (0.25 + 0.4 * life) * flick;
        ctx.fillStyle = '#ffb060';
        ctx.beginPath();
        ctx.arc(pa.x, pa.y, cfg.patchRadius * 0.32 * flick, 0, TWO_PI);
        ctx.fill();
    }
    ctx.restore();
}

// Cindermines: a dark shell with a pulsing ember eye; armed mines add the
// cached glow so "live" reads at a glance. Trigger ring stays subtle.
function drawMines(ctx, mines, cfg) {
    if (!mines || mines.length === 0) return;
    const glow = getGlowSprite('#ff6a3c');
    ctx.save();
    for (const m of mines) {
        const armed = m.age >= cfg.armTime;
        const pulse = 0.6 + 0.4 * Math.sin(m.age * (armed ? 6 : 14));
        if (armed) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.30 + 0.25 * pulse;
            const g = 84;
            ctx.drawImage(glow, m.x - g / 2, m.y - g / 2, g, g);
            ctx.globalCompositeOperation = 'source-over';
        }
        // Shell.
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#3a2620';
        ctx.strokeStyle = '#1c1210';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 11, 0, TWO_PI);
        ctx.fill();
        ctx.stroke();
        // Ember eye.
        ctx.fillStyle = armed ? '#ffb060' : '#7a4630';
        ctx.globalAlpha = 0.5 + 0.5 * pulse;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 4.5, 0, TWO_PI);
        ctx.fill();
    }
    ctx.restore();
}

// Ashfang: a spinning cinder crescent with a cached-glow halo and a short
// additive smear opposite its spin so the return arc reads as motion.
function drawFang(ctx, d, size, isEvolved) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = isEvolved ? 0.55 : 0.4;
    const g = size * (isEvolved ? 3.4 : 2.8);
    ctx.drawImage(getGlowSprite(isEvolved ? '#ff7a2a' : '#ff9a4a'), d.x - g / 2, d.y - g / 2, g, g);
    ctx.restore();

    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.spin);
    // Fang body: a curved cinder crescent (two arcs), never a blade.
    ctx.fillStyle = isEvolved ? '#ffc27a' : '#ff9a4a';
    ctx.strokeStyle = '#5a2410';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.95, -0.55 * Math.PI, 0.55 * Math.PI);
    ctx.arc(size * 0.42, 0, size * 0.62, 0.5 * Math.PI, -0.5 * Math.PI, true);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Hot inner edge.
    ctx.strokeStyle = 'rgba(255, 240, 200, 0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.8, -0.45 * Math.PI, 0.45 * Math.PI);
    ctx.stroke();
    ctx.restore();
}

// Kindle Ray: layered flat strokes player→target with cached glow blits at
// the muzzle and impact. Width breathes on state.phase (set in the update).
function drawBeam(ctx, player, st, cfg, isEvolved) {
    if (!st.on) return;
    const flick = 0.9 + 0.1 * Math.sin(st.phase * 3.1);
    const w = cfg.width * flick;
    const bodyCol = isEvolved ? 'rgba(255, 190, 110, 0.5)' : 'rgba(255, 214, 140, 0.45)';
    const hazeCol = isEvolved ? 'rgba(255, 140, 70, 0.22)' : 'rgba(255, 190, 120, 0.18)';

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    // Wide soft haze → body → white-hot core.
    ctx.strokeStyle = hazeCol;
    ctx.lineWidth = w * 2.2;
    ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(st.tx, st.ty); ctx.stroke();
    ctx.strokeStyle = bodyCol;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(st.tx, st.ty); ctx.stroke();
    ctx.strokeStyle = `rgba(255, 250, 230, ${0.85 * flick})`;
    ctx.lineWidth = Math.max(3, w * 0.3);
    ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(st.tx, st.ty); ctx.stroke();
    // Muzzle + impact glows (cached sprites).
    const glow = getGlowSprite(isEvolved ? '#ffb060' : '#ffd98a');
    const gm = w * 2.6, gi = w * 3.4;
    ctx.globalAlpha = 0.7;
    ctx.drawImage(glow, player.x - gm / 2, player.y - gm / 2, gm, gm);
    ctx.drawImage(glow, st.tx - gi / 2, st.ty - gi / 2, gi, gi);
    ctx.restore();
}

// Cindermine eruption: an expanding double ring + a collapsing cached-glow
// core — reads as a blast without any per-frame gradient.
function drawBlast(ctx, fx) {
    const t = fx.age / fx.lifetime;
    const alpha = 1 - t;
    const r = fx.radius * (0.35 + 0.65 * t);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * 0.8;
    const g = fx.radius * 2 * (1 - t * 0.5);
    ctx.drawImage(getGlowSprite('#ff6a3c'), fx.x - g / 2, fx.y - g / 2, g, g);
    ctx.strokeStyle = `rgba(255, 200, 130, ${alpha * 0.95})`;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, r, 0, TWO_PI);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255, 120, 60, ${alpha * 0.55})`;
    ctx.lineWidth = 20;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, r * 0.82, 0, TWO_PI);
    ctx.stroke();
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
