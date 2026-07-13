// Adaptive-score catalog. All combat music is an original, code-authored
// tracker score rendered by AudioSystem with Web Audio. The one recorded menu
// feature is deliberately a one-shot stream: it is never decoded into a large
// AudioBuffer and never layered against the beat-locked tracker arrangements.

export const SCORE_FORM = Object.freeze([
    'A', 'A', 'A', 'A',
    'B', 'B', 'B', 'B',
    'C', 'C', 'C', 'C',
    'D', 'D', 'D', 'D',
]);

export const MUSIC_SCALES = Object.freeze({
    minorPent: Object.freeze([0, 3, 5, 7, 10]),
    majorPent: Object.freeze([0, 2, 4, 7, 9]),
    minor: Object.freeze([0, 2, 3, 5, 7, 8, 10]),
    dorian: Object.freeze([0, 2, 3, 5, 7, 9, 10]),
    phrygian: Object.freeze([0, 1, 3, 5, 7, 8, 10]),
    harmonicMinor: Object.freeze([0, 2, 3, 5, 7, 8, 11]),
    lydian: Object.freeze([0, 2, 4, 6, 7, 9, 11]),
});

const N = null;

function tracker(config) {
    const sectionNames = ['A', 'B', 'C', 'D'];
    const sections = {};
    for (const key of sectionNames) {
        sections[key] = Object.freeze({
            progression: Object.freeze(config.harmony[key].slice()),
            melody: Object.freeze(config.motifs[key].slice()),
            counter: Object.freeze((config.counter?.[key] || []).slice()),
            bassWalk: Object.freeze((config.bassWalk?.[key] || [0, 0, 2, 0]).slice()),
            density: config.density?.[key] ?? 1,
        });
    }
    return Object.freeze({
        kind: 'tracker',
        bars: SCORE_FORM.length,
        form: SCORE_FORM,
        energy: 1,
        cutoff: 3000,
        reverb: 0.2,
        swing: 0,
        ...config,
        sections: Object.freeze(sections),
    });
}

