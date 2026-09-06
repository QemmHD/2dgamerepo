#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './scenarios.mjs';
import { assertSerializableReceipt, compareReceipts } from './migration-receipt.mjs';

// Run after capture-harness has generated scenario-1/2/3.html in this directory.
// Screenshot bytes are intentionally never compared as deterministic goldens.
const directory = resolve(process.argv[2] || '__out/migration');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function read(scenario, repeat) {
    const html = readFileSync(resolve(directory, `${scenario.id}-${repeat}.html`), 'utf8');
    assert.match(html, /data-qa-ready="1"/);
    assert.ok(!html.includes('<title>BOOTFAIL'), `${scenario.id}: boot failed`);
    const match = html.match(/<script id="migration-receipt" type="application\/json">([\s\S]*?)<\/script>/);
    assert.ok(match, `${scenario.id}: missing JSON receipt`);
    const receipt = JSON.parse(match[1]);
    assertSerializableReceipt(receipt);
    assert.equal(receipt.scenario, scenario.id);
    assert.equal(receipt.seed, scenario.seed);
    assert.equal(receipt.simulationTicks, scenario.ticks);
    assert.equal(receipt.simulationSeconds, scenario.ticks / 60);
    assert.equal(receipt.exceptionCount, 0);
    assert.equal(receipt.unhandledRejectionCount, 0);
    assert.deepEqual(receipt.errors, []);
    assert.equal(receipt.observations.actionsConsumed, scenario.actions.length);
    assert.equal(receipt.observations.renderOnly.simulationTicks, 0);
    assert.deepEqual(receipt.environment.viewport, scenario.viewport);
    assert.ok(receipt.environment.storageWrites > 0, 'real SaveSystem must write the isolated memory profile');
    return receipt;
}
for (const scenario of SCENARIOS) {
    const first = read(scenario, 1);
    const baseline = JSON.parse(readFileSync(resolve(root, `docs/evidence/phaser-migration/${scenario.id}.json`), 'utf8'));
    assert.deepEqual(compareReceipts(baseline.browser.receipt, first), [], `${scenario.id}: committed browser semantic baseline changed`);
    for (const repeat of [2, 3]) {
        const differences = compareReceipts(first, read(scenario, repeat));
        assert.deepEqual(differences, [], `${scenario.id}: repeat ${repeat}\n${JSON.stringify(differences, null, 2)}`);
    }
    console.log(`PASS browser ${scenario.id}: 3 matching semantic receipts, ${scenario.ticks} ticks, EXC:0`);
}
