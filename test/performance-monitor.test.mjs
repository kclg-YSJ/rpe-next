import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { PerformanceSeries, PerformanceRun } from '../src/core/performance-monitor.mjs';
import { DEFAULT_HOTKEYS, shortcutAction } from '../src/core/preferences.mjs';
import { HOTKEY_LABELS, validateHotkeys } from '../src/core/hotkey-settings.mjs';
const { installPerformanceMonitor } = createRequire(import.meta.url)('../desktop/performance-monitor.cjs');

test('帧率按实际时间与绘制次数计算，低帧和绘制耗时独立统计', () => {
  const run = new PerformanceRun(0, { duration: 10 });
  for (let i = 0; i <= 60; i++) run.frame(i * 1000 / 60, 2);
  const result = run.finish(1000, 'complete', 10);
  assert.ok(Math.abs(result.averageFps - 60) < 1e-8); assert.equal(result.frames, 61); assert.equal(result.renderAverage, 2);
  assert.ok(Math.abs(result.lowFps - 60) < 1); assert.equal(result.reason, 'complete');
  assert.equal(result.metrics.gpu.average, null);
  const interrupted = run.finish(1100, 'interrupted', 4); assert.equal(interrupted.frames, 61); assert.equal(interrupted.position, 4);
  const slow = new PerformanceRun(0); slow.frame(0, 1); slow.frame(2000, 2); assert.equal(slow.finish(2000, 'complete').lowFps, .5);
});

test('硬件用量按时间加权，短暂采样与长间隔不扭曲平均值，缺失指标不伪造为零', () => {
  const run = new PerformanceRun(0);
  run.hardware(0, { appCpu: 10, appMemory: 100 }); run.hardware(1000, { appCpu: 30, gpu: 50 });
  const result = run.finish(3000, 'interrupted', 3);
  assert.equal(result.metrics.appCpu.average, 70 / 3); assert.equal(result.metrics.appCpu.peak, 30);
  assert.equal(result.metrics.appMemory.average, 100); assert.equal(result.metrics.gpu.average, 50); assert.equal(result.metrics.gpuMemory.average, null);
});

test('实时图和全程总览的样本内存有界，长测试保留开始到结束的趋势', () => {
  const series = new PerformanceSeries(3); for (let i = 0; i < 5; i++) series.push(i);
  assert.deepEqual(Array.from({ length: series.length }, (_, i) => series.at(i)), [2, 3, 4]); series.clear(); assert.equal(series.length, 0);
  const run = new PerformanceRun(0); for (let i = 0; i < 100000; i++) run.point(i / 4, 60);
  const result = run.finish(100000, 'complete'); assert.ok(result.points.length <= 513); assert.ok(result.points[0].seconds < 100); assert.ok(result.points.at(-1).seconds > 24000);
});

test('性能监控默认 F10，可通过现有快捷键配置更改且无默认冲突', () => {
  assert.equal(DEFAULT_HOTKEYS.PerformanceMonitor, 'F10'); assert.ok(HOTKEY_LABELS.PerformanceMonitor); assert.equal(validateHotkeys(DEFAULT_HOTKEYS).valid, true);
  assert.equal(shortcutAction({ key: 'F10' }, { hotkeys: DEFAULT_HOTKEYS }), 'PerformanceMonitor');
  assert.equal(shortcutAction({ key: 'm', ctrlKey: true, shiftKey: true }, { hotkeys: { ...DEFAULT_HOTKEYS, PerformanceMonitor: 'LEFTCTRL&LEFTSHIFT&M' } }), 'PerformanceMonitor');
});

test('桌面采样只在启用时创建工作线程，关闭后不再采样，旧线程数据和非法来源被拒绝', () => {
  const handlers = new Map(), workers = []; let reads = 0;
  const app = new EventEmitter(); app.getAppMetrics = () => { reads++; return [{ cpu: { percentCPUUsage: 10 }, memory: { workingSetSize: 2048 } }]; };
  const contents = { mainFrame: {} }; contents.mainFrame.url = 'rpe://app/index.html'; const event = { sender: contents, senderFrame: contents.mainFrame };
  const stop = installPerformanceMonitor({ app, ipcMain: { handle: (key, handler) => handlers.set(key, handler) }, origin: 'rpe://app', window: () => ({ webContents: contents }), createWorker: () => { const worker = new EventEmitter(); worker.postMessage = value => { worker.stopped = value === 'stop'; }; workers.push(worker); return worker; } });
  const call = action => handlers.get('rpen-performance')(event, action);
  assert.equal(workers.length, 0); assert.equal(call('sample'), null); assert.equal(reads, 0);
  assert.equal(call('start').appMemory, 2048 * 1024); assert.equal(workers.length, 1); assert.equal(reads, 1);
  call('sample'); assert.equal(reads, 1); stop(); assert.equal(workers[0].stopped, true); assert.equal(call('sample'), null);
  call('start'); workers[0].emit('message', { gpu: 99 }); assert.notEqual(call('sample')?.gpu, 99);
  assert.throws(() => handlers.get('rpen-performance')({ sender: {}, senderFrame: { url: 'https://bad/' } }, 'start'), /Forbidden/);
  stop();
});
