import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { LargeChartDocument } from '../desktop/large-chart-document.mjs';
import { LargeChartPreviewService } from '../desktop/large-chart-preview.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { LargeChartEditor } from '../src/application/large-chart-editor.mjs';
import { createNote, createEvent } from '../src/core/chart.mjs';
import { copyObjects, pasteObjects, cutObjects } from '../src/application/clipboard.mjs';
import { duplicateLine, reorderLine, deleteLine } from '../src/application/line-commands.mjs';
import { beatValue } from '../src/core/beat.mjs';
import { insertEventAt, selectEvent, deleteEvents } from '../src/application/event-commands.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'rpen-large-edit-')), workspace = join(root, 'work');
  await mkdir(workspace);
  const source = join(root, 'source.zip'), zip = new yazl.ZipFile();
  // The source intentionally uses PEC text in a .json entry, including both
  // inline modifiers and a Hold crossing the edit window boundary.
  zip.addBuffer(Buffer.from('175\nbp 0 120\ncv 0 0 10\nca 0 0 255\ncv 1 0 10\nca 1 0 255\nn1 0 1 100 1 # 1.5 & 1.25\nn1 0 1 100 1 # 1.5 & 1.25\nn2 0 4 80 0 0\n# 0\nn3 1 10000 200 1\n'), 'chart.json');
  zip.end(); await pipeline(zip.outputStream, createWriteStream(source));
  const document = new LargeChartDocument(workspace);
  const errors = [];
  try {
    await document.import(source); const summary = await document.editable();
    const session = new EditorSession(structuredClone(summary.chart));
    const call = async (method, id, value) => {
      // Real IPC clones responses: sharing chart objects here would hide bugs.
      let result;
      if (method === 'page') result = document.page(value);
      else if (method === 'edit') result = await document.edit(value);
      else if (method === 'travel') result = await document.travel(value);
      else if (method === 'save') result = await document.saveDatabase(join(root, 'saved.rpenlarge'));
      else if (method === 'selection') result = await document.selections.select(value);
      else if (method === 'selectionRead') result = document.selections.read(value);
      else if (method === 'selectionEdit') result = await document.selections.stage(value);
      else if (method === 'selectionCopy') result = await document.selections.copy(value);
      else if (method === 'selectionPaste') result = await document.selections.paste(value);
      return structuredClone(result);
    };
    const editor = new LargeChartEditor(session, structuredClone(summary), call, { error: error => errors.push(error.message) });
    editor.range = { lines: [0], start: 0, end: 8 }; await editor.refresh();
    await run({ root, document, editor, session, errors, call });
  } finally { document.close(); await rm(root, { recursive: true, force: true }); }
}

test('XY event transactions persist both axes together in large-chart storage and history', () => fixture(async ({ session, editor, document, errors }) => {
  session.selectLine(1); session.focus = 'events'; session.xyBinding = true;
  const before = document.revision;
  insertEventAt(session, 1, 'moveXEvents', createEvent(10, 20, 5, 6)); await editor.flush();
  const tracks = () => document.chart.judgeLineList[1].eventLayers[0];
  assert.deepEqual(tracks().moveXEvents.map(event => [beatValue(event.startTime), beatValue(event.endTime)]), [[5, 6]]);
  assert.deepEqual(tracks().moveYEvents.map(event => [beatValue(event.startTime), beatValue(event.endTime)]), [[5, 6]]);
  assert.equal(document.revision, before + 1); assert.equal(document.total, 4);
  session.travel('undo'); await editor.flush(); assert.equal((tracks().moveXEvents ?? []).length, 0); assert.equal((tracks().moveYEvents ?? []).length, 0);
  session.travel('redo'); await editor.flush(); selectEvent(session, 1, 'moveYEvents', 0, { replace: true }); deleteEvents(session); await editor.flush();
  assert.equal(tracks().moveXEvents.length, 0); assert.equal(tracks().moveYEvents.length, 0);
  session.travel('undo'); await editor.flush(); assert.equal(tracks().moveXEvents.length, 1); assert.equal(tracks().moveYEvents.length, 1);
  assert.equal(document.page({ lines: [1], start: 9999, end: 10001 }).notes.length, 1); assert.deepEqual(errors, []);
}));

