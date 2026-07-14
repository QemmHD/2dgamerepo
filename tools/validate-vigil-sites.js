#!/usr/bin/env node
// Headless contract gate for Vigil Sites. No DOM, Canvas implementation,
// storage, or live Game boot is required.

import {
    VIGIL_SITE_ARCHETYPES,
    VIGIL_SITE_BIOMES,
    VIGIL_SITE_LIMITS,
    VIGIL_SITE_ORDER,
} from '../src/content/vigilSites.js';
import {
    VigilSiteSystem,
    livingVigilRunSeed,
    vigilSiteHash,
    vigilSiteSetpieceBusy,
} from '../src/systems/VigilSiteSystem.js';
import { ENEMY, WORLD_HEIGHT, WORLD_WIDTH, xpRequired } from '../src/config/GameConfig.js';
import { ObstacleSystem } from '../src/systems/ObstacleSystem.js';

let checks = 0;
let failures = 0;
function ok(value, message) {
    checks++;
    if (!value) {
        failures++;
        console.error(`  x ${message}`);
    }
}

function fixtureStructures(count = 9) {
    return Array.from({ length: count }, (_, i) => ({
        id: `fixture-${i}`,
        x: 950 + (i % 3) * 720,
        y: -1450 + Math.floor(i / 3) * 920,
        styleType: i % 2 ? 'ruin' : 'cabin',
        interiorW: 230 + (i % 3) * 24,
        interiorH: 190 + (i % 2) * 26,
        wall: 28 + (i % 3),
        wallH: 150,
        door: 136,
        visualSeed: 1000 + i * 97,
        palette: { base: '#554435', top: '#765b3f', edge: '#2b221c' },
    }));
}

function deterministicShape(system) {
    return system.sites.map((site) => ({
        id: site.id,
        structureId: site.structureId,
        archetype: site.archetype,
        x: site.x,
        y: site.y,
        seed: site.seed,
        spawns: site.guardianSpawns || null,
    }));
}

function standOn(system, site, game, frames = 5) {
    game.player.x = site.x;
    game.player.y = site.y;
    for (let i = 0; i < frames; i++) system.update(0.25, game);
}

class MockContext {
    constructor() {
        this.globalAlpha = 1;
        this.drawCalls = 0;
    }
    save() { this.drawCalls++; }
    restore() {}
    translate() {}
    beginPath() {}
    closePath() {}
    moveTo() {}
    lineTo() {}
    ellipse() {}
    arc() {}
    fill() { this.drawCalls++; }
    stroke() { this.drawCalls++; }
    fillRect() { this.drawCalls++; }
    strokeRect() { this.drawCalls++; }
    fillText() { this.drawCalls++; }
    measureText(text) { return { width: String(text).length * 9 }; }
}

// Authored content and hard caps.
ok(VIGIL_SITE_ORDER.length >= 4, 'at least four site archetypes are ordered');
ok(new Set(VIGIL_SITE_ORDER).size === VIGIL_SITE_ORDER.length, 'site order contains no duplicates');
for (const required of ['hearth', 'archive', 'cache', 'beacon']) {
    const def = VIGIL_SITE_ARCHETYPES[required];
    ok(!!def, `${required} archetype exists`);
    ok(!!def?.name && !!def?.verb && !!def?.symbol, `${required} has readable name/verb/symbol cues`);
    ok(Number.isFinite(def?.activationRadius) && def.activationRadius > 0, `${required} has a bounded interaction radius`);
    ok(Number.isFinite(def?.dwellSeconds) && def.dwellSeconds > 0, `${required} has a positive dwell time`);
}
ok(VIGIL_SITE_ARCHETYPES.hearth.reward.type === 'heal', 'hearth authors a heal reward');
ok(VIGIL_SITE_ARCHETYPES.archive.reward.type === 'xp', 'archive authors an XP reward');
ok(VIGIL_SITE_ARCHETYPES.cache.reward.type === 'coins', 'cache authors a run-coin reward');
ok(VIGIL_SITE_ARCHETYPES.archive.reward.base < xpRequired(1) + xpRequired(2),
    'fresh archive cannot dump multiple level-up drafts at once');
