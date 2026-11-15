import test from 'node:test';
import assert from 'node:assert/strict';
import { drawSamplingGrid } from '../src/ui/sampling-guides.mjs';
import { snapSamplePoint } from '../src/core/sampling-grid.mjs';
import { samplingPreferences, saveSamplingPreferences } from '../src/platform/sampling-preferences.mjs';

test('incremental sampling grid and snapping share the same world origin and aspect scale', () => {
  const previous = { ...samplingPreferences() };
  try {
    saveSamplingPreferences({ coordinates: 'delta', objectSnap: false, gridSnap: true, grid: true });
    for (const scale of [.4, 1, 2]) {
      const lines = [], origin = { x: 37, y: 51 }, positionScale = { x: 1.2, y: .8 };
      let path;
      const context = { canvas: { getBoundingClientRect: () => ({ width: 900, height: 600 }) }, save() {}, restore() {}, beginPath() { path = []; }, moveTo(x, y) { path.push({ x, y }); }, lineTo(x, y) { path.push({ x, y }); }, stroke() { lines.push(path); }, fillText() {} };
      const view = { screen: point => ({ x: 450 + point.x * scale, y: 300 - point.y * scale }) };
      drawSamplingGrid(context, view, { positionScale, origin });
      const settings = { ...samplingPreferences(), stepX: 120, stepY: 80 }, snapped = snapSamplePoint({ x: origin.x + 119, y: origin.y + 79 }, { settings, origin, scale });
      const screen = view.screen(snapped);
      assert.ok(lines.some(([a, b]) => Math.abs(a.x - b.x) < 1e-7 && Math.abs(a.x - screen.x) < 1e-7));
      assert.ok(lines.some(([a, b]) => Math.abs(a.y - b.y) < 1e-7 && Math.abs(a.y - screen.y) < 1e-7));
    }
  } finally { saveSamplingPreferences(previous); }
});
