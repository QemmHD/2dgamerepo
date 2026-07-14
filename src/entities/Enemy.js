import {
    ENEMY,
    ELITE,
    ELITE_AFFIXES,
    AFFIX,
    ELEMENT,
    BOSS,
    BOSS_ATTACK,
    LIEUTENANT,
    SPRITE_SIZE,
    HIT_FLASH_DURATION,
    KNOCKBACK,
    UI,
} from '../config/GameConfig.js';
import { TWO_PI, clamp } from '../core/MathUtils.js';
import { Easing } from '../core/Easing.js';
import { getLieutenantSprites } from '../assets/LieutenantSprite.js';
import {
    getSlimeFrames,
    getBatFrames,
    getBruteFrames,
    getCrawlerFrames,
    getVinebackGoliathFrames,
    getStormwingAlphaFrames,
    getGloomMawFrames,
    getRimewardenFrames,
    getHoarfangFrames,
    getAurorathFrames,
    getOssuarFrames,
    getMourndriftFrames,
    getNihagaultFrames,
    getDunescourgeFrames,
    getCindermawFrames,
    getSolnakhFrames,
    getSpitterFrames,
    getChargerFrames,
    getMiteFrames,
    getJuggernautFrames,
    getHealerFrames,
    getShielderFrames,
    getSpeedDemonFrames,
    getDreadhulkFrames,
    getBrawlerFrames,
    getGlowSprite,
    getSoftShadowSprite,
} from '../assets/ProceduralSprites.js';
import { getLpcFrames } from '../assets/LpcSprites.js';
import { getMonsterFrames } from '../assets/MonsterSprites.js';
import { getEnemyAiFrames, getEnemyAiDirFrames } from '../assets/EnemySprites.js';
import { getPixelBossFrames } from '../assets/PixelBosses.js';
import { EnemyProjectile } from './EnemyProjectile.js';
import { drawWorldHealthBar, healthColor } from '../render/DrawUtils.js';
import { drawCachedStatusGlyph, strokeHighContrastPath } from '../render/CombatCues.js';
import { steerEnemyMovement } from '../systems/EnemyNavigation.js';
import {
    BOSS_EXPOSED_DAMAGE_MUL,
    BOSS_PHASE_BREAK_DURATION,
    bossAttackLabel,
    bossRecoveryDuration,
    bossSignatureAttack,
    canStartBossPhaseBreak,
    chooseBossAttack,
    phasePatternFor,
} from '../systems/BossChoreographer.js';

// Frame getters all return a pre-cached array of canvases. Per-type
// animation speed (Hz) — bats flap quickly, brutes breathe slowly.
// How long the spawn-in scale pop lasts (seconds). easeOutBack overshoot.
const SPAWN_POP_DUR = 0.28;
// Airborne creatures don't get a ground contact shadow (they'd read as
// floating over their own shadow). Bosses draw their own presence shadow.
const AIRBORNE_TYPES = new Set(['bat', 'mite', 'bomber', 'teleporter']);

// Plain chasers within this range of the player get the "smarter" chase
// (intercept lead + weave + obstacle steering). Far-off trash keeps the cheap
// straight chase, so the per-frame cost stays bounded at the enemy cap.
const CHASER_BRAIN_RANGE = 1500;

const FRAMES_BY_TYPE = {
    // Imported LPC monster sprites update the original creatures; each falls
    // back to its procedural drawer if the sheet didn't load.
    slime:           { get: () => getEnemyAiFrames('slime') || getMonsterFrames('slime') || getSlimeFrames(), hz: 7 },
    bat:             { get: () => getEnemyAiFrames('bat')     || getMonsterFrames('bat')     || getBatFrames(),     hz: 10 },
    brute:           { get: () => getLpcFrames('orc'), hz: 7, directional: true },
    crawler:         { get: () => getEnemyAiFrames('crawler') || getMonsterFrames('crawler') || getCrawlerFrames(), hz: 9 },
    spitter:         { get: () => getEnemyAiFrames('spitter') || getMonsterFrames('spitter') || getSpitterFrames(), hz: 6 },
    charger:         { get: () => getEnemyAiFrames('charger')    || getChargerFrames(),    hz: 3 },
    mite:            { get: () => getEnemyAiFrames('mite')    || getMonsterFrames('mite')    || getMiteFrames(),    hz: 12 },
    juggernaut:      { get: () => getEnemyAiFrames('juggernaut') || getJuggernautFrames(), hz: 1.2 },
    healer:          { get: () => getEnemyAiFrames('healer')     || getHealerFrames(),     hz: 6 },
    shielder:        { get: () => getEnemyAiFrames('shielder')   || getShielderFrames(),   hz: 3 },
    speedDemon:      { get: () => getEnemyAiFrames('speedDemon') || getSpeedDemonFrames(), hz: 16 },
    // P1.3 behavior types REUSE the canonical creature bodies (slime / bee /
    // eyeball / bat) — identical fallback chains to their hosts, so the
    // procedural drawers stay the safety net. Identity comes from behavior +
    // the procedural tells in draw(), never from new art.
    splitter:        { get: () => getEnemyAiFrames('slime')   || getMonsterFrames('slime')   || getSlimeFrames(),   hz: 5 },
    bomber:          { get: () => getEnemyAiFrames('mite')    || getMonsterFrames('mite')    || getMiteFrames(),    hz: 14 },
    summoner:        { get: () => getEnemyAiFrames('spitter') || getMonsterFrames('spitter') || getSpitterFrames(), hz: 5 },
    teleporter:      { get: () => getEnemyAiFrames('bat')     || getMonsterFrames('bat')     || getBatFrames(),     hz: 11 },
    dreadhulk:       { get: () => getEnemyAiFrames('dreadhulk')  || getDreadhulkFrames(),  hz: 1.1 },
    brawler:         { get: () => getEnemyAiFrames('brawler')    || getBrawlerFrames(),    hz: 4 },
    // Imported LPC humanoid models — directional 8-frame walk cycles.
    skeleton:        { get: () => getLpcFrames('skeleton'),      hz: 9, directional: true },
    zombie:          { get: () => getLpcFrames('zombie'),        hz: 6, directional: true },
    // Ember Warden: an animated 4-direction sheet pre-rendered from a rigged 3D
    // model (Monster_Walk cycle) — falls back to the recolored LPC skeleton.
    emberskeleton:   { get: () => getEnemyAiDirFrames('emberskeleton') || getLpcFrames('emberskeleton'), hz: 10, directional: true },
    // Boss animation Hz roughly doubled so their bodies/wings/maws read as
    // alive and aggressive instead of a slow crawl (the % frames.length wrap
    // makes any Hz index-safe regardless of frame count).
    // Hand-drawn pixel-art bosses (unique per boss), each falling back to its
    // procedural drawer. Low Hz — these are 2-frame idle loops.
    vinebackGoliath: { get: () => getPixelBossFrames('vinebackGoliath') || getVinebackGoliathFrames(), hz: 2.5 },
    stormwingAlpha:  { get: () => getPixelBossFrames('stormwingAlpha')  || getStormwingAlphaFrames(),  hz: 6 },
    gloomMaw:        { get: () => getPixelBossFrames('gloomMaw')        || getGloomMawFrames(),         hz: 3 },
    rimewarden:      { get: () => getPixelBossFrames('rimewarden')      || getRimewardenFrames(),       hz: 2.5 },
    hoarfang:        { get: () => getPixelBossFrames('hoarfang')        || getHoarfangFrames(),         hz: 4 },
    aurorath:        { get: () => getPixelBossFrames('aurorath')        || getAurorathFrames(),         hz: 3 },
    ossuar:          { get: () => getPixelBossFrames('ossuar')          || getOssuarFrames(),           hz: 3 },
    mourndrift:      { get: () => getPixelBossFrames('mourndrift')      || getMourndriftFrames(),       hz: 3 },
    nihagault:       { get: () => getPixelBossFrames('nihagault')       || getNihagaultFrames(),        hz: 4 },
    dunescourge:     { get: () => getPixelBossFrames('dunescourge')     || getDunescourgeFrames(),      hz: 4 },
    cindermaw:       { get: () => getPixelBossFrames('cindermaw')       || getCindermawFrames(),        hz: 5 },
    solnakh:         { get: () => getPixelBossFrames('solnakh')         || getSolnakhFrames(),          hz: 5 },
};

