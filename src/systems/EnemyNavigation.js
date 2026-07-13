// Local obstacle navigation for enemies.
//
// This is deliberately not a global pathfinder: the procedural world is open,
// obstacles are sparse, and as many as 180 enemies can be alive. A short
// swept-circle probe plus a stateful wall-following side gives each moving
// enemy enough memory to round houses/props without an A* allocation per body.

const TURN_ANGLES = [0.36, 0.7, 1.05, 1.4, Math.PI / 2, 1.9, 2.28, 2.68];
const WALL_FOLLOW_HOLD = 1.15;

// Writes a unit movement heading to enemy._navMoveX/Y. Navigation state is
// stored on the enemy so a body keeps the same side of a wall instead of
// choosing left/right afresh each frame and shivering in place.
//
// Returns true when obstacle avoidance changed (or confirmed) the heading.
// The caller can otherwise retain its original behavior vector.
export function steerEnemyMovement(enemy, dx, dy, speed, obstacles, dt) {
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

    const directBlocked = obstacles.movementBlocked(
        enemy.x, enemy.y,
        enemy.x + nx * look, enemy.y + ny * look,
        clearance,
    );

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
    return true;
}
