import type { Chart } from './types.ts';
import { parseChart } from './chart.ts';
import { integerChartAlpha } from './alpha-values.ts';
import { parseLegacyChart } from './legacy-chart.ts';
import { parsePecChart } from './pec-chart.ts';
import { parseOfficialChart } from './official-chart.ts';

export function parseDocument(text: string): Chart {
  const trimmed = text.replace(/^\uFEFF/, '').trimStart();
  if (trimmed.startsWith('{')) {
    const candidate = JSON.parse(trimmed);
    return candidate.formatVersion && !candidate.META ? integerChartAlpha(parseOfficialChart(candidate)) : parseChart(trimmed);
  }
  const bpm = trimmed.split(/\r?\n/).find(row => /^bp\s/.test(row.trim()));
  return integerChartAlpha(bpm?.trim().split(/\s+/).length === 5 ? parseLegacyChart(trimmed) : parsePecChart(trimmed));
}
