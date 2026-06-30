// Central game configuration.
// All tunable numbers live here so balance changes don't require hunting
// through gameplay code. Named exports are kept beginner-friendly: import
// only the constants you need.

// ── Identity / window ──────────────────────────────────────────────────
export const GAME_TITLE = 'EMBERWAKE — Hold the Last Light';

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
// ── Sprite finishing pass (cache-fill only — never per frame) ───────────
// outline: a dark contour stamped behind every CHARACTER sprite (player +
//   all enemies/bosses) at cache-fill so they read cleanly against busy,
//   dim ground. widthLogical is in authoring units (rasterized × SPRITE_SS);
//   samples is how many offset stamps form the ring (8 = smooth, cheap).
//   Applied ONCE — pickups/decorations/glows/projectiles are left untouched.
// dropShadow: a soft contact ellipse baked under decorations by MapRenderer.
export const SPRITE_FX = {
    outline: {
        enabled: true,
        color: '#0a0d14',     // near-black, faintly cool — matches the dusk palette
        widthLogical: 2.3,    // contour thickness in authoring units
        samples: 8,           // offset stamps around the ring
        alpha: 0.85,          // contour opacity (a touch under solid so it isn't a hard line)
    },
    // Rim light: a soft warm highlight baked onto the top-left edge of every
    // character/enemy sprite at cache-fill (alongside the outline), for more
    // depth + a polished lit-form read. Source-atop so it only touches the
    // art's own pixels; one-time cost, never per render frame.
    rimLight: {
        enabled: true,
        color: '#fff3da',     // warm key light from up-left
        offsetLogical: 1.6,   // how far the lit edge is offset (authoring units)
        alpha: 0.12,          // subtle — a sheen, not a second sprite
    },
    decorationShadow: {
        enabled: true,
        alpha: 0.3,           // contact-shadow opacity under map decorations
        scaleX: 0.4,          // ellipse half-width as a fraction of sprite width
        scaleY: 0.13,         // ellipse half-height (foreshortened ground plane)
        offsetY: 0.32,        // shadow center below sprite center (fraction of height)
        // Only standing props cast a contact shadow; flat ground litter
        // (grass, cracked stone, scattered bones) does not.
        casters: ['rock', 'mushroom', 'skull', 'candle', 'ruin', 'branch'],
    },
};
// World grew (was 4800×2700) for a more explorable map seeded with buildings
// and obstacles. Kept at 16:9 so spawn-ring/camera math stays proportional.
export const WORLD_WIDTH = 7200;
export const WORLD_HEIGHT = 4050;

// Display/backing-store tunables. maxDpr lifts the old hard cap of 2 so
// retina/4K render at true device pixels; maxBackingPx (4K = 3840×2160)
// bounds worst-case full-screen fill cost + guards iOS canvas-area limits.
// maxCoverCrop: when fitting the 16:9 game to a different-aspect screen
// (e.g. a 19.5:9 iPhone), prefer COVER (fill the screen, crop a little) over
// CONTAIN (letterbox bars) as long as the crop stays under this fraction.
// Keeps tall phones edge-to-edge; ultrawide displays still letterbox.
// maxDpr 3 → 2: sprites are already supersampled (SPRITE_SS), so device pixels
// past 2× add little visible sharpness but multiply the full-screen
// darkness/lighting fill cost — a real frame-rate hazard on 4K/retina PCs.
// minDpr lets the FPS governor render BELOW the CSS size (then browser-upscale)
// as a last resort on a fill-rate-bound high-res display, which is the only
// lever that helps a 4K-at-100%-scaling monitor (where dpr is already 1).
export const RENDER = { maxDpr: 2, minDpr: 0.7, maxBackingPx: 3840 * 2160, maxCoverCrop: 0.22 };

// ── Player ─────────────────────────────────────────────────────────────
export const PLAYER = {
    radius: 50,
    // Power-feel pass: base move speed 420 → 460 (~+9.5%, responsive but well
    // under the camera/collision-safe ceiling). i-frames 0.70 → 0.80s so fast
    // enemies can't melt the player on contact. maxHp stays 100.
    speed: 460,
    startX: 0,
    startY: 0,
    pickupRange: 120,
    maxHp: 100,
    invincibilityDuration: 0.8,
    hitFlashDuration: 0.18,
};

// ── Player power caps / diminishing returns ────────────────────────────
// Late-game flattening. These cap the GLOBAL stacking sources (passives +
// permanent upgrades + gear) so a 20-30 min build stays strong but not
// untouchable. Weapon PER-LEVEL stats (cfg.damage, etc.) are unaffected, so
// individual upgrades still matter. Applied once per frame by Game._applyPlayerCaps.
export const CAPS = {
    damageMul: 3.5,         // global weapon-damage multiplier ceiling
    cooldownMulFloor: 0.40, // cooldowns never drop below 40% of base
    moveSpeed: 760,         // ~1.65× base (camera/collision-safe)
    pickupRange: 900,       // generous but doesn't vacuum the whole map
    regenPerSecond: 6,      // sustained passive regen cap
    healPerSecond: 14,      // TOTAL sustained healing/s (regen + Divine Nova)
};

// ── Player weapon aura (visual only) ───────────────────────────────────
// The glow radiating from the player is driven by the weapons they own +
// their levels + evolutions (see computePlayerAura in weapons.js). Purely
// cosmetic — never touches damage, pickup, or enemy behavior. Intensity and
// radius are CAPPED so the aura never washes out enemies/pickups, and a hard
// brightness ceiling keeps it readable in a crowd.
export const AURA = {
    baseRadius: 150,        // world px at one L1 weapon
    radiusPerWeapon: 14,    // + per additional owned weapon
    radiusPerEvolved: 34,   // + per evolved weapon (stronger presence)
    maxRadius: 300,
    baseIntensity: 0.18,    // additive-glow alpha at one L1 weapon
    perWeapon: 0.03,
    perLevel: 0.006,
    perEvolved: 0.05,
    maxIntensity: 0.5,      // hard brightness cap (readability)
    pulseAmount: 0.16,      // ± fraction for pulsing (electric/evolved) auras
    pulseSpeed: 5.0,
    lightIntensityBonus: 0.18, // max extra player-light intensity from aura
};

