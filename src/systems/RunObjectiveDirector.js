// Deterministic, mode-aware run guidance.
//
// This class owns selection and progress only. Game owns authoritative metrics
// and SaveSystem owns the atomic reward ledger. Keeping those boundaries apart
// makes the director cheap to validate across thousands of seeds without a DOM,
// renderer, localStorage, or live game loop.

import {
    RUN_OBJECTIVE_CANDIDATES,
    RUN_OBJECTIVE_MAX_REWARD_MULTIPLIER,
    RUN_OBJECTIVE_MODE_IDS,
    RUN_OBJECTIVE_PHASES,
} from '../content/objectives.js';

export const RUN_OBJECTIVE_METRICS = Object.freeze([
    'kills',
    'timeSec',
    'level',
    'bosses',
    'sites',
    'siteKinds',
    'encounters',
]);

const METRIC_SET = new Set(RUN_OBJECTIVE_METRICS);
const MODE_SET = new Set(RUN_OBJECTIVE_MODE_IDS);
const EXPLORATION_MODES = new Set(['standard', 'daily', 'rite-trial']);
const GAUNTLET_MODES = new Set(['boss-rush', 'weekly']);

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function whole(value, fallback = 0) {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function positiveWhole(value, fallback = 1) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function suppliedCapacity(source, key, fallback) {
    if (!hasOwn(source, key)) return fallback;
    return Number.isFinite(source[key]) && source[key] >= 0
        ? Math.floor(source[key]) : 0;
}

function normalizeModeId(value) {
    return MODE_SET.has(value) ? value : 'unknown';
}

function hashText(value) {
    const text = String(value ?? '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function mix32(value) {
    let word = value >>> 0;
    word ^= word >>> 16;
    word = Math.imul(word, 0x7feb352d);
    word ^= word >>> 15;
    word = Math.imul(word, 0x846ca68b);
    word ^= word >>> 16;
    return word >>> 0;
}

function rewardMultiplier(value) {
    return Math.max(0, Math.min(
        RUN_OBJECTIVE_MAX_REWARD_MULTIPLIER,
        Number.isFinite(value) ? value : 1,
    ));
}

export function normalizeRunObjectiveMetrics(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return Object.freeze(Object.fromEntries(
        RUN_OBJECTIVE_METRICS.map((metric) => [metric, whole(source[metric])]),
    ));
}

// Resolve the systems a mode genuinely supports. Unknown/future modes fail
// closed to elapsed time only; their authored fallback therefore remains
// completable without assuming trash, bosses, build drafts, or map objects.
export function runObjectiveCapabilities(options = {}) {
    const source = options && typeof options === 'object' ? options : {};
    const modeId = normalizeModeId(source.modeId);
    const exploration = EXPLORATION_MODES.has(modeId);
    const gauntlet = GAUNTLET_MODES.has(modeId);
    const suppliedSystems = source.systems && typeof source.systems === 'object'
        ? source.systems : {};
    const systems = Object.freeze({
        livingVigil: hasOwn(suppliedSystems, 'livingVigil')
            ? suppliedSystems.livingVigil === true : exploration,
        bosses: hasOwn(suppliedSystems, 'bosses')
            ? suppliedSystems.bosses === true : exploration || gauntlet,
    });

    const metrics = new Set(['timeSec']);
    if (exploration) {
        metrics.add('kills');
        metrics.add('level');
    } else if (gauntlet) {
        // Boss Rush grants a real build and shards, but has no guaranteed trash.
        metrics.add('level');
    }
    if (systems.bosses) metrics.add('bosses');
    if (systems.livingVigil) {
        metrics.add('sites');
        metrics.add('siteKinds');
        metrics.add('encounters');
    }

    const suppliedLimits = source.limits && typeof source.limits === 'object'
        ? source.limits : {};
    const limits = {};
    if (systems.bosses) {
        limits.bosses = suppliedCapacity(suppliedLimits, 'bosses', gauntlet ? 12 : 3);
    }
    if (systems.livingVigil) {
        limits.sites = suppliedCapacity(suppliedLimits, 'sites', 4);
        limits.siteKinds = suppliedCapacity(suppliedLimits, 'siteKinds', 4);
    }

    return Object.freeze({
        modeId,
        systems,
        metrics: Object.freeze([...metrics]),
        limits: Object.freeze(limits),
    });
}

function modeAllows(definition, modeId) {
    return definition.modes === '*'
        || (Array.isArray(definition.modes) && definition.modes.includes(modeId));
}

function taskIsFeasible(definition, capabilities, metrics) {
    if (!definition || !METRIC_SET.has(definition.metric)) return false;
    if (!modeAllows(definition, capabilities.modeId)) return false;
    if (!capabilities.metrics.includes(definition.metric)) return false;
    if (definition.requires.some((system) => capabilities.systems[system] !== true)) return false;
    const limit = capabilities.limits[definition.metric];
    if (Number.isFinite(limit)) {
        const baseline = whole(metrics[definition.metric]);
        if (baseline + definition.target > limit) return false;
    }
    return positiveWhole(definition.target, 0) > 0;
}

function normalizedUsedMetrics(value) {
    if (!value || typeof value[Symbol.iterator] !== 'function') return new Set();
    return new Set([...value].filter((metric) => METRIC_SET.has(metric)));
}

// Pure selection seam used by the director, validators, and screenshot harness.
// It rotates within the filtered pool from a stable FNV/mix hash and prefers a
// metric the current path has not already used.
export function selectRunObjective(options = {}) {
    const source = options && typeof options === 'object' ? options : {};
    const phase = RUN_OBJECTIVE_PHASES.find((entry) => entry.id === source.phaseId);
    if (!phase) return null;
    const metrics = normalizeRunObjectiveMetrics(source.metrics);
    const capabilities = source.capabilities?.metrics
        ? source.capabilities
        : runObjectiveCapabilities({ modeId: source.modeId });
    const used = normalizedUsedMetrics(source.usedMetrics);
    const authored = RUN_OBJECTIVE_CANDIDATES[phase.id] || [];
    const feasible = authored.filter((task) => !task.fallback
        && taskIsFeasible(task, capabilities, metrics));
    const diverse = feasible.filter((task) => !used.has(task.metric));
    let pool = diverse.length ? diverse : feasible;
    let substitution = null;

    if (!pool.length) {
        pool = authored.filter((task) => task.fallback
            && taskIsFeasible(task, capabilities, metrics));
        substitution = 'mode-safe-fallback';
    }
    if (!pool.length) return null;

    const word = mix32(hashText(
        `${String(source.seed ?? 0)}:${capabilities.modeId}:${phase.id}:${pool.length}`,
    ));
    const definition = pool[word % pool.length];
    return Object.freeze({ definition, phase, substitution });
}

export function runObjectiveReceiptId(runId, phaseIndex, objectiveId) {
    const safeRun = typeof runId === 'string'
        ? runId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) : '';
    const safeObjective = typeof objectiveId === 'string'
        ? objectiveId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) : '';
    const index = whole(phaseIndex, -1);
    return safeRun && safeObjective && index >= 0 && index < RUN_OBJECTIVE_PHASES.length
        ? `${safeRun}:${index}:${safeObjective}`
        : null;
}

