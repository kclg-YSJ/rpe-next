/**
 * Maps a thrown value to a diagnostic code.
 *
 * The browser's DOM exception names are reported verbatim when recognised, so a log line says
 * `AbortError` rather than a generic `Error`; anything else collapses to `Error`.
 */
export function mediaErrorCode(error: unknown): string {
  const name = error !== null && typeof error === 'object' ? (error as { name?: unknown }).name : undefined;
  return typeof name === 'string' && ['AbortError', 'TimeoutError', 'TypeError', 'DataCloneError', 'SecurityError', 'OperationError', 'NotSupportedError'].includes(name) ? name : 'Error';
}

/** One in-flight media operation, as reported by `snapshot()`. */
export interface MediaDiagnosticEntry {
  operation: number;
  stage: string;
  started: number;
  elapsedMs?: number;
  [key: string]: unknown;
}

/** The state reported for an operation when it finishes. */
export type MediaDiagnosticState = string;

/**
 * Tracks media operations and emits a start, periodic waiting, and terminal event for each.
 *
 * A 10-second heartbeat marks an operation as still waiting, which is what distinguishes "slow" from
 * "stuck" in the desktop diagnostics; the interval is unref'd so it never holds a Node process open.
 */
export class MediaDiagnostics {
  emit: (event: string, details: Record<string, unknown>) => void;
  sequence: number;
  active: Map<number, MediaDiagnosticEntry>;

  constructor(emit: (event: string, details: Record<string, unknown>) => void = () => {}) { this.emit = emit; this.sequence = 0; this.active = new Map(); }
  snapshot(): MediaDiagnosticEntry[] { return [...this.active.values()].map(entry => ({ ...entry, elapsedMs: Math.round(performance.now() - entry.started) })); }
  start(stage: string, details: Record<string, unknown> = {}): (state?: MediaDiagnosticState, extra?: Record<string, unknown>) => void {
    const operation = ++this.sequence; const started = performance.now();
    this.active.set(operation, { operation, stage, ...details, started });
    const report = (state: MediaDiagnosticState, extra: Record<string, unknown> = {}): void => this.emit(`media-${stage}-${state}`, { operation, ...details, elapsedMs: Math.round(performance.now() - started), ...extra });
    report('start');
    const timer = setInterval(() => report('waiting'), 10000); timer.unref?.();
    let ended = false;
    return (state: MediaDiagnosticState = 'complete', extra: Record<string, unknown> = {}) => {
      if (ended) return;
      ended = true; clearInterval(timer); this.active.delete(operation); report(state, extra);
    };
  }
}
