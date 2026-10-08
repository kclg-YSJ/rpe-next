import { listProjects, readProject, storeProject, projectSummary, updateSummary } from '../platform/library.ts';
import type { ProjectSummary, StoredProject } from '../platform/library.ts';
import { showDialog } from './dialog.ts';
import { projectThumbnail } from '../platform/thumbnail.ts';

/**
 * The chart library page: the project grid, its search/group/archive filters and the per-card
 * actions.
 *
 * The three collaborators are injected rather than imported so the editor can own navigation and
 * error reporting:
 * - `openProject` loads a stored project into the editor (it may reject, hence the `Promise`);
 * - `reportError` surfaces a failure to the user (it receives whatever was thrown, so `unknown`);
 * - `changed` is told about a project that was just written back.
 */
export class ProjectHome {
  openProject: (id: string) => Promise<void>;
  reportError: (error: unknown) => void;
  changed: (project: StoredProject) => void;
  /** Card elements whose covers were already revoked or rendered, tracked so their URLs can be freed. */
  projects: ProjectSummary[];
  /** Object URLs handed to the cards of the current render. */
  coverUrls: string[];
  /** Thumbnails that were rendered this session but are not (yet) in the stored summary. */
  coverCache: Map<string, Blob | null>;
  /** How many cards the grid currently shows; grows by 24 through the "show more" button. */
  limit: number;
  /** Renders covers only as they scroll near the viewport. */
  observer: IntersectionObserver;

