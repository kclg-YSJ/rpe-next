import { parseDocument } from '../core/formats.ts';
import { migratePreferences } from '../core/preferences.ts';
import { decodeLegacy, parseInfo } from './legacy-text.ts';
import type { ArchiveEntries } from './archive.ts';
import type { Chart } from '../core/types.ts';
export { decodeLegacy, parseInfo } from './legacy-text.ts';

/** One readable file discovered during a migration scan. */
export interface MigrationEntry {
  /** Path relative to the selected RPE root folder. */
  path: string;
  getFile(): Promise<File>;
}

/** A scanned candidate project, refined in place as its chart is parsed. */
export interface MigrationProject {
  path: string;
  directory: string;
  info: Record<string, string>;
  entry: MigrationEntry;
  chart?: Chart;
  name?: string;
  identifier?: string;
  id?: string;
  error?: string;
  /** Set when the file is a project sidecar rather than a chart, so it is not offered for import. */
  auxiliary?: boolean;
  extra?: { path: string; effects?: number; error?: string };
}

/** The result of scanning a folder for RPE projects. */
export interface MigrationPlan {
  sourceName: string;
  projects: MigrationProject[];
  failures: { path: string; message: string }[];
  skipped: string[];
  preferences: ReturnType<typeof migratePreferences>;
  entries: MigrationEntry[];
}

/** A project ready to be written into the chart library. */
export interface MaterializedProject {
  id: string;
  source: string;
  chartName: string;
  identifier: string;
  chart: Chart;
  assets: [string, Uint8Array][];
  bytes: number;
  info: Record<string, string>;
  imported: number;
  [key: string]: unknown;
}

/**
 * Derives a stable project id from the source folder name and the chart path.
 *
 * Hashing rather than using the path directly keeps the id a fixed length and independent of
 * absolute locations, so migrating the same project twice from different drives still collides and
 * triggers the overwrite prompt.
 */
