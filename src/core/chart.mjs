import { beatValue, fromNumber } from './beat.mjs';
import { TempoMap } from './tempo.mjs';
import { sampleCurveTrajectory } from './curve-trajectory.mjs';
import { trajectorySplitSettings } from './trajectory-simplify.mjs';
import { assertNoiseAreas } from './noise-domain.mjs';

export const EVENT_TYPES = ['moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents', 'speedEvents'];
export const EXTENDED_TYPES = ['scaleXEvents', 'scaleYEvents', 'colorEvents', 'paintEvents', 'textEvents', 'inclineEvents', 'gifEvents'];
export const NOTE_NAMES = { 1: 'Tap', 2: 'Hold', 3: 'Flick', 4: 'Drag' };

export function createEvent(start = 0, end = start, startBeat = 0, endBeat = startBeat + 1) {
  return { startTime: fromNumber(startBeat), endTime: fromNumber(endBeat), start, end, easingType: 1,
    easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 };
}

export function createLine(name = '判定线') {
  const layer = Object.fromEntries(EVENT_TYPES.map(type => [type, [createEvent(type === 'alphaEvents' ? 255 : type === 'speedEvents' ? 10 : 0, undefined, 0, 1)]]));
  return { Name: name, Group: 0, Texture: 'line.png', bpmfactor: 1, father: -1, rotateWithFather: true,
    isCover: 1, zOrder: 0, anchor: [0.5, 0.5], isGif: false, eventLayers: [layer], extended: {}, notes: [], numOfNotes: 0 };
}

export function createChart() {
  return { META: { RPEVersion: 170, name: '未命名谱面', composer: '', charter: '', illustration: '', level: '', song: '', background: '', offset: 0 },
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }], judgeLineGroup: ['Default'], judgeLineList: [createLine('Line 1')], blockAreaList: [] };
}

export function createNote(type, beat, positionX, endBeat = beat + 1) {
  return { type, startTime: fromNumber(beat), endTime: fromNumber(type === 2 ? endBeat : beat), positionX,
    above: 1, isFake: 0, speed: 1, size: 1, yOffset: 0, visibleTime: 999999, alpha: 255 };
}

export function parseChart(text) {
  let chart;
  try { chart = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('无效的 RPE JSON 文档'); }
  assertChart(chart);
  return chart;
}

export function noteIsAbove(note) {
  return Number(note.above ?? 1) === 1;
}

export function serializeChart(chart) {
  assertChart(chart);
  return stringifyPreservingNumbers(chart) + '\n';
}

export function stringifyPreservingNumbers(value) {
  const ordinary = JSON.stringify(value, null, 2);
  let marker = '\u0000rpe-negative-zero\u0000';
  while (ordinary.includes(JSON.stringify(marker))) marker += '#';
  return JSON.stringify(value, (key, entry) => Object.is(entry, -0) ? marker : entry, 2).replaceAll(JSON.stringify(marker), '-0');
}

export function assertChart(chart) {
  if (!chart || typeof chart !== 'object' || !chart.META || typeof chart.META !== 'object' || Array.isArray(chart.META)) throw new Error('缺少 META：不是 RPE 谱面');
  if (chart.judgeLineList != null && !Array.isArray(chart.judgeLineList)) throw new Error('judgeLineList 必须为数组');
  new TempoMap(chart.BPMList);
  if (chart.META.offset !== undefined && !Number.isFinite(chart.META.offset)) throw new Error('META.offset 必须为毫秒数');
  assertNoiseAreas(chart);
  (chart.judgeLineList ?? []).forEach((line, lineIndex) => {
    const path = `judgeLineList[${lineIndex}]`;
    if (!line || typeof line !== 'object') throw new Error(`${path}: 无效判定线`);
    if (line.bpmfactor !== undefined && (!Number.isFinite(line.bpmfactor) || line.bpmfactor <= 0)) throw new Error(`${path}.bpmfactor 必须大于零`);
    if (line.notes != null && !Array.isArray(line.notes)) throw new Error(`${path}.notes 必须为数组`);
    for (const [index, note] of (line.notes ?? []).entries()) {
      if (!note || typeof note !== 'object') throw new Error(`${path}.notes[${index}]: 无效音符`);
      beatValue(note.startTime, `${path}.notes[${index}].startTime`);
      beatValue(note.endTime, `${path}.notes[${index}].endTime`);
      if (!NOTE_NAMES[note.type] || !Number.isFinite(note.positionX)) throw new Error(`${path}.notes[${index}]: 非法类型或坐标`);
      for (const property of ['speed', 'size', 'alpha', 'yOffset', 'visibleTime']) {
        if (note[property] !== undefined && !Number.isFinite(note[property])) throw new Error(`${path}.notes[${index}].${property} 必须为有限数字`);
      }
    }
    if (line.eventLayers != null && !Array.isArray(line.eventLayers)) throw new Error(`${path}.eventLayers 必须为数组`);
    for (const layer of [...(line.eventLayers ?? []), line.extended]) {
      if (!layer) continue;
      for (const type of [...EVENT_TYPES, ...EXTENDED_TYPES]) {
        if (layer[type] != null && !Array.isArray(layer[type])) throw new Error(`${path}.${type} 必须为数组`);
        for (const [index, event] of (layer[type] ?? []).entries()) {
          if (event?.trajectory) {
            if (type !== 'moveXEvents' || event.trajectory.version !== 1) throw new Error('整体轨迹必须位于 X 轨道，且使用受支持的版本');
            sampleCurveTrajectory(event.trajectory.options, 65);
            trajectorySplitSettings(event.trajectory.split);
            if (!Number.isInteger(event.trajectory.segments) || event.trajectory.segments < 4 || event.trajectory.segments > 8192) throw new Error('轨迹拆分段数无效');
          }
          beatValue(event?.startTime, `${path}.${type}[${index}].startTime`);
          beatValue(event?.endTime, `${path}.${type}[${index}].endTime`);
          const validValue = value => type === 'textEvents' ? typeof value === 'string' : type === 'colorEvents' ? Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) : Number.isFinite(value);
          if (type !== 'paintEvents' && (!validValue(event.start) || !validValue(event.end))) throw new Error(`${path}.${type}[${index}]: 无效事件起始/结束值`);
          for (const property of ['easingLeft', 'easingRight']) {
            if (event[property] !== undefined && !Number.isFinite(event[property])) throw new Error(`${path}.${type}[${index}].${property} 必须为有限数字`);
          }
          if (event.bezier && (!Array.isArray(event.bezierPoints) || event.bezierPoints.length !== 4 || !event.bezierPoints.every(Number.isFinite))) throw new Error(`${path}.${type}[${index}].bezierPoints 必须为四个有限数字`);
        }
      }
    }
    for (const [name, property] of Object.entries({ alphaControl: 'alpha', posControl: 'pos', sizeControl: 'size', skewControl: 'skew', yControl: 'y' })) {
      if (line[name] == null) continue;
      if (!Array.isArray(line[name])) throw new Error(`${path}.${name} 必须为数组`);
      for (const [index, point] of line[name].entries()) {
        if (!Number.isFinite(point?.x) || !Number.isFinite(point?.[property])) throw new Error(`${path}.${name}[${index}]: 无效控制点`);
      }
    }
  });
}

