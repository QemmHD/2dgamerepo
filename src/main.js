import { Renderer } from './systems/Renderer.js';
import { GameLoop } from './core/GameLoop.js';
import { Game } from './core/Game.js';
import { Input } from './core/Input.js';
import { KeyboardInput } from './core/KeyboardInput.js';
import { TouchJoystick } from './core/TouchJoystick.js';

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

    let game;
    const loop = new GameLoop({
        update: (dt) => game.update(dt),
        render: () => game.render(),
    });

    game = new Game({ renderer, input, loop });
    loop.start();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
