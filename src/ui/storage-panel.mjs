import { localPreferences, flushLocalPreferences } from '../platform/local-preferences.mjs';
import { requestPersistence, storageStatus } from '../platform/storage.mjs';
import { exportLibrary } from '../platform/library-backup.mjs';
import { download } from '../platform/files.mjs';
import { deleteDraft, listDrafts } from '../platform/recovery.mjs';
import { listProjects } from '../platform/library.mjs';
import { showDialog } from './dialog.mjs';
import { nativeStorage, nativeList } from '../platform/native.mjs';
import { t } from '../i18n.mjs';

const BACKUP_KEY = 'rpe-next-external-backup-v1';
const FIRST_SAVE_KEY = 'rpe-next-first-library-save-v1';
export function noteExternalBackup() { try { localPreferences.setItem(BACKUP_KEY, String(Date.now())); } catch {} }
export function noteLibrarySave() { try { if (!localPreferences.getItem(FIRST_SAVE_KEY)) localPreferences.setItem(FIRST_SAVE_KEY, String(Date.now())); } catch {} }
const bytes = value => Number.isFinite(value) ? `${(value / 1024 ** 2).toFixed(1)} MiB` : t('storage-panel.sd9c32a4');

export class StoragePanel {
  constructor(settings, { reportError, notify, canSwitchLibrary = () => true, fileOptions = () => ({}) }) {
    this.reportError = reportError; this.notify = notify;
    this.fileOptions = fileOptions;
    this.host = document.createElement('section'); this.host.id = 'storage-settings';
    const title = document.createElement('h3'); title.textContent = t('storage-panel.s3383bb1');
    this.status = document.createElement('p'); this.status.id = 'storage-status'; this.status.setAttribute('role', 'status');
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = t('storage-panel.s7d9c772');
    if (nativeStorage) hint.textContent = t('storage-panel.sdc43cec');
    const actions = document.createElement('div'); actions.className = 'storage-actions';
    const button = (label, id, run) => { const node = document.createElement('button'); node.type = 'button'; node.id = id; node.textContent = label; node.onclick = async () => { node.disabled = true; try { await run(); } catch (error) { reportError(error); } finally { node.disabled = false; } }; actions.append(node); return node; };
    this.persist = button(t('storage-panel.sbc61f3f'), 'storage-persist', async () => { const result = await requestPersistence(); notify(result === true ? t('storage-panel.sc923604') : result === false ? t('storage-panel.s07c3683') : t('storage-panel.s6d050f8'), result === true ? 'success' : 'warning'); await this.refresh(); });
    button(t('storage-panel.sb482832'), 'storage-refresh', () => this.refresh());
    button(t('storage-panel.s414c629'), 'library-export-all', () => this.exportAll());
    button(t('storage-panel.s740c59d'), 'storage-recovery-manage', () => this.manageRecovery());
    if (nativeStorage) {
      this.persist.hidden = true;
      button(t('storage-panel.sdea726c'), 'storage-open-root', () => nativeStorage.call('openRoot'));
      button(t('storage-panel.sf01cce1'), 'storage-move-root', async () => {
        await this.confirm(t('storage-panel.s5d55d7f'), t('storage-panel.s7cd2c80'), async () => {
          this.status.textContent = t('storage-panel.sdee3a44');
          await flushLocalPreferences();
          const result = await nativeStorage.call('chooseRoot');
          if (result) this.notify(t('storage-panel.sb2b6823'), 'success');
          await this.refresh();
        });
      });
      button(t('storage-panel.s634878d'), 'storage-backup-folder', async () => {
        this.status.textContent = t('storage-panel.s741c5e7');
        await flushLocalPreferences();
        const result = await nativeStorage.call('backupFolder');
        if (result) { noteExternalBackup(); this.notify(t('storage-panel.sffdd765') + result.root, 'success', 7000); }
        await this.refresh();
      });
      button(t('storage-panel.s84f3d10'), 'storage-trash', () => this.manageTrash());
      button(t('storage-panel.sdb40a0c'), 'storage-use-root', () => {
        if (!canSwitchLibrary()) return;
        return this.confirm(t('storage-panel.s970996c'), t('storage-panel.s3863408'), async () => {
          await flushLocalPreferences();
          const result = await nativeStorage.call('useRoot'); if (result) location.reload();
        });
      });
      button(t('storage-panel.s5642e46'), 'storage-rebuild', async () => { await nativeStorage.call('rebuild'); document.dispatchEvent(new Event('rpen-library-refresh')); await this.refresh(); this.notify(t('storage-panel.sbad34d1'), 'success'); });
      button(t('storage-panel.s9a3669d'), 'storage-collect', () => this.confirm(t('storage-panel.s9a3669d'), t('storage-panel.s9dc452c'), async () => {
        const result = await nativeStorage.call('collect'); this.notify(t('storage-panel.sf2c8486', { p0: bytes(result.bytes), p1: result.removed }), 'success'); await this.refresh();
      }));
    }
    this.host.append(title, this.status, hint, actions); settings.querySelector('.settings-body').append(this.host);
    this.banner = document.createElement('p'); this.banner.id = 'storage-backup-reminder'; this.banner.className = 'hint'; this.banner.hidden = true; document.querySelector('#project-cards').before(this.banner);
    document.addEventListener('rpen-storage-changed', () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.refresh().catch(error => reportError(error)), 300); });
    settings.addEventListener('toggle', () => { if (settings.open) this.refresh().catch(reportError); });
    listProjects().then(projects => { if (projects.length) noteLibrarySave(); return this.refresh(); }).catch(reportError);
  }
  async refresh() {
    const info = await storageStatus();
    this.status.textContent = info.native ? t('storage-panel.s20f3bd9', { p0: info.root, p1: bytes(info.usage), p2: info.blobs, p3: bytes(info.free), p4: info.projects, p5: info.trash }) : t('storage-panel.s6f81653', { p0: info.persistent === true ? t('storage-panel.s9181c23') : info.supported ? t('storage-panel.see2a1f6') : t('storage-panel.s545749a'), p1: bytes(info.usage), p2: bytes(info.quota) });
    if (info.native && info.warnings?.length) this.status.textContent += '\n' + [...new Set(info.warnings)].join('；');
    this.persist.disabled = info.persistent === true || !globalThis.navigator?.storage?.persist;
    let last = 0, first = 0; try { last = Number(localPreferences.getItem(BACKUP_KEY)) || 0; first = Number(localPreferences.getItem(FIRST_SAVE_KEY)) || 0; } catch {}
    const due = first > 0 && (!last || Date.now() - last > 7 * 86400000) && (await listProjects()).length > 0;
    this.banner.hidden = !due;
    this.banner.textContent = !last ? t('storage-panel.s2029865') : nativeStorage ? t('storage-panel.s357cfe0') : t('storage-panel.s99a5462');
    if (info.quota && info.usage / info.quota >= .85) { this.banner.hidden = false; this.banner.textContent = t('storage-panel.s2727b6b'); }
  }
  async confirm(title, description, run) {
    document.querySelector('#settings-modal').close();
    showDialog(title, description);
    const apply = document.querySelector('#modal-apply'); apply.hidden = false; apply.textContent = t('storage-panel.sb56d9ac');
    apply.onclick = async () => {
      apply.disabled = true;
      try { await run(); document.querySelector('#modal').close(); }
      catch (error) { document.querySelector('#modal-error').textContent = error.message; }
      finally { apply.disabled = false; }
    };
  }
  async manageTrash() {
    document.querySelector('#settings-modal').close();
    const host = showDialog(t('storage-panel.s3d29452'), t('storage-panel.s6f448ef'));
    const projects = await nativeList('projects', true);
    if (!projects.length) { host.textContent = t('storage-panel.s6fc503c'); return; }
    for (const project of projects) {
      const row = document.createElement('div'); row.className = 'storage-draft-row';
      const label = document.createElement('span'); label.textContent = `${project.name} · ${new Date(project.deletedAt).toLocaleString()}`;
      const restore = document.createElement('button'); restore.textContent = t('storage-panel.s79748ca');
      const purge = document.createElement('button'); purge.textContent = t('storage-panel.sa7fadbe');
      const act = async method => {
        restore.disabled = purge.disabled = true;
        try { await nativeStorage.call(method, project.id, project.storageRevision); row.remove(); document.dispatchEvent(new Event('rpen-library-refresh')); await this.refresh(); }
        catch (error) { this.reportError(error); restore.disabled = purge.disabled = false; }
      };
      restore.onclick = () => act('restore');
      purge.onclick = () => { if (confirm(t('storage-panel.s7bb39fa', { p0: project.name }))) act('purge'); };
      row.append(label, restore, purge); host.append(row);
    }
  }
  async exportAll() {
    const result = await exportLibrary({ ...this.fileOptions(), progress: (index, count, name) => { this.status.textContent = t('storage-panel.sb2303fe', { p0: index, p1: count, p2: name ? '：' + name : '' }); } });
    download(result.blob, `rpe-next-library-${new Date().toISOString().slice(0, 10)}.zip`);
    noteExternalBackup(); this.notify(t('storage-panel.s83a6407', { p0: result.count }), 'success', 7000); await this.refresh();
  }
  async manageRecovery() {
    document.querySelector('#settings-modal').close();
    const host = showDialog(t('storage-panel.s740c59d'), t('storage-panel.sf059c5f'));
    const drafts = await listDrafts();
    if (!drafts.length) { host.textContent = t('storage-panel.scd0f776'); return; }
    for (const draft of drafts) {
      const row = document.createElement('div'); row.className = 'storage-draft-row';
      const label = document.createElement('span'); label.textContent = `${draft.title || draft.name} · ${new Date(draft.updated).toLocaleString()}`;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = t('storage-panel.sf6dac4f');
      remove.onclick = async () => { if (!confirm(t('storage-panel.sacbec52'))) return; try { remove.disabled = true; await deleteDraft(draft.id); row.remove(); await this.refresh(); } catch (error) { remove.disabled = false; this.reportError(error); } };
      row.append(label, remove); host.append(row);
    }
  }
}
