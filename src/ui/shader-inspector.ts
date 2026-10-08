import { beatValue, formatBeat, parseBeat, fromNumber } from '../core/beat.ts';
import { SHADER_NAMES } from '../core/shader.ts';
import { shaderIdentity, shaderTypeFields, shaderParameterTrack, shaderParameters, parseShaderValue, alignShaderTrack } from '../core/shader-events.ts';
import { selectedEvents, transformEvents, deleteEvents } from '../application/event-commands.ts';
import { EASING_NAMES, createEasingPicker } from './easing-picker.ts';
import type { EasingPickerState } from './easing-picker.ts';
import { numericWheel } from './numeric-wheel.ts';
import { assetUrl } from '../core/asset-url.ts';
import type { EditorSession } from '../application/session.ts';
import type { Beat, ChartEvent } from '../core/types.ts';
import type { ShaderParameterDefinition, ShaderParameterSegment, ShaderParameterTrack } from '../core/shader-events.ts';

/** One editable shader uniform: its name, its component count and a sample value. */
interface ShaderDefinition {
  name: string;
  dimensions: number;
  value: unknown;
}

/** The cached per-session inspector state: which selection the panel was built for, and its widgets. */
interface ShaderInspectorState {
  selection: string;
  parameter: string;
  open: boolean;
  gallery: EasingPickerState;
}

/** The shader transform {@link renderShaderInspector}'s `change` hands to `transformEvents`. */
type ShaderChange = (event: ChartEvent) => ChartEvent;

const sources = new Map<string, Promise<ShaderParameterDefinition[]>>();
// Keyed by session object; `@types/node` lacks the ES2021 WeakMap lib entry `lib` does not include.
const states = new WeakMap<EditorSession, ShaderInspectorState>();

async function parametersFor(event: ChartEvent): Promise<ShaderParameterDefinition[]> {
  const name = shaderIdentity(event);
  const portable = /(?:_pr\.glsl|\/pr\/)/i.test(event.shader ?? '');
  const path = portable ? `pr/${name}_pr` : name;
  if (!sources.has(path)) sources.set(path, fetch(assetUrl(`rpe/shaders/${path}.glsl`)).then(async response => {
    if (!response.ok) throw new Error('无法读取着色器参数定义');
    return shaderParameters(await response.text());
  }).catch(error => { sources.delete(path); throw error; }));
  return sources.get(path) as Promise<ShaderParameterDefinition[]>;
}

