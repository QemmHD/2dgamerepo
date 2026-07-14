// Guided run-path content.
//
// A run presents exactly one objective at a time across three authored phases:
// Orientation -> Tactic -> Climax. RunObjectiveDirector filters these candidates
// against the current mode's real systems and remaining finite capacity before
// choosing deterministically. Every phase owns a time-based fallback, so a
// future/unknown mode can never strand the player with an impossible task.

export const RUN_OBJECTIVE_PHASES = Object.freeze([
    Object.freeze({ id: 'orientation', label: 'ORIENTATION', numeral: 'I', accent: '#7fd0ff' }),
    Object.freeze({ id: 'tactic', label: 'TACTIC', numeral: 'II', accent: '#ffd166' }),
    Object.freeze({ id: 'climax', label: 'CLIMAX', numeral: 'III', accent: '#ff7a5c' }),
]);

export const RUN_OBJECTIVE_MODE_IDS = Object.freeze([
    'standard',
    'daily',
    'rite-trial',
    'boss-rush',
    'weekly',
]);

// Coin-gain builds are captured when a task completes. Keep the upper policy
// bound beside the authored rewards so both the runtime director and the save
// settlement layer can independently reject a forged payout.
export const RUN_OBJECTIVE_MAX_REWARD_MULTIPLIER = 100;

const EXPLORATION_MODES = Object.freeze(['standard', 'daily', 'rite-trial']);
const GAUNTLET_MODES = Object.freeze(['boss-rush', 'weekly']);

function task(definition) {
    return Object.freeze({
        ...definition,
        modes: definition.modes === '*' ? '*' : Object.freeze([...definition.modes]),
        requires: Object.freeze([...(definition.requires || [])]),
        // Keep the legacy description field for Chronicle/tooling consumers.
        desc: definition.desc || definition.nextAction,
    });
}

