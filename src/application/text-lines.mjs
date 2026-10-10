import { assertChart, createEvent, createNote } from '../core/chart.mjs';
import { beatValue } from '../core/beat.mjs';
import { TempoMap } from '../core/tempo.mjs';
import { SceneRuntime } from '../core/scene.mjs';
import { EventTrack } from '../core/events.mjs';

const parentIndex = line => line.father === '' || line.father == null ? -1 : Number(line.father);

function localTime(seconds, tempo, factor, exactBeat) {
  if (factor === 1 && exactBeat) return [...exactBeat];
  const value = tempo.beat(seconds, factor); const whole = Math.floor(value);
  const time = [whole, Math.floor((value - whole) * 1000000000), 1000000000];
  while (tempo.seconds(time, factor) > seconds) time[1]--;
  return time;
}

function insertStep(events, time, value, tempo, factor, replace, track = new EventTrack(events, tempo, factor)) {
  const beat = beatValue(time);
  const seconds = tempo.seconds(beat, factor);
  const output = [];
  for (const event of events) {
    const start = beatValue(event.startTime); const end = beatValue(event.endTime);
    if (start <= beat && end > beat || start === beat) {
      if (!replace) throw new Error('生成时刻已有位移或旋转事件，请勾选替换或选择空白时刻');
      if (start < beat) {
        if (event.trajectory || event.bezier) throw new Error('生成时刻穿过整体轨迹或 Bezier 事件，请先拆分或另选时刻');
        const progress = (seconds - tempo.seconds(event.startTime, factor)) / (tempo.seconds(event.endTime, factor) - tempo.seconds(event.startTime, factor));
        output.push({ ...event, endTime: [...time], end: track.sample({ event, start: tempo.seconds(event.startTime, factor), end: tempo.seconds(event.endTime, factor) }, seconds), easingRight: (event.easingLeft ?? 0) + ((event.easingRight ?? 1) - (event.easingLeft ?? 0)) * progress });
      }
    } else output.push(event);
  }
  if (!output.some(event => beatValue(event.startTime) < beat)) output.push({ ...createEvent(track.value(seconds - 0.000001), undefined, Math.min(-1000000, beat - 1), beat), endTime: [...time] });
  output.push({ ...createEvent(value, value, 0, 0), startTime: [...time], endTime: [...time] });
  return output.sort((first, second) => beatValue(first.startTime) - beatValue(second.startTime));
}

export function textLinesChart(chart, { strokes, indices, beat, beatTime, size, noteType = 4, addNotes = false, replace = false, preview = false }) {
  if (![4, 1, 3].includes(noteType)) throw new Error('拼字音符类型须为 Drag、Tap 或 Flick');
  if (!strokes.length || strokes.length > indices.length || new Set(indices).size !== indices.length || !Number.isFinite(beat) || !Number.isFinite(size) || size <= 0) throw new Error('拼字参数或可用线数无效');
  if (strokes.some(stroke => ![stroke.x, stroke.y, stroke.angle].every(Number.isFinite))) throw new Error('笔画坐标或角度无效');
  if (beatTime && beatValue(beatTime) !== beat) throw new Error('目标拍数不一致');
  if (indices.some(index => !Number.isInteger(index) || !chart.judgeLineList[index])) throw new Error('参与线号超出范围');
  const tempo = new TempoMap(chart.BPMList); const seconds = tempo.seconds(beat);
  const scene = new SceneRuntime(); scene.compile(chart, tempo); const states = scene.sample(seconds);
  const desired = new Map(strokes.map((stroke, index) => [indices[index], { x: stroke.x, y: stroke.y, rotation: stroke.angle * 180 / Math.PI }]));
  for (const [index] of desired) {
    const seen = new Set([index]); let parent = parentIndex(chart.judgeLineList[index]);
    while (parent !== -1) { if (!Number.isInteger(parent) || !chart.judgeLineList[parent] || seen.has(parent)) throw new Error('参与判定线存在无效父线或循环父线'); seen.add(parent); parent = parentIndex(chart.judgeLineList[parent]); }
  }
  const resolved = new Map();
  const parentState = index => {
    if (resolved.has(index)) return resolved.get(index);
    if (desired.has(index)) return desired.get(index);
    const line = chart.judgeLineList[index]; const local = scene.lines[index].state(seconds); const parent = parentIndex(line);
    if (parent >= 0) {
      const ancestor = parentState(parent); const angle = -ancestor.rotation * Math.PI / 180;
      const state = { x: ancestor.x + local.x * Math.cos(angle) - local.y * Math.sin(angle), y: ancestor.y + local.x * Math.sin(angle) + local.y * Math.cos(angle), rotation: local.rotation + ((line.rotateWithFather ?? ((chart.META.RPEVersion ?? 0) >= 163)) ? ancestor.rotation : 0) }; resolved.set(index, state); return state;
    }
    return states[index];
  };
  const lines = chart.judgeLineList.map((line, index) => {
    if (!desired.has(index)) return line;
    if (line.attachUI) throw new Error(`线 ${index} 绑定了游戏 UI，不能用于音符拼字`);
    if (line.eventLayers?.some(layer => layer?.moveXEvents?.some(event => event.trajectory && tempo.seconds(event.startTime, line.bpmfactor ?? 1) <= seconds && tempo.seconds(event.endTime, line.bpmfactor ?? 1) >= seconds))) throw new Error(`线 ${index} 正处于整体轨迹，请另选时刻或先拆分`);
    let target = desired.get(index); const parent = parentIndex(line);
    if (parent >= 0) {
      const ancestor = parentState(parent); const angle = ancestor.rotation * Math.PI / 180; const horizontal = target.x - ancestor.x; const vertical = target.y - ancestor.y;
      target = { x: horizontal * Math.cos(angle) - vertical * Math.sin(angle), y: horizontal * Math.sin(angle) + vertical * Math.cos(angle), rotation: target.rotation - ((line.rotateWithFather ?? ((chart.META.RPEVersion ?? 0) >= 163)) ? ancestor.rotation : 0) };
    }
    const layers = [...(line.eventLayers ?? [])]; const layer = { ...(layers[0] ?? {}) }; const factor = line.bpmfactor ?? 1; const time = localTime(seconds, tempo, factor, beatTime);
    for (const [type, key] of [['moveXEvents', 'x'], ['moveYEvents', 'y'], ['rotateEvents', 'rotation']]) {
      const others = scene.lines[index].tracks[type].slice(1).reduce((sum, track) => sum + Number(track.value(seconds)), 0);
      layer[type] = insertStep(layer[type] ?? [], time, target[key] - others, tempo, factor, replace, scene.lines[index].tracks[type][0]);
    }
    layers[0] = layer;
    let notes = line.notes ?? [];
    if (addNotes || preview) {
      const note = { ...createNote(noteType, tempo.beat(seconds + 1, factor), 0), speed: 0, size, isFake: 1, visibleTime: 999999, yOffset: 0 };
      notes = preview ? [note] : [...notes, note];
    }
    return { ...line, eventLayers: layers, notes, numOfNotes: notes.length };
  });
  const next = { ...chart, judgeLineList: lines }; assertChart(next); return next;
}
