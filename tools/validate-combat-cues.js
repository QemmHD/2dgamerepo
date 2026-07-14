#!/usr/bin/env node
// Runtime regression checks for the post-veil combat cue language.
// Exercises production drawing methods through a recording Canvas2D context;
// no browser or third-party test runner is required.

import { existsSync, readFileSync } from 'node:fs';
import {
    COMBAT_CUE_DARK,
    COMBAT_CUE_LIGHT,
    FULL_STATUS_CUE_LIMIT,
    STATUS_CUE_BASE_INTERNAL_PX,
    STATUS_CUE_MIN_CSS_PX,
    TRASH_STATUS_CUE_LIMIT,
    combatStatusCueSize,
    drawCachedStatusGlyph,
    drawStatusGlyph,
    statusIconForKind,
} from '../src/render/CombatCues.js';
import { FrameProfiler, PROFILER_BUCKETS } from '../src/core/FrameProfiler.js';

let checks = 0;
function assert(ok, message) {
    checks++;
    if (!ok) throw new Error(message);
}

// Enemy and icon caches create canvases lazily. Their setup only needs a
// write-only 2D surface; combat assertions use the recorder below.
const gradient = { addColorStop() {} };
const assetContext = new Proxy({}, {
    get(_target, key) {
        if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => gradient;
        if (key === 'measureText') return () => ({ width: 0 });
        return () => {};
    },
    set() { return true; },
});
globalThis.document = {
    createElement() {
        return { width: 0, height: 0, getContext: () => assetContext };
    },
};

function n(value) {
    return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : String(value);
}

class RecordingContext {
    constructor() {
        this.events = [];
        this.path = [];
        this.stack = [];
        this.strokeStyle = '#000000';
        this.fillStyle = '#000000';
        this.lineWidth = 1;
        this.lineCap = 'butt';
        this.lineJoin = 'miter';
        this.globalAlpha = 1;
        this.globalCompositeOperation = 'source-over';
    }

    reset() {
        this.events.length = 0;
        this.path.length = 0;
        this.stack.length = 0;
        this.strokeStyle = '#000000';
        this.fillStyle = '#000000';
        this.lineWidth = 1;
        this.lineCap = 'butt';
        this.lineJoin = 'miter';
        this.globalAlpha = 1;
        this.globalCompositeOperation = 'source-over';
    }

    save() {
        this.stack.push({
            strokeStyle: this.strokeStyle,
            fillStyle: this.fillStyle,
            lineWidth: this.lineWidth,
            lineCap: this.lineCap,
            lineJoin: this.lineJoin,
            globalAlpha: this.globalAlpha,
            globalCompositeOperation: this.globalCompositeOperation,
        });
    }

    restore() {
        const state = this.stack.pop();
        if (!state) return;
        this.strokeStyle = state.strokeStyle;
        this.fillStyle = state.fillStyle;
        this.lineWidth = state.lineWidth;
        this.lineCap = state.lineCap;
        this.lineJoin = state.lineJoin;
        this.globalAlpha = state.globalAlpha;
        this.globalCompositeOperation = state.globalCompositeOperation;
    }

    beginPath() { this.path.length = 0; }
    closePath() { this.path.push('Z'); }
    moveTo(x, y) { this.path.push(`M${n(x)},${n(y)}`); }
    lineTo(x, y) { this.path.push(`L${n(x)},${n(y)}`); }
    arc(x, y, r, a0, a1) { this.path.push(`A${n(x)},${n(y)},${n(r)},${n(a0)},${n(a1)}`); }
    rect(x, y, w, h) { this.path.push(`R${n(x)},${n(y)},${n(w)},${n(h)}`); }
    quadraticCurveTo(x1, y1, x2, y2) { this.path.push(`Q${n(x1)},${n(y1)},${n(x2)},${n(y2)}`); }
    bezierCurveTo(x1, y1, x2, y2, x3, y3) {
        this.path.push(`B${n(x1)},${n(y1)},${n(x2)},${n(y2)},${n(x3)},${n(y3)}`);
    }

    stroke() {
        this.events.push({
            type: 'stroke', path: this.path.join('|'), style: this.strokeStyle,
            width: this.lineWidth, alpha: this.globalAlpha,
            composite: this.globalCompositeOperation,
        });
    }

