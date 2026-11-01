import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorSession } from '../src/application/session.mjs';
import { selectionCounts } from '../src/application/selection-count.mjs';
import { NoiseAreaEditor } from '../src/ui/noise-area.mjs';
import { t } from '../src/i18n.mjs';

test('普通选择与多线选择分别计数，当前线副本不重复，当前线以外的选择不漏算', () => {
  const session = new EditorSession(); session.selection = new Set([0, 1]); session.eventSelection = new Set(['moveXEvents:0']);
  session.multiLineSelection = new Map([[1, new Set([0, 1, 2])], [2, new Set([0, 1])]]);
  session.multiEventSelection = new Map([[1, new Set(['moveXEvents:0'])], [2, new Set(['moveXEvents:0', 'moveXEvents:1'])]]);
  assert.deepEqual(selectionCounts(session), { notes: 2, events: 1 });
  session.multiLineIndices = [1, 2]; session.multiLineEnabled = true;
  assert.deepEqual(selectionCounts(session), { notes: 5, events: 1 });
  session.selection = new Set(); assert.equal(selectionCounts(session).notes, 5);
  session.multiLineMode = 'events'; session.eventSelection.clear(); assert.equal(selectionCounts(session).events, 3);
  session.eventSelection = new Set(session.multiEventSelection.get(2)); assert.equal(selectionCounts(session).events, 3);
});

test('完整磁盘选择优先于渲染页，零选择不回退到旧页面；清空及关闭多线模式即时返回当前状态', () => {
  const session = new EditorSession(); session.selection = new Set([0]);
  session.largeDocument = { selectedCount: 10000000 }; assert.equal(selectionCounts(session).notes, 10000000);
  session.largeDocument.selectedCount = 0; assert.equal(selectionCounts(session).notes, 0);
  session.largeDocument = null; session.multiLineIndices = [0]; session.setMultiLineEnabled(true);
  session.multiLineSelection = new Map([[0, new Set([0, 1])]]); assert.equal(selectionCounts(session).notes, 2);
  session.multiLineSelection.clear(); session.selection.clear(); assert.equal(selectionCounts(session).notes, 0);
  session.setMultiLineEnabled(false); assert.deepEqual(selectionCounts(session), { notes: 0, events: 0 });
});

test('未启用的噪域编辑器刷新界面不覆盖完整多线计数，进入噪域时仍显示噪域选择', () => {
  const previousDocument = globalThis.document, controls = new Map();
  globalThis.document = { querySelector: selector => { if (!controls.has(selector)) controls.set(selector, { classList: { toggle() {} } }); return controls.get(selector); } };
  try {
    const session = new EditorSession(); session.multiLineEnabled = true; session.multiLineIndices = [0];
    session.multiLineSelection = new Map([[1, new Set([0, 1])], [2, new Set([0, 1, 2])]]);
    session.multiEventSelection = new Map([[1, new Set(['moveXEvents:0'])], [2, new Set(['moveXEvents:0', 'moveXEvents:1'])]]);
    const editor = Object.create(NoiseAreaEditor.prototype);
    Object.assign(editor, { active: false, drawingContext: { session, realtimePreview: { visible: false }, previewVisible: false },
      modeHeader: {}, modeCount: {}, modeOwner: {}, canvas: { hidden: true }, overlay: {}, sampleBar: {}, selection: new Set(['area:0', 'area:1']), areas: () => [], area: () => null });
    editor.syncChrome(); assert.equal(controls.get('#selection-info').textContent, t('noise-area.s94b23eb', { p0: 5 }));
    session.focus = session.multiLineMode = 'events'; editor.syncChrome();
    assert.equal(controls.get('#selection-info').textContent, t('noise-area.sdd39156', { p0: 3 }));
    assert.equal(session.history.undoStack.length, 0);
    editor.active = true; editor.canvas.hidden = true; editor.syncChrome();
    assert.equal(controls.get('#selection-info').textContent, t('noise-area.s9b7b953', { p0: 2, p1: '' }));
  } finally { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }
});
