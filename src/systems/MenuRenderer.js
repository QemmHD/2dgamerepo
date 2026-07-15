// MenuRenderer — the redesigned main menu: a tab bar (Play / Skills / Loadout
// / Character / Shop / Battle Pass / Settings) over a content panel, plus the
// case-opening overlay.
//
// Stateless w.r.t. game logic: draw() reads a plain `state` snapshot (save
// data + active tab + case animation) and, as it lays out each control, pushes
// a clickable region into `this.hotspots`. Game's pointer handler walks those
// regions and dispatches the `action`/`arg` — so layout math lives in exactly
// one place (here) and is never duplicated for hit-testing.

import { roundRectPath, clamp01, easeOutCubic } from '../render/DrawUtils.js';
import { INTERNAL_WIDTH, INTERNAL_HEIGHT, DIFFICULTY, DIFFICULTY_ORDER, RUN_MODIFIERS, RUN_MODIFIER_MAX_BONUS, DEV_MODE, pactTier } from '../config/GameConfig.js';
import { rarityColor, rarityName, RARITIES } from '../content/rarities.js';
import { getRarityIcon } from '../assets/CustomIcons.js';
import { getCloakSprite } from '../assets/LpcSprites.js';
import {
    GEAR, GEAR_CATEGORIES, GEAR_CATEGORY_LABELS, gearByCategory, buffSummary,
} from '../content/gear.js';
import {
    COSMETICS, COSMETIC_LIST, COSMETIC_CATEGORIES, COSMETIC_CATEGORY_LABELS, cosmeticsByCategory, resolveAppearance, cosmeticsForAchievement, cosmeticCoinCost,
    COSMETIC_SETS, getCosmeticAcquisitionRoutes, getCosmeticSourceLabel,
    cosmeticBlueprintCost,
} from '../content/cosmetics.js';
import { buildCosmeticCollectionPage } from './CosmeticCollection.js';
import {
    CASES, CASE_ORDER, caseOddsRows, caseTopRarity, casePityRemaining,
    CASE_PITY, WAGER_BETS, CASE_ITEM_REWARD_CHANCE,
    CASE_COIN_CONSOLATION_CHANCE, casePoolSnapshot, caseTargetSnapshot,
} from './CaseSystem.js';
import { buildCosmeticCompletionSnapshot } from './CollectionCompletion.js';
import { MAPS, MAP_ORDER } from '../content/maps.js';
import { BATTLE_PASS_LEVELS, BP_MAX_LEVEL, BP_EVERFLAME_COINS, bpProgress, bpThreshold } from '../content/battlePass.js';
import { battlePassRunReceipt, rewardLabel } from './BattlePassSystem.js';
import { PERMANENT_UPGRADES, nextCost } from '../content/permanentUpgrades.js';
import { ATTUNABLE, getRelic, attuneCost } from '../content/relics.js';
import { CHARACTERS, CHARACTER_IDS, getCharacter, resolveCharacterHold } from '../content/characters.js';
import { getHeroFrames, getGlowSprite } from '../assets/ProceduralSprites.js';
import {
    applyHeroAttachmentTransform,
    heroPosePoint,
    resolveHeroPose,
} from '../assets/HeroPose.js';
import { getMenuImages } from '../assets/MenuImages.js';
import { getGearEmblem } from '../assets/GearEmblems.js';
import { getCaseArt } from '../assets/CaseArt.js';
import { DISPLAY_FONT, ensureMenuFont } from '../assets/MenuFont.js';
import { menuHotspotKey, menuHotspotLabel } from './AccessibilityBridge.js';
import {
    CAPTION_DETAIL_PRESETS,
    UI_SCALE_PRESETS,
    VIBRATION_STRENGTH_PRESETS,
    normalizeCaptionDetail,
    normalizeUiScale,
    normalizeVibrationStrength,
} from './AccessibilityPreferences.js';
import { drawPixelCloak, drawPixelFurSwatch, drawPixelHat } from '../assets/PixelArt.js';
import { getWeaponProp } from '../assets/WeaponProps.js';
import { drawAuraFx, drawSetBonus, drawRarityFx, drawTrailPoint } from '../assets/CosmeticFx.js';
import { resolveStartingWeapon } from './LoadoutSystem.js';
import { resolveWeaponSkin, resolveWeaponProp } from '../content/weaponSkins.js';
import { ACHIEVEMENTS } from '../content/achievements.js';
import { pickDailyChallenges, currentDayNumber } from '../content/dailyChallenges.js';
import { getDailySetup } from '../content/dailyRoad.js';
import { getRiteTrialSetup } from '../content/riteTrial.js';
import { BOSS_RUSH_CONFIG, getBossRushSequence, weeklyEmberSeed } from '../content/bossRush.js';
import { ritesFor, riteProgress, ritesCompletedCount } from '../content/rites.js';
import { HERO_ATTUNE_MAX, heroAttuneCost, heroAttuneRiteGate } from '../content/heroAttunement.js';
import { getRoad } from '../content/roads.js';
import { PATRONS, PATRON_IDS } from '../content/patrons.js';
import { isPhoneLandscapeViewport } from './ResponsiveLayout.js';

export { isPhoneLandscapeViewport } from './ResponsiveLayout.js';

const FONT = '-apple-system, system-ui, Helvetica, Arial, sans-serif';
// Display face (Cinzel, self-hosted OFL) for the forged headings — the
// wordmark, tab labels, and button labels — giving the menu a dark-fantasy
// identity. Body text / numeric readouts stay on FONT for legibility. Falls
// back to the system stack until the woff2 loads (and in a non-DOM env).
const HEAD = DISPLAY_FONT;
const TAU = Math.PI * 2;
const HERO_CANONICAL_SIZE = 182;
const HERO_CANONICAL_HALF = HERO_CANONICAL_SIZE / 2;

// Preview-only Boutique looks must name their real acquisition path. Keeping
// this pure makes the promise independently testable instead of burying source
// truth inside a draw branch.
export function boutiquePreviewGuidance(routes) {
    const known = new Set();
    if (routes && typeof routes[Symbol.iterator] === 'function') {
        for (const route of routes) {
            if (['case', 'achievement', 'vigil', 'boutique', 'blueprint'].includes(route)) known.add(route);
        }
    }
    if (known.size === 1 && known.has('case')) {
        return 'RANDOM DROP · every piece comes from cosmetic cases';
    }
    if (known.size === 1 && known.has('achievement')) {
        return 'Every piece unlocks through achievements';
    }
    if (known.size === 1 && known.has('vigil')) {
        return 'Every piece unlocks on the Vigil Path';
    }
    if (known.size === 1 && known.has('blueprint')) {
        return 'Every piece has a guaranteed Mythic Blueprint route';
    }
    if (known.size > 0) {
        const labels = [...known].map((route) => route === 'case'
            ? 'random cases' : route === 'achievement'
                ? 'achievements' : route === 'vigil' ? 'Vigil Path'
                    : route === 'blueprint' ? 'Mythic Blueprints' : 'the Boutique');
        return `Earn locked pieces through ${labels.join(' or ')}`;
    }
    return 'Earn this look outside the Boutique';
}

// Each tab carries an accent color so the menu reads as color-coded sections
// at a glance (the active tab tints to its own hue; inactive tabs show a thin
// accent underline). Cool→warm grouping: play/progress greens & golds, economy
// ambers, cosmetic violet, utility grey.
export const MENU_TABS = [
    { id: 'play', label: 'PLAY', accent: '#5fd36a' },
    { id: 'modes', label: 'MODES', accent: '#ff6a4a' },
    { id: 'skills', label: 'SKILLS', accent: '#7fd0ff' },
    { id: 'attune', label: 'ATTUNE', accent: '#ff9ecf' },
    { id: 'loadout', label: 'LOADOUT', accent: '#ffce54' },
    { id: 'character', label: 'CHARACTER', accent: '#c08bff' },
    { id: 'shop', label: 'SHOP', accent: '#ff9a4a' },
    { id: 'boutique', label: 'BOUTIQUE', accent: '#ff7edb' },
    { id: 'battlepass', label: 'BATTLE PASS', accent: '#ff5a8a' },
    { id: 'stats', label: 'STATS', accent: '#a8d5f7' },
    { id: 'settings', label: 'SETTINGS', accent: '#9fb0c4' },
];

// App-like navigation: the flat tab list is presented as SECTIONS — a top bar
// of groups, with a sub-tab pill row when the active group has more than one
// screen. menuTab stays the single source of truth (every tab id above still
// exists and is reachable), so the guided tour, markTabSeen/"NEW" badges, and
// every 'tab' action work unchanged; only the presentation is grouped.
export const MENU_GROUPS = [
    { id: 'gPlay', label: 'PLAY', accent: '#5fd36a', tabs: ['play', 'modes'] },
    { id: 'gHero', label: 'HERO', accent: '#c08bff', tabs: ['character', 'attune'] },
    { id: 'gArmory', label: 'ARMORY', accent: '#7fd0ff', tabs: ['skills', 'loadout'] },
    { id: 'gShop', label: 'SHOP', accent: '#ff9a4a', tabs: ['shop', 'boutique'] },
    { id: 'gProgress', label: 'PROGRESS', accent: '#ff5a8a', tabs: ['battlepass', 'stats'] },
    { id: 'gSettings', label: 'SETTINGS', accent: '#9fb0c4', tabs: ['settings'] },
];

// One-line plain-English description per screen — drawn in the header strip so
// every screen says what it IS (the tour teaches once; this stays forever).
export const TAB_DESCRIPTIONS = {
    play: 'Pick your hero, biome and difficulty — then START RUN.',
    modes: 'Special ways to play: daily and weekly challenges with their own records.',
    skills: 'Permanent upgrades bought with run coins — they apply to every future run.',
    loadout: 'Gear won from cases, worn in four slots — each piece is a small permanent bonus.',
    attune: 'Spend coins to strengthen discovered relics and each hero’s gifts.',
    character: 'Choose who you play and dress them up — looks are cosmetic only.',
    shop: 'Spend run coins only — no real money. Cosmetic cases favor unowned drops.',
    boutique: 'Try looks on before you buy — single pieces or whole themed sets.',
    battlepass: 'The free reward track — every valid finished run earns progress.',
    stats: 'Your lifetime records, bests and achievements.',
    settings: 'Options, accessibility and save management.',
};

// Staged menu unlock: a brand-new player sees only PLAY + SETTINGS instead of
// a 9-tab dump; the rest unlock at their natural first-use moments (computed
// from live save stats, so a veteran save unlocks everything instantly and
// nothing is ever re-locked). Newly unlocked tabs wear a one-time "NEW" badge
// until first opened (save.onboarding.tabsSeen, marked by Game's tab action).
export function tabUnlocked(id, save) {
    // Once SEEN, forever unlocked — this is what actually guarantees "nothing
    // is ever re-locked": pre-staging saves (runs > 0) are seeded with every
    // tab seen (SaveSystem._validate), so a veteran with zero casesOpened /
    // relics / totalCoinsEarned keeps the tabs that were already visible.
    if (save?.onboarding?.tabsSeen?.includes(id)) return true;
    const s = (save && save.stats) || {};
    switch (id) {
        case 'play':
        case 'settings':
        // The SHOP is part of the base menu from the first boot — new players
        // arrive with a 2,000-coin stake, so the case shop is immediately
        // relevant (and the guided tour walks them through it). The BOUTIQUE
        // rides with it: try-on costs nothing, and the stake can buy a look.
        case 'shop':
        case 'boutique': return true;
        // First coins banked — spendable balance counts too, so a payout that
        // bypasses the lifetime stat can never leave a coin-holder tab-less.
        case 'skills': return (s.totalCoinsEarned ?? 0) > 0 || (save?.totalCoins ?? 0) > 0;
        // Modes hold the daily/weekly challenges — they mean nothing before the
        // first finished run (same gate as stats/battlepass).
        case 'modes': return (s.runs ?? 0) >= 1;
        case 'loadout': return (s.casesOpened ?? 0) > 0;                  // first gear case opened
        case 'attune': return (save?.discoveredRelics?.length ?? 0) > 0;  // first relic claimed
        case 'character':
        case 'battlepass':
        case 'stats': return (s.runs ?? 0) >= 1;                          // first run finished
        default: return true;
    }
}

// Count only ids that belong to today's deterministic selection. A deployment
// can change the selector while a player still has same-day completions from
// the prior build; stale ids must not make the new set appear complete.
export function completedDailyCount(daily, day, picked = pickDailyChallenges(day)) {
    if (!daily || daily.day !== day || !Array.isArray(daily.completed)) return 0;
    return [...new Set(daily.completed)].reduce((count, id) =>
        count + (picked.some((challenge) => challenge.id === id) ? 1 : 0), 0);
}

// Dev tooling gate: the Debug/Unlock-Maps toggles and the CHEATS panel are
// developer aids, not player features — they only render in DEV_MODE (?dev=1;
// see GameConfig.js, which also gates the debug HUD + time-jump keys).

// Per-upgrade visual identity for the FORGE TRAINING grid: a fixed hue + a
// small vector glyph (drawn by _skillGlyph) so each discipline reads at a
// glance. Keyed by the stable save ids in PERMANENT_UPGRADES.
const SKILL_STYLE = {
    maxHp:         { col: '#ff7a7a', glyph: 'heart' },
    damage:        { col: '#ff9a4a', glyph: 'flame' },
    moveSpeed:     { col: '#6ad8ff', glyph: 'chevrons' },
    critChance:    { col: '#ffd479', glyph: 'crosshair' },
    xpGain:        { col: '#b9f27a', glyph: 'star' },
    pickupRange:   { col: '#7fd0ff', glyph: 'glow' },
    startingCoins: { col: '#ffd86b', glyph: 'coins' },
    rerolls:       { col: '#c08bff', glyph: 'cycle' },
    banish:        { col: '#ff5a8a', glyph: 'ban' },
};

const SETTING_TOGGLES = [
    { key: 'debug', label: 'Debug Mode', dev: true },
    { key: 'screenShake', label: 'Screen Shake' },
    { key: 'damageNumbers', label: 'Damage Numbers' },
    { key: 'particles', label: 'Particles' },
    { key: 'reducedEffects', label: 'Reduce Motion & Effects' },
    { key: 'unlockMaps', label: 'Unlock All Maps (testing)', dev: true },
];

export function phoneToggleLabelLines(toggle) {
    if (toggle.key === 'damageNumbers') return ['Damage', 'Numbers'];
    if (toggle.key === 'reducedEffects') return ['Reduce Motion', '& Effects'];
    if (toggle.key === 'highContrast') return ['High Contrast', 'Warnings'];
    if (toggle.key === 'debug') return ['Debug', 'Mode'];
    if (toggle.key === 'unlockMaps') return ['Unlock', 'Maps'];
    return [toggle.label];
}

// Phone Settings use the wide internal canvas created by cover-fit rendering,
// but every useful dimension must survive the roughly 0.44 CSS scale of a
// landscape phone. Keeping this math pure makes the no-overlap and 44px-touch
// guarantees independently testable without needing a canvas or DOM.
export function computePhoneSettingsLayout(content, options = {}) {
    const devToggleCount = Math.max(0, Math.min(2, Math.trunc(options.devToggleCount || 0)));
    const showCheats = options.showCheats === true;
    const cssScale = Number.isFinite(options.cssScale) && options.cssScale > 0
        ? options.cssScale : 1;
    const pad = 28;
    const colGap = 24;
    // 44 CSS px is the touch-floor. At 844px this becomes 101 logical px;
    // at the supported 667px-wide phone it becomes 127 logical px.
    const rowH = Math.max(100, Math.ceil(44 / cssScale));
    const rowGap = 2;
    const inner = {
        x: content.x + pad,
        y: content.y + pad,
        w: content.w - pad * 2,
        h: content.h - pad * 2,
    };
    const columnsW = inner.w - colGap * 2;
    const gameplayW = Math.round(columnsW * 0.35);
    const audioW = Math.round(columnsW * 0.37);
    const supportW = columnsW - gameplayW - audioW;
    const columns = {
        gameplay: { x: inner.x, y: inner.y, w: gameplayW, h: inner.h },
        audio: { x: inner.x + gameplayW + colGap, y: inner.y, w: audioW, h: inner.h },
        support: { x: inner.x + gameplayW + audioW + colGap * 2, y: inner.y, w: supportW, h: inner.h },
    };

    const headerY = inner.y + 32;
    const bodyTop = inner.y + 52;
    const cheatButtonY = showCheats ? inner.y + inner.h - rowH : null;
    const cheatHeaderY = showCheats ? cheatButtonY - 10 : null;
    const bodyBottom = showCheats ? cheatHeaderY - 30 : inner.y + inner.h;
    const coreFontPx = Math.max(36, Math.ceil(16 / cssScale));
    const sectionFontPx = Math.max(32, Math.ceil(13 / cssScale));
    const statusFontPx = Math.max(26, Math.ceil(12 / cssScale));
    const coreLineHeight = Math.round(coreFontPx * 0.92);
    const switchH = Math.max(84, rowH - 8);
    const switchW = Math.max(150, Math.round(switchH * 1.65));
    const rowsFor = (column, count) => Array.from({ length: count }, (_, i) => ({
        x: column.x,
        y: bodyTop + i * (rowH + rowGap),
        w: column.w,
        h: rowH,
    }));

    const audioGap = 2;
    const audioBlocks = [0, 1, 2].map((i) => ({
        x: columns.audio.x,
        y: bodyTop + i * (rowH + audioGap),
        w: columns.audio.w,
        h: rowH,
    }));
    const volumeControls = audioBlocks.map((block) => {
        const buttonW = rowH;
        const percentW = 72;
        const labelW = Math.max(118, Math.round(block.w * 0.20));
        const controlY = block.y;
        const minus = { x: block.x + labelW, y: controlY, w: buttonW, h: rowH };
        const plus = { x: block.x + block.w - percentW - buttonW, y: controlY, w: buttonW, h: rowH };
        return {
            minus,
            plus,
            label: { x: block.x, y: controlY, w: labelW, h: rowH },
            bar: { x: minus.x + buttonW + 12, y: controlY + rowH / 2 - 10, w: plus.x - minus.x - buttonW - 24, h: 20 },
            percent: { x: plus.x + plus.w, y: controlY, w: percentW, h: rowH },
        };
    });

    let cheatButtons = [];
    if (showCheats) {
        const gap = 18;
        const w = (inner.w - gap * 2) / 3;
        cheatButtons = Array.from({ length: 3 }, (_, i) => ({
            x: inner.x + i * (w + gap), y: cheatButtonY, w, h: rowH,
        }));
    }

    return {
        inner, columns, headerY, bodyTop, bodyBottom, rowH, rowGap,
        cssScale, coreFontPx, sectionFontPx, statusFontPx, coreLineHeight,
        switchH, switchW,
        labelWidths: {
            gameplay: columns.gameplay.w - switchW - 30,
            support: columns.support.w - switchW - 30,
        },
        gameplayRows: rowsFor(columns.gameplay, 4),
        supportRows: rowsFor(columns.support, 2 + devToggleCount),
        audioBlocks, volumeControls, cheatHeaderY, cheatButtons,
    };
}

// Accessibility is a second Settings pane rather than another row in the
// already-full phone General layout. This keeps every target at least 44 CSS px
// at the supported 667px landscape width while leaving the ?dev=1 controls and
// cheats untouched on General.
export function computePhoneAccessibilityLayout(content, options = {}) {
    const cssScale = Number.isFinite(options.cssScale) && options.cssScale > 0
        ? options.cssScale : 1;
    const pad = 28;
    const colGap = 24;
    const rowGap = 10;
    const rowH = Math.max(100, Math.ceil(44 / cssScale));
    const inner = {
        x: content.x + pad,
        y: content.y + pad,
        w: content.w - pad * 2,
        h: content.h - pad * 2,
    };
    const availableW = inner.w - colGap;
    const displayW = Math.round(availableW * 0.58);
    const columns = {
        display: { x: inner.x, y: inner.y, w: displayW, h: inner.h },
        support: {
            x: inner.x + displayW + colGap,
            y: inner.y,
            w: availableW - displayW,
            h: inner.h,
        },
    };
    const headerY = inner.y + 32;
    const bodyTop = inner.y + 70;
    const coreFontPx = Math.max(36, Math.ceil(16 / cssScale));
    const sectionFontPx = Math.max(32, Math.ceil(13 / cssScale));
    const statusFontPx = Math.max(26, Math.ceil(12 / cssScale));
    const coreLineHeight = Math.round(coreFontPx * 0.92);
    const switchH = Math.max(84, rowH - 8);
    const switchW = Math.max(150, Math.round(switchH * 1.65));
    const rowsFor = (column) => Array.from({ length: 4 }, (_, i) => ({
        x: column.x,
        y: bodyTop + i * (rowH + rowGap),
        w: column.w,
        h: rowH,
    }));
    const displayRows = rowsFor(columns.display);
    const supportRows = rowsFor(columns.support);
    const captionRow = displayRows[0];
    const detailGap = 10;
    const detailW = (displayRows[1].w - detailGap) / 2;
    const detailButtons = CAPTION_DETAIL_PRESETS.map((value, i) => ({
        value,
        x: displayRows[1].x + i * (detailW + detailGap),
        y: displayRows[1].y,
        w: detailW,
        h: rowH,
    }));
    const contrastRow = displayRows[2];
    const scaleGap = 10;
    const scaleW = (displayRows[3].w - scaleGap * (UI_SCALE_PRESETS.length - 1))
        / UI_SCALE_PRESETS.length;
    const scaleButtons = UI_SCALE_PRESETS.map((value, i) => ({
        value,
        x: displayRows[3].x + i * (scaleW + scaleGap),
        y: displayRows[3].y,
        w: scaleW,
        h: rowH,
    }));
    const monoRow = supportRows[0];
    const vibrationGap = 8;
    const vibrationW = (supportRows[1].w - vibrationGap * 2) / 3;
    const vibrationButtons = VIBRATION_STRENGTH_PRESETS.map((value, i) => ({
        value,
        x: supportRows[1].x + i * (vibrationW + vibrationGap),
        y: supportRows[1].y,
        w: vibrationW,
        h: rowH,
    }));
    const replay = supportRows[2];
    const back = supportRows[3];

    return {
        inner, columns, headerY, bodyTop, rowH, rowGap, cssScale,
        coreFontPx, sectionFontPx, statusFontPx, coreLineHeight,
        switchH, switchW, displayRows, supportRows, captionRow, detailButtons,
        contrastRow, scaleButtons, monoRow, vibrationButtons, replay, back,
        labelWidth: columns.display.w - switchW - 30,
        supportLabelWidth: columns.support.w - switchW - 30,
    };
}

function segmentedRects(rect, count, gap = 8) {
    const safeCount = Math.max(1, Math.trunc(count || 0));
    const segmentW = (rect.w - gap * (safeCount - 1)) / safeCount;
    return Array.from({ length: safeCount }, (_, index) => ({
        x: rect.x + index * (segmentW + gap),
        y: rect.y,
        w: segmentW,
        h: rect.h,
    }));
}

export function computePhoneSectionBarLayout(safeArea = {}, cssScale = 1) {
    const scale = Number.isFinite(cssScale) && cssScale > 0 ? cssScale : 1;
    const left = Number.isFinite(safeArea.left) ? safeArea.left : 0;
    const top = Number.isFinite(safeArea.top) ? safeArea.top : 0;
    const h = Math.max(100, Math.ceil(44 / scale));
    const homeW = Math.max(120, h);
    const gap = 12;
    const tabW = 210;
    const y = top + 104;
    const home = { x: left + 56, y, w: homeW, h };
    const firstTabX = home.x + home.w + 14;
    const rawMinTouchCss = Math.min(home.w, home.h, tabW, h) * scale;
    return {
        phone: true,
        cssScale: scale,
        y,
        h,
        home,
        homeW,
        firstTabX,
        tabW,
        gap,
        subRowH: h - 62,
        minTouchCss: Math.round(rawMinTouchCss * 10) / 10,
        touchSafe: rawMinTouchCss >= 44,
        fontPx: Math.max(32, Math.ceil(13 / scale)),
    };
}

// Landscape phones keep the authored 1920x1080 coordinate system. The rich
// layout retains the live-look rail on canonical phones; compact mode uses the
// full width and cycle controls so short/narrow phones keep eight cards and all
// three filters without shrinking any action below 44 CSS pixels.
export function computePhoneCharacterCollectionLayout(content, options = {}) {
    const cssScale = Number.isFinite(options.cssScale) && options.cssScale > 0
        ? options.cssScale : 1;
    const compact = options.compact === true;
    const touchH = Math.max(100, Math.ceil(44 / cssScale));
    const edge = 8;
    const paneGap = 18;
    const previewW = compact ? 0
        : Math.max(270, Math.min(330, Math.round(content.w * 0.17)));
    const preview = compact ? null
        : { x: content.x, y: content.y, w: previewW, h: content.h };
    const collection = compact ? { ...content } : {
        x: content.x + previewW + paneGap, y: content.y,
        w: content.w - previewW - paneGap, h: content.h,
    };
    const inner = {
        x: collection.x + edge,
        y: collection.y + edge,
        w: collection.w - edge * 2,
        h: collection.h - edge * 2,
    };
    const rowGap = 6;
    const compactControls = compact
        ? segmentedRects({ x: inner.x, y: inner.y, w: inner.w, h: touchH }, 5, 8)
        : [];
    const categoryRow = compact ? compactControls[0]
        : { x: inner.x, y: inner.y, w: inner.w, h: touchH };
    const filterY = categoryRow.y + categoryRow.h + rowGap;
    const splitGap = 10;
    const ownershipW = compact ? 0 : Math.round((inner.w - splitGap) * 0.34);
    const ownershipRow = compact ? compactControls[1] : {
        x: inner.x, y: filterY, w: ownershipW, h: touchH,
    };
    const sourceRow = compact ? compactControls[2] : {
        x: inner.x + ownershipW + splitGap, y: filterY,
        w: inner.w - ownershipW - splitGap, h: touchH,
    };
    const completionButton = compact ? compactControls[3] : null;
    const ritesButton = compact ? compactControls[4] : null;
    const footer = {
        x: inner.x,
        y: collection.y + collection.h - edge - touchH,
        w: inner.w,
        h: touchH,
    };
    const gridTop = compact
        ? inner.y + touchH + rowGap
        : filterY + touchH + 6;
    const grid = {
        x: inner.x,
        y: gridTop,
        w: inner.w,
        h: Math.max(1, footer.y - 6 - gridTop),
    };
    const cardGap = 6;
    const cols = 4;
    const rows = 2;
    const cardW = (grid.w - cardGap * (cols - 1)) / cols;
    const cardH = (grid.h - cardGap * (rows - 1)) / rows;
    const cards = Array.from({ length: 8 }, (_, index) => ({
        x: grid.x + (index % cols) * (cardW + cardGap),
        y: grid.y + Math.floor(index / cols) * (cardH + cardGap),
        w: cardW,
        h: cardH,
    }));
    const pagerW = Math.max(180, Math.round(touchH * 1.5));
    const previousButton = { x: footer.x, y: footer.y, w: pagerW, h: touchH };
    const nextButton = {
        x: footer.x + footer.w - pagerW,
        y: footer.y,
        w: pagerW,
        h: touchH,
    };
    const previewButtonGap = 8;
    const previewButtonW = compact ? 0
        : (preview.w - edge * 2 - previewButtonGap) / 2;
    const richCompletionButton = compact ? null : {
        x: preview.x + edge, y: preview.y + preview.h - edge - touchH,
        w: previewButtonW, h: touchH,
    };
    const attuneButton = compact ? ritesButton : {
        x: richCompletionButton.x + richCompletionButton.w + previewButtonGap,
        y: richCompletionButton.y,
        w: previewButtonW, h: touchH,
    };
    const resolvedCompletionButton = compact ? completionButton : richCompletionButton;
    const avatarRadius = compact ? 0
        : Math.max(62, Math.min(92, preview.w * 0.29, preview.h * 0.13));
    const avatar = compact ? null : {
        x: preview.x + preview.w / 2,
        y: preview.y + Math.max(avatarRadius + 18, preview.h * 0.19),
        r: avatarRadius,
    };
    const nameY = compact ? 0 : avatar.y + avatar.r + 38;
    const metaY = compact ? 0 : nameY + Math.max(30, Math.ceil(12 / cssScale) + 6);
    const slotTop = compact ? 0 : metaY + 16;
    const slotGap = 6;
    const slotH = compact ? 0
        : Math.max(20, (attuneButton.y - 12 - slotTop - slotGap * 4) / 5);
    const previewSlots = compact ? [] : Array.from({ length: 5 }, (_, index) => ({
        x: preview.x + edge, y: slotTop + index * (slotH + slotGap),
        w: preview.w - edge * 2, h: slotH,
    }));
    const previewSwatches = previewSlots.map((rect) => {
        const size = Math.max(0, Math.min(52, rect.h - 10));
        return { x: rect.x + 7, y: rect.y + (rect.h - size) / 2, w: size, h: size };
    });

    const categorySegments = compact ? [categoryRow] : segmentedRects(categoryRow, 5, 8);
    const ownershipSegments = compact ? [ownershipRow] : segmentedRects(ownershipRow, 3, 8);
    const sourceSegments = compact ? [sourceRow] : segmentedRects(sourceRow, 7, 8);
    const touchRects = [
        ...categorySegments, ...ownershipSegments, ...sourceSegments,
        ...cards, previousButton, nextButton, resolvedCompletionButton, attuneButton,
    ];
    const rawMinTouchCss = Math.min(...touchRects.map((rect) =>
        Math.min(rect.w, rect.h) * cssScale));
    const geometrySafe = content.w > 0 && content.h > 0
        && inner.w > 0 && inner.h > 0 && grid.h > 0 && cardW > 0 && cardH > 0
        && touchRects.every((rect) => Number.isFinite(rect.x + rect.y + rect.w + rect.h)
            && rect.w > 0 && rect.h > 0
            && rect.x >= content.x && rect.y >= content.y
            && rect.x + rect.w <= content.x + content.w + 0.001
            && rect.y + rect.h <= content.y + content.h + 0.001);
    const minTouchCss = Math.round(rawMinTouchCss * 10) / 10;
    const footerFontPx = Math.max(30, Math.ceil(12 / cssScale));
    const trackingFontPx = Math.max(26, Math.ceil(10 / cssScale));
    const footerSummaryY = footer.y + footer.h * 0.32;
    const footerTrackingY = footer.y + footer.h * 0.72;
    const footerLineClearanceCss = ((footerTrackingY - footerSummaryY)
        - (footerFontPx + trackingFontPx) * 0.5) * cssScale;
    return {
        phone: true,
        compact,
        variant: compact ? 'compact' : 'rich',
        cssScale,
        touchH,
        minTouchCss,
        touchSafe: geometrySafe && rawMinTouchCss >= 44,
        preview,
        collection,
        inner,
        categoryRow,
        ownershipRow,
        sourceRow,
        categorySegments,
        ownershipSegments,
        sourceSegments,
        compactControls,
        completionButton: resolvedCompletionButton,
        ritesButton,
        grid,
        cards,
        footer,
        previousButton,
        nextButton,
        attuneButton,
        avatar,
        nameY,
        metaY,
        previewSlots,
        previewSwatches,
        categoryFontPx: Math.max(32, Math.ceil(13 / cssScale)),
        filterFontPx: Math.max(30, Math.ceil(12 / cssScale)),
        cardTitleFontPx: Math.max(34, Math.ceil(14 / cssScale)),
        cardMetaFontPx: Math.max(28, Math.ceil(11 / cssScale)),
        footerFontPx,
        trackingFontPx,
        footerSummaryY,
        footerTrackingY,
        footerLineClearanceCss,
        previewNameFontPx: Math.max(34, Math.ceil(14 / cssScale)),
        previewMetaFontPx: Math.max(28, Math.ceil(11 / cssScale)),
        previewSlotFontPx: Math.max(26, Math.ceil(11 / cssScale)),
        buttonFontPx: Math.max(32, Math.ceil(13 / cssScale)),
    };
}

// Phone-only Character sub-pane: one back target, three readable Rite cards,
// and a dedicated hero-attunement card. The only purchase surface is sized by
// the same CSS-pixel floor used everywhere else in the phone collection.
export function computePhoneHeroRitesLayout(content, options = {}) {
    const cssScale = Number.isFinite(options.cssScale) && options.cssScale > 0
        ? options.cssScale : 1;
    const touchH = Math.max(100, Math.ceil(44 / cssScale));
    const edge = 8;
    const gap = 8;
    const inner = {
        x: content.x + edge, y: content.y + edge,
        w: content.w - edge * 2, h: content.h - edge * 2,
    };
    const header = { x: inner.x, y: inner.y, w: inner.w, h: touchH };
    const backButton = {
        x: header.x, y: header.y,
        w: Math.min(header.w, Math.max(240, Math.round(touchH * 1.55))), h: touchH,
    };
    const body = {
        x: inner.x, y: header.y + header.h + gap, w: inner.w,
        h: Math.max(1, inner.y + inner.h - (header.y + header.h + gap)),
    };
    const cardW = (body.w - gap * 3) / 4;
    const allCards = Array.from({ length: 4 }, (_, index) => ({
        x: body.x + index * (cardW + gap), y: body.y, w: cardW, h: body.h,
    }));
    const riteCards = allCards.slice(0, 3);
    const attunementCard = allCards[3];
    const purchaseButton = {
        x: attunementCard.x + gap,
        y: attunementCard.y + attunementCard.h - gap - touchH,
        w: attunementCard.w - gap * 2,
        h: touchH,
    };
    const touchRects = [backButton, purchaseButton];
    const rawMinTouchCss = Math.min(...touchRects.map((rect) =>
        Math.min(rect.w, rect.h) * cssScale));
    const geometrySafe = body.h > touchH + gap * 2 && cardW > 0
        && allCards.every((rect) => Number.isFinite(rect.x + rect.y + rect.w + rect.h)
            && rect.w > 0 && rect.h > 0
            && rect.x >= content.x && rect.y >= content.y
            && rect.x + rect.w <= content.x + content.w + 0.001
            && rect.y + rect.h <= content.y + content.h + 0.001);
    return {
        phone: true,
        cssScale,
        touchH,
        minTouchCss: Math.round(rawMinTouchCss * 10) / 10,
        touchSafe: geometrySafe && rawMinTouchCss >= 44,
        inner,
        header,
        backButton,
        body,
        riteCards,
        attunementCard,
        purchaseButton,
        titleFontPx: Math.max(34, Math.ceil(14 / cssScale)),
        cardTitleFontPx: Math.max(32, Math.ceil(13 / cssScale)),
        bodyFontPx: Math.max(28, Math.ceil(11 / cssScale)),
        smallFontPx: Math.max(26, Math.ceil(10 / cssScale)),
        buttonFontPx: Math.max(32, Math.ceil(13 / cssScale)),
    };
}

// Collection Completion is a nested Character surface, not another global
// menu tab. The same geometry authority drives its painted controls and its
// touch receipts so every registered phone hotspot remains at least 44 CSS px.
export function computePhoneCollectionCompletionLayout(content, options = {}) {
    const cssScale = Number.isFinite(options.cssScale) && options.cssScale > 0
        ? options.cssScale : 1;
    const phone = options.phone !== false;
    const section = ['overview', 'sets', 'sources', 'blueprint', 'case']
        .includes(options.section) ? options.section : 'overview';
    const touchH = phone ? Math.max(100, Math.ceil(44 / cssScale)) : 54;
    const edge = phone ? 8 : 16;
    const gap = phone ? 8 : 12;
    const inner = {
        x: content.x + edge, y: content.y + edge,
        w: content.w - edge * 2, h: content.h - edge * 2,
    };
    const header = { x: inner.x, y: inner.y, w: inner.w, h: touchH };
    const backButton = {
        x: header.x, y: header.y,
        w: Math.min(header.w, Math.max(phone ? 240 : 180, touchH * 1.5)), h: touchH,
    };
    const tabs = {
        x: inner.x, y: header.y + header.h + gap, w: inner.w, h: touchH,
    };
    const tabRects = segmentedRects(tabs, 5, gap);
    const body = {
        x: inner.x, y: tabs.y + tabs.h + gap, w: inner.w,
        h: Math.max(1, inner.y + inner.h - (tabs.y + tabs.h + gap)),
    };

    const pager = {
        x: body.x, y: body.y + body.h - touchH, w: body.w, h: touchH,
    };
    const pagerW = Math.min(pager.w * 0.24, Math.max(220, touchH * 1.7));
    const previousButton = { x: pager.x, y: pager.y, w: pagerW, h: touchH };
    const nextButton = {
        x: pager.x + pager.w - pagerW, y: pager.y, w: pagerW, h: touchH,
    };
    const setGrid = {
        x: body.x, y: body.y, w: body.w,
        h: Math.max(1, pager.y - gap - body.y),
    };

    const selectorW = Math.max(phone ? 330 : 360, Math.round(body.w * (phone ? 0.27 : 0.24)));
    const blueprintSelectorGap = phone
        ? Math.min(gap, Math.max(4, body.h - 88 / cssScale))
        : gap;
    const blueprintSelectors = Array.from({ length: 2 }, (_, index) => ({
        x: body.x,
        y: body.y + index * ((body.h - blueprintSelectorGap) / 2 + blueprintSelectorGap),
        w: selectorW,
        h: (body.h - blueprintSelectorGap) / 2,
    }));
    const blueprintDetail = {
        x: body.x + selectorW + gap, y: body.y,
        w: Math.max(1, body.w - selectorW - gap), h: body.h,
    };
    const detailActionY = blueprintDetail.y + blueprintDetail.h - touchH;
    const caseTruthW = Math.max(phone ? 280 : 220, blueprintDetail.w * 0.29);
    const caseTruthButton = {
        x: blueprintDetail.x, y: detailActionY,
        w: Math.min(blueprintDetail.w, caseTruthW), h: touchH,
    };
    const purchaseButton = {
        x: caseTruthButton.x + caseTruthButton.w + gap, y: detailActionY,
        w: Math.max(1, blueprintDetail.x + blueprintDetail.w
            - (caseTruthButton.x + caseTruthButton.w + gap)),
        h: touchH,
    };
    const blueprintCopy = {
        x: blueprintDetail.x,
        y: blueprintDetail.y,
        w: blueprintDetail.w,
        h: Math.max(1, detailActionY - gap - blueprintDetail.y),
    };
    const compactBlueprint = phone && blueprintCopy.h * cssScale < 72;

    const touchRects = [backButton, ...tabRects];
    if (section === 'sets') touchRects.push(previousButton, nextButton);
    if (section === 'blueprint') {
        touchRects.push(...blueprintSelectors, caseTruthButton, purchaseButton);
    }
    const rawMinTouchCss = Math.min(...touchRects.map((rect) =>
        Math.min(rect.w, rect.h) * cssScale));
    const contained = touchRects.every((rect) =>
        Number.isFinite(rect.x + rect.y + rect.w + rect.h)
        && rect.w > 0 && rect.h > 0
        && rect.x >= content.x && rect.y >= content.y
        && rect.x + rect.w <= content.x + content.w + 0.001
        && rect.y + rect.h <= content.y + content.h + 0.001);
    const nonOverlapping = touchRects.every((rect, index) => touchRects
        .slice(index + 1).every((other) => rect.x + rect.w <= other.x + 0.001
            || other.x + other.w <= rect.x + 0.001
            || rect.y + rect.h <= other.y + 0.001
            || other.y + other.h <= rect.y + 0.001));
    const geometrySafe = inner.w > 0 && inner.h > 0 && body.w > 0
        && body.h > touchH && contained && nonOverlapping;
    return {
        phone,
        section,
        cssScale,
        touchH,
        minTouchCss: Math.round(rawMinTouchCss * 10) / 10,
        touchSafe: geometrySafe && (!phone || rawMinTouchCss >= 44),
        geometrySafe,
        contained,
        nonOverlapping,
        inner,
        header,
        backButton,
        tabs,
        tabRects,
        body,
        pager,
        previousButton,
        nextButton,
        setGrid,
        blueprintSelectors,
        blueprintDetail,
        blueprintCopy,
        compactBlueprint,
        caseTruthButton,
        purchaseButton,
        gap,
        titleFontPx: phone ? Math.max(34, Math.ceil(14 / cssScale)) : 22,
        bodyFontPx: phone ? Math.max(28, Math.ceil(11 / cssScale)) : 15,
        smallFontPx: phone ? Math.max(24, Math.ceil(9 / cssScale)) : 12,
        buttonFontPx: phone ? Math.max(30, Math.ceil(12 / cssScale)) : 14,
    };
}

// A deterministic planted wake around the fitting-room pedestal. The points
// are fed into the same drawTrailPoint renderer used by Player, so bespoke
// trail silhouettes (candles, sparks, runes, paws, etc.) remain truthful.
export function boutiqueTrailPreviewPoints(cx, groundY, avatarRadius) {
    const b = Math.max(7, Math.round(avatarRadius * 0.11));
    return [
        { x: cx - avatarRadius * 1.12, y: groundY + avatarRadius * 0.10, b: b * 0.72, k: 0.48, alpha: 0.28, index: 0 },
        { x: cx - avatarRadius * 0.70, y: groundY + avatarRadius * 0.24, b: b * 0.84, k: 0.64, alpha: 0.34, index: 1 },
        { x: cx + avatarRadius * 0.62, y: groundY + avatarRadius * 0.24, b: b * 0.96, k: 0.82, alpha: 0.40, index: 2 },
        { x: cx + avatarRadius * 1.08, y: groundY + avatarRadius * 0.08, b, k: 1, alpha: 0.46, index: 3 },
    ];
}

export class MenuRenderer {
    constructor(renderer) {
        this.renderer = renderer;
        this.hotspots = [];
        this._lastCollectionPhoneLayout = false;
        this._lastCollectionTouchSafe = false;
        this._lastCollectionMinTouchCss = 0;
        this._lastCollectionPursuitGuidance = false;
        this._lastCollectionNavTouchSafe = false;
        this._lastCollectionNavMinTouchCss = 0;
        this._lastCollectionRuntime = null;
        this._lastCharacterPhonePane = null;
        this._lastCharacterPhonePaneTouchSafe = false;
        this._lastCharacterPhonePaneMinTouchCss = 0;
        this._lastCollectionCompletionRendered = false;
        this._lastCollectionCompletionSection = '';
        this._lastCollectionCompletionTouchSafe = false;
        this._lastCollectionCompletionMinTouchCss = 0;
        this._lastCollectionCompletionModel = null;
        this._lastCollectionCompletionTextSafe = false;
        this._lastCollectionCompletionCaseTruth = null;
        this._lastBoutiqueTrailPreview = false;
    }

    _sa() { return this.renderer.safeArea; }
    _hot(x, y, w, h, action, arg, label = '') {
        const baseKey = menuHotspotKey(action, arg, 0).replace(/#0$/, '');
        const occurrence = this.hotspots.reduce((count, hotspot) => count + (hotspot.baseKey === baseKey ? 1 : 0), 0);
        this.hotspots.push({
            x, y, w, h, action, arg,
            baseKey,
            key: menuHotspotKey(action, arg, occurrence),
            label: menuHotspotLabel(action, arg, label),
        });
    }

    // Clamped frame delta (seconds), used to damp the sliding tab indicator.
    // Snaps (via _tabStale) when the menu was off-screen for a beat so the
    // indicator doesn't fling across on the first frame back.
    _dt() {
        const t = this._clockT || 0;
        const prev = this._tPrev == null ? t : this._tPrev;
        let dt = t - prev;
        this._tabStale = this._reducedMotion || dt > 0.2 || dt < 0;
        this._tPrev = t;
        if (this._reducedMotion) return 0;
        return Math.max(0, Math.min(0.05, dt));
    }

    // ── Atmospheric backdrop ("ember forge") ───────────────────────────────
    // A dark→ember sky (cached), a low breathing hearth bloom, drifting embers,
    // a rare shooting-ember, and a cached vignette. Everything static is
    // rasterized once; motion is a handful of shared cached-glow blits in ONE
    // additive pass — cheaper than the old per-frame title/tab/START shadowBlur.
    _ensureBackdropCaches() {
        if (this._skyCache) return;
        const W = INTERNAL_WIDTH, H = INTERNAL_HEIGHT;
        const sky = document.createElement('canvas'); sky.width = W; sky.height = H;
        const sc = sky.getContext('2d');
        const g = sc.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#07090e'); g.addColorStop(0.42, '#0d0b12');
        g.addColorStop(0.72, '#1a0f10'); g.addColorStop(0.90, '#3a1608');
        g.addColorStop(1, '#0f0806');
        sc.fillStyle = g; sc.fillRect(0, 0, W, H);
        this._skyCache = sky;
        const vig = document.createElement('canvas'); vig.width = W; vig.height = H;
        const vc = vig.getContext('2d');
        const rg = vc.createRadialGradient(W / 2, H / 2, 140, W / 2, H / 2, W * 0.62);
        rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(0.7, 'rgba(0,0,0,0)');
        rg.addColorStop(1, 'rgba(4,2,1,0.62)');
        vc.fillStyle = rg; vc.fillRect(0, 0, W, H);
        this._vignetteCache = vig;
    }

    _seedEmbers(n) {
        if (this._embers && this._embers.length === n) return;
        const arr = [];
        for (let i = 0; i < n; i++) arr.push({
            x0: Math.random() * INTERNAL_WIDTH,
            y0: Math.random() * (INTERNAL_HEIGHT + 120),
            spd: 22 + Math.random() * 30,
            drift: 0.3 + Math.random() * 0.8,
            size: 2 + Math.random() * 3,
            phase: Math.random() * TAU,
        });
        this._embers = arr;
    }

    // One additive cached-glow blit (caller owns the composite/globalAlpha reset).
    _ember(ctx, x, y, r, color, alpha) {
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.drawImage(getGlowSprite(color), x - r, y - r, r * 2, r * 2);
    }

    // Breathing additive bloom (radius + alpha modulated on sin(t*0.5)); reused
    // by the hearth bloom and the hero pedestal.
    _forgeGlow(ctx, cx, cy, r, color, baseA, t) {
        const rr = r + Math.sin(t * 0.5) * (r * 0.04);
        ctx.globalAlpha = baseA + Math.sin(t * 0.5) * (baseA * 0.18);
        ctx.drawImage(getGlowSprite(color), cx - rr, cy - rr, rr * 2, rr * 2);
    }

    // Set ctx.font to `${weight} ${size}px ${family}` (default the Cinzel HEAD
    // face), shrinking the size until `text` fits within maxW (down to a floor).
    // Cinzel is wider than the system sans, so display labels auto-fit their
    // control instead of overflowing. Returns the size actually used.
    _fitFont(ctx, text, maxW, weight, size, family = HEAD, floor = 12) {
        let s = size;
        ctx.font = `${weight} ${s}px ${family}`;
        while (s > floor && ctx.measureText(text).width > maxW) {
            s -= 1;
            ctx.font = `${weight} ${s}px ${family}`;
        }
        return s;
    }

    // Animated ember-flame rim licking up from the top edge of a control (the
    // active tab / a primary button) — the mockup's standout accent. Additive
    // and cheap (cached glow sprites), purely decorative. Flames stay fire-hued
    // (orange base → pale tongue) regardless of the control's section colour, so
    // they always read as fire. `seed` de-syncs the flicker between controls so
    // they don't pulse in lockstep.
    _emberRim(ctx, x, y, w, h, t, seed = 0) {
        const n = Math.max(3, Math.round(w / 40));
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < n; i++) {
            const fx = x + (i + 0.5) * (w / n);
            const ph = t * 3.2 + i * 1.7 + seed;
            const lick = 7 + Math.sin(ph) * 4 + Math.sin(ph * 2.3) * 2;
            const a = 0.26 + Math.sin(ph * 1.3) * 0.12;
            this._ember(ctx, fx, y - lick * 0.3, 11, '#ff8a3a', a);          // hot base
            this._ember(ctx, fx, y - lick, 6, '#ffe6a0', Math.max(0, a * 0.7)); // pale tongue
        }
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    _drawShootingEmber(ctx, t) {
        const s = this._shooter;
        if (!s || t < s.start || t - s.start > s.dur + s.gap) {
            this._shooter = {
                start: t, dur: 0.9, gap: 6 + Math.random() * 3,
                x0: 120 + Math.random() * 320, y0: 80 + Math.random() * 170,
                len: 380 + Math.random() * 220, ang: 0.5 + Math.random() * 0.3,
            };
            return;
        }
        const p = (t - s.start) / s.dur;
        if (p > 1) return;                                   // dark during the gap
        const e = easeOutCubic(clamp01(p));
        const fade = 1 - p;
        for (let i = 0; i < 5; i++) {
            const tp = e - i * 0.035; if (tp < 0) break;
            const tx = s.x0 + Math.cos(s.ang) * s.len * tp;
            const ty = s.y0 + Math.sin(s.ang) * s.len * tp;
            ctx.globalAlpha = fade * (0.5 - i * 0.08);
            ctx.fillStyle = '#ffd06a'; ctx.fillRect(tx - 2, ty - 2, 4, 4);
        }
        this._ember(ctx, s.x0 + Math.cos(s.ang) * s.len * e, s.y0 + Math.sin(s.ang) * s.len * e, 16, '#ffd06a', fade * 0.8);
    }

    _drawBackdrop(ctx, settings) {
        const W = INTERNAL_WIDTH, H = INTERNAL_HEIGHT, t = this._t || 0;
        this._ensureBackdropCaches();
        ctx.drawImage(this._skyCache, 0, 0);
        // Painterly ember-forge backdrop (higgsfield / Nano Banana 2), cover-fit
        // over the cached sky (which stays as the fallback if the art is still
        // loading or missing). A vertical scrim keeps header/tab/content text
        // readable; the animated embers + vignette below still ride on top so the
        // menu stays alive rather than a static photo.
        const ui = getMenuImages();
        if (ui.bg) {
            const iw = ui.bg.width, ih = ui.bg.height;
            const s = Math.max(W / iw, H / ih);
            const dw = iw * s, dh = ih * s;
            ctx.drawImage(ui.bg, (W - dw) / 2, (H - dh) / 2, dw, dh);
            const scr = ctx.createLinearGradient(0, 0, 0, H);
            scr.addColorStop(0, 'rgba(8,6,10,0.58)');    // behind the header/title
            scr.addColorStop(0.28, 'rgba(8,6,10,0.30)');
            scr.addColorStop(0.62, 'rgba(8,6,10,0.30)');
            scr.addColorStop(1, 'rgba(8,6,10,0.50)');     // behind the content panels
            ctx.fillStyle = scr; ctx.fillRect(0, 0, W, H);
        }
        const reduced = settings && settings.reducedEffects;
        const noParticles = settings && settings.particles === false;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        this._forgeGlow(ctx, W * 0.5, H * 1.02, 760, '#ff7a1e', 0.16, t);
        this._forgeGlow(ctx, W * 0.5, H * 1.02, 340, '#ffd06a', 0.10, t);
        if (!noParticles) {
            this._seedEmbers(reduced ? 12 : 22);
            for (const em of this._embers) {
                const y = H + 60 - ((t * em.spd + em.y0) % (H + 120));
                const x = em.x0 + Math.sin(t * 0.6 + em.phase) * 40 * em.drift;
                const life = 1 - Math.abs((y / H) - 0.5) * 2;   // bright mid-screen, fades to edges
                const a = Math.max(0, life) * (0.5 + 0.3 * Math.sin(t * 3 + em.phase));
                if (a <= 0.02) continue;
                const gr = em.size * 3 * (1.1 + 0.2 * Math.sin(t * 4 + em.phase));
                this._ember(ctx, x, y, gr, '#ff8a3a', a * 0.5);
            }
            if (!reduced) this._drawShootingEmber(ctx, t);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.restore();
        ctx.drawImage(this._vignetteCache, 0, 0);
    }

    // Near-opaque smoked-glass fill (single source of the panel/pill glass look).
    _smokedGlassFill(ctx, x, y, w, h, r = 16) {
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        // Slightly translucent so the ember-forge backdrop reads through the
        // panel edges (glassy premium look) while staying opaque enough for text.
        g.addColorStop(0, 'rgba(26,19,19,0.84)');
        g.addColorStop(1, 'rgba(12,10,12,0.90)');
        roundRectPath(ctx, x, y, w, h, r);
        ctx.fillStyle = g; ctx.fill();
    }

    // Forged ember corner brackets (higgsfield) framing a panel — one ornate
    // bracket per corner, flipped into place. Returns false if the art hasn't
    // loaded so the caller can fall back to the procedural ticks. The bracket
    // image is top-left-oriented; scale(±1,±1) mirrors it to each corner.
    _forgeCorners(ctx, x, y, w, h) {
        const img = getMenuImages().corner;
        if (!img) return false;
        const cs = Math.min(80, Math.max(44, Math.min(w, h) * 0.15));
        const off = 0;   // elbow exactly at the corner (no bleed above into the tab tray)
        ctx.save();
        ctx.globalAlpha = 0.92;
        const draw = (cx, cy, sx, sy) => {
            ctx.save(); ctx.translate(cx, cy); ctx.scale(sx, sy);
            ctx.drawImage(img, 0, 0, cs, cs); ctx.restore();
        };
        draw(x - off, y - off, 1, 1);              // top-left
        draw(x + w + off, y - off, -1, 1);         // top-right
        draw(x - off, y + h + off, 1, -1);         // bottom-left
        draw(x + w + off, y + h + off, -1, -1);    // bottom-right
        ctx.restore();
        return true;
    }

    // Four L-shaped ember ticks framing a large panel (opts.corners only).
    _cornerTicks(ctx, x, y, w, h) {
        const s = 10, m = 9;
        ctx.strokeStyle = 'rgba(255,140,60,0.35)'; ctx.lineWidth = 2;
        const corners = [[x + m, y + m, 1, 1], [x + w - m, y + m, -1, 1], [x + m, y + h - m, 1, -1], [x + w - m, y + h - m, -1, -1]];
        for (const [cx, cy, dx, dy] of corners) {
            ctx.beginPath();
            ctx.moveTo(cx + dx * s, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * s);
            ctx.stroke();
        }
    }

    // Rounded panel — smoked glass with a warm inner rim + top gloss (default),
    // or an explicit fill when one is passed (nested cards keep their own tint).
    _panel(ctx, x, y, w, h, fill = null, stroke = 'rgba(255,180,120,0.10)', opts = {}) {
        const r = 16;
        if (fill) { roundRectPath(ctx, x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); }
        else this._smokedGlassFill(ctx, x, y, w, h, r);
        // Top gloss (clipped to the panel).
        ctx.save();
        roundRectPath(ctx, x, y, w, h, r); ctx.clip();
        const gg = ctx.createLinearGradient(0, y, 0, y + h * 0.4);
        gg.addColorStop(0, 'rgba(255,255,255,0.05)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gg; ctx.fillRect(x, y, w, h * 0.4);
        ctx.restore();
        // Inner rim-light.
        roundRectPath(ctx, x + 1.5, y + 1.5, w - 3, h - 3, r - 1);
        ctx.strokeStyle = 'rgba(255,140,60,0.10)'; ctx.lineWidth = 1.5; ctx.stroke();
        // Outer stroke.
        if (stroke) { roundRectPath(ctx, x, y, w, h, r); ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
        // Forged corner brackets on panels that OPT IN (opts.corners) only — kept
        // explicit so themed/nested panels (e.g. the purple CHARACTER card, the
        // gear-grid columns) don't get an ember frame they weren't designed for.
        // Falls back to the procedural ember ticks if the bracket art hasn't loaded.
        if (opts.corners) { if (!this._forgeCorners(ctx, x, y, w, h)) this._cornerTicks(ctx, x, y, w, h); }
    }

    // Right-aligned smoked-glass coin pill with a soft glow behind the ◎.
    _coinBank(ctx, rightX, cy, coins) {
        const label = `◎ ${coins} coins`;
        ctx.font = `700 32px ${FONT}`;
        const tw = ctx.measureText(label).width;
        const padX = 26, w = tw + padX * 2, h = 52, x = rightX - w, y = cy - h / 2;
        this._smokedGlassFill(ctx, x, y, w, h, h / 2);
        roundRectPath(ctx, x, y, w, h, h / 2);
        ctx.strokeStyle = 'rgba(255,180,120,0.16)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        this._ember(ctx, x + padX + 8, cy, 40, '#ffd86b', 0.12);
        ctx.restore(); ctx.globalAlpha = 1;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffd86b'; ctx.font = `700 32px ${FONT}`;
        ctx.fillText(label, x + padX, cy + 1);
    }

    // Hero forge-pedestal (PLAY tab): grounding disc, a slowly-rotating rune
    // ring, a breathing under-glow (tintable to the character accent), and a few
    // rising motes. Sits BEHIND the avatar so the hero stands on it. `sc` scales
    // the whole shrine down on short cards so its ring never bleeds into the
    // CHARACTER label when a large vertical safe-area shrinks the panel.
    _pedestal(ctx, cx, footY, t, accent = '#ff7a1e', sc = 1) {
        const rOuterX = 130 * sc, rOuterY = 40 * sc, rInnerX = 104 * sc, rInnerY = 32 * sc;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        this._forgeGlow(ctx, cx, footY, 170 * sc, accent, 0.26, t);
        // Rising forge motes.
        for (let i = 0; i < 5; i++) {
            const up = ((t * 30 + i * 34) % 150) * sc;
            const mx = cx + Math.sin(t * 1.3 + i * 1.7) * 34 * sc;
            const my = footY - up;
            const a = Math.max(0, 1 - up / (150 * sc)) * 0.6;
            const r = (5 + 3 * Math.sin(t * 3 + i)) * sc;
            this._ember(ctx, mx, my, r, '#ffb257', a);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        // Grounding disc.
        ctx.beginPath(); ctx.ellipse(cx, footY, 120 * sc, 34 * sc, 0, 0, TAU);
        ctx.fillStyle = 'rgba(10,6,6,0.55)'; ctx.fill();
        // Double rune ring.
        ctx.strokeStyle = 'rgba(255,150,70,0.5)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(cx, footY, rOuterX, rOuterY, 0, 0, TAU); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,210,130,0.35)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(cx, footY, rInnerX, rInnerY, 0, 0, TAU); ctx.stroke();
        // 8 slowly-rotating rune ticks around the ring.
        for (let i = 0; i < 8; i++) {
            const a = i * (TAU / 8) + t * 0.25;
            const tx = cx + Math.cos(a) * rOuterX, ty = footY + Math.sin(a) * rOuterY;
            ctx.globalAlpha = 0.4 + 0.4 * Math.sin(t * 2 + i);
            ctx.fillStyle = '#ffcf8a';
            ctx.fillRect(tx - 2, ty - 2, 4, 4);
        }
        ctx.globalAlpha = 1;
        ctx.restore();
    }

    // A labelled button. Registers a hotspot when an action is supplied.
    _button(ctx, r, label, opts = {}) {
        const {
            primary = false, enabled = true, accent = null, sub = null,
            action = null, arg = null, fontSize = 30, accessibleLabel = undefined,
        } = opts;
        roundRectPath(ctx, r.x, r.y, r.w, r.h, 14);
        let fill = 'rgba(40,46,58,0.95)';
        if (primary) fill = enabled ? '#3ea65b' : 'rgba(40,46,58,0.6)';
        else if (accent) fill = accent;
        else if (!enabled) fill = 'rgba(30,34,42,0.7)';
        ctx.fillStyle = fill; ctx.fill();
        // Forged-plate relief (higgsfield): the neutral metal plate overlaid
        // ADDITIVELY and clipped to the button, so its bevel / rivets / copper rim
        // glint over the accent fill while the button's colour (its meaning) still
        // reads. No-op if the plate art hasn't loaded — the flat fill stands alone.
        const plate = getMenuImages().btnPlate;
        if (plate) {
            ctx.save();
            roundRectPath(ctx, r.x, r.y, r.w, r.h, 14); ctx.clip();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = enabled ? 0.30 : 0.14;
            ctx.drawImage(plate, r.x, r.y, r.w, r.h);
            ctx.restore();
        }
        ctx.strokeStyle = enabled ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 2; ctx.stroke();
        // Primary (START-style) buttons get the flaming ember rim from the mockup.
        if (primary && enabled) this._emberRim(ctx, r.x + 8, r.y, r.w - 16, r.h, this._t || 0, 3.1);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = enabled ? '#fff' : 'rgba(255,255,255,0.4)';
        // Forged display face, auto-fit so long labels ("TAP AGAIN TO CONFIRM")
        // never overflow the plate in the wider Cinzel glyphs.
        this._fitFont(ctx, label, r.w - 24, 700, fontSize);
        ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + (sub ? -10 : 0));
        if (sub) {
            ctx.font = `600 18px ${FONT}`;
            ctx.fillStyle = enabled ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)';
            ctx.fillText(sub, r.x + r.w / 2, r.y + r.h / 2 + 18);
        }
        if (action && enabled) this._hot(
            r.x, r.y, r.w, r.h, action, arg,
            accessibleLabel === undefined ? label : accessibleLabel,
        );
    }

    _contentRect() {
        const sa = this._sa();
        const x = sa.left + 56;
        const w = INTERNAL_WIDTH - sa.left - sa.right - 112;
        // The sub-tab pill row (set by _drawTabBar, which always draws before
        // tab content) pushes the content down when visible.
        const top = sa.top + 184 + (this._subRowH || 0);
        const bottom = INTERNAL_HEIGHT - sa.bottom - 40;
        return { x, y: top, w, h: bottom - top };
    }

    draw(ctx, state) {
        this.hotspots = [];
        this._attentionBadgeUsed = false;
        this._lastCollectionPhoneLayout = false;
        this._lastCollectionTouchSafe = false;
        this._lastCollectionMinTouchCss = 0;
        this._lastCollectionPursuitGuidance = false;
        this._lastCollectionNavTouchSafe = false;
        this._lastCollectionNavMinTouchCss = 0;
        this._lastCollectionRuntime = null;
        this._lastCharacterPhonePane = null;
        this._lastCharacterPhonePaneTouchSafe = false;
        this._lastCharacterPhonePaneMinTouchCss = 0;
        this._lastCollectionCompletionRendered = false;
        this._lastCollectionCompletionSection = '';
        this._lastCollectionCompletionTouchSafe = false;
        this._lastCollectionCompletionMinTouchCss = 0;
        this._lastCollectionCompletionModel = null;
        this._lastCollectionCompletionTextSafe = false;
        this._lastCollectionCompletionCaseTruth = null;
        this._lastBoutiqueTrailPreview = false;
        // Kick off the display-font load (idempotent, guarded); canvas text using
        // HEAD picks up Cinzel once ready, staying on the system fallback until then.
        ensureMenuFont();
        const sa = this._sa();
        const save = state.saveData;
        // Wall-clock seconds for menu animations (title shimmer, tab glow,
        // START pulse, selected-chip glow). Frame-rate independent.
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
        if (this._t0 === undefined) this._t0 = now;
        this._clockT = (now - this._t0) / 1000;
        this._reducedMotion = save.settings?.reducedEffects === true;
        // Existing drawing code consumes `_t`; freezing it at zero makes every
        // decorative menu pulse, shimmer, rune, badge, and avatar idle stable.
        // Functional transitions below use `_clockT` and snap when reduced.
        this._t = this._reducedMotion ? 0 : this._clockT;
        const t = this._t;

        // Atmospheric "ember forge" backdrop (cached sky + bloom + embers +
        // vignette) — replaces the old flat fill.
        this._drawBackdrop(ctx, save.settings);

        // HOME is the title screen (big logo, hero, menu stack); every other
        // menuTab renders the section chrome (wordmark, header strip, group bar).
        if ((state.menuTab || 'home') === 'home') this._drawHome(ctx, state);
        else this._drawSections(ctx, state);

        // Toast (transient result message, e.g. claim / case errors).
        if (state.menuToast) {
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = `700 26px ${FONT}`;
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            const tw = ctx.measureText(state.menuToast).width + 48;
            roundRectPath(ctx, INTERNAL_WIDTH / 2 - tw / 2, INTERNAL_HEIGHT - sa.bottom - 70, tw, 48, 12);
            ctx.fill();
            ctx.fillStyle = '#ffe9a8';
            ctx.fillText(state.menuToast, INTERNAL_WIDTH / 2, INTERNAL_HEIGHT - sa.bottom - 46);
        }

        // Guided menu tour: dims the menu, spotlights the current step's tab,
        // and shows the lesson card (Next/Skip own input while it's up — Game
        // gates every other menu action). Drawn above the toast, below nothing:
        // the case overlay can't appear mid-tour because its actions are gated.
        if (state.menuTour) this._drawTourOverlay(ctx, state);

        // Case-opening overlay sits above everything (and owns input while up).
        if (state.caseAnim) this._drawCaseOverlay(ctx, state.caseAnim, state);
        else this._drawKeyboardFocus(ctx, state);
    }

    _drawKeyboardFocus(ctx, state) {
        if (!state.menuFocusVisible || !state.menuFocusKey) return;
        const hotspot = this.hotspots.find((entry) => entry.key === state.menuFocusKey);
        if (!hotspot) return;
        const pad = 7;
        const x = hotspot.x - pad, y = hotspot.y - pad;
        const w = hotspot.w + pad * 2, h = hotspot.h + pad * 2;
        const contrast = state.saveData?.settings?.highContrast === true;
        ctx.save();
        roundRectPath(ctx, x, y, w, h, 17);
        ctx.strokeStyle = '#08090b';
        ctx.lineWidth = contrast ? 10 : 8;
        ctx.stroke();
        roundRectPath(ctx, x, y, w, h, 17);
        ctx.strokeStyle = contrast ? '#ffffff' : '#ffd27d';
        ctx.lineWidth = contrast ? 5 : 4;
        ctx.stroke();

        const label = `FOCUS · ${hotspot.label}`;
        ctx.font = `800 16px ${FONT}`;
        const safe = this._sa();
        const safeLeft = safe.left + 8;
        const safeRight = INTERNAL_WIDTH - safe.right - 8;
        const labelW = Math.min(safeRight - safeLeft,
            Math.max(80, ctx.measureText(label).width + 24));
        const labelX = Math.max(safeLeft, Math.min(x + 10, safeRight - labelW));
        const labelY = Math.max(safe.top + 4,
            Math.min(y - 24, INTERNAL_HEIGHT - safe.bottom - 30));
        roundRectPath(ctx, labelX, labelY, labelW, 26, 8);
        ctx.fillStyle = '#08090b'; ctx.fill();
        ctx.strokeStyle = contrast ? '#ffffff' : '#ffd27d'; ctx.lineWidth = 2; ctx.stroke();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff';
        ctx.fillText(this._ellip(ctx, label, labelW - 12), labelX + labelW / 2, labelY + 13);
        ctx.restore();
    }

    _drawAttentionBadge(ctx, x, y, label, color = '#ffce54') {
        if (this._attentionBadgeUsed) return false;
        this._attentionBadgeUsed = true;
        const text = String(label || 'NEW').toUpperCase();
        ctx.save();
        ctx.font = `800 12px ${FONT}`;
        const w = Math.max(44, ctx.measureText(text).width + 18);
        const h = 22;
        ctx.globalAlpha = this._reducedMotion ? 1 : 0.88 + Math.sin((this._t || 0) * 3) * 0.12;
        roundRectPath(ctx, x - w, y, w, h, h / 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.strokeStyle = '#08090b'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#181006'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, x - w / 2, y + h / 2 + 0.5);
        ctx.restore();
        return true;
    }

    // Rect of a tab's pill in the section bar (same math as _drawTabBar).
    // The bar only shows the ACTIVE group's screens — the tour always sets
    // menuTab to the step's tab first, so the step's pill is on screen when
    // the spotlight draws. Null if the tab's group is fully locked.
    _tabRectFor(save, tabId) {
        const groups = this._visibleGroups(save);
        const g = groups.find((gg) => gg.kids.includes(tabId));
        if (!g) return null;
        const sa = this._sa();
        // Mirrors _drawTabBar's geometry INCLUDING the ‹ HOME chip offset.
        const cssScale = (this.renderer.cssWidth || INTERNAL_WIDTH) / INTERNAL_WIDTH;
        const phone = isPhoneLandscapeViewport(
            this.renderer.cssWidth ?? INTERNAL_WIDTH,
            this.renderer.cssHeight ?? INTERNAL_HEIGHT,
        ) && tabId === 'character';
        const phoneBar = phone ? computePhoneSectionBarLayout(sa, cssScale) : null;
        const h = phone ? phoneBar.h : 62;
        const homeW = phone ? phoneBar.homeW : 120;
        const kids = phone && g.kids.includes('character')
            ? ['play', 'character']
            : phone && !g.kids.includes('play') ? ['play', ...g.kids] : g.kids;
        const i = kids.indexOf(tabId);
        const x0 = phone ? phoneBar.firstTabX : sa.left + 56 + homeW + 14;
        const tabW = phone ? phoneBar.tabW : 210, gap = phone ? phoneBar.gap : 12;
        const td = MENU_TABS.find((m) => m.id === tabId);
        return { x: x0 + i * (tabW + gap), y: phone ? phoneBar.y : sa.top + 104, w: tabW, h, accent: (td && td.accent) || g.accent };
    }

    // A downward-pointing "look here" chevron bouncing just outside a target
    // rect on the given edge ('top' points DOWN at the rect from above; 'bottom'
    // points UP at it from below). Gold, outlined, animated — the tour's arrow.
    _drawTourArrow(ctx, rect, edge, t) {
        const bounce = 5 + 5 * Math.sin(t * 6);
        let ax, ay, dir;
        if (edge === 'bottom') { ax = rect.x + rect.w / 2; ay = rect.y + rect.h + 26 + bounce; dir = -1; }
        else { ax = rect.x + rect.w / 2; ay = rect.y - 26 - bounce; dir = 1; }
        ctx.save();
        ctx.fillStyle = '#ffe066'; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ax, ay + dir * 18);
        ctx.lineTo(ax - 18, ay - dir * 8); ctx.lineTo(ax - 7, ay - dir * 8);
        ctx.lineTo(ax, ay + dir * 4); ctx.lineTo(ax + 7, ay - dir * 8); ctx.lineTo(ax + 18, ay - dir * 8);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
    }

    // ── GUIDED MENU TOUR OVERLAY ─────────────────────────────────────────
    // The screen dims with the spotlit tab AND the step's referenced control
    // (START RUN / a buy button / a case…) cut out of the dim; each gets an
    // animated accent ring + a bouncing "look here" arrow; the lesson card
    // carries title + lines + progress + NEXT / SKIP TOUR (the only live
    // hotspots while touring).
    _drawTourOverlay(ctx, state) {
        const tour = state.menuTour;
        const save = state.saveData || {};
        const W = INTERNAL_WIDTH, H = INTERNAL_HEIGHT;
        const t = this._t || 0;
        const spot = this._tabRectFor(save, tour.tab);
        const m = 6; // spotlight margin around the tab chip
        // The control this step points at (its hotspot was registered while the
        // tab's content drew, just before this overlay). First match wins.
        let ctrl = null;
        if (tour.highlightAction) {
            const hs = this.hotspots || [];
            for (const r of hs) { if (r.action === tour.highlightAction) { ctrl = r; break; } }
        }
        // Build the dim as a full-screen fill with the spotlight rects cut out
        // (even-odd), so BOTH the tab and the control read at full brightness.
        const holes = [];
        if (spot) holes.push({ x: spot.x - m, y: spot.y - m, w: spot.w + m * 2, h: spot.h + m * 2 });
        if (ctrl) holes.push({ x: ctrl.x - 6, y: ctrl.y - 6, w: ctrl.w + 12, h: ctrl.h + 12 });
        ctx.save();
        ctx.fillStyle = 'rgba(4,3,3,0.72)';
        if (holes.length && ctx.roundRect) {
            ctx.beginPath();
            ctx.rect(0, 0, W, H);
            for (const hh of holes) ctx.roundRect(hh.x, hh.y, hh.w, hh.h, 14);
            ctx.fill('evenodd');
        } else {
            ctx.fillRect(0, 0, W, H);   // no holes / no roundRect → flat dim
        }
        // Spotlit tab: glow + accent ring + a bouncing arrow pointing up at it.
        if (spot) {
            const sx = spot.x - m, sy = spot.y - m, sw = spot.w + m * 2, sh = spot.h + m * 2;
            const accent = spot.accent || '#ffce54';
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.30 + Math.sin(t * 3) * 0.12;
            ctx.drawImage(getGlowSprite(accent), sx - 24, sy - 24, sw + 48, sh + 48);
            ctx.restore();
            roundRectPath(ctx, sx, sy, sw, sh, 14);
            ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.stroke();
            this._drawTourArrow(ctx, { x: sx, y: sy, w: sw, h: sh }, 'bottom', t);
        }
        // Highlighted control: pulsing green ring + a "look here" arrow above it.
        if (ctrl) {
            const rx = ctrl.x - 6, ry = ctrl.y - 6, rw = ctrl.w + 12, rh = ctrl.h + 12;
            ctx.save();
            ctx.globalAlpha = 0.7 + 0.3 * Math.sin(t * 5);
            roundRectPath(ctx, rx, ry, rw, rh, 12);
            ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 3.5; ctx.stroke();
            ctx.restore();
            this._drawTourArrow(ctx, { x: rx, y: ry, w: rw, h: rh }, 'top', t);
        }

        // Lesson card — placed on the OPPOSITE half from a highlighted control
        // so the card never covers the very thing it's pointing at.
        const lines = tour.lines || [];
        const cw = 900;
        const chh = 118 + lines.length * 30 + 86;
        const cx = W / 2 - cw / 2;
        const cy = (ctrl && ctrl.y < H * 0.5) ? (H - chh - 70) : Math.min(H - chh - 60, 300);
        this._panel(ctx, cx, cy, cw, chh, null, 'rgba(255,180,120,0.22)', { corners: true });
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#ffd479';
        this._fitFont(ctx, tour.title, cw - 80, 800, 34);
        ctx.fillText(tour.title, W / 2, cy + 54);
        ctx.fillStyle = 'rgba(255,244,224,0.92)'; ctx.font = `500 21px ${FONT}`;
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], W / 2, cy + 92 + i * 30);
        }
        // Progress dots + counter.
        const total = tour.total || 1;
        const dotsW = total * 18;
        for (let i = 0; i < total; i++) {
            ctx.beginPath();
            ctx.arc(W / 2 - dotsW / 2 + i * 18 + 9, cy + chh - 96, i === tour.idx ? 6 : 4, 0, TAU);
            ctx.fillStyle = i === tour.idx ? '#ffce54' : i < tour.idx ? 'rgba(255,206,84,0.55)' : 'rgba(255,255,255,0.22)';
            ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `600 15px ${FONT}`;
        ctx.fillText(`${tour.idx + 1} / ${total}`, W / 2, cy + chh - 72);
        // The overlay owns interaction. Keep the underlying hotspots only long
        // enough to locate the highlighted control, then expose a true modal
        // focus scope containing SKIP and NEXT alone.
        this.hotspots = [];
        // Buttons: SKIP (subtle, left) + NEXT/FINISH (primary, right).
        const last = tour.idx >= total - 1;
        this._button(ctx, { x: W / 2 - 330, y: cy + chh - 62, w: 260, h: 50 }, 'SKIP TOUR',
            { accent: 'rgba(60,52,48,0.9)', action: 'tourSkip', fontSize: 20 });
        this._button(ctx, { x: W / 2 + 70, y: cy + chh - 62, w: 260, h: 50 }, last ? 'FINISH  ✓' : 'NEXT  ▸',
            { primary: true, action: 'tourNext', fontSize: 22 });
        ctx.restore();
    }

    // ── HOME — the title screen ─────────────────────────────────────────
    // What you land on: the big EMBERWAKE wordmark, the selected hero standing
    // on their forge pedestal, a vertical menu stack (the game-menu classic),
    // and a lifetime-stats strip. Sections open from the stack; ⌂/Esc returns.
    _drawHome(ctx, state) {
        const sa = this._sa();
        const save = state.saveData;
        const isFirst = (save.stats?.runs ?? 0) === 0;
        const t = this._t;
        const W = INTERNAL_WIDTH, H = INTERNAL_HEIGHT;
        const ui = getMenuImages();
        // Leaving HOME always plays the section slide-in — even back into the
        // same section you were on (without this, _transTab still matches and
        // the return trip pops in with no transition).
        this._transTab = null;

        const left = sa.left + 56, right = W - sa.right - 56;
        const visibleMid = (left + right) / 2;

        // Coin bank stays top-right (the lobby shows your currency).
        this._coinBank(ctx, right, sa.top + 52, save.totalCoins);

        // Compact crest + wordmark lockup. Keeping the emblem beside the title
        // leaves the lower two-thirds free for the actual choices while still
        // giving the brand a premium, unmistakable first read.
        const titleH = 96;
        const titleW = ui.title ? ui.title.width * (titleH / ui.title.height) : 620;
        const crestS = ui.logo ? 78 : 0;
        const lockGap = ui.logo ? 18 : 0;
        const lockW = crestS + lockGap + titleW;
        const lockX = visibleMid - lockW / 2;
        const titleY = sa.top + 54;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        this._ember(ctx, visibleMid, titleY + titleH * 0.56, 300, '#ff7a1e', 0.22 + Math.sin(t * 1.2) * 0.05);
        if (ui.logo) this._ember(ctx, lockX + crestS / 2, titleY + crestS / 2, crestS * 0.78, '#ff8a3a', 0.17 + Math.sin(t * 1.7) * 0.04);
        ctx.restore(); ctx.globalAlpha = 1;
        if (ui.logo) ctx.drawImage(ui.logo, lockX, titleY + 6, crestS, crestS);
        const lx = lockX + crestS + lockGap;
        if (ui.title) {
            ctx.drawImage(ui.title, lx, titleY, titleW, titleH);
        } else {
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            const tg = ctx.createLinearGradient(lx, 0, lx + titleW, 0);
            const off = Math.sin(t * 1.2) * 0.5 + 0.5;
            tg.addColorStop(Math.max(0, off - 0.3), '#ffb43a');
            tg.addColorStop(off, '#fff1b8');
            tg.addColorStop(Math.min(1, off + 0.3), '#ffb43a');
            ctx.fillStyle = tg; ctx.font = `800 82px ${HEAD}`;
            ctx.fillText('EMBERWAKE', lx, titleY + 80);
        }
        const ruleW = Math.min(650, lockW);
        const ruleG = ctx.createLinearGradient(visibleMid - ruleW / 2, 0, visibleMid + ruleW / 2, 0);
        ruleG.addColorStop(0, 'rgba(255,122,30,0)'); ruleG.addColorStop(0.5, 'rgba(255,173,92,0.68)'); ruleG.addColorStop(1, 'rgba(255,122,30,0)');
        ctx.fillStyle = ruleG; ctx.fillRect(visibleMid - ruleW / 2, titleY + titleH + 10, ruleW, 2);
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#ffd28f'; ctx.font = `700 14px ${FONT}`;
        ctx.fillText('HOLD THE LAST LIGHT', visibleMid, titleY - 10);
        ctx.fillStyle = 'rgba(255,230,195,0.78)'; ctx.font = `500 18px ${FONT}`;
        ctx.fillText('Survive the night. Keep the last light burning.', visibleMid, titleY + titleH + 38);

        // ── Forged command deck (left) ──
        const groups = this._visibleGroups(save);
        const seen = (save.onboarding && save.onboarding.tabsSeen) || [];
        const plate = ui.btnPlate;
        const rows = [];
        for (const gDef of groups) {
            if (gDef.id === 'gPlay') continue;
            rows.push({ id: gDef.id, label: gDef.label, accent: gDef.accent, target: gDef.kids[0], kids: gDef.kids });
        }
        const statusH = 54;
        const statusY = H - sa.bottom - statusH - 18;
        const mainTop = Math.max(sa.top + 230, titleY + titleH + 64);
        const mainBottom = statusY - 20;
        // On cover-fit phones the vertical safe band can be much shorter than
        // desktop. Respect the real available height; the hook below may drop
        // out, and the keeper stage scales, instead of forcing content offscreen.
        const mainH = Math.max(500, mainBottom - mainTop);
        const navW = 570;
        const heroW = 650;
        const navX = left + 70;
        const heroX = right - heroW - 70;
        this._panel(ctx, navX - 24, mainTop, navW + 48, mainH, 'rgba(10,8,9,0.70)', 'rgba(255,158,80,0.22)', { corners: true });

        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        const deckKicker = isFirst ? 'NEW PLAYER START' : 'READY FOR ANOTHER ATTEMPT';
        const deckTitle = isFirst ? 'START YOUR FIRST RUN' : 'CHOOSE YOUR NEXT RUN';
        ctx.fillStyle = '#ffbd68'; ctx.font = `800 14px ${FONT}`;
        ctx.fillText(deckKicker, navX, mainTop + 34);
        ctx.fillStyle = '#fff4df'; this._fitFont(ctx, deckTitle, navW, 700, 30);
        ctx.fillText(deckTitle, navX, mainTop + 70);
        ctx.fillStyle = 'rgba(236,224,210,0.70)';
        const deckCopy = isFirst
            ? 'A Vigil is a survival run: choose your hero, map, and difficulty.'
            : 'Choose your hero, map, and difficulty, then survive the night.';
        this._fitFont(ctx, deckCopy, navW, 500, 16, FONT, 13);
        ctx.fillText(deckCopy, navX, mainTop + 96);

        // PLAY — the singular warm focal point. It opens run setup; the existing
        // Space/Enter shortcut still starts immediately for returning players.
        const playR = { x: navX, y: mainTop + 118, w: navW, h: 116 };
        {
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            this._ember(ctx, playR.x + playR.w / 2, playR.y + playR.h / 2, playR.w * 0.58, '#ff7a1e', 0.20 + Math.sin(t * 2.4) * 0.05);
            ctx.restore(); ctx.globalAlpha = 1;
            const g = ctx.createLinearGradient(playR.x, playR.y, playR.x + playR.w, playR.y + playR.h);
            g.addColorStop(0, '#8d2f14'); g.addColorStop(0.48, '#e06122'); g.addColorStop(1, '#7a2413');
            roundRectPath(ctx, playR.x, playR.y, playR.w, playR.h, 18);
            ctx.fillStyle = g; ctx.fill();
            if (plate) {
                ctx.save(); roundRectPath(ctx, playR.x, playR.y, playR.w, playR.h, 18); ctx.clip();
                ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.34;
                ctx.drawImage(plate, playR.x, playR.y, playR.w, playR.h);
                // A narrow travelling highlight makes the CTA feel hot, not neon.
                const sweepX = playR.x - 100 + ((t * 95) % (playR.w + 200));
                const sg = ctx.createLinearGradient(sweepX - 70, 0, sweepX + 70, 0);
                sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,239,199,0.18)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = sg; ctx.fillRect(sweepX - 70, playR.y, 140, playR.h);
                ctx.restore();
            }
            ctx.globalAlpha = 0.72 + 0.20 * Math.sin(t * 2.1);
            ctx.strokeStyle = '#ffd27d'; ctx.lineWidth = 3;
            roundRectPath(ctx, playR.x, playR.y, playR.w, playR.h, 18); ctx.stroke();
            ctx.globalAlpha = 1;
            this._emberRim(ctx, playR.x + 10, playR.y, playR.w - 20, playR.h, t, 1.7);
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            const playTitle = isFirst ? 'START FIRST RUN' : 'START RUN';
            ctx.fillStyle = '#ffffff'; this._fitFont(ctx, playTitle, playR.w - 150, 800, 38);
            ctx.fillText(playTitle, playR.x + 32, playR.y + 45);
            ctx.font = `600 16px ${FONT}`; ctx.fillStyle = 'rgba(255,247,231,0.88)';
            ctx.fillText(isFirst ? 'Guided setup · tips appear during play' : 'Choose Hero, Map & Difficulty',
                playR.x + 32, playR.y + 78);
            ctx.fillStyle = 'rgba(255,240,208,0.58)'; ctx.font = `700 13px ${FONT}`;
            ctx.fillText(isFirst ? 'OPEN RUN SETUP' : 'SPACE / ENTER  •  QUICK START', playR.x + 32, playR.y + 99);
            const pcx = playR.x + playR.w - 58, pcy = playR.y + playR.h / 2;
            ctx.beginPath(); ctx.arc(pcx, pcy, 31, 0, TAU);
            ctx.fillStyle = 'rgba(24,10,6,0.48)'; ctx.fill();
            ctx.strokeStyle = 'rgba(255,236,194,0.72)'; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = '#fff4d8';
            ctx.beginPath(); ctx.moveTo(pcx - 7, pcy - 13); ctx.lineTo(pcx + 13, pcy); ctx.lineTo(pcx - 7, pcy + 13); ctx.closePath(); ctx.fill();
            this._hot(playR.x, playR.y, playR.w, playR.h, 'tab', 'play');

            // Undone-dailies nudge rides the primary play action.
            const dDay = currentDayNumber();
            const dDd = save.daily || { day: 0, completed: [] };
            const dPicked = pickDailyChallenges(dDay);
            const dDone = completedDailyCount(dDd, dDay, dPicked);
            if (((save.stats?.runs ?? 0) >= 1) && dDone < dPicked.length) {
                this._drawAttentionBadge(ctx, playR.x + playR.w - 8, playR.y - 8, 'GOAL', '#ffce54');
            }
        }

        // Section cards: two columns keep every destination visible without
        // turning HOME into a tall settings list. Each card states its purpose.
        const sectionLabels = {
            gHero: 'HERO', gArmory: 'UPGRADES', gShop: 'SHOP',
            gProgress: 'REWARDS', gSettings: 'SETTINGS',
        };
        const sectionCopy = {
            gHero: 'heroes & appearance', gArmory: 'skills, upgrades & gear', gShop: 'cases & cosmetic styles',
            gProgress: 'goals, rewards & records', gSettings: 'options & accessibility',
        };
        const cols = 2, cardGap = 12;
        const sectionTop = playR.y + playR.h + 20;
        const sectionRows = Math.max(1, Math.ceil(rows.length / cols));
        const sectionBottom = mainTop + mainH - 24;
        const cardH = Math.max(68, Math.min(84, (sectionBottom - sectionTop - cardGap * (sectionRows - 1)) / sectionRows));
        const cardW = (navW - cardGap) / cols;
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const colIdx = i % cols, rowIdx = Math.floor(i / cols);
            const x = navX + colIdx * (cardW + cardGap);
            const y = sectionTop + rowIdx * (cardH + cardGap);
            roundRectPath(ctx, x, y, cardW, cardH, 14);
            const bg = ctx.createLinearGradient(0, y, 0, y + cardH);
            bg.addColorStop(0, 'rgba(30,24,21,0.92)'); bg.addColorStop(1, 'rgba(18,14,13,0.92)');
            ctx.fillStyle = bg; ctx.fill();
            // Each destination keeps its own restrained color wash. The tint is
            // strongest near the icon/label and fades before it can compete with
            // the warm START RUN action above.
            ctx.save(); roundRectPath(ctx, x, y, cardW, cardH, 14); ctx.clip();
            const accentWash = ctx.createLinearGradient(x, 0, x + cardW, 0);
            accentWash.addColorStop(0, `${r.accent}26`);
            accentWash.addColorStop(0.48, `${r.accent}0c`);
            accentWash.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = accentWash; ctx.fillRect(x, y, cardW, cardH);
            ctx.restore();
            if (plate) {
                ctx.save(); roundRectPath(ctx, x, y, cardW, cardH, 14); ctx.clip();
                ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.14;
                ctx.drawImage(plate, x, y, cardW, cardH); ctx.restore();
            }
            roundRectPath(ctx, x, y, cardW, cardH, 14);
            ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 1.5; ctx.stroke();
            const accentRail = ctx.createLinearGradient(0, y + 8, 0, y + cardH - 8);
            accentRail.addColorStop(0, `${r.accent}66`);
            accentRail.addColorStop(0.5, r.accent);
            accentRail.addColorStop(1, `${r.accent}66`);
            ctx.fillStyle = accentRail;
            ctx.fillRect(x, y + 8, 4, cardH - 16);
            const iconX = x + 35, iconY = y + cardH / 2;
            ctx.beginPath(); ctx.arc(iconX, iconY, 20, 0, TAU);
            ctx.fillStyle = `${r.accent}18`; ctx.fill();
            ctx.strokeStyle = `${r.accent}88`; ctx.lineWidth = 1.5; ctx.stroke();
            const groupId = r.id;
            this._drawHomeGroupGlyph(ctx, groupId, iconX, iconY, 11, r.accent);
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            const sectionLabel = sectionLabels[groupId] || r.label;
            ctx.fillStyle = 'rgba(248,241,232,0.98)'; this._fitFont(ctx, sectionLabel, cardW - 95, 700, 20);
            ctx.fillText(sectionLabel, x + 64, y + cardH / 2 - 10);
            ctx.fillStyle = 'rgba(230,226,220,0.68)'; ctx.font = `600 12px ${FONT}`;
            ctx.fillText(sectionCopy[groupId] || 'open section', x + 64, y + cardH / 2 + 13);
            ctx.textAlign = 'right'; ctx.fillStyle = `${r.accent}cc`;
            ctx.font = `700 20px ${FONT}`; ctx.fillText('›', x + cardW - 16, y + cardH / 2 + 1);
            const isNew = r.kids.some((k) => !seen.includes(k) && k !== 'play' && k !== 'settings');
            if (isNew) {
                this._drawAttentionBadge(ctx, x + cardW - 8, y - 8, 'NEW', '#ffce54');
            }
            this._hot(x, y, cardW, cardH, 'tab', r.target);
        }

        // The lower half becomes a small narrative hook rather than dead panel
        // space. New players get a clean three-beat promise; veterans get a
        // live reason to return through today's trial progress.
        const sectionEnd = sectionTop + sectionRows * cardH + (sectionRows - 1) * cardGap;
        const hookY = sectionEnd + 18;
        const hookH = mainTop + mainH - hookY - 24;
        if (hookH >= 110) {
            roundRectPath(ctx, navX, hookY, navW, hookH, 15);
            const hg = ctx.createLinearGradient(0, hookY, 0, hookY + hookH);
            hg.addColorStop(0, 'rgba(22,16,15,0.72)'); hg.addColorStop(1, 'rgba(50,20,9,0.60)');
            ctx.fillStyle = hg; ctx.fill();
            ctx.strokeStyle = 'rgba(255,142,62,0.20)'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            this._ember(ctx, navX + navW - 42, hookY + hookH - 18, 118, '#ff6b1f', 0.09);
            ctx.restore(); ctx.globalAlpha = 1;

            const day = currentDayNumber();
            const daily = save.daily || { day: 0, completed: [] };
            const dailyPicked = pickDailyChallenges(day);
            const done = completedDailyCount(daily, day, dailyPicked);
            const dailyTotal = dailyPicked.length;
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = '#ffad55'; ctx.font = `800 12px ${FONT}`;
            ctx.fillText(isFirst ? 'HOW A RUN WORKS' : `TODAY'S CHALLENGES  ${done}/${dailyTotal}`, navX + 22, hookY + 30);
            ctx.fillStyle = '#fff0d7';
            const hookTitle = isFirst ? 'SURVIVE ABOUT 15 MINUTES.' : 'BUILD. SURVIVE. RETURN.';
            this._fitFont(ctx, hookTitle, navW - 44, 700, 24);
            ctx.fillText(hookTitle, navX + 22, hookY + 62);
            ctx.fillStyle = 'rgba(244,230,210,0.62)'; ctx.font = `500 14px ${FONT}`;
            const hookCopy = isFirst
                ? 'Move, collect XP, choose powers, and survive Emberwood until dawn.'
                : 'Finish daily challenges, improve your build, and start another run.';
            this._fitFont(ctx, hookCopy, navW - 44, 500, 14, FONT, 11);
            ctx.fillText(hookCopy, navX + 22, hookY + 88);

            if (hookH >= 132) {
                const beats = isFirst ? ['MOVE', 'LEVEL UP', 'SURVIVE'] : ['START', 'BUILD', 'SURVIVE'];
                const beatY = hookY + hookH - 30;
                const beatW = (navW - 44) / beats.length;
                for (let i = 0; i < beats.length; i++) {
                    const bx = navX + 22 + i * beatW;
                    ctx.beginPath(); ctx.arc(bx + 6, beatY, 4, 0, TAU);
                    ctx.fillStyle = isFirst || i < done ? '#ff8a3a' : 'rgba(255,255,255,0.18)'; ctx.fill();
                    if (i < beats.length - 1) {
                        ctx.fillStyle = 'rgba(255,154,74,0.18)';
                        ctx.fillRect(bx + 18, beatY - 1, beatW - 26, 2);
                    }
                    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                    ctx.fillStyle = 'rgba(255,239,218,0.70)'; ctx.font = `800 10px ${FONT}`;
                    ctx.fillText(beats[i], bx + 16, beatY + 1);
                }
            }
        }

        // ── Keeper showcase (right) — hero, weapon, biome and difficulty ──
        const ch = getCharacter(save.selectedCharacter);
        const ap = resolveAppearance(save.cosmetics.equipped);
        const avatarAp = { ...ap, furColor: ap.furColor || ch.palette.fur };
        let avatarPose = null;
        const avatarState = (t % 3.6) > 3.0 ? 'cast' : 'idle';
        try {
            const frames = getHeroFrames(ch.id, ch, ap, !!ap.hatShape && ap.hatShape !== 'none');
            avatarPose = resolveHeroPose(frames, 'down', avatarState, 0);
        } catch (e) { avatarPose = null; }
        const startWeaponId = resolveStartingWeapon(save);
        const skin = resolveWeaponSkin(startWeaponId);
        const heldProp = resolveWeaponProp(startWeaponId);
        const heroAccent = ch.accent || '#ff7a1e';
        this._panel(ctx, heroX, mainTop, heroW, mainH, 'rgba(10,8,9,0.66)', `${heroAccent}55`, { corners: true });
        ctx.fillStyle = heroAccent; ctx.globalAlpha = 0.82;
        ctx.fillRect(heroX + 32, mainTop + 28, 42, 2); ctx.globalAlpha = 1;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,232,202,0.70)'; ctx.font = `800 13px ${FONT}`;
        ctx.fillText('SELECTED HERO', heroX + 84, mainTop + 29);
        ctx.textAlign = 'right'; ctx.fillStyle = `${heroAccent}`; ctx.font = `700 12px ${FONT}`;
        ctx.fillText('READY TO START', heroX + heroW - 30, mainTop + 29);

        const heroScale = Math.max(0.76, Math.min(1, (mainH - 470) / 220));
        const factY = mainTop + mainH - 92;
        const hx = heroX + heroW / 2, hy = mainTop + Math.min(285, mainH * 0.41);
        // Rotating broken rune arcs give the hero a deliberate portrait stage.
        ctx.save(); ctx.translate(hx, hy + 12); ctx.rotate(t * 0.08);
        ctx.strokeStyle = `${heroAccent}55`; ctx.lineWidth = 2;
        for (let i = 0; i < 8; i++) {
            ctx.beginPath(); ctx.arc(0, 0, 198 * heroScale, i * TAU / 8 + 0.05, i * TAU / 8 + 0.43); ctx.stroke();
        }
        ctx.rotate(-t * 0.17); ctx.strokeStyle = 'rgba(255,205,135,0.20)';
        for (let i = 0; i < 6; i++) {
            ctx.beginPath(); ctx.arc(0, 0, 174 * heroScale, i * TAU / 6 + 0.12, i * TAU / 6 + 0.68); ctx.stroke();
        }
        ctx.restore();
        this._pedestal(ctx, hx, hy + 152 * heroScale, t, heroAccent, 1.48 * heroScale);
        this._drawAvatar(ctx, hx, hy, 172 * heroScale, avatarAp, avatarPose, skin, t, heldProp, resolveCharacterHold(ch.id), ch.palette && ch.palette.face);
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#fff7e8';
        this._fitFont(ctx, `${ch.name} — ${ch.title}`, heroW - 80, 700, 31);
        ctx.fillText(`${ch.name} — ${ch.title}`, hx, hy + 205 * heroScale);
        ctx.fillStyle = 'rgba(255,255,255,0.58)';
        this._fitFont(ctx, ch.description || 'Keeper of the last light.', heroW - 54, 600, 14, FONT, 10);
        ctx.fillText(ch.description || 'Keeper of the last light.', hx, hy + 229 * heroScale);

        const customW = 190, customH = 36, customY = hy + 276;
        const fittedCustomY = Math.min(customY, factY - customH - 14);
        roundRectPath(ctx, hx - customW / 2, fittedCustomY, customW, customH, 18);
        ctx.fillStyle = 'rgba(18,14,15,0.86)'; ctx.fill();
        ctx.strokeStyle = `${heroAccent}88`; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#f8e8d2'; ctx.font = `800 12px ${FONT}`; ctx.textBaseline = 'middle';
        ctx.fillText('CUSTOMIZE HERO  ›', hx, fittedCustomY + customH / 2 + 1);
        this._hot(hx - customW / 2, fittedCustomY, customW, customH, 'tab', 'character');

        // Home mirrors the same effective selection used by launch validation.
        // A QA-only map lives in session state, never in the serialized save.
        const map = MAPS[state.selectedMap] || MAPS[MAP_ORDER[0]];
        const diff = DIFFICULTY[save.difficulty] || DIFFICULTY.normal;
        const weapon = GEAR[save.gear?.equipped?.weapon] || GEAR.w_cinderbolt;
        const difficultyValue = `${diff.id === 'easy' ? 'Easy' : diff.id === 'hard' ? 'Hard' : 'Normal'} · ${diff.label}`;
        const facts = [
            { label: 'MAP', value: map.name, color: map.accent || '#ffd27a' },
            { label: 'WEAPON', value: weapon.name, color: rarityColor(weapon.rarity || 'common') },
            { label: 'DIFFICULTY', value: difficultyValue, color: diff.color || '#cdd6e2' },
        ];
        const factGap = 10, factX = heroX + 24;
        const factW = (heroW - 48 - factGap * 2) / 3;
        for (let i = 0; i < facts.length; i++) {
            const f = facts[i], x = factX + i * (factW + factGap);
            roundRectPath(ctx, x, factY, factW, 62, 11);
            const factBg = ctx.createLinearGradient(x, factY, x + factW, factY + 62);
            factBg.addColorStop(0, `${f.color}1d`);
            factBg.addColorStop(0.62, 'rgba(18,15,16,0.90)');
            factBg.addColorStop(1, 'rgba(10,9,11,0.94)');
            ctx.fillStyle = factBg; ctx.fill();
            ctx.strokeStyle = `${f.color}66`; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.fillStyle = f.color; ctx.fillRect(x + 10, factY + 8, 22, 2);
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = f.color; ctx.font = `800 10px ${FONT}`; ctx.fillText(f.label, x + 12, factY + 24);
            ctx.fillStyle = '#fff4e3'; this._fitFont(ctx, f.value, factW - 24, 700, 15, FONT, 11);
            ctx.fillText(f.value, x + 12, factY + 47);
        }
        this._hot(factX, factY, heroW - 48, 62, 'tab', 'play');

        // ── Living status rail ──
        const st = (save && save.stats) || {};
        const mm = Math.floor((st.bestTime ?? 0) / 60), ss = Math.floor((st.bestTime ?? 0) % 60);
        this._panel(ctx, left, statusY, right - left, statusH, 'rgba(9,7,8,0.84)', 'rgba(255,150,70,0.18)');
        const liveA = 0.55 + 0.45 * Math.sin(t * 2.4);
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        this._ember(ctx, left + 25, statusY + statusH / 2, 24, '#ff7a1e', 0.16 + liveA * 0.08);
        ctx.restore(); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(left + 25, statusY + statusH / 2, 5 + liveA * 1.5, 0, TAU);
        ctx.fillStyle = '#ff8a3a'; ctx.fill();
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffd49a'; ctx.font = `800 12px ${FONT}`;
        ctx.fillText((st.runs ?? 0) > 0 ? 'READY FOR ANOTHER RUN' : 'READY FOR YOUR FIRST RUN', left + 48, statusY + statusH / 2 + 1);
        const stats = [
            ['RUNS', st.runs ?? 0],
            ['BEST', `${mm}:${String(ss).padStart(2, '0')}`],
            ['FOES FELLED', (st.totalKills ?? 0).toLocaleString()],
        ];
        const statW = 145;
        for (let i = 0; i < stats.length; i++) {
            const x = right - stats.length * statW + i * statW;
            if (i > 0) { ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x, statusY + 13, 1, statusH - 26); }
            ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.42)'; ctx.font = `800 9px ${FONT}`;
            ctx.fillText(stats[i][0], x + statW / 2, statusY + 18);
            ctx.fillStyle = '#fff1df'; ctx.font = `800 15px ${FONT}`;
            ctx.fillText(String(stats[i][1]), x + statW / 2, statusY + 37);
        }
    }

    // Small vector sigils for HOME's section cards. They stay crisp at every
    // DPR and make the destinations recognisable before the labels are read.
    _drawHomeGroupGlyph(ctx, id, cx, cy, s, color) {
        ctx.save();
        ctx.strokeStyle = color; ctx.fillStyle = color;
        ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        if (id === 'gHero') {
            ctx.beginPath(); ctx.arc(cx, cy - s * 0.35, s * 0.38, 0, TAU); ctx.stroke();
            ctx.beginPath(); ctx.arc(cx, cy + s * 0.8, s * 0.78, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
        } else if (id === 'gArmory') {
            ctx.beginPath(); ctx.moveTo(cx - s * 0.75, cy + s * 0.75); ctx.lineTo(cx + s * 0.72, cy - s * 0.72); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx + s * 0.75, cy + s * 0.75); ctx.lineTo(cx - s * 0.72, cy - s * 0.72); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx - s * 0.9, cy + s * 0.45); ctx.lineTo(cx - s * 0.45, cy + s * 0.9); ctx.moveTo(cx + s * 0.9, cy + s * 0.45); ctx.lineTo(cx + s * 0.45, cy + s * 0.9); ctx.stroke();
        } else if (id === 'gShop') {
            roundRectPath(ctx, cx - s * 0.82, cy - s * 0.15, s * 1.64, s * 0.98, 3); ctx.stroke();
            ctx.beginPath(); ctx.arc(cx, cy - s * 0.12, s * 0.82, Math.PI, TAU); ctx.stroke();
            ctx.fillRect(cx - 1.5, cy + s * 0.16, 3, s * 0.36);
        } else if (id === 'gProgress') {
            ctx.beginPath();
            for (let i = 0; i < 10; i++) {
                const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? s * 0.42 : s;
                const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.closePath(); ctx.stroke();
        } else {
            ctx.beginPath(); ctx.arc(cx, cy, s * 0.42, 0, TAU); ctx.stroke();
            for (let i = 0; i < 8; i++) {
                const a = i * TAU / 8;
                ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * s * 0.62, cy + Math.sin(a) * s * 0.62);
                ctx.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s); ctx.stroke();
            }
        }
        ctx.restore();
    }

    // Section chrome + content: the corner wordmark, screen title/description,
    // group bar (+ sub-tab pills) and the active screen. Everything below the
    // backdrop for every screen EXCEPT the HOME title screen.
    _drawSections(ctx, state) {
        const sa = this._sa();
        const save = state.saveData;
        const t = this._t;
        // Header: title (higgsfield ember wordmark, or animated gradient text as
        // a fallback) + animated cached under-glow + coin bank.
        const ui = getMenuImages();
        const tx = sa.left + 56;
        const off = Math.sin(t * 1.2) * 0.5 + 0.5;
        const logoH = 62;
        const logoW = ui.title ? ui.title.width * (logoH / ui.title.height) : 420;
        // Cached-glow under-glow behind the wordmark (replaces per-frame shadowBlur).
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        this._ember(ctx, tx + logoW * 0.5, sa.top + 52, 160, '#ff7a1e', 0.22 + Math.sin(t * 1.2) * 0.05);
        ctx.restore(); ctx.globalAlpha = 1;
        if (ui.title) {
            ctx.drawImage(ui.title, tx, sa.top + 14, logoW, logoH);
        } else {
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            const tg = ctx.createLinearGradient(tx, 0, tx + 420, 0);
            tg.addColorStop(Math.max(0, off - 0.3), '#ffb43a');
            tg.addColorStop(off, '#fff1b8');
            tg.addColorStop(Math.min(1, off + 0.3), '#ffb43a');
            ctx.fillStyle = tg;
            ctx.font = `800 52px ${HEAD}`;
            ctx.fillText('EMBERWAKE', tx, sa.top + 70);
        }
        // Ember-rule under the title.
        const ruleW = Math.min(logoW, 460);
        const rule = ctx.createLinearGradient(tx, 0, tx + ruleW, 0);
        rule.addColorStop(0, 'rgba(255,122,30,0.5)'); rule.addColorStop(1, 'rgba(255,122,30,0)');
        ctx.fillStyle = rule; ctx.fillRect(tx, sa.top + 84, ruleW, 2);
        // Coin bank pill (right-aligned).
        this._coinBank(ctx, INTERNAL_WIDTH - sa.right - 56, sa.top + 54, save.totalCoins);

        // Screen title + one-line plain-English description in the header strip
        // (between the wordmark and the coin bank) — every screen says what it
        // IS, in the same spot, so the menu explains itself past the tour.
        {
            const tabDef = MENU_TABS.find((m) => m.id === (state.menuTab || 'play')) || MENU_TABS[0];
            const desc = TAB_DESCRIPTIONS[tabDef.id] || '';
            const hx = tx + logoW + 56;
            const hMax = (INTERNAL_WIDTH - sa.right - 300) - hx;
            if (hMax > 220) {
                ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
                ctx.fillStyle = tabDef.accent || '#ffce54';
                this._fitFont(ctx, tabDef.label, hMax, 700, 26);
                ctx.fillText(tabDef.label, hx, sa.top + 44);
                ctx.fillStyle = 'rgba(235,240,248,0.62)';
                ctx.font = `500 15px ${FONT}`;
                ctx.fillText(this._ellip(ctx, desc, hMax), hx, sa.top + 68);
            }
        }

        this._drawTabBar(ctx, state);

        const tab = state.menuTab || 'play';
        // Tab-switch transition (the Hades-style beat): the incoming screen
        // slides in ~26px from the right over ~180ms with a fade. Only the
        // content moves — chrome (bar/header) stays planted. Hotspots are
        // registered at the untranslated rest positions; the offset lives for
        // under 200ms, so taps land where the content is about to settle.
        if (this._transTab !== tab) { this._transTab = tab; this._transT0 = this._clockT; }
        // NaN-guard without swallowing the legitimate 0 on the switch frame (a
        // `|| 1` here made frame 1 render at rest, then frame 2 snap dim — a
        // visible flash on every switch).
        const rawK = (this._clockT - (this._transT0 ?? 0)) / 0.18;
        const transK = this._reducedMotion ? 1
            : Number.isFinite(rawK) ? Math.min(1, Math.max(0, rawK)) : 1;
        const transE = 1 - Math.pow(1 - transK, 3);
        ctx.save();
        if (transE < 1) { ctx.globalAlpha = transE; ctx.translate((1 - transE) * 26, 0); }
        if (tab === 'play') this._drawPlay(ctx, state);
        else if (tab === 'modes') this._drawModes(ctx, state);
        else if (tab === 'skills') this._drawSkills(ctx, state);
        else if (tab === 'attune') this._drawAttune(ctx, state);
        else if (tab === 'loadout') this._drawLoadout(ctx, state);
        else if (tab === 'character') this._drawCharacter(ctx, state);
        else if (tab === 'shop') this._drawShop(ctx, state);
        else if (tab === 'boutique') this._drawBoutique(ctx, state);
        else if (tab === 'battlepass') this._drawBattlePass(ctx, state);
        else if (tab === 'stats') this._drawStats(ctx, state);
        else if (tab === 'settings') this._drawSettings(ctx, state);
        ctx.restore();

    }

    // Group geometry shared by the bar draw and _tabRectFor (tour spotlight):
    // groups whose every child tab is locked stay hidden, so a new player still
    // starts with a near-empty bar (PLAY + SHOP + SETTINGS).
    _visibleGroups(save) {
        return MENU_GROUPS
            .map((g) => ({ ...g, kids: g.tabs.filter((id) => tabUnlocked(id, save)) }))
            .filter((g) => g.kids.length > 0);
    }

    // In-section top bar: ‹ HOME + ONLY the current section's own screens as
    // pills. Sections deliberately do NOT carry the six-group bar any more —
    // HOME is the hub, and a section shows itself, not doors to everywhere
    // else (the last "every screen leads to every screen" leak). The old
    // sub-tab pill row is gone too: the section's screens ARE the bar.
    _drawTabBar(ctx, state) {
        const activeTab = state.menuTab;
        const save = state.saveData || {};
        const groups = this._visibleGroups(save);
        const seen = (save.onboarding && save.onboarding.tabsSeen) || [];
        // Pill-badge sources: unclaimed Battle-Pass levels + unfinished dailies
        // (the Today's-Trials strip lives on MODES). Cheap per-frame reads.
        const day = currentDayNumber();
        const dd = save.daily || { day: 0, completed: [] };
        const dailyPicked = pickDailyChallenges(day);
        const doneN = completedDailyCount(dd, day, dailyPicked);
        const dailiesLeft = ((save.stats?.runs ?? 0) >= 1) && doneN < dailyPicked.length;
        const bpClaimed = (save.battlePass && save.battlePass.claimed) || [];
        const bpLevel = bpProgress(save.battlePass?.xp ?? 0).level;
        let bpClaimable = false;
        for (let lv = 1; lv <= bpLevel; lv++) { if (!bpClaimed.includes(lv)) { bpClaimable = true; break; } }
        const sa = this._sa();
        const cssScale = (this.renderer.cssWidth || INTERNAL_WIDTH) / INTERNAL_WIDTH;
        const phone = isPhoneLandscapeViewport(
            this.renderer.cssWidth ?? INTERNAL_WIDTH,
            this.renderer.cssHeight ?? INTERNAL_HEIGHT,
        ) && activeTab === 'character';
        const phoneBar = phone ? computePhoneSectionBarLayout(sa, cssScale) : null;
        const y = phone ? phoneBar.y : sa.top + 104;
        const h = phone ? phoneBar.h : 62;
        const time = this._t || 0;
        const navRects = [];
        // ‹ HOME chip at the far left — the only way OUT of a section
        // (Esc does the same).
        const homeW = phone ? phoneBar.homeW : 120;
        {
            const hx0 = phone ? phoneBar.home.x : sa.left + 56;
            roundRectPath(ctx, hx0, y, homeW, h, 12);
            ctx.fillStyle = 'rgba(20,15,13,0.8)'; ctx.fill();
            ctx.strokeStyle = 'rgba(255,206,122,0.45)'; ctx.lineWidth = 2; ctx.stroke();
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = '#ffce7a';
            const homeLabel = phone ? 'HOME' : '‹ HOME';
            this._fitFont(ctx, homeLabel, homeW - 18, 700,
                phone ? phoneBar.fontPx : 20, FONT, 22);
            ctx.fillText(homeLabel, hx0 + homeW / 2, y + h / 2 + 1);
            this._hot(hx0, y, homeW, h, 'tab', 'home');
            navRects.push({ id: 'home', x: hx0, y, w: homeW, h });
        }
        const activeGroup = groups.find((g) => g.kids.includes(activeTab)) || groups[0] || { kids: [], accent: '#ffce54' };
        // Phone Character keeps PLAY as a durable escape beside CHARACTER.
        // Relic ATTUNE remains a separately unlocked Home route; Hero Rites
        // live inside Character and never impersonate that relic destination.
        const kids = phone && activeTab === 'character'
            ? ['play', 'character']
            : phone && !activeGroup.kids.includes('play')
                ? ['play', ...activeGroup.kids] : activeGroup.kids;
        const x0 = phone ? phoneBar.firstTabX : sa.left + 56 + homeW + 14;
        const gap = phone ? phoneBar.gap : 12, tabW = phone ? phoneBar.tabW : 210;
        // The inactive-pill fill is a constant vertical gradient (x-independent);
        // build it once per layout and reuse across pills + frames.
        if (this._tabGradY !== y || this._tabGradH !== h) {
            const tgr = ctx.createLinearGradient(0, y, 0, y + h);
            tgr.addColorStop(0, '#1c1614'); tgr.addColorStop(1, '#141010');
            this._tabGrad = tgr; this._tabGradY = y; this._tabGradH = h;
        }
        let activeX = x0;
        for (let i = 0; i < kids.length; i++) {
            const id = kids[i];
            const td = MENU_TABS.find((m) => m.id === id) || { id, label: id.toUpperCase(), accent: activeGroup.accent };
            const x = x0 + i * (tabW + gap);
            const active = id === activeTab;
            const accent = td.accent || activeGroup.accent || '#ffce54';
            if (active) activeX = x;
            roundRectPath(ctx, x, y, tabW, h, 12);
            ctx.fillStyle = active ? 'rgba(20,15,13,0.92)' : this._tabGrad; ctx.fill();
            // Active pill: forged-plate relief + breathing glow + ember rim
            // (the lit-metal treatment the group chips used to get).
            if (active) {
                const plate = getMenuImages().btnPlate;
                if (plate) {
                    ctx.save(); roundRectPath(ctx, x, y, tabW, h, 12); ctx.clip();
                    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.22;
                    ctx.drawImage(plate, x, y, tabW, h); ctx.restore();
                }
                ctx.save(); ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = 0.24 + Math.sin(time * 4) * 0.10;
                ctx.drawImage(getGlowSprite(accent), x - 10, y - 10, tabW + 20, h + 20);
                ctx.restore(); ctx.globalAlpha = 1;
                this._emberRim(ctx, x + 6, y, tabW - 12, h, time, i * 0.9);
            }
            roundRectPath(ctx, x, y, tabW, h, 12);
            ctx.strokeStyle = active ? accent : 'rgba(255,255,255,0.10)';
            ctx.lineWidth = active ? 2.5 : 2; ctx.stroke();
            if (active) {
                ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(x + 12, y + 2.5); ctx.lineTo(x + tabW - 12, y + 2.5); ctx.stroke();
            }
            ctx.fillStyle = active ? accent : 'rgba(235,240,248,0.85)';
            this._fitFont(ctx, td.label, tabW - 24, 700,
                phone ? phoneBar.fontPx : 22, HEAD,
                phone ? 25 : 12);
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(td.label, x + tabW / 2, y + h / 2 + 1);
            if (!active) {
                ctx.fillStyle = accent; ctx.globalAlpha = 0.6;
                ctx.fillRect(x + 14, y + h - 7, tabW - 28, 3); ctx.globalAlpha = 1;
            }
            this._hot(x, y, tabW, h, 'tab', id);
            navRects.push({ id, x, y, w: tabW, h });
            // Badges: one-time NEW pill on a freshly unlocked sibling screen,
            // else an accent dot when the screen holds something actionable.
            const isNew = !active && !seen.includes(id) && id !== 'play' && id !== 'settings';
            const hasDot = (id === 'battlepass' && bpClaimable) || (id === 'modes' && dailiesLeft);
            if (isNew) {
                this._drawAttentionBadge(ctx, x + tabW + 6, y - 8, 'NEW', '#ffce54');
            } else if (hasDot) {
                this._drawAttentionBadge(ctx, x + tabW + 6, y - 8,
                    id === 'battlepass' ? 'CLAIM' : 'GOAL', accent);
            }
        }
        // Sliding accent indicator easing toward the active pill on switch.
        const dt = this._dt();
        const targetX = activeX + tabW * 0.15, targetW = tabW * 0.7;
        if (this._tabIndicX == null || this._tabStale) { this._tabIndicX = targetX; this._tabIndicW = targetW; }
        else {
            const k = 1 - Math.exp(-14 * dt);
            this._tabIndicX += (targetX - this._tabIndicX) * k;
            this._tabIndicW += (targetW - this._tabIndicW) * k;
        }
        ctx.fillStyle = activeGroup.accent || '#ffce54';
        ctx.fillRect(this._tabIndicX, y + h - 4, this._tabIndicW, 3);
        // Phone pills grow to the 44-CSS-px floor. Preserve the original 18px
        // gap below the bar by pushing content down by exactly the height delta.
        this._subRowH = phone ? phoneBar.subRowH : 0;
        if (phone && activeTab === 'character') {
            const required = ['home', 'play', 'character'];
            const requiredRects = navRects.filter((rect) => required.includes(rect.id));
            const complete = required.every((id) => requiredRects.some((rect) => rect.id === id));
            const rawMinCss = Math.min(...requiredRects
                .map((rect) => Math.min(rect.w, rect.h) * cssScale));
            this._lastCollectionNavMinTouchCss = Math.round(rawMinCss * 10) / 10;
            this._lastCollectionNavTouchSafe = complete && rawMinCss >= 44;
        }
    }

    // ── PLAY ───────────────────────────────────────────────────────────
    _drawPlay(ctx, state) {
        const c = this._contentRect();
        const save = state.saveData;

        // Left: character preview + selection card.
        const cardW = c.w * 0.42;
        this._panel(ctx, c.x, c.y, cardW, c.h, null, undefined, { corners: true });
        const ccx = c.x + cardW / 2;
        const ch = getCharacter(save.selectedCharacter);
        const ap = resolveAppearance(save.cosmetics.equipped);
        // Avatar reflects the selected character's color unless a fur cosmetic
        // overrides it (cosmetics apply on top of the character).
        // The menu model is the REAL in-game character sprite (correct
        // silhouette + palette), with equipped cosmetics layered over it.
        const avatarAp = { ...ap, furColor: ap.furColor || ch.palette.fur };
        let avatarPose = null;
        // Front-facing idle, with a brief cast-pose flash every few seconds so
        // body, cosmetics and held wand preview the same in-game frame.
        const avatarState = (this._t % 3.6) > 3.0 ? 'cast' : 'idle';
        try {
            const frames = getHeroFrames(ch.id, ch, ap, !!ap.hatShape && ap.hatShape !== 'none');
            avatarPose = resolveHeroPose(frames, 'down', avatarState, 0);
        } catch (e) { avatarPose = null; }
        // The selected starting weapon drives the themed skin overlay so the
        // preview matches the in-game look (character + cosmetics + weapon).
        const startWeaponId = resolveStartingWeapon(save);
        const skin = resolveWeaponSkin(startWeaponId);
        // …and the in-hand held prop, so the preview shows the wand/staff the
        // hero actually carries in-game.
        const heldProp = resolveWeaponProp(startWeaponId);
        // this._t (wall-clock seconds, frame-rate independent) is set in draw()
        // and drives the avatar's subtle idle motion.
        // Forge pedestal (glowing rune shrine) staged BEHIND the hero, tinted to
        // the character's accent so switching heroes recolours the shrine. Scaled
        // down on short cards so its ring never bleeds into the CHARACTER label.
        const pedSc = Math.max(0.55, Math.min(1, c.h / 640));
        this._pedestal(ctx, ccx, c.y + c.h * 0.26 + 96 * pedSc, this._t, ch.accent || '#ff7a1e', pedSc);
        this._drawAvatar(ctx, ccx, c.y + c.h * 0.26, 118, avatarAp, avatarPose, skin, this._t, heldProp, resolveCharacterHold(ch.id), ch.palette && ch.palette.face);
        // Themed-skin caption ABOVE the name (with real clearance so long names
        // never collide with it), then the ellipsized name line.
        const nameY = c.y + c.h * 0.46;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (skin) {
            ctx.fillStyle = skin.accent; ctx.font = `700 16px ${FONT}`;
            ctx.fillText(`${skin.name} skin`, ccx, nameY - 32);
        }
        ctx.fillStyle = '#fff'; ctx.font = `700 30px ${FONT}`;
        ctx.fillText(this._ellip(ctx, `${ch.name} — ${ch.title}`, cardW - 44), ccx, nameY);
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `500 17px ${FONT}`;
        this._wrapText(ctx, ch.description, ccx, c.y + c.h * 0.485, cardW - 60, 22, 2);
        // Hero SIGNATURE — its defining identity (accent name + flavor blurb),
        // the mechanical fingerprint applied at run start by CharacterSystem.
        if (ch.signature) {
            ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = ch.accent || '#ffce54'; ctx.font = `800 18px ${FONT}`;
            ctx.fillText(this._ellip(ctx, `✦ ${ch.signature.name}`, cardW - 44), ccx, c.y + c.h * 0.55);
            ctx.fillStyle = 'rgba(255,238,196,0.85)'; ctx.font = `500 15px ${FONT}`;
            ctx.fillText(this._ellip(ctx, ch.signature.blurb, cardW - 48), ccx, c.y + c.h * 0.578);
        }

        // Character picker: a 3-wide grid of every selectable hero. Fit-driven —
        // chipH fills the band between the CHARACTER label and the Battle Pass
        // bar and is capped, never floored above what the band allows, so the
        // grid ALWAYS sits above the Battle Pass label even when a large vertical
        // safe-area shrinks the card (font/swatch scale down instead of the grid
        // overflowing). The 14px floor is only a degenerate-panel sanity minimum.
        // labelY sits BELOW the signature block (name 0.55h + blurb 0.578h); the
        // grid is fit-driven (chipH capped/floored) between here and the BP bar,
        // so pushing the label down just trims chip height on short cards.
        const labelY = c.y + c.h * 0.62;
        ctx.font = `700 18px ${FONT}`;
        ctx.fillStyle = '#cdd6e2'; ctx.textAlign = 'left';
        ctx.fillText('CHARACTER', c.x + 30, labelY);
        const cols = 3, gap = 10;
        const cRows = Math.ceil(CHARACTER_IDS.length / cols);
        const chipW = (cardW - 60 - gap * (cols - 1)) / cols;
        const gridY = labelY + 14;
        const gridBottom = c.y + c.h * 0.86 - 34;   // clearance above the BP label
        const chipH = Math.max(14, Math.min(46, (gridBottom - gridY - gap * (cRows - 1)) / cRows));
        const chipFont = Math.round(Math.max(11, Math.min(17, chipH * 0.44)));
        const swatchR = Math.min(10, chipH * 0.28);
        for (let i = 0; i < CHARACTER_IDS.length; i++) {
            const id = CHARACTER_IDS[i];
            const def = CHARACTERS[id];
            const col = i % cols, row = Math.floor(i / cols);
            const x = c.x + 30 + col * (chipW + gap);
            const y = gridY + row * (chipH + gap);
            const selected = id === save.selectedCharacter;
            roundRectPath(ctx, x, y, chipW, chipH, 9);
            ctx.fillStyle = selected ? 'rgba(255,206,84,0.16)' : 'rgba(255,255,255,0.04)';
            ctx.fill();
            ctx.strokeStyle = selected ? '#ffce54' : def.accent; ctx.lineWidth = selected ? 3 : 2; ctx.stroke();
            // Color swatch.
            ctx.fillStyle = def.palette.fur;
            ctx.beginPath(); ctx.arc(x + 20, y + chipH / 2, swatchR, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = selected ? '#ffce54' : '#fff'; ctx.font = `700 ${chipFont}px ${FONT}`;
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(this._ellip(ctx, def.name, chipW - 42), x + 36, y + chipH / 2);
            this._hot(x, y, chipW, chipH, 'selectCharacter', { id });
        }

        // Battle-pass mini progress.
        const prog = bpProgress(save.battlePass.xp);
        const barY = c.y + c.h * 0.86;
        const barW = cardW - 80;
        const barX = c.x + 40;
        ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = `600 20px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText(`Battle Pass — Lv ${prog.level}${prog.atMax ? ' (MAX)' : ''}`, barX, barY - 16);
        roundRectPath(ctx, barX, barY, barW, 18, 9); ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill();
        roundRectPath(ctx, barX, barY, barW * clamp01(prog.fraction), 18, 9); ctx.fillStyle = '#9a6cff'; ctx.fill();

        // ── Right column: equipped loadout + biome / difficulty / trials +
        // START. The whole stack is laid out top→down with ONE vertical scale
        // `s` so it always fits c.h — on short panels (iPhone landscape, where
        // cover-fit crop shrinks the content rect) every row + gap compresses
        // instead of overrunning the START button. ──────────────────────────
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        const t = this._t || 0;
        const rx = c.x + cardW + 36;
        const rw = c.w - cardW - 36;
        const innerX = rx + 28, innerW = rw - 56;
        this._panel(ctx, rx, c.y, rw, c.h, null, undefined, { corners: true });
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#cdd6e2'; ctx.font = `700 24px ${HEAD}`;
        ctx.fillText('Equipped Loadout', innerX, c.y + 38);

        const eq = save.gear.equipped;
        const curDiff = state.difficulty || 'normal';
        const activeMods = state.selectedModifiers || [];

        // START reserved at the bottom; the four sections fit in the gap above.
        const startH = clamp(c.h * 0.12, 56, 84);
        const startY = c.y + c.h - startH;
        const top = c.y + 52;
        const avail = startY - top - 12;
        const nGear = GEAR_CATEGORIES.length;
        const tRows = Math.ceil(RUN_MODIFIERS.length / 3); // Trials chip grid rows (3 cols)
        const N = { gearRow: 52, gearGap: 9, sec: 18, lbl: 30, biome: 60, diff: 46, chip: 38, chipGap: 8 };
        // The TRUE laid-out height for a given scale. Labels + chip rows have
        // their own lower floors (so text stays legible), which is exactly why
        // a naive avail/needed under-budgets — so we MEASURE with the real
        // floors and binary-search the largest scale that fits `avail`. This
        // keeps the stated "always fits c.h" invariant on any panel (the floors
        // only affect how big things look when there's room, never overlap).
        const lblScale = (s) => Math.max(s, 0.82);
        const chipScale = (s) => Math.max(s, 0.8);
        const fitH = (s) =>
            nGear * N.gearRow * s + (nGear - 1) * N.gearGap * s + N.sec * s
            + N.lbl * lblScale(s) + N.biome * s + N.sec * s
            + N.lbl * lblScale(s) + N.diff * s + N.sec * s   // Patron row (reuses diff height)
            + N.lbl * lblScale(s) + N.diff * s + N.sec * s
            + N.lbl * lblScale(s) + (tRows * N.chip * chipScale(s) + (tRows - 1) * N.chipGap * s) + N.sec * s;
        let s = 1;
        // Floor: low enough that even a degenerate ultra-short panel keeps every
        // section's row from overlapping the next (the label/chip legibility
        // floors set an irreducible minimum; seven sections need more shrink
        // room than six did). Real devices land far above this.
        const S_FLOOR = 0.12;
        if (fitH(1) > avail) {                        // doesn't fit at full size → shrink to fit
            let lo = S_FLOOR, hi = 1;
            for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fitH(mid) <= avail) lo = mid; else hi = mid; }
            s = lo;
        }
        s = clamp(s, S_FLOOR, 1);
        const lblS = lblScale(s);                     // labels shrink less (stay legible)
        const gearRow = N.gearRow * s, gearGap = N.gearGap * s, sec = N.sec * s,
            lbl = N.lbl * lblS, biomeRow = N.biome * s, diffRow = N.diff * s,
            chipRow = N.chip * chipScale(s), chipGap = N.chipGap * s;
        const fs = (px) => Math.round(px * lblS);     // font-size scaler

        let y = top;
        // Loadout rows.
        for (const cat of GEAR_CATEGORIES) {
            const item = GEAR[eq[cat]];
            const col = item ? rarityColor(item.rarity) : 'rgba(255,255,255,0.25)';
            roundRectPath(ctx, innerX, y, innerW, gearRow, 10);
            ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
            ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `600 ${fs(16)}px ${FONT}`;
            ctx.fillText(GEAR_CATEGORY_LABELS[cat], innerX + 16, y + gearRow * 0.40);
            ctx.fillStyle = '#fff'; ctx.font = `700 ${fs(21)}px ${FONT}`;
            ctx.fillText(item ? item.name : '— empty —', innerX + 16, y + gearRow * 0.82);
            y += gearRow + gearGap;
        }
        y += sec - gearGap;

        // Biome selector.
        ctx.fillStyle = '#cdd6e2'; ctx.font = `700 ${fs(20)}px ${HEAD}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText('Biome', innerX, y + lbl * 0.72);
        y += lbl;
        const bw = (innerW - 14 * (MAP_ORDER.length - 1)) / MAP_ORDER.length;
        const statusByMap = new Map((state.mapUnlockStatuses || []).map((status) => [status.mapId, status]));
        const selMap = state.selectedMap ?? MAP_ORDER[0];
        for (let i = 0; i < MAP_ORDER.length; i++) {
            const m = MAPS[MAP_ORDER[i]];
            const status = statusByMap.get(m.id) || {
                unlocked: i === 0,
                campaignUnlocked: i === 0,
                qaBypass: false,
                requiredMapId: i > 0 ? MAP_ORDER[i - 1] : null,
                defeatedCount: 0,
                requiredCount: i > 0 ? 3 : 0,
            };
            const unlocked = status.unlocked === true;
            const campaignUnlocked = status.campaignUnlocked === true;
            const qaActive = status.qaBypass === true;
            const qaOnly = qaActive && !campaignUnlocked;
            const requiredMap = status.requiredMapId ? MAPS[status.requiredMapId] : null;
            const sel = m.id === selMap;
            const bx = innerX + i * (bw + 14);
            roundRectPath(ctx, bx, y, bw, biomeRow, 10);
            ctx.fillStyle = sel ? 'rgba(255,206,84,0.16)' : 'rgba(255,255,255,0.04)'; ctx.fill();
            if (sel) this._selGlow(ctx, bx, y, bw, biomeRow, 10, '#ffce54', t);
            ctx.strokeStyle = sel ? '#ffce54' : unlocked ? m.accent : 'rgba(255,255,255,0.12)';
            ctx.lineWidth = sel ? 3 : 2; ctx.stroke();
            ctx.globalAlpha = unlocked ? 1 : 0.5;
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = '#fff'; ctx.font = `700 ${fs(18)}px ${FONT}`;
            ctx.fillText(m.name, bx + 14, y + biomeRow * 0.42);
            ctx.fillStyle = unlocked ? m.accent : 'rgba(255,255,255,0.6)'; ctx.font = `600 ${fs(12)}px ${FONT}`;
            const progress = `${status.defeatedCount || 0}/${status.requiredCount || 3}`;
            const subline = qaActive
                ? 'QA MODE · credit off'
                : campaignUnlocked
                    ? m.subtitle
                    : `LOCKED · ${requiredMap?.name || 'prior map'} ${progress}`;
            ctx.fillText(subline, bx + 14, y + biomeRow * 0.76);
            ctx.globalAlpha = 1;
            const accessLabel = status.qaBypass === true
                ? `Select ${m.name}. QA access; campaign credit disabled.${qaOnly && requiredMap ? ` Honest progress: ${status.defeatedCount || 0} of ${status.requiredCount || 3} ${requiredMap.name} bosses defeated.` : ''}`
                : campaignUnlocked
                    ? `Select ${m.name}. Campaign map available.`
                    : `Select ${m.name}. Locked. Defeat all three ${requiredMap?.name || 'previous map'} bosses; ${status.defeatedCount || 0} of ${status.requiredCount || 3} defeated.`;
            this._hot(bx, y, bw, biomeRow, 'selectMap', { id: m.id }, accessLabel);
        }
        y += biomeRow + sec;

        // Patron row (5 allegiances; one row). Selecting one biases the level-up
        // draft toward its element/role. Tapping the active Patron clears it.
        const selPatron = state.selectedPatron || null;
        const pdef = selPatron ? PATRONS[selPatron] : null;
        ctx.fillStyle = '#cdd6e2'; ctx.font = `700 ${fs(19)}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(pdef ? `Patron — ${pdef.name}, ${pdef.title}` : 'Patron — none (balanced draft)', innerX, y + lbl * 0.72);
        y += lbl;
        const pW = (innerW - 10 * (PATRON_IDS.length - 1)) / PATRON_IDS.length;
        for (let i = 0; i < PATRON_IDS.length; i++) {
            const p = PATRONS[PATRON_IDS[i]];
            const px = innerX + i * (pW + 10);
            const sel = selPatron === p.id;
            roundRectPath(ctx, px, y, pW, diffRow, 9);
            ctx.fillStyle = sel ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.03)'; ctx.fill();
            if (sel) this._selGlow(ctx, px, y, pW, diffRow, 9, p.color, t);
            ctx.strokeStyle = sel ? p.color : 'rgba(255,255,255,0.16)'; ctx.lineWidth = sel ? 3 : 2; ctx.stroke();
            ctx.fillStyle = sel ? p.color : '#fff'; ctx.font = `700 ${fs(16)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(p.name, px + pW / 2, y + diffRow / 2);
            this._hot(px, y, pW, diffRow, 'selectPatron', { id: p.id });
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        y += diffRow + sec;

        // Difficulty row (3 tiers).
        ctx.fillStyle = '#cdd6e2'; ctx.font = `700 ${fs(19)}px ${HEAD}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText('Difficulty', innerX, y + lbl * 0.72);
        y += lbl;
        const dW = (innerW - 20) / 3;
        for (let i = 0; i < DIFFICULTY_ORDER.length; i++) {
            const d = DIFFICULTY[DIFFICULTY_ORDER[i]];
            const dx = innerX + i * (dW + 10);
            const sel = curDiff === d.id;
            roundRectPath(ctx, dx, y, dW, diffRow, 9);
            ctx.fillStyle = sel ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.03)'; ctx.fill();
            if (sel) this._selGlow(ctx, dx, y, dW, diffRow, 9, d.color, t);
            ctx.strokeStyle = sel ? d.color : 'rgba(255,255,255,0.14)'; ctx.lineWidth = sel ? 3 : 2; ctx.stroke();
            ctx.fillStyle = sel ? d.color : '#fff'; ctx.font = `700 ${fs(17)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(d.label, dx + dW / 2, y + diffRow / 2);
            this._hot(dx, y, dW, diffRow, 'setDifficulty', d.id);
        }
        y += diffRow + sec;

        // Trials toggles. Each active one stacks into a "Pact" — the label shows
        // the live Pact tier + the (capped) XP & coin reward the stack pays.
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        const sumBonus = (key) => activeMods.reduce((a, id) => {
            const m = RUN_MODIFIERS.find((x) => x.id === id); return a + (m ? (m[key] || 0) : 0);
        }, 0);
        const xpPct = Math.round(Math.min(sumBonus('xpBonus'), RUN_MODIFIER_MAX_BONUS) * 100);
        const coinPct = Math.round(Math.min(sumBonus('coinBonus'), RUN_MODIFIER_MAX_BONUS) * 100);
        const tier = pactTier(activeMods.length);
        if (activeMods.length > 0) {
            ctx.fillStyle = '#ffce54'; ctx.font = `800 ${fs(19)}px ${FONT}`;
            ctx.fillText(`Trials — PACT ${tier}`, innerX, y + lbl * 0.72);
            ctx.textAlign = 'right'; ctx.fillStyle = '#5fd36a'; ctx.font = `700 ${fs(16)}px ${FONT}`;
            ctx.fillText(`+${xpPct}% XP   +${coinPct}% coins`, innerX + innerW, y + lbl * 0.72);
            ctx.textAlign = 'left';
        } else {
            ctx.fillStyle = '#cdd6e2'; ctx.font = `700 ${fs(19)}px ${FONT}`;
            ctx.fillText('Trials — stack curses to forge a Pact', innerX, y + lbl * 0.72);
        }
        y += lbl;
        const tcols = 3, tgap = 8;
        const tW = (innerW - tgap * (tcols - 1)) / tcols;
        for (let i = 0; i < RUN_MODIFIERS.length; i++) {
            const m = RUN_MODIFIERS[i];
            const col = i % tcols, row = Math.floor(i / tcols);
            const mx = innerX + col * (tW + tgap), my = y + row * (chipRow + chipGap);
            const on = activeMods.includes(m.id);
            roundRectPath(ctx, mx, my, tW, chipRow, 8);
            ctx.fillStyle = on ? 'rgba(255,206,84,0.16)' : 'rgba(255,255,255,0.03)'; ctx.fill();
            if (on) this._selGlow(ctx, mx, my, tW, chipRow, 8, '#ffce54', t);
            ctx.strokeStyle = on ? '#ffce54' : 'rgba(255,255,255,0.12)'; ctx.lineWidth = on ? 3 : 2; ctx.stroke();
            ctx.fillStyle = on ? '#ffce54' : '#cdd6e2'; ctx.font = `700 ${fs(14)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(m.name, mx + tW / 2, my + chipRow / 2);
            this._hot(mx, my, tW, chipRow, 'toggleModifier', m.id);
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        y += tRows * chipRow + (tRows - 1) * chipGap + sec;

        // CTA: the big START RUN, full width. PLAY is run setup ONLY — the
        // mode launchers live on MODES and the daily trials moved there too
        // (tab exclusivity: nothing here duplicates another screen).
        this._drawStartButton(ctx, { x: innerX, y: startY, w: innerW, h: startH }, t,
            (save.stats?.runs ?? 0) === 0);
    }

    // ── MODES ──────────────────────────────────────────────────────────
    // The mode gallery: four launch cards with room to say what each mode IS —
    // the daily curated run, the daily hero trial, the freeplay boss gauntlet,
    // and the seeded weekly gauntlet. Each card shows today's/this week's setup
    // and your record, and launches straight into the mode.
    _drawModes(ctx, state) {
        const c = this._contentRect();
        const t = this._t || 0;
        const day = currentDayNumber();
        const save = state.saveData || {};

        // ── Today's Trials strip — the daily-goal loop lives HERE, its one
        // home (it used to render on both PLAY and STATS). Read-only chips;
        // completion is evaluated at run end (save.daily).
        const trialsH = 96;
        {
            const dState = save.daily || { day: 0, completed: [] };
            const dDone = dState.day === day && Array.isArray(dState.completed) ? dState.completed : [];
            const dChs = pickDailyChallenges(day);
            const dGotN = dChs.filter((cc) => dDone.includes(cc.id)).length;
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = '#ffd479'; ctx.font = `800 21px ${HEAD}`;
            ctx.fillText(`Today's Trials  ${dGotN}/${dChs.length}`, c.x, c.y + 18);
            if ((state.dayStreak ?? 0) > 0) {
                ctx.textAlign = 'right'; ctx.fillStyle = '#ff9a4a'; ctx.font = `800 18px ${FONT}`;
                ctx.fillText(`🔥 ${state.dayStreak}-day streak`, c.x + c.w, c.y + 18);
                ctx.textAlign = 'left';
            }
            const dRowH = 54, dGap = 14, dTop = c.y + 30;
            const dChipW = (c.w - dGap * (dChs.length - 1)) / Math.max(1, dChs.length);
            for (let i = 0; i < dChs.length; i++) {
                const cc = dChs[i];
                const got = dDone.includes(cc.id);
                const dcx = c.x + i * (dChipW + dGap);
                roundRectPath(ctx, dcx, dTop, dChipW, dRowH, 8);
                ctx.fillStyle = got ? 'rgba(95,211,106,0.14)' : 'rgba(255,212,121,0.06)'; ctx.fill();
                ctx.strokeStyle = got ? '#5fd36a' : 'rgba(255,212,121,0.45)'; ctx.lineWidth = 2; ctx.stroke();
                ctx.fillStyle = got ? '#5fd36a' : '#fff'; ctx.font = `800 16px ${FONT}`;
                ctx.fillText(this._ellip(ctx, `${got ? '✓ ' : ''}${cc.name}`, dChipW - 24), dcx + 14, dTop + 22);
                ctx.fillStyle = got ? 'rgba(95,211,106,0.8)' : '#ffce54'; ctx.font = `800 13px ${FONT}`;
                ctx.fillText(got ? 'CLAIMED' : `+${cc.coins} coins  ·  +${cc.vigilXp} XP`, dcx + 14, dTop + 43);
            }
        }
        const daily = getDailySetup(day);
        const rite = getRiteTrialSetup(day);
        const week = weeklyEmberSeed(day);
        const brTotal = getBossRushSequence(BOSS_RUSH_CONFIG).length;
        const bestLine = (best, prev, unit) => best > 0 ? `Best: ${best.toLocaleString()}${unit}`
            : prev > 0 ? `Last: ${prev.toLocaleString()}${unit} — beat it!`
            : null;
        const cards = [
            {
                title: 'DAILY ROAD', accent: '#ff9ecf', action: 'startDaily',
                desc: ['One curated run per day — a fixed biome and a forced starting road,',
                    'the same for every player. Your score resets each day.'],
                setup: `Today: ${(MAPS[daily.mapId]?.name) || daily.mapId} · ${(getRoad(daily.roadId)?.name) || daily.roadId}`,
                best: bestLine(state.dailyRoadBest ?? 0, state.dailyRoadPrevBest ?? 0, ' pts') ?? 'First run of the day pays a free case',
            },
            {
                title: 'RITE TRIAL', accent: '#ff9a4a', action: 'startRiteTrial',
                desc: ['Play today\u2019s locked hero with one Trial curse — a daily test of',
                    'Kindle mastery. The hero changes every day.'],
                setup: `Today\u2019s hero: ${(getCharacter(rite.heroId)?.name) || rite.heroId}`,
                best: bestLine(state.riteTrialBest ?? 0, state.riteTrialPrevBest ?? 0, ' pts') ?? 'Hero locks each day',
            },
            {
                title: 'BOSS RUSH', accent: '#ff6a4a', action: 'startBossRush',
                desc: [`All ${brTotal} apex bosses back to back with a head-start build.`,
                    'No waves, no timer pressure — pure boss duels. Always available.'],
                setup: 'Your own hero & biome · head-start: 5 upgrade picks',
                best: (state.bossRushBest ?? 0) > 0 ? `Best: ${state.bossRushBest} bosses felled` : 'Face the gauntlet',
            },
            {
                title: 'WEEKLY EMBER', accent: '#ffce54', action: 'startWeeklyEmber',
                desc: ['Boss Rush with this week\u2019s shuffled boss order — the same order',
                    'for every player, all week. A new gauntlet every Monday.'],
                setup: `Week ${week} · seeded boss order`,
                best: bestLine(state.weeklyEmberBest ?? 0, state.weeklyEmberPrevBest ?? 0, ' pts') ?? 'Set this week\u2019s record',
            },
        ];
        const gap = 20;
        const cardsTop = c.y + trialsH + 8;
        const cw = (c.w - gap) / 2;
        const ch = Math.min(240, (c.h - trialsH - 8 - gap) / 2);
        for (let i = 0; i < cards.length; i++) {
            const cd = cards[i];
            const x = c.x + (i % 2) * (cw + gap);
            const y = cardsTop + Math.floor(i / 2) * (ch + gap);
            // Card glass + accent frame with a soft breathing glow.
            roundRectPath(ctx, x, y, cw, ch, 16);
            ctx.fillStyle = 'rgba(16,12,11,0.92)'; ctx.fill();
            ctx.save();
            ctx.globalAlpha = 0.45 + Math.sin(t * 2.4 + i) * 0.15;
            ctx.strokeStyle = cd.accent; ctx.lineWidth = 2.5;
            roundRectPath(ctx, x, y, cw, ch, 16); ctx.stroke();
            ctx.restore();
            // Accent side-bar so the cards read as a colour-coded gallery.
            // (Scale off the incoming alpha — this runs inside the tab fade.)
            const ga = ctx.globalAlpha;
            ctx.fillStyle = cd.accent; ctx.globalAlpha = ga * 0.85;
            ctx.fillRect(x, y + 14, 4, ch - 28); ctx.globalAlpha = ga;
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = cd.accent;
            this._fitFont(ctx, cd.title, cw - 220, 700, 30);
            ctx.fillText(cd.title, x + 26, y + 44);
            ctx.fillStyle = 'rgba(235,240,248,0.78)'; ctx.font = `500 15px ${FONT}`;
            ctx.fillText(this._ellip(ctx, cd.desc[0], cw - 52), x + 26, y + 74);
            ctx.fillText(this._ellip(ctx, cd.desc[1], cw - 52), x + 26, y + 95);
            ctx.fillStyle = cd.accent; ctx.font = `600 16px ${FONT}`;
            ctx.fillText(this._ellip(ctx, cd.setup, cw - 52), x + 26, y + ch - 78);
            ctx.fillStyle = 'rgba(255,206,84,0.9)'; ctx.font = `700 15px ${FONT}`;
            ctx.fillText(this._ellip(ctx, cd.best, cw - 220), x + 26, y + ch - 52);
            // LAUNCH button (bottom-right) — comfortably tappable on touch.
            const bw = 170, bh = 54, bx = x + cw - bw - 22, by = y + ch - bh - 20;
            roundRectPath(ctx, bx, by, bw, bh, 12);
            const bg = ctx.createLinearGradient(bx, by, bx, by + bh);
            bg.addColorStop(0, '#33a356'); bg.addColorStop(1, '#1d6b3a');
            ctx.fillStyle = bg; ctx.fill();
            ctx.strokeStyle = '#7be08a'; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.font = `800 22px ${FONT}`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('LAUNCH', bx + bw / 2, by + bh / 2 + 1);
            this._hot(bx, by, bw, bh, cd.action, null);
        }
    }

    // Pulsing accent glow behind a SELECTED chip (biome / difficulty / trial).
    _selGlow(ctx, x, y, w, h, r, color, t) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, 0.45 + Math.sin(t * 4) * 0.28);
        ctx.shadowColor = color; ctx.shadowBlur = 16;
        ctx.strokeStyle = color; ctx.lineWidth = 2.5;
        roundRectPath(ctx, x, y, w, h, r); ctx.stroke();
        ctx.restore();
    }

    // The big call-to-action: a green button with a moving warm sheen, a
    // breathing gold border, and a soft cached under-glow — hard to miss, and
    // cheaper than the old per-frame hsl shadowBlur.
    _drawStartButton(ctx, r, t, guided = false) {
        ctx.save();
        // Cached-glow beacon behind the button (breathing alpha).
        ctx.globalCompositeOperation = 'lighter';
        this._ember(ctx, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.55, '#74e890', 0.18 + Math.sin(t * 3) * 0.06);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        const sweep = Math.sin(t * 1.5) * 0.5 + 0.5;
        const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y);
        g.addColorStop(Math.max(0, sweep - 0.28), '#33a356');
        g.addColorStop(sweep, '#74e890');
        g.addColorStop(Math.min(1, sweep + 0.28), '#33a356');
        roundRectPath(ctx, r.x, r.y, r.w, r.h, 14);
        ctx.fillStyle = g; ctx.fill();
        // Static warm-gold border whose alpha pulses (the fire beacon).
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 1.6);
        ctx.strokeStyle = '#ffce7a'; ctx.lineWidth = 3; ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.font = `800 ${Math.round(Math.min(34, r.h * 0.42))}px ${FONT}`;
        ctx.fillText(guided ? 'FIRST VIGIL · GUIDED' : 'START RUN',
            r.x + r.w / 2, r.y + r.h / 2 - r.h * 0.12);
        ctx.font = `600 ${Math.round(Math.min(18, r.h * 0.22))}px ${FONT}`;
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fillText(guided ? 'Space / Enter · lessons included' : 'Space / Enter',
            r.x + r.w / 2, r.y + r.h / 2 + r.h * 0.24);
        ctx.restore();
        this._hot(r.x, r.y, r.w, r.h, 'startRun', null);
    }

    // Lifetime stats showcase — surfaces what the save has always tracked.
    _drawStats(ctx, state) {
        const c = this._contentRect();
        this._panel(ctx, c.x, c.y, c.w, c.h, null, undefined, { corners: true });
        const s = (state.saveData && state.saveData.stats) || {};
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

        // (Today's Trials moved to MODES — its one home. STATS is records only,
        // which also buys the achievements grid more vertical room.)
        const statsTop0 = c.y + 14;

        ctx.fillStyle = '#a8d5f7'; ctx.font = `800 34px ${HEAD}`;
        ctx.textAlign = 'left';
        ctx.fillText('Lifetime Vigil', c.x + 34, statsTop0 + 30);
        const fmtTime = (sec) => { sec = Math.floor(sec || 0); const m = Math.floor(sec / 60), ss = sec % 60; return `${m}:${String(ss).padStart(2, '0')}`; };
        const rows = [
            ['Runs', s.runs || 0], ['Total kills', s.totalKills || 0],
            ['Bosses felled', s.totalBosses || 0], ['Coins earned', s.totalCoinsEarned || 0],
            ['Cases opened', s.casesOpened || 0], ['Playtime', fmtTime(s.playtimeSec)],
            ['Best survival', fmtTime(s.bestTime)], ['Best wave', s.bestWave || 0],
            ['Best level', s.bestLevel || 0], ['Best kills (run)', s.bestKills || 0],
            ['Best Gauntlet score', s.bestGauntletScore || 0], ['Gauntlet runs', s.gauntletRuns || 0],
            ['Nightmare wins', s.hardWins || 0], ['Nightmare bosses', s.eliteBossesDefeated || 0],
            ['Vigil sites', s.vigilSitesActivated || 0], ['Tactical packs', s.encountersCleared || 0],
            ['Beacon packs', s.guardianPacksDefeated || 0],
        ];
        // Pact Mastery summary (per-character highest cleared tier).
        const pmObj = (state.saveData && state.saveData.pactMastery) || {};
        const pmVals = Object.values(pmObj).filter((v) => Number.isFinite(v) && v > 0);
        rows.push(['Top Pact cleared', pmVals.length ? Math.max(...pmVals) : 0]);
        rows.push(['Pacts mastered', pmVals.length]);
        // Three compact columns (was two tall ones) — frees vertical room below
        // so the achievements grid isn't pushed off the panel.
        const cols = 3, gap = 18;
        const colW = (c.w - 68 - gap * (cols - 1)) / cols;
        const rowH = 40;
        const top = statsTop0 + 66;
        for (let i = 0; i < rows.length; i++) {
            const col = i % cols, row = Math.floor(i / cols);
            const x = c.x + 34 + col * (colW + gap), y = top + row * rowH;
            roundRectPath(ctx, x, y, colW, rowH - 8, 8);
            ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = `600 18px ${FONT}`; ctx.textAlign = 'left';
            ctx.fillText(rows[i][0], x + 16, y + 25);
            ctx.fillStyle = '#fff'; ctx.font = `800 22px ${FONT}`; ctx.textAlign = 'right';
            ctx.fillText(String(rows[i][1]), x + colW - 16, y + 26);
        }

        // Achievements grid (locked = greyed, earned = gold check). Read-only.
        const claimed = (state.saveData && state.saveData.achievements && state.saveData.achievements.claimed) || [];
        const aTop = top + Math.ceil(rows.length / cols) * rowH + 16;
        const earnedN = ACHIEVEMENTS.filter((a) => claimed.includes(a.id)).length;
        ctx.fillStyle = '#ffce54'; ctx.font = `800 24px ${HEAD}`; ctx.textAlign = 'left';
        ctx.fillText(`Achievements  ${earnedN}/${ACHIEVEMENTS.length}`, c.x + 34, aTop);
        const acols = 4, agap = 14;       // 4 columns → 4 rows for 16 (fits short panels)
        const aW = (c.w - 68 - agap * (acols - 1)) / acols;
        const arTop = aTop + 16;
        // Adaptive badge height: shrink so EVERY achievement row fits the space
        // left below the stats (no silent clipping); drop the desc line when the
        // badge gets short. Reward chip stays on the name row.
        const rowsA = Math.ceil(ACHIEVEMENTS.length / acols);
        const availA = (c.y + c.h - 8) - arTop;
        const aH = Math.max(34, Math.min(52, Math.floor((availA - 8 * (rowsA - 1)) / rowsA)));
        const aShowDesc = aH >= 46;
        const aNameY = aShowDesc ? 22 : Math.round(aH * 0.6);
        for (let i = 0; i < ACHIEVEMENTS.length; i++) {
            const a = ACHIEVEMENTS[i];
            const col = i % acols, row = Math.floor(i / acols);
            const x = c.x + 34 + col * (aW + agap), y = arTop + row * (aH + 8);
            if (y + aH > c.y + c.h - 6) break; // safety clip (degenerate panels)
            const got = claimed.includes(a.id);
            roundRectPath(ctx, x, y, aW, aH, 8);
            ctx.fillStyle = got ? 'rgba(255,206,84,0.14)' : 'rgba(255,255,255,0.03)'; ctx.fill();
            ctx.strokeStyle = got ? '#ffce54' : 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = got ? '#ffce54' : '#cdd6e2'; ctx.font = `800 ${aShowDesc ? 16 : 15}px ${FONT}`; ctx.textAlign = 'left';
            ctx.fillText(this._ellip(ctx, `${got ? '✓ ' : ''}${a.name}`, aW - 130), x + 12, y + aNameY);
            if (aShowDesc) {
                ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `500 12px ${FONT}`;
                ctx.fillText(a.desc.length > 38 ? a.desc.slice(0, 37) + '…' : a.desc, x + 12, y + 40);
            }
            // If this achievement grants a cosmetic, show it (right-aligned, in
            // its rarity colour) so players can see the skin they're grinding
            // toward — a 🎁 reward target on the name row.
            const rew = cosmeticsForAchievement(a.id);
            if (rew.length && COSMETICS[rew[0]]) {
                const cm = COSMETICS[rew[0]];
                ctx.fillStyle = rarityColor(cm.rarity); ctx.font = `700 13px ${FONT}`; ctx.textAlign = 'right';
                ctx.fillText(this._ellip(ctx, `🎁 ${cm.name}`, aW * 0.5), x + aW - 12, y + aNameY);
                ctx.textAlign = 'left';
            }
        }
        ctx.textAlign = 'left';
    }

    // Avatar honoring aura/fur/cloak/hat cosmetics. A resolved pose keeps the
    // real body frame and every attachment anchor indivisible; if it is absent,
    // the procedural blob remains as a safe body fallback.
    _drawAvatar(ctx, cx, cy, r, ap, pose = null, skin = null, t = 0, heldProp = null, hold = null, pawColor = '#f0d2a5') {
        // The avatar owns one centred, canonical 182px hero coordinate system.
        // Scaling that system to S keeps body, cosmetics and prop on the exact
        // same transform at every menu preview size.
        const S = r * 2.4;
        const avatarScale = S / HERO_CANONICAL_SIZE;
        const fallbackR = HERO_CANONICAL_SIZE / 2.4;
        const isLpc = pose?.kind === 'lpc';
        ctx.save();
        // Animated cosmetic aura (prestige VFX) — the live preview shows the
        // exact pulse/spin/flame/rainbow/starfield effect you earn.
        if (ap.auraColor) drawAuraFx(ctx, cx, cy, r * 1.32, ap.auraColor,
            ap.auraFx, t, 0.42, this._reducedMotion);
        // Rarity prestige FX in the customizer too — the preview IS the sales
        // pitch: rarer pieces visibly glow/pulse/sparkle before you commit.
        if (ap.fxTier >= 3) drawRarityFx(ctx, cx, cy, r * 1.26, ap.fxTier, ap.fxColor, t);
        if (ap.set) drawSetBonus(ctx, cx, cy, r * 1.3,
            ap.set.color, t, this._reducedMotion);
        ctx.translate(cx, cy);
        ctx.scale(avatarScale, avatarScale);
        // Cloak: imported LPC cape for LPC heroes (drawn at the body box so it
        // aligns), procedural drape otherwise — matches the in-game player.
        if (ap.cloakColor) {
            ctx.save();
            applyHeroAttachmentTransform(ctx, pose, 'shoulders');
            // Authored silhouettes must remain authored on LPC heroes too; the
            // imported fallback cape is only valid for the classic style.
            const cape = isLpc && (!ap.cloakStyle || ap.cloakStyle === 'classic')
                ? getCloakSprite(ap.cloakColor) : null;
            if (cape) {
                // Flared a touch larger + nudged down so it drapes behind the
                // hero (matches Player._drawCloak exactly).
                const dw = HERO_CANONICAL_SIZE * 1.32;
                const off = HERO_CANONICAL_SIZE * 0.075;
                ctx.drawImage(cape, -dw / 2, -dw / 2 + off, dw, dw);
            } else {
                drawPixelCloak(ctx, 0, 0, HERO_CANONICAL_HALF,
                    pose?.dir || 'down', ap.cloakColor, !!pose?.flip,
                    ap.cloakStyle || 'classic');
            }
            ctx.restore();
        }
        if (pose?.sprite) {
            // Real character sprite as the body, sized to the avatar box.
            ctx.save();
            if (pose.flip) ctx.scale(-1, 1);
            ctx.drawImage(pose.sprite, -HERO_CANONICAL_HALF, -HERO_CANONICAL_HALF,
                HERO_CANONICAL_SIZE, HERO_CANONICAL_SIZE);
            ctx.restore();
        } else {
            // Fallback procedural blob.
            ctx.fillStyle = ap.furColor || '#8a6a4a';
            ctx.beginPath(); ctx.arc(0, 0, fallbackR * 0.62, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#e8d3b0';
            ctx.beginPath(); ctx.arc(0, -fallbackR * 0.05, fallbackR * 0.4, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#2a2018';
            ctx.beginPath();
            ctx.arc(-fallbackR * 0.16, -fallbackR * 0.1, fallbackR * 0.06, 0, Math.PI * 2);
            ctx.arc(fallbackR * 0.16, -fallbackR * 0.1, fallbackR * 0.06, 0, Math.PI * 2);
            ctx.fill();
        }
        // Held weapon prop gripped at this exact pose's authored hand point.
        // The menu has no aim target, so idle rests down-out and cast lifts.
        if (heldProp && pose?.attachments?.handR) {
            const propSprite = getWeaponProp(heldProp.prop, heldProp.accent, heldProp.glow);
            if (propSprite) {
                // Match the in-game hold, including the paw over the grip.
                const H = hold || { scale: 1.0, tilt: 0 };
                const pscale = 0.92 * (H.scale || 1);
                const hand = heroPosePoint(pose, 'handR');
                // LPC cast art aliases idle; keep its prop at the rest angle,
                // while authored cast poses lift the wand from their own hand.
                const firing = pose.state === 'cast' && pose.kind !== 'lpc';
                const ang = (firing ? -0.45 : -1.25) + (H.tilt || 0);
                ctx.save();
                ctx.translate(hand[0], hand[1]);
                ctx.rotate(ang);
                ctx.drawImage(propSprite.canvas, -propSprite.gripX * pscale, -propSprite.gripY * pscale,
                    propSprite.w * pscale, propSprite.h * pscale);
                const pr = 8 * pscale;
                ctx.fillStyle = pawColor; ctx.strokeStyle = 'rgba(40,24,12,0.85)';
                ctx.lineWidth = Math.max(1, 1.8 * pscale);
                ctx.beginPath(); ctx.arc(0, 0, pr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.restore();
            }
        }
        // Accessory on the head (direction-aware pixel hat, on top). The old
        // themed sash overlay was removed — the held weapon carries the identity.
        if (ap.hatShape && ap.hatShape !== 'none') {
            ctx.save();
            applyHeroAttachmentTransform(ctx, pose, 'headSeat');
            drawPixelHat(ctx, 0, 0, HERO_CANONICAL_HALF,
                pose?.dir || 'down', ap.hatShape, ap.hatColor, !!pose?.flip);
            ctx.restore();
        }
        ctx.restore();
    }

    // Center-aligned word wrap (caller sets fillStyle/font/textAlign='center').
    _wrapText(ctx, text, cx, y, maxWidth, lineHeight, maxLines = 3) {
        const words = String(text).split(/\s+/);
        const lines = [];
        let line = '';
        for (const w of words) {
            const test = line ? line + ' ' + w : w;
            if (ctx.measureText(test).width > maxWidth && line) {
                lines.push(line);
                line = w;
                if (lines.length >= maxLines - 1) break;
            } else {
                line = test;
            }
        }
        if (line && lines.length < maxLines) lines.push(line);
        const prevAlign = ctx.textAlign;
        ctx.textAlign = 'center';
        for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, y + i * lineHeight);
        ctx.textAlign = prevAlign;
    }

    // ── SKILLS (permanent upgrades) ──────────────────────────────────────
    // ── SKILLS — Forge Training ──────────────────────────────────────────
    // Permanent-upgrade shop with its own identity: a summary rail (coin
    // balance, forge rank, what's buyable right now, reset) beside a grid of
    // glyph-badged discipline cards — each upgrade wears a fixed hue + vector
    // glyph so the nine cards stop reading as clones. The gold/green afford/
    // maxed signal stays on the border + pips; buy flow is unchanged
    // ('buyUpgrade' → Game.buyUpgrade).
    _drawSkills(ctx, state) {
        const c = this._contentRect();
        const save = state.saveData;
        const t = this._t || 0;
        ctx.textBaseline = 'alphabetic';

        // Rail totals: owned levels vs total, and what's affordable right now.
        let ownedLv = 0, totalLv = 0, readyN = 0, cheapest = Infinity;
        for (const u of PERMANENT_UPGRADES) {
            const lv = save.upgrades[u.id] ?? 0;
            ownedLv += Math.min(lv, u.maxLevel); totalLv += u.maxLevel;
            if (lv < u.maxLevel) {
                const cst = nextCost(u, lv);
                if (save.totalCoins >= cst) readyN++;
                cheapest = Math.min(cheapest, cst);
            }
        }

        // ── Summary rail (left) ──
        const railW = Math.min(320, Math.round(c.w * 0.24));
        this._panel(ctx, c.x, c.y, railW, c.h, 'rgba(13,20,30,0.9)', 'rgba(127,208,255,0.25)');
        const rx = c.x + 26, rw = railW - 52;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#7fd0ff'; this._fitFont(ctx, 'FORGE TRAINING', rw, 800, 28);
        ctx.fillText('FORGE TRAINING', rx, c.y + 48);
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `500 16px ${FONT}`;
        ctx.fillText('Bought once, kept forever —', rx, c.y + 78);
        ctx.fillText('every run starts stronger.', rx, c.y + 100);
        // Coin balance.
        ctx.fillStyle = '#ffd86b'; ctx.font = `800 34px ${FONT}`;
        ctx.fillText(`◎ ${save.totalCoins.toLocaleString()}`, rx, c.y + 152);
        ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = `600 15px ${FONT}`;
        ctx.fillText('COINS BANKED', rx, c.y + 174);
        // Forge Rank progress (total owned levels across all disciplines).
        const pr = totalLv > 0 ? ownedLv / totalLv : 0;
        ctx.fillStyle = '#a8ddff'; ctx.font = `700 19px ${FONT}`;
        ctx.fillText(`Forge Rank  ${ownedLv} / ${totalLv}`, rx, c.y + 218);
        roundRectPath(ctx, rx, c.y + 230, rw, 14, 7);
        ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fill();
        if (pr > 0) {
            roundRectPath(ctx, rx, c.y + 230, Math.max(8, rw * pr), 14, 7);
            const pg = ctx.createLinearGradient(rx, 0, rx + rw, 0);
            pg.addColorStop(0, '#4a9fd8'); pg.addColorStop(1, '#8fd7ff');
            ctx.fillStyle = pg; ctx.fill();
        }
        // "Ready to forge" callout — the rail's whole job is answering
        // "can I buy anything?" without scanning nine cards.
        if (readyN > 0) {
            ctx.fillStyle = `rgba(255,206,84,${0.75 + Math.sin(t * 3) * 0.25})`;
            ctx.font = `800 21px ${FONT}`;
            ctx.fillText(`▲ ${readyN} ready to forge`, rx, c.y + 288);
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `600 18px ${FONT}`;
            ctx.fillText(ownedLv >= totalLv ? 'Every discipline mastered'
                : Number.isFinite(cheapest) ? `Next costs ◎ ${cheapest}` : '', rx, c.y + 288);
        }
        // (RESET SAVE moved to SETTINGS — save management is settings, not
        // forge training. The rail stays purely about the coin/upgrade loop.)

        // ── Discipline grid (right of the rail) ──
        const gx = c.x + railW + 24;
        const gw = c.w - railW - 24;
        const cols = 2, gap = 20, rowGap = 14;
        const rows = Math.ceil(PERMANENT_UPGRADES.length / cols);
        const cardW = (gw - gap) / cols;
        const cardH = Math.max(84, Math.min(110, Math.floor((c.h - rowGap * (rows - 1)) / rows)));
        for (let i = 0; i < PERMANENT_UPGRADES.length; i++) {
            const u = PERMANENT_UPGRADES[i];
            const style = SKILL_STYLE[u.id] || { col: '#9fb0c4', glyph: 'star' };
            const col = i % cols, row = Math.floor(i / cols);
            const x = gx + col * (cardW + gap);
            const y = c.y + row * (cardH + rowGap);
            const level = save.upgrades[u.id] ?? 0;
            const cost = nextCost(u, level);
            const maxed = level >= u.maxLevel;
            const afford = !maxed && save.totalCoins >= cost;
            // Border + pips keep the buy-state signal: green = maxed, gold =
            // affordable now, dim = can't afford yet.
            const stateCol = maxed ? '#5fd36a' : afford ? '#ffce54' : 'rgba(255,255,255,0.12)';
            roundRectPath(ctx, x, y, cardW, cardH, 12);
            ctx.fillStyle = afford ? 'rgba(46,40,18,0.92)' : maxed ? 'rgba(20,34,24,0.92)' : 'rgba(22,27,36,0.9)';
            ctx.fill();
            ctx.strokeStyle = stateCol;
            ctx.lineWidth = afford || maxed ? 2.5 : 2; ctx.stroke();
            // Glyph plate — the discipline's own hue, independent of buy state.
            const ps = Math.min(60, cardH - 28);
            const px = x + 16, py = y + (cardH - ps) / 2;
            roundRectPath(ctx, px, py, ps, ps, 10);
            ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
            // Scale off the INCOMING alpha — tab content draws inside the
            // 180ms slide-in fade, and a hard `= 1` here would cancel it for
            // every card after the first.
            const ga = ctx.globalAlpha;
            ctx.strokeStyle = style.col; ctx.globalAlpha = ga * 0.55; ctx.lineWidth = 2; ctx.stroke();
            ctx.globalAlpha = ga;
            this._skillGlyph(ctx, style.glyph, px + ps / 2, py + ps / 2, ps * 0.3, style.col);
            const tx = px + ps + 16;
            ctx.textAlign = 'left';
            ctx.fillStyle = '#fff'; ctx.font = `700 24px ${FONT}`;
            ctx.fillText(u.name, tx, y + 32);
            ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = `500 17px ${FONT}`;
            ctx.fillText(this._ellip(ctx, u.description, cardW - (tx - x) - 190), tx, y + 56);
            // Segmented level progress bar (filled = owned levels).
            const segGap = 4, segY = y + cardH - 26, segH = 8;
            const segAvail = Math.min(210, cardW - (tx - x) - 200);
            const segW = (segAvail - segGap * (u.maxLevel - 1)) / u.maxLevel;
            for (let s = 0; s < u.maxLevel; s++) {
                ctx.fillStyle = s < level ? stateCol : 'rgba(255,255,255,0.12)';
                ctx.fillRect(tx + s * (segW + segGap), segY, Math.max(2, segW), segH);
            }
            ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `600 14px ${FONT}`;
            ctx.fillText(`Lv ${level}/${u.maxLevel}`, tx + segAvail + 12, segY + 8);
            // Buy button on the right.
            const bw = 150, bh = Math.min(56, cardH - 24);
            const br = { x: x + cardW - bw - 16, y: y + (cardH - bh) / 2, w: bw, h: bh };
            this._button(ctx, br, maxed ? 'MAX' : `◎ ${cost}`,
                { enabled: afford, accent: afford ? '#2e6b3f' : null, action: maxed ? null : 'buyUpgrade', arg: u.id });
        }
    }

    // Small vector glyph for a Forge Training discipline, centered on (cx,cy)
    // with half-size s, stroked/filled in the discipline's hue. Pure canvas
    // paths — no assets, nothing to load or fall back from.
    _skillGlyph(ctx, glyph, cx, cy, s, col) {
        ctx.save();
        ctx.strokeStyle = col; ctx.fillStyle = col;
        ctx.lineWidth = Math.max(2, s * 0.22); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        switch (glyph) {
            case 'heart': {   // Greater Ember — max HP
                ctx.beginPath();
                ctx.moveTo(cx, cy + s * 0.85);
                ctx.bezierCurveTo(cx - s * 1.25, cy - s * 0.1, cx - s * 0.65, cy - s * 1.05, cx, cy - s * 0.35);
                ctx.bezierCurveTo(cx + s * 0.65, cy - s * 1.05, cx + s * 1.25, cy - s * 0.1, cx, cy + s * 0.85);
                ctx.fill();
                break;
            }
            case 'flame': {   // Brighter Burn — damage
                // Outer body + inner notch as ONE even-odd fill: the notch is a
                // hole in the flame, not an erase through the card underneath.
                ctx.beginPath();
                ctx.moveTo(cx, cy - s);
                ctx.bezierCurveTo(cx + s * 0.9, cy - s * 0.2, cx + s * 0.7, cy + s * 0.6, cx, cy + s);
                ctx.bezierCurveTo(cx - s * 0.7, cy + s * 0.6, cx - s * 0.9, cy - s * 0.2, cx, cy - s);
                ctx.moveTo(cx, cy - s * 0.1);
                ctx.bezierCurveTo(cx + s * 0.35, cy + s * 0.3, cx + s * 0.25, cy + s * 0.6, cx, cy + s * 0.75);
                ctx.bezierCurveTo(cx - s * 0.25, cy + s * 0.6, cx - s * 0.35, cy + s * 0.3, cx, cy - s * 0.1);
                ctx.fill('evenodd');
                break;
            }
            case 'chevrons': {   // Quickstep — move speed
                for (const dx of [-s * 0.55, s * 0.25]) {
                    ctx.beginPath();
                    ctx.moveTo(cx + dx - s * 0.3, cy - s * 0.7);
                    ctx.lineTo(cx + dx + s * 0.4, cy);
                    ctx.lineTo(cx + dx - s * 0.3, cy + s * 0.7);
                    ctx.stroke();
                }
                break;
            }
            case 'crosshair': {   // Keen Ember — crit
                ctx.beginPath(); ctx.arc(cx, cy, s * 0.7, 0, TAU); ctx.stroke();
                for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                    ctx.beginPath();
                    ctx.moveTo(cx + dx * s * 0.55, cy + dy * s * 0.55);
                    ctx.lineTo(cx + dx * s * 1.05, cy + dy * s * 1.05);
                    ctx.stroke();
                }
                ctx.beginPath(); ctx.arc(cx, cy, s * 0.16, 0, TAU); ctx.fill();
                break;
            }
            case 'star': {   // Soulgleam — XP
                ctx.beginPath();
                ctx.moveTo(cx, cy - s);
                ctx.quadraticCurveTo(cx + s * 0.12, cy - s * 0.12, cx + s, cy);
                ctx.quadraticCurveTo(cx + s * 0.12, cy + s * 0.12, cx, cy + s);
                ctx.quadraticCurveTo(cx - s * 0.12, cy + s * 0.12, cx - s, cy);
                ctx.quadraticCurveTo(cx - s * 0.12, cy - s * 0.12, cx, cy - s);
                ctx.fill();
                break;
            }
            case 'glow': {   // Wider Glow — pickup range
                ctx.beginPath(); ctx.arc(cx, cy, s * 0.3, 0, TAU); ctx.fill();
                ctx.globalAlpha = 0.8;
                ctx.beginPath(); ctx.arc(cx, cy, s * 0.75, 0, TAU); ctx.stroke();
                ctx.globalAlpha = 0.45;
                ctx.beginPath(); ctx.arc(cx, cy, s * 1.05, 0, TAU); ctx.stroke();
                break;
            }
            case 'coins': {   // Heirloom Cinders — starting coins
                ctx.globalAlpha = 0.55;
                ctx.beginPath(); ctx.arc(cx + s * 0.4, cy - s * 0.35, s * 0.55, 0, TAU); ctx.stroke();
                ctx.globalAlpha = 1;
                ctx.beginPath(); ctx.arc(cx - s * 0.2, cy + s * 0.2, s * 0.62, 0, TAU); ctx.stroke();
                ctx.beginPath(); ctx.arc(cx - s * 0.2, cy + s * 0.2, s * 0.3, 0, TAU); ctx.stroke();
                break;
            }
            case 'cycle': {   // Second Sight — rerolls
                ctx.beginPath(); ctx.arc(cx, cy, s * 0.7, -Math.PI * 0.35, Math.PI * 1.05); ctx.stroke();
                const ax = cx + Math.cos(-Math.PI * 0.35) * s * 0.7;
                const ay = cy + Math.sin(-Math.PI * 0.35) * s * 0.7;
                ctx.beginPath();
                ctx.moveTo(ax - s * 0.42, ay - s * 0.1);
                ctx.lineTo(ax + s * 0.16, ay - s * 0.28);
                ctx.lineTo(ax - s * 0.05, ay + s * 0.38);
                ctx.closePath(); ctx.fill();
                break;
            }
            case 'ban': {   // Forsake — banish
                ctx.beginPath(); ctx.arc(cx, cy, s * 0.75, 0, TAU); ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(cx - s * 0.5, cy - s * 0.5);
                ctx.lineTo(cx + s * 0.5, cy + s * 0.5);
                ctx.stroke();
                break;
            }
            default: {
                ctx.beginPath(); ctx.arc(cx, cy, s * 0.5, 0, TAU); ctx.fill();
            }
        }
        ctx.restore();
    }

    // ── ATTUNE — the Relic Altar (the coin-fed infinite sink) ─────────────
    // Master-detail: the eight attunable relics as a sigil list on the left,
    // the selected one staged on an altar pane on the right — big rarity-lit
    // sigil, what it grants NOW vs per level, and the single ATTUNE button.
    // Selection lives on Game (attuneSel, set by the 'attuneSelect' action) so
    // it survives tab hops like every other menu choice; the buy path is
    // unchanged ('attuneRelic' → Game.buyAttune → SaveSystem.attuneRelic).
    // Deliberately no raw-damage attunements (see relics.js ATTUNABLE) so a
    // coin hoard can't out-scale the hypergrowth wall.
    _drawAttune(ctx, state) {
        const c = this._contentRect();
        const save = state.saveData;
        const t = this._t || 0;
        const levels = (save.relicAttunement && typeof save.relicAttunement === 'object') ? save.relicAttunement : {};
        const discovered = Array.isArray(save.discoveredRelics) ? save.discoveredRelics : [];
        // Stale/unset selection falls back to the first attunable.
        const sel = ATTUNABLE.find((d) => d.id === state.attuneSel) || ATTUNABLE[0];
        ctx.textBaseline = 'alphabetic';

        // ── Sigil list (left) ──
        const listW = Math.round(c.w * 0.42);
        this._panel(ctx, c.x, c.y, listW, c.h, 'rgba(16,11,16,0.96)', 'rgba(255,158,207,0.22)');
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ff9ecf'; ctx.font = `800 24px ${HEAD}`;
        ctx.fillText('RELIC ALTAR', c.x + 26, c.y + 42);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `500 16px ${FONT}`;
        ctx.fillText('Permanent bonuses, active in every run.', c.x + 26, c.y + 68);
        const listTop = c.y + 86;
        const rowGap = 8;
        const rowH = Math.max(52, Math.min(74, Math.floor((c.h - (listTop - c.y) - 16 - rowGap * (ATTUNABLE.length - 1)) / ATTUNABLE.length)));
        for (let i = 0; i < ATTUNABLE.length; i++) {
            const def = ATTUNABLE[i];
            const relic = getRelic(def.id);
            const rc = relic ? rarityColor(relic.rarity) : '#ff9ecf';
            const level = levels[def.id] ?? 0;
            const maxed = level >= def.max;
            const afford = !maxed && save.totalCoins >= attuneCost(def, level);
            const y = listTop + i * (rowH + rowGap);
            const x = c.x + 16, w = listW - 32;
            const isSel = def.id === sel.id;
            roundRectPath(ctx, x, y, w, rowH, 10);
            ctx.fillStyle = isSel ? 'rgba(74,36,58,0.97)' : 'rgba(30,22,30,0.95)';
            ctx.fill();
            ctx.strokeStyle = isSel ? '#ff9ecf' : 'rgba(255,255,255,0.1)';
            ctx.lineWidth = isSel ? 2.5 : 1.5; ctx.stroke();
            if (isSel) this._selGlow(ctx, x, y, w, rowH, 10, '#ff9ecf', t);
            this._relicSigil(ctx, x + 30, y + rowH / 2, rowH * 0.26, rc, relic ? relic.rarity : 'common');
            ctx.textAlign = 'left';
            ctx.fillStyle = rc; ctx.font = `700 21px ${FONT}`;
            ctx.fillText(this._ellip(ctx, relic ? relic.name : def.id, w - 210), x + 58, y + rowH / 2 - 3);
            ctx.fillStyle = 'rgba(255,255,255,0.62)'; ctx.font = `500 14px ${FONT}`;
            ctx.fillText(this._ellip(ctx, def.blurb, w - 210), x + 58, y + rowH / 2 + 17);
            // Right side of the row: level + a buyable/maxed nudge.
            ctx.textAlign = 'right';
            ctx.fillStyle = maxed ? '#5fd36a' : afford ? '#ffce54' : 'rgba(255,255,255,0.45)';
            ctx.font = `700 17px ${FONT}`;
            ctx.fillText(maxed ? 'MAX' : afford ? `Lv ${level} ▲` : `Lv ${level}/${def.max}`, x + w - 16, y + rowH / 2 + 6);
            this._hot(x, y, w, rowH, 'attuneSelect', def.id);
        }

        // ── Altar pane (right) — the selected relic, staged ──
        const ax = c.x + listW + 24;
        const aw = c.w - listW - 24;
        const relic = getRelic(sel.id);
        const rc = relic ? rarityColor(relic.rarity) : '#ff9ecf';
        const level = levels[sel.id] ?? 0;
        const maxed = level >= sel.max;
        const cost = attuneCost(sel, level);
        const afford = !maxed && save.totalCoins >= cost;
        this._panel(ctx, ax, c.y, aw, c.h, 'rgba(14,9,14,0.96)', rc, { corners: true });
        const acx = ax + aw / 2;
        // Sigil on its altar glow — the pane's centerpiece. A dark vignette
        // grounds it first so the glow + name pop off the busy menu backdrop.
        const sigY = c.y + Math.min(180, c.h * 0.27);
        ctx.beginPath(); ctx.ellipse(acx, sigY + 20, 210, 140, 0, 0, TAU);
        ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill();
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        this._ember(ctx, acx, sigY, 120, rc, 0.16 + Math.sin(t * 2.2) * 0.05);
        ctx.restore();
        this._relicSigil(ctx, acx, sigY, Math.min(58, c.h * 0.09), rc, relic ? relic.rarity : 'common', t);
        ctx.textAlign = 'center';
        ctx.fillStyle = rc;
        const nm = relic ? relic.name : sel.id;
        this._fitFont(ctx, nm, aw - 80, 800, 40);
        ctx.fillText(nm, acx, sigY + 105);
        // Rarity tag + codex tick.
        ctx.font = `700 17px ${FONT}`;
        const tag = (relic ? rarityName(relic.rarity).toUpperCase() : 'RELIC')
            + (discovered.includes(sel.id) ? '   ·   ✦ found on the Wick Roads' : '');
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillText(tag, acx, sigY + 134);
        // What it grants: attuned total now, and the per-level step.
        const per = this._attunePer(sel);
        const midY = sigY + 186;
        ctx.fillStyle = '#fff'; ctx.font = `700 26px ${FONT}`;
        if (per && level > 0) {
            const tot = parseFloat((per.num * level).toFixed(2));
            ctx.fillText(`Attuned: ${per.sign}${tot}${per.pct} ${per.what}`, acx, midY);
        } else {
            ctx.fillText(level > 0 ? `Attuned to level ${level}` : 'Not yet attuned', acx, midY);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = `500 19px ${FONT}`;
        ctx.fillText(`Each level: ${sel.blurb.replace(/\s*\/\s*level$/i, '')}`, acx, midY + 32);
        // Big segmented level bar.
        const segGap = 6, segH = 14;
        const segTotW = Math.min(420, aw - 120);
        const segW = (segTotW - segGap * (sel.max - 1)) / sel.max;
        const segX = acx - segTotW / 2, segY = midY + 58;
        for (let s = 0; s < sel.max; s++) {
            ctx.fillStyle = s < level ? rc : 'rgba(255,255,255,0.12)';
            ctx.fillRect(segX + s * (segW + segGap), segY, Math.max(2, segW), segH);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `600 16px ${FONT}`;
        ctx.fillText(`Level ${level} / ${sel.max}`, acx, segY + 38);
        // The ATTUNE button — one big, honest buy affordance. It anchors below
        // the segment bar; on short safe-area panels the FLAVOR text yields
        // first (footer, then the afford hint) so nothing ever overlaps it.
        const bw = Math.min(340, aw - 120), bh = 64;
        const br = { x: acx - bw / 2, y: segY + 62, w: bw, h: bh };
        this._button(ctx, br, maxed ? 'FULLY ATTUNED' : `ATTUNE  ·  ◎ ${cost}`,
            { enabled: afford, primary: afford, action: maxed ? null : 'attuneRelic', arg: sel.id, fontSize: 26 });
        const footY = c.y + c.h - 56;
        const footFits = footY >= br.y + bh + 44;
        const hintY = br.y + bh + 26;
        if (!maxed && !afford && hintY <= (footFits ? footY - 22 : c.y + c.h - 20)) {
            ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = `500 16px ${FONT}`;
            ctx.fillText(`Bank ◎ ${(cost - save.totalCoins).toLocaleString()} more on runs to afford this`, acx, hintY);
        }
        // Altar footer — what attunement IS, anchored to the pane's foot.
        if (footFits) {
            ctx.fillStyle = 'rgba(255,158,207,0.45)'; ctx.font = `500 16px ${FONT}`;
            ctx.fillText('The altar remembers — attunements survive every death,', acx, footY);
            ctx.fillText('applied the moment a run begins.', acx, footY + 22);
        }
    }

    // '+6 Max HP / level' → {sign,num,pct,what} for the altar's "Attuned now"
    // math (display only — the real effect stays ATTUNABLE's per()). Null when
    // a blurb doesn't match the pattern; the pane then shows generic text.
    _attunePer(def) {
        const m = /^([+-])(\d+(?:\.\d+)?)(%?)\s*(.+?)\s*\/\s*level$/i.exec(def.blurb || '');
        return m ? { sign: m[1], num: parseFloat(m[2]), pct: m[3], what: m[4] } : null;
    }

    // Procedural relic sigil: a faceted gem in the relic's rarity color —
    // diamond core, facet lines, and (epic+) an orbit ring. Pure paths, no
    // assets. `t` (optional) adds a slow glint rotation on the big altar copy.
    _relicSigil(ctx, cx, cy, s, col, rarity = 'common', t = 0) {
        const tier = RARITIES[rarity] ? RARITIES[rarity].tier : 1;
        ctx.save();
        ctx.strokeStyle = col; ctx.fillStyle = col;
        ctx.lineWidth = Math.max(1.5, s * 0.09); ctx.lineJoin = 'round';
        // Gem body — a tall diamond.
        ctx.beginPath();
        ctx.moveTo(cx, cy - s);
        ctx.lineTo(cx + s * 0.72, cy);
        ctx.lineTo(cx, cy + s);
        ctx.lineTo(cx - s * 0.72, cy);
        ctx.closePath();
        ctx.globalAlpha = 0.28; ctx.fill();
        ctx.globalAlpha = 1; ctx.stroke();
        // Facets: a horizontal girdle + two shoulder cuts.
        ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.moveTo(cx - s * 0.72, cy); ctx.lineTo(cx + s * 0.72, cy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - s * 0.36, cy - s * 0.5); ctx.lineTo(cx, cy); ctx.lineTo(cx + s * 0.36, cy - s * 0.5); ctx.stroke();
        ctx.globalAlpha = 1;
        // Epic+ relics earn an orbit ring; legendary a second, tilted one.
        if (tier >= 4) {
            ctx.globalAlpha = 0.55;
            ctx.beginPath(); ctx.ellipse(cx, cy, s * 1.25, s * 0.5, t * 0.4, 0, TAU); ctx.stroke();
            if (tier >= 5) { ctx.beginPath(); ctx.ellipse(cx, cy, s * 1.25, s * 0.5, t * 0.4 + Math.PI / 3, 0, TAU); ctx.stroke(); }
            ctx.globalAlpha = 1;
        }
        ctx.restore();
    }

    // Compact segmented controls shared by Collection and Boutique. Selected
    // state is communicated with fill + border + text (not color alone); every
    // other segment is a named Canvas hotspot for keyboard/pointer parity.
    _segmentedRow(ctx, options, selected, x, y, w, h, action, accent = '#c08bff', presentation = null) {
        const gap = presentation?.gap ?? 6;
        const segW = (w - gap * (options.length - 1)) / Math.max(1, options.length);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let i = 0; i < options.length; i++) {
            const option = options[i];
            const sx = x + i * (segW + gap);
            const active = option.id === selected;
            roundRectPath(ctx, sx, y, segW, h, presentation?.radius ?? 8);
            ctx.fillStyle = active ? 'rgba(192,139,255,0.18)' : 'rgba(255,255,255,0.035)';
            ctx.fill();
            ctx.strokeStyle = active ? accent : 'rgba(255,255,255,0.10)';
            ctx.lineWidth = active ? 2 : 1.25; ctx.stroke();
            ctx.fillStyle = active ? '#fff' : 'rgba(220,228,238,0.66)';
            const fontSize = presentation?.fontSize
                ?? Math.max(10, Math.min(14, Math.round(h * 0.38)));
            if (presentation?.fit === true) {
                this._fitFont(ctx, option.label, segW - 14, 800, fontSize, FONT,
                    presentation.fontFloor ?? 22);
            } else ctx.font = `800 ${fontSize}px ${FONT}`;
            ctx.fillText(option.label, sx + segW / 2, y + h / 2 + 0.5);
            if (!active) this._hot(sx, y, segW, h, action, option.id,
                option.accessibleLabel || '');
        }
    }

    _drawCollectionCard(ctx, state, entry, rect, mode = 'collection', presentation = null) {
        const item = entry?.item;
        if (!item) return;
        const save = state.saveData;
        const owned = entry.owned === true || save.cosmetics.unlocked.includes(item.id);
        const equipped = save.cosmetics.equipped[item.category] === item.id;
        const routes = Array.isArray(entry.sources)
            ? entry.sources : getCosmeticAcquisitionRoutes(item);
        const sourceLabel = getCosmeticSourceLabel(item) || 'Case';
        const tried = mode === 'boutique' && state.tryOn?.[item.category] === item.id;
        const col = rarityColor(item.rarity);
        roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 10);
        ctx.fillStyle = equipped ? 'rgba(255,206,84,0.13)'
            : tried ? 'rgba(255,126,219,0.14)' : 'rgba(255,255,255,0.035)';
        ctx.fill();
        ctx.strokeStyle = equipped ? '#ffce54' : tried ? '#ff7edb' : owned ? col : 'rgba(255,255,255,0.12)';
        ctx.lineWidth = equipped || tried ? 2.5 : 1.5; ctx.stroke();

        const phone = presentation?.phone === true;
        const swatch = phone
            ? Math.max(68, Math.min(96, rect.h - 26))
            : Math.max(34, Math.min(58, rect.h - 22));
        this._cosmeticSwatch(ctx, item.category, item,
            rect.x + 10, rect.y + (rect.h - swatch) / 2, swatch);
        const tx = rect.x + swatch + (phone ? 26 : 22);
        const textW = Math.max(40, rect.w - swatch - (phone ? 40 : 34));
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#fff';
        const titleSize = phone ? presentation.cardTitleFontPx : rect.h < 86 ? 14 : 17;
        const metaSize = phone ? presentation.cardMetaFontPx : rect.h < 86 ? 10 : 12;
        ctx.font = `800 ${titleSize}px ${FONT}`;
        ctx.fillText(this._ellip(ctx, item.name, textW), tx,
            rect.y + (phone ? rect.h * 0.31 : Math.max(22, rect.h * 0.29)));
        ctx.fillStyle = col; ctx.font = `800 ${metaSize}px ${FONT}`;
        ctx.fillText(rarityName(item.rarity).toUpperCase(), tx,
            rect.y + (phone ? rect.h * 0.56 : Math.max(38, rect.h * 0.48)));

        let status = sourceLabel;
        let statusColor = 'rgba(205,214,226,0.64)';
        if (equipped) { status = `EQUIPPED · ${sourceLabel}`; statusColor = '#ffce54'; }
        else if (owned) { status = `OWNED · ${sourceLabel}`; statusColor = '#5fd36a'; }
        else if (mode === 'boutique') {
            status = `◎ ${cosmeticCoinCost(item).toLocaleString()}${routes.includes('case') ? ' · Case' : ''}`;
            statusColor = '#ffd86b';
        }
        ctx.fillStyle = statusColor;
        this._fitFont(ctx, status, textW, 700, metaSize, FONT, phone ? 22 : 9);
        ctx.fillText(status, tx, rect.y + rect.h - (phone ? rect.h * 0.12 : rect.h < 86 ? 10 : 14));

        let action = null, arg = null, label = '';
        if (mode === 'boutique') {
            action = 'tryOnCosmetic'; arg = { category: item.category, id: item.id };
            label = `Try on ${item.name}. ${owned ? 'Owned.' : `${cosmeticCoinCost(item)} coins.`}`;
        } else if (owned && !equipped) {
            action = 'equipCosmetic'; arg = { category: item.category, id: item.id };
            label = `Equip ${item.name}`;
        } else if (!owned && routes.includes('blueprint')) {
            action = 'openCollectionBlueprint'; arg = item.id;
            label = `Open guaranteed Mythic Blueprint details for ${item.name}`;
        } else if (!owned && routes.includes('boutique')) {
            action = 'tryInBoutique'; arg = { category: item.category, id: item.id };
            label = `Try ${item.name} in Boutique. ${cosmeticCoinCost(item)} coins.`;
        } else if (!owned && routes.length === 1 && routes[0] === 'vigil') {
            action = 'tab'; arg = 'battlepass'; label = `Open Battle Pass for ${item.name}`;
        }
        if (action) this._hot(rect.x, rect.y, rect.w, rect.h, action, arg, label);
    }

    // Reachable, scalable Collection: exactly one selected category, explicit
    // ownership/source filters, and eight cards per page. This replaces the old
    // five shrinking columns that silently clipped ten live cosmetics.
    _drawCosmeticCollection(ctx, state, rect, presentation = null) {
        const save = state.saveData;
        const phone = presentation?.phone === true;
        const view = state.collectionView || {};
        const model = buildCosmeticCollectionPage({
            category: view.category || 'fur',
            ownership: view.ownership || 'all',
            source: view.source || 'all',
            page: view.page || 1,
            ownedIds: save.cosmetics.unlocked,
        });
        this._panel(ctx, rect.x, rect.y, rect.w, rect.h,
            'rgba(16,20,28,0.82)', 'rgba(192,139,255,0.22)');
        const pad = 10;
        const x = rect.x + pad, w = rect.w - pad * 2;
        const categories = [
            { id: 'fur', label: 'FUR' }, { id: 'cloak', label: 'CLOAK' },
            { id: 'hat', label: 'ACCESSORY' }, { id: 'aura', label: 'AURA' },
            { id: 'trail', label: 'TRAIL' },
        ];
        const ownership = phone ? [
            { id: 'all', label: 'ALL', accessibleLabel: 'All items' },
            { id: 'owned', label: 'OWNED' }, { id: 'locked', label: 'LOCKED' },
        ] : [
            { id: 'all', label: 'ALL ITEMS' }, { id: 'owned', label: 'OWNED' },
            { id: 'locked', label: 'LOCKED' },
        ];
        const sources = phone ? [
            { id: 'all', label: 'ALL', accessibleLabel: 'All sources' },
            { id: 'starter', label: 'STARTER' },
            { id: 'boutique', label: 'SHOP', accessibleLabel: 'Boutique source' },
            { id: 'blueprint', label: 'BLUEPRINT', accessibleLabel: 'Mythic Blueprint source' },
            { id: 'case', label: 'CASES' },
            { id: 'achievement', label: 'ACHIEVE', accessibleLabel: 'Achievement source' },
            { id: 'vigil', label: 'VIGIL', accessibleLabel: 'Vigil Path source' },
        ] : [
            { id: 'all', label: 'ALL SOURCES' }, { id: 'starter', label: 'STARTER' },
            { id: 'boutique', label: 'BOUTIQUE' }, { id: 'blueprint', label: 'BLUEPRINT' },
            { id: 'case', label: 'CASES' },
            { id: 'achievement', label: 'ACHIEVEMENT' }, { id: 'vigil', label: 'VIGIL PATH' },
        ];
        if (phone) {
            this._lastCollectionPhoneLayout = true;
            this._lastCollectionTouchSafe = presentation.touchSafe === true
                && this._lastCollectionNavTouchSafe === true;
            this._lastCollectionMinTouchCss = Math.min(
                presentation.minTouchCss || 0,
                this._lastCollectionNavMinTouchCss || 0,
            );
            if (presentation.compact) {
                const nextOption = (options, selected) => {
                    const index = Math.max(0, options.findIndex((option) => option.id === selected));
                    return options[(index + 1) % options.length];
                };
                const currentCategory = categories.find((option) => option.id === model.category) || categories[0];
                const currentOwnership = ownership.find((option) => option.id === model.ownership) || ownership[0];
                const currentSource = sources.find((option) => option.id === model.source) || sources[0];
                const nextCategory = nextOption(categories, model.category);
                const nextOwnership = nextOption(ownership, model.ownership);
                const nextSource = nextOption(sources, model.source);
                this._button(ctx, presentation.categoryRow,
                    `CATEGORY: ${currentCategory.label}`, {
                        action: 'collectionCategory', arg: nextCategory.id,
                        accent: 'rgba(88,48,118,0.95)', fontSize: presentation.filterFontPx,
                        accessibleLabel: `Category ${currentCategory.label}. Change to ${nextCategory.label}`,
                    });
                this._button(ctx, presentation.ownershipRow,
                    `SHOW: ${currentOwnership.label}`, {
                        action: 'collectionOwnership', arg: nextOwnership.id,
                        accent: 'rgba(35,76,106,0.95)', fontSize: presentation.filterFontPx,
                        accessibleLabel: `Showing ${currentOwnership.label}. Change to ${nextOwnership.label}`,
                    });
                this._button(ctx, presentation.sourceRow,
                    `SOURCE: ${currentSource.label}`, {
                        action: 'collectionSource', arg: nextSource.id,
                        accent: 'rgba(112,62,28,0.95)', fontSize: presentation.filterFontPx,
                        accessibleLabel: `Source ${currentSource.label}. Change to ${nextSource.label}`,
                    });
                this._button(ctx, presentation.completionButton, 'COMPLETION', {
                    action: 'openCollectionCompletion',
                    accent: 'rgba(36,86,70,0.96)', fontSize: presentation.filterFontPx,
                    accessibleLabel: 'Open Collection Completion overview',
                });
                this._button(ctx, presentation.ritesButton, 'HERO RITES', {
                    action: 'characterPhonePane', arg: 'rites',
                    accent: 'rgba(88,48,118,0.95)', fontSize: presentation.filterFontPx,
                    accessibleLabel: 'Open Rites and Hero Attunement',
                });
            } else {
                this._segmentedRow(ctx, categories, model.category,
                    presentation.categoryRow.x, presentation.categoryRow.y,
                    presentation.categoryRow.w, presentation.categoryRow.h,
                    'collectionCategory', '#c08bff', {
                        gap: 8, radius: 12, fontSize: presentation.categoryFontPx,
                        fit: true, fontFloor: 26,
                    });
                this._segmentedRow(ctx, ownership, model.ownership,
                    presentation.ownershipRow.x, presentation.ownershipRow.y,
                    presentation.ownershipRow.w, presentation.ownershipRow.h,
                    'collectionOwnership', '#8fd0ff', {
                        gap: 8, radius: 12, fontSize: presentation.filterFontPx,
                        fit: true, fontFloor: 24,
                    });
                this._segmentedRow(ctx, sources, model.source,
                    presentation.sourceRow.x, presentation.sourceRow.y,
                    presentation.sourceRow.w, presentation.sourceRow.h,
                    'collectionSource', '#ffb45f', {
                        gap: 8, radius: 12, fontSize: presentation.filterFontPx,
                        fit: true, fontFloor: 22,
                    });
            }
        } else {
            this._segmentedRow(ctx, categories, model.category, x, rect.y + 9, w, 32,
                'collectionCategory', '#c08bff');
            this._segmentedRow(ctx, ownership, model.ownership, x, rect.y + 47, w, 26,
                'collectionOwnership', '#8fd0ff');
            this._segmentedRow(ctx, sources, model.source, x, rect.y + 79, w, 26,
                'collectionSource', '#ffb45f');
        }

        const footerH = phone ? presentation.footer.h : 56;
        const gridY = phone ? presentation.grid.y : rect.y + 113;
        const gridBottom = phone
            ? presentation.grid.y + presentation.grid.h
            : rect.y + rect.h - footerH - 8;
        const gridH = Math.max(1, gridBottom - gridY);
        const entries = Array.isArray(model.entries) ? model.entries : [];
        if (entries.length) {
            for (let i = 0; i < entries.length; i++) {
                if (phone) {
                    this._drawCollectionCard(ctx, state, entries[i], presentation.cards[i],
                        'collection', presentation);
                } else {
                    const cols = w >= 720 ? 4 : 2;
                    const rows = Math.max(1, Math.ceil(8 / cols));
                    const gap = 8;
                    const cardW = (w - gap * (cols - 1)) / cols;
                    const cardH = (gridH - gap * (rows - 1)) / rows;
                    const col = i % cols, row = Math.floor(i / cols);
                    this._drawCollectionCard(ctx, state, entries[i], {
                        x: x + col * (cardW + gap), y: gridY + row * (cardH + gap),
                        w: cardW, h: cardH,
                    });
                }
            }
        } else {
            const empty = typeof model.emptyState === 'string'
                ? model.emptyState
                : model.emptyState
                    ? `${model.emptyState.title}. ${model.emptyState.body}`
                    : 'No cosmetics match these filters.';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(220,228,238,0.58)';
            ctx.font = `700 ${phone ? presentation.cardTitleFontPx : 17}px ${FONT}`;
            ctx.fillText(empty, rect.x + rect.w / 2, gridY + gridH / 2);
        }

        const page = model.page || 1;
        const pageCount = model.pageCount || 1;
        const hasPrev = model.hasPreviousPage ?? model.hasPrev ?? model.hasPrevious ?? page > 1;
        const hasNext = model.hasNextPage ?? model.hasNext ?? page < pageCount;
        const fy = phone ? presentation.footer.y : rect.y + rect.h - 50;
        const previousButton = phone
            ? presentation.previousButton : { x, y: fy + 5, w: 116, h: 38 };
        const nextButton = phone
            ? presentation.nextButton : { x: x + w - 116, y: fy + 5, w: 116, h: 38 };
        const completionButton = phone ? null : {
            x: previousButton.x + previousButton.w + 8,
            y: fy + 5,
            w: Math.min(168, Math.max(132, w * 0.16)),
            h: 38,
        };
        this._button(ctx, previousButton, '‹ PREV', {
            enabled: hasPrev, action: hasPrev ? 'collectionPage' : null,
            arg: page - 1, fontSize: phone ? presentation.buttonFontPx : 13,
            accessibleLabel: `Previous collection page, ${page - 1}`,
        });
        this._button(ctx, nextButton, 'NEXT ›', {
            enabled: hasNext, action: hasNext ? 'collectionPage' : null,
            arg: page + 1, fontSize: phone ? presentation.buttonFontPx : 13,
            accessibleLabel: `Next collection page, ${page + 1}`,
        });
        if (completionButton) {
            this._button(ctx, completionButton, 'COMPLETION', {
                action: 'openCollectionCompletion', accent: 'rgba(36,86,70,0.96)',
                fontSize: 12,
                accessibleLabel: 'Open Collection Completion overview',
            });
        }
        const total = model.totalItems ?? model.totalCount ?? model.filteredCount
            ?? model.total ?? entries.length;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        // Completion math has one authority. Unknown legacy ids stay in the
        // save for compatibility but never inflate authored catalog progress.
        const completion = buildCosmeticCompletionSnapshot({
            ownedIds: save.cosmetics.unlocked,
            blueprintClaims: save.cosmetics.blueprintClaims,
            pursuitSetId: save.cosmetics.pursuitSetId,
            coinBalance: save.totalCoins,
            royalCosmeticPityCount: save.casePity?.royalCosmetic || 0,
        });
        const completedSets = completion.sets.filter((set) => set.complete).length;
        const pursued = completion.trackedSet;
        const focusSet = pursued || completion.closestSet;
        const summary = `PAGE ${page}/${pageCount} · ${total} MATCHES  |  OWNED ${completion.owned}/${completion.total} · SETS ${completedSets}/${completion.sets.length}`;
        ctx.fillStyle = 'rgba(220,228,238,0.72)';
        ctx.font = `800 ${phone ? presentation.footerFontPx : 12}px ${FONT}`;
        const phoneSummaryLeft = phone ? previousButton.x + previousButton.w + 18 : 0;
        const phoneSummaryRight = phone ? nextButton.x - 18 : 0;
        if (phone) {
            ctx.fillText(this._ellip(ctx, summary,
                Math.max(80, phoneSummaryRight - phoneSummaryLeft)),
            (phoneSummaryLeft + phoneSummaryRight) / 2,
            presentation.footerSummaryY);
        } else {
            const summaryLeft = completionButton.x + completionButton.w + 12;
            const summaryRight = nextButton.x - 12;
            ctx.fillText(this._ellip(ctx, summary, Math.max(120, summaryRight - summaryLeft)),
                (summaryLeft + summaryRight) / 2, fy + 12);
        }
        if (focusSet) {
            const progress = focusSet.owned;
            const missing = focusSet.missingItems?.[0]
                ? COSMETICS[focusSet.missingItems[0].id] : null;
            let next = 'COMPLETE · equip the full look in Boutique';
            if (missing) {
                const routes = getCosmeticAcquisitionRoutes(missing);
                if (routes.includes('boutique')) {
                    next = `NEXT ${missing.name}: ◎ ${cosmeticCoinCost(missing).toLocaleString()}`
                        + (routes.includes('case') ? ' or RANDOM cosmetic case' : '');
                } else if (routes.includes('achievement')) next = `NEXT ${missing.name}: Achievement`;
                else if (routes.includes('vigil')) next = `NEXT ${missing.name}: Vigil Path Lv ${missing.passLevel}`;
                else if (routes.includes('blueprint')) {
                    next = `NEXT ${missing.name}: GUARANTEED Blueprint ${cosmeticBlueprintCost(missing).toLocaleString()} coins`
                        + (routes.includes('case') ? ' or RANDOM Royal Cosmetic Case' : '');
                }
                else if (routes.includes('case')) next = `NEXT ${missing.name}: RANDOM cosmetic case drop`;
                else next = `NEXT ${missing.name}: ${getCosmeticSourceLabel(missing)}`;
            }
            const pursuitLine = `${pursued ? 'TRACKING' : 'CLOSEST'} ${focusSet.name} ${progress}/5 · ${next}`;
            if (phone) {
                ctx.fillStyle = focusSet.color;
                ctx.font = `800 ${presentation.trackingFontPx}px ${FONT}`;
                ctx.fillText(this._ellip(ctx, pursuitLine,
                    Math.max(80, phoneSummaryRight - phoneSummaryLeft)),
                (phoneSummaryLeft + phoneSummaryRight) / 2,
                presentation.footerTrackingY);
                this._lastCollectionPursuitGuidance = true;
            } else {
                ctx.fillStyle = focusSet.color; ctx.font = `800 11px ${FONT}`;
                ctx.fillText(this._ellip(ctx, pursuitLine,
                    Math.max(120, nextButton.x - 12
                        - (completionButton.x + completionButton.w + 12))),
                (completionButton.x + completionButton.w + 12 + nextButton.x - 12) / 2,
                fy + 33);
            }
        }
    }

    // ── LOADOUT / CHARACTER shared grid ──────────────────────────────────
    // `rect` lets the CHARACTER customizer constrain the cosmetic columns to
    // the right of the live model; LOADOUT passes none → full content rect.
    _drawItemGrid(ctx, state, kind, rect = null) {
        if (kind === 'cosmetic') {
            this._drawCosmeticCollection(ctx, state, rect || this._contentRect());
            return;
        }
        const c = rect || this._contentRect();
        const save = state.saveData;
        const cats = kind === 'gear' ? GEAR_CATEGORIES : COSMETIC_CATEGORIES;
        const labels = kind === 'gear' ? GEAR_CATEGORY_LABELS : COSMETIC_CATEGORY_LABELS;
        const equipped = kind === 'gear' ? save.gear.equipped : save.cosmetics.equipped;
        const isUnlocked = (id) => (kind === 'gear' ? save.gear.unlocked : save.cosmetics.unlocked).includes(id);
        const itemsFor = kind === 'gear' ? gearByCategory : cosmeticsByCategory;

        const colW = (c.w - (cats.length - 1) * 18) / cats.length;
        const ig = 8;
        // Cosmetic rows shrink to fit the WHOLE category in the column (no
        // scroll, nothing clipped) — the safe-area can make the content rect
        // shorter than it looks, so size off the most-populated category.
        let cih = 56;
        if (kind !== 'gear') {
            const maxN = Math.max(1, ...cats.map((cc) => itemsFor(cc).length));
            const availH = c.h - 56 - 8;
            // Size so the WHOLE tallest category fits (the clip below would
            // otherwise drop the last cards — e.g. coin/achievement cosmetics
            // whose card is their only unlock surface). The min is just a
            // sanity floor for degenerate (sub-360px) content rects; realistic
            // phone-landscape heights land ~30–40px and still fit all items.
            cih = Math.max(24, Math.min(58, Math.floor((availH - ig * (maxN - 1)) / maxN)));
        }
        ctx.textBaseline = 'alphabetic';
        for (let ci = 0; ci < cats.length; ci++) {
            const cat = cats[ci];
            const x = c.x + ci * (colW + 18);
            this._panel(ctx, x, c.y, colW, c.h, 'rgba(16,20,28,0.8)');
            ctx.textAlign = 'center';
            ctx.fillStyle = '#cdd6e2'; ctx.font = `700 22px ${FONT}`;
            ctx.fillText(labels[cat], x + colW / 2, c.y + 34);
            const items = itemsFor(cat);
            let iy = c.y + 56;
            // Gear cards are taller so each can carry a short line describing
            // what its buffs actually DO (the player asked for this); cosmetics
            // have no buffs, so they stay compact.
            const ih = kind === 'gear' ? 88 : cih;
            const innerW = colW - 24;
            // Card text/swatch positions scale with the (possibly compact) row.
            const nameY = kind === 'gear' ? 26 : Math.round(ih * 0.42);
            const statusY = kind === 'gear' ? 48 : Math.round(ih * 0.78);
            const isz = kind === 'gear' ? 30 : Math.min(30, ih - 18);
            for (const item of items) {
                if (iy + ih > c.y + c.h - 8) break; // clip to column
                const unlocked = isUnlocked(item.id);
                const equippedHere = equipped[cat] === item.id;
                const col = rarityColor(item.rarity);
                // Unlock state → status line + how the card behaves. Cosmetics
                // can be owned, bought with coins, earned via an achievement, or
                // found only in cases; gear keeps its simpler owned/locked read.
                let statusText, statusCol, action = null;
                if (equippedHere) { statusText = 'EQUIPPED'; statusCol = '#ffce54'; }
                else if (unlocked) {
                    statusText = rarityName(item.rarity); statusCol = col;
                    action = kind === 'gear' ? 'equipGear' : 'equipCosmetic';
                } else if (kind === 'cosmetic' && item.passLevel) {
                    statusText = `✦ Vigil Path · Lv ${item.passLevel}`;
                    statusCol = 'rgba(255,154,74,0.95)';
                    action = 'tab';
                } else if (kind === 'cosmetic' && item.coinCost) {
                    // Buying moved to the BOUTIQUE (tab exclusivity: CHARACTER
                    // equips, the shop sells) — tapping stages the item in the
                    // fitting room and jumps there, try-on ready.
                    statusText = `◎ ${cosmeticCoinCost(item)} · in Boutique`;
                    statusCol = 'rgba(255,216,107,0.75)';
                    action = 'tryInBoutique';
                } else if (kind === 'cosmetic' && item.achievement) {
                    const ach = ACHIEVEMENTS.find((a) => a.id === item.achievement);
                    statusText = `🏆 ${ach ? ach.name : 'Achievement'}`;
                    statusCol = 'rgba(168,213,247,0.92)';
                } else {
                    statusText = kind === 'cosmetic' ? '🔒 Case drop' : '🔒 LOCKED';
                    statusCol = 'rgba(255,255,255,0.5)';
                }
                const buyable = action === 'tryInBoutique';   // boutique-linked coin item
                const routed = buyable || action === 'tab';
                const lit = unlocked || routed;       // full-opacity (vs faded-locked)
                const dim = lit ? 1 : 0.4;
                roundRectPath(ctx, x + 12, iy, innerW, ih, 10);
                ctx.fillStyle = equippedHere ? 'rgba(255,206,84,0.16)'
                    : action === 'tab' ? 'rgba(255,120,50,0.08)'
                    : buyable ? 'rgba(255,216,107,0.06)' : 'rgba(255,255,255,0.04)';
                ctx.fill();
                ctx.strokeStyle = equippedHere ? '#ffce54' : unlocked ? col
                    : action === 'tab' ? 'rgba(255,154,74,0.65)'
                    : buyable ? 'rgba(255,216,107,0.5)' : 'rgba(255,255,255,0.08)';
                ctx.lineWidth = equippedHere ? 3 : 2; ctx.stroke();
                ctx.textAlign = 'left';
                ctx.globalAlpha = dim;
                ctx.fillStyle = lit ? '#fff' : 'rgba(255,255,255,0.7)';
                ctx.font = `700 ${kind === 'gear' ? 20 : Math.min(20, Math.round(ih * 0.36))}px ${FONT}`;
                ctx.fillText(this._ellip(ctx, item.name, innerW - 56), x + 26, iy + nameY);
                ctx.fillStyle = statusCol; ctx.font = `600 ${kind === 'gear' ? 15 : Math.min(15, Math.round(ih * 0.28))}px ${FONT}`;
                ctx.fillText(this._ellip(ctx, statusText, innerW - 30), x + 26, iy + statusY);
                // Slot icon / swatch. Cosmetics show a representative preview of
                // the actual item (pixel cloak/hat, fur tint disc, aura glow,
                // trail puffs); gear shows its forged category emblem (weapon =
                // crossed ember wands matching the game's wand combat, armor,
                // trinket, charm), falling back to the rarity shield until the
                // emblem art loads (or in a non-DOM env). Rarity still reads via
                // the card border + status colour.
                {
                    const ix = x + 12 + innerW - isz - 12, iyy = iy + (kind === 'gear' ? 12 : Math.round((ih - isz) / 2));
                    ctx.save();
                    ctx.globalAlpha = dim;
                    if (kind === 'cosmetic') this._cosmeticSwatch(ctx, cat, item, ix, iyy, isz);
                    else {
                        const emblem = getGearEmblem(cat);
                        if (emblem) ctx.drawImage(emblem, ix, iyy, isz, isz);
                        else ctx.drawImage(getRarityIcon('shield', item.rarity), ix, iyy, isz, isz);
                    }
                    ctx.restore();
                }
                // Gear: short effect summary so the player knows what each item
                // grants. Buff bag → human strings; a buffless starting weapon
                // falls back to its flavor description (trimmed to one line).
                if (kind === 'gear') {
                    const buffs = buffSummary(item.buffs);
                    const text = (buffs.length ? buffs.join(' · ')
                        : (item.description || '').replace(/^Start (?:each vigil )?with the [^.]+\.\s*/i, '').trim())
                        || 'No bonuses — base option.';
                    ctx.fillStyle = 'rgba(206,214,226,0.82)';
                    ctx.font = `500 13px ${FONT}`;
                    // Word-wrap to at most two lines within the card width.
                    const maxW = innerW - 28;
                    const words = text.split(/\s+/);
                    const lines = [];
                    let line = '';
                    for (const w of words) {
                        const test = line ? line + ' ' + w : w;
                        if (ctx.measureText(test).width > maxW && line) {
                            lines.push(line); line = w;
                            if (lines.length >= 2) break;
                        } else line = test;
                    }
                    if (line && lines.length < 2) lines.push(line);
                    for (let li = 0; li < lines.length; li++) ctx.fillText(lines[li], x + 26, iy + 68 + li * 16);
                }
                ctx.globalAlpha = 1;
                if (action) this._hot(x + 12, iy, innerW, ih, action,
                    action === 'tab' ? 'battlepass' : { category: cat, id: item.id });
                iy += ih + ig;
            }
        }
    }

    _drawLoadout(ctx, state) { this._drawItemGrid(ctx, state, 'gear'); }

    // Truncate `txt` with an ellipsis so it fits `maxW` at the CURRENT font.
    _ellip(ctx, txt, maxW) {
        if (ctx.measureText(txt).width <= maxW) return txt;
        let s = String(txt);
        while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
        return s + '…';
    }

    // A small representative preview of a cosmetic for the picker/summary: a
    // pixel cloak/hat, a fur tint disc, an aura glow, or trail puffs. "None"
    // items (no color/shape) get a hollow slashed ring. Caller controls alpha.
    _cosmeticSwatch(ctx, cat, item, ix, iyy, isz) {
        const icx = ix + isz / 2, icy = iyy + isz / 2;
        const isNone = cat === 'hat' ? (!item.shape || item.shape === 'none')
            : (cat === 'cloak' || cat === 'trail') ? !item.color : false;
        if (isNone) {
            ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(icx, icy, isz * 0.34, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(icx - isz * 0.24, icy + isz * 0.24); ctx.lineTo(icx + isz * 0.24, icy - isz * 0.24); ctx.stroke();
            return;
        }
        if (cat === 'cloak') {
            ctx.save(); ctx.beginPath(); ctx.rect(ix, iyy, isz, isz); ctx.clip();
            const ps = isz * 0.78; drawPixelCloak(ctx, icx, icy - ps * 0.34, ps,
                'down', item.color, false, item.cloakStyle || 'classic');
            ctx.restore(); return;
        }
        if (cat === 'hat') {
            ctx.save(); ctx.beginPath(); ctx.rect(ix, iyy, isz, isz); ctx.clip();
            const ps = isz * 0.78; drawPixelHat(ctx, icx, icy + ps * 0.36, ps, 'down', item.shape, item.color, false);
            ctx.restore(); return;
        }
        if (cat === 'aura') {
            const col = item.color || '#ff9a3c';
            drawAuraFx(ctx, icx, icy, isz * 0.5, col, item.fx,
                this._t, 0.62, this._reducedMotion);
            ctx.fillStyle = col; ctx.beginPath(); ctx.arc(icx, icy, 3.5, 0, Math.PI * 2); ctx.fill();
            return;
        }
        if (cat === 'trail') {
            ctx.save();
            const baseA = ctx.globalAlpha;
            for (let d = 0; d < 3; d++) {
                ctx.globalAlpha = baseA * (1 - d * 0.28);
                drawTrailPoint(ctx, ix + isz * (0.24 + d * 0.25), icy,
                    Math.max(2, isz * (0.18 - d * 0.025)), 1 - d * 0.26,
                    item.color, item.fx, this._t, d, this._reducedMotion);
            }
            ctx.restore(); return;
        }
        // Fur material swatches use the same finite style vocabulary as the
        // baked live frames, so I-B patterns are visible before try-on/opening.
        ctx.save(); ctx.beginPath(); ctx.rect(ix, iyy, isz, isz); ctx.clip();
        drawPixelFurSwatch(ctx, ix, iyy, isz, item.color || '#b98a5a',
            item.furStyle || 'solid', item.furAccent, item.furAccent2);
        ctx.restore();
        if (!item.color) {
            ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(icx - isz * 0.24, icy + isz * 0.24); ctx.lineTo(icx + isz * 0.24, icy - isz * 0.24); ctx.stroke();
        }
    }

    _completionPercent(basisPoints) {
        const value = Math.max(0, Math.min(10000,
            Number.isFinite(basisPoints) ? Math.floor(basisPoints) : 0));
        return `${(value / 100).toFixed(value % 100 === 0 ? 0 : value % 10 === 0 ? 1 : 2)}%`;
    }

    _completionRouteLabel(routes) {
        const labels = {
            starter: 'Starter', boutique: 'Boutique', blueprint: 'Blueprint',
            case: 'Random Case', achievement: 'Achievement', vigil: 'Vigil Path',
        };
        return (Array.isArray(routes) ? routes : [])
            .map((route) => labels[route] || route).join(' / ') || 'Unknown route';
    }

    // Completion screens are unusually dense at the supported 480×270 floor.
    // Track the actual post-fit font size for each painted row and prove those
    // rows stay inside their authored lane without touching one another.
    _completionTextLaneSafe(rect, rows) {
        if (!rect || !Array.isArray(rows) || !rows.length) return false;
        const spans = rows.map((row) => ({
            top: row.y - row.size * 0.52,
            bottom: row.y + row.size * 0.52,
        })).sort((a, b) => a.top - b.top);
        if (spans.some((span) => !Number.isFinite(span.top + span.bottom)
            || span.top < rect.y - 0.001
            || span.bottom > rect.y + rect.h + 0.001)) return false;
        return spans.every((span, index) => index === 0
            || spans[index - 1].bottom <= span.top + 0.001);
    }

    _drawCompletionOverview(ctx, model, layout) {
        const body = layout.body;
        const gap = layout.phone ? 8 : 12;
        const compact = layout.phone && body.h * layout.cssScale < 150;
        let textSafe = true;
        const completeSets = model.sets.filter((set) => set.complete).length;
        const topH = compact
            ? Math.max(96, layout.smallFontPx * 3.1)
            : Math.max(100, body.h * 0.39);
        const cards = segmentedRects({ x: body.x, y: body.y, w: body.w, h: topH }, 4, gap);
        const summaries = [
            { label: 'WHOLE COLLECTION', value: `${model.owned}/${model.total}`, meta: this._completionPercent(model.basisPoints), color: '#c08bff' },
            { label: 'COMPLETE SETS', value: `${completeSets}/${model.sets.length}`, meta: completeSets ? 'full looks forged' : 'first full look ahead', color: '#ffce54' },
            { label: 'WITH A KNOWN ROUTE', value: String(model.deterministic.total), meta: 'guaranteed path available', color: '#5fd36a' },
            { label: 'RANDOM-ONLY', value: String(model.caseOnly.total), meta: `${model.caseOnly.mythicTotal} case-only Mythics`, color: '#ff9a4a' },
        ];
        for (let i = 0; i < cards.length; i++) {
            const card = cards[i], summary = summaries[i];
            this._panel(ctx, card.x, card.y, card.w, card.h,
                'rgba(255,255,255,0.035)', `${summary.color}55`);
            const cx = card.x + card.w / 2;
            const rows = [];
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = summary.color;
            const labelY = card.y + card.h * (compact ? 0.26 : 0.22);
            const labelSize = this._fitFont(ctx, summary.label, card.w - 16, 800,
                layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 10));
            ctx.fillText(this._ellip(ctx, summary.label, card.w - 16), cx, labelY);
            rows.push({ y: labelY, size: labelSize });
            ctx.fillStyle = '#fff';
            const valueY = card.y + card.h * (compact ? 0.72 : 0.55);
            const valueSize = this._fitFont(ctx, summary.value, card.w - 16, 900,
                layout.phone ? layout.titleFontPx * (compact ? 1 : 1.25) : 34,
                FONT, Math.max(24, layout.titleFontPx - 8));
            ctx.fillText(this._ellip(ctx, summary.value, card.w - 16), cx, valueY);
            rows.push({ y: valueY, size: valueSize });
            if (!compact) {
                ctx.fillStyle = 'rgba(225,232,242,0.68)';
                const metaY = card.y + card.h * 0.81;
                const metaSize = this._fitFont(ctx, summary.meta, card.w - 20, 700,
                    layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 8));
                ctx.fillText(this._ellip(ctx, summary.meta, card.w - 20), cx, metaY);
                rows.push({ y: metaY, size: metaSize });
            }
            textSafe = textSafe && this._completionTextLaneSafe(card, rows);
        }

        const disclosureH = compact
            ? Math.max(52, layout.smallFontPx * 1.7)
            : Math.max(34, layout.smallFontPx * 1.6);
        const categoryY = body.y + topH + gap;
        const categoryH = Math.max(1, body.y + body.h - disclosureH - gap - categoryY);
        const categories = segmentedRects({
            x: body.x, y: categoryY, w: body.w, h: categoryH,
        }, 5, gap);
        for (let i = 0; i < categories.length; i++) {
            const rect = categories[i];
            const row = model.categories[i];
            if (!row) continue;
            this._panel(ctx, rect.x, rect.y, rect.w, rect.h,
                'rgba(14,22,30,0.84)', 'rgba(143,208,255,0.22)');
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            const rows = [];
            const title = compact
                ? `${row.label.toUpperCase()} · ${row.owned}/${row.total}`
                : row.label.toUpperCase();
            const titleY = rect.y + rect.h * (compact ? 0.32 : 0.22);
            ctx.fillStyle = compact ? '#8fd0ff' : '#fff';
            const titleSize = this._fitFont(ctx, title, rect.w - 20, 800,
                layout.bodyFontPx, FONT, Math.max(20, layout.bodyFontPx - 12));
            ctx.fillText(this._ellip(ctx, title, rect.w - 20), rect.x + 10, titleY);
            rows.push({ y: titleY, size: titleSize });
            if (compact) {
                const missingY = rect.y + rect.h * 0.74;
                ctx.fillStyle = 'rgba(225,232,242,0.74)';
                const missingSize = this._fitFont(ctx, `${row.missing} MISSING`, rect.w - 20,
                    700, layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 10));
                ctx.fillText(this._ellip(ctx, `${row.missing} MISSING`, rect.w - 20),
                    rect.x + 10, missingY);
                rows.push({ y: missingY, size: missingSize });
                textSafe = textSafe && this._completionTextLaneSafe(rect, rows);
                continue;
            }
            ctx.fillStyle = '#8fd0ff';
            const countY = rect.y + rect.h * 0.51;
            const countSize = this._fitFont(ctx, `${row.owned}/${row.total}`, rect.w - 20,
                900, layout.phone ? layout.titleFontPx : 27, FONT,
                Math.max(22, layout.titleFontPx - 10));
            ctx.fillText(`${row.owned}/${row.total}`, rect.x + 10, countY);
            rows.push({ y: countY, size: countSize });
            const bx = rect.x + 10, by = rect.y + rect.h * 0.71, bw = rect.w - 20;
            roundRectPath(ctx, bx, by, bw, Math.max(8, layout.smallFontPx * 0.45), 5);
            ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill();
            if (row.basisPoints > 0) {
                roundRectPath(ctx, bx, by, bw * row.basisPoints / 10000,
                    Math.max(8, layout.smallFontPx * 0.45), 5);
                ctx.fillStyle = '#8fd0ff'; ctx.fill();
            }
            ctx.fillStyle = 'rgba(225,232,242,0.68)';
            const missingY = rect.y + rect.h * 0.90;
            const missingSize = this._fitFont(ctx, `${row.missing} missing`, rect.w - 20,
                700, layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 8));
            ctx.fillText(this._ellip(ctx, `${row.missing} missing`, rect.w - 20),
                rect.x + 10, missingY);
            rows.push({ y: missingY, size: missingSize });
            textSafe = textSafe && this._completionTextLaneSafe(rect, rows);
        }
        const disclosure = {
            x: body.x, y: body.y + body.h - disclosureH,
            w: body.w, h: disclosureH,
        };
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffd8b0';
        const disclosureText = `ROUTE COUNTS OVERLAP; THEY DO NOT ADD TO ${model.total}.`;
        const disclosureSize = this._fitFont(ctx, disclosureText, disclosure.w - 16, 800,
            layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 10));
        const disclosureY = disclosure.y + disclosure.h / 2;
        ctx.fillText(this._ellip(ctx, disclosureText, disclosure.w - 16),
            disclosure.x + disclosure.w / 2, disclosureY);
        textSafe = textSafe && this._completionTextLaneSafe(disclosure,
            [{ y: disclosureY, size: disclosureSize }]);
        this._lastCollectionCompletionTextSafe = this._lastCollectionCompletionTextSafe
            && textSafe;
    }

    _drawCompletionSets(ctx, state, model, layout) {
        const perPage = layout.phone ? 3 : 5;
        const pageCount = Math.max(1, Math.ceil(model.sets.length / perPage));
        const requested = Number(state.collectionCompletion?.page);
        const page = Math.max(1, Math.min(pageCount,
            Number.isInteger(requested) ? requested : 1));
        const entries = model.sets.slice((page - 1) * perPage, page * perPage);
        const gap = layout.phone ? 8 : 12;
        const cards = segmentedRects(layout.setGrid, perPage, gap);
        let textSafe = true;
        for (let i = 0; i < entries.length; i++) {
            const set = entries[i], rect = cards[i];
            this._panel(ctx, rect.x, rect.y, rect.w, rect.h,
                set.complete ? 'rgba(24,58,35,0.74)' : 'rgba(255,255,255,0.035)',
                `${set.color || '#c08bff'}88`);
            const pad = 12, textW = rect.w - pad * 2;
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillStyle = set.complete ? '#8ff29a' : '#fff';
            this._fitFont(ctx, `${set.tracked ? 'TRACKED · ' : ''}${set.name}`,
                textW, 800, layout.bodyFontPx, FONT, layout.phone ? 22 : 11);
            ctx.fillText(this._ellip(ctx, `${set.tracked ? 'TRACKED · ' : ''}${set.name}`, textW),
                rect.x + pad, rect.y + rect.h * 0.11);
            ctx.textAlign = 'right'; ctx.fillStyle = set.color || '#c08bff';
            ctx.font = `900 ${layout.bodyFontPx}px ${FONT}`;
            ctx.fillText(`${set.owned}/${set.total}`, rect.x + rect.w - pad, rect.y + rect.h * 0.11);
            const bx = rect.x + pad, by = rect.y + rect.h * 0.19, bw = textW;
            roundRectPath(ctx, bx, by, bw, Math.max(8, layout.smallFontPx * 0.42), 5);
            ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill();
            if (set.basisPoints > 0) {
                roundRectPath(ctx, bx, by, bw * set.basisPoints / 10000,
                    Math.max(8, layout.smallFontPx * 0.42), 5);
                ctx.fillStyle = set.complete ? '#5fd36a' : set.color; ctx.fill();
            }
            const missing = set.missingItems || [];
            ctx.textAlign = 'left'; ctx.font = `700 ${layout.smallFontPx}px ${FONT}`;
            if (!missing.length) {
                ctx.fillStyle = '#8ff29a';
                ctx.fillText('ALL FIVE OWNED · FULL LOOK READY', rect.x + pad, rect.y + rect.h * 0.52);
            } else {
                const startY = rect.y + rect.h * 0.34;
                const lineH = Math.max(layout.smallFontPx * 1.25,
                    (rect.h * 0.60) / Math.max(1, missing.length));
                const lastSafeCenter = rect.y + rect.h - pad - layout.smallFontPx / 2;
                const maxRows = Math.max(1,
                    Math.floor((lastSafeCenter - startY) / lineH) + 1);
                const clipped = missing.length > maxRows;
                const itemRows = clipped ? Math.max(1, maxRows - 1) : missing.length;
                for (let mi = 0; mi < itemRows; mi++) {
                    const item = missing[mi];
                    const line = `${String(item.category).toUpperCase()} · ${item.name} — ${this._completionRouteLabel(item.routes)}`;
                    ctx.fillStyle = item.routes.includes('blueprint') ? '#ffd86b' : 'rgba(225,232,242,0.76)';
                    ctx.fillText(this._ellip(ctx, line, textW), rect.x + pad, startY + lineH * mi);
                }
                if (clipped) {
                    const remaining = missing.length - itemRows;
                    const summaryY = startY + lineH * itemRows;
                    ctx.fillStyle = '#ffd8b0';
                    ctx.fillText(this._ellip(ctx,
                        `+${remaining} MORE MISSING · OPEN SOURCES FOR ROUTE COUNTS`, textW),
                    rect.x + pad, summaryY);
                    textSafe = textSafe && summaryY <= lastSafeCenter + 0.001;
                } else if (missing.length) {
                    textSafe = textSafe
                        && startY + lineH * (missing.length - 1) <= lastSafeCenter + 0.001;
                }
            }
        }
        this._lastCollectionCompletionTextSafe = textSafe;
        const hasPrev = page > 1, hasNext = page < pageCount;
        this._button(ctx, layout.previousButton, '‹ PREV SETS', {
            enabled: hasPrev, action: hasPrev ? 'collectionCompletionPage' : null,
            arg: page - 1, fontSize: layout.buttonFontPx,
            accessibleLabel: `Previous Collection Completion set page, ${page - 1}`,
        });
        this._button(ctx, layout.nextButton, 'NEXT SETS ›', {
            enabled: hasNext, action: hasNext ? 'collectionCompletionPage' : null,
            arg: page + 1, fontSize: layout.buttonFontPx,
            accessibleLabel: `Next Collection Completion set page, ${page + 1}`,
        });
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(225,232,242,0.74)';
        ctx.font = `800 ${layout.bodyFontPx}px ${FONT}`;
        ctx.fillText(`ALL ${model.sets.length} SETS · PAGE ${page}/${pageCount}`,
            layout.pager.x + layout.pager.w / 2, layout.pager.y + layout.pager.h / 2);
    }

    _drawCompletionSources(ctx, model, layout) {
        const body = layout.body;
        const gap = layout.phone ? 8 : 12;
        const compact = layout.phone && body.h * layout.cssScale < 150;
        let textSafe = true;
        const disclosureH = compact
            ? Math.max(84, layout.smallFontPx * 3.2)
            : Math.max(58, layout.smallFontPx * 3.2);
        const grid = { x: body.x, y: body.y, w: body.w, h: body.h - disclosureH - gap };
        const cols = 3, rows = 2;
        const cardW = (grid.w - gap * (cols - 1)) / cols;
        const cardH = (grid.h - gap) / rows;
        for (let i = 0; i < model.sources.length; i++) {
            const row = model.sources[i];
            const rect = {
                x: grid.x + (i % cols) * (cardW + gap),
                y: grid.y + Math.floor(i / cols) * (cardH + gap),
                w: cardW, h: cardH,
            };
            const color = row.id === 'blueprint' ? '#ffd86b'
                : row.id === 'case' ? '#ff9a4a' : row.deterministic ? '#5fd36a' : '#8fd0ff';
            this._panel(ctx, rect.x, rect.y, rect.w, rect.h,
                'rgba(255,255,255,0.035)', `${color}55`);
            const rows = [];
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const cx = rect.x + rect.w / 2;
            if (compact) {
                const title = `${row.label.toUpperCase()} · ${row.total}`;
                const titleY = rect.y + rect.h * 0.31;
                ctx.fillStyle = color;
                const titleSize = this._fitFont(ctx, title, rect.w - 16, 800,
                    layout.bodyFontPx, FONT, Math.max(20, layout.bodyFontPx - 12));
                ctx.fillText(this._ellip(ctx, title, rect.w - 16), cx, titleY);
                rows.push({ y: titleY, size: titleSize });
                const meta = `${row.owned} OWNED · ${row.missing} MISSING`;
                const metaY = rect.y + rect.h * 0.73;
                ctx.fillStyle = 'rgba(225,232,242,0.74)';
                const metaSize = this._fitFont(ctx, meta, rect.w - 16, 700,
                    layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 10));
                ctx.fillText(this._ellip(ctx, meta, rect.w - 16), cx, metaY);
                rows.push({ y: metaY, size: metaSize });
            } else {
                const titleY = rect.y + rect.h * 0.22;
                ctx.fillStyle = color;
                const titleSize = this._fitFont(ctx, row.label.toUpperCase(), rect.w - 16,
                    800, layout.bodyFontPx, FONT, Math.max(20, layout.bodyFontPx - 10));
                ctx.fillText(this._ellip(ctx, row.label.toUpperCase(), rect.w - 16), cx, titleY);
                rows.push({ y: titleY, size: titleSize });
                const valueY = rect.y + rect.h * 0.54;
                ctx.fillStyle = '#fff';
                const valueSize = this._fitFont(ctx, String(row.total), rect.w - 16, 900,
                    layout.phone ? layout.titleFontPx * 1.2 : 34,
                    FONT, Math.max(24, layout.titleFontPx - 8));
                ctx.fillText(String(row.total), cx, valueY);
                rows.push({ y: valueY, size: valueSize });
                const meta = `${row.owned} owned · ${row.missing} missing`;
                const metaY = rect.y + rect.h * 0.80;
                ctx.fillStyle = 'rgba(225,232,242,0.68)';
                const metaSize = this._fitFont(ctx, meta, rect.w - 16, 700,
                    layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 8));
                ctx.fillText(this._ellip(ctx, meta, rect.w - 16), cx, metaY);
                rows.push({ y: metaY, size: metaSize });
            }
            textSafe = textSafe && this._completionTextLaneSafe(rect, rows);
        }
        const disclosure = {
            x: body.x, y: body.y + body.h - disclosureH,
            w: body.w, h: disclosureH,
        };
        const disclosureRows = [];
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const routeText = `${model.deterministic.total} WITH A KNOWN ROUTE · ${model.caseOnly.total} RANDOM-ONLY · ${model.caseOnly.mythicTotal} RANDOM-ONLY MYTHICS`;
        const routeY = disclosure.y + disclosure.h * 0.30;
        ctx.fillStyle = '#ffd8b0';
        const routeSize = this._fitFont(ctx, routeText, disclosure.w - 16, 800,
            layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 10));
        ctx.fillText(this._ellip(ctx, routeText, disclosure.w - 16),
            disclosure.x + disclosure.w / 2, routeY);
        disclosureRows.push({ y: routeY, size: routeSize });
        ctx.fillStyle = 'rgba(225,232,242,0.72)';
        const overlapText = `ROUTE COUNTS OVERLAP; THEY DO NOT ADD TO ${model.total}.`;
        const overlapY = disclosure.y + disclosure.h * 0.74;
        const overlapSize = this._fitFont(ctx, overlapText, disclosure.w - 16, 800,
            layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 10));
        ctx.fillText(this._ellip(ctx, overlapText, disclosure.w - 16),
            disclosure.x + disclosure.w / 2, overlapY);
        disclosureRows.push({ y: overlapY, size: overlapSize });
        textSafe = textSafe && this._completionTextLaneSafe(disclosure, disclosureRows);
        this._lastCollectionCompletionTextSafe = this._lastCollectionCompletionTextSafe
            && textSafe;
    }

    _drawCompletionBlueprint(ctx, state, model, layout) {
        const save = state.saveData;
        const selected = model.selectedBlueprint || model.blueprints[0];
        let selectorTextSafe = true;
        for (let i = 0; i < model.blueprints.length; i++) {
            const entry = model.blueprints[i], rect = layout.blueprintSelectors[i];
            const active = entry.id === selected?.id;
            this._panel(ctx, rect.x, rect.y, rect.w, rect.h,
                active ? 'rgba(82,57,24,0.54)' : 'rgba(255,255,255,0.035)',
                active ? 'rgba(255,216,107,0.82)' : 'rgba(255,255,255,0.12)');
            const swatch = Math.max(54, Math.min(rect.h - 22, rect.w * 0.24));
            const item = COSMETICS[entry.id];
            this._cosmeticSwatch(ctx, item.category, item,
                rect.x + 12, rect.y + (rect.h - swatch) / 2, swatch);
            const tx = rect.x + swatch + 24;
            const textW = rect.x + rect.w - 12 - tx;
            const rows = [];
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillStyle = active ? '#ffd86b' : '#fff';
            const nameY = rect.y + rect.h * 0.27;
            const nameSize = this._fitFont(ctx, entry.name, textW, 800,
                layout.bodyFontPx, FONT, Math.max(20, layout.bodyFontPx - 14));
            ctx.fillText(this._ellip(ctx, entry.name, textW), tx, nameY);
            rows.push({ y: nameY, size: nameSize });
            ctx.fillStyle = rarityColor(entry.rarity);
            const quote = layout.compactBlueprint
                ? 'MYTHIC · 72K' : 'MYTHIC · GUARANTEED 72,000';
            const quoteY = rect.y + rect.h * 0.53;
            const quoteSize = this._fitFont(ctx, quote, textW, 800,
                layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 12));
            ctx.fillText(this._ellip(ctx, quote, textW), tx, quoteY);
            rows.push({ y: quoteY, size: quoteSize });
            ctx.fillStyle = entry.owned ? '#8ff29a' : 'rgba(225,232,242,0.68)';
            const status = entry.owned ? 'OWNED'
                : layout.compactBlueprint ? 'FORGE OR CASE' : 'BLUEPRINT OR RANDOM CASE';
            const statusY = rect.y + rect.h * 0.78;
            const statusSize = this._fitFont(ctx, status, textW, 700,
                layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 12));
            ctx.fillText(this._ellip(ctx, status, textW), tx, statusY);
            rows.push({ y: statusY, size: statusSize });
            selectorTextSafe = selectorTextSafe && textW > 0
                && this._completionTextLaneSafe(rect, rows);
            if (!active) this._hot(rect.x, rect.y, rect.w, rect.h,
                'collectionCompletionBlueprint', entry.id,
                `Show ${entry.name} Mythic Blueprint details`);
        }
        if (!selected) return;
        const rect = layout.blueprintDetail;
        this._panel(ctx, rect.x, rect.y, rect.w, rect.h,
            'rgba(32,25,16,0.88)', 'rgba(255,216,107,0.34)');
        const target = selected.royalCase;
        const set = model.sets.find((candidate) => candidate.pieces
            .some((piece) => piece.id === selected.id)) || null;
        // UIStateBuilder has already monotonic-clock validated this snapshot;
        // the renderer must not reintroduce adjustable wall-time authority.
        const pending = state.blueprintConfirm?.id === selected.id;
        const saving = state.blueprintPurchasePending?.id === selected.id;
        const receipt = state.blueprintReceipt?.id === selected.id
            ? state.blueprintReceipt : null;
        const balanceAfter = Math.max(0, (save.totalCoins || 0) - selected.cost);
        const shortfall = Math.max(0, selected.cost - (save.totalCoins || 0));
        const walletLine = selected.owned ? 'OWNED · NO CHARGE'
            : shortfall ? `WALLET ${(save.totalCoins || 0).toLocaleString()} · NEED ${shortfall.toLocaleString()} MORE`
                : `WALLET AFTER ${balanceAfter.toLocaleString()} COINS`;
        const chance = target.target?.nextNamedProbability || 0;
        const chanceKind = target.pity?.forcedNext ? 'FORCED RARE+ NEXT' : 'ORDINARY NEXT OPEN';
        const setDelta = receipt?.ok && receipt.setId
            ? ` · ${receipt.setName || receipt.setId} ${receipt.setBefore}/5→${receipt.setAfter}/5` : '';
        let receiptLine = walletLine;
        if (receipt?.ok) {
            receiptLine = `FORGED · -${receipt.cost.toLocaleString()} · WALLET ${receipt.balanceBefore.toLocaleString()}→${receipt.balanceAfter.toLocaleString()} · COLLECTION ${receipt.collectionBefore}→${receipt.collectionAfter}${setDelta}`;
        } else if (receipt?.reason === 'external-save-changed') {
            receiptLine = 'SAVE CHANGED ELSEWHERE · NOT CHARGED · RELOAD TO CONTINUE';
        } else if (receipt?.reason === 'persistence-unavailable') {
            receiptLine = 'SAVE STORAGE UNAVAILABLE · NOT CHARGED · RESTORE ACCESS AND RETRY';
        } else if (receipt?.reason === 'persistence-failed') {
            receiptLine = 'SAVE FAILED · NOT CHARGED · CHECK STORAGE AND RETRY';
        } else if (receipt?.reason === 'transaction-busy') {
            receiptLine = 'ANOTHER TAB IS SAVING · NOT CHARGED · TRY AGAIN';
        } else if (receipt?.reason === 'transaction-lock-unavailable') {
            receiptLine = 'SAFE SAVE LOCK UNAVAILABLE · NOT CHARGED · UPDATE BROWSER';
        } else if (receipt?.reason === 'transaction-lock-failed') {
            receiptLine = 'SAFE SAVE LOCK FAILED · NOT CHARGED · TRY AGAIN';
        } else if (receipt && !receipt.ok && receipt.reason !== 'insufficient-coins') {
            receiptLine = receipt.reason === 'already-owned' || receipt.reason === 'replay'
                ? 'ALREADY OWNED · NO CHARGE'
                : 'PURCHASE NOT COMPLETED · CHECK SAVE AND TRY AGAIN';
        }
        const copy = layout.blueprintCopy || {
            x: rect.x, y: rect.y, w: rect.w,
            h: Math.max(1, layout.caseTruthButton.y - (layout.gap || 8) - rect.y),
        };
        const pad = 18, textX = copy.x + pad, textW = copy.w - pad * 2;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        if (layout.compactBlueprint) {
            const compactLines = [
                `GUARANTEED · KNOWN PRICE · ${selected.name.toUpperCase()}`,
                `${set?.name || 'MYTHIC'} ${set ? `${set.owned}/${set.total}` : ''} · 72,000 = 80 ROYAL COSMETIC CASE ENTRY FEES`,
                receipt
                    ? receiptLine
                    : `${walletLine} · MYTHIC 1.5% · ITEM BRANCH ${(CASE_ITEM_REWARD_CHANCE * 100).toFixed(0)}%`,
                'RARE+ PITY IS NOT A MYTHIC GUARANTEE · CASES STAY RANDOM WITH SIDE ITEMS',
            ];
            const compactColors = ['#ffd86b', set?.color || '#c08bff',
                receipt?.ok ? '#8ff29a' : receipt && !receipt.ok ? '#ffb0a0'
                    : shortfall ? '#ffb0a0' : '#fff', '#ffb0a0'];
            for (let index = 0; index < compactLines.length; index++) {
                const y = copy.y + copy.h * ((index + 0.5) / compactLines.length);
                ctx.fillStyle = compactColors[index];
                this._fitFont(ctx, compactLines[index], textW, index === 0 ? 800 : 700,
                    layout.smallFontPx, FONT, Math.max(28, layout.smallFontPx - 8));
                ctx.fillText(this._ellip(ctx, compactLines[index], textW), textX, y);
            }
            this._lastCollectionCompletionTextSafe = selectorTextSafe
                && copy.y + copy.h
                    <= layout.caseTruthButton.y - (layout.gap || 8) + 0.001;
        } else {
            const rowY = (index) => copy.y + layout.smallFontPx / 2 + 4
                + index * Math.max(1,
                    (copy.h - layout.smallFontPx - 8) / 8);
            ctx.fillStyle = '#ffd86b'; ctx.font = `800 ${layout.smallFontPx}px ${FONT}`;
            ctx.fillText('GUARANTEED · KNOWN PRICE · EARNED COINS', textX, rowY(0));
            ctx.fillStyle = '#fff';
            ctx.font = `900 ${layout.phone ? layout.titleFontPx : 30}px ${FONT}`;
            ctx.fillText(this._ellip(ctx, selected.name, textW), textX, rowY(1));
            ctx.fillStyle = set?.color || '#c08bff'; ctx.font = `800 ${layout.bodyFontPx}px ${FONT}`;
            ctx.fillText(set ? `${set.name} · ${set.owned}/${set.total} OWNED` : 'MYTHIC COLLECTION ITEM',
                textX, rowY(2));
            ctx.fillStyle = '#ffd86b';
            ctx.fillText('72,000 COINS · EQUALS 80 ROYAL COSMETIC CASE ENTRY FEES',
                textX, rowY(3));
            ctx.fillStyle = receipt?.ok ? '#8ff29a'
                : receipt && !receipt.ok ? '#ffb0a0'
                    : selected.owned ? '#8ff29a' : shortfall ? '#ffb0a0' : '#fff';
            ctx.font = `800 ${layout.bodyFontPx}px ${FONT}`;
            ctx.fillText(this._ellip(ctx, receiptLine, textW), textX, rowY(4));
            ctx.fillStyle = 'rgba(225,232,242,0.76)';
            ctx.font = `700 ${layout.smallFontPx}px ${FONT}`;
            ctx.fillText(`ALSO IN ROYAL CASES · MYTHIC 1.5% · ITEM BRANCH ${(CASE_ITEM_REWARD_CHANCE * 100).toFixed(0)}%`,
                textX, rowY(5));
            ctx.fillText(`${chanceKind} TARGET CHANCE ${(chance * 100).toFixed(chance * 100 < 1 ? 4 : 2)}% · SELECTION POOL ${target.target?.selectionPoolSize || 0}`,
                textX, rowY(6));
            ctx.fillStyle = '#ffb0a0';
            ctx.fillText('RARE+ PITY IS NOT A MYTHIC GUARANTEE.', textX, rowY(7));
            ctx.fillStyle = 'rgba(225,232,242,0.66)';
            ctx.fillText('Known-price certainty; cases also award side items, coins and Vigil XP.',
                textX, rowY(8));
            this._lastCollectionCompletionTextSafe = selectorTextSafe
                && rowY(8) + layout.smallFontPx / 2
                    <= layout.caseTruthButton.y - (layout.gap || 8) + 0.001;
        }

        this._button(ctx, layout.caseTruthButton, pending ? 'CANCEL CONFIRM' : 'ROYAL CASE TRUTH', {
            action: pending ? 'cancelCollectionBlueprint' : 'collectionCompletionSection',
            arg: pending ? selected.id : 'case',
            accent: pending ? 'rgba(105,48,48,0.95)' : 'rgba(82,58,28,0.95)',
            fontSize: layout.buttonFontPx,
            accessibleLabel: pending ? `Cancel ${selected.name} Blueprint confirmation`
                : 'Open Royal Cosmetic Case truth',
        });
        let purchaseLabel = `FORGE BLUEPRINT · ${selected.cost.toLocaleString()} COINS`;
        let enabled = !saving && !selected.owned && selected.affordable;
        if (saving) purchaseLabel = 'SECURING SAVE ACROSS TABS…';
        else if (selected.owned) purchaseLabel = 'OWNED · EQUIP FROM COLLECTION';
        else if (!selected.affordable) purchaseLabel = `NEED ${shortfall.toLocaleString()} MORE COINS`;
        else if (pending) purchaseLabel = `CONFIRM -${selected.cost.toLocaleString()} · ${state.blueprintConfirm.seconds || 3}S`;
        this._button(ctx, layout.purchaseButton, purchaseLabel, {
            enabled,
            action: enabled ? 'purchaseCollectionBlueprint' : null,
            arg: selected.id,
            primary: pending,
            accent: pending ? '#2e6b3f' : 'rgba(92,60,25,0.96)',
            fontSize: layout.buttonFontPx,
            accessibleLabel: saving ? `Securing ${selected.name} Blueprint purchase across game tabs`
                : pending
                ? `Confirm ${selected.name} Blueprint for ${selected.cost} coins`
                : `Forge ${selected.name} Blueprint for ${selected.cost} coins`,
        });
    }

    _drawCompletionCase(ctx, state, model, layout) {
        const selected = model.selectedBlueprint || model.blueprints[0];
        const truth = selected?.royalCase || caseTargetSnapshot({
            caseType: 'royalCosmetic', targetId: selected?.id,
            ownedIds: state.saveData.cosmetics.unlocked,
            pityCount: state.saveData.casePity?.royalCosmetic || 0,
        });
        this._lastCollectionCompletionCaseTruth = truth;
        const body = layout.body, gap = layout.phone ? 8 : 12;
        const compact = layout.phone && body.h * layout.cssScale < 150;
        let textSafe = true;
        const topH = compact
            ? Math.max(88, layout.smallFontPx * 2.45)
            : Math.max(80, body.h * 0.25);
        const topCards = segmentedRects({ x: body.x, y: body.y, w: body.w, h: topH }, 4, gap);
        const top = [
            ['ENTRY FEE', `${truth.cost.toLocaleString()} COINS`, '#ffd86b'],
            ['ROYAL POOL', `${truth.poolTotal} ITEMS`, '#c08bff'],
            ['ITEM BRANCH', `${(truth.branches.item * 100).toFixed(0)}%`, '#5fd36a'],
            ['RARE+ PITY', `${truth.pity.remaining} OPEN${truth.pity.remaining === 1 ? '' : 'S'}`, '#ff9a4a'],
        ];
        for (let i = 0; i < topCards.length; i++) {
            const rect = topCards[i], data = top[i];
            this._panel(ctx, rect.x, rect.y, rect.w, rect.h,
                'rgba(255,255,255,0.035)', `${data[2]}55`);
            const rows = [];
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const cx = rect.x + rect.w / 2;
            const labelY = rect.y + rect.h * (compact ? 0.24 : 0.31);
            ctx.fillStyle = data[2];
            const labelSize = this._fitFont(ctx, data[0], rect.w - 14, 800,
                layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 10));
            ctx.fillText(this._ellip(ctx, data[0], rect.w - 14), cx, labelY);
            rows.push({ y: labelY, size: labelSize });
            const valueY = rect.y + rect.h * (compact ? 0.73 : 0.67);
            ctx.fillStyle = '#fff';
            const valueSize = this._fitFont(ctx, data[1], rect.w - 14, 900,
                layout.bodyFontPx, FONT, Math.max(22, layout.bodyFontPx - 12));
            ctx.fillText(this._ellip(ctx, data[1], rect.w - 14), cx, valueY);
            rows.push({ y: valueY, size: valueSize });
            textSafe = textSafe && this._completionTextLaneSafe(rect, rows);
        }
        const rarityY = body.y + topH + gap;
        const disclosureH = compact
            ? Math.max(128, layout.smallFontPx * 4)
            : Math.max(76, layout.smallFontPx * 5);
        const rarityH = Math.max(1, body.y + body.h - disclosureH - gap - rarityY);
        const rarityCards = segmentedRects({ x: body.x, y: rarityY, w: body.w, h: rarityH },
            Math.max(1, truth.rarities.length), gap);
        for (let i = 0; i < truth.rarities.length; i++) {
            const row = truth.rarities[i], rect = rarityCards[i];
            this._panel(ctx, rect.x, rect.y, rect.w, rect.h,
                'rgba(255,255,255,0.03)', `${rarityColor(row.id)}66`);
            const rows = [];
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const cx = rect.x + rect.w / 2;
            const rarityLabel = `${rarityName(row.id).toUpperCase()} ${(row.odds * 100).toFixed(row.odds * 100 % 1 ? 1 : 0)}%`;
            const rarityLabelY = rect.y + rect.h * (compact ? 0.28 : 0.20);
            ctx.fillStyle = rarityColor(row.id);
            const rarityLabelSize = this._fitFont(ctx, rarityLabel, rect.w - 12, 800,
                layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 12));
            ctx.fillText(this._ellip(ctx, rarityLabel, rect.w - 12), cx, rarityLabelY);
            rows.push({ y: rarityLabelY, size: rarityLabelSize });
            if (compact) {
                const summary = `${row.total} TOTAL · ${row.unowned} LEFT`;
                const summaryY = rect.y + rect.h * 0.72;
                ctx.fillStyle = 'rgba(235,241,249,0.84)';
                const summarySize = this._fitFont(ctx, summary, rect.w - 12, 800,
                    layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 12));
                ctx.fillText(this._ellip(ctx, summary, rect.w - 12), cx, summaryY);
                rows.push({ y: summaryY, size: summarySize });
            } else {
                const totalY = rect.y + rect.h * 0.47;
                ctx.fillStyle = '#fff';
                const totalSize = this._fitFont(ctx, `${row.total} TOTAL`, rect.w - 12,
                    900, layout.bodyFontPx, FONT, Math.max(22, layout.bodyFontPx - 12));
                ctx.fillText(`${row.total} TOTAL`, cx, totalY);
                rows.push({ y: totalY, size: totalSize });
                const ownedText = `${row.owned} owned · ${row.unowned} unowned`;
                const ownedY = rect.y + rect.h * 0.72;
                ctx.fillStyle = 'rgba(225,232,242,0.70)';
                const ownedSize = this._fitFont(ctx, ownedText, rect.w - 12, 700,
                    layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 10));
                ctx.fillText(this._ellip(ctx, ownedText, rect.w - 12), cx, ownedY);
                rows.push({ y: ownedY, size: ownedSize });
            }
            if (truth.pity.forcedNext && !compact) {
                ctx.fillStyle = '#ffd86b';
                const forcedText = `forced weight ${(row.forcedOdds * 100).toFixed(2)}%`;
                const forcedY = rect.y + rect.h * 0.90;
                const forcedSize = this._fitFont(ctx, forcedText, rect.w - 12, 700,
                    layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 10));
                ctx.fillText(this._ellip(ctx, forcedText, rect.w - 12), cx, forcedY);
                rows.push({ y: forcedY, size: forcedSize });
            }
            textSafe = textSafe && this._completionTextLaneSafe(rect, rows);
        }
        const targetChance = truth.target?.nextNamedProbability || 0;
        const targetLabel = truth.pity.forcedNext ? 'FORCED RARE+ NEXT' : 'ORDINARY NEXT OPEN';
        const disclosure = {
            x: body.x, y: body.y + body.h - disclosureH,
            w: body.w, h: disclosureH,
        };
        const disclosureRows = [];
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const branchText = compact
            ? `BRANCHES · ITEM 82% · COINS ${(truth.branches.coin * 100).toFixed(1)}% · VIGIL XP ${(truth.branches.battlePassXp * 100).toFixed(1)}%`
            : `BRANCHES · ITEM 82% · COINS ${(truth.branches.coin * 100).toFixed(1)}% · VIGIL XP ${(truth.branches.battlePassXp * 100).toFixed(1)}% · UNOWNED FIRST WITHIN RARITY`;
        const branchY = disclosure.y + disclosure.h * 0.17;
        ctx.fillStyle = '#ffd8b0';
        const branchSize = this._fitFont(ctx, branchText, disclosure.w - 16, 800,
            layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 12));
        ctx.fillText(this._ellip(ctx, branchText, disclosure.w - 16),
            disclosure.x + disclosure.w / 2, branchY);
        disclosureRows.push({ y: branchY, size: branchSize });
        ctx.fillStyle = '#ffb0a0';
        const targetText = `TARGET ${selected?.name || 'NONE'} · ${targetLabel} ${(targetChance * 100).toFixed(targetChance * 100 < 1 ? 4 : 2)}% · RARE+ PITY IS NOT A MYTHIC GUARANTEE`;
        const targetY = disclosure.y + disclosure.h * 0.50;
        const targetSize = this._fitFont(ctx, targetText, disclosure.w - 16, 800,
            layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 12));
        ctx.fillText(this._ellip(ctx, targetText, disclosure.w - 16),
            disclosure.x + disclosure.w / 2, targetY);
        disclosureRows.push({ y: targetY, size: targetSize });
        ctx.fillStyle = 'rgba(225,232,242,0.68)';
        const duplicateText = compact
            ? 'UNOWNED FIRST · DUPLICATES BECOME COIN DUST AFTER THAT RARITY IS COLLECTED'
            : 'Duplicates convert to rarity coin dust only after that rolled rarity is collected.';
        const duplicateY = disclosure.y + disclosure.h * 0.83;
        const duplicateSize = this._fitFont(ctx, duplicateText, disclosure.w - 16, 700,
            layout.smallFontPx, FONT, Math.max(20, layout.smallFontPx - 12));
        ctx.fillText(this._ellip(ctx, duplicateText, disclosure.w - 16),
            disclosure.x + disclosure.w / 2, duplicateY);
        disclosureRows.push({ y: duplicateY, size: duplicateSize });
        textSafe = textSafe && this._completionTextLaneSafe(disclosure, disclosureRows);
        this._lastCollectionCompletionTextSafe = this._lastCollectionCompletionTextSafe
            && textSafe;
    }

    _drawCollectionCompletion(ctx, state, content, options = {}) {
        const section = state.collectionCompletion?.section || 'overview';
        const layout = computePhoneCollectionCompletionLayout(content, {
            cssScale: options.cssScale,
            phone: options.phone === true,
            section,
        });
        const model = buildCosmeticCompletionSnapshot({
            ownedIds: state.saveData.cosmetics.unlocked,
            blueprintClaims: state.saveData.cosmetics.blueprintClaims,
            pursuitSetId: state.saveData.cosmetics.pursuitSetId,
            selectedBlueprintId: state.collectionCompletion?.blueprintId,
            coinBalance: state.saveData.totalCoins,
            royalCosmeticPityCount: state.saveData.casePity?.royalCosmetic || 0,
        });
        this._lastCollectionCompletionRendered = true;
        this._lastCollectionCompletionSection = section;
        this._lastCollectionCompletionModel = model;
        this._lastCollectionCompletionTextSafe = true;
        this._lastCollectionCompletionCaseTruth = null;
        this._panel(ctx, content.x, content.y, content.w, content.h,
            'rgba(12,18,25,0.92)', 'rgba(95,211,106,0.30)');
        if (options.phone === true && !layout.touchSafe) {
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = '#ffd6d6'; ctx.font = `800 ${layout.titleFontPx}px ${FONT}`;
            ctx.fillText('Rotate or enlarge the window to open Collection Completion.',
                content.x + content.w / 2, content.y + content.h / 2);
            return;
        }
        const startHotspot = this.hotspots.length;
        this._button(ctx, layout.backButton, 'BACK', {
            action: 'collectionCompletionBack',
            accent: 'rgba(34,66,56,0.96)', fontSize: layout.buttonFontPx,
            accessibleLabel: section === 'overview'
                ? 'Back to Character Collection' : 'Back within Collection Completion',
        });
        const completeSets = model.sets.filter((set) => set.complete).length;
        const titleLeft = layout.backButton.x + layout.backButton.w + 20;
        const titleW = Math.max(80, layout.header.x + layout.header.w - titleLeft - 10);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#bff5c4';
        this._fitFont(ctx,
            `COLLECTION COMPLETION · ${model.owned}/${model.total} · SETS ${completeSets}/${model.sets.length}`,
            titleW, 900, layout.titleFontPx, FONT, options.phone ? 24 : 12);
        ctx.fillText(`COLLECTION COMPLETION · ${model.owned}/${model.total} · SETS ${completeSets}/${model.sets.length}`,
            titleLeft + titleW / 2, layout.header.y + layout.header.h / 2);
        const tabs = [
            { id: 'overview', label: 'OVERVIEW' },
            { id: 'sets', label: 'SETS' },
            { id: 'sources', label: 'SOURCES' },
            { id: 'blueprint', label: 'BLUEPRINTS' },
            { id: 'case', label: 'CASE TRUTH' },
        ];
        this._segmentedRow(ctx, tabs, section,
            layout.tabs.x, layout.tabs.y, layout.tabs.w, layout.tabs.h,
            'collectionCompletionSection', '#5fd36a', {
                gap: options.phone ? 8 : 12,
                radius: options.phone ? 12 : 9,
                fontSize: layout.buttonFontPx,
                fit: true,
                fontFloor: options.phone ? 22 : 10,
            });

        if (!model.valid) {
            ctx.fillStyle = '#ffd6d6'; ctx.font = `800 ${layout.bodyFontPx}px ${FONT}`;
            ctx.fillText('Collection Completion is unavailable. Catalog truth failed closed.',
                layout.body.x + layout.body.w / 2, layout.body.y + layout.body.h / 2);
        } else if (section === 'sets') this._drawCompletionSets(ctx, state, model, layout);
        else if (section === 'sources') this._drawCompletionSources(ctx, model, layout);
        else if (section === 'blueprint') this._drawCompletionBlueprint(ctx, state, model, layout);
        else if (section === 'case') this._drawCompletionCase(ctx, state, model, layout);
        else this._drawCompletionOverview(ctx, model, layout);

        const completionHotspots = this.hotspots.slice(startHotspot);
        const actualMin = completionHotspots.length
            ? Math.min(...completionHotspots.map((hotspot) =>
                Math.min(hotspot.w, hotspot.h) * layout.cssScale)) : 0;
        const contained = completionHotspots.every((hotspot) =>
            hotspot.x >= content.x && hotspot.y >= content.y
            && hotspot.x + hotspot.w <= content.x + content.w + 0.001
            && hotspot.y + hotspot.h <= content.y + content.h + 0.001);
        const nonOverlapping = completionHotspots.every((hotspot, index) => completionHotspots
            .slice(index + 1).every((other) => hotspot.x + hotspot.w <= other.x + 0.001
                || other.x + other.w <= hotspot.x + 0.001
                || hotspot.y + hotspot.h <= other.y + 0.001
                || other.y + other.h <= hotspot.y + 0.001));
        this._lastCollectionCompletionMinTouchCss = Math.round(actualMin * 10) / 10;
        this._lastCollectionCompletionTouchSafe = options.phone !== true
            || (actualMin >= 44 && contained && nonOverlapping);
        if (options.phone === true) {
            this._lastCharacterPhonePane = 'completion';
            this._lastCharacterPhonePaneTouchSafe = this._lastCollectionCompletionTouchSafe;
            this._lastCharacterPhonePaneMinTouchCss = this._lastCollectionCompletionMinTouchCss;
        }
    }

    _drawPhoneCharacter(ctx, state, c) {
        const save = state.saveData;
        const cssScale = (this.renderer.cssWidth || INTERNAL_WIDTH) / INTERNAL_WIDTH;
        if (state.collectionCompletion?.open === true) {
            this._drawCollectionCompletion(ctx, state, c, { phone: true, cssScale });
            return;
        }
        const pane = state.characterPhonePane === 'rites' ? 'rites' : 'collection';
        this._lastCharacterPhonePane = pane;
        if (pane === 'rites') {
            this._drawPhoneHeroRites(ctx, state, c, cssScale);
            return;
        }
        const richLayout = computePhoneCharacterCollectionLayout(c, { cssScale });
        const compact = (this.renderer.cssWidth || INTERNAL_WIDTH) <= 600
            || !richLayout.touchSafe;
        const layout = compact
            ? computePhoneCharacterCollectionLayout(c, { cssScale, compact: true })
            : richLayout;
        this._lastCollectionRuntime = {
            cssWidth: this.renderer.cssWidth || 0,
            cssHeight: this.renderer.cssHeight || 0,
            dpr: this.renderer.dpr || 0,
            content: { x: c.x, y: c.y, w: c.w, h: c.h },
            touchH: layout.touchH,
            layoutMinTouchCss: layout.minTouchCss,
            variant: layout.variant,
        };
        this._lastCharacterPhonePaneTouchSafe = layout.touchSafe === true
            && this._lastCollectionNavTouchSafe === true;
        this._lastCharacterPhonePaneMinTouchCss = Math.min(
            layout.minTouchCss || 0,
            this._lastCollectionNavMinTouchCss || 0,
        );
        // A failed geometry receipt must never become live UI. Required phone
        // sizes all have a safe rich or compact branch; this is fail-closed for
        // unknown tiny canvases rather than painting clipped hotspots.
        if (!layout.touchSafe) {
            this._panel(ctx, c.x, c.y, c.w, c.h,
                'rgba(20,16,28,0.88)', 'rgba(255,122,122,0.42)');
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = '#ffd6d6';
            ctx.font = `800 ${Math.max(32, Math.ceil(14 / cssScale))}px ${FONT}`;
            ctx.fillText('Rotate or enlarge the window to open Character.',
                c.x + c.w / 2, c.y + c.h / 2);
            return;
        }
        if (layout.compact) {
            this._drawCosmeticCollection(ctx, state, layout.collection, layout);
            return;
        }
        const p = layout.preview;
        this._panel(ctx, p.x, p.y, p.w, p.h,
            'rgba(20,16,28,0.88)', 'rgba(192,139,255,0.28)');
        const ch = getCharacter(save.selectedCharacter);
        const ap = resolveAppearance(save.cosmetics.equipped);
        const avatarAp = { ...ap, furColor: ap.furColor || ch.palette.fur };
        let avatarPose = null;
        const avatarState = (this._t % 4.0) > 3.4 ? 'cast' : 'idle';
        try {
            const frames = getHeroFrames(ch.id, ch, ap,
                !!ap.hatShape && ap.hatShape !== 'none');
            avatarPose = resolveHeroPose(frames, 'down', avatarState, 0);
        } catch (e) { avatarPose = null; }
        const heldProp = resolveWeaponProp(resolveStartingWeapon(save));
        const a = layout.avatar;
        ctx.save();
        ctx.translate(a.x, a.y + a.r * 0.92); ctx.scale(1, 0.3);
        ctx.fillStyle = 'rgba(192,139,255,0.14)';
        ctx.beginPath(); ctx.arc(0, 0, a.r * 0.92, 0, TAU); ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();
        this._drawAvatar(ctx, a.x, a.y, a.r, avatarAp, avatarPose, null, this._t,
            heldProp, resolveCharacterHold(ch.id), ch.palette && ch.palette.face);
        ctx.restore();

        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#fff';
        this._fitFont(ctx, ch.name, p.w - 24, 800, layout.previewNameFontPx, FONT, 26);
        ctx.fillText(ch.name, a.x, layout.nameY);
        const lookLabel = ap.set ? `${ap.set.name} · SET COMPLETE` : 'LIVE EQUIPPED LOOK';
        ctx.fillStyle = ap.set?.color || 'rgba(192,139,255,0.95)';
        this._fitFont(ctx, lookLabel, p.w - 24, 800, layout.previewMetaFontPx, FONT, 22);
        ctx.fillText(lookLabel, a.x, layout.metaY);

        for (let i = 0; i < COSMETIC_CATEGORIES.length; i++) {
            const category = COSMETIC_CATEGORIES[i];
            const rect = layout.previewSlots[i];
            const item = COSMETICS[save.cosmetics.equipped[category]] || { name: 'None' };
            roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 9);
            ctx.fillStyle = 'rgba(255,255,255,0.045)'; ctx.fill();
            ctx.strokeStyle = 'rgba(192,139,255,0.20)'; ctx.lineWidth = 1.5; ctx.stroke();
            const swatchRect = layout.previewSwatches[i];
            if (swatchRect.w >= 12) {
                this._cosmeticSwatch(ctx, category, item,
                    swatchRect.x, swatchRect.y, swatchRect.w);
            }
            const tx = swatchRect.w >= 12
                ? swatchRect.x + swatchRect.w + 9 : rect.x + 8;
            const textW = Math.max(40, rect.x + rect.w - 8 - tx);
            const slotLabel = `${COSMETIC_CATEGORY_LABELS[category].toUpperCase()} · ${item.name || 'None'}`;
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillStyle = '#fff';
            this._fitFont(ctx, slotLabel, textW, 700,
                layout.previewSlotFontPx, FONT, 22);
            ctx.fillText(this._ellip(ctx, slotLabel, textW), tx,
                rect.y + rect.h / 2);
        }
        this._button(ctx, layout.completionButton, 'COMPLETION', {
            action: 'openCollectionCompletion', primary: false,
            accent: 'rgba(36,86,70,0.96)',
            fontSize: layout.buttonFontPx,
            accessibleLabel: 'Open Collection Completion overview',
        });
        this._button(ctx, layout.attuneButton, 'HERO RITES', {
            action: 'characterPhonePane', arg: 'rites', primary: false, accent: 'rgba(88,48,118,0.95)',
            fontSize: layout.buttonFontPx,
            accessibleLabel: 'Open Rites and Hero Attunement',
        });
        this._drawCosmeticCollection(ctx, state, layout.collection, layout);
    }

    // ── CHARACTER — a live customizer: the model on the LEFT updates the
    // instant you click an item; the cosmetic pickers sit on the RIGHT, on the
    // SAME page (no drilling into a separate preview screen). ────────────────
    _drawPhoneHeroRites(ctx, state, c, cssScale) {
        const save = state.saveData;
        const layout = computePhoneHeroRitesLayout(c, { cssScale });
        this._lastCharacterPhonePaneTouchSafe = layout.touchSafe === true
            && this._lastCollectionNavTouchSafe === true;
        this._lastCharacterPhonePaneMinTouchCss = Math.min(
            layout.minTouchCss || 0,
            this._lastCollectionNavMinTouchCss || 0,
        );
        this._lastCollectionRuntime = {
            cssWidth: this.renderer.cssWidth || 0,
            cssHeight: this.renderer.cssHeight || 0,
            dpr: this.renderer.dpr || 0,
            content: { x: c.x, y: c.y, w: c.w, h: c.h },
            touchH: layout.touchH,
            layoutMinTouchCss: layout.minTouchCss,
            variant: 'hero-rites',
        };
        if (!layout.touchSafe) {
            this._panel(ctx, c.x, c.y, c.w, c.h,
                'rgba(24,16,12,0.9)', 'rgba(255,122,122,0.42)');
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = '#ffd6d6';
            ctx.font = `800 ${layout.titleFontPx}px ${FONT}`;
            ctx.fillText('Rotate or enlarge the window to open Hero Rites.',
                c.x + c.w / 2, c.y + c.h / 2);
            return;
        }

        this._panel(ctx, c.x, c.y, c.w, c.h,
            'rgba(24,16,12,0.88)', 'rgba(255,154,74,0.30)');
        this._button(ctx, layout.backButton, 'BACK', {
            action: 'characterPhonePane', arg: 'collection',
            accent: 'rgba(74,48,42,0.96)', fontSize: layout.buttonFontPx,
            accessibleLabel: 'Back to Character Collection',
        });

        const heroId = save.selectedCharacter;
        const hero = getCharacter(heroId);
        const rites = ritesFor(heroId).slice(0, 3);
        const done = ritesCompletedCount(save, heroId);
        const titleLeft = layout.backButton.x + layout.backButton.w + 24;
        const titleW = Math.max(80, layout.header.x + layout.header.w - titleLeft - 12);
        const title = `${hero.name.toUpperCase()} HERO RITES  |  ${done}/3 COMPLETE`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffd8b0';
        this._fitFont(ctx, title, titleW, 800, layout.titleFontPx, FONT, 26);
        ctx.fillText(title, titleLeft + titleW / 2,
            layout.header.y + layout.header.h / 2);

        for (let index = 0; index < layout.riteCards.length; index++) {
            const card = layout.riteCards[index];
            const rite = rites[index];
            if (!rite) continue;
            const progress = riteProgress(save, heroId, rite.id);
            const complete = progress >= rite.goal;
            const fraction = rite.goal > 0
                ? Math.max(0, Math.min(1, progress / rite.goal)) : 0;
            this._panel(ctx, card.x, card.y, card.w, card.h,
                complete ? 'rgba(28,62,37,0.72)' : 'rgba(255,255,255,0.035)',
                complete ? 'rgba(95,211,106,0.62)' : 'rgba(255,154,74,0.22)');
            const cx = card.x + card.w / 2;
            const textW = card.w - 24;
            const riteTitle = `${complete ? 'COMPLETE - ' : ''}${rite.name}`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = complete ? '#8ff29a' : '#fff';
            this._fitFont(ctx, riteTitle, textW, 800,
                layout.cardTitleFontPx, FONT, 24);
            ctx.fillText(riteTitle, cx, card.y + card.h * 0.17);
            ctx.fillStyle = 'rgba(235,239,244,0.72)';
            ctx.font = `600 ${layout.bodyFontPx}px ${FONT}`;
            this._wrapText(ctx, rite.desc, cx, card.y + card.h * 0.36,
                textW, layout.bodyFontPx * 1.14, 2);
            ctx.fillStyle = complete ? '#8ff29a' : '#ffd8b0';
            ctx.font = `800 ${layout.bodyFontPx}px ${FONT}`;
            ctx.fillText(`${Math.min(progress, rite.goal).toLocaleString()} / ${rite.goal.toLocaleString()}`,
                cx, card.y + card.h * 0.72);
            const bar = {
                x: card.x + 16, y: card.y + card.h * 0.82,
                w: card.w - 32, h: Math.max(10, Math.ceil(4 / cssScale)),
            };
            roundRectPath(ctx, bar.x, bar.y, bar.w, bar.h, bar.h / 2);
            ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill();
            if (fraction > 0) {
                roundRectPath(ctx, bar.x, bar.y, bar.w * fraction, bar.h, bar.h / 2);
                ctx.fillStyle = complete ? '#5fd36a' : '#ff9a4a'; ctx.fill();
            }
        }

        const card = layout.attunementCard;
        const level = save.heroAttunement?.[heroId] ?? 0;
        const maxed = level >= HERO_ATTUNE_MAX;
        const nextGate = maxed ? 0 : heroAttuneRiteGate(level + 1);
        const gateMet = done >= nextGate;
        const cost = maxed ? 0 : heroAttuneCost(level);
        const afford = !maxed && (save.totalCoins ?? 0) >= cost;
        const canBuy = !maxed && gateMet && afford;
        this._panel(ctx, card.x, card.y, card.w, card.h,
            'rgba(76,40,22,0.42)', 'rgba(255,206,84,0.38)');
        const cx = card.x + card.w / 2;
        const textW = card.w - 24;
        const attuneTitle = `HERO ATTUNEMENT  LV ${level}/${HERO_ATTUNE_MAX}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffd86b';
        this._fitFont(ctx, attuneTitle, textW, 800,
            layout.cardTitleFontPx, FONT, 24);
        ctx.fillText(attuneTitle, cx, card.y + card.h * 0.15);
        ctx.fillStyle = 'rgba(245,238,226,0.82)';
        ctx.font = `700 ${layout.bodyFontPx}px ${FONT}`;
        this._wrapText(ctx, maxed ? 'Fully attuned.' : this._heroAttuneEffectLabel(level + 1),
            cx, card.y + card.h * 0.32, textW, layout.bodyFontPx * 1.14, 2);
        ctx.fillStyle = gateMet ? '#9fe7a7' : '#ffb0a0';
        const gateLabel = maxed ? 'ALL FIVE LEVELS FORGED'
            : `RITE GATE ${done}/${nextGate}  |  BALANCE ${(save.totalCoins ?? 0).toLocaleString()}`;
        this._fitFont(ctx, gateLabel, textW, 700,
            layout.smallFontPx, FONT, 22);
        ctx.fillText(gateLabel, cx, card.y + card.h * 0.57);
        const buttonLabel = maxed ? 'MAX ATTUNEMENT'
            : !gateMet ? `COMPLETE ${nextGate} RITE${nextGate === 1 ? '' : 'S'}`
                : !afford ? `NEED ${cost.toLocaleString()} COINS`
                    : `ATTUNE - ${cost.toLocaleString()} COINS`;
        this._button(ctx, layout.purchaseButton, buttonLabel, {
            enabled: canBuy,
            action: canBuy ? 'buyHeroAttune' : null,
            arg: heroId,
            primary: canBuy,
            accent: canBuy ? '#2e6b3f' : 'rgba(70,54,44,0.92)',
            fontSize: layout.buttonFontPx,
            accessibleLabel: canBuy
                ? `Attune ${hero.name} to level ${level + 1} for ${cost} coins`
                : buttonLabel,
        });
    }

    _drawCharacter(ctx, state) {
        const c = this._contentRect();
        if (isPhoneLandscapeViewport(
            this.renderer.cssWidth ?? INTERNAL_WIDTH,
            this.renderer.cssHeight ?? INTERNAL_HEIGHT,
        )) {
            this._drawPhoneCharacter(ctx, state, c);
            return;
        }
        if (state.collectionCompletion?.open === true) {
            const cssScale = (this.renderer.cssWidth || INTERNAL_WIDTH) / INTERNAL_WIDTH;
            this._drawCollectionCompletion(ctx, state, c, { phone: false, cssScale });
            return;
        }
        const save = state.saveData;
        const avW = Math.min(560, Math.max(360, c.w * 0.33));
        const gap = 32;

        // Left: live model + equipped-slot summary.
        this._panel(ctx, c.x, c.y, avW, c.h, 'rgba(20,16,28,0.82)', 'rgba(192,139,255,0.22)');
        const ch = getCharacter(save.selectedCharacter);
        const ap = resolveAppearance(save.cosmetics.equipped);
        const avatarAp = { ...ap, furColor: ap.furColor || ch.palette.fur };
        let avatarPose = null;
        const avatarState = (this._t % 4.0) > 3.4 ? 'cast' : 'idle';
        try {
            const frames = getHeroFrames(ch.id, ch, ap, !!ap.hatShape && ap.hatShape !== 'none');
            avatarPose = resolveHeroPose(frames, 'down', avatarState, 0);
        } catch (e) { avatarPose = null; }
        const startWeaponId = resolveStartingWeapon(save);
        const heldProp = resolveWeaponProp(startWeaponId);
        const acx = c.x + avW / 2;
        const r = Math.min(150, avW * 0.26);
        const acy = c.y + 40 + r;
        // Soft stage disc beneath the model (scaled arc — no ctx.ellipse).
        ctx.save();
        ctx.translate(acx, acy + r * 0.9); ctx.scale(1, 0.3);
        ctx.fillStyle = 'rgba(192,139,255,0.12)';
        ctx.beginPath(); ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        // Clip to the panel so HAT_DROP-tall hats (party cone, antler tips,
        // halo) can't draw across the panel border into the tab-bar chrome.
        ctx.save();
        ctx.beginPath(); ctx.rect(c.x, c.y, avW, c.h); ctx.clip();
        this._drawAvatar(ctx, acx, acy, r, avatarAp, avatarPose, null, this._t, heldProp, resolveCharacterHold(ch.id), ch.palette && ch.palette.face);
        ctx.restore();
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#fff'; ctx.font = `800 30px ${FONT}`;
        ctx.fillText(ch.name, acx, acy + r + 30);
        if (ap.set) {
            // Whole themed set equipped → celebrate it (set-bonus VFX is live on
            // the model above).
            ctx.fillStyle = ap.set.color; ctx.font = `800 16px ${FONT}`;
            ctx.fillText(`✦ SET COMPLETE — ${ap.set.name} ✦`, acx, acy + r + 52);
        } else {
            ctx.fillStyle = 'rgba(192,139,255,0.95)'; ctx.font = `700 15px ${FONT}`;
            ctx.fillText('CUSTOMIZE  ·  LIVE PREVIEW', acx, acy + r + 52);
        }

        // Equipped-slot summary — a compact sheet of the current choices.
        const sx = c.x + 28, sw = avW - 56;
        const sy = acy + r + 70;
        const n = COSMETIC_CATEGORIES.length;
        const rgap = 12;
        const avail = (c.y + c.h - 16) - sy;
        const rowH = Math.max(30, Math.min(60, (avail - rgap * (n - 1)) / n));
        ctx.textBaseline = 'middle';
        for (let i = 0; i < n; i++) {
            const cat = COSMETIC_CATEGORIES[i];
            const ry = sy + i * (rowH + rgap);
            if (ry + rowH > c.y + c.h - 8) break;
            const item = COSMETICS[save.cosmetics.equipped[cat]] || { color: null };
            roundRectPath(ctx, sx, ry, sw, rowH, 9);
            ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
            ctx.strokeStyle = 'rgba(192,139,255,0.22)'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.save();
            this._cosmeticSwatch(ctx, cat, item, sx + 10, ry + (rowH - 26) / 2, 26);
            ctx.restore();
            ctx.textAlign = 'left';
            ctx.fillStyle = 'rgba(205,214,226,0.7)'; ctx.font = `700 15px ${FONT}`;
            ctx.fillText(COSMETIC_CATEGORY_LABELS[cat], sx + 46, ry + rowH / 2);
            ctx.textAlign = 'right';
            ctx.fillStyle = '#fff'; ctx.font = `600 16px ${FONT}`;
            ctx.fillText(this._ellip(ctx, item.name || '—', sw - 150), sx + sw - 14, ry + rowH / 2);
        }

        // Right column: cosmetic pickers (top) + the hero's RITES & Attunement
        // (bottom, KINDLED #3). The rites strip shrinks the picker grid rather than
        // adding a whole tab — mastery lives with the hero it belongs to.
        const rColX = c.x + avW + gap, rColW = c.w - avW - gap;
        const ritesH = Math.min(236, c.h * 0.44);
        this._drawItemGrid(ctx, state, 'cosmetic', { x: rColX, y: c.y, w: rColW, h: c.h - ritesH - 14 });
        this._drawRitesPanel(ctx, state, { x: rColX, y: c.y + c.h - ritesH, w: rColW, h: ritesH });
    }

    // KINDLED #3 — the selected hero's RITES (3 mastery quests + progress) and the
    // Hero Attunement ladder (Lv 0..5; rungs 3/4/5 rite-gated). Reads save.rites /
    // save.heroAttunement directly (like the cosmetic pickers read save.cosmetics);
    // the buy button dispatches 'buyHeroAttune' with the hero id.
    _drawRitesPanel(ctx, state, rect) {
        const save = state.saveData;
        const heroId = save.selectedCharacter;
        const rites = ritesFor(heroId);
        const done = ritesCompletedCount(save, heroId);
        this._panel(ctx, rect.x, rect.y, rect.w, rect.h, 'rgba(24,16,12,0.82)', 'rgba(255,154,74,0.24)');
        const pad = 16;
        let y = rect.y + pad + 6;
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#ffd8b0'; ctx.font = `800 18px ${FONT}`;
        ctx.fillText(`RITES — ${done}/${rites.length} complete`, rect.x + pad, y);
        y += 22;
        const rowH = 40, barH = 8;
        for (const rt of rites) {
            const prog = riteProgress(save, heroId, rt.id);
            const frac = rt.goal > 0 ? Math.max(0, Math.min(1, prog / rt.goal)) : 0;
            const complete = prog >= rt.goal;
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillStyle = complete ? '#7fe08a' : '#fff'; ctx.font = `700 14px ${FONT}`;
            ctx.fillText(this._ellip(ctx, `${complete ? '✓ ' : ''}${rt.name}`, rect.w - pad * 2 - 96), rect.x + pad, y + 7);
            ctx.textAlign = 'right';
            ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = `600 12px ${FONT}`;
            ctx.fillText(`${Math.min(prog, rt.goal).toLocaleString()} / ${rt.goal.toLocaleString()}`, rect.x + rect.w - pad, y + 7);
            const bx = rect.x + pad, bw = rect.w - pad * 2, by = y + 18;
            roundRectPath(ctx, bx, by, bw, barH, barH / 2); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
            if (frac > 0) { roundRectPath(ctx, bx, by, bw * frac, barH, barH / 2); ctx.fillStyle = complete ? '#5fd36a' : '#ff9a4a'; ctx.fill(); }
            y += rowH;
        }
        // Attunement ladder.
        const level = save.heroAttunement?.[heroId] ?? 0;
        const maxed = level >= HERO_ATTUNE_MAX;
        const nextGate = maxed ? 0 : heroAttuneRiteGate(level + 1);
        const gateMet = done >= nextGate;
        const cost = maxed ? 0 : heroAttuneCost(level);
        const afford = !maxed && (save.totalCoins ?? 0) >= cost;
        const canBuy = !maxed && gateMet && afford;
        const ay = y + 2;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffd8b0'; ctx.font = `800 15px ${FONT}`;
        ctx.fillText(`ATTUNEMENT  Lv ${level}/${HERO_ATTUNE_MAX}`, rect.x + pad, ay + 8);
        const segW = 22, segGap = 6, segH = 10;
        let sx2 = rect.x + pad + 190;
        for (let s = 0; s < HERO_ATTUNE_MAX; s++) {
            roundRectPath(ctx, sx2, ay + 3, segW, segH, 4);
            ctx.fillStyle = s < level ? '#ff9a4a' : 'rgba(255,255,255,0.12)'; ctx.fill();
            sx2 += segW + segGap;
        }
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(255,255,255,0.66)'; ctx.font = `600 12px ${FONT}`;
        ctx.fillText(this._ellip(ctx, maxed ? 'Fully attuned' : this._heroAttuneEffectLabel(level + 1), rect.w - pad * 2 - 140), rect.x + pad, ay + 32);
        const bw = 132, bh = 34, bx = rect.x + rect.w - pad - bw, by = ay - 6;
        const label = maxed ? 'MAX' : !gateMet ? `NEEDS ${nextGate} RITE${nextGate > 1 ? 'S' : ''}` : `◎ ${cost}`;
        this._button(ctx, { x: bx, y: by, w: bw, h: bh }, label, {
            enabled: canBuy, accent: canBuy ? '#2e6b3f' : null,
            action: canBuy ? 'buyHeroAttune' : null, arg: heroId, fontSize: 14,
        });
    }

    // The one-line effect a given attunement level grants (menu copy).
    _heroAttuneEffectLabel(level) {
        switch (level) {
            case 1: return 'Next: +10% Kindle gain';
            case 2: return 'Next: −0.5s blink cooldown';
            case 3: return 'Next: +12% ult damage (needs 1 Rite)';
            case 4: return 'Next: +8% vs focused (needs 2 Rites)';
            case 5: return 'Next: ult costs 85 · ember crown (needs 3 Rites)';
            default: return '';
        }
    }

    // ── SHOP (cases) ─────────────────────────────────────────────────────
    _drawShop(ctx, state) {
        const c = this._contentRect();
        const save = state.saveData;
        const gap = 24;
        // Six cases (gear + cosmetic per tier) → a 3-column, 2-row grid so the
        // names + odds aren't crushed into thin slivers.
        const cols = 3;
        const rows = Math.ceil(CASE_ORDER.length / cols);
        // Reserve strips at the bottom for Featured Prestige + the Cinder Wager.
        const forgeH = 144;
        const featH = 96, featGap = 14;
        const gridH = c.h - forgeH - 24 - featH - featGap;
        const cardW = (c.w - gap * (cols - 1)) / cols;
        const rowH = (gridH - gap * (rows - 1)) / rows;
        ctx.textBaseline = 'alphabetic';
        for (let i = 0; i < CASE_ORDER.length; i++) {
            const def = CASES[CASE_ORDER[i]];
            const col = i % cols, row = Math.floor(i / cols);
            const x = c.x + col * (cardW + gap);
            const y = c.y + row * (rowH + gap);
            const topR = caseTopRarity(def.id);
            this._panel(ctx, x, y, cardW, rowH, 'rgba(18,22,30,0.9)', `${rarityColor(topR)}55`);
            const midX = x + cardW / 2;
            const innerX = x + 30, innerW = cardW - 60;
            ctx.textAlign = 'center';
            ctx.fillStyle = '#fff'; ctx.font = `800 25px ${FONT}`;
            ctx.fillText(def.name, midX, y + 34);
            // "up to ★ <TOP RARITY>" aspiration tag under the title — the ceiling
            // reward, in its own colour, so the chase target reads at a glance.
            ctx.font = `800 14px ${FONT}`; ctx.fillStyle = rarityColor(topR);
            ctx.fillText(`up to ★ ${rarityName(topR).toUpperCase()}`, midX, y + 53);
            // OPEN button anchored at the card bottom; everything above adapts to
            // whatever height remains, so nothing collides on short panels where
            // the grid shares space with the Featured + Mines strips.
            const afford = save.totalCoins >= def.cost;
            const btnH = Math.max(38, Math.min(52, rowH * 0.27));
            const br = { x: innerX, y: y + rowH - btnH - 10, w: innerW, h: btnH };
            // ── The middle band between the tag and the OPEN button holds the
            // odds bar + the bad-luck pity meter, laid out from the BOTTOM up so
            // neither can ever collide with the button on short (large-safe-area)
            // cards. Each element is dropped before it would overlap — the same
            // graceful-compression behaviour the odds table used to have. ──
            const mTop = y + 58, mBot = br.y - 8, band = mBot - mTop;
            // Transparent bad-luck safety net: live "Rare+ guaranteed in
            // N" readout nearest the button. Full text+bar when there's room, a
            // compact text-only line when cramped, dropped entirely when tiny.
            const cap = CASE_PITY[def.id] || 12;
            const remain = casePityRemaining(save, def.id);
            const frac = clamp01((cap - remain) / cap);
            const soon = remain === 1;
            // The pity meter is the priority disclosure, so it claims the
            // band bottom first; the odds bar only fills whatever is left above.
            let pityTop = mBot;   // lower bound for the odds bar above
            if (band >= 12) {
                const full = band >= 24;
                pityTop = mBot - (full ? 18 : 13);
                ctx.textAlign = 'center'; ctx.font = `700 ${full ? 12 : 11}px ${FONT}`;
                ctx.fillStyle = soon ? '#ffd24a' : remain <= 3 ? '#ff9a4a' : 'rgba(255,255,255,0.55)';
                ctx.fillText(soon ? '★ GUARANTEED RARE+ NEXT ★' : `◆ Rare+ guaranteed in ${remain}`, midX, full ? mBot - 8 : mBot - 3);
                if (full) {
                    const pBarY = mBot - 3;
                    roundRectPath(ctx, innerX, pBarY, innerW, 3, 1.5); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
                    if (frac > 0) { roundRectPath(ctx, innerX, pBarY, innerW * frac, 3, 1.5); ctx.fillStyle = soon ? '#ffd24a' : '#ff8a4a'; ctx.fill(); }
                }
            }
            // Odds as a stacked probability bar (common→rarest, width ∝ chance),
            // colour-coded, with the % printed inside any segment wide/tall enough
            // to hold it. Fills whatever space is left above the pity block.
            const oddsRows = caseOddsRows(def.id);          // high→low
            const asc = oddsRows.slice().reverse();          // low→high for the bar
            const totalPct = asc.reduce((s, r) => s + r.pct, 0) || 1;
            const obTop = mTop + 1, obBot = pityTop - 3;
            if (obBot - obTop >= 6) {
                const obH = Math.min(15, obBot - obTop), obY = obTop;
                let segX = innerX;
                ctx.textBaseline = 'middle';
                for (let ri = 0; ri < asc.length; ri++) {
                    const r = asc[ri];
                    const segW = (r.pct / totalPct) * innerW;
                    if (segW <= 0) continue;
                    ctx.fillStyle = rarityColor(r.rarity);
                    ctx.globalAlpha = 0.9;
                    roundRectPath(ctx, segX + (ri ? 1 : 0), obY, Math.max(1, segW - (ri ? 1 : 0)), obH, 3);
                    ctx.fill();
                    ctx.globalAlpha = 1;
                    if (segW >= 34 && obH >= 12) {
                        ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.font = `800 11px ${FONT}`;
                        ctx.textAlign = 'center';
                        ctx.fillText(`${r.pct}%`, segX + segW / 2, obY + obH / 2 + 0.5);
                    }
                    segX += segW;
                }
                ctx.textBaseline = 'alphabetic';
            }
            // ── The case CHEST art fills the band's free middle (the card's
            // hero image — the loot-box look). Gentle idle bob + a warm breathing
            // glow when affordable; skipped gracefully while the art loads or
            // when a cramped layout leaves no room.
            const chest = getCaseArt(def.id);
            const artTop = obTop + 20, artBot = pityTop - 22;
            if (chest && artBot - artTop >= 56) {
                const t = this._t || 0;
                const size = Math.min(artBot - artTop, innerW * 0.52, 150);
                const bob = Math.sin(t * 1.6 + i * 1.1) * 2.5;
                const ay = (artTop + artBot) / 2 + bob;
                if (afford) {
                    ctx.save(); ctx.globalCompositeOperation = 'lighter';
                    this._ember(ctx, midX, ay, size * 0.72, rarityColor(topR), 0.14 + Math.sin(t * 2.2 + i) * 0.04);
                    ctx.restore(); ctx.globalAlpha = 1;
                }
                ctx.drawImage(chest, midX - size / 2, ay - size / 2, size, size);
            }
            // Always clickable: an unaffordable tap surfaces a "Not enough
            // coins" toast rather than silently doing nothing.
            this._button(ctx, br, `OPEN  ◎ ${def.cost}`,
                { primary: false, enabled: true, accent: afford ? `${rarityColor(topR)}aa` : 'rgba(60,66,78,0.9)', action: 'openCase', arg: def.id, fontSize: Math.round(Math.min(24, btnH * 0.44)) });
            if (afford) this._emberRim(ctx, br.x + 8, br.y, br.w - 16, br.h, this._t || 0, i * 0.8);
        }

        // ── Featured Prestige: a spotlight on grind-worthy cosmetics with a
        // LIVE animated preview; tapping a card jumps to the BOUTIQUE to try
        // it on. Pure marketing for the prestige layer. ──
        const featY = c.y + gridH + featGap;
        this._panel(ctx, c.x, featY, c.w, featH, 'rgba(24,18,34,0.92)', '#c08bff');
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#c08bff'; ctx.font = `800 22px ${HEAD}`;
        ctx.fillText('✦ FEATURED PRESTIGE', c.x + 24, featY + 30);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `600 15px ${FONT}`;
        ctx.fillText('— earn the look', c.x + 360, featY + 29);
        const feat = ['aura_mythic', 'aura_prism', 'hat_halo', 'trail_rainbow', 'fur_galaxy'];
        const fcGap = 16, fcTop = featY + 42, fcH = featH - 42 - 12;
        const fcW = (c.w - 48 - fcGap * (feat.length - 1)) / feat.length;
        for (let i = 0; i < feat.length; i++) {
            const item = COSMETICS[feat[i]]; if (!item) continue;
            const fx = c.x + 24 + i * (fcW + fcGap);
            roundRectPath(ctx, fx, fcTop, fcW, fcH, 10);
            ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
            ctx.strokeStyle = rarityColor(item.rarity); ctx.lineWidth = 2; ctx.stroke();
            const boxR = Math.min(26, fcH / 2 - 8), bcx = fx + boxR + 14, bcy = fcTop + fcH / 2;
            ctx.save(); roundRectPath(ctx, fx, fcTop, fcW, fcH, 10); ctx.clip();
            if (item.category === 'aura') drawAuraFx(ctx, bcx, bcy, boxR,
                item.color, item.fx, this._t, 0.5, this._reducedMotion);
            else { const isz = boxR * 2; this._cosmeticSwatch(ctx, item.category, item, bcx - boxR, bcy - boxR, isz); }
            ctx.restore();
            const tx = fx + boxR * 2 + 24, tw = fcW - (boxR * 2 + 36);
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = rarityColor(item.rarity); ctx.font = `800 17px ${FONT}`;
            ctx.fillText(this._ellip(ctx, item.name, tw), tx, bcy - 3);
            let pathTxt;
            if (save.cosmetics.unlocked.includes(item.id)) pathTxt = '✓ Owned';
            else if (item.passLevel) pathTxt = `✦ Vigil Lv ${item.passLevel}`;
            else if (item.coinCost) pathTxt = `◎ ${cosmeticCoinCost(item)}`;
            else if (item.achievement) { const ach = ACHIEVEMENTS.find((a) => a.id === item.achievement); pathTxt = `🏆 ${ach ? ach.name : 'Achievement'}`; }
            else pathTxt = '🔒 Case drop';
            ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.font = `600 14px ${FONT}`;
            ctx.fillText(this._ellip(ctx, pathTxt, tw), tx, bcy + 19);
            // Coin items live in the boutique's stock; case/achievement drops
            // aren't sold there — those cards route to the customizer, which
            // lists every cosmetic with its unlock path.
            this._hot(fx, fcTop, fcW, fcH, 'tab', item.passLevel ? 'battlepass' : item.coinCost ? 'boutique' : 'character');
        }

        // ── Cinder Wager strip: coin-only Mines with fixed, bounded stakes. ──
        const fy = featY + featH + 24;
        this._panel(ctx, c.x, fy, c.w, forgeH, 'rgba(30,20,14,0.92)', '#ff8a4a');
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#ffb24a'; ctx.font = `800 30px ${FONT}`;
        ctx.fillText('💣  MINES', c.x + 32, fy + 46);
        // Hourly play quota.
        const plays = state.gamblePlays || { remaining: 5, max: 5, resetInMs: 0 };
        ctx.textAlign = 'left';
        ctx.fillStyle = plays.remaining > 0 ? '#7be08a' : '#ff6a5a';
        ctx.font = `700 22px ${FONT}`;
        const resetTxt = plays.remaining < plays.max && plays.resetInMs > 0 ? ` · resets in ${Math.ceil(plays.resetInMs / 60000)}m` : '';
        ctx.fillText(`Plays: ${plays.remaining}/${plays.max}${resetTxt}`, c.x + 220, fy + 46);
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `500 18px ${FONT}`;
        ctx.fillText('Coin-only · exact next-pick odds · about 7% house edge · max loss is the chosen stake · 5 plays/hour.', c.x + 32, fy + 78);
        // Four fixed stake presets (greyed when unaffordable/no plays remain).
        const bets = WAGER_BETS;
        const bw = 170, bgap = 14;
        const totalW = bets.length * bw + (bets.length - 1) * bgap;
        let bx = c.x + c.w - totalW - 32;
        for (const bet of bets) {
            const aff = save.totalCoins >= bet && plays.remaining > 0;
            // Bottom-aligned INSIDE the 144px strip (96+56 overhung it by 8px).
            const r = { x: bx, y: fy + 84, w: bw, h: 52 };
            this._button(ctx, r, `BET  ◎ ${bet}`,
                { primary: aff, enabled: true, accent: aff ? '#7a3a18' : 'rgba(60,66,78,0.9)', action: 'openMines', arg: bet, fontSize: 21 });
            bx += bw + bgap;
        }
    }

    // ── BOUTIQUE — the cosmetic fitting room ─────────────────────────────
    // Try looks on BEFORE buying (the ask behind moving purchases out of the
    // customizer): a live mannequin previews save-equipped cosmetics with the
    // session try-on map (game.tryOn) layered over, the five themed SETS try
    // on as one-tap combos, and the stock grid lists every coin-purchasable
    // piece. One honest purchase affordance — BUY LOOK — buys every unowned
    // coin piece currently tried on (and equips the whole look); pieces that
    // can't be bought (case/achievement drops) preview fine but are labelled.
    _drawBoutiqueTrailPreview(ctx, appearance, cx, groundY, avatarRadius, t, clipRect) {
        if (!appearance?.trailColor) return false;
        const points = boutiqueTrailPreviewPoints(cx, groundY, avatarRadius);
        ctx.save();
        if (clipRect) {
            ctx.beginPath();
            ctx.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h);
            ctx.clip();
        }
        for (const point of points) {
            ctx.globalAlpha = point.alpha;
            drawTrailPoint(ctx, point.x, point.y, point.b, point.k,
                appearance.trailColor, appearance.trailFx, t, point.index,
                this._reducedMotion);
        }
        ctx.restore();
        this._lastBoutiqueTrailPreview = true;
        return true;
    }

    _drawBoutique(ctx, state) {
        const c = this._contentRect();
        const save = state.saveData;
        const t = this._t || 0;
        const tryOn = state.tryOn || {};
        const trying = Object.keys(tryOn).length > 0;
        const owned = (id) => save.cosmetics.unlocked.includes(id);

        // ── Mannequin pane (left): live preview of equipped + try-on ──
        const mw = Math.round(c.w * 0.34);
        this._panel(ctx, c.x, c.y, mw, c.h, 'rgba(26,14,24,0.92)', 'rgba(255,126,219,0.3)', { corners: true });
        const mcx = c.x + mw / 2;
        const merged = { ...save.cosmetics.equipped, ...tryOn };
        const ap = resolveAppearance(merged);
        const ch = getCharacter(save.selectedCharacter);
        const avatarAp = { ...ap, furColor: ap.furColor || ch.palette.fur };
        let avatarPose = null;
        try {
            avatarPose = resolveHeroPose(getHeroFrames(ch.id, ch, ap,
                !!ap.hatShape && ap.hatShape !== 'none'), 'down', 'idle', 0);
        } catch (e) { avatarPose = null; }
        // Mannequin radius scales with the panel (fixed 105 collided with the
        // caption once phone insets + the sub-tab row shrank c.h to ~557), and
        // the caption anchors BELOW the sprite box, whichever is lower.
        const avR = Math.max(64, Math.min(105, Math.round(c.h * 0.14)));
        const avCy = c.y + c.h * 0.24;
        const pedSc = Math.max(0.5, Math.min(0.9, c.h / 720));
        this._pedestal(ctx, mcx, avCy + avR * 0.86, t, '#ff7edb', pedSc);
        const trailPreviewed = this._drawBoutiqueTrailPreview(
            ctx, avatarAp, mcx, avCy + avR * 0.88, avR, t,
            { x: c.x, y: c.y, w: mw, h: c.h },
        );
        this._drawAvatar(ctx, mcx, avCy, avR, avatarAp, avatarPose, null, t, null, resolveCharacterHold(ch.id), ch.palette && ch.palette.face);
        const capY = Math.max(c.y + c.h * 0.42, avCy + avR * 1.25 + 22);
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#ff7edb'; ctx.font = `800 22px ${HEAD}`;
        ctx.fillText('FITTING ROOM', mcx, capY);
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `500 15px ${FONT}`;
        const fittingCopy = trying ? 'Previewing your try-on look'
            : 'Tap pieces or a set to try them on';
        ctx.fillText(trailPreviewed ? `${fittingCopy} · trail marks appear while moving` : fittingCopy,
            mcx, capY + 24);

        // Tried-on pieces, listed with their path (price / owned / drop-only).
        let total = 0, equippableN = 0;
        const previewRoutes = new Set();
        let ly = capY + 54;
        ctx.textAlign = 'left';
        for (const cat of COSMETIC_CATEGORIES) {
            const id = tryOn[cat];
            if (!id || !COSMETICS[id]) continue;
            const item = COSMETICS[id];
            const price = cosmeticCoinCost(item);
            let path, pcol;
            if (owned(id)) { path = '✓ owned'; pcol = '#5fd36a'; equippableN++; }
            else if (price) {
                const routes = getCosmeticAcquisitionRoutes(item);
                path = `◎ ${price.toLocaleString()}${routes.includes('case') ? ' · Case' : ''}`;
                pcol = '#ffd86b'; total += price; equippableN++;
            } else {
                for (const route of getCosmeticAcquisitionRoutes(item)) previewRoutes.add(route);
                path = getCosmeticSourceLabel(item) || 'Case';
                pcol = item.passLevel ? '#ff9a4a'
                    : item.achievement ? 'rgba(168,213,247,0.9)'
                    : 'rgba(255,255,255,0.5)';
            }
            ctx.fillStyle = rarityColor(item.rarity); ctx.font = `700 16px ${FONT}`;
            ctx.fillText(this._ellip(ctx, item.name, mw - 160), c.x + 24, ly);
            ctx.textAlign = 'right'; ctx.fillStyle = pcol; ctx.font = `700 15px ${FONT}`;
            ctx.fillText(path, c.x + mw - 24, ly);
            ctx.textAlign = 'left';
            ly += 26;
        }
        // BUY LOOK + CLEAR at the pane's foot. A look with NOTHING equippable
        // (all case/achievement drops — e.g. the Gloambound set on a fresh
        // save) is preview-only: the CTA disables instead of lying.
        const afford = total > 0 && save.totalCoins >= total;
        const canEquipOnly = trying && total === 0 && equippableN > 0;
        const previewOnly = trying && equippableN === 0;
        const bw2 = mw - 48, bh2 = 56;
        const by2 = c.y + c.h - 76 - bh2;
        this._button(ctx, { x: c.x + 24, y: by2, w: bw2, h: bh2 },
            previewOnly ? 'PREVIEW ONLY' : total > 0 ? `BUY LOOK  ·  ◎ ${total.toLocaleString()}` : 'EQUIP LOOK',
            { enabled: afford || canEquipOnly, primary: afford || canEquipOnly,
              // Unaffordable stays tappable (deny toast, shop convention);
              // preview-only looks get no action at all.
              action: trying && !previewOnly ? 'buyTryOn' : null, fontSize: 24 });
        if (previewOnly) {
            ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `500 14px ${FONT}`;
            const guidance = boutiquePreviewGuidance(previewRoutes);
            ctx.fillText(this._ellip(ctx, guidance, bw2 - 12), mcx, by2 - 10);
        }
        if (total > 0 && !afford) {
            ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `500 14px ${FONT}`;
            ctx.fillText(`Bank ◎ ${(total - save.totalCoins).toLocaleString()} more to afford this look`, mcx, by2 - 10);
        }
        this._button(ctx, { x: c.x + 24, y: c.y + c.h - 66, w: bw2, h: 44 }, 'CLEAR TRY-ON',
            { enabled: trying, action: trying ? 'tryOnClear' : null, fontSize: 18 });

        // ── Right side: paged themed SETS + category-focused stock ──
        const rx = c.x + mw + 20;
        const rw = c.w - mw - 20;
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = `800 17px ${HEAD}`;
        ctx.fillText('THEMED SETS — tap to try the whole combo', rx, c.y + 16);
        const setsPerPage = 3;
        const setPageCount = Math.max(1, Math.ceil(COSMETIC_SETS.length / setsPerPage));
        const requestedSetPage = Math.max(1, Math.floor(Number(state.boutiqueView?.setPage) || 1));
        const setPage = Math.min(setPageCount, requestedSetPage);
        const visibleSets = COSMETIC_SETS.slice((setPage - 1) * setsPerPage, setPage * setsPerPage);
        const setH = 60, setGap = 10;
        const setW = (rw - setGap * (setsPerPage - 1)) / setsPerPage;
        for (let i = 0; i < visibleSets.length; i++) {
            const s = visibleSets[i];
            const sx = rx + i * (setW + setGap), sy2 = c.y + 26;
            const ownedN = COSMETIC_CATEGORIES.filter((cat) => owned(s.pieces[cat])).length;
            const tryingSet = COSMETIC_CATEGORIES.every((cat) => tryOn[cat] === s.pieces[cat]);
            const pursued = save.cosmetics.pursuitSetId === s.id;
            const trackW = Math.min(72, Math.max(58, setW * 0.25));
            roundRectPath(ctx, sx, sy2, setW, setH, 10);
            ctx.fillStyle = tryingSet ? 'rgba(64,32,52,0.95)' : 'rgba(20,14,20,0.9)'; ctx.fill();
            ctx.strokeStyle = tryingSet || pursued ? s.color : 'rgba(255,255,255,0.12)';
            ctx.lineWidth = tryingSet ? 2.5 : 1.5; ctx.stroke();
            if (tryingSet) this._selGlow(ctx, sx, sy2, setW, setH, 10, s.color, t);
            ctx.fillStyle = s.color; ctx.font = `700 15px ${FONT}`;
            ctx.fillText(this._ellip(ctx, s.name, setW - trackW - 26), sx + 12, sy2 + 24);
            ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `600 13px ${FONT}`;
            ctx.fillText(`${ownedN}/5 owned`, sx + 12, sy2 + 44);
            const trackX = sx + setW - trackW;
            roundRectPath(ctx, trackX + 5, sy2 + 8, trackW - 10, setH - 16, 8);
            ctx.fillStyle = pursued ? `${s.color}33` : 'rgba(255,255,255,0.05)'; ctx.fill();
            ctx.strokeStyle = pursued ? s.color : 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke();
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = pursued ? s.color : 'rgba(255,255,255,0.68)'; ctx.font = `800 10px ${FONT}`;
            ctx.fillText(pursued ? 'TRACKED' : 'TRACK', trackX + trackW / 2, sy2 + setH / 2);
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            this._hot(sx, sy2, setW - trackW, setH, 'tryOnSet', s.id,
                `Try on ${s.name}. ${ownedN} of 5 pieces owned.`);
            this._hot(trackX, sy2, trackW, setH, 'pursueCosmeticSet', s.id,
                `${pursued ? 'Stop tracking' : 'Track'} ${s.name}. ${ownedN} of 5 pieces owned.`);
        }
        const setPagerY = c.y + 26 + setH + 4;
        this._button(ctx, { x: rx, y: setPagerY, w: 96, h: 24 }, '‹ SETS', {
            enabled: setPage > 1, action: setPage > 1 ? 'boutiqueSetPage' : null,
            arg: setPage - 1, fontSize: 11, accessibleLabel: `Previous Boutique set page, ${setPage - 1}`,
        });
        this._button(ctx, { x: rx + rw - 96, y: setPagerY, w: 96, h: 24 }, 'SETS ›', {
            enabled: setPage < setPageCount, action: setPage < setPageCount ? 'boutiqueSetPage' : null,
            arg: setPage + 1, fontSize: 11, accessibleLabel: `Next Boutique set page, ${setPage + 1}`,
        });
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(220,228,238,0.55)'; ctx.font = `700 12px ${FONT}`;
        ctx.fillText(`SET PAGE ${setPage}/${setPageCount}`, rx + rw / 2, setPagerY + 12);

        const categories = [
            { id: 'fur', label: 'FUR' }, { id: 'cloak', label: 'CLOAK' },
            { id: 'hat', label: 'ACCESSORY' }, { id: 'aura', label: 'AURA' },
            { id: 'trail', label: 'TRAIL' },
        ];
        const categoryY = setPagerY + 31;
        const stockModel = buildCosmeticCollectionPage({
            category: state.boutiqueView?.category || 'fur',
            ownership: 'all', source: 'boutique',
            page: state.boutiqueView?.page || 1,
            ownedIds: save.cosmetics.unlocked,
        });
        this._segmentedRow(ctx, categories, stockModel.category, rx, categoryY, rw, 30,
            'boutiqueCategory', '#ff7edb');

        const footerH = 34;
        const gridY = categoryY + 38;
        const gridBottom = c.y + c.h - footerH - 4;
        const gridH = Math.max(1, gridBottom - gridY);
        const stockEntries = Array.isArray(stockModel.entries) ? stockModel.entries : [];
        if (stockEntries.length) {
            const cols = rw >= 720 ? 4 : 2;
            const rows = Math.max(1, Math.ceil(8 / cols));
            const gap = 9;
            const cardW = (rw - gap * (cols - 1)) / cols;
            const cardH = (gridH - gap * (rows - 1)) / rows;
            for (let i = 0; i < stockEntries.length; i++) {
                const col = i % cols, row = Math.floor(i / cols);
                this._drawCollectionCard(ctx, state, stockEntries[i], {
                    x: rx + col * (cardW + gap), y: gridY + row * (cardH + gap),
                    w: cardW, h: cardH,
                }, 'boutique');
            }
        } else {
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(220,228,238,0.55)'; ctx.font = `700 16px ${FONT}`;
            ctx.fillText('No Boutique stock in this category.', rx + rw / 2, gridY + gridH / 2);
        }
        const stockPage = stockModel.page || 1;
        const stockPageCount = stockModel.pageCount || 1;
        const stockPrev = stockModel.hasPreviousPage ?? stockModel.hasPrev
            ?? stockModel.hasPrevious ?? stockPage > 1;
        const stockNext = stockModel.hasNextPage ?? stockModel.hasNext
            ?? stockPage < stockPageCount;
        const stockPagerY = c.y + c.h - 30;
        this._button(ctx, { x: rx, y: stockPagerY, w: 110, h: 26 }, '‹ PREV', {
            enabled: stockPrev, action: stockPrev ? 'boutiquePage' : null,
            arg: stockPage - 1, fontSize: 12, accessibleLabel: `Previous Boutique stock page, ${stockPage - 1}`,
        });
        this._button(ctx, { x: rx + rw - 110, y: stockPagerY, w: 110, h: 26 }, 'NEXT ›', {
            enabled: stockNext, action: stockNext ? 'boutiquePage' : null,
            arg: stockPage + 1, fontSize: 12, accessibleLabel: `Next Boutique stock page, ${stockPage + 1}`,
        });
        const stockTotal = stockModel.totalItems ?? stockModel.totalCount ?? stockModel.filteredCount
            ?? stockModel.total ?? stockEntries.length;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(220,228,238,0.62)'; ctx.font = `700 12px ${FONT}`;
        ctx.fillText(`STOCK ${stockPage}/${stockPageCount} · ${stockTotal}`,
            rx + rw / 2, stockPagerY + 13);
    }

    // ── BATTLE PASS ──────────────────────────────────────────────────────
    _drawBattlePass(ctx, state) {
        this._drawVigilPath(ctx, state);
    }

    _drawPassBackdrop(ctx, c, ui) {
        this._panel(ctx, c.x, c.y, c.w, c.h, 'rgba(9,7,13,0.97)', 'rgba(255,128,58,0.35)');
        if (ui.passBg) {
            ctx.save();
            roundRectPath(ctx, c.x + 2, c.y + 2, c.w - 4, c.h - 4, 15); ctx.clip();
            const scale = Math.max(c.w / ui.passBg.width, c.h / ui.passBg.height);
            const dw = ui.passBg.width * scale, dh = ui.passBg.height * scale;
            ctx.globalAlpha = 0.9;
            ctx.drawImage(ui.passBg, c.x + (c.w - dw) / 2, c.y + (c.h - dh) / 2, dw, dh);
            ctx.globalAlpha = 1;
            const veil = ctx.createLinearGradient(0, c.y, 0, c.y + c.h);
            veil.addColorStop(0, 'rgba(5,4,10,0.64)');
            veil.addColorStop(0.23, 'rgba(5,4,10,0.18)');
            veil.addColorStop(0.56, 'rgba(5,4,10,0.12)');
            veil.addColorStop(1, 'rgba(5,4,10,0.8)');
            ctx.fillStyle = veil; ctx.fillRect(c.x, c.y, c.w, c.h);
            ctx.restore();
        }
        roundRectPath(ctx, c.x + 1.5, c.y + 1.5, c.w - 3, c.h - 3, 15);
        ctx.strokeStyle = 'rgba(255,142,70,0.5)'; ctx.lineWidth = 2; ctx.stroke();
        if (!this._forgeCorners(ctx, c.x, c.y, c.w, c.h)) this._cornerTicks(ctx, c.x, c.y, c.w, c.h);
    }

    _drawPassHeader(ctx, c, ui, prog, pending) {
        const hx = c.x + 24, hy = c.y + 18, hw = c.w - 48, hh = 116;
        roundRectPath(ctx, hx, hy, hw, hh, 14);
        ctx.fillStyle = 'rgba(8,6,11,0.88)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,177,92,0.32)'; ctx.lineWidth = 2; ctx.stroke();
        let titleX = hx + 24;
        if (ui.crest) {
            const crestH = 82, crestW = ui.crest.width * (crestH / ui.crest.height);
            ctx.save(); ctx.globalAlpha = 0.92;
            ctx.drawImage(ui.crest, hx + 12, hy - 6, crestW, crestH);
            ctx.restore();
            titleX = hx + Math.min(118, crestW + 26);
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#fff2dc'; ctx.font = `800 30px ${HEAD}`;
        ctx.fillText('THE LAST LIGHT VIGIL', titleX, hy + 39);
        const chipX = titleX, chipY = hy + 52, chipW = 170, chipH = 27;
        roundRectPath(ctx, chipX, chipY, chipW, chipH, chipH / 2);
        ctx.fillStyle = 'rgba(95,211,106,0.16)'; ctx.fill();
        ctx.strokeStyle = 'rgba(95,211,106,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#8cef98'; ctx.font = `800 14px ${FONT}`;
        ctx.fillText('FREE  ·  NO EXPIRY', chipX + chipW / 2, chipY + chipH / 2 + 1);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(255,245,228,0.72)'; ctx.font = `600 16px ${FONT}`;
        ctx.fillText('Every valid finished run moves the flame.', chipX + chipW + 16, chipY + 19);

        const nextLevel = pending[0] || (prog.atMax ? BP_MAX_LEVEL : Math.min(BP_MAX_LEVEL, prog.level + 1));
        const nextEntry = BATTLE_PASS_LEVELS[nextLevel - 1];
        ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#ffb257'; ctx.font = `800 25px ${HEAD}`;
        ctx.fillText(prog.atMax ? `EVERFLAME ${prog.everflameRank}` : `VIGIL LEVEL ${prog.level} / ${BP_MAX_LEVEL}`, hx + hw - 22, hy + 35);
        ctx.fillStyle = 'rgba(255,245,228,0.7)'; ctx.font = `600 16px ${FONT}`;
        const nextText = pending.length
            ? `READY TO CLAIM · Lv ${nextLevel} ${rewardLabel(nextEntry.reward)}`
            : prog.atMax
                ? `Next cache: ${BP_EVERFLAME_COINS} coins`
                : `Next: Lv ${nextLevel} · ${rewardLabel(nextEntry.reward)}`;
        ctx.fillText(this._ellip(ctx, nextText, 510), hx + hw - 22, hy + 67);

        const barX = hx + 22, barY = hy + 88, barW = hw - 44, barH = 14;
        const barFraction = prog.atMax ? prog.everflameFraction : prog.fraction;
        roundRectPath(ctx, barX, barY, barW, barH, 7); ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fill();
        if (barFraction > 0) {
            const fillW = Math.max(barH, barW * clamp01(barFraction));
            const pg = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
            pg.addColorStop(0, '#ff713f'); pg.addColorStop(0.55, '#ffad4d'); pg.addColorStop(1, '#ff5f91');
            roundRectPath(ctx, barX, barY, fillW, barH, 7); ctx.fillStyle = pg; ctx.fill();
        }
        ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.font = `700 13px ${FONT}`;
        ctx.fillText(prog.atMax
            ? `${prog.everflameXp} / ${prog.everflameNeed} overflow XP`
            : `${prog.levelXp} / ${prog.levelNeed} XP`, barX + barW, barY - 4);
    }

    _drawPassReceipt(ctx, c, last) {
        const y = c.y + 146, h = 40;
        roundRectPath(ctx, c.x + 36, y, c.w - 72, h, 10);
        ctx.fillStyle = 'rgba(8,6,11,0.82)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,154,74,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
        let text = 'FINISH A RUN  ·  XP comes from Kindling, Endurance, Hunt and Deeds  ·  Trials and Threat add visible bonuses';
        if (last && last.gained > 0 && last.breakdown) {
            const receipt = battlePassRunReceipt(last);
            text = `LAST RUN  +${receipt.gained} XP`;
            if (receipt.reconciles) {
                const waylight = receipt.waylightWithinDeeds > 0
                    ? ` (Waylight ${receipt.waylightWithinDeeds} included)` : '';
                text += `  ·  Kindling ${receipt.kindling}  ·  Endurance ${receipt.endurance}  ·  Hunt ${receipt.hunt}  ·  Deeds ${receipt.deeds}${waylight}`;
                if (receipt.trials > 0) text += `  ·  Trials +${receipt.trials}`;
                if (receipt.threat > 0) text += `  ·  Threat +${receipt.threat}`;
            }
            if (last.everflameCaches > 0) text += `  ·  Everflame +${last.everflameCoins} coins`;
        }
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffd7a0'; ctx.font = `700 16px ${FONT}`;
        ctx.fillText(this._ellip(ctx, text, c.w - 110), c.x + c.w / 2, y + h / 2 + 1);
    }

    _drawPassMilestones(ctx, c, save, prog) {
        const levels = [10, 20, 30, 40, 50];
        const ids = ['fur_vigil', 'cloak_vigil', 'hat_vigil', 'trail_vigil', 'aura_mythic'];
        const owned = save.cosmetics?.unlocked || [];
        const ownedN = ids.filter((id) => owned.includes(id)).length;
        const compact = c.h < 700;
        const top = c.y + (compact ? 198 : 212), lineY = top + (compact ? 46 : 62);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#ffb257'; ctx.font = `800 18px ${HEAD}`;
        ctx.fillText(`LAST LIGHT REGALIA  ${ownedN}/5`, c.x + 54, top + 8);
        ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.58)'; ctx.font = `700 14px ${FONT}`;
        ctx.fillText('COSMETIC ONLY  ·  NO STAT BONUS', c.x + c.w - 54, top + 8);
        const x0 = c.x + 150, x1 = c.x + c.w - 150;
        ctx.strokeStyle = 'rgba(255,128,56,0.38)'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(x0, lineY); ctx.lineTo(x1, lineY); ctx.stroke();
        const next = levels.find((level) => level > prog.level) || 50;
        for (let i = 0; i < levels.length; i++) {
            const level = levels[i], item = COSMETICS[ids[i]];
            const x = x0 + (x1 - x0) * (i / (levels.length - 1));
            const reached = level <= prog.level, hasItem = owned.includes(item.id);
            const pulse = level === next ? 0.5 + Math.sin((this._t || 0) * 3) * 0.18 : 0;
            ctx.save();
            if (pulse > 0) this._forgeGlow(ctx, x, lineY, 86, '#ff8a3a', pulse, this._t || 0);
            const radius = compact ? 30 : 38;
            const swatch = compact ? 40 : 50;
            ctx.beginPath(); ctx.arc(x, lineY, radius, 0, TAU);
            ctx.fillStyle = hasItem ? 'rgba(76,45,24,0.98)' : reached ? 'rgba(42,29,25,0.96)' : 'rgba(11,9,15,0.92)'; ctx.fill();
            ctx.strokeStyle = hasItem ? '#5fd36a' : reached ? '#ffb257' : 'rgba(255,255,255,0.28)';
            ctx.lineWidth = hasItem ? 4 : 2.5; ctx.stroke();
            ctx.globalAlpha = reached || hasItem ? 1 : 0.48;
            this._cosmeticSwatch(ctx, item.category, item, x - swatch / 2, lineY - swatch / 2, swatch);
            ctx.restore();
            ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = hasItem ? '#77e584' : reached ? '#ffcc83' : 'rgba(255,255,255,0.58)';
            ctx.font = `800 16px ${FONT}`; ctx.fillText(`LV ${level}`, x, lineY + (compact ? 46 : 58));
            if (!compact) {
                ctx.fillStyle = 'rgba(255,245,228,0.72)'; ctx.font = `600 14px ${FONT}`;
                ctx.fillText(this._ellip(ctx, item.name, 220), x, lineY + 79);
            }
        }
    }

    _passRewardInfo(reward) {
        const parts = reward?.type === 'bundle' ? (reward.rewards || []) : [reward];
        const cosmeticReward = parts.find((part) => part?.type === 'cosmetic');
        const focus = cosmeticReward || parts[0] || null;
        const cosmetic = focus?.type === 'cosmetic' ? COSMETICS[focus.itemId] : null;
        const gear = focus?.type === 'gear' ? GEAR[focus.itemId] : null;
        const color = cosmetic ? rarityColor(cosmetic.rarity)
            : gear ? rarityColor(gear.rarity)
            : focus?.type === 'case' ? (focus.caseType === 'royal' ? '#ffd35a' : focus.caseType === 'mystic' ? '#b15cff' : '#c99a68')
            : '#ffd86b';
        return { parts, focus, cosmetic, gear, color };
    }

    _drawPassRewardIcon(ctx, info, cx, cy, size, bright = true) {
        const { focus, cosmetic, gear, color } = info;
        ctx.save(); ctx.globalAlpha = bright ? 1 : 0.48;
        if (cosmetic) {
            this._cosmeticSwatch(ctx, cosmetic.category, cosmetic, cx - size / 2, cy - size / 2, size);
        } else if (gear) {
            const emblem = getGearEmblem(gear.category);
            if (emblem) ctx.drawImage(emblem, cx - size / 2, cy - size / 2, size, size);
            else ctx.drawImage(getRarityIcon('shield', gear.rarity), cx - size / 2, cy - size / 2, size, size);
        } else if (focus?.type === 'case') {
            const art = getCaseArt(focus.caseType);
            if (art) ctx.drawImage(art, cx - size * 0.62, cy - size * 0.55, size * 1.24, size * 1.05);
            else {
                ctx.beginPath(); ctx.arc(cx, cy, size * 0.42, 0, TAU); ctx.fillStyle = color; ctx.fill();
            }
        } else {
            ctx.beginPath(); ctx.arc(cx, cy, size * 0.42, 0, TAU); ctx.fillStyle = 'rgba(255,216,107,0.18)'; ctx.fill();
            ctx.strokeStyle = '#ffd86b'; ctx.lineWidth = 3; ctx.stroke();
            ctx.fillStyle = '#ffd86b'; ctx.font = `800 ${Math.round(size * 0.54)}px ${FONT}`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('◎', cx, cy + 1);
        }
        ctx.restore();
    }

    _drawPassChapter(ctx, c, save, pass, prog, claimed, pending) {
        const anchor = pending[0] || (prog.atMax ? 46 : Math.min(BP_MAX_LEVEL, prog.level + 1));
        const start = Math.max(1, Math.min(46, Math.floor((anchor - 1) / 5) * 5 + 1));
        const trayX = c.x + 20;
        const trayY = Math.max(c.y + (c.h < 700 ? 315 : 420), c.y + c.h - 302);
        const trayW = c.w - 40, trayH = c.y + c.h - trayY - 20;
        roundRectPath(ctx, trayX, trayY, trayW, trayH, 16);
        ctx.fillStyle = 'rgba(7,6,10,0.9)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,154,74,0.35)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffcf91'; ctx.font = `800 18px ${HEAD}`;
        ctx.fillText(`REWARD CHAPTER  ·  LEVELS ${start}–${start + 4}`, trayX + 22, trayY + 27);
        const claimW = 260, claimH = 38;
        this._button(ctx, { x: trayX + trayW - claimW - 14, y: trayY + 8, w: claimW, h: claimH },
            pending.length ? `CLAIM ALL  ·  ${pending.length}` : 'ALL REACHED CLAIMED',
            { enabled: pending.length > 0, accent: '#6f3728', action: pending.length ? 'claimAllBP' : null, fontSize: 17 });

        const cols = 5, gap = 14, gridX = trayX + 14, gridY = trayY + 52;
        const cellW = (trayW - 28 - gap * (cols - 1)) / cols;
        const cellH = trayH - 66;
        const ownedCosmetics = save.cosmetics?.unlocked || [];
        for (let n = 0; n < cols; n++) {
            const level = start + n;
            if (level > BP_MAX_LEVEL) break;
            const x = gridX + n * (cellW + gap), y = gridY;
            const reached = level <= prog.level;
            const isClaimed = claimed.includes(level);
            const claimable = reached && !isClaimed;
            const entry = BATTLE_PASS_LEVELS[level - 1];
            const info = this._passRewardInfo(entry.reward);
            const special = entry.reward.special || level % 10 === 0 || level === BP_MAX_LEVEL;
            roundRectPath(ctx, x, y, cellW, cellH, 12);
            ctx.fillStyle = isClaimed ? 'rgba(24,50,34,0.94)' : claimable ? 'rgba(60,37,24,0.97)' : 'rgba(16,15,22,0.94)'; ctx.fill();
            ctx.strokeStyle = claimable ? '#ffb257' : isClaimed ? '#5fd36a' : special ? `${info.color}bb` : 'rgba(255,255,255,0.16)';
            ctx.lineWidth = claimable || special ? 3 : 2; ctx.stroke();
            if (claimable) this._selGlow(ctx, x, y, cellW, cellH, 12, '#ff8a3a', this._t || 0);

            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = special ? '#ffb257' : '#ffcf91'; ctx.font = `800 20px ${HEAD}`;
            ctx.fillText(`LV ${level}`, x + 14, y + 28);
            ctx.textAlign = 'right'; ctx.font = `800 12px ${FONT}`;
            ctx.fillStyle = claimable ? '#ffd07a' : isClaimed ? '#77e584' : 'rgba(255,255,255,0.45)';
            ctx.fillText(claimable ? 'READY' : isClaimed ? 'OWNED' : 'LOCKED', x + cellW - 14, y + 27);

            const iconSize = Math.max(42, Math.min(62, cellH - 114));
            const iconX = x + cellW / 2, iconY = y + 44 + iconSize / 2;
            this._drawPassRewardIcon(ctx, info, iconX, iconY, iconSize, reached || isClaimed);
            if (info.parts.length > 1) {
                ctx.beginPath(); ctx.arc(iconX + iconSize * 0.45, y + 50, 15, 0, TAU);
                ctx.fillStyle = '#ff8a3a'; ctx.fill();
                ctx.fillStyle = '#fff'; ctx.font = `800 12px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(`+${info.parts.length - 1}`, iconX + iconSize * 0.45, y + 51);
            }
            ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = info.color; ctx.font = `700 16px ${FONT}`;
            ctx.fillText(this._ellip(ctx, rewardLabel(entry.reward), cellW - 24), x + cellW / 2, y + cellH - 55);

            const button = { x: x + 12, y: y + cellH - 43, w: cellW - 24, h: 34 };
            if (claimable) {
                this._button(ctx, button, 'CLAIM REWARD', { accent: '#7a3e27', action: 'claimBP', arg: level, fontSize: 16 });
            } else if (isClaimed && info.cosmetic && ownedCosmetics.includes(info.cosmetic.id)) {
                const equipped = save.cosmetics?.equipped?.[info.cosmetic.category] === info.cosmetic.id;
                this._button(ctx, button, equipped ? 'EQUIPPED ✓' : 'EQUIP LOOK', {
                    enabled: !equipped, accent: '#2d5a3a', action: equipped ? null : 'equipCosmetic',
                    arg: { category: info.cosmetic.category, id: info.cosmetic.id }, fontSize: 15,
                });
            } else {
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillStyle = isClaimed ? '#77e584' : 'rgba(255,255,255,0.48)';
                ctx.font = `800 13px ${FONT}`;
                const remaining = Math.max(0, bpThreshold(level) - (pass.xp || 0));
                ctx.fillText(isClaimed ? '✓ CLAIMED' : `${remaining.toLocaleString()} XP TO REACH`,
                    button.x + button.w / 2, button.y + button.h / 2);
            }
        }
    }

    _drawVigilPath(ctx, state) {
        const c = this._contentRect();
        const save = state.saveData || {};
        const pass = save.battlePass || { xp: 0, claimed: [] };
        const claimed = Array.isArray(pass.claimed) ? pass.claimed : [];
        const prog = bpProgress(pass.xp || 0);
        const pending = [];
        for (let level = 1; level <= prog.level; level++) if (!claimed.includes(level)) pending.push(level);
        const ui = getMenuImages();
        this._drawPassBackdrop(ctx, c, ui);
        this._drawPassHeader(ctx, c, ui, prog, pending);
        this._drawPassReceipt(ctx, c, state.bpResult);
        this._drawPassMilestones(ctx, c, save, prog);
        this._drawPassChapter(ctx, c, save, pass, prog, claimed, pending);
    }

    // ── SETTINGS ─────────────────────────────────────────────────────────
    // Small grouped-section header for the SETTINGS columns: accent label +
    // a thin rule to its right. Returns the y where the section's rows start.
    _settingsHeader(ctx, x, w, y, label) {
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#9fb0c4'; ctx.font = `800 20px ${HEAD}`;
        ctx.fillText(label, x, y);
        const lw = ctx.measureText(label).width;
        ctx.strokeStyle = 'rgba(159,176,196,0.25)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + lw + 16, y - 7); ctx.lineTo(x + w, y - 7); ctx.stroke();
        return y + 22;
    }

    _phoneSettingsHeader(ctx, column, y, label, fontSize = 32) {
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#b8c7d8'; ctx.font = `800 ${fontSize}px ${HEAD}`;
        ctx.fillText(label, column.x, y);
        const lw = ctx.measureText(label).width;
        ctx.strokeStyle = 'rgba(184,199,216,0.34)'; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(column.x + lw + 16, y - 10);
        ctx.lineTo(column.x + column.w, y - 10);
        ctx.stroke();
    }

    _drawPhoneToggle(ctx, rect, toggle, value, layout) {
        roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 18);
        ctx.fillStyle = value ? 'rgba(40,92,61,0.52)' : 'rgba(20,25,34,0.72)'; ctx.fill();
        ctx.strokeStyle = value ? 'rgba(112,224,145,0.52)' : 'rgba(184,199,216,0.20)';
        ctx.lineWidth = 2; ctx.stroke();

        const switchW = layout.switchW, switchH = layout.switchH;
        const tr = {
            x: rect.x + rect.w - switchW - 4,
            y: rect.y + (rect.h - switchH) / 2,
            w: switchW,
            h: switchH,
        };
        const maxLabelW = tr.x - rect.x - 22;
        const lines = phoneToggleLabelLines(toggle);
        ctx.fillStyle = '#fff'; ctx.font = `700 ${layout.coreFontPx}px ${FONT}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const firstLineY = rect.y + rect.h / 2 - (lines.length - 1) * layout.coreLineHeight / 2;
        lines.forEach((line, i) => ctx.fillText(
            this._ellip(ctx, line, maxLabelW), rect.x + 14,
            firstLineY + i * layout.coreLineHeight));

        roundRectPath(ctx, tr.x, tr.y, tr.w, tr.h, tr.h / 2);
        ctx.fillStyle = value ? '#3ea65b' : '#505660'; ctx.fill();
        ctx.strokeStyle = value ? 'rgba(180,255,199,0.55)' : 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 2; ctx.stroke();
        const knobR = switchH / 2 - 12;
        const knobX = value ? tr.x + tr.w - tr.h / 2 : tr.x + tr.h / 2;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(knobX, tr.y + tr.h / 2, knobR, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.font = `800 ${layout.statusFontPx}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(value ? 'ON' : 'OFF', value ? tr.x + tr.h / 2 : tr.x + tr.w - tr.h / 2, tr.y + tr.h / 2 + 1);
        this._hot(rect.x, rect.y, rect.w, rect.h, 'toggleSetting', toggle.key, toggle.label);
    }

    _drawScaleChoice(ctx, rect, value, current, fontSize = 26) {
        const selected = value === current;
        roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 16);
        ctx.fillStyle = selected ? 'rgba(76,101,126,0.88)' : 'rgba(20,25,34,0.78)';
        ctx.fill();
        ctx.strokeStyle = selected ? '#fff0c2' : 'rgba(184,199,216,0.32)';
        ctx.lineWidth = selected ? 4 : 2;
        ctx.stroke();
        if (selected) {
            roundRectPath(ctx, rect.x + 7, rect.y + 7, rect.w - 14, rect.h - 14, 11);
            ctx.strokeStyle = 'rgba(255,240,194,0.55)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        const marker = selected ? '\u2713 ' : '';
        const label = `${marker}${value}%`;
        ctx.fillStyle = '#fff';
        this._fitFont(ctx, label, rect.w - 22, 800, fontSize);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
        this._hot(
            rect.x, rect.y, rect.w, rect.h, 'setUiScale', value,
            `Set combat HUD size to ${value} percent${selected ? ', selected' : ''}`,
        );
    }

    _drawAccessibilityToggle(ctx, rect, key, label, value) {
        roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 16);
        ctx.fillStyle = value ? 'rgba(40,92,61,0.46)' : 'rgba(20,25,34,0.72)';
        ctx.fill();
        ctx.strokeStyle = value ? 'rgba(112,224,145,0.55)' : 'rgba(184,199,216,0.24)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `700 26px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, rect.x + 22, rect.y + rect.h / 2);
        const tw = 100, th = 46;
        const tx = rect.x + rect.w - tw - 18;
        const ty = rect.y + (rect.h - th) / 2;
        roundRectPath(ctx, tx, ty, tw, th, th / 2);
        ctx.fillStyle = value ? '#3ea65b' : '#505660';
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(value ? tx + tw - th / 2 : tx + th / 2, ty + th / 2, th / 2 - 6, 0, TAU);
        ctx.fill();
        ctx.font = `800 17px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(value ? 'ON' : 'OFF', value ? tx + th / 2 : tx + tw - th / 2, ty + th / 2 + 1);
        this._hot(
            rect.x, rect.y, rect.w, rect.h, 'toggleSetting', key,
            label,
        );
    }

    _drawPreferenceChoice(ctx, rect, label, options = {}) {
        const selected = options.selected === true;
        roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 16);
        ctx.fillStyle = selected ? 'rgba(76,101,126,0.88)' : 'rgba(20,25,34,0.78)';
        ctx.fill();
        ctx.strokeStyle = selected ? '#fff0c2' : 'rgba(184,199,216,0.32)';
        ctx.lineWidth = selected ? 4 : 2;
        ctx.stroke();
        if (selected) {
            roundRectPath(ctx, rect.x + 7, rect.y + 7, rect.w - 14, rect.h - 14, 11);
            ctx.strokeStyle = 'rgba(255,240,194,0.55)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        const visible = `${selected ? '\u2713 ' : ''}${label}`;
        ctx.fillStyle = '#fff';
        this._fitFont(ctx, visible, rect.w - 22, 800, options.fontSize || 24);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(visible, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
        this._hot(
            rect.x, rect.y, rect.w, rect.h,
            options.action, options.arg,
            options.accessibleLabel || `${label}${selected ? ', selected' : ''}`,
        );
    }

    _drawPhoneAccessibility(ctx, state, c) {
        const settings = state.saveData?.settings || {};
        const layout = computePhoneAccessibilityLayout(c, {
            cssScale: (this.renderer.cssWidth || INTERNAL_WIDTH) / INTERNAL_WIDTH,
        });
        const currentScale = normalizeUiScale(settings.uiScale);
        const captionDetail = normalizeCaptionDetail(settings.captionDetail);
        const vibration = normalizeVibrationStrength(settings.vibration);

        this._phoneSettingsHeader(
            ctx, layout.columns.display, layout.headerY, 'READING & DISPLAY', layout.sectionFontPx,
        );
        this._phoneSettingsHeader(
            ctx, layout.columns.support, layout.headerY, 'AUDIO & FEEDBACK', layout.sectionFontPx,
        );
        this._drawPhoneToggle(
            ctx,
            layout.captionRow,
            { key: 'captions', label: 'Captions' },
            settings.captions === true,
            layout,
        );
        for (const choice of layout.detailButtons) {
            this._drawPreferenceChoice(ctx, choice, `DETAIL: ${choice.value.toUpperCase()}`, {
                selected: choice.value === captionDetail,
                action: 'setCaptionDetail', arg: choice.value,
                fontSize: layout.coreFontPx,
                accessibleLabel: `Set caption detail to ${choice.value}${choice.value === captionDetail ? ', selected' : ''}`,
            });
        }
        this._drawPhoneToggle(
            ctx,
            layout.contrastRow,
            { key: 'highContrast', label: 'High Contrast Warnings' },
            settings.highContrast === true,
            layout,
        );
        for (const choice of layout.scaleButtons) {
            this._drawPreferenceChoice(ctx, choice, `HUD ${choice.value}%`, {
                selected: choice.value === currentScale,
                action: 'setUiScale', arg: choice.value,
                fontSize: layout.coreFontPx,
                accessibleLabel: `Set combat HUD size to ${choice.value} percent${choice.value === currentScale ? ', selected' : ''}`,
            });
        }

        this._drawPhoneToggle(
            ctx,
            layout.monoRow,
            { key: 'monoAudio', label: 'Mono Audio' },
            settings.monoAudio === true,
            layout,
        );
        for (const choice of layout.vibrationButtons) {
            this._drawPreferenceChoice(ctx, choice, `VIB ${choice.value.toUpperCase()}`, {
                selected: choice.value === vibration,
                action: 'setVibration', arg: choice.value,
                fontSize: layout.coreFontPx,
                accessibleLabel: `Set vibration to ${choice.value}${choice.value === vibration ? ', selected' : ''}`,
            });
        }
        ctx.fillStyle = state.vibrationSupported ? '#85d9a0' : '#d8b16b';
        ctx.font = `700 ${layout.statusFontPx}px ${FONT}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(
            state.vibrationSupported ? 'TOUCH VIBRATION AVAILABLE' : 'SAVED CHOICE · UNAVAILABLE HERE',
            layout.columns.support.x,
            layout.bodyTop - 8,
        );

        this._button(ctx, layout.replay, 'REPLAY TUTORIAL', {
            accent: 'rgba(46,74,96,0.95)', action: 'replayTutorial', fontSize: layout.coreFontPx,
        });
        this._button(ctx, layout.back, 'BACK TO GENERAL', {
            accent: 'rgba(52,58,70,0.96)', action: 'settingsPane', arg: 'general',
            fontSize: layout.coreFontPx,
            accessibleLabel: 'Back to General settings',
        });
    }

    _drawAccessibilitySettings(ctx, state, c) {
        const settings = state.saveData?.settings || {};
        const currentScale = normalizeUiScale(settings.uiScale);
        const captionDetail = normalizeCaptionDetail(settings.captionDetail);
        const vibration = normalizeVibrationStrength(settings.vibration);
        const innerX = c.x + 40;
        const innerW = c.w - 80;
        const colGap = 56;
        const colW = (innerW - colGap) / 2;
        const rightX = innerX + colW + colGap;

        let y = this._settingsHeader(ctx, innerX, colW, c.y + 58, 'READING & DISPLAY');
        const captions = { x: innerX, y: y + 8, w: colW, h: 66 };
        this._drawAccessibilityToggle(ctx, captions, 'captions', 'Captions', settings.captions === true);

        y = this._settingsHeader(ctx, innerX, colW, captions.y + captions.h + 52, 'CAPTION DETAIL');
        const detailGap = 14;
        const detailW = (colW - detailGap) / 2;
        CAPTION_DETAIL_PRESETS.forEach((value, i) => this._drawPreferenceChoice(ctx, {
            x: innerX + i * (detailW + detailGap), y: y + 8, w: detailW, h: 66,
        }, value.toUpperCase(), {
            selected: value === captionDetail,
            action: 'setCaptionDetail', arg: value, fontSize: 24,
            accessibleLabel: `Set caption detail to ${value}${value === captionDetail ? ', selected' : ''}`,
        }));
        ctx.fillStyle = 'rgba(255,255,255,0.68)';
        ctx.font = `500 18px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('Essential covers dialogue and danger; Full adds world sounds.', innerX, y + 98);

        const contrastHeader = this._settingsHeader(ctx, innerX, colW, y + 124, 'VISUAL WARNINGS');
        const contrast = { x: innerX, y: contrastHeader + 8, w: colW, h: 66 };
        this._drawAccessibilityToggle(
            ctx, contrast, 'highContrast', 'High Contrast Warnings', settings.highContrast === true,
        );

        y = this._settingsHeader(ctx, innerX, colW, contrast.y + contrast.h + 52, 'COMBAT HUD SIZE');
        const gap = 14;
        const choiceW = (colW - gap * (UI_SCALE_PRESETS.length - 1)) / UI_SCALE_PRESETS.length;
        const choiceY = y + 8;
        for (let i = 0; i < UI_SCALE_PRESETS.length; i++) {
            const value = UI_SCALE_PRESETS[i];
            this._drawScaleChoice(ctx, {
                x: innerX + i * (choiceW + gap), y: choiceY, w: choiceW, h: 70,
            }, value, currentScale, 28);
        }

        let ry = this._settingsHeader(ctx, rightX, colW, c.y + 58, 'AUDIO & FEEDBACK');
        const mono = { x: rightX, y: ry + 8, w: colW, h: 66 };
        this._drawAccessibilityToggle(ctx, mono, 'monoAudio', 'Mono Audio', settings.monoAudio === true);

        ry = this._settingsHeader(ctx, rightX, colW, mono.y + mono.h + 52, 'VIBRATION');
        const vibGap = 14;
        const vibW = (colW - vibGap * 2) / 3;
        VIBRATION_STRENGTH_PRESETS.forEach((value, i) => this._drawPreferenceChoice(ctx, {
            x: rightX + i * (vibW + vibGap), y: ry + 8, w: vibW, h: 66,
        }, value.toUpperCase(), {
            selected: value === vibration,
            action: 'setVibration', arg: value, fontSize: 23,
            accessibleLabel: `Set vibration to ${value}${value === vibration ? ', selected' : ''}`,
        }));
        ctx.fillStyle = state.vibrationSupported ? '#85d9a0' : '#d8b16b';
        ctx.font = `600 18px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(
            state.vibrationSupported
                ? 'Touch vibration is available on this device.'
                : 'Unavailable in this browser. Your choice stays saved.',
            rightX, ry + 100,
        );

        ry = this._settingsHeader(ctx, rightX, colW, ry + 132, 'HELP & NAVIGATION');
        this._button(ctx, { x: rightX, y: ry + 8, w: colW, h: 66 }, 'REPLAY TUTORIAL', {
            accent: 'rgba(46,74,96,0.95)', action: 'replayTutorial', fontSize: 24,
        });
        this._button(ctx, { x: rightX, y: ry + 90, w: colW, h: 66 }, 'BACK TO GENERAL SETTINGS', {
            accent: 'rgba(52,58,70,0.96)', action: 'settingsPane', arg: 'general', fontSize: 24,
            accessibleLabel: 'Back to General settings',
        });
        ctx.fillStyle = 'rgba(255,255,255,0.68)';
        ctx.font = `500 18px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText('Escape also returns to General before leaving Settings.', rightX, ry + 192);
    }

    _drawPhoneSettings(ctx, state, c) {
        const save = state.saveData;
        const regular = SETTING_TOGGLES.filter((toggle) => !toggle.dev);
        const dev = SETTING_TOGGLES.filter((toggle) => toggle.dev && DEV_MODE);
        const toggleValue = (toggle) => toggle.key === 'unlockMaps'
            ? state.mapBypassActive === true
            : save.settings[toggle.key] === true;
        const layout = computePhoneSettingsLayout(c, {
            devToggleCount: dev.length,
            showCheats: DEV_MODE,
            cssScale: (this.renderer.cssWidth || INTERNAL_WIDTH) / INTERNAL_WIDTH,
        });

        this._phoneSettingsHeader(ctx, layout.columns.gameplay, layout.headerY, 'GAMEPLAY', layout.sectionFontPx);
        this._phoneSettingsHeader(ctx, layout.columns.audio, layout.headerY, 'AUDIO', layout.sectionFontPx);
        this._phoneSettingsHeader(ctx, layout.columns.support, layout.headerY, 'ACCESS & SAVE', layout.sectionFontPx);

        regular.forEach((toggle, i) => this._drawPhoneToggle(
            ctx, layout.gameplayRows[i], toggle, save.settings[toggle.key] === true, layout));

        const volumes = [
            { key: 'volMusic', label: 'Music Volume', short: 'MUSIC' },
            { key: 'volSfx', label: 'SFX Volume', short: 'SFX' },
            { key: 'volVoice', label: 'Voice Volume', short: 'VOICE' },
        ];
        volumes.forEach((volume, i) => {
            const block = layout.audioBlocks[i];
            const controls = layout.volumeControls[i];
            const value = typeof save.settings[volume.key] === 'number' ? save.settings[volume.key] : 0.7;
            roundRectPath(ctx, block.x, block.y, block.w, block.h, 18);
            ctx.fillStyle = 'rgba(20,25,34,0.66)'; ctx.fill();
            ctx.strokeStyle = 'rgba(184,199,216,0.20)'; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.font = `800 ${layout.coreFontPx}px ${HEAD}`;
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(this._ellip(ctx, volume.short, controls.label.w - 12),
                controls.label.x + 6, controls.label.y + controls.label.h / 2);
            this._button(ctx, controls.minus, '−', {
                action: 'volDown', arg: volume.key, fontSize: Math.max(48, layout.coreFontPx),
                accessibleLabel: `Decrease ${volume.label}`,
            });
            roundRectPath(ctx, controls.bar.x, controls.bar.y, controls.bar.w, controls.bar.h, 10);
            ctx.fillStyle = 'rgba(0,0,0,0.52)'; ctx.fill();
            roundRectPath(ctx, controls.bar.x, controls.bar.y, controls.bar.w * clamp01(value), controls.bar.h, 10);
            ctx.fillStyle = '#ffce54'; ctx.fill();
            this._button(ctx, controls.plus, '+', {
                action: 'volUp', arg: volume.key, fontSize: Math.max(48, layout.coreFontPx),
                accessibleLabel: `Increase ${volume.label}`,
            });
            ctx.fillStyle = '#fff'; ctx.font = `700 32px ${FONT}`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(`${Math.round(value * 100)}%`,
                controls.percent.x + controls.percent.w / 2,
                controls.percent.y + controls.percent.h / 2);
        });

        const accessibilityRect = layout.supportRows[0];
        this._button(ctx, accessibilityRect, 'DISPLAY OPTIONS', {
            accent: 'rgba(46,74,96,0.95)', action: 'settingsPane', arg: 'accessibility',
            fontSize: layout.coreFontPx,
            accessibleLabel: 'Open Accessibility and Display settings',
        });
        const resetRect = layout.supportRows[1];
        this._button(ctx, resetRect,
            state.resetConfirming ? 'CONFIRM RESET?' : 'RESET SAVE', {
                accent: state.resetConfirming ? '#7a2230' : 'rgba(80,30,38,0.92)',
                action: 'resetSave', fontSize: layout.coreFontPx,
            });
        dev.forEach((toggle, i) => this._drawPhoneToggle(
            ctx, layout.supportRows[i + 2], toggle, toggleValue(toggle), layout));

        if (DEV_MODE) {
            ctx.fillStyle = '#d4ad6f'; ctx.font = `800 26px ${HEAD}`;
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.fillText('CHEATS (TESTING)', layout.inner.x, layout.cheatHeaderY);
            const cheats = [
                { label: '+1,000 ◎', action: 'cheatCoins', arg: 1000 },
                { label: '+10,000 ◎', action: 'cheatCoins', arg: 10000 },
                { label: 'UNLOCK ALL ITEMS', action: 'cheatUnlockAll', arg: null },
            ];
            cheats.forEach((cheat, i) => this._button(ctx, layout.cheatButtons[i], cheat.label, {
                accent: '#5a3a22', action: cheat.action, arg: cheat.arg, fontSize: layout.coreFontPx,
            }));
        }
    }

    // ── SETTINGS — grouped option columns ────────────────────────────────
    // Two labelled columns (GAMEPLAY toggles | AUDIO + HELP) instead of one
    // undifferentiated stack, with the dev CHEATS strip across the bottom.
    // Every action/arg is unchanged — only the arrangement is new.
    _drawSettings(ctx, state) {
        const c = this._contentRect();
        const save = state.saveData;
        this._panel(ctx, c.x, c.y, c.w, c.h, null, undefined, { corners: true });
        const accessibilityPane = state.settingsPane === 'accessibility';
        if ((this.renderer.cssWidth ?? INTERNAL_WIDTH) < 900) {
            if (accessibilityPane) this._drawPhoneAccessibility(ctx, state, c);
            else this._drawPhoneSettings(ctx, state, c);
            return;
        }
        if (accessibilityPane) {
            this._drawAccessibilitySettings(ctx, state, c);
            return;
        }
        const innerX = c.x + 40;
        const innerW = c.w - 80;
        const colGap = 56;
        const colW = (innerW - colGap) / 2;
        const rightX = innerX + colW + colGap;

        // ── Left column: GAMEPLAY toggles ──
        let y = this._settingsHeader(ctx, innerX, colW, c.y + 48, 'GAMEPLAY');
        ctx.textBaseline = 'middle';
        for (const t of SETTING_TOGGLES) {
            // Testing controls are a strict `?dev=1` surface. Unlock All Maps
            // reads the transient QA session, never serialized settings.
            if (t.dev && !DEV_MODE) continue;
            const val = t.key === 'unlockMaps'
                ? state.mapBypassActive === true
                : save.settings[t.key] === true;
            ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = `600 26px ${FONT}`;
            ctx.fillText(t.label, innerX, y + 26);
            const tw = 92, th = 44;
            const tr = { x: innerX + colW - tw, y: y + 4, w: tw, h: th };
            roundRectPath(ctx, tr.x, tr.y, tr.w, tr.h, th / 2);
            ctx.fillStyle = val ? '#3ea65b' : 'rgba(80,86,96,0.9)'; ctx.fill();
            ctx.fillStyle = '#fff'; ctx.beginPath();
            ctx.arc(val ? tr.x + tw - th / 2 : tr.x + th / 2, tr.y + th / 2, th / 2 - 6, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `700 18px ${FONT}`;
            ctx.textAlign = 'center';
            ctx.fillText(val ? 'ON' : 'OFF', val ? tr.x + th / 2 : tr.x + tw - th / 2, tr.y + th / 2);
            this._hot(tr.x, tr.y, tr.w, tr.h, 'toggleSetting', t.key);
            y += 60;
        }

        // ── Right column: AUDIO sliders, then HELP ──
        let ry = this._settingsHeader(ctx, rightX, colW, c.y + 48, 'AUDIO');
        ctx.textBaseline = 'middle';
        for (const v of [
            { key: 'volMusic', label: 'Music Volume' },
            { key: 'volSfx', label: 'SFX Volume' },
            { key: 'volVoice', label: 'Voice Volume' },
        ]) {
            const val = typeof save.settings[v.key] === 'number' ? save.settings[v.key] : 0.7;
            ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = `600 26px ${FONT}`;
            ctx.fillText(v.label, rightX, ry + 26);
            const barX = rightX + colW - 360, barW = 240, barY = ry + 16;
            // minus
            const mr = { x: barX - 56, y: ry + 2, w: 44, h: 44 };
            this._button(ctx, mr, '−', {
                action: 'volDown', arg: v.key, fontSize: 30,
                accessibleLabel: `Decrease ${v.label}`,
            });
            roundRectPath(ctx, barX, barY, barW, 14, 7); ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill();
            roundRectPath(ctx, barX, barY, barW * clamp01(val), 14, 7); ctx.fillStyle = '#ffce54'; ctx.fill();
            const pr = { x: barX + barW + 12, y: ry + 2, w: 44, h: 44 };
            this._button(ctx, pr, '+', {
                action: 'volUp', arg: v.key, fontSize: 30,
                accessibleLabel: `Increase ${v.label}`,
            });
            ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `600 20px ${FONT}`;
            ctx.fillText(`${Math.round(val * 100)}%`, barX + barW + 64, ry + 24);
            ry += 60;
        }
        ctx.fillStyle = 'rgba(255,255,255,0.68)'; ctx.font = `500 18px ${FONT}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText('Music, effects and spoken lines each reach true silence.', rightX, ry + 20);
        ry += 56;

        // Accessibility has its own pane so the complete player preference
        // suite never crowds out General or the separate ?dev=1 controls.
        ry = this._settingsHeader(ctx, rightX, colW, ry + 24, 'HELP');
        this._button(ctx, { x: rightX, y: ry, w: 340, h: 52 }, 'ACCESSIBILITY & DISPLAY', {
            accent: 'rgba(46,74,96,0.9)', action: 'settingsPane', arg: 'accessibility', fontSize: 20,
            accessibleLabel: 'Open Accessibility and Display settings',
        });
        ctx.fillStyle = 'rgba(255,255,255,0.68)'; ctx.font = `500 17px ${FONT}`;
        ctx.textBaseline = 'alphabetic';
        this._wrapText(ctx, 'Captions, mono audio, vibration, contrast and HUD size.',
            rightX + 364 + (colW - 364) / 2, ry + 22, colW - 364, 22, 3);

        // ── SAVE — the full reset lives HERE (save management is settings;
        // it used to sit on the SKILLS rail, a tab it had nothing to do with).
        ry = this._settingsHeader(ctx, rightX, colW, ry + 92, 'SAVE');
        this._button(ctx, { x: rightX, y: ry, w: 340, h: 52 },
            state.resetConfirming ? 'TAP AGAIN TO CONFIRM' : 'RESET SAVE',
            { accent: state.resetConfirming ? '#7a2230' : 'rgba(80,30,38,0.8)', action: 'resetSave', fontSize: 20 });
        ctx.fillStyle = 'rgba(255,255,255,0.68)'; ctx.font = `500 17px ${FONT}`;
        ctx.textBaseline = 'alphabetic';
        this._wrapText(ctx, 'Erase everything and start over. Asks twice.',
            rightX + 364 + (colW - 364) / 2, ry + 22, colW - 364, 22, 3);

        // ── Cheats (testing) — full-width strip at the panel's foot ────────
        // Dev-only (?dev=1): hotspots only register when drawn, so hiding the
        // panel also disables the cheat actions for regular players.
        if (DEV_MODE) {
            const cbH = 56;
            let cy2 = this._settingsHeader(ctx, innerX, innerW, c.y + c.h - cbH - 60, 'CHEATS (TESTING)');
            const cheats = [
                { label: '+1,000 ◎', action: 'cheatCoins', arg: 1000 },
                { label: '+10,000 ◎', action: 'cheatCoins', arg: 10000 },
                { label: 'Unlock All Items', action: 'cheatUnlockAll', arg: null },
            ];
            const cbW = (innerW - 2 * 20) / 3;
            for (let i = 0; i < cheats.length; i++) {
                const ch = cheats[i];
                const r = { x: innerX + i * (cbW + 20), y: cy2, w: cbW, h: cbH };
                this._button(ctx, r, ch.label, { accent: '#5a3a22', action: ch.action, arg: ch.arg, fontSize: 22 });
            }
        }
    }

    // ── CASE OPENING OVERLAY ─────────────────────────────────────────────
    _drawCaseOverlay(ctx, anim, state) {
        const W = INTERNAL_WIDTH, H = INTERNAL_HEIGHT;
        const cx = W / 2, cy = H / 2;
        const t = anim.age;
        // The reveal fires AFTER a dead-air settle beat: the reel stops at
        // spinTime, holds its breath for settleHold, THEN the reveal bursts.
        const spinEnd = anim.reel ? (anim.spinTime ?? 2.6) : 0.85;
        const reveal = spinEnd + (anim.reel ? (anim.settleHold ?? 0) : 0);
        const result = anim.result;
        const col = result && result.rarity ? rarityColor(result.rarity) : '#ffce54';
        const tier = result && result.rarity && RARITIES[result.rarity] ? RARITIES[result.rarity].tier : 1;
        const revealAge = Math.max(0, t - reveal);
        const caseDef = CASES[anim.caseType];
        const vaultCol = rarityColor(caseTopRarity(anim.caseType));
        const settling = t >= spinEnd && t < reveal;
        // Overshoot ease gives the reel physical settling weight; final x is 1.
        const backOut = (x, s = 0.9) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);

        // Deep vault curtain: the shop remains faintly visible, but a central
        // light well and forged screen rim make the open feel like its own room.
        ctx.fillStyle = 'rgba(0,0,0,0.86)';
        ctx.fillRect(0, 0, W, H);
        const vault = ctx.createRadialGradient(cx, cy, 90, cx, cy, 780);
        vault.addColorStop(0, 'rgba(72,34,15,0.22)');
        vault.addColorStop(0.56, 'rgba(18,10,10,0.12)');
        vault.addColorStop(1, 'rgba(0,0,0,0.56)');
        ctx.fillStyle = vault; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(255,144,66,0.18)'; ctx.lineWidth = 2;
        ctx.strokeRect(18, 18, W - 36, H - 36);
        ctx.strokeStyle = 'rgba(255,218,154,0.08)'; ctx.lineWidth = 1;
        ctx.strokeRect(26, 26, W - 52, H - 52);

        // High-tier reveals physically SHAKE the overlay (decays over ~0.4s).
        let shx = 0, shy = 0;
        if (t >= reveal && tier >= 3) {
            const s = Math.max(0, 1 - revealAge / 0.4) * (tier - 2) * 6;
            shx = (Math.random() * 2 - 1) * s; shy = (Math.random() * 2 - 1) * s;
        }
        ctx.save();
        ctx.translate(shx, shy);

        if (t < reveal && anim.reel) {
            // ── SPIN: a framed reel tray of real item cards ──
            const cellW = 184, cellH = 190, gap = 14, stride = cellW + gap;
            const p = clamp01(t / spinEnd);   // p=1 through the settle hold
            // The awarded cell settles exactly under the marker. Anticipation
            // comes from honest deceleration, never a manufactured near miss.
            const offset = backOut(p) * anim.landingIndex * stride;
            const bandY = cy - cellH / 2 + 18;
            // Tray frame (vault label, glass band, hot floor and progress rail).
            const trayX = 40, trayW = W - 80;
            const trayY = bandY - 104, trayH = cellH + 178;
            roundRectPath(ctx, trayX, trayY, trayW, trayH, 24);
            const trayG = ctx.createLinearGradient(0, trayY, 0, trayY + trayH);
            trayG.addColorStop(0, 'rgba(21,15,14,0.98)'); trayG.addColorStop(0.52, 'rgba(8,8,10,0.98)'); trayG.addColorStop(1, 'rgba(22,12,9,0.98)');
            ctx.fillStyle = trayG; ctx.fill();
            ctx.strokeStyle = 'rgba(255,150,70,0.40)'; ctx.lineWidth = 2; ctx.stroke();
            roundRectPath(ctx, trayX + 7, trayY + 7, trayW - 14, trayH - 14, 19);
            ctx.strokeStyle = 'rgba(255,224,176,0.08)'; ctx.lineWidth = 1; ctx.stroke();
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            this._ember(ctx, cx, bandY + cellH + 36, 360, '#ff7a1e', 0.10 + p * 0.10);
            ctx.restore(); ctx.globalAlpha = 1;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = vaultCol; ctx.font = `800 12px ${FONT}`;
            const vaultLabel = caseDef?.poolKind === 'cosmetic' ? 'COSMETIC VAULT' : 'ARMORY VAULT';
            ctx.fillText(`${vaultLabel}  •  UNSEALING`, cx, trayY + 24);
            ctx.fillStyle = '#ffe2bd';
            this._fitFont(ctx, (caseDef?.name || 'CASE').toUpperCase(), 520, 700, 28);
            ctx.fillText((caseDef?.name || 'CASE').toUpperCase(), cx, trayY + 52);
            // The case's own chest art flanks its name (which box you're opening).
            const trayChest = getCaseArt(anim.caseType);
            if (trayChest) {
                const nW = ctx.measureText((caseDef?.name || 'CASE').toUpperCase()).width;
                ctx.drawImage(trayChest, cx - nW / 2 - 62, trayY + 27, 50, 50);
                ctx.drawImage(trayChest, cx + nW / 2 + 12, trayY + 27, 50, 50);
            }
            const progW = 430, progH = 4, progX = cx - progW / 2, progY = trayY + 76;
            ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(progX, progY, progW, progH);
            const progG = ctx.createLinearGradient(progX, 0, progX + progW, 0);
            progG.addColorStop(0, '#8b3017'); progG.addColorStop(0.72, '#ff8a32'); progG.addColorStop(1, '#ffe0a0');
            ctx.fillStyle = progG; ctx.fillRect(progX, progY, progW * p, progH);
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            this._ember(ctx, progX + progW * p, progY + 2, 18, '#ffd47d', 0.22 + p * 0.20);
            ctx.restore(); ctx.globalAlpha = 1;
            // Cells (clipped to the tray).
            ctx.save();
            ctx.beginPath(); ctx.rect(trayX + 10, bandY - 10, trayW - 20, cellH + 20); ctx.clip();
            for (let i = 0; i < anim.reel.length; i++) {
                const cellX = cx - offset + i * stride - cellW / 2;
                if (cellX > W + cellW || cellX < -cellW) continue;
                const cell = anim.reel[i];
                const cc = rarityColor(cell.rarity);
                const ctier = RARITIES[cell.rarity] ? RARITIES[cell.rarity].tier : 1;
                const near = 1 - Math.min(1, Math.abs(cellX + cellW / 2 - cx) / (stride * 0.6));
                const cardY = bandY - near * 7;
                ctx.globalAlpha = 0.68 + near * 0.32;
                // Near-centre glow so the passing cards feel lit by the marker.
                if (near > 0.25) {
                    ctx.save(); ctx.globalCompositeOperation = 'lighter';
                    ctx.globalAlpha = (near - 0.25) * 0.5;
                    ctx.drawImage(getGlowSprite(cc), cellX - 18, cardY - 18, cellW + 36, cellH + 36);
                    ctx.restore(); ctx.globalAlpha = 0.68 + near * 0.32;
                }
                // Rarity-tinted glass card.
                roundRectPath(ctx, cellX, cardY, cellW, cellH, 14);
                const cg = ctx.createLinearGradient(0, cardY, 0, cardY + cellH);
                cg.addColorStop(0, 'rgba(30,26,24,0.96)'); cg.addColorStop(1, 'rgba(16,13,12,0.96)');
                ctx.fillStyle = cg; ctx.fill();
                ctx.save(); ctx.globalAlpha = 0.14 + near * 0.10;
                roundRectPath(ctx, cellX, cardY, cellW, cellH, 14);
                ctx.fillStyle = cc; ctx.fill(); ctx.restore();
                ctx.globalAlpha = 0.68 + near * 0.32;
                roundRectPath(ctx, cellX, cardY, cellW, cellH, 14);
                ctx.strokeStyle = cc; ctx.lineWidth = 2.5 + near * 2.5; ctx.stroke();
                // The item's face: gear emblem art / cosmetic category medallion.
                this._itemFace(ctx, cellX + cellW / 2, cardY + 66, 40, cell);
                // Name (auto-fit) + rarity pips.
                ctx.fillStyle = '#fff';
                this._fitFont(ctx, cell.name, cellW - 22, 700, 18, FONT, 12);
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(cell.name, cellX + cellW / 2, cardY + cellH - 48);
                this._tierPips(ctx, cellX + cellW / 2, cardY + cellH - 26, ctier, cc);
                // CS-style rarity strip along the card's BOTTOM edge — the loot
                // grammar players already know: colour = quality, at a glance.
                ctx.save();
                roundRectPath(ctx, cellX, cardY, cellW, cellH, 14); ctx.clip();
                ctx.fillStyle = cc;
                ctx.fillRect(cellX, cardY + cellH - 8, cellW, 8);
                ctx.restore();
                ctx.globalAlpha = 1;
            }
            ctx.restore();
            // Edge fades so the strip melts into the tray instead of hard-cutting.
            const fadeW = 130;
            for (const side of [0, 1]) {
                const fx = side === 0 ? trayX + 10 : trayX + trayW - 10 - fadeW;
                const fg = ctx.createLinearGradient(fx, 0, fx + fadeW, 0);
                fg.addColorStop(side === 0 ? 0 : 1, 'rgba(12,9,8,0.95)');
                fg.addColorStop(side === 0 ? 1 : 0, 'rgba(12,9,8,0)');
                ctx.fillStyle = fg; ctx.fillRect(fx, bandY - 10, fadeW, cellH + 20);
            }
            // Forged rails bracket the moving strip and hide card lift at the edge.
            const railG = ctx.createLinearGradient(trayX + 20, 0, trayX + trayW - 20, 0);
            railG.addColorStop(0, 'rgba(255,134,54,0)'); railG.addColorStop(0.18, 'rgba(255,165,78,0.42)');
            railG.addColorStop(0.5, 'rgba(255,224,166,0.62)'); railG.addColorStop(0.82, 'rgba(255,165,78,0.42)'); railG.addColorStop(1, 'rgba(255,134,54,0)');
            ctx.fillStyle = railG;
            ctx.fillRect(trayX + 20, bandY - 12, trayW - 40, 2);
            ctx.fillRect(trayX + 20, bandY + cellH + 10, trayW - 40, 2);
            // Ember needle marker: glow + gradient line + arrows, brightening
            // as the reel slows toward the win.
            const mk = 0.6 + 0.4 * p;
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            this._ember(ctx, cx, cy, 90 + p * 40, '#ffb04a', 0.20 + p * 0.20);
            ctx.restore(); ctx.globalAlpha = 1;
            const ng = ctx.createLinearGradient(0, bandY - 18, 0, bandY + cellH + 18);
            ng.addColorStop(0, 'rgba(255,216,107,0)'); ng.addColorStop(0.5, '#ffd86b'); ng.addColorStop(1, 'rgba(255,216,107,0)');
            ctx.strokeStyle = ng; ctx.globalAlpha = mk; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(cx, bandY - 16); ctx.lineTo(cx, bandY + cellH + 16); ctx.stroke();
            ctx.fillStyle = '#ffd86b';
            ctx.beginPath(); ctx.moveTo(cx - 13, bandY - 18); ctx.lineTo(cx + 13, bandY - 18); ctx.lineTo(cx, bandY - 2); ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.moveTo(cx - 13, bandY + cellH + 18); ctx.lineTo(cx + 13, bandY + cellH + 18); ctx.lineTo(cx, bandY + cellH + 2); ctx.closePath(); ctx.fill();
            ctx.globalAlpha = 1;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const settlePulse = 0.68 + 0.32 * Math.sin(t * 9);
            ctx.fillStyle = settling ? `rgba(255,216,107,${settlePulse})` : 'rgba(255,255,255,0.58)';
            ctx.font = `700 15px ${FONT}`;
            ctx.fillText(settling ? 'EMBER LOCKED  •  REVEALING…' : 'TAP TO SKIP  •  HOLD FOR THE REVEAL', cx, bandY + cellH + 50);
        } else if (result) {
            // ── REVEAL: spectacle scaled by rarity tier ──
            const k = easeOutCubic(clamp01(revealAge / 0.4));
            // (1) Full-screen flash — brighter/whiter the rarer the pull.
            const flash = Math.max(0, 1 - revealAge / (0.22 + tier * 0.06));
            if (flash > 0) {
                ctx.save(); ctx.globalAlpha = flash * (0.18 + tier * 0.1);
                ctx.fillStyle = tier >= 4 ? '#ffffff' : col; ctx.fillRect(0, 0, W, H); ctx.restore();
            }
            // (2) Rotating vault rays. Every reward gets a restrained ceremony;
            // Epic+ simply widens and brightens it instead of being the first
            // tier that looks intentionally designed.
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = (0.016 + tier * 0.016) * k;
            ctx.translate(cx, cy); ctx.rotate(revealAge * (0.18 + tier * 0.025)); ctx.fillStyle = col;
            const rays = 8 + tier;
            const rayHalf = 12 + tier * 3;
            for (let i = 0; i < rays; i++) {
                ctx.rotate(TAU / rays);
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(620, -rayHalf); ctx.lineTo(620, rayHalf); ctx.closePath(); ctx.fill();
            }
            ctx.restore();
            // (3) Radial glow bloom.
            const g = ctx.createRadialGradient(cx, cy, 30, cx, cy, 430);
            g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.save(); ctx.globalAlpha = 0.26 + tier * 0.045; ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 430, 0, TAU); ctx.fill(); ctx.restore();
            // (4) Expanding shock ring.
            const ring = revealAge / 0.6;
            if (ring < 1) {
                ctx.save(); ctx.globalAlpha = (1 - ring) * 0.8; ctx.strokeStyle = col;
                ctx.lineWidth = 2 + (1 - ring) * 7;
                ctx.beginPath(); ctx.arc(cx, cy, 70 + ring * 460, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
            }
            // (5) Spark burst — count + reach scale with tier.
            const nSpark = 6 + tier * 6;
            const sp = easeOutCubic(clamp01(revealAge / 0.7));
            ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = col;
            for (let i = 0; i < nSpark; i++) {
                const a = (i / nSpark) * Math.PI * 2 + tier;
                const dist = sp * (170 + tier * 45);
                const sr = (1 - sp) * (5 + tier);
                if (sr <= 0.5) continue;
                const sxp = cx + Math.cos(a) * dist, syp = cy + Math.sin(a) * dist;
                ctx.globalAlpha = (1 - sp) * 0.9;
                ctx.beginPath();
                ctx.moveTo(sxp, syp - sr); ctx.lineTo(sxp + sr * 0.4, syp); ctx.lineTo(sxp, syp + sr);
                ctx.lineTo(sxp - sr * 0.4, syp); ctx.closePath(); ctx.fill();
            }
            ctx.restore();
            // A persistent orbit of tiny vault runes keeps the reveal alive after
            // the one-shot spark burst has faded.
            ctx.save(); ctx.translate(cx, cy); ctx.rotate(revealAge * 0.22);
            ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = col;
            for (let i = 0; i < 10; i++) {
                const a = i * TAU / 10;
                const rr = 285 + Math.sin(revealAge * 1.7 + i) * 9;
                const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
                ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 4);
                ctx.globalAlpha = (0.10 + tier * 0.025) * k;
                ctx.fillRect(-3, -3, 6, 6); ctx.restore();
            }
            ctx.restore();

            // (6) The prize dossier — pops in with a bouncy overshoot.
            const ks = backOut(clamp01(revealAge / 0.45), 1.4);
            const baseCardW = 560, baseCardH = 370;
            const cardW = baseCardW * ks, cardH = baseCardH * ks;
            const cardX = cx - cardW / 2, cardY = cy - cardH / 2;
            roundRectPath(ctx, cardX, cardY, cardW, cardH, 20);
            const cardG = ctx.createLinearGradient(0, cardY, 0, cardY + cardH);
            cardG.addColorStop(0, 'rgba(31,25,24,0.99)'); cardG.addColorStop(0.55, 'rgba(14,12,13,0.99)'); cardG.addColorStop(1, 'rgba(22,14,13,0.99)');
            ctx.fillStyle = cardG; ctx.fill();
            ctx.strokeStyle = col; ctx.lineWidth = 4 + tier; ctx.stroke();
            roundRectPath(ctx, cardX + 9, cardY + 9, cardW - 18, cardH - 18, 14);
            ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.save(); roundRectPath(ctx, cardX, cardY, cardW, cardH, 20); ctx.clip();
            ctx.fillStyle = col; ctx.globalAlpha = 0.80; ctx.fillRect(cardX, cardY, cardW, 7);
            const sheen = ctx.createLinearGradient(cardX, 0, cardX + cardW, 0);
            sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0.08)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = sheen; ctx.fillRect(cardX, cardY + 7, cardW, 54); ctx.restore();
            if (k > 0.55) {
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                const isItem = result.kind === 'gear' || result.kind === 'cosmetic';
                const kindLabel = result.kind === 'gear' ? 'GEAR UNLOCK'
                    : result.kind === 'cosmetic' ? 'COSMETIC UNLOCK'
                    : result.kind === 'duplicate' ? 'DUPLICATE CONVERSION'
                    : result.kind === 'bpxp' ? 'VIGIL XP' : 'COIN CACHE';
                // One decisive line above the dossier; pity upgrades the copy.
                ctx.fillStyle = result.pity ? '#ffd86b' : 'rgba(255,232,203,0.72)';
                ctx.font = `800 ${result.pity ? 18 : 15}px ${FONT}`;
                ctx.fillText(result.pity ? '✦ BAD-LUCK GUARANTEE — YOU PULLED ✦' : `${(caseDef?.name || 'CASE').toUpperCase()}  •  YOU PULLED`, cx, cardY - 28);
                ctx.textAlign = 'left';
                ctx.fillStyle = col; ctx.font = `800 11px ${FONT}`;
                ctx.fillText(kindLabel, cardX + 24, cardY + 29);
                ctx.textAlign = 'center';
                // The item's face in a rarity medallion.
                ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5;
                ctx.drawImage(getGlowSprite(col), cx - 74, cy - 186, 148, 148);
                ctx.restore(); ctx.globalAlpha = 1;
                ctx.beginPath(); ctx.arc(cx, cy - 112, 50, 0, TAU);
                ctx.fillStyle = 'rgba(10,8,7,0.9)'; ctx.fill();
                ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke();
                this._itemFace(ctx, cx, cy - 112, 34, result);
                // Rarity word + tier pips.
                ctx.fillStyle = col; ctx.font = `800 29px ${HEAD}`;
                ctx.fillText(rarityName(result.rarity).toUpperCase(), cx, cy - 43);
                this._tierPips(ctx, cx, cy - 18, tier, col);
                // Name.
                const displayName = result.kind === 'duplicate' ? result.name : (result.name || result.label || 'Reward');
                ctx.fillStyle = '#fff8ea';
                this._fitFont(ctx, displayName, baseCardW - 70, 800, 38, HEAD, 21);
                ctx.fillText(displayName, cx, cy + 25);
                // What it IS: the item's own card text (wrapped, muted).
                if (result.description) {
                    ctx.fillStyle = 'rgba(235,240,248,0.7)'; ctx.font = `500 16px ${FONT}`;
                    const lines = this._wrapLines(ctx, result.description, baseCardW - 90, 2);
                    lines.forEach((ln, i) => ctx.fillText(ln, cx, cy + 57 + i * 21));
                }
                const stateY = result.description ? cy + 112 : cy + 72;
                if (isItem) {
                    ctx.fillStyle = '#5fe87a'; ctx.font = `800 23px ${FONT}`;
                    ctx.fillText('★ NEW — ADDED TO YOUR COLLECTION ★', cx, stateY);
                } else if (result.kind === 'duplicate') {
                    ctx.fillStyle = '#ffd86b'; ctx.font = `700 23px ${FONT}`;
                    ctx.fillText(`DUPLICATE → +${result.amount} ◎`, cx, stateY);
                    if (result.dupeTotal) {
                        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `600 15px ${FONT}`;
                        ctx.fillText(`${result.dupeTotal} ◎ earned from duplicates`, cx, stateY + 26);
                    }
                } else {
                    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = `700 23px ${FONT}`;
                    ctx.fillText(result.label, cx, stateY);
                }
                // OPEN ANOTHER — the instant re-roll loop. Drawn only when this
                // case is known + affordable; taps route through caseInput(pos)
                // (the overlay owns input), so the rect is stamped on the anim.
                const coins = state?.saveData?.totalCoins ?? 0;
                anim._againRect = null;
                if (caseDef && coins >= caseDef.cost && revealAge > 0.5) {
                    const againW = 340, closeW = 190, bh = 58, btnGap = 14;
                    const totalW = againW + closeW + btnGap;
                    const bx = cx - totalW / 2, by = cy + baseCardH / 2 + 26;
                    roundRectPath(ctx, bx, by, againW, bh, 13);
                    const bg2 = ctx.createLinearGradient(bx, by, bx, by + bh);
                    bg2.addColorStop(0, '#b64b20'); bg2.addColorStop(1, '#712214');
                    ctx.fillStyle = bg2; ctx.fill();
                    ctx.strokeStyle = '#ffb562'; ctx.lineWidth = 2; ctx.stroke();
                    this._emberRim(ctx, bx + 8, by, againW - 16, bh, this._t || 0, 5.2);
                    ctx.fillStyle = '#fff8e9'; ctx.font = `800 19px ${FONT}`;
                    ctx.fillText(`OPEN AGAIN  •  ◎ ${caseDef.cost}`, bx + againW / 2, by + bh / 2 + 1);
                    anim._againRect = { x: bx, y: by, w: againW, h: bh };

                    const closeX = bx + againW + btnGap;
                    roundRectPath(ctx, closeX, by, closeW, bh, 13);
                    ctx.fillStyle = 'rgba(29,25,26,0.96)'; ctx.fill();
                    ctx.strokeStyle = 'rgba(255,255,255,0.24)'; ctx.lineWidth = 1.5; ctx.stroke();
                    ctx.fillStyle = 'rgba(255,244,228,0.86)'; ctx.font = `800 17px ${FONT}`;
                    ctx.fillText('CONTINUE', closeX + closeW / 2, by + bh / 2 + 1);
                    ctx.fillStyle = 'rgba(255,255,255,0.46)'; ctx.font = `700 13px ${FONT}`;
                    ctx.fillText(`BALANCE  ◎ ${coins}`, cx, by + bh + 28);
                } else {
                    const bw = 230, bh = 58, bx = cx - bw / 2, by = cy + baseCardH / 2 + 26;
                    roundRectPath(ctx, bx, by, bw, bh, 13);
                    ctx.fillStyle = 'rgba(31,27,28,0.96)'; ctx.fill();
                    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.5; ctx.stroke();
                    ctx.fillStyle = '#fff2de'; ctx.font = `800 18px ${FONT}`;
                    ctx.fillText('CONTINUE', cx, by + bh / 2 + 1);
                }
            }
        }
        ctx.restore();  // shake
        this._hot(0, 0, W, H, 'caseContinue', null);
    }

    // Greedy word-wrap capped to maxLines (last line ellipsized if it overflows).
    _wrapLines(ctx, text, maxW, maxLines = 2) {
        const words = String(text).split(/\s+/);
        const lines = [];
        let cur = '';
        for (const w of words) {
            const tryLine = cur ? cur + ' ' + w : w;
            if (ctx.measureText(tryLine).width <= maxW || !cur) cur = tryLine;
            else {
                lines.push(cur); cur = w;
                if (lines.length === maxLines - 1) break;
            }
        }
        const used = lines.join(' ');
        const rest = String(text).slice(used.length).trim();
        if (rest) lines.push(this._ellip(ctx, rest, maxW));
        return lines.slice(0, maxLines);
    }

    // A row of `tier` rarity pips (filled) against the 6-tier ladder (hollow).
    _tierPips(ctx, cx, cy, tier, color) {
        const n = 6, r = 4, gap = 14;
        const x0 = cx - ((n - 1) * gap) / 2;
        for (let i = 0; i < n; i++) {
            ctx.beginPath(); ctx.arc(x0 + i * gap, cy, r, 0, TAU);
            if (i < tier) { ctx.fillStyle = color; ctx.fill(); }
            else { ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5; ctx.stroke(); }
        }
    }

    // The face of a reel/reveal item: gear draws its category EMBLEM art (the
    // same art the loadout cards use), while cosmetics resolve the catalog id
    // and draw the actual silhouette/effect used by Collection and Boutique.
    // Anything else falls back to the kind glyph in a rarity disc.
    _itemFace(ctx, cx, cy, s, item) {
        const cc = rarityColor(item.rarity || 'common');
        if (item.kind === 'gear' && item.category) {
            const emblem = getGearEmblem(item.category);
            if (emblem) { ctx.drawImage(emblem, cx - s, cy - s, s * 2, s * 2); return; }
        }
        if (item.kind === 'cosmetic') {
            // Reel cells now carry the catalog id. Draw the same real silhouette/
            // effect used by Collection and Boutique instead of a category badge.
            const cosmetic = COSMETICS[item.id] || item;
            if (cosmetic.category) {
                ctx.save();
                this._cosmeticSwatch(ctx, cosmetic.category, cosmetic,
                    cx - s, cy - s, s * 2);
                ctx.restore();
                return;
            }
            ctx.beginPath(); ctx.arc(cx, cy, s * 0.78, 0, TAU);
            ctx.fillStyle = item.color || cc; ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2.5; ctx.stroke();
            this._kindGlyph(ctx, cx, cy, s * 0.42, 'cosmetic');
            return;
        }
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.78, 0, TAU);
        ctx.fillStyle = cc; ctx.fill();
        this._kindGlyph(ctx, cx, cy, s * 0.5, item.kind);
    }

    // A small white logo marking what KIND of loot a reel cell / reveal is:
    // gear = a shield, cosmetic = a sparkle star, anything else = a coin ring.
    _kindGlyph(ctx, cx, cy, s, kind) {
        ctx.save();
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#fff';
        if (kind === 'gear') {
            // Shield.
            ctx.beginPath();
            ctx.moveTo(cx, cy - s);
            ctx.lineTo(cx + s * 0.8, cy - s * 0.5);
            ctx.lineTo(cx + s * 0.8, cy + s * 0.2);
            ctx.quadraticCurveTo(cx + s * 0.8, cy + s, cx, cy + s);
            ctx.quadraticCurveTo(cx - s * 0.8, cy + s, cx - s * 0.8, cy + s * 0.2);
            ctx.lineTo(cx - s * 0.8, cy - s * 0.5);
            ctx.closePath();
            ctx.fill();
        } else if (kind === 'cosmetic') {
            // Four-point sparkle.
            ctx.beginPath();
            ctx.moveTo(cx, cy - s);
            ctx.quadraticCurveTo(cx + s * 0.18, cy - s * 0.18, cx + s, cy);
            ctx.quadraticCurveTo(cx + s * 0.18, cy + s * 0.18, cx, cy + s);
            ctx.quadraticCurveTo(cx - s * 0.18, cy + s * 0.18, cx - s, cy);
            ctx.quadraticCurveTo(cx - s * 0.18, cy - s * 0.18, cx, cy - s);
            ctx.closePath();
            ctx.fill();
        } else {
            // Coin ring (coins / vigil-XP consolation).
            ctx.lineWidth = Math.max(2, s * 0.28);
            ctx.beginPath();
            ctx.arc(cx, cy, s * 0.8, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }
}
