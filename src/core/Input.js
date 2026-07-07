export class Input {
    constructor({ keyboard, touch, buttons }) {
        this.keyboard = keyboard;
        this.touch = touch;
        // KINDLED touch action buttons (blink + Kindle ult + Focus taps).
        // Optional — the art harnesses build Input without it, so it stays null
        // there and every consumer guards on its presence.
        this.buttons = buttons || null;
    }

    getMovement() {
        if (this.touch && this.touch.active) {
            return this.touch.getVector();
        }
        return this.keyboard.getVector();
    }
}
