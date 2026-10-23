import { assertChart, createChart, parseChart, stringifyPreservingNumbers } from '../core/chart.mjs';
import {
  applyAssetResolutions, assertMergedLineParents, assertRefName, base64ToBytes, bytesToBase64,
  canonicalJson, cloneValue, decodeText, diffCharts, diffTrees, graphLayout, hasTreeChanges,
  hashBytes, mergeAssets, mergeCharts, mergeFolders, resolveChartMerge, sha256Hex, shortId, textBytes
} from '../core/chart-vcs.mjs';
import { t } from '../i18n.mjs';

export const VCS_FORMAT = 'rpe-next-chart-vcs';
export const VCS_VERSION = 1;
const DEFAULT_AUTHOR = { name: t('chart-vcs.sea431f3'), email: 'local@rpe-next' };
const MAX_REFLOG = 200;

const randomId = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const compareCommits = (left, right) => (right?.timestamp ?? 0) - (left?.timestamp ?? 0) || String(right?.id ?? '').localeCompare(String(left?.id ?? ''));
const comparePaths = (left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0;

function normalizeAuthor(author) {
  return {
    name: String(author?.name ?? DEFAULT_AUTHOR.name).trim() || DEFAULT_AUTHOR.name,
    email: String(author?.email ?? DEFAULT_AUTHOR.email).trim() || DEFAULT_AUTHOR.email
  };
}

async function assetBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value && typeof value.arrayBuffer === 'function') return new Uint8Array(await value.arrayBuffer());
  return new Uint8Array(value ?? []);
}

function dirtyWorkingTree(message = t('chart-vcs.sd0dd573')) {
  const error = new Error(message);
  error.code = 'DIRTY_WORKING_TREE';
  return error;
}

function equalBytes(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}

function setReference(collection, name, value) {
  Object.defineProperty(collection, name, { value, enumerable: true, configurable: true, writable: true });
}

export class ChartRepository {
  constructor(store, repoId, { now = () => Date.now() } = {}) {
    this.store = store;
    this.repoId = repoId;
    this.now = now;
    this.knownBlobs = new Set();
    this.emptyTreeId = null;
  }

  blank() {
    return {
      id: this.repoId, version: VCS_VERSION, createdAt: this.now(), updatedAt: this.now(),
      head: { type: 'branch', name: 'main' }, branches: { main: null }, tags: {},
      index: null, stash: [], reflog: [], merge: null,
      config: { author: { ...DEFAULT_AUTHOR } }
    };
  }

  async read() {
    const repo = await this.store.get('repos', this.repoId);
    if (!repo) return this.blank();
    repo.head ??= { type: 'branch', name: 'main' };
    repo.branches ??= { main: null };
    repo.tags ??= {};
    repo.stash ??= [];
    repo.reflog ??= [];
    repo.config ??= { author: { ...DEFAULT_AUTHOR } };
    return repo;
  }

  async save(repo) {
    repo.updatedAt = this.now();
    await this.store.put('repos', repo);
    return repo;
  }

  async init() {
    const existing = await this.store.get('repos', this.repoId);
    if (existing) return existing;
    const repo = this.blank();
    await this.save(repo);
    return repo;
  }

  async readCommit(id) {
    return id ? this.store.get('commits', id) : null;
  }

  async readTree(id) {
    return id ? this.store.get('trees', id) : null;
  }

  async readBlob(id) {
    return id ? this.store.get('blobs', id) : null;
  }

  resolveHead(repo) {
    if (repo?.head?.type === 'detached') return repo.head.commit ?? null;
    const name = repo?.head?.name;
    return repo?.branches && Object.hasOwn(repo.branches, name) ? repo.branches[name] ?? null : null;
  }

  async ensureBlobBytes(id, bytes) {
    if (this.knownBlobs.has(id)) return id;
    const existing = await this.store.get('blobs', id);
    if (!existing) await this.store.put('blobs', { id, bytes });
    this.knownBlobs.add(id);
    return id;
  }

  async ensureBlobText(text) {
    const bytes = textBytes(text);
    const id = await sha256Hex(bytes);
    return this.ensureBlobBytes(id, bytes);
  }

  async treeFromSnapshot(snapshot, { write = true } = {}) {
    const document = { ...snapshot.chart };
    delete document.chartTime;
    const chartText = stringifyPreservingNumbers(document);
    const chart = await sha256Hex(chartText);
    const assets = [];
    for (const [path, value] of snapshot.assets ?? []) {
      const bytes = await assetBytes(value);
      const blob = await hashBytes(bytes, value);
      if (write) await this.ensureBlobBytes(blob, bytes);
      assets.push({ path, blob, size: bytes.length });
    }
    assets.sort(comparePaths);
    const folders = [...(snapshot.folders ?? [])].sort();
    const chartName = snapshot.chartName || 'chart.json';
    const tree = { chart, assets, folders, chartName };
    tree.id = await sha256Hex(canonicalJson(tree));
    if (write) {
      await this.ensureBlobBytes(chart, textBytes(chartText));
      await this.store.put('trees', tree);
    }
    return tree;
  }

