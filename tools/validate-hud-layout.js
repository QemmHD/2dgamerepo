#!/usr/bin/env node
// Pure HUD geometry regression gate. This intentionally boots no DOM/canvas:
// every persistent surface is allocated by HUDLayout and checked across the
// desktop, compact, touch, boss, gauntlet, and safe-inset combinations that
// previously produced top-centre and phone-left collisions.

import { readFileSync } from 'node:fs';
import { computeHUDLayout, hudRectsOverlap } from '../src/systems/HUDLayout.js';
import { fitHudLabel, wrapText } from '../src/systems/UISystem.js';

let checks = 0;
let failures = 0;
const ok = (condition, message) => {
    checks++;
    if (!condition) {
        failures++;
        console.error(`  x ${message}`);
    }
};

const safeAreas = [
    { name: 'none', top: 0, right: 0, bottom: 0, left: 0 },
    { name: 'landscape-notch', top: 24, right: 100, bottom: 24, left: 100 },
    { name: 'left-notch', top: 18, right: 0, bottom: 18, left: 100 },
];
const modes = [
    { name: 'desktop', compact: false, touchMode: false },
    { name: 'desktop-1280', compact: false, touchMode: false, cssScale: 1280 / 1920 },
    { name: 'compact', compact: true, touchMode: false },
    { name: 'touch', compact: true, touchMode: true },
    { name: 'phone-667', compact: true, touchMode: true, cssScale: 667 / 1920 },
];
const encounters = [
    { name: 'field', hasBoss: false, hasLieutenant: false, hasBossRush: false },
    { name: 'lieutenant', hasBoss: false, hasLieutenant: true, hasBossRush: false },
    { name: 'boss', hasBoss: true, hasLieutenant: false, hasBossRush: false },
    { name: 'boss-rush-stack', hasBoss: true, hasLieutenant: true, hasBossRush: true },
];
const uiScales = [100, 115, 130];

function active(rect) {
    return rect && rect.w > 0 && rect.h > 0;
}

function inside(rect, layout) {
    if (!active(rect)) return true;
    const { left, right, top, bottom } = layout.safe;
    return rect.x >= left
        && rect.y >= top
        && rect.x + rect.w <= layout.width - right
        && rect.y + rect.h <= layout.height - bottom;
}

function near(a, b, epsilon = 0.001) {
    return Math.abs(a - b) <= epsilon;
}

