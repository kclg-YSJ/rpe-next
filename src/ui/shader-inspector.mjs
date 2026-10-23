import { beatValue, formatBeat, parseBeat, fromNumber } from '../core/beat.mjs';
import { SHADER_NAMES } from '../core/shader.mjs';
import { shaderIdentity, shaderTypeFields, shaderParameterTrack, shaderParameters, parseShaderValue, alignShaderTrack } from '../core/shader-events.mjs';
import { selectedEvents, transformEvents, deleteEvents } from '../application/event-commands.mjs';
import { EASING_NAMES, createEasingPicker } from './easing-picker.mjs';
import { numericWheel } from './numeric-wheel.mjs';
import { assetUrl } from '../core/asset-url.mjs';
import { t } from '../i18n.mjs';

const sources = new Map();
const states = new WeakMap();

async function parametersFor(event) {
  const name = shaderIdentity(event);
  const portable = /(?:_pr\.glsl|\/pr\/)/i.test(event.shader ?? '');
  const path = portable ? `pr/${name}_pr` : name;
  if (!sources.has(path)) sources.set(path, fetch(assetUrl(`rpe/shaders/${path}.glsl`)).then(async response => {
    if (!response.ok) throw new Error(t('shader-inspector.sa91901d'));
    return shaderParameters(await response.text());
  }).catch(error => { sources.delete(path); throw error; }));
  return sources.get(path);
}

