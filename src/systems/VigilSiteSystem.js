// VigilSiteSystem — deterministic, once-per-run house discoveries.
//
// Integration contract (no Game imports, no DOM dependency):
//   const sites = new VigilSiteSystem();
//   sites.initialize(game.obstacleSystem, biome.id, { seed: runSeed });
//   sites.update(dt, game);
//   for (const event of sites.drainEvents()) { ...apply event... }
//
// Event kinds:
//   reward  { reward:{ type:'heal'|'xp'|'coins'|'bundle', target(s), ... } }
//   spawn   { encounter:'vigil-guardians', tag, spawns:[{type,x,y,...}] }
//   status  { status:'failed'|'deferred', reason }
// Reward targets are literal integration guidance: XP must go through
// player.gainXP(amount), with its returned levels added to pendingLevelUps;
// coins are run coins (player.coins), not an immediate SaveSystem deposit.
//
// After applying a spawn event, call
//   acknowledgeGuardianSpawn(event.siteId, spawnedEnemyObjects)
// The method tags and tracks at most three objects. Alternatively, integration
// may set enemy.vigilSiteId = event.tag; update() discovers those tags itself.
// Only a seen-and-then-cleared pack pays the completion reward.
//
// Rendering is optional and uses only world-space Canvas primitives:
//   sites.draw(ctx, camera, viewW, viewH, lighting)
//   sites.drawAbove(ctx, camera, viewW, viewH)
// forVisible()/getRenderSnapshots() are available for a custom painter queue.

import { TWO_PI, clamp } from '../core/MathUtils.js';
import {
    DEFAULT_VIGIL_SITE_BIOME,
    VIGIL_SITE_ARCHETYPES,
    VIGIL_SITE_LIMITS,
    VIGIL_SITE_ORDER,
    getVigilSiteArchetype,
    getVigilSiteBiome,
} from '../content/vigilSites.js';

const ACTIVE_CHALLENGE_STATES = new Set(['awaiting-guardians', 'challenge']);
const MODAL_KEYS = ['paused', 'gameOver', 'victory', 'upgradeChoices', 'chestReward', 'altar', 'photoMode'];

function finite(v, fallback = 0) {
    return Number.isFinite(v) ? v : fallback;
}

// FNV-1a plus a final avalanche. Exported so a headless validator can lock the
// determinism contract without depending on implementation-private RNG state.
export function vigilSiteHash(...parts) {
    let h = 0x811c9dc5;
    const text = parts.join('|');
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    return h >>> 0;
}

// One seed contract for every Living Vigil launch path. Standard runs rotate
// after a recorded run; Daily Road ignores both account history and the
// player's selected hero so every player receives the same board for that UTC
// day/map; Rite Trial ignores account history but keeps its authored hero in
// the signature. The explicit mode salt prevents otherwise-equal token sets
// from sharing a board across modes.
export function livingVigilRunSeed({
    day = 0,
    runSerial = 0,
    mapSerial = 1,
    heroSerial = 1,
    dailyMode = false,
    riteTrialMode = false,
} = {}) {
    const dayToken = (Math.max(0, Math.floor(finite(day))) + 1) >>> 0;
    const runToken = (Math.max(0, Math.floor(finite(runSerial))) + 1) >>> 0;
    const mapToken = Math.max(1, Math.floor(finite(mapSerial, 1))) >>> 0;
    const heroToken = Math.max(1, Math.floor(finite(heroSerial, 1))) >>> 0;
    if (dailyMode) return vigilSiteHash('living-vigil-run', 'daily', dayToken, mapToken);
    if (riteTrialMode) return vigilSiteHash('living-vigil-run', 'rite', dayToken, mapToken, heroToken);
    return vigilSiteHash('living-vigil-run', 'standard', dayToken, runToken, mapToken, heroToken);
}

