// A tiny expression compiler for the multi-edit batch panel. Source text is tokenised with one
// master regex, then turned into closures (`CompiledExpression`) by a precedence-climbing parser;
// there is deliberately no evaluator over an AST at run time, so user text is never re-parsed.
//
// The whole pipeline is modelled with a single function type per stage instead of `any`: the
// public entry points are declared with the wide `number` return (which is what lets callers pass
// the result straight into `Number(...)`, arithmetic or a function argument), while the internal
// parser locals use the narrower closure aliases below, which are assignable to the public shape.
import { easing } from './easing.ts';

/** Values a compiled expression may produce: every operator is arithmetic/comparison. */
type ScopeValue = number | string | boolean;

/** The variable bag an expression is evaluated against (built by `multi-edit.ts`). */
type ExpressionScope = Record<string, ScopeValue>;

/** A function argument may itself be a compiled sub-expression. */
type ArgumentValue = number | CompiledClosure;

/**
 * A closure the parser builds for one node. It may be fed another closure (a function argument)
 * or a literal number (a variable's value), and returns whatever that node yields.
 */
type CompiledClosure = (value: ArgumentValue) => ScopeValue;

/** The shape callers see: a numeric expression over a variable bag. */
type CompiledExpression = (scope: ExpressionScope) => number;

/**
 * A statement of a compiled batch script, as returned by {@link compileBatchScript}.
 *
 * `operator` stays a plain string rather than a union because `multi-edit.ts` branches on it with
 * its own `===` comparisons; narrowing here would only move the work to that call site.
 */
export interface BatchStatement {
  field: string;
  operator: string;
  evaluate: CompiledExpression;
}

/**
 * A built-in function. `min`/`max`/`pow` use the real `Math` signatures, which accept more
 * arguments than the RPE dialect documents; index signatures below accept that excess.
 */
type NamedFunction = (...args: number[]) => number;

/** Same signatures with just one parameter, so every `Math` function satisfies `NamedFunction`. */
type SingleArgumentFunction = (value: number) => number;

const functions: Record<string, NamedFunction> = Object.freeze({
  abs: Math.abs, min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, pow: Math.pow,
  clamp: (value: number, lower: number, upper: number) => Math.max(lower, Math.min(upper, value)),
  lerp: (lower: number, upper: number, progress: number) => lower + (upper - lower) * progress,
  ease: (progress: number, type = 1) => Number(easing(progress, type)),
} satisfies Record<string, NamedFunction | SingleArgumentFunction>);

const precedence: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '^': 7, '**': 7 };