export function renderShaderInspector(container, session, reportError, refresh) {
  const entries = selectedEvents(session).filter(entry => entry.type === 'paintEvents');
  const event = entries[0]?.event;
  if (!event) return;
  const selection = `${session.lineIndex}:${entries.map(entry => entry.index).join(',')}`;
  if (states.get(session)?.selection !== selection) states.set(session, { selection, parameter: '', open: false, gallery: { open: false } });
  const state = states.get(session);
  const safely = action => { try { action(); } catch (error) { reportError(error); } };
  const change = (label, transform) => transformEvents(session, label, (current, type) => type === 'paintEvents' ? transform(current) : current);
  const field = (parent, title, input) => {
    const label = document.createElement('label'); label.className = 'field'; label.append(title, input); parent.append(label);
    input.setAttribute('aria-label', t('shader-inspector.sdef1bcb', { p0: title })); return input;
  };
  const inputField = (parent, title, value, apply, kind = 'text', step = 0.1) => {
    const input = document.createElement('input'); input.type = kind; input.value = value;
    input.onfocus = () => { session.liveEventEdit = true; };
    input.onblur = () => { session.liveEventEdit = false; queueMicrotask(() => { if (container.isConnected && !session.liveEventEdit && !container.contains(document.activeElement)) refresh(); }); };
    const commit = quiet => { try { apply(input.value); input.setCustomValidity(''); } catch (error) { input.setCustomValidity(error.message); if (!quiet) reportError(error); } };
    input.oninput = () => commit(true); input.onchange = () => commit(false);
    if (kind === 'number') { input.step = step; numericWheel(input, step); }
    field(parent, title, input);
    if (title.endsWith(t('shader-inspector.s60a8be1'))) {
      input.dataset.beatDecorated = 'true';
      const wrapper = document.createElement('span'); wrapper.className = 'beat-input-wrap';
      const buttons = document.createElement('span'); buttons.className = 'beat-nudge';
      const nudge = direction => safely(() => {
        input.value = formatBeat(fromNumber(beatValue(parseBeat(input.value)) + direction / (session.division || 4)));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      for (const [direction, text] of [[1, '▴'], [-1, '▾']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.title = direction > 0 ? t('shader-inspector.sbd85928') : t('shader-inspector.sc97bc82');
        button.onpointerdown = pointer => pointer.preventDefault(); button.onclick = () => nudge(direction); buttons.append(button);
      }
      input.replaceWith(wrapper); wrapper.append(input, buttons);
      input.addEventListener('wheel', wheel => { wheel.preventDefault(); nudge(wheel.deltaY < 0 ? 1 : -1); }, { passive: false });
    }
    return input;
  };
  for (const [key, title] of [['startTime', t('shader-inspector.s087c451')], ['endTime', t('shader-inspector.sc4d3fa4')]]) {
    inputField(container, title, formatBeat(event[key]), text => {
      const value = parseBeat(text); change(t('shader-inspector.scaf4eb2', { p0: title }), current => ({ ...current, [key]: value }));
    });
  }
  const shader = document.createElement('select');
  for (const name of SHADER_NAMES) { const option = document.createElement('option'); option.value = name; option.textContent = name; shader.append(option); }
  shader.value = shaderIdentity(event);
  shader.onchange = () => safely(() => {
    state.parameter = ''; state.open = false;
    change(t('shader-inspector.s26cfe8a'), current => ({ ...current, ...shaderTypeFields(shader.value), vars: {} }));
  });
  field(container, t('shader-inspector.se4e46c7'), shader);
  const global = document.createElement('input'); global.type = 'checkbox'; global.checked = Boolean(event.global);
  global.onchange = () => safely(() => change(t('shader-inspector.s9d4f787'), current => ({ ...current, global: global.checked })));
  field(container, t('shader-inspector.se04a1db'), global);
  const autoAlign = document.createElement('input'); autoAlign.type = 'checkbox'; autoAlign.checked = session.shaderAutoAlign !== false;
  autoAlign.onchange = () => { session.shaderAutoAlign = autoAlign.checked; };
  field(container, t('shader-inspector.s92bc481'), autoAlign);
  const order = inputField(container, t('shader-inspector.s20ee03c'), event.order ?? 0, text => {
    if (!text.trim() || !Number.isFinite(Number(text))) throw new Error(t('shader-inspector.s8b50755'));
    const value = Math.max(0, Math.min(10000, Math.round(Number(text))));
    change(t('shader-inspector.s8bed375'), current => ({ ...current, order: value }));
  }, 'number', 1); order.min = 0; order.max = 10000;
  const hint = document.createElement('p'); hint.className = 'hint';
  hint.textContent = t('shader-inspector.s6cca9a8'); container.append(hint);
  const parameters = document.createElement('select'); field(container, t('shader-inspector.s749d765'), parameters);
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'wide-button'; container.append(toggle);
  const tracks = document.createElement('div'); tracks.className = 'shader-parameter-editor'; container.append(tracks);
  let definitions = Object.entries(event.vars ?? {}).map(([name, value]) => {
    const sample = Array.isArray(value) && typeof value[0] === 'object' ? value[0].start : value;
    return { name, dimensions: Array.isArray(sample) ? sample.length : 1, value: sample };
  });
  const renderTracks = () => {
    tracks.replaceChildren(); toggle.textContent = state.open ? t('shader-inspector.see42e2f') : t('shader-inspector.s3df134e'); toggle.setAttribute('aria-expanded', String(state.open));
    toggle.disabled = !definitions.length;
    if (!state.open || !definitions.length) return;
    const definition = definitions.find(entry => entry.name === state.parameter) ?? definitions[0];
    const current = selectedEvents(session).find(entry => entry.type === 'paintEvents')?.event;
    if (!current) return;
    const track = shaderParameterTrack(current, definition.name, definition.value);
    const updateTrack = (label, transform) => change(label, current => {
      const next = transform(structuredClone(shaderParameterTrack(current, definition.name, definition.value)));
      for (const segment of next) {
        if (beatValue(segment.endTime) < beatValue(segment.startTime)) throw new Error(t('shader-inspector.sccd5f6c'));
      }
      return { ...current, vars: { ...current.vars, [definition.name]: next } };
    });
    const alignment = document.createElement('input'); alignment.value = formatBeat(current.startTime); field(tracks, t('shader-inspector.s22d7b36'), alignment);
    const align = document.createElement('button'); align.type = 'button'; align.className = 'wide-button'; align.textContent = t('shader-inspector.s4f1b238');
    align.onclick = () => safely(() => { const target = parseBeat(alignment.value); updateTrack(t('shader-inspector.s70d4d95'), segments => alignShaderTrack(segments, target)); }); tracks.append(align);
    track.forEach((segment, index) => {
      const card = document.createElement('section'); card.className = 'shader-segment'; tracks.append(card);
      const title = document.createElement('strong'); title.textContent = t('shader-inspector.s603940d', { p0: definition.name, p1: index + 1 }); card.append(title);
      for (const [key, title] of [['startTime', t('shader-inspector.s087c451')], ['endTime', t('shader-inspector.sc4d3fa4')], ['start', t('shader-inspector.s532cd47')], ['end', t('shader-inspector.s00005a6')]]) {
        const time = key.endsWith('Time');
        const value = time ? formatBeat(segment[key]) : Array.isArray(segment[key]) ? segment[key].join(', ') : segment[key];
        inputField(card, t('shader-inspector.sa37c86d', { p0: title }), value, text => {
          const next = time ? parseBeat(text) : parseShaderValue(text, definition.dimensions);
          updateTrack(t('shader-inspector.s0e729fe', { p0: title }), segments => segments.map((entry, position) => position === index ? { ...entry, [key]: next } : entry));
        }, !time && definition.dimensions === 1 ? 'number' : 'text');
      }
      const easing = document.createElement('select');
      EASING_NAMES.forEach((name, index) => { const option = document.createElement('option'); option.value = index + 1; option.textContent = `${index + 1} · ${name}`; easing.append(option); });
      const setEasing = value => updateTrack(t('shader-inspector.sc646243'), segments => segments.map((entry, position) => position === index ? { ...entry, easingType: value, bezier: 0 } : entry));
      easing.value = segment.easingType ?? 1; easing.onchange = () => safely(() => setEasing(Number(easing.value))); field(card, t('shader-inspector.sc68a591'), easing);
      card.append(createEasingPicker(segment.easingType ?? 1, value => safely(() => setEasing(value)), state.gallery).element);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'wide-button'; remove.textContent = t('shader-inspector.sb575fe9'); remove.disabled = track.length <= 1;
      remove.onclick = () => safely(() => updateTrack(t('shader-inspector.s05f57a9'), segments => segments.filter((entry, position) => position !== index))); card.append(remove);
    });
    const add = document.createElement('button'); add.type = 'button'; add.className = 'wide-button'; add.textContent = t('shader-inspector.sabb6bc1');
    add.onclick = () => safely(() => updateTrack(t('shader-inspector.s0736cbb'), segments => {
      const last = segments.at(-1);
      return [...segments, { startTime: last.endTime, endTime: last.endTime, start: structuredClone(last.end), end: structuredClone(last.end), easingType: last.easingType ?? 1 }];
    })); tracks.append(add);
  };
  const renderParameters = () => {
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
  }).catch(error => { if (hint.isConnected) hint.textContent += t('shader-inspector.s1ba3488', { p0: error.message }); });
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'wide-button'; remove.textContent = t('shader-inspector.sf10087a'); remove.onclick = () => safely(() => deleteEvents(session)); container.append(remove);
}
