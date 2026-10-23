import { t } from '../i18n.mjs';
export function groupNames(chart) {
  const names = Array.isArray(chart?.judgeLineGroup) ? [...chart.judgeLineGroup] : [];
  if (!names.length) names.push('Default');
  if (!String(names[0] ?? '').trim()) names[0] = 'Default';
  return names.map((name, index) => String(name ?? '').trim() || (index === 0 ? 'Default' : `Group ${index}`));
}

export function lineGroupIndex(line) {
  const value = Number(line?.Group ?? 0);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function lineGroupName(chart, lineOrIndex) {
  const line = typeof lineOrIndex === 'number' ? chart?.judgeLineList?.[lineOrIndex] : lineOrIndex;
  const names = groupNames(chart);
  return names[lineGroupIndex(line)] ?? names[0];
}

export function isDefaultLineGroup(chart, lineOrIndex) { return lineGroupIndex(typeof lineOrIndex === 'number' ? chart?.judgeLineList?.[lineOrIndex] : lineOrIndex) === 0; }

export function isDefaultLineName(line, index) {
  const name = String(line?.Name ?? '').trim();
  return !name || name === `Line ${index + 1}` || name === t('line-groups.s96ed554', { p0: index + 1 }) || name === t('line-groups.s1527a9c', { p0: index + 1 });
}

export function lineNameLabel(line, index) {
  return isDefaultLineName(line, index) ? t('line-groups.s58bcf82', { p0: index }) : String(line?.Name).trim();
}

export function lineFeatureLabels(line) {
  const labels = [];
  const father = Number(line?.father ?? -1);
  if (Number.isInteger(father) && father >= 0) labels.push(t('line-groups.s0e0e6d5', { p0: father }));
  const attachUI = String(line?.attachUI ?? '').trim();
  if (attachUI) labels.push(`UI=${attachUI}`);
  const zOrder = Number(line?.zOrder ?? 0);
  if (Number.isFinite(zOrder) && zOrder !== 0) labels.push(`Z=${zOrder}`);
  const texture = String(line?.Texture ?? 'line.png').trim();
  if (texture && texture !== 'line.png') labels.push(t('line-groups.s634b6cc', { p0: texture }));
  return labels;
}

export function lineDisplayLabel(chart, index, { includeIndex = true } = {}) {
  const line = chart?.judgeLineList?.[index] ?? {};
  const parts = [];
  if (includeIndex) parts.push(t('line-groups.s58bcf82', { p0: index }));
  if (!isDefaultLineGroup(chart, line)) parts.push(lineGroupName(chart, line));
  if (!isDefaultLineName(line, index)) parts.push(String(line.Name).trim());
  return parts.join(' · ') || t('line-groups.s58bcf82', { p0: index });
}

export function groupLineIndices(chart, groupIndex) {
  return (chart?.judgeLineList ?? []).flatMap((line, index) => lineGroupIndex(line) === groupIndex ? [index] : []);
}
