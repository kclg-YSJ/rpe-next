import { beatValue, fromNumber } from './beat.ts';
import { integerChartAlpha } from './alpha-values.ts';
import { TempoMap } from './tempo.ts';
import { sampleCurveTrajectory } from './curve-trajectory.ts';
import { trajectorySplitSettings } from './trajectory-simplify.ts';
import { validateNoiseAreas, diagnoseNoiseAreas, normalizeNoiseAreas, NOISE_VERSION } from './noise-areas.ts';
import { validateNoiseLayers, NOISE_LAYER_VERSION } from './noise-skin.mjs';
import type { AnyEventType, Beat, Chart, ChartEvent, ChartMeta, ControlPoint, EventLayer, EventType, EventValue, ExtendedType, JudgeLine, NoiseArea, Note, NoteType } from './types.ts';

export const EVENT_TYPES = ['moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents', 'speedEvents'] as const satisfies readonly EventType[];
export const EXTENDED_TYPES = ['scaleXEvents', 'scaleYEvents', 'colorEvents', 'paintEvents', 'textEvents', 'inclineEvents', 'gifEvents'] as const satisfies readonly ExtendedType[];
export const NOTE_NAMES: Record<number, string> = { 1: 'Tap', 2: 'Hold', 3: 'Flick', 4: 'Drag' };

/** Severity buckets the diagnostics panel renders as separate groups. */
export type IssueSeverity = 'error' | 'warning' | 'info';

/**
 * One finding from {@link diagnose}.
 *
 * Indexed, so the reporter helpers may attach optional locators (`layer`, `extended`, `line`) only
 * for the findings that have them rather than every finding carrying every field.
 */
export interface DiagnosticIssue {
  severity: IssueSeverity;
  message: string;
  path: string;
  beat: number;
  index?: number;
  line?: number;
  layer?: number;
  extended?: boolean;
  /** The noise area a 噪域 finding belongs to; present only on findings from `diagnoseNoiseAreas`. */
  noiseArea?: number;
  /** The noise track within that area, or absent when the finding is about the area itself. */
  noiseTrack?: string;
  [key: string]: unknown;
}

/**
 * An event as it arrives from a parsed document.
 *
 * Fields stay optional because {@link assertChart} reads them before validating them; `start`/`end`
 * hold the loosely typed payload ({@link EventValue}) so colour and text tracks can be checked.
 */
interface RawEvent {
  startTime?: unknown;
  endTime?: unknown;
  start?: EventValue;
  end?: EventValue;
  bezier?: unknown;
  bezierPoints?: unknown;
  easingLeft?: number;
  easingRight?: number;
  [key: string]: unknown;
}

/**
 * A note as it arrives from a parsed document; every field is validated by {@link assertChart}, so
 * all of them stay optional here even though {@link Note} requires some.
 */
interface RawNote {
  type?: number;
  startTime?: unknown;
  endTime?: unknown;
  positionX?: number;
  speed?: number;
  size?: number;
  alpha?: number;
  yOffset?: number;
  visibleTime?: number;
  [key: string]: unknown;
}

/**
 * A judge line as it arrives from a parsed document.
 *
 * `eventLayers` admits null entries because real charts carry them (the round-trip test in
 * `test/core.test.ts` pushes one), and `notes` reuse the validation-only shape above.
 */
interface RawLine {
  notes?: RawNote[];
  eventLayers?: (EventLayer | null | undefined)[];
  extended?: EventLayer | null;
  bpmfactor?: number;
  father?: number;
  [key: string]: unknown;
}

/** The control-curve arrays {@link assertChart} checks, paired with the property each point carries. */
const CONTROL_CURVES: Record<string, string> = { alphaControl: 'alpha', posControl: 'pos', sizeControl: 'size', skewControl: 'skew', yControl: 'y' };

export function createEvent(start: EventValue = 0, end: EventValue = start, startBeat = 0, endBeat = startBeat + 1): ChartEvent {
  return { startTime: fromNumber(startBeat), endTime: fromNumber(endBeat), start, end, easingType: 1,
    easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 };
}

