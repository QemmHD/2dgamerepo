// Living Vigil run tracker.
//
// This module is intentionally independent of Game, UISystem, and the DOM.
// A run owns one instance and feeds the events already emitted by
// VigilSiteSystem and EncounterDirector:
//
//   tracker.update(dt, {
//       events,
//       siteFocus: vigilSites.getFocusSnapshot(),
//       encounterSnapshot: encounterDirector.getSnapshot(),
//       reducedEffects,
//       frozen,
//   });
//   tracker.draw(ctx, { x, y, w, h });
//   tracker.drawWorldPrompt(ctx, camera, { width, height }); // optional
//
// Rendering uses only Canvas2D paths and text. The caller owns placement, so
// this compact plate can be allocated beside the existing HUD instead of
// inventing another fixed screen position.

export const VIGIL_TRACKER_SITE_KINDS = Object.freeze([
    'hearth',
    'archive',
    'cache',
    'beacon',
]);

export const VIGIL_TRACKER_LIMITS = Object.freeze({
    siteKindCount: VIGIL_TRACKER_SITE_KINDS.length,
    maxInputEventsPerUpdate: 16,
    maxRememberedEvents: 32,
    maxCelebrations: 4,
    maxEncounterCount: 9999,
    siteFocusHoldSeconds: 0.24,
    transientPromptSeconds: 2.8,
    celebrationSeconds: 2.7,
});

const FONT = '-apple-system, system-ui, Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const TAU = Math.PI * 2;
const SITE_INDEX = Object.freeze(Object.fromEntries(
    VIGIL_TRACKER_SITE_KINDS.map((kind, index) => [kind, index]),
));
const SITE_COLORS = Object.freeze({
    hearth: '#ff9a4a',
    archive: '#7fd0ff',
    cache: '#ffd166',
    beacon: '#ff6a78',
});
const ENCOUNTER_EVENT_TYPES = new Set([
    'encounter-warning',
    'encounter-spawned',
    'encounter-cleared',
    'encounter-aborted',
]);
const GOLD = '#ffd166';
const CYAN = '#7fd0ff';
const TEXT = '#fff4df';
const MUTED = 'rgba(238,226,207,0.62)';

