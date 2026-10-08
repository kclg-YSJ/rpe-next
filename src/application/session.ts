import { History } from './history.ts';
import type { SelectionState } from './selection-history.ts';
import { createChart, createLine } from '../core/chart.ts';
import type { AnyEventType, Chart, ChartEvent, JudgeLine, Note } from '../core/types.ts';
import { beatValue, fromNumber } from '../core/beat.ts';
import type { TempoMap } from '../core/tempo.ts';
import { selectionState, sameSelection, remapSelection, restoreSelection } from './selection-history.ts';

/** A note together with the line it belongs to; the unit `selectedNoteEntries` hands to callers. */
export interface NoteEntry {
  lineIndex: number;
  index: number;
  note: Note | undefined;
}

/** One entry of the recent-edit readout drawn above the timeline. */
export interface RecentEdit {
  start: number;
  end: number;
  label: string;
}

/**
 * Which editing area the multi-line selection currently drives. Kept as a string union so that
 * session state written through `restoreSelection` stays assignable.
 */
export type SelectionFocus = string;

export class EditorSession extends EventTarget {
  // Every field is declared explicitly: unannotated fields would be inferred too narrowly (an empty
  // `Set`/`Map` literal infers `Set<never>`/`Map<any, any>`), which cascades into the callers.
  history: History;
  lineIndex: number;
  selection: Set<number>;
  clipboard: Note[];
  /** Line each clipboard note came from, index-aligned with `clipboard`. */
  clipboardNoteLines: number[];
  eventSelection: Set<string>;
  eventClipboard: { type: AnyEventType; event: ChartEvent }[];
  /** Line each clipboard event came from, index-aligned with `eventClipboard`. */
  eventClipboardLines: number[];
  eventLayer: number;
  focus: SelectionFocus;
  multiLineEnabled: boolean;
  multiLineMode: 'notes' | 'events';
  multiLineMerge: boolean;
  multiLineIndices: number[];
  multiLineSelection: Map<number, Set<number>>;
  multiEventSelection: Map<number, Set<string>>;
  /** Which area the multi-selection gesture was started in, or `null` when idle. */
  multiSelectionIntent: 'notes' | 'events' | null;
  editSeconds: number;
  recentEdits: RecentEdit[];
  /**
   * Fields `app.ts` attaches to the session on every render rather than storing on the class.
   *
   * They must be optional because they genuinely do not exist until `renderSession` runs — the
   * editor-wide `liveEventEdit` suppression flag, the per-track wheel increments, and the tempo map
   * and grid settings the timeline measures with, which are shared with the event commands.
   */
  liveNoteEdit?: boolean;
  liveEventEdit?: boolean;
  liveBeatEdit?: boolean;
  eventWheelSteps?: Partial<Record<AnyEventType, number>>;
  visibleTimeUnit?: string;
  tempo?: TempoMap;
  division?: number;
  cutDensity?: number;
  /** Whether a shader event's parameters follow it when its start beat changes; defaults to on. */
  shaderAutoAlign?: boolean;
  /**
   * The live collaboration client, attached by `collaboration-client.mjs` when a shared session
   * starts and set back to `null` when it ends; absent entirely in a local session, which is why
   * `commit` and `travel` both test it first.
   *
   * Typed structurally rather than imported: the client is still plain JavaScript, so importing it
   * would pull an untyped module into the type graph for the sake of two method signatures.
   */
  collaboration?: { commit(label: string, chart: Chart, beforeSelection?: SelectionState): void; travel(direction: 'undo' | 'redo'): void } | null;

  constructor(chart: Chart = createChart()) {
    super();
    this.history = new History(chart);
    this.lineIndex = 0;
    this.selection = new Set();
    this.clipboard = [];
    this.clipboardNoteLines = [];
    this.eventSelection = new Set();
    this.eventClipboard = [];
    this.eventClipboardLines = [];
    this.eventLayer = 0;
    this.focus = 'notes';
    this.multiLineEnabled = false;
    this.multiLineMode = 'notes';
    this.multiLineMerge = true;
    this.multiLineIndices = [];
    this.multiLineSelection = new Map();
    this.multiEventSelection = new Map();
    this.multiSelectionIntent = null;
    this.editSeconds = 0;
    this.recentEdits = [];
  }

