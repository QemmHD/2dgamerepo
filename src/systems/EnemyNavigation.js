// Local obstacle navigation for enemies.
//
// This is deliberately not a global pathfinder: the procedural world is open,
// obstacles are sparse, and as many as 180 enemies can be alive. A short
// swept-circle probe plus a stateful wall-following side gives each moving
// enemy enough memory to round houses/props without an A* allocation per body.

const TURN_ANGLES = [0.36, 0.7, 1.05, 1.4, Math.PI / 2, 1.9, 2.28, 2.68];
const WALL_FOLLOW_HOLD = 1.15;
const STUCK_RECOVERY_SECONDS = 0.72;
const RECOVERY_HOLD_SECONDS = 0.46;

export function enemyNavigationRole(enemy) {
    if (!enemy) return 'frontline';
    if ((enemy.radius || 0) >= 70 || enemy.boss || enemy.type === 'dreadhulk'
        || enemy.type === 'juggernaut') return 'siege';
    if (enemy.behavior === 'support') return 'support';
    if (enemy.behavior === 'spitter' || enemy.behavior === 'summoner') return 'ranged';
    if (enemy.behavior === 'charger' || enemy.behavior === 'bomber'
        || enemy.behavior === 'teleporter' || enemy.type === 'speedDemon') return 'flanker';
    return 'frontline';
}

// Writes a unit movement heading to enemy._navMoveX/Y. Navigation state is
// stored on the enemy so a body keeps the same side of a wall instead of
// choosing left/right afresh each frame and shivering in place.
//
// Returns true when obstacle avoidance changed (or confirmed) the heading.
// The caller can otherwise retain its original behavior vector.
export function steerEnemyMovement(enemy, dx, dy, speed, obstacles, dt, targetX = NaN, targetY = NaN) {
    const role = enemyNavigationRole(enemy);
    if (Number.isFinite(targetX) && Number.isFinite(targetY)
        && obstacles?.applyHouseNavigationGoal?.(enemy, targetX, targetY, role)) {
        dx = enemy._houseNavX - enemy.x;
        dy = enemy._houseNavY - enemy.y;
        enemy._navReason = enemy._houseNavReason;
    }
    const len = Math.hypot(dx, dy);
    if (!obstacles || len < 1e-6) return false;

    const nx = dx / len, ny = dy / len;
    const radius = Math.max(1, enemy.radius || 1);
    // Keep the planning hull slightly inside the physical hit circle. The
    // collision resolver owns the final few pixels; this tolerance lets a
    // tangent heading slide along a wall instead of treating contact as a new
    // collision forever.
    const clearance = Math.max(1, radius * 0.92);
    const look = Math.min(230, Math.max(radius + 72, radius + 42 + Math.max(0, speed) * 0.2));
    const hold = Math.max(0, (enemy._navHold || 0) - Math.max(0, dt || 0));
    enemy._navHold = hold;

    const lastX = Number.isFinite(enemy._navLastX) ? enemy._navLastX : enemy.x;
    const lastY = Number.isFinite(enemy._navLastY) ? enemy._navLastY : enemy.y;
    const moved = Math.hypot(enemy.x - lastX, enemy.y - lastY);
    enemy._navLastX = enemy.x;
    enemy._navLastY = enemy.y;

    const directBlocked = obstacles.movementBlocked(
        enemy.x, enemy.y,
        enemy.x + nx * look, enemy.y + ny * look,
        clearance,
    );

    if (directBlocked && moved < 0.35) {
        enemy._navStuckTime = Math.min(2, (enemy._navStuckTime || 0) + Math.max(0, dt || 0));
    } else {
        enemy._navStuckTime = Math.max(0, (enemy._navStuckTime || 0) - Math.max(0, dt || 0) * 2);
    }

    // Bounded, deterministic recovery: no teleport and no global search. A
    // stalled body probes eight headings once, latches one for <0.5s, and then
    // returns to the normal portal/wall-follow contract.
    if (enemy._navStuckTime >= STUCK_RECOVERY_SECONDS) {
        const serial = ((enemy._navRecoverySerial || 0) + 1) >>> 0;
        enemy._navRecoverySerial = serial;
        enemy._navStuckTime = 0;
        const base = Math.atan2(ny, nx) + (enemy._navSide === -1 ? -1 : 1) * Math.PI / 2;
        const probe = Math.min(190, radius + 110);
        for (let i = 0; i < 8; i++) {
            const index = (i + serial) & 7;
            const a = base + index * Math.PI / 4;
            const rx = Math.cos(a), ry = Math.sin(a);
            if (obstacles.movementBlocked(
                enemy.x, enemy.y,
                enemy.x + rx * probe, enemy.y + ry * probe,
                clearance,
            )) continue;
            enemy._navMoveX = rx;
            enemy._navMoveY = ry;
            enemy._navHold = RECOVERY_HOLD_SECONDS;
            enemy._navReason = 'house-stuck-recovery';
            return true;
        }
    }

    if (!directBlocked) {
        // While rounding a corner, do one longer probe before dropping the
        // chosen wall side. This hysteresis prevents direct/avoid oscillation
        // at the end of a long building wall.
        if (hold <= 0 || !obstacles.movementBlocked(
            enemy.x, enemy.y,
            enemy.x + nx * Math.min(380, look * 1.75),
            enemy.y + ny * Math.min(380, look * 1.75),
            clearance,
        )) {
            enemy._navHold = 0;
            enemy._navMoveX = nx;
            enemy._navMoveY = ny;
            if (!String(enemy._navReason || '').startsWith('house-')) enemy._navReason = 'direct-clear';
            return true;
        }
    } else {
        enemy._navHold = WALL_FOLLOW_HOLD;
    }

    // Try the remembered side first. Spawn position/type seed _navSide in the
    // Enemy constructor so a crowd naturally splits around both sides of cover.
    let side = enemy._navSide === -1 ? -1 : 1;
    for (let sidePass = 0; sidePass < 2; sidePass++) {
        for (let i = 0; i < TURN_ANGLES.length; i++) {
            const a = TURN_ANGLES[i] * side;
            const c = Math.cos(a), s = Math.sin(a);
            const rx = nx * c - ny * s;
            const ry = nx * s + ny * c;
            if (obstacles.movementBlocked(
                enemy.x, enemy.y,
                enemy.x + rx * look, enemy.y + ry * look,
                clearance,
            )) continue;

            enemy._navSide = side;
            enemy._navMoveX = rx;
            enemy._navMoveY = ry;
            if (!String(enemy._navReason || '').startsWith('house-door:')) enemy._navReason = 'wall-follow';
            return true;
        }
        side = -side;
    }

    // A rare concave/crowded case can block every fan probe. Backing away is a
    // deterministic recovery heading; resolveCircle remains the authority and
    // prevents this fallback from crossing a wall.
    enemy._navSide = -enemy._navSide;
    enemy._navHold = WALL_FOLLOW_HOLD;
    enemy._navMoveX = -nx;
    enemy._navMoveY = -ny;
    enemy._navReason = 'fan-exhausted-reverse';
    return true;
}