  async writeTreeFromParts({ chartText, assets = [], folders = [], chartName = 'chart.json' }) {
    const chart = await this.ensureBlobText(chartText);
    for (const entry of assets) {
      if (!(await this.store.get('blobs', entry.blob))) throw new Error(t('chart-vcs.s08efcd5', { p0: entry.path }));
    }
    const tree = { chart, assets: [...assets].sort(comparePaths), folders: [...folders].sort(), chartName: chartName || 'chart.json' };
    tree.id = await sha256Hex(canonicalJson(tree));
    await this.store.put('trees', tree);
    return tree.id;
  }

  async emptyTree() {
    if (this.emptyTreeId) return this.emptyTreeId;
    const chart = createChart();
    this.emptyTreeId = await this.writeTreeFromParts({ chartText: stringifyPreservingNumbers(chart), assets: [], folders: [], chartName: 'chart.json' });
    return this.emptyTreeId;
  }

  async readChart(tree) {
    if (!tree) return createChart();
    const blob = await this.readBlob(tree.chart);
    if (!blob) throw new Error(t('chart-vcs.sffc33b6'));
    return parseChart(decodeText(blob.bytes));
  }

  async readSnapshot(treeId) {
    const tree = await this.readTree(treeId);
    if (!tree) return null;
    const chart = await this.readChart(tree);
    const assets = new Map();
    for (const entry of tree.assets ?? []) {
      const blob = await this.readBlob(entry.blob);
      if (!blob) throw new Error(t('chart-vcs.s0140b97', { p0: entry.path }));
      assets.set(entry.path, blob.bytes);
    }
    return { chart, assets, folders: new Set(tree.folders ?? []), chartName: tree.chartName || 'chart.json', treeId };
  }

  async status(snapshot) {
    const repo = await this.read();
    const headId = this.resolveHead(repo);
    const head = await this.readCommit(headId);
    const headTree = head ? await this.readTree(head.tree) : null;
    const indexTree = repo.index ? await this.readTree(repo.index) : headTree;
    const workingTree = snapshot ? await this.treeFromSnapshot(snapshot, { write: false }) : null;
    const staged = diffTrees(headTree, indexTree);
    const unstaged = workingTree ? diffTrees(indexTree, workingTree) : { total: 0, chartChanged: false, added: [], modified: [], deleted: [], foldersChanged: false, chartNameChanged: false };
    return {
      repo, headId, head, headTree, indexTree, workingTree, staged, unstaged,
      branch: repo.head?.type === 'branch' ? repo.head.name : null,
      detached: repo.head?.type === 'detached',
      clean: !hasTreeChanges(staged) && !hasTreeChanges(unstaged)
    };
  }

  async stage(snapshot) {
    const repo = await this.read();
    const tree = await this.treeFromSnapshot(snapshot, { write: true });
    repo.index = tree.id;
    await this.save(repo);
    return tree.id;
  }

  async unstage() {
    const repo = await this.read();
    const head = await this.readCommit(this.resolveHead(repo));
    repo.index = head?.tree ?? null;
    await this.save(repo);
    return repo.index;
  }

  updateHead(repo, commitId) {
    if (repo.head?.type === 'detached') repo.head = { type: 'detached', commit: commitId };
    else {
      const name = repo.head?.name || 'main';
      setReference(repo.branches, name, commitId);
      repo.head = { type: 'branch', name };
    }
  }

  pushReflog(repo, message, from, to) {
    repo.reflog.unshift({ id: randomId(), timestamp: this.now(), message, from: from ?? null, to: to ?? null });
    if (repo.reflog.length > MAX_REFLOG) repo.reflog.length = MAX_REFLOG;
  }

  async createCommit(repo, { tree, parents, author, message, kind = 'commit' }) {
    const payload = {
      repoId: this.repoId, tree, parents: parents ?? [], author: normalizeAuthor(author ?? repo.config?.author),
      timestamp: this.now(), message: String(message ?? '').trim() || t('chart-vcs.s09cbc97'), kind
    };
    const id = await sha256Hex(canonicalJson(payload));
    const commit = { id, ...payload };
    if (!(await this.store.get('commits', id))) await this.store.put('commits', commit);
    return commit;
  }

  async commit({ message, author, amend = false, allowEmpty = false }) {
    const repo = await this.read();
    const headId = this.resolveHead(repo);
    const head = await this.readCommit(headId);
    const indexId = repo.index ?? head?.tree ?? null;
    if (!indexId) throw new Error(t('chart-vcs.s8099edc'));
    if (head && indexId === head.tree && !amend && !allowEmpty) throw new Error(t('chart-vcs.s34138af'));
    const parents = amend && head ? head.parents ?? [] : headId ? [headId] : [];
    const commit = await this.createCommit(repo, { tree: indexId, parents, author, message });
    this.updateHead(repo, commit.id);
    repo.index = indexId;
    repo.merge = null;
    this.pushReflog(repo, t('chart-vcs.s96acb4b', { p0: commit.message }), headId, commit.id);
    await this.save(repo);
    return { commit, repo, snapshot: await this.readSnapshot(indexId) };
  }

