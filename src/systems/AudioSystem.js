// AudioSystem — HYBRID Web Audio: warm dark-fantasy "ember" music + SFX that are
// procedurally synthesized, with a thin layer of real CC0 (Kenney.nl) one-shot
// samples over the most TACTILE cues (a punch, coins, a metal latch, UI clicks) —
// things a real recorded transient nails better than a synth. Every sampled cue
// falls back to its synth voice when the sample isn't loaded (headless render,
// fetch failure, or a cue we keep procedural), so nothing ever goes silent, and
// ALL music/fanfares stay 100% procedural. Feature-detected, so in headless /
// unsupported environments every method is a silent no-op (nothing throws).
// Browsers block audio until a user gesture, so the context is created lazily and
// `resume()` runs from a click/keydown (which also kicks off sample loading).
//
// Signal chain (mobile-safe by construction): sfxBus (dry, samples + synth SFX) +
// musicBus (→ reverb tail) sum into master → master LOW-PASS (warmth) → a
// brick-wall LIMITER (DynamicsCompressor) → destination, so no stack of layered
// hits — sampled or synth — can ever clip. Music runs through a musicDuck gain so
// big moments pseudo-SIDECHAIN-duck the bed (Web Audio has no external sidechain).
// Voices are detuned-oscillator pairs through per-voice low-pass with soft ADSR;
// grit uses a cached tanh waveshaper; impacts are filtered-noise / sub-sine /
// inharmonic-metal layers — warm, never harsh static.

const A4 = 440;
const hz = (midi) => A4 * Math.pow(2, (midi - 69) / 12);

// Scales. Minor pentatonic drives hard without going dissonant; the biome
// retunes swap in richer 7-note modes for colour, and victory uses major.
const PENT = [0, 3, 5, 7, 10];
const MAJ_PENT = [0, 2, 4, 7, 9];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYG = [0, 1, 3, 5, 7, 8, 10];

// Resolve a scale degree (can be negative or span octaves) to a MIDI note.
function degToMidi(root, scale, deg) {
    const len = scale.length;
    const oct = Math.floor(deg / len);
    const idx = ((deg % len) + len) % len;
    return root + oct * 12 + scale[idx];
}

// Themes are full grooves: a DRUM bed (kick + hat) for drive, a walking BASS, a
// LEAD with an A/B section, a soft PAD, and a gap-filling ARP. A per-bar chord
// PROGRESSION + the 8-bar A/B phrase make the loop evolve (~16s before it truly
// repeats). 16 sixteenths/bar; `null` = rest (space keeps it from feeling
// relentless). `swing` delays off-beats for groove.
const GAMEPLAY_BASE = {
    bpm: 128, wave: 'triangle', cutoff: 2900, root: 45, scale: PENT, energy: 1.0, swing: 0.10,
    prog: [0, 7, 3, 5],
    lead:  [0, null, 3, 2, null, 4, null, 5, 4, null, 2, 3, null, 2, null, 0],
    leadB: [7, null, 5, 4, null, 5, 7, null, 9, null, 7, 5, null, 4, 2, null],
    bassSteps: [0, 3, 6, 8, 11, 14], bassWalk: [0, 0, 3, 0, -2, 0],
    kick: [0, 4, 8, 12], hat: [2, 6, 10, 14],
    padVoicing: [0, 2, 4], arp: [0, 4, 7, 10, 7, 4],
};

