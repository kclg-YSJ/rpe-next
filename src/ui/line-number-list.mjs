import { groupLineIndices, groupNames, isDefaultLineName, lineFeatureLabels, lineNameLabel } from '../core/line-groups.mjs';
import { t } from '../i18n.mjs';

// Shared line rows only: no editing mode, merge state, timeline layout or selection
// state is owned here. Each caller supplies its own independent numeric list.
export class LineNumberList {
  constructor(host, { state, change, finish = () => {} }) {
    this.host = host; this.state = state; this.change = change; this.finish = finish;
    this.rows = new Map(); this.scrollTop = 0;
  }
  sync() {
    const state = this.state(), selected = new Set(state.indices);
    for (const [index, { row, checkbox }] of this.rows) {
      checkbox.checked = selected.has(index); checkbox.disabled = Boolean(state.disabled?.(index));
      row.classList.toggle('selected', checkbox.checked); row.classList.toggle('current', index === state.lineIndex);
    }
  }
  setRow(index, selected) {
    const values = new Set(this.state().indices);
    if (selected) values.add(index); else values.delete(index);
    this.change([...values].sort((a, b) => a - b)); this.sync();
  }
  render() {
    if (this.list) { if(this.list.isConnected)this.scrollTop = this.list.scrollTop; this.list.remove(); }
    const state = this.state(), chart = state.chart, lines = chart.judgeLineList ?? [], names = groupNames(chart);
    const list = this.list = document.createElement('div'); list.className = 'multi-line-list'; this.rows = new Map();
    list.addEventListener('scroll', () => { this.scrollTop = list.scrollTop; }, { passive: true });
    const createRow = (index, line) => {
      const row = document.createElement('label'); row.className = 'multi-line-row'; row.dataset.lineIndex = index;
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
      checkbox.onchange = () => { this.setRow(index, checkbox.checked); this.finish(); };
      const label = document.createElement('span'); label.className = 'multi-line-name';
      const name = document.createElement('span'); name.className = 'multi-line-line-name';
      const lineLabel = lineNameLabel(line, index); name.textContent = isDefaultLineName(line, index) ? lineLabel : t('multi-line.s3ad4a06', { p0: index, p1: lineLabel });
      const features = lineFeatureLabels(line), featureText = document.createElement('small'); featureText.className = 'multi-line-features'; featureText.textContent = features.join(' · '); featureText.hidden = !features.length; label.append(name, featureText);
      const stats = document.createElement('small'), events = [...(line.eventLayers ?? []), line.extended ?? {}].reduce((sum, layer) => sum + Object.values(layer ?? {}).reduce((total, value) => total + (Array.isArray(value) ? value.length : 0), 0), 0);
      stats.textContent = t('multi-line.sdf24632', { p0: line.notes?.length ?? 0, p1: events });
      row.append(checkbox, label, stats); this.rows.set(index, { row, checkbox }); return row;
    };
    if (names.slice(1).some((_, group) => groupLineIndices(chart, group + 1).length > 0)) {
      for (const [index, groupName] of names.entries()) {
        const group = document.createElement('details'); group.className = 'multi-line-group'; group.open = true;
        const summary = document.createElement('summary'), label = document.createElement('span'), count = document.createElement('small'); label.className = 'multi-line-group-name'; label.textContent = groupName;
        const indices = groupLineIndices(chart, index); count.textContent = t('multi-line.s1dd4cc9', { p0: indices.length }); summary.append(label, count); group.append(summary);
        const rows = document.createElement('div'); rows.className = 'multi-line-group-rows';
        for (const index of indices) rows.append(createRow(index, lines[index]));
        group.append(rows); list.append(group);
      }
    } else for (const [index, line] of lines.entries()) list.append(createRow(index, line));
    const finishDrag = () => {
      if (!this.drag) return;
      this.scrollTop = list.scrollTop; this.drag = null; this.finish();
    };
    list.addEventListener('pointerdown', event => {
      const row = event.target.closest('.multi-line-row'); if (!row || event.button !== 0 || row.querySelector('input').disabled) return;
      event.preventDefault(); this.scrollTop = list.scrollTop; list.setPointerCapture?.(event.pointerId);
      const index = Number(row.dataset.lineIndex); this.drag = { selected: !this.state().indices.includes(index), pointerId: event.pointerId }; this.setRow(index, this.drag.selected);
    });
    list.addEventListener('pointermove', event => {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      const rectangle = list.getBoundingClientRect();
      if (event.clientY < rectangle.top + 22) list.scrollTop -= 12;
      else if (event.clientY > rectangle.bottom - 22) list.scrollTop += 12;
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.multi-line-row');
      if (row && list.contains(row) && !row.querySelector('input').disabled) this.setRow(Number(row.dataset.lineIndex), this.drag.selected);
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) list.addEventListener(event, finishDrag);
    this.host.append(list); this.sync(); list.scrollTop = this.scrollTop;
    requestAnimationFrame(() => { if (list.isConnected) list.scrollTop = this.scrollTop; });
  }
}
