// Central game configuration.
// All tunable numbers live here so balance changes don't require hunting
// through gameplay code. Named exports are kept beginner-friendly: import
// only the constants you need.

// ── Identity / window ──────────────────────────────────────────────────
export const GAME_TITLE = 'Monkey Survivor — Prototype';

// ── Internal canvas resolution + 16:9 scaling ──────────────────────────
export const INTERNAL_WIDTH = 1920;
export const INTERNAL_HEIGHT = 1080;
export const ASPECT_RATIO = INTERNAL_WIDTH / INTERNAL_HEIGHT;

// ── Game loop timing ───────────────────────────────────────────────────
export const FIXED_DT = 1 / 60;
export const MAX_FRAME_DT = 0.1;

// ── Sprite + world ─────────────────────────────────────────────────────
export const SPRITE_SIZE = 182;
export const WORLD_WIDTH = 4800;
export const WORLD_HEIGHT = 2700;

// ── Player ─────────────────────────────────────────────────────────────
export const PLAYER = {
    radius: 50,
    speed: 420,
    startX: 0,
    startY: 0,
    pickupRange: 120,
    maxHp: 100,
    invincibilityDuration: 0.7,
    hitFlashDuration: 0.18,
};

// ── Enemies ────────────────────────────────────────────────────────────
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
    brute: {
        hp: 80,
        speed: 80,
        radius: 70,
        contactDamage: 14,
        xpValue: 3,
    },
    crawler: {
        hp: 24,
        speed: 175,
        radius: 40,
        contactDamage: 7,
        xpValue: 1,
    },
};

// Elite is a modifier applied to a base enemy type, not a separate type.
// Spawner can roll an elite version of any base type using waveState.eliteChance.
export const ELITE = {
    hpMul: 4.0,
    sizeMul: 1.3,
    speedMul: 0.85,
    contactDamageMul: 1.5,
    xpMul: 5,
};

// ── Weapons ────────────────────────────────────────────────────────────
// Per-weapon balance lives in src/content/weapons.js so behavior functions
// (which need real code) and stat tables can stay together. The cap on
// how high any weapon can level lives here for easy tuning.
export const MAX_WEAPON_LEVEL = 8;
export const MAX_PASSIVE_LEVEL = 5;

// Legacy block kept so Projectile's default opts still resolve cleanly when
// a weapon doesn't pass per-projectile overrides. The starter weapon uses
// the per-level table from content/weapons.js, not these values.
export const WEAPON = {
    bolt: {
        cooldown: 0.6,
        damage: 12,
        projectileSpeed: 900,
        projectileLifetime: 1.5,
        projectileRadius: 14,
    },
};

// ── Spawning ───────────────────────────────────────────────────────────
// intervalMin/intervalMax are the BASE delay range between spawns; WaveDirector
// supplies a per-wave multiplier so spawns get faster as time goes on. maxAlive
// is now per-wave (also scaled) — the value here is the Wave-1 baseline.
export const SPAWN = {
    intervalMin: 0.75,
    intervalMax: 1.25,
    ringRadiusMin: 1050,
    ringRadiusMax: 1350,
    minSpawnDistance: 800,
    placementAttempts: 8,
};

