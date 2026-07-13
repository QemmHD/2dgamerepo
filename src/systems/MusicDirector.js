// MusicDirector — pure combat-pressure model for AudioSystem's adaptive score.
//
// Keep this module free of Web Audio and Game imports: the Game supplies one
// already-consolidated threat snapshot per frame, this model smooths it and
// returns a stable scene/layer state. That makes the musical logic testable in
// Node and avoids adding another enemy scan at the 180-enemy cap.

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

export const MUSIC_SCENES = Object.freeze({
    CALM: 'calm',
    HUNT: 'hunt',
    SWARM: 'swarm',
    ONSLAUGHT: 'onslaught',
    BOSS: 'boss',
    BOSS_FINAL: 'bossFinal',
});

// Enter thresholds are intentionally higher than exit thresholds. Without
// this hysteresis a horde hovering around a boundary can toggle percussion and
// harmony every frame, which sounds like a broken mixer rather than direction.
export const MUSIC_THRESHOLDS = Object.freeze({
    huntEnter: 0.26,
    huntExit: 0.18,
    swarmEnter: 0.56,
    swarmExit: 0.44,
    onslaughtEnter: 0.82,
    onslaughtExit: 0.70,
});

export function combatPressure(metrics = {}) {
    const active = clamp01((metrics.activeEnemies || 0) / 90);
    const nearby = clamp01((metrics.nearbyEnemies || 0) / 28);
    const elites = clamp01((metrics.elites || 0) / 5);
    const projectiles = clamp01((metrics.hostileProjectiles || 0) / 72);
    const hazards = clamp01((metrics.hazards || 0) / 16);
    const wave = clamp01(metrics.wavePressure);

    // Proximity and hostile geometry matter more than the raw array length: a
    // hundred enemies off-screen are atmosphere, thirty in wand range are panic.
    let pressure = active * 0.20
        + nearby * 0.29
        + elites * 0.13
        + projectiles * 0.16
        + hazards * 0.12
        + wave * 0.10;

    if (metrics.bossActive) {
        const hp = clamp01(metrics.bossHpFraction == null ? 1 : metrics.bossHpFraction);
        const phaseLift = (metrics.bossPhase || 1) >= 2 ? 0.12 : 0;
        pressure = Math.max(pressure, 0.62 + (1 - hp) * 0.24 + phaseLift);
    }
    return clamp01(pressure);
}

export function sceneForPressure(previousScene, pressure, metrics = {}) {
    if (metrics.bossActive) {
        return (metrics.bossPhase || 1) >= 2 || (metrics.bossHpFraction ?? 1) <= 0.28
            ? MUSIC_SCENES.BOSS_FINAL
            : MUSIC_SCENES.BOSS;
    }

    const p = clamp01(pressure);
    switch (previousScene) {
        case MUSIC_SCENES.ONSLAUGHT:
            if (p >= MUSIC_THRESHOLDS.onslaughtExit) return MUSIC_SCENES.ONSLAUGHT;
            return p >= MUSIC_THRESHOLDS.swarmExit ? MUSIC_SCENES.SWARM
                : p >= MUSIC_THRESHOLDS.huntExit ? MUSIC_SCENES.HUNT : MUSIC_SCENES.CALM;
        case MUSIC_SCENES.SWARM:
            if (p >= MUSIC_THRESHOLDS.onslaughtEnter) return MUSIC_SCENES.ONSLAUGHT;
            if (p >= MUSIC_THRESHOLDS.swarmExit) return MUSIC_SCENES.SWARM;
            return p >= MUSIC_THRESHOLDS.huntExit ? MUSIC_SCENES.HUNT : MUSIC_SCENES.CALM;
        case MUSIC_SCENES.HUNT:
            if (p >= MUSIC_THRESHOLDS.onslaughtEnter) return MUSIC_SCENES.ONSLAUGHT;
            if (p >= MUSIC_THRESHOLDS.swarmEnter) return MUSIC_SCENES.SWARM;
            return p >= MUSIC_THRESHOLDS.huntExit ? MUSIC_SCENES.HUNT : MUSIC_SCENES.CALM;
        default:
            if (p >= MUSIC_THRESHOLDS.onslaughtEnter) return MUSIC_SCENES.ONSLAUGHT;
            if (p >= MUSIC_THRESHOLDS.swarmEnter) return MUSIC_SCENES.SWARM;
            if (p >= MUSIC_THRESHOLDS.huntEnter) return MUSIC_SCENES.HUNT;
            return MUSIC_SCENES.CALM;
    }
}

export function nextMusicState(previous = null, metrics = {}, dt = 1 / 60) {
    const prior = previous || { intensity: 0, scene: MUSIC_SCENES.CALM };
    const target = combatPressure(metrics);
    const current = clamp01(prior.intensity);
    // Fast rise catches a sudden surround/barrage; slower release gives the
    // musical phrase time to exhale after the floor clears.
    const tau = target > current ? 0.38 : 1.35;
    const step = Math.max(0, Math.min(0.25, Number(dt) || 0));
    const alpha = 1 - Math.exp(-step / tau);
    const intensity = current + (target - current) * alpha;
    const scene = sceneForPressure(prior.scene, intensity, metrics);
    const hpFraction = clamp01(metrics.playerHpFraction == null ? 1 : metrics.playerHpFraction);
    return {
        intensity,
        target,
        scene,
        lastStand: hpFraction > 0 && hpFraction < 0.25,
        bossActive: !!metrics.bossActive,
        bossPhase: metrics.bossPhase || 1,
    };
}