    fill() {
        this.events.push({
            type: 'fill', path: this.path.join('|'), style: this.fillStyle,
            alpha: this.globalAlpha, composite: this.globalCompositeOperation,
        });
    }

    drawImage(image) {
        this.events.push({
            type: 'image', path: '',
            asset: image?._statusCueKind || image?._gameIconId || 'bitmap',
        });
    }

    translate() {}
    rotate() {}
    scale() {}
    fillRect() {}
    strokeRect() {}
    clearRect() {}
    clip() {}
    setLineDash() {}
    measureText() { return { width: 0 }; }
}

function makeContext() {
    const target = new RecordingContext();
    return new Proxy(target, {
        get(obj, key, receiver) {
            if (key in obj) return Reflect.get(obj, key, receiver);
            return () => {};
        },
        set(obj, key, value) {
            obj[key] = value;
            return true;
        },
    });
}

function contrastTriplets(events) {
    let count = 0;
    for (let i = 0; i + 2 < events.length; i++) {
        const dark = events[i];
        const light = events[i + 1];
        const accent = events[i + 2];
        if (dark.type !== 'stroke' || light.type !== 'stroke' || accent.type !== 'stroke') continue;
        if (dark.style !== COMBAT_CUE_DARK || light.style !== COMBAT_CUE_LIGHT) continue;
        if (accent.style === COMBAT_CUE_DARK || accent.style === COMBAT_CUE_LIGHT) continue;
        if (dark.path !== light.path || light.path !== accent.path) continue;
        assert(dark.width > light.width && light.width > accent.width,
            'contrast widths are not black underlay > white keyline > accent');
        assert(dark.alpha === 1 && light.alpha === 1,
            'contrast underlay/keyline inherited a translucent warning alpha');
        assert(dark.composite === 'source-over' && light.composite === 'source-over',
            'contrast underlay/keyline inherited additive compositing');
        count++;
    }
    return count;
}

function assertContrast(ctx, minimum, label) {
    const count = contrastTriplets(ctx.events);
    assert(count >= minimum, `${label}: emitted ${count} contour(s), expected at least ${minimum}`);
}

function assertNoContrast(ctx, label) {
    assert(contrastTriplets(ctx.events) === 0, `${label}: contrast contours leaked into authored rendering`);
}

function geometrySignature(events) {
    return events.map((event) => `${event.type}:${event.asset || ''}:${event.path}`).join('||');
}

function validateSourceBackedStatusVocabulary() {
    const mapping = {
        shield: 'shield', slow: 'frost', shred: 'shield', chill: 'frost',
        freeze: 'frost', burn: 'fire', shock: 'lightning',
    };
    for (const [kind, asset] of Object.entries(mapping)) {
        assert(statusIconForKind(kind) === asset, `${kind}: expected credited ${asset} source art`);
        const file = new URL(`../src/assets/icons/${asset}.png`, import.meta.url);
        assert(existsSync(file), `${kind}: credited source asset is missing: ${asset}.png`);
    }
    const credits = readFileSync(new URL('../src/assets/icons/CREDITS.md', import.meta.url), 'utf8');
    assert(credits.includes('Lorc') && credits.includes('CC-BY 3.0'),
        'status source art attribution is missing Lorc / CC-BY 3.0');

    const signatures = new Set();
    const ctx = makeContext();
    for (const kind of Object.keys(mapping)) {
        ctx.reset();
        const stacks = kind === 'shred' || kind === 'chill' || kind === 'shock' ? 3 : 0;
        drawStatusGlyph(ctx, kind, 0, 0, 16, null, stacks, false);
        const signature = geometrySignature(ctx.events);
        assert(ctx.events.some((event) => event.type === 'image' && event.asset === mapping[kind]),
            `${kind}: badge did not draw its credited ${mapping[kind]} glyph`);
        assert(!signatures.has(signature), `${kind}: non-color geometry duplicates another status`);
        signatures.add(signature);
    }
    assert(signatures.size === 7, 'status geometry is not one-to-one with status meaning');

    for (const stacks of [1, 3, 7, 9]) {
        ctx.reset();
        drawStatusGlyph(ctx, 'shock', 0, 0, 16, null, stacks, false);
        const last = ctx.events[ctx.events.length - 1];
        const moves = last.path.split('|').filter((part) => part.startsWith('M')).length;
        assert(moves === stacks, `shock encoded ${moves} ticks for ${stacks} stacks`);
    }
}

