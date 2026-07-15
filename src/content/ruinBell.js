// Ruin Bell - authored encounter contract for the House V2 vertical slice.
//
// This file is data only. RuinBellDirector owns clocks and lifecycle state;
// Game remains authoritative for Enemy construction, rewards, audio, and UI.
// Stable member keys deliberately survive the single retry so a defeated body
// can never be spawned (or rewarded) twice in the same run.

import { EMBERWOOD_RUIN_BELL_CABIN } from './houseBlueprints.js';

const deepFreeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
};

const unit = (id, type, role, options = {}) => ({
    id,
    type,
    role,
    entryDoorId: options.entryDoorId || null,
    routeRoomIds: options.routeRoomIds || [],
    combatSocket: options.combatSocket || null,
    chargeLane: options.chargeLane || null,
});

export const RUIN_BELL_PHASES = Object.freeze([
    'locked',
    'dormant',
    'arming',
    'warning',
    'active',
    'technical-defer',
    'retry-cooldown',
    'cleared',
    'spent',
]);

// Non-colour role marks are part of the contract. Renderers may add colour,
// but the short label/symbol must remain sufficient in High Contrast and
// Reduced Effects modes.
export const RUIN_BELL_ROLES = deepFreeze({
    'door-runner': {
        id: 'door-runner', label: 'DOOR', symbol: 'D', accent: '#ffd166',
    },
    threshold: {
        id: 'threshold', label: 'HOLD', symbol: 'H', accent: '#ff9b54',
    },
    marksman: {
        id: 'marksman', label: 'SHOT', symbol: 'S', accent: '#7fd0ff',
    },
    support: {
        id: 'support', label: 'AID', symbol: '+', accent: '#8fe39b',
    },
    charger: {
        id: 'charger', label: 'CHARGE', symbol: 'C', accent: '#ff6a78',
    },
    bomber: {
        id: 'bomber', label: 'BLAST', symbol: 'B', accent: '#d8a0ff',
    },
});

export const RUIN_BELL_LIMITS = deepFreeze({
    unlockWaveIndex: 3,
    dwellSeconds: EMBERWOOD_RUIN_BELL_CABIN.encounter.dwellSeconds,
    activationRadius: EMBERWOOD_RUIN_BELL_CABIN.encounter.activationRadius,
    defendRadius: EMBERWOOD_RUIN_BELL_CABIN.encounter.defendRadius,
    graceOutsideSeconds: EMBERWOOD_RUIN_BELL_CABIN.encounter.graceOutsideSeconds,
    earliestClearSeconds: EMBERWOOD_RUIN_BELL_CABIN.encounter.defendSeconds,
    timeoutSeconds: 60,
    retryCooldownSeconds: EMBERWOOD_RUIN_BELL_CABIN.encounter.retryDelaySeconds,
    maxAttempts: 2,
    maxMembers: 11,
    maxEventsPerUpdate: 8,
    maxQueuedAcks: 4,
    maxTraceEntries: 96,
    spawnAcknowledgeSeconds: 2,
});

