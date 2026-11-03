import { animationCurveValue, curveSegment } from '../core/animation-curve.mjs';
import { t } from '../i18n.mjs';

// Code-native diagrams share the exact editable example definitions.
export function curveHelpDiagram(curve, title, { handles = true } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 360 202'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', title); svg.classList.add('curve-help-diagram');
  const add = (tag, attributes, text) => { const e = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attributes)) e.setAttribute(key, value); if (text) e.textContent = text; svg.append(e); return e; };
  const values = curve.nodes.flatMap(n => [n.y, n.in?.[1], n.out?.[1]]).filter(Number.isFinite), min = Math.min(-.1, ...values) - .08, max = Math.max(1.1, ...values) + .08;
  const point = (x, y) => [35 + x * 298, 171 - (y - min) / (max - min) * 150];
  add('title', {}, title);
  for (const x of [0, .5, 1]) { const px = point(x, 0)[0]; add('line', { x1: px, y1: 16, x2: px, y2: 172, class: 'curve-diagram-grid' }); add('text', { x: px, y: 190, 'text-anchor': 'middle' }, `${x * 100}%`); }
  for (const y of [0, 1]) { const py = point(0, y)[1]; add('line', { x1: 34, y1: py, x2: 334, y2: py, class: 'curve-diagram-grid' }); add('text', { x: 29, y: py + 4, 'text-anchor': 'end' }, `${y * 100}%`); }
  add('path', { d: `M${point(0, 0)} L${point(1, 1)}`, class: 'curve-diagram-baseline' });
  if (handles) for (let i = 0; i < curve.nodes.length - 1; i++) {
    if (['linear', 'hold'].includes(curve.nodes[i].mode)) continue;
    const s = curveSegment(curve, i);
    for (const [from, to] of [[0, 1], [3, 2]]) { const p = point(s.xs[from], s.ys[from]), h = point(s.xs[to], s.ys[to]); add('line', { x1: p[0], y1: p[1], x2: h[0], y2: h[1], class: 'curve-diagram-handle' }); add('rect', { x: h[0] - 3, y: h[1] - 3, width: 6, height: 6, class: 'curve-diagram-handle-point' }); }
  }
  const samples = new Set(Array.from({ length: 241 }, (_, i) => i / 240));
  for (const n of curve.nodes.slice(1)) { samples.add(Math.max(0, n.x - 1e-8)); samples.add(n.x); }
  const path = [...samples].sort((a, b) => a - b).map((x, i) => `${i ? 'L' : 'M'}${point(x, animationCurveValue(curve, x)).join(',')}`).join(' ');
  add('path', { d: path, class: 'curve-diagram-path' });
  curve.nodes.forEach((n, i) => { const p = point(n.x, n.y); add('circle', { cx: p[0], cy: p[1], r: 4, class: 'curve-diagram-node' }); if (i > 0 && i < curve.nodes.length - 1) add('text', { x: Math.max(65, Math.min(290, p[0])), y: Math.max(14, p[1] - 10), 'text-anchor': 'middle' }, `${Math.round(n.x * 100)}%, ${Math.round(n.y * 100)}%`); });
  svg.dataset.caption = t('animation-curve.diagramLegend'); return svg;
}