function validateCssReadableSizing() {
    assert(combatStatusCueSize(100, 1920, 1920, 1) === STATUS_CUE_BASE_INTERNAL_PX,
        '100% desktop badge does not preserve its authored internal size');
    assert(combatStatusCueSize(130, 1920, 1920, 1) === STATUS_CUE_BASE_INTERNAL_PX * 1.3,
        '130% UI scale does not enlarge combat badges');
    const phoneCssWidth = 667;
    const phoneSize = combatStatusCueSize(100, phoneCssWidth, 1920, 1);
    assert(phoneSize * phoneCssWidth / 1920 >= STATUS_CUE_MIN_CSS_PX - 0.001,
        'phone badge falls below the minimum readable CSS footprint');
    const largePhoneSize = combatStatusCueSize(130, phoneCssWidth, 1920, 1);
    assert(largePhoneSize >= phoneSize * 1.299,
        '130% UI scale does not enlarge a minimum-footprint phone badge');
    const zoomedOutSize = combatStatusCueSize(115, phoneCssWidth, 1920, 0.75);
    assert(zoomedOutSize * phoneCssWidth / 1920 * 0.75 >= STATUS_CUE_MIN_CSS_PX - 0.001,
        'zoomed-out badge falls below the minimum readable CSS footprint');
}

const { Enemy } = await import('../src/entities/Enemy.js');
const { HazardSystem } = await import('../src/systems/HazardSystem.js');

function allStatusEnemy() {
    return {
        x: 80, y: 120, radius: 22, boss: false,
        shieldTimer: 1, slowTimer: 1, shredTimer: 1, shredStacks: 4,
        chillTimer: 1, chillStacks: 5, freezeTimer: 1,
        burnTimer: 1, shockTimer: 1, shockStacks: 7,
    };
}

function badgeAssets(ctx) {
    return ctx.events.filter((event) => event.type === 'image').map((event) => event.asset);
}

function validateEnemyStatusDispatch() {
    const enemy = allStatusEnemy();
    const before = JSON.stringify(enemy);
    const ctx = makeContext();
    const trashCount = Enemy.prototype.drawStatusCues.call(
        enemy, ctx, true, 24, TRASH_STATUS_CUE_LIMIT,
    );
    assert(trashCount === TRASH_STATUS_CUE_LIMIT, 'trash status cap was not enforced');
    assert(JSON.stringify(badgeAssets(ctx)) === JSON.stringify(['shield', 'freeze', 'burn']),
        'trash status priority is not deterministic shield > freeze > burn');
    assert(JSON.stringify(enemy) === before, 'status rendering mutated enemy gameplay state');

    ctx.reset();
    const fullCount = Enemy.prototype.drawStatusCues.call(
        enemy, ctx, true, 24, FULL_STATUS_CUE_LIMIT,
    );
    assert(fullCount === FULL_STATUS_CUE_LIMIT, 'important enemy did not expose all seven statuses');
    assert(JSON.stringify(badgeAssets(ctx)) === JSON.stringify([
        'shield', 'freeze', 'burn', 'shock', 'shred', 'chill', 'slow',
    ]), 'full status ordering changed');

    const idle = {
        ...enemy,
        shieldTimer: 0, slowTimer: 0, shredTimer: 0, chillTimer: 0,
        freezeTimer: 0, burnTimer: 0, shockTimer: 0,
    };
    ctx.reset();
    assert(Enemy.prototype.drawStatusCues.call(idle, ctx, true, 24, 3) === 0,
        'idle enemy reported status work');
    assert(ctx.events.length === 0, 'idle enemy paid status drawing work');
}

