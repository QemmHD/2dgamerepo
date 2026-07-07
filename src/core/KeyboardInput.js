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
        this.keys = new Set();
        this._onKeyDown = (e) => {
            this.keys.add(e.code);
            if (GAME_KEYS.has(e.code) && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
            }
        };
        this._onKeyUp = (e) => {
            this.keys.delete(e.code);
        };
        this._onBlur = () => this.keys.clear();

        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('blur', this._onBlur);
    }

    isDown(code) {
        return this.keys.has(code);
    }

    getVector() {
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
