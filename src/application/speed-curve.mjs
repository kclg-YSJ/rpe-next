import { rebaseCustomEventValues } from '../core/event-easing.mjs';
import { SpeedCurveModel, speedCurveSameTime as same } from '../core/speed-curve.mjs';
import { fromNumber, beatValue } from '../core/beat.mjs';
import { chartWithEventLists, splitEvent } from './event-commands.mjs';
import { createEvent } from '../core/chart.mjs';
import { distanceCurveGroups, replaceDistanceCurves } from './distance-curve.mjs';
import { tagDistanceCurve, describeDistanceEasing } from '../core/distance-curve-fit.mjs';

const fail = key => { throw Error('speed-curve.error.' + key); };
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const editable = event => { if (event.linkgroup > 0) fail('linked'); if (!Number.isFinite(event.start) || !Number.isFinite(event.end) || event.trajectory) fail('unsupported'); };
function splitSpeedEvent(event, beat, model) {
  if (!event.bezier) return splitEvent(event, beat, model.tempo, model.factor);
  const start = model.tempo.seconds(event.startTime, model.factor), end = model.tempo.seconds(event.endTime, model.factor), progress = (model.tempo.seconds(beat, model.factor) - start) / (end - start);
  const [x1, y1, x2, y2] = event.bezierPoints;
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) fail('bezier');
  const mix = (a, b, u) => a.map((value, i) => value + (b[i] - value) * u);
  const points = [[0, 0], [x1, y1], [x2, y2], [1, 1]];
  const partition = u => { const a = mix(points[0], points[1], u), b = mix(points[1], points[2], u), c = mix(points[2], points[3], u), d = mix(a, b, u), e = mix(b, c, u), f = mix(d, e, u); return { a, c, d, e, f }; };
  let low = 0, high = 1;
  for (let i = 0; i < 48; i++) { const mid = (low + high) / 2; if (partition(mid).f[0] < progress) low = mid; else high = mid; }
  const { a, c, d, e, f } = partition((low + high) / 2), amount = f[1];
  if (Math.abs(amount) < 1e-10 || Math.abs(1 - amount) < 1e-10) fail('bezier');
  const normalize = (point, first, width, height) => [(point[0] - first[0]) / width, (point[1] - first[1]) / height];
  const value = event.start + (event.end - event.start) * amount;
  return [{ ...event, endTime: fromNumber(beat), end: value, bezierPoints: [...normalize(a, [0, 0], progress, amount), ...normalize(d, [0, 0], progress, amount)] },
    { ...event, startTime: fromNumber(beat), start: value, bezierPoints: [...normalize(e, f, 1 - progress, 1 - amount), ...normalize(c, f, 1 - progress, 1 - amount)] }];
}
function result(model, layer, events, beat, action, options) {
  const originals = new Set(model.layers[layer]?.source ?? []);
  for (const event of events) if (!Number.isFinite(event.start) || !Number.isFinite(event.end) || Math.abs(event.start) > 1e7 || Math.abs(event.end) > 1e7 || beatValue(event.endTime) < beatValue(event.startTime) || !originals.has(event) && beatValue(event.endTime) <= beatValue(event.startTime)) fail('range');
  const chart = chartWithEventLists(model.chart, model.lineIndex, layer, new Map([['speedEvents', events]]));
  const next = new SpeedCurveModel(chart, model.lineIndex, model.note, model, options);
  return { chart, model: next, beat, action, layer, changed: events.reduce((n, event, i) => n + (event !== model.layers[layer]?.source[i] ? 1 : 0), 0) };
}

// Easing describes the distance curve itself, not the speed interpolation.
function easeOutgoing(model, ref, easing) {
  if (!Number.isInteger(easing) || easing < 1 || easing > 29) fail('easing');
  const beat = ref.edge === 'judgment' ? ref.beat : beatValue(ref.event[ref.edge === 'start' ? 'startTime' : 'endTime']);
  const node = model.nodes.find(node => same(node.beat, beat)), segment = model.outgoing(node, ref.layer);
  if (!segment) fail('lastNode');
  if (Math.abs(model.noteSpeed) < 1e-12) fail('zeroNote');
  if (model.note.type === 2 && segment.start >= model.hitBeat) fail('hit');
  return replaceDistanceCurves(model, ref.layer, [{ start: segment.start, end: segment.end, easing }], splitSpeedEvent, { beat });
}

