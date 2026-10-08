import type { EditorSession } from './session.ts';
import { groupLineIndices, groupNames } from '../core/line-groups.ts';
import type { Chart } from '../core/types.ts';

/**
 * The multi-line workspace as the panel reads it: the raw session flags normalised into a
 * stable shape, so callers never have to repeat the `!== false` / `=== 'events'` defaults.
 */
export interface MultiLineState {
  enabled: boolean;
  mode: 'notes' | 'events';
  merge: boolean;
  indices: number[];
}

/**
 * The subset of a session `setMultiLineState` accepts. Everything is optional because the UI
 * calls it with partial patches, and every field is `unknown` because those patches come from
 * form controls: `Boolean(state.enabled)` and the `=== 'events'` test below are the validation.
 */
export interface MultiLineStatePatch {
  enabled?: unknown;
  mode?: unknown;
  merge?: unknown;
  indices?: unknown;
}

/**
 * The callers pass whatever the form control happens to hand over — a single line index, an
 * array of them, or nothing at all — so the list is taken as `unknown` and read as a number[]
 * only once it is known to be an array. Non-array, non-number inputs (a bare line index from a
 * caller, `undefined`) keep behaving exactly as before: `undefined` yields an empty list, and
 * anything else passes through to the `Number.isInteger` filter, which drops it.
 */
function asIndexList(indices: unknown): unknown[] {
  if (indices === undefined || indices === null) return [];
  return Array.isArray(indices) ? indices : [indices];
}

/** De-duplicates, drops out-of-range/negative/non-integer line numbers and sorts ascending. */
export function normalizeLineIndices(indices: unknown, lineCount: number): number[] {
  const kept: number[] = [];
  for (const value of asIndexList(indices)) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < lineCount) kept.push(value);
  }
  return [...new Set(kept)].sort((a, b) => a - b);
}

/** Parses a line-number expression (`0 2:4 GroupA`) into normalised, in-range line indices. */
export function parseLineExpression(text: unknown, lineCount: number, chart: Chart | null = null): number[] {
  const values: number[] = [];
  const groups = new Map<string, number>(groupNames(chart ?? undefined).map((name, index) => [name, index]));
  for (const token of String(text ?? '').trim().split(/\s+/).filter(Boolean)) {
    const range = token.split(':');
    if (range.length === 1 && groups.has(token)) values.push(...groupLineIndices(chart ?? undefined, groups.get(token) ?? 0));
    else if (range.length === 1 && /^[-+]?\d+$/.test(token)) values.push(Number(token));
    else if (range.length === 2 && /^[-+]?\d+$/.test(range[0]) && /^[-+]?\d+$/.test(range[1])) {
      const start = Number(range[0]); const end = Number(range[1]);
      if (start > end) throw new Error(`线号范围无效：${token}`);
      for (let index = start; index <= end; index++) values.push(index);
    } else throw new Error(`无法解析线号：${token}`);
  }
  return normalizeLineIndices(values, lineCount);
}

/** Renders normalised line indices back into an expression, preferring whole-group names. */
export function formatLineExpression(indices: unknown, chart: Chart | null = null): string {
  const values = normalizeLineIndices(indices, Number.MAX_SAFE_INTEGER);
  const tokens: string[] = [];
  const remaining = new Set<number>(values);
  if (chart) for (const [groupIndex, name] of groupNames(chart).entries()) {
    if (groupIndex === 0 || !name || /\s/.test(name)) continue;
    const members = groupLineIndices(chart, groupIndex);
    if (members.length && members.every(index => remaining.has(index))) { tokens.push(name); members.forEach(index => remaining.delete(index)); }
  }
  const numeric = [...remaining].sort((left, right) => left - right);
  for (let index = 0; index < numeric.length;) {
    let end = index;
    while (end + 1 < numeric.length && numeric[end + 1] === numeric[end] + 1) end++;
    const length = end - index + 1;
    tokens.push(length >= 3 ? `${numeric[index]}:${numeric[end]}` : numeric.slice(index, end + 1).join(' '));
    index = end + 1;
  }
  return tokens.join(' ');
}

/** Reads the session's multi-line flags into their normalised, panel-facing shape. */
export function multiLineState(session: EditorSession): MultiLineState {
  return { enabled: Boolean(session.multiLineEnabled), mode: session.multiLineMode === 'events' ? 'events' : 'notes', merge: session.multiLineMerge !== false, indices: normalizeLineIndices(session.multiLineIndices, session.chart.judgeLineList?.length ?? 0) };
}

/** Applies a partial multi-line patch to the session and returns the resulting state. */
export function setMultiLineState(session: EditorSession, state: MultiLineStatePatch = {}): MultiLineState {
  session.multiLineEnabled = Boolean(state.enabled);
  session.multiLineMode = state.mode === 'events' ? 'events' : 'notes';
  session.multiLineMerge = state.merge !== false;
  session.multiLineIndices = normalizeLineIndices(state.indices, session.chart.judgeLineList?.length ?? 0);
  if (session.multiLineEnabled && !session.multiLineIndices.length && session.chart.judgeLineList?.length) session.multiLineIndices = [session.lineIndex];
  return multiLineState(session);
}

/** Adds or removes one line from the multi-line set, keeping `enabled` in sync with it. */
export function toggleLine(session: EditorSession, lineIndex: number): MultiLineState {
  const indices = new Set<number>(session.multiLineIndices ?? []);
  if (indices.has(lineIndex)) indices.delete(lineIndex); else indices.add(lineIndex);
  return setMultiLineState(session, { enabled: indices.size > 0, mode: session.multiLineMode, indices: [...indices] });
}

export function lineIsSelected(session: EditorSession, lineIndex: number): boolean { return multiLineState(session).indices.includes(lineIndex); }
