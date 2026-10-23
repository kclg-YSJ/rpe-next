import { ChartRepository } from '../application/chart-vcs.mjs';
import { shortId } from '../core/chart-vcs.mjs';
import { serializeChart } from '../core/chart.mjs';
import { createMemoryVersionStore, openVersionStore } from '../platform/version-store.mjs';
import { download } from '../platform/files.mjs';
import { showDialog } from './dialog.mjs';
import { t } from '../i18n.mjs';

const SVG = 'http://www.w3.org/2000/svg';
const COLORS = ['#FFB000', '#DC267F', '#994F00', '#40B0A6', '#B66DFF', '#72D6A8', '#8CB4FF', '#FF9A8A'];
const ROW_HEIGHT = 22;
const LANE_WIDTH = 11;
const CURVE_RADIUS = 5;
const CIRCLE_RADIUS = 4;
const CIRCLE_STROKE = 2;
const GRAPH_BACKGROUND = '#1f2329';

function el(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.title) node.title = options.title;
  if (options.type) node.type = options.type;
  if (options.value !== undefined) node.value = options.value;
  if (options.placeholder !== undefined) node.placeholder = options.placeholder;
  if (options.hidden) node.hidden = true;
  if (options.disabled) node.disabled = true;
  if (options.dataset) Object.assign(node.dataset, options.dataset);
  if (options.attrs) for (const [key, value] of Object.entries(options.attrs)) node.setAttribute(key, value);
  if (options.on) for (const [event, handler] of Object.entries(options.on)) node.addEventListener(event, handler);
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  return node;
}

function button(label, onClick, options = {}) {
  return el('button', { type: 'button', text: label, className: options.className, title: options.title, disabled: options.disabled, on: { click: onClick } });
}

function formatDate(timestamp) {
  if (!Number.isFinite(timestamp)) return t('version-control.s53695a8');
  return new Date(timestamp).toLocaleString();
}