export const RUN_OBJECTIVE_CANDIDATES = Object.freeze({
    orientation: Object.freeze([
        task({
            id: 'orient_first_light', name: 'Kindle a Waylight', metric: 'sites', target: 1,
            reward: 20, modes: EXPLORATION_MODES, requires: ['livingVigil'],
            nextAction: 'Enter a marked house and activate its Waylight.',
        }),
        task({
            id: 'orient_kindling', name: 'Gather the Kindling', metric: 'level', target: 1,
            reward: 18, modes: EXPLORATION_MODES,
            nextAction: 'Collect Ember Shards and gain one level.',
        }),
        task({
            id: 'orient_first_blood', name: 'Break the First Wave', metric: 'kills', target: 12,
            reward: 15, modes: EXPLORATION_MODES,
            nextAction: 'Stay mobile while your weapon defeats 12 Hollow.',
        }),
        task({
            id: 'orient_hold_fast', name: 'Find Your Footing', metric: 'timeSec', target: 30,
            reward: 15, modes: EXPLORATION_MODES,
            nextAction: 'Keep moving and survive for 30 seconds.',
        }),
        task({
            id: 'orient_gauntlet_read', name: 'Read the Arena', metric: 'timeSec', target: 20,
            reward: 18, modes: GAUNTLET_MODES,
            nextAction: 'Circle the arena and survive the opening 20 seconds.',
        }),
        task({
            id: 'orient_gauntlet_grow', name: 'Temper the Build', metric: 'level', target: 1,
            reward: 20, modes: GAUNTLET_MODES,
            nextAction: 'Gather shards and gain one level.',
        }),
        task({
            id: 'orient_safe_fallback', name: 'Find the Rhythm', metric: 'timeSec', target: 25,
            reward: 15, modes: '*', fallback: true,
            nextAction: 'Stay alive for 25 seconds.',
        }),
    ]),
    tactic: Object.freeze([
        task({
            id: 'tactic_break_ranks', name: 'Break Their Ranks', metric: 'encounters', target: 1,
            reward: 45, modes: EXPLORATION_MODES, requires: ['livingVigil'],
            nextAction: 'Answer a formation signal and clear its guardian pack.',
        }),
        task({
            id: 'tactic_second_light', name: 'Extend the Circuit', metric: 'sites', target: 1,
            reward: 38, modes: EXPLORATION_MODES, requires: ['livingVigil'],
            nextAction: 'Find another marked house and kindle its Waylight.',
        }),
        task({
            id: 'tactic_hunt', name: 'Take the Initiative', metric: 'kills', target: 60,
            reward: 40, modes: EXPLORATION_MODES,
            nextAction: 'Defeat 60 more Hollow without losing your route.',
        }),
        task({
            id: 'tactic_ascend', name: 'Shape the Build', metric: 'level', target: 2,
            reward: 45, modes: EXPLORATION_MODES,
            nextAction: 'Collect shards and gain two more levels.',
        }),
        task({
            id: 'tactic_hold', name: 'Hold the Line', metric: 'timeSec', target: 75,
            reward: 40, modes: EXPLORATION_MODES,
            nextAction: 'Survive another 75 seconds as the pressure rises.',
        }),
        task({
            id: 'tactic_apex', name: 'Answer the Apex', metric: 'bosses', target: 1,
            reward: 80, modes: GAUNTLET_MODES, requires: ['bosses'],
            nextAction: 'Read the telegraphs and defeat the next apex boss.',
        }),
        task({
            id: 'tactic_gauntlet_grow', name: 'Sharpen the Build', metric: 'level', target: 2,
            reward: 55, modes: GAUNTLET_MODES,
            nextAction: 'Gather shards and gain two more levels.',
        }),
        task({
            id: 'tactic_gauntlet_hold', name: 'Keep Your Composure', metric: 'timeSec', target: 75,
            reward: 50, modes: GAUNTLET_MODES,
            nextAction: 'Survive 75 more seconds between apex attacks.',
        }),
        task({
            id: 'tactic_safe_fallback', name: 'Keep the Vigil', metric: 'timeSec', target: 70,
            reward: 40, modes: '*', fallback: true,
            nextAction: 'Stay alive for another 70 seconds.',
        }),
    ]),
    climax: Object.freeze([
        task({
            id: 'climax_boss', name: 'Sever the Crown', metric: 'bosses', target: 1,
            reward: 100, modes: EXPLORATION_MODES, requires: ['bosses'],
            nextAction: 'Survive the warning and defeat the next map boss.',
        }),
        task({
            id: 'climax_hunt', name: 'Turn Back the Dark', metric: 'kills', target: 150,
            reward: 90, modes: EXPLORATION_MODES,
            nextAction: 'Defeat 150 more Hollow and keep the field under control.',
        }),
        task({
            id: 'climax_ascend', name: 'Complete the Engine', metric: 'level', target: 4,
            reward: 90, modes: EXPLORATION_MODES,
            nextAction: 'Gather shards and gain four more levels.',
        }),
        task({
            id: 'climax_pack', name: 'Shatter the Formation', metric: 'encounters', target: 1,
            reward: 95, modes: EXPLORATION_MODES, requires: ['livingVigil'],
            nextAction: 'Clear one more authored guardian formation.',
        }),
        task({
            id: 'climax_waylights', name: 'Bind the Waylights', metric: 'siteKinds', target: 2,
            reward: 90, modes: EXPLORATION_MODES, requires: ['livingVigil'],
            nextAction: 'Kindle two new kinds of Waylight inside marked houses.',
        }),
        task({
            id: 'climax_endure', name: 'Outlast the Surge', metric: 'timeSec', target: 180,
            reward: 85, modes: EXPLORATION_MODES,
            nextAction: 'Survive 180 more seconds as the swarm rises.',
        }),
        task({
            id: 'climax_apex_chain', name: 'Break the Apex Chain', metric: 'bosses', target: 2,
            reward: 180, modes: GAUNTLET_MODES, requires: ['bosses'],
            nextAction: 'Defeat the next two apex bosses.',
        }),
        task({
            id: 'climax_gauntlet_endure', name: 'Endure the Crucible', metric: 'timeSec', target: 150,
            reward: 110, modes: GAUNTLET_MODES,
            nextAction: 'Survive 150 more seconds in the gauntlet.',
        }),
        task({
            id: 'climax_gauntlet_grow', name: 'Perfect the Build', metric: 'level', target: 4,
            reward: 120, modes: GAUNTLET_MODES,
            nextAction: 'Gather shards and gain four more levels.',
        }),
        task({
            id: 'climax_safe_fallback', name: 'Carry the Last Light', metric: 'timeSec', target: 150,
            reward: 90, modes: '*', fallback: true,
            nextAction: 'Stay alive for 150 more seconds.',
        }),
    ]),
});

// Compatibility catalog for Chronicle/tools that inspect authored tasks. The
// live game never activates this flat list simultaneously.
export const OBJECTIVES = Object.freeze(
    RUN_OBJECTIVE_PHASES.flatMap((phase) => RUN_OBJECTIVE_CANDIDATES[phase.id]),
);

export const OBJECTIVE_COUNT = RUN_OBJECTIVE_PHASES.length;
