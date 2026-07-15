// Visual-only presentation for the Last-Wick Cabin's Ruin Bell encounter.
//
// RuinBellDirector owns every gameplay fact and exposes a serializable
// getRenderSnapshot(). This module only reads that snapshot. It keeps no clock,
// cache, entity reference, or mutable encounter state, so screenshots and
// replays paint the same frame from the same snapshot.

import { LIGHT_COLORS } from '../config/GameConfig.js';
import { TWO_PI, clamp } from '../core/MathUtils.js';

const EMBER = LIGHT_COLORS.candle;
const EMBER_HOT = LIGHT_COLORS.hazard;
const INK = '#05070c';
const ASH = '#82766d';
const PAPER = '#fff4df';

const ENGAGED_PHASES = new Set(['arming', 'warning', 'active']);
const DEFENSE_PHASES = new Set(['warning', 'active', 'technical-defer']);
const TELEGRAPH_PHASES = new Set(['warning', 'active']);
const QUIET_PHASES = new Set(['locked', 'spent']);
const STAGE_ORDINAL = Object.freeze({
    'door-runners': 1,
    'window-crossfire': 2,
    'last-breach': 3,
});

function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function clamp01(value) {
    return clamp(finite(value), 0, 1);
}

function phaseOf(snapshot) {
    return typeof snapshot?.phase === 'string' ? snapshot.phase : 'locked';
}

function isReduced(snapshot, presentation = null) {
    return presentation?.reducedEffects === true || presentation?.reducedMotion === true
        || snapshot?.reducedEffects === true || snapshot?.reducedMotion === true;
}

function isHighContrast(snapshot, presentation = null) {
    return presentation?.highContrast === true || snapshot?.highContrast === true;
}

function anchorOf(snapshot) {
    const anchor = snapshot?.anchor;
    if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return null;
    return {
        x: anchor.x,
        y: anchor.y,
        radius: clamp(finite(anchor.radius, 104), 48, 240),
    };
}

function defenseOf(snapshot) {
    const defense = snapshot?.defense;
    const center = defense?.center;
    if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) return null;
    const radius = finite(defense.radius, NaN);
    if (!(radius > 0)) return null;
    return {
        x: center.x,
        y: center.y,
        radius: clamp(radius, 180, 720),
        outside: defense.outside === true,
        graceSeconds: Math.max(0, finite(defense.graceSeconds)),
        graceRemaining: Math.max(0, finite(defense.graceRemaining)),
    };
}

function visualTime(snapshot) {
    if (Number.isFinite(snapshot?.visualTime)) return snapshot.visualTime;
    if (Number.isFinite(snapshot?.timer?.elapsed)) return snapshot.timer.elapsed;
    if (Number.isFinite(snapshot?.dwell?.seconds)) return snapshot.dwell.seconds;
    return 0;
}

function pulseFor(snapshot, speed = 3.6) {
    if (isReduced(snapshot)) return 0.78;
    return 0.78 + Math.sin(visualTime(snapshot) * speed) * 0.12;
}

function phaseAccent(phase) {
    if (phase === 'retry-cooldown' || phase === 'technical-defer') return ASH;
    if (phase === 'cleared') return '#ffd38a';
    return phase === 'warning' || phase === 'active' ? EMBER_HOT : EMBER;
}

function phaseProgress(snapshot, phase) {
    if (phase === 'arming') return clamp01(snapshot?.dwell?.progress);
    if (phase === 'active' && snapshot?.timer?.visible !== false) {
        const timeout = Math.max(0.001, finite(snapshot?.timer?.timeoutSeconds, 60));
        return clamp01(finite(snapshot?.timer?.elapsed) / timeout);
    }
    if (phase === 'cleared') return 1;
    if (phase === 'retry-cooldown') {
        const duration = finite(snapshot?.retry?.duration);
        const remaining = finite(snapshot?.retry?.remaining, NaN);
        return duration > 0 && Number.isFinite(remaining)
            ? clamp01(1 - remaining / duration) : 0;
    }
    return 0;
}

function stageOrdinal(stageId) {
    if (typeof stageId === 'number') return clamp(Math.floor(stageId), 0, 3);
    if (typeof stageId !== 'string') return 0;
    if (STAGE_ORDINAL[stageId]) return STAGE_ORDINAL[stageId];
    const match = stageId.match(/(\d+)/);
    return match ? clamp(Number(match[1]), 0, 3) : 0;
}

