// TEST ONLY. Never imported by src/ or the production entry point.
export const STEP = 1 / 60;
export const FIXTURE_EPOCH = 1788696000000;
let globalsInstalled = false;

export class ActionTimeline {
    constructor(actions = []) {
        this.actions = actions.map((action) => ({ ...action }));
        this.cursor = 0;
        let previous = -1;
        for (const action of this.actions) {
            const offset = action.offsetMs ?? 0;
            const at = action.tick * 1000 / 60 + offset;
            if (!Number.isSafeInteger(action.tick) || action.tick < 0
                || !Number.isFinite(offset) || offset < 0 || offset >= 1000 / 60
                || at < previous || typeof action.action !== 'string') {
                throw new Error('Invalid or unordered action timeline');
            }
            previous = at;
        }
    }

    dispatch(tick, clock, apply) {
        while (this.cursor < this.actions.length && this.actions[this.cursor].tick === tick) {
            const action = this.actions[this.cursor++];
            clock.nowMs = tick * 1000 / 60 + (action.offsetMs ?? 0);
            apply({ ...action });
        }
        if (this.actions[this.cursor]?.tick < tick) throw new Error('Skipped timeline action');
    }
}

export class TestClock {
    constructor(actions = []) {
        this.ticks = 0;
        this.nowMs = 0;
        this.visualTimeMs = null;
        this.timeline = new ActionTimeline(actions);
        this._poisoned = false;
    }
    get seconds() { return this.ticks / 60; }
    get wallMilliseconds() { return this.visualTimeMs ?? this.nowMs; }
    advance(count, update, apply = () => {}) {
        if (this._poisoned) throw new Error('Test clock is poisoned by a failed action or update');
        if (!Number.isSafeInteger(count) || count < 0) throw new Error('Tick count must be a nonnegative integer');
        if (this.visualTimeMs !== null) throw new Error('Unfreeze visual time before advancing');
        try {
            for (let i = 0; i < count; i++) {
                this.timeline.dispatch(this.ticks, this, apply);
                this.nowMs = (this.ticks + 1) * 1000 / 60;
                update(STEP);
                this.ticks++;
            }
        } catch (error) {
            // Actions and the real Game may already be partially mutated. Never
            // retry an incomplete tick as though its consumed actions rolled back.
            this._poisoned = true;
            throw error;
        }
    }
    renderFrame(game, render) {
        if (this._poisoned) throw new Error('Test clock is poisoned by a failed action or update');
        const ticks = this.ticks;
        const time = game.time;
        render();
        if (this.ticks !== ticks || game.time !== time) throw new Error('Render-only capture advanced simulation');
        return { simulationTicks: 0, gameTimeBefore: time, gameTimeAfter: game.time };
    }
}

// One unified stream, installed before construction in a disposable test realm.
// No gameplay/presentation split and no production query parameter seam.
export function installDeterministicGlobals(seed, clock) {
    if (globalsInstalled) throw new Error('Deterministic globals already installed');
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be uint32');
    let state = seed >>> 0;
    let calls = 0;
    const NativeDate = globalThis.Date;
    const nativePerformance = globalThis.performance;
    const performanceDescriptor = Object.getOwnPropertyDescriptor(nativePerformance, 'now');
    if (performanceDescriptor && !performanceDescriptor.configurable) {
        throw new Error('Cannot install deterministic globals: performance.now is nonconfigurable');
    }
    const replacements = [];
    let restored = false;
    const restore = () => {
        if (restored) return;
        for (const { target, key, descriptor } of [...replacements].reverse()) {
            if (descriptor) Object.defineProperty(target, key, descriptor);
            else delete target[key];
        }
        restored = true;
        globalsInstalled = false;
    };
    const replace = (target, key, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        Object.defineProperty(target, key, { configurable: true, writable: true, enumerable: descriptor?.enumerable ?? false, value });
        replacements.push({ target, key, descriptor });
    };
    function FixtureDate(...args) {
        const values = args.length ? args : [FIXTURE_EPOCH + clock.wallMilliseconds];
        return new.target ? Reflect.construct(NativeDate, values, new.target)
            : new NativeDate(FIXTURE_EPOCH + clock.wallMilliseconds).toString();
    }
    Object.setPrototypeOf(FixtureDate, NativeDate);
    FixtureDate.prototype = NativeDate.prototype;
    FixtureDate.now = () => FIXTURE_EPOCH + clock.wallMilliseconds;
    const random = () => {
        calls++;
        state = (state + 0x6d2b79f5) >>> 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    try {
        replace(Math, 'random', random);
        replace(globalThis, 'Date', FixtureDate);
        replace(nativePerformance, 'now', () => clock.wallMilliseconds);
        globalsInstalled = true;
    } catch (error) {
        restore();
        throw error;
    }
    return {
        get calls() { return calls; },
        restore,
    };
}
