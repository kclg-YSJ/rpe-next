import test from 'node:test';
import assert from 'node:assert/strict';
import { animationCurveValue, assertAnimationCurve, compileAnimationCurve, linearCurve } from '../src/core/animation-curve.mjs';
import { addCurvePoint, moveCurveNodes, moveCurveHandle, setCurveMode, deleteCurveNodes } from '../src/core/animation-curve-edit.mjs';
import { withCustomEasing, cropCustomEvent, eventNumericValue, rebaseCustomEventValues } from '../src/core/event-easing.mjs';
import { EventTrack, SpeedIntegral } from '../src/core/events.mjs';
import { createChart, createEvent, serializeChart, parseChart, assertChart } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { splitEvent } from '../src/application/event-commands.mjs';
import { bakeAnimationCurve } from '../src/application/animation-curve-export.mjs';
import { legacyChart, createChartExport } from '../src/platform/files.mjs';
import { addCurveTemplate, parseCurveLibrary, curveLibraryText } from '../src/platform/animation-curve-library.mjs';
import { createNoiseArea, createNoiseEvent, validateNoiseAreas } from '../src/core/noise-areas.mjs';
import { validateColumnEvent } from '../src/core/global-events.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { transformEvents } from '../src/application/event-commands.mjs';
import { addSpeedCurveNode, deleteSpeedCurveNode } from '../src/application/speed-curve.mjs';
import { SpeedCurveModel } from '../src/core/speed-curve.mjs';
import { createNote } from '../src/core/chart.mjs';
import { captureSelection } from '../src/application/batch-edit.mjs';
import { previewMultiEdit } from '../src/application/multi-edit.mjs';
import { eventChains } from '../src/core/editor-display.mjs';
import { cutEventParts } from '../src/application/event-tools.mjs';
import { ANIMATION_CURVE_EXAMPLES, animationCurveExample } from '../src/core/animation-curve-examples.mjs';
import { normalizeCurvePreferences, readCurvePreferences, writeCurvePreferences } from '../src/platform/animation-curve-preferences.mjs';
import { assertEventEasing } from '../src/core/event-easing.mjs';
import { AnimationCurvePlayback, previewSelectedCurve, previewCurveEvent, previewGlobalCurve } from '../src/application/animation-curve-preview.mjs';
import { createLine } from '../src/core/chart.mjs';

const curve = () => ({ version: 1, name: 'overshoot', nodes: [{ x: 0, y: 0, mode: 'corner', out: [.13, -.3] }, { x: .5, y: 1.4, mode: 'corner', in: [.3, 1.5], out: [.7, 1.3] }, { x: 1, y: 1, mode: 'corner', in: [.9, 1] }] });
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const tempo = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }, { bpm: 173, startTime: [3, 0, 1] }]);

test('curve playback synchronizes chart seconds and source progress across BPM, factor and cropping without history writes', () => {
  const original = withCustomEasing(createEvent(10, 50, 1, 8), curve());
  const event = cropCustomEvent(original, .25, .8, [2, 0, 1], [5, 0, 1]);
  const chart = createChart(); chart.BPMList = [{ bpm: 120, startTime: [0, 0, 1] }, { bpm: 173, startTime: [3, 0, 1] }];
  const session = new EditorSession(chart); let builds = 0;
  const playback = new AnimationCurvePlayback({ event, timing: { BPMList: chart.BPMList, factor: .5 }, previewChart: curve => { builds++; return { chart: session.chart, lineIndex: 0, curve }; } });
  assert.equal(playback.sample(100), null); playback.update(); assert.equal(builds, 0);
  playback.start(event.customEasing.curve, 1000);
  const start = new TempoMap(chart.BPMList).seconds(event.startTime, .5), end = new TempoMap(chart.BPMList).seconds(event.endTime, .5);
  for (const phase of [0, .1, .5, .99]) { const state = playback.sample(1000 + playback.period * phase); close(state.seconds, start + (end - start) * phase); close(state.progress, .25 + .55 * phase); }
  close(playback.sample(1000 + playback.period).seconds, start); assert.equal(builds, 1, 'frames reuse one bounded chart snapshot');
  const next = moveCurveHandle(curve(), 0, 'out', [.2, .4]); playback.update(next); assert.equal(builds, 2); assert.equal(playback.sample(1200).curve, next);
  assert.equal(session.history.undoStack.length, 0); playback.stop(); assert.equal(playback.sample(2000), null); assert.equal(playback.view, null);
  assert.throws(() => new AnimationCurvePlayback({ event }).start(curve(), 0));
});

