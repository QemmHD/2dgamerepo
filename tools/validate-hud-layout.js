#!/usr/bin/env node
// Pure HUD geometry regression gate. This intentionally boots no DOM/canvas:
// every persistent surface is allocated by HUDLayout and checked across the
// desktop, compact, touch, boss, gauntlet, and safe-inset combinations that
// previously produced top-centre and phone-left collisions.

import { readFileSync } from 'node:fs';
import {
    computeHUDLayout,
    hudRectsOverlap,
    phoneHUDControlSize,
} from '../src/systems/HUDLayout.js';
import { UISystem, fitHudLabel, wrapText } from '../src/systems/UISystem.js';
import { RUN_OBJECTIVE_CANDIDATES } from '../src/content/objectives.js';
import { RUIN_BELL_CONTRACT } from '../src/content/ruinBell.js';
import { isPhoneLandscapeViewport } from '../src/systems/ResponsiveLayout.js';
import { Renderer } from '../src/systems/Renderer.js';
import { ruinBellObjectiveSnapshot } from '../src/systems/UIStateBuilder.js';

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
                ok(objective.mobileChip === true,
                    `${name}: phone Run Path did not use the compact edge-chip contract`);
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
                    ok(objective.h * scaleToCss >= 111.9,
                        `${name}: phone Run Path cannot contain its compact three-line action contract`);
                    ok(objectiveLanes.bodyLines === 3
                        && objectiveLanes.showTitle === false
                        && objectiveLanes.showContext === false,
                    `${name}: normal phone Run Path lost its playfield-safe chip lanes`);
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
                if (objective.narrowCompressed) {
                    ok(objective.h * scaleToCss >= 163.9,
                        `${name}: narrow compressed Run Path is shorter than 164 CSS pixels`);
                    ok(objectiveLanes.bodyLines === 3,
                        `${name}: narrow compressed Run Path lacks its third action line`);
                }
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
    fillText() {}
    measureText(text) {
        const size = Number.parseFloat(/([\d.]+)px/.exec(this.font)?.[1] || '16');
        return { width: String(text).length * size * 0.58 };
    }
}

const measureCtx = new MeasureContext();

// Linux runners can resolve system-ui to a wider face than Windows. Prove all
// authored tasks fit the exact narrow-compressed contract with deliberately
// conservative glyph metrics, rather than trusting one host font.
const narrowObjectiveLayout = computeHUDLayout({
    width: 1920, height: 1080, compact: false, touchMode: false,
    cssScale: 1280 / 1920, uiScale: 100, hasObjective: true,
});
class WideMeasureContext extends MeasureContext {
    measureText(text) {
        const size = Number.parseFloat(/([\d.]+)px/.exec(this.font)?.[1] || '16');
        return { width: String(text).length * size * 0.62 };
    }
}
const wideMeasureCtx = new WideMeasureContext();

// Real-device correction gate. Renderer CSS-rotates 390x844 portrait and
// leaves 844x390 landscape alone, but both resolve the same 844x474.75 COVER
// canvas with 42.375 CSS pixels cropped from its top and bottom. Classify the
// HUD from that resolved canvas instead of the former <=700 screenshot width.
const realPhoneFixtures = [
    { name: '390x844 portrait (CSS-rotated)', physicalW: 390, physicalH: 844, rotated: true },
    { name: '844x390 landscape', physicalW: 844, physicalH: 390, rotated: false },
];
const phoneCanvasW = 844;
const phoneVisibleH = 390;
const phoneCanvasH = phoneCanvasW * 9 / 16;
const phoneCssScale = phoneCanvasW / 1920;
const phoneCropInternal = ((phoneCanvasH - phoneVisibleH) / 2) / phoneCssScale;
const phoneSafeArea = { top: phoneCropInternal, right: 0, bottom: phoneCropInternal, left: 0 };
ok(isPhoneLandscapeViewport(phoneCanvasW, phoneCanvasH),
    '844px COVER canvas is not classified as a landscape phone');
ok(phoneHUDControlSize(phoneCssScale) * phoneCssScale >= 43.99,
    'phone HUD control sizing does not preserve a 44 CSS-pixel target');

