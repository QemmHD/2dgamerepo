// Render pipeline. Split out of Game.js as part of the "move code, don't change
// behavior" decomposition: these are the exact same methods, relocated onto
// Game.prototype via Object.assign in Game.js, so `game.render()` and every
// internal this._drawX()/this._inView() call resolve unchanged. `this` is the
// Game instance throughout.
//
// Owns the per-frame draw: the world/HUD composite (render), shockwave rings,
// the hit vignette, the victory overlay + its rects, the share toast, the debug
// grid + world bounds, the adaptive gfx governor + its level apply, the view-cull
// test, and the contact flash.

import {
    GRID_COLOR,
    GRID_SIZE,
    WORLD_WIDTH,
    WORLD_HEIGHT,
    WORLD_BOUNDS_COLOR,
    INTERNAL_WIDTH,
    INTERNAL_HEIGHT,
    CONTACT_FLASH_DURATION,
    BOSS,
    AURA,
    RENDER,
    BIOME_HAZARD,
    BLINK,
    GFX,
    LIGHT_COLORS,
    EMBERGLASS,
    VICTORY_BEAT,
} from '../config/GameConfig.js';
import { TWO_PI, clamp } from './MathUtils.js';
import { Easing } from './Easing.js';
import { Player } from '../entities/Player.js';
import { Enemy } from '../entities/Enemy.js';
import { signatureFor } from '../content/signatures.js';
import { getBorderStrip, getBorderPattern } from '../assets/ObstacleSprites.js';
import { HazardSystem } from '../systems/HazardSystem.js';
import { buildUIState } from '../systems/UIStateBuilder.js';
import { gemLightColor } from './GameUpdate.js';
import { structureRenderer } from '../render/StructureRenderer.js';
import {
    combatStatusCueSize,
    FULL_STATUS_CUE_LIMIT,
    TRASH_STATUS_CUE_LIMIT,
} from '../render/CombatCues.js';

// Half the largest sprite (~91) + bar/label headroom + max camera shake. Anything
// whose center is farther than this from the view edge can't contribute a visible
// pixel and is skipped at draw time.
const CULL_MARGIN = 160;

// Visible world objects share one painter queue. Houses contribute two depth
// planes (rear/roof and front/sides), which lets actors on opposite sides of
// the same house layer independently. Entries are pooled on Game so the swarm
// cap does not turn y-sorting into a per-frame allocation source.
const STAND_STRUCTURE_REAR = 0;
const STAND_OBSTACLE = 1;
const STAND_STRUCTURE_FRONT = 2;
const STAND_GEM = 3;
const STAND_COIN = 4;
const STAND_HEALTH = 5;
const STAND_CHEST = 6;
const STAND_SHRINE = 7;
const STAND_ENEMY = 8;
const STAND_PLAYER = 9;

function addStanding(queue, pool, index, kind, value, baseY, actorRank, order) {
    let entry = pool[index];
    if (!entry) entry = pool[index] = { kind: 0, value: null, baseY: 0, actorRank: 0, order: 0 };
    entry.kind = kind;
    entry.value = value;
    entry.baseY = baseY;
    // World planes win exact ties, matching the old `ob.baseY <= playerBaseY`
    // contract: an actor standing exactly on a wall's feet line paints over it.
    entry.actorRank = actorRank;
    entry.order = order;
    queue.push(entry);
}

function standingOrder(a, b) {
    return (a.baseY - b.baseY) || (a.actorRank - b.actorRank) || (a.order - b.order);
}

