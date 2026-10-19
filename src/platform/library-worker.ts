import { storeProjectDirect } from './library.ts';
import { applySnapshotPart } from './recovery-transfer.ts';
import type { SnapshotPart } from './recovery-transfer.ts';
import type { StoredProject } from './library.ts';
import type { Chart } from '../core/types.ts';

/**
 * The background-save worker.
 *
 * A project arrives in pieces: a `begin` message with its metadata and asset lengths, one `chart`
 * message per snapshot part, one `asset` message per byte chunk and a final `commit`. Assets are
 * assembled as Blobs so a large music file is never copied into a second contiguous buffer; the
 * library's reader converts them back to `Uint8Array` for the public API.
 */

/** The metadata a project starts with; `assets` and `chart` are streamed separately. */
type ProjectMetadata = Omit<StoredProject, 'assets' | 'chart'>;

type Incoming =
  | { kind: 'begin'; project: ProjectMetadata; assets: [string, number][] }
  | { kind: 'chart'; part: SnapshotPart }
  | { kind: 'asset'; index: number; offset: number; bytes: Uint8Array }
  | { kind: 'commit' };

/** The assembled project while chunks arrive. */
interface WorkerProject extends ProjectMetadata {
  chart?: Chart;
  assets: [string, Blob][];
}

/** The worker scope surface this entry point uses; the DOM lib types `self` as the window. */
interface WorkerScope {
  onmessage: ((event: MessageEvent<Incoming>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;

let project: WorkerProject | undefined;
let chart: unknown;
let media: { length: number; received: number; parts: BlobPart[] }[] = [];

scope.onmessage = async ({ data }) => {
  try {
    let result: unknown;
    if (data.kind === 'begin') {
      project = { ...data.project, assets: data.assets.map(([name]): [string, Blob] => [name, new Blob()]) };
      media = data.assets.map(([, length]) => ({ length, received: 0, parts: [] }));
    }
    else if (data.kind === 'chart') chart = applySnapshotPart(chart, data.part);
    else if (data.kind === 'asset') {
      const file = media[data.index];
      if (!file || data.offset !== file.received || file.received + data.bytes.length > file.length) throw Error('后台保存收到的素材分片不连续');
      file.parts.push(data.bytes as BlobPart); file.received += data.bytes.length;
      if (file.received === file.length) {
        // Blob-backed IDB records avoid allocating a second contiguous buffer for
        // every asset. The public reader still returns the original Uint8Array API.
        project!.assets[data.index]![1] = new Blob(file.parts); file.parts = [];
      }
    }
    else if (data.kind === 'commit') {
      if (media.some(file => file.received !== file.length)) throw Error('后台保存素材不完整');
      result = await storeProjectDirect({ ...project!, chart: chart as Chart } as unknown as StoredProject);
    }
    scope.postMessage({ ok: true, result });
  } catch (error) {
    const record = error as { name?: string; message?: string; projectId?: string; expectedRevision?: string | null; actualRevision?: string | null };
    scope.postMessage({ ok: false, name: record.name, message: record.message, projectId: record.projectId, expectedRevision: record.expectedRevision, actualRevision: record.actualRevision });
  }
};

scope.postMessage({ ready: true });