for (const fixture of realPhoneFixtures) {
    ok(fixture.rotated === (fixture.physicalH > fixture.physicalW),
        `${fixture.name}: portrait/landscape rotation premise drifted`);
    for (const uiScale of [100, 130]) {
        for (const hasBoss of [false, true]) {
            const name = `${fixture.name}/${uiScale}%/${hasBoss ? 'boss' : 'field'}`;
            const hud = computeHUDLayout({
                width: 1920, height: 1080, safeArea: phoneSafeArea,
                compact: true, touchMode: true, phoneViewport: true,
                objectiveOwner: 'ruin-bell', uiScale, cssScale: phoneCssScale,
                hasObjective: true, hasBoss, abilityCount: 8,
            });
            const objective = hud.objective;
            const header = hud.header;
            const command = hud.command;
            const visibleHeaderY = (header.y - phoneSafeArea.top) * phoneCssScale;
            const headerBottom = visibleHeaderY + header.h * phoneCssScale;

            ok(objective.integrated === true && objective.phone === true
                && objective.ruinBellRail === true && objective.mobileChip === false,
            `${name}: Ruin Bell did not integrate with the phone command rail`);
            ok(objective.w === 0 && objective.h === 0,
                `${name}: Ruin Bell still allocates a separate playfield card`);
            ok(command.mobileBellObjective === true && header.mobileBellRail === true,
                `${name}: command rail omitted its Ruin Bell ownership`);
            ok(inside(header, hud), `${name}: Bell command rail escapes COVER safe area`);
            ok(!hudRectsOverlap(header, hud.vitals, 7 / phoneCssScale),
                `${name}: Bell command rail overlaps vitals`);
            ok(!hudRectsOverlap(header, hud.pause, 7 / phoneCssScale),
                `${name}: Bell command rail overlaps pause`);
            ok(header.h * phoneCssScale >= 71.9
                && header.h * phoneCssScale <= 72.5,
            `${name}: Bell command rail is not the bounded 72 CSS-pixel surface`);
            ok(visibleHeaderY >= 0 && headerBottom <= 76.6,
                `${name}: Bell command rail is not confined to the existing top HUD band`);
            ok(!active(hud.threat) && !active(hud.combo),
                `${name}: irrelevant THREAT/combo UI remains active during Bell rail mode`);
            ok(objective.metaPx * phoneCssScale >= 15.99
                && objective.bodyPx * phoneCssScale >= 15.99
                && objective.progressPx * phoneCssScale >= 15.99,
            `${name}: Bell command rail falls below the 16 CSS-pixel type floor`);
            ok(command.bellMetaPx * phoneCssScale >= 15.99
                && command.bellActionPx * phoneCssScale >= 15.99,
            `${name}: essential Bell rail copy falls below 16 CSS pixels`);
            ok(hud.pause.w * phoneCssScale >= 43.99
                && hud.pause.h * phoneCssScale >= 43.99,
            `${name}: pause control falls below the 44 CSS-pixel touch target`);
            ok(command.bellBar.x >= header.x
                && command.bellBar.x + command.bellBar.w <= header.x + header.w
                && command.bellBar.y >= header.y
                && command.bellBar.y + command.bellBar.h <= header.y + header.h,
            `${name}: Bell progress escapes the integrated command rail`);
            if (hasBoss) {
                ok(!hudRectsOverlap(header, hud.boss, 6),
                    `${name}: Bell command rail overlaps boss plate`);
            }
        }
    }
}

// Exercise the production UISystem seam too: its runtime phone classifier,
// objective owner handoff, visual pause rect and input hit rect must resolve to
// the same layout that the pure allocator proved above.
const phoneUi = new UISystem({
    renderer: {
        cssWidth: phoneCanvasW,
        cssHeight: phoneCanvasH,
        safeArea: phoneSafeArea,
    },
    loop: {},
});
const phoneUiState = {
    touchMode: true,
    activeBoss: null,
    activeLieutenant: null,
    bossRush: null,
    runObjective: { owner: 'ruin-bell' },
    vigilTracker: null,
    ownedWeapons: [], ownedPassives: [], runRelics: [], abilityCooldowns: [],
    saveData: { settings: { uiScale: 130 } },
};
const runtimePhoneHud = phoneUi.getHUDLayout(phoneUiState);
const runtimePause = phoneUi.getPauseButtonRect();
ok(runtimePhoneHud.objective.integrated
    && runtimePhoneHud.objective.ruinBellRail
    && runtimePhoneHud.command.mobileBellObjective
    && runtimePhoneHud.objective.w === 0 && runtimePhoneHud.objective.h === 0,
'production UISystem did not integrate Bell into the 844px phone command rail');
ok(near(runtimePause.x, runtimePhoneHud.pause.x)
    && near(runtimePause.y, runtimePhoneHud.pause.y)
    && near(runtimePause.w, runtimePhoneHud.pause.w)
    && near(runtimePause.h, runtimePhoneHud.pause.h),
'production pause visual allocation and input hit target diverge on phone');
ok(runtimePause.w * phoneCssScale >= 43.99,
    'production phone pause hit target falls below 44 CSS pixels');

