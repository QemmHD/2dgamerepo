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

// Attack kinds that paint a delayed ground hazard and therefore MUST telegraph
// with a `warn` lead time (the others read purely off `windup`).
const HAZARD_KINDS = new Set(['zones', 'mines', 'rain', 'lingering', 'beam']);

let problems = 0;
const fail = (m) => { console.error('  ✗ ' + m); problems++; };

const bosses = Object.entries(ENEMY).filter(([, d]) => d && d.behavior === 'apexBoss');
console.log(`Checking ${bosses.length} apex boss kit(s)…`);

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
}

if (problems === 0) {
    console.log(`\nboss validation: OK — all ${bosses.length} apex kits telegraph, and every enraged pool resolves + keeps its signature.`);
    process.exit(0);
} else {
    console.error(`\nboss validation: FAILED — ${problems} problem(s) above.`);
    process.exit(1);
}
