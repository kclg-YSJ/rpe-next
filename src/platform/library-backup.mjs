import { listProjects, readProject } from './library.mjs';
import { createChartExport } from './files.mjs';
import { writeBlobZip } from './archive.mjs';
import { prepareShaderExport } from './shader-export.mjs';

export async function exportLibrary({ progress = () => {}, includeBackupCharts = false } = {}) {
  const projects = await listProjects(), files = new Map(), manifest = { version: 1, created: new Date().toISOString(), projects: [] };
  for (const [index, summary] of projects.entries()) {
    progress(index, projects.length, summary.name);
    const project = await readProject(summary.id);
    if (!project) continue;
    const safe = String(summary.name || 'chart').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80).replace(/[. ]+$/, '') || 'chart';
    const filename = `${String(index + 1).padStart(4, '0')}-${safe}.pez`;
    const prepared = await prepareShaderExport(project.chart, new Map(project.assets ?? []), project.chartName);
    const exported = createChartExport(prepared.chart, prepared.assets, project.chartName, { includeBackupCharts, includeUnusedFiles: true, format: 'pez', compatibility: 'next', name: safe, identifier: project.identifier });
    files.set(filename, exported.blob);
    manifest.projects.push({ file: filename, name: summary.name, group: project.group, pinned: Boolean(project.pinned), archived: Boolean(project.archived), updated: project.updated });
  }
  files.set('library-backup.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
  progress(projects.length, projects.length, '');
  return { blob: await writeBlobZip(files), count: manifest.projects.length };
}