export const GameRenderMethods = {
    render() {
        const r = this.renderer;
        if (!r.beginFrame()) return;
        const ctx = r.ctx;

        // Start screen renders on a flat background with no world behind —
        // simpler to read and avoids drawing entities that haven't been
        // bootstrapped by a real run yet.
        if (this.screen === 'start') {
            ctx.fillStyle = '#0a0e16';
            ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
            this.ui.draw(ctx, buildUIState(this));
            // The Mines overlay is Game-drawn (not part of the menu renderer),
            // so it must be painted here — the start screen returns before the
            // gameplay-tail overlay block below.
            if (this.minigame.mines) this.minigame.drawMines(ctx);
            return;
        }

        // Read once for this frame, then pass the scalar through the combat
        // render path. Unknown/legacy saves naturally resolve to false.
        const highContrast = this.saveSystem?.getSetting?.('highContrast') === true;
        const uiScale = this.saveSystem?.getSetting?.('uiScale') ?? 100;

        // "Emberlight" pipeline. The world draws fully lit; emitters
        // register lights into the darkness buffer as they're drawn; the
        // veil is composited in screen space afterward with bright sparks +
        // damage numbers layered on top so feedback never dims.
        const lightingOn = GFX.darkness.enabled && this.lighting.ok;
        const L = lightingOn ? this.lighting : null;
        this.profiler.begin('lighting');
        if (L) L.beginFrame(this.camera);
        this.profiler.end('lighting');

        ctx.save();
        this.camera.apply(ctx);

        // Photo-mode zoom widens the visible view; feed the wider extent to the
        // view-extent consumers + cull so nothing pops at the frame edge when
        // zoomed out (zoom>1 just over-draws a touch at the old margin — fine).
        const _zoom = this.camera.zoom || 1;
        const viewW = INTERNAL_WIDTH / _zoom;
        const viewH = INTERNAL_HEIGHT / _zoom;
        const cullMargin = CULL_MARGIN + (_zoom < 1 ? (1 / _zoom - 1) * INTERNAL_WIDTH / 2 : 0);

        // Ground → grid(debug) → decorations (which register candle lights)
        // → low fog (below entities) → bounds.
        this.profiler.begin('map');
        this.mapRenderer.drawBackground(ctx, this.camera, viewW, viewH);
        this.profiler.end('map');
        if (this.showDebug) this._drawGrid(ctx);
        this.profiler.begin('decor');
        this.mapRenderer.drawDecorations(ctx, this.camera, viewW, viewH, L);
        this.profiler.end('decor');
        this.profiler.begin('particles');
        if (this.particlesEnabled && !this.reducedEffects) this.particles.drawWorldFog(ctx, this.camera);
        this.profiler.end('particles');
        this._drawWorldBounds(ctx, this.showDebug);

        // Houses are visual groups layered over the unchanged collision walls.
        // Yard and the single footprint shadow are true ground art. House mood
        // lights register only after combat emitters, near the end of the pass.
        this.profiler.begin('obstacles');
        this.obstacleSystem.forVisibleStructures(this.camera, viewW, viewH, (structure) => {
            structureRenderer.drawGround(ctx, structure);
        });
        this.profiler.end('obstacles');

        // Decorative floors (building interiors) are GROUND — always drawn
        // behind every entity/wall, never y-sorted against the player (else a
        // player above the building would push the floor into the in-front pass
        // and paint it over enemies inside). One flat ground pass here.
        this.profiler.begin('obstacles');
        this.obstacleSystem.forVisible(
            this.camera, viewW, viewH,
            (ob) => ob.draw(ctx), (ob) => !!ob.def.decorative
        );
        this.profiler.end('obstacles');

        // Visible standing art is assembled after ground hazards so every actor
        // can resolve independently against both house depth planes.
        // (Decorative floors are excluded — drawn in the ground pass above.)
        // Off-screen culling: only entities within the camera view (plus a
        // sprite-half + shake margin) are worth a draw call (enemies spawn
        // ~1100-1350px out, cap up to 145). Lights are registered in the
        // SAME culled loops so light cost scales with visible emitters too.
        const cull = (e) => this._inView(e.x, e.y, cullMargin);
        const Lc = GFX.lighting;

        // Boss arena boundary ring — a glowing wall the player + boss are sealed
        // inside. Drawn on the ground so entities render over it; a soft inner
        // glow band + a pulsing dashed edge sell it as an energy barrier.
        if (this.arena) {
            const a = this.arena;
            ctx.save();
            const pulse = 0.6 + 0.4 * Math.sin(this.time * 4);
            // Inner glow band just inside the wall.
            const band = ctx.createRadialGradient(a.x, a.y, a.r - 90, a.x, a.y, a.r);
            band.addColorStop(0, 'rgba(255,90,60,0)');
            band.addColorStop(1, `rgba(255,90,60,${0.18 * pulse})`);
            ctx.fillStyle = band;
            ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, TWO_PI); ctx.fill();
            // The wall itself.
            ctx.strokeStyle = BOSS.arenaColor;
            ctx.globalAlpha = 0.5 + 0.4 * pulse;
            ctx.lineWidth = 6;
            ctx.setLineDash([34, 22]);
            ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, TWO_PI); ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }

        // Hazard ground decals (boss telegraphs, delayed zones, lingering
        // pools) — below entities so the boss paints over them.
        this.hazardSystem.drawGround(ctx, this, L);
        // House-bound Waylights are low standing props. Actors remain above
        // their plinths while house rear/front planes keep normal occlusion.
        this.vigilSiteSystem?.draw?.(ctx, this.camera, viewW, viewH, null);

        // Player light first (always kept, exempt from caps). The light TINT
        // follows the weapon aura so the glow radiating from the player changes
        // with their build; radius stays fixed (visual only — never reveals
        // more of the map) and the intensity bump is small + capped.
        if (L) {
            const aura = this._auraSnapshot;
            const lightColor = aura ? aura.color : LIGHT_COLORS.player;
            const lightInten = Lc.playerIntensity + (aura ? Math.min(AURA.lightIntensityBonus, aura.intensity * 0.4) : 0);
            // Crypts gloom pools (P1.2) SQUEEZE the hero's light — gloomT
            // (0..1, eased by HazardSystem) scales the radius down by up to
            // lightCut, so standing in living darkness visibly costs vision.
            const gloomK = 1 - (BIOME_HAZARD.gloom.lightCut ?? 0.5) * (this.gloomT ?? 0);
            L.addLight(this.player.x, this.player.y, Lc.playerRadius * gloomK, lightColor, lightInten, 0);
        }

        // One localized standing queue replaces the old player-global split.
        // A rear and a front house plane enter independently, so an enemy north
        // of a house, the hero inside it, and a chest south of it all resolve in
        // one frame without redrawing any actor or its additive glow.
        const standingQueue = this._standingRenderQueue || (this._standingRenderQueue = []);
        const standingPool = this._standingRenderPool || (this._standingRenderPool = []);
        standingQueue.length = 0;
        let standingCount = 0;
        let standingSerial = 0;

        this.obstacleSystem.forVisibleStructures(this.camera, viewW, viewH, (structure) => {
            const rearBaseY = structure.rearBaseY ?? (structure.y - structure.interiorH / 2);
            addStanding(standingQueue, standingPool, standingCount++, STAND_STRUCTURE_REAR,
                structure, rearBaseY, 0, standingSerial++);
            addStanding(standingQueue, standingPool, standingCount++, STAND_STRUCTURE_FRONT,
                structure, structure.frontBaseY, 0, standingSerial++);
        });
        this.obstacleSystem.forVisible(
            this.camera, viewW, viewH,
            (ob) => addStanding(standingQueue, standingPool, standingCount++, STAND_OBSTACLE,
                ob, ob.baseY, 0, standingSerial++),
            // Structure walls keep their collision/LOS authority but cohesive
            // shell art owns their pixels. Decorative floors already drew.
            (ob) => !ob.def.decorative && !(ob.type === 'buildingWall' && ob.structureId),
        );
        for (const g of this.gems) {
            if (!cull(g)) continue;
            addStanding(standingQueue, standingPool, standingCount++, STAND_GEM,
                g, g.y + g.radius, 1, standingSerial++);
        }
        for (const c of this.coins) {
            if (!cull(c)) continue;
            addStanding(standingQueue, standingPool, standingCount++, STAND_COIN,
                c, c.y + c.radius, 1, standingSerial++);
        }
        for (const h of this.healthOrbs) {
            if (!cull(h)) continue;
            addStanding(standingQueue, standingPool, standingCount++, STAND_HEALTH,
                h, h.y + h.radius, 1, standingSerial++);
        }
        for (const c of this.chests) {
            if (!cull(c)) continue;
            addStanding(standingQueue, standingPool, standingCount++, STAND_CHEST,
                c, c.y + Math.min(c.radius || 0, 28), 1, standingSerial++);
        }
        for (const s of this.shrines) {
            if (!cull(s)) continue;
            // Shrine art's stone plinth ends at y+16; its interaction radius is
            // intentionally much larger and is not a painter baseline.
            addStanding(standingQueue, standingPool, standingCount++, STAND_SHRINE,
                s, s.y + 16, 1, standingSerial++);
        }
        for (const e of this.enemies) {
            if (!cull(e)) continue;
            addStanding(standingQueue, standingPool, standingCount++, STAND_ENEMY,
                e, e.y + e.radius, 1, standingSerial++);
        }
        addStanding(standingQueue, standingPool, standingCount++, STAND_PLAYER,
            this.player, this.player.y + this.player.radius, 1, standingSerial++);

        standingQueue.sort(standingOrder);
        this.profiler.begin('entities');
        for (const entry of standingQueue) {
            const value = entry.value;
            switch (entry.kind) {
                case STAND_STRUCTURE_REAR:
                    structureRenderer.drawRear(ctx, value, this.player);
                    break;
                case STAND_OBSTACLE:
                    value.draw(ctx);
                    break;
                case STAND_STRUCTURE_FRONT:
                    structureRenderer.drawFront(ctx, value);
                    break;
                case STAND_GEM:
                    value.draw(ctx);
                    if (L) L.addLight(value.x, value.y, Lc.gemRadius, gemLightColor(value.tier), 0.85, 1);
                    break;
                case STAND_COIN:
                    value.draw(ctx);
                    if (L) L.addLight(value.x, value.y, Lc.coinRadius, LIGHT_COLORS.coin, 0.8, 1);
                    break;
                case STAND_HEALTH:
                    value.draw(ctx);
                    if (L) L.addLight(value.x, value.y, Lc.coinRadius, '#6bff8a', 0.85, 1);
                    break;
                case STAND_CHEST:
                    value.draw(ctx);
                    if (L) L.addLight(value.x, value.y, Lc.chestRadius, LIGHT_COLORS.chest, 0.9, 1);
                    break;
                case STAND_SHRINE:
                    value.draw(ctx);
                    if (L) L.addLight(value.x, value.y, Lc.chestRadius, LIGHT_COLORS.shrine, 0.9, 1);
                    break;
                case STAND_ENEMY:
                    value.draw(ctx);
                    value.drawHpBar(ctx);
                    if (value.encounterGuardian) this._drawEncounterGuardianMark(ctx, value);
                    if (L) {
                        if (value.boss) L.addLight(value.x, value.y, Lc.bossRadius, LIGHT_COLORS.boss, 0.95, 0);
                        else L.addLight(value.x, value.y - value.radius * 0.3,
                            Lc.enemyEyeRadius, LIGHT_COLORS.enemyEye, 0.7, 2);
                        if (value.burnTimer > 0) {
                            L.addLight(value.x, value.y, Lc.burnRadius, LIGHT_COLORS.fire, 0.7, 2);
                        }
                    }
                    break;
                case STAND_PLAYER:
                    value.draw(ctx);
                    value.drawHpBar(ctx);
                    break;
            }
        }
        this.profiler.end('entities');
        this.weaponSystem.drawWeaponVisuals(ctx, this.player);
        this.profiler.begin('projectiles');
        for (const p of this.projectiles) {
            if (!cull(p)) continue;
            p.draw(ctx);
            if (L) L.addLight(p.x, p.y, Lc.projectileRadius, LIGHT_COLORS.projectile, 0.85, 0);
        }
        // Enemy bolts — drawn above player projectiles; each carves a small
        // hostile-purple light so they read against the dark.
        for (const ep of this.enemyProjectiles) {
            if (!cull(ep)) continue;
            ep.draw(ctx);
            if (L) L.addLight(ep.x, ep.y, 110, '#c97bff', 0.8, 0);
        }
        this.profiler.end('projectiles');
        // Bright hazards (boss shockwave rings + sweeping laser beams) —
        // above entities, additive, each carving its own light.
        this.hazardSystem.drawAbove(ctx, this, L);

        this.weaponSystem.drawEffects(ctx);
        // Weapon effects (pulse/lightning) are bright emitters — carve light
        // holes so the veil doesn't dim them.
        if (L) {
            for (const fx of this.weaponSystem.effects) {
                if (!fx.active) continue;
                L.addLight(fx.x, fx.y, Lc.effectRadius, LIGHT_COLORS.effect, 0.8, 0);
            }

            // Mood emitters are deliberately last. Priority-2 house windows can
            // fill spare atmosphere budget, but never claim a slot before enemy
            // eyes/burns or any always-on projectile, boss, hazard, or effect.
            this.obstacleSystem.forVisibleStructures(this.camera, viewW, viewH, (structure) => {
                structureRenderer.registerLights(L, structure);
            });
            this.vigilSiteSystem?.forVisible?.(this.camera, viewW, viewH, (site) => {
                if (site.state !== 'spent') L.addLight(site.x, site.y - 18, 104, site.def.accent, 0.48, 2);
            });
        }

        // Expanding shockwave rings (kills / boss death / level-up) — additive
        // so they glow, drawn in the world layer above entities.
        if (this.rings.length) this._drawRings(ctx);

        // Occludable additive particles (embers + death dust) — these sit
        // above entities but BELOW the veil, so they read as ambient glow.
        this.profiler.begin('particles');
        if (this.particlesEnabled) this.particles.drawWorldAdditive(ctx, this.camera);
        this.profiler.end('particles');

        if (this.collisionSystem.contactFlash > 0) {
            this._drawContactFlash(ctx);
        }

        if (this.showDebug) {
            this.mapRenderer.drawDebug(ctx, this.camera, INTERNAL_WIDTH, INTERNAL_HEIGHT);
            // Obstacle footprints (red = blocks sight, amber = passable LOS).
            this.obstacleSystem.drawDebug(ctx, this.camera, INTERNAL_WIDTH, INTERNAL_HEIGHT);
            this.player.drawDebug(ctx);
            for (const g of this.gems) if (cull(g)) g.drawDebug(ctx);
            for (const c of this.coins) if (cull(c)) c.drawDebug(ctx);
            for (const h of this.healthOrbs) if (cull(h)) h.drawDebug(ctx);
            for (const c of this.chests) if (cull(c)) c.drawDebug(ctx);
            for (const s of this.shrines) if (cull(s)) s.drawDebug(ctx);
            for (const e of this.enemies) if (cull(e)) e.drawDebug(ctx);
            for (const p of this.projectiles) if (cull(p)) p.drawDebug(ctx);
            for (const ep of this.enemyProjectiles) if (cull(ep)) ep.drawDebug(ctx);
            // Line-of-sight rays from the player to nearby enemies: green when
            // clear, red when a wall blocks the shot.
            ctx.save();
            ctx.lineWidth = 1.5;
            for (const e of this.enemies) {
                if (!e.active || !cull(e)) continue;
                const clear = this.obstacleSystem.hasLineOfSight(this.player.x, this.player.y, e.x, e.y);
                ctx.strokeStyle = clear ? 'rgba(90,230,120,0.5)' : 'rgba(255,70,70,0.8)';
                ctx.beginPath();
                ctx.moveTo(this.player.x, this.player.y);
                ctx.lineTo(e.x, e.y);
                ctx.stroke();
            }
            ctx.restore();
        }
        ctx.restore();

        // SCREEN SPACE. Composite the darkness veil (+ baked vignette +
        // color tint) over the lit world, or fall back to the plain
        // vignette if the lighting buffer is unavailable.
        this.profiler.begin('lighting');
        if (L) L.composite(ctx);
        else this.mapRenderer.drawVignette(ctx, INTERNAL_WIDTH, INTERNAL_HEIGHT);
        this.profiler.end('lighting');

        // Biome weather (embers rise / snow falls) — screen-space atmosphere
        // over the lit world, beneath the HUD.
        if (this.particlesEnabled && !this.reducedEffects) {
            this.mapRenderer.drawWeather(ctx, INTERNAL_WIDTH, INTERNAL_HEIGHT, this.time);
        }

        // Damage vignette: a red screen-edge pulse on taking a hit, drawn over
        // the veil so it reads even in the dark. Cached gradient, just alpha.
        if (this.hitVignette > 0.01) this._drawHitVignette(ctx);

        // Always-bright sparks sit ABOVE the veil so kill/hit/pickup/level
        // feedback never gets dimmed by the darkness.
        this.profiler.begin('particles');
        if (this.particlesEnabled) this.particles.drawScreenAdditive(ctx, this.camera);
        this.profiler.end('particles');

        // Damage numbers also draw above the veil (world-positioned via a
        // re-applied camera transform) so combat math stays fully legible.
        // The T3 governor drop (_gfxDropDamageNumbers) is ANDed here so it never
        // overrides a player who kept them on at a higher tier's expense.
        if (this.damageNumbersEnabled && !this._gfxDropDamageNumbers) {
            ctx.save();
            this.camera.apply(ctx);
            for (const d of this.damageNumbers) if (cull(d)) d.draw(ctx);
            ctx.restore();
        }

        // Visibility-aware semantic overlay. It runs after damage numbers so
        // transient combat math cannot cover a warning/status meaning. Statuses
        // always retain their non-color language above the veil; high-contrast
        // mode additionally repeats only contours (never authored fills/glow).
        // Badge size honors the save UI scale and a minimum CSS footprint.
        this.profiler.begin('combatCues');
        ctx.save();
        this.camera.apply(ctx);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        if (highContrast) this.hazardSystem.drawContrastOverlay(ctx, this);
        const statusSize = combatStatusCueSize(
            uiScale,
            this.renderer?.cssWidth,
            INTERNAL_WIDTH,
            this.camera.zoom || 1,
        );
        for (const enemy of this.enemies) {
            if (!enemy.active || !cull(enemy)) continue;
            const fullStatus = enemy.boss || enemy.lieutenant || enemy.encounterGuardian
                || enemy === this.focusTarget;
            enemy.drawCombatCueOverlay(
                ctx,
                highContrast,
                statusSize,
                fullStatus ? FULL_STATUS_CUE_LIMIT : TRASH_STATUS_CUE_LIMIT,
            );
        }
        ctx.restore();
        this.profiler.end('combatCues');

        // EMBERGLASS: mint from the completed world frame (including combat
        // semantics), before the gameplay HUD and modal overlays are painted.
        if (this._pendingCardMint) this._mintPendingCard();

        // EMBERGLASS photo mode: HUD off. Draw the rule-of-thirds grid + the
        // minimal Lens toolbar instead (both excluded from a SNAP via the
        // _suppressToolbar flag). Optionally re-show the gameplay HUD for an
        // annotated shot.
        if (this.photoMode) {
            this._drawPhotoFilter(ctx);   // grades the world; part of a SNAP
            if (this.photoMode.hudShown) {
                const photoUIState = buildUIState(this);
                if (this.screen === 'gameplay' && this.vigilTracker) {
                    const vigilLayout = this.ui.getHUDLayout(photoUIState);
                    this.vigilTracker.drawHUD(ctx, vigilLayout.vigil, {
                        compact: vigilLayout.compact,
                        uiScale,
                        highContrast,
                    });
                }
                this.ui.draw(ctx, photoUIState);
            }
            if (!this._suppressToolbar) {
                if (this.photoMode.gridOn) this._drawPhotoGrid(ctx);
                this.ui.drawPhotoToolbar(ctx, this.photoMode, this.camera.zoom, this.shareToast, this._photoFilterName());
            }
            return;
        }

        // Site interaction copy stays above the darkness veil so RESTORE,
        // READ, OPEN, and KINDLE remain readable in the darkest interiors.
        if (this.vigilSiteSystem) {
            ctx.save();
            this.camera.apply(ctx);
            this.vigilSiteSystem.drawAbove(ctx, this.camera, viewW, viewH);
            ctx.restore();
        }

        const gameplayUIState = buildUIState(this);
        // The large announcement owns this top-screen band for its brief
        // lifetime. Yield the persistent chip without mutating tracker state;
        // the next frame after the announcement retires restores it naturally.
        const largeAnnouncementActive = !!gameplayUIState.waveAnnouncement;
        if (this.screen === 'gameplay' && this.vigilTracker && !largeAnnouncementActive) {
            const vigilLayout = this.ui.getHUDLayout(gameplayUIState);
            this.vigilTracker.drawHUD(ctx, vigilLayout.vigil, {
                compact: vigilLayout.compact,
                uiScale,
                highContrast,
            });
        }

        this.profiler.begin('ui');
        this.ui.draw(ctx, gameplayUIState);
        this.profiler.end('ui');

        if (this.victory) this._drawVictory(ctx);

        if (this.screen === 'gameplay' && this.input.touch && this.input.isTouchMode?.()) this.input.touch.draw(ctx);
        // KINDLED touch action buttons (blink + Kindle ult). Active modality,
        // rather than touch-capable hardware, owns this HUD convention so a
        // hybrid laptop returns cleanly to desktop prompts after keyboard use.
        // Fed the live meter/cooldown the buttons don't own.
        if (this.screen === 'gameplay' && this.input.buttons && this.input.isTouchMode?.()) {
            const k = this.kindleSystem, sig = signatureFor(this._heroId);
            this.input.buttons.draw(ctx, {
                fill: k ? k.fill / k.max : 0,
                ready: !!(k && k.ready),
                ultColor: sig ? sig.color : '#ff8c4a',
                aiming: !!(k && k.aiming),
                blinkFrac: k ? (k.blinkCooldown / BLINK.cooldown) : 0,
                reducedMotion: this.reducedEffects === true,
            });
        }
    },


    // Expanding shockwave rings — additive stroked circles that grow via an
    // ease and thin + fade as they reach their max radius. World-space (called
    // inside the camera transform).
    _drawEncounterGuardianMark(ctx, enemy) {
        const pulse = this.reducedEffects ? 0.72 : 0.62 + 0.18 * Math.sin(this.time * 5 + enemy.radius);
        const radius = enemy.radius + 12;
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = enemy.vigilGuardian ? '#ffcf78' : '#9fe7ff';
        ctx.lineWidth = 3;
        ctx.setLineDash([12, 8]);
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, radius, 0, TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = enemy.vigilGuardian ? '#ffcf78' : '#9fe7ff';
        ctx.beginPath();
        ctx.moveTo(enemy.x, enemy.y - radius - 15);
        ctx.lineTo(enemy.x - 8, enemy.y - radius - 3);
        ctx.lineTo(enemy.x + 8, enemy.y - radius - 3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    },

    _drawRings(ctx) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const ring of this.rings) {
            if (!ring.active) continue;
            const t = Math.min(1, ring.age / ring.life);
            const e = (Easing[ring.ease] || Easing.outQuad)(t);
            const r = ring.r0 + (ring.maxR - ring.r0) * e;
            const fade = 1 - t;
            ctx.globalAlpha = 0.7 * fade;
            ctx.strokeStyle = ring.color;
            ctx.lineWidth = Math.max(0.5, ring.width * fade);
            ctx.beginPath();
            ctx.arc(ring.x, ring.y, r, 0, TWO_PI);
            ctx.stroke();
        }
        ctx.restore();
    },

    // Red screen-edge vignette pulse on taking damage. Gradient is built once
    // (screen-space, fixed internal resolution) and cached; only alpha varies.
    _drawHitVignette(ctx) {
        if (!this._hitVignetteGrad) {
            const cx = INTERNAL_WIDTH / 2, cy = INTERNAL_HEIGHT / 2;
            const g = ctx.createRadialGradient(
                cx, cy, INTERNAL_HEIGHT * 0.32,
                cx, cy, INTERNAL_HEIGHT * 0.72
            );
            g.addColorStop(0, 'rgba(180,12,20,0)');
            g.addColorStop(1, 'rgba(150,8,16,1)');
            this._hitVignetteGrad = g;
        }
        ctx.save();
        ctx.globalAlpha = Math.min(0.6, this.hitVignette * 0.6);
        ctx.fillStyle = this._hitVignetteGrad;
        ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
        ctx.restore();
    },

    // Layout for the victory overlay's three stacked buttons (internal coords).
    _victoryRects() {
        const cx = INTERNAL_WIDTH / 2;
        const w = 560, h = 96, gap = 26;
        const top = INTERNAL_HEIGHT / 2 - 40;
        return {
            cont:  { x: cx - w / 2, y: top, w, h },
            biome: { x: cx - w / 2, y: top + (h + gap), w, h },
            menu:  { x: cx - w / 2, y: top + (h + gap) * 2, w, h },
            // EMBERGLASS: 4th SHARE button (only drawn/hit when a card was minted).
            share: { x: cx - w / 2, y: top + (h + gap) * 3, w, h },
        };
    },

    _drawVictory(ctx) {
        const W = INTERNAL_WIDTH, H = INTERNAL_HEIGHT;
        // Hold the victory beat: the hero cheers in the lit world before the
        // overlay dims/fades in (same offset the input lockout uses).
        const t = Math.min(1, Math.max(0, (this.victory.age || 0) - VICTORY_BEAT) / 0.35);
        ctx.save();
        // Dim the world.
        ctx.fillStyle = `rgba(8, 6, 16, ${0.78 * t})`;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = t;
        ctx.textAlign = 'center';
        // Title + subtitle. Boss Rush gets its own gauntlet copy (a full clear is
        // all N apex bosses, on the player's own biome — not the 3-boss "new biome
        // opens" milestone).
        const isBossRush = !!this.bossRushMode;
        ctx.fillStyle = '#ffd98a';
        ctx.font = 'bold 86px sans-serif';
        ctx.fillText(isBossRush ? 'GAUNTLET BROKEN' : 'VIGIL TRIUMPHANT', W / 2, H / 2 - 150);
        ctx.fillStyle = '#cde4ff';
        ctx.font = '34px sans-serif';
        const brTotal = this.bossRush ? this.bossRush.total : 12;
        ctx.fillText(
            isBossRush
                ? `All ${brTotal} apex Hollow have fallen — Boss Rush cleared!`
                : 'Three apex Hollow have fallen. A new biome opens.',
            W / 2, H / 2 - 96);

        const r = this._victoryRects();
        const btn = (rect, label, sub, fill, border) => {
            ctx.fillStyle = fill;
            ctx.strokeStyle = border;
            ctx.lineWidth = 3;
            if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 16); ctx.fill(); ctx.stroke(); }
            else { ctx.fillRect(rect.x, rect.y, rect.w, rect.h); ctx.strokeRect(rect.x, rect.y, rect.w, rect.h); }
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 38px sans-serif';
            ctx.fillText(label, rect.x + rect.w / 2, rect.y + (sub ? 42 : 60));
            if (sub) {
                ctx.fillStyle = 'rgba(255,255,255,0.75)';
                ctx.font = '22px sans-serif';
                ctx.fillText(sub, rect.x + rect.w / 2, rect.y + 74);
            }
        };
        if (isBossRush) {
            // A cleared Boss Rush has no endless continue; every top button banks
            // the result and returns to the menu (Continue is routed there too).
            btn(r.cont, 'RETURN', 'bank your gauntlet result', '#5a3a1a', '#ffb24a');
            btn(r.biome, 'NEW MAP', 'swap biome for your next run', '#1d4a7a', '#7fd0ff');
            btn(r.menu, 'MAIN MENU', 'bank coins • upgrade • pick a map', '#5a3a1a', '#ffb24a');
        } else {
            btn(r.cont, 'CONTINUE', 'keep going — the gauntlet cycles harder', '#1d6b3a', '#7be08a');
            btn(r.biome, 'PLAY NEW BIOME', 'Hollow Reach — the frozen vigil', '#1d4a7a', '#7fd0ff');
            btn(r.menu, 'MAIN MENU', 'bank coins • upgrade • pick a map', '#5a3a1a', '#ffb24a');
        }
        // EMBERGLASS: share the auto-minted victory card (S / tap).
        if (this.mintedCard) btn(r.share, 'SHARE CARD', 'copy your victory card to share', '#5a3a1a', '#ffd166');
        ctx.restore();
        // Toast (drawn at full alpha, outside the fade save block).
        if (this.shareToast) this._drawShareToast(ctx);
    },

    // Small centered toast pill for share results (used by victory + game-over).
    _drawShareToast(ctx) {
        const st = this.shareToast;
        if (!st) return;
        const W = INTERNAL_WIDTH;
        const a = Math.min(1, st.timer / 0.4);   // fade out over the last 0.4s
        ctx.save();
        ctx.globalAlpha = a;
        ctx.font = "600 30px 'Cinzel', serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(st.text).width + 64;
        const bx = W / 2 - tw / 2, by = 130, bh = 60;
        if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, tw, bh, 12); }
        else { ctx.beginPath(); ctx.rect(bx, by, tw, bh); }
        ctx.fillStyle = 'rgba(20, 12, 10, 0.92)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ff9a4a';
        ctx.stroke();
        ctx.fillStyle = '#ffd166';
        ctx.fillText(st.text, W / 2, by + bh / 2 + 1);
        ctx.restore();
    },

    _drawGrid(ctx) {
        const W = INTERNAL_WIDTH;
        const H = INTERNAL_HEIGHT;
        const camX = this.camera.x;
        const camY = this.camera.y;
        const startX = Math.floor((camX - W / 2) / GRID_SIZE) * GRID_SIZE;
        const endX = camX + W / 2 + GRID_SIZE;
        const startY = Math.floor((camY - H / 2) / GRID_SIZE) * GRID_SIZE;
        const endY = camY + H / 2 + GRID_SIZE;

        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = startX; x <= endX; x += GRID_SIZE) {
            ctx.moveTo(x, startY);
            ctx.lineTo(x, endY);
        }
        for (let y = startY; y <= endY; y += GRID_SIZE) {
            ctx.moveTo(startX, y);
            ctx.lineTo(endX, y);
        }
        ctx.stroke();

        ctx.fillStyle = '#3c5070';
        ctx.beginPath();
        ctx.arc(0, 0, 10, 0, Math.PI * 2);
        ctx.fill();
    },

    _drawWorldBounds(ctx, debug) {
        const hw = WORLD_WIDTH / 2;
        const hh = WORLD_HEIGHT / 2;
        // Palisade ring: a stockade wall strip drawn just OUTSIDE the playable
        // rect on all four sides, so the world edge reads as a real barrier
        // (the position clamp remains the actual wall) without eating any play
        // space. Horizontal strips run along top/bottom; the same strip is
        // rotated 90° for the sides. Corners overlap harmlessly.
        const strip = getBorderStrip();
        if (strip && !debug) {
            const pat = getBorderPattern(ctx);
            if (pat) {
                const S = strip.height;
                const spanW = WORLD_WIDTH + S * 2, spanH = WORLD_HEIGHT + S * 2;
                ctx.save();
                // Out-of-bounds wash: everything beyond the playable rect
                // drops a step darker BEFORE the fence draws, so the palisade
                // clearly divides in from out instead of blending into the
                // same ground texture on both sides. M covers the farthest
                // the camera can peek past the edge.
                const M = 1600;
                ctx.fillStyle = 'rgba(6,5,10,0.42)';
                ctx.fillRect(-hw - M, -hh - M, WORLD_WIDTH + M * 2, M);
                ctx.fillRect(-hw - M, hh, WORLD_WIDTH + M * 2, M);
                ctx.fillRect(-hw - M, -hh, M, WORLD_HEIGHT);
                ctx.fillRect(hw, -hh, M, WORLD_HEIGHT);
                ctx.fillStyle = pat;
                // Top edge — wall stands ON the north boundary, rising outward.
                ctx.save(); ctx.translate(-hw - S, -hh - S);
                ctx.fillRect(0, 0, spanW, S); ctx.restore();
                // Bottom edge — fully outside, pointed tops toward the field.
                ctx.save(); ctx.translate(-hw - S, hh);
                ctx.fillRect(0, 0, spanW, S); ctx.restore();
                // Right edge (rotated 90° cw: tips point outward/east).
                ctx.save(); ctx.translate(hw + S, -hh - S); ctx.rotate(Math.PI / 2);
                ctx.fillRect(0, 0, spanH, S); ctx.restore();
                // Left edge (rotated 90° ccw: tips point outward/west).
                ctx.save(); ctx.translate(-hw - S, hh + S); ctx.rotate(-Math.PI / 2);
                ctx.fillRect(0, 0, spanH, S); ctx.restore();
                // Contact shadow hugging the inside of the fence line —
                // stepped translucent bands (cheap fills, no per-frame
                // gradient) that ground the palisade and lift it off the
                // identical ground texture inside.
                ctx.fillStyle = 'rgba(0,0,0,0.10)';
                for (const wd of [30, 18, 8]) {
                    ctx.fillRect(-hw, -hh, WORLD_WIDTH, wd);
                    ctx.fillRect(-hw, hh - wd, WORLD_WIDTH, wd);
                    ctx.fillRect(-hw, -hh, wd, WORLD_HEIGHT);
                    ctx.fillRect(hw - wd, -hh, wd, WORLD_HEIGHT);
                }
                ctx.restore();
                return;
            }
        }
        ctx.save();
        ctx.strokeStyle = WORLD_BOUNDS_COLOR;
        if (debug) {
            ctx.globalAlpha = 1;
            ctx.lineWidth = 4;
            ctx.setLineDash([16, 12]);
        } else {
            ctx.globalAlpha = 0.22;
            ctx.lineWidth = 6;
            ctx.setLineDash([24, 18]);
        }
        ctx.strokeRect(-hw, -hh, WORLD_WIDTH, WORLD_HEIGHT);
        ctx.setLineDash([]);
        ctx.restore();
    },

    // Adaptive graphics quality. The GameLoop measures fps; a sustained
    // dip steps quality down (fewer lights/particles, tint then fog off),
    // and it recovers when fps climbs back. Player/pickup lights + combat
    // sparks are never throttled (the lower levels only thin the extras).
    _updateGfxGovernor(dt) {
        if (!GFX.governor.enabled) return;
        const fps = this.loop?.fps ?? 0;
        if (fps <= 0) return; // not measured yet
        const g = GFX.governor;
        if (fps < g.downFps) { this._gfxLowTimer += dt; this._gfxHighTimer = 0; }
        else if (fps > g.upFps) { this._gfxHighTimer += dt; this._gfxLowTimer = 0; }
        else { this._gfxLowTimer = 0; this._gfxHighTimer = 0; }

        if (this._gfxLowTimer >= g.sustainSeconds && this._gfxLevel < 3) {
            this._gfxLevel++;
            this._gfxLowTimer = 0;
            this._applyGfxLevel();
        } else if (this._gfxHighTimer >= g.sustainSeconds * 2 && this._gfxLevel > 0) {
            this._gfxLevel--;
            this._gfxHighTimer = 0;
            this._applyGfxLevel();
        }
    },

    // Apply the current tier's quality knobs (roadmap #5). Data-driven from
    // GFX.tierDefs so the ladder is one tunable table: tier 0 is full; each
    // higher tier sheds cost in least-visible-loss order — T1 thins particles +
    // pickup lights + drops decoration shadows; T2 kills the lighting colour
    // tint + fewer max lights + half weather; T3 lowers the DPR cap, turns
    // damage numbers off, and drops particles to minimal. Sprites are
    // supersampled, so even the T3 sub-CSS backing stays acceptably crisp.
    // NOTE: darkness `strength` is deliberately NOT set here — it's owned by the
    // biome/photo darkness system; the governor only touches the fill levers.
    _applyGfxLevel() {
        const t = GFX.tierDefs[this._gfxLevel] || GFX.tierDefs[0];
        this.lighting.setQuality({
            maxLights: t.maxLights,
            pickupCap: t.pickupCap,
            colorTint: t.colorTint,
            veilScale: t.veilScale,
        });
        this.particles.setQuality({ max: t.particleCap, fog: t.fog });
        this.renderer.setDprCap?.(t.dpr === 'min' ? RENDER.minDpr : RENDER.maxDpr);
        // Decoration contact shadows: shed when the tier says so OR the player
        // chose reduced effects. Weather thins via weatherScale (never fully off
        // from the governor — the user's reducedEffects gate at the call site
        // handles that).
        this.mapRenderer.lowQuality = this.reducedEffects || !t.shadows;
        this.mapRenderer.weatherScale = t.weatherScale;
        // Damage numbers: the governor's T3 drop is ANDed with the user setting
        // at the render gate, so it never overrides a user who turned them off.
        this._gfxDropDamageNumbers = !t.damageNumbers;
    },

    // True when (x, y) is within the camera view plus `margin`. Used to
    // cull off-screen entity draws. Compares against camera.x/y (the follow
    // center); the small shake offset is covered by the margin.
    _inView(x, y, margin) {
        return (
            Math.abs(x - this.camera.x) <= INTERNAL_WIDTH / 2 + margin &&
            Math.abs(y - this.camera.y) <= INTERNAL_HEIGHT / 2 + margin
        );
    },

    _drawContactFlash(ctx) {
        const intensity = Math.min(1, this.collisionSystem.contactFlash / CONTACT_FLASH_DURATION);
        ctx.save();
        ctx.globalAlpha = intensity * 0.7;
        ctx.strokeStyle = '#ff4757';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(this.player.x, this.player.y, this.player.radius + 14, 0, TWO_PI);
        ctx.stroke();
        ctx.restore();
    },
};