let scenarios = 0;
for (const safeArea of safeAreas) {
    for (const mode of modes) {
        for (const encounter of encounters) {
          for (const uiScale of uiScales) {
            scenarios++;
            const name = `${mode.name}/${encounter.name}/${safeArea.name}/${uiScale}%`;
            const options = {
                width: 1920,
                height: 1080,
                safeArea,
                ...mode,
                ...encounter,
                loadoutCount: 15,
                relicCount: 9,
                abilityCount: 8,
                hasVigil: true,
                uiScale,
                cssScale: mode.cssScale ?? (mode.compact ? 1280 / 1920 : 1),
            };
            const hud = computeHUDLayout(options);
            const baseline = computeHUDLayout({ ...options, uiScale: 100 });

            ok(hud.uiScale === uiScale / 100, `${name}: UI scale factor was not preserved`);
            ok(hud.header.h >= baseline.header.h, `${name}: command rail did not reserve scaled text height`);
            if (encounter.hasBoss) {
                ok(hud.boss.h >= baseline.boss.h, `${name}: boss plate did not reserve scaled text height`);
            }
            // Combat HUD scale cannot move input/world anchors. Pause, vitals,
            // and Kindle rectangles remain byte-stable while their text grows.
            for (const key of ['pause', 'vitals', 'kindle', 'caption']) {
                ok(JSON.stringify(hud[key]) === JSON.stringify(baseline[key]),
                    `${name}: ${key} geometry changed with text scale`);
            }

            // Every 115/130% command rail is two deterministic vertical
            // lanes, not one enlarged row whose wave copy can collide with the
            // timer, counters, or THREAT strip.
            const command = hud.command;
            ok(command.primaryTop >= hud.header.y && command.primaryBottom <= hud.header.y + hud.header.h,
                `${name}: command primary lane escapes its rail`);
            ok(command.identityTop >= hud.header.y && command.identityBottom <= hud.header.y + hud.header.h,
                `${name}: command identity lane escapes its rail`);
            ok(command.timerMaxW > 0 && command.countersMaxW > 0 && command.identityMaxW > 0,
                `${name}: command text lanes lack deterministic width bounds`);
            if (uiScale > 100) {
                ok(command.split === true, `${name}: scaled command rail did not split lanes`);
                ok(command.primaryBottom < command.identityTop,
                    `${name}: timer/counter lane overlaps wave identity lane`);
                ok(command.timerX + command.timerMaxW <= command.countersRight - command.countersMaxW,
                    `${name}: timer and counter horizontal bounds overlap`);
                const identityLimit = active(hud.threat) ? hud.threat.y : hud.header.y + hud.header.h;
                ok(command.identityBottom <= identityLimit,
                    `${name}: wave identity collides with THREAT or rail edge`);
            } else {
                ok(command.split === false && near(command.primaryY, command.identityY),
                    `${name}: legacy command row moved without a scale request`);
            }

            ok(near(hud.vigil.w, baseline.vigil.w * hud.uiScale)
                && near(hud.vigil.h, baseline.vigil.h * hud.uiScale),
            `${name}: Living Vigil allocation did not scale from its 100% footprint`);
            ok(near(hud.vigil.x + hud.vigil.w, baseline.vigil.x + baseline.vigil.w),
                `${name}: Living Vigil lost its stable right-edge anchor`);
            ok(near(hud.vigil.uiScale, hud.uiScale),
                `${name}: Living Vigil allocation did not expose its render scale`);

            const abilities = hud.abilities;
            ok(abilities.pipRadius * 2 + abilities.pipGap === abilities.pipPitch,
                `${name}: ability center pitch does not match diameter plus gap`);
            ok(abilities.labelMaxW <= abilities.pipPitch,
                `${name}: ability label bound exceeds its deterministic pitch`);
            ok(abilities.count === (mode.touchMode ? 7 : 8),
                `${name}: ability count does not match the rendered cooldown row`);
            ok(near(abilities.w, abilities.count * abilities.pipPitch + 6),
                `${name}: ability allocation width no longer matches its center pitch`);
            if (abilities.count > 1) {
                const rightCenter = abilities.x + abilities.w - abilities.pipRadius;
                const nextCenter = rightCenter - abilities.pipPitch;
                ok(near(rightCenter - nextCenter, abilities.pipPitch),
                    `${name}: adjacent ability centers drift from their declared pitch`);
            }

            for (const key of [
                'header', 'boss', 'lieutenant', 'bossRush', 'vitals',
                'loadout', 'pause', 'combo', 'abilities', 'kindle',
                'vigil',
                'caption',
            ]) {
                ok(inside(hud[key], hud), `${name}: ${key} escapes the safe viewport`);
            }

            ok(!hudRectsOverlap(hud.header, hud.pause, 8), `${name}: command rail overlaps pause`);
            ok(!hudRectsOverlap(hud.header, hud.boss, 8), `${name}: command rail overlaps boss plate`);
            ok(!hudRectsOverlap(hud.boss, hud.lieutenant, 6), `${name}: boss overlaps lieutenant`);
            ok(!hudRectsOverlap(hud.boss, hud.bossRush, 6), `${name}: boss overlaps boss-rush status`);
            ok(!hudRectsOverlap(hud.lieutenant, hud.bossRush, 6), `${name}: lieutenant overlaps boss-rush status`);
            ok(!hudRectsOverlap(hud.header, hud.vitals, 8), `${name}: command rail overlaps vitals`);
            ok(!hudRectsOverlap(hud.header, hud.loadout, 8), `${name}: command rail overlaps loadout`);
            ok(!hudRectsOverlap(hud.boss, hud.vitals, 8), `${name}: boss plate overlaps vitals`);
            ok(!hudRectsOverlap(hud.boss, hud.loadout, 8), `${name}: boss plate overlaps loadout`);
            ok(!hudRectsOverlap(hud.vitals, hud.loadout, 8), `${name}: vitals overlap loadout`);
            ok(!hudRectsOverlap(hud.abilities, hud.kindle, 4), `${name}: abilities overlap Kindle meter`);
            ok(!hudRectsOverlap(hud.caption, hud.abilities, 8), `${name}: captions overlap ability controls`);
            ok(!hudRectsOverlap(hud.caption, hud.vitals, 8), `${name}: captions overlap vitals`);
            ok(!hudRectsOverlap(hud.caption, hud.kindle, 8), `${name}: captions overlap Kindle meter`);
            ok(hud.caption.textPx * hud.caption.cssScale >= 15.99,
                `${name}: caption type falls below 16 CSS pixels`);
            ok(hud.caption.labelPx * hud.caption.cssScale >= 15.99,
                `${name}: caption speaker label falls below 16 CSS pixels`);
            ok(hud.caption.h >= hud.caption.padY * 2 + hud.caption.labelPx
                + hud.caption.gap + hud.caption.lineHeight * 2,
            `${name}: caption plate cannot contain its label and two body lines`);
            ok(!hudRectsOverlap(hud.vigil, hud.pause, 8), `${name}: Living Vigil overlaps pause`);
            ok(!hudRectsOverlap(hud.vigil, hud.combo, 8), `${name}: Living Vigil overlaps combo`);
            ok(!hudRectsOverlap(hud.vigil, hud.header, 8), `${name}: Living Vigil overlaps command rail`);
            ok(!hudRectsOverlap(hud.vigil, hud.boss, 6), `${name}: Living Vigil overlaps boss plate`);
            ok(!hudRectsOverlap(hud.vigil, hud.lieutenant, 6), `${name}: Living Vigil overlaps lieutenant`);
            ok(!hudRectsOverlap(hud.vigil, hud.bossRush, 6), `${name}: Living Vigil overlaps boss-rush status`);
            ok(!hudRectsOverlap(hud.vigil, hud.abilities, 6), `${name}: Living Vigil overlaps abilities`);

            const objectiveHud = computeHUDLayout({
                ...options,
                hasObjective: true,
                hasVigil: false,
            });
            ok(active(objectiveHud.objective) && !active(objectiveHud.vigil),
                `${name}: Run Path did not become the sole guidance owner`);
            ok(inside(objectiveHud.objective, objectiveHud),
                `${name}: Run Path escapes the safe viewport`);
            ok(objectiveHud.objective.metaPx * objectiveHud.cssScale >= 15.99,
                `${name}: Run Path phase text falls below 16 CSS pixels`);
            ok(objectiveHud.objective.bodyPx * objectiveHud.cssScale >= 15.99,
                `${name}: Run Path action text falls below 16 CSS pixels`);
            ok(objectiveHud.objective.progressPx * objectiveHud.cssScale >= 15.99,
                `${name}: Run Path progress text falls below 16 CSS pixels`);
            ok(objectiveHud.objective.titlePx * objectiveHud.cssScale >= 16.99,
                `${name}: Run Path title falls below 17 CSS pixels`);
            const objective = objectiveHud.objective;
            const objectiveLanes = objective.lanes;
            ok(!!objectiveLanes && Number.isFinite(objectiveLanes.bodyY)
                && Number.isFinite(objectiveLanes.barY)
                && Number.isFinite(objectiveLanes.footerY),
            `${name}: Run Path omitted its shared internal lane contract`);
            for (const key of ['pause', 'combo', 'header', 'boss', 'lieutenant', 'bossRush', 'abilities']) {
                ok(!hudRectsOverlap(objective, objectiveHud[key], 6),
                    `${name}: Run Path overlaps ${key}`);
            }

            if (objective.phone) {
                const scaleToCss = objectiveHud.cssScale;
                const usableCenter = safeArea.left
                    + (objectiveHud.width - safeArea.left - safeArea.right) / 2;
                const rightEdge = objectiveHud.width - safeArea.right - 38;
                const bodyBottom = objectiveLanes.bodyY
                    + objectiveLanes.bodyLineHeight * (objectiveLanes.bodyLines - 1)
                    + objective.bodyPx;
                const footerTop = objectiveLanes.footerY - objective.progressPx / 2;
                const footerBottom = objectiveLanes.footerY + objective.progressPx / 2;

                ok(near(objective.x + objective.w, rightEdge),
                    `${name}: phone Run Path lost its exact right-edge dock`);
                ok((objective.x - usableCenter) * scaleToCss >= 39.99,
                    `${name}: phone Run Path entered the 40 CSS-pixel player keepout`);
                ok(objective.dense === false,
                    `${name}: phone Run Path regressed to the centered dense slab`);
                ok(objectiveLanes.bodyBarGap * scaleToCss >= 5.99,
                    `${name}: phone Run Path body does not clear its progress bar by 6 CSS pixels`);
                ok(objectiveLanes.barFooterGap * scaleToCss >= 5.99,
                    `${name}: phone Run Path progress bar does not clear its reward by 6 CSS pixels`);
                ok(bodyBottom <= objectiveLanes.barY,
                    `${name}: phone Run Path body crosses its progress-bar lane`);
                ok(objectiveLanes.barY + objectiveLanes.barH <= footerTop,
                    `${name}: phone Run Path progress bar crosses its reward lane`);
                ok(footerBottom <= objective.y + objective.h - objectiveLanes.pad + 0.001,
                    `${name}: phone Run Path reward escapes its bottom padding`);

                if (objective.edgeCompact) {
                    const centralRight = Math.max(
                        objectiveHud.header.x + objectiveHud.header.w,
                        ...['boss', 'lieutenant', 'bossRush']
                            .filter((key) => active(objectiveHud[key]))
                            .map((key) => objectiveHud[key].x + objectiveHud[key].w),
                    );
                    ok(objective.w * scaleToCss >= 159.9,
                        `${name}: combat Run Path rail is narrower than 160 CSS pixels`);
                    ok(objective.h * scaleToCss >= 139,
                        `${name}: combat Run Path rail is shorter than 139 CSS pixels`);
                    ok(objective.x > centralRight,
                        `${name}: combat Run Path rail enters a central boss/status plate`);
                    ok((objectiveHud.abilities.y - (objective.y + objective.h)) * scaleToCss >= 3.99,
                        `${name}: combat Run Path rail does not clear abilities by 4 CSS pixels`);
                    ok(objectiveLanes.bodyLines === 4
                        && objectiveLanes.showTitle === false
                        && objectiveLanes.showContext === false,
                    `${name}: combat Run Path rail lost its complete four-line action priority`);
                } else {
                    ok(objective.h * scaleToCss >= 133.9,
                        `${name}: phone Run Path cannot contain its three-line action contract`);
                    ok(objectiveLanes.bodyLines === 3
                        && objectiveLanes.showTitle === true
                        && objectiveLanes.showContext === true,
                    `${name}: normal phone Run Path lost its sequential content lanes`);
                }

                if (encounter.hasBoss && encounter.hasBossRush && uiScale === 130) {
                    ok(objective.edgeCompact === true,
                        `${name}: stacked 130% duel did not enter the edge combat rail`);
                }
            }

            if (objectiveLanes.compressed) {
                const scaleToCss = objectiveHud.cssScale;
                const titleBottom = objectiveLanes.titleY + objective.titlePx / 2;
                ok(objective.compressed === true && objective.dense === false,
                    `${name}: compressed Run Path did not retain its standard-card contract`);
                ok(objective.h * scaleToCss >= 139.9,
                    `${name}: compressed Run Path is shorter than 140 CSS pixels`);
                ok(objectiveLanes.bodyBarGap * scaleToCss >= 5.99,
                    `${name}: compressed Run Path body does not clear its bar by 6 CSS pixels`);
                ok(objectiveLanes.barFooterGap * scaleToCss >= 5.99,
                    `${name}: compressed Run Path bar does not clear its footer by 6 CSS pixels`);
                ok((objectiveLanes.bodyY - titleBottom) * scaleToCss >= 2.99,
                    `${name}: compressed Run Path body does not clear its title by 3 CSS pixels`);
            }

            // Touch removes Blink from the passive cooldown row because its
            // action-disc rim is already the meter; geometry must reflect it.
            if (mode.touchMode) {
                const compactHud = computeHUDLayout({
                    width: 1920, height: 1080, safeArea,
                    compact: true, touchMode: false, abilityCount: 8, uiScale,
                });
                ok(hud.abilities.w < compactHud.abilities.w,
                    `${name}: touch ability row did not remove duplicate Blink`);
                ok(!active(hud.kindle), `${name}: touch still allocates duplicate Kindle bar`);
            }
          }
        }
    }
}

