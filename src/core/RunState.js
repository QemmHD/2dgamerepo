// Run-state creation + reset. Split out of Game.js as part of the "move code,
// don't change behavior" decomposition: `_initRunState` is the exact same method
// relocated onto Game.prototype via Object.assign in Game.js, so every caller
// (_startRun, the constructor at boot) is unchanged and behavior is byte-identical.
// `this` is the Game instance throughout.
//
// Owns the single "begin a fresh run" state build: every run array (enemies,
// projectiles, gems, hazards, coins, …), every per-run system instance
// (Spawner / WeaponSystem / KindleSystem / CollisionSystem / UpgradeSystem /
// PassiveSystem / WaveDirector / BossDirector / LieutenantDirector), the pooled
// resources reset-not-realloc'd across runs (projectilePool / spatialIndex /
// particles), and all the run-scoped scalars/latches (time, kills, combo, run
// records, overlay clocks, KINDLED counters). Called by _startRun before it
// applies permanent upgrades, and once at boot to prime a valid state.

import { Player } from '../entities/Player.js';
import { Spawner } from '../systems/Spawner.js';
import { WeaponSystem } from '../systems/WeaponSystem.js';
import { KindleSystem } from '../systems/KindleSystem.js';
import { attuneEffects } from '../content/heroAttunement.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { ProjectilePool } from '../systems/ProjectilePool.js';
import { FrameSpatialIndex } from '../systems/FrameSpatialIndex.js';
import { UpgradeSystem } from '../systems/UpgradeSystem.js';
import { PassiveSystem } from '../systems/PassiveSystem.js';
import { WaveDirector } from '../systems/WaveDirector.js';
import { BossDirector } from '../systems/BossDirector.js';
import { LieutenantDirector } from '../systems/LieutenantDirector.js';
import { resolveStartingWeapon } from '../systems/LoadoutSystem.js';
import { getMapBosses, getMapTier } from '../content/maps.js';

