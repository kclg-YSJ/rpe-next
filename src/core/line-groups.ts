import type { Chart, JudgeLine } from './types.ts';

// Every function here tolerates a missing chart or line because the UI calls them while the editor
// is still loading (or with an out-of-range line index), and the existing optional chaining relies
// on that. The parameter types therefore stay `| undefined` rather than being asserted non-null.

/** The chart's judge-line group names, normalised so grouping always has at least one usable name. */
export function groupNames(chart: Chart | undefined): string[] {
  const names = Array.isArray(chart?.judgeLineGroup) ? [...chart.judgeLineGroup] : [];
  if (!names.length) names.push('Default');
  if (!String(names[0] ?? '').trim()) names[0] = 'Default';
  return names.map((name, index) => String(name ?? '').trim() || (index === 0 ? 'Default' : `Group ${index}`));
}

/** The group index a line belongs to, defaulting to 0 for missing or malformed values. */
export function lineGroupIndex(line: JudgeLine | undefined): number {
  const value = Number(line?.Group ?? 0);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** Resolves a line or a line index to its group's display name. */
export function lineGroupName(chart: Chart | undefined, lineOrIndex: JudgeLine | number | undefined): string {
  const line = typeof lineOrIndex === 'number' ? chart?.judgeLineList?.[lineOrIndex] : lineOrIndex;
  const names = groupNames(chart);
  return names[lineGroupIndex(line)] ?? names[0];
}

export function isDefaultLineGroup(chart: Chart | undefined, lineOrIndex: JudgeLine | number | undefined): boolean { return lineGroupIndex(typeof lineOrIndex === 'number' ? chart?.judgeLineList?.[lineOrIndex] : lineOrIndex) === 0; }

/** Whether a line still carries an auto-generated name, so the UI can hide it. */
export function isDefaultLineName(line: JudgeLine | undefined, index: number): boolean {
  const name = String(line?.Name ?? '').trim();
  return !name || name === `Line ${index + 1}` || name === `判定线 ${index + 1}` || name === `判定线${index + 1}`;
}

export function lineNameLabel(line: JudgeLine | undefined, index: number): string {
  return isDefaultLineName(line, index) ? `线 ${index}` : String(line?.Name).trim();
}

/** Short feature tags (parent line, attached UI, z-order, texture) shown next to a line. */
export function lineFeatureLabels(line: JudgeLine | undefined): string[] {
  const labels: string[] = [];
  const father = Number(line?.father ?? -1);
  if (Number.isInteger(father) && father >= 0) labels.push(`父线=${father}`);
  const attachUI = String(line?.attachUI ?? '').trim();
  if (attachUI) labels.push(`UI=${attachUI}`);
  const zOrder = Number(line?.zOrder ?? 0);
  if (Number.isFinite(zOrder) && zOrder !== 0) labels.push(`Z=${zOrder}`);
  const texture = String(line?.Texture ?? 'line.png').trim();
  if (texture && texture !== 'line.png') labels.push(`贴图=${texture}`);
  return labels;
}

/** One-line label for a line, combining its index, group and custom name where they add meaning. */
export function lineDisplayLabel(chart: Chart | undefined, index: number, { includeIndex = true }: { includeIndex?: boolean } = {}): string {
  // Falls back to a blank line so the label still renders for an out-of-range index.
  const line: JudgeLine | undefined = chart?.judgeLineList?.[index];
  const parts: string[] = [];
  if (includeIndex) parts.push(`线 ${index}`);
  if (!isDefaultLineGroup(chart, line)) parts.push(lineGroupName(chart, line));
  if (!isDefaultLineName(line, index)) parts.push(String(line?.Name).trim());
  return parts.join(' · ') || `线 ${index}`;
}

/** Indices of every line belonging to the given group. */
export function groupLineIndices(chart: Chart | undefined, groupIndex: number): number[] {
  return (chart?.judgeLineList ?? []).flatMap((line, index) => lineGroupIndex(line) === groupIndex ? [index] : []);
}
