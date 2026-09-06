#!/usr/bin/env node
// Production Renderer/UISystem geometry with a deterministic measured Canvas
// context. This is a containment/readability gate, not physical-device proof.
import { Renderer } from '../src/systems/Renderer.js';
import { UISystem } from '../src/systems/UISystem.js';
import { ONBOARDING_LESSONS, OnboardingDirector } from '../src/systems/OnboardingDirector.js';
import { buildRunDebrief } from '../src/systems/RunDebrief.js';
import { isPhoneLandscapeViewport } from '../src/systems/ResponsiveLayout.js';

let checks = 0;
let failures = 0;
let scenarios = 0;
function check(value, label) {
    checks++;
    if (value) return;
    failures++;
    if (failures <= 60) console.error(`FAIL ${label}`);
}
const epsilon = 0.01;
const right = (r) => r.x + r.w;
const bottom = (r) => r.y + r.h;
const inside = (r, outer) => r.x >= outer.x - epsilon && r.y >= outer.y - epsilon
    && right(r) <= right(outer) + epsilon && bottom(r) <= bottom(outer) + epsilon;
const overlaps = (a, b) => a && b && a.w > 0 && a.h > 0 && b.w > 0 && b.h > 0
    && a.x < right(b) - epsilon && right(a) > b.x + epsilon
    && a.y < bottom(b) - epsilon && bottom(a) > b.y + epsilon;

