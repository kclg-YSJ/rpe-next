import test from 'node:test';
import assert from 'node:assert/strict';
import { CURVE_PRESETS, TRAJECTORY_DEFAULTS, editableTrajectoryOptions, presetOptions, sampleCurveTrajectory, validateCurvePreset } from '../src/core/curve-trajectory.ts';
import { parseCurvePreset, saveCurvePreset, deleteCurvePreset, copyCurvePreset } from '../src/core/trajectory-presets.ts';
import type { CurvePreset } from '../src/core/curve-trajectory.ts';

const straight = { name: '直线测试', xExpression: '400*t', yExpression: '50', parameters: [] };

test('编写的自定义方程在保存和重新载入后保持原形状', () => {
  const parsed = parseCurvePreset(JSON.stringify(straight));
  // The stored list round-trips through JSON, so the parsed value is `any`; `validateCurvePreset`
  // rebuilds it entry by entry, which is what the annotation records.
  const stored: CurvePreset[] = JSON.parse(JSON.stringify(saveCurvePreset([], parsed))).map(validateCurvePreset);
  const points = sampleCurveTrajectory(presetOptions(stored[0]), 3);
  assert.deepEqual(points.map(point => [point.x, point.y]), [[0, 50], [200, 50], [400, 50]]);
});

test('自定义预设拒绝语法错误、未知字段和缺失方程，不回落为圆形', () => {
  assert.throws(() => parseCurvePreset('{'), /JSON 语法错误/);
  for (const invalid of [
    { ...straight, xExpression: 'sin(' },
    { ...straight, xExpression: 'unknown*t' },
    { ...straight, x: 't' },
    { name: '缺少方程', parameters: [] },
    { ...straight, mode: 'poler' },
    { ...straight, mode: 'polar' },
    { ...straight, alignStart: 'false' },
    { ...straight, parameters: [{ key: 'size', value: 5, min: 10 }] },
    { ...straight, parameters: [{ key: 'size', value: 5, step: 0 }] },
  ]) assert.throws(() => parseCurvePreset(JSON.stringify(invalid)));
});

test('再次编辑及重命名更新原预设，重复名称不会覆盖其他预设', () => {
  const initial = saveCurvePreset([], straight);
  const revised = saveCurvePreset(initial, { ...straight, name: '新名称', yExpression: 't^2' }, straight.name);
  assert.equal(revised.length, 1);
  assert.equal(revised[0].name, '新名称');
  assert.equal(revised[0].yExpression, 't^2');
  assert.equal(initial[0].yExpression, '50');
  const two = saveCurvePreset(revised, straight);
  assert.throws(() => saveCurvePreset(two, { ...straight, name: '新名称' }, straight.name), /同名/);
  assert.throws(() => saveCurvePreset(two, straight), /同名/);
  assert.throws(() => saveCurvePreset(two, straight, '已删除'), /不存在/);
  assert.equal(two.length, 2);
});

test('删除只移除目标预设，失败的编辑不会污染原列表', () => {
  const initial = saveCurvePreset(saveCurvePreset([], straight), { ...straight, name: '保留' });
  const snapshot = JSON.stringify(initial);
  assert.throws(() => saveCurvePreset(initial, { ...straight, yExpression: ')' }, straight.name));
  assert.equal(JSON.stringify(initial), snapshot);
  const stored: CurvePreset[] = JSON.parse(JSON.stringify(deleteCurvePreset(initial, straight.name)));
  assert.deepEqual(stored.map(entry => entry.name), ['保留']);
});

test('全部内置形状可转为自定义预设并重新载入', () => {
  for (const preset of CURVE_PRESETS) {
    const custom = parseCurvePreset(JSON.stringify(preset));
    assert.deepEqual(sampleCurveTrajectory(presetOptions(custom), 17), sampleCurveTrajectory(presetOptions(preset), 17));
  }
});

