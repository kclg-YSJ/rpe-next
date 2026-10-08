import { beatValue, formatBeat, parseBeat, fromNumber } from '../core/beat.ts';
import { NOTE_NAMES, noteIsAbove } from '../core/chart.ts';
import { numericWheel } from './numeric-wheel.ts';
import { visibleBeats, visibleSeconds } from '../core/note-editing.ts';
import { TempoMap } from '../core/tempo.ts';
import { captureSelection, editCapturedSelection, commitSelectionEdit } from '../application/batch-edit.ts';
import type { EditorSession, NoteEntry } from '../application/session.ts';
import type { Beat, Note } from '../core/types.ts';

/** One row of the properties panel: its note key, its label and how the input is built. */
type PropertyField = [key: string, label: string, kind: string, options?: unknown];

/** The note transform {@link applyNoteTransform} hands to the batch helpers. */
type NoteFieldTransform = (note: Note | undefined, entry: NoteEntry) => Note;

function selectedNoteEntries(session: EditorSession): NoteEntry[] {
  if (session.multiLineActive && session.multiLineMode === 'notes') return session.selectedNoteEntries();
  return [...session.selection].map(index => ({ lineIndex: session.lineIndex, index, note: session.notes[index] })).filter(entry => entry.note);
}

function applyNoteTransform(session: EditorSession, label: string, transform: NoteFieldTransform): void {
  if (session.multiLineActive && session.multiLineMode === 'notes') {
    const result = editCapturedSelection(captureSelection(session), { note: transform });
    commitSelectionEdit(session, result, label);
  } else session.transformSelection(label, transform);
}

