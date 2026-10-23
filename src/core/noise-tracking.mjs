import { beatValue, fromNumber } from './beat.mjs';
import { SceneRuntime } from './scene.mjs';
import { createNoiseArea, createNoiseEvent, withNoiseAreas } from './noise-areas.mjs';
import { noiseLayers } from './noise-skin.mjs';
import { t } from '../i18n.mjs';

const MAX_SAMPLES = 60000;
const timeBeat = seconds => fromNumber(seconds, 1000000000);

export function noiseTrackingTarget(chart, tempo, target) {
  const line = chart.judgeLineList?.[target?.lineIndex];
  if (!line || !['line', 'note'].includes(target.mode)) throw new Error(t('noise-tracking.s7490061'));
  const note = target.mode === 'note' ? line.notes?.[target.noteIndex] : null;
  if (target.mode === 'note' && !note) throw new Error(t('noise-tracking.s808dd45'));
  const scene = new SceneRuntime(); scene.compile(chart, tempo);
  const runtime = scene.lines[target.lineIndex]; const entry = note ? runtime.notes[target.noteIndex] : null;
  return {
    scene, line, note,
    sample(seconds) {
      const state = scene.sampler(seconds)(target.lineIndex);
      if (!entry) return { x: state.x, y: state.y, rotation: state.rotation };
      const position = runtime.noteState(entry, state, seconds); const angle = state.rotation * Math.PI / 180;
      return { x: state.x + position.x * Math.cos(angle) + position.y * Math.sin(angle),
        y: state.y - position.x * Math.sin(angle) + position.y * Math.cos(angle), rotation: state.rotation };
    },
  };
}

// Event boundaries split the fit so a jump cannot become a short diagonal move.
function trackingCuts(chart, tempo, source, start, end) {
  const cuts = new Set([start, end]); const seen = new Set();
  const include = seconds => { if (seconds > start && seconds < end) cuts.add(seconds); };
  let index = chart.judgeLineList.indexOf(source.line);
  while (Number.isInteger(index) && index >= 0 && index < chart.judgeLineList.length && !seen.has(index)) {
    seen.add(index); const line = chart.judgeLineList[index]; const factor = line.bpmfactor ?? 1;
    for (const layer of [...(line.eventLayers ?? []), line.extended]) for (const events of Object.values(layer ?? {})) {
      if (!Array.isArray(events)) continue;
      for (const event of events) if (Array.isArray(event?.startTime) && Array.isArray(event?.endTime)) {
        include(tempo.seconds(event.startTime, factor)); include(tempo.seconds(event.endTime, factor));
      }
    }
    for (const point of tempo.points) include(tempo.seconds(point.beat, factor));
    const parent = Number(line.father ?? -1); index = Number.isInteger(parent) ? parent : -1;
  }
  if (source.note) {
    include(tempo.seconds(source.note.startTime, source.line.bpmfactor ?? 1));
    include(tempo.seconds(source.note.endTime, source.line.bpmfactor ?? 1));
  }
  for (const point of tempo.points) include(point.seconds);
  return [...cuts].sort((a, b) => a - b);
}

function simplify(samples, positionTolerance, angleTolerance) {
  const keep = new Set([0, samples.length - 1]); const pending = [[0, samples.length - 1]];
  while (pending.length) {
    const [first, last] = pending.pop(); const a = samples[first]; const b = samples[last]; let worst = 1; let at = -1;
    for (let index = first + 1; index < last; index++) {
      const sample = samples[index]; const amount = (sample.seconds - a.seconds) / (b.seconds - a.seconds);
      const error = Math.max(Math.hypot(sample.x - a.x - (b.x - a.x) * amount, sample.y - a.y - (b.y - a.y) * amount) / positionTolerance,
        Math.abs(sample.rotation - a.rotation - (b.rotation - a.rotation) * amount) / angleTolerance);
      if (error > worst) { worst = error; at = index; }
    }
    if (at !== -1) { keep.add(at); pending.push([first, at], [at, last]); }
  }
  return [...keep].sort((a, b) => a - b).map(index => samples[index]);
}

