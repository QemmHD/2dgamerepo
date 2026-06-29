// AudioSystem — fully procedural Web Audio (no asset files, per the project's
// no-external-assets rule). Synthesizes themed background music + UI/gameplay
// SFX on the fly. It feature-detects AudioContext, so in headless / unsupported
// environments every method is a silent no-op (nothing throws).
//
// Browsers block audio until a user gesture, so the context is created lazily
// and `resume()` must be called from a click/keydown (Game does this on the
// first menu interaction and on run start). Volume is driven by the save
// settings volMusic / volSfx via setVolumes().
//
// Music is a tiny lookahead step-sequencer: a 16-step loop whose note tables +
// tempo + timbre change per theme (menu = calm minor arpeggio, gameplay =
// driving pulse, boss = tense low sawtooth). SFX are short enveloped
// oscillator / filtered-noise blips, throttled so dense frames don't machine-gun.

const A4 = 440;
const hz = (midi) => A4 * Math.pow(2, (midi - 69) / 12);

// 16-step note tables (MIDI) per theme.
const THEMES = {
    menu:     { bpm: 84,  wave: 'sine',     notes: [57, 60, 64, 67, 64, 60, 62, 65, 69, 65, 62, 60, 57, 60, 64, 67] },
    gameplay: { bpm: 122, wave: 'square',   notes: [45, 57, 52, 57, 48, 60, 55, 60, 50, 62, 57, 62, 47, 59, 54, 59] },
    boss:     { bpm: 144, wave: 'sawtooth', notes: [38, 38, 41, 38, 36, 36, 43, 36, 38, 45, 41, 38, 36, 43, 41, 45] },
};

export class AudioSystem {
    constructor() {
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        this.enabled = !!AC;
        this._AC = AC || null;
        this.ctx = null;
        this.master = null;
        this.musicBus = null;
        this.sfxBus = null;
        this.volMusic = 0.7;
        this.volSfx = 0.8;
        this.theme = null;          // currently-playing theme (scheduler reads this)
        this._schedId = null;
        this._nextTime = 0;
        this._step = 0;
        this._lastSfx = {};         // name → last play time (throttle)
        this._noiseBuf = null;
    }

    // Create the context + bus graph once. Safe to call repeatedly.
    _ensure() {
        if (!this.enabled || this.ctx) return;
        try {
            this.ctx = new this._AC();
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.85;
            this.master.connect(this.ctx.destination);
            this.musicBus = this.ctx.createGain();
            this.musicBus.gain.value = this.volMusic * 0.45;
            this.musicBus.connect(this.master);
            this.sfxBus = this.ctx.createGain();
            this.sfxBus.gain.value = this.volSfx;
            this.sfxBus.connect(this.master);
            // Pre-render a 1s white-noise buffer for percussive SFX.
            const len = Math.floor(this.ctx.sampleRate);
            this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
            const d = this._noiseBuf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        } catch (e) {
            this.enabled = false;
        }
    }

    // Must be called from a user gesture (resumes a suspended context + starts
    // the music scheduler). No-op when audio is unsupported.
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
        if (this.musicBus) this.musicBus.gain.value = this.volMusic * 0.45;
        if (this.sfxBus) this.sfxBus.gain.value = this.volSfx;
    }

    // Switch the background theme ('menu' | 'gameplay' | 'boss' | null).
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
                this._nextTime += (60 / t.bpm) / 2; // eighth-notes
                this._step = (this._step + 1) % 16;
            }
        };
        this._schedId = setInterval(tick, 25);
    }

    _scheduleStep(step, t) {
        const def = THEMES[this.theme];
        if (!def || !this.musicBus) return;
        const midi = def.notes[step % def.notes.length];
        // Bass on downbeats.
        if (step % 4 === 0) this._tone(hz(midi - 12), t, 0.30, 'triangle', 0.16, this.musicBus);
        // Lead / arpeggio.
        const lead = this.theme === 'menu' ? 0.45 : 0.16;
        const g = this.theme === 'menu' ? 0.085 : 0.07;
        this._tone(hz(midi), t, lead, def.wave, g, this.musicBus);
        // Boss gets an off-beat percussive tick for tension.
        if (this.theme === 'boss' && step % 2 === 1) this._noiseHit(t, 0.05, 0.05, 1800, this.musicBus);
    }

    // ── Low-level voices ───────────────────────────────────────────────────
    _tone(freq, t, dur, type, gain, bus, slideTo = 0) {
        if (!this.ctx) return;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (slideTo > 0) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gain, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
        o.connect(g); g.connect(bus || this.sfxBus);
        o.start(t); o.stop(t + dur + 0.03);
    }

    _noiseHit(t, dur, gain, filterFreq, bus) {
        if (!this.ctx || !this._noiseBuf) return;
        const src = this.ctx.createBufferSource();
        src.buffer = this._noiseBuf;
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = filterFreq; f.Q.value = 0.8;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
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

    click()    { this._play('click', 0.02, (t) => this._tone(660, t, 0.05, 'square', 0.16)); }
    hover()    { this._play('hover', 0.03, (t) => this._tone(880, t, 0.03, 'sine', 0.07)); }
    hurt()     { this._play('hurt', 0.10, (t) => this._tone(170, t, 0.14, 'sawtooth', 0.20, this.sfxBus, 80)); }
    kill()     { this._play('kill', 0.045, (t) => this._tone(300, t, 0.08, 'triangle', 0.13, this.sfxBus, 130)); }
    coin()     { this._play('coin', 0.04, (t) => this._tone(1040, t, 0.06, 'square', 0.11, this.sfxBus, 1500)); }
    gem()      { this._play('gem', 0.05, (t) => this._tone(740, t, 0.05, 'sine', 0.09, this.sfxBus, 980)); }
    streak()   { this._play('streak', 0.06, (t) => this._tone(720, t, 0.10, 'square', 0.15, this.sfxBus, 1500)); }
    chest()    { this._play('chest', 0.1, (t) => { this._tone(523, t, 0.10, 'triangle', 0.16); this._tone(784, t + 0.08, 0.16, 'triangle', 0.16); }); }
    forge()    { this._play('forge', 0.08, (t) => { this._noiseHit(t, 0.12, 0.18, 600); this._tone(196, t, 0.18, 'sawtooth', 0.16); }); }
    reveal()   { this._play('reveal', 0.1, (t) => { this._tone(659, t, 0.1, 'square', 0.16); this._tone(988, t + 0.09, 0.22, 'square', 0.16); }); }
    objective(){ this._play('obj', 0.1, (t) => { this._tone(784, t, 0.1, 'sine', 0.16); this._tone(1175, t + 0.09, 0.2, 'sine', 0.16); }); }
    levelUp()  {
        this._play('levelUp', 0.1, (t) => {
            this._tone(523, t, 0.12, 'square', 0.18);
            this._tone(659, t + 0.08, 0.12, 'square', 0.18);
            this._tone(784, t + 0.16, 0.20, 'square', 0.18);
        });
    }
    bossSpawn() {
        this._play('boss', 0.2, (t) => {
            this._tone(110, t, 0.55, 'sawtooth', 0.26, this.sfxBus, 55);
            this._noiseHit(t, 0.45, 0.18, 380);
        });
    }
    gameOver() {
        this._play('gameover', 0.3, (t) => {
            this._tone(330, t, 0.3, 'sawtooth', 0.20, this.sfxBus, 120);
            this._tone(220, t + 0.22, 0.5, 'sawtooth', 0.20, this.sfxBus, 82);
        });
    }
}
