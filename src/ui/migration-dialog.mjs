import { showDialog } from './dialog.mjs';
import { materializeProject, migrationConflicts } from '../platform/migration.mjs';
import { listProjects, storeProject, storePreferences, readProjectRevision } from '../platform/library.mjs';
import { storageFailure } from '../platform/storage.mjs';
import { download } from '../platform/files.mjs';
import { t } from '../i18n.mjs';

function resolveConflicts(content, conflicts) {
  return new Promise(resolve => {
    const section = document.createElement('section');
    const heading = document.createElement('h3'); heading.textContent = t('migration-dialog.sbab2067', { p0: conflicts.length });
    const description = document.createElement('p'); description.textContent = t('migration-dialog.se95276f');
    const details = document.createElement('details'); details.open = conflicts.length <= 8;
    const summary = document.createElement('summary'); summary.textContent = t('migration-dialog.s19c49ed');
    const list = document.createElement('ul');
    for (const { project } of conflicts) { const item = document.createElement('li'); item.textContent = `${project.identifier} · ${project.name}`; list.append(item); }
    details.append(summary, list); section.append(heading, description, details);
    const modal = content.closest('dialog');
    const finish = decision => { modal.removeEventListener('close', cancel); section.remove(); resolve(decision); };
    const cancel = () => finish('cancel');
    modal.addEventListener('close', cancel, { once: true });
    for (const [label, decision] of [[t('migration-dialog.s6cffdf4'), 'overwrite'], [t('migration-dialog.s50f2a78'), 'skip'], [t('migration-dialog.s1017b05'), 'cancel']]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.onclick = () => finish(decision); section.append(button);
    }
    content.append(section); section.querySelector('button').focus();
  });
}

export function migrationDialog(plan, applyPreferences) {
  const content = showDialog(t('migration-dialog.s6566af4'), t('migration-dialog.sb924c9e', { p0: plan.projects.length, p1: plan.failures.length }));
  if (plan.ignored?.length) { const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = t('migration-dialog.s8261f5e', { p0: plan.ignored.length }); content.append(hint); }
  const configLabel = document.createElement('label');
  const configCheck = document.createElement('input'); configCheck.type = 'checkbox'; configCheck.checked = true;
  configLabel.append(configCheck, t('migration-dialog.s48c332a')); content.append(configLabel);
  const summary = document.createElement('p');
  const report = plan.preferences.report;
  summary.textContent = t('migration-dialog.sc485fa2', { p0: report.appliedHotkeys.length, p1: report.appliedSettings.join('、') || t('migration-dialog.sa885efb'), p2: report.retainedHotkeys.length, p3: report.retainedSettings.length });
  content.append(summary);
  const choices = [];
  for (const project of plan.projects) {
    const label = document.createElement('label'); label.className = 'choice';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = !project.error; checkbox.disabled = Boolean(project.error);
    label.append(checkbox, ` ${project.name || project.path}${project.error ? ' · ' + project.error : ''}`);
    content.append(label); choices.push({ project, checkbox });
  }
  const progress = document.createElement('p'); content.append(progress);
  const migrate = document.createElement('button'); migrate.type = 'button'; migrate.className = 'primary'; migrate.textContent = t('migration-dialog.s8be8136');
  content.append(migrate);
  migrate.onclick = async () => {
    migrate.disabled = true;
    for (const choice of choices) choice.checkbox.disabled = true;
    const applyConfig = configCheck.checked; configCheck.disabled = true;
    const result = { source: plan.sourceName, imported: [], failed: [...plan.failures], preferences: report };
    try {
      const selected = choices.filter(choice => choice.checkbox.checked && !choice.project.error);
      const existing = await listProjects();
      const prepared = migrationConflicts(selected.map(choice => choice.project), existing);
      const conflicts = prepared.filter(entry => entry.existing);
      let overwrite = true;
      if (conflicts.length) {
        const decision = await resolveConflicts(content, conflicts);
        if (decision === 'cancel') {
          migrate.disabled = false; configCheck.disabled = false;
          for (const choice of choices) choice.checkbox.disabled = Boolean(choice.project.error);
          progress.textContent = t('migration-dialog.s9491cbb'); return;
        }
        overwrite = decision === 'overwrite';
      }
      if (applyConfig) { await storePreferences(plan.preferences); applyPreferences(plan.preferences); }
      for (const [index, entry] of prepared.entries()) {
        const existingProject = entry.existing;
        if (existingProject && !overwrite) { result.skipped ??= []; result.skipped.push({ source: entry.project.path, reason: t('migration-dialog.s24a3cf7') }); continue; }
        progress.textContent = t('migration-dialog.s739f772', { p0: index + 1, p1: prepared.length, p2: entry.project.name });
        try {
          const project = await materializeProject(plan, entry.project);
          if (existingProject) { project.id = existingProject.id; project.storageRevision = existingProject.storageRevision; }
          else { const previous = await readProjectRevision(project.id); if (previous?.deleted) project.storageRevision = previous.revision; }
          await storeProject(project); result.imported.push({ source: project.source, bytes: project.bytes, overwritten: Boolean(existingProject), extra: entry.project.extra });
        } catch (error) { result.failed.push({ path: entry.project.path, message: storageFailure(error) }); }
      }
      progress.textContent = t('migration-dialog.s065205b', { p0: result.imported.length, p1: result.failed.length, p2: result.skipped?.length ? t('migration-dialog.sba3569d', { p0: result.skipped.length }) : '' });
      migrate.textContent = t('migration-dialog.s1efc04f'); migrate.disabled = false;
      migrate.onclick = () => download(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }), 'rpe-migration-report.json');
    } catch (error) { progress.textContent = t('migration-dialog.sd3bb8b3', { p0: error.message }); }
  };
}