function highestSemanticStage(entries, current = 0) {
    if (!Array.isArray(entries)) return current;
    let highest = current;
    for (const entry of entries) highest = Math.max(highest, stageOrdinal(entry?.stageId));
    return highest;
}

function stageNumber(snapshot) {
    const direct = finite(snapshot?.stage?.current, finite(snapshot?.stage, NaN));
    if (Number.isFinite(direct)) return clamp(Math.floor(direct), 0, 3);
    let highest = stageOrdinal(snapshot?.pendingWave?.stageId);
    highest = highestSemanticStage(snapshot?.telegraphs, highest);
    highest = highestSemanticStage(snapshot?.roleMarks, highest);
    return clamp(highest, 0, 3);
}

function drawArc(ctx, x, y, radius, start, end) {
    ctx.beginPath();
    ctx.arc(x, y, radius, start, end);
    ctx.stroke();
}

function drawStageNotches(ctx, anchor, snapshot, accent, highContrast) {
    const current = stageNumber(snapshot);
    const radius = anchor.radius + 12;
    for (let index = 1; index <= 3; index++) {
        const angle = -Math.PI * 0.78 + (index - 1) * Math.PI * 0.78;
        const nx = Math.cos(angle);
        const ny = Math.sin(angle);
        const inner = radius - (index <= current ? 7 : 3);
        const outer = radius + (index <= current ? 11 : 7);
        ctx.strokeStyle = highContrast ? PAPER : (index <= current ? accent : 'rgba(255,244,223,0.34)');
        ctx.lineWidth = highContrast ? 5 : (index <= current ? 4 : 2);
        ctx.beginPath();
        ctx.moveTo(anchor.x + nx * inner, anchor.y + ny * inner);
        ctx.lineTo(anchor.x + nx * outer, anchor.y + ny * outer);
        ctx.stroke();
    }
}

function drawTimerNotch(ctx, anchor, snapshot, highContrast) {
    if (snapshot?.timer?.visible === false) return;
    const timeout = finite(snapshot?.timer?.timeoutSeconds);
    const elapsed = finite(snapshot?.timer?.elapsed);
    const earliestIn = finite(snapshot?.timer?.earliestClearIn, NaN);
    if (!(timeout > 0) || !Number.isFinite(earliestIn)) return;
    const earliestAt = clamp(elapsed + Math.max(0, earliestIn), 0, timeout);
    const angle = -Math.PI / 2 + TWO_PI * (earliestAt / timeout);
    const radius = anchor.radius + 21;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    ctx.strokeStyle = highContrast ? PAPER : '#ffd38a';
    ctx.lineWidth = highContrast ? 5 : 3;
    ctx.beginPath();
    ctx.moveTo(anchor.x + nx * (radius - 8), anchor.y + ny * (radius - 8));
    ctx.lineTo(anchor.x + nx * (radius + 8), anchor.y + ny * (radius + 8));
    ctx.stroke();
}

