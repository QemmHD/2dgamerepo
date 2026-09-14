#!/usr/bin/env node
// 41st gate. The PR3 validator retains vendor/isolation/lifetime/authority
// protections; this gate owns the four reviewed shared presentation seams.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateViewportContract } from './artshot/phaser-projection-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '5e0881f47448bfa108021baad987c54f72ff8b98';
const source = path => readFileSync(resolve(root, path), 'utf8');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
let checks = 0;
const check = (value, why) => { checks++; assert.ok(value, why); };
const same = (a, b, why) => { checks++; assert.deepEqual(a, b, why); };
for (const path of ['src/core/GameUpdate.js', 'src/core/Camera.js', 'src/core/Input.js',
    'src/core/KeyboardInput.js', 'src/core/TouchJoystick.js', 'src/core/TouchButtons.js',
    'src/core/GameInputActions.js', 'src/core/PhotoModeController.js', 'src/main.js',
    'src/systems/UISystem.js', 'src/systems/MenuRenderer.js', 'src/systems/UIStateBuilder.js',
    'src/systems/SaveSystem.js', 'src/systems/AudioSystem.js', 'index.html', 'styles.css',
    ...['normal-desktop', 'combat-pack', 'boss-entry', 'touch-actions'].map(id => `docs/evidence/phaser-migration/${id}.json`)]) {
    same(git('hash-object', path), git('rev-parse', `${BASE}:${path}`), `unchanged authority ${path}`);
}
const loop = source('src/core/GameLoop.js'), runtime = source('src/phaser/PhaserRuntime.js');
const renderer = source('src/systems/Renderer.js'), render = source('src/core/GameRender.js');
const scene = source('src/phaser/WorldScene.js'), main = source('src/phaser/main.js');
same((loop.match(/while \(this\.running && this\.accumulator/g) || []).length, 1, 'one accumulator');
check(/steps < 8/.test(loop) && /this\.accumulator -= this\.fixedDt/.test(loop), 'catchup cap and retained remainder');
check(/frameDt > this\.maxFrameDt/.test(loop), 'shared wall clamp');
check(!/(?:this\.(?:loop\.)?accumulator)\s*[+\-]?=|fixedDt\s*[:=]|timeScale\s*[:=]/.test(runtime + scene), 'Phaser has no second clock policy');
check(/processFrame\(timestamp\)/.test(runtime) && /PRE_STEP/.test(runtime), 'raw frame timestamp bridge');
check(!/this\.loop\.start\(|requestAnimationFrame\(/.test(runtime), 'no legacy or extra RAF');
check(/processPresentationFrame\(timestamp\)/.test(runtime), 'resize/hint use same external frame source');
check(/frameSource: 'external'/.test(runtime) && /alpha: true/.test(runtime), 'transparent externally driven Renderer');
check(/subscribeViewport/.test(runtime) && /Phaser\.Scale\.NONE/.test(runtime), 'one viewport authority');
check(!/devicePixelRatio|innerWidth|innerHeight|maxCoverCrop|maxBackingPx/.test(runtime + scene), 'no duplicate sizing calculations');
check(/getViewportSnapshot\(/.test(renderer) && /subscribeViewport\(/.test(renderer), 'detached viewport notification');
check(/renderOverlay\(/.test(render) && /beginOverlayFrame\(/.test(render), 'explicit overlay entry');
check(/_drawCanvasOverlay\(/.test(render) && /_drawMenuOverlay\(/.test(render), 'one shared UI path');
check(/Game\.prototype\.renderOverlay/.test(source('src/core/Game.js')), 'overlay focus reconciliation');
check(/this\.game\.render = this\.game\.renderOverlay\.bind/.test(runtime), 'direct callers cannot redraw old world');
check(/Diagnostic photo export is not available yet/.test(runtime), 'no misleading single-surface photo export');
for (const device of ['keyboard', 'mouse', 'touch', 'gamepad', 'windowEvents']) check(runtime.includes(`${device}: false`), `${device} remains disabled in Phaser`);
check(/SIMULATION: CONNECTED/.test(main) && /WORLD VIEW: DIAGNOSTIC/.test(main), 'honest experiment status');
check(/hostStorageAccesses/.test(main) && /hostLockAccesses/.test(main), 'host access counters');
same(readdirSync(resolve(root, 'tools')).filter(p => /^validate-[^/]+\.js$/.test(p)).length, 41, 'exactly 41 validators');
const clock = JSON.parse(execFileSync(process.execPath, ['tools/artshot/phaser-clock-contract.mjs'], { cwd: root, encoding: 'utf8' }));
check(clock.passed && clock.maxCatchUpUpdates === 8 && clock.hostRafRequests === 0, 'behavioral differential clock'); checks += clock.checks;
const overlay = JSON.parse(execFileSync(process.execPath, ['tools/artshot/phaser-overlay-contract.mjs'], { cwd: root, encoding: 'utf8' }));
check(overlay.passed, 'real Game overlay contract'); checks += overlay.assertions;
const projection = validateViewportContract(check);
check(projection.passed, 'projection matrix');
console.log(`PASS Phaser clock/viewport: ${checks} assertions; one fixed clock, retained overlay, shared viewport, unchanged PR1 authorities`);
