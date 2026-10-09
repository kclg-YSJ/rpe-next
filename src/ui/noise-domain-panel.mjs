import { formatBeat, parseBeat } from '../core/beat.mjs';
import { NOISE_EASING_NAMES, RPE_NOISE_SIZE, createNoiseArea, noiseMoveTargetForCenter, noisePhases, noisePointToRpe, noiseRectAt, normalizeNoiseArea, resizeNoiseAreaFromCorner, rpePointToNoise, translateNoiseArea } from '../core/noise-domain.mjs';

const close = (left, right) => Math.abs(left - right) < 1e-7;
const number = (value, name) => { const result = Number(value); if (!Number.isFinite(result)) throw new Error(`${name} 必须为有限数字`); return result; };

export class NoiseDomainPanel {
  constructor(host, context, options = {}) {
    this.host = host; this.context = context; this.options = options; this.selected = 0; this.autoKey = false; this.drag = null;
  }

  get state() { return this.context(); }
  get areas() { return this.state.session.chart.blockAreaList ?? []; }
  get area() { return this.areas[this.selected]; }
  commit(label, transform) {
    try {
      const { session } = this.state; const list = structuredClone(session.chart.blockAreaList ?? []);
      const next = transform(list) ?? list;
      session.commit(label, { ...session.chart, blockAreaList: next });
      this.selected = Math.max(0, Math.min(this.selected, next.length - 1));
      this.syncSelection(); this.options.invalidate?.();
    } catch (error) { this.options.reportError?.(error); }
  }
  syncSelection() {
    const value = this.areas.length ? this.selected : -1;
    this.state.preview.noiseSelection = value; this.state.realtimePreview.noiseSelection = value;
  }

