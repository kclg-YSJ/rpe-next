import { t } from '../i18n.mjs';

export async function createEditorCapture() {
  const bridge = globalThis.rpenEditorCapture;
  if (bridge?.version !== 1) throw Error(t('editor-recording.desktopRequired'));
  const call = async (action, id) => { const value = await bridge.call(action, id); if (!value.ok) throw Error(value.error); return value.result; };
  const { id, fence: supportsFence = false } = await call('begin', { raw: typeof globalThis.VideoFrame === 'function' });
  let closed = false, pending = null, serial = 0;
  const receive = event => {
    if (!pending || event.source !== window || event.origin !== location.origin || event.data?.type !== 'rpen-editor-capture-frame' || event.data.requestId !== pending.requestId) return;
    const request = pending; pending = null;
    const result = event.data.result;
    if (result?.ok) request.resolve(result.result); else request.reject(Error(result?.error || t('editor-recording.invalidFrame')));
  };
  const transferred = typeof bridge.requestFrame === 'function';
  if (transferred) window.addEventListener('message', receive);
  const requestFrame = value => {
    if (!transferred) return call('frame', value);
    if (pending || closed) return Promise.reject(Error(t('editor-recording.invalidFrame')));
    return new Promise((resolve, reject) => {
      const requestId = `${id}:${++serial}`; pending = { requestId, resolve, reject };
      try { bridge.requestFrame(requestId, value); } catch (error) { pending = null; reject(error); }
    });
  };
  return { supportsFence, async frame(fence) {
    const result = await requestFrame(supportsFence && fence ? { id, fence } : id);
    if (result.format === 'BGRA' || result.format === 'RGBA') {
      if (result.bytes?.byteLength !== result.width * result.height * 4 || result.stride !== result.width * 4) throw Error(t('editor-recording.invalidFrame'));
      return { ...result, close() { this.bytes = null; } };
    }
    const bitmap = await createImageBitmap(new Blob([result.bytes], { type: 'image/png' }));
    return { ...result, bytes: undefined, bitmap, close() { bitmap.close(); } };
  }, async dispose() {
    if (closed) return; closed = true;
    if (transferred) window.removeEventListener('message', receive);
    pending?.reject(new DOMException('Capture closed', 'AbortError')); pending = null;
    await call('end', id);
  } };
}
