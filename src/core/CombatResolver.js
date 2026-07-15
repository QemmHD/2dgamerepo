// Combat resolution + the kill/drop reward flow. Split out of Game.js as part of
// the "move code, don't change behavior" decomposition: these are the exact same
// methods, relocated onto Game.prototype via Object.assign in Game.js, so every
// this._resolveCombat()/this._dropX() call resolves unchanged. `this` is the Game
// instance throughout.
//
// Owns: _resolveCombat (contact + projectile collisions merged with the kill/hit
// reward pipeline), the loot drops (_dropChest, _dropBossReward, _dropCoin,
// _dropCoinBurst, _dropGem), and the on-death consequences (_applyAffixDeath
// bursts, _splitOnDeath spawns). _resolveCombat is fed { killed, hits } results
// by the update pipeline (GameUpdate.js) and merges ult / status / hazard kills.

import {
    SCREEN_SHAKE,
    GEM,
    HEALTH_DROP,
    CHEST,
    COIN,
    WICK_ROADS,
    LIEUTENANT,
} from '../config/GameConfig.js';
import { TWO_PI } from './MathUtils.js';
import { BOSS_SPAWN_PROVENANCE, Enemy } from '../entities/Enemy.js';
import { XPGem } from '../entities/XPGem.js';
import { Chest } from '../entities/Chest.js';
import { Shrine } from '../entities/Shrine.js';
import { Coin } from '../entities/Coin.js';
import { HealthOrb } from '../entities/HealthOrb.js';
import { DamageNumber } from '../entities/DamageNumber.js';

// Death-burst tint per enemy type (boss/elite handled separately).
const DEATH_COLORS = {
    slime: '#7be08a',
    bat: '#b48cff',
    crawler: '#9a7cff',
    brute: '#d8a060',
    // P1.3 behavior types burst in their tell color.
    splitter: '#b48cff',
    bomber: '#ffd166',
    summoner: '#c97bff',
    teleporter: '#7fe0ff',
};
function deathColor(e) {
    if (e.boss) return '#ffd27a';
    if (e.elite) return '#ffe08a';
    return DEATH_COLORS[e.type] ?? '#ffcaa0';
}

// Enemy XP is authored per creature and already includes the elite multiplier
// on Enemy.xpValue. Keep that economy authoritative while retaining the
// existing three pickup silhouettes: one corpse always creates ONE gem whose
// stored value is exact, and the tier only communicates the size of the haul.
export function normalizeEnemyXp(value) {
    return Number.isFinite(value) && value > 0 ? value : GEM.small.xp;
}

export function gemTierForXp(value) {
    const xp = normalizeEnemyXp(value);
    if (xp >= GEM.large.xp) return 'large';
    if (xp >= GEM.medium.xp) return 'medium';
    return 'small';
}