// ── Enemies ────────────────────────────────────────────────────────────
export const ENEMY = {
    slime: {
        hp: 34,
        speed: 138,        // chaos pass: trash closes faster so it actually pressures
        radius: 55,
        contactDamage: 11,
        xpValue: 1,
    },
    bat: {
        hp: 20,
        speed: 250,
        radius: 45,
        contactDamage: 10,
        xpValue: 1,
    },
    brute: {
        hp: 95,
        speed: 92,
        radius: 70,
        contactDamage: 18,
        xpValue: 3,
    },
    crawler: {
        hp: 26,
        speed: 205,
        radius: 40,
        contactDamage: 11,
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
        fireInterval: 2.4,   // seconds between shots
        windup: 0.5,         // telegraph time before a shot leaves
        fireRange: 820,      // won't fire beyond this
        projectileSpeed: 450,
        projectileDamage: 13,
    },
    // Burst threat: stalks slowly, then winds up and dashes through the
    // player's last position — punishes standing still.
    charger: {
        hp: 58,
        speed: 74,
        radius: 50,
        contactDamage: 12,
        xpValue: 2,
        behavior: 'charger',
        chargeInterval: 3.1, // seconds between dashes
        windup: 0.55,        // telegraph time before the dash
        triggerRange: 620,   // starts a charge when within this range
        dashSpeed: 760,
        dashDuration: 0.4,
    },
    // Swarm threat: tiny, very fast, very fragile — comes in numbers and
    // punishes a stationary player but dies to a stiff breeze.
    mite: {
        hp: 10,
        speed: 310,
        radius: 28,
        contactDamage: 6,
        xpValue: 1,
        visualScale: 0.55,
    },
    // Anchor threat: huge, slow, and very tanky with heavy contact damage —
    // a wall you must kite around while it lumbers after you.
    juggernaut: {
        hp: 245,
        speed: 52,
        radius: 92,
        contactDamage: 22,
        xpValue: 5,
        visualScale: 1.35,
    },
    // Support threat (Vigil 4+): a frail acolyte that hangs back and regens
    // nearby Hollow — kill it first or the front line never thins. Heal rate +
    // radius are capped so clusters can't become unkillable.
    healer: {
        hp: 78,
        speed: 122,
        radius: 46,
        contactDamage: 6,
        xpValue: 3,
        behavior: 'support',
        support: 'heal',
        keepDistance: 360,     // hangs back from the player like a spitter
        supportRadius: 330,    // heals allies within this radius
        healPerSec: 10,        // HP/sec restored to each ally in range (capped)
        healInterval: 0.5,     // heal pulse cadence
        tint: '#7be08a',
    },
    // Support threat (Vigil 4+): a stout warden that projects a damage-soak
    // bubble onto nearby Hollow. The shield is a flat multiplier with a short
    // refresh, so popping the Shielder instantly drops its protection.
    shielder: {
        hp: 130,
        speed: 96,
        radius: 56,
        contactDamage: 9,
        xpValue: 3,
        behavior: 'support',
        support: 'shield',
        keepDistance: 300,
        supportRadius: 300,
        shieldMul: 0.55,       // allies in range take 55% damage while shielded
        tint: '#7fd0ff',
    },
    // Bosses are still Enemy instances; the `boss: true` flag flips on the
    // boss HP bar, chest drop on death, and lets the constructor pull in
    // bossName + visualScale. They scale with wave just like other enemies.
    vinebackGoliath: {
        hp: 2000,          // tankier so a strong build can't melt it (challenge pass)
        speed: 300,        // fast pursuer — it closes the gap and gets on top of you
        radius: 105,
        contactDamage: 34,
        xpValue: 50,
        boss: true,
        bossName: 'Gravemaw',
        visualScale: 1.85,
        // Apex boss: a ground-heavy fight with a deep, themed kit. The original
        // four moves (slam shockwave, boulder SPIRAL, goring CHARGE, bramble
        // summon) plus FIVE new earth attacks: erupting quake ZONES, a rolling
        // boulder WALL with one gap, homing SPORE seekers, a fast double STOMP,
        // and a wide GORE cone. Plus phase-2 enrage at 50%, continuous low-HP
        // enrage (BOSS.enrage), and one-shot support waves at 75/50/25%.
        behavior: 'apexBoss',
        phase2HpFraction: 0.5,
        // Themed reinforcements (used for the opening group + threshold waves +
        // the Bramble Call summon). Ground-dwellers fit the Goliath's theme.
        supportTypes: { brute: 1, crawler: 2, slime: 2 },
        attacks: [
            // Harder to dodge: bigger/faster slam, a near-full ring of fast
            // boulders, and a quicker goring charge.
            { id: 'slam', kind: 'shockwave', cooldown: 3.3, windup: 0.6, damage: 32, growth: 820, rMax: 640, band: 110 },
            { id: 'boulders', kind: 'fan', cooldown: 4.2, windup: 0.5, count: 11, spread: 3.4, projectileSpeed: 440, projectileDamage: 20, spiral: true, spin: 0.5 },
            { id: 'charge', kind: 'charge', cooldown: 5.5, windup: 0.45, dashSpeed: 780, dashDuration: 0.7 },
            { id: 'bramble', kind: 'summon', cooldown: 11.0, windup: 0.6, summonCount: 3, summonTypes: { crawler: 2, slime: 1 } },
            // ── 5 new earth moves ──
            { id: 'quake', kind: 'zones', cooldown: 8.5, windup: 0.8, count: 5, zoneRadius: 155, spreadRadius: 380, damage: 30, warn: 0.9 },
            { id: 'boulderWall', kind: 'wall', cooldown: 9.0, windup: 0.6, count: 13, spacing: 80, projectileSpeed: 340, projectileDamage: 22, gap: 2 },
            { id: 'spores', kind: 'seekers', cooldown: 9.5, windup: 0.5, count: 4, projectileSpeed: 230, projectileDamage: 16, turnRate: 2.0, maxSpeed: 340, color: '#9ae66e' },
            { id: 'stomp', kind: 'shockwave', cooldown: 7.0, windup: 0.45, damage: 26, growth: 1000, rMax: 520, band: 90 },
            { id: 'gore', kind: 'fan', cooldown: 6.5, windup: 0.4, count: 9, spread: 1.0, projectileSpeed: 520, projectileDamage: 18 },
        ],
        phase2Attacks: ['slam', 'charge'],
    },
    stormwingAlpha: {
        hp: 1350,          // tankier (challenge pass)
        speed: 315,        // aggressive aerial pursuer (was 360 — trimmed; the
                           // 2nd boss read as too fast. Low-HP enrage adds speed back.)
        radius: 80,
        contactDamage: 26,
        xpValue: 35,
        boss: true,
        bossName: 'Vesperwing',
        visualScale: 1.55,
        // Apex boss: a fast aerial fight with a deep, themed kit. The original
        // five moves (full-circle volley, SPIRAL barrage, gust shockwave, diving
        // CHARGE, wing-swarm summon) plus FIVE new storm attacks: dive-bomb
        // landing ZONES, a feather WALL with a gap, homing STORM seekers, a
        // dense rotating CYCLONE, and a tight GALE cone. Plus phase-2 enrage at
        // 50%, continuous low-HP enrage (BOSS.enrage), and support at 75/50/25%.
        behavior: 'apexBoss',
        phase2HpFraction: 0.5,
        supportTypes: { bat: 3, crawler: 1 },
        attacks: [
            // Denser, faster radial volleys + tighter spiral = real weaving needed.
            { id: 'volley', kind: 'fan', cooldown: 2.8, windup: 0.45, count: 18, spread: 6.2832 /* TWO_PI: full-circle radial */, projectileSpeed: 470, projectileDamage: 15 },
            { id: 'spiral', kind: 'fan', cooldown: 4.0, windup: 0.4, count: 12, spread: 6.2832, projectileSpeed: 400, projectileDamage: 13, spiral: true, spin: 0.6 },
            { id: 'gust', kind: 'shockwave', cooldown: 4.8, windup: 0.45, damage: 24, growth: 740, rMax: 540, band: 95 },
            { id: 'dive', kind: 'charge', cooldown: 5.2, windup: 0.4, dashSpeed: 900, dashDuration: 0.55 },
            { id: 'wingswarm', kind: 'summon', cooldown: 11.0, windup: 0.5, summonCount: 3, summonTypes: { bat: 3 } },
            // ── 5 new storm moves ──
            { id: 'tempest', kind: 'zones', cooldown: 8.0, windup: 0.7, count: 6, zoneRadius: 135, spreadRadius: 430, damage: 24, warn: 0.8 },
            { id: 'featherWall', kind: 'wall', cooldown: 8.5, windup: 0.5, count: 15, spacing: 66, projectileSpeed: 420, projectileDamage: 16, gap: 2 },
            { id: 'stormSeekers', kind: 'seekers', cooldown: 9.0, windup: 0.45, count: 5, projectileSpeed: 280, projectileDamage: 13, turnRate: 2.4, maxSpeed: 430, color: '#7fd0ff' },
            { id: 'cyclone', kind: 'fan', cooldown: 6.0, windup: 0.4, count: 22, spread: 6.2832, projectileSpeed: 430, projectileDamage: 13, spiral: true, spin: 0.4 },
            { id: 'gale', kind: 'fan', cooldown: 5.5, windup: 0.35, count: 7, spread: 0.7, projectileSpeed: 560, projectileDamage: 15 },
        ],
        phase2Attacks: ['volley', 'dive'],
    },
    // Third boss — the climax. A grinning, many-armed orb (the "Cacklemaw")
    // with the deepest kit in the game: a cackling radial burst, a ground gnash
    // shockwave, drooling delayed-AoE pools, a tentacle WALL, homing gaze motes,
    // a goring lunge, a turning spiral cackle, and a spawnling SUMMON. Slowest
    // mover but tankiest + biggest, and it only appears as the 3rd encounter so
    // the per-encounter tier (×2.6 HP) makes it the hardest fight by far.
    gloomMaw: {
        hp: 1800,
        speed: 285,
        radius: 120,
        contactDamage: 32,
        xpValue: 70,
        boss: true,
        bossName: 'Cacklemaw',
        visualScale: 2.05,
        behavior: 'apexBoss',
        phase2HpFraction: 0.5,
        supportTypes: { mite: 2, bat: 2, crawler: 1 },
        attacks: [
            { id: 'cackle', kind: 'fan', cooldown: 3.0, windup: 0.5, count: 20, spread: 6.2832, projectileSpeed: 440, projectileDamage: 16 },
            { id: 'gnash', kind: 'shockwave', cooldown: 4.0, windup: 0.5, damage: 30, growth: 900, rMax: 600, band: 110 },
            { id: 'spiralCackle', kind: 'fan', cooldown: 5.0, windup: 0.4, count: 16, spread: 6.2832, projectileSpeed: 420, projectileDamage: 14, spiral: true, spin: 0.5 },
            { id: 'lunge', kind: 'charge', cooldown: 6.0, windup: 0.45, dashSpeed: 820, dashDuration: 0.6 },
            { id: 'drool', kind: 'zones', cooldown: 7.5, windup: 0.8, count: 6, zoneRadius: 150, spreadRadius: 420, damage: 28, warn: 0.85 },
            { id: 'lash', kind: 'wall', cooldown: 8.0, windup: 0.55, count: 15, spacing: 74, projectileSpeed: 380, projectileDamage: 20, gap: 2 },
            { id: 'gaze', kind: 'seekers', cooldown: 8.5, windup: 0.5, count: 6, projectileSpeed: 250, projectileDamage: 15, turnRate: 2.4, maxSpeed: 380, color: '#cdb3ff' },
            { id: 'spawnlings', kind: 'summon', cooldown: 12.0, windup: 0.6, summonCount: 4, summonTypes: { mite: 3, bat: 2 } },
        ],
        phase2Attacks: ['cackle', 'lunge'],
    },

    // ══ MAP 2 — The Frozen Waste (snow). Three frost bosses, a step tougher
    // than map 1's trio (the per-map tier multiplies HP/damage/speed on top). ══
    rimewarden: {
        hp: 2200, speed: 292, radius: 100, contactDamage: 30, xpValue: 54, boss: true,
        bossName: 'Rimewarden', visualScale: 1.9, behavior: 'apexBoss', phase2HpFraction: 0.5,
        supportTypes: { brute: 1, crawler: 2, slime: 1 },
        attacks: [
            { id: 'iceSlam', kind: 'shockwave', cooldown: 3.2, windup: 0.55, damage: 32, growth: 860, rMax: 660, band: 115 },
            { id: 'shardFan', kind: 'fan', cooldown: 3.8, windup: 0.45, count: 13, spread: 3.2, projectileSpeed: 450, projectileDamage: 18 },
            { id: 'glacialCharge', kind: 'charge', cooldown: 5.2, windup: 0.45, dashSpeed: 800, dashDuration: 0.65 },
            { id: 'frostZones', kind: 'zones', cooldown: 8.0, windup: 0.8, count: 6, zoneRadius: 150, spreadRadius: 400, damage: 28, warn: 0.85 },
            { id: 'blizzard', kind: 'seekers', cooldown: 9.0, windup: 0.5, count: 5, projectileSpeed: 250, projectileDamage: 15, turnRate: 2.2, maxSpeed: 380, color: '#aef0ff' },
            { id: 'iceWall', kind: 'wall', cooldown: 8.5, windup: 0.6, count: 14, spacing: 74, projectileSpeed: 360, projectileDamage: 20, gap: 2 },
            { id: 'rimeCall', kind: 'summon', cooldown: 11.0, windup: 0.6, summonCount: 3, summonTypes: { crawler: 2, slime: 1 } },
        ],
        phase2Attacks: ['iceSlam', 'glacialCharge'],
    },
    hoarfang: {
        hp: 1650, speed: 330, radius: 84, contactDamage: 26, xpValue: 42, boss: true,
        bossName: 'Hoarfang', visualScale: 1.6, behavior: 'apexBoss', phase2HpFraction: 0.5,
        supportTypes: { bat: 2, crawler: 2 },
        attacks: [
            { id: 'frostBreath', kind: 'fan', cooldown: 3.0, windup: 0.4, count: 9, spread: 0.9, projectileSpeed: 540, projectileDamage: 16 },
            { id: 'icicleVolley', kind: 'fan', cooldown: 3.6, windup: 0.45, count: 18, spread: 6.2832, projectileSpeed: 440, projectileDamage: 14 },
            { id: 'freezePools', kind: 'zones', cooldown: 7.5, windup: 0.75, count: 6, zoneRadius: 140, spreadRadius: 430, damage: 26, warn: 0.8 },
            { id: 'tailSweep', kind: 'shockwave', cooldown: 4.6, windup: 0.45, damage: 26, growth: 780, rMax: 560, band: 100 },
            { id: 'icicleWall', kind: 'wall', cooldown: 8.0, windup: 0.5, count: 15, spacing: 68, projectileSpeed: 420, projectileDamage: 16, gap: 2 },
            { id: 'lunge', kind: 'charge', cooldown: 5.0, windup: 0.4, dashSpeed: 900, dashDuration: 0.55 },
        ],
        phase2Attacks: ['icicleVolley', 'lunge'],
    },
    aurorath: {
        hp: 2100, speed: 270, radius: 118, contactDamage: 32, xpValue: 78, boss: true,
        bossName: 'Aurorath', visualScale: 2.05, behavior: 'apexBoss', phase2HpFraction: 0.5,
        supportTypes: { bat: 2, crawler: 1, slime: 1 },
        attacks: [
            { id: 'auroraVolley', kind: 'fan', cooldown: 2.9, windup: 0.45, count: 20, spread: 6.2832, projectileSpeed: 450, projectileDamage: 15 },
            { id: 'cometZones', kind: 'zones', cooldown: 7.0, windup: 0.7, count: 7, zoneRadius: 150, spreadRadius: 440, damage: 30, warn: 0.8 },
            { id: 'crystalWall', kind: 'wall', cooldown: 8.0, windup: 0.55, count: 16, spacing: 70, projectileSpeed: 400, projectileDamage: 19, gap: 2 },
            { id: 'shardSeekers', kind: 'seekers', cooldown: 8.5, windup: 0.5, count: 6, projectileSpeed: 270, projectileDamage: 16, turnRate: 2.4, maxSpeed: 420, color: '#a0ffe0' },
            { id: 'novaShock', kind: 'shockwave', cooldown: 4.0, windup: 0.5, damage: 30, growth: 920, rMax: 620, band: 115 },
            { id: 'spiralAurora', kind: 'fan', cooldown: 5.0, windup: 0.4, count: 16, spread: 6.2832, projectileSpeed: 420, projectileDamage: 14, spiral: true, spin: 0.5 },
            { id: 'wispSummon', kind: 'summon', cooldown: 12.0, windup: 0.6, summonCount: 4, summonTypes: { bat: 3, mite: 2 } },
        ],
        phase2Attacks: ['auroraVolley', 'novaShock'],
    },

    // ══ MAP 3 — The Sunless Night (undead/void). Tougher again. ══
    ossuar: {
        hp: 2600, speed: 300, radius: 106, contactDamage: 34, xpValue: 60, boss: true,
        bossName: 'Ossuar', visualScale: 1.95, behavior: 'apexBoss', phase2HpFraction: 0.5,
        supportTypes: { brute: 1, crawler: 2, mite: 2 },
        attacks: [
            { id: 'boneFan', kind: 'fan', cooldown: 3.0, windup: 0.45, count: 15, spread: 3.6, projectileSpeed: 470, projectileDamage: 19 },
            { id: 'graveQuake', kind: 'zones', cooldown: 7.5, windup: 0.8, count: 7, zoneRadius: 155, spreadRadius: 410, damage: 32, warn: 0.85 },
            { id: 'boneWall', kind: 'wall', cooldown: 8.0, windup: 0.6, count: 16, spacing: 72, projectileSpeed: 380, projectileDamage: 22, gap: 2 },
            { id: 'reapCharge', kind: 'charge', cooldown: 5.0, windup: 0.45, dashSpeed: 840, dashDuration: 0.7 },
            { id: 'skullSeekers', kind: 'seekers', cooldown: 8.5, windup: 0.5, count: 6, projectileSpeed: 250, projectileDamage: 17, turnRate: 2.2, maxSpeed: 400, color: '#e8f0d8' },
            { id: 'graveStomp', kind: 'shockwave', cooldown: 4.2, windup: 0.5, damage: 30, growth: 940, rMax: 600, band: 110 },
            { id: 'raiseDead', kind: 'summon', cooldown: 11.0, windup: 0.6, summonCount: 4, summonTypes: { crawler: 2, mite: 2 } },
        ],
        phase2Attacks: ['boneFan', 'reapCharge'],
    },
    mourndrift: {
        hp: 2050, speed: 342, radius: 82, contactDamage: 30, xpValue: 48, boss: true,
        bossName: 'Mourndrift', visualScale: 1.62, behavior: 'apexBoss', phase2HpFraction: 0.5,
        supportTypes: { bat: 3, mite: 1 },
        attacks: [
            { id: 'soulVolley', kind: 'fan', cooldown: 2.8, windup: 0.4, count: 20, spread: 6.2832, projectileSpeed: 460, projectileDamage: 15 },
            { id: 'phantomZones', kind: 'zones', cooldown: 7.0, windup: 0.7, count: 7, zoneRadius: 140, spreadRadius: 440, damage: 28, warn: 0.78 },
            { id: 'spectralSeekers', kind: 'seekers', cooldown: 8.0, windup: 0.45, count: 6, projectileSpeed: 280, projectileDamage: 15, turnRate: 2.6, maxSpeed: 440, color: '#9af0ff' },
            { id: 'wail', kind: 'shockwave', cooldown: 4.2, windup: 0.45, damage: 26, growth: 820, rMax: 580, band: 100 },
            { id: 'scytheWall', kind: 'wall', cooldown: 7.5, windup: 0.5, count: 16, spacing: 66, projectileSpeed: 430, projectileDamage: 17, gap: 2 },
            { id: 'blink', kind: 'charge', cooldown: 4.6, windup: 0.35, dashSpeed: 960, dashDuration: 0.5 },
            { id: 'spiralSouls', kind: 'fan', cooldown: 5.0, windup: 0.4, count: 18, spread: 6.2832, projectileSpeed: 430, projectileDamage: 13, spiral: true, spin: 0.55 },
        ],
        phase2Attacks: ['soulVolley', 'blink'],
    },
    nihagault: {
        hp: 2600, speed: 280, radius: 122, contactDamage: 36, xpValue: 82, boss: true,
        bossName: 'Nihagault', visualScale: 2.1, behavior: 'apexBoss', phase2HpFraction: 0.5,
        supportTypes: { mite: 3, bat: 2, crawler: 1 },
        attacks: [
            { id: 'voidBurst', kind: 'fan', cooldown: 2.8, windup: 0.45, count: 24, spread: 6.2832, projectileSpeed: 460, projectileDamage: 16 },
            { id: 'gravityZones', kind: 'zones', cooldown: 6.8, windup: 0.75, count: 8, zoneRadius: 150, spreadRadius: 440, damage: 32, warn: 0.78 },
            { id: 'abyssWall', kind: 'wall', cooldown: 7.5, windup: 0.55, count: 17, spacing: 68, projectileSpeed: 400, projectileDamage: 21, gap: 2 },
            { id: 'voidSeekers', kind: 'seekers', cooldown: 8.0, windup: 0.5, count: 7, projectileSpeed: 270, projectileDamage: 17, turnRate: 2.6, maxSpeed: 430, color: '#d06bff' },
            { id: 'collapse', kind: 'shockwave', cooldown: 4.0, windup: 0.5, damage: 32, growth: 980, rMax: 640, band: 120 },
            { id: 'spiralVoid', kind: 'fan', cooldown: 5.0, windup: 0.4, count: 20, spread: 6.2832, projectileSpeed: 430, projectileDamage: 14, spiral: true, spin: 0.5 },
            { id: 'devour', kind: 'charge', cooldown: 5.5, windup: 0.45, dashSpeed: 860, dashDuration: 0.6 },
            { id: 'spawnShades', kind: 'summon', cooldown: 12.0, windup: 0.6, summonCount: 4, summonTypes: { mite: 3, bat: 2 } },
        ],
        phase2Attacks: ['voidBurst', 'collapse'],
    },

    // ══ MAP 4 — The Sunscorch Expanse (desert). The hardest trio; Solnakh is
    // the game's final boss. ══
    dunescourge: {
        hp: 3000, speed: 310, radius: 108, contactDamage: 36, xpValue: 66, boss: true,
        bossName: 'Dunescourge', visualScale: 1.95, behavior: 'apexBoss', phase2HpFraction: 0.5,
        supportTypes: { brute: 1, crawler: 2, charger: 1 },
        attacks: [
            { id: 'sandBlast', kind: 'fan', cooldown: 2.9, windup: 0.45, count: 16, spread: 3.6, projectileSpeed: 480, projectileDamage: 20 },
            { id: 'quicksand', kind: 'zones', cooldown: 7.0, windup: 0.75, count: 8, zoneRadius: 155, spreadRadius: 420, damage: 32, warn: 0.8 },
            { id: 'duneWall', kind: 'wall', cooldown: 7.5, windup: 0.55, count: 17, spacing: 70, projectileSpeed: 400, projectileDamage: 22, gap: 2 },
            { id: 'goreCharge', kind: 'charge', cooldown: 4.8, windup: 0.4, dashSpeed: 880, dashDuration: 0.7 },
            { id: 'sandstorm', kind: 'seekers', cooldown: 8.0, windup: 0.5, count: 7, projectileSpeed: 270, projectileDamage: 17, turnRate: 2.4, maxSpeed: 420, color: '#ffe09a' },
            { id: 'burrowStomp', kind: 'shockwave', cooldown: 4.0, windup: 0.45, damage: 30, growth: 980, rMax: 620, band: 110 },
            { id: 'broodCall', kind: 'summon', cooldown: 11.0, windup: 0.6, summonCount: 4, summonTypes: { crawler: 3, charger: 1 } },
        ],
        phase2Attacks: ['sandBlast', 'goreCharge'],
    },
    cindermaw: {
        hp: 2450, speed: 340, radius: 88, contactDamage: 34, xpValue: 52, boss: true,
        bossName: 'Cindermaw', visualScale: 1.65, behavior: 'apexBoss', phase2HpFraction: 0.5,
        supportTypes: { bat: 2, spitter: 1, crawler: 1 },
        attacks: [
            { id: 'magmaVolley', kind: 'fan', cooldown: 2.7, windup: 0.4, count: 20, spread: 6.2832, projectileSpeed: 460, projectileDamage: 16 },
            { id: 'lavaZones', kind: 'zones', cooldown: 6.8, windup: 0.7, count: 8, zoneRadius: 145, spreadRadius: 440, damage: 30, warn: 0.75 },
            { id: 'emberSeekers', kind: 'seekers', cooldown: 7.8, windup: 0.45, count: 6, projectileSpeed: 290, projectileDamage: 16, turnRate: 2.6, maxSpeed: 450, color: '#ffae5a' },
            { id: 'fireShock', kind: 'shockwave', cooldown: 4.0, windup: 0.45, damage: 28, growth: 880, rMax: 600, band: 105 },
            { id: 'obsidianWall', kind: 'wall', cooldown: 7.5, windup: 0.5, count: 16, spacing: 66, projectileSpeed: 440, projectileDamage: 18, gap: 2 },
            { id: 'fireLunge', kind: 'charge', cooldown: 4.6, windup: 0.38, dashSpeed: 940, dashDuration: 0.55 },
            { id: 'spiralFlame', kind: 'fan', cooldown: 5.0, windup: 0.4, count: 18, spread: 6.2832, projectileSpeed: 440, projectileDamage: 14, spiral: true, spin: 0.55 },
        ],
        phase2Attacks: ['magmaVolley', 'fireLunge'],
    },
    solnakh: {
        hp: 3100, speed: 286, radius: 124, contactDamage: 40, xpValue: 90, boss: true,
        bossName: 'Solnakh', visualScale: 2.15, behavior: 'apexBoss', phase2HpFraction: 0.5,
        supportTypes: { brute: 1, spitter: 1, bat: 2, mite: 2 },
        attacks: [
            { id: 'solarVolley', kind: 'fan', cooldown: 2.6, windup: 0.45, count: 26, spread: 6.2832, projectileSpeed: 470, projectileDamage: 17 },
            { id: 'scorchZones', kind: 'zones', cooldown: 6.5, windup: 0.7, count: 9, zoneRadius: 155, spreadRadius: 450, damage: 34, warn: 0.75 },
            { id: 'blazeWall', kind: 'wall', cooldown: 7.0, windup: 0.5, count: 18, spacing: 66, projectileSpeed: 420, projectileDamage: 23, gap: 2 },
            { id: 'mirageSeekers', kind: 'seekers', cooldown: 7.5, windup: 0.45, count: 8, projectileSpeed: 280, projectileDamage: 18, turnRate: 2.6, maxSpeed: 450, color: '#ff9a3c' },
            { id: 'supernova', kind: 'shockwave', cooldown: 4.0, windup: 0.55, damage: 36, growth: 1040, rMax: 680, band: 125 },
            { id: 'spiralSun', kind: 'fan', cooldown: 4.8, windup: 0.4, count: 22, spread: 6.2832, projectileSpeed: 440, projectileDamage: 15, spiral: true, spin: 0.5 },
            { id: 'sunLunge', kind: 'charge', cooldown: 5.0, windup: 0.4, dashSpeed: 900, dashDuration: 0.6 },
            { id: 'moteSummon', kind: 'summon', cooldown: 12.0, windup: 0.6, summonCount: 5, summonTypes: { mite: 3, bat: 2 } },
        ],
        phase2Attacks: ['solarVolley', 'supernova'],
    },
};

