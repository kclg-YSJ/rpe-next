import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AgentCommands } from '../src/core/agent-commands.mjs';
import { createAgentEditorCommands } from '../src/application/agent-editor.mjs';
import { AGENT_CHART_TOOLS } from '../src/application/agent-chart-tools.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { createEvent, createNote } from '../src/core/chart.mjs';
import { compileTrajectory } from '../src/core/curve-trajectory.mjs';
import { SceneRuntime } from '../src/core/scene.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { Timeline } from '../src/ui/timeline.mjs';
import { noiseRuntime } from '../src/core/noise-areas.mjs';
import { GlobalEventRegistry, registerPlaceholderGlobalEvent } from '../src/core/global-events.mjs';
import { GlobalEventDocument } from '../src/application/global-events.mjs';
import { ChartRepository } from '../src/application/chart-vcs.mjs';
import { createMemoryVersionStore } from '../src/platform/version-store.mjs';

function fixture(options = {}) {
  const session = new EditorSession(), commands = new AgentCommands(), registry = new GlobalEventRegistry(); registerPlaceholderGlobalEvent(registry);
  const editor = { session, get chart() { return session.chart; }, hasDocument: true, currentBeat: () => 12, chartSeconds: () => 6, audio: {}, assets: new Map(), timeline: { layer: 0, division: 4 }, noiseEditor: { selection: new Set(), selected: -1 }, globalEvents: { document: new GlobalEventDocument(registry, () => session) }, commit: (label, chart) => session.commit(label, chart) };
  const adapter = createAgentEditorCommands(commands, editor, options);
  const execute = (name, args, context = {}) => commands.execute(name, args, { permission: 'full', ...context });
  return { editor, session, commands, adapter, execute, registry };
}

test('谱面工具目录覆盖所有原生入口且列出的直接命令均可调用，拒绝错误的联合类型', async () => {
  const { commands, execute, adapter } = fixture(), html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const section = html.match(/<section data-panel="chart">([\s\S]*?)<\/section>/)[1], buttons = [...section.matchAll(/<button id="([^"]+)"/g)].map(match => match[1]);
  for (const id of buttons) assert.ok(AGENT_CHART_TOOLS.some(tool => tool.id === id), id);
  for (const tool of AGENT_CHART_TOOLS) for (const name of tool.commands) assert.ok(commands.entries.has(name), name);
  const listed = await execute('chart_tools', {}, { permission: 'ask', approve: () => assert.fail('只读无需批准') }); assert.equal(listed.result.length, AGENT_CHART_TOOLS.length);
  await assert.rejects(execute('text_fit', { revision: adapter.revision(), text: 'A', beat: 1, lines: { invalid: true } }), /参数类型/);
  await assert.rejects(execute('multi_line', { lines: [-1] }), /参数类型/);
  await assert.rejects(execute('multi_line', { lines: '0:999999999999' }), /超出/);
});

test('多线命令保留动态表达式和空结果，静态改选结束动态筛选且拒绝超大线号范围', async () => {
  const {editor,session,execute}=fixture();const canvas={clientWidth:600,clientHeight:600,style:{},addEventListener(){}};
  editor.timeline=new Timeline(canvas,canvas,()=>session,()=>{},()=>{});
  await assert.rejects(execute('multi_line',{lines:'0:999999999999'}),/超出/);
  await execute('multi_line',{lines:'@notes',mode:'events'});assert.equal(session.multiLineActive,true);assert.deepEqual(session.multiLineIndices,[]);assert.equal(session.multiLineExpression,'@notes');
  await execute('multi_line',{mode:'notes'});assert.equal(session.multiLineExpression,'@notes');
  await execute('multi_line',{lines:[0]});assert.equal(session.multiLineExpression,'');assert.deepEqual(session.multiLineIndices,[0]);
});

