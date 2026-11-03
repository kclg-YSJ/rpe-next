import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioSources } from '../src/application/audio-sources.mjs';
import { sourceAudioRange } from '../src/core/audio-sources.mjs';
import { AgentCommands } from '../src/core/agent-commands.mjs';
import { createAgentEditorCommands } from '../src/application/agent-editor.mjs';
import { EditorSession } from '../src/application/session.mjs';

function buffer(channels, length, sampleRate = 12000) {
  const samples = Array.from({ length: channels }, () => new Float32Array(length)); return { sampleRate, length, duration: length / sampleRate, numberOfChannels: channels, getChannelData: index => samples[index] };
}
function audio(times, duration = 4) {
  const result = buffer(1, duration * 12000), samples = result.getChannelData(0);
  for (const seconds of times) for (let index = 0; index < 360; index++) samples[Math.round(seconds * result.sampleRate) + index] += .8 * Math.sin(2 * Math.PI * 2200 * index / result.sampleRate) * Math.exp(-index / 70);
  return result;
}
function fixture() {
  const original = audio([.4, 1, 2, 3]), stem = audio([.5, 1, 1.5], 2), context = { decodeAudioData: async () => stem, createBuffer: buffer }, transport = { buffer: original, ensureContext: () => context, setPlaybackBuffer: async value => { transport.playbackBuffer = value; }, resetPlaybackBuffer: () => { transport.playbackBuffer = transport.buffer; } };
  const separator = { bridge: {}, async separate(input, options, signal) { assert.equal(input, original); if (signal.aborted) throw new DOMException('Stopped', 'AbortError'); return { cacheId: 'cache', sources: [{ id: 'drums', frames: 24000, sampleRate: 12000, bytes: 20 }] }; }, async bytes() { return new Uint8Array(20); } };
  const sources = new AudioSources(() => transport, { separator }); return { original, stem, context, transport, sources, separator };
}

test('声部共用原音乐零点和延迟，选择临时改变播放，重置后恢复原音乐', async () => {
  const { original, transport, sources } = fixture(), id = await sources.import(new Uint8Array(4), 'vocals.wav');
  await sources.select(id); assert.equal(sources.selected, id); assert.equal(transport.buffer, original); assert.notEqual(transport.playbackBuffer, original); assert.equal(transport.playbackBuffer.duration, original.duration);
  assert.equal((await sources.resolveForAnalysis()).buffer, transport.playbackBuffer); assert.deepEqual(sourceAudioRange(await sources.resolveForAnalysis(), .25, 3.5), { startSeconds: .25, endSeconds: 3.5, offsetSeconds: 0 });
  assert.throws(() => sourceAudioRange(sources.entry(), -1, 2), /超出/); assert.equal(sources.list().find(entry => entry.id === id).offsetSeconds, 0); assert.equal(typeof sources.align, 'undefined');
  sources.reset(original); assert.deepEqual(sources.selectedIds, ['original']); assert.equal(transport.playbackBuffer, original); assert.equal(sources.list().length, 1);
  await sources.import(new Uint8Array(4), 'drums.wav'); transport.buffer = audio([1], 3); assert.equal(sources.list().length, 1); assert.equal(sources.entry().buffer, transport.buffer);
});

test('多选同刻叠加并补齐原音乐时长，不允许取消最后一项，移除选中声部保持其他选项', async () => {
  const { original, transport, sources } = fixture(), first = await sources.import(new Uint8Array(4), 'vocals.wav'), second = await sources.import(new Uint8Array(4), 'drums.wav');
  await sources.select([first, second]); assert.deepEqual(sources.selectedIds, [first, second]); assert.equal(sources.selected, 'selection');
  const selected = await sources.resolveSelection(); assert.equal(selected.buffer, transport.playbackBuffer); assert.deepEqual(selected.ids, [first, second]); assert.ok(selected.buffer.getChannelData(0)[12001] !== 0); assert.equal(selected.buffer.getChannelData(0)[40000], 0); assert.equal(transport.buffer, original);
  await assert.rejects(sources.select([]), /至少/); await sources.remove(first); assert.deepEqual(sources.selectedIds, [second]); await assert.rejects(sources.setSelected(second, false), /至少/);
  await sources.remove(second); assert.deepEqual(sources.selectedIds, ['original']); assert.equal(transport.playbackBuffer, original);
  for (let index = 0; index < 10; index++) await sources.import(new Uint8Array(4), 'stem' + index); assert.equal(new Set(sources.list().map(entry => entry.color)).size, sources.list().length);
});

test('并发选择只应用最后一次请求，切换失败保留旧音源，重置阻止迟到结果', async () => {
  const { original, sources, transport } = fixture(), first = await sources.import(new Uint8Array(4), 'first'), second = await sources.import(new Uint8Array(4), 'second');
  const pending = sources.select([first, second]), current = sources.select('original'); await assert.rejects(pending, { name: 'AbortError' }); await current; assert.equal(transport.playbackBuffer, original); assert.equal(sources.selecting, false);
  transport.setPlaybackBuffer = async () => { throw Error('media failure'); }; await assert.rejects(sources.select(first), /media failure/); assert.deepEqual(sources.selectedIds, ['original']); assert.equal(sources.pendingSelection, null);
  const request = sources.select(second); sources.reset(original); await assert.rejects(request, { name: 'AbortError' }); assert.deepEqual(sources.selectedIds, ['original']);
});

