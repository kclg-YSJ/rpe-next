import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createNote, createLine } from '../src/core/chart.ts';
import { identifyChart, chartChanges, applyChanges, inverseChanges, changeResources, COLLAB_ID, parseInvitation, validateNewEventOverlaps, validateIdentities } from '../src/core/collaboration.ts';
import { EditorSession } from '../src/application/session.ts';
import { CollaborationClient } from '../src/application/collaboration-client.ts';
import type { CollaborationClientTransport } from '../src/application/collaboration-client.ts';
import { CollaborationTransport } from '../src/platform/collaboration-transport.ts';
import { remapSelection, selectionState } from '../src/application/selection-history.ts';
import type { Trajectory } from '../src/core/types.ts';

/**
 * `Trajectory` declares `version`/`options`/`segments`/`split`; the test only stages the curve
 * expression a document may carry, so the partial is bridged through `unknown` here.
 */
function trajectoryDouble(fields: unknown): Trajectory {
  const bridged: Trajectory = fields as Trajectory;
  return bridged;
}

/**
 * The event objects the stub socket's handlers are invoked with.
 *
 * `WebSocket.onopen`/`onmessage`/`onclose` declare real `Event`/`MessageEvent`/`CloseEvent`
 * instances, while the test drives the stale handlers with the plain field bags it used before, so
 * each is bridged through `unknown` here.
 */
function socketEvent<T extends Event>(fields: unknown): T {
  const bridged: T = fields as T;
  return bridged;
}

/**
 * `CollaborationClientTransport` declares `connect`, which this test never calls — the client is
 * driven through `message()` directly — so the partial double is bridged through `unknown` here.
 */
function clientTransport(double: unknown): CollaborationClientTransport {
  const bridged: CollaborationClientTransport = double as CollaborationClientTransport;
  return bridged;
}

const sample = () => { const chart = createChart(); chart.judgeLineList[0].notes = [createNote(1, 1, 0), createNote(4, 2, 100)]; return identifyChart(chart); };

test('远端修改保留未改变对象引用，复制物件仍有独立标识', () => {
  const base = sample();
  base.judgeLineList[0].eventLayers[0].moveXEvents![0].trajectory = trajectoryDouble({ expression: 'cos(t)', parameters: { radius: 100 } });
  const next = structuredClone(base);
  next.judgeLineList[0].notes[0].positionX = 20;
  const merged = applyChanges(base, chartChanges(base, next));
  assert.equal(merged.BPMList, base.BPMList);
  assert.equal(merged.judgeLineList[0].eventLayers, base.judgeLineList[0].eventLayers);
  assert.equal(merged.judgeLineList[0].notes[1], base.judgeLineList[0].notes[1]);
  assert.notEqual(merged.judgeLineList[0].notes[0], base.judgeLineList[0].notes[0]);
  assert.equal(identifyChart(merged), merged);
  const copy = structuredClone(merged);
  copy.judgeLineList[0].notes.push(structuredClone(copy.judgeLineList[0].notes[0]));
  const identified = identifyChart(copy);
  assert.notEqual(identified.judgeLineList[0].notes[0][COLLAB_ID], identified.judgeLineList[0].notes[2][COLLAB_ID]);
  assert.doesNotThrow(() => validateIdentities(identified));
});

test('远端重排判定线后多线视野和选择跟随稳定标识', () => {
  const chart = sample(); chart.judgeLineList.push(createLine());
  const source = identifyChart(chart); const session = new EditorSession(source);
  session.multiLineEnabled = true; session.multiLineIndices = [0]; session.multiLineSelection.set(0, new Set([1]));
  const target = { ...source, judgeLineList: [...source.judgeLineList].reverse() };
  const mapped = remapSelection(source, target, selectionState(session));
  assert.equal(mapped.lineIndex, 1);
  assert.deepEqual(mapped.multiLineIndices, [1]);
  assert.deepEqual(mapped.multiLineSelection, [[1, [1]]]);
});

test('快速离开并重连时旧连接回调不能覆盖新连接状态', context => {
  class Socket {
    static OPEN = 1; readyState = 1; bufferedAmount = 0;
    send() {}
    close() {}
  }
  context.mock.method(globalThis, 'WebSocket', function () { return new Socket(); });
  const transport = new CollaborationTransport(); const messages: unknown[] = [];
  transport.addEventListener('message', event => messages.push((event as CustomEvent<unknown>).detail));
  transport.connect('ws://localhost', { type: 'create' }); const previous = transport.socket!;
  transport.close(); transport.connect('ws://localhost', { type: 'create' }); transport.socket!.onopen!(socketEvent<Event>({}));
  previous.onclose!(socketEvent<CloseEvent>({ code: 1000 })); previous.onmessage!(socketEvent<MessageEvent>({ data: '{"type":"error"}' })); previous.onopen!(socketEvent<Event>({}));
  assert.equal(transport.connected, true); assert.deepEqual(messages, []);
  transport.close();
});

