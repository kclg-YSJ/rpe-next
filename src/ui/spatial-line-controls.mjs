import { formatLineExpression, normalizeLineIndices } from '../application/multi-line-edit.mjs';
import { spatialLineState } from '../platform/spatial-line-state.mjs';
import { LineNumberList } from './line-number-list.mjs';
import { t } from '../i18n.mjs';

export class SpatialLineControls {
  constructor(host, panel) {
    this.panel = panel;
    const root = this.root = document.createElement('details'); root.className = 'spatial-line-controls tool-section';
    root.open = panel.lineControls?.root.open ?? false;
    const summary = document.createElement('summary'); summary.append(t('spatial.lineList'));
    this.count = document.createElement('small'); summary.append(this.count); root.append(summary);
    this.toggle = document.createElement('button'); this.toggle.type = 'button'; this.toggle.className = 'tool-wide'; this.toggle.dataset.spatial = 'filterLines';
    this.toggle.textContent = t('spatial.filterLines'); this.toggle.title = t('spatial.filterLinesHint');
    this.toggle.onclick = () => {
      const state = this.state;
      this.set({ enabled: !state.enabled, ...(!state.enabled && !state.indices.length && !state.expression ? { indices: [this.context.session.lineIndex] } : {}) });
    };
    root.append(this.toggle);
    const actions = document.createElement('div'); actions.className = 'multi-line-actions';
    for (const [key, action] of [
      ['sb6b7860', () => this.set({ indices: [...this.state.indices, this.context.session.lineIndex], expression: '' })],
      ['s71ba1bd', () => this.set({ indices: this.state.indices.filter(i => i !== this.context.session.lineIndex), expression: '' })],
      ['s84fcd70', () => this.set({ indices: [], expression: '' })],
    ]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = t('multi-line.' + key); button.onclick = action; actions.append(button);
    }
    root.append(actions);
    const field = document.createElement('label'); field.className = 'field tool-field multi-line-expression-field';
    const label = document.createElement('span'); label.textContent = t('multi-line.s6dcecd0');
    const expression = this.expression = document.createElement('input'); expression.type = 'text'; expression.placeholder = t('multi-line.s188ac1e'); expression.title = t('multi-line.s9cd3607');
    field.append(label, expression); root.append(field);
    const apply = () => {
      const current = this.state;
      if (expression.value.trim() === (current.expression || formatLineExpression(current.indices, this.context.session.chart))) return;
      try {
        const result = this.context.timeline.resolveMultiLineExpression(expression.value);
        if (!result.indices.length && !result.dynamic) throw Error(t('multi-line.sa828e01'));
        this.set({ indices: result.indices, expression: result.dynamic ? expression.value.trim() : '' }); expression.setCustomValidity('');
      } catch (error) { expression.value = current.expression || formatLineExpression(current.indices, this.context.session.chart); panel.fail(error); }
    };
    expression.onchange = apply; expression.onblur = apply;
    expression.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } };
    this.list = new LineNumberList(root, {
      state: () => ({ chart: this.context.session.chart, indices: this.state.indices, lineIndex: this.context.session.lineIndex }),
      change: indices => this.set({ indices, expression: '' }, false),
      finish: () => this.context.persistSpatialLines?.(),
    });
    this.list.scrollTop = panel.lineControls?.list.scrollTop ?? 0;
    host.append(root); this.list.render(); this.rowsChart = this.context.session.chart;
    root.addEventListener('toggle', () => { if (root.open) this.sync(true); }); this.sync();
  }
  get context() { return this.panel.context; }
  get state() { const session=this.context.session,raw=session.spatialLineState,count=session.chart.judgeLineList.length;if(this.stateInput!==raw||this.stateCount!==count||!this.stateCache){this.stateInput=raw;this.stateCount=count;this.stateCache=spatialLineState(session);}return this.stateCache; }
  set(patch, persist = true) {
    const session = this.context.session;
    session.spatialLineState = { ...this.state, ...patch, indices: normalizeLineIndices(patch.indices ?? this.state.indices, session.chart.judgeLineList.length) };
    if (persist) this.context.persistSpatialLines?.();
    this.cache = null; this.dynamicKey = null; this.panel.lineFilterChanged(); this.sync(); this.panel.invalidate();
  }
  resolve() {
    if(this.resolveSession!==this.context.session){this.resolveSession=this.context.session;this.dynamicKey=null;this.cache=null;}
    if (!this.context.session.spatialLineState?.enabled) return null;
    const state = this.state;
    if (!state.enabled) return null;
    if (state.expression) {
      const timeline = this.context.timeline, chart = this.context.session.chart, activity = timeline.currentLineActivity();
      const key = [state.expression, chart, this.context.tempo, activity.start, activity.end, activity.layer, activity.extended];
      if (!this.dynamicKey || key.some((value, index) => value !== this.dynamicKey[index])) {
        try {
          const result = timeline.resolveMultiLineExpression(state.expression);
          this.context.session.spatialLineState = { ...state, indices: result.indices }; state.indices = result.indices;
          this.dynamicKey = key; this.sync();
        } catch (error) { this.panel.fail(error); return new Set(); }
      }
    }
    const key = state.indices.join(',');
    if (!this.cache || this.cache.key !== key) this.cache = { key, values: new Set(state.indices) };
    return this.cache.values;
  }
  sync(forceRows = false) {
    const state = this.state, chart = this.context.session.chart;
    const signature=[state.enabled,state.indices.join(','),state.expression,this.context.session.lineIndex,chart.judgeLineList.length,chart.judgeLineGroup];
    const changed=!this.lastSync||signature.some((value,index)=>value!==this.lastSync[index]);
    const rowsChanged=this.root.open&&!this.panel.draft&&this.rowsChart!==chart&&!this.list.drag;
    if(!changed&&!rowsChanged&&!forceRows)return;this.lastSync=signature;
    this.count.textContent = t('multi-line.s9191962', { p0: state.indices.length });
    this.toggle.setAttribute('aria-pressed', String(state.enabled)); this.toggle.classList.toggle('active', state.enabled);
    if (document.activeElement !== this.expression) this.expression.value = state.expression || formatLineExpression(state.indices, chart);
    if (rowsChanged||forceRows||this.rowsChart?.judgeLineList.length!==chart.judgeLineList.length) { this.list.render(); this.rowsChart=chart; }
    else this.list.sync();
  }
}
