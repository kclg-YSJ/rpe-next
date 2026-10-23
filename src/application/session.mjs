import { History } from './history.mjs';
import { integerChartAlpha } from '../core/alpha-values.mjs';
import { createChart, createLine } from '../core/chart.mjs';
import { beatValue, fromNumber } from '../core/beat.mjs';
import { selectionState, sameSelection, remapSelection, restoreSelection } from './selection-history.mjs';
import { emitModHook } from '../core/mod-hooks.mjs';
import { t } from '../i18n.mjs';

export class EditorSession extends EventTarget {
  constructor(chart = createChart()) {
    super();
    this.history = new History(integerChartAlpha(chart));
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

  get chart() { return this.history.document; }
  get line() { return this.chart.judgeLineList?.[this.lineIndex]; }
  get notes() { return this.line?.notes ?? []; }
  get multiLineActive() { return this.multiLineEnabled && this.multiLineIndices.length > 0; }
  get targetLineIndices() {
    if (!this.multiLineActive) return [this.lineIndex];
    return [...this.multiLineIndices];
  }
  get targetLines() { return this.targetLineIndices.map(index => this.chart.judgeLineList?.[index]).filter(Boolean); }
  isTargetLine(index) { return this.multiLineActive && this.multiLineIndices.includes(index); }
  setMultiLineEnabled(enabled = true, mode = this.multiLineMode) {
    this.multiLineEnabled = Boolean(enabled);
    this.multiLineMode = mode === 'events' ? 'events' : 'notes';
    if (this.multiLineEnabled && !this.multiLineIndices.length) this.multiLineIndices = [this.lineIndex];
    // Turning the mode off only hides multi-line editing. Keep the selected line
    // list and per-line selections so reopening the mode restores the workspace.
    this.normalizeMultiLine(); this.notify();
  }
  setMultiLineMerge(enabled) { this.multiLineMerge = Boolean(enabled); this.notify(); }
  setMultiLineMode(mode) { this.multiLineMode = mode === 'events' ? 'events' : 'notes'; this.notify(); }
  normalizeMultiLine() {
    const length = this.chart.judgeLineList?.length ?? 0;
    this.multiLineIndices = [...new Set(this.multiLineIndices.filter(index => Number.isInteger(index) && index >= 0 && index < length))].sort((a, b) => a - b);
    if (this.multiLineEnabled && !this.multiLineIndices.length && length) this.multiLineIndices = [Math.max(0, Math.min(this.lineIndex, length - 1))];
  }
  addMultiLine(index = this.lineIndex) {
    this.multiLineEnabled = true;
    if (Number.isInteger(index)) this.multiLineIndices = [...this.multiLineIndices, index];
    this.normalizeMultiLine(); this.notify();
  }
  removeMultiLine(index = this.lineIndex) {
    this.multiLineIndices = this.multiLineIndices.filter(value => value !== index);
    if (!this.multiLineIndices.length) this.multiLineEnabled = false;
    this.normalizeMultiLine(); this.notify();
  }
  clearMultiLines() { this.multiLineIndices = []; this.multiLineEnabled = false; this.notify(); }
  toggleMultiLine(index = this.lineIndex) { this.isTargetLine(index) ? this.removeMultiLine(index) : this.addMultiLine(index); }
  addNextMultiLine() {
    if (!this.multiLineIndices.length) return this.addMultiLine(this.lineIndex);
    const length = this.chart.judgeLineList?.length ?? 0;
    if (!length || this.multiLineIndices.length >= length) return;
    const selected = new Set(this.multiLineIndices);
    for (let offset = 1; offset <= length; offset++) {
      const next = (Math.max(...this.multiLineIndices) + offset) % length;
      if (!selected.has(next)) return this.addMultiLine(next);
    }
  }
  addPreviousMultiLine() {
    if (!this.multiLineIndices.length) return this.addMultiLine(this.lineIndex);
    const length = this.chart.judgeLineList?.length ?? 0;
    if (!length || this.multiLineIndices.length >= length) return;
    const selected = new Set(this.multiLineIndices);
    for (let offset = 1; offset <= length; offset++) {
      const previous = (Math.min(...this.multiLineIndices) - offset + length * 2) % length;
      if (!selected.has(previous)) return this.addMultiLine(previous);
    }
  }
  removeMaximumMultiLine() {
    if (this.multiLineIndices.length) this.removeMultiLine(Math.max(...this.multiLineIndices));
  }
  removeMinimumMultiLine() {
    if (this.multiLineIndices.length) this.removeMultiLine(Math.min(...this.multiLineIndices));
  }
  notify() { this.dispatchEvent(new Event('change')); }

  selectionState() { return selectionState(this); }

  replaceMusicResource(name) {
    const previous = this.chart.META.song;
    const replacements = new Map();
    const replace = chart => {
      if (!chart || chart.META.song !== previous) return chart;
      if (!replacements.has(chart)) replacements.set(chart, { ...chart, META: { ...chart.META, song: name } });
      return replacements.get(chart);
    };
    if (this.collaboration) return this.collaboration.commit(t('session.s5816272'), replace(this.chart), { recordHistory: false });
    this.history.document = replace(this.chart);
    for (const command of [...this.history.undoStack, ...this.history.redoStack]) {
      command.before = replace(command.before); command.after = replace(command.after);
    }
    this.notify();
  }

  commit(label, chart, beforeSelection = this.selectionState()) {
    const change=emitModHook('session:before-commit',{session:this,label,chart,beforeSelection,cancel:false,normalizeAlpha:true});
    if(change.cancel)return false;label=change.label;chart=change.chart;beforeSelection=change.beforeSelection;
    if(change.normalizeAlpha!==false)chart = integerChartAlpha(chart, this.chart);
    if (this.collaboration) {const result=this.collaboration.commit(label, chart, beforeSelection);emitModHook('session:after-commit',{session:this,label,chart:this.chart});return result;}
    if (this.history.commit(label, chart, { beforeSelection, afterSelection: this.selectionState() })) {
      const time = Number.isFinite(this.editSeconds) ? Math.max(0, this.editSeconds) : 0;
      this.recentEdits.push({ start: time, end: time, label });
      if (this.recentEdits.length > 50) this.recentEdits.shift();
    }
    this.notify();
    emitModHook('session:after-commit',{session:this,label,chart:this.chart});
  }

  updateLine(label, change, beforeSelection = this.selectionState()) {
    if (!this.line) throw new Error(t('session.s1ad6f80'));
    const lines = [...this.chart.judgeLineList];
    lines[this.lineIndex] = change(this.line);
    this.commit(label, { ...this.chart, judgeLineList: lines }, beforeSelection);
  }

  updateNotes(label, change, beforeSelection = this.selectionState()) {
    this.updateLine(label, line => {
      const notes = change(line.notes ?? []);
      return { ...line, notes, numOfNotes: notes.length };
    }, beforeSelection);
  }

  insertNotes(notes, label = t('session.s229874f')) {
    return this.insertNotesAt(this.lineIndex, notes, label);
  }

  insertNotesAt(lineIndex, notes, label = t('session.s229874f')) {
    const beforeSelection = this.selectionState();
    const lines = [...this.chart.judgeLineList];
    let selected = [];
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

  selectedNoteEntries() {
    if (this.multiLineActive && this.multiLineMode === 'notes') {
      return [...(this.multiLineSelection ?? new Map())].flatMap(([lineIndex, indices]) => {
        const line = this.chart.judgeLineList?.[lineIndex];
        return [...indices].map(index => ({ lineIndex, index, note: line?.notes?.[index] })).filter(entry => entry.note);
      });
    }
    return [...this.selection].map(index => ({ lineIndex: this.lineIndex, index, note: this.notes[index] })).filter(entry => entry.note);
  }

  deleteSelection() {
    const entries = this.selectedNoteEntries();
    if (!entries.length) return;
    const beforeSelection = this.selectionState();
    const lines = [...this.chart.judgeLineList];
    const selectedByLine = new Map();
    for (const entry of entries) {
      if (!selectedByLine.has(entry.lineIndex)) selectedByLine.set(entry.lineIndex, new Set());
      selectedByLine.get(entry.lineIndex).add(entry.index);
    }
    for (const [lineIndex, selected] of selectedByLine) {
      const line = lines[lineIndex]; if (!line) continue;
      const remaining = (line.notes ?? []).filter((note, noteIndex) => !selected.has(noteIndex));
      lines[lineIndex] = { ...line, notes: remaining, numOfNotes: remaining.length };
    }
    this.selection = new Set();
    if (this.multiLineActive && this.multiLineMode === 'notes') this.multiLineSelection = new Map();
    this.commit(t('session.s4c896a7'), { ...this.chart, judgeLineList: lines }, beforeSelection);
  }

  transformSelection(label, change) {
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

  moveSelectionToLine(targetLineIndex) {
    const entries = this.selectedNoteEntries();
    if (!entries.length || !Number.isInteger(targetLineIndex) || targetLineIndex < 0 || targetLineIndex >= this.chart.judgeLineList.length) return;
    if (this.multiLineActive && this.multiLineMode === 'notes') {
      const beforeSelection = this.selectionState();
      const lines = [...this.chart.judgeLineList];
      const selectedByLine = new Map();
      for (const entry of entries) {
        if (!selectedByLine.has(entry.lineIndex)) selectedByLine.set(entry.lineIndex, []);
        selectedByLine.get(entry.lineIndex).push(entry);
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
      const selectedIndices = new Set();
      for (const entry of moving) { selectedIndices.add(targetNotes.length); targetNotes.push(structuredClone(entry.note)); }
      lines[targetLineIndex] = { ...target, notes: targetNotes, numOfNotes: targetNotes.length };
      this.multiLineSelection = new Map([[targetLineIndex, selectedIndices]]);
      this.selection = targetLineIndex === this.lineIndex ? new Set(selectedIndices) : new Set();
      this.commit(t('session.s060c482'), { ...this.chart, judgeLineList: lines }, beforeSelection);
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
    this.commit(t('session.s060c482'), { ...this.chart, judgeLineList: lines }, beforeSelection);
  }

  copy() { this.clipboard = structuredClone(this.notes.filter((note, index) => this.selection.has(index))); }

  paste(beat, mirror = false, keepTime = false) {
    if (!this.clipboard.length) return;
    const earliest = this.clipboard.reduce((minimum, note) => Math.min(minimum, beatValue(note.startTime)), Infinity);
    const delta = keepTime ? 0 : beat - earliest;
    this.insertNotes(this.clipboard.map(note => ({ ...structuredClone(note),
      positionX: note.positionX * (mirror ? -1 : 1),
      startTime: delta === 0 ? [...note.startTime] : fromNumber(beatValue(note.startTime) + delta),
      endTime: delta === 0 ? [...note.endTime] : fromNumber(beatValue(note.endTime) + delta),
    })), t('session.sba9e2d5'));
  }

  selectLine(index) {
    this.lineIndex = index;
    this.selection = new Set(this.multiLineActive ? (this.multiLineSelection.get(index) ?? []) : []);
    this.eventSelection = new Set(this.multiLineActive ? (this.multiEventSelection.get(index) ?? []) : []);
    this.normalizeMultiLine(); this.notify();
  }

  addLine() {
    const beforeSelection = this.selectionState();
    this.lineIndex = this.chart.judgeLineList?.length ?? 0;
    this.selection.clear();
    this.eventSelection.clear();
    this.commit(t('session.s665c6b7'), { ...this.chart, judgeLineList: [...(this.chart.judgeLineList ?? []), createLine(`Line ${this.lineIndex + 1}`)] }, beforeSelection);
  }

  travel(direction) {
    const auxiliary = (direction === 'undo' ? this.history.undoStack : this.history.redoStack).at(-1);
    if (auxiliary?.auxiliaryOnly) { this.history[direction](); this.notify(); return; }
    if (this.collaboration) return this.collaboration.travel(direction);
    const command = (direction === 'undo' ? this.history.undoStack : this.history.redoStack).at(-1);
    if (!command) return;
    const current = this.selectionState(); const source = this.chart;
    const from = direction === 'undo' ? command.afterSelection : command.beforeSelection;
    const to = direction === 'undo' ? command.beforeSelection : command.afterSelection;
    if (!this.history[direction]()) return;
    restoreSelection(this, sameSelection(current, from) && to ? to : remapSelection(source, this.chart, current));
    this.notify();
  }
}
