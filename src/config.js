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

export const ENEMY = {
    slime: {
        hp: 30,
        speed: 110,
        radius: 55,
        contactDamage: 8,
        xpValue: 1,
    },
    bat: {
        hp: 18,
        speed: 220,
        radius: 45,
        contactDamage: 6,
        xpValue: 1,
    },
};

export const WEAPON = {
    bolt: {
        cooldown: 0.6,
        damage: 12,
        projectileSpeed: 900,
        projectileLifetime: 1.5,
        projectileRadius: 14,
    },
};

export const SPAWN = {
    intervalMin: 0.75,
    intervalMax: 1.25,
    maxAlive: 60,
    ringRadiusMin: 1050,
    ringRadiusMax: 1350,
    minSpawnDistance: 800,
    slimeOnlyUntil: 5,
    batChance: 0.3,
    placementAttempts: 8,
};

export const HIT_FLASH_DURATION = 0.08;
export const CONTACT_FLASH_DURATION = 0.15;

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