const lowestBossXp = Math.min(...Object.values(ENEMY).filter((enemy) => enemy.boss).map((enemy) => enemy.xpValue));
ok(VIGIL_SITE_ARCHETYPES.beacon.challenge.completionXp < lowestBossXp,
    'guardian completion XP stays below an apex reward');
ok(VIGIL_SITE_ARCHETYPES.beacon.challenge.count <= VIGIL_SITE_LIMITS.maxGuardians,
    'beacon guardian count respects the hard cap');
ok(VIGIL_SITE_LIMITS.maxSites <= VIGIL_SITE_ORDER.length, 'site cap cannot duplicate archetypes');
ok(VIGIL_SITE_LIMITS.maxQueuedEvents >= VIGIL_SITE_LIMITS.maxSites + 2,
    'event queue can hold every once-per-run outcome without dropping rewards');

for (const [biomeId, biome] of Object.entries(VIGIL_SITE_BIOMES)) {
    ok(Array.isArray(biome.guardianTypes) && biome.guardianTypes.length >= VIGIL_SITE_LIMITS.maxGuardians,
        `${biomeId} has a complete guardian pool`);
    for (const type of biome.guardianTypes) {
        ok(!!ENEMY[type], `${biomeId} guardian ${type} resolves to an enemy definition`);
        ok(!ENEMY[type]?.boss, `${biomeId} guardian ${type} is never a boss`);
        ok(!['summoner', 'splitter'].includes(type), `${biomeId} guardian ${type} cannot multiply the encounter`);
    }
}

// Real structure-generation seam: this stays headless and proves the system
// consumes ObstacleSystem itself, not only hand-shaped fixtures.
for (const biomeId of Object.keys(VIGIL_SITE_BIOMES)) {
    const obstacles = new ObstacleSystem();
    obstacles.generate(WORLD_WIDTH, WORLD_HEIGHT, biomeId);
    const liveSites = new VigilSiteSystem();
    liveSites.initialize(obstacles, biomeId, { seed: 1 });
    ok(obstacles.structures.length >= VIGIL_SITE_LIMITS.maxSites,
        `${biomeId} real world generates enough enterable structures`);
    ok(liveSites.sites.length === VIGIL_SITE_LIMITS.maxSites,
        `${biomeId} initializes four sites from the real ObstacleSystem API`);
    ok(new Set(liveSites.sites.map((site) => site.structureId)).size === liveSites.sites.length,
        `${biomeId} real integration keeps one site per structure`);
}

// Stable placement, no source mutation, unique structures/archetypes.
const structures = fixtureStructures();
const before = JSON.stringify(structures);
const a = new VigilSiteSystem();
const b = new VigilSiteSystem();
a.initialize({ structures }, 'crypts', { seed: 77 });
b.initialize(structures, 'crypts', { seed: 77 });
ok(JSON.stringify(structures) === before, 'initialization never mutates obstacle structures');
ok(JSON.stringify(deterministicShape(a)) === JSON.stringify(deterministicShape(b)),
    'same structures/biome/seed produce identical sites and guardian spawns');
ok(vigilSiteHash('stable', 77) === vigilSiteHash('stable', 77), 'site hash is stable');
const standardSeed = livingVigilRunSeed({ day: 700, runSerial: 4, mapSerial: 2, heroSerial: 3 });
ok(standardSeed === livingVigilRunSeed({ day: 700, runSerial: 4, mapSerial: 2, heroSerial: 3 }),
    'standard board seed is reproducible for identical run inputs');
ok(standardSeed !== livingVigilRunSeed({ day: 700, runSerial: 5, mapSerial: 2, heroSerial: 3 }),
    'standard board rotates after the recorded-run serial advances');
