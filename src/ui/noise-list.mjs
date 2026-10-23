import { formatBeat } from '../core/beat.mjs';
import { t } from '../i18n.mjs';

const ROW_HEIGHT = 44;
const OVERSCAN = 4;

export class NoiseAreaList {
  constructor(select) {
    this.select = select; this.areas = []; this.indices = []; this.selected = -1; this.rows = new Map();
    this.element = document.createElement('div'); this.element.className = 'noise-list';
    this.element.setAttribute('role', 'listbox'); this.element.setAttribute('aria-label', t('noise-list.s61d33c8')); this.element.tabIndex = 0;
    this.content = document.createElement('div'); this.content.className = 'noise-list-content'; this.element.append(this.content);
    this.element.addEventListener('scroll', () => this.schedule(), { passive: true });
    this.element.addEventListener('keydown', event => {
      const current = this.indices.indexOf(Number(event.target.closest('[data-noise-index]')?.dataset.noiseIndex ?? this.selected));
      const target = { ArrowUp: current - 1, ArrowDown: current + 1, Home: 0, End: this.indices.length - 1 }[event.key];
      if (target === undefined || !this.indices.length) return;
      event.preventDefault(); event.stopPropagation();
      const index = Math.max(0, Math.min(this.indices.length - 1, target));
      this.reveal(this.indices[index]); this.rows.get(index)?.focus({ preventScroll: true });
    });
    this.resize = new ResizeObserver(() => this.schedule()); this.resize.observe(this.element);
  }
  schedule() {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => { this.pending = null; this.draw(); });
  }
  update(areas, selected, indices = areas.map((area,index)=>index)) {
    this.areas = areas; this.selected = selected; this.indices = indices;
    const height = indices.length * ROW_HEIGHT;
    if (this.content.style.height !== height + 'px') this.content.style.height = height + 'px';
    this.draw();
  }
  reset() { this.element.scrollTop = 0; this.update([], -1); }
  reveal(index) {
    const position = this.indices.indexOf(index); if (position < 0) return;
    const top = position * ROW_HEIGHT; const bottom = top + ROW_HEIGHT;
    if (top < this.element.scrollTop) this.element.scrollTop = top;
    else if (bottom > this.element.scrollTop + this.element.clientHeight) this.element.scrollTop = bottom - this.element.clientHeight;
    this.draw();
  }
  draw() {
    const height = this.element.clientHeight || 400;
    const scrollTop = Math.max(0, Math.min(this.element.scrollTop, this.indices.length * ROW_HEIGHT - height));
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(this.indices.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
    for (const [index, row] of this.rows) if (index < first || index >= end) { row.remove(); this.rows.delete(index); }
    for (let index = first; index < end; index++) {
      const globalIndex = this.indices[index]; const area = this.areas[globalIndex]; let row = this.rows.get(index);
      if (!row) {
        row = document.createElement('button'); row.type = 'button'; row.dataset.noiseIndex = index;
        row.setAttribute('role', 'option'); row.setAttribute('aria-posinset', index + 1);
        row.style.top = index * ROW_HEIGHT + 'px'; row.style.height = ROW_HEIGHT - 4 + 'px';
        row.onclick = () => this.select(Number(row.dataset.noiseIndex)); this.rows.set(index, row); this.content.append(row);
      }
      row.dataset.noiseIndex = globalIndex;
      const text = globalIndex + ' · ' + (area.Name || t('noise-list.s91c83b5')) + (area.isInvert ? t('noise-list.sbc16842') : '');
      if (row.textContent !== text) row.textContent = text;
      row.title = formatBeat(area.appearTime) + ' → ' + formatBeat(area.disappearTime);
      row.classList.toggle('active', globalIndex === this.selected); row.setAttribute('aria-selected', String(globalIndex === this.selected)); row.setAttribute('aria-setsize', this.indices.length);
    }
  }
}
