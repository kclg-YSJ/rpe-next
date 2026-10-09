const clamp = value => Math.max(0, Math.min(1, value));
export const RPE_NOISE_SIZE = Object.freeze({ width: 1350, height: 900 });

export function noisePointToRpe(pointValue) {
  return { x: pointValue.x * RPE_NOISE_SIZE.width - RPE_NOISE_SIZE.width / 2, y: pointValue.y * RPE_NOISE_SIZE.height - RPE_NOISE_SIZE.height / 2 };
}

export function rpePointToNoise(pointValue) {
  return { x: (pointValue.x + RPE_NOISE_SIZE.width / 2) / RPE_NOISE_SIZE.width, y: (pointValue.y + RPE_NOISE_SIZE.height / 2) / RPE_NOISE_SIZE.height };
}
const point = (value, fallback) => ({
  x: Number.isFinite(value?.x) ? value.x : fallback.x,
  y: Number.isFinite(value?.y) ? value.y : fallback.y,
});

export const NOISE_EASING_NAMES = [
  '0 · 线性', '1 · 二次缓入', '2 · 二次缓出', '3 · 二次官方复合',
  '4 · 三次缓入', '5 · 三次缓出', '6 · 三次官方复合',
  '7 · 四次缓入', '8 · 四次缓出', '9 · 四次官方复合',
  '10 · 五次缓入', '11 · 五次缓出', '12 · 五次官方复合',
  '13 · 保持前值', '14 · 瞬变后值',
];

export function createNoiseArea(seconds = 0, duration = 2) {
  return {
    topRightPercentage: { x: 0.75, y: 0.75 },
    bottomLeftPercentage: { x: 0.25, y: 0.25 },
    appearTime: seconds,
    enableTime: seconds,
    disableTime: seconds + duration,
    disappearTime: seconds + duration,
    isSubtract: false,
    moveEvents: [], scaleEvents: [], rotateEvents: [],
  };
}

export function normalizeNoiseArea(source = {}) {
  const area = createNoiseArea();
  return {
    ...source,
    topRightPercentage: point(source.topRightPercentage, area.topRightPercentage),
    bottomLeftPercentage: point(source.bottomLeftPercentage, area.bottomLeftPercentage),
    appearTime: finite(source.appearTime, area.appearTime),
    enableTime: finite(source.enableTime, area.enableTime),
    disableTime: finite(source.disableTime, area.disableTime),
    disappearTime: finite(source.disappearTime, area.disappearTime),
    isSubtract: Boolean(source.isSubtract),
    moveEvents: normalizeEvents(source.moveEvents, event => ({ ...event,
      time: finite(event.time, 0), endPosition: point(event.endPosition, { x: 0.5, y: 0.5 }),
      easeTypeX: ease(event.easeTypeX), easeTypeY: ease(event.easeTypeY),
    })),
    scaleEvents: normalizeEvents(source.scaleEvents, event => ({ ...event,
      time: finite(event.time, 0), anchor: point(event.anchor, { x: 0.5, y: 0.5 }),
      scale: point(event.scale, { x: 1, y: 1 }), easeTypeX: ease(event.easeTypeX), easeTypeY: ease(event.easeTypeY),
    })),
    rotateEvents: normalizeEvents(source.rotateEvents, event => ({ ...event,
      time: finite(event.time, 0), anchor: point(event.anchor, { x: 0.5, y: 0.5 }),
      rotation: finite(event.rotation, 0), easeType: ease(event.easeType),
    })),
  };
}

