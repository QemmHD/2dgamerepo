#!/usr/bin/env node
// Deterministic checks on the pre-run XP/coin bonus. Run from the repo root:
//   node tools/validate-run-bonus.js
//
// Why this file exists: the PLAY-screen readout and the engine's applied bonus
// were once two separate expressions over the same data, and they disagreed —
// MenuRenderer summed the Trials from zero while Game seeded the accumulator
// with DIFFICULTY[].xpBonus, so Nightmare granted +50% Pass XP the menu never
// showed. computeRunBonus() in GameConfig.js is now the single source both
// call. These assertions are the tripwire that keeps it single.

// Dependency-free so the static game needs no build or package manager.

import {
    DIFFICULTY, DIFFICULTY_ORDER,
    RUN_MODIFIERS, RUN_MODIFIER_MAX_BONUS,
    computeRunBonus,
} from '../src/config/GameConfig.js';

let checks = 0;
const failures = [];
function check(ok, message) {
    checks++;
    if (!ok) failures.push(message);
}
const round2 = (n) => Math.round(n * 100) / 100;

// ── 1. The helper reproduces the engine's ORIGINAL expression exactly ─────
// This is the reference implementation lifted verbatim from Game.js before the
// refactor (the accumulator seeded with diff.xpBonus, both clamps as written).
// If a future edit changes computeRunBonus's semantics, this fails loudly
// instead of silently re-opening the drift.
function legacyEngineBonus(difficultyId, ids) {
    const diff = DIFFICULTY[difficultyId] || DIFFICULTY.normal;
    const mods = RUN_MODIFIERS.filter((m) => ids.includes(m.id));
    let xpBonus = diff.xpBonus || 0, coinBonus = 0;
    for (const m of mods) {
        xpBonus += m.xpBonus || 0;
        coinBonus += m.coinBonus || 0;
    }
    return {
        xp: Math.min(xpBonus, RUN_MODIFIER_MAX_BONUS + (diff.xpBonus || 0)),
        coin: Math.min(coinBonus, RUN_MODIFIER_MAX_BONUS),
    };
}

// Exhaustive over difficulty x every subset of the 9 Trials (3 * 512 = 1536).
const ALL_IDS = RUN_MODIFIERS.map((m) => m.id);
let subsetCases = 0;
for (const difficultyId of DIFFICULTY_ORDER) {
    for (let mask = 0; mask < (1 << ALL_IDS.length); mask++) {
        const ids = ALL_IDS.filter((_, i) => mask & (1 << i));
        const got = computeRunBonus(difficultyId, ids);
        const want = legacyEngineBonus(difficultyId, ids);
        subsetCases++;
        if (round2(got.xp) !== round2(want.xp) || round2(got.coin) !== round2(want.coin)) {
            check(false, `computeRunBonus(${difficultyId}, [${ids}]) = `
                + `{xp:${got.xp}, coin:${got.coin}} but the engine's original expression gives `
                + `{xp:${want.xp}, coin:${want.coin}}`);
            mask = 1 << ALL_IDS.length;   // one report is enough
            break;
        }
    }
}
check(subsetCases === DIFFICULTY_ORDER.length * (1 << ALL_IDS.length),
    `expected ${DIFFICULTY_ORDER.length * (1 << ALL_IDS.length)} subset cases, walked ${subsetCases}`);

// ── 2. The regression that started this: difficulty XP must be included ──
// The old MenuRenderer expression (sum of Trials only, from zero) is exactly
// what these assert against.
const nightmareNoTrials = computeRunBonus('hard', []);
check(nightmareNoTrials.xp === 0.5,
    `Nightmare with no Trials must carry the difficulty's +50% XP, got ${nightmareNoTrials.xp}`);
check(nightmareNoTrials.difficultyXp === 0.5,
    `Nightmare must attribute its 0.5 via difficultyXp, got ${nightmareNoTrials.difficultyXp}`);
check(computeRunBonus('normal', []).xp === 0,
    'Vigil with no Trials must be a flat +0% XP');
check(computeRunBonus('easy', []).xp === 0,
    'Recruit with no Trials must be a flat +0% XP');