function drawDefenseBoundary(ctx, defense, snapshot, highContrast, reduced, contourOnly = false) {
    if (!defense) return false;
    const pulse = reduced ? 0.78 : pulseFor(snapshot, 2.2);
    const accent = highContrast ? PAPER
        : (defense.outside ? EMBER_HOT : phaseAccent(phaseOf(snapshot)));
    const dash = defense.outside ? [9, 7] : [18, 8, 3, 8];

    ctx.save();
    ctx.globalAlpha = contourOnly || highContrast
        ? 1
        : defense.outside ? 0.78 + pulse * 0.12 : 0.54 + pulse * 0.10;
    ctx.lineCap = 'round';
    ctx.setLineDash(dash);

    // The broad dash-dot fence belongs to the cabin center, not the bell. A
    // dark keyline keeps it legible over floors, foliage, and spell effects.
    ctx.strokeStyle = INK;
    ctx.lineWidth = highContrast ? 10 : 7;
    drawArc(ctx, defense.x, defense.y, defense.radius, 0, TWO_PI);
    ctx.strokeStyle = accent;
    ctx.lineWidth = highContrast ? 5 : 3.5;
    drawArc(ctx, defense.x, defense.y, defense.radius, 0, TWO_PI);
    ctx.setLineDash([]);

    // Eight inward guard posts communicate "remain inside" without relying
    // on hue. Their geometry is fixed when Reduced Effects is enabled.
    for (let index = 0; index < 8; index++) {
        const angle = -Math.PI / 2 + index * Math.PI / 4;
        const nx = Math.cos(angle);
        const ny = Math.sin(angle);
        const inner = defense.radius - (index % 2 === 0 ? 20 : 13);
        const outer = defense.radius + 4;
        ctx.strokeStyle = INK;
        ctx.lineWidth = highContrast ? 9 : 6;
        ctx.beginPath();
        ctx.moveTo(defense.x + nx * outer, defense.y + ny * outer);
        ctx.lineTo(defense.x + nx * inner, defense.y + ny * inner);
        ctx.stroke();
        ctx.strokeStyle = accent;
        ctx.lineWidth = highContrast ? 4 : 2.75;
        ctx.stroke();
    }

    // Leaving the fence swaps to a short emergency cadence and adds a solid,
    // shrinking grace arc. Shape and motion state remain understandable in
    // monochrome; Reduced Effects leaves the authored countdown static.
    if (defense.outside && defense.graceSeconds > 0) {
        const progress = clamp01(defense.graceRemaining / defense.graceSeconds);
        const start = -Math.PI / 2;
        const end = start + TWO_PI * progress;
        const radius = defense.radius - 10;
        ctx.strokeStyle = INK;
        ctx.lineWidth = highContrast ? 11 : 8;
        drawArc(ctx, defense.x, defense.y, radius, start, end);
        ctx.strokeStyle = accent;
        ctx.lineWidth = highContrast ? 6 : 4;
        drawArc(ctx, defense.x, defense.y, radius, start, end);
    }

    ctx.restore();
    return true;
}

function matchingDoor(snapshot, telegraph) {
    const embedded = telegraph?.entry;
    if (embedded && Number.isFinite(embedded.x) && Number.isFinite(embedded.y)) return embedded;
    const doorId = telegraph?.entryDoorId || telegraph?.doorId;
    const doors = Array.isArray(snapshot?.doors) ? snapshot.doors : snapshot?.house?.doors;
    if (!doorId || !Array.isArray(doors)) return null;
    for (const door of doors) {
        if (door?.id === doorId && Number.isFinite(door.x) && Number.isFinite(door.y)) return door;
    }
    return null;
}

function doorNormal(snapshot, door) {
    let nx = finite(door?.normal?.x);
    let ny = finite(door?.normal?.y);
    const length = Math.hypot(nx, ny);
    if (length > 0.01) return { x: nx / length, y: ny / length };
    const house = snapshot?.house;
    if (Number.isFinite(house?.x) && Number.isFinite(house?.y)) {
        nx = door.x - house.x;
        ny = door.y - house.y;
        const radial = Math.hypot(nx, ny);
        if (radial > 0.01) return { x: nx / radial, y: ny / radial };
    }
    // Axis is authored door geometry, so this remains semantic rather than a
    // guessed wave direction. Unknown geometry is skipped by the caller.
    if (door?.axis === 'horizontal') return { x: 0, y: 1 };
    if (door?.axis === 'vertical') return { x: 1, y: 0 };
    return null;
}