const dailySeed = livingVigilRunSeed({ day: 700, runSerial: 4, mapSerial: 2, heroSerial: 3, dailyMode: true });
ok(dailySeed === livingVigilRunSeed({ day: 700, runSerial: 999, mapSerial: 2, heroSerial: 1, dailyMode: true }),
    'Daily Road board ignores account history and selected hero');
ok(dailySeed !== livingVigilRunSeed({ day: 701, runSerial: 4, mapSerial: 2, heroSerial: 3, dailyMode: true }),
    'Daily Road board rotates on the UTC day boundary');
const riteSeed = livingVigilRunSeed({ day: 700, runSerial: 4, mapSerial: 2, heroSerial: 3, riteTrialMode: true });
ok(riteSeed === livingVigilRunSeed({ day: 700, runSerial: 999, mapSerial: 2, heroSerial: 3, riteTrialMode: true }),
    'Rite Trial board ignores account run history');
ok(riteSeed !== livingVigilRunSeed({ day: 700, runSerial: 4, mapSerial: 2, heroSerial: 4, riteTrialMode: true }),
    'Rite Trial board keeps its authored hero signature');
ok(a.sites.length === VIGIL_SITE_LIMITS.maxSites, 'healthy structure set receives the capped four sites');
ok(new Set(a.sites.map((site) => site.structureId)).size === a.sites.length,
    'one structure hosts at most one site');
ok(new Set(a.sites.map((site) => site.archetype)).size === a.sites.length,
    'a four-site run contains all distinct archetypes');
ok(VIGIL_SITE_ORDER.every((id) => a.sites.some((site) => site.archetype === id)),
    'hearth, archive, cache, and beacon all appear when four houses exist');

const c = new VigilSiteSystem();
c.initialize(structures, 'crypts', { seed: 78 });
ok(JSON.stringify(deterministicShape(a)) !== JSON.stringify(deterministicShape(c)),
    'an explicit run seed can vary the deterministic exploration layout');

for (const site of a.sites) {
    const structure = structures.find((entry) => entry.id === site.structureId);
    ok(!!structure, `${site.id} retains a valid structure attachment`);
    ok(Math.abs(site.x - structure.x) <= structure.interiorW * 0.5 - 57,
        `${site.id} remains inside the horizontal interior margin`);
    ok(Math.abs(site.y - structure.y) <= structure.interiorH * 0.5 - 65,
        `${site.id} remains inside the vertical interior margin`);
    ok(Number.isFinite(site.baseY), `${site.id} exposes a painter baseline`);
}

const excluded = new VigilSiteSystem();
excluded.initialize(structures, 'emberwood', {
    seed: 77,
    exclusionZones: [{ x: structures[0].x, y: structures[0].y, r: 400 }],
});
ok(!excluded.sites.some((site) => site.structureId === structures[0].id),
    'initialization excludes structures reserved by an arena/POI zone');
ok(excluded.sites.length <= VIGIL_SITE_LIMITS.maxSites, 'exclusions never breach the site cap');

const malformed = new VigilSiteSystem();
malformed.initialize([
    null,
    { id: 'tiny', x: 0, y: 0, interiorW: 20, interiorH: 20 },
    { id: 'bad', x: NaN, y: 0, interiorW: 230, interiorH: 190 },
    structures[0],
    { ...structures[0] },
], 'emberwood');
ok(malformed.sites.length === 1, 'invalid, tiny, and duplicate structures are ignored safely');

// Runtime rewards: full-health hearth waits, all rewards emit once, and no
// method writes Player/Save state directly.
const runtime = new VigilSiteSystem();
runtime.initialize(structures, 'emberwood', { seed: 91 });
const byKind = Object.fromEntries(runtime.sites.map((site) => [site.archetype, site]));
const game = {
    player: { x: 0, y: 0, radius: 50, hp: 100, maxHp: 100, level: 7 },
    enemies: [],
};

