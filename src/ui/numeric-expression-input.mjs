import { evaluateNumericExpression, isNumericLiteral } from '../core/numeric-expression.mjs';
import { formatBeat, parseBeat } from '../core/beat.mjs';
import { t } from '../i18n.mjs';

const resolvers = new WeakMap();
const sources = new WeakMap();
export const numericExpressionSource = input => sources.get(input) ?? input.value;
export function setNumericExpressionResolver(input, evaluate) { resolvers.set(input, evaluate); }

export function installNumericExpressionInputs(root = document) {
  const states = new WeakMap();
  const isInput = input => input?.tagName === 'INPUT' && !input.disabled && !input.readOnly;
  const clearError = input => { if (input.classList.contains('numeric-expression-error')) { input.classList.remove('numeric-expression-error'); input.removeAttribute('aria-invalid'); } };
  const editingType = (input, state) => {
    if (state.type === 'number') { if (input.type !== 'text') input.type = 'text'; input.classList.add('numeric-expression-number'); }
    input.inputMode = 'decimal';
  };
  const restoreType = (input, state) => {
    if (input.type !== state.type) input.type = state.type;
    if (state.inputMode === null) input.removeAttribute('inputmode'); else input.setAttribute('inputmode', state.inputMode);
  };
  const normalize = (input, state, source) => {
    if (state.kind === 'beat') return formatBeat(parseBeat(source));
    const value = (resolvers.get(input) ?? evaluateNumericExpression)(source);
    if (!Number.isFinite(value)) throw new Error(t('numeric-expression-input.s05b3df3'));
    return String(value);
  };
  const beginEditing = input => {
    let state = states.get(input);
    if (!state) {
      state = { type: input.type, kind: input.dataset.numericExpression, inputMode: input.getAttribute('inputmode'), accepted: input.value, confirmed: false };
      states.set(input, state);
    }
    editingType(input, state);
    return state;
  };
  const overStepper = (input, event) => {
    const rectangle = input.getBoundingClientRect();
    const right = rectangle.right - (Number.parseFloat(getComputedStyle(input).borderRightWidth) || 0);
    return event.clientX >= right - 16 && event.clientX <= right && event.clientY >= rectangle.top && event.clientY <= rectangle.bottom;
  };
  let hoveredStep = null;
  const updateStepperCursor = event => {
    const input = event.target;
    if (isInput(input) && input.type === 'number') beginEditing(input);
    const hovered = isInput(input) && (states.get(input)?.type ?? input.type) === 'number' && overStepper(input, event) ? input : null;
    if (hoveredStep !== hovered) { hoveredStep?.classList.remove('numeric-step-hover'); hovered?.classList.add('numeric-step-hover'); hoveredStep = hovered; }
  };
  root.addEventListener('pointerover', updateStepperCursor, true);
  root.addEventListener('pointermove', updateStepperCursor, true);
  root.addEventListener('pointerout', event => {
    const input = event.target;
    if (input === hoveredStep) { hoveredStep.classList.remove('numeric-step-hover'); hoveredStep = null; }
    const state = states.get(input);
    if (state && root.activeElement !== input && !state.applying) { restoreType(input, state); input.classList.remove('numeric-expression-number'); states.delete(input); }
  }, true);
  let stopSpin = () => {};
  root.addEventListener('pointerdown', event => {
    const input = event.target;
    let state = states.get(input);
    if (event.button !== 0 || !isInput(input) || (state?.type ?? input.type) !== 'number') return;
    const rectangle = input.getBoundingClientRect();
    if (!overStepper(input, event)) { beginEditing(input); return; }
    event.preventDefault(); event.stopPropagation(); stopSpin();
    state = beginEditing(input); input.focus({ preventScroll: true });
    const direction = event.clientY < (rectangle.top + rectangle.bottom) / 2 ? 1 : -1;
    const spin = () => {
      if (!input.isConnected || !isInput(input)) { stopSpin(); return; }
      let value;
      try { value = state?.liveSource === input.value ? state.accepted : normalize(input, state ?? {}, input.value || '0'); }
      catch { value = state?.accepted ?? '0'; }
      const selection = [input.selectionStart, input.selectionEnd, input.selectionDirection];
      if (state) state.applying = true;
      input.type = 'number'; input.value = value;
      const previous = input.value;
      try {
        if (input.step === 'any') input.value = String(Math.max(input.min === '' ? -Infinity : Number(input.min), Math.min(input.max === '' ? Infinity : Number(input.max), Number(value) + direction)));
        else input.stepUp(direction);
        clearError(input);
        if (input.value !== previous) {
          if (!input.onchange) input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (state) { state.accepted = input.value; state.liveSource = null; state.confirmed = true; }
      } finally {
        if (state) {
          state.applying = false;
          if (input.isConnected && root.activeElement === input) { editingType(input, state); if (selection[0] !== null) input.setSelectionRange(...selection); }
        }
      }
    };
    const view = root.defaultView ?? window;
    let timer;
    stopSpin = () => {
      clearTimeout(timer);
      view.removeEventListener('pointerup', stopSpin, true); view.removeEventListener('pointercancel', stopSpin, true); view.removeEventListener('blur', stopSpin);
    };
    view.addEventListener('pointerup', stopSpin, true); view.addEventListener('pointercancel', stopSpin, true); view.addEventListener('blur', stopSpin);
    spin();
    const repeat = () => { spin(); if (input.isConnected && isInput(input)) timer = setTimeout(repeat, 80); };
    timer = setTimeout(repeat, 400);
  }, true);
  root.addEventListener('focus', event => {
    const input = event.target;
    if (!isInput(input) || input.type !== 'number' && !states.has(input) && !['number', 'beat'].includes(input.dataset.numericExpression)) return;
    const state = beginEditing(input); state.accepted = input.value;
  }, true);
  root.addEventListener('input', event => {
    const input = event.target, state = states.get(input); if (!state || state.applying) return;
    state.confirmed = false; clearError(input);
    if (event.isComposing) { event.stopImmediatePropagation(); return; }
    const beatLiteral = state.kind === 'beat' && /^\s*-?\d+\s*:\s*-?\d+\s*\/\s*[1-9]\d*\s*$/.test(input.value);
    if (isNumericLiteral(input.value) || beatLiteral) { state.liveSource = null; state.accepted = input.value; return; }
    event.stopImmediatePropagation();
    const source = input.value;
    if (source === state.liveSource) return;
    state.liveSource = null;
    let normalized;
    try { normalized = normalize(input, state, source); } catch { return; }
    const selection = [input.selectionStart, input.selectionEnd, input.selectionDirection];
    state.applying = true; sources.set(input, source);
    restoreType(input, state); input.value = normalized;
    try {
      // Reuse each field's normal apply path, including draft commits and fields
      // that only listen for change. Keep the source available to v resolvers.
      if (!input.onchange) input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      state.accepted = input.value; state.liveSource = source;
    } finally {
      sources.delete(input); state.applying = false;
      if (input.isConnected && root.activeElement === input) {
        editingType(input, state); input.value = source;
        if (selection[0] !== null) input.setSelectionRange(...selection);
      }
    }
  }, true);
  root.addEventListener('change', event => {
    const input = event.target, state = states.get(input); if (!state || state.applying) return;
    if (state.confirmed && input.value === state.accepted) { event.stopImmediatePropagation(); return; }
    const source = input.value;
    // Enter/blur only formats an expression already applied while typing.
    // Evaluating v again could use an endpoint changed by the previous update.
    if (source === state.liveSource) {
      restoreType(input, state); input.value = state.accepted; state.confirmed = true;
      event.stopImmediatePropagation();
      queueMicrotask(() => { if (input.isConnected && root.activeElement === input) editingType(input, state); });
      return;
    }
    let normalized;
    try {
      normalized = normalize(input, state, source);
    } catch {
      input.classList.add('numeric-expression-error'); input.setAttribute('aria-invalid', 'true');
      event.stopImmediatePropagation(); return;
    }
    clearError(input); state.applying = true; sources.set(input, source);
    restoreType(input, state); input.value = normalized; state.accepted = input.value; state.confirmed = true;
    // Fields with a change handler commit through that handler. Input-only fields
    // also receive their usual notification without duplicating chart undo steps.
    if (!input.onchange) input.dispatchEvent(new Event('input', { bubbles: true }));
    queueMicrotask(() => {
      sources.delete(input); state.applying = false;
      if (input.isConnected && root.activeElement === input) editingType(input, state);
    });
  }, true);
  root.addEventListener('compositionend', event => {
    if (states.has(event.target)) event.target.dispatchEvent(new Event('input', { bubbles: true }));
  }, true);
  root.addEventListener('keydown', event => {
    const input = event.target, state = states.get(input);
    if (!state || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      input.value = state.accepted; clearError(input); input.blur();
    }
  }, true);
  root.addEventListener('blur', event => {
    const input = event.target, state = states.get(input); if (!state) return;
    if (!state.confirmed && input.value !== state.accepted) input.dispatchEvent(new Event('change', { bubbles: true }));
    // An invalid expression never reaches the field's change/input handlers.
    if (input.classList.contains('numeric-expression-error')) input.value = state.accepted;
    clearError(input); restoreType(input, state); input.classList.remove('numeric-expression-number', 'numeric-step-hover'); states.delete(input);
  }, true);
}