function jsonPreview(value, limit = 120) {
  if (value === undefined) return t('version-control.s258f5f3');
  let text;
  try { text = JSON.stringify(value); } catch { text = String(value); }
  if (text === undefined) return t('version-control.s258f5f3');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function assetLabel(entry) {
  if (!entry) return t('version-control.sbecd43c');
  return `${entry.path} · ${shortId(entry.blob)} · ${entry.size} B`;
}

function changeCount(diff) {
  if (!diff) return 0;
  return (diff.chartChanged ? 1 : 0) + (diff.added?.length ?? 0) + (diff.modified?.length ?? 0) + (diff.deleted?.length ?? 0) + (diff.foldersChanged ? 1 : 0);
}

function commitMessage(commit) {
  return String(commit?.message ?? '').split('\n')[0];
}

export class VersionControlPanel {
  constructor(host, context, actions) {
    this.host = host;
    this.context = context;
    this.actions = actions;
    this.tab = 'graph';
    this.scope = 'refs';
    this.store = null;
    this.repo = null;
    this.repoId = null;
    this.repoState = null;
    this.state = null;
    this.commits = [];
    this.layout = null;
    this.selectedCommit = null;
    this.detail = null;
    this.workingDiff = null;
    this.mergeChoices = new Map();
    this.messageDraft = '';
    this.authorDraft = null;
    this.amendDraft = false;
    this.stashDraft = '';
    this.branchDraft = '';
    this.tagDraft = '';
    this.mergeTarget = '';
    this.busy = false;
    this.error = null;
    this.build();
  }

  build() {
    this.host.replaceChildren();
    this.host.classList.add('vcs-panel');
    this.branchLabel = el('strong', { className: 'vcs-branch-name', text: t('version-control.se15f364') });
    this.headState = el('span', { className: 'vcs-state' });
    const header = el('div', { className: 'vcs-head' },
      el('div', { className: 'vcs-head-main' }, this.branchLabel, this.headState),
      button(t('version-control.s38108ea'), () => this.refresh().catch(error => this.report(error)), { title: t('version-control.s9c64f72') })
    );
    this.tabs = new Map();
    const tabs = el('div', { className: 'vcs-tabs', attrs: { role: 'tablist' } });
    for (const [name, label] of [['graph', t('version-control.sa66b71e')], ['changes', t('version-control.s9d83d54')], ['branches', t('version-control.s2f6f9d5')], ['stash', t('version-control.s9df47fb')], ['reflog', t('version-control.s4de5089')]]) {
      const tab = button(label, () => {
        this.tab = name;
        this.error = null;
        if (name === 'changes') this.refresh().catch(error => this.report(error));
        else this.render();
      });
      tab.dataset.vcsTab = name;
      this.tabs.set(name, tab);
      tabs.append(tab);
    }
    this.banner = el('p', { className: 'vcs-banner', hidden: true });
    this.body = el('div', { className: 'vcs-body' });
    this.fileInput = el('input', { type: 'file', hidden: true, attrs: { accept: '.json,.rpevcs,application/json' } });
    this.fileInput.addEventListener('change', () => this.importBundleFile().catch(error => this.report(error)));
    this.host.append(header, tabs, this.banner, this.body, this.fileInput);
  }

  detach() {
    this.repo = null;
    this.repoId = null;
    this.repoState = null;
    this.state = null;
    this.commits = [];
    this.layout = null;
    this.selectedCommit = null;
    this.detail = null;
    this.workingDiff = null;
    this.mergeChoices.clear();
    this.tab = 'graph';
    this.messageDraft = '';
    this.authorDraft = null;
    this.amendDraft = false;
    this.branchDraft = '';
    this.tagDraft = '';
    this.stashDraft = '';
    this.mergeTarget = '';
    this.error = null;
    this.branchLabel.textContent = t('version-control.se15f364');
    this.headState.textContent = '';
    this.banner.hidden = true;
    this.body.replaceChildren();
  }

  snapshot() {
    return {
      chart: this.context.getChart(), assets: this.context.getAssets(),
      folders: this.context.getFolders(), chartName: this.context.getChartName()
    };
  }

  notify(message, level = 'success') { this.actions.notify?.(message, level); }

  report(error) {
    this.error = error?.message ?? String(error);
    this.render();
    this.actions.reportError?.(error);
  }

  async run(task) {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    try { await task(); }
    catch (error) { this.report(error); }
    finally { this.busy = false; }
  }

  async ensure() {
    const repoId = this.context.getRepoId();
    if (this.repo && this.repoId === repoId) return;
    this.store = this.store ?? openVersionStore();
    this.repoId = repoId;
    this.repo = new ChartRepository(this.store, repoId);
    try { await this.repo.init(); }
    catch (error) {
      this.store = createMemoryVersionStore();
      this.repo = new ChartRepository(this.store, repoId);
      await this.repo.init();
      this.notify(t('version-control.s2688b69'), 'warning', 8000);
      this.error = error.message;
    }
    const repo = await this.repo.read();
    const hasCommit = Object.values(repo.branches ?? {}).some(Boolean) || Boolean(repo.head?.commit);
    if (!hasCommit) {
      await this.repo.stage(this.snapshot());
      await this.repo.commit({ message: t('version-control.s24eddf1'), author: repo.config?.author });
      this.notify(t('version-control.s1849d97'), 'success');
    }
  }

  async open() {
    if (!this.context.hasDocument()) {
      this.branchLabel.textContent = t('version-control.s9ee9916');
      this.headState.textContent = '';
      this.body.replaceChildren(el('p', { className: 'vcs-empty', text: t('version-control.sac0a9cd') }));
      return;
    }
    await this.run(async () => {
      await this.ensure();
      if (!this.store?.ephemeral) {
        try { await this.actions.persistRepoId?.(); }
        catch (error) { this.notify(t('version-control.sf9d0085', { p0: error.message }), 'warning', 7000); }
      }
      await this.refresh();
    });
  }

  async refresh() {
    if (!this.context.hasDocument()) return;
    this.error = null;
    await this.ensure();
    const repo = await this.repo.read();
    this.repoState = repo;
    this.state = await this.repo.status(this.snapshot());
    this.commits = await this.repo.log({ currentOnly: this.scope === 'current', includeDangling: this.scope === 'all' });
    this.layout = this.repo.graph(this.commits, repo);
    this.workingDiff = this.tab === 'changes' ? await this.repo.workingDiff(this.snapshot()).catch(() => null) : null;
    if (!this.selectedCommit || !this.commits.some(commit => commit.id === this.selectedCommit)) this.selectedCommit = this.state.headId ?? this.commits[0]?.id ?? null;
    this.detail = this.selectedCommit ? await this.repo.diffCommit(this.selectedCommit).catch(() => null) : null;
    if (this.authorDraft === null) this.authorDraft = { ...(repo.config?.author ?? { name: t('version-control.sea431f3'), email: 'local@rpe-next' }) };
    this.mergeChoices.clear();
    this.render();
  }

  render() {
    if (!this.repoState) return;
    const state = this.state;
    const branch = state?.branch ?? (state?.headId ? t('version-control.s5a0d1a9', { p0: shortId(state.headId) }) : t('version-control.s11b4db2'));
    this.branchLabel.textContent = branch;
    this.branchLabel.title = state?.detached ? t('version-control.s95d239a') : t('version-control.s0eb05c8');
    const pending = (state?.staged.total ?? 0) + (state?.unstaged.total ?? 0);
    this.headState.textContent = state?.clean ? t('version-control.sb7b0136') : t('version-control.s3d17c2b', { p0: pending });
    this.headState.className = `vcs-state ${state?.clean ? 'clean' : 'dirty'}`;
    for (const [name, tab] of this.tabs) {
      tab.classList.toggle('active', name === this.tab);
      tab.setAttribute('aria-selected', String(name === this.tab));
    }
    const messages = [];
    if (this.store?.ephemeral) messages.push(t('version-control.s2274c6a'));
    if (this.context.isPersisted && !this.context.isPersisted()) messages.push(t('version-control.s1dd03fe'));
    if (this.repoState.merge) messages.push(t('version-control.s02f0023', { p0: this.repoState.merge.kind === 'merge' ? t('version-control.se5badf9') : this.repoState.merge.kind === 'cherry-pick' ? t('version-control.sdb82ac7') : this.repoState.merge.kind === 'revert' ? t('version-control.sdedece7') : t('version-control.sf3ea6d3'), p1: this.repoState.merge.conflicts.length }));
    if (this.error) messages.push(this.error);
    this.banner.textContent = messages.join(' ');
    this.banner.hidden = !messages.length;
    this.banner.className = `vcs-banner ${this.error ? 'error' : ''}`;
    const scrollTop = this.body.scrollTop;
    const graphScroll = this.body.querySelector('.vcs-graph-scroll');
    const graphPosition = graphScroll ? { left: graphScroll.scrollLeft, top: graphScroll.scrollTop } : null;
    this.body.replaceChildren(this.renderTab());
    this.body.scrollTop = scrollTop;
    if (graphPosition) {
      const next = this.body.querySelector('.vcs-graph-scroll');
      if (next) { next.scrollLeft = graphPosition.left; next.scrollTop = graphPosition.top; }
    }
    const selectedRow = this.body.querySelector('.vcs-graph-row.selected');
    const graphContainer = this.body.querySelector('.vcs-graph-scroll');
    if (selectedRow && graphContainer) {
      const top = Number(selectedRow.dataset.index ?? 0) * ROW_HEIGHT;
      const bottom = top + ROW_HEIGHT;
      if (top < graphContainer.scrollTop) graphContainer.scrollTop = top;
      else if (bottom > graphContainer.scrollTop + graphContainer.clientHeight) graphContainer.scrollTop = bottom - graphContainer.clientHeight;
    }
  }

  tick() {
    if (!this.state) return;
    const pending = (this.state.staged.total ?? 0) + (this.state.unstaged.total ?? 0);
    const dirty = this.context.isDirty?.();
    this.headState.textContent = t('version-control.s46212d2', { p0: this.state.clean ? t('version-control.sb7b0136') : t('version-control.s3d17c2b', { p0: pending }), p1: dirty ? t('version-control.s8de9a82') : '' });
    this.headState.className = `vcs-state ${this.state.clean ? 'clean' : 'dirty'}`;
  }

  renderTab() {
    if (this.repoState?.merge) return this.renderMergeState();
    if (this.tab === 'changes') return this.renderChangesTab();
    if (this.tab === 'branches') return this.renderBranchesTab();
    if (this.tab === 'stash') return this.renderStashTab();
    if (this.tab === 'reflog') return this.renderReflogTab();
    return this.renderGraphTab();
  }

  renderGraphTab() {
    const pane = el('div', { className: 'vcs-pane' });
    const scope = el('select', { value: this.scope, attrs: { 'aria-label': t('version-control.s98dbf1f') }, on: { change: event => { this.scope = event.target.value; this.refresh().catch(error => this.report(error)); } } },
      new Option(t('version-control.sf473204'), 'refs'), new Option(t('version-control.s0eb05c8'), 'current'), new Option(t('version-control.s9a68427'), 'all'));
    scope.value = this.scope;
    const toolbar = el('div', { className: 'vcs-toolbar' }, scope,
      button(t('version-control.s38108ea'), () => this.refresh().catch(error => this.report(error))),
      button(t('version-control.s4c5aae4'), () => { this.tab = 'changes'; this.render(); }, { className: 'primary' }));
    const scroll = el('div', { className: 'vcs-graph-scroll' }, this.buildGraph());
    pane.append(toolbar, scroll);
    if (this.detail) pane.append(this.buildCommitDetail());
    else if (!this.commits.length) pane.append(el('p', { className: 'vcs-empty', text: t('version-control.sa10743a') }));
    return pane;
  }

  buildGraph() {
    const layout = this.layout;
    if (!layout?.rows.length) return el('p', { className: 'vcs-empty', text: t('version-control.sdffd878') });
    const laneX = lane => LANE_WIDTH * (lane + 1);
    const colorOf = index => COLORS[index % COLORS.length];
    const labelX = LANE_WIDTH * (Math.max(1, layout.laneCount) + 1) + 8;
    const messageChars = Math.max(18, Math.min(48, ...layout.rows.map(row => commitMessage(row.commit).length)));
    const messageWidth = messageChars * 12;
    const width = labelX + 170 + messageWidth + 12;
    const height = layout.rows.length * ROW_HEIGHT + 4;
    const svg = svgEl('svg', { class: 'vcs-graph', viewBox: `0 0 ${width} ${height}`, width, height, role: 'tree', 'aria-label': t('version-control.s716ac28') });
    const defs = svgEl('defs');
    for (const row of layout.rows) {
      const clip = svgEl('clipPath', { id: `vcs-row-clip-${row.index}` });
      clip.append(svgEl('rect', { x: 0, y: 0, width, height: ROW_HEIGHT }));
      defs.append(clip);
    }
    svg.append(defs);
    const addPath = (group, d, color, strokeWidth = 1) => {
      group.append(svgEl('path', {
        d, fill: 'none', stroke: colorOf(color), 'stroke-width': strokeWidth,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round'
      }));
    };
    const findLastIndex = (nodes, id) => {
      for (let index = nodes.length - 1; index >= 0; index--) if (nodes[index].id === id) return index;
      return -1;
    };
    for (const row of layout.rows) {
      const group = svgEl('g', {
        class: `vcs-graph-row${this.selectedCommit === row.id ? ' selected' : ''}`,
        'data-commit': row.id, 'data-index': row.index, tabindex: '0', role: 'button',
        transform: `translate(0 ${row.index * ROW_HEIGHT})`, 'clip-path': `url(#vcs-row-clip-${row.index})`
      });
      group.append(svgEl('rect', { x: 0, y: 0, width, height: ROW_HEIGHT, class: 'vcs-graph-hit' }));

      let outputIndex = 0;
      for (let index = 0; index < row.inputSwimlanes.length; index++) {
        const node = row.inputSwimlanes[index];
        if (node.id === row.id) {
          if (index !== row.circleIndex) {
            addPath(group, `M ${laneX(index)} 0 A ${LANE_WIDTH} ${LANE_WIDTH} 0 0 1 ${LANE_WIDTH * index} ${LANE_WIDTH} H ${laneX(row.circleIndex)}`, node.color);
          } else {
            outputIndex++;
          }
        } else if (outputIndex < row.outputSwimlanes.length && node.id === row.outputSwimlanes[outputIndex].id) {
          if (index === outputIndex) {
            addPath(group, `M ${laneX(index)} 0 V ${ROW_HEIGHT}`, node.color);
          } else {
            const x1 = laneX(index), x2 = laneX(outputIndex);
            addPath(group, `M ${x1} 0 V ${LANE_WIDTH - CURVE_RADIUS} A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 1 ${x1 - CURVE_RADIUS} ${ROW_HEIGHT / 2} H ${x2 + CURVE_RADIUS} A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 0 ${x2} ${ROW_HEIGHT / 2 + CURVE_RADIUS} V ${ROW_HEIGHT}`, node.color);
          }
          outputIndex++;
        }
      }

      for (let index = 1; index < (row.commit.parents ?? []).length; index++) {
        const parentOutputIndex = findLastIndex(row.outputSwimlanes, row.commit.parents[index]);
        if (parentOutputIndex === -1) continue;
        const color = row.outputSwimlanes[parentOutputIndex].color;
        const startX = LANE_WIDTH * parentOutputIndex;
        addPath(group, `M ${startX} ${ROW_HEIGHT / 2} A ${LANE_WIDTH} ${LANE_WIDTH} 0 0 1 ${laneX(parentOutputIndex)} ${ROW_HEIGHT} M ${startX} ${ROW_HEIGHT / 2} H ${laneX(row.circleIndex)}`, color);
      }

      const inputIndex = row.inputSwimlanes.findIndex(node => node.id === row.id);
      if (inputIndex !== -1) addPath(group, `M ${laneX(row.circleIndex)} 0 V ${ROW_HEIGHT / 2}`, row.inputSwimlanes[inputIndex].color);
      if ((row.commit.parents ?? []).length > 0) {
        const laneColor = inputIndex !== -1 ? row.inputSwimlanes[inputIndex].color : row.circleColor;
        addPath(group, `M ${laneX(row.circleIndex)} ${ROW_HEIGHT / 2} V ${ROW_HEIGHT}`, laneColor);
      }

      const cx = laneX(row.circleIndex), cy = LANE_WIDTH;
      if (row.head) {
        group.append(svgEl('circle', { cx, cy, r: CIRCLE_RADIUS + 3, fill: colorOf(row.circleColor), stroke: colorOf(row.circleColor), 'stroke-width': CIRCLE_STROKE }));
        group.append(svgEl('circle', { cx, cy, r: CIRCLE_STROKE, fill: 'none', stroke: GRAPH_BACKGROUND, 'stroke-width': CIRCLE_STROKE * 2 }));
      } else if ((row.commit.parents ?? []).length > 1) {
        group.append(svgEl('circle', { cx, cy, r: CIRCLE_RADIUS + 2, fill: colorOf(row.circleColor), stroke: colorOf(row.circleColor), 'stroke-width': CIRCLE_STROKE }));
        group.append(svgEl('circle', { cx, cy, r: CIRCLE_RADIUS - 1, fill: colorOf(row.circleColor), stroke: colorOf(row.circleColor), 'stroke-width': CIRCLE_STROKE }));
      } else {
        group.append(svgEl('circle', { cx, cy, r: CIRCLE_RADIUS + 1, fill: colorOf(row.circleColor), stroke: colorOf(row.circleColor), 'stroke-width': CIRCLE_STROKE }));
      }

      group.append(svgEl('text', { x: labelX, y: cy + 4, class: 'vcs-graph-id', text: shortId(row.id) }));
      const refLabels = row.refs.map(ref => ({
        text: ref.type === 'branch' ? ref.name : ref.type === 'tag' ? `#${ref.name}` : 'HEAD',
        color: ref.color
      }));
      if (refLabels.length) {
        const refNode = svgEl('text', { x: labelX + 58, y: cy + 4, class: 'vcs-graph-ref' });
        let remaining = 12;
        for (const ref of refLabels) {
          if (remaining <= 0) break;
          const text = ref.text.length > remaining ? `${ref.text.slice(0, Math.max(1, remaining - 1))}…` : ref.text;
          const tspan = svgEl('tspan', { fill: colorOf(ref.color) });
          tspan.textContent = `${text} `;
          refNode.append(tspan);
          remaining -= text.length + 1;
        }
        group.append(refNode);
      }
      const message = svgEl('text', { x: labelX + 170, y: cy + 4, class: 'vcs-graph-message' });
      const text = commitMessage(row.commit);
      message.textContent = text.length > messageChars ? `${text.slice(0, messageChars - 1)}…` : text;
      group.append(message);
      const title = svgEl('title');
      const refs = refLabels.map(ref => ref.text).join(' ');
      title.textContent = `${shortId(row.id)} ${text}\n${formatDate(row.commit.timestamp)} · ${row.commit.author?.name ?? ''}${refs ? `\n${refs}` : ''}`;
      group.append(title);
      svg.append(group);
    }
    svg.addEventListener('click', event => {
      const group = event.target.closest?.('[data-commit]');
      if (group) this.selectCommit(group.dataset.commit);
    });
    svg.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return;
      const group = event.target.closest?.('[data-commit]');
      if (group) { event.preventDefault(); this.selectCommit(group.dataset.commit); }
    });
    return svg;
  }

  selectCommit(id) {
    if (this.selectedCommit === id && this.detail) return;
    if (!this.repo) return;
    this.selectedCommit = id;
    this.detail = null;
    this.render();
    this.repo.diffCommit(id).then(detail => {
      if (this.selectedCommit !== id) return;
      this.detail = detail;
      this.render();
    }).catch(error => this.report(error));
  }

  buildCommitDetail() {
    const { commit, parent, chartDiff, treeDiff } = this.detail;
    const host = el('div', { className: 'vcs-detail' });
    const refs = [];
    for (const [name, id] of Object.entries(this.repoState.branches ?? {})) if (id === commit.id) refs.push(t('version-control.s6b29789', { p0: name }));
    for (const [name, tag] of Object.entries(this.repoState.tags ?? {})) if ((typeof tag === 'string' ? tag : tag?.commit) === commit.id) refs.push(t('version-control.scd013ed', { p0: name }));
    if (this.state?.headId === commit.id) refs.push('HEAD');
    host.append(el('h3', { text: commit.message || t('version-control.s7890f1e') }));
    host.append(el('p', { className: 'vcs-meta', text: `${shortId(commit.id)} · ${commit.author?.name ?? ''} <${commit.author?.email ?? ''}> · ${formatDate(commit.timestamp)}` }));
    if (refs.length) host.append(el('p', { className: 'vcs-refs', text: refs.join(' · ') }));
    if (commit.parents?.length) {
      const parents = el('p', { className: 'vcs-parents' }, t('version-control.scd3fadb'));
      for (const id of commit.parents) parents.append(button(shortId(id), () => this.selectCommit(id), { className: 'vcs-link' }));
      host.append(parents);
    }
    const actions = el('div', { className: 'vcs-action-grid' });
    actions.append(
      button(t('version-control.sa2b92b8'), () => this.checkoutCommit(commit.id)),
      button(t('version-control.s65a957f'), () => this.createBranchAt(commit.id)),
      button(t('version-control.s616054b'), () => this.createTagAt(commit.id)),
      button(t('version-control.s885a9ea'), () => this.cherryPick(commit.id)),
      button(t('version-control.s54c0e2d'), () => this.revert(commit.id)),
      button(t('version-control.sf212b14'), () => this.resetTo(commit.id)),
      button(t('version-control.s6968d90'), () => this.exportCommitChart(commit.id))
    );
    host.append(actions);
    host.append(el('h4', { text: parent ? t('version-control.s6a1f22b', { p0: shortId(parent.id) }) : t('version-control.s7b3ab8e') }));
    host.append(this.renderTreeDiff(treeDiff, { initial: !parent }));
    host.append(this.renderChartDiff(chartDiff));
    return host;
  }

  renderTreeDiff(diff, { initial = false } = {}) {
    const host = el('div', { className: 'vcs-tree-diff' });
    if (!diff || changeCount(diff) === 0) { host.append(el('p', { className: 'vcs-muted', text: t('version-control.sc654953') })); return host; }
    if (diff.chartChanged) host.append(el('div', { className: 'vcs-file-row' }, el('span', { text: t('version-control.sc874113') }), el('span', { className: `vcs-badge ${initial ? 'added' : 'modified'}`, text: initial ? t('version-control.s2cd9e6c') : t('version-control.sc920e42') })));
    if (diff.chartNameChanged) host.append(el('div', { className: 'vcs-file-row' }, el('span', { text: t('version-control.sf4769c1') }), el('span', { className: `vcs-badge ${initial ? 'added' : 'modified'}`, text: initial ? t('version-control.s2cd9e6c') : t('version-control.sc920e42') })));
    if (diff.foldersChanged) host.append(el('div', { className: 'vcs-file-row' }, el('span', { text: t('version-control.sae2b82e') }), el('span', { className: `vcs-badge ${initial ? 'added' : 'modified'}`, text: initial ? t('version-control.s2cd9e6c') : t('version-control.sc920e42') })));
    for (const entry of diff.added ?? []) host.append(el('div', { className: 'vcs-file-row' }, el('span', { text: entry.path }), el('span', { className: 'vcs-badge added', text: t('version-control.s2cd9e6c') })));
    for (const entry of diff.modified ?? []) host.append(el('div', { className: 'vcs-file-row' }, el('span', { text: entry.path }), el('span', { className: 'vcs-badge modified', text: t('version-control.sc9c7751') })));
    for (const entry of diff.deleted ?? []) host.append(el('div', { className: 'vcs-file-row' }, el('span', { text: entry.path }), el('span', { className: 'vcs-badge deleted', text: t('version-control.s3755f56') })));
    return host;
  }

  renderChartDiff(diff) {
    const host = el('div', { className: 'vcs-chart-diff' });
    if (!diff || diff.total === 0) { host.append(el('p', { className: 'vcs-muted', text: t('version-control.saf84743') })); return host; }
    const rows = [
      ['判定线', diff.lines.added, diff.lines.removed, diff.lines.modified],
      [t('version-control.s7ac3289'), diff.notes.added, diff.notes.removed, diff.notes.modified],
      [t('version-control.s550e328'), diff.events.added, diff.events.removed, diff.events.modified],
      ['BPM', diff.bpm.added, diff.bpm.removed, diff.bpm.modified]
    ];
    const maximum = Math.max(1, ...rows.flatMap(row => row.slice(1)));
    const bars = el('div', { className: 'vcs-diff-bars' });
    for (const [label, added, removed, modified] of rows) {
      if (!added && !removed && !modified) continue;
      const row = el('div', { className: 'vcs-diff-bar-row' });
      row.append(el('span', { className: 'vcs-diff-label', text: label }));
      const bar = el('div', { className: 'vcs-diff-bar' });
      for (const [value, kind, title] of [[added, 'added', t('version-control.sfc5a085', { p0: added })], [removed, 'deleted', t('version-control.sa4e7877', { p0: removed })], [modified, 'modified', t('version-control.se66b35f', { p0: modified })]]) {
        if (!value) continue;
        bar.append(el('span', { className: `vcs-diff-segment ${kind}`, title, attrs: { style: `flex:${value / maximum}` } }));
      }
      row.append(bar);
      row.append(el('span', { className: 'vcs-diff-count', text: `+${added} -${removed} ~${modified}` }));
      bars.append(row);
    }
    host.append(bars);
    const groups = [
      ['meta', t('version-control.sd352b59')], ['bpm', 'BPM'], ['line', '判定线'],
      ['note', t('version-control.s7ac3289')], ['event', t('version-control.s550e328')], ['other', t('version-control.s6dc5366')]
    ];
    for (const [kind, label] of groups) {
      const items = (diff.details ?? []).filter(item => item.kind === kind);
      if (!items.length) continue;
      const section = el('details', { className: 'vcs-change-group', attrs: { open: '' } },
        el('summary', { text: `${label}（${items.length}）` }));
      const list = el('div', { className: 'vcs-change-list' });
      for (const item of items.slice(0, 60)) list.append(el('div', { className: 'vcs-change-row', text: item.text }));
      if (items.length > 60) list.append(el('p', { className: 'vcs-muted', text: t('version-control.s620e67d', { p0: items.length - 60 }) }));
      section.append(list);
      host.append(section);
    }
    if (diff.detailsTruncated) host.append(el('p', { className: 'vcs-muted', text: t('version-control.s2cf9884') }));
    if (!diff.details?.length) {
      const samples = [
        [t('version-control.s2626236'), diff.notes.samples.added], [t('version-control.s4c896a7'), diff.notes.samples.removed], [t('version-control.sdd6a14d'), diff.notes.samples.modified],
        [t('version-control.s377a603'), diff.events.samples.added], [t('version-control.sf10087a'), diff.events.samples.removed], [t('version-control.se841153'), diff.events.samples.modified],
        [t('version-control.sf931048'), diff.lines.samples]
      ].filter(([, values]) => values?.length);
      if (samples.length) {
        const list = el('div', { className: 'vcs-samples' });
        for (const [label, values] of samples) {
          list.append(el('div', { className: 'vcs-sample-row' }, el('strong', { text: label }), el('span', { text: values.join('；') })));
        }
        host.append(list);
      }
    }
    return host;
  }

  renderChangesTab() {
    const state = this.state;
    const pane = el('div', { className: 'vcs-pane' });
    const status = el('div', { className: 'vcs-status-card' });
    status.append(el('strong', { text: state.clean ? t('version-control.sb7b0136') : t('version-control.s96b99cc') }));
    status.append(el('span', { text: t('version-control.sa0f6c4d', { p0: state.staged.total, p1: state.unstaged.total }) }));
    pane.append(status);
    const actions = el('div', { className: 'vcs-action-grid' });
    actions.append(
      button(t('version-control.sa363b33'), () => this.stageAll()),
      button(t('version-control.s807956f'), () => this.unstageAll()),
      button(t('version-control.s731b057'), () => this.discardUnstaged()),
      button(t('version-control.s38108ea'), () => this.refresh().catch(error => this.report(error)))
    );
    pane.append(actions);
    const staged = el('details', { className: 'vcs-changes-group', attrs: { open: '' } }, el('summary', { text: t('version-control.s15bbe71', { p0: state.staged.total }) }), this.renderTreeDiff(state.staged));
    const unstaged = el('details', { className: 'vcs-changes-group', attrs: { open: '' } }, el('summary', { text: t('version-control.sa3a5a47', { p0: state.unstaged.total }) }), this.renderTreeDiff(state.unstaged));
    pane.append(staged, unstaged);
    if (this.workingDiff) {
      pane.append(el('h4', { text: t('version-control.s5ab703a') }));
      pane.append(this.renderChartDiff(this.workingDiff.chartDiff));
    }
    const form = el('div', { className: 'vcs-commit-form' });
    form.append(el('h4', { text: t('version-control.s09cbc97') }));
    const message = el('textarea', { placeholder: t('version-control.scaac0a5'), value: this.messageDraft, attrs: { rows: '3', 'aria-label': t('version-control.sbb7aedd') } });
    message.value = this.messageDraft;
    message.addEventListener('input', () => { this.messageDraft = message.value; });
    form.append(message);
    const author = this.authorDraft ?? { name: t('version-control.sea431f3'), email: 'local@rpe-next' };
    const name = el('input', { value: author.name, attrs: { 'aria-label': t('version-control.sc6d5de9'), placeholder: t('version-control.sc6d5de9') } });
    const email = el('input', { value: author.email, attrs: { 'aria-label': t('version-control.s0dec6cf'), placeholder: t('version-control.s0dec6cf') } });
    name.addEventListener('input', () => { this.authorDraft = { ...(this.authorDraft ?? author), name: name.value }; });
    email.addEventListener('input', () => { this.authorDraft = { ...(this.authorDraft ?? author), email: email.value }; });
    form.append(el('div', { className: 'vcs-field' }, el('label', { text: t('version-control.s1be7ae4') }), name));
    form.append(el('div', { className: 'vcs-field' }, el('label', { text: t('version-control.s9ed627b') }), email));
    const amend = el('input', { type: 'checkbox' });
    amend.checked = this.amendDraft;
    amend.addEventListener('change', () => { this.amendDraft = amend.checked; });
    form.append(el('label', { className: 'vcs-check' }, amend, t('version-control.sf8dd07e')));
    const commitButton = button(t('version-control.s3738acc'), () => this.commitStaged(), { className: 'primary' });
    commitButton.disabled = state.staged.total === 0 && !this.amendDraft;
    form.append(commitButton);
    form.append(el('p', { className: 'vcs-muted', text: t('version-control.s36a1e5c') }));
    pane.append(form);
    return pane;
  }

  renderBranchesTab() {
    const repo = this.repoState;
    const pane = el('div', { className: 'vcs-pane' });
    pane.append(el('h4', { text: t('version-control.s2f6f9d5') }));
    const list = el('div', { className: 'vcs-ref-list' });
    for (const [name, id] of Object.entries(repo.branches ?? {})) {
      const current = repo.head?.type === 'branch' && repo.head.name === name;
      const row = el('div', { className: `vcs-ref-row${current ? ' current' : ''}` });
      row.append(el('div', { className: 'vcs-ref-name' }, el('strong', { text: name }), current ? el('span', { className: 'vcs-badge current', text: t('version-control.s25e74dc') }) : null, el('small', { text: id ? shortId(id) : t('version-control.s6e30f53') })));
      const actions = el('div', { className: 'vcs-ref-actions' });
      if (!current) actions.append(button(t('version-control.s94032a1'), () => this.checkoutBranch(name)));
      actions.append(button(t('version-control.s1cd80fd'), () => this.renameBranch(name)));
      if (!current) actions.append(button(t('version-control.s3755f56'), () => this.deleteBranch(name)));
      row.append(actions);
      list.append(row);
    }
    pane.append(list);
    const create = el('div', { className: 'vcs-inline-form' });
    const branchName = el('input', { value: this.branchDraft, placeholder: t('version-control.s99f2353'), attrs: { 'aria-label': t('version-control.s99f2353') } });
    branchName.addEventListener('input', () => { this.branchDraft = branchName.value; });
    create.append(branchName, button(t('version-control.sfed4b9f'), () => this.createBranchFromDraft()));
    pane.append(create);

    pane.append(el('h4', { text: t('version-control.se5badf9') }));
    const targets = [
      ...Object.entries(repo.branches ?? {}).filter(([name, id]) => id && !(repo.head?.type === 'branch' && repo.head.name === name)).map(([name]) => name),
      ...Object.entries(repo.tags ?? {}).filter(([, tag]) => typeof tag === 'string' ? tag : tag?.commit).map(([name]) => name)
    ];
    if (targets.length) {
      const select = el('select', { attrs: { 'aria-label': t('version-control.s1872ab3') } });
      for (const name of targets) select.append(new Option(name, name));
      select.value = this.mergeTarget && targets.includes(this.mergeTarget) ? this.mergeTarget : targets[0];
      this.mergeTarget = select.value;
      select.addEventListener('change', () => { this.mergeTarget = select.value; });
      pane.append(el('div', { className: 'vcs-inline-form' }, select, button(t('version-control.s2eaad5f'), () => this.mergeRef(this.mergeTarget))));
    } else pane.append(el('p', { className: 'vcs-muted', text: t('version-control.sd11df0c') }));

    pane.append(el('h4', { text: t('version-control.sae0a7af') }));
    const tags = el('div', { className: 'vcs-ref-list' });
    const entries = Object.entries(repo.tags ?? {});
    if (!entries.length) tags.append(el('p', { className: 'vcs-muted', text: t('version-control.s7d0d251') }));
    for (const [name, tag] of entries) {
      const id = typeof tag === 'string' ? tag : tag?.commit;
      const row = el('div', { className: 'vcs-ref-row' }, el('div', { className: 'vcs-ref-name' }, el('strong', { text: `#${name}` }), el('small', { text: shortId(id) })));
      row.append(el('div', { className: 'vcs-ref-actions' }, button(t('version-control.s3755f56'), () => this.deleteTag(name))));
      tags.append(row);
    }
    pane.append(tags);
    const tagForm = el('div', { className: 'vcs-inline-form' });
    const tagName = el('input', { value: this.tagDraft, placeholder: t('version-control.sb4240a6'), attrs: { 'aria-label': t('version-control.sb4240a6') } });
    tagName.addEventListener('input', () => { this.tagDraft = tagName.value; });
    tagForm.append(tagName, button(t('version-control.s15d2e4a'), () => this.createTagFromDraft()));
    pane.append(tagForm);
    return pane;
  }

  renderStashTab() {
    const repo = this.repoState;
    const pane = el('div', { className: 'vcs-pane' });
    pane.append(el('h4', { text: t('version-control.s9df47fb') }));
    pane.append(el('p', { className: 'vcs-muted', text: t('version-control.s24b3959') }));
    const form = el('div', { className: 'vcs-inline-form' });
    const message = el('input', { value: this.stashDraft, placeholder: t('version-control.se5238cb'), attrs: { 'aria-label': t('version-control.s4147093') } });
    message.addEventListener('input', () => { this.stashDraft = message.value; });
    form.append(message, button(t('version-control.s67eee2e'), () => this.stashPush()));
    pane.append(form);
    const list = el('div', { className: 'vcs-ref-list' });
    if (!repo.stash?.length) list.append(el('p', { className: 'vcs-muted', text: t('version-control.s68a0840') }));
    for (const [index, entry] of (repo.stash ?? []).entries()) {
      const row = el('div', { className: 'vcs-stash-row' });
      row.append(el('div', { className: 'vcs-stash-main' }, el('strong', { text: entry.message }), el('small', { text: `${formatDate(entry.timestamp)}${entry.branch ? ` · ${entry.branch}` : ''}` })));
      row.append(el('div', { className: 'vcs-ref-actions' },
        button(t('version-control.s4562024'), () => this.stashApply(index)), button(t('version-control.seb98ee2'), () => this.stashPop(index)), button(t('version-control.s3755f56'), () => this.stashDrop(index))));
      list.append(row);
    }
    pane.append(list);
    return pane;
  }

  renderReflogTab() {
    const repo = this.repoState;
    const pane = el('div', { className: 'vcs-pane' });
    pane.append(el('h4', { text: t('version-control.s9c98280') }));
    const list = el('div', { className: 'vcs-ref-list' });
    if (!repo.reflog?.length) list.append(el('p', { className: 'vcs-muted', text: t('version-control.s2191e80') }));
    for (const entry of repo.reflog ?? []) {
      const row = el('div', { className: 'vcs-reflog-row' });
      row.append(el('div', { className: 'vcs-reflog-main' }, el('strong', { text: entry.message }), el('small', { text: `${formatDate(entry.timestamp)} · ${shortId(entry.from) || '∅'} → ${shortId(entry.to) || '∅'}` })));
      if (entry.to) row.append(button(t('version-control.s94032a1'), () => this.checkoutCommit(entry.to)));
      list.append(row);
    }
    pane.append(list);
    pane.append(el('h4', { text: t('version-control.s10622ec') }));
    const tools = el('div', { className: 'vcs-action-grid' });
    tools.append(
      button(t('version-control.s8d80334'), () => this.exportBundle()),
      button(t('version-control.sbe4437f'), () => this.fileInput.click()),
      button(t('version-control.sf0088a5'), () => this.gc()),
      button(t('version-control.sca2bd90'), () => this.exportCurrentChart())
    );
    pane.append(tools);
    return pane;
  }

  renderMergeState() {
    const merge = this.repoState.merge;
    const pane = el('div', { className: 'vcs-pane' });
    const label = merge.kind === 'cherry-pick' ? t('version-control.sdb82ac7') : merge.kind === 'revert' ? t('version-control.sdedece7') : t('version-control.se5badf9');
    pane.append(el('h4', { text: t('version-control.sedddb50', { p0: label }) }));
    if (merge.targetRef) pane.append(el('p', { className: 'vcs-muted', text: t('version-control.se55fd1e', { p0: merge.targetRef, p1: merge.message ?? '' }) }));
    pane.append(el('p', { className: 'vcs-muted', text: t('version-control.sc5ec9f2', { p0: merge.conflicts.length }) }));
    const list = el('div', { className: 'vcs-conflicts' });
    merge.conflicts.forEach((conflict, index) => {
      const choice = this.mergeChoices.get(index) ?? 'ours';
      const row = el('div', { className: 'vcs-conflict' });
      row.append(el('strong', { text: conflict.path }));
      const options = el('div', { className: 'vcs-conflict-options' });
      for (const [value, label] of [['ours', t('version-control.s25e74dc')], ['theirs', t('version-control.s51c29d6')]]) {
        const input = el('input', { type: 'radio', attrs: { name: `vcs-conflict-${index}`, value } });
        input.checked = choice === value;
        input.addEventListener('change', () => { if (input.checked) this.mergeChoices.set(index, value); });
        options.append(el('label', { className: 'vcs-check' }, input, label));
      }
      row.append(options);
      row.append(el('div', { className: 'vcs-conflict-values' },
        el('span', {}, el('strong', { text: t('version-control.s23ef9f0') }), conflict.oursPresent === false ? t('version-control.sbecd43c') : conflict.kind === 'asset' ? assetLabel(conflict.ours) : jsonPreview(conflict.ours)),
        el('span', {}, el('strong', { text: t('version-control.scf1a9fc') }), conflict.theirsPresent === false ? t('version-control.sbecd43c') : conflict.kind === 'asset' ? assetLabel(conflict.theirs) : jsonPreview(conflict.theirs))));
      list.append(row);
    });
    pane.append(list);
    pane.append(el('div', { className: 'vcs-action-grid' },
      button(t('version-control.s31244a0'), () => this.resolveMerge(), { className: 'primary' }),
      button(t('version-control.sda6d8a5'), () => this.abortMerge())));
    return pane;
  }

  async stageAll() {
    await this.run(async () => {
      await this.repo.stage(this.snapshot());
      this.notify(t('version-control.s5ba9508'));
      await this.refresh();
    });
  }

  async unstageAll() {
    await this.run(async () => {
      await this.repo.unstage();
      this.notify(t('version-control.sc3b7971'));
      await this.refresh();
    });
  }

  async commitStaged() {
    await this.run(async () => {
      const message = this.messageDraft.trim();
      if (!message) throw new Error(t('version-control.sd1c665f'));
      const author = {
        name: this.authorDraft?.name?.trim() || t('version-control.sea431f3'),
        email: this.authorDraft?.email?.trim() || 'local@rpe-next'
      };
      const repo = await this.repo.read();
      repo.config = { ...(repo.config ?? {}), author };
      await this.repo.save(repo);
      const result = await this.repo.commit({ message, author, amend: this.amendDraft });
      this.messageDraft = '';
      this.amendDraft = false;
      this.selectedCommit = result.commit.id;
      this.tab = 'graph';
      this.notify(t('version-control.saa15685', { p0: shortId(result.commit.id) }));
      await this.refresh();
    });
  }

  async discardUnstaged() {
    if (!await this.confirm(t('version-control.s731b057'), t('version-control.sbac7e48'))) return;
    await this.run(async () => {
      const tree = this.state?.indexTree?.id ?? this.state?.headTree?.id;
      if (!tree) throw new Error(t('version-control.s2382e5e'));
      const result = await this.repo.restore(tree);
      await this.afterSnapshot(result, true);
      this.notify(t('version-control.s709b36a'));
    });
  }

  async checkoutCommit(id) {
    if (!await this.confirmEditorDiscard()) return;
    await this.run(async () => {
      try {
        const result = await this.repo.checkoutCommit(id, { snapshot: this.snapshot() });
        await this.afterSnapshot(result, true);
        this.notify(t('version-control.s1d126e4', { p0: shortId(id) }));
      } catch (error) {
        if (error.code !== 'DIRTY_WORKING_TREE') throw error;
        if (!await this.confirm(t('version-control.s87615b5'), t('version-control.s6a3de37'))) return;
        const result = await this.repo.checkoutCommit(id, { snapshot: this.snapshot(), force: true });
        await this.afterSnapshot(result, true);
        this.notify(t('version-control.s1d126e4', { p0: shortId(id) }));
      }
    });
  }

  async checkoutBranch(name) {
    if (!await this.confirmEditorDiscard()) return;
    await this.run(async () => {
      try {
        const result = await this.repo.checkoutBranch(name, { snapshot: this.snapshot() });
        await this.afterSnapshot(result, true);
        this.notify(t('version-control.s6a584d6', { p0: name }));
      } catch (error) {
        if (error.code !== 'DIRTY_WORKING_TREE') throw error;
        if (!await this.confirm(t('version-control.s87615b5'), t('version-control.s113594b'))) return;
        const result = await this.repo.checkoutBranch(name, { snapshot: this.snapshot(), force: true });
        await this.afterSnapshot(result, true);
        this.notify(t('version-control.s6a584d6', { p0: name }));
      }
    });
  }

  async confirmEditorDiscard() {
    if (!this.context.isDirty?.()) return true;
    return this.confirm(t('version-control.sef027f6'), t('version-control.sc648395'));
  }

  async createBranchAt(commitId) {
    const name = await this.askText(t('version-control.s65a957f'), t('version-control.s525e122', { p0: commitId ? shortId(commitId) : t('version-control.s345fd87') }), t('version-control.s01571fe'), this.branchDraft);
    if (!name) return;
    await this.run(async () => {
      await this.repo.createBranch(name, commitId ?? null);
      this.branchDraft = '';
      this.notify(t('version-control.s98bf490', { p0: name }));
      await this.refresh();
    });
  }

  async createBranchFromDraft() {
    const name = this.branchDraft.trim();
    if (!name) { this.notify(t('version-control.se1907bc'), 'warning'); return; }
    await this.run(async () => {
      await this.repo.createBranch(name, this.state?.headId ?? null);
      this.branchDraft = '';
      this.notify(t('version-control.s98bf490', { p0: name }));
      await this.refresh();
    });
  }

  async renameBranch(name) {
    const next = await this.askText(t('version-control.sd63a46e'), t('version-control.sadb6c02', { p0: name }), t('version-control.sb865985'), name);
    if (!next || next === name) return;
    await this.run(async () => {
      await this.repo.renameBranch(name, next);
      this.notify(t('version-control.sd9046b4', { p0: next }));
      await this.refresh();
    });
  }

  async deleteBranch(name) {
    if (!await this.confirm(t('version-control.s6203f59'), t('version-control.s077bad0', { p0: name }))) return;
    await this.run(async () => {
      await this.repo.deleteBranch(name);
      this.notify(t('version-control.sf750b43', { p0: name }));
      await this.refresh();
    });
  }

  async createTagAt(commitId) {
    const name = await this.askText(t('version-control.s616054b'), t('version-control.s944d278', { p0: commitId ? shortId(commitId) : t('version-control.s345fd87') }), t('version-control.s182295d'), this.tagDraft);
    if (!name) return;
    await this.run(async () => {
      await this.repo.createTag(name, commitId ?? null, '');
      this.tagDraft = '';
      this.notify(t('version-control.s87f0dd4', { p0: name }));
      await this.refresh();
    });
  }

  async createTagFromDraft() {
    const name = this.tagDraft.trim();
    if (!name) { this.notify(t('version-control.s8e1f344'), 'warning'); return; }
    await this.run(async () => {
      await this.repo.createTag(name, this.state?.headId ?? null, '');
      this.tagDraft = '';
      this.notify(t('version-control.s87f0dd4', { p0: name }));
      await this.refresh();
    });
  }

  async deleteTag(name) {
    if (!await this.confirm(t('version-control.sff6fe44'), t('version-control.s2bffa47', { p0: name }))) return;
    await this.run(async () => {
      await this.repo.deleteTag(name);
      this.notify(t('version-control.s549f984', { p0: name }));
      await this.refresh();
    });
  }

  async mergeRef(ref) {
    if (!ref || !await this.confirmEditorDiscard()) return;
    await this.run(async () => {
      const result = await this.repo.merge(ref, { snapshot: this.snapshot() });
      if (result.type === 'conflict') {
        this.tab = 'branches';
        this.notify(t('version-control.s42440eb', { p0: result.conflicts.length }), 'warning', 5000);
        await this.refresh();
        return;
      }
      if (result.type === 'up-to-date') { this.notify(t('version-control.s9287b27')); await this.refresh(); return; }
      await this.afterSnapshot(result, true);
      this.notify(result.type === 'fast-forward' ? t('version-control.s0d5816f') : t('version-control.s0912993', { p0: shortId(result.commit.id) }));
    });
  }

  async cherryPick(id) {
    if (!await this.confirmEditorDiscard()) return;
    await this.run(async () => {
      const result = await this.repo.cherryPick(id, { snapshot: this.snapshot() });
      if (result.type === 'conflict') { this.tab = 'branches'; this.notify(t('version-control.s4b0f8f0', { p0: result.conflicts.length }), 'warning', 5000); await this.refresh(); return; }
      await this.afterSnapshot(result, true);
      this.notify(t('version-control.s5fb8b67', { p0: shortId(id) }));
    });
  }

  async revert(id) {
    if (!await this.confirmEditorDiscard()) return;
    await this.run(async () => {
      const result = await this.repo.revert(id, { snapshot: this.snapshot() });
      if (result.type === 'conflict') { this.tab = 'branches'; this.notify(t('version-control.s121dc56', { p0: result.conflicts.length }), 'warning', 5000); await this.refresh(); return; }
      await this.afterSnapshot(result, true);
      this.notify(t('version-control.sa3b88d8', { p0: shortId(result.commit.id) }));
    });
  }

  async resetTo(id) {
    const mode = await this.askSelect(t('version-control.sf212b14'), t('version-control.s5accac7', { p0: shortId(id) }), [['soft', t('version-control.se46e6fd')], ['mixed', t('version-control.s1dfc985')], ['hard', t('version-control.scee6e68')]], 'mixed');
    if (!mode) return;
    if (mode === 'hard' && !await this.confirmEditorDiscard()) return;
    await this.run(async () => {
      const result = await this.repo.reset(id, mode);
      if (result.snapshot) await this.afterSnapshot(result, true);
      else await this.refresh();
      this.notify(t('version-control.sa1ab9ac', { p0: mode === 'hard' ? t('version-control.s32709a5') : mode === 'soft' ? t('version-control.s6a8a308') : t('version-control.sa4a06e0'), p1: shortId(id) }));
    });
  }

  async resolveMerge() {
    if (!await this.confirmEditorDiscard()) return;
    await this.run(async () => {
      const merge = this.repoState.merge;
      const choices = merge.conflicts.map((_, index) => this.mergeChoices.get(index) ?? 'ours');
      const result = await this.repo.resolveMerge(choices);
      await this.afterSnapshot(result, true);
      this.notify(t('version-control.sdfff1e3', { p0: shortId(result.commit.id) }));
    });
  }

  async abortMerge() {
    if (!await this.confirm(t('version-control.sda6d8a5'), t('version-control.s479dbaf'))) return;
    if (!await this.confirmEditorDiscard()) return;
    await this.run(async () => {
      const result = await this.repo.abortMerge();
      await this.afterSnapshot(result, true);
      this.notify(t('version-control.s2637cd8'));
    });
  }

  async stashPush() {
    await this.run(async () => {
      const result = await this.repo.stashPush(this.snapshot(), this.stashDraft);
      this.stashDraft = '';
      await this.afterSnapshot(result, true);
      this.notify(t('version-control.seca2ea5'));
    });
  }

  async stashApply(index) {
    await this.run(async () => {
      try {
        const result = await this.repo.stashApply(index, this.snapshot());
        await this.afterSnapshot(result, true);
        this.notify(t('version-control.sf684e32'));
      } catch (error) {
        if (error.code !== 'STASH_CONFLICT') throw error;
        this.notify(error.message, 'error', 7000);
        this.error = error.conflicts.map(conflict => conflict.path).join('、');
        this.render();
      }
    });
  }

  async stashPop(index) {
    await this.run(async () => {
      try {
        const result = await this.repo.stashPop(index, this.snapshot());
        await this.afterSnapshot(result, true);
        this.notify(t('version-control.se325c5a'));
      } catch (error) {
        if (error.code !== 'STASH_CONFLICT') throw error;
        this.notify(error.message, 'error', 7000);
        this.error = error.conflicts.map(conflict => conflict.path).join('、');
        this.render();
      }
    });
  }

  async stashDrop(index) {
    if (!await this.confirm(t('version-control.s3b7ad48'), t('version-control.s133edec'))) return;
    await this.run(async () => {
      await this.repo.stashDrop(index);
      this.notify(t('version-control.sf87a968'));
      await this.refresh();
    });
  }

  async exportCommitChart(id) {
    await this.run(async () => {
      const snapshot = await this.repo.readSnapshot((await this.repo.readCommit(id)).tree);
      const stem = String(snapshot.chartName || 'chart.json').replace(/\.json$/i, '');
      const name = `${stem}-${shortId(id)}.json`;
      download(new Blob([serializeChart(snapshot.chart)], { type: 'application/json' }), name);
      this.notify(t('version-control.se2a3b30', { p0: name }));
    });
  }

  async exportCurrentChart() {
    const name = String(this.context.getChartName() || 'chart.json').replace(/[\\/:*?"<>|]/g, '_');
    download(new Blob([serializeChart(this.context.getChart())], { type: 'application/json' }), name);
    this.notify(t('version-control.se2a3b30', { p0: name }));
  }

  async exportBundle() {
    await this.run(async () => {
      const bundle = await this.repo.exportBundle();
      const name = `rpe-next-vcs-${new Date().toISOString().slice(0, 10)}.json`;
      download(new Blob([JSON.stringify(bundle)], { type: 'application/json' }), name);
      this.notify(t('version-control.s7d9144d', { p0: bundle.commits.length }));
    });
  }

  async importBundleFile() {
    const file = this.fileInput.files?.[0];
    if (!file) return;
    this.fileInput.value = '';
    await this.run(async () => {
      const bundle = JSON.parse(await file.text());
      const result = await this.repo.importBundle(bundle);
      this.notify(t('version-control.s1f92537', { p0: result.commits, p1: result.branches.length, p2: result.tags.length }));
      await this.refresh();
    });
  }

  async gc() {
    if (!await this.confirm(t('version-control.sf0088a5'), t('version-control.s1cc8def'))) return;
    await this.run(async () => {
      const result = await this.repo.gc();
      this.notify(t('version-control.sd773e3c', { p0: result.removedCommits, p1: result.removedTrees, p2: result.removedBlobs }));
      await this.refresh();
    });
  }

  async afterSnapshot(result, force) {
    if (result?.snapshot) await this.actions.loadSnapshot?.(result.snapshot, { force });
    await this.refresh();
  }

  confirm(title, description) {
    return new Promise(resolve => {
      showDialog(title, description);
      const modal = document.querySelector('#modal');
      const apply = document.querySelector('#modal-apply');
      let done = false;
      apply.hidden = false;
      apply.textContent = t('version-control.sb56d9ac');
      modal.addEventListener('close', () => { if (!done) { done = true; resolve(false); } }, { once: true });
      apply.onclick = () => { done = true; modal.close(); resolve(true); };
    });
  }

  askText(title, description, label, value = '') {
    return new Promise(resolve => {
      const content = showDialog(title, description);
      const input = el('input', { value, attrs: { 'aria-label': label } });
      content.append(el('label', { className: 'vcs-field' }, el('span', { text: label }), input));
      const modal = document.querySelector('#modal');
      const apply = document.querySelector('#modal-apply');
      let done = false;
      apply.hidden = false;
      apply.textContent = t('version-control.sf526c89');
      modal.addEventListener('close', () => { if (!done) { done = true; resolve(null); } }, { once: true });
      apply.onclick = () => { done = true; modal.close(); resolve(input.value.trim()); };
      input.focus();
      input.select();
    });
  }

  askSelect(title, description, options, value) {
    return new Promise(resolve => {
      const content = showDialog(title, description);
      const select = el('select', { attrs: { 'aria-label': title } });
      for (const [optionValue, label] of options) select.append(new Option(label, optionValue));
      select.value = value;
      content.append(select);
      const modal = document.querySelector('#modal');
      const apply = document.querySelector('#modal-apply');
      let done = false;
      apply.hidden = false;
      apply.textContent = t('version-control.sf526c89');
      modal.addEventListener('close', () => { if (!done) { done = true; resolve(null); } }, { once: true });
      apply.onclick = () => { done = true; modal.close(); resolve(select.value); };
    });
  }
}
