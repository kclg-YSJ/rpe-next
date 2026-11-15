import { t } from '../i18n.mjs';
export const EASING_NAMES = ['Linear', 'Sine Out', 'Sine In', 'Quad Out', 'Quad In', 'Sine InOut', 'Quad InOut', 'Cubic Out', 'Cubic In', 'Quart Out', 'Quart In', 'Cubic InOut', 'Quart InOut', 'Quint Out', 'Quint In', 'Expo Out', 'Expo In', 'Circ Out', 'Circ In', 'Back Out', 'Back In', 'Circ InOut', 'Back InOut', 'Elastic Out', 'Elastic In', 'Bounce Out', 'Bounce In', 'Bounce InOut', 'Elastic InOut'];

import { assetUrl } from '../core/asset-url.mjs';

export function createEasingPicker(value, onChange, state = { open: false }) {
  const gallery = document.createElement('details'); gallery.open = state.open;
  gallery.addEventListener('toggle', () => { state.open = gallery.open; });
  const summary = document.createElement('summary'); summary.textContent = t('animation-curve.standard'); gallery.append(summary);
  const { element: choices, select } = createEasingChoices(value, selected => { state.open = gallery.open; onChange(selected); });
  gallery.append(choices);
  return { element: gallery, select };
}

const EASING_FAMILIES = ['Sine', 'Quad', 'Cubic', 'Quart', 'Quint', 'Expo', 'Circ', 'Back', 'Elastic', 'Bounce'];
const EASING_DIRECTIONS = ['In', 'Out', 'InOut'];

function createEasingChoices(value, onChange, grouped = false) {
  const choices = document.createElement('div'); choices.className = grouped ? 'easing-gallery easing-gallery-grouped' : 'easing-gallery';
  const buttons = [];
  const select = selected => {
    for (const button of buttons) {
      const active = Number(button.dataset.easing) === selected;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    }
  };
  const add = (index, row, column) => {
    const name = EASING_NAMES[index];
    const button = document.createElement('button'); button.type = 'button'; button.title = `${index + 1} · ${name}`;
    button.dataset.easing = index + 1; button.setAttribute('aria-label', button.title);
    const image = document.createElement('img'); image.src = assetUrl(`easing/${index + 1}.svg`); image.alt = name;
    if (grouped) {
      button.dataset.easingRow = row; button.dataset.easingColumn = column;
      button.style.gridRow = String(row + 1); button.style.gridColumn = row === 0 ? '1 / -1' : String(column + 1);
      const caption = document.createElement('span'); caption.textContent = index === 0 ? name : name.split(' ').reverse().join('');
      if (index !== 0) button.append(image);
      button.append(caption);
    } else button.append(image, String(index + 1));
    button.onclick = () => { select(index + 1); onChange(index + 1); };
    choices.append(button); buttons.push(button);
  };
  if (grouped) {
    add(0, 0, 0);
    EASING_DIRECTIONS.forEach((direction, column) => {
      const heading = document.createElement('span'); heading.className = 'easing-direction'; heading.textContent = direction;
      heading.style.gridRow = '2'; heading.style.gridColumn = String(column + 1); choices.append(heading);
    });
    EASING_FAMILIES.forEach((family, row) => EASING_DIRECTIONS.forEach((direction, column) => {
      const index = EASING_NAMES.indexOf(`${family} ${direction}`);
      if (index !== -1) add(index, row + 2, column);
    }));
  } else EASING_NAMES.forEach((name, index) => add(index));
  select(value);
  return { element: choices, select, buttons };
}

export function createEasingPopup(value, onChange, label) {
  const root = document.createElement('span'); root.className = 'event-easing-select';
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'event-easing-trigger';
  trigger.setAttribute('aria-label', label); trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
  const popup = document.createElement('div'); popup.className = 'event-easing-popup'; popup.popover = 'auto';
  popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', label);
  let selected = value;
  const picker = createEasingChoices(value, next => {
    select(next); popup.hidePopover(); trigger.focus({ preventScroll: true }); onChange(next);
  }, true);
  const select = next => { selected = next; picker.select(next); trigger.textContent = `${next} · ${EASING_NAMES[next - 1] ?? EASING_NAMES[0]}`; };
  popup.append(picker.element); root.append(trigger, popup); select(value);
  trigger.onclick = () => {
    if (popup.matches(':popover-open')) { popup.hidePopover(); return; }
    popup.showPopover();
    const anchor = trigger.getBoundingClientRect(), bounds = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - bounds.height - 8))}px`;
    picker.buttons.find(button => Number(button.dataset.easing) === selected)?.focus({ preventScroll: true });
  };
  popup.addEventListener('toggle', event => trigger.setAttribute('aria-expanded', String(event.newState === 'open')));
  popup.addEventListener('keydown', event => {
    event.stopPropagation();
    const buttons = picker.buttons, index = buttons.indexOf(document.activeElement);
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let target;
    if (event.key === 'Home' || event.key === 'End') target = event.key === 'Home' ? buttons[0] : buttons.at(-1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') target = buttons[(index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
    else {
      const current = buttons[index] ?? buttons[0], direction = event.key === 'ArrowDown' ? 1 : -1;
      const row = Number(current.dataset.easingRow), column = Number(current.dataset.easingColumn);
      target = buttons.filter(button => (button.dataset.easingColumn === String(column) || button.dataset.easingRow === '0') && (Number(button.dataset.easingRow) - row) * direction > 0)
        .sort((a, b) => (Number(a.dataset.easingRow) - Number(b.dataset.easingRow)) * direction)[0] ?? current;
    }
    target?.focus();
  });
  return { element: root, select };
}
