import { AudioSystem, AUDIO_MIX } from '../../src/systems/AudioSystem.js';

const log = document.querySelector('#log');
const errors = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const approx = (actual, expected, message, epsilon = 0.0001) => {
    assert(Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon,
        `${message}: got ${actual}, expected ${expected}`);
};

try {
    const audio = new AudioSystem();
    const mix = { music: 0.16, sfx: 0.18, voice: 0.22 };
    const nodePrototype = globalThis.AudioNode?.prototype;
    assert(nodePrototype && typeof nodePrototype.connect === 'function',
        'AudioNode connection API is unavailable');
    const liveConnect = nodePrototype.connect;
    const edges = [];
    nodePrototype.connect = function connectWithReceipt(destination, ...args) {
        const result = liveConnect.call(this, destination, ...args);
        edges.push({ source: this, destination });
        return result;
    };

    // Seed before graph construction so every initial AudioParam is exact and
    // this zero-duration CI probe never waits on an AudioContext clock.
    audio.setVolumes(mix.music, mix.sfx, mix.voice);
    try {
        audio._ensure();
    } finally {
        nodePrototype.connect = liveConnect;
    }
    assert(audio.ctx, 'production AudioContext graph was not created');
    assert(audio.enabled, 'production graph construction disabled audio');
    assert(audio.musicBus && audio.sfxBus && audio.voiceBus && audio.outputBus,
        'one or more player-facing buses are missing');
    assert(new Set([audio.musicBus, audio.sfxBus, audio.voiceBus]).size === 3,
        'music, SFX, and voice did not receive independent buses');
    const hasEdge = (source, destination) => edges.some((edge) => (
        edge.source === source && edge.destination === destination
    ));
    assert(hasEdge(audio.musicBus, audio.master),
        'music bus was not routed to the master mix');
    assert(hasEdge(audio.sfxBus, audio.sfxCompressor)
        && hasEdge(audio.sfxCompressor, audio.master),
    'SFX bus did not reach the master through its compressor');
    assert(hasEdge(audio.voiceBus, audio.master),
        'voice bus was not routed to the master mix');
    assert(hasEdge(audio.master, audio.outputBus)
        && hasEdge(audio.outputBus, audio.limiter)
        && hasEdge(audio.limiter, audio.ctx.destination),
    'master/output/limiter chain did not reach the device destination');
    approx(audio.musicBus.gain.value, mix.music * AUDIO_MIX.musicTrim,
        'music bus did not use its independent seed');
    approx(audio.sfxBus.gain.value, mix.sfx * AUDIO_MIX.sfxTrim,
        'SFX bus did not use its independent seed');
    approx(audio.voiceBus.gain.value, mix.voice * AUDIO_MIX.voiceTrim,
        'voice bus did not use its independent seed');

    assert(audio.outputBus.channelInterpretation === 'speakers',
        'output bus did not use standards speaker mixing');
    assert(audio.outputBus.channelCountMode === 'explicit',
        'output bus channel count was not explicit');
    const continuity = {
        context: audio.ctx,
        music: audio.musicBus,
        sfx: audio.sfxBus,
        voice: audio.voiceBus,
        output: audio.outputBus,
    };
    assert(audio.outputBus.channelCount === 2, 'graph did not begin in stereo');
    assert(audio.setMonoAudio(true) === true && audio.outputBus.channelCount === 1,
        'mono preference did not collapse the live output bus');
    assert(audio.setMonoAudio(false) === false && audio.outputBus.channelCount === 2,
        'stereo preference did not restore the live output bus');
    assert(audio.ctx === continuity.context && audio.musicBus === continuity.music
        && audio.sfxBus === continuity.sfx && audio.voiceBus === continuity.voice
        && audio.outputBus === continuity.output,
    'mono toggle rebuilt the production graph');

    // Capture the automation boundary instead of sleeping for AudioParam ramps.
    // That proves each slider targets its own node while keeping CI independent
    // of wall-clock and virtual-time behavior.
    const ramps = [];
    const liveRamp = audio._rampParam.bind(audio);
    audio._rampParam = (param, value, now, duration) => {
        ramps.push({ param, value });
        liveRamp(param, value, now, duration);
    };
    audio.setVolumes(0.31, 0.42, 0.53);
    const targetFor = (param) => ramps.findLast((entry) => entry.param === param)?.value;
    approx(targetFor(audio.musicBus.gain), 0.31 * AUDIO_MIX.musicTrim,
        'music slider did not target the music bus');
    approx(targetFor(audio.sfxBus.gain), 0.42 * AUDIO_MIX.sfxTrim,
        'SFX slider did not target the SFX bus');
    approx(targetFor(audio.voiceBus.gain), 0.53 * AUDIO_MIX.voiceTrim,
        'voice slider did not target the voice bus');

    // Exercise the production voice source path with a tiny synthetic buffer.
    // Muting Voice must preserve the accessible transcript without opening an
    // unexplained duck in the music; restoring Voice must restore that pocket.
    let duckCount = 0;
    audio._duck = () => { duckCount++; };
    const voiceBuffer = audio.ctx.createBuffer(
        1,
        Math.max(1, Math.floor(audio.ctx.sampleRate / 8)),
        audio.ctx.sampleRate,
    );
    nodePrototype.connect = function connectWithVoiceReceipt(destination, ...args) {
        const result = liveConnect.call(this, destination, ...args);
        edges.push({ source: this, destination });
        return result;
    };
    let mutedCaption;
    let audibleCaption;
    try {
        audio.setVolumes(mix.music, mix.sfx, 0);
        approx(targetFor(audio.voiceBus.gain), 0,
            'voice mute did not target zero on the voice bus');
        mutedCaption = audio._playBossVoice('onlyEmbersRemain', voiceBuffer);
        assert(mutedCaption === 'Only embers remain.', 'muted voice lost its exact transcript');
        assert(hasEdge(audio._activeVoiceGain, audio.voiceBus),
            'muted spoken source did not route through the voice bus');
        assert(duckCount === 0, 'muted voice still ducked the music bus');
        audio.stopVoice();
        audio.setVolumes(mix.music, mix.sfx, mix.voice);
        audibleCaption = audio._playBossVoice('onlyEmbersRemain', voiceBuffer);
        assert(audibleCaption === mutedCaption, 'audible and muted voice transcripts diverged');
        assert(hasEdge(audio._activeVoiceGain, audio.voiceBus),
            'audible spoken source did not route through the voice bus');
        assert(duckCount === 1, 'audible voice did not request one music pocket');
    } finally {
        nodePrototype.connect = liveConnect;
    }

    const report = {
        mode: 'zero-duration production Web Audio graph',
        context: audio.ctx.state,
        buses: 3,
        monoContinuity: 'stereo -> mono -> stereo / graph stable',
        sliderTargets: 'independent',
        voice: 'mute-safe',
    };
    audio.dispose();
    log.textContent = JSON.stringify(report, null, 2);
    document.documentElement.dataset.qaReady = '1';
    document.documentElement.dataset.qaBuses = '3';
    document.documentElement.dataset.qaMono = 'stable';
    document.documentElement.dataset.qaVoice = 'mute-safe';
    document.title = 'DONE EXC:0 buses:3 mono:stable voice:mute-safe';
} catch (error) {
    errors.push(String(error?.message || error));
    log.textContent = errors.join('\n');
    document.documentElement.dataset.qaReady = '1';
    document.documentElement.dataset.qaBuses = 'failed';
    document.title = `DONE EXC:${errors.length}`;
}