  async log({ currentOnly = false, includeDangling = false } = {}) {
    const repo = await this.read();
    let commits = await this.store.listCommits(this.repoId);
    if (currentOnly) {
      const reachable = await this.ancestors(this.resolveHead(repo));
      commits = commits.filter(commit => reachable.has(commit.id));
    } else if (!includeDangling) {
      const reachable = new Set();
      const starts = [
        ...Object.values(repo.branches ?? {}),
        ...Object.values(repo.tags ?? {}).map(tag => typeof tag === 'string' ? tag : tag?.commit),
        repo.head?.type === 'detached' ? repo.head.commit : null
      ];
      for (const id of starts) for (const ancestor of await this.ancestors(id)) reachable.add(ancestor);
      commits = commits.filter(commit => reachable.has(commit.id));
    }
    return commits.sort(compareCommits);
  }

  refs(repo) {
    return { branches: repo.branches ?? {}, tags: repo.tags ?? {}, head: repo.head };
  }

  graph(commits, repo) {
    return graphLayout(commits, this.refs(repo));
  }

  async createBranch(name, at = null) {
    const branch = assertRefName(name, t('chart-vcs.s2f6f9d5'));
    const repo = await this.read();
    if (Object.hasOwn(repo.branches, branch)) throw new Error(t('chart-vcs.s2c0f73a', { p0: branch }));
    setReference(repo.branches, branch, at ?? this.resolveHead(repo));
    await this.save(repo);
    return repo;
  }

  async deleteBranch(name) {
    const repo = await this.read();
    if (repo.head?.type === 'branch' && repo.head.name === name) throw new Error(t('chart-vcs.s617c3a6'));
    if (!Object.hasOwn(repo.branches, name)) throw new Error(t('chart-vcs.sb170069'));
    delete repo.branches[name];
    await this.save(repo);
    return repo;
  }

  async renameBranch(name, next) {
    const target = assertRefName(next, t('chart-vcs.s2f6f9d5'));
    const repo = await this.read();
    if (!Object.hasOwn(repo.branches, name)) throw new Error(t('chart-vcs.sb170069'));
    if (name !== target && Object.hasOwn(repo.branches, target)) throw new Error(t('chart-vcs.s8ac0d06', { p0: target }));
    setReference(repo.branches, target, repo.branches[name]);
    if (name !== target) delete repo.branches[name];
    if (repo.head?.type === 'branch' && repo.head.name === name) repo.head.name = target;
    await this.save(repo);
    return repo;
  }

  async requireClean(snapshot, force = false) {
    if (!snapshot || force) return;
    const status = await this.status(snapshot);
    if (!status.clean) throw dirtyWorkingTree();
  }

  async checkoutBranch(name, { snapshot, force = false } = {}) {
    const repo = await this.read();
    if (!Object.hasOwn(repo.branches, name)) throw new Error(t('chart-vcs.sb170069'));
    await this.requireClean(snapshot, force);
    const target = repo.branches[name];
    const targetCommit = target ? await this.readCommit(target) : null;
    const previous = this.resolveHead(repo);
    repo.head = { type: 'branch', name };
    repo.index = targetCommit?.tree ?? null;
    this.pushReflog(repo, t('chart-vcs.sbc4184c', { p0: name }), previous, target ?? null);
    await this.save(repo);
    return { repo, snapshot: targetCommit ? await this.readSnapshot(targetCommit.tree) : null };
  }

  async checkoutCommit(commitId, { snapshot, force = false } = {}) {
    const repo = await this.read();
    const commit = await this.readCommit(commitId);
    if (!commit) throw new Error(t('chart-vcs.sc2059bf'));
    await this.requireClean(snapshot, force);
    const previous = this.resolveHead(repo);
    repo.head = { type: 'detached', commit: commitId };
    repo.index = commit.tree;
    this.pushReflog(repo, t('chart-vcs.s77eef15', { p0: shortId(commitId) }), previous, commitId);
    await this.save(repo);
    return { repo, snapshot: await this.readSnapshot(commit.tree) };
  }

  async restore(treeId) {
    const repo = await this.read();
    const snapshot = await this.readSnapshot(treeId);
    if (!snapshot) throw new Error(t('chart-vcs.s3131910'));
    repo.index = treeId;
    await this.save(repo);
    return { repo, snapshot };
  }

  async ancestors(commitId) {
    const result = new Set();
    if (!commitId) return result;
    const queue = [commitId];
    while (queue.length) {
      const id = queue.shift();
      if (result.has(id)) continue;
      result.add(id);
      const commit = await this.readCommit(id);
      for (const parent of commit?.parents ?? []) if (!result.has(parent)) queue.push(parent);
    }
    return result;
  }

  async distances(commitId) {
    const result = new Map();
    if (!commitId) return result;
    const queue = [[commitId, 0]];
    while (queue.length) {
      const [id, distance] = queue.shift();
      if (result.has(id)) continue;
      result.set(id, distance);
      const commit = await this.readCommit(id);
      for (const parent of commit?.parents ?? []) if (!result.has(parent)) queue.push([parent, distance + 1]);
    }
    return result;
  }