export function renderProperties(session: EditorSession, reportError: (error: unknown) => void): void {
  if (session.liveNoteEdit) return;
  const container = document.querySelector('#properties') as HTMLElement;
  container.replaceChildren();
  const entries = selectedNoteEntries(session);
  (document.querySelector('#property-count') as HTMLElement).textContent = `${entries.length} 已选`;
  const selectedEntry = entries[0];
  const selectedIndex = selectedEntry?.index;
  const selectedLineIndex = selectedEntry?.lineIndex ?? session.lineIndex;
  const note = selectedEntry?.note;
  if (!note) {
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = '在左侧音符区点选音符；按已配置的音符快捷键放置。Hold 两次定位起止拍，Esc 取消。拖动实时显示吸附位置；竖线吸附可单独关闭。'; container.append(hint); return;
  }
  const directionOptions: Record<number, string> = note.type === 2 ? { 0: '下方', 1: '上方' } : { 1: '上方', 2: '下方' };
  const lineOptions = Object.fromEntries((session.chart.judgeLineList ?? []).map((line, index) => [index, `${index} · ${line.Name || '未命名'}`]));
  const selectedLine = session.chart.judgeLineList?.[selectedLineIndex] ?? session.line;
  const selectedFactor = selectedLine?.bpmfactor ?? 1;
  // `tempo` and `division` are attached to the session by `renderSession` on the first render, which
  // always precedes this panel. The fallbacks keep the reads total: `TempoMap` requires at least one
  // entry, so the chart's own list is used, and 4 is the editor's default division.
  const tempo = session.tempo ?? new TempoMap(session.chart.BPMList);
  const division = session.division ?? 4;
  const fields: PropertyField[] = [
    ['lineIndex', '所属线号', 'select', lineOptions], ['type', '类型', 'select', NOTE_NAMES], ['startTime', '开始拍', 'beat'], ['endTime', '结束拍', 'beat'],
    ['positionX', 'X 坐标', 'number'], ['above', '方向', 'select', directionOptions],
    ['isFake', 'Fake', 'select', { 0: '否', 1: '是' }], ['speed', '速度', 'number', 1],
    ['size', '大小', 'number', 1], ['alpha', '透明度', 'number', 255],
    ['yOffset', 'Y 偏移', 'number', 0], ['visibleTime', '可见时间', 'duration', 999999],
  ];
  for (const [key, labelText, kind, options] of fields) {
    const label = document.createElement('label');
    label.className = 'field';
    label.append(labelText);
    const duration = key === 'visibleTime';
    const beatDuration = duration && session.visibleTimeUnit === 'beats';
    // `select` fields and everything else share the one generic element `document.createElement`
    // returns, so it is narrowed to `HTMLInputElement` at the two places that need input-only
    // attributes rather than being narrowed once here.
    const input = document.createElement(kind === 'select' ? 'select' : 'input');
    input.setAttribute('aria-label', labelText);
    if (kind === 'select') for (const [value, title] of Object.entries(options ?? {})) {
      const option = document.createElement('option'); option.value = value; option.textContent = String(title); input.append(option);
    }
    else (input as HTMLInputElement).type = kind === 'number' || duration && !beatDuration ? 'number' : 'text';
    // `min`/`max`/`step` are DOMString attributes, so the original's numeric writes are stored as
    // their decimal text; the parsed value is the same either way.
    const step = key === 'speed' ? 0.1 : key === 'size' ? 0.25 : key === 'positionX' || key === 'yOffset' || key === 'alpha' ? 5 : 1;
    if (kind === 'number') (input as HTMLInputElement).step = String(step);
    if (key === 'size') (input as HTMLInputElement).min = '0.01';
    if (key === 'alpha') { (input as HTMLInputElement).min = '0'; (input as HTMLInputElement).max = '255'; }
    // Every scalar field is written as text: `input.value` stringifies on write, so the original's
    // numeric assignment stored the same decimal text.
    const shown = note[key];
    input.value = key === 'lineIndex' ? String(selectedLineIndex) : kind === 'beat' ? formatBeat(shown as Beat) : typeof shown === 'string' || typeof shown === 'number' ? String(shown) : String(typeof options === 'number' ? options : 0);
    if (key === 'above') input.value = String(noteIsAbove(note) ? 1 : note.type === 2 ? 0 : 2);
    if (beatDuration && Number(note.visibleTime) < 999999) input.value = formatBeat(fromNumber(visibleBeats(note, tempo, selectedFactor)));
    if (duration) { (input as HTMLInputElement).min = '0'; input.title = '999999 表示无限；首次滚轮调节重置为 0，之后每次增减一横线间隔拍'; }
    const apply = () => {
      try {
        if (key === 'lineIndex') { session.moveSelectionToLine(Number(input.value)); return; }
        const value = kind === 'beat' ? parseBeat(input.value) : beatDuration ? beatValue(parseBeat(input.value)) : Number(input.value);
        // `value` is a beat triple for the two time fields and a number for every other field; the
        // numeric view below is only read on the numeric branches, which `key` selects.
        const numeric = Number.isFinite(value) ? Number(value) : beatValue(value);
        if (kind !== 'beat' && (input.value.trim() === '' || !Number.isFinite(numeric))) throw new Error('请输入有限数字');
        if (key === 'size' && numeric <= 0) throw new Error('大小必须大于零');
        applyNoteTransform(session, `修改${labelText}`, (editing, entry) => {
          const factor = session.chart.judgeLineList?.[entry?.lineIndex ?? selectedLineIndex]?.bpmfactor ?? selectedFactor;
          // `transformSelection` hands back the entry's own note, but its parameter is `Note |
          // undefined`; the seed keeps the spread total where that note is absent.
          const current = editing ?? note;
          const start = [...current.startTime] as Beat;
          // `value` is a bare number for the numeric kinds; the two branches that write it into a beat
          // field are the `beat`-kind ones, so they take it from `parseBeat` directly.
          const beat = kind === 'beat' ? value as Beat : start;
          const next: Note = { ...current, [key]: duration ? beatDuration ? visibleSeconds(current, numeric, tempo, factor) : Math.max(0, numeric) : value };
          if (key === 'startTime') {
            next.endTime = current.type === 2 ? fromNumber(beatValue(current.endTime) + numeric - beatValue(start)) : beat;
          }
          if (key === 'above') next.above = numeric === 1 ? 1 : current.type === 2 ? 0 : 2;
          if (key === 'type') {
            next.endTime = numeric === 2 ? fromNumber(Math.max(beatValue(current.endTime), beatValue(start) + 1)) : [...start];
            next.above = noteIsAbove(current) ? 1 : numeric === 2 ? 0 : 2;
          }
          if (key === 'endTime' && (current.type !== 2 || numeric < beatValue(current.startTime))) throw new Error('结束拍只能用于 Hold，且不能早于开始拍');
          return next;
        });
      } catch (error) { reportError(error); input.value = key === 'lineIndex' ? String(selectedLineIndex) : kind === 'beat' ? formatBeat(note[key] as Beat) : String(note[key] ?? 0); }
    };
    input.onchange = apply;
    input.oninput = () => { if (input.value.trim()) apply(); };
    input.onfocus = () => { session.liveNoteEdit = true; };
    input.onblur = () => { session.liveNoteEdit = false; queueMicrotask(() => { if (!session.liveNoteEdit) renderProperties(session, reportError); }); };
    if (kind === 'number') numericWheel(input as HTMLInputElement, step);
    if (duration) {
      numericWheel(input as HTMLInputElement, 1, direction => {
        const editing = selectedNoteEntries(session)[0]?.note;
        if (!editing) return;
        const factor = session.chart.judgeLineList?.[selectedLineIndex]?.bpmfactor ?? selectedFactor;
        const beats = Number(editing.visibleTime) >= 999999 ? 0 : Math.max(0, visibleBeats(editing, tempo, factor) + direction / division);
        input.value = beatDuration ? formatBeat(fromNumber(beats)) : String(Number(visibleSeconds(editing, beats, tempo, factor).toFixed(8)));
        apply();
      });
      const controls = document.createElement('span'); controls.className = 'duration-input';
      const unit = document.createElement('select'); unit.setAttribute('aria-label', '可见时间单位');
      unit.append(new Option('秒', 'seconds'), new Option('拍', 'beats')); unit.value = session.visibleTimeUnit ?? 'seconds';
      unit.onchange = () => { session.visibleTimeUnit = unit.value; session.liveNoteEdit = false; renderProperties(session, reportError); };
      controls.append(input, unit); label.append(controls);
    } else label.append(input);
    container.append(label);
  }
}
