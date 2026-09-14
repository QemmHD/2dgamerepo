#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { SCENARIOS } from './scenarios.mjs';
import { compareReceipts } from './migration-receipt.mjs';

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
    const at = arg.indexOf('='); return [arg.slice(2, at), arg.slice(at + 1)];
}));
for (const key of ['chrome', 'base-url', 'output']) assert.ok(options[key], `missing --${key}`);
const output = resolve(options.output);
await mkdir(output, { recursive: true });
const profiles = await mkdtemp(join(tmpdir(), 'emberwake-pr4-'));
const report = { passed: false, backend: null, semantics: [], projections: [], behaviors: [], visuals: [], hardwarePerformanceClaim: false };
const mobileAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
async function capture(name, path, viewport, { mobile = false, dpr = 1, screenshot = false } = {}) {
    const args = ['tools/artshot/capture-harness.mjs', `--chrome=${options.chrome}`, '--renderer=webgl-software',
        `--profile=${join(profiles, name)}`, `--dom=${join(output, name + '.html')}`,
        `--viewport=${viewport}`, `--device-scale=${dpr}`, '--timeout=180000',
        `--url=${new URL(path, options['base-url']).href}`];
    if (mobile) args.push('--mobile=1', '--touch=1', `--user-agent=${mobileAgent}`);
    if (screenshot) args.push(`--screenshot=${join(output, name + '.png')}`);
    await new Promise((resolveRun, reject) => {
        const child = spawn(process.execPath, args, { stdio: 'inherit' });
        child.once('error', reject); child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${name} capture exit ${code}`)));
    });
    const html = await readFile(join(output, name + '.html'), 'utf8');
    assert.match(html, /data-qa-ready="1"/);
    assert.ok(!/BOOTFAIL|BOOT FAIL/.test(html), `${name}: browser failed`);
    return html;
}
function scriptReceipt(html, id) {
    const match = html.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)<\\/script>`));
    assert.ok(match, `Missing ${id}`); return JSON.parse(match[1]);
}
try {
    for (const scenario of SCENARIOS) {
        const rates = scenario.id === 'touch-actions' ? [30, 60, 120, 'stall'] : [60];
        for (const rate of rates) {
            const cadence = rate === 'stall' ? 30 : rate;
            const html = await capture(`${scenario.id}-${rate}`,
                `tools/artshot/phaser-simulation.html?scenario=${scenario.id}&cadence=${cadence}${rate === 'stall' ? '&stall=1' : ''}`, scenario.viewport.join(','));
            const r = scriptReceipt(html, 'phaser-simulation-receipt');
            const golden = JSON.parse(await readFile(`docs/evidence/phaser-migration/${scenario.id}.json`, 'utf8'));
            assert.deepEqual(compareReceipts(golden.browser.receipt, r.semantic), [], `${scenario.id}/${rate}: immutable semantic parity`);
            assert.equal(r.parity, 'PASS'); assert.ok(r.maxSteps <= 8);
            assert.equal(r.live.boot.simulationConnected, true);
            assert.equal(r.live.simulation.updateCalls, scenario.ticks);
            assert.equal(r.hostStorageAccesses, 0); assert.equal(r.hostLockAccesses, 0);
            assert.equal(r.disposed.activeGameCount, 0); assert.equal(r.disposed.shellListeners, 0);
            report.backend = r.live.renderer.identity;
            report.semantics.push({ scenario: scenario.id, cadence: rate, ticks: scenario.ticks,
                frames: r.frames, maxSteps: r.maxSteps, remainder: r.finalAccumulator, parity: r.parity });
        }
    }
    const viewports = [
        ['desktop', '1280,720', false, 1], ['desktop-contain', '2560,720', false, 2],
        ['landscape', '844,390', true, 3], ['landscape-contain', '1080,390', true, 2],
        ['portrait', '390,844', true, 3], ['portrait-contain', '390,1080', true, 3],
    ];
    for (const [name, viewport, mobile, dpr] of viewports) for (const safe of [0, 1]) {
        const html = await capture(`${name}${safe ? '-safe' : ''}`, `tools/artshot/phaser-projection-browser.html?safe=${safe}`,
            viewport, { mobile, dpr, screenshot: true });
        const match = html.match(/<pre id="projection-receipt">([\s\S]*?)<\/pre>/);
        assert.ok(match, 'Projection receipt');
        const r = JSON.parse(match[1].replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&'));
        assert.equal(r.passed, true); assert.deepEqual(r.errors, []);
        assert.ok(r.projection.maxCssError <= .5); assert.equal(r.boundsErrorCss, 0);
        assert.equal(r.canvasCount, 2); assert.equal(r.overlayAlpha, true);
        assert.equal(r.hostStorageAccesses, 0); assert.equal(r.hostLockAccesses, 0);
        assert.equal(r.resizeRaf, null); assert.equal(r.hintRaf, null);
        if (name.startsWith('portrait')) {
            assert.equal(r.projection.viewport.rotated, true); assert.equal(r.rotateCueTransform, 'none');
        }
        report.projections.push({ name, safe, viewport: r.projection.viewport,
            points: r.projection.cases, maxCssError: r.projection.maxCssError, boundsErrorCss: r.boundsErrorCss });
    }
    for (const mode of ['paused', 'hidden', 'catchup', 'touch', 'modal']) {
        const html = await capture(`behavior-${mode}`, `tools/artshot/phaser-behavior.html?dispose=${mode}`, '1280,720');
        const r = scriptReceipt(html, 'phaser-behavior-receipt');
        assert.equal(r.passed, true); assert.deepEqual(r.errors, []);
        assert.equal(r.hostStorageAccesses, 0); assert.equal(r.hostLockAccesses, 0);
        assert.equal(r.disposed.activeGameCount, 0); assert.equal(r.disposed.shellListeners, 0);
        report.behaviors.push(r);
    }
    for (const [name, state, viewport, mobile] of [
        ['gameplay-desktop', 'gameplay', '1280,720', false],
        ['gameplay-landscape', 'gameplay', '844,390', true],
        ['gameplay-portrait', 'gameplay', '390,844', true],
        ['boss-desktop', 'boss', '1280,720', false],
        ['boss-landscape', 'boss', '844,390', true],
        ['warning-desktop', 'warning', '1280,720', false],
        ['pause-landscape', 'pause', '844,390', true],
    ]) {
        const html = await capture(`visual-${name}`, `tools/artshot/phaser-visual.html?state=${state}`,
            viewport, { mobile, dpr: mobile ? 3 : 1, screenshot: true });
        const r = scriptReceipt(html, 'phaser-visual-receipt');
        assert.equal(r.passed, true); assert.equal(r.kind, 'visual-staged-not-semantic-parity');
        assert.deepEqual(r.errors, []); assert.equal(r.hostStorageAccesses, 0); assert.equal(r.hostLockAccesses, 0);
        assert.equal(r.live.boot.simulationConnected, true); assert.equal(r.live.lifetime.activeGameCount, 1);
        assert.equal(r.live.lifetime.canvasCount, 2); assert.equal(r.boundsError, 0);
        assert.ok(r.overlayPixels.transparent + r.overlayPixels.translucent > 0);
        report.visuals.push({ name, ...r });
    }
    report.passed = true;
    console.log('PASS Phaser-hosted immutable semantics, cadence, projection, Focus/freeze and interrupted disposal');
} finally {
    await writeFile(join(output, 'receipt.json'), JSON.stringify(report, null, 2));
    const absolute = resolve(profiles);
    assert.ok(basename(absolute).startsWith('emberwake-pr4-') && absolute.startsWith(resolve(tmpdir())));
    await rm(absolute, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
