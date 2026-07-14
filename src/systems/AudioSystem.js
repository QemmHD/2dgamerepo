// AudioSystem — adaptive original tracker score + hybrid sample/synth SFX.
// Combat music is composed as 16-bar A/B/C/D forms in content/music.js and
// orchestrated over four pressure layers. Scene changes quantize to a bar. One
// credited CC0 menu feature streams once through HTMLAudioElement (never a huge
// decoded AudioBuffer), then returns to the procedural no-repeat playlist.
// Browser audio is created lazily and unlocked asynchronously from a real user
// gesture; unsupported/headless environments remain silent no-ops.

import {
    BOSS_PROFILES,
    BOSS_SUITES,
    BIOME_COMPOSITIONS,
    MENU_COMPOSITIONS,
    MUSIC_BY_ID,
    VICTORY_COMPOSITION,
    VOICE_STINGERS,
} from '../content/music.js';

const A4 = 440;
const hz = (midi) => A4 * Math.pow(2, (midi - 69) / 12);

// Internal gain staging. User sliders stay linear and fully authoritative;
// these trims calibrate the very different source levels of tracker voices and
// stacked combat SFX. Keeping the policy exported lets the headless validator
// guard the actual shipped mix instead of duplicating magic numbers.
export const AUDIO_MIX = Object.freeze({
    musicTrim: 0.68,
    sfxTrim: 0.55,
    voiceTrim: 0.68,
    duckDepth: 0.65,
    duckFloor: 0.55,
    textureBudgetDesktop: 6,
    textureBudgetMobile: 4,
    calmMotionFloor: 0.42,
    calmCutoff: 4000,
});

// Resolve a scale degree (can be negative or span octaves) to a MIDI note.
function degToMidi(root, scale, deg) {
    const len = scale.length;
    const oct = Math.floor(deg / len);
    const idx = ((deg % len) + len) % len;
    return root + oct * 12 + scale[idx];
}

// Tracker timbres are intentionally orchestral roles, not one oscillator with
// a different cutoff. Plucked strings use a Karplus-lite voice, bells use
// inharmonic partials, reeds/brass/choirs use distinct envelopes and doublings.
const INSTRUMENTS = Object.freeze({
    emberFlute: { type: 'triangle', cutoff: 3000, attack: 0.035, detune: 5, length: 1.6 },
    reedPipe: { type: 'square', cutoff: 1800, attack: 0.02, detune: 3, length: 1, octaveGain: 0.18 },
    lowReed: { type: 'sawtooth', cutoff: 1250, attack: 0.08, detune: 7, length: 2.1 },
    dulcimer: { pluck: true, cutoff: 3600, length: 0.8 },
    woodPluck: { pluck: true, cutoff: 2400, length: 0.7 },
    icePluck: { pluck: true, cutoff: 5200, length: 1 },
    frostGlass: { type: 'sine', cutoff: 5200, attack: 0.006, detune: 9, length: 1.8, octaveGain: 0.32 },
    glassChoir: { type: 'sine', cutoff: 4600, attack: 0.13, detune: 12, length: 2.5, fifthGain: 0.16 },
    boneReed: { type: 'square', cutoff: 1450, attack: 0.012, detune: 5, shape: 1.2, length: 0.9 },
    boneClick: { pluck: true, cutoff: 1700, length: 0.42 },
    sandOud: { pluck: true, cutoff: 3000, length: 0.75, octaveGain: 0.12 },
    brightOud: { pluck: true, cutoff: 4700, length: 0.68, octaveGain: 0.22 },
    heroStrings: { type: 'sawtooth', cutoff: 2800, attack: 0.05, detune: 11, length: 1.7, octaveGain: 0.14 },
    ironStrings: { type: 'sawtooth', cutoff: 1700, attack: 0.025, detune: 8, shape: 1.5, length: 1.15 },
    warHorn: { type: 'sawtooth', cutoff: 2100, attack: 0.07, detune: 14, shape: 1.1, length: 1.8, fifthGain: 0.2 },
    voidLead: { type: 'triangle', cutoff: 1900, attack: 0.04, detune: 15, shape: 1.2, length: 1.5, octaveGain: 0.15 },
    sunBrass: { type: 'sawtooth', cutoff: 3400, attack: 0.025, detune: 9, shape: 1.8, length: 1.25, octaveGain: 0.18 },
    stormArp: { type: 'triangle', cutoff: 4600, attack: 0.004, detune: 4, length: 0.55 },
    anvilPulse: { type: 'square', cutoff: 2100, attack: 0.003, shape: 1.4, length: 0.42 },
    graveBell: { metal: true, cutoff: 2600, length: 1.4 },
    emberBell: { metal: true, cutoff: 4300, length: 1 },
    sunBell: { metal: true, cutoff: 5200, length: 0.9 },
    warmBass: { type: 'sine', cutoff: 700, attack: 0.008, length: 1.5 },
    bowedBass: { type: 'triangle', cutoff: 850, attack: 0.08, detune: 6, length: 2.1 },
    pulseBass: { type: 'square', cutoff: 620, attack: 0.006, shape: 1.1, length: 0.8 },
    subDrone: { type: 'sine', cutoff: 430, attack: 0.09, detune: 3, length: 2.5 },
    choir: { type: 'sine', cutoff: 1800, attack: 0.2, detune: 12, length: 3.2 },
    forestStrings: { type: 'triangle', cutoff: 1800, attack: 0.16, detune: 9, length: 2.8 },
    nightStrings: { type: 'triangle', cutoff: 1300, attack: 0.22, detune: 14, length: 3.4 },
    brassPad: { type: 'sawtooth', cutoff: 1250, attack: 0.18, detune: 10, length: 2.7 },
    auroraPad: { type: 'sine', cutoff: 3000, attack: 0.28, detune: 16, length: 3.7 },
    voidChoir: { type: 'triangle', cutoff: 950, attack: 0.24, detune: 17, shape: 0.8, length: 3.3 },
    sunDrone: { type: 'sawtooth', cutoff: 1100, attack: 0.2, detune: 7, length: 3 },
    warChoir: { type: 'sawtooth', cutoff: 1500, attack: 0.15, detune: 15, shape: 1.1, length: 3 },
});

const GROOVES = Object.freeze({
    hearth: { kick: [0, 8], snare: [], hat: [4, 12], bass: [0, 8] },
    vigil: { kick: [0], snare: [], hat: [8], bass: [0, 10] },
    march: { kick: [0, 8], snare: [4, 12], hat: [2, 6, 10, 14], bass: [0, 6, 8, 14] },
    hearthDrive: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], bass: [0, 3, 6, 8, 11, 14] },
    woodland: { kick: [0, 7, 10], snare: [4, 12], hat: [2, 5, 9, 14], bass: [0, 5, 8, 13] },
    frost: { kick: [0, 8], snare: [12], hat: [2, 6, 10, 14], bass: [0, 6, 8, 14] },
    glacier: { kick: [0, 10], snare: [6, 14], hat: [3, 7, 11, 15], bass: [0, 8, 12] },
    boneMarch: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 13, 14], bass: [0, 2, 4, 6, 8, 10, 12, 14] },
    tomb: { kick: [0, 10], snare: [6], hat: [3, 7, 11, 15], bass: [0, 8, 11] },
    sand: { kick: [0, 4, 8, 12], snare: [6, 14], hat: [2, 5, 10, 13], bass: [0, 3, 6, 8, 11, 14] },
    caravan: { kick: [0, 3, 8, 11], snare: [4, 12], hat: [2, 5, 7, 10, 13, 15], bass: [0, 3, 6, 9, 12, 14] },
    tempestWar: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], bass: [0, 2, 4, 6, 8, 10, 12, 14] },
    colossusWar: { kick: [0, 3, 8, 11], snare: [4, 12], hat: [2, 6, 10, 14], bass: [0, 4, 6, 8, 12, 14] },
    voidWar: { kick: [0, 6, 8, 14], snare: [4, 12], hat: [1, 5, 9, 13], bass: [0, 3, 6, 8, 11, 14] },
    infernoWar: { kick: [0, 3, 6, 8, 11, 14], snare: [4, 12], hat: [2, 5, 7, 10, 13, 15], bass: [0, 2, 4, 6, 8, 10, 12, 14] },
    triumph: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], bass: [0, 4, 8, 12] },
});

// Hybrid one-shot layer — curated CC0 (Kenney.nl) samples for the most TACTILE
// cues, one bank per cue (variants are picked at random + pitch-jittered so rapid
// repeats never sound machine-gunned). Files live in src/assets/audio/sfx/ and are
// fetched lazily on first user gesture; a cue with no loaded buffer transparently
// falls back to its procedural voice. `gain` trims each bank to sit under the synth
// mix; `jitter` is the ± playbackRate wobble. Everything NOT listed here (shots,
// elemental procs, fanfares, and ALL music) is fully procedural.
const SFX_SAMPLES = {
    kill:     { files: ['impactPunch_medium_000.ogg', 'impactPunch_medium_001.ogg', 'impactPunch_medium_003.ogg'], gain: 0.4, jitter: 0.09 },
    hurt:     { files: ['impactPunch_heavy_000.ogg', 'impactPunch_heavy_002.ogg'], gain: 0.55, jitter: 0.05 },
    coin:     { files: ['handleCoins.ogg', 'handleCoins2.ogg'], gain: 0.4, jitter: 0.05 },
    purchase: { files: ['handleSmallLeather.ogg', 'handleSmallLeather2.ogg'], gain: 0.45, jitter: 0.04 },
    equip:    { files: ['metalClick.ogg'], gain: 0.42, jitter: 0.05 },
    chest:    { files: ['metalLatch.ogg'], gain: 0.5, jitter: 0.03 },
    click:    { files: ['click_001.ogg', 'click_002.ogg'], gain: 0.42, jitter: 0.04 },
    hover:    { files: ['tick_001.ogg', 'tick_002.ogg'], gain: 0.28, jitter: 0.06 },
    gem:      { files: ['glass_001.ogg', 'glass_003.ogg', 'glass_005.ogg'], gain: 0.32, jitter: 0.09 },
    reroll:   { files: ['scratch_001.ogg', 'scratch_003.ogg'], gain: 0.4, jitter: 0.05 },
};

