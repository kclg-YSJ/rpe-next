import { prepareCanvas } from './timeline.mjs';

export class SelectionOverlay {
  constructor(stage, timeline) {
    this.timeline = timeline;
    this.canvas = document.createElement('canvas'); this.canvas.className = 'selection-overlay'; this.canvas.setAttribute('aria-hidden', 'true'); stage.append(this.canvas);
    timeline.marqueeOverlay = true;
    window.addEventListener('pointermove', event => timeline.updateRectangle(event), true);
    window.addEventListener('pointerup', event => timeline.endRectanglePan(event), true);
    window.addEventListener('pointercancel', event => { if (timeline.endRectanglePan(event)) event.stopImmediatePropagation(); }, true);
    window.addEventListener('blur', () => timeline.endRectanglePan());
    stage.addEventListener('pointerdown', event => {
      if (event.target?.closest?.('.line-switcher')) return;
      if (timeline.rectangleSelection() && [0, 1, 2].includes(event.button)) {
        if (!timeline.finishRectangle(event)) timeline.beginRectanglePan(event, event.target);
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
  }

  draw() {
    const { context } = prepareCanvas(this.canvas);
    const selection = this.timeline.rectangleSelection(); if (!selection) return;
    const origin = selection.canvas.getBoundingClientRect(); const overlay = this.canvas.getBoundingClientRect();
    const start = this.timeline.rectangleStart(selection.drag); const { current } = selection.drag;
    context.fillStyle = selection.area === 'notes' ? '#81bfff22' : '#ffcc4430';
    context.strokeStyle = selection.area === 'notes' ? '#81bfff' : '#ffdd77';
    context.fillRect(origin.left - overlay.left + start.x, origin.top - overlay.top + start.y, current.x - start.x, current.y - start.y);
    context.strokeRect(origin.left - overlay.left + start.x, origin.top - overlay.top + start.y, current.x - start.x, current.y - start.y);
  }
}