  get chart(): Chart { return this.history.document; }
  get line(): JudgeLine | undefined { return this.chart.judgeLineList?.[this.lineIndex]; }
  get notes(): Note[] { return this.line?.notes ?? []; }
  get multiLineActive(): boolean { return this.multiLineEnabled && this.multiLineIndices.length > 0; }
  get targetLineIndices(): number[] {
    if (!this.multiLineActive) return [this.lineIndex];
    return [...this.multiLineIndices];
  }
  get targetLines(): JudgeLine[] { return this.targetLineIndices.map(index => this.chart.judgeLineList?.[index]).filter(Boolean); }
  isTargetLine(index: number): boolean { return this.multiLineActive && this.multiLineIndices.includes(index); }
  setMultiLineEnabled(enabled = true, mode: 'notes' | 'events' = this.multiLineMode): void {
    this.multiLineEnabled = Boolean(enabled);
    this.multiLineMode = mode === 'events' ? 'events' : 'notes';
    if (this.multiLineEnabled && !this.multiLineIndices.length) this.multiLineIndices = [this.lineIndex];
    // Turning the mode off only hides multi-line editing. Keep the selected line
    // list and per-line selections so reopening the mode restores the workspace.
    this.normalizeMultiLine(); this.notify();
  }
  setMultiLineMerge(enabled: unknown): void { this.multiLineMerge = Boolean(enabled); this.notify(); }
  setMultiLineMode(mode: string): void { this.multiLineMode = mode === 'events' ? 'events' : 'notes'; this.notify(); }
  normalizeMultiLine(): void {
    const length = this.chart.judgeLineList?.length ?? 0;
    this.multiLineIndices = [...new Set(this.multiLineIndices.filter(index => Number.isInteger(index) && index >= 0 && index < length))].sort((a, b) => a - b);
    if (this.multiLineEnabled && !this.multiLineIndices.length && length) this.multiLineIndices = [Math.max(0, Math.min(this.lineIndex, length - 1))];
  }
  addMultiLine(index: number = this.lineIndex): void {
    this.multiLineEnabled = true;
    if (Number.isInteger(index)) this.multiLineIndices = [...this.multiLineIndices, index];
    this.normalizeMultiLine(); this.notify();
  }
  removeMultiLine(index: number = this.lineIndex): void {
    this.multiLineIndices = this.multiLineIndices.filter(value => value !== index);
    if (!this.multiLineIndices.length) this.multiLineEnabled = false;
    this.normalizeMultiLine(); this.notify();
  }
  clearMultiLines(): void { this.multiLineIndices = []; this.multiLineEnabled = false; this.notify(); }
  toggleMultiLine(index: number = this.lineIndex): void { this.isTargetLine(index) ? this.removeMultiLine(index) : this.addMultiLine(index); }
  addNextMultiLine(): void {
    if (!this.multiLineIndices.length) return this.addMultiLine(this.lineIndex);
    const length = this.chart.judgeLineList?.length ?? 0;
    if (!length || this.multiLineIndices.length >= length) return;
    const selected = new Set(this.multiLineIndices);
    for (let offset = 1; offset <= length; offset++) {
      const next = (Math.max(...this.multiLineIndices) + offset) % length;
      if (!selected.has(next)) return this.addMultiLine(next);
    }
  }
  addPreviousMultiLine(): void {
    if (!this.multiLineIndices.length) return this.addMultiLine(this.lineIndex);
    const length = this.chart.judgeLineList?.length ?? 0;
    if (!length || this.multiLineIndices.length >= length) return;
    const selected = new Set(this.multiLineIndices);
    for (let offset = 1; offset <= length; offset++) {
      const previous = (Math.min(...this.multiLineIndices) - offset + length * 2) % length;
      if (!selected.has(previous)) return this.addMultiLine(previous);
    }
  }
  removeMaximumMultiLine(): void {
    if (this.multiLineIndices.length) this.removeMultiLine(Math.max(...this.multiLineIndices));
  }
  removeMinimumMultiLine(): void {
    if (this.multiLineIndices.length) this.removeMultiLine(Math.min(...this.multiLineIndices));
  }
  notify(): void { this.dispatchEvent(new Event('change')); }

  selectionState(): SelectionState { return selectionState(this); }

  commit(label: string, chart: Chart, beforeSelection: SelectionState = this.selectionState()): void {
    if (this.collaboration) return this.collaboration.commit(label, chart, beforeSelection);
    if (this.history.commit(label, chart, { beforeSelection, afterSelection: this.selectionState() })) {
      const time = Number.isFinite(this.editSeconds) ? Math.max(0, this.editSeconds) : 0;
      this.recentEdits.push({ start: time, end: time, label });
      if (this.recentEdits.length > 50) this.recentEdits.shift();
    }
    this.notify();
  }

