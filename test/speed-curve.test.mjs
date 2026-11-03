import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, createNote, createEvent } from '../src/core/chart.mjs';
import { SpeedCurveModel } from '../src/core/speed-curve.mjs';
import { LineRuntime } from '../src/core/scene.mjs';
import { editSpeedCurveNode, addSpeedCurveNode, deleteSpeedCurveNode } from '../src/application/speed-curve.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { beatValue } from '../src/core/beat.mjs';
import { SpeedCurvePanel, singleSpeedCurveNote } from '../src/ui/speed-curve.mjs';
import { easing as curveEasing } from '../src/core/easing.mjs';
import { normalizeSpeedCurvePreferences, readSpeedCurvePreferences, writeSpeedCurvePreferences } from '../src/platform/speed-curve-preferences.mjs';
import { replaceDistanceCurves } from '../src/application/distance-curve.mjs';

function fixture(events = [createEvent(10, 10, 0, 1)], note = createNote(1, 8, 0)) {
  const chart = createChart(); chart.judgeLineList = [createLine(), createLine()]; chart.judgeLineList[1].eventLayers = [{ speedEvents: events }]; chart.judgeLineList[1].notes = [note];
  return new SpeedCurveModel(chart, 1, note);
}
const close = (actual, expected, tolerance = .02) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('距离按现有播放器积分，覆盖 BPM、线倍率、上下侧、音符速度、偏移、负速、Hold 和 Y 控制', () => {
  for (const type of [1, 2, 3, 4]) for (const above of [0, 1]) {
    const model = fixture([createEvent(-3, 8, -2, 4), { ...createEvent(8, 2, 4, 10), easingType: 2 }], { ...createNote(type, 8, 0, type === 2 ? 12 : 8), above, speed: 1.5, yOffset: 25 });
    model.chart.BPMList = [{ startTime: [0, 0, 1], bpm: 120 }, { startTime: [5, 0, 1], bpm: 170 }]; model.line.bpmfactor = 2;
    model.line.yControl = [{ x: -500, y: .5, easing: 1 }, { x: 1000, y: 1.5, easing: 2 }];
    const actual = new SpeedCurveModel(model.chart, 1, model.note), runtime = new LineRuntime(actual.line, actual.tempo), entry = runtime.notes[0];
    for (const beat of [-4, 0, 3, 5, 6.5, 8, 9, 14]) {
      const seconds = actual.tempo.seconds(beat, actual.factor);
      close(actual.distance(beat), runtime.noteState(entry, runtime.state(seconds), seconds).y, 1e-7);
    }
  }
});

test('恒定线速不产生假突变节点，非线性速度事件起止和 BPM 边界可见', () => {
  const constant = fixture(); assert.deepEqual(constant.nodes.map(node => [node.beat, node.judgment]), [[8, true]]);
  const model = fixture([createEvent(10, 10, 0, 6), { ...createEvent(10, 5, 6, 8), easingType: 2 }]);
  assert.deepEqual(model.nodes.map(node => node.beat), [6, 8]); assert.equal(model.ref(model.nodes[0], 0).event.easingType, 2);
  constant.chart.BPMList.push({ startTime: [4, 0, 1], bpm: 60 });
  assert.equal(new SpeedCurveModel(constant.chart, 1, constant.note).nodes.find(node => node.beat === 4).bpm, true);
});

test('同起拍被后项覆盖的速度事件不生成伪节点，也不参与节点反算', () => {
  const model = fixture([createEvent(15, 15, 0, 0), createEvent(10, 10, 0, 2)]);
  assert.equal(model.nodes.length, 1); assert.equal(model.nodes[0].judgment, true); close(model.distance(3), 3000);
  const added = addSpeedCurveNode(model, 0, 4, 1200); close(added.model.distance(4), 1200);
  assert.equal(added.chart.judgeLineList[1].eventLayers[0].speedEvents[0], model.line.eventLayers[0].speedEvents[0]);
});

test('调整节点拍数与距离反算所属线事件，其他线和音符数据不变，预览无副作用且一次撤销', () => {
  const model = fixture([createEvent(10, 10, 0, 4), { ...createEvent(10, 5, 4, 7), easingType: 2 }, createEvent(5, 5, 7, 12)]);
  const ref = model.ref(model.nodes.find(node => node.beat === 4), 0), original = JSON.stringify(model.chart);
  const result = editSpeedCurveNode(model, ref, { beat: 4.5, distance: 2100 });
  close(result.model.distance(4.5), 2100); assert.equal(JSON.stringify(model.chart), original);
  assert.equal(result.chart.judgeLineList[0], model.chart.judgeLineList[0]); assert.equal(result.chart.judgeLineList[1].notes, model.line.notes);
  assert.equal(result.chart.judgeLineList[1].eventLayers[0].speedEvents[0].endTime[0], 4);
  close(beatValue(result.chart.judgeLineList[1].eventLayers[0].speedEvents[0].endTime), 4.5);
  const session = new EditorSession(model.chart); session.lineIndex = 1; session.selection = new Set([0]);
  session.commit('调速', result.chart); assert.equal(session.history.undoStack.length, 1); session.travel('undo'); assert.equal(session.chart, model.chart); session.travel('redo'); assert.equal(session.chart, result.chart);
});

