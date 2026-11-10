import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorSession } from '../src/application/session.mjs';
import { EditorPlayback } from '../src/application/playback.mjs';
import { Timeline } from '../src/ui/timeline.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { createEvent, createNote } from '../src/core/chart.mjs';
import { placedEvent } from '../src/application/event-commands.mjs';
import { beatValue } from '../src/core/beat.mjs';
import { snapPosition, snapTime, verticalGrid, wheelSeconds } from '../src/core/edit-grid.mjs';
import { hitFrame, HIT_DURATION, DEFAULT_LINE_WIDTH, DEFAULT_LINE_HEIGHT } from '../src/core/visual-constants.mjs';
import { easingPicture } from '../src/core/easing-picture.mjs';
import { readEditorPreferences, writeEditorPreferences } from '../src/platform/editor-preferences.mjs';
import { migratePreferences, shortcutAction } from '../src/core/preferences.mjs';

function canvas() {
  return { clientWidth: 500, clientHeight: 600, style: {}, addEventListener() {}, focus() {}, setPointerCapture() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 500, height: 600 }; } };
}
function editor() {
  const session = new EditorSession();
  const timeline = new Timeline(canvas(), canvas(), () => session, () => {}, () => {});
  return { session, timeline };
}

test('滚轮向上暂停并定位真实时间，继续从新位置播放；准备播放可被滚轮取消', async () => {
  let resolvePreparation;
  const sounds = { stop() {}, prepare: () => new Promise(resolve => { resolvePreparation = resolve; }) };
  const audio = { time: 10, duration: 120, rate: 1, playing: true, pause() { this.playing = false; }, seek(seconds) { this.time = seconds; }, async play() { this.playing = true; } };
  let visible = 0;
  const playback = new EditorPlayback(audio, sounds, () => { visible = audio.time; });
  playback.wheel({ deltaY: -100 }, { scrollSpeed: 5 }, 0);
  assert.equal(audio.playing, false); assert.equal(visible, 10.06);
  const request = playback.toggle({}); resolvePreparation(); await request;
  assert.equal(audio.time, 10.06); assert.equal(audio.playing, true);
  playback.pause(); const delayed = playback.toggle({});
  playback.wheel({ deltaY: 100 }, { scrollSpeed: 5 }, 1); resolvePreparation(); await delayed;
  assert.equal(audio.playing, false); assert.equal(audio.time, 10);
  assert.ok(Math.abs(wheelSeconds(-100, 120, 5, 2, false, 0, true) - 0.6) < 1e-10);
});

test('滚轮起点默认覆盖音频零秒和谱面零拍，负延迟可退到初始化事件，关闭后可越界且偏好持久化', () => {
  const audio = { time: 0.01, duration: 120, rate: 1, pause() {}, seek(seconds) { this.time = seconds; } };
  const playback = new EditorPlayback(audio, { stop() {} }, () => {});
  const tempo = new TempoMap([{ startTime: [0, 0, 1], bpm: 120 }]); const settings = { scrollSpeed: 5 };
  assert.equal(migratePreferences().settings.wheelStopAtAudioStart, true);
  for (const offset of [0, 0.5, -0.003, -1.5]) for (const wheelInputMode of ['mouse', 'trackpad']) {
    const earliest = Math.min(0, offset), preferences = { ...settings, wheelInputMode };
    audio.time = earliest + .01; playback.wheel({ deltaY: 100 }, preferences, 1, offset);
    assert.equal(audio.time, earliest); assert.ok(Math.abs(tempo.beat(audio.time - offset) - (earliest - offset) * 2) < 1e-9);
    playback.wheel({ deltaY: 100, altKey: true }, preferences, 2, offset); assert.equal(audio.time, earliest);
    playback.wheel({ deltaY: 100 }, { ...preferences, wheelStopAtAudioStart: false }, 3, offset); assert.ok(audio.time < earliest);
    playback.wheel({ deltaY: 100 }, preferences, 4, offset); assert.equal(audio.time, earliest);
    playback.wheel({ deltaY: -100 }, preferences, 5, offset); assert.ok(audio.time > earliest);
  }
  audio.time = .01;
  playback.wheel({ deltaY: 100 }, { ...settings, wheelStopAtAudioStart: false }, 3);
  assert.ok(audio.time < 0);
  playback.wheel({ deltaY: 100 }, { ...settings, wheelStopAtAudioStart: true }, 4); assert.equal(audio.time, 0);
  for (const wheelStopAtAudioStart of [true, false]) {
    let saved; const storage = { setItem(key, value) { saved = value; }, getItem() { return saved; } };
    writeEditorPreferences({ wheelStopAtAudioStart }, storage);
    assert.deepEqual(readEditorPreferences(storage), { wheelStopAtAudioStart });
  }
});

