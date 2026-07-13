#!/usr/bin/env node
// Boss-kit integrity validator (BOSSFORGE).
//
// Codifies the apex-boss invariants so a future data typo can't silently
// degrade a fight. The dangerous failure this guards is quiet: runBossAI's
// phase-2 pool build (Enemy.js) falls back to the FULL phase-1 kit when a
// phase2Attacks id doesn't resolve — so a typo'd id doesn't crash, it just
// makes the "second act" wrong while every smoke test still passes. Run:
//   node tools/validate-bosses.js
//
// Per apexBoss def in GameConfig.ENEMY it asserts:
//   - a non-empty attacks[] and a non-empty phase2Attacks[]
//   - every phase2Attacks id resolves to a real attack in that boss's own kit
//     (no silent revert-to-full-kit)
//   - the SIGNATURE (the last, showpiece attack) is in the enraged pool, so a
//     boss never loses its identity move at 50% — the exact defect Rimewarden
//     shipped with (a 2-move, signature-less phase-2)
//   - every attack has a positive windup (a telegraph the player can read)
//   - every delayed-hazard attack (zones/mines/rain/lingering/beam) carries a
//     `warn` (its ground-telegraph lead time)
//
// Exit 0 = clean, 1 = problems (so CI can gate on it).

import { ENEMY } from '../src/config/GameConfig.js';
import { commitBossAttack } from '../src/entities/Enemy.js';
import {
    BOSS_PHASE_PATTERNS,
    bossRecoveryDuration,
    bossSignatureAttack,
    canStartBossPhaseBreak,
    chooseBossAttack,
    phasePatternFor,
} from '../src/systems/BossChoreographer.js';

// Attack kinds that paint a delayed ground hazard and therefore MUST telegraph
// with a `warn` lead time (the others read purely off `windup`).
const HAZARD_KINDS = new Set(['zones', 'mines', 'rain', 'lingering', 'beam']);

let problems = 0;
const fail = (m) => { console.error('  ✗ ' + m); problems++; };

const bosses = Object.entries(ENEMY).filter(([, d]) => d && d.behavior === 'apexBoss');
console.log(`Checking ${bosses.length} apex boss kit(s)…`);

// A requested second act may start only from neutral. These cases guard the
// promise that crossing 50% never erases an already-telegraphed move.
const idleTransition = {
    phase2Pending: true, bossWindupTimer: 0, activeAttack: null,
    bossDashTimer: 0, bossPendingRecovery: 0, bossRecoveryTimer: 0,
};
if (!canStartBossPhaseBreak(idleTransition)) fail('phase break cannot start from neutral');
for (const busyField of ['bossWindupTimer', 'bossDashTimer', 'bossPendingRecovery', 'bossRecoveryTimer']) {
    if (canStartBossPhaseBreak({ ...idleTransition, [busyField]: 0.25 })) {
        fail(`phase break incorrectly starts during ${busyField}`);
    }
}
if (canStartBossPhaseBreak({ ...idleTransition, activeAttack: { id: 'promised' } })) {
    fail('phase break incorrectly cancels an active promised attack');
}

