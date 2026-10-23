import { EditorSession } from './session.mjs';
import { createChart } from '../core/chart.mjs';
import { globalColumnKey, validateColumnEvent, validateGlobalEvents, GLOBAL_EVENT_VERSION } from '../core/global-events.mjs';
import { t } from '../i18n.mjs';

class GlobalEditingSession extends EditorSession {
  constructor(document) { super(); this.document = document; this.focus = 'events'; }
  get chart() { return this.document?.snapshot() ?? super.chart; }
  commit(label, chart, beforeSelection = this.selectionState()) {
    return this.document.apply(this.document.columns.filter(column => chart.judgeLineList[0].extended[column.key] !== column.events)
      .map(column => ({ type: column.type.id, column: column.column.id, events: chart.judgeLineList[0].extended[column.key] })), label, [...this.eventSelection], beforeSelection.eventSelection);
  }
  notify() { this.document?.notify(); }
}

/** Projects global columns into the ordinary event editor; the projection is never saved. */
export class GlobalEventDocument {
  constructor(registry, getSession, changed = () => {}) {
    this.registry = registry; this.getSession = getSession; this.changed = changed; this.states = new WeakMap(); this.editor = new GlobalEditingSession(this);
  }
  state() {
    const session = this.getSession(); let state = this.states.get(session);
    if (!state) { state = { transient: new Map(), selection: new Set() }; this.states.set(session, state); }
    if (this.boundState !== state) { this.boundState = state; this.editor.eventSelection = state.selection; this.cached = null; }
    return state;
  }
  get types() { return this.registry.list(this.getSession().chart); }
  get columns() { this.snapshot(); return this.projectedColumns; }
  snapshot() {
    const chart = this.getSession().chart, state = this.state();
    if (this.cached && this.sourceChart === chart && this.sourceTransient === state.transient && this.registryRevision === this.registry.revision) return this.cached;
    this.sourceChart = chart; this.sourceTransient = state.transient; this.registryRevision = this.registry.revision;
    this.projectedColumns = this.registry.list(chart).flatMap(type => type.columns.map(column => {
      const key = globalColumnKey(type.id, column.id), events = type.persistent ? chart.globalEvents?.types?.[type.id]?.columns?.[column.id]?.events ?? [] : state.transient.get(key) ?? [];
      return { type, column, key, events };
    }));
    const fake = createChart(); fake.META = { ...chart.META }; fake.BPMList = chart.BPMList;
    fake.judgeLineList[0] = { ...fake.judgeLineList[0], bpmfactor: 1, eventLayers: [{}], extended: Object.fromEntries(this.projectedColumns.map(column => [column.key, column.events])) };
    this.cached = fake;
    const valid = new Set(this.projectedColumns.flatMap(column => column.events.map((event, index) => column.key + ':' + index)));
    this.editor.eventSelection = new Set([...this.editor.eventSelection].filter(key => valid.has(key))); state.selection = this.editor.eventSelection;
    return fake;
  }
  notify() { this.state().selection = this.editor.eventSelection; this.changed(); }
  apply(changes, label = t('global-events.s40758d3'), selection = [...this.editor.eventSelection], beforeSelection = [...this.editor.eventSelection]) {
    if (!changes.length) return false;
    const session = this.getSession(), original = session.chart, state = this.state(), beforeTransient = state.transient;
    const columns = this.columns; let nextTransient = beforeTransient, chart = original;
    for (const change of changes) {
      const entry = columns.find(entry => entry.type.id === change.type && entry.column.id === change.column);
      if (!entry || entry.type.readonly) throw Error(t('global-events.s2be176a'));
      if (!Array.isArray(change.events)) throw Error(t('global-events.sc5574f8'));
      const events = structuredClone(change.events); events.forEach(event => { validateColumnEvent(entry.column, event); const result = entry.type.validate?.(event, entry.column); if (result === false || typeof result === 'string') throw Error(typeof result === 'string' ? result : t('global-events.s634a0c2')); });
      if (entry.type.persistent) {
        const data = chart.globalEvents ?? { version: 1, types: {} }, previous = data.types[entry.type.id];
        const type = { ...previous, name: entry.type.name, source: { ...entry.type.source }, ...(entry.type.width !== undefined ? { width: entry.type.width } : {}), columns: { ...previous?.columns,
          [entry.column.id]: { ...previous?.columns?.[entry.column.id], name: entry.column.name, valueType: entry.column.valueType, ...(entry.column.width !== undefined ? { width: entry.column.width } : {}), ...(entry.column.timelineLabel !== undefined ? { timelineLabel: entry.column.timelineLabel } : {}), events } } };
        chart = { ...chart, META: { ...chart.META, RPEVersion: Math.max(chart.META.RPEVersion ?? 0, GLOBAL_EVENT_VERSION) }, globalEvents: { ...data, types: { ...data.types, [entry.type.id]: type } } };
      } else { if (nextTransient === beforeTransient) nextTransient = new Map(beforeTransient); nextTransient.set(entry.key, events); }
    }
    validateGlobalEvents(chart);
    const restore = (transient, selection) => { state.transient = transient; state.selection = new Set(selection); if (this.getSession() === session) { this.editor.eventSelection = state.selection; this.cached = null; } };
    const auxiliary = { undo: () => restore(beforeTransient, beforeSelection), redo: () => restore(nextTransient, selection) };
    if (chart !== original) {
      const previous = session.history.undoStack.at(-1);
      session.commit(label, chart);
      if (session.chart === original) return false;
      const command = session.history.undoStack.at(-1);
      if (session.collaboration && nextTransient !== beforeTransient) { const operation = session.collaboration.queue.at(-1); if (operation) operation.auxiliary = auxiliary; }
      else if (command && command !== previous) command.auxiliary = auxiliary;
    } else session.history.commitAuxiliary(label, auxiliary);
    restore(nextTransient, selection); session.notify(); this.changed(); return true;
  }
  read(type, column) { return structuredClone(this.columns.find(entry => entry.type.id === type && entry.column.id === column)?.events ?? []); }
}
