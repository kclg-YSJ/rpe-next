import { showDialog } from './dialog.ts';
import { reorderLine, deleteLine, duplicateLine, setLineParent } from '../application/line-commands.ts';
import type { EditorSession } from '../application/session.ts';
import type { Chart } from '../core/types.ts';

/**
 * The session surface this dialog drives.
 *
 * Narrowed to what the dialog actually touches rather than the whole `EditorSession`, so the
 * parameter type documents the dependency; `EditorSession` is structurally assignable to it.
 */
export interface LineDialogSession {
  line: EditorSession['line'];
  lineIndex: number;
  chart: Chart;
  selection: Set<number>;
  eventSelection: Set<string>;
  selectionState(): ReturnType<EditorSession['selectionState']>;
  updateLine(label: string, change: (line: NonNullable<EditorSession['line']>) => NonNullable<EditorSession['line']>): void;
  commit(label: string, chart: Chart, beforeSelection?: ReturnType<EditorSession['selectionState']>): void;
}

export function manageLines(session: LineDialogSession): void {
  if (!session.line) throw new Error('请先添加判定线');
  const content = showDialog('管理判定线', '调整顺序会同步更新父线编号；删除会解除直接子线的父引用。操作可撤销。复制保留音符、事件及所有附加字段。');
  const summary = document.createElement('p');
  summary.textContent = `当前：${session.lineIndex} · ${session.line.Name || '未命名'}`;
  content.append(summary);
  const failure = document.createElement('p'); failure.setAttribute('role', 'alert');
  const button = (name: string, action: () => void, disabled = false): void => {
    const element = document.createElement('button'); element.type = 'button'; element.textContent = name; element.disabled = disabled;
    element.onclick = () => {
      try { action(); if (session.line) manageLines(session); else showDialog('判定线已删除', '可以撤销，或添加新的判定线。'); }
      catch (error) { failure.textContent = error instanceof Error ? error.message : String(error); }
    };
    content.append(element);
  };
  const apply = (label: string, chart: Chart, index: number = session.lineIndex): void => {
    const beforeSelection = session.selectionState();
    session.lineIndex = index;
    session.selection.clear();
    session.eventSelection.clear();
    session.commit(label, chart, beforeSelection);
  };
  const name = document.createElement('input'); name.value = session.line.Name || ''; name.setAttribute('aria-label', '判定线名称'); content.append(name);
  button('重命名', () => session.updateLine('重命名判定线', line => ({ ...line, Name: name.value })));
  const parent = document.createElement('select'); parent.setAttribute('aria-label', '父判定线');
  // `-1` is a real choice (no parent) and is paired with a name-only stub, so the entry type is the
  // union of that stub and a real line; only `Name` is read from either.
  const entries: [number, { Name: string }][] = [[-1, { Name: '无父线' }], ...session.chart.judgeLineList.entries()];
  for (const [index, line] of entries) {
    if (index === session.lineIndex) continue;
    const option = document.createElement('option'); option.value = String(index); option.textContent = `${index} · ${line.Name || '未命名'}`; parent.append(option);
  }
  parent.value = String(session.line.father ?? -1);
  if (!parent.value) parent.value = '-1';
  content.append(parent);
  button('设置父线', () => apply('设置父线', setLineParent(session.chart, session.lineIndex, Number(parent.value))));
  const zOrder = document.createElement('input'); zOrder.type = 'number'; zOrder.step = '1'; zOrder.value = String(Number(session.line.zOrder ?? 0)); zOrder.setAttribute('aria-label', '判定线 zOrder'); content.append(zOrder);
  const rotateWithFather = document.createElement('label'); const rotateToggle = document.createElement('input'); rotateToggle.type = 'checkbox'; rotateToggle.checked = session.line.rotateWithFather ?? ((session.chart.META?.RPEVersion ?? 0) >= 163); rotateToggle.setAttribute('aria-label', '父线旋转继承'); rotateWithFather.append(rotateToggle, ' 父线旋转继承'); content.append(rotateWithFather);
  button('应用渲染属性', () => {
    const value = Number(zOrder.value);
    if (!Number.isFinite(value)) throw new Error('zOrder 必须是有限数字');
    session.updateLine('更新判定线渲染属性', line => ({ ...line, zOrder: Math.trunc(value), rotateWithFather: rotateToggle.checked }));
  });
  button('上移', () => apply('上移判定线', reorderLine(session.chart, session.lineIndex, session.lineIndex - 1), session.lineIndex - 1), session.lineIndex === 0);
  button('下移', () => apply('下移判定线', reorderLine(session.chart, session.lineIndex, session.lineIndex + 1), session.lineIndex + 1), session.lineIndex === session.chart.judgeLineList.length - 1);
  button('复制判定线', () => apply('复制判定线', duplicateLine(session.chart, session.lineIndex), session.chart.judgeLineList.length));
  button('删除判定线', () => apply('删除判定线', deleteLine(session.chart, session.lineIndex), Math.max(0, session.lineIndex - 1)));
  content.append(failure);
}