  async isAncestor(ancestor, descendant) {
    if (!ancestor || !descendant) return false;
    return (await this.ancestors(descendant)).has(ancestor);
  }

  async mergeBase(left, right) {
    const [leftDistances, rightDistances] = await Promise.all([this.distances(left), this.distances(right)]);
    let best = null, bestScore = Infinity;
    for (const [id, distance] of leftDistances) {
      if (!rightDistances.has(id)) continue;
      const score = Math.max(distance, rightDistances.get(id));
      const commit = await this.readCommit(id);
      if (score < bestScore || (score === bestScore && (commit?.timestamp ?? 0) > (best?.timestamp ?? 0))) {
        best = commit; bestScore = score;
      }
    }
    return best;
  }

  async resolveRef(repo, ref) {
    const value = String(ref ?? '').trim();
    if (value === 'HEAD') return this.resolveHead(repo);
    if (Object.hasOwn(repo.branches, value)) return repo.branches[value];
    if (Object.hasOwn(repo.tags, value)) return repo.tags[value]?.commit ?? repo.tags[value] ?? null;
    if (await this.readCommit(value)) return value;
    const commits = await this.store.listCommits(this.repoId);
    const matches = commits.filter(commit => commit.id.startsWith(value));
    if (matches.length === 1) return matches[0].id;
    throw new Error(t('chart-vcs.s343f897', { p0: value }));
  }

  async mergeTrees({ baseTreeId, oursTreeId, theirsTreeId, parents, kind, targetRef, message }) {
    const repo = await this.read();
    const [baseTree, oursTree, theirsTree] = await Promise.all([
      this.readTree(baseTreeId), this.readTree(oursTreeId), this.readTree(theirsTreeId)
    ]);
    if (!oursTree || !theirsTree) throw new Error(t('chart-vcs.sd03e73d'));
    const [baseChart, oursChart, theirsChart] = await Promise.all([
      this.readChart(baseTree), this.readChart(oursTree), this.readChart(theirsTree)
    ]);
    const chartMerge = mergeCharts(baseChart, oursChart, theirsChart);
    const assetMerge = mergeAssets(baseTree?.assets ?? [], oursTree.assets ?? [], theirsTree.assets ?? []);
    const conflicts = [...chartMerge.conflicts, ...assetMerge.conflicts];
    if (conflicts.length) {
      repo.merge = {
        kind, baseTree: baseTreeId, oursTree: oursTreeId, theirsTree: theirsTreeId,
        parents: [...parents], targetRef, message, conflicts, oursCommit: parents[0] ?? null,
        createdAt: this.now()
      };
      await this.save(repo);
      return { type: 'conflict', conflicts, repo };
    }
    const folders = mergeFolders(baseTree?.folders ?? [], oursTree.folders ?? [], theirsTree.folders ?? []);
    assertChart(chartMerge.chart); assertMergedLineParents(chartMerge.chart);
    const treeId = await this.writeTreeFromParts({
      chartText: stringifyPreservingNumbers(chartMerge.chart), assets: assetMerge.assets, folders,
      chartName: oursTree.chartName || theirsTree.chartName || 'chart.json'
    });
    const commit = await this.createCommit(repo, { tree: treeId, parents, author: repo.config?.author, message, kind });
    this.updateHead(repo, commit.id);
    repo.index = treeId;
    repo.merge = null;
    this.pushReflog(repo, message, parents[0] ?? null, commit.id);
    await this.save(repo);
    return { type: kind, commit, snapshot: await this.readSnapshot(treeId) };
  }

  async merge(ref, { snapshot } = {}) {
    const repo = await this.read();
    const targetId = await this.resolveRef(repo, ref);
    const target = await this.readCommit(targetId);
    if (!target) throw new Error(t('chart-vcs.s35cb0e2'));
    const headId = this.resolveHead(repo);
    const head = await this.readCommit(headId);
    if (!head) throw new Error(t('chart-vcs.s6b04f3f'));
    await this.requireClean(snapshot);
    if (targetId === headId || await this.isAncestor(targetId, headId)) return { type: 'up-to-date', repo };
    if (await this.isAncestor(headId, targetId)) {
      this.updateHead(repo, targetId);
      repo.index = target.tree;
      repo.merge = null;
      this.pushReflog(repo, t('chart-vcs.s8a64e96', { p0: ref }), headId, targetId);
      await this.save(repo);
      return { type: 'fast-forward', commit: target, snapshot: await this.readSnapshot(target.tree) };
    }
    const base = await this.mergeBase(headId, targetId);
    if (!base) throw new Error(t('chart-vcs.s73db723'));
    return this.mergeTrees({
      baseTreeId: base.tree, oursTreeId: head.tree, theirsTreeId: target.tree,
      parents: [head.id, target.id], kind: 'merge', targetRef: ref,
      message: t('chart-vcs.s5c742b0', { p0: ref, p1: repo.head?.type === 'branch' ? repo.head.name : shortId(head.id) })
    });
  }

