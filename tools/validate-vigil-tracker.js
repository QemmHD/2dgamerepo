#!/usr/bin/env node
// Headless state and Canvas contract checks for the Living Vigil tracker.

import { readFileSync } from 'node:fs';
import {
    VIGIL_TRACKER_LIMITS,
    VIGIL_TRACKER_SITE_KINDS,
    VigilTracker,
} from '../src/systems/VigilTracker.js';

let checks = 0;
let failures = 0;
function ok(value, message) {
    checks++;
    if (!value) {
        failures++;
        console.error(`  x ${message}`);
    }
}

class MockContext {
    constructor() {
        this.globalAlpha = 1;
        this.drawCalls = 0;
        this.text = [];
        this.scaleCalls = [];
        this.strokeCalls = 0;
        this.strokeTextCalls = [];
    }
    save() { this.drawCalls++; }
    restore() {}
    translate() {}
    scale(x, y) { this.scaleCalls.push([x, y]); }
    beginPath() {}
    closePath() {}
    moveTo() {}
    lineTo() {}
    quadraticCurveTo() {}
    arc() {}
    fill() { this.drawCalls++; }
    stroke() { this.strokeCalls++; this.drawCalls++; }
    fillText(text) { this.text.push(String(text)); this.drawCalls++; }
    strokeText(text) { this.strokeTextCalls.push(String(text)); this.drawCalls++; }
    measureText(text) { return { width: String(text).length * 8 }; }
}

function siteEvent(kind, serial = 1, extra = {}) {
    return {
        id: `site-${kind}-${serial}`,
        kind: kind === 'beacon' ? 'spawn' : 'reward',
        siteId: `vigil-site:${serial}:${kind}`,
        archetype: kind,
        label: `${kind} site`,
        color: '#ffd166',
        reward: kind === 'beacon' ? undefined : { type: kind === 'archive' ? 'xp' : 'coins' },
        ...extra,
    };
}

function focus(kind = 'archive', extra = {}) {
    return {
        siteId: `vigil-site:focus:${kind}`,
        archetype: kind,
        name: 'Ashen Archive',
        prompt: 'READ',
        color: '#7fd0ff',
        x: 120,
        y: -70,
        inside: true,
        progress: 0.5,
        blocked: false,
        ...extra,
    };
}

const tracker = new VigilTracker();
let snapshot = tracker.getSnapshot();
ok(snapshot.activatedSites === 0 && snapshot.siteKindTotal === 4, 'fresh run starts at zero of four sites');
ok(snapshot.encountersCleared === 0 && snapshot.queuedCelebrations === 0,
    'fresh run starts without encounter progress or notices');
ok(snapshot.prompt === null && snapshot.reducedEffects === false, 'fresh run has no stale prompt/settings');

// Invalid input is a no-op and invalid deltas cannot poison the deterministic clock.
tracker.update(NaN, null);
tracker.update(-10, { events: [null, 4, {}, { kind: 'reward', archetype: 'unknown' }] });
snapshot = tracker.getSnapshot();
ok(snapshot.clock === 0 && snapshot.activatedSites === 0 && snapshot.encountersCleared === 0,
    'malformed updates do not mutate run progress');
ok(tracker.ingest({ type: 'not-an-encounter' }) === false, 'unknown event types are rejected');
ok(tracker.ingest({ type: 'encounter-cleared', completedCount: 99 }) === false
    && tracker.getSnapshot().encountersCleared === 0,
    'encounter progress without a stable pack id is rejected');

// Site focus refreshes, clamps progress, wins over an active non-urgent pack,
// and expires after the caller stops feeding it.
ok(tracker.setSiteFocus(focus('archive', { progress: 9 })), 'valid site focus is accepted');
snapshot = tracker.getSnapshot();
ok(snapshot.prompt.kind === 'site' && snapshot.prompt.progress === 1, 'site focus progress is clamped');
tracker.setEncounterSnapshot({ activePack: { packId: 'pack-a', name: 'Cinder Wedge', guardiansRemaining: 2 } });
ok(tracker.getSnapshot().prompt.kind === 'site', 'nearby site wins over a non-urgent active pack');
tracker.update(VIGIL_TRACKER_LIMITS.siteFocusHoldSeconds + 1, {});
ok(tracker.getSnapshot().prompt.kind === 'encounter-active', 'expired site focus reveals the active pack');
ok(tracker.setSiteFocus({ archetype: 'archive', x: NaN, y: 0 }) === false,
    'non-finite world focus is rejected safely');

