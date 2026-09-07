const GAME_KEYS = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'Space',
    // KINDLED (update #3): Q holds to aim the Kindle ult (PR3), Tab cycles the
    // Focus target (PR3). Registered now so the browser never steals them
    // (Q-quickmark / Tab focus-shift) once those verbs go live.
    'KeyQ', 'Tab',
]);

export class KeyboardInput {
    constructor() {
        this._disposed = false;
        this._listeners = [];
        this.keys = new Set();
        this._onKeyDown = (e) => {
            if (this._disposed) return;
            this.keys.add(e.code);
            if (GAME_KEYS.has(e.code) && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
            }
        };
        this._onKeyUp = (e) => {
            this.keys.delete(e.code);
        };
        this._onBlur = () => this.keys.clear();

        const listen = (type, callback) => {
            window.addEventListener(type, callback);
            this._listeners.push({ target: window, type, callback });
        };
        try {
            listen('keydown', this._onKeyDown);
            listen('keyup', this._onKeyUp);
            listen('blur', this._onBlur);
        } catch (error) { this.dispose(); throw error; }
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        for (const { target, type, callback } of this._listeners) {
            target.removeEventListener(type, callback);
        }
        this._listeners.length = 0;
        this.keys.clear();
    }

    isDown(code) {
        return !this._disposed && this.keys.has(code);
    }

    getVector() {
        if (this._disposed) return { x: 0, y: 0 };
        let x = 0;
        let y = 0;
        if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) x -= 1;
        if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) x += 1;
        if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) y -= 1;
        if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) y += 1;
        const len = Math.hypot(x, y);
        if (len > 0) {
            x /= len;
            y /= len;
        }
        return { x, y };
    }
}
