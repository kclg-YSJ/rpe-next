import { DEFAULT_HOTKEYS, parseHotkeys } from '../core/preferences.mjs';
import { HOTKEY_GROUPS, HOTKEY_LABELS, shortcutScope, validateHotkeys, recordedShortcut } from '../core/hotkey-settings.mjs';
import { formatShortcut } from '../core/shortcut-spec.mjs';
import { showDialog } from './dialog.mjs';
import { download } from '../platform/files.mjs';
import { t } from '../i18n.mjs';

export function showHotkeySettings(preferences, save) {
  const content = showDialog(t('hotkey-settings.sd34afee'), t('hotkey-settings.sec48b6e'));
  const modal = content.closest('dialog'); modal.classList.add('hotkey-dialog');
  const apply = document.querySelector('#modal-apply'); apply.hidden = false; apply.textContent = t('hotkey-settings.sac11aa5');
  let draft = { ...DEFAULT_HOTKEYS, ...preferences.hotkeys }; let recording = null; let busy = false;
  const rows = new Map(); const groups = [];
  const toolbar = document.createElement('div'); toolbar.className = 'hotkey-toolbar';
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = t('hotkey-settings.s1c6ac91'); search.setAttribute('aria-label', t('hotkey-settings.s4e1133a'));
  const onlyProblems = document.createElement('input'); onlyProblems.type = 'checkbox';
  const filterLabel = document.createElement('label'); filterLabel.append(onlyProblems, t('hotkey-settings.s3ab4fc6')); toolbar.append(search, filterLabel);
  const resetAll = document.createElement('button'); resetAll.textContent = t('hotkey-settings.s1a8a8ae');
  const importButton = document.createElement('button'); importButton.textContent = t('hotkey-settings.s60e2bca');
  const exportButton = document.createElement('button'); exportButton.textContent = t('hotkey-settings.s1888967');
  const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,.txt'; file.hidden = true;
  toolbar.append(resetAll, importButton, exportButton, file); content.append(toolbar);
  const summary = document.createElement('p'); summary.className = 'hotkey-summary'; summary.setAttribute('role', 'status'); summary.setAttribute('aria-live', 'polite'); content.append(summary);
  const feedback = document.createElement('p'); feedback.className = 'hotkey-feedback'; feedback.setAttribute('role', 'status'); content.append(feedback);
  const list = document.createElement('div'); list.className = 'hotkey-list'; content.append(list);

  function stopRecording() {
    if (!recording) return;
    rows.get(recording).record.textContent = t('hotkey-settings.s83f84cf'); rows.get(recording).record.classList.remove('active'); recording = null;
  }
  function refresh() {
    const validation = validateHotkeys(draft);
    const errors = validation.issues.filter(issue => issue.severity === 'error').length;
    const warnings = validation.issues.filter(issue => issue.severity === 'warning').length;
    summary.textContent = t('hotkey-settings.sdadde53', { p0: errors, p1: warnings, p2: validation.issues.filter(issue => issue.severity === 'info').length });
    apply.disabled = !validation.valid || busy;
    const query = search.value.trim().toLowerCase();
    for (const [action, row] of rows) {
      const issues = validation.issues.filter(issue => issue.actions.includes(action));
      row.root.dataset.severity = issues.some(issue => issue.severity === 'error') ? 'error' : issues.some(issue => issue.severity === 'warning') ? 'warning' : 'ok';
      row.input.setAttribute('aria-invalid', String(row.root.dataset.severity === 'error'));
      row.message.textContent = issues.map(issue => t('hotkey-settings.sc011402', { p0: issue.severity === 'info' ? t('hotkey-settings.sec5baa1') : issue.severity === 'warning' ? t('hotkey-settings.sab3656a') : t('hotkey-settings.sb859c7b'), p1: issue.message, p2: issue.actions.length > 1 ? `（${issue.actions.filter(value => value !== action).map(value => HOTKEY_LABELS[value]).join('、')}）` : '' })).join('；');
      row.root.hidden = Boolean(query && !`${action} ${HOTKEY_LABELS[action]} ${draft[action]} ${formatShortcut(draft[action])} ${shortcutScope(action)}`.toLowerCase().includes(query)) || onlyProblems.checked && !issues.some(issue => issue.severity !== 'info');
      row.reset.disabled = draft[action] === DEFAULT_HOTKEYS[action];
    }
    for (const group of groups) group.hidden = ![...group.querySelectorAll('.hotkey-row')].some(row => !row.hidden);
  }
  function setDraft(next) {
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
      const input = document.createElement('input'); input.id = `hotkey-${action}`; input.type = 'text'; input.spellcheck = false; input.value = draft[action] ? formatShortcut(draft[action]) : ''; input.placeholder = t('hotkey-settings.s3bf179d'); input.setAttribute('aria-describedby', `hotkey-message-${action}`);
      const record = document.createElement('button'); record.textContent = t('hotkey-settings.s83f84cf'); record.setAttribute('aria-label', t('hotkey-settings.sd89b61e', { p0: label }));
      const clear = document.createElement('button'); clear.textContent = t('hotkey-settings.s7b15e5e'); clear.title = t('hotkey-settings.sc718eb2', { p0: label });
      const reset = document.createElement('button'); reset.textContent = t('hotkey-settings.s457d449'); reset.title = t('hotkey-settings.s72eeb0d', { p0: formatShortcut(DEFAULT_HOTKEYS[action]) });
      const message = document.createElement('small'); message.className = 'hotkey-message'; message.id = `hotkey-message-${action}`;
      root.append(description, input, record, clear, reset, message); section.append(root);
      rows.set(action, { root, input, record, reset, message });
      input.oninput = () => { stopRecording(); draft[action] = input.value; feedback.textContent = ''; refresh(); };
      record.onclick = () => {
        const previous = recording; stopRecording();
        if (previous === action) return;
        recording = action; record.textContent = t('hotkey-settings.s24cae7d'); record.classList.add('active');
        feedback.textContent = t('hotkey-settings.sdecc02e', { p0: label });
      };
      clear.onclick = () => { stopRecording(); draft[action] = ''; input.value = ''; refresh(); };
      reset.onclick = () => { stopRecording(); draft[action] = DEFAULT_HOTKEYS[action]; input.value = formatShortcut(draft[action]); refresh(); };
    }
  }
  const fixed = document.createElement('p'); fixed.className = 'hint'; fixed.textContent = t('hotkey-settings.s4e84e98'); content.append(fixed);
  const retained = Object.entries(draft).filter(([action]) => !(action in DEFAULT_HOTKEYS));
  if (retained.length) {
    const details = document.createElement('details'); const title = document.createElement('summary'); title.textContent = t('hotkey-settings.se93d3dd', { p0: retained.length }); const text = document.createElement('pre'); text.textContent = retained.map(([action, binding]) => `${action}: ${binding}`).join('\n'); details.append(title, text); content.append(details);
  }
  const capture = event => {
    if (!recording) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat) return;
    const result = recordedShortcut(event); if (!result) return;
    if (result.error) { feedback.textContent = result.error; return; }
    const action = recording; stopRecording(); draft[action] = result.value; rows.get(action).input.value = formatShortcut(result.value);
    feedback.textContent = t('hotkey-settings.s78e7d93', { p0: HOTKEY_LABELS[action], p1: formatShortcut(result.value) }); refresh();
  };
  modal.addEventListener('keydown', capture, true);
  modal.addEventListener('close', () => { modal.classList.remove('hotkey-dialog'); modal.removeEventListener('keydown', capture, true); }, { once: true });
  search.oninput = refresh; onlyProblems.onchange = refresh;
  resetAll.onclick = () => {
    if (resetAll.dataset.confirm !== 'true') { resetAll.dataset.confirm = 'true'; resetAll.textContent = t('hotkey-settings.s310d03e'); return; }
    setDraft({ ...draft, ...DEFAULT_HOTKEYS }); resetAll.dataset.confirm = ''; resetAll.textContent = t('hotkey-settings.s1a8a8ae'); feedback.textContent = t('hotkey-settings.se3390ed');
  };
  importButton.onclick = () => file.click();
  file.onchange = async () => {
    try {
      if (!file.files[0]) return;
      const text = (await file.files[0].text()).replace(/^\uFEFF/, '');
      const imported = text.trimStart().startsWith('{') ? JSON.parse(text) : parseHotkeys(text);
      const bindings = imported.originalHotkeys ?? imported.hotkeys ?? imported;
      if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings) || !Object.keys(bindings).some(action => action in DEFAULT_HOTKEYS) || Object.values(bindings).some(value => typeof value !== 'string')) throw new Error(t('hotkey-settings.s0bd7499'));
      setDraft({ ...draft, ...bindings }); feedback.textContent = t('hotkey-settings.s9c4651d');
    } catch (error) { feedback.textContent = t('hotkey-settings.s6ba4e41', { p0: error.message }); }
    finally { file.value = ''; }
  };
  exportButton.onclick = () => download(new Blob([JSON.stringify({ ...preferences, hotkeys: draft, originalHotkeys: { ...preferences.originalHotkeys, ...draft } }, null, 2)], { type: 'application/json' }), 'rpe-next-preferences.json');
  apply.onclick = async () => {
    const validation = validateHotkeys(draft); if (!validation.valid || busy) return;
    stopRecording(); busy = true; toolbar.inert = list.inert = true; refresh();
    try {
      const hotkeys = { ...draft, ...validation.values };
      await save({ ...preferences, hotkeys, originalHotkeys: { ...preferences.originalHotkeys, ...hotkeys } });
      setDraft(hotkeys); feedback.textContent = t('hotkey-settings.sd696acc');
    } catch (error) { feedback.textContent = t('hotkey-settings.s285de8e', { p0: error.message }); }
    finally { busy = false; toolbar.inert = list.inert = false; refresh(); }
  };
  refresh();
}
