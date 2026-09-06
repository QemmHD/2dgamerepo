// Migration PR1 evidence only. This module has no production imports, writes,
// global overrides, or gameplay mutations. A receipt is a detached projection
// of one real Game, never a serialization of the Game/entity/save graphs.

export const SEMANTIC_RECEIPT_VERSION = 1;
export const SEMANTIC_FLOAT_TOLERANCE = 1e-9;
export const ENEMY_SAMPLE_LIMIT = 16;

// Only positions, accumulated game time and cooldowns receive this absolute
// tolerance. HP (including fractional HP), XP, coins, damage, meter fill, IDs,
// phases, build levels, progression, counts, ticks and clock.seconds are exact.
const TOLERANT_PATHS = [
    /^\$\.player\.(x|y|blinkCooldown)$/,
    /^\$\.run\.time$/,
    /^\$\.boss\.(x|y|recoveryRemaining)$/,
    /^\$\.enemySamples\[\d+\]\.(x|y)$/,
    /^\$\.arena\.(x|y)$/,
    // Adapter observations may contain action-time position/cooldown samples.
    // Do not apply a blanket numerical tolerance to an arbitrary observation.
    /^\$\.observations(?:\.[^.[\]]+|\[\d+\])*\.(x|y|gameTime|gameTimeBefore|gameTimeAfter|blinkCooldown|cooldown)$/,
];

function childPath(path, key, array) {
    return array ? `${path}[${key}]` : `${path}.${key}`;
}

/** Reject lossy JSON values, accessors, class instances and cyclic graphs. */
export function assertSerializableReceipt(receipt) {
    const ancestors = new Set();
    function visit(value, path) {
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) throw new TypeError(`${path}: non-finite number`);
            return;
        }
        if (typeof value !== 'object') {
            throw new TypeError(`${path}: ${typeof value} is not a JSON value`);
        }
        const array = Array.isArray(value);
        const prototype = Object.getPrototypeOf(value);
        if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(`${path}: non-plain prototype`);
        }
        if (ancestors.has(value)) throw new TypeError(`${path}: cyclic reference`);
        if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`${path}: symbol key`);
        ancestors.add(value);
        const keys = Object.getOwnPropertyNames(value);
        if (array) {
            if (keys.length !== value.length + 1) throw new TypeError(`${path}: sparse or extended array`);
            for (let index = 0; index < value.length; index++) {
                if (!Object.hasOwn(value, index)) throw new TypeError(`${path}[${index}]: sparse array`);
            }
        }
        for (const key of keys) {
            if (array && key === 'length') continue;
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            const nestedPath = childPath(path, key, array);
            if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`${nestedPath}: accessor`);
            if (!descriptor.enumerable) throw new TypeError(`${nestedPath}: non-enumerable property`);
            visit(descriptor.value, nestedPath);
        }
        ancestors.delete(value);
    }
    visit(receipt, '$');
    return true;
}

function detached(value) {
    assertSerializableReceipt(value);
    return JSON.parse(JSON.stringify(value));
}

function number(value, path) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${path}: expected finite number`);
    }
    return value;
}

function integer(value, path) {
    number(value, path);
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${path}: expected nonnegative safe integer`);
    return value;
}

function text(value, path) {
    if (typeof value !== 'string' || !value) throw new TypeError(`${path}: expected nonempty string`);
    return value;
}

function nullableText(value, path) {
    return value === null ? null : text(value, path);
}

function ids(values, path) {
    if (!Array.isArray(values)) throw new TypeError(`${path}: expected ID array`);
    return values.map((value, index) => text(value, `${path}[${index}]`));
}

function activeCount(items, path) {
    if (!Array.isArray(items)) throw new TypeError(`${path}: expected entity array`);
    return items.reduce((count, item) => count + (item?.active === true ? 1 : 0), 0);
}

