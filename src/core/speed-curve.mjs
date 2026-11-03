import { rebaseCustomEventValues } from './event-easing.mjs';
import { SpeedIntegral } from './events.mjs';
import { ControlCurve } from './scene.mjs';
import { TempoMap } from './tempo.mjs';
import { beatValue, upperBound } from './beat.mjs';
import { noteIsAbove } from './chart.mjs';
import { describeDistanceEasing, distanceCurveMeta, validDistanceCurveGroups } from './distance-curve-fit.mjs';

const EPS = 1e-7;
export const speedCurveSameTime = (a, b) => Math.abs(a - b) < EPS;

// No note arrays, scene, media or per-frame work: only the selected line's tracks.
export class SpeedCurveModel {
  constructor(chart, lineIndex, note, previous, { nodes = true, clampHoldHead = true } = {}) {
    this.chart = chart; this.lineIndex = lineIndex; this.line = chart.judgeLineList[lineIndex]; this.note = note;
    this.factor = this.line.bpmfactor ?? 1;
    this.tempo = previous?.chart.BPMList === chart.BPMList ? previous.tempo : new TempoMap(chart.BPMList);
    this.hitBeat = beatValue(note.startTime); this.hit = this.tempo.seconds(this.hitBeat, this.factor);
    this.side = noteIsAbove(note) ? 1 : -1; this.noteSpeed = note.speed ?? 1;
    this.control = new ControlCurve(this.line.yControl, 'y');
    this.clampHoldHead = clampHoldHead;
    this.layers = (this.line.eventLayers ?? []).map((layer, index) => {
      const events = layer?.speedEvents ?? [];
      const old = previous?.layers[index];
      if (old?.source === events && previous.tempo === this.tempo && previous.factor === this.factor) return old;
      const integral = new SpeedIntegral(events, this.tempo, this.factor);
      const indices = new Map(events.map((event, index) => [event, index]));
      const effective = integral.events.filter((entry, i, entries) => !entries[i + 1] || entries[i + 1].start > entry.start + EPS);
      return { source: events, integral, recipes: validDistanceCurveGroups(effective.map(entry => entry.event)), entries: effective.map((entry, sortedIndex) => ({ ...entry, index: indices.get(entry.event), sortedIndex })) };
    });
    this.hitFloor = this.floor(this.hit);
    this.segmentDescriptions = new Map();
    this.nodes = nodes ? this.boundaries() : [];
  }
  floor(seconds) { return this.layers.reduce((sum, layer) => sum + layer.integral.distance(seconds), 0); }
  raw(beat) { return this.hitFloor - this.floor(this.tempo.seconds(beat, this.factor)) + (this.note.yOffset ?? 0); }
  project(raw) { return raw * this.noteSpeed * this.side * (this.note.type === 2 ? 1 : this.control.value(raw)); }
  distance(beat) { return this.project(this.clampHoldHead && this.note.type === 2 && beat >= this.hitBeat ? this.note.yOffset ?? 0 : this.raw(beat)); }
  speed(beat) { const seconds = this.tempo.seconds(beat, this.factor); return this.layers.reduce((sum, layer) => sum + layer.integral.value(seconds), 0); }
  inverse(distance, beat) {
    const current = this.raw(beat);
    if (Math.abs(this.distance(beat) - distance) < 1e-6) return current;
    if (Math.abs(this.noteSpeed) < 1e-12) throw Error('speed-curve.error.zeroNote');
    if (this.clampHoldHead && this.note.type === 2 && beat >= this.hitBeat || Math.abs(beat - this.hitBeat) < 1e-12) throw Error('speed-curve.error.hit');
    if (this.note.type === 2 || this.control.points.length <= 1 || this.control.points.every(point => point.y === 1)) return distance / (this.noteSpeed * this.side);
    let value = current;
    for (let i = 0; i < 35; i++) {
      const error = this.project(value) - distance;
      if (Math.abs(error) < 1e-5) return value;
      const step = Math.max(.001, Math.abs(value) * 1e-5), derivative = (this.project(value + step) - this.project(value - step)) / (2 * step);
      if (Math.abs(derivative) < 1e-10) break;
      value -= Math.max(-1e6, Math.min(1e6, error / derivative));
      if (!Number.isFinite(value) || Math.abs(value) > 1e9) break;
    }
    throw Error('speed-curve.error.control');
  }
  boundaries() {
    const nodes = new Map();
    for (const [layer, track] of this.layers.entries()) {
      const add = (entry, edge) => {
        const seconds = edge === 'start' ? entry.start : entry.end;
        // Event times are already exact chart beats. A seconds round trip can
        // put a boundary a few ULPs inside its neighbor and trigger a false cut.
        const beat = beatValue(entry.event[edge === 'start' ? 'startTime' : 'endTime']);
        const next = track.entries[entry.sortedIndex + 1];
        const meta = track.recipes.get(distanceCurveMeta(entry.event)?.id);
        if (meta && (edge === 'start' && beat > meta.start + EPS || edge === 'end' && beat < meta.end - EPS)) return;
        // An overlapped end no longer changes the active speed function.
        if (edge === 'end' && next && next.start < seconds - EPS) return;
        const variable = entry.event.start !== entry.event.end;
        const before = edge === 'start' && entry.sortedIndex ? track.entries[entry.sortedIndex - 1] : null;
        const beforeValue = before ? track.integral.sample(before, seconds - EPS) : track.integral.sample(entry, seconds);
        const afterValue = track.integral.sample(entry, seconds);
        if (!variable && !(edge === 'end' && entry.event.rpeNextSpeedCurveEndNode || edge === 'start' && (entry.event.rpeNextSpeedCurveNode || Math.abs(beforeValue - afterValue) > EPS || before && before.event.start !== before.event.end && before.end >= seconds - EPS))) return;
        const key = Math.round(beat * 1e8);
        if (!nodes.has(key)) nodes.set(key, { beat, refs: [] });
        nodes.get(key).refs.push({ layer, index: entry.index, edge, event: entry.event });
      };
      for (const entry of track.entries) { add(entry, 'start'); if (entry.end > entry.start + EPS) add(entry, 'end'); }
    }
    // Beat-time slope also changes at BPM boundaries, even at constant line speed.
    for (const point of this.tempo.points.slice(1)) {
      const key = Math.round(point.beat * 1e8);
      if (!nodes.has(key)) nodes.set(key, { beat: point.beat, refs: [], bpm: true });
      else nodes.get(key).bpm = true;
    }
    const hitKey = Math.round(this.hitBeat * 1e8);
    if (!nodes.has(hitKey)) nodes.set(hitKey, { beat: this.hitBeat, refs: [] });
    nodes.get(hitKey).judgment = true;
    return [...nodes.values()].sort((a, b) => a.beat - b.beat);
  }
  ref(node, layer) {
    // A real speed boundary can coincide with the panel-only judgment anchor.
    // Prefer that editable boundary; the anchor only supplies a fallback ref.
    return node?.refs.find(ref => ref.layer === layer && ref.edge === 'start') ?? node?.refs.find(ref => ref.layer === layer) ?? node?.refs[0]
      ?? (node?.judgment ? { layer: layer ?? 0, edge: 'judgment', beat: this.hitBeat, event: null } : undefined);
  }
  outgoing(node, layer) {
    if (!node || !node.judgment && !node.refs.some(ref => ref.layer === layer)) return null;
    const next = this.nodes.find(other => other.beat > node.beat + EPS && (other.judgment || other.refs.some(ref => ref.layer === layer)));
    if (!next) return null;
    const entry = this.at(node.beat + Math.min(1e-5, (next.beat - node.beat) / 4), layer);
    const key = `${node.beat}:${next.beat}:${layer}`;
    if (!this.segmentDescriptions.has(key)) {
      const meta = this.layers[layer]?.recipes.get(distanceCurveMeta(entry?.event)?.id);
      const suggested = meta && Math.abs(meta.start - node.beat) < EPS && Math.abs(meta.end - next.beat) < EPS ? meta.easing : undefined;
      this.segmentDescriptions.set(key, describeDistanceEasing(this, node.beat, next.beat, suggested));
    }
    return { start: node.beat, end: next.beat, next, layer, index: entry?.index, event: entry?.event,
      ...this.segmentDescriptions.get(key), bezier: false };
  }
  at(beat, layer) { const entries = this.layers[layer]?.entries ?? []; return entries[Math.max(0, upperBound(entries, this.tempo.seconds(beat, this.factor), entry => entry.start) - 1)]; }
  // Linear contribution of an event endpoint to floor(hit)-floor(t). Integrate
  // only its effective range; all other events/notes stay outside this calculation.
  coefficient(layer, index, field, beat) {
    const entries = this.layers[layer].entries, position = entries.findIndex(entry => entry.index === index), entry = entries[position];
    if (!entry) return 0;
    const time = this.tempo.seconds(beat, this.factor), left = Math.min(time, this.hit), right = Math.max(time, this.hit);
    const low = Math.max(left, position === 0 ? -Infinity : entry.start), high = Math.min(right, entries[position + 1]?.start ?? Infinity);
    if (high <= low) return 0;
    const basis = { ...entry, event: rebaseCustomEventValues(entry.event, { ...entry.event, start: field === 'start' || field === 'both' ? 1 : 0, end: field === 'end' || field === 'both' ? 1 : 0 }) };
    const cuts = [...new Set([low, high, entry.start, entry.end].filter(t => t >= low && t <= high))].sort((a, b) => a - b);
    let integral = 0;
    for (let i = 0; i < cuts.length - 1; i++) integral += SpeedIntegral.prototype.integrate.call(this.layers[layer].integral, { start: cuts[i], entry: basis }, cuts[i + 1]);
    return integral * 120 * (time <= this.hit ? 1 : -1);
  }
}
