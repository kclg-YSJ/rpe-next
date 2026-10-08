import { createChart, createLine, createNote, createEvent, assertChart } from './chart.ts';
import type { AnyEventType, Chart, ChartEvent, EventLayer, JudgeLine, NoteType } from './types.ts';

// The document handed to this converter comes straight out of `JSON.parse`, and its shape is only
// guaranteed as far as the two structural checks below prove it. The nested collections are typed
// loosely on purpose: the official format is an external, unvalidated input, so every field is
// treated as possibly absent instead of asserted into a richer domain type.
type OfficialEventValue = number;
interface OfficialEvent {
  startTime: number;
  endTime: number;
  start: OfficialEventValue;
  start2: OfficialEventValue;
  end: OfficialEventValue;
  end2: OfficialEventValue;
  value: OfficialEventValue;
}
interface OfficialNote {
  time: number;
  type: number;
  positionX: number;
  speed: number;
  holdTime?: number;
}
interface OfficialJudgeLine {
  bpm: number;
}
// Collections are looked up by name (`source[name]`), so they live behind an index signature; the
// two note buckets are pulled out by name and stay optional for the same reason as everything else.
type OfficialLine = OfficialJudgeLine & Partial<Record<
  'speedEvents' | 'judgeLineDisappearEvents' | 'judgeLineMoveEvents' | 'judgeLineRotateEvents' | 'notesAbove' | 'notesBelow',
  OfficialEvent[] | OfficialNote[]
>> & { [collection: string]: unknown };
interface OfficialChart {
  formatVersion: number;
  offset?: number;
  judgeLineList: OfficialLine[];
  [property: string]: unknown;
}

// A converter that projects one official event onto a single number.
type EventMapping = (event: OfficialEvent) => number;

export function parseOfficialChart(original: unknown): Chart {
  if (!original || typeof original !== 'object') throw new Error('目前仅支持非空官方 formatVersion 3 谱面');
  const source = original as OfficialChart;
  if (source.formatVersion !== 3 || !source.judgeLineList?.length) throw new Error('目前仅支持非空官方 formatVersion 3 谱面');
  const chart = createChart();
  const baseBpm = source.judgeLineList[0].bpm;
  chart.BPMList = [{ bpm: baseBpm, startTime: [0, 0, 1] }];
  chart.META.offset = (source.offset ?? 0) * 1000;
  chart.rpeNextLegacySource = { format: 'phigros-v3', document: original };
  const beat = (ticks: number): number => Math.max(-100, Math.floor(ticks + 0.1)) / 32;
  chart.judgeLineList = source.judgeLineList.map((lineSource, index): JudgeLine => {
    const line = createLine(`Line ${index + 1}`);
    line.bpmfactor = baseBpm / lineSource.bpm;
    const layer: EventLayer = {};
    const events = (name: string, channel: AnyEventType, start: EventMapping, end: EventMapping): void => {
      const raw = lineSource[name];
      const list = Array.isArray(raw) ? (raw as OfficialEvent[]) : [];
      layer[channel] = list.map((event: OfficialEvent): ChartEvent => createEvent(start(event), end(event), beat(event.startTime), beat(event.endTime)));
    };
    events('speedEvents', 'speedEvents', (event: OfficialEvent): number => event.value * 4.5, (event: OfficialEvent): number => event.value * 4.5);
    events('judgeLineDisappearEvents', 'alphaEvents', (event: OfficialEvent): number => event.start * 255, (event: OfficialEvent): number => event.end * 255);
    events('judgeLineMoveEvents', 'moveXEvents', (event: OfficialEvent): number => -675 + event.start * 1350, (event: OfficialEvent): number => -675 + event.end * 1350);
    events('judgeLineMoveEvents', 'moveYEvents', (event: OfficialEvent): number => -450 + event.start2 * 900, (event: OfficialEvent): number => -450 + event.end2 * 900);
    events('judgeLineRotateEvents', 'rotateEvents', (event: OfficialEvent): number => -event.start, (event: OfficialEvent): number => -event.end);
    line.eventLayers = [layer];
    for (const [collection, above] of [['notesAbove', 1], ['notesBelow', 0]] as const) {
      const raw = lineSource[collection];
      const noteList = Array.isArray(raw) ? (raw as OfficialNote[]) : [];
      for (const originalNote of noteList) {
        const type = ({ 1: 1, 2: 4, 3: 2, 4: 3 } as Record<number, NoteType>)[originalNote.type];
        const note = createNote(type, beat(originalNote.time), originalNote.positionX * 75, beat(originalNote.time + (originalNote.holdTime ?? 0)));
        note.above = above;
        note.speed = type === 2 ? 1 : originalNote.speed;
        line.notes.push(note);
      }
    }
    line.numOfNotes = line.notes.length;
    return line;
  });
  assertChart(chart);
  return chart;
}
