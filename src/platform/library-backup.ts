import { listProjects, readProject } from './library.ts';
import { createChartExport } from './files.ts';
import { writeBlobZip } from './archive.ts';

export interface LibraryBackupManifest {
  version: number;
  created: string;
  projects: { file: string; name: string; group: string; pinned: boolean; archived: boolean; updated?: number }[];
}

/** Options for {@link exportLibrary}; backup charts are excluded unless explicitly requested. */
export interface ExportLibraryOptions {
  progress?: (index: number, total: number, name: string) => void;
  includeBackupCharts?: boolean;
}

export async function exportLibrary({ progress = (_index: number, _total: number, _name: string) => {}, includeBackupCharts = false }: ExportLibraryOptions = {}): Promise<{ blob: Blob; count: number }> {
  const projects = await listProjects() ?? [], files = new Map<string, Uint8Array | Blob>(), manifest: LibraryBackupManifest = { version: 1, created: new Date().toISOString(), projects: [] };
  for (const [index, summary] of projects.entries()) {
    progress(index, projects.length, summary.name);
    const project = await readProject(summary.id);
    if (!project) continue;
    const safe = String(summary.name || 'chart').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80).replace(/[. ]+$/, '') || 'chart';
    const filename = `${String(index + 1).padStart(4, '0')}-${safe}.pez`;
    const exported = createChartExport(project.chart, new Map(project.assets ?? []), project.chartName, { includeBackupCharts, includeUnusedFiles: true, format: 'pez', compatibility: 'next', name: safe, identifier: project.identifier });
    files.set(filename, exported.blob);
    manifest.projects.push({ file: filename, name: summary.name, group: project.group ?? '', pinned: Boolean(project.pinned), archived: Boolean(project.archived), updated: project.updated });
  }
  files.set('library-backup.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
  progress(projects.length, projects.length, '');
  return { blob: await writeBlobZip(files), count: manifest.projects.length };
}