test('ordinary placement, drag/property transforms, copy/cut/paste and history preserve unloaded notes', () => fixture(async ({ session, editor, document, errors }) => {
  assert.equal(session.notes.length, 2); assert.equal(document.total, 4);
  assert.equal(session.notes[0].speed, 1.5); assert.equal(session.notes[0].size, 1.25);
  session.selection = new Set([0]);
  session.transformSelection('拖动一个重合音符', note => ({ ...note, positionX: 300 }));
  await editor.flush();
  assert.equal(document.total, 4); assert.equal(session.notes.length, 3);
  assert.equal(session.selectedNoteEntries()[0].note.positionX, 300);
  assert.deepEqual(session.notes.filter(note => note.type === 1).map(note => note._rpenLargeRef.count), [1, 1]);
  assert.equal(document.page({ lines: [1], start: 9999, end: 10001 }).notes.length, 1);

  session.transformSelection('修改属性并移出窗口', note => ({ ...note, startTime: [200, 0, 1], endTime: [200, 0, 1], alpha: 123.9, tint: [10, 20, 30], judgeArea: 2 }));
  await editor.flush();
  assert.equal(session.selectedNoteEntries()[0].note.alpha, 123);
  assert.equal(beatValue(session.selectedNoteEntries()[0].note.startTime), 200, 'selected off-window note is pinned');
  copyObjects(session);
  assert.equal(session.clipboard[0]._rpenLargeRef, undefined, 'clipboard is a value, never a database identity');
  pasteObjects(session, 2); await editor.flush();
  assert.equal(document.total, 5); assert.equal(beatValue(session.selectedNoteEntries()[0].note.startTime), 2);
  assert.deepEqual(session.selectedNoteEntries()[0].note.tint, [10, 20, 30]);
  cutObjects(session); await editor.flush(); assert.equal(document.total, 4);
  pasteObjects(session, 3); await editor.flush(); assert.equal(document.total, 5);
  session.travel('undo'); await editor.flush(); assert.equal(document.total, 4);
  session.travel('redo'); await editor.flush(); assert.equal(document.total, 5);

  session.insertNotes([createNote(4, 6, -300)], '放置'); await editor.flush();
  assert.equal(document.total, 6); assert.equal(session.selectedNoteEntries()[0].note.type, 4);
  assert.equal(session.history.undoStack.length, 6);
  assert.deepEqual(errors, []);
}));

test('ten million repeated notes remain bounded and support partial transform, copy and delete', () => fixture(async ({ session, editor, document }) => {
  await document.edit({ revision: 0, changes: [{ line: 0, note: createNote(1, 2, 0), count: 10000000 }] });
  editor.updateSummary(structuredClone(document.describe())); await editor.refresh();
  session.selection = new Set([session.notes.findIndex(note => beatValue(note.startTime) === 2)]);
  editor.editCount = 7;
  session.transformSelection('局部属性', note => ({ ...note, positionX: 123 })); await editor.flush();
  assert.equal(document.total, 10000004); assert.equal(session.selectedNoteEntries()[0].note._rpenLargeRef.count, 7);
  copyObjects(session); pasteObjects(session, 3); await editor.flush(); assert.equal(document.total, 10000011);
  session.deleteSelection(); await editor.flush(); assert.equal(document.total, 10000004);
  const large = session.notes.findIndex(note => note._rpenLargeRef.count > 1000);
  session.selection = new Set([large]); editor.editCount = 'all'; session.deleteSelection(); await editor.flush();
  assert.equal(document.total, 11);
  session.travel('undo'); await editor.flush(); assert.equal(document.total, 10000004);
  assert.ok(session.notes.length < 10); assert.ok(document.window({ seconds: 1.01 }).combo >= 10000002);
}));

