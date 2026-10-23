// Display helpers for names that are stored as chart/project data.
//
// A new chart and an ungrouped project store a sentinel instead of a localized
// name, so the same file reads correctly in every language. These helpers swap
// the sentinel for the active language at display time only; stored values are
// never rewritten.
import { t } from '../i18n.mjs';
import { DEFAULT_CHART_NAME } from './chart.mjs';

// Older builds stored the *translated* default group, so both spellings count
// as "no group" when reading existing projects.
const UNGROUPED = new Set(['', '未分组', 'Ungrouped']);

export function isUngrouped(group) {
  return UNGROUPED.has(String(group ?? '').trim());
}

export function groupDisplayName(group) {
  const value = String(group ?? '').trim();
  return isUngrouped(value) ? t('units.ungrouped') : value;
}

export function chartDisplayName(name) {
  const value = String(name ?? '').trim();
  return !value || value === DEFAULT_CHART_NAME ? t('doc.untitled') : value;
}
