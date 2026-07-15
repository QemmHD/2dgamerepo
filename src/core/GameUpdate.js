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
    ENEMY,
    WAVE_LIMITS,
} from '../config/GameConfig.js';
import { TWO_PI, clamp, compactInPlace } from './MathUtils.js';
import { Player } from '../entities/Player.js';
import { BOSS_SPAWN_PROVENANCE, Enemy } from '../entities/Enemy.js';
import { XPGem } from '../entities/XPGem.js';
import { Chest } from '../entities/Chest.js';
import { Shrine } from '../entities/Shrine.js';
import { Coin } from '../entities/Coin.js';
import { DamageNumber } from '../entities/DamageNumber.js';
import { retireEncounterEnemyTags } from '../systems/EncounterDirector.js';
import { AUTO_AIM_RANGE } from '../systems/WeaponSystem.js';
import { HazardSystem } from '../systems/HazardSystem.js';
import { nextMusicState } from '../systems/MusicDirector.js';
import { RUIN_BELL_EVENT, resolveRuinBellMusicCue } from '../content/music.js';

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
        const captionHidden = this.screen !== 'gameplay' || this.paused || this.photoMode
            || this.upgradeChoices || this.chestReward || this.altar || this.victory || this.gameOver;
        if (captionHidden) {
            // Voice is independently configurable and may still be audible
            // when captions are Off. Hidden gameplay surfaces always stop it;
            // never key the audio boundary off a caption snapshot.
            this.audio?.stopVoice?.();
        } else {
            this.captionSystem?.update?.(dt);
        }

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
        this.profiler.begin('spawner');
        this._updateDirectors(dt);
        this.profiler.end('spawner');
        this.kindleSystem.update(dt);   // tick the blink cooldown (real dt)
        this.profiler.begin('weapons');
        const weaponResult = this._updatePlayerAndWeapons(dt, worldDt, _aiming);
        this.profiler.end('weapons');
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
        this.profiler.begin('collision');
        this._resolveCombat(dt, weaponResult, statusResult, kindleResult);
        this.profiler.end('collision');
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
        const siteChallengeActive = !!this.vigilSiteSystem?.hasActiveChallenge?.();
        const ruinBellStageOwned = !!this.ruinBellDirector?.ownsStage?.();
        const encounterPhase = this.encounterDirector?.getSnapshot?.().phase;
        // Combat resolution runs after directors, so a guardian killed on the
        // prior frame may be waiting in this queue. Give that earned lifecycle
        // one frame to clear/pay before a due boss can abort the active pack.
        const pendingEncounterLifecycle = encounterPhase === 'active'
            && (this._encounterDefeatedIds?.length ?? 0) > 0;
        if (this.bossRush) {
            // Boss Rush drives its own cadence: when the prep phase elapses it
            // asks for the next boss's warning, which the shared warning→spawn
            // block below turns into a real spawn through the normal pipeline
            // (telegraph, arena, enraged phases, adds). The normal boss director,
            // the Lieutenant, and the trash spawner are all bypassed for the mode.
            if (!bossAlive && !this.bossWarning) {
                const act = this.bossRush.update(dt);
                if (act && act.spawn) {
                    const provenance = this.weeklyEmberMode
                        ? BOSS_SPAWN_PROVENANCE.WEEKLY
                        : BOSS_SPAWN_PROVENANCE.BOSS_RUSH;
                    this._startBossWarning(act.spawn, provenance);
                }
            }
        } else if (!bossAlive && !this.bossWarning && !siteChallengeActive
            && !pendingEncounterLifecycle && !ruinBellStageOwned) {
            const bossId = this.bossDirector.update(this.time, bossAlive);
            if (bossId) {
                const provenance = this.campaignRun?.taintReason === 'debug-time-jump'
                    ? BOSS_SPAWN_PROVENANCE.DEBUG
                    : BOSS_SPAWN_PROVENANCE.MAP_DIRECTOR;
                this._startBossWarning(bossId, provenance);
            }
        }
        if (this.bossWarning) {
            this.bossWarning.timer -= dt;
            if (this.bossWarning.timer <= 0) {
                const id = this.bossWarning.id;
                const provenance = this.bossWarning.provenance
                    ?? BOSS_SPAWN_PROVENANCE.UNKNOWN;
                this.bossWarning = null;
                this._spawnBoss(id, provenance);
            }
        }
        const bossActiveForLieutenant = !!this.bossWarning || !!this.arena
            || this.enemies.some((e) => e.active && e.boss);
        // Lieutenant: one mid-segment mini-boss per boss window. Gated on NO boss
        // incoming/alive AND no live lieutenant so it never overlaps the boss
        // setpiece; the swarm keeps running (unlike a boss). A short telegraph
        // precedes the spawn. `bossAlive` is reused from the boss gate above.
        let lieutenantAlive = this.enemies.some((e) => e.active && e.lieutenant);
        const authoredChallengeActive = siteChallengeActive
            || ruinBellStageOwned
            || (!!encounterPhase && encounterPhase !== 'idle');
        if (!this.bossRush && !bossActiveForLieutenant && !this.lieutenantWarning
            && !lieutenantAlive && !authoredChallengeActive) {
            if (this.lieutenantDirector.update(this.time)) this._startLieutenantWarning();
        }
        if (this.lieutenantWarning) {
            // If a boss window opened during the telegraph (a late boss kill can
            // push the next boss warning into it), cancel the Lieutenant so it
            // never spawns into the boss setpiece — it re-arms next segment.
            if (bossActiveForLieutenant) {
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
        // A warning can expire and spawn on this frame. Re-scan before handing
        // stage ownership to EncounterDirector so it cannot also advance a pack
        // from the stale pre-warning snapshot.
        lieutenantAlive = this.enemies.some((e) => e.active && e.lieutenant);
        // Drain any queued boss summon requests into themed, capped spawns.
        if (this.bossSummons.length) {
            for (const s of this.bossSummons) {
                this._spawnBossSupport(s.x, s.y, s.count, s.types, s.bossOwnerId ?? null);
            }
            this.bossSummons.length = 0;
        }
        // Boss HP-threshold phases (75/50/25%) — one-shot support + aggression.
        this._updateBossThresholds();
        const bossActiveNow = !!this.arena || this.enemies.some((e) => e.active && e.boss);
        this._updateEncounterDirector(dt, bossActiveNow, lieutenantAlive);
    },

    // Curated tactical packs run beside the time-based spawner, but only when
    // no boss, lieutenant, modal, or site guardian challenge owns the stage.
    _updateEncounterDirector(dt, bossActive = false, lieutenantActive = false) {
        const director = this.encounterDirector;
        if (!director) return;
        const defeated = this._encounterDefeatedIds.splice(0);
        const output = director.update(dt, {
            gameTime: this.time,
            waveState: this.waveState,
            liveEnemyCount: this.enemies.reduce((n, enemy) => n + (enemy.active ? 1 : 0), 0),
            enemyCap: this.waveState?.maxAlive,
            bossActive,
            bossWarning: !!this.bossWarning,
            overlayActive: lieutenantActive || !!this.lieutenantWarning
                || !!this.vigilSiteSystem?.hasActiveChallenge?.()
                || !!this.ruinBellDirector?.ownsStage?.(),
            defeatedMemberIds: defeated,
        });
        this._applyEncounterOutput(output);
    },

    _applyEncounterOutput(output) {
        if (!output) return;
        for (const event of output.events || []) this._handleEncounterEvent(event);
        for (const request of output.spawnRequests || []) {
            const acceptedMemberIds = this._spawnEncounterPack(request);
            // Acknowledge synchronously: accepted ids already reference live,
            // tagged enemies, so no impossible pending pack survives a frame.
            const follow = this.encounterDirector?.update?.(0, {
                gameTime: this.time,
                spawnResults: [{ packId: request.packId, acceptedMemberIds }],
                bossActive: !!this.arena,
                bossWarning: !!this.bossWarning,
                overlayActive: !!this.vigilSiteSystem?.hasActiveChallenge?.()
                    || !!this.ruinBellDirector?.ownsStage?.(),
            });
            for (const event of follow?.events || []) this._handleEncounterEvent(event);
        }
    },

    _spawnEncounterPack(request) {
        if (!request || !Array.isArray(request.units)) return [];
        let live = this.enemies.reduce((n, enemy) => n + (enemy.active ? 1 : 0), 0);
        const cap = Math.min(
            WAVE_LIMITS.maxEnemyCap,
            Math.max(0, Math.floor(this.waveState?.maxAlive ?? WAVE_LIMITS.maxEnemyCap)),
            Math.max(0, Math.floor(request.enemyCapAtIssue ?? WAVE_LIMITS.maxEnemyCap)),
        );
        const angle = Number.isFinite(request.anchor?.angle) ? request.anchor.angle : 0;
        const distance = Math.max(500, Number.isFinite(request.anchor?.distance) ? request.anchor.distance : 1000);
        const rotation = Number.isFinite(request.anchor?.rotation) ? request.anchor.rotation : angle - Math.PI / 2;
        const anchorX = this.player.x + Math.cos(angle) * distance;
        const anchorY = this.player.y + Math.sin(angle) * distance;
        const cos = Math.cos(rotation), sin = Math.sin(rotation);
        const placed = [];
        const accepted = [];
        for (let index = 0; index < request.units.length && live < cap; index++) {
            const unit = request.units[index];
            const def = ENEMY[unit?.type];
            if (!def || def.boss || typeof unit.memberId !== 'string') continue;
            const radius = Math.max(8, def.radius ?? 30);
            const ox = Number.isFinite(unit.offset?.x) ? unit.offset.x : 0;
            const oy = Number.isFinite(unit.offset?.y) ? unit.offset.y : 0;
            const targetX = anchorX + ox * cos - oy * sin;
            const targetY = anchorY + ox * sin + oy * cos;
            let spot = null;
            const attempts = Math.max(1, Math.min(8, Math.floor(request.placementAttemptsPerUnit ?? 6)));
            for (let attempt = 0; attempt < attempts; attempt++) {
                const spread = attempt === 0 ? 0 : (radius + 46) * attempt;
                const bearing = index * 2.399963 + attempt * 1.618034;
                const candidate = this._clearSpot(
                    targetX + Math.cos(bearing) * spread,
                    targetY + Math.sin(bearing) * spread,
                    radius + 8,
                );
                if ((this.obstacleSystem.isSpawnBlocked?.(candidate.x, candidate.y, radius + 6)
                    ?? this.obstacleSystem.isBlocked(candidate.x, candidate.y, radius + 6))) continue;
                const pdx = candidate.x - this.player.x, pdy = candidate.y - this.player.y;
                if (pdx * pdx + pdy * pdy < 360 * 360) continue;
                let overlaps = false;
                for (const prior of placed) {
                    const dx = candidate.x - prior.x, dy = candidate.y - prior.y;
                    const min = radius + prior.radius + 12;
                    if (dx * dx + dy * dy < min * min) { overlaps = true; break; }
                }
                if (!overlaps) { spot = candidate; break; }
            }
            if (!spot) continue;
            const enemy = new Enemy(unit.type, spot.x, spot.y, {
                healthMul: this.waveState.healthMul,
                speedMul: this.waveState.speedMul,
                contactDamageMul: this.waveState.damageMul ?? 1,
                elite: false,
            });
            enemy.encounterMemberId = unit.memberId;
            enemy.encounterPackId = request.packId;
            enemy.encounterGuardian = unit.guardian === true;
            enemy.encounterName = request.name;
            this.enemies.push(enemy);
            placed.push({ x: spot.x, y: spot.y, radius });
            accepted.push(unit.memberId);
            live++;
            this.waveDirector.notifySpawn?.(1);
        }
        return accepted;
    },

    _handleEncounterEvent(event) {
        if (!event) return;
        this.vigilTracker?.ingest?.(event);
        if (event.type === 'encounter-warning') {
            this.waveDirector.announce(event.title.toUpperCase(), event.duration ?? 2.8, event.color ?? '#ffd166');
            this.audio.lieutenantWarn();
            return;
        }
        if (event.type === 'encounter-spawned') {
            this.waveDirector.announce(`${event.title.toUpperCase()} FORMED`, 1.8, event.color ?? '#ffd166');
            return;
        }
        if (event.type === 'encounter-aborted') {
            // Placement may have produced a sub-minimum fragment. It remains
            // ordinary swarm pressure, but loses guardian markers and reward
            // lifecycle so a one-body fragment cannot pay the full pack prize.
            retireEncounterEnemyTags(this.enemies, event.packId);
            return;
        }
        if (event.type !== 'encounter-cleared') return;
        this.encountersCleared += 1;
        this.vigilTracker?.setProgress?.({
            activatedSiteKinds: this._vigilKindsActivated,
            encountersCleared: this.encountersCleared,
        });
        const pos = this._encounterRewardPos || { x: this.player.x, y: this.player.y };
        this._grantVigilXp(24, pos.x, pos.y);
        this._dropCoinBurst(pos.x, pos.y, 5, 3);
        this._spawnRing(pos.x, pos.y, { maxR: 220, width: 9, life: 0.55, color: event.color ?? '#ffd166' });
        this.particles.pickupSparkle(pos.x, pos.y, event.color ?? '#ffd166');
        this.audio.objective();
        this.waveDirector.announce(`${event.title.toUpperCase()}  +24 XP · 15 COINS DROPPED`, 2.4, event.color ?? '#ffd166');
        this._encounterRewardPos = null;
    },

    _ruinBellContext(extra = null) {
        const encounterPhase = this.encounterDirector?.getSnapshot?.().phase;
        const bossActive = !!this.arena || this.enemies.some((enemy) => enemy.active && enemy.boss);
        const lieutenantActive = this.enemies.some((enemy) => enemy.active && enemy.lieutenant);
        return {
            screen: this.screen,
            player: this.player,
            waveState: this.waveState,
            paused: !!this.paused,
            gameOver: !!this.gameOver,
            victory: !!this.victory,
            upgradeChoices: !!this.upgradeChoices,
            chestReward: !!this.chestReward,
            altar: !!this.altar,
            photoMode: !!this.photoMode,
            bossActive,
            bossWarning: !!this.bossWarning,
            lieutenantActive,
            lieutenantWarning: !!this.lieutenantWarning,
            tacticalEncounterActive: !!encounterPhase && encounterPhase !== 'idle',
            vigilChallengeActive: !!this.vigilSiteSystem?.hasActiveChallenge?.(),
            ...(extra || {}),
        };
    },

    _updateRuinBell(dt) {
        const director = this.ruinBellDirector;
        if (!director) return;
        const defeatedMemberIds = this._ruinBellDefeatedIds.splice(0);
        const output = director.update(dt, this._ruinBellContext({ defeatedMemberIds }));
        this._applyRuinBellOutput(output);
    },

    // A director output may synchronously request a wave and then emit a
    // follow-up after Game acknowledges it. Keep that handshake bounded while
    // still allowing a throttled/large-dt frame to catch up through all three
    // authored stages without leaving an impossible pending request behind.
    _applyRuinBellOutput(initialOutput) {
        if (!initialOutput || !this.ruinBellDirector) return;
        const outputs = [initialOutput];
        for (let cursor = 0; cursor < outputs.length && cursor < 8; cursor++) {
            const output = outputs[cursor];
            const events = output?.events || [];
            const closesSpawnLane = events.some((event) =>
                event?.type === 'ruin-bell-cleared'
                || event?.type === 'ruin-bell-failed'
                || event?.type === 'ruin-bell-technical-defer');
            for (const event of events) this._handleRuinBellEvent(event);
            // Cleanup/terminal events are authoritative for their whole output.
            // Even a malformed or older Director must not spawn a request after
            // Game has just retired the encounter's bodies and attacks.
            if (closesSpawnLane) continue;
            for (const request of output?.spawnRequests || []) {
                const result = this._spawnRuinBellWave(request);
                const follow = this.ruinBellDirector.update(0, this._ruinBellContext({
                    spawnResults: [result],
                }));
                if (follow) outputs.push(follow);
            }
        }
    },

    _spawnRuinBellWave(request) {
        const deferred = (reason, acceptedMemberIds = []) => ({
            requestId: request?.requestId || null,
            acceptedMemberIds,
            deferred: true,
            technicalDefer: true,
            reason,
        });
        if (!request || request.allOrNone !== true || !Array.isArray(request.units)
            || typeof request.requestId !== 'string' || typeof request.instanceId !== 'string') {
            return deferred('invalid-request');
        }

        const requiredIds = Array.isArray(request.requiredMemberIds)
            ? request.requiredMemberIds : [];
        const required = new Set(requiredIds);
        if (!request.units.length || request.units.length !== request.requiredCount
            || required.size !== request.units.length) return deferred('invalid-manifest');

        const live = this.enemies.reduce((count, enemy) => count + (enemy.active ? 1 : 0), 0);
        const cap = Math.min(
            WAVE_LIMITS.maxEnemyCap,
            Math.max(0, Math.floor(this.waveState?.maxAlive ?? WAVE_LIMITS.maxEnemyCap)),
        );
        if (cap - live < request.units.length) return deferred('enemy-cap');

        const placements = [];
        const seen = new Set();
        const attempts = Math.max(1, Math.min(8,
            Math.floor(request.placementAttemptsPerUnit ?? 8)));
        for (let index = 0; index < request.units.length; index++) {
            const unit = request.units[index];
            const memberId = unit?.memberId;
            const def = ENEMY[unit?.type];
            if (!def || def.boss || typeof memberId !== 'string'
                || !required.has(memberId) || seen.has(memberId)) {
                return deferred('invalid-unit');
            }
            seen.add(memberId);
            const radius = Math.max(8, Number.isFinite(def.radius) ? def.radius : 30);
            const laneStart = unit.chargeLane?.worldFrom;
            const entry = laneStart && Number.isFinite(laneStart.x) && Number.isFinite(laneStart.y)
                ? laneStart : unit.entry;
            if (!entry || !Number.isFinite(entry.x) || !Number.isFinite(entry.y)) {
                return deferred('missing-entry');
            }

            let normalX = Number(unit.entry?.normal?.x) || 0;
            let normalY = Number(unit.entry?.normal?.y) || 0;
            let normalLength = Math.hypot(normalX, normalY);
            if (laneStart && unit.chargeLane?.worldThrough) {
                // The authored charge lane points from outside toward the
                // cabin. Its inverse is the outward fallback used only for
                // deterministic placement probes around the exact lane start.
                normalX = laneStart.x - unit.chargeLane.worldThrough.x;
                normalY = laneStart.y - unit.chargeLane.worldThrough.y;
                normalLength = Math.hypot(normalX, normalY);
            }
            if (normalLength < 0.001) {
                const origin = request.structureOrigin;
                normalX = entry.x - (origin?.x || 0);
                normalY = entry.y - (origin?.y || 0);
                normalLength = Math.hypot(normalX, normalY) || 1;
            }
            normalX /= normalLength;
            normalY /= normalLength;
            const tangentX = -normalY;
            const tangentY = normalX;
            const seed = Number.isFinite(unit.attackSeed) ? unit.attackSeed : 0.5;
            const spreadIndex = index - (request.units.length - 1) / 2;
            const tangentOffset = laneStart
                ? 0
                : spreadIndex * (radius * 1.2 + 34) + (seed - 0.5) * 26;
            const outwardOffset = laneStart ? 0 : radius + 150;
            const targetX = entry.x + normalX * outwardOffset + tangentX * tangentOffset;
            const targetY = entry.y + normalY * outwardOffset + tangentY * tangentOffset;
            let spot = null;
            for (let attempt = 0; attempt < attempts; attempt++) {
                const probeRadius = attempt === 0 ? 0 : (radius + 30) * (1 + Math.floor((attempt - 1) / 3));
                const bearing = seed * TWO_PI + attempt * 2.399963229728653;
                const candidate = this._clearSpot(
                    targetX + Math.cos(bearing) * probeRadius,
                    targetY + Math.sin(bearing) * probeRadius,
                    radius + 8,
                );
                if ((this.obstacleSystem.isSpawnBlocked?.(candidate.x, candidate.y, radius + 6)
                    ?? this.obstacleSystem.isBlocked(candidate.x, candidate.y, radius + 6))) continue;
                const pdx = candidate.x - this.player.x;
                const pdy = candidate.y - this.player.y;
                const playerGap = Math.max(170, radius + this.player.radius + 92);
                if (pdx * pdx + pdy * pdy < playerGap * playerGap) continue;

                let overlaps = false;
                for (const prior of placements) {
                    const dx = candidate.x - prior.x;
                    const dy = candidate.y - prior.y;
                    const gap = radius + prior.radius + 18;
                    if (dx * dx + dy * dy < gap * gap) { overlaps = true; break; }
                }
                if (overlaps) continue;
                for (const enemy of this.enemies) {
                    if (!enemy.active) continue;
                    const dx = candidate.x - enemy.x;
                    const dy = candidate.y - enemy.y;
                    const gap = radius + Math.max(8, enemy.radius || 0) + 14;
                    if (dx * dx + dy * dy < gap * gap) { overlaps = true; break; }
                }
                if (!overlaps) { spot = candidate; break; }
            }
            if (!spot) return deferred('placement-blocked');
            placements.push({ unit, radius, x: spot.x, y: spot.y });
        }
        if (seen.size !== required.size || requiredIds.some((id) => !seen.has(id))) {
            return deferred('manifest-mismatch');
        }

        // Constructors run before any object enters the authoritative array.
        // If future enemy content throws, the all-or-none promise still holds.
        const created = [];
        try {
            for (const placement of placements) {
                const { unit, x, y } = placement;
                const enemy = new Enemy(unit.type, x, y, {
                    healthMul: this.waveState.healthMul,
                    speedMul: this.waveState.speedMul,
                    contactDamageMul: this.waveState.damageMul ?? 1,
                    elite: false,
                });
                enemy.ruinBellMemberId = unit.memberId;
                enemy.ruinBellInstanceId = request.instanceId;
                enemy.ruinBellStageId = request.stageId;
                enemy.ruinBellRole = unit.role || 'threshold';
                enemy.ruinBellEntryDoorId = unit.entryDoorId || null;
                enemy.ruinBellRouteRoomIds = Array.isArray(unit.routeRoomIds)
                    ? [...unit.routeRoomIds] : [];
                enemy.ruinBellCombatSocket = unit.combatSocket?.world
                    ? { ...unit.combatSocket.world } : null;
                enemy.ruinBellChargeLane = unit.chargeLane ? {
                    from: unit.chargeLane.worldFrom ? { ...unit.chargeLane.worldFrom } : null,
                    through: unit.chargeLane.worldThrough ? { ...unit.chargeLane.worldThrough } : null,
                    to: unit.chargeLane.worldTo ? { ...unit.chargeLane.worldTo } : null,
                    clearance: unit.chargeLane.clearance,
                } : null;
                created.push(enemy);
            }
        } catch (_) {
            return deferred('enemy-construction');
        }
        this.enemies.push(...created);
        try { this.waveDirector.notifySpawn?.(created.length); }
        catch (_) { /* spawn membership remains authoritative */ }
        return {
            requestId: request.requestId,
            acceptedMemberIds: created.map((enemy) => enemy.ruinBellMemberId),
        };
    },

    _retireRuinBellMembers(memberIds = null) {
        const requested = Array.isArray(memberIds) ? new Set(memberIds) : null;
        const instanceId = this.ruinBellDirector?.instanceId;
        let retired = 0;
        for (const enemy of this.enemies) {
            if (!enemy.active || !enemy.ruinBellMemberId) continue;
            if (instanceId && enemy.ruinBellInstanceId !== instanceId) continue;
            if (requested && !requested.has(enemy.ruinBellMemberId)) continue;
            enemy.active = false;
            retired++;
        }
        // Bellbound attacks outlive their owner by design, so retire them by
        // explicit encounter provenance on defer/failure/clear. Without this, a
        // retry can begin under an old marksman bolt or bomber blast zone.
        for (const projectile of this.enemyProjectiles) {
            if (!projectile.active || !projectile.ruinBellInstanceId) continue;
            if (instanceId && projectile.ruinBellInstanceId !== instanceId) continue;
            if (requested && !requested.has(projectile.ruinBellMemberId)) continue;
            projectile.active = false;
        }
        for (const hazard of this.hazards) {
            if (!hazard.active || !hazard.ruinBellInstanceId) continue;
            if (instanceId && hazard.ruinBellInstanceId !== instanceId) continue;
            if (requested && !requested.has(hazard.ruinBellMemberId)) continue;
            hazard.active = false;
        }
        return retired;
    },

    _setRuinBellHouseState(nextState) {
        const structure = this.ruinBellStructure;
        if (!structure || typeof nextState !== 'string') return false;
        return this.obstacleSystem.setStructureState?.(structure.id, nextState) === true;
    },

    _playRuinBellMusic(eventName, semanticOverride = null) {
        const director = this.ruinBellDirector;
        if (!director) return null;
        const ordinal = this._ruinBellMusicOrdinal++;
        const resolved = resolveRuinBellMusicCue(eventName, director.seed, ordinal);
        if (!resolved) return null;
        const cue = semanticOverride ? { ...resolved, ...semanticOverride } : resolved;
        if (cue.combat) {
            const holdSeconds = Math.max(0.5, (Number(cue.combat.holdBars) || 0) * 2);
            this.musicState = {
                ...this.musicState,
                scene: cue.combat.scene,
                intensity: cue.combat.intensity,
                target: cue.combat.intensity,
            };
            this._ruinBellMusicHold = {
                scene: cue.combat.scene,
                intensity: cue.combat.intensity,
                remaining: holdSeconds,
            };
        }
        const caption = this.audio.musicEvent?.('ruinBell', cue) || cue.caption;
        if (caption) {
            this.captionSystem?.sound?.({
                key: `${cue.id}-${ordinal}`,
                text: caption,
                detail: 'full',
                priority: eventName === RUIN_BELL_EVENT.ESCALATION ? 86 : 78,
                cooldown: 0,
            });
        }
        this.accessibility?.announce?.(cue.announcement);
        return cue;
    },

    _handleRuinBellEvent(event) {
        if (!event?.type) return;
        if (event.houseState) this._setRuinBellHouseState(event.houseState);
        const anchor = event.anchor || this.ruinBellDirector?.anchor || this.ruinBellStructure
            || { x: this.player.x, y: this.player.y };

        if (event.type === 'ruin-bell-unlocked') {
            this.waveDirector.announce('RUIN BELL AWAKENED  ·  FIND THE LAST-WICK CABIN', 3.0, '#ffad5a');
            this.accessibility?.announce?.('Ruin Bell unlocked. Find the Last-Wick Cabin and hold position by the bell.');
            return;
        }
        if (event.type === 'ruin-bell-arming-cancelled'
            || event.type === 'ruin-bell-wave-requested') return;

        if (event.type === 'ruin-bell-started') {
            for (const hazard of this.hazards) if (hazard.active && hazard.biome) hazard.active = false;
            this._playRuinBellMusic(RUIN_BELL_EVENT.WARNING);
            this.waveDirector.announce('FIRST TOLL  ·  BRACE BOTH DOORS', 2.8, '#ffad5a');
            this._spawnRing(anchor.x, anchor.y, {
                maxR: 250, width: 10, life: 0.62, color: '#ffad5a', ease: 'outCubic',
            });
            this._shake(SCREEN_SHAKE.intensity * 0.42, 0.32);
            this.haptics?.pulse?.('bossAttack');
            return;
        }
        if (event.type === 'ruin-bell-stage-warning') {
            if ((event.stageIndex ?? 0) > 0) this._playRuinBellMusic(RUIN_BELL_EVENT.ESCALATION);
            this.waveDirector.announce(
                `${String(event.title || 'BELLBOUND').toUpperCase()}  ·  ${String(event.text || 'HOLD THE CABIN').toUpperCase()}`,
                Math.max(2.2, event.leadSeconds || 0),
                event.color || '#ff6a78',
            );
            return;
        }
        if (event.type === 'ruin-bell-wave-spawned') {
            this.waveDirector.announce(
                `${String(event.title || 'BELLBOUND').toUpperCase()} FORMED  ·  ${event.count || 0} HOSTILES`,
                1.6,
                '#ffd166',
            );
            return;
        }
        if (event.type === 'ruin-bell-technical-defer') {
            this._retireRuinBellMembers(event.cleanupMemberIds);
            this.waveDirector.announce('APPROACH RESETTING  ·  ATTEMPT PRESERVED', 2.4, '#a9a1b5');
            this.accessibility?.announce?.('Ruin Bell approach resetting. Your attempt was not consumed.');
            return;
        }
        if (event.type === 'ruin-bell-defense-warning') {
            this.waveDirector.announce(
                `RETURN TO THE CABIN  ·  ${Math.ceil(event.retryIn || 0)}s`,
                2.2,
                '#ff6a78',
            );
            this.accessibility?.announce?.('Return to the Last-Wick Cabin before the Ruin Bell breaks.');
            this.haptics?.pulse?.('bossAttack');
            return;
        }
        if (event.type === 'ruin-bell-defense-restored') {
            this.waveDirector.announce('CABIN DEFENSE RESTORED', 1.6, '#7fe0a0');
            this.accessibility?.announce?.('Cabin defense restored.');
            return;
        }
        if (event.type === 'ruin-bell-failed') {
            this._retireRuinBellMembers();
            this._playRuinBellMusic(RUIN_BELL_EVENT.FAILURE, event.retryAvailable ? null : {
                caption: 'Ruin Bell lost: silent for this run.',
                announcement: 'The Ruin Bell is silent for this run. No completion reward was earned.',
            });
            this._ruinBellReceipt = {
                ok: false,
                attempt: event.attempt,
                retryAvailable: event.retryAvailable === true,
                receipt: event.receipt,
            };
            this.waveDirector.announce(
                event.retryAvailable
                    ? `RUIN BELL CRACKED  ·  RETRY IN ${Math.ceil(event.retryIn || 0)}s`
                    : 'RUIN BELL LOST  ·  NO COMPLETION REWARD',
                3.2,
                '#ff6a78',
            );
            this._shake(SCREEN_SHAKE.intensity * 0.55, 0.38);
            return;
        }
        if (event.type === 'ruin-bell-retry-ready') {
            this.waveDirector.announce('RUIN BELL RELIT  ·  FINAL ATTEMPT READY', 2.8, '#ffad5a');
            this.accessibility?.announce?.('Ruin Bell relit. Return to the bell for the final attempt.');
            return;
        }
        if (event.type !== 'ruin-bell-cleared' || this._ruinBellRewarded) return;

        this._retireRuinBellMembers();
        this._ruinBellRewarded = true;
        const xp = Math.max(0, Math.round(event.reward?.xp || 0));
        this._grantVigilXp(xp, anchor.x, anchor.y);
        const authoredSockets = this.ruinBellStructure?.blueprint?.encounter?.rewardSockets;
        const rewardPlacement = authoredSockets?.chest && authoredSockets?.shrine ? {
            chest: {
                x: this.ruinBellStructure.x + authoredSockets.chest.x,
                y: this.ruinBellStructure.y + authoredSockets.chest.y,
            },
            shrine: {
                x: this.ruinBellStructure.x + authoredSockets.shrine.x,
                y: this.ruinBellStructure.y + authoredSockets.shrine.y,
            },
            pickupDelaySeconds: authoredSockets.pickupDelaySeconds,
            requiresExitBeforePickup: authoredSockets.requiresExitBeforePickup === true,
        } : null;
        const chestStart = Array.isArray(this.chests) ? this.chests.length : 0;
        const shrineStart = Array.isArray(this.shrines) ? this.shrines.length : 0;
        this._dropBossReward(anchor.x, anchor.y, rewardPlacement);
        const rewardId = typeof event.rewardId === 'string'
            ? event.rewardId : this.ruinBellDirector?.rewardId;
        const rewardChest = Array.isArray(this.chests) ? this.chests[chestStart] : null;
        const rewardShrine = Array.isArray(this.shrines) ? this.shrines[shrineStart] : null;
        if (rewardChest && rewardShrine && typeof rewardId === 'string') {
            rewardChest.ruinBellInstanceId = event.instanceId;
            rewardChest.ruinBellRewardId = rewardId;
            rewardChest.ruinBellRewardChoice = 'chest';
            rewardShrine.ruinBellInstanceId = event.instanceId;
            rewardShrine.ruinBellRewardId = rewardId;
            rewardShrine.ruinBellRewardChoice = 'shrine';
        }
        this._playRuinBellMusic(RUIN_BELL_EVENT.CLEAR);
        this._ruinBellReceipt = {
            ok: true,
            attempt: event.attempt,
            xp,
            choice: event.reward?.choice || null,
            rewardId: rewardId || null,
            rewardClaimed: false,
            claimedChoice: null,
            rewardSockets: rewardPlacement ? {
                chest: { ...rewardPlacement.chest },
                shrine: { ...rewardPlacement.shrine },
            } : null,
            receipt: event.receipt,
        };
        this._spawnRing(anchor.x, anchor.y, {
            maxR: 340, width: 13, life: 0.8, color: '#ffd38a', ease: 'outCubic',
        });
        this.particles.pickupSparkle(anchor.x, anchor.y, '#ffd38a');
        this.waveDirector.announce(event.receipt || 'RUIN BELL HELD', 3.6, '#7fe0a0');
        this.haptics?.pulse?.('bossDefeat');
    },

    _claimRuinBellReward(reward) {
        const director = this.ruinBellDirector;
        if (!director || !reward || typeof director.claimReward !== 'function') return false;
        if (reward.ruinBellInstanceId !== director.instanceId
            || reward.ruinBellRewardId !== director.rewardId
            || (reward.ruinBellRewardChoice !== 'chest'
                && reward.ruinBellRewardChoice !== 'shrine')) return false;
        const accepted = director.claimReward({
            instanceId: reward.ruinBellInstanceId,
            rewardId: reward.ruinBellRewardId,
            choice: reward.ruinBellRewardChoice,
        });
        if (!accepted) return false;
        this._ruinBellReceipt = {
            ...(this._ruinBellReceipt || {}),
            rewardId: reward.ruinBellRewardId,
            rewardClaimed: true,
            claimedChoice: reward.ruinBellRewardChoice,
        };
        return true;
    },

    _updateVigilSites(dt) {
        const sites = this.vigilSiteSystem;
        if (!sites) return;
        sites.update(dt, this);
        const events = sites.drainEvents([]);
        for (const event of events) this._handleVigilSiteEvent(event);
        this.vigilTracker?.update?.(dt, {
            siteFocus: sites.getFocusSnapshot?.() ?? null,
            reducedEffects: this.reducedEffects,
            frozen: false,
        });
    },

    // Living Vigil rewards are already earned when their clear/interaction
    // event fires, so grant their XP immediately through Player.gainXP instead
    // of dropping a pickup the player could reasonably mistake for an unpaid
    // reward. Queue level drafts through the same pending counter as gem XP.
    _grantVigilXp(value, x = this.player.x, y = this.player.y) {
        const amount = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
        if (amount <= 0) return 0;
        const levels = this.player.gainXP(amount);
        if (levels > 0) {
            this.pendingLevelUps += levels;
            this._pushFeedback('levelup', 0.5);
            this.audio.levelUp();
            this._hitStop(0.07);
            this.particles.levelUpBurst(this.player.x, this.player.y);
            this._spawnRing(x, y, {
                maxR: 200, width: 9, life: 0.6, color: '#8fe1ff', ease: 'outCubic',
            });
        }
        return amount;
    },

    _handleVigilSiteEvent(event) {
        if (!event) return;
        if (event.kind === 'spawn') {
            const spawned = this._spawnVigilGuardians(event);
            const acknowledged = this.vigilSiteSystem?.acknowledgeGuardianSpawn?.(event.siteId, spawned);
            if (acknowledged) {
                // The Beacon becomes visible progress only after at least one
                // guardian exists. A cap/placement rejection instead feeds its
                // status event below, without a false 1/4 tracker celebration.
                this.vigilTracker?.ingest?.(event);
                this._recordVigilSiteActivation(event);
                this.waveDirector.announce('GLOAM BEACON — GUARDIANS AWAKEN', 2.4, '#ff6a78');
                this.audio.lieutenantWarn();
            }
            // A rejected acknowledgement emits a status event immediately.
            for (const follow of this.vigilSiteSystem?.drainEvents?.([]) || []) {
                this._handleVigilSiteEvent(follow);
            }
            return;
        }
        this.vigilTracker?.ingest?.(event);
        if (event.kind === 'status') {
            if (event.reason === 'spawn-deferred') {
                this.waveDirector.announce('GLOAM BEACON — CLEAR SPACE AND TRY AGAIN', 2.0, '#d8b16b');
            } else if (event.reason !== 'boss-conflict') {
                this.waveDirector.announce('WAYLIGHT FADES — THE SITE IS SPENT', 2.0, '#a9a1b5');
            }
            return;
        }
        if (event.kind !== 'reward' || !event.reward) return;
        this._recordVigilSiteActivation(event);
        const reward = event.reward;
        let receipt = '';
        if (reward.type === 'heal') {
            const before = this.player.hp;
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + Math.max(0, reward.amount || 0));
            const gained = Math.max(0, Math.round(this.player.hp - before));
            if (gained > 0) {
                this.damageNumbers.push(new DamageNumber(this.player.x, this.player.y - this.player.radius, gained, '#6bff8a'));
                this._pushFeedback('heal', 0.3);
            }
            receipt = `+${gained} HP`;
        } else if (reward.type === 'xp') {
            const amount = Math.max(0, Math.round(reward.amount || 0));
            this._grantVigilXp(amount, event.x, event.y);
            receipt = `${amount} XP`;
        } else if (reward.type === 'coins') {
            const amount = Math.max(0, Math.round(reward.amount || 0));
            this.player.coins = (this.player.coins ?? 0) + amount;
            this.damageNumbers.push(new DamageNumber(event.x, event.y - 36, amount, '#ffd166'));
            receipt = `+${amount} COINS`;
        } else if (reward.type === 'bundle') {
            const coins = Math.max(0, Math.round(reward.coins || 0));
            const xp = Math.max(0, Math.round(reward.xp || 0));
            this.player.coins = (this.player.coins ?? 0) + coins;
            this._grantVigilXp(xp, event.x, event.y);
            this.guardianPacksDefeated += 1;
            receipt = `${coins} COINS + ${xp} XP`;
        }
        this.particles.pickupSparkle(event.x, event.y, event.color ?? '#ffd166');
        this._spawnRing(event.x, event.y, { maxR: 180, width: 8, life: 0.5, color: event.color ?? '#ffd166' });
        this.audio.shrineChime();
        this.waveDirector.announce(`${String(event.label || 'WAYLIGHT').toUpperCase()} — ${receipt}`, 2.5, event.color ?? '#ffd166');
    },

    _recordVigilSiteActivation(event) {
        if (!event?.siteId || this._activatedVigilSiteIds.has(event.siteId)) return false;
        this._activatedVigilSiteIds.add(event.siteId);
        this.vigilSitesActivated += 1;
        if (event.archetype) this._vigilKindsActivated.add(event.archetype);
        this.vigilTracker?.setProgress?.({
            activatedSiteKinds: this._vigilKindsActivated,
            encountersCleared: this.encountersCleared,
        });
        return true;
    },

    _spawnVigilGuardians(event) {
        if (!Array.isArray(event.spawns)) return [];
        const live = this.enemies.reduce((n, enemy) => n + (enemy.active ? 1 : 0), 0);
        const cap = Math.min(WAVE_LIMITS.maxEnemyCap, Math.max(0, Math.floor(this.waveState?.maxAlive ?? WAVE_LIMITS.maxEnemyCap)));
        const limit = Math.max(0, Math.floor(event.maxAlive ?? 3));
        const requests = event.spawns.slice(0, limit);
        // Beacon rewards are authored for one complete pack. Capacity pressure
        // keeps the landmark retryable; it never creates a smaller, full-paying
        // encounter or consumes the site with zero guardians.
        if (!requests.length || cap - live < requests.length) return [];
        const placements = [];
        for (const request of requests) {
            const def = ENEMY[request?.type];
            if (!def || def.boss) return [];
            const radius = Math.max(8, def.radius ?? 30);
            const spot = this._clearSpot(request.x, request.y, Math.max(radius + 8, request.clearance ?? 0));
            if ((this.obstacleSystem.isSpawnBlocked?.(spot.x, spot.y, radius + 6)
                ?? this.obstacleSystem.isBlocked(spot.x, spot.y, radius + 6))) return [];
            placements.push({ request, def, radius, spot });
        }
        const spawned = [];
        for (const { request, spot } of placements) {
            const enemy = new Enemy(request.type, spot.x, spot.y, {
                healthMul: this.waveState.healthMul,
                speedMul: this.waveState.speedMul,
                contactDamageMul: this.waveState.damageMul ?? 1,
                elite: false,
            });
            enemy.vigilSiteId = event.siteId;
            enemy.vigilGuardian = true;
            enemy.encounterGuardian = true;
            this.enemies.push(enemy);
            spawned.push(enemy);
            this.waveDirector.notifySpawn?.(1);
        }
        return spawned;
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
        // The Bell reads the post-collision player position, so merely brushing
        // its radius through a wall can never arm the contract. It advances
        // before house Waylights, whose set-piece gate sees the same-frame
        // ownership transition and cannot overlap a newly started defense.
        this._updateRuinBell(dt);
        this._updateVigilSites(dt);
        // Boss = main event: while a boss is incoming or alive, halt the normal
        // trash spawner so the fight is the player vs. the boss (and only the
        // boss's own themed adds), not a swarm. Normal spawns resume once the
        // boss is dead.
        // Boss Rush is boss-only: the trash spawner never runs (each fight is the
        // player vs. the apex + its own themed adds, with a calm prep phase between).
        const bossOnField = !!this.bossWarning || this.enemies.some((e) => e.active && e.boss);
        if (!bossOnField && !this.bossRush && !this.ruinBellDirector?.ownsStage?.()) {
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
            const wasBossWinding = !!e.boss && e.bossWindupTimer > 0;
            const wasPhaseBreaking = !!e.boss && e.bossPhaseBreakTimer > 0;
            const projectileStart = this.enemyProjectiles.length;
            const hazardStart = this.hazards.length;
            e.update(dt, this.player, this.enemyProjectiles, this.obstacleSystem);
            if (e.ruinBellMemberId) {
                for (let i = projectileStart; i < this.enemyProjectiles.length; i++) {
                    this.enemyProjectiles[i].ruinBellInstanceId = e.ruinBellInstanceId;
                    this.enemyProjectiles[i].ruinBellMemberId = e.ruinBellMemberId;
                }
                for (let i = hazardStart; i < this.hazards.length; i++) {
                    this.hazards[i].ruinBellInstanceId = e.ruinBellInstanceId;
                    this.hazards[i].ruinBellMemberId = e.ruinBellMemberId;
                }
            }
            if (e.boss) {
                // Apex casts use their own timer, so they never reached the
                // regular-enemy transition cues below. Announce both the honest
                // windup and its commit; phase two gets a distinct stinger.
                if (!wasBossWinding && e.bossWindupTimer > 0) {
                    if (this._inView(e.x, e.y, 0)) this.audio.bossTelegraph();
                    this.captionSystem?.sound?.({
                        key: `boss-cast-${e.type}`,
                        text: 'Boss attack charging',
                        priority: 82,
                        cooldown: 1.2,
                    });
                    this.haptics?.pulse?.('bossAttack');
                } else if (wasBossWinding && e.bossWindupTimer <= 0) {
                    if (this._inView(e.x, e.y, 80)) this.audio.bossAttack();
                }
                if (!wasPhaseBreaking && e.bossPhaseBreakTimer > 0) this.audio.enrage();
            }
            if (e.type === 'charger' && this._inView(e.x, e.y, 0)) {
                if (!wasWinding && e.windupTimer > 0) {
                    this.audio.chargerWindup();
                    this.captionSystem?.sound?.({
                        key: 'charger-windup', text: 'Charger winding up',
                        priority: 68, cooldown: 2,
                    });
                }
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
                        ruinBellInstanceId: e.ruinBellInstanceId || null,
                        ruinBellMemberId: e.ruinBellMemberId || null,
                    });
                    if (this._inView(e.x, e.y, 0)) {
                        this.audio.chargerWindup();
                        this.captionSystem?.sound?.({
                            key: 'bomber-fuse', text: 'Bomber fuse ignites',
                            priority: 72, cooldown: 2,
                        });
                    }
                } else if (wasWinding && e.windupTimer <= 0 && e.active) {
                    // Commit: the bee dies in its own blast. A PLAIN bomber is
                    // deliberately NOT routed through the kill/reward path — a
                    // self-detonation pays no XP/kill for standing clear. An
                    // ELITE bomber still owes its rolled loot (affix death,
                    // chest/coin roll, gem, kill credit), so it detonates INTO
                    // the normal pipeline via _selfDetonated instead of
                    // leaking the rewards its elite roll promised.
                    e.active = false;
                    if (e.encounterMemberId) {
                        this._encounterDefeatedIds.push(e.encounterMemberId);
                        if (e.encounterGuardian) this._encounterRewardPos = { x: e.x, y: e.y };
                    }
                    if (e.ruinBellMemberId) this._ruinBellDefeatedIds.push(e.ruinBellMemberId);
                    if (e.elite) this._selfDetonated.push(e);
                    else this.particles.deathBurst(e.x, e.y, '#ff9a4a');
                    if (this._inView(e.x, e.y, 120)) {
                        this.audio.volatileBoom();
                        this.captionSystem?.sound?.({
                            key: 'bomber-blast', text: 'Volatile enemy explodes',
                            detail: 'full', priority: 44, cooldown: 2,
                        });
                    }
                }
            } else if (e.behavior === 'summoner') {
                if (!wasWinding && e.windupTimer > 0) {
                    if (this._inView(e.x, e.y, 0)) {
                        this.audio.chargerWindup();
                        this.captionSystem?.sound?.({
                            key: 'summoner-call', text: 'Summoner calls reinforcements',
                            priority: 64, cooldown: 3,
                        });
                    }
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
            // EnemyProjectile resolves its swept wall segment BEFORE player
            // overlap, so cover can never be damaged through on this frame.
            const dealt = ep.update(dt, this.player, this.obstacleSystem);
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
                this._claimRuinBellReward?.(c);
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
                this._claimRuinBellReward?.(s);
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
        let activeEnemies = 0, nearbyEnemies = 0, eliteThreats = 0;
        this.activeBossRef = null;
        this.activeLieutenantRef = null;
        for (const e of this.enemies) {
            if (!e.active) continue;
            activeEnemies++;
            const dx = e.x - this.player.x, dy = e.y - this.player.y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= 660 * 660) nearbyEnemies++;
            if (e.elite || e.lieutenant) eliteThreats++;
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
                    const voiceCaption = this.audio.musicEvent('phase2', { bossId: e.type });
                    this.waveDirector.announce(`SECOND ACT — ${e.name.toUpperCase()}`, 2.2, '#ff3326');
                    if (voiceCaption) {
                        this.captionSystem?.say?.({
                            key: `boss-phase2-${e.type}`,
                            speaker: e.name || 'Boss',
                            text: voiceCaption,
                        });
                    }
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

        // Adaptive score: use the already-consolidated scan plus hostile geometry
        // that is available in O(1). Proximity, elites, volleys, hazards, wave
        // pressure and the boss phase now matter; off-screen array length alone
        // no longer makes the soundtrack pretend the player is surrounded.
        const boss = this.activeBossRef;
        this.musicState = nextMusicState(this.musicState, {
            activeEnemies,
            nearbyEnemies,
            elites: eliteThreats,
            hostileProjectiles: this.enemyProjectiles.length,
            hazards: this.hazards.length,
            wavePressure: this.waveState?.pressure ?? 0,
            bossActive: !!boss,
            bossHpFraction: boss && boss.maxHp > 0 ? boss.hp / boss.maxHp : 1,
            bossPhase: boss?.phase ?? 1,
            playerHpFraction: this.player.maxHp > 0 ? this.player.hp / this.player.maxHp : 0,
        }, dt);
        const bellMusicHold = this._ruinBellMusicHold;
        if (bellMusicHold && !boss) {
            bellMusicHold.remaining = Math.max(0, bellMusicHold.remaining - Math.max(0, dt));
            if (bellMusicHold.remaining > 0) {
                this.musicState = {
                    ...this.musicState,
                    scene: bellMusicHold.scene,
                    intensity: bellMusicHold.intensity,
                    target: bellMusicHold.intensity,
                };
            } else {
                this._ruinBellMusicHold = null;
            }
        } else if (boss) {
            this._ruinBellMusicHold = null;
        }
        // The encounter owns musical tension even during its authored breath
        // between spawns. Raw crowd pressure alone would otherwise collapse the
        // mix to calm after the first pack dies, making the Bell seem finished
        // while its truthful 45-second seal timer is still running.
        const bellDirector = this.ruinBellDirector;
        if (bellDirector?.ownsStage?.()) {
            const activeBell = bellDirector.phase === 'active';
            const floor = activeBell ? 0.9 : 0.52;
            this.musicState = {
                ...this.musicState,
                intensity: Math.max(this.musicState.intensity, floor),
                target: Math.max(this.musicState.target, floor),
                scene: activeBell ? 'onslaught' : 'hunt',
            };
        }
        if (this.audio.setCombatState) this.audio.setCombatState(this.musicState);
        else this.audio.setIntensity(this.musicState.intensity);

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
            this.haptics?.pulse?.('damage');
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
            if (!this._captionLowHealth) {
                this._captionLowHealth = true;
                this.captionSystem?.sound?.({
                    key: 'low-health', text: 'Heartbeat quickens — health critical',
                    priority: 88, cooldown: 8, lifetime: 2.8,
                });
            }
            this._heartbeatT = (this._heartbeatT ?? 0) - dt;
            if (this._heartbeatT <= 0) { this.audio.heartbeat(); this._heartbeatT = 0.85; }
        } else {
            this._heartbeatT = 0;
            this._captionLowHealth = false;
        }

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
