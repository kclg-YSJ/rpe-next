import { listProjects, readProject, storeProject, projectSummary, updateSummary, deleteProject } from '../platform/library.mjs';
import { deleteProjectDrafts } from '../platform/recovery.mjs';
import { showDialog } from './dialog.mjs';
import { projectThumbnail } from '../platform/thumbnail.mjs';
import { t } from '../i18n.mjs';
import { chartDisplayName, groupDisplayName, isUngrouped } from '../core/labels.mjs';

export class ProjectHome {
  constructor(openProject, reportError, changed) {
    this.openProject = openProject; this.reportError = reportError; this.changed = changed; this.projects = []; this.coverUrls = []; this.coverCache = new Map(); this.limit = 24;
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { this.observer.unobserve(entry.target); this.loadCover(entry.target).catch(() => {}); }
    }, { rootMargin: '100px' });
    for (const id of ['project-search', 'project-group', 'project-sort', 'show-archived']) document.getElementById(id).addEventListener(id === 'project-search' ? 'input' : 'change', () => this.render());
  }
  async refresh() {
    this.projects = await listProjects();
    const select = document.getElementById('project-group'); const previous = select.value;
    select.replaceChildren(new Option(t('home.seb8d23f'), ''));
    // Option values stay as stored group keys; only the label is localized.
    const groups = [...new Set(this.projects.map(project => isUngrouped(project.group) ? '' : String(project.group).trim()))]
      .sort((left, right) => groupDisplayName(left).localeCompare(groupDisplayName(right)));
    for (const group of groups) if (group) select.append(new Option(groupDisplayName(group), group));
    select.value = previous; this.render();
  }
  render() {
    this.observer.disconnect(); for (const url of this.coverUrls) URL.revokeObjectURL(url); this.coverUrls = [];
    const query = document.getElementById('project-search').value.trim().toLocaleLowerCase();
    const group = document.getElementById('project-group').value;
    const archived = document.getElementById('show-archived').checked;
    const sort = document.getElementById('project-sort').value;
    const entries = this.projects.filter(project => Boolean(project.archived) === archived && (!group || (!isUngrouped(project.group) && String(project.group).trim() === group)) && `${chartDisplayName(project.name)} ${project.charter ?? ''} ${groupDisplayName(project.group)}`.toLocaleLowerCase().includes(query))
      .sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || (sort === 'name' ? left.name.localeCompare(right.name) : (right.updated ?? right.imported ?? 0) - (left.updated ?? left.imported ?? 0)));
    const container = document.getElementById('project-cards'); container.replaceChildren();
    document.getElementById('project-count').textContent = t('home.sc030c0f', { p0: entries.length });
    document.getElementById('home-empty').textContent = entries.length ? '' : t('home.s3b40878');
    for (const project of entries.slice(0, this.limit)) {
      const card = document.createElement('article'); card.className = 'project-card';
      const cover = document.createElement('div'); cover.className = 'project-cover'; cover.dataset.projectId = project.id;
      const placeholder = document.createElement('span'); placeholder.textContent = '♪'; cover.append(placeholder); this.observer.observe(cover);
      const name = document.createElement('h2'); name.textContent = `${project.pinned ? '★ ' : ''}${chartDisplayName(project.name)}`;
      const detail = document.createElement('p'); detail.className = 'project-detail'; detail.textContent = t('home.sa7844bd', { p0: project.level || t('home.s2f144d1'), p1: groupDisplayName(project.group), p2: project.notes ?? '—', p3: project.lines ?? '—' });
      const credits = document.createElement('p'); credits.className = 'project-credits'; credits.textContent = t('home.s0177923', { p0: project.composer || t('home.se09740c'), p1: project.charter || t('home.s1b54779') }); credits.title = credits.textContent;
      const date = document.createElement('p'); date.textContent = `${new Date(project.updated ?? project.imported).toLocaleString()} · ${(project.bytes / 1048576).toFixed(1)} MiB`;
      const open = document.createElement('button'); open.className = 'project-open primary'; open.textContent = t('home.sf782e99'); open.onclick = () => this.openProject(project.id).catch(this.reportError);
      const actions = document.createElement('div'); actions.className = 'project-actions';
      for (const [label, action] of [[t('home.s0780904'), () => this.edit(project)], [project.pinned ? t('home.scfb5cd4') : t('home.s7bcf186'), () => this.modify(project.id, source => ({ ...source, pinned: !source.pinned }))],
        [t('home.s4edd1d0'), () => this.modify(project.id, source => ({ ...source, id: crypto.randomUUID(), storageRevision: null, vcsId: crypto.randomUUID(), source: t('home.sa5c5941'), pinned: false, archived: false, chart: { ...source.chart, META: { ...source.chart.META, name: t('home.sca13637', { p0: source.chart.META.name }) } } }))],
        [project.archived ? t('home.s79748ca') : t('home.sddfde75'), () => this.modify(project.id, source => ({ ...source, archived: !source.archived }))], [t('home.s3755f56'), () => this.remove(project)]]) {
        const button = document.createElement('button'); button.textContent = label; button.onclick = () => Promise.resolve(action()).catch(this.reportError); actions.append(button);
      }
      const information = document.createElement('div'); information.className = 'project-information'; information.append(name, detail, credits, date, open, actions);
      card.append(cover, information); container.append(card);
    }
    if (entries.length > this.limit) { const more = document.createElement('button'); more.textContent = t('home.sd1cc0b8', { p0: entries.length - this.limit }); more.onclick = () => { this.limit += 24; this.render(); }; container.append(more); }
  }
  async loadCover(container) {
    const id = container.dataset.projectId; let summary = this.projects.find(project => project.id === id);
    let thumbnail = summary?.thumbnail ?? this.coverCache.get(id);
    if (summary?.version !== 2) {
      const project = await readProject(id);
      if (project) {
        thumbnail = await projectThumbnail(project); summary = projectSummary(project, thumbnail); await updateSummary(summary);
        this.projects = this.projects.map(entry => entry.id === id ? summary : entry);
        if (container.isConnected) {
          container.parentElement.querySelector('.project-detail').textContent = t('home.sd24e251', { p0: summary.level || t('home.s2f144d1'), p1: groupDisplayName(summary.group), p2: summary.notes, p3: summary.lines });
          const credits = container.parentElement.querySelector('.project-credits');
          credits.textContent = t('home.sb2f237a', { p0: summary.composer || t('home.se09740c'), p1: summary.charter || t('home.s1b54779') }); credits.title = credits.textContent;
        }
      }
    }
    if (!thumbnail || !container.isConnected) return;
    this.coverCache.set(id, thumbnail); const url = URL.createObjectURL(thumbnail); this.coverUrls.push(url);
    const image = document.createElement('img'); image.src = url; image.alt = t('home.se3b619d', { p0: summary.name }); container.replaceChildren(image);
  }
  async modify(id, transform) {
    const source = await readProject(id); if (!source) throw new Error(t('home.s7736038'));
    const project = transform(source); project.updated = Date.now();
    await storeProject(project); this.changed(project); await this.refresh();
  }
  remove(project) {
    const host = showDialog(t('home.s8dd153b'), nativeStorage ? t('home.sc10be0f', { p0: project.name }) : t('home.s423117f', { p0: project.name }));
    const backups = document.createElement('input'); backups.type = 'checkbox'; backups.setAttribute('aria-label', t('home.s294efcc'));
    const label = document.createElement('label'); label.className = 'field'; label.append(backups, t('home.s294efcc')); host.append(label);
    const apply = document.getElementById('modal-apply'); apply.hidden = false; apply.textContent = nativeStorage ? t('home.s298cbe3') : t('home.sc43ea4c');
    apply.onclick = async () => {
      apply.disabled = true;
      try {
        await deleteProject(project.id, project.storageRevision);
        this.coverCache.delete(project.id); this.changed({ ...project, deleted: true });
        if (backups.checked) await deleteProjectDrafts(project.id);
        document.getElementById('modal').close(); await this.refresh();
      } catch (error) { apply.disabled = false; document.getElementById('modal-error').textContent = error.message; }
    };
  }
  edit(project) {
    const content = showDialog(t('home.sf79a83e'), t('home.sb6a4150'));
    const name = document.createElement('input'); name.value = project.name; name.setAttribute('aria-label', t('home.s3e72555'));
    const group = document.createElement('input'); group.value = isUngrouped(project.group) ? '' : project.group; group.setAttribute('aria-label', t('home.sa8d7295'));
    for (const [title, input] of [[t('home.s1be7ae4'), name], [t('home.s97d8a6c'), group]]) { const label = document.createElement('label'); label.className = 'field'; label.append(title, input); content.append(label); }
    const apply = document.getElementById('modal-apply'); apply.hidden = false;
    apply.onclick = async () => {
      try {
        if (!name.value.trim()) throw new Error(t('home.s9695a59'));
        // An empty group is stored as an empty string, never as localized text.
        await this.modify(project.id, source => ({ ...source, group: group.value.trim(), chart: { ...source.chart, META: { ...source.chart.META, name: name.value.trim() } } }));
        document.getElementById('modal').close();
      } catch (error) { document.getElementById('modal-error').textContent = error.message; }
    };
  }
}
import { nativeStorage } from '../platform/native.mjs';
