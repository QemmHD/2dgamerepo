import { Renderer } from './systems/Renderer.js';
import { GameLoop } from './core/GameLoop.js';
import { Game } from './core/Game.js';
import { Input } from './core/Input.js';
import { KeyboardInput } from './core/KeyboardInput.js';
import { TouchJoystick } from './core/TouchJoystick.js';
import { prewarmSprites } from './assets/ProceduralSprites.js';

function boot() {
    const canvas = document.getElementById('game');
    if (!canvas) {
        throw new Error('Canvas element #game not found');
    }

    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());

    const renderer = new Renderer(canvas);
    const keyboard = new KeyboardInput();
    const touch = new TouchJoystick(renderer);
    const input = new Input({ keyboard, touch });

    // Orientation lock must be requested from a user gesture; try once on the
    // first interaction (succeeds on Android / installed PWA, harmless no-op
    // on iOS Safari where the CSS-rotate-when-portrait fallback fills instead).
    const tryLock = () => {
        renderer.tryLockLandscape();
        window.removeEventListener('touchstart', tryLock);
        window.removeEventListener('pointerdown', tryLock);
    };
    window.addEventListener('touchstart', tryLock, { passive: true });
    window.addEventListener('pointerdown', tryLock, { passive: true });

    // Drop an in-progress joystick drag if the screen rotation flips, so a
    // stale touch origin can't produce a bogus steer across the convention.
    renderer.onOrientationChange = () => touch.reset();

    let game;
    const loop = new GameLoop({
        update: (dt) => game.update(dt),
        render: () => game.render(),
    });

    // Rasterize all procedural sprites once, before the first frame, so
    // no spawn/boss/coin hitches the loop by building art mid-frame.
    prewarmSprites();

    game = new Game({ renderer, input, loop });
    loop.start();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
