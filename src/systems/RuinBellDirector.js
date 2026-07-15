// RuinBellDirector - pure deterministic lifecycle for the House V2 set piece.
//
// The director never creates enemies, mutates the house, pays rewards, plays
// audio, or draws. update() exposes bounded event and spawn-request lanes; Game
// acknowledges an entire wave only after its canonical placement path accepts
// every requested member. Partial acknowledgement is a technical defer, never
// a consumed combat attempt.

import {
    EMBERWOOD_RUIN_BELL_CABIN,
    getHouseBlueprint,
    houseDoorActive,
    worldFurniture,
} from '../content/houseBlueprints.js';
import {
    RUIN_BELL_CONTRACT,
    RUIN_BELL_PHASES,
    ruinBellMemberId,
} from '../content/ruinBell.js';

const UINT_RANGE = 4294967296;
const ACTIVE_PHASES = new Set(['warning', 'active', 'technical-defer']);
const MODAL_KEYS = [
    'paused', 'gameOver', 'victory', 'upgradeChoices', 'chestReward', 'altar', 'photoMode',
];

function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function nonNegative(value, fallback = 0) {
    return Math.max(0, finite(value, fallback));
}

function integer(value, fallback = 0) {
    return Math.floor(finite(value, fallback));
}

function rounded(value) {
    return Math.round(finite(value, 0) * 1000) / 1000;
}

function iterableIds(value) {
    if (value == null || typeof value[Symbol.iterator] !== 'function') return [];
    const out = [];
    for (const id of value) if (typeof id === 'string' && id) out.push(id);
    return out;
}

function sortedIds(value) {
    return [...value].sort();
}

function point(value) {
    return value && Number.isFinite(value.x) && Number.isFinite(value.y)
        ? { x: value.x, y: value.y }
        : null;
}

function worldPoint(origin, local) {
    if (!origin || !local || !Number.isFinite(local.x) || !Number.isFinite(local.y)) return null;
    return { x: origin.x + local.x, y: origin.y + local.y };
}

function cloneSocket(socket, origin) {
    if (!socket) return null;
    const world = worldPoint(origin, socket);
    return {
        roomId: socket.roomId || null,
        x: finite(socket.x),
        y: finite(socket.y),
        world,
    };
}

function cloneChargeLane(lane, origin) {
    if (!lane) return null;
    return {
        from: point(lane.from),
        through: point(lane.through),
        to: point(lane.to),
        worldFrom: worldPoint(origin, lane.from),
        worldThrough: worldPoint(origin, lane.through),
        worldTo: worldPoint(origin, lane.to),
        clearance: nonNegative(lane.clearance),
    };
}

export function ruinBellHash(...parts) {
    let hash = 2166136261;
    const text = parts.join('|');
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x7feb352d);
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 0x846ca68b);
    hash ^= hash >>> 16;
    return hash >>> 0;
}

function attackSeed(seed, memberId) {
    return ruinBellHash('ruin-bell-attack', seed, memberId) / UINT_RANGE;
}

function validPhase(value) {
    return RUIN_BELL_PHASES.includes(value);
}

export class RuinBellDirector {
    constructor(options = {}) {
        this.initialized = false;
        this.initialize(options);
    }

    initialize(options = {}) {
        this.initialized = true;
        return this.reset(options);
    }

    reset(options = {}) {
        this.contract = options.contract || this.contract || RUIN_BELL_CONTRACT;
        this.structure = options.structure ?? this.structure ?? null;
        this.blueprint = options.blueprint
            || this.structure?.blueprint
            || getHouseBlueprint(this.structure?.blueprintId)
            || getHouseBlueprint(this.contract.blueprintId)
            || EMBERWOOD_RUIN_BELL_CABIN;
        this.seed = options.seed ?? options.runSeed ?? this.seed ?? 0;
        this.structureId = String(options.structureId || this.structure?.id || 'unplaced-house');
        const signature = ruinBellHash(
            this.contract.id,
            this.seed,
            this.structureId,
            this.blueprint?.id || this.contract.blueprintId,
        ).toString(36);
        this.instanceId = String(options.instanceId || `ruin-bell-${signature}`);
        this.anchor = this._resolveAnchor(options.anchor);
        this.waveIndex = Math.max(0, integer(options.waveIndex ?? options.waveState?.index, 0));
        this.runtimeClock = nonNegative(options.startTime, 0);
        this.eventElapsed = 0;
        this.activationProgress = 0;
        this.cooldownRemaining = 0;
        this.attempt = 1;
        this.attemptsFailed = 0;
        this.phase = this.waveIndex >= this.contract.limits.unlockWaveIndex ? 'dormant' : 'locked';
        this.houseState = 'intact';
        this.pendingRequest = null;
        this._resumePhase = 'warning';
        this._inRange = false;
        this._inDefenseRange = false;
        this._defenseGraceRemaining = this.contract.limits.graceOutsideSeconds;
        this._manifest = new Map();
        this._stageStates = [];
        this._defeatedIds = new Set();
        this._spawnedIds = new Set();
        this._aliveIds = new Set();
        this._queuedAcks = [];
        this._trace = [];
        this._traceSerial = 0;
        this.droppedEvents = 0;
        this.droppedTraceEntries = 0;
        this.technicalDefers = 0;
        this.duplicateDefeats = 0;
        this.ignoredDefeats = 0;
        this.rewardEmitted = false;
        // The completion drop is a mutually-exclusive chest/shrine pair. Its
        // stable key lets Game acknowledge only this Director's authored pair;
        // normal boss loot and stale objects from another run cannot consume it.
        this.rewardId = `${this.instanceId}:completion-reward`;
        this.rewardClaimed = false;
        this.rewardChoice = null;
        this.duplicateRewardClaims = 0;
        this.ignoredRewardClaims = 0;
        this.completedAt = null;
        this.lastFailedAt = null;
        this._buildManifest();
        this._record('initialized', { phase: this.phase, waveIndex: this.waveIndex });
        return this.getSnapshot();
    }