function validateEnemyWindupOverlay() {
    const enemy = new Enemy('spitter', 0, 0);
    enemy.spawnAge = 1;
    enemy.animTimer = 1;
    enemy.windupTimer = enemy.def.windup * 0.5;
    enemy._windupAimX = 1;
    enemy._windupAimY = 0;
    const remaining = enemy.windupTimer;
    const ctx = makeContext();
    enemy.draw(ctx);
    assertNoContrast(ctx, 'normal enemy windup');

    ctx.reset();
    enemy.drawWindupContrastCue(ctx);
    assertContrast(ctx, 3, 'post-veil windup ring, progress arc, and aim chevron');
    assert(ctx.events.every((event) => event.type === 'stroke'),
        'windup contrast overlay repeated an authored fill/bitmap');
    assert(enemy.windupTimer === remaining, 'windup overlay changed attack timing');
}

function hazardGame(hazard, reducedEffects = false) {
    return { hazards: [hazard], reducedEffects, _inView: () => true };
}

function validateHazard(system, label, hazard, authoredMethod, minimum = 1, reducedEffects = false) {
    const game = hazardGame(hazard, reducedEffects);
    const before = JSON.stringify(hazard);
    const ctx = makeContext();
    system[authoredMethod](ctx, game, null);
    assertNoContrast(ctx, `${label} authored pass`);
    ctx.reset();
    system.drawContrastOverlay(ctx, game);
    assertContrast(ctx, minimum, `${label} post-veil pass`);
    assert(ctx.events.every((event) => event.type === 'stroke'),
        `${label}: post-veil pass repeated an authored fill/bitmap`);
    assert(JSON.stringify(hazard) === before, `${label}: drawing mutated gameplay state`);
}

function validateHazardVocabulary() {
    const system = new HazardSystem();
    validateHazard(system, 'boss circle', {
        active: true, kind: 'bossTelegraph', x: 0, y: 0,
        r: 60, rMax: 120, age: 0.5, lifetime: 1, fan: false,
    }, 'drawGround');
    validateHazard(system, 'boss charge lane and arrow', {
        active: true, kind: 'bossTelegraph', x: 0, y: 0,
        r: 0, rMax: 120, age: 0.5, lifetime: 1, charge: true,
        reach: 360, dirX: 1, dirY: 0,
    }, 'drawGround', 2);
    validateHazard(system, 'delayed zone boundary and countdown', {
        active: true, kind: 'delayedZone', x: 0, y: 0, r: 90,
        age: 0.5, lifetime: 1, hitPlayer: false,
    }, 'drawGround', 2);
    validateHazard(system, 'pre-live lingering boundary and countdown', {
        active: true, kind: 'lingering', x: 0, y: 0, r: 100,
        age: 0.4, warn: 1, lifetime: 5, color: '#b35bff',
    }, 'drawGround', 2);
    validateHazard(system, 'damaging biome warning', {
        active: true, biome: true, kind: 'brambles', x: 0, y: 0, r: 110,
        age: 0.4, warn: 1, lifetime: 6, tickDamage: 6,
        color: '#4c5c22', rim: '#c8e06a', seed: 0,
    }, 'drawGround', 1, true);
    validateHazard(system, 'shockwave leading edge', {
        active: true, kind: 'shockwave', x: 0, y: 0,
        r: 90, rMax: 500, band: 100,
    }, 'drawAbove', 1, true);
    validateHazard(system, 'pre-hot beam', {
        active: true, kind: 'beam', x: 0, y: 0,
        age: 0.4, warn: 1, curAngle: 0, length: 800, band: 30,
    }, 'drawAbove', 1, true);
}

