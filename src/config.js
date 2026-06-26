export const GAME_TITLE = 'Monkey Survivor — Prototype';

export const INTERNAL_WIDTH = 1920;
export const INTERNAL_HEIGHT = 1080;
export const ASPECT_RATIO = INTERNAL_WIDTH / INTERNAL_HEIGHT;

export const FIXED_DT = 1 / 60;
export const MAX_FRAME_DT = 0.1;

export const SPRITE_SIZE = 182;

export const WORLD_WIDTH = 4800;
export const WORLD_HEIGHT = 2700;

export const PLAYER = {
    radius: 50,
    speed: 420,
    startX: 0,
    startY: 0,
};

export const JOYSTICK = {
    maxRadius: 180,
    deadzone: 22,
};

export const BACKGROUND_COLOR = '#0a0e16';
export const GRID_COLOR = '#1c2632';
export const WORLD_BOUNDS_COLOR = '#4a8fe7';
export const GRID_SIZE = 200;

export const DEBUG_DEFAULT_ON = true;

export { TWO_PI } from './core/MathUtils.js';