  render() {
    this.host.replaceChildren(); this.syncSelection();
    const heading = document.createElement('div'); heading.className = 'noise-panel-heading';
    const select = document.createElement('select'); select.setAttribute('aria-label', '选择噪域');
    for (const [index, area] of this.areas.entries()) select.append(new Option(`#${index + 1} · ${area.isSubtract ? '扣除' : noisePhases(area, area.enableTime).visualOnly ? '假红区' : '阻断'}`, index));
    select.value = String(this.selected); select.onchange = () => { this.selected = Number(select.value); this.render(); this.options.invalidate?.(); };
    const add = button('新建', () => { const seconds = Math.max(0, this.state.seconds()); this.commit('新建噪域', list => [...list, createNoiseArea(seconds, 2)]); this.selected = this.areas.length - 1; this.render(); });
    heading.append(select, add); this.host.append(heading);
    if (!this.area) { const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = '还没有噪域。新建后可编辑可见/生效区间、矩形与三类官方关键帧。'; this.host.append(hint); return; }

    const actions = document.createElement('div'); actions.className = 'noise-actions';
    actions.append(button('绘制矩形', () => { this.drawMode = !this.drawMode; this.render(); }), button('复制', () => { const copy = structuredClone(this.area); this.commit('复制噪域', list => [...list.slice(0, this.selected + 1), copy, ...list.slice(this.selected + 1)]); this.selected++; this.render(); }),
      button('删除', () => { this.commit('删除噪域', list => list.filter((unused, index) => index !== this.selected)); this.render(); }));
    if (this.drawMode) actions.firstElementChild.classList.add('active');
    const autoKey = document.createElement('label'); const autoInput = document.createElement('input'); autoInput.type = 'checkbox'; autoInput.checked = this.autoKey; autoInput.onchange = () => { this.autoKey = autoInput.checked; }; autoKey.append(autoInput, '自动移动帧'); actions.append(autoKey); this.host.append(actions);

    const canvas = document.createElement('canvas'); canvas.className = 'noise-geometry-canvas'; canvas.tabIndex = 0; this.geometryCanvas = canvas; this.host.append(canvas);
    this.bindCanvas(canvas); requestAnimationFrame(() => this.drawCanvas(canvas));
    const canvasHint = document.createElement('p'); canvasHint.className = 'hint'; canvasHint.textContent = '拖中心移动，拖四角缩放，拖上方圆柄旋转；松手后记为一步撤销。'; this.host.append(canvasHint);
    this.host.append(this.phaseTimeline(), this.keyframeTimeline());

    const switches = document.createElement('div'); switches.className = 'noise-switches';
    const fake = document.createElement('input'); fake.type = 'checkbox'; fake.checked = close(this.area.enableTime, this.area.disableTime);
    fake.onchange = () => this.edit('切换假红区', area => { area.disableTime = fake.checked ? area.enableTime : Math.max(area.enableTime + 0.001, area.disappearTime); if (area.disappearTime < area.disableTime) area.disappearTime = area.disableTime; });
    switches.append(field('假红区（不断触）', fake));
    const subtract = document.createElement('input'); subtract.type = 'checkbox'; subtract.checked = this.area.isSubtract; subtract.onchange = () => this.edit('修改噪域类型', area => { area.isSubtract = subtract.checked; });
    switches.append(field('扣除型', subtract)); this.host.append(switches);

    const phase = detailsSection('精确时间');
    for (const [key, title] of [['appearTime', '出现拍'], ['enableTime', '生效拍'], ['disableTime', '失效拍'], ['disappearTime', '消失拍']]) phase.append(this.beatField(title, this.area[key], value => this.edit(`修改${title}`, area => { area[key] = value; })));
    this.host.append(phase);

    const geometry = detailsSection('RPEN 坐标与预设');
    const presets = document.createElement('div'); presets.className = 'noise-actions';
    for (const [title, corners] of [['全屏', [0, 0, 1, 1]], ['左半', [0, 0, .5, 1]], ['右半', [.5, 0, 1, 1]], ['上半', [0, .5, 1, 1]], ['下半', [0, 0, 1, .5]]]) presets.append(button(title, () => this.edit('应用噪域预设', area => setBounds(area, ...corners))));
    geometry.append(presets);
    const left = Math.min(this.area.bottomLeftPercentage.x, this.area.topRightPercentage.x); const right = Math.max(this.area.bottomLeftPercentage.x, this.area.topRightPercentage.x);
    const bottom = Math.min(this.area.bottomLeftPercentage.y, this.area.topRightPercentage.y); const top = Math.max(this.area.bottomLeftPercentage.y, this.area.topRightPercentage.y);
    const center = noisePointToRpe({ x: (left + right) / 2, y: (bottom + top) / 2 });
    geometry.append(this.numberField('中心 X', tidy(center.x), value => this.edit('修改噪域中心', area => replaceArea(area, translateNoiseArea(area, { x: rpePointToNoise({ x: value, y: 0 }).x - (area.bottomLeftPercentage.x + area.topRightPercentage.x) / 2, y: 0 }))), 1));
    geometry.append(this.numberField('中心 Y', tidy(center.y), value => this.edit('修改噪域中心', area => replaceArea(area, translateNoiseArea(area, { x: 0, y: rpePointToNoise({ x: 0, y: value }).y - (area.bottomLeftPercentage.y + area.topRightPercentage.y) / 2 }))), 1));
    geometry.append(this.numberField('宽度', tidy((right - left) * RPE_NOISE_SIZE.width), value => this.edit('修改噪域宽度', area => resizeBase(area, Math.max(0, value) / RPE_NOISE_SIZE.width, null)), 1));
    geometry.append(this.numberField('高度', tidy((top - bottom) * RPE_NOISE_SIZE.height), value => this.edit('修改噪域高度', area => resizeBase(area, null, Math.max(0, value) / RPE_NOISE_SIZE.height)), 1));
    const coordinateHint = document.createElement('p'); coordinateHint.className = 'hint'; coordinateHint.textContent = 'RPEN 1350×900 坐标：中心为 (0, 0)，X 向右、Y 向上；保存时自动换回官方百分比。'; geometry.append(coordinateHint);
    this.host.append(geometry);

    this.host.append(this.eventSection('移动事件', 'moveEvents'), this.eventSection('缩放事件', 'scaleEvents'), this.eventSection('旋转事件', 'rotateEvents'));
    const back = button('返回谱面工具', () => this.options.close?.()); back.className = 'wide-button'; this.host.append(back);
  }

  edit(label, transform) { this.commit(label, list => { const area = normalizeNoiseArea(list[this.selected]); transform(area); list[this.selected] = area; return list; }); this.render(); }
  beatField(title, seconds, apply) {
    const input = document.createElement('input'); input.value = formatBeatFromSeconds(this.state.tempo, seconds);
    input.onchange = () => { try { apply(this.state.tempo.seconds(parseBeat(input.value))); } catch (error) { this.options.reportError?.(error); } };
    return field(title, input);
  }
  numberField(title, value, apply, step = 0.1) {
    const input = document.createElement('input'); input.type = 'number'; input.step = String(step); input.value = String(value);
    input.onchange = () => { try { apply(number(input.value, title)); } catch (error) { this.options.reportError?.(error); } };
    return field(title, input);
  }

