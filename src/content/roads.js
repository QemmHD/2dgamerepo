// Branching Roads — the Wick Roads' post-boss fork. When a boss falls (except the
// run-ending 3rd), the player is frozen for a CROSSROADS pick-one of three roads
// (drawn from this pool — see rollRoadChoices in WickRoadsSystem).
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
    {
        id: 'teeming',
        name: 'The Teeming Road',
        rarity: 'uncommon',
        tintAccent: '#a8e063',
        description: 'The Hollow SWARMS — far more bodies, but frailer. Feast on them: +12% XP for the run.',
        apply(game) {
            // Swarm bias: frail bodies flood in (cap rides the ≤220 waveState
            // clamp; hp/elite drop so it's volume, not a stat wall).
            game.segmentScale = { hp: 0.85, speed: 1, damage: 1, elite: 0.85, cap: 1.3, interval: 0.8 };
            game.segmentWeights = { mite: 40, bat: 30, crawler: 30, slime: 24 };
            if (game.player) game.player.xpMultiplier = (game.player.xpMultiplier ?? 1) * 1.12;
            retint(game, '#3d5a24', 0.16, '#a8e063');
        },
    },
    {
        id: 'hunted',
        name: 'The Hunted Road',
        rarity: 'rare',
        tintAccent: '#ff6a7a',
        description: 'The elite Hollow HUNT you — more elites, quicker on the chase. Their spoils: better chest luck.',
        apply(game) {
            game.segmentScale = { hp: 1, speed: 1.08, damage: 1, elite: 1.35, cap: 1, interval: 1 };
            game.segmentWeights = { speedDemon: 30, skeleton: 26, charger: 24 };
            // Chest luck shifts elite/boss chest rolls toward upgrades (same
            // field Pact of Avarice buffs; read by ChestRewards).
            if (game.player) game.player.chestLuck = (game.player.chestLuck ?? 0) + 0.12;
            retint(game, '#5a2430', 0.18, '#ff6a7a');
        },
    },
    // ── Armory pt. 1 archetypes (v1.3, P2.6): six more forks so the pool ──
    // outgrows one CROSSROADS draw and runs stop seeing the same three roads.
    // Same discipline as above: multipliers ≤ ~1.4, boons modest + clamped.
    {
        id: 'stormlash',
        name: 'The Storm-Lashed Road',
        rarity: 'rare',
        tintAccent: '#9fd8ff',
        description: 'Wind-driven husks come FASTER and hit HARDER. Ride the gale: -8% weapon cooldowns.',
        apply(game) {
            game.segmentScale = { hp: 1, speed: 1.15, damage: 1.2, elite: 1, cap: 1, interval: 1 };
            game.segmentWeights = { speedDemon: 34, bat: 28, charger: 22 };
            // cooldownMul rides the CAPS.cooldownMulFloor frame-clamp.
            if (game.player) game.player.cooldownMul = (game.player.cooldownMul ?? 1) * 0.92;
            retint(game, '#3a5a78', 0.17, '#9fd8ff');
        },
    },
    {
        id: 'barrow',
        name: 'The Barrow Road',
        rarity: 'uncommon',
        tintAccent: '#cfd8b0',
        description: 'The dead walk it — shambling, TOUGH, and many-boned. Grave-warmth: +20 max HP now.',
        apply(game) {
            game.segmentScale = { hp: 1.15, speed: 0.95, damage: 1, elite: 1.1, cap: 1, interval: 1 };
            game.segmentWeights = { skeleton: 40, zombie: 30, emberskeleton: 18 };
            if (game.player) {
                game.player.maxHp += 20;
                game.player.hp = Math.min(game.player.maxHp, game.player.hp + 20);
            }
            retint(game, '#3a4030', 0.18, '#cfd8b0');
        },
    },
    {
        id: 'smoulder',
        name: 'The Smouldering Road',
        rarity: 'rare',
        tintAccent: '#ffb060',
        description: 'Ash-fed husks burn MEANER — tougher, fiercer, more elites. Steal their heat: +18% burn damage.',
        apply(game) {
            game.segmentScale = { hp: 1.1, speed: 1, damage: 1.15, elite: 1.15, cap: 1, interval: 1 };
            game.segmentWeights = { emberskeleton: 34, spitter: 26, brawler: 22 };
            // burnDamageMul is read at the single burn-tick hook — bounded there.
            if (game.player) game.player.burnDamageMul = (game.player.burnDamageMul ?? 1) * 1.18;
            retint(game, '#6a3418', 0.18, '#ffb060');
        },
    },
    {
        id: 'howling',
        name: 'The Howling Road',
        rarity: 'uncommon',
        tintAccent: '#bfe8ff',
        description: 'The sky EMPTIES onto you — swift, frail wings in great numbers. Run with them: +6% move speed.',
        apply(game) {
            // Volume + speed, paid for with frailty (hp down) — the anti-Barrow.
            game.segmentScale = { hp: 0.9, speed: 1.18, damage: 1, elite: 1, cap: 1.15, interval: 0.9 };
            game.segmentWeights = { bat: 44, speedDemon: 26, mite: 26 };
            // speed rides the CAPS.moveSpeed frame-clamp.
            if (game.player) game.player.speed = (game.player.speed ?? 0) * 1.06;
            retint(game, '#48607a', 0.16, '#bfe8ff');
        },
    },
    {
        id: 'gilded',
        name: 'The Gilded Road',
        rarity: 'epic',
        tintAccent: '#ffd166',
        description: 'Treasure-fat brutes bar the way — TANKY, fierce, elite-thick. Their hoard: +14% coins for the run.',
        apply(game) {
            game.segmentScale = { hp: 1.2, speed: 1, damage: 1.1, elite: 1.3, cap: 1, interval: 1 };
            game.segmentWeights = { brute: 30, juggernaut: 14, shielder: 12 };
            if (game.player) game.player.coinMul = (game.player.coinMul ?? 1) * 1.14;
            retint(game, '#6a5218', 0.17, '#ffd166');
        },
    },
    {
        id: 'veiled',
        name: 'The Veiled Road',
        rarity: 'rare',
        tintAccent: '#8f9fd0',
        description: 'FEWER husks stalk the mist — but each hits far harder. Sharpen in the gloom: +5% crit chance.',
        apply(game) {
            // The duelist's road: thin spawns, heavy hits — burst counts.
            game.segmentScale = { hp: 1, speed: 1.1, damage: 1.25, elite: 1, cap: 0.85, interval: 1.05 };
            game.segmentWeights = { crawler: 34, speedDemon: 26, brawler: 22 };
            // Same 0.8 crit ceiling every other crit source respects.
            if (game.player) game.player.critChance = Math.min(0.8, (game.player.critChance ?? 0) + 0.05);
            retint(game, '#3c4260', 0.20, '#8f9fd0');
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
