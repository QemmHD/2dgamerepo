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
    const vigilTop = Math.max(
        combo.y + combo.h + 16,
        activeBottom(boss, top),
        activeBottom(lieutenant, top),
        activeBottom(bossRush, top),
    );
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
    const abilityY = touchMode ? bottom - 394 : bottom - 148;
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
        vigil,
        abilities,
        kindle,
        caption,
        playerLocator,
    };
}