// Boss spawn schedule + spawn placement.
export const BOSS = {
    // Longer gap between bosses so the player has time to clear waves, level up,
    // and build a loadout before the next apex fight (was 120s).
    spawnInterval: 160,
    // Only ONE boss is ever alive; a scheduled spawn waits while one lives.
    // After a boss dies, the next can't appear for postDeathCooldown seconds
    // (prevents back-to-back bosses when a boss is killed late).
    postDeathCooldown: 45,
    spawnRingDistance: 1100,
    // Encounter order: Gravemaw → Vesperwing → Cacklemaw (the climax 3rd boss),
    // then it cycles. The per-encounter tier makes each successive boss tougher.
    types: ['vinebackGoliath', 'stormwingAlpha', 'gloomMaw'],
    // Late-game survivability. Boss HP scales with the run minute much harder
    // than trash (so a 20-30 min boss isn't deleted instantly), and a mild
    // flat damage resistance ramps with time. Never invulnerable — just tanky.
    //   bossHpMul = 1 + minutes * hpPerMinute  (10m→3.0×, 20m→5.0×, 30m→7.0×)
    //   resist    = min(minutes * resistPerMinute, maxResist)
    // 0.20 (was 0.16) so the 10-15 min boss is a real fight, not a 1s delete,
    // while 30 min lands exactly on the 7× ceiling.
    hpPerMinute: 0.20,
    maxHpMul: 7.0,
    // Damage RESISTANCE is the one stat that directly cancels a player's
    // damage investment — so a heavily-geared/grinded build feels like it "got
    // nothing" if the boss just soaks more. Kept LOW (was 0.012/min → 0.35 cap)
    // so gear + permanent upgrades visibly shred bosses faster; the fight stays
    // challenging through HP scaling (which in-run leveling AND gear both beat),
    // never through nullifying damage. Now ~half: 30m boss soaks 18%, not 35%.
    resistPerMinute: 0.006,
    maxResist: 0.18,
    // A boss is a telegraphed EVENT: a warning window (BOSS INCOMING) lets the
    // player reposition before it lands. It arrives with a themed opening
    // group, and crossing 75 / 50 / 25% HP each fires ONE support wave + ramps
    // aggression. All support spawns respect the live enemy cap so a boss wave
    // pressures without flooding.
    warningDuration: 3.0,        // seconds of "BOSS INCOMING" before it spawns
    // Boss = the main event: the normal swarm is paused during the fight and
    // only a small themed escort appears, so the player duels the boss instead
    // of being buried in adds.
    openingSupport: 2,           // themed minions that arrive with the boss
    thresholdSupport: { t75: 2, t50: 2, t25: 3 },
    // Attack-cooldown multiplier at each HP threshold (lower = faster attacks).
    thresholdCadence: { t75: 0.85, t50: 0.7, t25: 0.55 },
    // CONTINUOUS low-HP enrage (on top of the discrete thresholds above): as a
    // boss is worn down, it gets smoothly faster, hits harder, and attacks more
    // often — so the closer it is to death the more frantic and dangerous the
    // fight becomes. enrageT ramps 0 (full HP) → 1 (dead) and scales:
    //   move speed   ×(1 + enrageT·speedBonus)
    //   contact dmg  ×(1 + enrageT·damageBonus)
    //   attack cd    ×(1 − enrageT·cadenceCut)   (lower = faster)
    enrage: { speedBonus: 0.5, damageBonus: 0.45, cadenceCut: 0.4 },
    supportRing: 360,            // spawn radius for support around the boss
    // Boss ARENA: when a boss spawns, the fight is sealed into a circular arena
    // (smaller than the world) centered on the player. Both the player AND the
    // boss are confined to it, so you can't just run away and plink — you have
    // to dodge the boss in close quarters. Lifts on boss death.
    arenaRadius: 1120,           // confinement radius (world px) — roomier so the fight has space, still < the map
    arenaSpawnDistance: 720,     // boss spawns this far from player (inside the ring)
    arenaColor: '#ff5a3c',       // boundary ring tint
    // In-world presence (drawn by Enemy.draw for bosses only): a broad
    // ground shadow + a slow ominous aura halo behind the sprite so an apex
    // predator reads as a major threat. Both use cached sprites — no
    // per-frame gradients. Colors are prewarmed (see PARTICLE_GLOW_COLORS).
    presence: {
        shadowAlpha: 0.5,        // ground-shadow opacity under the boss
        shadowScale: 1.35,       // shadow half-width vs the boss sprite radius
        auraColor: '#b41f2e',    // deep crimson menace
        auraColorEnraged: '#ff5a3c', // hotter once phase-2 enrage latches
        auraScale: 1.55,         // aura radius vs the boss sprite radius
        auraAlpha: 0.3,          // base additive aura opacity (pulses ±0.12)
    },
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
    // Lowered 0.15 → 0.10: with elite chance ramping up late, 15% chest rolls
    // per elite produced runaway weapon/passive upgrade flow. Boss chests stay
    // guaranteed (handled separately in Game).
    eliteDropChance: 0.10,
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
    // Elites were SLOWER than the trash around them (0.85), so a player could
    // simply walk away from every one — the opposite of a threat. Bumped to
    // 0.95 (still a hair slower so a swift-affix elite still reads as the fast
    // one) and contact damage 1.5 → 1.7 so closing the gap actually stings.
    speedMul: 0.95,
    contactDamageMul: 1.7,
    xpMul: 5,
};

