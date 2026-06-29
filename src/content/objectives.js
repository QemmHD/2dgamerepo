// Run objectives — lightweight goals checked against live run metrics. Each
// completion pays a coin reward, fires a toast + sound, and counts toward the
// game-over summary. They're the "one more for the checkmark" retention hook;
// repeatable every run (the reward is small, the pull is the streak of ticks).
//
// metric is read from a stats bag the Game builds each frame:
//   { kills, timeSec, level, comboBest, bosses }
// An objective completes the first time its metric ≥ target (once per run).

export const OBJECTIVES = [
    { id: 'firstBlood',  name: 'First Blood',   metric: 'kills',     target: 1,   reward: 10,  desc: 'Defeat your first Hollow.' },
    { id: 'slayer',      name: 'Slayer',        metric: 'kills',     target: 100, reward: 40,  desc: 'Defeat 100 Hollow.' },
    { id: 'exterminator',name: 'Exterminator',  metric: 'kills',     target: 400, reward: 110, desc: 'Defeat 400 Hollow.' },
    { id: 'survivor',    name: 'Survivor',      metric: 'timeSec',   target: 300, reward: 60,  desc: 'Survive 5 minutes.' },
    { id: 'endurance',   name: 'Endurance',     metric: 'timeSec',   target: 600, reward: 130, desc: 'Survive 10 minutes.' },
    { id: 'leveled',     name: 'Ascending',     metric: 'level',     target: 10,  reward: 50,  desc: 'Reach level 10.' },
    { id: 'ascendant',   name: 'Ascendant',     metric: 'level',     target: 20,  reward: 120, desc: 'Reach level 20.' },
    { id: 'streaker',    name: 'On a Streak',   metric: 'comboBest', target: 50,  reward: 40,  desc: 'Hit a 50 kill streak.' },
    { id: 'unstoppable', name: 'Unstoppable',   metric: 'comboBest', target: 150, reward: 110, desc: 'Hit a 150 kill streak.' },
    { id: 'bossSlayer',  name: 'Boss Slayer',   metric: 'bosses',    target: 1,   reward: 90,  desc: 'Defeat a boss.' },
    { id: 'warlord',     name: 'Warlord',       metric: 'bosses',    target: 3,   reward: 220, desc: 'Defeat 3 bosses in one run.' },
];

export const OBJECTIVE_COUNT = OBJECTIVES.length;
