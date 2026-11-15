import { formatBeat, parseBeat } from '../core/beat.mjs';
import { selectedEvents, transformEvents, deleteEvents, eventList, eventListAt, eventKey } from '../application/event-commands.mjs';
import { captureSelection, editCapturedSelection, commitSelectionEdit } from '../application/batch-edit.mjs';
import { t } from '../i18n.mjs';

import { createEventEasingEditor } from './event-easing-editor.mjs';
import { previewSelectedCurve } from '../application/animation-curve-preview.mjs';
import { withCustomEasing } from '../core/event-easing.mjs';
import { numericWheel } from './numeric-wheel.mjs';
import { attachDraggableValue } from './draggable-value.mjs';
import { beatInputControl } from './beat-input.mjs';
import { EVENT_WHEEL_STEPS } from '../core/note-editing.mjs';
import { renderShaderInspector } from './shader-inspector.mjs';
import { canCutEvent } from '../application/event-tools.mjs';
import { runEventTool } from './event-tools.mjs';
import { evaluateEventNumber } from '../core/numeric-expression.mjs';
import { numericExpressionSource, setNumericExpressionResolver } from './numeric-expression-input.mjs';
import { createMovementVectorPanel } from './movement-vector-panel.mjs';
import { EVENT_VALUE_MEMORY_LIMIT, rememberEventValueChange, withEventLock } from '../application/event-value-memory.mjs';
export { EASING_NAMES } from './easing-picker.mjs';
const easingEditors = new WeakMap();
// Value change per pixel of label drag (the drag sensitivity setting scales it);
// the wheel step stays coarser on purpose.
const DRAG_UNITS = { moveXEvents: 1, moveYEvents: 1, rotateEvents: 0.5, alphaEvents: 1, speedEvents: 0.05, scaleXEvents: 0.01, scaleYEvents: 0.01 };

function inspectorEntries(session) {
  if (session.multiLineActive && session.multiLineMode === 'events') {
    return [...(session.multiEventSelection ?? new Map())].flatMap(([lineIndex, keys]) => [...keys].map(key => {
      const [type, indexText] = String(key).split(':'); const index = Number(indexText);
      return { type, index, lineIndex, event: eventListAt(session, lineIndex, type)?.[index] };
    })).filter(entry => entry.event);
  }
  return selectedEvents(session);
}

function applyEventTransform(session, label, transform, valueField) {
  if (session.multiLineActive && session.multiLineMode === 'events') {
    const result = editCapturedSelection(captureSelection(session), { event: transform });
    commitSelectionEdit(session, result, label);
    for (const change of result.changes.slice(0, EVENT_VALUE_MEMORY_LIMIT)) if (change.kind === 'events') {
      rememberEventValueChange(session, change.before, eventListAt(session, change.lineIndex, change.type)[change.index], valueField, { type: change.type, index: change.index });
    }
  } else transformEvents(session, label, transform, { valueField });
}