// ── Waves / difficulty ────────────────────────────────────────────────
// Each wave entry says "starting at startTime seconds, use these spawn rules
// until the next wave kicks in." Beyond the last wave, ENDLESS_SCALING ramps
// values smoothly each minute, capped by WAVE_LIMITS for performance safety.
export const WAVES = [
    {
        index: 0,
        startTime: 0,
        name: 'Jungle Stirring',
        announcement: 'Wave 1: Jungle Stirring',
        spawnIntervalMul: 1.0,
        maxAlive: 60,
        typeWeights: { slime: 100 },
        eliteChance: 0,
        healthMul: 1.0,
        speedMul: 1.0,
    },
    {
        index: 1,
        startTime: 60,
        name: 'Wing Trouble',
        announcement: 'Wave 2: Wing Trouble — Bats join in',
        spawnIntervalMul: 0.85,
        maxAlive: 75,
        typeWeights: { slime: 70, bat: 30 },
        eliteChance: 0,
        healthMul: 1.1,
        speedMul: 1.05,
    },
    {
        index: 2,
        startTime: 120,
        name: 'Fast Swarm',
        announcement: 'Wave 3: Fast Swarm — Crawlers skitter in',
        spawnIntervalMul: 0.72,
        maxAlive: 90,
        typeWeights: { slime: 45, bat: 25, crawler: 30 },
        eliteChance: 0,
        healthMul: 1.2,
        speedMul: 1.10,
    },
    {
        index: 3,
        startTime: 180,
        name: 'Thick Horde',
        announcement: 'Wave 4: Thick Horde — Pressure rises',
        spawnIntervalMul: 0.60,
        maxAlive: 110,
        typeWeights: { slime: 35, bat: 25, crawler: 40 },
        eliteChance: 0.015,
        healthMul: 1.35,
        speedMul: 1.15,
    },
    {
        index: 4,
        startTime: 240,
        name: 'Heavy Steps',
        announcement: 'Wave 5: Heavy Steps — Brutes arrive',
        spawnIntervalMul: 0.52,
        maxAlive: 125,
        typeWeights: { slime: 25, bat: 25, crawler: 25, brute: 25 },
        eliteChance: 0.03,
        healthMul: 1.5,
        speedMul: 1.20,
    },
    {
        index: 5,
        startTime: 300,
        name: 'Endless Swarm',
        announcement: 'Wave 6: Endless Swarm — Survive!',
        spawnIntervalMul: 0.44,
        maxAlive: 145,
        typeWeights: { slime: 20, bat: 25, crawler: 25, brute: 30 },
        eliteChance: 0.06,
        healthMul: 1.7,
        speedMul: 1.25,
    },
];

// Applied on top of the last wave's values; one tick per minute of survival
// past the last wave's startTime. Ramps stay small so progression stays fair.
export const ENDLESS_SCALING = {
    healthPerMinute: 0.06,
    speedPerMinute: 0.025,
    spawnIntervalShrinkPerMinute: 0.04,
    capGrowthPerMinute: 4,
    eliteChancePerMinute: 0.01,
};

export const WAVE_LIMITS = {
    maxEnemyCap: 180,
    maxSpeedMultiplier: 2.0,
    maxHealthMultiplier: 4.0,
    maxEliteChance: 0.25,
};

// ── XP / progression / gems ────────────────────────────────────────────
export const XP_CURVE = {
    base: 10,
    perLevel: 6,
};

// XP needed to advance from `level` → `level + 1`.
export function xpRequired(level) {
    return XP_CURVE.base + Math.max(0, level - 1) * XP_CURVE.perLevel;
}

export const GEM = {
    small:  { xp: 1,  radius: 12, bounceSpeed: 200, dropWeight: 92 },
    medium: { xp: 5,  radius: 16, bounceSpeed: 180, dropWeight: 7 },
    large:  { xp: 10, radius: 20, bounceSpeed: 160, dropWeight: 1 },
};

export const GEM_TIERS = ['small', 'medium', 'large'];

export const MAGNET = {
    initialSpeed: 150,
    acceleration: 1600,
    maxSpeed: 1500,
};

// ── Combat feedback ────────────────────────────────────────────────────
export const KNOCKBACK = {
    strength: 520,
    timeConstant: 0.08,
};

export const SCREEN_SHAKE = {
    intensity: 24,
    duration: 0.28,
};

export const DAMAGE_NUMBER = {
    lifetime: 0.75,
    riseSpeed: 70,
};

export const HIT_FLASH_DURATION = 0.08;
export const CONTACT_FLASH_DURATION = 0.15;

// ── Input ──────────────────────────────────────────────────────────────
export const JOYSTICK = {
    maxRadius: 180,
    deadzone: 22,
};

// ── Rendering / theme ──────────────────────────────────────────────────
export const BACKGROUND_COLOR = '#0a0e16';
export const GRID_COLOR = '#1c2632';
export const WORLD_BOUNDS_COLOR = '#4a8fe7';
export const GRID_SIZE = 200;

// ── UI / debug defaults ────────────────────────────────────────────────
export const UI = {
    enemyHealthBar: { width: 60, height: 6, marginAboveRadius: 14 },
    playerHealthBar: { width: 80, height: 8, marginAboveSpriteHalf: 16 },
};

export const DEBUG_DEFAULT_ON = true;