function normalizeStructures(source) {
    const structures = Array.isArray(source) ? source : source?.structures;
    if (!Array.isArray(structures)) return [];
    const out = [];
    const ids = new Set();
    for (let i = 0; i < structures.length; i++) {
        const raw = structures[i];
        if (!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) continue;
        const interiorW = finite(raw.interiorW);
        const interiorH = finite(raw.interiorH);
        if (interiorW < VIGIL_SITE_LIMITS.minInteriorW || interiorH < VIGIL_SITE_LIMITS.minInteriorH) continue;
        const id = String(raw.id || `structure-${i}`);
        if (ids.has(id)) continue;
        ids.add(id);
        out.push({
            raw,
            id,
            x: raw.x,
            y: raw.y,
            interiorW,
            interiorH,
            wall: Math.max(0, finite(raw.wall, 28)),
            visualSeed: finite(raw.visualSeed, i + 1) >>> 0,
            palette: raw.palette || null,
        });
    }
    return out;
}

function intersectsExclusion(structure, zones) {
    if (!Array.isArray(zones) || zones.length === 0) return false;
    const halfDiagonal = Math.hypot(structure.interiorW, structure.interiorH) * 0.5 + structure.wall;
    for (const zone of zones) {
        if (!zone || !Number.isFinite(zone.x) || !Number.isFinite(zone.y)) continue;
        const r = Math.max(0, finite(zone.r ?? zone.radius));
        const dx = structure.x - zone.x;
        const dy = structure.y - zone.y;
        const reach = r + halfDiagonal;
        if (dx * dx + dy * dy <= reach * reach) return true;
    }
    return false;
}

function worldFrozen(game) {
    if (!game) return false;
    if (game.screen && game.screen !== 'gameplay') return true;
    for (const key of MODAL_KEYS) if (game[key]) return true;
    return false;
}

// Direct boss/arena fields are O(1). The enemy scan is a compatibility fallback
// for small game-like fixtures or integrations that do not expose activeBossRef.
export function vigilSiteSetpieceBusy(game) {
    if (!game) return false;
    // Boss Rush/Weekly Ember are continuous set pieces, including their short
    // prep windows; exploration rewards stay a standard/Daily/Rite-run verb.
    if (game.bossRush || game.arena || game.bossWarning || game.activeBossRef || game.lieutenantWarning) return true;
    if (game.vigilEncounterBusy) return true;
    const encounterPhase = game.encounterDirector?.getSnapshot?.().phase;
    if (encounterPhase && encounterPhase !== 'idle') return true;
    const enemies = Array.isArray(game.enemies) ? game.enemies : null;
    if (!enemies) return false;
    for (const enemy of enemies) {
        if (enemy && enemy.active !== false && (enemy.boss || enemy.lieutenant)) return true;
    }
    return false;
}

function actualBossArenaActive(game) {
    if (!game) return false;
    if (game.arena || game.activeBossRef) return true;
    const enemies = Array.isArray(game.enemies) ? game.enemies : null;
    if (!enemies) return false;
    for (const enemy of enemies) if (enemy && enemy.active !== false && enemy.boss) return true;
    return false;
}

function sitePoint(structure, seed) {
    // Keep the central north/south walk-through lane clear. Existing procedural
    // interiors place their table/stool on the RIGHT, so the new focal prop
    // consistently uses the open left bay instead of painting over furniture.
    const maxX = Math.max(0, structure.interiorW * 0.5 - 58);
    const xOffset = -Math.min(70, maxX);
    const yRange = Math.max(0, structure.interiorH * 0.5 - 66);
    const yOffset = ((((seed >>> 7) % 5) - 2) / 2) * Math.min(22, yRange);
    return { x: structure.x + xOffset, y: structure.y + yOffset };
}