test('叠加速度层的距离反算只改所选层，节点外相邻距离尽量保持', () => {
  const model = fixture([createEvent(4, 4, 0, 3), createEvent(4, 8, 3, 6), createEvent(8, 8, 6, 12)]);
  model.line.eventLayers.push({ speedEvents: [createEvent(-2, -2, 0, 10)] }); const layered = new SpeedCurveModel(model.chart, 1, model.note);
  const result = editSpeedCurveNode(layered, layered.ref(layered.nodes.find(node => node.beat === 3), 0), { distance: 1800 });
  close(result.model.distance(3), 1800); close(result.model.distance(6), layered.distance(6)); assert.equal(result.chart.judgeLineList[1].eventLayers[1], model.line.eventLayers[1]);
});

test('曲线上添加节点保留 29 种缓动形状，删除分割节点后恢复原曲线', () => {
  for (let easingType = 1; easingType <= 29; easingType++) {
    const model = fixture([{ ...createEvent(3, 12, 0, 8), easingType }]);
    if (easingType === 24) { assert.throws(() => addSpeedCurveNode(model, 0, 3), /切点/); continue; }
    const added = addSpeedCurveNode(model, 0, 3);
    assert.equal(added.chart.judgeLineList[1].eventLayers[0].speedEvents.length, 2);
    // Composite Simpson integrals on elastic/bounce easing have a finite error;
    // the split preserves the original velocity function exactly.
    for (const beat of [0, 1, 2.5, 3, 4, 7, 8, 10]) close(added.model.speed(beat), model.speed(beat), 1e-7);
    const deleted = deleteSpeedCurveNode(added.model, added.model.ref(added.model.nodes.find(node => node.beat === 3), 0));
    for (const beat of [0, 1, 3, 5, 8]) close(deleted.model.distance(beat), model.distance(beat), 1e-6);
  }
});

test('恒速曲线上添加保持实际数量与速度，不在曲线上添加则精确通过指定距离', () => {
  const model = fixture(); const added = addSpeedCurveNode(model, 0, 3);
  assert.ok(added.model.nodes.some(node => node.beat === 3)); for (const beat of [-1, 0, 3, 5, 10]) close(added.model.distance(beat), model.distance(beat), 1e-7);
  const away = addSpeedCurveNode(model, 0, 3, 2200); close(away.model.distance(3), 2200); assert.equal(away.chart.judgeLineList[1].notes, model.line.notes);
});

test('无法反算、越界、重叠、绑定和奇异 Bezier 明确拒绝且不修改原谱', () => {
  const model = fixture([createEvent(10, 10, 0, 4), createEvent(10, 5, 4, 8), createEvent(5, 5, 8, 12)]), ref = model.ref(model.nodes.find(node => node.beat === 4), 0), original = JSON.stringify(model.chart);
  assert.throws(() => editSpeedCurveNode(model, ref, { beat: 9, distance: 100 }), /cross/);
  assert.throws(() => editSpeedCurveNode(model, ref, { easing: 30 }), /easing/);
  assert.throws(() => editSpeedCurveNode(model, ref, { beat: NaN }), /range/);
  const atHit = model.ref(model.nodes.find(node => node.beat === 8), 0); assert.throws(() => editSpeedCurveNode(model, atHit, { distance: 100 }), /hit/);
  const zero = fixture(model.line.eventLayers[0].speedEvents, { ...createNote(1, 8, 0), speed: 0 }); assert.throws(() => editSpeedCurveNode(zero, ref, { distance: 100 }), /zeroNote/);
  model.line.eventLayers[0].speedEvents[1].linkgroup = 2; assert.throws(() => editSpeedCurveNode(model, ref, { distance: 100 }), /linked/); model.line.eventLayers[0].speedEvents[1].linkgroup = 0;
  assert.equal(JSON.stringify(model.chart), original);
  const bezier = fixture([{ ...createEvent(3, 10, 0, 8), bezier: 1, bezierPoints: [-.2, .3, .5, .9] }]); assert.throws(() => addSpeedCurveNode(bezier, 0, 4), /bezier/);
});

test('Bezier 速度曲线上添加节点用 De Casteljau 拆分，完整保留速度函数与自定义字段', () => {
  const model = fixture([{ ...createEvent(3, 10, 0, 8), bezier: 1, bezierPoints: [.2, .3, .5, .9], custom: { preserve: true } }]);
  const added = addSpeedCurveNode(model, 0, 3);
  for (let beat = 0; beat < 10; beat += .1) close(added.model.speed(beat), model.speed(beat), 1e-7);
  for (const event of added.chart.judgeLineList[1].eventLayers[0].speedEvents) assert.deepEqual(event.custom, { preserve: true });
});

