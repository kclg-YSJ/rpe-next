import { t } from '../i18n.mjs';
import { APP_VERSION, UPDATE_REPOSITORY_URL, compareUpdateVersions } from '../core/app-update.mjs';
import { AppUpdateClient } from '../platform/update-client.mjs';
import { renderAgentMarkdown } from './agent-markdown.mjs';

function node(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
function button(text, action, className) { const element = node('button', className, text); element.type = 'button'; element.onclick = action; return element; }
function setText(element, value) { if (element.textContent !== value) element.textContent = value; }
function bytes(value) { return (value / 1024 ** 2).toFixed(1) + ' MB'; }

export class AboutUpdates {
  constructor(settings, { client = new AppUpdateClient(), dirty = () => false, beforeRestart = async () => {}, reload = () => location.reload(), startupReady = async () => {} } = {}) {
    Object.assign(this, { settings, client, dirty, beforeRestart, reload }); this.root = settings.querySelector('#about-settings');
    const heading = node('div', 'about-heading'); const emblem = node('div', 'about-emblem', 'RN'); emblem.setAttribute('aria-hidden', 'true');
    const name = node('div'); name.append(node('h3', null, 'Re:PhiEdit Next'), node('span', 'about-subtitle', t('update.current'))); this.version = node('strong', 'about-version', APP_VERSION); name.append(this.version); heading.append(emblem, name);
    const info = node('dl', 'about-info');
    const field = label => { const value = node('dd'); info.append(node('dt', null, label), value); return value; };
    this.platform = field(t('update.platform')); this.latest = field(t('update.latest'));
    field(t('update.author')).textContent = 'cmdysj';
    const repo = node('a', null, 'github.com/kclg-YSJ/rpe-next'); repo.href = UPDATE_REPOSITORY_URL; repo.target = '_blank'; repo.rel = 'noopener noreferrer'; field(t('update.repository')).append(repo);
    const auto = node('label', 'field'); this.auto = node('input'); this.auto.id = 'update-auto'; this.auto.type = 'checkbox'; this.auto.checked = true;
    this.auto.onchange = () => this.client.setAuto(this.auto.checked).catch(error => this.showError(error)); auto.append(t('update.auto'), this.auto);
    this.check = button(t('update.check'), () => this.client.check(true)); this.check.id = 'update-check';
    this.download = button(t('update.download'), () => this.downloadLatest(), 'primary'); this.download.id = 'update-download';
    this.webRefresh = button(t('update.refresh'), () => this.installOrRefresh()); this.webRefresh.id = 'update-refresh';
    this.location = button(t('update.location'), () => this.run(() => this.client.action('location'))); this.location.id = 'update-location'; this.location.hidden = true;
    const actions = node('div', 'about-actions'); actions.append(this.check, this.download, this.webRefresh, this.location);
    this.status = node('p', 'about-status'); this.status.id = 'update-status'; this.status.setAttribute('role', 'status');
    this.progress = node('progress'); this.progress.id = 'update-progress'; this.progress.max = 1;
    this.progressLabel = node('span');
    this.cancel = button(t('update.cancelDownload'), () => this.client.action('cancel').catch(error => this.showError(error)));
    this.progressRow = node('div', 'about-progress'); this.progressRow.hidden = true; this.progressRow.append(this.progress, this.progressLabel, this.cancel);
    this.notes = node('details', 'about-notes'); this.notes.id = 'update-notes'; this.notesSummary = node('summary', null, t('update.notes')); this.notes.append(this.notesSummary); this.notesBody = node('div', 'agent-markdown'); this.notes.append(this.notesBody);
    this.packages = node('div', 'about-packages'); this.packages.id = 'update-packages';
    this.root.append(heading, info, auto, actions, this.progressRow, this.status, this.notes, this.packages);
    this.dialog = node('dialog', 'update-dialog'); this.dialog.id = 'update-dialog'; this.dialog.setAttribute('aria-labelledby', 'update-dialog-title'); document.body.append(this.dialog);
    this.footer = document.querySelector('#app-version'); this.footer.onclick = () => this.open();
    this.footerVersion = node('span', 'app-version-text'); this.footerSeparator = document.createTextNode('');
    this.footerBadge = node('span', 'app-update-badge', t('update.available')); this.footerBadge.id = 'app-update-badge'; this.footerBadge.hidden = true;
    this.footer.replaceChildren(this.footerVersion, this.footerSeparator, this.footerBadge);
    client.addEventListener('change', () => this.render()); this.render();
    this.ready = client.initialize().then(async () => { await startupReady(); this.showStartupNotes(); }).catch(error => { this.showError(error); });
  }
  showStartupNotes() {
    const release = this.client.state.startupNotes;
    if (!release || release.version !== this.client.state.version || this.startupNotesOffered) return;
    this.startupNotesOffered = true;
    const dialog = node('dialog', 'update-release-dialog'); dialog.id = 'update-release-dialog'; dialog.setAttribute('aria-labelledby', 'update-release-title');
    const header = node('div', 'update-release-heading'), title = node('h2', null, t('update.notesForVersion', { version: release.version })); title.id = 'update-release-title';
    const dismiss = button('×', () => dialog.close(), 'update-release-dismiss'); dismiss.setAttribute('aria-label', t('update.close'));
    header.append(title, dismiss);
    const content = node('div', 'update-release-content agent-markdown'); content.tabIndex = 0; content.setAttribute('aria-label', t('update.notes'));
    renderAgentMarkdown(content, release.notes || t('update.noNotes'));
    const actions = node('div', 'update-release-actions'); actions.append(button(t('update.close'), () => dialog.close(), 'primary'));
    dialog.append(header, content, actions); document.body.append(dialog);
    const cleanup = () => { observer.disconnect(); document.removeEventListener('visibilitychange', tryShow); };
    const tryShow = () => {
      if (document.visibilityState === 'hidden' || document.querySelector('dialog[open]')) return;
      cleanup(); dialog.showModal(); content.scrollTop = 0;
      // A normal restart must not repeat this window, even if the user quits
      // while it is open. Only an acknowledged installation creates the record.
      this.client.action('notes-seen', release.version).catch(() => {});
    };
    const observer = new MutationObserver(tryShow); observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    document.addEventListener('visibilitychange', tryShow);
    dialog.addEventListener('close', () => { cleanup(); dialog.remove(); }, { once: true });
    tryShow();
  }
  open() {
    const search = this.settings.querySelector('#settings-search'); search.value = ''; search.dispatchEvent(new Event('input'));
    this.settings.settingsNavigation.reopenCategory = 'about'; if (!this.settings.open) this.settings.showModal();
    requestAnimationFrame(() => this.settings.settingsNavigation.go('about'));
  }
  showError(error) { this.uiError = error.code ?? 'UPDATE_INSTALL'; this.render(); }
  async run(action) {
    if (this.working) return; this.working = true; this.uiError = null; this.render();
    try { return await action(); } catch (error) { this.showError(error); }
    finally { this.working = false; this.render(); }
  }
  ask(title, options) {
    if (this.dialog.open) return Promise.resolve(null);
    const heading = node('h2', null, title); heading.id = 'update-dialog-title';
    const actions = node('div', 'modal-actions');
    this.dialog.replaceChildren(heading, actions); this.dialog.returnValue = '';
    for (const [key, label, primary] of options) actions.append(button(label, () => this.dialog.close(key), primary ? 'primary' : ''));
    return new Promise(resolve => { this.dialog.addEventListener('close', () => resolve(this.dialog.returnValue || null), { once: true }); this.dialog.showModal(); });
  }
  async downloadLatest() {
    await this.run(async () => {
      const result = await this.client.action('download');
      if (result.downloadedId && await this.ask(t('update.downloaded'), [['later', t('update.later')], ['install', t('update.restart'), true]]) === 'install') await this.installOrRefresh(result.downloadedId, { confirmed: true, nested: true });
    });
  }
  async installOrRefresh(id, { confirmed = false, nested = false } = {}) {
    if (this.working && !nested) return;
    const install = async () => {
      const desktop = this.client.state.desktop;
      if (this.dirty()) {
        const choice = await this.ask(t('update.saveQuestion'), [['cancel', t('update.cancel')], ['save', t('update.saveRestart'), true]]);
        if (choice !== 'save') return;
      } else if (!confirmed && await this.ask(t(desktop ? 'update.restartQuestion' : 'update.refreshQuestion'), [['later', t('update.later')], ['install', t(desktop ? 'update.restart' : 'update.refresh'), true]]) !== 'install') return;
      await this.beforeRestart(); if (desktop) await this.client.action('install', id); else this.reload();
    };
    if (nested) await install(); else await this.run(install);
  }
  async deletePackage(id) {
    if (await this.ask(t('update.deleteQuestion'), [['cancel', t('update.cancel')], ['delete', t('update.delete')]]) === 'delete') await this.run(() => this.client.action('delete', id));
  }
  render() {
    const state = this.client.state, phase = state.phase, busy = Boolean(this.working || phase !== 'idle'), available = state.available;
    setText(this.version, state.version);
    const system = { win32: 'Windows', darwin: 'macOS', linux: 'Linux', web: t('update.web') }[state.platform] ?? state.platform;
    setText(this.platform, system + (state.arch ? ' · ' + state.arch : '') + (state.desktop && !state.canInstall ? ' · ' + t('update.development') : ''));
    setText(this.latest, state.latest ? state.latest.version + (available ? ' · ' + t('update.available') : ' · ' + t('update.upToDate')) : t(state.checked ? 'update.noRelease' : 'update.notChecked'));
    setText(this.footerVersion, 'Re:PhiEdit Next · ' + state.version); this.footerSeparator.data = available ? ' · ' : '';
    setText(this.footerBadge, t('update.available')); this.footerBadge.hidden = !available; this.footer.classList.toggle('has-update', Boolean(available));
    this.auto.checked = state.autoCheck; this.auto.disabled = false; this.check.disabled = busy;
    const ready = state.packages?.find(p => p.version === state.latest?.version && p.ready);
    this.download.hidden = !state.desktop; this.download.disabled = busy || !available || !state.canInstall;
    setText(this.download, t(ready ? 'update.restart' : 'update.download'));
    this.download.onclick = ready ? () => this.installOrRefresh(ready.id) : () => this.downloadLatest();
    this.webRefresh.hidden = state.desktop; this.webRefresh.disabled = busy || !available;
    const code = this.uiError ?? state.error;
    this.location.hidden = code !== 'UPDATE_LOCATION'; this.location.disabled = busy;
    const progress = phase === 'downloading' || phase === 'preparing' || phase === 'verifying'; this.progressRow.hidden = !progress;
    this.cancel.hidden = phase !== 'downloading'; this.cancel.disabled = false;
    const transfer = state.transfer;
    if (transfer?.total) { this.progress.value = transfer.bytes / transfer.total; setText(this.progressLabel, Math.floor(100 * transfer.bytes / transfer.total) + '% · ' + bytes(transfer.bytes) + ' / ' + bytes(transfer.total)); }
    else if (transfer?.fraction !== undefined) { this.progress.value = transfer.fraction; setText(this.progressLabel, Math.floor(100 * transfer.fraction) + '%'); }
    else { this.progress.removeAttribute('value'); setText(this.progressLabel, ''); }
    this.progress.setAttribute('aria-label', t(`update.phase.${progress ? phase : 'downloading'}`));
    this.status.classList.toggle('is-error', Boolean(code));
    setText(this.status, code ? t(`update.error.${code}`) : phase !== 'idle' ? t(`update.phase.${phase}`) : state.checked ? t('update.checked', { time: new Date(state.checked).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }) : '');
    const notes = state.latest?.notes ?? ''; this.notes.hidden = !notes;
    setText(this.notesSummary, state.latest?.version ? t('update.notesForVersion', { version: state.latest.version }) : t('update.notes'));
    if (this.lastNotes !== notes) { this.lastNotes = notes; renderAgentMarkdown(this.notesBody, notes); }
    const signature = JSON.stringify([state.packages, state.version, busy]);
    if (signature !== this.packagesSignature) {
      this.packagesSignature = signature; this.packages.replaceChildren(); this.packages.hidden = !state.packages?.length;
      if (state.packages?.length) this.packages.append(node('h4', null, t('update.savedPackages')));
      for (const pkg of state.packages ?? []) {
        const row = node('div', 'about-package'), label = node('div', 'about-package-label'); label.append(node('strong', null, pkg.version), node('small', null, bytes(pkg.size)));
        const install = button(t('update.install'), () => this.installOrRefresh(pkg.id)); install.dataset.updateInstall = pkg.id;
        install.disabled = busy || !pkg.ready || compareUpdateVersions(pkg.version, state.version) <= 0;
        const remove = button(t('update.delete'), () => this.deletePackage(pkg.id)); remove.dataset.updateDelete = pkg.id; remove.disabled = busy;
        row.append(label, install, remove); this.packages.append(row);
      }
    }
  }
}