ok(!active(computeHUDLayout({ hasVigil: false }).vigil), 'disabled Living Vigil still allocates HUD space');
ok(!active(computeHUDLayout({ hasObjective: false }).objective), 'disabled Run Path still allocates HUD space');

const wrapped = [];
const wrapCtx = {
    measureText: (text) => ({ width: String(text).length * 10 }),
    fillText: (text) => wrapped.push(text),
};
const exactWrap = wrapText(wrapCtx, 'one two three', 0, 0, 80, 20, 2);
ok(wrapped.join('|') === 'one two|three',
    'an exact two-line caption is not given a false ellipsis');
ok(exactWrap.truncated === false,
    'an exact two-line wrap reported a false truncation receipt');
wrapped.length = 0;
const truncatedWrap = wrapText(wrapCtx, 'one two three four', 0, 0, 80, 20, 2);
ok(wrapped.join('|') === 'one two|three…',
    'a genuinely truncated two-line caption receives one ellipsis');
ok(truncatedWrap.truncated === true,
    'an ellipsized wrap omitted its truncation receipt');

// Canvas-measured fitting is tested with a font-aware deterministic context.
// Character-count truncation cannot satisfy these contracts because font size
// and the actual allocated pixel width both affect the result.
class MeasureContext {
    constructor() { this.font = '16px sans-serif'; }
    measureText(text) {
        const size = Number.parseFloat(/([\d.]+)px/.exec(this.font)?.[1] || '16');
        return { width: String(text).length * size * 0.58 };
    }
}

