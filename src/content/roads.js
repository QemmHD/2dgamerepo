// Branching Roads — the Wick Roads' post-boss fork. When a boss falls (except the
// run-ending 3rd), the player is frozen for a CROSSROADS pick-one of three roads.
// A road is a SEGMENT-scoped risk/reward choice: it biases the stretch UNTIL the
// next boss (enemy mix + difficulty multipliers, folded into waveState by
// Game._applyRunScale and cleared at the next boss via Game._clearSegmentRoad) and
// grants one small PERMANENT boon (a modest player-field nudge, exactly like a pact
// boon). The boons stay tame: damage (Ashen) rides the CAPS.damageMul ceiling in
// _applyPlayerCaps, regen (Rime) is clamped at use by the sustained-heal cap, and
// coins (Ember) are economy-only — none is a power runaway even stacked in endless.
//
// Each apply(game):
//   • game.segmentScale   — a FRESH { hp,speed,damage,elite,cap,interval } object
//                           (all default 1) multiplied into waveState each frame.
//   • game.segmentWeights — a FRESH enemy-id→weight map merged onto the wave's
//                           typeWeights (or null for "no mix change").
//   • one player boon      — permanent, modest, bounded.
//   • a map re-tint         — spreads onto a NEW mapRenderer.theme object (never
//                             mutates the shared MAPS entry); reverted at next boss.
// All multipliers stay ≤ ~1.4 and ride the existing waveState clamps
// (eliteChance ≤ 0.85, maxAlive ≤ 220), so a road can never runaway.

export const ROADS = [
    {
        id: 'ember',
        name: 'The Kindled Road',
        rarity: 'rare',
        tintAccent: '#ff8a3a',
        description: 'Enemies come FASTER and fiercer, more elites. The wick pays: +8% coins for the run.',
        apply(game) {
            game.segmentScale = { hp: 1, speed: 1.12, damage: 1, elite: 1.25, cap: 1, interval: 0.85 };
            game.segmentWeights = { charger: 40, speedDemon: 34, emberskeleton: 30 };
            if (game.player) game.player.coinMul = (game.player.coinMul ?? 1) * 1.08;
            retint(game, '#ff5a24', 0.17, '#ff8a3a');
        },
    },
    {
        id: 'rime',
        name: 'The Still Road',
        rarity: 'uncommon',
        tintAccent: '#7fd0ff',
        description: 'The cold stills the horde — SLOWER, fewer, calmer. Catch your breath: +0.6 HP/sec regen.',
        apply(game) {
            game.segmentScale = { hp: 1, speed: 0.85, damage: 1, elite: 0.7, cap: 1, interval: 1.12 };
            game.segmentWeights = null;   // no mix bias — the breather road
            if (game.player) game.player.regenPerSecond = (game.player.regenPerSecond ?? 0) + 0.6;
            retint(game, '#5a8ad0', 0.16, '#7fd0ff');
        },
    },
    {
        id: 'ashen',
        name: 'The Ruinous Road',
        rarity: 'epic',
        tintAccent: '#c9a8ff',
        description: 'Ash-choked and TANKY — the hardest road, thick with brutes. Hardens you: +6% damage and a heal.',
        apply(game) {
            game.segmentScale = { hp: 1.25, speed: 1, damage: 1, elite: 1.4, cap: 1, interval: 1 };
            game.segmentWeights = { brute: 34, juggernaut: 16, dreadhulk: 10 };
            if (game.player) {
                game.player.damageMul = (game.player.damageMul ?? 1) * 1.06;
                game.player.hp = Math.min(game.player.maxHp, game.player.hp + game.player.maxHp * 0.2);
            }
            retint(game, '#463a5a', 0.22, '#c9a8ff');
        },
    },
];

// Re-tint the world's mood grade for road flavor WITHOUT regenerating the world:
// spread onto a NEW theme object (mapRenderer reads theme fresh each frame; the
// shared MAPS entry / _baseBiomeTheme is never mutated). Reverted in
// Game._clearSegmentRoad at the next boss. Guarded so headless/partial-init is safe.
function retint(game, grade, gradeAlpha, accent) {
    const base = game._baseBiomeTheme;
    if (!base || !game.mapRenderer) return;
    game.mapRenderer.theme = { ...base, grade, gradeAlpha, accent };
}

const ROAD_BY_ID = Object.fromEntries(ROADS.map((r) => [r.id, r]));

export function getRoad(id) {
    return ROAD_BY_ID[id] ?? null;
}
