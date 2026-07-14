// Dedicated gameplay-caption lane.
//
// Wave banners remain encounter UI; spoken lines and meaningful non-speech
// cues live here so one cannot overwrite the other. The queue is intentionally
// tiny and priority-aware: a boss line can interrupt a world cue, while swarm
// repetition is deduped before it can become another source of combat noise.

import {
    DEFAULT_CAPTION_DETAIL,
    normalizeCaptionDetail,
    normalizeCaptions,
} from './AccessibilityPreferences.js';

const MAX_QUEUE = 2;
const MAX_TEXT = 96;
const MAX_SPEAKER = 32;

function clean(value, max) {
    return String(value ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

function finite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

export class CaptionSystem {
    constructor({ onPresent = null } = {}) {
        this.enabled = true;
        this.detail = DEFAULT_CAPTION_DETAIL;
        this.onPresent = typeof onPresent === 'function' ? onPresent : null;
        this.current = null;
        this.queue = [];
        this.clock = 0;
        this.lastShown = new Map();
    }

    setPreferences(enabled, detail) {
        this.enabled = normalizeCaptions(enabled);
        this.detail = normalizeCaptionDetail(detail);
        if (!this.enabled) {
            this.clear();
        } else if (this.detail !== 'full') {
            // Detail changes apply immediately. A Full-only ambient cue cannot
            // remain visible or surface later after the player chooses Essential.
            if (this.current?.detail === 'full') this.current = null;
            this.queue = this.queue.filter((item) => item.detail !== 'full');
            if (!this.current) this._promote();
        }
        return { enabled: this.enabled, detail: this.detail };
    }

    clear() {
        this.current = null;
        this.queue.length = 0;
    }

    reset() {
        this.clear();
        this.clock = 0;
        this.lastShown.clear();
    }

    update(dt) {
        let remaining = Math.max(0, finite(dt, 0));
        this.clock += remaining;
        while (remaining > 0) {
            if (!this.current) this._promote();
            if (!this.current) break;
            const untilExpiry = Math.max(0, this.current.lifetime - this.current.age);
            const slice = Math.min(remaining, untilExpiry);
            this.current.age += slice;
            for (const item of this.queue) item.waitAge += slice;
            this.queue = this.queue.filter((item) => item.waitAge < item.maxWait);
            remaining -= slice;
            if (this.current.age >= this.current.lifetime) {
                this.current = null;
                this._promote();
                continue;
            }
            break;
        }
    }

    say({ key, speaker = 'Voice', text, lifetime = 3.2, priority = 100 } = {}) {
        return this._enqueue({
            key,
            kind: 'speech',
            detail: 'essential',
            speaker: clean(speaker, MAX_SPEAKER) || 'Voice',
            text: clean(text, MAX_TEXT),
            lifetime,
            priority,
            cooldown: 1.5,
        });
    }

    sound({
        key,
        text,
        detail = 'essential',
        lifetime = 2.2,
        priority = 50,
        cooldown = 2.5,
    } = {}) {
        return this._enqueue({
            key,
            kind: 'sound',
            detail: detail === 'full' ? 'full' : 'essential',
            speaker: '',
            text: clean(text, MAX_TEXT),
            lifetime,
            priority,
            cooldown,
        });
    }

    snapshot() {
        return this.current ? { ...this.current } : null;
    }

    _enqueue(raw) {
        if (!this.enabled || !raw.text) return false;
        if (raw.detail === 'full' && this.detail !== 'full') return false;
        const key = clean(raw.key || `${raw.kind}:${raw.text}`, 80);
        const cooldown = Math.max(0, finite(raw.cooldown, 0));
        const last = this.lastShown.get(key);
        if (Number.isFinite(last) && this.clock - last < cooldown) return false;
        if (this.current?.key === key || this.queue.some((item) => item.key === key)) return false;

        const item = {
            key,
            kind: raw.kind,
            detail: raw.detail,
            speaker: raw.speaker,
            text: raw.text,
            age: 0,
            lifetime: Math.max(1.2, Math.min(6, finite(raw.lifetime, 2.4))),
            priority: Math.max(0, Math.min(100, finite(raw.priority, 50))),
            waitAge: 0,
            // A queued danger cue is useful only while its event is still
            // current. Speech normally replaces the monophonic voice caption,
            // but a defensive max wait still keeps any future queued dialogue
            // from surfacing several seconds late.
            maxWait: raw.kind === 'speech' ? 2.4 : 1.2,
        };

        // Boss voice playback is monophonic: a new spoken source fades/stops
        // the old one immediately. Its transcript must make the exact same
        // transition instead of waiting behind a line that is no longer heard.
        if (item.kind === 'speech') {
            this.queue = this.queue.filter((queued) => queued.kind !== 'speech');
            this.current = item;
            this._present(item);
            return true;
        }

        // Speech and urgent threats take the lane immediately. A lower-priority
        // caption is not requeued: by the time dialogue ends its context is old.
        if (this.current && item.priority > this.current.priority) {
            this.current = item;
            this._present(item);
            return true;
        }
        if (!this.current) {
            this.current = item;
            this._present(item);
            return true;
        }
        this.queue.push(item);
        this.queue.sort((a, b) => b.priority - a.priority);
        this.queue.length = Math.min(MAX_QUEUE, this.queue.length);
        return this.queue.includes(item);
    }

    _promote() {
        if (!this.enabled || !this.queue.length) return;
        this.current = this.queue.shift();
        this._present(this.current);
    }

    _present(item) {
        this.lastShown.set(item.key, this.clock);
        if (this.onPresent) {
            try { this.onPresent({ ...item }); } catch (_) { /* assistive output is optional */ }
        }
    }
}
