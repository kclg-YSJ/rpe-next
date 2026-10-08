import { remapShaderLines } from '../core/shader-events.ts';
import type { Chart } from '../core/types.ts';

function requireLine(chart: Chart, index: number): void {
  if (!Number.isInteger(index) || !chart.judgeLineList?.[index]) throw new Error('判定线索引无效');
}

export function reorderLine(chart: Chart, from: number, to: number): Chart {
  requireLine(chart, from); requireLine(chart, to);
  const indices = chart.judgeLineList.map((line, index) => index);
  indices.splice(to, 0, indices.splice(from, 1)[0]);
  const destinations = new Map(indices.map((oldIndex, index) => [oldIndex, index]));
  const lines = indices.map(oldIndex => {
    const line = chart.judgeLineList[oldIndex];
    return line.father >= 0 && destinations.has(line.father) ? { ...line, father: destinations.get(line.father) as number } : line;
  });
  return remapShaderLines(chart, { ...chart, judgeLineList: lines }, destinations);
}

export function deleteLine(chart: Chart, index: number): Chart {
  requireLine(chart, index);
  const lines = chart.judgeLineList.filter((line, current) => current !== index).map(line => {
    if (line.father === index) return { ...line, father: -1 };
    if (line.father > index) return { ...line, father: line.father - 1 };
    return line;
  });
  const destinations = new Map(chart.judgeLineList.flatMap((line, current) => current === index ? [] : [[current, current > index ? current - 1 : current]]));
  return remapShaderLines(chart, { ...chart, judgeLineList: lines }, destinations);
}

export function duplicateLine(chart: Chart, index: number): Chart {
  requireLine(chart, index);
  const line = structuredClone(chart.judgeLineList[index]);
  line.Name = `${line.Name || '判定线'} 副本`;
  return remapShaderLines(chart, { ...chart, judgeLineList: [...chart.judgeLineList, line] }, new Map(chart.judgeLineList.map((line, index) => [index, index])), index);
}

export function setLineParent(chart: Chart, index: number, parent: number): Chart {
  requireLine(chart, index);
  if (parent !== -1) requireLine(chart, parent);
  const visited = new Set([index]);
  let ancestor = parent;
  while (ancestor !== -1) {
    if (visited.has(ancestor)) throw new Error('父线关系会形成循环');
    requireLine(chart, ancestor);
    visited.add(ancestor);
    ancestor = chart.judgeLineList[ancestor].father ?? -1;
  }
  const lines = [...chart.judgeLineList];
  lines[index] = { ...lines[index], father: parent };
  return { ...chart, judgeLineList: lines };
}