export function createLine(name = '判定线'): JudgeLine {
  const layer: EventLayer = Object.fromEntries(EVENT_TYPES.map(type => [type, [createEvent(type === 'alphaEvents' ? 255 : type === 'speedEvents' ? 10 : 0, undefined, 0, 1)]]));
  return { Name: name, Group: 0, Texture: 'line.png', bpmfactor: 1, father: -1, rotateWithFather: true,
    isCover: 1, zOrder: 0, anchor: [0.5, 0.5], isGif: false, eventLayers: [layer], extended: {}, notes: [], numOfNotes: 0 };
}

export function createChart(): Chart {
  return { META: { RPEVersion: 170, name: '未命名谱面', composer: '', charter: '', illustration: '', level: '', song: '', background: '', offset: 0 },
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }], judgeLineGroup: ['Default'], judgeLineList: [createLine('Line 1')], blockAreaList: [] };
}

export function createNote(type: NoteType, beat: number, positionX: number, endBeat = beat + 1): Note {
  return { type, startTime: fromNumber(beat), endTime: fromNumber(type === 2 ? endBeat : beat), positionX,
    above: 1, isFake: 0, speed: 1, size: 1, yOffset: 0, visibleTime: 999999, alpha: 255 };
}

export function parseChart(text: string): Chart {
  // `JSON.parse` can produce anything, so the document stays `unknown` until `assertChart` proves
  // it; a wrong `JSON.parse` argument type is still a caller bug and stays a type error.
  let chart: unknown;
  try { chart = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('无效的 RPE JSON 文档'); }
  // Still unvalidated here, so the 噪域 list is normalised through a record view: only its presence is
  // tested before `assertChart` and `normalizeNoiseAreas` do the real checking.
  const document = chart as { blockAreaList?: unknown };
  if (document.blockAreaList != null) document.blockAreaList = normalizeNoiseAreas(document.blockAreaList as NoiseArea[]);
  assertChart(chart);
  return integerChartAlpha(chart);
}

export function noteIsAbove(note: Note): boolean {
  return Number(note.above ?? 1) === 1;
}

export function serializeChart(chart: Chart, { compact = false }: { compact?: boolean } = {}): string {
  assertChart(chart);
  chart = integerChartAlpha(chart);
  // Areas carry the version that introduced them, so a chart that uses them records the bump even if
  // its own `META.RPEVersion` was written by an older build. Layered noise areas are a later feature
  // still, so they record the higher layer version instead.
  const snapshot = chart.blockAreaList?.length || chart.noiseAreaLayers ? { ...chart, META: { ...chart.META, RPEVersion: Math.max(chart.META.RPEVersion ?? 0, chart.noiseAreaLayers ? NOISE_LAYER_VERSION : NOISE_VERSION) } } : chart;
  return stringifyPreservingNumbers(snapshot, compact ? 0 : 2) + (compact ? '' : '\n');
}

export function stringifyPreservingNumbers(value: unknown, space: number | string = 2): string {
  const ordinary = JSON.stringify(value, null, space);
  let marker = '\u0000rpe-negative-zero\u0000';
  while (ordinary.includes(JSON.stringify(marker))) marker += '#';
  return JSON.stringify(value, (key, entry) => Object.is(entry, -0) ? marker : entry, space).replaceAll(JSON.stringify(marker), '-0');
}

