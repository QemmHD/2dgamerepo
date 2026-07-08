// rites.js — the per-hero mastery quests (KINDLED update #3, PR5): 3 Rites per hero,
// progress ACCUMULATED across runs, keyed by hero id (append-only registry — update
// #10 adds heroes by data alone; nothing here hardcodes the count six).
//
// Each rite: { id, name, desc, metric, goal, mode }. `metric` names a field on the
// per-run stats object Game builds at run end; `mode` is 'lifetime' (progress +=
// metric each run) or 'record' (progress = max(progress, metric)). A rite is DONE
// when progress >= goal. The rite-gated Attunement rungs read ritesCompletedCount().
//
// metric keys (from the run-summary stats object):
//   time (s survived), kills, bosses, ults (released this run), comboProcs,
//   heal (HP healed this run), bestUltHits (max foes hit by one ult),
//   bestUltKills (max kills by one ult), brinkCasts (ults cast below 20% HP).

export const RITES = {
    monkey: [
        { id: 'wellspring', name: 'Rite of the Wellspring', desc: 'Mend 2,500 HP with sustained heals (lifetime).', metric: 'heal', goal: 2500, mode: 'lifetime' },
        { id: 'nova', name: 'Rite of the Nova', desc: 'Catch 45 foes in a single Emberwake Nova.', metric: 'bestUltHits', goal: 45, mode: 'record' },
        { id: 'vigil', name: 'Rite of Vigil', desc: 'Survive 18:00 in one run.', metric: 'time', goal: 1080, mode: 'record' },
    ],
    elf: [
        { id: 'gale', name: 'Rite of the Gale', desc: 'Release 40 Grand Signatures (lifetime).', metric: 'ults', goal: 40, mode: 'lifetime' },
        { id: 'plenty', name: 'Rite of Plenty', desc: 'Slay 4,000 foes (lifetime).', metric: 'kills', goal: 4000, mode: 'lifetime' },
        { id: 'zephyr', name: 'Rite of the Zephyr', desc: 'Survive 15:00 in one run.', metric: 'time', goal: 900, mode: 'record' },
    ],
    orc: [
        { id: 'bulwark', name: 'Rite of the Bulwark', desc: 'Release 35 Grand Signatures (lifetime).', metric: 'ults', goal: 35, mode: 'lifetime' },
        { id: 'wall', name: 'Rite of the Wall', desc: 'Survive 20:00 in one run.', metric: 'time', goal: 1200, mode: 'record' },
        { id: 'unbroken', name: 'Rite of the Unbroken', desc: 'Fell 12 bosses (lifetime).', metric: 'bosses', goal: 12, mode: 'lifetime' },
    ],
    wizard: [
        { id: 'cataclysm', name: 'Rite of Cataclysm', desc: 'Trigger 120 element combos (lifetime).', metric: 'comboProcs', goal: 120, mode: 'lifetime' },
        { id: 'twin', name: 'Rite of the Twin', desc: 'Catch 40 foes in a single Twin Cataclysm.', metric: 'bestUltHits', goal: 40, mode: 'record' },
        { id: 'embermind', name: 'Rite of the Embermind', desc: 'Release 45 Grand Signatures (lifetime).', metric: 'ults', goal: 45, mode: 'lifetime' },
    ],
    berserker: [
        { id: 'brink', name: 'Rite of the Brink', desc: 'Release Pyre of the Brink below 20% HP ×10 (lifetime).', metric: 'brinkCasts', goal: 10, mode: 'lifetime' },
        { id: 'ember', name: 'Rite of the Ember', desc: 'Slay 3,500 foes (lifetime).', metric: 'kills', goal: 3500, mode: 'lifetime' },
        { id: 'lastlight', name: 'Rite of Last Light', desc: 'Survive 16:00 in one run.', metric: 'time', goal: 960, mode: 'record' },
    ],
    assassin: [
        { id: 'mark', name: 'Rite of the Mark', desc: 'Slay 6 marks with a single Deathmark.', metric: 'bestUltKills', goal: 6, mode: 'record' },
        { id: 'blade', name: 'Rite of the Blade', desc: 'Fell 10 bosses (lifetime).', metric: 'bosses', goal: 10, mode: 'lifetime' },
        { id: 'shadows', name: 'Rite of Shadows', desc: 'Release 50 Grand Signatures (lifetime).', metric: 'ults', goal: 50, mode: 'lifetime' },
    ],
};

// Resolve a hero's rite list (empty array for an unknown id — never throws).
export function ritesFor(heroId) { return RITES[heroId] || []; }

// The set of known rite ids for a hero (validation gate for the save loader).
export function riteIdsFor(heroId) { return ritesFor(heroId).map((r) => r.id); }

// Progress int stored in save.rites[heroId][riteId] (0 when absent).
export function riteProgress(save, heroId, riteId) {
    const m = save && save.rites && save.rites[heroId];
    return (m && Number.isFinite(m[riteId])) ? m[riteId] : 0;
}

// A rite is complete when its stored progress reaches its goal.
export function riteDone(save, heroId, rite) {
    return riteProgress(save, heroId, rite.id) >= rite.goal;
}

// How many of a hero's rites are complete (drives Attunement rung gating).
export function ritesCompletedCount(save, heroId) {
    return ritesFor(heroId).reduce((n, r) => n + (riteDone(save, heroId, r) ? 1 : 0), 0);
}

// Accumulate one run's contribution into a hero's rite-progress map, returning the
// NEW map + which rites newly completed this run. Pure: the caller persists the map.
// runStats: { time, kills, bosses, ults, comboProcs, heal, bestUltHits, bestUltKills, brinkCasts }.
export function accrueRites(prevMap, heroId, runStats) {
    const out = { ...(prevMap || {}) };
    const newlyDone = [];
    for (const r of ritesFor(heroId)) {
        const cur = Number.isFinite(out[r.id]) ? out[r.id] : 0;
        const m = Math.max(0, Math.floor((runStats && runStats[r.metric]) || 0));
        const next = r.mode === 'record' ? Math.max(cur, m) : cur + m;
        const wasDone = cur >= r.goal;
        out[r.id] = next;
        if (!wasDone && next >= r.goal) newlyDone.push(r);
    }
    return { map: out, newlyDone };
}