test('混合组合按集合缓存，切回或顺序相反时复用结果，退出和移除声部清理缓存', async () => {
  const { original, sources } = fixture(), first = await sources.import(new Uint8Array(4), 'first'), second = await sources.import(new Uint8Array(4), 'second');
  const mixed = await sources.select([first, second]); await sources.select('original'); const restored = await sources.select([second, first]); assert.equal(restored.buffer, mixed.buffer); assert.deepEqual(restored.ids, [second, first]);
  await sources.select(first); await sources.select(second); await sources.select([first, second]); assert.equal((await sources.resolveSelection()).buffer, mixed.buffer);
  await sources.remove(first); for (const key of sources.mixCache.keys()) assert.ok(!sources.mixCache.peek(key).members.some(member => member.id === first));
  sources.reset(original); assert.equal(sources.mixCache.size, 0); assert.equal(sources.mixCache.bytes, 0);
});

test('混音缓存有容量上限，重新分离同名声部不会复用过期混合', async () => {
  const { sources } = fixture(), first = await sources.import(new Uint8Array(4), 'first'), second = await sources.import(new Uint8Array(4), 'second'); sources.mixCache.maxBytes = 2 * 48000 * 4; sources.mixCache.maxEntries = 2;
  await sources.select(first); await sources.select(second); await sources.select([first, second]); assert.ok(sources.mixCache.bytes <= sources.mixCache.maxBytes); assert.ok(sources.mixCache.size <= 2);
  await sources.separate(); const before = await sources.select(['htdemucs/drums', second]); await sources.select('original'); await sources.separate(); const after = await sources.select(['htdemucs/drums', second]); assert.notEqual(after.buffer, before.buffer);
});

test('分离不替换音乐，懒加载共享解码，取消与换音乐不写入迟到结果', async () => {
  const { sources, original, transport, separator } = fixture(); let reads = 0; separator.bytes = async () => { reads++; return new Uint8Array(20); };
  const result = await sources.separate({ model: 'htdemucs' }); assert.equal(result.sources[0].id, 'htdemucs/drums'); assert.equal(transport.buffer, original); assert.equal(reads, 0);
  const [first, second] = await Promise.all([sources.resolve('drums'), sources.resolve('drums')]); assert.equal(first.buffer, second.buffer); assert.equal(reads, 1);
  let release; separator.separate = () => new Promise(resolve => { release = resolve; }); const pending = sources.separate(); transport.buffer = audio([1], 5); sources.sync(); release({ sources: [{ id: 'vocals', sampleRate: 12000, frames: 1 }] }); await assert.rejects(pending, /原音乐已变化/); assert.equal(sources.list().length, 1);
  const controller = new AbortController(); controller.abort(); separator.separate = async (input, options, signal) => { if (signal.aborted) throw new DOMException('Stopped', 'AbortError'); };
  await assert.rejects(sources.separate({}, controller.signal), { name: 'AbortError' }); assert.equal(sources.busy, false);
});

function separationResult(model, generation = 1) {
  const names = ['vocals', 'drums', 'bass', 'other', ...(model === 'htdemucs_6s' ? ['guitar', 'piano'] : [])];
  return { cacheId: `cache-${model}-${generation}`, sources: names.map(id => ({ id, frames: 24000, sampleRate: 12000, bytes: 20 })) };
}
test('重新分离整组替换旧结果，四六声部往返不叠加，保留导入声部和同类试听选择', async () => {
  const { sources, separator, transport, original } = fixture(); let generation = 0;
  separator.separate = async (input, options) => separationResult(options.model, ++generation);
  const imported = await sources.import(new Uint8Array(4), 'keep.wav');
  await sources.separate({ model: 'htdemucs' }); const oldDrums = sources.entry('htdemucs/drums');
  await sources.select(['htdemucs/drums', imported]); const beforeMix = await sources.resolveSelection();
  await sources.separate({ model: 'htdemucs_6s' });
  assert.equal(sources.list().filter(v => v.kind === 'separated').length, 6);
  assert.ok(sources.list().every(v => v.kind !== 'separated' || v.model === 'htdemucs_6s'));
  assert.deepEqual(sources.selectedIds, ['htdemucs_6s/drums', imported]); assert.notEqual((await sources.resolveSelection()).buffer, beforeMix.buffer);
  assert.equal(sources.isCurrent(oldDrums), false); assert.equal(sources.entry('htdemucs_6s/drums').color, oldDrums.color);
  for (const key of sources.mixCache.keys()) assert.ok(sources.mixCache.peek(key).members.every(v => v.kind !== 'separated' || v.model === 'htdemucs_6s'));
  await sources.select('htdemucs_6s/piano'); await sources.separate({ model: 'htdemucs' });
  assert.equal(sources.list().filter(v => v.kind === 'separated').length, 4); assert.deepEqual(sources.selectedIds, ['original']); assert.equal(transport.playbackBuffer, original);
  assert.ok(sources.entries.has(imported)); assert.ok(!sources.entries.has('htdemucs_6s/piano'));
  await sources.select(['htdemucs/vocals', imported]); const old = sources.entry('htdemucs/vocals'); await sources.separate({ model: 'htdemucs', shifts: 4 });
  assert.equal(sources.list().filter(v => v.kind === 'separated').length, 4); assert.notEqual(sources.entry('htdemucs/vocals'), old); assert.deepEqual(sources.selectedIds, ['htdemucs/vocals', imported]);
});