export class AudioSystem {
    constructor() {
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        this.enabled = !!AC;
        this._AC = AC || null;
        this.ctx = null;
        this.master = null;
        this.outputBus = null;   // explicit 2ch/1ch player mix before limiting
        this.masterFilter = null; // retained as a compatibility field; SFX stay unfiltered
        this.limiter = null;      // brick-wall limiter (clip guard)
        this.musicBus = null;
        this.musicDuck = null;    // sidechain duck gate for the music bed
        this.musicPause = null;   // independent pause gate (SFX ducking cannot undo it)
        this.musicFilter = null;  // music-only tone color; never dulls gameplay SFX
        this.sfxBus = null;
        this.sfxCompressor = null; // catches dense stacks before the full-mix limiter
        this.voiceBus = null;
        this.verbSend = null;
        this.volMusic = 0.7;
        this.volSfx = 0.8;
        this.volVoice = 0.8;
        this.monoAudio = false;
        this.theme = null;
        this._schedId = null;
        this._nextTime = 0;
        this._step = 0;
        this._bar = 0;
        this._lastSfx = {};
        this._sfxWindowT = -Infinity;
        this._sfxWindowN = 0;
        this._noiseBuf = null;
        this._intensity = 0;
        this._lastStand = false;
        this._combatScene = 'calm';
        this._activeScore = null;
        this._pendingScore = null;
        this._formCycles = 0;
        this._menuBag = [];
        this._lastMenuId = null;
        this._biomeHistory = {};
        this._bossId = null;
        this._musicLayers = {};
        this._layerTargets = {};
        this._toneTarget = null;
        this._unlockPromise = null;
        this._paused = false;
        this._recorded = null;
        this._recordedSource = null;
        this._recordedGain = null;
        this._voiceBuffers = {};
        this._voiceLoads = {};
        this._lastVoiceId = null;
        this._lastVoiceAt = -Infinity;
        this._activeVoice = null;
        this._activeVoiceGain = null;
        this._shapeCache = {};
        this._samples = {};          // cue key → [decoded AudioBuffer, …]
        this._samplesState = 'idle'; // idle → loading → ready | skip
        this._voicesThisStep = 0;
        this._biome = 'emberwood';
        // Mobile detection (fewer voices, mono oscillators) — guarded.
        let mob = false;
        try {
            mob = (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
                (typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches);
        } catch (e) { mob = false; }
        this._mobile = mob;
        this._voiceCap = mob ? 6 : 10;
        // Short-lived synth graphs are disconnected once their audio-time tail
        // expires. This is especially important for pluck feedback loops, which
        // otherwise remain reachable from the destination during long runs.
        this._cleanupQueue = [];
    }

    _ensure() {
        if (!this.enabled || this.ctx) return;
        try {
            this.ctx = new this._AC();
            // A disposed system may be unlocked again by an embedding shell.
            // Targets belong to the old AudioContext and must not suppress the
            // first automation pass on the freshly-created graph.
            this._layerTargets = {};
            this._toneTarget = null;
            // Master has only clip protection. Tone shaping belongs to music,
            // otherwise a low-HP color pass also muffles hit and warning cues.
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.72;
            // One standards-defined channel-mode switch covers every source:
            // tracker/streamed music, SFX, reverb and decoded voice all meet at
            // master before this point. `speakers` downmixes stereo to
            // 0.5 * (L + R); the limiter remains AFTER the downmix so a mono
            // sum cannot clip the output.
            this.outputBus = this.ctx.createGain();
            this.outputBus.channelInterpretation = 'speakers';
            this.outputBus.channelCountMode = 'explicit';
            this.outputBus.channelCount = this.monoAudio ? 1 : 2;
            this.limiter = this.ctx.createDynamicsCompressor();
            this.limiter.threshold.value = -3;
            this.limiter.knee.value = 0;
            this.limiter.ratio.value = 20;
            this.limiter.attack.value = 0.003;
            this.limiter.release.value = 0.12;
            this.master.connect(this.outputBus);
            this.outputBus.connect(this.limiter);
            this.limiter.connect(this.ctx.destination);

            // Light reverb: a short feedback delay tap for ambience (stable fb).
            const delay = this.ctx.createDelay(0.5);
            delay.delayTime.value = 0.17;
            const fb = this.ctx.createGain();
            fb.gain.value = 0.28;
            const verbOut = this.ctx.createGain();
            verbOut.gain.value = 0.5;
            delay.connect(fb); fb.connect(delay);
            delay.connect(verbOut); verbOut.connect(this.master);
            this.verbSend = this.ctx.createGain();
            this.verbSend.gain.value = 0.18;
            this.verbSend.connect(delay);

            this.musicBus = this.ctx.createGain();
            this.musicBus.gain.value = this.volMusic * AUDIO_MIX.musicTrim;
            this.musicBus.connect(this.master);
            this.musicBus.connect(this.verbSend);
            // Tracker/stream → duck → pause → MUSIC-ONLY filter → music bus.
            this.musicDuck = this.ctx.createGain();
            this.musicDuck.gain.value = 1;
            this.musicPause = this.ctx.createGain();
            this.musicPause.gain.value = this._paused ? 0.45 : 1;
            this.musicFilter = this.ctx.createBiquadFilter();
            this.musicFilter.type = 'lowpass';
            this.musicFilter.frequency.value = AUDIO_MIX.calmCutoff;
            this.musicFilter.Q.value = 0.35;
            this.musicDuck.connect(this.musicPause);
            this.musicPause.connect(this.musicFilter);
            this.musicFilter.connect(this.musicBus);

            for (const [name, initial] of Object.entries({ bed: 1, motion: AUDIO_MIX.calmMotionFloor, swarm: 0, apex: 0 })) {
                const layer = this.ctx.createGain();
                layer.gain.value = initial;
                layer.connect(this.musicDuck);
                this._musicLayers[name] = layer;
            }

            this.sfxBus = this.ctx.createGain();
            this.sfxBus.gain.value = this.volSfx * AUDIO_MIX.sfxTrim;
            this.sfxCompressor = this.ctx.createDynamicsCompressor();
            this.sfxCompressor.threshold.value = -9;
            this.sfxCompressor.knee.value = 6;
            this.sfxCompressor.ratio.value = 4;
            this.sfxCompressor.attack.value = 0.003;
            this.sfxCompressor.release.value = 0.09;
            this.sfxBus.connect(this.sfxCompressor);
            this.sfxCompressor.connect(this.master);
            this.voiceBus = this.ctx.createGain();
            this.voiceBus.gain.value = this.volVoice * AUDIO_MIX.voiceTrim;
            this.voiceBus.connect(this.master);

            const len = Math.floor(this.ctx.sampleRate);
            this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
            const d = this._noiseBuf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

            this._applyScoreMix(this._activeScore);
        } catch (e) {
            this.enabled = false;
        }
    }

    async unlock() {
        if (!this.enabled) return false;
        if (this._unlockPromise) return this._unlockPromise;
        this._ensure();
        if (!this.ctx) return false;
        const task = (async () => {
            try {
                // Safari also exposes `interrupted`; resume every non-running
                // state and await it before starting the look-ahead scheduler.
                if (this.ctx.state !== 'running' && typeof this.ctx.resume === 'function') {
                    await this.ctx.resume();
                }
                if (this.ctx.state !== 'running') return false;
                if (this._schedId == null) this._startScheduler();
                this._loadSamples();
                if (this._bossId) this.prefetchBoss(this._bossId);
                if (this._activeScore?.kind === 'recorded') this._startRecorded(this._activeScore);
                return true;
            } catch (e) {
                return false;
            }
        })();
        // Assign before awaiting, then clear only this exact attempt. Putting
        // the clear inside the immediately-invoked async function races when a
        // running context completes synchronously and can leave a stale,
        // forever-resolved promise that blocks recovery from later suspension.
        this._unlockPromise = task;
        try {
            return await task;
        } finally {
            if (this._unlockPromise === task) this._unlockPromise = null;
        }
    }

    // Backward-compatible name used by Game and menu actions.
    resume() { return this.unlock(); }

    // ── Hybrid sample loader ─────────────────────────────────────────────
    // Fetch + decode the CC0 one-shots once, on the first user gesture. Per-file
    // failures are swallowed (that cue just keeps its synth voice); no fetch (or a
    // failed decode) leaves _samples empty so EVERY cue falls back gracefully.
    _loadSamples() {
        if (!this.ctx || this._samplesState !== 'idle') return;
        if (typeof fetch !== 'function') { this._samplesState = 'skip'; return; }
        this._samplesState = 'loading';
        // decodeAudioData is promise-based in modern browsers, callback-based in old
        // ones — support both so nothing hangs or throws.
        const decode = (ab) => new Promise((res, rej) => {
            let done = false;
            const ok = (b) => { if (!done) { done = true; res(b); } };
            const no = (e) => { if (!done) { done = true; rej(e); } };
            try {
                const p = this.ctx.decodeAudioData(ab, ok, no);
                if (p && typeof p.then === 'function') p.then(ok, no);
            } catch (e) { no(e); }
        });
        const jobs = [];
        for (const key of Object.keys(SFX_SAMPLES)) {
            this._samples[key] = [];
            for (const file of SFX_SAMPLES[key].files) {
                let url;
                try { url = new URL(`../assets/audio/sfx/${file}`, import.meta.url).href; }
                catch (e) { continue; }
                jobs.push(
                    fetch(url)
                        .then((r) => { if (!r.ok) throw new Error(`http ${r.status}`); return r.arrayBuffer(); })
                        .then((ab) => decode(ab))
                        .then((buf) => { if (buf) this._samples[key].push(buf); })
                        .catch(() => { /* leave slot empty → synth fallback */ })
                );
            }
        }
        Promise.all(jobs).then(() => { this._samplesState = 'ready'; });
    }

    // Play one loaded variant of a cue's sample bank through sfxBus (so it still
    // hits the master low-pass + limiter). Returns false if no sample is available
    // yet, so the caller can fall through to its procedural voice.
    _playSample(key) {
        if (!this.ctx || !this.sfxBus) return false;
        const bank = this._samples[key];
        if (!bank || !bank.length) return false;
        const cfg = SFX_SAMPLES[key] || {};
        const buf = bank.length === 1 ? bank[0] : bank[(Math.random() * bank.length) | 0];
        if (!buf) return false;
        const t = this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        if (cfg.jitter) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * cfg.jitter;
        const g = this.ctx.createGain();
        g.gain.value = cfg.gain != null ? cfg.gain : 0.5;
        src.connect(g); g.connect(this.sfxBus);
        src.start(t);
        // Stop past the real end (slower playbackRate stretches it) so a jittered
        // one-shot is never clipped early; the source is non-looping regardless.
        const rate = src.playbackRate.value || 1;
        src.stop(t + buf.duration / rate + 0.1);
        this._queueCleanup([src, g], t + buf.duration / rate + 0.2);
        return true;
    }

    _decodeBuffer(ab) {
        if (!this.ctx) return Promise.reject(new Error('audio context unavailable'));
        return new Promise((resolve, reject) => {
            let done = false;
            const ok = (buffer) => { if (!done) { done = true; resolve(buffer); } };
            const no = (error) => { if (!done) { done = true; reject(error); } };
            try {
                const pending = this.ctx.decodeAudioData(ab, ok, no);
                if (pending?.then) pending.then(ok, no);
            } catch (error) { no(error); }
        });
    }

    _loadVoice(id) {
        if (this._voiceBuffers[id]) return Promise.resolve(this._voiceBuffers[id]);
        if (this._voiceLoads[id]) return this._voiceLoads[id];
        const cue = VOICE_STINGERS[id];
        if (!cue || !this.ctx || typeof fetch !== 'function') return Promise.resolve(null);
        this._voiceLoads[id] = fetch(cue.file)
            .then((response) => { if (!response.ok) throw new Error(`http ${response.status}`); return response.arrayBuffer(); })
            .then((data) => this._decodeBuffer(data))
            .then((buffer) => {
                if (buffer) this._voiceBuffers[id] = buffer;
                return buffer || null;
            })
            .catch(() => null)
            .finally(() => { delete this._voiceLoads[id]; });
        return this._voiceLoads[id];
    }

    prefetchBoss(id = this._bossId) {
        const profile = BOSS_PROFILES[id];
        if (!profile || !this.ctx) return Promise.resolve(false);
        const ids = [...new Set([...(profile.voices.arrival || []), ...(profile.voices.phase2 || [])])];
        return Promise.all(ids.map((voiceId) => this._loadVoice(voiceId))).then((buffers) => buffers.some(Boolean));
    }

    bossVoice(event = 'arrival', bossId = null) {
        if (bossId) this.setBossProfile(bossId);
        const profile = BOSS_PROFILES[this._bossId];
        if (!profile || !this.ctx || !this.voiceBus) return false;
        const semantic = (profile.voices[event] || []).filter((id) => VOICE_STINGERS[id]);
        // Refuse only an *immediate* repeat. Bosses arrive minutes apart, so a
        // semantically correct line may return after a cooldown instead of
        // permanently silencing every later boss that shares that line.
        const repeatReady = this.ctx.currentTime - this._lastVoiceAt >= 20;
        const candidates = semantic.filter((id) => id !== this._lastVoiceId || repeatReady);
        // With only one semantically valid line inside the cooldown, silence is
        // better than assigning "the warden" to an unrelated creature.
        if (!candidates.length) return false;
        const ready = candidates.filter((id) => this._voiceBuffers[id]);
        if (!ready.length) {
            candidates.forEach((id) => { this._loadVoice(id); });
            return false;
        }
        const id = ready[Math.floor(Math.random() * ready.length)];
        return this._playBossVoice(id, this._voiceBuffers[id]);
    }

    _playBossVoice(id, buffer) {
        if (!this.ctx || !buffer || !this.voiceBus) return false;
        const now = this.ctx.currentTime;
        if (this._activeVoice && this._activeVoiceGain) {
            const old = this._activeVoice;
            this._rampParam(this._activeVoiceGain.gain, 0.0001, now, 0.05);
            try { old.stop(now + 0.06); } catch (e) { /* already ended */ }
        }
        const source = this.ctx.createBufferSource();
        const gain = this.ctx.createGain();
        source.buffer = buffer;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.9, now + 0.035);
        const fadeAt = Math.max(now + 0.08, now + buffer.duration - 0.24);
        gain.gain.setValueAtTime(0.9, fadeAt);
        gain.gain.linearRampToValueAtTime(0.0001, now + buffer.duration);
        source.connect(gain);
        gain.connect(this.voiceBus);
        source.onended = () => {
            if (this._activeVoice === source) {
                this._activeVoice = null;
                this._activeVoiceGain = null;
            }
            try { source.disconnect(); } catch (e) { /* no-op */ }
            try { gain.disconnect(); } catch (e) { /* no-op */ }
        };
        source.start(now);
        this._activeVoice = source;
        this._activeVoiceGain = gain;
        this._lastVoiceId = id;
        this._lastVoiceAt = now;
        // A muted voice bus must not create an unexplained hole in the score.
        if (this.volVoice > 0) this._duck(0.55, Math.max(0.08, buffer.duration - 0.35), 0.55);
        // The caller uses this exact transcript as the accessibility caption.
        return VOICE_STINGERS[id]?.line || false;
    }

