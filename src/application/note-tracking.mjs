import { cropCustomEvent } from '../core/event-easing.mjs';
import { beatValue, fromNumber } from '../core/beat.mjs';
import { createEvent, assertChart } from '../core/chart.mjs';
import { createPlacedLine } from '../core/placement-defaults.mjs';
import { EventTrack } from '../core/events.mjs';
import { noiseTrackingTarget, trackingCuts, simplifyTrackingSamples } from '../core/noise-tracking.mjs';
import { chartWithEventLists } from './event-commands.mjs';
import { t } from '../i18n.mjs';

export function trackedNoteEvents(chart, tempo, { target, start, end, lineIndex = -1, layer = 0, rotation = true, sampleRate = 120, lineDefaults }) {
  const beginBeat = Array.isArray(start) ? beatValue(start) : start, endBeat = Array.isArray(end) ? beatValue(end) : end;
  if (![beginBeat, endBeat].every(Number.isFinite) || beginBeat < 0 || endBeat <= beginBeat || ![60, 120, 240].includes(sampleRate) || !Number.isInteger(layer) || layer < 0 || layer > 3 || !Number.isInteger(lineIndex) || lineIndex < -1 || lineIndex >= chart.judgeLineList.length) throw Error(t('note-track.invalid'));
  const source = noiseTrackingTarget(chart, tempo, { ...target, mode: 'note' }), begin = tempo.seconds(beginBeat), finish = tempo.seconds(endBeat);
  const destination = lineIndex < 0 ? createPlacedLine(t('note-track.lineName'), lineDefaults) : chart.judgeLineList[lineIndex];
  const destinationIndex = lineIndex < 0 ? chart.judgeLineList.length : lineIndex, runtime = lineIndex < 0 ? null : source.scene.lines[lineIndex], factor = destination.bpmfactor ?? 1;
  const targetTracks = runtime?.tracks ?? Object.fromEntries(['moveXEvents', 'moveYEvents', 'rotateEvents'].map(type => [type, destination.eventLayers.map(layer => new EventTrack(layer?.[type] ?? [], tempo, factor))]));
  const cuts = [...new Set([...trackingCuts(chart, tempo, source, begin, finish), ...(runtime ? trackingCuts(chart, tempo, { line: destination }, begin, finish) : [])])].sort((a, b) => a - b);
  if ((finish - begin) * sampleRate + cuts.length * 2 > 60000) throw Error(t('noise-tracking.s60d6330'));
  const inherited = destination.rotateWithFather === undefined ? (chart.META.RPEVersion ?? 0) >= 163 : Boolean(destination.rotateWithFather);
  const read = seconds => {
    const desired = source.sample(seconds), parentId = Number(destination.father === '' ? -1 : destination.father ?? -1), parent = lineIndex >= 0 && Number.isInteger(parentId) && parentId >= 0 ? source.scene.sampler(seconds)(parentId) : null;
    const angle = (parent?.rotation ?? 0) * Math.PI / 180, dx = desired.x - (parent?.x ?? 0), dy = desired.y - (parent?.y ?? 0);
    const other = type => targetTracks[type].reduce((sum, track, index) => sum + (index === layer ? 0 : Number(track.value(seconds))), 0);
    const result = { seconds, x: dx * Math.cos(angle) - dy * Math.sin(angle) - other('moveXEvents'),
      y: dx * Math.sin(angle) + dy * Math.cos(angle) - other('moveYEvents'), rotation: desired.rotation - (inherited ? parent?.rotation ?? 0 : 0) - other('rotateEvents') };
    if (![result.x, result.y, result.rotation].every(Number.isFinite)) throw Error(t('noise-tracking.sbd2453f')); return result;
  };
  const tracks = new Map([['moveXEvents', []], ['moveYEvents', []], ...(rotation ? [['rotateEvents', []]] : [])]);
  const beatAt = seconds => fromNumber(tempo.beat(seconds, factor), 1000000000);
  const append = (a, b) => { for (const [type, events] of tracks) { const field = { moveXEvents: 'x', moveYEvents: 'y', rotateEvents: 'rotation' }[type]; events.push({ ...createEvent(a[field], b[field]), startTime: beatAt(a.seconds), endTime: beatAt(b.seconds) }); } };
  for (let index = 1; index < cuts.length; index++) {
    const first = cuts[index - 1], last = cuts[index], before = read(Math.max(first, last - Math.min(1e-7, (last - first) * 1e-5))), at = read(last);
    const jump = Math.hypot(before.x - at.x, before.y - at.y) > .001 || rotation && Math.abs(before.rotation - at.rotation) > .001;
    const samples = [read(first)], count = Math.max(1, Math.ceil((last - first) * sampleRate));
    for (let step = 1; step < count; step++) samples.push(read(first + (last - first) * step / count));
    samples.push({ ...(jump ? before : at), seconds: last });
    const reduced = simplifyTrackingSamples(samples, .15, rotation ? .015 : Infinity);
    for (let step = 1; step < reduced.length; step++) append(reduced[step - 1], reduced[step]);
    if (index === cuts.length - 1 && jump) append(at, at);
  }
  return { tracks, start: beatAt(begin), end: beatAt(finish), lineIndex: destinationIndex, layer, newLine: lineIndex < 0 ? destination : null };
}

export function noteTrackingChart(chart, generated, replace = false, tempo) {
  const { lineIndex, layer, tracks, start, end, newLine } = generated;
  if (newLine) chart = { ...chart, judgeLineList: [...chart.judgeLineList, newLine] };
  const line = chart.judgeLineList[lineIndex], begin = beatValue(start), finish = beatValue(end), factor = line.bpmfactor ?? 1;
  const updates = new Map();
  for (const [type, additions] of tracks) {
    const retained = [];
    for (const event of line.eventLayers?.[layer]?.[type] ?? []) {
      const a = beatValue(event.startTime), b = beatValue(event.endTime);
      if (a >= finish || b <= begin) { retained.push(event); continue; }
      if (!newLine && !replace) throw Object.assign(Error(t('note-track.conflict')), { code: 'NOTE_TRACK_CONFLICT' });
      if (event.trajectory) throw Error(t('trajectory-commands.s7c2c568'));
      if (event.bezier && (a < begin || b > finish)) throw Error(t('trajectory-commands.s869ce32'));
      const track = new EventTrack([event], tempo, factor), secondsStart = tempo.seconds(event.startTime, factor), secondsEnd = tempo.seconds(event.endTime, factor);
      const clip = (left, right) => {
        const l = tempo.seconds(left, factor), r = tempo.seconds(right, factor), easeLeft = event.easingLeft ?? 0, easeRange = (event.easingRight ?? 1) - easeLeft;
        if (event.customEasing) return cropCustomEvent(event, (l - secondsStart) / (secondsEnd - secondsStart), (r - secondsStart) / (secondsEnd - secondsStart), fromNumber(left), fromNumber(right));
        return { ...event, startTime: fromNumber(left), endTime: fromNumber(right), start: track.value(l), end: track.value(r), easingLeft: easeLeft + easeRange * (l - secondsStart) / (secondsEnd - secondsStart), easingRight: easeLeft + easeRange * (r - secondsStart) / (secondsEnd - secondsStart) };
      };
      if (a < begin) retained.push(clip(a, begin)); if (b > finish) retained.push(clip(finish, b));
    }
    updates.set(type, [...retained, ...additions].sort((a, b) => beatValue(a.startTime) - beatValue(b.startTime)));
  }
  const result = chartWithEventLists(chart, lineIndex, layer, updates); assertChart(result); return result;
}
