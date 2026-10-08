export const EASING_NAMES: string[] = ['Linear', 'Sine Out', 'Sine In', 'Quad Out', 'Quad In', 'Sine InOut', 'Quad InOut', 'Cubic Out', 'Cubic In', 'Quart Out', 'Quart In', 'Cubic InOut', 'Quart InOut', 'Quint Out', 'Quint In', 'Expo Out', 'Expo In', 'Circ Out', 'Circ In', 'Back Out', 'Back In', 'Circ InOut', 'Back InOut', 'Elastic Out', 'Elastic In', 'Bounce Out', 'Bounce In', 'Bounce InOut', 'Elastic InOut'];

import { assetUrl } from '../core/asset-url.ts';

/**
 * Open/closed state of the gallery `<details>`.
 *
 * Owned by the caller so the picker can be rebuilt (inspectors re-render on every selection) without
 * collapsing, and shared between the two pickers in one shader card.
 */
export interface EasingPickerState {
  open: boolean;
}

/** The gallery element plus the imperative selection setter, so callers can reflect an external change. */
export interface EasingPicker {
  element: HTMLDetailsElement;
  select: (selected: number) => void;
}

export function createEasingPicker(value: number, onChange: (value: number) => void, state: EasingPickerState = { open: false }): EasingPicker {
  const gallery = document.createElement('details'); gallery.open = state.open;
  gallery.addEventListener('toggle', () => { state.open = gallery.open; });
  const summary = document.createElement('summary'); summary.textContent = '缓动图示 · 29 种'; gallery.append(summary);
  const choices = document.createElement('div'); choices.className = 'easing-gallery';
  const select = (selected: number): void => {
    for (const child of choices.children) {
      const button = child as HTMLButtonElement;
      const active = Number(button.dataset.easing) === selected;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    }
  };
  EASING_NAMES.forEach((name, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.title = `${index + 1} · ${name}`;
    // `dataset` stringifies on write, so the numeric index is stored as its decimal form.
    button.dataset.easing = String(index + 1); button.setAttribute('aria-label', button.title);
    const image = document.createElement('img'); image.src = assetUrl(`easing/${index + 1}.svg`); image.alt = name;
    button.append(image, String(index + 1));
    button.onclick = () => { state.open = gallery.open; select(index + 1); onChange(index + 1); };
    choices.append(button);
  });
  gallery.append(choices); select(value);
  return { element: gallery, select };
}