  timeWindow() {
    const values = [this.area.appearTime, this.area.enableTime, this.area.disableTime, this.area.disappearTime,
      ...this.area.moveEvents.map(event => event.time), ...this.area.scaleEvents.map(event => event.time), ...this.area.rotateEvents.map(event => event.time), this.state.seconds()];
    const minimum = Math.min(...values); const maximum = Math.max(...values); const span = Math.max(1, maximum - minimum);
    return { start: Math.max(0, minimum - span * .12), end: maximum + span * .12 };
  }
  timeRatio(seconds, window = this.timeWindow()) { return Math.max(0, Math.min(1, (seconds - window.start) / Math.max(.001, window.end - window.start))); }
  snappedSeconds(seconds) {
    const division = Math.max(1, this.state.division ?? 4); const beat = this.state.tempo.beat(Math.max(0, seconds));
    return this.state.tempo.seconds(Math.round(beat * division) / division);
  }
  phaseTimeline() {
    const root = document.createElement('section'); root.className = 'noise-direct-timeline';
    const heading = document.createElement('div'); heading.className = 'noise-direct-heading'; heading.append('可见与判定时间');
    const current = document.createElement('small'); current.className = 'noise-current-time'; current.textContent = `当前 ${formatBeatFromSeconds(this.state.tempo, this.state.seconds())}`; heading.append(current); root.append(heading);
    const track = document.createElement('div'); track.className = 'noise-phase-track'; const window = this.timeWindow();
    root.dataset.windowStart = String(window.start); root.dataset.windowEnd = String(window.end);
    for (const [title, start, end, kind] of [['准备', this.area.appearTime, this.area.enableTime, 'ready'], ['生效', this.area.enableTime, this.area.disableTime, 'active'], ['退场', this.area.disableTime, this.area.disappearTime, 'disabled']]) {
      const segment = document.createElement('span'); segment.className = `noise-phase-segment ${kind}`; segment.style.left = `${this.timeRatio(start, window) * 100}%`; segment.style.width = `${Math.max(0, this.timeRatio(end, window) - this.timeRatio(start, window)) * 100}%`; segment.textContent = title; track.append(segment);
    }
    track.append(this.playhead(window));
    const labels = { appearTime: '出现', enableTime: '生效', disableTime: '失效', disappearTime: '消失' };
    for (const [order, key] of Object.keys(labels).entries()) {
      const marker = document.createElement('button'); marker.type = 'button'; marker.className = `noise-phase-marker marker-${order}`; marker.textContent = labels[key]; marker.style.left = `${this.timeRatio(this.area[key], window) * 100}%`; marker.title = `${labels[key]} ${formatBeatFromSeconds(this.state.tempo, this.area[key])}`;
      this.bindTimeMarker(marker, this.area[key], window, value => this.phaseValue(key, value)); track.append(marker);
    }
    root.append(track); return root;
  }
  playhead(window) { const result = document.createElement('i'); result.className = 'noise-playhead'; result.style.left = `${this.timeRatio(this.state.seconds(), window) * 100}%`; return result; }
  phaseValue(key, value) {
    this.edit(`拖动${({ appearTime: '出现', enableTime: '生效', disableTime: '失效', disappearTime: '消失' })[key]}时间`, area => {
      const visualOnly = close(area.enableTime, area.disableTime); value = Math.max(0, value);
      if (key === 'appearTime') area.appearTime = Math.min(value, area.enableTime);
      if (key === 'enableTime') { area.enableTime = Math.max(area.appearTime, Math.min(value, area.disableTime)); if (visualOnly) area.disableTime = area.enableTime; }
      if (key === 'disableTime') { area.disableTime = Math.max(area.enableTime, Math.min(value, area.disappearTime)); if (visualOnly) area.enableTime = area.disableTime; }
      if (key === 'disappearTime') area.disappearTime = Math.max(area.disableTime, value);
    });
  }
  bindTimeMarker(marker, initial, window, apply) {
    let value = initial;
    const update = event => { const bounds = marker.parentElement.getBoundingClientRect(); value = this.snappedSeconds(window.start + Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * (window.end - window.start)); marker.style.left = `${this.timeRatio(value, window) * 100}%`; marker.title = formatBeatFromSeconds(this.state.tempo, value); };
    marker.onpointerdown = event => { marker.setPointerCapture(event.pointerId); update(event); event.preventDefault(); event.stopPropagation(); };
    marker.onpointermove = event => { if (marker.hasPointerCapture(event.pointerId)) { update(event); event.preventDefault(); } };
    marker.onpointerup = event => { update(event); marker.releasePointerCapture(event.pointerId); apply(value); event.preventDefault(); event.stopPropagation(); };
  }
  keyframeTimeline() {
    const root = document.createElement('section'); root.className = 'noise-direct-timeline';
    const heading = document.createElement('div'); heading.className = 'noise-direct-heading'; heading.append('变换关键帧'); const hint = document.createElement('small'); hint.textContent = '拖动改拍；双击空白处添加'; heading.append(hint); root.append(heading);
    const window = this.timeWindow(); root.dataset.windowStart = String(window.start); root.dataset.windowEnd = String(window.end);
    for (const [key, label, short] of [['moveEvents', '移动', 'M'], ['scaleEvents', '缩放', 'S'], ['rotateEvents', '旋转', 'R']]) {
      const row = document.createElement('div'); row.className = 'noise-key-row'; const name = document.createElement('span'); name.textContent = label; row.append(name);
      const lane = document.createElement('div'); lane.className = 'noise-key-lane'; lane.append(this.playhead(window)); const occurrences = new Map();
      this.area[key].forEach((event, index) => {
        const duplicate = occurrences.get(event.time) ?? 0; occurrences.set(event.time, duplicate + 1);
        const marker = document.createElement('button'); marker.type = 'button'; marker.className = 'noise-key-marker'; marker.dataset.label = short; marker.setAttribute('aria-label', `${label}关键帧`); marker.style.left = `${this.timeRatio(event.time, window) * 100}%`; marker.style.setProperty('--stack', `${duplicate * 5}px`); marker.title = `${label} ${formatBeatFromSeconds(this.state.tempo, event.time)}`;
        marker.onclick = () => { this.openSection = key; this.render(); };
        this.bindTimeMarker(marker, event.time, window, value => this.edit(`移动${label}关键帧`, area => { area[key][index].time = value; sortStable(area[key]); })); lane.append(marker);
      });
      lane.ondblclick = event => { if (event.target.closest?.('.noise-key-marker')) return; const bounds = lane.getBoundingClientRect(); const seconds = this.snappedSeconds(window.start + (event.clientX - bounds.left) / bounds.width * (window.end - window.start)); this.addKeyframe(key, seconds); };
      row.append(lane, button(`＋${label}`, () => this.addKeyframe(key, this.state.seconds()))); root.append(row);
    }
    return root;
  }
  tick() {
    if (!this.host.isConnected) return; const seconds = this.state.seconds();
    if (!this.drag && this.geometryCanvas?.isConnected) this.drawCanvas(this.geometryCanvas);
    const current = this.host.querySelector('.noise-current-time'); if (current) current.textContent = `当前 ${formatBeatFromSeconds(this.state.tempo, seconds)}`;
    for (const root of this.host.querySelectorAll('.noise-direct-timeline')) {
      const start = Number(root.dataset.windowStart); const end = Number(root.dataset.windowEnd); const ratio = Math.max(0, Math.min(1, (seconds - start) / Math.max(.001, end - start)));
      for (const playhead of root.querySelectorAll('.noise-playhead')) playhead.style.left = `${ratio * 100}%`;
    }
  }
  addKeyframe(key, seconds) {
    const rect = noiseRectAt(this.area, seconds); const baseWidth = Math.abs(this.area.topRightPercentage.x - this.area.bottomLeftPercentage.x); const baseHeight = Math.abs(this.area.topRightPercentage.y - this.area.bottomLeftPercentage.y);
    const event = key === 'moveEvents' ? { time: seconds, endPosition: noiseMoveTargetForCenter(this.area, seconds, rect.center), easeTypeX: 0, easeTypeY: 0 }
      : key === 'scaleEvents' ? { time: seconds, anchor: { ...rect.center }, scale: { x: rect.width / Math.max(.0001, baseWidth), y: rect.height / Math.max(.0001, baseHeight) }, easeTypeX: 0, easeTypeY: 0 }
        : { time: seconds, anchor: { ...rect.center }, rotation: rect.rotation, easeType: 0 };
    this.openSection = key; this.edit(`添加${({ moveEvents: '移动', scaleEvents: '缩放', rotateEvents: '旋转' })[key]}关键帧`, area => { area[key].push(event); sortStable(area[key]); });
  }

