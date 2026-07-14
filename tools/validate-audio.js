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
import { AUDIO_MIX, AudioSystem } from '../src/systems/AudioSystem.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audioSource = fs.readFileSync(path.join(ROOT, 'src/systems/AudioSystem.js'), 'utf8');
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

// Long-run tracker continuity: cross several complete forms, including a
// deliberate 40-second background-throttle jump. The scheduler must skip that
// missing wall time, resume promptly, and keep composing indefinitely.
const continuityAudio = new AudioSystem();
const continuityScore = BIOME_COMPOSITIONS.emberwood[0];
let continuityNow = 0;
const scheduledNotes = [];
continuityAudio.ctx = {
    state: 'running',
    get currentTime() { return continuityNow; },
};
continuityAudio.theme = 'gameplay';
continuityAudio._activeScore = continuityScore;
continuityAudio._nextTime = 0.08;
continuityAudio._scheduleStep = (step, time) => { scheduledNotes.push({ step, time }); };
const tickUntil = (end) => {
    while (continuityNow < end - 0.00001) {
        continuityAudio._schedulerTick();
        continuityNow = Math.round((continuityNow + 0.1) * 10) / 10;
    }
};
tickUntil(55);
const notesBeforeJump = scheduledNotes.length;
continuityNow = 95; // emulate a suspended/backgrounded tab without fake catch-up
continuityAudio._schedulerTick();
const notesOnRecoveryTick = scheduledNotes.length - notesBeforeJump;
const firstAfterJump = scheduledNotes[notesBeforeJump]?.time;
continuityNow = 95.1;
tickUntil(180);

ok(continuityAudio._activeScore === continuityScore && continuityAudio.theme === 'gameplay', 'long-run scheduler lost its active gameplay score');
ok(continuityAudio._formCycles >= 4, `long-run scheduler completed only ${continuityAudio._formCycles} forms in 180 seconds`);
ok(notesOnRecoveryTick > 0 && notesOnRecoveryTick <= 24, `background recovery scheduled ${notesOnRecoveryTick} notes instead of a bounded restart`);
ok(firstAfterJump >= 95 && firstAfterJump <= 95.25, `background recovery resumed at ${firstAfterJump} instead of within the look-ahead window`);
ok(!scheduledNotes.some(({ time }) => time >= 56 && time < 95), 'background recovery manufactured notes inside missing wall-clock time');
ok(continuityAudio._nextTime > continuityNow, 'long-run scheduler clock did not remain ahead of audio time');
const silentSeconds = [];
for (const [start, end] of [[0, 55], [95, 180]]) {
    for (let second = start; second < end; second++) {
        if (!scheduledNotes.some(({ time }) => time >= second && time < second + 1)) silentSeconds.push(`${second}-${second + 1}`);
    }
}
ok(!silentSeconds.length, `tracker went silent during: ${silentSeconds.slice(0, 8).join(', ')}`);

// Mix calibration is a public policy contract, not another set of magic
// numbers hidden in the validator. Defaults should put the persistent score
// near the effects bed, while voice remains intelligible and texture density
// stays bounded on both desktop and mobile.
const expectedMix = {
    musicTrim: 0.68,
    sfxTrim: 0.55,
    voiceTrim: 0.68,
    duckFloor: 0.55,
    textureBudgetDesktop: 6,
    textureBudgetMobile: 4,
};
for (const [key, expected] of Object.entries(expectedMix)) {
    ok(AUDIO_MIX?.[key] === expected, `AUDIO_MIX.${key} must be ${expected}, got ${AUDIO_MIX?.[key]}`);
}
const calibratedMusic = 0.7 * AUDIO_MIX.musicTrim;
const calibratedSfx = 0.8 * AUDIO_MIX.sfxTrim;
const defaultBedDeltaDb = 20 * Math.log10(calibratedMusic / calibratedSfx);
ok(defaultBedDeltaDb >= -1 && defaultBedDeltaDb <= 2.5, `default music/SFX buses differ by ${defaultBedDeltaDb.toFixed(2)}dB`);
ok(Number.isInteger(AUDIO_MIX.textureBudgetDesktop) && AUDIO_MIX.textureBudgetDesktop > AUDIO_MIX.textureBudgetMobile, 'desktop texture budget must be a larger positive integer than mobile');

const textureAudio = new AudioSystem();
let textureNow = 0.02; // first 100ms must be budgeted too (no NaN warm-up window)
textureAudio.ctx = { get currentTime() { return textureNow; } };
textureAudio.sfxBus = {};
let texturesPlayed = 0;
for (let i = 0; i < AUDIO_MIX.textureBudgetDesktop + 3; i++) {
    textureAudio._play(`desktop-texture-${i}`, 0, () => { texturesPlayed++; });
}
ok(texturesPlayed === AUDIO_MIX.textureBudgetDesktop, `desktop texture window played ${texturesPlayed} cues instead of ${AUDIO_MIX.textureBudgetDesktop}`);
textureAudio._mobile = true;
textureNow = 0.2;
const beforeMobileTextures = texturesPlayed;
for (let i = 0; i < AUDIO_MIX.textureBudgetMobile + 3; i++) {
    textureAudio._play(`mobile-texture-${i}`, 0, () => { texturesPlayed++; });
}
ok(texturesPlayed - beforeMobileTextures === AUDIO_MIX.textureBudgetMobile, `mobile texture window played ${texturesPlayed - beforeMobileTextures} cues instead of ${AUDIO_MIX.textureBudgetMobile}`);

