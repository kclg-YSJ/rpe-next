import { t } from '../i18n.mjs';
// Normalized, time-monotone piecewise cubic curves. Handles use absolute coordinates.
export const CURVE_MODES = ['auto', 'smooth', 'corner', 'linear', 'hold'];
export const linearCurve = () => ({ version: 1, name: '', nodes: [{ x: 0, y: 0, mode: 'linear' }, { x: 1, y: 1, mode: 'linear' }] });
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const cubic = (p, t) => { const u = 1 - t; return u ** 3 * p[0] + 3 * u * u * t * p[1] + 3 * u * t * t * p[2] + t ** 3 * p[3]; };
const parameter = (xs, x) => { let a = 0, b = 1; for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (cubic(xs, m) < x) a = m; else b = m; } return (a + b) / 2; };
export function assertAnimationCurve(curve) {
  if (curve?.version !== 1 || !Array.isArray(curve.nodes) || curve.nodes.length < 2 || curve.nodes.length > 256 || curve.nodes.some(n => !n || typeof n !== 'object' || Array.isArray(n))) throw Error(t('animation-curve.definition'));
  if (curve.name != null && (typeof curve.name !== 'string' || curve.name.length > 160)) throw Error(t('animation-curve.invalidName'));
  const nodes = curve.nodes;
  if (nodes[0].x !== 0 || nodes[0].y !== 0 || nodes.at(-1).x !== 1 || nodes.at(-1).y !== 1) throw Error(t('animation-curve.endpoints'));
  nodes.forEach((n, i) => {
    if (![n.x, n.y].every(Number.isFinite) || Math.abs(n.y) > 10000 || (i && n.x <= nodes[i - 1].x) || !CURVE_MODES.includes(n.mode ?? 'corner')) throw Error(t('animation-curve.invalidNode'));
    for (const key of ['in', 'out']) if (n[key] != null && (!Array.isArray(n[key]) || n[key].length !== 2 || !n[key].every(Number.isFinite) || Math.abs(n[key][1]) > 10000 || n[key][0] < (key === 'in' ? nodes[i - 1]?.x ?? n.x : n.x) || n[key][0] > (key === 'in' ? n.x : nodes[i + 1]?.x ?? n.x))) throw Error(t('animation-curve.invalidHandle'));
  });
  return curve;
}
export function curveSegment(curve, index) {
  const ns = curve.nodes, a = ns[index], b = ns[index + 1], dx = b.x - a.x;
  const handle = (n, i, side) => {
    if ((n.mode ?? 'corner') !== 'auto' && n[side]) return n[side];
    const before = ns[Math.max(0, i - 1)], after = ns[Math.min(ns.length - 1, i + 1)];
    const slope = (after.y - before.y) / (after.x - before.x);
    const delta = side === 'out' ? dx / 3 : -dx / 3;
    return [n.x + delta, n.y + delta * slope];
  };
  if (a.mode === 'hold') return { xs: [a.x, a.x, b.x, b.x], ys: [a.y, a.y, a.y, a.y], hold: true };
  if (a.mode === 'linear') return { xs: [a.x, a.x + dx / 3, b.x - dx / 3, b.x], ys: [a.y, a.y + (b.y - a.y) / 3, b.y - (b.y - a.y) / 3, b.y] };
  const h1 = handle(a, index, 'out'), h2 = handle(b, index + 1, 'in');
  return { xs: [a.x, h1[0], h2[0], b.x], ys: [a.y, h1[1], h2[1], b.y] };
}
const compiled = new WeakMap();
const shared = new Map();
export function compileAnimationCurve(curve) {
  let result = compiled.get(curve); if (result) return result;
  assertAnimationCurve(curve);
  const key = JSON.stringify(curve.nodes);
  result = shared.get(key); if (result) { compiled.set(curve, result); return result; }
  const segments = curve.nodes.slice(1).map((_, i) => curveSegment(curve, i));
  const indexAt = x => { let low = 0, high = segments.length - 1; while (low < high) { const mid = (low + high) >> 1; if (x >= segments[mid].xs[3]) low = mid + 1; else high = mid; } return low; };
  // Integral y(t) * x'(t) is a fifth-degree polynomial and is integrated exactly.
  const polynomial = p => [p[0], 3 * (p[1] - p[0]), 3 * (p[0] - 2 * p[1] + p[2]), -p[0] + 3 * p[1] - 3 * p[2] + p[3]];
  const primitive = (s, t) => {
    const xp = polynomial(s.xs), yp = polynomial(s.ys); let sum = 0;
    for (let i = 0; i < 4; i++) for (let j = 1; j < 4; j++) sum += yp[i] * j * xp[j] * t ** (i + j) / (i + j);
    return sum;
  };
  result = {
    value(x) { x = clamp(x, 0, 1); if (x === 0) return 0; if (x === 1) return 1; const s = segments[indexAt(x)]; if (x === s.xs[0]) return s.ys[0]; return cubic(s.ys, parameter(s.xs, x)); },
    integral(a, b) { if (b < a) return -this.integral(b, a); a = clamp(a, 0, 1); b = clamp(b, 0, 1); let total = 0;
      for (let i = indexAt(a); i < segments.length && segments[i].xs[0] < b; i++) { const s = segments[i], l = Math.max(a, s.xs[0]), r = Math.min(b, s.xs[3]); if (r > l) total += primitive(s, r === s.xs[3] ? 1 : parameter(s.xs, r)) - primitive(s, l === s.xs[0] ? 0 : parameter(s.xs, l)); }
      return total;
    },
    chordError(a, b) {
      const s = segments[indexAt((a + b) / 2)];
      if (s.hold) return { error: 0, hold: true };
      const partition = (ps, t) => { const a = mix(ps[0], ps[1], t), b = mix(ps[1], ps[2], t), c = mix(ps[2], ps[3], t), d = mix(a, b, t), e = mix(b, c, t), f = mix(d, e, t); return [[ps[0], a, d, f], [f, e, c, ps[3]]]; };
      const ta = a <= s.xs[0] ? 0 : parameter(s.xs, a), tb = b >= s.xs[3] ? 1 : parameter(s.xs, b);
      let ps = s.xs.map((x, i) => [x, s.ys[i]]);
      if (tb < 1) ps = partition(ps, tb)[0];
      if (ta > 0) ps = partition(ps, ta / tb)[1];
      const first = ps[0], last = ps[3], slope = (last[1] - first[1]) / Math.max(1e-15, last[0] - first[0]);
      // A Bezier lies inside its control hull, so this bounds the entire
      // interval, including narrow extrema that fixed sample grids can miss.
      return { error: Math.max(...ps.map(p => Math.abs(p[1] - first[1] - slope * (p[0] - first[0])))), hold: false };
    },
    range(a = 0, b = 1) {
      let min = Math.min(this.value(a), this.value(b)), max = Math.max(this.value(a), this.value(b));
      for (let i = indexAt(a); i < segments.length && segments[i].xs[0] < b; i++) {
        const s = segments[i], l = a <= s.xs[0] ? 0 : parameter(s.xs, a), r = b >= s.xs[3] ? 1 : parameter(s.xs, b), p = polynomial(s.ys);
        const points = [l, r], qa = 3 * p[3], qb = 2 * p[2], qc = p[1], d = qb * qb - 4 * qa * qc;
        if (Math.abs(qa) < 1e-14) { if (Math.abs(qb) > 1e-14) points.push(-qc / qb); }
        else if (d >= 0) points.push((-qb - Math.sqrt(d)) / (2 * qa), (-qb + Math.sqrt(d)) / (2 * qa));
        for (const t of points) if (t >= l && t <= r) { const y = cubic(s.ys, t); min = Math.min(min, y); max = Math.max(max, y); }
      }
      return { min, max };
    },
  };
  compiled.set(curve, result);
  if (shared.size >= 128) shared.delete(shared.keys().next().value);
  shared.set(key, result); return result;
}
export const animationCurveValue = (curve, x) => compileAnimationCurve(curve).value(x);
export function insertCurveNode(curve, x) {
  assertAnimationCurve(curve); if (!(x > 0 && x < 1) || curve.nodes.some(n => Math.abs(n.x - x) < 1e-6)) throw Error(t('animation-curve.duplicateNode'));
  const next = structuredClone(curve), i = curve.nodes.findIndex((n, i) => i < curve.nodes.length - 1 && n.x < x && curve.nodes[i + 1].x > x);
  const s = curveSegment(curve, i), t = parameter(s.xs, x), ps = s.xs.map((v, j) => [v, s.ys[j]]);
  const a = mix(ps[0], ps[1], t), b = mix(ps[1], ps[2], t), c = mix(ps[2], ps[3], t), d = mix(a, b, t), e = mix(b, c, t), f = mix(d, e, t);
  if (!s.hold) { next.nodes[i].mode = 'corner'; next.nodes[i].out = a; next.nodes[i + 1].in = c; if (next.nodes[i + 1].mode === 'auto') next.nodes[i + 1].mode = 'corner'; }
  next.nodes.splice(i + 1, 0, { x, y: f[1], mode: s.hold ? 'hold' : 'corner', in: d, out: e });
  return next;
}
