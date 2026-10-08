import { shortcutKey } from '../core/preferences.ts';
import type { ShortcutEvent } from '../core/preferences.ts';
import type { Chart } from '../core/types.ts';
import type { EditorSession } from '../application/session.ts';

/**
 * The key event the gesture listens to: a shortcut event (`src/core/preferences.ts` models it as
 * optional fields because the tests pass plain literals) plus the two members the handler itself
 * uses. Declared structurally for the same reason `ShortcutEvent` is — a real `KeyboardEvent`
 * satisfies it, and so do the lightweight objects the tests pass.
 */
export interface PasteKeyEvent extends ShortcutEvent {
  repeat?: boolean;
  preventDefault: () => void;
}

/**
 * What a long press of the clipboard-history hotkey acts on: the editor state the gesture was
 * started in. `layer` stays `unknown` because `Timeline` is still unannotated, so nothing more
 * precise than "some value compared with `===`" can be said about it here.
 */
export interface PasteContext {
  session: EditorSession;
  chart: Chart;
  lineIndex: number;
  targetLineIndex: number;
  layer: unknown;
  beat: number;
}

/** The pending long press; `timer` stays absent when the scheduler itself threw. */
export interface PastePending {
  context: PasteContext;
  key: string;
  opened: boolean;
  /**
   * The modifiers that were held when the press began, so releasing the hotkey is recognised no
   * matter which modifier the user lets go of first.
   */
  releaseKeys: string[];
  timer?: unknown;
}

/** The collaborators and timings the gesture is built from. */
export interface PasteGestureOptions {
  paste: (context: PasteContext) => void;
  open: () => void;
  valid: (context: PasteContext) => boolean;
  delay?: number;
  schedule?: (callback: () => void, milliseconds: number) => unknown;
  unschedule?: (timer: unknown) => void;
  reportError?: (error: Error) => void;
}

/**
 * Runs the clipboard-history hotkey as a press gesture: a short press pastes, a long press opens
 * the history instead. The callbacks and timer functions are injected so a host can drive it.
 */
export class PasteGesture {
  // Declared with a definite-assignment assertion because the constructor assigns them through
  // `Object.assign`, which the compiler cannot read. Without the declarations the fields would be
  // missing on `this`; without the `!` they would be reported as never assigned.
  paste!: PasteGestureOptions['paste'];
  open!: PasteGestureOptions['open'];
  valid!: PasteGestureOptions['valid'];
  delay!: number;
  schedule!: (callback: () => void, milliseconds: number) => unknown;
  unschedule!: (timer: unknown) => void;
  reportError!: (error: Error) => void;
  pending: PastePending | null;

  constructor({ paste, open, valid, delay = 450, schedule = (callback: () => void, milliseconds: number): unknown => setTimeout(callback, milliseconds), unschedule = (timer: unknown): void => clearTimeout(timer as number), reportError = (error: Error): void => console.error(error) }: PasteGestureOptions) {
    Object.assign(this, { paste, open, valid, delay, schedule, unschedule, reportError }); this.pending = null;
  }

  down(event: PasteKeyEvent, context: PasteContext): void {
    event.preventDefault();
    if (this.pending || event.repeat) return;
    const pending: PastePending = { context, key: shortcutKey(event), opened: false, releaseKeys: ['CONTROL', 'META', ...(event.shiftKey ? ['SHIFT'] : []), ...(event.altKey ? ['ALT'] : [])] };
    this.pending = pending;
    try {
      pending.timer = this.schedule(() => {
        if (this.pending !== pending) return;
        try {
          if (!this.valid(pending.context)) { this.cancel(); return; }
          pending.opened = true; this.open();
        } catch (error) { this.cancel(); this.reportError(error as Error); }
      }, this.delay);
    } catch (error) { this.pending = null; this.reportError(error as Error); }
  }

  up(event: PasteKeyEvent): boolean {
    const pending = this.pending;
    if (!pending || ![pending.key, ...pending.releaseKeys].includes(shortcutKey(event))) return false;
    event.preventDefault(); this.cancel();
    if (!pending.opened && this.valid(pending.context)) this.paste(pending.context);
    return true;
  }

  cancel(): void {
    const pending = this.pending; this.pending = null;
    if (pending?.timer !== undefined) {
      try { this.unschedule(pending.timer); } catch (error) { this.reportError(error as Error); }
    }
  }
}
