import { beatValue, formatBeat, parseBeat, fromNumber } from '../core/beat.mjs';
import { NOTE_NAMES, noteIsAbove } from '../core/chart.mjs';
import { numericWheel } from './numeric-wheel.mjs';
import { beatInputControl } from './beat-input.mjs';
import { visibleBeats, visibleSeconds } from '../core/note-editing.mjs';
import { captureSelection, editCapturedSelection, commitSelectionEdit } from '../application/batch-edit.mjs';
import { t } from '../i18n.mjs';

function selectedNoteEntries(session) {
  if (session.multiLineActive && session.multiLineMode === 'notes') return session.selectedNoteEntries();
  return [...session.selection].map(index => ({ lineIndex: session.lineIndex, index, note: session.notes[index] })).filter(entry => entry.note);
}

function applyNoteTransform(session, label, transform) {
  if (session.multiLineActive && session.multiLineMode === 'notes') {
    const result = editCapturedSelection(captureSelection(session), { note: transform });
    commitSelectionEdit(session, result, label);
  } else session.transformSelection(label, transform);
}

export function renderProperties(session, reportError) {
  if (session.liveNoteEdit) return;
  const container = document.querySelector('#properties');
  container.replaceChildren();
  const entries = selectedNoteEntries(session);
  document.querySelector('#property-count').textContent = t('inspector.s50000b6', { p0: entries.length });
  const selectedEntry = entries[0];
  const selectedIndex = selectedEntry?.index;
  const selectedLineIndex = selectedEntry?.lineIndex ?? session.lineIndex;
  const note = selectedEntry?.note;
  if (!note) {
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = t('inspector.s11dc018'); container.append(hint); return;
  }
  const directionOptions = note.type === 2 ? { 0: t('inspector.se1dea69'), 1: t('inspector.sc847d66') } : { 1: t('inspector.sc847d66'), 2: t('inspector.se1dea69') };
  const lineOptions = Object.fromEntries((session.chart.judgeLineList ?? []).map((line, index) => [index, t('inspector.sf21fa0c', { p0: index, p1: line.Name || t('inspector.s3556306') })]));
  const selectedLine = session.chart.judgeLineList?.[selectedLineIndex] ?? session.line;
  const selectedFactor = selectedLine?.bpmfactor ?? 1;
  const fields = [
    ['lineIndex', t('inspector.sd3db929'), 'select', lineOptions], ['type', t('inspector.se4e46c7'), 'select', NOTE_NAMES], ['startTime', t('inspector.s087c451'), 'beat'], ['endTime', t('inspector.sc4d3fa4'), 'beat'],
    ['positionX', t('inspector.sa9dfb78'), 'number'], ['above', t('inspector.sa88d531'), 'select', directionOptions],
    ['isFake', 'Fake', 'select', { 0: t('inspector.s8bf5c10'), 1: t('inspector.s30160a2') }], ['speed', t('inspector.sf2fdffb'), 'number', 1],
    ['size', t('inspector.sfd20702'), 'number', 1], ['alpha', t('inspector.s61b101b'), 'number', 255],
    ['yOffset', t('inspector.s9d63ee8'), 'number', 0], ['visibleTime', t('inspector.s9717d88'), 'duration', 999999],
  ];
  for (const [key, labelText, kind, options] of fields) {
    const label = document.createElement('label');
    label.className = 'field';
    label.append(labelText);
    const duration = key === 'visibleTime';
    const beatDuration = duration && session.visibleTimeUnit === 'beats';
    const input = document.createElement(kind === 'select' ? 'select' : 'input');
    input.setAttribute('aria-label', labelText);
    input.dataset.rpenField = key; label.dataset.rpenField = key;
    if (kind === 'select') for (const [value, title] of Object.entries(options)) {
      const option = document.createElement('option'); option.value = value; option.textContent = title; input.append(option);
    }
    else input.type = kind === 'number' || duration && !beatDuration ? 'number' : 'text';
    const step = key === 'speed' ? 0.1 : key === 'size' ? 0.25 : key === 'positionX' || key === 'yOffset' || key === 'alpha' ? 5 : 1;
    if (kind === 'number') input.step = step;
    if (key === 'size') input.min = 0.01;
    if (key === 'alpha') { input.min = 0; input.max = 255; }
    input.value = key === 'lineIndex' ? selectedLineIndex : kind === 'beat' ? formatBeat(note[key]) : note[key] ?? (typeof options === 'number' ? options : 0);
    if (key === 'above') input.value = noteIsAbove(note) ? 1 : note.type === 2 ? 0 : 2;
    if (beatDuration && note.visibleTime < 999999) input.value = formatBeat(fromNumber(visibleBeats(note, session.tempo, selectedFactor)));
    if (duration) { input.min = 0; input.title = t('inspector.scc0a9e5'); }
    const apply = (quiet = false) => {
      try {
        if (key === 'lineIndex') { session.moveSelectionToLine(Number(input.value)); return; }
        const value = kind === 'beat' ? parseBeat(input.value) : beatDuration ? beatValue(parseBeat(input.value)) : key === 'alpha' ? Math.trunc(Number(input.value)) : Number(input.value);
        if (kind !== 'beat' && (input.value.trim() === '' || !Number.isFinite(value))) throw new Error(t('inspector.s2c788eb'));
        if (key === 'size' && value <= 0) throw new Error(t('inspector.sb6b02cf'));
        applyNoteTransform(session, t('inspector.s7cf9711', { p0: labelText }), (current, entry) => {
          const factor = session.chart.judgeLineList?.[entry?.lineIndex ?? selectedLineIndex]?.bpmfactor ?? selectedFactor;
          const next = { ...current, [key]: duration ? beatDuration ? visibleSeconds(current, value, session.tempo, factor) : Math.max(0, value) : value };
          if (key === 'startTime') {
            next.endTime = current.type === 2 ? fromNumber(beatValue(current.endTime) + beatValue(value) - beatValue(current.startTime)) : value;
          }
          if (key === 'above') next.above = value === 1 ? 1 : current.type === 2 ? 0 : 2;
          if (key === 'type') {
            next.endTime = value === 2 ? fromNumber(Math.max(beatValue(current.endTime), beatValue(current.startTime) + 1)) : [...current.startTime];
            next.above = noteIsAbove(current) ? 1 : value === 2 ? 0 : 2;
          }
          if (key === 'endTime' && (current.type !== 2 || beatValue(value) < beatValue(current.startTime))) throw new Error(t('inspector.s55eae65'));
          return next;
        });
      } catch (error) { if (!quiet) { reportError(error); input.value = key === 'lineIndex' ? selectedLineIndex : kind === 'beat' ? formatBeat(note[key]) : note[key] ?? 0; } }
    };
    input.onchange = () => apply();
    input.oninput = event => { if (!event.isComposing && input.value.trim()) apply(kind === 'beat' || beatDuration); };
    input.onfocus = () => { session.liveNoteEdit = true; };
    input.onblur = () => { session.liveNoteEdit = false; queueMicrotask(() => { if (!session.liveNoteEdit) renderProperties(session, reportError); }); };
    if (kind === 'number') numericWheel(input, step);
    if (duration) {
      numericWheel(input, 1, direction => {
        const current = selectedNoteEntries(session)[0]?.note;
        if (!current) return;
        const factor = session.chart.judgeLineList?.[selectedLineIndex]?.bpmfactor ?? selectedFactor;
        const beats = current.visibleTime >= 999999 ? 0 : Math.max(0, visibleBeats(current, session.tempo, factor) + direction / session.division);
        input.value = beatDuration ? formatBeat(fromNumber(beats)) : Number(visibleSeconds(current, beats, session.tempo, factor).toFixed(8));
        apply();
      });
      const controls = document.createElement('span'); controls.className = 'duration-input';
      const unit = document.createElement('select'); unit.setAttribute('aria-label', t('inspector.s119da4c'));
      unit.append(new Option(t('inspector.seb6aaba'), 'seconds'), new Option(t('inspector.s60a8be1'), 'beats')); unit.value = session.visibleTimeUnit ?? 'seconds';
      unit.onchange = () => { session.visibleTimeUnit = unit.value; session.liveNoteEdit = false; renderProperties(session, reportError); };
      controls.append(input, unit); label.append(controls);
    } else label.append(kind === 'beat' ? beatInputControl(input, () => session.division, reportError) : input);
    container.append(label);
  }
}
