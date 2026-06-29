// Lifetime achievement milestones — one-time, evaluated against save.stats at
// the end of each run. Each grants a coin reward on first completion (kept to
// coins so there's zero unlock-plumbing risk). Claimed ids persist in
// save.achievements.claimed (added to the v5 schema). `check` receives the
// stats object directly.

export const ACHIEVEMENTS = [
    { id: 'first_boss',   name: 'First Light',      desc: 'Defeat your first boss.',          coins: 50,  check: (s) => (s.totalBosses || 0) >= 1 },
    { id: 'hold_light',   name: 'Hold the Light',   desc: 'Defeat the 3rd boss in a run.',     coins: 120, check: (s) => (s.bestBosses || 0) >= 3 },
    { id: 'kills_1k',     name: 'Cullnight',        desc: 'Defeat 1,000 Hollow.',             coins: 100, check: (s) => (s.totalKills || 0) >= 1000 },
    { id: 'kills_10k',    name: 'Tide Breaker',     desc: 'Defeat 10,000 Hollow.',            coins: 350, check: (s) => (s.totalKills || 0) >= 10000 },
    { id: 'bosses_25',    name: 'Boss Hunter',      desc: 'Defeat 25 bosses.',                coins: 200, check: (s) => (s.totalBosses || 0) >= 25 },
    { id: 'level_30',     name: 'Ascendant',        desc: 'Reach level 30 in a single run.',  coins: 150, check: (s) => (s.bestLevel || 0) >= 30 },
    { id: 'survive_10',   name: 'Long Vigil',       desc: 'Survive 10 minutes in one run.',   coins: 150, check: (s) => (s.bestTime || 0) >= 600 },
    { id: 'runs_25',      name: 'Persistent',       desc: 'Play 25 runs.',                    coins: 100, check: (s) => (s.runs || 0) >= 25 },
    { id: 'coins_10k',    name: 'Cinder Hoard',     desc: 'Earn 10,000 coins lifetime.',      coins: 150, check: (s) => (s.totalCoinsEarned || 0) >= 10000 },
    { id: 'cases_25',     name: 'Curator',          desc: 'Open 25 cases.',                   coins: 100, check: (s) => (s.casesOpened || 0) >= 25 },
    { id: 'hard_win',     name: 'Nightmare Slain',  desc: 'Win a run on Nightmare difficulty.', coins: 400, check: (s) => (s.hardWins || 0) >= 1 },
    { id: 'gauntlet_3k',  name: 'Gauntlet Runner',  desc: 'Score 3,000+ in the Gauntlet.',    coins: 250, check: (s) => (s.bestGauntletScore || 0) >= 3000 },
    { id: 'gauntlet_8k',  name: 'Endless Warden',   desc: 'Score 8,000+ in the Gauntlet.',    coins: 500, check: (s) => (s.bestGauntletScore || 0) >= 8000 },
    { id: 'playtime_1h',  name: 'Devoted',          desc: 'Play for 1 hour total.',           coins: 150, check: (s) => (s.playtimeSec || 0) >= 3600 },
    { id: 'nightmare_10', name: 'Dread Reaper',     desc: 'Fell 10 bosses on Nightmare.',     coins: 350, check: (s) => (s.eliteBossesDefeated || 0) >= 10 },
    { id: 'wave_master',  name: 'Wavebreaker',      desc: 'Reach wave 6 in a run.',           coins: 120, check: (s) => (s.bestWave || 0) >= 6 },
];

// Returns the achievement objects newly earned (passed-but-unclaimed). The
// caller claims them + grants rewards. `save` is the SaveSystem instance.
export function evaluateAchievements(save) {
    const stats = (save && save.data && save.data.stats) || {};
    const out = [];
    for (const a of ACHIEVEMENTS) {
        if (save.isAchievementClaimed(a.id)) continue;
        if (a.check(stats)) out.push(a);
    }
    return out;
}
