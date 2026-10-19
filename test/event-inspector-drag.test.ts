// @ts-nocheck - ported test harness with structural DOM doubles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEventInspector } from '../src/ui/event-inspector.ts';
import { EditorSession } from '../src/application/session.ts';
import { insertEvent, eventKey } from '../src/application/event-commands.ts';
import { createEvent } from '../src/core/chart.ts';
import { cancelValueDrag } from '../src/ui/draggable-value.ts';
import { TempoMap } from '../src/core/tempo.ts';

class FakeTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) { const set = this.listeners.get(type) ?? new Set(); set.add(handler); this.listeners.set(type, set); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  dispatch(type, event = {}) { for (const handler of [...(this.listeners.get(type) ?? [])]) handler({ type, preventDefault() {}, stopPropagation() {}, ...event }); }
}

let activeDocument = null;

class FakeNode extends FakeTarget {
  constructor(tag) {
    super();
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null;
    this.attributes = new Map(); this.dataset = {}; this.style = {}; this.textContent = '';
    this.value = ''; this.min = ''; this.max = ''; this.step = ''; this.type = '';
    this.hidden = false; this.checked = false; this.disabled = false; this.open = false;
    this.className = ''; this.src = ''; this.alt = ''; this.title = '';
    this.width = 0; this.height = 0; this.isConnected = true;
    const classes = new Set();
    this.classList = {
      add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
    };
    this.classes = classes;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { for (const node of nodes) { if (typeof node === 'string') { this.children.push(node); continue; } node.parentNode = this; this.children.push(node); } }
  insertBefore(node, reference) { const index = this.children.indexOf(reference); node.parentNode = this; if (index < 0) this.children.push(node); else this.children.splice(index, 0, node); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { const index = this.parentNode ? this.parentNode.children.indexOf(this) : -1; if (index >= 0) this.parentNode.children.splice(index, 1); this.isConnected = false; this.parentNode = null; }
  focus() { this.focused = true; }
  closest() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 300, bottom: 100, width: 300, height: 100 }; }
  requestPointerLock() { activeDocument.pointerLockElement = this; activeDocument.dispatch('pointerlockchange'); return Promise.resolve(); }
  getContext() {
    const canvas = this;
    return new Proxy({ canvas }, {
      get: (target, key) => key === 'canvas' ? canvas : key in target ? target[key] : () => {},
      set: (target, key, value) => { target[key] = value; return true; },
    });
  }
}

/** Canvas-free document stub that is just complete enough for the inspector. */
function fakeDocument() {
  const nodes = new Map();
  const document = Object.assign(new FakeTarget(), {
    pointerLockElement: null,
    activeElement: null,
    documentElement: new FakeNode('html'),
    body: new FakeNode('body'),
    createElement: tag => new FakeNode(tag),
    createElementNS: (namespace, tag) => new FakeNode(tag),
    exitPointerLock() { this.pointerLockElement = null; this.dispatch('pointerlockchange'); },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, new FakeNode(selector === '#event-properties' ? 'form' : 'small')); return nodes.get(selector); },
  });
  activeDocument = document;
  return { document, nodes };
}

function walk(node, visit) { visit(node); for (const child of node.children ?? []) if (typeof child !== 'string') walk(child, visit); }

function setup(selection = 1, options = {}) {
  const session = new EditorSession();
  // The default chart already carries a moveX event, so the fixtures land after it.
  insertEvent(session, 'moveXEvents', createEvent(20, 120, 0, 4));
  insertEvent(session, 'moveXEvents', createEvent(40, 160, 4, 8));
  session.eventSelection = new Set([eventKey('moveXEvents', 1), eventKey('moveXEvents', 2)].slice(0, selection));
  const { document, nodes } = fakeDocument();
  const window = new FakeTarget();
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = document; globalThis.window = window;
  const sampler = options.sampler === null ? null : {
    valueDraft: null, updates: [], finished: null,
    beginValueDraft() { this.valueDraft ??= { chart: session.chart }; return true; },
    updateValueDraft(target, value) { this.beginValueDraft();this.updates.push({ target, value }); return true; },
    finishValue(apply, label) { this.finished = { apply, label }; this.valueDraft = null; },
  };
  const errors = [];
  renderEventInspector(session, new TempoMap(session.chart.BPMList), () => 0, error => errors.push(error), () => {}, sampler);
  const container = nodes.get('#event-properties');
  const restore = () => { cancelValueDrag();globalThis.document = previous.document; globalThis.window = previous.window; };
  return { session, sampler, container, window, errors, restore };
}