test('滚轮步长不随谱面长度变化，保留两分钟基准、倍速、Alt 和连续滚动加速', () => {
  for (const duration of [0, 30, 120, 300, 1800]) {
    const audio = { time: 10, duration, rate: 1, pause() {}, seek(seconds) { this.time = seconds; } };
    const playback = new EditorPlayback(audio, { stop() {} }, () => {});
    playback.wheel({ deltaY: -100 }, { scrollSpeed: 5 }, 0);
    assert.equal(audio.time, 10.06);
    for (const rate of [0.5, 1, 2]) for (const alt of [false, true]) for (const accelerated of [false, true]) {
      assert.equal(wheelSeconds(-100, duration, 5, rate, accelerated, 2, alt), wheelSeconds(-100, 120, 5, rate, accelerated, 2, alt));
    }
  }
  assert.ok(Math.abs(wheelSeconds(100, 120, 5, 1) + 0.06) < 1e-10);
  assert.ok(Math.abs(wheelSeconds(-100, 120, 10, 1) - 0.12) < 1e-10);
});

test('鼠标模式逐项保留原有固定步长、速度、倍率、Alt 和连续加速，不凭像素单位切换行为', () => {
  const original = (delta, speed, rate, accelerated, seconds, alt) => -Math.sign(delta) * 120 / 1000000 * speed * rate * (alt ? 500 : 100) * (accelerated ? 1 + 4 * (Math.min(4, Math.max(0, seconds)) / 4) ** 3 : 1);
  for (const delta of [-800, -120, -100, -3, -0.25, 0.25, 3, 100, 120, 800]) {
    for (const deltaMode of [0, 1, 2]) for (const speed of [0.1, 5, 100]) for (const rate of [0.5, 1, 2]) for (const accelerated of [false, true]) for (const alt of [false, true]) for (const seconds of [0, 2, 4, 6]) {
      const expected = original(delta, speed, rate, accelerated, seconds, alt);
      assert.equal(wheelSeconds(delta, 120, speed, rate, accelerated, seconds, alt, deltaMode), expected);
      assert.equal(wheelSeconds(delta, 120, speed, rate, accelerated, seconds, alt, deltaMode, 'mouse'), expected);
    }
  }
  const audio = { time: 10, duration: 120, rate: 1, pause() {}, seek(seconds) { this.time = seconds; } };
  const playback = new EditorPlayback(audio, { stop() {} }, () => {});
  for (let index = 0; index <= 40; index++) playback.wheel({ deltaY: -120, deltaMode: 0 }, { scrollSpeed: 5, scrollAcceleration: true }, index / 10);
  const before = audio.time;
  playback.wheel({ deltaY: -120, deltaMode: 0 }, { scrollSpeed: 5, scrollAcceleration: true }, 4.1);
  assert.ok(Math.abs(audio.time - before - 0.3) < 1e-12);
  assert.equal(wheelSeconds(-40, 120, 5, 1, true, 4, false, 0, 'unknown'), wheelSeconds(-40, 120, 5, 1, true, 4));
});

test('触控板模式保留实际增量、小数惯性尾段及事件拆分一致性，不叠加连续加速', () => {
  const audio = { time: 10, duration: 120, rate: 1, pause() {}, seek(seconds) { this.time = seconds; } };
  const playback = new EditorPlayback(audio, { stop() {} }, () => {});
  const deltas = [-40, -20, -8, -2, -0.25];
  let previous = Infinity;
  for (const [index, deltaY] of deltas.entries()) {
    const before = audio.time;
    playback.wheel({ deltaY, deltaMode: 0 }, { scrollSpeed: 5, scrollAcceleration: true, wheelInputMode: 'trackpad' }, 4 + index * 0.016);
    const step = audio.time - before;
    assert.ok(step > 0 && step < previous); previous = step;
    assert.ok(Math.abs(step - Math.abs(deltaY) * 0.0006) < 1e-12);
  }
  const whole = wheelSeconds(-70.25, 120, 5, 1, false, 0, false, 0, 'trackpad');
  assert.ok(Math.abs(audio.time - 10 - whole) < 1e-12);
  assert.equal(wheelSeconds(-40, 120, 5, 1, true, 4, false, 0, 'trackpad'), wheelSeconds(-40, 120, 5, 1, false, 0, false, 0, 'trackpad'));
});