test('page changes retain selection, include crossing Holds, and do not create undo or dirty state', () => fixture(async ({ session, editor, document }) => {
  session.selection = new Set([0]);
  await editor.ensurePage({ lines: [0], start: 50, end: 60 });
  assert.equal(session.selectedNoteEntries()[0].note.type, 1);
  assert.ok(session.notes.some(note => note.type === 2), 'Hold overlaps the new window');
  session.selectLine(1); await editor.ensurePage({ lines: [1], start: 9999, end: 10001 });
  assert.equal(session.notes.length, 1); assert.equal(session.notes[0].type, 3);
  assert.equal(session.history.undoStack.length, 0); assert.equal(session.history.dirty, false); assert.equal(document.total, 4);
}));

test('event/BPM reindexing, line reorder/delete, saved reopening and persisted history cover the full document', () => fixture(async ({ root, session, editor, document }) => {
  const lines = [...session.chart.judgeLineList];
  lines[0] = { ...lines[0], eventLayers: [{ ...lines[0].eventLayers[0], speedEvents: [createEvent(10, 10, 0, 0)] }], bpmfactor: 2 };
  session.commit('时序修改', { ...session.chart, judgeLineList: lines, BPMList: [{ bpm: 60, startTime: [0, 0, 1] }] }); await editor.flush();
  assert.equal(document.page({ lines: [1], start: 9999, end: 10001 }).notes.length, 1);
  session.commit('交换判定线', reorderLine(session.chart, 0, 1)); await editor.flush();
  assert.equal(document.page({ lines: [0], start: 9999, end: 10001 }).notes.length, 1);
  session.commit('删除整条判定线', deleteLine(session.chart, 0)); await editor.flush(); assert.equal(document.total, 3);
  session.travel('undo'); await editor.flush(); assert.equal(document.total, 4);
  await editor.save(); assert.equal(session.history.dirty, false);
  const reopen = join(root, 'reopen'); await mkdir(reopen); await copyFile(join(root, 'saved.rpenlarge'), join(reopen, 'notes.sqlite'));
  const restored = new LargeChartDocument(reopen);
  try {
    const summary = await restored.restoreDatabase(join(reopen, 'notes.sqlite'));
    assert.equal(summary.total, 4); assert.equal(summary.dirty, false);
    assert.equal(restored.page({ lines: [0], start: 9999, end: 10001 }).notes.length, 1);
    await restored.travel({ direction: 'redo', revision: restored.revision }); assert.equal(restored.total, 3);
    await restored.travel({ direction: 'undo', revision: restored.revision }); assert.equal(restored.total, 4);
  } finally { restored.close(); }
}));

test('failed transactions and failed saves retain the committed document and dirty state', () => fixture(async ({ root, session, editor, document, errors }) => {
  session.insertNotes([createNote(1, 2, 0)]); await editor.flush();
  await assert.rejects(document.edit({ revision: document.revision, changes: [{ id: session.notes[0]._rpenLargeRef.id }, { id: 999999 }] }));
  assert.equal(document.total, 5); assert.equal(document.page({ lines: [0], start: 0, end: 8 }).notes.length, 3);
  await assert.rejects(document.saveDatabase(join(root, 'missing', 'saved.rpenlarge')));
  assert.equal(document.describe().dirty, true);
  session.transformSelection('无效属性', note => ({ ...note, positionX: Infinity }));
  await assert.rejects(editor.flush()); assert.equal(document.total, 5); assert.equal(session.history.dirty, true);
  assert.ok(errors.length > 0);
}));

test('duplicating a line includes its unloaded repeated notes and remains one undo step', () => fixture(async ({ session, editor, document }) => {
  session.commit('复制屏外判定线', duplicateLine(session.chart, 1)); await editor.flush();
  assert.equal(document.total, 5);
  assert.equal(document.page({ lines: [2], start: 9999, end: 10001 }).notes.length, 1);
  session.travel('undo'); await editor.flush(); assert.equal(document.total, 4);
  session.travel('redo'); await editor.flush(); assert.equal(document.total, 5);
}));