export function renderShaderInspector(container: HTMLElement, session: EditorSession, reportError: (error: unknown) => void, refresh: () => void): void {
  const entries = selectedEvents(session).filter(entry => entry.type === 'paintEvents');
  const event = entries[0]?.event;
  if (!event) return;
  const selection = `${session.lineIndex}:${entries.map(entry => entry.index).join(',')}`;
  if (states.get(session)?.selection !== selection) states.set(session, { selection, parameter: '', open: false, gallery: { open: false } });
  const state = states.get(session) as ShaderInspectorState;
  const safely = (action: () => void): void => { try { action(); } catch (error) { reportError(error); } };
  const change = (label: string, transform: ShaderChange): void => transformEvents(session, label, (current, type) => type === 'paintEvents' ? transform(current) : current);
  const field = <T extends HTMLElement>(parent: HTMLElement, title: string, input: T): T => {
    const label = document.createElement('label'); label.className = 'field'; label.append(title, input); parent.append(label);
    input.setAttribute('aria-label', `着色器${title}`); return input;
  };
  const inputField = (parent: HTMLElement, title: string, value: string, apply: (text: string) => void, kind = 'text', step = 0.1): HTMLInputElement => {
    const input = document.createElement('input'); input.type = kind; input.value = value;
    input.onfocus = () => { session.liveEventEdit = true; };
    input.onblur = () => { session.liveEventEdit = false; queueMicrotask(() => { if (container.isConnected && !session.liveEventEdit && !container.contains(document.activeElement)) refresh(); }); };
    const commit = (quiet: boolean): void => { try { apply(input.value); input.setCustomValidity(''); } catch (error) { input.setCustomValidity((error as Error).message); if (!quiet) reportError(error); } };
    input.oninput = () => commit(true); input.onchange = () => commit(false);
    if (kind === 'number') { input.step = String(step); numericWheel(input, step); }
    field(parent, title, input);
    if (title.endsWith('拍')) {
      input.dataset.beatDecorated = 'true';
      const wrapper = document.createElement('span'); wrapper.className = 'beat-input-wrap';
      const buttons = document.createElement('span'); buttons.className = 'beat-nudge';
      const nudge = (direction: number): void => safely(() => {
        input.value = formatBeat(fromNumber(beatValue(parseBeat(input.value)) + direction / (session.division || 4)));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      for (const [direction, text] of [[1, '▴'], [-1, '▾']] as [number, string][]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.title = direction > 0 ? '增加一格' : '减少一格';
        button.onpointerdown = pointer => pointer.preventDefault(); button.onclick = () => nudge(direction); buttons.append(button);
      }
      input.replaceWith(wrapper); wrapper.append(input, buttons);
      input.addEventListener('wheel', wheel => { wheel.preventDefault(); nudge(wheel.deltaY < 0 ? 1 : -1); }, { passive: false });
    }
    return input;
  };
  // The two beat fields are the only ones read through a computed key here; both are `Beat` values.
  const beats: Record<string, Beat> = { startTime: event.startTime, endTime: event.endTime };
  for (const [key, title] of [['startTime', '开始拍'], ['endTime', '结束拍']] as [string, string][]) {
    inputField(container, title, formatBeat(beats[key]), text => {
      const value = parseBeat(text); change(`修改着色器${title}`, current => ({ ...current, [key]: value }));
    });
  }
  const shader = document.createElement('select');
  for (const name of SHADER_NAMES) { const option = document.createElement('option'); option.value = name; option.textContent = name; shader.append(option); }
  shader.value = shaderIdentity(event);
  shader.onchange = () => safely(() => {
    state.parameter = ''; state.open = false;
    change('修改着色器类型', current => ({ ...current, ...shaderTypeFields(shader.value), vars: {} }));
  });
  field(container, '类型', shader);
  const global = document.createElement('input'); global.type = 'checkbox'; global.checked = Boolean(event.global);
  global.onchange = () => safely(() => change('修改着色器全局开关', current => ({ ...current, global: global.checked })));
  field(container, '全局（包含游戏 UI）', global);
  const autoAlign = document.createElement('input'); autoAlign.type = 'checkbox'; autoAlign.checked = session.shaderAutoAlign !== false;
  autoAlign.onchange = () => { session.shaderAutoAlign = autoAlign.checked; };
  field(container, '移动时参数自动对齐', autoAlign);
  const order = inputField(container, '顺序', String(event.order ?? 0), text => {
    if (!text.trim() || !Number.isFinite(Number(text))) throw new Error('顺序必须为数字');
    const value = Math.max(0, Math.min(10000, Math.round(Number(text))));
    change('修改着色器顺序', current => ({ ...current, order: value }));
  }, 'number', 1); order.min = '0'; order.max = '10000';
  const hint = document.createElement('p'); hint.className = 'hint';
  hint.textContent = '重叠事件按顺序从小到大叠加，同类型也可重复应用。参数使用独立拍数；更换类型会重置参数。'; container.append(hint);
  const parameters = document.createElement('select'); field(container, '参数', parameters);
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'wide-button'; container.append(toggle);
  const tracks = document.createElement('div'); tracks.className = 'shader-parameter-editor'; container.append(tracks);
  // `vars` is untrusted chart data, so it is narrowed once here rather than asserted into shape.
  const vars: Record<string, unknown> = event.vars !== null && typeof event.vars === 'object' ? event.vars as Record<string, unknown> : {};
  let definitions: ShaderDefinition[] = Object.entries(vars).map(([name, value]) => {
    const sample = Array.isArray(value) && typeof value[0] === 'object' ? (value[0] as ShaderParameterSegment).start : value;
    return { name, dimensions: Array.isArray(sample) ? sample.length : 1, value: sample };
  });
  const renderTracks = (): void => {
    tracks.replaceChildren(); toggle.textContent = state.open ? '收起参数编辑' : '编辑参数'; toggle.setAttribute('aria-expanded', String(state.open));
    toggle.disabled = !definitions.length;
    if (!state.open || !definitions.length) return;
    const definition = definitions.find(entry => entry.name === state.parameter) ?? definitions[0];
    const current = selectedEvents(session).find(entry => entry.type === 'paintEvents')?.event;
    if (!current) return;
    const track = shaderParameterTrack(current, definition.name, definition.value);
    const updateTrack = (label: string, transform: (segments: ShaderParameterTrack) => ShaderParameterTrack): void => change(label, current => {
      const next = transform(structuredClone(shaderParameterTrack(current, definition.name, definition.value)));
      for (const segment of next) {
        if (beatValue(segment.endTime) < beatValue(segment.startTime)) throw new Error('参数结束拍不能早于开始拍');
      }
      const currentVars: Record<string, unknown> = current.vars !== null && typeof current.vars === 'object' ? current.vars as Record<string, unknown> : {};
      return { ...current, vars: { ...currentVars, [definition.name]: next } };
    });
    const alignment = document.createElement('input'); alignment.value = formatBeat(current.startTime); field(tracks, '对齐到拍', alignment);
    const align = document.createElement('button'); align.type = 'button'; align.className = 'wide-button'; align.textContent = '对齐当前参数的起始拍';
    align.onclick = () => safely(() => { const target = parseBeat(alignment.value); updateTrack('对齐着色器参数', segments => alignShaderTrack(segments, target)); }); tracks.append(align);
    track.forEach((segment, index) => {
      const card = document.createElement('section'); card.className = 'shader-segment'; tracks.append(card);
      const title = document.createElement('strong'); title.textContent = `${definition.name} · 第 ${index + 1} 段`; card.append(title);
      for (const [key, title] of [['startTime', '开始拍'], ['endTime', '结束拍'], ['start', '起始值'], ['end', '结束值']] as [string, string][]) {
        const time = key.endsWith('Time');
        const raw = segment[key];
        const value = time ? formatBeat(raw as Beat) : Array.isArray(raw) ? raw.join(', ') : typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
        inputField(card, `参数${title}`, value, text => {
          const next = time ? parseBeat(text) : parseShaderValue(text, definition.dimensions);
          updateTrack(`修改着色器参数${title}`, segments => segments.map((entry, position) => position === index ? { ...entry, [key]: next } : entry));
        }, !time && definition.dimensions === 1 ? 'number' : 'text');
      }
      const easing = document.createElement('select');
      EASING_NAMES.forEach((name, index) => { const option = document.createElement('option'); option.value = String(index + 1); option.textContent = `${index + 1} · ${name}`; easing.append(option); });
      const setEasing = (value: number): void => updateTrack('修改着色器参数缓动', segments => segments.map((entry, position) => position === index ? { ...entry, easingType: value, bezier: 0 } : entry));
      easing.value = String(segment.easingType ?? 1); easing.onchange = () => safely(() => setEasing(Number(easing.value))); field(card, '参数缓动', easing);
      card.append(createEasingPicker(segment.easingType ?? 1, value => safely(() => setEasing(value)), state.gallery).element);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'wide-button'; remove.textContent = '删除此段'; remove.disabled = track.length <= 1;
      remove.onclick = () => safely(() => updateTrack('删除着色器参数段', segments => segments.filter((entry, position) => position !== index))); card.append(remove);
    });
    const add = document.createElement('button'); add.type = 'button'; add.className = 'wide-button'; add.textContent = '增加参数段';
    add.onclick = () => safely(() => updateTrack('增加着色器参数段', segments => {
      // The add button is only enabled while a track exists, so the last segment is always present.
      const last = segments[segments.length - 1];
      return [...segments, { startTime: last.endTime, endTime: last.endTime, start: structuredClone(last.end), end: structuredClone(last.end), easingType: last.easingType ?? 1 }];
    })); tracks.append(add);
  };
  const renderParameters = (): void => {
    parameters.replaceChildren();
    for (const definition of definitions) { const option = document.createElement('option'); option.value = definition.name; option.textContent = definition.name; parameters.append(option); }
    if (!definitions.some(entry => entry.name === state.parameter)) state.parameter = definitions[0]?.name ?? '';
    parameters.value = state.parameter; parameters.disabled = !definitions.length; renderTracks();
  };
  parameters.onchange = () => { state.parameter = parameters.value; renderTracks(); };
  toggle.onclick = () => { state.open = !state.open; renderTracks(); };
  renderParameters();
  parametersFor(event).then(result => {
    if (!parameters.isConnected) return;
    definitions = [...result, ...definitions.filter(existing => !result.some(entry => entry.name === existing.name))]; renderParameters();
  }).catch((error: unknown) => { if (hint.isConnected) hint.textContent += ` ${(error as Error).message}，已有参数仍可编辑。`; });
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'wide-button'; remove.textContent = '删除事件'; remove.onclick = () => safely(() => deleteEvents(session)); container.append(remove);
}
