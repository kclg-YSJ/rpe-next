import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { ShaderRuntime } from '../src/core/shader.mjs';
import { shaderEvents } from '../src/core/shader-events.mjs';
import { SHADER_PREVIEW_DRAFT, shaderPreviewKey, shaderPreviewTargets, shaderPreviewPasses } from '../src/core/shader-preview.mjs';

test('preview substitutes the selected effect once, preserving local/global stage and other instances of the same effect', () => {
  const chart = createChart(); chart.effects = [
    { shader: '/color.fs', line: 0, start: [0, 0, 1], end: [8, 0, 1], order: 2, vars: { strength: [{ startTime: [0, 0, 1], endTime: [8, 0, 1], start: .2, end: 1, easingType: 1 }] } },
    { shader: '/color.fs', line: 0, start: [1, 0, 1], end: [8, 0, 1], order: 3, global: true, vars: { strength: .9 } },
  ];
  const runtime = new ShaderRuntime(); runtime.load = () => {}; const tempo = new TempoMap(chart.BPMList); runtime.compile(chart, tempo);
  const targets = shaderPreviewTargets([{ lineIndex: 0, event: shaderEvents(chart, 0)[0] }]), effects = runtime.active(tempo.seconds(4)), before = structuredClone(effects);
  const result = shaderPreviewPasses(effects, effect => targets.has(shaderPreviewKey(effect)), { strength: .7, extra: 2 });
  assert.equal(result.effects.length, effects.length); assert.equal(result.effects[0].shader, SHADER_PREVIEW_DRAFT); assert.equal(result.effects[0].global, false);
  assert.equal(result.effects[1], effects[1]); assert.equal(result.effects[1].global, true); assert.equal(result.effects[0].order, 2);
  assert.ok(Math.abs(result.values.strength - .6) < 1e-12); assert.equal(result.values.extra, 2); assert.deepEqual(effects, before);
});

test('shared chart source updates every active reference in place; manual preview values override animation without mutating it', () => {
  const effects = [{ shader: 'file-a', sourceName: '/same.fs', global: false, values: { strength: .2 } }, { shader: 'other', sourceName: '/other.fs', values: {} }, { shader: 'file-a', sourceName: '/same.fs', global: true, values: { strength: .8 } }];
  const result = shaderPreviewPasses(effects, effect => effect.sourceName === '/same.fs', { strength: 1 }, { strength: .5 });
  assert.equal(result.effects.length, 3); assert.equal(result.effects.filter(effect => effect.shader === SHADER_PREVIEW_DRAFT).length, 2);
  assert.equal(result.effects[1], effects[1]); assert.equal(result.effects[0].values.strength, .5); assert.equal(result.effects[2].values.strength, .5);
  assert.equal(effects[0].values.strength, .2); assert.equal(effects[2].values.strength, .8);
});

test('outside the event range, a standalone draft remains visible with its defaults and does not remove other active effects', () => {
  const effects = [{ shader: 'other', global: false, order: 0, values: {} }];
  const result = shaderPreviewPasses(effects, () => false, { strength: .7 }, { extra: 2 });
  assert.equal(result.effects.length, 2); assert.equal(result.effects[0], effects[0]); assert.equal(result.effects[1].shader, SHADER_PREVIEW_DRAFT); assert.equal(result.effects[1].global, true);
  assert.deepEqual(result.values, { strength: .7, extra: 2 }); assert.equal(effects.length, 1);
});
