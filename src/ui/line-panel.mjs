import { createLine } from '../core/chart.mjs';
import { groupLineIndices, groupNames, lineDisplayLabel, lineFeatureLabels, lineGroupIndex, lineGroupName, lineNameLabel } from '../core/line-groups.mjs';
import { deleteLine, duplicateLine, reorderLine, setLineParent, ensureLineCount, validateLineCount, MAX_BATCH_LINE_COUNT } from '../application/line-commands.mjs';
import { UI_BINDINGS } from '../core/game-ui.mjs';
import { assetUrl } from '../core/asset-url.mjs';
import { libraryImages } from '../core/asset-library.mjs';
import { assetPath } from '../platform/files.mjs';
import { assetReference } from '../platform/asset-library.mjs';
import { t } from '../i18n.mjs';

const value = input => String(input?.value ?? '').trim();

export class LinePanel {
  constructor(host, getSession, { render = () => {}, notify = () => {}, getAssets = () => new Map(), getChartName = () => '', afterTexture = () => {} } = {}) {
    this.host = host; this.getSession = getSession; this.renderSession = render; this.notify = notify; this.getAssets = getAssets; this.getChartName = getChartName; this.afterTexture = afterTexture; this.selectedGroup = 0; this.textureUrls = []; this.textureLibraryOpen = false;
  }

  clearTextureUrls() { for (const url of this.textureUrls) URL.revokeObjectURL(url); this.textureUrls = []; }

  setTexture(name) {
    const session = this.getSession(); const line = session.line; if (!line) return;
    const texture = this.getAssets().has(name) ? assetReference(this.getAssets(), name, this.getChartName()) : name || 'line.png';
    const lines = [...session.chart.judgeLineList]; lines[session.lineIndex] = { ...line, Texture: texture };
    session.commit(t('line-panel.sea45fa3'), { ...session.chart, judgeLineList: lines });
    this.afterTexture();
  }

  commit(label, chart, index = this.getSession().lineIndex) {
    const session = this.getSession();
    const beforeSelection = session.selectionState();
    session.lineIndex = Math.max(0, Math.min(index, (chart.judgeLineList?.length ?? 1) - 1));
    session.selection.clear(); session.eventSelection.clear();
    session.commit(label, chart, beforeSelection);
  }

  field(container, labelText, input) {
    const label = document.createElement('label'); label.className = 'field'; label.append(labelText, input); container.append(label); return input;
  }

  applyLine(values) {
    const session = this.getSession(); const index = session.lineIndex; const line = session.line;
    if (!line) return;
    const parent = Number(value(values.parent)); const group = Number(value(values.group)); const zOrder = Number(value(values.zOrder));
    const multiplier = Number(value(values.bpmfactor));
    const bpmfactor = value(values.bpmfactor) === String(1 / (line.bpmfactor ?? 1)) ? line.bpmfactor ?? 1 : 1 / multiplier;
    const anchor = [values.anchorX === undefined ? line.anchor?.[0] ?? 0.5 : Number(value(values.anchorX)), values.anchorY === undefined ? line.anchor?.[1] ?? 0.5 : Number(value(values.anchorY))];
    if (!Number.isInteger(parent) || parent < -1 || parent >= session.chart.judgeLineList.length || parent === index) throw new Error(t('line-panel.sc6078f0'));
    if (!Number.isInteger(group) || group < 0 || group >= groupNames(session.chart).length) throw new Error(t('line-panel.s040157b'));
    if (!Number.isFinite(zOrder) || !Number.isFinite(multiplier) || multiplier <= 0 || !Number.isFinite(bpmfactor) || bpmfactor <= 0) throw new Error(t('line-panel.s8be12a3'));
    if (!anchor.every(Number.isFinite) || [values.anchorX, values.anchorY].some(input => input !== undefined && !value(input))) throw new Error(t('line-panel.sc7d5728'));
    const chart = setLineParent(session.chart, index, parent);
    const lines = [...chart.judgeLineList];
    lines[index] = { ...lines[index], Name: value(values.name), Group: group, isCover: values.isCover ? 1 : 0,
      attachUI: value(values.attachUI) || undefined, zOrder: Math.trunc(zOrder), bpmfactor, anchor,
      rotateWithFather: Boolean(values.rotateWithFather), Texture: value(values.texture) || 'line.png' };
    this.commit(t('line-panel.s58db9e5'), { ...chart, judgeLineList: lines });
    this.afterTexture();
  }