export function diagnose(chart) {
  const issues = [];
  const addIssue = (issue, severity = 'warning') => issues.push({ severity, ...issue });
  const bpmBeats = new Set();
  for (const [index, entry] of chart.BPMList.entries()) {
    const beat = beatValue(entry.startTime);
    if (bpmBeats.has(beat)) addIssue({ line: 0, beat, index, path: `BPMList[${index}]`, message: '同拍重复 BPM，运行时采用文件中最后一项；原数据保留' }, 'info');
    bpmBeats.add(beat);
  }
  for (const [lineIndex, line] of (chart.judgeLineList ?? []).entries()) {
    const seen = new Set();
    for (const [index, note] of (line.notes ?? []).entries()) {
      const beat = beatValue(note.startTime);
      const report = (message, severity = 'error') => addIssue({ line: lineIndex, beat, index, path: `notes[${index}]`, message }, severity);
      if (beatValue(note.endTime) < beat) report('结束拍早于开始拍');
      if (note.type === 2 && beatValue(note.endTime) === beat) report('Hold 时长为零');
      if (Math.abs(note.positionX) > 675) report('音符超出标准横向范围', 'warning');
      const key = `${beat}:${note.positionX}:${noteIsAbove(note)}`;
      if (seen.has(key)) report('同位置同时音符重叠', 'warning');
      seen.add(key);
    }
    const inspectEvents = (layer, layerIndex, extended) => {
      for (const type of [...EVENT_TYPES, ...EXTENDED_TYPES]) {
        if (type === 'paintEvents') continue;
        const events = layer?.[type] ?? [];
        if (!Array.isArray(events)) continue;
        const ordered = events.map((event, index) => ({ event, index })).sort((left, right) => beatValue(left.event.startTime) - beatValue(right.event.startTime));
        for (let position = 1; position < ordered.length; position++) {
          const previous = ordered[position - 1]; const current = ordered[position];
          if (beatValue(current.event.startTime) < beatValue(previous.event.endTime)) {
            addIssue({ line: lineIndex, beat: beatValue(current.event.startTime), index: current.index, layer: layerIndex, extended, path: `${type}[${current.index}]`, message: `${type} 事件时间重叠` }, 'error');
          }
        }
      }
    };
    for (const [layerIndex, layer] of (line.eventLayers ?? []).entries()) inspectEvents(layer, layerIndex, false);
    inspectEvents(line.extended, -1, true);
    const visited = new Set([lineIndex]);
    let parent = line.father ?? -1;
    while (parent !== -1) {
      if (!Number.isInteger(parent) || !chart.judgeLineList[parent] || visited.has(parent)) {
        addIssue({ line: lineIndex, beat: 0, path: 'father', message: '父线无效或循环引用' }, 'error');
        break;
      }
      visited.add(parent);
      parent = chart.judgeLineList[parent].father ?? -1;
    }
  }
  return issues;
}

export function previewLimitations(chart) {
  const features = new Set();
  if ((chart.META.RPEVersion ?? 0) < 100) features.add('旧版事件语义');
  for (const line of chart.judgeLineList ?? []) {
    if (line.Texture && line.Texture !== 'line.png') features.add('纹理颜色混合');
    if (line.isGif) features.add('GIF');
    if (line.attachUI && !['pause', 'combonumber', 'combo', 'score', 'bar', 'name', 'level'].includes(line.attachUI)) features.add(`未知 UI 绑定 ${line.attachUI}`);
    if (line.extended?.gifEvents?.length) features.add('GIF 进度');
    if (line.extended?.textEvents?.some(event => event.font)) features.add('自定义字体');
    if (line.notes?.some(note => Array.isArray(note.color))) features.add('音符贴图颜色混合');
  }
  return [...features];
}
