import { EventTrack, SpeedIntegral } from './events.mjs';
import { IntervalIndex } from './interval-index.mjs';
import { easing } from './easing.mjs';
import { upperBound } from './beat.mjs';
import { noteIsAbove } from './chart.mjs';
import { trajectoryHasRotation } from './curve-trajectory.mjs';

export class ControlCurve {
  constructor(points, property) {
    this.property = property;
    this.points = [...(points ?? [])].sort((left, right) => left.x - right.x);
  }

  value(distance) {
    if (this.points.length <= 1) return this.property === 'skew' ? 0 : 1;
    const index = upperBound(this.points, distance, point => point.x);
    if (index === 0) return this.points[0][this.property];
    if (index >= this.points.length) return this.points.at(-1)[this.property];
    const start = this.points[index - 1];
    const end = this.points[index];
    const amount = easing((distance - start.x) / (end.x - start.x), end.easing ?? 1);
    return start[this.property] + (end[this.property] - start[this.property]) * amount;
  }
}

export class LineRuntime {
  constructor(line, tempo) {
    this.line = line;
    const factor = line.bpmfactor ?? 1;
    this.tracks = Object.fromEntries(['moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents'].map(type =>
      [type, (line.eventLayers ?? []).map(layer => {
        const virtual = ['moveYEvents', 'rotateEvents'].includes(type) ? (layer?.moveXEvents ?? []).filter(event => event.trajectory && (type !== 'rotateEvents' || trajectoryHasRotation(event.trajectory.options))).map(event => ({ ...event, trajectoryAxis: type === 'moveYEvents' ? 'y' : 'rotation' })) : [];
        return new EventTrack([...(layer?.[type] ?? []), ...virtual], tempo, factor);
      })]));
    this.speeds = (line.eventLayers ?? []).map(layer => new SpeedIntegral(layer?.speedEvents, tempo, factor));
    const defaultColor = line.attachUI || line.extended?.textEvents?.length || line.Texture && line.Texture !== 'line.png' ? [255, 255, 255] : [241, 216, 148];
    const defaults = { scaleXEvents: 1, scaleYEvents: 1, colorEvents: defaultColor, textEvents: '', inclineEvents: 0 };
    this.extended = Object.fromEntries(Object.entries(defaults).map(([type, fallback]) => [type, new EventTrack(line.extended?.[type], tempo, factor, fallback)]));
    this.controls = Object.fromEntries(Object.entries({ alpha: 'alphaControl', pos: 'posControl', size: 'sizeControl', skew: 'skewControl', y: 'yControl' })
      .map(([property, name]) => [property, new ControlCurve(line[name], property)]));
    this.notes = (line.notes ?? []).map((note, index) => this.noteEntry(note, index, tempo));
    this.minSpeed = this.notes.reduce((minimum, entry) => Math.min(minimum, Math.abs(entry.note.speed ?? 1) || 1), 1);
    this.hitTimes = [...this.notes].sort((left, right) => left.start - right.start);
    this.holdIndex = new IntervalIndex(this.notes.filter(entry => entry.note.type === 2), entry => entry.start, entry => entry.end);
    this.staticNotes = this.notes.filter(entry => (entry.note.speed ?? 1) === 0);
    this.staticIndex = new IntervalIndex(this.staticNotes, entry => entry.start - (entry.note.visibleTime ?? 999999), entry => entry.end);
    this.index = new IntervalIndex(this.notes.filter(entry => (entry.note.speed ?? 1) !== 0), entry => Math.min(entry.floor, entry.tail), entry => Math.max(entry.floor, entry.tail));
    this.hasYControl = line.yControl?.length > 1 && line.yControl.some(point => point.y !== 1);
  }

  floor(seconds) { return this.speeds.reduce((sum, speed) => sum + speed.distance(seconds), 0); }
  noteEntry(note, index, tempo) {
    const factor = this.line.bpmfactor ?? 1, start = tempo.seconds(note.startTime, factor), end = tempo.seconds(note.endTime, factor);
    const startFloor = this.floor(start), endFloor = this.floor(end), offset = note.yOffset ?? 0;
    return { note, index, start, end, startFloor, endFloor, floor: startFloor + offset, tail: endFloor + offset };
  }
  value(type, seconds) { return this.tracks[type].reduce((sum, track) => sum + Number(track.value(seconds)), 0); }

  state(seconds) {
    return { x: this.value('moveXEvents', seconds), y: this.value('moveYEvents', seconds),
      rotation: this.value('rotateEvents', seconds), alpha: this.value('alphaEvents', seconds),
      scaleX: this.extended.scaleXEvents.value(seconds), scaleY: this.extended.scaleYEvents.value(seconds),
      color: this.extended.colorEvents.value(seconds), text: this.extended.textEvents.value(seconds),
      incline: this.extended.inclineEvents.value(seconds), floor: this.floor(seconds) };
  }

