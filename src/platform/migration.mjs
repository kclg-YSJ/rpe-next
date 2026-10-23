import { parseDocument } from '../core/formats.mjs';
import { migratePreferences } from '../core/preferences.mjs';
import { decodeLegacy, parseInfo } from './legacy-text.mjs';
import { assetBytes } from './files.mjs';
import { isBackupChartFile, isChartDocumentFile } from '../core/chart-backups.mjs';
import { t } from '../i18n.mjs';
export { decodeLegacy, parseInfo } from './legacy-text.mjs';

async function migrationProjectId(sourceName, path) {
  const hashInput = new TextEncoder().encode(sourceName + '/' + path);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', hashInput))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function migrationIdentifier(project) {
  const folder = String(project.directory ?? project.path ?? project.source ?? '').replaceAll('\\', '/').match(/(?:^|\/)resources\/([^/]+)/i)?.[1];
  return String(project.identifier || project.info?.Path || folder || project.chart?.META?.id || (project.chartName ?? '').replace(/\.(json|pec)$/i, '')).trim().toLowerCase();
}

export function migrationConflicts(projects, existing) {
  const byIdentifier = new Map();
  for (const project of existing) {
    const identifier = migrationIdentifier(project);
    if (identifier && !byIdentifier.has(identifier)) byIdentifier.set(identifier, project);
  }
  return projects.map(project => ({ project, existing: byIdentifier.get(migrationIdentifier(project)) ?? existing.find(entry => entry.id && entry.id === project.id) }));
}

export async function directoryEntries(handle, prefix = '') {
  const entries = [];
  for await (const [name, child] of handle.entries()) {
    const path = prefix + name;
    if (child.kind === 'directory') {
      if (!prefix && name.toLowerCase() !== 'resources') continue;
      entries.push(...await directoryEntries(child, path + '/'));
    } else if (prefix || ['settings.json', 'settings.txt', 'hotkey.txt', 'ui.txt', 'chartlist.txt'].includes(name.toLowerCase()) || /\.(json|pec)$/i.test(name)) {
      entries.push({ path, getFile: () => child.getFile() });
    }
  }
  return entries;
}

export function uploadedEntries(files) {
  return [...files].map(file => ({ path: file.webkitRelativePath.split('/').slice(1).join('/'), getFile: async () => file }));
}

async function textEntry(entry) { return entry ? decodeLegacy(await (await entry.getFile()).arrayBuffer()) : ''; }