const measureCtx = new MeasureContext();
const fitLayout = computeHUDLayout({
    width: 1920, height: 1080, compact: true, uiScale: 130,
    abilityCount: 8, hasVigil: true,
});
const longWave = 'WAVE 128 · THE EVERLASTING CINDER PROCESSION OF THE BLACK SUN';
const waveFit = fitHudLabel(measureCtx, longWave, fitLayout.command.identityMaxW, {
    weight: 700, size: 29, minSize: 21, family: 'system-ui',
});
ok(waveFit.width <= fitLayout.command.identityMaxW,
    'measured wave label exceeds its allocated pixel bound');
ok(waveFit.truncated && waveFit.text.endsWith('…') && waveFit.text !== longWave,
    'oversized wave identity was not ellipsized by measured width');
ok(near(measureCtx.measureText(waveFit.text).width, waveFit.width),
    'wave fitting result does not match the final Canvas font');

const longAbility = 'ASTRAL RECKONING';
const abilityFit = fitHudLabel(measureCtx, longAbility, fitLayout.abilities.labelMaxW, {
    weight: 600, size: 20, minSize: 16, family: 'system-ui',
});
ok(abilityFit.width <= fitLayout.abilities.labelMaxW,
    'measured ability label exceeds one declared ability pitch');
ok(abilityFit.truncated && abilityFit.text.endsWith('…'),
    'oversized ability label was not ellipsized by measured width');
