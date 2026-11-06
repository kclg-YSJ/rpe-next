import { formatLineExpression, parseLineExpression } from '../application/multi-line-edit.mjs';
import { LineNumberList } from './line-number-list.mjs';
import { t } from '../i18n.mjs';
import { EVENT_TYPES } from '../core/chart.mjs';
import { SPECIAL_TRACKS } from '../core/editor-display.mjs';

export class MultiLinePanel {
  constructor(host, getSession, { activate = () => {}, render = () => {}, notify = () => {}, timeline = null, persist = () => {} } = {}) {
    this.host = host; this.getSession = getSession; this.activate = activate; this.renderSession = render; this.notify = notify; this.timeline = timeline; this.persist = persist; this.drag = null; this.listScrollTop = null; this.eventColumnsOpen = false;
  }

  syncSelection() {
    const session = this.getSession(), selected = new Set(session.multiLineIndices);
    if (this.count) this.count.textContent = session.multiLineActive ? t('multi-line.s9191962', { p0: selected.size }) : t('multi-line.sb9004e6');
    if (this.expression && document.activeElement !== this.expression) this.expression.value = session.multiLineExpression || formatLineExpression(session.multiLineIndices, session.chart);
    for (const [index, { row, checkbox }] of this.rows ?? []) {
      if (checkbox.checked !== selected.has(index)) { checkbox.checked = selected.has(index); row.classList.toggle('selected', checkbox.checked); }
      const disabled = !session.multiLineEnabled && index !== session.lineIndex;
      if (checkbox.disabled !== disabled) checkbox.disabled = disabled;
    }
  }

