import { DEFAULT_EDITOR_PREFERENCES, DEFAULT_SETTINGS } from '../core/default-settings.mjs';
import { attachRangeValueTooltip } from './range-value-tooltip.mjs';
import { availableLocales, currentLocale, setLocale, t } from '../i18n.mjs';

// The panel is generated from `t()` keys. Switching the language rebuilds the
// body in place; the two skin sections and the detail blocks moved out of
// index.html stay the same nodes so their controllers remain connected.
export function createSettingsPanel({ onLocaleChange = () => {} } = {}) {
  const dialog = document.createElement('dialog'); dialog.id = 'settings-modal';
  const body = document.createElement('div'); body.className = 'settings-body'; dialog.append(body);
  const skins = document.createElement('section'); skins.id = 'editor-skin-settings';
  const noteSkins = document.createElement('section'); noteSkins.id = 'note-skin-settings';
  // Detail blocks live in index.html; keep the same nodes across rebuilds.
  const moved = ['.preview-settings', '.display-settings', '.compatibility-details']
    .map(selector => document.querySelector(selector)).filter(Boolean);
  const detailDefaults = new Map([
    ['.preview-settings', [['#preview-mode', 'all'], ['#loop-start', '0'], ['#loop-end', '16'], ['#loop-enabled', false]]],
    ['.display-settings', [['#realtime-alpha', DEFAULT_SETTINGS.realtimeAlpha]]],
  ]);
  const restore = (heading, defaults, extra = []) => {
    if (!confirm(t('settings.s7d6ffba', { p0: heading }))) return;
    for (const [id, value] of [...defaults, ...extra]) {
      const input = id.startsWith('#') ? document.querySelector(id) : document.getElementById(id); if (!input) continue;
      if (input.type === 'checkbox') input.checked = Boolean(value); else input.value = String(value);
      input.dispatchEvent(new Event(input.type === 'number' ? id === 'fps-limit' ? 'input' : 'change' : input.type === 'range' || input.type === 'color' ? 'input' : 'change', { bubbles: true }));
    }
  };
  const settingField = ([id, text, type, value, minimum, maximum, step]) => {
    const label = document.createElement('label'); label.className = 'field'; label.append(text);
    const input = document.createElement('input'); input.id = id; input.type = type; input.setAttribute('aria-label', text);
    input.dataset.rpenField = id; label.dataset.rpenField = id;
    if (type === 'checkbox') input.checked = value; else input.value = value;
    if (minimum !== undefined) input.min = minimum; if (maximum !== undefined) input.max = maximum; if (step !== undefined) input.step = step;
    label.append(input); return label;
  };
  const group = (heading, fields, extraDefaults = []) => {
    const section = document.createElement('section'); section.className = 'settings-group';
    const headingRow = document.createElement('div'); headingRow.className = 'settings-group-heading';
    const title = document.createElement('h3'); title.textContent = heading;
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'settings-reset'; reset.textContent = t('settings.sa191935');
    reset.setAttribute('aria-label', t('settings.seaff884', { p0: heading }));
    reset.onclick = () => restore(heading, fields.map(([id, unused, type, value]) => [id, value]), extraDefaults);
    headingRow.append(title, reset); section.append(headingRow);
    for (const definition of fields) section.append(settingField(definition));
    body.append(section);
  };
  function build() {
    const title = document.createElement('h2'); title.textContent = t('settings.s7debf9c'); dialog.prepend(title);

    // Language first: the choice applies instantly and rebuilds this panel.
    const language = document.createElement('section'); language.className = 'settings-group'; language.id = 'language-settings';
    const languageHeading = document.createElement('h3'); languageHeading.textContent = t('settings.language'); language.append(languageHeading);
    const languageField = document.createElement('label'); languageField.className = 'field';
    const languageSelect = document.createElement('select'); languageSelect.id = 'ui-language'; languageSelect.setAttribute('aria-label', t('settings.language'));
    languageSelect.replaceChildren(...availableLocales().map(({ locale, label }) => new Option(label, locale)));
    languageSelect.value = currentLocale().locale;
    languageSelect.onchange = () => {
      // The host may reload the page to apply the language everywhere; it
      // returns false when the switch has to wait (unsaved chart).
      const previous = currentLocale().locale;
      const next = setLocale(languageSelect.value);
      if (onLocaleChange(next, previous) === false) { setLocale(previous); languageSelect.value = previous; }
      rebuild();
    };
    const languageHint = document.createElement('p'); languageHint.className = 'hint'; languageHint.textContent = t('settings.languageHint');
    languageField.append(languageSelect); language.append(languageField, languageHint); body.append(language);
    body.append(skins, noteSkins);

  group(t('settings.s7757a0d'), [['fps-unlimited', t('settings.s0908c46'), 'checkbox', false], ['fps-limit', t('settings.s819ead9'), 'number', DEFAULT_SETTINGS.fpsLimit, 10, undefined, 'any']]);
  const fpsInput = body.querySelector('#fps-limit'); fpsInput.disabled = true;
  const fpsError = document.createElement('p'); fpsError.id = 'fps-limit-error'; fpsError.className = 'hint'; fpsError.hidden = true; fpsError.setAttribute('role', 'status'); fpsError.textContent = t('settings.sb33a8b5'); body.lastElementChild.append(fpsError);
  const fpsHint = document.createElement('p'); fpsHint.className = 'hint'; fpsHint.textContent = t('settings.s3c11d7d'); body.lastElementChild.append(fpsHint);
  group(t('settings.sa482c4b'), [['note-size', t('settings.sc46e2c8'), 'range', DEFAULT_SETTINGS.noteSize, 10, 500, 1], ['bar-width', t('settings.sfaf8db5'), 'range', DEFAULT_SETTINGS.barWidth, 0.5, 10, 0.1], ['bar-alpha', t('settings.sf6e88ad'), 'range', DEFAULT_SETTINGS.barAlpha, 0.1, 2, 0.05], ['judgement-offset', t('settings.s75c178d'), 'range', DEFAULT_EDITOR_PREFERENCES.judgementOffset, 42, 240, 1], ['event-value-size', t('settings.s8c4f6ce'), 'range', 13, 8, 28, 1], ['event-value-threshold', t('settings.se7f1645'), 'range', 30, 10, 180, 1], ['draw-event-curves', t('settings.s3cd3a16'), 'checkbox', DEFAULT_SETTINGS.drawEventCurves], ['event-curve-threshold', t('settings.sd54b6a9'), 'range', 24, 8, 180, 1], ['event-opacity', t('settings.s0d6ac76'), 'range', DEFAULT_EDITOR_PREFERENCES.eventOpacity, 0.05, 1, 0.05], ['event-bar-width', t('settings.s2326c43'), 'range', DEFAULT_EDITOR_PREFERENCES.eventBarWidth, 0.35, 1, 0.01], ['highlight-notes', t('settings.sfa323b7'), 'checkbox', DEFAULT_SETTINGS.highlight], ['seamless-events', t('settings.s1c661f0'), 'checkbox', true], ['background-blur', t('settings.s838d08e'), 'range', 10.5, 0, 30, 0.5]]);
  group(t('settings.s8df94df'), [['viewport-overflow', t('settings.s36f8ec2'), 'checkbox', DEFAULT_EDITOR_PREFERENCES.viewportOverflow], ['overflow-blur', t('settings.s7702bb1'), 'range', DEFAULT_EDITOR_PREFERENCES.overflowBlur, 0, 80, 1], ['overflow-darken', t('settings.sbe87e02'), 'range', DEFAULT_EDITOR_PREFERENCES.overflowDarken, 0, 1, 0.05]]);
  const delayFields = [['hit-tap-delay', t('settings.s433367f'), 'number', DEFAULT_EDITOR_PREFERENCES.hitTapDelay, undefined, undefined, 'any'], ['hit-drag-delay', t('settings.s158520d'), 'number', DEFAULT_EDITOR_PREFERENCES.hitDragDelay, undefined, undefined, 'any'], ['hit-flick-delay', t('settings.s048413b'), 'number', DEFAULT_EDITOR_PREFERENCES.hitFlickDelay, undefined, undefined, 'any']];
  group(t('settings.s52d4123'), [['volume', t('settings.s3f5837a'), 'range', DEFAULT_SETTINGS.volume, 0, 1, 0.01], ['hit-volume', t('settings.sccdfa32'), 'range', DEFAULT_SETTINGS.hitVolume, 0, 1, 0.01], ['hit-enabled', t('settings.s8e70d2d'), 'checkbox', true], ['autoplay-view', t('settings.s25fd96e'), 'checkbox', DEFAULT_SETTINGS.autoplayView], ['scroll-speed', t('settings.s61d8f86'), 'range', DEFAULT_SETTINGS.scrollSpeed, 0.1, 100, 0.1], ['wheel-limit-audio-start', t('settings.s508fe61'), 'checkbox', DEFAULT_SETTINGS.wheelStopAtAudioStart]], [['#preserve-pitch', true], ...delayFields.map(([id, unused, type, value]) => [id, value])]);
  const wheelHint = document.createElement('p'); wheelHint.className = 'hint'; wheelHint.textContent = t('settings.s7b3756a'); body.lastElementChild.append(wheelHint);
  const delays = document.createElement('details'); delays.id = 'hit-sound-delays';
  const delaySummary = document.createElement('summary'); delaySummary.textContent = t('settings.s1d0f7d2'); delays.append(delaySummary);
  for (const definition of delayFields) delays.append(settingField(definition));
  const delayHint = document.createElement('p'); delayHint.className = 'hint'; delayHint.textContent = t('settings.s1371b92'); delays.append(delayHint);
  body.lastElementChild.append(delays);
  group(t('settings.sf670c32'), [['line-numbers', t('settings.se885c1e'), 'checkbox', true], ['line-arrows', t('settings.se2ddafa'), 'checkbox', true], ['line-tint', t('settings.s20a1e0b'), 'checkbox', true], ['merge-line-numbers', t('settings.sa0bbafc'), 'checkbox', true], ['pick-preview-lines', t('settings.s3f3fa4f'), 'checkbox', true]]);
  group(t('settings.s4c2fbba'), [['tips-enabled', t('settings.s06bcebb'), 'checkbox', DEFAULT_EDITOR_PREFERENCES.tipsEnabled], ['success-notifications', t('settings.s3a0b627'), 'checkbox', true], ['note-source-hover', t('settings.s64ea180'), 'checkbox', true]]);
  group(t('settings.s7d61208'), [['pick-preview-noise-areas', t('settings.s8eb076e'), 'checkbox', true], ['seamless-noise-areas', t('settings.s6d407f2'), 'checkbox', true], ['force-simple-noise', t('settings.s36af346'), 'checkbox', false]]);
  group(t('settings.s83c6800'), [['selection-interval', t('settings.sf56c113'), 'number', DEFAULT_EDITOR_PREFERENCES.selectionInterval, 1, Number.MAX_SAFE_INTEGER, 1]]);
  group(t('settings.s3a96efa'), [['event-cut-density', t('settings.s98708ba'), 'number', DEFAULT_SETTINGS.cutDensity, 0.1, 128, 0.1], ['event-drag-sensitivity', t('settings.s59d9436'), 'range', DEFAULT_EDITOR_PREFERENCES.dragSensitivity, 0.1, 8, 0.1], ['sample-auto-fit', t('settings.sa4af917'), 'checkbox', true], ['paired-movement-sampling', t('settings.sd63631e'), 'checkbox', DEFAULT_EDITOR_PREFERENCES.pairedMovementSampling]]);
  const dragHint = document.createElement('p'); dragHint.className = 'hint'; dragHint.textContent = t('settings.s1ee44b7'); body.lastElementChild.append(dragHint);
  group(t('settings.s3334602'), [['text-selection-drag', t('settings.s745b520'), 'checkbox', false]]);
  group(t('settings.s671e28c'), [['line-switcher-enabled', t('settings.s1e57415'), 'checkbox', true]]);
  group(t('settings.sc4eb94d'), [['clipboard-history-enabled', t('settings.sc239e97'), 'checkbox', true]]);
  const clipboardHint = document.createElement('p'); clipboardHint.className = 'hint'; clipboardHint.textContent = t('settings.saccc96a'); body.lastElementChild.append(clipboardHint);
  group(t('settings.s54a747c'), [['default-line-thickness', t('settings.sabcccbd'), 'number', DEFAULT_SETTINGS.lineScale, 0.1, 10, 0.1]]);
  const lineHint = document.createElement('p'); lineHint.className = 'hint'; lineHint.textContent = t('settings.s482ccb8'); body.lastElementChild.append(lineHint);
  group(t('settings.s48eafb2'), [['autosave-enabled', t('settings.sf6e185a'), 'checkbox', DEFAULT_SETTINGS.autoSave], ['autosave-seconds', t('settings.s1246e36'), 'number', DEFAULT_SETTINGS.autoSaveSeconds, 1, 3600, 1], ['autosave-limit', t('settings.s51b0b66'), 'number', DEFAULT_SETTINGS.autoSaveLimit, 1, 100, 1]]);
  const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = t('settings.s1ea74b9'); body.append(hint);
  group(t('settings.sdb7d8ab'), [['include-backup-charts', t('settings.s1cb72b0'), 'checkbox', false]]);
  const backupHint = document.createElement('p'); backupHint.className = 'hint'; backupHint.textContent = t('settings.s0200377'); body.lastElementChild.append(backupHint);
  group(t('settings.s8afe24b'), [['judgement-color', t('settings.sda91d91'), 'color', '#ffffff']]);

  // Detail blocks moved out of index.html; their reset buttons are re-created
  // on every rebuild, so drop the previous ones first.
  for (const section of moved) {
    for (const button of section.querySelectorAll(':scope > .settings-reset-detail')) button.remove();
    body.append(section);
    const defaults = detailDefaults.get(`.${section.className.split(' ')[0]}`);
    const heading = section.querySelector('summary')?.textContent ?? t('settings.s7debf9c');
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'settings-reset settings-reset-detail'; reset.textContent = t('settings.sa191935');
    reset.setAttribute('aria-label', t('settings.seaff884', { p0: heading }));
    reset.onclick = event => { event.preventDefault(); event.stopPropagation(); if (defaults) restore(heading, defaults); };
    section.append(reset);
  }

  const hotkeys = document.createElement('button'); hotkeys.id = 'advanced-preferences'; hotkeys.textContent = t('settings.sd34afee');
  const close = document.createElement('button'); close.textContent = t('settings.s33246f6'); close.onclick = () => dialog.close();
  const actions = document.createElement('div'); actions.className = 'modal-actions'; actions.append(hotkeys, close); dialog.append(actions);
  }

  function rebuild() {
    for (const child of [...dialog.children]) if (child !== body) child.remove();
    body.replaceChildren();
    build();
  }

  build();
  document.body.append(dialog);
  attachRangeValueTooltip(dialog, body);
  return dialog;
}
