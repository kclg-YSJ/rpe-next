import { compileLineExpression, normalizeLineIndices } from '../application/multi-line-edit.mjs';

const prefix = 'rpe-next-project-spatial-lines-v1:';
export function spatialLineState(session) {
  const value = session.spatialLineState ?? {};
  return { enabled: value.enabled === true, indices: normalizeLineIndices(value.indices, session.chart.judgeLineList?.length ?? 0), expression: typeof value.expression === 'string' ? value.expression : '' };
}
export class SpatialLineStateStore {
  constructor(storage, onError = () => {}) { this.storage = storage; this.onError = onError; this.changed = () => this.capture(); }
  attach(session, identity, fallback) {
    this.detach(); this.session = session; this.key = prefix + identity; this.signature = null;
    let state;
    try { state = JSON.parse(this.storage.getItem(this.key)); } catch {}
    if (!state || typeof state !== 'object' || !Array.isArray(state.indices)) state = fallback;
    session.spatialLineState = state && typeof state === 'object' ? { ...state, indices: Array.isArray(state.indices) ? [...state.indices] : [] } : { enabled: false, indices: [], expression: '' };
    this.normalize(); session.addEventListener('change', this.changed); this.capture();
  }
  normalize() {
    const state = spatialLineState(this.session);
    try { if (state.expression) compileLineExpression(state.expression, this.session.chart.judgeLineList.length, this.session.chart); } catch { state.expression = ''; }
    this.session.spatialLineState = state; return state;
  }
  capture() {
    if (!this.session) return;
    const state = this.normalize(), signature = JSON.stringify({ ...state, ...(state.expression ? { indices: [] } : {}) });
    if (signature === this.signature) return;
    try { this.storage.setItem(this.key, JSON.stringify(state)); this.signature = signature; } catch (error) { this.onError(error); }
  }
  rekey(identity) { if (this.session && this.key !== prefix + identity) { this.key = prefix + identity; this.signature = null; this.capture(); } }
  detach() { if (this.session) { this.capture(); this.session.removeEventListener('change', this.changed); } this.session = null; }
}
