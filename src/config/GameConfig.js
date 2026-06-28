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
// SPRITE_SIZE is the WORLD draw size (collision/HUD offsets read it — never
// change it for resolution). SPRITE_SS supersamples the procedural source
// canvases: art is authored in SPRITE_SIZE units but rasterized into a
// SPRITE_SIZE×SPRITE_SS canvas, so it stays crisp when magnified on big /
// retina displays. Draw calls pass explicit world w/h to keep the footprint.
export const SPRITE_SIZE = 182;
export const SPRITE_SS = 2;
export const WORLD_WIDTH = 4800;
export const WORLD_HEIGHT = 2700;

// Display/backing-store tunables. maxDpr lifts the old hard cap of 2 so
// retina/4K render at true device pixels; maxBackingPx (4K = 3840×2160)
// bounds worst-case full-screen fill cost + guards iOS canvas-area limits.
// maxCoverCrop: when fitting the 16:9 game to a different-aspect screen
// (e.g. a 19.5:9 iPhone), prefer COVER (fill the screen, crop a little) over
// CONTAIN (letterbox bars) as long as the crop stays under this fraction.
// Keeps tall phones edge-to-edge; ultrawide displays still letterbox.
export const RENDER = { maxDpr: 3, maxBackingPx: 3840 * 2160, maxCoverCrop: 0.22 };

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
        contactDamage: 7,
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
        contactDamage: 12,
        xpValue: 3,
    },
    crawler: {
        hp: 24,
        speed: 175,
        radius: 40,
        contactDamage: 7,
        xpValue: 1,
    },
    // Ranged threat: a slow drifter that keeps its distance and lobs a
    // telegraphed bolt the player must sidestep.
    spitter: {
        hp: 30,
        speed: 95,
        radius: 44,
        contactDamage: 6,
        xpValue: 2,
        behavior: 'spitter',
        keepDistance: 430,   // tries to hold this gap from the player
        fireInterval: 2.6,   // seconds between shots
        windup: 0.5,         // telegraph time before a shot leaves
        fireRange: 820,      // won't fire beyond this
        projectileSpeed: 430,
        projectileDamage: 10,
    },
    // Burst threat: stalks slowly, then winds up and dashes through the
    // player's last position — punishes standing still.
    charger: {
        hp: 50,
        speed: 70,
        radius: 50,
        contactDamage: 9,
        xpValue: 2,
        behavior: 'charger',
        chargeInterval: 3.4, // seconds between dashes
        windup: 0.55,        // telegraph time before the dash
        triggerRange: 620,   // starts a charge when within this range
        dashSpeed: 760,
        dashDuration: 0.4,
    },
    // Bosses are still Enemy instances; the `boss: true` flag flips on the
    // boss HP bar, chest drop on death, and lets the constructor pull in
    // bossName + visualScale. They scale with wave just like other enemies.
    vinebackGoliath: {
        hp: 1250,
        speed: 60,
        radius: 105,
        contactDamage: 25,
        xpValue: 50,
        boss: true,
        bossName: 'Vineback Goliath',
        visualScale: 1.85,
        // Apex boss: telegraphed ground shockwave + phase-2 enrage at 50% HP.
        behavior: 'apexBoss',
        phase2HpFraction: 0.5,
        attacks: [
            { id: 'slam', kind: 'shockwave', cooldown: 6.0, windup: 0.8, damage: 30, growth: 700, rMax: 520, band: 90 },
        ],
        phase2Attacks: ['slam'],
    },
    stormwingAlpha: {
        hp: 780,
        speed: 130,
        radius: 80,
        contactDamage: 18,
        xpValue: 35,
        boss: true,
        bossName: 'Stormwing Alpha',
        visualScale: 1.55,
        // Apex boss: telegraphed radial projectile fan + phase-2 enrage.
        behavior: 'apexBoss',
        phase2HpFraction: 0.5,
        attacks: [
            { id: 'volley', kind: 'fan', cooldown: 5.0, windup: 0.6, count: 12, spread: 6.2832 /* TWO_PI: full-circle radial */, projectileSpeed: 380, projectileDamage: 14 },
        ],
        phase2Attacks: ['volley'],
    },
};

// Boss spawn schedule + spawn placement.
export const BOSS = {
    spawnInterval: 120,
    spawnRingDistance: 1100,
    types: ['vinebackGoliath', 'stormwingAlpha'],
};

