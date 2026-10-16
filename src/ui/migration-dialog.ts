import { showDialog } from './dialog.ts';
import { materializeProject, migrationConflicts } from '../platform/migration.ts';
import { listProjects, storeProject, storePreferences } from '../platform/library.ts';
import { download } from '../platform/files.ts';
import type { MigrationPlan, MigrationProject } from '../platform/migration.ts';
import type { ProjectSummary } from '../platform/library.ts';

/** What the user chose when some incoming projects collide with library entries. */
export type ConflictDecision = 'overwrite' | 'skip' | 'cancel';

/** One candidate project paired with its checkbox, so the row can be disabled while migrating. */
interface MigrationChoice {
  project: MigrationProject;
  checkbox: HTMLInputElement;
}

/** A project written into the library, as recorded in the downloadable report. */
interface ImportedReport {
  source: string;
  bytes: number;
  overwritten: boolean;
  extra: MigrationProject['extra'];
}

/** A project intentionally not written, with the reason shown in the report. */
interface SkippedReport {
  source: string;
  reason: string;
}

/**
 * The downloadable JSON report assembled by a migration run.
 *
 * The `preferences` field deliberately holds the migration *report* rather than the full
 * preferences document — that is what the original writes, and the downloaded filename and shape
 * are user-visible, so it is typed to match rather than corrected.
 */
interface MigrationReport {
  source: string;
  imported: ImportedReport[];
  failed: { path: string; message: string }[];
  preferences: MigrationPlan['preferences']['report'];
  skipped?: SkippedReport[];
}

/**
 * Asks the user how to resolve identifier collisions, resolving when the dialog closes.
 *
 * Closing the modal counts as cancelling: the `close` listener is registered `once` and removes the
 * prompt, so dismissing with Escape cannot leave the migration awaiting a decision.
 */
function resolveConflicts(content: HTMLElement, conflicts: ReturnType<typeof migrationConflicts>): Promise<ConflictDecision> {
  return new Promise<ConflictDecision>(resolve => {
    const section = document.createElement('section');
    const heading = document.createElement('h3'); heading.textContent = `${conflicts.length} 个谱面标识已存在`;
    const description = document.createElement('p'); description.textContent = '覆盖将替换谱面库中对应项目的谱面和资源；跳过则保留原有项目。原 RPE 文件夹不会修改。';
    const details = document.createElement('details'); details.open = conflicts.length <= 8;
    const summary = document.createElement('summary'); summary.textContent = '查看全部冲突项目';
    const list = document.createElement('ul');
    for (const { project } of conflicts) { const item = document.createElement('li'); item.textContent = `${project.identifier} · ${project.name}`; list.append(item); }
    details.append(summary, list); section.append(heading, description, details);
    const modal = content.closest('dialog') as HTMLDialogElement;
    const finish = (decision: ConflictDecision): void => { modal.removeEventListener('close', cancel); section.remove(); resolve(decision); };
    const cancel = (): void => finish('cancel');
    modal.addEventListener('close', cancel, { once: true });
    const choices: [string, ConflictDecision][] = [['覆盖同标识谱面', 'overwrite'], ['跳过重复谱面', 'skip'], ['取消迁移', 'cancel']];
    for (const [label, decision] of choices) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.onclick = () => finish(decision); section.append(button);
    }
    content.append(section); (section.querySelector('button') as HTMLButtonElement).focus();
  });
}