test('单选入口支持多线真实所属线，完整磁盘多选不以代表音符冒充单选', () => {
  const model = fixture(), session = new EditorSession(model.chart); session.focus = 'notes'; session.lineIndex = 0; session.multiLineIndices = [1]; session.setMultiLineEnabled(true); session.multiLineSelection = new Map([[1, new Set([0])]]);
  assert.equal(singleSpeedCurveNote(session).lineIndex, 1); session.largeDocument = { logicalSelection: {}, selectedCount: 10 }; assert.equal(singleSpeedCurveNote(session), null);
});

test('模型不访问其他音符，不为曲线创建全线运行时；未变化的层积分可复用', () => {
  const model = fixture(); Object.defineProperty(model.line, 'notes', { get() { throw Error('Full note scan'); } });
  const next = new SpeedCurveModel(model.chart, 1, model.note, model); assert.equal(next.layers[0], model.layers[0]); assert.ok(Number.isFinite(next.distance(3)));
});

test('面板未展开时不读取会话、不创建 DOM、不调度帧；近曲线判定先于横轴吸附', () => {
  const panel = new SpeedCurvePanel(() => assert.fail('Closed panel read context'));
  panel.schedule(); panel.close(); assert.equal(panel.previewState(), null); assert.equal(panel.root, undefined); assert.equal(panel.frame, undefined);
  const model = fixture(); panel.getContext = () => ({ timeline: { division: 4 } }); panel.model = model; panel.rect = { left: 0, top: 0, width: 800, height: 400 }; panel.start = 0; panel.span = 8; panel.limit = 5000; panel.gridStep = 100; panel.snapStep = 50; panel.snapY = true;
  panel.curvePixels = Array.from({ length: 801 }, (_, i) => panel.screen(i / 100, model.distance(i / 100)));
  const rawBeat = 4.12, point = panel.screen(rawBeat, model.distance(rawBeat));
  const added = panel.additionAt(point); assert.equal(added.beat, 4); assert.equal(added.near, true); close(added.distance, model.distance(4));
  const away = panel.additionAt(panel.screen(4.12, 1324)); assert.equal(away.near, false); close(away.distance, 1300);
  panel.gridStep = 1000; close(panel.additionAt(panel.screen(4.12, 1324)).distance, 1300, 1e-7);
});

test('无速度事件的层可建立节点；恒定零 Y 控制无法反算时不伪造结果', () => {
  const model = fixture([]), added = addSpeedCurveNode(model, 0, 3, 600);
  close(added.model.distance(3), 600); assert.equal(added.chart.judgeLineList[1].eventLayers[0].speedEvents.length, 1);
  const controlled = fixture([createEvent(10, 10, 0, 6), createEvent(10, 5, 6, 8)]);
  controlled.line.yControl = [{ x: -10000, y: 0 }, { x: 10000, y: 0 }]; const zero = new SpeedCurveModel(controlled.chart, 1, controlled.note);
  assert.throws(() => editSpeedCurveNode(zero, zero.ref(zero.nodes.find(node => node.beat === 6), 0), { distance: 50 }), /control/);
});

test('尾部、前部、间隙及空层新增节点均生成正时长事件，后段对应实际两个节点', () => {
  for (const [events, beat] of [
    [[createEvent(10, 10, 0, 1)], 3], [[createEvent(10, 10, 0, 1)], 10],
    [[createEvent(10, 10, 4, 6)], 2], [[createEvent(10, 10, 0, 1), createEvent(5, 5, 6, 9)], 3], [[], 3],
  ]) {
    const model = fixture(events), original = JSON.stringify(model.chart), added = addSpeedCurveNode(model, 0, beat);
    const list = added.chart.judgeLineList[1].eventLayers[0].speedEvents;
    assert.ok(list.every(event => beatValue(event.endTime) > beatValue(event.startTime)), 'new events have positive duration');
    assert.equal(JSON.stringify(model.chart), original);
    assert.ok(added.model.nodes.some(node => Math.abs(node.beat - beat) < 1e-6));
    for (const node of added.model.nodes) {
      const outgoing = added.model.outgoing(node, 0);
      if (outgoing) assert.ok(outgoing.end > outgoing.start);
    }
    const last = added.model.nodes.at(-1);
    assert.equal(added.model.outgoing(last, 0), null);
    assert.throws(() => editSpeedCurveNode(added.model, added.model.ref(last, 0), { easing: 2 }), /lastNode/);
  }
});

test('恒速距离为缓动 1，改成缓动 5 生成单段线性速度和二次距离曲线', () => {
  const added = addSpeedCurveNode(fixture(), 0, 3), node = added.model.nodes.find(node => node.beat === 3);
  assert.equal(added.model.outgoing(node, 0).easing, 1);
  const edited = editSpeedCurveNode(added.model, added.model.ref(node, 0), { easing: 5 });
  const segment = edited.model.outgoing(edited.model.nodes.find(node => node.beat === 3), 0);
  assert.equal(segment.easing, 5); assert.equal(edited.pieces, 1); assert.equal(segment.event.easingType, 1);
  for (const beat of [0, 3, 8, 10]) close(edited.model.distance(beat), added.model.distance(beat));
  close(edited.model.distance(5.5), added.model.distance(3) * .75);
});