  async cherryPick(commitId, { snapshot } = {}) {
    const repo = await this.read();
    const target = await this.readCommit(commitId);
    if (!target) throw new Error(t('chart-vcs.sc2059bf'));
    const headId = this.resolveHead(repo);
    const head = await this.readCommit(headId);
    if (!head) throw new Error(t('chart-vcs.s6b04f3f'));
    await this.requireClean(snapshot);
    const baseTreeId = target.parents?.[0] ? (await this.readCommit(target.parents[0]))?.tree ?? await this.emptyTree() : await this.emptyTree();
    return this.mergeTrees({
      baseTreeId, oursTreeId: head.tree, theirsTreeId: target.tree,
      parents: [head.id], kind: 'cherry-pick', targetRef: shortId(commitId),
      message: t('chart-vcs.s5bd7115', { p0: shortId(commitId), p1: target.message })
    });
  }

  async revert(commitId, { snapshot } = {}) {
    const repo = await this.read();
    const target = await this.readCommit(commitId);
    if (!target) throw new Error(t('chart-vcs.sc2059bf'));
    const headId = this.resolveHead(repo);
    const head = await this.readCommit(headId);
    if (!head) throw new Error(t('chart-vcs.s6b04f3f'));
    await this.requireClean(snapshot);
    const parent = target.parents?.[0] ? await this.readCommit(target.parents[0]) : null;
    return this.mergeTrees({
      baseTreeId: target.tree, oursTreeId: head.tree,
      theirsTreeId: parent?.tree ?? await this.emptyTree(),
      parents: [head.id], kind: 'revert', targetRef: shortId(commitId),
      message: t('chart-vcs.sbf71a57', { p0: shortId(commitId), p1: target.message })
    });
  }

  async resolveMerge(choices) {
    const repo = await this.read();
    const state = repo.merge;
    if (!state) throw new Error(t('chart-vcs.sa66770e'));
    const [baseTree, oursTree, theirsTree] = await Promise.all([
      this.readTree(state.baseTree), this.readTree(state.oursTree), this.readTree(state.theirsTree)
    ]);
    if (!oursTree || !theirsTree) throw new Error(t('chart-vcs.s87951d5'));
    const [baseChart, oursChart, theirsChart] = await Promise.all([
      this.readChart(baseTree), this.readChart(oursTree), this.readChart(theirsTree)
    ]);
    const assetMerge = mergeAssets(baseTree?.assets ?? [], oursTree.assets ?? [], theirsTree.assets ?? []);
    const assetConflicts = [], chartChoices = [], assetChoices = [];
    state.conflicts.forEach((conflict, index) => {
      if (conflict.kind === 'asset') { assetConflicts.push(conflict); assetChoices.push(choices?.[index]); }
      else chartChoices.push(choices?.[index]);
    });
    const mergedChart = resolveChartMerge(baseChart, oursChart, theirsChart, chartChoices);
    assertChart(mergedChart); assertMergedLineParents(mergedChart);
    const mergedAssets = applyAssetResolutions(assetMerge.assets, assetConflicts, assetChoices);
    const folders = mergeFolders(baseTree?.folders ?? [], oursTree.folders ?? [], theirsTree.folders ?? []);
    const treeId = await this.writeTreeFromParts({
      chartText: stringifyPreservingNumbers(mergedChart), assets: mergedAssets, folders,
      chartName: oursTree.chartName || theirsTree.chartName || 'chart.json'
    });
    const commit = await this.createCommit(repo, {
      tree: treeId, parents: state.parents, author: repo.config?.author, message: state.message, kind: state.kind
    });
    this.updateHead(repo, commit.id);
    repo.index = treeId;
    repo.merge = null;
    this.pushReflog(repo, state.message, state.parents[0] ?? null, commit.id);
    await this.save(repo);
    return { commit, snapshot: await this.readSnapshot(treeId) };
  }

  async abortMerge() {
    const repo = await this.read();
    if (!repo.merge) throw new Error(t('chart-vcs.sa66770e'));
    const oursTree = repo.merge.oursTree;
    repo.merge = null;
    await this.save(repo);
    return { snapshot: oursTree ? await this.readSnapshot(oursTree) : null };
  }

  async reset(commitId, mode = 'mixed') {
    const repo = await this.read();
    const target = await this.readCommit(commitId);
    if (!target) throw new Error(t('chart-vcs.sc2059bf'));
    const previous = this.resolveHead(repo);
    if (mode === 'soft') {
      this.updateHead(repo, commitId);
      this.pushReflog(repo, t('chart-vcs.sb7f715e', { p0: shortId(commitId) }), previous, commitId);
      await this.save(repo);
      return { snapshot: null, repo };
    }
    this.updateHead(repo, commitId);
    repo.index = target.tree;
    repo.merge = null;
    this.pushReflog(repo, t('chart-vcs.s2043efe', { p0: mode === 'hard' ? t('chart-vcs.s32709a5') : t('chart-vcs.sa4a06e0'), p1: shortId(commitId) }), previous, commitId);
    await this.save(repo);
    return { snapshot: mode === 'hard' ? await this.readSnapshot(target.tree) : null, repo };
  }