export function runObjectiveAccessibilityText(snapshot) {
    if (!snapshot) return '';
    const reward = whole(snapshot.reward?.amount);
    const rewardCopy = snapshot.rewardEligible === false || reward <= 0
        ? 'Practice task. No coin reward.'
        : `Reward ${reward} coins, banked only when the run ends.`;
    const signal = snapshot.vigilPrompt?.title
        ? ` Current map signal: ${snapshot.vigilPrompt.title}.` : '';
    return (`${snapshot.phaseLabel} ${snapshot.phaseIndex + 1} of ${snapshot.phaseTotal}. `
        + `${snapshot.title}. ${snapshot.nextAction} Progress ${snapshot.current} of ${snapshot.target}. `
        + `${rewardCopy}${signal}`).replace(/\s+/g, ' ').trim().slice(0, 240);
}

export class RunObjectiveDirector {
    constructor(options = {}) {
        const source = options && typeof options === 'object' ? options : {};
        this.runId = typeof source.runId === 'string' && source.runId
            ? source.runId.slice(0, 48) : 'session';
        this.seed = source.seed ?? this.runId;
        this.capabilities = source.capabilities?.metrics
            ? source.capabilities
            : runObjectiveCapabilities({
                modeId: source.modeId,
                systems: source.systems,
                limits: source.limits,
            });
        this.modeId = this.capabilities.modeId;
        this.phaseIndex = 0;
        this.completed = [];
        this.usedMetrics = new Set();
        this.metrics = normalizeRunObjectiveMetrics(source.metrics);
        this.rewardMultiplier = rewardMultiplier(source.rewardMultiplier);
        this.active = null;
        this._activateCurrentPhase();
    }

