import { EditorSession } from './session.ts';
import { createChart } from '../core/chart.ts';
import { globalColumnKey, validateColumnEvent, validateGlobalEvents, GLOBAL_EVENT_VERSION } from '../core/global-events.ts';
import type { GlobalColumnEntry, GlobalEventRegistry, GlobalEventTypeDefinition } from '../core/global-events.ts';
import type { Chart, EventLayer, GlobalEventValue, GlobalEventsData } from '../core/types.ts';
import type { History } from './history.ts';
import type { SelectionState } from './selection-history.ts';

interface GlobalEventSession {
  chart: Chart;
  history: History;
  collaboration?: unknown;
  commit(label: string, chart: Chart): void;
  notify(): void;
}

interface GlobalEventState {
  transient: Map<string, GlobalEventValue[]>;
  selection: Set<string>;
}

interface GlobalEventChange {
  type: string;
  column: string;
  events: GlobalEventValue[];
}

class GlobalEditingSession extends EditorSession {
  document: GlobalEventDocument;

  constructor(document: GlobalEventDocument) { super(); this.document = document; this.focus = 'events'; }

  override get chart(): Chart { return this.document?.snapshot() ?? super.chart; }

  override commit(label: string, chart: Chart, beforeSelection: SelectionState = this.selectionState()): boolean {
    const extended = chart.judgeLineList[0].extended as Record<string, GlobalEventValue[]>;
    return this.document.apply(this.document.columns.filter(column => extended[column.key] !== column.events)
      .map(column => ({ type: column.type.id, column: column.column.id, events: extended[column.key] })), label, [...this.eventSelection], beforeSelection.eventSelection);
  }

  override notify(): void { this.document?.notify(); }
}

/** Projects global columns into the ordinary event editor; the projection is never saved. */
export class GlobalEventDocument {
  registry: GlobalEventRegistry;
  getSession: () => GlobalEventSession;
  changed: () => void;
  states: WeakMap<GlobalEventSession, GlobalEventState>;
  editor: GlobalEditingSession;
  boundState?: GlobalEventState;
  cached: Chart | null;
  sourceChart?: Chart;
  sourceTransient?: Map<string, GlobalEventValue[]>;
  registryRevision?: number;
  projectedColumns: GlobalColumnEntry[];

  constructor(registry: GlobalEventRegistry, getSession: () => { chart: Chart }, changed: () => void = () => {}) {
    this.registry = registry; this.getSession = getSession as () => GlobalEventSession; this.changed = changed;
    this.states = new WeakMap(); this.editor = new GlobalEditingSession(this); this.cached = null; this.projectedColumns = [];
  }

  state(): GlobalEventState {
    const session = this.getSession(); let state = this.states.get(session);
    if (!state) { state = { transient: new Map(), selection: new Set() }; this.states.set(session, state); }
    if (this.boundState !== state) { this.boundState = state; this.editor.eventSelection = state.selection; this.cached = null; }
    return state;
  }

  get types(): GlobalEventTypeDefinition[] { return this.registry.list(this.getSession().chart); }

  get columns(): GlobalColumnEntry[] { this.snapshot(); return this.projectedColumns; }

  snapshot(): Chart {
    const chart = this.getSession().chart, state = this.state();
    if (this.cached && this.sourceChart === chart && this.sourceTransient === state.transient && this.registryRevision === this.registry.revision) return this.cached;
    this.sourceChart = chart; this.sourceTransient = state.transient; this.registryRevision = this.registry.revision;
    this.projectedColumns = this.registry.list(chart).flatMap(type => type.columns.map(column => {
      const key = globalColumnKey(type.id, column.id), events = type.persistent ? chart.globalEvents?.types?.[type.id]?.columns?.[column.id]?.events ?? [] : state.transient.get(key) ?? [];
      return { type, column, key, events };
    }));
    const fake = createChart(); fake.META = { ...chart.META }; fake.BPMList = chart.BPMList;
    fake.judgeLineList[0] = { ...fake.judgeLineList[0], bpmfactor: 1, eventLayers: [{}], extended: Object.fromEntries(this.projectedColumns.map(column => [column.key, column.events])) as unknown as EventLayer };
    this.cached = fake;
    const valid = new Set(this.projectedColumns.flatMap(column => column.events.map((event, index) => column.key + ':' + index)));
    this.editor.eventSelection = new Set([...this.editor.eventSelection].filter(key => valid.has(key))); state.selection = this.editor.eventSelection;
    return fake;
  }

