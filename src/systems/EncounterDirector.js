// Deterministic scheduler for curated tactical enemy packs.
//
// The director never creates Enemy instances. update() returns two data lanes:
//   events        — warning / clear messages for the Game or HUD to present;
//   spawnRequests — bounded pack descriptions for Game to place through its
//                   canonical obstacle-safe Enemy construction path.
//
// Spawn acknowledgement is also data-driven. After applying a request, pass
// `{ spawnResults: [{ packId, acceptedMemberIds }] }` to a later update. Pass
// defeated encounter member ids through `defeatedMemberIds`; the director emits
// one `encounter-cleared` event after every accepted guardian is gone. Member
// ids are stable and included on every requested unit so Game can tag enemies.

import { WAVE_LIMITS } from '../config/GameConfig.js';
import {
    ENCOUNTER_LIMITS,
    ENCOUNTERS_BY_BIOME,
    encounterUnitCount,
    encountersForBiome,
} from '../content/encounters.js';

const TAU = Math.PI * 2;
const UINT_RANGE = 4294967296;

function hashText(value) {
    const text = String(value ?? '0');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function mix32(value) {
    let x = value >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
}

function sample01(seed, serial, channel = 0) {
    const word = mix32(seed ^ Math.imul(serial + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b));
    return word / UINT_RANGE;
}

function finiteNonNegative(value, fallback = 0) {
    return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function integerNonNegative(value, fallback = 0) {
    return Math.floor(finiteNonNegative(value, fallback));
}

function toIdSet(value) {
    if (value == null || typeof value[Symbol.iterator] !== 'function') return null;
    const ids = new Set();
    for (const id of value) if (typeof id === 'string' && id) ids.add(id);
    return ids;
}

function roundOffset(value) {
    return Math.round(value * 10) / 10;
}

// Local-space formation slots. Local -Y is the pack's forward direction; the
// request's `rotation` turns that direction toward the player-ring anchor.
function formationOffset(kind, index, total, spacing, seed) {
    switch (kind) {
        case 'line': {
            // Center-out ordering keeps guardian groups in the readable middle
            // of the wall even though expansion deliberately places guardians
            // first so cap truncation can never discard them.
            let slot = 0;
            if (total % 2 === 0) {
                const rank = Math.floor(index / 2) + 0.5;
                slot = index % 2 === 0 ? -rank : rank;
            } else if (index > 0) {
                const rank = Math.ceil(index / 2);
                slot = index % 2 === 1 ? -rank : rank;
            }
            return { x: slot * spacing, y: 0 };
        }
        case 'wedge': {
            if (index === 0) return { x: 0, y: 0 };
            const row = Math.ceil(index / 2);
            const side = index % 2 === 1 ? -1 : 1;
            return { x: side * row * spacing * 0.72, y: row * spacing * 0.78 };
        }
        case 'ring': {
            if (index === 0) return { x: 0, y: 0 };
            const ringCount = Math.max(1, total - 1);
            const angle = (index - 1) / ringCount * TAU;
            const radius = spacing * Math.max(1, ringCount / 5);
            return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
        }
        case 'flock': {
            if (index === 0) return { x: 0, y: 0 };
            const xNoise = sample01(seed, index, 2) - 0.5;
            const yNoise = sample01(seed, index, 3) - 0.5;
            const side = index % 2 === 1 ? -1 : 1;
            const rank = Math.ceil(index / 2);
            return {
                x: side * rank * spacing * 0.62 + xNoise * spacing * 0.45,
                y: rank * spacing * 0.48 + yNoise * spacing * 0.55,
            };
        }
        case 'choir': {
            if (index === 0) return { x: 0, y: spacing * 0.75 };
            const row = Math.floor((index - 1) / 3);
            const col = (index - 1) % 3 - 1;
            return { x: col * spacing, y: -row * spacing * 0.9 };
        }
        case 'column': {
            const side = index % 2 === 0 ? -0.28 : 0.28;
            return { x: side * spacing, y: index * spacing * 0.72 };
        }
        case 'pincer': {
            if (index === 0) return { x: 0, y: spacing * 0.65 };
            const side = index % 2 === 1 ? -1 : 1;
            const rank = Math.ceil(index / 2);
            return { x: side * spacing * (0.85 + rank * 0.35), y: rank * spacing * 0.45 };
        }
        case 'escort': {
            if (index === 0) return { x: 0, y: 0 };
            const angle = (index - 1) / Math.max(1, total - 1) * TAU;
            return { x: Math.cos(angle) * spacing, y: Math.sin(angle) * spacing };
        }
        case 'diamond':
        default: {
            if (index === 0) return { x: 0, y: 0 };
            const ring = Math.ceil(index / 4);
            const points = [
                { x: 0, y: -1 }, { x: 1, y: 0 },
                { x: 0, y: 1 }, { x: -1, y: 0 },
            ];
            const point = points[(index - 1) % points.length];
            return { x: point.x * spacing * ring, y: point.y * spacing * ring };
        }
    }
}

function expandedUnits(entry) {
    const guardians = [];
    const others = [];
    for (const group of entry.units) {
        for (let i = 0; i < group.count; i++) {
            (group.guardian ? guardians : others).push({
                type: group.type,
                guardian: group.guardian === true,
            });
        }
    }
    return guardians.concat(others);
}

export class EncounterDirector {
    constructor(options = {}) {
        this.initialized = false;
        this.initialize(options);
    }

    initialize(options = {}) {
        this.initialized = true;
        return this.reset(options);
    }

    reset(options = {}) {
        const requestedBiome = options.biomeId ?? this.biomeId ?? 'emberwood';
        this.biomeId = ENCOUNTERS_BY_BIOME[requestedBiome] ? requestedBiome : 'emberwood';
        this.seed = options.seed ?? options.runSeed ?? this.seed ?? 0;
        this._seedWord = hashText(this.seed) ^ hashText(this.biomeId);
        this.clock = finiteNonNegative(options.startTime, 0);
        this.phase = 'idle';
        this.nextAt = this.clock + this._cadenceDelay(0, true);
        this.warning = null;
        this.activePack = null;
        this.issuedCount = 0;
        this.completedCount = 0;
        this.lastPatternId = null;
        this.lastCompleted = null;
        this._deferredEvents = [];
        return this.getSnapshot();
    }

    // Returns newly-created messages and at most one bounded spawn request.
    // Context fields used by the director:
    //   gameTime, waveIndex or waveState.index, liveEnemyCount or enemies,
    //   enemyCap or waveState.maxAlive, bossActive/bossWarning,
    //   overlayActive/paused/upgradeChoices/chestReward/altar/victory/gameOver/
    //   photoMode, spawnResults, defeatedMemberIds, aliveMemberIds.
    update(dt, context = {}) {
        const output = { events: [], spawnRequests: [] };
        this._advanceClock(dt, context.gameTime);
        const blocked = this._isBlocked(context);

        this._consumeLifecycle(context, output, blocked);
        if (!blocked && this._deferredEvents.length) {
            output.events.push(...this._deferredEvents.splice(0));
            // A clear earned behind a long boss/modal must get its own readable
            // beat. Without this floor, its old cadence deadline could already
            // be overdue and a new warning would overwrite it on the same frame.
            this.nextAt = Math.max(
                this.nextAt,
                this.clock + ENCOUNTER_LIMITS.warningDuration,
            );
            return output;
        }

        if (this.activePack || this.phase === 'active') return output;

        if (this.phase === 'warning') {
            if (blocked) {
                // A warning hidden by a boss/modal is replayed in full when the
                // player can read it again; it never silently matures underneath.
                this.warning.needsReplay = true;
                this.warning.remaining = this.warning.duration;
                return output;
            }
            if (this.warning.needsReplay) {
                this.warning.needsReplay = false;
                this._emitWarning(this.warning.entry, this.warning.packId, output);
                return output;
            }
            this.warning.remaining -= finiteNonNegative(dt, 0);
            if (this.warning.remaining <= 0) this._issueSpawn(context, output);
            return output;
        }

        if (blocked || this.clock < this.nextAt) return output;

        const waveIndex = integerNonNegative(context.waveIndex ?? context.waveState?.index, 0);
        const entry = this._selectPattern(waveIndex);
        if (!entry) {
            this.nextAt = this.clock + ENCOUNTER_LIMITS.budgetRetryDelay;
            return output;
        }

        const budget = this._spawnBudget(context);
        if (budget.available < entry.minUnits) {
            this.nextAt = this.clock + ENCOUNTER_LIMITS.budgetRetryDelay;
            return output;
        }

        const packId = this._packId(entry);
        const duration = finiteNonNegative(entry.warningDuration, ENCOUNTER_LIMITS.warningDuration);
        this.phase = 'warning';
        this.warning = { entry, packId, duration, remaining: duration, needsReplay: false };
        this._emitWarning(entry, packId, output);
        return output;
    }

    getSnapshot() {
        const warning = this.warning ? {
            packId: this.warning.packId,
            encounterId: this.warning.entry.id,
            name: this.warning.entry.name,
            remaining: Math.max(0, this.warning.remaining),
            duration: this.warning.duration,
        } : null;
        const pack = this.activePack;
        const activePack = pack ? {
            packId: pack.packId,
            encounterId: pack.entry.id,
            name: pack.entry.name,
            requestedCount: pack.requestedCount,
            acceptedCount: pack.acceptedCount,
            pendingSpawnAck: !pack.acknowledged,
            guardiansRequested: pack.guardianIds.size,
            guardiansAccepted: pack.acceptedGuardianIds.size,
            guardiansRemaining: pack.acknowledged ? pack.aliveGuardianIds.size : null,
            issuedAt: pack.issuedAt,
        } : null;
        return {
            initialized: this.initialized,
            biomeId: this.biomeId,
            phase: this.phase,
            clock: this.clock,
            nextIn: this.phase === 'idle' ? Math.max(0, this.nextAt - this.clock) : null,
            warning,
            activePack,
            issuedCount: this.issuedCount,
            completedCount: this.completedCount,
            lastPatternId: this.lastPatternId,
            lastCompleted: this.lastCompleted ? { ...this.lastCompleted } : null,
        };
    }

    // Cancel an unread warning or live pack when an apex set piece takes over.
    // Game calls this before its canonical boss trash-wipe, so banished
    // guardians never count as player-earned clears or remain tracked forever.
    cancel(reason = 'external-interruption') {
        const pack = this.activePack;
        const warning = this.warning;
        if (!pack && !warning) return null;
        const entry = pack?.entry ?? warning?.entry;
        const event = {
            type: 'encounter-aborted',
            packId: pack?.packId ?? warning?.packId ?? null,
            encounterId: entry?.id ?? null,
            title: entry?.name ?? 'Tactical encounter',
            reason: String(reason || 'external-interruption'),
        };
        this.activePack = null;
        this.warning = null;
        this.phase = 'idle';
        this._scheduleNext();
        return event;
    }

    _advanceClock(dt, gameTime) {
        if (Number.isFinite(gameTime)) {
            this.clock = Math.max(this.clock, gameTime);
        } else {
            this.clock += finiteNonNegative(dt, 0);
        }
    }

    _cadenceDelay(serial, first = false) {
        const center = first ? ENCOUNTER_LIMITS.firstDelay : ENCOUNTER_LIMITS.interval;
        const jitter = (sample01(this._seedWord, serial, first ? 11 : 17) * 2 - 1)
            * ENCOUNTER_LIMITS.intervalJitter;
        return Math.max(ENCOUNTER_LIMITS.warningDuration + 1, center + jitter);
    }

    _scheduleNext() {
        this.nextAt = this.clock + this._cadenceDelay(this.issuedCount, false);
    }

    _selectPattern(waveIndex) {
        const candidates = encountersForBiome(this.biomeId, waveIndex);
        if (!candidates.length) return null;
        let index = mix32(this._seedWord ^ Math.imul(this.issuedCount + 1, 0x27d4eb2d)) % candidates.length;
        if (candidates.length > 1 && candidates[index].id === this.lastPatternId) {
            index = (index + 1) % candidates.length;
        }
        return candidates[index];
    }

    _packId(entry) {
        const run = mix32(this._seedWord).toString(36);
        return `enc-${run}-${this.issuedCount + 1}-${entry.id}`;
    }

    _isBlocked(context) {
        if (context.bossActive || context.bossWarning || context.overlayActive || context.paused
            || context.upgradeChoices || context.chestReward || context.altar || context.victory
            || context.gameOver || context.photoMode) return true;
        if (Array.isArray(context.enemies)) {
            return context.enemies.some((enemy) => enemy?.active && enemy.boss);
        }
        return false;
    }

    _spawnBudget(context) {
        let live = Number.isFinite(context.liveEnemyCount)
            ? integerNonNegative(context.liveEnemyCount)
            : 0;
        if (!Number.isFinite(context.liveEnemyCount) && Array.isArray(context.enemies)) {
            live = context.enemies.reduce((sum, enemy) => sum + (enemy?.active ? 1 : 0), 0);
        }
        const requestedCap = context.enemyCap ?? context.waveState?.maxAlive ?? ENCOUNTER_LIMITS.hardEnemyCap;
        const hardCap = Math.min(ENCOUNTER_LIMITS.hardEnemyCap, WAVE_LIMITS.maxEnemyCap);
        const cap = Math.min(hardCap, integerNonNegative(requestedCap, hardCap));
        return { live, cap, available: Math.max(0, cap - live) };
    }

    _emitWarning(entry, packId, output) {
        output.events.push({
            type: 'encounter-warning',
            packId,
            encounterId: entry.id,
            biomeId: entry.biomeId,
            title: entry.name,
            text: entry.warning,
            color: entry.accent,
            duration: finiteNonNegative(entry.warningDuration, ENCOUNTER_LIMITS.warningDuration),
        });
    }

    _issueSpawn(context, output) {
        const warning = this.warning;
        const entry = warning.entry;
        const budget = this._spawnBudget(context);
        if (budget.available < entry.minUnits) {
            this.phase = 'idle';
            this.warning = null;
            this.nextAt = this.clock + ENCOUNTER_LIMITS.budgetRetryDelay;
            return;
        }

        const authored = expandedUnits(entry);
        const count = Math.min(
            authored.length,
            budget.available,
            ENCOUNTER_LIMITS.maxUnitsPerPack,
        );
        if (count < entry.minUnits) {
            this.phase = 'idle';
            this.warning = null;
            this.nextAt = this.clock + ENCOUNTER_LIMITS.budgetRetryDelay;
            return;
        }

        const bearing = sample01(this._seedWord, this.issuedCount, 23) * TAU;
        const formationSeed = mix32(this._seedWord ^ hashText(entry.id) ^ this.issuedCount);
        const units = [];
        const guardianIds = new Set();
        for (let i = 0; i < count; i++) {
            const authoredUnit = authored[i];
            const memberId = `${warning.packId}:m${i + 1}`;
            const offset = formationOffset(entry.formation, i, count, entry.spacing, formationSeed);
            if (authoredUnit.guardian) guardianIds.add(memberId);
            units.push({
                memberId,
                type: authoredUnit.type,
                guardian: authoredUnit.guardian,
                elite: false,
                offset: { x: roundOffset(offset.x), y: roundOffset(offset.y) },
            });
        }

        const request = {
            type: 'encounter-pack',
            requestId: warning.packId,
            packId: warning.packId,
            encounterId: entry.id,
            biomeId: entry.biomeId,
            name: entry.name,
            formation: entry.formation,
            inheritWaveScale: true,
            anchor: {
                mode: 'player-ring',
                angle: bearing,
                distance: entry.anchorDistance,
                rotation: bearing - Math.PI / 2,
            },
            placementAttemptsPerUnit: 6,
            liveEnemyCountAtIssue: budget.live,
            enemyCapAtIssue: budget.cap,
            units,
        };

        this.activePack = {
            packId: warning.packId,
            entry,
            issuedAt: this.clock,
            requestedCount: units.length,
            minimumAcceptedCount: Math.min(units.length, entry.minUnits),
            expectedIds: new Set(units.map((unit) => unit.memberId)),
            guardianIds,
            acknowledged: false,
            acceptedCount: 0,
            acceptedGuardianIds: new Set(),
            aliveGuardianIds: new Set(),
        };
        this.phase = 'active';
        this.warning = null;
        this.issuedCount += 1;
        this.lastPatternId = entry.id;
        output.spawnRequests.push(request);
        output.events.push({
            type: 'encounter-spawned',
            packId: request.packId,
            encounterId: entry.id,
            title: entry.name,
            color: entry.accent,
            count: units.length,
        });
    }

    _consumeLifecycle(context, output, blocked) {
        const pack = this.activePack;
        if (!pack) return;

        if (!pack.acknowledged && Array.isArray(context.spawnResults)) {
            const result = context.spawnResults.find((entry) => entry?.packId === pack.packId);
            if (result) {
                const accepted = toIdSet(result.acceptedMemberIds) ?? new Set();
                for (const id of [...accepted]) if (!pack.expectedIds.has(id)) accepted.delete(id);
                pack.acknowledged = true;
                pack.acceptedCount = accepted.size;
                for (const id of pack.guardianIds) {
                    if (accepted.has(id)) {
                        pack.acceptedGuardianIds.add(id);
                        pack.aliveGuardianIds.add(id);
                    }
                }
                if (pack.acceptedGuardianIds.size === 0
                    || pack.acceptedCount < pack.minimumAcceptedCount) {
                    this._abortPack(
                        output,
                        blocked,
                        pack.acceptedGuardianIds.size === 0
                            ? 'no-guardian-spawned' : 'insufficient-placement',
                    );
                    return;
                }
            }
        }

        const defeated = toIdSet(context.defeatedMemberIds);
        if (defeated) {
            for (const id of defeated) pack.aliveGuardianIds.delete(id);
        }

        // Optional authoritative reconciliation for integrations that already
        // expose the set of currently-active tagged encounter enemies.
        const alive = toIdSet(context.aliveMemberIds);
        if (pack.acknowledged && alive) {
            for (const id of [...pack.aliveGuardianIds]) if (!alive.has(id)) pack.aliveGuardianIds.delete(id);
        }

        if (pack.acknowledged && pack.aliveGuardianIds.size === 0) {
            this._completePack(output, blocked);
        }
    }

    _abortPack(output, blocked, reason = 'no-guardian-spawned') {
        const pack = this.activePack;
        const event = {
            type: 'encounter-aborted',
            packId: pack.packId,
            encounterId: pack.entry.id,
            title: pack.entry.name,
            reason,
        };
        this.activePack = null;
        this.phase = 'idle';
        this._scheduleNext();
        this._emitOrDefer(event, output, blocked);
    }

    _completePack(output, blocked) {
        const pack = this.activePack;
        this.completedCount += 1;
        this.lastCompleted = {
            packId: pack.packId,
            encounterId: pack.entry.id,
            name: pack.entry.name,
            completedAt: this.clock,
        };
        const event = {
            type: 'encounter-cleared',
            packId: pack.packId,
            encounterId: pack.entry.id,
            title: `${pack.entry.name} broken`,
            text: '24 XP · 15 coins dropped',
            color: pack.entry.accent,
            completedCount: this.completedCount,
        };
        this.activePack = null;
        this.phase = 'idle';
        this._scheduleNext();
        this._emitOrDefer(event, output, blocked);
    }

    _emitOrDefer(event, output, blocked) {
        if (!blocked) {
            output.events.push(event);
            return;
        }
        // Only lifecycle notices are deferred; cap the tiny queue so malformed
        // integration input can never grow persistent state without bound.
        if (this._deferredEvents.length >= 4) this._deferredEvents.shift();
        this._deferredEvents.push(event);
    }
}

// Once an apex warning aborts a tactical pack, its survivors become ordinary
// swarm bodies until the arena wipe. Removing lifecycle/guardian tags keeps
// world markers and kill reporting honest during that warning window.
export function retireEncounterEnemyTags(enemies, packId) {
    if (!Array.isArray(enemies) || typeof packId !== 'string' || !packId) return 0;
    let retired = 0;
    for (const enemy of enemies) {
        if (!enemy || enemy.encounterPackId !== packId) continue;
        enemy.encounterMemberId = null;
        enemy.encounterPackId = null;
        enemy.encounterGuardian = false;
        enemy.encounterName = null;
        retired++;
    }
    return retired;
}

// Exported for validators/tooling that need to compare authored and expanded
// sizes without depending on private director state.
export function boundedEncounterSize(entry, available) {
    return Math.min(
        encounterUnitCount(entry),
        integerNonNegative(available),
        ENCOUNTER_LIMITS.maxUnitsPerPack,
    );
}