test('curve preview copies selected event tracks across lines while retaining note storage, values and cropped domains', () => {
  const chart = createChart(); chart.judgeLineList.push(createLine());
  chart.judgeLineList[0].notes = [createNote(1, 2, 80)];
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(10, 50, 1, 5)];
  chart.judgeLineList[1].eventLayers[0].moveXEvents = [createEvent(-4, 20, 2, 9)];
  const session = new EditorSession(chart), before = JSON.stringify(chart), definition = curve();
  const view = previewSelectedCurve(session, [{ type: 'moveXEvents', index: 0, lineIndex: 0 }, { type: 'moveXEvents', index: 0, lineIndex: 1 }], definition);
  assert.equal(view.chart.judgeLineList[0].notes, chart.judgeLineList[0].notes);
  assert.equal(view.chart.judgeLineList[1].notes, chart.judgeLineList[1].notes);
  assert.deepEqual(view.chart.judgeLineList.map(l => [l.eventLayers[0].moveXEvents[0].start, l.eventLayers[0].moveXEvents[0].end]), [[10, 50], [-4, 20]]);
  assert.equal(JSON.stringify(chart), before); assert.equal(session.history.undoStack.length, 0);
  const cropped = cropCustomEvent(withCustomEasing(createEvent(0, 10, 0, 8), curve()), .2, .7, [1, 0, 1], [5, 0, 1]);
  const next = previewCurveEvent(cropped, definition); assert.deepEqual(next.customEasing.domain, [.2, .7]); assert.equal(next.customEasing.sourceEnd, 10);
});

