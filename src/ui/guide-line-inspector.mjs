import { formatBeat, parseBeat } from '../core/beat.mjs';
import { eventEasing, withStandardEasing, withCustomEasing } from '../core/event-easing.mjs';
import { EASING_NAMES, createEasingPicker } from './easing-picker.mjs';
import { createCustomEasingControls } from './custom-easing-controls.mjs';
import { beatInputControl } from './beat-input.mjs';
import { numericWheel } from './numeric-wheel.mjs';
import { editorSkinContext } from './editor-skin-canvas.mjs';
import { t } from '../i18n.mjs';

const node = (tag, text, className) => { const element = document.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element; };

export function renderGuideLineInspector(tool, container) {
  const guide = tool.guide; if (!guide) return;
  container.replaceChildren();
  const safely = action => { try { action(); tool.sync(); } catch (error) { tool.reportError(error); } };
  const heading = node('div', null, 'panel-title'); heading.append(node('span', t('guide-lines.title')));
  const close = node('button', '×', 'sample-button'); close.type = 'button'; close.title = t('guide-lines.close'); close.onclick = () => { tool.clear(); tool.activate('chart'); };
  heading.append(close); container.append(heading);
  const fields = new Map();
  const syncFields = () => {
    const current = tool.guide; if (!current) return;
    for (const [key, input] of fields) if (document.activeElement !== input) input.value = key.endsWith('Time') ? formatBeat(current[key]) : String(Number((current[key] ?? (key === 'easingRight' ? 1 : 0)).toFixed(2)));
  };
  for (const key of ['startTime', 'start', 'endTime', 'end', ...(!guide.customEasing ? ['easingLeft', 'easingRight'] : [])]) {
    const beat = key.endsWith('Time'), label = node('label', t('guide-lines.' + key), 'field'), input = node('input');
    input.type = beat ? 'text' : 'number'; input.dataset.guideField = key; input.setAttribute('aria-label', t('guide-lines.' + key)); input.autocomplete = 'off';
    input.value = beat ? formatBeat(guide[key]) : String(Number((guide[key] ?? (key === 'easingRight' ? 1 : 0)).toFixed(2)));
    const apply = (preview, quiet) => {
      try {
        if (!input.value.trim()) return;
        const value = beat ? parseBeat(input.value) : Number(input.value); if (!beat && !Number.isFinite(value)) return;
        tool.update({ [key]: value }, { preview }); input.classList.remove('numeric-expression-error'); input.removeAttribute('aria-invalid'); syncFields();
      } catch (error) { if (!quiet) { input.classList.add('numeric-expression-error'); input.setAttribute('aria-invalid', 'true'); tool.reportError(error); } }
    };
    input.onfocus = () => { tool.editingInput = true; };
    input.oninput = event => { if (!event.isComposing) apply(true, true); };
    input.onchange = () => { apply(false, false); };
    input.onblur = () => { safely(() => tool.finishDraft()); tool.editingInput = false; queueMicrotask(() => { if (container.isConnected) tool.sync(); }); };
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); tool.cancelDraft(); input.value = beat ? formatBeat(tool.guide[key]) : String(tool.guide[key]); input.blur(); tool.sync(); }
      if (event.key === 'Enter') { event.preventDefault(); apply(false, false); input.blur(); }
    });
    if (beat) label.append(beatInputControl(input, () => tool.timeline.division, tool.reportError));
    else { input.step = key.startsWith('easing') ? '.05' : '1'; numericWheel(input, Number(input.step)); label.append(input); }
    fields.set(key, input); container.append(label);
  }
  const keepLabel = node('label', t('guide-lines.keepSnapped'), 'field'), keep = node('input'); keep.type = 'checkbox'; keep.checked = guide.keepSnapped !== false;
  keep.dataset.guideField = 'keepSnapped'; keep.setAttribute('aria-label', t('guide-lines.keepSnapped'));
  keep.onchange = () => safely(() => tool.update({ keepSnapped: keep.checked })); keepLabel.append(keep); container.append(keepLabel);

  const easingLabel = node('label', t('event-inspector.s727b7cd'), 'field'), select = node('select'); select.dataset.guideField = 'easingType';
  select.setAttribute('aria-label', t('event-inspector.s727b7cd'));
  EASING_NAMES.forEach((name, index) => { const option = node('option', `${index + 1} · ${name}`); option.value = index + 1; select.append(option); });
  select.value = guide.easingType ?? 1; select.onchange = () => safely(() => tool.update(current => withStandardEasing(current, Number(select.value))));
  easingLabel.append(select); easingLabel.hidden = Boolean(guide.customEasing); container.append(easingLabel);
  container.append(createEasingPicker(guide.customEasing ? 0 : guide.easingType ?? 1, value => safely(() => tool.update(current => withStandardEasing(current, value))), tool.galleryState).element);
  const id = guide.id, read = () => tool.selected === id ? tool.read(id) : null;
  container.append(createCustomEasingControls(guide, change => safely(() => tool.update(change)), {
    report: tool.reportError, read, signature: () => JSON.stringify([tool.selected, read()]),
    timing: { BPMList: tool.getSession().chart.BPMList, factor: 1 },
    preview: curve => tool.update(current => withCustomEasing(current, curve), { preview: true }), cancelPreview: () => tool.cancelDraft(),
  }));
  const curve = node('canvas', null, 'easing-preview'); curve.width = 260; curve.height = 100; curve.setAttribute('aria-label', t('guide-lines.title'));
  const draw = event => {
    const context = editorSkinContext(curve.getContext('2d'), 'easing'); context.clearRect(0, 0, 260, 100); context.strokeStyle = '#ffd76a'; context.lineWidth = 2; context.beginPath();
    for (let i = 0; i <= 128; i++) { const x = 10 + i / 128 * 240, y = 80 - eventEasing(event, i / 128) * 60; i ? context.lineTo(x, y) : context.moveTo(x, y); } context.stroke();
    if (event.bezier && !event.customEasing) {
      context.strokeStyle = '#8da4c7'; context.fillStyle = '#ffd76a'; context.setLineDash([3, 3]);
      const points = event.bezierPoints;
      for (const [index, end] of [[0, [10, 80]], [2, [250, 20]]]) {
        const x = 10 + points[index] * 240, y = 80 - points[index + 1] * 60;
        context.beginPath(); context.moveTo(...end); context.lineTo(x, y); context.stroke(); context.beginPath(); context.arc(x, y, 5, 0, Math.PI * 2); context.fill();
      }
      context.setLineDash([]);
    }
  }; draw(guide); container.append(curve);
  if (!guide.customEasing) {
    const label = node('label', 'Bezier', 'field'), enabled = node('input'); enabled.type = 'checkbox'; enabled.checked = Boolean(guide.bezier); enabled.dataset.guideField = 'bezier'; enabled.setAttribute('aria-label', 'Bezier');
    enabled.onchange = () => safely(() => tool.update({ bezier: Number(enabled.checked), bezierPoints: tool.guide.bezierPoints ?? [0, 0, 1, 1] })); label.append(enabled); container.append(label);
    if (guide.bezier) {
      const input = node('input', null, 'wide-field'); input.value = guide.bezierPoints.join(', '); input.setAttribute('aria-label', t('event-inspector.sb1f6d6a')); input.dataset.guideField = 'bezierPoints';
      input.onchange = () => safely(() => tool.update({ bezierPoints: input.value.split(/[,，\s]+/).filter(Boolean).map(Number) })); container.append(input);
      let handle = null;
      const point = event => { const rect = curve.getBoundingClientRect(); return { x: (event.clientX - rect.left) * 260 / rect.width, y: (event.clientY - rect.top) * 100 / rect.height }; };
      curve.onpointerdown = event => {
        const p = point(event), points = tool.guide.bezierPoints;
        handle = [0, 2].find(index => Math.hypot(p.x - 10 - points[index] * 240, p.y - 80 + points[index + 1] * 60) < 12) ?? null;
        if (handle !== null) { event.preventDefault(); tool.editingInput = true; tool.beginDraft(); curve.setPointerCapture(event.pointerId); }
      };
      curve.onpointermove = event => {
        if (handle === null) return; const p = point(event), points = [...tool.guide.bezierPoints];
        points[handle] = Math.max(0, Math.min(1, (p.x - 10) / 240)); points[handle + 1] = (80 - p.y) / 60;
        safely(() => tool.update({ bezierPoints: points }, { preview: true })); input.value = points.map(value => Number(value.toFixed(3))).join(', '); draw(tool.guide);
      };
      curve.onpointerup = event => { if (handle === null) return; handle = null; curve.releasePointerCapture(event.pointerId); safely(() => tool.finishDraft()); tool.editingInput = false; tool.sync(); };
      curve.onpointercancel = () => { handle = null; tool.cancelDraft(); tool.sync(); };
    }
  }
  const remove = node('button', t('guide-lines.remove'), 'wide-button'); remove.type = 'button'; remove.dataset.guideAction = 'remove'; remove.onclick = () => safely(() => tool.remove()); container.append(remove);
}