test('全部 29 种距离缓动匹配曲线、固定端点及区间外距离，拟合最多 64 段且内部接点不显示', () => {
  for (let easing = 1; easing <= 29; easing++) {
    const model = fixture([createEvent(10, 10, 0, 4), createEvent(10, 4, 4, 7), createEvent(4, 4, 7, 12)]);
    const node = model.nodes.find(node => node.beat === 4), ref = model.ref(node, 0), original = JSON.stringify(model.chart);
    const edited = editSpeedCurveNode(model, ref, { easing });
    const segment = edited.model.outgoing(edited.model.nodes.find(node => node.beat === 4), 0);
    assert.deepEqual([segment.start, segment.end, segment.easing], [4, 7, easing]);
    assert.ok(edited.pieces <= 64);
    assert.equal(edited.model.nodes.some(node => node.beat > 4 && node.beat < 7), false);
    const first = model.distance(4), delta = model.distance(7) - first;
    for (let i = 0; i <= 1000; i++) close(edited.model.distance(4 + 3 * i / 1000), first + delta * curveEasing(i / 1000, easing), Math.max(.2, Math.abs(delta) * .0015) * 1.15);
    for (const beat of [-1, 0, 4, 7, 8, 11]) close(edited.model.distance(beat), model.distance(beat), .01);
    assert.equal(JSON.stringify(model.chart), original);
    assert.equal(edited.chart.judgeLineList[1].notes, model.line.notes);
  }
});

test('事件结束节点的后段缓动编辑作用于后续间隙，末节点禁用，不误改刚结束的事件', () => {
  const model = fixture([createEvent(10, 5, 0, 3), createEvent(10, 3, 6, 9)]);
  const node = model.nodes.find(node => node.beat === 3), ref = model.ref(node, 0);
  assert.equal(ref.edge, 'end'); assert.deepEqual([model.outgoing(node, 0).start, model.outgoing(node, 0).end], [3, 6]);
  const edited = editSpeedCurveNode(model, ref, { easing: 2 });
  const segment = edited.model.outgoing(edited.model.nodes.find(node => node.beat === 3), 0);
  assert.equal(segment.easing, 2); assert.equal(beatValue(segment.event.startTime), 3); assert.equal(beatValue(segment.event.endTime), 6);
  assert.equal(edited.chart.judgeLineList[1].eventLayers[0].speedEvents[0], model.line.eventLayers[0].speedEvents[0]);
  for (const beat of [0, 3, 6, 8, 10]) close(edited.model.distance(beat), model.distance(beat));
  const last = model.nodes.at(-1); assert.equal(last.beat, 9);
  assert.throws(() => editSpeedCurveNode(model, model.ref(last, 0), { easing: 3 }), /lastNode/);
});

test('最后一段切换缓动后保留末节点以后的原线速，不把新尾速无限延伸', () => {
  const model = fixture([createEvent(10, 2, 0, 6)]);
  const edited = editSpeedCurveNode(model, model.ref(model.nodes[0], 0), { easing: 2 });
  for (const beat of [0, 6, 7, 8, 15]) close(edited.model.distance(beat), model.distance(beat));
  close(edited.model.speed(10), 2, 1e-6);
  const last = edited.model.nodes.at(-1); assert.equal(last.beat, 8); assert.equal(edited.model.outgoing(last, 0), null);
  assert.ok(edited.chart.judgeLineList[1].eventLayers[0].speedEvents.every(event => beatValue(event.endTime) > beatValue(event.startTime)));
});

test('速度段跨过音符判定时刻时，两侧积分分别保持；叠加层、BPM 和负速一致', () => {
  for (const above of [1, 0]) {
    const model = fixture([createEvent(-3, 10, 0, 12)], { ...createNote(1, 8, 0), above });
    model.chart.BPMList.push({ bpm: 180, startTime: [5, 0, 1] }); model.line.bpmfactor = 2;
    model.line.eventLayers.push({ speedEvents: [createEvent(2, 2, 0, 16)] });
    const baseline = new SpeedCurveModel(model.chart, 1, model.note), ref = baseline.ref(baseline.nodes.find(node => node.beat === 0), 0);
    const edited = editSpeedCurveNode(baseline, ref, { easing: 2 });
    for (const beat of [-2, 0, 8, 12, 16]) close(edited.model.distance(beat), baseline.distance(beat));
    assert.equal(edited.chart.judgeLineList[1].eventLayers[1], baseline.line.eventLayers[1]);
    assert.equal(edited.model.outgoing(edited.model.nodes.find(node => node.beat === 0), 0).easing, 2);
  }
});

test('已有旧零长度节点编辑时转成实际区间，删除终点不再留下同一个空节点', () => {
  const instant = { ...createEvent(10, 10, 3, 3), rpeNextSpeedCurveNode: true };
  const model = fixture([createEvent(10, 10, 0, 1), instant]);
  const moved = editSpeedCurveNode(model, model.ref(model.nodes.find(node => node.beat === 3), 0), { distance: 2000 });
  close(moved.model.distance(3), 2000);
  assert.ok(moved.chart.judgeLineList[1].eventLayers[0].speedEvents.every(event => beatValue(event.endTime) > beatValue(event.startTime)));
  const added = addSpeedCurveNode(fixture(), 0, 3);
  const deleted = deleteSpeedCurveNode(added.model, added.model.ref(added.model.nodes.find(node => node.beat === 8), 0));
  assert.equal(deleted.model.nodes.find(node => node.beat === 8).judgment, true);
  assert.equal(deleted.model.ref(deleted.model.nodes.find(node => node.beat === 8), 0).edge, 'judgment');
});