// Construction-time options:
//   healthMul   scales maxHp/hp from the wave director's current state
//   speedMul    scales chase speed from the wave director
//   elite       true → applies ELITE multipliers (hp/size/damage/xp) and
//               flips on a gold halo + brighter tint. canDropChest is set
//               to true so the future chest stage can hook on.
export class Enemy {
    constructor(type, x, y, opts = {}) {
        const def = ENEMY[type];
        if (!def) throw new Error(`Unknown enemy type: ${type}`);
        const frameSpec = FRAMES_BY_TYPE[type];
        if (!frameSpec) throw new Error(`No sprite for enemy type: ${type}`);

        const isBoss = !!def.boss;
        // Elite + boss don't stack — bosses already have their own scale and
        // are guaranteed to drop a chest. If a spawn somehow asks for elite
        // on a boss type, ignore the elite flag.
        const elite = !!opts.elite && !isBoss;
        const waveHpMul = opts.healthMul ?? 1;
        const waveSpdMul = opts.speedMul ?? 1;

        const hpMul = elite ? ELITE.hpMul : 1;
        const eliteSizeMul = elite ? ELITE.sizeMul : 1;
        const spdMul = elite ? ELITE.speedMul : 1;
        // Contact damage = elite bonus × the wave's time-based damage ramp
        // (1.0 until late game; scales after ~15 min so late enemies hurt).
        const dmgMul = (elite ? ELITE.contactDamageMul : 1) * (opts.contactDamageMul ?? 1);
        const xpMul = elite ? ELITE.xpMul : 1;
        const baseScale = def.visualScale ?? 1;

        this.type = type;
        this.name = def.bossName ?? type;
        this.epithet = def.epithet ?? null;   // boss subtitle for the HP bar
        this.tier = def.tier ?? null;          // boss difficulty rung (1/2/3)
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.maxHp = def.hp * waveHpMul * hpMul;
        this.hp = this.maxHp;
        this.speed = def.speed * waveSpdMul * spdMul;
        // Elite grows the hitbox to match its bigger visual. Boss radius
        // already comes from config at the right size, so eliteSizeMul is 1
        // for bosses (elite is force-off for boss types above).
        this.radius = def.radius * eliteSizeMul;
        this.contactDamage = def.contactDamage * dmgMul;
        this.xpValue = def.xpValue * xpMul;

        this.elite = elite;
        this.boss = isBoss;
        // Mild flat damage resistance (bosses only, set by Game at spawn based
        // on the run minute). 0 = takes full damage.
        this.resist = 0;
        this.canDropChest = elite || isBoss;
        this.visualScale = baseScale * eliteSizeMul;

        // Behavior (ranged Spitter / dashing Charger). Plain chasers leave
        // this null and run the default chase. def is kept for behavior
        // params. Attack timers start randomized so a wave doesn't fire in
        // unison.
        this.def = def;
        this.behavior = def.behavior ?? null;
        const baseInterval = def.fireInterval ?? def.chargeInterval ?? 2;
        this.attackTimer = this.behavior ? Math.random() * baseInterval : 0;
        this.windupTimer = 0;
        // Aim direction (toward the player) latched while a spitter/charger winds
        // up, so draw() can paint a directional attack telegraph (the charge arc
        // + chevron). Defaults to "down" before the first wind-up.
        this._windupAimX = 0;
        this._windupAimY = 1;
        this.dashTimer = 0;
        this.dashDirX = 0;
        this.dashDirY = 0;
        // Spitter bolt damage carries the elite contact-damage scaling.
        this.projectileDamage = (def.projectileDamage ?? 0) * dmgMul;
        // Bomber self-detonation damage (same scaling); 0 for everyone else.
        this.blastDamage = (def.blastDamage ?? 0) * dmgMul;
        // Teleporter blink bookkeeping: where the last blink STARTED, so the
        // Game can sparkle both ends of the jump.
        this._blinkFromX = 0;
        this._blinkFromY = 0;

        // Elite affix (rolled only on elites). Swift bumps speed; volatile /
        // splitting are handled by Game at the death site.
        this.affix = null;
        this.affixDef = null;
        this.affixColor = null;
        // damageTakenMul (reflective/armored) scales incoming damage in
        // takeDamage; regenPerSecond (regenerating) is ticked in update.
        this.damageTakenMul = 1;
        this.regenPerSecond = 0;
        if (elite) {
            this.affix = ELITE_AFFIXES[Math.floor(Math.random() * ELITE_AFFIXES.length)];
            this.affixDef = AFFIX[this.affix] ?? null;
            if (this.affixDef) {
                this.affixColor = this.affixDef.tint;
                if (this.affixDef.speedMul) this.speed *= this.affixDef.speedMul;
                if (this.affixDef.contactMul) this.contactDamage *= this.affixDef.contactMul;
                if (this.affixDef.damageTakenMul) this.damageTakenMul = this.affixDef.damageTakenMul;
                if (this.affixDef.regenFrac) this.regenPerSecond = this.maxHp * this.affixDef.regenFrac;
            }
        }

        // Directional (LPC) sprites return { up, left, down, right } frame
        // arrays; draw() picks the row by facing. Non-directional sprites return
        // a single flat array. We always keep this.frames as a flat array (the
        // 'down'/front set for directional) so any flat-frame consumer is safe.
        const raw = frameSpec.get();
        if (frameSpec.directional) {
            this.dirFrames = raw;
            this.frames = raw.down;
            this._facing = 'down';
        } else {
            this.frames = raw;
        }
        this.frameHz = frameSpec.hz;
        // Random phase so adjacent enemies don't animate in lockstep —
        // gives the swarm a more natural, varied motion feel.
        this.animOffset = Math.random() * 1000;
        this.animTimer = this.animOffset;
        // Time since spawn — drives a brief scale-in "pop" so enemies don't
        // blink into existence (easeOutBack overshoot in draw()).
        this.spawnAge = 0;
        this.spriteHalf = SPRITE_SIZE / 2;
        this.active = true;
        this.hitFlashTimer = 0;

        this.knockbackVx = 0;
        this.knockbackVy = 0;
        this.weaponHitCooldown = 0;

        // Weapon-identity status effects (all neutral = behaves as before).
        // slow: chase-speed debuff from Orbiting Blade. shred: armor-shred
        // stacks READ ONLY by Holy Pulse (kept local to that weapon).
        this.slowTimer = 0;
        this.slowMul = 1;
        this.shredTimer = 0;
        this.shredStacks = 0;

        // Elemental statuses (all neutral = identical to pre-element
        // behavior). Kept as flat scalars on every enemy so the hidden class
        // stays monomorphic. FIRE burn is a DoT (damage applied by Game's
        // status pass, not here); FROST chill is a SEPARATE slow channel from
        // slowMul; freeze is a hard stop; SHOCK is a damage-amp read at hit.
        this.burnTimer = 0;
        this.burnDps = 0;
        this.burnTickAccum = 0;
        this.chillTimer = 0;
        this.chillMul = 1;
        this.chillStacks = 0;   // FROST chill stacking — deepens the slow
        this.freezeTimer = 0;
        this.shockTimer = 0;
        this.shockStacks = 0;
        // KINDLED combo latch: SHATTER/BRITTLE can proc at most once per this
        // many seconds per enemy (applyCombo in content/elements.js), so pulse/
        // orbit weapons can't machine-gun a reaction. Decayed in update().
        this._comboCd = 0;

        // Shielder support: a transient damage-soak granted by a nearby Shielder
        // (Game refreshes shieldTimer while in range). shieldMul < 1 reduces
        // incoming damage. Healer support is applied directly to hp by Game.
        this.shieldTimer = 0;
        this.shieldMul = 1;
        // Support behaviors throttle their own pulses (heal cadence).
        this._healAccum = 0;

        // Allocation-free local navigation state. The deterministic side seed
        // splits a pack around both sides of cover; _navHold keeps that choice
        // stable long enough to round a house instead of flip-flopping at it.
        const navSeed = (Math.trunc(x) * 73856093) ^ (Math.trunc(y) * 19349663) ^ type.charCodeAt(0);
        this._navSide = (navSeed & 1) ? 1 : -1;
        this._navHold = 0;
        this._navMoveX = 0;
        this._navMoveY = 0;

        // Apex-boss state machine (only bosses carry it). Phase-2 latches at
        // def.phase2HpFraction; attackTimers are seeded randomly so a fresh
        // boss doesn't fire instantly and two bosses desync.
        if (isBoss) {
            this.phase = 1;
            this.phase2Entered = false;
            this.phase2Pending = false;
            this.enrageShouted = false;
            this.bossWindupTimer = 0;
            this.bossWindupDuration = 0;
            this.activeAttack = null;
            this.activeAttackLabel = null;
            this.attackTimers = {};
            this._bossOut = null;
            // Deterministic choreography + readable post-attack openings.
            this.bossAttackCursor = 0;
            this.bossLastAttackId = null;
            this.bossLastAttackKind = null;
            this.bossForcedAttack = null;
            this.bossRecoveryTimer = 0;
            this.bossRecoveryDuration = 0;
            this.bossPendingRecovery = 0;
            this.bossPhaseBreakTimer = 0;
            // Attack-cadence multiplier (Game lowers it at HP thresholds so a
            // wounded boss attacks faster) + one-shot HP-threshold latches
            // (75/50/25%) the Game polls to fire support waves + ramp aggression.
            this.bossCadenceMul = 1;
            this.thresholds = { t75: false, t50: false, t25: false };
            // Continuous low-HP enrage scalar (0 at full HP → 1 at death), set
            // each frame by runBossAI. Scales move speed (Enemy.update), attack
            // cadence (runBossAI), and contact damage (off baseContactDamage).
            this.enrageT = 0;
            this.baseContactDamage = this.contactDamage;
            // Charge-attack lunge state + a rotating phase for spiral barrages.
            this.bossDashTimer = 0;
            this.bossDashSpeed = 0;
            this.bossDashDirX = 0;
            this.bossDashDirY = 0;
            // Charge heading locked at TELEGRAPH time (so the lunge follows the
            // warned lane exactly — no re-aim at commit). null = not aimed yet.
            this.bossChargeDirX = null;
            this.bossChargeDirY = null;
            this.spiralPhase = 0;
            if (Array.isArray(def.attacks)) {
                for (const a of def.attacks) {
                    this.attackTimers[a.id] = Math.random() * a.cooldown;
                }
            }
        }
    }

    // Orbiting Blade stamp. Deepest slow wins; longest duration refreshes
    // (never additive, so repeated hits can't compound into a freeze).
    // Bosses are floored so they're nudged, never trivialized.
    applySlow(mul, dur) {
        const m = this.boss ? Math.max(mul, 0.85) : mul;
        if (this.slowTimer <= 0 || m < this.slowMul) this.slowMul = m;
        if (dur > this.slowTimer) this.slowTimer = dur;
    }

    // Holy Pulse stamp. Increments one stack up to a per-level cap and
    // refreshes the decay timer. The per-stack % lives in the weapon cfg
    // and is read at damage time, so shred never leaks to other weapons.
    applyShred(maxStacks, dur) {
        if (this.shredStacks < maxStacks) this.shredStacks += 1;
        this.shredTimer = dur;
    }

    // ── Elemental status stamps ──────────────────────────────────────────
    // FROST chill: own slow channel (never touches slowMul). Deepest wins,
    // longest refreshes. Bosses are floored so they're only nudged.
    applyChill(mul, dur) {
        const m = this.boss ? Math.max(mul, 0.80) : mul;
        // Reset stacks if chill had lapsed, then add one (capped). Each frost
        // hit while already chilled deepens the slow (see chillK in update).
        if (this.chillTimer <= 0) { this.chillMul = m; this.chillStacks = 1; }
        else {
            if (m < this.chillMul) this.chillMul = m;          // deepest base wins
            if (this.chillStacks < ELEMENT.frost.chillMaxStacks) this.chillStacks += 1;
        }
        if (dur > this.chillTimer) this.chillTimer = dur;
    }

    // FROST freeze: hard stop. Bosses are freeze-EXEMPT (no permafreeze).
    applyFreeze(dur) {
        if (this.boss) return;
        if (dur > this.freezeTimer) this.freezeTimer = dur;
    }

    // SHOCK: stacking damage-amp (applyShred clone). Read at hit time, so it
    // auto-floors on bosses without any CC. Refreshes the decay timer.
    applyShock(maxStacks, dur) {
        if (this.shockStacks < maxStacks) this.shockStacks += 1;
        this.shockTimer = dur;
    }

    // FIRE burn: refresh-deepest-dps-wins, longest refreshes, never additive
    // (so repeated stamps can't runaway). Damage itself is applied by Game's
    // status pass, which owns the tick accumulator.
    applyBurn(dps, dur) {
        if (dps > this.burnDps || this.burnTimer <= 0) this.burnDps = dps;
        if (dur > this.burnTimer) this.burnTimer = dur;
    }

