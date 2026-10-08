import { formatLineExpression, parseLineExpression } from '../application/multi-line-edit.ts';
import { groupLineIndices, groupNames, isDefaultLineName, lineFeatureLabels, lineNameLabel } from '../core/line-groups.ts';
import type { EditorSession } from '../application/session.ts';
import type { JudgeLine } from '../core/types.ts';
import type { Timeline } from './timeline.ts';

/** The two editing areas the multi-line workspace splits into; also the keys of `multiLineScroll`. */
export type MultiLineArea = 'notes' | 'events';

/** The line-list drag in progress: which way it is extending the selection, and the captured pointer. */
export interface MultiLineDrag {
  selected: boolean;
  pointerId: number;
}

/** What {@link MultiLinePanel}'s host supplies. Every hook defaults to a no-op and `timeline` to `null`. */
export interface MultiLinePanelOptions {
  activate?: () => void;
  render?: () => void;
  notify?: (message: string, level?: string) => void;
  timeline?: Timeline | null;
  persist?: () => void;
}

export class MultiLinePanel {
  // Declared explicitly: an unannotated `null` field would be inferred as `null` and an unannotated
  // `[]` as `never[]`, which cascades into the callers (see `EditorSession`'s own field comment).
  host: HTMLElement;
  getSession: () => EditorSession | null;
  activate: () => void;
  renderSession: () => void;
  notify: (message: string, level?: string) => void;
  timeline: Timeline | null;
  persist: () => void;
  drag: MultiLineDrag | null;
  /** The list's scroll position, carried across the re-render; `null` before the first one. */
  listScrollTop: number | null;

  constructor(host: HTMLElement, getSession: () => EditorSession | null, { activate = () => {}, render = () => {}, notify = () => {}, timeline = null, persist = () => {} }: MultiLinePanelOptions = {}) {
    this.host = host; this.getSession = getSession; this.activate = activate; this.renderSession = render; this.notify = notify; this.timeline = timeline; this.persist = persist; this.drag = null; this.listScrollTop = null;
  }

