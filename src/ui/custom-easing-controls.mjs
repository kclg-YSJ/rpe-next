import { animationCurveValue, assertAnimationCurve } from '../core/animation-curve.mjs';
import { curveFromEvent } from '../core/animation-curve-edit.mjs';
import { withCustomEasing, eventNumericValue } from '../core/event-easing.mjs';
import { readCurveLibrary, saveCurveLibrary } from '../platform/animation-curve-library.mjs';
import { flushLocalPreferences } from '../platform/local-preferences.mjs';
import { mountAnimationCurveEditor } from './animation-curve-editor.mjs';
import { t } from '../i18n.mjs';
import { AnimationCurvePlayback } from '../application/animation-curve-preview.mjs';

let active;
export function closeAnimationCurveEditor() { active?.close(); }
export function animationCurvePlaybackActive() { return active?.playback.active === true; }
export function animationCurvePreviewState(timestamp) { return active?.playback.sample(timestamp) ?? null; }
const previewChanged = () => document.dispatchEvent(new Event('rpen-animation-curve-preview-changed'));
const node = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
// Registered before editor shortcut listeners; the floating workspace owns keys
// only while it has focus. Native text editing remains within its input.
let keyboardOwner = false;
globalThis.window?.addEventListener('keydown', event => {
  if (!active || !(active.root.contains(event.target) || keyboardOwner && event.target === document.body)) return;
  event.stopImmediatePropagation(); active.editor?.keydown(event);
}, true);
globalThis.window?.addEventListener('keyup', event => { if (active && (active.root.contains(event.target) || keyboardOwner && event.target === document.body)) event.stopImmediatePropagation(); }, true);
globalThis.document?.addEventListener('rpen-curve-library-changed', () => {
  for (const group of document.querySelectorAll('.custom-easing-group[open]')) group.refreshEasingTemplates?.();
});
export function openAnimationCurveEditor({ event, apply, read, report, preview, cancelPreview, timing, signature, capture, restore, previewChart }) {
  active?.close();
  let templates;
  try { templates = readCurveLibrary(); } catch (error) { report(error); return; }
  const root = document.createElement('section'); root.id = 'animation-curve-editor'; root.className = 'animation-curve-window';
  document.body.append(root);
  let invalidated = false;
  let disposed = false, last = structuredClone(event), current = JSON.stringify(event), initialSignature = signature?.(), editor, committing = false;
  const playback = new AnimationCurvePlayback({ event: last, timing, previewChart });
  const snapshot = () => structuredClone(capture?.() ?? [read?.() ?? last]);
  const stale = () => signature && signature() !== initialSignature || read && JSON.stringify(read()) !== current;
  const notify = (type, detail) => editor?.message(type, detail);
  const request = (type, detail) => {
    if (disposed) throw Error(t('animation-curve.stale'));
    if (type === 'closed') { close(); return; }
    if (type === 'cancelPreview') { cancelPreview?.(); if (!invalidated && !stale()) playback.update(); previewChanged(); return; }
    if (type === 'playhead') return playback.sample(detail);
    try {
      if (type === 'playback') {
        if (detail) { if (invalidated || stale()) throw Error(t('animation-curve.stale')); cancelPreview?.(); playback.start(detail, performance.now()); }
        else playback.stop();
        previewChanged(); return;
      }
      if (['apply', 'restore', 'preview'].includes(type)) {
        if (invalidated || stale()) throw Error(t('animation-curve.stale'));
        assertAnimationCurve(type === 'restore' ? detail.curve : detail);
        if (type === 'preview') { preview?.(detail); playback.update(detail); previewChanged(); return; }
        cancelPreview?.();
        const next = type === 'restore' ? detail.state[0] : last.customEasing ? { ...last, customEasing: { ...last.customEasing, curve: detail } } : withCustomEasing(last, detail);
        if (type !== 'restore' && last.customEasing && (typeof next.start === 'number' || Array.isArray(next.start))) { next.start = eventNumericValue(next, 0); next.end = eventNumericValue(next, 1); }
        committing = true;
        try { if (type === 'restore') restore(detail.state); else apply(next); } finally { committing = false; }
        last = structuredClone(read?.() ?? next);
        if (read && JSON.stringify(last.customEasing) !== JSON.stringify(next.customEasing)) throw Error(t('animation-curve.applyRejected'));
        if (capture && !read && type !== 'restore' && capture().some(e => JSON.stringify(e.customEasing?.curve) !== JSON.stringify(detail))) throw Error(t('animation-curve.applyRejected'));
        current = JSON.stringify(last); initialSignature = signature?.(); playback.event = last; playback.update(); previewChanged(); notify('applied', { event: last, state: snapshot() });
      }
      if (type === 'library') {
        saveCurveLibrary(detail); templates = detail;
        document.dispatchEvent(new Event('rpen-curve-library-changed'));
        flushLocalPreferences().then(() => { if (!disposed) notify('librarySaved'); }, error => { if (!disposed) notify('error', error.message); report(error); });
      }
    } catch (error) { cancelPreview?.(); playback.stop(); previewChanged(); notify('error', error.message); throw error; }
  };
  function close() { if (disposed) return; editor?.dispose(); disposed = true; cancelPreview?.(); playback.stop(); previewChanged(); clearInterval(watch); document.removeEventListener('pointerdown', focus, true); document.removeEventListener('focusin', focus, true); window.removeEventListener('beforeunload', close); if (active?.root === root) active = null; keyboardOwner = false; }
  const focus = e => { keyboardOwner = root.contains(e.target); };
  document.addEventListener('pointerdown', focus, true); document.addEventListener('focusin', focus, true); window.addEventListener('beforeunload', close);
  // Check selection changes while the floating workspace is open. Do not alter
  // another selected event or continue a preview after the source was changed.
  const watch = setInterval(() => { if (!disposed && !invalidated && !committing && stale()) { invalidated = true; cancelPreview?.(); playback.stop(); previewChanged(); notify('invalid', t('animation-curve.stale')); } }, 250);
  try { editor = mountAnimationCurveEditor(root, { initial: { event: last, curve: curveFromEvent(last), templates, timing, state: snapshot() }, request }); }
  catch (error) { close(); root.remove(); report(error); return; }
  active = { root, editor, close, playback }; keyboardOwner = true; return root;
}
export function curveThumbnail(curve, title) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 100 72'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path'); let d = '';
  for (let i = 0; i <= 64; i++) d += `${i ? ' L' : 'M'}${8 + i / 64 * 84},${58 - animationCurveValue(curve, i / 64) * 44}`;
  path.setAttribute('d', d); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '2'); svg.append(path); svg.setAttribute('aria-label', title); return svg;
}
export function createCustomEasingControls(event, change, options = {}) {
  const group = node('details', null, 'custom-easing-group'); group.open = Boolean(event.customEasing);
  group.append(node('summary', t('animation-curve.templates')));
  const choices = node('div', null, 'custom-easing-gallery'); group.append(choices);
  const edit = node('button', t(event.customEasing ? 'animation-curve.edit' : 'animation-curve.create'), 'wide-button'); edit.type = 'button';
  const report = options.report ?? (error => { const status = node('p', error.message, 'error'); group.append(status); });
  edit.onclick = () => {
    const start = options.read?.() ?? event;
    openAnimationCurveEditor({ event: start, read: options.read, report, timing: options.timing, signature: options.signature, capture: options.capture, restore: state => { const targets = options.capture?.() ?? [options.read?.() ?? event]; const indices = new Map(targets.map((e, i) => [e, i])); change(current => { const i = targets.length === 1 ? 0 : indices.get(current); if (i === undefined || !state[i]) throw Error(t('animation-curve.stale')); const source = state[i], next = { ...current }; for (const key of ['start','end','customEasing','easingType','easingLeft','easingRight','bezier','bezierPoints']) { if (key in source) next[key] = structuredClone(source[key]); else delete next[key]; } return next; }); }, apply: next => change(current => {
      if (options.read) return { ...current, customEasing: structuredClone(next.customEasing), start: next.start, end: next.end, bezier: 0 };
      // A gallery can serve a multi-selection. Only transfer the curve, never
      // copy the first event's values, timing, ownership or private metadata.
      return withCustomEasing(current, next.customEasing.curve);
    }), preview: options.preview, cancelPreview: options.cancelPreview, previewChart: options.previewChart });
  };
  const current = node('small', event.customEasing?.curve.name || (event.customEasing ? t('animation-curve.unnamed') : ''), 'hint'); group.append(current, edit);
  const render = () => {
    choices.replaceChildren();
    try { for (const template of readCurveLibrary()) { const button = node('button', null, 'custom-easing-choice'); button.type = 'button'; button.title = template.name; button.append(curveThumbnail(template.curve, template.name), node('span', template.name)); button.onclick = () => { try { change(e => withCustomEasing(e, template.curve)); } catch (e) { report(e); } }; choices.append(button); } } catch (e) { report(e); }
  };
  group.refreshEasingTemplates = render;
  group.addEventListener('toggle', () => { if (group.open) render(); });
  if (group.open) render();
  return group;
}
