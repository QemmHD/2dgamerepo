#!/usr/bin/env node
// Deterministic gameplay-caption contract: strict preferences, bounded queue,
// semantic filtering, priority, dedupe and safe presentation text.

import { CaptionSystem } from '../src/systems/CaptionSystem.js';
import { readFileSync } from 'node:fs';

let checks = 0;
let failures = 0;
const ok = (condition, message) => {
    checks++;
    if (!condition) { failures++; console.error(`  x ${message}`); }
};

const presented = [];
const captions = new CaptionSystem({ onPresent: (item) => presented.push(item) });
ok(captions.setPreferences(true, 'essential').enabled === true
    && captions.detail === 'essential',
'Essential captions enable strictly');
ok(captions.sound({ key: 'ambient', text: 'Leaves rustle', detail: 'full' }) === false,
'Essential detail filters ambient/world captions');
ok(captions.say({ key: 'boss-line', speaker: 'Solnakh', text: 'Only embers remain.' }) === true,
'spoken boss line enters the dedicated caption lane');
ok(captions.snapshot()?.speaker === 'Solnakh'
    && captions.snapshot()?.text === 'Only embers remain.'
    && captions.snapshot()?.kind === 'speech',
'speech snapshot preserves speaker, exact transcript and kind');
ok(presented.length === 1, 'speech is presented exactly once');
ok(captions.say({ key: 'boss-line', speaker: 'Solnakh', text: 'Only embers remain.' }) === false,
'current speech dedupes repeated semantic keys');

// Two queued entries is the hard cap. Higher priority sorts ahead without
// turning a swarm of low-priority events into an unbounded transcript.
ok(captions.sound({ key: 'a', text: 'Charger winding up', priority: 30 }) === true,
'first essential sound queues behind speech');
ok(captions.sound({ key: 'b', text: 'Boss attack charging', priority: 70 }) === true,
'second essential sound fills the bounded queue');
ok(captions.sound({ key: 'c', text: 'Another warning', priority: 20 }) === false,
'third lower-priority sound is dropped at the queue cap');
ok(captions.queue.length === 2 && captions.queue[0].key === 'b',
'bounded queue keeps priority order');

// A new top-priority line interrupts a lesser current cue immediately.
captions.clear();
ok(captions.sound({ key: 'danger', text: 'Health critical', priority: 80 }) === true,
'danger cue can own an empty lane');
ok(captions.say({ key: 'voice-priority', speaker: 'Warden', text: 'The warden wakes.' }) === true
    && captions.snapshot()?.key === 'voice-priority',
'speech interrupts a lower-priority sound caption');

captions.clear();
captions.setPreferences(true, 'full');
ok(captions.sound({ key: 'world', text: 'Distant bells toll', detail: 'full' }) === true,
'Full detail admits curated world sounds');
captions.update(10);
ok(captions.snapshot() === null, 'expired caption retires cleanly');
ok(captions.sound({ key: 'world', text: 'Distant bells toll', detail: 'full', cooldown: 20 }) === false,
'semantic cooldown rejects a recently shown world cue');

captions.update(30);
ok(captions.say({
    key: 'sanitize',
    speaker: `Boss\u0000${'x'.repeat(80)}`,
    text: `Line\n${'y'.repeat(140)}`,
}) === true,
'sanitization fixture enters the lane');
const safe = captions.snapshot();
ok(!/[\u0000-\u001f\u007f]/.test(`${safe.speaker}${safe.text}`)
    && safe.speaker.length <= 32 && safe.text.length <= 96,
'caption speaker/text are control-free and hard-capped');

captions.setPreferences(false, 'full');
ok(captions.snapshot() === null && captions.queue.length === 0,
'turning captions off clears current and queued copy immediately');
ok(captions.say({ key: 'off', speaker: 'Boss', text: 'Hidden' }) === false,
'caption Off filters speech as well as sound');
const repaired = captions.setPreferences(true, 'verbose');
ok(repaired.detail === 'essential', 'invalid caption detail repairs to Essential');

