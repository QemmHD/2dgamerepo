// elements.js — the ONE authored cross-element reaction source of truth
// (KINDLED update #3). Weapons tag hits with an `element` (fire / frost /
// shock); when an incoming element lands on a target already carrying another
// element's status, COMBO_TABLE says what cross-reacts. Three live rows + a
// reserved `umbral` row that GLOAMCALL (update #8) fills with ZERO table
// surgery.
//
// Hook discipline (keystone pattern): one exported applyCombo() is called from
// the existing stamp sites — the shock hook (shockStrike), the projectile hit
// (CollisionSystem), and the behaviour burn/chill stamps — never a new
// per-frame scan. DETONATE is a byte-identical migration of the old
// SHOCK_CFG.detonateMul burn-consume that used to live inline in shockStrike.

import { SHOCK_CFG, ELEMENT } from '../config/GameConfig.js';

// Reaction kinds (string tags so the table reads like data, not code).
export const DETONATE = 'detonate';   // shock → burning: consume burn for a burst
export const SHATTER = 'shatter';     // fire  → chilled/frozen: burst + clear the ice
export const BRITTLE = 'brittle';     // frost → shocked: deepen control (no raw dmg)

// The table: incoming element (row) × status already on the target (column) →
// reaction. `null` = the pair is authored as inert on purpose. The `umbral`
// row is RESERVED for update #8 — nothing may resolve it (asserted below).
export const COMBO_TABLE = {
    fire:  { chill: SHATTER, shock: null },
    frost: { burn: null,     shock: BRITTLE },
    shock: { burn: DETONATE },
    umbral: { reserved: true },   // GLOAMCALL (#8) fills this — DO NOT implement
};

// Tunable magnitudes, co-located with the table (the single source of truth).
// detonateMul derives from SHOCK_CFG so the migration is byte-identical and the
// compat constant keeps working one release; a later update moves the literal
// here and drops SHOCK_CFG.detonateMul.
export const COMBO_CFG = {
    detonateMul: SHOCK_CFG.detonateMul,   // 2.5 (migrated — regression anchor)
    conflagMul: 2.2,                      // Conflagration keystone amp on DETONATE
    shatterMul: 1.8,                      // × the triggering fire hit
    shatterFrozenMul: 2.6,                // × when the target was hard-frozen
    brittleFreeze: 0.8,                   // s of freeze a BRITTLE proc can add
    brittleFreezeChance: 0.10,            // chance of that freeze
    latch: 1.5,                           // s per-enemy cooldown (SHATTER/BRITTLE only)
};

// DEV assertion: nothing may resolve the reserved umbral row. Kept cheap — only
// runs on the (never-taken in #3) umbral path.
function assertNotReserved(row, incomingElement) {
    if (row && row.reserved) {
        throw new Error(`applyCombo: element "${incomingElement}" is RESERVED (umbral is owned by update #8 GLOAMCALL) — no combo may resolve it in KINDLED.`);
    }
}

