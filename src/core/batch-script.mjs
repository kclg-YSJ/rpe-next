import { easing } from './easing.mjs';
import { t } from '../i18n.mjs';

const functions = Object.freeze({
  abs: Math.abs, min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, pow: Math.pow,
  clamp: (value, lower, upper) => Math.max(lower, Math.min(upper, value)),
  lerp: (lower, upper, progress) => lower + (upper - lower) * progress,
  ease: (progress, type = 1) => easing(progress, type),
});
const precedence = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '^': 7, '**': 7 };

export function compileExpression(source, options = {}) {
  const expressionFunctions = options.functions ?? functions;
  if (source.length > 4096) throw new Error(t('batch-script.s02f3332'));
  const tokens = []; let offset = 0;
  while (offset < source.length) {
    const match = /^(\s+|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)?|\*\*|&&|\|\||==|!=|<=|>=|[+\-*/%^<>()!,?:])/i.exec(source.slice(offset));
    if (!match) throw new Error(t('batch-script.s0f40108', { p0: source.slice(offset, offset + 12) }));
    offset += match[0].length;
    if (match[0].trim()) tokens.push(match[0]);
  }
  if (tokens.length > 512) throw new Error(t('batch-script.s788db8a'));
  let cursor = 0;
  const requireToken = token => { if (tokens[cursor++] !== token) throw new Error(t('batch-script.s9e28966', { p0: token })); };
  const atom = () => {
    const token = tokens[cursor++];
    if (!token) throw new Error(t('batch-script.sd3adc10'));
    if (['+', '-', '!'].includes(token)) {
      const value = atom(); return scope => token === '-' ? -value(scope) : token === '!' ? Number(!value(scope)) : value(scope);
    }
    if (token === '(') { const value = expression(); requireToken(')'); return value; }
    if (/^(\d|\.)/.test(token)) return () => Number(token);
    if (!/^[A-Za-z_]/.test(token)) throw new Error(t('batch-script.s3561094', { p0: token }));
    if (tokens[cursor] === '(') {
      if (!Object.hasOwn(expressionFunctions, token)) throw new Error(t('batch-script.s1db9927', { p0: token }));
      cursor++; const args = [];
      if (tokens[cursor] !== ')') { do { args.push(expression()); if (tokens[cursor] !== ',') break; cursor++; } while (true); }
      requireToken(')'); return scope => expressionFunctions[token](...args.map(arg => arg(scope)));
    }
    return scope => {
      if (token === 'pi') return Math.PI;
      if (token === 'true') return 1;
      if (token === 'false') return 0;
      if (!Object.hasOwn(scope, token)) throw new Error(t('batch-script.s19d7972', { p0: token }));
      return scope[token];
    };
  };
  const expression = (minimum = 0) => {
    let left = atom();
    while (Object.hasOwn(precedence, tokens[cursor]) && precedence[tokens[cursor]] >= minimum) {
      const operator = tokens[cursor++]; const before = left;
      const right = expression(precedence[operator] + (['^', '**'].includes(operator) && options.powerAssociativity !== 'left' ? 0 : 1));
      left = scope => {
        const first = before(scope);
        if (operator === '&&') return Number(Boolean(first) && Boolean(right(scope)));
        if (operator === '||') return Number(Boolean(first) || Boolean(right(scope)));
        const second = right(scope);
        switch (operator) {
          case '+': return first + second; case '-': return first - second; case '*': return first * second;
          case '/': return first / second; case '%': return first % second; case '^': case '**': return first ** second;
          case '==': return Number(first === second); case '!=': return Number(first !== second);
          case '<': return Number(first < second); case '>': return Number(first > second);
          case '<=': return Number(first <= second); case '>=': return Number(first >= second);
        }
      };
    }
    if (minimum === 0 && tokens[cursor] === '?') {
      cursor++; const condition = left; const yes = expression(); requireToken(':'); const no = expression();
      left = scope => condition(scope) ? yes(scope) : no(scope);
    }
    return left;
  };
  const result = expression();
  if (cursor !== tokens.length) throw new Error(t('batch-script.scebb19b', { p0: tokens[cursor] }));
  return scope => { const value = result(scope); if (!Number.isFinite(value)) throw new Error(t('batch-script.s09cf120')); return value; };
}

export function compileBatchScript(source, fields) {
  if (source.length > 16384) throw new Error(t('batch-script.sf8507b4'));
  const statements = source.replace(/#[^\n]*/g, '').split(/[;\n]/).map(value => value.trim()).filter(Boolean);
  if (statements.length > 64) throw new Error(t('batch-script.s89f7fcc'));
  return statements.map(statement => {
    const match = /^([A-Za-z_][A-Za-z_0-9.]*)\s*(\+=|-=|\*=|\/=|=)\s*(.+)$/.exec(statement);
    if (!match || !fields.includes(match[1])) throw new Error(t('batch-script.s5704165', { p0: statement }));
    return { field: match[1], operator: match[2], evaluate: compileExpression(match[3]) };
  });
}