// Rolled affixes layered onto an elite for visible variety + a death/while-
// alive twist. Each elite picks one at random. Colors tint the elite glow.
export const ELITE_AFFIXES = ['swift', 'volatile', 'splitting', 'reflective', 'regenerating', 'frenzied'];
export const AFFIX = {
    // Cancels the elite speed penalty and then some — a fast, evasive elite.
    swift: { tint: '#7fe0ff', speedMul: 1.7 },
    // Detonates on death, dealing AoE to everything nearby.
    volatile: { tint: '#ff9a4a', explodeRadius: 210, explodeDamage: 26 },
    // Bursts into a few crawlers on death.
    splitting: { tint: '#b48cff', spawnType: 'crawler', spawnCount: 3 },
    // Armored — takes much-reduced damage, so it has to be committed to.
    reflective: { tint: '#9fb6d6', damageTakenMul: 0.55 },
    // Slowly heals while alive (fraction of max HP per second) — punish a
    // player who chips it and walks away; burst it down instead.
    regenerating: { tint: '#76e0a0', regenFrac: 0.05 },
    // Berserk — faster than a plain elite and hits noticeably harder.
    frenzied: { tint: '#ff5a7a', speedMul: 1.35, contactMul: 1.4 },
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
        name: 'First Vigil',
        announcement: 'Vigil 1: The Gloam Stirs',
        spawnIntervalMul: 0.95,
        maxAlive: 60,
        typeWeights: { slime: 100 },
        eliteChance: 0,
        healthMul: 1.0,
        speedMul: 1.0,
    },
    {
        index: 1,
        startTime: 60,
        name: 'Duskwings Wake',
        announcement: 'Vigil 2: Duskwings Wake — winged Hollow take flight',
        spawnIntervalMul: 0.80,
        maxAlive: 88,
        typeWeights: { slime: 55, bat: 30, crawler: 20 },
        eliteChance: 0,
        healthMul: 1.1,
        speedMul: 1.05,
    },
    {
        index: 2,
        startTime: 120,
        name: 'Skittering Dark',
        announcement: 'Vigil 3: Skittering Dark — Skitterlings swarm',
        spawnIntervalMul: 0.58,
        maxAlive: 125,
        typeWeights: { slime: 45, bat: 25, crawler: 30, spitter: 15, mite: 18 },
        eliteChance: 0,
        healthMul: 1.2,
        speedMul: 1.10,
    },
    {
        index: 3,
        startTime: 180,
        name: 'Gathering Hollow',
        announcement: 'Vigil 4: Gathering Hollow — the dark presses in',
        spawnIntervalMul: 0.48,
        maxAlive: 140,
        typeWeights: { slime: 35, bat: 25, crawler: 40, spitter: 20, charger: 12, mite: 24, healer: 6 },
        eliteChance: 0.02,
        healthMul: 1.45,
        speedMul: 1.17,
    },
    {
        index: 4,
        startTime: 240,
        name: 'Direhusks March',
        announcement: 'Vigil 5: Direhusks March — the heavy Hollow arrive',
        spawnIntervalMul: 0.52,
        maxAlive: 125,
        typeWeights: { slime: 25, bat: 25, crawler: 25, brute: 25, spitter: 20, charger: 18, mite: 26, juggernaut: 8, healer: 9, shielder: 8 },
        eliteChance: 0.04,
        healthMul: 1.65,
        speedMul: 1.22,
    },
    {
        index: 5,
        startTime: 300,
        name: 'The Long Dark',
        announcement: 'Vigil 6: The Long Dark — hold the light!',
        spawnIntervalMul: 0.44,
        maxAlive: 145,
        typeWeights: { slime: 20, bat: 25, crawler: 25, brute: 30, spitter: 22, charger: 20, mite: 28, juggernaut: 14 },
        eliteChance: 0.08,
        healthMul: 1.9,
        speedMul: 1.28,
    },
];