function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function whole(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
    return clamp(Math.floor(finite(value, fallback)), 0, max);
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function cleanText(value, fallback = '', maxLength = 64) {
    if (typeof value !== 'string') return fallback;
    const cleaned = value.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned) return fallback;
    return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

function cleanColor(value, fallback) {
    return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

function recognizedSiteKind(value) {
    return typeof value === 'string' && hasOwn(SITE_INDEX, value) ? value : null;
}

function roundedRectPath(ctx, x, y, w, h, radius) {
    const r = clamp(finite(radius), 0, Math.min(w, h) * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function eventKey(event) {
    if (!event || typeof event !== 'object') return null;
    if (typeof event.id === 'string' && event.id) return `site:${event.id}`;
    const type = typeof event.type === 'string' ? event.type : null;
    const packId = typeof event.packId === 'string' ? event.packId : null;
    return type && packId ? `encounter:${type}:${packId}` : null;
}

function siteRewardSubtitle(event, firstActivation) {
    if (event.kind === 'spawn') return 'Guardian challenge kindled';
    const reward = event.reward && typeof event.reward === 'object' ? event.reward : null;
    const type = cleanText(reward?.type, '', 20);
    if (type === 'heal') return 'Health restored';
    if (type === 'xp') {
        const amount = whole(reward?.amount);
        if (amount > 0) return `+${amount} run XP`;
    } else if (type === 'coins') {
        const amount = whole(reward?.amount);
        if (amount > 0) return `+${amount} run coins`;
    } else if (type === 'bundle') {
        const coins = whole(reward?.coins);
        const xp = whole(reward?.xp);
        if (coins > 0 || xp > 0) return `+${coins} coins / +${xp} XP`;
    }
    return firstActivation ? 'Vigil site activated' : 'Vigil reward claimed';
}

function isCanvasContext(ctx) {
    return !!ctx && typeof ctx.save === 'function' && typeof ctx.restore === 'function'
        && typeof ctx.beginPath === 'function' && typeof ctx.fillText === 'function';
}

function siteMaskFrom(value) {
    if (value == null || typeof value[Symbol.iterator] !== 'function') return 0;
    let mask = 0;
    for (const raw of value) {
        const kind = recognizedSiteKind(raw);
        if (kind) mask |= 1 << SITE_INDEX[kind];
    }
    return mask;
}

function countBits(value) {
    let word = value >>> 0;
    let count = 0;
    while (word) {
        word &= word - 1;
        count++;
    }
    return count;
}

function drawSiteGlyph(ctx, kind, cx, cy, size, active, color) {
    const s = Math.max(4, size);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineWidth = Math.max(1.5, s * 0.12);
    ctx.strokeStyle = active ? color : 'rgba(255,255,255,0.24)';
    ctx.fillStyle = active ? color : 'rgba(255,255,255,0.055)';

    ctx.beginPath();
    ctx.arc(0, 0, s, 0, TAU);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = active ? '#171217' : 'rgba(255,255,255,0.28)';
    ctx.fillStyle = active ? '#171217' : 'rgba(255,255,255,0.28)';
    ctx.lineWidth = Math.max(1.4, s * 0.14);
    if (kind === 'hearth') {
        ctx.beginPath();
        ctx.moveTo(-s * 0.46, 0); ctx.lineTo(s * 0.46, 0);
        ctx.moveTo(0, -s * 0.46); ctx.lineTo(0, s * 0.46);
        ctx.stroke();
    } else if (kind === 'archive') {
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.42); ctx.lineTo(0, s * 0.48);
        ctx.moveTo(-s * 0.58, -s * 0.32); ctx.lineTo(-s * 0.08, -s * 0.18);
        ctx.lineTo(-s * 0.08, s * 0.42); ctx.lineTo(-s * 0.58, s * 0.26);
        ctx.moveTo(s * 0.58, -s * 0.32); ctx.lineTo(s * 0.08, -s * 0.18);
        ctx.lineTo(s * 0.08, s * 0.42); ctx.lineTo(s * 0.58, s * 0.26);
        ctx.stroke();
    } else if (kind === 'cache') {
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.54); ctx.lineTo(s * 0.52, 0);
        ctx.lineTo(0, s * 0.54); ctx.lineTo(-s * 0.52, 0);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, s * 0.12, 0, TAU); ctx.fill();
    } else {
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.58); ctx.lineTo(s * 0.48, s * 0.42);
        ctx.lineTo(-s * 0.48, s * 0.42); ctx.closePath();
        ctx.stroke();
        ctx.beginPath(); ctx.arc(0, s * 0.16, s * 0.11, 0, TAU); ctx.fill();
    }
    ctx.restore();
}

function drawVigilMark(ctx, cx, cy, radius, color, active) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = color;
    ctx.fillStyle = active ? color : 'rgba(255,209,102,0.14)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
        const angle = i / 8 * TAU - Math.PI / 2;
        const inner = radius * 0.52;
        const outer = i % 2 ? radius * 0.78 : radius;
        const x = Math.cos(angle) * outer;
        const y = Math.sin(angle) * outer;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        const next = angle + TAU / 16;
        ctx.lineTo(Math.cos(next) * inner, Math.sin(next) * inner);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, radius * 0.22, 0, TAU); ctx.fillStyle = '#fff0c2'; ctx.fill();
    ctx.restore();
}

export class VigilTracker {
    constructor(options = {}) {
        this.celebrations = [];
        this._seenEventKeys = [];
        this.reset(options);
    }

    reset(options = {}) {
        const safe = options && typeof options === 'object' ? options : {};
        this.clock = 0;
        this.siteMask = siteMaskFrom(safe.activatedSiteKinds);
        this.encountersCleared = whole(
            safe.encountersCleared,
            0,
            VIGIL_TRACKER_LIMITS.maxEncounterCount,
        );
        this.sitePrompt = null;
        this.encounterPrompt = null;
        this.celebrations.length = 0;
        this._seenEventKeys.length = 0;
        this.reducedEffects = !!safe.reducedEffects;
        this.droppedEvents = 0;
        return this.getSnapshot();
    }

    setProgress(progress = {}) {
        if (!progress || typeof progress !== 'object') return this.getSnapshot();
        if (hasOwn(progress, 'activatedSiteKinds')) {
            this.siteMask = siteMaskFrom(progress.activatedSiteKinds);
        }
        if (hasOwn(progress, 'encountersCleared')) {
            this.encountersCleared = whole(
                progress.encountersCleared,
                this.encountersCleared,
                VIGIL_TRACKER_LIMITS.maxEncounterCount,
            );
        }
        return this.getSnapshot();
    }