test('global curve preview retains real chart tracks, other global columns and source data', () => {
  const chart = createChart(); chart.globalEvents = { version: 1, types: { demo: { columns: { other: { events: [createEvent(7)] } } } } };
  const session = new EditorSession(chart), event = createEvent(0, 10, 0, 4), column = { type: { id: 'demo', source: { kind: 'mod', id: 'demo' } }, column: { id: 'value' }, events: [event] };
  const result = previewGlobalCurve(session, column, 0, curve());
  assert.equal(result.chart.judgeLineList, chart.judgeLineList);
  assert.equal(result.chart.globalEvents.types.demo.columns.other, chart.globalEvents.types.demo.columns.other);
  assert.equal(result.chart.globalEvents.types.demo.columns.value.events[0].customEasing.curve.name, 'overshoot');
  assert.equal(event.customEasing, undefined); assert.equal(chart.globalEvents.types.demo.columns.value, undefined);
});
test('custom curve preserves shape when inserting a point, including auto and Hold', () => {
  for (const c of [curve(), setCurveMode(curve(), [0, 1, 2], 'auto'), setCurveMode(curve(), [0], 'hold')]) {
    const next = addCurvePoint(c, .28); assertAnimationCurve(next);
    for (let i = 0; i <= 500; i++) close(animationCurveValue(c, i / 500), animationCurveValue(next, i / 500));
  }
});
test('curve validation rejects backward time, invalid handles and oversized definitions', () => {
  assert.throws(() => assertAnimationCurve({ ...curve(), nodes: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] }));
  const c = curve(); c.nodes[0].out = [.8, 1]; assert.throws(() => assertAnimationCurve(c));
  const next = moveCurveNodes(curve(), [1], 4, .5); assertAnimationCurve(next); assert.ok(next.nodes[1].x < 1);
  assertAnimationCurve(moveCurveHandle(curve(), 1, 'in', [-3, .1]));
  assert.equal(deleteCurveNodes(curve(), [0, 1, 2]).nodes.length, 2);
});
test('custom speed integral agrees with dense numerical integration, including cropping and BPM factors', () => {
  const event = withCustomEasing(createEvent(-7, 24, 0, 8), curve());
  for (const factor of [.7, 1, 2]) {
    const integral = new SpeedIntegral([event], tempo, factor), end = tempo.seconds(event.endTime, factor), n = 30000;
    let sum = 0; for (let i = 0; i < n; i++) sum += integral.value(end * (i + .5) / n) * end / n;
    close(integral.distance(end), sum * 120, .0002);
    close(integral.distance(end * .8) - integral.distance(end * .2), (end * .6) * -7 * 120 + 31 * end * compileAnimationCurve(event.customEasing.curve).integral(.2, .8) * 120, .00001);
  }
});
test('split preserves nonflat interiors even when the new endpoints are equal', () => {
  const c = { version: 1, nodes: [{ x: 0, y: 0, mode: 'linear' }, { x: .25, y: 1, mode: 'linear' }, { x: .5, y: 0, mode: 'linear' }, { x: 1, y: 1, mode: 'linear' }] };
  const event = withCustomEasing(createEvent(0, 10, 0, 4), c), parts = splitEvent(event, 2, new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }]));
  assert.equal(parts[0].start, parts[0].end); close(eventNumericValue(parts[0], .5), 10);
  const t = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }]), a = new EventTrack([event], t), b = new EventTrack(parts, t);
  for (let i = 0; i < 200; i++) close(a.value(i / 100), b.value(i / 100));
  const one = new SpeedIntegral([event], t), two = new SpeedIntegral(parts, t); for (let i = 0; i < 200; i++) close(one.distance(i / 100), two.distance(i / 100));
});
test('RPE baking preserves values and bounded speed distance drift; Next retains editable definitions', () => {
  const event = withCustomEasing(createEvent(-10, 30, 0, 20), curve()), parts = bakeAnimationCurve(event, tempo, .7, { speed: true });
  assert.ok(parts.length < 8192); assert.ok(parts.every(e => !e.customEasing));
  const a = new SpeedIntegral([event], tempo, .7), b = new SpeedIntegral(parts, tempo, .7), end = tempo.seconds(event.endTime, .7);
  for (let i = 0; i <= 500; i++) { close(a.value(end * i / 500), b.value(end * i / 500), .041); close(a.distance(end * i / 500), b.distance(end * i / 500), .102); }
  const chart = createChart(); chart.judgeLineList[0].eventLayers[0].speedEvents = [event];
  const parsed = parseChart(serializeChart(chart)); assert.equal(parsed.META.RPEVersion, 250); assert.deepEqual(parsed.judgeLineList[0].eventLayers[0].speedEvents[0].customEasing, event.customEasing);
  assert.ok(!legacyChart(chart).judgeLineList[0].eventLayers[0].speedEvents.some(e => e.customEasing));
  assert.throws(() => createChartExport(chart, new Map(), 'chart.json', { compatibility: 'rpe', format: 'json', bakeCustomEasing: false }));
});
test('Hold and discontinuities export without ramping through their jumps', () => {
  const c = { version: 1, nodes: [{ x: 0, y: 0, mode: 'hold' }, { x: .4, y: .8, mode: 'linear' }, { x: 1, y: 1, mode: 'hold' }] }, event = withCustomEasing(createEvent(0, 10, 0, 4), c);
  const parts = bakeAnimationCurve(event, tempo), a = new EventTrack([event], tempo), b = new EventTrack(parts, tempo), end = tempo.seconds(event.endTime);
  for (const p of [0, .1, .399, .4, .401, .5, .8, 1]) close(a.value(end * p), b.value(end * p), .001);
});
test('color/text and all four event systems retain curves; templates copy across charts', () => {
  const c = curve(), event = withCustomEasing(createEvent(0, 10, 0, 4), c), area = createNoiseArea();
  area.moveXEvents = [withCustomEasing(createNoiseEvent(0, 10, 0, 4), c)]; validateNoiseAreas([area]);
  validateColumnEvent({ valueType: 'number', name: 'number' }, event);
  const chart = createChart(); chart.judgeLineList[0].extended.scaleXEvents = [event]; chart.judgeLineList[0].eventLayers[0].moveXEvents = [event]; chart.blockAreaList = [area]; assertChart(chart);
  const color = withCustomEasing({ ...createEvent([0, 0, 0], [255, 100, 20], 0, 4) }, c); assert.ok(new EventTrack([color], tempo).value(.6)[0] > 0);
  const text = withCustomEasing(createEvent('', 'abcd', 0, 4), c), baked = bakeAnimationCurve(text, tempo); assert.ok(baked.length > 1);
  const library = addCurveTemplate([], 'curve', c), duplicate = addCurveTemplate(library, 'curve', c); assert.equal(duplicate[1].name, 'curve (2)'); assert.deepEqual(parseCurveLibrary(curveLibraryText(library)), library);
  const applied = withCustomEasing(event, library[0].curve); library[0].curve.nodes[1].y = 2; assert.notEqual(applied.customEasing.curve.nodes[1].y, 2);
});
test('endpoints are exact; cropped property edits retain output shape and reject impossible mappings', () => {
  assert.equal(animationCurveValue(curve(), 0), 0); assert.equal(animationCurveValue(curve(), 1), 1);
  const source = withCustomEasing(createEvent(-10, 30, 0, 8), curve());
  const sliced = cropCustomEvent(source, .2, .6, [0, 0, 1], [4, 0, 1]);
  const edited = rebaseCustomEventValues(sliced, { ...sliced, start: 7, end: 24 }); close(eventNumericValue(edited, 0), 7); close(eventNumericValue(edited, 1), 24);
  assert.deepEqual(edited.customEasing.domain, sliced.customEasing.domain); assert.deepEqual(edited.customEasing.curve, sliced.customEasing.curve);
  const loop = { version: 1, nodes: [{ x: 0, y: 0, mode: 'linear' }, { x: .25, y: 1, mode: 'linear' }, { x: .5, y: 0, mode: 'linear' }, { x: 1, y: 1, mode: 'linear' }] };
  const same = cropCustomEvent(withCustomEasing(createEvent(0, 10, 0, 8), loop), 0, .5, [0, 0, 1], [4, 0, 1]);
  assert.throws(() => rebaseCustomEventValues(same, { ...same, start: 3 }));
  const shifted = rebaseCustomEventValues(same, { ...same, start: 3, end: 3 }); close(eventNumericValue(shifted, .5), 13);
});
test('binding groups propagate custom curves and standard easing clears them, with one undo', () => {
  const chart = createChart(), events = [createEvent(0, 10, 0, 4), createEvent(5, 20, 4, 8)].map(e => ({ ...e, linkgroup: 3 }));
  chart.judgeLineList[0].eventLayers[0].moveXEvents = events; const session = new EditorSession(chart); session.eventSelection = new Set(['moveXEvents:0']);
  transformEvents(session, 'custom', e => withCustomEasing(e, curve()));
  assert.ok(session.chart.judgeLineList[0].eventLayers[0].moveXEvents.every(e => e.customEasing)); assert.equal(session.history.undoStack.length, 1);
  transformEvents(session, 'standard', e => { const next = { ...e, easingType: 5 }; delete next.customEasing; return next; });
  assert.ok(session.chart.judgeLineList[0].eventLayers[0].moveXEvents.every(e => !e.customEasing)); session.travel('undo'); assert.ok(session.chart.judgeLineList[0].eventLayers[0].moveXEvents.every(e => e.customEasing));
});
test('native distance panel can split and merge custom speed curves without losing area', () => {
  const chart = createChart(); chart.judgeLineList[0].eventLayers[0].speedEvents = [withCustomEasing(createEvent(2, 8, 0, 8), curve())];
  const note = createNote(1, 8, 0), model = new SpeedCurveModel(chart, 0, note), added = addSpeedCurveNode(model, 0, 3);
  for (let beat = 0; beat <= 8; beat += .2) close(model.distance(beat), added.model.distance(beat), .001);
  const node = added.model.nodes.find(n => Math.abs(n.beat - 3) < 1e-8), removed = deleteSpeedCurveNode(added.model, added.model.ref(node, 0));
  for (let beat = 0; beat <= 8; beat += .2) close(model.distance(beat), removed.model.distance(beat), .001);
});
test('cropped curve batch edits affect playback and chain ranges include nonflat same-value interiors', () => {
  const event = cropCustomEvent(withCustomEasing(createEvent(-10, 30, 0, 8), curve()), .2, .6, [0, 0, 1], [4, 0, 1]);
  const chart = createChart(); chart.judgeLineList[0].eventLayers[0].moveXEvents = [event]; const session = new EditorSession(chart); session.eventSelection = new Set(['moveXEvents:0']);
  const result = previewMultiEdit(captureSelection(session), 'events', { field: 'start', operation: 'To', lower: 7, upper: 7 });
  const next = result.chart.judgeLineList[0].eventLayers[0].moveXEvents[0]; close(eventNumericValue(next, 0), 7); close(eventNumericValue(next, 1), event.end);
  const loop = { version: 1, nodes: [{ x: 0, y: 0, mode: 'linear' }, { x: .25, y: 1, mode: 'linear' }, { x: .5, y: 0, mode: 'linear' }, { x: 1, y: 1, mode: 'linear' }] };
  const same = cropCustomEvent(withCustomEasing(createEvent(0, 10, 0, 8), loop), 0, .5, [0, 0, 1], [4, 0, 1]);
  const [group] = eventChains([same]); close(group.min, 0); close(group.max, 10);
});
test('instant text and constant curves bake without NaN or unnecessary fragments', () => {
  const text = withCustomEasing(createEvent('', 'done', 2, 2), curve()); const [baked] = bakeAnimationCurve(text, tempo); assert.equal(baked.start, 'done'); assert.equal(baked.end, 'done');
  assert.equal(bakeAnimationCurve(withCustomEasing(createEvent(7, 7, 0, 8), curve()), tempo).length, 1);
});
test('cut tool samples custom curves in seconds across BPM boundaries', () => {
  const event = withCustomEasing(createEvent(0, 100, 0, 8), curve()), parts = cutEventParts('moveXEvents', event, { division: 2, density: 1, tempo });
  const track = new EventTrack([event], tempo);
  for (const part of parts) { close(part.start, track.value(tempo.seconds(part.startTime))); close(part.end, track.value(tempo.seconds(part.endTime))); assert.equal(part.customEasing, undefined); }
});
test('large document headers preserve editable curves and format version inside the existing budget', async () => {
  const { largeChartHeader } = await import('../desktop/large-chart-document.mjs');
  const chart = createChart(); chart.judgeLineList[0].eventLayers[0].speedEvents = [withCustomEasing(createEvent(2, 8, 0, 8), curve())];
  chart.judgeLineList[0].notes = [createNote(1, 8, 0)];
  const header = largeChartHeader(chart); assert.equal(header.META.RPEVersion, 250); assert.equal(header.judgeLineList[0].notes.length, 0);
  assert.equal(header.judgeLineList[0].eventLayers[0].speedEvents[0].customEasing.curve.name, 'overshoot'); assert.equal(chart.META.RPEVersion, 170);
});
test('all six help examples are valid editable curves, including negative progress and held jumps', () => {
  assert.equal(ANIMATION_CURVE_EXAMPLES.length, 6);
  for (const example of ANIMATION_CURVE_EXAMPLES) {
    const c = animationCurveExample(example.id, example.id); assertAnimationCurve(c);
    for (let i = 0; i <= 100; i++) assert.ok(Number.isFinite(animationCurveValue(c, i / 100)));
    assert.ok(Number.isFinite(compileAnimationCurve(c).integral(0, 1)));
    const next = addCurvePoint(c, .137); for (let i = 0; i <= 100; i++) close(animationCurveValue(c, i / 100), animationCurveValue(next, i / 100));
    const event = withCustomEasing(createEvent(0, 100, 0, 8), c);
    const baked = bakeAnimationCurve(event, tempo); assert.ok(baked.length <= 8192);
  }
  assert.ok(animationCurveValue(animationCurveExample('anticipation'), .2) < 0);
  close(animationCurveValue(animationCurveExample('steps'), .49), .33);
});
test('editing a handle or a mode does not freeze unrelated automatic nodes', () => {
  const source = setCurveMode(curve(), [0, 1, 2], 'auto');
  const handle = moveCurveHandle(source, 0, 'out', [.15, .5]); assert.deepEqual(handle.nodes[2], source.nodes[2]); assert.equal(handle.nodes[1].mode, 'auto');
  const mode = setCurveMode(source, [0], 'linear'); assert.deepEqual(mode.nodes[1], source.nodes[1]); assert.deepEqual(mode.nodes[2], source.nodes[2]);
  const linear = linearCurve(), bent = moveCurveHandle(linear, 1, 'in', [.8, .2]); assert.ok(Math.abs(animationCurveValue(bent, .6) - .6) > .03, 'dragging the incoming handle activates the preceding linear segment');
});
test('aligned handle constraints preserve collinearity at neighboring time boundaries', () => {
  const c = setCurveMode(curve(), [1], 'smooth'), next = moveCurveHandle(c, 1, 'in', [-2, -1]); assertAnimationCurve(next);
  const n = next.nodes[1], a = n.in, b = n.out; close((a[0] - n.x) * (b[1] - n.y) - (a[1] - n.y) * (b[0] - n.x), 0);
  assert.ok(Math.hypot(a[0] - n.x, a[1] - n.y) > .1);
  assert.ok(Math.hypot(b[0] - n.x, b[1] - n.y) > .1);
  close(a[0], 0);
});

