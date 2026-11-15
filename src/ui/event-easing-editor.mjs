import { bezier } from '../core/easing.mjs';
import { eventEasing, withStandardEasing, withCustomEasing } from '../core/event-easing.mjs';
import { curveFromEvent } from '../core/animation-curve-edit.mjs';
import { createEasingPopup } from './easing-picker.mjs';
import { createCustomEasingControls } from './custom-easing-controls.mjs';
import { createEasingCanvas, EASING_VIEW } from './easing-canvas.mjs';
import { t } from '../i18n.mjs';

const modeOf = event => event.customEasing ? 'custom' : event.bezier ? 'bezier' : 'standard';
const validPoints = points => Array.isArray(points) && points.length === 4 && points.every(Number.isFinite) && [points[0], points[2]].every(x => x >= 0 && x <= 1);
const pointsOf = event => validPoints(event.bezierPoints) ? [...event.bezierPoints] : [0, 0, 1, 1];
const node = (tag, cls) => { const element = document.createElement(tag); element.className = cls; return element; };
const { left, bottom, plotWidth, plotHeight } = EASING_VIEW;
const x = value => left + value * plotWidth, y = value => bottom - value * plotHeight;
const strokeCurve = (draw, sample) => {
  draw.strokeStyle = '#ffd76a'; draw.lineWidth = 2; draw.beginPath();
  for (let index = 0; index <= 200; index++) {
    const progress = index / 200, value = sample(progress);
    index ? draw.lineTo(x(progress), y(value)) : draw.moveTo(x(progress), y(value));
  }
  draw.stroke();
};

