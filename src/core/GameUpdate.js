// Gameplay update pipeline. Split out of Game.js as part of the "move code,
// don't change behavior" decomposition: these are the exact same methods,
// relocated onto Game.prototype via Object.assign in Game.js, so `game.update(dt)`
// and every internal this._updateX() call resolve unchanged. `this` is the Game
// instance throughout; _resolveCombat (its own slice) still lives in Game.js and
// resolves via the prototype like any other method.
//
// Owns the per-frame step: the screen gate + feedback tick (update), the menu
// branch, combo/objectives, directors (waves/boss/lieutenant/hazards), player +
// weapons, enemies, projectiles, pickups, cosmetic world FX + the gfx governor,
// the reward-overlay presenters, and the enemy-scan / cull / cleanup +
// game-over check.

import {
    WORLD_WIDTH,
    WORLD_HEIGHT,
    SCREEN_SHAKE,
    BOSS,
    ELEMENT,
    CAPS,
    KINDLE,
    BLINK,
    LIGHT_COLORS,
    EMBERGLASS,
} from '../config/GameConfig.js';
import { clamp, compactInPlace } from './MathUtils.js';
import { Player } from '../entities/Player.js';
import { Enemy } from '../entities/Enemy.js';
import { XPGem } from '../entities/XPGem.js';
import { Chest } from '../entities/Chest.js';
import { Shrine } from '../entities/Shrine.js';
import { Coin } from '../entities/Coin.js';
import { DamageNumber } from '../entities/DamageNumber.js';
import { AUTO_AIM_RANGE } from '../systems/WeaponSystem.js';
import { HazardSystem } from '../systems/HazardSystem.js';

// Second Wind only regenerates when no enemy is within this radius.
const SECOND_WIND_RADIUS = 340;

// gem tier -> light color (shared with the render pipeline still in Game.js).
export function gemLightColor(tier) {
    if (tier === 'large') return LIGHT_COLORS.gemLarge;
    if (tier === 'medium') return LIGHT_COLORS.gemMedium;
    return LIGHT_COLORS.gemSmall;
}

