import { shortcutKey } from '../core/preferences.ts';

// Keyboard helpers shared by the global shortcut handler.
//
// Every target is typed as `Element | null` but treated defensively: these run from listeners on
// `document`, where the target may be a non-element (the document itself) and the test suite passes
// plain objects standing in for inputs, so `closest` is probed rather than assumed.

/**
 * A minimal stand-in for the parts of `EventTarget` these helpers inspect.
 *
 * Exported so callers can name it when narrowing `event.target` (which is `EventTarget | null`) down
 * to the members actually probed. The helpers still test every member before using it, so a target
 * that is not really an element remains safe.
 */
export interface ShortcutTarget {
  isContentEditable?: boolean;
  closest?(selector: string): { type?: string; blur?(): void } | null;
  blur?(): void;
}

function closest(target: ShortcutTarget | null | undefined, selector: string): { type?: string; blur?(): void } | null {
  return typeof target?.closest === 'function' ? target.closest(selector) : null;
}

/** Whether the target is a text field that owns the keystroke, so shortcuts must stand down. */
export function isTextEntry(target: ShortcutTarget | null | undefined): boolean {
  if (target?.isContentEditable || closest(target, 'textarea,[contenteditable="true"],[role="textbox"]')) return true;
  const input = closest(target, 'input');
  // Buttons, checkboxes and other non-typing inputs are excluded, because those should still let
  // shortcuts through — only controls that consume typed characters count as text entry.
  return Boolean(input && !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'file', 'color'].includes(input.type ?? ''));
}

/** Whether this keydown is the unmodified space bar outside a text field, i.e. play/pause. */
export function isPlaybackSpace(event: KeyboardEvent): boolean {
  return shortcutKey(event) === 'SPACE' && !event.ctrlKey && !event.metaKey && !event.altKey && !isTextEntry(event.target as ShortcutTarget | null);
}

/** Whether the target accepts free text, where editing keys must reach the field untouched. */
export function isTypingText(target: ShortcutTarget | null | undefined): boolean {
  if (target?.isContentEditable || closest(target, 'textarea,[contenteditable="true"],[role="textbox"]')) return true;
  const input = closest(target, 'input');
  return Boolean(input && ['text', 'search', 'url', 'email', 'password', 'tel'].includes(input.type ?? ''));
}

/**
 * Drops focus from a control so the next keystroke reaches the global handler.
 *
 * Text fields are left alone — blurring one mid-edit would discard what the user is typing.
 */
export function releaseShortcutFocus(target: ShortcutTarget | null | undefined): void {
  if (!isTypingText(target) && closest(target, 'input,select,button')) target?.blur?.();
}
