import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, createNote, parseChart, serializeChart } from '../src/core/chart.mjs';
import { fromNumber, beatValue } from '../src/core/beat.mjs';
import { assertGuideLine, assertGuideLines, guidePosition, guideLinesInRange, snapGuidePosition, guidePlacementRange, nudgeGuidePosition, changeGuideLine, followGuideNote, projectGuideLine } from '../src/core/guide-lines.mjs';
import { withCustomEasing } from '../src/core/event-easing.mjs';
import { captureGuideFollowers, previewGuideFollowers, commitGuideLine } from '../src/application/guide-line-commands.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { nudgeSelection, captureSelection, controlSelection, applyBatchAction } from '../src/application/batch-edit.mjs';
import { Timeline } from '../src/ui/timeline.mjs';
import { normalizeEditorPreferences, writeEditorPreferences, readEditorPreferences } from '../src/platform/editor-preferences.mjs';
import { legacyChart, createChartExport } from '../src/platform/files.mjs';
import { GuideLineTool } from '../src/ui/guide-line-tool.mjs';

const make = patch => ({ id: 'a', startTime: [0, 0, 1], endTime: [4, 0, 1], start: 0, end: 400, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], keepSnapped: true, ...patch });
const custom = { version: 1, nodes: [{ x: 0, y: 0, mode: 'linear' }, { x: .5, y: 1.5, mode: 'linear' }, { x: 1, y: 1, mode: 'linear' }] };

test('guide lines share standard, Bezier and custom curve mathematics but use beat progress', () => {
  assert.equal(guidePosition(make(), 2), 200);
  assert.equal(guidePosition(make(), -1), null); assert.equal(guidePosition(make(), 5), null);
  assert.equal(guidePosition(make({ easingType: 5 }), 2), 100);
  assert.ok(Math.abs(guidePosition(make({ bezier: 1, bezierPoints: [0, 0, 1, 1] }), 2) - 200) < 1e-4);
  assert.equal(guidePosition(withCustomEasing(make(), custom), 2), 600);
  const chart = createChart(); chart.BPMList.push({ startTime: [2, 0, 1], bpm: 60 }); chart.rpeNextGuideLines = [withCustomEasing(make(), custom)];
  assert.equal(guidePosition(parseChart(serializeChart(chart)).rpeNextGuideLines[0], 2), 600);
});

test('guide lines validate finite geometry, unique identities and positive duration without dropping unknown metadata', () => {
  for (const patch of [{ endTime: [0, 0, 1] }, { startTime: [-1, 0, 1] }, { start: NaN }, { end: Infinity }, { bezier: 1, bezierPoints: [0] }, { easingType: 30 }, { id: '' }]) assert.throws(() => assertGuideLine(make(patch)));
  assert.throws(() => assertGuideLines({ rpeNextGuideLines: [make(), make()] }));
  const chart = createChart(); chart.rpeNextGuideLines = [make({ privateExtension: { v: 3 } })];
  assert.deepEqual(parseChart(serializeChart(chart)).rpeNextGuideLines, chart.rpeNextGuideLines);
});

test('interval queries include overlapping long guides and snapping picks the nearest grid or guide', () => {
  const guides = [make(), make({ id: 'b', startTime: [2, 0, 1], endTime: [3, 0, 1], start: 218, end: 218 }), make({ id: 'c', startTime: [20, 0, 1], endTime: [30, 0, 1] })];
  assert.deepEqual(new Set(guideLinesInRange(guides, 2.5).map(g => g.id)), new Set(['a', 'b']));
  assert.equal(snapGuidePosition(202, 2, guides, 11), 200);
  assert.equal(snapGuidePosition(217, 2, guides, 11), 218);
  assert.equal(snapGuidePosition(202, 2, guides, 11, false), 202);
  assert.equal(snapGuidePosition(134, 2, guides, 11), 135);
  assert.equal(snapGuidePosition(202, 2, guides, 11, true, 'a'), 218);
  assert.equal(nudgeGuidePosition(190, 67.5, 2, guides), 200);
  assert.equal(nudgeGuidePosition(240, -67.5, 2, guides), 218);
  assert.equal(nudgeGuidePosition(218, -67.5, 2, guides), 200);
  assert.equal(guideLinesInRange(undefined, 1).length, 0);
});

