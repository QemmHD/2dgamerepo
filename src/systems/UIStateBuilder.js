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
import {
    COSMETIC_BLUEPRINT_IDS,
    COSMETIC_SETS,
    cosmeticBlueprintCost,
    cosmeticById,
} from '../content/cosmetics.js';
import { bossAttackLabel } from './BossChoreographer.js';

export const COLLECTION_COMPLETION_SECTIONS = Object.freeze([
    'overview', 'sets', 'sources', 'blueprint', 'case',
]);
export const COLLECTION_COMPLETION_DEFAULT_BLUEPRINT_ID = 'aura_requiem';
export const COLLECTION_BLUEPRINT_CONFIRM_MS = 3000;

const COLLECTION_COMPLETION_SECTION_SET = new Set(COLLECTION_COMPLETION_SECTIONS);
const COSMETIC_BLUEPRINT_ID_SET = new Set(COSMETIC_BLUEPRINT_IDS);
const BLUEPRINT_RECEIPT_REASON_SET = new Set([
    'invalid-id', 'unknown-cosmetic', 'not-blueprint', 'invalid-quote',
    'invalid-catalog-cost', 'quote-mismatch', 'invalid-state', 'replay',
    'already-owned', 'invalid-balance', 'insufficient-coins',
    'persistence-unavailable', 'external-save-changed', 'persistence-failed',
    'transaction-busy', 'transaction-lock-unavailable', 'transaction-lock-failed',
    'purchase-unavailable', 'invalid-purchase-receipt',
]);

// The browser performance clock is monotonic and unaffected by wall-clock or
// timezone corrections. Tests may inject an equivalent monotonic source on the
// Game-like object; malformed/throwing injections fail closed.
export function blueprintClockNow(game = null) {
    if (typeof game?._blueprintClockNow === 'function') {
        try {
            const injected = game._blueprintClockNow();
            if (Number.isFinite(injected) && injected >= 0) return Math.floor(injected);
        } catch (e) { /* fail closed below */ }
        return null;
    }
    const performanceNow = globalThis.performance?.now;
    if (typeof performanceNow === 'function') {
        const value = globalThis.performance.now();
        if (Number.isFinite(value) && value >= 0) return Math.floor(value);
    }
    // Do not fall back to adjustable wall time: a backward correction could
    // lengthen a paid-action window. Unsupported runtimes fail closed instead.
    return null;
}

// Collection Completion is navigation state, not progression. Keep the pure
// snapshot strict so malformed integration input can never turn into an
// invented pane, page, or Blueprint target, and return a fresh object so the
// renderer cannot mutate Game by retaining a frame snapshot.
export function collectionCompletionSnapshot(game) {
    const raw = game?.collectionCompletion;
    return {
        open: raw?.open === true,
        section: COLLECTION_COMPLETION_SECTION_SET.has(raw?.section)
            ? raw.section : 'overview',
        page: Number.isSafeInteger(raw?.page) && raw.page > 0 ? raw.page : 1,
        blueprintId: COSMETIC_BLUEPRINT_ID_SET.has(raw?.blueprintId)
            ? raw.blueprintId : COLLECTION_COMPLETION_DEFAULT_BLUEPRINT_ID,
    };
}

// Expired, mismatched, or clock-anomalous confirmations are hidden without
// mutating Game; the next purchase press safely re-arms through the action layer.
export function blueprintConfirmSnapshot(game, now = blueprintClockNow(game)) {
    const flow = collectionCompletionSnapshot(game);
    const pending = game?.blueprintConfirm;
    if (!flow.open || flow.section !== 'blueprint' || !pending
        || pending.id !== flow.blueprintId
        || !COSMETIC_BLUEPRINT_ID_SET.has(pending.id)
        || !Number.isSafeInteger(pending.armedAt) || pending.armedAt < 0
        || !Number.isSafeInteger(pending.expiresAt)
        || pending.expiresAt - pending.armedAt !== COLLECTION_BLUEPRINT_CONFIRM_MS
        || !Number.isFinite(now) || now < pending.armedAt
        || !(pending.expiresAt > now)) return null;
    return {
        id: pending.id,
        armedAt: pending.armedAt,
        expiresAt: pending.expiresAt,
        seconds: Math.max(1, Math.ceil((pending.expiresAt - now) / 1000)),
    };
}

export function blueprintPurchasePendingSnapshot(game) {
    const flow = collectionCompletionSnapshot(game);
    const pending = game?.blueprintPurchasePending;
    if (!flow.open || flow.section !== 'blueprint' || !pending
        || pending.id !== flow.blueprintId
        || !COSMETIC_BLUEPRINT_ID_SET.has(pending.id)
        || !Number.isSafeInteger(pending.serial) || pending.serial <= 0) return null;
    return { id: pending.id };
}

