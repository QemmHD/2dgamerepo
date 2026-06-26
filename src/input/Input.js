export class Input {
    constructor({ keyboard, touch }) {
        this.keyboard = keyboard;
        this.touch = touch;
    }

    getMovement() {
        if (this.touch && this.touch.active) {
            const v = this.touch.getVector();
            if (v.x !== 0 || v.y !== 0) return v;
        }
        return this.keyboard.getVector();
    }
}