test('判定点只在面板中生成，坐标和删除被拒绝；后方有节点时可编辑距离缓动', () => {
  const model = fixture([createEvent(10, 3, 0, 12)]), original = JSON.stringify(model.chart), node = model.nodes.find(node => node.judgment), ref = model.ref(node, 0);
  assert.throws(() => editSpeedCurveNode(model, ref, { beat: 9 }), /hit/);
  assert.throws(() => deleteSpeedCurveNode(model, ref), /hit/);
  const added = addSpeedCurveNode(model, 0, 8);
  assert.notEqual(added.model.ref(added.model.nodes.find(node => node.judgment), 0).edge, 'judgment');
  const edited = editSpeedCurveNode(model, ref, { easing: 5 });
  close(edited.model.distance(10), model.distance(12) * .25);
  for (const beat of [-2, 0, 4, 8, 12, 16]) close(edited.model.distance(beat), model.distance(beat));
  assert.equal(JSON.stringify(model.chart), original);
});

test('拟合距离节点可插入、拖动、删除，保存再读保留分组，自定义字段无损', () => {
  const model = fixture([createEvent(10, 10, 0, 3), { ...createEvent(10, 5, 3, 8), custom: { keep: true } }]);
  const fitted = editSpeedCurveNode(model, model.ref(model.nodes.find(node => node.beat === 3), 0), { easing: 24 });
  assert.ok(fitted.pieces > 1);
  assert.ok(fitted.chart.judgeLineList[1].eventLayers[0].speedEvents.filter(event => event.rpeNextDistanceCurve).every(event => event.custom.keep));
  const roundTrip = JSON.parse(JSON.stringify(fitted.chart)); const reopened = new SpeedCurveModel(roundTrip, 1, roundTrip.judgeLineList[1].notes[0]);
  assert.deepEqual(reopened.nodes.map(node => node.beat), fitted.model.nodes.map(node => node.beat));
  const added = addSpeedCurveNode(reopened, 0, 5);
  assert.ok(added.model.nodes.some(node => node.beat === 5));
  for (let beat = 0; beat < 12; beat += .03) close(added.model.distance(beat), reopened.distance(beat), 1e-6);
  const moved = editSpeedCurveNode(added.model, added.model.ref(added.model.nodes.find(node => node.beat === 5), 0), { beat: 5.25, distance: 850 });
  close(moved.model.distance(5.25), 850); close(moved.model.distance(3), model.distance(3)); close(moved.model.distance(8), model.distance(8));
  const removed = deleteSpeedCurveNode(moved.model, moved.model.ref(moved.model.nodes.find(node => node.beat === 5.25), 0));
  assert.equal(removed.model.nodes.some(node => node.beat === 5.25), false); assert.equal(removed.model.outgoing(removed.model.nodes.find(node => node.beat === 3), 0).easing, 1);
});

test('外部改变拟合事件形状后不沿用旧的节点合并和缓动声明', () => {
  const model = fixture([createEvent(10, 10, 0, 3), createEvent(10, 5, 3, 8)]);
  const fitted = editSpeedCurveNode(model, model.ref(model.nodes.find(node => node.beat === 3), 0), { easing: 29 });
  const chart = JSON.parse(JSON.stringify(fitted.chart)), parts = chart.judgeLineList[1].eventLayers[0].speedEvents.filter(event => event.rpeNextDistanceCurve);
  parts[1].end += 1;
  const changed = new SpeedCurveModel(chart, 1, chart.judgeLineList[1].notes[0]);
  assert.equal(changed.layers[0].recipes.size, 0); assert.ok(changed.nodes.some(node => node.beat > 3 && node.beat < 8));
  const inserted = JSON.parse(JSON.stringify(fitted.chart)); inserted.judgeLineList[1].eventLayers[0].speedEvents.push(createEvent(5, 8, 4.1, 4.2));
  assert.equal(new SpeedCurveModel(inserted, 1, inserted.judgeLineList[1].notes[0]).layers[0].recipes.size, 0);
});

test('换音符后的默认判定点可分开编辑旧拟合区间，未改的两端仍合并显示', () => {
  const model = fixture([createEvent(10, 10, 0, 3), createEvent(10, 5, 3, 8)]);
  const fitted = editSpeedCurveNode(model, model.ref(model.nodes.find(node => node.beat === 3), 0), { easing: 24 });
  const another = new SpeedCurveModel(fitted.chart, 1, createNote(1, 6, 0));
  const edited = editSpeedCurveNode(another, another.ref(another.nodes.find(node => node.beat === 3), 0), { easing: 5 });
  assert.deepEqual(edited.model.nodes.filter(node => node.beat >= 3 && node.beat <= 8).map(node => node.beat), [3, 6, 8]);
  for (const beat of [6, 6.5, 7, 7.5, 8, 10]) close(edited.model.distance(beat), another.distance(beat), 1e-6);
});