test('preview prefetch retains recently judged notes for hit effects without changing combo boundaries', () => fixture(async ({ document }) => {
  const ordinary = document.window({ seconds: .6 }), history = document.window({ seconds: .6, historySpan: .75 });
  assert.equal(ordinary.notes.filter(note => note.t === 1).length, 0);
  assert.equal(history.notes.find(note => note.t === 1).n, 2);
  assert.equal(history.combo, ordinary.combo); assert.equal(history.combo, 2);
}));

test('an in-flight prefetch cannot replace the committed edit range or break a concurrent edit', () => fixture(async ({ session, editor, document, call }) => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  editor.call = async (method, id, value) => { if (method === 'page' && value.end - value.start > 16) { await gate; throw Error('可见编辑区的不同音符过多'); } return call(method, id, value); };
  const read = editor.ensurePage({ lines: [0], start: 50, end: 60 });
  assert.deepEqual(editor.range, { lines: [0], start: 0, end: 8 });
  session.selection = new Set([0]); session.transformSelection('预取中修改', note => ({ ...note, positionX: 321 })); await editor.flush();
  release(); await read;
  assert.equal(document.total, 4); assert.equal(session.selectedNoteEntries()[0].note.positionX, 321);
  assert.equal(editor.page.start, 0); assert.equal(editor.page.end, 8);
}));

test('logical multi-selection includes every repetition and unloaded group for transforms, copy, delete and history', () => fixture(async ({ session, editor, document }) => {
  await document.edit({ revision: document.revision, changes: [
    { line: 0, note: createNote(1, 2, 0), count: 10000000 },
    ...Array.from({ length: 20 }, (_, index) => ({ line: 0, note: createNote(3, 20 + index, index) })),
  ] });
  editor.updateSummary(structuredClone(document.describe())); await editor.refresh();
  const loaded = session.notes.length;
  editor.selectRegions([{ line: 0, start: 0, end: 40, left: -1000, right: 1000 }]); await editor.flush();
  assert.equal(editor.selectedCount, 10000023); assert.ok(loaded < editor.logicalSelection.groups);
  assert.equal(session.history.undoStack.length, 1, 'selection does not add edit history');
  session.transformSelection('全部选中音符平移', note => ({ ...note, positionX: note.positionX + 10 })); await editor.flush();
  assert.equal(editor.selectedCount, 10000023); assert.equal(document.total, 10000024);
  assert.equal(document.page({ lines: [0], start: 39, end: 39 }).notes.find(entry => entry.note.type === 3).note.positionX, 29);
  const copied = await copyObjects(session); assert.equal(copied, 10000023);
  pasteObjects(session, 100); await editor.flush(); assert.equal(document.total, 20000047); assert.equal(editor.selectedCount, copied);
  session.deleteSelection(); await editor.flush(); assert.equal(document.total, 10000024);
  session.travel('undo'); await editor.flush(); assert.equal(document.total, 20000047); assert.equal(editor.selectedCount, copied);
  session.travel('undo'); await editor.flush(); assert.equal(document.total, 10000024); assert.equal(editor.selectedCount, copied);
  session.travel('redo'); await editor.flush(); assert.equal(document.total, 20000047);
}));

test('logical selection scans beyond rendering limits and atomically rolls back an invalid off-window edit', () => fixture(async ({ session, editor, document }) => {
  const changes = Array.from({ length: 80 }, (_, index) => ({ line: 0, note: createNote(1, 10 + index, index), count: 3 }));
  await document.edit({ revision: document.revision, changes }); editor.updateSummary(structuredClone(document.describe()));
  document.limits.windowGroups = 8;
  editor.selectAll([0]); await editor.flush(); assert.equal(editor.selectedCount, 243); assert.ok(session.notes.length <= 8);
  session.transformSelection('包含无效屏外结果', note => ({ ...note, positionX: beatValue(note.startTime) > 80 ? Infinity : 100 }));
  await assert.rejects(editor.flush()); assert.equal(document.total, 244);
  assert.equal(document.page({ lines: [0], start: 89, end: 89 }).notes[0].note.positionX, 79);
  assert.equal(document.page({ lines: [0], start: 10, end: 10 }).notes[0].note.positionX, 0);
}));