function drawRoleGlyph(ctx, role, x, y, size, accent, highContrast) {
    const color = highContrast ? PAPER : accent;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = highContrast ? INK : 'rgba(5,7,12,0.88)';
    ctx.lineWidth = highContrast ? 7 : 5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const path = () => {
        ctx.beginPath();
        if (role === 'ranged' || role === 'marksman') {
            ctx.arc(0, 0, size * 0.48, 0, TWO_PI);
            ctx.moveTo(-size * 0.72, 0); ctx.lineTo(size * 0.72, 0);
            ctx.moveTo(0, -size * 0.72); ctx.lineTo(0, size * 0.72);
        } else if (role === 'support') {
            ctx.moveTo(0, -size * 0.70); ctx.lineTo(0, size * 0.70);
            ctx.moveTo(-size * 0.70, 0); ctx.lineTo(size * 0.70, 0);
            ctx.moveTo(0, -size * 0.70); ctx.lineTo(size * 0.58, 0);
            ctx.lineTo(0, size * 0.70); ctx.lineTo(-size * 0.58, 0); ctx.closePath();
        } else if (role === 'flanker' || role === 'charger' || role === 'door-runner') {
            ctx.moveTo(-size * 0.70, -size * 0.46); ctx.lineTo(0, 0);
            ctx.lineTo(-size * 0.70, size * 0.46);
            ctx.moveTo(0, -size * 0.46); ctx.lineTo(size * 0.70, 0);
            ctx.lineTo(0, size * 0.46);
        } else if (role === 'bomber') {
            ctx.moveTo(0, -size * 0.72); ctx.lineTo(size * 0.64, 0);
            ctx.lineTo(0, size * 0.72); ctx.lineTo(-size * 0.64, 0); ctx.closePath();
            ctx.moveTo(-size * 0.25, 0); ctx.lineTo(size * 0.25, 0);
            ctx.moveTo(0, -size * 0.25); ctx.lineTo(0, size * 0.25);
        } else if (role === 'siege' || role === 'large') {
            ctx.moveTo(-size * 0.68, -size * 0.52); ctx.lineTo(size * 0.68, -size * 0.52);
            ctx.lineTo(size * 0.48, size * 0.52); ctx.lineTo(-size * 0.48, size * 0.52); ctx.closePath();
            ctx.moveTo(-size * 0.22, -size * 0.52); ctx.lineTo(-size * 0.22, size * 0.45);
            ctx.moveTo(size * 0.22, -size * 0.52); ctx.lineTo(size * 0.22, size * 0.45);
        } else {
            // Frontline: a compact shield contour, distinct from every entry
            // arrow and readable in monochrome High Contrast mode.
            ctx.moveTo(0, -size * 0.72); ctx.lineTo(size * 0.62, -size * 0.42);
            ctx.lineTo(size * 0.48, size * 0.34); ctx.lineTo(0, size * 0.72);
            ctx.lineTo(-size * 0.48, size * 0.34); ctx.lineTo(-size * 0.62, -size * 0.42); ctx.closePath();
        }
        ctx.stroke();
    };

    path();
    ctx.strokeStyle = color;
    ctx.lineWidth = highContrast ? 3 : 2.4;
    path();
    ctx.restore();
}

function drawDoorTelegraph(ctx, snapshot, telegraph, index, highContrast, reduced, contourOnly = false) {
    const door = matchingDoor(snapshot, telegraph);
    const normal = door && doorNormal(snapshot, door);
    if (!door || !normal) return false;

    const tangent = { x: -normal.y, y: normal.x };
    const width = clamp(finite(door.width, 120), 44, 190);
    const telegraphPulse = reduced ? 0.78 : pulseFor(snapshot, 4.2);
    const length = reduced ? 82 : 88 + telegraphPulse * 10;
    const accent = highContrast ? PAPER : (telegraph.accent || EMBER_HOT);
    const outerX = door.x + normal.x * length;
    const outerY = door.y + normal.y * length;
    const halfDoor = width * 0.42;
    const halfOuter = width * 0.22;

    ctx.save();
    ctx.globalAlpha = contourOnly ? 1 : reduced ? 0.72 : 0.58 + telegraphPulse * 0.18;
    if (!contourOnly) {
        ctx.fillStyle = highContrast ? 'rgba(5,7,12,0.72)' : 'rgba(255,90,60,0.11)';
        ctx.beginPath();
        ctx.moveTo(door.x + tangent.x * halfDoor, door.y + tangent.y * halfDoor);
        ctx.lineTo(door.x - tangent.x * halfDoor, door.y - tangent.y * halfDoor);
        ctx.lineTo(outerX - tangent.x * halfOuter, outerY - tangent.y * halfOuter);
        ctx.lineTo(outerX + tangent.x * halfOuter, outerY + tangent.y * halfOuter);
        ctx.closePath();
        ctx.fill();
    }

    // Threshold bracket: a doorway warning, never a circular damage marker.
    ctx.strokeStyle = highContrast ? INK : 'rgba(5,7,12,0.88)';
    ctx.lineWidth = highContrast ? 8 : 7;
    ctx.beginPath();
    ctx.moveTo(door.x + tangent.x * halfDoor, door.y + tangent.y * halfDoor);
    ctx.lineTo(door.x - tangent.x * halfDoor, door.y - tangent.y * halfDoor);
    ctx.stroke();
    ctx.strokeStyle = accent;
    ctx.lineWidth = highContrast ? 4 : 3;
    ctx.stroke();

    // Three inward chevrons communicate movement direction without text or a
    // color-only warning. Their positions are fixed under Reduced Effects.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let mark = 0; mark < 3; mark++) {
        const travel = 24 + mark * 22;
        const mx = door.x + normal.x * travel;
        const my = door.y + normal.y * travel;
        const wing = 11;
        const depth = 10;
        ctx.strokeStyle = highContrast ? INK : 'rgba(5,7,12,0.86)';
        ctx.lineWidth = highContrast ? 7 : 6;
        ctx.beginPath();
        ctx.moveTo(mx + tangent.x * wing + normal.x * depth, my + tangent.y * wing + normal.y * depth);
        ctx.lineTo(mx, my);
        ctx.lineTo(mx - tangent.x * wing + normal.x * depth, my - tangent.y * wing + normal.y * depth);
        ctx.stroke();
        ctx.strokeStyle = accent;
        ctx.lineWidth = highContrast ? 3 : 2.4;
        ctx.stroke();
    }

    drawRoleGlyph(
        ctx,
        telegraph.role,
        outerX + normal.x * 16,
        outerY + normal.y * 16,
        13 + Math.min(index, 2),
        telegraph.accent || EMBER_HOT,
        highContrast,
    );
    ctx.restore();
    return true;
}

