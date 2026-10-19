import { showDialog } from './dialog.ts';
import { createChartExport, download, suggestDownloadName } from '../platform/files.ts';
import { chartExportStem } from '../core/export-filename.ts';
import { DEFAULT_TRAJECTORY_SPLIT } from '../core/trajectory-simplify.ts';
import { diagnoseNoiseAreas } from '../core/noise-areas.ts';
import type { ChartExportOptions } from '../platform/files.ts';
import type { Chart } from '../core/types.ts';
import type { ArchiveEntries } from '../platform/archive.ts';

/** Options shared with the caller's current import/export preferences. */
export interface ExportDialogOptions {
  includeBackupCharts?: boolean;
}

/**
 * The four fixed option values the `<select>` below can hold are the only strings `format.value` ever
 * carries, so the pair split out of it is always one of the four `ChartExportOptions` combinations.
 * `createChartExport` still re-validates them at runtime and throws '导出格式无效' otherwise.
 *
 * `identifier` is the PEZ package's `info.txt` path hint; it stays optional so a chart with no
 * library project can still be exported.
 */
export function showExportDialog(chart: Chart, assets: ArchiveEntries, chartName: string, onExport: (name: string, format: 'json' | 'pez') => void, identifier?: string, { includeBackupCharts = false }: ExportDialogOptions = {}): void {
  const host = showDialog('导出谱面', 'Next 格式保留整体曲线轨迹；原 RPE 格式将轨迹转换为普通事件。JSON 只包含谱面，PEZ 默认只打包当前谱面及其使用的资源。');
  const field = <T extends HTMLElement>(title: string, control: T): T => { const label = document.createElement('label'); label.className = 'field'; label.append(title, control); control.setAttribute('aria-label', title); host.append(label); return control; };
  const format = document.createElement('select');
  for (const [value, title] of [['next:json', 'RPE Next · JSON'], ['next:pez', 'RPE Next · PEZ'], ['rpe:json', '原 RPE · JSON'], ['rpe:pez', '原 RPE · PEZ']]) format.append(new Option(title, value));
  format.value = 'next:pez'; field('导出格式', format);
  const compact = document.createElement('input'); compact.type = 'checkbox'; compact.checked = true;
  field('压缩 JSON（仅去掉多余空格和换行，保留全部属性）', compact);
  const unused = document.createElement('input'); unused.type = 'checkbox'; unused.checked = false;
  field('包含未使用的文件和素材', unused); const unusedLabel = unused.closest('label');
  const unusedHint = document.createElement('p'); unusedHint.className = 'hint'; unusedHint.textContent = '默认排除其他谱面、未使用的素材、皮肤和贴图。自动保存及备份文件另遵循通用设置。'; host.append(unusedHint);
  // `Chart` types `blockAreaList` through its open-ended index signature, so it reads as `unknown`
  // here. `Array.isArray` narrows it to a list, and `diagnoseNoiseAreas` is not annotated yet, so its
  // parameter is inferred as `never[]`; the bridge names the argument type it declares for itself,
  // the same way `chart.ts` calls `validateNoiseAreas`. A document with no areas yields the empty
  // list the checker would have reported nothing about anyway.
  const blockAreaList = Array.isArray(chart.blockAreaList) ? chart.blockAreaList : [];
  const noiseIssues = diagnoseNoiseAreas(blockAreaList as Parameters<typeof diagnoseNoiseAreas>[0]);
  const noiseWarning = document.createElement('div'); noiseWarning.className = 'noise-export-warning'; host.append(noiseWarning);
  const acknowledgement = document.createElement('input'); acknowledgement.type = 'checkbox';
  const acknowledgementLabel = document.createElement('label'); acknowledgementLabel.className = 'field'; acknowledgementLabel.append(acknowledgement, '已了解噪域警告，保留原始内部时间后导出'); acknowledgementLabel.hidden = !noiseIssues.length; host.append(acknowledgementLabel);
  const removeNoise = document.createElement('input'); removeNoise.type = 'checkbox';
  const removeLabel = document.createElement('label'); removeLabel.className = 'field'; removeLabel.append(removeNoise, '原 RPE 不支持噪域：仅在导出副本中移除全部噪域'); host.append(removeLabel);
  const hasGlobalEvents = Object.values(chart.globalEvents?.types ?? {}).some(type => Object.values(type.columns).some(column => column.events.length));
  const removeGlobal = document.createElement('input'); removeGlobal.type = 'checkbox';
  const removeGlobalLabel = document.createElement('label'); removeGlobalLabel.className = 'field'; removeGlobalLabel.append(removeGlobal, '原 RPE 不支持全局事件：仅在导出副本中移除全部全局事件'); host.append(removeGlobalLabel);
  if (noiseIssues.length) { const heading = document.createElement('p'); heading.textContent = '噪域检查：' + noiseIssues.length + ' 项。内部事件超出生命周期时仅限制显示，原始时间不会被裁剪。'; noiseWarning.append(heading); for (const issue of noiseIssues.slice(0, 20)) { const item = document.createElement('p'); item.textContent = issue.path + '：' + issue.message; noiseWarning.append(item); } }
  const name = field('文件名（不含扩展名）', document.createElement('input'));
  const defaultStem = chartExportStem(chart, chartName);
  let suggestedStem: string | undefined;
  const suggestName = (): void => {
    if (suggestedStem !== undefined && name.value !== suggestedStem) return;
    const extension = '.' + format.value.split(':')[1];
    suggestedStem = suggestDownloadName(defaultStem + extension).slice(0, -extension.length);
    name.value = suggestedStem;
  };
  suggestName();
  const settings = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = '整体轨迹兼容转换'; settings.append(legend);
  const simplify = document.createElement('input'); simplify.type = 'checkbox'; simplify.checked = DEFAULT_TRAJECTORY_SPLIT.simplify;
  const simplifyLabel = document.createElement('label'); simplifyLabel.className = 'field'; simplifyLabel.append(simplify, '以较少的缓动事件近似'); simplify.setAttribute('aria-label', '以较少的缓动事件近似');
  const tolerance = document.createElement('input'); tolerance.type = 'number'; tolerance.min = '0.001'; tolerance.max = '10000'; tolerance.step = 'any'; tolerance.value = String(DEFAULT_TRAJECTORY_SPLIT.tolerance); tolerance.setAttribute('aria-label', '拆分容忍度');
  const toleranceLabel = document.createElement('label'); toleranceLabel.className = 'field'; toleranceLabel.append('拆分容忍度', tolerance);
  const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = '相对原始等分碎事件的每轴最大误差：X/Y 为坐标单位，旋转为度。越小越精确；关闭优化则保留各轨迹设定的全部等分段。';
  settings.append(simplifyLabel, toleranceLabel, hint); host.append(settings);
  const sync = (): void => { if (unusedLabel) unusedLabel.hidden = format.value.endsWith(':json'); unusedHint.hidden = format.value.endsWith(':json'); settings.hidden = format.value.startsWith('next:'); tolerance.disabled = !simplify.checked; removeLabel.hidden = !blockAreaList.length || format.value.startsWith('next:'); removeGlobalLabel.hidden = !hasGlobalEvents || format.value.startsWith('next:'); };
  format.onchange = () => { suggestName(); sync(); }; simplify.onchange = sync; sync();
  // The same `#modal-apply` element `dialog.ts` types as a button; `showDialog` has just revealed it.
  const apply = document.querySelector('#modal-apply') as HTMLButtonElement; apply.hidden = false; apply.textContent = '导出';
  apply.onclick = () => {
    try {
      // Built from the four option values above, so the split pair is always one of these two;
      // `createChartExport` is what actually rejects an unexpected pair at runtime.
      const [compatibility, container] = format.value.split(':') as ['next' | 'rpe', 'json' | 'pez'];
      if (noiseIssues.length && !acknowledgement.checked) throw new Error('请先阅读并勾选确认噪域检查提示');
      if (compatibility === 'rpe' && blockAreaList.length && !removeNoise.checked) throw new Error('原 RPE 无法表示噪域，请改用 Next 格式，或勾选移除噪域');
      if (compatibility === 'rpe' && hasGlobalEvents && !removeGlobal.checked) throw new Error('原 RPE 无法表示全局事件，请改用 Next 格式，或勾选移除全局事件');
      const options: ChartExportOptions = { includeUnusedFiles: unused.checked, includeBackupCharts, compatibility, format: container, compact: compact.checked, name: name.value, identifier, removeNoiseAreas: compatibility === 'rpe' && removeNoise.checked, removeGlobalEvents: compatibility === 'rpe' && removeGlobal.checked, split: { simplify: simplify.checked, tolerance: Number(tolerance.value) } };
      const result = createChartExport(chart, assets, chartName, options);
      const filename = download(result.blob, result.name); (document.querySelector('#modal') as HTMLDialogElement).close(); onExport(filename, container);
    } catch (error) {
      // `catch` binds `unknown` under `strict`, so the message is narrowed the way `dialog.ts`'s
      // `failureMessage` does; only a thrown non-Error could tell the two readings apart, and that
      // path reported `undefined` here anyway.
      const message = error instanceof Error ? error.message : String(error);
      (document.querySelector('#modal-error') as HTMLElement).textContent = message;
    }
  };
}

