// First-run lessons own guidance state only. Game supplies committed action
// counts; this module never grants currency, invents actions, or drives input.

const lesson = (id, title, metric, target, timeout, text, touchText = text) => Object.freeze({
    id, title, metric, target, timeout, minRead: 2.5, text, touchText,
});

export const ONBOARDING_LESSONS = Object.freeze([
    lesson('move', 'Keep moving', 'distanceMoved', 140, 10,
        'Move with W A S D or the arrow keys.\nEnemies chase you — keep moving to stay safe.',
        'Drag the left side of the screen to move.\nEnemies chase you — keep moving to stay safe.'),
    lesson('auto-fire', 'Your weapon attacks for you', 'autoAttacks', 1, 8,
        'Your weapon attacks nearby enemies by itself.\nKeep steering away from danger while it fires.'),
    lesson('shard', 'Collect a glowing shard', 'xpPickedUp', 1, 20,
        'Defeated enemies drop glowing XP shards.\nWalk over one to fill your level-up bar.'),
    lesson('upgrade', 'Choose your first upgrade', 'upgradesChosen', 1, 40,
        'Collect shards to earn a level-up choice.\nChoose one upgrade when the cards appear.'),
    lesson('coin', 'Collect a coin', 'coinsPickedUp', 1, 10,
        'Tougher enemies drop coins. Walk over one.\nRun coins are saved when you finish or leave.'),
    lesson('combo', 'Build a five-enemy combo', 'comboPeak', 5, 12,
        'Defeat five enemies quickly to build a combo.\nLonger kill streaks earn bonus coins.'),
    lesson('shrine', 'Choose a shrine relic', 'relicsChosen', 1, 18,
        'Walk onto a glowing shrine and choose a relic.\nIts special power lasts for this run.'),
    lesson('boss', 'Watch for a boss', 'bossWarnings', 1, 20,
        'A boss warning means a powerful enemy is coming.\nDefeat three bosses here to clear this area.'),
    lesson('blink', 'Try Blink', 'blinks', 1, 25,
        'Move, then press Space to Blink through danger.\nBlink is free and recharges after each use.',
        'Move, then tap BLINK to dash through danger.\nBlink is free and recharges after each use.'),
    lesson('focus', 'Focus an enemy', 'focusLocks', 1, 25,
        'Press Tab to lock a nearby enemy as your Focus.\nYour weapon prefers that target while it is in range.',
        'Tap an enemy on the right half to Focus it.\nYour weapon prefers that target while it is in range.'),
    lesson('kindle', 'Release your Kindle power', 'ultsReleased', 1, 40,
        'When Kindle is ready, hold Q to aim and release.\nDefeating enemies recharges this special power.',
        'When ready, hold KINDLE, drag to aim, and release.\nDefeating enemies recharges this special power.'),
    lesson('controls', 'Keep exploring', null, 0, 7,
        'Collect shards, choose relics, and face the bosses.\nYour movement, Blink, Focus, and Kindle controls stay below.'),
]);

export const ONBOARDING_ACTION_METRICS = Object.freeze({
    attack: 'autoAttacks',
    shard: 'xpPickedUp',
    upgrade: 'upgradesChosen',
    coin: 'coinsPickedUp',
    relic: 'relicsChosen',
    boss: 'bossWarnings',
    blink: 'blinks',
    focus: 'focusLocks',
    kindle: 'ultsReleased',
});

export const ONBOARDING_SUCCESS_HOLD = 1.1;
export const ONBOARDING_FALLBACK_HOLD = 1.8;
// Active gameplay seconds, excluding pauses/modals and at most one frame of
// quantization per transition. Every lesson has an exit even with no targets.
export const ONBOARDING_MAX_ACTIVE_SECONDS = ONBOARDING_LESSONS.reduce(
    (sum, entry) => sum + entry.timeout + ONBOARDING_FALLBACK_HOLD, 0,
);

const METRICS = Object.freeze([
    'distanceMoved', 'autoAttacks', 'xpPickedUp', 'upgradesChosen', 'coinsPickedUp',
    'comboPeak', 'relicsChosen', 'bossWarnings', 'blinks', 'focusLocks', 'ultsReleased',
]);

function amount(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.min(Number.MAX_SAFE_INTEGER, value) : 0;
}

function position(metrics) {
    return Number.isFinite(metrics.x) && Number.isFinite(metrics.y)
        ? { x: metrics.x, y: metrics.y } : null;
}

/**
 * Counts must represent this run's successful actions, never attempts or saved
 * balances. Call record after a committed action OR pass the cumulative metric
 * to update; supplying both does not double-count the same observed total.
 * All early actions are retained so a fast first level-up cannot skip lessons.
 */
export class OnboardingDirector {
    constructor(metrics = {}) {
        this.step = 0;
        this.timer = 0;
        this.done = false;
        this.doneTimer = 0;
        this.armed = true;
        this.finished = false;
        this.outcome = null;
        this.reason = null;
        this.history = [];
        this.counts = Object.fromEntries(METRICS.map((key) => [key, amount(metrics[key])]));
        this._position = position(metrics);
        this._walked = this.counts.distanceMoved;
    }

