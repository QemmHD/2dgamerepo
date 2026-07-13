#!/usr/bin/env node
// Pure HUD geometry regression gate. This intentionally boots no DOM/canvas:
// every persistent surface is allocated by HUDLayout and checked across the
// desktop, compact, touch, boss, gauntlet, and safe-inset combinations that
// previously produced top-centre and phone-left collisions.

import { computeHUDLayout, hudRectsOverlap } from '../src/systems/HUDLayout.js';

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
    { name: 'compact', compact: true, touchMode: false },
    { name: 'touch', compact: true, touchMode: true },
];
const encounters = [
    { name: 'field', hasBoss: false, hasLieutenant: false, hasBossRush: false },
    { name: 'lieutenant', hasBoss: false, hasLieutenant: true, hasBossRush: false },
    { name: 'boss', hasBoss: true, hasLieutenant: false, hasBossRush: false },
    { name: 'boss-rush-stack', hasBoss: true, hasLieutenant: true, hasBossRush: true },
];

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

let scenarios = 0;
for (const safeArea of safeAreas) {
    for (const mode of modes) {
        for (const encounter of encounters) {
            scenarios++;
            const name = `${mode.name}/${encounter.name}/${safeArea.name}`;
            const hud = computeHUDLayout({
                width: 1920,
                height: 1080,
                safeArea,
                ...mode,
                ...encounter,
                loadoutCount: 15,
                relicCount: 9,
                abilityCount: 8,
            });

            for (const key of [
                'header', 'boss', 'lieutenant', 'bossRush', 'vitals',
                'loadout', 'pause', 'combo', 'abilities', 'kindle',
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

            // Touch removes Blink from the passive cooldown row because its
            // action-disc rim is already the meter; geometry must reflect it.
            if (mode.touchMode) {
                const compactHud = computeHUDLayout({
                    width: 1920, height: 1080, safeArea,
                    compact: true, touchMode: false, abilityCount: 8,
                });
                ok(hud.abilities.w < compactHud.abilities.w,
                    `${name}: touch ability row did not remove duplicate Blink`);
                ok(!active(hud.kindle), `${name}: touch still allocates duplicate Kindle bar`);
            }
        }
    }
}

if (failures) {
    console.error(`HUD layout validation failed: ${failures}/${checks} checks across ${scenarios} scenarios.`);
    process.exit(1);
}
console.log(`HUD layout validation passed: ${checks} checks across ${scenarios} scenarios.`);
