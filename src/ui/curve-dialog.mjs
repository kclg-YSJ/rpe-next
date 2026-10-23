import { generateCurveNotes } from '../core/curve-notes.mjs';
import { beatValue, formatBeat, parseBeat } from '../core/beat.mjs';
import { showDialog } from './dialog.mjs';
import { assetUrl } from '../core/asset-url.mjs';
import { editorSkinContext } from './editor-skin-canvas.mjs';
import { t } from '../i18n.mjs';

export function curveDialog(session, division, anchors = []) {
  if (!session.line) throw new Error(t('curve-dialog.sb9277d1'));
  const selected = [...session.selection].map(index => session.notes[index]).filter(Boolean).sort((left, right) => beatValue(left.startTime) - beatValue(right.startTime));
  const endpoints = anchors.length === 2 ? anchors : selected.length === 2 ? selected : [];
  const body = showDialog(t('curve-dialog.s7f30a53'), t('curve-dialog.s061d508'));
  const fields = document.createElement('div'); fields.className = 'curve-fields'; body.append(fields);
  const controls = {};
  const field = (key, labelText, value, options) => {
    const label = document.createElement('label'); label.className = 'field'; label.append(labelText);
    const input = document.createElement(options ? 'select' : 'input'); input.setAttribute('aria-label', labelText);
    if (options) for (const [key, text] of options) input.append(new Option(text, key));
    input.value = value; controls[key] = input; label.append(input); fields.append(label);
  };
  field('startTime', t('curve-dialog.sb77d0bb'), formatBeat(endpoints[0]?.startTime ?? [0, 0, 1]));
  field('endTime', t('curve-dialog.sadfd92e'), formatBeat(endpoints[1]?.startTime ?? [4, 0, 1]));
  field('startX', t('curve-dialog.s4251c5f'), endpoints[0]?.positionX ?? -405);
  field('endX', t('curve-dialog.s53ad6f7'), endpoints[1]?.positionX ?? 405);
  field('density', t('curve-dialog.s46573fc'), 1);
  field('type', t('curve-dialog.s4c4f463'), 4, [[4, 'Drag'], [1, 'Tap'], [3, 'Flick']]);
  field('easingType', t('curve-dialog.sd9d17c7'), 1, Array.from({ length: 29 }, (unused, index) => [index + 1, t('curve-dialog.s53ec3fa', { p0: index + 1 })]));
  const picture = document.createElement('img'); picture.width = 100; picture.height = 64; picture.alt = t('curve-dialog.s34b3661'); fields.append(picture);
  const canvas = document.createElement('canvas'); canvas.className = 'curve-preview'; canvas.width = 760; canvas.height = 220; canvas.setAttribute('aria-label', t('curve-dialog.s936b578')); body.append(canvas);
  const summary = document.createElement('p'); summary.setAttribute('role', 'status'); body.append(summary);
  const apply = document.querySelector('#modal-apply'); apply.hidden = false; apply.textContent = t('curve-dialog.s7639620');
  const read = () => {
    const values = Object.fromEntries(Object.entries(controls).map(([key, control]) => {
      if (!control.value.trim()) throw new Error(t('curve-dialog.s7a3c870'));
      return [key, key.endsWith('Time') ? parseBeat(control.value) : Number(control.value)];
    }));
    return { ...values, division };
  };
  const refresh = () => {
    const context = editorSkinContext(canvas.getContext('2d'), 'curve'); context.clearRect(0, 0, canvas.width, canvas.height);
    picture.src = assetUrl(`easing/${controls.easingType.value}.svg`);
    try {
      const values = read(); const notes = generateCurveNotes(values);
      summary.textContent = t('curve-dialog.s15c2f0a', { p0: notes.length, p1: division, p2: values.density });
      const all = [{ positionX: values.startX, startTime: values.startTime }, ...notes, { positionX: values.endX, startTime: values.endTime }];
      const minimumX = Math.min(values.startX, values.endX, ...notes.map(note => note.positionX));
      const maximumX = Math.max(values.startX, values.endX, ...notes.map(note => note.positionX));
      const start = beatValue(values.startTime); const range = beatValue(values.endTime) - start;
      for (const [index, note] of all.entries()) {
        const horizontal = 30 + (note.positionX - minimumX) / (maximumX - minimumX || 1) * 700;
        const vertical = range ? 195 - (beatValue(note.startTime) - start) / range * 170 : 110;
        context.fillStyle = index === 0 || index === all.length - 1 ? '#ffe091' : '#9de5a6';
        context.fillRect(horizontal - 7, vertical - 2, 14, 4);
      }
      apply.disabled = !notes.length;
    } catch (error) { summary.textContent = error.message; apply.disabled = true; }
  };
  fields.addEventListener('input', refresh);
  apply.onclick = () => {
    try {
      const notes = generateCurveNotes(read());
      if (notes.length) { session.focus = 'notes'; session.eventSelection.clear(); session.insertNotes(notes, t('curve-dialog.s7f30a53')); }
      document.querySelector('#modal').close();
    } catch (error) { document.querySelector('#modal-error').textContent = error.message; }
  };
  refresh();
}
