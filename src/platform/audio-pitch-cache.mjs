import { openDatabase, ensureStore } from './storage.mjs';
import { PITCH_VERSION, encodePitchTrack, decodePitchTrack } from '../core/audio-pitch.mjs';
const abort = signal => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); };
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export async function pitchAudioKey(buffer, signal) {
  const hashes = [PITCH_VERSION, buffer.sampleRate, buffer.length, buffer.numberOfChannels];
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let offset = 0; offset < samples.length; offset += 262144) {
      abort(signal); hashes.push(hex(await crypto.subtle.digest('SHA-256', samples.subarray(offset, offset + 262144))));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  abort(signal); return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashes.join(':'))));
}
const database = () => openDatabase('rpen-audio-pitch-v1', 2, (db, tx, old) => {
  const tracks = ensureStore(db, tx, 'tracks', { keyPath: 'key' }), metadata = ensureStore(db, tx, 'metadata', { keyPath: 'key' });
  if (old === 1) tracks.openCursor().onsuccess = event => { const cursor = event.target.result; if (!cursor) return; const value = cursor.value; metadata.put({ key: value.key, used: value.used, size: value.bytes.byteLength }); cursor.continue(); };
});
async function browserCall(mode, action) {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const tx = db.transaction('tracks', mode), request = action(tx.objectStore('tracks')); tx.oncomplete = () => resolve(request?.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); }
  finally { db.close(); }
}
async function call(action, key, bytes) {
  if (globalThis.rpenAudioPitchCache?.version === 1) {
    const result = await globalThis.rpenAudioPitchCache.call(action, key, bytes);
    if (!result.ok) throw Error(result.error.message); return result.result;
  }
  if (typeof indexedDB === 'undefined') return null;
  if (action === 'read') return (await browserCall('readonly', store => store.get(key)))?.bytes ?? null;
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction(['tracks', 'metadata'], 'readwrite'), tracks = tx.objectStore('tracks'), meta = tx.objectStore('metadata');
    tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    if (action === 'clear') { tracks.clear(); meta.clear(); return; }
    meta.getAll().onsuccess = event => {
      let size = bytes.byteLength, count = 1;
      for (const item of event.target.result.sort((a, b) => b.used - a.used)) if (item.key !== key) { size += item.size; if (size > 32 * 1024 ** 2 || ++count > 32) { tracks.delete(item.key); meta.delete(item.key); } }
      const used = Date.now(); tracks.put({ key, bytes }); meta.put({ key, used, size: bytes.byteLength });
    };
  }); } finally { db.close(); }
}
export async function readPitchCache(key) { try { const bytes = await call('read', key); return bytes ? decodePitchTrack(bytes) : null; } catch { return null; } }
export const writePitchCache = (key, track) => call('write', key, encodePitchTrack(track));
export const clearPitchCache = () => call('clear');