// The integrated rail must fit every compact but complete Bell action at the
// fixed 16 CSS-pixel floor under conservative Linux glyph metrics.
const narrowBellHud = computeHUDLayout({
    width: 1920, height: 1080, safeArea: phoneSafeArea,
    compact: true, touchMode: true, phoneViewport: true,
    objectiveOwner: 'ruin-bell', uiScale: 100, cssScale: phoneCssScale,
    hasObjective: true, abilityCount: 8,
});
ok(narrowBellHud.objective.integrated
    && narrowBellHud.command.mobileBellObjective,
    'narrow real-phone fixture did not enter integrated Bell rail mode');
const activeBellObjective = ruinBellObjectiveSnapshot({
    screen: 'gameplay', input: { isTouchMode: () => true },
}, {
    visible: true, phase: 'active', urgent: true, inActivationRange: true,
    attempt: 1, maxAttempts: 2, title: 'RUIN BELL',
    nextAction: RUIN_BELL_CONTRACT.copy.active, current: 0, target: 11,
    countdown: 60, rewardLabel: RUIN_BELL_CONTRACT.reward.label, accent: '#ffad5a',
});
ok(activeBellObjective?.headerLabel === 'BELL · TRY 1/2'
    && activeBellObjective?.compactHeaderLabel === 'BELL · 1/2'
    && activeBellObjective?.compactProgressLabel === '60s·0/11'
    && activeBellObjective?.railStatusLabel === 'BELL 1/2 · 60s·0/11'
    && activeBellObjective?.railActionLabel === 'Defeat all bellbound attackers.',
'Ruin Bell state did not expose complete desktop/command-rail labels');
wideMeasureCtx.font = `850 ${narrowBellHud.command.bellMetaPx}px monospace`;
const railStatusFit = fitHudLabel(
    wideMeasureCtx,
    activeBellObjective.railStatusLabel,
    narrowBellHud.command.identityMaxW,
    { weight: 850, size: narrowBellHud.command.bellMetaPx,
        minSize: narrowBellHud.command.bellMetaPx, family: 'monospace' },
);
wideMeasureCtx.font = `750 ${narrowBellHud.command.bellActionPx}px system-ui`;
const railActionFit = fitHudLabel(
    wideMeasureCtx,
    activeBellObjective.railActionLabel,
    narrowBellHud.command.bellActionMaxW,
    { weight: 750, size: narrowBellHud.command.bellActionPx,
        minSize: narrowBellHud.command.bellActionPx, family: 'system-ui' },
);
ok(!railStatusFit.truncated && !railActionFit.truncated,
    'real-phone Bell rail status/action truncates at the 16 CSS-pixel floor');