// Beacon capacity is a readable wait state, never a consumed or discounted
// challenge. Zero-, one-, and two-guardian acknowledgements all return it to
// dormant so only the complete authored pack can light progress or pay.
const capacityRuntime = new VigilSiteSystem();
capacityRuntime.initialize(structures, 'emberwood', { seed: 191 });
const capacityBeacon = capacityRuntime.sites.find((site) => site.archetype === 'beacon');
const capacityGame = {
    player: { x: capacityBeacon.x, y: capacityBeacon.y, radius: 50, hp: 80, maxHp: 100, level: 7 },
    enemies: Array.from({ length: 5 }, () => ({ active: true })),
    waveState: { maxAlive: 7 },
};
standOn(capacityRuntime, capacityBeacon, capacityGame, 6);
ok(capacityRuntime.drainEvents().length === 0 && capacityBeacon.state === 'dormant',
    'Beacon remains retryable when fewer than three enemy slots are free');
ok(capacityRuntime.getFocusSnapshot()?.reason === 'enemy-capacity'
    && /CLEAR SPACE/.test(capacityRuntime.getFocusSnapshot()?.prompt || ''),
    'capacity wait exposes a readable clear-space prompt');
capacityGame.enemies[0].active = false;
for (const acceptedCount of [0, 1, 2]) {
    standOn(capacityRuntime, capacityBeacon, capacityGame, 6);
    const capacitySpawn = capacityRuntime.drainEvents().find((event) => event.kind === 'spawn');
    ok(capacitySpawn?.spawns.length === 3, `retry ${acceptedCount} requests the complete three-guardian pack`);
    const partial = capacitySpawn.spawns.slice(0, acceptedCount).map((request) => ({ active: true, type: request.type }));
    ok(!capacityRuntime.acknowledgeGuardianSpawn(capacityBeacon.id, partial),
        `${acceptedCount}-guardian acknowledgement is rejected as a partial pack`);
    const deferred = capacityRuntime.drainEvents();
    ok(deferred.length === 1 && deferred[0].status === 'deferred' && deferred[0].reason === 'spawn-deferred',
        `${acceptedCount}-guardian rejection emits one retryable status`);
    ok(capacityBeacon.state === 'dormant' && partial.every((enemy) => enemy.active === false),
        `${acceptedCount}-guardian rejection restores dormant state and retires partial refs`);
}
standOn(runtime, byKind.hearth, game);
ok(runtime.peekEvents().length === 0 && byKind.hearth.state === 'dormant',
    'full-health hearth remains available instead of wasting its one use');
ok(runtime.getFocusSnapshot()?.reason === 'health-full', 'full-health hearth exposes a readable blocked reason');
game.player.hp = 44;
standOn(runtime, byKind.hearth, game);
let events = runtime.drainEvents();
ok(events.length === 1 && events[0].kind === 'reward' && events[0].reward.type === 'heal',
    'damaged player receives one heal event');
ok(events[0].reward.target === 'player.hp', 'heal event names its integration target');
ok(events[0].reward.amount <= VIGIL_SITE_ARCHETYPES.hearth.reward.max,
    'hearth amount is capped');
ok(game.player.hp === 44, 'site system emits heal without mutating player health');
standOn(runtime, byKind.hearth, game, 8);
ok(runtime.drainEvents().length === 0, 'spent hearth cannot pay twice');

standOn(runtime, byKind.archive, game);
events = runtime.drainEvents();
ok(events.length === 1 && events[0].reward.type === 'xp', 'archive emits one XP event');
ok(events[0].reward.target === 'player.gainXP', 'archive event names the level-aware XP integration method');
ok(events[0].reward.amount <= VIGIL_SITE_ARCHETYPES.archive.reward.max, 'archive XP is capped');
standOn(runtime, byKind.cache, game);
events = runtime.drainEvents();
ok(events.length === 1 && events[0].reward.type === 'coins', 'cache emits one run-coin event');
ok(events[0].reward.target === 'player.coins', 'cache event names its integration target');
ok(events[0].reward.amount >= VIGIL_SITE_ARCHETYPES.cache.reward.min
    && events[0].reward.amount <= VIGIL_SITE_ARCHETYPES.cache.reward.max, 'cache payout stays in authored bounds');

