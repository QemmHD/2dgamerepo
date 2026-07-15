// EntitlementTransaction — a retry-safe, whole-save boundary for rewards that
// must never be separated from their one-time claim marker.
//
// SaveSystem mutators normally persist eagerly. Entitlements need a stronger
// guarantee: resolve every reward against a detached draft, then publish the
// fully resolved save exactly once. A failed/stale final write restores the
// exact live object, leaving both the reward and its claim marker retryable.

import { openCase } from './CaseSystem.js';

function cloneTransactionValue(value, seen = new Map()) {
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    const copy = Array.isArray(value) ? [] : {};
    seen.set(value, copy);
    if (Array.isArray(value)) {
        for (const entry of value) copy.push(cloneTransactionValue(entry, seen));
    } else {
        for (const [key, entry] of Object.entries(value)) {
            copy[key] = cloneTransactionValue(entry, seen);
        }
    }
    return copy;
}

function saveFailure(save) {
    return save?.getLastSaveFailureReason?.() === 'external-save-changed'
        ? 'save-changed' : 'save-unavailable';
}

function transactionDraft(save) {
    const draft = Object.create(save);
    Object.defineProperties(draft, {
        data: {
            configurable: true,
            enumerable: true,
            writable: true,
            value: cloneTransactionValue(save.data),
        },
        // Absorb eager SaveSystem writes while the entitlement is still being
        // assembled. The live SaveSystem performs the sole durable write below.
        save: { configurable: true, writable: false, value: () => true },
    });
    return draft;
}

function frozenFailure(reason) {
    return Object.freeze({ ok: false, reason });
}

// Deterministic/internal synchronous seam. `resolve` must return ok:true only
// when the entire entitlement is ready; browser production paths use the
// origin-wide async boundary below.
export function commitEntitlementTransaction(save, resolve) {
    if (!save?.data || typeof save.data !== 'object'
        || typeof save.save !== 'function' || typeof resolve !== 'function') {
        return { ok: false, reason: 'save-unavailable' };
    }
    if (save.available === false) return { ok: false, reason: 'save-unavailable' };
    if (typeof save._saveParticipationAllowsWrite === 'function'
        && !save._saveParticipationAllowsWrite()) {
        return { ok: false, reason: 'save-unavailable' };
    }
    if (typeof save._storageUnchangedSinceLastWrite === 'function') {
        const storageState = save._storageUnchangedSinceLastWrite();
        if (!storageState?.ok) {
            return {
                ok: false,
                reason: storageState?.reason === 'external-save-changed'
                    ? 'save-changed' : 'save-unavailable',
            };
        }
    }

    const liveData = save.data;
    const draft = transactionDraft(save);
    let result;
    try {
        result = resolve(draft);
    } catch (error) {
        console.warn('[EntitlementTransaction] reward resolution failed', error);
        return { ok: false, reason: 'save-unavailable' };
    }
    if (!result?.ok) return result ?? { ok: false, reason: 'save-unavailable' };

    save.data = draft.data;
    let committed = false;
    try {
        committed = save.save() === true;
    } catch (error) {
        console.warn('[EntitlementTransaction] commit failed', error);
    }
    if (!committed) {
        save.data = liveData;
        return { ok: false, reason: saveFailure(save) };
    }
    return result;
}

// Browser production boundary. SaveSystem releases this tab's shared writer
// participation, acquires the origin-wide locks exclusively, resolves the
// synchronous draft callback, performs one final write, and reacquires its
// share. A second live participant therefore rejects before reward RNG.
export function commitEntitlementTransactionAtomic(save, resolve) {
    if (typeof resolve !== 'function') {
        return Promise.resolve(frozenFailure('transaction-callback-invalid'));
    }
    if (typeof save?.runExclusiveSaveTransaction !== 'function') {
        return Promise.resolve(frozenFailure('transaction-lock-unavailable'));
    }
    try {
        return Promise.resolve(save.runExclusiveSaveTransaction(resolve)).then((result) => {
            const valid = result && typeof result === 'object' && !Array.isArray(result)
                && typeof result.ok === 'boolean'
                && (result.ok || (typeof result.reason === 'string' && result.reason.length > 0));
            return valid ? result : frozenFailure('transaction-lock-failed');
        }).catch(() => frozenFailure('transaction-lock-failed'));
    } catch (error) {
        return Promise.resolve(frozenFailure('transaction-lock-failed'));
    }
}

function resolveFreeCaseEntitlement(draft, caseType, reserve) {
    if (typeof reserve !== 'function' || reserve(draft) !== true) {
        return { ok: false, reason: 'claimed' };
    }
    const result = openCase(draft, caseType, { free: true });
    if (!result.ok) return result;
    return { ok: true, label: result.label, result };
}

// Synchronous validator helper coupling a one-time marker with its free case.
// `reserve(draft)` must return true only when this save may claim the case.
export function claimFreeCaseEntitlement(save, caseType, reserve) {
    return commitEntitlementTransaction(save, (draft) => (
        resolveFreeCaseEntitlement(draft, caseType, reserve)
    ));
}

export function claimFreeCaseEntitlementAtomic(save, caseType, reserve) {
    return commitEntitlementTransactionAtomic(save, (draft) => (
        resolveFreeCaseEntitlement(draft, caseType, reserve)
    ));
}