  updateLine(label: string, change: (line: JudgeLine) => JudgeLine, beforeSelection: SelectionState = this.selectionState()): void {
    if (!this.line) throw new Error('请先新增判定线');
    const lines = [...this.chart.judgeLineList];
    lines[this.lineIndex] = change(this.line);
    this.commit(label, { ...this.chart, judgeLineList: lines }, beforeSelection);
  }

  updateNotes(label: string, change: (notes: Note[]) => Note[], beforeSelection: SelectionState = this.selectionState()): void {
    this.updateLine(label, line => {
      const notes = change(line.notes ?? []);
      return { ...line, notes, numOfNotes: notes.length };
    }, beforeSelection);
  }

  insertNotes(notes: Note[], label = '添加音符'): boolean {
    return this.insertNotesAt(this.lineIndex, notes, label);
  }

  insertNotesAt(lineIndex: number, notes: Note[], label = '添加音符'): boolean {
    const beforeSelection = this.selectionState();
    const lines = [...this.chart.judgeLineList];
    let selected: number[] = [];
    const existing = lines[lineIndex]?.notes ?? [];
    const first = existing.length;
    if (!lines[lineIndex]) return false;
    lines[lineIndex] = { ...lines[lineIndex], notes: [...existing, ...structuredClone(notes)], numOfNotes: first + notes.length };
    selected = notes.map((note, offset) => first + offset);
    if (this.multiLineActive && this.multiLineMode === 'notes') {
      this.multiLineSelection.clear();
      this.multiLineSelection.set(lineIndex, new Set(selected));
      if (lineIndex === this.lineIndex) this.selection = new Set(selected);
    } else this.selection = new Set(selected);
    this.commit(label, { ...this.chart, judgeLineList: lines }, beforeSelection);
    return true;
  }

  selectedNoteEntries(): NoteEntry[] {
    if (this.multiLineActive && this.multiLineMode === 'notes') {
      return [...(this.multiLineSelection ?? new Map())].flatMap(([lineIndex, indices]) => {
        const line = this.chart.judgeLineList?.[lineIndex];
        return [...indices].map(index => ({ lineIndex, index, note: line?.notes?.[index] })).filter(entry => entry.note);
      });
    }
    return [...this.selection].map(index => ({ lineIndex: this.lineIndex, index, note: this.notes[index] })).filter(entry => entry.note);
  }

  deleteSelection(): void {
    const entries = this.selectedNoteEntries();
    if (!entries.length) return;
    const beforeSelection = this.selectionState();
    const lines = [...this.chart.judgeLineList];
    const selectedByLine = new Map<number, Set<number>>();
    for (const entry of entries) {
      if (!selectedByLine.has(entry.lineIndex)) selectedByLine.set(entry.lineIndex, new Set());
      selectedByLine.get(entry.lineIndex)?.add(entry.index);
    }
    for (const [lineIndex, selected] of selectedByLine) {
      const line = lines[lineIndex]; if (!line) continue;
      const remaining = (line.notes ?? []).filter((note, noteIndex) => !selected.has(noteIndex));
      lines[lineIndex] = { ...line, notes: remaining, numOfNotes: remaining.length };
    }
    this.selection = new Set();
    if (this.multiLineActive && this.multiLineMode === 'notes') this.multiLineSelection = new Map();
    this.commit('删除音符', { ...this.chart, judgeLineList: lines }, beforeSelection);
  }

  transformSelection(label: string, change: (note: Note | undefined, entry: NoteEntry) => Note): void {
    const entries = this.selectedNoteEntries();
    if (!entries.length) return;
    const lines = [...this.chart.judgeLineList];
    const changes = new Map(entries.map(entry => [`${entry.lineIndex}:${entry.index}`, change(entry.note, entry)]));
    for (const lineIndex of new Set(entries.map(entry => entry.lineIndex))) {
      const line = lines[lineIndex]; if (!line) continue;
      const notes = (line.notes ?? []).map((note, index) => changes.get(`${lineIndex}:${index}`) ?? note);
      lines[lineIndex] = { ...line, notes, numOfNotes: notes.length };
    }
    this.commit(label, { ...this.chart, judgeLineList: lines });
  }

