import { formatBeat, parseBeat } from '../core/beat.ts';
import { easing, bezier } from '../core/easing.ts';
import { selectedEvents, transformEvents, deleteEvents, eventList, eventListAt, eventKey } from '../application/event-commands.ts';
import { captureSelection, editCapturedSelection, commitSelectionEdit } from '../application/batch-edit.ts';

import { EASING_NAMES, createEasingPicker } from './easing-picker.ts';
import { numericWheel } from './numeric-wheel.ts';
import { EVENT_WHEEL_STEPS } from '../core/note-editing.ts';
import { renderShaderInspector } from './shader-inspector.ts';
import { canCutEvent } from '../application/event-tools.ts';
import { runEventTool } from './event-tools.ts';
import type { Notify } from './event-tools.ts';
import type { EventSelectionEntry } from '../application/event-commands.ts';
import type { EditorSession } from '../application/session.ts';
import type { TempoMap } from '../core/tempo.ts';
import type { AnyEventType, Beat, ChartEvent, Color, EventValue } from '../core/types.ts';
export { EASING_NAMES } from './easing-picker.ts';

/** {@link inspectorEntries}: `lineIndex` is filled in for the single-line path by the caller. */
type EventInspectorEntry = EventSelectionEntry & { lineIndex: number };

/** How one event value is presented and parsed back. `beat` and `duration` parse as beat triples. */
type EventFieldKind = 'beat' | 'duration' | 'number' | 'text' | 'array';

/** A patch applied to one event; `end` is present only when the event is hooked. */
interface EventPatch {
  start?: EventValue;
  end?: EventValue;
  inst?: number;
  bezier?: number;
  bezierPoints?: number[];
  easingType?: number;
}

const galleryState = { open: false };

/** The event transform {@link applyEventTransform} hands to the batch helpers. */
type EventFieldTransform = (event: ChartEvent) => ChartEvent;

function inspectorEntries(session: EditorSession): EventInspectorEntry[] {
  if (session.multiLineActive && session.multiLineMode === 'events') {
    return [...(session.multiEventSelection ?? new Map())].flatMap(([lineIndex, keys]) => [...keys].map(key => {
      const [type, indexText] = String(key).split(':'); const index = Number(indexText);
      return { type: type as AnyEventType, index, lineIndex, event: eventListAt(session, lineIndex, type as AnyEventType)[index] };
    })).filter((entry): entry is EventInspectorEntry => Boolean(entry.event));
  }
  // The single-line path reports its own line index, which `EventSelectionEntry` does not carry.
  return selectedEvents(session).map(entry => ({ ...entry, lineIndex: session.lineIndex }));
}

function applyEventTransform(session: EditorSession, label: string, transform: EventFieldTransform): void {
  if (session.multiLineActive && session.multiLineMode === 'events') {
    const result = editCapturedSelection(captureSelection(session), { event: transform });
    commitSelectionEdit(session, result, label);
  } else transformEvents(session, label, transform);
}