    stopVoice() {
        const source = this._activeVoice;
        if (!source) return false;
        const now = this.ctx?.currentTime ?? 0;
        this._rampParam(this._activeVoiceGain?.gain, 0.0001, now, 0.035);
        try { source.stop(now + 0.045); } catch (e) { /* already stopped */ }
        this._activeVoice = null;
        this._activeVoiceGain = null;
        return true;
    }

    setVolumes(music, sfx, voice = sfx) {
        if (typeof music === 'number') this.volMusic = Math.max(0, Math.min(1, music));
        if (typeof sfx === 'number') this.volSfx = Math.max(0, Math.min(1, sfx));
        if (typeof voice === 'number') this.volVoice = Math.max(0, Math.min(1, voice));
        const now = this.ctx?.currentTime ?? 0;
        this._rampParam(this.musicBus?.gain, this.volMusic * AUDIO_MIX.musicTrim, now, 0.04);
        this._rampParam(this.sfxBus?.gain, this.volSfx * AUDIO_MIX.sfxTrim, now, 0.04);
        this._rampParam(this.voiceBus?.gain, this.volVoice * AUDIO_MIX.voiceTrim, now, 0.04);
        if (this._recorded && !this._recordedSource) this._recorded.volume = this.volMusic * AUDIO_MIX.musicTrim;
    }

    setMonoAudio(on) {
        this.monoAudio = on === true;
        if (this.outputBus) this.outputBus.channelCount = this.monoAudio ? 1 : 2;
        return this.monoAudio;
    }

    _rampParam(param, value, now = 0, duration = 0.2) {
        if (!param) return;
        try {
            // `AudioParam.value` is its intrinsic value, not necessarily the
            // instantaneous value of scheduled automation. Holding the real
            // curve prevents rapid adaptive updates from snapping gains/tone
            // back to their construction values on every frame.
            if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
            else {
                param.cancelScheduledValues(now);
                param.setValueAtTime(param.value, now);
            }
            param.linearRampToValueAtTime(value, now + duration);
        } catch (e) { param.value = value; }
    }

    _refillMenuBag() {
        const ids = MENU_COMPOSITIONS.map((score) => score.id);
        for (let i = ids.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        if (ids.length > 1 && ids[0] === this._lastMenuId) [ids[0], ids[1]] = [ids[1], ids[0]];
        this._menuBag = ids;
    }

    _nextMenuScore() {
        if (!this._menuBag.length) this._refillMenuBag();
        let id = this._menuBag.shift();
        if (id === this._lastMenuId && this._menuBag.length) {
            this._menuBag.push(id);
            id = this._menuBag.shift();
        }
        this._lastMenuId = id;
        return MUSIC_BY_ID[id] || MENU_COMPOSITIONS[0];
    }

    _nextBiomeScore() {
        const choices = BIOME_COMPOSITIONS[this._biome] || BIOME_COMPOSITIONS.emberwood;
        const last = this._biomeHistory[this._biome];
        const available = choices.filter((score) => score.id !== last);
        const score = (available.length ? available : choices)[Math.floor(Math.random() * (available.length || choices.length))];
        this._biomeHistory[this._biome] = score.id;
        return score;
    }

    _bossScore() {
        const key = BOSS_PROFILES[this._bossId]?.suite;
        return BOSS_SUITES[key] || BOSS_SUITES.tempest;
    }

    playMusic(theme, detail = null) {
        if (theme === 'boss' && (typeof detail === 'string' || detail?.bossId)) {
            this.setBossProfile(typeof detail === 'string' ? detail : detail.bossId);
        }
        const was = this.theme;
        let score = null;
        if (theme === 'menu') score = (was === 'menu' && this._activeScore) ? this._activeScore : this._nextMenuScore();
        else if (theme === 'gameplay') score = this._nextBiomeScore();
        else if (theme === 'boss') score = this._bossScore();
        else if (theme === 'victory') score = VICTORY_COMPOSITION;
        if (!score) { this.stopMusic(); return; }

        this.theme = theme;
        // A menu visit is an authored release, never a continuation of the last
        // boss-final/last-stand mix. Reset both policy state and layer targets.
        if (theme === 'menu') this.setCombatState({ intensity: 0, scene: 'calm', lastStand: false });
        this.setPaused(false);
        const immediate = !this._activeScore || !was || this._activeScore.kind === 'recorded';
        if (immediate) this._applyScore(score);
        else if (this._activeScore.id !== score.id) this._pendingScore = score;
        if (this.ctx?.state === 'running' && this._schedId == null) this._startScheduler();
    }

    stopMusic() {
        this.theme = null;
        this._pendingScore = null;
        this._activeScore = null;
        this._stopRecorded(true);
        this.setPaused(false);
        if (this.ctx) this._nextTime = this.ctx.currentTime + 0.08;
        this._step = 0;
        this._bar = 0;
    }

    _applyScore(score) {
        if (!score) return;
        this._stopRecorded(true);
        this._activeScore = score;
        this._pendingScore = null;
        this._step = 0;
        this._bar = 0;
        this._formCycles = 0;
        this._applyScoreMix(score);
        if (score.kind === 'recorded' && this.ctx?.state === 'running') this._startRecorded(score);
    }

    _applyScoreMix(score) {
        if (this.verbSend && score?.reverb != null) {
            this._rampParam(this.verbSend.gain, score.reverb, this.ctx.currentTime, 0.35);
        }
        this._updateMusicTone();
    }

    _fallbackRecorded(score) {
        if (this._activeScore?.id !== score?.id) return;
        const fallback = MUSIC_BY_ID[score.fallbackId] || MENU_COMPOSITIONS.find((item) => item.kind === 'tracker');
        this._applyScore(fallback);
    }

    _startRecorded(score) {
        if (!score || score.kind !== 'recorded' || this._recorded || typeof Audio !== 'function') {
            if (score?.kind === 'recorded' && typeof Audio !== 'function') this._fallbackRecorded(score);
            return;
        }
        let audio;
        try {
            audio = new Audio();
            audio.preload = 'metadata';
            audio.loop = false;
            audio.src = score.file;
            audio.addEventListener('ended', () => {
                if (this._recorded !== audio || this.theme !== 'menu' || this._activeScore?.id !== score.id) return;
                this._stopRecorded(false);
                this._applyScore(this._nextMenuScore());
            }, { once: true });
            const source = this.ctx.createMediaElementSource(audio);
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.92, this.ctx.currentTime + 0.35);
            source.connect(gain);
            gain.connect(this.musicDuck);
            this._recorded = audio;
            this._recordedSource = source;
            this._recordedGain = gain;
            const promise = audio.play();
            if (promise?.catch) promise.catch(() => {
                if (this._recorded !== audio) return;
                this._stopRecorded(false);
                this._fallbackRecorded(score);
            });
        } catch (e) {
            try { audio?.pause(); } catch (ignored) { /* no-op */ }
            this._recorded = null;
            this._recordedSource = null;
            this._recordedGain = null;
            this._fallbackRecorded(score);
        }
    }

