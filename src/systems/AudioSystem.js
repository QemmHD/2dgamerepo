// AudioSystem — fully procedural Web Audio (no asset files, per the project's
// no-external-assets rule). Synthesizes warm themed music + UI/gameplay SFX.
// Feature-detected, so in headless / unsupported environments every method is a
// silent no-op (nothing throws). Browsers block audio until a user gesture, so
// the context is created lazily and `resume()` runs from a click/keydown.
//
// Warmth (vs. a raw chiptune): a master LOW-PASS rounds off harsh highs, a light
// feedback-delay REVERB tail adds space, every melodic voice is a pair of
// slightly DETUNED oscillators through a per-voice low-pass with soft
// attack/release, and percussive hits are low-pass-filtered noise swells (not
// bright static). Triangle/sine timbres replace square/saw where possible.

const A4 = 440;
const hz = (midi) => A4 * Math.pow(2, (midi - 69) / 12);

// 16-step note tables (MIDI) per theme + a mellow timbre per theme.
const THEMES = {
    menu:     { bpm: 80,  wave: 'triangle', cutoff: 2200, notes: [57, 60, 64, 67, 64, 60, 62, 65, 69, 65, 62, 60, 57, 60, 64, 67] },
    gameplay: { bpm: 118, wave: 'triangle', cutoff: 2600, notes: [45, 57, 52, 57, 48, 60, 55, 60, 50, 62, 57, 62, 47, 59, 54, 59] },
    boss:     { bpm: 140, wave: 'sawtooth', cutoff: 1300, notes: [38, 38, 41, 38, 36, 36, 43, 36, 38, 45, 41, 38, 36, 43, 41, 45] },
};

export class AudioSystem {
    constructor() {
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        this.enabled = !!AC;
        this._AC = AC || null;
        this.ctx = null;
        this.master = null;       // pre-filter master gain
        this.masterFilter = null; // master low-pass (warmth)
        this.musicBus = null;
        this.sfxBus = null;
        this.verbSend = null;     // music → reverb tail
        this.volMusic = 0.7;
        this.volSfx = 0.8;
        this.theme = null;
        this._schedId = null;
        this._nextTime = 0;
        this._step = 0;
        this._lastSfx = {};
        this._noiseBuf = null;
    }