export const RunStateMethods = {
    _initRunState() {
        this.player = new Player(undefined, undefined, this._effectiveCharacterId());
        this.camera.follow(this.player);

        this.enemies = [];
        this.projectiles = [];
        // Player-bolt pool: built ONCE, then RESET (not re-allocated) on every
        // run so bolts are reused across runs and a restart inherits no live
        // projectile (the array above is fresh, so releaseAll can't double-list).
        if (this.projectilePool) this.projectilePool.releaseAll();
        else this.projectilePool = new ProjectilePool();
        // Shared per-frame enemy spatial index (rebuilt each frame, so no per-run
        // reset needed — the first rebuild clears any stale state).
        if (!this.spatialIndex) this.spatialIndex = new FrameSpatialIndex();
        this.enemyProjectiles = [];
        // Damaging area hazards (boss shockwaves) + their telegraph decals.
        // Game-owned pool; cleared here so a restart never inherits one.
        this.hazards = [];
        // ELITE bombers that self-detonated this frame — merged into the kill
        // pipeline by _resolveCombat so a dodged elite still pays its rolled
        // loot (affix death, chest/coin roll, gem, kill credit). A plain
        // bomber's self-boom stays deliberately reward-free.
        this._selfDetonated = [];
        // KINDLED: corpses killed by a Game-owned hazard that damages ENEMIES
        // (Gruk's thornRing) — drained into the _resolveCombat merge so they pay
        // loot + charge Kindle like any other kill.
        this._hazardKilled = [];
        // Expanding shockwave ring VFX (pure cosmetic; pooled). Spawned on
        // kills, boss deaths, and level-ups; updated + drawn in the world layer.
        this.rings = [];
        // Hit-stop: when > 0 the world sim freezes for these many seconds while
        // rendering continues — sells the weight of a heavy impact. Drained with
        // real dt at the top of the gameplay update.
        this.hitStop = 0;
        // Brief red screen-edge vignette pulse on taking damage (0..1, decays).
        this.hitVignette = 0;
        // Queue of boss summon requests (drained each frame into themed spawns).
        this.bossSummons = [];
        // Active "BOSS INCOMING" warning (the boss spawns when this expires).
        this.bossWarning = null;
        // Lieutenant mini-boss (mid-segment): a lightweight scheduler that fires
        // once per boss-to-boss stretch, a short telegraph, and a ref for its mini
        // HP bar. NOT a boss (never sets e.boss) — see _spawnLieutenant.
        this.lieutenantDirector = new LieutenantDirector();
        this.lieutenantWarning = null;
        this.activeLieutenantRef = null;
        // Daily Road per-run bookkeeping (score banked once at game-over/victory).
        this._dailyRoadRecorded = false;
        this.dailyRoadBest = false;
        // KINDLED PR5 — Rite-Trial banking latch + per-run KINDLED counters, read at
        // the single run-end summary pass to bank the trial score, feed lifetime
        // stats, and accrue this hero's rite progress. Reset each run/restart.
        this._riteTrialRecorded = false;
        this._riteAccrued = false;
        this.riteTrialBestNew = false;
        this.ultsReleased = 0;       // Grand Signatures released this run (score input)
        this.blinks = 0;             // successful aimed blinks this run (stat)
        this._runBestUltHits = 0;    // most foes hit by one ult this run (rite metric)
        this._runBestUltKills = 0;   // most kills by one ult this run (rite metric)
        this._runBrinkCasts = 0;     // Pyre-of-the-Brink casts below 20% HP (rite metric)
        this.gems = [];
        this.damageNumbers = [];

        // Patrons committed THIS run (drives the level-up draft weighting).
        // Reset here so a restart never inherits a stale commitment; populated
        // from selectedPatron in _startRun.
        this.committedPatrons = [];

        this.spawner = new Spawner();
        // The run begins with the weapon chosen in the loadout (defaults to the
        // Cinderbolt). Other weapons still appear as level-up choices.
        this.weaponSystem = new WeaponSystem(resolveStartingWeapon(this.saveSystem.data));
        // KINDLED (update #3): the run's hero id keys the Grand Signature ult
        // (signatures.js). A Rite-Trial run overrides it session-locally, never
        // touching the saved pick (_effectiveCharacterId).
        this._heroId = this._effectiveCharacterId();
        // The Kindle ult meter + aimed-blink cooldown, built here (same lifecycle as
        // weaponSystem) so every run/restart resets the meter + cooldown. Its per-hero
        // Attunement modifiers (Kindle gain / blink CD / ult cost) are resolved from
        // the hero's heroAttunement level; the ult/focused DAMAGE multipliers are
        // stamped on the player in _startRun (applyHeroAttunement).
        this.kindleSystem = new KindleSystem(attuneEffects(this.saveSystem.getHeroAttunement(this._heroId)));
        // Focus targeting (PR3): the locked enemy ref (or null) + an out-of-range
        // grace timer, both run-scoped so a restart clears the lock.
        this.focusTarget = null;
        this._focusOutOfRangeT = 0;
        // The ult's {hits,killed} this frame (fed into _resolveCombat like
        // _selfDetonated) + Sylphine's 2×-coin window timer.
        this._ultResult = null;
        this._coinWindfallTimer = 0;
        this.collisionSystem = new CollisionSystem();
        this.upgradeSystem = new UpgradeSystem();
        this.passiveSystem = new PassiveSystem();
        this.waveDirector = new WaveDirector();
        // Per-map boss trio: cycle THIS map's three bosses (all must fall to
        // clear the map). Later maps carry their own tougher rosters.
        this.bossDirector = new BossDirector(getMapBosses(this._effectiveMapId()));
        // Difficulty rung of the selected map (1..4); folds into boss + enemy
        // scaling so each map plays a little harder than the last.
        this.mapTier = getMapTier(this._effectiveMapId());
        // Cache the current wave state so render can read it without
        // re-computing during the same frame.
        this.waveState = this.waveDirector.getState(0);

        // Chest pickup pauses gameplay just like a level-up. pendingChests
        // queues additional chests collected while the overlay is up.
        this.chests = [];
        this.chestReward = null;
        this.pendingChests = 0;
        this.chestsOpened = 0;
        // Wick Roads: shrines are walk-onto altars (the chest's sibling on a boss
        // kill); `altar` is the active pick-one overlay ({ choices, age }, null when
        // closed); pendingAltars queues shrines walked onto while an overlay is up;
        // _runRelics tracks relic ids claimed this run so a shrine never re-offers one.
        this.shrines = [];
        this.altar = null;
        this.pendingAltars = 0;
        this._runRelics = [];
        this._runPacts = [];
        // Branching Roads: the post-boss CROSSROADS (a fork reusing the altar
        // overlay) sets a DISPOSABLE per-segment bias — enemy-mix (segmentWeights)
        // + difficulty multipliers (segmentScale) folded into waveState each frame
        // by _applyRunScale, then cleared at the next boss (_clearSegmentRoad).
        // Run-only, never persisted. The boon a road grants at pick time is a modest
        // permanent player nudge — damage/speed ride the _applyPlayerCaps ceilings;
        // coins/regen are economy-only and naturally modest (never a power runaway).
        this.segmentScale = { hp: 1, speed: 1, damage: 1, elite: 1, cap: 1, interval: 1 };
        this.segmentWeights = null;
        this._segmentRoadId = null;
        // A boss kill flags this; the end-of-update presenter opens the CROSSROADS
        // once no other overlay is up, so a same-frame level-up never stacks with it.
        this.pendingCrossroads = false;
        // Weapon-aura cache (recomputed only when weaponSystem.version changes).
        this._auraVersion = -1;
        this._auraSnapshot = null;
        this.coins = [];
        this.healthOrbs = [];
        // Cached reference to the strongest active boss for the boss HP bar.
        this.activeBossRef = null;
        // Boss arena confinement ({ x, y, r } while a boss fight is sealed; null otherwise).
        this.arena = null;
        this.bossesDefeated = 0;
        // BOSSFORGE — Boss Rush live controller (null in every other mode; set by
        // _startRun right after this build when bossRushMode is on) + the run-end
        // banking latch so a death AND a victory-leave never double-record.
        this.bossRush = null;
        this._bossRushRecorded = false;
        this.bossRushBestNew = false;
        this.weeklyEmberBestNew = false;
        // Victory overlay shown once when the 3rd boss falls (Continue / new
        // biome / main menu). _victoryShown latches so later bosses don't reopen
        // it; _runRecorded guards against double-counting lifetime stats when a
        // victory-leave records the run and game-over would otherwise too.
        this.victory = null;
        this._victoryShown = false;
        this._runRecorded = false;
        this.runSummary = null;
        // EMBERGLASS: clear the last run's killer attribution + minted share card
        // so a fresh run never reuses a stale card/toast.
        this.lastHitBy = null;
        this.mintedCard = null;
        this.shareToast = null;
        this._pendingCardMint = null;
        this.photoMode = null;
        this._suppressToolbar = false;
        this._dragPhotoPrev = null;
        if (this.camera) this.camera.zoom = 1;
        // Gauntlet (endless) scoring — armed only after a 3rd-boss victory
        // continuation; banked on the next death.
        this._gauntletActive = false;
        this.gauntletScore = 0;
        this.gauntletBest = false;

        this.time = 0;
        this.kills = 0;
        // Kill-streak / combo state (feedback only — see COMBO config).
        this.combo = 0;
        this.comboTimer = 0;
        this.comboBest = 0;
        this._comboMilestoneIdx = 0;
        // Twilight (elite-army endgame) one-shot announce latch.
        this._twilightAnnounced = false;
        // Hypergrowth ("the wall", compounding from min 20) one-shot announce latch.
        this._hyperAnnounced = false;
        // Run objectives: ids completed this run + the list (for the game-over
        // summary). Repeatable each run.
        this._objDone = new Set();
        this._objCompleted = [];
        this.upgradeChoices = null;
        this.pendingLevelUps = 0;
        this.gameOver = false;
        if (this.player) this.player.poseOverride = null;   // clear run-end pose
        // bankedThisRun guards against double-banking run coins if game-over
        // somehow fires more than once for the same run.
        this.bankedThisRun = false;

        // Overlay entrance-animation clocks (advanced while the overlay is
        // open so the UI can ease elements in instead of popping).
        this.levelUpAge = 0;
        this.gameOverAge = 0;

        // Transient full-screen feedback events (hit/heal/levelup flashes).
        this.feedback = [];
        // Tracks HP between frames so a rise can fire a heal flash centrally.
        this._lastHp = this.player.maxHp;
        // Battle-pass XP gained by the last finished run (set in _enterGameOver,
        // drawn on the game-over summary). Cleared so a restart can't show stale XP.
        this.bpResult = null;
        this._battlePassAwarded = false;
        // Starting coins granted by the shop this run — _bankRunCoins banks
        // them only for a PLAYED run (see the guard there), so an instant
        // pause→RESTART abandon can't mint the seed for free.
        this.startingCoinsGranted = 0;

        // A fresh run should never inherit a half-armed save-reset confirm.
        this.resetConfirming = false;
        this.paused = false;
        // Level-up agency resources (granted from the shop in _startRun).
        this.rerolls = 0;
        this.banishes = 0;
        this.alters = 0;
        // Records beaten this run (set at game-over for the NEW BEST banner).
        this.newBest = null;

        // Drop any particles left over from the previous run.
        if (this.particles) this.particles.reset();

        if (this.input.touch) this.input.touch.setEnabled(true);
    },
};
