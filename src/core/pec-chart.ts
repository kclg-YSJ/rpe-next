import { createChart, createLine, createNote, createEvent, assertChart } from './chart.ts';
import { fromNumber } from './beat.ts';
import type { Chart, ChartEvent, EventType, Note, NoteType } from './types.ts';

/**
 * One command of a PEC track, kept in file order until the whole file has been read.
 *
 * Tracks are buffered per `lineIndex:type` because a PEC file may interleave commands of the same
 * track; only after parsing is each track sorted by start beat and turned into easing events.
 */
interface PecOperation {
  startBeat: number;
  endBeat: number;
  value: number;
  easingType: number;
  instant: boolean;
}

/** A buffered PEC track, keyed by judge line index and target RPE event track. */
interface PecTrack {
  lineIndex: number;
  type: EventType;
  operations: PecOperation[];
}

export function parsePecChart(text: string): Chart {
  const rows = text.trim().split(/\r?\n/).map((row: string) => row.trim()).filter((row: string) => row && !row.startsWith('//'));
  const offset = Number(rows.shift());
  if (!Number.isFinite(offset)) throw new Error('PEC offset 无效');
  const chart = createChart();
  chart.META.offset = offset - 175;
  chart.BPMList = [];
  chart.judgeLineList = [];
  chart.rpeNextLegacySource = { format: 'pec', text };
  const tracks = new Map<string, PecTrack>();
  // `undefined` only before the first note command: `#`/`&` re-read the note the previous line created.
  let lastNote: Note | undefined;
  const getLine = (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index > 10000) throw new Error('PEC 判定线索引无效');
    while (chart.judgeLineList.length <= index) {
      const line = createLine(`Line ${chart.judgeLineList.length + 1}`); line.eventLayers = [{}]; chart.judgeLineList.push(line);
    }
    return chart.judgeLineList[index];
  };
  const append = (lineIndex: number, type: EventType, startBeat: number, endBeat: number, value: number, easingType: number, instant: boolean): void => {
    const key = `${lineIndex}:${type}`;
    if (!tracks.has(key)) tracks.set(key, { lineIndex, type, operations: [] });
    // Every read of a key set just above hits the `PecTrack` branch, never the `undefined` one.
    const track = tracks.get(key);
    if (track) track.operations.push({ startBeat, endBeat, value, easingType, instant });
  };
  for (const [index, row] of rows.entries()) {
    const [command, ...tokens] = row.split(/\s+/);
    const values = tokens.map(Number);
    if (!values.every(Number.isFinite)) throw new Error(`PEC 第 ${index + 2} 行：参数不是有限数字`);
    if (command === 'bp' && values.length === 2) { chart.BPMList.push({ startTime: fromNumber(values[0]), bpm: values[1] }); continue; }
    if (command === '#' || command === '&') {
      if (!lastNote || values.length !== 1) throw new Error(`PEC 第 ${index + 2} 行：音符附加参数缺少前置音符`);
      lastNote[command === '#' ? 'speed' : 'size'] = values[0]; continue;
    }
    const lineIndex = values[0];
    const line = getLine(lineIndex);
    if (/^n[1234]$/.test(command)) {
      // The guard above already proved the digit is one of 1-4, which is exactly `NoteType`.
      const type = Number(command[1]) as NoteType;
      const isHold = type === 2;
      const expected = isHold ? 6 : 5;
      if (values.length !== expected && values.length !== expected - 1) throw new Error(`PEC 第 ${index + 2} 行：音符参数个数错误`);
      const coordinateIndex = isHold ? 3 : 2;
      lastNote = createNote(type, values[1], values[coordinateIndex] * 675 / 1024, isHold ? values[2] : values[1]);
      lastNote.above = values[coordinateIndex + 1] === 1 ? 1 : 0;
      lastNote.isFake = values[coordinateIndex + 2] ?? 0;
      line.notes.push(lastNote); line.numOfNotes = line.notes.length;
    } else if (command === 'cp' && values.length === 4) {
      append(lineIndex, 'moveXEvents', values[1], values[1], (values[2] - 1024) * 675 / 1024, 1, true);
      append(lineIndex, 'moveYEvents', values[1], values[1], (values[3] - 700) * 450 / 700, 1, true);
    } else if (command === 'cm' && values.length === 6) {
      append(lineIndex, 'moveXEvents', values[1], values[2], (values[3] - 1024) * 675 / 1024, values[5], false);
      append(lineIndex, 'moveYEvents', values[1], values[2], (values[4] - 700) * 450 / 700, values[5], false);
    } else if (['cd', 'ca', 'cv'].includes(command) && values.length === 3) {
      const type = command === 'cd' ? 'rotateEvents' : command === 'ca' ? 'alphaEvents' : 'speedEvents';
      append(lineIndex, type, values[1], values[1], values[2] * (command === 'cv' ? 450 / 770 : 1), 1, true);
    } else if ((command === 'cr' && values.length === 5) || (command === 'cf' && values.length === 4)) {
      append(lineIndex, command === 'cr' ? 'rotateEvents' : 'alphaEvents', values[1], values[2], values[3], values[4] ?? 1, false);
    } else throw new Error(`PEC 第 ${index + 2} 行：不支持命令或参数 ${command}`);
  }
  for (const track of tracks.values()) {
    let current = track.type === 'alphaEvents' ? 255 : 0;
    const events: ChartEvent[] = [];
    for (const operation of track.operations.sort((left, right) => left.startBeat - right.startBeat)) {
      const event = createEvent(operation.instant ? operation.value : current, operation.value, operation.startBeat, operation.endBeat);
      event.easingType = operation.easingType;
      events.push(event); current = operation.value;
    }
    chart.judgeLineList[track.lineIndex].eventLayers[0][track.type] = events;
  }
  assertChart(chart);
  return chart;
}
