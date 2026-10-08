/**
 * Runs `callback` when the browser is next idle, so a background save does not compete with a frame.
 * `requestIdleCallback` is not available everywhere, so a macrotask is the fallback.
 */
export function scheduleSave(callback: () => void): void {
  if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(callback, { timeout: 500 });
  else setTimeout(callback, 0);
}

/**
 * Serialises saves per owner so two saves of the same document cannot interleave.
 *
 * `capture` snapshots the document synchronously, at the moment the save was requested, so the bytes
 * written are the ones the user asked for even though the write itself is deferred; `complete` runs
 * only after the write succeeds. A second request for an owner that is already saving returns the
 * in-flight promise instead of queueing another write.
 *
 * `Project` is inferred from `write` at construction. The snapshot shape is inferred per call instead
 * of being a class parameter, because a caller's capture closure returns more than the project — the
 * document it saved, for example — and that extra shape is only knowable at the call site.
 */
export class ManualSaveQueue<Project> {
  write: (project: Project) => Promise<unknown> | unknown;
  schedule: (callback: () => void) => void;
  pending: Map<unknown, Promise<Project>>;

  constructor(write: (project: Project) => Promise<unknown> | unknown, schedule: (callback: () => void) => void = scheduleSave) {
    this.write = write;
    this.schedule = schedule;
    this.pending = new Map();
  }

  save<Snapshot extends { project: Project }>(owner: unknown, capture: () => Snapshot, complete: (snapshot: Snapshot) => void): Promise<Project> {
    const existing = this.pending.get(owner);
    if (existing) return existing;
    const snapshot = capture();
    const operation = new Promise<Project>((resolve, reject) => {
      this.schedule(async () => {
        try { await this.write(snapshot.project); complete(snapshot); resolve(snapshot.project); }
        catch (error) { reject(error); }
      });
    }).finally(() => this.pending.delete(owner));
    this.pending.set(owner, operation);
    return operation;
  }
}