  async createTag(name, commitId = null, message = '') {
    const tag = assertRefName(name, t('chart-vcs.sae0a7af'));
    const repo = await this.read();
    if (Object.hasOwn(repo.tags, tag)) throw new Error(t('chart-vcs.s5169284', { p0: tag }));
    const target = commitId ?? this.resolveHead(repo);
    if (!target) throw new Error(t('chart-vcs.s36aed76'));
    setReference(repo.tags, tag, { commit: target, message: String(message ?? '').trim(), tagger: normalizeAuthor(repo.config?.author), timestamp: this.now() });
    await this.save(repo);
    return repo;
  }

  async deleteTag(name) {
    const repo = await this.read();
    if (!Object.hasOwn(repo.tags, name)) throw new Error(t('chart-vcs.sdf81700'));
    delete repo.tags[name];
    await this.save(repo);
    return repo;
  }

  async stashPush(snapshot, message = '') {
    const repo = await this.read();
    const headId = this.resolveHead(repo);
    const head = await this.readCommit(headId);
    if (!head) throw new Error(t('chart-vcs.s6b04f3f'));
    const tree = await this.treeFromSnapshot(snapshot, { write: true });
    const entry = {
      id: randomId(), tree: tree.id, baseTree: head.tree,
      message: String(message ?? '').trim() || t('chart-vcs.s425c34a', { p0: new Date(this.now()).toLocaleString() }),
      timestamp: this.now(), branch: repo.head?.type === 'branch' ? repo.head.name : null
    };
    repo.stash.unshift(entry);
    repo.index = head.tree;
    this.pushReflog(repo, t('chart-vcs.s12a8e48', { p0: entry.message }), headId, headId);
    await this.save(repo);
    return { repo, snapshot: await this.readSnapshot(head.tree) };
  }

  async stashApply(index, snapshot) {
    const repo = await this.read();
    const entry = repo.stash[index];
    if (!entry) throw new Error(t('chart-vcs.s41e6af5'));
    const [baseTree, theirsTree] = await Promise.all([this.readTree(entry.baseTree), this.readTree(entry.tree)]);
    if (!theirsTree) throw new Error(t('chart-vcs.sc38bc30'));
    const oursTree = await this.treeFromSnapshot(snapshot, { write: true });
    const [baseChart, oursChart, theirsChart] = await Promise.all([
      this.readChart(baseTree), this.readChart(oursTree), this.readChart(theirsTree)
    ]);
    const chartMerge = mergeCharts(baseChart, oursChart, theirsChart);
    const assetMerge = mergeAssets(baseTree?.assets ?? [], oursTree.assets ?? [], theirsTree.assets ?? []);
    const conflicts = [...chartMerge.conflicts, ...assetMerge.conflicts];
    if (conflicts.length) {
      const error = new Error(t('chart-vcs.se3ecc4c', { p0: conflicts.length }));
      error.code = 'STASH_CONFLICT';
      error.conflicts = conflicts;
      throw error;
    }
    assertChart(chartMerge.chart); assertMergedLineParents(chartMerge.chart);
    const folders = mergeFolders(baseTree?.folders ?? [], oursTree.folders ?? [], theirsTree.folders ?? []);
    const treeId = await this.writeTreeFromParts({
      chartText: stringifyPreservingNumbers(chartMerge.chart), assets: assetMerge.assets, folders,
      chartName: oursTree.chartName || theirsTree.chartName || 'chart.json'
    });
    return { repo, snapshot: await this.readSnapshot(treeId) };
  }

  async stashPop(index, snapshot) {
    const result = await this.stashApply(index, snapshot);
    await this.stashDrop(index);
    return result;
  }

  async stashDrop(index) {
    const repo = await this.read();
    if (index < 0 || index >= repo.stash.length) throw new Error(t('chart-vcs.s41e6af5'));
    repo.stash.splice(index, 1);
    await this.save(repo);
    return repo;
  }

  async diffCommit(commitId) {
    const commit = await this.readCommit(commitId);
    if (!commit) throw new Error(t('chart-vcs.sc2059bf'));
    const parent = commit.parents?.[0] ? await this.readCommit(commit.parents[0]) : null;
    const oldTree = parent ? await this.readTree(parent.tree) : null;
    const newTree = await this.readTree(commit.tree);
    if (!newTree) throw new Error(t('chart-vcs.s2865d40'));
    const oldChart = await this.readChart(oldTree);
    const newChart = await this.readChart(newTree);
    return { commit, parent, chartDiff: diffCharts(oldChart, newChart), treeDiff: diffTrees(oldTree, newTree) };
  }

  async workingDiff(snapshot) {
    const repo = await this.read();
    const head = await this.readCommit(this.resolveHead(repo));
    const headTree = head ? await this.readTree(head.tree) : null;
    const headChart = await this.readChart(headTree);
    const workingTree = await this.treeFromSnapshot(snapshot, { write: false });
    return { chartDiff: diffCharts(headChart, snapshot.chart), treeDiff: diffTrees(headTree, workingTree) };
  }

  async headSnapshot() {
    const repo = await this.read();
    const head = await this.readCommit(this.resolveHead(repo));
    return head ? this.readSnapshot(head.tree) : null;
  }