function buildGuardianSpawns(site, structure, biomeId, seed) {
    const def = VIGIL_SITE_ARCHETYPES.beacon;
    const challenge = def.challenge;
    const biome = getVigilSiteBiome(biomeId);
    const pool = biome.guardianTypes;
    const count = Math.min(VIGIL_SITE_LIMITS.maxGuardians, challenge.count);
    const out = [];
    const firstSide = ((seed >>> 2) & 1) ? 1 : -1;
    const outsideY = structure.interiorH * 0.5 + structure.wall + 98;
    const lateral = Math.min(48, Math.max(30, (structure.raw.door || 136) * 0.30));
    for (let i = 0; i < count; i++) {
        const side = i === 1 ? -firstSide : firstSide;
        const xOffset = i === 0 ? 0 : (i === 1 ? -lateral : lateral);
        const type = pool[(seed + i * 7) % pool.length];
        out.push({
            type,
            x: structure.x + xOffset,
            y: structure.y + side * outsideY,
            elite: false,
            vigilSiteId: site.id,
            // Every authored guardian is <=70px radius. Keep a small safety
            // margin so integration can reject a candidate before constructing
            // a body that would overlap a wall or nearby prop.
            clearance: 74,
        });
    }
    return out;
}

function rewardAmount(def, player, seed) {
    const r = def.reward;
    if (r.type === 'heal') {
        const maxHp = Math.max(1, finite(player?.maxHp, 100));
        return Math.round(clamp(maxHp * r.fraction, r.min, r.max));
    }
    if (r.type === 'xp') {
        const level = Math.max(1, Math.floor(finite(player?.level, 1)));
        return Math.round(Math.min(r.max, r.base + (level - 1) * r.perLevel));
    }
    const span = Math.max(0, r.max - r.min);
    return r.min + (span ? seed % (span + 1) : 0);
}

function availableReason(site, game, setpieceBusy) {
    if (site.state !== 'dormant') return 'spent';
    if (setpieceBusy) return 'setpiece';
    if (site.archetype === 'beacon' && Array.isArray(game?.enemies)
        && Number.isFinite(game?.waveState?.maxAlive)) {
        const live = game.enemies.reduce((count, enemy) => count + (enemy?.active ? 1 : 0), 0);
        const cap = Math.max(0, Math.floor(game.waveState.maxAlive));
        const required = clamp(
            Math.floor(finite(site.def?.challenge?.count, VIGIL_SITE_LIMITS.maxGuardians)),
            1,
            VIGIL_SITE_LIMITS.maxGuardians,
        );
        if (cap - live < required) return 'enemy-capacity';
    }
    if (site.archetype === 'hearth') {
        const player = game?.player;
        if (!player || !Number.isFinite(player.hp) || !Number.isFinite(player.maxHp)) return 'no-player';
        if (player.hp >= player.maxHp - 0.5) return 'health-full';
    }
    return null;
}

export class VigilSiteSystem {
    constructor(options = {}) {
        this.options = { autoActivate: options.autoActivate !== false };
        this.sites = [];
        this.biomeId = DEFAULT_VIGIL_SITE_BIOME;
        this.seed = 0;
        this.time = 0;
        this.focus = null;
        this._events = [];
        this._reducedEffects = false;
        this.droppedEvents = 0;
    }