    update(dt, player, enemyProjectiles, obstacleSystem = null) {
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const len = Math.hypot(dx, dy) || 0.0001;
        const nx = dx / len;
        const ny = dy / len;

        // Slow + chill are two independent transient channels, both folded
        // into a local scalar — never mutate this.speed (so wave/elite scaling
        // stays intact and the debuffs reverse cleanly). Deepest-per-channel
        // wins within each; the product is the move speed.
        const slowK = this.slowTimer > 0 ? this.slowMul : 1;
        // Chill deepens with stacks: base slow, minus chillPerStack for each
        // stack beyond the first, floored so chill alone never fully freezes.
        // Bosses floor at their base (chillMul), so stacks can't deepen them —
        // they stay "only nudged" as before.
        const chillFloor = this.boss ? this.chillMul : ELEMENT.frost.chillFloor;
        const chillK = this.chillTimer > 0
            ? Math.max(chillFloor, this.chillMul - (this.chillStacks - 1) * ELEMENT.frost.chillPerStack)
            : 1;
        let moveX = nx;        // default plain chase
        let moveY = ny;
        let spd = this.speed * slowK * chillK;

        // FROST freeze is the only hard stop: zero movement AND gate every
        // behavior branch so a frozen enemy can't advance an attack timer,
        // fire mid-windup, finish a dash, or commit a boss special.
        const frozen = this.freezeTimer > 0;
        if (frozen) { moveX = 0; moveY = 0; spd = 0; }

        // Smarter boss chase: instead of homing on the player's CURRENT spot,
        // a boss leads their movement and steers toward where they're GOING, so
        // it cuts the player off in the arena instead of trailing behind them.
        // (Plain enemies keep the simple chase; a target without velocity — e.g.
        // a test stub — falls back to a straight chase.)
        if (this.boss && !frozen) {
            const lead = bossLead(this, player, len);
            moveX = lead.x; moveY = lead.y;
        }

        if (!frozen && this.behavior === 'spitter') {
            // Hold a firing gap: retreat if too close, approach if too far.
            const kd = this.def.keepDistance;
            if (len < kd - 40) { moveX = -nx; moveY = -ny; }
            else if (len > kd + 80) { moveX = nx; moveY = ny; }
            else { moveX = 0; moveY = 0; }

            this.attackTimer -= dt;
            if (this.windupTimer > 0) {
                this.windupTimer -= dt;
                moveX = 0; moveY = 0; // brace + telegraph while charging a shot
                this._windupAimX = nx; this._windupAimY = ny; // track the player
                if (this.windupTimer <= 0 && enemyProjectiles) {
                    const ps = this.def.projectileSpeed;
                    enemyProjectiles.push(
                        new EnemyProjectile(this.x, this.y, nx * ps, ny * ps, this.projectileDamage, {
                            sourceLabel: { label: this.def.label ?? this.name, epithet: this.epithet, boss: this.boss },
                        })
                    );
                }
            } else if (this.attackTimer <= 0 && len <= this.def.fireRange &&
                       (!obstacleSystem || obstacleSystem.hasLineOfSight(this.x, this.y, player.x, player.y))) {
                this.windupTimer = this.def.windup;
                this._windupAimX = nx; this._windupAimY = ny;
                this.attackTimer = this.def.fireInterval;
            }
        } else if (!frozen && this.behavior === 'charger') {
            this.attackTimer -= dt;
            if (this.dashTimer > 0) {
                // Mid-dash: travel along the locked direction at dash speed.
                this.dashTimer -= dt;
                moveX = this.dashDirX; moveY = this.dashDirY;
                spd = this.def.dashSpeed * slowK * chillK;
            } else if (this.windupTimer > 0) {
                this.windupTimer -= dt;
                moveX = 0; moveY = 0; // brace before the lunge
                this._windupAimX = nx; this._windupAimY = ny; // track the player
                if (this.windupTimer <= 0) {
                    this.dashDirX = nx;  // lock aim at dash start, then commit
                    this.dashDirY = ny;
                    this.dashTimer = this.def.dashDuration;
                }
            } else if (this.attackTimer <= 0 && len <= this.def.triggerRange &&
                       (!obstacleSystem || !obstacleSystem.movementBlocked(
                           this.x, this.y,
                           this.x + nx * Math.min(len, this.def.dashSpeed * this.def.dashDuration + this.radius),
                           this.y + ny * Math.min(len, this.def.dashSpeed * this.def.dashDuration + this.radius),
                           this.radius * 0.92,
                       ))) {
                this.windupTimer = this.def.windup;
                this._windupAimX = nx; this._windupAimY = ny;
                this.attackTimer = this.def.chargeInterval;
            }
        } else if (!frozen && this.behavior === 'bomber') {
            // Kamikaze (P1.3): sprint straight in, then PLANT and wind up a
            // self-detonation. The Game observes the windup transitions — it
            // paints the blast circle (a delayedZone in the hazard pool) at
            // plant time and pops the bee at commit, so both the dodge and
            // the damage ride the proven boss-zone path.
            this.attackTimer -= dt;
            if (this.windupTimer > 0) {
                this.windupTimer -= dt;
                moveX = 0; moveY = 0; // planted — the telegraph must not drift
                this._windupAimX = nx; this._windupAimY = ny;
            } else if (this.attackTimer <= 0 && len <= this.def.triggerRange &&
                       (!obstacleSystem || obstacleSystem.hasLineOfSight(this.x, this.y, player.x, player.y))) {
                this.windupTimer = this.def.windup;
                this._windupAimX = nx; this._windupAimY = ny;
                this.attackTimer = this.def.fireInterval;
            }
        } else if (!frozen && this.behavior === 'summoner') {
            // Caller (P1.3): spitter-style spacing, then a channel windup.
            // The call itself is fulfilled by Game (alive-cap gated).
            const kd = this.def.keepDistance;
            if (len < kd - 40) { moveX = -nx; moveY = -ny; }
            else if (len > kd + 80) { moveX = nx; moveY = ny; }
            else { moveX = 0; moveY = 0; }

            this.attackTimer -= dt;
            if (this.windupTimer > 0) {
                this.windupTimer -= dt;
                moveX = 0; moveY = 0; // braces while channeling the call
                this._windupAimX = nx; this._windupAimY = ny;
            } else if (this.attackTimer <= 0 && len <= this.def.fireRange &&
                       (!obstacleSystem || obstacleSystem.hasLineOfSight(this.x, this.y, player.x, player.y))) {
                this.windupTimer = this.def.windup;
                this._windupAimX = nx; this._windupAimY = ny;
                this.attackTimer = this.def.fireInterval;
            }
        } else if (!frozen && this.behavior === 'teleporter') {
            // Blink-bat (P1.3): chases normally, but at range it winds up a
            // short pre-blink tell, then reappears FLANKING the player. The
            // Game clamps + wall-resolves the landing spot right after this
            // update, so a blink can never end inside cover.
            this.attackTimer -= dt;
            if (this.windupTimer > 0) {
                this.windupTimer -= dt;
                moveX = 0; moveY = 0; // holds still through the pre-blink tell
                this._windupAimX = nx; this._windupAimY = ny;
                if (this.windupTimer <= 0) {
                    this._blinkFromX = this.x;
                    this._blinkFromY = this.y;
                    const a = Math.random() * TWO_PI;
                    this.x = player.x + Math.cos(a) * this.def.blinkRadius;
                    this.y = player.y + Math.sin(a) * this.def.blinkRadius;
                }
            } else if (this.attackTimer <= 0 &&
                       len >= this.def.blinkMinRange && len <= this.def.blinkMaxRange) {
                this.windupTimer = this.def.windup;
                this._windupAimX = nx; this._windupAimY = ny;
                this.attackTimer = this.def.fireInterval;
            }
        } else if (!frozen && this.behavior === 'lieutenant') {
            // Lieutenant mini-boss (P1.3): default chase + a 2-move slice of
            // the boss attack vocabulary (LIEUTENANT.attacks). Braces through
            // a windup so the gold charge-arc tell reads clearly.
            runLieutenantAI(this, dt, player, this._bossOut);
            if (this.windupTimer > 0) { moveX = 0; moveY = 0; }
        } else if (!frozen && this.behavior === 'support') {
            // Healer/Shielder: hang back from the player (like a spitter) so it
            // survives to keep buffing the front line. Its aura effect itself is
            // applied by Game (which has the full enemy list).
            const kd = this.def.keepDistance ?? 340;
            if (len < kd - 50) { moveX = -nx; moveY = -ny; }
            else if (len > kd + 90) { moveX = nx; moveY = ny; }
            else { moveX = 0; moveY = 0; }
        } else if (!frozen && this.behavior === 'apexBoss') {
            // Telegraphed special attacks + phase-2 enrage. The boss chases by
            // default (moveX/moveY already = nx/ny); runBossAI drives windups
            // and commits. Brace (stand still) while a windup is charging.
            runBossAI(this, dt, player, this._bossOut);
            if (this.bossDashTimer > 0) {
                // Committed CHARGE: barrel along the locked lunge heading at the
                // dash speed (ignores bracing so the lunge actually travels).
                this.bossDashTimer -= dt;
                moveX = this.bossDashDirX; moveY = this.bossDashDirY;
                spd = this.bossDashSpeed * slowK * chillK;
            } else if (this.bossWindupTimer > 0 || this.activeAttack ||
                       this.bossRecoveryTimer > 0 || this.bossPhaseBreakTimer > 0) {
                moveX = 0; moveY = 0;
            }
        }

        // Smarter trash: a plain chaser (no behavior) near the player leads the
        // player's movement a little (cut-off pursuit, not psychic) and weaves
        // so a swarm approaches as a thinking pack instead of one dead-straight
        // radial line. Faded out up close so it commits to the kill. Cheap
        // vector math, gated to nearby enemies.
        const isPlainChaser = !this.boss && !this.behavior;
        if (!frozen && isPlainChaser && (moveX || moveY) && spd > 0 && len < CHASER_BRAIN_RANGE) {
            const b = chaserBrain(this, player, len, nx, ny);
            moveX = b.x; moveY = b.y;
        }

        // Ranged/support enemies used to stop at their preferred distance even
        // when a house wall separated them from the player. Strafe around cover
        // until line of sight opens; the navigator below turns this intent into
        // a collision-safe wall-following heading.
        const repositionsForSight = this.behavior === 'spitter' ||
            this.behavior === 'summoner' || this.behavior === 'support';
        if (!frozen && repositionsForSight && moveX === 0 && moveY === 0 &&
            this.windupTimer <= 0 && obstacleSystem &&
            !obstacleSystem.hasLineOfSight(this.x, this.y, player.x, player.y)) {
            moveX = -ny * this._navSide;
            moveY = nx * this._navSide;
        }

        // Every motile enemy gets local obstacle steering. The previous gate
        // compared boss-only fields (`undefined <= 0`) on normal enemies, which
        // is false in JavaScript: despite the old comment, ALL non-bosses drove
        // straight into walls. Positive checks make absent timers safely idle.
        // Deliberate dash/telegraph commitments retain their locked headings.
        const committedMove = this.dashTimer > 0 || this.bossDashTimer > 0 ||
            this.bossWindupTimer > 0 || this.bossRecoveryTimer > 0 ||
            this.bossPhaseBreakTimer > 0 || !!this.activeAttack;
        if (obstacleSystem && !committedMove && (moveX || moveY) && spd > 0 &&
            steerEnemyMovement(this, moveX, moveY, spd, obstacleSystem, dt)) {
            moveX = this._navMoveX;
            moveY = this._navMoveY;
        }

        // Continuous low-HP enrage: a wounded boss moves (and lunges) faster.
        if (this.boss && this.enrageT) spd *= 1 + this.enrageT * BOSS.enrage.speedBonus;

        if (moveX !== 0 || moveY !== 0) {
            this.vx = moveX * spd;
            this.vy = moveY * spd;
            this.x += this.vx * dt;
            this.y += this.vy * dt;
        } else {
            this.vx = 0;
            this.vy = 0;
        }

        // A boss winding up / committing a telegraphed attack is planted: it
        // ignores knockback so the player's chip damage can't drift it off the
        // ground telegraph it already painted (the shockwave commits at the
        // boss's live position, so drift would desync the warning ring). The
        // impulse is dropped, not banked, so it doesn't snap on release.
        // Lieutenants (and planted bombers) get the same treatment while
        // winding up — their committed attack/blast must land on the spot
        // that was telegraphed.
        const bossPlanted = (this.boss && (this.bossWindupTimer > 0 || this.activeAttack ||
            this.bossDashTimer > 0 || this.bossRecoveryTimer > 0 || this.bossPhaseBreakTimer > 0)) ||
            ((this.lieutenant || this.behavior === 'bomber') && this.windupTimer > 0);
        if (bossPlanted) {
            this.knockbackVx = 0;
            this.knockbackVy = 0;
        } else if (this.knockbackVx !== 0 || this.knockbackVy !== 0) {
            this.x += this.knockbackVx * dt;
            this.y += this.knockbackVy * dt;
            const decay = Math.exp(-dt / KNOCKBACK.timeConstant);
            this.knockbackVx *= decay;
            this.knockbackVy *= decay;
            if (Math.abs(this.knockbackVx) < 1) this.knockbackVx = 0;
            if (Math.abs(this.knockbackVy) < 1) this.knockbackVy = 0;
        }

        if (this.hitFlashTimer > 0) this.hitFlashTimer -= dt;
        if (this.weaponHitCooldown > 0) this.weaponHitCooldown -= dt;
        if (this.slowTimer > 0) {
            this.slowTimer -= dt;
            if (this.slowTimer <= 0) { this.slowTimer = 0; this.slowMul = 1; }
        }
        if (this.shredTimer > 0) {
            this.shredTimer -= dt;
            if (this.shredTimer <= 0) { this.shredTimer = 0; this.shredStacks = 0; }
        }
        // Elemental status decay. Chill/shock reset their companion scalar on
        // expiry. Burn only ACCUMULATES here (the Game status pass owns the
        // tick → damage conversion); on expiry we zero everything so a stale
        // accumulator can't leak into the next burn.
        if (this.chillTimer > 0) {
            this.chillTimer -= dt;
            if (this.chillTimer <= 0) { this.chillTimer = 0; this.chillMul = 1; this.chillStacks = 0; }
        }
        if (this.freezeTimer > 0) {
            this.freezeTimer -= dt;
            if (this.freezeTimer <= 0) this.freezeTimer = 0;
        }
        if (this.shockTimer > 0) {
            this.shockTimer -= dt;
            if (this.shockTimer <= 0) { this.shockTimer = 0; this.shockStacks = 0; }
        }
        if (this._comboCd > 0) this._comboCd -= dt;   // KINDLED SHATTER/BRITTLE latch
        if (this.burnTimer > 0) {
            this.burnTimer -= dt;
            this.burnTickAccum += dt;
            // Only clamp the timer here; the burn-tick accumulator and burnDps
            // are owned + flushed by Game._tickStatuses so the final partial
            // interval of damage is never silently dropped on expiry.
            if (this.burnTimer < 0) this.burnTimer = 0;
        }
        this.animTimer += dt;
        this.spawnAge += dt;
        if (this.shieldTimer > 0) this.shieldTimer -= dt;
        // Regenerating affix: slowly knit HP back while alive (never past max).
        if (this.regenPerSecond > 0 && this.hp < this.maxHp) {
            this.hp = Math.min(this.maxHp, this.hp + this.regenPerSecond * dt);
        }
    }

