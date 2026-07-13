// BossChoreographer — deterministic, data-light policy for apex-boss pacing.
//
// Enemy owns simulation state and attack commits; this module only answers
// three questions: which authored phase-two pattern belongs to a boss, which
// ready move comes next, and how long that move should leave the boss exposed.
// Keeping those decisions pure makes the fight grammar straightforward to
// validate without booting Canvas, AudioContext, or the full Game.

export const BOSS_PHASE_BREAK_DURATION = 0.9;
export const BOSS_EXPOSED_DAMAGE_MUL = 1.12;

// Four-beat second acts. The signature is deliberately the final beat so,
// after the phase break forces it once, the round-robin travels through three
// other attack shapes before returning to the showpiece. Each list is authored
// around spatial contrast (lane / relocation / ring / signature), not raw DPS.
const phasePatterns = {
    vinebackGoliath: ['slam', 'quake', 'charge', 'brambleRing'],
    stormwingAlpha: ['dive', 'tempest', 'gale', 'galeLattice'],
    gloomMaw: ['cackle', 'drool', 'lunge', 'gazeBeam'],
    rimewarden: ['iceSlam', 'frostZones', 'glacialCharge', 'iceLance'],
    hoarfang: ['icicleVolley', 'freezePools', 'lunge', 'blizzardPinwheel'],
    aurorath: ['auroraVolley', 'cometZones', 'novaShock', 'auroraBeam'],
    ossuar: ['boneFan', 'graveQuake', 'reapCharge', 'boneLattice'],
    mourndrift: ['soulVolley', 'phantomZones', 'blink', 'soulRain'],
    nihagault: ['voidBurst', 'gravityZones', 'collapse', 'voidMire'],
    dunescourge: ['sandBlast', 'quicksand', 'goreCharge', 'sandSpiral'],
    cindermaw: ['magmaVolley', 'lavaZones', 'fireLunge', 'lavaField'],
    solnakh: ['solarVolley', 'scorchZones', 'supernova', 'solarLance'],
};
for (const ids of Object.values(phasePatterns)) Object.freeze(ids);
export const BOSS_PHASE_PATTERNS = Object.freeze(phasePatterns);

const RECOVERY_BY_KIND = Object.freeze({
    fan: 0.34,
    aimed: 0.45,
    charge: 0.48,
    seekers: 0.46,
    wall: 0.52,
    shockwave: 0.55,
    zones: 0.58,
    cross: 0.62,
    spiralArms: 0.62,
    mines: 0.64,
    rain: 0.65,
    summon: 0.70,
    lingering: 0.72,
    beam: 0.78,
});

export function bossSignatureAttack(def) {
    const attacks = def && Array.isArray(def.attacks) ? def.attacks : null;
    return attacks && attacks.length ? attacks[attacks.length - 1] : null;
}

export function canStartBossPhaseBreak(state) {
    return !!state?.phase2Pending &&
        !(state.bossWindupTimer > 0) && !state.activeAttack &&
        !(state.bossDashTimer > 0) && !(state.bossPendingRecovery > 0) &&
        !(state.bossRecoveryTimer > 0);
}

// Resolves IDs once, on phase entry. A malformed authored pattern falls back
// to the existing phase2Attacks data, then to the complete kit; the validator
// makes that fallback a development safety net rather than shipped behavior.
export function phasePatternFor(type, def) {
    const attacks = def && Array.isArray(def.attacks) ? def.attacks : [];
    let ids = BOSS_PHASE_PATTERNS[type];
    if (!ids || !ids.length) ids = def && Array.isArray(def.phase2Attacks) ? def.phase2Attacks : null;
    if (!ids || !ids.length) return attacks.slice();

    const resolved = [];
    for (const id of ids) {
        const attack = attacks.find((candidate) => candidate.id === id);
        if (attack) resolved.push(attack);
    }
    return resolved.length === ids.length ? resolved : attacks.slice();
}

// Round-robin among READY attacks. Consecutive attacks may repeat neither the
// same move nor its kind; if every contrasting move is cooling down, the boss
// waits instead of machine-gunning a visually identical pattern.
//
// `state` is intentionally tiny/pure: { cursor, lastAttackId, lastAttackKind }.
// A forced move ignores its cooldown, but still refuses an exact repeat.
export function chooseBossAttack(pool, timers, state, forcedAttack = null, strictOrder = false) {
    if (!Array.isArray(pool) || pool.length === 0) return null;
    const cursor = ((state?.cursor ?? 0) % pool.length + pool.length) % pool.length;
    const lastId = state?.lastAttackId ?? null;
    const lastKind = state?.lastAttackKind ?? null;

    if (forcedAttack && forcedAttack.id !== lastId) {
        const idx = pool.indexOf(forcedAttack);
        return {
            attack: forcedAttack,
            nextCursor: idx >= 0 ? (idx + 1) % pool.length : cursor,
            forced: true,
        };
    }

    const candidateCount = strictOrder ? 1 : pool.length;
    for (let offset = 0; offset < candidateCount; offset++) {
        const idx = (cursor + offset) % pool.length;
        const attack = pool[idx];
        const ready = timers?.[attack.id] == null || timers[attack.id] <= 0;
        if (!ready || attack.id === lastId || attack.kind === lastKind) continue;
        return { attack, nextCursor: (idx + 1) % pool.length, forced: false };
    }
    return null;
}

export function bossRecoveryDuration(attack, signatureId = null) {
    if (!attack) return 0;
    if (Number.isFinite(attack.recovery) && attack.recovery > 0) return attack.recovery;
    const base = RECOVERY_BY_KIND[attack.kind] ?? 0.45;
    return Math.min(0.95, base + (attack.id === signatureId ? 0.12 : 0));
}

export function bossAttackLabel(attack) {
    if (!attack) return '';
    if (typeof attack.label === 'string' && attack.label) return attack.label.toUpperCase();
    return String(attack.id || attack.kind || 'ATTACK')
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toUpperCase();
}
