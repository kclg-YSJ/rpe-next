import { beatValue } from './beat.ts';
import type { TempoMap } from './tempo.ts';
import type { AnyEventType, Note } from './types.ts';

/** How far ahead of its start time a note becomes visible, expressed in beats. */
export function visibleBeats(note: Note, tempo: TempoMap, factor = 1): number {
  const start = beatValue(note.startTime);
  return start - tempo.beat(tempo.seconds(start, factor) - (note.visibleTime ?? 999999), factor);
}

/** The wall-clock length of the lead-in over `beats`, for the seconds-based visible-time field. */
export function visibleSeconds(note: Note, beats: number, tempo: TempoMap, factor = 1): number {
  const start = beatValue(note.startTime);
  return tempo.seconds(start, factor) - tempo.seconds(start - Math.max(0, beats), factor);
}

/**
 * Per-track step for one wheel notch in the event inspector.
 *
 * `Partial` because only the numeric tracks have a step: colour, paint, text, incline and gif
 * tracks are not wheel-adjustable, and that absence is meaningful to the inspector.
 */
export const EVENT_WHEEL_STEPS: Partial<Record<AnyEventType, number>> = { moveXEvents: 5, moveYEvents: 5, rotateEvents: 0.5, alphaEvents: 5, speedEvents: 0.1, scaleXEvents: 0.1, scaleYEvents: 0.1 };
