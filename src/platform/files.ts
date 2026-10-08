import { serializeChart } from '../core/chart.ts';
import { parseDocument } from '../core/formats.ts';
import { readZip, writeZip } from './archive.ts';
import { decodeLegacy, parseInfo } from './legacy-text.ts';
import { serializeShaderEvent } from '../core/shader-events.ts';
import { expandTrajectory } from '../application/trajectory-commands.ts';
import { TempoMap } from '../core/tempo.ts';
import { beatValue } from '../core/beat.ts';
import type { ArchiveEntries } from './archive.ts';
import type { Chart, TrajectorySplit } from '../core/types.ts';

/** A parsed chart together with the archive path it was found at. */
export interface ChartCandidate {
  name: string;
  chart: Chart;
}

/** The result of reading a user's file selection. */
export interface OpenedFiles {
  candidates: ChartCandidate[];
  assets: ArchiveEntries;
}

/** A chart's resolved song and background, as they should be looked up in the asset map. */
export interface ResourceReferences {
  song: string;
  background: string;
}

/**
 * Reads a user's file picker selection into charts plus the raw asset map around them.
 *
 * A single `.pez`/`.zip` is unpacked; otherwise each selected file becomes one entry keyed by its
 * own name, which is how a chart JSON plus its music and illustration are opened together.
 */
export async function openFiles(fileList: ArrayLike<File> & Iterable<File>): Promise<OpenedFiles | null> {
  const files = [...fileList];
  if (!files.length) return null;
  let assets: ArchiveEntries = new Map();
  if (files.length === 1 && /\.(pez|zip)$/i.test(files[0].name)) assets = await readZip(await files[0].arrayBuffer());
  else for (const file of files) assets.set(file.name, new Uint8Array(await file.arrayBuffer()));
  const candidates: ChartCandidate[] = [];
  const errors: string[] = [];
  for (const [name, bytes] of assets) {
    if (!/\.(json|pec)$/i.test(name)) continue;
    try { candidates.push({ name, chart: parseDocument(decodeLegacy(bytes)) }); }
    catch (error) { errors.push(`${name}: ${(error as Error).message}`); }
  }
  if (!candidates.length) throw new Error(errors.join('\n') || '找不到 RPE JSON 谱面');
  attachExternalEffects(candidates, assets);
  return { candidates, assets };
}

/**
 * Merges a sibling `extra.json` into each chart that does not already carry effects.
 *
 * Shader effects live beside the chart rather than inside it. The file is matched to the chart by
 * directory; when exactly one chart and one `extra.json` were selected, they are paired regardless
 * of directory, because that is what a user dragging two files together means.
 */
export function attachExternalEffects(candidates: ChartCandidate[], assets: ArchiveEntries): void {
  const extras = [...assets.entries()].filter(([name]) => name.replaceAll('\\', '/').split('/').at(-1)!.toLowerCase() === 'extra.json');
  for (const candidate of candidates) {
    if (Array.isArray(candidate.chart.effects)) continue;
    const chartDirectory = candidate.name.replaceAll('\\', '/').split('/').slice(0, -1).join('/').toLowerCase();
    const matches = extras.filter(([name]) => name.replaceAll('\\', '/').split('/').slice(0, -1).join('/').toLowerCase() === chartDirectory);
    const fallback = matches.length ? matches : candidates.length === 1 && extras.length === 1 ? extras : [];
    for (const [, bytes] of fallback) {
      try {
        const extra = JSON.parse(decodeLegacy(bytes)) as { effects?: unknown };
        if (Array.isArray(extra.effects)) { candidate.chart.effects = extra.effects; break; }
      } catch { /* extra.json is optional and may belong to another RPE project. */ }
    }
  }
}

/**
 * Finds an asset by the name a chart refers to it by.
 *
 * Charts store references relative to themselves, but an archive may nest them differently, so the
 * lookup degrades in steps: exact path, then a normalized path, then a unique basename match. The
 * basename step deliberately requires uniqueness — guessing between two `music.ogg` files would
 * silently attach the wrong audio.
 */
export function assetBytes(assets: ArchiveEntries, name: string, chartName = ''): Uint8Array | null {
  if (!name) return null;
  const chartPath = chartName.replaceAll('\\', '/');
  const directory = chartPath.includes('/') ? chartPath.slice(0, chartPath.lastIndexOf('/') + 1) : '';
  const direct = assets.get(directory + name) ?? assets.get(name);
  if (direct) return direct;
  const normalized = normalizePath(name);
  for (const target of [normalizePath(directory + name), normalized]) {
    const exact = [...assets].filter(([path]) => normalizePath(path) === target);
    if (exact.length === 1) return exact[0][1];
  }
  const matches = [...assets].filter(([path]) => normalizePath(path).split('/').at(-1) === normalized.split('/').at(-1));
  return matches.length === 1 ? matches[0][1] : null;
}

