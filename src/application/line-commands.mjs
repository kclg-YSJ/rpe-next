import { remapShaderLines } from '../core/shader-events.mjs';
import { createLine } from '../core/chart.mjs';
import { t } from '../i18n.mjs';

export const MAX_BATCH_LINE_COUNT = 10000;

export function validateLineCount(count, current = 0) {
  if (!Number.isSafeInteger(count) || count <= 0) throw new Error(t('line-commands.sd6efa64'));
  if (count > current && count > MAX_BATCH_LINE_COUNT) throw new Error(t('line-commands.s90c27c6', { p0: MAX_BATCH_LINE_COUNT }));
}

export function ensureLineCount(chart, count) {
  const lines = chart.judgeLineList ?? [];
  validateLineCount(count, lines.length);
  if (count <= lines.length) return chart;
  return { ...chart, judgeLineList: [...lines, ...Array.from({ length: count - lines.length }, (_, index) => createLine(`Line ${lines.length + index + 1}`))] };
}

function requireLine(chart, index) {
  if (!Number.isInteger(index) || !chart.judgeLineList?.[index]) throw new Error(t('line-commands.s16ff585'));
}

export function reorderLine(chart, from, to) {
  requireLine(chart, from); requireLine(chart, to);
  const indices = chart.judgeLineList.map((line, index) => index);
  indices.splice(to, 0, indices.splice(from, 1)[0]);
  const destinations = new Map(indices.map((oldIndex, index) => [oldIndex, index]));
  const lines = indices.map(oldIndex => {
    const line = chart.judgeLineList[oldIndex];
    return line.father >= 0 && destinations.has(line.father) ? { ...line, father: destinations.get(line.father) } : line;
  });
  return remapShaderLines(chart, { ...chart, judgeLineList: lines }, destinations);
}

export function deleteLine(chart, index) {
  requireLine(chart, index);
  const lines = chart.judgeLineList.filter((line, current) => current !== index).map(line => {
    if (line.father === index) return { ...line, father: -1 };
    if (line.father > index) return { ...line, father: line.father - 1 };
    return line;
  });
  const destinations = new Map(chart.judgeLineList.flatMap((line, current) => current === index ? [] : [[current, current > index ? current - 1 : current]]));
  return remapShaderLines(chart, { ...chart, judgeLineList: lines }, destinations);
}

export function duplicateLine(chart, index) {
  requireLine(chart, index);
  const line = structuredClone(chart.judgeLineList[index]);
  line.Name = t('line-commands.s0fba311', { p0: line.Name || '判定线' });
  return remapShaderLines(chart, { ...chart, judgeLineList: [...chart.judgeLineList, line] }, new Map(chart.judgeLineList.map((line, index) => [index, index])), index);
}

export function setLineParent(chart, index, parent) {
  requireLine(chart, index);
  if (parent !== -1) requireLine(chart, parent);
  const visited = new Set([index]);
  let ancestor = parent;
  while (ancestor !== -1) {
    if (visited.has(ancestor)) throw new Error(t('line-commands.s2cc5c48'));
    requireLine(chart, ancestor);
    visited.add(ancestor);
    ancestor = chart.judgeLineList[ancestor].father ?? -1;
  }
  const lines = [...chart.judgeLineList];
  lines[index] = { ...lines[index], father: parent };
  return { ...chart, judgeLineList: lines };
}
