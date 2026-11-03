import { assignChartImportFiles, chartImportAccept, chartImportFiles, isChartImportFile } from '../platform/chart-import.mjs';
import { t } from '../i18n.mjs';

export function showImportDialog({ readFiles, onOpen, onError, onLargePreview }) {
  const existing = document.querySelector('#chart-import-dialog');
  if (existing?.open) return existing;
  const dialog = document.createElement('dialog'); dialog.id = 'chart-import-dialog'; dialog.className = 'chart-import-dialog';
  dialog.setAttribute('aria-labelledby', 'chart-import-title');
  const heading = document.createElement('div'); heading.className = 'modal-heading';
  const title = document.createElement('h2'); title.id = 'chart-import-title'; title.textContent = t('chart-import.title');
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', t('chart-import.cancel')); close.onclick = () => dialog.close();
  heading.append(title, close);
  const description = document.createElement('p'); description.className = 'hint'; description.textContent = t('chart-import.description');
  const status = document.createElement('p'); status.className = 'chart-import-status'; status.id = 'chart-import-status'; status.setAttribute('aria-live', 'polite');
  const actions = document.createElement('div'); actions.className = 'modal-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = t('chart-import.cancel'); cancel.onclick = () => dialog.close();
  const open = document.createElement('button'); open.id = 'chart-import-open'; open.type = 'button'; open.className = 'primary'; open.textContent = t('chart-import.open'); open.setAttribute('aria-describedby', status.id);
  actions.append(cancel, open);
  if (globalThis.rpenLargePreview?.version === 1 && onLargePreview) {
    const large = document.createElement('button'); large.type = 'button'; large.id = 'chart-import-large-preview'; large.textContent = t('large-chart.entry');
    large.onclick = () => { if (busy) return; dialog.close(); onLargePreview(); }; actions.prepend(large);
  }
  dialog.append(heading, description);
  let mode = 'pez', busy = false;
  const selected = {}, groups = new Map(), slots = new Map();
  let batchButton, additionalSummary;
  const sync = () => {
    if (batchButton) batchButton.disabled = busy;
    if (additionalSummary) {
      const files = selected.additional ?? [];
      additionalSummary.hidden = !files.length;
      additionalSummary.textContent = t('chart-import.additional', { files: files.map(file => file.name).join('、') });
    }
    for (const [value, { group, radio }] of groups) {
      radio.checked = mode === value; radio.disabled = busy; group.dataset.active = String(mode === value);
    }
    for (const [kind, { button, name, input }] of slots) {
      const file = selected[kind]; name.textContent = file?.name ?? t('chart-import.empty'); name.title = file?.name ?? '';
      button.disabled = input.disabled = busy; button.classList.toggle('has-file', Boolean(file));
      button.setAttribute('aria-invalid', String(Boolean(file && !isChartImportFile(kind, file))));
    }
    open.textContent = t(busy ? 'chart-import.opening' : 'chart-import.open');
    try {
      chartImportFiles(mode, selected); open.disabled = busy;
      status.textContent = t(busy ? 'chart-import.opening' : 'chart-import.ready');
      status.classList.remove('error');
    } catch (error) {
      open.disabled = true; status.textContent = error.message; status.classList.remove('error');
    }
  };
  const applySeparateFiles = (input, preferredKind) => {
    const files = [...input.files];
    if (!files.length) return;
    mode = 'separate'; input.value = '';
    try { Object.assign(selected, assignChartImportFiles(files, selected, files.length === 1 ? preferredKind : undefined)); sync(); }
    catch (error) { sync(); status.textContent = error.message; status.classList.add('error'); }
  };
  for (const [value, kinds] of [['pez', ['pez']], ['separate', ['json', 'music', 'cover']]]) {
    const group = document.createElement('fieldset'); group.className = 'chart-import-option'; group.dataset.mode = value;
    const legend = document.createElement('legend'); const label = document.createElement('label');
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'chart-import-mode'; radio.value = value;
    radio.onchange = () => { mode = value; sync(); };
    label.append(radio, t('chart-import.mode.' + value)); legend.append(label); group.append(legend);
    if (value === 'separate') {
      const toolbar = document.createElement('div'); toolbar.className = 'chart-import-batch';
      batchButton = document.createElement('button'); batchButton.type = 'button'; batchButton.id = 'chart-import-batch'; batchButton.textContent = t('chart-import.batch');
      const batchInput = document.createElement('input'); batchInput.type = 'file'; batchInput.hidden = true; batchInput.multiple = true; batchInput.id = 'chart-import-batch-input'; batchInput.setAttribute('aria-label', t('chart-import.batch'));
      batchInput.onchange = () => applySeparateFiles(batchInput);
      batchButton.onclick = () => { mode = value; sync(); batchInput.click(); };
      const hint = document.createElement('span'); hint.textContent = t('chart-import.batchHint');
      toolbar.append(batchButton, hint, batchInput); group.append(toolbar);
    }
    const grid = document.createElement('div'); grid.className = 'chart-import-slots'; group.append(grid);
    groups.set(value, { group, radio });
    for (const kind of kinds) {
      const slot = document.createElement('div'); slot.className = 'chart-import-slot';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'chart-import-file'; button.dataset.kind = kind;
      const fieldTitle = document.createElement('strong'); fieldTitle.textContent = t('chart-import.' + kind) + (kind === 'music' || kind === 'cover' ? t('chart-import.optional') : '');
      const name = document.createElement('span'); name.className = 'chart-import-filename';
      const choose = document.createElement('span'); choose.className = 'chart-import-choose'; choose.textContent = t(value === 'separate' ? 'chart-import.selectMultiple' : 'chart-import.select');
      button.append(fieldTitle, name, choose);
      const input = document.createElement('input'); input.type = 'file'; input.hidden = true; input.id = 'chart-import-' + kind;
      input.multiple = value === 'separate';
      input.setAttribute('aria-label', t('chart-import.' + kind));
      const accept = chartImportAccept(value === 'separate' ? 'separate' : kind); if (accept) input.accept = accept;
      button.onclick = () => { mode = value; sync(); input.click(); };
      input.onchange = () => {
        if (value === 'separate') { applySeparateFiles(input, kind); return; }
        const files = [...input.files];
        if (!files.length) return;
        mode = value;
        input.value = '';
        try {
          if (files.length !== 1) throw Error(t('chart-import.single'));
          if (!isChartImportFile(kind, files[0])) throw Error(t('chart-import.invalid', { kind: t('chart-import.' + kind), name: files[0].name }));
          selected[kind] = files[0];
          sync();
        } catch (error) {
          sync(); status.textContent = error.message; status.classList.add('error');
        }
      };
      slots.set(kind, { button, name, input }); slot.append(button, input); grid.append(slot);
    }
    if (value === 'separate') {
      additionalSummary = document.createElement('p'); additionalSummary.className = 'chart-import-status'; additionalSummary.id = 'chart-import-additional';
      group.append(additionalSummary);
    }
    dialog.append(group);
  }
  dialog.append(status, actions);
  open.onclick = async () => {
    if (busy) return;
    try { chartImportFiles(mode, selected); }
    catch (error) { status.textContent = error.message; status.classList.add('error'); return; }
    busy = true; sync();
    try {
      const loaded = await readFiles(mode, { ...selected });
      if (!dialog.open) return;
      dialog.close();
      try { onOpen(loaded); } catch (error) { onError?.(error); }
    } catch (error) {
      if (!dialog.open) return;
      busy = false; sync(); status.textContent = error.message; status.classList.add('error');
    }
  };
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog); sync(); dialog.showModal();
  return dialog;
}