  eventSection(title, key) {
    const root = document.createElement('details'); root.className = 'noise-event-section'; root.open = this.openSection === key;
    root.ontoggle = () => { if (root.open) this.openSection = key; };
    const summary = document.createElement('summary'); summary.textContent = `${title}（${this.area[key].length}）`; root.append(summary);
    for (const [index, event] of this.area[key].entries()) {
      const card = document.createElement('div'); card.className = 'noise-event-card';
      card.append(this.beatField('拍', event.time, value => this.edit(`修改${title}`, area => { area[key][index].time = value; sortStable(area[key]); })));
      if (key === 'moveEvents') {
        const target = noisePointToRpe(event.endPosition);
        card.append(this.numberField('目标 X', tidy(target.x), value => this.eventValue(key, index, item => { item.endPosition.x = rpePointToNoise({ x: value, y: 0 }).x; }), 1), this.numberField('目标 Y', tidy(target.y), value => this.eventValue(key, index, item => { item.endPosition.y = rpePointToNoise({ x: 0, y: value }).y; }), 1));
        card.append(this.easeField('X 缓动', event.easeTypeX, value => this.eventValue(key, index, item => { item.easeTypeX = value; })), this.easeField('Y 缓动', event.easeTypeY, value => this.eventValue(key, index, item => { item.easeTypeY = value; })));
      } else if (key === 'scaleEvents') {
        const anchor = noisePointToRpe(event.anchor);
        card.append(this.numberField('锚点 X', tidy(anchor.x), value => this.eventValue(key, index, item => { item.anchor.x = rpePointToNoise({ x: value, y: 0 }).x; }), 1), this.numberField('锚点 Y', tidy(anchor.y), value => this.eventValue(key, index, item => { item.anchor.y = rpePointToNoise({ x: 0, y: value }).y; }), 1));
        for (const axis of ['x', 'y']) card.append(this.numberField(`缩放 ${axis.toUpperCase()}`, event.scale[axis], value => this.eventValue(key, index, item => { item.scale[axis] = value; }), .01));
        card.append(this.easeField('X 缓动', event.easeTypeX, value => this.eventValue(key, index, item => { item.easeTypeX = value; })), this.easeField('Y 缓动', event.easeTypeY, value => this.eventValue(key, index, item => { item.easeTypeY = value; })));
      } else {
        const anchor = noisePointToRpe(event.anchor);
        card.append(this.numberField('锚点 X', tidy(anchor.x), value => this.eventValue(key, index, item => { item.anchor.x = rpePointToNoise({ x: value, y: 0 }).x; }), 1), this.numberField('锚点 Y', tidy(anchor.y), value => this.eventValue(key, index, item => { item.anchor.y = rpePointToNoise({ x: 0, y: value }).y; }), 1));
        card.append(this.numberField('旋转角度', event.rotation, value => this.eventValue(key, index, item => { item.rotation = value; }), 1), this.easeField('缓动', event.easeType, value => this.eventValue(key, index, item => { item.easeType = value; })));
      }
      card.append(button('删除关键帧', () => this.edit(`删除${title}`, area => { area[key].splice(index, 1); }))); root.append(card);
    }
    root.append(button(`在当前拍添加${title.replace('事件', '关键帧')}`, () => this.addKeyframe(key, this.state.seconds())));
    return root;
  }
  eventValue(key, index, transform) { this.edit('修改噪域关键帧', area => transform(area[key][index])); }
  easeField(title, value, apply) {
    const select = document.createElement('select'); NOISE_EASING_NAMES.forEach((name, index) => select.append(new Option(name, index))); select.value = String(value); select.onchange = () => apply(Number(select.value)); return field(title, select);
  }

