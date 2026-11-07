import { eventMovementVector, editMovementVector } from '../application/movement-vector.mjs';
import { changeMovementVector, parseMovementPosition } from '../core/movement-vector.mjs';
import { numericWheel } from './numeric-wheel.mjs';
import { t } from '../i18n.mjs';

const states = new WeakMap();
const number = value => (Math.abs(value) < .005 ? 0 : value).toFixed(2);

export function createMovementVectorPanel(session, entry, { reportError, syncValues } = {}) {
  let state = states.get(session);
  if (!state) { state = { open: false, fixed: 'start' }; states.set(session, state); }
  const target = { type: entry.type, index: entry.index, lineIndex: entry.lineIndex ?? session.lineIndex, layer: session.eventLayer };
  const key = `${target.lineIndex}:${target.layer}:${target.type}:${target.index}`;
  if (state.key !== key) { state.key = key; state.vector = null; }
  const details = document.createElement('details'); details.className = 'movement-vector-panel'; details.open = state.open;
  const summary = document.createElement('summary'); summary.textContent = t('movement-vector.title'); details.append(summary);
  let body, hint, fields, fixedInput, pair, chart = session.chart;
  const accepted = new Map();
  const format = (field, vector) => field === 'start' || field === 'end' ? vector[field].map(number).join(' ') : number(vector[field]);
  const sync = (source = session.chart) => {
    if (!details.open) return;
    chart = source;
    try {
      pair = eventMovementVector(chart, target, state.vector ?? {});
      state.vector = pair.vector;
      if (!body) build();
      hint.textContent = pair.error || (pair.missing ? t('movement-vector.missing') : '');
      hint.hidden = !hint.textContent; hint.classList.toggle('movement-vector-warning', Boolean(pair.error));
      fixedInput.disabled = Boolean(pair.error);
      for (const [field, input] of fields) {
        input.disabled = Boolean(pair.error);
        if (document.activeElement === input) continue;
        input.value = format(field, state.vector); accepted.set(field, input.value);
      }
    } catch (error) {
      if (!body) build();
      hint.textContent = error.message; hint.hidden = false;
      fixedInput.disabled = true;
      for (const input of fields.values()) input.disabled = true;
    }
  };
  const apply = (field, input, quiet) => {
    if (!details.open || input.disabled || input.value === accepted.get(field)) return;
    try {
      const value = field === 'start' || field === 'end' ? parseMovementPosition(input.value) : Number(input.value);
      if ((field === 'angle' || field === 'length') && !input.value.trim()) return;
      const current = eventMovementVector(session.chart, target, state.vector ?? {});
      const next = changeMovementVector(current.vector, field, value, state.fixed);
      const updated = editMovementVector(session.chart, target, next);
      state.vector = next; accepted.set(field, input.value);
      input.classList.remove('numeric-expression-error'); input.removeAttribute('aria-invalid');
      if (updated !== session.chart) session.commit(t('movement-vector.edit'), updated);
      sync(); syncValues?.();
    } catch (error) {
      if (!quiet) { input.classList.add('numeric-expression-error'); input.setAttribute('aria-invalid', 'true'); reportError?.(error); }
    }
  };
  const build = () => {
    body = document.createElement('div'); body.className = 'movement-vector-fields'; fields = new Map();
    for (const field of ['start', 'end', 'angle', 'length']) {
      const label = document.createElement('label'); label.className = 'field'; label.append(t('movement-vector.' + field));
      const input = document.createElement('input'); input.type = field === 'start' || field === 'end' ? 'text' : 'number';
      input.dataset.movementVector = field; input.setAttribute('aria-label', t('movement-vector.' + field)); input.autocomplete = 'off';
      input.onfocus = () => { session.liveEventEdit = true; };
      input.oninput = event => { if (!event.isComposing) apply(field, input, true); };
      input.onchange = () => apply(field, input, false);
      input.onblur = () => {
        session.liveEventEdit = false;
        if (input.type === 'text') { input.value = format(field, state.vector); input.classList.remove('numeric-expression-error'); input.removeAttribute('aria-invalid'); }
        queueMicrotask(() => { if (details.isConnected && !session.liveEventEdit) sync(); });
      };
      if (input.type === 'number') { input.step = .1; numericWheel(input, .1); }
      else input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); apply(field, input, false); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); input.value = format(field, state.vector); input.blur(); }
      });
      fields.set(field, input); label.append(input); body.append(label);
    }
    const label = document.createElement('label'); label.className = 'field'; label.append(t('movement-vector.fixed'));
    const fixed = document.createElement('select'); fixedInput = fixed; fixed.setAttribute('aria-label', t('movement-vector.fixed'));
    for (const field of ['start', 'end']) { const option = document.createElement('option'); option.value = field; option.textContent = t('movement-vector.' + field); fixed.append(option); }
    fixed.value = state.fixed; fixed.onchange = () => { state.fixed = fixed.value; fixed.blur(); }; label.append(fixed); body.append(label);
    hint = document.createElement('p'); hint.className = 'hint'; hint.setAttribute('role', 'status'); body.append(hint); details.append(body);
  };
  details.ontoggle = () => {
    if (!details.isConnected) return;
    state.open = details.open;
    if (details.open) sync();
    else { body?.remove(); body = hint = fields = fixedInput = null; accepted.clear(); }
  };
  if (details.open) sync();
  return { element: details, sync };
}