function drawBellResonance(ctx, anchor, snapshot, phase, highContrast, reduced) {
    const accent = phaseAccent(phase);
    const pulse = reduced ? 0.78 : pulseFor(snapshot, 4.6);
    const lift = 38;
    const spread = reduced ? 0 : (pulse - 0.78) * 16;
    // Reduced Effects keeps one static semantic toll arc instead of freezing
    // all three animated echoes in place. This materially lowers visual noise
    // in a still frame while preserving the Bell's readable state marker.
    const ringCount = reduced ? 1 : 3;
    ctx.save();
    ctx.lineCap = 'round';
    for (let index = 0; index < ringCount; index++) {
        const radius = 24 + index * 13 + spread;
        const alpha = 0.76 - index * 0.17;
        ctx.globalAlpha = highContrast ? 1 : alpha;
        ctx.strokeStyle = highContrast ? INK : 'rgba(5,7,12,0.90)';
        ctx.lineWidth = highContrast ? 7 : 6;
        drawArc(ctx, anchor.x, anchor.y - lift, radius, Math.PI * 1.12, Math.PI * 1.88);
        ctx.strokeStyle = highContrast ? PAPER : accent;
        ctx.lineWidth = highContrast ? 3 : 2.5;
        drawArc(ctx, anchor.x, anchor.y - lift, radius, Math.PI * 1.12, Math.PI * 1.88);
    }
    ctx.restore();
}

function drawLiveRoleMarks(ctx, snapshot, highContrast) {
    const marks = snapshot?.roleMarks;
    if (!Array.isArray(marks)) return;
    for (const mark of marks) {
        // The pure director may expose semantic IDs before integration resolves
        // live enemy positions. Never invent a position: an unresolved mark is
        // intentionally skipped until the caller supplies world x/y.
        if (!Number.isFinite(mark?.x) || !Number.isFinite(mark?.y)) continue;
        drawRoleGlyph(ctx, mark.role, mark.x, mark.y - finite(mark.radius, 34) - 14,
            12, mark.accent || EMBER_HOT, highContrast);
    }
}