// Three wholly different tracker compositions plus one human-authored CC0
// feature. The shuffle bag in AudioSystem prevents immediate repeats.
export const MENU_COMPOSITIONS = Object.freeze([
    tracker({
        id: 'menu_hearthbound', title: 'Hearthbound', role: 'menu', bpm: 88,
        root: 50, scale: MUSIC_SCALES.dorian, swing: 0.17, cutoff: 2500, reverb: 0.28, energy: 0.62,
        groove: 'hearth', instruments: { lead: 'emberFlute', counter: 'dulcimer', bass: 'warmBass', pad: 'choir' },
        harmony: { A: [0, 5, 3, 0], B: [0, 7, 5, 3], C: [3, 5, 0, 7], D: [5, 3, 7, 0] },
        motifs: {
            A: [0, N, 2, N, 4, N, 2, N, 3, N, 5, N, 4, N, 2, N],
            B: [4, N, 5, 7, N, 5, N, 4, 2, N, 3, N, 2, N, 0, N],
            C: [7, N, N, 5, 4, N, 2, N, 3, N, 4, 5, N, 4, 2, N],
            D: [5, N, 4, N, 3, 2, N, 0, N, 2, N, 3, 2, N, 0, N],
        },
        counter: { C: [N, 0, N, 2, N, 4, N, 2, N, 3, N, 5, N, 4, N, 2], D: [N, 4, N, 3, N, 2, N, 0] },
    }),
    tracker({
        id: 'menu_long_watch', title: 'The Long Watch', role: 'menu', bpm: 72,
        root: 45, scale: MUSIC_SCALES.minorPent, swing: 0.08, cutoff: 1900, reverb: 0.38, energy: 0.52,
        groove: 'vigil', instruments: { lead: 'lowReed', counter: 'frostGlass', bass: 'bowedBass', pad: 'nightStrings' },
        harmony: { A: [0, 3, 5, 0], B: [0, 5, 7, 3], C: [5, 3, 0, 7], D: [3, 5, 7, 0] },
        motifs: {
            A: [0, N, N, N, 2, N, N, N, 4, N, N, 3, N, N, 2, N],
            B: [5, N, N, 4, N, N, 2, N, N, N, 4, N, 3, N, N, N],
            C: [7, N, 5, N, N, N, 4, N, 2, N, N, 3, N, N, 0, N],
            D: [4, N, N, 3, N, 2, N, N, 3, N, 2, N, 0, N, N, N],
        },
        counter: { B: [N, N, 0, N, N, N, 2, N, N, N, 4, N], C: [N, 2, N, N, 4, N, N, 5] },
    }),
    tracker({
        id: 'menu_kindled_vow', title: 'Kindled Vow', role: 'menu', bpm: 106,
        root: 52, scale: MUSIC_SCALES.minor, swing: 0.11, cutoff: 3300, reverb: 0.19, energy: 0.72,
        groove: 'march', instruments: { lead: 'heroStrings', counter: 'emberBell', bass: 'pulseBass', pad: 'brassPad' },
        harmony: { A: [0, 8, 5, 7], B: [0, 3, 5, 8], C: [5, 7, 8, 10], D: [3, 5, 7, 0] },
        motifs: {
            A: [0, N, 2, 3, N, 4, N, 7, N, 5, 4, N, 3, N, 2, N],
            B: [7, N, 8, 7, N, 5, 4, N, 5, N, 4, 3, N, 2, N, 0],
            C: [9, N, 7, 8, N, 7, N, 5, 4, 5, N, 7, N, 5, 4, N],
            D: [7, 5, N, 4, 3, N, 2, 4, N, 3, 2, N, 0, N, N, N],
        },
        counter: { B: [N, 0, N, 2, N, 3, N, 4, N, 3, N, 2], C: [0, N, 4, N, 7, N, 4, N, 9, N, 7, N, 4, N, 2, N] },
    }),
    Object.freeze({
        id: 'menu_bards_tale', title: "The Bard's Tale", role: 'menu', kind: 'recorded',
        file: new URL('../assets/audio/music/menu/the_bards_tale.mp3', import.meta.url).href,
        repoFile: 'src/assets/audio/music/menu/the_bards_tale.mp3',
        duration: 158, oneShot: true, streaming: true, fallbackId: 'menu_hearthbound',
        creditId: 'music-bards-tale',
    }),
]);

function biomeScore(id, title, biome, bpm, root, scale, groove, instruments, harmony, motifs, extra = {}) {
    return tracker({ id, title, role: 'gameplay', biome, bpm, root, scale, groove, instruments, harmony, motifs, ...extra });
}

