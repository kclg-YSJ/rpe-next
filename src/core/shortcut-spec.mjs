import { t } from '../i18n.mjs';
const aliases = { CONTROL: 'CTRL', CMD: 'CTRL', META: 'CTRL', RETURN: 'ENTER', ESC: 'ESCAPE', SPACEBAR: 'SPACE',
  '←': 'LEFTARROW', '→': 'RIGHTARROW', '↑': 'UPARROW', '↓': 'DOWNARROW',
  ARROWLEFT: 'LEFTARROW', ARROWRIGHT: 'RIGHTARROW', ARROWUP: 'UPARROW', ARROWDOWN: 'DOWNARROW',
  '[': 'LEFTBRACKET', ']': 'RIGHTBRACKET', '-': 'MINUS', ',': 'COMMA', '.': 'PERIOD', '/': 'SLASH', '\\': 'BACKSLASH', ';': 'SEMICOLON', "'": 'QUOTE', '`': 'TILDE', '=': 'EQUAL' };
const namedKeys = new Set(['SPACE', 'ENTER', 'TAB', 'ESCAPE', 'DELETE', 'BACKSPACE', 'INSERT', 'HOME', 'END', 'PAGEUP', 'PAGEDOWN',
  'LEFTARROW', 'RIGHTARROW', 'UPARROW', 'DOWNARROW', 'LEFTBRACKET', 'RIGHTBRACKET', 'MINUS', 'COMMA', 'PERIOD', 'SLASH', 'BACKSLASH', 'SEMICOLON', 'QUOTE', 'TILDE', 'EQUAL']);

export function normalizeShortcutKey(key) { return aliases[key] ?? key; }

export function parseShortcut(specification) {
  if (typeof specification !== 'string') return { error: t('shortcut-spec.sded8fe6') };
  if (!specification.trim() || specification.toUpperCase() === 'NONE') return { value: '', parts: [], key: '' };
  const parts = specification.toUpperCase().replaceAll(' ', '').split(/[&+]/).map(part => normalizeShortcutKey(part.replace(/^(LEFT|RIGHT)(CTRL|SHIFT|ALT)$/, '$2')));
  if (parts.some(part => !part)) return { error: t('shortcut-spec.s54782e2') };
  if (new Set(parts).size !== parts.length) return { error: t('shortcut-spec.sa12f877') };
  const modifiers = ['CTRL', 'ALT', 'SHIFT'].filter(part => parts.includes(part));
  const keys = parts.filter(part => !['CTRL', 'SHIFT', 'ALT'].includes(part));
  if (keys.length !== 1) return { error: t('shortcut-spec.sbd43831') };
  const key = keys[0];
  if (!/^[A-Z0-9]$/.test(key) && !/^F([1-9]|1[0-2])$/.test(key) && !namedKeys.has(key)) return { error: t('shortcut-spec.s9969d98', { p0: key }) };
  const ordered = [...modifiers.map(part => `LEFT${part}`), key];
  return { value: ordered.join('&'), parts: ordered, key };
}

export function formatShortcut(specification) {
  const parsed = parseShortcut(specification);
  if (parsed.error) return specification;
  const labels = { LEFTCTRL: 'Ctrl', LEFTALT: 'Alt', LEFTSHIFT: 'Shift', SPACE: 'Space', ESCAPE: 'Esc', LEFTARROW: '←', RIGHTARROW: '→', UPARROW: '↑', DOWNARROW: '↓', LEFTBRACKET: '[', RIGHTBRACKET: ']' };
  return parsed.parts.map(part => labels[part] ?? part).join(' + ') || t('shortcut-spec.s3bf179d');
}
