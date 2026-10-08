import { prepareCanvas } from './timeline.ts';
import type { Timeline } from './timeline.ts';

// `timeline` is the shared Timeline instance (see app.ts, which passes the same
// object to Timeline, EventInteraction and SelectionOverlay). Importing the
// class gives us a precise structural type without changing any runtime shape.
export class SelectionOverlay {
  timeline: Timeline;
  canvas: HTMLCanvasElement;

  constructor(stage: HTMLElement, timeline: Timeline) {
    this.timeline = timeline;
    this.canvas = document.createElement('canvas'); this.canvas.className = 'selection-overlay'; this.canvas.setAttribute('aria-hidden', 'true'); stage.append(this.canvas);
    timeline.marqueeOverlay = true;
    window.addEventListener('pointermove', (event: PointerEvent) => timeline.updateRectangle(event), true);
    stage.addEventListener('pointerdown', (event: PointerEvent) => {
      // `event.target` is typed `EventTarget | null`, which has no `closest`. A
      // pointerdown target is an Element in practice (other files in this repo use
      // the same `instanceof Element` narrowing), but it can also be the document,
      // which the guard below skips rather than assumes away.
      const target = event.target;
      if (target instanceof Element && target.closest('.line-switcher')) return;
      if (timeline.finishRectangle(event)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }

  draw(): void {
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