test('新分离计算失败、试听准备失败或取消时，保留原结果和播放；不暴露半套新声部', async () => {
  const { sources, separator, transport } = fixture(); separator.separate = async (input, options) => separationResult(options.model);
  await sources.separate({ model: 'htdemucs' }); await sources.select('htdemucs/vocals');
  const entries = sources.entries, selection = sources.selectedIds, playback = transport.playbackBuffer;
  const same = () => { assert.equal(sources.entries, entries); assert.deepEqual(sources.selectedIds, selection); assert.equal(transport.playbackBuffer, playback); assert.equal(sources.replacing, false); };
  separator.separate = async () => { throw Error('separation failure'); }; await assert.rejects(sources.separate({ model: 'htdemucs_6s' }), /separation failure/); same();
  separator.separate = async (input, options) => separationResult(options.model);
  const apply = transport.setPlaybackBuffer; transport.setPlaybackBuffer = async () => { throw Error('prepare failure'); };
  await assert.rejects(sources.separate({ model: 'htdemucs_6s' }), /prepare failure/); same(); transport.setPlaybackBuffer = apply;
  let release; separator.bytes = async () => new Promise(resolve => { release = resolve; });
  const controller = new AbortController(), pending = sources.separate({ model: 'htdemucs_6s' }, controller.signal);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal(sources.entries, entries); assert.equal(sources.replacing, true);
  await assert.rejects(sources.select('original'), /声部分离/); controller.abort(); release(new Uint8Array(20)); await assert.rejects(pending, { name: 'AbortError' }); same();
});

test('重新分离不会因同名旧缓冲或未完成的选择请求而复用过期声部', async () => {
  const { sources, separator } = fixture(); separator.separate = async (input, options) => separationResult(options.model);
  await sources.separate({ model: 'htdemucs' });
  let release; separator.bytes = async () => new Promise(resolve => { release = resolve; });
  const selecting = sources.select('htdemucs/vocals'); selecting.catch(() => {});
  while (!release) await new Promise(resolve => setImmediate(resolve));
  separator.bytes = async () => new Uint8Array(20);
  await sources.separate({ model: 'htdemucs_6s' }); release(new Uint8Array(20)); await assert.rejects(selecting, { name: 'AbortError' });
  assert.deepEqual(sources.selectedIds, ['htdemucs_6s/vocals']); assert.ok(sources.isCurrent(await sources.resolveSelection()));
});

test('声部和多选混音采音只应用一次谱面延迟及线倍率，选区变化使审批失效', async () => {
  const { original, transport, sources } = fixture(), id = await sources.import(new Uint8Array(4), 'drums.wav');
  const session = new EditorSession(); session.chart.META.offset = 250; session.chart.judgeLineList[0].bpmfactor = 2;
  const editor = { session, get chart() { return session.chart; }, hasDocument: true, audio: transport, audioSources: sources, timeline: { layer: 0 }, currentBeat: () => 0, chartSeconds: () => 0, noiseEditor: { selected: -1, selection: new Set() }, globalEvents: { document: { types: [] } }, assets: new Map(), commit: (label, chart) => session.commit(label, chart) };
  const commands = new AgentCommands(), adapter = createAgentEditorCommands(commands, editor), execute = (name, args, context = {}) => commands.execute(name, args, { permission: 'full', ...context });
  const analyzed = (await execute('audio_analyze', { source: id, start: .1, end: 1.7, line: 0, minGap: .06 })).result;
  for (const expected of [.25, .75, 1.25]) assert.ok(analyzed.peaks.some(peak => Math.abs(peak.beat - expected) < .03), JSON.stringify(analyzed.peaks));
  const args = { revision: adapter.revision(), source: id, line: 0, start: .1, end: 1.7, division: 4, quantization: 'none' };
  const generated = await execute('audio_taps', args); assert.ok(generated.result.added >= 3); assert.equal(transport.buffer, original); session.travel('undo');
  await assert.rejects(execute('audio_taps', { ...args, revision: adapter.revision() }, { permission: 'ask', approve: async () => { await sources.select(id); return true; } }), /状态已变化/); assert.equal(session.notes.length, 0);
  await execute('audio_source', { action: 'select', sources: ['original', id] }); assert.equal(sources.selection.size, 2); const mixed = (await execute('audio_analyze', { start: .1, end: 1.7, line: 0 })).result; assert.equal(mixed.source.id, 'selection'); assert.deepEqual(mixed.source.ids, ['original', id]);
  await assert.rejects(execute('audio_analyze', { source: 'unknown', start: 0, end: 2 }), /不存在/);
});
