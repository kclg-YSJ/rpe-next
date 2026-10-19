import { serializeChart, stringifyPreservingNumbers, EVENT_TYPES, EXTENDED_TYPES } from '../core/chart.ts';
import { parseDocument } from '../core/formats.ts';
import { readZip, writeZip, crc32, inspectZip } from './archive.ts';
import { decodeLegacy, parseInfo } from './legacy-text.ts';
import { serializeShaderEvent } from '../core/shader-events.ts';
import { expandTrajectory } from '../application/trajectory-commands.ts';
import { TempoMap } from '../core/tempo.ts';
import { beatValue } from '../core/beat.ts';
import { NOISE_TRACKS } from '../core/noise-areas.ts';
import { integerChartAlpha } from '../core/alpha-values.ts';
import { chartExportStem, safeExportStem, DownloadNames } from '../core/export-filename.ts';
import { isBackupChartFile, isChartDocumentFile } from '../core/chart-backups.ts';
import { collectExportAssetPaths } from './export-assets.ts';
import type { ArchiveEntries, ZipDirectory } from './archive.ts';
import type { Chart, ChartEvent, EventLayer, NoiseArea, TrajectorySplit } from '../core/types.ts';

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

/**
 * Import options for {@link openFiles}.
 *
 * `confirmLargeArchive` is asked before an archive that exceeds the normal limits is unpacked; a
 * falsy answer refuses the import rather than silently accepting a decompression bomb.
 */