  constructor(
    openProject: (id: string) => Promise<void>,
    reportError: (error: unknown) => void,
    changed: (project: StoredProject) => void,
  ) {
    this.openProject = openProject; this.reportError = reportError; this.changed = changed; this.projects = []; this.coverUrls = []; this.coverCache = new Map(); this.limit = 24;
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { this.observer.unobserve(entry.target); this.loadCover(entry.target as HTMLElement).catch(() => {}); }
    }, { rootMargin: '100px' });
    // The markup always provides these four controls; the lookups are typed to what `index.html`
    // declares so the handlers can read `value`/`checked` without narrowing at every use.
    for (const id of ['project-search', 'project-group', 'project-sort', 'show-archived']) document.getElementById(id)!.addEventListener(id === 'project-search' ? 'input' : 'change', () => this.render());
  }
  async refresh(): Promise<void> {
    this.projects = (await listProjects()) ?? [];
    const select = document.getElementById('project-group') as HTMLSelectElement;
    const previous = select.value;
    select.replaceChildren(new Option('全部分组', ''));
    for (const group of [...new Set(this.projects.map(project => project.group ?? '未分组'))].sort()) select.append(new Option(group, group));
    select.value = previous; this.render();
  }
  render(): void {
    this.observer.disconnect(); for (const url of this.coverUrls) URL.revokeObjectURL(url); this.coverUrls = [];
    const query = (document.getElementById('project-search') as HTMLInputElement).value.trim().toLocaleLowerCase();
    const group = (document.getElementById('project-group') as HTMLSelectElement).value;
    const archived = (document.getElementById('show-archived') as HTMLInputElement).checked;
    const sort = (document.getElementById('project-sort') as HTMLSelectElement).value;
    const entries = this.projects.filter(project => Boolean(project.archived) === archived && (!group || (project.group ?? '未分组') === group) && `${project.name} ${project.charter ?? ''} ${project.group ?? ''}`.toLocaleLowerCase().includes(query))
      .sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || (sort === 'name' ? left.name.localeCompare(right.name) : (right.updated ?? right.imported ?? 0) - (left.updated ?? left.imported ?? 0)));
    const container = document.getElementById('project-cards')!; container.replaceChildren();
    document.getElementById('project-count')!.textContent = `${entries.length} 个项目`;
    document.getElementById('home-empty')!.textContent = entries.length ? '' : '尚无匹配项目。新建后保存，或选择原 RPE 主文件夹迁移项目。';
    for (const project of entries.slice(0, this.limit)) {
      const card = document.createElement('article'); card.className = 'project-card';
      const cover = document.createElement('div'); cover.className = 'project-cover'; cover.dataset.projectId = project.id;
      const placeholder = document.createElement('span'); placeholder.textContent = '♪'; cover.append(placeholder); this.observer.observe(cover);
      const name = document.createElement('h2'); name.textContent = `${project.pinned ? '★ ' : ''}${project.name}`;
      const detail = document.createElement('p'); detail.className = 'project-detail'; detail.textContent = `${project.level || '未标难度'} · ${project.group ?? '未分组'} · ${project.notes ?? '—'} notes · ${project.lines ?? '—'} 条线`;
      const credits = document.createElement('p'); credits.className = 'project-credits'; credits.textContent = `${project.composer || '未知曲师'} / ${project.charter || '未知谱师'}`; credits.title = credits.textContent;
      const date = document.createElement('p'); date.textContent = `${new Date(project.updated ?? project.imported ?? 0).toLocaleString()} · ${((project.bytes ?? 0) / 1048576).toFixed(1)} MiB`;
      const open = document.createElement('button'); open.className = 'project-open primary'; open.textContent = '打开谱面'; open.onclick = () => this.openProject(project.id).catch(this.reportError);
      const actions = document.createElement('div'); actions.className = 'project-actions';
      // Each entry pairs a button label with the action it runs; `action` returns the promise the
      // click handler has to settle, so it is typed to the stored-project operation it performs.
      const buttons: [string, () => Promise<void>][] = [['名称 / 分组', () => this.edit(project)], [project.pinned ? '取消置顶' : '置顶', () => this.modify(project.id, source => ({ ...source, pinned: !source.pinned }))],
        ['复制', () => this.modify(project.id, source => ({ ...source, id: crypto.randomUUID(), source: 'Next 项目副本', pinned: false, archived: false, chart: { ...source.chart, META: { ...source.chart.META, name: `${source.chart.META.name} 副本` } } }))],
        [project.archived ? '恢复' : '归档', () => this.modify(project.id, source => ({ ...source, archived: !source.archived }))]];
      for (const [label, action] of buttons) {
        const button = document.createElement('button'); button.textContent = label; button.onclick = () => Promise.resolve(action()).catch(this.reportError); actions.append(button);
      }
      const information = document.createElement('div'); information.className = 'project-information'; information.append(name, detail, credits, date, open, actions);
      card.append(cover, information); container.append(card);
    }
    if (entries.length > this.limit) { const more = document.createElement('button'); more.textContent = `显示更多（还有 ${entries.length - this.limit} 个）`; more.onclick = () => { this.limit += 24; this.render(); }; container.append(more); }
  }
  async loadCover(container: HTMLElement): Promise<void> {
    const id = container.dataset.projectId ?? ''; let summary = this.projects.find(project => project.id === id);
    let thumbnail = summary?.thumbnail ?? this.coverCache.get(id);
    if (summary?.version !== 2) {
      const project = await readProject(id);
      if (project) {
        thumbnail = await projectThumbnail(project); summary = projectSummary(project, thumbnail); await updateSummary(summary);
        this.projects = this.projects.map(entry => entry.id === id ? summary! : entry);
        if (container.isConnected) {
          container.parentElement!.querySelector('.project-detail')!.textContent = `${summary.level || '未标难度'} · ${summary.group} · ${summary.notes} notes · ${summary.lines} 条线`;
          const credits = container.parentElement!.querySelector<HTMLElement>('.project-credits')!;
          credits.textContent = `${summary.composer || '未知曲师'} / ${summary.charter || '未知谱师'}`; credits.title = credits.textContent;
        }
      }
    }
    if (!thumbnail || !container.isConnected) return;
    this.coverCache.set(id, thumbnail); const url = URL.createObjectURL(thumbnail); this.coverUrls.push(url);
    const image = document.createElement('img'); image.src = url; image.alt = `${summary!.name} 曲绘`; container.replaceChildren(image);
  }
  async modify(id: string, transform: (source: StoredProject) => StoredProject): Promise<void> {
    const source = await readProject(id); if (!source) throw new Error('此项目不存在，请刷新谱面库');
    const project = transform(source); project.updated = Date.now();
    await storeProject(project); this.changed(project); await this.refresh();
  }
  edit(project: ProjectSummary): Promise<void> {
    const content = showDialog('项目名称与分组', '修改本地副本信息；原 RPE 文件不变。');
    const name = document.createElement('input'); name.value = project.name; name.setAttribute('aria-label', '项目名称');
    const group = document.createElement('input'); group.value = project.group ?? '未分组'; group.setAttribute('aria-label', '项目分组名称');
    for (const [title, input] of [['名称', name], ['分组', group]]) { const label = document.createElement('label'); label.className = 'field'; label.append(title, input); content.append(label); }
    const apply = document.getElementById('modal-apply') as HTMLButtonElement; apply.hidden = false;
    apply.onclick = async () => {
      try {
        if (!name.value.trim()) throw new Error('请输入项目名称');
        await this.modify(project.id, source => ({ ...source, group: group.value.trim() || '未分组', chart: { ...source.chart, META: { ...source.chart.META, name: name.value.trim() } } }));
        (document.getElementById('modal') as HTMLDialogElement).close();
      } catch (error) { document.getElementById('modal-error')!.textContent = error instanceof Error ? error.message : String(error); }
    };
    return Promise.resolve();
  }
}
