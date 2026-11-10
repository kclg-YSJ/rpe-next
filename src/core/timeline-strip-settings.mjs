export const DENSITY_WINDOW_LIMITS = Object.freeze([.1, 10]);
export const DEFAULT_TIMELINE_STRIPS = Object.freeze({ densityStrip: true, historyStrip: true, densityStripBrightness: .65, densityStripWindow: 1 });
export function densityWindow(value) { return Number.isFinite(value) ? Math.max(DENSITY_WINDOW_LIMITS[0], Math.min(DENSITY_WINDOW_LIMITS[1], value)) : 1; }
