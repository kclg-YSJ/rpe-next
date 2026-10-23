import { showDialog } from './dialog.mjs';
import { createChartExport, download, suggestDownloadName } from '../platform/files.mjs';
import { chartExportStem } from '../core/export-filename.mjs';
import { DEFAULT_TRAJECTORY_SPLIT } from '../core/trajectory-simplify.mjs';
import { diagnoseNoiseAreas } from '../core/noise-areas.mjs';
import { t } from '../i18n.mjs';

export function showExportDialog(chart, assets, chartName, onExport, identifier, { includeBackupCharts = false } = {}) {
  const host = showDialog(t('export-dialog.s50e57e1'), t('export-dialog.s80099ed'));
  const field = (title, control) => { const label = document.createElement('label'); label.className = 'field'; label.append(title, control); control.setAttribute('aria-label', title); host.append(label); return control; };
  const format = document.createElement('select');
  for (const [value, title] of [['next:json', 'RPE Next · JSON'], ['next:pez', 'RPE Next · PEZ'], ['rpe:json', t('export-dialog.s63c70f0')], ['rpe:pez', t('export-dialog.saacf5fd')]]) format.append(new Option(title, value));
  format.value = 'next:pez'; field(t('export-dialog.s3b1cd5c'), format);
  const compact = document.createElement('input'); compact.type = 'checkbox'; compact.checked = true;
  field(t('export-dialog.sa7bc6e7'), compact);
  const unused = document.createElement('input'); unused.type = 'checkbox'; unused.checked = false;
  field(t('export-dialog.sb87f1b3'), unused); const unusedLabel = unused.closest('label');
  const unusedHint = document.createElement('p'); unusedHint.className = 'hint'; unusedHint.textContent = t('export-dialog.s91d63d9'); host.append(unusedHint);
  const noiseIssues = diagnoseNoiseAreas(chart.blockAreaList);
  const noiseWarning = document.createElement('div'); noiseWarning.className = 'noise-export-warning'; host.append(noiseWarning);
  const acknowledgement = document.createElement('input'); acknowledgement.type = 'checkbox';
  const acknowledgementLabel = document.createElement('label'); acknowledgementLabel.className = 'field'; acknowledgementLabel.append(acknowledgement, t('export-dialog.s00bc416')); acknowledgementLabel.hidden = !noiseIssues.length; host.append(acknowledgementLabel);
  const removeNoise = document.createElement('input'); removeNoise.type = 'checkbox';
  const removeLabel = document.createElement('label'); removeLabel.className = 'field'; removeLabel.append(removeNoise, t('export-dialog.s3f5a158')); host.append(removeLabel);
  const hasGlobalEvents = Object.values(chart.globalEvents?.types ?? {}).some(type => Object.values(type.columns).some(column => column.events.length));
  const removeGlobal = document.createElement('input'); removeGlobal.type = 'checkbox';
  const removeGlobalLabel = document.createElement('label'); removeGlobalLabel.className = 'field'; removeGlobalLabel.append(removeGlobal, t('export-dialog.sffad927')); host.append(removeGlobalLabel);
  if (noiseIssues.length) { const heading = document.createElement('p'); heading.textContent = t('export-dialog.s80ad627') + noiseIssues.length + t('export-dialog.s30ed317'); noiseWarning.append(heading); for (const issue of noiseIssues.slice(0, 20)) { const item = document.createElement('p'); item.textContent = issue.path + '：' + issue.message; noiseWarning.append(item); } }
  const name = field(t('export-dialog.s2315651'), document.createElement('input'));
  const defaultStem = chartExportStem(chart, chartName);
  let suggestedStem;
  const suggestName = () => {
    if (suggestedStem !== undefined && name.value !== suggestedStem) return;
    const extension = '.' + format.value.split(':')[1];
    suggestedStem = suggestDownloadName(defaultStem + extension).slice(0, -extension.length);
    name.value = suggestedStem;
  };
  suggestName();
  const settings = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = t('export-dialog.sf738992'); settings.append(legend);
  const simplify = document.createElement('input'); simplify.type = 'checkbox'; simplify.checked = DEFAULT_TRAJECTORY_SPLIT.simplify;
  const simplifyLabel = document.createElement('label'); simplifyLabel.className = 'field'; simplifyLabel.append(simplify, t('export-dialog.s8160e72')); simplify.setAttribute('aria-label', t('export-dialog.s8160e72'));
  const tolerance = document.createElement('input'); tolerance.type = 'number'; tolerance.min = '0.001'; tolerance.max = '10000'; tolerance.step = 'any'; tolerance.value = DEFAULT_TRAJECTORY_SPLIT.tolerance; tolerance.setAttribute('aria-label', t('export-dialog.s413683d'));
  const toleranceLabel = document.createElement('label'); toleranceLabel.className = 'field'; toleranceLabel.append(t('export-dialog.s413683d'), tolerance);
  const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = t('export-dialog.s9f1c3f8');
  settings.append(simplifyLabel, toleranceLabel, hint); host.append(settings);
  const sync = () => { unusedLabel.hidden = unusedHint.hidden = format.value.endsWith(':json'); settings.hidden = format.value.startsWith('next:'); tolerance.disabled = !simplify.checked; removeLabel.hidden = !chart.blockAreaList?.length || format.value.startsWith('next:'); removeGlobalLabel.hidden = !hasGlobalEvents || format.value.startsWith('next:'); };
  format.onchange = () => { suggestName(); sync(); }; simplify.onchange = sync; sync();
  const apply = document.querySelector('#modal-apply'); apply.hidden = false; apply.textContent = t('export-dialog.s1888967');
  apply.onclick = () => {
    try {
      const [compatibility, container] = format.value.split(':');
      if (noiseIssues.length && !acknowledgement.checked) throw new Error(t('export-dialog.s4094dae'));
      if (compatibility === 'rpe' && chart.blockAreaList?.length && !removeNoise.checked) throw new Error(t('export-dialog.sac6ba5f'));
      if (compatibility === 'rpe' && hasGlobalEvents && !removeGlobal.checked) throw Error(t('export-dialog.se25f82b'));
      const result = createChartExport(chart, assets, chartName, { includeUnusedFiles: unused.checked, includeBackupCharts, compatibility, format: container, compact: compact.checked, name: name.value, identifier, removeNoiseAreas: compatibility === 'rpe' && removeNoise.checked, removeGlobalEvents: compatibility === 'rpe' && removeGlobal.checked, split: { simplify: simplify.checked, tolerance: Number(tolerance.value) } });
      const filename = download(result.blob, result.name); document.querySelector('#modal').close(); onExport(filename, container);
    } catch (error) { document.querySelector('#modal-error').textContent = error.message; }
  };
}