// Landing on the judgment anchor is a valid real boundary, not a zero-duration
// segment. Rebuild only the side the node came from, keeping the other side's
// native events intact. Moving away also keeps the fixed anchor in that side.
function moveAtJudgment(model, layer, oldBeat, beat, distance) {
  const hit = model.hitBeat, nodes = model.nodes.filter(node => !same(node.beat, oldBeat) && !same(node.beat, hit) && node.refs.some(ref => ref.layer === layer));
  const low = Math.min(oldBeat, beat), high = Math.max(oldBeat, beat);
  if (nodes.some(node => node.beat > low && node.beat < high)) fail('cross');
  if (model.clampHoldHead && model.note.type === 2 && (oldBeat > hit || beat > hit)) {
    // A Hold head is pinned after judgment, but its line's real speed boundary
    // can still move. Solve the underlying travel, then restore the head view.
    const motion = new SpeedCurveModel(model.chart, model.lineIndex, model.note, model, { clampHoldHead: false });
    const shifted = moveAtJudgment(motion, layer, oldBeat, beat, motion.distance(beat));
    return { ...shifted, model: new SpeedCurveModel(shifted.chart, model.lineIndex, model.note, model) };
  }
  const before = nodes.findLast(node => node.beat < low)?.beat ?? Math.min(low - 1, beatValue(model.layers[layer]?.source[0]?.startTime ?? fromNumber(low - 1)));
  const after = nodes.find(node => node.beat > high)?.beat ?? high + 1;
  let plans;
  if (same(beat, hit)) {
    const start = oldBeat < hit ? before : hit, end = oldBeat < hit ? hit : after;
    const easing = describeDistanceEasing(model, oldBeat < hit ? before : oldBeat, oldBeat < hit ? oldBeat : after).easing;
    plans = [{ start, end, easing }];
  } else {
    const start = beat < hit ? before : hit, end = beat < hit ? hit : after;
    const target = distance ?? model.distance(beat);
    plans = [
      { start, end: beat, endDistance: target, easing: describeDistanceEasing(model, start, beat).easing },
      { start: beat, end, startDistance: target, easing: describeDistanceEasing(model, beat, end).easing },
    ];
  }
  return replaceDistanceCurves(model, layer, plans, splitSpeedEvent, { beat });
}

function deleteAtJudgment(model, layer) {
  const hit = model.hitBeat, track = model.layers[layer], neighbors = model.nodes.filter(node => !same(node.beat, hit) && node.refs.some(ref => ref.layer === layer));
  const start = neighbors.findLast(node => node.beat < hit)?.beat ?? hit - 1, end = neighbors.find(node => node.beat > hit)?.beat ?? hit + 1;
  const a = model.tempo.seconds(start, model.factor), b = model.tempo.seconds(end, model.factor), h = model.hit;
  const left = h - a, right = b - h, duration = b - a;
  const first = left * (1 - left / (2 * duration)), second = left * left / (2 * duration);
  const third = right * right / (2 * duration), fourth = right * (1 - right / (2 * duration));
  const leftArea = (track.integral.distance(h) - track.integral.distance(a)) / 120, rightArea = (track.integral.distance(b) - track.integral.distance(h)) / 120;
  const determinant = first * fourth - second * third;
  // Join the native speeds with one linear event. Its two areas preserve both
  // neighboring distances and the immutable judgment distance, without leaving
  // another real node at judgment or exposing fitting fragments.
  const merged = { ...model.at((start + end) / 2, layer)?.event, ...createEvent((leftArea * fourth - second * rightArea) / determinant, (first * rightArea - leftArea * third) / determinant, start, end), rpeNextSpeedCurveNode: true, rpeNextSpeedCurveEndNode: true };
  delete merged.rpeNextDistanceCurve;
  const events = [];
  for (const event of track.source) {
    const low = beatValue(event.startTime), high = beatValue(event.endTime);
    if (high <= start && low < start || low >= end) { events.push(event); continue; }
    editable(event);
    if (low < start && high > start) events.push(splitSpeedEvent(event, start, model)[0]);
    if (high > end && low < end) events.push(splitSpeedEvent(event, end, model)[1]);
  }
  if (!events.some(event => beatValue(event.startTime) < start)) events.push(createEvent(track.integral.value(a - 1e-8), undefined, start - 1, start));
  if (!events.some(event => same(beatValue(event.startTime), end))) {
    const next = events.reduce((value, event) => { const time = beatValue(event.startTime); return time > end ? Math.min(value, time) : value; }, Infinity);
    events.push(createEvent(track.integral.value(b + 1e-8), undefined, end, Number.isFinite(next) ? next : end + 1));
  }
  events.push(merged);
  return result(model, layer, events, hit, 'delete');
}