  async collectReachable(repos) {
    const commits = new Map((await this.store.list('commits')).map(commit => [commit.id, commit]));
    const trees = new Map((await this.store.list('trees')).map(tree => [tree.id, tree]));
    const blobs = new Map((await this.store.list('blobs')).map(blob => [blob.id, blob]));
    const reachableCommits = new Set(), reachableTrees = new Set(), reachableBlobs = new Set();
    const addTree = id => {
      if (!id || reachableTrees.has(id) || !trees.has(id)) return;
      reachableTrees.add(id);
      const tree = trees.get(id);
      if (tree.chart) reachableBlobs.add(tree.chart);
      for (const entry of tree.assets ?? []) reachableBlobs.add(entry.blob);
    };
    const addCommit = id => {
      if (!id || reachableCommits.has(id) || !commits.has(id)) return;
      reachableCommits.add(id);
      const commit = commits.get(id);
      addTree(commit.tree);
      for (const parent of commit.parents ?? []) addCommit(parent);
    };
    for (const repo of repos) {
      for (const id of Object.values(repo.branches ?? {})) addCommit(id);
      for (const tag of Object.values(repo.tags ?? {})) addCommit(typeof tag === 'string' ? tag : tag?.commit);
      if (repo.head?.type === 'detached') addCommit(repo.head.commit);
      addTree(repo.index);
      for (const entry of repo.stash ?? []) { addTree(entry.tree); addTree(entry.baseTree); }
      if (repo.merge) {
        addTree(repo.merge.baseTree); addTree(repo.merge.oursTree); addTree(repo.merge.theirsTree);
        for (const id of repo.merge.parents ?? []) addCommit(id);
      }
      for (const entry of repo.reflog ?? []) { addCommit(entry.from); addCommit(entry.to); }
    }
    return {
      commits: [...reachableCommits].map(id => commits.get(id)),
      trees: [...reachableTrees].map(id => trees.get(id)),
      blobs: [...reachableBlobs].map(id => blobs.get(id)).filter(Boolean)
    };
  }

  async exportBundle() {
    const repo = await this.read();
    const reachable = await this.collectReachable([repo]);
    return {
      format: VCS_FORMAT, version: VCS_VERSION, exportedAt: this.now(),
      repo: cloneValue(repo), commits: reachable.commits, trees: reachable.trees,
      blobs: reachable.blobs.map(blob => [blob.id, bytesToBase64(blob.bytes)])
    };
  }

