import test from 'node:test';
import assert from 'node:assert/strict';
import { usesNativeTextShortcut } from '../src/ui/keyboard.ts';
import { CollaborationPanel } from '../src/ui/collaboration.ts';

/**
 * `usesNativeTextShortcut` and `handleChatKey` declare a real `EventTarget`, while these doubles
 * supply only the `type`/`closest`/`isContentEditable` members the two helpers actually read.
 */
function eventTarget(double: unknown): EventTarget {
  const bridged: EventTarget = double as EventTarget;
  return bridged;
}

/**
 * Both helpers declare a full `KeyboardEvent`; these tests pass only the `target`, `key` and
 * modifier/composition flags that are read, so the partial is bridged through `unknown` here.
 */
function keyboardEvent(double: unknown): KeyboardEvent {
  const bridged: KeyboardEvent = double as KeyboardEvent;
  return bridged;
}

const input = (type: string): EventTarget => { const target = { type, closest: (selector: string) => selector === 'input' ? target : null }; return eventTarget(target); };

test('文本和数值框保留原生剪贴板、撤销、删除、选字和焦点导航', () => {
  for (const type of ['text', 'number', 'search', 'email', 'password', 'date', 'time']) {
    const target = input(type);
    for (const modifier of ['ctrlKey', 'metaKey']) for (const key of ['a', 'c', 'x', 'v', 'z', 'y', 'b']) {
      assert.equal(usesNativeTextShortcut(keyboardEvent({ target, key, [modifier]: true })), true, `${type}: ${modifier}+${key}`);
      assert.equal(usesNativeTextShortcut(keyboardEvent({ target, key, [modifier]: true, shiftKey: true })), true);
    }
    for (const key of ['Backspace', 'Delete', 'Insert', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Tab', 'Enter', 'Escape']) {
      assert.equal(usesNativeTextShortcut(keyboardEvent({ target, key })), true, `${type}: ${key}`);
      assert.equal(usesNativeTextShortcut(keyboardEvent({ target, key, shiftKey: true })), true);
    }
  }
});

test('数值输入及输入法不穿透，非文本控件和数值框非输入快捷键仍可用', () => {
  const target = input('number');
  for (const key of ['0', '2', '9', 'e', 'E', '-', '+', '.', ',']) assert.equal(usesNativeTextShortcut(keyboardEvent({ target, key })), true);
  for (const key of [' ', 'q', 'w', 'r', 'i', 'j']) assert.equal(usesNativeTextShortcut(keyboardEvent({ target, key })), false);
  for (const type of ['range', 'checkbox', 'button', 'color']) for (const key of [' ', 'q', 'ArrowLeft', 'c']) assert.equal(usesNativeTextShortcut(keyboardEvent({ target: input(type), key })), false);
  // `usesNativeTextShortcut` reads only `isContentEditable`/`closest` off these two targets.
  const editableTarget: EventTarget = eventTarget({ isContentEditable: true });
  const textareaTarget: EventTarget = eventTarget({ closest: (selector: string) => selector.includes('textarea') ? {} : null });
  for (const target of [input('text'), editableTarget, textareaTarget]) {
    assert.equal(usesNativeTextShortcut(keyboardEvent({ target, key: 'q' })), true);
  }
  for (const state of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) assert.equal(usesNativeTextShortcut(keyboardEvent({ key: 'q', ...state })), true);
});

test('联机斜杠不会从数值框或文本框穿透打开聊天', () => {
  let opened = 0;
  const panel = { client: { active: true }, chatBox: { hidden: true }, openChat: () => opened++ };
  for (const type of ['text', 'number', 'date']) CollaborationPanel.prototype.handleChatKey.call(panel, keyboardEvent({ target: input(type), key: '/' }));
  assert.equal(opened, 0);
  CollaborationPanel.prototype.handleChatKey.call(panel, keyboardEvent({ target: input('range'), key: '/', preventDefault() {}, stopImmediatePropagation() {} }));
  assert.equal(opened, 1);
});