export function editSpeedCurveNode(model, ref, { beat, distance, easing } = {}) {
  if (!ref) fail('bpm');
  if (easing !== undefined) return easeOutgoing(model, ref, easing);
  if (ref.edge === 'judgment') fail('hit');
  const layer = ref.layer, original = model.layers[layer].source, events = [...original], event = original[ref.index];
  editable(event);
  const oldBeat = beatValue(event[ref.edge === 'start' ? 'startTime' : 'endTime']); beat ??= oldBeat;
  if (!Number.isFinite(beat) || Math.abs(beat) > 1e7 || distance !== undefined && !Number.isFinite(distance)) fail('range');
  if (!same(beat, oldBeat)) beat = beatValue(fromNumber(beat));
  if (same(beat, model.hitBeat)) {
    beat = model.hitBeat;
    if (same(oldBeat, beat) && distance !== undefined && Math.abs(distance - model.distance(beat)) > 1e-6) fail('hit');
    if (same(oldBeat, beat)) return { chart: model.chart, model, beat, action: 'edit', layer, changed: 0 };
  }
  if (!same(beat, oldBeat) && (same(beat, model.hitBeat) || same(oldBeat, model.hitBeat))) return moveAtJudgment(model, layer, oldBeat, beat, distance);
  const entries = model.layers[layer].entries, position = entries.findIndex(entry => entry.index === ref.index), previous = entries[position - 1], next = entries[position + 1];
  if (beatValue(event.endTime) <= beatValue(event.startTime)) {
    const end = next ? model.tempo.beat(next.start, model.factor) : Math.max(oldBeat + 1, model.hitBeat);
    events[ref.index] = { ...event, start: event.end, endTime: fromNumber(end), rpeNextSpeedCurveNode: true, rpeNextSpeedCurveEndNode: true };
    const normalized = result(model, layer, events, oldBeat, 'edit');
    const node = normalized.model.nodes.find(node => same(node.beat, oldBeat));
    return editSpeedCurveNode(normalized.model, normalized.model.ref(node, layer), { beat, distance });
  }
  const managed = distanceCurveGroups(model, layer).filter(group => same(group.start, oldBeat) || same(group.end, oldBeat));
  if (managed.length) {
    const nextBeat = beatValue(fromNumber(beat)), target = distance ?? model.distance(oldBeat);
    const neighbors = model.nodes.filter(node => !same(node.beat, oldBeat) && (node.judgment || node.refs.some(item => item.layer === layer)));
    const left = neighbors.findLast(node => node.beat < oldBeat), right = neighbors.find(node => node.beat > oldBeat);
    if (left && nextBeat <= left.beat || right && nextBeat >= right.beat) fail('cross');
    const low = left?.beat ?? Math.min(oldBeat, nextBeat) - 1, high = right?.beat ?? Math.max(oldBeat, nextBeat) + 1;
    const plans = [
      { start: low, end: nextBeat, oldStart: low, oldEnd: oldBeat, startDistance: model.distance(low), endDistance: target, easing: describeDistanceEasing(model, low, oldBeat).easing },
      { start: nextBeat, end: high, oldStart: oldBeat, oldEnd: high, startDistance: target, endDistance: model.distance(high), easing: describeDistanceEasing(model, oldBeat, high).easing },
    ];
    return replaceDistanceCurves(model, layer, plans, splitSpeedEvent, { beat: nextBeat });
  }
  const touched = new Set([ref.index]);
  if (!same(beat, oldBeat)) {
    const start = beatValue(event.startTime), end = beatValue(event.endTime);
    if (ref.edge === 'start') {
      if (beat >= end && end > start || previous && beat <= model.tempo.beat(previous.start, model.factor) || next && beat >= model.tempo.beat(next.start, model.factor)) fail('cross');
      events[ref.index] = { ...event, startTime: fromNumber(beat), ...(same(start, end) ? { endTime: fromNumber(beat) } : {}) };
      if (previous && same(previous.end, model.tempo.seconds(oldBeat, model.factor))) { editable(previous.event); events[previous.index] = { ...previous.event, endTime: fromNumber(beat) }; touched.add(previous.index); }
      else if (previous && previous.end > model.tempo.seconds(beat, model.factor)) fail('overlap');
    } else {
      if (beat <= start || next && beat >= model.tempo.beat(next.end, model.factor)) fail('cross');
      events[ref.index] = { ...event, endTime: fromNumber(beat) };
      if (next && same(next.start, model.tempo.seconds(oldBeat, model.factor))) { editable(next.event); events[next.index] = { ...next.event, startTime: fromNumber(beat) }; touched.add(next.index); }
      else if (next && next.start < model.tempo.seconds(beat, model.factor)) fail('overlap');
    }
  }
  // Keep a deliberately edited constant boundary visible too.
  events[ref.index] = { ...events[ref.index], rpeNextSpeedCurveNode: true };
  if (distance === undefined) return result(model, layer, events, beat, 'edit');
  const working = !same(beat, oldBeat) || easing !== undefined ? result(model, layer, events, beat, 'edit', { nodes: false }).model : model;
  const targetRaw = working.inverse(distance, beat);
  if (Math.abs(working.raw(beat) - targetRaw) < 1e-7) return result(model, layer, events, beat, 'edit');
  for (const entry of [previous, next]) if (entry && !(entry.event.linkgroup > 0)) touched.add(entry.index);
  const variables = [...touched].flatMap(index => events[index].inst ? [{ index, field: 'both' }] : [{ index, field: 'start' }, { index, field: 'end' }]);
  const desired = [{ beat, raw: targetRaw, required: true }];
  const otherNodes = model.nodes.filter(node => !same(node.beat, oldBeat) && !same(node.beat, beat));
  const before = otherNodes.findLast(node => node.beat < oldBeat), after = otherNodes.find(node => node.beat > oldBeat);
  for (const node of [before, after]) if (node) desired.push({ beat: node.beat, raw: model.raw(node.beat) });
  const delta = variables.map(() => 0), basis = [];
  for (const constraint of desired) {
    const row = variables.map(variable => working.coefficient(layer, variable.index, variable.field, constraint.beat));
    const projected = [...row];
    for (const q of basis) { const amount = dot(projected, q); for (let i = 0; i < projected.length; i++) projected[i] -= amount * q[i]; }
    const norm = dot(projected, projected), residual = constraint.raw - working.raw(constraint.beat) - dot(row, delta);
    if (norm < 1e-12) { if (constraint.required && Math.abs(residual) > 1e-6) fail('influence'); continue; }
    for (let i = 0; i < delta.length; i++) delta[i] += residual / norm * projected[i];
    basis.push(projected.map(value => value / Math.sqrt(norm)));
  }
  variables.forEach(({ index, field }, i) => { const event = events[index]; events[index] = rebaseCustomEventValues(event, { ...event, ...(field === 'both' ? { start: event.start + delta[i], end: event.end + delta[i] } : { [field]: event[field] + delta[i] }) }); });
  const candidate = result(model, layer, events, beat, 'edit');
  if (Math.abs(candidate.model.distance(beat) - distance) > Math.max(.01, Math.abs(distance) * 1e-6)) fail('solve');
  return candidate;
}