function measuredContext() {
    const state = { font: '16px sans-serif', textAlign: 'left', textBaseline: 'alphabetic' };
    const stack = [];
    const text = [];
    const fontSize = () => Number(state.font.match(/([\d.]+)px/)?.[1] ?? 16);
    const width = (value) => {
        const mono = /monospace|Menlo|SF Mono/.test(state.font);
        return Array.from(String(value)).reduce((sum, char) => sum + (mono ? 0.60
            : /\s/.test(char) ? 0.28 : /[MW@%]/.test(char) ? 0.85
                : /[ilI.,'!:;|]/.test(char) ? 0.27 : /[A-Z0-9]/.test(char) ? 0.63 : 0.52), 0) * fontSize();
    };
    const api = {
        text,
        save() { stack.push({ ...state }); },
        restore() { Object.assign(state, stack.pop() || {}); },
        measureText(value) { return { width: width(value) }; },
        fillText(value, x, y, maxWidth) {
            const size = fontSize();
            const w = Math.min(width(value), Number.isFinite(maxWidth) ? maxWidth : Infinity);
            let left = x;
            if (state.textAlign === 'center') left -= w / 2;
            if (state.textAlign === 'right' || state.textAlign === 'end') left -= w;
            let top = y - size * 0.78;
            if (state.textBaseline === 'middle') top = y - size / 2;
            else if (state.textBaseline === 'top' || state.textBaseline === 'hanging') top = y;
            else if (state.textBaseline === 'bottom') top = y - size;
            text.push({ text: String(value), x: left, y: top, w, h: size, size });
        },
        createLinearGradient: () => ({ addColorStop() {} }),
    };
    return new Proxy(api, {
        get(target, key) { return key in target ? target[key] : key in state ? state[key] : () => {}; },
        set(_target, key, value) { state[key] = value; return true; },
    });
}

const viewports = [
    { width: 480, height: 270 }, { width: 667, height: 375 },
    { width: 844, height: 390 }, { width: 1280, height: 720 },
];
const insets = [
    { name: 'none', top: 0, right: 0, bottom: 0, left: 0 },
    { name: 'safe-insets', top: 6, right: 24, bottom: 6, left: 24 },
];

function productionRenderer(viewport, inset, touch) {
    globalThis.window = {
        innerWidth: viewport.width, innerHeight: viewport.height, devicePixelRatio: 3,
        matchMedia: () => ({ matches: touch }),
    };
    globalThis.document = { documentElement: {} };
    globalThis.getComputedStyle = () => ({
        getPropertyValue: (name) => `${inset[name.replace('--sai-', '')] || 0}px`,
    });
    const renderer = Object.assign(Object.create(Renderer.prototype), {
        internalWidth: 1920, internalHeight: 1080, _dprCap: 3,
        _lockedLandscape: false, rotated: false, _hintEl: false,
        canvas: { style: {}, parentElement: { classList: { toggle() {} } } },
    });
    renderer.resize();
    return renderer;
}
function uiFor(renderer) {
    return Object.assign(Object.create(UISystem.prototype), {
        renderer, _lastDrawReceipt: {}, _reducedEffects: true,
    });
}
function safeRect(renderer) {
    const sa = renderer.safeArea;
    return { x: sa.left, y: sa.top, w: 1920 - sa.left - sa.right, h: 1080 - sa.top - sa.bottom };
}

const causes = [
    null,
    { kind: 'contact', label: 'Slime', contactCount: 1 },
    { kind: 'contact', label: 'The Everlasting Cinder Procession of the Black Sun', contactCount: 12 },
    { kind: 'projectile', label: 'The Everlasting Cinder Procession of the Black Sun' },
    { kind: 'hazard', label: 'a searing beam', hazardKind: 'beam' },
    { kind: 'hazard', label: 'a burning pool', hazardKind: 'lingering' },
    { kind: 'hazard', label: 'a shockwave', hazardKind: 'shockwave' },
    { kind: 'hazard', label: 'the black ice', hazardKind: 'iceSlick' },
];

for (const viewport of viewports) {
    for (const inset of insets) {
        for (const inputMode of ['keyboard', 'touch']) {
            const renderer = productionRenderer(viewport, inset, inputMode === 'touch');
            const cssScale = renderer.cssWidth / 1920;
            const safe = safeRect(renderer);
            const name = `${viewport.width}x${viewport.height}/${inset.name}/${inputMode}`;
            for (const cause of causes) {
                scenarios++;
                const ui = uiFor(renderer);
                const ctx = measuredContext();
                const d = buildRunDebrief({ firstDeath: true,
                    cause: cause ? { ...cause, lethal: true, fresh: true } : null,
                    coinReceipts: { base: 9999999, bonus: 100000, objective: 1000 }, bpResult: { gained: 12345 } });
                ui._drawFirstDeathDebrief(ctx, { gameOverAge: 2, runDebrief: d });
                const receipt = ui._lastDrawReceipt.debrief;
                const label = `${name}/${d.hint.id}`;
                check(!!receipt, `${label}: missing debrief draw receipt`);
                if (!receipt) continue;
                check(inside(receipt.rect, safe), `${label}: debrief escapes visible safe area`);
                check(receipt.textComplete, `${label}: debrief truncates cause or learning hint`);
                check(inside(receipt.button, receipt.rect), `${label}: CTA escapes card`);
                check(Math.abs(receipt.button.h * cssScale - 48) < epsilon, `${label}: CTA is not exactly48 CSSpx high`);
                check(receipt.button.w * cssScale >= 44, `${label}: CTA below44 CSSpx wide`);
                for (const text of ctx.text) {
                    check(inside(text, receipt.rect), `${label}: text escapes card: ${text.text}`);
                }
                const cta = ctx.text.find((entry) => entry.text === d.action.label);
                check(!!cta && inside(cta, receipt.button), `${label}: CTA label escapes hit target`);
                check(JSON.stringify(ui.getDebriefButtonRect()) === JSON.stringify(receipt.button),
                    `${label}: click target differs from painted CTA`);
            }

            for (let lessonIndex = 0; lessonIndex < ONBOARDING_LESSONS.length; lessonIndex++) {
                for (const outcome of [null, 'success', 'deferred']) {
                    for (const uiScale of [100, 130]) {
                        scenarios++;
                        const director = new OnboardingDirector();
                        director.step = lessonIndex;
                        director.outcome = outcome;
                        director.done = outcome === 'success';
                        const snapshot = director.snapshot({ inputMode, kindleReady: false });
                        const state = {
                            onboardingLesson: snapshot, touchMode: inputMode === 'touch',
                            ownedWeapons: Array(6).fill({}), ownedPassives: Array(6).fill({}),
                            runRelics: Array(9).fill({}), abilityCooldowns: Array(8).fill({}),
                            saveData: { settings: { uiScale }, stats: { runs: 0 } },
                        };
                        const ui = uiFor(renderer);
                        const ctx = measuredContext();
                        ui._drawControlHint(ctx, state);
                        const receipt = ui._lastDrawReceipt.onboarding;
                        const label = `${name}/${snapshot.id}/${outcome || 'lesson'}/${uiScale}`;
                        check(!!receipt, `${label}: missing tutorial draw receipt`);
                        if (!receipt) continue;
                        check(receipt.textComplete, `${label}: authored lesson copy is truncated`);
                        check(inside(receipt.rect, safe), `${label}: tutorial escapes visible safe area`);
                        for (const text of ctx.text) {
                            check(inside(text, receipt.rect), `${label}: tutorial text escapes card: ${text.text}`);
                        }
                        if (isPhoneLandscapeViewport(renderer.cssWidth, renderer.cssHeight)) {
                            const hud = ui._layoutFor(state);
                            for (const key of ['header', 'vitals', 'loadout', 'pause']) {
                                check(!overlaps(receipt.rect, hud[key]), `${label}: tutorial overlaps ${key}`);
                            }
                        }
                    }
                }
            }

            for (const blocker of ['upgradeChoices', 'chestReward', 'altar', 'paused', 'victory', 'gameOver', 'photoMode']) {
                const ui = uiFor(renderer);
                const ctx = measuredContext();
                ui._drawControlHint(ctx, { onboardingLesson: new OnboardingDirector().snapshot(), [blocker]: true });
                check(!ui._lastDrawReceipt.onboarding && ctx.text.length === 0, `${name}: tutorial appears during ${blocker}`);
            }
            if (isPhoneLandscapeViewport(renderer.cssWidth, renderer.cssHeight)) {
                for (const danger of ['activeBoss', 'bossWarning', 'activeLieutenant']) {
                    const ui = uiFor(renderer);
                    const ctx = measuredContext();
                    ui._drawControlHint(ctx, { onboardingLesson: new OnboardingDirector().snapshot(), [danger]: {} });
                    check(!ui._lastDrawReceipt.onboarding && ctx.text.length === 0, `${name}: tutorial obstructs ${danger}`);
                }
            }
        }
    }
}

console.log(`First Light UI: ${checks} checks across ${scenarios} measured production draw scenarios; ${failures} failures`);
if (failures) process.exitCode = 1;