const bellRailActionFixtures = [
    ['locked', 'locked', 'locked', 'Unlocks after Vigil 3.', 1, 0, 11, null],
    ['available', 'dormant', 'available', 'Hold by the bell to ring.', 1, 0, 11, null],
    ['arming', 'arming', 'arming', 'Hold position to ring.', 1, 0.6, 1.25, null],
    ['warning', 'warning', 'warning', 'Brace both cabin doors.', 1, 0, 11, 60],
    ['active', 'active', 'active', 'Defeat all bellbound attackers.', 1, 0, 11, 60],
    ['all-defeated-early', 'active', 'allDefeatedEarly', 'Hold cabin until the bell seals.', 1, 11, 11, 8],
    ['return-to-cabin', 'active', 'returnToCabin', 'Return to the cabin now.', 1, 6, 11, 36],
    ['defense-restored', 'active', 'defenseRestored', 'Cabin defense restored.', 1, 6, 11, 35],
    ['technical-defer', 'technical-defer', 'technicalDefer', 'Approach blocked - toll held.', 1, 0, 11, null],
    ['retry-cooldown', 'retry-cooldown', 'retryCooldown', 'Bell relighting.', 1, 0, 11, 3],
    ['retry-ready', 'dormant', 'retryReady', 'Ring again - final attempt.', 2, 0, 11, null],
    ['cleared', 'cleared', 'cleared', '+32 XP · Choose Chest/Wick Shrine.', 1, 11, 11, null],
    ['spent', 'spent', 'spent', 'NO REWARD · Bell silent this run.', 2, 0, 11, null],
];
for (const [name, phase, copyKey, expectedAction, attempt, current, target, countdown]
    of bellRailActionFixtures) {
    const objective = ruinBellObjectiveSnapshot({
        screen: 'gameplay', input: { isTouchMode: () => true },
    }, {
        visible: true,
        phase,
        urgent: true,
        inActivationRange: true,
        rewardClaimed: false,
        attempt,
        maxAttempts: 2,
        title: 'RUIN BELL',
        nextAction: RUIN_BELL_CONTRACT.copy[copyKey],
        current,
        target,
        countdown,
        rewardLabel: RUIN_BELL_CONTRACT.reward.label,
        accent: '#ffad5a',
    });
    ok(objective?.railActionLabel === expectedAction,
        `${name} Bell state lost its authored compact action`);
    const statusFit = fitHudLabel(
        wideMeasureCtx,
        objective?.railStatusLabel,
        narrowBellHud.command.identityMaxW,
        { weight: 850, size: narrowBellHud.command.bellMetaPx,
            minSize: narrowBellHud.command.bellMetaPx, family: 'monospace' },
    );
    const actionFit = fitHudLabel(
        wideMeasureCtx,
        objective?.railActionLabel,
        narrowBellHud.command.bellActionMaxW,
        { weight: 750, size: narrowBellHud.command.bellActionPx,
            minSize: narrowBellHud.command.bellActionPx, family: 'system-ui' },
    );
    ok(!statusFit.truncated && !actionFit.truncated,
        `${name} Bell rail status/action truncates at the 16 CSS-pixel floor`);
}
const spentBellObjective = ruinBellObjectiveSnapshot({
    screen: 'gameplay', input: { isTouchMode: () => true },
}, {
    visible: true, phase: 'spent', urgent: false, inActivationRange: true,
    attempt: 2, maxAttempts: 2, title: 'RUIN BELL',
    nextAction: RUIN_BELL_CONTRACT.copy.spent, current: 0, target: 11,
    rewardLabel: RUIN_BELL_CONTRACT.reward.label, accent: '#a9a1b5',
});
ok(spentBellObjective?.rewardLabel === 'NO COMPLETION REWARD'
    && spentBellObjective?.compactRewardLabel === 'NO REWARD'
    && spentBellObjective?.railStatusLabel === 'BELL LOST · 0/11'
    && spentBellObjective?.railActionLabel === 'NO REWARD · Bell silent this run.',
'spent Ruin Bell still advertises a completion reward');
const clearedBellObjective = ruinBellObjectiveSnapshot({
    screen: 'gameplay', input: { isTouchMode: () => true },
}, {
    visible: true, phase: 'cleared', urgent: false, inActivationRange: true,
    rewardClaimed: false, attempt: 1, maxAttempts: 2, title: 'RUIN BELL',
    nextAction: RUIN_BELL_CONTRACT.copy.cleared, current: 11, target: 11,
    rewardLabel: RUIN_BELL_CONTRACT.reward.label, accent: '#7fe0a0',
});
ok(!/XP|CHEST|SHRINE/i.test(activeBellObjective.railActionLabel)
    && clearedBellObjective?.railStatusLabel === 'BELL HELD · 11/11'
    && clearedBellObjective?.railActionLabel === '+32 XP · Choose Chest/Wick Shrine.',
'phone Bell reward is not disclosed only at the clear/failure truth boundary');

// Renderer owns the orientation lifecycle, not only the art harness. A phone
// that returns to portrait after either landscape direction must immediately
// restore the persistent pill; returning to landscape removes it again.
class TokenList {
    constructor(tokens = []) { this.tokens = new Set(tokens); }
    add(...tokens) { tokens.forEach((token) => this.tokens.add(token)); }
    remove(...tokens) { tokens.forEach((token) => this.tokens.delete(token)); }
    contains(token) { return this.tokens.has(token); }
}
const orientationHintTokens = new TokenList(['hidden']);
const orientationRenderer = Object.create(Renderer.prototype);
orientationRenderer._hintEl = { classList: orientationHintTokens };
orientationRenderer._hintEverShown = true;
orientationRenderer.rotated = true;
orientationRenderer._updateRotateHint();
ok(orientationHintTokens.contains('show') && orientationHintTokens.contains('hidden'),
    'Renderer does not restore the compact rotate affordance on portrait re-entry');
orientationRenderer.rotated = false;
orientationRenderer._updateRotateHint();
ok(!orientationHintTokens.contains('show') && orientationHintTokens.contains('hidden'),
    'Renderer does not remove the rotate affordance after landscape entry');