function buildEntries(items, path) {
    if (!Array.isArray(items)) throw new TypeError(`${path}: expected owned array`);
    // Preserve slot ordering: primary weapon identity and fusion slots matter.
    return items.map((item, index) => ({
        id: text(item.id, `${path}[${index}].id`),
        level: integer(item.level, `${path}[${index}].level`),
    }));
}

function numericProjection(source, fields, path) {
    return Object.fromEntries(fields.map((key) => [key, number(source?.[key], `${path}.${key}`)]));
}

// A short failed run still executes real settlement. Capture that outcome even
// when its accepted coin/Battle Pass reward is zero. The latches below mean the
// finish path ran, NOT that every underlying write necessarily succeeded.
function terminalProgression(game) {
    if (game.gameOver !== true && game._runRecorded !== true) return null;
    const save = game.saveSystem;
    const data = save?.data;
    if (!data) throw new TypeError('A terminal Game requires SaveSystem state');
    const summary = game.runSummary;
    const pass = game.bpResult;
    const objective = game._objRewardSettlement;
    return {
        source: 'real-game-terminal-settlement',
        latches: {
            runRecorded: game._runRecorded === true,
            coinsBanked: game.bankedThisRun === true,
            objectivesSettled: game._objRewardsSettled === true,
            battlePassAwarded: game._battlePassAwarded === true,
            ritesAccrued: game._riteAccrued === true,
        },
        authority: {
            storageAvailable: save.available === true,
            participationRequired: save._saveParticipationRequired === true,
            participationState: text(save._saveParticipationState, 'save.participationState'),
            lastSaveFailureReason: nullableText(save.getLastSaveFailureReason(), 'save.lastSaveFailureReason'),
        },
        runSummary: summary ? {
            ...numericProjection(summary, [
                'time', 'level', 'kills', 'bossesDefeated', 'coinsEarned',
                'objectiveCoins', 'totalCoins', 'finalWave', 'chestsOpened',
                'runPathCompleted', 'objectivesCompleted', 'vigilSitesActivated',
                'vigilSiteKindsMastered', 'encountersCleared', 'guardianPacksDefeated',
            ], 'runSummary'),
            cleared: summary.cleared === true,
            objectiveReceipts: detached(summary.objectiveReceipts),
            ritesCompleted: detached(summary.ritesCompleted ?? []),
            achievements: detached(summary.achievements ?? []),
            dailies: detached(summary.dailies ?? []),
            // The current victory-leave summary omits these two fields;
            // preserve that absence instead of fabricating a historical build.
            weapons: summary.weapons === undefined ? null : buildEntries(summary.weapons, 'runSummary.weapons'),
            passives: summary.passives === undefined ? null : buildEntries(summary.passives, 'runSummary.passives'),
        } : null,
        battlePass: pass ? {
            ...numericProjection(pass, [
                'gained', 'attempted', 'levelBefore', 'levelAfter',
                'everflameCaches', 'everflameCoins',
            ], 'bpResult'),
            persisted: pass.persisted === true,
            leveledUp: pass.leveledUp === true,
            crossedLevels: detached(pass.crossedLevels),
            breakdown: {
                eligible: pass.breakdown?.eligible === true,
                ...numericProjection(pass.breakdown, [
                    'kindling', 'endurance', 'hunt', 'deeds', 'livingVigil',
                    'trials', 'core', 'bonusRate', 'threat', 'total',
                ], 'bpResult.breakdown'),
            },
        } : null,
        objectiveSettlement: objective ? {
            credited: number(objective.credited, 'objectiveSettlement.credited'),
            receiptCount: integer(objective.receiptCount, 'objectiveSettlement.receiptCount'),
            accepted: objective.accepted.map((entry) => ({
                receiptId: text(entry.receiptId, 'objectiveSettlement.receiptId'),
                requested: number(entry.requested, 'objectiveSettlement.requested'),
                credited: number(entry.credited, 'objectiveSettlement.accepted.credited'),
            })),
            duplicates: detached(objective.duplicates),
            failureReason: nullableText(objective.failureReason ?? null, 'objectiveSettlement.failureReason'),
        } : null,
        // Read accepted in-memory SaveSystem state, not getters that can lazily
        // normalize/mutate it. No filesystem/browser-storage read is introduced.
        // summary.totalCoins is captured BEFORE achievement/daily rewards;
        // bankCoins below is the later final balance and need not equal it.
        saved: {
            bankCoins: number(data.totalCoins, 'save.totalCoins'),
            battlePassXp: number(data.battlePass?.xp, 'save.battlePass.xp'),
            stats: numericProjection(data.stats, [
                'runs', 'totalKills', 'totalBosses', 'totalCoinsEarned', 'playtimeSec',
                'bestTime', 'bestWave', 'bestLevel', 'bestKills', 'bestBosses',
                'ultsReleased', 'blinks', 'comboProcs', 'vigilSitesActivated',
                'vigilSiteKindsMastered', 'encountersCleared', 'guardianPacksDefeated',
            ], 'save.stats'),
            streak: numericProjection(data.streak, ['day', 'count'], 'save.streak'),
            heroRites: Object.entries(data.rites?.[game._heroId] ?? {}).map(([id, progress]) => ({
                id, progress: number(progress, `save.rites.${game._heroId}.${id}`),
            })),
            claimedAchievements: ids(data.achievements?.claimed, 'save.achievements.claimed'),
            daily: {
                day: integer(data.daily?.day, 'save.daily.day'),
                completed: ids(data.daily?.completed, 'save.daily.completed'),
            },
            guidedObjectives: {
                activeRunSerial: integer(data.guidedObjectives?.activeRunSerial, 'save.guidedObjectives.activeRunSerial'),
                receiptCount: integer(data.guidedObjectives?.receipts?.length, 'save.guidedObjectives.receipts.length'),
            },
        },
    };
}