    _activateCurrentPhase() {
        const phase = RUN_OBJECTIVE_PHASES[this.phaseIndex];
        if (!phase) { this.active = null; return null; }
        const selection = selectRunObjective({
            phaseId: phase.id,
            seed: this.seed,
            capabilities: this.capabilities,
            metrics: this.metrics,
            usedMetrics: this.usedMetrics,
        });
        if (!selection) { this.active = null; return null; }
        const definition = selection.definition;
        const receiptId = runObjectiveReceiptId(this.runId, this.phaseIndex, definition.id);
        this.active = {
            definition,
            phase,
            baseline: whole(this.metrics[definition.metric]),
            substitution: selection.substitution,
            receiptId,
        };
        return this.getSnapshot();
    }

    _progress() {
        if (!this.active) return 0;
        const metric = this.active.definition.metric;
        const current = whole(this.metrics[metric]);
        return Math.max(0, Math.min(
            this.active.definition.target,
            current - this.active.baseline,
        ));
    }

    update(metrics, options = {}) {
        this.metrics = normalizeRunObjectiveMetrics(metrics);
        if (hasOwn(options, 'rewardMultiplier')) {
            this.rewardMultiplier = rewardMultiplier(options.rewardMultiplier);
        }
        if (!this.active) return null;
        const progress = this._progress();
        if (progress < this.active.definition.target) return null;

        const completedSnapshot = { ...this.getSnapshot(), status: 'complete' };
        const completed = Object.freeze({
            ...completedSnapshot,
            reward: Object.freeze({ ...completedSnapshot.reward, status: 'held' }),
        });
        this.completed.push(completed);
        this.usedMetrics.add(this.active.definition.metric);
        this.phaseIndex += 1;
        this.active = null;
        const next = this.phaseIndex < RUN_OBJECTIVE_PHASES.length
            ? this._activateCurrentPhase()
            : null;
        return Object.freeze({
            type: 'objective-complete',
            completed,
            next,
            allComplete: this.phaseIndex >= RUN_OBJECTIVE_PHASES.length,
        });
    }

    // Eligibility can change immediately when a dev action taints a live run.
    // Updating this policy must never consume progress or advance a phase.
    setRewardMultiplier(value) {
        this.rewardMultiplier = rewardMultiplier(value);
        return this.getSnapshot();
    }

    getSnapshot() {
        if (!this.active) return null;
        const { definition, phase, baseline, substitution, receiptId } = this.active;
        const current = this._progress();
        const amount = Math.max(0, Math.floor(definition.reward * this.rewardMultiplier));
        return Object.freeze({
            phase: phase.id,
            phaseLabel: phase.label,
            phaseNumeral: phase.numeral,
            phaseIndex: this.phaseIndex,
            phaseTotal: RUN_OBJECTIVE_PHASES.length,
            id: definition.id,
            title: definition.name,
            nextAction: definition.nextAction,
            metric: definition.metric,
            baseline,
            goalValue: baseline + definition.target,
            current,
            target: definition.target,
            progress: definition.target > 0 ? current / definition.target : 0,
            status: 'active',
            accent: phase.accent,
            substitution,
            completedPhases: this.completed.length,
            modeId: this.modeId,
            reward: Object.freeze({
                kind: 'coins',
                baseAmount: definition.reward,
                multiplier: this.rewardMultiplier,
                amount,
                status: 'pending',
                receiptId,
            }),
        });
    }

    getSummary() {
        return Object.freeze({
            completedPhases: this.completed.length,
            totalPhases: RUN_OBJECTIVE_PHASES.length,
            allComplete: this.completed.length === RUN_OBJECTIVE_PHASES.length,
            completedIds: Object.freeze(this.completed.map((entry) => entry.id)),
            active: this.getSnapshot(),
        });
    }
}