    // Context accepts waveIndex/waveState.index, player/playerPosition or
    // explicit activation/defense range booleans, modal/set-piece flags,
    // spawnResults, and defeatedMemberIds. Rich projections are opt-in through
    // includeDiagnostics so the 120 FPS production path does not clone the
    // manifest, stages, role marks, and QA trace on every simulation tick.
    update(dt, context = {}) {
        const output = { events: [], spawnRequests: [] };
        this._includeDiagnostics = context.includeDiagnostics === true;
        const step = nonNegative(dt, 0);
        this.runtimeClock += step;
        this.waveIndex = Math.max(
            this.waveIndex,
            Math.max(0, integer(context.waveIndex ?? context.waveState?.index, this.waveIndex)),
        );
        this._inRange = this._playerInRange(context);
        this._inDefenseRange = this._playerInDefenseRange(context);

        this._consumeSpawnResults(context.spawnResults, output);
        this._consumeDefeats(context.defeatedMemberIds);

        if (this._isFrozen(context)) return this._finalize(output);

        if (this.phase === 'locked') {
            if (this.waveIndex >= this.contract.limits.unlockWaveIndex) {
                this._setPhase('dormant', 'wave-unlocked');
                this._emit(output, {
                    type: 'ruin-bell-unlocked',
                    instanceId: this.instanceId,
                    waveIndex: this.waveIndex,
                    title: 'Ruin Bell awakened',
                    text: this.contract.copy.available,
                    houseState: this.houseState,
                });
            }
            return this._finalize(output);
        }

        if (this.phase === 'technical-defer') {
            this.cooldownRemaining = Math.max(0, this.cooldownRemaining - step);
            if (this.cooldownRemaining <= 0) {
                this._setPhase(this._resumePhase, 'technical-resume');
            }
            return this._finalize(output);
        }

        if (this.phase === 'retry-cooldown') {
            this.cooldownRemaining = Math.max(0, this.cooldownRemaining - step);
            if (this.cooldownRemaining <= 0) {
                this.attempt = Math.min(this.contract.limits.maxAttempts, this.attemptsFailed + 1);
                this.activationProgress = 0;
                this.eventElapsed = 0;
                this._setPhase('dormant', 'retry-ready');
                this._emit(output, {
                    type: 'ruin-bell-retry-ready',
                    instanceId: this.instanceId,
                    attempt: this.attempt,
                    maxAttempts: this.contract.limits.maxAttempts,
                    title: 'Ruin Bell relit',
                    text: this.contract.copy.retryReady,
                    houseState: this.houseState,
                });
            }
            return this._finalize(output);
        }

        if (this.phase === 'cleared' || this.phase === 'spent') return this._finalize(output);

        if (this.phase === 'dormant' || this.phase === 'arming') {
            this._updateActivation(step, context, output);
            return this._finalize(output);
        }

        // An unexpected external apex is a freeze, not a hidden combat loss.
        // Normal integration prevents this path through ownsStage().
        if (this._externalConflict(context)) return this._finalize(output);

        // Ringing starts at the bell, but the combat contract owns the whole
        // cabin. A short, visible grace lets players dodge across the boundary;
        // abandoning it consumes the attempt just like the 60-second timeout.
        if (!this._updateDefenseBoundary(step, output)) return this._finalize(output);

        if (this.pendingRequest) {
            this.pendingRequest.ackElapsed += step;
            if (this.pendingRequest.ackElapsed >= this.contract.limits.spawnAcknowledgeSeconds) {
                this._technicalDefer(output, 'spawn-ack-timeout', []);
            }
            return this._finalize(output);
        }

        if (this.eventElapsed >= this.contract.limits.earliestClearSeconds
            && this._allMembersDefeated()) {
            this._complete(output);
            return this._finalize(output);
        }

        this.eventElapsed += step;
        if (this.eventElapsed >= this.contract.limits.earliestClearSeconds
            && this._allMembersDefeated()) {
            this._complete(output);
        } else if (this.eventElapsed >= this.contract.limits.timeoutSeconds) {
            this._fail(output);
        } else {
            // Terminal truth wins before authored catch-up. A throttled 60s
            // step must never issue a wave that Game could spawn after the
            // failure/clear cleanup event in the same output.
            this._advanceEncounter(output);
        }
        return this._finalize(output);
    }

    // Direct integration helpers enqueue/record bounded lifecycle input. Game
    // may instead pass the same values through update() context.
    acknowledgeWave(requestId, acceptedMemberIds, options = {}) {
        if (!this.pendingRequest || requestId !== this.pendingRequest.requestId) return false;
        if (this._queuedAcks.length >= this.contract.limits.maxQueuedAcks) this._queuedAcks.shift();
        this._queuedAcks.push({
            requestId,
            acceptedMemberIds: iterableIds(acceptedMemberIds),
            deferred: options.deferred === true || options.technicalDefer === true,
            reason: options.reason || null,
        });
        return true;
    }

    notifyDefeated(memberId) {
        return this._applyDefeat(memberId);
    }

    // Game calls this only after the player actually walks onto one member of
    // the authored choice pair. Both instanceId and rewardId are required so a
    // generic boss reward, a stale prior-run object, or a forged choice cannot
    // advance the Bell's terminal truth. Replays are harmless and return false.
    claimReward(claim = {}) {
        const instanceId = typeof claim.instanceId === 'string' ? claim.instanceId : '';
        const rewardId = typeof claim.rewardId === 'string' ? claim.rewardId : '';
        const choice = claim.choice === 'chest' || claim.choice === 'shrine'
            ? claim.choice : null;
        if (instanceId !== this.instanceId || rewardId !== this.rewardId
            || !choice || this.phase !== 'cleared' || !this.rewardEmitted) {
            this.ignoredRewardClaims += 1;
            return false;
        }
        if (this.rewardClaimed) {
            this.duplicateRewardClaims += 1;
            return false;
        }
        this.rewardClaimed = true;
        this.rewardChoice = choice;
        this._record('reward-claimed', { rewardId, choice });
        return true;
    }

