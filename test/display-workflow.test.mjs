import test from 'node:test';
import assert from 'node:assert/strict';
import { previewViewport, eventChains, simultaneousNotes, hitParticles, SPECIAL_TRACKS } from '../src/core/editor-display.mjs';
import { createChart, createEvent, createNote } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { Timeline } from '../src/ui/timeline.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { RpeSkin } from '../src/ui/skin.mjs';
import { AutoSaveClock } from '../src/application/autosave.mjs';
import { AudioTransport } from '../src/platform/audio.mjs';
import { assetBytes, resourceReferences, mediaType } from '../src/platform/files.mjs';
import { migratePreferences, shortcutAction, shortcutReleased } from '../src/core/preferences.mjs';

test('比例裁切按原 1350×900 基准，3:2 默认及宽高比例均不拉伸', () => {
  for (const ratio of [1.5, 16 / 9, 9 / 16]) {
    const view = previewViewport(900, 438, ratio);
    assert.ok(Math.abs(view.width / view.height - ratio) < 1e-9);
    assert.ok(view.left >= 0 && view.top >= 0);
  }
  assert.equal(previewViewport(900, 438).scale, 438 / 900);
});

test('连续事件跨值方向共享范围，时间间隙开始新段，保留原索引', () => {
  const chains = eventChains([createEvent(10, -20, 1, 2), createEvent(0, 10, 0, 1), createEvent(90, 90, 3, 4)]);
  assert.equal(chains.length, 2); assert.equal(chains[0].min, -20); assert.equal(chains[0].max, 10);
  assert.deepEqual(chains[0].entries.map(entry => entry.index), [1, 0]);
  assert.deepEqual(SPECIAL_TRACKS.map(track => track.key), ['scaleXEvents', 'scaleYEvents', 'colorEvents', 'paintEvents', 'textEvents']);
});

test('多押检测跨线和 BPM 倍率，选择状态不影响高亮', () => {
  const chart = createChart(); const other = structuredClone(chart.judgeLineList[0]); other.bpmfactor = 2;
  chart.judgeLineList[0].notes = [createNote(1, 2, 0), createNote(2, 3, 0, 4)];
  other.notes = [createNote(3, 1, 100)]; chart.judgeLineList.push(other);
  const simultaneous = simultaneousNotes(chart, new TempoMap(chart.BPMList));
  assert.equal(simultaneous.size, 2); assert.ok(simultaneous.has(other.notes[0]));
});

test('Hold 头尾沿身体边缘拼接，头尾宽度使用身体缩放基准', () => {
  const skin = new RpeSkin(() => {});
  for (const [name, width, height] of [['Hold', 100, 100], ['HoldHead', 120, 20], ['HoldEnd', 100, 10]]) skin.images.set(name, { name, naturalWidth: width, naturalHeight: height });
  const calls = []; const context = { save() {}, restore() {}, translate() {}, scale() {}, drawImage(...args) { calls.push(args); } };
  skin.hold(context, 100, 200, 50, 50);
  assert.deepEqual(calls.map(call => call.slice(1)), [[-25, -150, 50, 150], [-25, -155, 50, 5], [-30, 0, 60, 10]]);
});

test('粒子四个、原时长和指数扩散，定位采样结果确定', () => {
  const particles = hitParticles(0.2, 42, 175);
  assert.equal(particles.length, 4); assert.equal(particles[0].alpha, 0.7);
  assert.deepEqual(particles, hitParticles(0.2, 42, 175)); assert.deepEqual(hitParticles(2 / 3, 42, 175), []);
});

function canvas() { return { clientWidth: 500, clientHeight: 600, style: {}, addEventListener() {}, focus() {}, setPointerCapture() {}, getBoundingClientRect() { return { left: 0, top: 0 }; } }; }
test('合并多线音符命中绘制在当前线之外的目标线', () => {
  const chart = createChart(); chart.judgeLineList.push(structuredClone(chart.judgeLineList[0]));
  chart.judgeLineList[0].notes = [createNote(1, 1, 0)];
  chart.judgeLineList[1].notes = [createNote(1, 1, 0)];
  const session = new EditorSession(chart); session.setMultiLineEnabled(true); session.addMultiLine(1); session.selectLine(0);
  const timeline = new Timeline(canvas(), canvas(), () => session, () => {}, () => {}); timeline.origin = 0; timeline.scale = 144;
  const hit = timeline.hit({ x: timeline.noteHorizontal(0, 0), y: timeline.verticalForLine(1, 0) });
  assert.equal(hit.lineIndex, 1);
});