export function trackedNoiseArea(chart, tempo, options) {
  const { start, end, width, height, target, layerId = noiseLayers(chart)[0].id, invert = false, active = true, sampleRate = 120, name = '' } = options;
  const startBeat = Array.isArray(start) ? beatValue(start) : start; const endBeat = Array.isArray(end) ? beatValue(end) : end;
  if (![startBeat, endBeat, width, height].every(Number.isFinite) || endBeat <= startBeat || width <= 0 || height <= 0 || width > 100000 || height > 100000) throw new Error(t('noise-tracking.s607705f'));
  if (![60, 120, 240].includes(sampleRate)) throw new Error(t('noise-tracking.s41fa670'));
  if (!noiseLayers(chart).some(layer => layer.id === layerId)) throw new Error(t('noise-tracking.se9c1515'));
  const source = noiseTrackingTarget(chart, tempo, target); const begin = tempo.seconds(startBeat); const finish = tempo.seconds(endBeat);
  const cuts = trackingCuts(chart, tempo, source, begin, finish);
  if ((finish - begin) * sampleRate + cuts.length * 2 > MAX_SAMPLES) throw new Error(t('noise-tracking.s60d6330'));
  const area = { ...createNoiseArea(startBeat, endBeat), Name: name, layerId, isInvert: Boolean(invert),
    bottomLeft: { x: -width / 2, y: -height / 2 }, topRight: { x: width / 2, y: height / 2 },
    activeIntervals: active ? [{ startTime: fromNumber(startBeat), endTime: fromNumber(endBeat), readyFlash: 0.5 }] : [] };
  if (Array.isArray(start)) area.appearTime = [...start]; if (Array.isArray(end)) area.disappearTime = [...end];
  if (active) { area.activeIntervals[0].startTime = [...area.appearTime]; area.activeIntervals[0].endTime = [...area.disappearTime]; }
  const read = seconds => {
    const value = source.sample(seconds);
    if (!Object.values(value).every(Number.isFinite)) throw new Error(t('noise-tracking.sbd2453f'));
    return { ...value, seconds };
  };
  const eventBeat = seconds => seconds === begin ? [...area.appearTime] : seconds === finish ? [...area.disappearTime] : timeBeat(tempo.beat(seconds));
  const append = (first, last, startSeconds = first.seconds, endSeconds = last.seconds) => {
    for (const [type, field] of [['moveXEvents', 'x'], ['moveYEvents', 'y'], ['rotateEvents', 'rotation']]) {
      const event = createNoiseEvent(first[field], last[field], 0, 1, type === 'rotateEvents' ? { x: 0, y: 0 } : undefined);
      event.startTime = eventBeat(startSeconds); event.endTime = eventBeat(endSeconds);
      area[type].push(event);
    }
  };
  for (let index = 0; index < cuts.length - 1; index++) {
    const first = cuts[index]; const last = cuts[index + 1]; const a = read(first);
    // The left limit retains the old value at an instantaneous boundary.
    const probe = Math.max(first, last - Math.min(1e-7, (last - first) * 1e-5)); const left = read(probe); const at = read(last);
    const discontinuity = Math.hypot(left.x - at.x, left.y - at.y) > 0.001 || Math.abs(left.rotation - at.rotation) > 0.001;
    const count = Math.max(1, Math.ceil((last - first) * sampleRate)); const samples = [a];
    for (let step = 1; step < count; step++) samples.push(read(first + (last - first) * step / count));
    samples.push({ ...(discontinuity ? left : at), seconds: last });
    const reduced = simplify(samples, 0.2, 0.02);
    for (let step = 1; step < reduced.length; step++) append(reduced[step - 1], reduced[step]);
    // Adjacent events may have different endpoint values; the next start is the jump.
    if (index === cuts.length - 2 && discontinuity) append(samples.at(-1), at, last, last);
  }
  return area;
}

export function noiseTrackingChart(chart, area) { return withNoiseAreas(chart, [...(chart.blockAreaList ?? []), area]); }