test('触控板模式换算像素、行、页单位，保留速度、倍速、Alt 和音频起点限制', () => {
  for (const [deltaMode, deltaY] of [[0, -100], [1, -6.25], [2, -0.125]]) {
    for (const duration of [0, 30, 120, 300, 1800]) for (const rate of [0.5, 1, 2]) for (const altKey of [false, true]) {
      const audio = { time: 10, duration, rate, pause() {}, seek(seconds) { this.time = seconds; } };
      const playback = new EditorPlayback(audio, { stop() {} }, () => {});
      playback.wheel({ deltaY, deltaMode, altKey }, { scrollSpeed: 5, wheelInputMode: 'trackpad', scrollAcceleration: true }, 0);
      assert.ok(Math.abs(audio.time - 10 - 0.06 * rate * (altKey ? 5 : 1)) < 1e-12);
      audio.time = 0.01; playback.wheel({ deltaY: -deltaY, deltaMode }, { scrollSpeed: 5, wheelInputMode: 'trackpad' }, 1); assert.equal(audio.time, 0);
      playback.wheel({ deltaY: -deltaY, deltaMode }, { scrollSpeed: 5, wheelInputMode: 'trackpad', wheelStopAtAudioStart: false }, 2); assert.ok(audio.time < 0);
    }
  }
});

test('零增量、纯横向和无效滚动不暂停播放或改变定位状态', () => {
  for (const wheelInputMode of ['mouse', 'trackpad']) {
    const audio = { time: 10, duration: 120, rate: 1, pause() { assert.fail('unexpected pause'); }, seek() { assert.fail('unexpected seek'); } };
    const playback = new EditorPlayback(audio, { stop() { assert.fail('unexpected stop'); } }, () => assert.fail('unexpected redraw'));
    for (const deltaY of [0, NaN, Infinity, -Infinity, undefined]) playback.wheel({ deltaX: 20, deltaY }, { scrollSpeed: 5, wheelInputMode }, 0);
    assert.equal(playback.lastWheel, -Infinity);
    assert.equal(playback.request, 0);
  }
});

test('滚动模式切换立即生效并重置连续加速，选项仅允许明确支持值且跨重载保存', () => {
  assert.equal(migratePreferences().settings.wheelInputMode, 'mouse');
  let stored;
  const storage = { getItem() { return stored; }, setItem(key, value) { stored = value; } };
  for (const wheelInputMode of ['mouse', 'trackpad']) {
    writeEditorPreferences({ wheelInputMode }, storage);
    assert.deepEqual(readEditorPreferences(storage), { wheelInputMode });
  }
  for (const wheelInputMode of ['auto', '', 'trackPad', null, 1]) {
    writeEditorPreferences({ wheelInputMode }, storage); assert.deepEqual(readEditorPreferences(storage), {});
  }
  const audio = { time: 10, duration: 120, rate: 1, pause() {}, seek(seconds) { this.time = seconds; } };
  const playback = new EditorPlayback(audio, { stop() {} }, () => {});
  for (let index = 0; index <= 40; index++) playback.wheel({ deltaY: -100 }, { scrollSpeed: 5, scrollAcceleration: true }, index / 10);
  let before = audio.time;
  playback.wheel({ deltaY: -20, deltaMode: 0 }, { scrollSpeed: 5, scrollAcceleration: true, wheelInputMode: 'trackpad' }, 4.1);
  assert.ok(Math.abs(audio.time - before - 0.012) < 1e-12);
  before = audio.time;
  playback.wheel({ deltaY: -20, deltaMode: 0 }, { scrollSpeed: 5, scrollAcceleration: true, wheelInputMode: 'mouse' }, 4.15);
  assert.ok(Math.abs(audio.time - before - 0.06) < 1e-12);
});

test('第二次空格能取消仍在准备的播放，按键重复不会产生隐式恢复', async () => {
  let ready;
  const audio = { playing: false, pause() { this.playing = false; }, async play() { this.playing = true; } };
  const playback = new EditorPlayback(audio, { stop() {}, prepare: () => new Promise(resolve => { ready = resolve; }) }, () => {});
  const first = playback.toggle({}); await playback.toggle({}); ready(); await first;
  assert.equal(audio.playing, false);
});

