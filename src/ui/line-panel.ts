import { createLine } from '../core/chart.ts';
import { groupLineIndices, groupNames, lineDisplayLabel, lineFeatureLabels, lineGroupIndex, lineGroupName, lineNameLabel } from '../core/line-groups.ts';
import { deleteLine, duplicateLine, reorderLine, setLineParent } from '../application/line-commands.ts';
import { UI_BINDINGS } from '../core/game-ui.ts';
import { assetUrl } from '../core/asset-url.ts';
import type { EditorSession } from '../application/session.ts';
import type { Chart, JudgeLine } from '../core/types.ts';

/** Reads the trimmed text of a form control; `unknown` because callers pass inputs and selects alike. */
const value = (input: HTMLInputElement | HTMLSelectElement | null | undefined): string => String(input?.value ?? '').trim();

/**
 * The asset library as the texture picker reads it: a name per image, with its bytes when the
 * project carries them (`null` stands for the built-in `line.png`, which is served from `assets/`).
 * This is the same `Map<string, Uint8Array>` the rest of the editor passes around (`app.ts`,
 * `files.ts`, `library.ts`).
 */
export type LineAssets = Map<string, Uint8Array | null>;

/** The fields `applyLine` writes back; every value arrives from a form control. */
export interface LineFormValues {
  parent: HTMLSelectElement;
  group: HTMLSelectElement;
  zOrder: HTMLInputElement;
  bpmfactor: HTMLInputElement;
  name: HTMLInputElement;
  isCover: boolean;
  attachUI: HTMLSelectElement;
  texture: HTMLInputElement;
  rotateWithFather: boolean;
}

/** What {@link LinePanel}'s host supplies. Every hook defaults to a no-op. */
export interface LinePanelOptions {
  render?: () => void;
  notify?: (message: string, level?: string) => void;
  getAssets?: () => LineAssets;
  afterTexture?: () => void;
}

export class LinePanel {
  // Declared explicitly: an unannotated `[]`/`false` field would be inferred too narrowly and
  // cascade into the callers, exactly as `EditorSession` documents for its own fields.
  host: HTMLElement;
  getSession: () => EditorSession;
  renderSession: () => void;
  notify: (message: string, level?: string) => void;
  getAssets: () => LineAssets;
  afterTexture: () => void;
  selectedGroup: number;
  textureUrls: string[];
  textureLibraryOpen: boolean;
  /** The line list's scroll position, preserved across re-renders; `undefined` before the first one. */
  scrollTop: number | undefined;

  constructor(host: HTMLElement, getSession: () => EditorSession, { render = () => {}, notify = () => {}, getAssets = () => new Map(), afterTexture = () => {} }: LinePanelOptions = {}) {
    this.host = host; this.getSession = getSession; this.renderSession = render; this.notify = notify; this.getAssets = getAssets; this.afterTexture = afterTexture; this.selectedGroup = 0; this.textureUrls = []; this.textureLibraryOpen = false;
  }

  clearTextureUrls(): void { for (const url of this.textureUrls) URL.revokeObjectURL(url); this.textureUrls = []; }

  setTexture(name: string): void {
    const session = this.getSession(); const line = session.line; if (!line) return;
    const lines = [...session.chart.judgeLineList]; lines[session.lineIndex] = { ...line, Texture: name || 'line.png' };
    session.commit('更改判定线贴图', { ...session.chart, judgeLineList: lines });
    this.afterTexture();
  }

  commit(label: string, chart: Chart, index: number = this.getSession().lineIndex): void {
    const session = this.getSession();
    const beforeSelection = session.selectionState();
    session.lineIndex = Math.max(0, Math.min(index, (chart.judgeLineList?.length ?? 1) - 1));
    session.selection.clear(); session.eventSelection.clear();
    session.commit(label, chart, beforeSelection);
  }

  field<T extends HTMLElement>(container: HTMLElement, labelText: string, input: T): T {
    const label = document.createElement('label'); label.className = 'field'; label.append(labelText, input); container.append(label); return input;
  }

