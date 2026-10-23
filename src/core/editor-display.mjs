import { beatValue } from './beat.mjs';
import { easing } from './easing.mjs';
import { trajectoryEventValue } from './curve-trajectory.mjs';
import { t } from '../i18n.mjs';

export const SPECIAL_TRACKS = [
  { key: 'scaleXEvents', label: t('editor-display.s4175cf1') }, { key: 'scaleYEvents', label: t('editor-display.sd55daa9') },
  { key: 'colorEvents', label: t('editor-display.s8ef4886') }, { key: 'paintEvents', label: t('editor-display.s14f807e') }, { key: 'textEvents', label: t('editor-display.sf4d3dab') },
];
export const MAX_BASE_LAYERS = 4;

export function previewViewport(width, height, ratio = 1.5) {
  const logicalWidth = Math.min(1350, 900 * ratio);
  const logicalHeight = Math.min(900, 1350 / ratio);
  const scale = Math.min(width / logicalWidth, height / logicalHeight);
  return { scale, width: logicalWidth * scale, height: logicalHeight * scale,
    left: (width - logicalWidth * scale) / 2, top: (height - logicalHeight * scale) / 2 };
}

export function overflowTextureSize(width, height, pixelRatio, blur, filterRadius = 8) {
  const ratio = blur > 0 ? Math.min(pixelRatio, 1, filterRadius / Math.max(filterRadius, blur), Math.sqrt(480000 / Math.max(1, width * height))) : pixelRatio;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

// Positions adapt to the visible frame; sprite dimensions and rotation stay uniform.
export function previewPositionScale(ratio = 1.5) {
  return { x: Math.min(1, ratio / 1.5), y: Math.min(1, 1.5 / ratio) };
}

export function previewNoiseGeometry(sample, positionScale) {
  if (positionScale.x === 1 && positionScale.y === 1) return sample;
  const project = point => ({ x: point.x * positionScale.x, y: point.y * positionScale.y });
  return { ...sample, points: sample.points.map(project), center: project(sample.center),
    rotation: Math.atan2(Math.sin(sample.rotation) * positionScale.y, Math.cos(sample.rotation) * positionScale.x) };
}

export function previewNotePosition(position, line, positionScale) {
  // RPE leaves note-local distances unscaled on parented lines.
  const parent = Number(line.father === '' ? -1 : line.father ?? -1);
  if (Number.isInteger(parent) && parent >= 0 || positionScale.x === 1 && positionScale.y === 1) return position;
  return { ...position, x: position.x * positionScale.x, y: position.y * positionScale.y, tail: position.tail * positionScale.y };
}

export function eventChains(events) {
  const groups = [];
  for (const entry of events.map((event, index) => ({ event, index })).sort((left, right) => beatValue(left.event.startTime) - beatValue(right.event.startTime))) {
    let group = groups.at(-1);
    if (!group || entry.event.trajectory || group.entries.at(-1).event.trajectory || Math.abs(beatValue(group.entries.at(-1).event.endTime) - beatValue(entry.event.startTime)) > 1e-8) {
      group = { entries: [], min: Infinity, max: -Infinity }; groups.push(group);
    }
    group.entries.push(entry);
    if (entry.event.trajectory) for (let index = 0; index <= 64; index++) { const value = trajectoryEventValue(entry.event, index / 64); group.min = Math.min(group.min, value); group.max = Math.max(group.max, value); }
    for (const value of [entry.event.start, entry.event.end]) if (typeof value === 'number') { group.min = Math.min(group.min, value); group.max = Math.max(group.max, value); }
  }
  return groups;
}

export function simultaneousNotes(chart, tempo) {
  const counts = new Map(); const times = new Map();
  for (const line of chart.judgeLineList ?? []) for (const note of line.notes ?? []) {
    const time = Math.round(tempo.seconds(note.startTime, line.bpmfactor ?? 1) * 1000000);
    times.set(note, time); counts.set(time, (counts.get(time) ?? 0) + 1);
  }
  return new Set([...times].filter(([, time]) => counts.get(time) > 1).map(([note]) => note));
}

export function strokeIntersects(start, end, rectangle) {
  return Math.max(start.x, end.x) >= rectangle.left && Math.min(start.x, end.x) <= rectangle.right
    && Math.max(start.y, end.y) >= rectangle.top && Math.min(start.y, end.y) <= rectangle.bottom;
}

export function hitParticles(age, seed, size) {
  if (age < 0 || age >= 2 / 3) return [];
  const amount = easing(age * 1.5, 16);
  return Array.from({ length: 4 }, (unused, index) => {
    const random = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
    const angle = (random - Math.floor(random)) * Math.PI * 2;
    return { x: Math.cos(angle) * size * 1.1 * amount, y: Math.sin(angle) * size * 1.1 * amount,
      radius: size * 0.075 * amount, alpha: Math.max(0, 1 - age * 1.5) };
  });
}
