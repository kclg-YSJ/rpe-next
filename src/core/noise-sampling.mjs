import { noiseRuntime } from './noise-areas.mjs';
import { previewViewport } from './editor-display.mjs';

const sampleNumber = value => Math.round(value * 10000) / 10000;

export function fitNoiseSampleView(point, width, height, aspectRatio, divisor, controlsBottom = 64) {
  if (!(width > 0 && height > 0)) return divisor;
  const viewport = previewViewport(width, height, aspectRatio);
  const horizontal = Math.max(1, viewport.width / 2 - 24);
  const vertical = Math.max(1, point.y >= 0 ? height / 2 - Math.max(viewport.top + 24, controlsBottom + 20) : Math.min(viewport.height / 2 - 24, height / 2 - 60));
  return Math.max(divisor, Math.abs(point.x) * viewport.scale / horizontal, Math.abs(point.y) * viewport.scale / vertical);
}

export function sampleEditingArea(area, tempo, seconds, target) {
  const event = target.type ? area[target.type]?.[target.index] : null;
  const overrides = event && ['start', 'end'].includes(target.field) ? { [target.type]: { value: event[target.field], event } } : {};
  return noiseRuntime(area, tempo).sample(seconds, overrides);
}

export function noiseSampleHandle(area, tempo, seconds, target) {
  if (target.field === 'anchor') return { ...area[target.type][target.index].anchor };
  const sample = sampleEditingArea(area, tempo, seconds, target);
  if (['bottomLeft', 'topRight'].includes(target.field)) return sample.transform(area[target.field]);
  if (target.reference) return sample.transform(target.reference);
  return sample.center;
}

export function samplingTarget(area, type, index, field) {
  const target = { type, index, field };
  if (['rotateEvents', 'scaleXEvents', 'scaleYEvents'].includes(type) && field !== 'anchor') {
    const anchor = area[type][index].anchor;
    const corners = [area.bottomLeft, area.topRight, { x: area.bottomLeft.x, y: area.topRight.y }, { x: area.topRight.x, y: area.bottomLeft.y }];
    const distance = point => type === 'scaleXEvents' ? Math.abs(point.x - anchor.x) : type === 'scaleYEvents' ? Math.abs(point.y - anchor.y) : Math.hypot(point.x - anchor.x, point.y - anchor.y);
    target.reference = { ...corners.sort((left, right) => distance(right) - distance(left))[0] };
  }
  return target;
}

function setValue(area, target, value) {
  const event = area[target.type][target.index]; event[target.field] = value;
  if (event.inst) event[target.field === 'start' ? 'end' : 'start'] = value;
}
export function applyNoiseSample(area, tempo, seconds, target, point) {
  const result = structuredClone(area);
  if (target.field === 'anchor') { result[target.type][target.index].anchor = { x: sampleNumber(point.x), y: sampleNumber(point.y) }; return result; }
  const original = noiseSampleHandle(area, tempo, seconds, target);
  const delta = { x: point.x - original.x, y: point.y - original.y };
  if (['bottomLeft', 'topRight'].includes(target.field)) {
    const sampleAxis = axis => { const changed = structuredClone(area); changed[target.field][axis] += 1; const handle = noiseSampleHandle(changed, tempo, seconds, target); return { x: handle.x - original.x, y: handle.y - original.y }; };
    const horizontal = sampleAxis('x'); const vertical = sampleAxis('y');
    const determinant = horizontal.x * vertical.y - horizontal.y * vertical.x;
    if (Math.abs(determinant) < 1e-8) throw new Error('当前缩放为零或变换退化，无法反算角点；请改用文本输入或其他时间点');
    result[target.field].x += (delta.x * vertical.y - delta.y * vertical.x) / determinant;
    result[target.field].y += (horizontal.x * delta.y - horizontal.y * delta.x) / determinant;
  } else if (target.type === 'rotateEvents') {
    let value = area[target.type][target.index][target.field];
    for (let iteration = 0; iteration < 8; iteration++) {
      setValue(result, target, value);
      const current = noiseSampleHandle(result, tempo, seconds, target);
      const probe = structuredClone(area); setValue(probe, target, value + 0.01);
      const derivative = noiseSampleHandle(probe, tempo, seconds, target);
      const dx = derivative.x - current.x; const dy = derivative.y - current.y;
      const length = dx * dx + dy * dy;
      if (length < 1e-10) throw new Error('当前变换无法反算旋转值；请改用文本输入或调整锚点');
      const errorX = point.x - current.x; const errorY = point.y - current.y;
      const delta = (errorX * dx + errorY * dy) / length;
      value += delta * 0.01;
      if (Math.hypot(errorX, errorY) < 1e-5) break;
    }
    setValue(result, target, value);
  } else {
    const changed = structuredClone(area); setValue(changed, target, area[target.type][target.index][target.field] + 1);
    const handle = noiseSampleHandle(changed, tempo, seconds, target); const axis = { x: handle.x - original.x, y: handle.y - original.y };
    const length = axis.x * axis.x + axis.y * axis.y;
    if (length < 1e-8) throw new Error('当前变换无法反算该缩放值；请改用文本输入或调整锚点');
    setValue(result, target, area[target.type][target.index][target.field] + (delta.x * axis.x + delta.y * axis.y) / length);
  }
  if (['bottomLeft', 'topRight'].includes(target.field)) for (const axis of ['x', 'y']) result[target.field][axis] = sampleNumber(result[target.field][axis]);
  else setValue(result, target, sampleNumber(result[target.type][target.index][target.field]));
  return result;
}