export function addSpeedCurveNode(model, layer, beat, distance) {
  const track = model.layers[layer], original = track?.source ?? [], event = model.at(beat, layer);
  if (!Number.isFinite(beat) || Math.abs(beat) > 1e7 || distance !== undefined && !Number.isFinite(distance)) fail('range');
  if (same(beat, model.hitBeat)) {
    beat = model.hitBeat;
    if (distance !== undefined && Math.abs(distance - model.distance(beat)) > 1e-6) fail('hit');
    const node = model.nodes.find(node => node.judgment);
    if (node?.refs.some(ref => ref.layer === layer)) fail('exists');
    // An unmarked constant event may already have a boundary at judgment.
    const index = original.findIndex(item => same(beatValue(item.startTime), beat) || same(beatValue(item.endTime), beat));
    if (index >= 0) {
      editable(original[index]); const events = [...original];
      events[index] = { ...original[index], [same(beatValue(original[index].startTime), beat) ? 'rpeNextSpeedCurveNode' : 'rpeNextSpeedCurveEndNode']: true };
      return result(model, layer, events, beat, 'add');
    }
  }
  const managed = distanceCurveGroups(model, layer).find(group => beat > group.start + 1e-7 && beat < group.end - 1e-7);
  if (managed) {
    const parts = [], untouched = [];
    for (const item of original) {
      if (item.rpeNextDistanceCurve?.id !== managed.id) { untouched.push(item); continue; }
      editable(item);
      if (beatValue(item.startTime) < beat - 1e-7 && beatValue(item.endTime) > beat + 1e-7) parts.push(...splitSpeedEvent(item, beat, model)); else parts.push(item);
    }
    parts.sort((a, b) => beatValue(a.startTime) - beatValue(b.startTime));
    const left = parts.filter(item => beatValue(item.endTime) <= beat + 1e-7), right = parts.filter(item => beatValue(item.startTime) >= beat - 1e-7);
    const events = [...untouched, ...tagDistanceCurve(left, { id: crypto.randomUUID(), start: managed.start, end: beat, easing: describeDistanceEasing(model, managed.start, beat).easing }),
      ...tagDistanceCurve(right, { id: crypto.randomUUID(), start: beat, end: managed.end, easing: describeDistanceEasing(model, beat, managed.end).easing })];
    const added = result(model, layer, events, beat, 'add');
    if (distance === undefined || Math.abs(added.model.distance(beat) - distance) < .001) return added;
    return { ...editSpeedCurveNode(added.model, added.model.ref(added.model.nodes.find(node => same(node.beat, beat)), layer), { beat, distance }), action: 'add' };
  }
  if (original.some(event => same(beatValue(event.startTime), beat) || same(beatValue(event.endTime), beat) && event.start !== event.end)) fail('exists');
  const events = [...original];
  if (event && beat > model.tempo.beat(event.start, model.factor) && beat < model.tempo.beat(event.end, model.factor)) {
    editable(event.event);
    const split = splitSpeedEvent(event.event, beat, model);
    events.splice(event.index, 1, { ...split[0], rpeNextSpeedCurveEndNode: true }, { ...split[1], rpeNextSpeedCurveNode: true, rpeNextSpeedCurveEndNode: true });
  } else {
    if (event) editable(event.event);
    const value = track?.integral.value(model.tempo.seconds(beat, model.factor)) ?? 0;
    const next = track?.entries.find(entry => model.tempo.beat(entry.start, model.factor) > beat);
    const lastNode = model.nodes.findLast(node => node.beat < beat && node.refs.some(ref => ref.layer === layer));
    let start = beat, end = next ? model.tempo.beat(next.start, model.factor) : Math.max(model.hitBeat, beat + 1);
    if (!next && beat > model.hitBeat && (lastNode || beat > model.hitBeat + 1e-7)) {
      start = Math.max(lastNode?.beat ?? -Infinity, model.hitBeat); end = beat;
      if (event && model.tempo.beat(event.end, model.factor) > start) start = model.tempo.beat(event.end, model.factor);
      if (start >= beat) { start = beat; end = beat + 1; }
    }
    events.push({ ...createEvent(value, value, start, end), rpeNextSpeedCurveNode: true, rpeNextSpeedCurveEndNode: true });
  }
  const added = result(model, layer, events, beat, 'add');
  if (distance === undefined || Math.abs(added.model.distance(beat) - distance) < .001) return added;
  const node = added.model.nodes.find(node => same(node.beat, beat));
  const edited = editSpeedCurveNode(added.model, added.model.ref(node, layer), { beat, distance });
  return { ...edited, action: 'add', changed: added.changed + edited.changed };
}