function drawRewardMarks(ctx, snapshot, highContrast, reduced) {
    if (phaseOf(snapshot) !== 'cleared' || snapshot?.rewardReady !== true) return 0;
    const marks = Array.isArray(snapshot?.rewardMarks) ? snapshot.rewardMarks : [];
    let painted = 0;
    for (const mark of marks) {
        if (!Number.isFinite(mark?.x) || !Number.isFinite(mark?.y)) continue;
        const radius = clamp(finite(mark.radius, 42) + 13, 42, 96);
        const accent = highContrast ? PAPER : (mark.accent || '#ffd38a');
        const lift = radius + 30;
        const pulse = reduced ? 0 : Math.sin(visualTime(snapshot) * 3.2 + painted) * 4;
        const label = String(mark.label || (mark.choice === 'shrine' ? 'WICK SHRINE' : 'CHEST'));

        ctx.save();
        ctx.globalAlpha = highContrast ? 1 : 0.94;
        ctx.strokeStyle = INK;
        ctx.lineWidth = highContrast ? 9 : 7;
        ctx.setLineDash(mark.choice === 'shrine' ? [5, 5] : []);
        drawArc(ctx, mark.x, mark.y, radius, 0, TWO_PI);
        ctx.strokeStyle = accent;
        ctx.lineWidth = highContrast ? 5 : 3;
        drawArc(ctx, mark.x, mark.y, radius, 0, TWO_PI);
        ctx.setLineDash([]);

        // A short locator stem and textual choice label identify the existing
        // reward entities. This is guidance around real Chest/Shrine art, not a
        // replacement drawing or an inferred pickup location.
        const labelY = mark.y - lift - pulse;
        ctx.strokeStyle = INK;
        ctx.lineWidth = highContrast ? 8 : 6;
        ctx.beginPath();
        ctx.moveTo(mark.x, mark.y - radius);
        ctx.lineTo(mark.x, labelY + 8);
        ctx.stroke();
        ctx.strokeStyle = accent;
        ctx.lineWidth = highContrast ? 4 : 2.5;
        ctx.stroke();
        ctx.font = '700 18px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = highContrast ? 7 : 5;
        ctx.strokeStyle = INK;
        ctx.strokeText(label, mark.x, labelY);
        ctx.fillStyle = accent;
        ctx.fillText(label, mark.x, labelY);
        ctx.restore();
        painted++;
    }
    return painted;
}

export class RuinBellRenderer {
    // World-space ground pass. Call after the camera transform and before
    // actors. Returns true only when a visible encounter mark was painted.
    drawGround(ctx, snapshot, presentation = null) {
        if (!ctx || snapshot?.visible === false) return false;
        const phase = phaseOf(snapshot);
        const anchor = anchorOf(snapshot);
        if (!anchor || QUIET_PHASES.has(phase)) return false;

        const reduced = isReduced(snapshot, presentation);
        const highContrast = isHighContrast(snapshot, presentation);
        const accent = phaseAccent(phase);
        const pulse = reduced ? 0.78 : pulseFor(snapshot);
        const progress = phaseProgress(snapshot, phase);
        const defense = DEFENSE_PHASES.has(phase) ? defenseOf(snapshot) : null;

        ctx.save();
        ctx.globalCompositeOperation = 'source-over';

        // Once the bell tolls, the authored 460px cabin-centered boundary is
        // the combat contract. It remains separate from the small focus ring.
        if (defense) {
            drawDefenseBoundary(ctx, defense, snapshot, highContrast, reduced);
        }

        // The 104px bell-centered focus ring remains visible as the activation
        // landmark. It is never stretched into the much larger defense fence.
        ctx.globalAlpha = phase === 'dormant' ? 0.36 : 0.52 + pulse * 0.12;
        ctx.strokeStyle = highContrast ? PAPER : accent;
        ctx.lineWidth = highContrast ? 5 : (ENGAGED_PHASES.has(phase) ? 3.5 : 2.5);
        ctx.setLineDash(phase === 'retry-cooldown' || phase === 'technical-defer'
            ? [11, 13] : [32, 10]);
        drawArc(ctx, anchor.x, anchor.y, anchor.radius, 0, TWO_PI);
        ctx.setLineDash([]);

        // Progress has its own solid arc and a dark keyline, so Arming, elapsed
        // defense time, and Clear remain readable in monochrome captures.
        if (progress > 0) {
            const start = -Math.PI / 2;
            const end = start + TWO_PI * progress;
            ctx.globalAlpha = 0.96;
            ctx.strokeStyle = highContrast ? INK : 'rgba(5,7,12,0.86)';
            ctx.lineWidth = highContrast ? 11 : 9;
            drawArc(ctx, anchor.x, anchor.y, anchor.radius + 1, start, end);
            ctx.strokeStyle = highContrast ? PAPER : accent;
            ctx.lineWidth = highContrast ? 6 : 4.5;
            drawArc(ctx, anchor.x, anchor.y, anchor.radius + 1, start, end);
        }

        drawStageNotches(ctx, anchor, snapshot, accent, highContrast);
        if (phase === 'active') drawTimerNotch(ctx, anchor, snapshot, highContrast);

        // The Director owns the warning window: it exposes telegraphs from the
        // authored lead time until the all-or-none spawn is acknowledged. An
        // empty array means no doorway warning; the renderer never infers one.
        const telegraphs = Array.isArray(snapshot.telegraphs) ? snapshot.telegraphs : [];
        if (TELEGRAPH_PHASES.has(phase) && telegraphs.length > 0) {
            for (let index = 0; index < telegraphs.length; index++) {
                drawDoorTelegraph(ctx, snapshot, telegraphs[index], index, highContrast, reduced);
            }
        }

        ctx.restore();
        return true;
    }

