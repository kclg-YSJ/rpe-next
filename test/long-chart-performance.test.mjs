import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeGuides } from '../src/core/preview-guides.mjs';
import { EventTrack } from '../src/core/events.mjs';
import { createChart, createEvent } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { upperBound } from '../src/core/beat.mjs';
import { PerformanceFrameWindow } from '../src/core/performance-monitor.mjs';

const reference = (guides, scale, enabled = true) => {
  const groups = [];
  for (const guide of guides) {
    const group = enabled && groups.find(candidate => Math.hypot(candidate.x - guide.x, candidate.y - guide.y) < 10 * scale && Math.abs(candidate.rotation - guide.rotation) < .01);
    if (group) group.indices.push(guide.index); else groups.push({ ...guide, indices: [guide.index] });
  }
  return groups;
};
test('空间索引合并数千条判定线保留首个锚点和输入顺序，包含相邻网格、负坐标和非传递重合', () => {
  let seed = 1; const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 2 ** 32;
  for (const scale of [.001, .1, .333, 1, 4]) {
    const guides = Array.from({ length: 1800 }, (_, index) => ({ index, x: Math.round(random() * 40 - 20) * scale * 10 + random() * scale,
      y: Math.round(random() * 40 - 20) * scale * 10 + random() * scale, rotation: Math.round(random() * 10 - 5) * .01 + (random() - .5) * .001 }));
    guides.unshift({ index: 2000, x: 0, y: 0, rotation: 0 }, { index: 2001, x: 18 * scale, y: 0, rotation: 0 }, { index: 2002, x: 9 * scale, y: 0, rotation: 0 });
    assert.deepEqual(mergeGuides(guides, scale), reference(guides, scale));
    assert.deepEqual(mergeGuides(guides, scale, false), reference(guides, scale, false));
  }
});
test('事件游标在重复起拍、正放、倒放、取样回跳和区间外时与二分查询一致', () => {
  const tempo = new TempoMap(createChart().BPMList), events = Array.from({ length: 2000 }, (_, i) => ({ ...createEvent(i, i + 2, Math.floor(i / 2), Math.floor(i / 2) + 1), easingType: i % 29 + 1 }));
  const actual = new EventTrack(events, tempo);
  for (const time of [-1, 0, .001, 5, 5.05, 5.1, 600, 480, 481, 5, 5.01, 2, -2, Infinity, NaN]) {
    const entry = actual.events[Math.max(0, upperBound(actual.events, time, e => e.start) - 1)];
    assert.deepEqual(actual.value(time), actual.sample(entry, time));
  }
});
test('恒定165Hz绘制不因250ms显示刷新与帧相位不同而形成虚假波峰波谷，真实慢帧保留', () => {
  const window = new PerformanceFrameWindow(); let next = 0;
  for (let now = 250; now < 5000; now += 250) {
    while (next < now) { window.frame(next, .5); next += 1000 / 165; }
    assert.ok(Math.abs(window.sample().fps - 165) < 1e-8);
  }
  window.frame(next + 100, .5); const slow = window.sample(); assert.ok(slow.fps < 20); assert.equal(slow.peak, .5);
  assert.equal(window.sample().fps, null); window.frame(20000, .5); assert.equal(window.sample().fps, null);
  window.frame(20000 + 1000 / 165, .5); assert.ok(Math.abs(window.sample().fps - 165) < 1e-8);
});