    initialize(source, biomeId = DEFAULT_VIGIL_SITE_BIOME, options = {}) {
        this.reset();
        this.biomeId = typeof biomeId === 'string' ? biomeId : DEFAULT_VIGIL_SITE_BIOME;
        this.seed = finite(options.seed, 0) >>> 0;
        const candidates = normalizeStructures(source)
            .filter((structure) => !intersectsExclusion(structure, options.exclusionZones));
        candidates.sort((a, b) => {
            const ah = vigilSiteHash(this.biomeId, this.seed, a.id, a.visualSeed, a.x, a.y);
            const bh = vigilSiteHash(this.biomeId, this.seed, b.id, b.visualSeed, b.x, b.y);
            return ah - bh || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        });

        const count = Math.min(VIGIL_SITE_LIMITS.maxSites, candidates.length, VIGIL_SITE_ORDER.length);
        const orderOffset = count > 0
            ? vigilSiteHash('archetype-order', this.biomeId, this.seed) % VIGIL_SITE_ORDER.length
            : 0;
        for (let i = 0; i < count; i++) {
            const structure = candidates[i];
            const archetype = VIGIL_SITE_ORDER[(i + orderOffset) % VIGIL_SITE_ORDER.length];
            const def = getVigilSiteArchetype(archetype);
            const localSeed = vigilSiteHash('site', this.biomeId, this.seed, structure.id, archetype);
            const point = sitePoint(structure, localSeed);
            const site = {
                id: `vigil-site:${structure.id}:${archetype}`,
                structureId: structure.id,
                structure: structure.raw,
                archetype,
                def,
                biomeTint: getVigilSiteBiome(this.biomeId).tint,
                x: point.x,
                y: point.y,
                baseY: point.y + 18,
                seed: localSeed,
                state: 'dormant',
                dwell: 0,
                near: false,
                reason: null,
                spawnWait: 0,
                guardianExpected: 0,
                guardianAlive: 0,
                challengeSeen: false,
                challengeInterrupted: false,
                guardianRefs: null,
            };
            if (archetype === 'beacon') {
                site.guardianSpawns = buildGuardianSpawns(site, structure, this.biomeId, localSeed);
            }
            this.sites.push(site);
        }
        return this.getRenderSnapshots();
    }

    reset() {
        this.sites.length = 0;
        this._events.length = 0;
        this.time = 0;
        this.focus = null;
        this.droppedEvents = 0;
    }

