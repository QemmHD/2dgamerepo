#!/usr/bin/env node
// Deterministic integrity checks for curated tactical encounters.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENEMY, WAVES, WAVE_LIMITS } from '../src/config/GameConfig.js';
import { MAP_ORDER } from '../src/content/maps.js';
import {
    ENCOUNTER_LIMITS,
    ENCOUNTER_PATTERNS,
    ENCOUNTERS_BY_BIOME,
    encounterUnitCount,
    encountersForBiome,
    getEncounter,
} from '../src/content/encounters.js';
import {
    EncounterDirector,
    boundedEncounterSize,
    retireEncounterEnemyTags,
} from '../src/systems/EncounterDirector.js';

let checks = 0;
const check = (condition, message) => {
    assert.ok(condition, message);
    checks++;
};

const FORMATIONS = new Set(['line', 'wedge', 'ring', 'flock', 'choir', 'column', 'pincer', 'escort', 'diamond']);
const ids = new Set();
const names = new Set();

check(ENCOUNTER_PATTERNS.length >= 8, 'fewer than eight curated encounter patterns are authored');
check(Object.isFrozen(ENCOUNTER_PATTERNS), 'encounter registry is mutable');
for (const biomeId of MAP_ORDER) {
    const entries = ENCOUNTERS_BY_BIOME[biomeId];
    check(Array.isArray(entries) && entries.length >= 2, `${biomeId} needs at least two tactical patterns`);
    check(entries.every((entry) => entry.biomeId === biomeId), `${biomeId} registry contains a foreign pattern`);
}

for (const entry of ENCOUNTER_PATTERNS) {
    check(!ids.has(entry.id), `duplicate encounter id: ${entry.id}`); ids.add(entry.id);
    check(!names.has(entry.name), `duplicate encounter name: ${entry.name}`); names.add(entry.name);
    check(MAP_ORDER.includes(entry.biomeId), `${entry.id} references unknown biome ${entry.biomeId}`);
    check(getEncounter(entry.id) === entry, `${entry.id} does not round-trip through getEncounter`);
    check(FORMATIONS.has(entry.formation), `${entry.id} uses unknown formation ${entry.formation}`);
    check(typeof entry.warning === 'string' && entry.warning.length >= 24, `${entry.id} warning is not readable copy`);
    check(typeof entry.accent === 'string' && entry.accent.startsWith('#'), `${entry.id} needs an accent color`);
    check(Number.isInteger(entry.minWave) && entry.minWave >= 1 && entry.minWave < WAVES.length,
        `${entry.id} has invalid minWave ${entry.minWave}`);
    check(Number.isInteger(entry.minUnits) && entry.minUnits >= 1, `${entry.id} has invalid minimum pack size`);
    check(Number.isFinite(entry.spacing) && entry.spacing >= 90, `${entry.id} formation spacing is too small`);
    check(Number.isFinite(entry.anchorDistance) && entry.anchorDistance >= 800,
        `${entry.id} anchor can appear on top of the player`);
    check(Object.isFrozen(entry) && Object.isFrozen(entry.units), `${entry.id} content is mutable`);

    const size = encounterUnitCount(entry);
    check(size >= entry.minUnits, `${entry.id} authored size is below its minimum`);
    check(size <= ENCOUNTER_LIMITS.maxUnitsPerPack, `${entry.id} exceeds the hard pack bound`);
    let guardians = 0;
    for (const unit of entry.units) {
        const def = ENEMY[unit.type];
        check(!!def && !def.boss, `${entry.id} uses missing/boss enemy ${unit.type}`);
        check(Number.isInteger(unit.count) && unit.count > 0, `${entry.id}/${unit.type} has invalid count`);
        check(Object.isFrozen(unit), `${entry.id}/${unit.type} unit definition is mutable`);
        if (unit.guardian) guardians += unit.count;
        check((WAVES[entry.minWave].typeWeights[unit.type] ?? 0) > 0,
            `${entry.id} reveals ${unit.type} before its normal wave vocabulary`);
    }
    check(guardians >= 1, `${entry.id} has no guardian clear target`);
    check(guardians <= entry.minUnits, `${entry.id} can truncate away a guardian`);
    check(encountersForBiome(entry.biomeId, entry.minWave).includes(entry),
        `${entry.id} is not eligible at its authored wave`);
    check(!encountersForBiome(entry.biomeId, entry.minWave - 1).includes(entry),
        `${entry.id} is eligible before its authored wave`);
    check(boundedEncounterSize(entry, 999) === size, `${entry.id} bounded size changed an in-limit pack`);
}

