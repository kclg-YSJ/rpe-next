import type { EditorPreferences } from '../platform/editor-preferences.ts';
import type { Timeline } from './timeline.ts';
import type { Preview } from './preview.ts';

// `cameraX`, `notesOnly`, `viewDivisor` and `showGameUI` are this module's own view state: it is the
// only place that writes them outside the timeline and preview classes, which read them back as
// optional members. They cannot be declared on `Timeline`/`Preview` from here, so the contract is
// widened over the imported classes with a documented declaration merge (a pure type-level
// construct, erased at build time) instead of an unchecked cast. Each declaration exactly matches
// its existing uses: `Timeline.cameraX` is compared with `?? 0` and assigned a number,
// `notesOnly` is assigned a boolean, `Preview.viewDivisor` is a number and `showGameUI` a boolean.
declare module './timeline.ts' {
  interface Timeline {
    cameraX: number;
    notesOnly: boolean;
  }
}

declare module './preview.ts' {
  interface Preview {
    viewDivisor: number;
    showGameUI: boolean;
  }
}

/** The ratio presets offered in the view controls, formatted `width:height`. */
export const SCREEN_RATIOS: string[] = ['3:2', '16:9', '16:10', '4:3', '5:4', '5:3', '1:1', '21:9', '32:9', '32:10', '18:9', '19:9', '19.5:9', '20:9', '9:16', '10:16', '2:3', '3:4', '4:5', '9:18', '9:19', '9:19.5', '9:20', '9:21'];

/**
 * Fills the ratio `<select>` with the presets, appending the current ratio when it is not one of
 * them, and selects it.
 *
 * The caller passes whatever `document.querySelector` returned, which is `Element | null`; the two
 * possibilities are narrowed here rather than asserted, so a missing control stays a plain runtime
 * failure instead of an unchecked cast.
 */
export function setRatioOptions(select: Element | null, width: number, height: number): void {
  if (!(select instanceof HTMLSelectElement)) throw new TypeError('缺少比例选择控件');
  const value = `${width}:${height}`;
  const options = SCREEN_RATIOS.includes(value) ? SCREEN_RATIOS : [...SCREEN_RATIOS, value];
  select.replaceChildren(...options.map(ratio => new Option(ratio, ratio)));
  select.value = value;
}

/**
 * Applies the stored view preferences to the timeline, the previews and the controls themselves.
 *
 * The DOM lookups are narrowed by tag rather than by cast; the preference reads keep their existing
 * `??` fallbacks, so an absent key still behaves exactly as before.
 */
export function applyViewControls(preferences: EditorPreferences, timeline: Timeline, previews: Preview[]): void {
  // `EditorPreferences` indexes to `number | boolean | ToolbarMode | undefined`, because the schema
  // is data-driven, so each key's real kind is narrowed once here. The narrowings accept exactly the
  // values the preference writer can store for these keys (`cameraX`/`viewDivisor` are registered as
  // numeric ranges, `notesOnly`/`showGameUI` as boolean flags), and every read below reuses the bound
  // value, so the runtime results are unchanged. A `null` remains the only unusable value, matching
  // the `??` fallbacks the module already had.
  const cameraX = preferences.cameraX;
  const notesOnly = preferences.notesOnly;
  const viewDivisor = preferences.viewDivisor;
  const showGameUI = preferences.showGameUI;
  timeline.cameraX = typeof cameraX === 'number' ? cameraX : 0;
  timeline.notesOnly = typeof notesOnly === 'boolean' ? notesOnly : false;
  const editor = document.querySelector('.editor');
  if (!(editor instanceof HTMLElement)) throw new TypeError('缺少编辑器根节点');
  editor.classList.toggle('notes-only', timeline.notesOnly);
  const notesButton = document.querySelector('#notes-only');
  if (!(notesButton instanceof HTMLElement)) throw new TypeError('缺少仅音符视图按钮');
  notesButton.textContent = '';
  notesButton.title = timeline.notesOnly ? '切换到音符与事件视图 · Alt+N' : '切换到仅音符视图 · Alt+N';
  const enabledFlags: [string, boolean][] = [
    ['notes-only', timeline.notesOnly],
    ['game-ui', typeof showGameUI === 'boolean' ? showGameUI : false],
  ];
  for (const [id, enabled] of enabledFlags) {
    const button = document.querySelector(`#${id}`);
    if (!(button instanceof Element)) throw new TypeError(`缺少视图控件 #${id}`);
    button.classList.toggle('active', enabled); button.setAttribute('aria-pressed', String(enabled));
  }
  const cameraInput = document.querySelector('#camera-x');
  if (!(cameraInput instanceof HTMLInputElement)) throw new TypeError('缺少相机位置输入框');
  cameraInput.value = String(timeline.cameraX);
  const divisorInput = document.querySelector('#view-divisor');
  if (!(divisorInput instanceof HTMLInputElement)) throw new TypeError('缺少视野除数输入框');
  divisorInput.value = String(typeof viewDivisor === 'number' ? viewDivisor : 1);
  for (const preview of previews) {
    preview.viewDivisor = typeof viewDivisor === 'number' ? viewDivisor : 1;
    preview.showGameUI = typeof showGameUI === 'boolean' ? showGameUI : false;
  }
}