function finite(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function ease(value) { return Math.max(0, Math.min(14, Math.trunc(finite(value, 0)))); }
function normalizeEvents(events, transform) {
  if (!Array.isArray(events)) return [];
  return events.map((event, index) => ({ event: transform(event ?? {}), index }))
    .sort((left, right) => left.event.time - right.event.time || left.index - right.index).map(entry => entry.event);
}

export function assertNoiseAreas(chart) {
  if (chart.blockAreaList == null) return;
  if (!Array.isArray(chart.blockAreaList)) throw new Error('blockAreaList 必须为数组');
  for (const [index, raw] of chart.blockAreaList.entries()) {
    const path = `blockAreaList[${index}]`;
    if (!raw || typeof raw !== 'object') throw new Error(`${path}: 无效噪域`);
    for (const key of ['topRightPercentage', 'bottomLeftPercentage']) assertPoint(raw[key], `${path}.${key}`);
    for (const key of ['appearTime', 'enableTime', 'disableTime', 'disappearTime']) if (!Number.isFinite(raw[key])) throw new Error(`${path}.${key} 必须为有限秒数`);
    if (raw.appearTime > raw.disappearTime) throw new Error(`${path}: 出现时间不能晚于消失时间`);
    if (raw.enableTime < raw.appearTime || raw.enableTime > raw.disappearTime) throw new Error(`${path}: 生效时间必须位于可见区间内`);
    if (raw.disableTime < raw.enableTime || raw.disableTime > raw.disappearTime) throw new Error(`${path}: 失效时间必须位于生效和消失时间之间`);
    validateEvents(raw.moveEvents, `${path}.moveEvents`, event => assertPoint(event.endPosition, 'endPosition'), ['easeTypeX', 'easeTypeY']);
    validateEvents(raw.scaleEvents, `${path}.scaleEvents`, event => { assertPoint(event.anchor, 'anchor'); assertPoint(event.scale, 'scale'); }, ['easeTypeX', 'easeTypeY']);
    validateEvents(raw.rotateEvents, `${path}.rotateEvents`, event => { assertPoint(event.anchor, 'anchor'); if (!Number.isFinite(event.rotation)) throw new Error('rotation 必须为有限数字'); }, ['easeType']);
  }
}

function assertPoint(value, path) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new Error(`${path}: 必须包含有限的 x、y`);
}
function validateEvents(events, path, extra, easingKeys) {
  if (events == null) return;
  if (!Array.isArray(events)) throw new Error(`${path} 必须为数组`);
  for (const [index, event] of events.entries()) {
    try {
      if (!event || !Number.isFinite(event.time)) throw new Error('time 必须为有限秒数');
      extra(event);
      for (const key of easingKeys) if (!Number.isInteger(event[key]) || event[key] < 0 || event[key] > 14) throw new Error(`${key} 必须是 0–14 的整数`);
    } catch (error) { throw new Error(`${path}[${index}].${error.message}`); }
  }
}

export function noisePhases(area, seconds) {
  const visible = area.appearTime <= seconds && seconds < area.disappearTime;
  const active = area.enableTime <= seconds && seconds < area.disableTime;
  const ready = visible && seconds < area.enableTime && area.enableTime - seconds <= 0.5;
  return {
    visible,
    active,
    ready,
    disabled: visible && !active && !ready,
    residual: visible && seconds >= area.disableTime,
    visualOnly: area.enableTime >= area.disableTime,
  };
}

export function phigrosNoiseEase(progress, type = 0) {
  progress = clamp(progress);
  if (type === 13) return 0;
  if (type === 14) return 1;
  if (!Number.isInteger(type) || type <= 0 || type > 14) return progress;
  const group = Math.floor((type - 1) / 3);
  const kind = (type - 1) % 3;
  const power = group + 2;
  const sample = index => {
    const t = index / 100;
    if (kind === 0) return t ** power;
    if (kind === 1) return 1 - (1 - t) ** power;
    if (index <= 46) return 0.5 * ((index * 2 + 8) / 100) ** power;
    // APK 的 47..49 来自构建期越界读，无法逐位复现；按端点 1 处理。
    if (index <= 49) return 0.5;
    if (index <= 57) return 0;
    if (index < 100) {
      const shifted = (8 + (index - 58) * 2) / 100;
      const inside = shifted ** power;
      return 0.5 + 0.5 * (1 - (1 - inside) ** power);
    }
    return 1;
  };
  const position = progress * 100;
  const index = Math.floor(position);
  return index >= 100 ? sample(100) : mix(sample(index), sample(index + 1), position - index);
}