check(ENCOUNTER_LIMITS.maxUnitsPerPack <= 10, 'pack request bound is too large for a curated beat');
check(ENCOUNTER_LIMITS.maxSpawnRequestsPerUpdate === 1, 'director may burst multiple pack requests per frame');
check(ENCOUNTER_LIMITS.hardEnemyCap === WAVE_LIMITS.maxEnemyCap, 'encounter and wave hard caps disagree');
check(ENCOUNTER_LIMITS.warningDuration >= 2.4, 'warning duration is too short to read');

const contentSource = readFileSync(new URL('../src/content/encounters.js', import.meta.url), 'utf8');
const directorSource = readFileSync(new URL('../src/systems/EncounterDirector.js', import.meta.url), 'utf8');
check(!contentSource.includes('Math.random'), 'encounter content contains Math.random');
check(!directorSource.includes('Math.random'), 'encounter scheduling contains Math.random');

function dueContext(overrides = {}) {
    return {
        gameTime: 1000,
        waveIndex: 5,
        liveEnemyCount: 10,
        enemyCap: 30,
        ...overrides,
    };
}

function openAndSpawn(director, context = dueContext()) {
    const warning = director.update(1 / 60, context);
    check(warning.events.length === 1 && warning.events[0].type === 'encounter-warning',
        'due encounter did not lead with exactly one warning');
    check(warning.spawnRequests.length === 0, 'encounter spawned on its warning frame');
    const early = director.update(warning.events[0].duration - 0.01, context);
    check(early.spawnRequests.length === 0, 'encounter spawned before warning duration elapsed');
    const spawned = director.update(0.02, context);
    check(spawned.spawnRequests.length === 1, 'warned encounter did not emit one spawn request');
    return { warning: warning.events[0], result: spawned, request: spawned.spawnRequests[0] };
}

// Same inputs produce byte-for-byte identical cadence, warning, formation,
// ids, and placement. A range of seeds also produces real selection/bearing
// variety without relying on ambient randomness.
const sameA = new EncounterDirector({ biomeId: 'crypts', seed: 'same-run' });
const sameB = new EncounterDirector({ biomeId: 'crypts', seed: 'same-run' });
check(JSON.stringify(sameA.getSnapshot()) === JSON.stringify(sameB.getSnapshot()),
    'same seed produced different initial cadence');
const a = openAndSpawn(sameA);
const b = openAndSpawn(sameB);
check(JSON.stringify(a) === JSON.stringify(b), 'same seed/context produced different encounter output');
const seedSignatures = new Set();
for (let seed = 0; seed < 24; seed++) {
    const director = new EncounterDirector({ biomeId: 'dunes', seed });
    const warning = director.update(0.01, dueContext());
    const spawned = director.update(ENCOUNTER_LIMITS.warningDuration + 0.01, dueContext());
    const request = spawned.spawnRequests[0];
    check(warning.events[0]?.type === 'encounter-warning' && !!request, `seed ${seed} did not produce a pack`);
    seedSignatures.add(`${request.encounterId}:${request.anchor.angle.toFixed(5)}`);
}
check(seedSignatures.size >= 20, 'seeded encounter output has too little variety');

// Spawn requests are canonical, tagged, finite, and bounded by both authored
// size and the exact headroom observed on the issue frame.
const request = a.request;
check(request.type === 'encounter-pack' && request.requestId === request.packId,
    'spawn request identity contract is malformed');
check(request.inheritWaveScale === true, 'encounter bypasses normal wave scaling');
check(request.units.length <= ENCOUNTER_LIMITS.maxUnitsPerPack, 'spawn request exceeded pack cap');
check(request.units.length <= request.enemyCapAtIssue - request.liveEnemyCountAtIssue,
    'spawn request exceeded live enemy headroom');
check(new Set(request.units.map((unit) => unit.memberId)).size === request.units.length,
    'spawn request repeated member ids');
check(request.units.some((unit) => unit.guardian), 'spawn request lost every guardian');
for (const unit of request.units) {
    check(!!ENEMY[unit.type] && !ENEMY[unit.type].boss, `request emitted non-canonical type ${unit.type}`);
    check(unit.memberId.startsWith(`${request.packId}:`), 'member id is not scoped to its pack');
    check(Number.isFinite(unit.offset.x) && Number.isFinite(unit.offset.y), 'formation emitted non-finite offset');
}
check(Number.isFinite(request.anchor.angle) && Number.isFinite(request.anchor.rotation)
    && request.anchor.distance >= 800, 'spawn anchor contract is invalid');

