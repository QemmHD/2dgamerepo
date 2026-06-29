// Playable maps / biomes. The world geometry is shared (same procedural
// obstacle + decoration layout), but each map applies a distinct COLOR GRADE +
// background so it reads as a different place. A grade is a translucent tint
// multiplied over the ground (MapRenderer.drawBackground), which is cheap and
// needs no new sprite art. `unlockBosses` gates a map behind lifetime boss
// kills — the second biome opens after clearing 3 bosses on the first map.

export const MAPS = {
    emberwood: {
        id: 'emberwood',
        name: 'Emberwood',
        subtitle: 'The Last Vigil',
        bg: '#0c1410',
        grade: null,            // default warm dusk — no extra grade
        gradeAlpha: 0,
        unlockBosses: 0,
        accent: '#ffb24a',
        weather: 'embers',      // warm motes drifting upward
    },
    hollowreach: {
        id: 'hollowreach',
        name: 'Hollow Reach',
        subtitle: 'The Frozen Vigil',
        bg: '#0a0f18',
        grade: '#5a86c8',       // cold blue grade for a frozen biome
        gradeAlpha: 0.26,
        unlockBosses: 3,        // unlocked after 3 lifetime boss kills
        accent: '#7fd0ff',
        weather: 'snow',        // cool flecks falling
    },
};

export const MAP_ORDER = ['emberwood', 'hollowreach'];
export const DEFAULT_MAP = 'emberwood';

export function getMap(id) {
    return MAPS[id] || MAPS[DEFAULT_MAP];
}

// A map is unlocked when lifetime boss kills meet its threshold.
export function isMapUnlocked(id, totalBosses) {
    const m = MAPS[id];
    if (!m) return false;
    return (totalBosses || 0) >= (m.unlockBosses || 0);
}