export function migrationDialog(plan: MigrationPlan, applyPreferences: (preferences: MigrationPlan['preferences']) => void): void {
  const content = showDialog('迁移原 RPE 文件夹', `发现 ${plan.projects.length} 个谱面项目；${plan.failures.length} 项待处理。选择要复制到本浏览器谱面库的项目。原文件夹只读。音乐、封面及谱面文件夹内附属文件一同保存。`);
  const configLabel = document.createElement('label');
  const configCheck = document.createElement('input'); configCheck.type = 'checkbox'; configCheck.checked = true;
  configLabel.append(configCheck, '迁移热键及设置'); content.append(configLabel);
  const summary = document.createElement('p');
  const report = plan.preferences.report;
  summary.textContent = `可应用：${report.appliedHotkeys.length} 项热键，${report.appliedSettings.join('、') || '默认设置'}。其余 ${report.retainedHotkeys.length} 项热键、${report.retainedSettings.length} 项设置和 UI 布局仅保留；尚未生效。浏览器保留的系统快捷键可能无法覆盖。`;
  content.append(summary);
  const choices: MigrationChoice[] = [];
  for (const project of plan.projects) {
    const label = document.createElement('label'); label.className = 'choice';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = !project.error; checkbox.disabled = Boolean(project.error);
    label.append(checkbox, ` ${project.name || project.path}${project.error ? ' · ' + project.error : ''}`);
    content.append(label); choices.push({ project, checkbox });
  }
  const progress = document.createElement('p'); content.append(progress);
  const migrate = document.createElement('button'); migrate.type = 'button'; migrate.className = 'primary'; migrate.textContent = '迁移选中项目';
  content.append(migrate);
  migrate.onclick = async () => {
    migrate.disabled = true;
    for (const choice of choices) choice.checkbox.disabled = true;
    const applyConfig = configCheck.checked; configCheck.disabled = true;
    const result: MigrationReport = { source: plan.sourceName, imported: [], failed: [...plan.failures], preferences: report };
    try {
      const selected = choices.filter(choice => choice.checkbox.checked && !choice.project.error);
      const existing = await listProjects();
      // `listProjects` resolves `undefined` when the store is empty; it reads as "nothing to clash with".
      const prepared = migrationConflicts(selected.map(choice => choice.project), (existing ?? []) as ProjectSummary[]);
      const conflicts = prepared.filter(entry => entry.existing);
      let overwrite = true;
      if (conflicts.length) {
        const decision = await resolveConflicts(content, conflicts);
        if (decision === 'cancel') {
          migrate.disabled = false; configCheck.disabled = false;
          for (const choice of choices) choice.checkbox.disabled = Boolean(choice.project.error);
          progress.textContent = '已取消，尚未写入项目或设置。'; return;
        }
        overwrite = decision === 'overwrite';
      }
      if (applyConfig) { await storePreferences(plan.preferences); applyPreferences(plan.preferences); }
      for (const [index, entry] of prepared.entries()) {
        const existingProject = entry.existing;
        if (existingProject && !overwrite) { result.skipped ??= []; result.skipped.push({ source: entry.project.path, reason: '标识冲突，用户选择跳过' }); continue; }
        progress.textContent = `正在迁移 ${index + 1}/${prepared.length}：${entry.project.name}`;
        try {
          const project = await materializeProject(plan, entry.project);
          // `migrationConflicts` matches by identifier, so a conflict record may be a summary that
          // carries no `id`. The original copies it regardless (writing `undefined` over the fresh
          // id); `MaterializedProject.id` is typed `string`, so the overwrite is funnelled through a
          // widened view rather than guarded, which would have changed the outcome.
          if (existingProject) (project as { id: string | undefined }).id = existingProject.id;
          await storeProject(project); result.imported.push({ source: project.source, bytes: project.bytes, overwritten: Boolean(existingProject), extra: entry.project.extra });
        } catch (error) { result.failed.push({ path: entry.project.path, message: error instanceof Error ? error.message : String(error) }); }
      }
      progress.textContent = `已迁移 ${result.imported.length} 个项目，${result.failed.length} 项未迁移${result.skipped?.length ? `，跳过 ${result.skipped.length} 项` : ''}。关闭后点击“谱面库”打开；数据保存在当前浏览器，建议另导出 PEZ。`;
      migrate.textContent = '下载迁移报告'; migrate.disabled = false;
      migrate.onclick = () => download(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }), 'rpe-migration-report.json');
    } catch (error) { progress.textContent = `迁移未完成：${error instanceof Error ? error.message : String(error)}`; }
  };
}