// Every unique site kind activates once. Replayed event ids and unknown kinds
// cannot inflate the four-kind model.
for (let i = 0; i < VIGIL_TRACKER_SITE_KINDS.length; i++) {
    const kind = VIGIL_TRACKER_SITE_KINDS[i];
    const event = siteEvent(kind, i + 1);
    ok(tracker.ingest(event), `${kind} activation is accepted`);
    ok(tracker.ingest(event) === false, `${kind} duplicate id is rejected`);
}
snapshot = tracker.getSnapshot();
ok(snapshot.activatedSites === 4 && snapshot.activatedSiteKinds.length === 4,
    'four distinct site activations fill the tracker');
ok(snapshot.siteMask === 15, 'four site kinds occupy the complete bounded bitmask');
ok(snapshot.queuedCelebrations <= VIGIL_TRACKER_LIMITS.maxCelebrations,
    'site notices stay inside the celebration bound');

// Earned rewards remain visible even when another shared announcement replaces
// the center banner on the following frame.
const rewardTracker = new VigilTracker();
rewardTracker.ingest(siteEvent('archive', 20, { reward: { type: 'xp', amount: 18 } }));
ok(rewardTracker.getSnapshot().celebration.subtitle === '+18 run XP',
    'archive celebration discloses its exact earned XP');
rewardTracker.ingest({
    ...siteEvent('beacon', 21), kind: 'reward',
    reward: { type: 'bundle', coins: 52, xp: 24 },
});
ok(rewardTracker.getSnapshot().queuedCelebrations === 2
    && rewardTracker.celebrations[1].subtitle === '+52 coins / +24 XP',
    'beacon completion queues its exact coin and XP receipt');

// A warning is urgent, is timed, and takes priority over local/active prompts.
tracker.setSiteFocus(focus());
tracker.ingest({
    type: 'encounter-warning',
    packId: 'pack-b',
    title: 'Grave Procession',
    text: 'A shielded column is approaching',
    color: '#ff9a4a',
    duration: 3,
});
snapshot = tracker.getSnapshot();
ok(snapshot.prompt.kind === 'encounter-warning' && snapshot.prompt.title === 'Grave Procession',
    'urgent encounter warning wins prompt priority');
tracker.update(0.25, { frozen: true });
ok(tracker.getSnapshot().prompt.remaining === snapshot.prompt.remaining, 'frozen update pauses prompt timers');
tracker.update(0.25, {});
ok(tracker.getSnapshot().prompt.remaining === snapshot.prompt.remaining - 0.25,
    'live update advances warning by the clamped frame step');
ok(tracker.ingest({
    type: 'encounter-warning',
    packId: 'pack-b',
    title: 'Grave Procession',
    text: 'A shielded column is approaching',
    color: '#ff9a4a',
    duration: 3,
}), 'same-pack warning can replay after a modal interruption');
ok(tracker.getSnapshot().prompt.remaining === 3, 'replayed warning refreshes its full readable duration');
tracker.setEncounterSnapshot({ warning: { packId: 'pack-b', name: 'Grave Procession', remaining: 1.2, duration: 3 } });
ok(tracker.getSnapshot().prompt.remaining === 1.2, 'director snapshot is authoritative for warning time');

// Spawn, clear, duplicate clear, and authored completion counters transition
// without leaving stale encounter UI.
tracker.setSiteFocus(focus());
tracker.ingest({ type: 'encounter-spawned', packId: 'pack-b', title: 'Grave Procession', count: 6 });
ok(tracker.getSnapshot().prompt.kind === 'site',
    'non-urgent spawned pack yields prompt priority back to the nearby site');