export const BIOME_COMPOSITIONS = Object.freeze({
    emberwood: Object.freeze([
        biomeScore('emberwood_ashgrove_run', 'Ashgrove Run', 'emberwood', 126, 45, MUSIC_SCALES.minorPent, 'hearthDrive',
            { lead: 'emberFlute', counter: 'dulcimer', bass: 'warmBass', pad: 'forestStrings' },
            { A: [0, 7, 3, 5], B: [0, 5, 7, 3], C: [3, 0, 5, 7], D: [5, 7, 3, 0] }, {
                A: [0, N, 3, 2, N, 4, N, 5, 4, N, 2, 3, N, 2, N, 0],
                B: [7, N, 5, 4, N, 5, 7, N, 9, N, 7, 5, N, 4, 2, N],
                C: [0, 2, 3, N, 4, 5, N, 7, 5, N, 4, 3, 2, N, 3, N],
                D: [7, 5, 4, N, 3, 2, 0, N, 4, 3, 2, N, 0, N, N, N],
            }, { swing: 0.1, cutoff: 3000, reverb: 0.18 }),
        biomeScore('emberwood_greenfire_dance', 'Greenfire Dance', 'emberwood', 112, 50, MUSIC_SCALES.dorian, 'woodland',
            { lead: 'reedPipe', counter: 'woodPluck', bass: 'bowedBass', pad: 'choir' },
            { A: [0, 3, 5, 7], B: [0, 7, 5, 3], C: [5, 3, 0, 7], D: [3, 5, 7, 0] }, {
                A: [0, 2, N, 3, N, 5, 4, N, 2, N, 3, 4, N, 2, 0, N],
                B: [5, N, 7, 5, 4, N, 3, N, 5, 4, N, 2, 3, N, 0, N],
                C: [7, N, 5, N, 4, 5, 7, N, 9, N, 7, 5, N, 4, 3, N],
                D: [5, 4, 3, 2, N, 3, 2, 0, N, 2, N, 0, N, N, N, N],
            }, { swing: 0.18, cutoff: 2700, reverb: 0.25 }),
    ]),
    hollowreach: Object.freeze([
        biomeScore('hollowreach_white_vigil', 'White Vigil', 'hollowreach', 118, 48, MUSIC_SCALES.dorian, 'frost',
            { lead: 'frostGlass', counter: 'icePluck', bass: 'bowedBass', pad: 'nightStrings' },
            { A: [0, 5, 3, 7], B: [0, 7, 9, 5], C: [3, 5, 0, 7], D: [5, 3, 7, 0] }, {
                A: [0, N, N, 4, N, 3, N, N, 2, N, N, 4, N, N, 3, 2],
                B: [7, N, N, 5, N, 4, N, N, 5, N, 7, N, N, 4, N, N],
                C: [9, N, 7, N, 5, N, 4, 5, N, 7, N, 5, 4, N, 2, N],
                D: [7, N, 5, 4, N, 3, N, 2, 4, N, 3, N, 2, N, 0, N],
            }, { swing: 0.06, cutoff: 3500, reverb: 0.38 }),
        biomeScore('hollowreach_under_aurora', 'Under the Aurora', 'hollowreach', 96, 53, MUSIC_SCALES.lydian, 'glacier',
            { lead: 'glassChoir', counter: 'frostGlass', bass: 'warmBass', pad: 'auroraPad' },
            { A: [0, 4, 7, 5], B: [0, 7, 9, 4], C: [5, 7, 4, 0], D: [9, 7, 5, 0] }, {
                A: [0, N, 2, N, 4, N, 6, N, 4, N, 2, N, 7, N, 6, N],
                B: [7, N, 9, N, 11, N, 9, 7, N, 6, N, 4, N, 2, N, N],
                C: [4, N, 6, 7, N, 9, N, 11, 9, N, 7, N, 6, N, 4, N],
                D: [11, N, 9, N, 7, 6, N, 4, N, 6, 4, N, 2, N, 0, N],
            }, { swing: 0.02, cutoff: 4100, reverb: 0.46, energy: 0.84 }),
    ]),
    crypts: Object.freeze([
        biomeScore('crypts_bone_procession', 'Bone Procession', 'crypts', 132, 41, MUSIC_SCALES.minor, 'boneMarch',
            { lead: 'boneReed', counter: 'boneClick', bass: 'pulseBass', pad: 'voidChoir' },
            { A: [0, 3, 8, 10], B: [0, 8, 5, 3], C: [10, 8, 3, 5], D: [3, 1, 10, 0] }, {
                A: [0, N, 0, 2, N, 3, N, 0, N, 2, N, 3, 5, N, 3, 2],
                B: [5, N, 5, 4, N, 3, N, 5, N, 7, N, 5, 4, N, 3, N],
                C: [0, 0, N, 3, 2, N, 0, N, 5, N, 4, 3, N, 2, 1, N],
                D: [7, 5, 4, 3, N, 5, 3, 2, 1, N, 0, 2, N, 0, N, N],
            }, { swing: 0.04, cutoff: 2200, reverb: 0.3 }),
        biomeScore('crypts_lanterns_below', 'Lanterns Below', 'crypts', 104, 38, MUSIC_SCALES.phrygian, 'tomb',
            { lead: 'lowReed', counter: 'graveBell', bass: 'subDrone', pad: 'nightStrings' },
            { A: [0, 1, 5, 3], B: [0, 8, 1, 5], C: [3, 1, 0, 8], D: [5, 3, 1, 0] }, {
                A: [0, N, 1, N, 3, N, 1, 0, N, N, 5, N, 3, N, 1, N],
                B: [7, N, 5, N, 4, 3, N, 1, 3, N, 1, N, 0, N, N, N],
                C: [5, N, N, 7, N, 5, 4, N, 3, N, N, 1, N, 3, 1, N],
                D: [4, 3, N, 1, N, 0, N, 1, 3, N, 1, N, 0, N, N, N],
            }, { swing: 0.12, cutoff: 1700, reverb: 0.42, energy: 0.9 }),
    ]),
    dunes: Object.freeze([
        biomeScore('dunes_serpent_step', 'Serpent Step', 'dunes', 124, 46, MUSIC_SCALES.phrygian, 'sand',
            { lead: 'sandOud', counter: 'reedPipe', bass: 'warmBass', pad: 'sunDrone' },
            { A: [0, 1, 0, 5], B: [0, 8, 1, 3], C: [5, 3, 1, 0], D: [1, 5, 3, 0] }, {
                A: [0, 1, 0, N, 3, N, 2, 1, N, 0, N, 4, 3, N, 1, 0],
                B: [5, N, 4, 5, N, 7, N, 5, 4, N, 3, 4, N, 1, N, 0],
                C: [0, 1, 3, 4, N, 3, 1, N, 5, 4, 3, N, 1, 0, N, N],
                D: [7, 5, 4, 3, 1, N, 3, 1, 0, 1, N, 0, N, N, N, N],
            }, { swing: 0.16, cutoff: 2800, reverb: 0.14 }),
        biomeScore('dunes_sunscorch_caravan', 'Sunscorch Caravan', 'dunes', 138, 43, MUSIC_SCALES.harmonicMinor, 'caravan',
            { lead: 'brightOud', counter: 'sunBell', bass: 'pulseBass', pad: 'brassPad' },
            { A: [0, 5, 8, 11], B: [0, 3, 5, 11], C: [8, 5, 3, 0], D: [5, 8, 11, 0] }, {
                A: [0, N, 2, 3, N, 5, 7, N, 8, N, 7, 5, N, 3, 2, N],
                B: [7, 8, 7, N, 5, 3, N, 2, 3, 5, N, 7, 5, N, 3, N],
                C: [8, N, 7, 8, 10, N, 8, 7, 5, N, 7, 5, 3, N, 2, N],
                D: [10, 8, 7, 5, N, 7, 5, 3, 2, N, 3, 2, 0, N, N, N],
            }, { swing: 0.09, cutoff: 3600, reverb: 0.12, energy: 1.06 }),
    ]),
});