const shortFit = fitHudLabel(measureCtx, 'WAVE 2', fitLayout.command.identityMaxW, {
    weight: 700, size: 29, minSize: 21, family: 'system-ui',
});
ok(shortFit.text === 'WAVE 2' && shortFit.truncated === false,
    'short wave label was changed despite fitting its pixel bound');

// Exact visual-QA viewport: a 1920x1080 logical canvas shown at 1280x720 CSS
// remains in desktop mode. At 130%, its measured wave bounds must occupy the
// identity lane below (never beside/touching) the KILLS/counter lane.
const visualQaCss = { width: 1280, height: 720 };
const visualQaLayout = computeHUDLayout({
    width: 1920, height: 1080, compact: false, touchMode: false,
    uiScale: 130, abilityCount: 8, hasVigil: true,
});
const visualQaWave = fitHudLabel(measureCtx, 'WAVE 18 · CINDER PROCESSION',
    visualQaLayout.command.identityMaxW, {
        weight: 700, size: 25, minSize: 18, family: 'system-ui',
    });
const cssX = visualQaCss.width / visualQaLayout.width;
const cssY = visualQaCss.height / visualQaLayout.height;
const waveCssBounds = {
    x: (visualQaLayout.command.identityX - visualQaWave.width / 2) * cssX,
    y: (visualQaLayout.command.identityY - visualQaWave.fontSize / 2) * cssY,
    w: visualQaWave.width * cssX,
    h: visualQaWave.fontSize * cssY,
};
const counterCssLane = {
    x: (visualQaLayout.command.countersRight - visualQaLayout.command.countersMaxW) * cssX,
    y: visualQaLayout.command.primaryTop * cssY,
    w: visualQaLayout.command.countersMaxW * cssX,
    h: (visualQaLayout.command.primaryBottom - visualQaLayout.command.primaryTop) * cssY,
};
ok(visualQaLayout.command.split && visualQaLayout.compact === false,
    '1280x720 CSS desktop fixture did not activate scaled command lanes');
