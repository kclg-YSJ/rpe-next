import { storageError } from './storage.mjs';
import { t } from '../i18n.mjs';

const ITEMS_PER_CHUNK = 128;
const BYTES_PER_CHUNK = 1024 * 1024;
const scalar = value => value === null || typeof value !== 'object';
const smallArray = value => Array.isArray(value) && value.length <= 16 && value.every(scalar);

function binary(value) { return value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value); }
function compact(value, binaries) {
  if (binaries && binary(value)) return false;
  if (scalar(value) || smallArray(value)) return true;
  if (Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return true;
  return Object.values(value).every(item => scalar(item) || smallArray(item));
}

// Keep each structured-clone operation small, including on charts with one very
// large note/event list. Beat arrays and ordinary note/event records stay whole.
export function* snapshotParts(value, path = [], binaries) {
  if (binaries && binary(value)) { binaries.push({ path, value }); yield { path, value: null }; return; }
  if (compact(value, binaries)) { yield { path, value }; return; }
  if (Array.isArray(value)) {
    yield { path, length: value.length };
    let offset = 0;
    while (offset < value.length) {
      if (!compact(value[offset], binaries)) { yield* snapshotParts(value[offset], [...path, offset], binaries); offset++; continue; }
      const start = offset; const values = [];
      while (offset < value.length && values.length < ITEMS_PER_CHUNK && compact(value[offset], binaries)) values.push(value[offset++]);
      yield { path, offset: start, values };
    }
  } else {
    const header = {}; const children = [];
    for (const key of Object.keys(value)) {
      if (compact(value[key], binaries)) Object.defineProperty(header, key, { value: value[key], enumerable: true, configurable: true, writable: true });
      else children.push(key);
    }
    yield { path, value: header };
    for (const key of children) yield* snapshotParts(value[key], [...path, key], binaries);
  }
}

export function applySnapshotPart(root, part) {
  const { path } = part;
  if ('offset' in part) {
    let array = root; for (const key of path) array = array[key];
    for (let index = 0; index < part.values.length; index++) array[part.offset + index] = part.values[index];
    return root;
  }
  const value = 'length' in part ? new Array(part.length) : part.value;
  if (!path.length) return value;
  let parent = root; for (const key of path.slice(0, -1)) parent = parent[key];
  Object.defineProperty(parent, path.at(-1), { value, enumerable: true, configurable: true, writable: true });
  return root;
}

async function transferPayload(worker, metadata, chart, assets) {
  let reply, timer;
  const receive = () => new Promise((resolve, reject) => {
    reply = { resolve, reject };
    timer = setTimeout(() => reject(new Error(t('recovery-transfer.s4e43388'))), 60000);
  });
  worker.onmessage = ({ data }) => {
    clearTimeout(timer);
    if (data.ok === false) reply?.reject(storageError(data, t('recovery-transfer.s57d1f4f')));
    else reply?.resolve(data.result);
  };
  worker.onerror = event => reply?.reject(new Error(event.message || t('recovery-transfer.sab27299')));
  worker.onmessageerror = () => reply?.reject(new Error(t('recovery-transfer.s668a321')));
  const send = (data, transfer = []) => { const response = receive(); worker.postMessage(data, transfer); return response; };
  try {
    await receive();
    await send({ kind: 'begin', ...metadata, assets: assets.map(([name, bytes]) => [name, bytes.byteLength]) });
    for (const part of snapshotParts(chart)) await send({ kind: 'chart', part });
    for (let index = 0; index < assets.length; index++) {
      const bytes = assets[index][1];
      for (let offset = 0; offset < bytes.byteLength; offset += BYTES_PER_CHUNK) {
        const chunk = bytes.slice(offset, offset + BYTES_PER_CHUNK);
        await send({ kind: 'asset', index, offset, bytes: chunk }, [chunk.buffer]);
      }
    }
    return await send({ kind: 'commit' });
  } finally { clearTimeout(timer); reply = null; worker.terminate(); }
}

export const transferSnapshot = (worker, [projectId, name, chart, assets, limit, viewState]) => transferPayload(worker, { projectId, name, limit, viewState }, chart, assets);
export function transferProject(worker, { chart, assets, ...project }) { return transferPayload(worker, { project }, chart, assets ?? []); }