orientationRenderer.rotated = true;
orientationRenderer._updateRotateHint();
ok(orientationHintTokens.contains('show') && orientationHintTokens.contains('hidden'),
    'Renderer loses the rotate affordance after a second landscape/portrait cycle');

const genericRealPhoneHud = computeHUDLayout({
    width: 1920, height: 1080, safeArea: phoneSafeArea,
    compact: true, touchMode: true, phoneViewport: true,
    objectiveOwner: 'run-path', uiScale: 130, cssScale: phoneCssScale,
    hasObjective: true, abilityCount: 8,
});
ok(genericRealPhoneHud.objective.phone
    && genericRealPhoneHud.objective.mobileChip
    && !genericRealPhoneHud.objective.dense
    && genericRealPhoneHud.objective.lanes.bodyLines === 3
    && genericRealPhoneHud.objective.lanes.showTitle === false
    && genericRealPhoneHud.objective.lanes.showContext === false
    && genericRealPhoneHud.objective.lanes.showBodyLabel === true,
'844x390 generic Run Path did not use the playfield-safe three-line chip');

wideMeasureCtx.font = `700 ${narrowObjectiveLayout.objective.bodyPx}px system-ui`;
for (const tasks of Object.values(RUN_OBJECTIVE_CANDIDATES)) {
    for (const task of tasks) {
        const wrappedAction = wrapText(
            wideMeasureCtx,
            `NEXT · ${task.nextAction}`,
            0,
            0,
            narrowObjectiveLayout.objective.w
                - narrowObjectiveLayout.objective.lanes.pad * 2,
            narrowObjectiveLayout.objective.lanes.bodyLineHeight,
            narrowObjectiveLayout.objective.lanes.bodyLines,
        );
        ok(wrappedAction.truncated === false,
            `1280 narrow compressed Run Path truncates authored task ${task.id}`);
    }
}
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
const productionHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const productionCss = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const harnessSource = readFileSync(new URL('./artshot/harness.html', import.meta.url), 'utf8');
ok(!/for \(const layer of \[\s*\{/.test(uiSource),
    'player locator reintroduced a per-frame layer array/object allocation');
ok(/fitHudLabel\(ctx, waveText/.test(uiSource) && /fitHudLabel\(ctx, a\.name/.test(uiSource),
    'wave and ability labels are not both wired to measured fitting');
ok(/const lanes = r\.lanes/.test(uiSource)
    && /lanes\.bodyY/.test(uiSource)
    && /lanes\.barY/.test(uiSource)
    && /lanes\.footerY/.test(uiSource),
    'Run Path renderer is not consuming HUDLayout-owned body/bar/footer lanes');
ok(/isPhoneLandscapeViewport\(cssW, cssH\)/.test(uiSource)
    && /objectiveOwner: state\.runObjective\?\.owner/.test(uiSource)
    && /phoneViewport,/.test(uiSource),
    'UISystem is not routing the resolved real-phone canvas into HUDLayout');
ok(/objective\.compactHeaderLabel/.test(uiSource)
    && /objective\.compactProgressLabel/.test(uiSource)
    && /objective\.compactRewardLabel/.test(uiSource)
    && /lanes\.showBodyLabel/.test(uiSource),
    'phone objective renderer is not consuming its compact complete-copy contract');
ok(/_hudControlSize\(\)/.test(uiSource)
    && /phoneHUDControlSize\(cssW \/ INTERNAL_WIDTH\)/.test(uiSource)
    && /dbg\.x - dbg\.w - 16/.test(uiSource),
    'visible phone pause/debug controls do not share touch-safe hit geometry');
ok(/id="rotate-hint" role="status" aria-live="polite"/.test(productionHtml)
    && /Rotate to landscape for the full HUD/.test(productionHtml)
    && /#rotate-hint\.show\.hidden/.test(productionCss),
    'production portrait mode does not expose an honest persistent landscape-required status');
ok(/id="rotate-hint" role="status" aria-live="polite"/.test(harnessSource)
    && /qaRotateHint\.classList\.add\('show', 'hidden'\)/.test(harnessSource)
    && /rotateHintOutsideStage/.test(harnessSource),
    'device harness does not mirror and receipt the upright production rotate affordance');

if (failures) {
    console.error(`HUD layout validation failed: ${failures}/${checks} checks across ${scenarios} scenarios.`);
    process.exit(1);
}
console.log(`HUD layout validation passed: ${checks} checks across ${scenarios} scenarios.`);
