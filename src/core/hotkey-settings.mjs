import { DEFAULT_HOTKEYS, shortcutKey } from './preferences.mjs';
import { parseShortcut } from './shortcut-spec.mjs';
import { t } from '../i18n.mjs';

export const HOTKEY_GROUPS = [
  [t('hotkey-settings.s543601b'), { Save: t('hotkey-settings.s1930d92'), Undo: t('hotkey-settings.s9fcefd8'), Redo: t('hotkey-settings.s1238f0d'), SelectAll: t('hotkey-settings.s3e44b2a'), Delete: t('hotkey-settings.s01aa288'), QuickDelete: t('hotkey-settings.s59ce6c1'), Esc: t('hotkey-settings.s412413e') }],
  [t('hotkey-settings.s7554709'), { AddTap: t('hotkey-settings.s2ffab83'), AddDrag: t('hotkey-settings.s0894698'), AddFlick: t('hotkey-settings.sa4a5186'), AddHold: t('hotkey-settings.s8e61bdb'), AddEvent: t('hotkey-settings.s46a8a14'), NumberMirror: t('hotkey-settings.se77c350'), NumberFill: t('hotkey-settings.sf40b87f'), CurveBegin: t('hotkey-settings.s073a755'), CurveEnd: t('hotkey-settings.seb4b576'), DirectPlacement: t('direct-placement.toggle') }],
  [t('hotkey-settings.sc4eb94d'), { Copy: t('hotkey-settings.s4edd1d0'), Shear: t('hotkey-settings.s29b653b'), Paste: t('hotkey-settings.sde7fb7d'), PasteMirror: t('hotkey-settings.sa64e503'), KeepTimePaste: t('hotkey-settings.s4c0862f'), KeepTimePasteMirror: t('hotkey-settings.sdbbd5a4'), ClipboardHistory: t('hotkey-settings.sb377bb5') }],
  [t('hotkey-settings.s9aebbe6'), { Pause: t('hotkey-settings.s5fde2c3'), StartView: t('hotkey-settings.s73a58bf'), EndView: t('hotkey-settings.s3d997a5'), JumpView: t('hotkey-settings.s6b7d0ee'), ReplayView: t('hotkey-settings.s890d74d'), StartView_HOLD: t('hotkey-settings.sbfbd2c9'), JumpView_HOLD: t('hotkey-settings.s61005ab'), LastBeat: t('hotkey-settings.s0504260'), NextBeat: t('hotkey-settings.sc80d6f8'), SwitchUI: t('hotkey-settings.s96128fe'), ResetCamera: t('hotkey-settings.sd9e7260'), ShowLineInfo: t('hotkey-settings.s7f81e8d'), PerformanceMonitor: t('perf.title') }],
  [t('hotkey-settings.s3a96efa'), { SwitchLock: t('hotkey-settings.s2f3a269'), StickNext: t('hotkey-settings.s145056d'), TimeAttach: t('hotkey-settings.s8374dd0'), DragLong: t('hotkey-settings.sf5f6a01') }],
  [t('hotkey-settings.sbbc6de0'), { PageLeft: t('hotkey-settings.s3620ab6'), PageRight: t('hotkey-settings.s0acdd07'), PageUp: t('hotkey-settings.se4ba33d'), PageDown: t('hotkey-settings.sd97a176'), ToggleMultiLine: t('hotkey-settings.s0d2d947'), SwitchMultiLineMode: t('hotkey-settings.s6455031') }],
];
export const HOTKEY_LABELS = Object.assign({}, ...HOTKEY_GROUPS.map(([, entries]) => entries));

export function shortcutScope(action) {
  if (['AddHold', 'AddDrag', 'AddFlick'].includes(action)) return t('hotkey-settings.s9591b58');
  if (action === 'AddEvent') return t('hotkey-settings.s127a487');
  if (action === 'DragLong') return t('hotkey-settings.sc222a05');
  if (action === 'AddTap') return t('hotkey-settings.sb54ff87');
  if (action === 'ClipboardHistory') return t('hotkey-settings.s5ef8e24');
  if (action.startsWith('Page')) return t('hotkey-settings.s15d604c');
  if (['LastBeat', 'NextBeat'].includes(action)) return t('hotkey-settings.sfa91cbf');
  if (action.endsWith('_HOLD')) return t('hotkey-settings.s718de1c');
  return t('hotkey-settings.sa52d8b0');
}

function allowedOverlap(first, second) {
  const pair = [first, second];
  if (pair.includes('AddEvent') && pair.some(action => ['AddHold', 'AddDrag', 'AddFlick'].includes(action))) return t('hotkey-settings.s083120c');
  if (pair.includes('Paste') && pair.includes('ClipboardHistory')) return t('hotkey-settings.sb0274b2');
  if (pair.some(action => action.startsWith('Page')) && pair.some(action => ['LastBeat', 'NextBeat'].includes(action))) return t('hotkey-settings.sb392cdd');
  return null;
}

export function validateHotkeys(hotkeys) {
  const values = {}; const issues = [];
  for (const action of Object.keys(DEFAULT_HOTKEYS)) {
    const parsed = parseShortcut(hotkeys[action] ?? DEFAULT_HOTKEYS[action]);
    if (parsed.error) { issues.push({ severity: 'error', actions: [action], message: parsed.error }); continue; }
    values[action] = parsed.value;
    if (parsed.value === 'SLASH') issues.push({ severity: 'error', actions: [action], message: t('hotkey-settings.s3cf1eca') });
    if (/^(LEFTALT&F4|LEFTCTRL&(W|R|L|T|N)|F5|F11|F12)$/.test(parsed.value)) issues.push({ severity: 'warning', actions: [action], message: t('hotkey-settings.s6e00aef') });
    if (/^[0-9]$/.test(parsed.value)) issues.push({ severity: 'warning', actions: [action], message: t('hotkey-settings.s3885a72') });
  }
  const actions = Object.keys(values);
  for (const [index, first] of actions.entries()) for (const second of actions.slice(index + 1)) {
    if (!values[first] || values[first] !== values[second]) continue;
    const allowed = allowedOverlap(first, second);
    issues.push({ severity: allowed ? 'info' : 'error', actions: [first, second], message: allowed ?? t('hotkey-settings.s1c554e7') });
  }
  return { values, issues, valid: !issues.some(issue => issue.severity === 'error') };
}

export function recordedShortcut(event) {
  if (event.isComposing) return { error: t('hotkey-settings.s7ab73dd') };
  const key = shortcutKey(event);
  if (['CONTROL', 'SHIFT', 'ALT', 'META'].includes(key)) return null;
  return parseShortcut([event.ctrlKey || event.metaKey ? 'CTRL' : '', event.altKey ? 'ALT' : '', event.shiftKey ? 'SHIFT' : '', key].filter(Boolean).join('&'));
}
