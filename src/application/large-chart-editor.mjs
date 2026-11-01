import { selectionState, restoreSelection } from './selection-history.mjs';

const referenceKey = '_rpenLargeRef';
const copiesKey = '_rpenLargeCopies';
const lineKey = '_rpenLargeLine';
const cleanNote = note => {
  const result = { ...note }; delete result[referenceKey]; delete result[copiesKey]; delete result._rpenLargeClipboard; return result;
};
const headerOf = chart => {
  const header = { ...chart, judgeLineList: chart.judgeLineList.map(line => ({ ...line, notes: [], numOfNotes: 0 })) };
  delete header.rpeNextLargeChart; return header;
};

// The chart in EditorSession is a disposable page. Only explicit differences
// against that page may reach the document; absence outside it is never deletion.
export class LargeChartEditor {
  constructor(session, summary, call, { changed = () => {}, error = () => {}, gestureActive = () => false } = {}) {
    this.session = session; this.call = call; this.changed = changed; this.error = error; this.gestureActive = gestureActive;
    this.locations = new Map(); this.pageGeneration = 0; this.editCount = 1; this.pending = Promise.resolve();
    this.updateSummary(summary); session.largeDocument = this; this.syncHistory();
  }
  updateSummary(summary) { this.summary = summary; this.header = summary.chart; this.revision = summary.revision; }
  syncHistory() {
    const history = this.session.history;
    history.undoStack = this.summary.undo.map(entry => ({ ...entry })); history.redoStack = this.summary.redo.map(entry => ({ ...entry }));
    history.savedDocument = this.summary.dirty || this.busy ? null : history.document;
  }
  quantity(note) {
    const count = note?.[referenceKey]?.count ?? 1;
    if (this.logicalSelection) return note?.[referenceKey]?.selected ?? count;
    if (this.session.multiSelectionIntent === 'notes') return count;
    return this.editCount === 'all' ? count : Math.min(count, this.editCount);
  }
  selectionSignature() {
    const session = this.session;
    if(session.multiLineActive&&session.multiLineMode==='notes')return JSON.stringify([...session.multiLineSelection].map(([line,ids])=>[line,[...ids]]));
    return JSON.stringify([session.lineIndex, [...session.selection], [...session.multiLineSelection].map(([line, ids]) => [line, [...ids]])]);
  }
  selectionChanged() {
    if (this.logicalSelection && !this.applyingSelection && this.logicalSignature !== this.selectionSignature()) this.logicalSelection = null;
  }
  get selectedCount() {
    return this.logicalSelection?.total ?? this.session.selectedNoteEntries().reduce((total, entry) => total + this.quantity(entry.note), 0);
  }
  copyNote(note) { return { ...structuredClone(cleanNote(note)), [copiesKey]: this.quantity(note) }; }
  selectedIds(chart = this.session.chart) {
    const session = this.session, entries = session.multiLineActive && session.multiLineMode === 'notes'
      ? [...session.multiLineSelection].flatMap(([line, indices]) => [...indices].map(index => chart.judgeLineList[line]?.notes[index]))
      : [...session.selection].map(index => chart.judgeLineList[session.lineIndex]?.notes[index]);
    return entries.map(note => note?.[referenceKey]?.id).filter(Number.isSafeInteger);
  }
  captureSelection(chart, state, idsAt = null) {
    const keys = state.multiLineEnabled && state.multiLineMode === 'notes' ? state.multiLineSelection.flatMap(([line, indices]) => indices.map(index => [line, index])) : state.selection.map(index => [state.lineIndex, index]);
    return { state, noteIds: this.logicalSelection ? [] : keys.map(([line, index]) => idsAt ? idsAt.get(`${line}:${index}`) : chart.judgeLineList[line]?.notes[index]?.[referenceKey]?.id).filter(value => value !== undefined), ...(this.logicalSelection ? { diskSelection: this.logicalSelection } : {}) };
  }
  applyPage(page, selectedIds = this.selectedIds(), state = selectionState(this.session)) {
    const lines = page.header.judgeLineList.map(line => ({ ...line, notes: [], numOfNotes: 0 }));
    this.locations = new Map();
    for (const entry of page.notes) {
      const line = lines[entry.line], index = line.notes.length;
      entry.note[referenceKey].multi = entry.multi;
      entry.note[referenceKey].selected = entry.selected ?? 0;
      line.notes.push(entry.note); this.locations.set(entry.note[referenceKey].id, { line: entry.line, index });
    }
    for (const [index, line] of lines.entries()) line.numOfNotes = this.summary.lines[index] ?? 0;
    this.session.history.document = { ...page.header, judgeLineList: lines, rpeNextLargeChart: { total: this.summary.total } };
    const selected = this.logicalSelection ? page.notes.filter(entry => entry.selected > 0).map(entry => this.locations.get(entry.note[referenceKey].id)) : selectedIds.map(id => this.locations.get(id)).filter(Boolean);
    const byLine = new Map();
    for (const item of selected) { if (!byLine.has(item.line)) byLine.set(item.line, []); byLine.get(item.line).push(item.index); }
    this.applyingSelection = true;
    restoreSelection(this.session, { ...state, selection: byLine.get(state.lineIndex) ?? [], multiLineSelection: [...byLine] });
    this.logicalSignature = this.selectionSignature(); this.applyingSelection = false;
    this.range = { lines: page.lines, start: page.start, end: page.end };
    this.page = { ...this.range, revision: page.revision }; this.pageGeneration++;
    this.syncHistory(); this.session.notify(); this.changed();
  }
  async refresh({ selectedIds = this.selectedIds(), state = selectionState(this.session) } = {}) {
    const current = this.range ?? { lines: [this.session.lineIndex], start: -8, end: 24 };
    const range = { ...current, lines: current.lines.filter(line => this.header.judgeLineList[line]) };
    const page = await this.call('page', this.summary.id, { ...range, pinned: this.logicalSelection ? [] : selectedIds, selection: this.logicalSelection?.token });
    if (!this.disposed) this.applyPage(page, selectedIds, state);
  }
  covers(range) { return this.page?.revision === this.revision && this.page.start <= range.start && this.page.end >= range.end && JSON.stringify(this.page.lines) === JSON.stringify(range.lines); }
  async ensurePage(range) {
    if (this.disposed || this.busy || this.gestureActive() || this.covers(range)) return;
    const requested = this.exactPages ? { ...range, lines: [...range.lines] } : { lines: [...range.lines], start: Math.floor(range.start / 8) * 8 - 8, end: Math.ceil(range.end / 8) * 8 + 8 };
    if (this.reading) return this.reading;
    const revision = this.revision, selectedIds = this.selectedIds(), state = selectionState(this.session), signature = JSON.stringify({ requested, range, revision, selectedIds });
    if (this.failedRead === signature) return;
    let actual = requested;
    const logicalToken = this.logicalSelection?.token, options = { pinned: logicalToken ? [] : selectedIds, selection: logicalToken };
    this.reading = this.call('page', this.summary.id, { ...requested, ...options }).catch(error => {
      // Dense pages may fit on screen but not in the wider prefetch margin.
      // Retry the visible interval before asking the user to zoom in.
      if (!/过多|预算/.test(error.message)) throw error;
      this.exactPages = true;
      actual = { ...range, lines: [...range.lines] }; return this.call('page', this.summary.id, { ...actual, ...options });
    }).then(page => {
      if (this.disposed || this.busy || revision !== this.revision || this.gestureActive() || this.logicalSelection?.token !== logicalToken || JSON.stringify(selectionState(this.session)) !== JSON.stringify(state)) return;
      this.range = actual; this.applyPage(page, selectedIds); this.failedRead = null;
    }).catch(error => { this.failedRead = signature; this.error(error); }).finally(() => { this.reading = null; });
    return this.reading;
  }
  run(action) {
    if (this.busy || this.disposed) return false;
    this.busy = true; this.syncHistory(); this.changed();
    this.pending = (async () => {
      try { return await action(); }
      finally { this.busy = false; this.syncHistory(); if (!this.disposed) { this.session.notify(); this.changed(); } }
    })();
    // UI commands are synchronous, while callers such as save/close can await
    // flush(). Keep rejected commands observable without unhandled rejections.
    this.pending.catch(error => this.error(error)); return true;
  }
  selectRegions(regions, { append = false, remove = false, interval = 1, references = [] } = {}) {
    const state = selectionState(this.session), ids = [...new Set([...(append && !this.logicalSelection ? this.selectedIds() : []),...references])];
    state.focus = 'notes'; this.session.multiSelectionIntent = 'notes';
    const base = append ? this.logicalSelection?.token : undefined;
    return this.run(async () => {
      let previous=base;
      for(let offset=0;offset<Math.max(1,regions.length);offset+=1024){
        this.logicalSelection=await this.call('selection',this.summary.id,{revision:this.revision,regions:regions.slice(offset,offset+1024),base:previous,remove,interval:offset+1024>=regions.length?interval:1,ids:offset===0?ids:[]});
        previous=this.logicalSelection.token;
      }
      await this.refresh({ state });
    });
  }
  selectAll(lines = this.session.targetLineIndices) {
    return this.selectRegions(lines.map(line => ({ line, start: -1e7, end: 1e7 })));
  }
  transformSelected(label, transform, { lineOffset = 0, targetLine, remove = false } = {}) {
    if (!this.logicalSelection) return false;
    const token = this.logicalSelection.token, beforeSelection = this.captureSelection(this.session.chart, selectionState(this.session));
    return this.run(async () => {
      const stage = await this.call('selectionEdit', this.summary.id, { action: 'begin', revision: this.revision, token });
      try {
        let cursor = 0, index = 0;
        for (;;) {
          const page = await this.call('selectionRead', this.summary.id, { token, after: cursor });
          const changes = [];
          for (const entry of page.entries) {
            let line = targetLine ?? ((entry.line + lineOffset) % this.header.judgeLineList.length + this.header.judgeLineList.length) % this.header.judgeLineList.length;
            const produced = remove ? null : transform(entry.note, { lineIndex: entry.line, index: index++, count: entry.count });
            const note = produced?.note ?? produced; if(produced?.note)line=produced.line??line;
            if (!remove && (!note || typeof note !== 'object')) throw Error('批量音符修改缺少有效结果');
            if (remove || line !== entry.line || JSON.stringify(cleanNote(note)) !== JSON.stringify(cleanNote(entry.note))) changes.push({ id: entry.note[referenceKey].id, line, note: note ? cleanNote(note) : undefined });
          }
          if (changes.length) await this.call('selectionEdit', this.summary.id, { action: 'append', stage, changes });
          cursor = page.after; if (page.done) break;
        }
        const summary = await this.call('selectionEdit', this.summary.id, { action: 'finish', stage, label, beforeSelection, afterSelection: beforeSelection });
        this.updateSummary(summary); this.logicalSelection = summary.selection;
        await this.refresh();
      } catch (error) { await this.call('selectionEdit', this.summary.id, { action: 'cancel', stage }).catch(() => {}); throw error; }
    });
  }
  async copySelected() {
    if (!this.logicalSelection) return 0;
    let result;
    if (!this.run(async () => {
      result = await this.call('selectionCopy', this.summary.id, { token: this.logicalSelection.token });
      this.session.clipboard = result.sample ? [{ ...result.sample, _rpenLargeClipboard: { owner: this.summary.id, token: result.clipboard, total: result.total } }] : [];
      this.session.clipboardNoteLines = [result.firstLine]; this.session.eventClipboard = []; this.session.eventClipboardLines = []; this.session.clipboardVisible = true;
      if(result.groups<=40000){
        const notes=[],lines=[];let after=0,bytes=0;
        for(;;){const page=await this.call('selectionRead',this.summary.id,{token:this.logicalSelection.token,after});
          for(const entry of page.entries){const note={...cleanNote(entry.note),[copiesKey]:entry.count};bytes+=JSON.stringify(note).length*2;notes.push(note);lines.push(entry.line);}
          if(bytes>24*1024**2)break;
          if(page.done){this.session.clipboard=notes;this.session.clipboardNoteLines=lines;break;}after=page.after;
        }
      }
    })) return 0;
    await this.flush(); return result.total;
  }
  pasteSelected(beat, { mirror = false, keepTime = false, targetLineIndex = this.session.lineIndex } = {}) {
    const clipboard = this.session.clipboard.find(note => note._rpenLargeClipboard)?._rpenLargeClipboard;
    if (!clipboard) return false;
    if (clipboard.owner !== this.summary.id) throw Error('此大选区的剪贴板属于另一个工程，请在原工程中粘贴');
    const state = this.captureSelection(this.session.chart, selectionState(this.session));
    return this.run(async () => {
      const summary = await this.call('selectionPaste', this.summary.id, { revision: this.revision, clipboard: clipboard.token, beat, mirror, keepTime, targetLine: targetLineIndex, beforeSelection: state, afterSelection: state });
      this.updateSummary(summary); this.logicalSelection = summary.selection; this.session.focus = 'notes'; this.session.multiSelectionIntent = 'notes'; await this.refresh();
    });
  }
  commit(label, next, beforeSelection) {
    if (this.busy || this.disposed) { restoreSelection(this.session, beforeSelection); return false; }
    const lineCopies = [], lineIds = new Set(), copiedIndices = new Set();
    next = { ...next, judgeLineList: next.judgeLineList.map((line, index) => {
      const oldId = line[lineKey];
      if (oldId && !lineIds.has(oldId)) { lineIds.add(oldId); return line; }
      const id = crypto.randomUUID(); lineIds.add(id);
      if (oldId) { lineCopies.push({ source: oldId, target: id }); copiedIndices.add(index); }
      return { ...line, [lineKey]: id };
    }) };
    const previous = this.session.chart, state = selectionState(this.session), original = new Map(), changes = [], destinations = [];
    const nextLineIds = new Set(next.judgeLineList.map(line => line[lineKey]));
    for (const [line, value] of previous.judgeLineList.entries()) for (const note of value.notes) original.set(note[referenceKey].id, { note, line, lineId: value[lineKey] });
    const seen = new Set(), idsAt = new Map();
    for (const [line, value] of next.judgeLineList.entries()) for (const [index, note] of (value.notes ?? []).entries()) {
      if (copiedIndices.has(line)) continue;
      const id = note[referenceKey]?.id, source = original.get(id), key = `${line}:${index}`;
      if (source && !seen.has(id)) {
        seen.add(id); idsAt.set(key, id);
        if (source.lineId !== value[lineKey] || source.note !== note && JSON.stringify(cleanNote(source.note)) !== JSON.stringify(cleanNote(note))) {
          idsAt.set(key, { change: destinations.length }); changes.push({ id, line, count: this.quantity(source.note), note: cleanNote(note) }); destinations.push(key);
        }
      } else { idsAt.set(key, { change: destinations.length }); changes.push({ line, count: note[copiesKey] ?? 1, note: cleanNote(note) }); destinations.push(key); }
    }
    for (const [id, entry] of original) if (!seen.has(id) && nextLineIds.has(entry.lineId)) changes.push({ id, count: this.quantity(entry.note) });
    const header = headerOf(next), changedHeader = JSON.stringify(header) !== JSON.stringify(headerOf(previous));
    if (!changes.length && !changedHeader) return false;
    const selectedKeys = state.multiLineEnabled && state.multiLineMode === 'notes' ? state.multiLineSelection.flatMap(([line, indices]) => indices.map(index => `${line}:${index}`)) : state.selection.map(index => `${state.lineIndex}:${index}`);
    const keepLogical = this.logicalSelection && selectedKeys.length && selectedKeys.every(key=>Number.isSafeInteger(idsAt.get(key)));
    const afterSelection = keepLogical ? this.captureSelection(next,state,idsAt) : {state,noteIds:selectedKeys.map(key=>idsAt.get(key)).filter(value=>value!==undefined)};
    return this.run(async () => {
      try {
        const summary = await this.call('edit', this.summary.id, { revision: this.revision, label, changes, lineCopies, ...(changedHeader ? { header } : {}), selectionBefore: this.captureSelection(previous, beforeSelection), selectionAfter: afterSelection });
        this.updateSummary(summary);
        if(!keepLogical)this.logicalSelection=null;
        destinations.forEach((key, index) => idsAt.set(key, summary.result[index]));
        const keys = state.multiLineEnabled && state.multiLineMode === 'notes' ? state.multiLineSelection.flatMap(([line, indices]) => indices.map(index => `${line}:${index}`)) : state.selection.map(index => `${state.lineIndex}:${index}`);
        await this.refresh({ selectedIds: keys.map(key => idsAt.get(key)).filter(Number.isSafeInteger), state });
      } catch (error) { restoreSelection(this.session, beforeSelection); throw error; }
    });
  }
  travel(direction) {
    return this.run(async () => {
      const current = this.captureSelection(this.session.chart, selectionState(this.session));
      const currentLineId = this.session.line?.[lineKey];
      const summary = await this.call('travel', this.summary.id, { direction, revision: this.revision }); this.updateSummary(summary);
      const sameIds = (left, right) => JSON.stringify([...left].sort((a, b) => a - b)) === JSON.stringify([...right].sort((a, b) => a - b));
      const source = summary.sourceSelection;
      let restored = summary.restoredSelection;
      const sameNotes = current.diskSelection || source?.diskSelection ? current.diskSelection?.token === source?.diskSelection?.token : sameIds(current.noteIds, source?.noteIds ?? []);
      if (source && (!sameNotes || current.state.lineIndex !== source.state.lineIndex || current.state.focus !== source.state.focus || JSON.stringify(current.state.eventSelection) !== JSON.stringify(source.state.eventSelection) || JSON.stringify(current.state.multiEventSelection) !== JSON.stringify(source.state.multiEventSelection))) {
        const lineIndex = summary.chart.judgeLineList.findIndex(line => line[lineKey] === currentLineId);
        restored = { ...current, state: { ...current.state, lineIndex: lineIndex < 0 ? current.state.lineIndex : lineIndex } };
      }
      this.logicalSelection = restored?.diskSelection ?? null;
      await this.refresh(restored ? { selectedIds: restored.noteIds, state: restored.state } : {});
    });
  }
  async flush() { for (;;) { const pending=this.pending; await pending; if(pending===this.pending)return; } }
  save(saveAs = false) {
    if(this.busy)return this.pending.catch(()=>{}).then(()=>this.save(saveAs));
    let saved = null;
    if (!this.run(async () => { const summary = await this.call('save', this.summary.id, { saveAs }); if (summary) { this.updateSummary(summary); this.syncHistory(); saved = summary; } })) return Promise.resolve(null);
    return this.flush().then(()=>saved);
  }
  dispose() { this.disposed = true; this.session.largeDocument = null; }
}
