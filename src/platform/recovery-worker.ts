import { saveSnapshotDirect } from './recovery.ts';
import { applySnapshotPart } from './recovery-transfer.ts';
import type { SnapshotPart } from './recovery-transfer.ts';

/** The messages the page posts to the recovery worker. */
type Incoming =
  | { kind: 'begin'; projectId: string | undefined; name: string; limit: number; viewState: Record<string, unknown>; assets: [string, number][] }
  | { kind: 'chart'; part: SnapshotPart }
  | { kind: 'asset'; index: number; offset: number; bytes: Uint8Array }
  | { kind: 'commit' };

/** The snapshot being assembled while chunks arrive. */
interface Snapshot {
  projectId: string | undefined;
  name: string;
  limit: number;
  viewState: Record<string, unknown>;
  assets: [string, Uint8Array][];
}

/** The worker scope surface this entry point uses; the DOM lib types `self` as the window. */
interface WorkerScope {
  onmessage: ((event: MessageEvent<Incoming>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;

let snapshot: Snapshot | null = null;
let chart: unknown;
scope.onmessage = async ({ data }) => {
  try {
    if (data.kind === 'begin') snapshot = { ...data, assets: data.assets.map(([name, length]): [string, Uint8Array] => [name, new Uint8Array(length)]) };
    else if (data.kind === 'chart') chart = applySnapshotPart(chart, data.part);
    else if (data.kind === 'asset') snapshot!.assets[data.index]![1].set(data.bytes, data.offset);
    else if (data.kind === 'commit') await saveSnapshotDirect(snapshot!.projectId, snapshot!.name, chart as never, snapshot!.assets, snapshot!.limit, snapshot!.viewState);
    scope.postMessage({ ok: true });
  }
  catch (error) { scope.postMessage({ ok: false, name: error instanceof Error ? error.name : undefined, message: error instanceof Error ? error.message : String(error) }); }
};
scope.postMessage({ ready: true });