test('原生参数方程和极坐标轨迹可生成、编辑、拆分并撤销；已有事件默认不覆盖，替换需批准', async () => {
  const { session, execute, adapter } = fixture(), original = session.chart;
  const listed = await execute('trajectory_presets', { query: '螺线' }); assert.ok(listed.result.some(entry => entry.id === 'spiral'));
  const args = { revision: adapter.revision(), line: 0, layer: 1, start: '4:1/2', end: 9, options: { xExpression: '300*t', yExpression: '100*sin(2*pi*t)', parameterStart: '0', parameterEnd: '1', tangentRotation: true } };
  let asked = 0; const denied = await execute('trajectory_generate', args, { permission: 'ask', approve: () => { asked++; return false; } }); assert.equal(denied.denied, true); assert.equal(session.chart, original); assert.equal(asked, 1);
  await execute('trajectory_generate', args); const trajectory = session.chart.judgeLineList[0].eventLayers[1].moveXEvents[0]; assert.ok(trajectory.trajectory); assert.deepEqual(trajectory.startTime, [4, 1, 2]);
  const scene = new SceneRuntime(), tempo = new TempoMap(session.chart.BPMList); scene.compile(session.chart, tempo);
  const actual = scene.sample(tempo.seconds(6.75))[0], expected = compileTrajectory(trajectory.trajectory.options)(.5); assert.ok(Math.abs(actual.x - expected.x) < 1e-7); assert.ok(Math.abs(actual.y - expected.y) < 1e-7);
  await execute('trajectory_split', { revision: adapter.revision(), line: 0, layer: 1, eventIndex: 0, settings: { segments: 32, simplify: false } }); assert.equal(session.chart.judgeLineList[0].eventLayers[1].moveXEvents.length, 32);
  session.travel('undo'); assert.equal(session.chart.judgeLineList[0].eventLayers[1].moveXEvents[0], trajectory); session.travel('undo'); assert.equal(session.chart, original);
  await assert.rejects(execute('trajectory_generate', { ...args, revision: adapter.revision(), layer: 0, start: 0, end: .5 }), /已有/);
  const replaced = await execute('trajectory_generate', { revision: adapter.revision(), line: 0, start: 0, end: .5, preset: 'circle', options: { parameters: { radius: 50 } }, replace: true }, { permission: 'dangerous', approve: plan => { assert.equal(plan.access, 'dangerous'); return false; } }); assert.equal(replaced.denied, true); assert.equal(session.chart, original);
  await execute('trajectory_generate', { revision: adapter.revision(), line: 0, layer: 1, start: 8, end: 12, preset: 'circle', options: { parameters: { radius: 50 } }, output: 'events', split: { segments: 16, simplify: false } }); assert.equal(session.chart.judgeLineList[0].eventLayers[1].moveXEvents.length, 16);
});

test('曲线音符沿用原生缓动与端点规则，追踪噪域与真实父线/倍率位置一致且一次撤销', async () => {
  const { execute, adapter, session } = fixture();
  const made = await execute('curve_notes', { revision: adapter.revision(), line: 0, start: 2, end: 4, startX: -100, endX: 100, type: 1, division: 4, density: 1, easingType: 2 }); assert.equal(made.result.count, 7); assert.equal(session.notes.length, 7); assert.ok(session.notes.every(note => note.type === 1));
  const source = session.chart; session.chart.judgeLineList[0].eventLayers[0].moveYEvents = [createEvent(0, 200, 0, 8)];
  await execute('noise_track', { revision: adapter.revision(), start: 1, end: 3, target: { mode: 'line', lineIndex: 0 }, width: 50, height: 30 });
  const area = session.chart.blockAreaList[0], tempo = new TempoMap(session.chart.BPMList), runtime = noiseRuntime(area, tempo), scene = new SceneRuntime(); scene.compile(session.chart, tempo);
  for (const beat of [1, 1.5, 2.75]) { const seconds = tempo.seconds(beat), expected = scene.sample(seconds)[0], actual = runtime.sample(seconds).center; assert.ok(Math.abs(actual.x - expected.x) < .21); assert.ok(Math.abs(actual.y - expected.y) < .21); }
  session.travel('undo'); assert.equal(session.chart, source); assert.equal(session.chart.blockAreaList?.length ?? 0, 0);
});

test('音符追踪命令使用同一拟合和原子提交，覆盖已有事件属于危险编辑', async () => {
  const { session, adapter, execute } = fixture(); session.insertNotes([createNote(1, 4, 135)]);
  const args = { revision: adapter.revision(), start: 0, end: 4, target: { lineIndex: 0, noteIndex: 0 }, line: -1, rotation: false };
  const before = session.chart; const denied = await execute('note_track', args, { permission: 'ask', approve: () => false }); assert.equal(denied.denied, true); assert.equal(session.chart, before);
  const generated = await execute('note_track', args); assert.equal(generated.ok, true); assert.equal(session.chart.judgeLineList.length, 2);
  assert.equal(session.chart.judgeLineList[1].eventLayers[0].rotateEvents.length, 1);
  let access; await execute('note_track', { ...args, revision: adapter.revision(), line: 0, replace: true }, { permission: 'dangerous', approve: plan => { access = plan.access; return false; } }); assert.equal(access, 'dangerous');
  session.travel('undo'); assert.equal(session.chart, before);
});