    _stopRecorded(fade = false) {
        const audio = this._recorded;
        const source = this._recordedSource;
        const gain = this._recordedGain;
        this._recorded = null;
        this._recordedSource = null;
        this._recordedGain = null;
        if (!audio) return;
        const finish = () => {
            try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) { /* no-op */ }
            try { source?.disconnect(); } catch (e) { /* no-op */ }
            try { gain?.disconnect(); } catch (e) { /* no-op */ }
        };
        if (fade && gain && this.ctx) {
            this._rampParam(gain.gain, 0.0001, this.ctx.currentTime, 0.12);
            setTimeout(finish, 150);
        } else finish();
    }

    setBiome(id) {
        this._biome = BIOME_COMPOSITIONS[id] ? id : 'emberwood';
    }

    // Kept for callers from older builds; composition selection now happens at
    // playMusic('gameplay') so each run/post-boss return can choose a new song.
    _applyBiome() {
        if (this.theme === 'gameplay') this._pendingScore = this._nextBiomeScore();
    }

    setIntensity(level) {
        this.setCombatState({ intensity: level, scene: this._combatScene, lastStand: this._lastStand });
    }

    setCombatState(state = {}) {
        const v = Math.max(0, Math.min(1, Number(state.intensity) || 0));
        this._intensity = v;
        this._lastStand = state.lastStand === true;
        this._combatScene = state.scene || this._combatScene || 'calm';
        const scene = this._combatScene;
        const targets = scene === 'bossFinal' ? { bed: 1, motion: 1, swarm: 1, apex: 1 }
            : scene === 'boss' ? { bed: 1, motion: 1, swarm: 0.72, apex: 0.88 }
                : scene === 'onslaught' ? { bed: 1, motion: 1, swarm: 1, apex: 0.68 }
                    : scene === 'swarm' ? { bed: 1, motion: 0.9, swarm: 0.72, apex: 0.12 }
                        : scene === 'hunt' ? { bed: 1, motion: 0.65 + v * 0.2, swarm: 0.08, apex: 0 }
                            : { bed: 1, motion: AUDIO_MIX.calmMotionFloor + v * 0.26, swarm: 0, apex: 0 };
        if (this.theme === 'boss') targets.apex = Math.max(targets.apex, 0.88);
        if (this.ctx) {
            const now = this.ctx.currentTime;
            for (const [name, target] of Object.entries(targets)) {
                if (Math.abs((this._layerTargets[name] ?? -1) - target) < 0.015) continue;
                this._layerTargets[name] = target;
                this._rampParam(this._musicLayers[name]?.gain, target, now, 0.28);
            }
        }
        this._updateMusicTone();
    }

    _updateMusicTone() {
        if (!this.ctx || !this.musicFilter) return;
        // Last stand adds danger color, but never collapses the whole score's
        // intensity. It trims only some air while a new pedal voice supplies heat.
        // Quantize the continuously-smoothed pressure so this method (called by
        // gameplay every frame) does not cancel/rebuild a filter ramp 60 times
        // per second. Twelve audible steps still track chaos smoothly.
        const toneIntensity = Math.round(this._intensity * 12) / 12;
        let cutoff = AUDIO_MIX.calmCutoff + toneIntensity * 4400;
        if (this._lastStand) cutoff -= 650;
        if (this._combatScene === 'bossFinal') cutoff += 500;
        cutoff = Math.max(3400, Math.min(9200, cutoff));
        if (this._toneTarget != null && Math.abs(this._toneTarget - cutoff) < 1) return;
        this._toneTarget = cutoff;
        this._rampParam(this.musicFilter.frequency, cutoff, this.ctx.currentTime, 0.22);
    }

    setBossProfile(id) {
        this._bossId = BOSS_PROFILES[id] ? id : null;
        if (this._bossId) this.prefetchBoss(this._bossId);
        if (this.theme === 'boss') {
            const score = this._bossScore();
            if (this._activeScore?.id !== score.id) this._pendingScore = score;
        }
        return !!this._bossId;
    }

    musicEvent(name, detail = null) {
        if (detail?.bossId) this.setBossProfile(detail.bossId);
        let caption = false;
        if (name === 'phase2' || name === 'bossFinal') {
            this.setCombatState({ intensity: 1, scene: 'bossFinal', lastStand: this._lastStand });
            if (this.ctx && this._activeScore?.kind === 'tracker') {
                const t = this.ctx.currentTime + 0.02;
                const root = this._activeScore.root;
                // Event stingers are outside the sequencer step. Give the
                // signature hit a fresh budget so a dense mobile downbeat cannot
                // nondeterministically swallow it.
                this._voicesThisStep = 0;
                this._playInstrument(this._activeScore.instruments.lead, root + 12, t, 0.45, 0.11, this._musicLayers.apex);
                this._snare(t + 0.1, 1.15, this._musicLayers.apex, this._activeScore.groove);
            }
            caption = this.bossVoice('phase2');
        } else if (name === 'bossArrival') {
            caption = this.bossVoice('arrival');
        }
        return caption;
    }

    // ── Music scheduler ──────────────────────────────────────────────────
    _startScheduler() {
        if (!this.ctx || this._schedId != null) return;
        this._nextTime = this.ctx.currentTime + 0.08;
        this._step = 0;
        this._bar = 0;
        this._schedId = setInterval(() => this._schedulerTick(), 25);
    }

    _schedulerTick() {
        if (!this.ctx) return;
        this._drainCleanup();
        if (this.ctx.state !== 'running') return;
        if (!this.theme || !this._activeScore || this._activeScore.kind !== 'tracker') {
            // A stopped/streaming score does not silently advance a fake
            // tracker clock. The next tracker always starts at bar one.
            this._nextTime = this.ctx.currentTime + 0.08;
            return;
        }
        const now = this.ctx.currentTime;
        // Background throttling and device sleep can leave the tracker clock
        // minutes behind. Skip the missing wall-clock time rather than trying
        // to manufacture every missed sixteenth in one catastrophic burst.
        if (!Number.isFinite(this._nextTime) || this._nextTime < now - 0.25) {
            this._nextTime = now + 0.04;
        }
        const horizon = now + 0.2;
        let scheduled = 0;
        const maxSteps = 24;
        while (this._nextTime < horizon && scheduled < maxSteps) {
            const score = this._activeScore;
            const sixteenth = (60 / score.bpm) / 4;
            const swingOff = (this._step % 2 === 1) ? sixteenth * (score.swing || 0) : 0;
            this._scheduleStep(this._step, this._nextTime + swingOff);
            scheduled++;
            this._nextTime += sixteenth;
            this._step = (this._step + 1) % 16;
            if (this._step === 0) {
                if (this._pendingScore) {
                    this._applyScore(this._pendingScore);
                    if (this._activeScore.kind !== 'tracker') break;
                } else {
                    this._bar = (this._bar + 1) % score.form.length;
                    if (this._bar === 0) {
                        this._formCycles++;
                        if (this.theme === 'menu' && this._formCycles >= 2) this._pendingScore = this._nextMenuScore();
                    }
                }
            }
        }
        // Defensive ceiling for malformed/ultra-fast future content.
        if (scheduled >= maxSteps && this._nextTime < horizon) this._nextTime = now + 0.04;
    }

    _scheduleStep(step, t) {
        const def = this._activeScore;
        if (!def || def.kind !== 'tracker' || !this.musicDuck) return;
        this._voicesThisStep = 0;   // reset the per-step voice budget
        const e = def.energy;
        const bar = this._bar;
        const sectionName = def.form[bar % def.form.length];
        const section = def.sections[sectionName];
        const chord = section.progression[bar % section.progression.length];
        const root = def.root + chord;
        const beatDur = (60 / def.bpm) / 4;
        const groove = GROOVES[def.groove] || GROOVES.hearthDrive;
        const bed = this._musicLayers.bed || this.musicDuck;
        const motion = this._musicLayers.motion || this.musicDuck;
        const swarm = this._musicLayers.swarm || this.musicDuck;
        const apex = this._musicLayers.apex || this.musicDuck;
        const secGain = ({ A: 0.82, B: 0.96, C: 1.06, D: 1.15 })[sectionName] || 1;
        const breath = (bar === 0 && step === 0) ? 0.55 : 1;
        const ix = this._intensity;

        if (groove.kick.includes(step)) this._kick(t, e * 0.72 * secGain, bed);
        if (groove.snare.includes(step)) this._snare(t, e * 0.72, motion, def.groove);
        if (groove.hat.includes(step)) this._hat(t, e * (step % 4 === 0 ? 0.55 : 0.78), swarm, def.groove);
        if (sectionName === 'D' && step >= 12) this._hat(t, e * 0.52, swarm, def.groove);
        if (ix > 0.78 && (step === 6 || step === 14)) this._kick(t, e * 0.48, apex);

        if (groove.bass.includes(step)) {
            const i = groove.bass.indexOf(step);
            const walk = section.bassWalk[i % section.bassWalk.length] || 0;
            this._playInstrument(def.instruments.bass, degToMidi(root, def.scale, walk) - 12,
                t, beatDur, (step === 0 ? 0.13 : 0.095) * e * secGain, bed);
        }

        const deg = section.melody[step];
        if (deg !== null && deg !== undefined) {
            this._playInstrument(def.instruments.lead, degToMidi(root, def.scale, deg),
                t, beatDur, 0.052 * e * secGain * breath, motion);
        }

        const counter = section.counter.length ? section.counter[step % section.counter.length]
            : (deg == null && step % 2 === 1 ? [0, 2, 4, 7][(bar + step) % 4] : null);
        if (counter !== null && counter !== undefined) {
            this._playInstrument(def.instruments.counter, degToMidi(root, def.scale, counter) + 12,
                t, beatDur * 0.72, 0.026 * e * secGain, swarm);
        }

        if (step === 0) {
            const voicing = sectionName === 'D' ? [0, 2, 4, 6] : [0, 2, 4];
            for (const pd of voicing) {
                this._playInstrument(def.instruments.pad, degToMidi(root, def.scale, pd),
                    t, beatDur * 4, 0.019 * e * breath, bed);
            }
        }

        if ((this.theme === 'boss' || this._combatScene === 'onslaught' || this._combatScene === 'bossFinal') && step % 4 === 0) {
            const od = [0, 4, 2, 5][(step / 4 + bar) % 4];
            this._playInstrument(def.instruments.lead, degToMidi(root, def.scale, od) + 12,
                t, beatDur * 0.62, 0.026 * e, apex);
        }
        if (this._lastStand && (step === 0 || step === 8)) {
            this._playInstrument(def.instruments.bass, degToMidi(root, def.scale, 0) - 12,
                t, beatDur * 2.3, 0.055, apex);
        }
    }

    _playInstrument(name, midi, t, beatDur, gain, bus) {
        const preset = INSTRUMENTS[name] || INSTRUMENTS.emberFlute;
        const freq = hz(midi);
        const dur = Math.max(0.04, beatDur * (preset.length || 1));
        if (preset.pluck) {
            this._pluck(freq, t, { dur, gain, cutoff: preset.cutoff, damp: 0.78, bus });
            if (preset.octaveGain) this._pluck(freq * 2, t + 0.006, { dur: dur * 0.7, gain: gain * preset.octaveGain, cutoff: preset.cutoff * 1.15, damp: 0.72, bus });
            return;
        }
        if (preset.metal) {
            this._metal(freq, t, { dur, gain, cutoff: preset.cutoff, ratios: [1, 2.01, 3.98, 6.7], bus });
            return;
        }
        this._mVoice(freq, t, dur, gain, { type: preset.type, bus, cutoff: preset.cutoff, attack: preset.attack, detune: preset.detune, shape: preset.shape });
        if (preset.octaveGain) this._mVoice(freq * 2, t, dur * 0.72, gain * preset.octaveGain,
            { type: preset.type, bus, cutoff: preset.cutoff * 1.12, attack: preset.attack, detune: preset.detune ? preset.detune * 0.5 : 0 });
        if (preset.fifthGain) this._mVoice(freq * 1.5, t, dur * 0.82, gain * preset.fifthGain,
            { type: preset.type, bus, cutoff: preset.cutoff, attack: preset.attack, detune: preset.detune });
    }

    _kick(t, e = 1, bus = this.musicDuck) {
        this._voice(140, t, 0.15, 0.2 * e, { type: 'sine', bus, cutoff: 420, slideTo: 46, attack: 0.002 });
    }
    _hat(t, e = 1, bus = this.musicDuck, style = '') {
        const cutoff = style === 'boneMarch' || style === 'tomb' ? 4200 : style === 'sand' || style === 'caravan' ? 6500 : 8500;
        this._noise(t, style === 'sand' || style === 'caravan' ? 0.045 : 0.028, 0.04 * e, cutoff, bus);
        if ((style === 'frost' || style === 'glacier') && e > 0.45) this._metal(1500, t, { dur: 0.05, gain: 0.006 * e, ratios: [1, 2.7], cutoff: 5200, bus });
    }
    _snare(t, e = 1, bus = this.musicDuck, style = '') {
        if (style === 'boneMarch' || style === 'tomb') {
            this._click(1250, t, 0.035 * e, bus);
            this._metal(210, t, { dur: 0.08, gain: 0.022 * e, ratios: [1, 2.76], cutoff: 1800, bus });
        } else {
            this._noise(t, style === 'sand' || style === 'caravan' ? 0.09 : 0.075, 0.065 * e, style === 'frost' ? 5200 : 3200, bus);
            this._voice(185, t, 0.07, 0.045 * e, { type: 'triangle', bus, cutoff: 850, slideTo: 105, attack: 0.002 });
        }
    }

    // ── Low-level synth toolkit ───────────────────────────────────────────
    // A melodic voice = one or three detuned oscillators → per-voice low-pass →
    // (optional tanh grit) → bus, with soft attack + exponential release.
    _voice(freq, t, dur, gain, opts = {}) {
        if (!this.ctx) return;
        const { type = 'sine', bus = this.sfxBus, slideTo = 0, attack = 0.015, detune = 0, cutoff = 0, shape = 0 } = opts;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gain, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
        const nodes = [g];
        let tail = g;
        if (cutoff > 0) {
            const f = this.ctx.createBiquadFilter();
            f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.6;
            tail.connect(f); tail = f;
            nodes.push(f);
        }
        if (shape > 0) {
            const ws = this.ctx.createWaveShaper();
            ws.curve = this._shapeCurve(shape);
            tail.connect(ws); tail = ws;
            nodes.push(ws);
        }
        tail.connect(bus);
        const mkOsc = (det) => {
            const o = this.ctx.createOscillator();
            o.type = type;
            o.frequency.setValueAtTime(freq, t);
            if (slideTo > 0) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
            if (det) o.detune.value = det;
            o.connect(g);
            o.start(t); o.stop(t + dur + 0.04);
            nodes.push(o);
        };
        mkOsc(0);
        if (detune) { mkOsc(detune); mkOsc(-detune); }
        this._queueCleanup(nodes, t + dur + 0.1);
    }

    // Soft low-pass-filtered noise swell (impacts / whooshes / hats), optionally
    // sweeping the cutoff for a "whoomp".
    _noise(t, dur, gain, cutoff, bus, sweepTo = 0) {
        if (!this.ctx || !this._noiseBuf) return;
        const src = this.ctx.createBufferSource();
        src.buffer = this._noiseBuf;
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff, t); f.Q.value = 0.5;
        if (sweepTo > 0) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gain, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
        src.connect(f); f.connect(g); g.connect(bus || this.sfxBus);
        src.start(t); src.stop(t + dur + 0.02);
        this._queueCleanup([src, f, g], t + dur + 0.08);
    }

    // Cached tanh soft-clip curve (grit/saturation) — normalized so it adds
    // warmth without boosting level (limiter-friendly). Curve cached per amount.
    _shapeCurve(amount) {
        const key = amount;
        if (this._shapeCache[key]) return this._shapeCache[key];
        const n = 1024, curve = new Float32Array(n), k = Math.max(0.01, amount);
        const nrm = Math.tanh(k);
        for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * 2 - 1;
            curve[i] = Math.tanh(k * x) / nrm;
        }
        this._shapeCache[key] = curve;
        return curve;
    }

    // Sub thump — a clean low sine (40-90Hz) with a no-click attack.
    _sub(freq, t, opts = {}) {
        if (!this.ctx) return;
        const { dur = 0.14, gain = 0.1, slideTo = 0, bus = this.sfxBus } = opts;
        this._voice(freq, t, dur, gain, { type: 'sine', bus, slideTo, attack: 0.008 });
    }

    // Ultra-short transient (the "punch" layer of an impact).
    _click(freq, t, gain, bus = this.sfxBus) {
        if (!this.ctx) return;
        this._voice(freq, t, 0.02, gain, { type: 'triangle', bus, slideTo: freq * 0.55, attack: 0.0006, cutoff: 5200 });
    }

    // Inharmonic metallic hit — sine partials at bell/anvil ratios through a
    // bandpass (chest latch, forge strike, shield, crit sparkle).
    _metal(freq, t, opts = {}) {
        if (!this.ctx) return;
        const { dur = 0.2, gain = 0.06, bus = this.sfxBus, ratios = [1, 2.76, 5.4, 8.9], cutoff = 3400 } = opts;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = cutoff; bp.Q.value = 0.7;
        bp.connect(bus);
        const nodes = [bp];
        for (let i = 0; i < ratios.length; i++) {
            const o = this.ctx.createOscillator();
            o.type = 'sine'; o.frequency.value = freq * ratios[i];
            const g = this.ctx.createGain();
            const pk = gain / (i + 1);
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(pk, t + 0.002);
            g.gain.exponentialRampToValueAtTime(0.0008, t + Math.max(0.03, dur * (1 - i * 0.12)));
            o.connect(g); g.connect(bp);
            o.start(t); o.stop(t + dur + 0.05);
            nodes.push(o, g);
        }
        this._queueCleanup(nodes, t + dur + 0.12);
    }

    // Karplus-lite pluck — a short filtered-noise burst into a tuned feedback
    // delay (coins/gems/frost). The output envelope forces decay to silence so
    // the feedback loop can't linger/accumulate.
    _pluck(freq, t, opts = {}) {
        if (!this.ctx || !this._noiseBuf) return;
        const { dur = 0.15, gain = 0.09, cutoff = 4000, damp = 0.75, bus = this.sfxBus } = opts;
        const src = this.ctx.createBufferSource();
        src.buffer = this._noiseBuf;
        const burst = this.ctx.createGain();
        burst.gain.setValueAtTime(Math.max(0.02, gain), t);
        burst.gain.exponentialRampToValueAtTime(0.0008, t + 0.004);
        const delay = this.ctx.createDelay(0.05);
        delay.delayTime.value = Math.min(0.05, 1 / Math.max(60, freq));
        const fb = this.ctx.createGain();
        fb.gain.value = Math.max(0, Math.min(0.94, damp));
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = cutoff;
        const out = this.ctx.createGain();
        out.gain.setValueAtTime(1, t);
        out.gain.exponentialRampToValueAtTime(0.0008, t + dur);
        src.connect(burst); burst.connect(delay);
        delay.connect(lp); lp.connect(fb); fb.connect(delay);
        lp.connect(out); out.connect(bus);
        src.start(t); src.stop(t + 0.02);
        // Break the feedback cycle after the output envelope reaches silence;
        // otherwise long sessions can retain an inaudible pluck graph.
        this._queueCleanup([src, burst, delay, fb, lp, out], t + dur + 0.12);
    }

    _queueCleanup(nodes, at) {
        const live = nodes.filter(Boolean);
        if (!live.length) return;
        this._cleanupQueue.push({ at: Number.isFinite(at) ? at : 0, nodes: live });
    }

    _drainCleanup(force = false) {
        const now = this.ctx?.currentTime ?? Infinity;
        let write = 0;
        for (const item of this._cleanupQueue) {
            if (force || item.at <= now) {
                for (const node of item.nodes) {
                    try { node.disconnect(); } catch (e) { /* already disconnected */ }
                }
            } else {
                this._cleanupQueue[write++] = item;
            }
        }
        this._cleanupQueue.length = write;
    }

    _rand(a, b) { return a + Math.random() * (b - a); }

    // Sidechain duck: create a short pocket for a signature cue while keeping
    // the score perceptually present. Dense combat should never erase the bed.
    _duck(amount = 0.45, hold = 0.08, recover = 0.35) {
        if (!this.ctx || !this.musicDuck) return;
        const t = this.ctx.currentTime;
        const g = this.musicDuck.gain;
        const depth = Math.max(0, Math.min(1, Number(amount) || 0));
        const floor = Math.max(AUDIO_MIX.duckFloor, 1 - depth * AUDIO_MIX.duckDepth);
        if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(t);
        else {
            g.cancelScheduledValues(t);
            g.setValueAtTime(g.value, t);
        }
        g.linearRampToValueAtTime(floor, t + 0.02);
        g.setValueAtTime(floor, t + 0.02 + hold);
        const releaseAt = t + 0.02 + hold + recover;
        g.linearRampToValueAtTime(1, releaseAt);
    }

    // Music voice with a per-step voice cap (drops the least-important layer
    // first, since layers are scheduled in priority order); mono on mobile.
    _mVoice(freq, t, dur, gain, opts = {}) {
        if ((this._voicesThisStep | 0) >= this._voiceCap) return;
        this._voicesThisStep++;
        if (this._mobile && opts.detune) opts = { ...opts, detune: 0 };
        this._voice(freq, t, dur, gain, opts);
    }

    // A warm bell = fundamental + a quieter octave, both lightly detuned.
    _bell(t, freq, gain = 0.13) {
        this._voice(freq, t, 0.5, gain, { type: 'sine', cutoff: 4000, detune: 5, attack: 0.005 });
        this._voice(freq * 2, t, 0.32, gain * 0.4, { type: 'sine', cutoff: 5000, attack: 0.005 });
    }

    // ── SFX (throttled) ────────────────────────────────────────────────────
    // Per-cue min-gap plus a GLOBAL soft voice budget: at swarm scale many
    // different cues can align on the same instant and mud the mix, so
    // texture cues get dropped once a short rolling window is saturated.
    // Signature cues (fanfares, boss beats, hurt) always play.
    _play(name, minGap, fn) {
        if (!this.ctx || !this.sfxBus) return;
        const now = this.ctx.currentTime;
        if (this._lastSfx[name] && now - this._lastSfx[name] < minGap) return;
        if (!AudioSystem.PRIORITY_CUES.has(name)) {
            if (now - (this._sfxWindowT || 0) > 0.1) { this._sfxWindowT = now; this._sfxWindowN = 0; }
            const budget = this._mobile ? AUDIO_MIX.textureBudgetMobile : AUDIO_MIX.textureBudgetDesktop;
            if (++this._sfxWindowN > budget) return;
        }
        this._lastSfx[name] = now;
        fn(now);
    }

    // ── UI ──
    click()  { this._play('click', 0.02, (t) => { if (this._playSample('click')) return; this._voice(600, t, 0.05, 0.11, { type: 'sine', slideTo: 840, cutoff: 3000, attack: 0.002 }); this._click(600, t, 0.04); }); }
    hover()  { this._play('hover', 0.03, (t) => { if (this._playSample('hover')) return; this._voice(1000, t, 0.035, 0.035, { type: 'sine', cutoff: 3600, detune: 4 }); }); }
    equip()  { this._play('equip', 0.04, (t) => { if (this._playSample('equip')) return; this._voice(880, t, 0.07, 0.08, { type: 'sine', cutoff: 4200, detune: 5 }); this._voice(1320, t + 0.05, 0.12, 0.07, { type: 'triangle', cutoff: 4600, detune: 5 }); this._metal(1760, t + 0.05, { dur: 0.08, gain: 0.03, ratios: [1, 2.4], cutoff: 5000 }); }); }
    upgrade(){ this._play('upgrade', 0.05, (t) => { this._voice(660, t, 0.1, 0.11, { type: 'triangle', slideTo: 990, cutoff: 3600, detune: 6 }); this._voice(990, t + 0.06, 0.2, 0.09, { type: 'triangle', cutoff: 4000, detune: 6 }); this._voice(1320, t + 0.06, 0.22, 0.04, { type: 'sine', cutoff: 4600 }); }); }
    reroll() { this._play('reroll', 0.15, (t) => { if (this._playSample('reroll')) return; this._noise(t, 0.18, 0.05, 2600, this.sfxBus, 900); this._voice(520, t, 0.1, 0.05, { type: 'triangle', slideTo: 680, cutoff: 3200 }); }); }
    banish() { this._play('banish', 0.15, (t) => { this._voice(360, t, 0.16, 0.08, { type: 'triangle', slideTo: 180, cutoff: 2000, detune: 5, shape: 2 }); this._sub(70, t, { dur: 0.12, gain: 0.06 }); }); }
    deny()   { this._play('deny', 0.1, (t) => this._voice(160, t, 0.12, 0.08, { type: 'sawtooth', slideTo: 120, cutoff: 900, shape: 2.5 })); }
    purchase(){ this._play('purchase', 0.08, (t) => { if (this._playSample('purchase')) return; this._pluck(880, t, { dur: 0.12, gain: 0.08, cutoff: 4200, damp: 0.7 }); this._voice(1320, t + 0.05, 0.14, 0.06, { type: 'triangle', cutoff: 4400, detune: 5 }); }); }

    // ── Combat ──
    hurt()   { this._play('hurt', 0.09, (t) => { if (this._playSample('hurt')) return; const r = this._rand(-8, 8); this._sub(70, t, { dur: 0.18, gain: 0.16, slideTo: 44 }); this._voice(200 + r, t, 0.16, 0.13, { type: 'triangle', slideTo: 96, cutoff: 850, shape: 2 }); this._noise(t, 0.09, 0.05, 650, this.sfxBus, 300); }); }
    kill()   { this._play('kill', 0.035, (t) => { if (this._playSample('kill')) return; this._click(400, t, 0.06); this._voice(340 * this._rand(0.94, 1.06), t, 0.09, 0.10, { type: 'triangle', slideTo: 150, cutoff: 2200, attack: 0.003 }); this._noise(t, 0.06, 0.045, 2400, this.sfxBus, 900); }); }
    crit()   { this._play('crit', 0.04, (t) => { const j = this._rand(0.95, 1.05); this._click(900 * j, t, 0.05); this._metal(900 * j, t, { dur: 0.09, gain: 0.06, ratios: [1, 2.7, 5.1], cutoff: 5200 }); this._voice(1400 * j, t, 0.06, 0.05, { type: 'triangle', slideTo: 2100, cutoff: 5000 }); }); }
    impact() { this._play('impact', 0.08, (t) => { this._voice(260, t, 0.05, 0.04, { type: 'triangle', slideTo: 170, cutoff: 1600 }); this._noise(t, 0.03, 0.02, 1800, this.sfxBus); }); }
    freeze() { this._play('freeze', 0.15, (t) => { this._pluck(1600, t, { dur: 0.25, gain: 0.06, cutoff: 5200, damp: 0.82 }); this._metal(2100, t + 0.02, { dur: 0.3, gain: 0.04, ratios: [1, 1.5, 2.2], cutoff: 5000 }); this._voice(900, t, 0.3, 0.04, { type: 'sine', slideTo: 600, cutoff: 4000 }); }); }
    burn()   { this._play('burn', 0.18, (t) => { this._noise(t, 0.12, 0.04, 1100, this.sfxBus, 700); this._voice(180 * this._rand(0.9, 1.1), t, 0.09, 0.03, { type: 'sawtooth', cutoff: 900, shape: 3 }); }); }
    heal()   { this._play('heal', 0.2, (t) => { this._voice(523, t, 0.25, 0.07, { type: 'sine', slideTo: 660, cutoff: 3600, detune: 5 }); this._voice(784, t + 0.06, 0.3, 0.05, { type: 'sine', cutoff: 4000, detune: 5 }); this._noise(t, 0.35, 0.03, 4000, this.sfxBus); }); }
    shield() { this._play('shield', 0.12, (t) => { this._metal(440, t, { dur: 0.3, gain: 0.07, ratios: [1, 2.0, 3.0, 4.1], cutoff: 3600 }); this._voice(330, t, 0.28, 0.06, { type: 'triangle', slideTo: 440, cutoff: 2400, detune: 6 }); }); }
    thorns() { this._play('thorns', 0.1, (t) => { this._metal(660, t, { dur: 0.12, gain: 0.05, ratios: [1, 2.0, 3.0], cutoff: 3400 }); this._noise(t, 0.04, 0.03, 3000, this.sfxBus); }); }
    dash()   { this._play('dash', 0.12, (t) => { this._noise(t, 0.14, 0.06, 900 + this._rand(-100, 100), this.sfxBus, 3600); this._voice(240, t, 0.1, 0.05, { type: 'sine', slideTo: 520, cutoff: 2000, attack: 0.004 }); this._sub(120, t, { dur: 0.08, gain: 0.05 }); }); }
    enemyShoot() { this._play('enemyShoot', 0.08, (t) => this._voice(300 * this._rand(0.92, 1.08), t, 0.07, 0.05, { type: 'triangle', slideTo: 200, cutoff: 1400, attack: 0.002 })); }
    waveStart()  { this._play('waveStart', 0.4, (t) => { this._voice(196, t, 0.5, 0.10, { type: 'sawtooth', slideTo: 294, cutoff: 1400, detune: 8, shape: 2 }); this._sub(65, t, { dur: 0.5, gain: 0.10, slideTo: 98 }); this._noise(t, 0.4, 0.05, 1200, this.sfxBus, 400); }); }
    // Charger brace: a short tension inhale — the audible "dodge now" cue.
    chargerWindup() { this._play('chargerWindup', 0.3, (t) => { this._voice(160, t, 0.22, 0.055, { type: 'sawtooth', slideTo: 340, cutoff: 1500, shape: 2.5 }); this._noise(t, 0.2, 0.03, 900, this.sfxBus, 2400); }); }
    // Charger dash commit: a low whoosh, softer than the player's dash.
    chargerDash() { this._play('chargerDash', 0.25, (t) => { this._noise(t, 0.16, 0.05, 700 + this._rand(-80, 80), this.sfxBus, 2800); this._sub(90, t, { dur: 0.1, gain: 0.05, slideTo: 60 }); }); }
    // Volatile elite pop: a muffled ember thump — dangerous, not deafening.
    volatileBoom() { this._play('volatile', 0.12, (t) => { this._sub(75, t, { dur: 0.28, gain: 0.14, slideTo: 42 }); this._noise(t, 0.24, 0.08, 480, this.sfxBus, 160); this._voice(150, t, 0.12, 0.05, { type: 'triangle', slideTo: 80, cutoff: 900, shape: 2 }); }); }
    // Enemy healer's mend pulse — an inverted, hollow heal so players learn
    // to hunt healers by ear. Long gap + low gain: information, not noise.
    healerPulse() { this._play('healerPulse', 0.6, (t) => { this._voice(660, t, 0.22, 0.04, { type: 'sine', slideTo: 495, cutoff: 3000, detune: 4 }); this._voice(440, t + 0.08, 0.24, 0.03, { type: 'sine', slideTo: 330, cutoff: 2600 }); }); }
    // Near-death heartbeat: one soft lub-dub. Game pulses this while HP is
    // critical — cozy dread, never a klaxon (quiet sub + tiny crackle).
    heartbeat() { this._play('heartbeat', 0.45, (t) => { this._sub(52, t, { dur: 0.1, gain: 0.13 }); this._sub(48, t + 0.16, { dur: 0.12, gain: 0.10 }); this._noise(t, 0.05, 0.012, 800, this.sfxBus); }); }

    // ── Pickups / weapons ──
    coin()   { this._play('coin', 0.035, (t) => { if (this._playSample('coin')) return; const f = 1046 * this._rand(0.97, 1.04); this._pluck(f, t, { dur: 0.12, gain: 0.09, cutoff: 4200, damp: 0.7 }); this._voice(f * Math.pow(2, 7 / 12), t + 0.04, 0.1, 0.045, { type: 'sine', cutoff: 4600 }); }); }
    gem()    { this._play('gem', 0.045, (t) => { if (this._playSample('gem')) return; this._pluck(1318, t, { dur: 0.16, gain: 0.09, cutoff: 5000, damp: 0.78 }); this._bell(t, 1318, 0.06); }); }
    streak() { this._play('streak', 0.06, (t) => { this._voice(700 * this._rand(1, 1.03), t, 0.11, 0.11, { type: 'triangle', slideTo: 1400, cutoff: 3600, detune: 7 }); this._voice(1400, t + 0.03, 0.09, 0.05, { type: 'sine', cutoff: 4400 }); }); }
    shootBolt()  { this._play('shootBolt', 0.06, (t) => { this._voice(660 * this._rand(0.97, 1.03), t, 0.06, 0.055, { type: 'triangle', slideTo: 920, cutoff: 3200, attack: 0.002 }); this._click(660, t, 0.03); }); }
    shootFire()  { this._play('shootFire', 0.075, (t) => { this._voice(300, t, 0.12, 0.055, { type: 'sine', slideTo: 200, cutoff: 1500, shape: 2.5 }); this._noise(t, 0.11, 0.045, 1300 + this._rand(-150, 150), this.sfxBus, 480); this._sub(90, t, { dur: 0.09, gain: 0.05 }); }); }
    shootShock() { this._play('shootShock', 0.075, (t) => { this._voice(1250 * this._rand(0.95, 1.05), t, 0.055, 0.045, { type: 'sawtooth', slideTo: 700, cutoff: 4200, attack: 0.001, shape: 3 }); this._noise(t, 0.045, 0.04, 7000, this.sfxBus); this._metal(2600, t, { dur: 0.06, gain: 0.03, ratios: [1, 1.96], cutoff: 5600 }); }); }

    // ── Cases / rewards ──
    chest()  { this._play('chest', 0.1, (t) => { if (this._playSample('chest')) { this._bell(t + 0.06, 523); return; } this._noise(t, 0.14, 0.06, 600, this.sfxBus, 180); this._metal(180, t + 0.02, { dur: 0.18, gain: 0.05, ratios: [1, 1.9, 3.1], cutoff: 2800 }); this._bell(t + 0.06, 523); }); }
    forge()  { this._play('forge', 0.06, (t) => { this._metal(220, t, { dur: 0.22, gain: 0.11, ratios: [1, 2.76, 5.4, 8.9], cutoff: 3200 }); this._sub(60, t, { dur: 0.14, gain: 0.10 }); this._noise(t, 0.16, 0.10, 520, this.sfxBus, 1400); }); }
    spinTick(pitch = 1) { this._play('spinTick', 0.03, (t) => { this._voice(430 * pitch, t, 0.03, 0.05, { type: 'triangle', cutoff: 2600, attack: 0.001 }); this._click(430 * pitch, t, 0.02); }); }
    caseOpen() { this._play('caseOpen', 0.1, (t) => { this._noise(t, 0.34, 0.10, 300, this.sfxBus, 2600); this._voice(330, t, 0.2, 0.08, { type: 'sine', slideTo: 660, cutoff: 2400 }); this._sub(80, t, { dur: 0.3, gain: 0.07, slideTo: 130 }); }); }
    // Reveal chime — pitch/length/sparkle scale with the won RARITY; big pulls
    // add a sub floor + shimmer and duck the music harder.
    reveal(rarity) {
        const order = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
        const tier = Math.max(0, order.indexOf(rarity));
        this._play('reveal', 0.1, (t) => {
            const root = 523 * Math.pow(2, tier / 6);
            this._bell(t, root);
            const notes = 2 + tier;
            for (let i = 0; i < notes; i++) {
                this._voice(root * Math.pow(2, i / 4), t + 0.06 * i, 0.26, 0.085,
                    { type: 'triangle', cutoff: 4400, detune: 6, shape: tier >= 4 ? 1.5 : 0 });
            }
            if (tier >= 3) this._noise(t + 0.05, 0.45, 0.05, 6500, this.sfxBus);
            if (tier >= 4) this._sub(root / 2, t, { dur: 0.5, gain: 0.09 });
            if (tier >= 5) this._metal(root, t + 0.1, { dur: 0.5, gain: 0.04, ratios: [1, 2.01, 3.98], cutoff: 6000 });
            this._duck(tier >= 3 ? 0.5 : 0.3, tier >= 3 ? 0.10 : 0.06, tier >= 3 ? 0.5 : 0.3);
        });
    }
    cosmeticReward() {
        this._play('cosmeticReward', 0.12, (t) => {
            const root = 659;
            this._bell(t, root);
            for (let i = 0; i < 5; i++) {
                this._voice(root * Math.pow(2, i / 4), t + 0.055 * i, 0.3, 0.09,
                    { type: 'triangle', cutoff: 4600, detune: 6, shape: 1.5 });
            }
            this._voice(root * 2, t + 0.28, 0.4, 0.08, { type: 'sine', cutoff: 5200, detune: 5 });
            this._bell(t + 0.28, root * 2, 0.06);
            this._sub(root / 2, t, { dur: 0.4, gain: 0.08 });
            this._noise(t + 0.04, 0.5, 0.045, 7000, this.sfxBus);
            this._duck(0.5, 0.10, 0.5);
        });
    }
    objective() { this._play('obj', 0.1, (t) => { this._voice(784, t, 0.12, 0.12, { type: 'triangle', cutoff: 3600 }); this._voice(1175, t + 0.09, 0.24, 0.12, { type: 'triangle', cutoff: 4200, detune: 6 }); this._voice(1568, t + 0.2, 0.24, 0.06, { type: 'sine', cutoff: 4800 }); }); }

    // ── Fanfares / stingers ──
    levelUp() {
        this._play('levelUp', 0.1, (t) => {
            this._voice(523, t, 0.16, 0.13, { type: 'triangle', cutoff: 3200, detune: 7 });
            this._voice(659, t + 0.09, 0.16, 0.13, { type: 'triangle', cutoff: 3400, detune: 7 });
            this._voice(784, t + 0.18, 0.28, 0.14, { type: 'triangle', cutoff: 3800, detune: 7 });
            this._bell(t + 0.18, 784, 0.07);
            this._sub(131, t, { dur: 0.3, gain: 0.06 });
            this._duck(0.45, 0.08, 0.4);
        });
    }
    // KINDLED — a soft blip when the Focus target lock changes (Tab / tap).
    uiTick() { this._play('uiTick', 0.04, (t) => { this._voice(880, t, 0.05, 0.05, { type: 'triangle', slideTo: 1240, cutoff: 5200 }); }); }
    // KINDLED — Grand Signature ult release. One cue dispatched per aimKind
    // (ring/lane/self/line/cone) so each hero's ult reads distinct; reuses the
    // existing synth timbres. A big duck sells the signature moment.
    ult(kind) {
        this._play('ult', 0.05, (t) => {
            this._duck(0.6, 0.12, 0.6);
            if (kind === 'lane') {
                this._noise(t, 0.5, 0.13, 300, this.sfxBus, 5200); // forward gale
                this._voice(220, t, 0.4, 0.1, { type: 'sawtooth', slideTo: 880, cutoff: 4200, detune: 8 });
                this._sub(70, t, { dur: 0.4, gain: 0.12 });
            } else if (kind === 'line') {
                this._voice(300, t, 0.28, 0.12, { type: 'sawtooth', slideTo: 1500, cutoff: 5200 }); // piercing lance
                this._bell(t, 1046, 0.09);
                this._sub(90, t, { dur: 0.35, gain: 0.12 });
            } else if (kind === 'cone') {
                this._noise(t, 0.18, 0.14, 400, this.sfxBus, 6200); // execute snap
                this._metal(180, t, { dur: 0.5, gain: 0.09, ratios: [1, 2.4, 3.7, 5.1], cutoff: 4200 });
                this._sub(80, t, { dur: 0.4, gain: 0.12, slideTo: 44 });
            } else if (kind === 'self') {
                this._metal(160, t, { dur: 0.7, gain: 0.09, ratios: [1, 2.0, 3.0, 4.1], cutoff: 3200 }); // warding bloom
                this._voice(196, t, 0.5, 0.09, { type: 'sine', slideTo: 262, cutoff: 2600, detune: 6 });
                this._sub(60, t, { dur: 0.6, gain: 0.14 });
            } else { // ring (default) — radial boom
                this._sub(58, t, { dur: 0.7, gain: 0.16, slideTo: 40 });
                this._noise(t, 0.45, 0.12, 260, this.sfxBus, 3200);
                this._metal(130, t + 0.02, { dur: 0.8, gain: 0.07, ratios: [1, 1.98, 2.94, 4.2], cutoff: 3000 });
            }
        });
    }
    bossSpawn() {
        this._play('boss', 0.2, (t) => {
            this._sub(90, t, { dur: 0.7, gain: 0.18, slideTo: 44 });
            this._noise(t, 0.6, 0.11, 220, this.sfxBus, 600);
            this._metal(110, t + 0.05, { dur: 0.9, gain: 0.06, ratios: [1, 1.98, 2.94], cutoff: 1400 });
            this._duck(0.6, 0.15, 0.7);
        });
    }
    bossTelegraph() {
        this._play('bossTelegraph', 0.25, (t) => {
            this._voice(300, t, 0.28, 0.08, { type: 'sawtooth', slideTo: 900, cutoff: 2600, detune: 6, shape: 2.5 });
            this._metal(150, t, { dur: 0.3, gain: 0.05, ratios: [1, 1.4, 1.9], cutoff: 2000 });
            this._noise(t, 0.25, 0.04, 1600, this.sfxBus, 3000);
        });
    }
    bossAttack() {
        this._play('bossAttack', 0.15, (t) => {
            this._sub(70, t, { dur: 0.35, gain: 0.18, slideTo: 40 });
            this._noise(t, 0.3, 0.09, 400, this.sfxBus);
            this._metal(120, t, { dur: 0.35, gain: 0.06, ratios: [1, 1.98, 2.9], cutoff: 1600 });
        });
    }
    gameOver() {
        this._play('gameover', 0.3, (t) => {
            this._voice(392, t, 0.4, 0.14, { type: 'triangle', slideTo: 196, cutoff: 2400, detune: 6 });
            this._voice(262, t + 0.28, 0.6, 0.14, { type: 'triangle', slideTo: 130, cutoff: 1700, detune: 6 });
            this._sub(65, t + 0.28, { dur: 0.7, gain: 0.10 });
            this._noise(t, 0.9, 0.03, 500, this.sfxBus);
        });
    }
    victoryFanfare() {
        this._play('victory', 0.5, (t) => {
            this._duck(0.7, 0.2, 0.9);
            const root = 523, climb = [0, 4, 7, 12, 16];
            for (let i = 0; i < climb.length; i++) {
                this._voice(root * Math.pow(2, climb[i] / 12), t + 0.14 * i, 0.5, 0.11,
                    { type: 'triangle', cutoff: 5200, detune: 6, attack: 0.006 });
            }
            this._bell(t + 0.14 * climb.length, 1046);
            this._noise(t, 0.8, 0.05, 6500, this.sfxBus);
            for (let i = 0; i < 3; i++) this._voice(98, t + 0.16 * i, 0.18, 0.12, { type: 'sine', slideTo: 60, cutoff: 500, attack: 0.004 });
        });
    }

    // Boss defeated: a deep anvil strike blooming into a warm 3-note bell
    // rise — a shorter, earthier sibling of the victory fanfare. The run's
    // biggest payoff should never land mute under the music switch.
    bossDefeat() {
        this._play('bossDefeat', 0.5, (t) => {
            this._duck(0.6, 0.15, 0.7);
            this._metal(165, t, { dur: 0.5, gain: 0.11, ratios: [1, 2.76, 5.4], cutoff: 2600 });
            this._sub(55, t, { dur: 0.4, gain: 0.14 });
            const notes = [392, 523, 659];
            for (let i = 0; i < notes.length; i++) {
                this._voice(notes[i], t + 0.16 + 0.13 * i, 0.4, 0.11, { type: 'triangle', cutoff: 4200, detune: 6 });
                this._bell(t + 0.16 + 0.13 * i, notes[i], 0.05);
            }
            this._noise(t + 0.2, 0.6, 0.04, 6000, this.sfxBus);
        });
    }
    // Lieutenant slain: a mid-tier payoff between kill() and the boss stinger
    // — one warm bell over a small anvil tap and a coin-ish shimmer.
    lieutenantDown() {
        this._play('ltDown', 0.3, (t) => {
            this._metal(220, t, { dur: 0.28, gain: 0.07, ratios: [1, 2.76, 5.4], cutoff: 2800 });
            this._bell(t + 0.08, 659, 0.10);
            this._pluck(1318, t + 0.16, { dur: 0.14, gain: 0.06, cutoff: 4600, damp: 0.72 });
            this._sub(70, t, { dur: 0.2, gain: 0.07 });
        });
    }
    // Lighter, shorter telegraph for the lieutenant "ELITE APPROACHES" — a
    // threat tier below the boss groan.
    lieutenantWarn() {
        this._play('ltWarn', 0.25, (t) => {
            this._voice(260, t, 0.2, 0.06, { type: 'sawtooth', slideTo: 560, cutoff: 2200, detune: 5, shape: 2 });
            this._metal(180, t, { dur: 0.2, gain: 0.035, ratios: [1, 1.4, 1.9], cutoff: 1800 });
        });
    }
    // Boss enrage / phase snap: a low metallic snarl with a rising rumble —
    // the fight's difficulty spike made audible.
    enrage() {
        this._play('enrage', 0.4, (t) => {
            this._voice(90, t, 0.5, 0.10, { type: 'sawtooth', slideTo: 190, cutoff: 900, detune: 9, shape: 3 });
            this._noise(t, 0.5, 0.07, 300, this.sfxBus, 1200);
            this._metal(140, t + 0.08, { dur: 0.4, gain: 0.05, ratios: [1, 1.4, 2.1], cutoff: 1500 });
            this._duck(0.35, 0.1, 0.5);
        });
    }
    // Weapon EVOLUTION reveal: metal reborn in the ember — a forge slam that
    // blooms into an ascending bell arpeggio with an airy shimmer.
    evolve() {
        this._play('evolve', 0.3, (t) => {
            this._duck(0.5, 0.12, 0.6);
            this._metal(220, t, { dur: 0.24, gain: 0.10, ratios: [1, 2.76, 5.4, 8.9], cutoff: 3200 });
            this._sub(65, t, { dur: 0.2, gain: 0.10 });
            const root = 523;
            for (let i = 0; i < 4; i++) {
                this._voice(root * Math.pow(2, i / 3), t + 0.14 + 0.08 * i, 0.3, 0.09,
                    { type: 'triangle', cutoff: 4600, detune: 6, shape: 1.5 });
            }
            this._bell(t + 0.46, root * 2, 0.07);
            this._noise(t + 0.14, 0.5, 0.045, 6800, this.sfxBus);
        });
    }
    // Weapon FUSION at the shrine: heavier than evolve — a double forge slam
    // under a two-bell rise. Two weapons hammered into one.
    fusionForge() {
        this._play('fusion', 0.3, (t) => {
            this._duck(0.5, 0.12, 0.6);
            this._metal(180, t, { dur: 0.26, gain: 0.11, ratios: [1, 2.76, 5.4, 8.9], cutoff: 3000 });
            this._metal(240, t + 0.14, { dur: 0.24, gain: 0.09, ratios: [1, 2.76, 5.4], cutoff: 3400 });
            this._sub(58, t, { dur: 0.3, gain: 0.12 });
            this._bell(t + 0.3, 587, 0.10);
            this._bell(t + 0.46, 880, 0.08);
            this._noise(t + 0.2, 0.4, 0.04, 6400, this.sfxBus);
        });
    }
    // Pact sworn: a devil's bargain — two dark descending tones over a sub,
    // deliberately NOT a cheerful chirp.
    pactSworn() {
        this._play('pact', 0.3, (t) => {
            this._voice(311, t, 0.35, 0.09, { type: 'triangle', slideTo: 220, cutoff: 1800, detune: 7, shape: 1.5 });
            this._voice(220, t + 0.18, 0.45, 0.08, { type: 'triangle', slideTo: 147, cutoff: 1400, detune: 7 });
            this._sub(55, t + 0.1, { dur: 0.5, gain: 0.10 });
            this._noise(t, 0.3, 0.02, 700, this.sfxBus, 250);
        });
    }
    // Wick Shrine / Crossroads: a mystical wick-chime — soft bell + airy
    // shimmer, distinct from the chest's loot latch.
    shrineChime() {
        this._play('shrine', 0.2, (t) => {
            this._bell(t, 784, 0.09);
            this._bell(t + 0.12, 1175, 0.06);
            this._noise(t, 0.5, 0.035, 7000, this.sfxBus);
            this._voice(392, t, 0.4, 0.05, { type: 'sine', slideTo: 440, cutoff: 3000, detune: 5 });
        });
    }
    // Twilight / Hypergrowth onset: a long detuned dread-swell — "the horde
    // turns" — distinct from an actual boss arriving (no percussion).
    dreadDrone() {
        this._play('dread', 0.5, (t) => {
            this._voice(98, t, 1.3, 0.09, { type: 'sawtooth', slideTo: 110, cutoff: 700, detune: 14, shape: 2 });
            this._voice(65, t + 0.2, 1.2, 0.07, { type: 'triangle', cutoff: 500, detune: 10 });
            this._noise(t, 1.1, 0.03, 400, this.sfxBus, 900);
            this._duck(0.3, 0.3, 0.8);
        });
    }
    // Achievement / daily-challenge earned: one gentle two-note chime, kept
    // soft so it sits politely under the game-over stinger.
    achievementChime() {
        this._play('achieve', 0.25, (t) => {
            this._bell(t, 880, 0.07);
            this._bell(t + 0.14, 1319, 0.06);
            this._noise(t, 0.3, 0.02, 6500, this.sfxBus);
        });
    }
    // Pause: the hearth damps down (and music dims while held); resume is the
    // reverse breath. setPaused holds the duck for the whole pause.
    pauseIn()  { this._play('pauseIn', 0.1, (t) => { this._voice(520, t, 0.12, 0.06, { type: 'sine', slideTo: 320, cutoff: 2200 }); this._noise(t, 0.12, 0.03, 1400, this.sfxBus, 500); }); }
    pauseOut() { this._play('pauseOut', 0.1, (t) => { this._voice(320, t, 0.12, 0.06, { type: 'sine', slideTo: 520, cutoff: 2400 }); this._noise(t, 0.1, 0.025, 900, this.sfxBus, 2200); }); }
    setPaused(on) {
        this._paused = on === true;
        // Captions are intentionally hidden/frozen behind pause and modal
        // surfaces. Stop a spoken stinger at the same boundary so audio never
        // continues without its transcript; the frozen text remains readable
        // when play resumes.
        if (this._paused) this.stopVoice();
        if (!this.ctx || !this.musicPause) return;
        this._rampParam(this.musicPause.gain, this._paused ? 0.45 : 1, this.ctx.currentTime, 0.15);
    }

    dispose() {
        if (this._schedId != null) clearInterval(this._schedId);
        this._schedId = null;
        this._stopRecorded(false);
        if (this._activeVoice) {
            try { this._activeVoice.stop(); } catch (e) { /* already stopped */ }
        }
        this._activeVoice = null;
        this._activeVoiceGain = null;
        this._drainCleanup(true);
        const ctx = this.ctx;
        this.ctx = null;
        this.outputBus = null;
        if (ctx?.close) {
            try { ctx.close(); } catch (e) { /* no-op */ }
        }
    }
}

// Cues that always play, even when the global texture-cue budget saturates —
// the signature beats the mix is built around.
AudioSystem.PRIORITY_CUES = new Set([
    'levelUp', 'boss', 'bossDefeat', 'bossTelegraph', 'enrage', 'victory',
    'gameover', 'reveal', 'cosmeticReward', 'evolve', 'fusion', 'pact',
    'hurt', 'heartbeat', 'waveStart', 'ltWarn', 'ltDown', 'dread', 'shrine',
]);