const receiptInt = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;

// Receipts are copied and allowlisted before crossing the Game/UI boundary.
// They are deliberately session-only: SaveSystem owns the durable unlock and
// claim ledger, while this object only explains the latest attempt.
export function blueprintReceiptSnapshot(game) {
    const receipt = game?.blueprintReceipt;
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
        || !COSMETIC_BLUEPRINT_ID_SET.has(receipt.id)) return null;
    const item = cosmeticById(receipt.id);
    const cost = cosmeticBlueprintCost(item);
    if (!item || receipt.name !== item.name || receipt.cost !== cost) return null;

    if (receipt.ok === true && receipt.kind === 'success') {
        const balanceBefore = receiptInt(receipt.balanceBefore);
        const balanceAfter = receiptInt(receipt.balanceAfter);
        const collectionBefore = receiptInt(receipt.collectionBefore);
        const collectionAfter = receiptInt(receipt.collectionAfter);
        const setBefore = receiptInt(receipt.setBefore);
        const setAfter = receiptInt(receipt.setAfter);
        if ([balanceBefore, balanceAfter, collectionBefore, collectionAfter, setBefore, setAfter]
            .some((value) => value === null)) return null;
        const set = receipt.setId === null
            ? null : COSMETIC_SETS.find((candidate) => candidate.id === receipt.setId) || null;
        if (receipt.setId !== null && !set) return null;
        if (balanceBefore - balanceAfter !== cost
            || collectionAfter - collectionBefore !== 1
            || (set ? setAfter - setBefore !== 1 : setBefore !== 0 || setAfter !== 0)) return null;
        return {
            ok: true,
            kind: 'success',
            id: receipt.id,
            name: item.name,
            cost,
            balanceBefore,
            balanceAfter,
            collectionBefore,
            collectionAfter,
            setId: set?.id ?? null,
            setName: set?.name ?? null,
            setBefore,
            setAfter,
        };
    }

    if (receipt.ok !== false || !BLUEPRINT_RECEIPT_REASON_SET.has(receipt.reason)) return null;
    const balance = receiptInt(receipt.balance);
    const shortfall = receiptInt(receipt.shortfall);
    if (balance === null || shortfall === null) return null;
    if (receipt.reason === 'insufficient-coins') {
        if (shortfall !== Math.max(0, cost - balance) || shortfall <= 0) return null;
    } else if (shortfall !== 0) return null;
    return {
        ok: false,
        kind: receipt.kind === 'insufficient' ? 'insufficient' : 'error',
        reason: receipt.reason,
        id: receipt.id,
        name: item.name,
        cost,
        balance,
        shortfall,
    };
}

// The gameplay tutorial is world guidance, never modal content. Keeping this
// gate pure and centralized prevents its banner/pointer from being painted
// beneath a level-up, reward, shrine, pause, victory, death, or Lens surface.
export function onboardingModalActive(game) {
    return !!(game.upgradeChoices || game.chestReward || game.altar || game.paused
        || game.victory || game.gameOver || game.photoMode);
}

// Pause confirmations expire on wall time because gameplay update is frozen.
// A stale stored object is harmless; callers receive null after its deadline,
// and requestPauseExit re-arms it rather than executing.
export function pauseExitConfirmSnapshot(game, now = Date.now()) {
    const pending = game.pauseExitConfirm;
    if (!game.paused || !pending || (pending.action !== 'restart' && pending.action !== 'menu')
        || !(pending.expiresAt > now)) return null;
    return {
        action: pending.action,
        seconds: Math.max(1, Math.ceil((pending.expiresAt - now) / 1000)),
    };
}