  bindCanvas(canvas) {
    const position = event => { const bounds = canvas.getBoundingClientRect(); return { x: (event.clientX - bounds.left) / bounds.width, y: 1 - (event.clientY - bounds.top) / bounds.height }; };
    canvas.onpointerdown = event => {
      const start = position(event);
      if (this.drawMode) { this.drag = { start, current: start, original: structuredClone(this.area), mode: 'draw' }; canvas.setPointerCapture(event.pointerId); event.preventDefault(); return; }
      const bounds = canvas.getBoundingClientRect(); const rect = noiseRectAt(this.area, this.state.seconds()); const hit = handleAt(rect, start, bounds.width, bounds.width * 9 / 16);
      let mode = hit?.kind === 'rotate' ? 'rotate' : hit?.kind === 'corner' ? 'scale' : hit?.kind === 'center' || screenContains(rect, start, bounds.width, bounds.width * 9 / 16) ? 'move' : null;
      if (event.altKey) mode = 'rotate'; else if (event.ctrlKey) mode = 'scale'; else if (event.shiftKey) mode = 'move';
      if (!mode) return;
      this.drag = { start, original: structuredClone(this.area), mode, corner: hit?.corner }; canvas.setPointerCapture(event.pointerId); canvas.style.cursor = 'grabbing'; event.preventDefault();
    };
    canvas.onpointermove = event => {
      if (!this.drag) {
        if (this.drawMode) { canvas.style.cursor = 'crosshair'; return; }
        const bounds = canvas.getBoundingClientRect(); const point = position(event); const rect = noiseRectAt(this.area, this.state.seconds()); const hit = handleAt(rect, point, bounds.width, bounds.width * 9 / 16);
        canvas.style.cursor = hit?.kind === 'rotate' ? 'grab' : hit?.kind === 'corner' ? 'nwse-resize' : hit?.kind === 'center' || screenContains(rect, point, bounds.width, bounds.width * 9 / 16) ? 'move' : 'default'; return;
      }
      if (!['move', 'scale', 'rotate', 'draw'].includes(this.drag.mode)) return;
      this.drag.current = position(event); this.drawCanvas(canvas); event.preventDefault();
    };
    canvas.onpointerup = event => {
      if (['move', 'scale', 'rotate', 'draw'].includes(this.drag?.mode) && this.drag.current) {
        const moved = this.draggedArea();
        this.commit(this.drag.mode === 'move' ? '移动噪域' : this.drag.mode === 'scale' ? '缩放噪域' : this.drag.mode === 'rotate' ? '旋转噪域' : '绘制噪域', list => { list[this.selected] = moved; return list; });
      }
      if (this.drag?.mode === 'draw') this.drawMode = false;
      this.drag = null; canvas.style.cursor = ''; this.render(); event.preventDefault();
    };
    canvas.onpointercancel = () => { this.drag = null; this.render(); };
  }
  draggedArea() {
    const area = normalizeNoiseArea(this.drag?.original ?? this.area); if (!this.drag?.current) return area;
    const dx = this.drag.current.x - this.drag.start.x; const dy = this.drag.current.y - this.drag.start.y; const seconds = this.state.seconds();
    if (this.drag.mode === 'draw') { setBounds(area, Math.min(this.drag.start.x, this.drag.current.x), Math.min(this.drag.start.y, this.drag.current.y), Math.max(this.drag.start.x, this.drag.current.x), Math.max(this.drag.start.y, this.drag.current.y)); return area; }
    if (this.drag.mode === 'scale') {
      if (Number.isInteger(this.drag.corner)) return resizeNoiseAreaFromCorner(area, seconds, this.drag.corner, this.drag.current);
      const rect = noiseRectAt(area, seconds); const aspect = 9 / 16; const center = { x: rect.center.x, y: rect.center.y * aspect };
      const current = rotatePoint({ x: this.drag.current.x, y: this.drag.current.y * aspect }, center, -rect.rotation);
      const targetWidth = Math.max(.002, Math.abs(current.x - center.x) * 2); const targetHeight = Math.max(.002, Math.abs(current.y - center.y) * 2 / aspect);
      const ratioX = targetWidth / Math.max(.0001, rect.width); const ratioY = targetHeight / Math.max(.0001, rect.height);
      const exact = [...area.scaleEvents.keys()].reverse().find(index => close(area.scaleEvents[index].time, seconds));
      if (exact !== undefined) { area.scaleEvents[exact].scale.x *= ratioX; area.scaleEvents[exact].scale.y *= ratioY; return area; }
      const baseCenter = { x: (area.topRightPercentage.x + area.bottomLeftPercentage.x) / 2, y: (area.topRightPercentage.y + area.bottomLeftPercentage.y) / 2 };
      const baseWidth = Math.abs(area.topRightPercentage.x - area.bottomLeftPercentage.x) * ratioX; const baseHeight = Math.abs(area.topRightPercentage.y - area.bottomLeftPercentage.y) * ratioY;
      setBounds(area, baseCenter.x - baseWidth / 2, baseCenter.y - baseHeight / 2, baseCenter.x + baseWidth / 2, baseCenter.y + baseHeight / 2);
      return area;
    }
    if (this.drag.mode === 'rotate') {
      const rect = noiseRectAt(area, seconds); const aspect = 9 / 16; const angle = point => Math.atan2(point.y * aspect - rect.center.y * aspect, point.x - rect.center.x) * 180 / Math.PI;
      const delta = angle(this.drag.current) - angle(this.drag.start);
      const exact = [...area.rotateEvents.keys()].reverse().find(index => close(area.rotateEvents[index].time, seconds));
      if (exact !== undefined) area.rotateEvents[exact].rotation += delta;
      else { area.rotateEvents.push({ time: seconds, anchor: { ...rect.center }, rotation: rect.rotation + delta, easeType: 0 }); sortStable(area.rotateEvents); }
      return area;
    }
    const exact = [...area.moveEvents.keys()].reverse().find(index => close(area.moveEvents[index].time, seconds));
    if (exact !== undefined) { area.moveEvents[exact].endPosition.x += dx; area.moveEvents[exact].endPosition.y += dy; }
    else if (this.autoKey) { const rect = noiseRectAt(area, seconds); area.moveEvents.push({ time: seconds, endPosition: noiseMoveTargetForCenter(area, seconds, { x: rect.center.x + dx, y: rect.center.y + dy }), easeTypeX: 0, easeTypeY: 0 }); sortStable(area.moveEvents); }
    else return translateNoiseArea(area, { x: dx, y: dy });
    return area;
  }
  drawCanvas(canvas) {
    if (!canvas.isConnected || !this.area) return;
    const bounds = canvas.getBoundingClientRect(); const ratio = globalThis.devicePixelRatio || 1; canvas.width = Math.max(1, Math.round(bounds.width * ratio)); canvas.height = Math.max(1, Math.round(bounds.width * 9 / 16 * ratio));
    const context = canvas.getContext('2d'); context.setTransform(ratio, 0, 0, ratio, 0, 0); const width = bounds.width; const height = width * 9 / 16;
    context.fillStyle = '#11151b'; context.fillRect(0, 0, width, height); context.strokeStyle = '#29313c'; context.lineWidth = 1;
    for (let index = 1; index < 4; index++) { context.beginPath(); context.moveTo(width * index / 4, 0); context.lineTo(width * index / 4, height); context.stroke(); }
    for (let index = 1; index < 4; index++) { context.beginPath(); context.moveTo(0, height * index / 4); context.lineTo(width, height * index / 4); context.stroke(); }
    const displayArea = ['move', 'scale', 'rotate', 'draw'].includes(this.drag?.mode) && this.drag.current ? this.draggedArea() : this.area;
    const rect = noiseRectAt(displayArea, this.state.seconds()); const phase = noisePhases(displayArea, this.state.seconds());
    context.save(); context.translate(rect.center.x * width, (1 - rect.center.y) * height); context.rotate(-rect.rotation * Math.PI / 180);
    context.fillStyle = phase.active ? 'rgba(185,25,38,.42)' : 'rgba(210,100,108,.22)'; context.strokeStyle = '#ef4b57'; context.lineWidth = 1.5; context.setLineDash([4, 2]);
    context.fillRect(-rect.width * width / 2, -rect.height * height / 2, rect.width * width, rect.height * height); context.strokeRect(-rect.width * width / 2, -rect.height * height / 2, rect.width * width, rect.height * height); context.restore();
    const handles = rectHandles(rect, width, height); context.lineWidth = 1.5;
    context.strokeStyle = '#f7c95c'; context.beginPath(); context.moveTo(handles.top.x, handles.top.y); context.lineTo(handles.rotate.x, handles.rotate.y); context.stroke();
    for (const corner of handles.corners) { context.fillStyle = '#f7c95c'; context.strokeStyle = '#171b21'; context.fillRect(corner.x - 5, corner.y - 5, 10, 10); context.strokeRect(corner.x - 5, corner.y - 5, 10, 10); }
    context.fillStyle = '#f7c95c'; context.strokeStyle = '#171b21'; context.beginPath(); context.arc(handles.center.x, handles.center.y, 6, 0, Math.PI * 2); context.fill(); context.stroke();
    context.fillStyle = '#ef7480'; context.beginPath(); context.arc(handles.rotate.x, handles.rotate.y, 7, 0, Math.PI * 2); context.fill(); context.stroke();
    context.fillStyle = '#fff'; context.font = '11px sans-serif'; context.textAlign = 'center'; context.fillText('↻', handles.rotate.x, handles.rotate.y + 4);
  }
}

