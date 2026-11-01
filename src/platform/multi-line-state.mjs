import { multiLineState, setMultiLineState, compileLineExpression } from '../application/multi-line-edit.mjs';

const prefix = 'rpe-next-project-multi-line-v1:';

function validState(value, chart) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.indices)) return null;
  let expression = typeof value.expression === 'string' ? value.expression : '';
  try { if (expression) compileLineExpression(expression, chart.judgeLineList.length, chart); }
  catch { expression = ''; }
  return { ...value, expression };
}

// This is local view state, independent of project writes and unsaved chart data.
export class MultiLineStateStore {
  constructor(storage, onError = () => {}) { this.storage = storage; this.onError = onError; this.changed = () => this.capture(); }
  attach(session, identity, fallback) {
    this.detach(); this.session = session; this.key = prefix + identity; this.signature = null;
    let state;
    try { state = validState(JSON.parse(this.storage.getItem(this.key)), session.chart); }
    catch { /* Missing or damaged local state falls back to the saved project. */ }
    state ??= validState(fallback, session.chart);
    if (state) setMultiLineState(session, state);
    session.addEventListener('change', this.changed); this.capture();
  }
  capture() {
    if (!this.session) return;
    const state = multiLineState(this.session);
    // Dynamic viewport results change while playing; persist the expression,
    // rather than writing storage every time its resolved line list changes.
    const signature = JSON.stringify({ ...state, ...(state.expression ? { indices: [] } : {}) });
    if (signature === this.signature) return;
    try { this.storage.setItem(this.key, JSON.stringify(state)); this.signature = signature; }
    catch (error) { this.onError(error); }
  }
  rekey(identity) { if (this.session && this.key !== prefix + identity) { this.key = prefix + identity; this.signature = null; this.capture(); } }
  detach() { if (this.session) { this.capture(); this.session.removeEventListener('change', this.changed); } this.session = null; }
}