    takeDamage(amount, knockbackVx = 0, knockbackVy = 0) {
        // Recovery is an actual punish window, not merely an animation pause.
        if (this.boss && this.bossRecoveryTimer > 0) amount *= BOSS_EXPOSED_DAMAGE_MUL;
        // Mild boss resistance (never full immunity — resist is clamped well
        // below 1 in config). No-op for normal enemies (resist 0).
        if (this.resist > 0) amount *= (1 - this.resist);
        // Reflective/armored elite affix: soak a chunk of every hit.
        if (this.damageTakenMul !== 1) amount *= this.damageTakenMul;
        // Shielder aura: a transient damage-soak while a Shielder is nearby.
        if (this.shieldTimer > 0 && this.shieldMul !== 1) amount *= this.shieldMul;
        this.hp -= amount;
        this.hitFlashTimer = HIT_FLASH_DURATION;
        this.knockbackVx += knockbackVx;
        this.knockbackVy += knockbackVy;
        if (this.hp <= 0) {
            this.hp = 0;
            this.active = false;
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);

        // Boss presence: a broad ground shadow + a slow, ominous aura halo
        // behind the sprite so an apex predator reads as a major threat at a
        // glance. Both use cached sprites (no per-frame gradients) and only
        // bosses pay the cost. The aura runs hotter once phase-2 enrage latches.
        if (this.boss) {
            const p = BOSS.presence;
            const bR = this.spriteHalf * this.visualScale;
            const shadow = getSoftShadowSprite();
            const sw = bR * p.shadowScale * 2;
            const sh = sw * 0.34;
            ctx.globalAlpha = p.shadowAlpha;
            ctx.drawImage(shadow, -sw / 2, bR * 0.58 - sh / 2, sw, sh);
            const pulse = Math.sin(this.animTimer * 2.2);
            const aura = getGlowSprite(this.phase2Entered ? p.auraColorEnraged : p.auraColor);
            const ar = bR * (p.auraScale + 0.12 * pulse);
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = p.auraAlpha + 0.12 * pulse;
            ctx.drawImage(aura, -ar, -ar, ar * 2, ar * 2);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
        }

        // Grounding shadow under regular (non-boss) enemies so they read as
        // standing on the floor rather than floating. One cached soft-shadow
        // blit (no per-frame gradient); airborne types skip it; fades in with
        // the spawn pop. Drawn pre-scale in world space, like the boss shadow.
        if (!this.boss && !AIRBORNE_TYPES.has(this.type)) {
            const r = this.spriteHalf * this.visualScale;
            const sw = r * 1.05 * 2, sh = sw * 0.30;
            const fade = clamp(this.spawnAge / SPAWN_POP_DUR, 0, 1);
            ctx.globalAlpha = 0.32 * fade;
            ctx.drawImage(getSoftShadowSprite(), -sw / 2, r * 0.52 - sh / 2, sw, sh);
            ctx.globalAlpha = 1;
        }

        // Elite glow halo sits behind the sprite at world scale (before the
        // visualScale transform) so it's a roomy ring, not a tight outline.
        // Cached additive glow blit (affix-tinted) with a slow pulse — the same
        // per-frame-gradient-free pattern the burn halo already uses.
        if (this.elite) {
            const col = this.affixDef ? this.affixDef.tint : '#ffd166';
            const haloR = this.spriteHalf * this.visualScale * 0.9;
            const pulse = 0.85 + 0.15 * Math.sin(this.animTimer * 3 + this.animOffset);
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.42 * pulse;
            ctx.drawImage(getGlowSprite(col), -haloR, -haloR, haloR * 2, haloR * 2);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
        }

        // Slow tell: a thin cool-blue ring (drawn pre-scale in world space,
        // like the elite halo). Timer-gated, so un-slowed enemies pay nothing.
        if (this.slowTimer > 0) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = 'rgba(120, 200, 255, 0.5)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, this.spriteHalf * this.visualScale * 0.7, 0, TWO_PI);
            ctx.stroke();
        }