test('多线框选横向滚动时保留绝对起点', () => {
  const chart = createChart(); chart.judgeLineList.push(structuredClone(chart.judgeLineList[0]));
  const session = new EditorSession(chart); session.setMultiLineEnabled(true); session.addMultiLine(1); session.setMultiLineMerge(false);
  const timeline = new Timeline(canvas(), canvas(), () => session, () => {}, () => {}); timeline.multiLineWidth = 400;
  const start = { button: 0, shiftKey: true, clientX: 80, clientY: 380 };
  timeline.down(start); const initial = timeline.drag.startWorldX;
  timeline.multiLineScroll = 80; timeline.move({ clientX: 300, clientY: 420 });
  assert.equal(timeline.drag.startWorldX, initial);
  assert.equal(timeline.drag.currentWorldX, 380);
});

test('Shift 框选和左拖轨迹生效，右键保留给上下文菜单；Y 缩放不依赖 BPM', () => {
  const session = new EditorSession(); session.insertNotes([createNote(1, 2, 0)]); session.selection.clear();
  const timeline = new Timeline(canvas(), canvas(), () => session, () => {}, () => {});
  timeline.scale = 144;
  const start = { button: 0, shiftKey: true, clientX: 100, clientY: 380 };
  timeline.down(start); timeline.up(start); assert.equal(timeline.drag.kind, 'rectangle'); assert.equal(session.selection.size, 0);
  timeline.down({ button: 0, clientX: 400, clientY: 500 }); assert.equal(session.selection.size, 1);
  session.selection.clear(); timeline.down({ button: 0, clientX: 50, clientY: 400 }); timeline.move({ clientX: 400, clientY: 450 }); timeline.up({ clientX: 400, clientY: 450 }); assert.equal(session.selection.size, 1);
  timeline.down({ button: 2, clientX: 50, clientY: 400 }); timeline.up({ button: 2, clientX: 400, clientY: 450 }); assert.equal(session.selection.size, 1);
  timeline.scale = 333;
  for (const bpm of [60, 120, 240]) { timeline.tempo = new TempoMap([{ bpm, startTime: [0, 0, 1] }]); assert.equal(timeline.vertical(0) - timeline.vertical(bpm / 60), 333); }
});

test('事件编辑区左拖轨迹选择事件，拖动过程中不触发会话级重绘', () => {
  const chart = createChart();
  chart.judgeLineList[0].eventLayers[0] = { moveXEvents: [createEvent(0, 10, 0.5, 0.8)] };
  const session = new EditorSession(chart);
  const timeline = new Timeline(canvas(), canvas(), () => session, () => {}, () => {});
  timeline.eventRects = [{ type: 'moveXEvents', index: 0, x: 110, y: 350, width: 60, height: 100 }];
  let changes = 0; session.addEventListener('change', () => changes++);
  const interaction = timeline.eventInteraction;
  const point = (clientX, clientY) => ({ clientX, clientY, button: 0, pointerId: 1, preventDefault() {} });
  interaction.down(point(50, 500));
  const initialChanges = changes;
  interaction.move(point(120, 430));
  interaction.move(point(140, 380));
  for (let index = 0; index < 500; index++) interaction.move(point(140 + index % 2, 380));
  assert.equal(changes, initialChanges);
  assert.deepEqual([...session.eventSelection], ['moveXEvents:0']);
  assert.equal(session.multiSelectionIntent, 'events');
  interaction.up(point(140, 380));
  assert.equal(changes, initialChanges + 1);
});

test('音符划线实时选择但只在结束时通知面板，单物件仍保留多选意图', () => {
  const session = new EditorSession(); session.insertNotes([createNote(1, 0.5, 0)]); session.selection.clear();
  const timeline = new Timeline(canvas(), canvas(), () => session, () => {}, () => {});
  let changes = 0; session.addEventListener('change', () => changes++);
  const point = (clientX, clientY) => ({ clientX, clientY, button: 0, pointerId: 1 });
  const vertical = timeline.vertical(0.5);
  timeline.down(point(50, vertical)); const initialChanges = changes;
  timeline.move(point(250, vertical));
  for (let index = 0; index < 500; index++) timeline.move(point(250 + index % 2, vertical));
  assert.deepEqual([...session.selection], [0]);
  assert.equal(session.multiSelectionIntent, 'notes');
  assert.equal(changes, initialChanges);
  timeline.up(point(250, vertical));
  assert.equal(changes, initialChanges + 1);
  assert.equal(timeline.drag, null);
});

test('自动保存固定间隔而非输入防抖，并隔离并发写入', async () => {
  let saved = 0; let finish; const clock = new AutoSaveClock(() => { saved++; return new Promise(resolve => { finish = resolve; }); }, assert.fail);
  clock.reset(0); await clock.tick(59000, true, 60, true); assert.equal(saved, 0);
  const pending = clock.tick(60000, true, 60, true); assert.equal(saved, 0); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(saved, 1);
  await clock.tick(120000, true, 60, true); assert.equal(saved, 1);
  finish(); await pending; const next = clock.tick(120000, true, 60, true); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(saved, 2); finish(); await next;
});

