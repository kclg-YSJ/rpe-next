import { createChart, createLine, createNote, createEvent, assertChart } from './chart.mjs';
import { fromNumber } from './beat.mjs';
import { t } from '../i18n.mjs';

export function parsePecChart(text) {
  const rows = text.trim().split(/\r?\n/).map(row => row.trim()).filter(row => row && !row.startsWith('//'));
  const offset = Number(rows.shift());
  if (!Number.isFinite(offset)) throw new Error(t('pec-chart.sdb1a186'));
  const chart = createChart();
  chart.META.offset = offset - 175;
  chart.BPMList = [];
  chart.judgeLineList = [];
  chart.rpeNextLegacySource = { format: 'pec', text };
  const tracks = new Map();
  let lastNote;
  const getLine = index => {
    if (!Number.isInteger(index) || index < 0 || index > 10000) throw new Error(t('pec-chart.s6be94a8'));
    while (chart.judgeLineList.length <= index) {
      const line = createLine(`Line ${chart.judgeLineList.length + 1}`); line.eventLayers = [{}]; chart.judgeLineList.push(line);
    }
    return chart.judgeLineList[index];
  };
  const append = (lineIndex, type, startBeat, endBeat, value, easingType, instant) => {
    const key = `${lineIndex}:${type}`;
    if (!tracks.has(key)) tracks.set(key, { lineIndex, type, operations: [] });
    tracks.get(key).operations.push({ startBeat, endBeat, value, easingType, instant });
  };
  for (const [index, row] of rows.entries()) {
    const [command, ...tokens] = row.split(/\s+/);
    const values = tokens.map(Number);
    const fail = message => { throw new Error(t('pec-chart.sacc6233', { p0: index + 2, p1: message })); };
    if (!values.every(Number.isFinite)) fail(t('pec-chart.s3ec6659'));
    if (command === 'bp' && values.length === 2) { chart.BPMList.push({ startTime: fromNumber(values[0]), bpm: values[1] }); continue; }
    if (command === '#' || command === '&') {
      if (!lastNote || values.length !== 1) fail(t('pec-chart.sd975e9c'));
      lastNote[command === '#' ? 'speed' : 'size'] = values[0]; continue;
    }
    const lineIndex = values[0];
    const line = getLine(lineIndex);
    if (/^n[1234]$/.test(command)) {
      const type = Number(command[1]);
      const isHold = type === 2;
      const expected = isHold ? 6 : 5;
      if (values.length !== expected && values.length !== expected - 1) fail(t('pec-chart.s9070749'));
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
      append(lineIndex, { cd: 'rotateEvents', ca: 'alphaEvents', cv: 'speedEvents' }[command], values[1], values[1], values[2] * (command === 'cv' ? 450 / 770 : 1), 1, true);
    } else if ((command === 'cr' && values.length === 5) || (command === 'cf' && values.length === 4)) {
      append(lineIndex, command === 'cr' ? 'rotateEvents' : 'alphaEvents', values[1], values[2], values[3], values[4] ?? 1, false);
    } else fail(t('pec-chart.s856992f', { p0: command }));
  }
  for (const track of tracks.values()) {
    let current = track.type === 'alphaEvents' ? 255 : 0;
    const events = [];
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