// Coin drops from enemies / elites / bosses. Tunable so coins feel
// valuable without being a constant pickup chore.
export const COIN = {
    normalDropChance: 0.05,
    eliteDropChance: 0.5,
    eliteCoinMin: 3,
    eliteCoinMax: 5,
    bossCoinCount: 5,
    bossCoinValue: 4,
};

// Chest entity + reward weighting. luckUpgradeWeight is how much each unit
// of player.chestLuck shifts the roll toward weapon/passive upgrades.
export const CHEST = {
    pickupRadius: 80,
    openAnimationDuration: 0.55,
    eliteDropChance: 0.15,
    weights: { weapon: 3, passive: 3, coins: 2, heal: 2 },
    luckUpgradeWeight: 4,
    coinReward: { min: 50, max: 100, luckBonus: 80 },
    healReward: { base: 45, luckBonus: 25 },
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

// Rolled affixes layered onto an elite for visible variety + a death/while-
// alive twist. Each elite picks one at random. Colors tint the elite glow.
export const ELITE_AFFIXES = ['swift', 'volatile', 'splitting'];
export const AFFIX = {
    // Cancels the elite speed penalty and then some — a fast, evasive elite.
    swift: { tint: '#7fe0ff', speedMul: 1.7 },
    // Detonates on death, dealing AoE to everything nearby.
    volatile: { tint: '#ff9a4a', explodeRadius: 210, explodeDamage: 26 },
    // Bursts into a few crawlers on death.
    splitting: { tint: '#b48cff', spawnType: 'crawler', spawnCount: 3 },
};

// Straight-flying enemy bolt (Spitter + boss volley). Damages the player on
// contact and respects i-frames just like contact damage.
export const ENEMY_PROJECTILE = {
    radius: 16,
    lifetime: 3.2,
    color: '#c97bff',
};

// ── Elemental status system ────────────────────────────────────────────
// Weapons tag themselves with an element and stamp a status on hit. Tints
// are read by the procedural status tells (mirrors how AFFIX tints drive the
// elite halo). Only FIRE ticks over time — tickInterval lives there alone.
//   FROST: chill (soft slow, own channel) that can proc a short hard freeze.
//   FIRE:  burn damage-over-time carried on the projectile.
//   SHOCK: stacking damage-amp read at hit time; also detonates burn.
export const ELEMENT = {
    fire:   { tint: '#ff7a33', tickInterval: 0.25 },
    frost:  { tint: '#7fe0ff' },
    freeze: { tint: '#bfe8ff' },
    shock:  { tint: '#ffe066' },
};

// A shock hit on a burning enemy consumes the remaining burn for an instant
// burst of detonateMul × current burnDps, then clears the burn.
export const SHOCK_CFG = { detonateMul: 2.5 };

// ── Apex boss state machine ─────────────────────────────────────────────
// Bosses with behavior:'apexBoss' run telegraphed special attacks and a
// latched phase-2 enrage at phase2HpFraction. These shared constants tune
// the telegraph look + the phase-2 ramp; per-attack data lives on the boss
// def's `attacks` array.
export const BOSS_ATTACK = {
    telegraphColor: '#ff5a3c',  // ground warning ring during a windup
    phase2CadenceMul: 0.6,      // attacks fire 40% faster after enrage
    enrageRetintColor: '#ff5a3c',
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
        typeWeights: { slime: 45, bat: 25, crawler: 30, spitter: 15 },
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
        typeWeights: { slime: 35, bat: 25, crawler: 40, spitter: 20, charger: 12 },
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
        typeWeights: { slime: 25, bat: 25, crawler: 25, brute: 25, spitter: 20, charger: 18 },
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
        typeWeights: { slime: 20, bat: 25, crawler: 25, brute: 30, spitter: 22, charger: 20 },
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
// Leveling curve. Lowered + flattened so early level-ups come fast (hooks the
// player) and the ramp stays gentle. L1→2 needs `base`; each later level adds
// `perLevel`. base 8 / perLevel 4 gives 8,12,16,20,24,… (was 10 / 6).
export const XP_CURVE = {
    base: 8,
    perLevel: 4,
};

// XP needed to advance from `level` → `level + 1`.
export function xpRequired(level) {
    return XP_CURVE.base + Math.max(0, level - 1) * XP_CURVE.perLevel;
}

// Slightly more medium/large gems so XP pickups feel juicy and frequent
// (was 92/7/1). XP values per tier unchanged.
export const GEM = {
    small:  { xp: 1,  radius: 12, bounceSpeed: 200, dropWeight: 86 },
    medium: { xp: 5,  radius: 16, bounceSpeed: 180, dropWeight: 11 },
    large:  { xp: 10, radius: 20, bounceSpeed: 160, dropWeight: 3 },
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

// ── Map / world visuals ───────────────────────────────────────────────
// Ground is drawn as a tiled procedural texture filled via createPattern,
// then deterministically-placed decorations (rocks, mushrooms, etc.) are
// scattered chunk-by-chunk using a seeded RNG so the same patch of world
// always looks the same. chunkTilesPerSide * tileSize = world-space chunk
// size; only chunks intersecting the camera view are visited per frame.
export const MAP = {
    tileSize: 128,
    chunkTilesPerSide: 4,
    decorationsPerChunkMin: 2,
    decorationsPerChunkMax: 5,
    backgroundColor: '#0c1410',
    decorationTypes: ['rock', 'mushroom', 'skull', 'grass', 'candle', 'ruin', 'branch', 'crackedStone', 'bones'],
};

// Soft corner darkening drawn AFTER the world but BEFORE the UI so the
// edges of the play area fade away gently — kept low so gameplay
// readability stays unaffected. (Fallback path only — when the lighting
// buffer is active it bakes its own vignette into the darkness veil.)
export const VIGNETTE = {
    strength: 0.5,
    innerRadius: 0.32,
    outerRadius: 0.85,
};

// ── Graphics / "Emberlight" overhaul ───────────────────────────────────
// The world draws fully lit at full opacity, then a single dark veil
// (one internal-res offscreen buffer) is laid on top with light-shaped
// holes carved out by every emitter — so emissive things (staff, bolts,
// gems, candles, boss eyes, explosions) appear to pierce the dark. A
// pooled particle system + a screen-space additive spark layer (drawn
// ABOVE the veil, so feedback never dims) supply the juice. All values
// here are tunable; the FPS governor steps quality down on slow devices.
export const GFX = {
    darkness: {
        enabled: true,
        strength: 0.56,      // veil opacity at screen center (hard cap 0.62)
        color: '#05070c',    // near-black, cool blue
        vignetteBoost: 0.22, // extra darkness baked toward the corners
    },
    lighting: {
        maxLights: 96,       // total light cutouts per frame
        pickupLightCap: 40,  // gem/coin/chest lights capped separately
        colorTint: true,     // faint warm/cool additive bloom in the holes
        tintIntensity: 0.3,
        playerRadius: 360,
        playerIntensity: 1.0,
        projectileRadius: 130,
        gemRadius: 78,
        coinRadius: 70,
        chestRadius: 140,
        candleRadius: 120,
        enemyEyeRadius: 64,
        bossRadius: 260,
        effectRadius: 220,
        burnRadius: 90,      // warm glow under a burning enemy
        hazardRadius: 200,   // boss shockwave ring light
    },
    particles: {
        enabled: true,
        max: 220,            // hard pool cap (preallocated, never grows)
        emberRate: 7,        // ambient embers spawned per second near player
        fog: true,
        fogCount: 14,        // target drifting fog wisps near the player
    },
    // Adaptive quality: the GameLoop already measures fps. Sustained dips
    // step quality down (fewer lights/particles, tint then fog off) and it
    // recovers when fps climbs back. Player/pickup lights + combat sparks
    // are never throttled.
    governor: {
        enabled: true,
        downFps: 52,
        upFps: 58,
        sustainSeconds: 1.0,
    },
};

// Light colors per emitter kind. Hex #rrggbb so the buffer can derive rgba.
export const LIGHT_COLORS = {
    player: '#ffe6b0',
    projectile: '#ffd27a',
    coin: '#ffd166',
    chest: '#ffe08a',
    candle: '#ff9a4a',
    enemyEye: '#ff6a5a',
    boss: '#ff8a5a',
    effect: '#fff0c4',
    gemSmall: '#4ec1ff',
    gemMedium: '#5fe87a',
    gemLarge: '#ff5566',
    // Elemental + hazard light tints.
    fire: '#ff7a33',
    frost: '#7fe0ff',
    shock: '#ffe066',
    hazard: '#ff7a4a',
};

// ── UI / debug defaults ────────────────────────────────────────────────
export const UI = {
    enemyHealthBar: { width: 60, height: 6, marginAboveRadius: 14 },
    playerHealthBar: { width: 80, height: 8, marginAboveSpriteHalf: 16 },
};

export const DEBUG_DEFAULT_ON = true;
