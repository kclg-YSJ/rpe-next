import { openFiles, resourceReferences } from './files.mjs';
import { joinList, t } from '../i18n.mjs';

const accepts = { pez: '.pez,.zip', json: '.json,.pec', music: 'audio/*', cover: 'image/*', separate: '' };
const extensions = {
  pez: /\.(pez|zip)$/i,
  json: /\.(json|pec)$/i,
  music: /\.(mp3|ogg|oga|wav|flac|m4a|aac|opus|webm|weba|aif|aiff)$/i,
  cover: /\.(png|jpe?g|webp|gif|bmp|avif|apng|svg|heic|heif)$/i,
};

export function chartImportAccept(kind, device = globalThis.navigator ?? {}) {
  const ios = /iPad|iPhone|iPod/i.test(device.userAgent ?? '')
    || device.platform === 'MacIntel' && device.maxTouchPoints > 1;
  return ios && (kind === 'pez' || kind === 'json' || kind === 'separate') ? '' : accepts[kind];
}

export function isChartImportFile(kind, file) {
  if (!file || !extensions[kind]) return false;
  return extensions[kind].test(file.name)
    || kind === 'music' && /^audio\//i.test(file.type)
    || kind === 'cover' && /^image\//i.test(file.type);
}

function chartImportKind(file) {
  if (file.name.replaceAll('\\', '/').split('/').at(-1).toLowerCase() === 'extra.json') return null;
  const kinds = ['json', 'music', 'cover'];
  return kinds.find(kind => extensions[kind].test(file.name)) ?? kinds.find(kind => isChartImportFile(kind, file));
}

export function assignChartImportFiles(fileList, selected = {}, preferredKind) {
  const kinds = ['json', 'music', 'cover'];
  const grouped = Object.fromEntries(kinds.map(kind => [kind, []]));
  const all = new Map([...kinds.map(kind => selected[kind]).filter(Boolean), ...(selected.additional ?? [])].map(file => [file.name.toLowerCase(), file]));
  const names = new Set();
  for (const file of fileList) {
    const name = file.name.toLowerCase();
    if (names.has(name)) throw Error(t('chart-import.duplicate'));
    names.add(name);
    if (extensions.pez.test(file.name)) throw Error(t('chart-import.unsupportedBatch', { name: file.name }));
    all.set(name, file);
    const kind = chartImportKind(file);
    if (kind) grouped[kind].push(file);
  }
  const assigned = { ...selected }, automatic = { ...selected.automatic };
  for (const kind of kinds) {
    const files = grouped[kind];
    if (assigned[kind]) assigned[kind] = all.get(assigned[kind].name.toLowerCase());
    if (files.length === 1 && preferredKind === kind) {
      if (assigned[kind] && !automatic[kind] && !names.has(assigned[kind].name.toLowerCase())) all.delete(assigned[kind].name.toLowerCase());
      assigned[kind] = files[0];
      delete automatic[kind];
    } else if (kind === 'json') {
      if (!assigned[kind] && files.length) assigned[kind] = files[0];
    } else if (!assigned[kind] || automatic[kind]) {
      const candidates = [...all.values()].filter(file => chartImportKind(file) === kind);
      assigned[kind] = candidates.length === 1 ? candidates[0] : undefined;
      if (assigned[kind]) automatic[kind] = true; else delete automatic[kind];
    }
  }
  for (const kind of kinds) if (assigned[kind]) all.delete(assigned[kind].name.toLowerCase());
  assigned.additional = [...all.values()];
  assigned.automatic = automatic;
  return assigned;
}

export function chartImportFiles(mode, selected) {
  if (mode !== 'pez' && mode !== 'separate') throw Error(t('chart-import.chooseMode'));
  const kinds = mode === 'pez' ? ['pez'] : ['json', 'music', 'cover'];
  const missing = (mode === 'pez' ? ['pez'] : ['json']).filter(kind => !selected[kind]);
  if (missing.length) throw Error(t('chart-import.missing', { files: joinList(missing.map(kind => t('chart-import.' + kind))) }));
  for (const kind of kinds) if (selected[kind] && !isChartImportFile(kind, selected[kind])) {
    throw Error(t('chart-import.invalid', { kind: t('chart-import.' + kind), name: selected[kind].name }));
  }
  const files = [...new Set([...kinds.map(kind => selected[kind]).filter(Boolean), ...(mode === 'separate' ? selected.additional ?? [] : [])])];
  if (new Set(files.map(file => file.name.toLowerCase())).size !== files.length) throw Error(t('chart-import.duplicate'));
  return files;
}

export async function readChartImport(mode, selected, options) {
  const loaded = await openFiles(chartImportFiles(mode, selected), options);
  if (mode === 'separate') {
    for (const candidate of loaded.candidates) {
      const references = resourceReferences(candidate.chart, loaded.assets, candidate.name, {}, { inferEmpty: true });
      candidate.chart = { ...candidate.chart, META: { ...candidate.chart.META, ...references,
        ...(selected.music && !selected.automatic?.music ? { song: selected.music.name } : {}), ...(selected.cover && !selected.automatic?.cover ? { background: selected.cover.name } : {}) } };
    }
  }
  return loaded;
}
