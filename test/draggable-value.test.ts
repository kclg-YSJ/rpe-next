// @ts-nocheck - ported test harness with structural DOM doubles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAG_MODIFIERS, attachDraggableValue, cancelValueDrag, handleValueDragKey, dragModifier, dragValue } from '../src/ui/draggable-value.ts';

class FakeTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) { const set = this.listeners.get(type) ?? new Set(); set.add(handler); this.listeners.set(type, set); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  dispatch(type, event = {}) { for (const handler of [...(this.listeners.get(type) ?? [])]) handler({ type, preventDefault() {}, stopPropagation() {}, ...event }); }
  count(type) { return this.listeners.get(type)?.size ?? 0; }
}

class FakeElement extends FakeTarget {
  constructor(tag) {
    super();
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentElement = null;
    this.attributes = new Map(); this.style = {}; this.value = ''; this.isConnected = true; this.focused = false; this.blurred = false;
    const classes = new Set();
    this.classList = {
      add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
    };
    this.classes = classes;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; node.isConnected = true; this.children.push(node); } }
  remove() { const index = this.parentElement ? this.parentElement.children.indexOf(this) : -1; if (index >= 0) this.parentElement.children.splice(index, 1); this.parentElement = null; this.isConnected = false; }
  focus() { this.focused = true; this.blurred = false; }
  blur() { this.blurred = true; }
  closest() { return null; }
}

function fixture(options = {}) {
  const document = Object.assign(new FakeTarget(), {
    pointerLockElement: null,
    activeElement: null,
    documentElement: new FakeElement('html'),
    body: new FakeElement('body'),
    createElement: tag => new FakeElement(tag),
    createElementNS: (namespace, tag) => new FakeElement(tag),
    exitPointerLock() { this.pointerLockElement = null; this.dispatch('pointerlockchange'); },
  });
  const window = new FakeTarget();
  const label = new FakeElement('label');
  const input = new FakeElement('input');
  const log = { preview: [], commit: [], cancel: 0, locks: 0 };
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = document; globalThis.window = window;
  label.requestPointerLock = () => {
    log.locks++;
    document.pointerLockElement = label;
    document.dispatch('pointerlockchange');
    return Promise.resolve();
  };
  attachDraggableValue({
    label, input, unit: options.unit ?? 1, snap: options.snap, minimum: options.minimum, maximum: options.maximum, integer: options.integer,
    read: options.read ?? (() => 10),
    preview: value => log.preview.push(value),
    commit: value => log.commit.push(value),
    cancel: () => { log.cancel++; },
  });
  const ghost = () => document.body.children.find(child => child.className === 'drag-cursor-ghost');
  const restore = () => { cancelValueDrag();globalThis.document = previous.document; globalThis.window = previous.window; };
  return { document, window, label, input, log, ghost, restore };
}