// Low headroom defers before warning. A valid but partial budget truncates the
// eventual request rather than exceeding the wave cap.
const crowded = new EncounterDirector({ biomeId: 'emberwood', seed: 4 });
const crowdedResult = crowded.update(0.1, dueContext({ liveEnemyCount: 179, enemyCap: 9999 }));
check(crowdedResult.events.length === 0 && crowdedResult.spawnRequests.length === 0,
    'director warned or spawned with less than minimum hard-cap headroom');
check(crowded.getSnapshot().phase === 'idle', 'crowded director left idle state');

const partial = new EncounterDirector({ biomeId: 'emberwood', seed: 8 });
const partialContext = dueContext({ liveEnemyCount: 15, enemyCap: 20 });
const partialPack = openAndSpawn(partial, partialContext).request;
check(partialPack.units.length <= 5 && partialPack.units.length >= 4,
    'partial budget was not honored within the pattern minimum');
check(partialPack.enemyCapAtIssue === 20, 'request lost the caller wave cap');

// Bosses and overlays suppress scheduling. If an overlay interrupts a warning,
// the full tell replays after it closes rather than spawning behind the modal.
const bossHeld = new EncounterDirector({ biomeId: 'hollowreach', seed: 2 });
const held = bossHeld.update(100, dueContext({ bossActive: true }));
check(held.events.length === 0 && held.spawnRequests.length === 0 && bossHeld.getSnapshot().phase === 'idle',
    'boss-active update advanced an encounter');
check(bossHeld.update(0, dueContext({ bossActive: false })).events[0]?.type === 'encounter-warning',
    'encounter did not resume after the boss gate cleared');

const interrupted = new EncounterDirector({ biomeId: 'crypts', seed: 9 });
const firstTell = interrupted.update(0, dueContext());
check(firstTell.events[0]?.type === 'encounter-warning', 'interruption setup produced no warning');
const hidden = interrupted.update(99, dueContext({ overlayActive: true }));
check(hidden.events.length === 0 && hidden.spawnRequests.length === 0,
    'warning matured beneath an overlay');
const replay = interrupted.update(0, dueContext({ overlayActive: false }));
check(replay.events[0]?.type === 'encounter-warning' && replay.spawnRequests.length === 0,
    'interrupted warning was not replayed in full');
check(interrupted.update(ENCOUNTER_LIMITS.warningDuration + 0.01, dueContext()).spawnRequests.length === 1,
    'replayed warning did not eventually spawn');

// Guardian lifecycle: acknowledge accepted spawn ids, remove guardians, and
// emit one clear. Duplicate death reports cannot double-complete a pack.
const life = new EncounterDirector({ biomeId: 'dunes', seed: 77 });
const lifeRequest = openAndSpawn(life).request;
const acceptedIds = lifeRequest.units.map((unit) => unit.memberId);
const guardianIds = lifeRequest.units.filter((unit) => unit.guardian).map((unit) => unit.memberId);
const ack = life.update(0, { spawnResults: [{ packId: lifeRequest.packId, acceptedMemberIds: acceptedIds }] });
check(ack.events.length === 0, 'spawn acknowledgement emitted a premature clear');
check(life.getSnapshot().activePack.guardiansRemaining === guardianIds.length,
    'guardian acknowledgement count is wrong');
const clear = life.update(0, { defeatedMemberIds: guardianIds });
check(clear.events.filter((event) => event.type === 'encounter-cleared').length === 1,
    'guardian deaths did not emit exactly one clear event');
check(life.getSnapshot().completedCount === 1 && life.getSnapshot().activePack === null,
    'guardian clear did not close active pack state');
check(life.update(0, { defeatedMemberIds: guardianIds }).events.length === 0,
    'duplicate guardian deaths completed the pack twice');

// A placement result that accepts no guardian aborts rather than creating an
// impossible-to-clear active pack. Clear notices earned behind a modal defer
// until the player can see them.
const rejected = new EncounterDirector({ biomeId: 'emberwood', seed: 31 });
const rejectedRequest = openAndSpawn(rejected).request;
const nonGuardians = rejectedRequest.units.filter((unit) => !unit.guardian).map((unit) => unit.memberId);
const aborted = rejected.update(0, {
    spawnResults: [{ packId: rejectedRequest.packId, acceptedMemberIds: nonGuardians }],
});
check(aborted.events[0]?.type === 'encounter-aborted' && rejected.getSnapshot().activePack === null,
    'guardianless placement left a stuck active encounter');

