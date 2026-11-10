import { control, distributionFields } from './multi-edit.mjs';
import { BATCH_OPERATIONS, EVENT_BATCH_FIELDS } from '../application/multi-edit.mjs';
import { MultiEditParameters } from '../application/multi-edit-parameters.mjs';
import { captureNoiseEdit, previewNoiseEdit, noiseEventTool, applyNoiseEdit, NOISE_EDIT_TYPES, NOISE_POSITION_TYPES, isNoisePositionType } from '../application/noise-edit.mjs';
import { localPreferences } from '../platform/local-preferences.mjs';
import { t } from '../i18n.mjs';

const node = (tag, text, className = '') => { const value = document.createElement(tag); value.textContent = text; value.className = className; return value; };
const button = (title, run) => { const value = node('button', title); value.type = 'button'; value.onclick = run; return value; };
export class NoiseMultiEditPanel {
  constructor(root, editor) { this.root = root; this.editor = editor; this.stores = new Map(); }
  signature(snapshot) { return `${snapshot.area}/${[...snapshot.keys].sort().join('|')}/${this.editor.context.timeline.division}`; }
  open(snapshot) {
    if (this.committing) return;
    const signature = this.signature(snapshot);
    if (this.active && this.mode === snapshot.mode) {
      if (this.signatureValue !== signature || this.source !== snapshot.chart) { this.snapshot = snapshot; this.signatureValue = signature; this.source = snapshot.chart; this.refresh(); }
      return;
    }
    this.active = true; this.mode = snapshot.mode; this.snapshot = snapshot; this.signatureValue = signature; this.source = snapshot.chart;
    const areas = snapshot.mode === 'areas', root = this.root; root.replaceChildren();
    root.append(node('div', t(areas ? 'noise-batch.areas' : 'noise-batch.events'), 'panel-title'));
    const storeKey = 'rpe-next-noise-batch-' + snapshot.mode;
    if (!this.stores.has(storeKey)) this.stores.set(storeKey, new MultiEditParameters({ getItem: () => localPreferences.getItem(storeKey), setItem: (key, value) => localPreferences.setItem(storeKey, value) }, message => this.editor.notify(message, 'warning')));
    const parameters = this.stores.get(storeKey);
    const saved = node('details', '', 'batch-parameters'); saved.append(node('summary', t('multi-edit.s3f5d14d'))); root.append(saved);
    const history = control(saved, t('multi-edit.s0b6d227'), '', []), favorites = control(saved, t('multi-edit.s5cfcddd'), '', []), name = control(saved, t('multi-edit.s480d10d'), ''); name.maxLength = 80;
    const savedActions = node('div', '', 'action-grid'); saved.append(savedActions);
    const updateHistory = () => {
      history.replaceChildren(new Option(t('multi-edit.s1900e17'), ''), ...parameters.history.events.map((entry, i) => new Option(`${i + 1} · ${entry.operation} ${entry.lower}…${entry.upper}`, i)));
      favorites.replaceChildren(new Option(t('multi-edit.se3c12de'), ''), ...parameters.saved.events.map(entry => new Option(entry.name, entry.name)));
    };
    history.onchange = () => { if (history.value !== '') this.load(parameters.history.events[Number(history.value)]); };
    favorites.onchange = () => { const entry = parameters.saved.events.find(entry => entry.name === favorites.value); if (entry) { name.value = entry.name; this.load(entry.value); } };
    savedActions.append(button(t('multi-edit.sd8dad8b'), () => { try { parameters.save('events', name.value, this.read()); updateHistory(); } catch (error) { this.editor.report(error); } }), button(t('multi-edit.se1b4c1f'), () => { parameters.remove('events', favorites.value); updateHistory(); })); updateHistory();
    const mode = control(root, t('multi-edit.s1640f9b'), 'form', [['form', t('multi-edit.s9537636')], ['script', t('multi-edit.s5fce32d')]]);
    const filter = control(root, t(areas ? 'noise-batch.target' : 'multi-edit.s1eefde9'), areas ? 'moveXEvents' : 'all', [...(areas ? [] : [['all', t('multi-edit.s778fc8f')]]), ...NOISE_EDIT_TYPES, ...(areas ? NOISE_POSITION_TYPES : [])]);
    const field = areas ? null : control(root, t('multi-edit.s575aeda'), 'both', EVENT_BATCH_FIELDS.filter(([key]) => key !== 'line'));
    const condition = control(root, t('multi-edit.se9d5ab4'), '');
    const operation = control(root, t('multi-edit.s1645ef4'), 'By', BATCH_OPERATIONS);
    const form = node('div', ''); root.append(form); const distribution = distributionFields(form);
    const scriptBox = node('details', ''); scriptBox.open = true; scriptBox.append(node('summary', t('multi-edit.s5fce32d')));
    const script = node('textarea', '', 'batch-script'); script.rows = 6; script.setAttribute('aria-label', t('multi-edit.s79d5c05')); scriptBox.append(script, node('p', t(areas ? 'noise-batch.areaScript' : 'noise-batch.eventScript'), 'hint')); root.append(scriptBox);
    const areaHint = areas ? node('p', t('noise-batch.areaHint'), 'hint') : null;
    if (areas) root.append(areaHint);
    else {
      const tools = node('div', '', 'action-grid'); root.append(tools);
      for (const [action, title] of [['cut', 'multi-edit.sa18ddc2'], ['stick', 'multi-edit.s086e390']]) tools.append(button(t(title), () => {
        try { const result = noiseEventTool(captureNoiseEdit(this.editor), action, { division: this.editor.context.timeline.division, density: this.editor.context.session.cutDensity, beat: this.editor.context.timeline.origin, tempo: this.editor.context.tempo }); this.committing = true; if (!applyNoiseEdit(this.editor, result, t(title))) this.editor.notify(t('event-tools.s955964e'), 'warning'); }
        catch (error) { this.editor.report(error); }
        finally { this.committing = false; this.editor.render(); }
      }));
    }
    root.append(button(t('multi-edit.sd364fde'), () => { this.seed++; changed(); }));
    this.summary = node('p', '', 'hint'); this.summary.setAttribute('role', 'status'); root.append(this.summary);
    const previewLabel = node('label', '', 'batch-preview-toggle'); this.preview = document.createElement('input'); this.preview.type = 'checkbox'; this.preview.checked = true; previewLabel.append(this.preview, t('multi-edit.s00b7dd3')); root.append(previewLabel);
    const actions = node('div', '', 'action-grid batch-panel-actions'); root.append(actions);
    this.apply = button(t('multi-edit.sb3144a8'), () => {
      if (!this.result) return;
      this.committing = true;
      try {
        const count = this.result.changes.length;
        const options = this.read(), label = this.mode === 'areas' && isNoisePositionType(options.eventType) ? t('noise-batch.positionApply') : undefined;
        if (applyNoiseEdit(this.editor, this.result, label)) { parameters.remember('events', options); updateHistory(); this.source = this.editor.context.session.chart; this.snapshot = captureNoiseEdit(this.editor); this.signatureValue = this.signature(this.snapshot); this.result = null; this.summary.textContent = t('multi-edit.s60014d9', { p0: count }); this.apply.disabled = true; }
      } catch (error) { this.editor.report(error); }
      finally { this.committing = false; this.editor.invalidate(); }
    }); this.apply.className = 'primary';
    actions.append(this.apply, button(t('multi-edit.sb1a4621'), () => { parameters.reset('events'); this.load(parameters.read('events')); }), button(t('noise-area.sfe06303'), () => this.editor.activate('noise')));
    this.read = () => ({ ...distribution(), mode: mode.value, field: field?.value ?? 'both', eventType: filter.value, operation: operation.value, condition: condition.value, script: script.value, seed: this.seed });
    const changed = () => {
      form.hidden = mode.value === 'script'; scriptBox.hidden = mode.value !== 'script'; operation.closest('label').hidden = !areas && mode.value === 'script';
      if (areaHint) areaHint.textContent = t(isNoisePositionType(filter.value) ? 'noise-batch.positionHint' : 'noise-batch.areaHint');
      parameters.update('events', this.read()); this.refresh();
    };
    this.load = value => {
      mode.value = value.mode === 'script' ? 'script' : 'form'; filter.value = value.eventType;
      if (!filter.value) filter.value = areas ? 'moveXEvents' : 'all';
      if (field) { field.value = value.field; if (!field.value) field.value = 'both'; }
      operation.value = value.operation; condition.value = value.condition ?? ''; script.value = value.script || (areas ? 'value = 100 * n;' : 'start += 20 * sin(u * pi);\nend += 20 * sin(u * pi);');
      if (areas && !value.script?.includes('value')) script.value = 'value = 100 * n;';
      this.seed = value.seed ?? 1; distribution.write(value); changed();
    };
    root.oninput = event => { if (!saved.contains(event.target)) changed(); };
    this.load(parameters.read('events'));
  }
  refresh() {
    this.result = null;
    try { const options = this.read(); this.result = previewNoiseEdit(this.snapshot, options); this.summary.textContent = t(this.mode === 'areas' && isNoisePositionType(options.eventType) ? 'noise-batch.positionPreview' : 'noise-batch.preview', { count: this.result.changes.length }); this.summary.classList.remove('batch-error'); }
    catch (error) { this.summary.textContent = error.message; this.summary.classList.add('batch-error'); }
    this.apply.disabled = !this.result; this.editor.invalidate();
  }
  get previewChart() { return this.active && this.preview.checked && this.result?.source === this.editor.context.session.chart ? this.result.chart : null; }
  hide() { this.active = false; this.result = null; this.root.oninput = null; }
}
