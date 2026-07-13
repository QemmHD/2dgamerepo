#!/usr/bin/env node
// Adaptive Score v1 inventory, data, pressure-model, streaming, and provenance
// validator. It deliberately never constructs a browser AudioContext and never
// decodes the 2:38 menu MP3.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BOSS_PROFILES,
    BOSS_SUITES,
    BIOME_COMPOSITIONS,
    MENU_COMPOSITIONS,
    MUSIC_BY_ID,
    TRACKER_COMPOSITIONS,
    VOICE_STINGERS,
} from '../src/content/music.js';
import { MAP_ORDER } from '../src/content/maps.js';
import { BOSS_RUSH_APEX_ORDER } from '../src/content/bossRush.js';
import {
    MUSIC_SCENES,
    combatPressure,
    nextMusicState,
    sceneForPressure,
} from '../src/systems/MusicDirector.js';
import { AudioSystem } from '../src/systems/AudioSystem.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const fail = (message) => { console.error(`  x ${message}`); failures++; };
const ok = (condition, message) => { if (!condition) fail(message); };

const trackerMenus = MENU_COMPOSITIONS.filter((score) => score.kind === 'tracker');
const recordedMenus = MENU_COMPOSITIONS.filter((score) => score.kind === 'recorded');
ok(trackerMenus.length >= 3, 'menu requires at least three original tracker compositions');
ok(recordedMenus.length === 1, 'menu requires exactly one optional recorded feature');
ok(Object.keys(BOSS_SUITES).length >= 4, 'at least four boss suites are required');

const ids = new Set();
const fingerprints = new Map();
for (const score of TRACKER_COMPOSITIONS) {
    ok(!ids.has(score.id), `duplicate tracker id: ${score.id}`);
    ids.add(score.id);
    ok(score.kind === 'tracker', `${score.id}: expected tracker kind`);
    ok(score.form?.length >= 16, `${score.id}: form must be at least 16 bars`);
    for (const section of ['A', 'B', 'C', 'D']) {
        ok(score.form?.includes(section), `${score.id}: form missing ${section}`);
        ok(score.sections?.[section]?.melody?.length === 16, `${score.id}: ${section} melody must have 16 steps`);
        ok(score.sections?.[section]?.progression?.length >= 4, `${score.id}: ${section} harmony must span four bars`);
    }
    ok(Number.isFinite(score.bpm) && score.bpm >= 60 && score.bpm <= 190, `${score.id}: invalid bpm`);
    ok(Array.isArray(score.scale) && score.scale.length >= 5, `${score.id}: invalid scale`);
    for (const role of ['lead', 'counter', 'bass', 'pad']) ok(!!score.instruments?.[role], `${score.id}: missing ${role} instrument`);
    ok(!!score.groove, `${score.id}: missing groove`);
    const fingerprint = JSON.stringify({
        bpm: score.bpm, root: score.root, scale: score.scale, groove: score.groove,
        instruments: score.instruments,
        harmony: Object.values(score.sections).map((section) => section.progression),
        melody: Object.values(score.sections).map((section) => section.melody),
    });
    if (fingerprints.has(fingerprint)) fail(`${score.id}: composition duplicates ${fingerprints.get(fingerprint)}`);
    fingerprints.set(fingerprint, score.id);
    ok(MUSIC_BY_ID[score.id] === score, `${score.id}: missing from MUSIC_BY_ID`);
}

for (const biome of MAP_ORDER) {
    const songs = BIOME_COMPOSITIONS[biome];
    ok(Array.isArray(songs) && songs.length >= 2, `${biome}: requires at least two songs`);
    ok(songs?.every((score) => score.biome === biome), `${biome}: song has wrong biome id`);
    if (songs?.length >= 2) {
        ok(songs[0].bpm !== songs[1].bpm, `${biome}: variants need distinct tempo`);
        ok(songs[0].groove !== songs[1].groove, `${biome}: variants need distinct rhythm`);
        ok(songs[0].instruments.lead !== songs[1].instruments.lead, `${biome}: variants need distinct lead orchestration`);
    }
}