test('另存直接创建独立预设，自动处理重名和名称长度', () => {
  const original = saveCurvePreset([], straight);
  const first = copyCurvePreset(original, { ...straight, yExpression: '150*t' });
  const saved = saveCurvePreset(original, first);
  const second = copyCurvePreset(saved, straight);
  assert.equal(first.name, '直线测试（副本 1）');
  assert.equal(second.name, '直线测试（副本 2）');
  assert.equal(saved[0].yExpression, '50');
  assert.equal(saved[1].yExpression, '150*t');
  assert.equal(copyCurvePreset([], straight).name, straight.name);
  const long = { ...straight, name: '名'.repeat(80) };
  const copy = copyCurvePreset(saveCurvePreset([], long), long);
  assert.equal(copy.name.length, 80);
  assert.doesNotThrow(() => validateCurvePreset(copy));
});

test('星形及随机多边形填入为可编辑方程，保持旧版几何与旋转', () => {
  // The two lists are named as literals so `shape` and `mode` stay the unions the option bag
  // declares rather than widening to `string`; they hold exactly the four combinations the original
  // iterated.
  for (const shape of ['star', 'random-polygon'] as const) {
    for (const mode of ['parametric', 'polar'] as const) {
      const original = { ...TRAJECTORY_DEFAULTS, shape, mode, trimStart: 0.13, trimEnd: 0.89, rotation: 30, scaleX: 0.7, scaleY: 1.2, alignStart: true, startX: 12, startY: 40, seed: 17, randomness: 0.6, parameterStart: '-2', parameterEnd: '3', angleStart: '1', angleEnd: '5*pi', easingX: 4, rotationExpression: 't*30+theta', parameters: { points: 7, radius: 250, inner: 0.3 } };
      const editable = editableTrajectoryOptions(original);
      assert.equal(editable.mode, 'parametric');
      assert.equal(Object.hasOwn(editable, 'shape'), false);
      assert.notEqual(editable.xExpression, TRAJECTORY_DEFAULTS.xExpression);
      const before = sampleCurveTrajectory(original, 257);
      const after = sampleCurveTrajectory(editable, 257);
      for (let index = 0; index < before.length; index++) {
        // The three axes are named as literals so the index below is the sample's own key union; the
        // list is exactly what `sampleCurveTrajectory` returns, so the annotation changes no value.
        for (const axis of ['x', 'y', 'rotation'] as const) assert.ok(Math.abs(before[index][axis] - after[index][axis]) < 1e-7, `${shape} ${mode} ${index} ${axis}`);
      }
      const changed = sampleCurveTrajectory({ ...editable, xExpression: 't*100', yExpression: '0', rotation: 0, scaleX: 1, alignStart: false }, 3);
      assert.ok(Math.abs(changed[0].x - 13) < 1e-7);
      assert.ok(Math.abs(changed[2].x - 89) < 1e-7);
      assert.equal(changed[1].y, 0);
      assert.equal(original.shape, shape);
    }
  }
});

test('每种预设的正式参数经保存重开仍可修改方程且不残留隐藏形状', () => {
  for (const preset of CURVE_PRESETS) {
    const options = presetOptions(preset);
    assert.equal(Object.hasOwn(options, 'shape'), false);
    const reopened = editableTrajectoryOptions(JSON.parse(JSON.stringify(options)));
    assert.deepEqual(sampleCurveTrajectory(reopened, 33), sampleCurveTrajectory(options, 33));
    const custom = validateCurvePreset({ ...options, parameters: Object.entries(options.parameters).map(([key, value]) => ({ key, value })) });
    assert.deepEqual(sampleCurveTrajectory(presetOptions(custom), 33), sampleCurveTrajectory(options, 33));
    const modified = editableTrajectoryOptions({ ...reopened, mode: 'parametric', xExpression: '10*t', yExpression: '0', parameterStart: '0', parameterEnd: '1' });
    assert.doesNotThrow(() => sampleCurveTrajectory(modified));
  }
});