async function migrationProjectId(sourceName: string, path: string): Promise<string> {
  const hashInput = new TextEncoder().encode(sourceName + '/' + path);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', hashInput))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The identity a project is matched by, preferring the original RPE `Path` field. */
export function migrationIdentifier(project: Partial<MigrationProject> & { directory?: string; source?: string; chartName?: string; identifier?: string }): string {
  const folder = String(project.directory ?? project.path ?? project.source ?? '').replaceAll('\\', '/').match(/(?:^|\/)resources\/([^/]+)/i)?.[1];
  return String(project.identifier || project.info?.Path || folder || (project.chart?.META?.id as string | undefined) || (project.chartName ?? '').replace(/\.(json|pec)$/i, '')).trim().toLowerCase();
}

/** Pairs each scanned project with the existing library entry it would overwrite, if any. */
export function migrationConflicts(projects: MigrationProject[], existing: { id?: string }[]): { project: MigrationProject; existing: { id?: string } | undefined }[] {
  const byIdentifier = new Map<string, { id?: string }>();
  for (const project of existing) {
    const identifier = migrationIdentifier(project as Partial<MigrationProject>);
    if (identifier && !byIdentifier.has(identifier)) byIdentifier.set(identifier, project);
  }
  return projects.map(project => ({ project, existing: byIdentifier.get(migrationIdentifier(project)) ?? existing.find(entry => entry.id && entry.id === project.id) }));
}

/**
 * Walks a directory handle, collecting only the files a migration needs.
 *
 * `Resources` is the only directory descended into, plus a small allow-list of root files; scanning
 * an arbitrarily large RPE folder otherwise would read unrelated charts and build output.
 */
export async function directoryEntries(handle: FileSystemDirectoryHandle, prefix = ''): Promise<MigrationEntry[]> {
  const entries: MigrationEntry[] = [];
  for await (const [name, child] of (handle as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    const path = prefix + name;
    if (child.kind === 'directory') {
      if (!prefix && name.toLowerCase() !== 'resources') continue;
      entries.push(...await directoryEntries(child as FileSystemDirectoryHandle, path + '/'));
    } else if (prefix || ['settings.json', 'settings.txt', 'hotkey.txt', 'ui.txt', 'chartlist.txt'].includes(name.toLowerCase()) || /\.(json|pec)$/i.test(name)) {
      entries.push({ path, getFile: () => (child as FileSystemFileHandle).getFile() });
    }
  }
  return entries;
}

/** Adapts a webkitdirectory `<input>` selection to the same entry shape as a directory handle. */
export function uploadedEntries(files: ArrayLike<File> & Iterable<File>): MigrationEntry[] {
  return [...files].map(file => ({ path: file.webkitRelativePath.split('/').slice(1).join('/'), getFile: async () => file }));
}

async function textEntry(entry: MigrationEntry | undefined): Promise<string> { return entry ? decodeLegacy(await (await entry.getFile()).arrayBuffer()) : ''; }

/** Formats a legacy `Settings.txt`, which stores `Key value…` lines rather than JSON. */
function parseLegacySettings(text: string): Record<string, string | number> {
  const parsed: Record<string, string | number> = {};
  for (const line of text.split(/\r?\n/)) {
    const [key, ...values] = line.trim().split(/\s+/);
    if (key && values.length) parsed[key] = values.length === 1 && Number.isFinite(Number(values[0])) ? Number(values[0]) : values.join(' ');
  }
  return parsed;
}

/**
 * Scans an RPE folder into importable projects.
 *
 * Projects are discovered two ways: charts named by a sibling `info.txt`, and any remaining chart
 * file sitting directly under `Resources` that no `info.txt` claimed. Failures are collected per
 * project rather than thrown, so one broken chart does not abort a whole migration.
 */
export async function scanMigration(entries: MigrationEntry[], sourceName: string): Promise<MigrationPlan> {
  const lookup = new Map(entries.map(entry => [entry.path.toLowerCase(), entry]));
  if (!entries.some(entry => /^resources\//i.test(entry.path))) throw new Error('请选择包含 Resources 的 RPE 主文件夹（通常是 PhiEditer），不是源码或 build 目录');
  let settings = await textEntry(lookup.get('settings.json'));
  if (!settings) {
    const old = await textEntry(lookup.get('settings.txt'));
    settings = JSON.stringify(parseLegacySettings(old));
  }
  const preferences = migratePreferences(settings || '{}', await textEntry(lookup.get('hotkey.txt')), await textEntry(lookup.get('ui.txt')));
  const projects: MigrationProject[] = [];
  const failures: { path: string; message: string }[] = [];
  const skipped: string[] = [];
  const selectedPaths = new Set<string>();
  const infos = entries.filter(entry => /^resources\/[^/]+\/info\.txt$/i.test(entry.path));
  for (const infoEntry of infos) {
    const info = parseInfo(await textEntry(infoEntry));
    const directory = infoEntry.path.slice(0, infoEntry.path.lastIndexOf('/') + 1);
    const path = directory + (info.Chart ?? '');
    const entry = lookup.get(path.toLowerCase());
    if (!entry) { failures.push({ path, message: 'info.txt 引用的谱面不存在' }); continue; }
    selectedPaths.add(entry.path);
    projects.push({ path: entry.path, directory, info, entry });
  }
  for (const entry of entries) {
    if (!/^resources\/[^/]+\/[^/]+\.(json|pec)$/i.test(entry.path) || /\/(autosave_|extra|config|expression|custom_background|stickers|prefab_mapper)/i.test(entry.path)) continue;
    if (selectedPaths.has(entry.path)) continue;
    const directory = entry.path.slice(0, entry.path.lastIndexOf('/') + 1);
    if (infos.some(info => info.path.toLowerCase() === (directory + 'info.txt').toLowerCase())) continue;
    projects.push({ path: entry.path, directory, info: {}, entry });
  }
  for (const project of projects) {
    try {
      const text = await textEntry(project.entry);
      if (!project.info.Chart && text.trimStart().startsWith('{')) {
        const candidate = JSON.parse(text.replace(/^\uFEFF/, '')) as { META?: unknown; formatVersion?: unknown };
        if (!candidate.META && !candidate.formatVersion) { skipped.push(project.path); project.auxiliary = true; continue; }
      }
      project.chart = parseDocument(text);
      const extra = lookup.get((project.directory + 'extra.json').toLowerCase());
      if (extra) {
        try {
          const value = JSON.parse(await textEntry(extra)) as { effects?: unknown[] };
          if (Array.isArray(value.effects)) project.chart.effects = value.effects;
          project.extra = { path: extra.path, effects: Array.isArray(value.effects) ? value.effects.length : 0 };
        } catch (error) {
          project.extra = { path: extra.path, error: (error as Error).message };
        }
      }
      if (project.chart.rpeNextLegacySource) project.chart.META = { ...project.chart.META,
        name: project.info.Name ?? project.chart.META.name, song: project.info.Song ?? '', background: project.info.Picture ?? '',
        composer: project.info.Composer ?? '', charter: project.info.Charter ?? '', level: project.info.Level ?? '' };
      project.name = project.chart.META.name || project.info.Name || project.path;
      project.identifier = migrationIdentifier(project);
      project.id = await migrationProjectId(sourceName, project.path);
    } catch (error) { project.error = (error as Error).message; failures.push({ path: project.path, message: (error as Error).message }); }
  }
  return { sourceName, projects: projects.filter(project => !project.auxiliary), failures, skipped, preferences, entries };
}

/**
 * Finds a referenced media entry anywhere under `Resources`, mirroring `assetBytes`' resolution.
 *
 * `assetBytes` works on bytes, but migration needs the file handle so it can read the data and
 * report its size, so this repeats the same lookup order over entries instead of round-tripping
 * through bytes.
 */
function referencedEntry(references: Map<string, MigrationEntry>, name: string, chartPath: string): MigrationEntry | undefined {
  const normalize = (value: string) => value.replaceAll('\\', '/').split('/').filter(part => part && part !== '.').join('/').toLowerCase();
  const normalizedChart = chartPath.replaceAll('\\', '/');
  const directory = normalizedChart.includes('/') ? normalizedChart.slice(0, normalizedChart.lastIndexOf('/') + 1) : '';
  const direct = references.get(directory + name) ?? references.get(name);
  if (direct) return direct;
  const target = normalize(name);
  for (const candidate of [normalize(directory + name), target]) {
    const exact = [...references].filter(([path]) => normalize(path) === target || normalize(path) === candidate);
    if (exact.length === 1) return exact[0][1];
  }
  const matches = [...references].filter(([path]) => normalize(path).split('/').at(-1) === target.split('/').at(-1));
  return matches.length === 1 ? matches[0][1] : undefined;
}

/**
 * Reads a scanned project and its assets into a storable form.
 *
 * Assets are gathered from the project's own directory, then any song or illustration it references
 * is resolved across the whole `Resources` tree — RPE projects routinely share media between charts.
 */
export async function materializeProject(plan: MigrationPlan, project: MigrationProject): Promise<MaterializedProject> {
  if (project.error) throw new Error(project.error);
  const assets: ArchiveEntries = new Map();
  const references = new Map(plan.entries.filter(entry => /^resources\//i.test(entry.path)).map(entry => [entry.path, entry]));
  let bytes = 0;
  for (const entry of plan.entries.filter(entry => entry.path.toLowerCase().startsWith(project.directory.toLowerCase()))) {
    const file = await entry.getFile();
    bytes += file.size;
    assets.set(entry.path.slice(project.directory.length), new Uint8Array(await file.arrayBuffer()));
  }
  const chart = project.chart!;
  for (const name of [project.info.Song, project.info.Picture, chart.META.song, chart.META.background]) {
    if (!name || assets.has(name)) continue;
    const entry = referencedEntry(references, name, project.path) ?? referencedEntry(references, `Resources/${name}`, project.path);
    if (entry) {
      const file = await entry.getFile(); bytes += file.size;
      assets.set(name, new Uint8Array(await file.arrayBuffer()));
    }
  }
  const originalName = project.path.slice(project.directory.length);
  const id = project.id ?? await migrationProjectId(plan.sourceName, project.path);
  return { id, source: `${plan.sourceName}/${project.path}`, chartName: originalName, identifier: project.identifier || migrationIdentifier(project), chart,
    assets: [...assets], bytes, info: project.info, imported: Date.now() };
}
