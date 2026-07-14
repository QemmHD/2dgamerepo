// Pure HUD geometry allocator. It deliberately knows nothing about Canvas,
// Game, DOM, or input: UISystem hands it the current safe area + mode and all
// persistent HUD surfaces receive their rectangles from this one snapshot.
// Keeping the arithmetic here makes desktop, touch, cover-crop, and boss
// layouts testable without booting the game.

import { uiScaleFactor } from './AccessibilityPreferences.js';

const DEFAULT_W = 1920;
const DEFAULT_H = 1080;

function finiteOr(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function cleanSafeArea(safeArea = {}) {
    return {
        top: Math.max(0, finiteOr(safeArea.top)),
        right: Math.max(0, finiteOr(safeArea.right)),
        bottom: Math.max(0, finiteOr(safeArea.bottom)),
        left: Math.max(0, finiteOr(safeArea.left)),
    };
}

function rect(x, y, w, h) {
    return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
}

function activeBottom(value, fallback = 0) {
    return value && value.w > 0 && value.h > 0 ? value.y + value.h + 12 : fallback;
}

export function hudRectsOverlap(a, b, gap = 0) {
    if (!a || !b || a.w <= 0 || a.h <= 0 || b.w <= 0 || b.h <= 0) return false;
    return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x
        && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

export function computeHUDLayout(options = {}) {
    const width = Math.max(640, finiteOr(options.width, DEFAULT_W));
    const height = Math.max(360, finiteOr(options.height, DEFAULT_H));
    const safe = cleanSafeArea(options.safeArea);
    const touchMode = !!options.touchMode;
    const compact = !!options.compact || touchMode;
    const hasBoss = !!options.hasBoss;
    const hasLieutenant = !!options.hasLieutenant;
    const hasBossRush = !!options.hasBossRush;
    const loadoutCount = Math.max(0, Math.floor(finiteOr(options.loadoutCount)));
    const relicCount = Math.max(0, Math.floor(finiteOr(options.relicCount)));
    const abilityCount = Math.max(0, Math.floor(finiteOr(options.abilityCount)));
    const hasVigil = !!options.hasVigil;
    const hasObjective = !!options.hasObjective;
    // UI scale is a screen-space HUD preference. It must never alter world or
    // camera coordinates, renderer fit, or the fixed touch-action discs.
    const uiScale = uiScaleFactor(options.uiScale);
    const cssScale = Number.isFinite(options.cssScale) && options.cssScale > 0
        ? options.cssScale : 1;

    const left = safe.left;
    const right = width - safe.right;
    const top = safe.top;
    const bottom = height - safe.bottom;
    const usableW = Math.max(1, right - left);
    const centerX = left + usableW / 2;

    // The command rail owns timer, vigil, kills, coins, and (outside a duel)
    // the THREAT band. A duel shortens it to one row and claims a dedicated
    // plate immediately below; no method invents another top-centre Y value.
    const headerW = Math.min(compact ? 640 : 620, Math.max(360, usableW - 520));
    const headerH = (hasBoss ? 80 : 104) + Math.round((uiScale - 1) * 80);
    const header = rect(centerX - headerW / 2, top + 8, headerW, headerH);
    const threat = hasBoss
        ? rect(0, 0, 0, 0)
        : rect(header.x + 24, header.y + header.h - 25, header.w - 48, 10);
    // Scaled HUDs use the extra rail height as a real second lane:
    // timer/counters stay in the primary lane, while the wave identity owns a
    // separate bounded lane above THREAT. At 100% the original single-row
    // coordinates remain exact. CSS widths around 1280 still select the desktop
    // cockpit, so this cannot be restricted to touch/compact mode.
    const splitCommandLanes = uiScale > 1;
    const timerTextPx = (compact ? 46 : 42) * uiScale;
    const identityTextPx = (compact ? 22 : 19) * uiScale;
    const primaryY = splitCommandLanes
        ? header.y + 4 + timerTextPx / 2
        : header.y + (hasBoss ? header.h / 2 : 36 * uiScale);
    const identityY = splitCommandLanes
        ? primaryY + timerTextPx / 2 + 4 + identityTextPx / 2
        : primaryY;
    const command = {
        split: splitCommandLanes,
        primaryY,
        identityY,
        primaryTop: primaryY - timerTextPx / 2,
        primaryBottom: primaryY + timerTextPx / 2,
        identityTop: identityY - identityTextPx / 2,
        identityBottom: identityY + identityTextPx / 2,
        timerX: header.x + 24,
        timerMaxW: header.w * (splitCommandLanes ? 0.45 : 0.30),
        countersRight: header.x + header.w - 24,
        countersMaxW: header.w * (splitCommandLanes ? 0.45 : 0.30),
        identityX: header.x + header.w * 0.53,
        identityMaxW: splitCommandLanes ? header.w - 48 : header.w * 0.34,
    };

    // Keep the duel plate out of the left-side cockpit. Compact mode reserves
    // the wider vitals console; desktop reserves the build strip. The plate
    // gives up width before it ever sits on top of either surface.
    const leftRailRight = compact
        ? left + 16 + 500 + 12
        : left + 18 + 414 + 12;
    const bossHalfSpan = Math.max(260, Math.min(
        centerX - leftRailRight,
        right - 48 - centerX,
    ));
    const bossW = Math.min(
        compact ? 1080 : 960,
        bossHalfSpan * 2,
        Math.max(520, usableW - 96),
    );
    const boss = hasBoss
        ? rect(centerX - bossW / 2, header.y + header.h + 12, bossW,
            (compact ? 124 : 116) + Math.round((uiScale - 1) * 80))
        : rect(0, 0, 0, 0);

    const secondaryTop = hasBoss ? boss.y + boss.h + 10 : header.y + header.h + 14;
    const lieutenantW = Math.min(620, Math.max(360, usableW - 160));
    const lieutenant = hasLieutenant
        ? rect(centerX - lieutenantW / 2, secondaryTop, lieutenantW, 42)
        : rect(0, 0, 0, 0);
    const bossRushTop = hasLieutenant ? lieutenant.y + lieutenant.h + 10 : secondaryTop;
    const bossRush = hasBossRush
        ? rect(centerX - 280, bossRushTop, 560, Math.round(66 * uiScale))
        : rect(0, 0, 0, 0);

    // Desktop keeps the familiar bottom-left cockpit. Touch/compact mode moves
    // it to the top-left because the floating joystick may originate anywhere
    // in the left half and is intentionally drawn above the HUD.
    const vitals = compact
        ? rect(left + 16, top + 16, 500, 112)
        : rect(left + 16, bottom - 104, 560, 92);
    vitals.compact = compact;
    vitals.docked = !compact;
    vitals.lvW = compact ? 72 : 66;
    vitals.hpH = compact ? 34 : 28;
    vitals.xpH = compact ? 20 : 16;

    const loadout = compact
        ? (() => {
            const cols = 5;
            const cellW = 68, cellH = 58, gap = 8;
            const shown = Math.min(15, loadoutCount);
            const usedCols = Math.max(1, Math.min(cols, shown || 1));
            const rows = Math.max(1, Math.ceil((shown || 1) / cols));
            const relicH = relicCount ? 28 : 0;
            const w = usedCols * cellW + Math.max(0, usedCols - 1) * gap + 20;
            const h = rows * cellH + Math.max(0, rows - 1) * gap + relicH + 20;
            const out = rect(left + 16, vitals.y + vitals.h + 12, w, h);
            Object.assign(out, { compact: true, cols, cellW, cellH, gap, shown });
            return out;
        })()
        : Object.assign(rect(left + 18, top + 16, 414, Math.max(0, vitals.y - top - 40)), {
            compact: false,
            maxBottom: vitals.y - 24,
        });

    // Existing pause hit geometry is preserved exactly. The layout merely
    // exposes it so validation can prove the command rail stays clear.
    const controlSize = 96;
    const pause = rect(right - 228, top + 20, controlSize, controlSize);
    const combo = rect(right - 260, top + 140, 220, 68);
    const guidanceTop = Math.max(
        combo.y + combo.h + 16,
        activeBottom(boss, top),
        activeBottom(lieutenant, top),
        activeBottom(bossRush, top),
    );
    // One right-rail guidance owner. The Run Path combines the current task and
    // Living Vigil counts; once all three phases finish, the richer Vigil card
    // can reclaim this same lane without stacking two equal-weight panels.
    const phoneGuidance = touchMode && usableW * cssScale <= 700;
    const compressedGuidance = !phoneGuidance && cssScale < 0.999;
    // A 1280x720 outer window can leave a much shorter content viewport after
    // browser chrome is removed, pushing the fixed-aspect canvas into this
    // narrower scale. Linux's wider system font then needs a third action line.
    const narrowCompressedGuidance = compressedGuidance && cssScale <= 0.7;
    const objectiveRight = right - 38;
    // A phone Run Path owns a real right rail instead of borrowing the combat
    // centre. Forty CSS pixels remain between the player column and the card,
    // even with a landscape safe inset or 130% Combat HUD text.
    const phoneCenterGap = phoneGuidance ? Math.ceil(40 / cssScale) : 0;
    const phoneRailLeft = centerX + phoneCenterGap;
    const baseObjectiveW = (compact ? 620 : 420) * uiScale;
    const objectiveW = phoneGuidance
        ? Math.min(baseObjectiveW, Math.max(0, objectiveRight - phoneRailLeft))
        : baseObjectiveW;
    const objectiveMetaPx = Math.max(14 * uiScale, Math.ceil(16 / cssScale));
    const objectiveTitlePx = Math.max(22 * uiScale, Math.ceil(17 / cssScale));
    const objectiveBodyPx = Math.max(15 * uiScale, Math.ceil(16 / cssScale));
    const objectiveProgressPx = Math.max(14 * uiScale, Math.ceil(16 / cssScale));
    const objectiveH = Math.max(
        (compact ? 230 : 172) * uiScale,
        objectiveMetaPx + objectiveTitlePx + objectiveBodyPx * 2
            + objectiveProgressPx + 70 * uiScale,
        // At the 667x375 ship target some authored next actions need three
        // lines at the 16 CSS-pixel accessibility floor. This height gives the
        // title, action, bar, and reward sequential lanes instead of letting a
        // percentage-based body run through the progress bar.
        phoneGuidance ? Math.ceil(134 / cssScale) : 0,
        // A 1920-wide logical canvas shown at common 1280/1600 CSS widths
        // still needs two or three complete action lines plus real gutters.
        compressedGuidance
            ? Math.ceil((narrowCompressedGuidance ? 164 : 140) / cssScale)
            : 0,
    );
    const reservedAbilityY = touchMode ? bottom - 394 : bottom - 148;
    const phoneAbilityGap = phoneGuidance ? Math.ceil(4 / cssScale) : 0;
    const edgeCompactObjective = hasObjective && phoneGuidance
        && guidanceTop + objectiveH + phoneAbilityGap > reservedAbilityY;
    const denseObjective = hasObjective && compact && !phoneGuidance
        && guidanceTop + objectiveH + 8 > reservedAbilityY;
    const denseObjectiveW = Math.min(1320, Math.max(640, usableW - 64));
    // During a stacked phone duel, the objective becomes a narrow/tall combat
    // rail beside every top-centre plate. It keeps the complete next action and
    // reward visible without laying a 69%-wide slab over the player's arena.
    const centralPlateRight = Math.max(
        header.x + header.w,
        activeBottom(boss) ? boss.x + boss.w : 0,
        activeBottom(lieutenant) ? lieutenant.x + lieutenant.w : 0,
        activeBottom(bossRush) ? bossRush.x + bossRush.w : 0,
    );
    const edgeObjectiveX = edgeCompactObjective
        ? Math.max(phoneRailLeft, centralPlateRight + Math.ceil(6 / cssScale))
        : 0;
    const edgeObjectiveY = combo.y + combo.h + 16;
    const edgeObjectiveBottom = reservedAbilityY - phoneAbilityGap;
    const allocatedObjectiveW = edgeCompactObjective
        ? Math.max(0, objectiveRight - edgeObjectiveX)
        : denseObjective ? denseObjectiveW : objectiveW;
    const allocatedObjectiveH = edgeCompactObjective
        ? Math.max(0, edgeObjectiveBottom - edgeObjectiveY)
        : denseObjective
            ? Math.max(164, reservedAbilityY - guidanceTop - 12)
            : objectiveH;
    const objective = hasObjective
        ? Object.assign(rect(
            edgeCompactObjective
                ? edgeObjectiveX
                : denseObjective
                    ? centerX - allocatedObjectiveW / 2
                    : objectiveRight - allocatedObjectiveW,
            edgeCompactObjective ? edgeObjectiveY : guidanceTop,
            allocatedObjectiveW,
            allocatedObjectiveH,
        ), {
            uiScale,
            metaPx: objectiveMetaPx,
            titlePx: objectiveTitlePx,
            bodyPx: objectiveBodyPx,
            progressPx: objectiveProgressPx,
            dense: denseObjective,
            edgeCompact: edgeCompactObjective,
            phone: phoneGuidance,
            compressed: compressedGuidance && !denseObjective,
            narrowCompressed: narrowCompressedGuidance && !denseObjective,
            centerKeepoutPx: phoneGuidance ? 40 : 0,
        })
        : rect(0, 0, 0, 0);
    if (hasObjective) {
        const pad = phoneGuidance ? Math.ceil(6 / cssScale) : 18 * uiScale;
        const barH = Math.max(7 * uiScale, 7);
        const cssGap3 = phoneGuidance ? Math.ceil(3 / cssScale) : 0;
        const cssGap6 = phoneGuidance ? Math.ceil(6 / cssScale) : 0;
        let headerY = objective.y + pad + objectiveMetaPx * 0.52;
        let titleY = objective.y + objective.h * 0.31;
        let bodyY = objective.y + objective.h * 0.47;
        let bodyLineHeight = objectiveBodyPx * 1.08;
        let bodyLines = 2;
        let footerY = objective.y + objective.h - pad - objectiveProgressPx * 0.42;
        let barY = objective.y + objective.h - pad - objectiveProgressPx
            - 12 * uiScale - barH;

        if (edgeCompactObjective) {
            headerY = objective.y + pad + objectiveMetaPx / 2;
            titleY = null;
            bodyY = headerY + objectiveMetaPx / 2 + Math.ceil(5 / cssScale);
            bodyLineHeight = objectiveBodyPx * 1.02;
            bodyLines = 4;
            footerY = objective.y + objective.h - pad - objectiveProgressPx / 2;
            barY = footerY - objectiveProgressPx / 2 - cssGap6 - barH;
        } else if (phoneGuidance) {
            headerY = objective.y + pad + objectiveMetaPx / 2;
            titleY = headerY + objectiveMetaPx / 2 + cssGap3 + objectiveTitlePx / 2;
            bodyY = titleY + objectiveTitlePx / 2 + cssGap3;
            bodyLineHeight = objectiveBodyPx * 0.96;
            bodyLines = 3;
            footerY = objective.y + objective.h - pad - objectiveProgressPx / 2;
            barY = footerY - objectiveProgressPx / 2 - cssGap6 - barH;
        } else if (denseObjective) {
            titleY = objective.y + objective.h * 0.46;
            bodyY = titleY - objectiveBodyPx * 0.58;
            bodyLineHeight = objectiveBodyPx * 1.02;
            footerY = objective.y + objective.h - objectiveProgressPx - 15 * uiScale;
            barY = objective.y + objective.h - barH - 5 * uiScale;
        } else if (compressedGuidance) {
            const gap3 = Math.ceil(3 / cssScale);
            const gap6 = Math.ceil(6 / cssScale);
            bodyLines = narrowCompressedGuidance ? 3 : 2;
            const footerTop = footerY - objectiveProgressPx / 2;
            barY = footerTop - gap6 - barH;
            const titleBottom = titleY + objectiveTitlePx / 2;
            const bodyHeight = bodyLineHeight * (bodyLines - 1) + objectiveBodyPx;
            bodyY = Math.max(
                titleBottom + gap3,
                Math.min(bodyY, barY - gap6 - bodyHeight),
            );
        }

        objective.lanes = {
            pad,
            headerY,
            titleY,
            bodyY,
            bodyLineHeight,
            bodyLines,
            footerY,
            barY,
            barH,
            bodyBarGap: barY - (bodyY + bodyLineHeight * (bodyLines - 1) + objectiveBodyPx),
            barFooterGap: footerY - objectiveProgressPx / 2 - (barY + barH),
            stackedAction: phoneGuidance,
            showTitle: !edgeCompactObjective,
            showContext: !edgeCompactObjective,
            compactPhase: edgeCompactObjective,
            compressed: compressedGuidance && !denseObjective,
            minimumGap: phoneGuidance ? cssGap6 : 0,
        };
    }
    const vigilTop = hasObjective ? activeBottom(objective, guidanceTop) : guidanceTop;
    const vigilW = 350 * uiScale;
    const vigilH = (compact ? 118 : 126) * uiScale;
    const vigil = hasVigil
        ? Object.assign(rect(right - 38 - vigilW, vigilTop, vigilW, vigilH), { uiScale })
        : rect(0, 0, 0, 0);

    const filteredAbilityCount = touchMode ? Math.max(0, abilityCount - 1) : abilityCount;
    const pipPitch = 82;
    const pipRadius = 30;
    const pipGap = pipPitch - pipRadius * 2;
    const abilityLabelMaxW = pipPitch - 10;
    const abilityW = filteredAbilityCount > 0 ? filteredAbilityCount * pipPitch - 22 + 28 : 0;
    const abilityY = reservedAbilityY;
    const abilities = Object.assign(rect(right - 28 - abilityW, abilityY, abilityW, 92), {
        pipPitch,
        pipRadius,
        pipGap,
        labelMaxW: abilityLabelMaxW,
        count: filteredAbilityCount,
    });
    const kindle = touchMode
        ? rect(0, 0, 0, 0)
        : rect(right - 328, bottom - 176, 300, 22);

    // Captions own one centered lane above the bottom control clusters. Their
    // type is independent of Combat HUD size and enforces a 16 CSS-pixel floor
    // on small landscape phones without changing world/input coordinates.
    const captionTextPx = Math.max(26, Math.ceil(16 / cssScale));
    const captionLabelPx = Math.max(18, Math.ceil(16 / cssScale));
    const captionLineHeight = Math.ceil(captionTextPx * 1.08);
    const captionPadY = Math.max(14, Math.ceil(8 / cssScale));
    const captionGap = Math.max(8, Math.ceil(4 / cssScale));
    const captionH = captionPadY * 2 + captionLabelPx + captionGap + captionLineHeight * 2;
    const captionW = Math.min(760, usableW * 0.55);
    const centeredCaptionX = centerX - captionW / 2;
    const captionX = touchMode && filteredAbilityCount > 0
        ? Math.max(left, Math.min(centeredCaptionX, abilities.x - 20 - captionW))
        : centeredCaptionX;
    const caption = Object.assign(
        rect(captionX, bottom - 170 - captionH, captionW, captionH),
        {
            textPx: captionTextPx,
            labelPx: captionLabelPx,
            lineHeight: captionLineHeight,
            padY: captionPadY,
            gap: captionGap,
            cssScale,
        },
    );

    const playerLocator = { denseEnemyThreshold: compact ? 34 : 46, lowHpThreshold: 0.48 };

    return {
        width,
        height,
        safe,
        uiScale,
        compact,
        touchMode,
        cssScale,
        header,
        command,
        threat,
        boss,
        lieutenant,
        bossRush,
        vitals,
        loadout,
        pause,
        combo,
        objective,
        vigil,
        abilities,
        kindle,
        caption,
        playerLocator,
    };
}