export function deleteSpeedCurveNode(model, ref) {
  if (!ref) fail('bpm');
  if (ref.edge === 'judgment') fail('hit');
  const at = beatValue(ref.event[ref.edge === 'start' ? 'startTime' : 'endTime']);
  if (same(at, model.hitBeat)) return deleteAtJudgment(model, ref.layer);
  const managed = distanceCurveGroups(model, ref.layer).filter(group => same(group.start, at) || same(group.end, at));
  if (managed.length) {
    let start = Math.min(...managed.map(group => group.start)), end = Math.max(...managed.map(group => group.end));
    if (managed.length === 1 && same(start, at)) start = model.nodes.findLast(node => node.beat < start && (node.judgment || node.refs.some(item => item.layer === ref.layer)))?.beat ?? Math.min(start - 1, model.tempo.beat(model.layers[ref.layer].entries[0]?.start ?? 0, model.factor));
    if (managed.length === 1 && same(end, at)) end = model.nodes.find(node => node.beat > end && (node.judgment || node.refs.some(item => item.layer === ref.layer)))?.beat ?? end + 1;
    return replaceDistanceCurves(model, ref.layer, [{ start, end, oldStart: Math.min(...managed.map(group => group.start)), oldEnd: Math.max(...managed.map(group => group.end)), easing: 1 }], splitSpeedEvent, { beat: at, action: 'delete' });
  }
  const layer = ref.layer, entries = model.layers[layer].entries, position = entries.findIndex(entry => entry.index === ref.index), entry = entries[position];
  const right = ref.edge === 'end' ? entries[position + 1] : entry, left = ref.edge === 'end' ? entry : entries[position - 1];
  editable(entry.event);
  const beat = model.tempo.beat(ref.edge === 'end' ? entry.end : entry.start, model.factor), events = [...model.layers[layer].source];
  if (!left || !right || !same(left.end, right.start)) {
    if (ref.edge === 'end') { const flattened = { ...entry.event, end: entry.event.start, easingType: 1, bezier: 0 }; delete flattened.customEasing; delete flattened.rpeNextSpeedCurveEndNode; events[entry.index] = flattened; }
    else { if (left) editable(left.event); events.splice(entry.index, 1); }
  } else {
    editable(left.event); editable(right.event);
    const merged = { ...left.event, endTime: [...right.event.endTime], end: right.event.end };
    if (right.event.rpeNextSpeedCurveEndNode) merged.rpeNextSpeedCurveEndNode = true; else delete merged.rpeNextSpeedCurveEndNode;
    // Adjacent slices from the add operation can restore the original easing.
    if (left.event.customEasing && right.event.customEasing && JSON.stringify(left.event.customEasing.curve) === JSON.stringify(right.event.customEasing.curve) && JSON.stringify([left.event.customEasing.sourceStart ?? left.event.start, left.event.customEasing.sourceEnd ?? left.event.end]) === JSON.stringify([right.event.customEasing.sourceStart ?? right.event.start, right.event.customEasing.sourceEnd ?? right.event.end]) && same((left.event.customEasing.domain ?? [0, 1])[1], (right.event.customEasing.domain ?? [0, 1])[0])) merged.customEasing = { ...left.event.customEasing, domain: [(left.event.customEasing.domain ?? [0, 1])[0], (right.event.customEasing.domain ?? [0, 1])[1]] };
    else if (!left.event.customEasing && !right.event.customEasing && !left.event.bezier && !right.event.bezier && left.event.easingType === right.event.easingType && same(left.event.easingRight ?? 1, right.event.easingLeft ?? 0) && same(left.event.end, right.event.start)) merged.easingRight = right.event.easingRight ?? 1;
    else { delete merged.customEasing; Object.assign(merged, { easingType: 1, bezier: 0, easingLeft: 0, easingRight: 1 }); }
    events[left.index] = merged; events.splice(right.index, 1);
  }
  return result(model, layer, events, beat, 'delete');
}