test('距离缓动处理 BPM 变化、倍率、多层、下侧、音符速度与 Y 控制，其他层不动', () => {
  for (const kind of [1, 5, 16, 26]) {
    const model = fixture([createEvent(10, 5, 0, 8)], { ...createNote(1, 8, 0), above: 0, speed: 1.7, yOffset: 12 });
    model.chart.BPMList.push({ startTime: [3, 0, 1], bpm: 160 }); model.line.bpmfactor = 2;
    model.line.yControl = [{ x: -10000, y: .8, easing: 1 }, { x: 10000, y: 1.2, easing: 1 }];
    model.line.eventLayers.push({ speedEvents: [createEvent(-2, 1, 0, 8)] });
    const baseline = new SpeedCurveModel(model.chart, 1, model.note), edited = editSpeedCurveNode(baseline, baseline.ref(baseline.nodes.find(node => node.beat === 0), 0), { easing: kind });
    const first = baseline.distance(0), delta = baseline.distance(8) - first;
    for (let i = 0; i <= 400; i++) close(edited.model.distance(8 * i / 400), first + delta * curveEasing(i / 400, kind), Math.max(.2, Math.abs(delta) * .0015) * 1.15);
    assert.equal(edited.chart.judgeLineList[1].eventLayers[1], baseline.line.eventLayers[1]);
  }
});

test('视图设置存储完整、容错并限制数值，默认吸附步长与缩放独立', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(readSpeedCurvePreferences(storage).snapStep, 100);
  const settings = { width: 900, height: 550, left: 120, top: 160, span: 16, offset: -12.5, limit: 5400, snapY: false, snapStep: 25, layer: 2 };
  writeSpeedCurvePreferences(settings, storage); assert.deepEqual(readSpeedCurvePreferences(storage), settings);
  assert.equal(normalizeSpeedCurvePreferences({ span: Infinity, limit: -1, snapStep: 0 }).span, 8);
  assert.equal(normalizeSpeedCurvePreferences({ limit: -1 }).limit, 200);
  assert.equal(normalizeSpeedCurvePreferences({ snapStep: 0 }).snapStep, .001);
  assert.deepEqual(readSpeedCurvePreferences({ getItem: () => '{broken' }), normalizeSpeedCurvePreferences());
});

test('BPM 过密而超过拟合预算时整次拒绝，不写入超出预算的速度碎片', () => {
  const source = fixture([createEvent(10, 5, 0, 8)]);
  source.chart.BPMList = Array.from({ length: 70 }, (_, i) => ({ startTime: [0, i, 16], bpm: 120 + i }));
  const model = new SpeedCurveModel(source.chart, 1, source.note), original = JSON.stringify(model.chart);
  assert.throws(() => editSpeedCurveNode(model, model.ref(model.nodes.find(node => node.beat === 0), 0), { easing: 5 }), /fitBudget/);
  assert.equal(JSON.stringify(model.chart), original);
});

test('大距离下的高次缓动按播放器实际积分归一，端点不积累数值误差', () => {
  for (const kind of [14, 15]) {
    const model = fixture([createEvent(10000, 10000, 0, 3), createEvent(10000, 5000, 3, 8)]);
    const edited = editSpeedCurveNode(model, model.ref(model.nodes.find(node => node.beat === 3), 0), { easing: kind });
    assert.equal(edited.pieces, 1);
    for (const beat of [-2, 0, 3, 8, 12]) close(edited.model.distance(beat), model.distance(beat), 1e-6);
  }
});

test('非整数 BPM 和线倍率下保留原始节点拍数，80.5 拍节点的连续属性编辑不误拆边界', () => {
  for (const bpm of [125, 123, 150, 180, 173.25, 137.7]) for (const factor of [1, .8, 1.3, 2]) {
    const source = fixture([createEvent(8, 8, 0, 79.5), createEvent(8, 7, 79.5, 79.75), createEvent(7, 6, 79.75, 80.5), createEvent(13.889, 13.889, 80.5, 81.5), createEvent(4, 4, 81.5, 84)], createNote(1, 81, 0));
    source.chart.BPMList[0].bpm = bpm; source.line.bpmfactor = factor;
    const model = new SpeedCurveModel(source.chart, 1, source.note), original = JSON.stringify(model.chart);
    assert.deepEqual(model.nodes.map(node => node.beat), [79.5, 79.75, 80.5, 81, 81.5]);
    const select = (model, beat) => model.ref(model.nodes.find(node => node.beat === beat), 0);
    let edited = editSpeedCurveNode(model, select(model, 80.5), { easing: 5 });
    edited = editSpeedCurveNode(edited.model, select(edited.model, 80.5), { distance: 400 });
    close(edited.model.distance(80.5), 400);
    edited = editSpeedCurveNode(edited.model, select(edited.model, 80.5), { easing: 2 });
    close(edited.model.distance(80.5), 400);
    edited = editSpeedCurveNode(edited.model, select(edited.model, 80.5), { beat: 80.75, distance: 450 });
    close(edited.model.distance(80.75), 450);
    for (const beat of [79.5, 79.75, 81, 81.5, 84]) close(edited.model.distance(beat), model.distance(beat));
    assert.equal(JSON.stringify(model.chart), original);
    assert.equal(edited.chart.judgeLineList[1].notes, model.line.notes);
    assert.ok(edited.chart.judgeLineList[1].eventLayers[0].speedEvents.every(event => beatValue(event.endTime) > beatValue(event.startTime)));
  }
});

