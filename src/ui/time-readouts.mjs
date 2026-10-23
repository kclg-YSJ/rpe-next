import { t } from '../i18n.mjs';
const decimal = value => (Math.abs(value) < 0.005 ? 0 : value).toFixed(2);

export class TimeReadouts {
  constructor(root, invalidate) {
    this.root = root;
    this.values = ['time', 'beat'].map(kind => root.querySelector(`[data-time-value="${kind}"]`));
    this.context = document.createElement('canvas').getContext('2d');
    this.scale = 1;
    const refresh = () => { this.metrics = null; invalidate(); };
    this.resize = new ResizeObserver(refresh);
    for (const value of this.values) this.resize.observe(value.parentElement);
    document.addEventListener('rpen-editor-skin-changed', refresh);
    document.fonts?.addEventListener('loadingdone', refresh);
  }

  update(seconds, duration, beat) {
    const texts = [`${decimal(seconds)}s/${decimal(duration)}s`, t('time-readouts.s8342148', { p0: decimal(beat) })];
    let changed = false;
    for (const [index, value] of this.values.entries()) if (value.textContent !== texts[index]) { value.textContent = texts[index]; changed = true; }
    if (this.metrics && !changed) return;
    if (!this.metrics) {
      this.metrics = this.values.map(value => {
        const style = getComputedStyle(value);
        const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        this.context.font = font;
        const digitWidth = Math.max(...Array.from('0123456789', digit => this.context.measureText(digit).width));
        return { width: value.parentElement.clientWidth - 1, font, digitWidth, spacing: parseFloat(style.letterSpacing) || 0, widths: new Map() };
      });
      if (this.metrics.some(metric => metric.width <= 0)) { this.metrics = null; return; }
    }
    let scale = 1;
    for (const [index, metric] of this.metrics.entries()) {
      this.context.font = metric.font;
      let width = 0;
      for (const character of texts[index]) {
        if (!metric.widths.has(character)) metric.widths.set(character, /\d/.test(character) ? metric.digitWidth : this.context.measureText(character).width);
        width += metric.widths.get(character) + metric.spacing;
      }
      scale = Math.min(scale, metric.width / Math.max(1, width));
    }
    scale = Math.floor(scale * 1000) / 1000;
    if (scale !== this.scale) { this.scale = scale; this.root.style.setProperty('--time-readout-scale', String(scale)); }
  }
}
