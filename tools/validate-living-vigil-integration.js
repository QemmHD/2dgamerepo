#!/usr/bin/env node
// Cross-module integration gate for Living Vigil. The dedicated content/system
// validators prove each unit in depth; this file protects the seams that make
// those units a playable, banked, and visible part of a normal run.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameUpdateMethods } from '../src/core/GameUpdate.js';
import { UISystem } from '../src/systems/UISystem.js';
import { SaveSystem } from '../src/systems/SaveSystem.js';
import { RUN_XP_RULES, runXpBreakdown } from '../src/systems/BattlePassSystem.js';
import { WAVE_LIMITS } from '../src/config/GameConfig.js';

let checks = 0;
function check(condition, message) {
    assert.ok(condition, message);
    checks++;
}

// Keep source-contract checks identical on GitHub's LF checkout and Windows
// worktrees where Git may materialize CRLF line endings.
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');
const gameSource = source('src/core/Game.js');
const runStateSource = source('src/core/RunState.js');
const updateSource = source('src/core/GameUpdate.js');
const renderSource = source('src/core/GameRender.js');
const combatSource = source('src/core/CombatResolver.js');
const uiStateSource = source('src/systems/UIStateBuilder.js');
const uiSource = source('src/systems/UISystem.js');
const menuSource = source('src/systems/MenuRenderer.js');
const saveSource = source('src/systems/SaveSystem.js');
const battlePassSource = source('src/systems/BattlePassSystem.js');

function sourceCheck(text, pattern, message) {
    check(pattern.test(text), message);
}