export async function scanMigration(entries, sourceName, { includeBackupCharts = false } = {}) {
  if (!entries.some(entry => /^resources\//i.test(entry.path))) throw new Error('请选择包含 Resources 的 RPE 主文件夹（通常是 PhiEditer），不是源码或 build 目录');
  const ignored = includeBackupCharts ? [] : entries.filter(entry => isBackupChartFile(entry.path)).map(entry => entry.path);
  entries = entries.filter(entry => includeBackupCharts || !isBackupChartFile(entry.path));
  const lookup = new Map(entries.map(entry => [entry.path.toLowerCase(), entry]));
  let settings = await textEntry(lookup.get('settings.json'));
  if (!settings) {
    const old = await textEntry(lookup.get('settings.txt'));
    const parsed = {};
    for (const line of old.split(/\r?\n/)) {
      const [key, ...values] = line.trim().split(/\s+/);
      if (key && values.length) parsed[key] = values.length === 1 && Number.isFinite(Number(values[0])) ? Number(values[0]) : values.join(' ');
    }
    settings = JSON.stringify(parsed);
  }
  const preferences = migratePreferences(settings || '{}', await textEntry(lookup.get('hotkey.txt')), await textEntry(lookup.get('ui.txt')));
  const projects = [];
  const failures = [];
  const skipped = [];
  const selectedPaths = new Set();
  const infos = entries.filter(entry => /^resources\/[^/]+\/info\.txt$/i.test(entry.path));
  for (const infoEntry of infos) {
    const info = parseInfo(await textEntry(infoEntry));
    const directory = infoEntry.path.slice(0, infoEntry.path.lastIndexOf('/') + 1);
    const path = directory + (info.Chart ?? '');
    if (!includeBackupCharts && isBackupChartFile(path)) continue;
    const entry = lookup.get(path.toLowerCase());
    if (!entry) { failures.push({ path, message: t('migration.s4e26df0') }); continue; }
    selectedPaths.add(entry.path);
    projects.push({ path: entry.path, directory, info, entry });
  }
  for (const entry of entries) {
    if (!/^resources\/[^/]+\/[^/]+$/i.test(entry.path) || !isChartDocumentFile(entry.path) || /\/(extra|config|expression|custom_background|stickers|prefab_mapper)/i.test(entry.path)) continue;
    if (selectedPaths.has(entry.path)) continue;
    const directory = entry.path.slice(0, entry.path.lastIndexOf('/') + 1);
    if (!isBackupChartFile(entry.path) && infos.some(info => info.path.toLowerCase() === (directory + 'info.txt').toLowerCase())) continue;
    projects.push({ path: entry.path, directory, info: {}, entry });
  }
  for (const project of projects) {
    try {
      const text = await textEntry(project.entry);
      if (!project.info.Chart && text.trimStart().startsWith('{')) {
        const candidate = JSON.parse(text.replace(/^\uFEFF/, ''));
        if (!candidate.META && !candidate.formatVersion) { skipped.push(project.path); project.auxiliary = true; continue; }
      }
      project.chart = parseDocument(text);
      const extra = lookup.get((project.directory + 'extra.json').toLowerCase());
      if (extra) {
        try {
          const value = JSON.parse(await textEntry(extra));
          if (Array.isArray(value.effects)) project.chart.effects = value.effects;
          project.extra = { path: extra.path, effects: Array.isArray(value.effects) ? value.effects.length : 0 };
        } catch (error) {
          project.extra = { path: extra.path, error: error.message };
        }
      }
      if (project.chart.rpeNextLegacySource) project.chart.META = { ...project.chart.META,
        name: project.info.Name ?? project.chart.META.name, song: project.info.Song ?? '', background: project.info.Picture ?? '',
        composer: project.info.Composer ?? '', charter: project.info.Charter ?? '', level: project.info.Level ?? '' };
      project.name = project.chart.META.name || project.info.Name || project.path;
      project.identifier = migrationIdentifier(project);
      project.id = await migrationProjectId(sourceName, project.path);
    } catch (error) { project.error = error.message; failures.push({ path: project.path, message: error.message }); }
  }
  return { sourceName, projects: projects.filter(project => !project.auxiliary), failures, skipped, preferences, entries, includeBackupCharts, ignored };
}

export async function materializeProject(plan, project) {
  if (project.error) throw new Error(project.error);
  const assets = new Map();
  const entries = plan.entries.filter(entry => plan.includeBackupCharts || !isBackupChartFile(entry.path));
  const references = new Map(entries.filter(entry => /^resources\//i.test(entry.path)).map(entry => [entry.path, entry]));
  let bytes = 0;
  for (const entry of entries.filter(entry => entry.path.toLowerCase().startsWith(project.directory.toLowerCase()))) {
    const file = await entry.getFile();
    bytes += file.size;
    assets.set(entry.path.slice(project.directory.length), new Uint8Array(await file.arrayBuffer()));
  }
  for (const name of [project.info.Song, project.info.Picture, project.chart.META.song, project.chart.META.background]) {
    if (!name || assets.has(name)) continue;
    const entry = assetBytes(references, name, project.path) ?? assetBytes(references, `Resources/${name}`);
    if (entry) {
      const file = await entry.getFile(); bytes += file.size;
      assets.set(name, new Uint8Array(await file.arrayBuffer()));
    }
  }
  const originalName = project.path.slice(project.directory.length);
  const id = project.id ?? await migrationProjectId(plan.sourceName, project.path);
  return { id, source: `${plan.sourceName}/${project.path}`, chartName: originalName, identifier: project.identifier || migrationIdentifier(project), chart: project.chart,
    assets: [...assets], bytes, info: project.info, imported: Date.now() };
}
