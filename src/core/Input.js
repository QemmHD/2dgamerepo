export class Input {
    constructor({ keyboard, touch, buttons }) {
        this._disposed = false;
        this._listeners = [];
        this.keyboard = keyboard;
        this.touch = touch;
        // KINDLED touch action buttons (blink + Kindle ult + Focus taps).
        // Optional — the art harnesses build Input without it, so it stays null
        // there and every consumer guards on its presence.
        this.buttons = buttons || null;

        // Active modality, not hardware capability, owns the HUD convention.
        // A hybrid laptop therefore stays on the desktop layout until a real
        // touch arrives, and switches back after actual keyboard/mouse use.
        this.modality = 'pointer';
        this._onModalityChange = null;
        this._modalitySubscription = null;
        this._noteKeyboard = (event) => {
            // A held key can continue emitting repeat keydowns after the player
            // grabs a touch joystick. Repeats are not a new modality decision;
            // only a fresh, unmodified keyboard press may leave touch mode.
            if (event?.repeat || event?.metaKey || event?.ctrlKey || event?.altKey) return;
            this.setModality('keyboard');
        };
        this._notePointer = (event) => {
            this.setModality(event?.pointerType === 'touch' ? 'touch' : 'pointer');
        };
        this._noteTouch = () => this.setModality('touch');
        if (typeof window !== 'undefined' && window.addEventListener) {
            // Capture makes the state current before Game routes the same input.
            try {
                window.addEventListener('keydown', this._noteKeyboard, { capture: true });
                this._listeners.push({ target: window, type: 'keydown', callback: this._noteKeyboard });
                window.addEventListener('pointerdown', this._notePointer, { capture: true, passive: true });
                this._listeners.push({ target: window, type: 'pointerdown', callback: this._notePointer });
                window.addEventListener('touchstart', this._noteTouch, { capture: true, passive: true });
                this._listeners.push({ target: window, type: 'touchstart', callback: this._noteTouch });
            } catch (error) { this.dispose(); throw error; }
        }
    }

    setModality(next) {
        if (this._disposed) return false;
        if (next !== 'keyboard' && next !== 'pointer' && next !== 'touch') return false;
        if (this.modality === next) return false;
        // Switching away from touch must clear any held joystick/button state;
        // otherwise a hybrid device can keep steering after keyboard input has
        // already restored the desktop HUD convention.
        if (this.modality === 'touch' && next !== 'touch') {
            this.touch?.reset?.();
            this.buttons?.reset?.();
        }
        this.modality = next;
        if (typeof this._onModalityChange === 'function') this._onModalityChange(next);
        return true;
    }

    getModality() { return this.modality; }
    isTouchMode() { return this.modality === 'touch'; }

    onModalityChange(callback) {
        if (this._disposed) return () => {};
        const subscription = {};
        this._modalitySubscription = subscription;
        this._onModalityChange = typeof callback === 'function' ? callback : null;
        return () => {
            // A previous subscriber must not clear a later registration, even
            // when both registrations use the same callback function.
            if (this._modalitySubscription !== subscription) return;
            this._modalitySubscription = null;
            this._onModalityChange = null;
        };
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        for (const { target, type, callback } of this._listeners) {
            target.removeEventListener(type, callback, true);
        }
        this._listeners.length = 0;
        this._modalitySubscription = null;
        this._onModalityChange = null;
        // Devices are borrowed. Their boot owner disposes them separately.
    }

    getMovement() {
        if (this._disposed) return { x: 0, y: 0 };
        if (this.touch && this.touch.active) {
            return this.touch.getVector();
        }
        return this.keyboard.getVector();
    }
}