// Applied on top of the last wave's values; one tick per minute of survival
// past the last wave's startTime. Ramps stay small so progression stays fair.
// Late-game pressure pass: enemies must still threaten strong builds.
// Health/elite/speed ramp steeper, and a NEW contact-damage multiplier kicks
// in after ~15 min total (damageStartMinutesBeyond is measured past the last
// wave's startTime, which is 5 min, so 10 → 15 min total) so late enemies
// actually hurt instead of pinging for minute-1 damage.
export const ENDLESS_SCALING = {
    healthPerMinute: 0.11,
    speedPerMinute: 0.035,
    spawnIntervalShrinkPerMinute: 0.05,
    capGrowthPerMinute: 4,
    eliteChancePerMinute: 0.018,
    // Contact-damage scaling now bites earlier (7 min total vs 15) and ramps
    // harder so late enemies are a real threat to a strong build, not chip.
    damageStartMinutesBeyond: 2,
    damagePerMinute: 0.08,
    maxDamageMultiplier: 3.0,
    // ── TWILIGHT: the late-game climax. A set time past the final wave the
    // horde "turns" — elite chance leaps and climbs toward an elite-army cap
    // (this OVERRIDES the normal maxEliteChance; the run-scale 0.85 ceiling in
    // Game still applies). Makes a deep endless run an earned spectacle.
    twilightMinutesBeyond: 4,
    twilightEliteFloor: 0.55,
    twilightEliteRampPerMin: 0.05,
    twilightEliteCap: 0.9,
};