  render() {
    const session = this.getSession();
    if (!session) return;
    const previousList = this.host.querySelector('.multi-line-list');
    const previousScrollTop = this.listScrollTop !== null ? this.listScrollTop : previousList?.scrollTop ?? 0;
    this.host.replaceChildren();
    const title = document.createElement('div'); title.className = 'panel-title';
    title.append(t('multi-line.s5255093'));
    const count = document.createElement('small'); this.count = count; count.textContent = session.multiLineActive ? t('multi-line.s9191962', { p0: session.multiLineIndices.length }) : t('multi-line.sb9004e6'); title.append(count);
    this.host.append(title);
    const intro = document.createElement('p'); intro.className = 'hint'; intro.textContent = t('multi-line.s59e6f4f'); this.host.append(intro);
    const widthField = document.createElement('label'); widthField.className = 'field multi-line-width-field'; widthField.append(t('multi-line.s5a95e4f'));
    const widthControls = document.createElement('span'); widthControls.className = 'multi-line-width-controls';
    const currentArea = session.multiLineMode === 'events' ? 'events' : 'notes';
    const currentCanvas = currentArea === 'events' ? this.timeline?.eventsCanvas : this.timeline?.notesCanvas;
    const widthInput = document.createElement('input'); widthInput.type = 'range'; widthInput.min = 30; widthInput.max = 2400; widthInput.step = 10; widthInput.value = (currentArea === 'events' ? this.timeline?.multiLineEventWidth : this.timeline?.multiLineWidth) || currentCanvas?.clientWidth || 640; widthInput.title = t('multi-line.sdb6b83c');
    const widthValue = document.createElement('output'); widthValue.textContent = `${widthInput.value}px`;
    const setWidth = raw => {
      const value = Math.max(30, Math.min(2400, Number(raw) || 640));
      if (this.timeline) {
        const area = session.multiLineMode === 'events' ? 'events' : 'notes';
        const canvas = area === 'events' ? this.timeline.eventsCanvas : this.timeline.notesCanvas;
        const viewport = canvas?.clientWidth || 640;
        const oldOffset = this.timeline.multiLineViewportOffset(viewport, area);
        const center = oldOffset + viewport / 2;
        if (area === 'events') { this.timeline.multiLineEventWidth = value; this.timeline.multiLineEventWidthExplicit = true; }
        else { this.timeline.multiLineWidth = value; this.timeline.multiLineWidthExplicit = true; }
        const total = this.timeline.panelCount(area) * this.timeline.panelWidth(viewport, area) + Math.max(0, this.timeline.panelCount(area) - 1) * this.timeline.panelGap(viewport, area);
        const maximum = Math.max(0, total - viewport);
        const nextOffset = Math.max(0, Math.min(maximum, center - viewport / 2));
        this.timeline.multiLineScroll[area] = nextOffset;
        this.timeline.changed();
      }
      widthInput.value = value; widthValue.textContent = `${value}px`; this.persist();
    };
    widthInput.oninput = () => setWidth(widthInput.value);
    const resetWidth = document.createElement('button'); resetWidth.type = 'button'; resetWidth.textContent = t('multi-line.s3d81345'); resetWidth.title = t('multi-line.s2c298fb'); resetWidth.onclick = () => { if (this.timeline) { if (currentArea === 'events') { this.timeline.multiLineEventWidth = 0; this.timeline.multiLineEventWidthExplicit = false; } else { this.timeline.multiLineWidth = 0; this.timeline.multiLineWidthExplicit = false; } this.timeline.multiLineScroll = { notes: 0, events: 0 }; this.timeline.changed(); } widthInput.value = currentCanvas?.clientWidth || 640; widthValue.textContent = `${widthInput.value}px`; this.persist(); };
    widthControls.append(widthInput, widthValue, resetWidth); widthField.append(widthControls); this.host.append(widthField);
    const controls = document.createElement('div'); controls.className = 'multi-line-controls';
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = session.multiLineEnabled ? 'active' : ''; toggle.textContent = session.multiLineEnabled ? t('multi-line.s1d50fad') : t('multi-line.s743ed93');
    toggle.title = t('multi-line.s59cf922'); toggle.onclick = () => { session.setMultiLineEnabled(!session.multiLineEnabled, session.multiLineMode); this.renderSession(); };
    const notes = document.createElement('button'); notes.type = 'button'; notes.className = session.multiLineMode === 'notes' ? 'active' : ''; notes.textContent = t('multi-line.s7ac3289'); notes.title = t('multi-line.s6d7885f'); notes.onclick = () => { session.setMultiLineMode('notes'); this.renderSession(); };
    const events = document.createElement('button'); events.type = 'button'; events.className = session.multiLineMode === 'events' ? 'active' : ''; events.textContent = t('multi-line.s550e328'); events.title = t('multi-line.s6c1e2e2'); events.onclick = () => { session.setMultiLineMode('events'); this.renderSession(); };
    const merge = document.createElement('button'); merge.type = 'button'; merge.className = session.multiLineMerge && session.multiLineMode === 'notes' ? 'active' : ''; merge.textContent = t('multi-line.se5badf9'); merge.disabled = session.multiLineMode !== 'notes'; merge.title = t('multi-line.sda21a31'); merge.onclick = () => { session.setMultiLineMerge(!session.multiLineMerge); this.renderSession(); };
    controls.append(toggle, notes, events, merge); this.host.append(controls);
    const actions = document.createElement('div'); actions.className = 'multi-line-actions';
    for (const [label, titleText, handler] of [[t('multi-line.sb6b7860'), t('multi-line.s8cb190d'), () => session.addMultiLine()], [t('multi-line.s71ba1bd'), t('multi-line.s25c8560'), () => session.removeMultiLine()], [t('multi-line.s84fcd70'), t('multi-line.s4cb63e2'), () => session.clearMultiLines()]]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.title = titleText; button.onclick = () => { handler(); this.renderSession(); }; actions.append(button);
    }
    this.host.append(actions);
    const expressionField = document.createElement('label'); expressionField.className = 'field multi-line-expression-field'; expressionField.append(t('multi-line.s6dcecd0'));
    const expression = document.createElement('input'); this.expression = expression; expression.type = 'text'; expression.inputMode = 'text'; expression.placeholder = t('multi-line.s188ac1e'); expression.value = session.multiLineExpression || formatLineExpression(session.multiLineIndices, session.chart); expression.title = t('multi-line.s9cd3607'); expressionField.append(expression); this.host.append(expressionField);
    const applyExpression = () => {
      if (expression.value.trim() === (session.multiLineExpression || formatLineExpression(session.multiLineIndices, session.chart))) return;
      const previous = [...session.multiLineIndices], previousExpression = session.multiLineExpression;
      try {
        const result = this.timeline?.resolveMultiLineExpression(expression.value) ?? { indices: parseLineExpression(expression.value, session.chart.judgeLineList?.length ?? 0, session.chart) };
        if (!result.indices.length && !result.dynamic) throw new Error(t('multi-line.sa828e01'));
        if (this.timeline) this.timeline.setMultiLineExpression(expression.value); else session.multiLineIndices = result.indices;
        session.multiLineEnabled = true; session.normalizeMultiLine(); session.notify(); this.renderSession();
      } catch (error) { expression.value = previousExpression || formatLineExpression(previous, session.chart); this.notify(error.message, 'warning'); }
    };
    expression.addEventListener('change', applyExpression); expression.addEventListener('blur', applyExpression); expression.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); applyExpression(); } });
    const columns = document.createElement('details'); columns.className = 'multi-line-event-columns'; columns.open = this.eventColumnsOpen;
    columns.addEventListener('toggle', () => { if (columns.isConnected) this.eventColumnsOpen = columns.open; });
    const summary = document.createElement('summary'); summary.textContent = t('multi-line.eventColumns'); columns.append(summary);
    const options = document.createElement('div'); options.className = 'multi-line-event-options';
    for (const type of this.timeline?.extended ? SPECIAL_TRACKS.map(track => track.key) : EVENT_TYPES) {
      const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = this.timeline?.multiLineEventVisibility?.[type] !== false;
      label.append(input, this.timeline?.eventLabel(type) ?? type);
      input.onchange = () => {
        if (!this.timeline) return;
        this.timeline.multiLineEventVisibility = { ...this.timeline.multiLineEventVisibility, [type]: input.checked };
        this.timeline.cancelPlacement(); this.timeline.changed(); this.persist();
      };
      options.append(label);
    }
    columns.append(options); this.host.append(columns);
    this.lineNumbers ??= new LineNumberList(this.host, {
      state: () => { const current = this.getSession(); return { chart: current.chart, indices: current.multiLineIndices, lineIndex: current.lineIndex, disabled: index => !current.multiLineEnabled && index !== current.lineIndex }; },
      change: indices => { const current = this.getSession(); current.multiLineIndices = indices; current.multiLineExpression = ''; current.multiLineEnabled = indices.length > 0; if (this.expression) this.expression.value = formatLineExpression(indices, current.chart); },
      finish: () => { const current = this.getSession(); current.normalizeMultiLine(); current.notify(); this.renderSession(); },
    });
    this.lineNumbers.render(); this.rows = this.lineNumbers.rows;

  }
}
