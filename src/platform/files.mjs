import { serializeChart, stringifyPreservingNumbers, EVENT_TYPES, EXTENDED_TYPES } from '../core/chart.mjs';
import { parseDocument } from '../core/formats.mjs';
import { readZip, writeZip, crc32, inspectZip } from './archive.mjs';
import { decodeLegacy, parseInfo } from './legacy-text.mjs';
import { serializeShaderEvent } from '../core/shader-events.mjs';
import { expandTrajectory } from '../application/trajectory-commands.mjs';
import { TempoMap } from '../core/tempo.mjs';
import { beatValue } from '../core/beat.mjs';
import { NOISE_TRACKS } from '../core/noise-areas.mjs';
import { integerChartAlpha } from '../core/alpha-values.mjs';
import { chartExportStem, safeExportStem, DownloadNames } from '../core/export-filename.mjs';
import { isBackupChartFile, isChartDocumentFile } from '../core/chart-backups.mjs';
import { collectExportAssetPaths } from './export-assets.mjs';
import { t } from '../i18n.mjs';

export async function openFiles(fileList, { confirmLargeArchive, includeBackupCharts = false } = {}) {
  const files = [...fileList];
  if (!files.length) return null;
  let assets = new Map();
  if (files.length === 1 && /\.(pez|zip)$/i.test(files[0].name)) {
    const buffer = await files[0].arrayBuffer(), info = inspectZip(buffer);
    const large = info.declaredBytes > 1024 ** 3 || info.largestFile > 512 * 1024 ** 2 || info.count > 20000 || info.largestRatio > 500;
    if (large && !await confirmLargeArchive?.(info)) throw Object.assign(new Error(t('files.s1fe13d6')), { name: 'ArchiveLimitError' });
    assets = await readZip(buffer, { maxFiles: large ? info.count : 20000, maxBytes: large ? info.declaredBytes : 1024 ** 3, maxFileBytes: large ? info.largestFile : 512 * 1024 ** 2,
      includeEntry: name => includeBackupCharts || !isBackupChartFile(name) });
  }
  else for (const file of files) if (includeBackupCharts || !isBackupChartFile(file.name)) assets.set(file.name, new Uint8Array(await file.arrayBuffer()));
  const candidates = [];
  const errors = [];
  for (const [name, bytes] of assets) {
    if (!isChartDocumentFile(name)) continue;
    try { candidates.push({ name, chart: parseDocument(decodeLegacy(bytes)) }); }
    catch (error) { errors.push(`${name}: ${error.message}`); }
  }
  if (!candidates.length) throw new Error(errors.join('\n') || t('files.s347b063'));
  attachExternalEffects(candidates, assets);
  for (const candidate of candidates) if (candidate.chart.rpeNextLegacySource?.format === 'phigros-v3') {
    const references = resourceReferences(candidate.chart, assets, candidate.name);
    candidate.chart.META = { ...candidate.chart.META, name: candidate.name.replaceAll('\\', '/').split('/').at(-1).replace(/\.json$/i, ''), ...references };
  }
  return { candidates, assets };
}

export function attachExternalEffects(candidates, assets) {
  const extras = [...assets.entries()].filter(([name]) => name.replaceAll('\\', '/').split('/').at(-1).toLowerCase() === 'extra.json');
  for (const candidate of candidates) {
    if (Array.isArray(candidate.chart.effects)) continue;
    const chartDirectory = candidate.name.replaceAll('\\', '/').split('/').slice(0, -1).join('/').toLowerCase();
    const matches = extras.filter(([name]) => name.replaceAll('\\', '/').split('/').slice(0, -1).join('/').toLowerCase() === chartDirectory);
    const fallback = matches.length ? matches : candidates.length === 1 && extras.length === 1 ? extras : [];
    for (const [, bytes] of fallback) {
      try {
        const extra = JSON.parse(decodeLegacy(bytes));
        if (Array.isArray(extra.effects)) { candidate.chart.effects = extra.effects; break; }
      } catch { /* extra.json is optional and may belong to another RPE project. */ }
    }
  }
}

export function assetBytes(assets, name, chartName = '') {
  return assets.get(assetPath(assets, name, chartName)) ?? null;
}

export function assetPath(assets, name, chartName = '') {
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
export const suggestDownloadName = name => downloadNames.suggest(name);

export function download(blob, name) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = downloadNames.reserve(name);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return link.download;
}

export function exportChart(chart, name) {
  download(new Blob([serializeChart(orderedExportChart(chart))], { type: 'application/json' }), chartExportStem(chart, name) + '.json');
}

