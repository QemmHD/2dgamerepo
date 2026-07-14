// Vigil Sites — small, once-per-run discoveries placed inside existing
// enterable structures. This module is pure authored data: selection, runtime
// state, rendering, and event emission live in VigilSiteSystem.
//
// Rewards are deliberately bounded and expressed as events. The integration
// layer remains authoritative for changing Player/Save state and for creating
// Enemy instances.

export const VIGIL_SITE_LIMITS = Object.freeze({
    maxSites: 4,
    maxQueuedEvents: 12,
    maxGuardians: 3,
    minInteriorW: 180,
    minInteriorH: 150,
    spawnAcknowledgeSeconds: 2.0,
    cullMargin: 150,
});

export const VIGIL_SITE_ORDER = Object.freeze([
    'hearth',
    'archive',
    'cache',
    'beacon',
]);

// Every site has a distinct silhouette/symbol as well as a color. That keeps
// the interactions readable in reduced-color or effects-light play.
export const VIGIL_SITE_ARCHETYPES = Object.freeze({
    hearth: Object.freeze({
        id: 'hearth',
        name: 'Wayfarer Hearth',
        verb: 'RESTORE',
        symbol: '+',
        description: 'A sheltered wick restores a measured share of health.',
        accent: '#ff9a4a',
        core: '#ffe1a0',
        activationRadius: 74,
        dwellSeconds: 0.55,
        reward: Object.freeze({
            type: 'heal',
            fraction: 0.34,
            min: 24,
            max: 78,
        }),
    }),
    archive: Object.freeze({
        id: 'archive',
        name: 'Ashen Archive',
        verb: 'READ',
        symbol: 'XP',
        description: 'A keeper chronicle grants run experience once deciphered.',
        accent: '#7fd0ff',
        core: '#d7f2ff',
        activationRadius: 72,
        dwellSeconds: 0.65,
        reward: Object.freeze({
            type: 'xp',
            // Roughly one early level and a declining share later; discovery
            // helps a build without dumping a stack of draft modals at once.
            base: 10,
            perLevel: 2,
            max: 44,
        }),
    }),
    cache: Object.freeze({
        id: 'cache',
        name: 'Keeper Cache',
        verb: 'OPEN',
        symbol: '$',
        description: 'An old field coffer adds earned currency to this run.',
        accent: '#ffd166',
        core: '#fff1b8',
        activationRadius: 70,
        dwellSeconds: 0.50,
        reward: Object.freeze({
            type: 'coins',
            min: 24,
            max: 42,
        }),
    }),
    beacon: Object.freeze({
        id: 'beacon',
        name: 'Gloam Beacon',
        verb: 'KINDLE',
        symbol: '!',
        description: 'Kindling the beacon calls a small guardian pack to clear.',
        accent: '#ff6a78',
        core: '#ffd0b0',
        activationRadius: 82,
        dwellSeconds: 0.80,
        challenge: Object.freeze({
            count: 3,
            completionCoins: 52,
            completionXp: 24,
        }),
    }),
});

// Guardian choices stay in ordinary-enemy territory: no boss, summoner, or
// splitter definitions that could silently multiply the bounded encounter.
export const VIGIL_SITE_BIOMES = Object.freeze({
    emberwood: Object.freeze({
        guardianTypes: Object.freeze(['brute', 'brawler', 'crawler']),
        tint: '#ffb05f',
    }),
    hollowreach: Object.freeze({
        guardianTypes: Object.freeze(['shielder', 'skeleton', 'brute']),
        tint: '#a9ddff',
    }),
    crypts: Object.freeze({
        guardianTypes: Object.freeze(['zombie', 'skeleton', 'brawler']),
        tint: '#c4a8ff',
    }),
    dunes: Object.freeze({
        guardianTypes: Object.freeze(['charger', 'brawler', 'emberskeleton']),
        tint: '#ffd07a',
    }),
});

export const DEFAULT_VIGIL_SITE_BIOME = 'emberwood';

export function getVigilSiteArchetype(id) {
    return VIGIL_SITE_ARCHETYPES[id] || null;
}

export function getVigilSiteBiome(id) {
    return VIGIL_SITE_BIOMES[id] || VIGIL_SITE_BIOMES[DEFAULT_VIGIL_SITE_BIOME];
}