  async importBundle(bundle) {
    if (!bundle || bundle.format !== VCS_FORMAT) throw new Error(t('chart-vcs.s3ca70d2'));
    if (Number(bundle.version) > VCS_VERSION) throw new Error(t('chart-vcs.s9ea4f20', { p0: bundle.version, p1: VCS_VERSION }));
    if (!Array.isArray(bundle.commits) || !Array.isArray(bundle.trees) || !Array.isArray(bundle.blobs)) throw new Error(t('chart-vcs.s0fd5a62'));
    if (bundle.commits.some(commit => typeof commit?.id !== 'string' || typeof commit.tree !== 'string' || !Array.isArray(commit.parents ?? []))) throw new Error(t('chart-vcs.s502db71'));
    if (bundle.trees.some(tree => typeof tree?.id !== 'string')) throw new Error(t('chart-vcs.sf8e96da'));
    if (bundle.blobs.some(blob => !Array.isArray(blob) || blob.length !== 2 || typeof blob[0] !== 'string' || typeof blob[1] !== 'string')) throw new Error(t('chart-vcs.s479124a'));

    const blobs = new Map();
    for (const [id, text] of bundle.blobs) {
      let bytes;
      try { bytes = base64ToBytes(text); } catch { throw new Error(t('chart-vcs.s72d9664', { p0: id })); }
      if (await sha256Hex(bytes) !== id) throw new Error(t('chart-vcs.s36f0d1d', { p0: id }));
      if (blobs.has(id) && !equalBytes(blobs.get(id), bytes)) throw new Error(t('chart-vcs.s4c30fa2', { p0: id }));
      blobs.set(id, bytes);
    }
    const trees = new Map();
    for (const tree of bundle.trees) {
      if (!tree || typeof tree.chart !== 'string' || !Array.isArray(tree.assets) || !Array.isArray(tree.folders) || typeof tree.chartName !== 'string') throw new Error(t('chart-vcs.sf8e96da'));
      const { id, ...body } = tree;
      if (await sha256Hex(canonicalJson(body)) !== id) throw new Error(t('chart-vcs.sb703ab0', { p0: id }));
      if (trees.has(id)) throw new Error(t('chart-vcs.sf3602c1', { p0: id }));
      trees.set(id, tree);
    }
    const sourceCommits = new Map();
    for (const commit of bundle.commits) {
      if (sourceCommits.has(commit.id)) throw new Error(t('chart-vcs.scb96b80', { p0: commit.id }));
      sourceCommits.set(commit.id, commit);
    }
    for (const commit of bundle.commits) {
      if (!trees.has(commit.tree) && !(await this.store.get('trees', commit.tree))) throw new Error(t('chart-vcs.scfa7d0c', { p0: commit.id }));
      for (const parent of commit.parents ?? []) if (!sourceCommits.has(parent)) throw new Error(t('chart-vcs.s14b4e1b', { p0: parent }));
    }
    for (const tree of trees.values()) {
      for (const id of [tree.chart, ...tree.assets.map(entry => entry?.blob)]) {
        if (typeof id !== 'string' || (!blobs.has(id) && !(await this.store.get('blobs', id)))) throw new Error(t('chart-vcs.sff43a27', { p0: id ?? t('chart-vcs.sd9c32a4') }));
      }
    }

    const repo = await this.read();
    for (const [id, bytes] of blobs) {
      const existing = await this.store.get('blobs', id);
      if (existing && !equalBytes(existing.bytes, bytes)) throw new Error(t('chart-vcs.s8f30f7f', { p0: id }));
      if (!existing) await this.store.put('blobs', { id, bytes });
      this.knownBlobs.add(id);
    }
    for (const tree of trees.values()) {
      const existing = await this.store.get('trees', tree.id);
      if (existing && canonicalJson(existing) !== canonicalJson(tree)) throw new Error(t('chart-vcs.sac80cef', { p0: tree.id }));
      if (!existing) await this.store.put('trees', tree);
    }
    const mapped = new Map();
    const ordered = [];
    const visited = new Set();
    const visit = commit => {
      if (!commit || visited.has(commit.id)) return;
      visited.add(commit.id);
      for (const parent of commit.parents ?? []) visit(sourceCommits.get(parent));
      ordered.push(commit);
    };
    for (const commit of sourceCommits.values()) visit(commit);
    for (const commit of ordered) {
      const parents = (commit.parents ?? []).map(parent => mapped.get(parent) ?? parent);
      const payload = {
        repoId: this.repoId, tree: commit.tree, parents, author: normalizeAuthor(commit.author),
        timestamp: commit.timestamp, message: commit.message, kind: commit.kind ?? 'commit'
      };
      const id = await sha256Hex(canonicalJson(payload));
      mapped.set(commit.id, id);
      const existing = await this.store.get('commits', id);
      if (existing && canonicalJson(existing) !== canonicalJson({ id, ...payload })) throw new Error(t('chart-vcs.s8b3b619', { p0: id }));
      if (!existing) await this.store.put('commits', { id, ...payload });
    }
    const addedBranches = [], addedTags = [];
    const uniqueName = (collection, name) => {
      if (!Object.hasOwn(collection, name)) return name;
      let suffix = 1;
      let next = `${name}-imported`;
      while (Object.hasOwn(collection, next)) next = `${name}-imported-${++suffix}`;
      return next;
    };
    for (const [name, id] of Object.entries(bundle.repo?.branches ?? {})) {
      if (!id) continue;
      const target = mapped.get(id) ?? id;
      if (Object.hasOwn(repo.branches, name) && repo.branches[name] === target) continue;
      if (!Object.hasOwn(repo.branches, name) || repo.branches[name] == null) {
        setReference(repo.branches, name, target);
        addedBranches.push(name);
        continue;
      }
      const next = uniqueName(repo.branches, name);
      setReference(repo.branches, next, target);
      addedBranches.push(next);
    }
    for (const [name, tag] of Object.entries(bundle.repo?.tags ?? {})) {
      const id = typeof tag === 'string' ? tag : tag?.commit;
      if (!id) continue;
      const target = mapped.get(id) ?? id;
      const next = uniqueName(repo.tags, name);
      setReference(repo.tags, next, { ...(typeof tag === 'object' ? tag : {}), commit: target });
      addedTags.push(next);
    }
    for (const entry of bundle.repo?.stash ?? []) {
      repo.stash.push({ ...entry, id: randomId(), message: t('chart-vcs.s38ababc', { p0: entry.message }) });
    }
    this.pushReflog(repo, t('chart-vcs.s46f73db', { p0: bundle.commits?.length ?? 0 }), null, this.resolveHead(repo));
    await this.save(repo);
    return { repo, commits: ordered.length, branches: addedBranches, tags: addedTags };
  }

  async gc() {
    const repos = await this.store.list('repos');
    const reachable = await this.collectReachable(repos);
    const commits = await this.store.list('commits');
    const trees = await this.store.list('trees');
    const blobs = await this.store.list('blobs');
    const commitIds = new Set(reachable.commits.map(commit => commit.id));
    const treeIds = new Set(reachable.trees.map(tree => tree.id));
    const blobIds = new Set(reachable.blobs.map(blob => blob.id));
    let removedCommits = 0, removedTrees = 0, removedBlobs = 0;
    for (const commit of commits) if (!commitIds.has(commit.id)) { await this.store.delete('commits', commit.id); removedCommits++; }
    for (const tree of trees) if (!treeIds.has(tree.id)) { await this.store.delete('trees', tree.id); removedTrees++; }
    for (const blob of blobs) if (!blobIds.has(blob.id)) { await this.store.delete('blobs', blob.id); removedBlobs++; }
    this.knownBlobs.clear();
    return { removedCommits, removedTrees, removedBlobs };
  }
}