tracker.setSiteFocus(null);
ok(tracker.getSnapshot().prompt.kind === 'encounter-active', 'active pack remains after local focus clears');
const clear = {
    type: 'encounter-cleared',
    packId: 'pack-b',
    title: 'Grave Procession broken',
    text: 'Guardian pack cleared',
    completedCount: 1,
    color: '#7fd0ff',
};
ok(tracker.ingest(clear), 'encounter clear is accepted');
ok(tracker.getSnapshot().encountersCleared === 1 && tracker.getSnapshot().prompt === null,
    'clear increments progress and retires its active prompt');
ok(tracker.ingest(clear) === false && tracker.getSnapshot().encountersCleared === 1,
    'duplicate clear cannot increment twice');
tracker.ingest({ ...clear, packId: 'pack-c', completedCount: 7 });
ok(tracker.getSnapshot().encountersCleared === 7, 'authoritative completedCount can reconcile progress');
tracker.ingest({ ...clear, packId: 'pack-d', completedCount: -500 });
ok(tracker.getSnapshot().encountersCleared === 7, 'stale or invalid completion count cannot roll progress backward');

// Timed celebrations are sequential rather than all expiring in parallel.
const beforeQueue = tracker.getSnapshot().queuedCelebrations;
const beforeTitle = tracker.getSnapshot().celebration.title;
tracker.update(0.25, {});
ok(tracker.getSnapshot().celebration.title === beforeTitle, 'current celebration persists during its timer');
for (let i = 0; i < 60; i++) tracker.update(0.25, {});
ok(tracker.getSnapshot().queuedCelebrations < beforeQueue || tracker.getSnapshot().queuedCelebrations === 0,
    'celebration timer eventually drains the bounded queue');

// Input and history floods stay bounded and report dropped work.
const flood = Array.from({ length: VIGIL_TRACKER_LIMITS.maxInputEventsPerUpdate + 9 }, (_, i) => ({
    type: 'encounter-warning',
    packId: `flood-${i}`,
    title: 'Formation signal',
    duration: 1,
}));
const droppedBefore = tracker.droppedEvents;
tracker.update(0, { events: flood });
ok(tracker.droppedEvents === droppedBefore + 9, 'oversized input batch is truncated and counted');
for (let i = 0; i < VIGIL_TRACKER_LIMITS.maxRememberedEvents + 20; i++) {
    tracker.ingest({ type: 'encounter-aborted', packId: `history-${i}` });
}
ok(tracker._seenEventKeys.length === VIGIL_TRACKER_LIMITS.maxRememberedEvents,
    'deduplication history remains hard bounded');

// Reduced-effects mode remains readable but disables motion paths internally.
tracker.update(0, { reducedEffects: true, siteFocus: focus('hearth') });
ok(tracker.getSnapshot().reducedEffects === true, 'reduced-effects state is exposed to rendering');

// Both draw surfaces execute with Canvas-shaped primitives, honor optional
// visibility, and need no DOM/browser globals.
const ctx = new MockContext();
ok(tracker.draw(ctx, { x: 1280, y: 300, w: 500, h: 132 }), 'HUD chip draws with explicit placement');
ok(ctx.drawCalls > 20, 'HUD chip produces a complete primitive/text composition');
ok(ctx.text.includes('LIVING VIGIL') && ctx.text.some((text) => text.startsWith('SITES 4 / 4')),
    'HUD chip prints its label and exact site progress');
ok(ctx.text.some((text) => text.startsWith('PACKS 07')), 'HUD chip prints padded encounter progress');
ok(tracker.draw(ctx, {}, { visible: false }) === false, 'hidden HUD draw is a no-op');
ok(tracker.draw(null, {}) === false, 'invalid Canvas context is rejected');
ok(tracker.draw(ctx, { x: 0, y: 0, w: 200, h: 80 }) === false,
    'undersized HUD allocation is rejected instead of overflowing its slot');