  moveSelectionToLine(targetLineIndex: number): void {
    const entries = this.selectedNoteEntries();
    if (!entries.length || !Number.isInteger(targetLineIndex) || targetLineIndex < 0 || targetLineIndex >= this.chart.judgeLineList.length) return;
    if (this.multiLineActive && this.multiLineMode === 'notes') {
      const beforeSelection = this.selectionState();
      const lines = [...this.chart.judgeLineList];
      const selectedByLine = new Map<number, NoteEntry[]>();
      for (const entry of entries) {
        if (!selectedByLine.has(entry.lineIndex)) selectedByLine.set(entry.lineIndex, []);
        selectedByLine.get(entry.lineIndex)?.push(entry);
      }
      const moving = entries.filter(entry => entry.lineIndex !== targetLineIndex);
      for (const [lineIndex, selectedEntries] of selectedByLine) {
        if (lineIndex === targetLineIndex) continue;
        const line = lines[lineIndex]; if (!line) continue;
        const selected = new Set(selectedEntries.map(entry => entry.index));
        const notes = (line.notes ?? []).filter((note, index) => !selected.has(index));
        lines[lineIndex] = { ...line, notes, numOfNotes: notes.length };
      }
      const target = lines[targetLineIndex]; if (!target) return;
      const targetNotes = [...(target.notes ?? [])];
      const selectedIndices = new Set<number>();
      for (const entry of moving) { selectedIndices.add(targetNotes.length); targetNotes.push(structuredClone(entry.note) as Note); }
      lines[targetLineIndex] = { ...target, notes: targetNotes, numOfNotes: targetNotes.length };
      this.multiLineSelection = new Map([[targetLineIndex, selectedIndices]]);
      this.selection = targetLineIndex === this.lineIndex ? new Set(selectedIndices) : new Set();
      this.commit('移动音符到判定线', { ...this.chart, judgeLineList: lines }, beforeSelection);
      return;
    }
    if (targetLineIndex === this.lineIndex) return;
    const beforeSelection = this.selectionState();
    const lines = [...this.chart.judgeLineList];
    const source = lines[this.lineIndex];
    const target = lines[targetLineIndex];
    const moving = source.notes.filter((note, index) => this.selection.has(index));
    const remaining = source.notes.filter((note, index) => !this.selection.has(index));
    const targetNotes = [...(target.notes ?? []), ...structuredClone(moving)];
    lines[this.lineIndex] = { ...source, notes: remaining, numOfNotes: remaining.length };
    lines[targetLineIndex] = { ...target, notes: targetNotes, numOfNotes: targetNotes.length };
    this.lineIndex = targetLineIndex;
    this.selection = new Set(moving.map((_, index) => target.notes.length + index));
    this.eventSelection.clear();
    this.commit('移动音符到判定线', { ...this.chart, judgeLineList: lines }, beforeSelection);
  }

  copy(): void { this.clipboard = structuredClone(this.notes.filter((note, index) => this.selection.has(index))); }

  paste(beat: number, mirror = false, keepTime = false): void {
    if (!this.clipboard.length) return;
    const earliest = this.clipboard.reduce((minimum, note) => Math.min(minimum, beatValue(note.startTime)), Infinity);
    const delta = keepTime ? 0 : beat - earliest;
    this.insertNotes(this.clipboard.map(note => ({ ...structuredClone(note),
      positionX: note.positionX * (mirror ? -1 : 1),
      startTime: delta === 0 ? [...note.startTime] : fromNumber(beatValue(note.startTime) + delta),
      endTime: delta === 0 ? [...note.endTime] : fromNumber(beatValue(note.endTime) + delta),
    })), '粘贴音符');
  }

  selectLine(index: number): void {
    this.lineIndex = index;
    this.selection = new Set(this.multiLineActive ? (this.multiLineSelection.get(index) ?? []) : []);
    this.eventSelection = new Set(this.multiLineActive ? (this.multiEventSelection.get(index) ?? []) : []);
    this.normalizeMultiLine(); this.notify();
  }

  addLine(): void {
    const beforeSelection = this.selectionState();
    this.lineIndex = this.chart.judgeLineList?.length ?? 0;
    this.selection.clear();
    this.eventSelection.clear();
    this.commit('新增判定线', { ...this.chart, judgeLineList: [...(this.chart.judgeLineList ?? []), createLine(`Line ${this.lineIndex + 1}`)] }, beforeSelection);
  }

  travel(direction: 'undo' | 'redo'): void {
    if (this.collaboration) return this.collaboration.travel(direction);
    const command = (direction === 'undo' ? this.history.undoStack : this.history.redoStack).at(-1);
    if (!command) return;
    const current = this.selectionState(); const source = this.chart;
    const from = direction === 'undo' ? command.afterSelection : command.beforeSelection;
    const to = direction === 'undo' ? command.beforeSelection : command.afterSelection;
    if (!this.history[direction]()) return;
    const restore = sameSelection(current, from as SelectionState | undefined) && to ? to : remapSelection(source, this.chart, current);
    restoreSelection(this, restore as SelectionState);
    this.notify();
  }
}