function orderedExportChart(chart) {
  chart = integerChartAlpha(chart);
  const startBeat = event => {
    const time = event?.startTime ?? event?.start;
    return Array.isArray(time) ? beatValue(time) : Number.isFinite(time) ? time : 0;
  };
  const ordered = events => [...events].sort((left, right) => startBeat(left) - startBeat(right));
  const shader = event => {
    if (!event?.vars) return event;
    return { ...event, vars: Object.fromEntries(Object.entries(event.vars).map(([name, value]) => [name,
      Array.isArray(value) && value.length && value.every(entry => entry && typeof entry === 'object' && !Array.isArray(entry) && ('startTime' in entry || 'start' in entry)) ? ordered(value) : value])) };
  };
  const effects = events => ordered(events).map(shader);
  const orderedLayer = layer => {
    if (!layer) return layer;
    const output = { ...layer };
    for (const type of [...EVENT_TYPES, ...EXTENDED_TYPES]) {
      if (Array.isArray(layer[type])) output[type] = type === 'paintEvents' ? effects(layer[type]) : ordered(layer[type]);
    }
    return output;
  };
  return { ...chart, judgeLineList: (chart.judgeLineList ?? []).map(line => ({ ...line,
    eventLayers: line.eventLayers?.map(orderedLayer), extended: orderedLayer(line.extended) })),
    ...(Array.isArray(chart.blockAreaList) ? { blockAreaList: chart.blockAreaList.map(area => ({ ...area,
      ...Object.fromEntries(NOISE_TRACKS.filter(([type]) => Array.isArray(area[type])).map(([type]) => [type, ordered(area[type])])) })) } : {}),
    ...(Array.isArray(chart.effects) ? { effects: effects(chart.effects) } : {}),
    ...(Array.isArray(chart.shaderEvents) ? { shaderEvents: effects(chart.shaderEvents) } : {}),
    ...(chart.globalEvents ? { globalEvents: { ...chart.globalEvents, types: Object.fromEntries(Object.entries(chart.globalEvents.types).map(([id, type]) => [id, { ...type, columns: Object.fromEntries(Object.entries(type.columns).map(([key, column]) => [key, { ...column, events: ordered(column.events) }])) }])) } } : {}),
    ...(Array.isArray(chart.META?.effects) ? { META: { ...chart.META, effects: effects(chart.META.effects) } } : {}) };
}

export function legacyChart(chart, splitSettings = {}) {
  if (chart.blockAreaList?.length) throw new Error(t('files.s82aa779'));
  if (Object.values(chart.globalEvents?.types ?? {}).some(type => Object.values(type.columns).some(column => column.events.length))) throw new Error(t('files.s91b752c'));
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
      layer.moveXEvents = layer.moveXEvents.filter(event => !event.trajectory);
      for (const event of trajectories) for (const [type, fragments] of expandTrajectory(event, tempo, line.bpmfactor ?? 1, splitSettings)) layer[type] = [...(layer[type] ?? []), ...fragments].sort((left, right) => beatValue(left.startTime) - beatValue(right.startTime));
    }
  }
  return orderedExportChart(next);
}

export function exportLegacyChart(chart, name) {
  download(new Blob([serializeChart(legacyChart(chart))], { type: 'application/json' }), chartExportStem(chart, name) + '.rpe.json');
}

function normalizePath(path) {
  const parts = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/').toLowerCase();
}

function matchingInfo(assets, chartName) {
  return [...assets].filter(([name, bytes]) => {
    name = name.replaceAll('\\', '/');
    if (name.split('/').at(-1).toLowerCase() !== 'info.txt') return false;
    const reference = parseInfo(decodeLegacy(bytes)).Chart;
    const directory = name.slice(0, name.lastIndexOf('/') + 1);
    return reference && normalizePath(directory + reference) === normalizePath(chartName);
  });
}

function primaryInfo(assets, chartName) {
  const matches = matchingInfo(assets, chartName);
  return matches.find(([name]) => name.toLowerCase() === 'info.txt') ?? (matches.length === 1 ? matches[0] : null);
}