test('资源回退处理大小写、相对路径、过期 META 及同名文件歧义', () => {
  const bytes = new Uint8Array([1]); const other = new Uint8Array([2]);
  const assets = new Map([['Song/Music.FLAC', bytes], ['other/Music.FLAC', other], ['Song/Cover.JPEG', bytes], ['Song/info.txt', new TextEncoder().encode('Chart: chart.json\nSong: ./Music.FLAC\nPicture: Cover.JPEG')]]);
  const chart = createChart(); chart.META.song = 'missing.mp3';
  assert.equal(assetBytes(assets, './music.flac', 'Song/chart.json'), bytes);
  assert.equal(assetBytes(assets, 'music.flac', 'unknown/chart.json'), null);
  assert.equal(resourceReferences(chart, assets, 'Song/chart.json').song, './Music.FLAC');
  assert.equal(mediaType('Cover.JPEG'), 'image/jpeg'); assert.equal(mediaType('Music.FLAC'), 'audio/flac');
  assets.set('Song/info.txt', new TextEncoder().encode('Chart: charts/chart.json\nSong: ./Music.FLAC\nPicture: Cover.JPEG'));
  assert.equal(resourceReferences(chart, assets, 'Song/charts/chart.json').song, 'Song/./Music.FLAC');
});

test('原预览快捷键包含恢复、跃进、从头和按住模式', () => {
  const preferences = migratePreferences();
  for (const [key, expected] of [['i', 'StartView'], ['o', 'EndView'], ['p', 'JumpView'], ['[', 'ReplayView'], ['t', 'StartView_HOLD'], ['u', 'JumpView_HOLD']]) assert.equal(shortcutAction({ key }, preferences), expected);
  assert.equal(shortcutReleased({ key: 'Shift' }, 'T'), false);
  assert.equal(shortcutReleased({ key: 'Control' }, 'LEFTCTRL&T'), true);
  assert.equal(shortcutReleased({ key: 't' }, 'LEFTCTRL&T'), true);
});

test('原生音频默认保调，切模式/倍速/定位保留真实媒体时钟', async () => {
  const original = globalThis.Audio;
  class Media {
    duration = 120; currentTime = 0; paused = true;
    set src(value) { queueMicrotask(() => this.onloadedmetadata()); }
    async play() { this.paused = false; }
    pause() { this.paused = true; }
    load() {} removeAttribute() {}
  }
  globalThis.Audio = Media;
  const node = { gain: { value: 1 }, connect() {}, disconnect() {} };
  const audio = new AudioTransport(() => ({ currentTime: 0, createGain: () => node, createMediaElementSource: () => node, async resume() {} }));
  try {
    await audio.load(new ArrayBuffer(4), 'song.flac'); assert.equal(audio.media.preservesPitch, true);
    audio.seek(12); await audio.play(); audio.media.currentTime = 13; assert.equal(audio.time, 13);
    audio.setRate(0.5); assert.equal(audio.media.currentTime, 13); assert.equal(audio.media.playbackRate, 0.5);
    audio.setPreservePitch(false); assert.equal(audio.media.preservesPitch, false); audio.pause(); assert.equal(audio.time, 13);
    audio.clear(); assert.equal(audio.media, null);
  } finally { globalThis.Audio = original; }
});

test('旧音乐的异步播放完成或失败不会暂停新谱面音乐', async () => {
  const original = globalThis.Audio;
  class Media {
    duration = 120; currentTime = 0; paused = true;
    set src(value) { queueMicrotask(() => this.onloadedmetadata()); }
    play() { this.paused = false; return this.pending ?? Promise.resolve(); }
    pause() { this.paused = true; }
    load() {} removeAttribute() {}
  }
  globalThis.Audio = Media;
  const node = { gain: { value: 1 }, connect() {}, disconnect() {} };
  const audio = new AudioTransport(() => ({ currentTime: 0, createGain: () => node, createMediaElementSource: () => node, async resume() {} }));
  try {
    for (const rejectOld of [false, true]) {
      await audio.load(new ArrayBuffer(4)); const oldMedia = audio.media; let finish;
      oldMedia.pending = new Promise((resolve, reject) => { finish = rejectOld ? () => reject(new Error('旧音乐中止')) : resolve; });
      const oldPlay = audio.play(); await Promise.resolve();
      await audio.load(new ArrayBuffer(4)); await audio.play(); finish(); await oldPlay;
      assert.equal(audio.playing, true); assert.equal(audio.media.paused, false); assert.equal(oldMedia.paused, true);
      audio.clear();
    }
  } finally { globalThis.Audio = original; }
});