export function renderEventInspector(session: EditorSession, tempo: TempoMap, currentBeat: () => number, reportError: (error: unknown) => void, notify: Notify = () => {}): void {
  const container = document.querySelector('#event-properties') as HTMLElement; container.replaceChildren();
  const entries: EventInspectorEntry[] = inspectorEntries(session); const event = entries[0]?.event; const eventType = entries[0]?.type;
  (document.querySelector('#event-selection-count') as HTMLElement).textContent = `${entries.length} 已选`;
  if (!event || !eventType) { const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = '点击事件查看属性；拖动移动，拖动上/下边缘调整时间。Shift 框选，Ctrl 多选。事件区按 R 两次确定起止拍，Esc 取消。'; container.append(hint); return; }
  if (eventType === 'paintEvents') { renderShaderInspector(container, session, reportError, () => renderEventInspector(session, tempo, currentBeat, reportError, notify)); return; }
  const safely = (action: () => void): void => { try { action(); } catch (error) { reportError(error); } };
  const valueKind = (type: AnyEventType, value: EventValue): EventFieldKind => type === 'colorEvents' && Array.isArray(value) ? 'array' : type === 'textEvents' && typeof value === 'string' ? 'text' : Array.isArray(value) ? 'array' : 'number';
  const valueTitle = eventType === 'alphaEvents' ? ['起始透明度', '结束透明度'] : eventType === 'speedEvents' ? ['起始速度', '结束速度'] : eventType === 'colorEvents' ? ['起始颜色', '结束颜色'] : eventType === 'textEvents' ? ['起始文字', '结束文字'] : ['起始值', '结束值'];
  const fields: [string, string, EventFieldKind][] = [['startTime', '开始拍', 'beat'], ['endTime', '结束拍', 'beat'], ['start', valueTitle[0], valueKind(eventType, event.start)], ['end', valueTitle[1], valueKind(eventType, event.end)], ['easingLeft', '缓动左边界', 'number'], ['easingRight', '缓动右边界', 'number'], ['linkgroup', '绑定组编号', 'number']];
  const applyField = (input: HTMLInputElement, key: string, title: string, kind: EventFieldKind, quiet = false): void => {
    const update = (): void => {
    let value: EventValue;
    if (kind === 'beat') value = parseBeat(input.value);
    else if (kind === 'array') {
      const values = input.value.split(',').map(Number);
      if (values.length !== 3 || values.some(number => !Number.isFinite(number))) throw new Error('颜色必须是 R,G,B 三个有限数字');
      value = values as Color;
    } else if (kind === 'number') {
      value = Number(input.value);
      if (!input.value.trim() || !Number.isFinite(value)) return;
      if (eventType === 'alphaEvents' && (key === 'start' || key === 'end')) value = Math.max(0, Math.min(255, value));
      if (key === 'easingLeft' || key === 'easingRight') value = Math.max(0, Math.min(1, value));
      if (key === 'linkgroup') value = Math.max(0, Math.round(value));
    } else value = input.value;
    applyEventTransform(session, `修改事件${title}`, current => ({ ...current, [key]: value, ...(current.inst && (key === 'start' || key === 'end') ? { start: value, end: structuredClone(value) } : {}) }));
    };
    try { update(); } catch (error) { if (!quiet) reportError(error); }
  };
  for (const [key, title, kind] of fields) {
    const label = document.createElement('label'); label.className = 'field'; label.append(title);
    // Built as `HTMLInputElement`: both branches are `input` elements, and the field kinds that need
    // `min`/`max`/`step` are all inputs (never the elements `document.createElement('input')` could
    // otherwise widen to).
    const input: HTMLInputElement = document.createElement('input'); input.type = kind === 'number' ? 'number' : 'text'; input.step = 'any'; input.setAttribute('aria-label', `事件${title}`);
    // `min`/`max`/`step` are DOMString attributes, so the original's numeric writes are stored as
    // their decimal text; the parsed value is the same either way.
    if (key === 'easingLeft' || key === 'easingRight') { input.min = '0'; input.max = '1'; }
    if (eventType === 'alphaEvents' && (key === 'start' || key === 'end')) { input.min = '0'; input.max = '255'; }
    if (eventType === 'speedEvents' && (key === 'start' || key === 'end')) input.min = '0';
    if (key === 'linkgroup') { input.min = '0'; input.step = '1'; }
    // Every field kind except `beat`/`array` reports a plain scalar (number or string), which is what
    // an input's `value` holds; `String` keeps the concatenation the original's `number` branch did.
    const shown = event[key];
    input.value = kind === 'beat' ? formatBeat(event[key] as Beat) : kind === 'array' ? (event[key] as number[]).join(', ') : typeof shown === 'string' || typeof shown === 'number' ? String(shown) : String(key === 'easingRight' ? 1 : 0);
    input.onfocus = () => { session.liveEventEdit = true; };
    input.onblur = () => { session.liveEventEdit = false; queueMicrotask(() => { if (!session.liveEventEdit) renderEventInspector(session, tempo, currentBeat, reportError, notify); }); };
    input.oninput = () => { if (kind !== 'number' || input.value.trim()) applyField(input, key, title, kind, true); };
    input.onchange = () => applyField(input, key, title, kind);
    if (kind === 'number') {
      const step = key === 'easingLeft' || key === 'easingRight' ? 0.05 : key === 'linkgroup' ? 1 : session.eventWheelSteps?.[eventType] ?? EVENT_WHEEL_STEPS[eventType] ?? 1;
      input.step = String(step); numericWheel(input, step);
    }
    label.append(input); container.append(label);
  }
  const lockLabel = document.createElement('label'); lockLabel.className = 'field'; lockLabel.append('钩定（首尾同步）');
  const lock = document.createElement('input'); lock.type = 'checkbox'; lock.checked = Boolean(event.inst); lock.setAttribute('aria-label', '钩定');
  lock.onchange = () => safely(() => applyEventTransform(session, '修改事件钩定', current => ({ ...current, inst: lock.checked ? 1 : 0, ...(lock.checked ? { end: structuredClone(current.start) } : {}) })));
  lockLabel.append(lock); container.append(lockLabel);
  const link = Number(event.linkgroup ?? 0);
  const group = document.createElement('button'); group.type = 'button'; group.className = 'wide-button'; group.textContent = `选中绑定组 ${link}`;
  group.onclick = () => safely(() => {
    if (link <= 0) return;
    const selection = new Set<string>();
    for (const type of session.line?.eventLayers?.[session.eventLayer] ? Object.keys(session.line.eventLayers[session.eventLayer]) as AnyEventType[] : []) for (const [index, candidate] of (eventList(session, type) ?? []).entries()) if (Number(candidate.linkgroup) === link) selection.add(eventKey(type, index));
    if (session.line?.extended) for (const type of Object.keys(session.line.extended) as AnyEventType[]) for (const [index, candidate] of (eventList(session, type) ?? []).entries()) if (Number(candidate.linkgroup) === link) selection.add(eventKey(type, index));
    session.eventSelection = selection; session.notify();
  });
  if (link > 0) container.append(group);
  const label = document.createElement('label'); label.className = 'field'; label.append('缓动');
  const select = document.createElement('select'); select.setAttribute('aria-label', '事件缓动');
  EASING_NAMES.forEach((name, index) => { const option = document.createElement('option'); option.value = String(index + 1); option.textContent = `${index + 1} · ${name}`; select.append(option); });
  select.value = String(event.easingType ?? 1);
  select.onchange = () => safely(() => applyEventTransform(session, '修改缓动', current => ({ ...current, easingType: Number(select.value), bezier: 0 })));
  label.append(select); container.append(label);
  container.append(createEasingPicker(event.easingType ?? 1, value => safely(() => applyEventTransform(session, '修改缓动', current => ({ ...current, easingType: value, bezier: 0 }))), galleryState).element);
  const curve = document.createElement('canvas'); curve.width = 260; curve.height = 100; curve.className = 'easing-preview'; curve.setAttribute('aria-label', '缓动曲线预览');
  const context = curve.getContext('2d') as CanvasRenderingContext2D; context.strokeStyle = '#ffd76a'; context.lineWidth = 2; context.beginPath();
  for (let index = 0; index <= 100; index++) {
    const progress = index / 100;
    const value = event.bezier ? bezier(progress, event.bezierPoints) : easing(progress, event.easingType, event.easingLeft ?? 0, event.easingRight ?? 1);
    const horizontal = 10 + progress * 240; const vertical = 80 - value * 60;
    if (index === 0) context.moveTo(horizontal, vertical); else context.lineTo(horizontal, vertical);
  } context.stroke(); container.append(curve);
  context.save(); context.strokeStyle = '#8da4c7'; context.setLineDash([3, 3]);
  for (const boundary of [event.easingLeft ?? 0, event.easingRight ?? 1]) { const x = 10 + Math.max(0, Math.min(1, boundary)) * 240; context.beginPath(); context.moveTo(x, 10); context.lineTo(x, 88); context.stroke(); }
  context.restore();
  const bezierLabel = document.createElement('label'); bezierLabel.className = 'field'; bezierLabel.append('Bezier');
  const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = Boolean(event.bezier); enabled.setAttribute('aria-label', '启用 Bezier');
  enabled.onchange = () => safely(() => applyEventTransform(session, '切换 Bezier', current => ({ ...current, bezier: Number(enabled.checked), bezierPoints: Array.isArray(current.bezierPoints) && current.bezierPoints.length === 4 && current.bezierPoints.slice(2).some(Number) ? current.bezierPoints : [0, 0, 1, 1] })));
  bezierLabel.append(enabled); container.append(bezierLabel);
  if (event.bezier) {
    const storedPoints = event.bezierPoints;
    const bezierPoints: number[] = Array.isArray(storedPoints) && storedPoints.length === 4 && storedPoints.slice(2).some(Number) ? storedPoints : [0, 0, 1, 1];
    const points = document.createElement('input'); points.setAttribute('aria-label', 'Bezier 控制点'); points.value = bezierPoints.join(', '); points.className = 'wide-field';
    points.onchange = () => safely(() => applyEventTransform(session, '修改 Bezier', current => ({ ...current, bezierPoints: points.value.split(',').map(Number) })));
    container.append(points);
    const dragCanvas = document.createElement('canvas'); dragCanvas.width = 260; dragCanvas.height = 100; dragCanvas.className = 'easing-preview bezier-editor';
    const draftPoints = [...bezierPoints]; let dragPoint: number | null = null; let dragChanged = false;
    const drawBezier = () => { const draw = dragCanvas.getContext('2d') as CanvasRenderingContext2D; draw.clearRect(0, 0, 260, 100); draw.strokeStyle = '#65748a'; draw.setLineDash([3, 3]); draw.beginPath(); draw.moveTo(10, 80); draw.lineTo(10 + draftPoints[0] * 240, 80 - draftPoints[1] * 60); draw.moveTo(250, 20); draw.lineTo(10 + draftPoints[2] * 240, 80 - draftPoints[3] * 60); draw.stroke(); draw.setLineDash([]); draw.strokeStyle = '#ffd76a'; draw.lineWidth = 2; draw.beginPath(); for (let index = 0; index <= 100; index++) { const progress = index / 100; const value = bezier(progress, draftPoints); const x = 10 + progress * 240; const y = 80 - value * 60; index ? draw.lineTo(x, y) : draw.moveTo(x, y); } draw.stroke(); draw.fillStyle = '#fff2a8'; for (const point of [[draftPoints[0], draftPoints[1]], [draftPoints[2], draftPoints[3]]]) { draw.beginPath(); draw.arc(10 + point[0] * 240, 80 - point[1] * 60, 5, 0, Math.PI * 2); draw.fill(); } };
    drawBezier();
    const commitBezier = () => { if (!dragChanged) return; const committed = [...draftPoints]; safely(() => applyEventTransform(session, '拖动 Bezier 控制点', current => ({ ...current, bezierPoints: committed }))); dragChanged = false; };
    const canvasPoint = (pointer: PointerEvent): { x: number; y: number } => {
      const rect = dragCanvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (pointer.clientX - rect.left - 10) / 240)),
        y: Math.max(0, Math.min(1, 1 - ((pointer.clientY - rect.top - 20) / 60))),
      };
    };
    dragCanvas.onpointerdown = pointer => {
      pointer.preventDefault();
      const point = canvasPoint(pointer);
      const candidates = [0, 2].map(index => ({ index, distance: Math.hypot(point.x - draftPoints[index], point.y - draftPoints[index + 1]) }));
      const nearest = candidates.reduce((best, candidate) => candidate.distance < best.distance ? candidate : best);
      if (nearest.distance > 0.14) return;
      dragPoint = nearest.index;
      dragChanged = false;
      dragCanvas.setPointerCapture(pointer.pointerId);
    };
    dragCanvas.onpointermove = pointer => {
      if (dragPoint == null) return;
      pointer.preventDefault();
      const point = canvasPoint(pointer);
      draftPoints[dragPoint] = point.x; draftPoints[dragPoint + 1] = point.y;
      points.value = draftPoints.map(value => value.toFixed(3)).join(', ');
      dragChanged = true;
      drawBezier();
    };
    const finishDrag = (pointer: PointerEvent | null): void => {
      if (dragPoint == null) return;
      if (pointer?.pointerId !== undefined && dragCanvas.hasPointerCapture(pointer.pointerId)) dragCanvas.releasePointerCapture(pointer.pointerId);
      commitBezier(); dragPoint = null;
    };
    dragCanvas.onpointerup = finishDrag;
    dragCanvas.onpointercancel = finishDrag;
    container.append(dragCanvas);
  }
  const actions = document.createElement('div'); actions.className = 'action-grid';
  for (const [action, title] of [['stick', '粘合前一事件'], ['cut', '切割事件']] as [string, string][]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = title;
    if (action === 'cut') { button.disabled = !canCutEvent(eventType, event); button.title = '按横线细分 × 切割密度生成线性事件段；密度可在设置中调整。文字、着色器不支持切割。'; }
    // `eventType` is narrowed to `'paintEvents'`-excluded by the early return above; re-widening it
    // here is what lets `runEventTool` receive the session it declares for itself.
    button.onclick = () => runEventTool(session as EditorSession & { division: number; cutDensity: number }, action, notify, currentBeat()); actions.append(button);
  }
  for (const [title, action] of [['首尾交换', () => transformEvents(session, '交换事件首尾', current => ({ ...current, start: current.end, end: current.start }))], ['删除事件', () => deleteEvents(session)]] as [string, () => void][]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = title; button.onclick = () => safely(action); actions.append(button);
  } container.append(actions);
}