test('stronger guide attraction applies only to placement and keeps drag snapping and the disabled path unchanged', () => {
  const guides = [make()];
  // At beat 2 the guide is X=200, between grid points 135 and 270.
  assert.equal(snapGuidePosition(160, 2, guides, 11), 135);
  assert.equal(snapGuidePosition(160, 2, guides, 11, true, null, true), 200);
  assert.equal(snapGuidePosition(244, 2, guides, 11), 270);
  assert.equal(snapGuidePosition(244, 2, guides, 11, true, null, true), 200);
  assert.deepEqual(guidePlacementRange(200, 11), [67.5, 337.5]);
  for (const x of [67.5, 100, 135, 140, 200, 264, 270, 300, 337.5]) assert.equal(snapGuidePosition(x, 2, guides, 11, true, null, true), 200);
  assert.equal(snapGuidePosition(67.49, 2, guides, 11, true, null, true), 0);
  assert.equal(snapGuidePosition(337.51, 2, guides, 11, true, null, true), 405);
  assert.deepEqual(guidePlacementRange(135, 11), [-67.5, 337.5]);
  assert.deepEqual(guidePlacementRange(-200, 11), [-337.5, -67.5]);
  assert.deepEqual(guidePlacementRange(2000, 11), [1822.5, 2092.5]);
  const overlap = [...guides, make({ id: 'b', start: 220, end: 220 })];
  assert.equal(snapGuidePosition(218, 2, overlap, 11, true, null, true), 220);
  assert.equal(snapGuidePosition(160, 2, guides, 11, false, null, true), 160);
  const timeline = Object.create(Timeline.prototype);
  Object.assign(timeline, { snapX: true, gridCount: 11, getSession: () => ({ chart: { rpeNextGuideLines: guides } }), noteView: { originX: 0, pixelsPerUnit: 1 } });
  assert.equal(timeline.notePositionAt(160, 0, 2), 135);
  assert.equal(timeline.placementPositionAt(160, 0, 2), 200);
});

test('guide clipboard projection keeps duration, values, easing and unknown data; mirroring also reflects custom source values', () => {
  const source = make({ startTime: [1, 1, 4], endTime: [5, 3, 4], start: 120, end: 600, extra: { retained: true }, bezier: 1, bezierPoints: [.2, -.3, .7, 1.2] });
  const pasted = projectGuideLine(source, 20.5, { id: 'copy' });
  assert.equal(beatValue(pasted.startTime), 20.5); assert.equal(beatValue(pasted.endTime), 25); assert.equal(pasted.id, 'copy');
  assert.equal(pasted.start, 120); assert.equal(pasted.end, 600); assert.deepEqual(pasted.extra, source.extra); assert.deepEqual(pasted.bezierPoints, source.bezierPoints);
  const mirrored = projectGuideLine(source, 10, { mirror: true }); assert.equal(mirrored.start, -120); assert.equal(mirrored.end, -600);
  for (const beat of [1.25, 2, 3, 5.75]) assert.ok(Math.abs(guidePosition(mirrored, beat - 1.25 + 10) + guidePosition(source, beat)) < 1e-7);
  assert.deepEqual(projectGuideLine(source, 20, { keepTime: true }).startTime, source.startTime);
  const cropped = { ...withCustomEasing(make(), custom), start: 600, end: 400, customEasing: { curve: custom, domain: [.5, 1], sourceStart: 0, sourceEnd: 400 } };
  const inverse = projectGuideLine(cropped, 8, { mirror: true });
  assert.equal(inverse.customEasing.sourceEnd, -400); assert.equal(guidePosition(inverse, 8), -600); assert.equal(guidePosition(inverse, 12), -400);
  assert.equal(source.start, 120); assert.equal(cropped.customEasing.sourceEnd, 400);
});

