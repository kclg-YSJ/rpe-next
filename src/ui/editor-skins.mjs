import { localPreferences } from '../platform/local-preferences.mjs';
import { parseEditorSkin, resolveEditorSkin, EDITOR_SKIN_BUILTINS } from '../core/editor-skin.mjs';
import { importEditorSkin, readEditorSkins, storeEditorSkin, deleteEditorSkin, builtinEditorSkins, exportEditorSkin } from '../platform/editor-skins.mjs';
import { EditorSkinRuntime } from './editor-skin-runtime.mjs';
import { download } from '../platform/files.mjs';
import { assetUrl } from '../core/asset-url.mjs';
import { storageFailure } from '../platform/storage.mjs';
import { DEFAULT_APPEARANCE } from '../core/default-settings.mjs';
import { localizedValue, t } from '../i18n.mjs';

const ACTIVE_KEY = 'rpe-next-active-editor-skin-v1';
const OPTIONS_KEY = 'rpe-next-editor-skin-options-v1';
const action = (text, handler) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.onclick = handler; return button; };
export class EditorSkins {
  constructor(host, { invalidate, notify }) {
    this.host = host; this.invalidate = invalidate; this.notify = notify; this.records = new Map(); this.current = 'default'; this.generation = 0;
    try { this.options = JSON.parse(localPreferences.getItem(OPTIONS_KEY)) ?? structuredClone(DEFAULT_APPEARANCE.editorSkinOptions); if (typeof this.options !== 'object' || Array.isArray(this.options)) this.options = {}; } catch { this.options = structuredClone(DEFAULT_APPEARANCE.editorSkinOptions); }
    this.drafts = structuredClone(this.options); this.systemScheme = matchMedia('(prefers-color-scheme: dark)');
    this.systemScheme.addEventListener('change', () => { if (this.drafts[this.current]?.variant === 'auto') this.use(this.current, Boolean(this.previewTimer), true).catch(error => this.error(error)); });
    this.runtime = new EditorSkinRuntime(() => { document.dispatchEvent(new Event('rpen-editor-skin-changed')); invalidate(); });
    this.recovery = document.createElement('rpen-skin-recovery');
    this.recovery.style.cssText = 'position:fixed!important;right:12px!important;bottom:32px!important;z-index:2147483647!important;display:none!important;visibility:visible!important;opacity:1!important;';
    const shadow = this.recovery.attachShadow({ mode: 'closed' }); const sheet = new CSSStyleSheet();
    sheet.replaceSync(':host{font:12px system-ui;color:#182333}div{display:flex;align-items:center;gap:6px;padding:7px;border:1px solid #6b839d;border-radius:8px;background:#f5f8fc;box-shadow:0 2px 10px #0004}button{font:inherit;color:#132841;background:#fff;border:1px solid #7c8ea3;border-radius:5px;padding:5px 8px;cursor:pointer}span{max-width:190px}'); shadow.adoptedStyleSheets = [sheet];
    this.rescueText = document.createElement('span'); const controls = document.createElement('div');
    this.keep = action(t('editor-skins.sd046ac7'), () => this.confirmPreview()); this.keep.hidden = true;
    controls.append(this.rescueText, this.keep, action(t('editor-skins.sa191935'), () => this.reset())); shadow.append(controls); document.documentElement.append(this.recovery);
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
        catch (error) { this.message.textContent = t('editor-skins.s9698c79') + error.message; }
      }
      for (const id of new Set([...Object.keys(this.options), ...Object.keys(this.drafts)])) if (id !== 'default' && !installed.has(id)) { delete this.options[id]; delete this.drafts[id]; }
      this.persistOptions();
      this.updateOptions();
      const requestedDefault = new URL(location.href).searchParams.get('skin') === 'default';
      const id = requestedDefault ? 'default' : localPreferences.getItem(ACTIVE_KEY) ?? DEFAULT_APPEARANCE.editorSkin;
      if (id !== 'default' && this.records.has(id)) await this.use(id);
      else if (id !== 'default') { const message = t('editor-skins.s5c27763', { p0: id }); this.message.textContent = message; this.notify(message, 'warning'); localPreferences.setItem(ACTIVE_KEY, 'default'); }
    } catch (error) { this.message.textContent = t('editor-skins.sfa59f76') + error.message; this.notify(this.message.textContent, 'warning'); }
  }
  render() {
    this.host.replaceChildren(); const title = document.createElement('h3'); title.textContent = t('editor-skins.s92ce06a'); this.host.append(title);
    const field = document.createElement('label'); field.className = 'field'; field.append(t('editor-skins.s51fde62'));
    this.select = document.createElement('select'); this.select.id = 'editor-skin-select'; this.select.setAttribute('aria-label', t('editor-skins.s92ce06a')); field.append(this.select); this.host.append(field);
    this.select.onchange = () => this.showDetails();
    const controls = document.createElement('div'); controls.className = 'editor-skin-actions';
    this.zip = document.createElement('input'); this.zip.type = 'file'; this.zip.hidden = true; this.zip.accept = '.rpenskin,.zip'; this.zip.setAttribute('aria-label', t('editor-skins.s75d4966'));
    this.directory = document.createElement('input'); this.directory.type = 'file'; this.directory.hidden = true; this.directory.webkitdirectory = true; this.directory.multiple = true; this.directory.setAttribute('aria-label', t('editor-skins.s22c9603'));
    this.zip.onchange = () => this.importFiles(this.zip.files, false); this.directory.onchange = () => this.importFiles(this.directory.files, true);
    this.previewButton = action(t('editor-skins.sb467a66'), () => this.use(this.select.value, true).catch(error => this.error(error)));
    this.applyButton = action(t('editor-skins.s4562024'), () => this.use(this.select.value).catch(error => this.error(error)));
    this.exportButton = action(t('editor-skins.se4b1b6e'), () => { const record = this.records.get(this.select.value); if (record) download(exportEditorSkin(record), record.skin.id + '.rpenskin'); });
    this.deleteButton = action(t('editor-skins.saf73a77'), () => this.remove());
    this.resetParametersButton = action(t('editor-skins.s16b8238'), () => this.resetParameters(this.select.value).catch(error => this.error(error)));
    this.resetParametersButton.title = t('editor-skins.s2c06797');
    this.resetParametersButton.setAttribute('aria-keyshortcuts', 'Control+Alt+Shift+Backspace');
    this.reloadButton = action(t('editor-skins.sb4f0a01'), () => this.reloadDirectory()); this.reloadButton.disabled = true;
    controls.append(action(t('editor-skins.s0e9b4db'), () => this.zip.click()), action(t('editor-skins.s4d2d93e'), () => this.pickDirectory()), this.reloadButton, this.previewButton, this.applyButton, this.resetParametersButton, this.exportButton, this.deleteButton, action(t('editor-skins.se8dc775'), () => this.reset()));
    this.previewImage = document.createElement('img'); this.previewImage.className = 'editor-skin-preview'; this.previewImage.hidden = true; this.previewImage.alt = t('editor-skins.sc116089');
    this.appearance = document.createElement('div'); this.appearance.className = 'editor-skin-parameters';
    this.appearanceDisclosure = document.createElement('details'); this.appearanceDisclosure.className = 'editor-skin-options';
    const appearanceSummary = document.createElement('summary'); appearanceSummary.textContent = t('editor-skins.s9eb9e3f'); this.appearanceDisclosure.append(appearanceSummary, this.appearance);
    this.details = document.createElement('p'); this.details.className = 'hint'; this.message = document.createElement('p'); this.message.className = 'hint'; this.message.setAttribute('role', 'status');
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = t('editor-skins.s81d4766');
    this.host.append(controls, this.zip, this.directory, this.previewImage, this.appearanceDisclosure, this.details, this.message, hint); this.updateOptions();
  }
  updateOptions(selected = this.current) {
    this.select.replaceChildren(new Option(t('editor-skins.sa74af5e'), 'default'), ...[...this.records.values()].map(record => new Option(localizedValue(record.skin.name) + (record.skin.author ? `(${record.skin.author})` : ''), record.skin.id)));
    this.select.value = selected; if (!this.select.value) this.select.value = 'default'; this.showDetails();
  }
  showDetails() {
    const record = this.records.get(this.select.value);
    if (this.appearanceSkinId !== record?.skin.id) this.appearanceDisclosure.open = false;
    this.appearanceSkinId = record?.skin.id;
    this.appearanceDisclosure.hidden = !record || !Object.keys(record.skin.parameters ?? {}).length && !Object.keys(record.skin.variants ?? {}).length;
    this.details.textContent = record ? t('editor-skins.se33a04f', { p0: localizedValue(record.skin.description) ?? '', p1: record.skin.skinVersion ? ' · v' + record.skin.skinVersion : '', p2: record.skin.license ? ' · ' + localizedValue(record.skin.license) : '', p3: record.files.size, p4: (record.bytes / 1024).toFixed(1) }) : t('editor-skins.sfaf5d81');
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
      const variant = document.createElement('select'); variant.setAttribute('aria-label', t('editor-skins.s6fe6e96'));
      variant.append(new Option(t('editor-skins.s5900851'), 'base'), ...(record.skin.systemVariants ? [new Option(t('editor-skins.sfba49d2'), 'auto')] : []), ...Object.entries(record.skin.variants).map(([key, value]) => new Option(value.name, key)));
      variant.value = draft.variant; variant.onchange = () => { draft.variant = variant.value; change(); }; field(t('editor-skins.s4ce86dc'), variant);
    }
    for (const [key, definition] of Object.entries(record.skin.parameters ?? {})) {
      const label = localizedValue(definition.label);
      const input = document.createElement(definition.type === 'select' ? 'select' : 'input'); input.setAttribute('aria-label', label); input.dataset.skinParameter = key;
      if (definition.type === 'select') input.append(...Object.entries(definition.options).map(([value, label]) => new Option(localizedValue(label), value)));
      else input.type = definition.type === 'boolean' ? 'checkbox' : definition.type === 'number' ? 'number' : 'color';
      if (definition.type === 'number') { input.min = definition.min; input.max = definition.max; input.step = definition.step ?? 1; }
      const value = draft.parameters?.[key] ?? definition.default; input.value = value; if (definition.type === 'boolean') input.checked = value;
      input.onchange = () => { draft.parameters ??= {}; draft.parameters[key] = definition.type === 'boolean' ? input.checked : definition.type === 'number' ? Number(input.value) : input.value; change(); }; field(label, input);
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
        else { const file = await entry.getFile(); Object.defineProperty(file, 'webkitRelativePath', { value: prefix + entry.name }); files.push(file); if (files.length > 512) throw new Error(t('editor-skins.sd828666')); }
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
      if (existing?.builtin) throw new Error(t('editor-skins.s60057f5'));
      if (existing && existing.skin.id !== reloadingId && !confirm(t('editor-skins.s485b627', { p0: existing.skin.name }))) return;
      const prepared = await this.runtime.prepare({ ...record, skin: resolveEditorSkin(record.skin) });
      // Validate/decode everything before persisting or changing the UI.
      prepared.urls.forEach(url => URL.revokeObjectURL(url));
      await storeEditorSkin(record);
      if (!existing) this.clearAppearance(record.skin.id);
      this.records.set(record.skin.id, record); this.updateOptions(record.skin.id);
      if (directory && this.directoryHandle) { this.directoryId = record.skin.id; this.reloadButton.disabled = false; }
      this.message.textContent = t('editor-skins.s854daf1');
      if (reloadingId === record.skin.id && this.current === record.skin.id) await this.use(record.skin.id, true);
    } catch (error) { this.error(error); }
    finally { this.zip.value = ''; this.directory.value = ''; }
  }
  cancelPreview() { clearInterval(this.previewTimer); this.previewTimer = null; this.keep.hidden = true; this.previewId = null; this.recovery.style.setProperty('display', 'none', 'important'); }
  async use(id, preview = false, retainDeadline = false) {
    const generation = ++this.generation; const record = this.records.get(id);
    if (id !== 'default' && !record) throw new Error(t('editor-skins.s2e4d8b3'));
    const appearance = this.drafts[id] ??= structuredClone(this.options[id] ?? { variant: record?.skin.systemVariants ? 'auto' : 'base', parameters: {} });
    const resolvedVariant = appearance.variant === 'auto' ? record?.skin.systemVariants?.[this.systemScheme.matches ? 'dark' : 'light'] ?? 'base' : appearance.variant;
    const prepared = record ? await this.runtime.prepare({ ...record, skin: resolveEditorSkin(record.skin, { ...appearance, variant: resolvedVariant }) }) : null;
    if (generation !== this.generation) { prepared?.urls.forEach(url => URL.revokeObjectURL(url)); return; }
    const previousDeadline = this.deadline; const wasPreview = Boolean(this.previewTimer);
    this.cancelPreview(); this.runtime.apply(prepared); this.current = id; this.updateOptions(id);
    this.recovery.style.setProperty('display', preview ? 'block' : 'none', 'important');
    if (preview) {
      this.previewId = id; this.restoreId = localPreferences.getItem(ACTIVE_KEY) ?? 'default'; this.deadline = retainDeadline && wasPreview ? previousDeadline : Date.now() + 15000; this.keep.hidden = false;
      const update = () => {
        if (Date.now() >= this.deadline) { const restore = this.restoreId; this.drafts = structuredClone(this.options); this.cancelPreview(); this.use(this.records.has(restore) ? restore : 'default').catch(error => this.error(error)); return; }
        this.rescueText.textContent = t('editor-skins.sf2cc70b', { p0: Math.ceil((this.deadline - Date.now()) / 1000) });
      };
      update(); this.previewTimer = setInterval(update, 250);
    } else {
      this.options[id] = structuredClone(appearance);
      const optionsSaved = this.persistOptions(), activeSaved = this.persistValue(ACTIVE_KEY, id);
      this.rescueText.textContent = record?.skin.name ?? '';
      if (optionsSaved && activeSaved) this.message.textContent = id === 'default' ? t('editor-skins.s4a4bb7f') : t('editor-skins.s0dee9c3');
    }
  }
  confirmPreview() {
    if (this.previewId === null) return;
    const activeSaved = this.persistValue(ACTIVE_KEY, this.current); this.cancelPreview(); this.rescueText.textContent = this.records.get(this.current)?.skin.name ?? '';
    this.options[this.current] = structuredClone(this.drafts[this.current]); const optionsSaved = this.persistOptions();
    if (activeSaved && optionsSaved) this.message.textContent = t('editor-skins.s830b0f9');
  }
  reset() { this.use('default').catch(error => this.error(error)); }
  persistOptions() { return this.persistValue(OPTIONS_KEY, JSON.stringify(this.options)); }
  persistValue(key, value) {
    try { localPreferences.setItem(key, value); return true; }
    catch (error) { this.message.textContent = t('editor-skins.s6feb95b', { p0: storageFailure(error) }); this.notify(this.message.textContent, 'warning', 7000); return false; }
  }
  clearAppearance(id) { delete this.options[id]; delete this.drafts[id]; this.persistOptions(); }
  async resetParameters(id) {
    const record = this.records.get(id); if (!record) return;
    const draft = this.drafts[id] ?? this.options[id] ?? { variant: record.skin.systemVariants ? 'auto' : 'base' };
    const appearance = { ...draft, parameters: {} };
    this.drafts[id] = appearance;
    if (this.current === id) { this.cancelPreview(); await this.use(id); }
    else { this.options[id] = structuredClone(appearance); this.persistOptions(); if (this.select.value === id) this.showDetails(); }
    this.message.textContent = t('editor-skins.s0f800c0', { p0: record.skin.name });
  }
  async remove() {
    const id = this.select.value; const record = this.records.get(id); if (!record || record.builtin || !confirm(t('editor-skins.scfdb86a', { p0: record.skin.name }))) return;
    try {
      ++this.generation;
      if (this.current === id) await this.use('default');
      await deleteEditorSkin(id); this.records.delete(id); this.clearAppearance(id);
      if (localPreferences.getItem(ACTIVE_KEY) === id) localPreferences.setItem(ACTIVE_KEY, 'default');
      if (this.restoreId === id) this.restoreId = 'default';
      if (this.directoryId === id) { this.directoryId = null; this.directoryHandle = null; }
      this.updateOptions(); this.message.textContent = t('editor-skins.sf59aba4');
    }
    catch (error) { this.error(error); }
  }
}
