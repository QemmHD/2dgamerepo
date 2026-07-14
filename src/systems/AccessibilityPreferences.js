// Shared, save-safe preference vocabulary for First Light accessibility work.
//
// UI scale is persisted as an integer percentage instead of a floating-point
// multiplier. That keeps the player-facing 100/115/130 choices exact across
// JSON round trips and avoids SaveSystem's historical 0..1 volume clamp.

export const DEFAULT_UI_SCALE = 100;
export const UI_SCALE_PRESETS = Object.freeze([100, 115, 130]);
export const DEFAULT_CAPTION_DETAIL = 'essential';
export const CAPTION_DETAIL_PRESETS = Object.freeze(['essential', 'full']);
export const DEFAULT_VIBRATION_STRENGTH = 'low';
export const VIBRATION_STRENGTH_PRESETS = Object.freeze(['off', 'low', 'full']);

export function normalizeUiScale(value) {
    return Number.isInteger(value) && UI_SCALE_PRESETS.includes(value)
        ? value
        : DEFAULT_UI_SCALE;
}

export function uiScaleFactor(value) {
    return normalizeUiScale(value) / 100;
}

// High contrast is deliberately strict: truthy strings/numbers from a corrupt
// or hand-edited save must not silently enable a player preference.
export function normalizeHighContrast(value) {
    return value === true;
}

// Hearing and feedback preferences use the same strict-save discipline as
// high contrast. Hand-edited truthy strings must never silently switch the
// output mix or enable a device vibration feature.
export function normalizeMonoAudio(value) {
    return value === true;
}

export function normalizeCaptions(value) {
    return value === true;
}

export function normalizeCaptionDetail(value) {
    return CAPTION_DETAIL_PRESETS.includes(value)
        ? value
        : DEFAULT_CAPTION_DETAIL;
}

export function normalizeVibrationStrength(value) {
    return VIBRATION_STRENGTH_PRESETS.includes(value)
        ? value
        : DEFAULT_VIBRATION_STRENGTH;
}