export function assertChart(chart: unknown): asserts chart is Chart {
  // The document is untrusted JSON, so no branch below can be proved statically and the object is
  // never asserted into a shape before it has been checked. The accessors narrow one member at a
  // time; `RawLine`/`RawNote`/`RawEvent` are the validation-only views of the shared domain types.
  if (!chart || typeof chart !== 'object') throw new Error('缺少 META：不是 RPE 谱面');
  // An unvalidated view of the document: member lookups stay `unknown` until each is checked, so
  // nothing below can accidentally assume a shape that has not been verified yet.
  const document = chart as Record<string, unknown>;
  const meta = document.META;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('缺少 META：不是 RPE 谱面');
  const metaInfo = meta as ChartMeta;
  const lines: unknown = document.judgeLineList;
  if (lines != null && !Array.isArray(lines)) throw new Error('judgeLineList 必须为数组');
  new TempoMap(document.BPMList as Chart['BPMList']);
  if (metaInfo.offset !== undefined && !Number.isFinite(metaInfo.offset)) throw new Error('META.offset 必须为毫秒数');
  // Areas and their options are validated from the raw document, before anything is asserted, so a
  // malformed list is reported by name rather than surfacing later as a rendering failure.
  if (document.blockAreaList != null) validateNoiseAreas(document.blockAreaList as Parameters<typeof validateNoiseAreas>[0]);
  // Layered noise areas are validated by the skin module, which owns their shape.
  validateNoiseLayers(document);
  if (document.noiseAreaOptions !== undefined) {
    const options = document.noiseAreaOptions;
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('noiseAreaOptions 必须为对象');
    const bag = options as Record<string, unknown>;
    for (const key of ['ignoreTripleInversion']) if (bag[key] !== undefined && typeof bag[key] !== 'boolean') throw new Error('noiseAreaOptions.' + key + ' 必须为布尔值');
  }
  (lines ?? []).forEach((line, lineIndex) => {
    const path = `judgeLineList[${lineIndex}]`;
    if (!line || typeof line !== 'object') throw new Error(`${path}: 无效判定线`);
    const record = line as Record<string, unknown>;
    const bpmfactor = record.bpmfactor;
    if (bpmfactor !== undefined && (typeof bpmfactor !== 'number' || !Number.isFinite(bpmfactor) || bpmfactor <= 0)) throw new Error(`${path}.bpmfactor 必须大于零`);
    const notes: unknown = record.notes;
    if (notes != null && !Array.isArray(notes)) throw new Error(`${path}.notes 必须为数组`);
    for (const [index, note] of (notes ?? []).entries()) {
      if (!note || typeof note !== 'object') throw new Error(`${path}.notes[${index}]: 无效音符`);
      beatValue(note.startTime, `${path}.notes[${index}].startTime`);
      beatValue(note.endTime, `${path}.notes[${index}].endTime`);
      if (!NOTE_NAMES[note.type] || !Number.isFinite(note.positionX)) throw new Error(`${path}.notes[${index}]: 非法类型或坐标`);
      for (const property of ['speed', 'size', 'alpha', 'yOffset', 'visibleTime'] as const) {
        if (note[property] !== undefined && !Number.isFinite(note[property])) throw new Error(`${path}.notes[${index}].${property} 必须为有限数字`);
      }
    }
    const eventLayers: unknown = record.eventLayers;
    if (eventLayers != null && !Array.isArray(eventLayers)) throw new Error(`${path}.eventLayers 必须为数组`);
    const extended = record.extended;
    for (const layer of [...(eventLayers ?? []), extended]) {
      if (!layer) continue;
      for (const type of [...EVENT_TYPES, ...EXTENDED_TYPES]) {
        const track = layer[type];
        if (track != null && !Array.isArray(track)) throw new Error(`${path}.${type} 必须为数组`);
        for (const [index, event] of (track ?? []).entries()) {
          // A whole-curve trajectory is validated through the same sampler and split rules the editor
          // uses, so a hand-edited file cannot smuggle in an expression that only fails at draw time.
          if (event?.trajectory) {
            if (type !== 'moveXEvents' || event.trajectory.version !== 1) throw new Error('整体轨迹必须位于 X 轨道，且使用受支持的版本');
            sampleCurveTrajectory(event.trajectory.options, 65);
            trajectorySplitSettings(event.trajectory.split);
            if (!Number.isInteger(event.trajectory.segments) || event.trajectory.segments < 4 || event.trajectory.segments > 8192) throw new Error('轨迹拆分段数无效');
          }
          beatValue(event?.startTime, `${path}.${type}[${index}].startTime`);
          beatValue(event?.endTime, `${path}.${type}[${index}].endTime`);
          const validValue = (value: unknown): boolean => type === 'textEvents' ? typeof value === 'string' : type === 'colorEvents' ? Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) : Number.isFinite(value);
          if (type !== 'paintEvents' && (!validValue(event.start) || !validValue(event.end))) throw new Error(`${path}.${type}[${index}]: 无效事件起始/结束值`);
          for (const property of ['easingLeft', 'easingRight'] as const) {
            if (event[property] !== undefined && !Number.isFinite(event[property])) throw new Error(`${path}.${type}[${index}].${property} 必须为有限数字`);
          }
          if (event.bezier && (!Array.isArray(event.bezierPoints) || event.bezierPoints.length !== 4 || !event.bezierPoints.every(Number.isFinite))) throw new Error(`${path}.${type}[${index}].bezierPoints 必须为四个有限数字`);
        }
      }
    }
    for (const [name, property] of Object.entries(CONTROL_CURVES)) {
      const control = (line as Record<string, unknown>)[name];
      if (control == null) continue;
      if (!Array.isArray(control)) throw new Error(`${path}.${name} 必须为数组`);
      for (const [index, point] of (control as ControlPoint[]).entries()) {
        if (!Number.isFinite(point?.x) || !Number.isFinite(point?.[property])) throw new Error(`${path}.${name}[${index}]: 无效控制点`);
      }
    }
  });
}