function bossScore(id, title, bpm, root, scale, groove, instruments, harmony, motifs, extra = {}) {
    return tracker({ id, title, role: 'boss', bpm, root, scale, groove, instruments, harmony, motifs, energy: 1.12, ...extra });
}

export const BOSS_SUITES = Object.freeze({
    tempest: bossScore('boss_tempest_crown', 'Tempest Crown', 154, 38, MUSIC_SCALES.dorian, 'tempestWar',
        { lead: 'warHorn', counter: 'stormArp', bass: 'pulseBass', pad: 'brassPad' },
        { A: [0, 7, 5, 3], B: [0, 9, 7, 5], C: [5, 7, 9, 3], D: [7, 5, 3, 0] }, {
            A: [0, 0, N, 3, 0, N, 2, 0, N, 3, 0, 2, N, 4, 3, 2],
            B: [5, N, 4, 3, 5, N, 7, 5, N, 4, 3, N, 5, 4, 3, 0],
            C: [7, 9, 7, N, 5, 7, N, 9, 10, N, 9, 7, 5, N, 4, N],
            D: [9, 7, 5, 4, 3, N, 5, 3, 2, 0, 2, 3, N, 0, N, N],
        }, { cutoff: 3000, reverb: 0.24 }),
    behemoth: bossScore('boss_iron_colossus', 'Iron Colossus', 136, 34, MUSIC_SCALES.minorPent, 'colossusWar',
        { lead: 'ironStrings', counter: 'anvilPulse', bass: 'subDrone', pad: 'warChoir' },
        { A: [0, 3, 0, 5], B: [0, 7, 5, 3], C: [3, 5, 7, 10], D: [5, 3, 10, 0] }, {
            A: [0, N, 0, N, 3, N, 0, N, 5, N, 3, N, 0, N, N, N],
            B: [5, N, 5, 3, N, 0, N, 3, 7, N, 5, N, 3, N, 0, N],
            C: [7, N, 10, 7, N, 5, 3, N, 5, N, 7, 5, 3, N, 0, N],
            D: [10, 7, 5, 3, 0, N, 3, 5, N, 3, 0, N, 0, N, N, N],
        }, { swing: 0.03, cutoff: 1800, reverb: 0.18 }),
    void: bossScore('boss_hollow_throne', 'The Hollow Throne', 146, 36, MUSIC_SCALES.phrygian, 'voidWar',
        { lead: 'voidLead', counter: 'graveBell', bass: 'bowedBass', pad: 'voidChoir' },
        { A: [0, 1, 8, 5], B: [0, 5, 3, 1], C: [8, 10, 1, 5], D: [3, 1, 8, 0] }, {
            A: [0, N, 1, 0, N, 3, N, 1, 5, N, 3, 1, N, 0, N, N],
            B: [7, N, 5, 4, N, 3, 1, N, 3, N, 5, N, 4, 3, 1, N],
            C: [8, 7, N, 5, 4, N, 7, 5, N, 4, 3, 1, 3, N, 1, N],
            D: [7, 5, 4, 3, 1, N, 0, 1, 3, N, 1, 0, N, 0, N, N],
        }, { swing: 0.07, cutoff: 2300, reverb: 0.4 }),
    inferno: bossScore('boss_last_sun', 'Devourer of the Last Sun', 164, 40, MUSIC_SCALES.harmonicMinor, 'infernoWar',
        { lead: 'sunBrass', counter: 'brightOud', bass: 'pulseBass', pad: 'warChoir' },
        { A: [0, 8, 5, 11], B: [0, 3, 8, 11], C: [5, 8, 10, 11], D: [8, 5, 11, 0] }, {
            A: [0, 0, 2, N, 3, 5, N, 7, 8, N, 7, 5, 3, N, 2, N],
            B: [7, 8, 10, N, 8, 7, 5, N, 7, 5, 3, N, 5, 3, 2, N],
            C: [10, N, 8, 10, 12, N, 10, 8, 7, N, 8, 7, 5, 3, N, N],
            D: [12, 10, 8, 7, 5, N, 7, 5, 3, 2, 0, 2, 3, N, 0, N],
        }, { swing: 0, cutoff: 3900, reverb: 0.16, energy: 1.18 }),
});