        // Elemental status tells (all timer-gated, all pre-scale world space,
        // all procedural — no ctx.filter). FROST chill = thin cyan ring;
        // FREEZE = denser frosted double-ring; FIRE burn = warm pulsing halo;
        // SHOCK = yellow crackle arcs near the top.
        const baseR = this.spriteHalf * this.visualScale;
        // Shielder aura tell: a translucent hex-blue bubble around a protected
        // foe so the player can read "kill the Shielder first".
        if (this.shieldTimer > 0) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = 'rgba(127, 208, 255, 0.55)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, baseR * 0.92, 0, TWO_PI);
            ctx.stroke();
            ctx.fillStyle = 'rgba(127, 208, 255, 0.10)';
            ctx.beginPath();
            ctx.arc(0, 0, baseR * 0.92, 0, TWO_PI);
            ctx.fill();
        }
        if (this.chillTimer > 0) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = hexToHalo(ELEMENT.frost.tint, 0.5);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, baseR * 0.72, 0, TWO_PI);
            ctx.stroke();
        }
        if (this.freezeTimer > 0) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = hexToHalo(ELEMENT.freeze.tint, 0.6);
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, baseR * 0.78, 0, TWO_PI);
            ctx.stroke();
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, baseR * 0.66, 0, TWO_PI);
            ctx.stroke();
        }
        if (this.burnTimer > 0) {
            // Use the CACHED fire glow sprite (drawn at animated alpha) rather
            // than building a radial gradient every frame — a whole burning
            // swarm would otherwise allocate a gradient per enemy per frame,
            // exactly the iOS hazard the particle/lighting systems avoid.
            const haloR = baseR * 0.8;
            const a = 0.3 + 0.2 * Math.sin(this.animTimer * 10);
            const glow = getGlowSprite(ELEMENT.fire.tint);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = a;
            ctx.drawImage(glow, -haloR, -haloR, haloR * 2, haloR * 2);
            ctx.globalAlpha = 1;
        }
        if (this.shockTimer > 0) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = hexToHalo(ELEMENT.shock.tint, 0.6 + 0.25 * Math.min(1, this.shockStacks / 5));
            ctx.lineWidth = 2;
            const top = -baseR * 0.6;
            ctx.beginPath();
            ctx.moveTo(-baseR * 0.4, top);
            ctx.lineTo(-baseR * 0.18, top + baseR * 0.18);
            ctx.lineTo(baseR * 0.04, top - baseR * 0.06);
            ctx.lineTo(baseR * 0.3, top + baseR * 0.16);
            ctx.stroke();
        }

        // P1.3 behavior tells (all def/behavior-gated, so legacy types pay
        // nothing; all strokes/cached blits, no gradients):
        //   splitter   = a double ring — "two creatures in one".
        //   summoner   = a slow-orbiting trio of call motes.
        //   teleporter = a phase-shimmer ring (alpha flickers).
        //   bomber     = a warm armed-payload glow (cached glow sprite).
        if (this.def.splitInto) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = hexToHalo(this.def.tint || '#b48cff', 0.4);
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, baseR * 0.62, 0, TWO_PI); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, 0, baseR * 0.78, 0, TWO_PI); ctx.stroke();
        } else if (this.behavior === 'summoner') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = hexToHalo(this.def.tint || '#c97bff', 0.6);
            const oa = this.animTimer * 1.8 + this.animOffset;
            for (let k = 0; k < 3; k++) {
                const a = oa + (k / 3) * TWO_PI;
                ctx.beginPath();
                ctx.arc(Math.cos(a) * baseR * 0.85, Math.sin(a) * baseR * 0.85, 5, 0, TWO_PI);
                ctx.fill();
            }
        } else if (this.behavior === 'teleporter') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = hexToHalo(this.def.tint || '#7fe0ff', 0.25 + 0.3 * Math.abs(Math.sin(this.animTimer * 5 + this.animOffset)));
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, baseR * 0.8, 0, TWO_PI); ctx.stroke();
        } else if (this.behavior === 'bomber') {
            const gr = baseR * 0.75;
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.22 + 0.16 * Math.sin(this.animTimer * 7 + this.animOffset);
            ctx.drawImage(getGlowSprite('#ff9a4a'), -gr, -gr, gr * 2, gr * 2);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
        }

        // Attack wind-up telegraph (spitter shot / charger lunge / the P1.3
        // bomber plant, summoner channel, teleporter pre-blink, and lieutenant
        // specials): a charge arc that fills as the wind-up completes + a
        // directional chevron toward the player, so a discrete attack reads
        // and can be dodged. Bosses layer this body tell over their larger
        // ground telegraph so a cast stays readable through a crowded arena.
        // Pre-scale, procedural, timer-gated → free when idle. Lieutenants
        // carry their windup length per-attack (_ltWindupDur), not on def.
        const bossWinding = this.boss && this.bossWindupTimer > 0 && this.bossWindupDuration > 0;
        const wupTot = bossWinding ? this.bossWindupDuration
            : (this.lieutenant ? this._ltWindupDur : this.def.windup);
        const windupRemaining = bossWinding ? this.bossWindupTimer : this.windupTimer;
        if (windupRemaining > 0 && wupTot > 0) {
            const wp = clamp(1 - windupRemaining / wupTot, 0, 1);
            const warn = this.boss ? (this.phase2Entered ? '#ff3326' : '#ff6b4a')
                : this.lieutenant ? '#ffc24a'
                : this.behavior === 'charger' ? '#ff6a3c'
                : this.behavior === 'bomber' ? '#ff9a3c'
                : this.behavior === 'summoner' ? '#b48cff'
                : this.behavior === 'teleporter' ? '#7fe0ff'
                : this.behavior === 'spitter' ? '#c97bff' : '#ffcc4a';
            // Anchor on the collision radius (the creature's real size) so the
            // tell hugs the enemy rather than the padded sprite frame.
            const tr = this.radius;
            const rr = tr * 1.32;
            ctx.globalCompositeOperation = 'source-over';
            // Faint full ring so the threat reads from the first frame; brightens.
            ctx.strokeStyle = hexToHalo(warn, 0.22 + 0.4 * wp);
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, rr, 0, TWO_PI); ctx.stroke();
            // Charge meter: a bright arc sweeping from the top, filling to release.
            ctx.strokeStyle = hexToHalo(warn, 0.95);
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(0, 0, rr, -Math.PI / 2, -Math.PI / 2 + wp * TWO_PI); ctx.stroke();
            // Directional chevron toward the player — grows + brightens as it
            // nears release, pointing where the shot/lunge will go.
            const ang = Math.atan2(this._windupAimY, this._windupAimX);
            const cd = tr * (1.5 + 0.55 * wp);
            const cs = tr * (0.42 + 0.40 * wp);
            ctx.save();
            ctx.translate(Math.cos(ang) * cd, Math.sin(ang) * cd);
            ctx.rotate(ang);
            ctx.fillStyle = hexToHalo(warn, 0.5 + 0.5 * wp);
            ctx.beginPath();
            ctx.moveTo(cs, 0); ctx.lineTo(-cs * 0.6, cs * 0.7); ctx.lineTo(-cs * 0.6, -cs * 0.7);
            ctx.closePath(); ctx.fill();
            ctx.restore();
        }

        // "Alive" deform: idle breathing (volume-preserving pulse so nothing
        // sits perfectly still) + a spawn-in scale pop (easeOutBack overshoot)
        // + a hit squash (stretch wide / squash flat) for the hit-flash window.
        const breath = Math.sin(this.animTimer * 3.1 + this.animOffset) * 0.03;
        let sx = 1 + breath, sy = 1 - breath;
        if (this.spawnAge < SPAWN_POP_DUR) {
            const pop = 0.35 + 0.65 * Easing.outBack(this.spawnAge / SPAWN_POP_DUR);
            sx *= pop; sy *= pop;
        }
        if (this.hitFlashTimer > 0) {
            const q = this.hitFlashTimer / HIT_FLASH_DURATION;
            sx *= 1 + 0.20 * q; sy *= 1 - 0.16 * q;
        }
        // Wind-up anticipation: coil tighter (squat) as the attack nears
        // release (wupTot covers lieutenants' per-attack windups too).
        if (windupRemaining > 0 && wupTot > 0) {
            const wp = clamp(1 - windupRemaining / wupTot, 0, 1);
            sx *= 1 + 0.10 * wp; sy *= 1 - 0.06 * wp;
        }
        // Non-bosses lean into their horizontal movement — reads as weight.
        // (Directional LPC sprites already turn to face, so skip the tilt for
        // them — it would double up with the left/right rows.)
        if (!this.boss && !this.dirFrames && this.vx) ctx.rotate(clamp(this.vx * 0.00018, -0.13, 0.13));
        ctx.scale(this.visualScale * sx, this.visualScale * sy);

        // Directional sprites pick the row by movement facing; flat sprites use
        // the single frame set. Facing latches so a stationary enemy keeps its
        // last-faced direction instead of snapping to a default.
        let frames = this.frames;
        if (this.dirFrames) {
            if (Math.abs(this.vx) > 4 || Math.abs(this.vy) > 4) {
                this._facing = Math.abs(this.vx) >= Math.abs(this.vy)
                    ? (this.vx >= 0 ? 'right' : 'left')
                    : (this.vy >= 0 ? 'down' : 'up');
            }
            frames = this.dirFrames[this._facing] || this.frames;
        }
        // Lieutenant mini-boss: a bespoke 3-pose keyed sprite set (idle/attack/hurt)
        // stands in for the procedural frame and rides ALL the animation + flash
        // re-draws below. Pose by live state — hurt on hit-flash, attack on wind-up
        // or a periodic heft, idle otherwise — each falling back to idle, then to
        // the procedural heavy-hitter frame until the images load (or if they fail).
        let frame;
        if (this.lieutenant) {
            const set = getLieutenantSprites();
            if (set && set.idle) {
                if (this.hitFlashTimer > 0 && set.hurt) frame = set.hurt;
                else if (set.attack && ((this.windupTimer > 0 && this.def.windup > 0) || Math.sin(this.animTimer * 1.6 + this.animOffset) > 0.6)) frame = set.attack;
                else frame = set.idle;
            }
        }
        if (!frame) {
            const idx = Math.floor(this.animTimer * this.frameHz) % frames.length;
            frame = frames[idx];
        }
        ctx.drawImage(frame, -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);

        // Elite shimmer + hit flash use additive 'lighter' re-draws of the
        // sprite itself rather than ctx.filter. ctx.filter forces an
        // offscreen pass per drawImage on iOS WebKit (a real frame-rate
        // hazard with many flashing/elite enemies); re-drawing the cached
        // frame in 'lighter' mode brightens exactly the sprite's own pixels
        // for a fraction of the cost. globalAlpha/compositeOp reset on
        // restore().
        if (this.elite) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.18;
            ctx.drawImage(frame, -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);
        }
        // Status brightening via additive frame redraws (can't tint a
        // drawImage without ctx.filter, so we brighten the sprite's own
        // pixels — burn reads warm, freeze reads as a pale ice sheen, phase-2
        // enrage reads hot alongside the ENRAGED HP-bar tint).
        if (this.burnTimer > 0) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.15;
            ctx.drawImage(frame, -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);
        }
        if (this.freezeTimer > 0) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.14;
            ctx.drawImage(frame, -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);
        }
        if (this.phase2Entered) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.18;
            ctx.drawImage(frame, -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);
        }
        if (this.hitFlashTimer > 0) {
            const t = this.hitFlashTimer / HIT_FLASH_DURATION;
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = Math.min(1, 0.9 * t);
            ctx.drawImage(frame, -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);
            ctx.drawImage(frame, -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);
            // Brief white glow pop at the very start of the flash (t near 1)
            // for a satisfying "hit" impact. Cached white glow, additive.
            if (t > 0.6) {
                ctx.globalAlpha = (t - 0.6) / 0.4 * 0.55;
                ctx.drawImage(getGlowSprite('#ffffff'), -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);
            }
        }
        ctx.restore();
    }

    // Contrast-only windup geometry. This intentionally redraws no authored
    // fills, sprite pixels, or translucent rings; it is safe to run after the
    // darkness veil without making the normal world pass double-thick.
    drawWindupContrastCue(ctx) {
        const bossWinding = this.boss && this.bossWindupTimer > 0 && this.bossWindupDuration > 0;
        const wupTot = bossWinding ? this.bossWindupDuration
            : (this.lieutenant ? this._ltWindupDur : this.def.windup);
        const windupRemaining = bossWinding ? this.bossWindupTimer : this.windupTimer;
        if (!(windupRemaining > 0) || !(wupTot > 0)) return 0;

        const wp = clamp(1 - windupRemaining / wupTot, 0, 1);
        const warn = this.boss ? (this.phase2Entered ? '#ff3326' : '#ff6b4a')
            : this.lieutenant ? '#ffc24a'
            : this.behavior === 'charger' ? '#ff6a3c'
            : this.behavior === 'bomber' ? '#ff9a3c'
            : this.behavior === 'summoner' ? '#b48cff'
            : this.behavior === 'teleporter' ? '#7fe0ff'
            : this.behavior === 'spitter' ? '#c97bff' : '#ffcc4a';
        const tr = this.radius;
        const rr = tr * 1.32;

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.beginPath();
        ctx.arc(0, 0, rr, 0, TWO_PI);
        strokeHighContrastPath(ctx, warn, 2);
        ctx.beginPath();
        ctx.arc(0, 0, rr, -Math.PI / 2, -Math.PI / 2 + wp * TWO_PI);
        strokeHighContrastPath(ctx, warn, 3);

        const ang = Math.atan2(this._windupAimY, this._windupAimX);
        const cd = tr * (1.5 + 0.55 * wp);
        const cs = tr * (0.42 + 0.40 * wp);
        ctx.translate(Math.cos(ang) * cd, Math.sin(ang) * cd);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(cs, 0);
        ctx.lineTo(-cs * 0.6, cs * 0.7);
        ctx.lineTo(-cs * 0.6, -cs * 0.7);
        ctx.closePath();
        strokeHighContrastPath(ctx, warn, 1.5);
        ctx.restore();
        return 3;
    }

    // Non-color status language for the post-veil visibility pass. Trash uses
    // a deterministic semantic priority (shield, freeze, burn, shock, shred,
    // chill, slow); important/focused enemies pass a limit of seven. Counting
    // and dispatch stay scalar, and cached badges cost one blit apiece.
    drawStatusCues(ctx, highContrast = false, size = 15, maxStatuses = 3) {
        const limit = Math.min(7, Math.max(0, maxStatuses | 0));
        if (limit <= 0) return 0;

        let count = 0;
        if (this.shieldTimer > 0 && count < limit) count++;
        if (this.freezeTimer > 0 && count < limit) count++;
        if (this.burnTimer > 0 && count < limit) count++;
        if (this.shockTimer > 0 && count < limit) count++;
        if (this.shredTimer > 0 && count < limit) count++;
        if (this.chillTimer > 0 && count < limit) count++;
        if (this.slowTimer > 0 && count < limit) count++;
        if (count === 0) return 0;

        const badgeSize = Math.max(10, size);
        const step = badgeSize * 1.22 + 4;
        let x = this.x - (count - 1) * step * 0.5;
        const hpTop = this.y - this.radius - UI.enemyHealthBar.marginAboveRadius;
        const y = hpTop - badgeSize * 0.62 - 5;
        let drawn = 0;

        if (this.shieldTimer > 0 && drawn < limit) {
            drawCachedStatusGlyph(ctx, 'shield', x, y, badgeSize, 0, highContrast);
            drawn++; x += step;
        }
        if (this.freezeTimer > 0 && drawn < limit) {
            drawCachedStatusGlyph(ctx, 'freeze', x, y, badgeSize, 0, highContrast);
            drawn++; x += step;
        }
        if (this.burnTimer > 0 && drawn < limit) {
            drawCachedStatusGlyph(ctx, 'burn', x, y, badgeSize, 0, highContrast);
            drawn++; x += step;
        }
        if (this.shockTimer > 0 && drawn < limit) {
            drawCachedStatusGlyph(ctx, 'shock', x, y, badgeSize, this.shockStacks, highContrast);
            drawn++; x += step;
        }
        if (this.shredTimer > 0 && drawn < limit) {
            drawCachedStatusGlyph(ctx, 'shred', x, y, badgeSize, this.shredStacks, highContrast);
            drawn++; x += step;
        }
        if (this.chillTimer > 0 && drawn < limit) {
            drawCachedStatusGlyph(ctx, 'chill', x, y, badgeSize, this.chillStacks, highContrast);
            drawn++; x += step;
        }
        if (this.slowTimer > 0 && drawn < limit) {
            drawCachedStatusGlyph(ctx, 'slow', x, y, badgeSize, 0, highContrast);
            drawn++;
        }
        return drawn;
    }

    drawCombatCueOverlay(ctx, highContrast, statusSize, maxStatuses) {
        if (highContrast) this.drawWindupContrastCue(ctx);
        return this.drawStatusCues(ctx, highContrast, statusSize, maxStatuses);
    }

    drawHpBar(ctx) {
        if (this.hp >= this.maxHp) return;
        const { width, height, marginAboveRadius } = UI.enemyHealthBar;
        const ratio = clamp(this.hp / this.maxHp, 0, 1);
        drawWorldHealthBar(
            ctx,
            this.x,
            this.y - this.radius - marginAboveRadius,
            width,
            height,
            ratio,
            healthColor(ratio)
        );
    }

    drawDebug(ctx) {
        ctx.save();
        ctx.strokeStyle = this.elite ? '#ffd166' : '#ff4757';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, TWO_PI);
        ctx.stroke();
        ctx.restore();
    }
}

