import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEventInspector } from '../src/ui/event-inspector.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { insertEvent, eventKey } from '../src/application/event-commands.mjs';
import { createEvent } from '../src/core/chart.mjs';
import { cancelValueDrag } from '../src/ui/draggable-value.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { toggleSingleEventLock } from '../src/application/event-commands.mjs';
import { createEasingCanvas } from '../src/ui/easing-canvas.mjs';
import { eventEasing } from '../src/core/event-easing.mjs';

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
  focus() { this.focused = true; activeDocument.activeElement = this; }
  click() { this.onclick?.(); }
  showPopover() { this.open = true; }
  hidePopover() { this.open = false; }
  matches(selector) { return selector === ':popover-open' && this.open; }
  setPointerCapture(id) { this.pointerId = id; }
  hasPointerCapture(id) { return this.pointerId === id; }
  releasePointerCapture() { this.pointerId = null; }
  closest() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 300, bottom: 100, width: 300, height: 100 }; }
  requestPointerLock() { activeDocument.pointerLockElement = this; activeDocument.dispatch('pointerlockchange'); return Promise.resolve(); }
  getContext() {
    if (this.context) return this.context;
    const canvas = this;
    this.drawCalls = [];
    return this.context = new Proxy({ canvas }, {
      get: (target, key) => key === 'canvas' ? canvas : key in target ? target[key] : (...args) => this.drawCalls.push([key, ...args]),
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

const find = (container, predicate) => { let found; walk(container, node => { if (predicate(node)) found ??= node; }); return found; };
const modeTab = (container, mode) => find(container, node => node.dataset.easingMode === mode);
const preview = container => find(container, node => node.className.split(' ').includes('easing-preview'));
const boundaries = canvas => canvas.drawCalls.filter(([method]) => method === 'moveTo').slice(-2).map(([, x]) => x);

test('三个缓动模式互斥，标准图形选择位于弹窗中，左右边界并排位于预览下方', () => {
  const { container, restore } = setup();
  try {
    const curve = preview(container), left = field(container, 'easingLeft'), right = field(container, 'easingRight');
    assert.equal(left.parentNode, right.parentNode);
    assert.ok(curve.parentNode.children.indexOf(curve) < curve.parentNode.children.indexOf(left.parentNode));
    for (const mode of ['standard', 'custom', 'bezier']) {
      assert.equal(modeTab(container, mode).getAttribute('aria-selected'), String(mode === 'standard'));
      assert.equal(modeTab(container, mode).classList.contains('active'), mode === 'standard');
    }
    assert.ok(!find(find(container, node => node.className === 'event-easing-editor'), node => node.tagName === 'DETAILS'));
    const popup = find(container, node => node.className === 'event-easing-popup');
    assert.equal(popup.getAttribute('aria-label'), '事件缓动');
    const choices = popup.children[0].children.filter(node => node.tagName === 'BUTTON');
    assert.equal(choices.length, 29);
    assert.deepEqual(choices.slice(0, 7).map(node => Number(node.dataset.easing)), [1, 3, 2, 6, 5, 4, 7]);
    assert.equal(choices.find(node => Number(node.dataset.easing) === 15).style.gridRow, '7');
    assert.equal(choices.find(node => Number(node.dataset.easing) === 22).style.gridColumn, '3');
    assert.equal(find(container, node => node.getAttribute('aria-label') === '启用 Bezier'), undefined);
  } finally { restore(); }
});

test('切换模式修改每个所选事件的实际缓动，保留各自数值和控制点并支持撤销', () => {
  const { container, session, errors, restore } = setup(2);
  try {
    const events = () => session.line.eventLayers[0].moveXEvents.slice(1);
    events()[0].easingType = 5; events()[1].easingType = 8;
    const values = events().map(event => [event.start, event.end]), samples = events().map(event => eventEasing(event, .5));
    const before = session.history.undoStack.length;
    modeTab(container, 'custom').click();
    assert.ok(events().every(event => event.customEasing && !event.bezier));
    assert.deepEqual(events().map(event => eventEasing(event, .5)), samples);
    assert.deepEqual(events().map(event => [event.start, event.end]), values);
    assert.equal(session.history.undoStack.length, before + 1);
    assert.equal(field(container, 'easingLeft'), undefined);
    assert.equal(find(container, node => node.className === 'custom-easing-group').tagName, 'DIV');
    modeTab(container, 'bezier').click();
    assert.ok(events().every(event => event.bezier === 1 && !event.customEasing));
    assert.equal(modeTab(container, 'bezier').getAttribute('aria-selected'), 'true');
    modeTab(container, 'standard').click();
    const popup = find(container, node => node.className === 'event-easing-popup');
    find(popup, node => Number(node.dataset.easing) === 5).click();
    assert.ok(events().every(event => !event.bezier && !event.customEasing && event.easingType === 5));
    session.travel('undo'); session.travel('undo');
    assert.ok(events().every(event => event.bezier));
    assert.deepEqual(errors, []);
  } finally { restore(); }
});

test('缓动边界拖动与输入实时重绘左右标记，取消恢复初始画面', () => {
  const { container, window, session, restore } = setup();
  try {
    const canvas = preview(container), initial = session.history.undoStack.length;
    assert.deepEqual(boundaries(canvas), [10, 250]);
    drag(window, field(container, 'easingLeft'), 100, 140);
    assert.deepEqual(boundaries(canvas), [106, 250]);
    window.dispatch('keydown', { key: 'Escape' });
    assert.deepEqual(boundaries(canvas), [10, 250]);
    assert.equal(session.history.undoStack.length, initial);
    drag(window, field(container, 'easingRight'), 100, 80);
    assert.deepEqual(boundaries(canvas), [10, 202]);
    window.dispatch('pointercancel');
    assert.deepEqual(boundaries(canvas), [10, 250]);
    const input = field(container, 'easingLeft').children.at(-1).children[0];
    input.value = '.25'; input.oninput({});
    assert.deepEqual(boundaries(canvas), [70, 250]);
  } finally { restore(); }
});

test('混合模式多选可以统一到当前标签的模式，非法 Bezier 输入不写入谱面', () => {
  const { container, session, errors, restore } = setup(2);
  try {
    session.line.eventLayers[0].moveXEvents[2].bezier = 1;
    modeTab(container, 'standard').click();
    assert.ok(session.line.eventLayers[0].moveXEvents.slice(1).every(event => !event.bezier));
    modeTab(container, 'bezier').click();
    const input = find(container, node => node.tagName === 'INPUT' && node.getAttribute('aria-label') === 'Bezier 控制点');
    const before = session.history.undoStack.length;
    for (const value of ['0,,1,1', '0,NaN,1,1', '0,1,2,1', '0,1,1']) { input.value = value; input.onchange(); }
    assert.equal(errors.length, 4); assert.equal(session.history.undoStack.length, before);
    input.value = '0,0,0,0'; input.onchange();
    assert.deepEqual(session.line.eventLayers[0].moveXEvents[1].bezierPoints, [0, 0, 0, 0]);
  } finally { restore(); }
});

test('缓动画布随尺寸和像素密度更新，绘制与指针使用同一等比坐标变换', () => {
  const previous = { ratio: globalThis.devicePixelRatio, observer: globalThis.ResizeObserver };
  let resize, disconnected = false;
  globalThis.ResizeObserver = class { constructor(callback) { resize = callback; } observe() {} disconnect() { disconnected = true; } };
  globalThis.devicePixelRatio = 2;
  const canvas = new FakeNode('canvas'); canvas.clientWidth = 520; canvas.clientHeight = 200; canvas.clientLeft = canvas.clientTop = 1;
  canvas.getBoundingClientRect = () => ({ left: 30, top: 40, width: canvas.clientWidth + 2, height: canvas.clientHeight + 2 });
  const view = createEasingCanvas(canvas, 'easing', draw => draw.arc(100, 50, 5, 0, Math.PI * 2));
  try {
    assert.deepEqual([canvas.width, canvas.height], [1040, 400]);
    assert.deepEqual(canvas.drawCalls.filter(([method]) => method === 'setTransform').at(-1), ['setTransform', 4, 0, 0, 4, 0, 0]);
    assert.deepEqual(view.point({ clientX: 231, clientY: 141 }), { x: 100, y: 50 });
    canvas.clientWidth = 390; canvas.clientHeight = 150; globalThis.devicePixelRatio = 1.5; resize();
    assert.deepEqual([canvas.width, canvas.height], [585, 225]);
    assert.deepEqual(view.point({ clientX: 181, clientY: 116 }), { x: 100, y: 50 });
    assert.deepEqual(canvas.drawCalls.filter(([method]) => method === 'setTransform').at(-1), ['setTransform', 2.25, 0, 0, 2.25, 0, 0]);
  } finally { view.dispose(); globalThis.devicePixelRatio = previous.ratio; globalThis.ResizeObserver = previous.observer; }
  assert.equal(disconnected, true);
});

test('Bezier 使用单一可交互画布，缩放后可准确拖动、提交一次并取消', () => {
  const { container, session, restore, errors } = setup();
  try {
    modeTab(container, 'bezier').click();
    const handles = find(container, node => node.className.includes('bezier-editor'));
    assert.equal(handles, preview(container));
    assert.equal(handles.parentNode.children.filter(node => node.tagName === 'CANVAS').length, 1);
    handles.clientWidth = 520; handles.clientHeight = 200;
    handles.getBoundingClientRect = () => ({ left: 20, top: 30, width: 520, height: 200 });
    const pointer = (clientX, clientY) => ({ clientX, clientY, pointerId: 1, preventDefault() {} });
    const before = session.history.undoStack.length, canvas = preview(container), calls = canvas.drawCalls.length;
    handles.onpointerdown(pointer(40, 190)); handles.onpointermove(pointer(160, 100));
    assert.equal(session.liveEventEdit, true);
    assert.ok(canvas.drawCalls.length > calls);
    handles.onpointerup(pointer(160, 100));
    assert.deepEqual(session.line.eventLayers[0].moveXEvents[1].bezierPoints, [.25, .75, 1, 1]);
    assert.equal(session.history.undoStack.length, before + 1);
    const next = find(container, node => node.className.includes('bezier-editor'));
    next.onpointerdown(pointer(90, 35)); next.onpointermove(pointer(120, 50)); next.onpointercancel(pointer(120, 50));
    assert.deepEqual(session.line.eventLayers[0].moveXEvents[1].bezierPoints, [.25, .75, 1, 1]);
    assert.equal(session.history.undoStack.length, before + 1);
    assert.equal(session.liveEventEdit, false);
    session.travel('undo'); assert.deepEqual(session.line.eventLayers[0].moveXEvents[1].bezierPoints, [0, 0, 1, 1]);
    assert.deepEqual(errors, []);
  } finally { restore(); }
});

test('透明度文本允许负整数，保留255上限与撤销', () => {
  const { container, session, errors, restore } = setup(1, { sampler: null });
  try {
    session.eventSelection = new Set(['alphaEvents:0']); session.liveEventEdit = false;
    renderEventInspector(session, new TempoMap(session.chart.BPMList), () => 0, error => errors.push(error), () => {}, null);
    const input = field(container, 'start').children.at(-1).children[0]; assert.equal(input.min, '');
    input.value = '-128.9'; input.oninput({}); assert.equal(session.line.eventLayers[0].alphaEvents[0].start, -128);
    session.travel('undo'); assert.equal(session.line.eventLayers[0].alphaEvents[0].start, 255);
    input.value = '300'; input.oninput({}); assert.equal(session.line.eventLayers[0].alphaEvents[0].start, 255);
    assert.deepEqual(errors, []);
  } finally { restore(); }
});

test('事件属性尾值修改后钩定采用尾值；空输入和只点击首值不会改取值端', () => {
  for (const shortcut of [false,true]) {
    const { container,session,errors,restore }=setup(1,{sampler:null});
    try {
      const input=field(container,'end').children.at(-1).children[0];input.value='333';input.oninput({});
      const start=field(container,'start').children.at(-1).children[0];start.value='';start.oninput({});
      start.value='20';start.onchange();
      if(shortcut)toggleSingleEventLock(session);
      else {let lock;walk(container,node=>{if(node.getAttribute?.('aria-label')==='钩定')lock=node;});lock.checked=true;lock.onchange();}
      const event=session.line.eventLayers[0].moveXEvents[1];assert.deepEqual([event.start,event.end,event.inst],[333,333,1]);
      assert.deepEqual(errors,[]);
    }finally{restore();}
  }
});

test('从数值框直接点钩定时不在失焦微任务里替换正在点击的控件', async()=>{
  const {container,session,restore}=setup(1,{sampler:null});
  try{
    const input=field(container,'end').children.at(-1).children[0];input.value='222';input.oninput({});
    let lock;walk(container,node=>{if(node.getAttribute?.('aria-label')==='钩定')lock=node;});
    const children=container.children;container.contains=node=>node===lock;globalThis.document.activeElement=globalThis.document.body;
    input.onblur({relatedTarget:lock});await Promise.resolve();assert.equal(container.children,children);
    lock.checked=true;lock.onchange();const event=session.line.eventLayers[0].moveXEvents[1];assert.deepEqual([event.start,event.end],[222,222]);
  }finally{restore();}
});

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
