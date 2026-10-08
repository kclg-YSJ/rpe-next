// Game-UI layout tables and the small lookups that drive them.
//
// The layout mirrors the original `UI.txt` table: one entry per bindable element, positioned in a
// normalised 1920x1080 space with an `edgeX`/`edgeY` anchor telling `gameUiLayout` how the element
// should follow a viewport that is not 16:9.

import type { Chart, JudgeLine } from './types.ts';
import type { LineState } from './scene.ts';

/** Members shared by every laid-out element. */
interface GameUiLayoutBase {
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  edgeX: number;
  edgeY: number;
}

/** The pause button, drawn from a skin texture and therefore sized in pixels. */
export interface GameUiPauseItem extends GameUiLayoutBase {
  key: 'pause';
  width: number;
  height: number;
}

/** The progress bar, drawn as a rectangle whose height is fixed in pixels. */
export interface GameUiBarItem extends GameUiLayoutBase {
  key: 'bar';
  height: number;
}

/** A text element, whose size is a font size rather than a box. */
interface GameUiTextBase extends GameUiLayoutBase {
  fontSize: number;
}

/** Each text element is its own member so the union stays discriminated on `key`. */
export interface GameUiComboNumberItem extends GameUiTextBase { key: 'combonumber'; }
export interface GameUiComboItem extends GameUiTextBase { key: 'combo'; }
export interface GameUiScoreItem extends GameUiTextBase { key: 'score'; }
export interface GameUiNameItem extends GameUiTextBase { key: 'name'; }
export interface GameUiLevelItem extends GameUiTextBase { key: 'level'; }

/** The ids of the text elements. */
export type GameUiTextKey = 'combonumber' | 'combo' | 'score' | 'name' | 'level';

/**
 * A laid-out element. The union is discriminated on `key`, which is what lets callers narrow to the
 * element that actually carries `width`/`height` or `fontSize`; no element carries both.
 */
export type GameUiLayoutItem =
  | GameUiPauseItem
  | GameUiBarItem
  | GameUiComboNumberItem
  | GameUiComboItem
  | GameUiScoreItem
  | GameUiNameItem
  | GameUiLevelItem;

/**
 * A bindable element together with the line index that currently drives it.
 *
 * The fields come from the sampled `LineState`, so this stays an extension of it rather than a
 * second, drifting copy of the same shape.
 */
export interface GameUiBinding extends LineState {
  lineIndex: number;
}

/** One entry of the preview render order: a judge line, then the hold and note overlays. */
export interface RenderPass {
  kind: 'line' | 'hold' | 'note';
  index?: number;
  depth: number;
}

/** Bindable UI element ids and their Chinese labels, in menu order. */
export const UI_BINDINGS: [string, string][] = [
  ['pause', '暂停'], ['combonumber', '连击数'], ['combo', 'combo 文字'], ['score', '分数'],
  ['bar', '进度条'], ['name', '曲名'], ['level', '难度'],
];

// Raw table entries, before the normalised coordinates are expanded to the current viewport. Each
// key carries exactly the members its element kind needs; because every key of the union is listed,
// the table is a total record rather than a partial one.
type GameUiLayoutTable = { [K in GameUiLayoutItem['key']]: Extract<GameUiLayoutItem, { key: K }> };

const layout: GameUiLayoutTable = {
  pause: { key: 'pause', x: 0.021, y: 0.838, anchorX: 0, anchorY: 1, width: 42, height: 42, edgeX: -1, edgeY: 1 },
  combonumber: { key: 'combonumber', x: 0.3516, y: 0.825, anchorX: 0.5, anchorY: 0.5, fontSize: 67, edgeX: 0, edgeY: 1 },
  combo: { key: 'combo', x: 0.3516, y: 0.7833, anchorX: 0.5, anchorY: 0.5, fontSize: 35, edgeX: 0, edgeY: 1 },
  score: { key: 'score', x: 0.6855, y: 0.8458, anchorX: 1, anchorY: 1, fontSize: 49, edgeX: 1, edgeY: 1 },
  bar: { key: 'bar', x: 0, y: 0.863, anchorX: 0, anchorY: 0.5, height: 8, edgeX: -1, edgeY: 1 },
  name: { key: 'name', x: 0.02, y: 0.05417, anchorX: 0, anchorY: 0, fontSize: 35, edgeX: -1, edgeY: -1 },
  level: { key: 'level', x: 0.6855, y: 0.05417, anchorX: 1, anchorY: 0, fontSize: 33, edgeX: 1, edgeY: -1 },
};

/**
 * Expand the normalised table for a logical viewport, keeping the original 1350x900 margins.
 *
 * Each element keeps only the members its kind declares, so re-centring touches just the shared
 * coordinates and the result stays assignable to that element's own union member.
 */
export function gameUiLayout(logicalWidth: number, logicalHeight: number): GameUiLayoutItem[] {
  return Object.values(layout).map(item => ({ ...item,
    x: item.x * 1920 - 675 + item.edgeX * (logicalWidth - 1350) / 2,
    y: item.y * 1080 - 486 + item.edgeY * (logicalHeight - 900) / 2,
  }));
}

/**
 * Map each bound UI element to the state of the line currently driving it.
 *
 * Later lines overwrite earlier ones, which is what the "last binding wins" preview behaviour
 * relies on. `chart.judgeLineList` is read with a fallback because hand-built documents may omit it.
 *
 * `line.attachUI` is `string | undefined`; the guard narrows it to `string` for both the predicate
 * and the map key. The sampled entries are optional because `SceneRuntime.sample` types them that
 * way (it returns `undefined` for an out-of-range index); only a line that is actually bound gets
 * this far, and such a line always has a sampled state, so skipping a missing one cannot drop a
 * binding the original would have produced.
 */
export function gameUiBindings(chart: Pick<Chart, 'judgeLineList'>, states: readonly (LineState | undefined)[]): Map<string, GameUiBinding> {
  const result = new Map<string, GameUiBinding>();
  for (const [index, line] of (chart.judgeLineList ?? []).entries()) {
    const attachUI = line.attachUI;
    if (attachUI === undefined) continue;
    if (!UI_BINDINGS.some(([key]) => key === attachUI)) continue;
    const state = states[index];
    if (state === undefined) continue;
    result.set(attachUI, { ...state, lineIndex: index });
  }
  return result;
}

/**
 * Combo and score at `seconds`, from the sorted note completion times.
 *
 * The comparison is strict so a note counts only once playback passes it.
 */
export function scoreAt(completionTimes: readonly number[], seconds: number): { combo: number; score: number } {
  let low = 0; let high = completionTimes.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (completionTimes[middle] < seconds) low = middle + 1; else high = middle;
  }
  return { combo: low, score: completionTimes.length ? Math.round(1000000 * low / completionTimes.length) : 0 };
}

/** Judge lines in paint order, then the hold and note overlays on top of every line. */
export function renderPasses(lines: readonly JudgeLine[], order: readonly number[]): RenderPass[] {
  return [...order.map(index => ({ kind: 'line' as const, index, depth: lines[index].zOrder ?? 0 })),
    { kind: 'hold' as const, depth: 999 }, { kind: 'note' as const, depth: 1000 }].sort((left, right) => left.depth - right.depth);
}
