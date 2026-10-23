import { noteIsAbove } from '../core/chart.mjs';
import { selectedEventEntries, transformEvents } from './event-commands.mjs';
import { t } from '../i18n.mjs';

export function applyNumberShortcut(session, action) {
  if (!['NumberMirror', 'NumberFill'].includes(action)) return false;
  if (session.focus === 'notes' && session.selection.size === 1) {
    session.transformSelection(action === 'NumberMirror' ? t('number-shortcuts.s90113e9') : t('number-shortcuts.s8b8ec87'), note => action === 'NumberMirror'
      ? { ...note, positionX: -note.positionX }
      : { ...note, above: noteIsAbove(note) ? note.type === 2 ? 0 : 2 : 1 });
    return true;
  }
  if (session.focus !== 'events') return false;
  const entries = selectedEventEntries(session); if (entries.length !== 1) return false;
  const entry = entries[0];
  if (entry.type === 'alphaEvents') {
    const value = action === 'NumberMirror' ? 0 : 255;
    transformEvents(session, t('number-shortcuts.sfb6ecc5'), event => ({ ...event, end: value, ...(event.inst ? { start: value } : {}) }));
    return true;
  }
  if (action !== 'NumberMirror' || entry.type === 'paintEvents' || !Number.isFinite(entry.event.start) || !Number.isFinite(entry.event.end)) return false;
  transformEvents(session, t('number-shortcuts.sb70f054'), event => ({ ...event, start: -event.start, end: -event.end }));
  return true;
}