// Boss/setpiece safety, bounded guardian request, explicit acknowledgment, and
// seen-then-cleared completion.
game.bossWarning = { timer: 2 };
standOn(runtime, byKind.beacon, game, 6);
ok(runtime.peekEvents().length === 0 && byKind.beacon.state === 'dormant',
    'beacon cannot activate during a boss warning');
ok(vigilSiteSetpieceBusy(game), 'boss warning is recognized as a set piece');
ok(vigilSiteSetpieceBusy({ bossRush: {} }), 'Boss Rush prep is recognized as a continuous set piece');
ok(vigilSiteSetpieceBusy({ vigilEncounterBusy: true }), 'tactical encounter blocks a conflicting site activation');
game.bossWarning = null;
standOn(runtime, byKind.beacon, game, 6);
events = runtime.drainEvents();
const spawn = events.find((event) => event.kind === 'spawn');
ok(!!spawn, 'beacon emits a guardian spawn request');
ok(spawn?.spawns.length > 0 && spawn.spawns.length <= VIGIL_SITE_LIMITS.maxGuardians,
    'spawn request is non-empty and hard-capped');
ok(spawn?.maxAlive === VIGIL_SITE_LIMITS.maxGuardians, 'spawn event advertises its alive cap');
for (const request of spawn?.spawns || []) {
    ok(!!ENEMY[request.type] && !ENEMY[request.type].boss, `${request.type} spawn is a valid non-boss`);
    ok(request.vigilSiteId === byKind.beacon.id, `${request.type} spawn carries the completion tag`);
    ok(request.clearance >= (ENEMY[request.type]?.radius || 0),
        `${request.type} spawn clearance covers its authored body radius`);
    ok(Number.isFinite(request.x) && Number.isFinite(request.y), `${request.type} spawn has finite coordinates`);
    const structure = byKind.beacon.structure;
    ok(Math.abs(request.y - structure.y) > structure.interiorH * 0.5 + structure.wall,
        `${request.type} spawns outside the house collision ring`);
}
ok(runtime.hasActiveChallenge(), 'awaiting guardians blocks conflicting encounter scheduling');
const guardians = (spawn?.spawns || []).map((request) => ({ active: true, type: request.type }));
ok(runtime.acknowledgeGuardianSpawn(byKind.beacon.id, guardians), 'spawned guardians can be acknowledged');
ok(guardians.every((enemy) => enemy.vigilSiteId === byKind.beacon.id), 'acknowledgment tags guardian objects');
runtime.update(0.1, game);
ok(runtime.drainEvents().length === 0 && runtime.hasActiveChallenge(), 'living guardians cannot pay the clear reward');
for (const guardian of guardians) guardian.active = false;
runtime.update(0.1, game);
events = runtime.drainEvents();
ok(events.length === 1 && events[0].kind === 'reward' && events[0].reward.type === 'bundle',
    'seen-and-cleared guardians emit exactly one completion bundle');
ok(events[0].reward.targets?.coins === 'player.coins' && events[0].reward.targets?.xp === 'player.gainXP',
    'guardian bundle names both integration targets');
ok(events[0].reward.coins === VIGIL_SITE_ARCHETYPES.beacon.challenge.completionCoins
    && events[0].reward.xp === VIGIL_SITE_ARCHETYPES.beacon.challenge.completionXp,
    'guardian completion bundle matches authored values');
ok(!runtime.hasActiveChallenge() && byKind.beacon.state === 'spent', 'cleared beacon releases encounter scheduling');
runtime.update(1, game);
ok(runtime.drainEvents().length === 0, 'cleared beacon cannot pay twice');
ok(runtime.droppedEvents === 0, 'complete four-site run fits inside the event queue');