  visibleNotes(seconds, state, radius = 1600) {
    if (state.alpha < 0) return [];
    const range = radius / this.minSpeed;
    const entries = this.hasYControl ? this.notes : [...this.index.query(state.floor - range, state.floor + range).map(entry => entry.item), ...this.staticIndex.query(seconds, seconds).sort((a, b) => a.index - b.index).map(entry => entry.item)];
    return entries.filter(entry => {
      if (entry.end < seconds || entry.start - seconds > (entry.note.visibleTime ?? 999999)) return false;
      if (this.line.isCover === 1 && (entry.note.speed ?? 1) !== 0 && (entry.note.type === 2 ? entry.tail : entry.floor) < state.floor) return false;
      return true;
    });
  }

  noteState(entry, state, seconds) {
    const note = entry.note;
    const activeHold = note.type === 2 && entry.start <= seconds;
    const offset = note.yOffset ?? 0;
    // Subtract cumulative floors before adding the local offset. Adding it to a
    // large floor first creates tiny false Hold lengths with alternating signs.
    const distance = activeHold ? offset : entry.startFloor - state.floor + offset;
    const speed = note.speed ?? 1;
    const side = noteIsAbove(note) ? 1 : -1;
    const isHold = note.type === 2;
    const sizeY = isHold ? 1 : this.controls.size.value(distance);
    let horizontal = note.positionX * (isHold ? 1 : this.controls.pos.value(distance));
    const vertical = distance * speed * side * (isHold ? 1 : this.controls.y.value(distance));
    if (!isHold && Math.abs(state.incline) > 0.01) horizontal -= Math.tan(note.positionX / 675 * state.incline * Math.PI / 180) * distance * speed * side;
    return { x: horizontal, y: vertical, tail: (entry.endFloor - state.floor + offset) * speed * side,
      size: (note.size ?? 1) * sizeY, sizeY,
      alpha: (note.alpha ?? 255) / 255 * this.controls.alpha.value(distance),
      skew: isHold ? 0 : note.positionX * this.controls.skew.value(distance), showHead: !activeHold };
  }
}

export class SceneRuntime {
  constructor() { this.cache = new WeakMap(); }

  compile(chart, tempo) {
    if (this.chart === chart && this.tempo === tempo) return;
    if (this.tempo !== tempo) { this.cache = new WeakMap(); this.tempo = tempo; }
    this.chart = chart;
    this.lines = (chart.judgeLineList ?? []).map(line => {
      if (!this.cache.has(line)) this.cache.set(line, new LineRuntime(line, tempo));
      return this.cache.get(line);
    });
    this.order = this.lines.map((line, index) => index).sort((left, right) => Number(this.lines[left].line.zOrder ?? 0) - Number(this.lines[right].line.zOrder ?? 0) || left - right);
  }

  sampler(seconds, positionScale = { x: 1, y: 1 }) {
    const states = [];
    const done = new Set();
    const resolving = new Set();
    const resolve = index => {
      if (done.has(index)) return true;
      if (resolving.has(index)) return false;
      resolving.add(index);
      states[index] = this.lines[index].state(seconds);
      // Adapt local movement before resolving the parent's rotation. Callers that
      // analyse or export chart coordinates keep the unadapted default space.
      states[index].x *= positionScale.x;
      states[index].y *= positionScale.y;
      const line = this.lines[index].line;
      const parent = line.father === null || line.father === undefined || line.father === '' ? -1 : (Number.isInteger(line.father) ? line.father : Number(line.father));
      if (Number.isInteger(parent) && parent >= 0 && parent < this.lines.length) {
        if (!resolve(parent)) { resolving.delete(index); done.add(index); return false; }
        const ancestor = states[parent];
        const local = states[index];
        const angle = -ancestor.rotation * Math.PI / 180;
        const x = local.x, y = local.y, cosine = Math.cos(angle), sine = Math.sin(angle);
        local.x = ancestor.x + x * cosine - y * sine;
        local.y = ancestor.y + x * sine + y * cosine;
        local.rotation += line.rotateWithFather === undefined ? ((this.chart.META.RPEVersion ?? 0) >= 163 ? ancestor.rotation : 0) : (line.rotateWithFather ? ancestor.rotation : 0);
      }
      resolving.delete(index);
      done.add(index);
      return true;
    };
    return index => { if (!this.lines[index]) return undefined; resolve(index); return states[index]; };
  }

  sample(seconds, positionScale) {
    const sample = this.sampler(seconds, positionScale);
    return this.lines.map((runtime, index) => sample(index));
  }
}