export const CombatResolverMethods = {
    _dropChest(x, y) {
        const s = this._clearSpot(x, y, 40);
        this.chests.push(new Chest(s.x, s.y));
    },
    // Boss reward: spawn a treasure chest AND a Wick Shrine to either side of the
    // death point. They're linked as siblings — walking onto one claims it and
    // despawns the other, so the player PICKS ONE (chest reward or relic altar).
    _dropBossReward(x, y, placement = null) {
        const off = WICK_ROADS.bossRewardOffset;
        const chestTarget = placement?.chest || { x: x - off, y };
        const shrineTarget = placement?.shrine || { x: x + off, y };
        const cs = this._clearSpot(chestTarget.x, chestTarget.y, 40);
        const ss = this._clearSpot(shrineTarget.x, shrineTarget.y, 40);
        const pickupOptions = {
            pickupDelay: placement?.pickupDelaySeconds,
            requiresExitBeforePickup: placement?.requiresExitBeforePickup === true,
        };
        const chest = new Chest(cs.x, cs.y, pickupOptions);
        const shrine = new Shrine(ss.x, ss.y, pickupOptions);
        chest._sibling = shrine;
        shrine._sibling = chest;
        this.chests.push(chest);
        this.shrines.push(shrine);
    },
    _dropCoin(x, y, value = 1) {
        // KINDLED — Sylphine's Zephyr Windfall: a 4s window where kills pay 2×
        // coins (the single coin-drop choke, so bursts inherit it for free).
        if (this._coinWindfallTimer > 0) value *= 2;
        if (this.obstacleSystem.isBlocked(x, y, 18)) { const s = this._clearSpot(x, y, 18); x = s.x; y = s.y; }
        this.coins.push(new Coin(x, y, value));
    },
    _dropCoinBurst(x, y, count, value) {
        for (let i = 0; i < count; i++) {
            const ox = x + (Math.random() - 0.5) * 36;
            const oy = y + (Math.random() - 0.5) * 36;
            this._dropCoin(ox, oy, value);
        }
    },
    // Elite affix on-death effects. Volatile detonates an AoE; Splitting
    // bursts into a few crawlers (non-elite, so no recursive splitting).
    _applyAffixDeath(e, enqueueDeath) {
        const def = e.affixDef;
        if (!def) return;
        if (e.affix === 'volatile') {
            // A crowd-damaging blast should never be silent (muffled thump).
            if (this._inView(e.x, e.y, 120)) this.audio.volatileBoom();
            const r2 = def.explodeRadius * def.explodeRadius;
            for (const other of this.enemies) {
                if (!other.active || other === e) continue;
                const dx = other.x - e.x;
                const dy = other.y - e.y;
                if (dx * dx + dy * dy > r2) continue;
                other.takeDamage(def.explodeDamage);
                this.damageNumbers.push(new DamageNumber(
                    other.x, other.y - other.radius, def.explodeDamage, '#ffae66'
                ));
                // A blast kill joins the SAME canonical corpse queue as weapon,
                // hazard, status, and collision kills. The queue dedupes object
                // identity and marks collateral to suppress its own rolled affix,
                // so volatile clumps cannot recursively chain-detonate.
                if (!other.active) {
                    enqueueDeath?.(other, { suppressAffix: true });
                }
            }
            // AoE ring + ember burst + a light kick so the blast reads.
            this.weaponSystem.effects.push({
                kind: 'pulse', x: e.x, y: e.y, radius: def.explodeRadius,
                age: 0, lifetime: 0.4, active: true,
            });
            this.particles.deathBurst(e.x, e.y, def.tint);
            this._shake(SCREEN_SHAKE.intensity * 0.6, 0.25);
        } else if (e.affix === 'splitting') {
            const count = def.spawnCount ?? 2;
            const type = def.spawnType ?? 'crawler';
            // Alive-cap gated per child (same as _splitOnDeath below): a
            // twilight AoE wipe can pop many splitting affixes in one frame,
            // and an on-death spawn must not burst past maxAlive.
            const cap = this.waveState?.maxAlive ?? 120;
            let live = 0;
            for (const o of this.enemies) if (o.active) live++;
            for (let i = 0; i < count; i++) {
                if (live >= cap) break;
                const a = (i / count) * TWO_PI + Math.random() * 0.5;
                const ox = e.x + Math.cos(a) * 40;
                const oy = e.y + Math.sin(a) * 40;
                this.enemies.push(new Enemy(type, ox, oy, {
                    healthMul: this.waveState.healthMul,
                    speedMul: this.waveState.speedMul,
                }));
                live++;
            }
        }
    },
    // P1.3 splitter (def.splitInto) on-death burst: children spawn WEAKENED
    // (hpFrac of the live wave scale) as plain types — never elite, never a
    // splitter — so a split can't recurse or double-dip the reward path
    // (children pay their own small XP when the player actually kills them).
    _splitOnDeath(e) {
        const s = e.def.splitInto;
        const count = s.count ?? 2;
        // Alive-cap gated like every other mid-fight spawn path (summoner
        // calls, boss support, pack spawns): re-check before EACH child so an
        // AoE wipe of a splitter clump can't burst past maxAlive.
        const cap = this.waveState?.maxAlive ?? 120;
        let live = 0;
        for (const o of this.enemies) if (o.active) live++;
        for (let i = 0; i < count; i++) {
            if (live >= cap) break;
            const a = (i / count) * TWO_PI + Math.random() * 0.6;
            this.enemies.push(new Enemy(s.type ?? 'slime', e.x + Math.cos(a) * 46, e.y + Math.sin(a) * 46, {
                healthMul: this.waveState.healthMul * (s.hpFrac ?? 0.5),
                speedMul: this.waveState.speedMul,
                contactDamageMul: this.waveState.damageMul ?? 1,
            }));
            live++;
        }
    },
    // Contact/projectile collisions + the merged kill/hit reward pipeline
    // (gems, coins, chests, boss/lieutenant/elite setpieces, hit feedback).
    _resolveCombat(dt, weaponResult, statusResult, kindleResult = null) {
        const collisionResult = this.collisionSystem.resolve(
            dt, this.player, this.enemies, this.projectiles, this.spatialIndex
        );

        // Merge weapon-system hits/kills (orbit blades, pulse, lightning),
        // projectile-collision results, burn-DoT kills, and elite bomber
        // self-detonations so gem drops, kill count, affix deaths, and damage
        // numbers all flow through the same downstream path. (Burn damage
        // numbers are already pushed, tinted, inside _tickStatuses — so only
        // its killed list is merged here.)
        const initialKilled = collisionResult.killed
            .concat(weaponResult.killed, statusResult.killed, this._selfDetonated, this._hazardKilled,
                kindleResult ? kindleResult.killed : []);
        this._selfDetonated.length = 0;
        this._hazardKilled.length = 0;
        const allHits = collisionResult.hits.concat(weaponResult.hits, kindleResult ? kindleResult.hits : []);

        // Identity-dedupe every producer before rewards. Volatile collateral
        // appends to this queue while it drains, so every corpse (including a
        // boss) reaches this one canonical path exactly once.
        const deathQueue = [];
        const queuedDeaths = new Set();
        const enqueueDeath = (enemy, { suppressAffix = false } = {}) => {
            if (!enemy || queuedDeaths.has(enemy)) return false;
            queuedDeaths.add(enemy);
            deathQueue.push({ enemy, suppressAffix: suppressAffix === true });
            return true;
        };
        for (const enemy of initialKilled) enqueueDeath(enemy);

        let processedDeaths = 0;
        let killCuePlayed = false;
        while (processedDeaths < deathQueue.length) {
            // Tally each newly appended batch before its drops, preserving the
            // original lifesteal-before-health-orb reward ordering.
            const batchEnd = deathQueue.length;
            const batch = deathQueue.slice(processedDeaths, batchEnd).map(({ enemy }) => enemy);
            this.kills += batch.length;
            // KINDLED charge hook 1: feed the Kindle meter from this frame's
            // kills (reads e.elite/e.boss per corpse — no scan of the live field).
            this.kindleSystem.onKills(batch);
            this._addCombo(batch.length);
            if (!killCuePlayed) {
                this.audio.kill();
                killCuePlayed = true;
            }
            // Blooddrinker lifesteal-on-kill (capped by the sustained-heal budget).
            if (this.player.killHeal > 0) this.player.healSustained(this.player.killHeal * batch.length);
            this.waveDirector.notifyKill(batch.length);
            for (; processedDeaths < batchEnd; processedDeaths++) {
                const { enemy: e, suppressAffix } = deathQueue[processedDeaths];
                if (e.encounterMemberId) {
                    this._encounterDefeatedIds.push(e.encounterMemberId);
                    if (e.encounterGuardian) this._encounterRewardPos = { x: e.x, y: e.y };
                }
                if (e.ruinBellMemberId) this._ruinBellDefeatedIds.push(e.ruinBellMemberId);
                this.particles.deathBurst(e.x, e.y, deathColor(e));
                if (e.affix && !suppressAffix) this._applyAffixDeath(e, enqueueDeath);
                // P1.3 splitter: bursts into live slimelets (def-driven,
                // unlike the rolled elite 'splitting' AFFIX — both can fire
                // on an elite splitter, which is the fun kind of chaos).
                if (e.def.splitInto) this._splitOnDeath(e);
                this._dropGem(e.x, e.y, e.xpValue);
                // Rare health orb (skipped at full HP so it's never wasted).
                if (this.player.hp < this.player.maxHp && Math.random() < HEALTH_DROP.chance) {
                    this.healthOrbs.push(new HealthOrb(e.x, e.y));
                }
                if (e.boss) {
                    // End the duel cleanly: only bolts whose attribution says
                    // "boss" and hazards stamped by the apex commit path are
                    // retired. Biome hazards, bomber zones, and lieutenant
                    // attacks remain untouched. A queued boss summon must not
                    // arrive one frame after its caller dies.
                    for (const bolt of this.enemyProjectiles) {
                        if (bolt.active && bolt.sourceLabel?.boss) bolt.active = false;
                    }
                    for (const hazard of this.hazards) {
                        if (hazard.active && hazard.bossOwned) hazard.active = false;
                    }
                    for (const summoned of this.enemies) {
                        if (summoned.active && summoned.bossOwnerId === e.type) summoned.active = false;
                    }
                    this.bossSummons.length = 0;
                    // Bosses drop a coin burst + a PICK-ONE reward: a treasure
                    // chest OR a Wick Shrine (relic altar), spawned side by side —
                    // claiming one despawns the other.
                    this.bossesDefeated += 1;
                    // Campaign progress accepts only a normal-run boss whose
                    // provenance survived map director -> warning -> spawn ->
                    // Enemy. The map is the launch-time latch, never a mutable
                    // menu selection. SaveSystem independently rejects an active
                    // QA bypass as a second fail-closed boundary.
                    const bypassActive = this.saveSystem.getMapBypassActive?.() === true;
                    if (bypassActive && this.campaignRun) {
                        this.campaignRun.eligible = false;
                        this.campaignRun.taintReason = 'map-bypass';
                    }
                    if (this.campaignRun?.eligible === true
                        && e.bossSpawnProvenance === BOSS_SPAWN_PROVENANCE.MAP_DIRECTOR) {
                        const receipt = this.saveSystem.recordCampaignBossDefeat({
                            mapId: this.campaignRun.mapId,
                            bossId: e.type,
                            eligible: true,
                        });
                        this._latestCampaignBossDefeatReceipt = receipt;
                        if (receipt?.newlyUnlockedMapId) this._campaignUnlockReceipt = receipt;
                    }
                    // Progression differs by mode. Boss Rush owns its own sequence:
                    // it advances to the next boss's prep phase (or clears the whole
                    // gauntlet) and uses NONE of the normal-run boss plumbing — no
                    // trash director cooldown, no Lieutenant reset, no CROSSROADS
                    // fork, and no 3-boss victory rule. `bossRushCleared` opens the
                    // victory overlay below once the final apex falls.
                    let isFinalBoss = false;
                    let bossRushCleared = false;
                    if (this.bossRush) {
                        bossRushCleared = this.bossRush.notifyBossDefeated().cleared;
                    } else {
                        // Arm the post-death cooldown so the next boss doesn't
                        // chain in immediately after a late kill.
                        this.bossDirector.notifyBossDefeated(this.time);
                        // Re-center the Lieutenant for the new segment (endless: keeps
                        // firing one per boss-to-boss stretch).
                        this.lieutenantDirector.reset(this.time);
                        // Branching Roads: on every boss EXCEPT the run-ending 3rd
                        // (which opens the victory overlay), QUEUE a CROSSROADS fork.
                        // The end-of-update presenter opens it once no other overlay is
                        // up — deferring (not force-setting this.altar) so a same-frame
                        // level-up can't stack a hidden overlay under the fork's cards.
                        // In endless/gauntlet (_victoryShown latched), isFinalBoss is
                        // false forever after, so forks reappear after every boss.
                        isFinalBoss = (this.bossesDefeated >= 3 && !this._victoryShown);
                        if (!isFinalBoss) this.pendingCrossroads = true;
                    }
                    this._dropBossReward(e.x, e.y);
                    this._dropCoinBurst(e.x, e.y, COIN.bossCoinCount, COIN.bossCoinValue);
                    // Setpiece payoff: a banner, a heavy layered burst, and a
                    // strong shake so an apex kill lands.
                    this.waveDirector.announce(`${e.name.toUpperCase()} DEFEATED!`, 3.0, '#ff6a4a');
                    this.audio.bossDefeat();
                    this.haptics?.pulse?.('bossDefeat');
                    this.particles.bossDeathBurst(e.x, e.y, '#ff8c4a');
                    this._shake(SCREEN_SHAKE.intensity * 1.1, 0.5);
                    // Setpiece punch: a hard freeze-frame + a triple expanding
                    // shockwave so an apex kill really lands.
                    this._hitStop(0.12);
                    this._spawnRing(e.x, e.y, { maxR: 520, width: 16, life: 0.7, color: '#ffd0a0', ease: 'outCubic' });
                    this._spawnRing(e.x, e.y, { maxR: 360, width: 10, life: 0.55, color: '#ff8c4a' });
                    this._spawnRing(e.x, e.y, { maxR: 220, width: 7, life: 0.4, color: '#ffffff' });
                    // Back to the driving theme once the duel ends; lift the arena.
                    this.audio.playMusic('gameplay');
                    this.arena = null;
                    // Clearing the 3rd boss (normal) or the whole Boss Rush gauntlet
                    // is a milestone: open the victory overlay once per run.
                    if (isFinalBoss || bossRushCleared) {
                        this._victoryShown = true;
                        this._showVictory();
                    }
                } else if (e.lieutenant) {
                    // Lieutenant mini-boss down: a mid-tier reward beat — a ring, a
                    // coin burst, a chance at a chest, and a callout. Touches NONE of
                    // the boss state (bossesDefeated / crossroads / victory / arena).
                    this._spawnRing(e.x, e.y, { maxR: 260, width: 10, life: 0.55, color: LIEUTENANT.color, ease: 'outCubic' });
                    this._dropCoinBurst(e.x, e.y, LIEUTENANT.coinCount, LIEUTENANT.coinValue);
                    if (Math.random() < LIEUTENANT.chestChance) this._dropChest(e.x, e.y);
                    this.audio.lieutenantDown();
                    this.waveDirector.announce(`${e.name} SLAIN`, 2.5, LIEUTENANT.color);
                    this.particles.deathBurst(e.x, e.y, LIEUTENANT.color);
                    this._shake(SCREEN_SHAKE.intensity * 0.5, 0.25);
                } else if (e.elite) {
                    // Elite kills pop a small shockwave ring tinted to the affix.
                    this._spawnRing(e.x, e.y, {
                        maxR: 170, width: 8, life: 0.5,
                        color: e.affixColor || '#ffd166',
                    });
                    // Elites: chance at a chest, chance at a coin burst.
                    if (Math.random() < CHEST.eliteDropChance) {
                        this._dropChest(e.x, e.y);
                    }
                    if (Math.random() < COIN.eliteDropChance) {
                        const count = COIN.eliteCoinMin +
                            Math.floor(Math.random() *
                                Math.max(1, COIN.eliteCoinMax - COIN.eliteCoinMin + 1));
                        this._dropCoinBurst(e.x, e.y, count, 1);
                    }
                } else if (Math.random() < COIN.normalDropChance) {
                    // Normal enemies: small chance of a single coin.
                    this._dropCoin(e.x, e.y, 1);
                }
            }
        }
        // Hit sparks + floating numbers are both capped per frame so a wide
        // AoE hit (pulse/orbit/lightning striking a big crowd) can't drain the
        // particle pool or flood the damage-number array — a real perf + GC
        // win in dense fights, with negligible readability loss (you can't
        // read 80 overlapping numbers anyway). Damage is unaffected.
        let sparkBudget = 6;
        let numberBudget = 14;
        for (const hit of allHits) {
            if (numberBudget > 0) {
                // KINDLED combo bursts (SHATTER) tint their number via hit.color;
                // everything else stays the white default.
                this.damageNumbers.push(new DamageNumber(hit.x, hit.y, hit.amount, hit.color || '#ffffff'));
                numberBudget--;
            }
            if (sparkBudget > 0) {
                // Element-tinted impact: fire sparks warm, frost/freeze shatter
                // into shards, shock crackles yellow, everything else the white
                // default. Activates the frostShards/shockSparks emitters.
                const el = hit.element;
                if (el === 'fire') this.particles.hitSpark(hit.x, hit.y, '#ff7a33');
                else if (el === 'frost' || el === 'freeze') this.particles.frostShards(hit.x, hit.y);
                else if (el === 'shock') this.particles.shockSparks(hit.x, hit.y);
                else this.particles.hitSpark(hit.x, hit.y);
                sparkBudget--;
            }
        }
        if (collisionResult.playerHit) {
            if (collisionResult.strongest) this.lastHitBy = collisionResult.strongest;   // death-card attribution
            this._playerHurtShake(collisionResult.playerDamageTaken);
            this._pushFeedback('hit', 0.32);
            this.damageNumbers.push(new DamageNumber(
                this.player.x,
                this.player.y - this.player.radius,
                collisionResult.playerDamageTaken,
                '#ff4757'
            ));
        }
    },
    _dropGem(x, y, xpValue = GEM.small.xp) {
        const xp = normalizeEnemyXp(xpValue);
        const tier = gemTierForXp(xp);
        if (this.obstacleSystem.isBlocked(x, y, 16)) { const s = this._clearSpot(x, y, 16); x = s.x; y = s.y; }
        const gem = new XPGem(x, y, tier);
        // XPGem's tier owns art/radius/bounce; the corpse's authored value owns
        // progression. Stamping the flat public field avoids multiplying pickup
        // entities for high-value elites and 35-90 XP apexes.
        gem.xp = xp;
        this.gems.push(gem);
    },
};