export const WAVE_LIMITS = {
    maxEnemyCap: 180,
    maxSpeedMultiplier: 2.3,
    maxHealthMultiplier: 7.0,
    maxEliteChance: 0.4,
};

// ── Difficulty tiers (pre-run pick) ──────────────────────────────────────
// A flat multiplier layer folded INTO the wave state each frame (after the
// endless/pressure scaling) + applied to boss HP. Hard grants bonus battle-
// pass XP. Stored as a validated string in the save (NOT in settings{}).
export const DIFFICULTY = {
    easy:   { id: 'easy',   label: 'Recruit', color: '#7fe0a0', hp: 0.70, speed: 0.90, damage: 0.70, elite: 0.6, xpBonus: 0,    desc: 'Gentler foes. For a relaxed run.' },
    normal: { id: 'normal', label: 'Vigil',   color: '#cdd6e2', hp: 1.00, speed: 1.00, damage: 1.00, elite: 1.0, xpBonus: 0,    desc: 'The intended challenge.' },
    hard:   { id: 'hard',   label: 'Nightmare', color: '#ff6a4a', hp: 1.55, speed: 1.12, damage: 1.40, elite: 1.6, xpBonus: 0.5, desc: 'Tougher, faster, more elites. +50% Pass XP.' },
};
export const DIFFICULTY_ORDER = ['easy', 'normal', 'hard'];

