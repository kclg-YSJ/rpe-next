const aliases: Record<string, string> = { CONTROL: 'CTRL', CMD: 'CTRL', META: 'CTRL', RETURN: 'ENTER', ESC: 'ESCAPE', SPACEBAR: 'SPACE',
  '←': 'LEFTARROW', '→': 'RIGHTARROW', '↑': 'UPARROW', '↓': 'DOWNARROW',
  ARROWLEFT: 'LEFTARROW', ARROWRIGHT: 'RIGHTARROW', ARROWUP: 'UPARROW', ARROWDOWN: 'DOWNARROW',
  '[': 'LEFTBRACKET', ']': 'RIGHTBRACKET', '-': 'MINUS', ',': 'COMMA', '.': 'PERIOD', '/': 'SLASH', '\\': 'BACKSLASH', ';': 'SEMICOLON', "'": 'QUOTE', '`': 'TILDE', '=': 'EQUAL' };
const namedKeys = new Set(['SPACE', 'ENTER', 'TAB', 'ESCAPE', 'DELETE', 'BACKSPACE', 'INSERT', 'HOME', 'END', 'PAGEUP', 'PAGEDOWN',
  'LEFTARROW', 'RIGHTARROW', 'UPARROW', 'DOWNARROW', 'LEFTBRACKET', 'RIGHTBRACKET', 'MINUS', 'COMMA', 'PERIOD', 'SLASH', 'BACKSLASH', 'SEMICOLON', 'QUOTE', 'TILDE', 'EQUAL']);

/**
 * The outcome of parsing a shortcut specification.
 *
 * Every member is optional because the parser reports four distinct shapes: a rejection (`error`),
 * the explicit unbound value (`value: ''` with empty `parts`/`key`), and a resolved binding. Callers
 * test `error` first and then read `value`/`parts`, so a single optional-member interface models all
 * of them without a cast.
 */
export interface ParsedShortcut {
  value?: string;
  parts?: string[];
  key?: string;
  error?: string;
}

export function normalizeShortcutKey(key: string): string { return aliases[key] ?? key; }

export function parseShortcut(specification: unknown): ParsedShortcut {
  if (typeof specification !== 'string') return { error: '快捷键必须是文本' };
  if (!specification.trim() || specification.toUpperCase() === 'NONE') return { value: '', parts: [], key: '' };
  const parts: string[] = specification.toUpperCase().replaceAll(' ', '').split(/[&+]/).map(part => normalizeShortcutKey(part.replace(/^(LEFT|RIGHT)(CTRL|SHIFT|ALT)$/, '$2')));
  if (parts.some(part => !part)) return { error: '组合键不能有空项，例如 Ctrl+S' };
  if (new Set(parts).size !== parts.length) return { error: '同一个按键不能重复出现' };
  const modifiers = ['CTRL', 'ALT', 'SHIFT'].filter(part => parts.includes(part));
  const keys = parts.filter(part => !['CTRL', 'SHIFT', 'ALT'].includes(part));
  if (keys.length !== 1) return { error: '需要一个普通按键，可搭配 Ctrl / Alt / Shift' };
  const key: string = keys[0]!;
  if (!/^[A-Z0-9]$/.test(key) && !/^F([1-9]|1[0-2])$/.test(key) && !namedKeys.has(key)) return { error: `不支持的按键：${key}` };
  const ordered = [...modifiers.map(part => `LEFT${part}`), key];
  return { value: ordered.join('&'), parts: ordered, key };
}

export function formatShortcut(specification: string): string {
  const parsed = parseShortcut(specification);
  if (parsed.error) return specification;
  const labels: Record<string, string> = { LEFTCTRL: 'Ctrl', LEFTALT: 'Alt', LEFTSHIFT: 'Shift', SPACE: 'Space', ESCAPE: 'Esc', LEFTARROW: '←', RIGHTARROW: '→', UPARROW: '↑', DOWNARROW: '↓', LEFTBRACKET: '[', RIGHTBRACKET: ']' };
  return (parsed.parts ?? []).map(part => labels[part] ?? part).join(' + ') || '未绑定';
}