/**
 * clock = { ticks, seconds }; seconds must be ticks / 60, not game.time.
 * scenario = an ID string or an object with an ID. environment, errors and
 * observations must already be plain JSON values. Progression records an
 * actually reached Game terminal first; otherwise it stays null unless the
 * adapter supplies observations.progression from another exercised authority.
 * Never infer an award from a boss warning, disappearance, UI label or balance.
 */
export function buildSemanticReceipt({ game, scenario, seed, clock, environment = {}, errors = [], observations = {} }) {
    if (!game?.player || !game.kindleSystem) throw new TypeError('A started real Game is required');
    const ticks = integer(clock?.ticks, 'clock.ticks');
    const seconds = number(clock?.seconds, 'clock.seconds');
    if (seconds !== ticks / 60) throw new TypeError('clock.seconds must equal clock.ticks / 60');
    const scenarioId = text(typeof scenario === 'string' ? scenario : scenario?.id, 'scenario');
    if (typeof seed !== 'string' && typeof seed !== 'number') throw new TypeError('seed must be a string or number');
    if (typeof seed === 'number') number(seed, 'seed');
    if (!Array.isArray(errors)) throw new TypeError('errors must be an array');
    if (!observations || Array.isArray(observations) || typeof observations !== 'object') {
        throw new TypeError('observations must be a plain object');
    }
    const meta = detached(environment);
    const observed = detached(observations);
    const p = game.player;
    const k = game.kindleSystem;
    const enemies = game.enemies;
    if (!Array.isArray(enemies)) throw new TypeError('game.enemies must be an array');
    const alive = enemies.filter((enemy) => enemy.active === true);
    // Mirror the production HUD's strongest-active-boss selection, but sample
    // the real array so a receipt at the warning -> spawn boundary isn't stale.
    const boss = alive.reduce((best, enemy) => enemy.boss && (!best || enemy.maxHp > best.maxHp) ? enemy : best, null);
    const warning = game.bossWarning;
    const receipt = {
        version: SEMANTIC_RECEIPT_VERSION,
        runtime: text(meta.runtime ?? 'canvas', 'environment.runtime'),
        scenario: scenarioId,
        seed,
        simulationTicks: ticks,
        simulationSeconds: seconds,
        environment: meta,
        player: {
            hero: text(game._heroId, 'game._heroId'),
            x: number(p.x, 'player.x'),
            y: number(p.y, 'player.y'),
            hp: number(p.hp, 'player.hp'),
            maxHp: number(p.maxHp, 'player.maxHp'),
            level: integer(p.level, 'player.level'),
            xp: number(p.xp, 'player.xp'),
            xpNext: number(p.xpToNext, 'player.xpToNext'),
            coins: number(p.coins, 'player.coins'),
            kindle: number(k.fill, 'kindle.fill'),
            blinkCooldown: number(k.blinkCooldown, 'kindle.blinkCooldown'),
        },
        kindle: {
            max: number(k.max, 'kindle.max'),
            cost: number(k.ultCost, 'kindle.ultCost'),
            ready: k.ready === true,
            aiming: k.aiming !== null,
            aimKind: nullableText(k.aiming?.kind ?? null, 'kindle.aiming.kind'),
        },
        run: {
            time: number(game.time, 'game.time'),
            map: text(game._effectiveMapId(), 'game._effectiveMapId()'),
            difficulty: text(game.difficulty, 'game.difficulty'),
            wave: integer(game.waveState?.index, 'game.waveState.index'),
            bosses: integer(game.bossesDefeated, 'game.bossesDefeated'),
            kills: integer(game.kills, 'game.kills'),
            blinks: integer(game.blinks, 'game.blinks'),
            kindleReleases: integer(game.ultsReleased, 'game.ultsReleased'),
            screen: text(game.screen, 'game.screen'),
            paused: game.paused === true,
            gameOver: game.gameOver === true,
        },
        counts: {
            enemies: alive.length,
            bosses: alive.filter((enemy) => enemy.boss === true).length,
            projectiles: activeCount(game.projectiles, 'game.projectiles'),
            enemyProjectiles: activeCount(game.enemyProjectiles, 'game.enemyProjectiles'),
            hazards: activeCount(game.hazards, 'game.hazards'),
            gems: activeCount(game.gems, 'game.gems'),
            coins: activeCount(game.coins, 'game.coins'),
            healthOrbs: activeCount(game.healthOrbs, 'game.healthOrbs'),
            chests: activeCount(game.chests, 'game.chests'),
            shrines: activeCount(game.shrines, 'game.shrines'),
        },
        build: {
            weapons: buildEntries(game.weaponSystem?.owned, 'weaponSystem.owned'),
            passives: buildEntries(game.passiveSystem?.owned, 'passiveSystem.owned'),
            // Applied IDs include stat picks and keystones. Values are exact;
            // don't mistake this count map for a list of cosmetic UI cards.
            appliedCounts: detached(game.upgradeSystem?.appliedCounts ?? {}),
            relics: ids(game._runRelics ?? [], 'game._runRelics'),
            pacts: ids(game._runPacts ?? [], 'game._runPacts'),
            patrons: ids(game.committedPatrons ?? [], 'game.committedPatrons'),
            road: nullableText(game._segmentRoadId ?? null, 'game._segmentRoadId'),
        },
        boss: boss ? {
            id: text(boss.type, 'boss.type'),
            alive: true,
            x: number(boss.x, 'boss.x'),
            y: number(boss.y, 'boss.y'),
            hp: number(boss.hp, 'boss.hp'),
            maxHp: number(boss.maxHp, 'boss.maxHp'),
            phase: integer(boss.phase, 'boss.phase'),
            phase2Entered: boss.phase2Entered === true,
            phase2Pending: boss.phase2Pending === true,
            provenance: nullableText(boss.bossSpawnProvenance ?? null, 'boss.bossSpawnProvenance'),
            activeAttack: nullableText(boss.activeAttack?.id ?? null, 'boss.activeAttack.id'),
            lastAttack: nullableText(boss.bossLastAttackId ?? null, 'boss.bossLastAttackId'),
            windupRemaining: number(boss.bossWindupTimer, 'boss.bossWindupTimer'),
            recoveryRemaining: number(boss.bossRecoveryTimer, 'boss.bossRecoveryTimer'),
            phaseBreakRemaining: number(boss.bossPhaseBreakTimer, 'boss.bossPhaseBreakTimer'),
        } : null,
        bossWarning: warning ? {
            id: text(warning.id, 'bossWarning.id'),
            provenance: nullableText(warning.provenance ?? null, 'bossWarning.provenance'),
            remaining: number(warning.timer, 'bossWarning.timer'),
            total: number(warning.total, 'bossWarning.total'),
        } : null,
        arena: game.arena ? {
            x: number(game.arena.x, 'arena.x'),
            y: number(game.arena.y, 'arena.y'),
            radius: number(game.arena.r, 'arena.r'),
        } : null,
        overlays: {
            upgradeChoices: game.upgradeChoices?.map((choice) => text(choice.id, 'upgradeChoice.id')) ?? null,
            pendingLevelUps: integer(game.pendingLevelUps, 'game.pendingLevelUps'),
            chest: !!game.chestReward,
            altar: !!game.altar,
            victory: !!game.victory,
            photo: !!game.photoMode,
        },
        // Bounded insertion-order samples prove seed-dependent spawn/AI state
        // without retaining Enemy objects, their Sets, art or callbacks.
        enemySamples: alive.slice(0, ENEMY_SAMPLE_LIMIT).map((enemy) => ({
            type: text(enemy.type, 'enemy.type'),
            x: number(enemy.x, 'enemy.x'),
            y: number(enemy.y, 'enemy.y'),
            hp: number(enemy.hp, 'enemy.hp'),
            elite: enemy.elite === true,
            boss: enemy.boss === true,
        })),
        progression: terminalProgression(game)
            ?? (Object.hasOwn(observed, 'progression') ? detached(observed.progression) : null),
        observations: observed,
        errors: detached(errors),
        exceptionCount: errors.filter((error) => typeof error !== 'string' || !error.startsWith('promise: ')).length,
        unhandledRejectionCount: errors.filter((error) => typeof error === 'string' && error.startsWith('promise: ')).length,
    };
    // A final defensive detach also protects future projected fields from
    // accidentally retaining a mutable plain object passed by a malformed Game.
    return detached(receipt);
}

