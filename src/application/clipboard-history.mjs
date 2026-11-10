import { beatValue } from '../core/beat.mjs';

export class ClipboardHistory extends EventTarget {
  constructor(limit = 20) {
    super(); this.limit = limit; this.entries = []; this.enabled = true; this.revision = 0;
    this.current = { notes: [], noteLines: [], events: [], eventLines: [] }; this.activeId = null;
  }

  changed(persist = true, reason = '') { this.revision++; const event = new Event('change'); event.persist = persist; event.reason = reason; this.dispatchEvent(event); }

  restore(entries) {
    if (this.revision || !Array.isArray(entries)) return;
    const ids = new Set();
    this.entries = entries.filter(entry => {
      if (!entry || typeof entry.id !== 'string' || ids.has(entry.id) || !Array.isArray(entry.notes) || !Array.isArray(entry.events) || !(entry.notes.length + entry.events.length)) return false;
      try {
        for (const item of [...entry.notes, ...entry.events.map(entry => entry.event)]) { beatValue(item.startTime); beatValue(item.endTime); }
      } catch { return false; }
      ids.add(entry.id); return true;
    }).slice(0, this.limit).map(entry => ({ ...structuredClone(entry), pinned: Boolean(entry.pinned) }));
    this.dispatchEvent(new Event('change'));
  }

  remember(session) {
    this.current = structuredClone({ notes: session.clipboard, noteLines: session.clipboardNoteLines ?? [], events: session.eventClipboard, eventLines: session.eventClipboardLines ?? [], lineOrder: session.clipboardLineOrder ?? [], ...(session.clipboardBounds ? { bounds: session.clipboardBounds } : {}) });
    this.activeId = null;
    if (this.enabled && this.current.notes.length + this.current.events.length) {
      const signature = JSON.stringify(this.current);
      const previous = this.entries.find(entry => JSON.stringify({ notes: entry.notes, noteLines: entry.noteLines ?? [], events: entry.events, eventLines: entry.eventLines ?? [], lineOrder: entry.lineOrder ?? [], ...(entry.bounds ? { bounds: entry.bounds } : {}) }) === signature);
      if (previous) this.entries = this.entries.filter(entry => entry !== previous);
      const entry = { ...structuredClone(this.current), id: previous?.id ?? crypto.randomUUID(), pinned: previous?.pinned ?? false,
        name: previous?.name ?? '', source: session.chart.META.name || '未命名谱面', line: session.lineIndex, created: Date.now() };
      if (this.entries.length >= this.limit) {
        const oldest = this.entries.findLastIndex(entry => !entry.pinned);
        if (oldest >= 0) this.entries.splice(oldest, 1);
      }
      if (this.entries.length < this.limit) { this.entries.unshift(entry); this.activeId = entry.id; }
    }
    this.changed(this.enabled && this.activeId !== null);
  }

  attach(session) {
    session.clipboard = structuredClone(this.current.notes); session.clipboardNoteLines = structuredClone(this.current.noteLines ?? session.clipboard.map(() => session.lineIndex));
    session.eventClipboard = structuredClone(this.current.events); session.eventClipboardLines = structuredClone(this.current.eventLines ?? session.eventClipboard.map(() => session.lineIndex));
    session.clipboardLineOrder = structuredClone(this.current.lineOrder ?? []);
    session.clipboardBounds = structuredClone(this.current.bounds ?? null);
    session.clipboardVisible = Boolean(this.current.notes.length + this.current.events.length);
  }

  use(session, id) {
    if (!this.enabled) return false;
    const entry = this.entries.find(entry => entry.id === id); if (!entry) return false;
    this.current = structuredClone({ notes: entry.notes, noteLines: entry.noteLines ?? [], events: entry.events, eventLines: entry.eventLines ?? [], lineOrder: entry.lineOrder ?? [], ...(entry.bounds ? { bounds: entry.bounds } : {}) }); this.activeId = id;
    this.attach(session); this.changed(false); return true;
  }

  clearCurrent(session) { this.current = { notes: [], noteLines: [], events: [], eventLines: [] }; this.activeId = null; this.attach(session); this.changed(false); }
  pin(id) { const entry = this.entries.find(entry => entry.id === id); if (entry) { entry.pinned = !entry.pinned; this.changed(); } }
  rename(id, name) { const entry = this.entries.find(entry => entry.id === id); if (entry) { entry.name = String(name).trim().slice(0, 40); this.changed(true, 'rename'); } }
  remove(id) { this.entries = this.entries.filter(entry => entry.id !== id); if (this.activeId === id) this.activeId = null; this.changed(); }
  clearUnpinned() { this.entries = this.entries.filter(entry => entry.pinned); if (!this.entries.some(entry => entry.id === this.activeId)) this.activeId = null; this.changed(); }
}