export function resourceReferences(chart, assets, chartName, fallback = {}) {
  const match = primaryInfo(assets, chartName);
  const info = match ? parseInfo(decodeLegacy(match[1])) : fallback;
  const normalizedChart = normalizePath(chartName);
  const directory = normalizedChart.split('/').slice(0, -1).join('/');
  const stem = normalizedChart.split('/').at(-1).replace(/\.[^.]+$/, '');
  const infoReference = key => {
    const value = info[key];
    if (!value || !match) return value;
    const infoDirectory = match[0].replaceAll('\\', '/').split('/').slice(0, -1).join('/');
    return normalizePath(infoDirectory) === directory ? value : (infoDirectory ? infoDirectory + '/' : '') + value;
  };
  const infer = extensions => {
    const candidates = [...assets.keys()].filter(name => extensions.test(name) && normalizePath(name).split('/').slice(0, -1).join('/') === directory);
    const sameStem = candidates.filter(name => normalizePath(name).split('/').at(-1).replace(/\.[^.]+$/, '') === stem);
    return sameStem.length === 1 ? sameStem[0] : candidates.length === 1 ? candidates[0] : '';
  };
  const resolve = (names, extensions) => names.find(name => name && assetBytes(assets, name, chartName)) || infer(extensions) || names.find(Boolean) || '';
  return { song: resolve([chart.META.song, infoReference('Song')], /\.(mp3|ogg|wav|flac|m4a|aac|opus|webm)$/i),
    background: resolve([chart.META.background, infoReference('Picture')], /\.(png|jpe?g|webp|gif|bmp|avif)$/i) };
}

export function mediaType(name) {
  const extension = name.split('.').at(-1).toLowerCase();
  return ({ mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/ogg', webm: 'audio/webm', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif' })[extension] ?? 'application/octet-stream';
}

function packageInfo(chart, assets, chartName, outputName, identifier) {
  const match = primaryInfo(assets, chartName);
  const info = match ? parseInfo(decodeLegacy(match[1])) : {};
  const meta = chart.META;
  const references = resourceReferences(chart, assets, chartName);
  const singleLine = value => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim();
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

export function packageEntries(chart, assets, chartName, options = {}) {
  chart = orderedExportChart(chart);
  const output = new Map([...assets].filter(([name]) => options.includeBackupCharts || !isBackupChartFile(name)));
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
  const effects = [chart.effects, chart.shaderEvents, chart.META?.effects].filter(Array.isArray).flat();
  for (const [lineIndex, line] of (chart.judgeLineList ?? []).entries()) for (const event of line.extended?.paintEvents ?? []) effects.push(serializeShaderEvent(event, lineIndex));
  effects.sort((left, right) => {
    const start = event => { const value = event?.startTime ?? event?.start; return Array.isArray(value) ? beatValue(value) : Number.isFinite(value) ? value : 0; };
    return start(left) - start(right);
  });
  if (effects.length || Array.isArray(chart.effects)) {
    const directory = outputName.replaceAll('\\', '/').split('/').slice(0, -1).join('/');
    const path = directory ? `${directory}/extra.json` : 'extra.json';
    const existing = [...output.keys()].find(name => normalizePath(name) === normalizePath(path));
    const extra = existing ? JSON.parse(decodeLegacy(output.get(existing))) : {};
    output.set(existing ?? path, new TextEncoder().encode(stringifyPreservingNumbers({ ...extra, effects }, options.compact === false ? 2 : 0)));
  }
  if (outputName !== chartName) {
    for (const [name, bytes] of matchingInfo(assets, chartName)) {
      const directory = name.slice(0, name.lastIndexOf('/') + 1);
      const reference = outputName.slice(directory.length);
      const info = decodeLegacy(bytes);
      output.set(name, new TextEncoder().encode(info.replace(/^(Chart:[ \t]*)[^\r\n]*/m, (match, prefix) => prefix + reference)));
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

export function exportPackage(chart, assets, chartName) {
  download(writeZip(packageEntries(chart, assets, chartName)), chartExportStem(chart, chartName) + '.pez');
}

export function createChartExport(chart, assets, chartName, options = {}) {
  const { format = 'pez', compatibility = 'next', name, split = {} } = options;
  if (!['json', 'pez'].includes(format) || !['next', 'rpe'].includes(compatibility)) throw new Error(t('files.sca076d2'));
  let source = compatibility === 'rpe' && options.removeNoiseAreas ? { ...chart, blockAreaList: [] } : chart;
  if (compatibility === 'rpe' && options.removeGlobalEvents) { source = { ...source }; delete source.globalEvents; }
  const snapshot = compatibility === 'rpe' ? legacyChart(source, split) : orderedExportChart(chart);
  delete snapshot.chartTime;
  if (name !== undefined && !String(name).trim()) throw new Error(t('files.sc04226c'));
  const stem = name === undefined ? chartExportStem(chart, chartName) : safeExportStem(name);
  const blob = format === 'pez' ? writeZip(packageEntries(snapshot, assets, chartName, options)) : new Blob([serializeChart(snapshot, { compact: options.compact !== false })], { type: 'application/json' });
  return { blob, name: stem + '.' + format };
}