/** Field-level diffs; object key order is irrelevant, array/slot order is not. */
export function compareReceipts(expected, actual) {
    assertSerializableReceipt(expected);
    assertSerializableReceipt(actual);
    const differences = [];
    function compare(left, right, path) {
        if (left === right) return;
        if (typeof left === 'number' && typeof right === 'number') {
            const tolerance = TOLERANT_PATHS.some((pattern) => pattern.test(path)) ? SEMANTIC_FLOAT_TOLERANCE : null;
            if (tolerance !== null && Math.abs(left - right) <= tolerance) return;
            differences.push({ path, expected: left, actual: right, ...(tolerance === null ? {} : { tolerance }) });
            return;
        }
        if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object'
            || Array.isArray(left) !== Array.isArray(right)) {
            differences.push({ path, expected: detached(left), actual: detached(right) });
            return;
        }
        const array = Array.isArray(left);
        const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
        for (const key of keys) {
            const nestedPath = childPath(path, key, array);
            if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) {
                differences.push({
                    path: nestedPath,
                    expected: Object.hasOwn(left, key) ? detached(left[key]) : '<missing>',
                    actual: Object.hasOwn(right, key) ? detached(right[key]) : '<missing>',
                });
            } else compare(left[key], right[key], nestedPath);
        }
    }
    compare(expected, actual, '$');
    return differences;
}
