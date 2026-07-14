// Curated tactical encounter packs.
//
// This module is deliberately data-only: it names which existing enemies make
// up a formation, while EncounterDirector owns deterministic scheduling and
// emits placement requests for Game to apply through its canonical Enemy spawn
// path. No encounter introduces a new sprite, enemy id, reward, or damage path.

export const ENCOUNTER_LIMITS = Object.freeze({
    firstDelay: 72,
    interval: 78,
    intervalJitter: 10,
    warningDuration: 2.8,
    budgetRetryDelay: 4,
    maxUnitsPerPack: 8,
    maxSpawnRequestsPerUpdate: 1,
    hardEnemyCap: 180,
});

const pattern = (definition) => Object.freeze({
    ...definition,
    units: Object.freeze(definition.units.map((unit) => Object.freeze({ ...unit }))),
});

// `guardian` marks the bodies whose defeat resolves the encounter. Other pack
// members remain ordinary enemies and may outlive the clear announcement.
// `minWave` prevents a curated pack from revealing a type before the normal
// wave vocabulary has introduced it.
export const ENCOUNTER_PATTERNS = Object.freeze([
    // Emberwood — pursuit shapes and multiplying bodies.
    pattern({
        id: 'emberwood_hunter_wedge',
        biomeId: 'emberwood',
        name: 'Hunter Wedge',
        warning: 'Rootstalkers close from a disciplined wedge.',
        accent: '#d9c96f',
        formation: 'wedge',
        minWave: 1,
        minUnits: 4,
        spacing: 112,
        anchorDistance: 1080,
        units: [
            { type: 'crawler', count: 1, guardian: true },
            { type: 'crawler', count: 2 },
            { type: 'bat', count: 2 },
            { type: 'slime', count: 1 },
        ],
    }),
    pattern({
        id: 'emberwood_bramble_brood',
        biomeId: 'emberwood',
        name: 'Bramble Brood',
        warning: 'A splitting heart gathers a ring of hungry growth.',
        accent: '#8fd36d',
        formation: 'ring',
        minWave: 3,
        minUnits: 5,
        spacing: 120,
        anchorDistance: 1120,
        units: [
            { type: 'splitter', count: 1, guardian: true },
            { type: 'crawler', count: 2 },
            { type: 'slime', count: 3 },
            { type: 'mite', count: 2 },
        ],
    }),
    pattern({
        id: 'emberwood_elder_stampede',
        biomeId: 'emberwood',
        name: 'Elderwood Stampede',
        warning: 'A Hollow Brute drives the brood straight at the light.',
        accent: '#e8a85f',
        formation: 'diamond',
        minWave: 4,
        minUnits: 4,
        spacing: 126,
        anchorDistance: 1140,
        units: [
            { type: 'brute', count: 1, guardian: true },
            { type: 'splitter', count: 2 },
            { type: 'crawler', count: 2 },
            { type: 'mite', count: 2 },
        ],
    }),

    // Hollow Reach — airborne screens protecting deliberate heavy lines.
    pattern({
        id: 'hollowreach_whiteout_wing',
        biomeId: 'hollowreach',
        name: 'Whiteout Wing',
        warning: 'A pale wing folds around a bone-cold patrol.',
        accent: '#bfe9ff',
        formation: 'flock',
        minWave: 1,
        minUnits: 4,
        spacing: 108,
        anchorDistance: 1100,
        units: [
            { type: 'bat', count: 1, guardian: true },
            { type: 'bat', count: 3 },
            { type: 'skeleton', count: 2 },
        ],
    }),
    pattern({
        id: 'hollowreach_shield_wall',
        biomeId: 'hollowreach',
        name: 'Shield Wall',
        warning: 'Warders lock shields while the frozen dead advance.',
        accent: '#8fd7ff',
        formation: 'line',
        minWave: 4,
        minUnits: 4,
        spacing: 132,
        anchorDistance: 1160,
        units: [
            { type: 'shielder', count: 2, guardian: true },
            { type: 'zombie', count: 3 },
            { type: 'spitter', count: 1 },
        ],
    }),
    pattern({
        id: 'hollowreach_rime_bastion',
        biomeId: 'hollowreach',
        name: 'Rime Bastion',
        warning: 'A Juggernaut anchors a blinking wall of rime.',
        accent: '#d6f3ff',
        formation: 'escort',
        minWave: 4,
        minUnits: 4,
        spacing: 138,
        anchorDistance: 1180,
        units: [
            { type: 'juggernaut', count: 1, guardian: true },
            { type: 'shielder', count: 2 },
            { type: 'teleporter', count: 2 },
            { type: 'zombie', count: 2 },
        ],
    }),

    // Crypts — processions and protected back-line casters.
    pattern({
        id: 'crypts_bone_lantern_patrol',
        biomeId: 'crypts',
        name: 'Bone Lantern Patrol',
        warning: 'A lantern-bearer leads the risen through the dark.',
        accent: '#c8b3ef',
        formation: 'column',
        minWave: 1,
        minUnits: 4,
        spacing: 108,
        anchorDistance: 1080,
        units: [
            { type: 'skeleton', count: 1, guardian: true },
            { type: 'skeleton', count: 3 },
            { type: 'bat', count: 2 },
        ],
    }),
    pattern({
        id: 'crypts_grave_choir',
        biomeId: 'crypts',
        name: 'Grave Choir',
        warning: 'Silence the cantor before the dead answer its call.',
        accent: '#b889e8',
        formation: 'choir',
        minWave: 4,
        minUnits: 5,
        spacing: 122,
        anchorDistance: 1140,
        units: [
            { type: 'summoner', count: 1, guardian: true },
            { type: 'healer', count: 1 },
            { type: 'skeleton', count: 3 },
            { type: 'zombie', count: 2 },
        ],
    }),
    pattern({
        id: 'crypts_sepulture_crossfire',
        biomeId: 'crypts',
        name: 'Sepulcher Crossfire',
        warning: 'A grave ward opens two firing lanes at once.',
        accent: '#9c83d7',
        formation: 'pincer',
        minWave: 4,
        minUnits: 5,
        spacing: 130,
        anchorDistance: 1160,
        units: [
            { type: 'shielder', count: 1, guardian: true },
            { type: 'spitter', count: 2 },
            { type: 'teleporter', count: 2 },
            { type: 'zombie', count: 2 },
        ],
    }),

    // Dunes — fast wedges, diving bombers, and a late heavy breach.
    pattern({
        id: 'dunes_sunbleached_wedge',
        biomeId: 'dunes',
        name: 'Sunbleached Wedge',
        warning: 'Sandfangs drive a bleached raider toward the flame.',
        accent: '#f2cf79',
        formation: 'wedge',
        minWave: 1,
        minUnits: 4,
        spacing: 112,
        anchorDistance: 1100,
        units: [
            { type: 'crawler', count: 1, guardian: true },
            { type: 'crawler', count: 3 },
            { type: 'skeleton', count: 2 },
        ],
    }),
    pattern({
        id: 'dunes_bomber_flock',
        biomeId: 'dunes',
        name: 'Bomber Flock',
        warning: 'Cinder bombers dive behind a screen of running ash.',
        accent: '#ff9d54',
        formation: 'flock',
        minWave: 3,
        minUnits: 5,
        spacing: 118,
        anchorDistance: 1160,
        units: [
            { type: 'bomber', count: 2, guardian: true },
            { type: 'speedDemon', count: 3 },
            { type: 'crawler', count: 2 },
        ],
    }),
    pattern({
        id: 'dunes_furnace_breakers',
        biomeId: 'dunes',
        name: 'Furnace Breakers',
        warning: 'A Dreadhulk leads the last charge through the heat haze.',
        accent: '#ff7447',
        formation: 'escort',
        minWave: 5,
        minUnits: 5,
        spacing: 142,
        anchorDistance: 1200,
        units: [
            { type: 'dreadhulk', count: 1, guardian: true },
            { type: 'brawler', count: 2 },
            { type: 'charger', count: 2 },
            { type: 'emberskeleton', count: 2 },
        ],
    }),
]);

const BY_ID = Object.freeze(Object.fromEntries(
    ENCOUNTER_PATTERNS.map((entry) => [entry.id, entry]),
));

export const ENCOUNTERS_BY_BIOME = Object.freeze(Object.fromEntries(
    ['emberwood', 'hollowreach', 'crypts', 'dunes'].map((biomeId) => [
        biomeId,
        Object.freeze(ENCOUNTER_PATTERNS.filter((entry) => entry.biomeId === biomeId)),
    ]),
));

export function getEncounter(id) {
    return BY_ID[id] ?? null;
}

export function encountersForBiome(biomeId, waveIndex = Number.POSITIVE_INFINITY) {
    const entries = ENCOUNTERS_BY_BIOME[biomeId] ?? [];
    const wave = Number.isFinite(waveIndex) ? Math.max(0, Math.floor(waveIndex)) : Number.POSITIVE_INFINITY;
    return entries.filter((entry) => entry.minWave <= wave);
}

export function encounterUnitCount(entry) {
    if (!entry || !Array.isArray(entry.units)) return 0;
    return entry.units.reduce((sum, unit) => sum + unit.count, 0);
}
