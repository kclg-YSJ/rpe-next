import { stringifyPreservingNumbers } from '../core/chart.mjs';
import { t } from '../i18n.mjs';

const modal = document.querySelector('#modal');
const content = document.querySelector('#modal-content');
const apply = document.querySelector('#modal-apply');
const remove = document.querySelector('#modal-delete');
const error = document.querySelector('#modal-error');

export function showDialog(title, description) {
  if (modal.open) modal.close();
  document.querySelector('#modal-title').textContent = title;
  document.querySelector('#modal-description').textContent = description;
  error.textContent = '';
  content.replaceChildren();
  apply.hidden = true;
  apply.disabled = false;
  apply.textContent = t('dialog.s4562024');
  remove.hidden = true;
  apply.onclick = null;
  remove.onclick = null;
  modal.showModal();
  return content;
}

export function editJson(title, description, value, onApply, onDelete) {
  showDialog(title, description);
  const textarea = document.createElement('textarea');
  textarea.setAttribute('aria-label', title + ' JSON');
  textarea.value = stringifyPreservingNumbers(value);
  textarea.spellcheck = false;
  content.append(textarea);
  apply.hidden = false;
  apply.onclick = () => {
    try { onApply(JSON.parse(textarea.value)); modal.close(); }
    catch (failure) { error.textContent = failure.message; }
  };
  if (onDelete) {
    remove.hidden = false;
    remove.onclick = () => {
      try { onDelete(); modal.close(); }
      catch (failure) { showDialog(t('dialog.s223fb3c'), failure.message); }
    };
  }
}

export function choose(title, description, entries, label, onChoose) {
  showDialog(title, description);
  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.textContent = label(entry);
    button.onclick = async () => {
      try { modal.close(); await onChoose(entry); }
      catch (failure) { showDialog(t('dialog.s223fb3c'), failure.message); }
    };
    content.append(button);
  }
}

export function confirmAction(title, action) {
  showDialog(title, t('dialog.s47a52ce'));
  apply.hidden = false;
  apply.onclick = () => { modal.close(); action(); };
}

export function dialogOpen() { return Boolean(modal.open || document.querySelector('dialog[open]')); }

