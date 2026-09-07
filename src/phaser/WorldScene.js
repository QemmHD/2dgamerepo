import { Scene } from '../vendor/phaser/4.2.1/phaser.esm.min.js';

// Presentation only. Deliberately has no EMBERWAKE Game, input or save reference.
export class WorldScene extends Scene {
    constructor(onReady) {
        super({ key: 'verification-world' });
        this.onReady = onReady;
        this.presentationMs = 0;
    }
    create() {
        this.cameras.main.setBackgroundColor('#150f18');
        this.ember = this.add.graphics();
        this.ember.fillStyle(0x432239, 1).fillCircle(0, 0, 100);
        this.ember.fillStyle(0x803925, 1).fillCircle(0, 0, 70);
        this.ember.fillStyle(0xe97735, 1).fillTriangle(-39, 35, 0, -80, 41, 35);
        this.ember.fillStyle(0xffce79, 1).fillTriangle(-17, 35, 1, -31, 20, 35);
        this.spark = this.add.circle(0, 0, 6, 0xffdc95);
        this.layout();
        this.onReady();
        this.events.once('shutdown', () => { this.onReady = null; });
    }
    layout() {
        const { width, height } = this.scale;
        const scale = Math.min(width / 960, height / 540);
        this.ember?.setPosition(width / 2, height / 2).setScale(scale);
        this.spark?.setScale(scale);
    }
    update(_time, delta) {
        this.presentationMs += Math.min(delta, 100);
        this.layout();
        const t = this.presentationMs / 1200;
        this.spark.setPosition(this.scale.width * .5 + Math.cos(t) * this.scale.width * .19,
            this.scale.height * .5 + Math.sin(t) * this.scale.height * .21);
    }
}
