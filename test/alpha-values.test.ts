import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createEvent, createLine, createNote, parseChart, serializeChart } from '../src/core/chart.ts';
import { integerChartAlpha } from '../src/core/alpha-values.ts';
import { EditorSession } from '../src/application/session.ts';
import { insertEventAt, transformEvents } from '../src/application/event-commands.ts';
import { captureSelection, commitSelectionEdit } from '../src/application/batch-edit.ts';
import { previewMultiEdit, previewEventClones } from '../src/application/multi-edit.ts';
import type { EventLayer } from '../src/core/types.ts';

/**
 * `ChartEvent.start`/`end` are declared `EventValue`, but the 透明度 tracks under test only ever
 * carry numbers, so this reads one back as the number the assertions compare.
 */
function numericValue(value: unknown): number {
  const bridged: number = value as number;
  return bridged;
}

/**
 * `JudgeLine.eventLayers` is declared non-nullable, but the RPE documents this test feeds to
 * `parseChart` carry a `null` layer and the parser is expected to tolerate it.
 */
function nullLayer(): EventLayer {
  const bridged: EventLayer = null as unknown as EventLayer;
  return bridged;
}

/**
 * `CloneOptions.targets` is declared `string[]`, while the clone panel supplies the raw 目标线号序列
 * text and `previewEventClones` parses it with `sequence`. The single-string form is the case under
 * test, so it is bridged to the declared type here.
 */
function targetText(value: string): string[] {
  const bridged: string[] = value as unknown as string[];
  return bridged;
}

test('载入和保存统一向零取整透明度，保留其他小数与原对象', () => {
  const chart = createChart();
  const line = chart.judgeLineList[0]!;
  line.notes = [{ ...createNote(1, 0, 2.75), alpha: 127.9, speed: 1.25 }];
  line.alphaControl = [{ x: 0, alpha: 0.625 }];
  line.eventLayers.push(nullLayer(), { alphaEvents: [createEvent(-1.9, 128.9)] });
  line.eventLayers[0]!.moveXEvents![0]!.start = 1.75;
  const before = structuredClone(chart);
  const parsed = parseChart(JSON.stringify(chart));
  assert.equal(parsed.judgeLineList[0]!.notes[0]!.alpha, 127);
  assert.deepEqual(parsed.judgeLineList[0]!.eventLayers[2]!.alphaEvents!.map(event => [event.start, event.end]), [[-1, 128]]);
  assert.equal(parsed.judgeLineList[0]!.notes[0]!.positionX, 2.75);
  assert.equal(parsed.judgeLineList[0]!.notes[0]!.speed, 1.25);
  assert.equal(parsed.judgeLineList[0]!.alphaControl![0]!.alpha, 0.625);
  assert.equal(parsed.judgeLineList[0]!.eventLayers[0]!.moveXEvents![0]!.start, 1.75);
  assert.deepEqual(JSON.parse(serializeChart(chart)), parsed);
  assert.deepEqual(chart, before);
  assert.equal(integerChartAlpha(parsed), parsed);
});

test('单项编辑及跨线插入使用整数端点，撤销重做不改旧快照和选择索引', () => {
  const chart = createChart(); chart.judgeLineList.push(createLine());
  const session = new EditorSession(chart);
  session.eventSelection = new Set(['alphaEvents:0']); session.focus = 'events';
  const original = session.chart;
  transformEvents(session, '透明度', event => ({ ...event, start: 127.5, end: -2.9 }));
  const changed = session.chart;
  assert.deepEqual([changed.judgeLineList[0]!.eventLayers[0]!.alphaEvents![0]!.start, changed.judgeLineList[0]!.eventLayers[0]!.alphaEvents![0]!.end], [127, -2]);
  assert.equal(changed.judgeLineList[1], original.judgeLineList[1]);
  assert.equal(original.judgeLineList[0]!.eventLayers[0]!.alphaEvents![0]!.start, 255);
  session.travel('undo'); assert.equal(session.chart, original);
  session.travel('redo'); assert.equal(session.chart, changed); assert.deepEqual([...session.eventSelection!], ['alphaEvents:0']);
  insertEventAt(session, 1, 'alphaEvents', createEvent(10.8, 20.9, 4, 5));
  assert.equal(session.chart.judgeLineList[1]!.eventLayers[0]!.alphaEvents![1]!.end, 20);
});

test('批量运算、脚本及克隆的虚影与实际透明度均取整', () => {
  const session = new EditorSession(); session.eventSelection = new Set(['alphaEvents:0']); session.focus = 'events';
  const snapshot = captureSelection(session);
  const cases = [
    previewMultiEdit(snapshot, 'events', { field: 'both', operation: 'Times', lower: 0.5, upper: 0.5 }),
    previewMultiEdit(snapshot, 'events', { mode: 'script', script: 'start = 127.9; end = -2.9;' }),
    previewEventClones(snapshot, { targets: targetText('0'), channels: { alphaEvents: { lower: -127.5, upper: -127.5 } } }),
  ];
  for (const result of cases) {
    assert.equal(result.changes[0]!.after.start, 127);
    assert.ok(Number.isInteger(numericValue(result.changes[0]!.after.end)));
    commitSelectionEdit(session, result, '透明度批量编辑');
    for (const event of session.chart.judgeLineList[0]!.eventLayers[0]!.alphaEvents!) assert.ok(Number.isInteger(event.start) && Number.isInteger(event.end));
    session.travel('undo');
  }
  const chart = createChart(); chart.judgeLineList[0]!.notes = [createNote(1, 0, 0)];
  const notes = new EditorSession(chart); notes.selection = new Set([0]);
  const result = previewMultiEdit(captureSelection(notes), 'notes', { field: 'alpha', operation: 'Times', lower: 0.5, upper: 0.5 });
  assert.equal(result.changes[0]!.after.alpha, 127);
  assert.equal(result.chart.judgeLineList[0]!.notes[0]!.alpha, 127);
});

test('会话提交兜底规范化，未修改的行及事件保持引用', () => {
  const session = new EditorSession(); const old = session.chart; const line = old.judgeLineList[0]!;
  session.commit('脚本结果', { ...old, judgeLineList: [{ ...line, eventLayers: [{ ...line.eventLayers[0], alphaEvents: [createEvent(-0.9, 256.9)] }] }] });
  const result = session.chart.judgeLineList[0]!;
  assert.equal(Math.abs(numericValue(result.eventLayers[0]!.alphaEvents![0]!.start)), 0);
  assert.equal(result.eventLayers[0]!.alphaEvents![0]!.end, 256);
  assert.equal(result.eventLayers[0]!.moveXEvents, line.eventLayers[0]!.moveXEvents);
});
