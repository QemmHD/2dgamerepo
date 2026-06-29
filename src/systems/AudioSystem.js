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

// Minor pentatonic — energetic and impossible to make dissonant, so the
// groove can drive hard without going harsh/tiring.
const PENT = [0, 3, 5, 7, 10];

// Resolve a scale degree (can be negative or span octaves) to a MIDI note.
function degToMidi(root, scale, deg) {
    const len = scale.length;
    const oct = Math.floor(deg / len);
    const idx = ((deg % len) + len) % len;
    return root + oct * 12 + scale[idx];
}

// Themes are now full grooves, not a single melody loop: each has a DRUM bed
// (kick + hat) for drive, a BASS that pumps the chord root, and a LEAD with an
// A and B section. A per-bar chord PROGRESSION + the 8-bar A/B phrase make the
// loop evolve (~16s before it truly repeats) so it reads as hype without
// fatiguing over a long session. Patterns are 16 sixteenth-notes per bar;
// `null` = rest (space matters — it keeps the groove from feeling relentless).
const THEMES = {
    menu: {
        bpm: 96, wave: 'triangle', cutoff: 2400, root: 57, scale: PENT, energy: 0.6,
        prog: [0, 0, 3, 5],
        lead:  [0, null, 2, null, 4, null, 2, null, 3, null, 5, null, 4, null, 2, null],
        leadB: [4, null, 3, null, 2, null, 3, null, 1, null, 2, null, 0, null, null, null],
        bassSteps: [0, 8], kick: [0, 8], hat: [4, 12],
    },
    gameplay: {
        bpm: 128, wave: 'triangle', cutoff: 2900, root: 45, scale: PENT, energy: 1.0,
        prog: [0, 7, 3, 5],
        lead:  [0, null, 3, 2, null, 4, null, 5, 4, null, 2, 3, null, 2, null, 0],
        leadB: [7, null, 5, 4, null, 5, 7, null, 9, null, 7, 5, null, 4, 2, null],
        bassSteps: [0, 3, 6, 8, 11, 14], kick: [0, 4, 8, 12], hat: [2, 6, 10, 14],
    },
    boss: {
        bpm: 152, wave: 'sawtooth', cutoff: 1600, root: 38, scale: PENT, energy: 1.12,
        prog: [0, 0, 10, 3],
        lead:  [0, 0, null, 3, 0, null, 2, 0, null, 3, 0, 2, null, 4, 3, 2],
        leadB: [5, null, 4, 3, 5, null, 7, 5, null, 4, 3, null, 5, 4, 3, 0],
        bassSteps: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 4, 8, 12], hat: [2, 6, 10, 14],
    },
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
        this._bar = 0;
        this._lastSfx = {};
        this._noiseBuf = null;
        // Dynamic music intensity (0..1) — driven by enemy density / boss low
        // HP. Brightens the master filter and layers in extra drive.
        this._intensity = 0;
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

    // Dynamic intensity (0..1): the game feeds this from enemy density and boss
    // low-HP. It brightens the master low-pass (duller when calm, brighter when
    // it's hectic) and the scheduler layers in extra drive at high values.
    setIntensity(level) {
        const v = Math.max(0, Math.min(1, level || 0));
        this._intensity = v;
        if (this.masterFilter) this.masterFilter.frequency.value = 5600 + v * 2600;
    }

    // ── Music scheduler ──────────────────────────────────────────────────
    // Steps are sixteenth-notes; 16 per bar. `_bar` advances when the step
    // wraps so the groove can evolve across an 8-bar phrase (A/B + chord moves).
    _startScheduler() {
        this._nextTime = this.ctx.currentTime + 0.08;
        this._step = 0;
        this._bar = 0;
        const tick = () => {
            if (!this.ctx) return;
            const horizon = this.ctx.currentTime + 0.2;
            while (this._nextTime < horizon) {
                if (this.theme) this._scheduleStep(this._step, this._nextTime);
                const t = THEMES[this.theme] || THEMES.menu;
                this._nextTime += (60 / t.bpm) / 4; // sixteenth note
                this._step = (this._step + 1) % 16;
                if (this._step === 0) this._bar = (this._bar + 1) % 64;
            }
        };
        this._schedId = setInterval(tick, 25);
    }

    _scheduleStep(step, t) {
        const def = THEMES[this.theme];
        if (!def || !this.musicBus) return;
        const e = def.energy;
        const bar = this._bar;
        // Per-bar chord movement + an 8-bar A/B phrase so the loop keeps
        // changing (less fatigue over a long session).
        const chord = def.prog[bar % def.prog.length];
        const root = def.root + chord;
        const useB = (bar % 8) >= 4;
        const beatDur = (60 / def.bpm) / 4;

        // DRUMS — the drive. Kick = pitched sine drop; hat = a soft noise tick.
        if (def.kick.includes(step)) this._kick(t, e);
        if (def.hat.includes(step)) this._hat(t, e * (step % 4 === 0 ? 0.6 : 1));
        // End-of-phrase fill: a busier hat run so the loop "breathes" + lifts.
        if ((bar % 8) === 7 && step >= 12) this._hat(t, e * 0.7);
        // Dynamic intensity: drive extra off-beat hats when the floor fills,
        // and double the kick when it's truly hectic / a boss is near death.
        const ix = this._intensity;
        if (ix > 0.5 && (step === 1 || step === 5 || step === 9 || step === 13)) {
            this._hat(t, e * 0.45 * ix);
        }
        if (ix > 0.8 && (step === 6 || step === 14)) this._kick(t, e * 0.6);

        // BASS — pumps the chord root an octave down (warm sine).
        if (def.bassSteps.includes(step)) {
            this._voice(hz(degToMidi(root, def.scale, 0) - 12), t, beatDur * 1.4, 0.13 * e,
                { type: 'sine', bus: this.musicBus, cutoff: 700, attack: 0.006 });
        }

        // LEAD — A/B section, detuned pair through the theme's warm cutoff. Rests
        // (null) leave space so the groove never feels relentless/tiring.
        const deg = (useB ? def.leadB : def.lead)[step];
        if (deg !== null && deg !== undefined) {
            this._voice(hz(degToMidi(root, def.scale, deg)), t, beatDur * 1.7, 0.06 * e,
                { type: def.wave, bus: this.musicBus, cutoff: def.cutoff, attack: 0.012, detune: 7 });
        }
    }

    // Punchy kick: a fast sine pitch-drop through a low cutoff. Routed to the
    // music bus so it scales with the music volume.
    _kick(t, e = 1) {
        this._voice(140, t, 0.15, 0.22 * e, { type: 'sine', bus: this.musicBus, cutoff: 420, slideTo: 46, attack: 0.002 });
    }
    // Hat: a very short filtered-noise tick for momentum.
    _hat(t, e = 1) {
        this._noise(t, 0.028, 0.045 * e, 8500, this.musicBus);
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
    // ── Wand fire cues (throttled so a fast fire-rate isn't deafening) ──
    // Cinderbolt: a soft, dry "pew". Pyre Wisp: a warm whoosh. Lightning Wand:
    // a short crackly zap. All low-pass shaped so they stay warm, not harsh.
    shootBolt()  { this._play('shootBolt', 0.07, (t) => this._voice(640, t, 0.07, 0.06, { type: 'triangle', slideTo: 880, cutoff: 3200, attack: 0.003 })); }
    shootFire()  { this._play('shootFire', 0.08, (t) => { this._voice(300, t, 0.12, 0.06, { type: 'sine', slideTo: 200, cutoff: 1500, attack: 0.004 }); this._noise(t, 0.1, 0.04, 1200, this.sfxBus, 500); }); }
    shootShock() { this._play('shootShock', 0.08, (t) => { this._voice(1200, t, 0.06, 0.05, { type: 'sawtooth', slideTo: 720, cutoff: 4200, attack: 0.002 }); this._noise(t, 0.05, 0.04, 6000, this.sfxBus); }); }
    // Equipping a cosmetic / gear piece: a soft two-note sparkle.
    equip()    { this._play('equip', 0.04, (t) => { this._voice(880, t, 0.07, 0.08, { type: 'sine', cutoff: 4200, detune: 5 }); this._voice(1320, t + 0.05, 0.12, 0.07, { type: 'triangle', cutoff: 4600, detune: 5 }); }); }
    // Picking a level-up / upgrade card: a satisfying confirming "ding".
    upgrade()  { this._play('upgrade', 0.05, (t) => { this._voice(660, t, 0.1, 0.11, { type: 'triangle', slideTo: 990, cutoff: 3600, detune: 6 }); this._voice(990, t + 0.06, 0.2, 0.09, { type: 'triangle', cutoff: 4000, detune: 6 }); }); }
    chest()    { this._play('chest', 0.1, (t) => this._bell(t, 523)); }
    forge()    { this._play('forge', 0.06, (t) => { this._noise(t, 0.16, 0.12, 500, this.sfxBus, 1400); this._voice(220, t, 0.18, 0.12, { type: 'triangle', cutoff: 1400, detune: 9 }); }); }
    // Reel ratchet tick while a case spins (Game paces the cadence).
    spinTick() { this._play('spinTick', 0.0, (t) => this._voice(430, t, 0.03, 0.05, { type: 'triangle', cutoff: 2600, attack: 0.001 })); }
    // Reveal chime — its pitch + length + sparkle scale with the won RARITY, so
    // a legendary/mythic pull sounds clearly bigger than a common.
    reveal(rarity) {
        const order = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
        const tier = Math.max(0, order.indexOf(rarity));
        this._play('reveal', 0.1, (t) => {
            const root = 523 * Math.pow(2, tier / 6); // rises ~a fifth across tiers
            this._bell(t, root);
            const notes = 2 + tier;                    // bigger arpeggio for better pulls
            for (let i = 0; i < notes; i++) {
                this._voice(root * Math.pow(2, i / 4), t + 0.06 * i, 0.26, 0.085,
                    { type: 'triangle', cutoff: 4400, detune: 6 });
            }
            if (tier >= 3) this._noise(t + 0.05, 0.45, 0.05, 6500, this.sfxBus); // epic+ shimmer
        });
    }
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
