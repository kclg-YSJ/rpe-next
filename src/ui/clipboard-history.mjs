import { beatValue } from '../core/beat.mjs';
import { editorSkinContext } from './editor-skin-canvas.mjs';
import { t } from '../i18n.mjs';

const colors = { 1: '#8acbff', 2: '#8acbff', 3: '#f596ac', 4: '#f1ce76' };

export function drawClipboardThumbnail(canvas, entry) {
  canvas.classList.add('clipboard-thumbnail');
  canvas.width = 480; canvas.height = 160;
  const context = editorSkinContext(canvas.getContext('2d'));
  const items = [...entry.notes, ...entry.events.map(item => item.event)];
  let first = Infinity; let last = -Infinity;
  for (const item of items) { first = Math.min(first, beatValue(item.startTime)); last = Math.max(last, beatValue(item.endTime)); }
  const span = Math.max(1, last - first);
  const vertical = time => 145 - (beatValue(time) - first) / span * 130;
  const noteArea = entry.notes.length ? entry.events.length ? 300 : 480 : 0;
  let extent = 675;
  for (const note of entry.notes) extent = Math.max(extent, Math.abs(note.positionX));
  context.fillStyle = '#20252d'; context.fillRect(0, 0, 480, 160);
  context.strokeStyle = '#414956'; context.lineWidth = 1;
  if (noteArea) for (let index = 0; index < 5; index++) { const x = 16 + index / 4 * (noteArea - 32); context.beginPath(); context.moveTo(x, 10); context.lineTo(x, 150); context.stroke(); }
  for (const note of [...entry.notes].sort((left, right) => Number(right.type === 2) - Number(left.type === 2))) {
    const horizontal = 16 + (note.positionX + extent) / (extent * 2) * (noteArea - 32);
    const bottom = vertical(note.startTime); const top = vertical(note.endTime);
    context.fillStyle = colors[note.type] ?? '#ccc'; context.globalAlpha = note.isFake ? 0.4 : 0.85;
    if (note.type === 2) context.fillRect(horizontal - 9, top, 18, Math.max(3, bottom - top));
    context.fillRect(horizontal - 13, bottom - 2, 26, 4);
  }
  context.globalAlpha = 0.8;
  const tracks = [...new Set(entry.events.map(item => item.type))];
  for (const { type, event } of entry.events) {
    const width = (480 - noteArea - 12) / tracks.length;
    const top = vertical(event.endTime); const bottom = vertical(event.startTime);
    context.fillStyle = type === 'paintEvents' ? '#bc8fec' : '#d7a451';
    context.fillRect(noteArea + tracks.indexOf(type) * width + 4, top, Math.max(2, width - 6), Math.max(3, bottom - top));
  }
  context.globalAlpha = 1;
}

export function renderClipboardHistory(host, history, actions) {
  const focused = document.activeElement?.closest('[data-clipboard-id]');
  const focusId = focused?.dataset.clipboardId; const focusAction = document.activeElement?.dataset.action;
  host.replaceChildren();
  if (!history.entries.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = t('clipboard-history.s385021c'); host.append(empty); return; }
  for (const entry of [...history.entries].sort((left, right) => Number(right.pinned) - Number(left.pinned))) {
    const card = document.createElement('article'); card.className = 'clipboard-card'; card.dataset.clipboardId = entry.id;
    card.classList.toggle('active', history.activeId === entry.id);
    const select = document.createElement('button'); select.type = 'button'; select.className = 'clipboard-select'; select.dataset.action = 'use';
    select.setAttribute('aria-pressed', String(history.activeId === entry.id));
    const picture = document.createElement('canvas'); picture.setAttribute('aria-hidden', 'true'); drawClipboardThumbnail(picture, entry);
    const title = document.createElement('strong'); title.textContent = t('clipboard-history.s444c700', { p0: entry.pinned ? '◆ ' : '', p1: entry.notes.length, p2: entry.events.length });
    const details = document.createElement('span'); details.textContent = t('clipboard-history.se0c9a04', { p0: entry.source, p1: entry.line, p2: new Date(entry.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    select.setAttribute('aria-label', t('clipboard-history.sc2ebd01', { p0: entry.name || title.textContent, p1: details.textContent })); select.onclick = () => actions.use(entry.id);
    select.append(picture, title, details); card.append(select);
    const name = document.createElement('input'); name.type = 'text'; name.maxLength = 40; name.className = 'clipboard-name'; name.dataset.action = 'name';
    name.value = entry.name ?? ''; name.placeholder = t('clipboard-history.sb1da9c9'); name.setAttribute('aria-label', t('clipboard-history.sd727ebc', { p0: entry.name || title.textContent }));
    name.oninput = () => {
      history.rename(entry.id, name.value);
      name.setAttribute('aria-label', t('clipboard-history.sd727ebc', { p0: entry.name || title.textContent }));
      select.setAttribute('aria-label', t('clipboard-history.sc2ebd01', { p0: entry.name || title.textContent, p1: details.textContent }));
    };
    name.onchange = () => { name.value = entry.name; };
    name.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); name.blur(); } };
    card.append(name);
    const buttons = document.createElement('div'); buttons.className = 'clipboard-actions';
    for (const [key, label, action] of [['pin', entry.pinned ? t('clipboard-history.s09250f2') : t('clipboard-history.sf34fcf6'), () => history.pin(entry.id)], ['delete', t('clipboard-history.s8f22c99'), () => history.remove(entry.id)]]) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.action = key; button.textContent = label; button.onclick = action; buttons.append(button);
    }
    card.append(buttons); host.append(card);
  }
  if (focusId) for (const card of host.children) if (card.dataset.clipboardId === focusId) card.querySelector(`[data-action="${focusAction}"]`)?.focus();
}