const detailChange = new CaptionSystem();
detailChange.setPreferences(true, 'full');
detailChange.sound({ key: 'ambience', text: 'Leaves rustle', detail: 'full', priority: 60 });
detailChange.sound({ key: 'threat', text: 'Danger nearby', detail: 'essential', priority: 50 });
detailChange.setPreferences(true, 'essential');
ok(detailChange.snapshot()?.key === 'threat'
    && !detailChange.queue.some((item) => item.detail === 'full'),
'switching Full to Essential immediately evicts Full-only current and queued cues');

const staleQueue = new CaptionSystem();
staleQueue.setPreferences(true, 'full');
staleQueue.say({ key: 'long-line', speaker: 'Boss', text: 'Hold the lane.', lifetime: 1.2 });
staleQueue.sound({ key: 'fuse', text: 'Bomber fuse ignites', lifetime: 2.2 });
staleQueue.update(1.3);
ok(staleQueue.snapshot() === null && staleQueue.queue.length === 0,
'transient sound cues expire in queue instead of surfacing after their event');

const carry = new CaptionSystem();
carry.setPreferences(true, 'essential');
carry.sound({ key: 'first-sound', text: 'First warning', lifetime: 1.2, priority: 60 });
carry.update(0.8);
carry.sound({ key: 'second-sound', text: 'Second warning', lifetime: 2.4, priority: 50 });
carry.update(0.9);
ok(carry.snapshot()?.key === 'second-sound'
    && Math.abs(carry.snapshot().age - 0.5) < 0.001,
'large update steps consume leftover time after promoting a queued caption');

const monophonic = new CaptionSystem();
const spoken = [];
monophonic.onPresent = (item) => spoken.push(item.key);
monophonic.say({ key: 'arrival', speaker: 'Boss', text: 'I arrive.' });
monophonic.say({ key: 'phase-two', speaker: 'Boss', text: 'Now burn.' });
ok(monophonic.snapshot()?.key === 'phase-two'
    && !monophonic.queue.some((item) => item.kind === 'speech')
    && spoken.join(',') === 'arrival,phase-two',
'new speech replaces the old transcript exactly like the monophonic voice bus');

const updateSource = readFileSync(new URL('../src/core/GameUpdate.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/systems/UISystem.js', import.meta.url), 'utf8');
const gameSource = readFileSync(new URL('../src/core/Game.js', import.meta.url), 'utf8');
ok(/const captionHidden = [\s\S]*?this\.paused[\s\S]*?this\.photoMode[\s\S]*?this\.upgradeChoices[\s\S]*?this\.gameOver/.test(updateSource)
    && /captionHidden[\s\S]*?audio\?\.stopVoice\?\.\(\)[\s\S]*?captionSystem\?\.update/.test(updateSource)
    && !/captionSystem\?\.snapshot\?\.\(\)\?\.kind[\s\S]{0,160}?stopVoice/.test(updateSource),
'hidden pause/modal/photo surfaces freeze captions and stop voice even when captions are Off');
ok(/!gameState\.paused\s*&&\s*!gameState\.victory\s*&&\s*!gameState\.photoMode[\s\S]{0,100}?_drawCaption/.test(uiSource),
'photo mode cannot redraw a frozen gameplay caption when its HUD is visible');
ok(/victoryContinue\(\)[\s\S]{0,850}?captionSystem\?\.clear\?\.\(\)[\s\S]{0,260}?this\.victory\s*=\s*null/.test(gameSource),
'continuing a victory into the gauntlet clears frozen encounter captions');
ok(/const autoPause = \(\) => \{[\s\S]{0,450}?this\.paused\s*=\s*true;[\s\S]{0,260}?audio\?\.setPaused\?\.\(true\)/.test(gameSource),
'blur/visibility auto-pause synchronously applies the voice and music pause boundary');
ok((updateSource.match(/if \(this\._inView\(e\.x, e\.y, (?:0|120)\)\) \{[\s\S]{0,260}?captionSystem\?\.sound/g) || []).length >= 3,
'bomber fuse/blast and summoner captions share their on-screen relevance gates');

if (failures) {
    console.error(`\nCaption validation failed: ${failures}/${checks} checks.`);
    process.exit(1);
}
console.log(`Caption validation passed: ${checks} queue, filter, timing and sanitization checks.`);