test('音符追踪省略目标时使用当前判定线和当前事件层，不新增判定线', async () => {
  const { session, editor, adapter, execute } = fixture(); session.addLine(); session.selectLine(1); editor.timeline.layer = 2;
  session.insertNotes([createNote(1, 4, 135)]);
  const before = session.chart, generated = await execute('note_track', { revision: adapter.revision(), start: 0, end: 4, target: { lineIndex: 1, noteIndex: 0 } });
  assert.equal(generated.ok, true); assert.equal(session.chart.judgeLineList.length, 2); assert.equal(generated.result.line, 1); assert.equal(generated.result.layer, 2);
  assert.ok(session.chart.judgeLineList[1].eventLayers[2].moveXEvents.length > 0); assert.ok(session.chart.judgeLineList[1].eventLayers[2].rotateEvents.length > 0);
  assert.equal(session.chart.judgeLineList[0], before.judgeLineList[0]); assert.equal(session.chart.judgeLineList[1].eventLayers[0], before.judgeLineList[1].eventLayers[0]);
  session.travel('undo'); assert.equal(session.chart, before);
});

test('图案拟合走分析/批准/原子提交，文字未达标不写谱，异步计算期间的修改使旧计划失效', async () => {
  let reached = true, duringFit;
  const patterns = { noiseRaster: async () => ({ pixels: new Uint8ClampedArray(16), width: 2, height: 2 }), textRaster: async () => ({ mask: new Uint8Array(4), width: 2, height: 2, length: 2, thickness: 1, scale: 1 }), fit: async kind => { duringFit?.(); return kind === 'noise' ? { width: 2, height: 2, rectangles: [{ x: 0, y: 0, width: 1, height: 2 }, { x: 1, y: 1, width: 1, height: 1 }] } : { passed: reached, error: reached ? .1 : .9, skeletonCoverage: reached ? 1 : .1, strokes: [{ x: 1, y: 1, angle: 0 }] }; } };
  const { execute, adapter, session, editor } = fixture({ patterns }), original = session.chart;
  const noise = { revision: adapter.revision(), mode: 'text', text: 'A', first: 4, last: 8, duration: 2, width: 400, active: true, easingType: 2 };
  const preview = await execute('noise_fit', { ...noise, analyzeOnly: true }, { permission: 'ask', approve: () => assert.fail('只分析不应批准') }); assert.equal(preview.result.count, 2); assert.equal(session.chart, original);
  await execute('noise_fit', noise); assert.equal(session.chart.blockAreaList.length, 2); session.travel('undo'); assert.equal(session.chart, original);
  const text = { revision: adapter.revision(), text: 'A', lines: [0], beat: 8, addNotes: true, replace: true };
  reached = false; const rejected = await execute('text_fit', text); assert.equal(rejected.result.generated, false); assert.equal(session.chart, original);
  reached = true; const denied = await execute('text_fit', text, { permission: 'dangerous', approve: () => false }); assert.equal(denied.denied, true); assert.equal(session.chart, original);
  await execute('text_fit', text); assert.equal(session.notes.length, 1); assert.equal(session.notes[0].isFake, 1); session.travel('undo'); assert.equal(session.chart, original);
  duringFit = () => { session.commit('user edit', { ...session.chart, META: { ...session.chart.META, name: 'user' } }); };
  await assert.rejects(execute('noise_fit', noise), /状态已变化/); assert.equal(session.chart.META.name, 'user'); assert.equal(session.chart.blockAreaList?.length ?? 0, 0);
  session.travel('undo'); editor.preview = { noteSize: 175 }; duringFit = () => { editor.preview.noteSize = 200; };
  await assert.rejects(execute('text_fit', { ...text, revision: adapter.revision() }), /状态已变化/); assert.equal(session.chart, original);
  editor.noiseFitPanel = { bitmap: {} }; duringFit = () => { editor.noiseFitPanel.bitmap = {}; };
  await assert.rejects(execute('noise_fit', { ...noise, revision: adapter.revision(), mode: 'image' }), /状态已变化/); assert.equal(session.chart, original);
});