// The Ruin Bell temporarily borrows the existing single guidance card; it
// never creates a competing HUD panel. Away from the cabin, the normal Run
// Path remains visible. Near/engaged/retry states expose the encounter's pure
// director snapshot through the same visual and accessibility language.
export function ruinBellObjectiveSnapshot(game, providedGuidance = undefined) {
    if (game?.screen !== 'gameplay') return null;
    const director = game?.ruinBellDirector;
    const guidance = providedGuidance === undefined
        ? director?.getGuidanceSnapshot?.() : providedGuidance;
    if (!guidance?.visible) return null;
    const phase = guidance.phase;
    // Completion keeps the cabin and bell visibly lit, but the single Run Path
    // card must return to its normal owner once either authored reward is taken.
    if (phase === 'cleared' && guidance.rewardClaimed === true) return null;
    const near = guidance.inActivationRange === true;
    const ownsCard = guidance.urgent === true
        || near
        || (phase === 'cleared' && guidance.rewardClaimed !== true)
        || phase === 'retry-cooldown'
        || phase === 'technical-defer';
    if (!ownsCard) return null;

    const labels = {
        locked: 'UNLOCK',
        dormant: guidance.attempt > 1 ? 'RING AGAIN' : 'RING',
        arming: 'HOLD',
        warning: 'BRACE',
        active: 'DEFEND',
        'technical-defer': 'RESET',
        'retry-cooldown': 'RECOVER',
        cleared: 'REWARD',
        spent: 'RESULT',
    };
    const countdown = Number.isFinite(guidance.countdown)
        ? Math.max(0, guidance.countdown) : null;
    const current = Number.isFinite(guidance.current) ? guidance.current : 0;
    const target = Math.max(1, Number.isFinite(guidance.target) ? guidance.target : 1);
    const progressLabel = phase === 'arming'
        ? `${current.toFixed(1)} / ${target.toFixed(2)}s`
        : countdown == null
            ? `${Math.round(current)} / ${Math.round(target)}`
            : `${Math.ceil(countdown)}s · ${Math.round(current)}/${Math.round(target)}`;
    return {
        owner: 'ruin-bell',
        id: `ruin-bell:${phase}:${guidance.attempt}:${guidance.stageId || 'none'}`,
        phaseLabel: 'HOUSE CONTRACT',
        phaseNumeral: guidance.symbol || 'BELL',
        headerLabel: `RUIN BELL · ${guidance.attemptLabel}`,
        title: guidance.title,
        nextAction: guidance.nextAction,
        bodyLabel: labels[phase] || 'NEXT',
        current,
        target,
        progress: Math.max(0, Math.min(1, Number(guidance.progress) || 0)),
        progressLabel,
        reward: { amount: 0 },
        rewardLabel: guidance.rewardLabel,
        rewardColor: phase === 'spent' ? '#a9a1b5' : '#7fe0a0',
        contextText: countdown == null
            ? (game.input?.isTouchMode?.() ? 'HOUSE CONTRACT' : 'O · HEAR CONTRACT')
            : `${guidance.countdownLabel || 'TIMER'} · ${Math.ceil(countdown)}s`,
        accent: guidance.accent,
        complete: guidance.complete === true,
        accessibilityText: guidance.accessibilityText,
    };
}