export const VOICE_STINGERS = Object.freeze({
    darkFoundYou: Object.freeze({
        id: 'darkFoundYou', line: 'The dark found you.',
        file: new URL('../assets/audio/voice/dark_found_you.mp3', import.meta.url).href,
        repoFile: 'src/assets/audio/voice/dark_found_you.mp3',
    }),
    hollowAnswers: Object.freeze({
        id: 'hollowAnswers', line: 'The hollow answers.',
        file: new URL('../assets/audio/voice/hollow_answers.mp3', import.meta.url).href,
        repoFile: 'src/assets/audio/voice/hollow_answers.mp3',
    }),
    onlyEmbersRemain: Object.freeze({
        id: 'onlyEmbersRemain', line: 'Only embers remain.',
        file: new URL('../assets/audio/voice/only_embers_remain.mp3', import.meta.url).href,
        repoFile: 'src/assets/audio/voice/only_embers_remain.mp3',
    }),
    wardenWakes: Object.freeze({
        id: 'wardenWakes', line: 'The warden wakes.',
        file: new URL('../assets/audio/voice/warden_wakes.mp3', import.meta.url).href,
        repoFile: 'src/assets/audio/voice/warden_wakes.mp3',
    }),
});

const general = (suite) => Object.freeze({ suite, voices: Object.freeze({ arrival: Object.freeze(['darkFoundYou']), phase2: Object.freeze([]) }) });
export const BOSS_PROFILES = Object.freeze({
    stormwingAlpha: general('tempest'),
    vinebackGoliath: general('behemoth'),
    gloomMaw: Object.freeze({ suite: 'void', voices: Object.freeze({ arrival: Object.freeze(['hollowAnswers']), phase2: Object.freeze([]) }) }),
    hoarfang: general('tempest'),
    rimewarden: Object.freeze({ suite: 'tempest', voices: Object.freeze({ arrival: Object.freeze(['wardenWakes']), phase2: Object.freeze(['darkFoundYou']) }) }),
    aurorath: general('tempest'),
    mourndrift: Object.freeze({ suite: 'void', voices: Object.freeze({ arrival: Object.freeze(['hollowAnswers']), phase2: Object.freeze([]) }) }),
    ossuar: Object.freeze({ suite: 'behemoth', voices: Object.freeze({ arrival: Object.freeze(['hollowAnswers']), phase2: Object.freeze([]) }) }),
    nihagault: Object.freeze({ suite: 'void', voices: Object.freeze({ arrival: Object.freeze(['hollowAnswers']), phase2: Object.freeze([]) }) }),
    cindermaw: general('inferno'),
    dunescourge: general('behemoth'),
    solnakh: Object.freeze({ suite: 'inferno', voices: Object.freeze({ arrival: Object.freeze(['darkFoundYou']), phase2: Object.freeze(['onlyEmbersRemain']) }) }),
});

