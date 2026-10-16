import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent } from '../src/core/chart.ts';
import { beatValue } from '../src/core/beat.ts';
import { easing, bezier } from '../src/core/easing.ts';
import { EditorSession } from '../src/application/session.ts';
import { cutEventParts, cutSelectedEvents, stickSelectedEvents } from '../src/application/event-tools.ts';
import type { EventEditSession } from '../src/application/event-commands.ts';
import type { ChartEvent } from '../src/core/types.ts';
import { migratePreferences } from '../src/core/preferences.ts';
import { normalizeEditorPreferences } from '../src/platform/editor-preferences.ts';

/**
 * `cutEventParts` returns `ChartEvent[] | null`, `null` meaning "this track cannot be cut".
 *
 * Every call in this file is on a cuttable event, so the value never is `null`; this narrows the
 * result in one place and fails loudly if that ever stops being true, instead of asserting it away.
 */
function cutParts(type: string, event: ChartEvent, options?: Parameters<typeof cutEventParts>[2]): ChartEvent[] {
  const parts = cutEventParts(type, event, options);
  assert.ok(parts, `cutEventParts(${type}) 应当可切割`);
  return parts;
}

/**
 * The session as `cutSelectedEvents`/`stickSelectedEvents` see it.
 *
 * Both take the structural `EventEditSession`, which `EditorSession` satisfies member-for-member but
 * cannot be asserted to directly (the interface is an open shape). Bridged through `unknown` here.
 */
function eventEditSession(session: EditorSession): EventEditSession {
  const open: unknown = session;
  return open as EventEditSession;
}

/**
 * The `moveXEvents` track of the session's current line.
 *
 * `EditorSession.line` is optional and each layer track is optional too, so both are read through
 * this helper. It reads off `session` at call time rather than binding once, because a chart edit
 * replaces the document.
 */
function moveX(session: EditorSession): ChartEvent[] {
  return session.line?.eventLayers[0].moveXEvents ?? [];
}

/**
 * The session's current judge line, with the two optional layers the tests below write into.
 *
 * The assertion fails loudly when a chart has no line at `lineIndex`, which is what the writes
 * assume; reading through the session keeps the replaced documents in view.
 */
function currentLine(session: EditorSession): NonNullable<EditorSession['line']> {
  const line = session.line;
  assert.ok(line);
  return line;
}

test('切割从最近横线向两端采样，保留余段、缓动结果和未知字段', () => {
  const source = { ...createEvent(0, 100, 0.1, 1.1), easingType: 5, custom: { value: 7 }, linkgroup: 3, inst: 1 };
  const parts = cutParts('moveXEvents', source, { division: 4, density: 2, beat: 0.6 });
  assert.deepEqual(parts.map(item => beatValue(item.startTime)), [0.1, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]);
  // The cut always produces segments, so the last one is present.
  const last = parts.at(-1);
  assert.ok(last);
  assert.equal(beatValue(last.endTime), 1.1);
  for (const [index, part] of parts.entries()) {
    assert.ok(Math.abs(Number(part.start) - easing((beatValue(part.startTime) - 0.1), 5) * 100) < 1e-8);
    assert.equal(part.easingType, 1); assert.equal(part.inst, 0); assert.equal(part.linkgroup, 0); assert.deepEqual(part.custom, { value: 7 });
    if (index) { assert.deepEqual(parts[index - 1].endTime, part.startTime); assert.equal(parts[index - 1].end, part.start); }
  }
  assert.equal(source.inst, 1);
  const fromStart = cutParts('moveXEvents', source, { division: 4, density: 2, beat: 10 });
  assert.equal(beatValue(fromStart[1].startTime), 0.225);
});

test('切割 Bezier、颜色和透明度，文字/着色器/零长度不切割', () => {
  const source = { ...createEvent(0, 100, 0, 1), bezier: 1, bezierPoints: [0.1, 0.8, 0.7, 0.2] };
  const parts = cutParts('moveYEvents', source, { division: 2, density: 1 });
  assert.ok(Math.abs(Number(parts[0].end) - bezier(0.5, source.bezierPoints) * 100) < 1e-8);
  const colors = cutParts('colorEvents', createEvent([0, 1, 10], [255, 8, 100]), { division: 2, density: 1 });
  assert.deepEqual(colors[0].end, [127, 4, 55]);
  assert.equal(cutParts('alphaEvents', createEvent(0, 255), { division: 2, density: 1 })[0].end, 127);
  assert.equal(cutEventParts('textEvents', createEvent('a', 'b')), null);
  assert.equal(cutEventParts('paintEvents', createEvent()), null);
  assert.equal(cutEventParts('moveXEvents', createEvent(0, 1, 1, 1)), null);
  assert.throws(() => cutEventParts('speedEvents', createEvent(0, 1, 0, 10000), { density: 128 }), /过多/);
});

test('批量切割一次撤销，选择新段并保留跳过事件，其他层不变', () => {
  const session = new EditorSession();
  const line = currentLine(session);
  line.eventLayers[0].moveXEvents = [createEvent(0, 10, 1, 2), createEvent(5, 6, 0, 0.5)];
  line.extended.textEvents = [createEvent('a', 'b')];
  session.eventSelection = new Set(['moveXEvents:0', 'textEvents:0']);
  const original = session.chart;
  assert.deepEqual(cutSelectedEvents(eventEditSession(session), { division: 2, density: 2 }), { changed: 1, generated: 4, skipped: 1 });
  assert.equal(session.history.undoStack.length, 1);
  assert.deepEqual([...session.eventSelection], ['moveXEvents:1', 'moveXEvents:2', 'moveXEvents:3', 'moveXEvents:4', 'textEvents:0']);
  session.travel('undo'); assert.equal(session.chart, original);
});

test('粘合按时间找前一同类事件，跨间隙且钩定同步传递，保留曲线', () => {
  const session = new EditorSession();
  const line = currentLine(session);
  line.eventLayers[0].moveXEvents = [
    { ...createEvent(80, 90, 5, 6), easingType: 6 },
    createEvent(0, 10, 0, 1), { ...createEvent(50, 50, 3, 4), inst: 1 },
  ];
  session.eventSelection = new Set(['moveXEvents:0', 'moveXEvents:1', 'moveXEvents:2']);
  assert.deepEqual(stickSelectedEvents(eventEditSession(session)), { changed: 2, skipped: 1 });
  // Re-read the track at assertion time: `stickSelectedEvents` replaces the document, so a binding
  // captured before the call would report the pre-stick values.
  assert.deepEqual(moveX(session).map(item => [item.start, item.end]), [[10, 90], [0, 10], [10, 10]]);
  assert.equal(moveX(session)[0].easingType, 6);
  assert.equal(session.history.undoStack.length, 1);
  session.travel('undo'); assert.equal(moveX(session)[0].start, 80);
});

test('迁移并保存原版 CutRho 设置', () => {
  const result = migratePreferences('{"CutRho":8}');
  assert.equal(result.settings.cutDensity, 8); assert.ok(result.report.appliedSettings.includes('CutRho'));
  assert.equal(normalizeEditorPreferences({ cutDensity: 8 }).cutDensity, 8);
});
