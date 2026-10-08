import { cutSelectedEvents, stickSelectedEvents } from '../application/event-tools.ts';
import type { CutResult, CutOptions } from '../application/event-tools.ts';
import type { EventEditSession } from '../application/event-commands.ts';
import type { TempoMap } from '../core/tempo.ts';

/** The notification levels the editor's status feed defines. */
export type NotifyLevel = 'success' | 'warning' | 'error';

/** Posts one status message; matches `app.ts`'s `notify(message, level, duration)`. */
export type Notify = (message: string, level?: NotifyLevel, duration?: number) => void;

/**
 * What {@link runEventTool} needs from the editing session.
 *
 * `division`, `cutDensity` and `tempo` are attached to the session by `renderSession` in `app.ts`
 * rather than declared on `EditorSession` itself, so they are spelled out here; `tempo` is the same
 * `TempoMap` the timeline measures with, which is what `CutOptions` expects.
 */
type EventToolSession = EventEditSession & { division: number; cutDensity: number; tempo?: TempoMap };

export function runEventTool(session: EventToolSession, action: string, notify: Notify, beat: number): void {
  try {
    const options: CutOptions = { division: session.division, density: session.cutDensity, beat, tempo: session.tempo, factor: session.line?.bpmfactor ?? 1 };
    // `stickSelectedEvents` only reports `changed` and `skipped`; the generated count it lacks is
    // never read on that branch, and the literal keeps the union's third member present.
    const result: CutResult = action === 'cut' ? cutSelectedEvents(session, options) : { generated: 0, ...stickSelectedEvents(session) };
    const message = result.changed ? action === 'cut' ? `已将 ${result.changed} 个事件切割为 ${result.generated} 段` : `已粘合 ${result.changed} 个事件` : '没有可处理的事件';
    notify(`${message}${result.skipped ? `；跳过 ${result.skipped} 个不适用的事件` : ''}`, result.changed ? 'success' : 'warning');
  } catch (error) { notify(error instanceof Error ? error.message : String(error), 'error'); }
}
