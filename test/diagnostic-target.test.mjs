import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, diagnose } from '../src/core/chart.mjs';
import { shaderLine } from '../src/core/shader.mjs';
import { shaderEvents } from '../src/core/shader-events.mjs';
import { diagnosticShaderTarget } from '../src/application/diagnostic-target.mjs';

const segment = () => ({ startTime: [435, 0, 1], endTime: [429, 0, 1], start: 0, end: .003, easingType: 4 });
const effect = (shader = 'radialBlur') => ({ shader, start: [435, 0, 1], end: [499, 0, 1], vars: { power: [segment()] } });

test('legacy shader parameter time errors retain true type-based owners and exact source locations', () => {
  const chart = createChart(); chart.judgeLineList.push(...Array.from({ length: 9 }, () => createLine()));
  chart.effects = [effect('radialBlur'), effect('chromatic')];
  const original = JSON.stringify(chart), issues = diagnose(chart).filter(issue => issue.code === 'shaderParameterTime');
  assert.equal(issues.length, 2);
  for (const [index, issue] of issues.entries()) {
    assert.equal(issue.line, shaderLine(chart.effects[index], chart));
    assert.equal(issue.extended, true); assert.equal(issue.eventType, 'paintEvents');
    assert.equal(issue.shaderRoot, 'effects'); assert.equal(issue.shaderIndex, index);
    assert.equal(issue.shaderParameter, true); assert.equal(issue.parameter, 'power'); assert.equal(issue.segment, 0);
    assert.match(issue.message, /power/); assert.match(issue.message, /435.*429/);
    const target = diagnosticShaderTarget(chart, JSON.parse(JSON.stringify(issue)));
    assert.equal(target.lineIndex, issue.line); assert.equal(target.index, 0);
    assert.equal(target.event.vars, chart.effects[index].vars);
  }
  assert.equal(JSON.stringify(chart), original);
});

test('diagnostic focus resolves duplicate effects by source index across all three roots', () => {
  const chart = createChart(); chart.judgeLineList.push(...Array.from({ length: 9 }, () => createLine()));
  chart.effects = [effect(), effect()]; chart.shaderEvents = [effect()]; chart.META.effects = [effect()];
  for (const [root, sourceIndex, expected] of [['effects', 0, 0], ['effects', 1, 1], ['shaderEvents', 0, 2], ['META.effects', 0, 3]]) {
    const issue = { path: 'effects.' + expected + '.vars.power[0]', shaderRoot: root, shaderIndex: sourceIndex };
    const target = diagnosticShaderTarget(chart, issue);
    assert.equal(target.index, expected); assert.equal(target.event, shaderEvents(chart, target.lineIndex)[expected]);
    assert.equal(diagnosticShaderTarget(chart, { path: issue.path }).index, expected);
  }
  assert.equal(diagnosticShaderTarget(chart, { path: 'META.effects[0].vars.power' }).index, 3);
  assert.equal(diagnosticShaderTarget(chart, { path: 'moveXEvents[0]' }), null);
});