const insufficient = new EncounterDirector({ biomeId: 'dunes', seed: 32 });
const insufficientRequest = openAndSpawn(insufficient).request;
const oneGuardian = insufficientRequest.units.find((unit) => unit.guardian)?.memberId;
const insufficientResult = insufficient.update(0, {
    spawnResults: [{ packId: insufficientRequest.packId, acceptedMemberIds: [oneGuardian] }],
});
check(insufficientResult.events[0]?.type === 'encounter-aborted'
    && insufficientResult.events[0]?.reason === 'insufficient-placement',
    'sub-minimum placement retained a full-paying tactical pack');
check(insufficient.getSnapshot().activePack === null && insufficient.getSnapshot().completedCount === 0,
    'sub-minimum placement advanced tactical completion state');

const deferred = new EncounterDirector({ biomeId: 'hollowreach', seed: 44 });
const deferredRequest = openAndSpawn(deferred).request;
const deferredIds = deferredRequest.units.map((unit) => unit.memberId);
const deferredGuardians = deferredRequest.units.filter((unit) => unit.guardian).map((unit) => unit.memberId);
deferred.update(0, { spawnResults: [{ packId: deferredRequest.packId, acceptedMemberIds: deferredIds }] });
const hiddenClear = deferred.update(0, { overlayActive: true, defeatedMemberIds: deferredGuardians });
check(hiddenClear.events.length === 0 && deferred.getSnapshot().completedCount === 1,
    'modal clear was not recorded and deferred');
const visibleClear = deferred.update(0, {});
check(visibleClear.events.length === 1 && visibleClear.events[0]?.type === 'encounter-cleared',
    'deferred clear competed with another event after modal');
check(deferred.getSnapshot().nextIn >= ENCOUNTER_LIMITS.warningDuration,
    'new encounter can overwrite a deferred clear immediately');

// Reset/initialize are complete run boundaries, and snapshots are defensive.
const beforeReset = deferred.getSnapshot();
beforeReset.lastCompleted.name = 'mutated';
check(deferred.getSnapshot().lastCompleted.name !== 'mutated', 'snapshot leaked mutable completion state');
const reset = deferred.reset({ biomeId: 'crypts', seed: 'new-run', startTime: 12 });
check(reset.phase === 'idle' && reset.biomeId === 'crypts' && reset.clock === 12
    && reset.issuedCount === 0 && reset.completedCount === 0, 'reset retained prior-run encounter state');
const fallback = deferred.initialize({ biomeId: 'not-a-biome', seed: 1 });
check(fallback.biomeId === 'emberwood', 'initialize did not safely normalize an unknown biome');

// Apex interruption cancels pending and live packs before the boss arena's
// canonical trash banish, without converting those bodies into a free clear.
const cancelWarning = new EncounterDirector({ biomeId: 'emberwood', seed: 100 });
cancelWarning.update(0, dueContext());
const warningCancelEvent = cancelWarning.cancel('boss-warning');
check(warningCancelEvent?.type === 'encounter-aborted' && cancelWarning.getSnapshot().phase === 'idle',
    'cancel did not close a pending encounter warning');
const cancelPack = new EncounterDirector({ biomeId: 'crypts', seed: 101 });
openAndSpawn(cancelPack);
const packCancelEvent = cancelPack.cancel('boss-warning');
check(packCancelEvent?.reason === 'boss-warning' && cancelPack.getSnapshot().activePack === null,
    'cancel did not retire a live encounter pack');
check(cancelPack.cancel('duplicate') === null, 'duplicate cancel emitted a second abort');
const canceledBodies = [
    { encounterPackId: packCancelEvent.packId, encounterMemberId: 'member:1', encounterGuardian: true, encounterName: 'Pack' },
    { encounterPackId: 'other-pack', encounterMemberId: 'member:2', encounterGuardian: true, encounterName: 'Other' },
    { active: true },
];
check(retireEncounterEnemyTags(canceledBodies, packCancelEvent.packId) === 1,
    'boss cancellation did not find exactly its surviving pack bodies');
check(canceledBodies[0].encounterPackId === null && canceledBodies[0].encounterMemberId === null
    && canceledBodies[0].encounterGuardian === false && canceledBodies[0].encounterName === null,
    'aborted pack body retained dishonest guardian or reward lifecycle tags');
check(canceledBodies[1].encounterPackId === 'other-pack' && canceledBodies[1].encounterGuardian === true,
    'retiring one pack mutated an unrelated tactical pack');
check(retireEncounterEnemyTags(canceledBodies, '') === 0 && retireEncounterEnemyTags(null, packCancelEvent.packId) === 0,
    'tag retirement accepts malformed integration inputs');

console.log(`encounter validation: OK — ${checks} checks across ${ENCOUNTER_PATTERNS.length} tactical patterns.`);