export function renderEventInspector(session, tempo, currentBeat, reportError, notify = () => {}, sampler = null) {
  if (session.liveEventEdit) return;
  const container = document.querySelector('#event-properties'); easingEditors.get(container)?.dispose(); easingEditors.delete(container); container.replaceChildren();
  const entries = inspectorEntries(session); const event = entries[0]?.event; const eventType = entries[0]?.type;
  document.querySelector('#event-selection-count').textContent = t('event-inspector.s50000b6', { p0: entries.length });
  if (!event) { const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = t('event-inspector.s04d3c47') + (session.rpeEventDrag !== true ? t('event-inspector.sa14758e') : t('event-inspector.s57ae1bc')) + t('event-inspector.s9adc988'); container.append(hint); return; }
  if (eventType === 'paintEvents') { renderShaderInspector(container, session, reportError, () => renderEventInspector(session, tempo, currentBeat, reportError, notify)); return; }
  const safely = action => { try { action(); } catch (error) { reportError(error); } };
  const valueKind = (type, value) => type === 'colorEvents' && Array.isArray(value) ? 'array' : type === 'textEvents' && typeof value === 'string' ? 'text' : Array.isArray(value) ? 'array' : 'number';
  const valueTitle = eventType === 'alphaEvents' ? [t('event-inspector.s7ff4e31'), t('event-inspector.s85fe18b')] : eventType === 'speedEvents' ? [t('event-inspector.s681e916'), t('event-inspector.s0e1d31f')] : eventType === 'colorEvents' ? [t('event-inspector.s37eb2f2'), t('event-inspector.s3bf81a3')] : eventType === 'textEvents' ? [t('event-inspector.s7aaf80e'), t('event-inspector.s70ef707')] : [t('event-inspector.s532cd47'), t('event-inspector.s00005a6')];
  const fields = [['startTime', t('event-inspector.s087c451'), 'beat'], ['endTime', t('event-inspector.sc4d3fa4'), 'beat'], ['start', valueTitle[0], valueKind(eventType, event.start)], ['end', valueTitle[1], valueKind(eventType, event.end)], ['easingLeft', t('event-inspector.s2fbff0e'), 'number'], ['easingRight', t('event-inspector.sb38574e'), 'number'], ['linkgroup', t('event-inspector.s50136f9'), 'number']];
  const boundaryFields = [];
  let movementPanel, easingEditor;
  const syncEasing = patch => {
    const entry = entries[0];
    const current = eventListAt({ chart: sampler?.draftChart ?? session.chart, eventLayer: session.eventLayer }, entry.lineIndex ?? session.lineIndex, entry.type)?.[entry.index];
    if (current) easingEditor?.sync({ ...current, ...patch });
  };
  const constrainNumber = (key, value) => {
    if (eventType === 'alphaEvents' && (key === 'start' || key === 'end')) return Math.trunc(Math.min(255, value));
    if (key === 'easingLeft' || key === 'easingRight') return Math.max(0, Math.min(1, value));
    if (key === 'linkgroup') return Math.max(0, Math.round(value));
    return value;
  };
  const writeValue = (key, title, value) => {
    applyEventTransform(session, t('event-inspector.sa47ceda', { p0: title }), current => {
      const next = constrainNumber(key, typeof value === 'function' ? value(current) : value);
      return { ...current, [key]: next, ...(current.inst && (key === 'start' || key === 'end') ? { start: next, end: structuredClone(next) } : {}) };
    }, key);
    movementPanel?.sync();
    syncEasing();
  };
  const applyField = (input, key, title, kind, quiet = false) => {
    const update = () => {
    let value;
    if (kind === 'beat') value = parseBeat(input.value);
    else if (kind === 'array') {
      const values = input.value.split(',').map(Number);
      if (values.length !== 3 || values.some(number => !Number.isFinite(number))) throw new Error(t('event-inspector.s63d7b60'));
      value = values.map(number => Math.max(0, Math.min(255, number)));
    } else if (kind === 'number') {
      const source = numericExpressionSource(input);
      if (String(source).trim().endsWith('v')) {
        const values = new Map(inspectorEntries(session).map(entry => [entry.event, evaluateEventNumber(source, {
          type: entry.type, field: key, event: entry.event, tempo,
          factor: session.chart.judgeLineList[entry.lineIndex ?? session.lineIndex].bpmfactor ?? 1,
        })]));
        writeValue(key, title, current => values.get(current)); return;
      }
      value = Number(input.value);
      if (!input.value.trim() || !Number.isFinite(value)) return;
    } else value = input.value;
    writeValue(key, title, value);
    };
    try { update(); } catch (error) { if (!quiet) reportError(error); }
  };
  // Drag the property name to scrub the value; the sampler previews every step
  // and the final value lands as a single undo step.
  const attachValueDrag = (label, input, key, title, step) => {
    const entry = entries[0];
    const target = { type: eventType, index: entry.index, lineIndex: entry.lineIndex ?? session.lineIndex, field: key };
    const integerField = key === 'linkgroup' || eventType === 'alphaEvents' && (key === 'start' || key === 'end');
    const base = key === 'easingLeft' || key === 'easingRight' ? 0.01 : key === 'linkgroup' ? 1 : DRAG_UNITS[eventType] ?? Math.max(0.01, step / 5);
    // Read the setting on every step so a change applies without rebuilding the field.
    const sensitivity = () => { const value = Number(session.dragSensitivity); return Number.isFinite(value) && value > 0 ? value : 1; };
    attachDraggableValue({
      label, input,
      canStart: () => !sampler?.mode,
      unit: () => base * sensitivity(),
      snap: base,
      minimum: input.min === '' ? -Infinity : Number(input.min),
      maximum: input.max === '' ? Infinity : Number(input.max),
      integer: integerField,
      hint: t('event-inspector.s6fb0abb', { p0: title }),
      read: () => { const text = String(input.value).trim(); const parsed = Number(text); return text && Number.isFinite(parsed) ? parsed : Number(event[key]) || 0; },
      preview: value => { const result = sampler ? sampler.updateValueDraft(target, value) : true; movementPanel?.sync(sampler?.draftChart ?? session.chart); if (result !== false) syncEasing({ [key]: value }); return result; },
      commit: value => safely(() => { if (sampler) { if (sampler.valueDraft) sampler.finishValue(true, t('event-inspector.s615e6b4', { p0: title })); } else writeValue(key, title, value); syncEasing(); }),
      cancel: () => { if (sampler?.valueDraft) sampler.finishValue(false); syncEasing(); },
    });
  };
  const samplePanel = (key, title, kind, value) => {
    const panel = document.createElement('div'); panel.className = 'event-sample-panel'; panel.hidden = true;
    const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = t('event-inspector.sca946bb', { p0: title });
    panel.append(hint);
    const target = { type: eventType, index: entries[0].index, lineIndex: entries[0].lineIndex ?? session.lineIndex, field: key };
    let sampleValue = structuredClone(value);
    const applySample = next => safely(() => {
      sampleValue = structuredClone(next);
      if (sampler) sampler.updateValueDraft(target, next);
      else applyEventTransform(session, t('event-inspector.secb9029', { p0: title }), current => ({ ...current, [key]: next, ...(current.inst && (key === 'start' || key === 'end') ? { start: structuredClone(next), end: structuredClone(next) } : {}) }), key);
    });
    const addRange = (labelText, min, max, step, initial, update) => {
      const label = document.createElement('label'); label.className = 'field'; label.append(labelText);
      const range = document.createElement('input'); range.type = 'range'; range.min = min; range.max = max; range.step = step; range.value = initial; range.setAttribute('aria-label', `${title}${labelText}`);
      const output = document.createElement('output'); output.textContent = String(initial);
      range.onpointerdown = () => { sampler?.beginValueDraft(); session.liveEventEdit = true; };
      range.oninput = () => { const next = update(Number(range.value)); output.textContent = Array.isArray(next) ? next.join(', ') : String(next); applySample(next); };
      label.append(range, output); panel.append(label);
    };
    if (kind === 'array') {
      const colors = Array.isArray(value) ? value : [255, 255, 255]; sampleValue = [...colors];
      const picker = document.createElement('input'); picker.type = 'color'; picker.value = '#' + colors.map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join(''); picker.setAttribute('aria-label', t('event-inspector.s5fc0ca5', { p0: title })); picker.oninput = () => { const hex = picker.value.slice(1); const next = [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16)); applySample(next); }; panel.append(picker);
      for (const [index, channel] of ['R', 'G', 'B'].entries()) addRange(channel, 0, 255, 1, colors[index], next => { const result = [...sampleValue]; result[index] = next; return result; });
    } else if (eventType === 'alphaEvents') {
      const wrap = document.createElement('div'); wrap.className = 'alpha-sample-wrap';
      const range = document.createElement('input'); range.type = 'range'; range.min = 0; range.max = 255; range.step = 1; range.value = Number(value) || 0; range.className = 'alpha-sample-gradient'; range.setAttribute('aria-label', t('event-inspector.s9fd79c2', { p0: title }));
      const output = document.createElement('output'); output.textContent = String(range.value); range.onpointerdown = () => { sampler?.beginValueDraft(); session.liveEventEdit = true; }; range.oninput = () => { output.textContent = String(range.value); applySample(Number(range.value)); }; wrap.append(range, output); panel.append(wrap);
    } else {
      const limits = eventType === 'alphaEvents' ? [0, 255, 1] : eventType === 'speedEvents' ? [-20, 20, 0.01] : eventType === 'rotateEvents' ? [-360, 360, 0.1] : [-2000, 2000, 0.1];
      addRange(t('event-inspector.s5215236'), ...limits, Number(value) || 0, next => next);
    }
    const actions = document.createElement('div'); actions.className = 'event-sample-actions';
    const apply = document.createElement('button'); apply.type = 'button'; apply.textContent = t('event-inspector.sbcfd4cb'); apply.onclick = () => sampler ? sampler.finishValue(true) : undefined;
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = t('event-inspector.s2052a51'); cancel.onclick = () => sampler ? sampler.finishValue(false) : undefined;
    const close = document.createElement('button'); close.type = 'button'; close.textContent = t('event-inspector.s382d24a');
    actions.append(apply, cancel, close); panel.append(actions);
    return { panel, close };
  };
  for (const [key, title, kind] of fields) {
    if (key === 'linkgroup' && entries.length === 1 && session.movementVector !== false && ['moveXEvents', 'moveYEvents'].includes(eventType) && session.focus === 'events') {
      movementPanel = createMovementVectorPanel(session, entries[0], { reportError, syncValues: () => {
        const current = inspectorEntries(session)[0]?.event;
        if (!current) return;
        for (const field of ['start', 'end']) {
          const input = container.querySelector(`input[data-rpen-field="${field}"]`);
          if (input && document.activeElement !== input) input.value = current[field];
        }
      } });
      container.append(movementPanel.element);
    }
    const label = document.createElement('label'); label.className = 'field'; label.append(title);
    const input = document.createElement('input'); input.type = kind === 'number' ? 'number' : 'text'; input.step = 'any'; input.setAttribute('aria-label', t('event-inspector.s21d101a', { p0: title }));
    input.dataset.rpenField = key; label.dataset.rpenField = key;
    if (key === 'easingLeft' || key === 'easingRight') { input.min = 0; input.max = 1; }
    if (eventType === 'alphaEvents' && (key === 'start' || key === 'end')) { input.max = 255; input.title = t('event-inspector.s845b6a4'); }
    if (eventType === 'speedEvents' && (key === 'start' || key === 'end')) { input.min = -20; input.max = 20; }
    if (key === 'linkgroup') { input.min = 0; input.step = 1; }
    input.value = kind === 'beat' ? formatBeat(event[key]) : kind === 'array' ? event[key].join(', ') : event[key] ?? (key === 'easingRight' ? 1 : 0);
    input.onfocus = () => { session.liveEventEdit = true; };
    input.onblur = (event = {}) => { session.liveEventEdit = false; const within = container.contains?.(event.relatedTarget); queueMicrotask(() => { if (!within && !session.liveEventEdit && !container.contains?.(document.activeElement)) renderEventInspector(session, tempo, currentBeat, reportError, notify, sampler); }); };
    input.oninput = event => { if (!event.isComposing && (kind !== 'number' || input.value.trim())) applyField(input, key, title, kind, true); };
    input.onchange = () => applyField(input, key, title, kind);
    if (kind === 'number') {
      if (eventType === 'moveYEvents' && ['start', 'end'].includes(key)) {
        setNumericExpressionResolver(input, source => {
          const entry = inspectorEntries(session)[0];
          return evaluateEventNumber(source, { type: entry.type, field: key, event: entry.event, tempo, factor: session.chart.judgeLineList[entry.lineIndex ?? session.lineIndex].bpmfactor ?? 1 });
        });
        input.title = t('event-inspector.sf9494d0');
      }
      const step = key === 'easingLeft' || key === 'easingRight' ? 0.05 : key === 'linkgroup' ? 1 : session.eventWheelSteps?.[eventType] ?? EVENT_WHEEL_STEPS[eventType] ?? 1;
      input.step = step; numericWheel(input, step);
      if (entries.length === 1) attachValueDrag(label, input, key, title, step);
    }
    const controls = document.createElement('span'); controls.className = 'event-input-controls'; controls.append(kind === 'beat' ? beatInputControl(input, () => session.division, reportError) : input);
    const samplingField = key === 'start' || key === 'end';
    const samplingType = ['moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents', 'speedEvents', 'colorEvents'].includes(eventType);
    if (samplingField && samplingType) {
      if (sampler && ['moveXEvents', 'moveYEvents', 'rotateEvents'].includes(eventType) && ['start', 'end'].includes(key)) {
        const open = document.createElement('button'); open.type = 'button'; open.className = 'sample-button'; open.textContent = '⌖'; open.title = t('event-inspector.sc5b1373', { p0: title });
        open.onclick = () => sampler.begin({ type: eventType, index: entries[0].index, field: key, lineIndex: entries[0].lineIndex ?? session.lineIndex });
        controls.append(open);
      } else {
        const sampling = samplePanel(key, title, kind, event[key]);
        const open = document.createElement('button'); open.type = 'button'; open.className = 'sample-button'; open.textContent = '⌖'; open.title = t('event-inspector.se2298d2');
        sampling.close.onclick = () => { sampling.panel.hidden = true; open.hidden = false; };
        open.onclick = () => { sampler?.beginValueDraft(); session.liveEventEdit = true; sampling.panel.hidden = false; open.hidden = true; };
        controls.append(open); label.append(controls); container.append(label); container.insertBefore(sampling.panel, label); continue;
      }
    }
    label.append(controls); if (key === 'easingLeft' || key === 'easingRight') boundaryFields.push(label); else container.append(label);
  }
  const lockLabel = document.createElement('label'); lockLabel.className = 'field'; lockLabel.append(t('event-inspector.s7787450'));
  const lock = document.createElement('input'); lock.type = 'checkbox'; lock.checked = Boolean(event.inst); lock.setAttribute('aria-label', t('event-inspector.sdb6c851'));
  lock.onchange = () => safely(() => applyEventTransform(session, t('event-inspector.s04b892d'), current => withEventLock(session, current, lock.checked)));
  lockLabel.append(lock); container.append(lockLabel);
  const link = Number(event.linkgroup ?? 0);
  const group = document.createElement('button'); group.type = 'button'; group.className = 'wide-button'; group.textContent = t('event-inspector.s0c9f607', { p0: link });
  group.onclick = () => safely(() => {
    if (link <= 0) return;
    const selection = new Set();
    for (const type of session.line?.eventLayers?.[session.eventLayer] ? Object.keys(session.line.eventLayers[session.eventLayer]) : []) for (const [index, candidate] of (eventList(session, type) ?? []).entries()) if (Number(candidate.linkgroup) === link) selection.add(eventKey(type, index));
    if (session.line?.extended) for (const type of Object.keys(session.line.extended)) for (const [index, candidate] of (eventList(session, type) ?? []).entries()) if (Number(candidate.linkgroup) === link) selection.add(eventKey(type, index));
    session.eventSelection = selection; session.notify();
  });
  if (link > 0) container.append(group);
  easingEditor = createEventEasingEditor(event, (label, transform) => applyEventTransform(session, label, transform), {
    boundaryFields, report: reportError,
    rerender: () => renderEventInspector(session, tempo, currentBeat, reportError, notify, sampler),
    setLive: value => { session.liveEventEdit = value; },
    custom: {
      report: reportError,
      previewChart: curve => previewSelectedCurve(session, inspectorEntries(session), curve),
      capture: () => inspectorEntries(session).map(entry => entry.event),
      signature: () => JSON.stringify([session.lineIndex, session.eventLayer, inspectorEntries(session).map(entry => [entry.lineIndex ?? session.lineIndex, entry.type, entry.index, entry.event])]),
      timing: { BPMList: session.chart.BPMList, factor: session.chart.judgeLineList[entries[0].lineIndex ?? session.lineIndex]?.bpmfactor ?? 1 },
      preview: entries.length === 1 && sampler ? curve => {
        const entry = entries[0], original = inspectorEntries(session)[0]?.event;
        if (!original) return;
        const customEasing = original.customEasing ? { ...original.customEasing, curve } : withCustomEasing(original, curve).customEasing;
        if (sampler.updateValueDraft({ type: entry.type, index: entry.index, lineIndex: entry.lineIndex ?? session.lineIndex, field: 'customEasing' }, customEasing) !== false) syncEasing();
      } : undefined,
      cancelPreview: () => { if (sampler?.valueDraft) sampler.finishValue(false); syncEasing(); },
      read: entries.length === 1 ? () => {
        const current = inspectorEntries(session);
        return current.length === 1 && current[0].type === eventType && current[0].index === entries[0].index
          && (current[0].lineIndex ?? session.lineIndex) === (entries[0].lineIndex ?? session.lineIndex) ? current[0].event : null;
      } : undefined,
    },
  });
  container.append(easingEditor.element); easingEditor.draw(); easingEditors.set(container, easingEditor);
  const actions = document.createElement('div'); actions.className = 'action-grid';
  for (const [action, title] of [['stick', t('event-inspector.sa21d009')], ['cut', t('event-inspector.se2c05eb')]]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = title;
    if (action === 'cut') { button.disabled = !canCutEvent(eventType, event); button.title = t('event-inspector.s2043de5'); }
    button.onclick = () => runEventTool(session, action, notify, currentBeat()); actions.append(button);
  }
  for (const [title, action] of [[t('event-inspector.sde3ab51'), () => transformEvents(session, t('event-inspector.sbe1585f'), current => ({ ...current, start: current.end, end: current.start }))], [t('event-inspector.sf10087a'), () => deleteEvents(session)]]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = title; button.onclick = () => safely(action); actions.append(button);
  } container.append(actions);
}
