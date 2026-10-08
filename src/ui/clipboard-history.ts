import { beatValue } from '../core/beat.ts';
import type { ClipboardEntry, ClipboardHistory } from '../application/clipboard-history.ts';

const colors: Record<number, string> = { 1: '#8acbff', 2: '#8acbff', 3: '#f596ac', 4: '#f1ce76' };

/** The callbacks the history list wires its cards to. */
export interface ClipboardHistoryActions {
  use(id: string): void;
}

/**
 * Draws a compact preview of a remembered clipboard group.
 *
 * The horizontal axis is note X position and the vertical axis is beat time, so notes and events
 * share one time frame: notes occupy the left of the canvas and event tracks the right, unless the
 * group holds only one kind, in which case it takes the full width.
 */
export function drawClipboardThumbnail(canvas: HTMLCanvasElement, entry: ClipboardEntry): void {
  canvas.width = 480; canvas.height = 160;
  const context = canvas.getContext('2d')!;
  const items = [...entry.notes, ...entry.events.map(item => item.event)];
  let first = Infinity; let last = -Infinity;
  for (const item of items) { first = Math.min(first, beatValue(item.startTime)); last = Math.max(last, beatValue(item.endTime)); }
  const span = Math.max(1, last - first);
  const vertical = (time: unknown): number => 145 - (beatValue(time) - first) / span * 130;
  const noteArea = entry.notes.length ? entry.events.length ? 300 : 480 : 0;
  let extent = 675;
  for (const note of entry.notes) extent = Math.max(extent, Math.abs(note.positionX));
  context.fillStyle = '#20252d'; context.fillRect(0, 0, 480, 160);
  context.strokeStyle = '#414956'; context.lineWidth = 1;
  if (noteArea) for (let index = 0; index < 5; index++) { const x = 16 + index / 4 * (noteArea - 32); context.beginPath(); context.moveTo(x, 10); context.lineTo(x, 150); context.stroke(); }
  // Hold notes are drawn first so their bodies sit behind the tap markers drawn on top.
  for (const note of [...entry.notes].sort((left, right) => Number(right.type === 2) - Number(left.type === 2))) {
    const horizontal = 16 + (note.positionX + extent) / (extent * 2) * (noteArea - 32);
    const bottom = vertical(note.startTime); const top = vertical(note.endTime);
    context.fillStyle = colors[note.type] ?? '#ccc'; context.globalAlpha = note.isFake ? 0.4 : 0.85;
    if (note.type === 2) context.fillRect(horizontal - 9, top, 18, Math.max(3, bottom - top));
    context.fillRect(horizontal - 13, bottom - 2, 26, 4);
  }
  context.globalAlpha = 0.8;
  const tracks = [...new Set(entry.events.map(item => item.type))];
  for (const { type, event } of entry.events) {
    const width = (480 - noteArea - 12) / tracks.length;
    const top = vertical(event.endTime); const bottom = vertical(event.startTime);
    context.fillStyle = type === 'paintEvents' ? '#bc8fec' : '#d7a451';
    context.fillRect(noteArea + tracks.indexOf(type) * width + 4, top, Math.max(2, width - 6), Math.max(3, bottom - top));
  }
  context.globalAlpha = 1;
}

/** Renders the remembered clipboard groups as a list of cards. */
export function renderClipboardHistory(host: HTMLElement, history: ClipboardHistory, actions: ClipboardHistoryActions): void {
  // Focus and the caret position are captured before the DOM is rebuilt, then restored afterwards,
  // so renaming a group does not steal focus while the user is still typing in its field.
  const focused = document.activeElement?.closest('[data-clipboard-id]');
  const focusId = (focused as HTMLElement | null)?.dataset.clipboardId;
  const focusAction = (document.activeElement as HTMLElement | null)?.dataset.action;
  host.replaceChildren();
  if (!history.entries.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = '复制或剪切选中物件后，这里会显示缩览图。'; host.append(empty); return; }
  for (const entry of [...history.entries].sort((left, right) => Number(right.pinned) - Number(left.pinned))) {
    const card = document.createElement('article'); card.className = 'clipboard-card'; card.dataset.clipboardId = entry.id;
    card.classList.toggle('active', history.activeId === entry.id);
    const select = document.createElement('button'); select.type = 'button'; select.className = 'clipboard-select'; select.dataset.action = 'use';
    select.setAttribute('aria-pressed', String(history.activeId === entry.id));
    const picture = document.createElement('canvas'); picture.setAttribute('aria-hidden', 'true'); drawClipboardThumbnail(picture, entry);
    const title = document.createElement('strong'); title.textContent = `${entry.pinned ? '◆ ' : ''}${entry.notes.length} 音符 · ${entry.events.length} 事件`;
    const details = document.createElement('span'); details.textContent = `${entry.source} · 线 ${entry.line} · ${new Date(entry.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    select.setAttribute('aria-label', `选用：${entry.name || title.textContent}，${details.textContent}`); select.onclick = () => actions.use(entry.id);
    select.append(picture, title, details); card.append(select);
    const name = document.createElement('input'); name.type = 'text'; name.maxLength = 40; name.className = 'clipboard-name'; name.dataset.action = 'name';
    name.value = entry.name ?? ''; name.placeholder = '命名此组…'; name.setAttribute('aria-label', `物件组名称：${entry.name || title.textContent}`);
    name.oninput = () => {
      history.rename(entry.id, name.value);
      name.setAttribute('aria-label', `物件组名称：${entry.name || title.textContent}`);
      select.setAttribute('aria-label', `选用：${entry.name || title.textContent}，${details.textContent}`);
    };
    name.onchange = () => { name.value = entry.name; };
    name.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); name.blur(); } };
    card.append(name);
    const buttons = document.createElement('div'); buttons.className = 'clipboard-actions';
    const controls: [string, string, () => void][] = [['pin', entry.pinned ? '取消固定' : '固定', () => history.pin(entry.id)], ['delete', '删除记录', () => history.remove(entry.id)]];
    for (const [key, label, action] of controls) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.action = key; button.textContent = label; button.onclick = action; buttons.append(button);
    }
    card.append(buttons); host.append(card);
  }
  if (focusId) for (const card of host.children) {
    const element = card as HTMLElement;
    if (element.dataset.clipboardId === focusId) element.querySelector<HTMLElement>(`[data-action="${focusAction}"]`)?.focus();
  }
}
