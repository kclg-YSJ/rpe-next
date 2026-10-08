import { DEFAULT_HOTKEYS, parseHotkeys } from '../core/preferences.ts';
import type { DefaultHotkeys, MigratedPreferences } from '../core/preferences.ts';
import { HOTKEY_GROUPS, HOTKEY_LABELS, shortcutScope, validateHotkeys, recordedShortcut } from '../core/hotkey-settings.ts';
import { formatShortcut } from '../core/shortcut-spec.ts';
import { showDialog } from './dialog.ts';
import { download } from '../platform/files.ts';

/** The per-action widgets `refresh()` reaches back into. */
interface HotkeyRow {
  root: HTMLElement;
  input: HTMLInputElement;
  record: HTMLButtonElement;
  reset: HTMLButtonElement;
  message: HTMLElement;
}

/** The subset of a keydown the recorder reads; a real `KeyboardEvent` satisfies it. */
interface RecordedKeyEvent {
  repeat?: boolean;
  preventDefault(): void;
  stopImmediatePropagation(): void;
  isComposing?: boolean;
  key?: string | null;
  code?: string | null;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * Opens the hotkey editor.
 *
 * Edits accumulate in a local `draft` and only reach storage when the user applies them, so an
 * accidental rebinding can always be discarded by closing the dialog. Import and export exchange the
 * same JSON shape the legacy preferences file uses.
 */
export function showHotkeySettings(preferences: MigratedPreferences, save: (next: MigratedPreferences) => Promise<void> | void): void {
  const content = showDialog('快捷键设置', '点击录入后按下组合键，或直接输入 Ctrl+S 等格式。空白表示禁用；只有点击“应用快捷键”才会保存。');
  const modal = content.closest('dialog')!; modal.classList.add('hotkey-dialog');
  const apply = document.querySelector<HTMLButtonElement>('#modal-apply')!; apply.hidden = false; apply.textContent = '应用快捷键';
  let draft: Record<string, string> = { ...DEFAULT_HOTKEYS, ...preferences.hotkeys }; let recording: string | null = null; let busy = false;
  const rows = new Map<string, HotkeyRow>(); const groups: HTMLElement[] = [];
  const toolbar = document.createElement('div'); toolbar.className = 'hotkey-toolbar';
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = '搜索操作、按键或范围'; search.setAttribute('aria-label', '搜索快捷键');
  const onlyProblems = document.createElement('input'); onlyProblems.type = 'checkbox';
  const filterLabel = document.createElement('label'); filterLabel.append(onlyProblems, '仅看冲突 / 警告'); toolbar.append(search, filterLabel);
  const resetAll = document.createElement('button'); resetAll.textContent = '全部还原';
  const importButton = document.createElement('button'); importButton.textContent = '导入';
  const exportButton = document.createElement('button'); exportButton.textContent = '导出';
  const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,.txt'; file.hidden = true;
  toolbar.append(resetAll, importButton, exportButton, file); content.append(toolbar);
  const summary = document.createElement('p'); summary.className = 'hotkey-summary'; summary.setAttribute('role', 'status'); summary.setAttribute('aria-live', 'polite'); content.append(summary);
  const feedback = document.createElement('p'); feedback.className = 'hotkey-feedback'; feedback.setAttribute('role', 'status'); content.append(feedback);
  const list = document.createElement('div'); list.className = 'hotkey-list'; content.append(list);

  function stopRecording(): void {
    if (!recording) return;
    const row = rows.get(recording)!;
    row.record.textContent = '录入'; row.record.classList.remove('active'); recording = null;
  }
  function refresh(): void {
    const validation = validateHotkeys(draft);
    const errors = validation.issues.filter(issue => issue.severity === 'error').length;
    const warnings = validation.issues.filter(issue => issue.severity === 'warning').length;
    summary.textContent = `${errors} 项错误 · ${warnings} 项警告 · ${validation.issues.filter(issue => issue.severity === 'info').length} 组允许的复用`;
    apply.disabled = !validation.valid || busy;
    const query = search.value.trim().toLowerCase();
    for (const [action, row] of rows) {
      const issues = validation.issues.filter(issue => issue.actions.includes(action));
      row.root.dataset.severity = issues.some(issue => issue.severity === 'error') ? 'error' : issues.some(issue => issue.severity === 'warning') ? 'warning' : 'ok';
      row.input.setAttribute('aria-invalid', String(row.root.dataset.severity === 'error'));
      row.message.textContent = issues.map(issue => `${issue.severity === 'info' ? '可复用' : issue.severity === 'warning' ? '提示' : '错误'}：${issue.message}${issue.actions.length > 1 ? `（${issue.actions.filter(value => value !== action).map(value => HOTKEY_LABELS[value]).join('、')}）` : ''}`).join('；');
      row.root.hidden = Boolean(query && !`${action} ${HOTKEY_LABELS[action]} ${draft[action]} ${formatShortcut(draft[action] ?? '')} ${shortcutScope(action)}`.toLowerCase().includes(query)) || onlyProblems.checked && !issues.some(issue => issue.severity !== 'info');
      row.reset.disabled = draft[action] === DEFAULT_HOTKEYS[action as keyof DefaultHotkeys];
    }
    for (const group of groups) group.hidden = ![...group.querySelectorAll<HTMLElement>('.hotkey-row')].some(row => !row.hidden);
  }
  function setDraft(next: Record<string, string>): void {
    stopRecording(); draft = next;
    for (const [action, row] of rows) row.input.value = draft[action] ? formatShortcut(draft[action]) : '';
    refresh();
  }
  for (const [title, entries] of HOTKEY_GROUPS) {
    const section = document.createElement('section'); const heading = document.createElement('h3'); heading.textContent = title; section.append(heading); list.append(section); groups.push(section);
    for (const [action, label] of Object.entries(entries)) {
      const root = document.createElement('div'); root.className = 'hotkey-row'; root.dataset.action = action;
      const description = document.createElement('label'); description.htmlFor = `hotkey-${action}`;
      const name = document.createElement('strong'); name.textContent = label;
      const scope = document.createElement('small'); scope.textContent = shortcutScope(action); description.append(name, scope);
      const input = document.createElement('input'); input.id = `hotkey-${action}`; input.type = 'text'; input.spellcheck = false; input.value = draft[action] ? formatShortcut(draft[action]) : ''; input.placeholder = '未绑定'; input.setAttribute('aria-describedby', `hotkey-message-${action}`);
      const record = document.createElement('button'); record.textContent = '录入'; record.setAttribute('aria-label', `录入${label}快捷键`);
      const clear = document.createElement('button'); clear.textContent = '清除'; clear.title = `禁用：${label}`;
      const reset = document.createElement('button'); reset.textContent = '还原'; reset.title = `默认：${formatShortcut(DEFAULT_HOTKEYS[action as keyof DefaultHotkeys])}`;
      const message = document.createElement('small'); message.className = 'hotkey-message'; message.id = `hotkey-message-${action}`;
      root.append(description, input, record, clear, reset, message); section.append(root);
      rows.set(action, { root, input, record, reset, message });
      input.oninput = () => { stopRecording(); draft[action] = input.value; feedback.textContent = ''; refresh(); };
      record.onclick = () => {
        const previous = recording; stopRecording();
        if (previous === action) return;
        recording = action; record.textContent = '取消录入'; record.classList.add('active');
        feedback.textContent = `正在录入「${label}」，请按下组合键；Esc 也可录入，点击“取消录入”取消。`;
      };
      clear.onclick = () => { stopRecording(); draft[action] = ''; input.value = ''; refresh(); };
      reset.onclick = () => { stopRecording(); draft[action] = DEFAULT_HOTKEYS[action as keyof DefaultHotkeys]; input.value = formatShortcut(draft[action] ?? ''); refresh(); };
    }
  }
  const fixed = document.createElement('p'); fixed.className = 'hint'; fixed.textContent = '鼠标操作：Ctrl+滚轮切线，Shift / 中键框选，右键菜单。联机聊天使用 /；事件放置中的数字选择优先。原版未迁移的热键会随配置保留，但不作为已实现操作列出。'; content.append(fixed);
  const retained = Object.entries(draft).filter(([action]) => !(action in DEFAULT_HOTKEYS));
  if (retained.length) {
    const details = document.createElement('details'); const title = document.createElement('summary'); title.textContent = `保留的原版配置（${retained.length} 项）`; const text = document.createElement('pre'); text.textContent = retained.map(([action, binding]) => `${action}: ${binding}`).join('\n'); details.append(title, text); content.append(details);
  }
  const capture = (event: Event): void => {
    if (!recording) return;
    const key = event as unknown as RecordedKeyEvent;
    key.preventDefault(); key.stopImmediatePropagation();
    if (key.repeat) return;
    const result = recordedShortcut(key); if (!result) return;
    if (result.error) { feedback.textContent = result.error; return; }
    const action = recording; stopRecording(); draft[action] = result.value ?? ''; rows.get(action)!.input.value = formatShortcut(result.value ?? '');
    feedback.textContent = `「${HOTKEY_LABELS[action]}」已录入 ${formatShortcut(result.value ?? '')}，应用后生效。`; refresh();
  };
  modal.addEventListener('keydown', capture, true);
  modal.addEventListener('close', () => { modal.classList.remove('hotkey-dialog'); modal.removeEventListener('keydown', capture, true); }, { once: true });
  search.oninput = refresh; onlyProblems.onchange = refresh;
  resetAll.onclick = () => {
    if (resetAll.dataset.confirm !== 'true') { resetAll.dataset.confirm = 'true'; resetAll.textContent = '确认全部还原'; return; }
    setDraft({ ...draft, ...DEFAULT_HOTKEYS }); resetAll.dataset.confirm = ''; resetAll.textContent = '全部还原'; feedback.textContent = '已还原默认快捷键，点击应用后保存。';
  };
  importButton.onclick = () => file.click();
  file.onchange = async () => {
    try {
      const selected = file.files?.[0];
      if (!selected) return;
      const text = (await selected.text()).replace(/^\uFEFF/, '');
      // The file may be either the editor's own JSON export or a legacy plain-text hotkey list, so the
      // shape is only known after parsing; `bindings` stays `unknown` until the checks below pass.
      const imported: unknown = text.trimStart().startsWith('{') ? JSON.parse(text) : parseHotkeys(text);
      const record: Record<string, unknown> = imported !== null && typeof imported === 'object' ? imported as Record<string, unknown> : {};
      const bindings: unknown = record.originalHotkeys ?? record.hotkeys ?? imported;
      if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings) || !Object.keys(bindings).some(action => action in DEFAULT_HOTKEYS) || Object.values(bindings).some(value => typeof value !== 'string')) throw new Error('文件必须包含操作名和快捷键文本，例如 {"Save":"CTRL&S"}');
      setDraft({ ...draft, ...(bindings as Record<string, string>) }); feedback.textContent = '已导入草稿；检查错误后点击应用。';
    } catch (error) { feedback.textContent = `导入失败：${(error as Error).message}`; }
    finally { file.value = ''; }
  };
  exportButton.onclick = () => download(new Blob([JSON.stringify({ ...preferences, hotkeys: draft, originalHotkeys: { ...preferences.originalHotkeys, ...draft } }, null, 2)], { type: 'application/json' }), 'rpe-next-preferences.json');
  apply.onclick = async () => {
    const validation = validateHotkeys(draft); if (!validation.valid || busy) return;
    stopRecording(); busy = true; toolbar.inert = list.inert = true; refresh();
    try {
      const hotkeys: Record<string, string> = { ...draft };
      for (const [action, value] of Object.entries(validation.values)) if (value !== undefined) hotkeys[action] = value;
      await save({ ...preferences, hotkeys: hotkeys as unknown as DefaultHotkeys, originalHotkeys: { ...preferences.originalHotkeys, ...hotkeys } });
      setDraft(hotkeys); feedback.textContent = '快捷键已保存，立即生效。';
    } catch (error) { feedback.textContent = `保存失败：${(error as Error).message}；草稿仍保留，可重试。`; }
    finally { busy = false; toolbar.inert = list.inert = false; refresh(); }
  };
  refresh();
}