ok(visualQaWave.width <= visualQaLayout.command.identityMaxW,
    '1280x720 CSS desktop wave exceeds its measured identity bound');
ok(!hudRectsOverlap(waveCssBounds, counterCssLane),
    '1280x720 CSS desktop wave still touches the KILLS/counter lane at 130%');

const uiSource = readFileSync(new URL('../src/systems/UISystem.js', import.meta.url), 'utf8');
ok(!/for \(const layer of \[\s*\{/.test(uiSource),
    'player locator reintroduced a per-frame layer array/object allocation');
ok(/fitHudLabel\(ctx, waveText/.test(uiSource) && /fitHudLabel\(ctx, a\.name/.test(uiSource),
    'wave and ability labels are not both wired to measured fitting');
ok(/const lanes = r\.lanes/.test(uiSource)
    && /lanes\.bodyY/.test(uiSource)
    && /lanes\.barY/.test(uiSource)
    && /lanes\.footerY/.test(uiSource),
    'Run Path renderer is not consuming HUDLayout-owned body/bar/footer lanes');

if (failures) {
    console.error(`HUD layout validation failed: ${failures}/${checks} checks across ${scenarios} scenarios.`);
    process.exit(1);
}
console.log(`HUD layout validation passed: ${checks} checks across ${scenarios} scenarios.`);