test('rotating either aligned handle through both vertical boundaries keeps nonzero, opposite controls', () => {
  for (const side of ['in', 'out']) for (const dy of [-.3, .3]) {
    let current = setCurveMode(curve(), [1], 'smooth');
    const other = side === 'in' ? 'out' : 'in', sign = side === 'in' ? -1 : 1;
    const otherLength = Math.hypot(current.nodes[1][other][0] - .5, current.nodes[1][other][1] - 1.4);
    // Includes release/re-grab at the vertical limit and returning from it.
    for (const dx of [.05, 1e-10, 0, -1e-10, -.08, 0, .05]) {
      const next = moveCurveHandle(current, 1, side, [.5 + sign * dx, 1.4 + dy]); assertAnimationCurve(next);
      const n = next.nodes[1], a = [n.in[0] - n.x, n.in[1] - n.y], b = [n.out[0] - n.x, n.out[1] - n.y];
      assert.equal(n.mode, 'smooth'); close(n.x, .5); close(n.y, 1.4);
      close(n[side][0], .5 + sign * Math.max(0, dx)); close(n[side][1], 1.4 + dy);
      close(a[0] * b[1] - a[1] * b[0], 0); assert.ok(a[0] * b[0] + a[1] * b[1] < 0);
      close(Math.hypot(n[other][0] - n.x, n[other][1] - n.y), otherLength);
      assert.ok(Math.hypot(...a) > .1 && Math.hypot(...b) > .1);
      for (const x of [.4999, .5, .5001]) assert.ok(Number.isFinite(animationCurveValue(next, x)));
      current = next;
    }
  }
});