export function diagnose(chart: Chart): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];
  const addIssue = (issue: { line: number; beat: number; path: string; message: string; index?: number; layer?: number; extended?: boolean }, severity: IssueSeverity = 'warning'): void => { issues.push({ severity, ...issue }); };
  // Area findings come first because they are reported by the same panel and are indexed by area
  // rather than by line; their `DiagnosticIssue` members are already in the shared shape.
  issues.push(...diagnoseNoiseAreas(chart.blockAreaList ?? []) as DiagnosticIssue[]);
  const bpmBeats = new Set<number>();
  for (const [index, entry] of chart.BPMList.entries()) {
    const beat = beatValue(entry.startTime);
    if (bpmBeats.has(beat)) addIssue({ line: 0, beat, index, path: `BPMList[${index}]`, message: '同拍重复 BPM，运行时采用文件中最后一项；原数据保留' }, 'info');
    bpmBeats.add(beat);
  }
  for (const [lineIndex, line] of (chart.judgeLineList ?? []).entries()) {
    // One bit per note category (tap/hold vs drag) so a tap over a hold is reported while two taps
    // at the same spot still only warn once. Fakes are skipped: they overlap by design.
    const seen = new Map<string, number>();
    for (const [index, note] of (line.notes ?? []).entries()) {
      const beat = beatValue(note.startTime);
      const report = (message: string, severity: IssueSeverity = 'error'): void => addIssue({ line: lineIndex, beat, index, path: `notes[${index}]`, message }, severity);
      if (beatValue(note.endTime) < beat) report('结束拍早于开始拍');
      if (note.type === 2 && beatValue(note.endTime) === beat) report('Hold 时长为零');
      if (Math.abs(note.positionX) > 675) report('音符超出标准横向范围', 'warning');
      if (note.isFake === true || Number(note.isFake) === 1) continue;
      const type = Number(note.type);
      const category = type === 1 || type === 2 ? 1 : type === 3 ? 2 : 0;
      if (!category) continue;
      const key = `${beat}:${note.positionX}:${noteIsAbove(note)}`;
      const previous = seen.get(key) ?? 0;
      if (previous & category) report('同位置同时音符重叠', 'warning');
      seen.set(key, previous | category);
    }
    const inspectEvents = (layer: EventLayer | null | undefined, layerIndex: number, extended: boolean): void => {
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
    const visited = new Set<number>([lineIndex]);
    let parent: number = line.father ?? -1;
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

export function previewLimitations(chart: Chart): string[] {
  const features = new Set<string>();
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

/** Kept for readers of the validation shapes above: the index signature `Chart` relies on. */
export type { AnyEventType, Beat, ChartEvent, ControlPoint, EventLayer, JudgeLine, Note };
