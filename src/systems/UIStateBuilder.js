// UIStateBuilder — builds the per-frame UI snapshot Game hands to
// UISystem.draw (P1.5 carve-out of Game._buildUIState). Pure read: it never
// mutates game state, only assembles the screen-appropriate fields into a
// fresh snapshot object (one per frame — same shape/cost as before the move).

import { BOSS, CAPS, COMBO, COMPOSURE, MAX_WEAPON_SLOTS, BLINK, KINDLE, ENEMY } from '../config/GameConfig.js';
import { signatureFor } from '../content/signatures.js';
import { TOUR_STEPS } from '../content/tutorialTour.js';
import { OBJECTIVE_COUNT } from '../content/objectives.js';
import { WEAPONS, WEAPON_AURA } from '../content/weapons.js';
import { currentDayNumber } from '../content/dailyChallenges.js';
import { keystoneBreadcrumbs } from '../content/keystones.js';
import { comboDraftHints } from '../content/elements.js';
import { findEligibleEvolutions } from '../content/evolutions.js';
import { getRelic } from '../content/relics.js';

export function buildUIState(game) {
    // Fields every screen needs. Press/feedback animation state is
    // always included so flashes can play across transitions.
    const base = {
        screen: game.screen,
        showDebug: game.showDebug,
        saveData: game.saveSystem.data,
        pressFx: game.pressFx,
        feedback: game.feedback,
    };

    // Start/shop screen: only the shop data is meaningful. Skip every
    // gameplay snapshot + the per-frame evolution scan entirely.
    if (game.screen === 'start') {
        base.resetConfirming = game.resetConfirming;
        base.resetConfirmTimer = game.resetConfirmTimer;
        base.stats = game.saveSystem.data.stats;
        // Menu state consumed by MenuRenderer.
        base.menuTab = game.menuTab;
        // Guided menu tour: the current step's card content + progress (null
        // when not touring). MenuRenderer draws the overlay from this snapshot.
        base.menuTour = game.menuTour ? {
            idx: game.menuTour.idx,
            total: TOUR_STEPS.length,
            ...TOUR_STEPS[game.menuTour.idx],
        } : null;
        base.caseAnim = game.minigame.caseAnim;
        base.menuToast = game.menuToastTimer > 0 ? game.menuToast : null;
        base.gamblePlays = game.saveSystem.gamblePlaysInfo();
        // "Vigil Endures": pre-run difficulty + active Trial modifiers.
        base.difficulty = game.saveSystem.getDifficulty();
        base.selectedModifiers = [...game.selectedModifiers];
        base.selectedPatron = game.selectedPatron;
        // ATTUNE altar: which relic is staged on the detail pane.
        base.attuneSel = game.attuneSel;
        // Daily Road: today's best (for the menu's "best today" readout). Gated
        // on the record's day so a new UTC day shows 0 until a run is played
        // (the record self-resets on the first daily of the new day).
        const _dr = game.saveSystem.data.dailyRoad;
        const _today = currentDayNumber();
        base.dailyRoadBest = (_dr && _dr.day === _today) ? (_dr.best ?? 0) : 0;
        // Yesterday's best: either stashed at today's day-roll (prevBest) or,
        // if no daily has run yet today, a record dated exactly yesterday.
        base.dailyRoadPrevBest = _dr
            ? (_dr.day === _today ? (_dr.prevBest ?? 0) : (_dr.day === _today - 1 ? (_dr.best ?? 0) : 0))
            : 0;
        // KINDLED PR5 — Rite Trial best-of-day (identical day-gated shape to dailyRoad).
        const _rt = game.saveSystem.data.riteTrial;
        base.riteTrialBest = (_rt && _rt.day === _today) ? (_rt.best ?? 0) : 0;
        base.riteTrialPrevBest = _rt
            ? (_rt.day === _today ? (_rt.prevBest ?? 0) : (_rt.day === _today - 1 ? (_rt.best ?? 0) : 0))
            : 0;
        // BOSSFORGE — Boss Rush all-time best (bosses felled) for the PLAY-screen CTA.
        base.bossRushBest = game.saveSystem.data.bossRush?.bestBosses ?? 0;
        // Weekly Ember best-of-week (week-gated like riteTrialBest is day-gated).
        const _we = game.saveSystem.data.weeklyEmber;
        const _thisWeek = Math.floor(_today / 7);
        base.weeklyEmberBest = (_we && _we.week === _thisWeek) ? (_we.best ?? 0) : 0;
        base.weeklyEmberPrevBest = _we
            ? (_we.week === _thisWeek ? (_we.prevBest ?? 0) : (_we.week === _thisWeek - 1 ? (_we.best ?? 0) : 0))
            : 0;
        // Day streak for the PLAY tab — alive if the last played day is
        // today or yesterday (a yesterday-streak still extends by playing).
        const _st = game.saveSystem.data.streak;
        base.dayStreak = (_st && (_st.day === _today || _st.day === _today - 1)) ? (_st.count ?? 0) : 0;
        return base;
    }

    // Gameplay + game-over share the HUD.
    base.time = game.time;
    base.player = game.player;
    base.camera = game.camera;
    base.kills = game.kills;
    base.combo = game.combo;
    base.comboTimer = game.comboTimer;
    base.comboWindow = COMBO.window;
    base.objectivesDone = game._objDone ? game._objDone.size : 0;
    base.objectivesTotal = OBJECTIVE_COUNT;
    base.objectivesCompleted = game._objCompleted || [];
    base.enemyCount = game.enemies.length;
    base.projectileCount = game.projectiles.length;
    base.gemCount = game.gems.length;
    base.coinCount = game.coins.length;
    base.effectCount = game.weaponSystem.effects.length;
    // Perf-HUD counters (only computed when the debug panel is open, since
    // activeCount scans the particle pool).
    base.enemyProjectileCount = game.enemyProjectiles.length;
    base.hazardCount = game.hazards.length;
    base.pickupCount = game.gems.length + game.coins.length + game.chests.length + game.healthOrbs.length;
    base.particleCount = game.showDebug ? game.particles.activeCount() : 0;
    base.gfxTier = game._gfxLevel;   // adaptive quality tier (roadmap #5), debug HUD
    base.veilScale = game.lighting?.veilScale ?? 1;   // darkness-veil buffer scale, debug HUD
    base.ownedWeapons = game.weaponSystem.snapshotForUI();
    // Ability cooldowns for the HUD pips: one entry per owned ABILITY
    // (def.ability) with its remaining/total cooldown + ready state. Total
    // uses the level's base cooldown × the player's cooldown multiplier so
    // the fill matches what the ability actually uses.
    const cdMul = game.player.cooldownMul ?? 1;
    const abilityCds = [];
    for (const w of game.weaponSystem.owned) {
        const def = WEAPONS[w.id];
        if (!def || !def.ability) continue;
        const lvl = def.perLevel[w.level];
        const total = Math.max(0.01, (lvl?.cooldown ?? 1) * cdMul);
        const remaining = Math.max(0, w.timer ?? 0);
        abilityCds.push({
            id: w.id,
            name: def.name,
            color: (WEAPON_AURA[w.id] && WEAPON_AURA[w.id].color) || '#cdd8e6',
            remaining,
            total,
            ready: remaining <= 0.001,
        });
    }
    // KINDLED: the universal aimed blink shares the ability-cooldown pip row as
    // a synthetic entry (it isn't a WEAPONS ability, but reads identically —
    // sweep + ready pulse). Cooldown state lives on KindleSystem.
    if (game.kindleSystem) {
        const bcd = Math.max(0, game.kindleSystem.blinkCooldown ?? 0);
        abilityCds.push({
            id: 'blink',
            name: 'Blink',
            color: '#8fd0ff',
            remaining: bcd,
            total: BLINK.cooldown,
            ready: bcd <= 0.001,
        });
    }
    base.abilityCooldowns = abilityCds;
    // KINDLED: the Kindle ult meter + live Focus-Time aim state. ultName/color
    // come from the run hero's Grand Signature; aiming carries the angle, aim
    // kind (ring/lane/cone/…), and hold progress so the HUD can draw the ground
    // template + a slow-mo vignette.
    const _k = game.kindleSystem;
    const _sig = _k ? signatureFor(game._heroId) : null;
    base.kindle = _k ? {
        fill: _k.fill,
        max: _k.max,
        ready: _k.ready,
        ultName: _sig ? _sig.name : null,
        ultColor: _sig ? _sig.color : '#ff8c4a',
        range: _sig ? _sig.range : 620,
        aiming: _k.aiming
            ? { angle: _k.aiming.angle, kind: _k.aiming.kind, tHeld: _k.aiming.t, tMax: KINDLE.focusTimeMax }
            : null,
    } : null;
    // Focus target snapshot (world pos + hp + kind) for the reticle + HP accent.
    const _ft = game.focusTarget;
    base.focusTarget = (_ft && _ft.active)
        ? { x: _ft.x, y: _ft.y, hp: _ft.hp, maxHp: _ft.maxHp, radius: _ft.radius ?? 20, elite: !!_ft.elite, boss: !!_ft.boss }
        : null;
    base.ownedPassives = game.passiveSystem.snapshotForUI();
    // Relics claimed at Wick Shrines this run — the HUD's loadout column
    // shows them as rarity-tinted chips (they were tracked but invisible).
    base.runRelics = (game._runRelics && game._runRelics.length)
        ? game._runRelics
            .map((id) => { const r = getRelic(id); return r ? { name: r.name, rarity: r.rarity } : null; })
            .filter(Boolean)
        : [];
    base.runCoins = game.player.coins ?? 0;
    base.chestLuck = game.player.chestLuck ?? 0;
    base.waveState = game.waveState;
    // Pressure-wave tracking for the HUD (live counters + 0..1 pressure).
    base.wavePressure = game.waveState?.pressure ?? 0;
    base.waveKills = game.waveDirector.killsThisWave ?? 0;
    base.waveSpawned = game.waveDirector.spawnedThisWave ?? 0;
    base.waveTimeIn = game.waveDirector.timeInWave ?? 0;
    base.waveAnnouncement = game.waveDirector.announcement;
    base.activeBoss = game.activeBossRef ? {
        name: game.activeBossRef.name,
        epithet: game.activeBossRef.epithet ?? null,
        tier: game.activeBossRef.tier ?? null,
        hp: game.activeBossRef.hp,
        maxHp: game.activeBossRef.maxHp,
        phase: game.activeBossRef.phase ?? 1,
        enraged: !!game.activeBossRef.phase2Entered,
        x: game.activeBossRef.x,
        y: game.activeBossRef.y,
    } : null;
    base.bossWarning = game.bossWarning
        ? { name: game.bossWarning.name, epithet: game.bossWarning.epithet ?? null,
            tier: game.bossWarning.tier ?? null, t: 1 - game.bossWarning.timer / game.bossWarning.total }
        : null;
    // BOSSFORGE — Boss Rush HUD status (label, boss X/N, next boss name, prep
    // timer, progress). Null in every other mode. Names resolved from ENEMY.
    if (game.bossRush) {
        const st = game.bossRush.getStatus();
        const nm = (id) => (id ? (ENEMY[id]?.bossName ?? id) : null);
        base.bossRush = {
            label: st.label,
            phase: st.phase,
            bossNumber: st.bossNumber,
            total: st.total,
            bossesDefeated: st.bossesDefeated,
            currentBossName: nm(st.currentBossId),
            nextBossName: nm(st.nextBossId),
            prepRemaining: st.prepRemaining,
            cleared: st.cleared,
        };
    } else {
        base.bossRush = null;
    }
    // Lieutenant mini-boss: a small HP bar + its own warning tell.
    base.activeLieutenant = game.activeLieutenantRef ? {
        name: game.activeLieutenantRef.name,
        hp: game.activeLieutenantRef.hp,
        maxHp: game.activeLieutenantRef.maxHp,
    } : null;
    base.lieutenantWarning = game.lieutenantWarning
        ? { t: 1 - game.lieutenantWarning.timer / game.lieutenantWarning.total }
        : null;
    base.chestCount = game.chests.length;
    base.chestReward = game.chestReward;
    base.pendingChests = game.pendingChests;
    base.altar = game.altar;
    base.pendingAltars = game.pendingAltars;
    base.nextBossTime = game.bossDirector.getNextSpawnTime();
    // Boss scheduler state for the debug panel: live count + why a spawn
    // is/ isn't happening + when the next one is eligible.
    const bossAliveNow = game.enemies.some((e) => e.active && e.boss);
    base.bossActiveCount = game.enemies.reduce((n, e) => n + (e.active && e.boss ? 1 : 0), 0);
    base.bossStatus = game.bossDirector.getStatus(game.time, bossAliveNow);
    // Player power multipliers (debug): show the run's effective scaling.
    base.playerDamageMul = game.player.damageMul;
    base.playerCooldownMul = game.player.cooldownMul;
    base.playerSpeed = game.player.speed;
    base.playerXpMul = game.player.xpMultiplier;
    base.playerPickupRange = game.player.pickupRange;
    base.healPerSecondCap = CAPS.healPerSecond;
    // Enemy + boss time-scaling readouts for late-game balancing.
    base.minute = game.time / 60;
    base.enemyHpMul = game.waveState?.healthMul ?? 1;
    base.enemySpeedMul = game.waveState?.speedMul ?? 1;
    base.enemyDamageMul = game.waveState?.damageMul ?? 1;
    // Composure (skill-adaptive relief): the meter, the endless surcharge it
    // gates against, and the resulting incoming-damage cut currently in effect.
    base.composure = game.player.composure ?? 1;
    base.endlessSurcharge = game.player.endlessSurcharge ?? 0;
    base.composureRelief = COMPOSURE.enabled
        ? COMPOSURE.maxRelief * (game.player.composure ?? 1) * (game.player.endlessSurcharge ?? 0)
        : 0;
    base.hyperMul = game.waveState?.hyperMul ?? 1;
    base.bossHpMul = Math.min(1 + (game.time / 60) * BOSS.hpPerMinute, BOSS.maxHpMul);
    base.bossResist = Math.min((game.time / 60) * BOSS.resistPerMinute, BOSS.maxResist);
    base.ownedWeaponCount = game.weaponSystem.owned.length;
    // Slot cap (P0.3): the level-up overlay renders "SLOTS n/cap".
    base.weaponSlotCap = MAX_WEAPON_SLOTS;
    // Debug-only; reduce (not filter) to avoid a per-frame array alloc.
    base.evolvedWeaponCount = game.showDebug
        ? game.weaponSystem.owned.reduce((n, w) => n + (WEAPONS[w.id]?.evolved ? 1 : 0), 0)
        : 0;
    base.auraStyle = game._auraSnapshot ? game._auraSnapshot.label : '';
    base.auraIntensity = game._auraSnapshot ? game._auraSnapshot.intensity : 0;
    base.auraRadius = game._auraSnapshot ? game._auraSnapshot.radius : 0;
    // Only the debug panel shows this, and the scan walks every
    // evolution every frame — so only pay for it when debug is on.
    base.eligibleEvolutionCount = game.showDebug ? findEligibleEvolutions(game).length : 0;
    base.spawnTimer = game.spawner.timer;
    base.spawnInterval = game.spawner.nextInterval;
    base.inContact = game.collisionSystem.inContact;
    base.upgradeChoices = game.upgradeChoices;
    base.upgradeCounts = game.upgradeSystem.appliedCounts;
    base.pendingLevelUps = game.pendingLevelUps;
    // Keystone breadcrumbs (only while the level-up overlay is up): which
    // recipe-gated capstones are one piece short, so the screen can hint
    // what to build toward. Cheap; computed only during a level-up.
    if (game.upgradeChoices) {
        const counts = game.upgradeSystem.appliedCounts;
        base.keystoneHints = keystoneBreadcrumbs(game, (id) => (counts[`keystone:${id}`] ?? 0) >= 1, 2);
        // KINDLED: element-combo breadcrumb — which cross-element reaction a pick
        // would unlock (offered NEW element × an owned element). Choice ids are
        // `weapon:<id>:<new|upgrade>`, so the element resolves from WEAPONS[<id>].
        const ownedEls = game.weaponSystem.owned.map((w) => WEAPONS[w.id]?.element).filter(Boolean);
        const offeredEls = game.upgradeChoices
            .filter((c) => c && (c.kind === 'weapon-new' || c.kind === 'weapon-upgrade'))
            .map((c) => WEAPONS[c.id?.split(':')[1]]?.element)
            .filter(Boolean);
        base.comboHints = comboDraftHints(ownedEls, offeredEls, 2);
    }
    base.levelUpAge = game.levelUpAge;
    // First-run onboarding: the tutorial banner snapshot (lesson n/total +
    // text + ✓ done-flash; null when done/veteran), the world-space point the
    // lesson is about (the HUD draws a chevron pointer over it), and the extra
    // reassurance line on the first level-up overlay.
    base.onboardingLesson = game._onboardingLessonState();
    base.tutorialTarget = game._tutorialTarget || null;
    base.onboardingLevelUp = !!(game.onboarding && game.onboarding.step >= 3 && game.upgradeChoices);
    base.gameOver = game.gameOver;
    base.gameOverAge = game.gameOverAge;
    base.bossesDefeated = game.bossesDefeated;
    base.runSummary = game.runSummary;
    base.newBest = game.newBest;
    // Battle-pass XP from this run (set in _enterGameOver) — the game-over
    // summary draws it, so the meta reward is VISIBLE, not silently banked.
    base.bpResult = game.bpResult;
    // EMBERGLASS: the minted share card (a live canvas handle, by reference) +
    // the transient share toast. Null-guarded on consumption; carried like
    // base.player/base.camera above (no serialization, no per-frame alloc).
    base.mintedCard = game.mintedCard;
    base.shareToast = game.shareToast;
    base.paused = game.paused;
    base.shakeEnabled = game.shakeEnabled;
    base.rerolls = game.rerolls;
    base.banishes = game.banishes;
    base.alters = game.alters;
    return base;
}
