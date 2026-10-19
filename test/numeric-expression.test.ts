// @ts-nocheck - ported integration test with dynamic archive fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNumericExpression, evaluateEventNumber, isNumericLiteral } from '../src/core/numeric-expression.ts';
import { compileExpression } from '../src/core/batch-script.ts';
import { createEvent } from '../src/core/chart.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { parseBeat } from '../src/core/beat.ts';

test('数值输入支持四则运算、括号、幂、科学记数以及原版函数', () => {
  for (const [source, expected] of [
    ['2 + 3 * 4', 14], ['(675-75)/2', 300], ['-2.5e2', -250], ['2^3^2', 64],
    ['sin(Pi/2)*120', 120], ['cos(pi())', -1], ['log(2,8)+ln(e)+lg(100)', 6],
    ['sqrt(81)+max(1,2)-min(3,4)', 8], ['pow(2,3)+abs(-3)', 11], ['atan(1)*4', Math.PI],
  ]) assert.ok(Math.abs(evaluateNumericExpression(source) - expected) < 1e-10, source);
  assert.equal(isNumericLiteral('-2.5e-3'), true); assert.equal(isNumericLiteral('3+4'), false);
  // Input-specific compatibility must not alter the existing trajectory/script syntax.
  assert.equal(compileExpression('2^3^2')({}), 512);
  assert.deepEqual(parseBeat('2+1/2'), [2, 1, 2]);
  assert.deepEqual(parseBeat('3:49999/50000'), [3, 49999, 50000]);
});

test('非法表达式、非有限结果和主动代码不能作为数值应用', () => {
  for (const source of ['', '2+', '(1+2', '2 3', '1/0', 'sqrt(-1)', 'log(1,2)', 'sin()', 'sin(1,2)',
    'window.alert(1)', 'Math.random()', '1;globalThis.changed=true', 'unknown', '1v', '2^99999', '('.repeat(5000)]) {
    assert.throws(() => evaluateNumericExpression(source), undefined, source);
  }
});

test('Y 移动 v 转义以另一端为基准，按真实时长和本条线的 BPM 倍率计算', () => {
  const tempo = new TempoMap([{ startTime: [0, 0, 1], bpm: 120 }, { startTime: [2, 0, 1], bpm: 60 }]);
  const event = createEvent(30, 500, 1, 3);
  const context = { type: 'moveYEvents', event, tempo };
  assert.equal(evaluateEventNumber('2v', { ...context, field: 'end' }), 390);
  assert.equal(evaluateEventNumber('2v', { ...context, field: 'start' }), 140);
  assert.equal(evaluateEventNumber('(1+1)v', { ...context, field: 'end', factor: 0.5 }), 210);
  assert.equal(evaluateEventNumber('-1v', { ...context, field: 'end' }), -150);
  assert.equal(evaluateEventNumber('0v', { ...context, field: 'end' }), 30);
  assert.equal(evaluateEventNumber('1v', { ...context, field: 'end', event: createEvent(30, 90, 1, 1) }), 30);
  assert.throws(() => evaluateEventNumber('2v', { ...context, type: 'moveXEvents', field: 'end' }));
  assert.throws(() => evaluateEventNumber('v', { ...context, field: 'end' }));
  assert.throws(() => evaluateEventNumber('1v', { ...context, field: 'anchor' }));
  assert.equal(event.start, 30); assert.equal(event.end, 500);
});