function validateCompositeOrderAndNormalIsolation() {
    const renderSource = readFileSync(new URL('../src/core/GameRender.js', import.meta.url), 'utf8');
    const veil = renderSource.indexOf('if (L) L.composite(ctx);');
    const damageNumbers = renderSource.indexOf('for (const d of this.damageNumbers)');
    const hazardOverlay = renderSource.indexOf('drawContrastOverlay(ctx, this)');
    const enemyOverlay = renderSource.indexOf('enemy.drawCombatCueOverlay(');
    assert(veil >= 0 && hazardOverlay > veil && enemyOverlay > veil,
        'combat semantic overlay is not ordered after darkness compositing');
    assert(damageNumbers > veil && hazardOverlay > damageNumbers && enemyOverlay > damageNumbers,
        'damage numbers can cover the semantic combat overlay');
    assert(renderSource.indexOf('drawGround(ctx, this, L)') < veil,
        'authored ground hazards moved out of the world pass');
    assert(renderSource.indexOf('drawAbove(ctx, this, L)') < veil,
        'authored bright hazards moved out of the world pass');
    assert(renderSource.includes('if (highContrast) this.hazardSystem.drawContrastOverlay(ctx, this);'),
        'normal mode can enter the high-contrast hazard overlay');
    assert(renderSource.includes('!enemy.active || !cull(enemy)'),
        'post-veil enemy cues are not visibility/active-state aware');
    for (const important of ['enemy.boss', 'enemy.lieutenant', 'enemy.encounterGuardian', 'enemy === this.focusTarget']) {
        assert(renderSource.includes(important), `full status cues are not wired for ${important}`);
    }
    assert(renderSource.includes('combatStatusCueSize(') && renderSource.includes('this.renderer?.cssWidth'),
        'status badge size is not derived from save UI scale and renderer CSS footprint');

    assert(!Enemy.prototype.draw.toString().includes('strokeHighContrastPath'),
        'normal Enemy.draw still contains high-contrast overdraw');
    assert(!HazardSystem.prototype.drawGround.toString().includes('strokeHighContrastPath'),
        'normal drawGround still contains high-contrast overdraw');
    assert(!HazardSystem.prototype.drawAbove.toString().includes('strokeHighContrastPath'),
        'normal drawAbove still contains high-contrast overdraw');
}

function validateProfilerRegistration() {
    assert(PROFILER_BUCKETS.includes('combatCues'),
        'combat cue render pass is missing from the fixed profiler bucket registry');
    const profiler = new FrameProfiler();
    profiler.enabled = true;
    profiler.begin('combatCues');
    profiler.end('combatCues');
    assert(Number.isFinite(profiler._acc.combatCues),
        'combat cue profiler accumulation became non-finite in dev mode');
    profiler.frame();
    assert(Number.isFinite(profiler.ema.combatCues),
        'combat cue profiler EMA became non-finite in dev mode');
}

function validateAllocationAndDenseSwarmBudget() {
    const hotSources = [
        Enemy.prototype.drawStatusCues.toString(),
        Enemy.prototype.drawCombatCueOverlay.toString(),
        Enemy.prototype.drawWindupContrastCue.toString(),
        HazardSystem.prototype.drawContrastOverlay.toString(),
        drawCachedStatusGlyph.toString(),
    ];
    for (const source of hotSources) {
        for (const forbidden of ['.map(', '.filter(', '.reduce(', 'new Array', 'new Map', 'new Set', 'Object.create']) {
            assert(!source.includes(forbidden), `combat cue hot path contains per-frame collection work: ${forbidden}`);
        }
    }

    // At the hard 180-enemy cap, all seven active statuses on trash collapse
    // to exactly three cached bitmap blits each: 540 Canvas2D operations total.
    const ctx = makeContext();
    const enemy = allStatusEnemy();
    const budget = 180 * TRASH_STATUS_CUE_LIMIT;
    for (let i = 0; i < 180; i++) {
        Enemy.prototype.drawStatusCues.call(enemy, ctx, true, 24, TRASH_STATUS_CUE_LIMIT);
    }
    const images = ctx.events.filter((event) => event.type === 'image').length;
    assert(images === budget, `dense swarm emitted ${images} bitmap ops instead of ${budget}`);
    assert(ctx.events.length <= budget,
        `dense swarm exceeded its ${budget}-operation Canvas2D status budget (${ctx.events.length})`);
}

validateSourceBackedStatusVocabulary();
validateCssReadableSizing();
validateEnemyStatusDispatch();
validateEnemyWindupOverlay();
validateHazardVocabulary();
validateCompositeOrderAndNormalIsolation();
validateProfilerRegistration();
validateAllocationAndDenseSwarmBudget();

console.log(
    `combat cue validation: OK - ${checks} checks; credited source-backed statuses, ` +
    'post-veil ordering, normal-mode isolation, and a 540-op dense-swarm cap are enforced.',
);