/** Saves a blob to disk through a temporary anchor, revoking the object URL once it is claimed. */
export function download(blob: Blob, name: string): void {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers, so the URL is held briefly.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function exportChart(chart: Chart, name: string): void {
  download(new Blob([serializeChart(chart)], { type: 'application/json' }), name.replace(/\.(pec|pez|zip)$/i, '.json'));
}

/**
 * Rewrites a chart so that pre-0.8.0 readers can open it.
 *
 * Every whole-curve trajectory on the X track is expanded into the ordinary per-event fragments those
 * readers understand, and the trajectory event itself is dropped. `splitSettings` is merged over each
 * trajectory's own recorded split by `trajectorySplitSettings`.
 */
export function legacyChart(chart: Chart, splitSettings: Partial<TrajectorySplit> = {}): Chart {
  const next = structuredClone(chart);
  if (next.META.RPEVersion >= 200) next.META = { ...next.META, RPEVersion: 170 };
  const tempo = new TempoMap(next.BPMList);
  for (const line of next.judgeLineList ?? []) {
    for (const layer of line.eventLayers ?? []) {
      if (!layer) continue;
      const trajectories = (layer.moveXEvents ?? []).filter(event => event.trajectory);
      if (!trajectories.length) continue;
      // `trajectories` is non-empty here, so the track it was filtered from is present too; the `!`
      // records that the original dereferenced it unguarded.
      layer.moveXEvents = layer.moveXEvents!.filter(event => !event.trajectory);
      for (const event of trajectories) for (const [type, fragments] of expandTrajectory(event, tempo, line.bpmfactor ?? 1, splitSettings)) layer[type] = [...(layer[type] ?? []), ...fragments].sort((left, right) => beatValue(left.startTime) - beatValue(right.startTime));
    }
  }
  return next;
}

export function exportLegacyChart(chart: Chart, name: string): void {
  download(new Blob([serializeChart(legacyChart(chart))], { type: 'application/json' }), name.replace(/\.(json|pec|pez|zip)$/i, '') + '.rpe.json');
}

/** Resolves `.`/`..` segments and case, so paths from different archives compare equal. */
function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/').toLowerCase();
}

/** The `info.txt` entries that name the given chart. */
function matchingInfo(assets: ArchiveEntries, chartName: string): [string, Uint8Array][] {
  return [...assets].filter(([name, bytes]) => {
    const normalizedName = name.replaceAll('\\', '/');
    if (normalizedName.split('/').at(-1)!.toLowerCase() !== 'info.txt') return false;
    const reference = parseInfo(decodeLegacy(bytes)).Chart;
    const directory = normalizedName.slice(0, normalizedName.lastIndexOf('/') + 1);
    return Boolean(reference) && normalizePath(directory + reference) === normalizePath(chartName);
  });
}

/**
 * Determines which archive entries a chart uses for its song and illustration.
 *
 * Preference order is the chart's own metadata, then the sibling `info.txt`, then inference from
 * the files sitting next to the chart. Inference only accepts an unambiguous candidate.
 */
export function resourceReferences(chart: Chart, assets: ArchiveEntries, chartName: string, fallback: Record<string, string> = {}): ResourceReferences {
  const matches = matchingInfo(assets, chartName);
  const info = matches.length === 1 ? parseInfo(decodeLegacy(matches[0][1])) : fallback;
  const normalizedChart = normalizePath(chartName);
  const directory = normalizedChart.split('/').slice(0, -1).join('/');
  const stem = normalizedChart.split('/').at(-1)!.replace(/\.[^.]+$/, '');
  const infoReference = (key: string): string => {
    const value = info[key];
    if (!value || matches.length !== 1) return value;
    const infoDirectory = matches[0][0].replaceAll('\\', '/').split('/').slice(0, -1).join('/');
    return normalizePath(infoDirectory) === directory ? value : (infoDirectory ? infoDirectory + '/' : '') + value;
  };
  const infer = (extensions: RegExp): string => {
    const candidates = [...assets.keys()].filter(name => extensions.test(name) && normalizePath(name).split('/').slice(0, -1).join('/') === directory);
    const sameStem = candidates.filter(name => normalizePath(name).split('/').at(-1)!.replace(/\.[^.]+$/, '') === stem);
    return sameStem.length === 1 ? sameStem[0] : candidates.length === 1 ? candidates[0] : '';
  };
  const resolve = (names: (string | undefined)[], extensions: RegExp): string => names.find(name => name && assetBytes(assets, name, chartName)) || infer(extensions) || names.find(Boolean) || '';
  return { song: resolve([chart.META.song, infoReference('Song')], /\.(mp3|ogg|wav|flac|m4a|aac|opus|webm)$/i),
    background: resolve([chart.META.background, infoReference('Picture')], /\.(png|jpe?g|webp|gif|bmp|avif)$/i) };
}