function mix(from, to, progress) { return from + (to - from) * progress; }
function safeDivide(numerator, denominator) {
  const threshold = Math.max(Math.abs(denominator) * 1e-6, Number.MIN_VALUE * 8);
  return Math.abs(denominator) < threshold ? 1 : numerator / denominator;
}
function around(pointValue, anchor, x, y = x) { return { x: anchor.x + (pointValue.x - anchor.x) * x, y: anchor.y + (pointValue.y - anchor.y) * y }; }
function rotateAround(pointValue, anchor, degrees) {
  const radians = degrees * Math.PI / 180; const cosine = Math.cos(radians); const sine = Math.sin(radians);
  const x = pointValue.x - anchor.x; const y = pointValue.y - anchor.y;
  return { x: anchor.x + x * cosine - y * sine, y: anchor.y + x * sine + y * cosine };
}
function rotateAroundAspect(pointValue, anchor, degrees, aspect) {
  const rotated = rotateAround({ x: pointValue.x * aspect, y: pointValue.y }, { x: anchor.x * aspect, y: anchor.y }, degrees);
  return { x: rotated.x / aspect, y: rotated.y };
}
function currentIndex(events, seconds) {
  let result = -1;
  for (let index = 0; index < events.length && events[index].time <= seconds; index++) result = index;
  return result;
}
function progress(current, following, type, seconds) {
  const raw = following.time === current.time ? 1 : (seconds - current.time) / (following.time - current.time);
  return phigrosNoiseEase(raw, type);
}

/** Evaluate the official transform chain: scale, then rotation, then absolute movement. */
export function noiseRectAt(source, seconds, aspect = 16 / 9) {
  const area = normalizeNoiseArea(source);
  const base = {
    x: (area.topRightPercentage.x + area.bottomLeftPercentage.x) / 2,
    y: (area.topRightPercentage.y + area.bottomLeftPercentage.y) / 2,
  };
  let center = { ...base };
  let width = Math.abs(area.topRightPercentage.x - area.bottomLeftPercentage.x);
  let height = Math.abs(area.topRightPercentage.y - area.bottomLeftPercentage.y);
  let rotation = 0;

  const scaleIndex = currentIndex(area.scaleEvents, seconds);
  if (scaleIndex >= 0) {
    const current = area.scaleEvents[scaleIndex];
    for (let index = 1; index <= scaleIndex; index++) {
      const previous = area.scaleEvents[index - 1]; const next = area.scaleEvents[index];
      center = around(center, previous.anchor, safeDivide(next.scale.x, previous.scale.x), safeDivide(next.scale.y, previous.scale.y));
    }
    const following = area.scaleEvents[scaleIndex + 1];
    const evaluated = following ? {
      x: mix(current.scale.x, following.scale.x, progress(current, following, current.easeTypeX, seconds)),
      y: mix(current.scale.y, following.scale.y, progress(current, following, current.easeTypeY, seconds)),
    } : current.scale;
    center = around(center, current.anchor, safeDivide(evaluated.x, current.scale.x), safeDivide(evaluated.y, current.scale.y));
    width *= Math.abs(evaluated.x); height *= Math.abs(evaluated.y);
  }

  const rotateIndex = currentIndex(area.rotateEvents, seconds);
  if (rotateIndex >= 0) {
    const current = area.rotateEvents[rotateIndex];
    for (let index = 1; index <= rotateIndex; index++) {
      const previous = area.rotateEvents[index - 1]; const next = area.rotateEvents[index];
      center = rotateAroundAspect(center, previous.anchor, next.rotation - previous.rotation, aspect);
    }
    const following = area.rotateEvents[rotateIndex + 1];
    rotation = following ? mix(current.rotation, following.rotation, progress(current, following, current.easeType, seconds)) : current.rotation;
    center = rotateAroundAspect(center, current.anchor, rotation - current.rotation, aspect);
  }

  const moveIndex = currentIndex(area.moveEvents, seconds);
  if (moveIndex >= 0) {
    const current = area.moveEvents[moveIndex]; const following = area.moveEvents[moveIndex + 1];
    const target = following ? {
      x: mix(current.endPosition.x, following.endPosition.x, progress(current, following, current.easeTypeX, seconds)),
      y: mix(current.endPosition.y, following.endPosition.y, progress(current, following, current.easeTypeY, seconds)),
    } : current.endPosition;
    center = { x: center.x + target.x - base.x, y: center.y + target.y - base.y };
  }
  return { center, width, height, rotation };
}