// ── Run modifiers / "Trials" (pre-run toggles) ───────────────────────────
// Transient run-only choices (never saved). Each multiplies a wave/player
// scalar and adds a battle-pass-XP + coin bonus as the reward for the extra
// challenge. Combined bonus is capped in Game so stacks can't runaway.
//   wave-side: hp/speed/damage/elite/cap/interval (fold into waveState)
//   player-side: playerDamage / playerPickup / playerIncoming (applied at run start)
export const RUN_MODIFIERS = [
    { id: 'doubleElite', name: 'Elite Hunt',    desc: 'Elites spawn far more often.',        elite: 2.2,        xpBonus: 0.20, coinBonus: 0.15 },
    { id: 'swarm',       name: 'Endless Swarm',  desc: '+35% enemy cap, faster spawns.',      cap: 1.35, interval: 0.78, xpBonus: 0.25, coinBonus: 0.15 },
    { id: 'frenzy',      name: 'Frenzy',         desc: 'Enemies move 20% faster.',            speed: 1.20,       xpBonus: 0.20, coinBonus: 0.10 },
    { id: 'enfeebled',   name: 'Enfeebled',      desc: 'Your weapons deal 15% less damage.',  playerDamage: 0.85, xpBonus: 0.20, coinBonus: 0.15 },
    { id: 'fragile',     name: 'Glass',          desc: 'You take 30% more damage.',           playerIncoming: 1.30, xpBonus: 0.25, coinBonus: 0.15 },
    { id: 'tunnel',      name: 'Tunnel Vision',  desc: 'Pickup range halved.',                playerPickup: 0.5,  xpBonus: 0.15, coinBonus: 0.10 },
];
// Cap on the total run-XP/coin bonus from stacked modifiers (×difficulty).
export const RUN_MODIFIER_MAX_BONUS = 1.0;