test('hitsound windows include full repetition counts, both delays and off-page lines', () => fixture(async ({ document }) => {
  await document.edit({ revision: document.revision, changes: [{ line: 1, note: createNote(4, 2, 0), count: 10000000 }] });
  const all = document.hits({ start: .4, end: 1.1 });
  assert.equal(all.entries.find(entry => entry.kind === 'tap').count, 2);
  assert.equal(all.entries.find(entry => entry.kind === 'drag').count, 10000000);
  const delayed = document.hits({ start: 1.2, end: 1.4, delays: { tap: 800, drag: 300 } });
  assert.equal(delayed.entries.length, 2);
  assert.equal(document.hits({ start: .4, end: 1.1, line: 0 }).entries.some(entry => entry.kind === 'drag'), false);
}));

test('logical selection survives multi-line focus changes and Ctrl-style removal without dropping off-page items', () => fixture(async ({ session, editor, document }) => {
  session.multiLineEnabled=true;session.multiLineMode='notes';session.multiLineIndices=[0,1];
  editor.selectAll([0,1]);await editor.flush();assert.equal(editor.selectedCount,4);
  session.selectLine(1);assert.equal(editor.selectedCount,4);
  const id=document.page({lines:[1],start:9999,end:10001}).notes[0].note._rpenLargeRef.id;
  editor.selectRegions([],{append:true,remove:true,references:[id]});await editor.flush();assert.equal(editor.selectedCount,3);
  editor.selectRegions([],{append:true,references:[id]});await editor.flush();assert.equal(editor.selectedCount,4);
}));

test('unchanged logical transforms do not add history, and selection history remains usable after clearing and reselecting', () => fixture(async ({ session, editor, document }) => {
  editor.selectAll([0]);await editor.flush();
  session.transformSelection('不变',note=>note);await editor.flush();
  assert.equal(document.describe().dirty,false);assert.equal(document.describe().undo.length,0);
  session.deleteSelection();await editor.flush();assert.equal(document.total,1);
  editor.selectAll([0]);await editor.flush();
  session.travel('undo');await editor.flush();assert.equal(document.total,4);
}));

test('crash recovery includes the last committed edit from an uncheckpointed WAL', () => fixture(async ({ document, root: fixtureRoot }) => {
  const parent = tmpdir(); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'large-wal-recovery-'));
  const service = new LargeChartPreviewService(join(root, 'config.json'));
  const originalExec = document.db.exec.bind(document.db);
  document.db.exec = sql => { if (!sql.includes('wal_checkpoint')) return originalExec(sql); };
  try {
    await document.edit({ revision: document.revision, changes: [{ line: 0, note: createNote(1, 2, 345) }] });
    await service.configure(root);
    const recoveryRoot = join(service.root, randomUUID()); await mkdir(recoveryRoot);
    await writeFile(join(recoveryRoot, '.owner.json'), JSON.stringify({ format: 'rpen-large-preview-v1', pid: 2147483647, editing: true, dirty: true }));
    await copyFile(join(fixtureRoot, 'work', 'notes.sqlite'), join(recoveryRoot, 'notes.sqlite'));
    await copyFile(join(fixtureRoot, 'work', 'notes.sqlite-wal'), join(recoveryRoot, 'notes.sqlite-wal'));
    await service.configure(root); assert.equal(service.recoveries.length, 1);
    const summary = await service.open(join(recoveryRoot, 'notes.sqlite'), { recovery: service.recoveries[0] });
    assert.equal(summary.total, 5); assert.equal(summary.dirty, true);
    const page = await service.command(summary.id, 'page', { lines: [0], start: 2, end: 2 });
    assert.ok(page.notes.some(entry => entry.note.positionX === 345));
  } finally {
    document.db.exec = originalExec; await service.close({ discard: true });
    assert.ok(resolve(root).startsWith(parent + sep)); await rm(root, { recursive: true, force: true });
  }
}));