test('横线按秒映射跨 BPM，竖线奇偶和小数数量与吸附共享同一格点', () => {
  const tempo = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }, { bpm: 240, startTime: [4, 0, 1] }]);
  assert.equal(beatValue(snapTime(2.04, 4, tempo)), 4.25);
  assert.equal(snapPosition(35, 11), 0);
  assert.equal(Math.abs(snapPosition(0, 10)), 75);
  assert.equal(snapPosition(35, 11, false), 35);
  assert.equal(verticalGrid(3.5).spacing, 540);
  const { timeline } = editor(); timeline.tempo = tempo;
  assert.equal(timeline.scale, 500);
  assert.equal(timeline.vertical(3) - timeline.vertical(4), 250);
  assert.equal(timeline.vertical(4) - timeline.vertical(5), 125);
});

test('Hold 两次定位固定首次 X，反向放置排序，同拍不制造一拍 Hold', () => {
  const { session, timeline } = editor();
  timeline.cursor = { x: timeline.horizontal(135), y: timeline.vertical(4) };
  timeline.addAtCursor(2); assert.equal(session.notes.length, 0);
  timeline.cursor = { x: timeline.horizontal(405), y: timeline.vertical(2) };
  timeline.addAtCursor(2);
  assert.equal(session.notes[0].positionX, 135); assert.equal(beatValue(session.notes[0].startTime), 2); assert.equal(beatValue(session.notes[0].endTime), 4);
  timeline.addAtCursor(2); timeline.addAtCursor(2); assert.equal(session.notes.length, 1);
  timeline.addAtCursor(2); timeline.cancelPlacement(); assert.equal(session.notes.length, 1); assert.equal(timeline.pendingHold, null);
});

test('拖动实时值和落点一致，对未在网格上的音符吸附绝对目标而非位移', () => {
  const { session, timeline } = editor(); session.insertNotes([createNote(1, 2.1, 23)]);
  const start = { x: timeline.horizontal(23), y: timeline.vertical(2.1) };
  timeline.drag = { kind: 'move', anchor: 0, start, current: { x: start.x + 40, y: start.y - 15 } };
  const ghost = timeline.movedNote(session.notes[0]);
  assert.equal(ghost.positionX, 135); assert.equal(beatValue(ghost.startTime), 2.25);
  timeline.up({ clientX: start.x + 40, clientY: start.y - 15 });
  assert.deepEqual(session.notes[0], ghost); session.travel('undo'); assert.equal(session.notes[0].positionX, 23);
});

test('事件继承前一终值与缓动，拒绝冲突；两次定位不产生隐式一拍事件', () => {
  const { session, timeline } = editor();
  session.line.eventLayers[0].moveXEvents = [{ ...createEvent(5, 42, 0, 2), easingType: 7 }];
  const candidate = placedEvent(session, 'moveXEvents', 4, 2);
  assert.equal(candidate.start, 42); assert.equal(candidate.end, 42); assert.equal(candidate.easingType, 7);
  assert.throws(() => placedEvent(session, 'moveXEvents', 1, 3));
  assert.equal(placedEvent(session, 'moveXEvents', 2, 2), null);
  timeline.eventInteraction.place('moveXEvents', 2); assert.equal(session.line.eventLayers[0].moveXEvents.length, 1);
  timeline.eventInteraction.place('moveXEvents', 4, 3); assert.equal(session.line.eventLayers[0].moveXEvents.length, 2);
  assert.equal(session.line.eventLayers[0].moveXEvents[1].easingType, 3);
  const prefs = migratePreferences(); const key = { key: 'r' };
  assert.equal(shortcutAction(key, prefs, 'notes'), 'AddHold'); assert.equal(shortcutAction(key, prefs, 'events'), 'AddEvent');
});

test('打击特效 31 帧按谱面秒播放，缓动图来自数学函数，判定线用原尺寸', () => {
  assert.equal(hitFrame(0), 1); assert.equal(hitFrame(0.015), 2); assert.equal(hitFrame(0.45), 31); assert.equal(hitFrame(HIT_DURATION), null);
  assert.equal(DEFAULT_LINE_WIDTH, 4000); assert.equal(DEFAULT_LINE_HEIGHT, 5);
  assert.match(easingPicture(1), /<svg/); assert.notEqual(easingPicture(1), easingPicture(7)); assert.doesNotMatch(easingPicture(1), /img-|NaN/);
});

test('Y 缩放、网格、实时预览和音量跨关闭恢复，非法存储安全回退', () => {
  let value;
  const storage = { getItem() { return value; }, setItem(key, next) { value = next; } };
  const preferences = { scale: 333, division: 12, gridCount: 10, snapX: false, realtime: true, realtimeAlpha: 0.35, volume: 0.2 };
  writeEditorPreferences(preferences, storage); assert.deepEqual(readEditorPreferences(storage), preferences);
  value = '{broken'; assert.deepEqual(readEditorPreferences(storage), {});
});