    _ensure() {
        if (!this.enabled || this.ctx) return;
        try {
            this.ctx = new this._AC();
            // master gain → master low-pass → destination (rounds harsh highs).
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.8;
            this.masterFilter = this.ctx.createBiquadFilter();
            this.masterFilter.type = 'lowpass';
            this.masterFilter.frequency.value = 7000;
            this.masterFilter.Q.value = 0.4;
            this.master.connect(this.masterFilter);
            this.masterFilter.connect(this.ctx.destination);

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
            this.musicBus.connect(this.verbSend); // music feeds the tail

            this.sfxBus = this.ctx.createGain();
            this.sfxBus.gain.value = this.volSfx;
            this.sfxBus.connect(this.master);

            const len = Math.floor(this.ctx.sampleRate);
            this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
            const d = this._noiseBuf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
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
    }

    setVolumes(music, sfx) {
        if (typeof music === 'number') this.volMusic = Math.max(0, Math.min(1, music));
        if (typeof sfx === 'number') this.volSfx = Math.max(0, Math.min(1, sfx));
        if (this.musicBus) this.musicBus.gain.value = this.volMusic * 0.4;
        if (this.sfxBus) this.sfxBus.gain.value = this.volSfx;
    }

    playMusic(theme) { this.theme = THEMES[theme] ? theme : null; }
    stopMusic() { this.theme = null; }

    // ── Music scheduler ──────────────────────────────────────────────────
    _startScheduler() {
        this._nextTime = this.ctx.currentTime + 0.08;
        this._step = 0;
        const tick = () => {
            if (!this.ctx) return;
            const horizon = this.ctx.currentTime + 0.2;
            while (this._nextTime < horizon) {
                if (this.theme) this._scheduleStep(this._step, this._nextTime);
                const t = THEMES[this.theme] || THEMES.menu;
                this._nextTime += (60 / t.bpm) / 2;
                this._step = (this._step + 1) % 16;
            }
        };
        this._schedId = setInterval(tick, 25);
    }

    _scheduleStep(step, t) {
        const def = THEMES[this.theme];
        if (!def || !this.musicBus) return;
        const midi = def.notes[step % def.notes.length];
        // Warm sub-bass on downbeats (soft sine, not a buzzy saw).
        if (step % 4 === 0) this._voice(hz(midi - 12), t, 0.36, 0.15, { type: 'sine', bus: this.musicBus, cutoff: 800, attack: 0.02 });
        // Lead / arpeggio — detuned pair through the theme's mellow cutoff.
        const long = this.theme === 'menu';
        this._voice(hz(midi), t, long ? 0.55 : 0.22, long ? 0.075 : 0.06, {
            type: def.wave, bus: this.musicBus, cutoff: def.cutoff, attack: long ? 0.05 : 0.02, detune: 8,
        });
        // Boss: a soft low kick on the off-beat for drive (no bright static tick).
        if (this.theme === 'boss' && step % 2 === 1) {
            this._voice(70, t, 0.12, 0.16, { type: 'sine', bus: this.musicBus, cutoff: 500, slideTo: 45, attack: 0.004 });
        }
    }

    // ── Low-level voices ───────────────────────────────────────────────────
    // A melodic voice = one or two slightly detuned oscillators through a
    // per-voice low-pass with a soft attack and exponential release.
    _voice(freq, t, dur, gain, opts = {}) {
        if (!this.ctx) return;
        const { type = 'sine', bus = this.sfxBus, slideTo = 0, attack = 0.015, detune = 0, cutoff = 0 } = opts;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gain, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
        let node = g;
        if (cutoff > 0) {
            const f = this.ctx.createBiquadFilter();
            f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.6;
            g.connect(f); node = g; f.connect(bus);
        } else {
            g.connect(bus);
        }
        const target = cutoff > 0 ? g : g; // gain feeds filter-or-bus above
        const mkOsc = (det) => {
            const o = this.ctx.createOscillator();
            o.type = type;
            o.frequency.setValueAtTime(freq, t);
            if (slideTo > 0) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
            if (det) o.detune.value = det;
            o.connect(target);
            o.start(t); o.stop(t + dur + 0.04);
        };
        mkOsc(0);
        if (detune) mkOsc(detune), mkOsc(-detune);
    }

    // Soft low-pass-filtered noise swell (impacts / whooshes), optionally
    // sweeping the cutoff for a "whoomp". Far mellower than bright static.
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

    // ── SFX (throttled) ────────────────────────────────────────────────────
    _play(name, minGap, fn) {
        if (!this.ctx || !this.sfxBus) return;
        const now = this.ctx.currentTime;
        if (this._lastSfx[name] && now - this._lastSfx[name] < minGap) return;
        this._lastSfx[name] = now;
        fn(now);
    }

    click()    { this._play('click', 0.02, (t) => this._voice(560, t, 0.07, 0.13, { type: 'sine', slideTo: 720, cutoff: 3200, attack: 0.004 })); }
    hover()    { this._play('hover', 0.03, (t) => this._voice(820, t, 0.04, 0.05, { type: 'sine', cutoff: 3200 })); }
    hurt()     { this._play('hurt', 0.10, (t) => { this._voice(190, t, 0.16, 0.18, { type: 'sine', slideTo: 90, cutoff: 900, attack: 0.003 }); this._noise(t, 0.10, 0.05, 700); }); }
    kill()     { this._play('kill', 0.045, (t) => this._voice(320, t, 0.10, 0.11, { type: 'triangle', slideTo: 150, cutoff: 2200, attack: 0.004 })); }
    coin()     { this._play('coin', 0.04, (t) => this._voice(900, t, 0.08, 0.10, { type: 'sine', slideTo: 1500, cutoff: 4000, detune: 6 })); }
    gem()      { this._play('gem', 0.05, (t) => this._voice(760, t, 0.06, 0.08, { type: 'sine', slideTo: 1040, cutoff: 4000 })); }
    streak()   { this._play('streak', 0.06, (t) => this._voice(680, t, 0.12, 0.12, { type: 'triangle', slideTo: 1320, cutoff: 3600, detune: 7 })); }
    chest()    { this._play('chest', 0.1, (t) => this._bell(t, 523)); }
    forge()    { this._play('forge', 0.06, (t) => { this._noise(t, 0.16, 0.12, 500, this.sfxBus, 1400); this._voice(220, t, 0.18, 0.12, { type: 'triangle', cutoff: 1400, detune: 9 }); }); }
    reveal()   { this._play('reveal', 0.1, (t) => { this._bell(t, 659); this._voice(988, t + 0.08, 0.3, 0.1, { type: 'sine', cutoff: 5000, detune: 6 }); }); }
    objective(){ this._play('obj', 0.1, (t) => { this._voice(784, t, 0.12, 0.12, { type: 'triangle', cutoff: 3600 }); this._voice(1175, t + 0.09, 0.24, 0.12, { type: 'triangle', cutoff: 4200, detune: 6 }); }); }
    caseOpen() { this._play('caseOpen', 0.1, (t) => { this._noise(t, 0.34, 0.10, 300, this.sfxBus, 2600); this._voice(330, t, 0.2, 0.08, { type: 'sine', slideTo: 660, cutoff: 2400 }); }); }
    // A warm bell = fundamental + a quieter octave, both lightly detuned.
    _bell(t, freq) {
        this._voice(freq, t, 0.5, 0.13, { type: 'sine', cutoff: 4000, detune: 5, attack: 0.005 });
        this._voice(freq * 2, t, 0.32, 0.05, { type: 'sine', cutoff: 5000, attack: 0.005 });
    }
    levelUp()  {
        this._play('levelUp', 0.1, (t) => {
            this._voice(523, t, 0.16, 0.13, { type: 'triangle', cutoff: 3200, detune: 7 });
            this._voice(659, t + 0.09, 0.16, 0.13, { type: 'triangle', cutoff: 3400, detune: 7 });
            this._voice(784, t + 0.18, 0.28, 0.14, { type: 'triangle', cutoff: 3800, detune: 7 });
        });
    }
    bossSpawn() {
        this._play('boss', 0.2, (t) => {
            this._voice(90, t, 0.7, 0.2, { type: 'sine', slideTo: 44, cutoff: 700, attack: 0.01 });
            this._noise(t, 0.6, 0.12, 220, this.sfxBus, 600); // low ominous swell
        });
    }
    gameOver() {
        this._play('gameover', 0.3, (t) => {
            this._voice(392, t, 0.4, 0.14, { type: 'triangle', slideTo: 196, cutoff: 2400, detune: 6 });
            this._voice(262, t + 0.28, 0.6, 0.14, { type: 'triangle', slideTo: 130, cutoff: 1800, detune: 6 });
        });
    }
}