test('guide copy, quick delete, repeated paste and mirrored paste use independent identities and single undo steps', () => {
  const chart = createChart(); chart.rpeNextGuideLines = [make()]; chart.judgeLineList[0].notes = [createNote(1, 2, 200)];
  const session = new EditorSession(chart), timeline = { notesCanvas: { style: {} }, cancelPlacement() {}, hoverArea: 'notes', origin: 10, lineIndexAt: () => 0, noteBeatAt: y => y }, tool = new GuideLineTool(timeline, () => session, null, { activate() {}, invalidate() {}, reportError: error => { throw error; } });
  tool.sync = () => {}; tool.selected = 'a';
  assert.equal(tool.action('Copy'), true); assert.equal(session.history.undoStack.length, 0); assert.notEqual(tool.clipboard, chart.rpeNextGuideLines[0]);
  assert.equal(tool.action('QuickDelete'), true); assert.equal(session.chart.rpeNextGuideLines.length, 0); assert.equal(session.notes.length, 1);
  assert.equal(tool.action('Paste'), true); const first = session.chart.rpeNextGuideLines[0];
  assert.notEqual(first.id, 'a'); assert.equal(beatValue(first.startTime), 10); assert.equal(beatValue(first.endTime), 14);
  timeline.origin = 20; assert.equal(tool.action('PasteMirror'), true); const second = session.chart.rpeNextGuideLines[1];
  assert.notEqual(first.id, second.id); assert.equal(second.end, -400); assert.equal(beatValue(second.startTime), 20);
  assert.equal(session.history.undoStack.length, 3); session.travel('undo'); assert.equal(session.chart.rpeNextGuideLines.length, 1); session.travel('redo'); assert.equal(session.chart.rpeNextGuideLines.length, 2);
  tool.clearClipboard(); assert.equal(tool.action('Paste'), false);
});

test('keeping snapped notes follows relative beat and position on every line, preserving Hold duration and one-step history', () => {
  const chart = createChart(); chart.judgeLineList.push(createLine());
  chart.judgeLineList[0].notes = [createNote(1, 1, 100), createNote(2, 2, 200, 6), createNote(1, 1, 100.1)];
  chart.judgeLineList[1].notes = [createNote(3, 3, 300), createNote(1, 5, 500)]; chart.rpeNextGuideLines = [make()];
  const session = new EditorSession(chart), original = session.chart, guide = original.rpeNextGuideLines[0];
  const followers = captureGuideFollowers(original, guide); assert.equal(followers.get(0).size, 2); assert.equal(followers.get(1).size, 1);
  const next = changeGuideLine(guide, { startTime: [2, 0, 1], endTime: [10, 0, 1], end: 800 });
  const preview = previewGuideFollowers(followers, guide, next); assert.equal(preview.get(0).get(1).positionX, 400);
  assert.equal(session.chart, original); assert.equal(session.history.undoStack.length, 0);
  commitGuideLine(session, 'a', next, followers);
  assert.equal(session.history.undoStack.length, 1);
  assert.deepEqual(session.notes.map(n => [beatValue(n.startTime), beatValue(n.endTime), n.positionX]), [[4, 4, 200], [6, 10, 400], [1, 1, 100.1]]);
  assert.equal(session.chart.judgeLineList[1].notes[0].positionX, 600);
  session.travel('undo'); assert.equal(session.chart, original); session.travel('redo'); assert.equal(session.notes[1].positionX, 400);
  commitGuideLine(session, 'a', null); assert.equal(session.chart.rpeNextGuideLines.length, 0); assert.equal(session.notes[1].positionX, 400);
});

test('keep-snapped disabled and off-curve notes do not move; custom curve rebasing retains source domains', () => {
  const guide = make({ keepSnapped: false }), note = createNote(1, 2, 200);
  assert.equal(followGuideNote(note, guide, { ...guide, end: 800 }), note);
  assert.equal(captureGuideFollowers({ judgeLineList: [{ notes: [note] }] }, guide).size, 0);
  const cropped = { ...withCustomEasing(make(), custom), start: 600, end: 400, customEasing: { curve: custom, domain: [.5, 1], sourceStart: 0, sourceEnd: 400 } };
  const changed = changeGuideLine(cropped, { start: 700, end: 500 });
  assert.equal(guidePosition(changed, 0), 700); assert.equal(guidePosition(changed, 4), 500);
});

