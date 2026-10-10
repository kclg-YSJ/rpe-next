import { serializeChart } from '../core/chart.mjs';
import { parseDocument } from '../core/formats.mjs';
import { readZip, writeZip } from './archive.mjs';
import { decodeLegacy, parseInfo } from './legacy-text.mjs';
import { serializeShaderEvent } from '../core/shader-events.mjs';
import { expandTrajectory } from '../application/trajectory-commands.mjs';
import { TempoMap } from '../core/tempo.mjs';
import { beatValue } from '../core/beat.mjs';

export async function openFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return null;
  let assets = new Map();
  if (files.length === 1 && /\.(pez|zip)$/i.test(files[0].name)) assets = await readZip(await files[0].arrayBuffer());
  else for (const file of files) assets.set(file.name, new Uint8Array(await file.arrayBuffer()));
  const candidates = [];
  const errors = [];
  for (const [name, bytes] of assets) {
    if (!/\.(json|pec)$/i.test(name)) continue;
    try { candidates.push({ name, chart: parseDocument(decodeLegacy(bytes)) }); }
    catch (error) { errors.push(`${name}: ${error.message}`); }
  }
  if (!candidates.length) throw new Error(errors.join('\n') || '找不到 RPE JSON 谱面');
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

export function download(blob, name) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function exportChart(chart, name) {
  download(new Blob([serializeChart(chart)], { type: 'application/json' }), name.replace(/\.(pec|pez|zip)$/i, '.json'));
}

export function legacyChart(chart, splitSettings = {}) {
  if (chart.blockAreaList?.length) throw new Error('原 RPE 不支持噪域，请在导出窗口明确选择移除噪域后导出');
  const next = structuredClone(chart);
  delete next.blockAreaList;
  delete next.noiseAreaOptions;
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
  return next;
}

export function exportLegacyChart(chart, name) {
  download(new Blob([serializeChart(legacyChart(chart))], { type: 'application/json' }), name.replace(/\.(json|pec|pez|zip)$/i, '') + '.rpe.json');
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

export function resourceReferences(chart, assets, chartName, fallback = {}) {
  const matches = matchingInfo(assets, chartName);
  const info = matches.length === 1 ? parseInfo(decodeLegacy(matches[0][1])) : fallback;
  const normalizedChart = normalizePath(chartName);
  const directory = normalizedChart.split('/').slice(0, -1).join('/');
  const stem = normalizedChart.split('/').at(-1).replace(/\.[^.]+$/, '');
  const infoReference = key => {
    const value = info[key];
    if (!value || matches.length !== 1) return value;
    const infoDirectory = matches[0][0].replaceAll('\\', '/').split('/').slice(0, -1).join('/');
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

export function packageEntries(chart, assets, chartName) {
  const output = new Map(assets);
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
    const extra = existing ? JSON.parse(decodeLegacy(output.get(existing))) : {};
    output.set(existing ?? path, new TextEncoder().encode(JSON.stringify({ ...extra, effects }, null, 2)));
  }
  if (outputName !== chartName) {
    for (const [name, bytes] of matchingInfo(assets, chartName)) {
      const directory = name.slice(0, name.lastIndexOf('/') + 1);
      const reference = outputName.slice(directory.length);
      const info = decodeLegacy(bytes);
      output.set(name, new TextEncoder().encode(info.replace(/^(Chart:[ \t]*)[^\r\n]*/m, (match, prefix) => prefix + reference)));
    }
  }
  return output;
}

export function exportPackage(chart, assets, chartName) {
  download(writeZip(packageEntries(chart, assets, chartName)), 'RPE-export.pez');
}

export function createChartExport(chart, assets, chartName, options = {}) {
  const { format = 'pez', compatibility = 'next', name = chartName, split = {} } = options;
  if (!['json', 'pez'].includes(format) || !['next', 'rpe'].includes(compatibility)) throw new Error('导出格式无效');
  const source = compatibility === 'rpe' && options.removeNoiseAreas ? { ...chart, blockAreaList: [] } : chart;
  const snapshot = compatibility === 'rpe' ? legacyChart(source, split) : { ...chart };
  delete snapshot.chartTime;
  const stem = String(name).trim().replace(/\.(json|pez|pec|zip)$/i, '');
  if (!stem) throw new Error('请输入导出文件名');
  const blob = format === 'pez' ? writeZip(packageEntries(snapshot, assets, chartName)) : new Blob([serializeChart(snapshot)], { type: 'application/json' });
  return { blob, name: stem + '.' + format };
}