test('全局事件沿用模组来源和原生撤销，临时占位不写谱；多线和波形只改变工作区并遵守批准', async () => {
  const { execute, adapter, session, editor, registry } = fixture(); const original = session.chart;
  const owner = { kind: 'mod', id: 'test', name: 'Test', author: 'Writer', version: '1' }; registry.register({ id: 'wind', name: 'Wind', columns: [{ id: 'x', name: 'X' }] }, owner);
  await execute('global_events', { action: 'replace', revision: adapter.revision(), type: 'rpen/placeholder', column: 'value', events: [createEvent(0, 1, 2, 4)] }); assert.equal(session.chart, original); assert.equal(editor.globalEvents.document.read('rpen/placeholder', 'value').length, 1); session.travel('undo'); assert.equal(editor.globalEvents.document.read('rpen/placeholder', 'value').length, 0);
  await execute('global_events', { action: 'replace', revision: adapter.revision(), type: 'test/wind', column: 'x', events: [createEvent(1, 3, 2, 4)] }); assert.deepEqual(session.chart.globalEvents.types['test/wind'].source, owner); session.travel('undo'); assert.equal(session.chart, original);
  const blocked = await execute('multi_line', { lines: [0], mode: 'events' }, { permission: 'ask', approve: () => false }); assert.equal(blocked.denied, true); assert.equal(session.multiLineEnabled, false);
  await execute('multi_line', { lines: [0], mode: 'events', width: 240 }); assert.equal(session.multiLineMode, 'events'); assert.equal(editor.timeline.multiLineEventWidth, 240); assert.equal(session.chart, original);
  editor.audioAnalysis = { enabled: false, mode: 'waveform', alpha: .2, width: .62, onChange() {}, draw() {} };
  await execute('audio_view', { mode: 'spectrum', enabled: true, alpha: .4 }); assert.equal(editor.audioAnalysis.mode, 'spectrum'); assert.equal(session.chart, original);
});

test('版本查询不自动初始化，暂存提交和分支操作直接调用原生仓库且关键写入需批准', async () => {
  const { execute, adapter, session, editor } = fixture(); let initializations = 0;
  const panel = editor.versionControl = { context: { getRepoId: () => 'test' }, actions: {}, snapshot: () => ({ chart: session.chart, assets: editor.assets, folders: [], chartName: 'chart.json' }), async ensure() { initializations++; this.repoId = 'test'; this.repo = new ChartRepository(createMemoryVersionStore(), 'test'); await this.repo.init(); await this.repo.stage(this.snapshot()); await this.repo.commit({ message: 'initial' }); }, async refresh() { this.state = await this.repo.status(this.snapshot()); } };
  assert.equal((await execute('version_control', { action: 'status' })).result.initialized, false); assert.equal(initializations, 0);
  const denied = await execute('version_control', { action: 'initialize', revision: adapter.revision() }, { permission: 'ask', approve: () => false }); assert.equal(denied.denied, true); assert.equal(initializations, 0);
  await execute('version_control', { action: 'initialize', revision: adapter.revision() }); assert.equal(initializations, 1);
  session.commit('edit', { ...session.chart, META: { ...session.chart.META, name: 'versioned' } });
  await execute('version_control', { action: 'stage', revision: adapter.revision() }); await execute('version_control', { action: 'commit', revision: adapter.revision(), message: 'AI changes' });
  const log = await execute('version_control', { action: 'log' }); assert.equal(log.result.commits.length, 2); assert.ok(log.result.commits.some(commit => commit.message === 'AI changes'));
  await execute('version_control', { action: 'branch_create', revision: adapter.revision(), name: 'example' });
  const blocked = await execute('version_control', { action: 'branch_delete', revision: adapter.revision(), name: 'example' }, { permission: 'dangerous', approve: () => false }); assert.equal(blocked.denied, true); assert.ok((await execute('version_control', { action: 'refs' })).result.branches.example);
  await assert.rejects(execute('version_control', { action: 'stage', revision: adapter.revision() }, { permission: 'ask', approve: () => { editor.assets.set('new.bin', new Uint8Array([1])); return true; } }), /状态已变化/);
  const folders = new Set(); panel.snapshot = () => ({ chart: session.chart, assets: editor.assets, folders, chartName: 'chart.json' });
  await assert.rejects(execute('version_control', { action: 'stage', revision: adapter.revision() }, { permission: 'ask', approve: () => { folders.add('new folder'); return true; } }), /状态已变化/);
});

test('音频增加静音必须批准且绑定原始音频版本，完成不自动进入可撤销谱面历史', async () => {
  let calls = 0; const { execute, adapter, editor, session } = fixture({ prependSilence: async options => { calls++; assert.equal(options.seconds, 2); return { applied: true, undoable: false, offsetUnchanged: true, needsSave: true }; } });
  editor.audio.buffer = {}; editor.audio.loadRevision = 1;
  const args = { revision: adapter.revision() }; await execute('audio_prepend_silence', args, { permission: 'dangerous', approve: () => false }); assert.equal(calls, 0);
  await assert.rejects(execute('audio_prepend_silence', args, { permission: 'ask', approve: () => { editor.audio.loadRevision++; return true; } }), /状态已变化/); assert.equal(calls, 0);
  const result = await execute('audio_prepend_silence', args); assert.equal(result.result.applied, true); assert.equal(calls, 1); assert.equal(session.history.undoStack.length, 0);
});
