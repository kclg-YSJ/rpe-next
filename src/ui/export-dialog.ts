import { showDialog } from './dialog.ts';
import { createChartExport, download } from '../platform/files.ts';
import { DEFAULT_TRAJECTORY_SPLIT } from '../core/trajectory-simplify.ts';
import { diagnoseNoiseAreas } from '../core/noise-areas.ts';
import type { ChartExportOptions } from '../platform/files.ts';
import type { Chart } from '../core/types.ts';
import type { ArchiveEntries } from '../platform/archive.ts';

/**
 * The four fixed option values the `<select>` below can hold are the only strings `format.value` ever
 * carries, so the pair split out of it is always one of the four `ChartExportOptions` combinations.
 * `createChartExport` still re-validates them at runtime and throws '导出格式无效' otherwise.
 *
 * `identifier` is the PEZ package's `info.txt` path hint; it stays optional so a chart with no
 * library project can still be exported.
 */

export function showExportDialog(chart: Chart, assets: ArchiveEntries, chartName: string, onExport: (name: string) => void, identifier?: string): void {
  const host = showDialog('导出谱面', 'Next 格式保留整体曲线轨迹；原 RPE 格式将轨迹转换为普通事件。JSON 只包含谱面，PEZ 同时打包已载入的音乐、图片及其他资源。');
  const field = <T extends HTMLElement>(title: string, control: T): T => { const label = document.createElement('label'); label.className = 'field'; label.append(title, control); control.setAttribute('aria-label', title); host.append(label); return control; };
  const format = document.createElement('select');
  for (const [value, title] of [['next:json', 'RPE Next · JSON'], ['next:pez', 'RPE Next · PEZ'], ['rpe:json', '原 RPE · JSON'], ['rpe:pez', '原 RPE · PEZ']]) format.append(new Option(title, value));
  format.value = 'next:pez'; field('导出格式', format);
  const compact = document.createElement('input'); compact.type = 'checkbox'; compact.checked = true;
  field('压缩 JSON（仅去掉多余空格和换行，保留全部属性）', compact);
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
  if (noiseIssues.length) { const heading = document.createElement('p'); heading.textContent = '噪域检查：' + noiseIssues.length + ' 项。内部事件超出生命周期时仅限制显示，原始时间不会被裁剪。'; noiseWarning.append(heading); for (const issue of noiseIssues.slice(0, 20)) { const item = document.createElement('p'); item.textContent = issue.path + '：' + issue.message; noiseWarning.append(item); } }
  const name = field('文件名（不含扩展名）', document.createElement('input'));
  // `split('/')` always yields at least one entry, so `at(-1)` is never undefined here; the original
  // dereferenced it unguarded, and `!` keeps that dereference rather than inventing a fallback name.
  name.value = chartName.replaceAll('\\', '/').split('/').at(-1)!.replace(/\.(json|pez|pec|zip)$/i, '');
  const settings = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = '整体轨迹兼容转换'; settings.append(legend);
  const simplify = document.createElement('input'); simplify.type = 'checkbox'; simplify.checked = DEFAULT_TRAJECTORY_SPLIT.simplify;
  const simplifyLabel = document.createElement('label'); simplifyLabel.className = 'field'; simplifyLabel.append(simplify, '以较少的缓动事件近似'); simplify.setAttribute('aria-label', '以较少的缓动事件近似');
  const tolerance = document.createElement('input'); tolerance.type = 'number'; tolerance.min = '0.001'; tolerance.max = '10000'; tolerance.step = 'any'; tolerance.value = String(DEFAULT_TRAJECTORY_SPLIT.tolerance); tolerance.setAttribute('aria-label', '拆分容忍度');
  const toleranceLabel = document.createElement('label'); toleranceLabel.className = 'field'; toleranceLabel.append('拆分容忍度', tolerance);
  const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = '相对原始等分碎事件的每轴最大误差：X/Y 为坐标单位，旋转为度。越小越精确；关闭优化则保留各轨迹设定的全部等分段。';
  settings.append(simplifyLabel, toleranceLabel, hint); host.append(settings);
  const sync = () => { settings.hidden = format.value.startsWith('next:'); tolerance.disabled = !simplify.checked; removeLabel.hidden = !blockAreaList.length || format.value.startsWith('next:'); };
  format.onchange = sync; simplify.onchange = sync; sync();
  // The same `#modal-apply` element `dialog.ts` types as a button; `showDialog` has just revealed it.
  const apply = document.querySelector('#modal-apply') as HTMLButtonElement; apply.hidden = false; apply.textContent = '导出';
  apply.onclick = () => {
    try {
      // Built from the four option values above, so the split pair is always one of these two;
      // `createChartExport` is what actually rejects an unexpected pair at runtime.
      const [compatibility, container] = format.value.split(':') as ['next' | 'rpe', 'json' | 'pez'];
      if (noiseIssues.length && !acknowledgement.checked) throw new Error('请先阅读并勾选确认噪域检查提示');
      if (compatibility === 'rpe' && blockAreaList.length && !removeNoise.checked) throw new Error('原 RPE 无法表示噪域，请改用 Next 格式，或勾选移除噪域');
      const options: ChartExportOptions = { compatibility, format: container, compact: compact.checked, name: name.value, identifier, removeNoiseAreas: compatibility === 'rpe' && removeNoise.checked, split: { simplify: simplify.checked, tolerance: Number(tolerance.value) } };
      const result = createChartExport(chart, assets, chartName, options);
      download(result.blob, result.name); (document.querySelector('#modal') as HTMLDialogElement).close(); onExport(result.name);
    } catch (error) {
      // `catch` binds `unknown` under `strict`, so the message is narrowed the way `dialog.ts`'s
      // `failureMessage` does; only a thrown non-Error could tell the two readings apart, and that
      // path reported `undefined` here anyway.
      const message = error instanceof Error ? error.message : String(error);
      (document.querySelector('#modal-error') as HTMLElement).textContent = message;
    }
  };
}
