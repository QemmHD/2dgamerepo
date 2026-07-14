// Shared, save-safe preference vocabulary for First Light accessibility work.
//
// UI scale is persisted as an integer percentage instead of a floating-point
// multiplier. That keeps the player-facing 100/115/130 choices exact across
// JSON round trips and avoids SaveSystem's historical 0..1 volume clamp.

export const DEFAULT_UI_SCALE = 100;
export const UI_SCALE_PRESETS = Object.freeze([100, 115, 130]);

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
