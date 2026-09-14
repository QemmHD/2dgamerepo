import { Scene } from '../vendor/phaser/4.2.1/phaser.esm.min.js';
import { applyCameraToPhaser } from '../systems/ViewportContract.js';

// Diagnostic presentation only: no Game, input, save or simulation methods.
// Every point is a detached observation of the existing simulation.
export class WorldScene extends Scene {
    constructor(onReady) {
        super({ key: 'verification-world' });
        this.onReady = onReady;
        this.presentation = null;
    }
    create() {
        this.cameras.main.setBackgroundColor('#150f18');
        this.markers = this.add.graphics();
        this.drawDiagnostic();
        this.onReady();
        this.events.once('shutdown', () => { this.onReady = null; this.presentation = null; });
    }
    setPresentation(snapshot) { this.presentation = snapshot; }
    update() { this.drawDiagnostic(); }
    drawDiagnostic() {
        const g = this.markers;
        if (!g) return;
        g.clear();
        const p = this.presentation;
        if (!p) {
            const x = this.scale.width / 2, y = this.scale.height / 2;
            g.fillStyle(0x432239, 1).fillCircle(x, y, 65);
            g.fillStyle(0xe97735, 1).fillCircle(x, y, 35);
            g.fillStyle(0xffce79, 1).fillCircle(x, y, 12);
            return;
        }
        applyCameraToPhaser(p.camera, this.cameras.main, p.viewport);
        const { x, y } = p.camera.center;
        const reach = 2200 / Math.max(.5, p.camera.zoom);
        const spacing = 160;
        g.lineStyle(1, 0x392735, 1);
        for (let gx = Math.floor((x - reach) / spacing) * spacing; gx <= x + reach; gx += spacing) {
            g.lineBetween(gx, y - reach, gx, y + reach);
        }
        for (let gy = Math.floor((y - reach) / spacing) * spacing; gy <= y + reach; gy += spacing) {
            g.lineBetween(x - reach, gy, x + reach, gy);
        }
        g.lineStyle(3, 0x91624e, 1).lineBetween(-50, 0, 50, 0).lineBetween(0, -50, 0, 50);
        g.lineStyle(2, 0x8d829e, 1).strokeCircle(x, y, 52);
        g.fillStyle(0xe97735, 1).fillCircle(p.player.x, p.player.y, 28);
        g.fillStyle(0xffce79, 1).fillCircle(p.player.x, p.player.y, 10);
        for (const e of p.enemies) g.fillStyle(e.boss ? 0xe891ee : 0xec6674, 1).fillCircle(e.x, e.y, e.boss ? 32 : 12);
        g.fillStyle(0x8eebe7, 1);
        for (const e of p.projectiles) g.fillCircle(e.x, e.y, 7);
    }
}
