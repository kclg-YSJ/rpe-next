import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobalEventRegistry, registerPlaceholderGlobalEvent, globalEventDensity, placedGlobalEvent } from '../src/core/global-events.ts';
import { GlobalEventDocument } from '../src/application/global-events.ts';
import { EditorSession } from '../src/application/session.ts';
import { createEvent, serializeChart, parseChart } from '../src/core/chart.ts';
import { transformEvents, eventKey, deleteEvents } from '../src/application/event-commands.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { createChartExport } from '../src/platform/files.ts';
import { CollaborationClient } from '../src/application/collaboration-client.ts';
import { identifyChart, chartChanges } from '../src/core/collaboration.ts';
import type { CollaborationClientTransport } from '../src/application/collaboration-client.ts';
import type { ChartExportOptions } from '../src/platform/files.ts';
import type { AnyEventType, ChartEvent } from '../src/core/types.ts';
import type { EventEditSession } from '../src/application/event-commands.ts';

interface GlobalEventOwner { kind: string; id: string; name: string; author: string; version: string }
interface GlobalEventColumnInfo { id: string; name: string; valueType?: string; defaultValue?: unknown; overlap?: boolean }
interface GlobalEventType { id: string; name: string; columns: GlobalEventColumnInfo[]; readonly: boolean; persistent: boolean; source: GlobalEventOwner }
interface GlobalEventColumn { type: GlobalEventType; column: GlobalEventColumnInfo; key: string; events: ChartEvent[] }
interface GlobalEventDocumentHost {
  editor: EventEditSession;
  types: GlobalEventType[];
  columns: GlobalEventColumn[];
  apply(changes: unknown, label?: string): boolean;
  read(type: string, column: string): ChartEvent[];
}

const owner: GlobalEventOwner = { kind: 'mod', id: 'weather', name: 'Weather', author: 'Writer', version: '1.0.0' };
const definition = (): { id: string; name: string; columns: { id: string; name: string }[] } => ({ id: 'wind', name: 'Weather · Writer', columns: [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }] });
function fixture(): { registry: GlobalEventRegistry; session: EditorSession; document: GlobalEventDocumentHost } { const registry = new GlobalEventRegistry(); registerPlaceholderGlobalEvent(registry); const session = new EditorSession(); const document = new GlobalEventDocument(registry, () => session) as unknown as GlobalEventDocumentHost; return { registry, session, document }; }
const placeGlobalEvent = placedGlobalEvent as unknown as (type: GlobalEventType, column: GlobalEventColumnInfo, events: ChartEvent[], first: number, second: number, easingType?: number, inst?: boolean, preview?: boolean) => ChartEvent;

test('占位全局事件仅留在会话，撤销重做与谱面历史顺序一致，保存和新会话不包含占位', () => {
  const { registry, session, document } = fixture(), original = session.chart;
  document.apply([{ type: 'rpen/placeholder', column: 'value', events: [createEvent(2, 3, 1, 2)] }], '占位测试');
  assert.equal(session.chart, original); assert.equal(session.history.dirty, false); assert.equal(session.history.undoStack.at(-1)!.label, '占位测试');
  assert.equal(document.read('rpen/placeholder', 'value').length, 1); assert.equal(serializeChart(session.chart).includes('globalEvents'), false);
  session.travel('undo'); assert.equal(document.read('rpen/placeholder', 'value').length, 0);
  session.travel('redo'); assert.equal(document.read('rpen/placeholder', 'value').length, 1);
  const next = new GlobalEventDocument(registry, () => new EditorSession(parseChart(serializeChart(session.chart)))); assert.equal(next.read('rpen/placeholder', 'value').length, 0);
});

test('模组多列事件自动标识来源，普通事件操作经投影写回；停用后保留只读数据', () => {
  const { registry, session, document } = fixture(); const stop = registry.register(definition(), owner);
  document.apply([{ type: 'weather/wind', column: 'x', events: [createEvent(1, 2, 2, 4)] }, { type: 'weather/wind', column: 'y', events: [createEvent(3, 5, 2, 4)] }]);
  assert.deepEqual(session.chart.globalEvents!.types['weather/wind'].source, owner); assert.equal(session.chart.META.RPEVersion, 240);
  const entry = document.columns.find((entry: GlobalEventColumn) => entry.type.id === 'weather/wind' && entry.column.id === 'x')!; document.editor.eventSelection = new Set([eventKey(entry.key as AnyEventType, 0)]);
  transformEvents(document.editor, '修改全局值', event => ({ ...event, end: 7 })); assert.equal(document.read('weather/wind', 'x')[0].end, 7);
  session.travel('undo'); assert.equal(document.read('weather/wind', 'x')[0].end, 2); session.travel('redo'); assert.equal(document.read('weather/wind', 'x')[0].end, 7);
  stop(); assert.equal(document.types.find((type: GlobalEventType) => type.id === 'weather/wind')!.readonly, true);
  const saved = serializeChart(session.chart), restored = parseChart(saved); assert.deepEqual(restored.globalEvents, session.chart.globalEvents);
  assert.throws(() => document.apply([{ type: 'weather/wind', column: 'x', events: [] }]), /尚未加载/);
  registry.register(definition(), owner); assert.equal(document.read('weather/wind', 'x')[0].end, 7);
});

