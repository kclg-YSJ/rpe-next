import { noteIsAbove } from '../core/chart.ts';
import { selectedEvents, transformEvents } from './event-commands.ts';
import type { EventEditSession } from './event-commands.ts';
import type { ChartEvent, Note } from '../core/types.ts';

/**
 * The subset of {@link EditorSession} the number shortcuts touch.
 *
 * Extends {@link EventEditSession} so the event branch can call `selectedEvents`/`transformEvents`
 * directly; the note branch additionally needs `transformSelection`, which the session provides.
 */
export interface NumberShortcutSession extends EventEditSession {
  transformSelection(label: string, change: (note: Note, entry: { lineIndex: number; index: number; note: Note }) => Note): void;
}

/**
 * Applies the two numeric-key shortcuts.
 *
 * `NumberMirror` negates the value (note X, or an event's two endpoint values) and `NumberFill`
 * sets an alpha event's tail to 255. Returns `false` when the current selection does not support
 * the shortcut, so the caller can fall through to other key handling.
 */
export function applyNumberShortcut(session: NumberShortcutSession, action: string): boolean {
  if (!['NumberMirror', 'NumberFill'].includes(action)) return false;
  if (session.focus === 'notes' && session.selection.size === 1) {
    session.transformSelection(action === 'NumberMirror' ? '镜像音符 X' : '切换音符上下侧', note => action === 'NumberMirror'
      ? { ...note, positionX: -note.positionX }
      : { ...note, above: noteIsAbove(note) ? note.type === 2 ? 0 : 2 : 1 });
    return true;
  }
  if (session.focus !== 'events' || session.eventSelection.size !== 1) return false;
  const entry = selectedEvents(session)[0]; if (!entry) return false;
  if (entry.type === 'alphaEvents') {
    const value = action === 'NumberMirror' ? 0 : 255;
    transformEvents(session, '快捷填充透明度尾值', (event: ChartEvent) => ({ ...event, end: value, ...(event.inst ? { start: value } : {}) }));
    return true;
  }
  if (action !== 'NumberMirror' || entry.type === 'paintEvents' || !Number.isFinite(entry.event.start) || !Number.isFinite(entry.event.end)) return false;
  // Only numeric tracks reach here: `paintEvents` returned above and `Number.isFinite` rejects the
  // colour arrays and text payloads that the other extended tracks carry.
  transformEvents(session, '事件首尾数值取反', (event: ChartEvent) => ({ ...event, start: -(event.start as number), end: -(event.end as number) }));
  return true;
}