// Combat accessibility preferences apply to the complete procedural chip.
// The allocation and Canvas transform grow together, while high contrast adds
// real warning/progress outlines instead of only recoloring the backdrop.
const warningTracker = new VigilTracker();
warningTracker.ingest({
    type: 'encounter-warning',
    packId: 'contrast-pack',
    title: 'Black Sun Procession',
    text: 'Shield bearers are entering the grove',
    color: '#ff9a4a',
    duration: 3,
});
const scaledRect = { x: 1260, y: 240, w: 350 * 1.3, h: 118 * 1.3 };
const scaledCtx = new MockContext();
ok(warningTracker.drawHUD(scaledCtx, scaledRect, { compact: true, uiScale: 130 }),
    '130% compact Living Vigil draws inside its scaled allocation');
ok(scaledCtx.scaleCalls.length === 1
    && scaledCtx.scaleCalls[0][0] === 1.3 && scaledCtx.scaleCalls[0][1] === 1.3,
    'Living Vigil applies the requested UI scale to fonts and procedural glyphs');

const contrastCtx = new MockContext();
ok(warningTracker.drawHUD(contrastCtx, scaledRect, {
    compact: true, uiScale: 130, highContrast: true,
}), 'high-contrast Living Vigil warning remains drawable');
ok(contrastCtx.scaleCalls.length === 1
    && contrastCtx.scaleCalls[0][0] === 1.3 && contrastCtx.scaleCalls[0][1] === 1.3,
    'high-contrast Living Vigil preserves the requested UI scale transform');
ok(contrastCtx.strokeCalls > scaledCtx.strokeCalls,
    'high contrast adds explicit chip/progress/glyph outline strokes');
ok(contrastCtx.strokeTextCalls.includes('Black Sun Procession')
    && contrastCtx.strokeTextCalls.includes('Shield bearers are entering the grove')
    && contrastCtx.strokeTextCalls.includes('INCOMING'),
    'high contrast outlines warning title, body, and progress status text');
const undersizedScaledCtx = new MockContext();
ok(warningTracker.drawHUD(undersizedScaledCtx, { x: 0, y: 0, w: 400, h: 140 }, {
    compact: true, uiScale: 130, highContrast: true,
}) === false, 'scaled Living Vigil rejects an allocation smaller than its scaled minimum');
ok(tracker.drawWorldPrompt(ctx, { x: 120, y: -70 }, { width: 1920, height: 1080 }),
    'camera-aware world prompt draws for a visible focused site');
ok(tracker.drawWorldPrompt(ctx, null) === false, 'world prompt requires a finite camera');
tracker.setSiteFocus(null);
ok(tracker.drawWorldPrompt(ctx, { x: 0, y: 0 }) === false, 'world prompt retires with site focus');

// Snapshots are defensive and reset is a complete run boundary.
snapshot = tracker.getSnapshot();
snapshot.activatedSiteKinds.length = 0;
if (snapshot.celebration) snapshot.celebration.title = 'mutated';
ok(tracker.getSnapshot().activatedSiteKinds.length === 4, 'snapshot site list cannot mutate tracker state');
const reset = tracker.reset({ activatedSiteKinds: ['cache', 'bad'], encountersCleared: 2, reducedEffects: true });
ok(reset.activatedSites === 1 && reset.activatedSiteKinds[0] === 'cache', 'reset accepts bounded seeded site progress');
ok(reset.encountersCleared === 2 && reset.reducedEffects, 'reset accepts run options');
ok(reset.prompt === null && reset.queuedCelebrations === 0 && reset.droppedEvents === 0,
    'reset clears all transient and diagnostic state');

const source = readFileSync(new URL('../src/systems/VigilTracker.js', import.meta.url), 'utf8');
ok(!source.includes('Math.random'), 'tracker has no ambient randomness');
ok(!source.includes('<svg') && !source.includes('createElement'), 'tracker uses no SVG or DOM graphics');
ok(VIGIL_TRACKER_LIMITS.maxCelebrations <= 4, 'celebration queue remains a small fixed bound');
ok(VIGIL_TRACKER_LIMITS.siteKindCount === 4, 'site model remains exactly four authored kinds');

if (failures) {
    console.error(`Vigil tracker validation: FAILED (${failures}/${checks})`);
    process.exit(1);
}
console.log(`Vigil tracker validation: OK - ${checks} state, timer, input, and Canvas checks.`);
