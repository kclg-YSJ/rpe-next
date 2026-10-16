import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { createChart } from '../src/core/chart.ts';
import { parseDocument } from '../src/core/formats.ts';
import { packageEntries, resourceReferences, assetBytes } from '../src/platform/files.ts';
import { readZip, crc32 } from '../src/platform/archive.ts';
import { AudioTransport } from '../src/platform/audio.ts';
import type { AudioContextLike, AudioBufferLike } from '../src/platform/audio.ts';

/**
 * The audio graph the tests build by hand. `AudioContextLike` is already the structural minimum the
 * transport drives, so the fixtures are annotated with it rather than with the real `AudioContext`.
 */
type DecoderRecord = { duration: number };
type ResumeRecord = () => void;

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: ArrayBufferView | ArrayBuffer): string => new TextDecoder().decode(bytes);

/** Reads an entry the fixture definitely wrote; a miss is a test-fixture bug, not a pass. */
function entryAt(entries: Map<string, Uint8Array>, path: string): Uint8Array {
  const bytes = entries.get(path);
  if (!bytes) throw new Error(`归档缺少 ${path}`);
  return bytes;
}

/** Pops the next parked resolver; every call site below follows a matching pending operation. */
function take<T>(queue: T[], label: string): T {
  const item = queue.shift();
  if (!item) throw new Error(`${label} 队列为空`);
  return item;
}

/** Pops the most recently parked resolver, for the "latest load wins" cases. */
function takeLast<T>(queue: T[], label: string): T {
  const item = queue.pop();
  if (!item) throw new Error(`${label} 队列为空`);
  return item;
}

test('转换导出只更新所属 info，保留原谱及同名文件', () => {
  const chart = createChart(); chart.rpeNextLegacySource = { text: 'original' };
  const assets = new Map([
    ['one/main.pec', encode('original')], ['one/main.rpe.json', encode('existing')],
    ['one/info.txt', encode('Name: 测试\r\nChart: main.pec\r\nSong: MUSIC.ogg')],
    ['two/info.txt', encode('Chart: other.json')], ['one/music.ogg', new Uint8Array([1])],
  ]);
  const output = packageEntries(chart, assets, 'one/main.pec');
  assert.equal(decode(entryAt(output, 'one/main.pec')), 'original');
  assert.equal(decode(entryAt(output, 'one/main.rpe.json')), 'existing');
  assert.match(decode(entryAt(output, 'one/info.txt')), /Chart: main\.rpe-1\.json\r\n/);
  assert.equal(output.get('two/info.txt'), assets.get('two/info.txt'));
  assert.equal(resourceReferences(chart, assets, 'one/main.pec').song, 'MUSIC.ogg');
  assert.deepEqual(assetBytes(assets, 'MUSIC.ogg', 'one/main.pec'), new Uint8Array([1]));
  delete chart.rpeNextLegacySource;
  assert.equal(packageEntries(chart, assets, 'one/main.json').get('one/info.txt'), assets.get('one/info.txt'));
});

test('官方 v3 转换遵循原版拍数、倍率和类型，保留原文档', () => {
  const line = { bpm: 120, notesAbove: [{ type: 3, time: 32, holdTime: 64, positionX: 2, speed: 9 }],
    notesBelow: [{ type: 2, time: 64, positionX: 0, speed: 2 }], speedEvents: [{ startTime: 0, endTime: 128, value: 2 }],
    judgeLineMoveEvents: [{ startTime: 0, endTime: 128, start: 0.5, end: 1, start2: 0.5, end2: 1 }] };
  const original = { formatVersion: 3, offset: 0.1, judgeLineList: [line, { ...line, bpm: 60 }] };
  const chart = parseDocument(JSON.stringify(original));
  assert.equal(chart.META.offset, 100);
  assert.equal(chart.judgeLineList[1].bpmfactor, 2);
  const converted = chart.judgeLineList[0];
  assert.deepEqual(converted.notes[0].startTime, [1, 0, 1]);
  assert.deepEqual(converted.notes[0].endTime, [3, 0, 1]);
  assert.equal(converted.notes[0].speed, 1);
  assert.equal(converted.notes[0].positionX, 150);
  assert.equal(converted.notes[1].type, 4);
  // `EventLayer` is a `Partial<Record<...>>`, so each track is optional; the converter always emits
  // `speedEvents`, and an absent one should fail the test loudly rather than pass vacuously.
  const speedEvents = converted.eventLayers[0].speedEvents;
  if (!speedEvents) throw new Error('转换结果缺少 speedEvents');
  assert.equal(speedEvents[0].start, 9);
  assert.deepEqual(chart.rpeNextLegacySource?.['document'], original);
});