for (const bossId of BOSS_RUSH_APEX_ORDER) {
    const profile = BOSS_PROFILES[bossId];
    ok(!!profile, `boss profile missing: ${bossId}`);
    ok(!!BOSS_SUITES[profile?.suite], `${bossId}: unknown suite ${profile?.suite}`);
    for (const voiceId of [...(profile?.voices?.arrival || []), ...(profile?.voices?.phase2 || [])]) {
        ok(!!VOICE_STINGERS[voiceId], `${bossId}: unknown voice ${voiceId}`);
    }
}
ok(BOSS_PROFILES.rimewarden.voices.arrival.includes('wardenWakes'), 'warden line must map to Rimewarden');
ok(Object.entries(BOSS_PROFILES).every(([id, profile]) => id === 'rimewarden' || ![...profile.voices.arrival, ...profile.voices.phase2].includes('wardenWakes')), 'warden line mapped to unrelated boss');
ok(BOSS_PROFILES.solnakh.voices.phase2.includes('onlyEmbersRemain'), 'embers line must map to Solnakh phase two');
ok(Object.entries(BOSS_PROFILES).every(([id, profile]) => id === 'solnakh' || ![...profile.voices.arrival, ...profile.voices.phase2].includes('onlyEmbersRemain')), 'embers line mapped outside Solnakh');

function hasMp3Header(file) {
    if (!fs.existsSync(file)) return false;
    const head = Buffer.alloc(3);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, head, 0, 3, 0);
    fs.closeSync(fd);
    return head.toString('ascii') === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
}

for (const asset of [...recordedMenus, ...Object.values(VOICE_STINGERS)]) {
    const file = path.join(ROOT, asset.repoFile || '');
    ok(fs.existsSync(file), `missing audio asset: ${asset.repoFile}`);
    ok(hasMp3Header(file), `invalid MP3 header: ${asset.repoFile}`);
    ok(!path.isAbsolute(asset.repoFile || ''), `${asset.id}: repoFile must be GitHub Pages-safe relative path`);
}
const bard = recordedMenus[0];
ok(bard?.streaming === true && bard?.oneShot === true, 'Bard master must be streaming and one-shot');
ok(!!MUSIC_BY_ID[bard?.fallbackId] && MUSIC_BY_ID[bard.fallbackId].kind === 'tracker', 'Bard master needs tracker fallback');
ok(fs.statSync(path.join(ROOT, bard.repoFile)).size < 5 * 1024 * 1024, 'recorded menu payload exceeds 5MB budget');

// Pure MusicDirector tests: extremes, smoothing, hysteresis, boss override,
// and last-stand color that does not collapse intensity.
ok(combatPressure({}) === 0, 'empty field pressure must be zero');
const extreme = combatPressure({ activeEnemies: 180, nearbyEnemies: 80, elites: 12, hostileProjectiles: 180, hazards: 40, wavePressure: 1 });
ok(extreme > 0.98, 'extreme combat pressure should saturate near one');
ok(sceneForPressure(MUSIC_SCENES.CALM, 0.2) === MUSIC_SCENES.CALM, 'calm enter hysteresis failed');
ok(sceneForPressure(MUSIC_SCENES.HUNT, 0.2) === MUSIC_SCENES.HUNT, 'hunt exit hysteresis failed');
ok(sceneForPressure(MUSIC_SCENES.SWARM, 0.5) === MUSIC_SCENES.SWARM, 'swarm exit hysteresis failed');
ok(sceneForPressure(MUSIC_SCENES.CALM, 0, { bossActive: true, bossPhase: 2 }) === MUSIC_SCENES.BOSS_FINAL, 'boss phase override failed');
let state = null;
for (let i = 0; i < 120; i++) state = nextMusicState(state, {
    nearbyEnemies: 80, activeEnemies: 180, elites: 12,
    hostileProjectiles: 180, hazards: 40, wavePressure: 1,
}, 1 / 60);
ok(state.intensity > 0.8 && state.intensity < 1, 'pressure attack smoothing did not rise smoothly');
const beforeRelease = state.intensity;
state = nextMusicState(state, {}, 1 / 60);
ok(state.intensity < beforeRelease && state.intensity > beforeRelease * 0.95, 'pressure release should be slow, not snap down');
const lastStand = nextMusicState({ intensity: 0.85, scene: MUSIC_SCENES.ONSLAUGHT }, { nearbyEnemies: 40, activeEnemies: 90, playerHpFraction: 0.1 }, 1 / 60);
ok(lastStand.lastStand && lastStand.intensity > 0.8, 'last stand must color rather than collapse intensity');

// Headless API/rotation smoke: no window, Audio, or AudioContext is required.
const audio = new AudioSystem();
const seenMenu = [];
for (let i = 0; i < 8; i++) {
    audio.stopMusic();
    audio.playMusic('menu');
    seenMenu.push(audio._activeScore.id);
}
for (let i = 1; i < seenMenu.length; i++) ok(seenMenu[i] !== seenMenu[i - 1], 'menu shuffle repeated immediately');
for (const biome of MAP_ORDER) {
    audio.setBiome(biome);
    audio.stopMusic(); audio.playMusic('gameplay'); const first = audio._activeScore.id;
    audio.stopMusic(); audio.playMusic('gameplay'); const second = audio._activeScore.id;
    ok(first !== second, `${biome}: gameplay variants repeated immediately`);
}
for (const method of ['unlock', 'setCombatState', 'setBossProfile', 'musicEvent', 'prefetchBoss', 'bossVoice', 'dispose']) {
    ok(typeof audio[method] === 'function', `AudioSystem missing ${method}()`);
}

