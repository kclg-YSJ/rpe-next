import { storeProjectDirect } from './library.mjs';
import { applySnapshotPart } from './recovery-transfer.mjs';
import { t } from '../i18n.mjs';

let project, chart, media;
self.onmessage = async ({ data }) => {
  try {
    let result;
    if (data.kind === 'begin') {
      project = { ...data.project, assets: data.assets.map(([name]) => [name, new Blob()]) };
      media = data.assets.map(([, length]) => ({ length, received: 0, parts: [] }));
    }
    else if (data.kind === 'chart') chart = applySnapshotPart(chart, data.part);
    else if (data.kind === 'asset') {
      const file = media[data.index];
      if (!file || data.offset !== file.received || file.received + data.bytes.length > file.length) throw Error(t('library-worker.s56b7141'));
      file.parts.push(data.bytes); file.received += data.bytes.length;
      if (file.received === file.length) {
        // Blob-backed IDB records avoid allocating a second contiguous buffer for
        // every asset. The public reader still returns the original Uint8Array API.
        project.assets[data.index][1] = new Blob(file.parts); file.parts = [];
      }
    }
    else if (data.kind === 'commit') {
      if (media.some(file => file.received !== file.length)) throw Error(t('library-worker.s30f5e2e'));
      result = await storeProjectDirect({ ...project, chart });
    }
    self.postMessage({ ok: true, result });
  } catch (error) { self.postMessage({ ok: false, name: error.name, message: error.message, projectId: error.projectId, expectedRevision: error.expectedRevision, actualRevision: error.actualRevision }); }
};
self.postMessage({ ready: true });