const down = (label, overrides = {}) => label.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 100, clientY: 40, target: label, ...overrides });
const move = (window, clientX, overrides = {}) => window.dispatch('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX, clientY: 40, movementX: 0, ...overrides });
// Locked pointer moves only carry raw deltas.
const nudge = (window, movementX, overrides = {}) => window.dispatch('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 100, clientY: 40, movementX, ...overrides });

test('拖动鼠标增量按档位缩放并吸附，modifier 决定倍率与精细度', () => {
  assert.equal(dragValue({ start: 10, movement: 30 }), 40);
  assert.equal(dragValue({ start: 0, movement: 30, unit: 0.01 }), 0.3);
  assert.equal(dragValue({ start: 0, movement: 3, modifier: DRAG_MODIFIERS.shiftKey }), 20);
  assert.equal(dragValue({ start: 0, movement: 4, modifier: DRAG_MODIFIERS.shiftKey }), 20);
  assert.equal(dragValue({ start: 0, movement: 10, modifier: DRAG_MODIFIERS.altKey }), 1);
  assert.equal(dragValue({ start: 0, movement: -1, modifier: DRAG_MODIFIERS.altKey }), -0.1);
  assert.equal(dragValue({ start: 0, movement: 30, minimum: 0, maximum: 12 }), 12);
  assert.equal(dragValue({ start: 0, movement: 3.2, integer: true, unit: 0.5 }), 2);
  assert.equal(dragValue({ start: 0, movement: 3.2, integer: true, unit: 0.5, minimum: 4 }), 4);
  assert.ok(Object.is(dragValue({ start: -0.4, movement: 0 }), 0), '不产生 -0');
  assert.equal(dragValue({ start: 0, movement: 1, modifier: DRAG_MODIFIERS.altKey, unit: 0.01 }), 0.001);
});

test('灵敏度与吸附分离：unit 决定每像素步长，snap 保持基准吸附', () => {
  assert.equal(dragValue({ start: 0, movement: 1, unit: 2, snap: 1 }), 2);
  assert.equal(dragValue({ start: 0, movement: 1, unit: 0.1, snap: 1 }), 0);
  assert.equal(dragValue({ start: 0, movement: 5, unit: 0.1, snap: 1 }), 1);
  assert.equal(dragValue({ start: 10, movement: 3, unit: 2, snap: 1, modifier: DRAG_MODIFIERS.shiftKey }), 40, 'Shift 仍吸附基准 10');
  assert.equal(dragValue({ start: 0, movement: 30, unit: 0.01, snap: 0.01 }), 0.3);
});

test('unit 与 snap 可以是函数，每步重新读取', () => {
  let unit = 1;
  const { window, label, input, restore } = fixture({ unit: () => unit, snap: 1 });
  try {
    down(label); move(window, 130);
    assert.equal(input.value, '40');
    unit = 2;
    nudge(window, 0);
    assert.equal(input.value, '70', '同一段位移按新灵敏度重算');
    window.dispatch('pointerup', { pointerId: 1 });
    unit = 2.5;
    down(label); move(window, 103);
    assert.equal(input.value, '18', '10 + 3 × 2.5 吸附到 1');
  } finally { restore(); }
});

test('modifier 优先级：Shift > Ctrl > Meta > Alt', () => {
  assert.equal(dragModifier({}), DRAG_MODIFIERS.default);
  assert.equal(dragModifier({ shiftKey: true, altKey: true }), DRAG_MODIFIERS.shiftKey);
  assert.equal(dragModifier({ ctrlKey: true, altKey: true }), DRAG_MODIFIERS.ctrlKey);
  assert.equal(dragModifier({ metaKey: true }), DRAG_MODIFIERS.metaKey);
  assert.equal(dragModifier({ altKey: true }), DRAG_MODIFIERS.altKey);
});

test('拖动标签连续预览、锁定指针并在松手时只提交一次最终值', () => {
  const { document, window, label, input, log, ghost, restore } = fixture();
  try {
    down(label);
    assert.ok(label.classes.has('draggable-value'));
    assert.equal(log.locks, 0, '按下时还不锁定，避免普通单击夺走指针');
    move(window, 102);
    assert.equal(log.preview.length, 0, '小于阈值的移动不算拖动');
    assert.equal(ghost(), undefined);
    move(window, 130);
    assert.equal(log.locks, 1, '进入拖动即请求 Pointer Lock');
    assert.equal(document.pointerLockElement, label);
    assert.deepEqual(log.preview, [10, 40], '拖动开始即接管预览，随后给出新值');
    assert.equal(input.value, '40');
    assert.equal(ghost()?.style.left, '100px', '光标钉在按下位置');
    assert.equal(ghost()?.style.top, '40px');
    nudge(window, 30);
    assert.deepEqual(log.preview, [10, 40, 70], '锁定后按 movementX 累计');
    nudge(window, -10);
    assert.equal(input.value, '60');
    window.dispatch('pointerup', { pointerId: 1 });
    assert.deepEqual(log.commit, [60]);
    assert.equal(log.cancel, 0);
    assert.equal(document.pointerLockElement, null, '结束后释放指针锁定');
    assert.equal(window.count('pointermove'), 0, '结束后移除手势监听');
    assert.equal(label.classes.has('dragging'), false);
    assert.equal(ghost(), undefined, '结束后移除钉住的光标');
  } finally { restore(); }
});

test('拖动开始前先移除焦点，避免面板在拖动中被重建', () => {
  const { document, window, label, input, restore } = fixture();
  try {
    document.activeElement = input;
    down(label); move(window, 140);
    assert.equal(input.blurred, true);
    assert.equal(document.activeElement, input, '模型不依赖真实焦点状态');
  } finally { restore(); }
});

test('按住 Shift 粗调、Alt 微调，拖动中切换立即重算同一段位移', () => {
  const { window, label, input, log, restore } = fixture();
  try {
    down(label); move(window, 130);
    window.dispatch('keydown', { key: 'Shift', shiftKey: true });
    assert.equal(log.preview.at(-1), 160);
    assert.equal(input.value, '160');
    window.dispatch('keyup', { key: 'Shift', shiftKey: false });
    assert.equal(log.preview.at(-1), 40);
    window.dispatch('keydown', { key: 'Alt', altKey: true });
    assert.equal(log.preview.at(-1), 13);
    window.dispatch('keyup', { key: 'Alt', altKey: false });
    assert.equal(log.preview.at(-1), 40);
    window.dispatch('pointerup', { pointerId: 1 });
    assert.deepEqual(log.commit, [40]);
  } finally { restore(); }
});

test('锁定期间 pointermove 报 buttons: 0 也不能中断拖动', () => {
  const { document, window, label, input, log, restore } = fixture();
  try {
    down(label); move(window, 130);
    assert.ok(document.documentElement.classes.has('value-dragging'));
    nudge(window, 5, { buttons: 0 });
    assert.equal(input.value, '45');
    assert.equal(log.commit.length, 0, '仍在拖动，未提交');
    assert.ok(document.documentElement.classes.has('value-dragging'));
    nudge(window, 5, { buttons: 0 });
    assert.equal(input.value, '50');
    window.dispatch('pointerup', { pointerId: 1 });
    assert.deepEqual(log.commit, [50]);
  } finally { restore(); }
});

test('漏掉 pointerup 时下一次 pointerdown 结束上一次拖动', () => {
  const { window, label, input, log, restore } = fixture();
  try {
    down(label); move(window, 130);
    window.dispatch('pointerdown', { pointerId: 1, target: { closest: () => null } });
    assert.deepEqual(log.commit, [40]);
    assert.equal(input.value, '40');
    assert.equal(window.count('pointermove'), 0);
  } finally { restore(); }
});

test('浏览器先解除锁定而不派发 Esc 按键时也取消改动', () => {
  const { document, window, label, input, log, restore } = fixture();
  try {
    down(label); move(window, 130);
    assert.equal(document.pointerLockElement, label);
    document.pointerLockElement = null;
    document.dispatch('pointerlockchange');
    assert.deepEqual(log.commit, []);
    assert.equal(log.cancel, 1);
    assert.equal(input.value, '10');
    assert.equal(window.count('pointermove'), 0);
  } finally { restore(); }
});

test('拖动中的编辑快捷键由提前输入入口拦截，修饰键仍可调节', () => {
  const { window, label, input, log, restore } = fixture();
  try {
    down(label);move(window,130);
    let blocked=0;
    assert.equal(handleValueDragKey({type:'keydown',key:'z',ctrlKey:true,preventDefault(){blocked++;},stopImmediatePropagation(){blocked++;}}),true);
    assert.equal(blocked,2);assert.deepEqual(log.commit,[]);assert.equal(input.value,'40');
    handleValueDragKey({type:'keydown',key:'Alt',altKey:true});assert.equal(input.value,'13');
    cancelValueDrag();assert.equal(log.cancel,1);assert.equal(handleValueDragKey({type:'keydown',key:'z'}),false);
  } finally {restore();}
});

test('宿主或模组取消拖动会释放锁定及所有手势状态', () => {
  const { document,window,label,input,log,ghost,restore }=fixture();
  try {
    down(label);move(window,130);cancelValueDrag();
    assert.equal(input.value,'10');assert.equal(document.pointerLockElement,null);assert.equal(ghost(),undefined);
    assert.equal(window.count('pointermove'),0);assert.deepEqual(log.commit,[]);assert.equal(log.cancel,1);
    window.dispatch('pointerup',{pointerId:1});assert.deepEqual(log.commit,[]);
  } finally {restore();}
});

test('Esc 取消不改值、不回滚提交，释放锁定并恢复输入显示', () => {
  const { document, window, label, input, log, ghost, restore } = fixture();
  try {
    down(label); move(window, 130);
    window.dispatch('keydown', { key: 'Escape' });
    assert.deepEqual(log.commit, []);
    assert.equal(log.cancel, 1);
    assert.equal(input.value, '10');
    assert.equal(document.pointerLockElement, null);
    assert.equal(ghost(), undefined);
    assert.equal(document.documentElement.classes.has('value-dragging'), false);
    move(window, 180);
    assert.equal(log.preview.length, 2, '取消后不再响应移动');
    assert.equal(window.count('pointermove'), 0);
  } finally { restore(); }
});

test('单击标签聚焦输入，不锁定指针也不产生预览或提交', () => {
  const { window, label, input, log, restore } = fixture();
  try {
    down(label); move(window, 101); window.dispatch('pointerup', { pointerId: 1 });
    assert.equal(input.focused, true);
    assert.equal(log.locks, 0);
    assert.deepEqual(log.preview, []); assert.deepEqual(log.commit, []); assert.equal(log.cancel, 0);
    down(label, { target: { closest: () => ({}) } }); move(window, 160);
    assert.deepEqual(log.preview, []);
    assert.equal(log.locks, 0, '点击输入不启动拖动');
  } finally { restore(); }
});

test('拖回起点不写历史：仅收起预览，支持整数字段与上下限', () => {
  const { window, label, input, log, restore } = fixture({ read: () => 5, minimum: 0, maximum: 20, integer: true, unit: 0.5 });
  try {
    down(label); move(window, 160);
    assert.equal(input.value, '20', '上限约束');
    nudge(window, -60);
    assert.equal(input.value, '5');
    window.dispatch('pointerup', { pointerId: 1 });
    assert.deepEqual(log.commit, []);
    assert.equal(log.cancel, 1);
  } finally { restore(); }
});

test('拖动结束后的 click 不再把焦点送进输入框，普通单击仍然聚焦', () => {
  const { window, label, input, restore } = fixture();
  try {
    down(label); move(window, 130); window.dispatch('pointerup', { pointerId: 1 });
    let prevented = 0;
    label.dispatch('click', { preventDefault: () => { prevented++; } });
    assert.equal(prevented, 1, '拖动后的点击被吞掉，避免输入框抢走快捷键');
    down(label);
    window.dispatch('pointerup', { pointerId: 1 });
    assert.equal(input.focused, true, '普通单击仍然聚焦');
    prevented = 0;
    label.dispatch('click', { preventDefault: () => { prevented++; } });
    assert.equal(prevented, 0);
  } finally { restore(); }
});

test('触屏拖动不锁定指针也不绘制鼠标光标', () => {
  const { window, label, input, log, ghost, restore } = fixture();
  try {
    down(label, { pointerType: 'touch' });
    move(window, 140, { pointerType: 'touch', cancelable: true, buttons: 1 });
    assert.equal(input.value, '50');
    assert.equal(log.locks, 0);
    assert.equal(ghost(), undefined);
    window.dispatch('pointerup', { pointerId: 1, pointerType: 'touch' });
    assert.deepEqual(log.commit, [50]);
  } finally { restore(); }
});