// Lifecycle regressions: unlock attempts must not retain a resolved promise,
// a later interrupted context must resume, and a throttled scheduler must skip
// missing wall-clock time instead of bursting thousands of stale notes.
const lifecycleAudio = new AudioSystem();
lifecycleAudio.enabled = true;
let schedulerStarts = 0;
let resumeCalls = 0;
lifecycleAudio.ctx = {
    state: 'running',
    currentTime: 0,
    resume: async () => { resumeCalls++; lifecycleAudio.ctx.state = 'running'; },
};
lifecycleAudio._startScheduler = () => { schedulerStarts++; lifecycleAudio._schedId = 1; };
lifecycleAudio._loadSamples = () => {};
ok(await lifecycleAudio.unlock(), 'running context should unlock');
ok(lifecycleAudio._unlockPromise === null, 'unlock retained a stale resolved promise');
ok(schedulerStarts === 1, 'unlock should start the scheduler exactly once');
lifecycleAudio.ctx.state = 'suspended';
ok(await lifecycleAudio.unlock(), 'suspended context should recover on a later gesture');
ok(resumeCalls === 1 && lifecycleAudio.ctx.state === 'running', 'later unlock did not resume the suspended context');

const throttledAudio = new AudioSystem();
throttledAudio.ctx = { state: 'running', currentTime: 600 };
throttledAudio.theme = 'gameplay';
throttledAudio._activeScore = trackerMenus[0];
throttledAudio._nextTime = 0;
let scheduledSteps = 0;
throttledAudio._scheduleStep = () => { scheduledSteps++; };
throttledAudio._schedulerTick();
ok(scheduledSteps > 0 && scheduledSteps <= 24, `stale scheduler emitted ${scheduledSteps} steps instead of a bounded catch-up`);
ok(throttledAudio._nextTime > throttledAudio.ctx.currentTime, 'stale scheduler clock was not advanced past current audio time');

const menuMixAudio = new AudioSystem();
menuMixAudio.setCombatState({ intensity: 1, scene: 'bossFinal', lastStand: true });
menuMixAudio.playMusic('menu');
ok(menuMixAudio._combatScene === 'calm' && menuMixAudio._intensity === 0 && !menuMixAudio._lastStand, 'menu inherited boss-final combat mix');

const cleanupAudio = new AudioSystem();
let disconnects = 0;
cleanupAudio.ctx = { currentTime: 10 };
cleanupAudio._queueCleanup([{ disconnect: () => { disconnects++; } }], 9);
cleanupAudio._queueCleanup([{ disconnect: () => { disconnects++; } }], 11);
cleanupAudio._drainCleanup();
ok(disconnects === 1 && cleanupAudio._cleanupQueue.length === 1, 'expired synth graph cleanup did not drain selectively');
cleanupAudio._drainCleanup(true);
ok(disconnects === 2 && cleanupAudio._cleanupQueue.length === 0, 'forced synth graph cleanup left nodes behind');

const credits = fs.readFileSync(path.join(ROOT, 'src/assets/audio/CREDITS.md'), 'utf8');
for (const text of ['the_bards_tale.mp3', 'RandomMind', 'CC0 1.0', 'Higgsfield Audio', 'dark_found_you.mp3', 'warden_wakes.mp3']) {
    ok(credits.includes(text), `audio credits missing ${text}`);
}
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/assets/credits/assets.json'), 'utf8'));
ok(registry.assets.some((entry) => entry.id === 'music-bards-tale' && entry.license === 'CC0-1.0'), 'Bard master missing from structured credits registry');
ok(registry.assets.some((entry) => entry.id === 'higgsfield-boss-voice' && entry.license === 'HIGGSFIELD-TERMS-2025-08-30'), 'Higgsfield voice set missing from structured credits registry');

if (failures) {
    console.error(`\naudio validation: FAILED with ${failures} problem(s).`);
    process.exit(1);
}
console.log(`audio validation: OK -- ${trackerMenus.length} tracker menus + ${recordedMenus.length} streamed feature, ${MAP_ORDER.length * 2} biome songs, ${Object.keys(BOSS_SUITES).length} boss suites / ${BOSS_RUSH_APEX_ORDER.length} bosses, ${Object.keys(VOICE_STINGERS).length} voice stingers.`);