  notify(): void { this.state().selection = this.editor.eventSelection; this.changed(); }

  apply(changes: GlobalEventChange[], label = '编辑全局事件', selection: string[] = [...this.editor.eventSelection], beforeSelection: string[] = [...this.editor.eventSelection]): boolean {
    if (!changes.length) return false;
    const session = this.getSession(), original = session.chart, state = this.state(), beforeTransient = state.transient;
    const columns = this.columns; let nextTransient = beforeTransient, chart = original;
    for (const change of changes) {
      const entry = columns.find(entry => entry.type.id === change.type && entry.column.id === change.column);
      if (!entry || entry.type.readonly) throw Error('全局事件：类型尚未加载或不存在');
      if (!Array.isArray(change.events)) throw Error('全局事件列必须为数组');
      const events: GlobalEventValue[] = structuredClone(change.events);
      events.forEach(event => { validateColumnEvent(entry.column, event); const result = entry.type.validate?.(event, entry.column); if (result === false || typeof result === 'string') throw Error(typeof result === 'string' ? result : '全局事件校验失败'); });
      if (entry.type.persistent) {
        const data: GlobalEventsData = chart.globalEvents ?? { version: 1, types: {} }, previous = data.types[entry.type.id];
        const type = { ...previous, name: entry.type.name, source: { ...entry.type.source }, ...(entry.type.width !== undefined ? { width: entry.type.width } : {}), columns: { ...previous?.columns,
          [entry.column.id]: { ...previous?.columns?.[entry.column.id], name: entry.column.name, valueType: entry.column.valueType, ...(entry.column.width !== undefined ? { width: entry.column.width } : {}), ...(entry.column.timelineLabel !== undefined ? { timelineLabel: entry.column.timelineLabel } : {}), events } } };
        chart = { ...chart, META: { ...chart.META, RPEVersion: Math.max(chart.META.RPEVersion ?? 0, GLOBAL_EVENT_VERSION) }, globalEvents: { ...data, types: { ...data.types, [entry.type.id]: type } } };
      } else { if (nextTransient === beforeTransient) nextTransient = new Map(beforeTransient); nextTransient.set(entry.key, events); }
    }
    validateGlobalEvents(chart);
    const restore = (transient: Map<string, GlobalEventValue[]>, selection: string[]): void => { state.transient = transient; state.selection = new Set(selection); if (this.getSession() === session) { this.editor.eventSelection = state.selection; this.cached = null; } };
    const auxiliary = { undo: () => restore(beforeTransient, beforeSelection), redo: () => restore(nextTransient, selection) };
    if (chart !== original) {
      const previous = session.history.undoStack.at(-1);
      session.commit(label, chart);
      if (session.chart === original) return false;
      const command = session.history.undoStack.at(-1);
      if (session.collaboration && nextTransient !== beforeTransient) { const collaboration = session.collaboration as { queue: Array<{ auxiliary?: { undo(): void; redo(): void } }> }; const operation = collaboration.queue.at(-1); if (operation) operation.auxiliary = auxiliary; }
      else if (command && command !== previous) command.auxiliary = auxiliary;
    } else session.history.commitAuxiliary(label, auxiliary);
    restore(nextTransient, selection); session.notify(); this.changed(); return true;
  }

  read(type: string, column: string): GlobalEventValue[] { return structuredClone(this.columns.find(entry => entry.type.id === type && entry.column.id === column)?.events ?? []); }
}
