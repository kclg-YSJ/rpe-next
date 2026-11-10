import { groupLineIndices, groupNames, reservedLineGroupName } from '../core/line-groups.mjs';
import { t } from '../i18n.mjs';

export function normalizeLineIndices(indices, lineCount) {
  return [...new Set((indices ?? []).filter(index => Number.isInteger(index) && index >= 0 && index < lineCount))];
}

const linePositions = new WeakMap();
const emptyLinePositions = new Map();
export function lineOrderPositions(order) {
  if (!order) return emptyLinePositions;
  // Workspace and clipboard lists are replaced when their order changes.
  let positions = linePositions.get(order);
  if (!positions) { positions = new Map(order.map((line, index) => [line, index])); linePositions.set(order, positions); }
  return positions;
}
export function lineOffsetMapper(lineCount, sourceOrder, targetOrder = sourceOrder, offset = 0) {
  const positions = lineOrderPositions(sourceOrder);
  return source => {
    const position = positions.get(source);
    if (position !== undefined && targetOrder?.length) return targetOrder[((position + offset) % targetOrder.length + targetOrder.length) % targetOrder.length];
    return lineCount ? ((source + offset) % lineCount + lineCount) % lineCount : source + offset;
  };
}

export function compileLineExpression(text, lineCount, chart = null) {
  const values = [];
  const dynamic = new Set();
  const parts = [];
  const groups = new Map(groupNames(chart).map((name, index) => [name, index]));
  for (const token of String(text ?? '').trim().split(/\s+/).filter(Boolean)) {
    const first = values.length;
    const range = token.split(':');
    if (['@notes', '@events'].includes(token.toLowerCase())) { const kind = token.toLowerCase().slice(1); dynamic.add(kind); parts.push(kind); }
    else if (token.toLowerCase() === 'all') values.push(...Array.from({ length: lineCount }, (unused, index) => index));
    else if (range.length === 1 && groups.has(token)) values.push(...groupLineIndices(chart, groups.get(token)));
    else if (range.length === 1 && /^[-+]?\d+$/.test(token)) values.push(Number(token));
    else if (range.length === 2 && /^[-+]?\d+$/.test(range[0]) && /^[-+]?\d+$/.test(range[1])) {
      const start = Number(range[0]); const end = Number(range[1]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) throw new Error(t('multi-line-edit.s144ae04', { p0: token }));
      for (let index = Math.max(0, start); index <= Math.min(lineCount - 1, end); index++) values.push(index);
    } else throw new Error(t('multi-line-edit.s6aa7d11', { p0: token }));
    if (values.length > first) parts.push(values.slice(first));
  }
  return { indices: normalizeLineIndices(values, lineCount), dynamic: [...dynamic], parts };
}

export function resolveLineExpression(compiled, current, lineCount) {
  return normalizeLineIndices(compiled.parts.flatMap(part => typeof part === 'string' ? current[part] ?? [] : part), lineCount);
}

export function parseLineExpression(text, lineCount, chart = null, current) {
  const compiled = compileLineExpression(text, lineCount, chart);
  if (compiled.dynamic.length && !current) throw new Error(t('multi-line-edit.needsViewport'));
  return resolveLineExpression(compiled, current ?? {}, lineCount);
}

export function formatLineExpression(indices, chart = null) {
  const values = normalizeLineIndices(indices, Number.MAX_SAFE_INTEGER);
  if (chart?.judgeLineList?.length && values.length === chart.judgeLineList.length && values.every((value, index) => value === index)) return 'all';
  const tokens = [], groups = chart ? groupNames(chart).flatMap((name, index) => index && name && !/\s/.test(name) && !reservedLineGroupName(name) ? [{ name, members: groupLineIndices(chart, index) }] : []) : [];
  for (let index = 0; index < values.length;) {
    const group = groups.find(group => group.members.length && group.members.every((line, i) => values[index + i] === line));
    if (group) { tokens.push(group.name); index += group.members.length; continue; }
    let end = index;
    while (end + 1 < values.length && values[end + 1] === values[end] + 1 && !groups.some(group => group.members.length && group.members[0] === values[end + 1])) end++;
    const length = end - index + 1;
    tokens.push(length >= 3 ? `${values[index]}:${values[end]}` : values.slice(index, end + 1).join(' '));
    index = end + 1;
  }
  return tokens.join(' ');
}

export function multiLineState(session) {
  return { enabled: Boolean(session.multiLineEnabled), mode: session.multiLineMode === 'events' ? 'events' : 'notes', merge: session.multiLineMerge !== false, indices: normalizeLineIndices(session.multiLineIndices, session.chart.judgeLineList?.length ?? 0), ...(session.multiLineExpression ? { expression: session.multiLineExpression } : {}) };
}

export function setMultiLineState(session, state = {}) {
  session.multiLineEnabled = Boolean(state.enabled);
  session.multiLineMode = state.mode === 'events' ? 'events' : 'notes';
  session.multiLineMerge = state.merge !== false;
  session.multiLineIndices = normalizeLineIndices(state.indices, session.chart.judgeLineList?.length ?? 0);
  session.multiLineExpression = state.expression ?? '';
  if (session.multiLineExpression) session.multiLineResolvedIndices = session.multiLineIndices;
  if (session.multiLineEnabled && !session.multiLineIndices.length && !session.multiLineExpression && session.chart.judgeLineList?.length) session.multiLineIndices = [session.lineIndex];
  return multiLineState(session);
}

export function toggleLine(session, lineIndex) {
  const indices = new Set(session.multiLineIndices ?? []);
  if (indices.has(lineIndex)) indices.delete(lineIndex); else indices.add(lineIndex);
  return setMultiLineState(session, { enabled: indices.size > 0, mode: session.multiLineMode, indices: [...indices] });
}

export function lineIsSelected(session, lineIndex) { return multiLineState(session).indices.includes(lineIndex); }