/** The MIME type for a media file name, defaulting to a generic binary type. */
export function mediaType(name: string): string {
  const extension = name.split('.').at(-1)!.toLowerCase();
  return ({ mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/ogg', webm: 'audio/webm', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif' } as Record<string, string>)[extension] ?? 'application/octet-stream';
}

/**
 * Builds the entry map for an exported PEZ.
 *
 * A chart converted from another format is written beside its original rather than over it, so the
 * source document survives the round trip; the sibling `info.txt` is repointed at the new name.
 */
export function packageEntries(chart: Chart, assets: ArchiveEntries, chartName: string): ArchiveEntries {
  const output: ArchiveEntries = new Map(assets);
  let outputName = chartName;
  if (chart.rpeNextLegacySource) {
    const stem = chartName.replace(/\.(json|pec)$/i, '');
    outputName = stem + '.rpe.json';
    let suffix = 1;
    while ([...output.keys()].some(name => normalizePath(name) === normalizePath(outputName))) outputName = `${stem}.rpe-${suffix++}.json`;
  }
  output.set(outputName, new TextEncoder().encode(serializeChart(chart)));
  const effects = [chart.effects, chart.shaderEvents, chart.META?.effects].filter(Array.isArray).flat();
  for (const [lineIndex, line] of (chart.judgeLineList ?? []).entries()) for (const event of line.extended?.paintEvents ?? []) effects.push(serializeShaderEvent(event, lineIndex));
  if (effects.length || Array.isArray(chart.effects)) {
    const directory = outputName.replaceAll('\\', '/').split('/').slice(0, -1).join('/');
    const path = directory ? `${directory}/extra.json` : 'extra.json';
    const existing = [...output.keys()].find(name => normalizePath(name) === normalizePath(path));
    const extra = existing ? JSON.parse(decodeLegacy(output.get(existing)!)) as Record<string, unknown> : {};
    output.set(existing ?? path, new TextEncoder().encode(JSON.stringify({ ...extra, effects }, null, 2)));
  }
  if (outputName !== chartName) {
    for (const [name, bytes] of matchingInfo(assets, chartName)) {
      const directory = name.slice(0, name.lastIndexOf('/') + 1);
      const reference = outputName.slice(directory.length);
      const info = decodeLegacy(bytes);
      output.set(name, new TextEncoder().encode(info.replace(/^(Chart:[ \t]*)[^\r\n]*/m, (match, prefix: string) => prefix + reference)));
    }
  }
  return output;
}

export function exportPackage(chart: Chart, assets: ArchiveEntries, chartName: string): void {
  download(writeZip(packageEntries(chart, assets, chartName)), 'RPE-export.pez');
}

/** A finished export, ready to be handed to `download`. */
export interface ChartExportResult {
  blob: Blob;
  name: string;
}

/**
 * The four export combinations the dialog offers.
 *
 * `compatibility: 'rpe'` rewrites the chart through `legacyChart` so a pre-0.8.0 reader can open it;
 * `'next'` keeps whole-curve trajectories. It lives here rather than in the dialog because it is this
 * function's own parameter shape, and the two values are re-validated below rather than trusted — the
 * dialog is not the only possible caller.
 */
export interface ChartExportOptions {
  compatibility: 'next' | 'rpe';
  format: 'json' | 'pez';
  name: string;
  split: Partial<TrajectorySplit>;
}

export function createChartExport(chart: Chart, assets: ArchiveEntries, chartName: string, options: Partial<ChartExportOptions> = {}): ChartExportResult {
  const { format = 'pez', compatibility = 'next', name = chartName, split = {} } = options;
  if (!['json', 'pez'].includes(format) || !['next', 'rpe'].includes(compatibility)) throw new Error('导出格式无效');
  // `chartTime` is a scratch field some callers hang off the document; it is optional here so it can
  // be deleted, which is what the original did before serializing.
  const snapshot: Chart & { chartTime?: unknown } = compatibility === 'rpe' ? legacyChart(chart, split) : { ...chart };
  delete snapshot.chartTime;
  const stem = String(name).trim().replace(/\.(json|pez|pec|zip)$/i, '');
  if (!stem) throw new Error('请输入导出文件名');
  const blob = format === 'pez' ? writeZip(packageEntries(snapshot, assets, chartName)) : new Blob([serializeChart(snapshot)], { type: 'application/json' });
  return { blob, name: stem + '.' + format };
}
