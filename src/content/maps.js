// Playable maps / biomes. The world geometry is shared (same procedural
// obstacle + decoration layout), but each biome is its own DISTINCT TYPE — a
// day glade, a frozen waste, a sunless night crypt, and a sandy desert — made
// to read very differently via four cheap, art-free levers (no new sprites):
//   groundFill   a translucent biome COLOUR painted over the ground tile
//                (source-over, so it can LIGHTEN toward snow/sand, not just
//                darken like a multiply grade). The main "different surface" cue.
//   grade        an optional extra multiply tint for mood (over groundFill).
//   darkness     a per-map multiplier on the Emberlight veil strength — the
//                big DAY↔NIGHT lever (day ≈ 0.5 = bright, night = 1.0 = darkest).
//   weather      'embers' (warm rising motes) | 'snow' (pale falling flecks).
// `unlockBosses` gates a biome behind lifetime boss kills.
//
// P1.2 "Living Biomes" — two more per-map levers, both data-only here:
//   enemyMix     enemy-id → MULTIPLIER on the wave's native typeWeights
//                (folded in by Game._applyRunScale, the same layer the
//                Branching Roads segmentWeights ride). Multipliers only
//                skew what the current wave already offers, so Vigil-1
//                slime purity and the creature-unlock cadence survive —
//                each map just leans its mix a distinct way.
//   hazard       id of the map's signature ground hazard (BIOME_HAZARD in
//                GameConfig.js), spawned by HazardSystem.updateBiome.

export const MAPS = {
    emberwood: {
        id: 'emberwood',
        name: 'Emberwood',
        subtitle: 'Daybreak Glade',
        bg: '#16180e',
        groundFill: '#6f7a36',  // warm green-gold meadow
        groundFillAlpha: 0.34,
        grade: '#ffd27a',       // soft golden daylight wash
        gradeAlpha: 0.10,
        darkness: 0.52,         // DAY — bright, the veil barely closes in
        unlockBosses: 0,
        accent: '#ffd27a',
        weather: 'embers',      // warm drifting pollen/embers
        tier: 1,                // difficulty rung (1 = easiest); folds into boss + enemy scaling
        bosses: ['stormwingAlpha', 'vinebackGoliath', 'gloomMaw'],
        // Verdant swarm: gels, snakes, and bees teem in the glade; splitters
        // are its signature trick.
        enemyMix: { slime: 1.35, crawler: 1.3, mite: 1.25, splitter: 1.4, brute: 1.15 },
        hazard: 'brambles',     // thorn patches — tick damage + a snag-slow
    },
    hollowreach: {
        id: 'hollowreach',
        name: 'Hollow Reach',
        subtitle: 'The Frozen Waste',
        bg: '#0e141c',
        groundFill: '#cdddf0',  // pale blue-white snowfield (lightens the ground)
        groundFillAlpha: 0.46,
        grade: '#7aa0d0',       // cold overcast
        gradeAlpha: 0.12,
        darkness: 0.72,         // SNOW — bright overcast, mid veil
        unlockBosses: 3,
        accent: '#bfe3ff',
        weather: 'snow',        // falling flecks
        tier: 2,
        bosses: ['hoarfang', 'rimewarden', 'aurorath'],
        // Frozen waste: hardy shelled heavies + wings that don't mind the
        // cold; blink-bats thrive, soft gels and bees thin out.
        enemyMix: { bat: 1.35, spitter: 1.3, shielder: 1.6, juggernaut: 1.4, zombie: 1.4, teleporter: 1.35, slime: 0.6, mite: 0.7 },
        hazard: 'iceSlick',     // slippery sheets — steering skids, no damage
    },
    crypts: {
        id: 'crypts',
        name: 'The Crypts',
        subtitle: 'The Sunless Night',
        bg: '#06060c',
        groundFill: '#16131f',  // near-black violet stone (darkens hard)
        groundFillAlpha: 0.52,
        grade: '#2e2a4a',       // cold sepulchral violet
        gradeAlpha: 0.30,
        darkness: 1.0,          // NIGHT — darkest; the veil presses in fully
        unlockBosses: 6,
        accent: '#b9a8e0',
        weather: 'snow',        // pale motes read as drifting crypt-dust
        tier: 3,
        bosses: ['mourndrift', 'ossuar', 'nihagault'],
        // Sunless night: bats + watching eyeballs + the risen dead; the
        // summoners' calls echo loudest here. Surface life thins hard.
        enemyMix: { bat: 1.6, spitter: 1.6, skeleton: 1.5, zombie: 1.5, summoner: 1.6, teleporter: 1.4, slime: 0.45, crawler: 0.7 },
        hazard: 'gloom',        // creeping dark — squeezes the player's light
    },
    dunes: {
        id: 'dunes',
        name: 'The Dunes',
        subtitle: 'Sunscorch Expanse',
        bg: '#1a1308',
        groundFill: '#c8a55c',  // warm tan sand (lightens to desert)
        groundFillAlpha: 0.50,
        grade: '#d8a648',       // ochre heat haze
        gradeAlpha: 0.12,
        darkness: 0.46,         // SANDY — bright scorching daylight
        unlockBosses: 9,
        accent: '#ffdf9a',
        weather: 'embers',      // shimmering heat / blown sand motes
        tier: 4,
        bosses: ['cindermaw', 'dunescourge', 'solnakh'],
        // Scorched expanse: snakes + burst predators rule the sand; bombers
        // dive out of the heat haze. Wet/cold creatures wither.
        enemyMix: { crawler: 1.7, charger: 1.6, speedDemon: 1.4, emberskeleton: 1.5, bomber: 1.5, brawler: 1.25, bat: 0.6, zombie: 0.6 },
        hazard: 'quicksand',    // dragging sand — a heavy wade-slow
    },
};

export const MAP_ORDER = ['emberwood', 'hollowreach', 'crypts', 'dunes'];
export const DEFAULT_MAP = 'emberwood';

export function getMap(id) {
    return MAPS[id] || MAPS[DEFAULT_MAP];
}

// The three bosses that must ALL be defeated to clear a map, in encounter
// order (3rd is that map's climax). Falls back to the default map's trio.
export function getMapBosses(id) {
    const m = MAPS[id] || MAPS[DEFAULT_MAP];
    return m.bosses || MAPS[DEFAULT_MAP].bosses;
}

// Difficulty rung of a map (1 = easiest). Later maps multiply boss/enemy
// scaling so each map plays a little harder than the last.
export function getMapTier(id) {
    const m = MAPS[id] || MAPS[DEFAULT_MAP];
    return m.tier || 1;
}

// A map is unlocked when lifetime boss kills meet its threshold.
export function isMapUnlocked(id, totalBosses) {
    const m = MAPS[id];
    if (!m) return false;
    return (totalBosses || 0) >= (m.unlockBosses || 0);
}
