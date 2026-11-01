import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiLineStateStore } from '../src/platform/multi-line-state.mjs';
import { createChart, createLine } from '../src/core/chart.mjs';
import { EditorSession } from '../src/application/session.mjs';

const session = (count = 5) => { const chart = createChart(); chart.judgeLineList = Array.from({ length: count }, () => createLine()); return new EditorSession(chart); };
const storage = () => { const values = new Map(); const writes = []; return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); writes.push([key, value]); }, values, writes }; };

test('线号列表、模式、合并与关闭状态按谱面独立保存，不需要保存谱面且重启后恢复', () => {
  const disk = storage(), store = new MultiLineStateStore(disk), first = session(), second = session();
  store.attach(first, 'A'); first.setMultiLineEnabled(true, 'events'); first.multiLineIndices = [0, 2, 4]; first.setMultiLineMerge(false);
  first.setMultiLineEnabled(false); assert.equal(first.history.dirty, false);
  store.attach(second, 'B'); second.setMultiLineEnabled(true); second.multiLineIndices = [1, 3]; second.notify();
  store.detach(); const reopened = session(); new MultiLineStateStore(disk).attach(reopened, 'A');
  assert.deepEqual(reopened.multiLineIndices, [0, 2, 4]); assert.equal(reopened.multiLineEnabled, false); assert.equal(reopened.multiLineMode, 'events'); assert.equal(reopened.multiLineMerge, false);
  const other = session(); new MultiLineStateStore(disk).attach(other, 'B'); assert.deepEqual(other.multiLineIndices, [1, 3]);
});

test('首次保存切换到项目 ID 后保留列表，项目副本使用独立 ID；本地状态优先于旧快照', () => {
  const disk = storage(), store = new MultiLineStateStore(disk), current = session();
  store.attach(current, 'new-session'); current.setMultiLineEnabled(true); current.multiLineIndices = [2, 4]; current.notify(); store.rekey('project'); store.detach();
  const reopened = session(); store.attach(reopened, 'project', { enabled: true, indices: [1] }); assert.deepEqual(reopened.multiLineIndices, [2, 4]);
  const copy = session(); store.attach(copy, 'copy', { enabled: true, indices: [0, 3] }); assert.deepEqual(copy.multiLineIndices, [0, 3]);
});

test('动态表达式保留，播放时变更解析结果不重复写盘；无效线号、损坏记录可恢复', () => {
  const disk = storage(), store = new MultiLineStateStore(disk), current = session();
  store.attach(current, 'A', { enabled: true, mode: 'events', indices: [1], expression: '@notes' });
  const writes = disk.writes.length; current.multiLineIndices = [2]; current.notify(); assert.equal(disk.writes.length, writes);
  current.multiLineIndices = []; current.notify(); assert.equal(disk.writes.length, writes);
  store.detach(); const reopened = session(3); store.attach(reopened, 'A'); assert.equal(reopened.multiLineExpression, '@notes');
  disk.values.set('rpe-next-project-multi-line-v1:bad', '{broken');
  store.attach(session(2), 'bad', { enabled: true, indices: [1, 2, 99], expression: 'gone-group' });
  assert.deepEqual(store.session.multiLineIndices, [1]); assert.equal(store.session.multiLineExpression, '');
});

test('普通选择变化不重复写盘；写入失败报告后保留当前列表和编辑能力', () => {
  const disk = storage(), store = new MultiLineStateStore(disk), current = session(); store.attach(current, 'A');
  const writes = disk.writes.length; current.notify(); current.notify(); assert.equal(disk.writes.length, writes);
  const failures = [], failed = new MultiLineStateStore({ getItem: () => null, setItem() { throw Error('quota'); } }, error => failures.push(error.message));
  failed.attach(current, 'B'); current.setMultiLineEnabled(true); current.addMultiLine(3);
  assert.deepEqual(current.multiLineIndices, [0, 3]); assert.ok(failures.includes('quota')); assert.equal(current.history.dirty, false);
});