const THEMES = {
    menu: {
        bpm: 96, wave: 'triangle', cutoff: 2400, root: 57, scale: PENT, energy: 0.6, swing: 0.18,
        prog: [0, 0, 3, 5],
        lead:  [0, null, 2, null, 4, null, 2, null, 3, null, 5, null, 4, null, 2, null],
        leadB: [4, null, 3, null, 2, null, 3, null, 1, null, 2, null, 0, null, null, null],
        bassSteps: [0, 8], kick: [0, 8], hat: [4, 12],
        padVoicing: [0, 2, 4], arp: [0, 4, 7, 4],
    },
    gameplay: GAMEPLAY_BASE,
    boss: {
        bpm: 152, wave: 'sawtooth', cutoff: 1600, root: 38, scale: MINOR, energy: 1.12, swing: 0.0,
        prog: [0, 0, 10, 3],
        lead:  [0, 0, null, 3, 0, null, 2, 0, null, 3, 0, 2, null, 4, 3, 2],
        leadB: [5, null, 4, 3, 5, null, 7, 5, null, 4, 3, null, 5, 4, 3, 0],
        bassSteps: [0, 2, 4, 6, 8, 10, 12, 14], bassWalk: [0, 0, 2, 0, 4, 0, 2, 0],
        kick: [0, 4, 8, 12], hat: [2, 6, 10, 14],
        padVoicing: [0, 1, 4], arp: [0, 3, 7, 3],
    },
    victory: {
        bpm: 120, wave: 'triangle', cutoff: 4200, root: 52, scale: MAJ_PENT, energy: 0.9, swing: 0.10,
        prog: [0, 4, 7, 4],
        lead:  [0, null, 2, 4, null, 7, null, 4, 2, null, 4, null, 7, null, 9, null],
        leadB: [7, null, 9, 7, null, 4, null, 7, null, 9, 11, null, 9, 7, 4, null],
        bassSteps: [0, 4, 8, 12], bassWalk: [0, 2, 4, 2],
        kick: [0, 4, 8, 12], hat: [2, 6, 10, 14],
        padVoicing: [0, 2, 4, 6], arp: [0, 4, 7, 12, 7, 4],
    },
};