  async addLinesDialog() {
    const { showDialog } = await import('./dialog.mjs');
    const session = this.getSession();
    const content = showDialog(t('line-panel.s0c83ead'), t('line-panel.sdce9df9', { p0: MAX_BATCH_LINE_COUNT }));
    const input = document.createElement('input'); input.type = 'text'; input.inputMode = 'numeric'; input.pattern = '[0-9]+';
    input.setAttribute('aria-label', t('line-panel.sa035622')); input.value = String((session.chart.judgeLineList?.length ?? 0) + 1);
    this.field(content, t('line-panel.s3ad1997'), input);
    const summary = document.createElement('p'); summary.className = 'hint'; summary.setAttribute('aria-live', 'polite'); content.append(summary);
    const apply = document.querySelector('#modal-apply'), error = document.querySelector('#modal-error');
    const read = () => {
      if (session !== this.getSession()) throw new Error(t('line-panel.s0a98547'));
      if (!/^\d+$/.test(value(input))) throw new Error(t('line-panel.sfc71223'));
      const count = Number(value(input)); const current = session.chart.judgeLineList?.length ?? 0;
      validateLineCount(count, current);
      return { count, current };
    };
    const refresh = () => {
      try {
        const { count, current } = read(); error.textContent = '';
        summary.textContent = count > current ? t('line-panel.sffc4d0c', { p0: current, p1: count - current }) : t('line-panel.s28b6283', { p0: current });
        apply.disabled = count <= current;
      } catch (failure) { error.textContent = failure.message; summary.textContent = ''; apply.disabled = true; }
    };
    apply.hidden = false; apply.textContent = t('line-panel.s605806b');
    apply.onclick = () => {
      try {
        const { count, current } = read();
        if (count <= current) { refresh(); return; }
        this.commit(t('line-panel.s0c83ead'), ensureLineCount(session.chart, count), current);
        document.querySelector('#modal').close();
      } catch (failure) { error.textContent = failure.message; }
    };
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); if (!apply.disabled) apply.click(); } });
    refresh(); input.focus(); input.select();
  }

  render() {
    const session = this.getSession(); if (!session?.chart) return;
    this.clearTextureUrls();
    const chart = session.chart; const lines = chart.judgeLineList ?? []; const names = groupNames(chart);
    this.host.replaceChildren();
    const title = document.createElement('div'); title.className = 'panel-title'; const titleCount = document.createElement('small'); titleCount.textContent = t('line-panel.sfac04ca', { p0: lines.length }); title.append(t('transport.line'), titleCount);
    this.host.append(title);
    const actions = document.createElement('div'); actions.className = 'line-panel-actions';
    const add = document.createElement('button'); add.type = 'button'; add.textContent = t('line-panel.s119c201'); add.onclick = () => { const index = lines.length; this.commit(t('line-panel.s665c6b7'), { ...chart, judgeLineList: [...lines, createLine(`Line ${index + 1}`)] }, index); };
    const batchAdd = document.createElement('button'); batchAdd.type = 'button'; batchAdd.textContent = t('line-panel.s893758c'); batchAdd.onclick = () => this.addLinesDialog();
    const duplicate = document.createElement('button'); duplicate.type = 'button'; duplicate.textContent = t('line-panel.s4edd1d0'); duplicate.disabled = !session.line; duplicate.onclick = () => this.commit(t('line-panel.s745900a'), duplicateLine(chart, session.lineIndex), lines.length);
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = t('line-panel.s3755f56'); remove.disabled = lines.length <= 1 || !session.line; remove.onclick = () => this.commit(t('line-panel.s6245754'), deleteLine(chart, session.lineIndex), Math.max(0, session.lineIndex - 1));
    actions.append(add, batchAdd, duplicate, remove); this.host.append(actions);
    const list = document.createElement('div'); list.id = 'line-list'; list.setAttribute('role', 'list'); list.setAttribute('aria-label', t('line-panel.sca8a2a6'));
    const scrollTop = this.scrollTop ?? 0;
    const hasNamedGroups = names.slice(1).some((unused, groupIndex) => groupLineIndices(chart, groupIndex + 1).length > 0);
    const createRow = (index, line) => {
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
        const summary = document.createElement('summary'); const label = document.createElement('span'); label.className = 'line-list-group-name'; label.textContent = groupName; const count = document.createElement('small'); count.textContent = t('line-panel.sd4f5fb4', { p0: groupLineIndices(chart, groupIndex).length }); summary.append(label, count); group.append(summary);
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
      const name = document.createElement('input'); name.value = line.Name ?? ''; name.setAttribute('aria-label', t('line-panel.s6b5b88f')); this.field(form, t('line-panel.s1be7ae4'), name);
      const group = document.createElement('select'); names.forEach((nameText, index) => group.append(new Option(`${index} · ${nameText}`, index))); group.value = String(Math.min(lineGroupIndex(line), names.length - 1)); group.setAttribute('aria-label', t('line-panel.s12ad3d4')); this.field(form, t('line-panel.s97d8a6c'), group);
      const mask = document.createElement('input'); mask.type = 'checkbox'; mask.checked = Number(line.isCover ?? 1) === 1; mask.setAttribute('aria-label', t('line-panel.sb8b72c6')); const maskLabel = document.createElement('label'); maskLabel.className = 'field checkbox-field'; maskLabel.append(mask, t('line-panel.se5bca7e')); form.append(maskLabel);
      const parent = document.createElement('select'); parent.setAttribute('aria-label', t('line-panel.sa378d28')); parent.append(new Option(t('line-panel.s7ef32d0'), '-1')); lines.forEach((candidate, index) => { if (index !== session.lineIndex) parent.append(new Option(`${index} · ${lineDisplayLabel(chart, index, { includeIndex: false })}`, index)); }); parent.value = String(line.father ?? -1); this.field(form, t('line-panel.s2249d71'), parent);
      const attachUI = document.createElement('select'); attachUI.setAttribute('aria-label', t('line-panel.s076145d')); attachUI.append(new Option(t('line-panel.s9a0ee40'), ''), ...UI_BINDINGS.map(([key, label]) => new Option(label, key))); if (line.attachUI && !UI_BINDINGS.some(([key]) => key === line.attachUI)) attachUI.append(new Option(t('line-panel.s187bd35', { p0: line.attachUI }), line.attachUI)); attachUI.value = line.attachUI ?? ''; this.field(form, t('line-panel.sdc1ee5e'), attachUI);
      const zOrder = document.createElement('input'); zOrder.type = 'number'; zOrder.step = '1'; zOrder.value = Number(line.zOrder ?? 0); zOrder.setAttribute('aria-label', 'zOrder'); this.field(form, 'zOrder', zOrder);
      const bpmfactor = document.createElement('input'); bpmfactor.type = 'number'; bpmfactor.min = '0'; bpmfactor.step = 'any'; bpmfactor.value = 1 / (line.bpmfactor ?? 1); bpmfactor.setAttribute('aria-label', t('line-panel.s1ed265d')); this.field(form, t('line-panel.s1ed265d'), bpmfactor);
      const anchors = ['X', 'Y'].map((axis, index) => { const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.value = line.anchor?.[index] ?? 0.5; input.setAttribute('aria-label', t('line-panel.sbbcf4ca') + axis); this.field(form, t('line-panel.sbbcf4ca') + axis, input); return input; });
      const texture = document.createElement('input'); texture.value = line.Texture ?? 'line.png'; texture.setAttribute('aria-label', t('line-panel.s67fdd1f')); texture.setAttribute('list', 'line-texture-suggestions'); this.field(form, t('line-panel.s0e11b3c'), texture);
      const textureEntries = libraryImages(this.getAssets(), chart, this.getChartName());
      const suggestions = document.createElement('datalist'); suggestions.id = 'line-texture-suggestions'; suggestions.append(new Option('line.png', 'line.png')); for (const [name] of textureEntries) if (name !== 'line.png') suggestions.append(new Option(name, name)); form.append(suggestions);
      const textureLibrary = document.createElement('details'); textureLibrary.className = 'line-texture-library'; textureLibrary.open = this.textureLibraryOpen; textureLibrary.addEventListener('toggle', () => { this.textureLibraryOpen = textureLibrary.open; }); const textureSummary = document.createElement('summary'); textureSummary.textContent = t('line-panel.sb31983f'); textureLibrary.append(textureSummary);
      const textureGrid = document.createElement('div'); textureGrid.className = 'line-texture-grid';
      if (!textureEntries.some(([name]) => name === 'line.png')) textureEntries.unshift(['line.png', null]);
      for (const [name, bytes] of textureEntries) {
        if (!/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(name)) continue;
        const button = document.createElement('button'); button.type = 'button'; button.className = name === assetPath(this.getAssets(), texture.value, this.getChartName()) || name === texture.value ? 'selected' : ''; button.title = name;
        const image = document.createElement('img'); const url = bytes ? URL.createObjectURL(new Blob([bytes], { type: `image/${name.split('.').at(-1).replace('jpg', 'jpeg')}` })) : assetUrl('rpe/Texture/line.png'); if (bytes) this.textureUrls.push(url); image.src = url; image.alt = name; button.dataset.texture = name; button.append(image, document.createTextNode(name.split('/').at(-1))); button.onclick = () => { texture.value = name; this.setTexture(name); }; textureGrid.append(button);
      }
      textureLibrary.append(textureGrid); form.append(textureLibrary);
      if (this.textureLibraryOpen) queueMicrotask(() => textureGrid.querySelector(`[data-texture="${CSS.escape(texture.value)}"]`)?.scrollIntoView({ block: 'nearest' }));
      const rotate = document.createElement('input'); rotate.type = 'checkbox'; rotate.checked = line.rotateWithFather ?? ((chart.META?.RPEVersion ?? 0) >= 163); rotate.setAttribute('aria-label', t('line-panel.s5d3ae09')); const rotateLabel = document.createElement('label'); rotateLabel.className = 'field checkbox-field'; rotateLabel.append(rotate, t('line-panel.s5d3ae09')); form.append(rotateLabel);
      const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'wide-button primary'; apply.textContent = t('line-panel.sb4b2e29'); apply.onclick = () => { try { this.applyLine({ name, group, isCover: mask.checked, parent, attachUI, zOrder, bpmfactor, anchorX: anchors[0], anchorY: anchors[1], texture, rotateWithFather: rotate.checked }); } catch (error) { this.notify(error.message, 'error'); } }; form.append(apply);
      const reorder = document.createElement('div'); reorder.className = 'line-reorder-actions';
      const up = document.createElement('button'); up.type = 'button'; up.textContent = t('line-panel.s8a0c839'); up.disabled = session.lineIndex === 0; up.onclick = () => this.commit(t('line-panel.s8f391a6'), reorderLine(chart, session.lineIndex, session.lineIndex - 1), session.lineIndex - 1);
      const down = document.createElement('button'); down.type = 'button'; down.textContent = t('line-panel.s05c46fa'); down.disabled = session.lineIndex >= lines.length - 1; down.onclick = () => this.commit(t('line-panel.s95827fe'), reorderLine(chart, session.lineIndex, session.lineIndex + 1), session.lineIndex + 1);
      reorder.append(up, down); form.append(reorder); this.host.append(form);
    }
    const groups = document.createElement('details'); groups.className = 'line-groups'; groups.open = true; const summary = document.createElement('summary'); summary.textContent = t('line-panel.se900b55'); groups.append(summary);
    const groupSelect = document.createElement('select'); names.forEach((nameText, index) => groupSelect.append(new Option(`${index} · ${nameText}（${groupLineIndices(chart, index).length}）`, index))); groupSelect.value = String(Math.min(this.selectedGroup, names.length - 1)); groupSelect.onchange = () => { this.selectedGroup = Number(groupSelect.value); groupName.value = names[this.selectedGroup]; };
    const groupName = document.createElement('input'); groupName.value = names[this.selectedGroup] ?? names[0]; groupName.setAttribute('aria-label', t('line-panel.s65731c1')); const groupRow = document.createElement('div'); groupRow.className = 'line-group-row'; groupRow.append(groupSelect, groupName); groups.append(groupRow);
    const groupActions = document.createElement('div'); groupActions.className = 'line-reorder-actions';
    const addGroup = document.createElement('button'); addGroup.type = 'button'; addGroup.textContent = t('line-panel.sac8e6b0'); addGroup.onclick = () => { const nameText = value(groupName); if (!nameText) return this.notify(t('line-panel.s5b44baa'), 'warning'); const next = [...names, nameText]; this.selectedGroup = next.length - 1; this.commit(t('line-panel.s761465f'), { ...chart, judgeLineGroup: next }); };
    const renameGroup = document.createElement('button'); renameGroup.type = 'button'; renameGroup.textContent = t('line-panel.s1cd80fd'); renameGroup.onclick = () => { const nameText = value(groupName); if (!nameText) return this.notify(t('line-panel.s5b44baa'), 'warning'); const next = [...names]; next[this.selectedGroup] = nameText; this.commit(t('line-panel.sf5a0c53'), { ...chart, judgeLineGroup: next }); };
    const deleteGroup = document.createElement('button'); deleteGroup.type = 'button'; deleteGroup.textContent = t('line-panel.s3755f56'); deleteGroup.disabled = this.selectedGroup === 0 || !names.length; deleteGroup.onclick = () => { const removed = this.selectedGroup; const next = names.filter((unused, index) => index !== removed); const linesNext = lines.map(line => { const current = lineGroupIndex(line); return { ...line, Group: current === removed ? 0 : current > removed ? current - 1 : current }; }); this.selectedGroup = 0; this.commit(t('line-panel.sb578476'), { ...chart, judgeLineGroup: next, judgeLineList: linesNext }); };
    groupActions.append(addGroup, renameGroup, deleteGroup); groups.append(groupActions); this.host.append(groups);
    list.scrollTop = scrollTop;
  }
}
