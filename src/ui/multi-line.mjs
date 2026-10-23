import { formatLineExpression, parseLineExpression } from '../application/multi-line-edit.mjs';
import { groupLineIndices, groupNames, isDefaultLineName, lineFeatureLabels, lineNameLabel } from '../core/line-groups.mjs';
import { t } from '../i18n.mjs';

export class MultiLinePanel {
  constructor(host, getSession, { activate = () => {}, render = () => {}, notify = () => {}, timeline = null, persist = () => {} } = {}) {
    this.host = host; this.getSession = getSession; this.activate = activate; this.renderSession = render; this.notify = notify; this.timeline = timeline; this.persist = persist; this.drag = null; this.listScrollTop = null;
  }

  render() {
    const session = this.getSession();
    if (!session) return;
    const previousList = this.host.querySelector('.multi-line-list');
    const previousScrollTop = this.listScrollTop !== null ? this.listScrollTop : previousList?.scrollTop ?? 0;
    this.host.replaceChildren();
    const title = document.createElement('div'); title.className = 'panel-title';
    title.append(t('multi-line.s5255093'));
    const count = document.createElement('small'); count.textContent = session.multiLineActive ? t('multi-line.s9191962', { p0: session.multiLineIndices.length }) : t('multi-line.sb9004e6'); title.append(count);
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
    const expression = document.createElement('input'); expression.type = 'text'; expression.inputMode = 'text'; expression.placeholder = t('multi-line.s188ac1e'); expression.value = formatLineExpression(session.multiLineIndices, session.chart); expression.title = t('multi-line.s9cd3607'); expressionField.append(expression); this.host.append(expressionField);
    const applyExpression = () => {
      const previous = [...session.multiLineIndices];
      try {
        const indices = parseLineExpression(expression.value, session.chart.judgeLineList?.length ?? 0, session.chart);
        if (!indices.length) throw new Error(t('multi-line.sa828e01'));
        session.multiLineIndices = indices; session.multiLineEnabled = true; session.normalizeMultiLine(); session.notify(); this.renderSession();
      } catch (error) { expression.value = formatLineExpression(previous, session.chart); this.notify(error.message, 'warning'); }
    };
    expression.addEventListener('change', applyExpression); expression.addEventListener('blur', applyExpression); expression.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); applyExpression(); } });
    const list = document.createElement('div'); list.className = 'multi-line-list';
    list.addEventListener('scroll', () => { this.listScrollTop = list.scrollTop; }, { passive: true });
    const syncExpression = () => { expression.value = formatLineExpression(session.multiLineIndices, session.chart); };
    const setRow = (index, selected) => {
      const values = new Set(session.multiLineIndices);
      if (selected) values.add(index); else values.delete(index);
      session.multiLineIndices = [...values].sort((left, right) => left - right);
      session.multiLineEnabled = session.multiLineIndices.length > 0;
      syncExpression();
      list.querySelectorAll('.multi-line-row').forEach(row => {
        const rowIndex = Number(row.dataset.lineIndex); const active = session.multiLineIndices.includes(rowIndex);
        row.classList.toggle('selected', active); const checkbox = row.querySelector('input'); if (checkbox) checkbox.checked = active;
      });
    };
    const lines = session.chart.judgeLineList ?? []; const names = groupNames(session.chart);
    const createRow = (index, line) => {
      const row = document.createElement('label'); row.className = 'multi-line-row'; row.dataset.lineIndex = index;
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = session.isTargetLine(index); checkbox.disabled = !session.multiLineEnabled && index !== session.lineIndex;
      checkbox.onchange = () => { setRow(index, checkbox.checked); session.notify(); this.renderSession(); };
      const label = document.createElement('span'); label.className = 'multi-line-name'; const name = document.createElement('span'); name.className = 'multi-line-line-name';
      const lineLabel = lineNameLabel(line, index); name.textContent = isDefaultLineName(line, index) ? lineLabel : t('multi-line.s3ad4a06', { p0: index, p1: lineLabel });
      const features = lineFeatureLabels(line); const featureText = document.createElement('small'); featureText.className = 'multi-line-features'; featureText.textContent = features.join(' · '); featureText.hidden = !features.length; label.append(name, featureText);
      const stats = document.createElement('small'); const events = [...(line.eventLayers ?? []), line.extended ?? {}].reduce((sum, layer) => sum + Object.values(layer ?? {}).reduce((total, value) => total + (Array.isArray(value) ? value.length : 0), 0), 0); stats.textContent = t('multi-line.sdf24632', { p0: line.notes?.length ?? 0, p1: events });
      row.classList.toggle('current', index === session.lineIndex); row.classList.toggle('selected', checkbox.checked); row.append(checkbox, label, stats); return row;
    };
    const hasNamedGroups = names.slice(1).some((unused, groupIndex) => groupLineIndices(session.chart, groupIndex + 1).length > 0);
    if (hasNamedGroups) {
      for (const [groupIndex, groupName] of names.entries()) {
        const group = document.createElement('details'); group.className = 'multi-line-group'; group.open = true;
        const summary = document.createElement('summary'); const label = document.createElement('span'); label.className = 'multi-line-group-name'; label.textContent = groupName; const count = document.createElement('small'); count.textContent = t('multi-line.s1dd4cc9', { p0: groupLineIndices(session.chart, groupIndex).length }); summary.append(label, count); group.append(summary);
        const rows = document.createElement('div'); rows.className = 'multi-line-group-rows';
        for (const index of groupLineIndices(session.chart, groupIndex)) rows.append(createRow(index, lines[index]));
        group.append(rows); list.append(group);
      }
    } else {
      for (const [index, line] of lines.entries()) list.append(createRow(index, line));
    }
    const finishDrag = () => { if (!this.drag) return; this.listScrollTop = list.scrollTop; this.drag = null; session.normalizeMultiLine(); session.notify(); this.renderSession(); };
    list.addEventListener('pointerdown', event => {
      const row = event.target.closest('.multi-line-row'); if (!row || event.button !== 0) return;
      event.preventDefault(); this.listScrollTop = list.scrollTop; list.setPointerCapture?.(event.pointerId); const index = Number(row.dataset.lineIndex); this.drag = { selected: !session.multiLineIndices.includes(index), pointerId: event.pointerId }; setRow(index, this.drag.selected);
    });
    list.addEventListener('pointermove', event => {
      if (!this.drag || (this.drag.pointerId !== undefined && event.pointerId !== this.drag.pointerId)) return;
      const rectangle = list.getBoundingClientRect(); const edge = 22;
      if (event.clientY < rectangle.top + edge) list.scrollTop -= 12;
      else if (event.clientY > rectangle.bottom - edge) list.scrollTop += 12;
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.multi-line-row');
      if (row && list.contains(row)) setRow(Number(row.dataset.lineIndex), this.drag.selected);
    });
    list.addEventListener('pointerup', finishDrag); list.addEventListener('pointercancel', finishDrag); list.addEventListener('lostpointercapture', finishDrag);
    this.listScrollTop = Math.max(0, previousScrollTop);
    list.scrollTop = this.listScrollTop;
    requestAnimationFrame(() => { if (list.isConnected) list.scrollTop = this.listScrollTop; });
    this.host.append(list);
  }
}