test('裁换距离区间时容忍端点浮点余差，保留相邻原事件且不调用边界拆分', () => {
  const model = fixture([createEvent(5, 8, 79, 80.5), createEvent(8, 4, 80.5, 81.5), createEvent(4, 3, 81.5, 84)], createNote(1, 83, 0));
  const edited = replaceDistanceCurves(model, 0, [{ start: 80.5 + 2e-14, end: 81.5 - 2e-14, easing: 5 }], () => assert.fail('A coincident boundary must not be split'));
  assert.equal(edited.chart.judgeLineList[1].eventLayers[0].speedEvents[0], model.line.eventLayers[0].speedEvents[0]);
  assert.ok(edited.chart.judgeLineList[1].eventLayers[0].speedEvents.includes(model.line.eventLayers[0].speedEvents[2]));
  for (const beat of [79, 80.5, 81.5, 83, 84]) close(edited.model.distance(beat), model.distance(beat));
});

test('原生和拟合节点从判定前后移到判定点均可重合，真实节点优先且反侧曲线保持', () => {
  for (const after of [false, true]) for (const managed of [false, true]) {
    const source = fixture([createEvent(10, 6, 0, 12)], { ...createNote(1, 8, 0), speed: 1.4, above: 0, yOffset: 25 });
    const at = after ? 10 : 6;
    let added = addSpeedCurveNode(source, 0, at);
    if (managed) added = editSpeedCurveNode(added.model, added.model.ref(added.model.nodes.find(node => node.beat === at), 0), { easing: 5 });
    const previous = added.model, moved = editSpeedCurveNode(previous, previous.ref(previous.nodes.find(node => node.beat === at), 0), { beat: 8, distance: 1234 });
    const hit = moved.model.nodes.find(node => node.judgment), ref = moved.model.ref(hit, 0);
    assert.notEqual(ref.edge, 'judgment'); assert.equal(hit.beat, 8); assert.ok(ref.event);
    assert.equal(moved.model.nodes.some(node => node.beat === at), false);
    close(moved.model.distance(8), source.distance(8));
    const samples = after ? [0, 2, 4, 6, 7.99] : [8.01, 9, 10, 12, 14];
    for (const beat of samples) { close(moved.model.distance(beat), previous.distance(beat)); close(moved.model.speed(beat), previous.speed(beat), 1e-6); }
    const awayBeat = after ? 9 : 7;
    const away = editSpeedCurveNode(moved.model, ref, { beat: awayBeat, distance: previous.distance(awayBeat) });
    assert.ok(away.model.nodes.some(node => node.beat === awayBeat)); assert.ok(away.model.nodes.some(node => node.judgment && node.beat === 8));
    close(away.model.distance(awayBeat), previous.distance(awayBeat));
    assert.equal(moved.chart.judgeLineList[1].notes, source.line.notes);
    assert.ok(away.chart.judgeLineList[1].eventLayers[0].speedEvents.every(event => beatValue(event.endTime) > beatValue(event.startTime)));
  }
});

test('用户节点落到恒速尾部的判定点不生成零长事件，之后前段修改不会影响判定后', () => {
  const source = fixture(), added = addSpeedCurveNode(source, 0, 6);
  const moved = editSpeedCurveNode(added.model, added.model.ref(added.model.nodes.find(node => node.beat === 6), 0), { beat: 8, distance: 0 });
  const before = addSpeedCurveNode(moved.model, 0, 4);
  const edited = editSpeedCurveNode(before.model, before.model.ref(before.model.nodes.find(node => node.beat === 4), 0), { distance: 2000 });
  close(edited.model.distance(4), 2000);
  for (const beat of [8, 8.5, 10, 15]) { close(edited.model.distance(beat), moved.model.distance(beat)); close(edited.model.speed(beat), moved.model.speed(beat), 1e-6); }
  assert.ok(edited.chart.judgeLineList[1].eventLayers[0].speedEvents.every(event => beatValue(event.endTime) > beatValue(event.startTime)));
});

