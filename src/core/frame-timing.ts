/**
 * Whether a frame-rate cap is one the editor can honour.
 *
 * `0` means "no cap", which is a valid choice; anything else must be finite and above 10 FPS, below
 * which a cap would be indistinguishable from a stall. The argument stays `unknown` because the value
 * arrives from persisted preferences and settings fields, so a stored string, `null` or `NaN` is
 * expected input that must be rejected rather than a type error.
 */
export function validFpsLimit(value: unknown): boolean {
  const limit = value as number;
  return limit === 0 || Number.isFinite(limit) && limit > 10;
}

/**
 * Caps how often a render callback runs, by holding back frames that arrive too early.
 *
 * The cap is a floor on the gap between frames, not a fixed cadence: a frame that arrives late is
 * accepted immediately, and the next deadline is advanced from it so the limiter cannot drift into a
 * burst of catch-up frames after a slow one.
 */
export class FrameLimiter {
  /** The cap currently in force; `0` means unlimited. */
  limit: number | null;
  /** The timestamp the next frame may be drawn at, or `null` before the first frame. */
  nextFrame: number | null;

  constructor() {
    this.limit = null;
    this.nextFrame = null;
  }

  shouldRender(timestamp: number, limit = 0): boolean {
    if (!validFpsLimit(limit)) limit = 0;
    if (!limit) { this.limit = 0; this.nextFrame = null; return true; }
    if (this.limit !== limit || this.nextFrame === null) {
      this.limit = limit;
      this.nextFrame = timestamp;
    }
    const interval = 1000 / limit;
    // A tenth of a percent of the interval, capped at 0.1 ms, so timer jitter does not push a frame
    // that is on time into the next slot.
    const tolerance = Math.min(0.1, interval / 100);
    if (timestamp + tolerance < this.nextFrame) return false;
    this.nextFrame = timestamp < this.nextFrame ? this.nextFrame + interval : timestamp + interval - ((timestamp - this.nextFrame) % interval);
    return true;
  }
}