export function buildUIState(game) {
    // Fields every screen needs. Press/feedback animation state is
    // always included so flashes can play across transitions.
    const base = {
        screen: game.screen,
        showDebug: game.showDebug,
        saveData: game.saveSystem.data,
        pressFx: game.pressFx,
        feedback: game.feedback,
        vibrationSupported: game.haptics?.supported?.() === true,
        caption: game.captionSystem?.snapshot?.() || null,
    };

    // Start/shop screen: only the shop data is meaningful. Skip every
    // gameplay snapshot + the per-frame evolution scan entirely.
    if (game.screen === 'start') {
        base.resetConfirming = game.resetConfirming;
        base.resetConfirmTimer = game.resetConfirmTimer;
        base.stats = game.saveSystem.data.stats;
        // Menu state consumed by MenuRenderer.
        base.menuTab = game.menuTab;
        base.settingsPane = game.settingsPane === 'accessibility' ? 'accessibility' : 'general';
        base.characterPhonePane = game.characterPhonePane === 'rites' ? 'rites' : 'collection';
        base.collectionCompletion = collectionCompletionSnapshot(game);
        base.blueprintConfirm = blueprintConfirmSnapshot(game);
        base.blueprintPurchasePending = blueprintPurchasePendingSnapshot(game);
        base.blueprintReceipt = blueprintReceiptSnapshot(game);
        // One campaign snapshot owns Home, Play, accessibility labels, launch
        // validation, and the session-only QA view. Renderers never infer map
        // access from lifetime stats or raw persisted selection again.
        base.selectedMap = game.saveSystem.getEffectiveSelectedMap();
        base.mapUnlockStatuses = game.saveSystem.getAllMapUnlockStatuses();
        base.mapBypassActive = game.saveSystem.getMapBypassActive();
        base.menuFocusKey = game.menuFocusKey || null;
        base.menuFocusVisible = game.input?.getModality?.() === 'keyboard';
        base.inputModality = game.input?.getModality?.() || 'pointer';
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
        // BOUTIQUE fitting room: the session try-on map (category → id).
        base.tryOn = game.tryOn;
        // Collection/Boutique browse state is copied so renderers can clamp and
        // derive pages without mutating Game during a pure UI snapshot.
        base.collectionView = { ...(game.collectionView || {}) };
        base.boutiqueView = { ...(game.boutiqueView || {}) };
        // Preserve the most recent run's transparent Vigil-XP receipt after
        // returning to the menu so the Battle Pass can explain exactly what
        // moved its bar (kindling, endurance, hunt, deeds, Trials, threat).
        base.bpResult = game.bpResult;
        base.runSummary = game.runSummary;
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
    // Touch devices draw the BLINK/KINDLE action discs (TouchButtons), whose
    // rims already ARE the cooldown/ult meters — the HUD hides its duplicate
    // bar + blink pip there and lifts the weapon pips clear of the discs.
    base.touchMode = !!game.input?.isTouchMode?.();
    base.player = game.player;
    base.camera = game.camera;
    base.kills = game.kills;
    base.combo = game.combo;
    base.comboTimer = game.comboTimer;
    base.comboWindow = COMBO.window;
    base.objectivesDone = game._objDone ? game._objDone.size : 0;
    base.objectivesTotal = OBJECTIVE_COUNT;
    base.objectivesCompleted = game._objCompleted || [];
    base.vigilTracker = game.vigilTracker?.getSnapshot?.() ?? null;
    const directorObjective = game.runObjectiveDirector?.getSnapshot?.() ?? null;
    base.runObjective = game._currentRunObjectiveSnapshot?.(
        directorObjective,
        base.vigilTracker?.prompt ?? null,
    ) ?? directorObjective;
    base.ruinBellGuidance = game.ruinBellDirector?.getGuidanceSnapshot?.() ?? null;
    base.runObjective = ruinBellObjectiveSnapshot(game, base.ruinBellGuidance) ?? base.runObjective;
    base.runPathSummary = game.runObjectiveDirector?.getSummary?.() ?? {
        completedPhases: base.objectivesDone,
        totalPhases: OBJECTIVE_COUNT,
        allComplete: base.objectivesDone >= OBJECTIVE_COUNT,
        active: null,
    };
    base.objectiveRewardsEligible = game._objectiveRewardsEligible !== false;
    base.objectiveCoinsHeld = game._guidedObjectiveHeldCoins?.() ?? 0;
    base.objectiveRewardSettlement = game._objRewardSettlement ?? null;
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
    const _bossRef = game.activeBossRef;
    const _castTotal = _bossRef?.bossWindupDuration ?? 0;
    const _openingTotal = _bossRef?.bossRecoveryDuration ?? 0;
    base.activeBoss = _bossRef ? {
        name: _bossRef.name,
        epithet: _bossRef.epithet ?? null,
        tier: _bossRef.tier ?? null,
        hp: _bossRef.hp,
        maxHp: _bossRef.maxHp,
        phase: _bossRef.phase ?? 1,
        enraged: !!_bossRef.phase2Entered,
        x: _bossRef.x,
        y: _bossRef.y,
        phaseBreak: (_bossRef.bossPhaseBreakTimer ?? 0) > 0,
        casting: _bossRef.activeAttack && _bossRef.bossWindupTimer > 0 ? {
            label: _bossRef.activeAttackLabel || bossAttackLabel(_bossRef.activeAttack),
            progress: _castTotal > 0
                ? Math.max(0, Math.min(1, 1 - _bossRef.bossWindupTimer / _castTotal))
                : 0,
        } : null,
        opening: _bossRef.bossRecoveryTimer > 0 ? {
            progress: _openingTotal > 0
                ? Math.max(0, Math.min(1, 1 - _bossRef.bossRecoveryTimer / _openingTotal))
                : 0,
        } : null,
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
    const onboardingBlocked = onboardingModalActive(game);
    base.onboardingLesson = onboardingBlocked ? null : game._onboardingLessonState();
    base.tutorialTarget = onboardingBlocked ? null : (game._tutorialTarget || null);
    // The reassurance belongs only to the tutorial's FIRST level-up lesson.
    // `>= 3` repeated it behind every later draft while onboarding was alive.
    base.onboardingLevelUp = !!(game.onboarding && game.onboarding.step === 3 && game.upgradeChoices);
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
    base.victory = !!game.victory;
    base.photoMode = !!game.photoMode;
    base.pauseExitConfirm = pauseExitConfirmSnapshot(game);
    base.shakeEnabled = game.shakeEnabled;
    base.rerolls = game.rerolls;
    base.banishes = game.banishes;
    base.alters = game.alters;
    return base;
}
