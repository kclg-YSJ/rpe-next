import { validSelectionInterval } from '../core/selection-interval.mjs';
import { t } from '../i18n.mjs';

export class SelectionIntervalPanel {
  constructor(setting, read, write) {
    this.read = read; this.write = write;
    this.panel = document.createElement('div'); this.panel.className = 'selection-interval-panel'; this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog'); this.panel.setAttribute('aria-label', t('selection-interval.sf56c113'));
    const heading = document.createElement('div'); heading.className = 'selection-interval-heading';
    const title = document.createElement('strong'); title.textContent = t('selection-interval.sf56c113');
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', t('selection-interval.s60c5d87')); close.onclick = () => this.hide();
    heading.append(title, close);
    const label = document.createElement('label'); label.className = 'field'; label.append(t('selection-interval.sa06e12b'));
    const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = String(Number.MAX_SAFE_INTEGER); input.step = '1'; input.setAttribute('aria-label', t('selection-interval.sa06e12b'));
    input.dataset.rpenField = 'selection-interval'; label.append(input);
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = t('selection-interval.sc4af97f');
    this.panel.append(heading, label, hint); document.body.append(this.panel);
    this.inputs = [setting, input];
    for (const control of this.inputs) {
      const update = () => {
        const value = Number(control.value); const valid = control.value.trim() !== '' && validSelectionInterval(value);
        control.setCustomValidity(valid ? '' : t('selection-interval.sb3ef4f9'));
        if (!valid) return;
        if (value !== this.read()) this.write(value);
        this.sync(control);
      };
      control.addEventListener('input', update); control.addEventListener('change', update);
    }
    window.addEventListener('pointerdown', event => { if (!this.panel.hidden && !this.panel.contains(event.target)) this.hide(); }, true);
    window.addEventListener('keydown', event => {
      if (!this.panel.hidden && event.key === 'Escape') { this.hide(); event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    window.addEventListener('resize', () => this.hide());
    this.sync();
  }
  sync(source) {
    for (const input of this.inputs) if (input !== source) { input.value = String(this.read()); input.setCustomValidity(''); }
  }
  open(horizontal, vertical) {
    this.sync(); this.panel.hidden = false;
    const bounds = this.panel.getBoundingClientRect();
    this.panel.style.left = `${Math.max(4, Math.min(innerWidth - bounds.width - 4, horizontal))}px`;
    this.panel.style.top = `${Math.max(4, Math.min(innerHeight - bounds.height - 4, vertical))}px`;
    this.inputs[1].focus({ preventScroll: true }); this.inputs[1].select();
  }
  hide() { this.panel.hidden = true; }
}
