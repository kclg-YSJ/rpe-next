export const DEFAULT_LINE_WIDTH = 4000;
export const DEFAULT_LINE_HEIGHT = 5;
export const HIT_FRAME_SECONDS = 0.015;
export const HIT_FRAME_COUNT = 31;
export const HIT_DURATION = HIT_FRAME_SECONDS * HIT_FRAME_COUNT;
/** Frame number (`1`-based) for a hit effect of the given age, or `null` once it has finished. */
export function hitFrame(age: number): number | null { return age < 0 || age >= HIT_DURATION ? null : Math.min(HIT_FRAME_COUNT - 1, Math.floor(age / HIT_FRAME_SECONDS)) + 1; }
