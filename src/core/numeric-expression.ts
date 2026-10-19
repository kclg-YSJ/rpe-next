import { compileExpression } from './batch-script.ts';
import type { ChartEvent } from './types.ts';
import type { TempoMap } from './tempo.ts';

/** A built-in function of the numeric-expression dialect. */
type NumericFunction = (...values: number[]) => number;

/** Whether the whole text is a plain decimal literal rather than an expression. */
export const isNumericLiteral = (text: unknown): boolean => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(String(text).trim()) && Number.isFinite(Number(text));

const method = (name: string, arity: number, calculate: NumericFunction): NumericFunction => (...values: number[]) => {
  if (values.length !== arity) throw new Error(`${name} 需要 ${arity} 个参数`);
  return calculate(...values);
};

const definitions: Record<string, [arity: number, calculate: NumericFunction]> = {
  abs: [1, Math.abs], sqrt: [1, Math.sqrt], sin: [1, Math.sin], cos: [1, Math.cos], tan: [1, Math.tan],
  asin: [1, Math.asin], acos: [1, Math.acos], atan: [1, Math.atan],
  floor: [1, Math.floor], ceil: [1, Math.ceil], round: [1, Math.round],
  min: [2, Math.min], max: [2, Math.max], pow: [2, Math.pow],
  log: [2, (base, value) => Math.log(value) / Math.log(base)], ln: [1, Math.log], lg: [1, Math.log10],
  pi: [0, () => Math.PI],
};
const methods: Record<string, NumericFunction> = Object.fromEntries(Object.entries(definitions).map(([name, [arity, calculate]]) => [name, method(name, arity, calculate)]));

/** Evaluates a user-typed numeric expression without executing JavaScript. */
export function evaluateNumericExpression(source: unknown): number {
  const text = String(source).trim();
  if (!text) throw new Error('数值不能为空');
  if (isNumericLiteral(text)) return Number(text);
  // The shared parser evaluates an arithmetic tree; no JavaScript is executed.
  return compileExpression(text, { functions: methods, powerAssociativity: 'left' })({ Pi: Math.PI, e: Math.E });
}

/** The context a `v`-suffixed Y-movement value needs to resolve against its event. */
export interface EventNumberContext {
  type: string;
  field: string;
  event: ChartEvent;
  tempo: TempoMap;
  factor?: number;
}

/**
 * Evaluates an event value, resolving the `v` suffix as a velocity relative to the other endpoint.
 *
 * `v` is only meaningful on the first and last value of a Y-movement event; everywhere else the
 * text is a plain numeric expression.
 */
export function evaluateEventNumber(source: unknown, { type, field, event, tempo, factor = 1 }: EventNumberContext): number {
  const text = String(source).trim();
  if (!text.endsWith('v')) return evaluateNumericExpression(text);
  if (type !== 'moveYEvents' || !['start', 'end'].includes(field)) throw new Error('v 后缀仅用于 Y 移动事件的首值和尾值');
  const speed = evaluateNumericExpression(text.slice(0, -1));
  const duration = tempo.seconds(event.endTime, factor) - tempo.seconds(event.startTime, factor);
  const otherValue = event[field === 'start' ? 'end' : 'start'];
  const other = typeof otherValue === 'number' ? otherValue : Number(otherValue);
  const value = other + (field === 'end' ? 1 : -1) * 120 * duration * speed;
  if (!Number.isFinite(value) || duration < 0) throw new Error('无法计算 Y 移动事件的位移');
  return value;
}
