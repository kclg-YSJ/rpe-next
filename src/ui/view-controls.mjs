import { t } from '../i18n.mjs';
export const SCREEN_RATIOS = ['3:2', '16:9', '16:10', '4:3', '5:4', '5:3', '1:1', '21:9', '32:9', '32:10', '18:9', '19:9', '19.5:9', '20:9', '9:16', '10:16', '2:3', '3:4', '4:5', '9:18', '9:19', '9:19.5', '9:20', '9:21'];

export function setRatioOptions(select, width, height) {
  const value = `${width}:${height}`;
  const options = SCREEN_RATIOS.includes(value) ? SCREEN_RATIOS : [...SCREEN_RATIOS, value];
  select.replaceChildren(...options.map(ratio => new Option(ratio, ratio)));
  select.value = value;
}

export function applyViewControls(preferences, timeline, previews) {
  timeline.cameraX = preferences.cameraX ?? 0;
  timeline.notesOnly = preferences.notesOnly ?? false;
  document.querySelector('.editor').classList.toggle('notes-only', timeline.notesOnly);
  const notesButton = document.querySelector('#notes-only');
  notesButton.textContent = '';
  notesButton.title = timeline.notesOnly ? t('view-controls.sc33b5a7') : t('view-controls.sbc2bd44');
  for (const [id, enabled] of [['notes-only', timeline.notesOnly], ['game-ui', preferences.showGameUI ?? false]]) {
    const button = document.querySelector(`#${id}`); button.classList.toggle('active', enabled); button.setAttribute('aria-pressed', enabled);
  }
  document.querySelector('#camera-x').value = timeline.cameraX;
  document.querySelector('#view-divisor').value = preferences.viewDivisor ?? 1;
  for (const preview of previews) {
    preview.viewDivisor = preferences.viewDivisor ?? 1;
    preview.showGameUI = preferences.showGameUI ?? false;
  }
}