test('可直接在默认判定点建真实节点，缓动按前后独立编辑，删除后默认锚点仍保留', () => {
  const source = fixture([createEvent(10, 4, 0, 12)]), original = JSON.stringify(source.chart);
  const added = addSpeedCurveNode(source, 0, 8, source.distance(8)), hit = added.model.nodes.find(node => node.judgment);
  assert.notEqual(added.model.ref(hit, 0).edge, 'judgment');
  const edited = editSpeedCurveNode(added.model, added.model.ref(hit, 0), { easing: 5 });
  assert.equal(edited.model.outgoing(edited.model.nodes.find(node => node.judgment), 0).easing, 5);
  for (const beat of [0, 4, 7.5, 8]) close(edited.model.distance(beat), source.distance(beat));
  assert.throws(() => editSpeedCurveNode(edited.model, edited.model.ref(edited.model.nodes.find(node => node.judgment), 0), { distance: 10 }), /hit/);
  const removed = deleteSpeedCurveNode(edited.model, edited.model.ref(edited.model.nodes.find(node => node.judgment), 0));
  assert.ok(removed.model.nodes.some(node => node.judgment));
  assert.equal(removed.model.ref(removed.model.nodes.find(node => node.judgment), 0).edge, 'judgment');
  for (const beat of [0, 8, 12, 16]) close(removed.model.distance(beat), edited.model.distance(beat));
  assert.equal(JSON.stringify(source.chart), original);
});

test('重合判定节点遵循真实层并保留撤销重做，不能越过其他真实节点', () => {
  const source = fixture([createEvent(10, 10, 0, 12)]);
  source.line.eventLayers.push({ speedEvents: [createEvent(2, 2, 0, 12)] });
  const model = new SpeedCurveModel(source.chart, 1, source.note), added = addSpeedCurveNode(model, 1, 6);
  const moved = editSpeedCurveNode(added.model, added.model.ref(added.model.nodes.find(node => node.beat === 6), 1), { beat: 8 });
  assert.equal(moved.model.ref(moved.model.nodes.find(node => node.judgment), 1).layer, 1);
  assert.notEqual(moved.model.ref(moved.model.nodes.find(node => node.judgment), 1).edge, 'judgment');
  assert.equal(moved.chart.judgeLineList[1].eventLayers[0], source.line.eventLayers[0]);
  const session = new EditorSession(added.chart); session.commit('重合判定节点', moved.chart); session.travel('undo'); assert.equal(session.chart, added.chart); session.travel('redo'); assert.equal(session.chart, moved.chart);
  const middle = addSpeedCurveNode(added.model, 1, 7);
  assert.throws(() => editSpeedCurveNode(middle.model, middle.model.ref(middle.model.nodes.find(node => node.beat === 6), 1), { beat: 8 }), /cross/);
});

test('跨过判定点的已有拟合曲线可以移入真实节点，剩余拟合分组与重开保持完整', () => {
  const source = fixture([createEvent(10, 10, 0, 3), createEvent(10, 5, 3, 12)], createNote(1, 16, 0));
  const fitted = editSpeedCurveNode(source, source.ref(source.nodes.find(node => node.beat === 3), 0), { easing: 24 });
  const another = new SpeedCurveModel(fitted.chart, 1, createNote(1, 8, 0));
  const added = addSpeedCurveNode(another, 0, 6);
  const moved = editSpeedCurveNode(added.model, added.model.ref(added.model.nodes.find(node => node.beat === 6), 0), { beat: 8 });
  assert.notEqual(moved.model.ref(moved.model.nodes.find(node => node.judgment), 0).edge, 'judgment');
  for (let beat = 8; beat <= 14; beat += .1) close(moved.model.distance(beat), another.distance(beat));
  assert.equal(moved.model.nodes.some(node => node.beat > 8 && node.beat < 12), false);
  const chart = JSON.parse(JSON.stringify(moved.chart)), reopened = new SpeedCurveModel(chart, 1, createNote(1, 8, 0));
  assert.notEqual(reopened.ref(reopened.nodes.find(node => node.judgment), 0).edge, 'judgment');
});

test('Hold 的真实节点可与判定点重合并重新向前拖出，判定后头部仍固定', () => {
  const source = fixture([createEvent(10, 6, 0, 12)], createNote(2, 8, 0, 10));
  const added = addSpeedCurveNode(source, 0, 6);
  const moved = editSpeedCurveNode(added.model, added.model.ref(added.model.nodes.find(node => node.beat === 6), 0), { beat: 8 });
  const ref = moved.model.ref(moved.model.nodes.find(node => node.judgment), 0);
  assert.notEqual(ref.edge, 'judgment');
  const away = editSpeedCurveNode(moved.model, ref, { beat: 7, distance: 300 });
  close(away.model.distance(7), 300); for (const beat of [8, 9, 10, 12]) close(away.model.distance(beat), 0);
  const after = editSpeedCurveNode(moved.model, ref, { beat: 10, distance: 0 });
  assert.ok(after.model.nodes.some(node => node.beat === 10));
  const landed = editSpeedCurveNode(after.model, after.model.ref(after.model.nodes.find(node => node.beat === 10), 0), { beat: 8 });
  assert.notEqual(landed.model.ref(landed.model.nodes.find(node => node.judgment), 0).edge, 'judgment');
  for (const beat of [0, 4, 7, 8]) close(landed.model.distance(beat), after.model.distance(beat));
  for (const beat of [8, 9, 10, 12]) close(landed.model.distance(beat), 0);
});
