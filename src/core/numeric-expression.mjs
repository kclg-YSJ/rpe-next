import { compileExpression } from './batch-script.mjs';
import { t } from '../i18n.mjs';

export const isNumericLiteral = text => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(String(text).trim()) && Number.isFinite(Number(text));
const method = (name, arity, calculate) => (...values) => {
  if (values.length !== arity) throw new Error(t('numeric-expression.s3380796', { p0: name, p1: arity }));
  return calculate(...values);
};
const methods = Object.fromEntries(Object.entries({
  abs: [1, Math.abs], sqrt: [1, Math.sqrt], sin: [1, Math.sin], cos: [1, Math.cos], tan: [1, Math.tan],
  asin: [1, Math.asin], acos: [1, Math.acos], atan: [1, Math.atan],
  floor: [1, Math.floor], ceil: [1, Math.ceil], round: [1, Math.round],
  min: [2, Math.min], max: [2, Math.max], pow: [2, Math.pow],
  log: [2, (base, value) => Math.log(value) / Math.log(base)], ln: [1, Math.log], lg: [1, Math.log10],
  pi: [0, () => Math.PI],
}).map(([name, [arity, calculate]]) => [name, method(name, arity, calculate)]));

export function evaluateNumericExpression(source) {
  const text = String(source).trim();
  if (!text) throw new Error(t('numeric-expression.scab3948'));
  if (isNumericLiteral(text)) return Number(text);
  // The shared parser evaluates an arithmetic tree; no JavaScript is executed.
  return compileExpression(text, { functions: methods, powerAssociativity: 'left' })({ Pi: Math.PI, e: Math.E });
}

export function evaluateEventNumber(source, { type, field, event, tempo, factor = 1 }) {
  const text = String(source).trim();
  if (!text.endsWith('v')) return evaluateNumericExpression(text);
  if (type !== 'moveYEvents' || !['start', 'end'].includes(field)) throw new Error(t('numeric-expression.sed27492'));
  const speed = evaluateNumericExpression(text.slice(0, -1));
  const duration = tempo.seconds(event.endTime, factor) - tempo.seconds(event.startTime, factor);
  const other = event[field === 'start' ? 'end' : 'start'];
  const value = other + (field === 'end' ? 1 : -1) * 120 * duration * speed;
  if (!Number.isFinite(value) || duration < 0) throw new Error(t('numeric-expression.s98c281d'));
  return value;
}