// applyCombo(target, incomingElement, hitDamage, ctx) — resolve any cross-
// element reaction the incoming hit triggers on `target`. Returns true if a
// reaction fired. ctx supplies { hits, killed, player, particles? }; particles
// is optional (the CollisionSystem path has none). Never throws on the live
// rows — only the reserved umbral row asserts (DEV canary).
//
// DETONATE is unlatched (fires every shock hit on a burning target, exactly as
// before). SHATTER/BRITTLE share a 1.5s per-enemy latch so pulse/orbit weapons
// can't machine-gun them.
export function applyCombo(target, incomingElement, hitDamage, ctx) {
    const row = COMBO_TABLE[incomingElement];
    if (!row) return false;
    assertNotReserved(row, incomingElement);
    if (!target || !target.active) return false;
    // KINDLED PR5 — count every combo proc on the player (run-scoped: player is
    // rebuilt per run), for the score formula + Orin's Rite of Cataclysm. ctx.player
    // is present in all three caller ctx shapes. Single source: every proc `return
    // proc()`.
    const proc = () => { if (ctx.player) ctx.player._comboProcs = (ctx.player._comboProcs || 0) + 1; return true; };

    // DETONATE — shock → burning. Byte-identical to the old shockStrike block,
    // including the Conflagration keystone (2.2× + relight). NOT latched.
    if (row.burn === DETONATE && target.burnTimer > 0) {
        const conflag = ctx.player?.ks_conflagration;
        const detMul = COMBO_CFG.detonateMul * (conflag ? COMBO_CFG.conflagMul : 1);
        const burnDps = target.burnDps;
        const burst = burnDps * detMul;
        target.takeDamage(burst);
        ctx.hits.push({ x: target.x, y: target.y - target.radius, amount: burst });
        target.burnTimer = 0;
        target.burnDps = 0;
        target.burnTickAccum = 0;
        if (conflag && target.active) target.applyBurn(burnDps, 2.0); // relight
        if (!target.active) ctx.killed.push(target);
        return proc();
    }

    // The new combos share the per-enemy latch.
    if (target._comboCd > 0) return false;

    // SHATTER — fire → chilled/frozen. Bursts for a multiple of the triggering
    // fire hit (harder if it was hard-frozen), then CLEARS the ice.
    if (row.chill === SHATTER) {
        const frozen = target.freezeTimer > 0;
        if (frozen || target.chillStacks >= 2) {
            const burst = hitDamage * (frozen ? COMBO_CFG.shatterFrozenMul : COMBO_CFG.shatterMul);
            target.takeDamage(burst);
            ctx.hits.push({ x: target.x, y: target.y - target.radius, amount: burst, color: ELEMENT.freeze.tint });
            target.freezeTimer = 0;
            target.chillTimer = 0;
            target.chillMul = 1;
            target.chillStacks = 0;
            target._comboCd = COMBO_CFG.latch;
            ctx.particles?.frostShards?.(target.x, target.y);
            if (!target.active) ctx.killed.push(target);
            return proc();
        }
    }

    // BRITTLE — frost → shocked. Control payoff (no raw damage): +1 chill stack
    // beyond the normal stamp + a chance at a short freeze. The frost hit that
    // triggers this already refreshed chillTimer, so the extra stack persists.
    if (row.shock === BRITTLE && target.shockStacks >= 2) {
        if (target.chillStacks < ELEMENT.frost.chillMaxStacks) target.chillStacks += 1;
        if (Math.random() < COMBO_CFG.brittleFreezeChance) target.applyFreeze(COMBO_CFG.brittleFreeze);
        target._comboCd = COMBO_CFG.latch;
        ctx.particles?.frostShards?.(target.x, target.y);
        return proc();
    }

    return false;
}

// ── Draft legibility (keystoneBreadcrumbs pattern) ─────────────────────────
// The status channel each element rides, and a display label per reaction.
const STATUS_OF = { fire: 'burn', frost: 'chill', shock: 'shock' };
const REACTION_LABEL = { [DETONATE]: 'DETONATE', [SHATTER]: 'SHATTER', [BRITTLE]: 'BRITTLE' };

// comboDraftHints(ownedElements, offeredElements, max) — during a level-up
// draft, list the cross-element reactions a pick would UNLOCK: an offered
// element that isn't owned yet, paired with an owned element the table reacts
// with. Pure + cheap; computed only while a draft is up. Returns up to `max`
// { reaction, offered, owned } hints, de-duped by reaction.
export function comboDraftHints(ownedElements, offeredElements, max = 2) {
    const owned = new Set((ownedElements || []).filter(Boolean));
    const out = [];
    const seen = new Set();
    for (const off of (offeredElements || [])) {
        if (!off || owned.has(off)) continue;   // only a NEW element completes a pair
        const row = COMBO_TABLE[off];
        if (!row || row.reserved) continue;
        for (const have of owned) {
            // The reaction where the offered element lands on the owned status,
            // or the owned element lands on the offered status.
            const reaction = row[STATUS_OF[have]] || COMBO_TABLE[have]?.[STATUS_OF[off]];
            const label = reaction && REACTION_LABEL[reaction];
            if (label && !seen.has(label)) {
                seen.add(label);
                out.push({ reaction: label, offered: off, owned: have });
                if (out.length >= max) return out;
            }
        }
    }
    return out;
}
