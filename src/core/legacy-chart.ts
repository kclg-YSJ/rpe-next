import { createChart, createLine, createNote, createEvent, assertChart } from './chart.ts';
import { beatValue } from './beat.ts';
import type { AnyEventType, Beat, Chart, Color, EventLayer, JudgeLine, NoteType } from './types.ts';

/** The legacy text command names that map onto an event track. */
type LegacyEventCommand = 'cx' | 'cy' | 'cr' | 'ca' | 'cv' | 'cw' | 'ch' | 'cc' | 'ct';

const EVENT_COMMAND_TYPES: Record<LegacyEventCommand, AnyEventType> = {
  cx: 'moveXEvents', cy: 'moveYEvents', cr: 'rotateEvents', ca: 'alphaEvents', cv: 'speedEvents',
  cw: 'scaleXEvents', ch: 'scaleYEvents', cc: 'colorEvents', ct: 'textEvents',
};

/**
 * Parses the legacy RPE "fraction text" chart format.
 *
 * Anything unrecognised is rejected rather than skipped, because silently dropping rows would
 * change the chart the user sees.
 */
export function parseLegacyChart(text: string): Chart {
  const rows = text.trim().split(/\r?\n/).map((row: string) => row.trim()).filter(Boolean);
  const offset = Number(rows.shift());
  if (!Number.isFinite(offset)) throw new Error('无效文本谱面 offset');
  const firstBpm = rows.find((row: string) => /^bp\s/.test(row));
  if (!firstBpm || firstBpm.split(/\s+/).length !== 5) throw new Error('这是传统 PEC；当前适配器支持 RPE 旧三元拍数文本格式，传统 PEC 转换待迁移');
  const chart = createChart();
  chart.META.offset = offset;
  chart.BPMList = [];
  chart.judgeLineList = [];
  chart.judgeLineGroup = [];
  chart.rpeNextLegacySource = { format: 'rpe-fraction-text', text };
  const getLine = (index: number): JudgeLine => {
    if (!Number.isInteger(index) || index < 0 || index > 10000) throw new Error('无效判定线索引');
    while (chart.judgeLineList.length <= index) {
      const line = createLine(`Line ${chart.judgeLineList.length + 1}`);
      line.eventLayers = [{}];
      chart.judgeLineList.push(line);
    }
    return chart.judgeLineList[index];
  };
  for (const [rowIndex, row] of rows.entries()) {
    try {
      const [command, ...tokens] = row.split(/\s+/);
      const values = tokens.map(Number);
      if (command === 'bp') {
        chart.BPMList.push({ startTime: values.slice(0, 3) as Beat, bpm: values[3] });
        continue;
      }
      const line = getLine(values[0]);
      if (/^n[1234]$/.test(command)) {
        const type = Number(command[1]) as NoteType;
        const startTime = values.slice(1, 4) as Beat;
        const endTime = (type === 2 ? values.slice(4, 7) : [...startTime]) as Beat;
        const propertyIndex = type === 2 ? 7 : 4;
        if (values.length !== propertyIndex + 7 || !values.every(Number.isFinite)) throw new Error('音符参数数量或数值不正确');
        const [positionX, speed, above, yOffset, isFake, size, visibleTime] = values.slice(propertyIndex);
        const note = { ...createNote(type, beatValue(startTime), positionX, beatValue(endTime)), startTime, endTime,
          speed, above: above === 1 ? 1 : 0, yOffset, isFake, size, visibleTime };
        line.notes.push(note); line.numOfNotes = line.notes.length;
      } else if (/^c[xyravwhct]$/.test(command)) {
        const startTime = values.slice(1, 4) as Beat;
        const endTime = values.slice(4, 7) as Beat;
        const type = EVENT_COMMAND_TYPES[command as LegacyEventCommand];
        // Annotated as `ChartEvent`: the spread of `createEvent()` would otherwise narrow
        // `start`/`end` to `number`, and the colour and text commands below store arrays and
        // strings in those same fields.
        const event: ReturnType<typeof createEvent> = { ...createEvent(), startTime, endTime, start: values[7], end: values[8], easingType: command === 'cv' ? 1 : values[9] };
        let layerIndex = 0;
        if (['cx', 'cy', 'cr', 'ca'].includes(command)) layerIndex = values[10] ?? 0;
        if (command === 'cv') layerIndex = values[9] ?? 0;
        if (command === 'cc') {
          // The triple is assigned through typed bindings rather than a cast, because a cast on the
          // assignment's right-hand side is not erasable syntax.
          const startColor: Color = [values[7], values[8], values[9]];
          const endColor: Color = [values[10], values[11], values[12]];
          event.start = startColor; event.end = endColor; event.easingType = values[13];
        }
        if (command === 'ct') {
          const decode = (value: string): string => value === '%N%' ? '' : value.replaceAll('%S%', ' ');
          event.easingType = values[7]; event.start = decode(tokens[8]); event.end = decode(tokens[9]);
        }
        if (!Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex > 100) throw new Error('非法事件层');
        const isExtended = ['cw', 'ch', 'cc', 'ct'].includes(command);
        if (!isExtended) while (line.eventLayers.length <= layerIndex) line.eventLayers.push({});
        const target: EventLayer = isExtended ? line.extended : line.eventLayers[layerIndex];
        (target[type] ??= []).push(event);
      } else if (command === 'li') { line.isCover = values[1]; line.Texture = tokens[2]; line.zOrder = values[3]; }
      else if (command === 'ln') { line.Group = values[1]; line.Name = tokens[2]; }
      else if (command === 'lg') chart.judgeLineGroup.push(tokens[1]);
      else if (command === 'cp') {
        // `ignoredByOriginal` is an open-ended extension bag on the legacy source; every reader
        // treats it as untrusted JSON, so it is narrowed here rather than asserted.
        const source = chart.rpeNextLegacySource;
        const ignored = source.ignoredByOriginal;
        if (Array.isArray(ignored)) ignored.push(row);
        else source.ignoredByOriginal = [row];
      }
      else throw new Error(`未识别命令 ${command}，停止导入以避免丢失数据`);
    } catch (error) { throw new Error(`文本谱面第 ${rowIndex + 2} 行：${error instanceof Error ? error.message : String(error)}`); }
  }
  if (!chart.judgeLineGroup.length) chart.judgeLineGroup.push('Default');
  assertChart(chart);
  return chart;
}