export const GameUpdateMethods = {
    update(dt) {
        // Feedback flashes + press states tick on every screen so they
        // animate even while gameplay is frozen behind an overlay.
        this._updateFeedback(dt);

        // KINDLED: an overlay/pause/run-end opening mid-aim CANCELS the ult and
        // refunds the committed bar (the aim can't tick while the world is frozen,
        // and the spec fizzles-with-refund on interruption).
        if (this.kindleSystem && this.kindleSystem.aiming &&
            (this.upgradeChoices || this.chestReward || this.altar || this.paused || this.victory || this.gameOver)) {
            this.kindleSystem.refundAim();
            this.kindleSystem.aiming = null;
            if (this.player) this.player.aimMoveMul = 1;
        }

        // Death is authoritative and checked FIRST: if the player is dead,
        // enter game-over even when an overlay is open, so a queued-overlay
        // chain (chest reward → next overlay) can never strand a dead player
        // in a frozen world.
        if (this.screen === 'gameplay' && !this.gameOver && this.player.isDead()) {
            this._enterGameOver();
        }

        // EMBERGLASS: the Keeper's Lens freezes the world regardless of the
        // underlying screen (gameplay / paused / game-over) — only the detached
        // free-cam ticks. Strictly cheaper than gameplay, so never a perf risk.
        if (this.photoMode) { this._updatePhotoMode(dt); return; }

        // Meta-screen states never tick gameplay; the start screen still
        // ticks the reset-confirm timeout so the "tap again to confirm"
        // prompt times out cleanly.
        if (this.screen === 'start') {
            this._updateMenuScreen(dt);
            return;
        }
        if (this.screen === 'gameOver') {
            this.gameOverAge += dt;
            if (this.shareToast) { this.shareToast.timer -= dt; if (this.shareToast.timer <= 0) this.shareToast = null; }
            this.camera.update(dt);
            return;
        }
        if (this.upgradeChoices) {
            this.levelUpAge += dt;
            this.camera.update(dt);
            return;
        }
        if (this.chestReward) {
            // Tick the chest-overlay animation but freeze gameplay so the
            // world behind it stays exactly as it was when the chest opened.
            this.chestReward.age += dt;
            this.camera.update(dt);
            return;
        }
        if (this.altar) {
            // Wick Shrine altar overlay — freeze the world behind it (same as
            // chest/level-up); only the overlay animation + camera tick.
            this.altar.age += dt;
            this.camera.update(dt);
            return;
        }
        if (this.victory) {
            // 3rd-boss victory overlay: freeze the world behind it.
            this.victory.age += dt;
            if (this.shareToast) { this.shareToast.timer -= dt; if (this.shareToast.timer <= 0) this.shareToast = null; }
            this.camera.update(dt);
            return;
        }
        if (this.paused) {
            // Frozen world; only the camera settles.
            this.camera.update(dt);
            return;
        }

        // Hit-stop: freeze the simulation for a few frames on a heavy impact but
        // keep the camera (and its shake) animating, so the freeze reads as
        // weight rather than a stutter. Drained with real dt.
        if (this.hitStop > 0) {
            this.hitStop = Math.max(0, this.hitStop - dt);
            this.camera.update(dt);
            return;
        }

        this.time += dt;

        // KINDLED Focus Time: the KeyQ-hold aim tick may FIRE the ult this frame
        // (returns its {hits,killed}, else null). Runs on REAL dt — the meter,
        // the 2.5s auto-fire cap, and the aim angle are all wall-clock. While
        // aiming, the WORLD (enemies/projectiles/spawner/hazards) crawls at
        // focusTimeScale; player MOVE slows to playerAimSpeedMul (below); every
        // clock/economy/cooldown call stays on real dt.
        const kindleResult = this._updateKindleAim(dt);
        const _aiming = !!this.kindleSystem.aiming;
        const worldDt = _aiming ? dt * KINDLE.focusTimeScale : dt;
        this._updateKindleTimers(dt);
        // KINDLED touch verbs — drain the latched BLINK + FOCUS taps early (before
        // enemies/collision), so a blink's landing position is authoritative this
        // frame, matching the keyboard Space/Tab path. No-op sans touch buttons.
        this._updateTouchButtons();

        // KINDLED: snapshot the (cached) active boss's HP so we can charge the
        // Kindle meter by the fraction of its MAX HP dealt this frame — across
        // ALL damage sources (weapons, burn DoT, projectile collisions). One
        // read of the frame-stable ref; no per-frame enemy scan.
        const _kBoss = this.activeBossRef;
        const _kBossHp0 = (_kBoss && _kBoss.maxHp > 0) ? _kBoss.hp : null;

        this._updateComboAndObjectives(dt);
        this._updateDirectors(dt);
        this.kindleSystem.update(dt);   // tick the blink cooldown (real dt)
        const weaponResult = this._updatePlayerAndWeapons(dt, worldDt, _aiming);
        const statusResult = this._updateEnemies(worldDt);
        this._updateProjectiles(worldDt);
        // Boss area hazards (shockwaves, delayed zones, beams, lingering
        // pools) — simmed by the HazardSystem. Runs BEFORE the Second Wind
        // regen check so HP/i-frames stay consistent within the frame.
        // updateBiome first spawns this map's signature ground patches
        // (P1.2) into the same pool, so a fresh patch telegraphs this frame.
        this.hazardSystem.updateBiome(worldDt, this);
        this.hazardSystem.update(worldDt, this);
        this._updatePickups(dt);
        this._resolveCombat(dt, weaponResult, statusResult, kindleResult);
        // Charge the meter from boss damage dealt this frame (skip on heal/no-op).
        if (_kBossHp0 != null && _kBoss.hp < _kBossHp0) {
            this.kindleSystem.onBossDamage((_kBossHp0 - _kBoss.hp) / _kBoss.maxHp);
        }
        this._updateWorldFx(dt);
        this._updateRewardOverlays(dt);
        this._updateEnemyScanAndCleanup(dt);
    },

    // ── update() phase methods (P1.5 split) — one per sim stage, called in
    // exactly the order the old monolithic body ran ───────────────────────

    // Start-screen tick: reset-confirm timeout, minigame overlays, toast.
    _updateMenuScreen(dt) {
        if (this.resetConfirming) {
            this.resetConfirmTimer -= dt;
            if (this.resetConfirmTimer <= 0) this.resetConfirming = false;
        }
        this.minigame.update(dt);
        if (this.menuToastTimer > 0) this.menuToastTimer -= dt;
    },

    // Combo decay + run-objective checks.
    _updateComboAndObjectives(dt) {
        // Combo decay: the streak lapses if no kill lands inside the window.
        if (this.comboTimer > 0) {
            this.comboTimer -= dt;
            if (this.comboTimer <= 0) { this.combo = 0; this._comboMilestoneIdx = 0; }
        }
        this._checkObjectives();
    },

    // Wave/boss/lieutenant direction: wave-state rebuild + announcements,
    // boss + lieutenant scheduling/warnings, boss-summon drain, and the boss
    // HP-threshold phases.
    _updateDirectors(dt) {
        this.waveDirector.update(dt, this.time, this.enemies.length);
        this.waveState = this._applyRunScale(this.waveDirector.getState(this.time));
        // Feed the composure gate: how far the time-based endless damage ramp has
        // climbed (0 through the whole normal campaign). The player's takeDamage
        // uses this to relieve the surcharge for clean play — see COMPOSURE.
        if (this.player) this.player.endlessSurcharge = this.waveState.endlessDamageSurcharge ?? 0;
        // TWILIGHT onset — announce the elite-army climax once, with a cue.
        if (this.waveState.twilight && !this._twilightAnnounced) {
            this._twilightAnnounced = true;
            this.waveDirector.announce('✦ TWILIGHT — THE HORDE TURNS ✦', 3.6, '#c97bff');
            this.audio.dreadDrone();
            this._shake(SCREEN_SHAKE.intensity * 0.7, 0.5);
        }
        // HYPERGROWTH onset — the wall begins; enemies now compound every minute.
        if ((this.waveState.hyperMul ?? 1) > 1 && !this._hyperAnnounced) {
            this._hyperAnnounced = true;
            this.waveDirector.announce('☠ THE DARK DEVOURS — FLEE OR FALL ☠', 4.0, '#ff3326');
            this.audio.dreadDrone();
            this._shake(SCREEN_SHAKE.intensity * 0.9, 0.6);
        }
        // Wave transition: one low horn swell as the Vigil index advances (the
        // banner is queued by WaveDirector). time<1 resyncs the latch per run.
        if (this.time < 1 || this._lastWaveIdx === undefined) this._lastWaveIdx = this.waveState.index;
        else if (this.waveState.index !== this._lastWaveIdx) {
            this._lastWaveIdx = this.waveState.index;
            this.audio.waveStart();
        }

        // One boss at a time: gate the scheduler on a live "is any boss alive"
        // check so a scheduled spawn is held (not stacked) while one is active.
        // A scheduled boss first opens a WARNING window (BOSS INCOMING) so the
        // player can reposition; it actually spawns when the warning expires.
        const bossAlive = this.enemies.some((e) => e.active && e.boss);
        if (!bossAlive && !this.bossWarning) {
            const bossId = this.bossDirector.update(this.time, bossAlive);
            if (bossId) this._startBossWarning(bossId);
        }
        if (this.bossWarning) {
            this.bossWarning.timer -= dt;
            if (this.bossWarning.timer <= 0) {
                const id = this.bossWarning.id;
                this.bossWarning = null;
                this._spawnBoss(id);
            }
        }
        // Lieutenant: one mid-segment mini-boss per boss window. Gated on NO boss
        // incoming/alive AND no live lieutenant so it never overlaps the boss
        // setpiece; the swarm keeps running (unlike a boss). A short telegraph
        // precedes the spawn. `bossAlive` is reused from the boss gate above.
        const lieutenantAlive = this.enemies.some((e) => e.active && e.lieutenant);
        if (!bossAlive && !this.bossWarning && !this.lieutenantWarning && !lieutenantAlive) {
            if (this.lieutenantDirector.update(this.time)) this._startLieutenantWarning();
        }
        if (this.lieutenantWarning) {
            // If a boss window opened during the telegraph (a late boss kill can
            // push the next boss warning into it), cancel the Lieutenant so it
            // never spawns into the boss setpiece — it re-arms next segment.
            if (bossAlive || this.bossWarning) {
                this.lieutenantWarning = null;
            } else {
                this.lieutenantWarning.timer -= dt;
                if (this.lieutenantWarning.timer <= 0) {
                    const t = this.lieutenantWarning.type;
                    this.lieutenantWarning = null;
                    this._spawnLieutenant(t);
                }
            }
        }
        // Drain any queued boss summon requests into themed, capped spawns.
        if (this.bossSummons.length) {
            for (const s of this.bossSummons) this._spawnBossSupport(s.x, s.y, s.count, s.types);
            this.bossSummons.length = 0;
        }
        // Boss HP-threshold phases (75/50/25%) — one-shot support + aggression.
        this._updateBossThresholds();
    },

    // Player movement/caps/aura, the trash-spawner gate, and weapon fire.
    // Returns the weapon system's { killed, hits } for _resolveCombat.
    _updatePlayerAndWeapons(dt, worldDt = dt, aiming = false) {
        // KINDLED Focus-Time: while aiming an ult the hero moves at ×0.60. Folded
        // into Player speed (aimMoveMul) — only travel shrinks; player.update
        // keeps REAL dt so cast/composure/anim timers stay wall-clock.
        this.player.aimMoveMul = aiming ? KINDLE.playerAimSpeedMul : 1;
        // KINDLED Focus targeting — auto-clear the lock when the target dies or
        // drifts out of range for 2s (enemies aren't pooled, so a dead ref would
        // otherwise linger and the wand would aim at a corpse).
        if (this.focusTarget) {
            const ft = this.focusTarget;
            if (!ft.active) { this.focusTarget = null; this._focusOutOfRangeT = 0; }
            else {
                const dx = ft.x - this.player.x, dy = ft.y - this.player.y;
                if (dx * dx + dy * dy > AUTO_AIM_RANGE * AUTO_AIM_RANGE) {
                    this._focusOutOfRangeT += dt;
                    if (this._focusOutOfRangeT >= 2) { this.focusTarget = null; this._focusOutOfRangeT = 0; }
                } else this._focusOutOfRangeT = 0;
            }
        }
        this.player.update(dt, this.input);
        // First-run onboarding hints advance off live play (movement, gems,
        // level) — ticked right after the player moves so step 0's distance
        // accumulator sees this frame's step.
        if (this.onboarding) this._tickOnboarding(dt);
        // Late-game flattening: clamp the global stacking stats every frame
        // (before weapons read them). Hard caps are idempotent on these
        // monotonic-growth fields; weapon per-level stats are unaffected.
        this._applyPlayerCaps();
        // Recompute the weapon-driven aura (cheap; cached unless the owned set
        // changed). Reduced-effects mode skips the extra additive glow sprite.
        this._updateAura();
        // Slide the player out of any wall they walked into (tangential motion
        // is preserved by resolveCircle, so they glide along obstacles).
        {
            const r = this.obstacleSystem.resolveCircle(this.player.x, this.player.y, this.player.radius);
            this.player.x = r.x; this.player.y = r.y;
        }
        // Boss arena: confine the player inside the ring (can't flee the fight).
        if (this.arena) this._confineToArena(this.player, this.player.radius);
        // Boss = main event: while a boss is incoming or alive, halt the normal
        // trash spawner so the fight is the player vs. the boss (and only the
        // boss's own themed adds), not a swarm. Normal spawns resume once the
        // boss is dead.
        const bossOnField = !!this.bossWarning || this.enemies.some((e) => e.active && e.boss);
        if (!bossOnField) {
            // Spawner slows with the world during Focus Time (worldDt).
            this.spawner.update(worldDt, this.player, this.enemies, this.waveState, this.obstacleSystem, this.waveDirector);
        }
        // Fire burn scales with run progress (boss clears + minutes) so the
        // FIRE line keeps biting through scaled late-game enemy HP. Read by the
        // ember/inferno weapons off the player (their shared ctx carrier).
        const fc = ELEMENT.fire;
        this.player.fireRoundScale = Math.min(
            fc.burnScaleMax ?? 3.0,
            1 + this.bossesDefeated * (fc.burnPerBoss ?? 0) + (this.time / 60) * (fc.burnPerMinute ?? 0)
        );
        // Weapons keep REAL dt (the hero auto-fires at normal cadence during a
        // hold; the bolts then crawl because _updateProjectiles is worldDt-scaled
        // — that IS the bullet-time look). Focus target threaded so single-target
        // weapons concentrate fire on the lock.
        const weaponResult = this.weaponSystem.update(
            dt, this.player, this.enemies, this.projectiles, this.obstacleSystem, this.particles, this.audio, this.focusTarget, this.projectilePool
        );

        // Held weapon: aim the signature wand (owned[0], the menu-chosen
        // starter) at the nearest enemy — it points at what it shoots. With no
        // target, it rests along the hero's facing so it never snaps to a
        // stale angle. Snapshot the owned visuals for Player.draw, and hold the
        // cast pose whenever the primary weapon fires this frame.
        this.player.loadout = this.weaponSystem.getOwnedVisuals();
        // KINDLED Focus targeting: a locked target in range wins the wand aim, so
        // a held ult released with no movement fires at the focus. Falls back to
        // the nearest-enemy scan otherwise.
        let aimBest = null, aimD = Infinity;
        const ft = this.focusTarget;
        if (ft && ft.active) {
            const fdx = ft.x - this.player.x, fdy = ft.y - this.player.y;
            if (fdx * fdx + fdy * fdy <= AUTO_AIM_RANGE * AUTO_AIM_RANGE) { aimBest = ft; aimD = fdx * fdx + fdy * fdy; }
        }
        if (!aimBest) for (const e of this.enemies) {
            if (!e.active) continue;
            const dx = e.x - this.player.x, dy = e.y - this.player.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < aimD) { aimD = d2; aimBest = e; }
        }
        if (aimBest) {
            this.player.aimAngle = Math.atan2(aimBest.y - this.player.y, aimBest.x - this.player.x);
        } else {
            const f = this.player.facing;
            this.player.aimAngle = f === 'up' ? -Math.PI / 2 : f === 'left' ? Math.PI
                : f === 'right' ? 0 : Math.PI / 2;
        }
        const primaryWeapon = this.weaponSystem.owned[0];
        if (primaryWeapon && primaryWeapon.firedThisFrame) this.player.triggerCast();
        return weaponResult;
    },

    // Enemy movement + wall/arena resolve, soft separation, burn DoT, and
    // support (healer/shielder) auras. Returns the burn tick's
    // { killed, hits } for _resolveCombat.
    _updateEnemies(dt) {
        for (const e of this.enemies) {
            if (!e.active) continue;
            // Windup-timer TRANSITIONS drive every behavior's commit + cues
            // (the windup IS the dodge warning): charger brace/dash, and the
            // P1.3 bomber plant/boom, summoner call, teleporter blink, and
            // lieutenant specials all ride the same before/after check.
            const wasWinding = e.windupTimer > 0;
            e.update(dt, this.player, this.enemyProjectiles, this.obstacleSystem);
            if (e.type === 'charger' && this._inView(e.x, e.y, 0)) {
                if (!wasWinding && e.windupTimer > 0) this.audio.chargerWindup();
                else if (wasWinding && e.windupTimer <= 0) this.audio.chargerDash();
            } else if (e.behavior === 'bomber') {
                if (!wasWinding && e.windupTimer > 0) {
                    // Bomber planted: paint the blast circle as a delayedZone
                    // (the hazard pool owns the detonation damage + flash, so
                    // the dodge behaves exactly like a telegraphed boss zone —
                    // LOS-checked, i-frame gated). Fires even if the bee dies
                    // mid-windup: the warning that was painted stays honest.
                    this.hazards.push({
                        kind: 'delayedZone', x: e.x, y: e.y, r: e.def.blastRadius,
                        damage: e.blastDamage, age: 0, lifetime: e.def.windup,
                        hitPlayer: false, detonateAge: 0, active: true,
                    });
                    if (this._inView(e.x, e.y, 0)) this.audio.chargerWindup();
                } else if (wasWinding && e.windupTimer <= 0 && e.active) {
                    // Commit: the bee dies in its own blast. A PLAIN bomber is
                    // deliberately NOT routed through the kill/reward path — a
                    // self-detonation pays no XP/kill for standing clear. An
                    // ELITE bomber still owes its rolled loot (affix death,
                    // chest/coin roll, gem, kill credit), so it detonates INTO
                    // the normal pipeline via _selfDetonated instead of
                    // leaking the rewards its elite roll promised.
                    e.active = false;
                    if (e.elite) this._selfDetonated.push(e);
                    else this.particles.deathBurst(e.x, e.y, '#ff9a4a');
                    if (this._inView(e.x, e.y, 120)) this.audio.volatileBoom();
                }
            } else if (e.behavior === 'summoner') {
                if (!wasWinding && e.windupTimer > 0) {
                    if (this._inView(e.x, e.y, 0)) this.audio.chargerWindup();
                } else if (wasWinding && e.windupTimer <= 0) {
                    // Call fulfilled through _spawnBossSupport — the SAME
                    // alive-cap gate boss summons use, so summon pressure can
                    // never blow past the wave cap / maxEnemyCap.
                    this._spawnBossSupport(e.x, e.y, e.def.summonCount ?? 3, e.def.summonTypes);
                    if (this._inView(e.x, e.y, 0)) this.audio.healerPulse();
                }
            } else if (e.behavior === 'teleporter') {
                if (wasWinding && e.windupTimer <= 0) {
                    // Blink committed (the enemy moved itself): sparkle both
                    // ends so the vanish/arrive reads even at screen edge.
                    this.particles.pickupSparkle(e._blinkFromX, e._blinkFromY, '#7fe0ff');
                    this.particles.pickupSparkle(e.x, e.y, '#7fe0ff');
                    if (this._inView(e.x, e.y, 0)) this.audio.dash();
                }
            } else if (e.lieutenant) {
                // Lieutenant specials: windup/commit cues (the gold charge arc
                // + any ground telegraph are painted by Enemy/commitBossAttack).
                if (!wasWinding && e.windupTimer > 0) { if (this._inView(e.x, e.y, 0)) this.audio.chargerWindup(); }
                else if (wasWinding && e.windupTimer <= 0) { if (this._inView(e.x, e.y, 0)) this.audio.bossAttack(); }
            }
            // Enemies (including elites + bosses) can't walk through walls.
            // Resolving after their move keeps them chasing while sliding along
            // obstacles instead of clipping through or stacking inside them.
            const r = this.obstacleSystem.resolveCircle(e.x, e.y, e.radius);
            // Clamp to world bounds too (Enemy.update doesn't, unlike Player) so
            // a wall push-out near an edge can't drift an enemy off the map.
            e.x = clamp(r.x, -WORLD_WIDTH / 2 + e.radius, WORLD_WIDTH / 2 - e.radius);
            e.y = clamp(r.y, -WORLD_HEIGHT / 2 + e.radius, WORLD_HEIGHT / 2 - e.radius);
            // Keep the boss inside its own arena so it can't be kited out of it.
            if (this.arena && e.boss) this._confineToArena(e, e.radius);
        }
        // Soft enemy-vs-enemy separation so a swarm doesn't collapse onto one
        // pixel (runs after movement + obstacle resolve so it can't shove an
        // enemy into a wall — its result is re-clamped to obstacles below).
        this._separateEnemies(dt);
        // Elemental DoT (burn) is applied here, NOT in Enemy.update, because
        // a burn kill must route through the same reward pipeline as any
        // other kill (gems/coins/affix-death/kill-count). statusResult.killed
        // is merged into allKilled below.
        const statusResult = this._tickStatuses(dt);
        this._tickSupportEnemies(dt);
        // Rebuild the shared per-frame enemy index now that positions are final
        // (post movement + separation) and stay stable through _resolveCombat.
        // Collision queries it this frame; next frame's pre-move auto-aim reads
        // the same snapshot (enemies don't move between frames).
        this.spatialIndex.rebuild(this.enemies, this.camera.x, this.camera.y);
        // (Phase-2 boss enrage one-shots moved into the consolidated enemy
        // scan below — one pass instead of five over the full array.)
        return statusResult;
    },

    // Player projectiles + enemy bolts (movement, wall impacts, player hits).
    _updateProjectiles(dt) {
        for (const p of this.projectiles) {
            if (!p.active) continue;
            const px = p.x, py = p.y;
            p.update(dt);
            // Projectiles collide with walls: if the step crossed an obstacle,
            // burst on impact instead of passing through.
            if (p.active && this.obstacleSystem.segmentBlocked(px, py, p.x, p.y)) {
                p.active = false;
                this.particles.pickupSparkle(p.x, p.y, LIGHT_COLORS.projectile);
            }
        }
        // Enemy bolts (Spitters + boss volleys). Each can hit the player once;
        // a landed hit drives the same shake + flash + damage number as
        // contact damage.
        for (const ep of this.enemyProjectiles) {
            if (!ep.active) continue;
            const epx = ep.x, epy = ep.y;
            const dealt = ep.update(dt, this.player);
            // Enemy/boss bolts also collide with walls — no damage through cover.
            if (ep.active && this.obstacleSystem.segmentBlocked(epx, epy, ep.x, ep.y)) {
                ep.active = false;
                continue;
            }
            if (dealt > 0) {
                if (ep.sourceLabel) this.lastHitBy = ep.sourceLabel;   // death-card attribution
                this._shake(SCREEN_SHAKE.intensity, SCREEN_SHAKE.duration);
                this._pushFeedback('hit', 0.32);
                this.damageNumbers.push(new DamageNumber(
                    this.player.x, this.player.y - this.player.radius, dealt, '#ff4757'
                ));
            }
        }
    },

    // XP gems (+ the level-up trigger), coins, and health orbs.
    _updatePickups(dt) {
        let xpCollected = 0;
        for (const g of this.gems) {
            if (!g.active) continue;
            const xp = g.update(dt, this.player);
            if (xp > 0) {
                xpCollected += xp;
                this.particles.pickupSparkle(g.x, g.y, gemLightColor(g.tier));
                this.audio.gem();   // throttled → a vacuum coalesces into a sparkle run
            }
        }
        if (xpCollected > 0) {
            const levels = this.player.gainXP(xpCollected);
            if (levels > 0) {
                this.pendingLevelUps += levels;
                this._pushFeedback('levelup', 0.5);
                this.audio.levelUp();
                // A brief freeze-frame punches the level-up into a "moment"
                // before the upgrade overlay opens (skipped under reduced-effects).
                this._hitStop(0.07);
                this.particles.levelUpBurst(this.player.x, this.player.y);
                this._spawnRing(this.player.x, this.player.y, {
                    maxR: 200, width: 9, life: 0.6, color: '#8fe1ff', ease: 'outCubic',
                });
                // QoL juice: a level-up vacuums every loose gem on the field so
                // nothing earned is left behind while the overlay is up.
                for (const g of this.gems) {
                    if (g.active) { g.magnetizing = true; g.magnetSpeed = Math.max(g.magnetSpeed, 1200); }
                }
                if (!this.upgradeChoices) this._presentLevelUp();
            }
        }

        // Coin pickup — mirrors XPGem flow but feeds player.coins.
        for (const c of this.coins) {
            if (!c.active) continue;
            const got = c.update(dt, this.player);
            if (got > 0) {
                this.player.coins = (this.player.coins ?? 0) + got;
                this.particles.pickupSparkle(c.x, c.y, LIGHT_COLORS.coin);
                this.audio.coin();
            }
        }

        // Health-orb pickup — an instant heal (bypasses the sustained cap, by
        // design — it's a rare reward, not a sustain source).
        for (const h of this.healthOrbs) {
            if (!h.active) continue;
            const heal = h.update(dt, this.player);
            if (heal > 0) {
                const before = this.player.hp;
                this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
                const gained = Math.round(this.player.hp - before);
                if (gained > 0) {
                    this.damageNumbers.push(new DamageNumber(this.player.x, this.player.y - this.player.radius, gained, '#6bff8a'));
                }
                this.particles.pickupSparkle(h.x, h.y, '#6bff8a');
                this.audio.heal();
            }
        }
    },
    // Cosmetic world FX: floating numbers, particles, shockwave rings, the
    // damage-vignette decay, and the adaptive graphics governor.
    _updateWorldFx(dt) {
        for (const d of this.damageNumbers) {
            if (d.active) d.update(dt);
        }

        // Advance particles (ambient embers + fog spawn around the player).
        this.particles.update(dt, this.player);
        // Advance shockwave rings; expand + fade out over their life.
        for (const ring of this.rings) {
            ring.age += dt;
            if (ring.age >= ring.life) ring.active = false;
        }
        // Damage vignette pulse decays back to clear.
        if (this.hitVignette > 0) this.hitVignette = Math.max(0, this.hitVignette - dt * 2.2);
        this._updateGfxGovernor(dt);
    },

    // Chest/shrine walk-ons + presenting whichever reward overlay is queued.
    _updateRewardOverlays(dt) {
        // Chest pickup: chests sit until the player walks onto them, then
        // queue a chest reward overlay. Multiple chests collected in the
        // same tick are queued via pendingChests.
        for (const c of this.chests) {
            if (!c.active) continue;
            if (c.update(dt, this.player)) {
                this.pendingChests += 1;
                // Claiming the chest despawns its sibling shrine (boss pick-one).
                if (c._sibling && c._sibling.active) c._sibling.active = false;
                // Pop of golden sparkle the instant the chest is grabbed (the
                // reward overlay follows, but the world gets immediate feedback).
                this.particles.pickupSparkle(c.x, c.y, '#ffd166');
                this.particles.pickupSparkle(c.x, c.y - 8, '#ffe6b0');
                this.audio.chest();
            }
        }
        // Wick Shrine pickup: walking onto a shrine queues the pick-one altar and
        // (for a boss pick-one) despawns its sibling chest.
        for (const s of this.shrines) {
            if (!s.active) continue;
            if (s.update(dt, this.player)) {
                this.pendingAltars += 1;
                if (s._sibling && s._sibling.active) s._sibling.active = false;
                this.particles.pickupSparkle(s.x, s.y, '#ff9ecf');
                this.particles.pickupSparkle(s.x, s.y - 8, '#ffd3ec');
                // Mystical wick-chime — distinct from the chest's loot latch.
                this.audio.shrineChime();
            }
        }
        // Present whichever reward overlay is queued — only one is ever open at a
        // time (mutually exclusive with chest/level-up). The Branching Roads
        // CROSSROADS takes priority (the boss beat comes first, before its own
        // chest/shrine reward), and only opens once every other overlay is clear
        // so it can never stack on a same-frame level-up.
        if (this.pendingCrossroads && !this.chestReward && !this.upgradeChoices && !this.altar && !this.victory) {
            this.pendingCrossroads = false;
            this._presentCrossroads();
        } else if (this.pendingChests > 0 && !this.chestReward && !this.upgradeChoices && !this.altar) {
            this._presentChest();
        } else if (this.pendingAltars > 0 && !this.chestReward && !this.upgradeChoices && !this.altar) {
            this._presentAltar();
        }
    },

    // End-of-frame pass: the ONE consolidated enemy scan (P0.6) + everything
    // fed by it (melee swing, arena safety-net, music intensity, Second Wind),
    // pool compaction, HP-delta feedback, camera, and the death check.
    _updateEnemyScanAndCleanup(dt) {
        // ── ONE consolidated enemy scan ──────────────────────────────────
        // Replaces five separate full-array passes (melee-nearest, boss ref,
        // lieutenant ref, boss-enrage one-shot, Second-Wind proximity) that
        // each walked this.enemies every frame at the 180-enemy cap. Runs
        // after kills/pickups are processed so no ref can point at a corpse.
        // Boss ref picks by max HP so a fresh stronger boss takes the HP bar
        // over from an older weaker one; the lieutenant ref stays separate so
        // it never feeds the arena safety-net (which keys on activeBossRef).
        let nearestEnemy = null, nearestD2 = Infinity;
        this.activeBossRef = null;
        this.activeLieutenantRef = null;
        for (const e of this.enemies) {
            if (!e.active) continue;
            const dx = e.x - this.player.x, dy = e.y - this.player.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < nearestD2) { nearestD2 = d2; nearestEnemy = e; }
            if (e.boss) {
                if (!this.activeBossRef || e.maxHp > this.activeBossRef.maxHp) {
                    this.activeBossRef = e;
                }
                // Phase-2 enrage: a boss that crossed its HP threshold announces
                // + shakes exactly once (latched by enrageShouted). The phase
                // flip happens inside the boss AI; this only fires the one-shot FX.
                if (e.phase2Entered && !e.enrageShouted) {
                    e.enrageShouted = true;
                    this.waveDirector.announce('ENRAGED!', 1.2);
                    this._shake(SCREEN_SHAKE.intensity * 0.85, 0.45);
                    this._spawnRing(e.x, e.y, { maxR: 300, width: 12, life: 0.5, color: '#ff3b4e', ease: 'outCubic' });
                }
            } else if (e.lieutenant) {
                if (!this.activeLieutenantRef || e.maxHp > this.activeLieutenantRef.maxHp) {
                    this.activeLieutenantRef = e;
                }
            }
        }

        // Melee swing animation: when the chosen starting weapon is a
        // melee/blade family, the hero rhythmically slashes toward the nearest
        // enemy in reach. Purely cosmetic (no damage) — the auto-attack weapons
        // still do all the real work. Throttled so it reads as deliberate.
        if (this.playerSwingMelee) {
            this._swingCd -= dt;
            if (this._swingCd <= 0) {
                if (nearestEnemy && nearestD2 < 270 * 270) {
                    this.player.triggerSwing(Math.atan2(nearestEnemy.y - this.player.y, nearestEnemy.x - this.player.x));
                    this._swingCd = 0.34;
                } else {
                    this._swingCd = 0.15; // nothing in reach — re-check soon
                }
            }
        }
        // Safety net: if a boss arena is up but no boss is alive (defeated by
        // any means), lift the arena so the player isn't trapped.
        if (this.arena && !this.activeBossRef) this.arena = null;

        // Drive the music's dynamic intensity from how hectic the floor is
        // (enemy density) and, during a duel, how close the boss is to death.
        let intensity = Math.min(1, this.enemies.length / 90);
        if (this.activeBossRef) {
            intensity = Math.max(intensity, 0.55 + 0.45 * (1 - this.activeBossRef.hp / this.activeBossRef.maxHp));
        }
        // Near death the world closes in: cap the music brightness so the
        // heartbeat + dimmed groove read as danger without any alarm sound.
        const lowHp = this.player.hp > 0 && this.player.hp < this.player.maxHp * 0.25;
        this.audio.setIntensity(lowHp ? Math.min(intensity, 0.25) : intensity);

        compactInPlace(this.enemies);
        // Return dead bolts to the pool in the SAME pass that compacts them out
        // of the live array, so each instance is released exactly once.
        for (const p of this.projectiles) if (!p.active) this.projectilePool.release(p);
        compactInPlace(this.projectiles);
        // New enemy shots this frame → one soft incoming-fire pip, gated to
        // on-screen shooters (the cue's own min-gap keeps volleys as a chorus).
        if (this.enemyProjectiles.length > (this._epCount ?? 0)) {
            const p = this.enemyProjectiles[this.enemyProjectiles.length - 1];
            if (p && this._inView(p.x, p.y, 60)) this.audio.enemyShoot();
        }
        compactInPlace(this.enemyProjectiles);
        this._epCount = this.enemyProjectiles.length;
        compactInPlace(this.hazards);
        compactInPlace(this.rings);
        compactInPlace(this.gems);
        compactInPlace(this.damageNumbers);
        compactInPlace(this.chests);
        compactInPlace(this.shrines);
        compactInPlace(this.coins);
        compactInPlace(this.healthOrbs);

        // Heal flash: any net HP rise this frame (level-up heal, chest heal)
        // fires a green feedback pulse. Tracked centrally so individual
        // reward code doesn't each need to remember to trigger it.
        if (this.player.hp > this._lastHp + 0.5) this._pushFeedback('heal', 0.4);
        else if (this.player.hp < this._lastHp - 0.5) {
            this.audio.hurt();
            // Red screen-edge vignette pulse on any damage; a heavy hit
            // (>=12% max HP) also briefly freezes the frame for impact.
            const dmg = this._lastHp - this.player.hp;
            this.hitVignette = Math.min(1, this.hitVignette + 0.5);
            if (dmg >= this.player.maxHp * 0.12) this._hitStop(0.05);
        }
        this._lastHp = this.player.hp;

        // Near-death heartbeat: a soft ~1Hz ember pulse while HP is critical —
        // cozy dread, never a klaxon. Resets the instant HP recovers.
        if (this.player.hp > 0 && this.player.hp < this.player.maxHp * 0.25) {
            this._heartbeatT = (this._heartbeatT ?? 0) - dt;
            if (this._heartbeatT <= 0) { this.audio.heartbeat(); this._heartbeatT = 0.85; }
        } else this._heartbeatT = 0;

        // Second Wind: trickle HP back while no enemy is within the safe
        // radius. Applied after the heal-flash check so the tiny per-frame
        // tick doesn't spam the green flash.
        if (this.player.regenPerSecond > 0 && this.player.hp < this.player.maxHp) {
            // Nearest-enemy distance comes from the consolidated scan above
            // (Infinity when the field is empty — trivially safe).
            const sr2 = SECOND_WIND_RADIUS * SECOND_WIND_RADIUS;
            const safe = nearestD2 >= sr2;
            if (safe) {
                // Regen is capped by CAPS.regenPerSecond and shares the global
                // sustained-heal budget (CAPS.healPerSecond) with Divine Nova.
                const rate = Math.min(this.player.regenPerSecond, CAPS.regenPerSecond);
                this.player.healSustained(rate * dt);
                this._lastHp = this.player.hp;
            }
        }

        this.camera.update(dt);

        if (this.player.isDead()) {
            this._enterGameOver();
        }
    },
};