export function createEventEasingEditor(event, change, options) {
  const root = node('section', 'event-easing-editor'), mode = modeOf(event), views = [];
  const safely = action => { try { action(); } catch (error) { options.report(error); } };
  const update = (label, transform) => { change(label, transform); options.rerender(); };
  const tabs = node('div', 'event-easing-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', t('event-inspector.sa310d73'));
  const modes = [['standard', t('animation-curve.standard')], ['custom', t('animation-curve.templates')], ['bezier', 'Bezier']];
  for (const [index, [key, title]] of modes.entries()) {
    const tab = node('button', ''); tab.type = 'button'; tab.textContent = title; tab.id = `event-easing-${key}-tab`; tab.dataset.easingMode = key;
    tab.classList.toggle('active', key === mode);
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(key === mode)); tab.setAttribute('aria-controls', 'event-easing-panel'); tab.tabIndex = key === mode ? 0 : -1;
    tab.onclick = () => safely(() => {
      if (mode === key && (options.custom.capture?.() ?? [event]).every(current => modeOf(current) === key)) return;
      update(t('event-inspector.s4f19fa7'), current => key === 'standard' ? withStandardEasing(current, current.easingType ?? 1)
        : key === 'custom' ? current.customEasing ? current : withCustomEasing(current, curveFromEvent(current))
          : { ...withStandardEasing(current, current.easingType ?? 1), bezier: 1, bezierPoints: pointsOf(current) });
      document.getElementById?.(tab.id)?.focus({ preventScroll: true });
    });
    tab.onkeydown = keyEvent => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(keyEvent.key)) return;
      keyEvent.preventDefault(); keyEvent.stopPropagation();
      const target = keyEvent.key === 'Home' ? 0 : keyEvent.key === 'End' ? 2 : (index + (keyEvent.key === 'ArrowRight' ? 1 : 2)) % 3;
      tabs.children[target].click();
    };
    tabs.append(tab);
  }
  const panel = node('div', 'event-easing-panel'); panel.id = 'event-easing-panel'; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `event-easing-${mode}-tab`);
  root.append(tabs, panel);
  if (mode === 'standard') {
    const field = node('div', 'field'); field.append(t('event-inspector.s727b7cd'));
    field.append(createEasingPopup(event.easingType ?? 1, value => safely(() => {
      update(t('event-inspector.s4f19fa7'), current => withStandardEasing(current, value));
      document.querySelector('.event-easing-trigger')?.focus({ preventScroll: true });
    }), t('event-inspector.sa310d73')).element);
    panel.append(field);
  } else if (mode === 'custom') {
    panel.append(createCustomEasingControls(event, transform => safely(() => update(t('animation-curve.edit'), transform)), { ...options.custom, inline: true }));
  }
  let sync;
  if (mode !== 'bezier') {
    let previewEvent = event;
    const canvas = node('canvas', 'easing-preview'); canvas.setAttribute('aria-label', t('event-inspector.sa33a2cb')); panel.append(canvas);
    const preview = createEasingCanvas(canvas, 'easing', draw => {
      strokeCurve(draw, progress => eventEasing(previewEvent, progress));
      if (mode !== 'standard') return;
      draw.strokeStyle = '#8da4c7'; draw.lineWidth = 1; draw.setLineDash([3, 3]);
      for (const boundary of [previewEvent.easingLeft ?? 0, previewEvent.easingRight ?? 1]) {
        draw.beginPath(); draw.moveTo(x(Math.max(0, Math.min(1, boundary))), 10); draw.lineTo(x(Math.max(0, Math.min(1, boundary))), 88); draw.stroke();
      }
    });
    views.push(preview);
    sync = next => { previewEvent = next; preview.draw(); };
  }
  if (mode === 'standard') { const bounds = node('div', 'event-easing-boundaries'); bounds.append(...options.boundaryFields); panel.append(bounds); }
  if (mode === 'bezier') {
    const points = node('input', 'wide-field'); points.setAttribute('aria-label', t('event-inspector.sb1f6d6a')); points.value = pointsOf(event).join(', '); panel.append(points);
    points.onchange = () => safely(() => {
      const values = points.value.split(',').map(value => value.trim() ? Number(value) : NaN);
      if (!validPoints(values)) throw Error(t('event-inspector.invalidBezier'));
      update(t('event-inspector.sa5b4516'), current => ({ ...current, bezierPoints: values }));
    });
    const handles = node('canvas', 'easing-preview bezier-editor'); handles.setAttribute('aria-label', t('event-inspector.sb1f6d6a')); panel.append(handles);
    let draft = pointsOf(event), dragPoint = null, changed = false;
    const editor = createEasingCanvas(handles, 'bezier', draw => {
      draw.strokeStyle = '#65748a'; draw.lineWidth = 1; draw.setLineDash([3, 3]); draw.beginPath();
      draw.moveTo(x(0), y(0)); draw.lineTo(x(draft[0]), y(draft[1])); draw.moveTo(x(1), y(1)); draw.lineTo(x(draft[2]), y(draft[3])); draw.stroke(); draw.setLineDash([]);
      strokeCurve(draw, progress => bezier(progress, draft)); draw.fillStyle = '#fff2a8';
      for (const index of [0, 2]) { draw.beginPath(); draw.arc(x(draft[index]), y(draft[index + 1]), 5, 0, Math.PI * 2); draw.fill(); }
    });
    views.push(editor);
    sync = next => { if (dragPoint !== null) return; draft = pointsOf(next); points.value = draft.join(', '); editor.draw(); };
    handles.onpointerdown = pointer => {
      if ((pointer.button ?? 0) !== 0 || dragPoint !== null) return;
      const point = editor.point(pointer);
      const nearest = [0, 2].map(index => ({ index, distance: Math.hypot(point.x - x(draft[index]), point.y - y(draft[index + 1])) })).sort((a, b) => a.distance - b.distance)[0];
      if (nearest.distance > 12) return;
      pointer.preventDefault(); dragPoint = nearest.index; changed = false; options.setLive(true); handles.setPointerCapture(pointer.pointerId);
    };
    handles.onpointermove = pointer => {
      if (dragPoint === null) return;
      pointer.preventDefault(); const point = editor.point(pointer);
      draft[dragPoint] = Math.max(0, Math.min(1, (point.x - left) / plotWidth)); draft[dragPoint + 1] = Math.max(0, Math.min(1, (bottom - point.y) / plotHeight));
      points.value = draft.map(value => Number(value.toFixed(3))).join(', '); changed = true;
      editor.draw();
    };
    const finish = (pointer, apply) => {
      if (dragPoint === null) return;
      dragPoint = null; options.setLive(false);
      if (handles.hasPointerCapture(pointer.pointerId)) handles.releasePointerCapture(pointer.pointerId);
      if (apply && changed) safely(() => update(t('event-inspector.s5ae7fbe'), current => ({ ...current, bezierPoints: [...draft] })));
      else sync(event);
    };
    handles.onpointerup = pointer => finish(pointer, true);
    handles.onpointercancel = handles.onlostpointercapture = pointer => finish(pointer, false);
  }
  return { element: root, sync, draw: () => views.forEach(view => view.draw()), dispose: () => views.forEach(view => view.dispose()) };
}
