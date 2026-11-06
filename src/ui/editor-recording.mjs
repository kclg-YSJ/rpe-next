import { t } from '../i18n.mjs';
let lastFrameCode = 0xa5;

// A lightweight entry point; capture, audio processing and codecs are lazy.
export class EditorRecording {
  constructor(editor, hooks) { this.editor = editor; this.hooks = hooks; this.task = null; this.pending = null; }
  get active() { return Boolean(this.pending); }
  get capturing() { return this.task?.capturing === true; }
  toggle() {
    if (this.pending) { this.task?.stop(); return this.pending; }
    const task = { capturing: false, stopped: false, stop() { this.stopped = true; } };
    this.task = task;
    this.pending = import('../application/editor-recording.mjs').then(({ recordEditor }) => recordEditor(this.editor, { ...this.hooks, createIndicator: editorRecordingIndicator, showResult: result => showEditorRecordingResult(this.editor, result) }, task))
      .catch(error => { this.editor.notify(error.name === 'AbortError' ? t('editor-recording.cancelled') : error.message || String(error), error.name === 'AbortError' ? 'warning' : 'error', 8000); })
      .finally(() => { this.task = null; this.pending = null; });
    return this.pending;
  }
  async finish() { this.task?.stop(); await this.pending; }
}

export function editorRecordingIndicator(task) {
  const button = document.createElement('button'); button.id = 'editor-recording-status'; button.type = 'button';
  button.className = 'editor-recording-status'; button.setAttribute('aria-live', 'polite');
  button.title = t('editor-recording.stop'); button.onclick = () => task.stop();
  const label = document.createElement('span'), marker = document.createElement('canvas');
  marker.className = 'editor-recording-frame'; marker.hidden = true; marker.setAttribute('aria-hidden', 'true');
  button.append(label, marker);
  const baseCode = (lastFrameCode + 1) & 255;
  document.querySelector('body > footer').prepend(button);
  return { update(phase, frames = 0, fps = 60) {
    const seconds = Math.floor(frames / fps), time = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    const text = phase === 'recording' ? `● ${t('editor-recording.recording')} ${time} · ${fps} FPS` : t(`editor-recording.${phase}`);
    if (label.textContent !== text) label.textContent = text;
    if (button.dataset.phase !== phase) button.dataset.phase = phase;
    marker.hidden = phase !== 'recording';
  }, fence(index) {
    if (!marker.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return null;
    const rect = marker.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) return null;
    // This tiny progress strip is also a compositor fence. It changes after all
    // editor canvases, so an old surface cannot pass as the next output frame.
    const code = 0x500 | ((baseCode + index) & 255); lastFrameCode = code & 255;
    const width = Math.ceil(rect.width * devicePixelRatio), height = Math.ceil(rect.height * devicePixelRatio);
    if (marker.width !== width || marker.height !== height) { marker.width = width; marker.height = height; }
    const context = marker.getContext('2d', { alpha: false });
    for (let bit = 0; bit < 11; bit++) { context.fillStyle = code & (1 << bit) ? '#e0e0e0' : '#202020'; context.fillRect(bit * width / 11, 0, width / 11 + .01, height); }
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, code, viewportWidth: innerWidth, viewportHeight: innerHeight };
  }, dispose() { button.remove(); } };
}

export function showEditorRecordingResult(editor, result) {
  const host = document.querySelector('#notifications');
  if (!host) return;
  const item = document.createElement('div'); item.className = 'editor-notification success visible';
  item.append(t('editor-recording.saved', { name: result.name }));
  if (result.openFolder) {
    const open = document.createElement('button'); open.type = 'button'; open.textContent = t('render.openFolder');
    open.onclick = async () => { try { await result.openFolder(); } catch (error) { editor.notify(error.message, 'error'); } }; item.append(open);
  }
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', t('editor-recording.dismiss')); close.onclick = () => item.remove(); item.append(close);
  host.append(item);
  setTimeout(() => item.remove(), 30000);
}
