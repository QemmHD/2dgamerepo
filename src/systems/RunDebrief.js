// Pure run-end presentation. The caller supplies accepted reward receipts and
// a fresh lethal-damage event; this module never awards or saves anything.

const SOURCE_LABEL_LIMIT = 64;
const MAX_AMOUNT = Number.MAX_SAFE_INTEGER;
const CAUSE_KINDS = new Set(['contact', 'projectile', 'hazard']);

const HINTS = Object.freeze({
    unknown: Object.freeze({ id: 'movement', text: 'Keep moving while weapons auto-fire; look for open space.' }),
    contact: Object.freeze({ id: 'contact', text: 'Keep moving while weapons auto-fire. Give enemies room.' }),
    crowd: Object.freeze({ id: 'crowd', text: 'Move toward an open gap before enemies surround you.' }),
    projectile: Object.freeze({ id: 'projectile', text: 'Dodge across shots, or use a house wall as cover.' }),
    hazard: Object.freeze({ id: 'hazard', text: 'Move out of marked danger zones before their warnings finish.' }),
    delayedZone: Object.freeze({ id: 'detonation', text: 'Leave the warning circle before it fills.' }),
    beam: Object.freeze({ id: 'beam', text: 'Leave the marked beam path before it lights up.' }),
    lingering: Object.freeze({ id: 'pool', text: 'Move out of burning pools; returning to them can deal another hit.' }),
    shockwave: Object.freeze({ id: 'shockwave', text: 'Watch the warning ring and move clear before the shockwave reaches you.' }),
    iceSlick: Object.freeze({ id: 'ice', text: 'Leave black ice early; slippery movement makes late turns harder.' }),
});

const HOME_ACTION = Object.freeze({ id: 'home', label: 'Continue to Home' });

function acceptedWhole(value) {
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function safeSum(values) {
    return values.reduce((sum, value) => sum + Math.min(value, MAX_AMOUNT - sum), 0);
}

function sourceLabel(value) {
    if (typeof value !== 'string') return '';
    const cleaned = value.slice(0, 512)
        .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
        .replace(/\s+/g, ' ').trim();
    const chars = Array.from(cleaned);
    return chars.length > SOURCE_LABEL_LIMIT
        ? `${chars.slice(0, SOURCE_LABEL_LIMIT - 1).join('').trimEnd()}…`
        : cleaned;
}

function causePresentation(cause) {
    // `fresh` is a caller-owned provenance assertion: reset on run start and
    // stamp only for the damage event that reduced this player's HP to zero.
    // A remembered attacker from an earlier hit is insufficient evidence.
    if (!cause || cause.lethal !== true || cause.fresh !== true
        || cause.stale === true || !CAUSE_KINDS.has(cause.kind)) {
        return {
            cause: Object.freeze({ known: false, kind: null, text: 'Cause unavailable' }),
            hint: HINTS.unknown,
        };
    }
    const label = sourceLabel(cause.label);
    if (cause.kind === 'contact') {
        const crowd = acceptedWhole(cause.contactCount) > 1;
        return {
            cause: Object.freeze({
                known: true,
                kind: 'contact',
                text: crowd
                    ? (label ? `Crowd contact, including ${label}` : 'Contact with a crowd of enemies')
                    : (label ? `Contact with ${label}` : 'Contact with an enemy'),
            }),
            hint: crowd ? HINTS.crowd : HINTS.contact,
        };
    }
    if (cause.kind === 'projectile') {
        return {
            cause: Object.freeze({
                known: true,
                kind: 'projectile',
                text: label && label !== 'an enemy projectile' ? `A projectile from ${label}` : 'An enemy projectile',
            }),
            hint: HINTS.projectile,
        };
    }
    const hazardHint = typeof cause.hazardKind === 'string' && Object.hasOwn(HINTS, cause.hazardKind)
        && ['delayedZone', 'beam', 'lingering', 'shockwave', 'iceSlick'].includes(cause.hazardKind)
        ? HINTS[cause.hazardKind] : HINTS.hazard;
    return {
        cause: Object.freeze({
            known: true,
            kind: 'hazard',
            text: label ? `Hit by ${label}` : 'An area hazard',
        }),
        hint: hazardHint,
    };
}

/**
 * Build one immutable debrief with one learning hint and one next action.
 *
 * cause: { lethal: true, fresh: true, kind: 'contact'|'projectile'|'hazard',
 *          label?, contactCount?, hazardKind?, stale? }
 * coinReceipts: accepted integer credits { base, bonus, objective } only.
 * bpResult.gained: accepted integer Pass XP, not the attempted award.
 * firstDeath: strict presentation flag; persistence belongs to the caller.
 */
export function buildRunDebrief(input = {}) {
    const data = input && typeof input === 'object' ? input : {};
    const presentation = causePresentation(data.cause);
    const base = acceptedWhole(data.coinReceipts?.base);
    const bonus = acceptedWhole(data.coinReceipts?.bonus);
    const objective = acceptedWhole(data.coinReceipts?.objective);
    const coins = safeSum([base, bonus, objective]);
    const passXp = acceptedWhole(data.bpResult?.gained);
    const firstDeath = data.firstDeath === true;
    const rewards = Object.freeze({
        coins, base, bonus, objective,
        coinLabel: 'Run coins banked',
        // These are explicitly run-coin receipts, not the wallet's total
        // change: achievements, Daily Road, cases and other awards stay owned
        // by their existing result surfaces.
        coinDetail: 'Pickups, run bonus and Run Path rewards',
        passXp,
        passXpLabel: 'Pass XP banked',
    });
    return Object.freeze({
        firstDeath,
        title: firstDeath ? 'What to try next' : 'Run debrief',
        cause: presentation.cause,
        hint: presentation.hint,
        rewards,
        action: HOME_ACTION,
        accessibilityText: `${presentation.cause.text}. Next time: ${presentation.hint.text} `
            + `${coins} run coins banked. ${passXp} Pass XP banked. ${HOME_ACTION.label}.`,
    });
}