    ownsStage() {
        return ACTIVE_PHASES.has(this.phase);
    }

    getSnapshot() {
        const pending = this.pendingRequest;
        return {
            initialized: this.initialized,
            contractId: this.contract.id,
            contractVersion: this.contract.version,
            instanceId: this.instanceId,
            seed: this.seed,
            blueprintId: this.blueprint?.id || this.contract.blueprintId,
            structureId: this.structureId,
            phase: this.phase,
            ownsStage: this.ownsStage(),
            waveIndex: this.waveIndex,
            unlockWaveIndex: this.contract.limits.unlockWaveIndex,
            attempt: this.attempt,
            maxAttempts: this.contract.limits.maxAttempts,
            attemptsFailed: this.attemptsFailed,
            houseState: this.houseState,
            runtimeClock: rounded(this.runtimeClock),
            eventElapsed: rounded(this.eventElapsed),
            timeRemaining: rounded(Math.max(0, this.contract.limits.timeoutSeconds - this.eventElapsed)),
            cooldownRemaining: rounded(this.cooldownRemaining),
            activation: {
                inRange: this._inRange,
                radius: this.contract.limits.activationRadius,
                seconds: rounded(this.activationProgress),
                target: this.contract.limits.dwellSeconds,
                progress: Math.min(1, this.activationProgress / this.contract.limits.dwellSeconds),
            },
            defense: {
                inRange: this._inDefenseRange,
                radius: this.contract.limits.defendRadius,
                graceSeconds: this.contract.limits.graceOutsideSeconds,
                graceRemaining: rounded(this._defenseGraceRemaining),
                outside: this.ownsStage() && !this._inDefenseRange,
            },
            members: this._memberSnapshot(),
            pendingRequest: pending ? {
                requestId: pending.requestId,
                stageId: pending.stageId,
                expectedMemberIds: [...pending.expectedMemberIds],
                ackElapsed: rounded(pending.ackElapsed),
            } : null,
            stages: this._stageStates.map((stage) => this._stageSnapshot(stage)),
            rewardEmitted: this.rewardEmitted,
            rewardId: this.rewardId,
            rewardClaimed: this.rewardClaimed,
            rewardChoice: this.rewardChoice,
            completedAt: this.completedAt,
            lastFailedAt: this.lastFailedAt,
            technicalDefers: this.technicalDefers,
        };
    }

    getGuidanceSnapshot() {
        const limits = this.contract.limits;
        const members = this._memberSnapshot();
        const nextStage = this._nextIncompleteStage();
        let nextAction = this.contract.copy.available;
        let current = members.defeated;
        let target = members.total;
        let progress = members.total ? members.defeated / members.total : 0;
        let countdown = null;
        let countdownLabel = null;

        if (this.phase === 'locked') {
            nextAction = this.contract.copy.locked;
            current = Math.min(this.waveIndex, limits.unlockWaveIndex);
            target = limits.unlockWaveIndex;
            progress = target ? current / target : 1;
        } else if (this.phase === 'arming') {
            nextAction = this.contract.copy.arming;
            current = rounded(this.activationProgress);
            target = limits.dwellSeconds;
            progress = Math.min(1, current / target);
        } else if (this.phase === 'warning') {
            if (!this._inDefenseRange) {
                nextAction = this.contract.copy.returnToCabin;
                countdown = this._defenseGraceRemaining;
                countdownLabel = 'RETURN';
            } else {
                nextAction = this.contract.copy.warning;
                countdown = Math.max(0, (nextStage?.def.atSeconds || 0) - this.eventElapsed);
                countdownLabel = 'FIRST TOLL';
            }
        } else if (this.phase === 'active') {
            const allDefeated = this._allMembersDefeated();
            if (!this._inDefenseRange) {
                nextAction = this.contract.copy.returnToCabin;
                countdown = this._defenseGraceRemaining;
                countdownLabel = 'RETURN';
            } else {
                nextAction = allDefeated
                    ? this.contract.copy.allDefeatedEarly
                    : this.contract.copy.active;
                countdown = Math.max(0,
                    (allDefeated ? limits.earliestClearSeconds : limits.timeoutSeconds)
                    - this.eventElapsed);
                countdownLabel = allDefeated ? 'SEALING' : 'BELL HOLDS';
            }
        } else if (this.phase === 'technical-defer') {
            nextAction = this.contract.copy.technicalDefer;
            countdown = this.cooldownRemaining;
            countdownLabel = 'APPROACH RESET';
        } else if (this.phase === 'retry-cooldown') {
            nextAction = this.contract.copy.retryCooldown;
            countdown = this.cooldownRemaining;
            countdownLabel = 'RETRY';
        } else if (this.phase === 'cleared') {
            nextAction = this.rewardClaimed
                ? (this.contract.copy.claimed || 'Reward claimed. The Ruin Bell burns bright.')
                : this.contract.copy.cleared;
            current = target;
            progress = 1;
        } else if (this.phase === 'spent') {
            nextAction = this.contract.copy.spent;
        } else if (this.attempt > 1) {
            nextAction = this.contract.copy.retryReady;
        }

        const accent = nextStage?.def.accent || '#ffad5a';
        const attemptLabel = `ATTEMPT ${this.attempt}/${limits.maxAttempts}`;
        const countdownRounded = countdown == null ? null : rounded(countdown);
        return {
            owner: 'ruin-bell',
            id: this.contract.id,
            visible: this.phase !== 'locked' || this._inRange,
            phase: this.phase,
            inActivationRange: this._inRange,
            eyebrow: 'EMBERWOOD CONTRACT',
            title: 'RUIN BELL',
            symbol: 'BELL',
            nextAction,
            current,
            target,
            progress: Math.max(0, Math.min(1, progress)),
            countdown: countdownRounded,
            countdownLabel,
            attempt: this.attempt,
            maxAttempts: limits.maxAttempts,
            attemptLabel,
            rewardLabel: this.contract.reward.label,
            accent,
            urgent: this.ownsStage(),
            complete: this.phase === 'cleared',
            rewardId: this.rewardId,
            rewardClaimed: this.rewardClaimed,
            rewardChoice: this.rewardChoice,
            locked: this.phase === 'locked',
            houseState: this.houseState,
            stageId: nextStage?.def.id || null,
            accessibilityText: [
                'Ruin Bell.',
                attemptLabel + '.',
                nextAction,
                countdownRounded == null ? null : `${countdownLabel}: ${Math.ceil(countdownRounded)} seconds.`,
                `Reward: ${this.contract.reward.label}.`,
            ].filter(Boolean).join(' '),
        };
    }

