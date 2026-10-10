import { createChart, createLine, createNote, createEvent, assertChart } from './chart.mjs';
import { convertOfficialNoiseAreas } from './official-noise.mjs';
import { NOISE_VERSION } from './noise-areas.mjs';

export function parseOfficialChart(original) {
  if (original.formatVersion !== 3 || !original.judgeLineList?.length) throw new Error('目前仅支持非空官方 formatVersion 3 谱面');
  const chart = createChart();
  const baseBpm = original.judgeLineList[0].bpm;
  chart.BPMList = [{ bpm: baseBpm, startTime: [0, 0, 1] }];
  chart.META.offset = (original.offset ?? 0) * 1000;
  chart.blockAreaList = convertOfficialNoiseAreas(original.blockAreaList, baseBpm, original.offset ?? 0);
  chart.noiseAreaOptions = { ignoreTripleInversion: true };
  if (chart.blockAreaList.length) chart.META.RPEVersion = NOISE_VERSION;
  chart.rpeNextLegacySource = { format: 'phigros-v3', document: original };
  const beat = ticks => Math.max(-100, Math.floor(ticks + 0.1)) / 32;
  chart.judgeLineList = original.judgeLineList.map((source, index) => {
    const line = createLine(`Line ${index + 1}`);
    line.bpmfactor = baseBpm / source.bpm;
    const layer = {};
    const events = (name, channel, start, end) => {
      layer[channel] = (source[name] ?? []).map(event => createEvent(start(event), end(event), beat(event.startTime), beat(event.endTime)));
    };
    events('speedEvents', 'speedEvents', event => event.value * 4.5, event => event.value * 4.5);
    events('judgeLineDisappearEvents', 'alphaEvents', event => event.start * 255, event => event.end * 255);
    events('judgeLineMoveEvents', 'moveXEvents', event => -675 + event.start * 1350, event => -675 + event.end * 1350);
    events('judgeLineMoveEvents', 'moveYEvents', event => -450 + event.start2 * 900, event => -450 + event.end2 * 900);
    events('judgeLineRotateEvents', 'rotateEvents', event => -event.start, event => -event.end);
    line.eventLayers = [layer];
    for (const [collection, above] of [['notesAbove', 1], ['notesBelow', 0]]) {
      for (const originalNote of source[collection] ?? []) {
        const type = { 1: 1, 2: 4, 3: 2, 4: 3 }[originalNote.type];
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