    // World-space semantic pass. Call after actors (and after the veil when
    // High Contrast contours are required). It adds no DOM text and never
    // redraws the real bell sprite owned by Obstacle.
    drawAbove(ctx, snapshot, presentation = null) {
        if (!ctx || snapshot?.visible === false) return false;
        const phase = phaseOf(snapshot);
        const anchor = anchorOf(snapshot);
        if (!anchor || QUIET_PHASES.has(phase)) return false;
        const highContrast = isHighContrast(snapshot, presentation);
        const reduced = isReduced(snapshot, presentation);
        const defense = DEFENSE_PHASES.has(phase) ? defenseOf(snapshot) : null;

        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        if (highContrast) {
            // Repeat only critical contours in the semantic pass so the veil,
            // weather, entities, and damage numbers cannot erase the meaning.
            if (defense) {
                drawDefenseBoundary(ctx, defense, snapshot, true, reduced, true);
            }
            ctx.strokeStyle = INK;
            ctx.lineWidth = 9;
            ctx.setLineDash(phase === 'retry-cooldown' || phase === 'technical-defer'
                ? [11, 13] : [32, 10]);
            drawArc(ctx, anchor.x, anchor.y, anchor.radius, 0, TWO_PI);
            ctx.strokeStyle = PAPER;
            ctx.lineWidth = 5;
            drawArc(ctx, anchor.x, anchor.y, anchor.radius, 0, TWO_PI);
            ctx.setLineDash([]);
            drawStageNotches(ctx, anchor, snapshot, PAPER, true);
            const telegraphs = Array.isArray(snapshot.telegraphs) ? snapshot.telegraphs : [];
            if (TELEGRAPH_PHASES.has(phase)) {
                for (let index = 0; index < telegraphs.length; index++) {
                    drawDoorTelegraph(ctx, snapshot, telegraphs[index], index, true, reduced, true);
                }
            }
        }
        if (ENGAGED_PHASES.has(phase) || phase === 'cleared') {
            drawBellResonance(ctx, anchor, snapshot, phase, highContrast, reduced);
        }
        if (phase === 'warning' || phase === 'active') {
            drawLiveRoleMarks(ctx, snapshot, highContrast);
        }
        drawRewardMarks(ctx, snapshot, highContrast, reduced);
        ctx.restore();
        return true;
    }

    // Optional Emberlight registration. The single active encounter emitter is
    // priority 0 because it carries combat meaning; quiet/lit cabin mood stays
    // priority 2 and yields to player/projectile/hazard lights.
    registerLights(lighting, snapshot, presentation = null) {
        if (!lighting || typeof lighting.addLight !== 'function'
            || snapshot?.visible === false) return false;
        const anchor = anchorOf(snapshot);
        if (!anchor) return false;
        const phase = phaseOf(snapshot);
        const bellLit = snapshot?.bell?.lit === true;
        if (!bellLit && !ENGAGED_PHASES.has(phase) && phase !== 'cleared') return false;

        const reduced = isReduced(snapshot, presentation);
        const authored = clamp01(snapshot?.bell?.intensity);
        const active = phase === 'warning' || phase === 'active';
        const intensity = authored > 0
            ? clamp(authored, 0.18, reduced ? 0.58 : 0.78)
            : active ? (reduced ? 0.46 : 0.64) : 0.32;
        const radius = active ? (reduced ? 176 : 208) : 146;
        lighting.addLight(
            anchor.x,
            anchor.y - 28,
            radius,
            phaseAccent(phase),
            intensity,
            active ? 0 : 2,
        );
        return true;
    }
}

export const ruinBellRenderer = Object.freeze(new RuinBellRenderer());