test('dragging a guide body translates endpoints and followers together, preserves shape and duration, and commits one undo', () => {
  const chart = createChart(), before = make({ startTime: [1, 0, 1], endTime: [5, 0, 1], easingType: 5 });
  chart.rpeNextGuideLines = [before]; chart.judgeLineList[0].notes = [createNote(2, 3, 100, 7)];
  const session = new EditorSession(chart), canvas = { style: {}, setPointerCapture() {} }, timeline = { notesCanvas: canvas, tool: 0 };
  const tool = new GuideLineTool(timeline, () => session, null, { activate() {}, invalidate() {}, reportError: error => { throw error; } });
  tool.selected = 'a'; tool.hit = () => ({ guide: before, lineIndex: 0, side: 1 }); tool.point = position => ({ beat: position.y, x: position.x, lineIndex: 0, side: 1 });
  assert.equal(tool.down({ button: 0, pointerId: 1 }, { x: 100, y: 3 }, null), true);
  tool.move({ x: 150, y: 5 });
  assert.equal(session.history.undoStack.length, 0); assert.equal(session.chart.rpeNextGuideLines[0], before);
  assert.equal(tool.guide.easingType, 5); assert.equal(beatValue(tool.guide.startTime), 3); assert.equal(beatValue(tool.guide.endTime), 7);
  assert.equal(tool.guide.start, 50); assert.equal(tool.guide.end, 450);
  const note = tool.noteOverrides.get(0).get(0); assert.equal(note.positionX, 150); assert.equal(beatValue(note.startTime), 5); assert.equal(beatValue(note.endTime), 9);
  tool.finishDraft(); assert.equal(session.history.undoStack.length, 1); session.travel('undo'); assert.equal(session.chart.rpeNextGuideLines[0], before);
  // A plain click never snaps or changes data, even if the pointer is off-grid.
  tool.drag = null; tool.down({ button: 0, pointerId: 2 }, { x: 101.5, y: 3.02 }, null); tool.finishDraft(); assert.equal(session.history.undoStack.length, 0);
});

test('nudge, attach-X, control balls and timeline placement share guide snapping with an inactive fast path', () => {
  const chart = createChart(); chart.rpeNextGuideLines = [make()]; chart.judgeLineList[0].notes = [createNote(1, 2, 190)];
  const session = new EditorSession(chart); session.selection.add(0);
  nudgeSelection(session, 'ArrowRight', 4, 11, true); assert.equal(session.notes[0].positionX, 200);
  session.travel('undo'); nudgeSelection(session, 'ArrowRight', 4, 11, false); assert.equal(session.notes[0].positionX, 257.5);
  session.travel('undo'); applyBatchAction(session, 'AttachX', 11); assert.equal(session.notes[0].positionX, 200);
  const result = controlSelection(captureSelection(session), 'note-move', { deltaX: 5, snapX: true, gridCount: 11 }); assert.equal(result.chart.judgeLineList[0].notes[0].positionX, 200);
  const timeline = Object.create(Timeline.prototype); Object.assign(timeline, { snapX: true, gridCount: 11, getSession: () => session });
  assert.equal(timeline.snapXPosition(201, 2), 200); timeline.snapX = false; assert.equal(timeline.snapXPosition(201, 2), 201);
  timeline.snapX = true; const ordinary = new EditorSession(); timeline.getSession = () => ordinary; assert.equal(timeline.snapXPosition(201, 2), 135);
});

test('guide width normalizes and persists independently; native and RPE exports retain guide curves without adding player events', async () => {
  assert.equal(normalizeEditorPreferences({ guideLineWidth: -1 }).guideLineWidth, .25);
  assert.equal(normalizeEditorPreferences({ guideLineWidth: 99 }).guideLineWidth, 4);
  let saved; const storage = { getItem: () => saved, setItem: (key, text) => { saved = text; } };
  writeEditorPreferences({ guideLineWidth: 1.65 }, storage); assert.equal(readEditorPreferences(storage).guideLineWidth, 1.65);
  const chart = createChart(); chart.rpeNextGuideLines = [withCustomEasing(make(), custom)]; const count = chart.judgeLineList[0].eventLayers[0].moveXEvents.length;
  assert.deepEqual(legacyChart(chart).rpeNextGuideLines, chart.rpeNextGuideLines);
  assert.equal(legacyChart(chart).judgeLineList[0].eventLayers[0].moveXEvents.length, count);
  const result = createChartExport(chart, new Map(), 'guides.json', { format: 'json', compatibility: 'next' });
  assert.deepEqual(parseChart(await result.blob.text()).rpeNextGuideLines, chart.rpeNextGuideLines);
});