/** Compiles one user-typed expression into a numeric function of the scope, or throws. */
export function compileExpression(source: string): CompiledExpression {
  if (source.length > 4096) throw new Error('单个表达式不能超过 4096 字符');
  const tokens: string[] = []; let offset = 0;
  while (offset < source.length) {
    const match = /^(\s+|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)?|\*\*|&&|\|\||==|!=|<=|>=|[+\-*/%^<>()!,?:])/i.exec(source.slice(offset));
    if (!match) throw new Error(`表达式包含不支持的字符：${source.slice(offset, offset + 12)}`);
    offset += match[0].length;
    if (match[0].trim()) tokens.push(match[0]);
  }
  if (tokens.length > 512) throw new Error('表达式过于复杂');
  let cursor = 0;
  const requireToken = (token: string): void => { if (tokens[cursor++] !== token) throw new Error(`表达式缺少 ${token}`); };
  const atom = (): CompiledClosure => {
    const token = tokens[cursor++];
    if (!token) throw new Error('表达式未完成');
    if (['+', '-', '!'].includes(token)) {
      const value = atom(); return scope => token === '-' ? -Number(value(scope)) : token === '!' ? Number(!Number(value(scope))) : value(scope);
    }
    if (token === '(') { const value = expression(); requireToken(')'); return value; }
    if (/^(\d|\.)/.test(token)) return () => Number(token);
    if (!/^[A-Za-z_]/.test(token)) throw new Error(`无法解析 ${token}`);
    if (tokens[cursor] === '(') {
      if (!Object.hasOwn(functions, token)) throw new Error(`不支持函数 ${token}`);
      cursor++; const args: CompiledClosure[] = [];
      if (tokens[cursor] !== ')') { do { args.push(expression()); if (tokens[cursor] !== ',') break; cursor++; } while (true); }
      requireToken(')'); return scope => functions[token](...args.map(arg => Number(arg(scope))));
    }
    // A variable node: `scope` may also be a closure when this node is a function argument, in
    // which case every built-in resolves to a built-in and throws, exactly as before.
    return scope => {
      if (token === 'pi') return Math.PI;
      if (token === 'true') return 1;
      if (token === 'false') return 0;
      if (typeof scope !== 'object' || scope === null || !Object.hasOwn(scope, token)) throw new Error(`未知变量 ${token}`);
      return scope[token];
    };
  };
  const expression = (minimum = 0): CompiledClosure => {
    let left = atom();
    while (Object.hasOwn(precedence, tokens[cursor]) && precedence[tokens[cursor]] >= minimum) {
      const operator = tokens[cursor++]; const before = left;
      const right = expression(precedence[operator] + (['^', '**'].includes(operator) ? 0 : 1));
      left = scope => {
        const first = Number(before(scope));
        if (operator === '&&') return Number(Boolean(first) && Boolean(right(scope)));
        if (operator === '||') return Number(Boolean(first) || Boolean(right(scope)));
        // Deliberately `Number(...)`: a quoted literal in the scope must stay usable in arithmetic
        // (`'2' + '3'` is `5` for this dialect, matching the assignment path in `multi-edit.ts`).
        const second = Number(right(scope));
        switch (operator) {
          case '+': return first + second; case '-': return first - second; case '*': return first * second;
          case '/': return first / second; case '%': return first % second; case '^': case '**': return first ** second;
          case '==': return Number(first === second); case '!=': return Number(first !== second);
          case '<': return Number(first < second); case '>': return Number(first > second);
          case '<=': return Number(first <= second); case '>=': return Number(first >= second);
        }
        // Unreachable through `compileExpression`, whose `cursor`/`tokens` are private to it; the
        // guard exists so this function has a definite return type for `CompiledClosure`.
        throw new Error(`不支持的运算符 ${operator}`);
      };
    }
    if (minimum === 0 && tokens[cursor] === '?') {
      cursor++; const condition = left; const yes = expression(); requireToken(':'); const no = expression();
      left = scope => condition(scope) ? yes(scope) : no(scope);
    }
    return left;
  };
  const result = expression();
  if (cursor !== tokens.length) throw new Error(`多余的表达式：${tokens[cursor]}`);
  // The annotation goes on a binding rather than a trailing `as` on the returned expression: Node's
  // type stripper cannot parse `return expr as T` here, because the cast is ambiguous with ASI.
  const compiled: CompiledExpression = scope => { const value = Number(result(scope as unknown as ArgumentValue)); if (!Number.isFinite(value)) throw new Error('计算结果不是有限数字（请检查除零或函数参数）'); return value; };
  return compiled;
}

/** Compiles a whole batch script, one `field op expression` assignment per statement. */
export function compileBatchScript(source: string, fields: string[]): BatchStatement[] {
  if (source.length > 16384) throw new Error('脚本不能超过 16384 字符');
  const statements = source.replace(/#[^\n]*/g, '').split(/[;\n]/).map(value => value.trim()).filter(Boolean);
  if (statements.length > 64) throw new Error('脚本最多 64 条赋值');
  return statements.map(statement => {
    const match = /^([A-Za-z_][A-Za-z_0-9.]*)\s*(\+=|-=|\*=|\/=|=)\s*(.+)$/.exec(statement);
    if (!match || !fields.includes(match[1])) throw new Error(`不支持的赋值：${statement}`);
    return { field: match[1], operator: match[2], evaluate: compileExpression(match[3]) };
  });
}
