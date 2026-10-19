/**
 * Label value scrubbing for inspector fields.
 *
 * Behavior follows the draggable-number-input component: press a property name
 * and drag horizontally to change its value. Modifier keys scale the increment
 * (Shift is coarse and snaps, Alt is fine), the value is previewed live while
 * dragging and applied as one undo step on release.
 *
 * The pointer is locked with the Pointer Lock API as soon as the drag starts, so
 * the cursor stays where it was pressed and the drag keeps reporting raw deltas
 * past the window and screen edges. A fixed drag cursor is drawn at the press
 * point because the system pointer is hidden while locked.
 */

/** How one modifier key scales a drag. */
export interface DragModifier {
  multiplier: number;
  sensitivity: number;
}

/** Every named modifier profile in {@link DRAG_MODIFIERS}. */
export type DragModifierName = 'default' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey';

/** The keyboard state {@link dragModifier} reads. */
export interface DragModifierState {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

export const DRAG_MODIFIERS: Record<DragModifierName, DragModifier> = {
  default: { multiplier: 1, sensitivity: 1 },
  shiftKey: { multiplier: 10, sensitivity: 0.5 },
  ctrlKey: { multiplier: 1, sensitivity: 1 },
  metaKey: { multiplier: 1, sensitivity: 1 },
  altKey: { multiplier: 0.1, sensitivity: 1 },
};

export const DRAG_MODIFIER_KEYS: readonly string[] = ['Shift', 'Control', 'Alt', 'Meta'];
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const GHOST_SHAPES: readonly (readonly [string, Readonly<Record<string, string>>])[] = [
  ['path', { d: 'M3.5 12l5-4.4v8.8z' }],
  ['path', { d: 'M20.5 12l-5-4.4v8.8z' }],
  ['line', { x1: '7.5', y1: '12', x2: '16.5', y2: '12' }],
];

export function dragModifier(event: DragModifierState | null | undefined): DragModifier {
  if (event?.shiftKey) return DRAG_MODIFIERS.shiftKey;
  if (event?.ctrlKey) return DRAG_MODIFIERS.ctrlKey;
  if (event?.metaKey) return DRAG_MODIFIERS.metaKey;
  if (event?.altKey) return DRAG_MODIFIERS.altKey;
  return DRAG_MODIFIERS.default;
}

/** The options {@link dragValue} turns one horizontal movement into a value. */
export interface DragValueOptions {
  start: number;
  movement: number;
  unit?: number;
  snap?: number;
  modifier?: DragModifier;
  minimum?: number;
  maximum?: number;
  integer?: boolean;
}

/** Value for a horizontal pointer movement; the multiplier doubles as a snap grid. */
export function dragValue({ start, movement, unit = 1, snap, modifier = DRAG_MODIFIERS.default, minimum = -Infinity, maximum = Infinity, integer = false }: DragValueOptions): number {
  const quantum = (snap ?? unit) * modifier.multiplier;
  let value = start + movement * unit * modifier.sensitivity * modifier.multiplier;
  if (quantum > 0) value = Math.round(value / quantum) * quantum;
  if (integer) value = Math.round(value);
  if (Number.isFinite(minimum)) value = Math.max(minimum, value);
  if (Number.isFinite(maximum)) value = Math.min(maximum, value);
  value = Number(value.toFixed(10));
  return Object.is(value, -0) ? 0 : value;
}

/** A numeric option, or a getter re-read on every drag step. */
export type DragMagnitude = number | (() => number);

const magnitude = (option: DragMagnitude): number => {
  const value = Number(typeof option === 'function' ? option() : option);
  return Number.isFinite(value) && value > 0 ? value : 1;
};

const globalDocument = (): Document | null => typeof document === 'undefined' ? null : document;
const globalWindow = (): Window | Document | null => (typeof window === 'undefined' ? null : window) ?? globalDocument();

/** The active gesture, reachable from the global Escape/modifier handlers. */
interface ValueGesture {
  cancel: () => void;
  key: (event: KeyboardEvent) => boolean;
}

/** The in-flight drag state. */
interface ValueDragState {
  pointerId: number;
  origin: { x: number; y: number };
  start: number;
  movement: number;
  value: number;
  active: boolean;
  locked: boolean;
  ghost: HTMLElement | null;
  event: PointerEvent | KeyboardEvent;
}

let currentGesture: ValueGesture | null = null;
export const cancelValueDrag = (): void => { currentGesture?.cancel(); };
export const handleValueDragKey = (event: KeyboardEvent): boolean => currentGesture?.key(event) ?? false;

/** What {@link attachDraggableValue} needs from the label's field. */
export interface AttachDraggableValueOptions {
  label?: HTMLElement | null;
  input?: HTMLInputElement | null;
  unit?: DragMagnitude;
  snap?: DragMagnitude;
  minimum?: number;
  maximum?: number;
  integer?: boolean;
  read?: () => number;
  format?: (value: number) => string;
  preview?: (value: number) => boolean | void;
  commit?: (value: number) => void;
  cancel?: () => void;
  threshold?: number;
  hint?: string;
  canStart?: () => boolean;
}

/**
 * Turn `label` into a horizontal value scrubber for `input`.
 * Returns a dispose function that detaches the gesture listeners.
 *
 * read()        current numeric value
 * format(value) text placed into the input while dragging
 * preview(value) live preview; called for every accepted movement step
 * commit(value)  final value; called once when the drag is released
 * cancel()       drag aborted (Escape, pointercancel, lost pointer lock)
 *
 * `unit` is the value change per horizontal pixel and `snap` the value grid it
 * rounds to (defaults to `unit`, so Shift snaps to ten units). Either may be a
 * function, which is re-read on every step so a sensitivity setting applies to
 * the next gesture without rebuilding the field.
 */
export function attachDraggableValue({
  label, input,
  unit = 1, snap,
  minimum = -Infinity, maximum = Infinity, integer = false,
  read, format = value => String(value),
  preview = () => {}, commit = () => {}, cancel = () => {},
  threshold = 3, hint = '', canStart = () => true,
}: AttachDraggableValueOptions = {}): () => void {
  if (!label || !input || typeof read !== 'function') return () => {};
  let drag: ValueDragState | null = null;
  let swallowClick = false;

  // A drag ends with the same click the label would use to focus its input. Keep
  // shortcuts working after the gesture by dropping that click.
  const onClick = (event: MouseEvent): void => {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (drag || (event.button ?? 0) !== 0 || event.isPrimary === false) return;
    // Only the label text itself starts a drag; the input, buttons and sample
    // panel keep their native behavior.
    const target = event.target as Element | null;
    if (event.target !== label && target?.closest?.('input, select, textarea, button, a, canvas')) return;
    if (!canStart()) return;
    const value = Number(read());
    if (!Number.isFinite(value)) return;
    cancelValueDrag();
    event.preventDefault();
    swallowClick = false;
    drag = { pointerId: event.pointerId, origin: { x: Number(event.clientX) || 0, y: Number(event.clientY) || 0 }, start: value, movement: 0, value, active: false, locked: false, ghost: null, event };
    currentGesture = { cancel: () => finish(false), key: onKey };
    const win = globalWindow();
    win?.addEventListener('pointermove', onPointerMove as EventListener, true);
    win?.addEventListener('pointerup', onPointerUp as EventListener, true);
    win?.addEventListener('pointercancel', onPointerCancel, true);
    win?.addEventListener('blur', onBlur);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    if (label.isConnected === false) { finish(false); return; }
    if (event.pointerType === 'touch' && event.cancelable !== false) event.preventDefault?.();
    // Chromium reports buttons: 0 on moves dispatched while the pointer is locked,
    // so the button state must never be used to end the gesture.
    const movement = drag.locked ? drag.movement + (Number(event.movementX) || 0) : (Number(event.clientX) || 0) - drag.origin.x;
    drag.event = event;
    if (!drag.active) {
      if (Math.abs(movement) < threshold) return;
      beginDrag(event);
      if (!drag) return;
    }
    drag.movement = movement;
    report();
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    finish(drag.active);
  };

  const onPointerCancel = (): void => { if (drag) finish(false); };
  const onBlur = (): void => { if (drag) finish(false); };
  // A second pointerdown means the previous release was missed.
  const onExternalDown = (): void => { if (drag) finish(drag.active); };

  const beginDrag = (event: PointerEvent): void => {
    if (!drag) return;
    drag.active = true;
    drag.movement = 0;
    drag.value = drag.start;
    drag.event = event;
    label.classList?.add('dragging');
    const doc = globalDocument();
    doc?.documentElement?.classList?.add('value-dragging');
    // Drop focus before anything starts: a blur-triggered inspector rebuild would
    // replace the dragged label in the middle of the gesture.
    const active = doc?.activeElement as HTMLElement | null;
    if (active && active !== doc?.body && active !== doc?.documentElement && typeof active.blur === 'function') active.blur();
    if (event.pointerType !== 'touch') showGhost();
    // Escape and modifier changes are captured on the window so the sampler's own
    // Escape handler cannot swallow them.
    const win = globalWindow();
    win?.addEventListener('keydown', onKey as unknown as EventListener, true);
    win?.addEventListener('keyup', onKey as unknown as EventListener, true);
    win?.addEventListener('pointerdown', onExternalDown, true);
    // Start the live preview immediately so the value draft owns the inspector
    // for the whole gesture, even before the first value change.
    if (preview(drag.value) === false) { finish(false); return; }
    // Touch input has no pointer to lock; a finger drag just tracks its position.
    if (event.pointerType !== 'touch') lockPointer();
  };

  // Pointer Lock keeps the cursor at the press point and reports raw deltas past
  // the window and screen edges. The lock change is registered first so a lock
  // that engages inside requestPointerLock() is not missed.
  const lockPointer = (): void => {
    if (!label.requestPointerLock) return;
    globalDocument()?.addEventListener('pointerlockchange', onLockChange);
    const state = drag;
    try {
      const request: unknown = label.requestPointerLock();
      (request as Promise<void> | undefined)?.then?.(() => {
        if (drag !== state && globalDocument()?.pointerLockElement === label) globalDocument()?.exitPointerLock?.();
      }, () => {});
    } catch { /* Continue as a finite drag when pointer lock is unavailable. */ }
  };

  const onLockChange = (): void => {
    if (!drag) return;
    const doc = globalDocument();
    if (doc?.pointerLockElement === label) {
      drag.locked = true;
      return;
    }
    // Browsers may consume Escape without delivering a key event to the page.
    // Only a pointer release commits; losing the lock always cancels the draft.
    if (drag.locked) finish(false);
  };

  const onKey = (event: KeyboardEvent): boolean => {
    if (!drag?.active || !['keydown', 'keyup'].includes(event.type)) return false;
    event.preventDefault?.(); event.stopImmediatePropagation?.(); event.stopPropagation?.();
    if (event.key === 'Escape') { finish(false); return true; }
    if (!DRAG_MODIFIER_KEYS.includes(event.key)) return true;
    drag.event = event;
    report();
    return true;
  };

  const report = (): void => {
    if (!drag?.active) return;
    const value = dragValue({
      start: drag.start, movement: drag.movement, unit: magnitude(unit), snap: snap === undefined ? undefined : magnitude(snap),
      minimum, maximum, integer, modifier: dragModifier(drag.event),
    });
    if (value === drag.value) return;
    drag.value = value;
    if (input.isConnected !== false) input.value = format(value);
    if (preview(value) === false) finish(false);
  };

  const showGhost = (): void => {
    if (drag?.ghost) return;
    const doc = globalDocument();
    if (!drag || !doc?.body) return;
    const ghost = doc.createElement('div');
    ghost.className = 'drag-cursor-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.left = `${drag.origin.x}px`;
    ghost.style.top = `${drag.origin.y}px`;
    const svg = doc.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    for (const [tag, attributes] of GHOST_SHAPES) {
      const shape = doc.createElementNS(SVG_NAMESPACE, tag);
      for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
      shape.setAttribute('fill', '#f7f7f7');
      shape.setAttribute('stroke', '#101010');
      shape.setAttribute('stroke-width', '1.3');
      svg.append(shape);
    }
    ghost.append(svg);
    doc.body.append(ghost);
    drag.ghost = ghost;
  };

  const finish = (apply: boolean): void => {
    if (!drag) return;
    const state = drag;
    drag = null;
    currentGesture = null;
    const win = globalWindow();
    win?.removeEventListener('pointermove', onPointerMove as EventListener, true);
    win?.removeEventListener('pointerup', onPointerUp as EventListener, true);
    win?.removeEventListener('pointercancel', onPointerCancel, true);
    win?.removeEventListener('pointerdown', onExternalDown, true);
    win?.removeEventListener('blur', onBlur);
    win?.removeEventListener('keydown', onKey as unknown as EventListener, true);
    win?.removeEventListener('keyup', onKey as unknown as EventListener, true);
    const doc = globalDocument();
    doc?.removeEventListener('pointerlockchange', onLockChange);
    if (doc?.pointerLockElement === label) doc.exitPointerLock?.();
    label.classList?.remove('dragging');
    doc?.documentElement?.classList?.remove('value-dragging');
    state.ghost?.remove?.();
    if (!state.active) { input.focus?.({ preventScroll: true }); return; }
    swallowClick = true;
    if (apply && state.value !== state.start) { commit(state.value); return; }
    if (input.isConnected !== false) input.value = format(state.start);
    cancel();
  };

  label.classList?.add('draggable-value');
  if (hint) label.title = hint;
  label.addEventListener('pointerdown', onPointerDown);
  label.addEventListener('click', onClick);
  return () => {
    finish(false);
    label.removeEventListener?.('pointerdown', onPointerDown);
    label.removeEventListener?.('click', onClick);
    label.classList?.remove('draggable-value');
  };
}