// Pressure layers ON TOP of the time-based wave tiers to make a wave feel like
// a thing you must CLEAR, not just outlast. Pressure rises while the field
// fills up and you're NOT thinning it, and falls as you rack up kills — so a
// player who clears fast stays calm while one who lets enemies pile up gets
// squeezed (faster spawns, slightly tougher foes). It's capped and additive, so
// it never breaks the enemy cap or the endless scaling. Resets each wave tier.
export const WAVE_PRESSURE = {
    enabled: true,
    gainPerSecond: 0.07,   // pressure/sec when the field is full (scaled by crowding)
    killRelief: 0.013,     // pressure removed per kill
    max: 1.0,
    crowdRefFraction: 0.5, // field is "full" at this fraction of maxAlive
    // Effects scale linearly with pressure (0 → 1):
    spawnRateBonus: 0.5,   // up to +50% spawn rate  (interval ×(1 − 0.5·p))
    capBonus: 0.3,         // up to +30% to the alive cap
    healthBonus: 0.22,     // up to +22% enemy HP
    speedBonus: 0.1,       // up to +10% enemy speed
    damageBonus: 0.15,     // up to +15% enemy contact damage
};

// Enemy-to-enemy separation (anti-stacking). A soft local push keeps a swarm
// from collapsing into one pixel without forming a rigid wall that blocks the
// map. Runs as one pass per frame over a rebuilt spatial hash so cost stays
// ~O(N) even at the 180-enemy cap. Heavier enemies (bigger radius / bosses)
// barely budge, so small enemies flow AROUND brutes and bosses.
export const ENEMY_SEPARATION = {
    enabled: true,
    cellSize: 120,          // spatial-hash cell (~2× a typical enemy radius)
    overlapFactor: 0.7,     // only push when centers are closer than this × (r1+r2)
    strength: 26,           // push speed (px/s) at full overlap
    maxPush: 60,            // hard cap on per-frame push distance contribution (px/s)
    bossPushResist: 0.12,   // bosses take only this fraction of incoming push
    minCountToRun: 6,       // skip the whole pass when few enemies are alive
};

// ── XP / progression / gems ────────────────────────────────────────────
// Leveling curve. Lowered + flattened so early level-ups come fast (hooks the
// player) and the ramp stays gentle. L1→2 needs `base`; each later level adds
// `perLevel`. base 8 / perLevel 4 gives 8,12,16,20,24,… (was 10 / 6).
// Power-feel pass: base 8 → 6 lowers every threshold by a flat 2 XP
// (6,10,14,18,22,… vs 8,12,16,20,24,…). The effect is heavily front-loaded —
// ~25% faster at the first level-up but only ~2% by L25 — and the +4 per-level
// slope is unchanged, so late leveling pace is effectively the same.
export const XP_CURVE = {
    base: 6,
    perLevel: 4,
    // Late-game pacing: levels up to lateStartLevel are UNCHANGED (early game
    // stays fast/satisfying). Past it, a quadratic term steepens the curve so
    // late power growth is steady, not explosive.
    lateStartLevel: 12,
    lateQuadratic: 1.6,
};

// XP needed to advance from `level` → `level + 1`. Linear early; a quadratic
// term past lateStartLevel slows late leveling without touching the first
// ~12 levels (L13→+2, L20→+102, L30→+518 on top of the linear base).
export function xpRequired(level) {
    const linear = XP_CURVE.base + Math.max(0, level - 1) * XP_CURVE.perLevel;
    const over = Math.max(0, level - XP_CURVE.lateStartLevel);
    return linear + Math.round(over * over * XP_CURVE.lateQuadratic);
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
    // Chaos pass: much weaker knockback so hits don't blow clear gaps in the
    // swarm — regular enemies stay on top of the player and keep pressure on.
    strength: 230,
    timeConstant: 0.07,
};

export const SCREEN_SHAKE = {
    intensity: 24,
    duration: 0.28,
};

export const DAMAGE_NUMBER = {
    lifetime: 0.75,
    riseSpeed: 70,
};

// Kill-streak / combo system. Consecutive kills inside `window` seconds build a
// combo; let the window lapse and it resets. Purely a feedback/dopamine layer
// (an escalating, color-shifting on-screen counter + milestone callouts) — it
// never changes damage or drops, so it can't unbalance a run. Tiers drive the
// HUD color + milestone banners.
export const COMBO = {
    window: 3.0,            // seconds since last kill before the streak drops
    minToShow: 3,           // don't clutter the HUD under this count
    milestones: [10, 25, 50, 100, 200, 350, 500],
    // Count thresholds → HUD color (highest reached wins). Cool→hot as it grows.
    tiers: [
        { at: 0,   color: '#cde4ff' },
        { at: 10,  color: '#7fe0a0' },
        { at: 25,  color: '#ffd166' },
        { at: 50,  color: '#ff9a4a' },
        { at: 100, color: '#ff5a3c' },
        { at: 200, color: '#ff3df0' },
    ],
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
    strength: 0.52,
    innerRadius: 0.3,
    outerRadius: 0.86,
    // Cool near-black corner tint (matches GFX.darkness.color) so the
    // fallback vignette reads as dusk rather than a flat black ring.
    color: '6, 9, 16',
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