  applyLine(values: LineFormValues): void {
    const session = this.getSession(); const index = session.lineIndex; const line = session.line;
    if (!line) return;
    const parent = Number(value(values.parent)); const group = Number(value(values.group)); const zOrder = Number(value(values.zOrder)); const bpmfactor = Number(value(values.bpmfactor));
    if (!Number.isInteger(parent) || parent < -1 || parent >= session.chart.judgeLineList.length || parent === index) throw new Error('父线无效');
    if (!Number.isInteger(group) || group < 0 || group >= groupNames(session.chart).length) throw new Error('分组无效');
    if (!Number.isFinite(zOrder) || !Number.isFinite(bpmfactor) || bpmfactor <= 0) throw new Error('zOrder 或 BPM 倍率无效');
    const chart = setLineParent(session.chart, index, parent);
    const lines = [...chart.judgeLineList];
    lines[index] = { ...lines[index], Name: value(values.name), Group: group, isCover: values.isCover ? 1 : 0,
      attachUI: value(values.attachUI) || undefined, zOrder: Math.trunc(zOrder), bpmfactor,
      rotateWithFather: Boolean(values.rotateWithFather), Texture: value(values.texture) || 'line.png' };
    this.commit('更新判定线属性', { ...chart, judgeLineList: lines });
    this.afterTexture();
  }