    update(dt, input = {}) {
        const state = input && typeof input === 'object' ? input : {};
        if (hasOwn(state, 'reducedEffects')) this.reducedEffects = !!state.reducedEffects;
        const step = state.frozen ? 0 : clamp(finite(dt), 0, 0.25);
        this.clock += step;
        this._advanceTimers(step);

        if (hasOwn(state, 'siteFocus')) this.setSiteFocus(state.siteFocus);
        if (hasOwn(state, 'encounterSnapshot')) this.setEncounterSnapshot(state.encounterSnapshot);
        else if (hasOwn(state, 'encounter')) this.setEncounterSnapshot(state.encounter);

        if (hasOwn(state, 'events')) this._ingestInputEvents(state.events);
        return this.getSnapshot();
    }

    _advanceTimers(step) {
        if (step <= 0) return;
        if (this.sitePrompt) {
            this.sitePrompt.remaining -= step;
            if (this.sitePrompt.remaining <= 0) this.sitePrompt = null;
        }
        if (this.encounterPrompt && !this.encounterPrompt.persistent) {
            this.encounterPrompt.remaining -= step;
            if (this.encounterPrompt.remaining <= 0) this.encounterPrompt = null;
        }

        let remainingStep = step;
        while (remainingStep > 0 && this.celebrations.length) {
            const current = this.celebrations[0];
            if (current.remaining > remainingStep) {
                current.remaining -= remainingStep;
                break;
            }
            remainingStep -= current.remaining;
            this.celebrations.shift();
        }
    }

    _ingestInputEvents(events) {
        if (events == null) return;
        if (!Array.isArray(events)) {
            this.ingest(events);
            return;
        }
        const count = Math.min(events.length, VIGIL_TRACKER_LIMITS.maxInputEventsPerUpdate);
        for (let i = 0; i < count; i++) this.ingest(events[i]);
        if (events.length > count) this.droppedEvents += events.length - count;
    }

    ingest(event) {
        if (!event || typeof event !== 'object') return false;
        const siteKind = recognizedSiteKind(event.archetype);
        const siteEvent = (event.kind === 'reward' || event.kind === 'spawn' || event.kind === 'status')
            && !!siteKind;
        const encounterEvent = ENCOUNTER_EVENT_TYPES.has(event.type)
            && typeof event.packId === 'string' && event.packId.trim().length > 0;
        if (!siteEvent && !encounterEvent) return false;

        const key = eventKey(event);
        if (key && !this._rememberEvent(key)) {
            // EncounterDirector deliberately replays an interrupted warning
            // with the same pack id after a modal closes. Warning/spawn UI is
            // idempotent, so refresh it; only irreversible progress events are
            // rejected as duplicates.
            const replayable = event.type === 'encounter-warning' || event.type === 'encounter-spawned';
            if (!replayable) return false;
        }

        if (siteEvent) return this._ingestSiteEvent(event, siteKind);
        return this._ingestEncounterEvent(event);
    }

    _rememberEvent(key) {
        if (this._seenEventKeys.includes(key)) return false;
        if (this._seenEventKeys.length >= VIGIL_TRACKER_LIMITS.maxRememberedEvents) {
            this._seenEventKeys.shift();
        }
        this._seenEventKeys.push(key);
        return true;
    }

    _ingestSiteEvent(event, kind) {
        if (event.kind === 'status') {
            if (this.sitePrompt?.siteId === event.siteId) this.sitePrompt = null;
            return true;
        }

        const bit = 1 << SITE_INDEX[kind];
        const firstActivation = (this.siteMask & bit) === 0;
        this.siteMask |= bit;
        const fallbackName = kind === 'beacon' ? 'Gloam Beacon' : 'Vigil Site';
        const title = cleanText(event.label, fallbackName, 40);
        const color = cleanColor(event.color, SITE_COLORS[kind]);
        const subtitle = siteRewardSubtitle(event, firstActivation);
        this._queueCelebration({
            kind: 'site',
            title,
            subtitle,
            color,
            duration: VIGIL_TRACKER_LIMITS.celebrationSeconds,
        });
        if (this.sitePrompt?.siteId === event.siteId) this.sitePrompt = null;
        return true;
    }