test('vertical clamping preserves independent corner controls and collapsed controls can be recovered', () => {
  for (const side of ['in', 'out']) {
    const other = side === 'in' ? 'out' : 'in', c = curve();
    const next = moveCurveHandle(c, 1, side, [side === 'in' ? .6 : .4, 1.8], true);
    assertAnimationCurve(next); assert.equal(next.nodes[1].mode, 'corner');
    assert.deepEqual(next.nodes[1][side], [.5, 1.8]); assert.deepEqual(next.nodes[1][other], c.nodes[1][other]);
    c.nodes[1].mode = 'smooth'; c.nodes[1].in = [.5, 1.4]; c.nodes[1].out = [.5, 1.4];
    const recovered = moveCurveHandle(c, 1, side, [side === 'in' ? .4 : .6, 1.7]);
    assertAnimationCurve(recovered); assert.equal(recovered.nodes[1].mode, 'smooth');
    assert.ok(Math.hypot(recovered.nodes[1][side][0] - .5, recovered.nodes[1][side][1] - 1.4) > .1);
    assert.deepEqual(c.nodes[1][side], [.5, 1.4], 'source snapshot remains available for cancel/undo');
  }
});
test('floating panel preferences use the shared store and repair invalid dimensions and view ranges', () => {
  const store = new Map(), storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  writeCurvePreferences({ left: 55, top: 77, width: 900, height: 610, view: { x0: .2, x1: .8, y0: -1, y1: 2 }, snap: .05, maximized: true }, storage);
  assert.deepEqual(readCurvePreferences(storage), normalizeCurvePreferences({ left: 55, top: 77, width: 900, height: 610, view: { x0: .2, x1: .8, y0: -1, y1: 2 }, snap: .05, maximized: true }));
  const repaired = normalizeCurvePreferences({ width: Infinity, height: -2, view: { x0: 10, x1: -1, y0: NaN, y1: -2 }, snap: Infinity });
  assert.ok(repaired.view.x1 > repaired.view.x0 && repaired.view.y1 > repaired.view.y0); assert.equal(repaired.width, 1080); assert.equal(repaired.height, 360); assert.equal(repaired.snap, 0);
  const distant = normalizeCurvePreferences({ view: { y0: 1500, y1: NaN } }); assert.ok(distant.view.y1 > distant.view.y0);
});
test('invalid source value types, duplicate template identities and terminal bake overflow are rejected', () => {
  const event = withCustomEasing(createEvent(0, 10, 0, 8), curve()); event.customEasing.sourceStart = '0'; event.customEasing.sourceEnd = '10'; assert.throws(() => assertEventEasing(event));
  const template = { id: 'duplicate', name: 'curve', curve: curve() }; assert.throws(() => parseCurveLibrary(curveLibraryText([template, template]))); assert.throws(() => parseCurveLibrary('null'));
  const held = withCustomEasing(createEvent(0, 10, 0, 8), setCurveMode(linearCurve(), [0], 'hold'));
  assert.throws(() => bakeAnimationCurve(held, tempo, 1, { maxSegments: 1 }));
  assert.throws(() => bakeAnimationCurve(held, tempo, 1, { maxSegments: Infinity }));
});
