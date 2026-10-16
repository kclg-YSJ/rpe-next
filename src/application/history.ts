import type { Chart } from '../core/types.ts';

/** The selection snapshots an undo entry carries, so undoing also restores what was selected. */
export interface SelectionSnapshot {
  beforeSelection?: unknown;
  afterSelection?: unknown;
}

/** One reversible document change. */
export interface HistoryCommand {
  label: string;
  before: Chart;
  after: Chart;
  beforeSelection?: unknown;
  afterSelection?: unknown;
}

/**
 * Undo/redo stack over whole-document snapshots.
 *
 * Documents are treated as immutable — every edit builds a new chart object — so a command only
 * has to remember two references, and `dirty` is a cheap identity check against the last save.
 */
export class History {
  document: Chart;
  savedDocument: Chart;
  undoStack: HistoryCommand[];
  redoStack: HistoryCommand[];
  limit: number;

  constructor(document: Chart, limit = 150) {
    this.document = document;
    this.savedDocument = document;
    this.undoStack = [];
    this.redoStack = [];
    this.limit = limit;
  }

  commit(label: string, next: Chart, selectionState: SelectionSnapshot = {}): boolean {
    if (next === this.document) return false;
    this.undoStack.push({ label, before: this.document, after: next, ...selectionState });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.document = next;
    this.redoStack = [];
    return true;
  }

  undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;
    this.redoStack.push(command);
    this.document = command.before;
    return true;
  }

  redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;
    this.undoStack.push(command);
    this.document = command.after;
    return true;
  }

  markSaved(document: Chart = this.document): void { this.savedDocument = document; }
  get dirty(): boolean { return this.document !== this.savedDocument; }
}