test('DEFLATE 读取验证内容和 CRC，拒绝损坏数据', async () => {
  const content = encode('中文谱面资源'.repeat(100));
  const compressed = deflateRawSync(content);
  const name = encode('chart.json');
  const bytes = new Uint8Array(30 + name.length + compressed.length + 46 + name.length + 22);
  const view = new DataView(bytes.buffer);
  const central = 30 + name.length + compressed.length;
  const trailer = central + 46 + name.length;
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(8, 8, true);
  view.setUint16(26, name.length, true);
  bytes.set(name, 30); bytes.set(compressed, 30 + name.length);
  view.setUint32(central, 0x02014b50, true);
  view.setUint16(central + 10, 8, true);
  view.setUint32(central + 16, crc32(content), true);
  view.setUint32(central + 20, compressed.length, true);
  view.setUint32(central + 24, content.length, true);
  view.setUint16(central + 28, name.length, true);
  bytes.set(name, central + 46);
  view.setUint32(trailer, 0x06054b50, true);
  view.setUint16(trailer + 10, 1, true);
  view.setUint32(trailer + 16, central, true);
  assert.deepEqual((await readZip(bytes.buffer)).get('chart.json'), content);
  view.setUint32(central + 16, 0, true);
  await assert.rejects(readZip(bytes.buffer), /校验失败/);
});

test('异步音频解码及播放不越过切谱、暂停和末尾定位', async () => {
  // The stand-ins resolve when the test says so, so each pending decode/resume is parked with its
  // own resolver. `decoders`/`resumes` hold those resolvers; `starts` records `start()`'s arguments.
  const decoders: ((buffer: AudioBufferLike) => void)[] = [];
  const resumes: ResumeRecord[] = [];
  const starts: number[][] = [];
  const context: AudioContextLike = { currentTime: 0, destination: {},
    createGain: () => ({ gain: { value: 0 }, connect() { return undefined; } }),
    decodeAudioData: () => new Promise<AudioBufferLike>(resolve => decoders.push(resolve)),
    resume: () => new Promise<unknown>(resolve => resumes.push(resolve as ResumeRecord)),
    createBufferSource: () => ({ buffer: null, playbackRate: { value: 1 }, connect() { return undefined; }, stop() {}, disconnect() {}, start: (...args: number[]) => { starts.push(args); } }),
  };
  const audio = new AudioTransport(() => context);
  const oldLoad = audio.load(new ArrayBuffer(0));
  audio.clear();
  take(decoders, '解码')({ duration: 12 });
  assert.equal(await oldLoad, false);
  assert.equal(audio.buffer, null);
  const first = audio.load(new ArrayBuffer(0));
  const second = audio.load(new ArrayBuffer(0));
  takeLast(decoders, '解码')({ duration: 20 });
  assert.equal(await second, true);
  take(decoders, '解码')({ duration: 10 });
  assert.equal(await first, false);
  assert.equal(audio.duration, 20);
  const pending = audio.play(); audio.pause(); take(resumes, '恢复')(); await pending;
  assert.equal(audio.playing, false);
  const play = audio.play(); take(resumes, '恢复')(); await play;
  assert.equal(starts.length, 1);
  audio.seek(20);
  assert.equal(audio.playing, false);
  assert.equal(starts.length, 1);
});
