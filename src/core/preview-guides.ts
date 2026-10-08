import { DEFAULT_LINE_WIDTH } from './visual-constants.ts';

/**
 * The fields of a sampled line state this module reads. `SceneRuntime.sample` returns the full
 * runtime state (plus `color`, `text`, `incline`, `floor`); only these members are used here, so
 * the parameter stays structurally compatible with both that state and the render-only states the
 * callers construct.
 */
export interface GuideLineState {
  x: number;
  y: number;
  rotation: number;
  alpha: number;
  scaleX: number;
}

/** A sampled state or nothing, as `SceneRuntime.sampler` yields `undefined` for missing lines. */
type MaybeGuideState = GuideLineState | undefined;

/** A judge line as far as line numbering is concerned: only `father` is consulted. */
interface GuideLineSource {
  father?: unknown;
}

/** A clickable judge-line guide in canvas coordinates. */
export interface LineGuide {
  index: number;
  x: number;
  y: number;
  rotation: number;
  halfWidth: number;
  alpha: number;
}

/** A run of coincident guides reported as a single label. */
export interface GuideGroup extends LineGuide {
  indices: number[];
}

/** A point in canvas coordinates. */
export interface GuidePoint {
  x: number;
  y: number;
}

export function lineGuides(states: MaybeGuideState[], lines: unknown[], order: number[], width: number, height: number, scale: number): LineGuide[] {
  return order.filter(index => states[index] && lines[index]).map(index => {
    const state = states[index];
    // `filter` does not narrow the element type, so re-check here to obtain a `GuideLineState`.
    if (!state) throw new Error(`missing state for line ${index}`);
    return { index, x: width / 2 + state.x * scale, y: height / 2 - state.y * scale, rotation: state.rotation,
      halfWidth: Math.abs(state.scaleX) * DEFAULT_LINE_WIDTH * scale / 2, alpha: state.alpha };
  });
}

export function mergeGuides(guides: LineGuide[], scale: number, enabled = true): GuideGroup[] {
  const groups: GuideGroup[] = [];
  for (const guide of guides) {
    const group = enabled && groups.find(candidate => Math.hypot(candidate.x - guide.x, candidate.y - guide.y) < 10 * scale && Math.abs(candidate.rotation - guide.rotation) < 0.01);
    if (group) group.indices.push(guide.index);
    else groups.push({ ...guide, indices: [guide.index] });
  }
  return groups;
}

export function pickGuide(guides: LineGuide[], point: GuidePoint, selected: number, radius = 10): number | null {
  const matches = guides.filter(guide => {
    const angle = guide.rotation * Math.PI / 180;
    const deltaX = point.x - guide.x; const deltaY = point.y - guide.y;
    const across = deltaX * Math.cos(angle) + deltaY * Math.sin(angle);
    const perpendicular = -deltaX * Math.sin(angle) + deltaY * Math.cos(angle);
    return Math.abs(across) <= Math.max(guide.halfWidth, radius) && Math.abs(perpendicular) <= radius;
  });
  if (!matches.length) return null;
  return matches[(matches.findIndex(guide => guide.index === selected) + 1) % matches.length].index;
}

export function formatLineNumbers(indices: number[], lines: GuideLineSource[] | null = null): string {
  const sorted = [...indices].sort((left, right) => left - right);
  const groups: string[] = [];
  for (let index = 0; index < sorted.length; index++) {
    const first = sorted[index]; let last = first;
    const firstParent = Number(lines?.[first]?.father ?? -1);
    while (firstParent < 0 && sorted[index + 1] === last + 1 && Number(lines?.[sorted[index + 1]]?.father ?? -1) < 0) last = sorted[++index];
    const suffix = firstParent >= 0 ? `(${firstParent})` : '';
    groups.push(last === first ? `${first}${suffix}` : `${first}–${last}`);
  }
  return groups.join(', ');
}