// Per-biome tone levers, shallow-merged over GAMEPLAY_BASE (patterns unchanged —
// only root/scale/cutoff/energy/wave/swing/reverb recolour the same groove).
const BIOME_TUNE = {
    emberwood:   { root: 45, scale: PENT,   cutoff: 2900, energy: 1.00, wave: 'triangle', swing: 0.10, reverb: 0.18 },
    hollowreach: { root: 48, scale: DORIAN, cutoff: 3200, energy: 0.92, wave: 'triangle', swing: 0.12, reverb: 0.30 },
    crypts:      { root: 41, scale: MINOR,  cutoff: 2200, energy: 1.00, wave: 'sawtooth', swing: 0.06, reverb: 0.24 },
    dunes:       { root: 46, scale: PHRYG,  cutoff: 2600, energy: 1.02, wave: 'triangle', swing: 0.08, reverb: 0.16 },
};

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
        this.masterFilter = null;
        this.limiter = null;      // brick-wall limiter (clip guard)
        this.musicBus = null;
        this.musicDuck = null;    // sidechain duck gate for the music bed
        this.sfxBus = null;
        this.verbSend = null;
        this.volMusic = 0.7;
        this.volSfx = 0.8;
        this.theme = null;
        this._schedId = null;
        this._nextTime = 0;
        this._step = 0;
        this._bar = 0;
        this._lastSfx = {};
        this._noiseBuf = null;
        this._intensity = 0;
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
    }

    _ensure() {
        if (!this.enabled || this.ctx) return;
        try {
            this.ctx = new this._AC();
            // master → master low-pass → LIMITER → destination.
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.72;
            this.masterFilter = this.ctx.createBiquadFilter();
            this.masterFilter.type = 'lowpass';
            this.masterFilter.frequency.value = 7000;
            this.masterFilter.Q.value = 0.4;
            this.limiter = this.ctx.createDynamicsCompressor();
            this.limiter.threshold.value = -3;
            this.limiter.knee.value = 0;
            this.limiter.ratio.value = 20;
            this.limiter.attack.value = 0.003;
            this.limiter.release.value = 0.12;
            this.master.connect(this.masterFilter);
            this.masterFilter.connect(this.limiter);
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
            this.musicBus.gain.value = this.volMusic * 0.4;
            this.musicBus.connect(this.master);
            this.musicBus.connect(this.verbSend);
            // Music voices route through the duck gate → musicBus.
            this.musicDuck = this.ctx.createGain();
            this.musicDuck.gain.value = 1;
            this.musicDuck.connect(this.musicBus);

            this.sfxBus = this.ctx.createGain();
            this.sfxBus.gain.value = this.volSfx;
            this.sfxBus.connect(this.master);

            const len = Math.floor(this.ctx.sampleRate);
            this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
            const d = this._noiseBuf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

            this._applyBiome();
        } catch (e) {
            this.enabled = false;
        }
    }

    resume() {
        if (!this.enabled) return;
        this._ensure();
        if (!this.ctx) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        if (this._schedId == null) this._startScheduler();
        this._loadSamples();
    }

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
        return true;
    }

    setVolumes(music, sfx) {
        if (typeof music === 'number') this.volMusic = Math.max(0, Math.min(1, music));
        if (typeof sfx === 'number') this.volSfx = Math.max(0, Math.min(1, sfx));
        if (this.musicBus) this.musicBus.gain.value = this.volMusic * 0.4;
        if (this.sfxBus) this.sfxBus.gain.value = this.volSfx;
    }

    playMusic(theme) {
        this.theme = THEMES[theme] ? theme : null;
        if (this.theme === 'gameplay') this._applyBiome();
    }
    stopMusic() { this.theme = null; }

    // Current biome recolours the gameplay theme. Callable before the ctx exists
    // (it just latches the id); _applyBiome() re-derives when audio is live.
    setBiome(id) {
        this._biome = BIOME_TUNE[id] ? id : 'emberwood';
        if (this.theme === 'gameplay') this._applyBiome();
    }
    _applyBiome() {
        const tune = BIOME_TUNE[this._biome] || BIOME_TUNE.emberwood;
        THEMES.gameplay = { ...GAMEPLAY_BASE, ...tune };
        if (this.verbSend && tune.reverb != null) this.verbSend.gain.value = tune.reverb;
    }

    // Dynamic intensity (0..1): brightens the master low-pass + layers drive.
    setIntensity(level) {
        const v = Math.max(0, Math.min(1, level || 0));
        this._intensity = v;
        if (this.masterFilter) this.masterFilter.frequency.value = 5600 + v * 2600;
    }

    // ── Music scheduler ──────────────────────────────────────────────────
    _startScheduler() {
        this._nextTime = this.ctx.currentTime + 0.08;
        this._step = 0;
        this._bar = 0;
        const tick = () => {
            if (!this.ctx) return;
            const horizon = this.ctx.currentTime + 0.2;
            while (this._nextTime < horizon) {
                const t = THEMES[this.theme] || THEMES.menu;
                const sixteenth = (60 / t.bpm) / 4;
                if (this.theme) {
                    // Swing: delay the off-beat sixteenths for groove.
                    const swingOff = (this._step % 2 === 1) ? sixteenth * (t.swing || 0) : 0;
                    this._scheduleStep(this._step, this._nextTime + swingOff);
                }
                this._nextTime += sixteenth;
                this._step = (this._step + 1) % 16;
                if (this._step === 0) this._bar = (this._bar + 1) % 64;
            }
        };
        this._schedId = setInterval(tick, 25);
    }

    _scheduleStep(step, t) {
        const def = THEMES[this.theme];
        if (!def || !this.musicDuck) return;
        this._voicesThisStep = 0;   // reset the per-step voice budget
        const e = def.energy;
        const bar = this._bar;
        const chord = def.prog[bar % def.prog.length];
        const root = def.root + chord;
        const useB = (bar % 8) >= 4;
        const beatDur = (60 / def.bpm) / 4;
        const md = this.musicDuck;

        // DRUMS — scheduled directly (never dropped by the _mVoice voice cap);
        // they still ride the musicDuck so a sidechain dip pumps the whole bed.
        if (def.kick.includes(step)) this._kick(t, e);
        if (def.hat.includes(step)) this._hat(t, e * (step % 4 === 0 ? 0.6 : 1));
        if ((bar % 8) === 7 && step >= 12) this._hat(t, e * 0.7);   // end-of-phrase fill
        const ix = this._intensity;
        if (ix > 0.5 && (step === 1 || step === 5 || step === 9 || step === 13)) this._hat(t, e * 0.45 * ix);
        if (ix > 0.8 && (step === 6 || step === 14)) this._kick(t, e * 0.6);

        // WALKING BASS — pumps the chord, stepping through bassWalk for motion.
        if (def.bassSteps.includes(step)) {
            const i = def.bassSteps.indexOf(step);
            const walk = def.bassWalk ? def.bassWalk[i % def.bassWalk.length] : 0;
            this._mVoice(hz(degToMidi(root, def.scale, walk) - 12), t, beatDur * 1.4, (step === 0 ? 0.16 : 0.12) * e,
                { type: 'sine', bus: md, cutoff: 700, attack: 0.006 });
        }

        // Per-section dynamics: B section lifts; the first beat of a phrase breathes.
        const secGain = useB ? 1.12 : 1.0;
        const breath = ((bar % 8) === 0 && step === 0) ? 0.6 : 1.0;

        // LEAD — A/B, detuned pair through the theme's warm cutoff.
        const deg = (useB ? def.leadB : def.lead)[step];
        if (deg !== null && deg !== undefined) {
            this._mVoice(hz(degToMidi(root, def.scale, deg)), t, beatDur * 1.7, 0.06 * e * secGain * breath,
                { type: def.wave, bus: md, cutoff: def.cutoff, attack: 0.012, detune: 7 });
        } else if (def.arp && (ix > 0.35 || (bar % 8) >= 6)) {
            // ARP fills the lead's rests when it's hot — an octave up, sparkly.
            const ad = def.arp[(bar * 16 + step) % def.arp.length];
            this._mVoice(hz(degToMidi(root, def.scale, ad) + 12), t, beatDur * 0.9, 0.035 * e,
                { type: 'sine', bus: md, cutoff: def.cutoff * 1.1, attack: 0.006, detune: 4 });
        }

        // PAD — one long soft chord per bar (lowest priority; dropped first if capped).
        if (step === 0 && def.padVoicing) {
            for (const pd of def.padVoicing) {
                this._mVoice(hz(degToMidi(root, def.scale, pd)), t, (60 / def.bpm) * 2.2, 0.028 * e * breath,
                    { type: 'triangle', bus: md, cutoff: def.cutoff * 0.55, attack: 0.12, detune: 9 });
            }
        }
    }

    _kick(t, e = 1) {
        this._voice(140, t, 0.15, 0.22 * e, { type: 'sine', bus: this.musicDuck, cutoff: 420, slideTo: 46, attack: 0.002 });
    }
    _hat(t, e = 1) {
        this._noise(t, 0.028, 0.045 * e, 8500, this.musicDuck);
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
        let tail = g;
        if (cutoff > 0) {
            const f = this.ctx.createBiquadFilter();
            f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.6;
            tail.connect(f); tail = f;
        }
        if (shape > 0) {
            const ws = this.ctx.createWaveShaper();
            ws.curve = this._shapeCurve(shape);
            tail.connect(ws); tail = ws;
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
        };
        mkOsc(0);
        if (detune) { mkOsc(detune); mkOsc(-detune); }
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
        }
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
    }

    _rand(a, b) { return a + Math.random() * (b - a); }

    // Sidechain duck: dip the music bed briefly under a big SFX moment.
    _duck(amount = 0.45, hold = 0.08, recover = 0.35) {
        if (!this.ctx || !this.musicDuck) return;
        const t = this.ctx.currentTime;
        const g = this.musicDuck.gain;
        const floor = Math.max(0.15, 1 - amount);
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(floor, t + 0.02);
        g.setValueAtTime(floor, t + 0.02 + hold);
        g.linearRampToValueAtTime(1, t + 0.02 + hold + recover);
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
    _play(name, minGap, fn) {
        if (!this.ctx || !this.sfxBus) return;
        const now = this.ctx.currentTime;
        if (this._lastSfx[name] && now - this._lastSfx[name] < minGap) return;
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
    enemyShoot() { this._play('enemyShoot', 0.08, (t) => this._voice(300, t, 0.07, 0.05, { type: 'triangle', slideTo: 200, cutoff: 1400, attack: 0.002 })); }
    waveStart()  { this._play('waveStart', 0.4, (t) => { this._voice(196, t, 0.5, 0.10, { type: 'sawtooth', slideTo: 294, cutoff: 1400, detune: 8, shape: 2 }); this._sub(65, t, { dur: 0.5, gain: 0.10, slideTo: 98 }); this._noise(t, 0.4, 0.05, 1200, this.sfxBus, 400); }); }

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
    spinTick(pitch = 1) { this._play('spinTick', 0.0, (t) => { this._voice(430 * pitch, t, 0.03, 0.05, { type: 'triangle', cutoff: 2600, attack: 0.001 }); this._click(430 * pitch, t, 0.02); }); }
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
}
