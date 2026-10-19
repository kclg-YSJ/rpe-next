import { evaluateNumericExpression, isNumericLiteral } from '../core/numeric-expression.ts';
import { formatBeat, parseBeat } from '../core/beat.ts';

/** Per-field evaluators that can account for the event a field belongs to. */
type ExpressionResolver = (source: string) => number;

interface NumericExpressionState {
  type: string;
  kind: string | undefined;
  inputMode: string | null;
  accepted: string;
  confirmed: boolean;
  applying?: boolean;
  liveSource?: string | null;
}

const resolvers = new WeakMap<HTMLInputElement, ExpressionResolver>();
const sources = new WeakMap<HTMLInputElement, string>();

export const numericExpressionSource = (input: HTMLInputElement): string => sources.get(input) ?? input.value;

export function setNumericExpressionResolver(input: HTMLInputElement, evaluate: ExpressionResolver): void {
  resolvers.set(input, evaluate);
}

export function installNumericExpressionInputs(root: Document | HTMLElement = document): void {
  const states = new WeakMap<HTMLInputElement, NumericExpressionState>();
  const isInput = (target: EventTarget | null): target is HTMLInputElement =>
    target instanceof HTMLInputElement && !target.disabled && !target.readOnly;
  const activeElement = (): Element | null => root instanceof Document ? root.activeElement : document.activeElement;
  const clearError = (input: HTMLInputElement): void => {
    if (input.classList.contains('numeric-expression-error')) {
      input.classList.remove('numeric-expression-error');
      input.removeAttribute('aria-invalid');
    }
  };
  const editingType = (input: HTMLInputElement, state: NumericExpressionState): void => {
    if (state.type === 'number') input.type = 'text';
    input.inputMode = 'decimal';
  };
  const restoreType = (input: HTMLInputElement, state: NumericExpressionState): void => {
    input.type = state.type;
    if (state.inputMode === null) input.removeAttribute('inputmode');
    else input.setAttribute('inputmode', state.inputMode);
  };
  const normalize = (input: HTMLInputElement, state: NumericExpressionState, source: string): string => {
    if (state.kind === 'beat') return formatBeat(parseBeat(source));
    const value = (resolvers.get(input) ?? evaluateNumericExpression)(source);
    if (!Number.isFinite(value)) throw new Error('表达式结果必须为有限数字');
    return String(value);
  };
  root.addEventListener('focus', event => {
    const input = event.target;
    if (!isInput(input) || input.type !== 'number' && !['number', 'beat'].includes(input.dataset.numericExpression ?? '')) return;
    const state: NumericExpressionState = {
      type: input.type,
      kind: input.dataset.numericExpression,
      inputMode: input.getAttribute('inputmode'),
      accepted: input.value,
      confirmed: false,
    };
    states.set(input, state);
    editingType(input, state);
  }, true);
  root.addEventListener('input', event => {
    const input = event.target;
    if (!isInput(input)) return;
    const state = states.get(input);
    if (!state || state.applying) return;
    state.confirmed = false;
    clearError(input);
    if ((event as InputEvent).isComposing) { event.stopImmediatePropagation(); return; }
    const beatLiteral = state.kind === 'beat' && /^\s*-?\d+\s*:\s*-?\d+\s*\/\s*[1-9]\d*\s*$/.test(input.value);
    if (isNumericLiteral(input.value) || beatLiteral) { state.liveSource = null; state.accepted = input.value; return; }
    event.stopImmediatePropagation();
    const source = input.value;
    if (source === state.liveSource) return;
    state.liveSource = null;
    let normalized: string;
    try { normalized = normalize(input, state, source); } catch { return; }
    const selection: [number, number, 'forward' | 'backward' | 'none'] | null =
      input.selectionStart === null || input.selectionEnd === null
        ? null
        : [input.selectionStart, input.selectionEnd, input.selectionDirection ?? 'none'];
    state.applying = true;
    sources.set(input, source);
    restoreType(input, state);
    input.value = normalized;
    try {
      // Reuse each field's normal apply path, including draft commits and fields
      // that only listen for change. Keep the source available to v resolvers.
      if (!input.onchange) input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      state.accepted = input.value;
      state.liveSource = source;
    } finally {
      sources.delete(input);
      state.applying = false;
      if (input.isConnected && activeElement() === input) {
        editingType(input, state);
        input.value = source;
        if (selection) input.setSelectionRange(...selection);
      }
    }
  }, true);
  root.addEventListener('change', event => {
    const input = event.target;
    if (!isInput(input)) return;
    const state = states.get(input);
    if (!state || state.applying) return;
    if (state.confirmed && input.value === state.accepted) { event.stopImmediatePropagation(); return; }
    const source = input.value;
    // Enter/blur only formats an expression already applied while typing.
    // Evaluating v again could use an endpoint changed by the previous update.
    if (source === state.liveSource) {
      restoreType(input, state);
      input.value = state.accepted;
      state.confirmed = true;
      event.stopImmediatePropagation();
      queueMicrotask(() => { if (input.isConnected && activeElement() === input) editingType(input, state); });
      return;
    }
    let normalized: string;
    try {
      normalized = normalize(input, state, source);
    } catch {
      input.classList.add('numeric-expression-error');
      input.setAttribute('aria-invalid', 'true');
      event.stopImmediatePropagation();
      return;
    }
    clearError(input);
    state.applying = true;
    sources.set(input, source);
    restoreType(input, state);
    input.value = normalized;
    state.accepted = input.value;
    state.confirmed = true;
    // Fields with a change handler commit through that handler. Input-only fields
    // also receive their usual notification without duplicating chart undo steps.
    if (!input.onchange) input.dispatchEvent(new Event('input', { bubbles: true }));
    queueMicrotask(() => {
      sources.delete(input);
      state.applying = false;
      if (input.isConnected && activeElement() === input) editingType(input, state);
    });
  }, true);
  root.addEventListener('compositionend', event => {
    const input = event.target;
    if (isInput(input) && states.has(input)) input.dispatchEvent(new Event('input', { bubbles: true }));
  }, true);
  root.addEventListener('keydown', event => {
    const key = event as KeyboardEvent;
    const input = key.target;
    if (!isInput(input)) return;
    const state = states.get(input);
    if (!state || key.isComposing || key.keyCode === 229 || key.ctrlKey || key.metaKey || key.altKey) return;
    if (key.key === 'Enter') {
      key.preventDefault();
      key.stopPropagation();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (key.key === 'Escape') {
      key.preventDefault();
      key.stopPropagation();
      input.value = state.accepted;
      clearError(input);
      input.blur();
    }
  }, true);
  root.addEventListener('blur', event => {
    const input = event.target;
    if (!isInput(input)) return;
    const state = states.get(input);
    if (!state) return;
    if (!state.confirmed && input.value !== state.accepted) input.dispatchEvent(new Event('change', { bubbles: true }));
    // An invalid expression never reaches the field's change/input handlers.
    if (input.classList.contains('numeric-expression-error')) input.value = state.accepted;
    clearError(input);
    restoreType(input, state);
    states.delete(input);
  }, true);
}