export interface OpenFilesOptions {
  confirmLargeArchive?: (info: ZipDirectory) => boolean | Promise<boolean>;
  /** Whether autosave and backup chart files are imported as well. */
  includeBackupCharts?: boolean;
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
export async function openFiles(fileList: ArrayLike<File> & Iterable<File>, { confirmLargeArchive, includeBackupCharts = false }: OpenFilesOptions = {}): Promise<OpenedFiles | null> {
  const files = [...fileList];
  if (!files.length) return null;
  let assets: ArchiveEntries = new Map();
  if (files.length === 1 && /\.(pez|zip)$/i.test(files[0].name)) {
    const buffer = await files[0].arrayBuffer(), info = inspectZip(buffer);
    const large = info.declaredBytes > 1024 ** 3 || info.largestFile > 512 * 1024 ** 2 || info.count > 20000 || info.largestRatio > 500;
    if (large && !await confirmLargeArchive?.(info)) throw Object.assign(new Error('谱面包解压后的体积、文件数或压缩倍率过大，已停止导入；确认来源可信后可再次打开并确认。'), { name: 'ArchiveLimitError' });
    assets = await readZip(buffer, { maxFiles: large ? info.count : 20000, maxBytes: large ? info.declaredBytes : 1024 ** 3, maxFileBytes: large ? info.largestFile : 512 * 1024 ** 2,
      includeEntry: name => includeBackupCharts || !isBackupChartFile(name) });
  }
  else for (const file of files) if (includeBackupCharts || !isBackupChartFile(file.name)) assets.set(file.name, new Uint8Array(await file.arrayBuffer()));
  const candidates: ChartCandidate[] = [];
  const errors: string[] = [];
  for (const [name, bytes] of assets) {
    if (!isChartDocumentFile(name)) continue;
    try { candidates.push({ name, chart: parseDocument(decodeLegacy(bytes)) }); }
    catch (error) { errors.push(`${name}: ${(error as Error).message}`); }
  }
  if (!candidates.length) throw new Error(errors.join('\n') || '找不到可导入的谱面；自动保存及备份谱面默认忽略，可在设置的“导入与导出”中开启包含这些文件');
  attachExternalEffects(candidates, assets);
  for (const candidate of candidates) if (candidate.chart.rpeNextLegacySource?.format === 'phigros-v3') {
    const references = resourceReferences(candidate.chart, assets, candidate.name);
    // A name that reaches here always has at least one path segment, so `at(-1)` is present; the
    // fallback keeps the empty-name case total without changing the value for a real path.
    candidate.chart.META = { ...candidate.chart.META, name: (candidate.name.replaceAll('\\', '/').split('/').at(-1) ?? candidate.name).replace(/\.json$/i, ''), ...references };
  }
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
  // `assetPath` returns `null` only when no key matched, which is exactly the "no bytes" case; reading
  // through the resolved key keeps the two paths sharing one lookup.
  const path = assetPath(assets, name, chartName);
  return path === null ? null : assets.get(path) ?? null;
}

/**
 * Resolves a chart-relative asset name to the archive key that actually holds it, or `null`.
 *
 * Split out from {@link assetBytes} because export has to write the *name* it resolved rather than
 * the bytes, so both the read and the write paths go through the same lookup.
 */
export function assetPath(assets: ArchiveEntries, name: string, chartName = ''): string | null {
  if (!name) return null;
  const chartPath = chartName.replaceAll('\\', '/');
  const directory = chartPath.includes('/') ? chartPath.slice(0, chartPath.lastIndexOf('/') + 1) : '';
  if (assets.has(directory + name)) return directory + name;
  if (assets.has(name)) return name;
  const normalized = normalizePath(name);
  for (const target of [normalizePath(directory + name), normalized]) {
    const exact = [...assets].filter(([path]) => normalizePath(path) === target);
    if (exact.length === 1) return exact[0][0];
  }
  const matches = [...assets].filter(([path]) => normalizePath(path).split('/').at(-1) === normalized.split('/').at(-1));
  return matches.length === 1 ? matches[0][0] : null;
}

const downloadNames = new DownloadNames();

/** Suggests a download name without reserving it, so the user can see the final name in a dialog. */
export const suggestDownloadName = (name: unknown): string => downloadNames.suggest(name);

/** Saves a blob to disk through a temporary anchor, revoking the object URL once it is claimed. */
export function download(blob: Blob, name: string): string {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = downloadNames.reserve(name);
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers, so the URL is held briefly.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return link.download;
}

export function exportChart(chart: Chart, name: string): void {
  download(new Blob([serializeChart(orderedExportChart(chart))], { type: 'application/json' }), chartExportStem(chart, name) + '.json');
}

/**
 * Normalises a chart for export: integral alpha, tracks in beat order, shader vars in beat order.
 *
 * RPE reads each track in file order and lets a later event win a tie, so an export that preserved
 * the editor's arbitrary edit order could change how a chart plays. Sorting by start beat restores
 * the order the game would have produced from a freshly authored file.
 */
function orderedExportChart(chart: Chart): Chart {
  chart = integerChartAlpha(chart);
  const startBeat = (event: ChartEvent | undefined): number => {
    const time = event?.startTime ?? event?.start;
    return Array.isArray(time) ? beatValue(time) : Number.isFinite(time) ? Number(time) : 0;
  };
  const ordered = <T extends { startTime?: unknown }>(events: T[]): T[] => [...events].sort((left, right) => startBeat(left as unknown as ChartEvent) - startBeat(right as unknown as ChartEvent));
  // A shader event's `vars` may hold nested effect lists, which are tracks in their own right.
  const shader = (event: ChartEvent): ChartEvent => {
    if (!event?.vars) return event;
    const vars = event.vars as Record<string, unknown>;
    return { ...event, vars: Object.fromEntries(Object.entries(vars).map(([name, value]) => [name,
      Array.isArray(value) && value.length && value.every(entry => entry && typeof entry === 'object' && !Array.isArray(entry) && ('startTime' in entry || 'start' in entry)) ? ordered(value as ChartEvent[]) : value])) };
  };
  const effects = (events: ChartEvent[]): ChartEvent[] => ordered(events).map(shader);
  const orderedLayer = (layer: EventLayer | undefined): EventLayer | undefined => {
    if (!layer) return layer;
    const output: EventLayer = { ...layer };
    for (const type of [...EVENT_TYPES, ...EXTENDED_TYPES]) {
      const track = layer[type];
      if (Array.isArray(track)) output[type] = type === 'paintEvents' ? effects(track) : ordered(track);
    }
    return output;
  };
  // The open-ended `Chart` bag is read member by member below, so it is narrowed once here.
  const document = chart as Chart & { effects?: ChartEvent[]; shaderEvents?: ChartEvent[] };
  return { ...chart, judgeLineList: (chart.judgeLineList ?? []).map(line => ({ ...line,
    eventLayers: line.eventLayers?.map(orderedLayer) as EventLayer[], extended: orderedLayer(line.extended) as EventLayer })),
    // The spread of a `NoiseArea` and the reordered track map still carries every required field, so
    // the callback's return type is annotated rather than cast: the literal is checked against
    // `NoiseArea` directly, which is what the open-ended `blockAreaList` entry needs.
    ...(Array.isArray(chart.blockAreaList) ? { blockAreaList: (chart.blockAreaList as NoiseArea[]).map((area): NoiseArea => ({ ...area,
      ...Object.fromEntries(NOISE_TRACKS.filter(([type]) => Array.isArray(area[type])).map(([type]) => [type, ordered(area[type] as ChartEvent[])])) })) } : {}),
    ...(Array.isArray(document.effects) ? { effects: effects(document.effects) } : {}),
    ...(Array.isArray(document.shaderEvents) ? { shaderEvents: effects(document.shaderEvents) } : {}),
    ...(chart.globalEvents ? { globalEvents: { ...chart.globalEvents, types: Object.fromEntries(Object.entries(chart.globalEvents.types).map(([id, type]) => [id, { ...type, columns: Object.fromEntries(Object.entries(type.columns).map(([key, column]) => [key, { ...column, events: ordered(column.events) }])) }])) } } : {}),
    ...(Array.isArray(chart.META?.effects) ? { META: { ...chart.META, effects: effects(chart.META.effects as ChartEvent[]) } } : {}) };
}

/**
 * Rewrites a chart so that pre-0.8.0 readers can open it.
 *
 * Every whole-curve trajectory on the X track is expanded into the ordinary per-event fragments those
 * readers understand, and the trajectory event itself is dropped. `splitSettings` is merged over each
 * trajectory's own recorded split by `trajectorySplitSettings`. Noise areas have no legacy
 * representation at all, so a chart that still carries them is refused rather than silently stripped.
 */
export function legacyChart(chart: Chart, splitSettings: Partial<TrajectorySplit> = {}): Chart {
  if (chart.blockAreaList?.length) throw new Error('原 RPE 不支持噪域，请在导出窗口明确选择移除噪域后导出');
  if (Object.values(chart.globalEvents?.types ?? {}).some(type => Object.values(type.columns).some(column => column.events.length))) throw new Error('原 RPE 不支持全局事件，请在导出窗口明确选择移除全局事件后导出');
  const next = structuredClone(chart);
  delete next.blockAreaList;
  delete next.noiseAreaOptions;
  delete next.noiseAreaLayers;
  delete next.globalEvents;
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
  return orderedExportChart(next);
}

export function exportLegacyChart(chart: Chart, name: string): void {
  download(new Blob([serializeChart(legacyChart(chart))], { type: 'application/json' }), chartExportStem(chart, name) + '.rpe.json');
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
 * The `info.txt` an export should read, preferring an exact name match over a lone candidate.
 *
 * An archive can hold several; `info.txt` is the conventional one, and a single unrelated match is
 * still accepted because a PEZ authored by another tool may name it differently.
 */
function primaryInfo(assets: ArchiveEntries, chartName: string): [string, Uint8Array] | null {
  const matches = matchingInfo(assets, chartName);
  return matches.find(([name]) => name.toLowerCase() === 'info.txt') ?? (matches.length === 1 ? matches[0] : null);
}

/**
 * Determines which archive entries a chart uses for its song and illustration.
 *
 * Preference order is the chart's own metadata, then the sibling `info.txt`, then inference from
 * the files sitting next to the chart. Inference only accepts an unambiguous candidate.
 */
export function resourceReferences(chart: Chart, assets: ArchiveEntries, chartName: string, fallback: Record<string, string> = {}): ResourceReferences {
  const match = primaryInfo(assets, chartName);
  const info = match ? parseInfo(decodeLegacy(match[1])) : fallback;
  const normalizedChart = normalizePath(chartName);
  const directory = normalizedChart.split('/').slice(0, -1).join('/');
  const stem = normalizedChart.split('/').at(-1)!.replace(/\.[^.]+$/, '');
  const infoReference = (key: string): string => {
    const value = info[key];
    if (!value || !match) return value;
    const infoDirectory = match[0].replaceAll('\\', '/').split('/').slice(0, -1).join('/');
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
 * Renders the `info.txt` an exported PEZ carries.
 *
 * The `Path` field names the folder the game installs the chart into, so it is sanitised against the
 * characters Windows forbids and the reserved device names; when the caller's identifier or the
 * source `info.txt` offers nothing usable, a CRC of the chart's name stands in, which is stable for
 * the same chart and unlikely to collide with a sibling.
 */
function packageInfo(chart: Chart, assets: ArchiveEntries, chartName: string, outputName: string, identifier: string | undefined): Uint8Array {
  const match = primaryInfo(assets, chartName);
  const info: Record<string, string> = match ? parseInfo(decodeLegacy(match[1])) : {};
  const meta = chart.META;
  const references = resourceReferences(chart, assets, chartName);
  const singleLine = (value: unknown): string => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  const candidate = String(identifier || info.Path || meta.id || '').trim();
  const path = /^(?!\.{1,2}$)[^<>:"/\\|?*\x00-\x1f]{1,80}$/.test(candidate) && !/[. ]$/.test(candidate)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(candidate)
    ? candidate : String(crc32(new TextEncoder().encode(`${meta.name ?? ''}\n${chartName}`)));
  const fields = { Name: meta.name ?? info.Name ?? '', Path: path,
    Song: assetPath(assets, references.song, chartName) ?? '', Picture: assetPath(assets, references.background, chartName) ?? '',
    Chart: outputName, Level: meta.level ?? info.Level ?? '', Composer: meta.composer ?? info.Composer ?? '',
    Charter: meta.charter ?? info.Charter ?? '', Illustration: meta.illustration ?? info.Illustration ?? '' };
  return new TextEncoder().encode('#\n' + Object.entries(fields).map(([key, value]) => `${key}: ${singleLine(value)}\n`).join(''));
}

/** The knobs the export dialog passes down; `compact` and `removeNoiseAreas` are the two that matter. */
export interface PackageOptions {
  /** Whether to write the JSON without indentation. Defaults to compact. */
  compact?: boolean;
  /** Whether a 原 RPE export should drop the noise areas it cannot represent. */
  removeNoiseAreas?: boolean;
  /** Whether a 原 RPE export may drop global events, which that reader cannot represent. */
  removeGlobalEvents?: boolean;
  /** The folder name the game should install the chart into. */
  identifier?: string;
  /** Whether autosave and backup chart files stay in the package. */
  includeBackupCharts?: boolean;
  /** Whether files the chart does not reference are kept. */
  includeUnusedFiles?: boolean;
}

/**
 * Builds the entry map for an exported PEZ.
 *
 * A chart converted from another format is written beside its original rather than over it, so the
 * source document survives the round trip; the sibling `info.txt` is repointed at the new name.
 */
export function packageEntries(chart: Chart, assets: ArchiveEntries, chartName: string, options: PackageOptions = {}): ArchiveEntries {
  chart = orderedExportChart(chart);
  const output: ArchiveEntries = new Map([...assets].filter(([name]) => options.includeBackupCharts || !isBackupChartFile(name)));
  let outputName = chartName;
  if (!options.includeBackupCharts && isBackupChartFile(outputName)) {
    const directory = outputName.replaceAll('\\', '/').split('/').slice(0, -1).join('/');
    const stem = (directory ? directory + '/' : '') + 'chart';
    outputName = stem + '.json';
    let suffix = 1;
    while ([...output.keys()].some(name => normalizePath(name) === normalizePath(outputName))) outputName = `${stem}-${suffix++}.json`;
  }
  if (chart.rpeNextLegacySource) {
    const stem = outputName.replace(/\.(json|pec)(?:\.(?:bak|backup)(?:\.\d+)?)?$/i, '');
    outputName = stem + '.rpe.json';
    let suffix = 1;
    while ([...output.keys()].some(name => normalizePath(name) === normalizePath(outputName))) outputName = `${stem}.rpe-${suffix++}.json`;
  }
  output.set(outputName, new TextEncoder().encode(serializeChart(chart, { compact: options.compact !== false })));
  const effects: unknown[] = [chart.effects, chart.shaderEvents, chart.META?.effects].filter(Array.isArray).flat();
  for (const [lineIndex, line] of (chart.judgeLineList ?? []).entries()) for (const event of line.extended?.paintEvents ?? []) effects.push(serializeShaderEvent(event, lineIndex));
  effects.sort((left, right) => {
    // Each entry is either a raw event or an already-serialised shader record; both shapes are probed
    // here rather than assumed, which is what the original's untyped reads did.
    const start = (event: unknown): number => {
      const record = event as { startTime?: unknown; start?: unknown } | null | undefined;
      const value = record?.startTime ?? record?.start;
      return Array.isArray(value) ? beatValue(value) : typeof value === 'number' && Number.isFinite(value) ? value : 0;
    };
    return start(left) - start(right);
  });
  if (effects.length || Array.isArray(chart.effects)) {
    const directory = outputName.replaceAll('\\', '/').split('/').slice(0, -1).join('/');
    const path = directory ? `${directory}/extra.json` : 'extra.json';
    const existing = [...output.keys()].find(name => normalizePath(name) === normalizePath(path));
    const extra = existing ? JSON.parse(decodeLegacy(output.get(existing) as Uint8Array)) as Record<string, unknown> : {};
    output.set(existing ?? path, new TextEncoder().encode(stringifyPreservingNumbers({ ...extra, effects }, options.compact === false ? 2 : 0)));
  }
  if (outputName !== chartName) {
    for (const [name, bytes] of matchingInfo(assets, chartName)) {
      const directory = name.slice(0, name.lastIndexOf('/') + 1);
      const reference = outputName.slice(directory.length);
      const info = decodeLegacy(bytes);
      output.set(name, new TextEncoder().encode(info.replace(/^(Chart:[ \t]*)[^\r\n]*/m, (match, prefix: string) => prefix + reference)));
    }
  }
  for (const name of output.keys()) if (name.toLowerCase() === 'info.txt') output.delete(name);
  output.set('info.txt', packageInfo(chart, assets, chartName, outputName, options.identifier));
  if (!options.includeUnusedFiles) {
    const directory = outputName.replaceAll('\\', '/').split('/').slice(0, -1).join('/');
    const extra = (directory ? directory + '/' : '') + 'extra.json';
    const extraPath = [...output.keys()].find(name => normalizePath(name) === normalizePath(extra));
    const roots = [outputName, 'info.txt', ...matchingInfo(output, outputName).map(([name]) => name), ...(extraPath ? [extraPath] : [])];
    const used = collectExportAssetPaths(chart, output, chartName, { resolve: assetPath, media: resourceReferences(chart, assets, chartName), roots, mainFile: outputName, includeBackupCharts: options.includeBackupCharts });
    for (const name of output.keys()) if (!used.has(name)) output.delete(name);
  }
  return output;
}

export function exportPackage(chart: Chart, assets: ArchiveEntries, chartName: string): void {
  download(writeZip(packageEntries(chart, assets, chartName)), chartExportStem(chart, chartName) + '.pez');
}

/** A finished export, ready to be handed to `download`. */
export interface ChartExportResult {
  blob: Blob;
  name: string;
}

/**
 * The export combinations the dialog offers.
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
  /** Whether to write the JSON without indentation. Defaults to compact. */
  compact?: boolean;
  /**
   * Whether a 原 RPE export may drop the noise areas that reader cannot represent.
   *
   * Off by default, so `legacyChart` refuses the export and the user is told to opt in rather than
   * silently losing the areas.
   */
  removeNoiseAreas?: boolean;
  /** Whether a 原 RPE export may drop global events, which that reader cannot represent. */
  removeGlobalEvents?: boolean;
  /** The folder name the game should install the chart into. */
  identifier?: string;
  /** Whether autosave and backup chart files stay in the package. */
  includeBackupCharts?: boolean;
  /** Whether files the chart does not reference are kept. */
  includeUnusedFiles?: boolean;
}

export function createChartExport(chart: Chart, assets: ArchiveEntries, chartName: string, options: Partial<ChartExportOptions> = {}): ChartExportResult {
  const { format = 'pez', compatibility = 'next', name, split = {} } = options;
  if (!['json', 'pez'].includes(format) || !['next', 'rpe'].includes(compatibility)) throw new Error('导出格式无效');
  // `chartTime` is a scratch field some callers hang off the document; it is optional here so it can
  // be deleted, which is what the original did before serializing.
  let source: Chart & { chartTime?: unknown } = compatibility === 'rpe' && options.removeNoiseAreas ? { ...chart, blockAreaList: [] } : chart;
  if (compatibility === 'rpe' && options.removeGlobalEvents) { source = { ...source }; delete source.globalEvents; }
  const snapshot: Chart & { chartTime?: unknown } = compatibility === 'rpe' ? legacyChart(source, split) : orderedExportChart(chart);
  delete snapshot.chartTime;
  if (name !== undefined && !String(name).trim()) throw new Error('请输入导出文件名');
  const stem = name === undefined ? chartExportStem(chart, chartName) : safeExportStem(name);
  const blob = format === 'pez' ? writeZip(packageEntries(snapshot, assets, chartName, options)) : new Blob([serializeChart(snapshot, { compact: options.compact !== false })], { type: 'application/json' });
  return { blob, name: stem + '.' + format };
}