test('联机按稳定物件 ID 合并同线独立修改，增删后不串物件', () => {
  const base = sample(); const first = structuredClone(base); const second = structuredClone(base);
  first.judgeLineList[0].notes[0].positionX = 200; second.judgeLineList[0].notes[1].positionX = -200;
  const merged = applyChanges(applyChanges(base, chartChanges(base, first)), chartChanges(base, second));
  assert.deepEqual(merged.judgeLineList[0].notes.map(note => note.positionX), [200, -200]);
  const deletion = structuredClone(base); deletion.judgeLineList[0].notes.shift();
  const deleted = applyChanges(applyChanges(base, chartChanges(base, deletion)), chartChanges(base, second));
  assert.equal(deleted.judgeLineList[0].notes.length, 1); assert.equal(deleted.judgeLineList[0].notes[0].positionX, -200);
});

test('不同事件可并行编辑，同一物件冲突原子拒绝，个人撤销保留别人修改', () => {
  const base = sample(); const first = structuredClone(base); const second = structuredClone(base);
  first.judgeLineList[0].eventLayers[0].moveXEvents![0].start = 20;
  second.judgeLineList[0].eventLayers[0].moveYEvents![0].start = 50;
  const changes = chartChanges(base, first); const merged = applyChanges(applyChanges(base, changes), chartChanges(base, second));
  assert.equal(merged.judgeLineList[0].eventLayers[0].moveXEvents![0].start, 20);
  assert.equal(applyChanges(merged, inverseChanges(changes)).judgeLineList[0].eventLayers[0].moveYEvents![0].start, 50);
  const stale = structuredClone(base); stale.judgeLineList[0].eventLayers[0].moveXEvents![0].start = 70;
  assert.throws(() => applyChanges(merged, chartChanges(base, stale)), /已被修改/);
  assert.ok(changeResources(changes[0]).includes(first.judgeLineList[0].eventLayers[0].moveXEvents![0][COLLAB_ID]));
});

test('批量新增、复制与移线分配唯一 ID，非法路径及原型污染被拒绝', () => {
  const base = sample(); base.judgeLineList.push(createLine()); const copy = structuredClone(base.judgeLineList[0].notes[0]); base.judgeLineList[0].notes.push(copy);
  const chart = identifyChart(base); assert.notEqual(chart.judgeLineList[0].notes[0][COLLAB_ID], chart.judgeLineList[0].notes[2][COLLAB_ID]);
  for (const path of [['__proto__', 'polluted'], ['constructor', 'prototype', 'polluted']]) assert.throws(() => applyChanges(chart, [{ path, after: true }]));
  assert.throws(() => applyChanges(chart, JSON.parse('[{"path":["META"],"after":{"__proto__":{"polluted":true}}}]')));
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.throws(() => parseInvitation('rpenext:' + encodeURIComponent(JSON.stringify({ server: 'file:///private', room: 'a'.repeat(24), token: 'b'.repeat(32) }))));
});

test('客户端仅撤销自己的提交，远端操作不移动本机时间或当前线', () => {
  class Transport extends EventTarget { connected = true; messages: Record<string, unknown>[] = []; send(message: Record<string, unknown>) { this.messages.push(message); } close() {} }
  const transport = new Transport(); const session = new EditorSession(sample()); session.editSeconds = 42;
  const client = new CollaborationClient(clientTransport(transport), { session: () => session, receiveChart: () => {}, notify: () => {} });
  client.active = true;
  client.message({ type: 'welcome', id: 'me', host: 'me', chart: session.chart, revision: 0, room: 'r', invite: 't', members: [{ id: 'me', online: true }], locks: [], chat: [] });
  const remoteBase = structuredClone(session.chart); session.transformSelection('未选择', note => note!);
  session.selection.add(0); session.transformSelection('本地移动', note => ({ ...note!, positionX: 10 }));
  const operation = transport.messages.find(message => message.type === 'edit')!;
  client.message({ ...operation, type: 'edit', id: 'me', revision: 1, stats: {} });
  const remote = structuredClone(remoteBase); remote.judgeLineList[0].notes[1].positionX = 555;
  client.message({ type: 'edit', id: 'other', operation: 'remote', changes: chartChanges(remoteBase, remote), revision: 2 });
  assert.equal(session.editSeconds, 42); assert.equal(session.lineIndex, 0);
  assert.equal(session.history.undoStack.length, 1);
  session.travel('undo');
  assert.equal(session.chart.judgeLineList[0].notes[0].positionX, 0);
  assert.equal(session.chart.judgeLineList[0].notes[1].positionX, 555);
});

test('并发放置不能引入新事件重叠，已有重叠可载入且其他属性仍可修改', () => {
  const base = sample(); const next = structuredClone(base); const track = next.judgeLineList[0].eventLayers[0].moveXEvents!;
  track.push({ ...track[0], [COLLAB_ID]: crypto.randomUUID(), startTime: [0, 1, 2], endTime: [2, 0, 1] });
  assert.throws(() => validateNewEventOverlaps(base, next), /重叠/);
  assert.doesNotThrow(() => validateNewEventOverlaps(next, next));
  track[1].startTime = [1, 0, 1]; assert.doesNotThrow(() => validateNewEventOverlaps(base, next));
  const forged = structuredClone(base); forged.judgeLineList[0].notes[1][COLLAB_ID] = forged.judgeLineList[0].notes[0][COLLAB_ID];
  assert.throws(() => validateIdentities(forged), /重复/);
});