  render(): void {
    const session = this.getSession();
    if (!session) return;
    const previousList = this.host.querySelector('.multi-line-list');
    const previousScrollTop = this.listScrollTop !== null ? this.listScrollTop : previousList?.scrollTop ?? 0;
    this.host.replaceChildren();
    const title = document.createElement('div'); title.className = 'panel-title';
    title.append('多线编辑');
    const count = document.createElement('small'); count.textContent = session.multiLineActive ? `${session.multiLineIndices.length} 条线` : '未开启'; title.append(count);
    this.host.append(title);
    const intro = document.createElement('p'); intro.className = 'hint'; intro.textContent = '多线模式会将所选判定线并列显示；点击对应区域即可编辑该线。音符合并模式会共用一个编辑区域。'; this.host.append(intro);
    const widthField = document.createElement('label'); widthField.className = 'field multi-line-width-field'; widthField.append('单线宽度');
    const widthControls = document.createElement('span'); widthControls.className = 'multi-line-width-controls';
    const currentArea: MultiLineArea = session.multiLineMode === 'events' ? 'events' : 'notes';
    const currentCanvas = currentArea === 'events' ? this.timeline?.eventsCanvas : this.timeline?.notesCanvas;
    const widthInput = document.createElement('input'); widthInput.type = 'range'; widthInput.min = '30'; widthInput.max = '2400'; widthInput.step = '10'; widthInput.value = String((currentArea === 'events' ? this.timeline?.multiLineEventWidth : this.timeline?.multiLineWidth) || currentCanvas?.clientWidth || 640); widthInput.title = '多线模式下每条线编辑区域的宽度';
    const widthValue = document.createElement('output'); widthValue.textContent = `${widthInput.value}px`;
    const setWidth = (raw: string): void => {
      const value = Math.max(30, Math.min(2400, Number(raw) || 640));
      if (this.timeline) {
        const area: MultiLineArea = session.multiLineMode === 'events' ? 'events' : 'notes';
        const canvas = area === 'events' ? this.timeline.eventsCanvas : this.timeline.notesCanvas;
        const viewport = canvas?.clientWidth || 640;
        const oldOffset = this.timeline.multiLineViewportOffset(viewport, area);
        const center = oldOffset + viewport / 2;
        if (area === 'events') { this.timeline.multiLineEventWidth = value; this.timeline.multiLineEventWidthExplicit = true; }
        else { this.timeline.multiLineWidth = value; this.timeline.multiLineWidthExplicit = true; }
        const total = this.timeline.panelCount(area) * this.timeline.panelWidth(viewport, area) + Math.max(0, this.timeline.panelCount(area) - 1) * this.timeline.panelGap(viewport, area);
        const maximum = Math.max(0, total - viewport);
        const nextOffset = Math.max(0, Math.min(maximum, center - viewport / 2));
        // `multiLineScroll` is the union `number | { notes, events }`; a number is the legacy form
        // that `multiLineViewportOffset` still migrates in place, so it is replaced wholesale here
        // before the per-area key is written.
        const scroll = this.timeline.multiLineScroll;
        const scrollByArea: { notes: number; events: number } = typeof scroll === 'number' ? { notes: scroll, events: scroll } : scroll;
        scrollByArea[area] = nextOffset; this.timeline.multiLineScroll = scrollByArea;
        this.timeline.changed();
      }
      widthInput.value = String(value); widthValue.textContent = `${value}px`; this.persist();
    };
    widthInput.oninput = () => setWidth(widthInput.value);
    const resetWidth = document.createElement('button'); resetWidth.type = 'button'; resetWidth.textContent = '重置'; resetWidth.title = '恢复为当前编辑区域的默认宽度'; resetWidth.onclick = () => { if (this.timeline) { if (currentArea === 'events') { this.timeline.multiLineEventWidth = 0; this.timeline.multiLineEventWidthExplicit = false; } else { this.timeline.multiLineWidth = 0; this.timeline.multiLineWidthExplicit = false; } this.timeline.multiLineScroll = { notes: 0, events: 0 }; this.timeline.changed(); } widthInput.value = String(currentCanvas?.clientWidth || 640); widthValue.textContent = `${widthInput.value}px`; this.persist(); };
    widthControls.append(widthInput, widthValue, resetWidth); widthField.append(widthControls); this.host.append(widthField);
    const controls = document.createElement('div'); controls.className = 'multi-line-controls';
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = session.multiLineEnabled ? 'active' : ''; toggle.textContent = session.multiLineEnabled ? '● 多线' : '○ 多线';
    toggle.title = '开启或关闭多线编辑'; toggle.onclick = () => { session.setMultiLineEnabled(!session.multiLineEnabled, session.multiLineMode); this.renderSession(); };
    const notes = document.createElement('button'); notes.type = 'button'; notes.className = session.multiLineMode === 'notes' ? 'active' : ''; notes.textContent = '音符'; notes.title = '多线音符模式'; notes.onclick = () => { session.setMultiLineMode('notes'); this.renderSession(); };
    const events = document.createElement('button'); events.type = 'button'; events.className = session.multiLineMode === 'events' ? 'active' : ''; events.textContent = '事件'; events.title = '多线事件模式'; events.onclick = () => { session.setMultiLineMode('events'); this.renderSession(); };
    const merge = document.createElement('button'); merge.type = 'button'; merge.className = session.multiLineMerge && session.multiLineMode === 'notes' ? 'active' : ''; merge.textContent = '合并'; merge.disabled = session.multiLineMode !== 'notes'; merge.title = '合并多线音符编辑区域'; merge.onclick = () => { session.setMultiLineMerge(!session.multiLineMerge); this.renderSession(); };
    controls.append(toggle, notes, events, merge); this.host.append(controls);
    const actions = document.createElement('div'); actions.className = 'multi-line-actions';
    for (const [label, titleText, handler] of [['加入当前线', '将当前判定线加入多线编辑', () => session.addMultiLine()], ['移出当前线', '将当前判定线移出多线编辑', () => session.removeMultiLine()], ['清空', '清空参与编辑的判定线', () => session.clearMultiLines()]] as [string, string, () => void][]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.title = titleText; button.onclick = () => { handler(); this.renderSession(); }; actions.append(button);
    }
    this.host.append(actions);
    const expressionField = document.createElement('label'); expressionField.className = 'field multi-line-expression-field'; expressionField.append('线号');
    const expression = document.createElement('input'); expression.type = 'text'; expression.inputMode = 'text'; expression.placeholder = '例如 0 2:4 GroupA'; expression.value = formatLineExpression(session.multiLineIndices, session.chart); expression.title = '空格分隔线号；x:y 表示连续线号；输入分组名表示该组全部判定线'; expressionField.append(expression); this.host.append(expressionField);
    const applyExpression = (): void => {
      const previous = [...session.multiLineIndices];
      try {
        const indices = parseLineExpression(expression.value, session.chart.judgeLineList?.length ?? 0, session.chart);
        if (!indices.length) throw new Error('至少需要一条有效判定线');
        session.multiLineIndices = indices; session.multiLineEnabled = true; session.normalizeMultiLine(); session.notify(); this.renderSession();
      } catch (error) { expression.value = formatLineExpression(previous, session.chart); this.notify(error instanceof Error ? error.message : String(error), 'warning'); }
    };
    expression.addEventListener('change', applyExpression); expression.addEventListener('blur', applyExpression); expression.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); applyExpression(); } });
    const list = document.createElement('div'); list.className = 'multi-line-list';
    list.addEventListener('scroll', () => { this.listScrollTop = list.scrollTop; }, { passive: true });
    const syncExpression = (): void => { expression.value = formatLineExpression(session.multiLineIndices, session.chart); };
    const setRow = (index: number, selected: boolean): void => {
      const values = new Set(session.multiLineIndices);
      if (selected) values.add(index); else values.delete(index);
      session.multiLineIndices = [...values].sort((left, right) => left - right);
      session.multiLineEnabled = session.multiLineIndices.length > 0;
      syncExpression();
      // `querySelectorAll` yields `Element`, which has no `dataset`/`checked`; the list only ever
      // holds the `<label class="multi-line-row">` elements built by `createRow` below.
      list.querySelectorAll<HTMLLabelElement>('.multi-line-row').forEach(row => {
        const rowIndex = Number(row.dataset.lineIndex); const active = session.multiLineIndices.includes(rowIndex);
        row.classList.toggle('selected', active); const checkbox = row.querySelector('input'); if (checkbox) checkbox.checked = active;
      });
    };
    const lines = session.chart.judgeLineList ?? []; const names = groupNames(session.chart);
    const createRow = (index: number, line: JudgeLine): HTMLLabelElement => {
      const row = document.createElement('label'); row.className = 'multi-line-row'; row.dataset.lineIndex = String(index);
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = session.isTargetLine(index); checkbox.disabled = !session.multiLineEnabled && index !== session.lineIndex;
      checkbox.onchange = () => { setRow(index, checkbox.checked); session.notify(); this.renderSession(); };
      const label = document.createElement('span'); label.className = 'multi-line-name'; const name = document.createElement('span'); name.className = 'multi-line-line-name';
      const lineLabel = lineNameLabel(line, index); name.textContent = isDefaultLineName(line, index) ? lineLabel : `线 ${index} · ${lineLabel}`;
      const features = lineFeatureLabels(line); const featureText = document.createElement('small'); featureText.className = 'multi-line-features'; featureText.textContent = features.join(' · '); featureText.hidden = !features.length; label.append(name, featureText);
      const stats = document.createElement('small'); const events = [...(line.eventLayers ?? []), line.extended ?? {}].reduce((sum, layer) => sum + Object.values(layer ?? {}).reduce((total, value) => total + (Array.isArray(value) ? value.length : 0), 0), 0); stats.textContent = `${line.notes?.length ?? 0} 音符 · ${events} 事件`;
      row.classList.toggle('current', index === session.lineIndex); row.classList.toggle('selected', checkbox.checked); row.append(checkbox, label, stats); return row;
    };
    const hasNamedGroups = names.slice(1).some((unused, groupIndex) => groupLineIndices(session.chart, groupIndex + 1).length > 0);
    if (hasNamedGroups) {
      for (const [groupIndex, groupName] of names.entries()) {
        const group = document.createElement('details'); group.className = 'multi-line-group'; group.open = true;
        const summary = document.createElement('summary'); const label = document.createElement('span'); label.className = 'multi-line-group-name'; label.textContent = groupName; const count = document.createElement('small'); count.textContent = `${groupLineIndices(session.chart, groupIndex).length} 条`; summary.append(label, count); group.append(summary);
        const rows = document.createElement('div'); rows.className = 'multi-line-group-rows';
        for (const index of groupLineIndices(session.chart, groupIndex)) rows.append(createRow(index, lines[index]));
        group.append(rows); list.append(group);
      }
    } else {
      for (const [index, line] of lines.entries()) list.append(createRow(index, line));
    }
    const finishDrag = (): void => { if (!this.drag) return; this.listScrollTop = list.scrollTop; this.drag = null; session.normalizeMultiLine(); session.notify(); this.renderSession(); };
    list.addEventListener('pointerdown', event => {
      // `event.target` is an `EventTarget`; the row lookup needs the `Element` face of it.
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest<HTMLLabelElement>('.multi-line-row'); if (!row || event.button !== 0) return;
      event.preventDefault(); this.listScrollTop = list.scrollTop; list.setPointerCapture?.(event.pointerId); const index = Number(row.dataset.lineIndex); this.drag = { selected: !session.multiLineIndices.includes(index), pointerId: event.pointerId }; setRow(index, this.drag.selected);
    });
    list.addEventListener('pointermove', event => {
      if (!this.drag || (this.drag.pointerId !== undefined && event.pointerId !== this.drag.pointerId)) return;
      const rectangle = list.getBoundingClientRect(); const edge = 22;
      if (event.clientY < rectangle.top + edge) list.scrollTop -= 12;
      else if (event.clientY > rectangle.bottom - edge) list.scrollTop += 12;
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLLabelElement>('.multi-line-row');
      if (row && list.contains(row)) setRow(Number(row.dataset.lineIndex), this.drag.selected);
    });
    list.addEventListener('pointerup', finishDrag); list.addEventListener('pointercancel', finishDrag); list.addEventListener('lostpointercapture', finishDrag);
    // `Math.max(0, ...)` already rules out a negative value, so the argument is a number here; the
    // binding records that for the nullable field without changing either assignment below.
    const restoredScrollTop: number = Math.max(0, previousScrollTop);
    this.listScrollTop = restoredScrollTop;
    list.scrollTop = this.listScrollTop;
    requestAnimationFrame(() => { if (list.isConnected) list.scrollTop = this.listScrollTop ?? 0; });
    this.host.append(list);
  }
}