// An actual arena interrupt can never convert boss-cleared guardians into a
// free reward.
const interrupted = new VigilSiteSystem();
interrupted.initialize(structures, 'dunes', { seed: 22 });
const interruptedBeacon = interrupted.sites.find((site) => site.archetype === 'beacon');
const conflictGame = { player: { x: interruptedBeacon.x, y: interruptedBeacon.y, radius: 50, hp: 50, maxHp: 100, level: 1 }, enemies: [] };
standOn(interrupted, interruptedBeacon, conflictGame, 6);
const conflictSpawn = interrupted.drainEvents().find((event) => event.kind === 'spawn');
const conflictGuardians = conflictSpawn.spawns.map((request) => ({ active: true, type: request.type }));
interrupted.acknowledgeGuardianSpawn(interruptedBeacon.id, conflictGuardians);
for (const guardian of conflictGuardians) guardian.active = false;
conflictGame.arena = { x: 0, y: 0, r: 900 };
interrupted.update(0.1, conflictGame);
events = interrupted.drainEvents();
ok(events.length === 1 && events[0].kind === 'status' && events[0].reason === 'boss-conflict',
    'arena interruption fails the site without granting its clear reward');

// Pauses freeze spawn acknowledgment timeout; explicit-only mode remains usable.
const timeout = new VigilSiteSystem();
timeout.initialize(structures, 'hollowreach', { seed: 35 });
const timeoutBeacon = timeout.sites.find((site) => site.archetype === 'beacon');
const timeoutGame = { player: { x: timeoutBeacon.x, y: timeoutBeacon.y, radius: 50, hp: 80, maxHp: 100 }, enemies: [] };
standOn(timeout, timeoutBeacon, timeoutGame, 6);
timeout.drainEvents();
timeoutGame.paused = true;
for (let i = 0; i < 20; i++) timeout.update(0.25, timeoutGame);
ok(timeoutBeacon.state === 'awaiting-guardians' && timeout.drainEvents().length === 0,
    'pause/modal time cannot expire a pending guardian spawn');
timeoutGame.paused = false;
for (let i = 0; i < 9; i++) timeout.update(0.25, timeoutGame);
events = timeout.drainEvents();
ok(events.length === 1 && events[0].reason === 'spawn-timeout', 'unacknowledged spawn fails once after live time resumes');

const explicitOnly = new VigilSiteSystem({ autoActivate: false });
explicitOnly.initialize(structures, 'emberwood', { seed: 48 });
const explicitCache = explicitOnly.sites.find((site) => site.archetype === 'cache');
const explicitGame = { player: { x: explicitCache.x, y: explicitCache.y, radius: 50, hp: 50, maxHp: 100, level: 1 }, enemies: [] };
standOn(explicitOnly, explicitCache, explicitGame, 8);
ok(explicitOnly.drainEvents().length === 0, 'explicit-only mode does not auto-consume a site');
explicitGame.vigilInteract = true;
explicitOnly.update(0.01, explicitGame);
ok(explicitOnly.drainEvents()[0]?.reward.type === 'coins', 'explicit interaction activates the nearest site');

// Render API stays Canvas-shaped but headless/testable and culls by camera.
const ctx = new MockContext();
let lights = 0;
a.draw(ctx, null, Infinity, Infinity, { addLight() { lights++; } });
a.focus = a._focusSnapshot(a.sites[0], 0.5, true);
a.drawAbove(ctx);
ok(ctx.drawCalls > 0, 'procedural draw paths execute against a headless Canvas-shaped context');
ok(lights <= VIGIL_SITE_LIMITS.maxSites, 'rendering registers at most one light per site');
let visible = 0;
const target = a.sites[0];
a.forVisible({ x: target.x, y: target.y }, 100, 100, () => { visible++; });
ok(visible >= 1 && visible <= VIGIL_SITE_LIMITS.maxSites, 'camera culling exposes only bounded nearby sites');
const snapshots = a.getRenderSnapshots();
ok(snapshots.length === a.sites.length && snapshots.every((site) => Number.isFinite(site.baseY)),
    'render snapshots expose every site with a painter baseline');

if (failures) {
    console.error(`Vigil site validation: FAILED (${failures}/${checks})`);
    process.exit(1);
}
console.log(`Vigil site validation: OK — ${checks} deterministic placement, reward, encounter, and render checks.`);
