import { beatValue } from '../core/beat.ts';
import type { AnyEventType, Chart, ChartEvent, Note } from '../core/types.ts';

/** A clipboard event paired with the track it belongs to. */
export interface ClipboardEventEntry {
  type: AnyEventType;
  event: ChartEvent;
}

/** The clipboard payload itself: the items plus the line each item was copied from. */
export interface ClipboardPayload {
  notes: Note[];
  noteLines: number[];
  events: ClipboardEventEntry[];
  eventLines: number[];
}

/** One remembered clipboard group, as stored in IndexedDB. */
export interface ClipboardEntry extends ClipboardPayload {
  id: string;
  pinned: boolean;
  name: string;
  source: string;
  line: number;
  created: number;
}

/**
 * The session members the clipboard history reads and writes.
 *
 * Spelled out structurally rather than importing `EditorSession`, so the history depends only on what
 * it actually touches. `clipboardVisible` is marked optional because the session creates it on the
 * first copy instead of declaring it up front.
 */
export interface ClipboardHistorySession {
  clipboard: Note[];
  clipboardNoteLines: number[];
  eventClipboard: ClipboardEventEntry[];
  eventClipboardLines: number[];
  clipboardVisible?: boolean;
  chart: Chart;
  lineIndex: number;
}

/**
 * The `change` event carries two extra fields the clipboard panel reads; `Event` has no place for
 * them, so the dispatched event is viewed through this intersection.
 */
type ClipboardChangeEvent = Event & { persist: boolean; reason: string };

/**
 * `Array.prototype.findLastIndex` is ES2023 while the project's `lib` stops at ES2022, so the method
 * is missing from the declared array type even though Node provides it at runtime. Re-adding just
 * that member here keeps the call type-checked without widening `lib` for the whole project.
 */
type LastIndexSearch<T> = { findLastIndex(predicate: (value: T, index: number, array: T[]) => boolean, thisArg?: unknown): number };

export class ClipboardHistory extends EventTarget {
  // Every field is declared explicitly, including the ones assigned in the constructor: an
  // unannotated `[]` would be inferred as `never[]` and reject every entry pushed into it.
  limit: number;
  entries: ClipboardEntry[];
  enabled: boolean;
  revision: number;
  current: ClipboardPayload;
  activeId: string | null;

  constructor(limit: number = 20) {
    super(); this.limit = limit; this.entries = []; this.enabled = true; this.revision = 0;
    this.current = { notes: [], noteLines: [], events: [], eventLines: [] }; this.activeId = null;
  }

  changed(persist: boolean = true, reason: string = ''): void { this.revision++; const event = new Event('change') as ClipboardChangeEvent; event.persist = persist; event.reason = reason; this.dispatchEvent(event); }

  restore(entries: unknown): void {
    if (this.revision || !Array.isArray(entries)) return;
    // Untrusted data read back from IndexedDB: kept as `unknown[]` so each record is checked below
    // rather than asserted into `ClipboardEntry` up front.
    const saved: unknown[] = entries;
    const ids = new Set<string>();
    this.entries = saved.filter((entry: unknown): entry is ClipboardEntry => {
      if (!entry || typeof entry !== 'object') return false;
      const record = entry as Record<string, unknown>;
      if (typeof record.id !== 'string' || ids.has(record.id) || !Array.isArray(record.notes) || !Array.isArray(record.events) || !(record.notes.length + record.events.length)) return false;
      try {
        for (const item of [...record.notes, ...record.events.map(item => item.event)]) { beatValue(item.startTime); beatValue(item.endTime); }
      } catch { return false; }
      ids.add(record.id); return true;
    }).slice(0, this.limit).map(entry => ({ ...structuredClone(entry), pinned: Boolean(entry.pinned) }));
    this.dispatchEvent(new Event('change'));
  }

  remember(session: ClipboardHistorySession): void {
    this.current = structuredClone({ notes: session.clipboard, noteLines: session.clipboardNoteLines ?? [], events: session.eventClipboard, eventLines: session.eventClipboardLines ?? [] });
    this.activeId = null;
    if (this.enabled && this.current.notes.length + this.current.events.length) {
      const signature = JSON.stringify(this.current);
      const previous = this.entries.find(entry => JSON.stringify({ notes: entry.notes, noteLines: entry.noteLines ?? [], events: entry.events, eventLines: entry.eventLines ?? [] }) === signature);
      if (previous) this.entries = this.entries.filter(entry => entry !== previous);
      const entry: ClipboardEntry = { ...structuredClone(this.current), id: previous?.id ?? crypto.randomUUID(), pinned: previous?.pinned ?? false,
        name: previous?.name ?? '', source: session.chart.META.name || '未命名谱面', line: session.lineIndex, created: Date.now() };
      if (this.entries.length >= this.limit) {
        const oldest = (this.entries as ClipboardEntry[] & LastIndexSearch<ClipboardEntry>).findLastIndex(entry => !entry.pinned);
        if (oldest >= 0) this.entries.splice(oldest, 1);
      }
      if (this.entries.length < this.limit) { this.entries.unshift(entry); this.activeId = entry.id; }
    }
    this.changed(this.enabled && this.activeId !== null);
  }

  attach(session: ClipboardHistorySession): void {
    session.clipboard = structuredClone(this.current.notes); session.clipboardNoteLines = structuredClone(this.current.noteLines ?? session.clipboard.map(() => session.lineIndex));
    session.eventClipboard = structuredClone(this.current.events); session.eventClipboardLines = structuredClone(this.current.eventLines ?? session.eventClipboard.map(() => session.lineIndex));
    session.clipboardVisible = Boolean(this.current.notes.length + this.current.events.length);
  }

  use(session: ClipboardHistorySession, id: string): boolean {
    if (!this.enabled) return false;
    const entry = this.entries.find(entry => entry.id === id); if (!entry) return false;
    this.current = structuredClone({ notes: entry.notes, noteLines: entry.noteLines ?? [], events: entry.events, eventLines: entry.eventLines ?? [] }); this.activeId = id;
    this.attach(session); this.changed(false); return true;
  }

  clearCurrent(session: ClipboardHistorySession): void { this.current = { notes: [], noteLines: [], events: [], eventLines: [] }; this.activeId = null; this.attach(session); this.changed(false); }
  pin(id: string): void { const entry = this.entries.find(entry => entry.id === id); if (entry) { entry.pinned = !entry.pinned; this.changed(); } }
  rename(id: string, name: string): void { const entry = this.entries.find(entry => entry.id === id); if (entry) { entry.name = String(name).trim().slice(0, 40); this.changed(true, 'rename'); } }
  remove(id: string): void { this.entries = this.entries.filter(entry => entry.id !== id); if (this.activeId === id) this.activeId = null; this.changed(); }
  clearUnpinned(): void { this.entries = this.entries.filter(entry => entry.pinned); if (!this.entries.some(entry => entry.id === this.activeId)) this.activeId = null; this.changed(); }
}