// Game owns construction and run-boundary gating. Boss Rush/Weekly Ember use
// _bossRushConfig, so neither mode can accidentally inherit exploration sites,
// tactical packs, or a normal-run tracker.
for (const name of ['VigilSiteSystem', 'EncounterDirector', 'VigilTracker']) {
    sourceCheck(gameSource, new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from`), `Game imports ${name}`);
    sourceCheck(gameSource, new RegExp(`new ${name}\\b`), `Game constructs ${name} for a normal run`);
}
sourceCheck(gameSource, /if \(!this\._bossRushConfig\) \{[\s\S]*?new VigilSiteSystem[\s\S]*?new EncounterDirector[\s\S]*?new VigilTracker[\s\S]*?\} else \{[\s\S]*?this\.vigilSiteSystem = null;[\s\S]*?this\.encounterDirector = null;[\s\S]*?this\.vigilTracker = null;/,
    'all Living Vigil systems share the no-Boss-Rush construction gate');
sourceCheck(gameSource, /livingVigilRunSeed\(\{[\s\S]*?day: currentDayNumber\(\)[\s\S]*?runSerial[\s\S]*?mapSerial[\s\S]*?heroSerial[\s\S]*?dailyMode: this\.dailyMode[\s\S]*?riteTrialMode: this\.riteTrialMode/,
    'run seed delegates day, run, map, hero, and fixed-day mode inputs to the tested contract');
sourceCheck(gameSource, /encounterDirector\?\.cancel\?\.\('boss-warning'\)/,
    'boss warning explicitly cancels a pending/live tactical encounter');
sourceCheck(gameSource, /canceledEncounter[\s\S]*?vigilTracker\?\.ingest/,
    'boss cancellation is forwarded to the visible tracker');
sourceCheck(gameSource, /retireEncounterEnemyTags\(this\.enemies, canceledEncounter\.packId\)[\s\S]*?vigilTracker\?\.ingest/,
    'boss cancellation removes stale guardian markers before the tracker abort');

for (const field of [
    'vigilSitesActivated',
    '_vigilKindsActivated',
    '_activatedVigilSiteIds',
    'encountersCleared',
    'guardianPacksDefeated',
    'vigilSiteSystem',
    'encounterDirector',
    'vigilTracker',
    '_encounterDefeatedIds',
    '_encounterRewardPos',
]) {
    sourceCheck(runStateSource, new RegExp(`this\\.${field.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*=`),
        `RunState resets ${field}`);
}
check((gameSource.match(/vigilSitesActivated:\s*this\.vigilSitesActivated/g) || []).length >= 2,
    'victory and death summaries both carry activated-site count');
check((gameSource.match(/vigilSiteKindsMastered:\s*this\._vigilKindsActivated\?\.size/g) || []).length >= 2,
    'victory and death summaries both carry distinct-site mastery');
check((gameSource.match(/encountersCleared:\s*this\.encountersCleared/g) || []).length >= 2,
    'victory and death summaries both carry tactical-pack clears');
check((gameSource.match(/guardianPacksDefeated:\s*this\.guardianPacksDefeated/g) || []).length >= 2,
    'victory and death summaries both carry guardian-pack clears');

// Update-pipeline contracts: scheduling is conflict-aware, placement is
// obstacle-safe and cap-aware, rewards are immediate/earned, and kill ids make
// the round trip from Enemy death back into EncounterDirector.
sourceCheck(updateSource, /const bossActiveNow = !!this\.arena \|\| this\.enemies\.some[\s\S]*?this\._updateEncounterDirector\(dt, bossActiveNow, lieutenantAlive\)/,
    'director receives same-frame boss/arena and lieutenant ownership');
sourceCheck(updateSource, /overlayActive:[\s\S]*?vigilSiteSystem\?\.hasActiveChallenge/,
    'active beacon guardians block overlapping tactical-pack scheduling');
sourceCheck(updateSource, /const siteChallengeActive = !!this\.vigilSiteSystem\?\.hasActiveChallenge\?\.\(\)/,
    'director frame takes one authoritative Beacon-stage snapshot');
sourceCheck(updateSource, /else if \(!bossAlive && !this\.bossWarning && !siteChallengeActive && !pendingEncounterLifecycle\)/,
    'normal boss scheduling waits for Beacon ownership and queued tactical lifecycle');
sourceCheck(updateSource, /const pendingEncounterLifecycle = encounterPhase === 'active'[\s\S]*?_encounterDefeatedIds[\s\S]*?!pendingEncounterLifecycle/,
    'boss scheduling yields one frame to queued tactical guardian deaths');
sourceCheck(updateSource, /const bossActiveForLieutenant =[\s\S]*?this\.enemies\.some\([\s\S]*?const authoredChallengeActive = siteChallengeActive[\s\S]*?encounterPhase !== 'idle'[\s\S]*?!lieutenantAlive && !authoredChallengeActive/,
    'Lieutenant scheduling waits for Beacon and tactical authored challenges');
sourceCheck(updateSource, /lieutenantAlive = this\.enemies\.some\([\s\S]*?_updateEncounterDirector\(dt, bossActiveNow, lieutenantAlive\)/,
    'director arbitration rechecks same-frame Lieutenant spawns');
sourceCheck(updateSource, /this\._updateVigilSites\(dt\)/, 'site update is part of the live player/world pipeline');
sourceCheck(updateSource, /Math\.min\([\s\S]*?WAVE_LIMITS\.maxEnemyCap[\s\S]*?request\.enemyCapAtIssue/,
    'tactical-pack placement rechecks global, wave, and issue-time caps');
sourceCheck(updateSource, /_spawnEncounterPack[\s\S]*?def\.boss[\s\S]*?obstacleSystem\.isBlocked/,
    'tactical placement rejects bosses and blocked positions');
sourceCheck(updateSource, /enemy\.encounterMemberId = unit\.memberId[\s\S]*?enemy\.encounterGuardian = unit\.guardian === true/,
    'spawned tactical enemies retain member and guardian lifecycle tags');
sourceCheck(updateSource, /event\.type === 'encounter-aborted'[\s\S]*?retireEncounterEnemyTags\(this\.enemies, event\.packId\)/,
    'aborted partial formations lose guardian markers and reward lifecycle tags');
sourceCheck(updateSource, /_spawnVigilGuardians[\s\S]*?WAVE_LIMITS\.maxEnemyCap[\s\S]*?event\.maxAlive[\s\S]*?def\.boss[\s\S]*?obstacleSystem\.isBlocked/,
    'beacon guardian placement honors global/event caps and rejects bosses/blocked spots');
sourceCheck(updateSource, /const requests = event\.spawns\.slice[\s\S]*?cap - live < requests\.length[\s\S]*?const placements = \[\][\s\S]*?for \(const \{ request, spot \} of placements\)/,
    'beacon placement preflights the complete pack before constructing any guardian');
sourceCheck(combatSource, /encounterMemberId[\s\S]*?_encounterDefeatedIds\.push/,
    'combat deaths report tactical member ids to the director queue');
sourceCheck(updateSource, /_grantVigilXp\(24, pos\.x, pos\.y\)/,
    'tactical clear grants its authored XP immediately');
sourceCheck(updateSource, /_grantVigilXp\(amount, event\.x, event\.y\)/,
    'archive XP uses the immediate earned-XP path');
sourceCheck(updateSource, /_grantVigilXp\(xp, event\.x, event\.y\)/,
    'beacon bundle XP uses the immediate earned-XP path');
sourceCheck(updateSource, /player\.gainXP\(amount\)[\s\S]*?pendingLevelUps \+= levels/,
    'earned Living Vigil XP goes through Player.gainXP and queues every level draft');
check(!/_grantVigilXp[\s\S]{0,120}_dropGem/.test(updateSource),
    'earned Living Vigil XP is not converted back into a missable loose pickup');
const encounterHandlerSource = updateSource.match(/_handleEncounterEvent\(event\) \{[\s\S]*?\n    \},\n\n    _updateVigilSites/)?.[0] || '';
const siteHandlerSource = updateSource.match(/_handleVigilSiteEvent\(event\) \{[\s\S]*?\n    \},\n\n    _recordVigilSiteActivation/)?.[0] || '';
check(/this\.encountersCleared \+= 1/.test(encounterHandlerSource)
    && !/guardianPacksDefeated \+= 1/.test(encounterHandlerSource),
    'tactical clear advances only the tactical-encounter counter');
check(/guardianPacksDefeated \+= 1/.test(siteHandlerSource)
    && !/this\.encountersCleared \+= 1/.test(siteHandlerSource),
    'beacon bundle advances only the guardian-pack counter');
sourceCheck(battlePassSource, /encounters \* RUN_XP_RULES\.tacticalEncounter[\s\S]*?guardianPacks \* RUN_XP_RULES\.guardianPack/,
    'battle pass prices tactical and guardian clears as separate inputs');

// Rendering/UI seams: world props take part in painter ordering and lighting,
// prompts remain above the veil, and HUD placement comes from the shared layout.
sourceCheck(renderSource, /vigilSiteSystem\?\.draw\?\./, 'world render invokes procedural site drawing');
sourceCheck(renderSource, /vigilSiteSystem\?\.forVisible\?\./, 'lighting pass culls and visits visible sites');
sourceCheck(renderSource, /encounterGuardian[\s\S]*?_drawEncounterGuardianMark/,
    'guardian enemies receive their readable world marker');
sourceCheck(renderSource, /vigilSiteSystem\.drawAbove\(/, 'site interaction copy has an above-veil render pass');
sourceCheck(renderSource, /const vigilLayout = this\.ui\.getHUDLayout\(gameplayUIState\);[\s\S]*?vigilTracker\.drawHUD\(ctx, vigilLayout\.vigil, \{[\s\S]*?compact: vigilLayout\.compact,[\s\S]*?uiScale,[\s\S]*?highContrast/,
    'tracker HUD consumes the shared layout rectangle and accessibility preferences');
sourceCheck(renderSource, /const gameplayUIState = buildUIState\(this\);[\s\S]*?const largeAnnouncementActive = !!gameplayUIState\.waveAnnouncement;[\s\S]*?if \(this\.screen === 'gameplay' && this\.vigilTracker && !largeAnnouncementActive\) \{[\s\S]*?vigilTracker\.drawHUD/,
    'large gameplay announcement deterministically suppresses the persistent tracker chip');
sourceCheck(renderSource, /if \(this\.photoMode\.hudShown\) \{[\s\S]*?const vigilLayout = this\.ui\.getHUDLayout\(photoUIState\);[\s\S]*?vigilTracker\.drawHUD\(ctx, vigilLayout\.vigil, \{[\s\S]*?compact: vigilLayout\.compact,[\s\S]*?uiScale,[\s\S]*?highContrast,[\s\S]*?this\.ui\.draw\(ctx, photoUIState\)/,
    'photo mode HUD toggle passes the Living Vigil layout and accessibility preferences');
const photoModeRenderSource = renderSource.match(/if \(this\.photoMode\) \{[\s\S]*?\n            return;\n        \}/)?.[0] || '';
sourceCheck(photoModeRenderSource, /if \(this\.screen === 'gameplay' && this\.vigilTracker\) \{[\s\S]*?vigilTracker\.drawHUD/,
    'photo-mode HUD keeps its normal tracker behavior during annotated shots');
check(!photoModeRenderSource.includes('largeAnnouncementActive'),
    'gameplay announcement suppression does not leak into photo mode');
check((renderSource.match(/vigilTracker\.drawHUD\(ctx, vigilLayout\.vigil, \{[\s\S]*?uiScale,[\s\S]*?highContrast,[\s\S]*?\}\);/g) || []).length === 2,
    'both gameplay and photo-mode Living Vigil draws receive UI scale and high contrast');
sourceCheck(renderSource, /getSetting\?\.\('uiScale'\) \?\? 100/,
    'combat renderer reads UI scale once for procedural combat HUD consumers');
check(renderSource.indexOf('vigilSiteSystem.drawAbove') < renderSource.indexOf('this.ui.draw(ctx, gameplayUIState)'),
    'site prompt is composed before the final HUD without bypassing it');
sourceCheck(uiStateSource, /base\.vigilTracker = game\.vigilTracker\?\.getSnapshot\?\.\(\) \?\? null/,
    'UI state exposes only a defensive tracker snapshot');
sourceCheck(uiSource, /hasVigil: !!state\.vigilTracker/, 'UI layout allocation is gated by tracker presence');
sourceCheck(uiSource, /\['Vigil sites',[\s\S]*?vigilSiteKindsMastered[\s\S]*?\['Tactical packs'[\s\S]*?\['Beacon packs'/,
    'game-over summary separates exploration, tactical packs, and beacon packs');
sourceCheck(uiSource, /Waylight \$\{receipt\.waylightWithinDeeds\} of Deeds/,
    'game-over receipt names Waylight as a non-additive Deeds slice');
sourceCheck(menuSource, /Waylight \$\{receipt\.waylightWithinDeeds\} included/,
    'Battle Pass menu receipt names Waylight as included inside Deeds');
check(!/Waylight \+\$\{/.test(uiSource) && !/Waylight \+\$\{/.test(menuSource),
    'no visible receipt double-presents Waylight as an additive XP bucket');

// Runtime scheduling integration: death ids are drained once, active-enemy
// count and wave cap are passed through, and beacon ownership is visible as an
// overlay gate. This catches source edits that still look plausible in review.
let directorContext = null;
const directorGame = {
    encounterDirector: { update(_dt, context) { directorContext = context; return { events: [], spawnRequests: [] }; } },
    _encounterDefeatedIds: ['pack:guardian'],
    time: 81,
    waveState: { maxAlive: 37 },
    enemies: [{ active: true }, { active: false }, { active: true }],
    bossWarning: null,
    lieutenantWarning: null,
    vigilSiteSystem: { hasActiveChallenge: () => true },
    _applyEncounterOutput(output) { this.applied = output; },
};
GameUpdateMethods._updateEncounterDirector.call(directorGame, 0.25, false, false);
check(directorContext.gameTime === 81 && directorContext.liveEnemyCount === 2,
    'runtime director context receives time and active-only enemy count');
check(directorContext.enemyCap === 37, 'runtime director context receives current wave cap');
check(directorContext.overlayActive === true, 'runtime beacon challenge owns the encounter overlay gate');
check(directorContext.defeatedMemberIds[0] === 'pack:guardian' && directorGame._encounterDefeatedIds.length === 0,
    'runtime defeated-member queue drains exactly once');

// Fixed-frame setpiece arbitration: a Beacon owns the stage ahead of bosses
// and Lieutenants; a tactical pack owns it ahead of Lieutenants; and a warning
// that expires this frame is visible to EncounterDirector immediately.
function directorFixture({ encounterPhase = 'idle', siteChallenge = false, warning = null, bossWarning = null, pendingDeaths = [] } = {}) {
    const calls = { bossUpdates: 0, bossWarnings: 0, bossSpawns: 0, lieutenantUpdates: 0, lieutenantWarnings: 0, spawns: 0 };
    const game = {
        time: 90,
        enemies: [],
        player: {},
        waveState: null,
        waveDirector: {
            update() {},
            getState() { return { index: 0, twilight: false, hyperMul: 1, endlessDamageSurcharge: 0, maxAlive: 40 }; },
            announce() {},
        },
        _applyRunScale(state) { return state; },
        _lastWaveIdx: 0,
        bossRush: null,
        bossWarning: bossWarning ? { ...bossWarning } : null,
        bossDirector: { update() { calls.bossUpdates++; return 'forest-guardian'; } },
        _startBossWarning() { calls.bossWarnings++; },
        _spawnBoss(type) {
            calls.bossSpawns++;
            this.enemies.push({ active: true, boss: true, type });
        },
        arena: null,
        lieutenantWarning: warning ? { ...warning } : null,
        lieutenantDirector: { update() { calls.lieutenantUpdates++; return true; } },
        _startLieutenantWarning() {
            calls.lieutenantWarnings++;
            this.lieutenantWarning = { type: 'brute', timer: 1, total: 1 };
        },
        _spawnLieutenant(type) {
            calls.spawns++;
            this.enemies.push({ active: true, lieutenant: true, type });
        },
        encounterDirector: { getSnapshot() { return { phase: encounterPhase }; } },
        _encounterDefeatedIds: [...pendingDeaths],
        vigilSiteSystem: { hasActiveChallenge() { return siteChallenge; } },
        bossSummons: [],
        _updateBossThresholds() {},
        _updateEncounterDirector(_dt, bossActive, lieutenantActive) {
            calls.encounterArgs = { bossActive, lieutenantActive };
        },
    };
    return { game, calls };
}

const beaconFrame = directorFixture({ siteChallenge: true });
GameUpdateMethods._updateDirectors.call(beaconFrame.game, 0.1);
check(beaconFrame.calls.bossUpdates === 0 && beaconFrame.calls.bossWarnings === 0,
    'live Beacon challenge holds a due normal boss without consuming its schedule');
check(beaconFrame.calls.lieutenantUpdates === 0 && beaconFrame.calls.lieutenantWarnings === 0,
    'live Beacon challenge also holds the Lieutenant scheduler');

const tacticalFrame = directorFixture({ encounterPhase: 'active' });
tacticalFrame.game.bossDirector.update = () => { tacticalFrame.calls.bossUpdates++; return null; };
GameUpdateMethods._updateDirectors.call(tacticalFrame.game, 0.1);
check(tacticalFrame.calls.lieutenantUpdates === 0 && tacticalFrame.calls.lieutenantWarnings === 0,
    'active tactical pack holds the Lieutenant scheduler');

const earnedBoundaryFrame = directorFixture({ encounterPhase: 'active', pendingDeaths: ['pack:last-guardian'] });
GameUpdateMethods._updateDirectors.call(earnedBoundaryFrame.game, 0.1);
check(earnedBoundaryFrame.calls.bossUpdates === 0 && earnedBoundaryFrame.calls.bossWarnings === 0
    && earnedBoundaryFrame.calls.encounterArgs,
    'queued guardian death reaches tactical lifecycle before a due boss can abort it');

const lieutenantSpawnFrame = directorFixture({ warning: { type: 'brute', timer: 0.01, total: 1 } });
lieutenantSpawnFrame.game.bossDirector.update = () => { lieutenantSpawnFrame.calls.bossUpdates++; return null; };
GameUpdateMethods._updateDirectors.call(lieutenantSpawnFrame.game, 0.02);
check(lieutenantSpawnFrame.calls.spawns === 1 && lieutenantSpawnFrame.calls.encounterArgs.lieutenantActive === true,
    'same-frame Lieutenant spawn owns the stage before EncounterDirector advances');

const bossSpawnFrame = directorFixture({ bossWarning: { id: 'forest-guardian', timer: 0.01, total: 1 } });
GameUpdateMethods._updateDirectors.call(bossSpawnFrame.game, 0.02);
check(bossSpawnFrame.calls.bossSpawns === 1 && bossSpawnFrame.calls.encounterArgs.bossActive === true,
    'same-frame boss spawn owns the stage before EncounterDirector advances');
check(bossSpawnFrame.calls.lieutenantUpdates === 0 && bossSpawnFrame.calls.lieutenantWarnings === 0,
    'same-frame boss spawn cannot emit a false Lieutenant warning');

// Placement methods must refuse all work once the live cap is reached. The
// fixture deliberately omits constructors/obstacle APIs beyond that point, so
// a regression that enters placement fails loudly instead of silently passing.
const cappedEnemies = Array.from({ length: 4 }, () => ({ active: true }));
const capFixture = {
    enemies: cappedEnemies,
    waveState: { maxAlive: 4 },
    player: { x: 0, y: 0 },
};
const tacticalAccepted = GameUpdateMethods._spawnEncounterPack.call(capFixture, {
    packId: 'cap-pack',
    enemyCapAtIssue: 99,
    anchor: {},
    units: [{ type: 'slime', memberId: 'cap-pack:0', offset: { x: 0, y: 0 } }],
});
check(tacticalAccepted.length === 0 && capFixture.enemies.length === 4,
    'runtime tactical placement cannot exceed the current wave cap');
const beaconAccepted = GameUpdateMethods._spawnVigilGuardians.call(capFixture, {
    siteId: 'beacon-cap',
    maxAlive: 3,
    spawns: [{ type: 'slime', x: 0, y: 0 }],
});
check(beaconAccepted.length === 0 && capFixture.enemies.length === 4,
    'runtime beacon placement cannot exceed the current wave cap');
for (const freeSlots of [0, 1, 2]) {
    const pressureFixture = {
        enemies: Array.from({ length: 4 - freeSlots }, () => ({ active: true })),
        waveState: { maxAlive: 4 },
    };
    const beforePressure = pressureFixture.enemies.length;
    const accepted = GameUpdateMethods._spawnVigilGuardians.call(pressureFixture, {
        maxAlive: 3,
        spawns: Array.from({ length: 3 }, (_, i) => ({ type: 'slime', x: i * 10, y: 0 })),
    });
    check(accepted.length === 0 && pressureFixture.enemies.length === beforePressure,
        `${freeSlots} free slot(s) cannot create a partial full-paying Beacon pack`);
}

// A rejected Beacon spawn must not light the tracker or count an activation.
// Its immediate failure status is still ingested so stale prompts are cleared.
const rejectedBeaconEvents = [];
let rejectedBeaconActivations = 0;
const rejectedBeaconFixture = {
    vigilTracker: { ingest(event) { rejectedBeaconEvents.push(event.kind); } },
    _spawnVigilGuardians() { return []; },
    _recordVigilSiteActivation() { rejectedBeaconActivations++; },
    waveDirector: { announce() {} },
    vigilSiteSystem: {
        drained: false,
        acknowledgeGuardianSpawn() { return false; },
        drainEvents() {
            if (this.drained) return [];
            this.drained = true;
            return [{ kind: 'status', siteId: 'beacon:rejected', archetype: 'beacon', status: 'deferred', reason: 'spawn-deferred' }];
        },
    },
    _handleVigilSiteEvent: GameUpdateMethods._handleVigilSiteEvent,
};
GameUpdateMethods._handleVigilSiteEvent.call(rejectedBeaconFixture, {
    kind: 'spawn', siteId: 'beacon:rejected', archetype: 'beacon', spawns: [],
});
check(rejectedBeaconEvents.join(',') === 'status',
    'rejected Beacon ingests only its failure status, never a false activation');
check(rejectedBeaconActivations === 0,
    'rejected Beacon cannot advance authoritative run progress');

const acceptedBeaconEvents = [];
let acceptedBeaconActivations = 0;
const acceptedBeaconFixture = {
    vigilTracker: { ingest(event) { acceptedBeaconEvents.push(event.kind); } },
    _spawnVigilGuardians() { return [{ active: true }]; },
    _recordVigilSiteActivation() { acceptedBeaconActivations++; },
    waveDirector: { announce() {} },
    audio: { lieutenantWarn() {} },
    vigilSiteSystem: { acknowledgeGuardianSpawn() { return true; }, drainEvents() { return []; } },
};
GameUpdateMethods._handleVigilSiteEvent.call(acceptedBeaconFixture, {
    kind: 'spawn', siteId: 'beacon:accepted', archetype: 'beacon', spawns: [{}],
});
check(acceptedBeaconEvents.join(',') === 'spawn' && acceptedBeaconActivations === 1,
    'accepted Beacon lights tracker and progress exactly once after acknowledgement');

// Earned XP is immediate, finite, and level-up aware.
const xpReceived = [];
const xpFixture = {
    player: { x: 10, y: 20, gainXP(amount) { xpReceived.push(amount); return amount === 24 ? 2 : 0; } },
    pendingLevelUps: 1,
    feedback: [],
    _pushFeedback(kind, duration) { this.feedback.push([kind, duration]); },
    audio: { levelUps: 0, levelUp() { this.levelUps++; } },
    _hitStopCalls: [],
    _hitStop(value) { this._hitStopCalls.push(value); },
    particles: { bursts: 0, levelUpBurst() { this.bursts++; } },
    rings: [],
    _spawnRing(x, y, options) { this.rings.push({ x, y, options }); },
};
check(GameUpdateMethods._grantVigilXp.call(xpFixture, 24, 30, 40) === 24,
    'runtime earned-XP helper returns the granted amount');
check(xpReceived[0] === 24 && xpFixture.pendingLevelUps === 3,
    'runtime earned XP reaches Player.gainXP and preserves all queued levels');
check(xpFixture.audio.levelUps === 1 && xpFixture.particles.bursts === 1 && xpFixture.rings.length === 1,
    'runtime level threshold emits one coherent level-up feedback beat');
const callsBeforeInvalidXp = xpReceived.length;
check(GameUpdateMethods._grantVigilXp.call(xpFixture, Infinity) === 0
    && GameUpdateMethods._grantVigilXp.call(xpFixture, -9) === 0
    && xpReceived.length === callsBeforeInvalidXp,
    'non-finite and negative integration XP cannot reach Player.gainXP');

// Site activation and reward application are idempotent/safe at the Game seam.
const trackerProgress = [];
const activationFixture = {
    _activatedVigilSiteIds: new Set(),
    _vigilKindsActivated: new Set(),
    vigilSitesActivated: 0,
    encountersCleared: 0,
    vigilTracker: { setProgress(value) { trackerProgress.push(value); } },
};
const siteActivation = { siteId: 'site:archive', archetype: 'archive' };
check(GameUpdateMethods._recordVigilSiteActivation.call(activationFixture, siteActivation) === true,
    'first site activation is accepted');
check(GameUpdateMethods._recordVigilSiteActivation.call(activationFixture, siteActivation) === false,
    'replayed site activation is rejected');
check(activationFixture.vigilSitesActivated === 1 && activationFixture._vigilKindsActivated.size === 1,
    'replayed site event cannot inflate run progress');
check(trackerProgress.length === 1, 'tracker progress updates once for one unique site');

const encounterRewardFixture = {
    encountersCleared: 0,
    guardianPacksDefeated: 4,
    _vigilKindsActivated: new Set(),
    _encounterRewardPos: { x: 33, y: 44 },
    player: { x: 1, y: 2 },
    vigilTracker: { ingest() {}, setProgress() {} },
    xpGrants: [],
    _grantVigilXp(value, x, y) { this.xpGrants.push({ value, x, y }); },
    coinBursts: [],
    _dropCoinBurst(...args) { this.coinBursts.push(args); },
    _spawnRing() {},
    particles: { pickupSparkle() {} },
    audio: { objective() {} },
    waveDirector: { announce() {} },
};
GameUpdateMethods._handleEncounterEvent.call(encounterRewardFixture, {
    type: 'encounter-cleared', packId: 'pack:clear', title: 'Cinder Wedge', color: '#ffd166',
});
check(encounterRewardFixture.encountersCleared === 1 && encounterRewardFixture.guardianPacksDefeated === 4,
    'runtime tactical clear advances encounters without inflating beacon packs');
check(encounterRewardFixture.xpGrants[0].value === 24
    && encounterRewardFixture.xpGrants[0].x === 33
    && encounterRewardFixture.coinBursts[0][2] === 5
    && encounterRewardFixture.coinBursts[0][3] === 3,
    'runtime tactical clear pays the exact immediate XP and bounded coin burst');
check(encounterRewardFixture._encounterRewardPos === null,
    'runtime tactical clear retires its cached reward position');

const rewardFixture = {
    player: { x: 5, y: 6, radius: 20, hp: 45, maxHp: 100, coins: 7 },
    pendingLevelUps: 0,
    damageNumbers: [],
    _activatedVigilSiteIds: new Set(),
    _vigilKindsActivated: new Set(),
    vigilSitesActivated: 0,
    encountersCleared: 0,
    guardianPacksDefeated: 0,
    vigilTracker: { ingest() {}, setProgress() {} },
    _recordVigilSiteActivation: GameUpdateMethods._recordVigilSiteActivation,
    _grantVigilXp(value, x, y) { this.xpGrant = { value, x, y }; return value; },
    _pushFeedback() {},
    particles: { pickupSparkle() {} },
    rings: [],
    _spawnRing(x, y, options) { this.rings.push({ x, y, options }); },
    audio: { shrineChime() {} },
    waveDirector: { announcements: [], announce(...args) { this.announcements.push(args); } },
};
GameUpdateMethods._handleVigilSiteEvent.call(rewardFixture, {
    kind: 'reward', siteId: 'site:xp', archetype: 'archive', label: 'Ashen Archive',
    x: 70, y: 80, reward: { type: 'xp', amount: 18 }, color: '#7fd0ff',
});
check(rewardFixture.xpGrant.value === 18 && rewardFixture.xpGrant.x === 70 && rewardFixture.xpGrant.y === 80,
    'runtime archive reward routes exact authored XP through the earned path');
GameUpdateMethods._handleVigilSiteEvent.call(rewardFixture, {
    kind: 'reward', siteId: 'site:bundle', archetype: 'beacon', label: 'Gloam Beacon',
    x: 90, y: 100, reward: { type: 'bundle', coins: 9, xp: 21 }, color: '#ff6a78',
});
check(rewardFixture.player.coins === 16 && rewardFixture.xpGrant.value === 21,
    'runtime beacon bundle grants its coins and XP exactly once');
check(rewardFixture.encountersCleared === 0 && rewardFixture.guardianPacksDefeated === 1,
    'runtime beacon clear advances guardian packs without inflating tactical clears');
check(rewardFixture.vigilSitesActivated === 2,
    'two distinct runtime reward sites bank as two activations');

const passBase = runXpBreakdown({ time: 30, kills: 0, finalWave: 1 });
const passTactical = runXpBreakdown({ time: 30, kills: 0, finalWave: 1, encountersCleared: 1 });
const passGuardian = runXpBreakdown({ time: 30, kills: 0, finalWave: 1, guardianPacksDefeated: 1 });
const passBoth = runXpBreakdown({
    time: 30, kills: 0, finalWave: 1, encountersCleared: 1, guardianPacksDefeated: 1,
});
check(passTactical.livingVigil - passBase.livingVigil === RUN_XP_RULES.tacticalEncounter,
    'runtime battle-pass breakdown awards one tactical clear exactly once');
check(passGuardian.livingVigil - passBase.livingVigil === RUN_XP_RULES.guardianPack,
    'runtime battle-pass breakdown awards one guardian clear exactly once');
check(passBoth.livingVigil === RUN_XP_RULES.tacticalEncounter + RUN_XP_RULES.guardianPack,
    'runtime battle-pass breakdown combines distinct clear types without overlap');

// UI allocation is exercised rather than only source-matched: tracker presence
// gets a bounded rect; absence gets no phantom slot.
const ui = new UISystem({
    renderer: { cssWidth: 1920, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } },
    loop: {},
});
const layoutState = {
    touchMode: false,
    activeBoss: null,
    activeLieutenant: null,
    bossRush: null,
    vigilTracker: { activatedSites: 0 },
    ownedWeapons: [],
    ownedPassives: [],
    runRelics: [],
    abilityCooldowns: [],
};
const vigilLayout = ui.getHUDLayout(layoutState);
check(vigilLayout.vigil && vigilLayout.vigil.w > 0 && vigilLayout.vigil.h > 0,
    'runtime desktop HUD allocates a non-empty tracker rectangle');
check(vigilLayout.vigil.x >= 0 && vigilLayout.vigil.y >= 0
    && vigilLayout.vigil.x + vigilLayout.vigil.w <= 1920
    && vigilLayout.vigil.y + vigilLayout.vigil.h <= 1080,
    'runtime tracker allocation stays inside the logical canvas');
const scaledVigilLayout = ui.getHUDLayout({
    ...layoutState,
    saveData: { settings: { uiScale: 130, highContrast: true } },
});
check(scaledVigilLayout.vigil.uiScale === 1.3
    && Math.abs(scaledVigilLayout.vigil.w - vigilLayout.vigil.w * 1.3) < 0.001
    && Math.abs(scaledVigilLayout.vigil.h - vigilLayout.vigil.h * 1.3) < 0.001,
    'runtime Living Vigil allocation scales its complete geometry to 130%');
check(Math.abs((scaledVigilLayout.vigil.x + scaledVigilLayout.vigil.w)
    - (vigilLayout.vigil.x + vigilLayout.vigil.w)) < 0.001,
    'scaled Living Vigil retains its safe right-edge anchor');
const gatedLayout = ui.getHUDLayout({ ...layoutState, vigilTracker: null }).vigil;
check(gatedLayout.w === 0 && gatedLayout.h === 0,
    'runtime HUD collapses the tracker slot when Living Vigil is gated off');

// Save behavior is additive for legacy data, banks lifetime totals, clamps the
// four-kind best, and refuses negative summary values.
const memoryStorage = new Map();
Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
        getItem(key) { return memoryStorage.has(key) ? memoryStorage.get(key) : null; },
        setItem(key, value) { memoryStorage.set(key, String(value)); },
        removeItem(key) { memoryStorage.delete(key); },
    },
});
const save = new SaveSystem();
save.save = () => true;
for (const field of ['vigilSitesActivated', 'vigilSiteKindsMastered', 'encountersCleared', 'guardianPacksDefeated']) {
    check(save.data.stats[field] === 0, `new save initializes ${field} additively`);
}
const migrated = save._validate({ version: 1, stats: { runs: 7, bestTime: 90 } });
check(migrated.stats.runs === 7 && migrated.stats.vigilSitesActivated === 0
    && migrated.stats.encountersCleared === 0,
    'legacy save normalization preserves old stats and supplies Living Vigil defaults');
save.recordRun({ vigilSitesActivated: 3, vigilSiteKindsMastered: 3, encountersCleared: 2, guardianPacksDefeated: 1 });
save.recordRun({ vigilSitesActivated: 2, vigilSiteKindsMastered: 99, encountersCleared: 4, guardianPacksDefeated: 2 });
check(save.data.stats.vigilSitesActivated === 5 && save.data.stats.encountersCleared === 6,
    'runtime save banks cumulative site and encounter progress');
check(save.data.stats.vigilSiteKindsMastered === 4 && save.data.stats.guardianPacksDefeated === 3,
    'runtime save clamps four-kind mastery while accumulating guardian packs');
save.recordRun({ vigilSitesActivated: -20, vigilSiteKindsMastered: -20, encountersCleared: -20, guardianPacksDefeated: -20 });
check(save.data.stats.vigilSitesActivated === 5 && save.data.stats.encountersCleared === 6
    && save.data.stats.guardianPacksDefeated === 3,
    'negative run-summary progress cannot reduce or inflate lifetime totals');
sourceCheck(saveSource, /Math\.min\(4,[\s\S]*?vigilSiteKindsMastered/,
    'save source retains the explicit four-kind mastery cap');

console.log(`Living Vigil integration validation: OK - ${checks} cross-module construction, runtime, reward, cap, UI, and save checks.`);