// #rrggbb → rgba() at the given alpha (for the affix-tinted halo).
function hexToHalo(hex, a) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ── Apex-boss AI ────────────────────────────────────────────────────────
// Free function (keeps Enemy.update readable). Drives the phase-2 latch,
// attack-cooldown ticking, telegraph windups, and commits. `out` is the
// boss's stashed { enemyProjectiles, hazards } channel (set in Game._spawnBoss).
// Mirrors the spitter/charger timer + windup idiom. One attack winds up at a
// time. Movement is the default chase handled by Enemy.update; this only
// drives specials. The caller braces the boss (stand still) while a windup is
// active so the telegraph reads clearly.
// Predict where the player will be in `t` seconds from their current velocity.
// A target without velocity fields (a test stub) reduces to the current spot.
function leadPoint(e, player, speed) {
    const pvx = player.vx || 0, pvy = player.vy || 0;
    const dist = Math.hypot(player.x - e.x, player.y - e.y);
    // Time for a projectile/lunge at `speed` (or the boss's move speed) to close
    // the gap, clamped so we never over-lead clear across the arena.
    const t = Math.min(1.1, dist / Math.max(120, speed || e.speed || 1));
    return { x: player.x + pvx * t, y: player.y + pvy * t };
}

// Chase heading that leads the player's movement (cut-off pursuit). Returns a
// unit vector toward the predicted intercept point.
function bossLead(e, player, dist) {
    const lead = leadPoint(e, player, e.speed);
    const dx = lead.x - e.x, dy = lead.y - e.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
}

// Smarter plain-chaser heading: a MILD cut-off lead (blend of straight chase +
// intercept aim, so it heads you off without being psychic) plus a subtle
// perpendicular weave that fades to nothing up close (commits to the kill
// instead of circling). Returns a unit heading vector.
function chaserBrain(e, player, dist, nx, ny) {
    let hx = nx, hy = ny;
    const pvx = player.vx ?? 0, pvy = player.vy ?? 0;
    if (pvx || pvy) {
        // Lead time scales with the gap but is clamped short so it intercepts
        // the player's path a little, not their position across the map.
        const t = Math.min(0.6, dist / Math.max(160, e.speed * 2));
        const lx = player.x + pvx * t - e.x;
        const ly = player.y + pvy * t - e.y;
        const ll = Math.hypot(lx, ly) || 1;
        hx = 0.6 * (lx / ll) + 0.4 * nx;  // 60% intercept / 40% straight
        hy = 0.6 * (ly / ll) + 0.4 * ny;
    }
    // Weave: perpendicular oscillation, faded in only beyond ~120px so the
    // approach reads as alive but the kill blow goes straight in.
    const closeK = Math.min(1, Math.max(0, (dist - 120) / 240));
    if (closeK > 0) {
        const w = Math.sin(e.animTimer * 3 + e.animOffset) * 0.3 * closeK;
        const px = -hy, py = hx;
        hx += px * w; hy += py * w;
    }
    const hl = Math.hypot(hx, hy) || 1;
    return { x: hx / hl, y: hy / hl };
}

// ── Lieutenant mini-boss AI (P1.3) ─────────────────────────────────────
// A 2-move slice of the apex-boss vocabulary (kit + windup lengths live in
// LIEUTENANT.attacks; Game._spawnLieutenant arms ltAttacks/ltTimers/_bossOut).
// Mirrors runBossAI's timer → windup → commit shape with none of the
// phase/enrage machinery, and commits through the SAME commitBossAttack
// pipeline (hazard pool / enemy-bolt loop), so telegraphs, walls-block-
// damage, and i-frames all behave exactly like a boss's. Range-gated so an
// off-screen lieutenant can never bombard the player; the visible tell is
// the standard trash charge-arc (gold) driven by windupTimer/_ltWindupDur.
function runLieutenantAI(e, dt, player, out) {
    if (!e.ltAttacks || !out) return;
    const dx = player.x - e.x, dy = player.y - e.y;
    if (e.windupTimer > 0) {
        e.windupTimer -= dt;
        // Track the player through the windup so the chevron tell stays honest.
        const l = Math.hypot(dx, dy) || 1;
        e._windupAimX = dx / l; e._windupAimY = dy / l;
        if (e.windupTimer <= 0) {
            e.windupTimer = 0;
            commitBossAttack(e, e._ltActive, player, out);
            e._ltActive = null;
        }
        return;
    }
    const range = LIEUTENANT.attackRange ?? 950;
    const inRange = dx * dx + dy * dy <= range * range;
    for (const atk of e.ltAttacks) {
        // Cooldowns floor at ready-and-waiting (they don't bank negative
        // time), then the attack fires as soon as the player is in range.
        if (e.ltTimers[atk.id] > 0) e.ltTimers[atk.id] -= dt;
        if (e.ltTimers[atk.id] <= 0 && inRange) {
            e._ltActive = atk;
            e._ltWindupDur = atk.windup;
            e.windupTimer = atk.windup;
            e.ltTimers[atk.id] = atk.cooldown;
            const l = Math.hypot(dx, dy) || 1;
            e._windupAimX = dx / l; e._windupAimY = dy / l;
            // A slam's blast radius gets the boss-style ground warning ring
            // (the other kinds paint their own hazard warns at commit). The
            // owner ref lets HazardSystem PAUSE the ring while a freeze proc
            // pauses this windup (lieutenants aren't freeze-exempt like
            // bosses), so the ring and the commit can never desync.
            if (atk.kind === 'shockwave' && out.hazards) {
                out.hazards.push({ kind: 'bossTelegraph', x: e.x, y: e.y, r: 0, rMax: atk.rMax, age: 0, lifetime: atk.windup, active: true, owner: e });
            }
            break; // one windup at a time
        }
    }
}

