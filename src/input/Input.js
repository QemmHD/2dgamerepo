export class Input {
    constructor({ keyboard, touch }) {
        this.keyboard = keyboard;
        this.touch = touch;
    }

    getMovement() {
        if (this.touch && this.touch.active) {
            return this.touch.getVector();
        }
        return this.keyboard.getVector();
    }
}