export const VICTORY_COMPOSITION = tracker({
    id: 'victory_first_light', title: 'First Light Returns', role: 'victory', bpm: 116,
    root: 52, scale: MUSIC_SCALES.majorPent, groove: 'triumph', swing: 0.08,
    instruments: { lead: 'heroStrings', counter: 'emberBell', bass: 'warmBass', pad: 'brassPad' },
    harmony: { A: [0, 4, 7, 4], B: [0, 7, 9, 4], C: [4, 7, 9, 11], D: [7, 4, 2, 0] },
    motifs: {
        A: [0, N, 2, 4, N, 7, N, 4, 2, N, 4, N, 7, N, 9, N],
        B: [7, N, 9, 7, N, 4, N, 7, N, 9, 11, N, 9, 7, 4, N],
        C: [9, 11, 12, N, 11, 9, 7, N, 9, N, 7, 4, 7, N, 9, N],
        D: [12, 11, 9, 7, N, 9, 7, 4, 2, N, 4, 2, 0, N, N, N],
    },
    cutoff: 4400, reverb: 0.3, energy: 0.92,
});

export const TRACKER_COMPOSITIONS = Object.freeze([
    ...MENU_COMPOSITIONS.filter((score) => score.kind === 'tracker'),
    ...Object.values(BIOME_COMPOSITIONS).flat(),
    ...Object.values(BOSS_SUITES),
    VICTORY_COMPOSITION,
]);

export const MUSIC_BY_ID = Object.freeze(Object.fromEntries(
    [...MENU_COMPOSITIONS, ...TRACKER_COMPOSITIONS].map((score) => [score.id, score])
));
