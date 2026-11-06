import { KeyDisplayState, keyDisplayLabel } from '../core/key-display.mjs';
import { t } from '../i18n.mjs';

export class KeyDisplay {
  constructor() {
    this.state = new KeyDisplayState(); this.items = new Map(); this.raf = 0; this.renderTime = null; this.lastWheel = -Infinity; this.modifier = null;
    this.host = document.createElement('div'); this.host.id = 'key-display-overlay'; this.host.setAttribute('aria-hidden', 'true'); this.host.setAttribute('popover', 'manual');
    document.body.append(this.host);
    this.host.showPopover?.();
    this.blur = () => { this.modifier = null; this.clear(); };
    window.addEventListener('blur', this.blur);
  }
  now() { return this.renderTime ?? performance.now() / 1000; }
  input(event) {
    if (event.target?.closest?.('input[type="password"], [data-recording-private]')) return;
    if (event.type === 'keydown') {
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) { this.modifier = event; return; }
      this.modifier = null;
      const label = keyDisplayLabel(event); if (label) this.add(label);
    } else if (event.type === 'keyup') {
      if (this.modifier?.key === event.key) { const label = keyDisplayLabel(this.modifier); if (label) this.add(label); this.modifier = null; }
    } else if (event.type === 'pointerdown') {
      this.modifier = null;
      const label = [t('editor-recording.leftMouse'), t('editor-recording.middleMouse'), t('editor-recording.rightMouse')][event.button];
      if (label) this.add(label);
    } else if (event.type === 'wheel' && this.now() - this.lastWheel >= .1) {
      this.lastWheel = this.now();
      if (event.deltaY) this.add(`${t('editor-recording.wheel')} ${event.deltaY < 0 ? '↑' : '↓'}`);
    }
  }
  add(label) {
    // A newly opened modal enters the top layer above the existing popover.
    // Promote the non-focusable overlay without moving focus out of its input.
    if (document.querySelector('dialog[open]') && this.host.matches(':popover-open')) { this.host.hidePopover(); this.host.showPopover(); }
    this.state.add(label, this.now()); this.draw(this.now()); this.schedule();
  }
  schedule() {
    if (this.raf || this.renderTime !== null || !this.state.keys.length) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(this.now()); this.schedule(); });
  }
  draw(seconds) {
    if (this.renderTime !== null) this.renderTime = seconds;
    const rows = this.state.rows(seconds), ids = new Set(rows.map(row => row.id));
    for (const [id, item] of this.items) if (!ids.has(id)) { item.remove(); this.items.delete(id); }
    for (const row of rows) {
      let item = this.items.get(row.id);
      if (!item) {
        item = document.createElement('div'); item.className = 'key-display-row';
        row.label.split(' + ').forEach((key, index) => {
          if (index) { const plus = document.createElement('span'); plus.className = 'key-display-plus'; plus.textContent = '+'; item.append(plus); }
          const cap = document.createElement('kbd'); cap.textContent = key; item.append(cap);
        });
        const count = document.createElement('small'); count.className = 'key-display-count'; item.append(count);
        this.host.append(item); this.items.set(row.id, item);
      }
      const count = item.lastElementChild; count.hidden = row.count === 1; count.textContent = `×${row.count}`;
      item.style.transform = `translateY(${-row.rise}px)`; item.style.opacity = String(row.alpha);
    }
  }
  beginRender(timestamp) {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    const seconds = timestamp / 1000;
    if (this.renderTime === null) { const delta = seconds - performance.now() / 1000; this.state.shift(delta); this.lastWheel += delta; }
    this.renderTime = seconds;
  }
  endRender() {
    if (this.renderTime === null) return;
    const delta = performance.now() / 1000 - this.renderTime; this.state.shift(delta); this.lastWheel += delta; this.renderTime = null; this.schedule();
  }
  clear() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; this.state.keys = []; this.items.clear(); this.host.replaceChildren(); }
  dispose() { this.clear(); window.removeEventListener('blur', this.blur); this.host.hidePopover?.(); this.host.remove(); }
}