    _ingestEncounterEvent(event) {
        const type = event.type;
        const color = cleanColor(event.color, type === 'encounter-warning' ? '#ff9a4a' : CYAN);
        const packId = cleanText(event.packId, '', 80);
        if (type === 'encounter-warning') {
            const duration = clamp(
                finite(event.duration, VIGIL_TRACKER_LIMITS.transientPromptSeconds),
                0.4,
                30,
            );
            this.encounterPrompt = {
                kind: 'encounter-warning',
                packId,
                title: cleanText(event.title, 'Tactical pack incoming', 42),
                body: cleanText(event.text, 'Hostile formation approaching', 72),
                color,
                remaining: duration,
                duration,
                persistent: false,
                urgent: true,
            };
            return true;
        }
        if (type === 'encounter-spawned') {
            this.encounterPrompt = {
                kind: 'encounter-active',
                packId,
                title: cleanText(event.title, 'Tactical pack', 42),
                body: 'Break the guardian formation',
                color,
                remaining: 0,
                duration: 0,
                persistent: true,
                urgent: false,
            };
            return true;
        }
        if (type === 'encounter-cleared') {
            const nextCount = Number.isFinite(event.completedCount)
                ? whole(event.completedCount, this.encountersCleared, VIGIL_TRACKER_LIMITS.maxEncounterCount)
                : Math.min(VIGIL_TRACKER_LIMITS.maxEncounterCount, this.encountersCleared + 1);
            this.encountersCleared = Math.max(this.encountersCleared, nextCount);
            if (!packId || this.encounterPrompt?.packId === packId) this.encounterPrompt = null;
            this._queueCelebration({
                kind: 'encounter',
                title: cleanText(event.title, 'Formation broken', 44),
                subtitle: cleanText(event.text, 'Tactical pack cleared', 64),
                color,
                duration: VIGIL_TRACKER_LIMITS.celebrationSeconds,
            });
            return true;
        }
        if (type === 'encounter-aborted') {
            if (!packId || this.encounterPrompt?.packId === packId) this.encounterPrompt = null;
            return true;
        }
        return false;
    }

    _queueCelebration(input) {
        const duration = clamp(finite(input.duration, VIGIL_TRACKER_LIMITS.celebrationSeconds), 0.5, 8);
        const entry = {
            kind: input.kind === 'encounter' ? 'encounter' : 'site',
            title: cleanText(input.title, 'Living Vigil advanced', 44),
            subtitle: cleanText(input.subtitle, '', 64),
            color: cleanColor(input.color, GOLD),
            duration,
            remaining: duration,
        };
        if (this.celebrations.length >= VIGIL_TRACKER_LIMITS.maxCelebrations) {
            // Preserve the notice the player is currently reading; replace the
            // oldest waiting notice when malformed input floods the tracker.
            this.celebrations.splice(1, 1);
            this.droppedEvents++;
        }
        this.celebrations.push(entry);
    }

    setSiteFocus(focus) {
        if (!focus || typeof focus !== 'object') {
            this.sitePrompt = null;
            return false;
        }
        const kind = recognizedSiteKind(focus.archetype);
        if (!kind || !Number.isFinite(focus.x) || !Number.isFinite(focus.y)) {
            this.sitePrompt = null;
            return false;
        }
        this.sitePrompt = {
            kind: 'site',
            siteId: cleanText(focus.siteId, kind, 80),
            archetype: kind,
            title: cleanText(focus.name, 'Vigil Site', 40),
            body: cleanText(focus.prompt, 'ACTIVATE', 34),
            color: cleanColor(focus.color, SITE_COLORS[kind]),
            x: focus.x,
            y: focus.y,
            progress: clamp(finite(focus.progress), 0, 1),
            inside: !!focus.inside,
            blocked: !!focus.blocked,
            remaining: VIGIL_TRACKER_LIMITS.siteFocusHoldSeconds,
        };
        return true;
    }

    setEncounterSnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') {
            this.encounterPrompt = null;
            return false;
        }
        if (snapshot.warning && typeof snapshot.warning === 'object') {
            const warning = snapshot.warning;
            const duration = clamp(finite(warning.duration, 3), 0.4, 30);
            this.encounterPrompt = {
                kind: 'encounter-warning',
                packId: cleanText(warning.packId, '', 80),
                title: cleanText(warning.name, 'Tactical pack incoming', 42),
                body: 'Formation signal detected',
                color: '#ff9a4a',
                remaining: clamp(finite(warning.remaining, duration), 0, duration),
                duration,
                persistent: false,
                urgent: true,
            };
            return true;
        }
        if (snapshot.activePack && typeof snapshot.activePack === 'object') {
            const pack = snapshot.activePack;
            const remaining = Number.isFinite(pack.guardiansRemaining)
                ? `${whole(pack.guardiansRemaining)} guardians remain`
                : 'Break the guardian formation';
            this.encounterPrompt = {
                kind: 'encounter-active',
                packId: cleanText(pack.packId, '', 80),
                title: cleanText(pack.name, 'Tactical pack', 42),
                body: remaining,
                color: CYAN,
                remaining: 0,
                duration: 0,
                persistent: true,
                urgent: false,
            };
            return true;
        }
        this.encounterPrompt = null;
        return false;
    }

    getCurrentPrompt() {
        // An encounter tell can threaten the player from off-screen and wins
        // priority. A nearby site then wins over a non-urgent active pack.
        if (this.encounterPrompt?.urgent) return { ...this.encounterPrompt };
        if (this.sitePrompt) return { ...this.sitePrompt };
        return this.encounterPrompt ? { ...this.encounterPrompt } : null;
    }

    getSnapshot() {
        const activeKinds = VIGIL_TRACKER_SITE_KINDS.filter(
            (kind) => (this.siteMask & (1 << SITE_INDEX[kind])) !== 0,
        );
        return {
            clock: this.clock,
            siteMask: this.siteMask,
            activatedSites: activeKinds.length,
            siteKindTotal: VIGIL_TRACKER_LIMITS.siteKindCount,
            activatedSiteKinds: activeKinds,
            encountersCleared: this.encountersCleared,
            prompt: this.getCurrentPrompt(),
            celebration: this.celebrations.length ? { ...this.celebrations[0] } : null,
            queuedCelebrations: this.celebrations.length,
            reducedEffects: this.reducedEffects,
            droppedEvents: this.droppedEvents,
        };
    }

    draw(ctx, rect = {}, options = {}) {
        return this.drawHUD(ctx, rect, options);
    }

    drawHUD(ctx, rect = {}, options = {}) {
        if (!isCanvasContext(ctx) || options?.visible === false) return false;
        const safeRect = rect && typeof rect === 'object' ? rect : {};
        const x = finite(safeRect.x);
        const y = finite(safeRect.y);
        const w = clamp(finite(safeRect.w, 500), 0, 720);
        const h = clamp(finite(safeRect.h, 132), 0, 180);
        // Never silently expand beyond the caller's allocated HUD rectangle.
        // Returning false lets HUDLayout choose a different slot while keeping
        // text at a genuinely legible internal-resolution size.
        if (w < 340 || h < 112) return false;
        const compact = w < 440 || h < 124;
        const pad = compact ? 14 : 18;
        const accent = this.celebrations[0]?.color || this.getCurrentPrompt()?.color || GOLD;
        const alpha = clamp(finite(options?.alpha, 1), 0, 1);
        if (alpha <= 0) return false;

        ctx.save();
        ctx.globalAlpha = finite(ctx.globalAlpha, 1) * alpha;
        roundedRectPath(ctx, x, y, w, h, compact ? 12 : 16);
        ctx.fillStyle = 'rgba(10,9,13,0.92)';
        ctx.fill();
        roundedRectPath(ctx, x + 2, y + 2, w - 4, h - 4, compact ? 10 : 14);
        ctx.strokeStyle = 'rgba(255,188,116,0.16)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = accent;
        const plateAlpha = finite(ctx.globalAlpha, 1);
        ctx.globalAlpha = plateAlpha * 0.82;
        roundedRectPath(ctx, x + pad, y + 5, w - pad * 2, 3, 1.5);
        ctx.fill();
        ctx.globalAlpha = plateAlpha;

        const headerY = y + (compact ? 21 : 24);
        const markRadius = compact ? 10 : 12;
        drawVigilMark(ctx, x + pad + markRadius, headerY, markRadius, GOLD, this.siteMask !== 0);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = `800 ${compact ? 13 : 15}px ${FONT}`;
        ctx.fillStyle = TEXT;
        ctx.fillText('LIVING VIGIL', x + pad + markRadius * 2 + 10, headerY);

        const encounterText = `PACKS ${String(this.encountersCleared).padStart(2, '0')}`;
        ctx.textAlign = 'right';
        ctx.font = `800 ${compact ? 12 : 14}px ${MONO}`;
        ctx.fillStyle = this.encountersCleared > 0 ? CYAN : MUTED;
        ctx.fillText(encounterText, x + w - pad, headerY);

        const rowY = y + (compact ? 46 : 52);
        ctx.textAlign = 'left';
        ctx.font = `700 ${compact ? 11 : 12}px ${MONO}`;
        ctx.fillStyle = MUTED;
        ctx.fillText(`SITES ${countBits(this.siteMask)} / ${VIGIL_TRACKER_LIMITS.siteKindCount}`, x + pad, rowY);
        const glyphStart = x + pad + (compact ? 86 : 98);
        const glyphGap = compact ? 24 : 28;
        const glyphSize = compact ? 7 : 8;
        for (let i = 0; i < VIGIL_TRACKER_SITE_KINDS.length; i++) {
            const kind = VIGIL_TRACKER_SITE_KINDS[i];
            const active = (this.siteMask & (1 << i)) !== 0;
            drawSiteGlyph(ctx, kind, glyphStart + i * glyphGap, rowY, glyphSize, active, SITE_COLORS[kind]);
        }

        const dividerY = y + (compact ? 64 : 72);
        ctx.beginPath();
        ctx.moveTo(x + pad, dividerY);
        ctx.lineTo(x + w - pad, dividerY);
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1;
        ctx.stroke();

        this._drawChipMessage(ctx, {
            x: x + pad,
            y: dividerY + 5,
            w: w - pad * 2,
            h: y + h - pad * 0.55 - dividerY - 5,
            compact,
        });
        ctx.restore();
        return true;
    }

    _drawChipMessage(ctx, box) {
        const celebration = this.celebrations[0];
        const prompt = this.getCurrentPrompt();
        let title;
        let body;
        let color;
        let kind;
        if (celebration) {
            title = celebration.title;
            body = celebration.subtitle;
            color = celebration.color;
            kind = celebration.kind;
            if (!this.reducedEffects) {
                const life = 1 - celebration.remaining / celebration.duration;
                const pulse = 0.76 + Math.sin((this.clock + life) * 8) * 0.18;
                ctx.globalAlpha = finite(ctx.globalAlpha, 1) * clamp(pulse, 0.55, 1);
            }
        } else if (prompt) {
            title = prompt.title;
            body = prompt.body;
            color = prompt.blocked ? '#a89b91' : prompt.color;
            kind = prompt.kind;
        } else {
            const complete = countBits(this.siteMask) === VIGIL_TRACKER_LIMITS.siteKindCount;
            title = complete ? 'ALL VIGIL SITES FOUND' : 'SEEK THE FOUR LIGHTS';
            body = complete ? 'Break tactical packs to deepen the run' : 'Explore houses and answer formation signals';
            color = complete ? GOLD : CYAN;
            kind = 'idle';
        }

        const iconX = box.x + 11;
        const midY = box.y + box.h * 0.50;
        ctx.beginPath();
        ctx.arc(iconX, midY, box.compact ? 5 : 6, 0, TAU);
        ctx.fillStyle = color;
        ctx.fill();
        if (celebration && !this.reducedEffects) {
            ctx.beginPath();
            ctx.arc(iconX, midY, box.compact ? 10 : 12, 0, TAU);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        const textX = box.x + (box.compact ? 24 : 29);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = `800 ${box.compact ? 13 : 15}px ${FONT}`;
        ctx.fillStyle = color;
        ctx.fillText(cleanText(title, '', box.compact ? 34 : 44), textX, box.y + box.h * 0.32);
        ctx.font = `600 ${box.compact ? 11 : 12}px ${FONT}`;
        ctx.fillStyle = MUTED;
        ctx.fillText(cleanText(body, '', box.compact ? 48 : 64), textX, box.y + box.h * 0.70);

        if (!celebration && prompt?.kind === 'site' && prompt.inside && !prompt.blocked) {
            const barX = box.x;
            const barY = box.y + box.h - 3;
            const barW = box.w;
            ctx.fillStyle = 'rgba(255,255,255,0.10)';
            roundedRectPath(ctx, barX, barY, barW, 3, 1.5); ctx.fill();
            ctx.fillStyle = color;
            roundedRectPath(ctx, barX, barY, Math.max(2, barW * prompt.progress), 3, 1.5); ctx.fill();
        } else if (!celebration && prompt?.kind === 'encounter-warning' && prompt.duration > 0) {
            const ratio = clamp(prompt.remaining / prompt.duration, 0, 1);
            ctx.fillStyle = color;
            roundedRectPath(ctx, box.x, box.y + box.h - 3, Math.max(2, box.w * ratio), 3, 1.5); ctx.fill();
        }

        // This label is visual hierarchy, not an additional animation.
        if (kind === 'encounter-warning') {
            ctx.textAlign = 'right';
            ctx.font = `800 ${box.compact ? 10 : 11}px ${MONO}`;
            ctx.fillStyle = color;
            ctx.fillText('INCOMING', box.x + box.w, box.y + box.h * 0.32);
        }
    }

    drawWorldPrompt(ctx, camera, viewport = {}, options = {}) {
        if (!isCanvasContext(ctx) || !this.sitePrompt || options?.visible === false) return false;
        if (!camera || !Number.isFinite(camera.x) || !Number.isFinite(camera.y)) return false;
        const view = viewport && typeof viewport === 'object' ? viewport : {};
        const width = Math.max(320, finite(view.width ?? view.w, 1920));
        const height = Math.max(180, finite(view.height ?? view.h, 1080));
        const focus = this.sitePrompt;
        const screenX = focus.x - camera.x + width * 0.5;
        const screenY = focus.y - camera.y + height * 0.5;
        const cull = 130;
        if (screenX < -cull || screenX > width + cull || screenY < -cull || screenY > height + cull) {
            return false;
        }

        const scale = clamp(finite(options?.scale, 1), 0.75, 1.35);
        const w = 304 * scale;
        const h = 58 * scale;
        const margin = 16;
        const desiredY = screenY - finite(options?.offsetY, 116) * scale;
        const x = clamp(screenX - w * 0.5, margin, Math.max(margin, width - w - margin));
        const y = clamp(desiredY - h, margin, Math.max(margin, height - h - margin));
        const color = focus.blocked ? '#9e958e' : focus.color;

        ctx.save();
        ctx.globalAlpha = finite(ctx.globalAlpha, 1) * clamp(finite(options?.alpha, 1), 0, 1);
        if (!this.reducedEffects && !focus.blocked) {
            const pulse = 0.82 + Math.sin(this.clock * 6) * 0.10;
            ctx.globalAlpha = finite(ctx.globalAlpha, 1) * pulse;
        }
        ctx.beginPath();
        ctx.moveTo(x + w * 0.5, y + h);
        ctx.lineTo(screenX, Math.min(screenY - 18, y + h + 26 * scale));
        ctx.strokeStyle = 'rgba(255,230,190,0.42)';
        ctx.lineWidth = 2;
        ctx.stroke();
        roundedRectPath(ctx, x, y, w, h, 12 * scale);
        ctx.fillStyle = 'rgba(8,8,12,0.92)'; ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();

        drawSiteGlyph(
            ctx,
            focus.archetype,
            x + 28 * scale,
            y + h * 0.5,
            10 * scale,
            true,
            color,
        );
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = `800 ${Math.round(15 * scale)}px ${FONT}`;
        ctx.fillStyle = TEXT;
        ctx.fillText(cleanText(focus.title, 'Vigil Site', 28), x + 50 * scale, y + 20 * scale);
        ctx.font = `800 ${Math.round(12 * scale)}px ${MONO}`;
        ctx.fillStyle = color;
        ctx.fillText(focus.body, x + 50 * scale, y + 40 * scale);

        if (focus.inside && !focus.blocked) {
            ctx.fillStyle = 'rgba(255,255,255,0.13)';
            roundedRectPath(ctx, x + 10 * scale, y + h - 5 * scale, w - 20 * scale, 3 * scale, 1.5 * scale);
            ctx.fill();
            ctx.fillStyle = color;
            roundedRectPath(
                ctx,
                x + 10 * scale,
                y + h - 5 * scale,
                Math.max(2, (w - 20 * scale) * focus.progress),
                3 * scale,
                1.5 * scale,
            );
            ctx.fill();
        }
        ctx.restore();
        return true;
    }
}