  render(): void {
    const session = this.getSession(); if (!session?.chart) return;
    this.clearTextureUrls();
    const chart = session.chart; const lines = chart.judgeLineList ?? []; const names = groupNames(chart);
    this.host.replaceChildren();
    const title = document.createElement('div'); title.className = 'panel-title'; const titleCount = document.createElement('small'); titleCount.textContent = `${lines.length} 条`; title.append('判定线', titleCount);
    this.host.append(title);
    const actions = document.createElement('div'); actions.className = 'line-panel-actions';
    const add = document.createElement('button'); add.type = 'button'; add.textContent = '＋ 新增'; add.onclick = () => { const index = lines.length; this.commit('新增判定线', { ...chart, judgeLineList: [...lines, createLine(`Line ${index + 1}`)] }, index); };
    const duplicate = document.createElement('button'); duplicate.type = 'button'; duplicate.textContent = '复制'; duplicate.disabled = !session.line; duplicate.onclick = () => this.commit('复制判定线', duplicateLine(chart, session.lineIndex), lines.length);
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除'; remove.disabled = lines.length <= 1 || !session.line; remove.onclick = () => this.commit('删除判定线', deleteLine(chart, session.lineIndex), Math.max(0, session.lineIndex - 1));
    actions.append(add, duplicate, remove); this.host.append(actions);
    const list = document.createElement('div'); list.id = 'line-list'; list.setAttribute('role', 'list'); list.setAttribute('aria-label', '判定线列表');
    const scrollTop = this.scrollTop ?? 0;
    const hasNamedGroups = names.slice(1).some((unused, groupIndex) => groupLineIndices(chart, groupIndex + 1).length > 0);
    const createRow = (index: number, line: JudgeLine): HTMLButtonElement => {
      const button = document.createElement('button'); button.type = 'button'; button.className = index === session.lineIndex ? 'active' : '';
      const number = document.createElement('span'); number.className = 'line-list-index'; number.textContent = String(index).padStart(2, '0');
      const name = document.createElement('span'); name.className = 'line-list-name'; name.textContent = lineNameLabel(line, index);
      const features = lineFeatureLabels(line);
      const meta = document.createElement('small'); meta.className = 'line-list-features'; meta.textContent = features.join(' · '); meta.hidden = !features.length;
      button.append(number, name, meta);
      button.title = lineDisplayLabel(chart, index); button.onclick = () => { this.scrollTop = list.scrollTop; session.selectLine(index); };
      return button;
    };
    if (hasNamedGroups) {
      for (const [groupIndex, groupName] of names.entries()) {
        const group = document.createElement('details'); group.className = 'line-list-group'; group.open = true;
        const summary = document.createElement('summary'); const label = document.createElement('span'); label.className = 'line-list-group-name'; label.textContent = groupName; const count = document.createElement('small'); count.textContent = `${groupLineIndices(chart, groupIndex).length} 条`; summary.append(label, count); group.append(summary);
        const rows = document.createElement('div'); rows.className = 'line-list-group-rows';
        for (const index of groupLineIndices(chart, groupIndex)) rows.append(createRow(index, lines[index]));
        group.append(rows); list.append(group);
      }
    } else {
      for (const [index, line] of lines.entries()) list.append(createRow(index, line));
    }
    list.addEventListener('scroll', () => { this.scrollTop = list.scrollTop; }, { passive: true }); this.host.append(list);
    const line = session.line;
    if (line) {
      const form = document.createElement('div'); form.className = 'line-properties-form';
      const name = document.createElement('input'); name.value = line.Name ?? ''; name.setAttribute('aria-label', '判定线名称'); this.field(form, '名称', name);
      const group = document.createElement('select'); names.forEach((nameText, index) => group.append(new Option(`${index} · ${nameText}`, String(index)))); group.value = String(Math.min(lineGroupIndex(line), names.length - 1)); group.setAttribute('aria-label', '判定线分组'); this.field(form, '分组', group);
      const mask = document.createElement('input'); mask.type = 'checkbox'; mask.checked = Number(line.isCover ?? 1) === 1; mask.setAttribute('aria-label', '遮罩'); const maskLabel = document.createElement('label'); maskLabel.className = 'field checkbox-field'; maskLabel.append(mask, '遮罩：隐藏线下方音符'); form.append(maskLabel);
      const parent = document.createElement('select'); parent.setAttribute('aria-label', '父判定线'); parent.append(new Option('-1 · 无父线', '-1')); lines.forEach((candidate, index) => { if (index !== session.lineIndex) parent.append(new Option(`${index} · ${lineDisplayLabel(chart, index, { includeIndex: false })}`, String(index))); }); parent.value = String(line.father ?? -1); this.field(form, '父线', parent);
      const attachUI = document.createElement('select'); attachUI.setAttribute('aria-label', '绑定游戏 UI'); attachUI.append(new Option('不绑定', ''), ...UI_BINDINGS.map(([key, label]) => new Option(label, key))); if (line.attachUI && !UI_BINDINGS.some(([key]) => key === line.attachUI)) attachUI.append(new Option(`保留：${line.attachUI}`, line.attachUI)); attachUI.value = line.attachUI ?? ''; this.field(form, '绑定 UI', attachUI);
      const zOrder = document.createElement('input'); zOrder.type = 'number'; zOrder.step = '1'; zOrder.value = String(Number(line.zOrder ?? 0)); zOrder.setAttribute('aria-label', 'zOrder'); this.field(form, 'zOrder', zOrder);
      const bpmfactor = document.createElement('input'); bpmfactor.type = 'number'; bpmfactor.min = '0.01'; bpmfactor.step = '0.01'; bpmfactor.value = String(Number(line.bpmfactor ?? 1)); bpmfactor.setAttribute('aria-label', 'BPM 倍率'); this.field(form, 'BPM 倍率', bpmfactor);
      const texture = document.createElement('input'); texture.value = line.Texture ?? 'line.png'; texture.setAttribute('aria-label', '判定线贴图'); texture.setAttribute('list', 'line-texture-suggestions'); this.field(form, '贴图', texture);
      const suggestions = document.createElement('datalist'); suggestions.id = 'line-texture-suggestions'; suggestions.append(new Option('line.png', 'line.png')); for (const name of this.getAssets().keys()) if (/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(name) && name !== 'line.png') suggestions.append(new Option(name, name)); form.append(suggestions);
      const textureLibrary = document.createElement('details'); textureLibrary.className = 'line-texture-library'; textureLibrary.open = this.textureLibraryOpen; textureLibrary.addEventListener('toggle', () => { this.textureLibraryOpen = textureLibrary.open; }); const textureSummary = document.createElement('summary'); textureSummary.textContent = '素材库图片'; textureLibrary.append(textureSummary);
      const textureGrid = document.createElement('div'); textureGrid.className = 'line-texture-grid';
      const textureEntries: [string, Uint8Array | null][] = [...this.getAssets()];
      if (!textureEntries.some(([name]) => name === 'line.png')) textureEntries.unshift(['line.png', null]);
      for (const [name, bytes] of textureEntries) {
        if (!/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(name)) continue;
        const button = document.createElement('button'); button.type = 'button'; button.className = name === texture.value ? 'selected' : ''; button.title = name;
        // `name.split(...).at(-1)` is the file extension, and the asset list is filtered to image
        // extensions above, so it is always present; `?? ''` records that without changing the text.
        const extension = name.split('.').at(-1) ?? '';
        // A `Uint8Array` is a valid `BlobPart` at runtime, but its default `ArrayBufferLike` backing
        // buffer is not assignable to `BlobPart`'s `ArrayBuffer` — `SharedArrayBuffer` is excluded by
        // the DOM type and cannot occur here, since these bytes come from `File.arrayBuffer()` or a
        // ZIP entry. The DOM types cannot express that, so the gap is closed on this binding exactly
        // as `images.ts` and `archive.ts` do; nothing else about the bytes changes.
        const part = bytes as BlobPart;
        const image = document.createElement('img'); const url = bytes ? URL.createObjectURL(new Blob([part], { type: `image/${extension.replace('jpg', 'jpeg')}` })) : assetUrl('rpe/Texture/line.png'); if (bytes) this.textureUrls.push(url); image.src = url; image.alt = name; button.dataset.texture = name; button.append(image, document.createTextNode(name.split('/').at(-1) ?? '')); button.onclick = () => { texture.value = name; this.setTexture(name); }; textureGrid.append(button);
      }
      textureLibrary.append(textureGrid); form.append(textureLibrary);
      if (this.textureLibraryOpen) queueMicrotask(() => textureGrid.querySelector(`[data-texture="${CSS.escape(texture.value)}"]`)?.scrollIntoView({ block: 'nearest' }));
      const rotate = document.createElement('input'); rotate.type = 'checkbox'; rotate.checked = line.rotateWithFather ?? ((chart.META?.RPEVersion ?? 0) >= 163); rotate.setAttribute('aria-label', '继承父线旋转'); const rotateLabel = document.createElement('label'); rotateLabel.className = 'field checkbox-field'; rotateLabel.append(rotate, '继承父线旋转'); form.append(rotateLabel);
      const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'wide-button primary'; apply.textContent = '应用判定线属性'; apply.onclick = () => { try { this.applyLine({ name, group, isCover: mask.checked, parent, attachUI, zOrder, bpmfactor, texture, rotateWithFather: rotate.checked }); } catch (error) { this.notify(error instanceof Error ? error.message : String(error), 'error'); } }; form.append(apply);
      const reorder = document.createElement('div'); reorder.className = 'line-reorder-actions';
      const up = document.createElement('button'); up.type = 'button'; up.textContent = '上移'; up.disabled = session.lineIndex === 0; up.onclick = () => this.commit('上移判定线', reorderLine(chart, session.lineIndex, session.lineIndex - 1), session.lineIndex - 1);
      const down = document.createElement('button'); down.type = 'button'; down.textContent = '下移'; down.disabled = session.lineIndex >= lines.length - 1; down.onclick = () => this.commit('下移判定线', reorderLine(chart, session.lineIndex, session.lineIndex + 1), session.lineIndex + 1);
      reorder.append(up, down); form.append(reorder); this.host.append(form);
    }
    const groups = document.createElement('details'); groups.className = 'line-groups'; groups.open = true; const summary = document.createElement('summary'); summary.textContent = '分组管理'; groups.append(summary);
    const groupSelect = document.createElement('select'); names.forEach((nameText, index) => groupSelect.append(new Option(`${index} · ${nameText}（${groupLineIndices(chart, index).length}）`, String(index)))); groupSelect.value = String(Math.min(this.selectedGroup, names.length - 1)); groupSelect.onchange = () => { this.selectedGroup = Number(groupSelect.value); groupName.value = names[this.selectedGroup]; };
    const groupName = document.createElement('input'); groupName.value = names[this.selectedGroup] ?? names[0]; groupName.setAttribute('aria-label', '分组名称'); const groupRow = document.createElement('div'); groupRow.className = 'line-group-row'; groupRow.append(groupSelect, groupName); groups.append(groupRow);
    const groupActions = document.createElement('div'); groupActions.className = 'line-reorder-actions';
    const addGroup = document.createElement('button'); addGroup.type = 'button'; addGroup.textContent = '新增分组'; addGroup.onclick = () => { const nameText = value(groupName); if (!nameText) return this.notify('请输入分组名称', 'warning'); const next = [...names, nameText]; this.selectedGroup = next.length - 1; this.commit('新增判定线分组', { ...chart, judgeLineGroup: next }); };
    const renameGroup = document.createElement('button'); renameGroup.type = 'button'; renameGroup.textContent = '重命名'; renameGroup.onclick = () => { const nameText = value(groupName); if (!nameText) return this.notify('请输入分组名称', 'warning'); const next = [...names]; next[this.selectedGroup] = nameText; this.commit('重命名判定线分组', { ...chart, judgeLineGroup: next }); };
    const deleteGroup = document.createElement('button'); deleteGroup.type = 'button'; deleteGroup.textContent = '删除'; deleteGroup.disabled = this.selectedGroup === 0 || !names.length; deleteGroup.onclick = () => { const removed = this.selectedGroup; const next = names.filter((unused, index) => index !== removed); const linesNext = lines.map(line => { const current = lineGroupIndex(line); return { ...line, Group: current === removed ? 0 : current > removed ? current - 1 : current }; }); this.selectedGroup = 0; this.commit('删除判定线分组', { ...chart, judgeLineGroup: next, judgeLineList: linesNext }); };
    groupActions.append(addGroup, renameGroup, deleteGroup); groups.append(groupActions); this.host.append(groups);
    list.scrollTop = scrollTop;
  }
}