// Exercise setVolumes() through fake AudioParams so the runtime must consume
// the exported policy, rather than merely exporting unused passing constants.
const busAudio = new AudioSystem();
busAudio.ctx = { currentTime: 4 };
const musicParam = {}, sfxParam = {}, voiceParam = {};
busAudio.musicBus = { gain: musicParam };
busAudio.sfxBus = { gain: sfxParam };
busAudio.voiceBus = { gain: voiceParam };
const busTargets = new Map();
busAudio._rampParam = (param, value) => { busTargets.set(param, value); };
busAudio.setVolumes(0.7, 0.8, 0.35);
ok(busTargets.get(musicParam) === calibratedMusic, `setVolumes music target was ${busTargets.get(musicParam)}, expected ${calibratedMusic}`);
ok(busTargets.get(sfxParam) === calibratedSfx, `setVolumes SFX target was ${busTargets.get(sfxParam)}, expected ${calibratedSfx}`);
ok(busTargets.get(voiceParam) === 0.35 * AUDIO_MIX.voiceTrim, `setVolumes voice target was ${busTargets.get(voiceParam)}, expected ${0.35 * AUDIO_MIX.voiceTrim}`);
busAudio.setVolumes(0.7, 0.2, 0.35);
ok(busTargets.get(sfxParam) === 0.2 * AUDIO_MIX.sfxTrim
    && busTargets.get(voiceParam) === 0.35 * AUDIO_MIX.voiceTrim,
'changing SFX with an explicit fixed voice level does not move the voice bus');
busAudio.setVolumes(0.7, 0.6);
ok(busTargets.get(voiceParam) === 0.6 * AUDIO_MIX.voiceTrim,
'legacy two-argument setVolumes keeps voice following SFX');

const monoAudio = new AudioSystem();
monoAudio.outputBus = { channelCount: 2 };
ok(monoAudio.setMonoAudio(true) === true && monoAudio.outputBus.channelCount === 1,
'mono preference switches the explicit output bus to one channel');
ok(monoAudio.setMonoAudio('true') === false && monoAudio.outputBus.channelCount === 2,
'mono preference rejects truthy non-booleans and restores stereo');
ok(audioSource.includes("this.outputBus.channelInterpretation = 'speakers'")
    && audioSource.includes("this.outputBus.channelCountMode = 'explicit'")
    && audioSource.indexOf('this.master.connect(this.outputBus)')
        < audioSource.indexOf('this.outputBus.connect(this.limiter)')
    && audioSource.indexOf('this.outputBus.connect(this.limiter)')
        < audioSource.indexOf('this.limiter.connect(this.ctx.destination)'),
'explicit speaker downmix sits before the output limiter and destination');
ok(audioSource.includes('if (this.volVoice > 0) this._duck('),
'muted voice does not create an unexplained music duck');

const pausedVoiceAudio = new AudioSystem();
let stoppedVoiceAt = null;
let fadedVoiceTo = null;
pausedVoiceAudio.ctx = { currentTime: 7 };
pausedVoiceAudio._activeVoice = { stop: (time) => { stoppedVoiceAt = time; } };
pausedVoiceAudio._activeVoiceGain = { gain: {} };
pausedVoiceAudio._rampParam = (_param, value) => { fadedVoiceTo = value; };
pausedVoiceAudio.setPaused(true);
ok(pausedVoiceAudio._paused === true && stoppedVoiceAt > 7 && fadedVoiceTo === 0.0001
    && pausedVoiceAudio._activeVoice === null && pausedVoiceAudio._activeVoiceGain === null,
'pause stops an active spoken stinger when its frozen caption becomes hidden');

// Duck automation must always schedule a return to unity. A pathological
// amount is intentional: it proves signature cues cannot push the persistent
// score below the authored floor, and a retrigger still receives a new release.
const duckEvents = [];
const duckParam = {
    value: 1,
    cancelAndHoldAtTime(time) { duckEvents.push({ type: 'hold', time, value: this.value }); },
    cancelScheduledValues(time) { duckEvents.push({ type: 'cancel', time, value: this.value }); },
    setValueAtTime(value, time) { this.value = value; duckEvents.push({ type: 'set', time, value }); },
    linearRampToValueAtTime(value, time) { this.value = value; duckEvents.push({ type: 'ramp', time, value }); },
};
let duckNow = 12;
const duckAudio = new AudioSystem();
duckAudio.ctx = { get currentTime() { return duckNow; } };
duckAudio.musicDuck = { gain: duckParam };
duckAudio._duck(0.95, 0.2, 0.4);
const firstRelease = duckEvents.filter(({ type }) => type === 'ramp').at(-1);
ok(duckEvents[0]?.type === 'hold', 'duck did not hold the in-flight automation value before retriggering');
ok(duckEvents.some(({ value }) => value === AUDIO_MIX.duckFloor), `duck did not respect the ${AUDIO_MIX.duckFloor} music floor`);
ok(firstRelease?.value === 1 && firstRelease.time > duckNow, 'duck did not schedule its first recovery to unity');
duckNow = 12.1;
duckAudio._duck(0.95, 0.2, 0.4);
const finalRelease = duckEvents.filter(({ type }) => type === 'ramp').at(-1);
ok(finalRelease?.value === 1 && finalRelease.time > firstRelease?.time, 'retriggered duck did not replace recovery with a later return to unity');

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