function button(title, onclick) { const result = document.createElement('button'); result.type = 'button'; result.textContent = title; result.onclick = onclick; return result; }
function field(title, control) { const label = document.createElement('label'); label.className = 'field'; label.append(title, control); control.setAttribute('aria-label', title); return label; }
function detailsSection(title) { const root = document.createElement('details'); root.className = 'noise-section'; const heading = document.createElement('summary'); heading.textContent = title; root.append(heading); return root; }
function setBounds(area, left, bottom, right, top) { area.topRightPercentage = { x: right, y: top }; area.bottomLeftPercentage = { x: left, y: bottom }; }
function replaceArea(target, source) { for (const key of Object.keys(target)) delete target[key]; Object.assign(target, source); }
function resizeBase(area, width, height) {
  const centerX = (area.bottomLeftPercentage.x + area.topRightPercentage.x) / 2; const centerY = (area.bottomLeftPercentage.y + area.topRightPercentage.y) / 2;
  const nextWidth = width ?? Math.abs(area.topRightPercentage.x - area.bottomLeftPercentage.x); const nextHeight = height ?? Math.abs(area.topRightPercentage.y - area.bottomLeftPercentage.y);
  setBounds(area, centerX - nextWidth / 2, centerY - nextHeight / 2, centerX + nextWidth / 2, centerY + nextHeight / 2);
}
function tidy(value) { return Math.abs(value - Math.round(value)) < 1e-9 ? Math.round(value) : Math.round(value * 1000) / 1000; }
function sortStable(events) { events.forEach((event, index) => { event.__sortIndex = index; }); events.sort((left, right) => left.time - right.time || left.__sortIndex - right.__sortIndex); events.forEach(event => { delete event.__sortIndex; }); }
function formatBeatFromSeconds(tempo, seconds) { return formatBeat(parseBeat(tempo.beat(seconds))); }
function rotatePoint(point, center, degrees) { const angle = degrees * Math.PI / 180; const cosine = Math.cos(angle); const sine = Math.sin(angle); const x = point.x - center.x; const y = point.y - center.y; return { x: center.x + x * cosine - y * sine, y: center.y + x * sine + y * cosine }; }
function rectHandles(rect, width, height) {
  const center = { x: rect.center.x * width, y: (1 - rect.center.y) * height }; const halfWidth = rect.width * width / 2; const halfHeight = rect.height * height / 2;
  const transform = point => rotatePoint({ x: center.x + point.x, y: center.y + point.y }, center, -rect.rotation);
  const corners = [transform({ x: -halfWidth, y: -halfHeight }), transform({ x: halfWidth, y: -halfHeight }), transform({ x: halfWidth, y: halfHeight }), transform({ x: -halfWidth, y: halfHeight })];
  return { center, corners, top: transform({ x: 0, y: -halfHeight }), rotate: transform({ x: 0, y: -halfHeight - 25 }) };
}
function handleAt(rect, point, width, height) {
  const handles = rectHandles(rect, width, height); const target = { x: point.x * width, y: (1 - point.y) * height }; const distance = value => Math.hypot(value.x - target.x, value.y - target.y);
  if (distance(handles.rotate) <= 14) return { kind: 'rotate' };
  const corner = handles.corners.findIndex(value => distance(value) <= 13); if (corner >= 0) return { kind: 'corner', corner };
  if (distance(handles.center) <= 16) return { kind: 'center' };
  return null;
}
function screenContains(rect, point, width, height) {
  const center = { x: rect.center.x * width, y: (1 - rect.center.y) * height }; const local = rotatePoint({ x: point.x * width, y: (1 - point.y) * height }, center, rect.rotation);
  return Math.abs(local.x - center.x) <= rect.width * width / 2 && Math.abs(local.y - center.y) <= rect.height * height / 2;
}