    update(dt, game = {}) {
        const step = clamp(finite(dt), 0, 0.25);
        this.time += step;
        this._reducedEffects = !!(game.reducedEffects || game.saveSystem?.getSetting?.('reducedEffects'));
        const setpieceBusy = vigilSiteSetpieceBusy(game);
        const frozen = worldFrozen(game);

        // Modal/pause time is not encounter time: an awaiting spawn cannot time
        // out and a challenge cannot resolve behind an overlay.
        if (!frozen) {
            for (const site of this.sites) {
                if (ACTIVE_CHALLENGE_STATES.has(site.state)) {
                    this._updateGuardianChallenge(site, step, game);
                }
            }
        }

        this.focus = null;
        const player = game.player;
        if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.y) || frozen) {
            for (const site of this.sites) { site.near = false; site.dwell = 0; }
            return this.peekEvents();
        }

        let nearest = null;
        let nearestD2 = Infinity;
        for (const site of this.sites) {
            site.near = false;
            if (site.state !== 'dormant') continue;
            const dx = player.x - site.x;
            const dy = player.y - site.y;
            const d2 = dx * dx + dy * dy;
            const focusR = site.def.activationRadius + 150;
            if (d2 <= focusR * focusR && d2 < nearestD2) {
                nearest = site;
                nearestD2 = d2;
            }
        }

        if (!nearest) {
            for (const site of this.sites) if (site.state === 'dormant') site.dwell = 0;
            return this.peekEvents();
        }

        nearest.near = true;
        nearest.reason = availableReason(nearest, game, setpieceBusy);
        const playerRadius = Math.max(0, finite(player.radius));
        const interactR = nearest.def.activationRadius + Math.min(24, playerRadius * 0.35);
        const inside = nearestD2 <= interactR * interactR;
        const progress = nearest.def.dwellSeconds > 0
            ? clamp(nearest.dwell / nearest.def.dwellSeconds, 0, 1) : 0;
        this.focus = this._focusSnapshot(nearest, progress, inside);

        for (const site of this.sites) {
            if (site !== nearest && site.state === 'dormant') site.dwell = 0;
        }
        if (!inside || nearest.reason) {
            nearest.dwell = 0;
            this.focus.progress = 0;
            return this.peekEvents();
        }

        const explicit = game.vigilInteract === true || game.interactPressed === true;
        const auto = game.vigilSiteAutoActivate !== false && this.options.autoActivate;
        if (explicit) nearest.dwell = nearest.def.dwellSeconds;
        else if (auto) nearest.dwell += step;
        else nearest.dwell = 0;
        this.focus.progress = clamp(nearest.dwell / nearest.def.dwellSeconds, 0, 1);
        if ((explicit || auto) && nearest.dwell >= nearest.def.dwellSeconds) this._activate(nearest, game);
        return this.peekEvents();
    }

    _activate(site, game) {
        if (site.state !== 'dormant') return false;
        if (site.archetype === 'beacon') {
            if (vigilSiteSetpieceBusy(game)) return false;
            const event = {
                id: `${site.id}:guardians`,
                kind: 'spawn',
                encounter: 'vigil-guardians',
                siteId: site.id,
                archetype: site.archetype,
                tag: site.id,
                x: site.x,
                y: site.y,
                maxAlive: VIGIL_SITE_LIMITS.maxGuardians,
                avoidBossArena: true,
                spawns: site.guardianSpawns.map((spawn) => ({ ...spawn })),
            };
            if (!this._emit(event)) return false;
            site.state = 'awaiting-guardians';
            site.spawnWait = VIGIL_SITE_LIMITS.spawnAcknowledgeSeconds;
            site.dwell = 0;
            return true;
        }

        const amount = rewardAmount(site.def, game.player, site.seed);
        const rewardType = site.def.reward.type;
        const target = rewardType === 'heal' ? 'player.hp'
            : rewardType === 'xp' ? 'player.gainXP' : 'player.coins';
        const event = {
            id: `${site.id}:reward`,
            kind: 'reward',
            siteId: site.id,
            archetype: site.archetype,
            label: site.def.name,
            color: site.def.accent,
            x: site.x,
            y: site.y,
            reward: { type: rewardType, target, amount },
        };
        if (!this._emit(event)) return false;
        site.state = 'spent';
        site.dwell = 0;
        return true;
    }

    acknowledgeGuardianSpawn(siteId, spawned) {
        const site = this.sites.find((entry) => entry.id === siteId);
        if (!site || site.state !== 'awaiting-guardians') return false;
        const refs = Array.isArray(spawned)
            ? spawned.filter((enemy) => enemy && typeof enemy === 'object').slice(0, VIGIL_SITE_LIMITS.maxGuardians)
            : null;
        const count = refs ? refs.length : clamp(Math.floor(finite(spawned)), 0, VIGIL_SITE_LIMITS.maxGuardians);
        const required = Math.min(VIGIL_SITE_LIMITS.maxGuardians, site.guardianSpawns?.length || 0);
        if (count < required || required <= 0) {
            // Integration may lose capacity between prompt and spawn. Never
            // consume the one-per-run Beacon or accept a discounted partial
            // pack; retire any partial refs and return the site to dormant.
            if (refs) for (const enemy of refs) enemy.active = false;
            this._deferChallenge(site, 'spawn-deferred');
            return false;
        }
        if (refs) {
            for (const enemy of refs) enemy.vigilSiteId = site.id;
            site.guardianRefs = refs;
            site.challengeSeen = true;
            site.guardianAlive = refs.reduce((n, enemy) => n + (enemy.active !== false ? 1 : 0), 0);
        }
        site.guardianExpected = count;
        site.state = 'challenge';
        return true;
    }

    _deferChallenge(site, reason) {
        this._emit({
            id: `${site.id}:deferred`,
            kind: 'status',
            siteId: site.id,
            archetype: site.archetype,
            status: 'deferred',
            reason,
            x: site.x,
            y: site.y,
        });
        site.state = 'dormant';
        site.guardianRefs = null;
        site.guardianExpected = 0;
        site.guardianAlive = 0;
        site.challengeSeen = false;
        site.challengeInterrupted = false;
        site.spawnWait = 0;
        site.dwell = 0;
    }

    _updateGuardianChallenge(site, dt, game) {
        if (actualBossArenaActive(game)) site.challengeInterrupted = true;
        let alive = 0;
        let seen = false;
        if (site.guardianRefs) {
            seen = site.guardianRefs.length > 0;
            for (const enemy of site.guardianRefs) if (enemy && enemy.active !== false) alive++;
        } else {
            const enemies = Array.isArray(game.enemies) ? game.enemies : [];
            for (const enemy of enemies) {
                if (!enemy || enemy.vigilSiteId !== site.id) continue;
                seen = true;
                if (enemy.active !== false) alive++;
            }
        }
        if (seen) {
            site.challengeSeen = true;
            site.guardianAlive = alive;
            if (site.state === 'awaiting-guardians') {
                site.state = 'challenge';
                site.guardianExpected = Math.max(site.guardianExpected, alive);
            }
        }

        if (!site.challengeSeen) {
            site.spawnWait -= dt;
            if (site.spawnWait <= 0) this._failChallenge(site, 'spawn-timeout');
            return;
        }
        if (alive > 0) return;
        if (site.challengeInterrupted) {
            this._failChallenge(site, 'boss-conflict');
            return;
        }

        const challenge = site.def.challenge;
        const paid = this._emit({
            id: `${site.id}:clear`,
            kind: 'reward',
            siteId: site.id,
            archetype: site.archetype,
            label: `${site.def.name} Cleared`,
            color: site.def.accent,
            x: site.x,
            y: site.y,
            reward: {
                type: 'bundle',
                coins: challenge.completionCoins,
                xp: challenge.completionXp,
                targets: { coins: 'player.coins', xp: 'player.gainXP' },
            },
        });
        if (paid) {
            site.state = 'spent';
            site.guardianRefs = null;
            site.guardianAlive = 0;
        }
    }

    _failChallenge(site, reason) {
        this._emit({
            id: `${site.id}:failed`,
            kind: 'status',
            siteId: site.id,
            archetype: site.archetype,
            status: 'failed',
            reason,
            x: site.x,
            y: site.y,
        });
        site.state = 'spent';
        site.guardianRefs = null;
        site.guardianAlive = 0;
        site.dwell = 0;
    }

    _emit(event) {
        if (this._events.length >= VIGIL_SITE_LIMITS.maxQueuedEvents) {
            this.droppedEvents++;
            return false;
        }
        this._events.push(event);
        return true;
    }

    peekEvents() {
        return this._events;
    }

    drainEvents(out = []) {
        for (const event of this._events) out.push(event);
        this._events.length = 0;
        return out;
    }

    hasActiveChallenge() {
        for (const site of this.sites) if (ACTIVE_CHALLENGE_STATES.has(site.state)) return true;
        return false;
    }

    _focusSnapshot(site, progress, inside) {
        let prompt = site.def.verb;
        if (site.reason === 'health-full') prompt = 'HEALTH FULL';
        else if (site.reason === 'setpiece') prompt = 'SEALED DURING APEX';
        else if (site.reason === 'enemy-capacity') prompt = 'HORDE TOO DENSE — CLEAR SPACE';
        return {
            siteId: site.id,
            archetype: site.archetype,
            name: site.def.name,
            prompt,
            symbol: site.def.symbol,
            color: site.def.accent,
            x: site.x,
            y: site.y,
            inside,
            progress,
            blocked: !!site.reason,
            reason: site.reason,
        };
    }

    getFocusSnapshot() {
        return this.focus ? { ...this.focus } : null;
    }

    getRenderSnapshots(out = []) {
        for (const site of this.sites) {
            out.push({
                id: site.id,
                structureId: site.structureId,
                archetype: site.archetype,
                name: site.def.name,
                symbol: site.def.symbol,
                color: site.def.accent,
                biomeColor: site.biomeTint,
                x: site.x,
                y: site.y,
                baseY: site.baseY,
                state: site.state,
                progress: clamp(site.dwell / Math.max(0.01, site.def.dwellSeconds), 0, 1),
                guardianExpected: site.guardianExpected,
                guardianAlive: site.guardianAlive,
            });
        }
        return out;
    }

    forVisible(camera, viewW, viewH, fn) {
        if (typeof fn !== 'function') return;
        if (!camera || !Number.isFinite(viewW) || !Number.isFinite(viewH)) {
            for (const site of this.sites) fn(site);
            return;
        }
        const margin = VIGIL_SITE_LIMITS.cullMargin;
        const left = camera.x - viewW * 0.5 - margin;
        const right = camera.x + viewW * 0.5 + margin;
        const top = camera.y - viewH * 0.5 - margin;
        const bottom = camera.y + viewH * 0.5 + margin;
        for (const site of this.sites) {
            if (site.x < left || site.x > right || site.y < top || site.y > bottom) continue;
            fn(site);
        }
    }

    // Full low-profile site prop. Root may call this directly in the world pass
    // or use forVisible() + baseY to place the same draw in its standing queue.
    draw(ctx, camera = null, viewW = Infinity, viewH = Infinity, lighting = null) {
        if (!ctx) return;
        this.forVisible(camera, viewW, viewH, (site) => {
            this._drawSite(ctx, site);
            if (lighting && site.state !== 'spent' && typeof lighting.addLight === 'function') {
                lighting.addLight(site.x, site.y - 18, 104, site.def.accent, 0.48, 2);
            }
        });
    }

    _drawSite(ctx, site) {
        const spent = site.state === 'spent';
        const pulse = this._reducedEffects ? 0.72 : 0.62 + 0.18 * Math.sin(this.time * 3.2 + (site.seed & 31));
        const alpha = spent ? 0.38 : 1;
        ctx.save();
        ctx.translate(site.x, site.y);
        ctx.globalAlpha = alpha;

        // Shared floor language: footprint shadow, keyed ring, then a short
        // stone plinth. No generated assets and no per-frame offscreen canvas.
        ctx.fillStyle = 'rgba(3, 4, 8, 0.48)';
        ctx.beginPath(); ctx.ellipse(0, 18, 39, 15, 0, 0, TWO_PI); ctx.fill();
        ctx.strokeStyle = site.biomeTint;
        ctx.globalAlpha = alpha * (spent ? 0.14 : 0.24);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, 12, 38, 21, 0, 0, TWO_PI); ctx.stroke();
        ctx.strokeStyle = site.def.accent;
        ctx.globalAlpha = alpha * (spent ? 0.28 : pulse);
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(0, 12, 32, 17, 0, 0, TWO_PI); ctx.stroke();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#29252d';
        ctx.beginPath();
        ctx.moveTo(-27, 17); ctx.lineTo(27, 17); ctx.lineTo(20, 3); ctx.lineTo(-20, 3);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#4d4653'; ctx.lineWidth = 2; ctx.stroke();

        if (site.archetype === 'hearth') this._drawHearth(ctx, site, pulse, spent);
        else if (site.archetype === 'archive') this._drawArchive(ctx, site, pulse, spent);
        else if (site.archetype === 'cache') this._drawCache(ctx, site, pulse, spent);
        else this._drawBeacon(ctx, site, pulse, spent);
        ctx.restore();
    }

    _drawHearth(ctx, site, pulse, spent) {
        ctx.fillStyle = '#3d3431';
        ctx.beginPath(); ctx.ellipse(0, 2, 20, 10, 0, 0, TWO_PI); ctx.fill();
        ctx.strokeStyle = site.def.accent; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, -6, 10, 0.2, Math.PI - 0.2, true); ctx.stroke();
        if (spent) return;
        ctx.globalAlpha *= pulse;
        ctx.fillStyle = site.def.accent;
        ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(12, -13); ctx.lineTo(0, -5); ctx.lineTo(-11, -14); ctx.closePath(); ctx.fill();
        ctx.fillStyle = site.def.core;
        ctx.beginPath(); ctx.moveTo(0, -27); ctx.lineTo(5, -14); ctx.lineTo(0, -10); ctx.lineTo(-5, -15); ctx.closePath(); ctx.fill();
    }

    _drawArchive(ctx, site, pulse, spent) {
        ctx.fillStyle = '#34323d'; ctx.fillRect(-20, -37, 40, 39);
        ctx.strokeStyle = spent ? '#5d5964' : site.def.accent; ctx.lineWidth = 2; ctx.strokeRect(-20, -37, 40, 39);
        ctx.globalAlpha *= spent ? 0.5 : pulse;
        ctx.strokeStyle = site.def.core;
        ctx.beginPath();
        ctx.moveTo(-11, -27); ctx.lineTo(11, -27);
        ctx.moveTo(-11, -18); ctx.lineTo(6, -18);
        ctx.moveTo(-11, -9); ctx.lineTo(12, -9);
        ctx.stroke();
    }

    _drawCache(ctx, site, pulse, spent) {
        ctx.fillStyle = '#493624'; ctx.fillRect(-24, -22, 48, 24);
        ctx.fillStyle = '#62472b';
        ctx.beginPath(); ctx.ellipse(0, -22, 24, 12, 0, Math.PI, TWO_PI); ctx.fill();
        ctx.strokeStyle = spent ? '#665d4e' : site.def.accent; ctx.lineWidth = 3; ctx.strokeRect(-24, -22, 48, 24);
        ctx.globalAlpha *= spent ? 0.5 : pulse;
        ctx.fillStyle = site.def.core; ctx.fillRect(-4, -17, 8, 13);
    }

    _drawBeacon(ctx, site, pulse, spent) {
        ctx.fillStyle = '#302c38';
        ctx.beginPath(); ctx.moveTo(-16, 3); ctx.lineTo(-11, -42); ctx.lineTo(0, -56); ctx.lineTo(11, -42); ctx.lineTo(16, 3); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = spent ? '#5b5661' : site.def.accent; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.globalAlpha *= spent ? 0.45 : pulse;
        ctx.fillStyle = site.def.core;
        ctx.beginPath(); ctx.moveTo(0, -43); ctx.lineTo(7, -31); ctx.lineTo(0, -21); ctx.lineTo(-7, -31); ctx.closePath(); ctx.fill();
        if (site.state === 'challenge' || site.state === 'awaiting-guardians') {
            ctx.strokeStyle = site.def.accent; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(0, -25, 29, -Math.PI / 2, -Math.PI / 2 + TWO_PI * pulse); ctx.stroke();
        }
    }

    // Prompt/progress layer. Text and symbols ensure the site never communicates
    // solely by color; reduced-effects mode leaves the label completely static.
    drawAbove(ctx, camera = null, viewW = Infinity, viewH = Infinity) {
        if (!ctx) return;
        this.forVisible(camera, viewW, viewH, (site) => {
            const focused = this.focus?.siteId === site.id;
            const challenged = ACTIVE_CHALLENGE_STATES.has(site.state);
            if (!focused && !challenged) return;
            let label = focused ? this.focus.prompt : 'GUARDIANS';
            if (challenged && site.guardianExpected > 0) label = `GUARDIANS ${site.guardianAlive}/${site.guardianExpected}`;
            const progress = focused ? this.focus.progress : 0;
            ctx.save();
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = '700 22px -apple-system, system-ui, sans-serif';
            const width = Math.max(132, ctx.measureText(label).width + 42);
            const x = site.x - width * 0.5;
            const y = site.y - 104;
            ctx.fillStyle = 'rgba(8, 7, 12, 0.88)'; ctx.fillRect(x, y, width, 40);
            ctx.strokeStyle = site.def.accent; ctx.lineWidth = 2; ctx.strokeRect(x, y, width, 40);
            ctx.fillStyle = focused && this.focus.blocked ? 'rgba(255,255,255,0.62)' : '#fff4df';
            ctx.fillText(`${site.def.symbol}  ${label}`, site.x, y + 20);
            if (progress > 0 && progress < 1) {
                ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x, y + 43, width, 6);
                ctx.fillStyle = site.def.accent; ctx.fillRect(x, y + 43, width * progress, 6);
            }
            ctx.restore();
        });
    }
}