    get lesson() { return ONBOARDING_LESSONS[this.step] || null; }
    get lessonId() { return this.lesson?.id ?? null; }
    get moved() { return this.counts.distanceMoved; }

    record(action, value = 1) {
        const metric = ONBOARDING_ACTION_METRICS[action];
        if (this.finished || !metric) return false;
        const increment = amount(value);
        if (!increment) return false;
        this.counts[metric] = Math.min(Number.MAX_SAFE_INTEGER, this.counts[metric] + increment);
        return true;
    }

    _observe(metrics, blocked) {
        for (const metric of METRICS) {
            this.counts[metric] = Math.max(this.counts[metric], amount(metrics[metric]));
        }
        const next = position(metrics);
        // A pause/overlay position is an anchor, never movement credit. Game can
        // supply distanceMoved for an authoritative walk counter instead.
        if (!blocked && next && this._position && !Number.isFinite(metrics.distanceMoved)) {
            this._walked = Math.min(Number.MAX_SAFE_INTEGER, this._walked
                + amount(Math.hypot(next.x - this._position.x, next.y - this._position.y)));
            this.counts.distanceMoved = Math.max(this.counts.distanceMoved, this._walked);
        }
        this._position = next;
    }

    _settle(outcome, reason) {
        const current = this.lesson;
        if (!current || this.outcome) return null;
        this.outcome = outcome;
        this.reason = reason;
        this.done = outcome === 'success';
        this.doneTimer = this.done ? ONBOARDING_SUCCESS_HOLD : ONBOARDING_FALLBACK_HOLD;
        const receipt = Object.freeze({
            id: current.id, step: this.step, outcome, reason,
            metric: current.metric,
            value: current.metric ? this.counts[current.metric] : 0,
            target: current.target,
        });
        this.history.push(receipt);
        return { type: 'lesson-settled', ...receipt };
    }

    skipCurrent() {
        return this._settle('deferred', 'user-skipped');
    }

    update(dt, metrics = {}, { blocked = false, ended = false } = {}) {
        if (this.finished || ended) return null;
        this._observe(metrics, blocked);
        if (blocked) return null;
        const elapsed = amount(dt);
        if (!elapsed) return null;
        if (this.outcome) {
            this.doneTimer = Math.max(0, this.doneTimer - elapsed);
            if (this.doneTimer > 0) return null;
            this.step += 1;
            this.timer = 0;
            this.done = false;
            this.outcome = null;
            this.reason = null;
            this.finished = !this.lesson;
            return { type: this.finished ? 'tutorial-finished' : 'lesson-started', id: this.lessonId };
        }
        this.timer += elapsed;
        const current = this.lesson;
        if (current.metric && this.timer >= current.minRead && this.counts[current.metric] >= current.target) {
            return this._settle('success', 'action-confirmed');
        }
        if (this.timer >= current.timeout) {
            return this._settle(current.metric ? 'deferred' : 'read', current.metric ? 'time-limit' : 'read-time');
        }
        return null;
    }

    snapshot({ inputMode = 'keyboard', kindleReady = false } = {}) {
        const current = this.lesson;
        if (!current || this.finished) return null;
        const isTouch = inputMode === 'touch';
        let text = isTouch ? current.touchText : current.text;
        if (current.id === 'kindle' && !kindleReady && !this.outcome && this.counts.ultsReleased < 1) {
            text = 'Defeat enemies to fill the Kindle meter.\nWhen it glows, hold ' + (isTouch ? 'KINDLE' : 'Q') + ' to aim, then release.';
        }
        let resultText = null;
        if (this.outcome === 'success') resultText = 'Action completed';
        else if (this.outcome === 'deferred') resultText = 'Try this later — your controls stay available.';
        else if (this.outcome === 'read') resultText = 'You can replay these tips in Settings.';
        return {
            id: current.id,
            title: current.title,
            n: this.step + 1,
            total: ONBOARDING_LESSONS.length,
            text,
            done: this.done,
            outcome: this.outcome,
            resultText,
            progress: current.metric ? Math.min(current.target, this.counts[current.metric]) : 0,
            target: current.target,
            requiresAction: current.metric !== null,
        };
    }

    summary() {
        const successes = this.history.filter((entry) => entry.outcome === 'success');
        const deferred = this.history.filter((entry) => entry.outcome === 'deferred');
        return {
            finished: this.finished,
            successfulLessons: successes.length,
            deferredLessons: deferred.length,
            successfulIds: successes.map((entry) => entry.id),
            deferredIds: deferred.map((entry) => entry.id),
        };
    }
}

export function createOnboardingState(metrics) { return new OnboardingDirector(metrics); }
export function updateOnboardingState(state, dt, metrics, options) { return state?.update(dt, metrics, options) ?? null; }
export function onboardingLessonSnapshot(state, options) { return state?.snapshot(options) ?? null; }