function runBossAI(e, dt, player, out) {
    const def = e.def;

    // Continuous enrage scalar: 0 at full HP → 1 at death.
    const frac = e.maxHp > 0 ? clamp(e.hp / e.maxHp, 0, 1) : 1;
    e.enrageT = 1 - frac;
    e.contactDamage = e.baseContactDamage * (1 + e.enrageT * BOSS.enrage.damageBonus);

    // Crossing 50% requests a transition; it does not cancel an attack the
    // player was already promised. Windup, dash, and recovery finish first.
    if (!e.phase2Entered && !e.phase2Pending && frac <= (def.phase2HpFraction ?? 0)) {
        e.phase2Pending = true;
    }

    const attacks = def.attacks;
    if (!attacks || !out) return;

    // An honest windup always commits, even if the phase threshold was crossed
    // halfway through it. Record the move only on commit (not selection), so
    // the no-repeat invariant describes attacks the player actually saw fire.
    if (e.bossWindupTimer > 0) {
        e.bossWindupTimer -= dt;
        if (e.bossWindupTimer <= 0) {
            e.bossWindupTimer = 0;
            const committed = e.activeAttack;
            commitBossAttack(e, committed, player, out);
            e.bossLastAttackId = committed?.id ?? null;
            e.bossLastAttackKind = committed?.kind ?? null;
            const signatureId = bossSignatureAttack(def)?.id ?? null;
            const recovery = bossRecoveryDuration(committed, signatureId);
            e.bossRecoveryDuration = recovery;
            // Charge recovery begins after travel, never during the lunge.
            if (e.bossDashTimer > 0) e.bossPendingRecovery = recovery;
            else e.bossRecoveryTimer = recovery;
            e.activeAttack = null;
            e.activeAttackLabel = null;
        }
        return;
    }

    // Cooldowns continue through travel / phase theatre / recovery, but never
    // bank below ready. This keeps the authored cadence without config-order
    // dominance or a burst of multiple moves on one frame.
    for (const attack of attacks) {
        if (e.attackTimers[attack.id] == null) e.attackTimers[attack.id] = attack.cooldown;
        else if (e.attackTimers[attack.id] > 0) e.attackTimers[attack.id] -= dt;
    }

    // A charge owns the boss until its warned lane is complete.
    if (e.bossDashTimer > 0) return;

    if (e.bossPendingRecovery > 0) {
        e.bossRecoveryTimer = e.bossPendingRecovery;
        e.bossRecoveryDuration = e.bossPendingRecovery;
        e.bossPendingRecovery = 0;
    }
    if (e.bossRecoveryTimer > 0) {
        e.bossRecoveryTimer = Math.max(0, e.bossRecoveryTimer - dt);
        return;
    }

    // The second act begins only at a clean boundary. Resolve the authored
    // pattern once, ready each beat, and force the signature after a dramatic
    // pause. If that exact signature was the just-finished move, count it as
    // fulfilled instead of violating the no-repeat rule.
    if (canStartBossPhaseBreak(e)) {
        e.phase2Pending = false;
        e.phase2Entered = true;
        e.phase = 2;
        e.phase2Pool = phasePatternFor(e.type, def);
        e.bossAttackCursor = 0;
        for (const attack of e.phase2Pool) e.attackTimers[attack.id] = 0;
        const signature = bossSignatureAttack(def);
        e.bossForcedAttack = signature && signature.id !== e.bossLastAttackId ? signature : null;
        e.bossPhaseBreakTimer = BOSS_PHASE_BREAK_DURATION;
        if (out.hazards) {
            out.hazards.push({
                kind: 'bossTelegraph', x: e.x, y: e.y, r: 0, rMax: 260,
                age: 0, lifetime: BOSS_PHASE_BREAK_DURATION, active: true,
                fan: true, phaseBreak: true, bossOwned: true,
            });
        }
        return;
    }
    if (e.bossPhaseBreakTimer > 0) {
        e.bossPhaseBreakTimer = Math.max(0, e.bossPhaseBreakTimer - dt);
        return;
    }

    const pool = (e.phase === 2 && e.phase2Pool) ? e.phase2Pool : attacks;
    const pick = chooseBossAttack(pool, e.attackTimers, {
        cursor: e.bossAttackCursor,
        lastAttackId: e.bossLastAttackId,
        lastAttackKind: e.bossLastAttackKind,
    }, e.bossForcedAttack, e.phase === 2);
    if (!pick) return;

    const atk = pick.attack;
    e.bossAttackCursor = pick.nextCursor;
    if (pick.forced) e.bossForcedAttack = null;
    e.activeAttack = atk;
    e.activeAttackLabel = bossAttackLabel(atk);
    e.bossWindupDuration = atk.windup;
    e.bossWindupTimer = atk.windup;

    const phaseCad = e.phase === 2 ? (BOSS_ATTACK.phase2CadenceMul ?? 1) : 1;
    const cadence = Math.min(e.bossCadenceMul ?? 1, phaseCad);
    const enrageCad = 1 - (e.enrageT ?? 0) * BOSS.enrage.cadenceCut;
    e.attackTimers[atk.id] = atk.cooldown * cadence * enrageCad;

    const aimDx = player.x - e.x, aimDy = player.y - e.y;
    const aimLen = Math.hypot(aimDx, aimDy) || 1;
    e._windupAimX = aimDx / aimLen;
    e._windupAimY = aimDy / aimLen;

    // Every boss cast paints a body tell plus a ground tell owned by this duel.
    if (out.hazards) {
        if (atk.kind === 'shockwave') {
            out.hazards.push({ kind: 'bossTelegraph', x: e.x, y: e.y, r: 0, rMax: atk.rMax, age: 0, lifetime: atk.windup, active: true, bossOwned: true });
        } else if (atk.kind === 'fan') {
            out.hazards.push({ kind: 'bossTelegraph', x: e.x, y: e.y, r: 0, rMax: 140, age: 0, lifetime: atk.windup, active: true, fan: true, bossOwned: true });
        } else if (atk.kind === 'summon') {
            out.hazards.push({ kind: 'bossTelegraph', x: e.x, y: e.y, r: 0, rMax: 160, age: 0, lifetime: atk.windup, active: true, fan: true, bossOwned: true });
        } else if (atk.kind === 'charge') {
            const lead = leadPoint(e, player, atk.dashSpeed ?? 600);
            const ca = Math.atan2(lead.y - e.y, lead.x - e.x);
            e.bossChargeDirX = Math.cos(ca);
            e.bossChargeDirY = Math.sin(ca);
            e._windupAimX = e.bossChargeDirX;
            e._windupAimY = e.bossChargeDirY;
            out.hazards.push({
                kind: 'bossTelegraph', x: e.x, y: e.y, r: 0, rMax: 120,
                age: 0, lifetime: atk.windup, active: true, charge: true,
                dirX: e.bossChargeDirX, dirY: e.bossChargeDirY,
                reach: (atk.dashSpeed ?? 600) * (atk.dashDuration ?? 0.6),
                bossOwned: true,
            });
        } else {
            out.hazards.push({ kind: 'bossTelegraph', x: e.x, y: e.y, r: 0, rMax: 170, age: 0, lifetime: atk.windup, active: true, fan: true, bossOwned: true });
        }
    }
}

