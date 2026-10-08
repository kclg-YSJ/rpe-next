import { stringifyPreservingNumbers } from '../core/chart.ts';

// The modal chrome lives in `index.html`, so these lookups run once at module load. Each is typed
// to the element the markup provides rather than the generic `Element` a bare query returns.
const modal = document.querySelector('#modal') as HTMLDialogElement;
const content = document.querySelector('#modal-content') as HTMLElement;
const apply = document.querySelector('#modal-apply') as HTMLButtonElement;
const remove = document.querySelector('#modal-delete') as HTMLButtonElement;
const error = document.querySelector('#modal-error') as HTMLElement;

/** Reads a required modal element by selector, throwing the same way a missing one would as `null`. */
function modalElement<T extends Element>(selector: string): T {
  const element = document.querySelector(selector) as T | null;
  if (!element) throw new Error(`缺少模态框元素 ${selector}`);
  return element;
}

/** Narrows a caught value to its message; `catch` binds `unknown` under `strict`. */
function failureMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

export function showDialog(title: string, description: string): HTMLElement {
  if (modal.open) modal.close();
  modalElement<HTMLElement>('#modal-title').textContent = title;
  modalElement<HTMLElement>('#modal-description').textContent = description;
  error.textContent = '';
  content.replaceChildren();
  apply.hidden = true;
  apply.disabled = false;
  apply.textContent = '应用';
  remove.hidden = true;
  apply.onclick = null;
  remove.onclick = null;
  modal.showModal();
  return content;
}

/**
 * The preferences document `editJson` is used to edit.
 *
 * Declared structurally rather than imported from `core/preferences.ts` so this module stays
 * dependency-free: the only fields the JSON editor's apply handler reaches for are the three the
 * migration record round-trips, and everything else in the document is carried through untouched.
 * `core/preferences.ts` returns a wider object, which is assignable to this.
 */
export interface EditablePreferences {
  originalSettings: unknown;
  originalHotkeys: Record<string, unknown>;
  originalUI: string;
  [key: string]: unknown;
}

/**
 * The parsed JSON an `editJson` apply handler receives.
 *
 * `JSON.parse` can produce anything the user typed, so there is no honest narrower type than
 * `EditablePreferences`; handlers that need more structure re-validate it (see `app.ts`, which
 * feeds the result back through `migratePreferences`).
 */
export type ParsedJson = EditablePreferences;

export function editJson(title: string, description: string, value: unknown, onApply: (parsed: ParsedJson) => void, onDelete?: () => void): void {
  showDialog(title, description);
  const textarea = document.createElement('textarea');
  textarea.setAttribute('aria-label', title + ' JSON');
  textarea.value = stringifyPreservingNumbers(value);
  textarea.spellcheck = false;
  content.append(textarea);
  apply.hidden = false;
  apply.onclick = () => {
    try { onApply(JSON.parse(textarea.value)); modal.close(); }
    catch (failure) { error.textContent = failureMessage(failure); }
  };
  if (onDelete) {
    remove.hidden = false;
    remove.onclick = () => {
      try { onDelete(); modal.close(); }
      catch (failure) { showDialog('操作未完成', failureMessage(failure)); }
    };
  }
}

export function choose<T>(title: string, description: string, entries: Iterable<T>, label: (entry: T) => string, onChoose: (entry: T) => void | Promise<void>): void {
  showDialog(title, description);
  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.textContent = label(entry);
    button.onclick = async () => {
      try { modal.close(); await onChoose(entry); }
      catch (failure) { showDialog('操作未完成', failureMessage(failure)); }
    };
    content.append(button);
  }
}

export function confirmAction(title: string, action: () => void): void {
  showDialog(title, '当前谱面有未保存修改。继续会放弃本次修改；可取消并保存到谱面库或导出 PEZ。自动备份仅在设定间隔到达后生成。');
  apply.hidden = false;
  apply.onclick = () => { modal.close(); action(); };
}

export function dialogOpen(): boolean { return Boolean(modal.open || (document.querySelector('#settings-modal') as HTMLDialogElement | null)?.open); }