/** Convert a desired rendered centre into the absolute target stored by moveEvents. */
export function noiseMoveTargetForCenter(source, seconds, desiredCenter, aspect = 16 / 9) {
  const area = normalizeNoiseArea(source);
  const base = { x: (area.topRightPercentage.x + area.bottomLeftPercentage.x) / 2, y: (area.topRightPercentage.y + area.bottomLeftPercentage.y) / 2 };
  const transformed = noiseRectAt({ ...area, moveEvents: [] }, seconds, aspect).center;
  return { x: base.x + desiredCenter.x - transformed.x, y: base.y + desiredCenter.y - transformed.y };
}

/** Translate an entire noise-domain animation without changing its relative motion. */
export function translateNoiseArea(source, delta) {
  const area = normalizeNoiseArea(source);
  for (const key of ['topRightPercentage', 'bottomLeftPercentage']) {
    area[key].x += delta.x; area[key].y += delta.y;
  }
  for (const event of area.moveEvents) {
    event.endPosition.x += delta.x; event.endPosition.y += delta.y;
  }
  for (const key of ['scaleEvents', 'rotateEvents']) for (const event of area[key]) {
    event.anchor.x += delta.x; event.anchor.y += delta.y;
  }
  return area;
}

/** Resize from one displayed corner while keeping its opposite corner fixed. */
export function resizeNoiseAreaFromCorner(source, seconds, cornerIndex, desiredCorner, aspect = 16 / 9) {
  let area = normalizeNoiseArea(source);
  const rect = noiseRectAt(area, seconds, aspect); const center = { x: rect.center.x * aspect, y: rect.center.y };
  // Corner indices follow the canvas handle order: top-left, top-right, bottom-right, bottom-left.
  const signs = [[-1, 1], [1, 1], [1, -1], [-1, -1]]; const [signX, signY] = signs[cornerIndex] ?? [1, 1];
  const opposite = rotateAround({ x: center.x - signX * rect.width * aspect / 2, y: center.y - signY * rect.height / 2 }, center, rect.rotation);
  const local = rotateAround({ x: desiredCorner.x * aspect, y: desiredCorner.y }, opposite, -rect.rotation);
  const deltaX = signX * Math.max(.002 * aspect, signX * (local.x - opposite.x));
  const deltaY = signY * Math.max(.002, signY * (local.y - opposite.y));
  const adjusted = rotateAround({ x: opposite.x + deltaX, y: opposite.y + deltaY }, opposite, rect.rotation);
  const desiredCenter = { x: (opposite.x + adjusted.x) / (2 * aspect), y: (opposite.y + adjusted.y) / 2 };
  const ratioX = Math.abs(deltaX) / Math.max(.0001, rect.width * aspect); const ratioY = Math.abs(deltaY) / Math.max(.0001, rect.height);
  const exact = [...area.scaleEvents.keys()].reverse().find(index => Math.abs(area.scaleEvents[index].time - seconds) < 1e-7);
  if (exact !== undefined) {
    area.scaleEvents[exact].scale.x *= ratioX; area.scaleEvents[exact].scale.y *= ratioY;
  } else {
    const baseCenter = { x: (area.topRightPercentage.x + area.bottomLeftPercentage.x) / 2, y: (area.topRightPercentage.y + area.bottomLeftPercentage.y) / 2 };
    const width = Math.abs(area.topRightPercentage.x - area.bottomLeftPercentage.x) * ratioX;
    const height = Math.abs(area.topRightPercentage.y - area.bottomLeftPercentage.y) * ratioY;
    area.topRightPercentage = { x: baseCenter.x + width / 2, y: baseCenter.y - height / 2 };
    area.bottomLeftPercentage = { x: baseCenter.x - width / 2, y: baseCenter.y + height / 2 };
  }
  const actualCenter = noiseRectAt(area, seconds, aspect).center;
  return translateNoiseArea(area, { x: desiredCenter.x - actualCenter.x, y: desiredCenter.y - actualCenter.y });
}

export function noiseContains(rect, pointValue) {
  const local = rotateAround(pointValue, rect.center, -rect.rotation);
  return rect.width > 0 && rect.height > 0 && Math.abs(local.x - rect.center.x) <= rect.width / 2 && Math.abs(local.y - rect.center.y) <= rect.height / 2;
}