    getRenderSnapshot() {
        const limits = this.contract.limits;
        const members = this._memberSnapshot();
        const nextStage = this._nextIncompleteStage();
        const engaged = this.ownsStage();
        const origin = this._structureOrigin();
        const doors = (this.blueprint?.doors || [])
            .filter((door) => houseDoorActive(door, this.houseState))
            .map((door) => this._worldDoor(door.id));
        const telegraphs = [];
        if (nextStage?.warned && !nextStage.acknowledged) {
            const seen = new Set();
            for (const memberId of nextStage.memberIds) {
                if (this._defeatedIds.has(memberId)) continue;
                const entry = this._manifest.get(memberId);
                if (!entry) continue;
                const key = `${entry.unit.entryDoorId}:${entry.unit.role}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const role = this.contract.roles[entry.unit.role] || {};
                telegraphs.push({
                    stageId: entry.stage.id,
                    stageName: entry.stage.name,
                    entryDoorId: entry.unit.entryDoorId,
                    entry: this._worldDoor(entry.unit.entryDoorId),
                    role: entry.unit.role,
                    label: role.label || entry.unit.role,
                    symbol: role.symbol || '?',
                    accent: role.accent || entry.stage.accent,
                });
            }
        }
        const roleMarks = sortedIds(this._aliveIds).map((memberId) => {
            const entry = this._manifest.get(memberId);
            const role = this.contract.roles[entry?.unit.role] || {};
            return {
                memberId,
                stageId: entry?.stage.id || null,
                role: entry?.unit.role || 'enemy',
                label: role.label || entry?.unit.role || 'ENEMY',
                symbol: role.symbol || '?',
                accent: role.accent || entry?.stage.accent || '#ffad5a',
            };
        });
        const bellMode = this._bellMode();
        return {
            visible: !!this.anchor,
            instanceId: this.instanceId,
            blueprintId: this.blueprint?.id || this.contract.blueprintId,
            structureId: this.structureId,
            phase: this.phase,
            houseState: this.houseState,
            house: origin ? { x: origin.x, y: origin.y, state: this.houseState } : null,
            doors,
            anchor: this.anchor ? {
                x: this.anchor.x,
                y: this.anchor.y,
                radius: limits.activationRadius,
            } : null,
            bell: {
                mode: bellMode,
                lit: ['arming', 'warning', 'active', 'technical-defer', 'cleared'].includes(this.phase),
                intensity: this._bellIntensity(),
            },
            visualTime: rounded(this.runtimeClock),
            roofCutawayRequested: this._inRange || engaged,
            dwell: {
                seconds: rounded(this.activationProgress),
                target: limits.dwellSeconds,
                progress: Math.min(1, this.activationProgress / limits.dwellSeconds),
            },
            timer: {
                elapsed: rounded(this.eventElapsed),
                remaining: rounded(Math.max(0, limits.timeoutSeconds - this.eventElapsed)),
                earliestClearIn: rounded(Math.max(0, limits.earliestClearSeconds - this.eventElapsed)),
                timeoutSeconds: limits.timeoutSeconds,
                visible: engaged,
            },
            defense: {
                center: origin ? { x: origin.x, y: origin.y } : null,
                inRange: this._inDefenseRange,
                radius: limits.defendRadius,
                graceSeconds: limits.graceOutsideSeconds,
                graceRemaining: rounded(this._defenseGraceRemaining),
                outside: engaged && !this._inDefenseRange,
            },
            retry: {
                remaining: rounded(this.cooldownRemaining),
                duration: limits.retryCooldownSeconds,
            },
            attempt: { current: this.attempt, max: limits.maxAttempts },
            members,
            pendingWave: this.pendingRequest ? {
                requestId: this.pendingRequest.requestId,
                stageId: this.pendingRequest.stageId,
                name: this.pendingRequest.stageName,
            } : null,
            telegraphs,
            roleMarks,
            rewardReady: this.phase === 'cleared' && !this.rewardClaimed,
            rewardId: this.rewardId,
            rewardClaimed: this.rewardClaimed,
            rewardChoice: this.rewardChoice,
            reducedEffectsSafe: true,
        };
    }

    getQASnapshot() {
        return {
            contractId: this.contract.id,
            contractVersion: this.contract.version,
            instanceId: this.instanceId,
            seed: this.seed,
            blueprintId: this.blueprint?.id || this.contract.blueprintId,
            structureId: this.structureId,
            geometryVersion: this.blueprint?.version || null,
            phase: this.phase,
            houseState: this.houseState,
            attempt: this.attempt,
            attemptsFailed: this.attemptsFailed,
            reward: {
                id: this.rewardId,
                emitted: this.rewardEmitted,
                claimed: this.rewardClaimed,
                choice: this.rewardChoice,
            },
            clocks: {
                runtime: rounded(this.runtimeClock),
                event: rounded(this.eventElapsed),
                cooldown: rounded(this.cooldownRemaining),
                spawnAck: rounded(this.pendingRequest?.ackElapsed || 0),
                defenseGrace: rounded(this._defenseGraceRemaining),
            },
            members: {
                manifest: sortedIds(this._manifest.keys()),
                spawned: sortedIds(this._spawnedIds),
                alive: sortedIds(this._aliveIds),
                defeated: sortedIds(this._defeatedIds),
            },
            stages: this._stageStates.map((stage) => this._stageSnapshot(stage)),
            pendingRequest: this.pendingRequest ? {
                requestId: this.pendingRequest.requestId,
                stageId: this.pendingRequest.stageId,
                expectedMemberIds: [...this.pendingRequest.expectedMemberIds],
            } : null,
            counters: {
                technicalDefers: this.technicalDefers,
                duplicateDefeats: this.duplicateDefeats,
                ignoredDefeats: this.ignoredDefeats,
                droppedEvents: this.droppedEvents,
                droppedTraceEntries: this.droppedTraceEntries,
                rewardsEmitted: this.rewardEmitted ? 1 : 0,
                rewardClaims: this.rewardClaimed ? 1 : 0,
                duplicateRewardClaims: this.duplicateRewardClaims,
                ignoredRewardClaims: this.ignoredRewardClaims,
            },
            trace: this.getQaTrace(),
        };
    }

    getQaTrace() {
        return this._trace.map((entry) => ({ ...entry }));
    }

    // Compatibility spelling for tooling that treats QA as an acronym.
    getQATrace() {
        return this.getQaTrace();
    }

    getExclusionZone() {
        const origin = this._structureOrigin();
        if (!origin) return null;
        const dimensions = this.blueprint?.dimensions || {};
        const reach = Math.hypot(
            nonNegative(dimensions.interiorW),
            nonNegative(dimensions.interiorH),
        ) * 0.5 + nonNegative(this.blueprint?.circulation?.exteriorApproachDepth, 136);
        return {
            id: `${this.instanceId}:house-v2`,
            x: origin.x,
            y: origin.y,
            r: reach,
            radius: reach,
        };
    }

    getExclusionZones() {
        const zone = this.getExclusionZone();
        return zone ? [zone] : [];
    }

    _buildManifest() {
        let accepted = 0;
        for (let stageIndex = 0; stageIndex < this.contract.stages.length; stageIndex++) {
            const stage = this.contract.stages[stageIndex];
            const state = {
                def: stage,
                index: stageIndex,
                memberIds: [],
                warned: false,
                requested: false,
                acknowledged: false,
                skipped: false,
                requestSerial: 0,
                lastRequestId: null,
            };
            for (const authored of stage.units) {
                if (accepted >= this.contract.limits.maxMembers) break;
                const memberId = ruinBellMemberId(this.instanceId, stage.id, authored.id);
                state.memberIds.push(memberId);
                this._manifest.set(memberId, { memberId, stage, stageIndex, unit: authored });
                accepted++;
            }
            this._stageStates.push(state);
        }
    }

    _resolveAnchor(explicitAnchor) {
        const explicit = point(explicitAnchor);
        if (explicit) return explicit;
        const furniture = worldFurniture(this.structure, this.contract.anchorFurnitureId);
        if (furniture) return { x: furniture.x, y: furniture.y };
        const origin = this._structureOrigin();
        const authored = this.blueprint?.furniture?.find(
            (entry) => entry.id === this.contract.anchorFurnitureId,
        );
        return origin && authored
            ? { x: origin.x + authored.x, y: origin.y + authored.y }
            : null;
    }

    _structureOrigin() {
        return this.structure && Number.isFinite(this.structure.x) && Number.isFinite(this.structure.y)
            ? { x: this.structure.x, y: this.structure.y }
            : null;
    }

    _worldDoor(doorId) {
        if (!doorId) return null;
        const door = this.blueprint?.doors?.find((entry) => entry.id === doorId);
        const origin = this._structureOrigin();
        if (!door || !origin) return null;
        return {
            id: door.id,
            x: origin.x + door.x,
            y: origin.y + door.y,
            width: door.width,
            axis: door.axis,
            normal: {
                x: finite(door.normal?.x),
                y: finite(door.normal?.y),
            },
        };
    }

    _playerInRange(context) {
        if (typeof context.activationHeld === 'boolean') return context.activationHeld;
        if (typeof context.playerInRange === 'boolean') return context.playerInRange;
        if (typeof context.inActivationRange === 'boolean') return context.inActivationRange;
        const player = context.playerPosition || context.player;
        if (!this.anchor || !player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return false;
        const dx = player.x - this.anchor.x;
        const dy = player.y - this.anchor.y;
        const radius = this.contract.limits.activationRadius;
        return dx * dx + dy * dy <= radius * radius;
    }

    _playerInDefenseRange(context) {
        if (typeof context.playerInDefenseRange === 'boolean') return context.playerInDefenseRange;
        if (typeof context.inDefenseRange === 'boolean') return context.inDefenseRange;
        const player = context.playerPosition || context.player;
        const center = this._structureOrigin() || this.anchor;
        if (center && player && Number.isFinite(player.x) && Number.isFinite(player.y)) {
            const dx = player.x - center.x;
            const dy = player.y - center.y;
            const radius = this.contract.limits.defendRadius;
            return dx * dx + dy * dy <= radius * radius;
        }
        // Headless/direct callers historically supplied only the activation
        // boolean. Treat it as the narrowest valid defense answer when no
        // position or dedicated defense flag exists.
        if (typeof context.activationHeld === 'boolean') return context.activationHeld;
        if (typeof context.playerInRange === 'boolean') return context.playerInRange;
        if (typeof context.inActivationRange === 'boolean') return context.inActivationRange;
        return false;
    }

    _isFrozen(context) {
        if (context.screen && context.screen !== 'gameplay') return true;
        for (const key of MODAL_KEYS) if (context[key]) return true;
        return false;
    }

    _activationBlocked(context) {
        return !!(
            context.externalSetpieceBusy || context.setpieceBusy
            || context.bossActive || context.bossWarning
            || context.lieutenantActive || context.lieutenantWarning
            || context.tacticalEncounterActive || context.vigilChallengeActive
        );
    }

    _externalConflict(context) {
        return !!(
            context.externalSetpieceBusy
            || context.bossActive || context.bossWarning
            || context.lieutenantActive || context.lieutenantWarning
        );
    }

    _updateActivation(step, context, output) {
        if (this._activationBlocked(context)) {
            if (this.phase === 'arming') this._cancelArming(output, 'setpiece-busy');
            return;
        }
        if (!this._inRange) {
            if (this.phase === 'arming') this._cancelArming(output, 'left-focus-ring');
            return;
        }
        if (this.phase === 'dormant') this._setPhase('arming', 'entered-focus-ring');
        this.activationProgress = Math.min(
            this.contract.limits.dwellSeconds,
            this.activationProgress + step,
        );
        if (this.activationProgress >= this.contract.limits.dwellSeconds) {
            this._beginAttempt(output);
        }
    }

    _updateDefenseBoundary(step, output) {
        const grace = nonNegative(this.contract.limits.graceOutsideSeconds);
        if (this._inDefenseRange) {
            const restored = this._defenseGraceRemaining < grace;
            this._defenseGraceRemaining = grace;
            if (restored) {
                this._emit(output, {
                    type: 'ruin-bell-defense-restored',
                    instanceId: this.instanceId,
                    title: 'Cabin defense restored',
                    text: this.contract.copy.defenseRestored,
                    attempt: this.attempt,
                });
            }
            return true;
        }

        const justLeft = this._defenseGraceRemaining >= grace;
        this._defenseGraceRemaining = Math.max(0, this._defenseGraceRemaining - step);
        if (justLeft) {
            this._emit(output, {
                type: 'ruin-bell-defense-warning',
                instanceId: this.instanceId,
                title: 'Return to the cabin',
                text: this.contract.copy.returnToCabin,
                retryIn: this._defenseGraceRemaining,
                attempt: this.attempt,
            });
        }
        if (this._defenseGraceRemaining <= 0) {
            this._fail(output, 'left-cabin');
            return false;
        }
        return true;
    }

    _cancelArming(output, reason) {
        this.activationProgress = 0;
        this._setPhase('dormant', reason);
        this._emit(output, {
            type: 'ruin-bell-arming-cancelled',
            instanceId: this.instanceId,
            reason,
        });
    }

    _beginAttempt(output) {
        this.activationProgress = 0;
        this.eventElapsed = 0;
        this.cooldownRemaining = 0;
        this._defenseGraceRemaining = this.contract.limits.graceOutsideSeconds;
        this.pendingRequest = null;
        this._aliveIds.clear();
        for (const stage of this._stageStates) {
            stage.warned = false;
            stage.requested = false;
            stage.acknowledged = false;
            stage.skipped = false;
            stage.requestSerial = 0;
            stage.lastRequestId = null;
        }
        this.houseState = this.attempt === 1 ? 'lit' : 'damaged';
        this._setPhase('warning', `attempt-${this.attempt}-started`);
        this._emit(output, {
            type: 'ruin-bell-started',
            instanceId: this.instanceId,
            attempt: this.attempt,
            maxAttempts: this.contract.limits.maxAttempts,
            title: 'First Toll',
            text: this.contract.copy.warning,
            caption: 'Ruin Bell tolls',
            audioCue: 'ruin-bell-toll',
            duration: this.contract.limits.timeoutSeconds,
            earliestClearAt: this.contract.limits.earliestClearSeconds,
            houseState: this.houseState,
            reward: { ...this.contract.reward },
        });
        const first = this._nextIncompleteStage();
        if (first) this._warnStage(first, output);
    }

    _advanceEncounter(output) {
        // At most three authored stages exist, and no second request can issue
        // before the first is acknowledged. The loop only skips already-earned
        // stable IDs on retry, so output remains tightly bounded.
        for (let guard = 0; guard < this._stageStates.length; guard++) {
            const stage = this._nextIncompleteStage();
            if (!stage) return;
            const warnAt = Math.max(0, stage.def.atSeconds - stage.def.telegraphLeadSeconds);
            if (!stage.warned && this.eventElapsed >= warnAt) this._warnStage(stage, output);
            if (this.eventElapsed < stage.def.atSeconds || stage.requested) return;
            const remainingIds = stage.memberIds.filter((id) => !this._defeatedIds.has(id));
            if (remainingIds.length === 0) {
                stage.requested = true;
                stage.acknowledged = true;
                stage.skipped = true;
                if (this.phase === 'warning') this._setPhase('active', 'prior-members-already-defeated');
                this._record('stage-skipped', { stageId: stage.def.id, attempt: this.attempt });
                continue;
            }
            this._issueWave(stage, remainingIds, output);
            return;
        }
    }

    _warnStage(stage, output) {
        if (stage.warned) return;
        stage.warned = true;
        this._emit(output, {
            type: 'ruin-bell-stage-warning',
            instanceId: this.instanceId,
            stageId: stage.def.id,
            stageIndex: stage.index,
            title: stage.def.name,
            text: stage.def.warning,
            caption: stage.def.caption,
            color: stage.def.accent,
            scheduledAt: stage.def.atSeconds,
            leadSeconds: stage.def.telegraphLeadSeconds,
            entryDoorIds: [...new Set(stage.def.units.map((entry) => entry.entryDoorId).filter(Boolean))],
        });
    }

    _issueWave(stage, remainingIds, output) {
        stage.requested = true;
        stage.requestSerial += 1;
        const requestId = `${this.instanceId}:a${this.attempt}:${stage.def.id}:r${stage.requestSerial}`;
        stage.lastRequestId = requestId;
        const origin = this._structureOrigin();
        const units = remainingIds.map((memberId) => {
            const entry = this._manifest.get(memberId);
            return {
                memberId,
                type: entry.unit.type,
                role: entry.unit.role,
                eventMember: true,
                elite: false,
                entryDoorId: entry.unit.entryDoorId,
                entry: this._worldDoor(entry.unit.entryDoorId),
                routeRoomIds: [...entry.unit.routeRoomIds],
                combatSocket: cloneSocket(entry.unit.combatSocket, origin),
                chargeLane: cloneChargeLane(entry.unit.chargeLane, origin),
                attackSeed: attackSeed(this.seed, memberId),
            };
        });
        const request = {
            type: 'ruin-bell-wave',
            requestId,
            encounterId: this.contract.id,
            instanceId: this.instanceId,
            blueprintId: this.blueprint?.id || this.contract.blueprintId,
            structureId: this.structureId,
            structureOrigin: origin,
            houseState: this.houseState,
            attempt: this.attempt,
            maxAttempts: this.contract.limits.maxAttempts,
            stageId: stage.def.id,
            stageIndex: stage.index,
            stageName: stage.def.name,
            scheduledAt: stage.def.atSeconds,
            issuedAt: rounded(this.eventElapsed),
            allOrNone: true,
            requiredCount: units.length,
            requiredMemberIds: [...remainingIds],
            inheritWaveScale: true,
            placementAttemptsPerUnit: 8,
            anchor: this.anchor ? {
                mode: 'house-blueprint',
                x: this.anchor.x,
                y: this.anchor.y,
            } : { mode: 'house-blueprint' },
            units,
        };
        this.pendingRequest = {
            requestId,
            stageId: stage.def.id,
            stageName: stage.def.name,
            stage,
            expectedMemberIds: [...remainingIds],
            ackElapsed: 0,
        };
        output.spawnRequests.push(request);
        this._emit(output, {
            type: 'ruin-bell-wave-requested',
            instanceId: this.instanceId,
            requestId,
            stageId: stage.def.id,
            title: stage.def.name,
            count: units.length,
            allOrNone: true,
        });
    }

    _consumeSpawnResults(contextResults, output) {
        if (!this.pendingRequest) {
            this._queuedAcks.length = 0;
            return;
        }
        let result = null;
        while (this._queuedAcks.length && !result) {
            const candidate = this._queuedAcks.shift();
            if (candidate.requestId === this.pendingRequest.requestId) result = candidate;
        }
        if (!result && Array.isArray(contextResults)) {
            for (let i = 0; i < Math.min(contextResults.length, 32); i++) {
                const candidate = contextResults[i];
                if (!candidate) continue;
                const id = candidate.requestId || candidate.packId;
                if (id === this.pendingRequest.requestId) {
                    result = candidate;
                    break;
                }
            }
        }
        if (!result) return;

        const accepted = new Set(iterableIds(result.acceptedMemberIds));
        const expected = new Set(this.pendingRequest.expectedMemberIds);
        const exact = accepted.size === expected.size
            && [...expected].every((id) => accepted.has(id));
        if (result.deferred || result.technicalDefer || !exact) {
            const cleanup = [...accepted].filter((id) => expected.has(id));
            const reason = result.reason || (accepted.size ? 'partial-placement' : 'placement-deferred');
            this._technicalDefer(output, reason, cleanup);
            return;
        }

        const pending = this.pendingRequest;
        pending.stage.acknowledged = true;
        for (const id of pending.expectedMemberIds) {
            this._spawnedIds.add(id);
            this._aliveIds.add(id);
        }
        this.pendingRequest = null;
        if (this.phase === 'warning') this._setPhase('active', 'first-wave-acknowledged');
        this._emit(output, {
            type: 'ruin-bell-wave-spawned',
            instanceId: this.instanceId,
            requestId: pending.requestId,
            stageId: pending.stageId,
            title: pending.stageName,
            acceptedMemberIds: [...pending.expectedMemberIds],
            count: pending.expectedMemberIds.length,
            attempt: this.attempt,
        });
    }

    _technicalDefer(output, reason, acceptedIds) {
        const pending = this.pendingRequest;
        if (!pending) return;
        output.spawnRequests.length = 0;
        pending.stage.requested = false;
        pending.stage.acknowledged = false;
        this.pendingRequest = null;
        this.technicalDefers += 1;
        this._resumePhase = this._stageStates.some((stage) => stage.acknowledged)
            ? 'active' : 'warning';
        this.cooldownRemaining = this.contract.limits.retryCooldownSeconds;
        this._setPhase('technical-defer', reason);
        this._emit(output, {
            type: 'ruin-bell-technical-defer',
            instanceId: this.instanceId,
            requestId: pending.requestId,
            stageId: pending.stageId,
            title: 'Approach resetting',
            text: this.contract.copy.technicalDefer,
            reason,
            attempt: this.attempt,
            attemptConsumed: false,
            retryIn: this.cooldownRemaining,
            cleanupMemberIds: [...acceptedIds],
        });
    }

    _consumeDefeats(value) {
        for (const id of iterableIds(value)) this._applyDefeat(id);
    }

    _applyDefeat(memberId) {
        if (typeof memberId !== 'string' || !this._manifest.has(memberId)) {
            this.ignoredDefeats += 1;
            return false;
        }
        if (this._defeatedIds.has(memberId)) {
            this.duplicateDefeats += 1;
            return false;
        }
        if (!this._aliveIds.has(memberId)) {
            this.ignoredDefeats += 1;
            return false;
        }
        this._aliveIds.delete(memberId);
        this._defeatedIds.add(memberId);
        const entry = this._manifest.get(memberId);
        this._record('member-defeated', {
            memberId,
            stageId: entry.stage.id,
            role: entry.unit.role,
        });
        return true;
    }

    _complete(output) {
        if (this.rewardEmitted || validPhase(this.phase) && this.phase === 'cleared') return;
        output.spawnRequests.length = 0;
        this.pendingRequest = null;
        this.rewardEmitted = true;
        this.completedAt = rounded(this.eventElapsed);
        this.houseState = this.attempt === 1 ? 'lit' : 'damaged';
        this._setPhase('cleared', 'all-members-defeated');
        this._emit(output, {
            type: 'ruin-bell-cleared',
            instanceId: this.instanceId,
            encounterId: this.contract.id,
            title: 'Ruin Bell held',
            text: this.contract.reward.receipt,
            caption: 'Ruin Bell held',
            receipt: this.contract.reward.receipt,
            reward: { ...this.contract.reward },
            rewardId: this.rewardId,
            rewardOnce: true,
            attempt: this.attempt,
            completedAt: this.completedAt,
            anchor: this.anchor ? { ...this.anchor } : null,
            houseState: this.houseState,
        });
    }

    _fail(output, reason = 'combat-timeout') {
        if (this.phase !== 'warning' && this.phase !== 'active') return;
        output.spawnRequests.length = 0;
        const failedAttempt = this.attempt;
        const cleanupMemberIds = sortedIds(this._aliveIds);
        this._aliveIds.clear();
        this.pendingRequest = null;
        this.attemptsFailed += 1;
        this.lastFailedAt = rounded(this.eventElapsed);
        const retryAvailable = this.attemptsFailed < this.contract.limits.maxAttempts;
        this.houseState = retryAvailable ? 'damaged' : 'ruined';
        if (retryAvailable) {
            this.cooldownRemaining = this.contract.limits.retryCooldownSeconds;
            this._setPhase('retry-cooldown', reason);
        } else {
            this.cooldownRemaining = 0;
            this._setPhase('spent', reason === 'left-cabin' ? 'final-left-cabin' : 'final-combat-timeout');
        }
        this._emit(output, {
            type: 'ruin-bell-failed',
            instanceId: this.instanceId,
            encounterId: this.contract.id,
            title: retryAvailable ? 'Ruin Bell cracked' : 'Ruin Bell lost',
            text: this.contract.copy.failedReceipt,
            caption: 'Ruin Bell failed',
            receipt: this.contract.copy.failedReceipt,
            reward: null,
            attempt: failedAttempt,
            maxAttempts: this.contract.limits.maxAttempts,
            retryAvailable,
            retryIn: retryAvailable ? this.cooldownRemaining : null,
            reason,
            cleanupMemberIds,
            defeatedMemberIds: sortedIds(this._defeatedIds),
            houseState: this.houseState,
        });
    }

    _allMembersDefeated() {
        return this._manifest.size > 0 && this._defeatedIds.size === this._manifest.size;
    }

    _nextIncompleteStage() {
        return this._stageStates.find((stage) => !stage.acknowledged) || null;
    }

    _memberSnapshot() {
        return {
            total: this._manifest.size,
            defeated: this._defeatedIds.size,
            alive: this._aliveIds.size,
            remaining: Math.max(0, this._manifest.size - this._defeatedIds.size),
        };
    }

    _stageSnapshot(stage) {
        return {
            id: stage.def.id,
            name: stage.def.name,
            index: stage.index,
            scheduledAt: stage.def.atSeconds,
            warned: stage.warned,
            requested: stage.requested,
            acknowledged: stage.acknowledged,
            skipped: stage.skipped,
            lastRequestId: stage.lastRequestId,
            memberIds: [...stage.memberIds],
            defeatedMemberIds: stage.memberIds.filter((id) => this._defeatedIds.has(id)),
            aliveMemberIds: stage.memberIds.filter((id) => this._aliveIds.has(id)),
        };
    }

    _bellMode() {
        if (this.phase === 'locked') return 'cold';
        if (this.phase === 'dormant') return this.attempt > 1 ? 'damaged-ready' : 'ready';
        if (this.phase === 'arming') return 'arming';
        if (this.phase === 'retry-cooldown') return 'damaged';
        if (this.phase === 'cleared') return 'held';
        if (this.phase === 'spent') return 'ruined';
        return 'lit';
    }

    _bellIntensity() {
        if (this.phase === 'locked' || this.phase === 'spent') return 0;
        if (this.phase === 'dormant') return this.attempt > 1 ? 0.34 : 0.46;
        if (this.phase === 'arming') return 0.62;
        if (this.phase === 'retry-cooldown') return 0.18;
        if (this.phase === 'cleared') return 0.76;
        if (this.phase === 'technical-defer') return 0.48;
        return 1;
    }

    _setPhase(next, reason) {
        if (!validPhase(next) || next === this.phase) return;
        const from = this.phase;
        this.phase = next;
        this._record('phase', { from, to: next, reason });
    }

    _emit(output, event) {
        if (output.events.length >= this.contract.limits.maxEventsPerUpdate) {
            this.droppedEvents += 1;
            return;
        }
        output.events.push(event);
        this._record('event', {
            eventType: event.type,
            stageId: event.stageId || null,
            reason: event.reason || null,
        });
    }

    _record(type, detail = {}) {
        const entry = {
            sequence: ++this._traceSerial,
            type,
            runtimeClock: rounded(this.runtimeClock),
            eventElapsed: rounded(this.eventElapsed),
            phase: this.phase,
            attempt: this.attempt,
            ...detail,
        };
        if (this._trace.length >= this.contract.limits.maxTraceEntries) {
            this._trace.shift();
            this.droppedTraceEntries += 1;
        }
        this._trace.push(entry);
    }

    _finalize(output) {
        if (this._includeDiagnostics) {
            output.snapshot = this.getSnapshot();
            output.guidance = this.getGuidanceSnapshot();
            output.render = this.getRenderSnapshot();
            output.qa = this.getQASnapshot();
        }
        return output;
    }
}
