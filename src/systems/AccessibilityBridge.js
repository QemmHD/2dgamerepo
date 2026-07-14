// AccessibilityBridge keeps the Canvas game compatible with assistive
// technology without creating a second, divergent DOM menu. The canvas remains
// the only gameplay surface; this bridge supplies its semantic name, a polite
// live-status channel, and stable names/keys for the existing hotspot router.

import { normalizeUiScale } from './AccessibilityPreferences.js';
import { runObjectiveAccessibilityText } from './RunObjectiveDirector.js';

const TAB_LABELS = Object.freeze({
    home: 'Home',
    play: 'Run setup',
    modes: 'Modes',
    skills: 'Upgrades',
    attune: 'Attunement',
    loadout: 'Loadout',
    character: 'Character',
    shop: 'Shop',
    boutique: 'Boutique',
    battlepass: 'Battle Pass',
    stats: 'Chronicle',
    settings: 'Settings',
});

const SETTING_LABELS = Object.freeze({
    screenShake: 'Screen shake',
    damageNumbers: 'Damage numbers',
    particles: 'Particles',
    reducedEffects: 'Reduce motion and effects',
    uiScale: 'Combat HUD size',
    highContrast: 'High contrast warnings',
    captions: 'Captions',
    captionDetail: 'Caption detail',
    monoAudio: 'Mono audio',
    vibration: 'Vibration',
    volMusic: 'Music volume',
    volSfx: 'Sound effects volume',
    volVoice: 'Voice volume',
});

function cleanText(value, fallback = 'Menu action') {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return (text || fallback).slice(0, 240);
}

export function objectiveDescription(snapshot) {
    return snapshot ? cleanText(runObjectiveAccessibilityText(snapshot), '') : '';
}

function stableValue(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
    if (typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${key}:${stableValue(value[key])}`).join(',')}}`;
    }
    return String(value);
}

function words(value) {
    return String(value || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function menuHotspotKey(action, arg, occurrence = 0) {
    const base = `${String(action || 'action')}:${stableValue(arg)}`;
    return `${base}#${Math.max(0, Math.floor(Number(occurrence) || 0))}`;
}

export function menuHotspotLabel(action, arg, explicitLabel = '') {
    if (explicitLabel) return cleanText(explicitLabel);
    const id = arg && typeof arg === 'object' ? (arg.id ?? arg.category ?? '') : arg;
    switch (action) {
        case 'tab': return `Open ${TAB_LABELS[id] || words(id) || 'section'}`;
        case 'startRun': return 'Start standard run';
        case 'startDaily': return 'Start Daily Road';
        case 'startRiteTrial': return 'Start Rite Trial';
        case 'startBossRush': return 'Start Boss Rush';
        case 'startWeeklyEmber': return 'Start Weekly Ember';
        case 'setDifficulty': return `Set difficulty to ${words(id)}`;
        case 'toggleModifier': return `Toggle trial modifier ${words(id)}`;
        case 'selectPatron': return `Select patron ${words(id)}`;
        case 'selectCharacter': return `Select hero ${words(id)}`;
        case 'selectMap': return `Select map ${words(id)}`;
        case 'collectionCategory': return `Show ${words(id)} cosmetics`;
        case 'collectionOwnership': return `Filter collection to ${words(id)}`;
        case 'collectionSource': return `Filter collection source to ${words(id)}`;
        case 'collectionPage': return `Open collection page ${id}`;
        case 'boutiqueCategory': return `Show ${words(id)} Boutique stock`;
        case 'boutiquePage': return `Open Boutique stock page ${id}`;
        case 'boutiqueSetPage': return `Open Boutique set page ${id}`;
        case 'setUiScale': return `Set combat HUD size to ${normalizeUiScale(id)} percent`;
        case 'setCaptionDetail': return `Set caption detail to ${words(id)}`;
        case 'setVibration': return `Set vibration to ${words(id)}`;
        case 'toggleSetting': return `Toggle ${SETTING_LABELS[id] || words(id)}`;
        case 'volUp': return `Increase ${SETTING_LABELS[id] || words(id)}`;
        case 'volDown': return `Decrease ${SETTING_LABELS[id] || words(id)}`;
        case 'openCase': return `Open ${words(id)} case`;
        case 'openMines': return `Play Mines with a ${Number(id).toLocaleString()} coin stake`;
        case 'buyUpgrade': return `Buy ${words(id)} upgrade`;
        case 'claimBP': return `Claim Battle Pass level ${id}`;
        case 'claimAllBP': return 'Claim all reached Battle Pass rewards';
        case 'resetSave': return 'Reset save data';
        case 'replayTutorial': return 'Replay tutorial';
        case 'tourNext': return 'Next tutorial step';
        case 'tourSkip': return 'Skip tutorial';
        case 'caseContinue': return 'Continue from case result';
        default: {
            const suffix = id === null || id === undefined || id === '' ? '' : ` ${words(id)}`;
            return cleanText(`${words(action) || 'Menu action'}${suffix}`);
        }
    }
}

export class AccessibilityBridge {
    constructor(canvas, statusElement = null) {
        this.canvas = canvas || null;
        this.status = statusElement || (typeof document !== 'undefined'
            ? document.getElementById('game-status')
            : null);
        this.objective = typeof document !== 'undefined'
            ? document.getElementById('game-objective')
            : null;
        this.lastMessage = '';
        this.lastObjective = '';
        this.serial = 0;

        if (this.canvas && typeof this.canvas.setAttribute === 'function') {
            this.canvas.tabIndex = 0;
            this.canvas.setAttribute('role', 'application');
            this.canvas.setAttribute('aria-roledescription', 'survival action game');
            this.canvas.setAttribute('aria-label', 'EMBERWAKE main menu');
            this.canvas.setAttribute('aria-describedby', 'game-instructions game-objective');
        }
    }

    focusCanvas() {
        try { this.canvas?.focus?.({ preventScroll: true }); }
        catch (_) { try { this.canvas?.focus?.(); } catch (_) { /* optional */ } }
    }

    setScreen(screen, detail = '') {
        if (!this.canvas || typeof this.canvas.setAttribute !== 'function') return;
        const suffix = cleanText(detail, '');
        const base = screen === 'gameplay'
            ? 'EMBERWAKE gameplay'
            : screen === 'paused'
                ? 'EMBERWAKE paused run'
            : screen === 'victory'
                ? 'EMBERWAKE victory'
            : screen === 'gameOver'
                ? 'EMBERWAKE run summary'
                : 'EMBERWAKE main menu';
        this.canvas.setAttribute('aria-label', suffix ? `${base}. ${suffix}` : base);
    }

    // Queryable but deliberately non-live. Progress may update every frame;
    // only assignment/completion events use the polite announcement channel.
    setObjective(snapshot) {
        const text = objectiveDescription(snapshot);
        if (text === this.lastObjective) return false;
        this.lastObjective = text;
        if (this.objective) this.objective.textContent = text;
        return true;
    }

    announce(message) {
        const text = cleanText(message, '');
        if (!text || !this.status) return false;
        this.serial += 1;
        this.lastMessage = text;
        // Alternating a harmless non-breaking space lets assistive technology
        // re-announce a repeated event (for example, two identical rewards).
        this.status.textContent = `${text}${this.serial % 2 ? '\u00a0' : ''}`;
        return true;
    }
}