const field = (container, key) => {
  const found = [];
  walk(container, node => { if (node.tagName === 'LABEL' && node.dataset?.rpenField === key) found.push(node); });
  return found[0];
};
const drag = (window, label, fromX, toX) => {
  label.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: fromX, clientY: 40, target: label });
  window.dispatch('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: toX, clientY: 40, movementX: 0 });
};
// Moves after the first one only carry raw deltas because the pointer is locked.
const nudge = (window, movementX) => window.dispatch('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 0, clientY: 40, movementX });

test('事件面板的数值字段名称可拖动，并把每一步交给取样器实时预览', () => {
  const { sampler, container, window, errors, restore } = setup();
  try {
    assert.deepEqual(errors, []);
    for (const key of ['startTime', 'endTime', 'start', 'end', 'easingLeft', 'easingRight', 'linkgroup']) assert.ok(field(container, key), `缺少字段 ${key}`);
    const start = field(container, 'start');
    assert.ok(start.classes.has('draggable-value'));
    assert.ok(!field(container, 'startTime').classes.has('draggable-value'), '拍数字段保持手输');
    drag(window, start, 100, 130);
    assert.equal(sampler.updates.length, 2);
    assert.deepEqual(sampler.updates[0].value, 20, '拖动开始先接管预览');
    assert.deepEqual(sampler.updates.at(-1).target, { type: 'moveXEvents', index: 1, lineIndex: 0, field: 'start' });
    assert.equal(sampler.updates.at(-1).value, 50, '20 + 30px');
    window.dispatch('pointerup', { pointerId: 1 });
    assert.deepEqual(sampler.finished, { apply: true, label: '拖动修改事件起始值' });
    assert.deepEqual(sampler.updates.at(-1).value, 50);
  } finally { restore(); }
});

test('拖动缓动边界使用更细的档位并只提交一次', () => {
  const { sampler, container, window, restore } = setup();
  try {
    const easing = field(container, 'easingLeft');
    drag(window, easing, 100, 140);
    assert.equal(sampler.updates.length, 2);
    assert.equal(sampler.updates.at(-1).target.field, 'easingLeft');
    assert.equal(sampler.updates.at(-1).value, 0.4, '0.01/px');
    nudge(window, 260);
    assert.equal(sampler.updates.at(-1).value, 1, '上限吸附在 1');
    window.dispatch('pointerup', { pointerId: 1 });
    assert.equal(sampler.finished.apply, true);
    assert.equal(sampler.updates.length, 3);
  } finally { restore(); }
});

test('拖动灵敏度设置改变每像素步长，且拖动中调整立即生效', () => {
  const { session, sampler, container, window, restore } = setup();
  try {
    session.dragSensitivity = 2;
    const start = field(container, 'start');
    drag(window, start, 100, 130);
    assert.equal(sampler.updates.at(-1).value, 80, '20 + 30px × 2');
    session.dragSensitivity = 0.5;
    nudge(window, 0);
    assert.equal(sampler.updates.at(-1).value, 35, '20 + 30px × 0.5');
    session.dragSensitivity = 0;
    nudge(window, 10);
    assert.equal(sampler.updates.at(-1).value, 60, '非法值回落到 1 倍');
    window.dispatch('pointerup', { pointerId: 1 });
  } finally { restore(); }
});

test('多选事件不启用标签拖动，避免预览与实际提交范围不一致', () => {
  const { container, window, sampler, restore } = setup(2);
  try {
    const start = field(container, 'start');
    assert.ok(start);
    assert.ok(!start.classes.has('draggable-value'));
    drag(window, start, 100, 160);
    assert.deepEqual(sampler.updates, []);
  } finally { restore(); }
});

test('没有取样器时拖动仍然生效，并在松手后作为一步撤销提交', () => {
  const { session, container, window, errors, restore } = setup(1, { sampler: null });
  try {
    const easing = field(container, 'easingLeft');
    const before = session.history.undoStack.length;
    drag(window, easing, 100, 130);
    window.dispatch('pointerup', { pointerId: 1 });
    assert.deepEqual(errors, []);
    assert.equal(session.chart.judgeLineList[0].eventLayers[0].moveXEvents[1].easingLeft, 0.3);
    assert.equal(session.history.undoStack.length, before + 1);
    session.travel('undo');
    assert.equal(session.chart.judgeLineList[0].eventLayers[0].moveXEvents[1].easingLeft, 0);
  } finally { restore(); }
});
