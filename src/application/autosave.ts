/** Persists a snapshot; may reject, in which case the failure is routed to `onError`. */
export type SaveHandler = () => void | Promise<void>;
/** Receives whatever the save handler threw; typed `unknown` because a rejection carries no guarantee. */
export type SaveErrorHandler = (error: unknown) => void;

/** Cooperative-timeout passed to `requestIdleCallback` so a save still runs on a busy frame. */
const IDLE_TIMEOUT_MS = 1000;

export class AutoSaveClock {
  /** Injected persistence callback. */
  save: SaveHandler;
  /** Injected failure reporter. */
  reportError: SaveErrorHandler;
  /** Timestamp (same clock as `tick`) of the last save. */
  last: number;
  /** True while a save is queued or in flight, so ticks cannot overlap. */
  pending: boolean;
  /**
   * Handle for the queued callback, or `null` when nothing is queued.
   *
   * The clock is whichever this runtime provides: a browser timer handle is a number, while Node's
   * `setTimeout` returns a `Timeout` object, and the idle-callback path returns neither.
   */
  timer: number | ReturnType<typeof globalThis.setTimeout> | null;

  constructor(save: SaveHandler, reportError: SaveErrorHandler) {
    this.save = save;
    this.reportError = reportError;
    this.last = 0;
    this.pending = false;
    this.timer = null;
  }
  reset(now: number): void { this.last = now; }
  tick(now: number, enabled: boolean, seconds: number, dirty: boolean): Promise<void> | undefined {
    if (!enabled || !dirty || this.pending || now - this.last < seconds * 1000) return;
    this.last = now; this.pending = true;
    let resolveSave: () => void;
    const finished = new Promise<void>(resolve => { resolveSave = resolve; });
    const save = async (): Promise<void> => {
      try { await this.save(); } catch (error) { this.reportError(error); }
      finally { this.pending = false; this.timer = null; resolveSave(); }
    };
    if (typeof globalThis.requestIdleCallback === 'function') {
      this.timer = globalThis.requestIdleCallback(save, { timeout: IDLE_TIMEOUT_MS });
    } else {
      this.timer = globalThis.setTimeout(save, 0);
    }
    return finished;
  }
}
