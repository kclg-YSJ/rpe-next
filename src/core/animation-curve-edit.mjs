import { assertAnimationCurve, curveSegment, insertCurveNode } from './animation-curve.mjs';
import { eventEasing } from './event-easing.mjs';

export function materializeCurve(curve) {
  const next = structuredClone(curve);
  for (let i = 0; i < curve.nodes.length - 1; i++) {
    const s = curveSegment(curve, i);
    next.nodes[i].out = [s.xs[1], s.ys[1]]; next.nodes[i + 1].in = [s.xs[2], s.ys[2]];
  }
  next.nodes.forEach(n => { if (n.mode === 'auto') n.mode = 'smooth'; });
  return next;
}
export function curveFromEvent(event) {
  if (event?.customEasing) return structuredClone(event.customEasing.curve);
  if (event?.bezier && Array.isArray(event.bezierPoints)) return { version: 1, name: '', nodes: [{ x: 0, y: 0, mode: 'corner', out: event.bezierPoints.slice(0, 2) }, { x: 1, y: 1, mode: 'corner', in: event.bezierPoints.slice(2) }] };
  const count = (event?.easingType ?? 1) === 1 ? 1 : 64;
  return { version: 1, name: '', nodes: Array.from({ length: count + 1 }, (_, i) => ({ x: i / count, y: i === 0 ? 0 : i === count ? 1 : eventEasing(event, i / count), mode: 'linear' })) };
}
export function addCurvePoint(curve, x) { return insertCurveNode(materializeCurve(curve), x); }
export function moveCurveNodes(curve, indices, dx, dy) {
  const next = structuredClone(curve), selected = new Set(indices.filter(i => i > 0 && i < curve.nodes.length - 1));
  if (!selected.size) return next;
  let lo = -Infinity, hi = Infinity;
  for (const i of selected) {
    if (!selected.has(i - 1)) lo = Math.max(lo, curve.nodes[i - 1].x + 1e-6 - curve.nodes[i].x);
    if (!selected.has(i + 1)) hi = Math.min(hi, curve.nodes[i + 1].x - 1e-6 - curve.nodes[i].x);
  }
  dx = Math.max(lo, Math.min(hi, dx));
  for (const i of selected) { const n = next.nodes[i]; n.x += dx; n.y = Math.max(-9999, Math.min(9999, n.y + dy)); for (const k of ['in', 'out']) if (n[k]) { n[k][0] += dx; n[k][1] += dy; } }
  clampHandles(next); return next;
}
function clampHandle(nodes, i, side) {
  const n = nodes[i], handle = n[side];
  if (!handle) return;
  const low = side === 'in' ? nodes[i - 1]?.x ?? n.x : n.x;
  const high = side === 'in' ? n.x : nodes[i + 1]?.x ?? n.x;
  const x = Math.max(low, Math.min(high, handle[0])), dx = handle[0] - n.x;
  // At the node's own time boundary keep the vertical tangent. Scaling the
  // whole ray to this boundary would erase both handles in aligned mode.
  // At the neighboring boundary shorten the ray to retain its direction.
  if (x !== handle[0] && x !== n.x && Math.abs(dx) > 1e-14) handle[1] = n.y + (handle[1] - n.y) * (x - n.x) / dx;
  handle[0] = x;
}
export function clampHandles(curve) {
  curve.nodes.forEach((n, i) => { for (const side of ['in', 'out']) clampHandle(curve.nodes, i, side); });
  return curve;
}
export function moveCurveHandle(curve, i, side, point, broken = false) {
  const material = materializeCurve(curve), next = structuredClone(curve), n = next.nodes[i];
  n.in ??= material.nodes[i].in; n.out ??= material.nodes[i].out;
  n[side] = [...point]; n.mode = broken ? 'corner' : n.mode === 'auto' || n.mode === 'linear' || n.mode === 'hold' ? 'smooth' : n.mode;
  if (side === 'in' && i > 0 && ['linear', 'hold'].includes(next.nodes[i - 1].mode)) { next.nodes[i - 1].mode = 'corner'; next.nodes[i - 1].out = material.nodes[i - 1].out; }
  clampHandle(next.nodes, i, side);
  const other = side === 'in' ? 'out' : 'in';
  if (n.mode === 'smooth' && n[other]) { const len = Math.hypot(n[other][0] - n.x, n[other][1] - n.y), dx = n.x - n[side][0], dy = n.y - n[side][1], d = Math.hypot(dx, dy); if (d > 1e-9) n[other] = [n.x + dx * len / d, n.y + dy * len / d]; }
  return clampHandles(next);
}
export function setCurveMode(curve, indices, mode) {
  const next = structuredClone(curve), material = materializeCurve(curve);
  for (const i of indices) { next.nodes[i].in ??= material.nodes[i].in; next.nodes[i].out ??= material.nodes[i].out; }
  for (const i of indices) { next.nodes[i].mode = mode; const n = next.nodes[i]; if (mode === 'smooth' && n.in && n.out) { const angle = Math.atan2(n.out[1] - n.in[1], n.out[0] - n.in[0]); for (const [key, sign] of [['in', -1], ['out', 1]]) { const length = Math.hypot(n[key][0] - n.x, n[key][1] - n.y); n[key] = [n.x + sign * Math.cos(angle) * length, n.y + sign * Math.sin(angle) * length]; } clampHandles(next); } if (mode === 'auto') { delete next.nodes[i].in; delete next.nodes[i].out; } }
  assertAnimationCurve(next); return next;
}
export function deleteCurveNodes(curve, indices) {
  const next = materializeCurve(curve), selected = new Set(indices); next.nodes = next.nodes.filter((n, i) => i === 0 || i === next.nodes.length - 1 || !selected.has(i)); clampHandles(next); assertAnimationCurve(next); return next;
}