export const RUIN_BELL_STAGES = deepFreeze([
    {
        id: 'door-runners',
        name: 'Door Runners',
        atSeconds: 3.5,
        telegraphLeadSeconds: 3.5,
        warning: 'North and south doors are under attack.',
        caption: 'North and south door attack',
        accent: '#ffd166',
        units: [
            unit('north-runner', 'crawler', 'door-runner', {
                entryDoorId: 'north-utility',
                routeRoomIds: ['hearth-kitchen', 'wick-hall'],
            }),
            unit('south-runner', 'crawler', 'door-runner', {
                entryDoorId: 'south-entry',
                routeRoomIds: ['dining-work', 'wick-hall'],
            }),
            unit('south-threshold', 'brawler', 'threshold', {
                entryDoorId: 'south-entry',
                routeRoomIds: ['dining-work'],
                combatSocket: { roomId: 'dining-work', x: -110, y: 176 },
            }),
        ],
    },
    {
        id: 'window-crossfire',
        name: 'Window Crossfire',
        atSeconds: 17,
        telegraphLeadSeconds: 3,
        warning: 'A marksman and keeper are taking the north sightline.',
        caption: 'Crossfire at the north sightline',
        accent: '#7fd0ff',
        units: [
            unit('north-marksman', 'spitter', 'marksman', {
                entryDoorId: 'north-utility',
                routeRoomIds: ['hearth-kitchen'],
                combatSocket: { roomId: 'hearth-kitchen', x: -108, y: -174 },
            }),
            unit('north-keeper', 'healer', 'support', {
                entryDoorId: 'north-utility',
                routeRoomIds: ['hearth-kitchen'],
                combatSocket: { roomId: 'hearth-kitchen', x: -198, y: -154 },
            }),
            unit('south-cross-runner', 'crawler', 'door-runner', {
                entryDoorId: 'south-entry',
                routeRoomIds: ['dining-work', 'wick-hall'],
            }),
            unit('south-cross-runner-two', 'crawler', 'door-runner', {
                entryDoorId: 'south-entry',
                routeRoomIds: ['dining-work', 'storage-lean-to'],
            }),
        ],
    },
    {
        id: 'last-breach',
        name: 'Last Breach',
        atSeconds: 33,
        telegraphLeadSeconds: 3,
        warning: 'The final breach is charging the south approach.',
        caption: 'Final breach',
        accent: '#ff6a78',
        units: [
            unit('south-charger', 'charger', 'charger', {
                entryDoorId: 'south-entry',
                routeRoomIds: ['dining-work', 'wick-hall'],
                chargeLane: {
                    from: { x: -110, y: 430 },
                    through: { x: -110, y: 270 },
                    to: { x: -110, y: 148 },
                    clearance: 66,
                },
            }),
            unit('north-bomber', 'bomber', 'bomber', {
                entryDoorId: 'north-utility',
                routeRoomIds: ['hearth-kitchen', 'wick-hall'],
            }),
            unit('south-brawler', 'brawler', 'threshold', {
                entryDoorId: 'south-entry',
                routeRoomIds: ['dining-work'],
                combatSocket: { roomId: 'dining-work', x: -188, y: 142 },
            }),
            unit('north-brawler', 'brawler', 'threshold', {
                entryDoorId: 'north-utility',
                routeRoomIds: ['hearth-kitchen'],
                combatSocket: { roomId: 'hearth-kitchen', x: -34, y: -138 },
            }),
        ],
    },
]);

export const RUIN_BELL_CONTRACT = deepFreeze({
    id: 'ruin-bell-vigil',
    version: 1,
    name: 'Ruin Bell',
    biomeId: 'emberwood',
    blueprintId: EMBERWOOD_RUIN_BELL_CABIN.id,
    anchorFurnitureId: EMBERWOOD_RUIN_BELL_CABIN.encounter.anchorFurnitureId,
    limits: RUIN_BELL_LIMITS,
    roles: RUIN_BELL_ROLES,
    stages: RUIN_BELL_STAGES,
    reward: {
        xp: EMBERWOOD_RUIN_BELL_CABIN.encounter.reward.xp,
        choice: EMBERWOOD_RUIN_BELL_CABIN.encounter.reward.choice,
        label: '32 XP + CHEST OR WICK SHRINE',
        receipt: 'RUIN BELL HELD \u00b7 +32 XP \u00b7 CHOOSE CHEST OR WICK SHRINE',
    },
    copy: {
        locked: 'The Ruin Bell wakes after Vigil 3.',
        available: 'Hold position by the bell to ring it.',
        arming: 'Hold position - ringing the Ruin Bell.',
        warning: 'First Toll - brace both doors.',
        active: 'Defeat every bellbound attacker.',
        allDefeatedEarly: 'Hold the cabin until the bell seals.',
        returnToCabin: 'Return to the cabin before the Ruin Bell breaks.',
        defenseRestored: 'Cabin defense restored.',
        technicalDefer: 'The toll is held while the approach clears.',
        retryCooldown: 'The damaged bell is relighting.',
        retryReady: 'Ring again - final attempt.',
        cleared: 'Choose the Chest or Wick Shrine.',
        claimed: 'Reward claimed. The Ruin Bell burns bright.',
        spent: 'The Ruin Bell is silent for this run.',
        failedReceipt: 'RUIN BELL FAILED \u00b7 NO COMPLETION REWARD',
    },
});

export function getRuinBellStage(id) {
    return RUIN_BELL_STAGES.find((stage) => stage.id === id) || null;
}

export function ruinBellMemberId(instanceId, stageId, unitId) {
    return `${String(instanceId)}:${String(stageId)}:${String(unitId)}`;
}

export function ruinBellMemberCount() {
    return RUIN_BELL_STAGES.reduce((sum, stage) => sum + stage.units.length, 0);
}
