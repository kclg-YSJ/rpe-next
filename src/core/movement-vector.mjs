import { evaluateNumericExpression } from './numeric-expression.mjs';
import { t } from '../i18n.mjs';

const clean = value => Math.abs(value) < 1e-10 ? 0 : value;
const finite = values => {
  if (!values.every(Number.isFinite)) throw Error(t('movement-vector.invalid'));
};

// This inspector uses counterclockwise angles from the right (90° points up).
// The sign and unwrapped angle are editor state, never chart metadata.
export function movementVector(start, end, previous = {}) {
  finite([...start, ...end]);
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const sign = previous.sign === -1 ? -1 : 1, distance = Math.hypot(dx, dy);
  let angle = previous.angle ?? 0;
  if (distance > 1e-10) {
    angle = Math.atan2(dy * sign, dx * sign) * 180 / Math.PI;
    if (Number.isFinite(previous.angle)) angle += Math.round((previous.angle - angle) / 360) * 360;
  }
  return { start: [...start], end: [...end], angle: clean(angle), length: distance * sign, sign };
}

export function changeMovementVector(vector, field, value, fixed = 'start') {
  let { start, end, angle, length, sign } = vector;
  start = [...start]; end = [...end];
  if (field === 'start' || field === 'end') {
    if (!Array.isArray(value) || value.length !== 2) throw Error(t('movement-vector.coordinates'));
    finite(value);
    const anchor = field === 'start' ? start : end;
    const delta = value.map((number, axis) => number - anchor[axis]);
    start = start.map((number, axis) => clean(number + delta[axis]));
    end = end.map((number, axis) => clean(number + delta[axis]));
  } else {
    finite([value]);
    if (field === 'angle') angle = value;
    else if (field === 'length') { length = value; if (value) sign = value < 0 ? -1 : 1; }
    else throw Error(t('movement-vector.invalid'));
    const radians = (angle % 360) * Math.PI / 180;
    const delta = [clean(length * Math.cos(radians)), clean(length * Math.sin(radians))];
    if (fixed === 'end') start = end.map((number, axis) => clean(number - delta[axis]));
    else end = start.map((number, axis) => clean(number + delta[axis]));
  }
  finite([...start, ...end, angle, length]);
  return { start, end, angle, length, sign };
}

export function parseMovementPosition(source) {
  const text = String(source).trim();
  if (text.length > 1024) throw Error(t('movement-vector.coordinates'));
  for (const match of text.matchAll(/\s+/g)) {
    try {
      const values = [text.slice(0, match.index), text.slice(match.index + match[0].length)].map(evaluateNumericExpression);
      if (values.every(Number.isFinite)) return values;
    } catch { /* Incomplete expressions do not reach the chart. */ }
  }
  throw Error(t('movement-vector.coordinates'));
}
