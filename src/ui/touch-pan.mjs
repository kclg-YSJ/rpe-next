/*
 * Finger gestures for the timeline.
 *
 * A touch that starts on empty timeline space is ambiguous: it can be a tap (keep the desktop
 * click behaviour — place a note, clear the selection) or a drag (pan through time). The gesture
 * stays pending until the finger travels further than TOUCH_SLOP; past that it becomes a pan and
 * the tap action is dropped.
 *
 * Mouse input never reaches this code: it keeps wheel scrolling and rectangle selection.
 */

// CSS pixels a finger may wander before a tap turns into a drag. The editor layout is scaled
// down on phones, so this is deliberately larger than a desktop click slop.
export const TOUCH_SLOP = 18;

export function isTouchPointer(event) {
  return event.pointerType === 'touch';
}

export function touchMoveGesture(event, point, onTap) {
  return {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastY: event.clientY,
    moved: false,
    point,
    onTap
  };
}

/** True once the finger has left the tap slop; panning starts on that same move. */
export function touchGestureMoved(gesture, event) {
  if (!gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > TOUCH_SLOP) gesture.moved = true;
  return gesture.moved;
}

/**
 * Drags the playhead by a vertical pixel delta. The timeline origin is derived from the playhead,
 * so seeking is what pans the view; `scale` is pixels per second at the current line's factor.
 */
export function panTimeline(timeline, dy) {
  if (!dy) return false;
  const factor = timeline.factor;
  const seconds = timeline.tempo.seconds(timeline.origin, factor) - dy / timeline.scale;
  timeline.onSeekBeat?.(timeline.tempo.beat(Math.max(0, seconds), factor));
  return true;
}
