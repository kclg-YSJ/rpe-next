import { parseEditorSkin, resolveEditorSkin, EDITOR_SKIN_BUILTINS } from '../core/editor-skin.mjs';
import { importEditorSkin, readEditorSkins, storeEditorSkin, deleteEditorSkin, builtinEditorSkins, exportEditorSkin } from '../platform/editor-skins.mjs';
import { EditorSkinRuntime } from './editor-skin-runtime.mjs';
import { download } from '../platform/files.ts';
import { assetUrl } from '../core/asset-url.ts';

const ACTIVE_KEY = 'rpe-next-active-editor-skin-v1';
const OPTIONS_KEY = 'rpe-next-editor-skin-options-v1';
const action = (text, handler) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.onclick = handler; return button; };
export class EditorSkins {
  constructor(host, { invalidate, notify }) {
    this.host = host; this.invalidate = invalidate; this.notify = notify; this.records = new Map(); this.current = 'default'; this.generation = 0;
    try { this.options = JSON.parse(localStorage.getItem(OPTIONS_KEY)) ?? {}; if (typeof this.options !== 'object' || Array.isArray(this.options)) this.options = {}; } catch { this.options = {}; }
    this.drafts = structuredClone(this.options); this.systemScheme = matchMedia('(prefers-color-scheme: dark)');
    this.systemScheme.addEventListener('change', () => { if (this.drafts[this.current]?.variant === 'auto') this.use(this.current, Boolean(this.previewTimer), true).catch(error => this.error(error)); });
    this.runtime = new EditorSkinRuntime(() => { document.dispatchEvent(new Event('rpen-editor-skin-changed')); invalidate(); });
    this.recovery = document.createElement('rpen-skin-recovery');
    this.recovery.style.cssText = 'position:fixed!important;right:12px!important;bottom:32px!important;z-index:2147483647!important;display:none!important;visibility:visible!important;opacity:1!important;';
    const shadow = this.recovery.attachShadow({ mode: 'closed' }); const sheet = new CSSStyleSheet();
    sheet.replaceSync(':host{font:12px system-ui;color:#182333}div{display:flex;align-items:center;gap:6px;padding:7px;border:1px solid #6b839d;border-radius:8px;background:#f5f8fc;box-shadow:0 2px 10px #0004}button{font:inherit;color:#132841;background:#fff;border:1px solid #7c8ea3;border-radius:5px;padding:5px 8px;cursor:pointer}span{max-width:190px}'); shadow.adoptedStyleSheets = [sheet];
    this.rescueText = document.createElement('span'); const controls = document.createElement('div');
    this.keep = action('保留', () => this.confirmPreview()); this.keep.hidden = true;
    controls.append(this.rescueText, this.keep, action('恢复默认', () => this.reset())); shadow.append(controls); document.documentElement.append(this.recovery);
    window.addEventListener('keydown', event => {
      if (event.ctrlKey && event.shiftKey && event.altKey && event.key === 'F12') { event.preventDefault(); event.stopImmediatePropagation(); this.reset(); }
      else if (event.ctrlKey && event.shiftKey && event.altKey && event.key === 'Backspace' && !event.metaKey && !event.isComposing && this.records.has(this.current)) {
        event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) this.resetParameters(this.current).catch(error => this.error(error));
      }
    }, true);
    this.render(); this.ready = this.load();
  }
  async load() {
    try {
      for (const record of await builtinEditorSkins()) this.records.set(record.skin.id, record);
      const installed = new Set(this.records.keys());
      for (const stored of await readEditorSkins()) {
        installed.add(stored.id);
        try { const record = parseEditorSkin(new Map(stored.files)); if (!this.records.has(record.skin.id)) this.records.set(record.skin.id, record); }
        catch (error) { this.message.textContent = '有皮肤未能载入：' + error.message; }
      }
      for (const id of new Set([...Object.keys(this.options), ...Object.keys(this.drafts)])) if (id !== 'default' && !installed.has(id)) { delete this.options[id]; delete this.drafts[id]; }
      this.persistOptions();
      this.updateOptions();
      const requestedDefault = new URL(location.href).searchParams.get('skin') === 'default';
      const id = requestedDefault ? 'default' : localStorage.getItem(ACTIVE_KEY) ?? 'default';
      if (id !== 'default' && this.records.has(id)) await this.use(id);
      else if (id !== 'default') { const message = `找不到已保存的皮肤“${id}”，已恢复默认皮肤。`; this.message.textContent = message; this.notify(message, 'warning'); localStorage.setItem(ACTIVE_KEY, 'default'); }
    } catch (error) { this.message.textContent = '皮肤载入失败，使用默认：' + error.message; this.notify(this.message.textContent, 'warning'); }
  }
  render() {
    this.host.replaceChildren(); const title = document.createElement('h3'); title.textContent = '编辑器皮肤'; this.host.append(title);
    const field = document.createElement('label'); field.className = 'field'; field.append('当前皮肤');
    this.select = document.createElement('select'); this.select.id = 'editor-skin-select'; this.select.setAttribute('aria-label', '编辑器皮肤'); field.append(this.select); this.host.append(field);
    this.select.onchange = () => this.showDetails();
    const controls = document.createElement('div'); controls.className = 'editor-skin-actions';
    this.zip = document.createElement('input'); this.zip.type = 'file'; this.zip.hidden = true; this.zip.accept = '.rpenskin,.zip'; this.zip.setAttribute('aria-label', '导入编辑器皮肤包');
    this.directory = document.createElement('input'); this.directory.type = 'file'; this.directory.hidden = true; this.directory.webkitdirectory = true; this.directory.multiple = true; this.directory.setAttribute('aria-label', '导入编辑器皮肤目录');
    this.zip.onchange = () => this.importFiles(this.zip.files, false); this.directory.onchange = () => this.importFiles(this.directory.files, true);
    this.previewButton = action('预览 15 秒', () => this.use(this.select.value, true).catch(error => this.error(error)));
    this.applyButton = action('应用', () => this.use(this.select.value).catch(error => this.error(error)));
    this.exportButton = action('导出皮肤', () => { const record = this.records.get(this.select.value); if (record) download(exportEditorSkin(record), record.skin.id + '.rpenskin'); });
    this.deleteButton = action('删除皮肤', () => this.remove());
    this.resetParametersButton = action('恢复此皮肤原始参数', () => this.resetParameters(this.select.value).catch(error => this.error(error)));
    this.resetParametersButton.title = '清除这套皮肤的参数修改，保留皮肤与当前变体 · Ctrl+Alt+Shift+Backspace 恢复正在使用的皮肤参数';
    this.resetParametersButton.setAttribute('aria-keyshortcuts', 'Control+Alt+Shift+Backspace');
    this.reloadButton = action('重读开发目录', () => this.reloadDirectory()); this.reloadButton.disabled = true;
    controls.append(action('导入皮肤包', () => this.zip.click()), action('导入文件夹', () => this.pickDirectory()), this.reloadButton, this.previewButton, this.applyButton, this.resetParametersButton, this.exportButton, this.deleteButton, action('恢复默认皮肤', () => this.reset()));
    this.previewImage = document.createElement('img'); this.previewImage.className = 'editor-skin-preview'; this.previewImage.hidden = true; this.previewImage.alt = '所选皮肤预览';
    this.appearance = document.createElement('div'); this.appearance.className = 'editor-skin-parameters';
    this.details = document.createElement('p'); this.details.className = 'hint'; this.message = document.createElement('p'); this.message.className = 'hint'; this.message.setAttribute('role', 'status');
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = '皮肤只保存在本机，不随谱面分享。预览 15 秒后自动复原；Ctrl+Alt+Shift+Backspace 恢复当前皮肤原始参数；Ctrl+Alt+Shift+F12 切回默认皮肤。';
    this.host.append(controls, this.zip, this.directory, this.previewImage, this.appearance, this.details, this.message, hint); this.updateOptions();
  }
  updateOptions(selected = this.current) {
    this.select.replaceChildren(new Option('默认皮肤', 'default'), ...[...this.records.values()].map(record => new Option(record.skin.name + (record.skin.author ? `(${record.skin.author})` : ''), record.skin.id)));
    this.select.value = selected; if (!this.select.value) this.select.value = 'default'; this.showDetails();
  }
  showDetails() {
    const record = this.records.get(this.select.value);
    this.details.textContent = record ? `${record.skin.description ?? ''}${record.skin.skinVersion ? ' · v' + record.skin.skinVersion : ''}${record.skin.license ? ' · ' + record.skin.license : ''} · ${record.files.size} 个文件 · ${(record.bytes / 1024).toFixed(1)} KiB` : '编辑器原有外观与布局。';
    this.deleteButton.disabled = !record || Boolean(record.builtin); this.exportButton.disabled = !record;
    this.resetParametersButton.disabled = !record || !Object.keys(record.skin.parameters ?? {}).length;
    this.reloadButton.disabled = !this.directoryHandle || this.directoryId !== record?.skin.id;
    if (this.previewUrl) { URL.revokeObjectURL(this.previewUrl); this.previewUrl = null; }
    const preview = record?.skin.assets?.[record.skin.preview]; this.previewImage.hidden = !preview;
    if (preview?.path) { this.previewUrl = URL.createObjectURL(new Blob([record.files.get(preview.path)], { type: preview.path.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/' + preview.path.split('.').at(-1).toLowerCase().replace('jpg', 'jpeg') })); this.previewImage.src = this.previewUrl; }
    else if (preview?.builtin) this.previewImage.src = assetUrl(EDITOR_SKIN_BUILTINS[preview.builtin]);
    this.appearance.replaceChildren(); if (!record) return;
    const id = record.skin.id; const draft = this.drafts[id] ??= { variant: record.skin.systemVariants ? 'auto' : 'base', parameters: {} };
    const change = () => { if (this.current === id) this.use(id, true).catch(error => this.error(error)); };
    const field = (label, input) => { const row = document.createElement('label'); row.className = 'field'; row.append(label, input); this.appearance.append(row); };
    if (Object.keys(record.skin.variants ?? {}).length) {
      const variant = document.createElement('select'); variant.setAttribute('aria-label', '皮肤变体');
      variant.append(new Option('基础外观', 'base'), ...(record.skin.systemVariants ? [new Option('跟随系统明暗', 'auto')] : []), ...Object.entries(record.skin.variants).map(([key, value]) => new Option(value.name, key)));
      variant.value = draft.variant; variant.onchange = () => { draft.variant = variant.value; change(); }; field('外观变体', variant);
    }
    for (const [key, definition] of Object.entries(record.skin.parameters ?? {})) {
      const input = document.createElement(definition.type === 'select' ? 'select' : 'input'); input.setAttribute('aria-label', definition.label); input.dataset.skinParameter = key;
      if (definition.type === 'select') input.append(...Object.entries(definition.options).map(([value, label]) => new Option(label, value)));
      else input.type = definition.type === 'boolean' ? 'checkbox' : definition.type === 'number' ? 'number' : 'color';
      if (definition.type === 'number') { input.min = definition.min; input.max = definition.max; input.step = definition.step ?? 1; }
      const value = draft.parameters?.[key] ?? definition.default; input.value = value; if (definition.type === 'boolean') input.checked = value;
      input.onchange = () => { draft.parameters ??= {}; draft.parameters[key] = definition.type === 'boolean' ? input.checked : definition.type === 'number' ? Number(input.value) : input.value; change(); }; field(definition.label, input);
    }
  }
  async pickDirectory() {
    if (!window.showDirectoryPicker) { this.directory.click(); return; }
    try { this.directoryHandle = await window.showDirectoryPicker({ mode: 'read' }); await this.reloadDirectory(); }
    catch (error) { if (error.name !== 'AbortError') this.error(error); }
  }
  async reloadDirectory() {
    if (!this.directoryHandle) return;
    try {
      const files = []; const visit = async (directory, prefix = '') => { for await (const entry of directory.values()) {
        if (entry.kind === 'directory') await visit(entry, prefix + entry.name + '/');
        else { const file = await entry.getFile(); Object.defineProperty(file, 'webkitRelativePath', { value: prefix + entry.name }); files.push(file); if (files.length > 512) throw new Error('皮肤文件数量超限'); }
      } };
      await visit(this.directoryHandle); await this.importFiles(files, true, this.directoryId);
    } catch (error) { this.error(error); }
  }
  error(error) { this.message.textContent = error.message; this.notify(error.message, 'error'); }
  async importFiles(files, directory, reloadingId = null) {
    if (!files.length) return;
    try {
      const record = await importEditorSkin(files, directory);
      const existing = this.records.get(record.skin.id);
      if (existing?.builtin) throw new Error('导入皮肤不能覆盖内置皮肤标识');
      if (existing && existing.skin.id !== reloadingId && !confirm(`替换皮肤“${existing.skin.name}”？`)) return;
      const prepared = await this.runtime.prepare({ ...record, skin: resolveEditorSkin(record.skin) });
      // Validate/decode everything before persisting or changing the UI.
      prepared.urls.forEach(url => URL.revokeObjectURL(url));
      await storeEditorSkin(record);
      if (!existing) this.clearAppearance(record.skin.id);
      this.records.set(record.skin.id, record); this.updateOptions(record.skin.id);
      if (directory && this.directoryHandle) { this.directoryId = record.skin.id; this.reloadButton.disabled = false; }
      this.message.textContent = '皮肤已导入，可先预览，再应用。';
      if (reloadingId === record.skin.id && this.current === record.skin.id) await this.use(record.skin.id, true);
    } catch (error) { this.error(error); }
    finally { this.zip.value = ''; this.directory.value = ''; }
  }
  cancelPreview() { clearInterval(this.previewTimer); this.previewTimer = null; this.keep.hidden = true; this.previewId = null; this.recovery.style.setProperty('display', 'none', 'important'); }
  async use(id, preview = false, retainDeadline = false) {
    const generation = ++this.generation; const record = this.records.get(id);
    if (id !== 'default' && !record) throw new Error('皮肤不存在');
    const appearance = this.drafts[id] ??= structuredClone(this.options[id] ?? { variant: record?.skin.systemVariants ? 'auto' : 'base', parameters: {} });
    const resolvedVariant = appearance.variant === 'auto' ? record?.skin.systemVariants?.[this.systemScheme.matches ? 'dark' : 'light'] ?? 'base' : appearance.variant;
    const prepared = record ? await this.runtime.prepare({ ...record, skin: resolveEditorSkin(record.skin, { ...appearance, variant: resolvedVariant }) }) : null;
    if (generation !== this.generation) { prepared?.urls.forEach(url => URL.revokeObjectURL(url)); return; }
    const previousDeadline = this.deadline; const wasPreview = Boolean(this.previewTimer);
    this.cancelPreview(); this.runtime.apply(prepared); this.current = id; this.updateOptions(id);
    this.recovery.style.setProperty('display', preview ? 'block' : 'none', 'important');
    if (preview) {
      this.previewId = id; this.restoreId = localStorage.getItem(ACTIVE_KEY) ?? 'default'; this.deadline = retainDeadline && wasPreview ? previousDeadline : Date.now() + 15000; this.keep.hidden = false;
      const update = () => {
        if (Date.now() >= this.deadline) { const restore = this.restoreId; this.drafts = structuredClone(this.options); this.cancelPreview(); this.use(this.records.has(restore) ? restore : 'default').catch(error => this.error(error)); return; }
        this.rescueText.textContent = `预览中 · ${Math.ceil((this.deadline - Date.now()) / 1000)} 秒后复原`;
      };
      update(); this.previewTimer = setInterval(update, 250);
    } else { this.options[id] = structuredClone(appearance); this.persistOptions(); localStorage.setItem(ACTIVE_KEY, id); this.rescueText.textContent = record?.skin.name ?? ''; this.message.textContent = id === 'default' ? '已恢复默认皮肤。' : '已应用，重新打开编辑器后会恢复此皮肤。'; }
  }
  confirmPreview() {
    if (this.previewId === null) return;
    localStorage.setItem(ACTIVE_KEY, this.current); this.cancelPreview(); this.rescueText.textContent = this.records.get(this.current)?.skin.name ?? '';
    this.options[this.current] = structuredClone(this.drafts[this.current]); this.persistOptions();
    this.message.textContent = '已保留当前皮肤。';
  }
  reset() { this.use('default').catch(error => this.error(error)); }
  persistOptions() { localStorage.setItem(OPTIONS_KEY, JSON.stringify(this.options)); }
  clearAppearance(id) { delete this.options[id]; delete this.drafts[id]; this.persistOptions(); }
  async resetParameters(id) {
    const record = this.records.get(id); if (!record) return;
    const draft = this.drafts[id] ?? this.options[id] ?? { variant: record.skin.systemVariants ? 'auto' : 'base' };
    const appearance = { ...draft, parameters: {} };
    this.drafts[id] = appearance;
    if (this.current === id) { this.cancelPreview(); await this.use(id); }
    else { this.options[id] = structuredClone(appearance); this.persistOptions(); if (this.select.value === id) this.showDetails(); }
    this.message.textContent = `已恢复“${record.skin.name}”的原始参数，当前变体保持不变。`;
  }
  async remove() {
    const id = this.select.value; const record = this.records.get(id); if (!record || record.builtin || !confirm(`删除皮肤“${record.skin.name}”？`)) return;
    try {
      ++this.generation;
      if (this.current === id) await this.use('default');
      await deleteEditorSkin(id); this.records.delete(id); this.clearAppearance(id);
      if (localStorage.getItem(ACTIVE_KEY) === id) localStorage.setItem(ACTIVE_KEY, 'default');
      if (this.restoreId === id) this.restoreId = 'default';
      if (this.directoryId === id) { this.directoryId = null; this.directoryHandle = null; }
      this.updateOptions(); this.message.textContent = '已删除皮肤及其参数设置。';
    }
    catch (error) { this.error(error); }
  }
}