for (const [key, d] of bosses) {
    const name = d.bossName || key;
    const attacks = Array.isArray(d.attacks) ? d.attacks : null;
    if (!attacks || attacks.length === 0) { fail(`${name} (${key}): missing/empty attacks[]`); continue; }

    const ids = new Set();
    for (const a of attacks) {
        if (!a || typeof a.id !== 'string' || !a.id) { fail(`${name}: an attack has no id`); continue; }
        if (ids.has(a.id)) fail(`${name}: duplicate attack id '${a.id}'`);
        ids.add(a.id);
        if (!(typeof a.windup === 'number' && a.windup > 0)) fail(`${name}: attack '${a.id}' has no positive windup (no telegraph)`);
        if (HAZARD_KINDS.has(a.kind) && !(typeof a.warn === 'number' && a.warn > 0)) {
            fail(`${name}: hazard attack '${a.id}' (kind ${a.kind}) has no warn telegraph`);
        }
        const recovery = bossRecoveryDuration(a, attacks[attacks.length - 1]?.id);
        if (!(recovery > 0 && recovery <= 0.95)) {
            fail(`${name}: attack '${a.id}' has invalid recovery window ${recovery}`);
        }
    }

    const p2 = Array.isArray(d.phase2Attacks) ? d.phase2Attacks : null;
    if (!p2 || p2.length === 0) { fail(`${name}: missing/empty phase2Attacks[]`); continue; }
    if (p2.length < 2) fail(`${name}: phase2Attacks has only ${p2.length} move — an enraged pool needs at least 2`);
    for (const id of p2) {
        if (!ids.has(id)) fail(`${name}: phase2Attacks id '${id}' is not in the kit → silently reverts to the full phase-1 pool`);
    }

    // Convention: the LAST attack in the kit is the boss's SIGNATURE. The
    // enraged pool must keep it so the second act shows the boss's showpiece.
    const signature = attacks[attacks.length - 1]?.id;
    if (signature && !p2.includes(signature)) {
        fail(`${name}: signature move '${signature}' is missing from phase2Attacks — the boss loses its identity move when enraged`);
    }

    // Choreographer v1: every boss gets a four-beat authored second act with
    // distinct spatial grammar and the signature as its final cycle beat.
    const patternIds = BOSS_PHASE_PATTERNS[key];
    if (!patternIds) {
        fail(`${name}: no authored BossChoreographer phase pattern`);
        continue;
    }
    if (patternIds.length < 4) fail(`${name}: phase pattern needs at least 4 beats (has ${patternIds.length})`);
    if (new Set(patternIds).size !== patternIds.length) fail(`${name}: phase pattern repeats an attack id`);
    for (const id of patternIds) if (!ids.has(id)) fail(`${name}: phase pattern id '${id}' does not resolve`);
    if (signature && patternIds[patternIds.length - 1] !== signature) {
        fail(`${name}: phase pattern must end in signature '${signature}'`);
    }
    const pattern = phasePatternFor(key, d);
    if (pattern.length !== patternIds.length || pattern.some((a, i) => a.id !== patternIds[i])) {
        fail(`${name}: resolved phase pattern fell back or changed order`);
    }
    const patternKinds = new Set(pattern.map((a) => a.kind));
    if (patternKinds.size < 4) fail(`${name}: phase pattern needs 4 contrasting attack kinds (has ${patternKinds.size})`);

    // Deterministic phase-one readiness sweep: even with every move ready, the
    // selector must never emit the same id or kind twice in a row.
    const ready = Object.fromEntries(attacks.map((a) => [a.id, 0]));
    const state = { cursor: 0, lastAttackId: null, lastAttackKind: null };
    for (let i = 0; i < attacks.length * 3; i++) {
        const pick = chooseBossAttack(attacks, ready, state);
        if (!pick) { fail(`${name}: round-robin stalled with contrasting attacks ready`); break; }
        if (pick.attack.id === state.lastAttackId) fail(`${name}: selector repeated '${pick.attack.id}'`);
        if (pick.attack.kind === state.lastAttackKind) fail(`${name}: selector repeated kind '${pick.attack.kind}'`);
        state.cursor = pick.nextCursor;
        state.lastAttackId = pick.attack.id;
        state.lastAttackKind = pick.attack.kind;
    }

    // Phase two is signature-first and then strictly follows its ordered cycle.
    const signatureAttack = bossSignatureAttack(d);
    const p2State = { cursor: 0, lastAttackId: null, lastAttackKind: null };
    const expected = [signature, ...patternIds];
    for (let i = 0; i < expected.length; i++) {
        const forced = i === 0 ? signatureAttack : null;
        const pick = chooseBossAttack(pattern, ready, p2State, forced, true);
        if (!pick) { fail(`${name}: ordered phase-two pattern stalled at beat ${i + 1}`); break; }
        if (pick.attack.id !== expected[i]) {
            fail(`${name}: phase-two beat ${i + 1} expected '${expected[i]}', got '${pick.attack.id}'`);
            break;
        }
        if (pick.attack.id === p2State.lastAttackId || pick.attack.kind === p2State.lastAttackKind) {
            fail(`${name}: ordered phase-two pattern repeats move/kind at '${pick.attack.id}'`);
        }
        p2State.cursor = pick.nextCursor;
        p2State.lastAttackId = pick.attack.id;
        p2State.lastAttackKind = pick.attack.kind;
    }

    // Strict order waits for the intended beat instead of skipping ahead.
    const waiting = { ...ready, [pattern[0].id]: 0.5 };
    if (chooseBossAttack(pattern, waiting, { cursor: 0, lastAttackId: signature, lastAttackKind: signatureAttack?.kind }, null, true)) {
        fail(`${name}: strict phase order skipped a cooling first beat`);
    }

    // A summon request must retain the duel owner through the deferred spawn
    // queue; Game stamps that ID on the resulting support Enemy so death
    // cleanup cannot leave an orphaned add behind.
    const summonOut = { summons: [], hazards: [] };
    commitBossAttack(
        { boss: true, type: key, def: d, name, epithet: d.epithet },
        { id: 'ownershipProbe', kind: 'summon', summonCount: 2 },
        { x: 0, y: 0 },
        summonOut,
    );
    if (summonOut.summons.length !== 1 || summonOut.summons[0].bossOwnerId !== key) {
        fail(`${name}: deferred summon request lost boss owner id`);
    }
}

if (problems === 0) {
    console.log(`\nboss validation: OK — ${bosses.length} apex kits telegraph, recover, avoid repeats, and run signature-first ordered second acts.`);
    process.exit(0);
} else {
    console.error(`\nboss validation: FAILED — ${problems} problem(s) above.`);
    process.exit(1);
}