test('占位与持久化事件可一次删除并一次撤销，互不污染彼此或音符', () => {
  const { registry, session, document } = fixture(); registry.register(definition(), owner);
  document.apply([{ type: 'rpen/placeholder', column: 'value', events: [createEvent()] }, { type: 'weather/wind', column: 'x', events: [createEvent()] }]);
  document.editor.eventSelection = new Set(document.columns.flatMap((entry: GlobalEventColumn) => entry.events.map((event: ChartEvent, index: number) => eventKey(entry.key as AnyEventType, index))));
  deleteEvents(document.editor); assert.equal(document.read('weather/wind', 'x').length, 0); assert.equal(document.read('rpen/placeholder', 'value').length, 0);
  session.travel('undo'); assert.equal(document.read('weather/wind', 'x').length, 1); assert.equal(document.read('rpen/placeholder', 'value').length, 1);
  assert.equal(session.chart.judgeLineList[0].notes.length, 0);
});

test('全局事件创建支持继承、自定义数据、重叠策略，拒绝坏数据和伪造来源', () => {
  const { registry, session, document } = fixture(); registry.register(definition(), owner); const type = document.types.find((type: GlobalEventType) => type.id === 'weather/wind')!, column = type.columns[0];
  const events = [createEvent(2, 8, 0, 1)]; assert.equal(placeGlobalEvent(type, column, events, 1, 2).start, 8); assert.throws(() => placeGlobalEvent(type, column, events, 0.5, 1.5), /重叠/);
  assert.throws(() => document.apply([{ type: type.id, column: 'x', events: [{ ...createEvent(), start: NaN }] }]), /非有限/);
  const cycle = createEvent(); cycle.extra = cycle; assert.throws(() => document.apply([{ type: type.id, column: 'x', events: [cycle] }]), /循环/);
  document.apply([{ type: type.id, column: 'x', events: [{ ...createEvent(), custom: { kind: 'wind' } }] }]);
  const bad = structuredClone(session.chart); bad.globalEvents!.types[type.id].source.id = 'other'; assert.throws(() => parseChart(JSON.stringify(bad)), /命名空间/);
});

test('全局分布条计算覆盖区间，Next 导出排序并保留扩展，RPE 导出需要明确移除', async () => {
  const { registry, session, document } = fixture(); registry.register(definition(), owner);
  document.apply([{ type: 'weather/wind', column: 'x', events: [{ ...createEvent(0, 1, 4, 6), extra: 7 }, createEvent(0, 1, 0, 2)] }]);
  const tempo = new TempoMap(session.chart.BPMList), bins = globalEventDensity(document.read('weather/wind', 'x'), tempo, 4, 8);
  assert.deepEqual([...bins], [1, 1, 0, 0, 1, 1, 0, 0]);
  const result = createChartExport(session.chart, new Map(), 'test.json', { compatibility: 'next', format: 'json' }); const saved = JSON.parse(await result.blob.text());
  assert.deepEqual(saved.globalEvents.types['weather/wind'].columns.x.events[0].startTime, [0, 0, 1]); assert.equal(saved.globalEvents.types['weather/wind'].columns.x.events[1].extra, 7);
  assert.throws(() => createChartExport(session.chart, new Map(), 'test.json', { compatibility: 'rpe', format: 'json' }), /不支持全局/);
  const legacy = createChartExport(session.chart, new Map(), 'test.json', { compatibility: 'rpe', format: 'json', removeGlobalEvents: true } as unknown as Partial<ChartExportOptions> & { removeGlobalEvents: boolean }); assert.equal(JSON.parse(await legacy.blob.text()).globalEvents, undefined); assert.ok(session.chart.globalEvents);
});

test('联机中的本地占位撤销不回滚远端谱面，混合提交可撤销持久化和临时事件', () => {
  class Transport extends EventTarget { connected = true; messages: Record<string, unknown>[] = []; send(message: Record<string, unknown>): void { this.messages.push(message); } close(): void {} }
  const transport = new Transport(), session = new EditorSession(identifyChart(new EditorSession().chart)), registry = new GlobalEventRegistry();
  registerPlaceholderGlobalEvent(registry); registry.register(definition(), owner);
  const document = new GlobalEventDocument(registry, () => session) as unknown as GlobalEventDocumentHost, client = new CollaborationClient(transport as unknown as CollaborationClientTransport, { session: () => session, receiveChart() {}, notify(message: string, level?: string): void { if (level === 'error') throw Error(message); } });
  client.active = true; client.message({ type: 'welcome', id: 'me', host: 'me', chart: session.chart, revision: 0, room: 'r', invite: 't', members: [{ id: 'me', online: true }], locks: [], chat: [] });
  document.apply([{ type: 'rpen/placeholder', column: 'value', events: [createEvent()] }]); assert.equal(transport.messages.some(item => item.type === 'edit'), false);
  const previous = session.chart, remote = { ...previous, META: { ...previous.META, name: 'Remote' } };
  client.message({ type: 'edit', id: 'other', operation: 'remote', changes: chartChanges(previous, remote), revision: 1 });
  session.travel('undo'); assert.equal(session.chart.META.name, 'Remote'); assert.equal(document.read('rpen/placeholder', 'value').length, 0);
  document.apply([{ type: 'weather/wind', column: 'x', events: [createEvent()] }, { type: 'rpen/placeholder', column: 'value', events: [createEvent()] }]);
  const acknowledge = (revision: number): void => { const operation = client.queue[0]; assert.ok(operation); client.message({ ...operation, type: 'edit', id: 'me', revision, stats: {} }); };
  acknowledge(2); assert.equal(document.read('weather/wind', 'x').length, 1); assert.equal(document.read('rpen/placeholder', 'value').length, 1);
  session.travel('undo'); acknowledge(3); assert.equal(document.read('weather/wind', 'x').length, 0); assert.equal(document.read('rpen/placeholder', 'value').length, 0);
  session.travel('redo'); acknowledge(4); assert.equal(document.read('weather/wind', 'x').length, 1); assert.equal(document.read('rpen/placeholder', 'value').length, 1);
});
