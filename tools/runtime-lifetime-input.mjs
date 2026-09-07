// Behavioral input/DOM lifetime cases, called by validate-runtime-lifetime.js.
// Node procedural stubs prove listener/state ownership, not rendered pixels or
// trusted OS input. No SaveSystem, Game, host storage, or audio is constructed.
import { isDeepStrictEqual } from 'node:util';
import { installNodeEnvironment } from './artshot/migration-node-environment.mjs';

export async function validateInputLifetime(check) {
    if (typeof check !== 'function') throw new TypeError('Lifetime validator requires check(condition, label)');
    const environment = installNodeEnvironment();
    const owners = [];
    const globals = new Map();
    const active = [];
    const rafs = new Map();
    let additions = 0;
    let removals = 0;
    let addAttempts = 0;
    let failAt = Infinity;
    let frameSerial = 0;
    let callbacks = 0;
    let partialRegistrationCases = 0;
    const own = (value) => { owners.push(value); return value; };
    const equal = (actual, expected, label) => check(isDeepStrictEqual(actual, expected), label);
    const throws = (operation, pattern, label) => {
        let caught;
        try { operation(); } catch (error) { caught = error; }
        check(!!caught && pattern.test(String(caught.message)), label);
    };
    const replaceGlobal = (name, value) => {
        globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    };
    const instrument = (target) => {
        const add = target.addEventListener.bind(target);
        const remove = target.removeEventListener.bind(target);
        target.addEventListener = (type, callback, options) => {
            if (++addAttempts === failAt) throw new Error('registration failure');
            const capture = typeof options === 'boolean' ? options : !!options?.capture;
            add(type, callback, options);
            if (!active.some((entry) => entry.target === target && entry.type === type
                && entry.callback === callback && entry.capture === capture)) {
                active.push({ target, type, callback, capture });
                additions++;
            }
        };
        target.removeEventListener = (type, callback, options) => {
            const capture = typeof options === 'boolean' ? options : !!options?.capture;
            const index = active.findIndex((entry) => entry.target === target && entry.type === type
                && entry.callback === callback && entry.capture === capture);
            if (index >= 0) { active.splice(index, 1); removals++; }
            remove(type, callback, options);
        };
    };

    try {
        const [inputModule, keyboardModule, touchModule, buttonModule, loopModule,
            rendererModule, accessibilityModule, captionModule, hapticsModule] = await Promise.all([
            import('../src/core/Input.js'), import('../src/core/KeyboardInput.js'),
            import('../src/core/TouchJoystick.js'), import('../src/core/TouchButtons.js'),
            import('../src/core/GameLoop.js'), import('../src/systems/Renderer.js'),
            import('../src/systems/AccessibilityBridge.js'), import('../src/systems/CaptionSystem.js'),
            import('../src/systems/HapticsSystem.js'),
        ]);
        const { Input } = inputModule;
        const { KeyboardInput } = keyboardModule;
        const { TouchJoystick } = touchModule;
        const { TouchButtons } = buttonModule;
        const { GameLoop } = loopModule;
        const { Renderer } = rendererModule;
        const { AccessibilityBridge } = accessibilityModule;
        const { CaptionSystem } = captionModule;
        const { HapticsSystem } = hapticsModule;

        instrument(window); instrument(document); instrument(environment.renderer.canvas);
        window.visualViewport = document.createElement('div');
        window.visualViewport.width = 1920; window.visualViewport.height = 1080;
        instrument(window.visualViewport);
        replaceGlobal('requestAnimationFrame', (callback) => {
            const id = ++frameSerial; rafs.set(id, callback); return id;
        });
        replaceGlobal('cancelAnimationFrame', (id) => rafs.delete(id));

        for (let cycle = 0; cycle < 10; cycle++) {
            const label = `input shell cycle ${cycle + 1}`;
            const renderer = own(new Renderer(environment.renderer.canvas));
            const keyboard = own(new KeyboardInput());
            const touch = own(new TouchJoystick(renderer));
            const buttons = own(new TouchButtons(renderer));
            buttons.supported = true;
            const input = own(new Input({ keyboard, touch, buttons }));
            const loop = own(new GameLoop({ update() {}, render() {} }));
            equal(active.length, 25, `${label}: exactly 25 owned listeners`);

            const listener = () => callbacks++;
            const old = input.onModalityChange(listener);
            const current = input.onModalityChange(listener);
            old(); old();
            input.setModality('touch');
            equal(callbacks, cycle + 1, `${label}: old unsubscribe preserves newer same-function subscription`);
            current(); current();
            input.setModality('keyboard');
            equal(callbacks, cycle + 1, `${label}: unsubscribe removes active callback`);
            input.onModalityChange(listener);

            window.dispatchEvent({ type: 'keydown', code: 'KeyD' });
            equal(keyboard.isDown('KeyD'), true, `${label}: real keyboard listener holds movement`);
            environment.renderer.canvas.dispatchEvent({ type: 'touchstart', changedTouches: [
                { identifier: 1, clientX: 300, clientY: 700 },
                { identifier: 2, clientX: 1606, clientY: 888 },
            ] });
            equal(touch.active, true, `${label}: real joystick listener holds touch`);
            equal(buttons.kindleHeld, true, `${label}: real button listener holds Kindle`);

            loop.start(); equal(rafs.size, 1, `${label}: start queues one RAF`);
            loop.stop(); equal(rafs.size, 0, `${label}: stop cancels queued RAF`);
            loop.start(); equal(rafs.size, 1, `${label}: restart has one frame chain`);
            const staleFrame = [...rafs.values()][0];
            input.dispose();
            equal(keyboard.isDown('KeyD'), true, `${label}: Input does not dispose borrowed keyboard`);
            equal(touch.active, true, `${label}: Input does not dispose borrowed touch`);
            loop.dispose(); buttons.dispose(); touch.dispose(); keyboard.dispose(); renderer.dispose();
            for (const item of [loop, input, buttons, touch, keyboard, renderer]) item.dispose();
            staleFrame(1000);
            equal(active.length, 0, `${label}: every listener removed`);
            equal(rafs.size, 0, `${label}: disposed callback cannot restart RAF`);
            equal(keyboard.keys.size, 0, `${label}: held keys cleared`);
            equal(touch.active, false, `${label}: held joystick cleared`);
            equal(buttons.kindleHeld, false, `${label}: held Kindle cleared`);
            equal(buttons.consumeKindleCancel(), false, `${label}: no teardown Kindle refund command`);
            equal(buttons.consumeKindleTap(), false, `${label}: no Kindle tap survives`);
            equal(buttons.consumeBlinkTap(), false, `${label}: no Blink tap survives`);
            equal(buttons.consumeFocusTap(), null, `${label}: no Focus tap survives`);
            input.setModality('touch');
            equal(callbacks, cycle + 1, `${label}: disposed modality callback is detached`);
            equal(input.getMovement(), { x: 0, y: 0 }, `${label}: disposed movement is neutral`);
            keyboard._onKeyDown({ code: 'KeyD', preventDefault() {} });
            equal(keyboard.keys.size, 0, `${label}: stale keyboard callback is inert`);
        }

        const cases = [
            ['keyboard', () => new KeyboardInput(), 3],
            ['joystick', () => new TouchJoystick(environment.renderer), 9],
            ['buttons', () => new TouchButtons(environment.renderer), 6],
            ['input', () => new Input({ keyboard: { getVector: () => ({ x: 0, y: 0 }) } }), 3],
            ['renderer', () => new Renderer(environment.renderer.canvas), 3],
            ['loop', () => new GameLoop({ update() {}, render() {} }), 1],
        ];
        for (const [name, construct, count] of cases) {
            for (let index = 1; index <= count; index++) {
                addAttempts = 0; failAt = index;
                throws(() => own(construct()), /registration failure/, `${name}: construction fails at listener ${index}`);
                equal(active.length, 0, `${name}: partial listener ${index} rollback`);
                partialRegistrationCases++;
            }
        }
        failAt = Infinity;

        const getStyle = getComputedStyle;
        globalThis.getComputedStyle = () => { throw new Error('resize failure'); };
        try {
            throws(() => own(new Renderer(environment.renderer.canvas)), /resize failure/, 'Renderer reports initial resize failure');
            equal(active.length, 0, 'Renderer initial resize failure removes installed listeners');
        } finally { globalThis.getComputedStyle = getStyle; }

        const renderer = own(new Renderer(environment.renderer.canvas));
        let resolveLock;
        window.screen = { orientation: { lock: () => new Promise((resolve) => { resolveLock = resolve; }) } };
        renderer.tryLockLandscape();
        window.visualViewport.width = 1080; window.visualViewport.height = 1920;
        window.matchMedia = () => ({ matches: true });
        renderer.resize(); renderer._onResize();
        equal(rafs.size, 2, 'Renderer owns pending hint and coalesced resize RAF');
        const staleRenders = [...rafs.values()];
        renderer.dispose();
        equal(rafs.size, 0, 'Renderer disposal cancels both pending RAFs');
        for (const callback of staleRenders) callback(1000);
        resolveLock(); await Promise.resolve();
        equal(renderer._lockedLandscape, false, 'Late orientation promise cannot mutate disposed renderer');
        equal(rafs.size, 0, 'Late renderer callbacks cannot schedule another RAF');
        equal(active.length, 0, 'Renderer late-callback case has no listeners');

        const bridge = own(new AccessibilityBridge(environment.renderer.canvas));
        bridge.announce('Alive');
        const status = document.getElementById('game-status').textContent;
        const aria = environment.renderer.canvas.getAttribute('aria-label');
        bridge.dispose(); bridge.dispose(); bridge.announce('Disposed'); bridge.setScreen('gameOver');
        equal(document.getElementById('game-status').textContent, status, 'Disposed bridge leaves live-region text untouched');
        equal(environment.renderer.canvas.getAttribute('aria-label'), aria, 'Disposed bridge preserves Canvas ARIA');
        let presents = 0;
        const captions = own(new CaptionSystem({ onPresent: () => presents++ }));
        captions.say({ text: 'Alive' }); captions.dispose(); captions.dispose();
        captions.setPreferences(true, 'full'); captions.say({ text: 'Disposed' });
        equal(presents, 1, 'Caption callback does not survive disposal');
        equal(captions.onPresent, null, 'Caption callback reference is detached');
        equal(captions.queue.length, 0, 'Caption disposal clears queued work');
        const pulses = [];
        const haptics = own(new HapticsSystem({
            navigatorRef: { vibrate: (pattern) => { pulses.push(pattern); return true; } },
            documentRef: null, now: () => 1,
        }));
        haptics.setStrength('full'); haptics.pulse(); haptics.dispose(); haptics.dispose();
        haptics.setStrength('full');
        equal(haptics.pulse(), false, 'Disposed haptics cannot vibrate again');
        const hapticCancels = pulses.filter((pattern) => pattern === 0).length;
        equal(hapticCancels, 1, 'Haptics disposal cancels exactly once');
        equal(additions, removals, 'Input/DOM registration and removal totals balance');
        return {
            cycles: 10, listenersPerShell: 25, additions, removals,
            activeListeners: active.length, queuedRaf: rafs.size,
            partialRegistrationCases, captionPresents: presents, hapticCancels,
        };
    } finally {
        try {
            const results = await Promise.allSettled(owners.reverse().map(async (owner) => owner.dispose()));
            const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
            if (failures.length) throw new AggregateError(failures, 'Input lifetime fixture cleanup failed');
        } finally {
            try {
                for (const [name, descriptor] of [...globals].reverse()) {
                    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
                    else delete globalThis[name];
                }
            } finally { environment.restore(); }
        }
    }
}
