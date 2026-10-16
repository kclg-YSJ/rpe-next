import { DEFAULT_HOTKEYS, shortcutKey } from './preferences.ts';
import type { DefaultHotkeys, ShortcutEvent } from './preferences.ts';
import { parseShortcut } from './shortcut-spec.ts';

/** One `[group title, { action: label }]` row of the hotkey editor. */
export type HotkeyGroup = [title: string, entries: Record<string, string>];

export const HOTKEY_GROUPS: HotkeyGroup[] = [
  ['编辑与文件', { Save: '保存谱面', Undo: '撤销', Redo: '重做', SelectAll: '全选', Delete: '删除选中物件', QuickDelete: '删除光标物件 / 多选', Esc: '取消 / 返回谱面工具' }],
  ['放置与曲线', { AddTap: '放置 Tap / 钩定事件', AddDrag: '放置 Drag', AddFlick: '放置 Flick', AddHold: '放置 Hold', AddEvent: '放置事件', NumberMirror: 'NumberMirror 数值镜像', NumberFill: 'NumberFill 数值填充', CurveBegin: '曲线音符起点', CurveEnd: '曲线音符终点' }],
  ['剪贴板', { Copy: '复制', Shear: '剪切', Paste: '粘贴', PasteMirror: '镜像粘贴', KeepTimePaste: '等时粘贴', KeepTimePasteMirror: '等时镜像粘贴', ClipboardHistory: '剪贴板历史' }],
  ['播放与视图', { Pause: '播放 / 暂停', StartView: '开始预览', EndView: '结束预览', JumpView: '结束预览并保留时间', ReplayView: '从头预览', StartView_HOLD: '按住预览，松开返回', JumpView_HOLD: '按住预览，松开保留时间', LastBeat: '后退一横线', NextBeat: '前进一横线', SwitchUI: '切换音符 / 事件视图', ResetCamera: '重置视野', ShowLineInfo: '显示 / 隐藏当前线信息' }],
  ['选中物件与多线', { PageLeft: '选中物件左移', PageRight: '选中物件右移', PageUp: '选中物件时间后移', PageDown: '选中物件时间前移', ToggleMultiLine: '开启 / 关闭多线', SwitchMultiLineMode: '切换多线音符 / 事件' }],
];
export const HOTKEY_LABELS: Record<string, string> = Object.assign({}, ...HOTKEY_GROUPS.map(([, entries]) => entries));

export function shortcutScope(action: string): string {
  if (['AddHold', 'AddDrag', 'AddFlick'].includes(action)) return '音符区域';
  if (action === 'AddEvent') return '事件区域';
  if (action === 'AddTap') return '音符 / 事件区域';
  if (action === 'ClipboardHistory') return '与粘贴同键时长按，否则单按';
  if (action.startsWith('Page')) return '有选中物件时';
  if (['LastBeat', 'NextBeat'].includes(action)) return '无选中物件时';
  if (action.endsWith('_HOLD')) return '按住 / 松开';
  return '编辑器（文本输入除外）';
}

/** One reported hotkey problem; `actions` names the bindings it concerns. */
export interface HotkeyIssue {
  severity: 'error' | 'warning' | 'info';
  actions: string[];
  message: string;
}

export interface HotkeyValidation {
  values: Record<string, string | undefined>;
  issues: HotkeyIssue[];
  valid: boolean;
}

function allowedOverlap(first: string, second: string): string | null {
  const pair = [first, second];
  if (pair.includes('AddEvent') && pair.some(action => ['AddHold', 'AddDrag', 'AddFlick'].includes(action))) return '按音符 / 事件区域区分';
  if (pair.includes('Paste') && pair.includes('ClipboardHistory')) return '短按粘贴，长按打开历史';
  if (pair.some(action => action.startsWith('Page')) && pair.some(action => ['LastBeat', 'NextBeat'].includes(action))) return '按是否有选中物件区分';
  return null;
}

export function validateHotkeys(hotkeys: Partial<DefaultHotkeys>): HotkeyValidation {
  const values: Record<string, string | undefined> = {}; const issues: HotkeyIssue[] = [];
  for (const action of Object.keys(DEFAULT_HOTKEYS)) {
    const parsed = parseShortcut(hotkeys[action as keyof DefaultHotkeys] ?? DEFAULT_HOTKEYS[action as keyof DefaultHotkeys]);
    if (parsed.error) { issues.push({ severity: 'error', actions: [action], message: parsed.error }); continue; }
    values[action] = parsed.value;
    if (parsed.value === 'SLASH') issues.push({ severity: 'error', actions: [action], message: '/ 保留给联机聊天，请选择其他按键' });
    if (/^(LEFTALT&F4|LEFTCTRL&(W|R|L|T|N)|F5|F11|F12)$/.test(parsed.value ?? '')) issues.push({ severity: 'warning', actions: [action], message: '浏览器或操作系统可能优先处理此快捷键' });
    if (/^[0-9]$/.test(parsed.value ?? '')) issues.push({ severity: 'warning', actions: [action], message: '放置事件期间，数字键优先选择事件数值' });
  }
  const actions = Object.keys(values);
  for (const [index, first] of actions.entries()) for (const second of actions.slice(index + 1)) {
    if (!values[first] || values[first] !== values[second]) continue;
    const allowed = allowedOverlap(first, second);
    issues.push({ severity: allowed ? 'info' : 'error', actions: [first, second], message: allowed ?? '同一操作环境中重复绑定，请更换其中一个快捷键' });
  }
  return { values, issues, valid: !issues.some(issue => issue.severity === 'error') };
}

export function recordedShortcut(event: ShortcutEvent): ReturnType<typeof parseShortcut> | null {
  if (event.isComposing) return { error: '请切换到英文输入后录入快捷键' };
  const key = shortcutKey(event);
  if (['CONTROL', 'SHIFT', 'ALT', 'META'].includes(key)) return null;
  return parseShortcut([event.ctrlKey || event.metaKey ? 'CTRL' : '', event.altKey ? 'ALT' : '', event.shiftKey ? 'SHIFT' : '', key].filter(Boolean).join('&'));
}