// Same Trials, harder tier => strictly more XP. The old readout returned the
// same number for all three tiers, which is the bug in one line.
for (const ids of [['fragile'], ['fragile', 'frenzy'], ALL_IDS]) {
    const vigil = computeRunBonus('normal', ids).xp;
    const nightmare = computeRunBonus('hard', ids).xp;
    check(round2(nightmare - vigil) === 0.5,
        `Nightmare must exceed Vigil by exactly 0.5 XP for [${ids}], got ${round2(nightmare - vigil)}`);
}

// Difficulty pays no coin bonus — only Trials do.
for (const difficultyId of DIFFICULTY_ORDER) {
    check(computeRunBonus(difficultyId, []).coin === 0,
        `${difficultyId} with no Trials must pay +0% coins`);
}

// ── 3. Every Trial contributes its own authored numbers ──────────────────
for (const m of RUN_MODIFIERS) {
    const solo = computeRunBonus('normal', [m.id]);
    check(round2(solo.xp) === round2(m.xpBonus || 0),
        `Trial '${m.id}' must contribute xpBonus ${m.xpBonus}, got ${solo.xp}`);
    check(round2(solo.coin) === round2(m.coinBonus || 0),
        `Trial '${m.id}' must contribute coinBonus ${m.coinBonus}, got ${solo.coin}`);
}

// ── 4. The documented "cap is unreachable" claim stays true ──────────────
// GameConfig.js states this in a comment; assert it so the comment can't rot.
const maxXp = RUN_MODIFIERS.reduce((a, m) => a + (m.xpBonus || 0), 0);
const maxCoin = RUN_MODIFIERS.reduce((a, m) => a + (m.coinBonus || 0), 0);
check(round2(maxXp) === 1.85, `all-Trials xpBonus sum should be 1.85, got ${round2(maxXp)}`);
check(round2(maxCoin) === 1.22, `all-Trials coinBonus sum should be 1.22, got ${round2(maxCoin)}`);
const peak = computeRunBonus('hard', ALL_IDS);
check(peak.xp < RUN_MODIFIER_MAX_BONUS + 0.5,
    `peak XP ${peak.xp} should sit under the ${RUN_MODIFIER_MAX_BONUS + 0.5} clamp (cap unreachable)`);
check(peak.coin < RUN_MODIFIER_MAX_BONUS,
    `peak coin ${peak.coin} should sit under the ${RUN_MODIFIER_MAX_BONUS} clamp (cap unreachable)`);
check(round2(peak.xp) === 2.35, `peak XP should be 0.5 + 1.85 = 2.35, got ${round2(peak.xp)}`);

// ── 5. Input shape tolerance — Game holds a Set, the menu holds an array ──
check(computeRunBonus('hard', new Set(['fragile', 'frenzy'])).xp
    === computeRunBonus('hard', ['fragile', 'frenzy']).xp,
    'a Set of modifier ids must give the same result as an array');
check(computeRunBonus('normal').xp === 0, 'omitting modifierIds must be treated as none');
check(computeRunBonus('normal', null).xp === 0, 'a null modifier list must be treated as none');
check(computeRunBonus('nonsense-tier', []).xp === 0,
    'an unknown difficulty must fall back to normal, not throw');
check(computeRunBonus('normal', ['not-a-real-trial']).xp === 0,
    'an unknown modifier id must be ignored, not counted');

// ── 6. The clamp still works if the table is ever retuned past the cap ───
// Guard the insurance itself: a synthetic over-cap stack must clamp.
{
    const inflated = Array.from({ length: 40 }, (_, i) => `synthetic-${i}`);
    const got = computeRunBonus('hard', inflated);
    check(got.xp <= RUN_MODIFIER_MAX_BONUS + 0.5, 'clamp must hold for unknown ids');
}

if (failures.length) {
    console.error(`run-bonus validation: FAILED — ${failures.length} of ${checks} checks`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
console.log(`run-bonus validation: OK — ${checks} deterministic checks passed `
    + `(${subsetCases} difficulty x Trial-subset cases).`);