// Fire the committed special. Shockwave pushes an expanding damaging ring
// into the hazard pool (centered on the boss); fan pushes a radial burst of
// EnemyProjectiles into the existing enemy-bolt loop (no new damage path).
export function commitBossAttack(e, atk, player, out) {
    if (!atk || !out) return;
    const hazardStart = out.hazards ? out.hazards.length : 0;
    // Killer attribution for the EMBERGLASS death card — every bolt this boss
    // fires carries "fell to <boss>, <epithet>".
    const src = { label: e.def?.label ?? e.name, epithet: e.epithet, boss: e.boss };
    if (atk.kind === 'shockwave' && out.hazards) {
        out.hazards.push({
            kind: 'shockwave',
            x: e.x, y: e.y,
            r: 0, rMax: atk.rMax,
            growth: atk.growth, band: atk.band, damage: atk.damage,
            hitPlayer: false,
            age: 0, lifetime: atk.rMax / atk.growth + 0.1,
            active: true,
        });
    } else if (atk.kind === 'fan' && out.enemyProjectiles) {
        let base = Math.atan2(player.y - e.y, player.x - e.x);
        const count = atk.count ?? 1;
        const full = (atk.spread ?? 0) >= 6.28; // full-circle radial volley
        // SPIRAL barrage: rotate the whole pattern a little each cast so
        // successive volleys sweep a turning spiral the player must weave.
        if (atk.spiral) {
            base += e.spiralPhase;
            e.spiralPhase = (e.spiralPhase + (atk.spin ?? 0.5)) % TWO_PI;
        }
        for (let i = 0; i < count; i++) {
            const a = full
                ? base + (i / count) * TWO_PI
                : base + (count > 1 ? (i / (count - 1) - 0.5) * atk.spread : 0);
            out.enemyProjectiles.push(new EnemyProjectile(
                e.x, e.y,
                Math.cos(a) * atk.projectileSpeed,
                Math.sin(a) * atk.projectileSpeed,
                atk.projectileDamage,
                { sourceLabel: src }
            ));
        }
    } else if (atk.kind === 'charge') {
        // Goring lunge: reuse the heading LOCKED when the telegraph lane was
        // painted, so the dash follows exactly the warned path (no mid-commit
        // re-aim). Falls back to a fresh lead if no telegraph ran (e.g. a test
        // that drives the commit directly).
        let dx = e.bossChargeDirX, dy = e.bossChargeDirY;
        if (dx == null) {
            const lead = leadPoint(e, player, atk.dashSpeed ?? 600);
            const ang = Math.atan2(lead.y - e.y, lead.x - e.x);
            dx = Math.cos(ang); dy = Math.sin(ang);
        }
        e.bossDashDirX = dx;
        e.bossDashDirY = dy;
        e.bossDashSpeed = atk.dashSpeed ?? 600;
        e.bossDashTimer = atk.dashDuration ?? 0.6;
        e.bossChargeDirX = null; // consumed
        e.bossChargeDirY = null;
    } else if (atk.kind === 'wall' && out.enemyProjectiles) {
        // A broad wall of bolts sweeping toward the player with ONE gap to
        // sprint through — forces a read + reposition, not a sidestep.
        const ang = Math.atan2(player.y - e.y, player.x - e.x);
        const px = -Math.sin(ang), py = Math.cos(ang); // unit perpendicular
        const count = atk.count ?? 13;
        const spacing = atk.spacing ?? 72;
        const spd = atk.projectileSpeed ?? 360;
        const gapHalf = atk.gap ?? 2;
        // Vary the gap location each cast (reuse the rotating spiral phase as a
        // cheap pseudo-random so successive walls don't share a safe lane).
        const gapIdx = Math.floor((((e.spiralPhase * 0.4) % 1) + 1) % 1 * count);
        e.spiralPhase = (e.spiralPhase + 1.7) % TWO_PI;
        for (let i = 0; i < count; i++) {
            if (Math.abs(i - gapIdx) <= gapHalf) continue; // leave the gap
            const off = (i - (count - 1) / 2) * spacing;
            const ox = e.x + px * off, oy = e.y + py * off;
            out.enemyProjectiles.push(new EnemyProjectile(
                ox, oy, Math.cos(ang) * spd, Math.sin(ang) * spd, atk.projectileDamage ?? 16,
                { sourceLabel: src }));
        }
    } else if (atk.kind === 'seekers' && out.enemyProjectiles) {
        // A handful of slow HOMING orbs fanned out — they curve after the
        // player, so you can't just stand still after the first dodge.
        const count = atk.count ?? 4;
        const base = Math.atan2(player.y - e.y, player.x - e.x);
        const spd = atk.projectileSpeed ?? 420;
        for (let i = 0; i < count; i++) {
            const a = base + (count > 1 ? (i / (count - 1) - 0.5) * 1.6 : 0);
            out.enemyProjectiles.push(new EnemyProjectile(
                e.x, e.y, Math.cos(a) * spd, Math.sin(a) * spd, atk.projectileDamage ?? 26, {
                    homing: true, turnRate: atk.turnRate ?? 3.6, maxSpeed: atk.maxSpeed ?? 600,
                    color: atk.color, lifetime: 5.0, sourceLabel: src,
                }));
        }
    } else if (atk.kind === 'zones' && out.hazards) {
        // Delayed AoE: telegraphed danger circles bloom around the player, then
        // detonate — pressures the player to keep MOVING, not turtle near the boss.
        const count = atk.count ?? 5;
        const spread = atk.spreadRadius ?? 360;
        const r = atk.zoneRadius ?? 150;
        for (let i = 0; i < count; i++) {
            // First zone lands on the player's lead point; the rest scatter
            // around them so there's always somewhere to run.
            let zx, zy;
            if (i === 0) {
                const lead = leadPoint(e, player, 9999);
                zx = lead.x; zy = lead.y;
            } else {
                const a = Math.random() * TWO_PI;
                const rr = spread * (0.3 + Math.random() * 0.7);
                zx = player.x + Math.cos(a) * rr;
                zy = player.y + Math.sin(a) * rr;
            }
            out.hazards.push({
                kind: 'delayedZone', x: zx, y: zy, r, damage: atk.damage ?? 24,
                age: 0, lifetime: atk.warn ?? 0.85, hitPlayer: false, detonateAge: 0, active: true,
            });
        }
    } else if (atk.kind === 'summon' && out.summons) {
        // Queue a themed minion call for the Game to fulfill (it owns spawn
        // placement, wave scaling, and the live enemy cap).
        out.summons.push({
            x: e.x, y: e.y,
            count: atk.summonCount ?? 3,
            types: atk.summonTypes ?? null,
            bossOwnerId: e.boss ? e.type : null,
        });
    } else if (atk.kind === 'aimed' && out.enemyProjectiles) {
        // SIGNATURE — precise lead volley: a tight cluster fired straight at
        // where the player is HEADED. Punishes standing still; read it and take
        // one crisp sidestep. (Distinct from the radial `fan`.)
        const lead = leadPoint(e, player, atk.projectileSpeed ?? 560);
        const base = Math.atan2(lead.y - e.y, lead.x - e.x);
        const count = atk.count ?? 3;
        const spread = atk.spread ?? 0.18;
        const spd = atk.projectileSpeed ?? 560;
        for (let i = 0; i < count; i++) {
            const a = base + (count > 1 ? (i / (count - 1) - 0.5) * spread : 0);
            out.enemyProjectiles.push(new EnemyProjectile(
                e.x, e.y, Math.cos(a) * spd, Math.sin(a) * spd, atk.projectileDamage ?? 18,
                { ...(atk.color ? { color: atk.color } : {}), sourceLabel: src }));
        }
    } else if (atk.kind === 'cross' && out.enemyProjectiles) {
        // SIGNATURE — rotating lattice: bolts along N evenly-spaced axes, the
        // whole cross turning each cast. Weave between the spinning arms.
        const arms = atk.arms ?? 4;
        const perArm = atk.perArm ?? 3;
        const spd = atk.projectileSpeed ?? 360;
        e.spiralPhase = (e.spiralPhase + (atk.spin ?? 0.4)) % TWO_PI;
        for (let k = 0; k < arms; k++) {
            const a = e.spiralPhase + (k / arms) * TWO_PI;
            for (let j = 1; j <= perArm; j++) {
                const s = spd * (0.55 + 0.45 * (j / perArm)); // staggered speeds → a line of bolts
                out.enemyProjectiles.push(new EnemyProjectile(
                    e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, atk.projectileDamage ?? 14,
                    { ...(atk.color ? { color: atk.color } : {}), sourceLabel: src }));
            }
        }
    } else if (atk.kind === 'spiralArms' && out.enemyProjectiles) {
        // SIGNATURE — pinwheel: several streams offset around the circle, all
        // rotating together. Orbit against the spin to thread it.
        const arms = atk.arms ?? 3;
        const spd = atk.projectileSpeed ?? 380;
        e.spiralPhase = (e.spiralPhase + (atk.spin ?? 0.5)) % TWO_PI;
        for (let k = 0; k < arms; k++) {
            const a = e.spiralPhase + (k / arms) * TWO_PI;
            out.enemyProjectiles.push(new EnemyProjectile(
                e.x, e.y, Math.cos(a) * spd, Math.sin(a) * spd, atk.projectileDamage ?? 13,
                { ...(atk.color ? { color: atk.color } : {}), sourceLabel: src }));
        }
    } else if (atk.kind === 'rain' && out.hazards) {
        // SIGNATURE — targeted bombardment: a cluster of delayed circles that
        // all bloom ON the player (tight jitter), staggered so they detonate in
        // a walking sequence. You must fully relocate, not micro-dodge.
        const count = atk.count ?? 6;
        const r = atk.zoneRadius ?? 120;
        const jitter = atk.jitter ?? 150;
        for (let i = 0; i < count; i++) {
            const lead = leadPoint(e, player, 9999);
            const a = Math.random() * TWO_PI;
            const rr = Math.random() * jitter;
            out.hazards.push({
                kind: 'delayedZone', x: lead.x + Math.cos(a) * rr, y: lead.y + Math.sin(a) * rr,
                r, damage: atk.damage ?? 24, age: 0,
                lifetime: (atk.warn ?? 0.8) + i * (atk.stagger ?? 0.12),
                hitPlayer: false, detonateAge: 0, active: true,
            });
        }
    } else if (atk.kind === 'mines' && out.hazards) {
        // SIGNATURE — area denial: a ring of delayed circles AROUND THE BOSS,
        // forcing the player out to mid-range to keep fighting.
        const count = atk.count ?? 8;
        const ring = atk.ringRadius ?? 220;
        const r = atk.zoneRadius ?? 110;
        e.spiralPhase = (e.spiralPhase + 0.6) % TWO_PI;
        for (let i = 0; i < count; i++) {
            const a = (i / count) * TWO_PI + e.spiralPhase;
            out.hazards.push({
                kind: 'delayedZone', x: e.x + Math.cos(a) * ring, y: e.y + Math.sin(a) * ring,
                r, damage: atk.damage ?? 22, age: 0, lifetime: atk.warn ?? 0.9,
                hitPlayer: false, detonateAge: 0, active: true,
            });
        }
    } else if (atk.kind === 'beam' && out.hazards) {
        // SIGNATURE — a SWEEPING LASER: a solid line from the boss that telegraphs,
        // then rotates across an arc. Genuinely different — you don't dodge a
        // burst, you stay OFF the line and run around the sweep. Aimed to start
        // just behind the player's lead so the sweep chases across them.
        const lead = Math.atan2(player.y - e.y, player.x - e.x);
        const sweep = atk.sweep ?? 1.7;
        const dir = (e.spiralPhase % 2 < 1) ? 1 : -1; // alternate sweep direction each cast
        e.spiralPhase = (e.spiralPhase + 1) % TWO_PI;
        out.hazards.push({
            kind: 'beam', x: e.x, y: e.y,
            angle: lead - dir * sweep / 2, sweep: dir * sweep,
            length: atk.length ?? 1000, band: atk.band ?? 30,
            damage: atk.damage ?? 26, warn: atk.warn ?? 0.7, curAngle: lead - dir * sweep / 2,
            age: 0, lifetime: (atk.warn ?? 0.7) + (atk.duration ?? 1.3),
            color: atk.color ?? '#ff5a3c', active: true,
        });
    } else if (atk.kind === 'lingering' && out.hazards) {
        // SIGNATURE — LINGERING FIELDS: pools that telegraph, then SIT for
        // several seconds dealing damage-over-time. Not a burst to sidestep —
        // they reshape the arena into shrinking safe ground you must route around.
        const count = atk.count ?? 4;
        const r = atk.zoneRadius ?? 135;
        const spread = atk.spread ?? 380;
        for (let i = 0; i < count; i++) {
            const a = Math.random() * TWO_PI;
            const rr = i === 0 ? 0 : spread * (0.25 + Math.random() * 0.75);
            const cxp = (i === 0 ? player.x : player.x + Math.cos(a) * rr);
            const cyp = (i === 0 ? player.y : player.y + Math.sin(a) * rr);
            out.hazards.push({
                kind: 'lingering', x: cxp, y: cyp, r,
                tickDamage: atk.tickDamage ?? 10, warn: atk.warn ?? 0.6,
                age: 0, lifetime: (atk.warn ?? 0.6) + (atk.duration ?? 4.0),
                tickTimer: 0, color: atk.color ?? '#ff7a33', active: true,
            });
        }
    }
    // Only hazards created by this commit inherit duel ownership. Lieutenant
    // moves use the same vocabulary but are deliberately left alone.
    if (e.boss && out.hazards) {
        for (let i = hazardStart; i < out.hazards.length; i++) out.hazards[i].bossOwned = true;
    }
}
