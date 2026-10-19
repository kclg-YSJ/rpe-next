import type { Chart } from './types.ts';
import { parseChart } from './chart.ts';
import { integerChartAlpha } from './alpha-values.ts';
import { parseLegacyChart } from './legacy-chart.ts';
import { parsePecChart } from './pec-chart.ts';
import { parseOfficialChart } from './official-chart.ts';
import { emitModHook } from './mod-hooks.ts';

export function parseDocument(text: string): Chart {
  const custom = emitModHook('chart:parse', { text, chart: null as Chart | null });
  if (custom.chart) return custom.chart;
  text = custom.text;
  const trimmed = text.replace(/^\uFEFF/, '').trimStart();
  if (trimmed.startsWith('{')) {
    const candidate = JSON.parse(trimmed) as unknown as { formatVersion?: unknown; META?: unknown };
    return emitModHook('chart:parsed',{chart:candidate.formatVersion && !candidate.META ? integerChartAlpha(parseOfficialChart(candidate)) : parseChart(trimmed)}).chart;
  }
  const bpm = trimmed.split(/\r?\n/).find(row => /^bp\s/.test(row.trim()));
  return emitModHook('chart:parsed',{chart:integerChartAlpha(bpm?.trim().split(/\s+/).length === 5 ? parseLegacyChart(trimmed) : parsePecChart(trimmed))}).chart;
}
