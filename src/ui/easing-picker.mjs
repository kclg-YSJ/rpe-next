import { t } from '../i18n.mjs';
export const EASING_NAMES = ['Linear', 'Sine Out', 'Sine In', 'Quad Out', 'Quad In', 'Sine InOut', 'Quad InOut', 'Cubic Out', 'Cubic In', 'Quart Out', 'Quart In', 'Cubic InOut', 'Quart InOut', 'Quint Out', 'Quint In', 'Expo Out', 'Expo In', 'Circ Out', 'Circ In', 'Back Out', 'Back In', 'Circ InOut', 'Back InOut', 'Elastic Out', 'Elastic In', 'Bounce Out', 'Bounce In', 'Bounce InOut', 'Elastic InOut'];

import { assetUrl } from '../core/asset-url.mjs';

export function createEasingPicker(value, onChange, state = { open: false }) {
  const gallery = document.createElement('details'); gallery.open = state.open;
  gallery.addEventListener('toggle', () => { state.open = gallery.open; });
  const summary = document.createElement('summary'); summary.textContent = t('easing-picker.s36919c3'); gallery.append(summary);
  const choices = document.createElement('div'); choices.className = 'easing-gallery';
  const select = selected => {
    for (const button of choices.children) {
      const active = Number(button.dataset.easing) === selected;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    }
  };
  EASING_NAMES.forEach((name, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.title = `${index + 1} · ${name}`;
    button.dataset.easing = index + 1; button.setAttribute('aria-label', button.title);
    const image = document.createElement('img'); image.src = assetUrl(`easing/${index + 1}.svg`); image.alt = name;
    button.append(image, String(index + 1));
    button.onclick = () => { state.open = gallery.open; select(index + 1); onChange(index + 1); };
    choices.append(button);
  });
  gallery.append(choices); select(value);
  return { element: gallery, select };
}
